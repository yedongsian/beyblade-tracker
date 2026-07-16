import { detectTextLocale, normalizeUnicode, toHalfWidth } from './normalize.js';

export const STATES = {
  DISCOVERED: 'discovered',
  COMING_SOON: 'coming_soon',
  PREORDER: 'preorder',
  IN_STOCK: 'in_stock',
  OUT_OF_STOCK: 'out_of_stock',
  UNKNOWN: 'unknown',
};

// Map a schema.org ItemAvailability value to our internal state.
const SCHEMA_AVAILABILITY = {
  instock: STATES.IN_STOCK,
  limitedavailability: STATES.IN_STOCK,
  onlineonly: STATES.IN_STOCK,
  instoreonly: STATES.IN_STOCK,
  outofstock: STATES.OUT_OF_STOCK,
  soldout: STATES.OUT_OF_STOCK,
  discontinued: STATES.OUT_OF_STOCK,
  preorder: STATES.PREORDER,
  backorder: STATES.PREORDER,
  presale: STATES.COMING_SOON,
};

function normalizeSchemaAvailability(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().replace(/^https?:\/\/schema\.org\//, '').replace(/[^a-z]/g, '');
  return SCHEMA_AVAILABILITY[key] || null;
}

export const AVAILABILITY_TERMS = {
  'zh-TW': {
    out_of_stock: ['缺貨', '售罄', '完售', '補貨中', '無庫存'],
    preorder: ['預購', '預訂'],
    coming_soon: ['即將推出', '即將發售'],
    in_stock: ['現貨', '有貨', '可購買', '加入購物車'],
  },
  ja: {
    out_of_stock: ['品切', '在庫なし', '入荷待ち', '販売休止中', '販売終了', '予約終了', '再入荷予定なし'],
    preorder: ['予約受付中', '予約販売', '予約'],
    coming_soon: ['近日発売', '発売予定'],
    in_stock: ['在庫あり', '販売中', 'カートに入れる'],
  },
  en: {
    out_of_stock: ['out of stock', 'sold out', 'no longer', 'discontinued'],
    preorder: ['pre-order', 'preorder'],
    coming_soon: ['coming soon'],
    in_stock: ['in stock', 'add to cart', 'buy now'],
  },
};

const STATE_ORDER = [STATES.OUT_OF_STOCK, STATES.PREORDER, STATES.COMING_SOON, STATES.IN_STOCK];

export function matchAvailabilityText(raw) {
  const text = normalizeUnicode(raw || '').toLocaleLowerCase('en-US');
  for (const state of STATE_ORDER) {
    for (const [locale, dictionary] of Object.entries(AVAILABILITY_TERMS)) {
      const terms = dictionary[state] || [];
      const matched = terms.find((term) => text.includes(normalizeUnicode(term).toLocaleLowerCase('en-US')));
      if (matched) return { state, locale, term: matched };
    }
  }
  return null;
}

const EXCLUSION_RULES = [
  { reason: 'used', re: /(\bused\b|中古|二手|中古品|ジャンク)/i },
  { reason: 'parts_only', re: /(parts only|拆售|拆賣|單賣零件|バラ売り|パーツのみ)/i },
  { reason: 'accessory', re: /(replacement part|spare parts|收納|display case|stand only)/i },
];

/**
 * Decide whether a listing should be excluded from tracking.
 * Returns a reason string or null.
 */
export function exclusionReason(listing) {
  const hay = toHalfWidth([listing.title, listing.rawText].filter(Boolean).join(' '));
  for (const rule of EXCLUSION_RULES) {
    if (rule.re.test(hay)) return rule.reason;
  }
  return null;
}

/**
 * Compute an availability state and a 0..1 confidence from the signals a
 * connector collected. Structured schema.org data is trusted most, then
 * explicit buy buttons, then free text.
 */
export function computeAvailability(listing) {
  const signals = [];
  let state = STATES.UNKNOWN;
  let confidence = 0.2;

  const schemaState = normalizeSchemaAvailability(listing.availabilityRaw);
  if (schemaState) {
    state = schemaState;
    confidence = 0.85;
    signals.push('schema');
  }

  const text = toHalfWidth([listing.availabilityText, listing.title, listing.rawText].filter(Boolean).join(' '));
  const textMatch = matchAvailabilityText(text);
  const textState = textMatch?.state || null;

  if (!schemaState && textState) {
    state = textState;
    confidence = 0.6;
    signals.push('text');
  } else if (schemaState && textState) {
    if (textState === schemaState) {
      confidence = Math.min(0.98, confidence + 0.1);
      signals.push('text-agree');
    } else {
      // Conflicting signals: keep schema but lower confidence.
      confidence = Math.max(0.5, confidence - 0.15);
      signals.push('text-conflict');
    }
  }

  if (listing.hasBuyButton === true) {
    signals.push('buy-button');
    if (state === STATES.UNKNOWN) { state = STATES.IN_STOCK; confidence = Math.max(confidence, 0.5); }
    else if (state === STATES.IN_STOCK) confidence = Math.min(0.98, confidence + 0.05);
  }

  if (Number.isFinite(listing.price)) {
    signals.push('price');
    confidence = Math.min(0.98, confidence + 0.05);
  }

  return {
    state, confidence: Number(confidence.toFixed(2)), signals,
    locale: textMatch?.locale || detectTextLocale(text), matchedTerm: textMatch?.term || null,
  };
}

/**
 * Whether a state counts as "purchasable" for events/notifications.
 * preorder is configurable.
 */
export function isPurchasable(state, { preorderIsPurchasable = false } = {}) {
  if (state === STATES.IN_STOCK) return true;
  if (state === STATES.PREORDER && preorderIsPurchasable) return true;
  return false;
}
