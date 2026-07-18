#!/usr/bin/env node
import { createApp } from '../src/app.js';
import { startWebServer } from '../src/web/server.js';
import { logger } from '../src/util/logger.js';

const app = createApp();
const server = await startWebServer(app.db, { ...app.config.web, appConfig: app.config, secretStore: app.secretStore });

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(`received ${signal}, closing web server…`);
  server.close(() => {
    try { app.db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  // Failsafe if connections keep the server open.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
