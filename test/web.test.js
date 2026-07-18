import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { createWebServer } from '../src/web/server.js';
import { confirmSource, saveOnboardingSettings } from '../src/core/source-manager.js';
import { processListing } from '../src/core/pipeline.js';
import { upsertSource } from '../src/core/store.js';
import { importOfficialItem, registerDefaultOfficialSources } from '../src/core/official.js';
import { importCommunityPost, registerDefaultCommunitySources } from '../src/core/community.js';

async function withServer(fn, options = {}) {
  const db = new Database(':memory:');
  const server = createWebServer(db, options);
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

test('Phase 7 settings UI stores privacy choices and never returns Telegram plaintext', async () => {
  let saved = null;
  const secretStore = {
    status: () => ({ provider: 'windows-dpapi-current-user', telegram: { configured: true } }),
    saveTelegram: (value) => { saved = value; return { telegram: { configured: true } }; },
    clearTelegram: () => ({ telegram: { configured: false } }),
    readNotifications: () => ({ telegram: { token: 'hidden-token', chatId: 'hidden-chat' } }),
  };
  await withServer(async ({ db, base }) => {
    const pageResponse = await fetch(`${base}/settings`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /Windows DPAPI/);
    assert.doesNotMatch(page, /hidden-token|hidden-chat/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const stored = await fetch(`${base}/api/notifications/telegram`, {
      method: 'POST', headers, body: JSON.stringify({ token: 'new-token', chatId: 'new-chat', test: false }),
    });
    assert.equal(stored.status, 200);
    assert.equal(saved.token, 'new-token');
    const privacy = await fetch(`${base}/api/privacy`, {
      method: 'POST', headers, body: JSON.stringify({ privacyAccepted: true, sourcePolicyAccepted: true, diagnosticsConsent: false }),
    });
    assert.equal(privacy.status, 200);
    assert.equal(db.get("SELECT value_json FROM user_settings WHERE key='privacyAccepted'").value_json, 'true');
    assert.equal((await fetch(`${base}/privacy`)).status, 200);
    assert.equal((await fetch(`${base}/source-policy`)).status, 200);
  }, { secretStore, appConfig: { browser: { available: false, downloadUrl: 'https://www.google.com/chrome/' }, update: {} } });
});

test('manual identity, exclusion review, and network controls are available through the local UI', async () => {
  await withServer(async ({ db, base }) => {
    const sourceA = upsertSource(db, { key: 'manual-a', name: 'Manual A', connector: 'fixture' });
    const sourceB = upsertSource(db, { key: 'manual-b', name: 'Manual B', connector: 'fixture' });
    const opts = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };
    const first = processListing(db, sourceA, { url: 'https://manual-a.example/bx-38',
      title: 'Beyblade X BX-38', availabilityRaw: 'https://schema.org/InStock' }, opts);
    processListing(db, sourceB, { url: 'https://manual-b.example/bx-38',
      title: 'Beyblade X BX-38', availabilityRaw: 'https://schema.org/InStock' }, opts);
    processListing(db, sourceA, { url: 'https://manual-a.example/used',
      title: 'Used Beyblade X BX-39', availabilityRaw: 'https://schema.org/InStock' }, opts);

    const detail = await (await fetch(`${base}/products/${first.productId}`)).text();
    assert.match(detail, /id="split-product-form"/);
    assert.match(detail, /id="merge-product-form"/);
    const token = detail.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const secondOffer = db.get('SELECT id FROM offers WHERE source_id=?', [sourceB.id]);
    const splitResponse = await fetch(`${base}/api/products/${first.productId}/split`, {
      method: 'POST', headers, body: JSON.stringify({ offerIds: [secondOffer.id], name: 'Manual split' }),
    });
    assert.equal(splitResponse.status, 201);
    const split = await splitResponse.json();
    const splitId = split.created.product.id;
    assert.equal(db.get('SELECT COUNT(*) count FROM products').count, 2);
    const merged = await fetch(`${base}/api/products/merge`, {
      method: 'POST', headers, body: JSON.stringify({ sourceProductId: splitId, targetProductId: first.productId }),
    });
    assert.equal(merged.status, 200);
    assert.equal(db.get('SELECT COUNT(*) count FROM products').count, 1);

    const exclusion = db.get('SELECT * FROM listing_exclusions');
    const exclusionsPage = await (await fetch(`${base}/exclusions`)).text();
    assert.match(exclusionsPage, /data-exclusion-action="allow"/);
    const allowed = await fetch(`${base}/api/exclusions/${exclusion.id}`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'allow', note: 'manual verification' }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(db.get('SELECT review_status FROM listing_exclusions WHERE id=?', [exclusion.id]).review_status, 'allowed');

    const paused = await fetch(`${base}/api/network`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: false, reason: 'operator pause' }),
    });
    assert.equal(paused.status, 200);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.network.enabled, false);
    const blocked = await fetch(`${base}/api/sources/preview`, {
      method: 'POST', headers, body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(blocked.status, 400);
    const resumed = await fetch(`${base}/api/network`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).network.enabled, true);
  });
});

