import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURRENT_SCHEMA_VERSION, Database } from '../src/db/database.js';
import { recoverInterruptedCrawlRuns, upsertSource } from '../src/core/store.js';
import { recoverInterruptedDiscoveryRuns } from '../src/core/discovery.js';

test('new database applies every migration and records schema version', () => {
  const db = new Database(':memory:');
  assert.equal(db.get('PRAGMA user_version').user_version, CURRENT_SCHEMA_VERSION);
  assert.equal(db.get('SELECT COUNT(*) n FROM schema_migrations').n, CURRENT_SCHEMA_VERSION);
  const columns = db.all("PRAGMA table_info('sources')").map((row) => row.name);
  assert.ok(columns.includes('connector_version'));
  assert.ok(columns.includes('recipe_version'));
  const seedColumns = db.all("PRAGMA table_info('seed_urls')").map((row) => row.name);
  assert.ok(seedColumns.includes('purpose'));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='product_candidates'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='crawl_frontier'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_products'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_aliases'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='terminology_review_queue'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='source_monitor_settings'"));
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='monitor_requests'"));
  for (const table of ['official_sources', 'official_announcements', 'official_scan_previews',
    'watchlists', 'watchlist_matches', 'watchlist_alerts', 'watchlist_notification_preferences']) {
    assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]));
  }
  const offerColumns = db.all("PRAGMA table_info('offers')").map((row) => row.name);
  for (const column of ['last_attempted_at', 'last_successful_at', 'fresh_until', 'freshness_status', 'archived_at']) {
    assert.ok(offerColumns.includes(column));
  }
  db.close();
});

test('legacy version-zero database upgrades without losing records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beyblade-migrate-'));
  const path = join(dir, 'legacy.db');
  const legacy = new DatabaseSync(path);
  legacy.exec(readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
  legacy.prepare(
    `INSERT INTO sources (key,name,connector,enabled,check_interval_seconds,created_at,updated_at)
     VALUES ('preserve-me','Preserve Me','fixture',1,3600,'2026-01-01','2026-01-01')`
  ).run();
  legacy.close();

  const upgraded = new Database(path);
  assert.equal(upgraded.get('PRAGMA user_version').user_version, CURRENT_SCHEMA_VERSION);
  assert.equal(upgraded.get("SELECT COUNT(*) n FROM sources WHERE key='preserve-me'").n, 1);
  upgraded.close();
  rmSync(dir, { recursive: true, force: true });
});

test('startup recovery marks abandoned crawl runs as failed', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'recover', connector: 'fixture' });
  db.run(
    "INSERT INTO crawl_runs (source_id,source_key,started_at,status) VALUES (?,?,?,'running')",
    [source.id, source.key, '2026-01-01T00:00:00.000Z']
  );
  assert.equal(recoverInterruptedCrawlRuns(db), 1);
  const run = db.get('SELECT * FROM crawl_runs');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /未正常結束/);
  assert.ok(run.finished_at);
  db.close();
});

test('startup recovery marks abandoned discovery frontier work as failed', () => {
  const db = new Database(':memory:');
  db.run("INSERT INTO sites (registrable_domain,display_name,status,created_at,updated_at) VALUES ('example.com','Example','active','x','x')");
  const run = db.run(`INSERT INTO discovery_runs
    (site_id,seed_url,status,started_at,max_pages,max_depth,max_seconds,max_bytes)
    VALUES (1,'https://example.com','running','x',100,2,300,52428800)`).lastInsertRowid;
  db.run(`INSERT INTO crawl_frontier
    (discovery_run_id,canonical_url,url_fingerprint,discovery_kind,depth,priority,status,created_at,updated_at)
    VALUES (?,'https://example.com/p','fingerprint','page',0,1,'fetching','x','x')`, [run]);
  assert.equal(recoverInterruptedDiscoveryRuns(db), 1);
  assert.equal(db.get('SELECT status FROM discovery_runs WHERE id=?', [run]).status, 'failed');
  assert.equal(db.get('SELECT status FROM crawl_frontier WHERE discovery_run_id=?', [run]).status, 'failed');
  db.close();
});
