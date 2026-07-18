import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { runOfferMonitors } from '../src/app.js';
import { assertNetworkEnabled, getNetworkState, setNetworkEnabled } from '../src/core/network-control.js';

test('network control pauses monitoring without consuming queued work', async () => {
  const db = new Database(':memory:');
  const config = { network: { enabled: true } };
  assert.equal(getNetworkState(db, config).enabled, true);
  const state = setNetworkEnabled(db, false, { reason: 'maintenance', config });
  assert.equal(state.enabled, false);
  assert.equal(state.reason, 'maintenance');
  assert.throws(() => assertNetworkEnabled(db, config));
  const result = await runOfferMonitors({ db, config });
  assert.deepEqual(result, {
    sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0,
    paused: true, reason: 'maintenance',
  });
  assert.equal(db.get('SELECT COUNT(*) count FROM crawl_runs').count, 0);
  assert.equal(setNetworkEnabled(db, true, { config }).enabled, true);
  db.close();
});

test('NETWORK_ENABLED=0 is an upper-bound lock that the UI cannot override', () => {
  const db = new Database(':memory:');
  const locked = { network: { enabled: false } };
  assert.equal(getNetworkState(db, locked).enabled, false);
  assert.throws(() => setNetworkEnabled(db, true, { config: locked }), /NETWORK_ENABLED=0/);
  assert.equal(db.get('SELECT enabled FROM network_control WHERE id=1').enabled, 1);
  db.close();
});
