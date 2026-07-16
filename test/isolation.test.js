import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import {
  upsertSource, startCrawlRun, finishCrawlRun, recordCrawlFailure,
  recordCrawlSuccess, pruneStaleSources,
} from '../src/core/store.js';
import { crawlSource } from '../src/core/pipeline.js';
import { BaseConnector } from '../src/connectors/base.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

class ThrowingConnector extends BaseConnector {
  async fetchListings() { throw new Error('simulated timeout'); }
}
class OkConnector extends BaseConnector {
  async fetchListings() {
    return [{ url: 'https://ok.example/bx-38', title: 'Beyblade X BX-38', availabilityRaw: 'https://schema.org/InStock' }];
  }
}

// Mirrors the per-source isolation the app applies in runOnce.
async function runSource(db, source, connector) {
  const runId = startCrawlRun(db, source);
  try {
    const stats = await crawlSource(db, source, connector, OPTS, runId);
    recordCrawlSuccess(db, source.id);
    finishCrawlRun(db, runId, { status: 'success', ...stats });
    return { ok: true, stats };
  } catch (err) {
    recordCrawlFailure(db, source.id, err.message);
    finishCrawlRun(db, runId, { status: 'failed', error: err.message });
    return { ok: false, error: err.message };
  }
}

test('a failing source does not stop other sources', async () => {
  const db = new Database(':memory:');
  const bad = upsertSource(db, { key: 'bad', name: 'Bad', connector: 'fixture', url: 'https://bad.example' });
  const good = upsertSource(db, { key: 'good', name: 'Good', connector: 'fixture', url: 'https://ok.example' });

  const r1 = await runSource(db, bad, new ThrowingConnector(bad));
  const r2 = await runSource(db, good, new OkConnector(good));

  assert.equal(r1.ok, false);
  assert.equal(r2.ok, true);

  const badRow = db.get('SELECT * FROM sources WHERE id = ?', [bad.id]);
  const goodRow = db.get('SELECT * FROM sources WHERE id = ?', [good.id]);
  assert.ok(badRow.last_error && badRow.consecutive_failures === 1);
  assert.ok(goodRow.last_success_at && goodRow.consecutive_failures === 0);

  // The good source still produced a product.
  assert.equal(db.get('SELECT COUNT(*) c FROM products').c, 1);
  const runs = db.all('SELECT * FROM crawl_runs ORDER BY id');
  assert.deepEqual(runs.map((r) => r.status), ['failed', 'success']);
});

test('config secrets are never persisted to the sources table', () => {
  const db = new Database(':memory:');
  const s = upsertSource(db, {
    key: 'leaky', name: 'Leaky', connector: 'jsonld', url: 'https://x.example',
    config: { url: 'https://x.example', token: 'SECRET123', webhook: 'https://hook', pages: ['https://x.example/p'] },
  });
  const row = db.get('SELECT config_json FROM sources WHERE id = ?', [s.id]);
  assert.doesNotMatch(row.config_json, /SECRET123/);
  assert.doesNotMatch(row.config_json, /hook/);
  assert.match(row.config_json, /pages/);
});

test('sources removed from a valid config are disabled', () => {
  const db = new Database(':memory:');
  upsertSource(db, { key: 'keep', name: 'Keep', connector: 'fixture' });
  upsertSource(db, { key: 'remove', name: 'Remove', connector: 'fixture' });
  assert.equal(pruneStaleSources(db, ['keep']), 1);
  assert.equal(db.get("SELECT enabled FROM sources WHERE key='keep'").enabled, 1);
  assert.equal(db.get("SELECT enabled FROM sources WHERE key='remove'").enabled, 0);
});
