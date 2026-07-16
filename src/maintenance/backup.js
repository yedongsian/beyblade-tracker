import { DatabaseSync } from 'node:sqlite';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function uniquePath(path) {
  if (!existsSync(path)) return path;
  const suffix = path.endsWith('.db') ? '.db' : '';
  const base = suffix ? path.slice(0, -suffix.length) : path;
  let index = 1;
  while (existsSync(`${base}-${index}${suffix}`)) index += 1;
  return `${base}-${index}${suffix}`;
}

export function verifyDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    const userVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
    if (integrity !== 'ok') throw new Error(`資料庫完整性檢查失敗：${integrity}`);
    return { integrity, userVersion };
  } finally {
    db.close();
  }
}

export function listBackups(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const path = join(backupDir, name);
      return { name, path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function pruneBackups(backupDir, { retentionDays = 30, retentionCount = 30 } = {}) {
  const files = listBackups(backupDir);
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
  const removed = [];
  for (const [index, file] of files.entries()) {
    if (index >= retentionCount || file.mtimeMs < cutoff) {
      rmSync(file.path, { force: true });
      removed.push(file.path);
    }
  }
  return removed;
}

/** Creates a transactionally consistent SQLite snapshot, including WAL data. */
export function createBackup(dbPath, backupDir, { prefix = 'tracker', retentionDays = 30, retentionCount = 30 } = {}) {
  if (!existsSync(dbPath)) return null;
  mkdirSync(backupDir, { recursive: true });
  const destination = uniquePath(join(backupDir, `${prefix}-${stamp()}.db`));
  const source = new DatabaseSync(dbPath);
  try {
    source.exec('PRAGMA busy_timeout = 5000;');
    source.exec(`VACUUM INTO ${quoteSql(resolve(destination))};`);
  } finally {
    source.close();
  }
  const verification = verifyDatabase(destination);
  pruneBackups(backupDir, { retentionDays, retentionCount });
  return { path: destination, ...verification };
}

export function createAutomaticBackupIfDue(dbPath, backupDir, options = {}) {
  const intervalHours = options.intervalHours ?? 24;
  if (!existsSync(dbPath) || options.enabled === false) return null;
  const latestAuto = listBackups(backupDir).find((file) => file.name.startsWith('auto-'));
  if (latestAuto && Date.now() - latestAuto.mtimeMs < intervalHours * 3600 * 1000) return null;
  return createBackup(dbPath, backupDir, { ...options, prefix: 'auto' });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function restoreBackup(sourcePath, destinationPath, { pidFile, pidFiles = [] } = {}) {
  if (!existsSync(sourcePath)) throw new Error(`找不到備份檔：${sourcePath}`);
  verifyDatabase(sourcePath);
  mkdirSync(dirname(destinationPath), { recursive: true });

  const allPidFiles = [pidFile, ...pidFiles].filter(Boolean);
  for (const candidate of allPidFiles) {
    if (!existsSync(candidate)) continue;
    const pid = Number(readFileSync(candidate, 'utf8').trim());
    if (isProcessAlive(pid)) throw new Error(`Tracker 仍在執行中 (PID=${pid})，請先停止服務再還原。`);
  }

  const temp = `${destinationPath}.restore-${process.pid}.tmp`;
  copyFileSync(sourcePath, temp);
  verifyDatabase(temp);

  let displaced = null;
  if (existsSync(destinationPath)) {
    displaced = uniquePath(join(
      dirname(destinationPath), `${basename(destinationPath, '.db')}-before-restore-${stamp()}.db`
    ));
    renameSync(destinationPath, displaced);
  }
  rmSync(`${destinationPath}-wal`, { force: true });
  rmSync(`${destinationPath}-shm`, { force: true });
  renameSync(temp, destinationPath);
  return { path: destinationPath, displaced, ...verifyDatabase(destinationPath) };
}
