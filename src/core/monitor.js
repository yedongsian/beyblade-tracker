const isoNow = () => new Date().toISOString();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function ensureSourceMonitorSettings(db, source) {
  const ts = isoNow();
  const base = Math.max(60, Number(source.check_interval_seconds || source.checkIntervalSeconds || 3600));
  db.run(
    `INSERT INTO source_monitor_settings
      (source_id,enabled,base_interval_seconds,min_interval_seconds,max_interval_seconds,
       freshness_seconds,next_run_at,created_at,updated_at)
     VALUES (?,?,?,MIN(?,300),MAX(?,86400),MAX(?*2,1800),?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET enabled=excluded.enabled,
       base_interval_seconds=excluded.base_interval_seconds,updated_at=excluded.updated_at`,
    [source.id, source.enabled === 0 ? 0 : 1, base, base, base, base,
      source.last_success_at || source.last_failure_at || ts, ts, ts]
  );
  return db.get('SELECT * FROM source_monitor_settings WHERE source_id=?', [source.id]);
}

export function monitorSettings(db, sourceId) {
  const source = db.get('SELECT * FROM sources WHERE id=?', [sourceId]);
  if (!source) throw new Error('找不到來源。');
  return ensureSourceMonitorSettings(db, source);
}

export function listDueMonitorSources(db, { now = isoNow(), onlyKey = null, force = false } = {}) {
  const params = [];
  let where = 's.enabled=1 AND ms.enabled=1';
  if (!force) { where += ' AND (ms.next_run_at IS NULL OR ms.next_run_at<=?)'; params.push(now); }
  if (onlyKey) { where += ' AND s.key=?'; params.push(onlyKey); }
  return db.all(
    `SELECT s.*,ms.base_interval_seconds,ms.min_interval_seconds,ms.max_interval_seconds,
      ms.freshness_seconds,ms.jitter_ratio,ms.backoff_base_seconds,ms.backoff_max_seconds,
      ms.archive_after_misses,ms.stability_confirmations,ms.manual_cooldown_seconds,
      ms.max_concurrency,ms.min_interval_ms,ms.next_run_at AS monitor_next_run_at,
      ms.last_manual_requested_at,ms.consecutive_failures AS monitor_consecutive_failures
     FROM sources s JOIN source_monitor_settings ms ON ms.source_id=s.id
     WHERE ${where} ORDER BY COALESCE(ms.next_run_at,'') ASC,s.id`, params
  );
}

export function adaptiveMonitorInterval(settings, offers = [], { nowMs = Date.now() } = {}) {
  const base = Number(settings.base_interval_seconds || 3600);
  const min = Number(settings.min_interval_seconds || 300);
  const max = Number(settings.max_interval_seconds || 86400);
  let interval = base;
  if (offers.some((offer) => offer.watchlisted)) interval = Math.min(interval, 300);
  if (offers.some((offer) => offer.purchasable && offer.freshness_status === 'fresh')) {
    interval = Math.min(interval, 900);
  }
  const sevenDays = nowMs + 7 * 86400 * 1000;
  if (offers.some((offer) => offer.release_date && Date.parse(offer.release_date) <= sevenDays &&
      Date.parse(offer.release_date) >= nowMs - 86400 * 1000)) {
    interval = Math.min(interval, 900);
  }
  return clamp(interval, min, max);
}

export function nextMonitorAt(settings, offers, {
  nowMs = Date.now(), random = Math.random, failed = false,
} = {}) {
  let seconds = adaptiveMonitorInterval(settings, offers, { nowMs });
  if (failed) {
    const failures = Math.max(1, Number(settings.monitor_consecutive_failures || settings.consecutive_failures || 1));
    const backoff = Number(settings.backoff_base_seconds || 60) * (2 ** (failures - 1));
    seconds = Math.max(seconds, Math.min(Number(settings.backoff_max_seconds || 21600), backoff));
  }
  const ratio = clamp(Number(settings.jitter_ratio || 0), 0, 0.5);
  const jitter = seconds * ratio * ((Number(random()) * 2) - 1);
  return new Date(nowMs + Math.max(30, seconds + jitter) * 1000).toISOString();
}

