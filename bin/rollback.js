#!/usr/bin/env node
import { getConfig } from '../src/config.js';
import { projectPaths } from '../src/paths.js';
import { runRollbackLifecycle } from '../src/release/update.js';
import { loadEnv } from '../src/util/env.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_FILE = fileURLToPath(import.meta.url);

function startRolledBackService(config, version, { correlationId } = {}) {
  const appRoot = join(config.installRoot, 'versions', version);
  const node = join(appRoot, 'runtime', 'node.exe');
  const control = join(appRoot, 'scripts', 'service-control.js');
  return new Promise((resolve, reject) => {
    const child = spawn(node, ['--no-warnings', control, 'start'], {
      cwd: appRoot, windowsHide: true, stdio: 'ignore',
      env: {
        ...process.env, BEYBLADE_APP_ROOT: appRoot, BEYBLADE_INSTALL_ROOT: config.installRoot, BEYBLADE_USER_ROOT: config.userRoot,
        BEYBLADE_ROLLBACK_RUNNER_PID: String(process.pid), BEYBLADE_ROLLBACK_CORRELATION_ID: correlationId || '',
      },
    });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('rollback service start failed'))));
  });
}

async function main() {
  const paths = projectPaths();
  loadEnv(paths.userRoot);
  const config = getConfig();
  const result = await runRollbackLifecycle(config, {
    pidFile: paths.pidFile,
    runnerFile: RUNNER_FILE,
    handoffToken: process.env.BEYBLADE_ROLLBACK_HANDOFF_TOKEN || null,
    startService: (version, context) => startRolledBackService(config, version, context),
  });
  console.log(`已回滾至 ${result.version}；資料庫完整性：${result.restored.integrity}`);
}

main().catch((err) => {
  console.error(`回滾失敗：${err.message}`);
  process.exitCode = 1;
});
