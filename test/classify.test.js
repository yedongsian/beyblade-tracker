import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailability, exclusionReason, isPurchasable, STATES } from '../src/core/classify.js';

test('schema.org availability maps to states with high confidence', () => {
  const a = computeAvailability({ availabilityRaw: 'https://schema.org/InStock' });
  assert.equal(a.state, STATES.IN_STOCK);
  assert.ok(a.confidence >= 0.8);

  assert.equal(computeAvailability({ availabilityRaw: 'https://schema.org/OutOfStock' }).state, STATES.OUT_OF_STOCK);
  assert.equal(computeAvailability({ availabilityRaw: 'PreOrder' }).state, STATES.PREORDER);
});

test('text hints classify when no structured data', () => {
  assert.equal(computeAvailability({ availabilityText: '缺貨' }).state, STATES.OUT_OF_STOCK);
  assert.equal(computeAvailability({ availabilityText: '予約受付中 preorder' }).state, STATES.PREORDER);
  assert.equal(computeAvailability({ title: '現貨 add to cart' }).state, STATES.IN_STOCK);
});

test('Japanese suspended and ended reservation text is out of stock', () => {
  assert.equal(computeAvailability({ availabilityText: '販売休止中です' }).state, STATES.OUT_OF_STOCK);
  assert.equal(computeAvailability({ availabilityText: '予約終了 再入荷予定なし' }).state, STATES.OUT_OF_STOCK);
  assert.equal(computeAvailability({ availabilityText: '予約受付中' }).state, STATES.PREORDER);
});

test('buy button raises confidence / infers in stock', () => {
  const a = computeAvailability({ hasBuyButton: true, price: 10 });
  assert.equal(a.state, STATES.IN_STOCK);
});

test('unknown when no signals', () => {
  assert.equal(computeAvailability({}).state, STATES.UNKNOWN);
});

test('exclusion detects used and parts-only', () => {
  assert.equal(exclusionReason({ title: 'BX-38 中古 used' }), 'used');
  assert.equal(exclusionReason({ title: 'BX-38 パーツのみ parts only' }), 'parts_only');
  assert.equal(exclusionReason({ title: 'BX-38 brand new starter' }), null);
});

test('isPurchasable respects preorder config', () => {
  assert.equal(isPurchasable(STATES.IN_STOCK), true);
  assert.equal(isPurchasable(STATES.PREORDER), false);
  assert.equal(isPurchasable(STATES.PREORDER, { preorderIsPurchasable: true }), true);
});
