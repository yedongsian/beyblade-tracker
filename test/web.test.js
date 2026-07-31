import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { createWebServer, pruneUpdateOperations, UPDATE_OPERATION_MAX_TERMINAL, UPDATE_OPERATION_TTL_MS } from '../src/web/server.js';
import { settingsScript } from '../src/web/ui.js';
import { createTranslator } from '../src/i18n.js';
import { acquireRollbackLock, canStartServiceDuringRollback, getRollbackLifecycle, releaseRollbackLock, signedPayload, writeRollbackStatus } from '../src/release/update.js';
import { confirmSource, saveOnboardingSettings } from '../src/core/source-manager.js';
import { processListing } from '../src/core/pipeline.js';
import { upsertSource } from '../src/core/store.js';
import { importOfficialItem, registerDefaultOfficialSources } from '../src/core/official.js';
import { importCommunityPost, registerDefaultCommunitySources } from '../src/core/community.js';

async function withServer(fn, options = {}) {
  const db = new Database(':memory:');
  const server = createWebServer(db, options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn({ db, base: `http://127.0.0.1:${port}` }); }
  finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
}

test('interactive Local Web App renders accessible source management', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/sources`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /lang="zh-Hant"/);
    assert.match(html, /跳到主要內容/);
    assert.match(html, /label for="source-url"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /首次設定/);
  });
});

test('Phase 7 settings UI stores privacy choices and never returns Telegram plaintext', async () => {
  let saved = null;
  const secretStore = {
    status: () => ({ provider: 'windows-dpapi-current-user', telegram: { configured: true } }),
    saveTelegram: (value) => { saved = value; return { telegram: { configured: true } }; },
    clearTelegram: () => ({ telegram: { configured: false } }),
    readNotifications: () => ({ telegram: { token: 'hidden-token', chatId: 'hidden-chat' } }),
  };
  await withServer(async ({ db, base }) => {
    const pageResponse = await fetch(`${base}/settings`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /Windows DPAPI/);
    assert.match(page, /id="update-card"/);
    assert.match(page, /id="update-defer"/);
    assert.match(page, /id="update-progress"/);
    assert.match(page, /id="update-rollback"/);
    assert.doesNotMatch(page, /hidden-token|hidden-chat/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const stored = await fetch(`${base}/api/notifications/telegram`, {
      method: 'POST', headers, body: JSON.stringify({ token: 'new-token', chatId: 'new-chat', test: false }),
    });
    assert.equal(stored.status, 200);
    assert.equal(saved.token, 'new-token');
    const privacy = await fetch(`${base}/api/privacy`, {
      method: 'POST', headers, body: JSON.stringify({ privacyAccepted: true, sourcePolicyAccepted: true, diagnosticsConsent: false }),
    });
    assert.equal(privacy.status, 200);
    assert.equal(db.get("SELECT value_json FROM user_settings WHERE key='privacyAccepted'").value_json, 'true');
    assert.equal((await fetch(`${base}/privacy`)).status, 200);
    assert.equal((await fetch(`${base}/source-policy`)).status, 200);
    db.run(`INSERT INTO user_settings (key,value_json,updated_at) VALUES ('language','"en"','x') ON CONFLICT(key) DO UPDATE SET value_json='"en"'`);
    const english = await (await fetch(`${base}/settings`)).text();
    assert.match(english, /Version update/);
    assert.doesNotMatch(english, /版本更新/);
    db.run(`UPDATE user_settings SET value_json='"ja"' WHERE key='language'`);
    const japanese = await (await fetch(`${base}/settings`)).text();
    assert.match(japanese, /バージョン更新/);
  }, { secretStore, appConfig: { browser: { available: false, downloadUrl: 'https://www.google.com/chrome/' }, update: {} } });
});

test('Operations page and API expose only local safe metrics and both parser rates', async () => {
  await withServer(async ({ db, base }) => {
    db.run(`INSERT INTO operation_events
      (correlation_id,component,operation,source_key,status,duration_ms,error_class,created_at)
      VALUES ('corr','source','monitor','fixture','failed',12,'timeout','2026-07-30T00:00:00.000Z')`);
    db.run(`INSERT INTO operation_events
      (correlation_id,component,operation,status,valid_count,page_count,page_failed_count,created_at)
      VALUES ('parser','parser','extract','success',1,100,99,'2026-07-30T00:00:00.000Z')`);
    const page = await (await fetch(`${base}/operations`)).text();
    assert.match(page, /運維狀態/);
    const metrics = await (await fetch(`${base}/api/operations`)).json();
    assert.equal(metrics.components.source.failed, 1);
    assert.equal(metrics.parserItemFailureRate, 0);
    assert.equal(metrics.parserPageFailureRate, 0.99);
    assert.match(page, /商品失敗率/);
    assert.match(page, /頁面失敗率/);
    assert.match(page, /99\.0%/);
    assert.equal(metrics.recentEvents.find((event) => event.component === 'source').error_class, 'timeout');
    assert.doesNotMatch(JSON.stringify(metrics), /https?:\/\//);
  });
});

test('update rollback endpoint queues a safe service handoff instead of restoring while the web service is live', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-endpoint-'));
  const rollbackStatusFile = join(root, 'runtime', 'rollback-status.json');
  const handoffStartedAt = '2026-07-31T00:00:00.000Z';
  let requested = 0;
  try {
    await withServer(async ({ db, base }) => {
    db.run(`INSERT INTO user_settings (key,value_json,updated_at) VALUES ('updateLatestResult',?,?)`, [
      JSON.stringify({ updateAvailable: true, manifest: { version: '1.1.0', publisher: 'Beyblade Tracker', releaseNotes: 'verified', publishedAt: '2026-07-29T00:00:00.000Z', size: 42, manifestDigest: 'safe-digest' } }),
      '2026-07-29T00:00:00.000Z',
    ]);
    db.run(`INSERT INTO user_settings (key,value_json,updated_at) VALUES ('updateDeferred',?,?)`, [
      JSON.stringify({ targetVersion: '1.1.0', manifestDigest: 'safe-digest' }), '2026-07-29T00:00:00.000Z',
    ]);
    const page = await (await fetch(`${base}/settings`)).text();
    assert.match(page, /data-scheduled-update="[^"]*1\.1\.0/);
    assert.match(page, /id="update-apply"[^>]*hidden/);
    assert.match(page, /id="update-defer"[^>]*hidden/);
    assert.doesNotMatch(page, /id="update-resume"[^>]*hidden/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const resumed = await fetch(`${base}/api/update/resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).resumed, true);
    const resumedPage = await (await fetch(`${base}/settings`)).text();
    assert.doesNotMatch(resumedPage, /id="update-apply"[^>]*hidden/);
    assert.doesNotMatch(resumedPage, /id="update-defer"[^>]*hidden/);
    const result = await fetch(`${base}/api/update/rollback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
    });
    assert.equal(result.status, 202);
    assert.deepEqual(await result.json(), { accepted: true, message: 'Rollback handoff accepted.' });
    assert.equal(db.get("SELECT id FROM operation_events WHERE operation='rollback_accepted'"), undefined);
    const lifecycle = JSON.parse(readFileSync(rollbackStatusFile, 'utf8'));
    assert.equal(lifecycle.status, 'accepted');
    assert.match(lifecycle.correlationId, /^[A-Za-z0-9_-]+$/);
  }, {
      appConfig: { update: { rollbackStatusFile } },
      rollbackHandoffOwner: {
        pid: 4242, executablePath: 'C:\\Tracker\\runtime\\node.exe',
        runnerFile: 'C:\\Tracker\\bin\\service.js', startedAt: handoffStartedAt,
      },
      onRollbackRequested: ({ lock }) => {
        requested += 1;
        assert.equal(JSON.parse(readFileSync(rollbackStatusFile, 'utf8')).status, 'accepted');
        assert.equal(lock.owner.startedAt, handoffStartedAt);
        releaseRollbackLock(lock);
        return true;
      },
    });
    assert.equal(requested, 1);

    const parallelStatusFile = join(root, 'runtime', 'parallel-rollback-status.json');
    let releaseFirst;
    let firstEntered;
    const firstEnteredPromise = new Promise((resolve) => { firstEntered = resolve; });
    const firstReleasePromise = new Promise((resolve) => { releaseFirst = resolve; });
    let parallelCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
      const first = fetch(`${base}/api/update/rollback`, { method: 'POST', headers, body: '{}' });
      await firstEnteredPromise;
      const beforeSecond = JSON.parse(readFileSync(parallelStatusFile, 'utf8'));
      const second = await fetch(`${base}/api/update/rollback`, { method: 'POST', headers, body: '{}' });
      assert.equal(second.status, 400);
      assert.equal((await second.json()).error.code, 'BT-UPD-007');
      assert.equal(parallelCallbacks, 1);
      const afterSecond = JSON.parse(readFileSync(parallelStatusFile, 'utf8'));
      assert.deepEqual(afterSecond.events, beforeSecond.events);
      releaseFirst();
      assert.equal((await first).status, 202);
    }, {
      appConfig: { update: { rollbackStatusFile: parallelStatusFile } },
      onRollbackRequested: async ({ lock }) => {
        parallelCallbacks += 1;
        firstEntered();
        await firstReleasePromise;
        releaseRollbackLock(lock);
        return true;
      },
    });

    const runningStatusFile = join(root, 'runtime', 'fresh-running-status.json');
    const runningConfig = { update: { rollbackStatusFile: runningStatusFile } };
    const freshAt = new Date().toISOString();
    writeRollbackStatus(runningConfig, { status: 'accepted', phase: 'accepted', correlationId: 'fresh-running-correlation', requestedAt: freshAt, at: freshAt });
    writeRollbackStatus(runningConfig, { status: 'running', phase: 'running', startedAt: freshAt, at: freshAt });
    const runningBefore = getRollbackLifecycle(runningConfig);
    let runningCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const rejected = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'BT-UPD-007');
      assert.equal(runningCallbacks, 0);
      assert.deepEqual(getRollbackLifecycle(runningConfig), runningBefore);
    }, {
      appConfig: runningConfig,
      onRollbackRequested: () => { runningCallbacks += 1; return true; },
    });

    const staleStatusFile = join(root, 'runtime', 'stale-status.json');
    const staleOwnerStatusFile = join(root, 'runtime', 'stale-owner-status.json');
    const staleConfig = { statusFile: staleOwnerStatusFile, update: { rollbackStatusFile: staleStatusFile } };
    writeRollbackStatus(staleConfig, {
      status: 'accepted', phase: 'accepted', correlationId: 'stale-correlation',
      requestedAt: '2026-01-01T00:00:00.000Z', at: '2026-01-01T00:00:00.000Z',
    });
    writeFileSync(staleOwnerStatusFile, JSON.stringify({
      service: 'beyblade-tracker', pid: 4242, status: 'stopping', rollbackRequested: true,
      executablePath: 'C:\\Tracker\\runtime\\node.exe', serviceFile: 'C:\\Tracker\\bin\\service.js',
      startedAt: '2026-01-01T00:00:10.000Z',
    }));
    const ownedService = {
      processId: 4242, executablePath: 'C:\\Tracker\\runtime\\node.exe',
      commandLine: '"C:\\Tracker\\runtime\\node.exe" --no-warnings "C:\\Tracker\\bin\\service.js"',
      createdAt: '2026-01-01T00:00:03.000Z',
    };
    const ownedStaleBefore = getRollbackLifecycle(staleConfig);
    let ownedStaleCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const rejected = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'BT-UPD-007');
      assert.equal(ownedStaleCallbacks, 0);
      assert.deepEqual(getRollbackLifecycle(staleConfig), ownedStaleBefore);
    }, {
      appConfig: staleConfig,
      inspectRollbackProcess: () => ownedService,
      onRollbackRequested: () => { ownedStaleCallbacks += 1; return true; },
    });
    let staleCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const retried = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(retried.status, 202);
      assert.equal(staleCallbacks, 1);
      const staleEvents = getRollbackLifecycle(staleConfig);
      assert.deepEqual(staleEvents.map((event) => event.phase), ['accepted', 'failed', 'accepted']);
      assert.equal(staleEvents[0].correlationId, staleEvents[1].correlationId);
      assert.notEqual(staleEvents[1].correlationId, staleEvents[2].correlationId);
      assert.equal(staleEvents[1].errorCode, 'BT-UPD-007');
    }, {
      appConfig: staleConfig,
      inspectRollbackProcess: () => ({ ...ownedService, executablePath: 'C:\\Other\\node.exe' }),
      onRollbackRequested: ({ lock }) => { staleCallbacks += 1; releaseRollbackLock(lock); return true; },
    });

    const unknownStatusFile = join(root, 'runtime', 'unknown-owner-status.json');
    const unknownConfig = { statusFile: staleOwnerStatusFile, update: { rollbackStatusFile: unknownStatusFile } };
    writeRollbackStatus(unknownConfig, {
      status: 'accepted', phase: 'accepted', correlationId: 'unknown-owner-correlation',
      requestedAt: '2026-01-01T00:00:00.000Z', at: '2026-01-01T00:00:00.000Z',
    });
    let unknownCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const retried = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(retried.status, 202);
      assert.equal(unknownCallbacks, 1);
    }, {
      appConfig: unknownConfig,
      inspectRollbackProcess: () => null,
      onRollbackRequested: ({ lock }) => { unknownCallbacks += 1; releaseRollbackLock(lock); return true; },
    });

    const runnerStatusFile = join(root, 'runtime', 'live-runner-status.json');
    const runnerConfig = { update: { rollbackStatusFile: runnerStatusFile } };
    const runner = {
      pid: 7331, executablePath: 'C:\\Tracker\\runtime\\node.exe', runnerFile: 'C:\\Tracker\\bin\\rollback.js',
      startedAt: '2026-01-01T00:00:10.000Z',
    };
    const runnerIdentity = {
      processId: 7331, executablePath: runner.executablePath,
      commandLine: `"${runner.executablePath}" --no-warnings "${runner.runnerFile}"`,
      createdAt: '2026-01-01T00:00:03.000Z',
    };
    writeRollbackStatus(runnerConfig, {
      status: 'accepted', phase: 'accepted', correlationId: 'live-runner-correlation',
      requestedAt: '2026-01-01T00:00:00.000Z', at: '2026-01-01T00:00:00.000Z',
    });
    writeRollbackStatus(runnerConfig, {
      status: 'running', phase: 'running', runner, startedAt: runner.startedAt, at: runner.startedAt,
    });
    assert.equal(canStartServiceDuringRollback(runnerConfig, { inspectProcess: () => runnerIdentity }), false);
    assert.equal(canStartServiceDuringRollback(runnerConfig, {
      inspectProcess: () => runnerIdentity, runnerPid: runner.pid, correlationId: 'live-runner-correlation',
    }), true);
    const liveRunnerBefore = getRollbackLifecycle(runnerConfig);
    let liveRunnerCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const rejected = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(rejected.status, 400);
      assert.equal(liveRunnerCallbacks, 0);
      assert.deepEqual(getRollbackLifecycle(runnerConfig), liveRunnerBefore);
    }, {
      appConfig: runnerConfig,
      inspectRollbackProcess: () => runnerIdentity,
      onRollbackRequested: () => { liveRunnerCallbacks += 1; return true; },
    });
    let deadRunnerCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const recovered = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(recovered.status, 202);
      assert.equal(deadRunnerCallbacks, 1);
      assert.deepEqual(getRollbackLifecycle(runnerConfig).map((event) => event.phase), ['accepted', 'running', 'failed', 'accepted']);
    }, {
      appConfig: runnerConfig,
      inspectRollbackProcess: () => null,
      onRollbackRequested: ({ lock }) => { deadRunnerCallbacks += 1; releaseRollbackLock(lock); return true; },
    });

    const lockedStaleStatusFile = join(root, 'runtime', 'locked-stale-runner.json');
    const lockedStaleConfig = { update: { rollbackStatusFile: lockedStaleStatusFile } };
    const lockedStaleAt = '2026-01-01T00:00:00.000Z';
    const lockedStaleCorrelation = 'locked-stale-runner';
    const lockedStaleRunnerFile = join(process.cwd(), 'bin', 'rollback.js');
    writeRollbackStatus(lockedStaleConfig, {
      status: 'running', phase: 'running', correlationId: lockedStaleCorrelation,
      runner: {
        pid: process.pid, executablePath: process.execPath,
        runnerFile: lockedStaleRunnerFile, startedAt: lockedStaleAt,
      },
      startedAt: lockedStaleAt, at: lockedStaleAt,
    });
    const lockedStaleLock = acquireRollbackLock(lockedStaleConfig, {
      correlationId: lockedStaleCorrelation, runnerFile: lockedStaleRunnerFile, startedAt: lockedStaleAt,
    });
    assert.ok(lockedStaleLock);
    const lockedStaleBefore = getRollbackLifecycle(lockedStaleConfig);
    let lockedStaleCallbacks = 0;
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const rejected = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'BT-UPD-007');
      assert.equal(lockedStaleCallbacks, 0);
      assert.deepEqual(getRollbackLifecycle(lockedStaleConfig), lockedStaleBefore);
    }, {
      appConfig: lockedStaleConfig,
      inspectRollbackProcess: () => null,
      onRollbackRequested: () => { lockedStaleCallbacks += 1; return true; },
    });
    releaseRollbackLock(lockedStaleLock);

    const blocked = join(root, 'blocked-sidecar');
    writeFileSync(blocked, 'not a directory');
    let blockedCallback = 0;
    await withServer(async ({ db, base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const rejected = await fetch(`${base}/api/update/rollback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: '{}',
      });
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).error.code, 'BT-UPD-007');
      assert.equal(blockedCallback, 0);
      assert.equal(db.get("SELECT error_class FROM operation_events WHERE operation='rollback_failed' ORDER BY id DESC LIMIT 1").error_class, 'BT-UPD-007');
    }, {
      appConfig: { update: { rollbackStatusFile: join(blocked, 'rollback-status.json') } },
      onRollbackRequested: () => { blockedCallback += 1; return true; },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('defer no-update and rejected rollback endpoints record failed lifecycle events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rejected-rollback-'));
  try {
    await withServer(async ({ db, base }) => {
    const page = await (await fetch(`${base}/settings`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const deferred = await fetch(`${base}/api/update/defer`, {
      method: 'POST', headers, body: JSON.stringify({ targetVersion: '1.1.0', manifestDigest: 'safe' }),
    });
    assert.notEqual(deferred.status, 200);
    const deferEvent = db.get("SELECT status,correlation_id,duration_ms,error_class FROM operation_events WHERE operation='defer' ORDER BY id DESC LIMIT 1");
    assert.equal(deferEvent.status, 'failed');
    assert.match(deferEvent.correlation_id, /^[A-Za-z0-9_-]+$/);
    assert.ok(deferEvent.duration_ms >= 0);
    assert.equal(deferEvent.error_class, 'BT-UPD-005');

    const rollback = await fetch(`${base}/api/update/rollback`, { method: 'POST', headers, body: '{}' });
    assert.notEqual(rollback.status, 202);
    const rollbackEvent = db.get("SELECT status,correlation_id,duration_ms,error_class FROM operation_events WHERE operation='rollback_failed' ORDER BY id DESC LIMIT 1");
    assert.equal(rollbackEvent.status, 'failed');
    assert.match(rollbackEvent.correlation_id, /^[A-Za-z0-9_-]+$/);
    assert.ok(rollbackEvent.duration_ms >= 0);
    assert.equal(rollbackEvent.error_class, 'BT-UPD-007');
    }, {
      appConfig: { update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } },
      onRollbackRequested: () => false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rollback failure takes priority over a stale update health failure in Settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-rollback-ui-'));
  const healthFile = join(root, 'health.json');
  const rollbackStatusFile = join(root, 'rollback-status.json');
  writeFileSync(healthFile, JSON.stringify({ status: 'failed', code: 'BT-UPD-006', rollbackOffered: true }));
  writeFileSync(rollbackStatusFile, JSON.stringify({ status: 'failed', code: 'BT-UPD-007', completedAt: '2026-07-29T00:00:00.000Z' }));
  try {
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      assert.match(page, /BT-UPD-007/);
      assert.match(page, /id="update-rollback"[^>]*hidden/);
    }, { appConfig: { update: { healthFile, rollbackStatusFile } } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual update check failure preserves the last verified result and checked timestamp', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const expected = Buffer.from('installer');
  const manifest = {
    version: '1.1.0', installerUrl: 'https://updates.example.test/setup.exe', sha256: createHash('sha256').update(expected).digest('hex'),
    schemaVersion: 10, channel: 'stable', publisher: 'Beyblade Tracker', releaseNotes: 'verified', publishedAt: '2026-07-29T00:00:00.000Z', size: expected.length, publishReady: true,
  };
  manifest.signature = sign(null, signedPayload(manifest), privateKey).toString('base64');
  const originalFetch = globalThis.fetch;
  let online = true;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (!online) throw new Error('offline');
    return new Response(JSON.stringify(manifest));
  };
  try {
    await withServer(async ({ base }) => {
      const first = await fetch(`${base}/api/update`);
      assert.equal(first.status, 200);
      const verified = await (await fetch(`${base}/api/update/status`)).json();
      online = false;
      const failed = await fetch(`${base}/api/update`);
      assert.equal(failed.status, 400);
      assert.equal((await failed.json()).error.code, 'BT-UPD-002');
      const preserved = await (await fetch(`${base}/api/update/status`)).json();
      assert.deepEqual(preserved.state, verified.state);
    }, { appConfig: { network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey } } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('update apply keeps one download and installer operation in flight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-flight-'));
  const dbPath = join(root, 'data', 'tracker.db');
  mkdirSync(join(root, 'data'), { recursive: true });
  new Database(dbPath).close();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const expected = Buffer.from('expected installer');
  const manifest = {
    version: '1.1.0', installerUrl: 'https://updates.example.test/setup.exe', sha256: createHash('sha256').update(expected).digest('hex'),
    schemaVersion: 10, channel: 'stable', publisher: 'Beyblade Tracker', releaseNotes: 'verified', publishedAt: '2026-07-29T00:00:00.000Z', size: expected.length, publishReady: true,
  };
  manifest.signature = sign(null, signedPayload(manifest), privateKey).toString('base64');
  const originalFetch = globalThis.fetch;
  let manifestRequests = 0;
  let releaseManifest;
  let installerRequests = 0;
  let releaseInstaller;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    if (String(url).includes('manifest')) {
      manifestRequests += 1;
      return new Promise((resolve) => { releaseManifest = () => resolve(new Response(JSON.stringify(manifest))); });
    }
    installerRequests += 1;
    return new Promise((resolve) => { releaseInstaller = resolve; });
  };
  try {
    await withServer(async ({ base }) => {
      const page = await (await fetch(`${base}/settings`)).text();
      const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
      const body = JSON.stringify({ confirmed: true, targetVersion: manifest.version, manifestDigest: createHash('sha256').update(signedPayload(manifest)).digest('hex') });
      const first = await fetch(`${base}/api/update/apply`, { method: 'POST', headers, body });
      const firstResult = await first.json();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const second = await fetch(`${base}/api/update/apply`, { method: 'POST', headers, body });
      const secondResult = await second.json();
      assert.equal(second.status, 202);
      assert.equal(secondResult.inProgress, true);
      assert.equal(secondResult.operationId, firstResult.operationId);
      assert.equal(manifestRequests, 1);
      assert.equal(installerRequests, 0);
      const checking = await (await fetch(`${base}/api/update/status`)).json();
      assert.deepEqual(checking.operation, { id: firstResult.operationId, targetVersion: manifest.version, phase: 'checking', received: 0, total: 0 });
      releaseManifest();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(installerRequests, 1);
      const status = await (await fetch(`${base}/api/update/status`)).json();
      assert.deepEqual(status.operation, { id: firstResult.operationId, targetVersion: manifest.version, phase: 'downloading', received: 0, total: expected.length });
      const reloaded = await (await fetch(`${base}/settings`)).text();
      assert.match(reloaded, new RegExp(firstResult.operationId));
      assert.doesNotMatch(JSON.stringify(status.operation), /setup\.exe|releases|backups/);
      releaseInstaller(new Response(Buffer.from('tampered installer'), { headers: { 'content-length': String(expected.length) } }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal((await (await fetch(`${base}/api/update/status`)).json()).operation, null);
    }, { appConfig: {
      dbPath, releaseDir: join(root, 'releases'), installRoot: join(root, 'program'), backup: { dir: join(root, 'backups') }, network: { enabled: true },
      update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey, rollbackFile: join(root, 'runtime', 'rollback.json'), healthFile: join(root, 'runtime', 'health.json') },
    } });
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test('update operation retention preserves active work and bounds terminal history', () => {
  const now = 1_000_000;
  const operations = new Map([
    ['active', { id: 'active', phase: 'checking' }],
    ['expired', { id: 'expired', phase: 'failed', completedAt: now - UPDATE_OPERATION_TTL_MS }],
    ...Array.from({ length: UPDATE_OPERATION_MAX_TERMINAL + 2 }, (_, index) => [
      `terminal-${index}`, { id: `terminal-${index}`, phase: 'completed', completedAt: now - index },
    ]),
  ]);
  pruneUpdateOperations(operations, now);
  assert.equal(operations.has('active'), true);
  assert.equal(operations.has('expired'), false);
  assert.equal(operations.size, UPDATE_OPERATION_MAX_TERMINAL + 1);
  assert.equal(operations.has(`terminal-${UPDATE_OPERATION_MAX_TERMINAL + 1}`), false);
});

test('Settings update polling presents checking as an indeterminate active phase in every locale', () => {
  for (const locale of ['zh-TW', 'en', 'ja']) {
    const script = settingsScript(createTranslator(locale));
    assert.match(script, /updateChecking/);
    assert.match(script, /data\.phase==='checking'/);
    assert.match(script, /updateProgress\.removeAttribute\('value'\)/);
  }
  const english = settingsScript(createTranslator('en'));
  assert.match(english, /Checking update information and the signed manifest/);
});

test('manual identity, exclusion review, and network controls are available through the local UI', async () => {
  await withServer(async ({ db, base }) => {
    const sourceA = upsertSource(db, { key: 'manual-a', name: 'Manual A', connector: 'fixture' });
    const sourceB = upsertSource(db, { key: 'manual-b', name: 'Manual B', connector: 'fixture' });
    const opts = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };
    const first = processListing(db, sourceA, { url: 'https://manual-a.example/bx-38',
      title: 'Beyblade X BX-38', availabilityRaw: 'https://schema.org/InStock' }, opts);
    processListing(db, sourceB, { url: 'https://manual-b.example/bx-38',
      title: 'Beyblade X BX-38', availabilityRaw: 'https://schema.org/InStock' }, opts);
    processListing(db, sourceA, { url: 'https://manual-a.example/used',
      title: 'Used Beyblade X BX-39', availabilityRaw: 'https://schema.org/InStock' }, opts);

    const detail = await (await fetch(`${base}/products/${first.productId}`)).text();
    assert.match(detail, /id="split-product-form"/);
    assert.match(detail, /id="merge-product-form"/);
    const token = detail.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const secondOffer = db.get('SELECT id FROM offers WHERE source_id=?', [sourceB.id]);
    const splitResponse = await fetch(`${base}/api/products/${first.productId}/split`, {
      method: 'POST', headers, body: JSON.stringify({ offerIds: [secondOffer.id], name: 'Manual split' }),
    });
    assert.equal(splitResponse.status, 201);
    const split = await splitResponse.json();
    const splitId = split.created.product.id;
    assert.equal(db.get('SELECT COUNT(*) count FROM products').count, 2);
    const merged = await fetch(`${base}/api/products/merge`, {
      method: 'POST', headers, body: JSON.stringify({ sourceProductId: splitId, targetProductId: first.productId }),
    });
    assert.equal(merged.status, 200);
    assert.equal(db.get('SELECT COUNT(*) count FROM products').count, 1);

    const exclusion = db.get('SELECT * FROM listing_exclusions');
    const exclusionsPage = await (await fetch(`${base}/exclusions`)).text();
    assert.match(exclusionsPage, /data-exclusion-action="allow"/);
    const allowed = await fetch(`${base}/api/exclusions/${exclusion.id}`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'allow', note: 'manual verification' }),
    });
    assert.equal(allowed.status, 200);
    assert.equal(db.get('SELECT review_status FROM listing_exclusions WHERE id=?', [exclusion.id]).review_status, 'allowed');

    const paused = await fetch(`${base}/api/network`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: false, reason: 'operator pause' }),
    });
    assert.equal(paused.status, 200);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.network.enabled, false);
    const blocked = await fetch(`${base}/api/sources/preview`, {
      method: 'POST', headers, body: JSON.stringify({ url: 'https://example.com' }),
    });
    assert.equal(blocked.status, 400);
    const resumed = await fetch(`${base}/api/network`, {
      method: 'PATCH', headers, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).network.enabled, true);
  });
});

