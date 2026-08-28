import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { computeAvailability, exclusionReason } from './classify.js';
import { trackerError } from '../errors/registry.js';
import { extractModel, normalizePrice, normalizeUrl, normalizeWhitespace } from './normalize.js';
import { canonicalizeSeedUrl, registrableDomain } from './site.js';
import { parseProductPage } from '../connectors/parse.js';
import { fetchPublicText } from '../net/public-http.js';
import { watchlistCandidateBoost } from './watchlist.js';
import { upsertOfficialCatalogItem } from './official.js';

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_DISCOVERY_BUDGET = Object.freeze({
  maxPages: 100,
  maxDepth: 2,
  maxSeconds: 300,
  maxBytes: 50 * 1024 * 1024,
  maxBrowserPages: 3,
  concurrency: 2,
  minIntervalMs: 1000,
});

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function normalizeDiscoveryBudget(value = {}) {
  return {
    maxPages: boundedInt(value.maxPages, DEFAULT_DISCOVERY_BUDGET.maxPages, 1, 500),
    maxDepth: boundedInt(value.maxDepth, DEFAULT_DISCOVERY_BUDGET.maxDepth, 0, 5),
    maxSeconds: boundedInt(value.maxSeconds, DEFAULT_DISCOVERY_BUDGET.maxSeconds, 10, 1800),
    maxBytes: boundedInt(value.maxBytes, DEFAULT_DISCOVERY_BUDGET.maxBytes, 1024 * 1024, 250 * 1024 * 1024),
    maxBrowserPages: boundedInt(value.maxBrowserPages, DEFAULT_DISCOVERY_BUDGET.maxBrowserPages, 0, 10),
    concurrency: boundedInt(value.concurrency, DEFAULT_DISCOVERY_BUDGET.concurrency, 1, 4),
    minIntervalMs: boundedInt(value.minIntervalMs, DEFAULT_DISCOVERY_BUDGET.minIntervalMs, 500, 10000),
  };
}

export function ensureDiscoverySettings(db, siteId, patch = {}) {
  const existing = db.get('SELECT * FROM discovery_settings WHERE site_id=?', [siteId]);
  if (existing && Object.keys(patch).length === 0) return existing;
  const budget = normalizeDiscoveryBudget(patch);
  const intervalSeconds = boundedInt(patch.intervalSeconds, 86400, 3600, 7 * 86400);
  const ts = now();
  db.run(
    `INSERT INTO discovery_settings
      (site_id,enabled,interval_seconds,max_pages,max_depth,max_seconds,max_bytes,
       max_browser_pages,concurrency,min_interval_ms,next_run_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,?)
     ON CONFLICT(site_id) DO UPDATE SET
       enabled=excluded.enabled,interval_seconds=excluded.interval_seconds,
       max_pages=excluded.max_pages,max_depth=excluded.max_depth,max_seconds=excluded.max_seconds,
       max_bytes=excluded.max_bytes,max_browser_pages=excluded.max_browser_pages,
       concurrency=excluded.concurrency,min_interval_ms=excluded.min_interval_ms,updated_at=excluded.updated_at`,
    [siteId, patch.enabled === false ? 0 : 1, intervalSeconds, budget.maxPages, budget.maxDepth,
      budget.maxSeconds, budget.maxBytes, budget.maxBrowserPages, budget.concurrency,
      budget.minIntervalMs, patch.nextRunAt || ts, ts, ts]
  );
  return db.get('SELECT * FROM discovery_settings WHERE site_id=?', [siteId]);
}

function safeTerms(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map((item) => normalizeWhitespace(item)?.toLowerCase())
    .filter((item) => item && item.length <= 80))].slice(0, 30);
}

function safeSelector(value) {
  const selector = normalizeWhitespace(value);
  return selector && selector.length <= 200 ? selector : undefined;
}

