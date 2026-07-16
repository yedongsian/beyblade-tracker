import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db/database.js';
import {
  createAutomaticBackupIfDue, createBackup, listBackups, restoreBackup,
} from '../src/maintenance/backup.js';
import { upsertSource } from '../src/core/store.js';

test('consistent backup restores into another folder with data intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-backup-'));
  const originalPath = join(root, 'original', 'tracker.db');
  const backupDir = join(root, 'backups');
  const restoredPath = join(root, 'restored', 'tracker.db');

  mkdirSync(join(root, 'original'), { recursive: true });
  const original = new Database(originalPath);
  upsertSource(original, { key: 'retained-source', connector: 'fixture' });
  original.close();

  const backup = createBackup(originalPath, backupDir);
  assert.equal(backup.integrity, 'ok');
  const restored = restoreBackup(backup.path, restoredPath);
  assert.equal(restored.integrity, 'ok');

  const db = new Database(restoredPath);
  assert.equal(db.get("SELECT COUNT(*) n FROM sources WHERE key='retained-source'").n, 1);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

test('automatic backup observes interval and retention count', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-auto-backup-'));
  const dbPath = join(root, 'tracker.db');
  const backupDir = join(root, 'backups');
  const db = new Database(dbPath);
  db.close();

  assert.ok(createAutomaticBackupIfDue(dbPath, backupDir, { intervalHours: 24, retentionCount: 2 }));
  assert.equal(createAutomaticBackupIfDue(dbPath, backupDir, { intervalHours: 24 }), null);
  createBackup(dbPath, backupDir, { prefix: 'manual', retentionCount: 1 });
  assert.equal(listBackups(backupDir).length, 1);
  rmSync(root, { recursive: true, force: true });
});

test('restore refuses while the recorded service PID is alive', () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-restore-lock-'));
  const dbPath = join(root, 'tracker.db');
  const backupDir = join(root, 'backups');
  const pidFile = join(root, 'tracker.pid');
  const db = new Database(dbPath);
  db.close();
  const backup = createBackup(dbPath, backupDir);
  writeFileSync(pidFile, String(process.pid));
  assert.throws(
    () => restoreBackup(backup.path, join(root, 'restored.db'), { pidFile }),
    /仍在執行中/
  );
  rmSync(root, { recursive: true, force: true });
});
