import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAttemptGracefulStop, canForceTerminate, classifyServiceProcess, parseProcessCreatedAt,
} from '../src/release/service-process.js';
import { resolveStopDecision } from '../src/release/service-lifecycle.js';

const expected = {
  pid: 4242,
  executablePath: 'C:\\Tracker\\runtime\\node.exe',
  serviceFile: 'C:\\Tracker\\bin\\service.js',
  startedAt: '2026-07-30T00:00:10.000Z',
  status: { service: 'beyblade-tracker', pid: 4242, status: 'running', startedAt: '2026-07-30T00:00:10.000Z' },
};

// The OS created the process, then the service published startedAt after loading its modules.
const identity = {
  processId: 4242, executablePath: 'C:/Tracker/runtime/node.exe',
  commandLine: '"C:\\Tracker\\runtime\\node.exe" --no-warnings "C:\\Tracker\\bin\\service.js"',
  createdAt: '2026-07-30T00:00:03.000Z',
};

// BT-REL-001, reproduced from the VM. An update flips current.json to 1.0.1, so the code asking
// "is this our service?" now runs from versions\\1.0.1 while the service still answering runs from
// versions\\1.0.0. Comparing exact paths made that 'other', the stop was refused, port 8787 was never
// released and 1.0.1 could never bind. The VM sat in that state for over half an hour while every
// visible surface reported the update had completed.
test('a service left over from the previous version is ours, not a stranger', () => {
  const identity = {
    processId: 4448,
    executablePath: 'c:\\install\\versions\\1.0.0\\runtime\\node.exe',
    commandLine: '"c:\\install\\versions\\1.0.0\\runtime\\node.exe" --no-warnings "c:\\install\\versions\\1.0.0\\bin\\service.js"',
    createdAt: '2026-08-29T17:03:30.000Z',
  };
  const status = { service: 'beyblade-tracker', pid: 4448, status: 'running', startedAt: '2026-08-29T17:03:31.000Z' };
  const asVersion = (version) => classifyServiceProcess(identity, {
    pid: 4448, status, installRoot: 'c:\\install',
    executablePath: 'c:\\install\\versions\\' + version + '\\runtime\\node.exe',
    serviceFile: 'c:\\install\\versions\\' + version + '\\bin\\service.js',
  });
  assert.equal(asVersion('1.0.1'), 'owned', 'the updated build must be able to stop the build it replaces');
  assert.equal(asVersion('1.0.0'), 'owned', 'and must still recognise its own');
  assert.equal(resolveStopDecision(asVersion('1.0.1'), status, 4448), 'graceful');
});

// Widening identity must not widen it to anything that merely looks close. Each of these differs
// from a sibling version in exactly one way, and every one of them must stay untouchable.
test('widening to sibling versions does not admit anything else', () => {
  const status = { service: 'beyblade-tracker', pid: 4448, status: 'running', startedAt: '2026-08-29T17:03:31.000Z' };
  const check = (executablePath, commandLine) => classifyServiceProcess(
    { processId: 4448, executablePath, commandLine, createdAt: '2026-08-29T17:03:30.000Z' },
    { pid: 4448, status, installRoot: 'c:\\install',
      executablePath: 'c:\\install\\versions\\1.0.1\\runtime\\node.exe',
      serviceFile: 'c:\\install\\versions\\1.0.1\\bin\\service.js' });
  const ours = 'c:\\install\\versions\\1.0.0\\runtime\\node.exe';
  const service = '"' + ours + '" "c:\\install\\versions\\1.0.0\\bin\\service.js"';
  assert.equal(check(ours, service), 'owned', 'the control case must pass or the rest proves nothing');
  // A different install root - another user's copy, or a machine-wide one.
  assert.equal(check('c:\\other\\versions\\1.0.0\\runtime\\node.exe',
    '"c:\\other\\versions\\1.0.0\\runtime\\node.exe" "c:\\other\\versions\\1.0.0\\bin\\service.js"'), 'other');
  // Our install root, our version, but not our executable.
  assert.equal(check('c:\\install\\versions\\1.0.0\\runtime\\evil.exe', service), 'other');
  // Our node.exe running something that is not the service.
  assert.equal(check(ours, '"' + ours + '" "c:\\install\\versions\\1.0.0\\bin\\export.js"'), 'other');
  // Executable from one version, service file from another: a mismatched pair is not a real install.
  assert.equal(check(ours, '"' + ours + '" "c:\\install\\versions\\1.0.1\\bin\\service.js"'), 'other');
  // Nested deeper than a version directory.
  assert.equal(check('c:\\install\\versions\\1.0.0\\sub\\runtime\\node.exe', service), 'other');
});

test('service ownership requires matching PID, executable, service path, and creation time', () => {
  assert.equal(classifyServiceProcess(identity, expected), 'owned');
  assert.equal(classifyServiceProcess({ ...identity, executablePath: 'C:\\Other\\node.exe' }, expected), 'other');
  assert.equal(classifyServiceProcess({ ...identity, commandLine: '"C:\\Tracker\\runtime\\node.exe" other.js' }, expected), 'other');
  assert.equal(classifyServiceProcess({ ...identity, processId: 9999, createdAt: null }, expected), 'other');
  assert.equal(classifyServiceProcess(null, expected), 'unknown');
});

test('a slow cold start stays owned while a PID reused after the recorded start does not', () => {
  // Packaged cold starts have been measured at more than six seconds from process creation to startedAt.
  assert.equal(classifyServiceProcess({ ...identity, createdAt: '2026-07-30T00:00:03.500Z' }, expected), 'owned');
  assert.equal(classifyServiceProcess({ ...identity, createdAt: '2026-07-30T00:00:10.500Z' }, expected), 'owned');
  assert.equal(classifyServiceProcess({ ...identity, createdAt: '2026-07-30T00:00:20.000Z' }, expected), 'other');
  assert.equal(classifyServiceProcess({ ...identity, createdAt: '2026-07-29T23:50:00.000Z' }, expected), 'other');
});

test('CIM creation timestamps are parsed without treating unavailable metadata as ownership', () => {
  assert.equal(parseProcessCreatedAt('20260730000000.123456+000'), Date.UTC(2026, 6, 30, 0, 0, 0, 123));
  assert.equal(parseProcessCreatedAt('2026-07-30T00:00:03.2914300Z'), Date.UTC(2026, 6, 30, 0, 0, 3, 291));
  assert.equal(Number.isNaN(parseProcessCreatedAt('not-a-time')), true);
  assert.equal(classifyServiceProcess({ processId: 4242 }, expected), 'unknown');
  assert.equal(classifyServiceProcess({ ...identity, createdAt: null }, expected), 'unknown');
});

test('coordination files never upgrade unknown ownership into force-kill permission', () => {
  assert.equal(classifyServiceProcess(null, expected), 'unknown');
  assert.equal(canAttemptGracefulStop(expected.status, expected.pid), true);
  assert.equal(canForceTerminate(classifyServiceProcess(null, expected)), false);
  assert.equal(canForceTerminate(classifyServiceProcess(identity, expected)), true);
});
