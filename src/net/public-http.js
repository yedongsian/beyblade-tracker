import { lookup } from 'node:dns/promises';
import { assertSafeHostname, isPrivateAddress, UrlValidationError } from '../core/site.js';

const lastPublicRequestAt = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function throttle(host, minIntervalMs, sleepFn) {
  if (!minIntervalMs) return;
  const wait = (lastPublicRequestAt.get(host) || 0) + minIntervalMs - Date.now();
  if (wait > 0) await sleepFn(wait);
  lastPublicRequestAt.set(host, Date.now());
}

function retryDelay(response, attempt, { baseDelayMs, maxDelayMs, randomFn }) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(maxDelayMs, Math.max(0, seconds * 1000));
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.min(maxDelayMs, Math.max(0, date - Date.now()));
  }
  return Math.min(maxDelayMs, baseDelayMs * (2 ** attempt) + Math.floor(randomFn() * 300));
}

export async function assertPublicUrl(input, { lookupFn = lookup } = {}) {
  const url = new URL(input);
  assertSafeHostname(url.hostname);
  if (!/^https?:$/.test(url.protocol)) throw new UrlValidationError('只支援 HTTP 或 HTTPS 網址。');
  const addresses = await lookupFn(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UrlValidationError('這個網址解析到本機或內部網路，已停止連線。', 'private_address');
  }
  return url;
}

export async function fetchPublicText(input, options = {}) {
  const {
    timeoutMs = 12000, maxRedirects = 3, maxBytes = 2 * 1024 * 1024,
    userAgent = 'BeybladeTracker/0.1 (+personal-use)', lookupFn, fetchImpl = fetch,
    maxRetries = 3, perHostMinIntervalMs = 1000, baseDelayMs = 500, maxDelayMs = 30000,
    sleepFn = sleep, randomFn = Math.random,
  } = options;
  let url = new URL(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    let redirected = false;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      await assertPublicUrl(url, { lookupFn });
      await throttle(url.host, perHostMinIntervalMs, sleepFn);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      let response;
      let requestError;
      try {
        response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-TW,ja;q=0.8,en;q=0.7',
          },
        });
      } catch (error) {
        requestError = error;
      }
      if (response && [301, 302, 303, 307, 308].includes(response.status)) {
        clearTimeout(timer);
        const location = response.headers.get('location');
        if (!location) throw new Error(`網站回傳 HTTP ${response.status}，但沒有重新導向位置。`);
        url = new URL(location, url);
        redirected = true;
        break;
      }
      const retryable = !response || response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        clearTimeout(timer);
        await sleepFn(retryDelay(response, attempt, { baseDelayMs, maxDelayMs, randomFn }));
        continue;
      }
      if (!response) {
        clearTimeout(timer);
        throw requestError || new Error('網站連線失敗。');
      }
      if (!response.ok) {
        clearTimeout(timer);
        throw new Error(`網站回傳 HTTP ${response.status}。`);
      }
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maxBytes) {
        clearTimeout(timer);
        throw new Error('頁面超過預覽大小限制。');
      }
      let body;
      let bodyError;
      try {
        body = await response.text();
      } catch (error) {
        bodyError = error;
      } finally {
        clearTimeout(timer);
      }
      if (bodyError) {
        if (attempt < maxRetries) {
          await sleepFn(retryDelay(null, attempt, { baseDelayMs, maxDelayMs, randomFn }));
          continue;
        }
        throw bodyError;
      }
      if (Buffer.byteLength(body) > maxBytes) throw new Error('頁面超過預覽大小限制。');
      return { url: response.url || url.toString(), status: response.status, body };
    }
    if (redirected) continue;
  }
  throw new Error(`網站重新導向超過 ${maxRedirects} 次。`);
}