export function refreshOfferFreshness(db, { now = isoNow() } = {}) {
  const result = db.run(
    `UPDATE offers SET freshness_status='stale',purchasable=0,updated_at=?
     WHERE archived_at IS NULL AND freshness_status='fresh'
       AND (fresh_until IS NULL OR fresh_until<=?)`, [now, now]
  );
  return Number(result.changes || 0);
}

function archiveIfNeeded(db, offer, misses, threshold, ts, reason) {
  if (misses < threshold) return;
  db.run(
    `UPDATE offers SET freshness_status='archived',purchasable=0,archived_at=COALESCE(archived_at,?),
      archive_reason=?,updated_at=? WHERE id=?`, [ts, reason, ts, offer.id]
  );
}

export function finalizeSuccessfulMonitor(db, source, {
  seenOfferIds = [], terminalOfferIds = [], now = isoNow(), random = Math.random,
} = {}) {
  const settings = monitorSettings(db, source.id);
  const seen = new Set(seenOfferIds.map(Number));
  const terminal = new Set(terminalOfferIds.map(Number));
  const freshUntil = new Date(Date.parse(now) + Number(settings.freshness_seconds) * 1000).toISOString();
  const offers = db.all(`SELECT o.*,p.release_date,
    EXISTS(SELECT 1 FROM watchlist_matches wm WHERE wm.product_id=p.id OR
      (p.catalog_product_id IS NOT NULL AND wm.catalog_product_id=p.catalog_product_id)) AS watchlisted
    FROM offers o JOIN products p ON p.id=o.product_id
    WHERE o.source_id=?`, [source.id]);
  for (const offer of offers) {
    if (seen.has(Number(offer.id))) {
      const misses = terminal.has(Number(offer.id)) ? Number(offer.consecutive_missing || 0) + 1 : 0;
      const freshStatus = misses ? 'stale' : 'fresh';
      db.run(
        `UPDATE offers SET last_attempted_at=?,last_successful_at=?,fresh_until=?,freshness_status=?,
          consecutive_missing=?,archived_at=CASE WHEN ?=0 THEN NULL ELSE archived_at END,
          archive_reason=CASE WHEN ?=0 THEN NULL ELSE archive_reason END,
          purchasable=CASE WHEN ?>0 THEN 0 ELSE purchasable END,updated_at=? WHERE id=?`,
        [now, now, freshUntil, freshStatus, misses, misses, misses, misses, now, offer.id]
      );
      archiveIfNeeded(db, offer, misses, Number(settings.archive_after_misses), now, 'terminal_signal');
    } else {
      const misses = Number(offer.consecutive_missing || 0) + 1;
      db.run("UPDATE offers SET last_attempted_at=?,consecutive_missing=?,freshness_status='stale',purchasable=0,updated_at=? WHERE id=?",
        [now, misses, now, offer.id]);
      archiveIfNeeded(db, offer, misses, Number(settings.archive_after_misses), now, 'missing_from_successful_scan');
    }
  }
  const next = nextMonitorAt(settings, offers, { nowMs: Date.parse(now), random });
  db.run(
    `UPDATE source_monitor_settings SET next_run_at=?,last_scheduled_at=?,consecutive_failures=0,
      updated_at=? WHERE source_id=?`, [next, now, now, source.id]
  );
  completeMonitorRequests(db, source.id, 'completed', `next=${next}`, now);
  refreshOfferFreshness(db, { now });
  return { nextRunAt: next, freshUntil };
}

