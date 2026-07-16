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
import { dueSources } from './core/schedule.js';
import { buildNotifiers } from './notify/index.js';
import { flushNotifications } from './notify/queue.js';
import { recoverInterruptedDiscoveryRuns, runDueDiscoveries } from './core/discovery.js';

export function createApp(overrides = {}) {
  loadEnv();
  const config = { ...getConfig(), ...overrides };
  mkdirSync(dirname(config.dbPath), { recursive: true });
  if (config.dbPath !== ':memory:' && config.backup) {
    createAutomaticBackupIfDue(config.dbPath, config.backup.dir, config.backup);
  }
  const db = openDatabase(config.dbPath);
  const notifiers = buildNotifiers(config);
  return { db, config, notifiers };
}

// Pipeline options derived from config.
function pipelineOpts(config) {
  return {
    preorderIsPurchasable: config.preorderIsPurchasable,
    eventCooldownSeconds: config.eventCooldownSeconds,
    priceChangeThreshold: config.priceChangeThreshold,
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
export async function runOnce(app, { onlyKey, dueOnly = false, nowMs = Date.now() } = {}) {
  const { db, config } = app;
  syncSources(app);
  const opts = pipelineOpts(config);

  let sources = db.all('SELECT * FROM sources WHERE enabled = 1');
  if (onlyKey) sources = sources.filter((s) => s.key === onlyKey);
  if (dueOnly) sources = dueSources(sources, nowMs);

  const httpDeps = {
    http: config.http,
    debug: { saveHtml: config.debugHtml, dir: config.debugDir },
  };

  const summary = { sources: 0, ok: 0, failed: 0, itemsSeen: 0, eventsCreated: 0 };

  for (const source of sources) {
    summary.sources += 1;
    const source2 = { ...source, config: parseSourceConfig(db, source) };
    const runId = startCrawlRun(db, source);
    try {
      const connector = createConnector(source2, httpDeps);
      const stats = await crawlSource(db, source2, connector, opts, runId);
      recordCrawlSuccess(db, source.id);
      finishCrawlRun(db, runId, { status: 'success', ...stats });
      summary.ok += 1;
      summary.itemsSeen += stats.itemsSeen;
      summary.eventsCreated += stats.eventsCreated;
      logger.info(`source ${source.key}: ${stats.itemsSeen} items, ${stats.eventsCreated} events`);
    } catch (err) {
      recordCrawlFailure(db, source.id, err.message);
      finishCrawlRun(db, runId, { status: 'failed', error: err.message });
      summary.failed += 1;
      logger.warn(`source ${source.key} failed: ${err.message}`);
    }
  }

  const discovery = await runDueDiscoveries(db, {
    userAgent: config.http?.userAgent,
  });

  const notifyResult = await flushNotifications(db, app.notifiers);
  logger.info(
    `notifications: ${notifyResult.groups} groups, ${notifyResult.sent} sent, ` +
    `${notifyResult.skipped} skipped, ${notifyResult.failed || 0} failed`
  );

  cleanupRaw(app);
  return { ...summary, discovery, notify: notifyResult };
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
