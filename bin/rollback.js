#!/usr/bin/env node
import { getConfig } from '../src/config.js';
import { projectPaths } from '../src/paths.js';
import { rollbackUpdate, writeRollbackStatus } from '../src/release/update.js';
import { loadEnv } from '../src/util/env.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

function startRolledBackService(config, version) {
  const appRoot = join(config.installRoot, 'versions', version);
  const node = join(appRoot, 'runtime', 'node.exe');
  const control = join(appRoot, 'scripts', 'service-control.js');
  return new Promise((resolve, reject) => {
    const child = spawn(node, ['--no-warnings', control, 'start'], {
      cwd: appRoot, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, BEYBLADE_APP_ROOT: appRoot, BEYBLADE_INSTALL_ROOT: config.installRoot, BEYBLADE_USER_ROOT: config.userRoot },
    });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('rollback service start failed'))));
  });
}

async function main() {
  const paths = projectPaths();
  loadEnv(paths.userRoot);
  const config = getConfig();
  writeRollbackStatus(config, { status: 'running' });
  let result;
  try {
    result = rollbackUpdate(config, { pidFile: paths.pidFile });
    await startRolledBackService(config, result.version);
  } catch (err) {
    writeRollbackStatus(config, { status: 'failed', code: err?.code || 'BT-UPD-007', completedAt: new Date().toISOString() });
    throw err;
  }
  writeRollbackStatus(config, { status: 'succeeded', version: result.version, completedAt: new Date().toISOString() });
  console.log(`已回滾至 ${result.version}；資料庫完整性：${result.restored.integrity}`);
}

main().catch((err) => {
  try { writeRollbackStatus(getConfig(), { status: 'failed', code: err?.code || 'BT-UPD-007', completedAt: new Date().toISOString() }); } catch { /* best effort */ }
  console.error(`回滾失敗：${err.message}`);
  process.exitCode = 1;
});
