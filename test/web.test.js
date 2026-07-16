import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { createWebServer } from '../src/web/server.js';
import { confirmSource } from '../src/core/source-manager.js';

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

test('Review Queue page and batch approval API create monitored data', async () => {
  await withServer(async ({ db, base }) => {
    const added = confirmSource(db, {
      url: 'https://shop.example/category/beyblade', confirmed: true, discoveryOnly: true,
    });
    const ts = new Date().toISOString();
    const listing = {
      url: 'https://shop.example/product/beyblade-bx-38', title: 'BEYBLADE X BX-38',
      model: 'BX-38', price: 1980, currency: 'JPY', availabilityRaw: 'https://schema.org/InStock',
    };
    const id = db.run(`INSERT INTO product_candidates
      (site_id,canonical_url,title,model,price,currency,availability,confidence,reasons_json,
       discovery_method,listing_json,status,first_discovered_at,last_discovered_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'in_stock',0.95,'["型號"]','sitemap',?,'pending',?,?,?,?)`,
    [added.site.id, listing.url, listing.title, listing.model, listing.price, listing.currency,
      JSON.stringify(listing), ts, ts, ts, ts]).lastInsertRowid;
    const pageResponse = await fetch(`${base}/review`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /BX-38/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const reviewed = await fetch(`${base}/api/candidates/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ ids: [Number(id)], action: 'approve' }),
    });
    assert.equal(reviewed.status, 200);
    assert.equal(db.get('SELECT status FROM product_candidates WHERE id=?', [id]).status, 'approved');
    assert.equal(db.get('SELECT COUNT(*) n FROM products').n, 1);
    assert.equal(db.get('SELECT COUNT(*) n FROM offers').n, 1);
  });
});

test('discovery settings API validates and saves per-site budgets', async () => {
  await withServer(async ({ db, base }) => {
    const added = confirmSource(db, {
      url: 'https://shop.example/category/beyblade', confirmed: true, discoveryOnly: true,
    });
    const page = await (await fetch(`${base}/sources`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const response = await fetch(`${base}/api/sites/${added.site.id}/discovery-settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ maxPages: 25, maxDepth: 1, includeTerms: 'beyblade' }),
    });
    assert.equal(response.status, 200);
    assert.equal(db.get('SELECT max_pages FROM discovery_settings WHERE site_id=?', [added.site.id]).max_pages, 25);
  });
});
