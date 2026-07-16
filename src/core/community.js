import { createHash } from 'node:crypto';
import { detectTextLocale, extractModel, normalizeAlias, normalizeWhitespace } from './normalize.js';
import { canonicalizeSeedUrl } from './site.js';

const now = () => new Date().toISOString();
export const BEY_SOKUHOU_PROFILE = 'https://x.com/bey_sokuhou';
export const X_POST_READ_USD = 0.005;

function parseJson(value, fallback = []) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function termList(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(input.map((item) => normalizeWhitespace(item)).filter(Boolean))].slice(0, 30);
}

export function registerDefaultCommunitySources(db) {
  const ts = now();
  db.run(
    `INSERT INTO community_sources
      (key,name,platform,source_class,author_handle,profile_url,acquisition_method,access_state,
       enabled,muted,api_cost_per_post_usd,monthly_budget_usd,poll_interval_seconds,retention_days,
       metadata_json,created_at,updated_at)
     VALUES ('x-bey-sokuhou','ベイブレード入荷予約速報','x','social','@bey_sokuhou',?,
       'x_api','user_setup_required',0,0,?,0,900,90,?,?,?)
     ON CONFLICT(key) DO UPDATE SET
       access_state='user_setup_required',enabled=0,monthly_budget_usd=0,
       api_cost_per_post_usd=excluded.api_cost_per_post_usd,
       metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`,
    [BEY_SOKUHOU_PROFILE, X_POST_READ_USD, JSON.stringify({
      purpose: 'non_official_community_leads',
      disclaimer: 'Posts are unverified leads and never change official or store-stock state.',
      pricingCheckedAt: '2026-07-16',
      pricingUrl: 'https://docs.x.com/x-api/getting-started/pricing',
      developerConsoleUrl: 'https://console.x.com',
      fundingModel: 'user_owned_developer_project',
      requiresCostConsent: true,
      autoRechargeRecommended: false,
    }), ts, ts]
  );
  return db.get("SELECT * FROM community_sources WHERE key='x-bey-sokuhou'");
}

export function getCommunitySource(db, idOrKey) {
  const row = typeof idOrKey === 'number'
    ? db.get('SELECT * FROM community_sources WHERE id=?', [idOrKey])
    : db.get('SELECT * FROM community_sources WHERE key=?', [idOrKey]);
  if (!row) return null;
  return { ...row, excludeTerms: parseJson(row.exclude_terms_json), metadata: parseJson(row.metadata_json, {}) };
}

export function listCommunitySources(db) {
  return db.all(`SELECT cs.*,
    (SELECT COUNT(*) FROM community_posts cp WHERE cp.community_source_id=cs.id) post_count,
    (SELECT COUNT(*) FROM community_posts cp WHERE cp.community_source_id=cs.id AND cp.hidden=1) hidden_count
    FROM community_sources cs ORDER BY cs.id`).map((row) => ({
      ...row, excludeTerms: parseJson(row.exclude_terms_json), metadata: parseJson(row.metadata_json, {}),
    }));
}

export function updateCommunitySource(db, id, payload = {}) {
  const source = getCommunitySource(db, Number(id));
  if (!source) throw new Error('找不到社群來源。');
  const muted = payload.muted === undefined ? source.muted : (payload.muted ? 1 : 0);
  const filterSensitive = payload.filterSensitive === undefined
    ? source.filter_sensitive : (payload.filterSensitive ? 1 : 0);
  const filterSpam = payload.filterSpam === undefined
    ? source.filter_spam : (payload.filterSpam ? 1 : 0);
  const retentionDays = Math.min(365, Math.max(7, Number(payload.retentionDays || source.retention_days || 90)));
  const excludeTerms = payload.excludeTerms === undefined ? source.excludeTerms : termList(payload.excludeTerms);
  db.run(`UPDATE community_sources SET muted=?,filter_sensitive=?,filter_spam=?,retention_days=?,
    exclude_terms_json=?,updated_at=? WHERE id=?`,
  [muted, filterSensitive, filterSpam, retentionDays, JSON.stringify(excludeTerms), now(), id]);
  return getCommunitySource(db, Number(id));
}

