#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getConfig } from '../src/config.js';
import { stageTransferImport } from '../src/maintenance/transfer.js';
import { loadEnv } from '../src/util/env.js';
import { projectPaths } from '../src/paths.js';

const index = process.argv.indexOf('--from');
try {
  if (index < 0 || !process.argv[index + 1]) throw new Error('請使用 --from 指定 .beyblade-transfer 檔案。');
  loadEnv(projectPaths().userRoot);
  const config = getConfig();
  const result = stageTransferImport(readFileSync(resolve(process.argv[index + 1])), config);
  console.log(`移機匯入已驗證並排入：${result.path}`);
  console.log('請重新啟動 Tracker；啟動時會先保留現有資料庫，再套用匯入資料。');
} catch (err) {
  console.error(`移機匯入失敗：${err.message}`);
  process.exitCode = 1;
}
