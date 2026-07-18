ALTER TABLE products ADD COLUMN normalized_sku TEXT;
ALTER TABLE products ADD COLUMN variant_key TEXT;

UPDATE products
SET normalized_sku = UPPER(REPLACE(TRIM(sku), ' ', ''))
WHERE sku IS NOT NULL AND TRIM(sku) <> '';

CREATE INDEX idx_products_normalized_sku ON products(normalized_sku);
CREATE INDEX idx_products_model_variant ON products(model, variant_key);

CREATE TABLE listing_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  crawl_run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  reason TEXT NOT NULL,
  raw_summary_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, url, reason)
);

CREATE INDEX idx_listing_exclusions_recent
  ON listing_exclusions(source_id, last_seen_at DESC);
