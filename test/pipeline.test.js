import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { upsertSource } from '../src/core/store.js';
import { processListing, crawlSource } from '../src/core/pipeline.js';
import { FixtureConnector } from '../src/connectors/fixture.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

function setup() {
  const db = new Database(':memory:');
  const sourceA = upsertSource(db, { key: 'a', name: 'Store A', connector: 'fixture', url: 'https://a.example' });
  const sourceB = upsertSource(db, { key: 'b', name: 'Store B', connector: 'fixture', url: 'https://b.example' });
  return { db, sourceA, sourceB };
}

const BX38 = {
  url: 'https://a.example/p/bx-38',
  title: 'Beyblade X BX-38 Dranzer Spiral',
  brand: 'Takara Tomy',
  barcode: '4570118488384',
  price: 1080,
  currency: 'JPY',
};

test('first sighting creates product, offer and discovery event', () => {
  const { db, sourceA } = setup();
  const r = processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(r.excluded, false);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, 'product_discovered');
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 1);
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 1);
});

test('re-reading identical state creates no new events', () => {
  const { db, sourceA } = setup();
  const listing = { ...BX38, availabilityRaw: 'https://schema.org/InStock' };
  processListing(db, sourceA, listing, OPTS);
  const r2 = processListing(db, sourceA, listing, OPTS);
  assert.equal(r2.events.length, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM events').c, 1);
});

test('out_of_stock -> in_stock creates exactly one back_in_stock event', () => {
  const { db, sourceA } = setup();
  processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/OutOfStock' }, OPTS);
  const back = processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.deepEqual(back.events.map((e) => e.type), ['back_in_stock']);
  // Re-scan in stock again: no duplicate.
  const again = processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(again.events.length, 0);
  assert.equal(db.all("SELECT * FROM events WHERE type='back_in_stock'").length, 1);
});

test('same model in two stores merges into one product with two offers', () => {
  const { db, sourceA, sourceB } = setup();
  processListing(db, sourceA, { ...BX38, url: 'https://a.example/p/bx-38', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  processListing(db, sourceB, { ...BX38, url: 'https://b.example/p/bx38', price: 12.99, currency: 'USD', availabilityRaw: 'https://schema.org/OutOfStock' }, OPTS);
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 1);
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 2);
});

test('same title but different model is not merged', () => {
  const { db, sourceA } = setup();
  processListing(db, sourceA, {
    url: 'https://a.example/p/bx-38', title: 'Beyblade X BX-38 Starter', availabilityRaw: 'https://schema.org/InStock',
  }, OPTS);
  processListing(db, sourceA, {
    url: 'https://a.example/p/bx-39', title: 'Beyblade X BX-39 Starter', availabilityRaw: 'https://schema.org/InStock',
  }, OPTS);
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 2);
});

test('items without model/barcode are not force-merged', () => {
  const { db, sourceA, sourceB } = setup();
  processListing(db, sourceA, { url: 'https://a.example/mystery', title: 'Mystery spinning top', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  processListing(db, sourceB, { url: 'https://b.example/mystery', title: 'Mystery spinning top', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 2);
});

test('excluded used items are skipped', () => {
  const { db, sourceA } = setup();
  const r = processListing(db, sourceA, { ...BX38, title: 'BX-38 中古 used', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(r.excluded, true);
  assert.equal(r.reason, 'used');
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 0);
});

test('event cooldown suppresses flapping duplicates', () => {
  const { db, sourceA } = setup();
  const opts = { ...OPTS, eventCooldownSeconds: 3600 };
  processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/OutOfStock' }, opts);
  processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/InStock' }, opts);
  processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/OutOfStock' }, opts);
  const back2 = processListing(db, sourceA, { ...BX38, availabilityRaw: 'https://schema.org/InStock' }, opts);
  // Second back_in_stock within cooldown is suppressed.
  assert.equal(back2.events.length, 0);
  assert.equal(db.all("SELECT * FROM events WHERE type='back_in_stock'").length, 1);
});

test('fixture connector replays frames and drives the pipeline', async () => {
  const { db, sourceA } = setup();
  const src = { ...sourceA, config: { file: 'fixtures/beyblade-x.json' } };
  const c0 = new FixtureConnector(src, src.config, { frameIndex: 0 });
  const s0 = await crawlSource(db, src, c0, OPTS, null);
  assert.ok(s0.itemsSeen >= 2);
  const products0 = db.get('SELECT COUNT(*) c FROM products').c;
  // Frame 1 restocks store B's BX-38.
  const c1 = new FixtureConnector(src, src.config, { frameIndex: 1 });
  const s1 = await crawlSource(db, src, c1, OPTS, null);
  const restock = db.all("SELECT * FROM events WHERE type='back_in_stock'");
  assert.ok(restock.length >= 1, 'expected a restock event on frame 1');
  // No new products created on the second frame (same items).
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, products0);
});
