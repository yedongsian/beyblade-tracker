import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { createBackup } from '../src/maintenance/backup.js';
import { setNetworkEnabled } from '../src/core/network-control.js';
import {
  UPDATE_CHECK_INTERVAL_MS, UPDATE_RETRY_INTERVAL_MS, acquireRollbackLock, canStartServiceDuringRollback, clearDeferredUpdate, deferUpdate, finalizePostUpdateHealth, getPostUpdateHealth, getRollbackLifecycle, getRollbackStatus, getUpdateState,
  isUpdateCheckDue, launchPreparedUpdate, manifestDigest, nextUpdateCheckDelay, prepareConfirmedUpdate, recordUpdateCheck, runScheduledUpdateCheck,
  releaseRollbackLock, scheduleRecurringUpdateCheck, isDeferredUpdate, runRollbackLifecycle, writeRollbackStatus,
  signedPayload, validateUpdateConfirmation, validateUpdateManifest, checkForUpdate,
} from '../src/release/update.js';

function signedManifest(privateKey, bytes = Buffer.from('installer fixture')) {
  const manifest = {
    version: '1.1.0', installerUrl: 'https://updates.example.test/BeybladeTracker-1.1.0-Setup.exe',
    sha256: createHash('sha256').update(bytes).digest('hex'), schemaVersion: 10, channel: 'stable',
    publisher: 'Beyblade Tracker', releaseNotes: '改善更新流程', publishedAt: '2026-07-29T00:00:00.000Z', size: bytes.length, publishReady: true,
  };
  manifest.signature = sign(null, signedPayload(manifest), privateKey).toString('base64');
  return manifest;
}

test('update requires explicit confirmation bound to version and manifest digest before any download', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-consent-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const bytes = Buffer.from('installer fixture');
  const manifest = signedManifest(privateKey, bytes);
  mkdirSync(join(root, 'data'), { recursive: true });
  const db = new Database(join(root, 'data', 'tracker.db'));
  const config = {
    dbPath: join(root, 'data', 'tracker.db'), releaseDir: join(root, 'releases'), backup: { dir: join(root, 'backups') },
    update: { publicKey, rollbackFile: join(root, 'runtime', 'rollback.json'), healthFile: join(root, 'runtime', 'update-health.json') },
  };
  let downloads = 0;
  await assert.rejects(
    prepareConfirmedUpdate(db, config, manifest, { confirmed: false, targetVersion: manifest.version, manifestDigest: manifestDigest(manifest) }, {
      fetchImpl: async () => { downloads += 1; return new Response(bytes); },
    }), /BT-UPD-005/
  );
  assert.equal(downloads, 0);
  await assert.rejects(
    prepareConfirmedUpdate(db, config, manifest, { confirmed: true, targetVersion: '1.1.1', manifestDigest: manifestDigest(manifest) }, {
      fetchImpl: async () => { downloads += 1; return new Response(bytes); },
    }), /BT-UPD-003/
  );
  assert.equal(downloads, 0);
  const prepared = await prepareConfirmedUpdate(db, config, manifest, {
    confirmed: true, targetVersion: manifest.version, manifestDigest: manifestDigest(manifest),
  }, { fetchImpl: async () => { downloads += 1; return new Response(bytes, { headers: { 'content-length': String(bytes.length) } }); } });
  assert.equal(downloads, 1);
  assert.equal(existsSync(prepared.installer), true);
  assert.equal(existsSync(config.update.rollbackFile), true);
  assert.equal(JSON.parse(readFileSync(config.update.healthFile, 'utf8')).status, 'pending');
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('stable update checks defer only the verified manifest and run no more than once per 24 hours', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = signedManifest(privateKey);
  const db = new Database(':memory:');
  const checked = validateUpdateManifest(manifest, { publicKey });
  const deferred = deferUpdate(db, { targetVersion: checked.version, manifestDigest: checked.manifestDigest }, checked, { now: '2026-07-29T00:00:00.000Z' });
  assert.equal(deferred.targetVersion, '1.1.0');
  assert.equal(getUpdateState(db).deferred.manifestDigest, checked.manifestDigest);
  assert.equal(isDeferredUpdate(getUpdateState(db), checked), true);
  clearDeferredUpdate(db);
  assert.equal(isDeferredUpdate(getUpdateState(db), checked), false);
  deferUpdate(db, { targetVersion: checked.version, manifestDigest: checked.manifestDigest }, checked, { now: '2026-07-29T00:00:00.000Z' });
  assert.equal(isUpdateCheckDue(db, { now: Date.parse('2026-07-29T00:00:00.000Z') }), true);
  let requests = 0;
  const config = { network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey } };
  await runScheduledUpdateCheck(db, config, { fetchImpl: async () => { requests += 1; return new Response(JSON.stringify(manifest)); }, now: Date.parse('2026-07-29T00:00:00.000Z') });
  assert.equal(requests, 1);
  assert.deepEqual(getUpdateState(db).latestResult.manifest, {
    version: manifest.version, publisher: manifest.publisher, releaseNotes: manifest.releaseNotes,
    publishedAt: manifest.publishedAt, size: manifest.size, manifestDigest: manifestDigest(manifest),
  });
  assert.equal(isUpdateCheckDue(db, { now: Date.parse('2026-07-29T00:00:00.000Z') + UPDATE_CHECK_INTERVAL_MS - 1 }), false);
  await runScheduledUpdateCheck(db, config, { fetchImpl: async () => { requests += 1; return new Response(JSON.stringify(manifest)); }, now: Date.parse('2026-07-29T00:00:00.000Z') + UPDATE_CHECK_INTERVAL_MS - 1 });
  assert.equal(requests, 1);
  const preserved = getUpdateState(db);
  await assert.rejects(runScheduledUpdateCheck(db, config, {
    fetchImpl: async () => { throw new Error('offline'); }, now: Date.parse('2026-07-30T00:00:00.000Z'),
  }), /BT-UPD-002/);
  assert.deepEqual(getUpdateState(db), preserved);
  assert.throws(() => validateUpdateConfirmation({ confirmed: true, targetVersion: manifest.version, manifestDigest: manifestDigest(manifest) }, { ...manifest, channel: 'beta' }), /BT-UPD-003/);
  db.close();
});

