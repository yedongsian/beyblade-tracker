import { createHash, verify as verifySignature } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createBackup, restoreBackup } from '../maintenance/backup.js';
import { APP_VERSION } from './version.js';

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

function signedPayload(manifest) {
  return Buffer.from(JSON.stringify({
    version: manifest.version,
    installerUrl: manifest.installerUrl,
    sha256: manifest.sha256,
    schemaVersion: Number(manifest.schemaVersion),
    channel: manifest.channel || 'stable',
  }));
}

export function validateUpdateManifest(manifest, { publicKey, requireSignature = true } = {}) {
  parseVersion(manifest?.version);
  if (!/^https:\/\//i.test(manifest.installerUrl || '')) throw new Error('更新安裝器必須使用 HTTPS。');
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256 || '')) throw new Error('更新 manifest 缺少有效 SHA-256。');
  if (!Number.isInteger(Number(manifest.schemaVersion)) || Number(manifest.schemaVersion) < 1) {
    throw new Error('更新 manifest 的 schema version 無效。');
  }
  if (requireSignature) {
    if (!publicKey || !manifest.signature) throw new Error('遠端更新未設定簽章公鑰或 manifest 簽章。');
    const valid = verifySignature(null, signedPayload(manifest), publicKey, Buffer.from(manifest.signature, 'base64'));
    if (!valid) throw new Error('更新 manifest 簽章驗證失敗。');
  }
  return { ...manifest, updateAvailable: compareVersions(manifest.version, APP_VERSION) > 0 };
}

export async function checkForUpdate(config, { fetchImpl = fetch } = {}) {
  if (!config.update?.manifestUrl) return { enabled: false, currentVersion: APP_VERSION, updateAvailable: false };
  if (!/^https:\/\//i.test(config.update.manifestUrl)) throw new Error('更新 manifest 必須使用 HTTPS。');
  const response = await fetchImpl(config.update.manifestUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`更新檢查失敗：HTTP ${response.status}`);
  const manifest = validateUpdateManifest(await response.json(), { publicKey: config.update.publicKey });
  return { enabled: true, currentVersion: APP_VERSION, manifest, updateAvailable: manifest.updateAvailable };
}

async function downloadInstaller(manifest, destination, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(manifest.installerUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`更新下載失敗：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 300 * 1024 * 1024) throw new Error('更新安裝器超過 300 MB 安全上限。');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 300 * 1024 * 1024) throw new Error('更新安裝器超過 300 MB 安全上限。');
  const digest = createHash('sha256').update(buffer).digest('hex');
  if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) throw new Error('更新安裝器 SHA-256 不符。');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
  return destination;
}

export async function prepareUpdate(config, manifest, options = {}) {
  const checked = validateUpdateManifest(manifest, { publicKey: config.update.publicKey });
  if (!checked.updateAvailable) throw new Error('沒有較新的版本可安裝。');
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
  writeFileSync(config.update.rollbackFile, JSON.stringify(rollback, null, 2));
  return { installer, rollback };
}

export function launchPreparedUpdate(prepared, { spawnImpl = spawn } = {}) {
  const child = spawnImpl(prepared.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
    detached: true, windowsHide: true, stdio: 'ignore',
  });
  child.unref?.();
  return { launched: true, installer: prepared.installer };
}

export function rollbackUpdate(config, { pidFile } = {}) {
  if (!existsSync(config.update.rollbackFile)) throw new Error('找不到可回滾的版本紀錄。');
  const record = JSON.parse(readFileSync(config.update.rollbackFile, 'utf8'));
  const versionDir = join(config.installRoot, 'versions', record.previousVersion);
  if (!existsSync(versionDir)) throw new Error(`找不到舊版程式：${record.previousVersion}`);
  const restored = restoreBackup(record.databaseBackup, config.dbPath, { pidFile });
  mkdirSync(dirname(config.update.currentFile), { recursive: true });
  const temp = `${config.update.currentFile}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: record.previousVersion }, null, 2));
  rmSync(config.update.currentFile, { force: true });
  renameSync(temp, config.update.currentFile);
  return { version: record.previousVersion, restored };
}
