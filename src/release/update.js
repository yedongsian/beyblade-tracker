import { createHash, verify as verifySignature } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createBackup, restoreBackup } from '../maintenance/backup.js';
import { getNetworkState } from '../core/network-control.js';
import { APP_VERSION } from './version.js';

export const UPDATE_STARTUP_DELAY_MS = 5000;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class UpdateError extends Error {
  constructor(code, message) {
    super(`${code}：${message}`);
    this.name = 'UpdateError';
    this.code = code;
  }
}

function updateError(code, message) {
  return new UpdateError(code, message);
}

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) throw new Error(`版本格式無效：${value}`);
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4] || '' };
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function signedPayload(manifest) {
  return Buffer.from(JSON.stringify({
    version: manifest.version,
    installerUrl: manifest.installerUrl,
    sha256: manifest.sha256,
    schemaVersion: Number(manifest.schemaVersion),
    channel: manifest.channel || 'stable',
    publisher: manifest.publisher,
    releaseNotes: manifest.releaseNotes,
    publishedAt: manifest.publishedAt,
    size: Number(manifest.size),
    publishReady: manifest.publishReady === true,
  }));
}

export function manifestDigest(manifest) {
  return createHash('sha256').update(signedPayload(manifest)).digest('hex');
}

export function validateUpdateManifest(manifest, { publicKey, requireSignature = true } = {}) {
  try { parseVersion(manifest?.version); }
  catch { throw updateError('BT-UPD-003', '更新 manifest 的版本無效。'); }
  if (manifest.channel !== 'stable') throw updateError('BT-UPD-003', '只接受 stable update channel。');
  if (manifest.publishReady !== true) throw updateError('BT-UPD-003', '更新 manifest 尚未標示為可發布。');
  if (!/^https:\/\//i.test(manifest.installerUrl || '')) throw updateError('BT-UPD-003', '更新安裝器必須使用 HTTPS。');
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256 || '')) throw updateError('BT-UPD-003', '更新 manifest 缺少有效 SHA-256。');
  if (!Number.isInteger(Number(manifest.schemaVersion)) || Number(manifest.schemaVersion) < 1) {
    throw updateError('BT-UPD-003', '更新 manifest 的 schema version 無效。');
  }
  if (typeof manifest.publisher !== 'string' || !manifest.publisher.trim() || manifest.publisher.length > 120) {
    throw updateError('BT-UPD-003', '更新 manifest 缺少可驗證的 publisher。');
  }
  if (typeof manifest.releaseNotes !== 'string' || manifest.releaseNotes.length > 16000) {
    throw updateError('BT-UPD-003', '更新 manifest 的 release notes 無效。');
  }
  if (!Number.isFinite(Date.parse(manifest.publishedAt || ''))) throw updateError('BT-UPD-003', '更新 manifest 的發布時間無效。');
  if (!Number.isInteger(Number(manifest.size)) || Number(manifest.size) < 1 || Number(manifest.size) > 300 * 1024 * 1024) {
    throw updateError('BT-UPD-003', '更新 manifest 的檔案大小無效。');
  }
  if (requireSignature) {
    if (!publicKey || !manifest.signature) throw updateError('BT-UPD-003', '遠端更新未設定簽章公鑰或 manifest 簽章。');
    let valid = false;
    try { valid = verifySignature(null, signedPayload(manifest), publicKey, Buffer.from(manifest.signature, 'base64')); }
    catch { throw updateError('BT-UPD-003', '更新 manifest 簽章或公鑰無效。'); }
    if (!valid) throw updateError('BT-UPD-003', '更新 manifest 簽章驗證失敗。');
  }
  return { ...manifest, manifestDigest: manifestDigest(manifest), updateAvailable: compareVersions(manifest.version, APP_VERSION) > 0 };
}