export function updateDiscoveryConfiguration(db, siteId, payload = {}) {
  const site = db.get('SELECT id FROM sites WHERE id=?', [siteId]);
  if (!site) throw new Error('找不到要設定的商店。');
  const settings = ensureDiscoverySettings(db, siteId, payload);
  const current = db.get('SELECT * FROM site_recipes WHERE site_id=?', [siteId]);
  let config = {};
  try { config = current?.config_json ? JSON.parse(current.config_json) : {}; } catch { config = {}; }
  config = {
    ...config,
    includeTerms: safeTerms(payload.includeTerms),
    excludeTerms: safeTerms(payload.excludeTerms),
    selectors: {
      ...(config.selectors || {}),
      title: safeSelector(payload.titleSelector),
      price: safeSelector(payload.priceSelector),
      availabilityText: safeSelector(payload.availabilitySelector),
    },
  };
  config.selectors = Object.fromEntries(Object.entries(config.selectors).filter(([, value]) => value));
  const ts = now();
  db.run(
    `INSERT INTO site_recipes (site_id,version,status,config_json,created_at,updated_at)
     VALUES (?,1,'suggested',?,?,?)
     ON CONFLICT(site_id) DO UPDATE SET version=site_recipes.version+1,
       status='suggested',config_json=excluded.config_json,updated_at=excluded.updated_at`,
    [siteId, JSON.stringify(config), ts, ts]
  );
  return { settings, recipe: db.get('SELECT * FROM site_recipes WHERE site_id=?', [siteId]) };
}

function budgetFromSettings(settings, overrides = {}) {
  return normalizeDiscoveryBudget({
    maxPages: overrides.maxPages ?? settings?.max_pages,
    maxDepth: overrides.maxDepth ?? settings?.max_depth,
    maxSeconds: overrides.maxSeconds ?? settings?.max_seconds,
    maxBytes: overrides.maxBytes ?? settings?.max_bytes,
    maxBrowserPages: overrides.maxBrowserPages ?? settings?.max_browser_pages,
    concurrency: overrides.concurrency ?? settings?.concurrency,
    minIntervalMs: overrides.minIntervalMs ?? settings?.min_interval_ms,
  });
}

export function parseRobotsTxt(text, agent = 'BeybladeTracker') {
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const split = line.indexOf(':');
    if (split < 0) continue;
    const key = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (key === 'sitemap' && value) { sitemaps.push(value); continue; }
    if (key === 'user-agent') {
      if (current && current.rules.length === 0) current.agents.push(value.toLowerCase());
      else {
        current = { agents: [value.toLowerCase()], rules: [] };
        groups.push(current);
      }
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current.rules.push({ type: key, path: value });
    }
  }
  const target = agent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((value) => value !== '*' && target.includes(value)));
  const matching = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  const rules = matching.flatMap((group) => group.rules);
  const matchesRule = (path, pattern) => {
    const anchored = pattern.endsWith('$');
    const source = pattern.replace(/\$$/, '').split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    try { return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path); } catch { return false; }
  };
  return {
    sitemaps: [...new Set(sitemaps)],
    allowed(input) {
      const path = new URL(input).pathname + new URL(input).search;
      const matches = rules.filter((rule) => rule.path && matchesRule(path, rule.path));
      if (!matches.length) return true;
      matches.sort((a, b) => b.path.replace(/[\*$]/g, '').length - a.path.replace(/[\*$]/g, '').length || (a.type === 'allow' ? -1 : 1));
      return matches[0].type === 'allow';
    },
  };
}

export function parseSitemapXml(xml) {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const urls = $('url > loc').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const indexes = $('sitemap > loc').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  return { urls, indexes };
}

function sameSite(url, domain) {
  try { return registrableDomain(new URL(url)) === domain; } catch { return false; }
}

function fetchUrl(input, base) {
  const value = normalizeUrl(input, base);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允許 HTTP(S) 探索。');
  return url.toString();
}

function fingerprint(input) {
  return createHash('sha256').update(canonicalizeSeedUrl(input)).digest('hex');
}

