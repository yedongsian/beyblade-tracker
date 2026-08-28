import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from '../src/db/database.js';
import { parseProductPage } from '../src/connectors/parse.js';
import { computeAvailability } from '../src/core/classify.js';
import { processListing } from '../src/core/pipeline.js';
import { upsertSource } from '../src/core/store.js';
import {
  linkCatalogPart, listCatalogProducts, listTerminologyReviews, reviewTerminology,
  upsertCatalogPart,
} from '../src/core/catalog.js';
import { createTranslator } from '../src/i18n.js';
import { safeErrorClass, sourceErrorMessageKey } from '../src/core/operations.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

test('three-language availability fixtures map to stable internal states', () => {
  const cases = [
    ['availability-zh-hant.html', 'in_stock', 'zh-TW'],
    ['availability-ja.html', 'preorder', 'ja'],
    ['availability-en.html', 'out_of_stock', 'en'],
  ];
  for (const [file, state, locale] of cases) {
    const html = readFileSync(new URL(`../fixtures/html/${file}`, import.meta.url), 'utf8');
    const listing = parseProductPage(html, { url: `https://example.test/${file}`, selectors: { availabilityText: '.status' } });
    const result = computeAvailability(listing);
    assert.equal(result.state, state);
    assert.equal(result.locale, locale);
  }
});

test('model identity links Japanese, English and Traditional Chinese aliases to one Catalog product', () => {
  const db = new Database(':memory:');
  const sources = ['jp', 'en', 'tw'].map((key) => upsertSource(db, {
    key, name: key, connector: 'fixture', url: `https://${key}.example`,
  }));
  const titles = [
    'ベイブレードX UX-20 ドランバスター',
    'BEYBLADE X UX-20 Dran Buster',
    '戰鬥陀螺 X UX-20 爆裂龍劍',
  ];
  titles.forEach((title, index) => processListing(db, sources[index], {
    url: `https://${sources[index].key}.example/ux-20`, title, brand: 'Takara Tomy',
    availabilityText: index === 0 ? '在庫あり' : index === 1 ? 'In stock' : '現貨',
  }, OPTS));
  assert.equal(db.get('SELECT COUNT(*) n FROM products').n, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM catalog_products').n, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM catalog_aliases').n, 3);
  assert.deepEqual(db.all('SELECT locale FROM catalog_aliases ORDER BY locale').map((row) => row.locale), ['en', 'ja', 'zh-TW']);
  assert.equal(listCatalogProducts(db)[0].product_code, 'UX-20');
  db.close();
});

test('unknown availability wording enters review and approved override is used on the next observation', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'terms', name: 'Terms', connector: 'fixture', url: 'https://terms.example' });
  const listing = {
    url: 'https://terms.example/bx-38', title: 'BEYBLADE X BX-38',
    availabilityText: 'Ready for dispatch',
  };
  const first = processListing(db, source, listing, OPTS);
  assert.equal(first.state, 'unknown');
  const pending = listTerminologyReviews(db)[0];
  assert.equal(pending.kind, 'availability');
  reviewTerminology(db, pending.id, { action: 'approve', value: 'in_stock' });
  const second = processListing(db, source, listing, OPTS);
  assert.equal(second.state, 'in_stock');
  assert.equal(db.get('SELECT COUNT(*) n FROM availability_term_overrides').n, 1);
  db.close();
});

test('Catalog supports Blade, Ratchet, Bit and Assist Blade relationships', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'parts', connector: 'fixture', url: 'https://parts.example' });
  processListing(db, source, {
    url: 'https://parts.example/cx-01', title: 'BEYBLADE X CX-01 Starter', availabilityText: 'In stock',
  }, OPTS);
  const catalogId = db.get("SELECT id FROM catalog_products WHERE product_code='CX-01'").id;
  const definitions = [
    ['blade', 'A', 'Arc'], ['ratchet', '3-60', '3-60'], ['bit', 'F', 'Flat'],
    ['assist_blade', 'R', 'Round'],
  ];
  for (const [partType, code, canonicalName] of definitions) {
    const part = upsertCatalogPart(db, { partType, code, canonicalName });
    linkCatalogPart(db, catalogId, part.id);
  }
  assert.equal(db.get('SELECT COUNT(*) n FROM catalog_product_parts').n, 4);
  db.close();
});

test('UI translator supports Traditional Chinese, Japanese and English state labels', () => {
  assert.equal(createTranslator('zh-TW')('state.in_stock'), '現貨');
  assert.equal(createTranslator('ja')('state.in_stock'), '在庫あり');
  assert.equal(createTranslator('en')('state.in_stock'), 'In stock');
});

