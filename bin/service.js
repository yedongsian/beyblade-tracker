#!/usr/bin/env node
import {
  existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, recoverInterruptedWork, runOnce, syncSources } from '../src/app.js';
import { schedulerDelaySeconds } from '../src/core/monitor.js';
import { startWebServer } from '../src/web/server.js';
import { logger } from '../src/util/logger.js';
import { projectPaths } from '../src/paths.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const PATHS = projectPaths(ROOT);
const PID_FILE = PATHS.pidFile;
const STATUS_FILE = PATHS.statusFile;
const STOP_FILE = PATHS.stopFile;

mkdirSync(PATHS.runtimeDir, { recursive: true });

let app;
let server;
let nextTimer;
let stopPoll;
let tickInProgress = false;
let stopping = false;
let finishing = false;
const startedAt = new Date().toISOString();

function writeStatus(patch) {
  let previous = {};
  try { previous = JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { /* first write */ }
  writeFileSync(STATUS_FILE, JSON.stringify({
    ...previous,
    service: 'beyblade-tracker',
    pid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    ...patch,
  }, null, 2));
}

function clearOwnPid() {
  try {
    if (Number(readFileSync(PID_FILE, 'utf8').trim()) === process.pid) unlinkSync(PID_FILE);
  } catch { /* already gone */ }
}

async function finishShutdown(reason) {
  if (finishing) return;
  finishing = true;
  if (nextTimer) clearTimeout(nextTimer);
  if (stopPoll) clearInterval(stopPoll);
  logger.info(`service shutting down: ${reason}`);
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
  } catch { /* best effort */ }
  try { app?.db.close(); } catch { /* best effort */ }
  try { unlinkSync(STOP_FILE); } catch { /* absent */ }
  clearOwnPid();
  writeStatus({ status: 'stopped', pid: null, stoppedAt: new Date().toISOString(), reason });
  process.exit(0);
}

function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  if (nextTimer) clearTimeout(nextTimer);
  writeStatus({ status: 'stopping', reason });
  if (!tickInProgress) finishShutdown(reason);
}

function scheduleNext() {
  if (stopping) return;
  const seconds = schedulerDelaySeconds(app.db);
  logger.info(`next crawl in ${seconds}s`);
  writeStatus({ status: 'running', nextCrawlAt: new Date(Date.now() + seconds * 1000).toISOString() });
  nextTimer = setTimeout(tick, seconds * 1000);
}

function wakeMonitor() {
  if (stopping || tickInProgress) return;
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = setTimeout(tick, 25);
}

async function tick() {
  if (stopping) return;
  tickInProgress = true;
  writeStatus({ status: 'running', crawlStatus: 'running', lastCrawlStartedAt: new Date().toISOString() });
  try {
    const result = await runOnce(app, { dueOnly: true });
    writeStatus({
      status: 'running', crawlStatus: 'idle', lastCrawlFinishedAt: new Date().toISOString(),
      lastCrawlResult: result,
    });
  } catch (err) {
    logger.error(`service crawl failed: ${err.message}`);
    writeStatus({ status: 'running', crawlStatus: 'error', lastCrawlError: err.message });
  } finally {
    tickInProgress = false;
    if (stopping) await finishShutdown('stop requested');
    else scheduleNext();
  }
}

async function main() {
  writeFileSync(PID_FILE, String(process.pid));
  try { unlinkSync(STOP_FILE); } catch { /* absent */ }
  writeStatus({ status: 'starting', webUrl: null, stoppedAt: null, reason: null, error: null });

  try {
    app = createApp();
    const recovered = recoverInterruptedWork(app);
    if (recovered) logger.warn(`已復原 ${recovered} 個上次未完成的掃描工作。`);
    syncSources(app);
    server = await startWebServer(app.db, {
      ...app.config.web, appConfig: app.config, onMonitorRequested: wakeMonitor,
    });
    writeStatus({ status: 'running', webUrl: `http://${app.config.web.host}:${app.config.web.port}` });
    stopPoll = setInterval(() => {
      if (existsSync(STOP_FILE)) requestStop('stop.request');
    }, 500);
    tick();
  } catch (err) {
    logger.error(`service failed to start: ${err.message}`);
    clearOwnPid();
    writeStatus({ status: 'error', pid: null, error: err.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error(`uncaught exception: ${err.message}`);
  requestStop('uncaughtException');
});
process.on('unhandledRejection', (err) => {
  logger.error(`unhandled rejection: ${err?.message || err}`);
  requestStop('unhandledRejection');
});

main();