test('Watchlist UI creates rules and official-source preview requires explicit confirmation', async () => {
  await withServer(async ({ db, base }) => {
    const registered = registerDefaultOfficialSources(db);
    const pageResponse = await fetch(`${base}/watchlist`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /想找清單/);
    assert.match(page, /Takara Tomy Mall/);
    assert.match(page, /第一次掃描預覽/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const created = await fetch(`${base}/api/watchlists`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'CX-99', productCode: 'CX-99', matchMode: 'exact', notificationEvents: ['in_stock'] }),
    });
    assert.equal(created.status, 201);
    assert.equal(db.get('SELECT COUNT(*) c FROM watchlists').c, 1);
    assert.equal(db.get('SELECT enabled FROM official_sources WHERE id=?', [registered.official.id]).enabled, 0);
    const confirmed = await fetch(`${base}/api/official-sources/${registered.official.id}/confirm`, {
      method: 'POST', headers, body: '{}',
    });
    assert.equal(confirmed.status, 200);
    assert.equal(db.get('SELECT enabled FROM official_sources WHERE id=?', [registered.official.id]).enabled, 1);

    importOfficialItem(db, 'takara-tomy-mall', {
      url: 'https://takaratomymall.jp/shop/g/g4904810999999/?wovn=english',
      title: 'BEYBLADE X CX-99 Future Starter', productCode: 'CX-99', eventType: 'announced',
      releaseDate: '2026-09-15', msrp: 2400, currency: 'JPY',
    });
    const catalog = await (await fetch(`${base}/catalog`)).text();
    assert.match(catalog, /官方商品情報/);
    assert.match(catalog, /CX-99/);
    assert.match(catalog, /2400 JPY/);
  });
});

