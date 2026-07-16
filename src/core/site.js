import { isIP } from 'node:net';

// Common multi-label public suffixes used by the tracker markets. The resolver
// accepts overrides so a future UI/recipe can handle exceptional sites.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.jp', 'ne.jp', 'or.jp', 'com.tw', 'net.tw', 'org.tw', 'co.uk', 'org.uk',
  'com.au', 'net.au', 'co.nz', 'com.sg', 'com.hk', 'com.my', 'co.kr', 'co.th',
]);

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'ref', 'ref_', 'spm', '_ga', 'mc_cid', 'mc_eid',
]);
const DISPLAY_PARAMS = new Set(['wovn']);

export class UrlValidationError extends Error {
  constructor(message, code = 'invalid_url') {
    super(message);
    this.name = 'UrlValidationError';
    this.code = code;
  }
}

function normalizeSeedUrl(input, { stripWww, stripDisplayParams = false }) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch {
    throw new UrlValidationError('請輸入完整網址，例如 https://store.example/product。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UrlValidationError('只支援 HTTP 或 HTTPS 網址。', 'unsupported_protocol');
  }
  if (url.username || url.password) {
    throw new UrlValidationError('網址不可包含帳號或密碼。', 'credentials_not_allowed');
  }
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  if (stripWww) url.hostname = url.hostname.replace(/^www\./, '');
  url.port = '';
  url.hash = '';
  const entries = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()) &&
      !(stripDisplayParams && DISPLAY_PARAMS.has(key.toLowerCase())))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function canonicalizeSeedUrl(input) {
  return normalizeSeedUrl(input, { stripWww: true, stripDisplayParams: true });
}

export function fetchableSeedUrl(input) {
  return normalizeSeedUrl(input, { stripWww: false });
}

export function registrableDomain(input, { overrides = {} } = {}) {
  const url = input instanceof URL ? input : new URL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (overrides[host]) return overrides[host];
  if (isIP(host) || host === 'localhost') return host;
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return host;
  const suffix2 = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(suffix2)
    ? labels.slice(-3).join('.')
    : labels.slice(-2).join('.');
}

export function sourceKeyForDomain(domain) {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function displayNameForDomain(domain) {
  const label = domain.split('.')[0] || domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function isPrivateAddress(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  const parts = normalized.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function assertSafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal')) {
    throw new UrlValidationError('基於安全考量，不能連線到本機或內部網路位址。', 'private_address');
  }
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UrlValidationError('基於安全考量，不能連線到本機或內部網路位址。', 'private_address');
  }
  return host;
}
