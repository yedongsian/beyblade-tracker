import { computeAvailability, exclusionReason } from './classify.js';
import { extractModel, normalizeWhitespace } from './normalize.js';
import {
  canonicalizeSeedUrl, displayNameForDomain, fetchableSeedUrl, registrableDomain, sourceKeyForDomain,
} from './site.js';
import { parseProductPage } from '../connectors/parse.js';
import { connectorVersion, createConnector } from '../connectors/index.js';
import { fetchPublicText } from '../net/public-http.js';
import { upsertSource } from './store.js';

const now = () => new Date().toISOString();

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function ensureSite(db, domain, displayName = displayNameForDomain(domain)) {
  let site = db.get('SELECT * FROM sites WHERE registrable_domain=?', [domain]);
  if (site) return site;
  const ts = now();
  const info = db.run(
    `INSERT INTO sites (registrable_domain,display_name,status,created_at,updated_at)
     VALUES (?,?, 'active',?,?)`, [domain, displayName, ts, ts]
  );
  return db.get('SELECT * FROM sites WHERE id=?', [info.lastInsertRowid]);
}

export function addSeedUrl(db, { siteId, sourceId = null, originalUrl, origin = 'ui' }) {
  const canonicalUrl = canonicalizeSeedUrl(originalUrl);
  const ts = now();
  const existing = db.get(
    'SELECT * FROM seed_urls WHERE site_id=? AND canonical_url=?', [siteId, canonicalUrl]
  );
  if (existing) {
    db.run(
      `UPDATE seed_urls SET source_id=COALESCE(?,source_id),enabled=1,updated_at=? WHERE id=?`,
      [sourceId, ts, existing.id]
    );
    return { seed: db.get('SELECT * FROM seed_urls WHERE id=?', [existing.id]), created: false };
  }
  const info = db.run(
    `INSERT INTO seed_urls (site_id,source_id,original_url,canonical_url,origin,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,1,?,?)`, [siteId, sourceId, originalUrl, canonicalUrl, origin, ts, ts]
  );
  return { seed: db.get('SELECT * FROM seed_urls WHERE id=?', [info.lastInsertRowid]), created: true };
}

export function syncSourceSite(db, source, definition) {
  const candidate = definition.url || definition.config?.pages?.[0];
  if (!candidate) return source;
  let canonical;
  try { canonical = canonicalizeSeedUrl(candidate); } catch { return source; }
  const domain = registrableDomain(canonical);
  const site = ensureSite(db, domain, definition.name || displayNameForDomain(domain));
  db.run('UPDATE sources SET site_id=? WHERE id=?', [site.id, source.id]);
  const pages = definition.config?.pages || [candidate];
  for (const page of pages) {
    try { addSeedUrl(db, { siteId: site.id, sourceId: source.id, originalUrl: page, origin: 'config' }); }
    catch { /* invalid legacy page stays in config validation path */ }
  }
  return db.get('SELECT * FROM sources WHERE id=?', [source.id]);
}

export function sourceConfigWithSeeds(db, source) {
  const config = parseJson(source.config_json);
  const seedPages = db.all(
    'SELECT original_url FROM seed_urls WHERE source_id=? AND enabled=1 ORDER BY id', [source.id]
  ).map((row) => row.original_url);
  const pages = [...new Set([...(config.pages || []), ...seedPages])];
  return { url: source.url, ...config, ...(pages.length ? { pages } : {}) };
}

export function listManagedSources(db) {
  return db.all(`
    SELECT s.*,si.registrable_domain,si.display_name AS site_name,si.status AS site_status,
      (SELECT COUNT(*) FROM seed_urls u WHERE u.source_id=s.id AND u.enabled=1) AS seed_count,
      (SELECT COUNT(*) FROM offers o WHERE o.source_id=s.id) AS offer_count
    FROM sources s LEFT JOIN sites si ON si.id=s.site_id
    ORDER BY s.enabled DESC,s.name COLLATE NOCASE
  `).map((row) => ({ ...row, config: parseJson(row.config_json) }));
}