test('community UI labels posts as unverified and updates source filters without enabling paid access', async () => {
  await withServer(async ({ db, base }) => {
    const source = registerDefaultCommunitySources(db);
    importCommunityPost(db, source.key, {
      id: 'web-1', url: 'https://x.com/bey_sokuhou/status/web-1',
      text: 'CX-99 再入荷の目撃情報 https://store.example/cx-99',
      created_at: '2026-07-16T03:00:00.000Z', author: 'bey_sokuhou',
    }, { acquisitionMethod: 'fixture' });
    const response = await fetch(`${base}/community`);
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.match(page, /社群貼文不是庫存或官方事實/);
    assert.match(page, /未驗證消息/);
    assert.match(page, /CX-99/);
    assert.match(page, /使用自己的 X Developer 帳戶設定/);
    assert.match(page, /繼續前請確認 X API 費用/);
    assert.match(page, /每天讀取 20 則不重複貼文/);
    assert.match(page, /href="https:\/\/console\.x\.com"/);
    assert.match(page, /id="x-console-link"[^>]+aria-disabled="true"/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const updated = await fetch(`${base}/api/community-sources/${source.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ muted: true, excludeTerms: '交換', retentionDays: 45,
        filterSensitive: true, filterSpam: true }),
    });
    assert.equal(updated.status, 200);
    const row = db.get('SELECT * FROM community_sources WHERE id=?', [source.id]);
    assert.equal(row.muted, 1);
    assert.equal(row.retention_days, 45);
    assert.equal(row.enabled, 0);
    assert.equal(row.monthly_budget_usd, 0);
  });
});

test('product detail exposes price and stock timeline, and check-now API wakes the monitor with cooldown', async () => {
  let wakes = 0;
  await withServer(async ({ db, base }) => {
    const source = upsertSource(db, {
      key: 'timeline', name: 'Timeline Store', connector: 'fixture', url: 'https://timeline.example',
    });
    const first = processListing(db, source, {
      url: 'https://timeline.example/bx-38', title: 'Beyblade X BX-38',
      availabilityRaw: 'https://schema.org/OutOfStock', price: 1200, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    processListing(db, source, {
      url: 'https://timeline.example/bx-38', title: 'Beyblade X BX-38',
      availabilityRaw: 'https://schema.org/InStock', price: 1080, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    db.run("UPDATE offers SET freshness_status='fresh',fresh_until='2099-01-01T00:00:00.000Z' WHERE source_id=?", [source.id]);
    const detail = await fetch(`${base}/products/${first.productId}`);
    const html = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(html, /價格與庫存時間線/);
    assert.match(html, /1200 JPY/);
    assert.match(html, /1080 JPY/);

    const sources = await (await fetch(`${base}/sources`)).text();
    assert.match(sources, /立即重新檢查/);
    const token = sources.match(/name="csrf-token" content="([^"]+)"/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    const queued = await fetch(`${base}/api/sources/${source.id}/check-now`, { method: 'POST', headers, body: '{}' });
    assert.equal(queued.status, 202);
    assert.equal(wakes, 1);
    const cooled = await fetch(`${base}/api/sources/${source.id}/check-now`, { method: 'POST', headers, body: '{}' });
    assert.equal(cooled.status, 400);
  }, { onMonitorRequested: () => { wakes += 1; } });
});

test('mutating API requires CSRF token and saves onboarding settings', async () => {
  await withServer(async ({ base }) => {
    const page = await (await fetch(base)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const denied = await fetch(`${base}/api/settings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(denied.status, 400);
    const accepted = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ language: 'zh-TW', notification: 'app', scanFrequency: 'balanced' }),
    });
    assert.equal(accepted.status, 200);
    const after = await (await fetch(base)).text();
    assert.doesNotMatch(after, /id="onboarding"/);
  });
});

