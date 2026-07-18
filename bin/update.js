#!/usr/bin/env node
import { createApp } from '../src/app.js';
import { checkForUpdate, launchPreparedUpdate, prepareUpdate } from '../src/release/update.js';

const app = createApp();
try {
  const update = await checkForUpdate(app.config);
  if (!update.enabled) throw new Error('尚未設定 UPDATE_MANIFEST_URL。');
  if (!update.updateAvailable) {
    console.log(`目前 ${update.currentVersion} 已是最新版本。`);
  } else {
    const prepared = await prepareUpdate(app.config, update.manifest);
    console.log(`更新 ${update.manifest.version} 已驗證；資料庫備份：${prepared.rollback.databaseBackup}`);
    launchPreparedUpdate(prepared);
    console.log('安裝器已啟動。');
  }
} catch (err) {
  console.error(`更新失敗：${err.message}`);
  process.exitCode = 1;
} finally {
  app.db.close();
}
