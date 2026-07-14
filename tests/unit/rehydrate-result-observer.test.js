import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  runObservedRehydrate,
  scheduleObservedRehydrate,
} from '../../background/rehydrate-result-observer.js';

test('runObservedRehydrate logs failed rehydrate results', async () => {
  const warnings = [];
  const result = await runObservedRehydrate(
    async () => ({ ok: false, reason: 'rehydrate-failed' }),
    123,
    'content-ready',
    {
      source: 'test',
      warn: (...args) => warnings.push(args),
    },
  );

  assert.deepEqual(result, { ok: false, reason: 'rehydrate-failed' });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[Rehydrate] Rehydrate reported failure');
  assert.deepEqual(warnings[0][1], {
    tabId: 123,
    reason: 'content-ready',
    source: 'test',
    result,
  });
});

test('runObservedRehydrate does not log successful rehydrate results', async () => {
  const warnings = [];
  const result = await runObservedRehydrate(
    async () => ({ ok: true, applied: [] }),
    123,
    'tab-complete',
    {
      warn: (...args) => warnings.push(args),
    },
  );

  assert.deepEqual(result, { ok: true, applied: [] });
  assert.deepEqual(warnings, []);
});

test('scheduleObservedRehydrate catches and reports thrown errors', async () => {
  const warnings = [];
  const result = await scheduleObservedRehydrate(
    async () => {
      throw new Error('boom');
    },
    123,
    'spa',
    {
      source: 'test',
      warn: (...args) => warnings.push(args),
    },
  );

  assert.deepEqual(result, { ok: false, reason: 'spa', error: 'boom' });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], '[Rehydrate] Rehydrate failed');
  assert.equal(warnings[0][1].tabId, 123);
  assert.equal(warnings[0][1].reason, 'spa');
  assert.equal(warnings[0][1].source, 'test');
  assert.equal(warnings[0][1].error.message, 'boom');
});
