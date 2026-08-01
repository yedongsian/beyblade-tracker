import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { upsertSource, recordCrawlFailure } from '../src/core/store.js';
import { createDiagnosticsBundle, inspectDiagnosticsBundle } from '../src/maintenance/diagnostics.js';
import {
  listRecentOperationEvents, newCorrelationId, operationsDiagnostics, operationsMetrics,
  OPERATION_EVENT_MAX_ROWS, parserOutcome, pruneOperationEvents, recordOperationEvent, safeErrorClass,
} from '../src/core/operations.js';

const NOW = '2026-07-30T00:00:00.000Z';

function seedOffer(db, sourceId, productId, url, freshness, archivedAt = null) {
  db.run(
    `INSERT INTO offers (product_id,source_id,url,availability,first_seen_at,last_seen_at,last_changed_at,
       created_at,updated_at,freshness_status,archived_at)
     VALUES (?,?,?,'unknown',?,?,?,?,?,?,?)`,
    [productId, sourceId, url, NOW, NOW, NOW, NOW, NOW, freshness, archivedAt]
  );
}

test('migrations 011-013 create operation events with separate parser counters', () => {
  const db = new Database(':memory:');
  assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='operation_events'"));
  const columns = db.all("PRAGMA table_info('operation_events')").map((row) => row.name);
  for (const column of ['correlation_id', 'component', 'operation', 'source_key', 'status', 'duration_ms', 'error_class', 'valid_count', 'invalid_count', 'failed_count', 'page_count', 'page_failed_count', 'created_at']) {
    assert.ok(columns.includes(column), `missing column ${column}`);
  }
  db.close();
});

test('safeErrorClass returns bounded labels and never leaks the raw message', () => {
  assert.equal(safeErrorClass(new Error('connect ETIMEDOUT 203.0.113.9:443')), 'timeout');
  assert.equal(safeErrorClass('HTTP 404 for https://store.example/secret-path?token=abc'), 'http_404');
  assert.equal(safeErrorClass('getaddrinfo ENOTFOUND store.example'), 'dns');
  assert.equal(safeErrorClass('failed to process item: Unexpected token < in JSON'), 'parse');
  assert.equal(safeErrorClass({ code: 'BT-UPD-005', message: 'anything' }), 'BT-UPD-005');
  assert.equal(safeErrorClass(null), 'unknown');
  // The URL, token and IP must not survive into the label.
  const label = safeErrorClass('HTTP 500 https://store.example/x?token=SECRET 198.51.100.7');
  assert.doesNotMatch(label, /store\.example|SECRET|198\.51/);
});

test('recordOperationEvent persists a safe row and derives the error class for failures', () => {
  const db = new Database(':memory:');
  const id = recordOperationEvent(db, {
    correlationId: 'corr-1', component: 'source', operation: 'monitor', sourceKey: 'shop',
    status: 'failed', durationMs: 12.6, error: new Error('connect ECONNREFUSED 127.0.0.1'),
  }, { now: NOW });
  assert.ok(id > 0);
  const row = db.get('SELECT * FROM operation_events WHERE id=?', [id]);
  assert.equal(row.error_class, 'connection');
  assert.equal(row.duration_ms, 13);
  assert.equal(row.status, 'failed');
  assert.equal(row.correlation_id, 'corr-1');
  const generatedId = recordOperationEvent(db, {
    component: 'update', operation: 'check', status: 'success',
  }, { now: NOW });
  assert.match(db.get('SELECT correlation_id FROM operation_events WHERE id=?', [generatedId]).correlation_id, /^[A-Za-z0-9_-]+$/);
  db.close();
});

test('retention keeps only the most recent bounded rows', () => {
  const db = new Database(':memory:');
  const total = OPERATION_EVENT_MAX_ROWS + 25;
  for (let i = 0; i < total; i += 1) {
    recordOperationEvent(db, {
      correlationId: 'c', component: 'source', operation: 'monitor', sourceKey: 's', status: 'success',
    }, { now: NOW });
  }
  const count = db.get('SELECT COUNT(*) c FROM operation_events').c;
  assert.ok(count <= OPERATION_EVENT_MAX_ROWS, `expected <= ${OPERATION_EVENT_MAX_ROWS}, got ${count}`);
  assert.equal(pruneOperationEvents(db, 5), 0); // nothing to prune when below the cap
  db.close();
});

