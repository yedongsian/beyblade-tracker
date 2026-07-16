import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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

export function createApp(overrides = {}) {
  loadEnv();
  const config = { ...getConfig(), ...overrides };
  mkdirSync(dirname(config.dbPath), { recursive: true });
  if (config.dbPath !== ':memory:' && config.backup) {
    createAutomaticBackupIfDue(config.dbPath, config.backup.dir, config.backup);
  }
  const db = openDatabase(config.dbPath);
  registerDefaultOfficialSources(db);
  registerDefaultCommunitySources(db);
  pruneExpiredCommunityPosts(db);
  backfillCatalog(db);
  const notifiers = buildNotifiers(config);
  return { db, config, notifiers };
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
} = {}) {
  const { db, config } = app;
  refreshOfferFreshness(db, { now: new Date(nowMs).toISOString() });
  const sources = listDueMonitorSources(db, {
    onlyKey, force, now: new Date(nowMs).toISOString(),
  });

  const summary = { sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0 };

  for (const source of sources) {
    summary.sources += 1;
    const source2 = { ...source, config: parseSourceConfig(db, source) };
    const runId = startCrawlRun(db, source);
    startMonitorRequests(db, source.id, new Date(nowMs).toISOString());
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
      recordCrawlSuccess(db, source.id);
      finishCrawlRun(db, runId, { status: 'success', ...stats });
      finalizeSuccessfulMonitor(db, source, {
        seenOfferIds: stats.seenOfferIds,
        terminalOfferIds: stats.terminalOfferIds,
        now: new Date(nowMs).toISOString(), random,
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
      summary.failed += 1;
      logger.warn(`source ${source.key} failed: ${err.message}`);
    }
  }

  return summary;
}

export async function runDiscoveryScheduler(app, { nowMs = Date.now() } = {}) {
  return runDueDiscoveries(app.db, {
    userAgent: app.config.http?.userAgent,
    now: new Date(nowMs).toISOString(),
  });
}

/** Run the independent offer monitor and discovery schedulers, then notify. */
export async function runOnce(app, {
  onlyKey, dueOnly = false, nowMs = Date.now(), random = Math.random,
} = {}) {
  syncSources(app);
  const summary = await runOfferMonitors(app, {
    onlyKey, force: !dueOnly, nowMs, random,
  });

  const discovery = await runDiscoveryScheduler(app, { nowMs });

  const notifyResult = await flushNotifications(app.db, app.notifiers);
  const watchlistNotify = await flushWatchlistAlerts(app.db, app.notifiers);
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
