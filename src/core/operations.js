// Local-first operational observability (BT-P1-002).
//
// Records structured operation events into a bounded local table and derives
// privacy-safe metrics (latest success, consecutive failures, parser failure
// rate, queue state, stale/archived counts). Nothing here leaves the machine
// and nothing recorded contains credentials, full URLs, raw log lines, or
// product history — only bounded labels, counts, timestamps and durations.

import { randomBytes } from 'node:crypto';
import { logger } from '../util/logger.js';

const isoNow = () => new Date().toISOString();

export const OPERATION_COMPONENTS = Object.freeze([
  'source', 'parser', 'notification', 'update', 'discovery', 'monitor',
]);

export const OPERATION_STATUSES = Object.freeze(['success', 'failed', 'skipped']);

// Per-component operation allowlist. Any operation not listed here for its
// component is coerced to the bounded sentinel below, so an unexpected or
// attacker-influenced operation name can never reach the DB, log or API.
export const OPERATION_OPERATIONS = Object.freeze({
  source: ['monitor', 'crawl', 'refresh'],
  parser: ['extract'],
  notification: ['send'],
  update: ['check', 'check_available', 'defer', 'resume', 'apply', 'install',
    'rollback_accepted', 'rollback_running', 'rollback_succeeded', 'rollback_failed'],
  discovery: ['scan', 'candidate'],
  monitor: ['run', 'enqueue'],
});

// Bounded fallbacks used when an input is not on its allowlist.
const OPERATION_COMPONENT_FALLBACK = 'monitor';
const OPERATION_STATUS_FALLBACK = 'skipped';
const OPERATION_NAME_FALLBACK = 'other';

// Length limits enforced on free-form fields before persistence/logging.
const MAX_SOURCE_KEY_LENGTH = 64;
const MAX_CORRELATION_ID_LENGTH = 64;
const MAX_ERROR_CLASS_LENGTH = 40;
const MAX_EVENT_COUNT = 1_000_000;
const MAX_AGGREGATE_COUNT = Number.MAX_SAFE_INTEGER;

// The complete set of bounded, known-safe error-class labels that
// safeErrorClass can emit as fixed strings. Combined with the http_NNN and
// BT-<AREA>-<N> patterns, this is the allowlist for any error class we store.
const KNOWN_ERROR_CLASSES = new Set([
  'unknown', 'timeout', 'dns', 'connection', 'tls', 'robots_blocked',
  'access_blocked', 'network_paused', 'parse', 'not_found', 'validation', 'error',
  // Parser outcome qualifiers (BT-P1-002-FIX-01): bounded, content-free labels
  // that distinguish "no page to parse", a maintenance page, and a crawl that
  // produced some usable listings alongside invalid/failed rows.
  'no_url', 'maintenance', 'empty', 'partial',
  // A page that blew past the download ceiling: distinct from a parse failure, because the fix is
  // to point at a lighter page rather than to adjust selectors.
  'too_large',
  // Discovery ran but recognised nothing: the fix is to adjust the Recipe, not the URL.
  'no_candidates',
]);

function isKnownErrorClass(value) {
  return KNOWN_ERROR_CLASSES.has(value)
    || /^http_\d{3}$/.test(value)
    || /^BT-[A-Z]+-\d+$/.test(value);
}

function fromAllowlist(value, allowed, fallback) {
  const raw = value == null ? '' : String(value);
  return allowed.includes(raw) ? raw : fallback;
}

function safeComponent(component) {
  return fromAllowlist(component, OPERATION_COMPONENTS, OPERATION_COMPONENT_FALLBACK);
}

function safeStatus(status) {
  return fromAllowlist(status, OPERATION_STATUSES, OPERATION_STATUS_FALLBACK);
}

function safeOperation(component, operation) {
  const allowed = OPERATION_OPERATIONS[component] || [];
  return fromAllowlist(operation, allowed, OPERATION_NAME_FALLBACK);
}