function existingSiteSummary(db, site) {
  if (!site) return null;
  return {
    id: Number(site.id),
    domain: site.registrable_domain,
    name: site.display_name,
    sources: db.all('SELECT id,key,name,connector,enabled FROM sources WHERE site_id=? ORDER BY id', [site.id]),
    seeds: db.all('SELECT id,canonical_url,enabled FROM seed_urls WHERE site_id=? ORDER BY id', [site.id]),
  };
}

export async function previewSourceUrl(db, input, options = {}) {
  const canonicalUrl = canonicalizeSeedUrl(input);
  const fetchUrl = fetchableSeedUrl(input);
  const domain = registrableDomain(canonicalUrl, { overrides: options.domainOverrides });
  const site = db.get('SELECT * FROM sites WHERE registrable_domain=?', [domain]);
  const existingSource = site && db.get(
    'SELECT * FROM sources WHERE site_id=? ORDER BY enabled DESC,id LIMIT 1', [site.id]
  );
  const existingConfig = existingSource ? parseJson(existingSource.config_json) : {};
  const previewTimeoutMs = Math.min(30000, Number(existingConfig.http?.timeoutMs || options.timeoutMs || 12000));
  const result = {
    inputUrl: String(input).trim(), canonicalUrl, domain,
    suggestedName: site?.display_name || displayNameForDomain(domain),
    existingSite: existingSiteSummary(db, site),
    connector: existingSource?.connector || 'jsonld',
    resourceBudget: { scope: domain, pages: 1, maxSeconds: Math.ceil(previewTimeoutMs / 1000), maxDownloadMb: 2 },
    candidate: null, connection: { ok: false, message: '' },
    canConfirm: false,
  };

  // Browser recipes are not applied to arbitrary URLs in preview because a
  // browser may execute page code. The seed can still be added to an existing recipe.
  if (existingSource?.connector === 'browser') {
    result.connection = {
      ok: true,
      message: '已找到這個商店的瀏覽器 Recipe；確認後會加入新的種子網址。',
    };
    result.canConfirm = true;
    return result;
  }

  try {
    const fetchPage = options.fetchPage || fetchPublicText;
    const fetched = await fetchPage(fetchUrl, {
      timeoutMs: previewTimeoutMs,
      maxRedirects: 3,
      maxBytes: 2 * 1024 * 1024,
      userAgent: existingConfig.http?.userAgent || options.userAgent,
      lookupFn: options.lookupFn,
      fetchImpl: options.fetchImpl,
    });
    const selectors = existingConfig.selectors || {};
    const listing = parseProductPage(fetched.body, { url: fetched.url, selectors });
    const useful = listing && (listing.title || listing.price != null || listing.availabilityText || listing.availabilityRaw);
    if (!useful) {
      result.connection = { ok: true, message: '網站可以連線，但這一頁尚未辨識到商品資料。' };
      result.canConfirm = Boolean(site);
      return result;
    }
    const normalized = { ...listing, title: normalizeWhitespace(listing.title) };
    const availability = computeAvailability(normalized);
    const excluded = exclusionReason(normalized);
    result.candidate = {
      title: normalized.title || '未提供商品名稱',
      model: extractModel(normalized.title) || normalized.sku || null,
      price: normalized.price ?? null,
      currency: normalized.currency || null,
      state: availability.state,
      confidence: availability.confidence,
      excludedReason: excluded,
      url: fetched.url,
    };
    result.connection = { ok: true, message: excluded ? '頁面可解析，但內容可能不是目標商品。' : '連線與商品解析成功。' };
    result.canConfirm = !excluded;
  } catch (err) {
    result.connection = { ok: false, message: `連線測試失敗：${err.message}` };
  }
  return result;
}

function uniqueSourceKey(db, domain) {
  const base = sourceKeyForDomain(domain) || 'store';
  let key = base;
  let counter = 2;
  while (db.get('SELECT id FROM sources WHERE key=?', [key])) key = `${base}-${counter++}`;
  return key;
}