test('post-install health failure offers rollback and a healthy target is recorded', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-health-'));
  const config = { update: { healthFile: join(root, 'runtime', 'update-health.json') } };
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const pending = { targetVersion: '1.1.0', status: 'pending', databaseBackup: 'safe-reference' };
  writeFileSync(config.update.healthFile, JSON.stringify(pending));
  const failed = finalizePostUpdateHealth(config, { currentVersion: '1.0.0', integrity: 'ok' });
  assert.deepEqual({ status: failed.status, code: failed.code, rollbackOffered: failed.rollbackOffered }, { status: 'failed', code: 'BT-UPD-006', rollbackOffered: true });
  writeFileSync(config.update.healthFile, JSON.stringify(pending));
  const healthy = finalizePostUpdateHealth(config, { currentVersion: '1.1.0', integrity: 'ok' });
  assert.equal(healthy.status, 'healthy');
  const healthyAgain = finalizePostUpdateHealth(config, { currentVersion: '1.1.0', integrity: 'ok' });
  assert.deepEqual(healthyAgain, healthy);
  assert.equal(getPostUpdateHealth(config).status, 'healthy');
  writeRollbackStatus({ update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } }, { status: 'failed', code: 'BT-UPD-007', completedAt: '2026-07-29T00:00:00.000Z' });
  assert.deepEqual(getRollbackStatus({ update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } }), {
    status: 'failed', code: 'BT-UPD-007', rollbackOffered: false, targetVersion: null, version: null, checkedAt: '2026-07-29T00:00:00.000Z',
  });
  rmSync(root, { recursive: true, force: true });
});



