ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN catalog_product_id INTEGER REFERENCES catalog_products(id) ON DELETE SET NULL;

ALTER TABLE offers ADD COLUMN availability_raw_text TEXT;
ALTER TABLE offers ADD COLUMN availability_locale TEXT;
ALTER TABLE offers ADD COLUMN price_tax_included INTEGER;

CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_catalog ON products(catalog_product_id);

CREATE TABLE catalog_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL DEFAULT 'Takara Tomy',
  generation TEXT,
  product_system TEXT,
  series TEXT,
  barcode TEXT,
  release_date TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_catalog_products_system ON catalog_products(product_system, product_code);
CREATE INDEX idx_catalog_products_barcode ON catalog_products(barcode);

CREATE TABLE catalog_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_type TEXT NOT NULL,
  code TEXT,
  canonical_name TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(part_type, code, canonical_name)
);

CREATE TABLE catalog_product_parts (
  catalog_product_id INTEGER NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  catalog_part_id INTEGER NOT NULL REFERENCES catalog_parts(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  position INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY(catalog_product_id, catalog_part_id)
);

CREATE TABLE catalog_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  locale TEXT,
  retrieved_at TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  license_note TEXT,
  raw_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, source_url)
);
CREATE INDEX idx_catalog_evidence_entity ON catalog_evidence(entity_type, entity_id);

CREATE TABLE catalog_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'retailer_title',
  evidence_id INTEGER REFERENCES catalog_evidence(id) ON DELETE SET NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, locale, normalized_alias)
);
CREATE INDEX idx_catalog_alias_lookup ON catalog_aliases(normalized_alias, locale);

CREATE TABLE product_catalog_links (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  catalog_product_id INTEGER NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  match_method TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_product_catalog_target ON product_catalog_links(catalog_product_id);

CREATE TABLE terminology_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  locale TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  suggested_value TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, normalized_value, locale)
);
CREATE INDEX idx_terminology_review_status ON terminology_review_queue(status, kind, id DESC);

CREATE TABLE availability_term_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  locale TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  state TEXT NOT NULL,
  created_from_review_id INTEGER REFERENCES terminology_review_queue(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(locale, normalized_term)
);
