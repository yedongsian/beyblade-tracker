import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { confirmUpdateHandover, pendingUpdate, UpdateError } from '../src/release/update.js';
import { errorCodeFor, errorEnvelope } from '../src/errors/registry.js';
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

// Found in the VM the moment an update first succeeded. updateAvailable inside a stored check result
// describes the version that was running when the check ran. After updating to 1.0.2 the settings
// page still offered "install 1.0.2" with the button live, and would have kept offering it until the
// next scheduled check up to 24h later. Nobody could see this before BT-REL-001 was fixed, because
// no update had ever completed.
test('a stored check result stops advertising a version already installed', () => {
  const state = {
    latestResult: { updateAvailable: true, manifest: { version: '1.0.2' } },
  };
  assert.equal(pendingUpdate(state, '1.0.1')?.manifest.version, '1.0.2', 'an older install must still be offered the update');
  assert.equal(pendingUpdate(state, '1.0.2'), null, 'the version just installed must not be offered again');
  assert.equal(pendingUpdate(state, '1.0.3'), null, 'nor may a newer install be told to go backwards');
});

test('pendingUpdate stays quiet on absent or malformed state', () => {
  assert.equal(pendingUpdate(null, '1.0.1'), null);
  assert.equal(pendingUpdate({}, '1.0.1'), null);
  assert.equal(pendingUpdate({ latestResult: { updateAvailable: false, manifest: { version: '9.9.9' } } }, '1.0.1'), null);
  assert.equal(pendingUpdate({ latestResult: { updateAvailable: true } }, '1.0.1'), null, 'no manifest, no offer');
  // A version string that cannot be parsed must not throw its way onto the page.
  assert.equal(pendingUpdate({ latestResult: { updateAvailable: true, manifest: { version: 'not-a-version' } } }, '1.0.1'), null);
});

// 2026-09-03: rollback failed with "cannot restore the pre-update backup" and nothing else. The real
// cause was that the service was still running and holding the database, which restoreBackup says
// plainly - the catch threw it away. A missing backup, a corrupt backup and a live service each need
// a different response from whoever reads the log.
test('a failed restore keeps its cause for the log while the user still gets the code', () => {
  const cause = new Error('Tracker 仍在執行中 (PID=4448)，請先停止服務再還原。');
  const error = new UpdateError('BT-UPD-007', `無法還原更新前的備份：${cause.message}`);
  assert.equal(errorCodeFor(error), 'BT-UPD-007');
  assert.match(error.message, /仍在執行中/, 'diagnostics need to know which of the three it was');
  assert.match(error.message, /PID=4448/);

  const envelope = errorEnvelope(error, { appVersion: '1.0.2', supportRef: 'ref', timestamp: '2026-09-03T00:00:00.000Z' });
  assert.equal(envelope.code, 'BT-UPD-007');
  // The internal sentence must not become the public contract.
  assert.doesNotMatch(JSON.stringify(envelope), /PID=4448|仍在執行中/);
  assert.ok(envelope.recovery.length > 0);
});

test('the restore failure actually carries its cause through rollbackUpdate', () => {
  const source = readFileSync(new URL('../src/release/update.js', import.meta.url), 'utf8');
  assert.match(source, /catch \(cause\) \{ throw updateError\('BT-UPD-007', `無法還原更新前的備份：\$\{cause\?\.message \|\| cause\}`\); \}/,
    'a bare catch here is what discarded the reason');
});

// BT-UPD-002. Both update settings were environment variables defaulting to empty, so a shipped
// build had no update source and no verification key: an ordinary user could never receive an
// update, and every acceptance round only worked because the variables were set by hand. These pin
// the two properties that make a build actually updatable, and the one that makes it diagnosable.
test('a shipped build carries an update source and a verification key', () => {
  const config = readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  assert.match(config, /process\.env\.UPDATE_MANIFEST_URL \|\| shippedUpdate\.manifestUrl/,
    'the manifest URL must fall back to the payload, not to empty');
  assert.match(config, /process\.env\.UPDATE_PUBLIC_KEY \|\| shippedUpdate\.publicKey/,
    'the public key must fall back to the payload, not to empty');

  const build = readFileSync(new URL('../scripts/build-windows-release.js', import.meta.url), 'utf8');
  // Deriving is what makes a mismatched pair impossible; reading a second key file would not.
  assert.match(build, /createPublicKey\(readFileSync\(signingKeyPath, 'utf8'\)\)/,
    'the shipped key must be derived from the signing key');
  assert.doesNotMatch(build, /RELEASE_PUBLIC_KEY_FILE/, 'a second key file reintroduces the mismatch');
  // A version-pinned URL makes a build check only its own release, forever.
  assert.match(build, /releases\/latest\/download\/release-manifest\.json/,
    'the baked URL must track the latest release, not one version');
});

test('a derived public key verifies what the signing key signed', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  // Exactly what the build does with RELEASE_SIGNING_KEY_FILE.
  const derived = createPublicKey(privatePem).export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(derived, publicKey.export({ type: 'spki', format: 'pem' }).toString());

  const payload = Buffer.from('release-manifest');
  const signature = sign(null, payload, privatePem);
  assert.ok(verify(null, payload, derived, signature), 'the shipped key must verify the shipped manifest');

  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.ok(!verify(null, payload, other, signature), 'and a key from another pair must not');
});