function urlHints(url, text = '', recipe = {}) {
  const hay = `${decodeURIComponent(new URL(url).pathname)} ${new URL(url).search} ${text}`.toLowerCase();
  let score = 0;
  const reasons = [];
  if (/(beyblade|beyx|ベイブレード|戰鬥陀螺|战斗陀螺|爆旋陀螺)/i.test(hay)) {
    score += 45; reasons.push('Beyblade 關鍵字');
  }
  if (/\b(?:bx|ux|cx|bb|b)-?\d{2,3}\b/i.test(hay)) {
    score += 45; reasons.push('商品型號');
  }
  if (/(\/g\/g|\/product|\/products|\/item|\/goods|\/p\/)/i.test(hay)) {
    score += 20; reasons.push('商品頁網址樣式');
  }
  if (/(category|collection|search|catalog|c\/c|page=|pageno=)/i.test(hay)) {
    score += 10; reasons.push('分類或分頁');
  }
  if (/(login|signin|account|cart|checkout|privacy|terms|contact|javascript:|mailto:)/i.test(hay)) score -= 100;
  if ((recipe.excludeTerms || []).some((term) => hay.includes(term))) {
    score -= 100; reasons.push('符合 Recipe 排除詞');
  }
  if ((recipe.includeTerms || []).some((term) => hay.includes(term))) {
    score += 30; reasons.push('符合 Recipe 包含詞');
  }
  return { score, reasons };
}

function extractLinks(html, base, domain, robots, depth, recipe) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, element) => {
    const text = normalizeWhitespace($(element).text()).slice(0, 200);
    let url;
    try { url = fetchUrl($(element).attr('href'), base); } catch { return; }
    if (!sameSite(url, domain) || !robots.allowed(url)) return;
    const hint = urlHints(url, text, recipe);
    if (hint.score < 10) return;
    links.push({ url, text, depth, priority: Math.min(100, 35 + hint.score), kind: 'page' });
  });
  return links;
}

function extractSearchUrls(html, base, domain, robots, depth) {
  const $ = cheerio.load(html);
  const results = [];
  $('form').each((_, form) => {
    const method = String($(form).attr('method') || 'get').toLowerCase();
    if (method !== 'get') return;
    const field = $(form).find('input[name]').toArray().find((input) =>
      /^(q|query|keyword|keywords|search|searchword)$/i.test($(input).attr('name') || '')
    );
    if (!field) return;
    let url;
    try {
      url = new URL($(form).attr('action') || base, base);
      url.searchParams.set($(field).attr('name'), 'BEYBLADE');
    } catch { return; }
    if (!sameSite(url, domain) || !robots.allowed(url)) return;
    results.push({ url: url.toString(), text: '網站公開搜尋 BEYBLADE', depth, priority: 88, kind: 'page' });
  });
  return results;
}

export function classifyCandidate(listing, url) {
  const title = normalizeWhitespace(listing?.title || '');
  const model = extractModel(title) || extractModel(listing?.sku) || null;
  const hay = `${title} ${listing?.brand || ''} ${url}`;
  const reasons = [];
  let confidence = 0;
  if (model) { confidence += 0.45; reasons.push(`辨識到型號 ${model}`); }
  if (/(beyblade|ベイブレード|戰鬥陀螺|战斗陀螺|爆旋陀螺)/i.test(hay)) {
    confidence += 0.4; reasons.push('名稱或網址包含 Beyblade 關鍵字');
  }
  if (/takara\s*tomy|タカラトミー/i.test(hay)) {
    confidence += 0.1; reasons.push('辨識到 Takara Tomy 品牌');
  }
  if (listing?.rawSummary?.source === 'json-ld') {
    confidence += 0.15; reasons.push('頁面提供 Product JSON-LD');
  }
  const excluded = exclusionReason({ ...listing, title });
  if (excluded) reasons.push(`排除規則：${excluded}`);
  confidence = Number(Math.min(0.99, confidence).toFixed(2));
  return { title, model, confidence, reasons, excludedReason: excluded };
}

