// Pure, side-effect-free scheduling helpers. Each enabled source respects its
// own check_interval_seconds instead of the worker crawling every source on the
// shortest interval. Kept dependency-free so they are trivial to unit test.

const DEFAULT_INTERVAL_SECONDS = 3600;

function intervalSeconds(source, defaultIntervalSeconds) {
  const raw = Number(source?.check_interval_seconds);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultIntervalSeconds;
}

// Epoch ms of the most recent crawl attempt (success or failure), or null if a
// source has never been crawled.
function lastAttemptMs(source) {
  const times = [source?.last_success_at, source?.last_failure_at]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((n) => Number.isFinite(n));
  return times.length ? Math.max(...times) : null;
}

/**
 * Epoch ms when a source is next due to be crawled. A source that has never
 * been crawled is due immediately (returns 0).
 */
export function nextDueAt(source, { defaultIntervalSeconds = DEFAULT_INTERVAL_SECONDS } = {}) {
  const last = lastAttemptMs(source);
  if (last == null) return 0;
  return last + intervalSeconds(source, defaultIntervalSeconds) * 1000;
}

export function isSourceDue(source, nowMs, opts) {
  return nextDueAt(source, opts) <= nowMs;
}

// The subset of `sources` whose own interval has elapsed by `nowMs`.
export function dueSources(sources, nowMs, opts) {
  return sources.filter((s) => isSourceDue(s, nowMs, opts));
}

/**
 * Seconds until the earliest source becomes due, or null when there are no
 * sources. Never negative; a source already due returns 0.
 */
export function secondsUntilNextDue(sources, nowMs, opts) {
  if (!sources || sources.length === 0) return null;
  let earliest = Infinity;
  for (const s of sources) earliest = Math.min(earliest, nextDueAt(s, opts));
  if (!Number.isFinite(earliest)) return null;
  return Math.max(0, Math.ceil((earliest - nowMs) / 1000));
}

/**
 * Delay (seconds) the worker should sleep before its next tick. Clamped to
 * [minSeconds, maxSeconds] so it wakes at least periodically to pick up config
 * changes even when everything is far from due.
 */
export function workerDelaySeconds(sources, {
  nowMs = Date.now(), minSeconds = 30, maxSeconds = 3600, defaultIntervalSeconds,
} = {}) {
  const until = secondsUntilNextDue(sources, nowMs, { defaultIntervalSeconds });
  const target = until == null ? maxSeconds : until;
  return Math.min(maxSeconds, Math.max(minSeconds, target));
}
