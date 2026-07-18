import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db/database.js';
import { isExclusionAllowed, listExclusions, reviewExclusion } from '../src/core/exclusion-review.js';
import { processListing } from '../src/core/pipeline.js';
import { upsertSource } from '../src/core/store.js';

const OPTS = { preorderIsPurchasable: false, eventCooldownSeconds: 0, priceChangeThreshold: 0.05 };

test('excluded listing decisions are reviewable, reversible, and preserve the original reason', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'exclusion-review', name: 'Review Store', connector: 'fixture' });
  const listing = { url: 'https://review.example/bx-38-used', title: 'Used Beyblade X BX-38',
    availabilityRaw: 'https://schema.org/InStock', rawSummary: { condition: 'used' } };
  const first = processListing(db, source, listing, OPTS);
  assert.equal(first.excluded, true);
  const exclusion = listExclusions(db)[0];
  assert.equal(exclusion.reason, 'used');
  assert.equal(exclusion.review_status, 'pending');

  const allowed = reviewExclusion(db, exclusion.id, { action: 'allow', note: 'verified new inventory' });
  assert.equal(allowed.review_status, 'allowed');
  assert.equal(isExclusionAllowed(db, source.id, listing.url), true);
  const processed = processListing(db, source, listing, OPTS);
  assert.equal(processed.excluded, false);
  assert.equal(db.get('SELECT COUNT(*) count FROM offers').count, 1);

  const reopened = reviewExclusion(db, exclusion.id, { action: 'reopen', note: 'classification changed' });
  assert.equal(reopened.review_status, 'pending');
  assert.equal(isExclusionAllowed(db, source.id, listing.url), false);
  assert.equal(processListing(db, source, listing, OPTS).excluded, true);
  const final = db.get('SELECT * FROM listing_exclusions WHERE id=?', [exclusion.id]);
  assert.equal(final.reason, 'used');
  assert.equal(final.occurrence_count, 2);
  assert.equal(final.review_note, 'classification changed');
  db.close();
});

test('confirming an exclusion stores the review without allowing the URL', () => {
  const db = new Database(':memory:');
  const source = upsertSource(db, { key: 'exclusion-confirm', connector: 'fixture' });
  processListing(db, source, { url: 'https://review.example/parts', title: 'Beyblade parts only',
    availabilityRaw: 'https://schema.org/InStock' }, OPTS);
  const exclusion = db.get('SELECT * FROM listing_exclusions');
  const confirmed = reviewExclusion(db, exclusion.id, { action: 'confirm', note: 'parts listing' });
  assert.equal(confirmed.review_status, 'confirmed');
  assert.ok(confirmed.reviewed_at);
  assert.equal(isExclusionAllowed(db, source.id, exclusion.url), false);
  db.close();
});
