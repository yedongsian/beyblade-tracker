import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import { setNetworkEnabled } from '../src/core/network-control.js';
import {
  UPDATE_CHECK_INTERVAL_MS, UPDATE_RETRY_INTERVAL_MS, clearDeferredUpdate, deferUpdate, finalizePostUpdateHealth, getPostUpdateHealth, getRollbackStatus, getUpdateState,
  isUpdateCheckDue, launchPreparedUpdate, manifestDigest, nextUpdateCheckDelay, prepareConfirmedUpdate, recordUpdateCheck, runScheduledUpdateCheck,
  scheduleRecurringUpdateCheck, isDeferredUpdate, writeRollbackStatus,
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
  assert.match(runner, /await startRolledBackService\(config, result\.version\)/);
  assert.ok(runner.indexOf('await startRolledBackService(config, result.version)') < runner.indexOf("status: 'succeeded'"));
  assert.match(runner, /service-control\.js/);
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
