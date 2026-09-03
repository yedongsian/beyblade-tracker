import { createHash, verify as verifySignature } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createBackup, restoreBackup } from '../maintenance/backup.js';
import { getNetworkState } from '../core/network-control.js';
import { newCorrelationId, recordOperationEvent, safeErrorClass } from '../core/operations.js';
import { classifyServiceProcess, inspectProcessIdentity } from './service-process.js';
import { APP_VERSION } from './version.js';

export const UPDATE_STARTUP_DELAY_MS = 5000;
export const ROLLBACK_ACTIVE_LEASE_MS = 5 * 60 * 1000;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_RETRY_INTERVAL_MS = 5 * 60 * 1000;

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
  clearRollbackStatus(config);
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
      status: record.status === 'accepted' ? 'accepted' : record.status === 'succeeded' ? 'succeeded' : record.status === 'healthy' ? 'healthy' : record.status === 'failed' ? 'failed' : 'running',
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

function safeRollbackTimestamp(value) {
  const raw = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw) ? raw : null;
}

function safeRollbackPhase(value) {
  return ['accepted', 'running', 'succeeded', 'failed'].includes(value) ? value : 'running';
}

function safeRollbackCode(value) {
  const raw = String(value || '');
  return /^BT-[A-Z]+-\d+$/.test(raw) ? raw : null;
}

function safeRollbackDuration(value) {
  return Number.isFinite(Number(value)) ? Math.min(86_400_000, Math.max(0, Math.round(Number(value)))) : 0;
}

function safeRollbackRunner(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const pid = Number(raw.pid);
  const boundedPath = (path) => typeof path === 'string' && path.length > 0 && path.length <= 512 ? path : null;
  return Number.isInteger(pid) && pid > 0 && pid <= 2_147_483_647
    ? {
      pid, executablePath: boundedPath(raw.executablePath), runnerFile: boundedPath(raw.runnerFile),
      startedAt: safeRollbackTimestamp(raw.startedAt),
    }
    : null;
}

function safeRollbackLifecycle(events) {
  return Array.isArray(events) ? events.map((event) => ({
    phase: safeRollbackPhase(event?.phase), at: safeRollbackTimestamp(event?.at),
    durationMs: safeRollbackDuration(event?.durationMs),
    correlationId: /^[A-Za-z0-9_-]{1,64}$/.test(String(event?.correlationId || '')) ? event.correlationId : null,
    errorCode: safeRollbackCode(event?.errorCode),
  })).filter((event) => event.at).slice(-8) : [];
}

// This sidecar remains outside the restored database, so it preserves the
// accepted -> running -> terminal rollback history without migrating a DB that
// must remain compatible with the previous application version.
export function getRollbackLifecycle(config) {
  const file = config.update?.rollbackStatusFile;
  if (!file || !existsSync(file)) return [];
  try { return safeRollbackLifecycle(JSON.parse(readFileSync(file, 'utf8')).events); } catch { return []; }
}

function hasLiveRollbackServiceOwner(config, inspectProcess = inspectProcessIdentity) {
  const file = config.statusFile;
  if (!file || !existsSync(file)) return false;
  try {
    const status = JSON.parse(readFileSync(file, 'utf8'));
    const pid = Number(status?.pid);
    if (!(status?.service === 'beyblade-tracker'
      && status?.status === 'stopping'
      && status?.rollbackRequested === true
      && Number.isInteger(pid) && pid > 0)) return false;
    return classifyServiceProcess(inspectProcess(pid), {
      pid, status, executablePath: status.executablePath, serviceFile: status.serviceFile, startedAt: status.startedAt,
    }) === 'owned';
  } catch { return false; }
}

function hasLiveRollbackRunnerOwner(last, runner, inspectProcess = inspectProcessIdentity) {
  if (last?.phase !== 'running' || !runner?.pid || !runner.executablePath || !runner.runnerFile || !runner.startedAt) return false;
  const status = { service: 'beyblade-tracker', pid: runner.pid, status: 'running', startedAt: runner.startedAt };
  try {
    return classifyServiceProcess(inspectProcess(runner.pid), {
      pid: runner.pid, status, executablePath: runner.executablePath, serviceFile: runner.runnerFile, startedAt: runner.startedAt,
    }) === 'owned';
  } catch { return false; }
}

