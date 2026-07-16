import { isAbsolute, join } from 'node:path';

function absolute(root, value, fallback) {
  const selected = value || fallback;
  return isAbsolute(selected) ? selected : join(root, selected);
}

export function projectPaths(root = process.cwd(), env = process.env) {
  const runtimeDir = absolute(root, env.RUNTIME_DIR, 'runtime');
  return {
    root,
    dataDir: absolute(root, env.DATA_DIR, 'data'),
    runtimeDir,
    backupDir: absolute(root, env.BACKUP_DIR, 'backups'),
    logDir: absolute(root, env.LOG_DIR, 'logs'),
    pidFile: join(runtimeDir, 'tracker.pid'),
    statusFile: join(runtimeDir, 'tracker-status.json'),
    stopFile: join(runtimeDir, 'stop.request'),
    debugDir: absolute(root, env.DEBUG_HTML_DIR, join('runtime', 'debug')),
  };
}
