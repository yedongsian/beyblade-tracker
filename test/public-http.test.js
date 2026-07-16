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
      fetchImpl: async () => new Response('1234', { status: 200 }),
    }), /大小限制/
  );
});