function enqueue(db, runId, item) {
  let url;
  try { url = fetchUrl(item.url, item.discoveredFrom); } catch { return false; }
  const ts = now();
  const result = db.run(
    `INSERT OR IGNORE INTO crawl_frontier
      (discovery_run_id,canonical_url,url_fingerprint,discovered_from,discovery_kind,
       link_text,depth,priority,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'pending',?,?)`,
    [runId, url, fingerprint(url), item.discoveredFrom || null, item.kind || 'page',
      item.text || null, item.depth || 0, item.priority || 0, ts, ts]
  );
  return Number(result.changes || 0) > 0;
}

function saveCandidate(db, { site, runId, url, listing, method }) {
  const classification = classifyCandidate(listing, url);
  const boost = watchlistCandidateBoost(db, listing);
  if (boost.score) {
    classification.confidence = Number(Math.min(0.99, classification.confidence + boost.score).toFixed(2));
    classification.reasons.push(boost.reason);
  }
  if (!classification.title || classification.confidence < 0.45) return null;
  const availability = computeAvailability(listing);
  const normalizedPrice = normalizePrice(listing.price, listing.currency);
  const official = db.get("SELECT key FROM official_sources WHERE site_id=? AND source_class='official_store'", [site.id]);
  if (official && classification.model && classification.confidence >= 0.8 && !classification.excludedReason) {
    upsertOfficialCatalogItem(db, official.key, {
      ...listing, url, title: classification.title, productCode: classification.model,
      msrp: normalizedPrice.price, currency: normalizedPrice.currency,
    });
  }
  const ts = now();
  const suggestedStatus = classification.excludedReason ? 'excluded' : 'pending';
  db.run(
    `INSERT INTO product_candidates
      (site_id,discovery_run_id,canonical_url,title,brand,series,model,barcode,price,currency,
       availability,image,confidence,reasons_json,discovery_method,listing_json,status,
       first_discovered_at,last_discovered_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(site_id,canonical_url) DO UPDATE SET
       discovery_run_id=excluded.discovery_run_id,title=excluded.title,brand=excluded.brand,
       series=excluded.series,model=excluded.model,barcode=excluded.barcode,price=excluded.price,
       currency=excluded.currency,availability=excluded.availability,image=excluded.image,
       confidence=excluded.confidence,reasons_json=excluded.reasons_json,
       discovery_method=excluded.discovery_method,listing_json=excluded.listing_json,
       last_discovered_at=excluded.last_discovered_at,updated_at=excluded.updated_at`,
    [site.id, runId, canonicalizeSeedUrl(url), classification.title, listing.brand || null,
      listing.series || null, classification.model, listing.barcode || null,
      normalizedPrice.price ?? null, normalizedPrice.currency || null, availability.state,
      listing.image || null, classification.confidence, JSON.stringify(classification.reasons), method,
      JSON.stringify({ ...listing, url: canonicalizeSeedUrl(url), model: classification.model }).slice(0, 12000),
      suggestedStatus, ts, ts, ts, ts]
  );
  return db.get('SELECT * FROM product_candidates WHERE site_id=? AND canonical_url=?',
    [site.id, canonicalizeSeedUrl(url)]);
}

function finishRun(db, runId, status, counters, error = null) {
  const pending = db.get(
    "SELECT COUNT(*) n FROM crawl_frontier WHERE discovery_run_id=? AND status='pending'", [runId]
  ).n;
  db.run(
    `UPDATE discovery_runs SET status=?,finished_at=?,pages_fetched=?,bytes_fetched=?,
      candidates_found=?,frontier_pending=?,stop_reason=?,error=? WHERE id=?`,
    [status, now(), counters.pages, counters.bytes, counters.candidates.size, pending,
      counters.stopReason || null, error ? String(error).slice(0, 500) : null, runId]
  );
}

export const RECIPE_NO_CANDIDATES = 'no candidates recognised';

