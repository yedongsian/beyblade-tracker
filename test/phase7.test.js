import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { Database } from '../src/db/database.js';
import { detectSupportedBrowser } from '../src/release/browser.js';
import { SecretStore } from '../src/security/secret-store.js';
import {
  applyPendingTransfer, createTransferBundle, inspectTransferBundle, stageTransferImport,
} from '../src/maintenance/transfer.js';
import { createBackup } from '../src/maintenance/backup.js';
import { compareVersions, rollbackUpdate, signedPayload, validateUpdateManifest } from '../src/release/update.js';
import { upsertSource } from '../src/core/store.js';
import { createDiagnosticsBundle, inspectDiagnosticsBundle } from '../src/maintenance/diagnostics.js';

test('Windows secret store encrypts notification credentials and never writes plaintext', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-secret-'));
  const path = join(root, 'config', 'secrets.json');
  const protect = (value) => Buffer.from(`protected:${value}`).toString('base64');
  const unprotect = (value) => Buffer.from(value, 'base64').toString('utf8').replace(/^protected:/, '');
  const store = new SecretStore(path, { platform: 'win32', protect, unprotect });
  const status = store.saveTelegram({ token: '123456:super-secret-token', chatId: '998877' });
  assert.equal(status.telegram.configured, true);
  const onDisk = readFileSync(path, 'utf8');
  assert.doesNotMatch(onDisk, /super-secret-token|998877/);
  assert.deepEqual(store.readNotifications().telegram, { token: '123456:super-secret-token', chatId: '998877' });
  assert.equal(store.clearTelegram().telegram.configured, false);
  rmSync(root, { recursive: true, force: true });
});

test('transfer bundle verifies hashes, excludes credentials, and restores database plus sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-transfer-e2e-'));
  const original = join(root, 'old', 'tracker.db');
  const sources = join(root, 'old', 'sources.json');
  mkdirSync(join(root, 'old'), { recursive: true });
  const db = new Database(original);
  upsertSource(db, { key: 'transfer-source', connector: 'fixture' });
  db.close();
  writeFileSync(sources, JSON.stringify({ sources: [] }));
  const config = { dbPath: original, sourcesPath: sources, exportDir: join(root, 'exports') };
  const bundle = createTransferBundle(config);
  const inspected = inspectTransferBundle(bundle);
  assert.equal(inspected.verification.integrity, 'ok');
  assert.deepEqual(inspected.metadata.exclusions, ['secrets', 'runtime', 'logs', 'debug-html']);
  assert.doesNotMatch(bundle.toString('base64'), /telegram/i);

  const incomingRoot = join(root, 'new');
  const incomingConfig = {
    dbPath: join(incomingRoot, 'data', 'tracker.db'), sourcesPath: join(incomingRoot, 'config', 'sources.json'),
    userSourcesPath: join(incomingRoot, 'config', 'sources.json'), pendingImportFile: join(incomingRoot, 'runtime', 'pending.beyblade-transfer'),
  };
  stageTransferImport(bundle, incomingConfig);
  const applied = applyPendingTransfer(incomingConfig);
  assert.equal(applied.integrity, 'ok');
  const restored = new Database(incomingConfig.dbPath);
  assert.equal(restored.get("SELECT COUNT(*) count FROM sources WHERE key='transfer-source'").count, 1);
  restored.close();
  assert.equal(existsSync(incomingConfig.pendingImportFile), false);
  rmSync(root, { recursive: true, force: true });
});

// The service publishes its own PID before createApp applies a pending transfer,
// so the restore guard must not treat the caller as a competing instance. Calling
// this without { pidFile } skips the guard entirely and hides the failure.
test('pending transfer applies while the calling service already owns the PID file', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-transfer-self-'));
  const original = join(root, 'old', 'tracker.db');
  const sources = join(root, 'old', 'sources.json');
  mkdirSync(join(root, 'old'), { recursive: true });
  const db = new Database(original);
  upsertSource(db, { key: 'self-pid-source', connector: 'fixture' });
  db.close();
  writeFileSync(sources, JSON.stringify({ sources: [] }));
  const bundle = createTransferBundle({ dbPath: original, sourcesPath: sources, exportDir: join(root, 'exports') });

  const incomingRoot = join(root, 'new');
  const pidFile = join(incomingRoot, 'runtime', 'tracker.pid');
  const incomingConfig = {
    dbPath: join(incomingRoot, 'data', 'tracker.db'),
    sourcesPath: join(incomingRoot, 'config', 'sources.json'),
    userSourcesPath: join(incomingRoot, 'config', 'sources.json'),
    pendingImportFile: join(incomingRoot, 'runtime', 'pending.beyblade-transfer'),
  };
  stageTransferImport(bundle, incomingConfig);
  // Exactly what bin/service.js does before createApp runs.
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(process.pid));

  const applied = applyPendingTransfer(incomingConfig, { pidFile });
  assert.equal(applied.integrity, 'ok');
  const restored = new Database(incomingConfig.dbPath);
  assert.equal(restored.get("SELECT COUNT(*) count FROM sources WHERE key='self-pid-source'").count, 1);
  restored.close();
  assert.equal(existsSync(incomingConfig.pendingImportFile), false);
  rmSync(root, { recursive: true, force: true });
});

