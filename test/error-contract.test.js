import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERROR_CODES, ERROR_REGISTRY, errorCodeFor, errorEnvelope, issueReportUrl, trackerError } from '../src/errors/registry.js';
import { Database } from '../src/db/database.js';
import { createWebServer } from '../src/web/server.js';

test('every published error code has a stable, deterministic registry entry', () => {
  const catalog = readFileSync(new URL('../docs/ERROR_CODES.md', import.meta.url), 'utf8');
  for (const code of ERROR_CODES) {
    assert.match(catalog, new RegExp(code));
    assert.equal(errorCodeFor(trackerError(code)), code);
    const envelope = errorEnvelope(trackerError(code), { appVersion: '1.0.0', supportRef: 'safe-ref', timestamp: '2026-07-29T00:00:00.000Z' });
    assert.equal(envelope.code, code);
    assert.equal(envelope.title, ERROR_REGISTRY[code].title);
    assert.ok(envelope.recovery.length > 0);
  }
});

test('unknown internal errors use the reserved generic code and public report URL is sanitized', () => {
  const envelope = errorEnvelope(new Error('token=very-secret C:\\private\\path stack trace'), { appVersion: '1.0.0', supportRef: 'safe-ref', timestamp: '2026-07-29T00:00:00.000Z' });
  assert.equal(envelope.code, 'BT-LCH-999');
  assert.doesNotMatch(JSON.stringify(envelope), /very-secret|private\\path|stack trace/);
  const reportUrl = issueReportUrl(envelope);
  assert.match(reportUrl, /BT-LCH-999/);
  assert.doesNotMatch(reportUrl, /very-secret|private/);
});

test('Local Web failures return a safe error envelope and render an accessible copy/report dialog', async () => {
  const db = new Database(':memory:');
  const server = createWebServer(db, { appConfig: { update: {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await (await fetch(`${base}/settings`)).text();
    assert.match(page, /id="user-error-dialog"/);
    assert.match(page, /id="user-error-copy"/);
    assert.match(page, /id="user-error-report"/);
    assert.match(page, /showModal\(\)/);
    const rejected = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(rejected.status, 400);
    const body = await rejected.json();
    assert.equal(body.error.code, 'BT-LCH-999');
    assert.equal(body.error.appVersion, '1.0.0');
    assert.match(body.error.supportRef, /^[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(JSON.stringify(body), /csrf|token|stack|path/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
