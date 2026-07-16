CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registrable_domain TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE sources ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE sources ADD COLUMN managed_by TEXT NOT NULL DEFAULT 'config';

CREATE INDEX idx_sources_site ON sources(site_id);
CREATE INDEX idx_sources_managed_by ON sources(managed_by);

CREATE TABLE seed_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  original_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'ui',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(site_id, canonical_url)
);
CREATE INDEX idx_seed_urls_site ON seed_urls(site_id);
CREATE INDEX idx_seed_urls_source ON seed_urls(source_id);

CREATE TABLE user_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