// A pending file that survives a failure would be retried on every launch, leaving
// the service permanently unable to start.
test('a failed pending transfer is moved aside so the next start can proceed', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-transfer-failed-'));
  const incomingConfig = {
    dbPath: join(root, 'data', 'tracker.db'),
    sourcesPath: join(root, 'config', 'sources.json'),
    userSourcesPath: join(root, 'config', 'sources.json'),
    pendingImportFile: join(root, 'runtime', 'pending.beyblade-transfer'),
  };
  const foreignPidFile = join(root, 'runtime', 'other.pid');
  mkdirSync(join(root, 'runtime'), { recursive: true });

  const original = join(root, 'old', 'tracker.db');
  mkdirSync(join(root, 'old'), { recursive: true });
  const db = new Database(original);
  upsertSource(db, { key: 'failed-source', connector: 'fixture' });
  db.close();
  writeFileSync(join(root, 'old', 'sources.json'), JSON.stringify({ sources: [] }));
  const bundle = createTransferBundle({
    dbPath: original, sourcesPath: join(root, 'old', 'sources.json'), exportDir: join(root, 'exports'),
  });
  stageTransferImport(bundle, incomingConfig);

  // A different live process holds the database, so the restore must be refused.
  writeFileSync(foreignPidFile, String(process.ppid));
  assert.throws(() => applyPendingTransfer(incomingConfig, { pidFile: foreignPidFile }), /仍在執行中/);

  assert.equal(existsSync(incomingConfig.pendingImportFile), false, 'pending file must not survive a failure');
  const movedAside = readdirSync(join(root, 'runtime')).filter((name) => name.includes('.failed-'));
  assert.equal(movedAside.length, 1, 'failed import should be kept aside for diagnosis');
  rmSync(root, { recursive: true, force: true });
});

test('update manifest requires valid semantic version, HTTPS, hash, and Ed25519 signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = {
    version: '1.1.0', installerUrl: 'https://updates.example.test/BeybladeTracker-1.1.0-Setup.exe',
    sha256: 'a'.repeat(64), schemaVersion: 10, channel: 'stable', publisher: 'Beyblade Tracker',
    releaseNotes: 'Test release notes', publishedAt: '2026-07-29T00:00:00.000Z', size: 1024, publishReady: true,
  };
  manifest.signature = sign(null, signedPayload(manifest), privateKey).toString('base64');
  assert.equal(validateUpdateManifest(manifest, { publicKey }).updateAvailable, true);
  assert.throws(() => validateUpdateManifest({ ...manifest, sha256: 'b'.repeat(64) }, { publicKey }), /簽章/);
  assert.throws(() => validateUpdateManifest({ ...manifest, installerUrl: 'http://unsafe.example/setup.exe' }, { publicKey }), /HTTPS/);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
});