// Keep only key-safe characters, bound the length, and drop empties to NULL.
function safeSourceKey(value) {
  if (value == null) return null;
  const raw = String(value);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(raw)
    && !/^(?:https?|ftp):|token|secret|password|credential|api[_-]?key/i.test(raw) ? raw : null;
}

// Accept a caller-supplied correlation id only if it is already a bounded,
// opaque token; otherwise mint a fresh valid one so nothing arbitrary is stored.
function safeCorrelationId(value) {
  const raw = value == null ? '' : String(value);
  const pattern = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_CORRELATION_ID_LENGTH}}$`);
  return pattern.test(raw) ? raw : newCorrelationId();
}

function safeTimestamp(value) {
  const raw = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw) ? raw : null;
}

/**
 * Normalize any explicit errorClass input to a bounded, known-safe class.
 * Known labels (and the http_NNN / BT-<AREA>-<N> patterns) pass through; any
 * other string — including URLs, tokens or free text — is reduced through the
 * same privacy-safe reducer and, failing that, collapsed to the generic class.
 */
function normalizeErrorClass(value) {
  if (value == null || value === '') return null;
  const raw = String(value);
  if (raw.length <= MAX_ERROR_CLASS_LENGTH && isKnownErrorClass(raw)) return raw;
  const reduced = safeErrorClass(raw);
  return isKnownErrorClass(reduced) ? reduced : 'error';
}

// Bounded local retention: keep the most recent N rows so the table can never
// grow without limit on a long-running install.
export const OPERATION_EVENT_MAX_ROWS = 5000;

// Default window used for rate calculations (7 days).
export const OPERATION_METRICS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const OPERATIONS_SLO = Object.freeze({
  sourceFailureStreak: 3,
  parserFailureRate: 0.10,
  notificationFailureRate: 0.10,
  failedNotifications: 1,
  monitorQueue: 50,
  staleOfferRate: 0.20,
});

export function newCorrelationId() {
  return randomBytes(9).toString('base64url');
}

/**
 * Reduce any error into a short, bounded, privacy-safe class label. The label
 * is derived from the error name/code and well-known patterns; the raw message
 * is never returned, so URLs, tokens and free text can never leak through it.
 */
export function safeErrorClass(error) {
  if (!error) return 'unknown';
  if (typeof error === 'object') {
    if (typeof error.errorClass === 'string' && error.errorClass) return normalizeErrorClass(error.errorClass) || 'error';
    // Stable application codes (e.g. BT-UPD-005) are already safe references.
    if (typeof error.code === 'string' && /^BT-[A-Z]+-\d+$/.test(error.code)) return error.code;
  }
  const name = typeof error === 'object' && error.name && error.name !== 'Error' ? error.name : null;
  const code = typeof error === 'object' && typeof error.code === 'string' ? error.code : '';
  const message = typeof error === 'string' ? error : String(error?.message || '');
  const haystack = `${code} ${message}`;

  const httpStatus = haystack.match(/\b(?:HTTP\s*|status\s*|status[_-]?code[=:\s]*)(\d{3})\b/i);
  if (httpStatus) return `http_${httpStatus[1]}`;
  // Ahead of the loose status heuristic below: src/net/http.js raises "response exceeds N bytes",
  // and a three-digit N would otherwise be read as a status code.
  if (/exceeds \d+ bytes|too large|size limit|超過.*大小/i.test(haystack)) return 'too_large';
  if (/\b(4\d\d|5\d\d)\b/.test(message) && /http|status|response|request/i.test(message)) {
    return `http_${message.match(/\b([45]\d\d)\b/)[1]}`;
  }
  if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(haystack)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(haystack)) return 'dns';
  // 'fetch failed' is what undici reports for most offline and unreachable-host cases, and it is
  // the failure a home user hits most often, so it must not land in the generic bucket.
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|network|fetch failed/i.test(haystack)) return 'connection';
  if (/certificate|self[- ]signed|TLS|SSL|ERR_TLS|DEPTH_ZERO/i.test(haystack)) return 'tls';
  // The second alternative matches rows written before RECIPE_NO_CANDIDATES existed, so an
  // existing install does not fall back to the generic message.
  if (/no candidates recognised|沒有辨識到候選商品/i.test(haystack)) return 'no_candidates';
  if (/robots/i.test(haystack)) return 'robots_blocked';
  if (/CAPTCHA|queue-?it|access denied|forbidden|paywall/i.test(haystack)) return 'access_blocked';
  if (/暫停|paused|network.*disabled|disabled.*network/i.test(haystack)) return 'network_paused';
  if (/parse|selector|cheerio|json-?ld|unexpected token|invalid json|no listings|0 items|failed to process/i.test(haystack)) return 'parse';
  if (/找不到|not found|見つかり/i.test(haystack)) return 'not_found';
  if (/invalid|格式|validation|無效|schema/i.test(haystack)) return 'validation';
  if (name) return isKnownErrorClass(name) ? name : 'error';
  return 'error';
}

// A store's own words are whatever library raised them - 'HTTP 404', 'fetch failed', or raw
// Playwright text - so showing last_error verbatim leaves the operator reading English internals
// with no idea what to do. Classes are already bounded and content-free, which makes them a safe
// join key onto localized, actionable text (BT-UX-003).
const SOURCE_ERROR_MESSAGE_KEYS = new Map([
  ['timeout', 'srcErr.timeout'],
  ['dns', 'srcErr.dns'],
  ['connection', 'srcErr.connection'],
  ['tls', 'srcErr.tls'],
  ['robots_blocked', 'srcErr.robots'],
  ['access_blocked', 'srcErr.blocked'],
  ['network_paused', 'srcErr.networkPaused'],
  ['parse', 'srcErr.parse'],
  ['maintenance', 'srcErr.parse'],
  ['empty', 'srcErr.parse'],
  ['too_large', 'srcErr.tooLarge'],
  ['no_candidates', 'srcErr.noCandidates'],
  ['not_found', 'srcErr.notFound'],
  ['validation', 'srcErr.validation'],
]);

// Statuses worth their own advice, because what the operator should do differs: 404 means delisted,
// 429 means back off, 503 means wait. Anything else falls back to the generic HTTP line, which
// still names the status so the message is never vaguer than the evidence behind it.
const EXPLAINED_HTTP_STATUSES = new Set(['400', '401', '403', '404', '410', '429', '500', '502', '503', '504']);

/**
 * Map a bounded error class onto the translation key describing it. Unrecognized classes fall back
 * to the generic key rather than leaking the class itself into user-facing prose.
 */
/**
 * A DNS failure on a source that has succeeded before is almost never a wrong URL - the domain
 * demonstrably existed - it is usually the machine having no network at all. Telling that user to
 * "check the spelling" sends them the wrong way, which is exactly what the clean-VM round observed
 * when the virtual cable was pulled. `hasSucceededBefore` lets the caller say so.
 */
export function sourceErrorMessageKey(errorClass, { hasSucceededBefore = false } = {}) {
  const raw = normalizeErrorClass(errorClass);
  if (!raw) return null;
  const http = raw.match(/^http_(\d{3})$/);
  if (http) return EXPLAINED_HTTP_STATUSES.has(http[1]) ? `srcErr.http_${http[1]}` : 'srcErr.http';
  if (raw === 'dns' && hasSucceededBefore) return 'srcErr.dnsAfterSuccess';
  return SOURCE_ERROR_MESSAGE_KEYS.get(raw) || 'srcErr.unknown';
}

/**
 * Derive a clear, bounded parser operation outcome from a crawl's stats so the
 * Operations page reflects what the parser actually produced. Distinguishes:
 *   - no URL / nothing fetched   -> status 'skipped',  class 'no_url'
 *   - zero valid listings        -> status 'failed',   class 'maintenance' | 'parse'
 *   - partial invalid/failed rows -> status 'success', class 'partial'
 *   - all rows valid             -> status 'success',  class null
 * `stats.parse` (page-level connector outcomes) is optional; connectors without
 * pages (e.g. the offline fixture) simply report item counts.
 */
export function parserOutcome(stats = {}) {
  const parse = stats.parse || null;
  const parsed = Number(stats.itemsParsed || 0);
  const valid = Number(stats.itemsSeen || 0);
  const itemInvalid = Number(stats.itemsInvalid || 0);
  const itemFailed = Number(stats.itemsFailed || 0);
  const pages = parse ? Number(parse.pages || 0) : null;
  const badPages = parse
    ? Number(parse.empty || 0) + Number(parse.maintenance || 0) + Number(parse.failed || 0)
    : 0;
  const counts = { pages, valid, itemInvalid, itemFailed, pageFailed: badPages };

  // Nothing fetched and nothing parsed: there was no page/URL to extract from.
  if (parsed === 0 && valid === 0 && (pages === null || pages === 0) && badPages === 0) {
    return { status: 'skipped', errorClass: 'no_url', ...counts };
  }
  // Pages/items were seen but the parser recovered no usable listing at all.
  if (valid === 0) {
    const maintenanceOnly = Boolean(parse && parse.maintenance > 0 && parse.ok === 0);
    return { status: 'failed', errorClass: maintenanceOnly ? 'maintenance' : 'parse', ...counts };
  }
  // Some listings succeeded but some rows/pages were invalid or failed.
  if (itemInvalid > 0 || itemFailed > 0 || badPages > 0) {
    return { status: 'success', errorClass: 'partial', ...counts };
  }
  return { status: 'success', errorClass: null, ...counts };
}

/**
 * Record one structured operation event. Best-effort: recording must never
 * break the operation it observes, so failures are swallowed (logged at debug).
 */
export function recordOperationEvent(db, {
  correlationId, component, operation, sourceKey = null,
  status, durationMs = null, error = null, errorClass = null, counts = null,
} = {}, { now = isoNow() } = {}) {
  try {
    const safeComp = safeComponent(component);
    const safeStat = safeStatus(status);
    // Explicit error classes are normalized to a bounded known-safe class;
    // derived classes come from safeErrorClass, which is already bounded/safe.
    // Non-failed events keep an explicit bounded qualifier (e.g. a parser
    // 'partial'/'no_url' outcome) when one is provided, and null otherwise.
    const resolvedClass = safeStat === 'failed'
      ? (normalizeErrorClass(errorClass) || normalizeErrorClass(safeErrorClass(error)) || 'error')
      : normalizeErrorClass(errorClass);
    const event = {
      correlationId: safeCorrelationId(correlationId),
      component: safeComp,
      operation: safeOperation(safeComp, operation),
      sourceKey: safeSourceKey(sourceKey),
      status: safeStat,
      durationMs: Number.isFinite(durationMs) ? Math.min(86_400_000, Math.max(0, Math.round(durationMs))) : null,
      errorClass: resolvedClass,
      validCount: safeCount(counts?.valid),
      invalidCount: safeCount(counts?.invalid),
      failedCount: safeCount(counts?.failed),
      pageCount: safeCount(counts?.pages),
      pageFailedCount: safeCount(counts?.pageFailed),
      createdAt: safeTimestamp(now) || isoNow(),
    };
    const info = db.run(
      `INSERT INTO operation_events
        (correlation_id, component, operation, source_key, status, duration_ms, error_class, valid_count, invalid_count, failed_count, page_count, page_failed_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        event.correlationId,
        event.component,
        event.operation,
        event.sourceKey,
        event.status,
        event.durationMs,
        event.errorClass,
        event.validCount, event.invalidCount, event.failedCount, event.pageCount, event.pageFailedCount,
        event.createdAt,
      ]
    );
    if (process.env.OPERATION_LOGS !== '0') logger.info({ event: 'operation', ...event });
    pruneOperationEvents(db, info.lastInsertRowid);
    return Number(info.lastInsertRowid);
  } catch (err) {
    logger.debug(`operation event skipped: ${err.message}`);
    return null;
  }
}