export function confirmSource(db, payload) {
  if (payload.confirmed !== true) throw new Error('請先確認預覽結果。');
  const originalUrl = String(payload.url || '').trim();
  const canonicalUrl = canonicalizeSeedUrl(originalUrl);
  const domain = registrableDomain(canonicalUrl);
  let site = db.get('SELECT * FROM sites WHERE registrable_domain=?', [domain]);
  site ||= ensureSite(db, domain, payload.name || displayNameForDomain(domain));
  let source = db.get('SELECT * FROM sources WHERE site_id=? ORDER BY enabled DESC,id LIMIT 1', [site.id]);
  let sourceCreated = false;
  if (!source) {
    source = upsertSource(db, {
      key: uniqueSourceKey(db, domain),
      name: payload.name || site.display_name,
      connector: 'jsonld',
      connectorVersion: connectorVersion('jsonld'),
      recipeVersion: 1,
      managedBy: 'ui',
      siteId: site.id,
      url: `https://${domain}`,
      enabled: true,
      checkIntervalSeconds: Number(payload.checkIntervalSeconds || 3600),
      config: { pages: [originalUrl] },
    });
    sourceCreated = true;
  } else if (!source.enabled) {
    db.run('UPDATE sources SET enabled=1,updated_at=? WHERE id=?', [now(), source.id]);
    source = db.get('SELECT * FROM sources WHERE id=?', [source.id]);
  }
  const seedResult = addSeedUrl(db, { siteId: site.id, sourceId: source.id, originalUrl, origin: 'ui' });
  db.run("UPDATE sites SET status='active',updated_at=? WHERE id=?", [now(), site.id]);
  return { site, source, seed: seedResult.seed, sourceCreated, seedCreated: seedResult.created };
}

export function setSourceEnabled(db, sourceId, enabled) {
  const source = db.get('SELECT * FROM sources WHERE id=?', [sourceId]);
  if (!source) throw new Error('找不到來源。');
  const ts = now();
  db.transaction(() => {
    db.run('UPDATE sources SET enabled=?,updated_at=? WHERE id=?', [enabled ? 1 : 0, ts, sourceId]);
    db.run('UPDATE seed_urls SET enabled=?,updated_at=? WHERE source_id=?', [enabled ? 1 : 0, ts, sourceId]);
    if (source.site_id) db.run(
      `UPDATE sites SET status=?,updated_at=? WHERE id=?`, [enabled ? 'active' : 'disabled', ts, source.site_id]
    );
  });
  return db.get('SELECT * FROM sources WHERE id=?', [sourceId]);
}

export async function testManagedSource(db, sourceId, deps = {}) {
  const source = db.get('SELECT * FROM sources WHERE id=?', [sourceId]);
  if (!source) throw new Error('找不到來源。');
  const hydrated = { ...source, config: sourceConfigWithSeeds(db, source) };
  const factory = deps.connectorFactory || createConnector;
  const connector = factory(hydrated, deps.httpDeps || {});
  const listings = await connector.fetchListings();
  return {
    ok: true,
    count: listings.length,
    items: listings.slice(0, 10).map((item) => ({
      title: item.title || '未提供商品名稱', url: item.url,
      model: item.model || extractModel(item.title), price: item.price ?? null,
      currency: item.currency || null,
    })),
  };
}

export function saveOnboardingSettings(db, settings) {
  const requestedRetention = Number(settings.dataRetentionDays);
  const dataRetentionDays = Number.isFinite(requestedRetention)
    ? Math.min(3650, Math.max(30, requestedRetention))
    : 365;
  const allowed = {
    language: ['zh-TW', 'ja', 'en'].includes(settings.language) ? settings.language : 'zh-TW',
    notification: ['app', 'telegram', 'windows'].includes(settings.notification) ? settings.notification : 'app',
    scanFrequency: ['balanced', 'frequent', 'gentle'].includes(settings.scanFrequency) ? settings.scanFrequency : 'balanced',
    dataRetentionDays,
    onboardingCompleted: true,
  };
  const ts = now();
  for (const [key, value] of Object.entries(allowed)) {
    db.run(
      `INSERT INTO user_settings (key,value_json,updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      [key, JSON.stringify(value), ts]
    );
  }
  return allowed;
}

export function readSettings(db) {
  return Object.fromEntries(db.all('SELECT key,value_json FROM user_settings').map((row) => [
    row.key, parseJson(row.value_json, null),
  ]));
}
