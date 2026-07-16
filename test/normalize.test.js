import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl, normalizeWhitespace, toHalfWidth, normalizePrice,
  normalizeCurrency, extractModel, normalizeBarcode,
} from '../src/core/normalize.js';

test('toHalfWidth converts full-width ascii and spaces', () => {
  assert.equal(toHalfWidth('ＢＸ－３８　スターター'), 'BX-38 スターター');
});

test('normalizeWhitespace collapses spaces', () => {
  assert.equal(normalizeWhitespace('  hello   world　x '), 'hello world x');
});

test('normalizeUrl strips tracking params, hash and trailing slash', () => {
  const u = normalizeUrl('https://s.example/p/bx-38/?utm_source=x&id=5#frag');
  assert.equal(u, 'https://s.example/p/bx-38?id=5');
});

test('normalizeUrl sorts query params deterministically', () => {
  assert.equal(
    normalizeUrl('https://s.example/p?b=2&a=1'),
    normalizeUrl('https://s.example/p?a=1&b=2')
  );
});

test('extractModel finds codes across languages', () => {
  assert.equal(extractModel('Beyblade X BX-38 ドランザースパイラル'), 'BX-38');
  assert.equal(extractModel('BEYBLADE X UX 08 Cobalt Dragoon'), 'UX-08');
  assert.equal(extractModel('CX00 デモ'), 'CX-00');
  assert.equal(extractModel('普通の陀螺 no model here'), null);
});

test('normalizePrice parses numbers and detects currency', () => {
  assert.deepEqual(normalizePrice('￥1,200'), { price: 1200, currency: 'JPY' });
  assert.deepEqual(normalizePrice('NT$ 690'), { price: 690, currency: 'TWD' });
  assert.deepEqual(normalizePrice(12.99, 'USD'), { price: 12.99, currency: 'USD' });
  assert.deepEqual(normalizePrice('$15.00'), { price: 15, currency: 'USD' });
});

test('normalizeCurrency maps symbols and codes', () => {
  assert.equal(normalizeCurrency('¥'), 'JPY');
  assert.equal(normalizeCurrency('usd'), 'USD');
});

test('normalizeBarcode keeps valid gtins only', () => {
  assert.equal(normalizeBarcode('4570118488384'), '4570118488384');
  assert.equal(normalizeBarcode('12'), null);
});