test('source API disables by default instead of deleting history', async () => {
  await withServer(async ({ db, base }) => {
    db.run(
      `INSERT INTO sources (key,name,connector,enabled,check_interval_seconds,connector_version,
       recipe_version,managed_by,created_at,updated_at) VALUES ('safe','Safe','fixture',1,3600,'1.0.0',1,'ui','x','x')`
    );
    const page = await (await fetch(`${base}/sources`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const response = await fetch(`${base}/api/sources/1`, {
      method: 'DELETE', headers: { 'X-CSRF-Token': token },
    });
    assert.equal(response.status, 200);
    assert.equal(db.get('SELECT enabled FROM sources WHERE id=1').enabled, 0);
    assert.equal(db.get('SELECT COUNT(*) n FROM sources').n, 1);
  });
});

test('Review Queue page and batch approval API create monitored data', async () => {
  await withServer(async ({ db, base }) => {
    const added = confirmSource(db, {
      url: 'https://shop.example/category/beyblade', confirmed: true, discoveryOnly: true,
    });
    const ts = new Date().toISOString();
    const listing = {
      url: 'https://shop.example/product/beyblade-bx-38', title: 'BEYBLADE X BX-38',
      model: 'BX-38', price: 1980, currency: 'JPY', availabilityRaw: 'https://schema.org/InStock',
    };
    const id = db.run(`INSERT INTO product_candidates
      (site_id,canonical_url,title,model,price,currency,availability,confidence,reasons_json,
       discovery_method,listing_json,status,first_discovered_at,last_discovered_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'in_stock',0.95,'["型號"]','sitemap',?,'pending',?,?,?,?)`,
    [added.site.id, listing.url, listing.title, listing.model, listing.price, listing.currency,
      JSON.stringify(listing), ts, ts, ts, ts]).lastInsertRowid;
    const pageResponse = await fetch(`${base}/review`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /BX-38/);
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const reviewed = await fetch(`${base}/api/candidates/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ ids: [Number(id)], action: 'approve' }),
    });
    assert.equal(reviewed.status, 200);
    assert.equal(db.get('SELECT status FROM product_candidates WHERE id=?', [id]).status, 'approved');
    assert.equal(db.get('SELECT COUNT(*) n FROM products').n, 1);
    assert.equal(db.get('SELECT COUNT(*) n FROM offers').n, 1);
  });
});

test('discovery settings API validates and saves per-site budgets', async () => {
  await withServer(async ({ db, base }) => {
    const added = confirmSource(db, {
      url: 'https://shop.example/category/beyblade', confirmed: true, discoveryOnly: true,
    });
    const page = await (await fetch(`${base}/sources`)).text();
    const token = page.match(/name="csrf-token" content="([^"]+)"/)[1];
    const response = await fetch(`${base}/api/sites/${added.site.id}/discovery-settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ maxPages: 25, maxDepth: 1, includeTerms: 'beyblade' }),
    });
    assert.equal(response.status, 200);
    assert.equal(db.get('SELECT max_pages FROM discovery_settings WHERE site_id=?', [added.site.id]).max_pages, 25);
  });
});

