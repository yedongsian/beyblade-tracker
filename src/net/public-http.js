import { lookup } from 'node:dns/promises';
import { assertSafeHostname, isPrivateAddress, UrlValidationError } from '../core/site.js';

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
  } = options;
  let url = new URL(input);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicUrl(url, { lookupFn });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
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
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`網站回傳 HTTP ${response.status}，但沒有重新導向位置。`);
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`網站回傳 HTTP ${response.status}。`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('頁面超過預覽大小限制。');
    const body = await response.text();
    if (Buffer.byteLength(body) > maxBytes) throw new Error('頁面超過預覽大小限制。');
    return { url: response.url || url.toString(), status: response.status, body };
  }
  throw new Error(`網站重新導向超過 ${maxRedirects} 次。`);
}
