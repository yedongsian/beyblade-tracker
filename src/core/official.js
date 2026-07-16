import { canonicalizeSeedUrl } from './site.js';
import {
  detectTextLocale, extractModel, normalizeAlias, normalizeBarcode, normalizeWhitespace,
} from './normalize.js';
import { evaluateWatchlistsForAnnouncement } from './watchlist.js';

const now = () => new Date().toISOString();
export const TAKARA_MALL_SEED = 'https://takaratomymall.jp/shop/c/cBeyX/?wovn=english';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function ensureOfficialSite(db, domain, name) {
  let site = db.get('SELECT * FROM sites WHERE registrable_domain=?', [domain]);
  if (site) return site;
  const ts = now();
  const info = db.run("INSERT INTO sites (registrable_domain,display_name,status,created_at,updated_at) VALUES (?,?,'active',?,?)",
    [domain, name, ts, ts]);
  return db.get('SELECT * FROM sites WHERE id=?', [info.lastInsertRowid]);
}

function ensureOfficialDiscoverySettings(db, siteId) {
  const ts = now();
  db.run(`INSERT INTO discovery_settings
    (site_id,enabled,interval_seconds,max_pages,max_depth,max_seconds,max_bytes,max_browser_pages,
     concurrency,min_interval_ms,next_run_at,created_at,updated_at)
    VALUES (?,0,86400,100,2,300,52428800,3,2,1000,NULL,?,?)
    ON CONFLICT(site_id) DO NOTHING`, [siteId, ts, ts]);
}

export function registerDefaultOfficialSources(db) {
  const ts = now();
  const domain = 'takaratomymall.jp';
  const site = ensureOfficialSite(db, domain, 'Takara Tomy Mall');
  db.run(
    `INSERT INTO official_sources
      (site_id,key,name,source_class,base_url,registrable_domain,feed_kind,feed_priority_json,
       verification_status,enabled,metadata_json,created_at,updated_at)
     VALUES (?,'takara-tomy-mall','Takara Tomy Mall','official_store',?,?, 'sitemap',?,
       'verified',0,?,?,?) ON CONFLICT(key) DO UPDATE SET site_id=excluded.site_id,
       base_url=excluded.base_url,feed_priority_json=excluded.feed_priority_json,
       metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`,
    [site.id, `https://${domain}`, domain,
      JSON.stringify(['api', 'rss', 'sitemap', 'product_list', 'html']),
      JSON.stringify({
        role: 'official_store', languageParameter: 'wovn', languageParameterAffectsIdentity: false,
        catalogRole: 'official_product_evidence', stockRole: 'store_offer',
      }), ts, ts]
  );
  const official = db.get("SELECT * FROM official_sources WHERE key='takara-tomy-mall'");
  const canonical = canonicalizeSeedUrl(TAKARA_MALL_SEED);
  db.run(
    `INSERT INTO seed_urls
      (site_id,source_id,original_url,canonical_url,origin,enabled,created_at,updated_at,purpose)
     VALUES (?,NULL,?,?, 'official_registry',0,?,?, 'discovery')
     ON CONFLICT(site_id,canonical_url) DO UPDATE SET original_url=excluded.original_url,
       origin='official_registry',updated_at=excluded.updated_at`,
    [site.id, TAKARA_MALL_SEED, canonical, ts, ts]
  );
  ensureOfficialDiscoverySettings(db, site.id);
  const recipe = {
    includeTerms: ['beyblade', 'beyx', 'BX-', 'UX-', 'CX-', '/shop/g/', '/shop/c/'],
    excludeTerms: ['中古', 'used', 'parts-only', 'repair'],
    discoveryOrder: ['robots', 'sitemap', 'category', 'new_arrivals', 'restock', 'pagination', 'product_detail'],
    categoryPaths: ['/shop/c/cBeyX/'], productPathPattern: '/shop/g/g',
    displayLanguageParams: ['wovn'], identityIgnoredParams: ['wovn'],
  };
  db.run(
    `INSERT INTO site_recipes (site_id,version,status,config_json,created_at,updated_at)
     VALUES (?,1,'suggested',?,?,?) ON CONFLICT(site_id) DO UPDATE SET
       config_json=excluded.config_json,status=CASE WHEN site_recipes.status='active' THEN 'active' ELSE 'suggested' END,
       updated_at=excluded.updated_at`,
    [site.id, JSON.stringify(recipe), ts, ts]
  );
  if (!db.get('SELECT id FROM official_scan_previews WHERE official_source_id=?', [official.id])) {
    db.run(
      `INSERT INTO official_scan_previews
        (official_source_id,seed_url,estimated_products,scope_json,exclusions_json,budget_json,status,created_at,updated_at)
       VALUES (?,?,100,?,?,?,'pending',?,?)`,
      [official.id, TAKARA_MALL_SEED,
        JSON.stringify({ domain, categories: ['BEYBLADE X', '新品', '補貨', '商品詳情'], sameSiteOnly: true }),
        JSON.stringify(['二手', '拆售零件', '非 Beyblade 商品', '登入／排隊／拒絕存取頁']),
        JSON.stringify({ maxPages: 100, maxDepth: 2, maxSeconds: 300, maxMb: 50, minIntervalMs: 1000 }), ts, ts]
    );
  }
  return { official, site, preview: latestOfficialPreview(db, official.id) };
}

