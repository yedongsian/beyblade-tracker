import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

function migrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  return files.map((name, index) => {
    const version = Number(name.slice(0, 3));
    if (version !== index + 1) {
      throw new Error(`資料庫 migration 版本不連續：預期 ${index + 1}，實際 ${version} (${name})`);
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { version, name, sql, checksum };
  });
}

export const CURRENT_SCHEMA_VERSION = migrationFiles().at(-1)?.version || 0;

/**
 * Thin wrapper around node:sqlite's DatabaseSync.
 * Uses an in-memory DB when path is ':memory:' (handy for tests).
 */
export class Database {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const current = Number(this.db.prepare('PRAGMA user_version').get().user_version || 0);
    if (current > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `資料庫版本 ${current} 比目前程式支援的 ${CURRENT_SCHEMA_VERSION} 新，請更新程式後再開啟。`
      );
    }

    const migrations = migrationFiles();
    for (const migration of migrations) {
      const recorded = this.db.prepare(
        'SELECT name, checksum FROM schema_migrations WHERE version = ?'
      ).get(migration.version);
      if (recorded && recorded.checksum !== migration.checksum) {
        throw new Error(`資料庫 migration ${migration.name} 的校驗碼不符，拒絕繼續升級。`);
      }
      if (migration.version <= current) {
        if (!recorded) {
          this.db.prepare(
            `INSERT INTO schema_migrations (version, name, checksum, applied_at)
             VALUES (?, ?, ?, ?)`
          ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
        }
        continue;
      }

      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(migration.sql);
        this.db.prepare(
          `INSERT OR REPLACE INTO schema_migrations
            (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)`
        ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
        this.db.exec(`PRAGMA user_version = ${migration.version};`);
        this.db.exec('COMMIT;');
      } catch (err) {
        try { this.db.exec('ROLLBACK;'); } catch { /* already rolled back */ }
        throw new Error(`資料庫升級 ${migration.name} 失敗：${err.message}`);
      }
    }
  }

  run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

export function openDatabase(path) {
  return new Database(path);
}
