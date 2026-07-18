#!/usr/bin/env node
import { resolve } from 'node:path';
import { getConfig } from '../src/config.js';
import { exportTransferBundle } from '../src/maintenance/transfer.js';
import { loadEnv } from '../src/util/env.js';
import { projectPaths } from '../src/paths.js';

const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

try {
  loadEnv(projectPaths().userRoot);
  const config = getConfig();
  const out = valueAfter('--out');
  const result = exportTransferBundle(config, out ? resolve(out) : null);
  console.log(`移機匯出完成：${result.path}`);
  console.log(`schema version：${result.schemaVersion}；憑證、PID、日誌與除錯資料未匯出。`);
} catch (err) {
  console.error(`移機匯出失敗：${err.message}`);
  process.exitCode = 1;
}