test('rollback switches the version pointer and restores the pre-update database', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-'));
  const dbPath = join(root, 'user', 'data', 'tracker.db');
  mkdirSync(join(root, 'user', 'data'), { recursive: true });
  let db = new Database(dbPath);
  upsertSource(db, { key: 'before-update', connector: 'fixture' });
  db.close();
  const backup = createBackup(dbPath, join(root, 'user', 'backups'), { prefix: 'pre-update' });
  db = new Database(dbPath);
  upsertSource(db, { key: 'after-update', connector: 'fixture' });
  db.close();
  const installRoot = join(root, 'program');
  mkdirSync(join(installRoot, 'versions', '1.0.0'), { recursive: true });
  const currentFile = join(installRoot, 'current.json');
  writeFileSync(currentFile, JSON.stringify({ version: '1.1.0' }));
  const rollbackFile = join(root, 'user', 'runtime', 'rollback.json');
  mkdirSync(join(root, 'user', 'runtime'), { recursive: true });
  writeFileSync(rollbackFile, JSON.stringify({ previousVersion: '1.0.0', targetVersion: '1.1.0', databaseBackup: backup.path }));
  const result = rollbackUpdate({
    dbPath, installRoot, update: { rollbackFile, currentFile },
  });
  assert.equal(result.version, '1.0.0');
  assert.equal(JSON.parse(readFileSync(currentFile, 'utf8')).version, '1.0.0');
  db = new Database(dbPath);
  assert.equal(db.get("SELECT COUNT(*) count FROM sources WHERE key='before-update'").count, 1);
  assert.equal(db.get("SELECT COUNT(*) count FROM sources WHERE key='after-update'").count, 0);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('rollback leaves a legacy backup schema untouched for the rolled-back service', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-legacy-'));
  const dbPath = join(root, 'user', 'data', 'tracker.db');
  mkdirSync(join(root, 'user', 'data'), { recursive: true });
  let legacy = new DatabaseSync(dbPath);
  legacy.exec("PRAGMA user_version=10; CREATE TABLE legacy_marker (value TEXT); INSERT INTO legacy_marker VALUES ('before-update');");
  legacy.close();
  const backup = createBackup(dbPath, join(root, 'user', 'backups'), { prefix: 'legacy' });
  legacy = new DatabaseSync(dbPath);
  legacy.exec("DELETE FROM legacy_marker; INSERT INTO legacy_marker VALUES ('after-update');");
  legacy.close();
  const installRoot = join(root, 'program');
  mkdirSync(join(installRoot, 'versions', '1.0.0'), { recursive: true });
  const currentFile = join(installRoot, 'current.json');
  writeFileSync(currentFile, JSON.stringify({ version: '1.1.0' }));
  const rollbackFile = join(root, 'user', 'runtime', 'rollback.json');
  mkdirSync(join(root, 'user', 'runtime'), { recursive: true });
  writeFileSync(rollbackFile, JSON.stringify({ previousVersion: '1.0.0', targetVersion: '1.1.0', databaseBackup: backup.path }));

  rollbackUpdate({ dbPath, installRoot, update: { rollbackFile, currentFile } });
  const restored = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 10);
  assert.equal(restored.prepare('SELECT value FROM legacy_marker').get().value, 'before-update');
  assert.equal(restored.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='operation_events'").get().count, 0);
  restored.close();
  rmSync(root, { recursive: true, force: true });
});

test('browser detection selects only an installed system Chrome candidate', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' };
  const expected = join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
  const detected = detectSupportedBrowser({ env, platform: 'win32', exists: (path) => path === expected });
  assert.equal(detected.available, true);
  assert.equal(detected.path, expected);
  assert.equal(detectSupportedBrowser({ env, platform: 'linux' }).available, false);
});

