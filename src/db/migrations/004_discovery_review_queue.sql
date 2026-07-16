ALTER TABLE seed_urls ADD COLUMN purpose TEXT NOT NULL DEFAULT 'monitor';
CREATE INDEX idx_seed_urls_purpose ON seed_urls(site_id, purpose, enabled);

CREATE TABLE discovery_settings (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval_seconds INTEGER NOT NULL DEFAULT 86400,
  max_pages INTEGER NOT NULL DEFAULT 100,
  max_depth INTEGER NOT NULL DEFAULT 2,
  max_seconds INTEGER NOT NULL DEFAULT 300,
  max_bytes INTEGER NOT NULL DEFAULT 52428800,
  max_browser_pages INTEGER NOT NULL DEFAULT 3,
  concurrency INTEGER NOT NULL DEFAULT 2,
  min_interval_ms INTEGER NOT NULL DEFAULT 1000,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_recipes (
  site_id INTEGER PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'suggested',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  seed_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  max_pages INTEGER NOT NULL,
  max_depth INTEGER NOT NULL,
  max_seconds INTEGER NOT NULL,
  max_bytes INTEGER NOT NULL,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  bytes_fetched INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  frontier_pending INTEGER NOT NULL DEFAULT 0,
  robots_checked INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  error TEXT
);
CREATE INDEX idx_discovery_runs_site ON discovery_runs(site_id, id DESC);

CREATE TABLE crawl_frontier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discovery_run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  url_fingerprint TEXT NOT NULL,
  discovered_from TEXT,
  discovery_kind TEXT NOT NULL DEFAULT 'page',
  link_text TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(discovery_run_id, url_fingerprint)
);
CREATE INDEX idx_crawl_frontier_next ON crawl_frontier(discovery_run_id, status, priority DESC, id);

CREATE TABLE product_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  discovery_run_id INTEGER REFERENCES discovery_runs(id) ON DELETE SET NULL,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT,
  series TEXT,
  model TEXT,
  barcode TEXT,
  price REAL,
  currency TEXT,
  availability TEXT NOT NULL DEFAULT 'unknown',
  image TEXT,
  confidence REAL NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  discovery_method TEXT NOT NULL,
  listing_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  reviewed_at TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  first_discovered_at TEXT NOT NULL,
  last_discovered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(site_id, canonical_url)
);
CREATE INDEX idx_product_candidates_review ON product_candidates(status, confidence DESC, id DESC);
CREATE INDEX idx_product_candidates_site ON product_candidates(site_id, status);
