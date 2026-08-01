import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from './db/database.js';
import { getConfig, loadSourcesResult } from './config.js';
import { loadEnv } from './util/env.js';
import { logger } from './util/logger.js';
import { createConnector } from './connectors/index.js';
import { crawlSource } from './core/pipeline.js';
import {
  upsertSource, startCrawlRun, finishCrawlRun, recordCrawlSuccess, recordCrawlFailure,
  pruneStaleSources, recoverInterruptedCrawlRuns,
} from './core/store.js';
import { connectorVersion } from './connectors/index.js';
import { createAutomaticBackupIfDue } from './maintenance/backup.js';
import { sourceConfigWithSeeds, syncSourceSite } from './core/source-manager.js';
import { buildNotifiers } from './notify/index.js';
import { flushNotifications } from './notify/queue.js';
import { recoverInterruptedDiscoveryRuns, runDueDiscoveries } from './core/discovery.js';
import { backfillCatalog } from './core/catalog.js';
import { registerDefaultOfficialSources } from './core/official.js';
import { pruneExpiredCommunityPosts, registerDefaultCommunitySources } from './core/community.js';
import { flushWatchlistAlerts } from './core/watchlist.js';
import {
  ensureSourceMonitorSettings, finalizeFailedMonitor, finalizeSuccessfulMonitor,
  listDueMonitorSources, refreshOfferFreshness, startMonitorRequests,
} from './core/monitor.js';
import { getNetworkState } from './core/network-control.js';
import {
  newCorrelationId, parserOutcome, recordOperationEvent, safeErrorClass,
} from './core/operations.js';
import { projectPaths } from './paths.js';
import { createSecretStore } from './security/secret-store.js';
import { applyPendingTransfer } from './maintenance/transfer.js';

export function createApp(overrides = {}) {
  const { secretStore: providedSecretStore, ...configOverrides } = overrides;
  const initialPaths = projectPaths();
  loadEnv(initialPaths.userRoot);
  const config = { ...getConfig(), ...configOverrides };
  ensureUserLayout(config);
  mkdirSync(dirname(config.dbPath), { recursive: true });
  if (config.dbPath !== ':memory:' && config.backup) {
    createAutomaticBackupIfDue(config.dbPath, config.backup.dir, config.backup);
  }
  const secretStore = providedSecretStore || createSecretStore(config.secretFile);
  applyNotificationSecrets(config, secretStore);
  config.appliedTransfer = applyPendingTransfer(config, { pidFile: initialPaths.pidFile });
  const db = openDatabase(config.dbPath);
  registerDefaultOfficialSources(db);
  registerDefaultCommunitySources(db);
  pruneExpiredCommunityPosts(db);
  backfillCatalog(db);
  const notifiers = buildNotifiers(config);
  return { db, config, notifiers, secretStore };
}

function applyNotificationSecrets(config, secretStore) {
  const stored = secretStore.readNotifications();
  config.notify = config.notify || {};
  config.notify.telegram = {
    ...(config.notify.telegram || {}),
    token: config.notify.telegram?.token || stored.telegram.token,
    chatId: config.notify.telegram?.chatId || stored.telegram.chatId,
  };
  config.notify.discord = {
    ...(config.notify.discord || {}),
    webhook: config.notify.discord?.webhook || stored.discord.webhook,
  };
}

export function refreshNotificationConfiguration(app) {
  const stored = app.secretStore.readNotifications();
  app.config.notify.telegram.token = stored.telegram.token;
  app.config.notify.telegram.chatId = stored.telegram.chatId;
  app.config.notify.discord.webhook = stored.discord.webhook;
  app.notifiers = buildNotifiers(app.config);
  return app.secretStore.status();
}

function ensureUserLayout(config) {
  for (const dir of [dirname(config.dbPath), dirname(config.userSourcesPath || config.sourcesPath),
    config.backup?.dir, config.exportDir, config.releaseDir, config.runtimeDir]) {
    if (dir) mkdirSync(dir, { recursive: true });
  }
  if (config.userSourcesPath && !existsSync(config.userSourcesPath)) {
    const template = [
      config.sourcesPath,
      join(config.appRoot || process.cwd(), 'config', 'sources.json'),
      join(config.appRoot || process.cwd(), 'config', 'sources.example.json'),
    ].find((candidate) => candidate && existsSync(candidate));
    if (template) copyFileSync(template, config.userSourcesPath);
  }
  if (config.userSourcesPath && existsSync(config.userSourcesPath)) config.sourcesPath = config.userSourcesPath;
}