test('no update, offline, paused network, hash mismatch, and installer launch failure stay safe', async () => {
  assert.deepEqual(await checkForUpdate({ update: {} }), { enabled: false, currentVersion: '1.0.0', updateAvailable: false });
  await assert.rejects(
    checkForUpdate({ update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey: 'unused' } }, { fetchImpl: async () => { throw new Error('offline'); } }),
    /BT-UPD-002/
  );
  const db = new Database(':memory:');
  let pausedFetches = 0;
  const pausedConfig = { network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json' } };
  setNetworkEnabled(db, false, { config: pausedConfig, reason: 'operator pause' });
  await runScheduledUpdateCheck(db, pausedConfig, {
    fetchImpl: async () => { pausedFetches += 1; throw new Error('must not fetch'); },
  });
  assert.equal(pausedFetches, 0);
  await assert.rejects(launchPreparedUpdate({ installer: 'safe-installer' }, { spawnImpl: () => { throw new Error('launch failed'); } }), /BT-UPD-005/);
  const failedChild = new EventEmitter();
  failedChild.unref = () => {};
  await assert.rejects(launchPreparedUpdate({ installer: 'safe-installer' }, {
    spawnImpl: () => { queueMicrotask(() => failedChild.emit('error', new Error('ENOENT'))); return failedChild; },
  }), /BT-UPD-005/);
  const installedChild = new EventEmitter();
  installedChild.unref = () => {};
  const installed = launchPreparedUpdate({ installer: 'safe-installer' }, {
    spawnImpl: () => { queueMicrotask(() => { installedChild.emit('spawn'); installedChild.emit('close', 0); }); return installedChild; },
  });
  assert.deepEqual(await installed, { launched: true, installed: true });
  const failedInstaller = new EventEmitter();
  await assert.rejects(launchPreparedUpdate({ installer: 'safe-installer' }, {
    spawnImpl: () => { queueMicrotask(() => { failedInstaller.emit('spawn'); failedInstaller.emit('close', 1); }); return failedInstaller; },
  }), /BT-UPD-005/);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = signedManifest(privateKey, Buffer.from('expected installer'));
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-hash-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  const config = { dbPath: join(root, 'data', 'tracker.db'), releaseDir: join(root, 'releases'), backup: { dir: join(root, 'backups') }, update: { publicKey, rollbackFile: join(root, 'runtime', 'rollback.json') } };
  const fileDb = new Database(config.dbPath);
  await assert.rejects(prepareConfirmedUpdate(fileDb, config, manifest, {
    confirmed: true, targetVersion: manifest.version, manifestDigest: manifestDigest(manifest),
  }, { fetchImpl: async () => new Response(Buffer.from('tampered installer')) }), /BT-UPD-004/);
  fileDb.close(); db.close(); rmSync(root, { recursive: true, force: true });
});

test('unpublished, malformed, and invalid-key manifests return validation errors rather than network errors', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = signedManifest(privateKey);
  assert.throws(() => validateUpdateManifest({ ...manifest, publishReady: false }, { publicKey }), /BT-UPD-003/);
  await assert.rejects(checkForUpdate({ update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey } }, {
    fetchImpl: async () => new Response('{not-json'),
  }), /BT-UPD-003/);
  await assert.rejects(checkForUpdate({ update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey: 'not-a-key' } }, {
    fetchImpl: async () => new Response(JSON.stringify(manifest)),
  }), /BT-UPD-003/);
});

test('recurring scheduler waits five seconds, persists a verified result, then runs every 24 hours', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const manifest = signedManifest(privateKey);
  const db = new Database(':memory:');
  const timers = [];
  let results = 0;
  const stop = scheduleRecurringUpdateCheck(db, {
    network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey },
  }, {
    setTimeoutImpl: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
    fetchImpl: async () => new Response(JSON.stringify(manifest)),
    onResult: (result) => { if (result?.updateAvailable) results += 1; },
  });
  assert.equal(timers[0].delay, 5000);
  await timers.shift().fn();
  assert.equal(results, 1);
  assert.equal(getUpdateState(db).latestResult.updateAvailable, true);
  assert.ok(timers[0].delay <= UPDATE_CHECK_INTERVAL_MS);
  assert.ok(timers[0].delay > UPDATE_CHECK_INTERVAL_MS - 1000);
  stop();
  assert.equal(timers[0].cleared, true);
  db.close();
});

