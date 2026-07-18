#!/usr/bin/env node
import { createApp, recoverInterruptedWork, runOnce, syncSources } from '../src/app.js';
import { logger } from '../src/util/logger.js';
import { schedulerDelaySeconds } from '../src/core/monitor.js';
import { getNetworkState } from '../src/core/network-control.js';

const app = createApp();
const dev = process.argv.includes('--dev');

let stopping = false;
let timer = null;

async function tick() {
  if (stopping) return;
  try {
    // Production respects each source's own interval. Development mode is an
    // explicit 30-second loop for quickly replaying fixtures.
    await runOnce(app, { dueOnly: !dev });
  } catch (err) {
    logger.error(`worker tick failed: ${err.message}`);
  }
  if (stopping) return;
  const seconds = dev ? 30 : (getNetworkState(app.db, app.config).enabled ? schedulerDelaySeconds(app.db) : 60);
  logger.info(`next crawl in ${seconds}s`);
  timer = setTimeout(tick, seconds * 1000);
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(`received ${signal}, shutting down…`);
  if (timer) clearTimeout(timer);
  try { app.db.close(); } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

syncSources(app);
const recovered = recoverInterruptedWork(app);
if (recovered) logger.warn(`已復原 ${recovered} 個上次未完成的掃描工作。`);
logger.info(`worker started${dev ? ' (dev)' : ''}. Ctrl+C to stop.`);
tick();
