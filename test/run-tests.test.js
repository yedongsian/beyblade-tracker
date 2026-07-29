import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnvironment, LOOPBACK_NO_PROXY } from '../scripts/run-tests.js';

test('test runner bypasses ambient proxy only for loopback destinations', () => {
  const env = createTestEnvironment({
    HTTP_PROXY: 'http://proxy.example.test:3128',
    HTTPS_PROXY: 'http://proxy.example.test:3128',
    NO_PROXY: 'internal.example.test,localhost',
    no_proxy: 'service.example.test',
    KEEP_ME: 'yes',
  });

  assert.equal(env.HTTP_PROXY, 'http://proxy.example.test:3128');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example.test:3128');
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal('no_proxy' in env, false);
  assert.deepEqual(env.NO_PROXY.split(','), [
    'internal.example.test', 'localhost', 'service.example.test',
    ...LOOPBACK_NO_PROXY.filter((value) => value !== 'localhost'),
  ]);
});
