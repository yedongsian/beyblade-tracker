import { connectorVersion } from '../connectors/index.js';
import { processListing } from './pipeline.js';
import { canonicalizeSeedUrl, sourceKeyForDomain } from './site.js';
import { upsertSource } from './store.js';

const now = () => new Date().toISOString();

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function uniqueSourceKey(db, domain) {
  const base = sourceKeyForDomain(domain) || 'store';
  let key = base;
  let counter = 2;
  while (db.get('SELECT id FROM sources WHERE key=?', [key])) key = `${base}-${counter++}`;
  return key;
}

function ensureMonitoringSource(db, site) {
  let source = db.get('SELECT * FROM sources WHERE site_id=? ORDER BY enabled DESC,id LIMIT 1', [site.id]);
  if (!source) {
    source = upsertSource(db, {
      key: uniqueSourceKey(db, site.registrable_domain),
      name: site.display_name,
      connector: 'jsonld',
      connectorVersion: connectorVersion('jsonld'),
      recipeVersion: 1,
      managedBy: 'ui',
      siteId: site.id,
      url: `https://${site.registrable_domain}`,
      enabled: true,
      checkIntervalSeconds: 3600,
      config: { pages: [] },
    });
  } else if (!source.enabled) {
    db.run('UPDATE sources SET enabled=1,updated_at=? WHERE id=?', [now(), source.id]);
    source = db.get('SELECT * FROM sources WHERE id=?', [source.id]);
  }
  return source;
}

function addMonitoringSeed(db, siteId, sourceId, url) {
  const canonical = canonicalizeSeedUrl(url);
  const ts = now();
  db.run(
    `INSERT INTO seed_urls
      (site_id,source_id,original_url,canonical_url,origin,enabled,created_at,updated_at,purpose)
     VALUES (?,?,?,?, 'discovery',1,?,?, 'monitor')
     ON CONFLICT(site_id,canonical_url) DO UPDATE SET
       source_id=excluded.source_id,enabled=1,purpose='monitor',updated_at=excluded.updated_at`,
    [siteId, sourceId, url, canonical, ts, ts]
  );
}

export function listCandidates(db, { status = 'pending', limit = 200 } = {}) {
  const allowed = ['pending', 'deferred', 'approved', 'excluded', 'all'];
  const chosen = allowed.includes(status) ? status : 'pending';
  const rows = chosen === 'all'
    ? db.all(`SELECT c.*,si.display_name AS site_name,si.registrable_domain
        FROM product_candidates c JOIN sites si ON si.id=c.site_id
        ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END,
        c.confidence DESC,c.id DESC LIMIT ?`, [Math.min(500, Math.max(1, Number(limit) || 200))])
    : db.all(`SELECT c.*,si.display_name AS site_name,si.registrable_domain
        FROM product_candidates c JOIN sites si ON si.id=c.site_id WHERE c.status=?
        ORDER BY c.confidence DESC,c.id DESC LIMIT ?`,
      [chosen, Math.min(500, Math.max(1, Number(limit) || 200))]);
  return rows.map((row) => ({
    ...row,
    reasons: parseJson(row.reasons_json, []),
    listing: parseJson(row.listing_json, {}),
  }));
}

export function reviewCandidate(db, candidateId, action, options = {}) {
  const allowed = ['approve', 'exclude', 'defer', 'reopen'];
  if (!allowed.includes(action)) throw new Error('不支援的候選操作。');
  let candidate = db.get('SELECT * FROM product_candidates WHERE id=?', [candidateId]);
  if (!candidate) throw new Error('找不到候選商品。');
  if (action === 'approve' && candidate.status === 'approved') return candidate;
  const ts = now();
  if (action !== 'approve') {
    const status = { exclude: 'excluded', defer: 'deferred', reopen: 'pending' }[action];
    db.run(
      `UPDATE product_candidates SET status=?,review_note=?,reviewed_at=?,updated_at=? WHERE id=?`,
      [status, options.note || null, action === 'reopen' ? null : ts, ts, candidateId]
    );
    return db.get('SELECT * FROM product_candidates WHERE id=?', [candidateId]);
  }

  const site = db.get('SELECT * FROM sites WHERE id=?', [candidate.site_id]);
  if (!site) throw new Error('候選商品所屬商店不存在。');
  const source = ensureMonitoringSource(db, site);
  const listing = {
    ...parseJson(candidate.listing_json, {}),
    url: candidate.canonical_url,
    title: candidate.title,
    brand: candidate.brand || undefined,
    series: candidate.series || undefined,
    model: candidate.model || undefined,
    barcode: candidate.barcode || undefined,
    price: candidate.price ?? undefined,
    currency: candidate.currency || undefined,
    image: candidate.image || undefined,
    availabilityText: candidate.availability,
  };
  addMonitoringSeed(db, site.id, source.id, candidate.canonical_url);
  const result = processListing(db, source, listing, {
    preorderIsPurchasable: options.preorderIsPurchasable ?? false,
    eventCooldownSeconds: options.eventCooldownSeconds ?? 21600,
    priceChangeThreshold: options.priceChangeThreshold ?? 0.05,
  });
  if (result.excluded) throw new Error(`候選商品不符合追蹤規則：${result.reason}`);
  db.run(
    `UPDATE product_candidates SET source_id=?,status='approved',review_note=?,reviewed_at=?,
      product_id=?,offer_id=?,updated_at=? WHERE id=?`,
    [source.id, options.note || null, ts, result.productId, result.offerId, ts, candidateId]
  );
  db.run("UPDATE sites SET status='active',updated_at=? WHERE id=?", [ts, site.id]);
  candidate = db.get('SELECT * FROM product_candidates WHERE id=?', [candidateId]);
  return candidate;
}

export function reviewCandidates(db, ids, action, options = {}) {
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 200);
  if (!unique.length) throw new Error('請至少選擇一個候選商品。');
  const reviewed = [];
  db.transaction(() => {
    for (const id of unique) reviewed.push(reviewCandidate(db, id, action, options));
  });
  return reviewed;
}