export async function checkForUpdate(config, { fetchImpl = fetch } = {}) {
  if (!config.update?.manifestUrl) return { enabled: false, currentVersion: APP_VERSION, updateAvailable: false };
  if (!/^https:\/\//i.test(config.update.manifestUrl)) throw updateError('BT-UPD-003', '更新 manifest 必須使用 HTTPS。');
  let response;
  try { response = await fetchImpl(config.update.manifestUrl, { signal: AbortSignal.timeout(15000) }); }
  catch { throw updateError('BT-UPD-002', '無法取得更新資訊，請稍後再試。'); }
  if (!response.ok) throw updateError('BT-UPD-002', `無法取得更新資訊（HTTP ${response.status}）。`);
  let manifest;
  try { manifest = await response.json(); }
  catch { throw updateError('BT-UPD-003', '更新 manifest 格式無效。'); }
  const checked = validateUpdateManifest(manifest, { publicKey: config.update.publicKey });
  return { enabled: true, currentVersion: APP_VERSION, manifest: checked, updateAvailable: checked.updateAvailable };
}

export async function downloadInstaller(manifest, destination, { fetchImpl = fetch, onProgress } = {}) {
  let response;
  try {
    response = await fetchImpl(manifest.installerUrl, { signal: AbortSignal.timeout(120000) });
  } catch {
    throw updateError('BT-UPD-005', '更新安裝器下載失敗。');
  }
  if (!response.ok) throw updateError('BT-UPD-005', `更新安裝器下載失敗（HTTP ${response.status}）。`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 300 * 1024 * 1024) throw updateError('BT-UPD-005', '更新安裝器超過 300 MB 安全上限。');
  if (declared && declared !== Number(manifest.size)) throw updateError('BT-UPD-004', '更新安裝器大小不符。');
  const chunks = [];
  let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 300 * 1024 * 1024) throw updateError('BT-UPD-005', '更新安裝器超過 300 MB 安全上限。');
      chunks.push(Buffer.from(value));
      onProgress?.({ received, total: Number(manifest.size) });
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    received = buffer.length;
    chunks.push(buffer);
    onProgress?.({ received, total: Number(manifest.size) });
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length !== Number(manifest.size)) throw updateError('BT-UPD-004', '更新安裝器大小不符。');
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) throw updateError('BT-UPD-004', '更新安裝器 SHA-256 不符。');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
  return destination;
}

export async function prepareUpdate(config, manifest, options = {}) {
  const checked = validateUpdateManifest(manifest, { publicKey: config.update.publicKey });
  if (!checked.updateAvailable) throw updateError('BT-UPD-005', '沒有較新的版本可安裝。');
  mkdirSync(config.releaseDir, { recursive: true });
  const installer = join(config.releaseDir, `BeybladeTracker-${checked.version}-Setup.exe`);
  await downloadInstaller(checked, installer, options);
  const backup = createBackup(config.dbPath, config.backup.dir, { prefix: `pre-update-${APP_VERSION}` });
  const rollback = {
    previousVersion: APP_VERSION,
    targetVersion: checked.version,
    databaseBackup: backup.path,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(config.update.rollbackFile), { recursive: true });
  writeFileSync(config.update.rollbackFile, JSON.stringify(rollback, null, 2));
  if (config.update.healthFile) {
    mkdirSync(dirname(config.update.healthFile), { recursive: true });
    writeFileSync(config.update.healthFile, JSON.stringify({
      targetVersion: checked.version, manifestDigest: checked.manifestDigest, databaseBackup: backup.path,
      status: 'pending', createdAt: new Date().toISOString(),
    }, null, 2));
  }
  return { installer, rollback, manifest: checked };
}

export function finalizePostUpdateHealth(config, { currentVersion = APP_VERSION, integrity = 'ok' } = {}) {
  const healthFile = config.update?.healthFile;
  if (!healthFile || !existsSync(healthFile)) return null;
  let record;
  try { record = JSON.parse(readFileSync(healthFile, 'utf8')); }
  catch { throw updateError('BT-UPD-006', '更新後健康檢查紀錄無法驗證。'); }
  // A completed health result is immutable: every later normal service start must
  // report the original outcome instead of re-evaluating a non-pending marker.
  if (record.status === 'healthy' || record.status === 'failed') return record;
  const healthy = record.status === 'pending' && record.targetVersion === currentVersion && integrity === 'ok';
  const result = {
    ...record, status: healthy ? 'healthy' : 'failed', checkedAt: new Date().toISOString(),
    code: healthy ? null : 'BT-UPD-006', rollbackOffered: !healthy,
  };
  writeFileSync(healthFile, JSON.stringify(result, null, 2));
  return result;
}