export function pruneOperationEvents(db, latestId, { max = OPERATION_EVENT_MAX_ROWS } = {}) {
  const id = Number(latestId);
  if (!Number.isFinite(id)) return 0;
  const cutoff = id - max;
  if (cutoff <= 0) return 0;
  return Number(db.run('DELETE FROM operation_events WHERE id<=?', [cutoff]).changes || 0);
}

export function listRecentOperationEvents(db, { limit = 50 } = {}) {
  const bounded = Math.max(1, Math.min(500, Number(limit) || 50));
  return db.all(
    `SELECT id, correlation_id, component, operation, source_key, status, duration_ms, error_class,
            valid_count, invalid_count, failed_count, page_count, page_failed_count, created_at
     FROM operation_events ORDER BY id DESC LIMIT ?`, [bounded]
  ).map((row) => ({
    id: Number(row.id), correlation_id: safeCorrelationId(row.correlation_id),
    component: safeComponent(row.component), operation: safeOperation(safeComponent(row.component), row.operation),
    source_key: safeSourceKey(row.source_key), status: safeStatus(row.status),
    duration_ms: Number.isFinite(row.duration_ms) ? Math.min(86_400_000, Math.max(0, Number(row.duration_ms))) : null,
    error_class: normalizeErrorClass(row.error_class),
    valid_count: safeCount(row.valid_count), invalid_count: safeCount(row.invalid_count),
    failed_count: safeCount(row.failed_count), page_count: safeCount(row.page_count),
    page_failed_count: safeCount(row.page_failed_count),
    created_at: safeTimestamp(row.created_at),
  }));
}

