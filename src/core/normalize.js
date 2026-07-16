// Text / url / price / model normalization utilities.

// Convert full-width ASCII and full-width spaces to half-width.
export function toHalfWidth(str) {
  if (!str) return str;
  return str
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

export function normalizeWhitespace(str) {
  if (!str) return str;
  return toHalfWidth(String(str)).replace(/\s+/g, ' ').trim();
}

// Normalize a URL: drop hash, strip common tracking params, sort remaining.
export function normalizeUrl(input, base) {
  if (!input) return input;
  let url;
  try {
    url = new URL(input, base);
  } catch {
    return String(input).trim();
  }
  url.hash = '';
  const drop = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'ref', 'ref_', 'spm', '_ga',
  ]);
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !drop.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of params) url.searchParams.append(k, v);
  // Remove trailing slash on the path (but keep root).
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

const CURRENCY_SYMBOLS = {
  '$': 'USD', 'US$': 'USD', 'NT$': 'TWD', 'HK$': 'HKD', 'A$': 'AUD',
  '¥': 'JPY', '￥': 'JPY', '円': 'JPY', '€': 'EUR', '£': 'GBP', '₩': 'KRW',
  'RM': 'MYR', 'S$': 'SGD', '฿': 'THB', '₫': 'VND', '₱': 'PHP',
};

export function normalizeCurrency(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  const cleaned = toHalfWidth(trimmed);
  // Check longer symbols first so "NT$" is not swallowed by "$".
  const symbols = Object.entries(CURRENCY_SYMBOLS).sort((a, b) => b[0].length - a[0].length);
  for (const [sym, code] of symbols) {
    if (cleaned.includes(sym)) return code;
  }
  return trimmed.toUpperCase();
}

// Parse a price from mixed strings/numbers. Returns { price, currency } | {}.
export function normalizePrice(raw, currencyHint) {
  if (raw == null) return {};
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { price: raw, currency: currencyHint ? normalizeCurrency(currencyHint) : null };
  }
  const text = toHalfWidth(String(raw)).trim();
  if (!text) return {};
  // Detect currency from the text if not provided.
  let currency = currencyHint ? normalizeCurrency(currencyHint) : null;
  if (!currency) {
    const symMatch = text.match(/US\$|NT\$|HK\$|A\$|S\$|RM|[A-Z]{3}|[$¥￥€£₩฿₫₱]|円/);
    if (symMatch) currency = normalizeCurrency(symMatch[0]);
  }
  // Extract the numeric portion. Handle thousands separators.
  const numMatch = text.replace(/[, ]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) return { currency };
  const price = Number(numMatch[0]);
  if (!Number.isFinite(price)) return { currency };
  return { price, currency };
}

// Known Beyblade model prefixes across BeybladeX / Burst / Metal lines.
const MODEL_PREFIXES = ['BX', 'CX', 'UX', 'B', 'CB', 'SB', 'BB', 'BBG', 'WBBA', 'GT', 'SL'];
const MODEL_REGEX = new RegExp(
  `\\b(${MODEL_PREFIXES.join('|')})[\\-\\s]?(\\d{2,3})\\b`,
  'i'
);

/**
 * Extract a normalized model code (e.g. "BX-38") from a title in
 * Chinese / English / Japanese. Returns null when none is found.
 */
export function extractModel(title) {
  if (!title) return null;
  const text = toHalfWidth(String(title));
  const match = text.match(MODEL_REGEX);
  if (!match) return null;
  const prefix = match[1].toUpperCase();
  const number = match[2];
  return `${prefix}-${number}`;
}

export function normalizeBarcode(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}
