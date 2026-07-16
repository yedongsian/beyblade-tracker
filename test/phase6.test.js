import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Database } from '../src/db/database.js';
import { createWatchlist } from '../src/core/watchlist.js';
import {
  importCommunityItems, importCommunityPost, listCommunityPosts, markCommunitySourceUnavailable,
  pruneExpiredCommunityPosts, registerDefaultCommunitySources, updateCommunitySource,
} from '../src/core/community.js';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/community/bey-sokuhou-posts.json', import.meta.url), 'utf8'
));

function setup() {
  const db = new Database(':memory:');
  const source = registerDefaultCommunitySources(db);
  return { db, source };
}

test('Phase 6 default social source is registered with zero budget and no network access', () => {
  const { db, source } = setup();
  assert.equal(source.author_handle, '@bey_sokuhou');
  assert.equal(source.acquisition_method, 'x_api');
  assert.equal(source.access_state, 'user_setup_required');
  assert.equal(source.enabled, 0);
  assert.equal(source.monthly_budget_usd, 0);
  assert.equal(source.api_cost_per_post_usd, 0.005);
  db.close();
});

test('startup keeps X paused and zero-budget even if a stale row was previously enabled', () => {
  const { db, source } = setup();
  db.run("UPDATE community_sources SET enabled=1,monthly_budget_usd=99,access_state='ready' WHERE id=?", [source.id]);
  const reset = registerDefaultCommunitySources(db);
  assert.equal(reset.enabled, 0);
  assert.equal(reset.monthly_budget_usd, 0);
  assert.equal(reset.access_state, 'user_setup_required');
  assert.equal(JSON.parse(reset.metadata_json).fundingModel, 'user_owned_developer_project');
  db.close();
});

test('community fixture classifies language, models, lead types and original links without stock facts', () => {
  const { db } = setup();
  const result = importCommunityPost(db, 'x-bey-sokuhou', fixture[0], { acquisitionMethod: 'fixture' });
  assert.equal(result.created, true);
  assert.equal(result.post.locale, 'ja');
  assert.deepEqual(result.post.detectedModels, ['CX-99']);
  assert.ok(result.post.leadTypes.includes('new_product'));
  assert.ok(result.post.leadTypes.includes('preorder'));
  assert.ok(result.post.leadTypes.includes('store_link'));
  assert.equal(result.post.credibility, 'unverified');
  assert.equal(result.post.links[0].canonical_url, 'https://shop.example/cx-99');
  assert.equal(db.get('SELECT COUNT(*) c FROM offers').c, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM events').c, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM official_announcements').c, 0);
  db.close();
});

test('article identity and content fingerprints deduplicate repeat reads and merge repost origins', () => {
  const { db } = setup();
  const batch = importCommunityItems(db, 'x-bey-sokuhou', fixture, { acquisitionMethod: 'fixture' });
  assert.equal(batch.seen, 3);
  assert.equal(batch.created, 2);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_posts').c, 2);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_post_origins').c, 3);
  const repeated = importCommunityPost(db, 'x-bey-sokuhou', fixture[0], { acquisitionMethod: 'fixture' });
  assert.equal(repeated.created, false);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_posts').c, 2);
  const restock = listCommunityPosts(db).find((post) => post.detectedModels.includes('UX-20'));
  assert.equal(restock.duplicate_count, 1);
  assert.equal(restock.origins.length, 2);
  db.close();
});

test('community clues match Watchlists but never create Watchlist stock alerts', () => {
  const { db } = setup();
  const watchlist = createWatchlist(db, {
    name: 'CX-99', productCode: 'CX-99', keywords: '予約', matchMode: 'contains',
  });
  const result = importCommunityPost(db, 'x-bey-sokuhou', fixture[0], { acquisitionMethod: 'fixture' });
  assert.equal(result.post.matches.length, 1);
  assert.equal(result.post.matches[0].watchlistId, watchlist.id);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_post_matches').c, 1);
  assert.equal(db.get('SELECT COUNT(*) c FROM watchlist_alerts').c, 0);
  db.close();
});

test('source exclusions, mute, sensitive filter and spam filter hide unwanted posts', () => {
  const { db, source } = setup();
  updateCommunitySource(db, source.id, { excludeTerms: '交換', retentionDays: 30 });
  const excluded = importCommunityPost(db, 'x-bey-sokuhou', {
    id: '301', url: 'https://x.com/bey_sokuhou/status/301', text: 'BX-38 交換 募集中',
  }, { acquisitionMethod: 'fixture' });
  const sensitive = importCommunityPost(db, 'x-bey-sokuhou', {
    id: '302', url: 'https://x.com/bey_sokuhou/status/302', text: 'CX-10 新商品情報です', sensitive: true,
  }, { acquisitionMethod: 'fixture' });
  const spam = importCommunityPost(db, 'x-bey-sokuhou', {
    id: '303', url: 'https://x.com/bey_sokuhou/status/303', text: '#a #b #c #d #e #f #g #h aaaaaaaaaaaa',
  }, { acquisitionMethod: 'fixture' });
  assert.equal(excluded.post.hidden, 1);
  assert.equal(sensitive.post.hidden, 1);
  assert.equal(spam.post.hidden, 1);
  assert.equal(listCommunityPosts(db).length, 0);
  assert.equal(listCommunityPosts(db, { includeHidden: true }).length, 3);
  db.close();
});

test('retention policy deletes expired community content and cascades links and matches', () => {
  const { db } = setup();
  createWatchlist(db, { name: 'CX-99', productCode: 'CX-99' });
  importCommunityPost(db, 'x-bey-sokuhou', {
    ...fixture[0], id: '401', url: 'https://x.com/bey_sokuhou/status/401', fetched_at: '2025-01-01T00:00:00.000Z',
  }, { acquisitionMethod: 'fixture' });
  assert.equal(pruneExpiredCommunityPosts(db, { at: '2026-01-01T00:00:00.000Z' }), 1);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_posts').c, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_post_links').c, 0);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_post_matches').c, 0);
  db.close();
});

test('an unavailable paid platform is isolated from store tracking health and data', () => {
  const { db, source } = setup();
  const unavailable = markCommunitySourceUnavailable(db, source.id, 'X API credits not configured');
  assert.equal(unavailable.access_state, 'unavailable');
  assert.equal(unavailable.enabled, 0);
  assert.match(unavailable.last_error, /credits/);
  assert.equal(db.get('SELECT COUNT(*) c FROM sources').c, 0);
  db.close();
});

test('unreviewed HTML acquisition is rejected instead of bypassing platform controls', () => {
  const { db } = setup();
  assert.throws(() => importCommunityPost(db, 'x-bey-sokuhou', fixture[0], {
    acquisitionMethod: 'html',
  }), /不允許的社群資料取得方式/);
  assert.equal(db.get('SELECT COUNT(*) c FROM community_posts').c, 0);
  db.close();
});
