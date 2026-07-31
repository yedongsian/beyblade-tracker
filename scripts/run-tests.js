import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const LOOPBACK_NO_PROXY = Object.freeze(['127.0.0.1', 'localhost', '::1']);

export function createTestEnvironment(source = process.env) {
  const env = {};
  const bypasses = [];

  for (const [name, value] of Object.entries(source)) {
    if (name.toUpperCase() === 'NO_PROXY') {
      bypasses.push(...String(value || '').split(',').map((item) => item.trim()).filter(Boolean));
    } else {
      env[name] = value;
    }
  }

  const seen = new Set();
  env.NO_PROXY = [...bypasses, ...LOOPBACK_NO_PROXY]
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(',');
  // Structured operation logs are covered by their persisted-event tests; do
  // not emit thousands of records during the retention test.
  env.OPERATION_LOGS = '0';
  return env;
}

export function runTests() {
  const result = spawnSync(process.execPath, [
    '--no-warnings', '--test', 'test/**/*.test.js',
  ], {
    cwd: process.cwd(),
    env: createTestEnvironment(),
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTests();
}
