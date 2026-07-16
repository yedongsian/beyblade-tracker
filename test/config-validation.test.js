import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceDefinitions } from '../src/config.js';

test('source validation reports actionable Traditional Chinese errors', () => {
  const result = validateSourceDefinitions({
    sources: [{ key: 'bad key', connector: 'jsonld', checkIntervalSeconds: 5, config: { pages: [] } }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /key/);
  assert.match(result.errors.join(' '), /至少要 60 秒/);
  assert.match(result.errors.join(' '), /至少設定一個商品頁面/);
});

test('valid source definitions are accepted as a complete set', () => {
  const result = validateSourceDefinitions({
    sources: [{
      key: 'fixture-v1', connector: 'fixture', enabled: false,
      checkIntervalSeconds: 3600, recipeVersion: 1,
      config: { file: 'fixtures/beyblade-x.json' },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.sources.length, 1);
});
