import { gzipSync, gunzipSync } from 'node:zlib';
import { releaseInfo } from '../release/version.js';
import { operationsDiagnostics } from '../core/operations.js';

function clean(value) {
  return String(value || '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/https?:\/\/[^\s'"<>]+/gi, '[REDACTED_URL]')
    .replace(/\b(token|api[_-]?key|password|secret|authorization)\s*[=:]\s*[^\s,;&]+/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[REDACTED_TOKEN]')
    .slice(0, 2000);
}

function safeTimestamp(value) {
  const raw = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw) ? raw : null;
}

function safeSourceKey(value) {
  const raw = String(value || '');
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(raw)
    && !/^(?:https?|ftp):|token|secret|password|credential|api[_-]?key/i.test(raw) ? raw : 'source';
}

export function createDiagnosticsBundle(db, config) {
  const consent = db.get("SELECT value_json FROM user_settings WHERE key='diagnosticsConsent'");
  if (!consent || JSON.parse(consent.value_json) !== true) {
    throw new Error('請先在隱私設定中同意主動匯出診斷資料。');
  }
  const payload = {
    format: 'beyblade-diagnostics-v1',
    createdAt: new Date().toISOString(),
    release: ((release) => ({ version: release.version, channel: release.channel, installed: release.installed }))(releaseInfo(config)),
    runtime: { platform: process.platform, architecture: process.arch, node: process.version },
    network: (() => {
      const row = db.get('SELECT enabled,updated_at FROM network_control WHERE id=1');
      return row ? { enabled: Boolean(row.enabled), updated_at: safeTimestamp(row.updated_at) } : null;
    })(),
    counts: Object.fromEntries(['sources', 'products', 'offers', 'events', 'notifications', 'product_candidates']
      .map((table) => [table, db.get(`SELECT COUNT(*) count FROM ${table}`).count])),
    sources: db.all(`SELECT key,connector,enabled,consecutive_failures,last_success_at
      FROM sources ORDER BY id`).map((row) => ({
      key: safeSourceKey(row.key),
      connector: clean(row.connector), enabled: Boolean(row.enabled),
      consecutive_failures: Math.max(0, Number(row.consecutive_failures) || 0),
      last_success_at: safeTimestamp(row.last_success_at),
    })),
    recentFailures: db.all(`SELECT source_key,started_at,finished_at,error FROM crawl_runs
      WHERE status='failed' ORDER BY id DESC LIMIT 50`).map((row) => ({
      source_key: safeSourceKey(row.source_key),
      started_at: safeTimestamp(row.started_at),
      finished_at: safeTimestamp(row.finished_at),
      error: clean(row.error),
    })),
    operations: operationsDiagnostics(db),
    exclusions: ['credentials', 'source URLs', 'raw HTML', 'logs', 'product history'],
  };
  return gzipSync(Buffer.from(JSON.stringify(payload, null, 2)), { level: 9 });
}

export function inspectDiagnosticsBundle(buffer) {
  const value = JSON.parse(gunzipSync(buffer).toString('utf8'));
  if (value.format !== 'beyblade-diagnostics-v1') throw new Error('診斷檔格式錯誤。');
  return value;
}
