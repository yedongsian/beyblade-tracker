import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function browserCandidates(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return [];
  return [
    env.CHROME_PATH,
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

export function detectSupportedBrowser({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const path = browserCandidates(env, platform).find((candidate) => exists(candidate)) || null;
  return {
    available: Boolean(path),
    name: path ? 'Google Chrome' : null,
    path,
    strategy: 'system-chrome',
    downloadUrl: 'https://www.google.com/chrome/',
  };
}
