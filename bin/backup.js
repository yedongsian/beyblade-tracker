#!/usr/bin/env node
import { createBackup } from '../src/maintenance/backup.js';
import { getConfig } from '../src/config.js';
import { loadEnv } from '../src/util/env.js';

try {
  loadEnv();
  const config = getConfig();
  const result = createBackup(config.dbPath, config.backup.dir, {
    prefix: 'manual',
    retentionDays: config.backup.retentionDays,
    retentionCount: config.backup.retentionCount,
  });
  if (!result) throw new Error(`找不到資料庫：${config.dbPath}`);
  console.log(`備份完成：${result.path}`);
  console.log(`完整性：${result.integrity}；schema version：${result.userVersion}`);
} catch (err) {
  console.error(`備份失敗：${err.message}`);
  process.exitCode = 1;
}
