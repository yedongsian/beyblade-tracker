import { canAttemptGracefulStop, canForceTerminate, classifyServiceProcess } from './service-process.js';

export const STOP_TIMEOUT_MS = 35_000;
// A first start does real work before the service reports ready: schema migrations,
// an automatic backup, and applying any pending transfer. Measured on Windows it took
// 18s after install and 37.5s at logon, so the previous 15s budget reported failure
// for startups that were actually succeeding.
export const START_TIMEOUT_MS = 60_000;
const STOP_POLL_MS = 500;
const START_POLL_MS = 300;

function safeCall(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

function classify({ inspectProcess, executablePath, serviceFile }, pid, status) {
  const identity = safeCall(() => inspectProcess(pid), null);
  return classifyServiceProcess(identity, {
    pid, status, executablePath, serviceFile, startedAt: status?.startedAt,
  });
}

export function resolveStopDecision(ownership, status, pid) {
  if (ownership === 'other') return 'refuse';
  if (canForceTerminate(ownership)) return 'graceful';
  return canAttemptGracefulStop(status, pid) ? 'graceful' : 'refuse';
}

export function resolveStartDecision(ownership) {
  if (canForceTerminate(ownership)) return 'already-running';
  return ownership === 'other' ? 'clear-stale' : 'refuse';
}

/**
 * `other` is never touched and `unknown` never authorizes a force kill; ownership is re-read after the
 * bounded wait because the PID may have been reused while the Tracker was shutting down.
 */
export async function runStopSequence(deps) {
  const {
    readPid, readStatus, isAlive, writeStopRequest, clearPid, clearStopRequest, forceTerminate,
    sleep, now = Date.now, timeoutMs = STOP_TIMEOUT_MS, pollMs = STOP_POLL_MS,
  } = deps;
  const pid = safeCall(readPid, null);
  if (!pid) return { ok: true, outcome: 'not-running' };
  if (!isAlive(pid)) {
    clearPid();
    return { ok: true, outcome: 'not-running', pid };
  }
  const status = safeCall(readStatus, null);
  const ownership = classify(deps, pid, status);
  if (resolveStopDecision(ownership, status, pid) === 'refuse') {
    return { ok: false, outcome: 'refused', pid, ownership };
  }

  writeStopRequest(pid);
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollMs);
    if (!isAlive(pid)) return { ok: true, outcome: 'graceful', pid, ownership };
  }

  const recheck = classify(deps, pid, safeCall(readStatus, null));
  if (!canForceTerminate(recheck)) return { ok: false, outcome: 'force-refused', pid, ownership: recheck };
  try { forceTerminate(pid); } catch { return { ok: false, outcome: 'force-failed', pid, ownership: recheck }; }
  clearPid();
  clearStopRequest();
  return { ok: true, outcome: 'forced', pid, ownership: recheck };
}

/**
 * A live PID is only "already running" when ownership is verified; a reused PID owned by another process
 * is cleared from the Tracker's own metadata without ever terminating that process.
 */
export async function runStartSequence(deps) {
  const {
    readPid, readStatus, isAlive, clearPid, clearStopRequest, spawnService,
    sleep, now = Date.now, timeoutMs = START_TIMEOUT_MS, pollMs = START_POLL_MS,
  } = deps;
  const pid = safeCall(readPid, null);
  if (pid && isAlive(pid)) {
    const ownership = classify(deps, pid, safeCall(readStatus, null));
    const decision = resolveStartDecision(ownership);
    if (decision === 'already-running') return { ok: true, outcome: 'already-running', pid, ownership };
    if (decision === 'refuse') return { ok: false, outcome: 'refused', pid, ownership };
    clearPid();
  } else if (pid) {
    clearPid();
  }
  clearStopRequest();

  let child;
  try { child = spawnService(); } catch { return { ok: false, outcome: 'spawn-failed' }; }
  const childPid = child?.pid;
  if (!childPid) return { ok: false, outcome: 'spawn-failed' };

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollMs);
    const status = safeCall(readStatus, null);
    if (status?.pid === childPid && status.status === 'running') {
      return { ok: true, outcome: 'started', pid: childPid, status };
    }
    if (!isAlive(childPid)) return { ok: false, outcome: 'exited', pid: childPid, status };
  }
  return { ok: false, outcome: 'timeout', pid: childPid };
}
