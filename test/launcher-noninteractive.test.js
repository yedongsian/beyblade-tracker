import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsOnly = { skip: process.platform !== 'win32' ? 'Windows-only launcher contract' : false };
const LAUNCHER = fileURLToPath(new URL('../release/windows/launcher.ps1', import.meta.url));
const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const VERSION = '1.0.0';

// The uninstaller's exact invocation: hidden, non-interactive, bounded.
function runLauncher(installRoot, action = 'stop', timeout = 60_000) {
  const started = Date.now();
  const result = spawnSync(POWERSHELL, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NonInteractive',
    '-File', join(installRoot, 'launcher.ps1'), '-Action', action, '-NonInteractive',
  ], { encoding: 'utf8', windowsHide: true, timeout, cwd: installRoot });
  return { ...result, elapsedMs: Date.now() - started };
}

function createInstallRoot({ currentJson = true, controlExitCode = null } = {}) {
  const installRoot = mkdtempSync(join(tmpdir(), 'beyblade-launcher-'));
  copyFileSync(LAUNCHER, join(installRoot, 'launcher.ps1'));
  if (currentJson) writeFileSync(join(installRoot, 'current.json'), JSON.stringify({ version: VERSION }));
  if (controlExitCode !== null) {
    const appRoot = join(installRoot, 'versions', VERSION);
    mkdirSync(join(appRoot, 'runtime'), { recursive: true });
    mkdirSync(join(appRoot, 'scripts'), { recursive: true });
    const node = join(appRoot, 'runtime', 'node.exe');
    try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); }
    writeFileSync(join(appRoot, 'scripts', 'service-control.js'), [
      "console.error('stub service-control failure');",
      `process.exitCode = ${controlExitCode};`,
    ].join('\n'));
    writeFileSync(join(appRoot, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  }
  return installRoot;
}

test('non-interactive launcher fails with a safe code and no dialog when the install is unusable', windowsOnly, () => {
  const installRoot = createInstallRoot({ currentJson: false });
  try {
    const result = runLauncher(installRoot);
    assert.equal(result.error, undefined, 'the launcher must exit on its own, not be killed by the timeout');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BT-LCH-001/);
    assert.doesNotMatch(result.stderr, /Show-LauncherError|Exception|at line|ShowDialog/);
    assert.equal(result.stderr.includes(installRoot), false, 'stderr must not leak install paths');
    assert.equal(result.stdout.trim(), '');
  } finally { rmSync(installRoot, { recursive: true, force: true }); }
});

test('non-interactive launcher stop reports a service-control failure as a bounded non-zero exit', windowsOnly, () => {
  const installRoot = createInstallRoot({ controlExitCode: 1 });
  try {
    const result = runLauncher(installRoot);
    assert.equal(result.error, undefined, 'a stop failure must never wait for a dialog');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BT-LCH-003/);
    assert.doesNotMatch(result.stderr, /ShowDialog|System\.Windows\.Forms/);
    assert.ok(result.elapsedMs < 50_000, `bounded failure expected, took ${result.elapsedMs}ms`);
  } finally { rmSync(installRoot, { recursive: true, force: true }); }
});

test('non-interactive launcher stop returns zero when service-control succeeds', windowsOnly, () => {
  const installRoot = createInstallRoot({ controlExitCode: 0 });
  try {
    const result = runLauncher(installRoot);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stderr.trim(), '');
  } finally { rmSync(installRoot, { recursive: true, force: true }); }
});

test('non-interactive launcher refuses actions that require a window', windowsOnly, () => {
  const installRoot = createInstallRoot({ controlExitCode: 0 });
  try {
    const result = runLauncher(installRoot, 'export');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BT-LCH-006/);
  } finally { rmSync(installRoot, { recursive: true, force: true }); }
});