// BT-UX-003. A missing key falls back to Traditional Chinese and then to the key itself, so an
// untranslated source error would render as Chinese on an English page and nobody would notice.
test('every source error class resolves to a message translated in all three languages', () => {
  const classes = [
    'timeout', 'dns', 'connection', 'tls', 'robots_blocked', 'access_blocked', 'network_paused',
    'parse', 'maintenance', 'empty', 'not_found', 'validation', 'error', 'unknown',
    'http_400', 'http_401', 'http_403', 'http_404', 'http_410', 'http_429',
    'http_500', 'http_502', 'http_503', 'http_504', 'http_418', 'too_large', 'no_candidates',
  ];
  const zh = createTranslator('zh-TW');
  for (const errorClass of classes) {
    const key = sourceErrorMessageKey(errorClass);
    assert.ok(key, `${errorClass} must map to a message key`);
    const baseline = zh(key, { class: errorClass });
    assert.notEqual(baseline, key, `${key} is missing from the Traditional Chinese catalog`);
    for (const locale of ['ja', 'en']) {
      const translated = createTranslator(locale)(key, { class: errorClass });
      assert.notEqual(translated, key, `${key} is missing from the ${locale} catalog`);
      assert.notEqual(translated, baseline, `${key} falls back to Chinese on ${locale}`);
    }
  }
});

// Classification is only useful if it catches the failures that actually happen. These are the
// literal strings src/net/http.js and the connectors raise, taken from the source rather than
// imagined - 'fetch failed' in particular is what undici reports when the machine is offline, which
// is the failure a home user meets most often.
test('the errors the crawl path really raises all classify into specific advice', () => {
  const cases = [
    ['TypeError: fetch failed', 'connection'],
    ['Error: fetch failed', 'connection'],
    ['Error: getaddrinfo ENOTFOUND www.example.com', 'dns'],
    ['Error: connect ECONNREFUSED 203.0.113.1:443', 'connection'],
    ['Error: HTTP 404', 'http_404'],
    ['Error: HTTP 503', 'http_503'],
    ['Error: response exceeds 2097152 bytes', 'too_large'],
    ['page.waitForSelector: Timeout 45000ms exceeded', 'timeout'],
    ['Error: parser produced no valid listings (parse)', 'parse'],
  ];
  const zh = createTranslator('zh-TW');
  for (const [message, expected] of cases) {
    assert.equal(safeErrorClass(message), expected, `${message} should classify as ${expected}`);
    const key = sourceErrorMessageKey(expected);
    assert.notEqual(key, 'srcErr.unknown', `${message} must not fall into the catch-all`);
    assert.notEqual(zh(key, { class: expected }), key, `${key} needs a message`);
  }
});

// A byte ceiling small enough to look like a status code must not be read as one.
test('a size limit is never mistaken for an HTTP status', () => {
  assert.equal(safeErrorClass('Error: response exceeds 500 bytes'), 'too_large');
  assert.equal(safeErrorClass('Error: response exceeds 404 bytes'), 'too_large');
});

// Reachable only through the option, so the loop above cannot see it - but a missing translation
// here would still surface Chinese on an English page.
test('the dns-after-success message is translated in all three languages', () => {
  const key = sourceErrorMessageKey('dns', { hasSucceededBefore: true });
  assert.equal(key, 'srcErr.dnsAfterSuccess');
  assert.notEqual(key, sourceErrorMessageKey('dns'), 'prior success must change the advice');
  const zh = createTranslator('zh-TW')(key);
  assert.notEqual(zh, key);
  for (const locale of ['ja', 'en']) {
    const translated = createTranslator(locale)(key);
    assert.notEqual(translated, key, key + ' is missing from the ' + locale + ' catalog');
    assert.notEqual(translated, zh, key + ' falls back to Chinese on ' + locale);
  }
});

test('an unrecognized error class falls back instead of leaking itself into the message', () => {
  assert.equal(sourceErrorMessageKey('no_url'), 'srcErr.unknown');
  assert.equal(sourceErrorMessageKey('BT-SRC-001'), 'srcErr.unknown');
  assert.equal(sourceErrorMessageKey('token=secret https://internal/path'), 'srcErr.unknown');
  assert.equal(sourceErrorMessageKey(null), null);
  // An unexplained status still names itself, so the message is never vaguer than the evidence.
  assert.match(createTranslator('en')(sourceErrorMessageKey('http_418'), { class: 'http_418' }), /http_418/);
});
