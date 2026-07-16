import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueSources, nextDueAt, workerDelaySeconds } from '../src/core/schedule.js';

const NOW = Date.parse('2026-07-14T10:00:00.000Z');

test('each source becomes due according to its own interval', () => {
  const sources = [
    { key: 'fast', check_interval_seconds: 60, last_success_at: '2026-07-14T09:58:00.000Z' },
    { key: 'slow', check_interval_seconds: 3600, last_success_at: '2026-07-14T09:30:00.000Z' },
    { key: 'new', check_interval_seconds: 86400, last_success_at: null, last_failure_at: null },
  ];
  assert.deepEqual(dueSources(sources, NOW).map((s) => s.key), ['fast', 'new']);
  assert.equal(nextDueAt(sources[1]), Date.parse('2026-07-14T10:30:00.000Z'));
});

test('worker delay targets the earliest next due source and clamps safely', () => {
  const sources = [
    { check_interval_seconds: 3600, last_success_at: '2026-07-14T09:30:00.000Z' },
    { check_interval_seconds: 7200, last_success_at: '2026-07-14T09:00:00.000Z' },
  ];
  assert.equal(workerDelaySeconds(sources, { nowMs: NOW }), 1800);
  assert.equal(workerDelaySeconds([], { nowMs: NOW }), 3600);
  assert.equal(workerDelaySeconds([{ last_success_at: null }], { nowMs: NOW }), 30);
});
