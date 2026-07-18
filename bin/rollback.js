#!/usr/bin/env node
import { getConfig } from '../src/config.js';
import { projectPaths } from '../src/paths.js';
import { rollbackUpdate } from '../src/release/update.js';
import { loadEnv } from '../src/util/env.js';

try {
  const paths = projectPaths();
  loadEnv(paths.userRoot);
  const result = rollbackUpdate(getConfig(), { pidFile: paths.pidFile });
  console.log(`已回滾至 ${result.version}；資料庫完整性：${result.restored.integrity}`);
} catch (err) {
  console.error(`回滾失敗：${err.message}`);
  process.exitCode = 1;
}
