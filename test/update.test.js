import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmUpdateHandover } from '../src/release/update.js';
import { errorCodeFor } from '../src/errors/registry.js';
import { ACTIVE_UPDATE_PHASES } from '../src/web/server.js';

// BT-REL-001's second half. The installer exiting 0 says the files were written and nothing about
// which build is serving; the gap between those two is where the VM sat for half an hour being told
// the update had completed. The confirmation is inverted on purpose: a handover that works stops the
// process running this code, so still being here when the deadline passes IS the failure.
test('an update is not complete until the new version is the one serving', async () => {
  let slept = 0;
  const sleep = async (ms) => { slept += ms; };
  const clock = () => slept;

  await assert.rejects(
    () => confirmUpdateHandover({
      targetVersion: '1.0.1', currentVersion: '1.0.0',
      probeVersion: async () => '1.0.0', timeoutMs: 10_000, pollMs: 1_000, sleep, now: clock,
    }),
    (error) => {
      assert.equal(error.code, 'BT-UPD-008');
      // The public envelope must carry the code, never the internal sentence.
      assert.equal(errorCodeFor(error), 'BT-UPD-008');
      return true;
    },
    'a service still answering as the old version cannot be reported as updated',
  );
  assert.ok(slept >= 10_000, 'it must actually wait out the handover window before failing');
});

test('a handover that completes is accepted from either signal', async () => {
  const sleep = async () => {};
  // The process survived long enough to see the new version answer.
  const probed = await confirmUpdateHandover({
    targetVersion: '1.0.1', currentVersion: '1.0.0',
    probeVersion: async () => '1.0.1', timeoutMs: 10_000, pollMs: 1_000, sleep,
  });
  assert.deepEqual(probed, { ok: true, servedVersion: '1.0.1' });

  // Already running the target: nothing to wait for.
  const already = await confirmUpdateHandover({ targetVersion: '1.0.1', currentVersion: '1.0.1', sleep });
  assert.deepEqual(already, { ok: true, servedVersion: '1.0.1' });
});

test('a probe that throws does not count as a successful handover', async () => {
  let slept = 0;
  await assert.rejects(
    () => confirmUpdateHandover({
      targetVersion: '1.0.1', currentVersion: '1.0.0',
      probeVersion: async () => { throw new Error('connection refused'); },
      timeoutMs: 4_000, pollMs: 1_000, sleep: async (ms) => { slept += ms; }, now: () => slept,
    }),
    (error) => error.code === 'BT-UPD-008',
    'an unreachable service is not evidence that the new version took over',
  );
});

test('the verifying phase keeps the operation active rather than terminal', () => {
  assert.ok(ACTIVE_UPDATE_PHASES.has('verifying'), 'a verifying update must not be reported as finished');
  for (const phase of ['checking', 'downloading', 'installing']) assert.ok(ACTIVE_UPDATE_PHASES.has(phase));
  for (const phase of ['completed', 'failed']) assert.ok(!ACTIVE_UPDATE_PHASES.has(phase));
});
