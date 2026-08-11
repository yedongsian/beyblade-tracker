// 以唯讀方式開啟 tracker.db，輸出完整性與各表筆數，供解除安裝前後比對。
import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2];
const out = { path, ok: false };
try {
  const db = new DatabaseSync(path, { readOnly: true });
  out.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  out.schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  const tables = ['products', 'offers', 'events', 'sources', 'observations'];
  out.counts = {};
  for (const t of tables) {
    try { out.counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; }
    catch { out.counts[t] = null; }
  }
  db.close();
  out.ok = true;
} catch (error) {
  out.error = error.message;
}
console.log(JSON.stringify(out, null, 2));
