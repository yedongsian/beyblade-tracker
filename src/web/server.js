import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { logger } from '../util/logger.js';
import {
  confirmSource, listManagedSources, previewSourceUrl, readSettings,
  saveLanguageSetting, saveOnboardingSettings, savePrivacySettings, setSourceEnabled, testManagedSource,
} from '../core/source-manager.js';
import {
  listDiscoverySites, runSiteDiscovery, updateDiscoveryConfiguration,
} from '../core/discovery.js';
import { listCandidates, reviewCandidate, reviewCandidates } from '../core/review-queue.js';
import { assertPublicUrl } from '../net/public-http.js';
import {
  catalogScript, communityScript, esc, exclusionScript, identityScript, layout,
  reviewQueueScript, settingsScript, sourcesScript, table, watchlistScript,
} from './ui.js';
import { createTranslator } from '../i18n.js';
import {
  listCatalogProducts, listTerminologyReviews, reviewTerminology,
} from '../core/catalog.js';
import { refreshOfferFreshness, requestImmediateMonitor } from '../core/monitor.js';
import {
  createWatchlist, deleteWatchlist, listWatchlistAlerts, listWatchlists, setWatchlistEnabled,
  WATCHLIST_EVENT_TYPES,
} from '../core/watchlist.js';
import {
  confirmOfficialPreview, listOfficialAnnouncements, listOfficialSources,
} from '../core/official.js';
import {
  listCommunityPosts, listCommunitySources, updateCommunitySource,
} from '../core/community.js';
import { mergeProducts, splitProduct } from '../core/identity-review.js';
import { listExclusions, reviewExclusion } from '../core/exclusion-review.js';
import { assertNetworkEnabled, getNetworkState, setNetworkEnabled } from '../core/network-control.js';
import { TelegramNotifier } from '../notify/telegram.js';
import { createTransferBundle, stageTransferImport } from '../maintenance/transfer.js';
import {
  checkForUpdate, deferUpdate, getUpdateState, launchPreparedUpdate,
  prepareConfirmedUpdate, recordUpdateCheck, UpdateError, validateUpdateConfirmation,
} from '../release/update.js';
import { releaseInfo } from '../release/version.js';
import { createDiagnosticsBundle } from '../maintenance/diagnostics.js';
import { errorEnvelope } from '../errors/registry.js';

function stateBadge(state, t) {
  const kind = ['in_stock'].includes(state) ? 'good' :
    ['out_of_stock'].includes(state) ? 'bad' : 'warn';
  return `<span class="pill ${kind}">${esc(t(`state.${state}`))}</span>`;
}

function currentOfferBadge(offer, t) {
  if (offer.archived_at || offer.freshness_status === 'archived') {
    return `<span class="pill bad">${esc(t('freshness.archived'))}</span>`;
  }
  if (offer.freshness_status !== 'fresh' && ['in_stock', 'preorder'].includes(offer.availability)) {
    return `<span class="pill warn">${esc(t(`freshness.${offer.freshness_status || 'unknown'}`))}</span>`;
  }
  return stateBadge(offer.availability, t);
}

export function healthData(db, config = {}) {
  refreshOfferFreshness(db);
  const sources = db.all(`SELECT s.*,ms.next_run_at AS monitor_next_run_at,
    ms.consecutive_failures AS monitor_failures FROM sources s
    LEFT JOIN source_monitor_settings ms ON ms.source_id=s.id`);
  const unhealthy = sources.filter((source) => source.enabled && source.consecutive_failures >= 3);
  const counts = {
    sources: sources.length,
    enabledSources: sources.filter((source) => source.enabled).length,
    products: db.get('SELECT COUNT(*) c FROM products').c,
    offers: db.get('SELECT COUNT(*) c FROM offers').c,
    purchasableOffers: db.get(`SELECT COUNT(*) c FROM offers o
      JOIN sources s ON s.id=o.source_id WHERE o.purchasable=1 AND s.enabled=1
      AND o.freshness_status='fresh' AND o.archived_at IS NULL`).c,
    events: db.get('SELECT COUNT(*) c FROM events').c,
    pendingNotifications: db.get('SELECT COUNT(*) c FROM events WHERE notified=0').c,
    pendingCandidates: db.get("SELECT COUNT(*) c FROM product_candidates WHERE status='pending'").c,
    watchlists: db.get('SELECT COUNT(*) c FROM watchlists WHERE enabled=1').c,
    officialAnnouncements: db.get('SELECT COUNT(*) c FROM official_announcements').c,
    communitySources: db.get('SELECT COUNT(*) c FROM community_sources').c,
    communityPosts: db.get('SELECT COUNT(*) c FROM community_posts').c,
    communitySourcesNeedingSetup: db.get("SELECT COUNT(*) c FROM community_sources WHERE access_state!='ready'").c,
  };
  return {
    status: unhealthy.length ? 'degraded' : 'ok',
    network: getNetworkState(db, config),
    release: releaseInfo(config),
    browser: config.browser || null,
    time: new Date().toISOString(), counts,
    sources: sources.map((source) => ({
      key: source.key, name: source.name, enabled: Boolean(source.enabled),
      healthy: source.consecutive_failures < 3,
      lastSuccessAt: source.last_success_at, lastFailureAt: source.last_failure_at,
      consecutiveFailures: source.consecutive_failures, lastError: source.last_error,
      nextMonitorAt: source.monitor_next_run_at,
      monitorFailures: source.monitor_failures || 0,
    })),
  };
}

function pageOptions(db, base) {
  const settings = readSettings(db);
  const t = createTranslator(settings.language || 'zh-TW');
  return { ...base, onboarding: !settings.onboardingCompleted, language: t.locale, t };
}

function overviewPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const health = healthData(db, base.appConfig);
  const counts = health.counts;
  const body = `<section class="hero"><p class="eyebrow">${esc(t('overview.eyebrow'))}</p><h1>${esc(t('overview.title'))}</h1><p>${esc(t('overview.intro'))}</p><p><a class="btn" href="/sources">${esc(t('overview.manage'))}</a></p></section>
  <section class="grid stats" aria-label="${esc(t('overview.summary'))}">
    <article class="card stat"><strong>${counts.enabledSources}</strong><span>${esc(t('overview.enabled'))}</span></article>
    <article class="card stat"><strong>${counts.products}</strong><span>${esc(t('overview.products'))}</span></article>
    <article class="card stat"><strong>${counts.offers}</strong><span>${esc(t('overview.offers'))}</span></article>
    <article class="card stat"><strong>${counts.purchasableOffers}</strong><span>${esc(t('overview.buyable'))}</span></article>
  </section><section class="card"><div class="section-head"><div><h2>${esc(t('overview.health'))}</h2><p>${esc(t('overview.healthHint'))}</p></div><span class="pill ${health.status === 'ok' ? 'good' : 'bad'}">${esc(t(health.status === 'ok' ? 'overview.ok' : 'overview.attention'))}</span></div>
  ${table([t('table.source'), t('table.enabled'), t('table.lastSuccess'), t('table.failures')], health.sources.map((source) => [
    esc(source.name), esc(t(source.enabled ? 'common.yes' : 'common.no')), esc(source.lastSuccessAt || t('common.never')), esc(source.consecutiveFailures),
  ]), t)}</section>`;
  return layout({ ...page, title: t('nav.overview'), current: '/', body });
}

function productsPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const rows = db.all(`SELECT p.*,c.product_code,c.verification_status,
    (SELECT COUNT(*) FROM offers o WHERE o.product_id=p.id) offers
    FROM products p LEFT JOIN catalog_products c ON c.id=p.catalog_product_id
    ORDER BY p.updated_at DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('products.eyebrow'))}</p><h1>${esc(t('products.title'))}</h1><p>${esc(t('products.intro'))}</p></div></div>${table(
    [t('table.product'), t('table.model'), t('table.brand'), t('table.barcode'), t('table.catalog'), t('table.offer')], rows.map((row) => [
      `<a href="/products/${row.id}">${esc(row.name)}</a>`, esc(row.model || '—'), esc(row.brand || '—'), esc(row.barcode || '—'),
      row.product_code ? `${esc(row.product_code)}<br><span class="muted">${esc(t(`verification.${row.verification_status}`))}</span>` : '—', esc(row.offers),
    ]), t
  )}`;
  return layout({ ...page, title: t('products.title'), current: '/products', body });
}

