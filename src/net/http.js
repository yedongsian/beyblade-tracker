import { logger } from '../util/logger.js';

// Per-host timestamp of the last request, to enforce a minimum interval.
const lastRequestAt = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(host, minIntervalMs) {
  if (!minIntervalMs) return;
  const now = Date.now();
  const prev = lastRequestAt.get(host) || 0;
  const wait = prev + minIntervalMs - now;
  if (wait > 0) await sleep(wait);
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
  } = options;

  const host = (() => { try { return new URL(url).host; } catch { return url; } })();

  let attempt = 0;
  let lastError;
  while (attempt <= maxRetries) {
    attempt += 1;
    await throttle(host, perHostMinIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en,zh-TW;q=0.8,ja;q=0.7',
          ...headers,
        },
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        throw lastError;
      }
      if (!res.ok) {
        // Non-retryable client error.
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        err.retryable = false;
        throw err;
      }
      const body = await res.text();
      return { url: res.url, status: res.status, body };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (err.retryable === false) throw err;
      if (attempt > maxRetries) break;
      const backoff = Math.min(30000, 500 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 300);
      logger.debug(`fetch retry ${attempt}/${maxRetries} for ${host}: ${err.message}`);
      await sleep(backoff + jitter);
    }
  }
  throw lastError || new Error('fetch failed');
}
