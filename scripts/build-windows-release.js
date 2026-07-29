#!/usr/bin/env node
import { createHash, sign } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../src/release/version.js';
import { signedPayload } from '../src/release/update.js';
import { CURRENT_SCHEMA_VERSION } from '../src/db/database.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'windows');
const PAYLOAD = join(DIST, `BeybladeTracker-${APP_VERSION}`);
const OUTPUT = join(DIST, 'installer');

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function safeClean(path) {
  const resolved = resolve(path);
  if (!resolved.startsWith(resolve(ROOT, 'dist') + '\\')) throw new Error(`拒絕清理非 dist 路徑：${resolved}`);
  rmSync(resolved, { recursive: true, force: true });
}

function copyTree(source, destination) {
  const stat = lstatSync(source);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name));
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

safeClean(DIST);
mkdirSync(join(PAYLOAD, 'runtime'), { recursive: true });
mkdirSync(OUTPUT, { recursive: true });
for (const entry of ['bin', 'config', 'src', 'scripts', 'node_modules']) {
  copyTree(join(ROOT, entry), join(PAYLOAD, entry));
}
for (const entry of ['package.json', 'package-lock.json', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'SOURCE_POLICY.md', 'SOURCE_DEVELOPMENT.md', 'TROUBLESHOOTING.md', 'RELEASE_GUIDE.md']) {
  const source = join(ROOT, entry);
  if (existsSync(source)) copyTree(source, join(PAYLOAD, entry));
}
copyTree(process.execPath, join(PAYLOAD, 'runtime', 'node.exe'));
writeFileSync(join(PAYLOAD, 'release.json'), JSON.stringify({
  version: APP_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION, builtAt: new Date().toISOString(),
  nodeVersion: process.version, architecture: process.arch, browserStrategy: 'system-chrome',
}, null, 2));

const iscc = process.env.ISCC_PATH || [
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 7', 'ISCC.exe'),
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
].find((candidate) => existsSync(candidate));

let installer = null;
if (iscc) {
  execFileSync(iscc, [join(ROOT, 'release', 'windows', 'installer.iss')], {
    cwd: join(ROOT, 'release', 'windows'), stdio: 'inherit',
    env: { ...process.env, BEYBLADE_RELEASE_VERSION: APP_VERSION, BEYBLADE_PAYLOAD_DIR: PAYLOAD, BEYBLADE_OUTPUT_DIR: OUTPUT },
  });
  installer = join(OUTPUT, `BeybladeTracker-${APP_VERSION}-Setup.exe`);
}

const baseUrl = String(process.env.RELEASE_BASE_URL || '').replace(/\/$/, '');
const manifest = {
  version: APP_VERSION,
  channel: process.env.RELEASE_CHANNEL || 'stable',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  installerUrl: installer && baseUrl ? `${baseUrl}/${basename(installer)}` : null,
  sha256: installer ? hashFile(installer) : null,
  size: installer ? statSync(installer).size : null,
  publisher: 'Beyblade Tracker',
  releaseNotes: String(process.env.RELEASE_NOTES || ''),
  publishedAt: new Date().toISOString(),
  signature: null,
  publishReady: false,
};
const keyPath = process.env.RELEASE_SIGNING_KEY_FILE;
if (installer && baseUrl && keyPath) {
  manifest.publishReady = true;
  manifest.signature = sign(null, signedPayload(manifest), readFileSync(keyPath, 'utf8')).toString('base64');
}
writeFileSync(join(DIST, 'release-manifest.json'), JSON.stringify(manifest, null, 2));

const payloadSize = statSync(join(PAYLOAD, 'runtime', 'node.exe')).size;
console.log(`Windows payload：${PAYLOAD}`);
console.log(`Node runtime：${Math.round(payloadSize / 1048576)} MB (${process.version})`);
console.log(installer ? `Installer：${installer}` : '未偵測到 Inno Setup；已完成可驗證 payload，尚未編譯 Setup.exe。');
