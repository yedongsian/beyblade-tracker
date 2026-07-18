import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, fetchPublicText } from '../src/net/public-http.js';

const publicLookup = async () => [{ address: '203.0.113.10', family: 4 }];

test('public URL validation accepts a public DNS result and rejects private DNS', async () => {
  const url = await assertPublicUrl('https://store.example/product', { lookupFn: publicLookup });
  assert.equal(url.hostname, 'store.example');
  await assert.rejects(
    () => assertPublicUrl('https://store.example/product', {
      lookupFn: async () => [{ address: '192.168.1.10', family: 4 }],
    }), /內部網路/
  );
});

test('safe preview revalidates every redirect destination', async () => {
  await assert.rejects(
    () => fetchPublicText('https://store.example/product', {
      lookupFn: publicLookup,
      perHostMinIntervalMs: 0,
      fetchImpl: async () => new Response('', {
        status: 302, headers: { location: 'http://127.0.0.1/private' },
      }),
    }), /本機或內部網路/
  );
});

test('safe preview enforces the download size limit', async () => {
  await assert.rejects(
    () => fetchPublicText('https://store.example/product', {
      lookupFn: publicLookup, maxBytes: 3,
      perHostMinIntervalMs: 0,
      fetchImpl: async () => new Response('1234', { status: 200 }),
    }), /大小限制/
  );
});

test('safe preview retries 429 using Retry-After within a bounded attempt count', async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchPublicText('https://store.example/product', {
    lookupFn: publicLookup, perHostMinIntervalMs: 0, maxRetries: 2,
    sleepFn: async (ms) => { delays.push(ms); }, randomFn: () => 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(result.body, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
});

test('safe preview does not retry a permanent client error', async () => {
  let calls = 0;
  await assert.rejects(() => fetchPublicText('https://store.example/product', {
    lookupFn: publicLookup, perHostMinIntervalMs: 0, maxRetries: 3,
    fetchImpl: async () => { calls += 1; return new Response('', { status: 404 }); },
  }), /HTTP 404/);
  assert.equal(calls, 1);
});

test('safe preview timeout also covers a stalled response body', async () => {
  await assert.rejects(() => fetchPublicText('https://store.example/product', {
    lookupFn: publicLookup, perHostMinIntervalMs: 0, maxRetries: 0, timeoutMs: 5,
    fetchImpl: async (_url, options) => ({
      ok: true, status: 200, url: 'https://store.example/product',
      headers: { get: () => null },
      text: async () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
      }),
    }),
  }), /body aborted/);
});
