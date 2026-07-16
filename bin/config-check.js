#!/usr/bin/env node
import { getConfig, loadSourcesResult } from '../src/config.js';
import { loadEnv } from '../src/util/env.js';

try {
  loadEnv();
  const config = getConfig();
  const result = loadSourcesResult(config.sourcesPath);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  console.log(`設定有效：${result.sources.length} 個來源；資料庫 ${config.dbPath}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
