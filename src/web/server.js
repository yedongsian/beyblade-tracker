import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { logger } from '../util/logger.js';
import {
  confirmSource, listManagedSources, previewSourceUrl, readSettings,
  saveOnboardingSettings, setSourceEnabled, testManagedSource,
} from '../core/source-manager.js';
import { assertPublicUrl } from '../net/public-http.js';
import { esc, layout, sourcesScript, table } from './ui.js';

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
  const cards = rows.map((source) => `<article class="source-card"><div><h3>${esc(source.name)} <span class="pill ${source.enabled ? 'good' : ''}">${source.enabled ? '已啟用' : '已停用'}</span></h3>
    <div class="meta"><span>${esc(source.registrable_domain || source.url || '未指定網域')}</span><span>${esc(source.connector)} v${esc(source.connector_version)}</span><span>${source.seed_count} 個種子</span><span>${source.offer_count} 個 Offer</span><span>${source.managed_by === 'ui' ? '由介面管理' : '內建來源'}</span></div>
    ${source.last_error ? `<p class="status error">${esc(source.last_error)}</p>` : ''}</div><div class="actions">
    <button class="btn secondary" type="button" data-source-action="test" data-source-id="${source.id}">測試連線</button>
    <button class="btn ${source.enabled ? 'danger' : 'secondary'}" type="button" data-source-action="${source.enabled ? 'disable' : 'enable'}" data-source-id="${source.id}">${source.enabled ? '停用並保留歷史' : '重新啟用'}</button></div></article>`).join('');
  const body = `<div class="section-head"><div><p class="eyebrow">來源管理</p><h1>加入商店網址</h1><p>先測試一頁並預覽；確認後才會加入監控。</p></div></div><div class="grid two-col"><section class="card"><h2>貼上網址</h2>
    <form id="add-source-form" class="inline-form"><div><label for="source-url">商店或商品頁網址</label><input id="source-url" name="url" type="url" inputmode="url" autocomplete="url" required placeholder="https://store.example/product"><p class="hint">只允許公開 HTTP(S) 網址，不會連線到本機或內部網路。</p></div><button class="btn" type="submit">先預覽</button></form>
    <p id="source-status" class="status" role="status" aria-live="polite"></p><div id="source-preview" class="preview" hidden></div></section>
    <aside class="card"><h2>加入流程</h2><ol><li>辨識並標準化商店網域。</li><li>只測試你貼上的這一頁。</li><li>顯示候選商品、錯誤與資源上限。</li><li>你確認後才加入排程。</li></ol><div class="notice">相同主網域已存在時，只會加入新的種子網址。</div></aside></div>
    <section id="source-list" style="margin-top:1.5rem"><div class="section-head"><div><h2>目前來源</h2><p>停用來源會保留商品、事件與價格歷史。</p></div></div><p id="source-action-status" class="status" role="status" aria-live="polite"></p><div class="source-list">${cards || '<div class="card muted">目前沒有來源。</div>'}</div></section>`;
  return layout(pageOptions(db, {
    ...base, title: '來源管理', current: '/sources', body, extraScript: sourcesScript(),
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
      else if (req.method === 'GET' && url.pathname === '/sources') out = response(sourcesPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/health') out = json(healthData(db));
      else if (req.method === 'GET' && url.pathname === '/api/sources') out = json({ sources: listManagedSources(db) });
      else if (req.method === 'GET' && url.pathname === '/api/settings') out = json(readSettings(db));
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
        out = json({ ...result, message: result.sourceCreated ? '商店已加入，將在下一輪開始監控。' : result.seedCreated ? '已把這一頁加入既有商店。' : '這個網址已經在商店中。' }, 201);
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