function readUpdateStatus(path, failureCode) {
  if (!path || !existsSync(path)) return null;
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return {
      status: record.status === 'succeeded' ? 'succeeded' : record.status === 'healthy' ? 'healthy' : record.status === 'failed' ? 'failed' : 'running',
      code: record.code || null, rollbackOffered: record.rollbackOffered === true,
      targetVersion: record.targetVersion || null, version: record.version || null,
      checkedAt: record.checkedAt || record.completedAt || null,
    };
  } catch {
    return { status: 'failed', code: failureCode, rollbackOffered: failureCode === 'BT-UPD-006' };
  }
}

export function getPostUpdateHealth(config) {
  return readUpdateStatus(config.update?.healthFile, 'BT-UPD-006');
}

export function getRollbackStatus(config) {
  return readUpdateStatus(config.update?.rollbackStatusFile, 'BT-UPD-007');
}

export function writeRollbackStatus(config, patch) {
  const file = config.update?.rollbackStatusFile;
  if (!file) return null;
  mkdirSync(dirname(file), { recursive: true });
  const safe = {
    status: patch.status === 'succeeded' ? 'succeeded' : patch.status === 'failed' ? 'failed' : 'running',
    code: patch.code || null, version: patch.version || null,
    completedAt: patch.completedAt || null,
  };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(safe, null, 2));
  rmSync(file, { force: true });
  renameSync(temp, file);
  return safe;
}

export function validateUpdateConfirmation(confirmation, manifest) {
  const checked = validateUpdateManifest(manifest, { publicKey: null, requireSignature: false });
  if (confirmation?.confirmed !== true) throw updateError('BT-UPD-005', '必須明確確認後才能下載並安裝更新。');
  if (confirmation.targetVersion !== checked.version || confirmation.manifestDigest !== checked.manifestDigest) {
    throw updateError('BT-UPD-003', '確認的版本或 manifest 已變更，請重新檢查更新。');
  }
  return checked;
}

function readSetting(db, key, fallback = null) {
  const row = db.get('SELECT value_json FROM user_settings WHERE key=?', [key]);
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}