export function finalizeFailedMonitor(db, source, error, { now = isoNow(), random = Math.random } = {}) {
  const settings = monitorSettings(db, source.id);
  const isMissing = /HTTP\s+(?:404|410)|not found|販売終了|discontinued/i.test(String(error));
  const offers = db.all('SELECT * FROM offers WHERE source_id=?', [source.id]);
  for (const offer of offers) {
    const misses = isMissing && offers.length === 1
      ? Number(offer.consecutive_missing || 0) + 1 : Number(offer.consecutive_missing || 0);
    db.run('UPDATE offers SET last_attempted_at=?,consecutive_missing=?,updated_at=? WHERE id=?',
      [now, misses, now, offer.id]);
    if (isMissing && offers.length === 1) {
      archiveIfNeeded(db, offer, misses, Number(settings.archive_after_misses), now, 'http_not_found');
    }
  }
  const failures = Number(settings.consecutive_failures || 0) + 1;
  const effective = { ...settings, monitor_consecutive_failures: failures };
  const next = nextMonitorAt(effective, offers, { nowMs: Date.parse(now), random, failed: true });
  db.run(
    `UPDATE source_monitor_settings SET next_run_at=?,last_scheduled_at=?,consecutive_failures=?,
      updated_at=? WHERE source_id=?`, [next, now, failures, now, source.id]
  );
  completeMonitorRequests(db, source.id, 'failed', String(error).slice(0, 500), now);
  refreshOfferFreshness(db, { now });
  return { nextRunAt: next, consecutiveFailures: failures };
}

export function requestImmediateMonitor(db, sourceId, { now = isoNow() } = {}) {
  const settings = monitorSettings(db, sourceId);
  const current = Date.parse(now);
  const last = settings.last_manual_requested_at ? Date.parse(settings.last_manual_requested_at) : 0;
  const cooldownMs = Number(settings.manual_cooldown_seconds || 60) * 1000;
  if (last && current - last < cooldownMs) {
    const retryAfterSeconds = Math.ceil((cooldownMs - (current - last)) / 1000);
    const error = new Error(`立即重新檢查仍在冷卻中，請 ${retryAfterSeconds} 秒後再試。`);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  db.run(
    'UPDATE source_monitor_settings SET next_run_at=?,last_manual_requested_at=?,updated_at=? WHERE source_id=?',
    [now, now, now, sourceId]
  );
  const info = db.run(
    "INSERT INTO monitor_requests (source_id,status,requested_at) VALUES (?,'queued',?)", [sourceId, now]
  );
  return db.get('SELECT * FROM monitor_requests WHERE id=?', [info.lastInsertRowid]);
}

export function startMonitorRequests(db, sourceId, now = isoNow()) {
  return Number(db.run(
    "UPDATE monitor_requests SET status='running',started_at=? WHERE source_id=? AND status='queued'",
    [now, sourceId]
  ).changes || 0);
}

export function completeMonitorRequests(db, sourceId, status, detail, now = isoNow()) {
  return Number(db.run(
    `UPDATE monitor_requests SET status=?,completed_at=?,detail=?
     WHERE source_id=? AND status IN ('queued','running')`,
    [status, now, detail || null, sourceId]
  ).changes || 0);
}

export function schedulerDelaySeconds(db, {
  nowMs = Date.now(), minSeconds = 5, maxSeconds = 3600,
} = {}) {
  const monitor = db.get(
    `SELECT MIN(ms.next_run_at) next_at FROM source_monitor_settings ms
     JOIN sources s ON s.id=ms.source_id WHERE ms.enabled=1 AND s.enabled=1`
  )?.next_at;
  const discovery = db.get(
    `SELECT MIN(next_run_at) next_at FROM discovery_settings WHERE enabled=1`
  )?.next_at;
  const times = [monitor, discovery].filter(Boolean).map(Date.parse).filter(Number.isFinite);
  if (!times.length) return maxSeconds;
  const seconds = Math.ceil((Math.min(...times) - nowMs) / 1000);
  return clamp(seconds, minSeconds, maxSeconds);
}
