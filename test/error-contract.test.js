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

// BT-UX-002 requires the code and version to reach the Issue Form prefilled. Every report link
// pointed at /issues/new/choose with title= and body=, and an Issue Form has no free-form body:
// every field is addressed by its own id, so body= binds to nothing. Verified against the live
// form - the old link filled the title and left 錯誤代碼 and App 版本 empty, which are exactly the
// two fields the criterion is about.
//
// Asserting the parameter names against the form's real ids is what makes this stay fixed:
// renaming a field in bug_report.yml now fails here rather than silently dropping the prefill.
function issueFormFieldIds() {
  const form = readFileSync(new URL('../.github/ISSUE_TEMPLATE/bug_report.yml', import.meta.url), 'utf8');
  return new Set([...form.matchAll(/^\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1]));
}

test('the report link prefills fields the Issue Form actually defines', () => {
  const ids = issueFormFieldIds();
  assert.ok(ids.has('error_code') && ids.has('app_version'), 'the form must still expose the fields worth prefilling');

  const envelope = errorEnvelope(trackerError('BT-LCH-003'), {
    appVersion: '1.0.0', supportRef: 'safe-ref', timestamp: '2026-07-29T00:00:00.000Z',
  });
  const url = new URL(issueReportUrl(envelope));

  assert.equal(url.pathname, '/yedongsian/beyblade-tracker/issues/new', 'link straight at the template, not the picker');
  assert.equal(url.searchParams.get('template'), 'bug_report.yml');
  assert.equal(url.searchParams.get('error_code'), 'BT-LCH-003');
  assert.equal(url.searchParams.get('app_version'), '1.0.0');
  assert.equal(url.searchParams.get('body'), null, 'an Issue Form silently discards body=');

  for (const name of url.searchParams.keys()) {
    if (name === 'template' || name === 'title') continue;
    assert.ok(ids.has(name), `${name} is not a field id in bug_report.yml, so it would be ignored`);
  }
});

test('every report entry point uses the same prefill contract', () => {
  // The launcher builds its URL in PowerShell and the Web dialog in emitted JavaScript, so neither
  // can share the registry helper. They can still be held to the same shape.
  const sources = {
    'launcher.ps1': readFileSync(new URL('../release/windows/launcher.ps1', import.meta.url)).subarray(3).toString('utf8'),
    'ui.js': readFileSync(new URL('../src/web/ui.js', import.meta.url), 'utf8'),
  };
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /issues\/new\?/, `${name} must target the template, not the picker`);
    assert.doesNotMatch(source, /issues\/new\/choose\?/, `${name} still links to the picker`);
    // One builds the query as a literal string, the other through URLSearchParams, so match the
    // parameter name and value rather than a particular serialisation of them.
    assert.match(source, /template[=:]\s*'?bug_report\.yml'?/, `${name} must name the template`);
    assert.match(source, /error_code/, `${name} must prefill the error code`);
    assert.match(source, /app_version/, `${name} must prefill the app version`);
  }
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

// Found during the 2026-08-11 acceptance run: double-clicking "check now" produced a BT-LCH-999
// "unexpected internal error" dialog. A cooldown is a designed outcome with a known remedy, and the
// throw site already carried a clear, localized sentence - the envelope discarded it and told the
// user something untrue. First slice of BT-API-001.
test('a cooldown is reported as its own condition, not an unexpected internal error', () => {
  const cooldown = new Error('立即重新檢查仍在冷卻中，請 47 秒後再試。');
  cooldown.code = 'BT-SRC-003';
  cooldown.retryAfterSeconds = 47;

  assert.equal(errorCodeFor(cooldown), 'BT-SRC-003');
  const envelope = errorEnvelope(cooldown, { appVersion: '1.0.0', supportRef: 'ref', timestamp: '2026-08-11T00:00:00.000Z' });
  assert.equal(envelope.code, 'BT-SRC-003');
  assert.notEqual(envelope.title, ERROR_REGISTRY['BT-LCH-999'].title);
  assert.ok(envelope.recovery.length > 0, 'the user must be told what to do about it');
  // The thrown sentence names a specific remaining time, so it must not become the public contract.
  assert.doesNotMatch(JSON.stringify(envelope), /47/);
});

test('the cooldown reaches the API as a conflict rather than a bad request', () => {
  const source = readFileSync(new URL('../src/web/server.js', import.meta.url), 'utf8');
  assert.match(source, /envelope\.code === 'BT-SRC-003' \? 409/);
  const monitor = readFileSync(new URL('../src/core/monitor.js', import.meta.url), 'utf8');
  assert.match(monitor, /error\.code = 'BT-SRC-003'/, 'the code belongs at the throw site, not in a message regex');
});