function writeSetting(db, key, value, now = new Date().toISOString()) {
  db.run(`INSERT INTO user_settings (key,value_json,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  [key, JSON.stringify(value), now]);
}

export function getUpdateState(db) {
  return {
    lastCheckedAt: readSetting(db, 'updateLastCheckedAt'),
    deferred: readSetting(db, 'updateDeferred'),
    latestResult: readSetting(db, 'updateLatestResult'),
  };
}

export function isUpdateCheckDue(db, { now = Date.now() } = {}) {
  const lastCheckedAt = getUpdateState(db).lastCheckedAt;
  return !lastCheckedAt || Number.isNaN(Date.parse(lastCheckedAt)) || now - Date.parse(lastCheckedAt) >= UPDATE_CHECK_INTERVAL_MS;
}

function checkedAtIso(now) {
  return typeof now === 'number' ? new Date(now).toISOString() : now;
}

function updateResultForDisplay(result, checkedAt) {
  const manifest = result?.updateAvailable && result.manifest ? {
    version: result.manifest.version,
    publisher: result.manifest.publisher,
    releaseNotes: result.manifest.releaseNotes,
    publishedAt: result.manifest.publishedAt,
    size: Number(result.manifest.size),
    manifestDigest: result.manifest.manifestDigest,
  } : null;
  return {
    enabled: Boolean(result?.enabled), currentVersion: result?.currentVersion || APP_VERSION,
    updateAvailable: Boolean(result?.updateAvailable), manifest, checkedAt,
  };
}

export function recordUpdateCheck(db, result = null, { now = new Date().toISOString() } = {}) {
  const checkedAt = checkedAtIso(now);
  const display = updateResultForDisplay(result, checkedAt);
  writeSetting(db, 'updateLastCheckedAt', checkedAt, checkedAt);
  writeSetting(db, 'updateLatestResult', display, checkedAt);
  return display;
}

export function deferUpdate(db, confirmation, manifest, { now = new Date().toISOString() } = {}) {
  const checked = validateUpdateConfirmation({ ...confirmation, confirmed: true }, manifest);
  const deferred = { targetVersion: checked.version, manifestDigest: checked.manifestDigest, deferredAt: now };
  writeSetting(db, 'updateDeferred', deferred, now);
  return deferred;
}

export function clearDeferredUpdate(db, { now = new Date().toISOString() } = {}) {
  writeSetting(db, 'updateDeferred', null, now);
}

export function isDeferredUpdate(state, manifest) {
  const deferred = state?.deferred;
  return Boolean(deferred && manifest && deferred.targetVersion === manifest.version && deferred.manifestDigest === manifest.manifestDigest);
}

export async function prepareConfirmedUpdate(db, config, manifest, confirmation, options = {}) {
  const checked = validateUpdateConfirmation(confirmation, manifest);
  const prepared = await prepareUpdate(config, checked, options);
  clearDeferredUpdate(db);
  return prepared;
}

export async function runScheduledUpdateCheck(db, config, options = {}) {
  if (!getNetworkState(db, config).enabled || !config.update?.manifestUrl || !isUpdateCheckDue(db, options)) return null;
  let result;
  try {
    result = await checkForUpdate(config, options);
    return result;
  } finally {
    recordUpdateCheck(db, result, options);
  }
}

export function scheduleRecurringUpdateCheck(db, config, {
  initialDelayMs = UPDATE_STARTUP_DELAY_MS,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onResult = () => {},
  onError = () => {},
  ...checkOptions
} = {}) {
  let stopped = false;
  let timer = null;
  const run = async () => {
    try { onResult(await runScheduledUpdateCheck(db, config, checkOptions)); }
    catch (error) { onError(error); }
    finally {
      if (!stopped) timer = setTimeoutImpl(run, intervalMs);
    }
  };
  timer = setTimeoutImpl(run, initialDelayMs);
  return () => {
    stopped = true;
    if (timer) clearTimeoutImpl(timer);
  };
}

export async function launchPreparedUpdate(prepared, { spawnImpl = spawn } = {}) {
  let child;
  try {
    child = spawnImpl(prepared.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
      detached: false, windowsHide: true, stdio: 'ignore',
    });
  } catch {
    throw updateError('BT-UPD-005', '已驗證的更新安裝器無法啟動。');
  }
  if (!child?.once) {
    return { launched: true };
  }
  return new Promise((resolve, reject) => {
    const fail = () => reject(updateError('BT-UPD-005', '已驗證的更新安裝器無法啟動。'));
    child.once('error', fail);
    child.once('spawn', () => {
      child.off?.('error', fail);
      child.once('close', (code) => {
        if (code === 0) resolve({ launched: true, installed: true });
        else reject(updateError('BT-UPD-005', '更新安裝器未能完成。'));
      });
    });
  });
}

export function rollbackUpdate(config, { pidFile } = {}) {
  if (!existsSync(config.update.rollbackFile)) throw updateError('BT-UPD-007', '找不到可回滾的版本紀錄。');
  const record = JSON.parse(readFileSync(config.update.rollbackFile, 'utf8'));
  const versionDir = join(config.installRoot, 'versions', record.previousVersion);
  if (!existsSync(versionDir)) throw updateError('BT-UPD-007', '找不到可回滾的舊版程式。');
  let restored;
  try { restored = restoreBackup(record.databaseBackup, config.dbPath, { pidFile }); }
  catch { throw updateError('BT-UPD-007', '無法還原更新前的備份。'); }
  mkdirSync(dirname(config.update.currentFile), { recursive: true });
  const temp = `${config.update.currentFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: record.previousVersion }, null, 2));
  rmSync(config.update.currentFile, { force: true });
  renameSync(temp, config.update.currentFile);
  if (config.update.healthFile) rmSync(config.update.healthFile, { force: true });
  return { version: record.previousVersion, restored };
}
