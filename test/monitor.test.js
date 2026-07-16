import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { upsertSource } from '../src/core/store.js';
import { processListing } from '../src/core/pipeline.js';
import {
  adaptiveMonitorInterval, finalizeFailedMonitor, finalizeSuccessfulMonitor,
  listDueMonitorSources, refreshOfferFreshness, requestImmediateMonitor,
  schedulerDelaySeconds,
} from '../src/core/monitor.js';
import { flushNotifications } from '../src/notify/queue.js';

const BASE = {
  url: 'https://store.example/bx-38', title: 'Beyblade X BX-38',
  model: 'BX-38', price: 1080, currency: 'JPY',
};
const OPTS = {
  preorderIsPurchasable: false, eventCooldownSeconds: 0,
  priceChangeThreshold: 0.05, stabilityConfirmations: 2,
};

function setup() {
  const db = new Database(':memory:');
  const source = upsertSource(db, {
    key: 'store', name: 'Store', connector: 'fixture',
    url: 'https://store.example', checkIntervalSeconds: 3600,
  });
  return { db, source };
}

test('adaptive monitor frequency prioritizes watchlist, purchasable and near release offers', () => {
  const settings = { base_interval_seconds: 3600, min_interval_seconds: 300, max_interval_seconds: 86400 };
  assert.equal(adaptiveMonitorInterval(settings, []), 3600);
  assert.equal(adaptiveMonitorInterval(settings, [{ watchlisted: 1 }]), 300);
  assert.equal(adaptiveMonitorInterval(settings, [{ purchasable: 1, freshness_status: 'fresh' }]), 900);
  assert.equal(adaptiveMonitorInterval(settings, [{ release_date: '2026-07-20' }], {
    nowMs: Date.parse('2026-07-16T00:00:00Z'),
  }), 900);
});

test('monitor due list and combined scheduler keep offer and discovery schedules independent', () => {
  const { db, source } = setup();
  db.run("UPDATE source_monitor_settings SET next_run_at='2026-07-16T01:00:00.000Z' WHERE source_id=?", [source.id]);
  assert.equal(listDueMonitorSources(db, { now: '2026-07-16T00:00:00.000Z' }).length, 0);
  assert.equal(listDueMonitorSources(db, { now: '2026-07-16T02:00:00.000Z' }).length, 1);

  const ts = '2026-07-16T00:00:00.000Z';
  const site = db.run("INSERT INTO sites (registrable_domain,display_name,status,created_at,updated_at) VALUES ('example.com','Example','active',?,?)", [ts, ts]);
  db.run(`INSERT INTO discovery_settings (site_id,enabled,interval_seconds,max_pages,max_depth,max_seconds,max_bytes,max_browser_pages,concurrency,min_interval_ms,next_run_at,created_at,updated_at)
    VALUES (?,1,86400,10,1,60,1000000,0,1,2000,?,?,?)`, [site.lastInsertRowid, ts, ts, ts]);
  assert.equal(schedulerDelaySeconds(db, { nowMs: Date.parse(ts), minSeconds: 5 }), 5);
});

test('availability changes only after consecutive confirmations while raw observations remain complete', () => {
  const { db, source } = setup();
  processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/OutOfStock' }, OPTS);
  const first = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(first.state, 'out_of_stock');
  assert.equal(first.observedState, 'in_stock');
  assert.equal(first.events.length, 0);
  assert.equal(db.get('SELECT availability_candidate_count c FROM offers').c, 1);
  const second = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  assert.equal(second.state, 'in_stock');
  assert.deepEqual(second.events.map((event) => event.type), ['back_in_stock']);
  assert.deepEqual(db.all('SELECT availability FROM observations ORDER BY id').map((row) => row.availability),
    ['out_of_stock', 'in_stock', 'in_stock']);
});

