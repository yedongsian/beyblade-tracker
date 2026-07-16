import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { logger } from '../util/logger.js';
import {
  confirmSource, listManagedSources, previewSourceUrl, readSettings,
  saveOnboardingSettings, setSourceEnabled, testManagedSource,
} from '../core/source-manager.js';
import {
  listDiscoverySites, runSiteDiscovery, updateDiscoveryConfiguration,
} from '../core/discovery.js';
import { listCandidates, reviewCandidate, reviewCandidates } from '../core/review-queue.js';
import { assertPublicUrl } from '../net/public-http.js';
import { esc, layout, reviewQueueScript, sourcesScript, table } from './ui.js';

function stateBadge(state) {
  const kind = ['in_stock'].includes(state) ? 'good' :
    ['out_of_stock'].includes(state) ? 'bad' : 'warn';
  return `<span class="pill ${kind}">${esc(state)}</span>`;
}

export function healthData(db) {
  const sources = db.all('SELECT * FROM sources');
  const unhealthy = sources.filter((source) => source.enabled && source.consecutive_failures >= 3);
  const counts = {
    sources: sources.length,
    enabledSources: sources.filter((source) => source.enabled).length,
    products: db.get('SELECT COUNT(*) c FROM products').c,
    offers: db.get('SELECT COUNT(*) c FROM offers').c,
    purchasableOffers: db.get(`SELECT COUNT(*) c FROM offers o
      JOIN sources s ON s.id=o.source_id WHERE o.purchasable=1 AND s.enabled=1`).c,
    events: db.get('SELECT COUNT(*) c FROM events').c,
    pendingNotifications: db.get('SELECT COUNT(*) c FROM events WHERE notified=0').c,
    pendingCandidates: db.get("SELECT COUNT(*) c FROM product_candidates WHERE status='pending'").c,
  };
  return {
    status: unhealthy.length ? 'degraded' : 'ok',
    time: new Date().toISOString(), counts,
    sources: sources.map((source) => ({
      key: source.key, name: source.name, enabled: Boolean(source.enabled),
      healthy: source.consecutive_failures < 3,
      lastSuccessAt: source.last_success_at, lastFailureAt: source.last_failure_at,
      consecutiveFailures: source.consecutive_failures, lastError: source.last_error,
    })),
  };
}

function pageOptions(db, base) {
  return { ...base, onboarding: !readSettings(db).onboardingCompleted };
}

function overviewPage(db, base) {
  const health = healthData(db);
  const counts = health.counts;
  const body = `<section class="hero"><p class="eyebrow">本機個人版</p><h1>追蹤想買的 Beyblade，不必碰設定檔</h1><p>來源、商品狀態與事件都保存在這台電腦。加入商店前會先預覽，只有確認後才開始監控。</p><p><a class="btn" href="/sources">加入或管理商店</a></p></section>
  <section class="grid stats" aria-label="追蹤摘要">
    <article class="card stat"><strong>${counts.enabledSources}</strong><span>啟用來源</span></article>
    <article class="card stat"><strong>${counts.products}</strong><span>商品</span></article>
    <article class="card stat"><strong>${counts.offers}</strong><span>商店刊登</span></article>
    <article class="card stat"><strong>${counts.purchasableOffers}</strong><span>目前可購買</span></article>
  </section><section class="card"><div class="section-head"><div><h2>系統狀態</h2><p>來源失敗不會中止其他商店。</p></div><span class="pill ${health.status === 'ok' ? 'good' : 'bad'}">${health.status === 'ok' ? '運作正常' : '需要注意'}</span></div>
  ${table(['來源', '啟用', '最後成功', '連續失敗'], health.sources.map((source) => [
    esc(source.name), source.enabled ? '是' : '否', esc(source.lastSuccessAt || '尚未成功'), esc(source.consecutiveFailures),
  ]))}</section>`;
  return layout(pageOptions(db, { ...base, title: '總覽', current: '/', body }));
}

