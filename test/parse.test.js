import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseProductPage, extractJsonLd, isUsableListing, detectMaintenance, classifyParsedPage,
} from '../src/connectors/parse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, '..', 'fixtures', 'html', name), 'utf8');

test('parses JSON-LD Product/Offer', () => {
  const html = fixture('product-jsonld.html');
  const blocks = extractJsonLd(html);
  assert.ok(blocks.length >= 1);
  const listing = parseProductPage(html, { url: 'https://example.com/products/bx-34' });
  assert.match(listing.title, /BX-34/);
  assert.equal(listing.barcode, '4904810189992');
  assert.equal(listing.sku, 'BX-34');
  assert.equal(String(listing.price), '1200');
  assert.equal(listing.currency, 'JPY');
  assert.equal(listing.availabilityRaw, 'https://schema.org/InStock');
  assert.equal(listing.releaseDate, '2024-08-10');
});

test('falls back to CSS selectors when JSON-LD absent', () => {
  const html = fixture('product-css-fallback.html');
  const listing = parseProductPage(html, {
    url: 'https://example.com/products/ux-08',
    selectors: {
      title: '#title',
      price: '.money',
      availabilityText: '.stock-status',
      buyButton: 'button.buy',
    },
  });
  assert.match(listing.title, /UX-08/);
  assert.match(String(listing.price), /690/);
  assert.match(listing.availabilityText, /現貨|In stock/);
  assert.equal(listing.hasBuyButton, true);
});

test('disabled and aria-disabled buy buttons are not availability signals', () => {
  const disabled = parseProductPage(
    '<h1>BX-99</h1><button class="buy" disabled>Add to cart</button>',
    { url: 'https://example.com/bx-99', selectors: { title: 'h1', buyButton: '.buy' } }
  );
  assert.equal(disabled.hasBuyButton, false);

  const ariaDisabled = parseProductPage(
    '<h1>BX-98</h1><button class="buy" aria-disabled="true">Add to cart</button>',
    { url: 'https://example.com/bx-98', selectors: { title: 'h1', buyButton: '.buy' } }
  );
  assert.equal(ariaDisabled.hasBuyButton, false);

  const enabled = parseProductPage(
    '<h1>BX-97</h1><button class="buy">Add to cart</button>',
    { url: 'https://example.com/bx-97', selectors: { title: 'h1', buyButton: '.buy' } }
  );
  assert.equal(enabled.hasBuyButton, true);
});

test('isUsableListing requires at least one identifying or pricing field', () => {
  assert.equal(isUsableListing(null), false);
  assert.equal(isUsableListing({ url: 'https://x/1', rawText: 'welcome' }), false);
  assert.equal(isUsableListing({ url: 'https://x/1', title: 'BX-38' }), true);
  assert.equal(isUsableListing({ url: 'https://x/1', price: 0 }), true);
  assert.equal(isUsableListing({ url: 'https://x/1', availabilityText: 'In stock' }), true);
});

test('detectMaintenance flags multilingual outage pages but not product pages', () => {
  assert.equal(detectMaintenance('<title>メンテナンス中</title>'), true);
  assert.equal(detectMaintenance('<html><body><h1>網站維護中</h1></body></html>'), true);
  assert.equal(detectMaintenance('<html><body>We\'ll be back soon</body></html>'), true);
  assert.equal(detectMaintenance('<html><body><h1>Beyblade X BX-38</h1><p>In stock</p></body></html>'), false);
  assert.equal(detectMaintenance(''), false);
});

test('classifyParsedPage distinguishes ok, maintenance and empty pages', () => {
  const ok = parseProductPage(
    '<script type="application/ld+json">{"@type":"Product","name":"BX-38","offers":{"@type":"Offer","price":"1080","priceCurrency":"JPY","availability":"https://schema.org/InStock"}}</script>',
    { url: 'https://x/1' }
  );
  assert.equal(classifyParsedPage('<h1>BX-38</h1>', ok), 'ok');

  const maintenanceHtml = '<html><head><title>ただいまメンテナンス中です</title></head><body></body></html>';
  assert.equal(classifyParsedPage(maintenanceHtml, parseProductPage(maintenanceHtml, { url: 'https://x/2' })), 'maintenance');

  const emptyHtml = '<html><head><title>Store</title></head><body><p>Welcome</p></body></html>';
  assert.equal(classifyParsedPage(emptyHtml, parseProductPage(emptyHtml, { url: 'https://x/3' })), 'empty');
});
