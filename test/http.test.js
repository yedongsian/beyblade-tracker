import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText } from '../src/net/http.js';

test('HTTP client honors Retry-After for retryable responses', async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchText('https://retry.example/product', {
    perHostMinIntervalMs: 0, maxRetries: 1,
    sleepFn: async (ms) => { delays.push(ms); }, randomFn: () => 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '2' } });
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(result.body, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
});

test('HTTP client enforces its response size limit without retrying', async () => {
  let calls = 0;
  await assert.rejects(() => fetchText('https://large.example/product', {
    perHostMinIntervalMs: 0, maxRetries: 3, maxBytes: 3,
    fetchImpl: async () => { calls += 1; return new Response('1234', { status: 200 }); },
  }), /exceeds 3 bytes/);
  assert.equal(calls, 1);
});
