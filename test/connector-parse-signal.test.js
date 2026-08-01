import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { upsertSource } from '../src/core/store.js';
import { crawlSource } from '../src/core/pipeline.js';
import { JsonLdConnector } from '../src/connectors/jsonld.js';
import { BrowserConnector } from '../src/connectors/browser.js';
import { FixtureConnector } from '../src/connectors/fixture.js';
import { runOfferMonitors } from '../src/app.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

const OK_HTML = '<html><head><script type="application/ld+json">'
  + '{"@type":"Product","name":"Beyblade X BX-38","offers":{"@type":"Offer",'
  + '"price":"1080","priceCurrency":"JPY","availability":"https://schema.org/InStock"}}'
  + '</script></head><body><h1>BX-38</h1></body></html>';
const MAINTENANCE_HTML = '<html><head><title>ただいまメンテナンス中です</title></head><body></body></html>';
const EMPTY_HTML = '<html><head><title>Store</title></head><body><p>Welcome</p></body></html>';

function debugDeps() {
  // Route best-effort debug HTML dumps to a throwaway dir so parse-failure
  // pages under test never pollute the repo's runtime/debug folder.
  const dir = mkdtempSync(join(tmpdir(), 'parse-signal-'));
  return { dir, deps: { debug: { dir } } };
}

// A fake chromium that serves canned HTML per URL, so browser parse handling is
// exercised without launching a real browser.
function fakeChromium(htmlByUrl) {
  return {
    async launch() {
      return {
        async newContext() {
          return {
            async newPage() {
              let current = null;
              return {
                async goto(url) { current = url; },
                url() { return current; },
                async waitForSelector() {},
                async content() { return htmlByUrl[current]; },
                async close() {},
              };
            },
          };
        },
        async close() {},
      };
    },
  };
}