// accepted/running sidecars are only authoritative for a bounded lease.  This
// lets a newly started service recover safely if the prior process died before
// the rollback runner could write its terminal state.
export function getRollbackLeaseStatus(config, {
  now = Date.now(), leaseMs = ROLLBACK_ACTIVE_LEASE_MS, inspectProcess,
} = {}) {
  let stored = {};
  try { stored = JSON.parse(readFileSync(config.update?.rollbackStatusFile, 'utf8')); } catch { /* absent/malformed */ }
  let last = getRollbackLifecycle(config).at(-1) || null;
  // Older sidecars had only status/requestedAt.  Treat them as active too so
  // a current control script cannot become a bypass during a legacy handoff.
  if (!last && ['accepted', 'running'].includes(stored?.status)) {
    last = { phase: stored.status, at: safeRollbackTimestamp(stored.at || stored.startedAt || stored.requestedAt), correlationId: stored.correlationId || null };
  }
  if (!last || !['accepted', 'running'].includes(last.phase)) return { active: false, stale: false, last };
  const serviceOwnerActive = hasLiveRollbackServiceOwner(config, inspectProcess);
  const runner = safeRollbackRunner(stored.runner);
  const runnerOwnerActive = hasLiveRollbackRunnerOwner(last, runner, inspectProcess);
  if (serviceOwnerActive || runnerOwnerActive) {
    return { active: true, stale: false, ownerActive: true, serviceOwnerActive, runnerOwnerActive, runner, last };
  }
  const at = Date.parse(last.at || '');
  const current = Number(now);
  const boundedLease = Number.isFinite(Number(leaseMs)) ? Math.max(1, Math.min(86_400_000, Number(leaseMs))) : ROLLBACK_ACTIVE_LEASE_MS;
  const active = Number.isFinite(at) && Number.isFinite(current) && current >= at && current - at <= boundedLease;
  // An active legacy record without a trustworthy timestamp is not safe to
  // expire automatically.  It needs an explicit runner recovery/finalization.
  const unknownAge = !Number.isFinite(at) || !Number.isFinite(current) || current < at;
  return { active: active || unknownAge, stale: !active && !unknownAge, ownerActive: false, serviceOwnerActive: false, runnerOwnerActive: false, runner, last };
}

export function canStartServiceDuringRollback(config, {
  now = Date.now(), inspectProcess, runnerPid = null, correlationId = null,
} = {}) {
  const lease = getRollbackLeaseStatus(config, { now, inspectProcess });
  // A sidecar is a lease, not a hint.  In particular, a transient CIM failure
  // must not turn an accepted/running rollback into permission to open the DB.
  // The rollback runner is the sole exception and it has to prove both its
  // OS identity and the handoff correlation.
  if (!lease.active) return true;
  return lease.runnerOwnerActive && Number(runnerPid) === lease.runner?.pid &&
    String(correlationId || '') === String(lease.last?.correlationId || '');
}

function rollbackLockPath(config) {
  const configured = config.update?.rollbackLockFile;
  if (configured) return configured;
  const statusFile = config.update?.rollbackStatusFile;
  return statusFile ? join(dirname(statusFile), 'rollback.lock') : null;
}

function safeRollbackLockOwner(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const pid = Number(raw.pid);
  const token = /^[A-Za-z0-9_-]{8,128}$/.test(String(raw.token || '')) ? String(raw.token) : null;
  const correlationId = /^[A-Za-z0-9_-]{1,64}$/.test(String(raw.correlationId || '')) ? String(raw.correlationId) : null;
  if (!Number.isInteger(pid) || pid <= 0 || !token || !correlationId) return null;
  return {
    pid, token, correlationId,
    executablePath: typeof raw.executablePath === 'string' ? raw.executablePath : null,
    runnerFile: typeof raw.runnerFile === 'string' ? raw.runnerFile : null,
    startedAt: safeRollbackTimestamp(raw.startedAt), kind: raw.kind === 'handoff' ? 'handoff' : 'runner',
  };
}

