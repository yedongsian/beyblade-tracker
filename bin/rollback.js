#!/usr/bin/env node
import { getConfig } from '../src/config.js';
import { projectPaths } from '../src/paths.js';
import { rollbackUpdate, writeRollbackStatus } from '../src/release/update.js';
import { loadEnv } from '../src/util/env.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

try {
  const paths = projectPaths();
  loadEnv(paths.userRoot);
  const config = getConfig();
  writeRollbackStatus(config, { status: 'running' });
  const result = rollbackUpdate(config, { pidFile: paths.pidFile });
  writeRollbackStatus(config, { status: 'succeeded', version: result.version, completedAt: new Date().toISOString() });
  const child = spawn('wscript.exe', [join(config.installRoot, 'launcher.vbs'), 'start'], {
    detached: true, windowsHide: true, stdio: 'ignore',
  });
  child.once('error', () => writeRollbackStatus(config, { status: 'failed', code: 'BT-UPD-007', completedAt: new Date().toISOString() }));
  child.unref();
  console.log(`已回滾至 ${result.version}；資料庫完整性：${result.restored.integrity}`);
} catch (err) {
  try { writeRollbackStatus(getConfig(), { status: 'failed', code: err?.code || 'BT-UPD-007', completedAt: new Date().toISOString() }); } catch { /* best effort */ }
  console.error(`回滾失敗：${err.message}`);
  process.exitCode = 1;
}