function updateRecipe(db, siteId, successful, error = null) {
  const ts = now();
  db.run(
    `INSERT INTO site_recipes
      (site_id,version,status,config_json,last_success_at,last_failure_at,last_error,created_at,updated_at)
     VALUES (?,1,?,'{}',?,?,?, ?,?)
     ON CONFLICT(site_id) DO UPDATE SET status=excluded.status,
       last_success_at=COALESCE(excluded.last_success_at,site_recipes.last_success_at),
       last_failure_at=excluded.last_failure_at,last_error=excluded.last_error,updated_at=excluded.updated_at`,
    [siteId, successful ? 'active' : 'needs_review', successful ? ts : null,
      successful ? null : ts, error ? String(error).slice(0, 500) : null, ts, ts]
  );
}

export async function runSiteDiscovery(db, siteId, options = {}) {
  const site = db.get('SELECT * FROM sites WHERE id=?', [siteId]);
  if (!site) throw trackerError('BT-SRC-004', '找不到要探索的商店。');
  const running = db.get(
    "SELECT id FROM discovery_runs WHERE site_id=? AND status='running' AND finished_at IS NULL LIMIT 1",
    [siteId]
  );
  if (running) throw trackerError('BT-SRC-005', '這間商店已有探索工作正在執行，請等待完成。');
  const seed = options.seedUrl || db.get(
    `SELECT original_url FROM seed_urls WHERE site_id=? AND enabled=1
     ORDER BY CASE purpose WHEN 'discovery' THEN 0 ELSE 1 END,id LIMIT 1`, [siteId]
  )?.original_url;
  if (!seed) throw trackerError('BT-SRC-006', '這間商店沒有可用的探索網址。');
  if (!sameSite(seed, site.registrable_domain)) throw trackerError('BT-SRC-007', '探索網址不在這間商店的網域內。');

  let settings = db.get('SELECT * FROM discovery_settings WHERE site_id=?', [siteId]);
  if (!settings) settings = ensureDiscoverySettings(db, siteId);
  const budget = budgetFromSettings(settings, options.budget || {});
  const recipeRow = db.get('SELECT status,config_json FROM site_recipes WHERE site_id=?', [siteId]);
  let recipe = {};
  try { recipe = recipeRow?.config_json ? JSON.parse(recipeRow.config_json) : {}; } catch { recipe = {}; }
  const started = Date.now();
  const info = db.run(
    `INSERT INTO discovery_runs
      (site_id,seed_url,status,started_at,max_pages,max_depth,max_seconds,max_bytes)
     VALUES (?,?,'running',?,?,?,?,?)`,
    [siteId, seed, now(), budget.maxPages, budget.maxDepth, budget.maxSeconds, budget.maxBytes]
  );
  const runId = Number(info.lastInsertRowid);
  const counters = { pages: 0, bytes: 0, candidates: new Set(), stopReason: null };
  const fetchPage = options.fetchPage || fetchPublicText;
  const waitFor = options.sleep || sleep;
  const baseOrigin = new URL(seed).origin;
  const robotsUrl = new URL('/robots.txt', baseOrigin).toString();
  enqueue(db, runId, { url: robotsUrl, kind: 'robots', priority: 120, depth: 0 });
  enqueue(db, runId, { url: new URL('/sitemap.xml', baseOrigin).toString(), kind: 'sitemap', priority: 110, depth: 0 });
  enqueue(db, runId, { url: seed, kind: 'page', priority: 100, depth: 0 });
  let robots = { allowed: () => true, sitemaps: [] };
  let lastRequestAt = 0;

  try {
    while (true) {
      const elapsed = (Date.now() - started) / 1000;
      if (counters.pages >= budget.maxPages) { counters.stopReason = '已達頁數預算。'; break; }
      if (counters.bytes >= budget.maxBytes) { counters.stopReason = '已達下載量預算。'; break; }
      if (elapsed >= budget.maxSeconds) { counters.stopReason = '已達時間預算。'; break; }
      const item = db.get(
        `SELECT * FROM crawl_frontier WHERE discovery_run_id=? AND status='pending'
         ORDER BY priority DESC,id LIMIT 1`, [runId]
      );
      if (!item) break;
      if (item.depth > budget.maxDepth || !sameSite(item.canonical_url, site.registrable_domain) ||
          (item.discovery_kind === 'page' && !robots.allowed(item.canonical_url))) {
        db.run("UPDATE crawl_frontier SET status='skipped',updated_at=? WHERE id=?", [now(), item.id]);
        continue;
      }
      const wait = lastRequestAt + budget.minIntervalMs - Date.now();
      if (wait > 0) await waitFor(wait);
      db.run("UPDATE crawl_frontier SET status='fetching',attempts=attempts+1,updated_at=? WHERE id=?", [now(), item.id]);
      lastRequestAt = Date.now();
      try {
        const fetched = await fetchPage(item.canonical_url, {
          timeoutMs: Math.min(30000, budget.maxSeconds * 1000), maxRedirects: 3,
          maxBytes: Math.min(2 * 1024 * 1024, budget.maxBytes - counters.bytes),
          userAgent: options.userAgent, lookupFn: options.lookupFn, fetchImpl: options.fetchImpl,
          maxRetries: options.maxRetries ?? 2, perHostMinIntervalMs: 0,
        });
        if (!sameSite(fetched.url || item.canonical_url, site.registrable_domain)) {
          throw new Error('網站重新導向到探索範圍以外，已停止該頁。');
        }
        counters.pages += 1;
        counters.bytes += Buffer.byteLength(fetched.body || '');
        db.run("UPDATE crawl_frontier SET status='visited',updated_at=? WHERE id=?", [now(), item.id]);

        if (item.discovery_kind === 'robots') {
          robots = parseRobotsTxt(fetched.body);
          db.run('UPDATE discovery_runs SET robots_checked=1 WHERE id=?', [runId]);
          for (const sitemap of robots.sitemaps) {
            if (sameSite(sitemap, site.registrable_domain)) enqueue(db, runId, {
              url: sitemap, discoveredFrom: fetched.url, kind: 'sitemap', priority: 115, depth: 0,
            });
          }
          continue;
        }
        if (item.discovery_kind === 'sitemap' || /<\s*(?:urlset|sitemapindex)\b/i.test(fetched.body)) {
          const sitemap = parseSitemapXml(fetched.body);
          for (const url of sitemap.indexes) if (sameSite(url, site.registrable_domain)) enqueue(db, runId, {
            url, discoveredFrom: fetched.url, kind: 'sitemap', priority: 105, depth: item.depth,
          });
          for (const url of sitemap.urls) {
            if (!sameSite(url, site.registrable_domain) || !robots.allowed(url)) continue;
            const hint = urlHints(url, '', recipe);
            if (hint.score >= 20) enqueue(db, runId, {
              url, discoveredFrom: fetched.url, kind: 'page', priority: Math.min(95, 45 + hint.score), depth: 1,
            });
          }
          continue;
        }

        const listing = parseProductPage(fetched.body, {
          url: fetched.url, selectors: options.selectors || recipe.selectors || {},
        });
        const method = !item.discovered_from ? 'seed'
          : /sitemap|\.xml(?:$|\?)/i.test(item.discovered_from) ? 'sitemap' : 'link';
        const candidate = saveCandidate(db, { site, runId, url: fetched.url, listing, method });
        if (candidate) counters.candidates.add(Number(candidate.id));
        if (item.depth < budget.maxDepth) {
          const links = [
            ...extractSearchUrls(fetched.body, fetched.url, site.registrable_domain, robots, item.depth + 1),
            ...extractLinks(fetched.body, fetched.url, site.registrable_domain, robots, item.depth + 1, recipe),
          ];
          for (const link of links) {
            enqueue(db, runId, { ...link, discoveredFrom: fetched.url });
          }
        }
        if (recipeRow?.status === 'active' && counters.pages >= 10 && counters.candidates.size === 0) {
          counters.stopReason = '既有 Recipe 連續讀取 10 頁仍無候選，已停止擴大並等待調整。';
          break;
        }
      } catch (err) {
        const refused = /HTTP (?:401|403|429)|拒絕|CAPTCHA|robots/i.test(err.message);
        db.run("UPDATE crawl_frontier SET status='failed',last_error=?,updated_at=? WHERE id=?",
          [String(err.message).slice(0, 500), now(), item.id]);
        if (refused) { counters.stopReason = `網站拒絕存取：${err.message}`; break; }
      }
    }

    const budgetStopped = /預算/.test(counters.stopReason || '');
    const status = counters.stopReason ? (budgetStopped ? 'budget_exhausted' : 'stopped') : 'success';
    if (counters.candidates.size === 0) {
      // A stable token, not prose: the sources page turns this into localized text, and storing
      // a sentence would pin the message to one language forever (BT-UX-003).
      updateRecipe(db, siteId, false, RECIPE_NO_CANDIDATES);
    } else updateRecipe(db, siteId, true);
    finishRun(db, runId, status, counters);
  } catch (err) {
    updateRecipe(db, siteId, false, err.message);
    finishRun(db, runId, 'failed', counters, err);
    throw err;
  } finally {
    const next = new Date(Date.now() + Number(settings.interval_seconds || 86400) * 1000).toISOString();
    db.run('UPDATE discovery_settings SET last_run_at=?,next_run_at=?,updated_at=? WHERE site_id=?',
      [now(), next, now(), siteId]);
  }
  return db.get('SELECT * FROM discovery_runs WHERE id=?', [runId]);
}