function readRollbackLock(lockPath) {
  try { return safeRollbackLockOwner(JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'))); } catch { return null; }
}

function rollbackLockCanRecoverIncompleteOwner(lockPath, {
  nowMs = Date.now, initializationGraceMs = 5000,
} = {}) {
  try {
    const ageMs = Number(nowMs()) - statSync(lockPath).mtimeMs;
    const graceMs = Number.isFinite(Number(initializationGraceMs))
      ? Math.max(1000, Math.min(60_000, Number(initializationGraceMs))) : 5000;
    return Number.isFinite(ageMs) && ageMs >= graceMs;
  } catch { return false; }
}

function lockOwnerIsLive(owner, { inspectProcess = inspectProcessIdentity, isProcessAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
} } = {}) {
  if (!owner?.pid) return false;
  // A process which no longer exists is safe to reclaim.  If it exists but
  // CIM is unavailable/ambiguous, keep the lock: unknown is deliberately not
  // equivalent to dead.
  if (!isProcessAlive(owner.pid)) return false;
  if (!owner.executablePath || !owner.runnerFile || !owner.startedAt) return true;
  const status = { service: 'beyblade-tracker', status: 'running', pid: owner.pid, startedAt: owner.startedAt };
  const ownership = classifyServiceProcess(inspectProcess(owner.pid), {
    pid: owner.pid, status, executablePath: owner.executablePath, serviceFile: owner.runnerFile, startedAt: owner.startedAt,
  });
  return ownership !== 'other';
}

// A directory creation is atomic on the supported filesystems.  It avoids the
// read/overwrite race of a JSON sidecar and survives a runner crash so a later
// invocation can reclaim it only after proving the prior PID is gone/reused.
export function acquireRollbackLock(config, {
  correlationId, handoffToken = null, runnerFile = null, kind = 'runner', now = () => new Date().toISOString(),
  startedAt = null, inspectProcess, isProcessAlive, pid = process.pid, executablePath = process.execPath,
  nowMs = Date.now, initializationGraceMs = 5000,
} = {}) {
  const lockPath = rollbackLockPath(config);
  if (!lockPath || !/^[A-Za-z0-9_-]{1,64}$/.test(String(correlationId || ''))) return null;
  try { mkdirSync(dirname(lockPath), { recursive: true }); } catch { return null; }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = newCorrelationId();
    const owner = { pid, token, correlationId, executablePath, runnerFile, startedAt: startedAt || now(), kind };
    try {
      mkdirSync(lockPath, { recursive: false });
      const ownerTemp = join(lockPath, `owner.${pid}.${token}.tmp`);
      writeFileSync(ownerTemp, JSON.stringify(owner, null, 2));
      renameSync(ownerTemp, join(lockPath, 'owner.json'));
      return { path: lockPath, owner };
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
    }
    const existing = readRollbackLock(lockPath);
    // Another process can observe the directory after its atomic mkdir but
    // before owner.json is atomically published.  Never reclaim that
    // initialization window; only an old orphaned directory is recoverable.
    if (!existing && !rollbackLockCanRecoverIncompleteOwner(lockPath, { nowMs, initializationGraceMs })) return null;
    // The web service hands a capability to its shutdown child.  A normal CLI
    // has no token and cannot take this path; it therefore cannot overwrite an
    // accepted handoff or its sidecar.
    const mayAdopt = existing && handoffToken && existing.kind === 'handoff' &&
      existing.correlationId === correlationId && existing.token === handoffToken;
    if (!mayAdopt && lockOwnerIsLive(existing, { inspectProcess, isProcessAlive })) return null;
    try { rmSync(lockPath, { recursive: true, force: true }); } catch { return null; }
  }
  return null;
}

export function releaseRollbackLock(lock) {
  if (!lock?.path || !lock?.owner?.token) return;
  const current = readRollbackLock(lock.path);
  if (current?.token === lock.owner.token) rmSync(lock.path, { recursive: true, force: true });
}

