import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const APP_VERSION = packageJson.version;
export const RELEASE_CHANNEL = process.env.RELEASE_CHANNEL || 'stable';

export function releaseInfo(config = {}) {
  return {
    version: APP_VERSION,
    channel: RELEASE_CHANNEL,
    installed: Boolean(process.env.BEYBLADE_USER_ROOT),
    updateManifestUrl: config.update?.manifestUrl || null,
  };
}
