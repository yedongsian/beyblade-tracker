// Text / url / price / model normalization utilities.

// Convert full-width ASCII and full-width spaces to half-width.
export function toHalfWidth(str) {
  if (!str) return str;
  return str
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

// Unicode NFKC covers full-width forms and compatibility characters used by
// Japanese/Chinese storefronts. Dash variants are normalized separately so
// aliases and model numbers compare deterministically.
export function normalizeUnicode(str) {
  if (str == null) return str;
  return String(str).normalize('NFKC')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

export function normalizeWhitespace(str) {
  if (!str) return str;
  return toHalfWidth(normalizeUnicode(str)).replace(/\s+/g, ' ').trim();
}


export function normalizeAlias(str) {
  const text = normalizeWhitespace(str);
  if (!text) return '';
  return text.toLocaleLowerCase('en-US')
    .replace(/\s*-\s*/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectTextLocale(str) {
  const text = String(str || '');
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/\p{Script=Han}/u.test(text)) return 'zh-TW';
  return 'en';
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

export function normalizeSku(raw) {
  if (raw == null) return null;
  const value = normalizeUnicode(String(raw))
    .toLocaleUpperCase('en-US')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}-]+/gu, '');
  return value || null;
}

const EDITION_TERMS = [
  ['limited', /(?:限定|limited(?: edition)?|exclusive|イベント限定|會場限定|会場限定)/iu],
  ['rare-color', /(?:レアカラー|rare color|稀有色)/iu],
];

const COLOR_TERMS = [
  ['clear', /(?:\bclear\b|クリア|透明)/iu],
  ['red', /(?:\bred\b|レッド|紅色|赤色?)/iu],
  ['blue', /(?:\bblue\b|ブルー|藍色|青色?)/iu],
  ['black', /(?:\bblack\b|ブラック|黑色|黒色?)/iu],
  ['white', /(?:\bwhite\b|ホワイト|白色?)/iu],
  ['gold', /(?:\bgold\b|ゴールド|金色)/iu],
  ['silver', /(?:\bsilver\b|シルバー|銀色)/iu],
  ['green', /(?:\bgreen\b|グリーン|綠色|緑色?)/iu],
  ['purple', /(?:\bpurple\b|パープル|紫色?)/iu],
  ['pink', /(?:\bpink\b|ピンク|粉紅色|桃色)/iu],
];

/**
 * Extract only explicit edition/color markers. A null key means the listing
 * did not provide enough evidence to identify a distinct variant.
 */
export function extractVariantKey(...values) {
  const text = normalizeUnicode(values.filter(Boolean).join(' '));
  if (!text) return null;
  const matched = EDITION_TERMS.filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
  const hasVariantContext = matched.length > 0 || /(?:color|colour|カラー|色違い|異色|配色)/iu.test(text);
  for (const [key, pattern] of COLOR_TERMS) {
    if (!pattern.test(text)) continue;
    const terminal = new RegExp(`(?:${pattern.source})(?:\\s|[）)\\]】])*$`, pattern.flags).test(text);
    if (hasVariantContext || terminal) matched.push(key);
  }
  return matched.length ? [...new Set(matched)].sort().join('|') : null;
}

export function detectTaxInclusion(...values) {
  const text = normalizeUnicode(values.filter(Boolean).join(' ')).toLocaleLowerCase('en-US');
  if (/(税込|含稅|含税|tax included|including tax|inc\.? vat)/i.test(text)) return true;
  if (/(税抜|稅前|未稅|未税|tax excluded|excluding tax|excl\.? vat)/i.test(text)) return false;
  return null;
}

export function normalizeReleaseDate(raw) {
  if (!raw) return null;
  const text = normalizeUnicode(raw).trim()
    .replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/, '$1-$2-$3')
    .replace(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/, '$1-$2-$3');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${result}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== result ? null : result;
}

export function normalizeDateTime(raw, { defaultOffset = '+00:00' } = {}) {
  if (!raw) return null;
  let text = normalizeUnicode(raw).trim();
  const local = text.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, m, d, h, min, sec = '00'] = local;
    text = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${min}:${sec}${defaultOffset}`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
