#!/usr/bin/env node
import { createApp, runOnce } from '../src/app.js';
import { logger } from '../src/util/logger.js';

const app = createApp();

function shutdown() {
  try { app.db.close(); } catch { /* ignore */ }
}

try {
  const onlyKey = process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1]
    : undefined;
  const result = await runOnce(app, { onlyKey });
  logger.info(`crawl:once done — sources=${result.sources} ok=${result.ok} failed=${result.failed} ` +
    `items=${result.itemsSeen} events=${result.eventsCreated}`);
  shutdown();
  process.exit(0);
} catch (err) {
  logger.error(`crawl:once fatal: ${err.message}`);
  shutdown();
  process.exit(1);
}