test('successful, stale, missing, archived and recovered offer lifecycle never exposes old stock', () => {
  const { db, source } = setup();
  db.run('UPDATE source_monitor_settings SET freshness_seconds=60,archive_after_misses=2 WHERE source_id=?', [source.id]);
  const listing = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  finalizeSuccessfulMonitor(db, source, {
    seenOfferIds: [listing.offerId], now: '2026-07-16T00:00:00.000Z', random: () => 0.5,
  });
  let offer = db.get('SELECT * FROM offers WHERE id=?', [listing.offerId]);
  assert.equal(offer.freshness_status, 'fresh');
  assert.equal(offer.purchasable, 1);

  refreshOfferFreshness(db, { now: '2026-07-16T00:01:01.000Z' });
  offer = db.get('SELECT * FROM offers WHERE id=?', [listing.offerId]);
  assert.equal(offer.freshness_status, 'stale');
  assert.equal(offer.purchasable, 0);

  finalizeSuccessfulMonitor(db, source, { seenOfferIds: [], now: '2026-07-16T00:02:00.000Z', random: () => 0.5 });
  finalizeSuccessfulMonitor(db, source, { seenOfferIds: [], now: '2026-07-16T00:03:00.000Z', random: () => 0.5 });
  offer = db.get('SELECT * FROM offers WHERE id=?', [listing.offerId]);
  assert.equal(offer.freshness_status, 'archived');
  assert.ok(offer.archived_at);

  const recovered = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  finalizeSuccessfulMonitor(db, source, {
    seenOfferIds: [recovered.offerId], now: '2026-07-16T00:04:00.000Z', random: () => 0.5,
  });
  offer = db.get('SELECT * FROM offers WHERE id=?', [listing.offerId]);
  assert.equal(offer.freshness_status, 'fresh');
  assert.equal(offer.archived_at, null);
  assert.equal(offer.consecutive_missing, 0);
  assert.equal(offer.purchasable, 1);
});

test('transient failures back off, 404 failures archive, and manual checks enforce cooldown', () => {
  const { db, source } = setup();
  db.run('UPDATE source_monitor_settings SET archive_after_misses=2,manual_cooldown_seconds=60 WHERE source_id=?', [source.id]);
  const listing = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  const failure = finalizeFailedMonitor(db, source, 'temporary timeout', {
    now: '2026-07-16T00:00:00.000Z', random: () => 0.5,
  });
  assert.equal(failure.consecutiveFailures, 1);
  assert.ok(Date.parse(failure.nextRunAt) > Date.parse('2026-07-16T00:00:00.000Z'));
  finalizeFailedMonitor(db, source, 'HTTP 404 not found', { now: '2026-07-16T00:01:00.000Z', random: () => 0.5 });
  finalizeFailedMonitor(db, source, 'HTTP 410 discontinued', { now: '2026-07-16T00:02:00.000Z', random: () => 0.5 });
  assert.equal(db.get('SELECT freshness_status FROM offers WHERE id=?', [listing.offerId]).freshness_status, 'archived');

  requestImmediateMonitor(db, source.id, { now: '2026-07-16T01:00:00.000Z' });
  assert.throws(() => requestImmediateMonitor(db, source.id, { now: '2026-07-16T01:00:30.000Z' }),
    (error) => error.retryAfterSeconds === 30);
  assert.equal(db.get("SELECT COUNT(*) c FROM monitor_requests WHERE status='queued'").c, 1);
});

test('stale availability events are consumed without sending old stock notifications', async () => {
  const { db, source } = setup();
  const listing = processListing(db, source, { ...BASE, availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  db.run("UPDATE offers SET freshness_status='stale',purchasable=0 WHERE id=?", [listing.offerId]);
  const notifier = { name: 'capture', sent: [], isConfigured: () => true, async send(message) { this.sent.push(message); return { status: 'sent' }; } };
  const result = await flushNotifications(db, [notifier]);
  assert.equal(result.staleSuppressed, 1);
  assert.equal(notifier.sent.length, 0);
  assert.equal(db.get('SELECT notified FROM events').notified, 1);
});
