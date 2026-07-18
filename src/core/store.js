import { extractVariantKey, normalizeBarcode, normalizeSku } from './normalize.js';
import { ensureSourceMonitorSettings } from './monitor.js';

const now = () => new Date().toISOString();

// ---- sources -------------------------------------------------------------

export function upsertSource(db, def) {
  const ts = now();
  const existing = db.get('SELECT * FROM sources WHERE key = ?', [def.key]);
  const configJson = def.config ? JSON.stringify(stripSecrets(def.config)) : null;
  const connectorVersion = def.connectorVersion || '1.0.0';
  const recipeVersion = def.recipeVersion || 1;
  const managedBy = def.managedBy || def.managed_by || 'config';
  const siteId = def.siteId || def.site_id || null;
  if (existing) {
    db.run(
      `UPDATE sources SET name=?, connector=?, url=?, config_json=?, enabled=?,
        check_interval_seconds=?, connector_version=?, recipe_version=?, managed_by=?,
        site_id=COALESCE(?,site_id), updated_at=? WHERE id=?`,
      [
        def.name || def.key,
        def.connector,
        def.url || def.config?.url || null,
        configJson,
        def.enabled === false ? 0 : 1,
        def.checkIntervalSeconds || def.check_interval_seconds || 3600,
        connectorVersion,
        recipeVersion,
        managedBy,
        siteId,
        ts,
        existing.id,
      ]
    );
    const row = db.get('SELECT * FROM sources WHERE id = ?', [existing.id]);
    ensureSourceMonitorSettings(db, row);
    return row;
  }
  const info = db.run(
    `INSERT INTO sources (key, name, connector, url, config_json, enabled,
      check_interval_seconds, connector_version, recipe_version, managed_by, site_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      def.key,
      def.name || def.key,
      def.connector,
      def.url || def.config?.url || null,
      configJson,
      def.enabled === false ? 0 : 1,
      def.checkIntervalSeconds || def.check_interval_seconds || 3600,
      connectorVersion,
      recipeVersion,
      managedBy,
      siteId,
      ts,
      ts,
    ]
  );
  const row = db.get('SELECT * FROM sources WHERE id = ?', [info.lastInsertRowid]);
  ensureSourceMonitorSettings(db, row);
  return row;
}

/** Marks work left running by an unclean shutdown as interrupted. */
export function recoverInterruptedCrawlRuns(db) {
  const message = '服務上次未正常結束；此工作已在下次啟動時標記為中斷。';
  const result = db.run(
    `UPDATE crawl_runs SET status='failed', finished_at=?, error=?
     WHERE status='running' AND finished_at IS NULL`,
    [now(), message]
  );
  return Number(result.changes || 0);
}

/**
 * Disable sources whose key is no longer present in a valid config. Only call
 * this when the config parsed cleanly: a missing/malformed config must never
 * disable everything. Returns the number of sources disabled.
 */
export function pruneStaleSources(db, activeKeys) {
  const keep = new Set(activeKeys);
  const enabled = db.all("SELECT id, key FROM sources WHERE enabled = 1 AND managed_by = 'config'");
  let disabled = 0;
  for (const s of enabled) {
    if (!keep.has(s.key)) {
      db.run('UPDATE sources SET enabled = 0, updated_at = ? WHERE id = ?', [now(), s.id]);
      disabled += 1;
    }
  }
  return disabled;
}

// Never persist tokens/webhooks even if a user mistakenly puts them here.
function stripSecrets(config) {
  const clone = { ...config };
  for (const k of Object.keys(clone)) {
    if (/token|secret|webhook|password|apikey|api_key/i.test(k)) delete clone[k];
  }
  return clone;
}

export function recordCrawlSuccess(db, sourceId) {
  db.run(
    `UPDATE sources SET last_success_at=?, last_error=NULL, consecutive_failures=0, updated_at=? WHERE id=?`,
    [now(), now(), sourceId]
  );
}

export function recordCrawlFailure(db, sourceId, error) {
  const short = String(error).slice(0, 500);
  db.run(
    `UPDATE sources SET last_failure_at=?, last_error=?,
      consecutive_failures=consecutive_failures+1, updated_at=? WHERE id=?`,
    [now(), short, now(), sourceId]
  );
}

// ---- crawl runs ----------------------------------------------------------

export function startCrawlRun(db, source) {
  const info = db.run(
    `INSERT INTO crawl_runs (source_id, source_key, started_at, status) VALUES (?, ?, ?, 'running')`,
    [source.id, source.key, now()]
  );
  return info.lastInsertRowid;
}

export function finishCrawlRun(db, runId, patch) {
  db.run(
    `UPDATE crawl_runs SET finished_at=?, status=?, items_seen=?, items_excluded=?,
      events_created=?, error=? WHERE id=?`,
    [
      now(),
      patch.status,
      patch.itemsSeen || 0,
      patch.itemsExcluded || 0,
      patch.eventsCreated || 0,
      patch.error ? String(patch.error).slice(0, 500) : null,
      runId,
    ]
  );
}

// ---- products (merge) ----------------------------------------------------

/**
 * Find an existing product to merge into, or create a new one.
 * Merge priority: barcode > normalized SKU > model with compatible variant
 * evidence. Title alone never forces a merge.
 */
export function findOrCreateProduct(db, listing) {
  const ts = now();
  const barcode = normalizeBarcode(listing.barcode);
  const normalizedSku = normalizeSku(listing.sku);
  const model = listing.model || null;
  const variantKey = listing.variantKey ?? extractVariantKey(listing.title, listing.rawText);

  const brandCompatible = (candidate) => !listing.brand || !candidate.brand ||
    candidate.brand.toLocaleLowerCase('en-US') === String(listing.brand).toLocaleLowerCase('en-US');
  const modelCompatible = (candidate) => !model || !candidate.model || candidate.model === model;
  const skuCompatible = (candidate) => !normalizedSku || !candidate.normalized_sku ||
    candidate.normalized_sku === normalizedSku;

  let product = null;
  if (barcode) {
    product = db.get('SELECT * FROM products WHERE barcode = ?', [barcode]);
  }
  if (!product && normalizedSku) {
    const candidates = db.all('SELECT * FROM products WHERE normalized_sku = ?', [normalizedSku])
      .filter((candidate) => modelCompatible(candidate) && brandCompatible(candidate));
    if (candidates.length === 1) product = candidates[0];
  }
  if (!product && model) {
    // Conflicting SKUs or explicit variants make a model-only merge unsafe.
    const candidates = db.all('SELECT * FROM products WHERE model = ?', [model])
      .filter((candidate) => (candidate.variant_key || null) === (variantKey || null))
      .filter(skuCompatible);
    if (candidates.length === 1) {
      product = brandCompatible(candidates[0]) ? candidates[0] : null;
    } else if (candidates.length > 1 && listing.brand) {
      const branded = candidates.filter(brandCompatible);
      if (branded.length === 1) product = branded[0];
    }
  }

  if (product) {
    // Enrich missing fields without overwriting existing ones.
    const patch = {};
    if (!product.barcode && barcode) patch.barcode = barcode;
    if (!product.sku && listing.sku) patch.sku = String(listing.sku);
    if (!product.normalized_sku && normalizedSku) patch.normalized_sku = normalizedSku;
    if (!product.variant_key && variantKey) patch.variant_key = variantKey;
    if (!product.model && model) patch.model = model;
    if (!product.brand && listing.brand) patch.brand = listing.brand;
    if (!product.series && listing.series) patch.series = listing.series;
    if (!product.image && listing.image) patch.image = listing.image;
    if (!product.release_date && listing.releaseDate) patch.release_date = listing.releaseDate;
    if (Object.keys(patch).length) {
      const cols = Object.keys(patch);
      db.run(
        `UPDATE products SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`,
        [...cols.map((c) => patch[c]), ts, product.id]
      );
      product = db.get('SELECT * FROM products WHERE id = ?', [product.id]);
    }
    return { product, created: false };
  }

  const info = db.run(
    `INSERT INTO products
      (name, brand, series, model, barcode, sku, normalized_sku, variant_key,
       release_date, image, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      listing.title || model || barcode || 'Unknown product',
      listing.brand || null,
      listing.series || null,
      model,
      barcode,
      listing.sku || null,
      normalizedSku,
      variantKey,
      listing.releaseDate || null,
      listing.image || null,
      ts,
      ts,
    ]
  );
  return { product: db.get('SELECT * FROM products WHERE id = ?', [info.lastInsertRowid]), created: true };
}

