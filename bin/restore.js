#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { listBackups, restoreBackup } from '../src/maintenance/backup.js';
import { projectPaths } from '../src/paths.js';
import { loadEnv } from '../src/util/env.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  loadEnv();
  const config = getConfig();
  const paths = projectPaths();
  const sourceArg = argument('--from');
  const source = sourceArg ? resolve(sourceArg) : listBackups(config.backup.dir)[0]?.path;
  const destination = resolve(argument('--to') || config.dbPath);
  if (!source) throw new Error(`備份目錄中沒有可還原的 .db 檔：${config.backup.dir}`);

  const result = restoreBackup(source, destination, {
    pidFile: paths.pidFile,
    pidFiles: [join(paths.dataDir, 'tracker.pid')],
  });
  const db = openDatabase(destination);
  const version = db.get('PRAGMA user_version').user_version;
  db.close();

  console.log(`還原完成：${result.path}`);
  console.log(`完整性：${result.integrity}；schema version：${version}`);
  if (result.displaced) console.log(`還原前資料庫保留於：${result.displaced}`);
} catch (err) {
  console.error(`還原失敗：${err.message}`);
  process.exitCode = 1;
}
