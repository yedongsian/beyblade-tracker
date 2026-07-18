import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { processListing } from '../src/core/pipeline.js';
import { mergeProducts, splitProduct } from '../src/core/identity-review.js';
import { upsertSource } from '../src/core/store.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

test('manual split remains authoritative on later scans and can be merged back with an audit trail', () => {
  const db = new Database(':memory:');
  const sourceA = upsertSource(db, { key: 'identity-a', name: 'Store A', connector: 'fixture' });
  const sourceB = upsertSource(db, { key: 'identity-b', name: 'Store B', connector: 'fixture' });
  const listingA = { url: 'https://a.example/bx-38', title: 'Beyblade X BX-38 Red',
    availabilityRaw: 'https://schema.org/InStock' };
  const listingB = { url: 'https://b.example/bx-38', title: 'Beyblade X BX-38 Red',
    availabilityRaw: 'https://schema.org/OutOfStock' };
  processListing(db, sourceA, listingA, OPTS);
  processListing(db, sourceB, listingB, OPTS);

  const originalId = db.get('SELECT id FROM products').id;
  const offerB = db.get('SELECT id FROM offers WHERE source_id=?', [sourceB.id]);
  const split = splitProduct(db, originalId, [offerB.id], { name: 'BX-38 manual variant', note: 'operator review' });
  const splitId = split.created.product.id;
  assert.notEqual(splitId, originalId);
  assert.equal(db.get('SELECT product_id FROM offers WHERE id=?', [offerB.id]).product_id, splitId);

  const rescanned = processListing(db, sourceB, { ...listingB, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(rescanned.productId, splitId);
  assert.equal(db.get('SELECT product_id FROM offers WHERE id=?', [offerB.id]).product_id, splitId);
  assert.equal(db.get(`SELECT COUNT(*) count FROM events e JOIN offers o ON o.id=e.offer_id
    WHERE e.offer_id IS NOT NULL AND e.product_id<>o.product_id`).count, 0);

  const merged = mergeProducts(db, splitId, originalId, { note: 'manual reconciliation' });
  assert.equal(merged.removedProductId, splitId);
  assert.equal(db.get('SELECT COUNT(*) count FROM products').count, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM offers WHERE product_id=?', [originalId]).count, 2);
  assert.deepEqual(db.all('SELECT action FROM product_identity_audit ORDER BY id').map((row) => row.action), ['split', 'merge']);
  db.close();
});

test('manual split rejects moving every offer away from a product', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'identity-only', connector: 'fixture' });
  processListing(db, source, { url: 'https://one.example/bx-01', title: 'Beyblade X BX-01',
    availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  const product = db.get('SELECT id FROM products');
  const offer = db.get('SELECT id FROM offers');
  assert.throws(() => splitProduct(db, product.id, [offer.id]));
  assert.equal(db.get('SELECT COUNT(*) count FROM product_identity_audit').count, 0);
  db.close();
});
