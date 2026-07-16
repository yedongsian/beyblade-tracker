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
