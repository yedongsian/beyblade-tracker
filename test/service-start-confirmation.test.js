import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runStartSequence } from '../src/release/service-lifecycle.js';
import { inspectProcessIdentity } from '../src/release/service-process.js';

// D-7's confirmation path is decided by real evidence: a real status file written by a real
// process, whose identity is read back from Win32_Process. The unit tests inject all three, so
// they prove the decision logic and nothing about the plumbing underneath it. This exercises the
// plumbing - a genuinely slow service that outlives the budget must be reported as still starting.
//
// Ownership classification needs CIM, so this is Windows-only by construction.
const windowsOnly = { skip: process.platform !== 'win32' ? 'Windows only' : false };

// Publishes the same shape bin/service.js writes before its slow work begins, then stays alive
// without ever reaching `running` - a first start still doing migrations, backup and imports.
const SLOW_SERVICE = `
import { writeFileSync } from 'node:fs';
const [statusFile, pidFile, serviceFile] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
writeFileSync(statusFile, JSON.stringify({
  service: 'beyblade-tracker',
  pid: process.pid,
  status: 'starting',
  startedAt: new Date().toISOString(),
  executablePath: process.execPath,
  serviceFile,
}));
setTimeout(() => {}, 60_000);
`;

function harness(root, child, { probeHealth } = {}) {
  const statusFile = join(root, 'tracker-status.json');
  const pidFile = join(root, 'tracker.pid');
  return {
    executablePath: process.execPath,
    serviceFile: join(root, 'slow-service.mjs'),
    readPid: () => {
      try { return Number(readFileSync(pidFile, 'utf8').trim()) || null; } catch { return null; }
    },
    readStatus: () => {
      try { return JSON.parse(readFileSync(statusFile, 'utf8')); } catch { return null; }
    },
    isAlive: (pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    },
    inspectProcess: inspectProcessIdentity,
    clearPid: () => {},
    clearStopRequest: () => {},
    spawnService: () => child(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    probeHealth,
    timeoutMs: 2_000,
    pollMs: 250,
  };
}

test('a real service still doing its slow start is confirmed alive, not reported as failed', windowsOnly, async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-slow-start-'));
  const serviceFile = join(root, 'slow-service.mjs');
  const statusFile = join(root, 'tracker-status.json');
  const pidFile = join(root, 'tracker.pid');
  writeFileSync(serviceFile, SLOW_SERVICE);
  let spawned = null;

  try {
    const deps = harness(root, () => {
      spawned = spawn(process.execPath, [serviceFile, statusFile, pidFile, serviceFile], {
        detached: true, windowsHide: true, stdio: 'ignore',
      });
      spawned.unref();
      return spawned;
    });

    const result = await runStartSequence(deps);

    assert.equal(result.ok, true, 'outliving the budget is not evidence the start failed');
    assert.equal(result.outcome, 'still-starting');
    assert.equal(result.pid, spawned.pid);
    // The point of the exercise: ownership came from a real Win32_Process lookup matched against a
    // real status file, not from an injected identity.
    assert.equal(result.ownership, 'owned');
    assert.equal(result.status.status, 'starting');
  } finally {
    if (spawned?.pid) { try { process.kill(spawned.pid); } catch { /* already gone */ } }
    rmSync(root, { recursive: true, force: true });
  }
});

test('a service that dies inside the budget is reported as exited however healthy the port looks', windowsOnly, async () => {
  const root = mkdtempSync(join(tmpdir(), 'beyblade-dead-start-'));
  const serviceFile = join(root, 'slow-service.mjs');
  writeFileSync(serviceFile, 'process.exit(1);');
  let spawned = null;

  try {
    // A responding port must never rescue a dead child: something else is answering it.
    const deps = harness(root, () => {
      spawned = spawn(process.execPath, [serviceFile], { detached: true, windowsHide: true, stdio: 'ignore' });
      spawned.unref();
      return spawned;
    }, { probeHealth: async () => true });

    const result = await runStartSequence(deps);

    assert.equal(result.ok, false);
    assert.equal(result.outcome, 'exited');
  } finally {
    if (spawned?.pid) { try { process.kill(spawned.pid); } catch { /* already gone */ } }
    rmSync(root, { recursive: true, force: true });
  }
});
