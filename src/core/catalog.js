import {
  detectTextLocale, extractModel, normalizeAlias, normalizeBarcode, normalizeSku, normalizeWhitespace,
} from './normalize.js';
import { STATES } from './classify.js';

const now = () => new Date().toISOString();
export const BEYBLADE_TAXONOMY = Object.freeze({
  brands: Object.freeze({
    'Takara Tomy': Object.freeze(['takara tomy', 'takaratomy', 'タカラトミー', '多美']),
  }),
  generations: Object.freeze({
    X: Object.freeze(['BX', 'UX', 'CX']),
  }),
  partTypes: Object.freeze(['blade', 'ratchet', 'bit', 'assist_blade']),
});

const X_SYSTEMS = new Set(BEYBLADE_TAXONOMY.generations.X);
const VALID_STATES = new Set(Object.values(STATES));

function json(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

export function catalogIdentity(listing) {
  const model = extractModel(listing.model || listing.title);
  if (!model) return null;
  const productSystem = model.split('-')[0];
  return {
    productCode: model,
    brand: /タカラトミー|takara\s*tomy|takaratomy|多美/i.test(`${listing.brand || ''} ${listing.title || ''}`)
      ? 'Takara Tomy' : (normalizeWhitespace(listing.brand) || 'Takara Tomy'),
    generation: X_SYSTEMS.has(productSystem) ? 'X' : null,
    productSystem,
  };
}

function sourceTypeFor(db, source) {
  if (!source?.site_id) return 'retailer';
  const registry = db.get('SELECT source_class FROM official_sources WHERE site_id=? ORDER BY id LIMIT 1',
    [source.site_id]);
  if (registry?.source_class) return registry.source_class;
  const site = db.get('SELECT registrable_domain FROM sites WHERE id=?', [source.site_id]);
  return site?.registrable_domain === 'takaratomymall.jp' ? 'official_store' : 'retailer';
}

function upsertEvidence(db, catalogProductId, listing, source, locale, verificationStatus) {
  const ts = now();
  const sourceUrl = listing.url;
  const sourceType = sourceTypeFor(db, source);
  db.run(
    `INSERT INTO catalog_evidence
      (entity_type,entity_id,source_url,source_type,locale,retrieved_at,confidence,
       verification_status,raw_summary_json,created_at,updated_at)
     VALUES ('product',?,?,?,?,?,?,?, ?,?,?)
     ON CONFLICT(entity_type,entity_id,source_url) DO UPDATE SET
       source_type=excluded.source_type,locale=excluded.locale,retrieved_at=excluded.retrieved_at,
       confidence=MAX(catalog_evidence.confidence,excluded.confidence),
       verification_status=CASE WHEN catalog_evidence.verification_status='verified' THEN 'verified'
         ELSE excluded.verification_status END,raw_summary_json=excluded.raw_summary_json,
       updated_at=excluded.updated_at`,
    [catalogProductId, sourceUrl, sourceType, locale, ts,
      sourceType === 'official_store' ? 0.98 : 0.85, verificationStatus,
      JSON.stringify(listing.rawSummary || {}), ts, ts]
  );
  return db.get(
    "SELECT * FROM catalog_evidence WHERE entity_type='product' AND entity_id=? AND source_url=?",
    [catalogProductId, sourceUrl]
  );
}

function upsertAlias(db, catalogProductId, title, locale, evidenceId, verificationStatus) {
  const alias = normalizeWhitespace(title);
  const normalized = normalizeAlias(alias);
  if (!normalized) return null;
  const ts = now();
  db.run(
    `INSERT INTO catalog_aliases
      (entity_type,entity_id,locale,alias,normalized_alias,alias_type,evidence_id,
       verification_status,created_at,updated_at)
     VALUES ('product',?,?,?,?, 'retailer_title',?,?,?,?)
     ON CONFLICT(entity_type,entity_id,locale,normalized_alias) DO UPDATE SET
       alias=excluded.alias,evidence_id=COALESCE(excluded.evidence_id,catalog_aliases.evidence_id),
       verification_status=CASE WHEN catalog_aliases.verification_status='verified' THEN 'verified'
         ELSE excluded.verification_status END,updated_at=excluded.updated_at`,
    [catalogProductId, locale, alias, normalized, evidenceId, verificationStatus, ts, ts]
  );
  return db.get(
    "SELECT * FROM catalog_aliases WHERE entity_type='product' AND entity_id=? AND locale=? AND normalized_alias=?",
    [catalogProductId, locale, normalized]
  );
}

export function queueTerminologyReview(db, {
  kind, rawValue, locale = detectTextLocale(rawValue), context = {}, suggestedValue = null,
}) {
  const raw = normalizeWhitespace(rawValue);
  const normalized = normalizeAlias(raw);
  if (!raw || !normalized) return null;
  const ts = now();
  db.run(
    `INSERT INTO terminology_review_queue
      (kind,raw_value,normalized_value,locale,context_json,suggested_value,status,
       first_seen_at,last_seen_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'pending',?,?,?,?)
     ON CONFLICT(kind,normalized_value,locale) DO UPDATE SET
       raw_value=excluded.raw_value,context_json=excluded.context_json,
       suggested_value=COALESCE(terminology_review_queue.suggested_value,excluded.suggested_value),
       last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
    [kind, raw, normalized, locale, JSON.stringify(context), suggestedValue, ts, ts, ts, ts]
  );
  return db.get(
    'SELECT * FROM terminology_review_queue WHERE kind=? AND normalized_value=? AND locale=?',
    [kind, normalized, locale]
  );
}

export function matchAvailabilityOverride(db, listing) {
  const raw = normalizeAlias([listing.availabilityText, listing.rawText].filter(Boolean).join(' '));
  if (!raw) return null;
  const overrides = db.all('SELECT * FROM availability_term_overrides ORDER BY LENGTH(normalized_term) DESC');
  const row = overrides.find((item) => raw.includes(item.normalized_term));
  return row ? { state: row.state, confidence: 0.75, locale: row.locale, term: row.normalized_term } : null;
}

export function linkProductToCatalog(db, product, listing, source) {
  const identity = catalogIdentity(listing);
  if (!identity) {
    if (/beyblade|ベイブレード|戰鬥陀螺|战斗陀螺/i.test(listing.title || '')) {
      queueTerminologyReview(db, {
        kind: 'catalog_identity', rawValue: listing.title,
        context: { productId: Number(product.id), sourceUrl: listing.url },
      });
    }
    return null;
  }

  const ts = now();
  const barcode = normalizeBarcode(listing.barcode);
  const sourceType = sourceTypeFor(db, source);
  const verificationStatus = sourceType === 'official_store' ? 'verified' : 'pending';
  db.run(
    `INSERT INTO catalog_products
      (product_code,brand,generation,product_system,series,barcode,release_date,
       verification_status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(product_code) DO UPDATE SET
       barcode=COALESCE(catalog_products.barcode,excluded.barcode),
       series=COALESCE(catalog_products.series,excluded.series),
       release_date=COALESCE(catalog_products.release_date,excluded.release_date),
       verification_status=CASE WHEN catalog_products.verification_status='verified' THEN 'verified'
         ELSE excluded.verification_status END,updated_at=excluded.updated_at`,
    [identity.productCode, identity.brand, identity.generation, identity.productSystem,
      listing.series || null, barcode, listing.releaseDate || null, verificationStatus, ts, ts]
  );
  const catalog = db.get('SELECT * FROM catalog_products WHERE product_code=?', [identity.productCode]);
  const locale = detectTextLocale(listing.title);
  const evidence = upsertEvidence(db, catalog.id, listing, source, locale, verificationStatus);
  upsertAlias(db, catalog.id, listing.title, locale, evidence.id, verificationStatus);
  db.run(
    `INSERT INTO product_catalog_links
      (product_id,catalog_product_id,match_method,confidence,reasons_json,
       verification_status,created_at,updated_at)
     VALUES (?,?,'model_exact',0.95,'["model_exact"]',?,?,?)
     ON CONFLICT(product_id) DO UPDATE SET catalog_product_id=excluded.catalog_product_id,
       match_method=excluded.match_method,confidence=excluded.confidence,
       reasons_json=excluded.reasons_json,
       verification_status=CASE WHEN product_catalog_links.verification_status='verified' THEN 'verified'
         ELSE excluded.verification_status END,updated_at=excluded.updated_at`,
    [product.id, catalog.id, verificationStatus, ts, ts]
  );
  db.run(`UPDATE products SET catalog_product_id=?,sku=COALESCE(sku,?),
    normalized_sku=COALESCE(normalized_sku,?),updated_at=? WHERE id=?`,
    [catalog.id, listing.sku || null, normalizeSku(listing.sku), ts, product.id]);
  return db.get('SELECT * FROM catalog_products WHERE id=?', [catalog.id]);
}

export function listCatalogProducts(db) {
  return db.all(`SELECT c.*,
    os.name AS official_source_name,os.source_class AS official_source_class,
    (SELECT COUNT(*) FROM catalog_aliases a WHERE a.entity_type='product' AND a.entity_id=c.id) alias_count,
    (SELECT COUNT(*) FROM catalog_evidence e WHERE e.entity_type='product' AND e.entity_id=c.id) evidence_count,
    (SELECT GROUP_CONCAT(a.locale || ':' || a.alias, ' | ') FROM catalog_aliases a
      WHERE a.entity_type='product' AND a.entity_id=c.id) aliases
    FROM catalog_products c LEFT JOIN official_sources os ON os.id=c.official_source_id
    ORDER BY c.product_system,c.product_code`);
}

export function upsertCatalogPart(db, {
  partType, code = null, canonicalName, verificationStatus = 'pending',
}) {
  const allowed = new Set(BEYBLADE_TAXONOMY.partTypes);
  if (!allowed.has(partType)) throw new Error('不支援的零件類型。');
  const name = normalizeWhitespace(canonicalName);
  if (!name) throw new Error('零件名稱不可空白。');
  const ts = now();
  db.run(
    `INSERT INTO catalog_parts
      (part_type,code,canonical_name,verification_status,created_at,updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(part_type,code,canonical_name) DO UPDATE SET
       verification_status=CASE WHEN catalog_parts.verification_status='verified' THEN 'verified'
         ELSE excluded.verification_status END,updated_at=excluded.updated_at`,
    [partType, code ? normalizeWhitespace(code) : null, name, verificationStatus, ts, ts]
  );
  return db.get(
    'SELECT * FROM catalog_parts WHERE part_type=? AND code IS ? AND canonical_name=?',
    [partType, code ? normalizeWhitespace(code) : null, name]
  );
}

export function linkCatalogPart(db, catalogProductId, catalogPartId, { quantity = 1, position = null } = {}) {
  const ts = now();
  db.run(
    `INSERT INTO catalog_product_parts
      (catalog_product_id,catalog_part_id,quantity,position,created_at)
     VALUES (?,?,?,?,?) ON CONFLICT(catalog_product_id,catalog_part_id) DO UPDATE SET
       quantity=excluded.quantity,position=excluded.position`,
    [catalogProductId, catalogPartId, Math.max(1, Number(quantity) || 1), position, ts]
  );
  return db.get(
    'SELECT * FROM catalog_product_parts WHERE catalog_product_id=? AND catalog_part_id=?',
    [catalogProductId, catalogPartId]
  );
}

export function backfillCatalog(db) {
  const rows = db.all(`SELECT p.*,o.url offer_url,o.title offer_title,o.availability_raw_text,
    s.id source_id,s.site_id,s.name source_name
    FROM products p
    JOIN offers o ON o.id=(SELECT id FROM offers WHERE product_id=p.id ORDER BY last_seen_at DESC,id DESC LIMIT 1)
    JOIN sources s ON s.id=o.source_id
    WHERE p.catalog_product_id IS NULL AND p.model IS NOT NULL`);
  let linked = 0;
  for (const row of rows) {
    const catalog = linkProductToCatalog(db, row, {
      url: row.offer_url, title: row.offer_title || row.name, model: row.model,
      brand: row.brand, series: row.series, barcode: row.barcode, sku: row.sku,
      releaseDate: row.release_date, availabilityText: row.availability_raw_text,
      rawSummary: { source: 'phase3-backfill' },
    }, { id: row.source_id, site_id: row.site_id, name: row.source_name });
    if (catalog) linked += 1;
  }
  return linked;
}

export function listTerminologyReviews(db, { status = 'pending' } = {}) {
  const allowed = new Set(['pending', 'approved', 'excluded', 'all']);
  const chosen = allowed.has(status) ? status : 'pending';
  const rows = chosen === 'all'
    ? db.all('SELECT * FROM terminology_review_queue ORDER BY id DESC LIMIT 200')
    : db.all('SELECT * FROM terminology_review_queue WHERE status=? ORDER BY id DESC LIMIT 200', [chosen]);
  return rows.map((row) => ({ ...row, context: json(row.context_json) }));
}

export function reviewTerminology(db, id, { action, value, note } = {}) {
  if (!['approve', 'exclude', 'reopen'].includes(action)) throw new Error('不支援的詞彙審核操作。');
  const row = db.get('SELECT * FROM terminology_review_queue WHERE id=?', [id]);
  if (!row) throw new Error('找不到待審核詞彙。');
  const ts = now();
  if (action === 'approve' && row.kind === 'availability') {
    if (!VALID_STATES.has(value)) throw new Error('請選擇有效的庫存狀態。');
    db.run(
      `INSERT INTO availability_term_overrides
        (locale,normalized_term,state,created_from_review_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT(locale,normalized_term) DO UPDATE SET
        state=excluded.state,created_from_review_id=excluded.created_from_review_id,
        updated_at=excluded.updated_at`,
      [row.locale, row.normalized_value, value, row.id, ts, ts]
    );
  }
  const status = action === 'approve' ? 'approved' : action === 'exclude' ? 'excluded' : 'pending';
  db.run(
    'UPDATE terminology_review_queue SET status=?,suggested_value=COALESCE(?,suggested_value),review_note=?,reviewed_at=?,updated_at=? WHERE id=?',
    [status, value || null, note || null, action === 'reopen' ? null : ts, ts, id]
  );
  return db.get('SELECT * FROM terminology_review_queue WHERE id=?', [id]);
}