export function latestOfficialPreview(db, officialSourceId) {
  const row = db.get('SELECT * FROM official_scan_previews WHERE official_source_id=? ORDER BY id DESC LIMIT 1',
    [officialSourceId]);
  return row ? {
    ...row, scope: parseJson(row.scope_json), exclusions: parseJson(row.exclusions_json, []),
    budget: parseJson(row.budget_json),
  } : null;
}

export function listOfficialSources(db) {
  return db.all(`SELECT os.*,si.display_name site_name,si.status site_status,
    (SELECT COUNT(*) FROM official_announcements a WHERE a.official_source_id=os.id) announcement_count
    FROM official_sources os LEFT JOIN sites si ON si.id=os.site_id ORDER BY os.id`).map((row) => ({
      ...row, feedPriority: parseJson(row.feed_priority_json, []), metadata: parseJson(row.metadata_json),
      preview: latestOfficialPreview(db, row.id),
    }));
}

export function confirmOfficialPreview(db, officialSourceId) {
  const source = db.get('SELECT * FROM official_sources WHERE id=?', [officialSourceId]);
  if (!source) throw new Error('找不到官方來源。');
  const preview = latestOfficialPreview(db, officialSourceId);
  if (!preview) throw new Error('找不到待確認的掃描預覽。');
  const ts = now();
  db.transaction(() => {
    db.run("UPDATE official_scan_previews SET status='confirmed',confirmed_at=?,updated_at=? WHERE id=?",
      [ts, ts, preview.id]);
    db.run('UPDATE official_sources SET enabled=1,updated_at=? WHERE id=?', [ts, officialSourceId]);
    db.run("UPDATE seed_urls SET enabled=1,updated_at=? WHERE site_id=? AND origin='official_registry'", [ts, source.site_id]);
    db.run('UPDATE discovery_settings SET enabled=1,next_run_at=?,updated_at=? WHERE site_id=?', [ts, ts, source.site_id]);
    db.run("UPDATE site_recipes SET status='active',updated_at=? WHERE site_id=?", [ts, source.site_id]);
  });
  return { source: db.get('SELECT * FROM official_sources WHERE id=?', [officialSourceId]), preview: latestOfficialPreview(db, officialSourceId) };
}

