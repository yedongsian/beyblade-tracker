import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { logger } from './util/logger.js';
import { projectPaths } from './paths.js';
import { detectSupportedBrowser } from './release/browser.js';

const ROOT = process.cwd();
const CONNECTOR_TYPES = new Set(['fixture', 'jsonld', 'browser']);

function resolvePath(p, fallback) {
  const chosen = p || fallback;
  return isAbsolute(chosen) ? chosen : join(ROOT, chosen);
}

/**
 * Where the update settings come from in a shipped build. Both used to be environment variables
 * defaulting to empty, which meant an ordinary user got no update source at all and, if they somehow
 * set one, BT-UPD-003 for the missing key. Every update round so far only worked because acceptance
 * set those variables by hand - a test procedure standing in for a product feature (BT-UPD-002).
 *
 * The public key is public by definition and belongs in the payload. The environment still wins so
 * acceptance can point a build at a specific manifest.
 */
function releaseUpdateDefaults(appRoot) {
  try {
    const file = join(appRoot, 'release.json');
    if (!existsSync(file)) return {};
    const release = JSON.parse(readFileSync(file, 'utf8'));
    return {
      manifestUrl: typeof release.updateManifestUrl === 'string' ? release.updateManifestUrl : '',
      publicKey: typeof release.updatePublicKey === 'string' ? release.updatePublicKey : '',
    };
  } catch {
    // A malformed release.json must not stop the app from starting; it only costs update checks.
    return {};
  }
}

