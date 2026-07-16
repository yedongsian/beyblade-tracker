#!/usr/bin/env node
// Verifies every admin route responds and renders expected content.
import { createApp } from '../src/app.js';
import { startWebServer } from '../src/web/server.js';

const app = createApp();
const port = app.config.web.port + 2;
const server = await startWebServer(app.db, { host: '127.0.0.1', port, appConfig: app.config });
const base = `http://127.0.0.1:${port}`;

const checks = [
  ['/', 200, /Beyblade Tracker/],
  ['/products', 200, /商品/],
  ['/offers', 200, /商店刊登/],
  ['/events', 200, /事件/],
  ['/sources', 200, /來源管理/],
  ['/health', 200, /"status"/],
  ['/nope', 404, /找不到頁面/],
];

let code = 0;
try {
  for (const [path, status, re] of checks) {
    const res = await fetch(base + path);
    const body = await res.text();
    const ok = res.status === status && re.test(body);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${path} -> ${res.status}`);
    if (!ok) code = 1;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  app.db.close();
  process.exitCode = code; // let the event loop drain cleanly (avoids Windows handle race)
}
