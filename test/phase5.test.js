import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from '../src/db/database.js';
import { canonicalizeSeedUrl, fetchableSeedUrl } from '../src/core/site.js';
import {
  confirmOfficialPreview, importOfficialItem, listOfficialSources, registerDefaultOfficialSources,
} from '../src/core/official.js';
import {
  createWatchlist, flushWatchlistAlerts, listWatchlistAlerts, listWatchlists,
} from '../src/core/watchlist.js';
import { linkCatalogPart, upsertCatalogPart } from '../src/core/catalog.js';
import { processListing } from '../src/core/pipeline.js';
import { upsertSource } from '../src/core/store.js';
import { finalizeSuccessfulMonitor } from '../src/core/monitor.js';
import { runSiteDiscovery } from '../src/core/discovery.js';
import { listCandidates } from '../src/core/review-queue.js';

const OPTS = {
  preorderIsPurchasable: false, eventCooldownSeconds: 0,
  priceChangeThreshold: 0.05, stabilityConfirmations: 1,
};

test('wovn display language does not change URL identity but remains on fetchable URLs', () => {
  const plain = 'https://takaratomymall.jp/shop/g/g4904810999999/';
  const english = `${plain}?wovn=english`;
  assert.equal(canonicalizeSeedUrl(plain), canonicalizeSeedUrl(english));
  assert.match(fetchableSeedUrl(english), /wovn=english/);
});

test('Takara Tomy Mall registry, Recipe, Seed URL and first-scan preview start disabled', () => {
  const db = new Database(':memory:');
  const registered = registerDefaultOfficialSources(db);
  assert.equal(registered.official.source_class, 'official_store');
  assert.equal(registered.official.enabled, 0);
  assert.equal(registered.preview.status, 'pending');
  assert.equal(registered.preview.estimated_products, 100);
  assert.equal(db.get("SELECT enabled FROM seed_urls WHERE origin='official_registry'").enabled, 0);
  assert.equal(db.get('SELECT enabled FROM discovery_settings WHERE site_id=?', [registered.site.id]).enabled, 0);
  const recipe = JSON.parse(db.get('SELECT config_json FROM site_recipes WHERE site_id=?', [registered.site.id]).config_json);
  assert.ok(recipe.discoveryOrder.includes('sitemap'));
  assert.ok(recipe.identityIgnoredParams.includes('wovn'));

  const confirmed = confirmOfficialPreview(db, registered.official.id);
  assert.equal(confirmed.preview.status, 'confirmed');
  assert.equal(db.get('SELECT enabled FROM discovery_settings WHERE site_id=?', [registered.site.id]).enabled, 1);
  assert.equal(registerDefaultOfficialSources(db).preview.status, 'confirmed', 'restart does not recreate a pending preview');
  db.close();
});

test('high-confidence official discovery updates Catalog before the Offer candidate is approved', async () => {
  const db = new Database(':memory:');
  const registered = registerDefaultOfficialSources(db);
  confirmOfficialPreview(db, registered.official.id);
  const category = readFileSync(new URL('../fixtures/html/takara-beyx-category.html', import.meta.url), 'utf8');
  const product = readFileSync(new URL('../fixtures/html/takara-product-jsonld.html', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../fixtures/html/takara-sitemap.xml', import.meta.url), 'utf8');
  const fetchPage = async (url) => {
    if (url.endsWith('/robots.txt')) return { url, body: 'User-agent: *\nAllow: /\nSitemap: https://takaratomymall.jp/sitemap.xml' };
    if (url.endsWith('/sitemap.xml')) return { url, body: sitemap };
    if (url.includes('/shop/c/cBeyX')) return { url, body: category };
    if (url.includes('/shop/g/g4904810959553')) return { url, body: product };
    throw new Error('HTTP 404');
  };
  const run = await runSiteDiscovery(db, registered.site.id, {
    fetchPage, sleep: async () => {}, budget: { maxPages: 20, maxDepth: 2 },
  });
  assert.equal(run.status, 'success');
  assert.equal(listCandidates(db)[0].status, 'pending');
  const catalog = db.get("SELECT * FROM catalog_products WHERE product_code='UX-20'");
  assert.equal(catalog.verification_status, 'verified');
  assert.equal(catalog.official_source_id, registered.official.id);
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 0, 'official discovery does not create a store Product before review');
  db.close();
});

test('Watchlist supports exact, contains, regex, exclusions, Catalog products and parts', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'retailer', name: 'Retailer', connector: 'fixture', url: 'https://shop.example' });
  const first = processListing(db, source, {
    url: 'https://shop.example/cx-01', title: 'BEYBLADE X CX-01 Starter', model: 'CX-01',
    availabilityRaw: 'https://schema.org/OutOfStock',
  }, OPTS);
  const catalog = db.get("SELECT * FROM catalog_products WHERE product_code='CX-01'");
  const part = upsertCatalogPart(db, { partType: 'blade', code: 'Dran', canonicalName: 'Dran Brave' });
  linkCatalogPart(db, catalog.id, part.id);
  createWatchlist(db, { name: 'Exact', productCode: 'CX-01', matchMode: 'exact' });
  createWatchlist(db, { name: 'Contains', keywords: 'Dran Brave', matchMode: 'contains' });
  createWatchlist(db, { name: 'Regex', keywords: '^BEYBLADE\\s+X\\s+CX-01', matchMode: 'regex' });
  createWatchlist(db, { name: 'Part', targetType: 'catalog_part', catalogPartId: part.id });
  createWatchlist(db, { name: 'Excluded', productCode: 'CX-01', excludeTerms: 'Starter' });
  processListing(db, source, {
    url: 'https://shop.example/cx-01', title: 'BEYBLADE X CX-01 Starter', model: 'CX-01',
    availabilityRaw: 'https://schema.org/InStock',
  }, OPTS);
  const names = db.all(`SELECT w.name FROM watchlist_matches m JOIN watchlists w ON w.id=m.watchlist_id
    WHERE m.product_id=? ORDER BY w.name`, [first.productId]).map((row) => row.name);
  assert.deepEqual(names, ['Contains', 'Exact', 'Part', 'Regex']);
  assert.equal(listWatchlists(db).length, 5);
  assert.throws(() => createWatchlist(db, { name: 'Bad regex', keywords: '[', matchMode: 'regex' }), /正規表示式/);
  db.close();
});