export function recordListingExclusion(db, sourceId, listing, reason, crawlRunId = null) {
  const ts = now();
  const url = String(listing.url || '').slice(0, 2048);
  const summary = JSON.stringify({
    availabilityText: listing.availabilityText || null,
    availabilityRaw: listing.availabilityRaw || null,
    rawSummary: listing.rawSummary || null,
  }).slice(0, 12000);
  db.run(
    `INSERT INTO listing_exclusions
      (source_id,crawl_run_id,url,title,reason,raw_summary_json,occurrence_count,
       first_seen_at,last_seen_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,1,?,?,?,?)
     ON CONFLICT(source_id,url,reason) DO UPDATE SET
       crawl_run_id=excluded.crawl_run_id,title=excluded.title,
       raw_summary_json=excluded.raw_summary_json,
       occurrence_count=listing_exclusions.occurrence_count+1,
       last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
    [sourceId, crawlRunId, url, listing.title || null, reason, summary, ts, ts, ts, ts]
  );
  return db.get('SELECT * FROM listing_exclusions WHERE source_id=? AND url=? AND reason=?',
    [sourceId, url, reason]);
}

// ---- offers --------------------------------------------------------------

export function findOffer(db, sourceId, url) {
  return db.get('SELECT * FROM offers WHERE source_id = ? AND url = ?', [sourceId, url]);
}

export function insertOffer(db, {
  productId, sourceId, url, title, price, currency, availability, confidence, purchasable,
  availabilityRawText, availabilityLocale, priceTaxIncluded,
}) {
  const ts = now();
  const info = db.run(
    `INSERT INTO offers (product_id, source_id, url, title, price, currency, availability,
      confidence, purchasable, availability_raw_text, availability_locale, price_tax_included,
      first_seen_at, last_seen_at, last_changed_at, last_stable_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, sourceId, url, title || null, price ?? null, currency || null,
     availability, confidence, purchasable ? 1 : 0, availabilityRawText || null,
     availabilityLocale || null, priceTaxIncluded == null ? null : (priceTaxIncluded ? 1 : 0),
     ts, ts, ts, ts, ts, ts]
  );
  return db.get('SELECT * FROM offers WHERE id = ?', [info.lastInsertRowid]);
}

