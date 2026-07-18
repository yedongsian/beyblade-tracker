import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { upsertSource } from '../src/core/store.js';
import { processListing } from '../src/core/pipeline.js';
import { flushNotifications } from '../src/notify/queue.js';
import { TelegramNotifier, DiscordNotifier } from '../src/notify/index.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

class CapturingNotifier {
  constructor(name = 'capture') { this.name = name; this.sent = []; }
  isConfigured() { return true; }
  async send(msg) { this.sent.push(msg); return { status: 'sent', detail: 'ok' }; }
}

class FailOnceNotifier {
  constructor(name = 'flaky') { this.name = name; this.attempts = 0; }
  isConfigured() { return true; }
  async send() {
    this.attempts += 1;
    return this.attempts === 1
      ? { status: 'failed', detail: 'temporary failure' }
      : { status: 'sent', detail: 'recovered' };
  }
}

function seedTwoStoreEvents() {
  const db = new Database(':memory:');
  const a = upsertSource(db, { key: 'a', name: 'Store A', connector: 'fixture', url: 'https://a.example' });
  const b = upsertSource(db, { key: 'b', name: 'Store B', connector: 'fixture', url: 'https://b.example' });
  const base = { title: 'Beyblade X BX-38 Dranzer', brand: 'Takara Tomy', barcode: '4570118488384' };
  processListing(db, a, { ...base, url: 'https://a.example/bx38', price: 1080, currency: 'JPY', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  processListing(db, b, { ...base, url: 'https://b.example/bx38', price: 12.99, currency: 'USD', availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  return db;
}

test('events for one product aggregate into a single summary per channel', async () => {
  const db = seedTwoStoreEvents();
  const cap = new CapturingNotifier();
  const res = await flushNotifications(db, [cap]);
  assert.equal(res.groups, 1);
  assert.equal(cap.sent.length, 1, 'two stores collapse into one summary');
  assert.match(cap.sent[0].title, /BX-38/);
  // Body mentions both stores.
  assert.match(cap.sent[0].body, /Store A/);
  assert.match(cap.sent[0].body, /Store B/);
});

test('summary orders in-stock offers by price ascending', async () => {
  const db = seedTwoStoreEvents();
  const cap = new CapturingNotifier();
  await flushNotifications(db, [cap]);
  const body = cap.sent[0].body;
  // USD 12.99 should appear before JPY 1080 (lower numeric price first).
  assert.ok(body.indexOf('12.99') < body.indexOf('1080'), 'cheaper offer listed first');
});

test('flushing twice does not resend the same events', async () => {
  const db = seedTwoStoreEvents();
  const cap = new CapturingNotifier();
  await flushNotifications(db, [cap]);
  const again = await flushNotifications(db, [cap]);
  assert.equal(again.groups, 0);
  assert.equal(cap.sent.length, 1);
  assert.equal(db.get('SELECT COUNT(*) c FROM events WHERE notified=0').c, 0);
});

test('unconfigured external notifiers skip without throwing', async () => {
  const db = seedTwoStoreEvents();
  const telegram = new TelegramNotifier({});
  const discord = new DiscordNotifier({});
  assert.equal(telegram.isConfigured(), false);
  assert.equal(discord.isConfigured(), false);
  const res = await flushNotifications(db, [telegram, discord]);
  // Nothing sent; recorded as skipped, events still marked handled.
  assert.equal(res.sent, 0);
  const skipped = db.all("SELECT * FROM notifications WHERE status='skipped'");
  assert.ok(skipped.length >= 1);
});

test('failed configured channel retries without resending successful channels', async () => {
  const db = seedTwoStoreEvents();
  const stable = new CapturingNotifier('stable');
  const flaky = new FailOnceNotifier();

  const first = await flushNotifications(db, [stable, flaky]);
  assert.equal(first.failed, 1);
  assert.equal(stable.sent.length, 1);
  assert.equal(flaky.attempts, 1);
  assert.ok(db.get('SELECT COUNT(*) c FROM events WHERE notified=0').c > 0);

  const second = await flushNotifications(db, [stable, flaky]);
  assert.equal(second.failed, 0);
  assert.equal(stable.sent.length, 1, 'successful channel must not resend');
  assert.equal(flaky.attempts, 2, 'failed channel must retry');
  assert.equal(db.get('SELECT COUNT(*) c FROM events WHERE notified=0').c, 0);
  assert.equal(db.get("SELECT status FROM notifications WHERE channel='flaky'").status, 'sent');
});

test('Telegram honors Retry-After and retries a 429 response', async () => {
  const delays = [];
  let calls = 0;
  const notifier = new TelegramNotifier({
    token: '123456:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN', chatId: '42',
    maxRetries: 2, timeoutMs: 100,
    sleepFn: async (ms) => { delays.push(ms); }, randomFn: () => 0,
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.ok(options.signal);
      return calls === 1
        ? { ok: false, status: 429, headers: { get: (name) => name === 'retry-after' ? '2' : null } }
        : { ok: true, status: 200, headers: { get: () => null } };
    },
  });
  const result = await notifier.send({ title: 'Restock', body: 'BX-38' });
  assert.equal(result.status, 'sent');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('Discord retries transient server errors but not permanent 4xx', async () => {
  let transientCalls = 0;
  const transient = new DiscordNotifier({
    webhook: 'https://discord.com/api/webhooks/1/example', maxRetries: 1,
    sleepFn: async () => {}, randomFn: () => 0,
    fetchImpl: async () => ({
      ok: ++transientCalls > 1, status: transientCalls > 1 ? 204 : 503,
      headers: { get: () => null },
    }),
  });
  assert.equal((await transient.send({ title: 'A', body: 'B' })).status, 'sent');
  assert.equal(transientCalls, 2);

  let permanentCalls = 0;
  const permanent = new DiscordNotifier({
    webhook: 'https://discord.com/api/webhooks/1/example', maxRetries: 3,
    sleepFn: async () => {},
    fetchImpl: async () => {
      permanentCalls += 1;
      return { ok: false, status: 400, headers: { get: () => null } };
    },
  });
  assert.equal((await permanent.send({ title: 'A', body: 'B' })).status, 'failed');
  assert.equal(permanentCalls, 1);
});

test('notification timeout aborts a stalled request', async () => {
  const notifier = new DiscordNotifier({
    webhook: 'https://discord.com/api/webhooks/1/example', timeoutMs: 5, maxRetries: 0,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const result = await notifier.send({ title: 'A', body: 'B' });
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /aborted/);
});