export class ConfigValidationError extends Error {
  constructor(issues) {
    super(`設定有誤：\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

function numberSetting(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}, issues) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    issues.push(`${name} 必須是 ${min} 到 ${max} 之間${integer ? '的整數' : '的數字'}。`);
  }
  return value;
}

/** Application configuration with validated, user-facing errors. */
export function getConfig() {
  const issues = [];
  const paths = projectPaths(ROOT);
  const shippedUpdate = releaseUpdateDefaults(paths.appRoot);
  const sourcesPath = resolvePath(
    process.env.SOURCES_FILE,
    existsSync(paths.sourcesFile)
      ? paths.sourcesFile
      : existsSync(join(paths.appRoot, 'config', 'sources.json'))
        ? join(paths.appRoot, 'config', 'sources.json')
        : join(paths.appRoot, 'config', 'sources.example.json')
  );

  const webPort = numberSetting('WEB_PORT', 8787, { min: 1, max: 65535, integer: true }, issues);
  const rawRetentionHours = numberSetting('RAW_RETENTION_HOURS', 72, { min: 1 }, issues);
  const eventCooldownSeconds = numberSetting('EVENT_COOLDOWN_SECONDS', 6 * 3600, { min: 0 }, issues);
  const priceChangeThreshold = numberSetting('PRICE_CHANGE_THRESHOLD', 0.05, { min: 0, max: 1 }, issues);
  const offerStabilityConfirmations = numberSetting('OFFER_STABILITY_CONFIRMATIONS', 2, { min: 1, max: 10, integer: true }, issues);
  const timeoutMs = numberSetting('HTTP_TIMEOUT_MS', 15000, { min: 100, integer: true }, issues);
  const maxRetries = numberSetting('HTTP_MAX_RETRIES', 3, { min: 0, max: 10, integer: true }, issues);
  const hostInterval = numberSetting('HTTP_PER_HOST_INTERVAL_MS', 2000, { min: 0, integer: true }, issues);
  const backupIntervalHours = numberSetting('BACKUP_INTERVAL_HOURS', 24, { min: 1 }, issues);
  const backupRetentionDays = numberSetting('BACKUP_RETENTION_DAYS', 30, { min: 1, integer: true }, issues);
  const backupRetentionCount = numberSetting('BACKUP_RETENTION_COUNT', 30, { min: 1, integer: true }, issues);
  const networkEnabled = process.env.NETWORK_ENABLED !== '0';

  const host = process.env.WEB_HOST || '127.0.0.1';
  if (!host.trim()) issues.push('WEB_HOST 不可為空白。');
  if (issues.length) throw new ConfigValidationError(issues);

  return {
    appRoot: paths.appRoot,
    installRoot: paths.installRoot,
    userRoot: paths.userRoot,
    dbPath: process.env.DB_PATH ? resolvePath(process.env.DB_PATH, process.env.DB_PATH) : join(paths.dataDir, 'tracker.db'),
    sourcesPath,
    userSourcesPath: paths.sourcesFile,
    secretFile: paths.secretFile,
    exportDir: paths.exportDir,
    releaseDir: paths.releaseDir,
    pendingImportFile: paths.pendingImportFile,
    pidFile: paths.pidFile,
    statusFile: paths.statusFile,
    runtimeDir: paths.runtimeDir,
    debugDir: paths.debugDir,
    debugHtml: process.env.DEBUG_HTML === '1',
    rawRetentionHours,
    web: { port: webPort, host },
    preorderIsPurchasable: process.env.PREORDER_PURCHASABLE === '1',
    eventCooldownSeconds,
    priceChangeThreshold,
    offerStabilityConfirmations,
    http: {
      timeoutMs,
      maxRetries,
      userAgent: process.env.HTTP_USER_AGENT ||
        'BeybladeTracker/0.1 (+personal-use; respects robots and rate limits)',
      perHostMinIntervalMs: hostInterval,
    },
    network: { enabled: networkEnabled },
    browser: detectSupportedBrowser(),
    update: {
      manifestUrl: process.env.UPDATE_MANIFEST_URL || shippedUpdate.manifestUrl || '',
      publicKey: process.env.UPDATE_PUBLIC_KEY || shippedUpdate.publicKey || '',
      currentFile: join(paths.installRoot, 'current.json'),
      rollbackFile: paths.rollbackFile,
      rollbackStatusFile: paths.rollbackStatusFile,
      healthFile: paths.updateHealthFile,
    },
    backup: {
      enabled: process.env.AUTO_BACKUP !== '0',
      dir: paths.backupDir,
      intervalHours: backupIntervalHours,
      retentionDays: backupRetentionDays,
      retentionCount: backupRetentionCount,
    },
    notify: {
      telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        timeoutMs,
        maxRetries,
      },
      discord: { webhook: process.env.DISCORD_WEBHOOK_URL || '', timeoutMs, maxRetries },
    },
  };
}

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateSourceDefinitions(document) {
  const list = Array.isArray(document) ? document : document?.sources;
  if (!Array.isArray(list)) return { ok: false, sources: [], errors: ['來源設定必須是陣列或 {"sources": [...]}。'] };

  const errors = [];
  const keys = new Set();
  for (const [index, source] of list.entries()) {
    const label = `第 ${index + 1} 個來源`;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      errors.push(`${label} 必須是物件。`);
      continue;
    }
    if (typeof source.key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(source.key)) {
      errors.push(`${label}的 key 必須由英數字、底線或連字號組成。`);
    } else if (keys.has(source.key)) {
      errors.push(`來源 key「${source.key}」重複。`);
    } else keys.add(source.key);
    if (!CONNECTOR_TYPES.has(source.connector)) {
      errors.push(`${label}的 connector 必須是 fixture、jsonld 或 browser。`);
    }
    if (source.enabled != null && typeof source.enabled !== 'boolean') {
      errors.push(`${label}的 enabled 必須是 true 或 false。`);
    }
    const interval = source.checkIntervalSeconds ?? source.check_interval_seconds ?? 3600;
    if (!Number.isInteger(interval) || interval < 60) {
      errors.push(`${label}的檢查週期至少要 60 秒。`);
    }
    if (source.url != null && !isHttpUrl(source.url)) errors.push(`${label}的 url 必須是 HTTP(S) 網址。`);
    if (source.recipeVersion != null && (!Number.isInteger(source.recipeVersion) || source.recipeVersion < 1)) {
      errors.push(`${label}的 recipeVersion 必須是大於 0 的整數。`);
    }
    const cfg = source.config || {};
    if (source.connector === 'fixture' &&
        !cfg.file && !Array.isArray(cfg.frames) && !Array.isArray(cfg.listings)) {
      errors.push(`${label}的 fixture connector 必須設定 file、frames 或 listings。`);
    }
    if (['jsonld', 'browser'].includes(source.connector)) {
      if (!Array.isArray(cfg.pages) || cfg.pages.length === 0) {
        errors.push(`${label}必須至少設定一個商品頁面。`);
      } else if (cfg.pages.some((page) => !isHttpUrl(page))) {
        errors.push(`${label}的商品頁面必須全部是 HTTP(S) 網址。`);
      }
    }
  }
  return { ok: errors.length === 0, sources: errors.length ? [] : list, errors };
}

export function loadSourcesResult(sourcesPath) {
  if (!existsSync(sourcesPath)) {
    const errors = [`找不到來源設定檔：${sourcesPath}`];
    errors.forEach((error) => logger.error(error));
    return { ok: false, sources: [], errors };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  } catch (err) {
    const errors = [`來源設定檔不是有效的 JSON：${err.message}`];
    errors.forEach((error) => logger.error(error));
    return { ok: false, sources: [], errors };
  }
  const result = validateSourceDefinitions(parsed);
  result.errors.forEach((error) => logger.error(error));
  return result;
}

export function loadSources(sourcesPath) {
  return loadSourcesResult(sourcesPath).sources;
}
