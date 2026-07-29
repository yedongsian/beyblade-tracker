import { isAbsolute, join } from 'node:path';

function absolute(root, value, fallback) {
  const selected = value || fallback;
  return isAbsolute(selected) ? selected : join(root, selected);
}

export function projectPaths(root = process.cwd(), env = process.env) {
  const appRoot = absolute(root, env.BEYBLADE_APP_ROOT, '.');
  const installRoot = absolute(appRoot, env.BEYBLADE_INSTALL_ROOT, '.');
  const userRoot = absolute(root, env.BEYBLADE_USER_ROOT, '.');
  const runtimeDir = absolute(userRoot, env.RUNTIME_DIR, 'runtime');
  const configDir = absolute(userRoot, env.CONFIG_DIR, 'config');
  return {
    root: appRoot,
    appRoot,
    installRoot,
    userRoot,
    dataDir: absolute(userRoot, env.DATA_DIR, 'data'),
    configDir,
    runtimeDir,
    backupDir: absolute(userRoot, env.BACKUP_DIR, 'backups'),
    exportDir: absolute(userRoot, env.EXPORT_DIR, 'exports'),
    releaseDir: absolute(userRoot, env.RELEASE_DIR, 'releases'),
    logDir: absolute(userRoot, env.LOG_DIR, 'logs'),
    secretFile: absolute(configDir, env.SECRET_FILE, 'secrets.json'),
    sourcesFile: absolute(configDir, env.SOURCES_FILE, 'sources.json'),
    pendingImportFile: join(runtimeDir, 'pending-import.beyblade-transfer'),
    rollbackFile: join(runtimeDir, 'rollback.json'),
    updateHealthFile: join(runtimeDir, 'update-health.json'),
    pidFile: join(runtimeDir, 'tracker.pid'),
    statusFile: join(runtimeDir, 'tracker-status.json'),
    stopFile: join(runtimeDir, 'stop.request'),
    debugDir: absolute(userRoot, env.DEBUG_HTML_DIR, join('runtime', 'debug')),
  };
}