test('recurring scheduler retries temporary failures without replacing a verified result', async () => {
  const db = new Database(':memory:');
  const timers = [];
  const stop = scheduleRecurringUpdateCheck(db, {
    network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json', publicKey: 'unused' },
  }, {
    setTimeoutImpl: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await timers.shift().fn();
  assert.equal(timers[0].delay, UPDATE_RETRY_INTERVAL_MS);
  stop();
  db.close();
});

test('preparing an update preserves rollback failure status until every preparation step succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-update-rollback-reset-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const bytes = Buffer.from('installer fixture');
  const manifest = signedManifest(privateKey, bytes);
  mkdirSync(join(root, 'data'), { recursive: true });
  const db = new Database(join(root, 'data', 'tracker.db'));
  const config = {
    dbPath: join(root, 'data', 'tracker.db'), releaseDir: join(root, 'releases'), backup: { dir: join(root, 'backups') },
    update: { publicKey, rollbackFile: join(root, 'runtime', 'rollback.json'), healthFile: join(root, 'runtime', 'update-health.json'), rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') },
  };
  writeRollbackStatus(config, { status: 'failed', code: 'BT-UPD-007', completedAt: '2026-07-29T00:00:00.000Z' });
  const confirmation = { confirmed: true, targetVersion: manifest.version, manifestDigest: manifestDigest(manifest) };
  await assert.rejects(prepareConfirmedUpdate(db, config, manifest, confirmation, {
    fetchImpl: async () => { throw new Error('offline'); },
  }), /BT-UPD-005/);
  assert.equal(getRollbackStatus(config).code, 'BT-UPD-007');
  await assert.rejects(prepareConfirmedUpdate(db, config, manifest, confirmation, {
    fetchImpl: async () => new Response(Buffer.from('tampered installer')),
  }), /BT-UPD-004/);
  assert.equal(getRollbackStatus(config).code, 'BT-UPD-007');
  const blockedBackup = join(root, 'backup-file');
  writeFileSync(blockedBackup, 'not a directory');
  await assert.rejects(prepareConfirmedUpdate(db, { ...config, backup: { dir: blockedBackup } }, manifest, confirmation, {
    fetchImpl: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
  }));
  assert.equal(getRollbackStatus(config).code, 'BT-UPD-007');
  await prepareConfirmedUpdate(db, config, manifest, {
    ...confirmation,
  }, { fetchImpl: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }) });
  assert.equal(existsSync(config.update.rollbackStatusFile), false);
  assert.equal(existsSync(config.update.rollbackFile), true);
  assert.equal(JSON.parse(readFileSync(config.update.healthFile, 'utf8')).status, 'pending');
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('rollback runner records success only after the rolled-back service has started', () => {
  const runner = readFileSync(new URL('../bin/rollback.js', import.meta.url), 'utf8');
  assert.match(runner, /runRollbackLifecycle/);
  assert.match(runner, /runnerFile: RUNNER_FILE/);
  assert.match(runner, /startService: \(version, context\) => startRolledBackService\(config, version, context\)/);
  assert.doesNotMatch(runner, /writeRollbackStatus|rollbackUpdate/);
  assert.doesNotMatch(runner, /Database|operation_events|recordOperationEvent/);
  assert.match(runner, /service-control\.js/);
});

test('rollback leases fail closed for accepted handoff, unknown identity, and a dead runner before expiry', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-lease-'));
  const config = { update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } };
  const at = '2026-07-31T00:00:00.000Z';
  const now = Date.parse('2026-07-31T00:01:00.000Z');
  writeRollbackStatus(config, { status: 'accepted', phase: 'accepted', correlationId: 'accepted-handoff', requestedAt: at, at });
  assert.equal(canStartServiceDuringRollback(config, { now, inspectProcess: () => null }), false);

  const runner = { pid: 7331, executablePath: 'C:\\Tracker\\runtime\\node.exe', runnerFile: 'C:\\Tracker\\bin\\rollback.js', startedAt: at };
  writeRollbackStatus(config, { status: 'running', phase: 'running', runner, startedAt: at, at });
  // CIM can be temporarily unavailable: this is still an active lease.
  assert.equal(canStartServiceDuringRollback(config, { now, inspectProcess: () => null }), false);
  // A dead runner does not make an unexpired lease permission to start a DB user.
  assert.equal(canStartServiceDuringRollback(config, { now, inspectProcess: () => ({ processId: 1 }) }), false);
  const identity = { processId: runner.pid, executablePath: runner.executablePath, commandLine: `"${runner.executablePath}" --no-warnings "${runner.runnerFile}"`, createdAt: '2026-07-30T23:59:59.000Z' };
  assert.equal(canStartServiceDuringRollback(config, { now, inspectProcess: () => identity, runnerPid: runner.pid, correlationId: 'accepted-handoff' }), true);
  assert.equal(canStartServiceDuringRollback(config, { now, inspectProcess: () => identity, runnerPid: runner.pid, correlationId: 'wrong' }), false);
  rmSync(root, { recursive: true, force: true });
});

