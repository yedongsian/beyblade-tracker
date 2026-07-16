import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeHostname, canonicalizeSeedUrl, fetchableSeedUrl, isPrivateAddress, registrableDomain,
} from '../src/core/site.js';

test('seed URL canonicalization unifies protocol, www and tracking parameters', () => {
  assert.equal(
    canonicalizeSeedUrl('http://WWW.Example.COM/product/?utm_source=x&b=2&a=1#stock'),
    'https://example.com/product?a=1&b=2'
  );
  assert.match(fetchableSeedUrl('http://WWW.Example.COM/product?utm_source=x'), /^https:\/\/www\.example\.com\/product$/);
});

test('registrable domain handles common Japanese and Taiwanese suffixes', () => {
  assert.equal(registrableDomain('https://shop.example.co.jp/p'), 'example.co.jp');
  assert.equal(registrableDomain('https://store.example.com.tw/p'), 'example.com.tw');
  assert.equal(registrableDomain('https://news.store.example.com/p'), 'example.com');
});

test('private and local addresses are rejected before preview', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', '192.168.1.2', '::1']) {
    assert.throws(() => assertSafeHostname(host), /本機或內部網路/);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('172.16.5.5'), true);
});