test('Windows installer declares per-user install, startup task, shortcuts, and data-preserving uninstall', () => {
  const installer = readFileSync(new URL('../release/windows/installer.iss', import.meta.url), 'utf8');
  assert.match(installer, /PrivilegesRequired=lowest/);
  assert.match(installer, /Name: "startup"/);
  assert.match(installer, /Microsoft\\Windows\\CurrentVersion\\Run/);
  assert.match(installer, /launcher\.vbs.*restart/);
  assert.match(installer, /Flags: nowait runhidden/);
  assert.doesNotMatch(installer, /skipifsilent/);
  assert.match(installer, /not WizardSilent/);
  assert.match(installer, /launcher\.vbs"" start noninteractive/);
  assert.match(installer, /launcher\.vbs"" restart noninteractive[\s\S]*?Check: WizardSilent/);
  assert.doesNotMatch(installer, /\[UninstallRun\]/);
  assert.match(installer, /-Action stop -NonInteractive/);

  // The stop precondition must fail closed: a missing launcher proves only that the helper cannot run.
  const stopFunction = installer.match(/function StopTrackerService\(\): Boolean;[\s\S]*?\nend;/)?.[0] || '';
  assert.ok(stopFunction, 'StopTrackerService must exist');
  assert.match(stopFunction, /ewWaitUntilTerminated, ResultCode\) and \(ResultCode = 0\)/);
  assert.doesNotMatch(stopFunction, /Result := True/);
  const missingLauncherBlock = stopFunction.match(/if not FileExists\(LauncherPath\) then begin[\s\S]*?end;/)?.[0] || '';
  assert.ok(missingLauncherBlock, 'the missing-launcher branch must exist');
  assert.match(missingLauncherBlock, /Result := False;/);
  assert.doesNotMatch(missingLauncherBlock, /Result := True/);
  const e2e = readFileSync(new URL('../scripts/phase7-e2e.ps1', import.meta.url), 'utf8');
  assert.match(e2e, /function Wait-E2ePathAbsent/);
  assert.match(e2e, /Wait-E2ePathAbsent \$installRoot 'Uninstaller'/);
  const releaseBuilder = readFileSync(new URL('../scripts/build-windows-release.js', import.meta.url), 'utf8');
  assert.ok(releaseBuilder.indexOf('manifest.publishReady = true') < releaseBuilder.indexOf('manifest.signature = sign'));
  assert.match(installer, /PreserveUserData/);
  assert.match(installer, /SuppressibleMsgBox\([\s\S]*MB_YESNO, IDYES\) = IDYES/);
  const uninstallPrompt = installer.match(/function InitializeUninstall\(\): Boolean;[\s\S]*?end;/)?.[0] || '';
  assert.doesNotMatch(uninstallPrompt, /(?:^|[^A-Za-z])MsgBox\(/);
  assert.match(uninstallPrompt, /Result := StopTrackerService\(\);[\s\S]*if not Result then begin/);
  assert.match(installer, /\[UninstallDelete\][\s\S]*\{app\}\\current\.json/);
  assert.match(installer, /google\.com\/chrome/);
  assert.match(e2e, /function Wait-E2eServiceHealthy/);
  assert.match(e2e, /runtime\\tracker\.pid/);
  assert.match(e2e, /runtime\\tracker-status\.json/);
  assert.match(e2e, /127\.0\.0\.1:8787\/health/);
  assert.match(e2e, /Wait-E2eServiceStopped \$servicePid/);
  assert.doesNotMatch(e2e, /bin\\health-check\.js/);
  assert.match(e2e, /function Stop-E2eProcesses/);
  assert.match(e2e, /Get-CimInstance Win32_Process/);
  assert.match(e2e, /\$stopErrors = @\(\)/);
  assert.match(e2e, /\$attempt -lt 3/);
  assert.match(e2e, /CommandLine\.Contains\(\$runId\).*CommandLine\.Contains\(\$installRoot\)/);
  assert.match(e2e, /Packaged service-control stop failed with exit code/);
  assert.match(e2e, /E2E process cleanup failed/);
  assert.match(e2e, /E2E cleanup failed/);
  assert.match(e2e, /\[switch\]\$StopFailureMode/);
  assert.match(e2e, /\[switch\]\$MissingLauncherMode/);
  assert.match(e2e, /Choose either -StopFailureMode or -MissingLauncherMode, not both/);
  assert.match(e2e, /function Wait-E2eProcessFailure/);
  assert.match(e2e, /function Assert-E2eNoLauncherDialog/);
  assert.match(e2e, /function Set-E2eMissingLauncher/);
  assert.match(e2e, /function Restore-E2eMissingLauncher/);
  assert.match(e2e, /Refusing to modify a control script outside this run/);
  assert.match(e2e, /Refusing to move a launcher outside this run/);
  assert.match(e2e, /Failed uninstall removed program files while the service was still running/);
  assert.match(e2e, /Uninstall without a launcher removed program files it could not prove were idle/);
  assert.match(e2e, /Uninstall without a launcher stopped or killed the running service/);
  assert.match(e2e, /Wait-E2eProcessFailure \$process 'Uninstaller without a launcher' 15/);
  assert.match(e2e, /try \{ Restore-E2eMissingLauncher \} catch \{ \$cleanupErrors \+= \$_ \}/);
  assert.match(e2e, /try \{ Restore-E2eStopFailure \} catch \{ \$cleanupErrors \+= \$_ \}/);

  const serviceControl = readFileSync(new URL('../scripts/service-control.js', import.meta.url), 'utf8');
  assert.match(serviceControl, /runStopSequence/);
  assert.match(serviceControl, /runStartSequence/);
  assert.match(serviceControl, /ExecutablePath/);
  assert.match(serviceControl, /CreationDate/);
  assert.match(serviceControl, /System32', 'WindowsPowerShell', 'v1\.0', 'powershell\.exe'/);
  assert.doesNotMatch(serviceControl, /\/IM/);
});

test('Windows PowerShell 5.1 launcher uses a UTF-8 BOM for localized text', () => {
  const launcher = readFileSync(new URL('../release/windows/launcher.ps1', import.meta.url));
  assert.deepEqual([...launcher.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const source = launcher.subarray(3).toString('utf8');
  assert.match(source, /找不到目前安裝版本/);
  assert.match(source, /按 Enter 關閉/);
  assert.match(source, /移機檔/);
});

test('hidden Windows launcher maps startup failures to safe dialogs with copy and report actions', () => {
  const launcher = readFileSync(new URL('../release/windows/launcher.ps1', import.meta.url));
  assert.deepEqual([...launcher.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const source = launcher.subarray(3).toString('utf8');
  for (const code of ['BT-LCH-001', 'BT-LCH-002', 'BT-LCH-003', 'BT-LCH-004', 'BT-LCH-005', 'BT-LCH-999']) {
    assert.match(source, new RegExp(code));
  }
  assert.match(source, /Show-LauncherError/);
  assert.match(source, /複製錯誤資訊/);
  assert.match(source, /問題回報/);
  assert.doesNotMatch(source, /Show-LauncherError \$_.Exception.Message/);
});

test('non-interactive launcher callers get a bounded exit code instead of a dialog', () => {
  const source = readFileSync(new URL('../release/windows/launcher.ps1', import.meta.url)).subarray(3).toString('utf8');
  assert.match(source, /\[switch\]\$NonInteractive/);
  assert.match(source, /BT-LCH-006/);
  assert.match(source, /\$nonInteractiveActions = @\('start','restart','stop','status'\)/);
  assert.match(source, /if \(\$NonInteractive -and \(\$nonInteractiveActions -notcontains \$Action\)\)/);
  assert.match(source, /if \(-not \$NonInteractive\) \{ Read-Host/);
  assert.match(source, /WaitForExit\(\$timeout \* 1000\)/);
  // The non-interactive branch must short-circuit the dialog and every path must set an explicit exit code.
  assert.ok(source.indexOf('[Console]::Error.WriteLine($code)') < source.lastIndexOf('Show-LauncherError $code'));
  assert.match(source, /\[Console\]::Error\.WriteLine\(\$code\)\s*\r?\n\s*exit 1/);
  assert.match(source, /Show-LauncherError \$code\s*\r?\n\s*exit 1\s*\r?\n\}\s*\r?\nexit 0/);

  const vbs = readFileSync(new URL('../release/windows/launcher.vbs', import.meta.url), 'utf8');
  assert.match(vbs, /mode = "noninteractive"/);
  assert.match(vbs, /-NonInteractive/);
});

// D-4 shipped because every automated check ran with -NonInteractive, which writes a code to stderr
// and never builds a window. The interactive path — the one every shortcut actually uses — had no
// coverage at all, so an invisible, permanently blocking dialog passed the whole suite.
test('launcher error verification covers the interactive dialog the shortcuts actually use', () => {
  const script = readFileSync(new URL('../scripts/phase7-launcher-errors.ps1', import.meta.url), 'utf8');
  assert.match(script, /function Invoke-LchDialogCase/);
  assert.match(script, /Invoke-LchDialogCase 'F' '互動對話框可見性' 'start' 'BT-LCH-001'/);
  // wscript.exe is what makes the host hidden; driving powershell.exe directly cannot reproduce D-4.
  assert.match(script, /Start-Process -FilePath 'wscript\.exe'/);
  assert.doesNotMatch(script, /Invoke-LchDialogCase[\s\S]*?-NonInteractive/);
  // EnumWindows sees hidden windows; MainWindowHandle does not, which is why D-4 read as "no dialog".
  assert.match(script, /EnumWindows/);
  assert.match(script, /IsWindowVisible/);
  assert.match(script, /BeybladeLchWindows\]::Visible\(\$window\)\) \{ \$failures \+= '對話框視窗存在但不可見/);
  assert.match(script, /永久阻塞回歸/);
  assert.match(script, /\[switch\]\$SkipDialogCase/);
  assert.match(script, /\[Environment\]::UserInteractive/);

  const launcher = readFileSync(new URL('../release/windows/launcher.ps1', import.meta.url)).subarray(3).toString('utf8');
  assert.match(launcher, /\$form\.Add_Shown\(\{/);
  assert.match(launcher, /ShowWindow\(\$form\.Handle, 1\)/);
});

// D-7: the launcher reported BT-LCH-003 for starts that succeeded, because the wait budget was the
// verdict. Expiring the budget must only end the wait; the failure decision needs real evidence.
test('a start that outlives its wait budget is confirmed against the service before failing', () => {
  const serviceControl = readFileSync(new URL('../scripts/service-control.js', import.meta.url), 'utf8');
  assert.match(serviceControl, /async function probeHealth/);
  assert.match(serviceControl, /probeHealth,/);
  assert.match(serviceControl, /result\.outcome === 'still-starting'/);
  assert.match(serviceControl, /Tracker 仍在啟動中/);

  const lifecycle = readFileSync(new URL('../src/release/service-lifecycle.js', import.meta.url), 'utf8');
  assert.match(lifecycle, /export async function confirmStartOutcome/);
  assert.match(lifecycle, /return confirmStartOutcome\(deps, childPid\);/);
  assert.doesNotMatch(lifecycle, /\}\s*\r?\n\s*return \{ ok: false, outcome: 'timeout', pid: childPid \};/);
});

test('stable launcher guard blocks a rollback into a legacy service-control without a guard', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-legacy-rollback-'));
  const installRoot = join(root, 'program');
  const userRoot = join(root, 'user');
  const appRoot = join(installRoot, 'versions', '0.9.0');
  const marker = join(root, 'legacy-control-ran.txt');
  try {
    mkdirSync(join(appRoot, 'runtime'), { recursive: true });
    copyFileSync(process.execPath, join(appRoot, 'runtime', 'node.exe'));
    copyFileSync(new URL('../release/windows/launcher.ps1', import.meta.url), join(installRoot, 'launcher.ps1'));
    mkdirSync(join(appRoot, 'scripts'), { recursive: true });
    // Deliberately a pre-FIX-32 control script: it has no rollback schema code.
    writeFileSync(join(appRoot, 'scripts', 'service-control.js'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`);
    writeFileSync(join(installRoot, 'current.json'), JSON.stringify({ version: '0.9.0' }));
    mkdirSync(join(userRoot, 'runtime'), { recursive: true });
    writeFileSync(join(userRoot, 'runtime', 'rollback-status.json'), JSON.stringify({
      status: 'accepted', requestedAt: new Date().toISOString(),
    }));
    const launcher = join(installRoot, 'launcher.ps1');
    const runLegacyStart = () => {
      try {
        execFileSync('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-Action', 'start', '-NonInteractive',
        ], { cwd: installRoot, env: { ...process.env, BEYBLADE_USER_ROOT: userRoot }, stdio: 'pipe' });
        return null;
      } catch (error) { return error; }
    };
    const freshFailure = runLegacyStart();
    assert.ok(freshFailure);
    assert.match(String(freshFailure.stderr), /BT-LCH-003/);
    assert.equal(existsSync(marker), false);

    const oldAt = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
    writeFileSync(join(userRoot, 'runtime', 'rollback-status.json'), JSON.stringify({
      status: 'running', events: [{ phase: 'running', at: oldAt }],
    }));
    const lockDir = join(userRoot, 'runtime', 'rollback.lock');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid, token: 'live_runner_token', correlationId: 'live-runner',
    }));
    const liveRunnerFailure = runLegacyStart();
    assert.ok(liveRunnerFailure);
    assert.match(String(liveRunnerFailure.stderr), /BT-LCH-003/);
    assert.equal(existsSync(marker), false);

    rmSync(lockDir, { recursive: true, force: true });
    const futureAt = new Date(Date.now() + (10 * 60 * 1000)).toISOString();
    writeFileSync(join(userRoot, 'runtime', 'rollback-status.json'), JSON.stringify({
      status: 'running', events: [{ phase: 'running', at: futureAt }],
    }));
    const futureFailure = runLegacyStart();
    assert.ok(futureFailure);
    assert.match(String(futureFailure.stderr), /BT-LCH-003/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('diagnostics require consent and exclude credentials, URLs, logs, and product history', () => {
  const db = new Database(':memory:');
  assert.throws(() => createDiagnosticsBundle(db, {}), /同意/);
  db.run("INSERT INTO user_settings (key,value_json,updated_at) VALUES ('diagnosticsConsent','true','x')");
  const bundle = createDiagnosticsBundle(db, { update: {} });
  const report = inspectDiagnosticsBundle(bundle);
  assert.equal(report.format, 'beyblade-diagnostics-v1');
  assert.deepEqual(report.exclusions, ['credentials', 'source URLs', 'raw HTML', 'logs', 'product history']);
  assert.doesNotMatch(gunzipForTest(bundle), /token|webhook/i);
  db.close();
});

function gunzipForTest(buffer) {
  return gunzipSync(buffer).toString('utf8');
}
