import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load a .env file into process.env if present. Uses Node's built-in loader
 * (available since v20.12) and never overwrites variables already set.
 */
export function loadEnv(cwd = process.cwd()) {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return false;
  try {
    process.loadEnvFile(envPath);
    return true;
  } catch {
    return false;
  }
}