test('operationsMetrics reports parser failure rate, latest success, queues and freshness', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'shop', name: 'Shop', connector: 'fixture' });
  recordCrawlFailure(db, source.id, 'HTTP 500 server error');
  recordCrawlFailure(db, source.id, 'HTTP 500 server error');
  recordCrawlFailure(db, source.id, 'HTTP 500 server error'); // consecutive_failures = 3 -> unhealthy

  const productId = db.run(
    "INSERT INTO products (name,created_at,updated_at) VALUES ('P',?,?)", [NOW, NOW]
  ).lastInsertRowid;
  seedOffer(db, source.id, productId, 'https://a', 'fresh');
  seedOffer(db, source.id, productId, 'https://b', 'stale');
  seedOffer(db, source.id, productId, 'https://c', 'archived', NOW);

  // Parser: two success, one failed -> 1/3 failure rate.
  recordOperationEvent(db, { correlationId: 'c', component: 'parser', operation: 'extract', sourceKey: 'shop', status: 'success' }, { now: NOW });
  recordOperationEvent(db, { correlationId: 'c', component: 'parser', operation: 'extract', sourceKey: 'shop', status: 'success' }, { now: NOW });
  recordOperationEvent(db, { correlationId: 'c', component: 'parser', operation: 'extract', sourceKey: 'shop', status: 'failed', errorClass: 'parse' }, { now: NOW });
  recordOperationEvent(db, { correlationId: 'c', component: 'source', operation: 'monitor', sourceKey: 'shop', status: 'success' }, { now: NOW });
  recordOperationEvent(db, { correlationId: 'c', component: 'source', operation: 'monitor', sourceKey: 'shop', status: 'failed', error: 'getaddrinfo ENOTFOUND shop' }, { now: NOW });

  db.run("INSERT INTO events (product_id,type,notified,created_at) VALUES (?,'restock',0,?)", [productId, NOW]);

  const metrics = operationsMetrics(db, { now: NOW });
  assert.equal(metrics.status, 'degraded');
  assert.ok(Math.abs(metrics.parserFailureRate - 1 / 3) < 1e-6);
  assert.equal(metrics.components.parser.failed, 1);
  assert.equal(metrics.components.parser.total, 3);
  assert.ok(metrics.components.source.latestSuccessAt);
  assert.equal(metrics.components.source.lastErrorClass, 'dns');
  assert.equal(metrics.freshness.fresh, 1);
  assert.equal(metrics.freshness.stale, 1);
  assert.equal(metrics.freshness.archived, 1);
  assert.equal(metrics.queues.pendingNotifications, 1);

  const shop = metrics.sources.find((s) => s.key === 'shop');
  assert.equal(shop.consecutiveFailures, 3);
  assert.equal(shop.healthy, false);
  assert.equal(shop.lastErrorClass, 'dns');
  assert.ok(metrics.recentErrorClasses.some((row) => row.errorClass === 'parse'));
  db.close();
});

test('operationsDiagnostics stays privacy-safe: only keys, counts and error classes', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'shop', name: 'Shop', connector: 'fixture' });
  recordCrawlFailure(db, source.id, 'HTTP 403 https://store.example/private?token=abc');
  recordOperationEvent(db, {
    correlationId: newCorrelationId(), component: 'source', operation: 'monitor', sourceKey: 'shop',
    status: 'failed', error: 'HTTP 403 https://store.example/private?token=abc',
  }, { now: NOW });

  const diagnostics = operationsDiagnostics(db, { now: NOW });
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.doesNotMatch(serialized, /token|abc|store\.example/);
  assert.doesNotMatch(serialized, /\bname\b/); // per-source projection exposes key only
  assert.ok(serialized.includes('http_403'));
  db.close();
});

test('listRecentOperationEvents returns newest first with only safe columns', () => {
  const db = new Database(':memory:');
  recordOperationEvent(db, { correlationId: 'c', component: 'update', operation: 'check', status: 'success' }, { now: NOW });
  recordOperationEvent(db, { correlationId: 'c', component: 'notification', operation: 'send', sourceKey: 'telegram', status: 'success' }, { now: NOW });
  const events = listRecentOperationEvents(db, { limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[0].component, 'notification');
  assert.deepEqual(Object.keys(events[0]).sort(), [
    'component', 'correlation_id', 'created_at', 'duration_ms', 'error_class', 'failed_count', 'id', 'invalid_count', 'operation', 'page_count', 'page_failed_count', 'source_key', 'status', 'valid_count',
  ]);
  db.close();
});

test('malicious operation fields are not persisted or exposed by metrics', () => {
  const db = new Database(':memory:');
  recordOperationEvent(db, {
    correlationId: 'https://attacker.example/?token=secret', component: 'source<script>', operation: 'steal',
    sourceKey: 'https://store.example/p?token=secret', status: 'success<script>', durationMs: Infinity,
    errorClass: 'https://attacker.example/?token=secret',
  }, { now: NOW });
  const row = db.get('SELECT * FROM operation_events');
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /https?:\/\/|token|secret|script/i);
  assert.equal(row.component, 'monitor');
  assert.equal(row.operation, 'other');
  assert.equal(row.status, 'skipped');
  assert.equal(row.source_key, null);
  db.close();
});

