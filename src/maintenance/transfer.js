import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createBackup, restoreBackup, verifyDatabase } from './backup.js';
import { APP_VERSION } from '../release/version.js';

export const TRANSFER_FORMAT = 'beyblade-transfer-v1';

function hash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  rmSync(path, { force: true });
  renameSync(temp, path);
}

export function createTransferBundle(config) {
  if (!existsSync(config.dbPath)) throw new Error(`找不到資料庫：${config.dbPath}`);
  const work = mkdtempSync(join(tmpdir(), 'beyblade-transfer-'));
  try {
    const snapshot = createBackup(config.dbPath, work, { prefix: 'transfer', retentionCount: 2 });
    const database = readFileSync(snapshot.path);
    const sources = config.sourcesPath && existsSync(config.sourcesPath)
      ? readFileSync(config.sourcesPath) : Buffer.from('{"sources":[]}');
    const payload = {
      format: TRANSFER_FORMAT,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      schemaVersion: snapshot.userVersion,
      exclusions: ['secrets', 'runtime', 'logs', 'debug-html'],
      files: {
        'tracker.db': { sha256: hash(database), base64: database.toString('base64') },
        'sources.json': { sha256: hash(sources), base64: sources.toString('base64') },
      },
    };
    return gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function inspectTransferBundle(input) {
  let payload;
  try { payload = JSON.parse(gunzipSync(input).toString('utf8')); }
  catch { throw new Error('移機檔不是有效的 Beyblade Tracker 匯出檔。'); }
  if (payload.format !== TRANSFER_FORMAT || !payload.files?.['tracker.db'] || !payload.files?.['sources.json']) {
    throw new Error('移機檔格式或必要檔案不完整。');
  }
  const files = Object.fromEntries(Object.entries(payload.files).map(([name, item]) => {
    const buffer = Buffer.from(item.base64 || '', 'base64');
    if (!item.sha256 || hash(buffer) !== item.sha256) throw new Error(`移機檔校驗失敗：${name}`);
    return [name, buffer];
  }));
  const work = mkdtempSync(join(tmpdir(), 'beyblade-transfer-check-'));
  try {
    const dbPath = join(work, 'tracker.db');
    writeFileSync(dbPath, files['tracker.db']);
    const verification = verifyDatabase(dbPath);
    JSON.parse(files['sources.json'].toString('utf8'));
    return {
      metadata: {
        format: payload.format, createdAt: payload.createdAt, appVersion: payload.appVersion,
        schemaVersion: payload.schemaVersion, exclusions: payload.exclusions || [],
      },
      files,
      verification,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function exportTransferBundle(config, destination) {
  const target = resolve(destination || join(config.exportDir, `beyblade-transfer-${timestamp()}.beyblade-transfer`));
  atomicWrite(target, createTransferBundle(config));
  return { path: target, name: basename(target), ...inspectTransferBundle(readFileSync(target)).metadata };
}

export function stageTransferImport(input, config) {
  const inspected = inspectTransferBundle(input);
  atomicWrite(config.pendingImportFile, input);
  return { path: config.pendingImportFile, ...inspected.metadata, verification: inspected.verification };
}

export function applyPendingTransfer(config, { pidFile } = {}) {
  if (!config.pendingImportFile || !existsSync(config.pendingImportFile)) return null;
  const inspected = inspectTransferBundle(readFileSync(config.pendingImportFile));
  const work = mkdtempSync(join(tmpdir(), 'beyblade-transfer-apply-'));
  try {
    const incomingDb = join(work, 'tracker.db');
    writeFileSync(incomingDb, inspected.files['tracker.db']);
    // This runs inside the service that already owns the PID file.
    const restored = restoreBackup(incomingDb, config.dbPath, { pidFile, ignorePid: process.pid });
    atomicWrite(config.userSourcesPath || config.sourcesPath, inspected.files['sources.json']);
    rmSync(config.pendingImportFile, { force: true });
    return { ...restored, metadata: inspected.metadata };
  } catch (err) {
    // This runs during startup, so a pending file that survives a failure would be
    // retried on every launch and leave the service permanently unable to start.
    // Move it aside first: a failed import must cost the import, not the install.
    const failedPath = `${config.pendingImportFile}.failed-${timestamp()}`;
    try { renameSync(config.pendingImportFile, failedPath); }
    catch { rmSync(config.pendingImportFile, { force: true }); }
    err.pendingImportMovedTo = failedPath;
    throw err;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
