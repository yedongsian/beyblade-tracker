import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const STATUS_PHASES = new Set(['starting', 'running', 'stopping']);

function systemPowerShell(env = process.env) {
  const root = env.SystemRoot || env.windir;
  if (!root) return 'powershell.exe';
  const absolute = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(absolute) ? absolute : 'powershell.exe';
}

// Returns enough immutable OS metadata for classifyServiceProcess to reject a
// reused PID. Unsupported platforms and unavailable CIM metadata are unknown,
// never implicitly owned.
export function inspectProcessIdentity(pid, {
  platform = process.platform, execFile = execFileSync, env = process.env,
} = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || platform !== 'win32') return null;
  try {
    const json = execFile(systemPowerShell(env), [
      '-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object @{N='processId';E={$_.ProcessId}},@{N='executablePath';E={$_.ExecutablePath}},@{N='commandLine';E={$_.CommandLine}},@{N='createdAt';E={if ($_.CreationDate) {$_.CreationDate.ToUniversalTime().ToString('o')}}} | ConvertTo-Json -Compress)`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
    return json ? JSON.parse(json) : null;
  } catch { return null; }
}

/**
 * A matching status file only proves the Tracker itself published this PID, so it may authorize a
 * non-destructive stop request but never a force kill.
 */
export function canAttemptGracefulStop(status, pid) {
  return Boolean(status) && Number.isInteger(pid) && pid > 0 && status.service === 'beyblade-tracker' &&
    status.pid === pid && STATUS_PHASES.has(status.status);
}

export function canForceTerminate(ownership) {
  return ownership === 'owned';
}

export function normalizeWindowsPath(value) {
  return typeof value === 'string' ? value.trim().replace(/^"|"$/g, '').replaceAll('/', '\\').toLowerCase() : '';
}

export function parseProcessCreatedAt(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?[+-]\d{3}$/);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0').slice(0, 3)));
}

export function classifyServiceProcess(identity, {
  pid, status, executablePath, serviceFile, startedAt, maxStartupMs = 120_000, maxClockSkewMs = 2_000,
} = {}) {
  if (!identity || !status || !Number.isInteger(pid) || pid <= 0 || status.service !== 'beyblade-tracker' ||
      status.pid !== pid || !STATUS_PHASES.has(status.status)) return 'unknown';
  const processId = Number(identity.processId);
  const actualExecutable = normalizeWindowsPath(identity.executablePath);
  const expectedExecutable = normalizeWindowsPath(executablePath);
  const commandLine = normalizeWindowsPath(identity.commandLine);
  const expectedService = normalizeWindowsPath(serviceFile);
  const processStartedAt = parseProcessCreatedAt(identity.createdAt);
  const recordedStartedAt = parseProcessCreatedAt(startedAt || status.startedAt);
  if (!Number.isInteger(processId)) return 'unknown';
  if (processId !== pid) return 'other';
  if (actualExecutable && expectedExecutable && actualExecutable !== expectedExecutable) return 'other';
  if (commandLine && expectedService && !commandLine.includes(expectedService)) return 'other';
  if (!actualExecutable || !expectedExecutable || !commandLine || !expectedService ||
      !Number.isFinite(processStartedAt) || !Number.isFinite(recordedStartedAt)) return 'unknown';
  // The service records startedAt after its own module load, so the OS creation time must come first: a PID
  // reused by a process created after that record cannot be the process that wrote it. Cold startup can take
  // seconds, so the tolerated startup window is generous while the reuse direction stays tight.
  const startupDelayMs = recordedStartedAt - processStartedAt;
  if (startupDelayMs < -maxClockSkewMs || startupDelayMs > maxStartupMs) return 'other';
  return 'owned';
}
