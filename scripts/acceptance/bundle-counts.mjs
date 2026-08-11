// 從 .beyblade-transfer 取出 tracker.db，輸出其筆數，作為匯入後比對的基準。
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const bundlePath = process.argv[2];
const work = mkdtempSync(join(tmpdir(), 'bundle-counts-'));
const out = { bundle: bundlePath, ok: false };

try {
  const payload = JSON.parse(gunzipSync(readFileSync(bundlePath)).toString('utf8'));
  out.createdAt = payload.createdAt;
  out.appVersion = payload.appVersion;
  const dbPath = join(work, 'tracker.db');
  writeFileSync(dbPath, Buffer.from(payload.files['tracker.db'].base64, 'base64'));

  const db = new DatabaseSync(dbPath, { readOnly: true });
  out.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  out.schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  out.counts = {};
  for (const t of ['products', 'offers', 'events', 'sources', 'observations']) {
    try { out.counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; }
    catch { out.counts[t] = null; }
  }
  db.close();
  out.ok = true;
} catch (error) {
  out.error = error.message;
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
