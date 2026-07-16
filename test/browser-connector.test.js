import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserConnector } from '../src/connectors/index.js';

test('browser connector is registered and requires configured pages', async () => {
  const connector = new BrowserConnector(
    { key: 'empty', connector: 'browser' },
    { pages: [] },
    {}
  );
  assert.deepEqual(await connector.fetchListings(), []);
});
