#!/usr/bin/env node
import { createApp } from '../src/app.js';
import { checkForUpdate, launchPreparedUpdate, manifestDigest, prepareConfirmedUpdate } from '../src/release/update.js';

const app = createApp();
try {
  const update = await checkForUpdate(app.config);
  if (!update.enabled) throw new Error('尚未設定 UPDATE_MANIFEST_URL。');
  if (!update.updateAvailable) {
    console.log(`目前 ${update.currentVersion} 已是最新版本。`);
  } else {
    const targetIndex = process.argv.indexOf('--target');
    const digestIndex = process.argv.indexOf('--manifest-digest');
    const targetVersion = targetIndex >= 0 ? process.argv[targetIndex + 1] : null;
    const digest = digestIndex >= 0 ? process.argv[digestIndex + 1] : null;
    if (!process.argv.includes('--confirm') || !targetVersion || !digest) {
      console.log(`可用更新：${update.manifest.version}。此命令只檢查，不會下載或啟動安裝器。`);
      console.log(`確認時使用：--confirm --target ${update.manifest.version} --manifest-digest ${manifestDigest(update.manifest)}`);
    } else {
      const prepared = await prepareConfirmedUpdate(app.db, app.config, update.manifest, {
        confirmed: true, targetVersion, manifestDigest: digest,
      });
      launchPreparedUpdate(prepared);
      console.log('安裝器已啟動。');
    }
  }
} catch (err) {
  console.error(`更新失敗：${err.message}`);
  process.exitCode = 1;
} finally {
  app.db.close();
}
