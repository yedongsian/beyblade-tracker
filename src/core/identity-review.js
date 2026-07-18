const now = () => new Date().toISOString();

function snapshotProduct(db, id) {
  const product = db.get('SELECT * FROM products WHERE id=?', [id]);
  if (!product) return null;
  return { product, offers: db.all('SELECT id,source_id,url,title FROM offers WHERE product_id=? ORDER BY id', [id]) };
}

function audit(db, payload) {
  db.run(`INSERT INTO product_identity_audit
    (action,source_product_id,target_product_id,new_product_id,offer_ids_json,before_json,after_json,note,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [payload.action, payload.sourceProductId || null,
    payload.targetProductId || null, payload.newProductId || null, JSON.stringify(payload.offerIds || []),
    JSON.stringify(payload.before || {}), JSON.stringify(payload.after || {}), payload.note || null, now()]);
}

export function splitProduct(db, productId, offerIds, { name, note } = {}) {
  const ids = [...new Set((offerIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('請至少選擇一個要拆分的商店刊登。');
  const before = snapshotProduct(db, productId);
  if (!before) throw new Error('找不到要拆分的商品。');
  const selected = before.offers.filter((offer) => ids.includes(Number(offer.id)));
  if (selected.length !== ids.length) throw new Error('選取的商店刊登不屬於這個商品。');
  if (selected.length >= before.offers.length) throw new Error('必須至少保留一個商店刊登在原商品。');

  return db.transaction(() => {
    const p = before.product;
    const ts = now();
    const info = db.run(`INSERT INTO products
      (name,brand,series,model,barcode,sku,normalized_sku,variant_key,release_date,image,catalog_product_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [String(name || `${p.name}（拆分）`).slice(0, 300), p.brand, p.series,
      p.model, null, null, null, p.variant_key, p.release_date, p.image, p.catalog_product_id, ts, ts]);
    const newId = Number(info.lastInsertRowid);
    const catalogLink = db.get('SELECT * FROM product_catalog_links WHERE product_id=?', [productId]);
    if (catalogLink) {
      db.run(`INSERT INTO product_catalog_links
        (product_id,catalog_product_id,match_method,confidence,reasons_json,verification_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, [newId, catalogLink.catalog_product_id, catalogLink.match_method,
        catalogLink.confidence, catalogLink.reasons_json, catalogLink.verification_status, ts, ts]);
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`UPDATE offers SET product_id=?,updated_at=? WHERE id IN (${placeholders})`, [newId, ts, ...ids]);
    db.run(`UPDATE events SET product_id=? WHERE offer_id IN (${placeholders})`, [newId, ...ids]);
    db.run(`UPDATE watchlist_matches SET product_id=? WHERE offer_id IN (${placeholders})`, [newId, ...ids]);
    db.run(`UPDATE watchlist_alerts SET product_id=? WHERE offer_id IN (${placeholders})`, [newId, ...ids]);
    const after = { original: snapshotProduct(db, productId), created: snapshotProduct(db, newId) };
    audit(db, { action: 'split', sourceProductId: productId, newProductId: newId, offerIds: ids, before, after, note });
    return { original: after.original, created: after.created };
  });
}

export function mergeProducts(db, sourceProductId, targetProductId, { note } = {}) {
  const sourceId = Number(sourceProductId);
  const targetId = Number(targetProductId);
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('請選擇兩個不同商品進行合併。');
  const before = { source: snapshotProduct(db, sourceId), target: snapshotProduct(db, targetId) };
  if (!before.source || !before.target) throw new Error('找不到要合併的商品。');

  return db.transaction(() => {
    const ts = now();
    const offerIds = before.source.offers.map((offer) => Number(offer.id));
    db.run('UPDATE offers SET product_id=?,updated_at=? WHERE product_id=?', [targetId, ts, sourceId]);
    db.run('UPDATE events SET product_id=? WHERE product_id=?', [targetId, sourceId]);
    db.run('UPDATE notifications SET product_id=? WHERE product_id=?', [targetId, sourceId]);
    db.run('UPDATE product_candidates SET product_id=? WHERE product_id=?', [targetId, sourceId]);
    db.run('UPDATE watchlist_matches SET product_id=? WHERE product_id=?', [targetId, sourceId]);
    db.run('UPDATE watchlist_alerts SET product_id=? WHERE product_id=?', [targetId, sourceId]);
    const targetLink = db.get('SELECT product_id FROM product_catalog_links WHERE product_id=?', [targetId]);
    if (targetLink) db.run('DELETE FROM product_catalog_links WHERE product_id=?', [sourceId]);
    else db.run('UPDATE product_catalog_links SET product_id=?,updated_at=? WHERE product_id=?', [targetId, ts, sourceId]);
    const s = before.source.product;
    db.run(`UPDATE products SET brand=COALESCE(brand,?),series=COALESCE(series,?),model=COALESCE(model,?),
      barcode=COALESCE(barcode,?),sku=COALESCE(sku,?),normalized_sku=COALESCE(normalized_sku,?),
      variant_key=COALESCE(variant_key,?),release_date=COALESCE(release_date,?),image=COALESCE(image,?),
      catalog_product_id=COALESCE(catalog_product_id,?),updated_at=? WHERE id=?`,
    [s.brand, s.series, s.model, s.barcode, s.sku, s.normalized_sku, s.variant_key, s.release_date,
      s.image, s.catalog_product_id, ts, targetId]);
    db.run('DELETE FROM products WHERE id=?', [sourceId]);
    const after = snapshotProduct(db, targetId);
    audit(db, { action: 'merge', sourceProductId: sourceId, targetProductId: targetId, offerIds, before, after, note });
    return { product: after, removedProductId: sourceId };
  });
}

export function listIdentityAudits(db, { limit = 100 } = {}) {
  return db.all('SELECT * FROM product_identity_audit ORDER BY id DESC LIMIT ?', [Number(limit)]);
}
