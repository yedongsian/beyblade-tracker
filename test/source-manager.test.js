import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from '../src/db/database.js';
import { pruneStaleSources, upsertSource } from '../src/core/store.js';
import {
  confirmSource, previewSourceUrl, readSettings, saveOnboardingSettings,
  setSourceEnabled, sourceConfigWithSeeds, syncSourceSite,
} from '../src/core/source-manager.js';

const fixtureHtml = readFileSync(new URL('../fixtures/html/product-jsonld.html', import.meta.url), 'utf8');

test('config source creates one Site and SeedUrl and merges seeds into runtime config', () => {
  const db = new Database(':memory:');
  const def = {
    key: 'shop', name: 'Shop', connector: 'jsonld', url: 'https://www.example.co.jp',
    config: { pages: ['https://www.example.co.jp/p/one'] },
  };
  const source = upsertSource(db, def);
  const synced = syncSourceSite(db, source, def);
  assert.equal(db.get('SELECT COUNT(*) n FROM sites').n, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM seed_urls').n, 1);
  assert.equal(synced.site_id, 1);
  assert.deepEqual(sourceConfigWithSeeds(db, synced).pages, def.config.pages);
  db.close();
});

// The other half of A-4b's residual risk. A browser source can only come from a hand-edited config
// file, never from the UI, so a user without Chrome cannot walk themselves into needing one through
// the normal add-a-source flow.
test('a source added through the UI never requires a browser', () => {
  const db = new Database(':memory:');
  const added = confirmSource(db, { url: 'https://www.example.com/p/one', name: 'Example', confirmed: true });
  const stored = db.get('SELECT connector FROM sources WHERE id=?', [added.source.id]);
  assert.equal(stored.connector, 'jsonld');
  assert.equal(db.get("SELECT COUNT(*) n FROM sources WHERE connector='browser'").n, 0);
  db.close();
});

test('confirming the same domain adds a seed instead of duplicating a Site', () => {
  const db = new Database(':memory:');
  const first = confirmSource(db, { url: 'https://www.example.com/p/one', name: 'Example', confirmed: true });
  const second = confirmSource(db, { url: 'https://shop.example.com/p/two', name: 'Example 2', confirmed: true });
  assert.equal(first.sourceCreated, true);
  assert.equal(second.sourceCreated, false);
  assert.equal(second.seedCreated, true);
  assert.equal(db.get('SELECT COUNT(*) n FROM sites').n, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM sources').n, 1);
  assert.equal(db.get('SELECT COUNT(*) n FROM seed_urls').n, 2);
  assert.equal(pruneStaleSources(db, []), 0, 'UI-managed source must not be pruned by config sync');
  db.close();
});

test('preview parses one product page without expanding to other pages', async () => {
  const db = new Database(':memory:');
  const preview = await previewSourceUrl(db, 'https://www.example.com/product?utm_source=test', {
    fetchPage: async (url) => ({ url, status: 200, body: fixtureHtml }),
  });
  assert.equal(preview.domain, 'example.com');
  assert.equal(preview.resourceBudget.pages, 1);
  assert.equal(preview.candidate.model, 'BX-34');
  assert.equal(preview.canConfirm, true);
  db.close();
});

test('disabling a source also disables seeds while retaining source history row', () => {
  const db = new Database(':memory:');
  const added = confirmSource(db, { url: 'https://example.com/p', confirmed: true });
  setSourceEnabled(db, added.source.id, false);
  assert.equal(db.get('SELECT enabled FROM sources WHERE id=?', [added.source.id]).enabled, 0);
  assert.equal(db.get('SELECT enabled FROM seed_urls WHERE source_id=?', [added.source.id]).enabled, 0);
  assert.equal(db.get('SELECT COUNT(*) n FROM sources').n, 1);
  db.close();
});

test('onboarding settings are validated and persisted', () => {
  const db = new Database(':memory:');
  const saved = saveOnboardingSettings(db, {
    language: 'zh-TW', notification: 'telegram', scanFrequency: 'balanced', dataRetentionDays: 400,
  });
  assert.equal(saved.onboardingCompleted, true);
  assert.equal(readSettings(db).notification, 'telegram');
  db.close();
});
