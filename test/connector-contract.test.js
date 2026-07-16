import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectorManifest, createConnector } from '../src/connectors/index.js';

test('every registered connector publishes a semantic version', () => {
  const manifest = connectorManifest();
  assert.deepEqual(Object.keys(manifest).sort(), ['browser', 'fixture', 'jsonld']);
  for (const version of Object.values(manifest)) assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('versioned fixture sample satisfies the connector listing contract', async () => {
  const connector = createConnector({
    key: 'fixture-contract', connector: 'fixture',
    config: { file: 'fixtures/beyblade-x.json' },
  }, { frameIndex: 0 });
  const listings = await connector.fetchListings();
  assert.equal(connector.version, '1.0.0');
  assert.ok(listings.length > 0);
  for (const listing of listings) {
    assert.equal(typeof listing.url, 'string');
    assert.match(listing.url, /^https?:\/\//);
  }
});