function productsPage(db, base) {
  const rows = db.all(`SELECT p.*,(SELECT COUNT(*) FROM offers o WHERE o.product_id=p.id) offers
    FROM products p ORDER BY p.updated_at DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">追蹤結果</p><h1>商品</h1><p>同型號跨商店刊登會集中顯示。</p></div></div>${table(
    ['商品', '型號', '品牌', '條碼', 'Offer'], rows.map((row) => [
      esc(row.name), esc(row.model || '—'), esc(row.brand || '—'), esc(row.barcode || '—'), esc(row.offers),
    ])
  )}`;
  return layout(pageOptions(db, { ...base, title: '商品', current: '/products', body }));
}

function offersPage(db, base) {
  const rows = db.all(`SELECT o.*,p.name pname,p.model pmodel,s.name sname FROM offers o
    JOIN products p ON p.id=o.product_id JOIN sources s ON s.id=o.source_id
    WHERE s.enabled=1 ORDER BY o.purchasable DESC,o.last_seen_at DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">價格與庫存</p><h1>商店刊登</h1><p>狀態旁的最後檢查時間代表資料新鮮度。</p></div></div>${table(
    ['商品', '商店', '狀態', '價格', '最後檢查', '連結'], rows.map((row) => [
      `${esc(row.pname)}${row.pmodel ? `<br><span class="muted">${esc(row.pmodel)}</span>` : ''}`,
      esc(row.sname), stateBadge(row.availability), Number.isFinite(row.price) ? esc(`${row.price} ${row.currency || ''}`) : '—',
      esc(row.last_seen_at), `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">開啟商品頁</a>`,
    ])
  )}`;
  return layout(pageOptions(db, { ...base, title: '商店刊登', current: '/offers', body }));
}

function eventsPage(db, base) {
  const rows = db.all(`SELECT e.*,p.name pname,s.name sname FROM events e
    JOIN products p ON p.id=e.product_id LEFT JOIN sources s ON s.id=e.source_id
    ORDER BY e.id DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">變化紀錄</p><h1>事件</h1><p>新品、預購、補貨與價格變化會保留在這裡。</p></div></div>${table(
    ['時間', '類型', '商品', '商店', '變化'], rows.map((row) => [
      esc(row.created_at), esc(row.type), esc(row.pname), esc(row.sname || '—'),
      esc([row.from_state, row.to_state].filter(Boolean).join(' → ') || '—'),
    ])
  )}`;
  return layout(pageOptions(db, { ...base, title: '事件', current: '/events', body }));
}

function sourcesPage(db, base) {
  const rows = listManagedSources(db);
  const discoverySites = new Map(listDiscoverySites(db).map((site) => [Number(site.id), site]));
  const cards = rows.map((source) => {
    const discovery = discoverySites.get(Number(source.site_id));
    const hasMonitorPages = Number(source.seed_count) > 0;
    let recipe = {};
    try { recipe = discovery?.recipe_config_json ? JSON.parse(discovery.recipe_config_json) : {}; } catch { recipe = {}; }
    const settingPanel = discovery ? `<details style="margin-top:.75rem"><summary>探索安全預算與 Recipe</summary><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:.75rem" data-discovery-settings="${source.site_id}">
      <div><label for="max-pages-${source.id}">最多頁數</label><input id="max-pages-${source.id}" data-setting="maxPages" type="number" min="1" max="500" value="${esc(discovery.max_pages || 100)}"></div>
      <div><label for="max-depth-${source.id}">最大深度</label><input id="max-depth-${source.id}" data-setting="maxDepth" type="number" min="0" max="5" value="${esc(discovery.max_depth ?? 2)}"></div>
      <div><label for="max-seconds-${source.id}">最長秒數</label><input id="max-seconds-${source.id}" data-setting="maxSeconds" type="number" min="10" max="1800" value="${esc(discovery.max_seconds || 300)}"></div>
      <div><label for="max-mb-${source.id}">最多 MB</label><input id="max-mb-${source.id}" data-setting="maxMb" type="number" min="1" max="250" value="${esc(Math.round(Number(discovery.max_bytes || 52428800) / 1048576))}"></div>
      <div><label for="interval-${source.id}">探索間隔（小時）</label><input id="interval-${source.id}" data-setting="intervalHours" type="number" min="1" max="168" value="${esc(Math.round(Number(discovery.interval_seconds || 86400) / 3600))}"></div>
      <div><label for="include-${source.id}">網址包含詞</label><input id="include-${source.id}" data-setting="includeTerms" value="${esc((recipe.includeTerms || []).join(', '))}" placeholder="beyblade, beyX"></div>
      <div><label for="exclude-${source.id}">網址排除詞</label><input id="exclude-${source.id}" data-setting="excludeTerms" value="${esc((recipe.excludeTerms || []).join(', '))}" placeholder="used, parts"></div>
      <div class="actions" style="align-items:end"><button class="btn secondary" type="button" data-save-discovery="${source.site_id}">儲存探索設定</button></div>
    </div></details>` : '';
    return `<article class="source-card"><div><h3>${esc(source.name)} <span class="pill ${source.enabled ? 'good' : discovery && !hasMonitorPages ? 'warn' : ''}">${source.enabled ? '已啟用' : discovery && !hasMonitorPages ? '探索來源' : '已停用'}</span></h3>
    <div class="meta"><span>${esc(source.registrable_domain || source.url || '未指定網域')}</span><span>${esc(source.connector)} v${esc(source.connector_version)}</span><span>${source.seed_count} 個監控網址</span><span>${source.offer_count} 個 Offer</span><span>${source.managed_by === 'ui' ? '由介面管理' : '內建來源'}</span>${source.site_id ? `<span>${esc(discoverySites.get(Number(source.site_id))?.pending_candidates || 0)} 個待審核</span>` : ''}</div>
    ${source.last_error ? `<p class="status error">${esc(source.last_error)}</p>` : ''}${discovery?.recipe_error ? `<p class="status error">Recipe：${esc(discovery.recipe_error)}</p>` : ''}${settingPanel}</div><div class="actions">
    ${source.site_id ? `<button class="btn secondary" type="button" data-discovery-site="${source.site_id}">探索商品</button>` : ''}
    ${hasMonitorPages ? `<button class="btn secondary" type="button" data-source-action="test" data-source-id="${source.id}">測試連線</button>
    <button class="btn ${source.enabled ? 'danger' : 'secondary'}" type="button" data-source-action="${source.enabled ? 'disable' : 'enable'}" data-source-id="${source.id}">${source.enabled ? '停用並保留歷史' : '重新啟用'}</button>` : ''}</div></article>`;
  }).join('');
  const body = `<div class="section-head"><div><p class="eyebrow">來源管理</p><h1>加入商店網址</h1><p>商品頁可直接加入監控；首頁或分類頁會先受控探索，再由你核准候選。</p></div></div><div class="grid two-col"><section class="card"><h2>貼上網址</h2>
    <form id="add-source-form" class="inline-form"><div><label for="source-url">商店或商品頁網址</label><input id="source-url" name="url" type="url" inputmode="url" autocomplete="url" required placeholder="https://store.example/product"><p class="hint">只允許公開 HTTP(S) 網址，不會連線到本機或內部網路。</p></div><button class="btn" type="submit">先預覽</button></form>
    <p id="source-status" class="status" role="status" aria-live="polite"></p><div id="source-preview" class="preview" hidden></div></section>
    <aside class="card"><h2>加入流程</h2><ol><li>辨識並標準化商店網域。</li><li>先安全預覽你貼上的一頁。</li><li>探索遵守 robots、同網域與資源預算。</li><li>候選進入審核佇列，核准後才監控。</li></ol><div class="notice">預設每站最多 100 頁、深度 2、5 分鐘與 50 MB；網站拒絕時立即停止。</div></aside></div>
    <section id="source-list" style="margin-top:1.5rem"><div class="section-head"><div><h2>目前來源</h2><p>停用來源會保留商品、事件與價格歷史。</p></div></div><p id="source-action-status" class="status" role="status" aria-live="polite"></p><div class="source-list">${cards || '<div class="card muted">目前沒有來源。</div>'}</div></section>`;
  return layout(pageOptions(db, {
    ...base, title: '來源管理', current: '/sources', body, extraScript: sourcesScript(),
  }));
}

function reviewPage(db, base, status = 'pending') {
  const candidates = listCandidates(db, { status });
  const rows = candidates.map((candidate) => [
    `<input name="candidate" type="checkbox" value="${candidate.id}" aria-label="選擇 ${esc(candidate.title)}">`,
    `<strong>${esc(candidate.title)}</strong>${candidate.model ? `<br><span class="muted">${esc(candidate.model)}</span>` : ''}`,
    `${esc(candidate.site_name)}<br><span class="muted">${esc(candidate.discovery_method)}</span>`,
    `${Math.round(Number(candidate.confidence) * 100)}%<br><span class="muted">${candidate.reasons.map(esc).join('、') || '未提供原因'}</span>`,
    candidate.price == null ? '—' : esc(`${candidate.price} ${candidate.currency || ''}`),
    `<a href="${esc(candidate.canonical_url)}" target="_blank" rel="noopener noreferrer">查看原頁</a>`,
    `<div class="actions"><button class="btn" type="button" data-single-review="approve" data-candidate-id="${candidate.id}">核准</button><button class="btn secondary" type="button" data-single-review="defer" data-candidate-id="${candidate.id}">稍後</button><button class="btn danger" type="button" data-single-review="exclude" data-candidate-id="${candidate.id}">排除</button></div>`,
  ]);
  const body = `<div class="section-head"><div><p class="eyebrow">人工確認</p><h1>候選商品審核</h1><p>自動探索只提出候選；只有核准後才建立 Product／Offer 並加入持續監控。</p></div><a class="btn secondary" href="/sources">回來源管理</a></div>
    <div class="actions" style="justify-content:flex-start;margin-bottom:1rem"><a href="/review?status=pending">待審核</a><a href="/review?status=deferred">稍後處理</a><a href="/review?status=approved">已核准</a><a href="/review?status=excluded">已排除</a></div>
    <section class="card"><div class="actions" style="justify-content:flex-start;margin-bottom:1rem"><label style="margin:0"><input id="select-all" type="checkbox" style="width:auto"> 全選</label><button class="btn" type="button" data-review-action="approve">批次核准</button><button class="btn secondary" type="button" data-review-action="defer">稍後處理</button><button class="btn danger" type="button" data-review-action="exclude">批次排除</button></div><p id="review-status" class="status" role="status" aria-live="polite"></p>${table(
      ['選取', '商品', '商店／來源', '信心與原因', '價格', '原始頁面', '操作'], rows
    )}</section>`;
  return layout(pageOptions(db, {
    ...base, title: '候選審核', current: '/review', body, extraScript: reviewQueueScript(),
  }));
}

function response(body, type = 'text/html; charset=utf-8', status = 200) {
  return { status, type, body };
}
function json(value, status = 200) {
  return response(JSON.stringify(value, null, 2), 'application/json; charset=utf-8', status);
}

async function readJson(req, limit = 32768) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error('要求內容過大。');
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('要求內容不是有效的 JSON。'); }
}

function isMutation(method) { return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method); }
function validateLocalRequest(req, csrfToken) {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('只接受本機要求。');
  if (!isMutation(req.method)) return;
  const origin = req.headers.origin;
  if (origin) {
    const originHost = new URL(origin).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(originHost)) throw new Error('拒絕外部網站送出的操作。');
  }
  if (req.headers['x-csrf-token'] !== csrfToken) throw new Error('安全驗證已過期，請重新整理頁面。');
}

export function createWebServer(db, options = {}) {
  const csrfToken = randomBytes(24).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const base = { csrfToken, nonce };
  const appConfig = options.appConfig || {};
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      validateLocalRequest(req, csrfToken);
      let out;
      if (req.method === 'GET' && url.pathname === '/') out = response(overviewPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/products') out = response(productsPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/offers') out = response(offersPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/events') out = response(eventsPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/review') out = response(reviewPage(db, base, url.searchParams.get('status') || 'pending'));
      else if (req.method === 'GET' && url.pathname === '/sources') out = response(sourcesPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/health') out = json(healthData(db));
      else if (req.method === 'GET' && url.pathname === '/api/sources') out = json({ sources: listManagedSources(db) });
      else if (req.method === 'GET' && url.pathname === '/api/settings') out = json(readSettings(db));
      else if (req.method === 'GET' && url.pathname === '/api/candidates') out = json({ candidates: listCandidates(db, { status: url.searchParams.get('status') || 'pending' }) });
      else if (req.method === 'POST' && url.pathname === '/api/settings') {
        out = json({ settings: saveOnboardingSettings(db, await readJson(req)) });
      } else if (req.method === 'POST' && url.pathname === '/api/sources/preview') {
        const body = await readJson(req);
        out = json(await previewSourceUrl(db, body.url, {
          timeoutMs: appConfig.http?.timeoutMs,
          userAgent: appConfig.http?.userAgent,
        }));
      } else if (req.method === 'POST' && url.pathname === '/api/sources') {
        const body = await readJson(req);
        const previewUrl = new URL(body.url);
        await assertPublicUrl(previewUrl);
        const result = confirmSource(db, body);
        const message = result.discoveryOnly
          ? '探索入口已加入；可立即按「探索商品」，之後預設每 24 小時執行一次。'
          : result.sourceCreated ? '商店已加入，將在下一輪開始監控。'
            : result.seedCreated ? '已把這一頁加入既有商店。' : '這個網址已經在商店中。';
        out = json({ ...result, message }, 201);
      } else {
        const discoveryMatch = url.pathname.match(/^\/api\/sites\/(\d+)\/discover$/);
        const discoverySettingsMatch = url.pathname.match(/^\/api\/sites\/(\d+)\/discovery-settings$/);
        const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/review$/);
        if (discoveryMatch && req.method === 'POST') {
          const body = await readJson(req);
          const run = await runSiteDiscovery(db, Number(discoveryMatch[1]), {
            budget: body.budget || {}, userAgent: appConfig.http?.userAgent,
            ...(options.discoveryDeps || {}),
          });
          out = json({ run });
        } else if (discoverySettingsMatch && req.method === 'PATCH') {
          const body = await readJson(req);
          out = json(updateDiscoveryConfiguration(db, Number(discoverySettingsMatch[1]), body));
        } else if (candidateMatch && req.method === 'POST') {
          const body = await readJson(req);
          const candidate = reviewCandidate(db, Number(candidateMatch[1]), body.action, {
            note: body.note, preorderIsPurchasable: appConfig.preorderIsPurchasable,
            eventCooldownSeconds: appConfig.eventCooldownSeconds,
            priceChangeThreshold: appConfig.priceChangeThreshold,
          });
          out = json({ candidate });
        } else if (url.pathname === '/api/candidates/review' && req.method === 'POST') {
          const body = await readJson(req);
          const candidates = reviewCandidates(db, body.ids, body.action, {
            note: body.note, preorderIsPurchasable: appConfig.preorderIsPurchasable,
            eventCooldownSeconds: appConfig.eventCooldownSeconds,
            priceChangeThreshold: appConfig.priceChangeThreshold,
          });
          out = json({ candidates });
        } else {
          const match = url.pathname.match(/^\/api\/sources\/(\d+)(?:\/(test))?$/);
          if (match && req.method === 'POST' && match[2] === 'test') {
          out = json(await testManagedSource(db, Number(match[1]), {
            httpDeps: {
              http: appConfig.http || {},
              debug: { saveHtml: false, dir: appConfig.debugDir },
            },
          }));
          } else if (match && ['PATCH', 'DELETE'].includes(req.method)) {
          const body = req.method === 'PATCH' ? await readJson(req) : { enabled: false };
          const enabled = req.method === 'PATCH' ? body.enabled === true : false;
          setSourceEnabled(db, Number(match[1]), enabled);
          out = json({ message: enabled ? '來源已重新啟用。' : '來源已停用，歷史資料完整保留。' });
          } else out = response('找不到頁面。', 'text/plain; charset=utf-8', 404);
        }
      }
      res.writeHead(out.status, {
        'Content-Type': out.type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'`,
      });
      res.end(out.body);
    } catch (err) {
      logger.warn(`web request failed: ${err.message}`);
      const status = /找不到/.test(err.message) ? 404 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
  });
}

export function startWebServer(db, { port = 8787, host = '127.0.0.1', ...options } = {}) {
  const server = createWebServer(db, options);
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      logger.info(`web app on http://${host}:${port}  (health: /health)`);
      resolve(server);
    });
  });
}
