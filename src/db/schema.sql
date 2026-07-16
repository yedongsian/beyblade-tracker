-- Legacy version-zero schema retained only for migration compatibility tests.
-- Runtime databases are created from src/db/migrations/*.sql.
-- Beyblade tracker schema
-- All timestamps are ISO-8601 UTC strings.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,      -- stable identifier from config
  name          TEXT NOT NULL,             -- human readable store name
  connector     TEXT NOT NULL,             -- connector type: fixture | jsonld
  url           TEXT,                      -- base or listing url
  config_json   TEXT,                      -- connector-specific config (no secrets)
  enabled       INTEGER NOT NULL DEFAULT 1,
  check_interval_seconds INTEGER NOT NULL DEFAULT 3600,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error      TEXT,                    -- short error summary, never secrets
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,             -- canonical name
  brand         TEXT,
  series        TEXT,
  model         TEXT,                      -- normalized model e.g. BX-38
  barcode       TEXT,                      -- gtin/ean/upc if known
  release_date  TEXT,
  image         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

CREATE TABLE IF NOT EXISTS offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,             -- normalized offer url
  title         TEXT,                      -- store listing title
  price         REAL,
  currency      TEXT,
  availability  TEXT NOT NULL DEFAULT 'unknown',  -- discovered|coming_soon|preorder|in_stock|out_of_stock|unknown
  confidence    REAL NOT NULL DEFAULT 0,
  purchasable   INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(source_id, url)
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_source ON offers(source_id);

CREATE TABLE IF NOT EXISTS observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id      INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  crawl_run_id  INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
  price         REAL,
  currency      TEXT,
  availability  TEXT NOT NULL,
  confidence    REAL NOT NULL DEFAULT 0,
  raw_summary   TEXT,                      -- small JSON summary, no full HTML
  observed_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observations_offer ON observations(offer_id);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  offer_id      INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  source_id     INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,             -- product_discovered|coming_soon|preorder_open|became_available|back_in_stock|out_of_stock|price_change
  from_state    TEXT,
  to_state      TEXT,
  price         REAL,
  currency      TEXT,
  message       TEXT,
  notified      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id);
CREATE INDEX IF NOT EXISTS idx_events_notified ON events(notified);
CREATE INDEX IF NOT EXISTS idx_events_offer_type ON events(offer_id, type);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  channel       TEXT NOT NULL,             -- console|telegram|discord
  dedup_key     TEXT NOT NULL,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  event_ids     TEXT,                      -- JSON array of event ids in the summary
  title         TEXT,
  body          TEXT,
  status        TEXT NOT NULL,             -- sent|skipped|failed
  detail        TEXT,                      -- short result/error, no secrets
  created_at    TEXT NOT NULL,
  UNIQUE(channel, dedup_key)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  source_key    TEXT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'running',  -- running|success|failed
  items_seen    INTEGER NOT NULL DEFAULT 0,
  items_excluded INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_source ON crawl_runs(source_id);