function productDetailPage(db, base, productId) {
  const page = pageOptions(db, base);
  const { t } = page;
  const product = db.get('SELECT * FROM products WHERE id=?', [productId]);
  if (!product) return null;
  refreshOfferFreshness(db);
  const offers = db.all(`SELECT o.*,s.name sname FROM offers o JOIN sources s ON s.id=o.source_id
    WHERE o.product_id=? ORDER BY o.archived_at IS NOT NULL,o.last_seen_at DESC`, [productId]);
  const observations = db.all(`SELECT ob.*,s.name sname,o.url FROM observations ob
    JOIN offers o ON o.id=ob.offer_id JOIN sources s ON s.id=o.source_id
    WHERE o.product_id=? ORDER BY ob.observed_at DESC LIMIT 300`, [productId]);
  const otherProducts = db.all('SELECT id,name,model FROM products WHERE id<>? ORDER BY name LIMIT 200', [productId]);
  const offerRows = offers.map((row) => [
    `<input name="splitOffer" type="checkbox" value="${row.id}" aria-label="${esc(t('identity.chooseOffer', { store: row.sname }))}">`,
    esc(row.sname), currentOfferBadge(row, t), esc(t(`freshness.${row.freshness_status}`)),
    row.price == null ? '—' : esc(`${row.price} ${row.currency || ''}`),
    esc(row.last_successful_at || t('common.never')),
  ]);
  const timelineRows = observations.map((row) => [
    esc(row.observed_at), esc(row.sname), stateBadge(row.availability, t),
    row.price == null ? '—' : esc(`${row.price} ${row.currency || ''}`),
  ]);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('productDetail.eyebrow'))}</p><h1>${esc(product.name)}</h1><p>${esc([product.model, product.brand, product.release_date].filter(Boolean).join(' · '))}</p></div><a class="btn secondary" href="/products">${esc(t('productDetail.back'))}</a></div>
    <section class="card"><h2>${esc(t('productDetail.offers'))}</h2><form id="split-product-form" data-product-id="${product.id}">${table([t('identity.select'),t('table.store'),t('table.status'),t('table.freshness'),t('table.price'),t('table.lastSuccess')],offerRows,t)}<div class="inline-form" style="margin-top:1rem"><div><label for="split-name">${esc(t('identity.newName'))}</label><input id="split-name" name="name" placeholder="${esc(product.name)}"></div><button class="btn secondary" type="submit">${esc(t('identity.split'))}</button></div></form></section>
    <section class="card" style="margin-top:1rem"><h2>${esc(t('identity.mergeTitle'))}</h2><p class="muted">${esc(t('identity.mergeHint'))}</p><form id="merge-product-form" data-product-id="${product.id}" class="inline-form"><div><label for="merge-target">${esc(t('identity.mergeTarget'))}</label><select id="merge-target" name="targetProductId" required><option value="">${esc(t('identity.chooseTarget'))}</option>${otherProducts.map((item) => `<option value="${item.id}">${esc(item.name)}${item.model ? ` (${esc(item.model)})` : ''}</option>`).join('')}</select></div><button class="btn danger" type="submit"${otherProducts.length ? '' : ' disabled'}>${esc(t('identity.merge'))}</button></form><p id="identity-status" class="status" role="status" aria-live="polite"></p></section>
    <section class="card" style="margin-top:1rem"><h2>${esc(t('productDetail.timeline'))}</h2><p class="muted">${esc(t('productDetail.timelineHint'))}</p>${table([t('table.time'),t('table.store'),t('table.status'),t('table.price')],timelineRows,t)}</section>`;
  return layout({ ...page, title: product.name, current: '/products', body, extraScript: identityScript(t) });
}

function exclusionsPage(db, base, status = 'all') {
  const page = pageOptions(db, base);
  const { t } = page;
  const rows = listExclusions(db, { status }).map((row) => [
    esc(row.last_seen_at), `${esc(row.source_name)}<br><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(row.title || row.url)}</a>`,
    esc(t(`exclusionReason.${row.reason}`)), esc(row.occurrence_count), esc(t(`exclusionStatus.${row.review_status}`)),
    `<div class="actions"><button class="btn secondary" data-exclusion-action="confirm" data-exclusion-id="${row.id}">${esc(t('exclusions.confirm'))}</button><button class="btn" data-exclusion-action="allow" data-exclusion-id="${row.id}">${esc(t('exclusions.allow'))}</button><button class="btn secondary" data-exclusion-action="reopen" data-exclusion-id="${row.id}">${esc(t('exclusions.reopen'))}</button></div>`,
  ]);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('exclusions.eyebrow'))}</p><h1>${esc(t('exclusions.title'))}</h1><p>${esc(t('exclusions.intro'))}</p></div></div><div class="actions" style="justify-content:flex-start;margin-bottom:1rem"><a href="/exclusions?status=all">${esc(t('exclusions.all'))}</a><a href="/exclusions?status=pending">${esc(t('exclusions.pending'))}</a><a href="/exclusions?status=confirmed">${esc(t('exclusions.confirmed'))}</a><a href="/exclusions?status=allowed">${esc(t('exclusions.allowed'))}</a></div><p id="exclusion-status" class="status" role="status" aria-live="polite"></p><section class="card">${table([t('table.time'),t('exclusions.sourceItem'),t('exclusions.reason'),t('exclusions.count'),t('table.status'),t('review.action')],rows,t)}</section>`;
  return layout({ ...page, title: t('exclusions.title'), current: '/exclusions', body, extraScript: exclusionScript(t) });
}

function settingsPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const settings = readSettings(db);
  const secrets = base.secretStore?.status?.() || { provider: 'unavailable', telegram: { configured: false } };
  const release = releaseInfo(base.appConfig);
  const browser = base.appConfig.browser || { available: false, downloadUrl: 'https://www.google.com/chrome/' };
  const updateState = getUpdateState(db);
  const scheduledUpdate = updateState.latestResult?.updateAvailable ? updateState.latestResult : null;
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('settings.eyebrow'))}</p><h1>${esc(t('settings.title'))}</h1><p>${esc(t('settings.intro'))}</p></div></div><p id="settings-status" class="status" role="status" aria-live="polite"></p>
  <div class="grid two-col"><section class="card"><h2>${esc(t('settings.releaseTitle'))}</h2><p>${esc(t('settings.version'))}：${esc(release.version)} · ${esc(release.channel)}</p><p>${esc(t('settings.browser'))}：${esc(browser.available ? browser.name : t('settings.browserMissing'))}</p>${browser.available ? '' : `<p><a href="${esc(browser.downloadUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('settings.downloadChrome'))}</a></p>`}<section id="update-card" class="notice" aria-live="polite" data-scheduled-update="${esc(JSON.stringify(scheduledUpdate))}"><strong>版本更新</strong><p id="update-details">${scheduledUpdate ? `可更新至 ${esc(scheduledUpdate.manifest.version)}。` : release.updateManifestUrl ? '尚未檢查更新。' : '正式更新來源尚未設定。'}</p><progress id="update-progress" max="100" value="0" hidden></progress><p class="hint">${updateState.deferred ? `已選擇稍後更新 ${esc(updateState.deferred.targetVersion)}。` : '檢查不會下載；只有確認後才會下載並安裝。'}</p></section><div class="actions" style="justify-content:flex-start"><button id="update-check" class="btn secondary" type="button"${release.updateManifestUrl ? '' : ' disabled'}>${esc(t('settings.checkUpdate'))}</button><button id="update-defer" class="btn secondary" type="button"${scheduledUpdate ? '' : ' hidden'}>稍後更新</button><button id="update-apply" class="btn" type="button"${scheduledUpdate ? '' : ' hidden'}>${esc(t('settings.applyUpdate'))}</button></div></section>
  <section class="card"><h2>${esc(t('settings.telegramTitle'))}</h2><p>${esc(t('settings.telegramSteps'))} <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather</a></p><p><span class="pill ${secrets.telegram.configured ? 'good' : 'warn'}">${esc(t(secrets.telegram.configured ? 'settings.configured' : 'settings.notConfigured'))}</span> · ${esc(secrets.provider)}</p><form id="telegram-form"><div class="field"><label for="telegram-token">${esc(t('settings.botToken'))}</label><input id="telegram-token" name="token" type="password" autocomplete="off" required></div><div class="field"><label for="telegram-chat-id">${esc(t('settings.chatId'))}</label><input id="telegram-chat-id" name="chatId" autocomplete="off" required></div><div class="actions" style="justify-content:flex-start"><button class="btn" type="submit">${esc(t('settings.saveAndTest'))}</button><button id="telegram-test" class="btn secondary" type="button"${secrets.telegram.configured ? '' : ' disabled'}>${esc(t('settings.test'))}</button><button id="telegram-clear" class="btn danger" type="button"${secrets.telegram.configured ? '' : ' disabled'}>${esc(t('settings.clear'))}</button></div></form></section></div>
  <div class="grid two-col" style="margin-top:1rem"><section class="card"><h2>${esc(t('settings.transferTitle'))}</h2><p>${esc(t('settings.transferHint'))}</p><div class="actions" style="justify-content:flex-start"><button id="transfer-export" class="btn" type="button">${esc(t('settings.export'))}</button><label class="btn secondary" for="transfer-import">${esc(t('settings.import'))}</label><input id="transfer-import" type="file" accept=".beyblade-transfer" hidden></div></section>
  <section class="card"><h2>${esc(t('settings.privacyTitle'))}</h2><p><a href="/privacy">${esc(t('settings.privacyLink'))}</a> · <a href="/source-policy">${esc(t('settings.sourcePolicyLink'))}</a></p><form id="privacy-form"><label style="font-weight:400"><input style="width:auto" type="checkbox" name="privacyAccepted"${settings.privacyAccepted ? ' checked' : ''}> ${esc(t('settings.acceptPrivacy'))}</label><label style="font-weight:400"><input style="width:auto" type="checkbox" name="sourcePolicyAccepted"${settings.sourcePolicyAccepted ? ' checked' : ''}> ${esc(t('settings.acceptSourcePolicy'))}</label><label style="font-weight:400"><input style="width:auto" type="checkbox" name="diagnosticsConsent"${settings.diagnosticsConsent ? ' checked' : ''}> ${esc(t('settings.diagnosticsConsent'))}</label><div class="actions" style="justify-content:flex-start"><button class="btn secondary" type="submit">${esc(t('common.save'))}</button><button id="diagnostics-export" class="btn secondary" type="button"${settings.diagnosticsConsent ? '' : ' disabled'}>${esc(t('settings.exportDiagnostics'))}</button></div></form></section></div>`;
  return layout({ ...page, title: t('settings.title'), current: '/settings', body, extraScript: settingsScript(t) });
}

function policyPage(db, base, kind) {
  const page = pageOptions(db, base);
  const { t } = page;
  const privacy = kind === 'privacy';
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('settings.eyebrow'))}</p><h1>${esc(t(privacy ? 'policy.privacyTitle' : 'policy.sourceTitle'))}</h1></div><a class="btn secondary" href="/settings">${esc(t('nav.settings'))}</a></div><section class="card"><p>${esc(t(privacy ? 'policy.privacyBody1' : 'policy.sourceBody1'))}</p><p>${esc(t(privacy ? 'policy.privacyBody2' : 'policy.sourceBody2'))}</p><p>${esc(t(privacy ? 'policy.privacyBody3' : 'policy.sourceBody3'))}</p></section>`;
  return layout({ ...page, title: t(privacy ? 'policy.privacyTitle' : 'policy.sourceTitle'), current: '/settings', body });
}

function offersPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  refreshOfferFreshness(db);
  const rows = db.all(`SELECT o.*,p.name pname,p.model pmodel,s.name sname,os.source_class FROM offers o
    JOIN products p ON p.id=o.product_id JOIN sources s ON s.id=o.source_id
    LEFT JOIN official_sources os ON os.id=s.official_source_id
    WHERE s.enabled=1 ORDER BY o.archived_at IS NOT NULL,o.freshness_status='fresh' DESC,o.purchasable DESC,o.last_seen_at DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('offers.eyebrow'))}</p><h1>${esc(t('offers.title'))}</h1><p>${esc(t('offers.intro'))}</p></div></div>${table(
    [t('table.product'), t('table.store'), t('table.status'), t('table.freshness'), t('table.originalStatus'), t('table.price'), t('table.lastCheck'), t('table.link')], rows.map((row) => [
      `<a href="/products/${row.product_id}">${esc(row.pname)}</a>${row.pmodel ? `<br><span class="muted">${esc(row.pmodel)}</span>` : ''}`,
      `${esc(row.sname)}${row.source_class ? `<br><span class="muted">${esc(t(`sourceClass.${row.source_class}`))}</span>` : ''}`, currentOfferBadge(row, t), esc(t(`freshness.${row.freshness_status}`)), esc(row.availability_raw_text || '—'),
      Number.isFinite(row.price) ? esc(`${row.price} ${row.currency || ''}`) : '—',
      esc(row.last_seen_at), `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">${esc(t('common.open'))}</a>`,
    ])
  , t)}`;
  return layout({ ...page, title: t('offers.title'), current: '/offers', body });
}

function eventsPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const rows = db.all(`SELECT e.*,p.name pname,s.name sname FROM events e
    JOIN products p ON p.id=e.product_id LEFT JOIN sources s ON s.id=e.source_id
    ORDER BY e.id DESC LIMIT 200`);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('events.eyebrow'))}</p><h1>${esc(t('events.title'))}</h1><p>${esc(t('events.intro'))}</p></div></div>${table(
    [t('table.time'), t('table.type'), t('table.product'), t('table.store'), t('table.change')], rows.map((row) => [
      esc(row.created_at), esc(row.type), esc(row.pname), esc(row.sname || '—'),
      esc([row.from_state, row.to_state].filter(Boolean).map((state) => t(`state.${state}`)).join(' → ') || '—'),
    ])
  , t)}`;
  return layout({ ...page, title: t('events.title'), current: '/events', body });
}

function catalogPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const products = listCatalogProducts(db);
  const terms = listTerminologyReviews(db);
  const productTable = products.length ? table(
    [t('table.model'), t('table.system'), t('table.aliases'), t('table.officialData'), t('table.evidence'), t('table.verification')],
    products.map((row) => [esc(row.product_code), esc(row.product_system || '—'), esc(row.aliases || '—'),
      row.official_source_name ? `${esc(row.official_source_name)}<br><span class="muted">${esc([
        row.release_date, row.msrp == null ? null : `${row.msrp} ${row.msrp_currency || ''}`,
      ].filter(Boolean).join(' · '))}</span>` : '—',
      esc(row.evidence_count), esc(t(`verification.${row.verification_status}`))]), t
  ) : `<p class="muted">${esc(t('catalog.empty'))}</p>`;
  const announcements = listOfficialAnnouncements(db);
  const announcementTable = announcements.length ? table(
    [t('table.time'),t('table.source'),t('table.product'),t('table.type'),t('table.release'),t('table.link')],
    announcements.map((row) => [esc(row.published_at || row.created_at),
      `${esc(row.source_name)}<br><span class="muted">${esc(t(`sourceClass.${row.source_class}`))}</span>`,
      esc(`${row.product_code || ''} ${row.title}`.trim()),esc(t(`officialEvent.${row.event_type}`)),
      esc(row.release_date || '—'),`<a href="${esc(row.canonical_url)}" target="_blank" rel="noopener noreferrer">${esc(t('common.original'))}</a>`]), t
  ) : `<p class="muted">${esc(t('official.empty'))}</p>`;
  const termTable = table(
    [t('table.kind'), t('table.rawValue'), t('table.locale'), t('table.suggestion'), t('table.action')],
    terms.map((row) => [esc(row.kind), esc(row.raw_value), esc(row.locale),
      row.kind === 'availability' ? `<select data-term-value="${row.id}" aria-label="${esc(t('table.status'))}"><option value="">—</option>${['coming_soon','preorder','in_stock','out_of_stock','unknown'].map((state) => `<option value="${state}">${esc(t(`state.${state}`))}</option>`).join('')}</select>` : esc(row.suggested_value || '—'),
      `<div class="actions"><button class="btn" type="button" data-term-action="approve" data-term-kind="${esc(row.kind)}" data-term-id="${row.id}">${esc(t('common.approve'))}</button><button class="btn danger" type="button" data-term-action="exclude" data-term-kind="${esc(row.kind)}" data-term-id="${row.id}">${esc(t('common.exclude'))}</button></div>`]), t
  );
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('catalog.eyebrow'))}</p><h1>${esc(t('catalog.title'))}</h1><p>${esc(t('catalog.intro'))}</p></div></div>
    <section class="card">${productTable}</section><section class="card" style="margin-top:1rem"><h2>${esc(t('official.announcements'))}</h2><p class="muted">${esc(t('official.separationHint'))}</p>${announcementTable}</section><section class="card" style="margin-top:1rem"><h2>${esc(t('terms.title'))}</h2><p class="muted">${esc(t('terms.intro'))}</p><p id="term-review-status" class="status" role="status" aria-live="polite"></p>${termTable}</section>`;
  return layout({ ...page, title: t('catalog.title'), current: '/catalog', body, extraScript: catalogScript(t) });
}

function watchlistPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const watchlists = listWatchlists(db);
  const products = listCatalogProducts(db);
  const parts = db.all('SELECT * FROM catalog_parts ORDER BY part_type,canonical_name');
  const alerts = listWatchlistAlerts(db);
  const officials = listOfficialSources(db);
  const watchCards = watchlists.map((row) => `<article class="source-card"><div><h3>${esc(row.name)} <span class="pill ${row.enabled ? 'good' : ''}">${esc(t(row.enabled ? 'watchlist.enabled' : 'watchlist.disabled'))}</span></h3><div class="meta"><span>${esc(t(`matchMode.${row.match_mode}`))}</span><span>${esc(row.selected_product_code || row.selected_part_name || row.product_code || row.model || row.barcode || row.keywords.join(', '))}</span><span>${esc(row.locale)}</span></div></div><div class="actions"><button class="btn secondary" data-watch-action="${row.enabled ? 'disable' : 'enable'}" data-watch-id="${row.id}">${esc(t(row.enabled ? 'watchlist.disable' : 'watchlist.enable'))}</button><button class="btn danger" data-watch-action="delete" data-watch-id="${row.id}">${esc(t('watchlist.delete'))}</button></div></article>`).join('');
  const alertTable = table(
    [t('table.time'),t('watchlist.title'),t('table.type'),t('table.product'),t('table.status')],
    alerts.map((row) => [esc(row.created_at),esc(row.watchlist_name),esc(t(`watchEvent.${row.alert_type}`)),
      esc(row.product_code || row.title),esc(t(row.notified ? 'watchlist.delivered' : 'watchlist.pending'))]),t
  );
  const officialCards = officials.map((source) => {
    const preview = source.preview;
    return `<article class="source-card"><div><h3>${esc(source.name)} <span class="pill ${source.enabled ? 'good' : 'warn'}">${esc(t(`sourceClass.${source.source_class}`))}</span></h3><div class="meta"><span>${esc(source.registrable_domain)}</span><span>${esc(t('official.priority', { value: source.feedPriority.join(' → ') }))}</span><span>${esc(t('official.announcementsCount', { count: source.announcement_count }))}</span></div>${preview ? `<details><summary>${esc(t('official.preview'))}</summary><p>${esc(t('official.estimate', { count: preview.estimated_products ?? t('common.unknown') }))}</p><p>${esc(t('official.scope'))}：${esc(JSON.stringify(preview.scope))}</p><p>${esc(t('official.exclusions'))}：${esc(preview.exclusions.join('、'))}</p><p>${esc(t('official.budget'))}：${esc(JSON.stringify(preview.budget))}</p></details>` : ''}</div><div class="actions">${preview?.status === 'pending' ? `<button class="btn" data-official-confirm="${source.id}">${esc(t('official.confirm'))}</button>` : `<span class="pill good">${esc(t('official.confirmed'))}</span>`}</div></article>`;
  }).join('');
  const productOptions = products.map((row) => `<option value="${row.id}">${esc(row.product_code)}</option>`).join('');
  const partOptions = parts.map((row) => `<option value="${row.id}">${esc(`${row.part_type}: ${row.code || ''} ${row.canonical_name}`)}</option>`).join('');
  const eventChecks = WATCHLIST_EVENT_TYPES.map((eventType) => `<label style="font-weight:400"><input style="width:auto" type="checkbox" name="notificationEvents" value="${eventType}" checked> ${esc(t(`watchEvent.${eventType}`))}</label>`).join('');
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('watchlist.eyebrow'))}</p><h1>${esc(t('watchlist.title'))}</h1><p>${esc(t('watchlist.intro'))}</p></div></div>
  <section class="card"><h2>${esc(t('watchlist.add'))}</h2><form id="watchlist-form" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
    <div><label for="watch-name">${esc(t('watchlist.name'))}</label><input id="watch-name" name="name" required></div>
    <div><label for="watch-target">${esc(t('watchlist.target'))}</label><select id="watch-target" name="targetType"><option value="rule">${esc(t('watchlist.rule'))}</option><option value="catalog_product">Catalog Product</option><option value="catalog_part">Catalog Part</option></select></div>
    <div><label for="watch-product">Catalog Product</label><select id="watch-product" name="catalogProductId"><option value="">—</option>${productOptions}</select></div>
    <div><label for="watch-part">Catalog Part</label><select id="watch-part" name="catalogPartId"><option value="">—</option>${partOptions}</select></div>
    <div><label for="watch-code">${esc(t('watchlist.productCode'))}</label><input id="watch-code" name="productCode" placeholder="CX-99"></div>
    <div><label for="watch-model">${esc(t('watchlist.model'))}</label><input id="watch-model" name="model" placeholder="CX-99"></div>
    <div><label for="watch-barcode">${esc(t('table.barcode'))}</label><input id="watch-barcode" name="barcode"></div>
    <div><label for="watch-keywords">${esc(t('watchlist.keywords'))}</label><input id="watch-keywords" name="keywords"></div>
    <div><label for="watch-excludes">${esc(t('watchlist.excludes'))}</label><input id="watch-excludes" name="excludeTerms"></div>
    <div><label for="watch-mode">${esc(t('watchlist.matchMode'))}</label><select id="watch-mode" name="matchMode"><option value="exact">${esc(t('matchMode.exact'))}</option><option value="contains">${esc(t('matchMode.contains'))}</option><option value="regex">${esc(t('matchMode.regex'))}</option></select></div>
    <div><label for="watch-locale">${esc(t('table.locale'))}</label><select id="watch-locale" name="locale"><option value="any">Any</option><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option></select></div>
    <fieldset style="grid-column:1/-1"><legend>${esc(t('watchlist.notifications'))}</legend><div class="actions" style="justify-content:flex-start">${eventChecks}</div></fieldset>
    <div><button class="btn" type="submit">${esc(t('watchlist.add'))}</button></div></form><p id="watchlist-status" class="status" role="status"></p></section>
  <section style="margin-top:1rem"><h2>${esc(t('watchlist.current'))}</h2><div class="source-list">${watchCards || `<div class="card muted">${esc(t('watchlist.empty'))}</div>`}</div></section>
  <section class="card" style="margin-top:1rem"><h2>${esc(t('watchlist.alerts'))}</h2>${alertTable}</section>
  <section style="margin-top:1rem"><h2>${esc(t('official.registry'))}</h2><p class="muted">${esc(t('official.registryHint'))}</p><div class="source-list">${officialCards}</div></section>`;
  return layout({ ...page, title: t('watchlist.title'), current: '/watchlist', body, extraScript: watchlistScript(t) });
}

function communityPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const sources = listCommunitySources(db);
  const posts = listCommunityPosts(db);
  const sourceCards = sources.map((source) => {
    const stateKey = source.access_state === 'ready' ? 'community.ready' :
      source.access_state === 'unavailable' ? 'community.unavailable' : 'community.userSetupRequired';
    const monthly20 = (Number(source.api_cost_per_post_usd || 0) * 20 * 30).toFixed(2);
    return `<article class="source-card"><div><h3>${esc(source.name)} <span class="pill warn">${esc(t('community.social'))}</span> <span class="pill ${source.access_state === 'ready' ? 'good' : 'warn'}">${esc(t(stateKey))}</span></h3>
      <div class="meta"><span>${esc(source.author_handle)}</span><span>${esc(source.acquisition_method)}</span><span>${esc(t('community.costPerPost', { value: source.api_cost_per_post_usd }))}</span><span>${esc(t('community.costExample', { value: monthly20 }))}</span><span>${esc(t('community.postsCount', { count: source.post_count }))}</span></div>
      <p class="muted">${esc(source.last_error || t('community.noNetwork'))}</p><p><a href="${esc(source.profile_url)}" target="_blank" rel="noopener noreferrer">${esc(t('community.originalProfile'))}</a></p>
      <form class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:.75rem" data-community-settings="${source.id}">
        <label style="font-weight:400"><input style="width:auto" type="checkbox" name="muted"${source.muted ? ' checked' : ''}> ${esc(t('community.mute'))}</label>
        <label style="font-weight:400"><input style="width:auto" type="checkbox" name="filterSensitive"${source.filter_sensitive ? ' checked' : ''}> ${esc(t('community.filterSensitive'))}</label>
        <label style="font-weight:400"><input style="width:auto" type="checkbox" name="filterSpam"${source.filter_spam ? ' checked' : ''}> ${esc(t('community.filterSpam'))}</label>
        <div><label for="community-exclude-${source.id}">${esc(t('community.excludes'))}</label><input id="community-exclude-${source.id}" name="excludeTerms" value="${esc(source.excludeTerms.join(', '))}"></div>
        <div><label for="community-retention-${source.id}">${esc(t('community.retention'))}</label><input id="community-retention-${source.id}" name="retentionDays" type="number" min="7" max="365" value="${esc(source.retention_days)}"></div>
        <div class="actions"><button class="btn secondary" type="submit">${esc(t('common.save'))}</button></div>
      </form></div><div class="actions"><button class="btn" type="button" data-x-self-setup>${esc(t('community.selfSetup'))}</button></div></article>`;
  }).join('');
  const postCards = posts.map((post) => `<article class="card"><div class="section-head"><div><h3>${esc(post.author_handle || post.source_handle || post.source_name)}</h3><div class="meta"><span>${esc(post.published_at || post.fetched_at)}</span><span>${esc(post.locale)}</span>${post.detectedModels.map((model) => `<span class="pill">${esc(model)}</span>`).join('')}${post.leadTypes.map((kind) => `<span class="pill warn">${esc(t(`communityLead.${kind}`))}</span>`).join('')}<span class="pill warn">${esc(t('community.unverified'))}</span></div></div><a href="${esc(post.canonical_url)}" target="_blank" rel="noopener noreferrer">${esc(t('common.original'))}</a></div>
    <p>${esc(post.content_text)}</p>${post.summary ? `<div class="notice warn"><strong>${esc(t('community.machineSummary'))}</strong><br>${esc(post.summary)}</div>` : ''}
    <div class="meta"><span>${esc(t('community.acquiredBy', { value: post.acquisition_method }))}</span>${post.duplicate_count ? `<span>${esc(t('community.duplicates', { count: post.duplicate_count }))}</span>` : ''}${post.matches.map((match) => `<span>${esc(t('community.watchMatch', { name: match.watchlist_name }))}</span>`).join('')}</div></article>`).join('');
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('community.eyebrow'))}</p><h1>${esc(t('community.title'))}</h1><p>${esc(t('community.intro'))}</p></div></div>
    <div class="notice warn"><strong>${esc(t('community.disclaimerTitle'))}</strong><br>${esc(t('community.disclaimer'))}</div>
    <section><h2>${esc(t('community.sources'))}</h2><p id="community-status" class="status" role="status" aria-live="polite"></p><div class="source-list">${sourceCards}</div></section>
    <section style="margin-top:1.5rem"><h2>${esc(t('community.feed'))}</h2><div class="source-list">${postCards || `<div class="card muted">${esc(t('community.empty'))}</div>`}</div></section>
    <dialog id="x-cost-dialog" aria-labelledby="x-cost-title"><div class="dialog-body"><p class="eyebrow">X API</p><h2 id="x-cost-title">${esc(t('community.costWarningTitle'))}</h2>
      <div class="notice warn"><strong>${esc(t('community.youPayTitle'))}</strong><br>${esc(t('community.youPayBody'))}</div>
      <ul><li>${esc(t('community.costRate'))}</li><li>${esc(t('community.costEstimate'))}</li><li>${esc(t('community.costChanges'))}</li><li>${esc(t('community.autoRechargeWarning'))}</li><li>${esc(t('community.noActivation'))}</li></ul>
      <p><a href="https://docs.x.com/x-api/getting-started/pricing" target="_blank" rel="noopener noreferrer">${esc(t('community.officialPricing'))}</a></p>
      <label style="font-weight:400"><input id="x-cost-ack" style="width:auto" type="checkbox"> ${esc(t('community.costAcknowledge'))}</label>
      <div class="dialog-actions"><button id="x-cost-cancel" class="btn secondary" type="button">${esc(t('community.cancel'))}</button><a id="x-console-link" class="btn" href="https://console.x.com" target="_blank" rel="noopener noreferrer" aria-disabled="true">${esc(t('community.openConsole'))}</a></div>
    </div></dialog>`;
  return layout({ ...page, title: t('community.title'), current: '/community', body, extraScript: communityScript(t) });
}

function sourcesPage(db, base) {
  const page = pageOptions(db, base);
  const { t } = page;
  const rows = listManagedSources(db);
  const network = getNetworkState(db, base.appConfig);
  const discoverySites = new Map(listDiscoverySites(db).map((site) => [Number(site.id), site]));
  const cards = rows.map((source) => {
    const discovery = discoverySites.get(Number(source.site_id));
    const hasMonitorPages = Number(source.seed_count) > 0;
    const canMonitor = hasMonitorPages || Number(source.offer_count) > 0;
    let recipe = {};
    try { recipe = discovery?.recipe_config_json ? JSON.parse(discovery.recipe_config_json) : {}; } catch { recipe = {}; }
    const settingPanel = discovery ? `<details style="margin-top:.75rem"><summary>${esc(t('sources.budget'))}</summary><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:.75rem" data-discovery-settings="${source.site_id}">
      <div><label for="max-pages-${source.id}">${esc(t('sources.maxPages'))}</label><input id="max-pages-${source.id}" data-setting="maxPages" type="number" min="1" max="500" value="${esc(discovery.max_pages || 100)}"></div>
      <div><label for="max-depth-${source.id}">${esc(t('sources.maxDepth'))}</label><input id="max-depth-${source.id}" data-setting="maxDepth" type="number" min="0" max="5" value="${esc(discovery.max_depth ?? 2)}"></div>
      <div><label for="max-seconds-${source.id}">${esc(t('sources.maxSeconds'))}</label><input id="max-seconds-${source.id}" data-setting="maxSeconds" type="number" min="10" max="1800" value="${esc(discovery.max_seconds || 300)}"></div>
      <div><label for="max-mb-${source.id}">${esc(t('sources.maxMb'))}</label><input id="max-mb-${source.id}" data-setting="maxMb" type="number" min="1" max="250" value="${esc(Math.round(Number(discovery.max_bytes || 52428800) / 1048576))}"></div>
      <div><label for="interval-${source.id}">${esc(t('sources.intervalHours'))}</label><input id="interval-${source.id}" data-setting="intervalHours" type="number" min="1" max="168" value="${esc(Math.round(Number(discovery.interval_seconds || 86400) / 3600))}"></div>
      <div><label for="include-${source.id}">${esc(t('sources.include'))}</label><input id="include-${source.id}" data-setting="includeTerms" value="${esc((recipe.includeTerms || []).join(', '))}" placeholder="beyblade, beyX"></div>
      <div><label for="exclude-${source.id}">${esc(t('sources.exclude'))}</label><input id="exclude-${source.id}" data-setting="excludeTerms" value="${esc((recipe.excludeTerms || []).join(', '))}" placeholder="used, parts"></div>
      <div class="actions" style="align-items:end"><button class="btn secondary" type="button" data-save-discovery="${source.site_id}">${esc(t('sources.saveDiscovery'))}</button></div>
    </div></details>` : '';
    const statusKey = source.enabled ? 'sources.active' : discovery && !hasMonitorPages ? 'sources.discovery' : 'sources.disabled';
    return `<article class="source-card"><div><h3>${esc(source.name)} <span class="pill ${source.enabled ? 'good' : discovery && !hasMonitorPages ? 'warn' : ''}">${esc(t(statusKey))}</span></h3>
    <div class="meta"><span>${esc(source.registrable_domain || source.url || t('sources.noDomain'))}</span><span>${esc(source.connector)} v${esc(source.connector_version)}</span>${source.source_class ? `<span>${esc(t(`sourceClass.${source.source_class}`))}</span>` : ''}<span>${esc(t('sources.monitorUrls', { count: source.seed_count }))}</span><span>${esc(t('sources.offerCount', { count: source.offer_count }))}</span><span>${esc(t('sources.nextMonitor', { time: source.monitor_next_run_at || t('common.never') }))}</span><span>${esc(t('sources.monitorFailures', { count: source.monitor_failures || 0 }))}</span><span>${esc(t(source.managed_by === 'ui' ? 'sources.uiManaged' : 'sources.builtIn'))}</span>${source.site_id ? `<span>${esc(t('sources.pending', { count: discoverySites.get(Number(source.site_id))?.pending_candidates || 0 }))}</span>` : ''}</div>
    ${source.last_error ? `<p class="status error">${esc(source.last_error)}</p>` : ''}${discovery?.recipe_error ? `<p class="status error">Recipe：${esc(discovery.recipe_error)}</p>` : ''}${settingPanel}</div><div class="actions">
    ${source.site_id ? `<button class="btn secondary" type="button" data-discovery-site="${source.site_id}">${esc(t('sources.discover'))}</button>` : ''}
    ${canMonitor ? `<button class="btn secondary" type="button" data-source-action="check-now" data-source-id="${source.id}">${esc(t('sources.checkNow'))}</button><button class="btn secondary" type="button" data-source-action="test" data-source-id="${source.id}">${esc(t('sources.test'))}</button>
    <button class="btn ${source.enabled ? 'danger' : 'secondary'}" type="button" data-source-action="${source.enabled ? 'disable' : 'enable'}" data-source-id="${source.id}">${esc(t(source.enabled ? 'sources.disable' : 'sources.enable'))}</button>` : ''}</div></article>`;
  }).join('');
  const networkCard = `<section class="card ${network.enabled ? '' : 'notice warn'}" style="margin-bottom:1rem"><div class="section-head"><div><h2>${esc(t('network.title'))}</h2><p>${esc(t(network.enabled ? 'network.enabledHint' : 'network.disabledHint'))}${network.reason ? `：${esc(network.reason)}` : ''}</p></div><button id="network-toggle" class="btn ${network.enabled ? 'danger' : ''}" data-enable="${network.enabled ? 'false' : 'true'}" type="button">${esc(t(network.enabled ? 'network.pause' : 'network.resume'))}</button></div></section>`;
  const body = `${networkCard}<div class="section-head"><div><p class="eyebrow">${esc(t('sources.eyebrow'))}</p><h1>${esc(t('sources.title'))}</h1><p>${esc(t('sources.intro'))}</p></div></div><div class="grid two-col"><section class="card"><h2>${esc(t('sources.paste'))}</h2>
    <form id="add-source-form" class="inline-form"><div><label for="source-url">${esc(t('sources.url'))}</label><input id="source-url" name="url" type="url" inputmode="url" autocomplete="url" required placeholder="https://store.example/product"><p class="hint">${esc(t('sources.urlHint'))}</p></div><button class="btn" type="submit">${esc(t('sources.preview'))}</button></form>
    <p id="source-status" class="status" role="status" aria-live="polite"></p><div id="source-preview" class="preview" hidden></div></section>
    <aside class="card"><h2>${esc(t('sources.flow'))}</h2><ol><li>${esc(t('sources.flow1'))}</li><li>${esc(t('sources.flow2'))}</li><li>${esc(t('sources.flow3'))}</li><li>${esc(t('sources.flow4'))}</li></ol><div class="notice">${esc(t('sources.defaultBudget'))}</div></aside></div>
    <section id="source-list" style="margin-top:1.5rem"><div class="section-head"><div><h2>${esc(t('sources.current'))}</h2><p>${esc(t('sources.disabledHistory'))}</p></div></div><p id="source-action-status" class="status" role="status" aria-live="polite"></p><div class="source-list">${cards || `<div class="card muted">${esc(t('sources.none'))}</div>`}</div></section>`;
  return layout({ ...page, title: t('nav.sources'), current: '/sources', body, extraScript: sourcesScript(t) });
}

function reviewPage(db, base, status = 'pending') {
  const page = pageOptions(db, base);
  const { t } = page;
  const candidates = listCandidates(db, { status });
  const rows = candidates.map((candidate) => [
    `<input name="candidate" type="checkbox" value="${candidate.id}" aria-label="${esc(t('review.choose', { title: candidate.title }))}">`,
    `<strong>${esc(candidate.title)}</strong>${candidate.model ? `<br><span class="muted">${esc(candidate.model)}</span>` : ''}`,
    `${esc(candidate.site_name)}<br><span class="muted">${esc(candidate.discovery_method)}</span>`,
    `${Math.round(Number(candidate.confidence) * 100)}%<br><span class="muted">${candidate.reasons.map(esc).join('、') || esc(t('review.noReason'))}</span>`,
    candidate.price == null ? '—' : esc(`${candidate.price} ${candidate.currency || ''}`),
    `<a href="${esc(candidate.canonical_url)}" target="_blank" rel="noopener noreferrer">${esc(t('common.original'))}</a>`,
    `<div class="actions"><button class="btn" type="button" data-single-review="approve" data-candidate-id="${candidate.id}">${esc(t('common.approve'))}</button><button class="btn secondary" type="button" data-single-review="defer" data-candidate-id="${candidate.id}">${esc(t('common.defer'))}</button><button class="btn danger" type="button" data-single-review="exclude" data-candidate-id="${candidate.id}">${esc(t('common.exclude'))}</button></div>`,
  ]);
  const body = `<div class="section-head"><div><p class="eyebrow">${esc(t('review.eyebrow'))}</p><h1>${esc(t('review.title'))}</h1><p>${esc(t('review.intro'))}</p></div><a class="btn secondary" href="/sources">${esc(t('review.back'))}</a></div>
    <div class="actions" style="justify-content:flex-start;margin-bottom:1rem"><a href="/review?status=pending">${esc(t('review.pending'))}</a><a href="/review?status=deferred">${esc(t('review.deferred'))}</a><a href="/review?status=approved">${esc(t('review.approved'))}</a><a href="/review?status=excluded">${esc(t('review.excluded'))}</a></div>
    <section class="card"><div class="actions" style="justify-content:flex-start;margin-bottom:1rem"><label style="margin:0"><input id="select-all" type="checkbox" style="width:auto"> ${esc(t('review.selectAll'))}</label><button class="btn" type="button" data-review-action="approve">${esc(t('review.batchApprove'))}</button><button class="btn secondary" type="button" data-review-action="defer">${esc(t('review.batchDefer'))}</button><button class="btn danger" type="button" data-review-action="exclude">${esc(t('review.batchExclude'))}</button></div><p id="review-status" class="status" role="status" aria-live="polite"></p>${table(
      [t('review.select'), t('table.product'), t('review.storeSource'), t('review.confidence'), t('table.price'), t('review.originalPage'), t('review.action')], rows, t
    )}</section>`;
  return layout({ ...page, title: t('nav.review'), current: '/review', body, extraScript: reviewQueueScript(t) });
}

function response(body, type = 'text/html; charset=utf-8', status = 200, headers = {}) {
  return { status, type, body, headers };
}
function json(value, status = 200) {
  return response(JSON.stringify(value, null, 2), 'application/json; charset=utf-8', status);
}

async function readJson(req, limit = 32768) {
  const t = req.t || createTranslator();
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error(t('api.tooLarge'));
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error(t('api.invalidJson')); }
}

function isMutation(method) { return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method); }
function validateLocalRequest(req, csrfToken, t) {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error(t('api.localOnly'));
  if (!isMutation(req.method)) return;
  const origin = req.headers.origin;
  if (origin) {
    const originHost = new URL(origin).hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(originHost)) throw new Error(t('api.externalDenied'));
  }
  if (req.headers['x-csrf-token'] !== csrfToken) throw new Error(t('api.csrf'));
}

export function createWebServer(db, options = {}) {
  const csrfToken = randomBytes(24).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');
  const appConfig = options.appConfig || {};
  const base = { csrfToken, nonce, appConfig, secretStore: options.secretStore };
  const updateOperations = new Map();
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const requestT = createTranslator(readSettings(db).language || 'zh-TW');
    req.t = requestT;
    try {
      validateLocalRequest(req, csrfToken, requestT);
      let out;
      if (req.method === 'GET' && url.pathname === '/') out = response(overviewPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/products') out = response(productsPage(db, base));
      else if (req.method === 'GET' && /^\/products\/\d+$/.test(url.pathname)) {
        const detail = productDetailPage(db, base, Number(url.pathname.split('/').at(-1)));
        out = detail ? response(detail) : response(requestT('api.notFound'), 'text/plain; charset=utf-8', 404);
      }
      else if (req.method === 'GET' && url.pathname === '/offers') out = response(offersPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/events') out = response(eventsPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/catalog') out = response(catalogPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/watchlist') out = response(watchlistPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/community') out = response(communityPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/review') out = response(reviewPage(db, base, url.searchParams.get('status') || 'pending'));
      else if (req.method === 'GET' && url.pathname === '/exclusions') out = response(exclusionsPage(db, base, url.searchParams.get('status') || 'all'));
      else if (req.method === 'GET' && url.pathname === '/sources') out = response(sourcesPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/settings') out = response(settingsPage(db, base));
      else if (req.method === 'GET' && url.pathname === '/privacy') out = response(policyPage(db, base, 'privacy'));
      else if (req.method === 'GET' && url.pathname === '/source-policy') out = response(policyPage(db, base, 'source'));
      else if (req.method === 'GET' && url.pathname === '/health') out = json(healthData(db, appConfig));
      else if (req.method === 'GET' && url.pathname === '/api/sources') out = json({ sources: listManagedSources(db) });
      else if (req.method === 'GET' && url.pathname === '/api/settings') out = json(readSettings(db));
      else if (req.method === 'GET' && url.pathname === '/api/candidates') out = json({ candidates: listCandidates(db, { status: url.searchParams.get('status') || 'pending' }) });
      else if (req.method === 'GET' && url.pathname === '/api/terminology') out = json({ terms: listTerminologyReviews(db, { status: url.searchParams.get('status') || 'pending' }) });
      else if (req.method === 'GET' && url.pathname === '/api/watchlists') out = json({ watchlists: listWatchlists(db), alerts: listWatchlistAlerts(db) });
      else if (req.method === 'GET' && url.pathname === '/api/official-sources') out = json({ sources: listOfficialSources(db), announcements: listOfficialAnnouncements(db) });
      else if (req.method === 'GET' && url.pathname === '/api/community') out = json({ sources: listCommunitySources(db), posts: listCommunityPosts(db) });
      else if (req.method === 'POST' && url.pathname === '/api/settings') {
        out = json({ settings: saveOnboardingSettings(db, await readJson(req)) });
      } else if (req.method === 'POST' && url.pathname === '/api/settings/language') {
        out = json({ language: saveLanguageSetting(db, (await readJson(req)).language) });
      } else if (req.method === 'POST' && url.pathname === '/api/privacy') {
        out = json({ settings: savePrivacySettings(db, await readJson(req)) });
      } else if (req.method === 'POST' && url.pathname === '/api/notifications/telegram') {
        if (!options.secretStore) throw new Error('此執行模式未啟用 Windows 憑證儲存。');
        const body = await readJson(req);
        const status = options.secretStore.saveTelegram(body);
        options.onNotificationSettingsChanged?.();
        let test = null;
        if (body.test === true) {
          assertNetworkEnabled(db, appConfig);
          const notifier = new TelegramNotifier({ ...body, timeoutMs: appConfig.http?.timeoutMs, maxRetries: appConfig.http?.maxRetries });
          test = await notifier.send({ title: 'Beyblade Tracker', body: 'Telegram 通知設定成功。' });
          if (test.status !== 'sent') throw new Error(test.detail);
        }
        out = json({ status, test });
      } else if (req.method === 'POST' && url.pathname === '/api/notifications/telegram/test') {
        assertNetworkEnabled(db, appConfig);
        if (!options.secretStore) throw new Error('此執行模式未啟用 Windows 憑證儲存。');
        const credentials = options.secretStore.readNotifications().telegram;
        const notifier = new TelegramNotifier({ ...credentials, timeoutMs: appConfig.http?.timeoutMs, maxRetries: appConfig.http?.maxRetries });
        const test = await notifier.send({ title: 'Beyblade Tracker', body: 'Telegram 測試通知。' });
        if (test.status !== 'sent') throw new Error(test.detail);
        out = json({ test });
      } else if (req.method === 'DELETE' && url.pathname === '/api/notifications/telegram') {
        if (!options.secretStore) throw new Error('此執行模式未啟用 Windows 憑證儲存。');
        out = json({ status: options.secretStore.clearTelegram() });
        options.onNotificationSettingsChanged?.();
      } else if (req.method === 'POST' && url.pathname === '/api/transfer/export') {
        const bundle = createTransferBundle(appConfig);
        const name = `beyblade-transfer-${new Date().toISOString().slice(0, 10)}.beyblade-transfer`;
        out = response(bundle, 'application/gzip', 200, { 'Content-Disposition': `attachment; filename="${name}"` });
      } else if (req.method === 'POST' && url.pathname === '/api/transfer/import') {
        const body = await readJson(req, 160 * 1024 * 1024);
        const staged = stageTransferImport(Buffer.from(body.data || '', 'base64'), appConfig);
        out = json({ staged, restartRequired: true }, 202);
        setTimeout(() => options.onRestartRequested?.('transfer-import'), 300);
      } else if (req.method === 'POST' && url.pathname === '/api/diagnostics/export') {
        const bundle = createDiagnosticsBundle(db, appConfig);
        out = response(bundle, 'application/gzip', 200, { 'Content-Disposition': 'attachment; filename="beyblade-diagnostics.json.gz"' });
      } else if (req.method === 'GET' && url.pathname === '/api/update') {
        assertNetworkEnabled(db, appConfig);
        let update;
        try {
          update = await checkForUpdate(appConfig);
        } finally {
          if (appConfig.update?.manifestUrl) recordUpdateCheck(db, update);
        }
        out = json({ ...getUpdateState(db).latestResult, state: getUpdateState(db) });
      } else if (req.method === 'GET' && url.pathname === '/api/update/status') {
        const state = getUpdateState(db);
        out = json({ ...(state.latestResult || { enabled: Boolean(appConfig.update?.manifestUrl), updateAvailable: false }), state });
      } else if (req.method === 'POST' && url.pathname === '/api/update/defer') {
        assertNetworkEnabled(db, appConfig);
        const confirmation = await readJson(req);
        const update = await checkForUpdate(appConfig);
        if (!update.updateAvailable) throw new UpdateError('BT-UPD-005', '目前沒有可延後的更新。');
        out = json({ deferred: deferUpdate(db, confirmation, update.manifest) });
      } else if (req.method === 'POST' && url.pathname === '/api/update/apply') {
        assertNetworkEnabled(db, appConfig);
        const confirmation = await readJson(req);
        const update = await checkForUpdate(appConfig);
        if (!update.updateAvailable) throw new UpdateError('BT-UPD-005', '目前已是最新版本。');
        validateUpdateConfirmation(confirmation, update.manifest);
        const id = randomBytes(18).toString('base64url');
        const operation = { id, targetVersion: update.manifest.version, phase: 'downloading', received: 0, total: Number(update.manifest.size), error: null };
        updateOperations.set(id, operation);
        void (async () => {
          try {
            const prepared = await prepareConfirmedUpdate(db, appConfig, update.manifest, confirmation, {
              onProgress: ({ received, total }) => Object.assign(operation, { phase: 'downloading', received, total }),
            });
            operation.phase = 'installing';
            await launchPreparedUpdate(prepared);
            operation.phase = 'launched';
          } catch (error) {
            operation.phase = 'failed';
            operation.error = error instanceof UpdateError ? error.message : 'BT-UPD-005：更新安裝失敗。';
          }
        })();
        out = json({ operationId: id, targetVersion: operation.targetVersion }, 202);
      } else if (req.method === 'GET' && /^\/api\/update\/progress\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
        const id = url.pathname.split('/').at(-1);
        const operation = updateOperations.get(id);
        if (!operation) out = response(requestT('api.notFound'), 'text/plain; charset=utf-8', 404);
        else out = json(operation);
      } else if (req.method === 'POST' && url.pathname === '/api/update/rollback') {
        if (!options.onRollbackRequested?.()) throw new UpdateError('BT-UPD-007', '無法安全地排程回滾。');
        out = json({ accepted: true, message: '服務將停止並執行回滾。' }, 202);
      } else if (req.method === 'POST' && url.pathname === '/api/sources/preview') {
        assertNetworkEnabled(db, appConfig);
        const body = await readJson(req);
        out = json(await previewSourceUrl(db, body.url, {
          timeoutMs: appConfig.http?.timeoutMs,
          userAgent: appConfig.http?.userAgent,
          maxRetries: appConfig.http?.maxRetries,
          perHostMinIntervalMs: appConfig.http?.perHostMinIntervalMs,
        }));
      } else if (req.method === 'POST' && url.pathname === '/api/sources') {
        assertNetworkEnabled(db, appConfig);
        const body = await readJson(req);
        const previewUrl = new URL(body.url);
        await assertPublicUrl(previewUrl);
        const result = confirmSource(db, body);
        const message = result.discoveryOnly
          ? requestT('api.discoveryAdded')
          : result.sourceCreated ? requestT('api.storeAdded')
            : result.seedCreated ? requestT('api.seedAdded') : requestT('api.urlExists');
        out = json({ ...result, message }, 201);
      } else if (req.method === 'POST' && url.pathname === '/api/watchlists') {
        out = json({ watchlist: createWatchlist(db, await readJson(req)), message: requestT('api.watchlistAdded') }, 201);
      } else if (req.method === 'POST' && url.pathname === '/api/products/merge') {
        const body = await readJson(req);
        out = json(mergeProducts(db, body.sourceProductId, body.targetProductId, { note: body.note }));
      } else if (req.method === 'PATCH' && url.pathname === '/api/network') {
        const body = await readJson(req);
        out = json({ network: setNetworkEnabled(db, body.enabled === true, { reason: body.reason, config: appConfig }) });
      } else {
        const discoveryMatch = url.pathname.match(/^\/api\/sites\/(\d+)\/discover$/);
        const discoverySettingsMatch = url.pathname.match(/^\/api\/sites\/(\d+)\/discovery-settings$/);
        const candidateMatch = url.pathname.match(/^\/api\/candidates\/(\d+)\/review$/);
        const terminologyMatch = url.pathname.match(/^\/api\/terminology\/(\d+)\/review$/);
        const monitorMatch = url.pathname.match(/^\/api\/sources\/(\d+)\/check-now$/);
        const watchlistMatch = url.pathname.match(/^\/api\/watchlists\/(\d+)$/);
        const officialConfirmMatch = url.pathname.match(/^\/api\/official-sources\/(\d+)\/confirm$/);
        const communitySourceMatch = url.pathname.match(/^\/api\/community-sources\/(\d+)$/);
        const productSplitMatch = url.pathname.match(/^\/api\/products\/(\d+)\/split$/);
        const exclusionMatch = url.pathname.match(/^\/api\/exclusions\/(\d+)$/);
        if (productSplitMatch && req.method === 'POST') {
          const body = await readJson(req);
          out = json(splitProduct(db, Number(productSplitMatch[1]), body.offerIds, { name: body.name, note: body.note }), 201);
        } else if (exclusionMatch && req.method === 'POST') {
          out = json({ exclusion: reviewExclusion(db, Number(exclusionMatch[1]), await readJson(req)) });
        } else if (communitySourceMatch && req.method === 'PATCH') {
          out = json({ source: updateCommunitySource(db, Number(communitySourceMatch[1]), await readJson(req)) });
        } else if (officialConfirmMatch && req.method === 'POST') {
          out = json({ ...confirmOfficialPreview(db, Number(officialConfirmMatch[1])), message: requestT('api.officialConfirmed') });
        } else if (watchlistMatch && req.method === 'PATCH') {
          const body = await readJson(req);
          out = json({ watchlist: setWatchlistEnabled(db, Number(watchlistMatch[1]), body.enabled === true) });
        } else if (watchlistMatch && req.method === 'DELETE') {
          out = json(deleteWatchlist(db, Number(watchlistMatch[1])));
        } else if (monitorMatch && req.method === 'POST') {
          assertNetworkEnabled(db, appConfig);
          const request = requestImmediateMonitor(db, Number(monitorMatch[1]));
          options.onMonitorRequested?.(Number(monitorMatch[1]));
          out = json({ request, message: requestT('api.monitorQueued') }, 202);
        } else if (discoveryMatch && req.method === 'POST') {
          assertNetworkEnabled(db, appConfig);
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
        } else if (terminologyMatch && req.method === 'POST') {
          out = json({ term: reviewTerminology(db, Number(terminologyMatch[1]), await readJson(req)) });
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
          assertNetworkEnabled(db, appConfig);
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
          out = json({ message: requestT(enabled ? 'api.sourceEnabled' : 'api.sourceDisabled') });
          } else out = response(requestT('api.notFound'), 'text/plain; charset=utf-8', 404);
        }
      }
      res.writeHead(out.status, {
        'Content-Type': out.type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'`,
        ...(out.headers || {}),
      });
      res.end(out.body);
    } catch (err) {
      const supportRef = randomBytes(9).toString('base64url');
      const envelope = errorEnvelope(err, {
        appVersion: releaseInfo(appConfig).version,
        supportRef,
      });
      logger.warn(`web request failed: code=${envelope.code} supportRef=${envelope.supportRef}`);
      const status = /找不到|not found|見つかり/i.test(err.message) ? 404 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'error', error: envelope }));
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