test('saved UI language renders English and Japanese pages with translated states and original store wording', async () => {
  await withServer(async ({ db, base }) => {
    const source = upsertSource(db, { key: 'i18n', name: '多語商店', connector: 'fixture', url: 'https://i18n.example' });
    processListing(db, source, {
      url: 'https://i18n.example/ux-20', title: 'ベイブレードX UX-20',
      availabilityText: '在庫あり', price: 1600, currency: 'JPY',
    }, { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 });
    db.run("UPDATE offers SET freshness_status='fresh',fresh_until='2099-01-01T00:00:00.000Z' WHERE source_id=?", [source.id]);
    saveOnboardingSettings(db, { language: 'en', notification: 'app', scanFrequency: 'balanced', dataRetentionDays: 365 });
    const english = await (await fetch(`${base}/offers`)).text();
    assert.match(english, /lang="en"/);
    assert.match(english, /In stock/);
    assert.match(english, /在庫あり/);
    assert.match(english, /Store wording/);
    saveOnboardingSettings(db, { language: 'ja', notification: 'app', scanFrequency: 'balanced', dataRetentionDays: 365 });
    const japanese = await (await fetch(`${base}/catalog`)).text();
    assert.match(japanese, /lang="ja"/);
    assert.match(japanese, /商品識別/);
    assert.match(japanese, /UX-20/);
  });
});
