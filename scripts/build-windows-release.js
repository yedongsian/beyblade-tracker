#!/usr/bin/env node
import { createHash, createPublicKey, sign } from 'node:crypto';
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

// config/sources.json is gitignored and holds whatever this machine happens to track.
// Shipping it makes the released default source list depend on the build machine and
// pushes the builder's own configuration to every user, who then starts crawling sites
// they never added. config.js already falls back to config/sources.example.json, which
// is the tracked, intended default.
const EXCLUDED_FROM_PAYLOAD = new Set([resolve(ROOT, 'config', 'sources.json')]);

function copyTree(source, destination) {
  if (EXCLUDED_FROM_PAYLOAD.has(resolve(source))) return;
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
// fixtures ships because sources.example.json — the default a fresh install now falls
// back to — enables an offline demo source that reads fixtures/beyblade-x.json.
for (const entry of ['bin', 'config', 'fixtures', 'src', 'scripts', 'node_modules']) {
  copyTree(join(ROOT, entry), join(PAYLOAD, entry));
}
for (const entry of ['package.json', 'package-lock.json', 'README.md', 'INSTALL.md', 'PRIVACY.md', 'SOURCE_POLICY.md', 'SOURCE_DEVELOPMENT.md', 'TROUBLESHOOTING.md', 'RELEASE_GUIDE.md']) {
  const source = join(ROOT, entry);
  if (existsSync(source)) copyTree(source, join(PAYLOAD, entry));
}
// Fail the build rather than ship a payload carrying the builder's own source list.
for (const forbidden of EXCLUDED_FROM_PAYLOAD) {
  const shipped = join(PAYLOAD, forbidden.slice(resolve(ROOT).length + 1));
  if (existsSync(shipped)) throw new Error(`發佈內容不得包含建置機的個人設定：${shipped}`);
}
if (!existsSync(join(PAYLOAD, 'config', 'sources.example.json'))) {
  throw new Error('發佈內容缺少 config/sources.example.json，全新安裝將沒有可用的預設來源。');
}
// The example config enables this fixture, so a payload without it would ship a
// default source that fails on every crawl.
for (const source of JSON.parse(readFileSync(join(PAYLOAD, 'config', 'sources.example.json'), 'utf8')).sources || []) {
  if (!source.enabled || source.connector !== 'fixture' || !source.config?.file) continue;
  if (!existsSync(join(PAYLOAD, source.config.file))) {
    throw new Error(`預設來源 ${source.key} 需要的 fixture 未被打包：${source.config.file}`);
  }
}

copyTree(process.execPath, join(PAYLOAD, 'runtime', 'node.exe'));

// The verification key ships with the product; it is public by definition, and without it no
// ordinary user can verify an update at all (BT-UPD-002). It is DERIVED from the signing key rather
// than read from a second file on purpose: a mismatched pair fails as BT-UPD-003, which is
// indistinguishable from "no key configured" and painful to diagnose. Derivation cannot mismatch.
const signingKeyPath = process.env.RELEASE_SIGNING_KEY_FILE;
const shippedPublicKey = signingKeyPath
  ? createPublicKey(readFileSync(signingKeyPath, 'utf8')).export({ type: 'spki', format: 'pem' }).toString()
  : '';

// A version-pinned manifest URL would make every build check only its own release and never find a
// successor. GitHub's /releases/latest/download/ always resolves to the newest non-prerelease, so
// promoting a release is what ships it.
const shippedManifestUrl = process.env.UPDATE_MANIFEST_URL_TEMPLATE ||
  (process.env.RELEASE_REPO ? `https://github.com/${process.env.RELEASE_REPO}/releases/latest/download/release-manifest.json` : '');

writeFileSync(join(PAYLOAD, 'release.json'), JSON.stringify({
  version: APP_VERSION, schemaVersion: CURRENT_SCHEMA_VERSION, builtAt: new Date().toISOString(),
  nodeVersion: process.version, architecture: process.arch, browserStrategy: 'system-chrome',
  updateManifestUrl: shippedManifestUrl, updatePublicKey: shippedPublicKey,
}, null, 2));

if (!shippedPublicKey) console.warn('警告：未設定 RELEASE_SIGNING_KEY_FILE，產物不含驗證公鑰，使用者將無法驗證更新。');
if (!shippedManifestUrl) console.warn('警告：未設定 RELEASE_REPO，產物不含更新來源，使用者將收不到更新。');

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