test('parserOutcome classifies no URL, zero valid, partial and clean crawls', () => {
  // No page fetched and nothing parsed -> nothing to extract.
  assert.deepEqual(
    parserOutcome({ itemsParsed: 0, itemsSeen: 0, parse: { pages: 0, ok: 0, empty: 0, maintenance: 0, failed: 0 } }),
    { status: 'skipped', errorClass: 'no_url', pages: 0, valid: 0, itemInvalid: 0, itemFailed: 0, pageFailed: 0 }
  );
  // Connector without page stats (e.g. fixture) that returned nothing.
  assert.equal(parserOutcome({ itemsParsed: 0, itemsSeen: 0, parse: null }).status, 'skipped');

  // Pages fetched but every one was a maintenance notice.
  assert.deepEqual(
    parserOutcome({ itemsParsed: 0, itemsSeen: 0, parse: { pages: 2, ok: 0, empty: 0, maintenance: 2, failed: 0 } }),
    { status: 'failed', errorClass: 'maintenance', pages: 2, valid: 0, itemInvalid: 0, itemFailed: 0, pageFailed: 2 }
  );
  // Pages fetched, nothing usable, not maintenance -> generic parse failure.
  assert.equal(
    parserOutcome({ itemsParsed: 1, itemsSeen: 0, itemsInvalid: 1, parse: { pages: 1, ok: 0, empty: 1, maintenance: 0, failed: 0 } }).errorClass,
    'parse'
  );

  // Some usable listings alongside invalid rows / bad pages -> partial success.
  assert.deepEqual(
    parserOutcome({ itemsParsed: 3, itemsSeen: 2, itemsInvalid: 1, parse: { pages: 3, ok: 2, empty: 1, maintenance: 0, failed: 0 } }),
    { status: 'success', errorClass: 'partial', pages: 3, valid: 2, itemInvalid: 1, itemFailed: 0, pageFailed: 1 }
  );

  // Everything usable -> clean success with no qualifier.
  assert.deepEqual(
    parserOutcome({ itemsParsed: 2, itemsSeen: 2, parse: { pages: 2, ok: 2, empty: 0, maintenance: 0, failed: 0 } }),
    { status: 'success', errorClass: null, pages: 2, valid: 2, itemInvalid: 0, itemFailed: 0, pageFailed: 0 }
  );
});

test('parser SLO separates empty-page and item-exception failure rates', () => {
  for (const [counts, key] of [
    [{ valid: 1, invalid: 0, failed: 0, pages: 100, pageFailed: 99 }, 'pageFailureRate'],
    [{ valid: 1, invalid: 0, failed: 99, pages: 1, pageFailed: 0 }, 'itemFailureRate'],
  ]) {
    const db = new Database(':memory:');
    recordOperationEvent(db, {
      correlationId: 'parser-slo', component: 'parser', operation: 'extract', sourceKey: 'shop',
      status: 'success', errorClass: 'partial', counts,
    }, { now: NOW });
    const metrics = operationsMetrics(db, { now: NOW });
    assert.equal(metrics.status, 'degraded');
    assert.equal(metrics.components.parser.validCount, 1);
    assert.ok(metrics.components.parser[key] >= 0.99);
    db.close();
  }
});

test('parser SLO preserves legacy event failures beside schema-12 item/page counters', () => {
  const db = new Database(':memory:');
  // A schema-11-style event has no counters at all.
  db.run(`INSERT INTO operation_events (correlation_id,component,operation,source_key,status,error_class,created_at)
    VALUES ('legacy','parser','extract','shop','failed','parse',?)`, [NOW]);
  recordOperationEvent(db, {
    correlationId: 'new', component: 'parser', operation: 'extract', sourceKey: 'shop', status: 'success',
    counts: { valid: 1, pages: 1 },
  }, { now: NOW });
  const metrics = operationsMetrics(db, { now: NOW });
  assert.equal(metrics.components.parser.itemFailureRate, 0);
  assert.equal(metrics.parserEventFailureRate, 0.5);
  assert.equal(metrics.parserFailureRate, 0.5);
  assert.equal(metrics.status, 'degraded');
  db.close();
});

