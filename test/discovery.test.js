import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from '../src/db/database.js';
import {
  classifyCandidate, parseRobotsTxt, parseSitemapXml, runSiteDiscovery,
  updateDiscoveryConfiguration,
} from '../src/core/discovery.js';
import { confirmSource, sourceConfigWithSeeds } from '../src/core/source-manager.js';
import { listCandidates, reviewCandidate, reviewCandidates } from '../src/core/review-queue.js';

function productHtml(model, name = 'Starter') {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: `BEYBLADE X ${model} ${name}`, brand: { '@type': 'Brand', name: 'Takara Tomy' },
    sku: model, image: `https://shop.example/images/${model}.jpg`,
    offers: { '@type': 'Offer', price: '1980', priceCurrency: 'JPY', availability: 'https://schema.org/InStock' },
  })}</script></head><body><h1>${model}</h1></body></html>`;
}

function setupDiscovery() {
  const db = new Database(':memory:');
  const added = confirmSource(db, {
    url: 'https://shop.example/category/beyblade', name: 'Example Shop',
    confirmed: true, discoveryOnly: true,
  });
  const pages = new Map([
    ['https://shop.example/robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://shop.example/sitemap.xml'],
    ['https://shop.example/sitemap.xml', `<?xml version="1.0"?><urlset>
      <url><loc>https://shop.example/product/beyblade-bx-38</loc></url>
      <url><loc>https://shop.example/about</loc></url></urlset>`],
    ['https://shop.example/category/beyblade', `<html><body><form action="/search" method="get"><input name="q"></form>
      <a href="/product/beyblade-ux-20">BEYBLADE X UX-20 Dran Buster</a>
      <a href="https://outside.example/product/beyblade-cx-01">outside</a></body></html>`],
    ['https://shop.example/product/beyblade-bx-38', productHtml('BX-38', 'Crimson Garuda')],
    ['https://shop.example/product/beyblade-ux-20', productHtml('UX-20', 'Dran Buster')],
  ]);
  const fetchPage = async (url) => {
    const body = pages.get(url);
    if (body == null) throw new Error('HTTP 404。');
    return { url, status: 200, body };
  };
  return { db, site: added.site, source: added.source, fetchPage };
}