function queueLowConfidenceOfficial(db, source, item, canonicalUrl, reason) {
  const ts = now();
  db.run(
    `INSERT INTO product_candidates
      (site_id,canonical_url,title,brand,model,barcode,price,currency,availability,image,
       confidence,reasons_json,discovery_method,listing_json,status,first_discovered_at,
       last_discovered_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,? ,?,?,?,'official_feed',?,'pending',?,?,?,?)
     ON CONFLICT(site_id,canonical_url) DO UPDATE SET title=excluded.title,
       confidence=excluded.confidence,reasons_json=excluded.reasons_json,
       listing_json=excluded.listing_json,last_discovered_at=excluded.last_discovered_at,
       updated_at=excluded.updated_at`,
    [source.site_id, canonicalUrl, normalizeWhitespace(item.title) || '未命名官方商品',
      item.brand || 'Takara Tomy', extractModel(item.model || item.title), normalizeBarcode(item.barcode),
      item.msrp ?? null, item.currency || 'JPY', 'unknown', item.image || null, 0.55,
      JSON.stringify([reason]), JSON.stringify(item).slice(0, 12000), ts, ts, ts, ts]
  );
  return db.get('SELECT * FROM product_candidates WHERE site_id=? AND canonical_url=?', [source.site_id, canonicalUrl]);
}

function upsertOfficialAliasAndEvidence(db, source, catalog, item, canonicalUrl) {
  const ts = now();
  db.run(
    `INSERT INTO catalog_evidence
      (entity_type,entity_id,source_url,source_type,locale,retrieved_at,confidence,
       verification_status,raw_summary_json,created_at,updated_at)
     VALUES ('product',?,?,?,?,?,0.99,'verified',?,?,?)
     ON CONFLICT(entity_type,entity_id,source_url) DO UPDATE SET retrieved_at=excluded.retrieved_at,
       confidence=excluded.confidence,verification_status='verified',raw_summary_json=excluded.raw_summary_json,
       updated_at=excluded.updated_at`,
    [catalog.id, canonicalUrl, source.source_class, item.locale || detectTextLocale(item.title), ts,
      JSON.stringify({ officialSourceId: source.id, externalId: item.externalId || null }), ts, ts]
  );
  const evidence = db.get("SELECT id FROM catalog_evidence WHERE entity_type='product' AND entity_id=? AND source_url=?",
    [catalog.id, canonicalUrl]);
  const alias = normalizeWhitespace(item.title);
  db.run(
    `INSERT INTO catalog_aliases
      (entity_type,entity_id,locale,alias,normalized_alias,alias_type,evidence_id,
       verification_status,created_at,updated_at)
     VALUES ('product',?,?,?,?, 'official_title',?,'verified',?,?)
     ON CONFLICT(entity_type,entity_id,locale,normalized_alias) DO UPDATE SET
       alias=excluded.alias,alias_type='official_title',evidence_id=excluded.evidence_id,
       verification_status='verified',updated_at=excluded.updated_at`,
    [catalog.id, item.locale || detectTextLocale(alias), alias, normalizeAlias(alias), evidence.id, ts, ts]
  );
}