export function writeRollbackStatus(config, patch) {
  const file = config.update?.rollbackStatusFile;
  if (!file) return null;
  mkdirSync(dirname(file), { recursive: true });
  let previous = {};
  try { previous = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no previous state */ }
  const correlationId = /^[A-Za-z0-9_-]{1,64}$/.test(String(patch.correlationId || previous.correlationId || ''))
    ? String(patch.correlationId || previous.correlationId) : null;
  const now = safeRollbackTimestamp(patch.at) || new Date().toISOString();
  const requestedAt = safeRollbackTimestamp(patch.requestedAt) || safeRollbackTimestamp(previous.requestedAt);
  const startedAt = safeRollbackTimestamp(patch.startedAt) || safeRollbackTimestamp(previous.startedAt);
  const phase = safeRollbackPhase(patch.phase || patch.status);
  const elapsedSinceStart = Date.parse(startedAt || requestedAt || '');
  const durationMs = patch.durationMs == null
    ? (Number.isFinite(elapsedSinceStart) ? Math.max(0, Date.parse(now) - elapsedSinceStart) : 0)
    : safeRollbackDuration(patch.durationMs);
  const events = [...safeRollbackLifecycle(previous.events), {
    phase, at: now, durationMs, correlationId, errorCode: safeRollbackCode(patch.code),
  }].slice(-8);
  const safe = {
    status: patch.status === 'accepted' ? 'accepted' : patch.status === 'succeeded' ? 'succeeded' : patch.status === 'failed' ? 'failed' : 'running',
    code: safeRollbackCode(patch.code), version: typeof patch.version === 'string' && patch.version.length <= 64 ? patch.version : null,
    completedAt: safeRollbackTimestamp(patch.completedAt), correlationId, requestedAt, startedAt,
    runner: patch.runner === null ? null : safeRollbackRunner(patch.runner || previous.runner), events,
  };
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(safe, null, 2));
  rmSync(file, { force: true });
  renameSync(temp, file);
  return safe;
}

export function clearRollbackStatus(config) {
  const file = config.update?.rollbackStatusFile;
  if (file) rmSync(file, { force: true });
}

