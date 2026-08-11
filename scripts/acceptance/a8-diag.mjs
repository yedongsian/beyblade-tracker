// 直接測試已安裝版本的 SecretStore：用假值、寫到暫存路徑，不碰真實 secrets.json。
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = process.argv[2];
const modUrl = pathToFileURL(join(appRoot, 'src', 'security', 'secret-store.js')).href;

console.log('app root : ' + appRoot);
console.log('module   : ' + modUrl);
console.log('');

let SecretStore;
try {
  ({ SecretStore } = await import(modUrl));
  console.log('模組載入 : OK');
} catch (error) {
  console.log('模組載入 : FAIL — ' + error.message);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'a8-diag-'));
const target = join(work, 'secrets.json');
console.log('暫存路徑 : ' + target);
console.log('');

// 這是假值，不是任何真實憑證。
const DUMMY_TOKEN = '123456789:AAdummyDUMMYdummyDUMMYdummyDUMMYdum';
const DUMMY_CHAT = '987654321';

try {
  const store = new SecretStore(target);
  console.log('--- 呼叫 saveTelegram（真實 DPAPI 路徑）---');
  const started = Date.now();
  const status = store.saveTelegram({ token: DUMMY_TOKEN, chatId: DUMMY_CHAT });
  console.log('耗時     : ' + (Date.now() - started) + ' ms');
  console.log('status   : ' + JSON.stringify(status));
  console.log('檔案存在 : ' + existsSync(target));

  const doc = JSON.parse(readFileSync(target, 'utf8'));
  console.log('provider : ' + doc.provider);
  for (const [k, v] of Object.entries(doc.values)) {
    console.log('  ' + k.padEnd(20) + ' 密文長度 ' + String(v).length);
  }

  console.log('');
  console.log('--- 回讀驗證（unprotect）---');
  const back = store.readNotifications();
  console.log('token 還原正確  : ' + (back.telegram.token === DUMMY_TOKEN));
  console.log('chatId 還原正確 : ' + (back.telegram.chatId === DUMMY_CHAT));

  console.log('');
  console.log('=== 結果：DPAPI 在此帳號運作正常 ===');
  console.log('若如此，則設定頁儲存失敗的原因不在 DPAPI，而在請求本身（CSRF／網路／前端）。');
} catch (error) {
  console.log('');
  console.log('=== 結果：FAIL ===');
  console.log('錯誤訊息 : ' + error.message);
  if (error.stack) console.log(error.stack.split('\n').slice(0, 4).join('\n'));
} finally {
  rmSync(work, { recursive: true, force: true });
  console.log('');
  console.log('暫存已清除。');
}