test('robots and sitemap parsers preserve explicit scope rules', () => {
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://shop.example/sitemap.xml');
  assert.equal(robots.allowed('https://shop.example/private/item'), false);
  assert.equal(robots.allowed('https://shop.example/private/public/item'), true);
  assert.deepEqual(robots.sitemaps, ['https://shop.example/sitemap.xml']);
  const sitemap = parseSitemapXml('<sitemapindex><sitemap><loc>https://shop.example/a.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(sitemap.indexes, ['https://shop.example/a.xml']);
});

test('candidate classifier explains model and multilingual Beyblade signals', () => {
  const result = classifyCandidate({ title: 'ベイブレードX UX-20', brand: 'タカラトミー' }, 'https://shop.example/goods/ux20');
  assert.equal(result.model, 'UX-20');
  assert.ok(result.confidence >= 0.9);
  assert.ok(result.reasons.length >= 2);
});

test('controlled discovery stays on-site and fills the Review Queue within budget', async () => {
  const { db, site, fetchPage } = setupDiscovery();
  const run = await runSiteDiscovery(db, site.id, {
    fetchPage, sleep: async () => {}, budget: { maxPages: 20, maxDepth: 2, minIntervalMs: 1000 },
  });
  assert.equal(run.status, 'success');
  assert.ok(run.pages_fetched <= 20);
  assert.equal(run.candidates_found, 2);
  assert.equal(db.get("SELECT COUNT(*) n FROM crawl_frontier WHERE canonical_url LIKE '%outside.example%'").n, 0);
  assert.equal(db.get("SELECT COUNT(*) n FROM crawl_frontier WHERE canonical_url LIKE '%/search%'").n, 1);
  const candidates = listCandidates(db);
  assert.deepEqual(candidates.map((item) => item.model).sort(), ['BX-38', 'UX-20']);
  assert.ok(candidates.every((item) => item.reasons.length));
  db.close();
});

test('discovery budgets and human Recipe hints can be tuned per site', () => {
  const { db, site } = setupDiscovery();
  const updated = updateDiscoveryConfiguration(db, site.id, {
    maxPages: 40, maxDepth: 1, maxSeconds: 120, maxBytes: 20 * 1024 * 1024,
    intervalSeconds: 43200, includeTerms: 'beyblade, beyX', excludeTerms: 'used, parts',
    titleSelector: 'h1.product-name',
  });
  assert.equal(updated.settings.max_pages, 40);
  assert.equal(updated.settings.max_depth, 1);
  assert.equal(updated.settings.interval_seconds, 43200);
  const recipe = JSON.parse(updated.recipe.config_json);
  assert.deepEqual(recipe.includeTerms, ['beyblade', 'beyx']);
  assert.equal(recipe.selectors.title, 'h1.product-name');
  db.close();
});

test('a site cannot start overlapping discovery runs', async () => {
  const { db, site } = setupDiscovery();
  db.run(`INSERT INTO discovery_runs
    (site_id,seed_url,status,started_at,max_pages,max_depth,max_seconds,max_bytes)
    VALUES (?,'https://shop.example','running','x',100,2,300,52428800)`, [site.id]);
  await assert.rejects(() => runSiteDiscovery(db, site.id, { fetchPage: async () => ({ body: '' }) }), /已有探索工作/);
  db.close();
});

test('Review Queue approve creates Product/Offer and monitor seed; other actions are reversible', async () => {
  const { db, site, source, fetchPage } = setupDiscovery();
  await runSiteDiscovery(db, site.id, {
    fetchPage, sleep: async () => {}, budget: { maxPages: 20, maxDepth: 2 },
  });
  const candidates = listCandidates(db);
  const approved = reviewCandidate(db, candidates[0].id, 'approve', { eventCooldownSeconds: 0 });
  assert.equal(approved.status, 'approved');
  assert.ok(approved.product_id);
  assert.ok(approved.offer_id);
  assert.equal(db.get('SELECT enabled FROM sources WHERE id=?', [source.id]).enabled, 1);
  assert.equal(db.get("SELECT COUNT(*) n FROM seed_urls WHERE source_id=? AND purpose='monitor'", [source.id]).n, 1);
  assert.equal(sourceConfigWithSeeds(db, db.get('SELECT * FROM sources WHERE id=?', [source.id])).pages.length, 1);

  const other = candidates[1];
  reviewCandidates(db, [other.id], 'defer');
  assert.equal(db.get('SELECT status FROM product_candidates WHERE id=?', [other.id]).status, 'deferred');
  reviewCandidate(db, other.id, 'reopen');
  assert.equal(db.get('SELECT status FROM product_candidates WHERE id=?', [other.id]).status, 'pending');
  reviewCandidate(db, other.id, 'exclude');
  assert.equal(db.get('SELECT status FROM product_candidates WHERE id=?', [other.id]).status, 'excluded');
  db.close();
});

test('robots disallow prevents a sitemap candidate from entering the frontier', async () => {
  const db = new Database(':memory:');
  const added = confirmSource(db, {
    url: 'https://shop.example/category/beyblade', confirmed: true, discoveryOnly: true,
  });
  const fetchPage = async (url) => {
    if (url.endsWith('/robots.txt')) return { url, body: 'User-agent: *\nDisallow: /private\nSitemap: https://shop.example/sitemap.xml' };
    if (url.endsWith('/sitemap.xml')) return { url, body: '<urlset><url><loc>https://shop.example/private/beyblade-bx-99</loc></url></urlset>' };
    if (url.includes('/category/')) return { url, body: '<html><body>category</body></html>' };
    throw new Error('blocked test URL should not be fetched');
  };
  await runSiteDiscovery(db, added.site.id, {
    fetchPage, sleep: async () => {}, budget: { maxPages: 10, maxDepth: 2 },
  });
  assert.equal(db.get("SELECT COUNT(*) n FROM crawl_frontier WHERE canonical_url LIKE '%/private/%'").n, 0);
  assert.equal(db.get('SELECT COUNT(*) n FROM product_candidates').n, 0);
  db.close();
});

test('Takara Tomy Mall BEYBLADE X fixture completes the Phase 2 acceptance slice', async () => {
  const db = new Database(':memory:');
  const seed = 'https://takaratomymall.jp/shop/c/cBeyX/?wovn=english';
  const added = confirmSource(db, { url: seed, name: 'Takara Tomy Mall', confirmed: true, discoveryOnly: true });
  const category = readFileSync(new URL('../fixtures/html/takara-beyx-category.html', import.meta.url), 'utf8');
  const product = readFileSync(new URL('../fixtures/html/takara-product-jsonld.html', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../fixtures/html/takara-sitemap.xml', import.meta.url), 'utf8');
  const fetchPage = async (url) => {
    if (url.endsWith('/robots.txt')) return { url, body: 'User-agent: *\nAllow: /\nSitemap: https://takaratomymall.jp/sitemap.xml' };
    if (url.endsWith('/sitemap.xml')) return { url, body: sitemap };
    if (url.includes('/shop/c/cBeyX/')) return { url, body: category };
    if (url.includes('/shop/g/g4904810959553')) return { url, body: product };
    throw new Error('HTTP 404。');
  };
  const run = await runSiteDiscovery(db, added.site.id, {
    fetchPage, sleep: async () => {}, budget: { maxPages: 20, maxDepth: 2 },
  });
  assert.equal(run.status, 'success');
  const candidate = listCandidates(db)[0];
  assert.equal(candidate.model, 'UX-20');
  assert.equal(candidate.discovery_method, 'sitemap');
  assert.equal(candidate.registrable_domain, 'takaratomymall.jp');
  db.close();
});