export function updateOffer(db, id, patch, { changed }) {
  const ts = now();
  db.run(
    `UPDATE offers SET title=?, price=?, currency=?, availability=?, confidence=?,
      purchasable=?, availability_raw_text=?, availability_locale=?, price_tax_included=?,
      availability_candidate=?, availability_candidate_count=?,
      last_seen_at=?, last_changed_at=?, last_stable_at=?, updated_at=? WHERE id=?`,
    [
      patch.title ?? null,
      patch.price ?? null,
      patch.currency || null,
      patch.availability,
      patch.confidence,
      patch.purchasable ? 1 : 0,
      patch.availabilityRawText || null,
      patch.availabilityLocale || null,
      patch.priceTaxIncluded == null ? null : (patch.priceTaxIncluded ? 1 : 0),
      patch.availabilityCandidate || null,
      Number(patch.availabilityCandidateCount || 0),
      ts,
      changed ? ts : patch.last_changed_at,
      changed ? ts : (patch.last_stable_at || patch.last_changed_at),
      ts,
      id,
    ]
  );
  return db.get('SELECT * FROM offers WHERE id = ?', [id]);
}

// ---- observations --------------------------------------------------------

export function insertObservation(db, { offerId, crawlRunId, price, currency, availability, confidence, rawSummary }) {
  db.run(
    `INSERT INTO observations (offer_id, crawl_run_id, price, currency, availability, confidence, raw_summary, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [offerId, crawlRunId || null, price ?? null, currency || null, availability, confidence,
     rawSummary ? JSON.stringify(rawSummary).slice(0, 2000) : null, now()]
  );
}

// ---- events --------------------------------------------------------------

/**
 * Create an event unless an identical (offer,type) event was created within
 * the cooldown window. Returns the event row or null when suppressed.
 */
export function createEvent(db, evt, { cooldownSeconds = 0 } = {}) {
  if (evt.offerId && cooldownSeconds > 0) {
    const cutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
    const recent = db.get(
      `SELECT id FROM events WHERE offer_id = ? AND type = ? AND created_at >= ? ORDER BY id DESC LIMIT 1`,
      [evt.offerId, evt.type, cutoff]
    );
    if (recent) return null;
  }
  const info = db.run(
    `INSERT INTO events (product_id, offer_id, source_id, type, from_state, to_state, price, currency, message, notified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      evt.productId,
      evt.offerId || null,
      evt.sourceId || null,
      evt.type,
      evt.fromState || null,
      evt.toState || null,
      evt.price ?? null,
      evt.currency || null,
      evt.message || null,
      now(),
    ]
  );
  return db.get('SELECT * FROM events WHERE id = ?', [info.lastInsertRowid]);
}
