#!/usr/bin/env node
// Standalone smoke test: start the web server, hit /health, assert JSON, exit.
import { createApp } from '../src/app.js';
import { startWebServer } from '../src/web/server.js';

const app = createApp();
const port = app.config.web.port + 1; // avoid clashing with a running web server
const server = await startWebServer(app.db, { host: '127.0.0.1', port, appConfig: app.config, secretStore: app.secretStore });

let code = 0;
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const data = await res.json();
  if (res.status !== 200) throw new Error(`unexpected status ${res.status}`);
  if (!['ok', 'degraded'].includes(data.status)) throw new Error(`unexpected health status ${data.status}`);
  if (typeof data.counts !== 'object') throw new Error('missing counts');
  console.log(`HEALTH OK: status=${data.status} products=${data.counts.products} offers=${data.counts.offers} events=${data.counts.events}`);
} catch (err) {
  console.error(`HEALTH FAIL: ${err.message}`);
  code = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  app.db.close();
  process.exitCode = code; // let the event loop drain cleanly (avoids Windows handle race)
}