test('rollback lock is single-flight across independent CLI processes and recovers a dead owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-lock-'));
  const config = { update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } };
  const runnerFile = null;
  const lock = acquireRollbackLock(config, { correlationId: 'two-cli-runners', runnerFile });
  assert.ok(lock);
  const moduleUrl = new URL('../src/release/update.js', import.meta.url).href;
  const code = `import { acquireRollbackLock } from ${JSON.stringify(moduleUrl)}; const lock = acquireRollbackLock({ update: { rollbackStatusFile: ${JSON.stringify(config.update.rollbackStatusFile)} } }, { correlationId: 'two-cli-runners', runnerFile: null }); process.stdout.write(lock ? 'acquired' : 'blocked');`;
  const result = execFileSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8' });
  assert.equal(result, 'blocked');
  rmSync(lock.path, { recursive: true, force: true });
  const dead = acquireRollbackLock(config, { correlationId: 'dead-runner', pid: 2147483647, runnerFile: 'runner.js' });
  assert.ok(dead);
  const reclaimed = acquireRollbackLock(config, { correlationId: 'replacement-runner', runnerFile: 'runner.js' });
  assert.ok(reclaimed, 'a non-existent owner PID can be reclaimed safely');
  rmSync(reclaimed.path, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

test('rollback lock keeps a live long-running handoff and never steals an initializing owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-lock-edges-'));
  try {
    const handoffConfig = { update: { rollbackStatusFile: join(root, 'handoff', 'rollback-status.json') } };
    const executablePath = 'C:\\Tracker\\runtime\\node.exe';
    const serviceFile = 'C:\\Tracker\\bin\\service.js';
    const serviceStartedAt = '2026-07-31T00:00:10.000Z';
    const handoff = acquireRollbackLock(handoffConfig, {
      correlationId: 'long-running-service', kind: 'handoff',
      pid: 4242, executablePath, runnerFile: serviceFile, startedAt: serviceStartedAt,
      now: () => '2026-07-31T04:00:00.000Z',
    });
    assert.ok(handoff);
    const serviceIdentity = {
      processId: 4242, executablePath,
      commandLine: `"${executablePath}" --no-warnings "${serviceFile}"`,
      createdAt: '2026-07-31T00:00:03.000Z',
    };
    const competingCli = acquireRollbackLock(handoffConfig, {
      correlationId: 'competing-cli', runnerFile: 'C:\\Tracker\\bin\\rollback.js',
      pid: 7331, inspectProcess: () => serviceIdentity, isProcessAlive: () => true,
    });
    assert.equal(competingCli, null);
    releaseRollbackLock(handoff);

    const initializingConfig = { update: { rollbackStatusFile: join(root, 'initializing', 'rollback-status.json') } };
    const initializingLockPath = join(root, 'initializing', 'rollback.lock');
    mkdirSync(initializingLockPath, { recursive: true });
    assert.equal(acquireRollbackLock(initializingConfig, {
      correlationId: 'must-not-steal-initializer', runnerFile: 'runner.js',
    }), null);
    const old = new Date(Date.now() - 10_000);
    utimesSync(initializingLockPath, old, old);
    const recovered = acquireRollbackLock(initializingConfig, {
      correlationId: 'recover-old-incomplete-lock', runnerFile: 'runner.js',
    });
    assert.ok(recovered);
    releaseRollbackLock(recovered);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rollback lifecycle survives database replacement and records exactly one terminal failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-rollback-lifecycle-'));
  const config = { update: { rollbackStatusFile: join(root, 'runtime', 'rollback-status.json') } };
  writeRollbackStatus(config, { status: 'accepted', phase: 'accepted', correlationId: 'shared-correlation', requestedAt: '2026-07-31T00:00:00.000Z', at: '2026-07-31T00:00:00.000Z', durationMs: 5 });
  writeRollbackStatus(config, { status: 'running', phase: 'running', startedAt: '2026-07-31T00:00:01.000Z', at: '2026-07-31T00:00:01.000Z' });
  writeRollbackStatus(config, { status: 'succeeded', phase: 'succeeded', completedAt: '2026-07-31T00:00:03.000Z', at: '2026-07-31T00:00:03.000Z' });
  const lifecycle = getRollbackLifecycle(config);
  assert.deepEqual(lifecycle.map((event) => event.phase), ['accepted', 'running', 'succeeded']);
  assert.ok(lifecycle.every((event) => event.correlationId === 'shared-correlation'));
  assert.ok(lifecycle.at(-1).durationMs >= 2000);

  const failedRoot = join(root, 'restore-failure');
  const failedConfig = {
    dbPath: join(failedRoot, 'data', 'tracker.db'),
    installRoot: join(failedRoot, 'program'),
    update: {
      rollbackFile: join(failedRoot, 'runtime', 'rollback.json'),
      currentFile: join(failedRoot, 'program', 'current.json'),
      rollbackStatusFile: join(failedRoot, 'runtime', 'rollback-status.json'),
    },
  };
  mkdirSync(join(failedConfig.installRoot, 'versions', '1.0.0'), { recursive: true });
  mkdirSync(join(failedRoot, 'runtime'), { recursive: true });
  writeFileSync(failedConfig.update.rollbackFile, JSON.stringify({ previousVersion: '1.0.0', databaseBackup: join(failedRoot, 'missing.db') }));
  writeRollbackStatus(failedConfig, {
    status: 'accepted', phase: 'accepted', correlationId: 'restore-failure-correlation',
    requestedAt: '2026-07-30T23:59:58.000Z', at: '2026-07-30T23:59:58.000Z',
  });
  let restoreTick = 0;
  await assert.rejects(runRollbackLifecycle(failedConfig, {
    startService: async () => assert.fail('restore failure must not start the service'),
    now: () => `2026-07-31T00:00:0${restoreTick++ * 2}.000Z`,
  }), /BT-UPD-007/);
  const restoreEvents = getRollbackLifecycle(failedConfig);
  assert.deepEqual(restoreEvents.map((event) => event.phase), ['accepted', 'running', 'failed']);
  assert.equal(restoreEvents.filter((event) => ['succeeded', 'failed'].includes(event.phase)).length, 1);
  assert.ok(restoreEvents.every((event) => event.correlationId === 'restore-failure-correlation'));
  assert.equal(restoreEvents.at(-1).errorCode, 'BT-UPD-007');
  assert.equal(restoreEvents.at(-1).durationMs, 2000);

  const serviceRoot = join(root, 'service-failure');
  const dbPath = join(serviceRoot, 'data', 'tracker.db');
  mkdirSync(join(serviceRoot, 'data'), { recursive: true });
  const db = new Database(dbPath);
  db.close();
  const backup = createBackup(dbPath, join(serviceRoot, 'backups'), { prefix: 'pre-rollback' });
  const serviceConfig = {
    dbPath, installRoot: join(serviceRoot, 'program'),
    update: {
      rollbackFile: join(serviceRoot, 'runtime', 'rollback.json'),
      currentFile: join(serviceRoot, 'program', 'current.json'),
      rollbackStatusFile: join(serviceRoot, 'runtime', 'rollback-status.json'),
    },
  };
  mkdirSync(join(serviceConfig.installRoot, 'versions', '1.0.0'), { recursive: true });
  mkdirSync(join(serviceRoot, 'runtime'), { recursive: true });
  writeFileSync(serviceConfig.update.rollbackFile, JSON.stringify({ previousVersion: '1.0.0', databaseBackup: backup.path }));
  let serviceTick = 0;
  await assert.rejects(runRollbackLifecycle(serviceConfig, {
    startService: async () => { throw new Error('previous service did not start'); },
    now: () => `2026-07-31T00:01:0${serviceTick++ * 2}.000Z`,
  }), /previous service did not start/);
  const serviceEvents = getRollbackLifecycle(serviceConfig);
  assert.deepEqual(serviceEvents.map((event) => event.phase), ['running', 'failed']);
  assert.equal(serviceEvents.filter((event) => ['succeeded', 'failed'].includes(event.phase)).length, 1);
  assert.ok(serviceEvents.every((event) => /^[A-Za-z0-9_-]{1,64}$/.test(event.correlationId)));
  assert.equal(serviceEvents[0].correlationId, serviceEvents[1].correlationId);
  assert.equal(serviceEvents.at(-1).errorCode, 'BT-UPD-007');
  assert.equal(serviceEvents.at(-1).durationMs, 2000);
  let retryTick = 0;
  await assert.rejects(runRollbackLifecycle(serviceConfig, {
    startService: async () => { throw new Error('previous service did not start'); },
    now: () => `2026-07-31T00:01:0${4 + (retryTick++ * 2)}.000Z`,
  }), /previous service did not start/);
  const retryEvents = getRollbackLifecycle(serviceConfig);
  assert.deepEqual(retryEvents.map((event) => event.phase), ['running', 'failed', 'running', 'failed']);
  assert.equal(retryEvents[2].correlationId, retryEvents[3].correlationId);
  assert.notEqual(retryEvents[0].correlationId, retryEvents[2].correlationId);

  const cliRoot = join(root, 'cli-success');
  const cliDbPath = join(cliRoot, 'data', 'tracker.db');
  mkdirSync(join(cliRoot, 'data'), { recursive: true });
  const cliDb = new Database(cliDbPath);
  cliDb.close();
  const cliBackup = createBackup(cliDbPath, join(cliRoot, 'backups'), { prefix: 'pre-cli-rollback' });
  const cliConfig = {
    dbPath: cliDbPath, installRoot: join(cliRoot, 'program'),
    update: {
      rollbackFile: join(cliRoot, 'runtime', 'rollback.json'),
      currentFile: join(cliRoot, 'program', 'current.json'),
      rollbackStatusFile: join(cliRoot, 'runtime', 'rollback-status.json'),
    },
  };
  mkdirSync(join(cliConfig.installRoot, 'versions', '1.0.0'), { recursive: true });
  mkdirSync(join(cliRoot, 'runtime'), { recursive: true });
  writeFileSync(cliConfig.update.rollbackFile, JSON.stringify({ previousVersion: '1.0.0', databaseBackup: cliBackup.path }));
  let cliTick = 0;
  await runRollbackLifecycle(cliConfig, {
    startService: async () => {},
    now: () => `2026-07-31T00:02:0${cliTick++ * 2}.000Z`,
  });
  const cliEvents = getRollbackLifecycle(cliConfig);
  assert.deepEqual(cliEvents.map((event) => event.phase), ['running', 'succeeded']);
  assert.ok(cliEvents.every((event) => /^[A-Za-z0-9_-]{1,64}$/.test(event.correlationId)));
  assert.equal(cliEvents[0].correlationId, cliEvents[1].correlationId);
  assert.equal(cliEvents.at(-1).durationMs, 2000);
  rmSync(root, { recursive: true, force: true });
});

