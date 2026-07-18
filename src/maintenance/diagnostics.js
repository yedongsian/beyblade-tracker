import { gzipSync, gunzipSync } from 'node:zlib';
import { releaseInfo } from '../release/version.js';

function clean(value) {
  return String(value || '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s]+/gi, '[REDACTED_WEBHOOK]')
    .slice(0, 2000);
}

export function createDiagnosticsBundle(db, config) {
  const consent = db.get("SELECT value_json FROM user_settings WHERE key='diagnosticsConsent'");
  if (!consent || JSON.parse(consent.value_json) !== true) {
    throw new Error('請先在隱私設定中同意主動匯出診斷資料。');
  }
  const payload = {
    format: 'beyblade-diagnostics-v1',
    createdAt: new Date().toISOString(),
    release: releaseInfo(config),
    runtime: { platform: process.platform, architecture: process.arch, node: process.version },
    network: db.get('SELECT enabled,reason,updated_at FROM network_control WHERE id=1'),
    counts: Object.fromEntries(['sources', 'products', 'offers', 'events', 'notifications', 'product_candidates']
      .map((table) => [table, db.get(`SELECT COUNT(*) count FROM ${table}`).count])),
    sources: db.all(`SELECT key,name,connector,enabled,consecutive_failures,last_success_at,last_error
      FROM sources ORDER BY id`).map((row) => ({ ...row, last_error: clean(row.last_error) })),
    recentFailures: db.all(`SELECT source_key,started_at,finished_at,error FROM crawl_runs
      WHERE status='failed' ORDER BY id DESC LIMIT 50`).map((row) => ({ ...row, error: clean(row.error) })),
    exclusions: ['credentials', 'source URLs', 'raw HTML', 'logs', 'product history'],
  };
  return gzipSync(Buffer.from(JSON.stringify(payload, null, 2)), { level: 9 });
}

export function inspectDiagnosticsBundle(buffer) {
  const value = JSON.parse(gunzipSync(buffer).toString('utf8'));
  if (value.format !== 'beyblade-diagnostics-v1') throw new Error('診斷檔格式錯誤。');
  return value;
}
