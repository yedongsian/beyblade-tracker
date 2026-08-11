// 驗證 .beyblade-transfer 移機檔的完整性與安全性。
// 由 a7-export.ps1 以安裝包內建的 node.exe 呼叫。
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');

const file = process.argv[2];
const problems = [];
const notes = [];

function hash(buf) { return createHash('sha256').update(buf).digest('hex'); }

const raw = readFileSync(file);
console.log('檔案         : ' + file);
console.log('壓縮後大小   : ' + statSync(file).size.toLocaleString() + ' bytes');

let payload;
try {
  const json = gunzipSync(raw).toString('utf8');
  console.log('解壓後大小   : ' + Buffer.byteLength(json).toLocaleString() + ' bytes');
  payload = JSON.parse(json);
  var decompressed = json;
} catch (error) {
  console.log('>>> FAIL：無法解壓或解析 —— ' + error.message);
  process.exit(1);
}

console.log('');
console.log('--- 中繼資料 ---');
console.log('format       : ' + payload.format);
console.log('createdAt    : ' + payload.createdAt);
console.log('appVersion   : ' + payload.appVersion);
console.log('schemaVersion: ' + payload.schemaVersion);
console.log('exclusions   : ' + JSON.stringify(payload.exclusions));

if (payload.appVersion !== '1.0.0') problems.push('appVersion 不是 1.0.0，實得 ' + payload.appVersion);
if (!Array.isArray(payload.exclusions) || !payload.exclusions.length) problems.push('缺少 exclusions 宣告');

console.log('');
console.log('--- 內含檔案（應只有 tracker.db 與 sources.json）---');
const names = Object.keys(payload.files || {});
for (const name of names) {
  const item = payload.files[name];
  const buf = Buffer.from(item.base64 || '', 'base64');
  const ok = item.sha256 === hash(buf);
  console.log('  ' + name.padEnd(16) + buf.length.toLocaleString().padStart(12) + ' bytes  sha256 ' + (ok ? 'OK' : 'MISMATCH'));
  if (!ok) problems.push(name + ' 的 SHA-256 不符');
}
const expected = ['tracker.db', 'sources.json'];
for (const extra of names.filter((n) => !expected.includes(n))) problems.push('包含非預期檔案：' + extra);
for (const missing of expected.filter((n) => !names.includes(n))) problems.push('缺少必要檔案：' + missing);

// tracker.db 應為有效 SQLite
const db = Buffer.from(payload.files['tracker.db']?.base64 || '', 'base64');
const header = db.subarray(0, 15).toString('utf8');
console.log('');
console.log('tracker.db 檔頭 : ' + JSON.stringify(header));
if (header !== 'SQLite format 3') problems.push('tracker.db 不是有效的 SQLite 檔');

// sources.json 應為合法 JSON
try {
  const src = JSON.parse(Buffer.from(payload.files['sources.json'].base64, 'base64').toString('utf8'));
  const list = Array.isArray(src) ? src : (src.sources || []);
  console.log('sources.json    : ' + list.length + ' 個來源 —— ' + list.map((s) => s.key).join(', '));
} catch (error) {
  problems.push('sources.json 不是合法 JSON：' + error.message);
}

console.log('');
console.log('--- 安全性掃描（INSTALL.md：不得含 Token、Webhook、PID、日誌或 debug HTML）---');
const scans = [
  ['Telegram bot token 格式', /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/],
  ['secrets.json 檔名', /secrets\.json/i],
  ['webhook 字樣', /webhook/i],
  ['discord webhook URL', /discord(app)?\.com\/api\/webhooks/i],
  ['tracker.pid', /tracker\.pid/i],
  ['tracker.log', /tracker\.log/i],
  ['debug HTML', /<!DOCTYPE html|PARSEFAIL/i],
];
for (const [label, re] of scans) {
  const hit = re.test(decompressed);
  console.log('  ' + label.padEnd(28) + (hit ? '>>> 命中（需檢視）' : '未命中'));
  if (hit) problems.push('安全性掃描命中：' + label);
}
notes.push('註：tracker.db 為二進位並以 base64 編碼，上述字串掃描對其內容的涵蓋有限；');
notes.push('    Token 的結構性保證來自 secrets 存放於獨立的 config\\secrets.json，未被打包。');

console.log('');
if (problems.length) {
  console.log('=== 結果：FAIL ===');
  for (const p of problems) console.log('  - ' + p);
} else {
  console.log('=== 結果：PASS ===');
}
for (const n of notes) console.log(n);
process.exit(problems.length ? 1 : 0);