export async function runDueDiscoveries(db, options = {}) {
  const current = options.now || now();
  const due = db.all(
    `SELECT ds.site_id FROM discovery_settings ds
     LEFT JOIN site_recipes sr ON sr.site_id=ds.site_id
     WHERE ds.enabled=1 AND COALESCE(sr.status,'suggested')<>'needs_review'
     AND ds.next_run_at IS NOT NULL AND ds.next_run_at<=? ORDER BY ds.next_run_at LIMIT 3`, [current]
  );
  const results = [];
  for (const row of due) {
    try { results.push(await runSiteDiscovery(db, Number(row.site_id), options)); }
    catch (error) { results.push({ site_id: row.site_id, status: 'failed', error: error.message }); }
  }
  return results;
}

export function listDiscoverySites(db) {
  return db.all(`
    SELECT si.*,ds.enabled AS discovery_enabled,ds.interval_seconds,ds.max_pages,ds.max_depth,
      ds.max_seconds,ds.max_bytes,ds.max_browser_pages,ds.concurrency,ds.min_interval_ms,
      ds.next_run_at,ds.last_run_at,
      sr.status AS recipe_status,sr.config_json AS recipe_config_json,sr.last_error AS recipe_error,
      (SELECT COUNT(*) FROM product_candidates c WHERE c.site_id=si.id AND c.status='pending') AS pending_candidates,
      (SELECT COUNT(*) FROM product_candidates c WHERE c.site_id=si.id) AS total_candidates,
      (SELECT status FROM discovery_runs r WHERE r.site_id=si.id ORDER BY r.id DESC LIMIT 1) AS last_run_status,
      (SELECT finished_at FROM discovery_runs r WHERE r.site_id=si.id ORDER BY r.id DESC LIMIT 1) AS last_run_finished_at
    FROM sites si LEFT JOIN discovery_settings ds ON ds.site_id=si.id
    LEFT JOIN site_recipes sr ON sr.site_id=si.id ORDER BY si.display_name COLLATE NOCASE
  `);
}

export function recoverInterruptedDiscoveryRuns(db) {
  const ts = now();
  const message = '服務上次未正常結束；探索工作已標記為中斷，可由來源管理重新執行。';
  const runs = db.all("SELECT id FROM discovery_runs WHERE status='running' AND finished_at IS NULL");
  for (const run of runs) {
    db.run(
      "UPDATE discovery_runs SET status='failed',finished_at=?,stop_reason=?,error=? WHERE id=?",
      [ts, message, message, run.id]
    );
    db.run(
      "UPDATE crawl_frontier SET status='failed',last_error=?,updated_at=? WHERE discovery_run_id=? AND status='fetching'",
      [message, ts, run.id]
    );
  }
  return runs.length;
}