test('unreleased Watchlist model shows official announcement and sends one alert when a store Offer appears', async () => {
  const db = new Database(':memory:');
  registerDefaultOfficialSources(db);
  createWatchlist(db, {
    name: 'Future CX-99', productCode: 'CX-99', matchMode: 'exact',
    notificationEvents: ['in_stock'],
  });
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/official/takara-announcements.json', import.meta.url), 'utf8'));
  const imported = importOfficialItem(db, fixture.source, fixture.items[0]);
  assert.equal(imported.status, 'verified');
  assert.equal(imported.catalog.product_code, 'CX-99');
  assert.equal(imported.catalog.release_date, '2026-09-15');
  assert.equal(imported.catalog.msrp, 2400);
  assert.equal(db.get('SELECT COUNT(*) c FROM official_announcements').c, 1);
  assert.equal(listWatchlistAlerts(db).length, 0, 'official alert preference was disabled');
  importOfficialItem(db, fixture.source, fixture.items[0]);
  assert.equal(db.get('SELECT COUNT(*) c FROM official_announcements').c, 1, 'official import is idempotent');

  const retailer = upsertSource(db, {
    key: 'future-shop', name: 'Future Shop', connector: 'fixture', url: 'https://future.example',
  });
  const offer = processListing(db, retailer, {
    url: 'https://future.example/cx-99', title: 'BEYBLADE X CX-99 Future Starter', model: 'CX-99',
    price: 2350, currency: 'JPY', availabilityRaw: 'https://schema.org/InStock',
  }, OPTS);
  assert.equal(db.get('SELECT catalog_product_id FROM products WHERE id=?', [offer.productId]).catalog_product_id,
    imported.catalog.id);
  const alerts = listWatchlistAlerts(db);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alert_type, 'in_stock');

  finalizeSuccessfulMonitor(db, retailer, {
    seenOfferIds: [offer.offerId], now: '2026-08-02T00:00:00.000Z', random: () => 0.5,
  });
  const next = db.get('SELECT next_run_at FROM source_monitor_settings WHERE source_id=?', [retailer.id]).next_run_at;
  assert.equal((Date.parse(next) - Date.parse('2026-08-02T00:00:00.000Z')) / 1000, 300,
    'Watchlist match raises monitor priority to five minutes');

  const notifier = { name: 'capture', messages: [], isConfigured: () => true,
    async send(message) { this.messages.push(message); return { status: 'sent', detail: 'ok' }; } };
  const first = await flushWatchlistAlerts(db, [notifier]);
  const second = await flushWatchlistAlerts(db, [notifier]);
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(notifier.messages.length, 1);
  db.close();
});

test('official announcement preferences create one deduplicated announcement alert', () => {
  const db = new Database(':memory:');
  registerDefaultOfficialSources(db);
  createWatchlist(db, { name: 'BX-88 news', productCode: 'BX-88', notificationEvents: ['official_announcement'] });
  const item = {
    url: 'https://takaratomymall.jp/shop/g/g4904810888888', title: 'BEYBLADE X BX-88',
    productCode: 'BX-88', eventType: 'announced', publishedAt: '2026-08-01T00:00:00Z',
  };
  importOfficialItem(db, 'takara-tomy-mall', item);
  importOfficialItem(db, 'takara-tomy-mall', item);
  const alerts = listWatchlistAlerts(db);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alert_type, 'official_announcement');
  db.close();
});

test('official conflicts are explicit and low-confidence official records enter Review Queue', () => {
  const db = new Database(':memory:');
  registerDefaultOfficialSources(db);
  db.run(`INSERT INTO catalog_products
    (product_code,brand,barcode,verification_status,created_at,updated_at)
    VALUES ('BX-77','Takara Tomy','4570118488384','pending','x','x')`);
  const conflict = importOfficialItem(db, 'takara-tomy-mall', {
    url: 'https://takaratomymall.jp/shop/g/g4901111111111', title: 'BEYBLADE X BX-77',
    productCode: 'BX-77', barcode: '4904810959553', eventType: 'announced',
  });
  assert.equal(conflict.status, 'conflict');
  assert.equal(db.get("SELECT verification_status FROM catalog_products WHERE product_code='BX-77'").verification_status, 'conflict');
  const review = importOfficialItem(db, 'takara-tomy-mall', {
    url: 'https://takaratomymall.jp/shop/g/unknown', title: 'BEYBLADE X mysterious item',
  });
  assert.equal(review.status, 'review');
  assert.equal(db.get("SELECT status FROM product_candidates WHERE canonical_url LIKE '%unknown'").status, 'pending');
  assert.equal(listOfficialSources(db)[0].source_class, 'official_store');
  db.close();
});
