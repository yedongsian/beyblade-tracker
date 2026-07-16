import {
  detectTextLocale, extractModel, normalizeAlias, normalizeBarcode, normalizeWhitespace,
} from './normalize.js';

const now = () => new Date().toISOString();
export const WATCHLIST_EVENT_TYPES = Object.freeze([
  'official_announcement', 'preorder_open', 'release', 'in_stock', 'price_anomaly',
]);

function parseJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function termList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((item) => normalizeWhitespace(item)).filter(Boolean))].slice(0, 20);
}

function normalizeMode(value) {
  return ['exact', 'contains', 'regex'].includes(value) ? value : 'exact';
}

function validateRegexTerms(terms) {
  for (const term of terms) {
    if (term.length > 120) throw new Error('正規表示式不可超過 120 個字元。');
    try { new RegExp(term, 'iu'); } catch { throw new Error(`無效的正規表示式：${term}`); }
  }
}

export function createWatchlist(db, payload = {}) {
  const targetType = ['rule', 'catalog_product', 'catalog_part'].includes(payload.targetType)
    ? payload.targetType : 'rule';
  const matchMode = normalizeMode(payload.matchMode);
  const keywords = termList(payload.keywords);
  const excludes = termList(payload.excludeTerms);
  if (matchMode === 'regex') validateRegexTerms(keywords);
  const productCode = extractModel(payload.productCode) || null;
  const model = extractModel(payload.model) || null;
  const barcode = normalizeBarcode(payload.barcode) || null;
  const catalogProductId = targetType === 'catalog_product' ? Number(payload.catalogProductId) : null;
  const catalogPartId = targetType === 'catalog_part' ? Number(payload.catalogPartId) : null;
  if (catalogProductId && !db.get('SELECT id FROM catalog_products WHERE id=?', [catalogProductId])) {
    throw new Error('找不到指定的 Catalog 商品。');
  }
  if (catalogPartId && !db.get('SELECT id FROM catalog_parts WHERE id=?', [catalogPartId])) {
    throw new Error('找不到指定的 Catalog 零件。');
  }
  if (!catalogProductId && !catalogPartId && !productCode && !model && !barcode && !keywords.length) {
    throw new Error('請至少輸入商品號、型號、條碼、關鍵字或選擇 Catalog 項目。');
  }
  const ts = now();
  const info = db.run(
    `INSERT INTO watchlists
      (name,target_type,catalog_product_id,catalog_part_id,product_code,model,barcode,
       keywords_json,exclude_terms_json,locale,match_mode,synonym_expansion,enabled,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [normalizeWhitespace(payload.name) || productCode || model || barcode || keywords[0], targetType,
      catalogProductId || null, catalogPartId || null, productCode, model, barcode,
      JSON.stringify(keywords), JSON.stringify(excludes),
      ['any', 'zh-TW', 'ja', 'en'].includes(payload.locale) ? payload.locale : 'any',
      matchMode, payload.synonymExpansion === false ? 0 : 1, ts, ts]
  );
  const enabledEvents = Array.isArray(payload.notificationEvents)
    ? new Set(payload.notificationEvents) : new Set(WATCHLIST_EVENT_TYPES);
  for (const eventType of WATCHLIST_EVENT_TYPES) {
    db.run('INSERT INTO watchlist_notification_preferences (watchlist_id,event_type,enabled) VALUES (?,?,?)',
      [info.lastInsertRowid, eventType, enabledEvents.has(eventType) ? 1 : 0]);
  }
  const watchlistId = Number(info.lastInsertRowid);
  const products = db.all(`SELECT p.id,p.catalog_product_id,o.id offer_id,o.availability,o.freshness_status
    FROM products p LEFT JOIN offers o ON o.id=(SELECT id FROM offers WHERE product_id=p.id
      AND archived_at IS NULL ORDER BY last_seen_at DESC,id DESC LIMIT 1)`);
  for (const product of products) {
    const freshBuyable = product.freshness_status === 'fresh' &&
      ['in_stock', 'preorder'].includes(product.availability);
    evaluateWatchlistsForProduct(db, {
      productId: product.id, catalogProductId: product.catalog_product_id,
      offerId: product.offer_id, state: product.availability,
      events: freshBuyable ? [{ id: `initial-${watchlistId}-${product.offer_id}`, type: 'product_discovered' }] : [],
      watchlistIds: [watchlistId],
    });
  }
  for (const announcement of db.all('SELECT * FROM official_announcements ORDER BY id')) {
    evaluateWatchlistsForAnnouncement(db, announcement, { watchlistIds: [watchlistId] });
  }
  return getWatchlist(db, watchlistId);
}

export function getWatchlist(db, id) {
  const row = db.get(`SELECT w.*,cp.product_code AS selected_product_code,
    cpart.canonical_name AS selected_part_name FROM watchlists w
    LEFT JOIN catalog_products cp ON cp.id=w.catalog_product_id
    LEFT JOIN catalog_parts cpart ON cpart.id=w.catalog_part_id WHERE w.id=?`, [id]);
  if (!row) return null;
  return {
    ...row, keywords: parseJson(row.keywords_json), excludeTerms: parseJson(row.exclude_terms_json),
    notificationEvents: db.all('SELECT event_type FROM watchlist_notification_preferences WHERE watchlist_id=? AND enabled=1', [id])
      .map((item) => item.event_type),
  };
}

export function listWatchlists(db) {
  return db.all('SELECT id FROM watchlists ORDER BY enabled DESC,id DESC').map((row) => getWatchlist(db, row.id));
}

export function setWatchlistEnabled(db, id, enabled) {
  const result = db.run('UPDATE watchlists SET enabled=?,updated_at=? WHERE id=?', [enabled ? 1 : 0, now(), id]);
  if (!result.changes) throw new Error('找不到 Watchlist。');
  return getWatchlist(db, id);
}

export function deleteWatchlist(db, id) {
  const result = db.run('DELETE FROM watchlists WHERE id=?', [id]);
  if (!result.changes) throw new Error('找不到 Watchlist。');
  return { id, deleted: true };
}

function productContext(db, { productId = null, catalogProductId = null, listing = null } = {}) {
  const product = productId ? db.get('SELECT * FROM products WHERE id=?', [productId]) : null;
  const catalogId = catalogProductId || product?.catalog_product_id || null;
  const catalog = catalogId ? db.get('SELECT * FROM catalog_products WHERE id=?', [catalogId]) : null;
  const aliases = catalogId ? db.all(
    "SELECT alias FROM catalog_aliases WHERE entity_type='product' AND entity_id=?", [catalogId]
  ).map((row) => row.alias) : [];
  const parts = catalogId ? db.all(`SELECT cp.id,cp.code,cp.canonical_name FROM catalog_parts cp
    JOIN catalog_product_parts link ON link.catalog_part_id=cp.id WHERE link.catalog_product_id=?`, [catalogId]) : [];
  const title = listing?.title || product?.name || aliases[0] || catalog?.product_code || '';
  const baseValues = [title, listing?.model, product?.model, catalog?.product_code, listing?.barcode,
    product?.barcode, catalog?.barcode].filter(Boolean);
  const synonymValues = [...aliases, ...parts.flatMap((part) => [part.code, part.canonical_name])].filter(Boolean);
  const values = [...baseValues, ...synonymValues];
  return {
    product, catalog, catalogId, aliases, parts, values, baseValues, synonymValues, listing,
    normalizedValues: values.map(normalizeAlias),
    haystack: normalizeAlias(values.join(' ')),
    locale: detectTextLocale(title),
  };
}

function matchWatchlist(watchlist, context) {
  const reasons = [];
  const excludes = parseJson(watchlist.exclude_terms_json).map(normalizeAlias);
  if (excludes.some((term) => term && context.haystack.includes(term))) return null;
  if (watchlist.locale !== 'any' && watchlist.locale !== context.locale) return null;
  if (watchlist.catalog_product_id) {
    if (Number(watchlist.catalog_product_id) !== Number(context.catalogId)) return null;
    reasons.push('catalog_product_exact');
  }
  if (watchlist.catalog_part_id) {
    if (!context.parts.some((part) => Number(part.id) === Number(watchlist.catalog_part_id))) return null;
    reasons.push('catalog_part_contains');
  }
  const expectedCode = normalizeAlias(watchlist.product_code || watchlist.model);
  if (expectedCode) {
    const actual = [context.listing?.model, extractModel(context.listing?.title),
      context.product?.model, context.catalog?.product_code].filter(Boolean).map(normalizeAlias);
    if (!actual.includes(expectedCode)) return null;
    reasons.push('model_exact');
  }
  if (watchlist.barcode) {
    const actual = [normalizeBarcode(context.listing?.barcode), context.product?.barcode,
      context.catalog?.barcode].filter(Boolean);
    if (!actual.includes(watchlist.barcode)) return null;
    reasons.push('barcode_exact');
  }
  const keywords = parseJson(watchlist.keywords_json);
  if (keywords.length) {
    const keywordValues = watchlist.synonym_expansion ? context.values : context.baseValues;
    const keywordNormalizedValues = keywordValues.map(normalizeAlias);
    const keywordHaystack = normalizeAlias(keywordValues.join(' '));
    let matched = false;
    if (watchlist.match_mode === 'regex') {
      matched = keywords.some((term) => new RegExp(term, 'iu').test(keywordValues.join(' ')));
      if (matched) reasons.push('regex');
    } else if (watchlist.match_mode === 'contains') {
      matched = keywords.some((term) => keywordHaystack.includes(normalizeAlias(term)));
      if (matched) reasons.push('keyword_contains');
    } else {
      matched = keywords.some((term) => keywordNormalizedValues.includes(normalizeAlias(term)));
      if (matched) reasons.push('keyword_exact');
    }
    if (!matched) return null;
  }
  if (!reasons.length) return null;
  const confidence = reasons.some((reason) => /exact/.test(reason)) ? 0.99 : 0.85;
  return { reasons, confidence, matchType: reasons[0] };
}

function preferenceEnabled(db, watchlistId, eventType) {
  return Boolean(db.get(
    'SELECT enabled FROM watchlist_notification_preferences WHERE watchlist_id=? AND event_type=?',
    [watchlistId, eventType]
  )?.enabled);
}

function createAlert(db, alert) {
  if (!preferenceEnabled(db, alert.watchlistId, alert.alertType)) return null;
  const info = db.run(
    `INSERT OR IGNORE INTO watchlist_alerts
      (watchlist_id,alert_type,catalog_product_id,product_id,offer_id,official_announcement_id,
       dedup_key,title,message,notified,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,?)`,
    [alert.watchlistId, alert.alertType, alert.catalogProductId || null, alert.productId || null,
      alert.offerId || null, alert.officialAnnouncementId || null, alert.dedupKey,
      alert.title, alert.message, now()]
  );
  return info.changes ? db.get('SELECT * FROM watchlist_alerts WHERE id=?', [info.lastInsertRowid]) : null;
}

function alertTypeForEvent(event, state) {
  if (event.type === 'price_change') return 'price_anomaly';
  if (event.type === 'preorder_open') return 'preorder_open';
  if (['back_in_stock', 'became_available'].includes(event.type)) return 'in_stock';
  if (event.type === 'product_discovered') {
    if (state === 'in_stock') return 'in_stock';
    if (state === 'preorder') return 'preorder_open';
  }
  return null;
}

export function evaluateWatchlistsForProduct(db, {
  productId, catalogProductId = null, offerId = null, state = null, events = [], listing = null,
  watchlistIds = null,
} = {}) {
  const context = productContext(db, { productId, catalogProductId, listing });
  const allowed = watchlistIds ? new Set(watchlistIds.map(Number)) : null;
  const watchlists = db.all('SELECT * FROM watchlists WHERE enabled=1 ORDER BY id')
    .filter((row) => !allowed || allowed.has(Number(row.id)));
  const matches = [];
  const alerts = [];
  for (const watchlist of watchlists) {
    const matched = matchWatchlist(watchlist, context);
    if (!matched) continue;
    const identityKey = context.catalogId ? `catalog:${context.catalogId}` : `product:${productId}`;
    const ts = now();
    db.run(
      `INSERT INTO watchlist_matches
        (watchlist_id,catalog_product_id,product_id,offer_id,identity_key,match_type,confidence,
         reasons_json,first_matched_at,last_matched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(watchlist_id,identity_key) DO UPDATE SET
        product_id=COALESCE(excluded.product_id,watchlist_matches.product_id),
        offer_id=COALESCE(excluded.offer_id,watchlist_matches.offer_id),
        confidence=MAX(watchlist_matches.confidence,excluded.confidence),
        reasons_json=excluded.reasons_json,last_matched_at=excluded.last_matched_at`,
      [watchlist.id, context.catalogId, productId || null, offerId || null, identityKey,
        matched.matchType, matched.confidence, JSON.stringify(matched.reasons), ts, ts]
    );
    matches.push({ watchlistId: watchlist.id, ...matched });
    for (const event of events) {
      const alertType = alertTypeForEvent(event, state);
      if (!alertType) continue;
      const alert = createAlert(db, {
        watchlistId: watchlist.id, alertType, catalogProductId: context.catalogId,
        productId, offerId, dedupKey: `watch:${watchlist.id}:event:${event.id}:${alertType}`,
        title: `${watchlist.name}：${context.product?.name || context.catalog?.product_code || 'Beyblade'}`,
        message: `${alertType} · ${listing?.url || ''}`.trim(),
      });
      if (alert) alerts.push(alert);
    }
  }
  return { matches, alerts };
}

export function evaluateWatchlistsForAnnouncement(db, announcement, { watchlistIds = null } = {}) {
  const context = productContext(db, { catalogProductId: announcement.catalog_product_id });
  const allowed = watchlistIds ? new Set(watchlistIds.map(Number)) : null;
  const watchlists = db.all('SELECT * FROM watchlists WHERE enabled=1 ORDER BY id')
    .filter((row) => !allowed || allowed.has(Number(row.id)));
  const alerts = [];
  const alertType = ({ announced: 'official_announcement', preorder: 'preorder_open',
    released: 'release', restock: 'in_stock' })[announcement.event_type] || 'official_announcement';
  for (const watchlist of watchlists) {
    const matched = matchWatchlist(watchlist, context);
    if (!matched) continue;
    const ts = now();
    const identityKey = `catalog:${announcement.catalog_product_id}`;
    db.run(`INSERT INTO watchlist_matches
      (watchlist_id,catalog_product_id,identity_key,match_type,confidence,reasons_json,first_matched_at,last_matched_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(watchlist_id,identity_key) DO UPDATE SET
      confidence=MAX(watchlist_matches.confidence,excluded.confidence),reasons_json=excluded.reasons_json,
      last_matched_at=excluded.last_matched_at`,
    [watchlist.id, announcement.catalog_product_id, identityKey, matched.matchType,
      matched.confidence, JSON.stringify(matched.reasons), ts, ts]);
    const alert = createAlert(db, {
      watchlistId: watchlist.id, alertType, catalogProductId: announcement.catalog_product_id,
      officialAnnouncementId: announcement.id,
      dedupKey: `watch:${watchlist.id}:official:${announcement.id}:${alertType}`,
      title: `${watchlist.name}：${announcement.title}`,
      message: `${announcement.event_type} · ${announcement.canonical_url}`,
    });
    if (alert) alerts.push(alert);
  }
  return alerts;
}

export function watchlistCandidateBoost(db, listing) {
  const context = productContext(db, { listing });
  for (const watchlist of db.all('SELECT * FROM watchlists WHERE enabled=1')) {
    const matched = matchWatchlist(watchlist, context);
    if (matched) return { score: 0.2, reason: `Watchlist：${watchlist.name}` };
  }
  return { score: 0, reason: null };
}

export function listWatchlistAlerts(db, { limit = 100 } = {}) {
  return db.all(`SELECT a.*,w.name watchlist_name,cp.product_code FROM watchlist_alerts a
    JOIN watchlists w ON w.id=a.watchlist_id
    LEFT JOIN catalog_products cp ON cp.id=a.catalog_product_id ORDER BY a.id DESC LIMIT ?`,
  [Math.min(500, Math.max(1, Number(limit) || 100))]);
}

export async function flushWatchlistAlerts(db, notifiers, { dryRun = false } = {}) {
  const alerts = db.all('SELECT * FROM watchlist_alerts WHERE notified=0 ORDER BY id');
  let sent = 0; let skipped = 0; let failed = 0;
  for (const alert of alerts) {
    let blocked = false;
    for (const notifier of notifiers) {
      const key = `watchlist-alert:${alert.id}`;
      if (!notifier.isConfigured()) { skipped += 1; continue; }
      const existing = db.get('SELECT status FROM notifications WHERE channel=? AND dedup_key=?', [notifier.name, key]);
      if (existing?.status === 'sent') { skipped += 1; continue; }
      if (dryRun) { blocked = true; skipped += 1; continue; }
      let result;
      try { result = await notifier.send({ title: alert.title, body: alert.message }); }
      catch (error) { result = { status: 'failed', detail: error.message }; }
      db.run(`INSERT INTO notifications
        (channel,dedup_key,product_id,event_ids,title,body,status,detail,created_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(channel,dedup_key) DO UPDATE SET
        status=excluded.status,detail=excluded.detail,title=excluded.title,body=excluded.body`,
      [notifier.name, key, alert.product_id, JSON.stringify([alert.id]), alert.title, alert.message,
        result.status, result.detail || null, now()]);
      if (result.status === 'sent') sent += 1;
      else if (result.status === 'failed') { failed += 1; blocked = true; }
      else skipped += 1;
    }
    if (!blocked) db.run('UPDATE watchlist_alerts SET notified=1 WHERE id=?', [alert.id]);
  }
  return { alerts: alerts.length, sent, skipped, failed };
}