test('Watchlist UI creates rules and official-source preview requires explicit confirmation', async () => {
  await withServer(async ({ db, base }) => {
    const registered = registerDefaultOfficialSources(db);
    const pageResponse = await fetch(`${base}/watchlist`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /想找清單/);
    assert.match(page, /Takara Tomy Mall/);
    assert.match(page, /第一次掃描預覽/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const created = await fetch(`${base}/api/watchlists`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'CX-99', productCode: 'CX-99', matchMode: 'exact', notificationEvents: ['in_stock'] }),
    });
    assert.equal(created.status, 201);
    assert.equal(db.get('SELECT COUNT(*) c FROM watchlists').c, 1);
    assert.equal(db.get('SELECT enabled FROM official_sources WHERE id=?', [registered.official.id]).enabled, 0);
    const confirmed = await fetch(`${base}/api/official-sources/${registered.official.id}/confirm`, {
      method: 'POST', headers, body: '{}',
    });
    assert.equal(confirmed.status, 200);
    assert.equal(db.get('SELECT enabled FROM official_sources WHERE id=?', [registered.official.id]).enabled, 1);

    importOfficialItem(db, 'takara-tomy-mall', {
      url: 'https://takaratomymall.jp/shop/g/g4904810999999/?wovn=english',
      title: 'BEYBLADE X CX-99 Future Starter', productCode: 'CX-99', eventType: 'announced',
      releaseDate: '2026-09-15', msrp: 2400, currency: 'JPY',
    });
    const catalog = await (await fetch(`${base}/catalog`)).text();
    assert.match(catalog, /官方商品情報/);
    assert.match(catalog, /CX-99/);
    assert.match(catalog, /2400 JPY/);
  });
});

test('community UI labels posts as unverified and updates source filters without enabling paid access', async () => {
  await withServer(async ({ db, base }) => {
    const source = registerDefaultCommunitySources(db);
    importCommunityPost(db, source.key, {
      id: 'web-1', url: 'https://x.com/bey_sokuhou/status/web-1',
      text: 'CX-99 再入荷の目撃情報 https://store.example/cx-99',
      created_at: '2026-07-16T03:00:00.000Z', author: 'bey_sokuhou',
    }, { acquisitionMethod: 'fixture' });
    const response = await fetch(`${base}/community`);
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.match(page, /社群貼文不是庫存或官方事實/);
    assert.match(page, /未驗證消息/);
    assert.match(page, /CX-99/);
    assert.match(page, /使用自己的 X Developer 帳戶設定/);
    assert.match(page, /繼續前請確認 X API 費用/);
    assert.match(page, /每天讀取 20 則不重複貼文/);
    assert.match(page, /href="https:\/\/console\.x\.com"/);
    assert.match(page, /id="x-console-link"[^>]+aria-disabled="true"/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const updated = await fetch(`${base}/api/community-sources/${source.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ muted: true, excludeTerms: '交換', retentionDays: 45,
        filterSensitive: true, filterSpam: true }),
    });
    assert.equal(updated.status, 200);
    const row = db.get('SELECT * FROM community_sources WHERE id=?', [source.id]);
    assert.equal(row.muted, 1);
    assert.equal(row.retention_days, 45);
    assert.equal(row.enabled, 0);
    assert.equal(row.monthly_budget_usd, 0);
  });
});

test('product detail exposes price and stock timeline, and check-now API wakes the monitor with cooldown', async () => {
  let wakes = 0;
  await withServer(async ({ db, base }) => {
    const source = upsertSource(db, {
      key: 'timeline', name: 'Timeline Store', connector: 'fixture', url: 'https://timeline.example',
    });
    const first = processListing(db, source, {
      url: 'https://timeline.example/bx-38', title: 'Beyblade X BX-38',
      availabilityRaw: 'https://schema.org/OutOfStock', price: 1200, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    processListing(db, source, {
      url: 'https://timeline.example/bx-38', title: 'Beyblade X BX-38',
      availabilityRaw: 'https://schema.org/InStock', price: 1080, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    db.run("UPDATE offers SET freshness_status='fresh',fresh_until='2099-01-01T00:00:00.000Z' WHERE source_id=?", [source.id]);
    const detail = await fetch(`${base}/products/${first.productId}`);
    const html = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(html, /價格與庫存時間線/);
    assert.match(html, /1200 JPY/);
    assert.match(html, /1080 JPY/);

    const sources = await (await fetch(`${base}/sources`)).text();
    assert.match(sources, /立即重新檢查/);
    const token = sources.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const queued = await fetch(`${base}/api/sources/${source.id}/check-now`, { method: 'POST', headers, body: '{}' });
    assert.equal(queued.status, 202);
    assert.equal(wakes, 1);
    const cooled = await fetch(`${base}/api/sources/${source.id}/check-now`, { method: 'POST', headers, body: '{}' });
    assert.equal(cooled.status, 400);
  }, { onMonitorRequested: () => { wakes += 1; } });
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

test('saved UI language renders English and Japanese pages with translated states and original store wording', async () => {
  await withServer(async ({ db, base }) => {
    const source = upsertSource(db, { key: 'i18n', name: '多語商店', connector: 'fixture', url: 'https://i18n.example' });
    processListing(db, source, {
      url: 'https://i18n.example/ux-20', title: 'ベイブレードX UX-20',
      availabilityText: '在庫あり', price: 1600, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    db.run("UPDATE offers SET freshness_status='fresh',fresh_until='2099-01-01T00:00:00.000Z' WHERE source_id=?", [source.id]);
    saveOnboardingSettings(db, { language: 'en', notification: 'app', scanFrequency: 'balanced', dataRetentionDays: 365 });
    const english = await (await fetch(`${base}/offers`)).text();
    assert.match(english, /lang="en"/);
    assert.match(english, /In stock/);
    assert.match(english, /在庫あり/);
    assert.match(english, /Store wording/);
    saveOnboardingSettings(db, { language: 'ja', notification: 'app', scanFrequency: 'balanced', dataRetentionDays: 365 });
    const japanese = await (await fetch(`${base}/catalog`)).text();
    assert.match(japanese, /lang="ja"/);
    assert.match(japanese, /商品識別/);
    assert.match(japanese, /UX-20/);
  });
});
