import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
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

test('update manifest requires valid semantic version, HTTPS, hash, and Ed25519 signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = {
    version: '1.1.0', installerUrl: 'https://updates.example.test/BeybladeTracker-1.1.0-Setup.exe',
    sha256: 'a'.repeat(64), schemaVersion: 10, channel: 'stable', publisher: 'Beyblade Tracker',
    releaseNotes: 'Test release notes', publishedAt: '2026-07-29T00:00:00.000Z', size: 1024,
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
  assert.match(installer, /PreserveUserData/);
  assert.match(installer, /\[UninstallDelete\][\s\S]*\{app\}\\current\.json/);
  assert.match(installer, /google\.com\/chrome/);
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