function postIdentity(item) {
  const externalId = String(item.id || item.external_id || '').trim();
  const inputUrl = item.url || (externalId ? `${BEY_SOKUHOU_PROFILE}/status/${externalId}` : '');
  if (!externalId || !inputUrl) throw new Error('社群貼文必須包含文章 ID 與原始連結。');
  const canonicalUrl = canonicalizeSeedUrl(inputUrl);
  if (!/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(canonicalUrl)) {
    throw new Error('社群貼文原始連結必須來自 X。');
  }
  return { externalId, canonicalUrl };
}

function contentFingerprint(text) {
  const normalized = normalizeAlias(String(text || '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/^(?:rt|repost)\s+@?[^:：]+[:：]\s*/iu, '')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' '));
  return createHash('sha256').update(normalized).digest('hex');
}

function extractLinks(text) {
  return [...new Set((String(text || '').match(/https?:\/\/[^\s<>"']+/giu) || []).map((url) => {
    try { return canonicalizeSeedUrl(url.replace(/[),.!?。、，]+$/u, '')); } catch { return null; }
  }).filter(Boolean))];
}

function detectModels(text) {
  const direct = String(text || '').match(/\b(?:BX|UX|CX)[\s_-]?\d{1,3}\b/giu) || [];
  return [...new Set(direct.map((value) => extractModel(value)).filter(Boolean))];
}

function classifyLeads(text, links) {
  const value = normalizeAlias(text);
  const types = [];
  const rules = [
    ['new_product', ['新商品', '新品', 'new product', '発売予定']],
    ['lottery', ['抽選', 'lottery']],
    ['preorder', ['予約', 'pre-order', 'preorder']],
    ['restock', ['再入荷', '入荷', 'restock']],
  ];
  for (const [type, terms] of rules) {
    if (terms.some((term) => value.includes(normalizeAlias(term)))) types.push(type);
  }
  if (links.length) types.push('store_link');
  return [...new Set(types)];
}

function spamScore(text, links) {
  const input = String(text || '');
  let score = 0;
  if ((input.match(/#/g) || []).length >= 8) score += 0.35;
  if (links.length >= 5) score += 0.35;
  if (/(.)\1{9,}/u.test(input)) score += 0.35;
  if (input.length < 8) score += 0.25;
  return Math.min(1, score);
}

function matchCommunityWatchlists(db, post) {
  const haystack = normalizeAlias(`${post.content_text} ${post.detectedModels.join(' ')}`);
  const matches = [];
  for (const watchlist of db.all('SELECT * FROM watchlists WHERE enabled=1 ORDER BY id')) {
    if (watchlist.locale !== 'any' && watchlist.locale !== post.locale) continue;
    const excludes = parseJson(watchlist.exclude_terms_json).map(normalizeAlias);
    if (excludes.some((term) => term && haystack.includes(term))) continue;
    const reasons = [];
    const expected = normalizeAlias(watchlist.product_code || watchlist.model);
    if (expected && post.detectedModels.map(normalizeAlias).includes(expected)) reasons.push('model_exact');
    const keywords = parseJson(watchlist.keywords_json);
    if (keywords.length) {
      let hit = false;
      if (watchlist.match_mode === 'regex') {
        hit = keywords.some((term) => { try { return new RegExp(term, 'iu').test(post.content_text); } catch { return false; } });
      } else if (watchlist.match_mode === 'contains') {
        hit = keywords.some((term) => haystack.includes(normalizeAlias(term)));
      } else {
        const words = post.content_text.split(/[\s、，。,:：/]+/u).map(normalizeAlias);
        hit = keywords.some((term) => words.includes(normalizeAlias(term)));
      }
      if (hit) reasons.push(`keyword_${watchlist.match_mode}`);
    }
    if (!reasons.length) continue;
    const confidence = reasons.includes('model_exact') ? 0.95 : 0.8;
    db.run(`INSERT OR IGNORE INTO community_post_matches
      (community_post_id,watchlist_id,confidence,reasons_json,created_at) VALUES (?,?,?,?,?)`,
    [post.id, watchlist.id, confidence, JSON.stringify(reasons), now()]);
    matches.push({ watchlistId: watchlist.id, confidence, reasons });
  }
  return matches;
}

export function importCommunityPost(db, sourceKey, item = {}, { acquisitionMethod = 'fixture' } = {}) {
  const source = getCommunitySource(db, sourceKey);
  if (!source) throw new Error(`找不到社群來源：${sourceKey}`);
  if (!['fixture', 'x_api', 'rss', 'public_api'].includes(acquisitionMethod)) {
    throw new Error('不允許的社群資料取得方式；公開 HTML 必須先完成服務條款審核。');
  }
  const { externalId, canonicalUrl } = postIdentity(item);
  const text = normalizeWhitespace(item.text || item.content_text);
  if (!text) throw new Error('社群貼文內容不可為空白。');
  const existingIdentity = db.get(
    'SELECT * FROM community_posts WHERE community_source_id=? AND external_id=? OR canonical_url=?',
    [source.id, externalId, canonicalUrl]
  );
  if (existingIdentity) return { post: hydratePost(db, existingIdentity), created: false, duplicate: true };
  const fingerprint = contentFingerprint(text);
  const existingContent = db.get('SELECT * FROM community_posts WHERE content_fingerprint=? ORDER BY id LIMIT 1', [fingerprint]);
  if (existingContent) {
    db.run(`INSERT OR IGNORE INTO community_post_origins
      (community_post_id,community_source_id,external_id,canonical_url,author_handle,acquired_at)
      VALUES (?,?,?,?,?,?)`, [existingContent.id, source.id, externalId, canonicalUrl,
      item.author || source.author_handle, now()]);
    db.run('UPDATE community_posts SET duplicate_count=duplicate_count+1,updated_at=? WHERE id=?', [now(), existingContent.id]);
    return { post: hydratePost(db, db.get('SELECT * FROM community_posts WHERE id=?', [existingContent.id])), created: false, duplicate: true };
  }
  const links = extractLinks(text);
  const models = detectModels(text);
  const leads = classifyLeads(text, links);
  const locale = item.lang || detectTextLocale(text) || 'und';
  const sourceExcludes = source.excludeTerms.map(normalizeAlias);
  const excluded = sourceExcludes.some((term) => term && normalizeAlias(text).includes(term));
  const sensitive = item.sensitive ? 1 : 0;
  const score = spamScore(text, links);
  const hidden = source.muted || excluded || (source.filter_sensitive && sensitive) || (source.filter_spam && score >= 0.7) ? 1 : 0;
  const fetchedAt = item.fetched_at || now();
  const expiresAt = new Date(new Date(fetchedAt).getTime() + Number(source.retention_days) * 86400000).toISOString();
  const info = db.run(`INSERT INTO community_posts
    (community_source_id,external_id,canonical_url,author_handle,content_text,locale,published_at,
     fetched_at,acquisition_method,content_fingerprint,credibility,lead_types_json,
     detected_models_json,summary,summary_kind,sensitive,spam_score,hidden,raw_json,expires_at,
     created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'unverified',?,?,?,?,?,?,?,?,?,?,?)`,
  [source.id, externalId, canonicalUrl, item.author || source.author_handle, text, locale,
    item.created_at || item.published_at || null, fetchedAt, acquisitionMethod, fingerprint,
    JSON.stringify(leads), JSON.stringify(models), item.summary || null,
    item.summary ? (item.summary_kind || 'machine') : null, sensitive, score, hidden,
    JSON.stringify({ id: externalId, repost: Boolean(item.repost) }), expiresAt, fetchedAt, fetchedAt]);
  const postId = Number(info.lastInsertRowid);
  db.run(`INSERT INTO community_post_origins
    (community_post_id,community_source_id,external_id,canonical_url,author_handle,acquired_at)
    VALUES (?,?,?,?,?,?)`, [postId, source.id, externalId, canonicalUrl, item.author || source.author_handle, fetchedAt]);
  for (const link of links) {
    db.run('INSERT OR IGNORE INTO community_post_links (community_post_id,canonical_url,link_kind) VALUES (?,?,?)',
      [postId, link, /(?:shop|store|mall)/iu.test(link) ? 'store' : 'external']);
  }
  const post = hydratePost(db, db.get('SELECT * FROM community_posts WHERE id=?', [postId]));
  const matches = matchCommunityWatchlists(db, post);
  return { post: { ...post, matches }, created: true, duplicate: false };
}

function hydratePost(db, row) {
  return {
    ...row,
    leadTypes: parseJson(row.lead_types_json),
    detectedModels: parseJson(row.detected_models_json),
    links: db.all('SELECT canonical_url,link_kind FROM community_post_links WHERE community_post_id=?', [row.id]),
    origins: db.all('SELECT * FROM community_post_origins WHERE community_post_id=? ORDER BY id', [row.id]),
    matches: db.all(`SELECT m.*,w.name watchlist_name FROM community_post_matches m
      JOIN watchlists w ON w.id=m.watchlist_id WHERE m.community_post_id=?`, [row.id]),
  };
}

export function listCommunityPosts(db, { includeHidden = false, limit = 100 } = {}) {
  const rows = db.all(`SELECT cp.*,cs.name source_name,cs.author_handle source_handle,cs.muted source_muted
    FROM community_posts cp JOIN community_sources cs ON cs.id=cp.community_source_id
    ${includeHidden ? '' : 'WHERE cp.hidden=0 AND cs.muted=0'}
    ORDER BY COALESCE(cp.published_at,cp.fetched_at) DESC,cp.id DESC LIMIT ?`,
  [Math.min(500, Math.max(1, Number(limit) || 100))]);
  return rows.map((row) => hydratePost(db, row));
}

export function importCommunityItems(db, sourceKey, items, options = {}) {
  const source = getCommunitySource(db, sourceKey);
  if (!source) throw new Error(`找不到社群來源：${sourceKey}`);
  const started = now();
  const runId = Number(db.run(`INSERT INTO community_source_runs
    (community_source_id,acquisition_method,status,started_at) VALUES (?,?,'running',?)`,
  [source.id, options.acquisitionMethod || 'fixture', started]).lastInsertRowid);
  let created = 0;
  try {
    const results = items.map((item) => {
      const result = importCommunityPost(db, sourceKey, item, options);
      if (result.created) created += 1;
      return result;
    });
    db.run(`UPDATE community_source_runs SET status='success',items_seen=?,items_created=?,finished_at=? WHERE id=?`,
      [items.length, created, now(), runId]);
    db.run('UPDATE community_sources SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=?',
      [now(), now(), source.id]);
    return { runId, seen: items.length, created, results };
  } catch (error) {
    db.run(`UPDATE community_source_runs SET status='failed',error=?,finished_at=? WHERE id=?`,
      [error.message, now(), runId]);
    db.run('UPDATE community_sources SET last_failure_at=?,last_error=?,updated_at=? WHERE id=?',
      [now(), error.message, now(), source.id]);
    throw error;
  }
}

export function markCommunitySourceUnavailable(db, id, message = 'X API 尚未設定或未取得費用同意。') {
  const result = db.run(`UPDATE community_sources SET enabled=0,access_state='unavailable',
    last_failure_at=?,last_error=?,updated_at=? WHERE id=?`, [now(), message, now(), id]);
  if (!result.changes) throw new Error('找不到社群來源。');
  return getCommunitySource(db, Number(id));
}

export function pruneExpiredCommunityPosts(db, { at = now() } = {}) {
  return Number(db.run('DELETE FROM community_posts WHERE expires_at IS NOT NULL AND expires_at < ?', [at]).changes);
}