test('parser SLO keeps aggregate counters above the per-event limit accurate', () => {
  const db = new Database(':memory:');
  for (let index = 0; index < 15; index += 1) {
    recordOperationEvent(db, {
      correlationId: `valid-${index}`, component: 'parser', operation: 'extract', status: 'success',
      counts: { valid: 1_000_000 },
    }, { now: NOW });
  }
  recordOperationEvent(db, {
    correlationId: 'failed', component: 'parser', operation: 'extract', status: 'success', errorClass: 'partial',
    counts: { failed: 1_000_000 },
  }, { now: NOW });
  const metrics = operationsMetrics(db, { now: NOW });
  assert.equal(metrics.components.parser.validCount, 15_000_000);
  assert.equal(metrics.components.parser.failedCount, 1_000_000);
  assert.equal(metrics.parserItemFailureRate, 1 / 16);
  assert.equal(metrics.status, 'ok');
  db.close();
});

test('database-injected parser counters and error classes are clamped before diagnostics', () => {
  const db = new Database(':memory:');
  const secret = 'https://attacker.example/?token=secret';
  db.run(`INSERT INTO operation_events
    (correlation_id,component,operation,status,error_class,valid_count,invalid_count,failed_count,page_count,page_failed_count,created_at)
    VALUES ('raw','parser','extract','failed',?,-1,999999999,999999999,-100,999999999,?)`, [secret, NOW]);
  const metrics = operationsMetrics(db, { now: NOW });
  const parser = metrics.components.parser;
  assert.deepEqual({ valid: parser.validCount, invalid: parser.invalidCount, failed: parser.failedCount, pages: parser.pageCount, pageFailed: parser.pageFailedCount },
    { valid: 0, invalid: 0, failed: 0, pages: 0, pageFailed: 0 });
  assert.equal(parser.itemFailureRate, 0);
  assert.equal(parser.pageFailureRate, 0);
  assert.equal(parser.lastErrorClass, 'error');
  assert.doesNotMatch(JSON.stringify(operationsDiagnostics(db, { now: NOW })), /attacker\.example|token=secret/);
  db.close();
});

test('operation and diagnostics timestamp projections reject malformed database values', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'shop', name: 'Shop', connector: 'fixture' });
  const malicious = 'https://attacker.example/?token=secret';
  recordOperationEvent(db, {
    correlationId: 'timestamp', component: 'parser', operation: 'extract', sourceKey: 'shop', status: 'success',
  }, { now: malicious });
  db.run(`INSERT INTO operation_events (correlation_id,component,operation,source_key,status,created_at)
    VALUES ('c','parser','extract',?,'success',?)`, [malicious, malicious]);
  db.run('UPDATE sources SET last_success_at=? WHERE id=?', [malicious, source.id]);
  db.run('UPDATE network_control SET updated_at=? WHERE id=1', [malicious]);
  db.run(`INSERT INTO crawl_runs (source_id,source_key,started_at,finished_at,status,error)
    VALUES (?,?,?,?,?,?)`, [source.id, malicious, malicious, malicious, 'failed', malicious]);
  db.run("INSERT INTO user_settings (key,value_json,updated_at) VALUES ('diagnosticsConsent','true',?)", [NOW]);

  const events = listRecentOperationEvents(db);
  assert.ok(events.some((event) => event.created_at === null));
  assert.doesNotMatch(JSON.stringify(events), /attacker\.example|token=secret/);
  const report = inspectDiagnosticsBundle(createDiagnosticsBundle(db, {}));
  assert.equal(report.network.updated_at, null);
  assert.equal(report.sources[0].last_success_at, null);
  assert.equal(report.recentFailures[0].started_at, null);
  assert.doesNotMatch(JSON.stringify(report), /attacker\.example|token=secret/);
  db.close();
});

test('recordOperationEvent keeps a bounded parser qualifier on non-failed events', () => {
  const db = new Database(':memory:');
  const skipped = recordOperationEvent(db, {
    correlationId: 'c', component: 'parser', operation: 'extract', sourceKey: 'shop',
    status: 'skipped', errorClass: 'no_url',
  }, { now: NOW });
  assert.equal(db.get('SELECT error_class FROM operation_events WHERE id=?', [skipped]).error_class, 'no_url');
  const partial = recordOperationEvent(db, {
    correlationId: 'c', component: 'parser', operation: 'extract', sourceKey: 'shop',
    status: 'success', errorClass: 'partial',
  }, { now: NOW });
  assert.equal(db.get('SELECT error_class FROM operation_events WHERE id=?', [partial]).error_class, 'partial');
  db.close();
});
