ALTER TABLE offers ADD COLUMN last_attempted_at TEXT;
ALTER TABLE offers ADD COLUMN last_successful_at TEXT;
ALTER TABLE offers ADD COLUMN fresh_until TEXT;
ALTER TABLE offers ADD COLUMN freshness_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE offers ADD COLUMN consecutive_missing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN archived_at TEXT;
ALTER TABLE offers ADD COLUMN archive_reason TEXT;
ALTER TABLE offers ADD COLUMN availability_candidate TEXT;
ALTER TABLE offers ADD COLUMN availability_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN last_stable_at TEXT;

CREATE INDEX idx_offers_freshness ON offers(freshness_status, fresh_until);
CREATE INDEX idx_offers_archived ON offers(archived_at, source_id);

CREATE TABLE source_monitor_settings (
  source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  base_interval_seconds INTEGER NOT NULL DEFAULT 3600,
  min_interval_seconds INTEGER NOT NULL DEFAULT 300,
  max_interval_seconds INTEGER NOT NULL DEFAULT 86400,
  freshness_seconds INTEGER NOT NULL DEFAULT 7200,
  jitter_ratio REAL NOT NULL DEFAULT 0.10,
  backoff_base_seconds INTEGER NOT NULL DEFAULT 60,
  backoff_max_seconds INTEGER NOT NULL DEFAULT 21600,
  archive_after_misses INTEGER NOT NULL DEFAULT 3,
  stability_confirmations INTEGER NOT NULL DEFAULT 2,
  manual_cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  min_interval_ms INTEGER NOT NULL DEFAULT 2000,
  next_run_at TEXT,
  last_scheduled_at TEXT,
  last_manual_requested_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_source_monitor_due ON source_monitor_settings(enabled, next_run_at);

CREATE TABLE monitor_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  detail TEXT
);
CREATE INDEX idx_monitor_requests_source ON monitor_requests(source_id, id DESC);

INSERT INTO source_monitor_settings
  (source_id,enabled,base_interval_seconds,min_interval_seconds,max_interval_seconds,
   freshness_seconds,next_run_at,created_at,updated_at)
SELECT id,enabled,check_interval_seconds,
  MIN(check_interval_seconds,300),MAX(check_interval_seconds,86400),
  MAX(check_interval_seconds * 2,1800),
  COALESCE(last_success_at,last_failure_at,created_at),created_at,updated_at
FROM sources;

UPDATE offers SET
  last_attempted_at=last_seen_at,
  last_successful_at=last_seen_at,
  fresh_until=strftime('%Y-%m-%dT%H:%M:%fZ', last_seen_at, '+2 hours'),
  freshness_status=CASE WHEN julianday(last_seen_at, '+2 hours') > julianday('now') THEN 'fresh' ELSE 'stale' END,
  last_stable_at=last_changed_at;
