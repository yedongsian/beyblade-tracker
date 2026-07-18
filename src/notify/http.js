function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response, nowMs, maxDelayMs) {
  const raw = response?.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(maxDelayMs, Math.max(0, seconds * 1000));
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(maxDelayMs, Math.max(0, date - nowMs));
  return null;
}

/** POST JSON with a hard timeout and bounded retries for 429/5xx/network errors. */
export async function postJsonWithRetry(url, payload, options = {}) {
  const {
    timeoutMs = 10000,
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 30000,
    fetchImpl = fetch,
    sleepFn = defaultSleep,
    randomFn = Math.random,
    nowFn = Date.now,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (response?.ok) return response;
    const retryableResponse = response && (response.status === 429 || response.status >= 500);
    if (response && !retryableResponse) return response;
    if (attempt >= maxRetries) {
      if (response) return response;
      throw lastError || new Error('notification request failed');
    }

    const headerDelay = retryAfterMs(response, nowFn(), maxDelayMs);
    const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    const jitter = Math.floor(randomFn() * Math.min(300, baseDelayMs));
    await sleepFn(headerDelay ?? Math.min(maxDelayMs, exponential + jitter));
  }
  throw lastError || new Error('notification request failed');
}