// Keep every terminal rollback failure in one place.  The runner and the
// service shutdown path can both use this without producing a second event.
export function finishRollbackFailure(config, error, { now = () => new Date().toISOString() } = {}) {
  const completedAt = now();
  return writeRollbackStatus(config, {
    status: 'failed', phase: 'failed', code: error?.code || 'BT-UPD-007',
    completedAt, at: completedAt,
  });
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

export function nextUpdateCheckDelay(db, config, {
  now = Date.now(), intervalMs = UPDATE_CHECK_INTERVAL_MS, retryDelayMs = UPDATE_RETRY_INTERVAL_MS,
} = {}) {
  if (!config.update?.manifestUrl) return intervalMs;
  if (!getNetworkState(db, config).enabled) return retryDelayMs;
  const checkedAt = Date.parse(getUpdateState(db).lastCheckedAt || '');
  if (Number.isNaN(checkedAt)) return 0;
  return Math.max(0, intervalMs - Math.max(0, now - checkedAt));
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

export function recordUpdateCheck(db, result = null, { now = new Date().toISOString(), correlationId = null, durationMs = null } = {}) {
  const checkedAt = checkedAtIso(now);
  const display = updateResultForDisplay(result, checkedAt);
  writeSetting(db, 'updateLastCheckedAt', checkedAt, checkedAt);
  writeSetting(db, 'updateLatestResult', display, checkedAt);
  recordOperationEvent(db, {
    correlationId, component: 'update',
    operation: display.updateAvailable ? 'check_available' : 'check', status: 'success', durationMs,
  }, { now: checkedAt });
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
  const correlationId = options.correlationId || newCorrelationId();
  const started = Date.now();
  try {
    const result = await checkForUpdate(config, options);
    recordUpdateCheck(db, result, { ...options, correlationId, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    recordOperationEvent(db, { correlationId, component: 'update', operation: 'check', status: 'failed', durationMs: Date.now() - started, errorClass: safeErrorClass(error) });
    throw error;
  }
}

export function scheduleRecurringUpdateCheck(db, config, {
  initialDelayMs = UPDATE_STARTUP_DELAY_MS,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  retryDelayMs = UPDATE_RETRY_INTERVAL_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  nowImpl = () => Date.now(),
  onResult = () => {},
  onError = () => {},
  ...checkOptions
} = {}) {
  let stopped = false;
  let timer = null;
  const schedule = (delay) => { if (!stopped) timer = setTimeoutImpl(run, delay); };
  const run = async () => {
    let failed = false;
    try {
      onResult(await runScheduledUpdateCheck(db, config, checkOptions));
    } catch (error) { failed = true; onError(error); }
    finally {
      schedule(failed
        ? retryDelayMs
        : nextUpdateCheckDelay(db, config, { now: nowImpl(), intervalMs, retryDelayMs }));
    }
  };
  const firstDelay = nextUpdateCheckDelay(db, config, { now: nowImpl(), intervalMs, retryDelayMs });
  schedule(Math.max(initialDelayMs, firstDelay));
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

/**
 * `updateAvailable` inside a stored check result is a fact about the version that was running when
 * the check ran, not about the version running now. Reading it back verbatim means that the moment
 * an update succeeds the app carries on advertising the release it just installed - offering to
 * install 1.0.2 while running 1.0.2 - until the next scheduled check up to a day later.
 *
 * Nobody could see this until BT-REL-001 was fixed, because no update had ever completed.
 */
export function pendingUpdate(state, currentVersion = APP_VERSION) {
  const latest = state?.latestResult;
  if (!latest?.updateAvailable || !latest.manifest?.version) return null;
  try {
    return compareVersions(latest.manifest.version, currentVersion) > 0 ? latest : null;
  } catch { return null; }
}

export const UPDATE_HANDOVER_TIMEOUT_MS = 120_000;

/**
 * The success criterion used to be the installer's exit code, which says the files were written and
 * nothing at all about whether the new build is the one now serving. BT-REL-001 lived in exactly
 * that gap: the installer exited 0, the restart never happened, and the user was told the update had
 * completed while 1.0.0 kept answering on 8787 and kept offering the same update.
 *
 * The check that closes it is inverted, because the process running it is the one being replaced: a
 * handover that works stops this service, so reaching the deadline is itself the failure. The health
 * probe is only there so a handover we somehow survive is still read as success rather than a false
 * alarm.
 */
export async function confirmUpdateHandover({
  targetVersion, currentVersion = APP_VERSION, probeVersion = null,
  timeoutMs = UPDATE_HANDOVER_TIMEOUT_MS, pollMs = 2_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
} = {}) {
  if (!targetVersion) throw updateError('BT-UPD-008', '缺少目標版本，無法確認更新是否生效。');
  if (currentVersion === targetVersion) return { ok: true, servedVersion: currentVersion };
  const deadline = now() + timeoutMs;
  let served = null;
  while (now() < deadline) {
    if (probeVersion) {
      try { served = await probeVersion(); } catch { served = null; }
      if (served && served === targetVersion) return { ok: true, servedVersion: served };
    }
    await sleep(pollMs);
  }
  throw updateError('BT-UPD-008', `更新已安裝，但服務仍在執行 ${currentVersion}。`);
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

// The runner owns running and terminal lifecycle transitions.  Keeping this
// outside the restored database preserves a coherent sidecar history even
// when rollback replaces the application database with an older schema.
export async function runRollbackLifecycle(config, {
  pidFile,
  startService,
  runnerFile = null,
  handoffToken = null,
  now = () => new Date().toISOString(),
  inspectProcess,
  isProcessAlive,
} = {}) {
  const startedAt = now();
  const previous = getRollbackLifecycle(config).at(-1);
  const correlationId = ['accepted', 'running'].includes(previous?.phase) && previous.correlationId
    ? previous.correlationId : newCorrelationId();
  const runner = { pid: process.pid, executablePath: process.execPath, runnerFile, startedAt };
  const lock = acquireRollbackLock(config, {
    correlationId, handoffToken, runnerFile, now, startedAt, inspectProcess, isProcessAlive,
  });
  if (!lock) throw updateError('BT-UPD-007', 'A rollback runner is already active.');
  try {
    writeRollbackStatus(config, { status: 'running', phase: 'running', correlationId, runner, startedAt, at: startedAt });
    const result = rollbackUpdate(config, { pidFile });
    if (typeof startService !== 'function') throw updateError('BT-UPD-007', 'Rollback service runner is unavailable.');
    await startService(result.version, { correlationId, runner });
    const completedAt = now();
    writeRollbackStatus(config, {
      status: 'succeeded', phase: 'succeeded', version: result.version,
      completedAt, at: completedAt,
    });
    return result;
  } catch (error) {
    finishRollbackFailure(config, error, { now });
    throw error;
  } finally {
    releaseRollbackLock(lock);
  }
}