test('scheduler uses the remaining verified-check delay and retries while network is paused', () => {
  const db = new Database(':memory:');
  const now = Date.parse('2026-07-30T00:00:00.000Z');
  const config = { network: { enabled: true }, update: { manifestUrl: 'https://updates.example.test/manifest.json' } };
  recordUpdateCheck(db, { enabled: true, updateAvailable: false }, { now: now - (60 * 60 * 1000) });
  assert.equal(nextUpdateCheckDelay(db, config, { now }), UPDATE_CHECK_INTERVAL_MS - (60 * 60 * 1000));
  const timers = [];
  const stop = scheduleRecurringUpdateCheck(db, config, {
    nowImpl: () => now,
    setTimeoutImpl: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
  });
  assert.equal(timers[0].delay, UPDATE_CHECK_INTERVAL_MS - (60 * 60 * 1000));
  stop();
  setNetworkEnabled(db, false, { config, reason: 'operator pause' });
  const pausedTimers = [];
  const stopPaused = scheduleRecurringUpdateCheck(db, config, {
    nowImpl: () => now,
    setTimeoutImpl: (fn, delay) => { const timer = { fn, delay, cleared: false }; pausedTimers.push(timer); return timer; },
    clearTimeoutImpl: (timer) => { timer.cleared = true; },
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(pausedTimers[0].delay, UPDATE_RETRY_INTERVAL_MS);
  stopPaused();
  db.close();
});
