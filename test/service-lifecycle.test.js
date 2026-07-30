import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStartSequence, runStopSequence } from '../src/release/service-lifecycle.js';
import { canAttemptGracefulStop, canForceTerminate } from '../src/release/service-process.js';

const EXECUTABLE = 'C:\\Tracker\\runtime\\node.exe';
const SERVICE_FILE = 'C:\\Tracker\\bin\\service.js';
const STARTED_AT = '2026-07-30T00:00:00.000Z';

const runningStatus = (pid = 4242) => ({
  service: 'beyblade-tracker', pid, status: 'running', startedAt: STARTED_AT,
});

const ownedIdentity = (pid = 4242) => ({
  processId: pid,
  executablePath: EXECUTABLE,
  commandLine: `"${EXECUTABLE}" --no-warnings "${SERVICE_FILE}"`,
  createdAt: '2026-07-29T23:59:55.000Z',
});

const otherIdentity = (pid = 4242) => ({
  processId: pid,
  executablePath: 'C:\\Windows\\System32\\notepad.exe',
  commandLine: '"C:\\Windows\\System32\\notepad.exe"',
  createdAt: '2026-07-30T05:00:00.000Z',
});

function stopHarness({ pid = 4242, status = runningStatus(), identities = [ownedIdentity()], aliveFor = Infinity }) {
  const calls = { stopRequests: [], forced: [], clearedPid: 0, clearedStop: 0, inspected: 0, sleeps: 0 };
  let clock = 1_000;
  const deps = {
    executablePath: EXECUTABLE,
    serviceFile: SERVICE_FILE,
    readPid: () => pid,
    readStatus: () => status,
    isAlive: (candidate) => candidate === pid && calls.sleeps < aliveFor,
    inspectProcess: () => identities[Math.min(calls.inspected++, identities.length - 1)],
    writeStopRequest: (target) => calls.stopRequests.push(target),
    clearPid: () => { calls.clearedPid += 1; },
    clearStopRequest: () => { calls.clearedStop += 1; },
    forceTerminate: (target) => calls.forced.push(target),
    sleep: async () => { calls.sleeps += 1; clock += 500; },
    now: () => clock,
    timeoutMs: 2000,
    pollMs: 500,
  };
  return { calls, deps };
}

test('owned service stops gracefully without any force kill', async () => {
  const { calls, deps } = stopHarness({ aliveFor: 2 });
  const result = await runStopSequence(deps);
  assert.equal(result.outcome, 'graceful');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.stopRequests, [4242]);
  assert.deepEqual(calls.forced, []);
});

test('unknown ownership with a matching status may still request a graceful stop', async () => {
  const { calls, deps } = stopHarness({ identities: [null], aliveFor: 1 });
  const result = await runStopSequence(deps);
  assert.equal(result.ownership, 'unknown');
  assert.equal(result.outcome, 'graceful');
  assert.deepEqual(calls.stopRequests, [4242]);
  assert.deepEqual(calls.forced, []);
});

test('unknown ownership without a usable status refuses to write a stop request', async () => {
  const unusable = [
    null,
    { service: 'beyblade-tracker', pid: 77, status: 'running' },
    { service: 'other-service', pid: 4242, status: 'running' },
    { service: 'beyblade-tracker', pid: 4242, status: 'stopped' },
  ];
  for (const status of unusable) {
    const { calls, deps } = stopHarness({ identities: [null], status });
    const result = await runStopSequence(deps);
    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'refused');
    assert.deepEqual(calls.stopRequests, []);
    assert.deepEqual(calls.forced, []);
  }
});

test('a foreign process is never sent a stop request nor terminated', async () => {
  const { calls, deps } = stopHarness({ identities: [otherIdentity()] });
  const result = await runStopSequence(deps);
  assert.equal(result.ownership, 'other');
  assert.equal(result.outcome, 'refused');
  assert.deepEqual(calls.stopRequests, []);
  assert.deepEqual(calls.forced, []);
});

test('a PID reused by another process after the timeout is never force killed', async () => {
  const { calls, deps } = stopHarness({ identities: [ownedIdentity(), otherIdentity()] });
  const result = await runStopSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'force-refused');
  assert.deepEqual(calls.stopRequests, [4242]);
  assert.deepEqual(calls.forced, []);
  assert.ok(calls.inspected >= 2, 'ownership must be re-read after the bounded wait');
});

test('an unresponsive but still owned service is force killed by exact PID only', async () => {
  const { calls, deps } = stopHarness({ identities: [ownedIdentity(), ownedIdentity()] });
  const result = await runStopSequence(deps);
  assert.equal(result.outcome, 'forced');
  assert.deepEqual(calls.forced, [4242]);
  assert.equal(calls.clearedPid, 1);
  assert.equal(calls.clearedStop, 1);
});

test('a failing force command reports a non-zero outcome instead of throwing', async () => {
  const { calls, deps } = stopHarness({ identities: [ownedIdentity(), ownedIdentity()] });
  deps.forceTerminate = () => { throw new Error('Access is denied. C:\\secret\\path'); };
  const result = await runStopSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'force-failed');
  assert.equal(calls.clearedPid, 0);
});

