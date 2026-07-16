CREATE TABLE community_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_class TEXT NOT NULL DEFAULT 'social',
  author_handle TEXT,
  profile_url TEXT NOT NULL,
  acquisition_method TEXT NOT NULL DEFAULT 'x_api',
  access_state TEXT NOT NULL DEFAULT 'needs_configuration',
  enabled INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  api_cost_per_post_usd REAL,
  monthly_budget_usd REAL NOT NULL DEFAULT 0,
  poll_interval_seconds INTEGER NOT NULL DEFAULT 900,
  retention_days INTEGER NOT NULL DEFAULT 90,
  exclude_terms_json TEXT NOT NULL DEFAULT '[]',
  filter_sensitive INTEGER NOT NULL DEFAULT 1,
  filter_spam INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_community_sources_state ON community_sources(enabled,access_state,muted);

CREATE TABLE community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_source_id INTEGER NOT NULL REFERENCES community_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  author_handle TEXT,
  content_text TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'und',
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  acquisition_method TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  credibility TEXT NOT NULL DEFAULT 'unverified',
  lead_types_json TEXT NOT NULL DEFAULT '[]',
  detected_models_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  summary_kind TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  spam_score REAL NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(community_source_id,external_id),
  UNIQUE(canonical_url)
);
CREATE INDEX idx_community_posts_recent ON community_posts(hidden,published_at DESC,id DESC);
CREATE INDEX idx_community_posts_fingerprint ON community_posts(content_fingerprint);

CREATE TABLE community_post_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  community_source_id INTEGER NOT NULL REFERENCES community_sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  author_handle TEXT,
  acquired_at TEXT NOT NULL,
  UNIQUE(community_source_id,external_id)
);

CREATE TABLE community_post_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  link_kind TEXT NOT NULL DEFAULT 'external',
  UNIQUE(community_post_id,canonical_url)
);

CREATE TABLE community_post_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_post_id INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(community_post_id,watchlist_id)
);

CREATE TABLE community_source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  community_source_id INTEGER NOT NULL REFERENCES community_sources(id) ON DELETE CASCADE,
  acquisition_method TEXT NOT NULL,
  status TEXT NOT NULL,
  items_seen INTEGER NOT NULL DEFAULT 0,
  items_created INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX idx_community_runs_source ON community_source_runs(community_source_id,id DESC);