function safeCount(value, max = MAX_EVENT_COUNT) {
  return Number.isFinite(Number(value)) ? Math.min(max, Math.max(0, Math.floor(Number(value)))) : 0;
}

function componentMetrics(db, component, windowStart) {
  const totals = db.get(
    `SELECT COUNT(*) total,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
       SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
       SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped,
       SUM(CASE WHEN typeof(valid_count)='integer' AND valid_count BETWEEN 0 AND 1000000 THEN valid_count ELSE 0 END) validCount,
       SUM(CASE WHEN typeof(invalid_count)='integer' AND invalid_count BETWEEN 0 AND 1000000 THEN invalid_count ELSE 0 END) invalidCount,
       SUM(CASE WHEN typeof(failed_count)='integer' AND failed_count BETWEEN 0 AND 1000000 THEN failed_count ELSE 0 END) failedCount,
       SUM(CASE WHEN typeof(page_count)='integer' AND page_count BETWEEN 0 AND 1000000 THEN page_count ELSE 0 END) pageCount,
       SUM(CASE WHEN typeof(page_failed_count)='integer' AND page_failed_count BETWEEN 0 AND 1000000 THEN page_failed_count ELSE 0 END) pageFailedCount
     FROM operation_events WHERE component=? AND created_at>=?`, [component, windowStart]
  );
  const total = safeCount(totals.total, MAX_AGGREGATE_COUNT);
  const failed = safeCount(totals.failed, MAX_AGGREGATE_COUNT);
  const latestSuccessAt = db.get(
    "SELECT MAX(created_at) at FROM operation_events WHERE component=? AND status='success'", [component]
  )?.at || null;
  const lastFailure = db.get(
    "SELECT error_class, created_at FROM operation_events WHERE component=? AND status='failed' ORDER BY id DESC LIMIT 1",
    [component]
  );
  const validCount = safeCount(totals.validCount, MAX_AGGREGATE_COUNT);
  const invalidCount = safeCount(totals.invalidCount, MAX_AGGREGATE_COUNT);
  const failedCount = safeCount(totals.failedCount, MAX_AGGREGATE_COUNT);
  const pageCount = safeCount(totals.pageCount, MAX_AGGREGATE_COUNT);
  const pageFailedCount = safeCount(totals.pageFailedCount, MAX_AGGREGATE_COUNT);
  return {
    total,
    success: safeCount(totals.success, MAX_AGGREGATE_COUNT),
    failed,
    skipped: safeCount(totals.skipped, MAX_AGGREGATE_COUNT),
    failureRate: safeRate(failed, total),
    validCount, invalidCount, failedCount, pageCount, pageFailedCount,
    itemFailureRate: safeRate(invalidCount + failedCount, validCount + invalidCount + failedCount),
    pageFailureRate: safeRate(pageFailedCount, pageCount),
    latestSuccessAt: safeTimestamp(latestSuccessAt),
    lastErrorClass: normalizeErrorClass(lastFailure?.error_class) || null,
    lastFailureAt: safeTimestamp(lastFailure?.created_at),
  };
}