test('an unavailable identity helper degrades to unknown without throwing', async () => {
  const { calls, deps } = stopHarness({ aliveFor: 1 });
  deps.inspectProcess = () => { throw new Error('powershell.exe is not recognized'); };
  const result = await runStopSequence(deps);
  assert.equal(result.ownership, 'unknown');
  assert.equal(result.outcome, 'graceful');
  assert.deepEqual(calls.stopRequests, [4242]);
});

test('a dead PID file is cleared and reported as not running', async () => {
  const { calls, deps } = stopHarness({});
  deps.isAlive = () => false;
  const result = await runStopSequence(deps);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'not-running');
  assert.equal(calls.clearedPid, 1);
  assert.deepEqual(calls.stopRequests, []);
});

function startHarness({ pid = null, identities = [ownedIdentity()], statuses = [], childPid = 5150, alive = () => true }) {
  const calls = { spawns: 0, clearedPid: 0, clearedStop: 0, sleeps: 0 };
  let clock = 1_000;
  const deps = {
    executablePath: EXECUTABLE,
    serviceFile: SERVICE_FILE,
    readPid: () => pid,
    readStatus: () => (calls.spawns ? statuses[Math.min(calls.sleeps, statuses.length - 1)] : runningStatus(pid)),
    isAlive: (candidate) => alive(candidate, calls),
    inspectProcess: () => identities[0],
    clearPid: () => { calls.clearedPid += 1; },
    clearStopRequest: () => { calls.clearedStop += 1; },
    spawnService: () => { calls.spawns += 1; return { pid: childPid }; },
    sleep: async () => { calls.sleeps += 1; clock += 300; },
    now: () => clock,
    timeoutMs: 1200,
    pollMs: 300,
  };
  return { calls, deps };
}

test('start spawns exactly once when no PID file exists', async () => {
  const { calls, deps } = startHarness({ statuses: [{ service: 'beyblade-tracker', pid: 5150, status: 'running' }] });
  const result = await runStartSequence(deps);
  assert.equal(result.outcome, 'started');
  assert.equal(calls.spawns, 1);
  assert.equal(calls.clearedStop, 1, 'a stale stop request must be cleared before spawning');
});

test('start clears a dead PID file and spawns exactly once', async () => {
  const { calls, deps } = startHarness({
    pid: 4242,
    statuses: [{ service: 'beyblade-tracker', pid: 5150, status: 'running' }],
    alive: (candidate) => candidate === 5150,
  });
  const result = await runStartSequence(deps);
  assert.equal(result.outcome, 'started');
  assert.equal(calls.clearedPid, 1);
  assert.equal(calls.spawns, 1);
});

test('start reports an owned live service without spawning a second one', async () => {
  const { calls, deps } = startHarness({ pid: 4242 });
  const result = await runStartSequence(deps);
  assert.equal(result.outcome, 'already-running');
  assert.equal(result.pid, 4242);
  assert.equal(calls.spawns, 0);
  assert.equal(calls.clearedPid, 0);
});

test('start treats a PID reused by another process as stale without killing it', async () => {
  const { calls, deps } = startHarness({
    pid: 4242,
    identities: [otherIdentity()],
    statuses: [{ service: 'beyblade-tracker', pid: 5150, status: 'running' }],
  });
  const result = await runStartSequence(deps);
  assert.equal(result.outcome, 'started');
  assert.equal(calls.clearedPid, 1);
  assert.equal(calls.spawns, 1);
  assert.equal(deps.forceTerminate, undefined, 'the start path must not be able to terminate anything');
});

test('start refuses to claim or duplicate a service when ownership is unknown', async () => {
  const { calls, deps } = startHarness({ pid: 4242, identities: [null] });
  deps.readStatus = () => null;
  const result = await runStartSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'refused');
  assert.equal(calls.spawns, 0);
  assert.equal(calls.clearedPid, 0);
});

test('start does not claim a running service when the status PID disagrees with the PID file', async () => {
  const { calls, deps } = startHarness({ pid: 4242 });
  deps.readStatus = () => ({ service: 'beyblade-tracker', pid: 9999, status: 'running' });
  const result = await runStartSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'refused');
  assert.equal(calls.spawns, 0);
});

test('start reports a failed spawn once instead of retrying', async () => {
  const { calls, deps } = startHarness({ statuses: [{ service: 'beyblade-tracker', pid: 5150, status: 'starting', error: 'port busy' }] });
  deps.isAlive = (candidate) => candidate !== 5150 && candidate !== null;
  const result = await runStartSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'exited');
  assert.equal(calls.spawns, 1);
});

test('start times out without claiming success', async () => {
  const { calls, deps } = startHarness({ statuses: [{ service: 'beyblade-tracker', pid: 5150, status: 'starting' }] });
  const result = await runStartSequence(deps);
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'timeout');
  assert.equal(calls.spawns, 1);
});

test('status coordination files authorize a graceful attempt but never a force kill', () => {
  assert.equal(canAttemptGracefulStop(runningStatus(), 4242), true);
  assert.equal(canAttemptGracefulStop({ ...runningStatus(), status: 'stopped' }, 4242), false);
  assert.equal(canAttemptGracefulStop(runningStatus(), 99), false);
  assert.equal(canAttemptGracefulStop(null, 4242), false);
  assert.equal(canForceTerminate('unknown'), false);
  assert.equal(canForceTerminate('other'), false);
  assert.equal(canForceTerminate('owned'), true);
});
