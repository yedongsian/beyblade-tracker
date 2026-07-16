import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { createWebServer } from '../src/web/server.js';

async function withServer(fn) {
  const db = new Database(':memory:');
  const server = createWebServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn({ db, base: `http://127.0.0.1:${port}` }); }
  finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
}

test('interactive Local Web App renders accessible source management', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/sources`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /lang="zh-Hant"/);
    assert.match(html, /跳到主要內容/);
    assert.match(html, /label for="source-url"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /首次設定/);
  });
});

test('mutating API requires CSRF token and saves onboarding settings', async () => {
  await withServer(async ({ base }) => {
    const page = await (await fetch(base)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const denied = await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(denied.status, 400);
    const accepted = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ language: 'zh-TW', notification: 'app', scanFrequency: 'balanced' }),
    });
    assert.equal(accepted.status, 200);
    const after = await (await fetch(base)).text();
    assert.doesNotMatch(after, /id="onboarding"/);
  });
});

test('source API disables by default instead of deleting history', async () => {
  await withServer(async ({ db, base }) => {
    db.run(
      `INSERT INTO sources (key,name,connector,enabled,check_interval_seconds,connector_version,
       recipe_version,managed_by,created_at,updated_at) VALUES ('safe','Safe','fixture',1,3600,'1.0.0',1,'ui','x','x')`
    );
    const page = await (await fetch(`${base}/sources`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const response = await fetch(`${base}/api/sources/1`, {
      method: 'DELETE', headers: { 'X-CSRF-Token': token },
    });
    assert.equal(response.status, 200);
    assert.equal(db.get('SELECT enabled FROM sources WHERE id=1').enabled, 0);
    assert.equal(db.get('SELECT COUNT(*) n FROM sources').n, 1);
  });
});