// Pipeline options derived from config.
function pipelineOpts(config, source = {}) {
  return {
    preorderIsPurchasable: config.preorderIsPurchasable,
    eventCooldownSeconds: config.eventCooldownSeconds,
    priceChangeThreshold: config.priceChangeThreshold,
    stabilityConfirmations: Number(source.stability_confirmations || config.offerStabilityConfirmations || 2),
  };
}

export function syncSources(app) {
  const { ok, sources: defs } = loadSourcesResult(app.config.sourcesPath);
  const rows = [];
  for (const def of defs) {
    const row = upsertSource(app.db, {
      ...def,
      connectorVersion: connectorVersion(def.connector),
      managedBy: 'config',
    });
    rows.push(syncSourceSite(app.db, row, def));
    ensureSourceMonitorSettings(app.db, row);
  }
  // Only prune after a valid parse. A missing or malformed config must never
  // silently disable every existing source.
  if (ok) pruneStaleSources(app.db, defs.map((def) => def.key));
  return rows;
}

export function recoverInterruptedWork(app) {
  return recoverInterruptedCrawlRuns(app.db) + recoverInterruptedDiscoveryRuns(app.db);
}

/**
 * Run one crawl across all enabled sources. Each source is isolated: a
 * failure records the error and moves on. Returns aggregate stats.
 */
export async function runOfferMonitors(app, {
  onlyKey, force = false, nowMs = Date.now(), random = Math.random,
  correlationId = newCorrelationId(),
} = {}) {
  const { db, config } = app;
  const network = getNetworkState(db, config);
  if (!network.enabled) {
    return { sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0, paused: true, reason: network.reason };
  }
  refreshOfferFreshness(db, { now: new Date(nowMs).toISOString() });
  const sources = listDueMonitorSources(db, {
    onlyKey, force, now: new Date(nowMs).toISOString(),
  });

  const summary = { sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0 };

  for (const source of sources) {
    if (!getNetworkState(db, config).enabled) {
      summary.paused = true;
      summary.reason = getNetworkState(db, config).reason;
      break;
    }
    summary.sources += 1;
    const sourceConfig = parseSourceConfig(db, source);
    if (source.connector === 'browser' && !sourceConfig.executablePath && config.browser?.path) {
      sourceConfig.executablePath = config.browser.path;
    }
    const source2 = { ...source, config: sourceConfig };
    const runId = startCrawlRun(db, source);
    startMonitorRequests(db, source.id, new Date(nowMs).toISOString());
    const startedMs = Date.now();
    try {
      const httpDeps = {
        http: {
          ...config.http,
          perHostMinIntervalMs: Math.max(
            Number(config.http?.perHostMinIntervalMs || 0), Number(source.min_interval_ms || 0)
          ),
        },
        debug: { saveHtml: config.debugHtml, dir: config.debugDir },
      };
      const connector = createConnector(source2, httpDeps);
      const stats = await crawlSource(db, source2, connector, pipelineOpts(config, source), runId);
      // Classify what the parser actually produced (no URL, zero valid listings,
      // partial, or clean) and record exactly one parser event before deciding
      // whether the source crawl itself succeeded.
      const parser = parserOutcome(stats);
      recordOperationEvent(db, {
        correlationId, component: 'parser', operation: 'extract', sourceKey: source.key,
        status: parser.status, durationMs: Date.now() - startedMs, errorClass: parser.errorClass,
        counts: { valid: parser.valid, invalid: parser.itemInvalid, failed: parser.itemFailed, pages: parser.pages, pageFailed: parser.pageFailed },
      });
      if (parser.valid === 0) {
        // No usable listing entered the pipeline this crawl: surface it as a
        // source failure (health/backoff) with a precise, content-free class.
        const error = new Error(`parser produced no valid listings (${parser.errorClass})`);
        error.errorClass = parser.errorClass;
        error.parserRecorded = true;
        throw error;
      }
      recordCrawlSuccess(db, source.id);
      finishCrawlRun(db, runId, { status: 'success', ...stats });
      finalizeSuccessfulMonitor(db, source, {
        seenOfferIds: stats.seenOfferIds,
        terminalOfferIds: stats.terminalOfferIds,
        now: new Date(nowMs).toISOString(), random,
      });
      const durationMs = Date.now() - startedMs;
      recordOperationEvent(db, {
        correlationId, component: 'source', operation: 'monitor', sourceKey: source.key,
        status: 'success', durationMs,
      });
      summary.ok += 1;
      summary.itemsSeen += stats.itemsSeen;
      summary.eventsCreated += stats.eventsCreated;
      logger.info(`source ${source.key}: ${stats.itemsSeen} items, ${stats.eventsCreated} events`);
    } catch (err) {
      recordCrawlFailure(db, source.id, err.message);
      finishCrawlRun(db, runId, { status: 'failed', error: err.message });
      finalizeFailedMonitor(db, source, err.message, {
        now: new Date(nowMs).toISOString(), random,
      });
      const durationMs = Date.now() - startedMs;
      const errorClass = safeErrorClass(err);
      recordOperationEvent(db, {
        correlationId, component: 'source', operation: 'monitor', sourceKey: source.key,
        status: 'failed', durationMs, errorClass,
      });
      // The zero-valid path already recorded a precise parser event; only add a
      // parser failure here for parse errors thrown elsewhere (e.g. a connector).
      if (!err.parserRecorded && errorClass === 'parse') {
        recordOperationEvent(db, {
          correlationId, component: 'parser', operation: 'extract', sourceKey: source.key,
          status: 'failed', durationMs, errorClass,
        });
      }
      summary.failed += 1;
      logger.warn(`source ${source.key} failed: ${err.message}`);
    }
  }

  return summary;
}