test('json-ld connector signals ok/empty/maintenance per page and only returns usable listings', async () => {
  const { dir, deps } = debugDeps();
  try {
    const bodies = {
      'https://shop/ok': OK_HTML,
      'https://shop/maint': MAINTENANCE_HTML,
      'https://shop/empty': EMPTY_HTML,
    };
    const connector = new JsonLdConnector(
      { key: 'shop', connector: 'jsonld' },
      { pages: Object.keys(bodies) },
      { ...deps, fetchText: async (page) => ({ body: bodies[page], url: page }) }
    );
    const listings = await connector.fetchListings();
    assert.equal(listings.length, 1);
    assert.match(listings[0].title, /BX-38/);
    assert.deepEqual(connector.parseStats, { pages: 3, ok: 1, empty: 1, maintenance: 1, failed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('json-ld connector returns nothing and marks pages when no page parses', async () => {
  const { dir, deps } = debugDeps();
  try {
    const bodies = { 'https://shop/maint': MAINTENANCE_HTML, 'https://shop/empty': EMPTY_HTML };
    const connector = new JsonLdConnector(
      { key: 'shop', connector: 'jsonld' },
      { pages: Object.keys(bodies) },
      { ...deps, fetchText: async (page) => ({ body: bodies[page], url: page }) }
    );
    assert.deepEqual(await connector.fetchListings(), []);
    assert.deepEqual(connector.parseStats, { pages: 2, ok: 0, empty: 1, maintenance: 1, failed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('json-ld connector with no configured pages fetches nothing', async () => {
  const connector = new JsonLdConnector({ key: 'shop', connector: 'jsonld' }, { pages: [] }, {});
  assert.deepEqual(await connector.fetchListings(), []);
  assert.deepEqual(connector.parseStats, { pages: 0, ok: 0, empty: 0, maintenance: 0, failed: 0 });
});

test('browser connector records page-level parse outcomes without aborting the crawl', async () => {
  const { dir, deps } = debugDeps();
  try {
    const bodies = {
      'https://shop/ok': OK_HTML,
      'https://shop/maint': MAINTENANCE_HTML,
      'https://shop/empty': EMPTY_HTML,
    };
    const connector = new BrowserConnector(
      { key: 'shop', connector: 'browser' },
      { pages: Object.keys(bodies) },
      { ...deps, chromium: fakeChromium(bodies) }
    );
    const listings = await connector.fetchListings();
    assert.equal(listings.length, 1);
    assert.match(listings[0].title, /BX-38/);
    assert.deepEqual(connector.parseStats, { pages: 3, ok: 1, empty: 1, maintenance: 1, failed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('browser connector returns nothing when every page fails to parse', async () => {
  const { dir, deps } = debugDeps();
  try {
    const bodies = { 'https://shop/empty': EMPTY_HTML };
    const connector = new BrowserConnector(
      { key: 'shop', connector: 'browser' },
      { pages: Object.keys(bodies) },
      { ...deps, chromium: fakeChromium(bodies) }
    );
    assert.deepEqual(await connector.fetchListings(), []);
    assert.deepEqual(connector.parseStats, { pages: 1, ok: 0, empty: 1, maintenance: 0, failed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawlSource surfaces connector parse stats and only processes usable listings', async () => {
  const { dir, deps } = debugDeps();
  try {
    const db = new Database(':memory:');
    const source = upsertSource(db, { key: 'shop', name: 'Shop', connector: 'jsonld', url: 'https://shop' });
    const bodies = { 'https://shop/ok': OK_HTML, 'https://shop/empty': EMPTY_HTML };
    const connector = new JsonLdConnector(
      source, { pages: Object.keys(bodies) },
      { ...deps, fetchText: async (page) => ({ body: bodies[page], url: page }) }
    );
    const stats = await crawlSource(db, source, connector, OPTS, null);
    assert.deepEqual(stats.parse, { pages: 2, ok: 1, empty: 1, maintenance: 0, failed: 0 });
    assert.equal(stats.itemsParsed, 1);
    assert.equal(stats.itemsSeen, 1);
    assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crawlSource writes nothing to the database when no valid listing is produced', async () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'shop', name: 'Shop', connector: 'fixture', url: 'https://shop' });

  // A listing with only a URL has no meaningful product fields: pipeline must
  // reject it before any write happens.
  const invalid = new FixtureConnector(source, { frames: [[{ url: 'https://shop/1' }]] }, {});
  const stats = await crawlSource(db, source, invalid, OPTS, null);
  assert.equal(stats.itemsParsed, 1);
  assert.equal(stats.itemsInvalid, 1);
  assert.equal(stats.itemsSeen, 0);

  const empty = new FixtureConnector(source, { frames: [[]] }, {});
  await crawlSource(db, source, empty, OPTS, null);

  for (const table of ['products', 'offers', 'observations', 'events']) {
    assert.equal(db.get(`SELECT COUNT(*) c FROM ${table}`).c, 0, `${table} should have no rows`);
  }
  db.close();
});

function parserEvents(db, key) {
  return db.all(
    "SELECT status, error_class FROM operation_events WHERE component='parser' AND source_key=? ORDER BY id",
    [key]
  ).map((row) => ({ status: row.status, error_class: row.error_class }));
}

test('runOfferMonitors records a skipped/no_url parser event and no writes when a source has no URL', async () => {
  const db = new Database(':memory:');
  const config = { network: { enabled: true } };
  upsertSource(db, { key: 'nourl', name: 'No URL', connector: 'jsonld', config: { pages: [] } });

  const summary = await runOfferMonitors({ db, config }, { force: true });
  assert.equal(summary.failed, 1);
  const events = parserEvents(db, 'nourl');
  assert.deepEqual(events, [{ status: 'skipped', error_class: 'no_url' }]);
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 0);
  db.close();
});

test('runOfferMonitors records a failed/parse parser event and no writes when all listings are invalid', async () => {
  const db = new Database(':memory:');
  const config = { network: { enabled: true } };
  upsertSource(db, {
    key: 'invalid', name: 'Invalid', connector: 'fixture',
    config: { frames: [[{ url: 'https://shop/1' }]] },
  });

  const summary = await runOfferMonitors({ db, config }, { force: true });
  assert.equal(summary.failed, 1);
  assert.deepEqual(parserEvents(db, 'invalid'), [{ status: 'failed', error_class: 'parse' }]);
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 0);
  db.close();
});

test('runOfferMonitors records a clean parser success when listings are valid', async () => {
  const db = new Database(':memory:');
  const config = { network: { enabled: true } };
  upsertSource(db, {
    key: 'good', name: 'Good', connector: 'fixture',
    config: { frames: [[{ url: 'https://shop/bx-38', title: 'Beyblade X BX-38', model: 'BX-38', price: 1080, currency: 'JPY', availabilityRaw: 'https://schema.org/InStock' }]] },
  });

  const summary = await runOfferMonitors({ db, config }, { force: true });
  assert.equal(summary.ok, 1);
  assert.deepEqual(parserEvents(db, 'good'), [{ status: 'success', error_class: null }]);
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 1);
  db.close();
});