export function upsertOfficialCatalogItem(db, officialSourceKey, item = {}) {
  const source = db.get('SELECT * FROM official_sources WHERE key=?', [officialSourceKey]);
  if (!source) throw new Error('官方來源尚未登錄。');
  const canonicalUrl = canonicalizeSeedUrl(item.url || source.base_url);
  const productCode = extractModel(item.productCode || item.model || item.title);
  if (!productCode || !normalizeWhitespace(item.title)) {
    return { status: 'review', candidate: queueLowConfidenceOfficial(db, source, item, canonicalUrl, '官方資料缺少可驗證商品號或標題') };
  }
  const barcode = normalizeBarcode(item.barcode);
  const existing = db.get('SELECT * FROM catalog_products WHERE product_code=?', [productCode]);
  const conflict = existing?.verification_status === 'conflict' ||
    Boolean(existing?.barcode && barcode && existing.barcode !== barcode);
  const ts = now();
  db.run(
    `INSERT INTO catalog_products
      (product_code,brand,generation,product_system,series,barcode,release_date,verification_status,
       image,msrp,msrp_currency,official_updated_at,official_source_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,? ,?,?,?,?,?,?,?)
     ON CONFLICT(product_code) DO UPDATE SET
       brand=excluded.brand,series=COALESCE(excluded.series,catalog_products.series),
       barcode=CASE WHEN catalog_products.barcode IS NULL THEN excluded.barcode ELSE catalog_products.barcode END,
       release_date=COALESCE(excluded.release_date,catalog_products.release_date),
       image=COALESCE(excluded.image,catalog_products.image),msrp=COALESCE(excluded.msrp,catalog_products.msrp),
       msrp_currency=COALESCE(excluded.msrp_currency,catalog_products.msrp_currency),
       official_updated_at=excluded.official_updated_at,official_source_id=excluded.official_source_id,
       verification_status=excluded.verification_status,updated_at=excluded.updated_at`,
    [productCode, item.brand || 'Takara Tomy', 'X', productCode.split('-')[0], item.series || null,
      barcode, item.releaseDate || null, conflict ? 'conflict' : 'verified', item.image || null,
      item.msrp ?? null, item.currency || 'JPY', item.updatedAt || item.publishedAt || ts, source.id, ts, ts]
  );
  const catalog = db.get('SELECT * FROM catalog_products WHERE product_code=?', [productCode]);
  upsertOfficialAliasAndEvidence(db, source, catalog, item, canonicalUrl);
  return { status: conflict ? 'conflict' : 'verified', catalog, source, canonicalUrl };
}

export function importOfficialItem(db, officialSourceKey, item = {}) {
  const catalogResult = upsertOfficialCatalogItem(db, officialSourceKey, item);
  if (catalogResult.status === 'review') return catalogResult;
  const { source, catalog, canonicalUrl } = catalogResult;
  const productCode = catalog.product_code;
  const ts = now();
  db.run(
    `INSERT INTO official_announcements
      (official_source_id,catalog_product_id,external_id,canonical_url,title,locale,product_code,
       event_type,published_at,source_updated_at,release_date,msrp,currency,image,summary,raw_json,
       created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(official_source_id,canonical_url,event_type) DO UPDATE SET
       catalog_product_id=excluded.catalog_product_id,title=excluded.title,
       source_updated_at=excluded.source_updated_at,release_date=excluded.release_date,
       msrp=excluded.msrp,currency=excluded.currency,image=excluded.image,summary=excluded.summary,
       raw_json=excluded.raw_json,updated_at=excluded.updated_at`,
    [source.id, catalog.id, item.externalId || null, canonicalUrl, normalizeWhitespace(item.title),
      item.locale || detectTextLocale(item.title), productCode, item.eventType || 'announced',
      item.publishedAt || null, item.updatedAt || null, item.releaseDate || null, item.msrp ?? null,
      item.currency || 'JPY', item.image || null, item.summary || null, JSON.stringify(item).slice(0, 12000), ts, ts]
  );
  const announcement = db.get(
    'SELECT * FROM official_announcements WHERE official_source_id=? AND canonical_url=? AND event_type=?',
    [source.id, canonicalUrl, item.eventType || 'announced']
  );
  const alerts = evaluateWatchlistsForAnnouncement(db, announcement);
  return { status: catalogResult.status, catalog, announcement, alerts };
}

export function listOfficialAnnouncements(db, { limit = 100 } = {}) {
  return db.all(`SELECT a.*,os.name source_name,os.source_class,cp.verification_status
    FROM official_announcements a JOIN official_sources os ON os.id=a.official_source_id
    LEFT JOIN catalog_products cp ON cp.id=a.catalog_product_id
    ORDER BY COALESCE(a.published_at,a.created_at) DESC,a.id DESC LIMIT ?`,
  [Math.min(500, Math.max(1, Number(limit) || 100))]);
}
