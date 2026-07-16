CREATE TABLE official_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_class TEXT NOT NULL,
  base_url TEXT NOT NULL,
  registrable_domain TEXT NOT NULL,
  feed_kind TEXT NOT NULL DEFAULT 'html',
  feed_priority_json TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'verified',
  enabled INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_official_sources_class ON official_sources(source_class,enabled);

ALTER TABLE sources ADD COLUMN official_source_id INTEGER REFERENCES official_sources(id) ON DELETE SET NULL;

ALTER TABLE catalog_products ADD COLUMN image TEXT;
ALTER TABLE catalog_products ADD COLUMN msrp REAL;
ALTER TABLE catalog_products ADD COLUMN msrp_currency TEXT;
ALTER TABLE catalog_products ADD COLUMN official_updated_at TEXT;
ALTER TABLE catalog_products ADD COLUMN official_source_id INTEGER REFERENCES official_sources(id) ON DELETE SET NULL;

CREATE TABLE official_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  official_source_id INTEGER NOT NULL REFERENCES official_sources(id) ON DELETE CASCADE,
  catalog_product_id INTEGER REFERENCES catalog_products(id) ON DELETE SET NULL,
  external_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'ja',
  product_code TEXT,
  event_type TEXT NOT NULL DEFAULT 'announced',
  published_at TEXT,
  source_updated_at TEXT,
  release_date TEXT,
  msrp REAL,
  currency TEXT,
  image TEXT,
  summary TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(official_source_id,canonical_url,event_type)
);
CREATE INDEX idx_official_announcements_product ON official_announcements(catalog_product_id,published_at DESC);

CREATE TABLE official_scan_previews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  official_source_id INTEGER NOT NULL REFERENCES official_sources(id) ON DELETE CASCADE,
  seed_url TEXT NOT NULL,
  estimated_products INTEGER,
  scope_json TEXT NOT NULL DEFAULT '{}',
  exclusions_json TEXT NOT NULL DEFAULT '[]',
  budget_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_official_previews_source ON official_scan_previews(official_source_id,id DESC);

CREATE TABLE watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'rule',
  catalog_product_id INTEGER REFERENCES catalog_products(id) ON DELETE CASCADE,
  catalog_part_id INTEGER REFERENCES catalog_parts(id) ON DELETE CASCADE,
  product_code TEXT,
  model TEXT,
  barcode TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  exclude_terms_json TEXT NOT NULL DEFAULT '[]',
  locale TEXT NOT NULL DEFAULT 'any',
  match_mode TEXT NOT NULL DEFAULT 'exact',
  synonym_expansion INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_watchlists_enabled ON watchlists(enabled,target_type);

CREATE TABLE watchlist_notification_preferences (
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(watchlist_id,event_type)
);

CREATE TABLE watchlist_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  catalog_product_id INTEGER REFERENCES catalog_products(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  offer_id INTEGER REFERENCES offers(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  match_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  first_matched_at TEXT NOT NULL,
  last_matched_at TEXT NOT NULL,
  UNIQUE(watchlist_id,identity_key)
);
CREATE INDEX idx_watchlist_matches_product ON watchlist_matches(product_id,offer_id);

CREATE TABLE watchlist_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  catalog_product_id INTEGER REFERENCES catalog_products(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  official_announcement_id INTEGER REFERENCES official_announcements(id) ON DELETE SET NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_watchlist_alerts_pending ON watchlist_alerts(notified,id);