export async function runDiscoveryScheduler(app, { nowMs = Date.now() } = {}) {
  if (!getNetworkState(app.db, app.config).enabled) return [];
  return runDueDiscoveries(app.db, {
    userAgent: app.config.http?.userAgent,
    now: new Date(nowMs).toISOString(),
  });
}

/** Run the independent offer monitor and discovery schedulers, then notify. */
export async function runOnce(app, {
  onlyKey, dueOnly = false, nowMs = Date.now(), random = Math.random,
  correlationId = newCorrelationId(),
} = {}) {
  syncSources(app);
  const network = getNetworkState(app.db, app.config);
  if (!network.enabled) {
    refreshOfferFreshness(app.db, { now: new Date(nowMs).toISOString() });
    cleanupRaw(app);
    return {
      sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0,
      paused: true, pauseReason: network.reason, discovery: [],
      notify: { groups: 0, sent: 0, skipped: 0, failed: 0, paused: true },
      watchlistNotify: { sent: 0, skipped: 0, failed: 0, paused: true }, communityPruned: 0,
    };
  }
  const summary = await runOfferMonitors(app, {
    onlyKey, force: !dueOnly, nowMs, random, correlationId,
  });

  const discovery = await runDiscoveryScheduler(app, { nowMs });

  const mayNotify = getNetworkState(app.db, app.config).enabled;
  const notifyResult = mayNotify
    ? await flushNotifications(app.db, app.notifiers, { correlationId })
    : { groups: 0, sent: 0, skipped: 0, failed: 0, paused: true };
  const watchlistNotify = mayNotify
    ? await flushWatchlistAlerts(app.db, app.notifiers)
    : { sent: 0, skipped: 0, failed: 0, paused: true };
  const communityPruned = pruneExpiredCommunityPosts(app.db, { at: new Date(nowMs).toISOString() });
  logger.info(
    `notifications: ${notifyResult.groups} groups, ${notifyResult.sent} sent, ` +
    `${notifyResult.skipped} skipped, ${notifyResult.failed || 0} failed`
  );

  cleanupRaw(app);
  return { ...summary, discovery, notify: notifyResult, watchlistNotify, communityPruned };
}

function parseSourceConfig(db, source) {
  return sourceConfigWithSeeds(db, source);
}

// Enforce retention: drop old raw observation summaries and debug HTML files
// beyond the configured window.
export function cleanupRaw(app) {
  const ms = app.config.rawRetentionHours * 3600 * 1000;
  const cutoff = new Date(Date.now() - ms).toISOString();
  app.db.run('UPDATE observations SET raw_summary = NULL WHERE observed_at < ? AND raw_summary IS NOT NULL', [cutoff]);

  const dir = app.config.debugDir;
  if (!existsSync(dir)) return;
  const now = Date.now();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    const full = join(dir, file);
    try {
      if (now - statSync(full).mtimeMs > ms) unlinkSync(full);
    } catch { /* best-effort */ }
  }
}

export { pipelineOpts };
