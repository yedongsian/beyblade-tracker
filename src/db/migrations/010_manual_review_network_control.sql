CREATE TABLE product_identity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  source_product_id INTEGER,
  target_product_id INTEGER,
  new_product_id INTEGER,
  offer_ids_json TEXT NOT NULL DEFAULT '[]',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_identity_audit_recent ON product_identity_audit(created_at DESC, id DESC);

ALTER TABLE listing_exclusions ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE listing_exclusions ADD COLUMN review_note TEXT;
ALTER TABLE listing_exclusions ADD COLUMN reviewed_at TEXT;

CREATE TABLE listing_exclusion_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'allow',
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, url)
);

CREATE TABLE network_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO network_control (id, enabled, reason, updated_at)
VALUES (1, 1, NULL, CURRENT_TIMESTAMP);
