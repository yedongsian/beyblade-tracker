import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAttemptGracefulStop, canForceTerminate, classifyServiceProcess, parseProcessCreatedAt,
} from '../src/release/service-process.js';

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
