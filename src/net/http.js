import { logger } from '../util/logger.js';

// Per-host timestamp of the last request, to enforce a minimum interval.
const lastRequestAt = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function throttle(host, minIntervalMs, sleepFn = sleep) {
  if (!minIntervalMs) return;
  const now = Date.now();
  const prev = lastRequestAt.get(host) || 0;
  const wait = prev + minIntervalMs - now;
  if (wait > 0) await sleepFn(wait);
  lastRequestAt.set(host, Date.now());
}

/**
 * Fetch text with timeout, a descriptive User-Agent, per-host rate limiting,
 * and bounded retries with exponential backoff + jitter.
 *
 * Retries on network errors and 429/5xx. Does NOT retry on 4xx (except 429).
 */
export async function fetchText(url, options = {}) {
  const {
    timeoutMs = 15000,
    maxRetries = 3,
    userAgent = 'BeybladeTracker/0.1',
    perHostMinIntervalMs = 2000,
    headers = {},
    maxBytes = 2 * 1024 * 1024,
    baseDelayMs = 500,
    maxDelayMs = 30000,
    fetchImpl = fetch,
    sleepFn = sleep,
    randomFn = Math.random,
  } = options;

  const host = (() => { try { return new URL(url).host; } catch { return url; } })();

  let attempt = 0;
  let lastError;
  while (attempt <= maxRetries) {
    attempt += 1;
    await throttle(host, perHostMinIntervalMs, sleepFn);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en,zh-TW;q=0.8,ja;q=0.7',
          ...headers,
        },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        lastError.response = res;
        throw lastError;
      }
      if (!res.ok) {
        // Non-retryable client error.
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.retryable = false;
        throw err;
      }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > maxBytes) {
        const err = new Error(`response exceeds ${maxBytes} bytes`);
        err.retryable = false;
        throw err;
      }
      const body = await res.text();
      if (Buffer.byteLength(body) > maxBytes) {
        const err = new Error(`response exceeds ${maxBytes} bytes`);
        err.retryable = false;
        throw err;
      }
      clearTimeout(timer);
      return { url: res.url, status: res.status, body };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (err.retryable === false) throw err;
      if (attempt > maxRetries) break;
      logger.debug(`fetch retry ${attempt}/${maxRetries} for ${host}: ${err.message}`);
      await sleepFn(retryDelay(err.response, attempt - 1, { baseDelayMs, maxDelayMs, randomFn }));
    }
  }
  throw lastError || new Error('fetch failed');
}
