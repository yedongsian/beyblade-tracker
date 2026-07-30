const STATUS_PHASES = new Set(['starting', 'running', 'stopping']);

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