function safeRate(numerator, denominator) {
  const top = Number.isFinite(Number(numerator)) ? Math.max(0, Number(numerator)) : 0;
  const bottom = Number.isFinite(Number(denominator)) ? Math.max(0, Number(denominator)) : 0;
  return bottom ? Math.min(1, top / bottom) : 0;
}

/**
 * Compute the privacy-safe operations summary shown on the Operations page and
 * embedded in the diagnostics bundle. Reads existing counters (sources, offers,
 * queues) plus the operation_events log. Does not mutate freshness — callers
 * that need up-to-date staleness should refresh offers first.
 */
export function operationsMetrics(db, { now = isoNow(), windowMs = OPERATION_METRICS_WINDOW_MS } = {}) {
  const generatedAt = safeTimestamp(now) || isoNow();
  const windowStart = new Date(Date.parse(generatedAt) - windowMs).toISOString();

  const components = {};
  for (const component of OPERATION_COMPONENTS) {
    components[component] = componentMetrics(db, component, windowStart);
  }

  // The latest source/parser event owns the visible source error. A later
  // success clears it; notification/update errors must never be attributed to
  // a store source.
  const sourceErrorRows = db.all(
    `SELECT e.source_key, e.error_class FROM operation_events e
     WHERE e.status='failed' AND e.component IN ('source','parser') AND e.source_key IS NOT NULL
       AND e.id=(SELECT MAX(id) FROM operation_events x
                 WHERE x.source_key=e.source_key AND x.component IN ('source','parser'))`
  );
  const sourceErrors = new Map(sourceErrorRows.map((row) => [row.source_key, row.error_class]));

  const sources = db.all(
    `SELECT key, name, enabled, consecutive_failures, last_success_at, last_failure_at
     FROM sources ORDER BY consecutive_failures DESC, id`
  ).map((row) => ({
    key: safeSourceKey(row.key) || 'source',
    display: safeSourceKey(row.key) || 'source',
    enabled: Boolean(row.enabled),
    healthy: safeCount(row.consecutive_failures) < OPERATIONS_SLO.sourceFailureStreak,
    consecutiveFailures: safeCount(row.consecutive_failures),
    lastSuccessAt: safeTimestamp(row.last_success_at),
    lastFailureAt: safeTimestamp(row.last_failure_at),
    lastErrorClass: normalizeErrorClass(sourceErrors.get(row.key)) || null,
  }));

  const freshnessRows = db.all('SELECT freshness_status, archived_at FROM offers');
  const freshness = { fresh: 0, stale: 0, archived: 0, unknown: 0 };
  for (const offer of freshnessRows) {
    if (offer.archived_at || offer.freshness_status === 'archived') freshness.archived += 1;
    else if (offer.freshness_status === 'fresh') freshness.fresh += 1;
    else if (offer.freshness_status === 'stale') freshness.stale += 1;
    else freshness.unknown += 1;
  }

  const queues = {
    pendingNotifications: count(db, 'SELECT COUNT(*) c FROM events WHERE notified=0'),
    failedNotifications: count(db, "SELECT COUNT(*) c FROM notifications WHERE status='failed'"),
    monitorQueued: count(db, "SELECT COUNT(*) c FROM monitor_requests WHERE status='queued'"),
    monitorRunning: count(db, "SELECT COUNT(*) c FROM monitor_requests WHERE status='running'"),
    pendingCandidates: count(db, "SELECT COUNT(*) c FROM product_candidates WHERE status='pending'"),
  };

  const recentErrorClasses = db.all(
    `SELECT component, error_class errorClass, COUNT(*) count FROM operation_events
     WHERE status='failed' AND created_at>=? AND error_class IS NOT NULL
     GROUP BY component, error_class ORDER BY count DESC, component LIMIT 20`, [windowStart]
  ).map((row) => ({ component: safeComponent(row.component), errorClass: normalizeErrorClass(row.errorClass) || 'error', count: Math.max(0, Number(row.count) || 0) }));

  const staleOfferRate = freshness.stale / Math.max(1, freshness.fresh + freshness.stale + freshness.unknown);
  const alerts = [];
  if (sources.some((source) => source.enabled && !source.healthy)) alerts.push('source_failure_streak');
  // Legacy schema-11 rows have no item/page counters. Keep their event-level
  // failure rate alongside newer item/page rates instead of letting a single
  // counted row hide an older parser failure.
  const parserEventFailureRate = components.parser.failureRate;
  const parserItemFailureRate = components.parser.itemFailureRate;
  const parserPageFailureRate = components.parser.pageFailureRate;
  const parserFailureRate = Math.max(parserEventFailureRate, parserItemFailureRate, parserPageFailureRate);
  if (components.parser.total && parserFailureRate >= OPERATIONS_SLO.parserFailureRate) alerts.push('parser_failure_rate');
  if (components.notification.total && components.notification.failureRate >= OPERATIONS_SLO.notificationFailureRate) alerts.push('notification_failure_rate');
  if (queues.failedNotifications >= OPERATIONS_SLO.failedNotifications) alerts.push('notification_queue_failed');
  if (queues.monitorQueued + queues.monitorRunning >= OPERATIONS_SLO.monitorQueue) alerts.push('monitor_queue_backlog');
  if (freshness.fresh + freshness.stale + freshness.unknown > 0 && staleOfferRate >= OPERATIONS_SLO.staleOfferRate) alerts.push('stale_offer_rate');

  return {
    generatedAt,
    windowMs,
    status: alerts.length ? 'degraded' : 'ok',
    alerts,
    slo: OPERATIONS_SLO,
    staleOfferRate,
    parserFailureRate,
    parserEventFailureRate,
    parserItemFailureRate,
    parserPageFailureRate,
    components,
    sources,
    freshness,
    queues,
    recentErrorClasses,
  };
}

function count(db, sql) {
  try { return Number(db.get(sql).c || 0); } catch { return 0; }
}

/**
 * Diagnostics-safe projection of the operations metrics: aggregate counters,
 * bounded error classes and per-source failure state keyed by source key only.
 * Contains no names beyond source keys, no URLs, no messages and no history.
 */
export function operationsDiagnostics(db, options = {}) {
  const metrics = operationsMetrics(db, options);
  return {
    status: metrics.status,
    parserFailureRate: metrics.parserFailureRate,
    parserEventFailureRate: metrics.parserEventFailureRate,
    parserItemFailureRate: metrics.parserItemFailureRate,
    parserPageFailureRate: metrics.parserPageFailureRate,
    components: metrics.components,
    queues: metrics.queues,
    freshness: metrics.freshness,
    recentErrorClasses: metrics.recentErrorClasses,
    sources: metrics.sources.map((source) => ({
      key: source.key,
      enabled: source.enabled,
      healthy: source.healthy,
      consecutiveFailures: source.consecutiveFailures,
      lastErrorClass: source.lastErrorClass,
    })),
  };
}
