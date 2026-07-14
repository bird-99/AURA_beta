import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { CssApplier } from '../../background/css-applier.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../../shared/feature-flags.js';

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  const session = new Map();
  global.chrome = {
    runtime: { lastError: null },
    storage: {
      session: {
        async get(key) {
          return { [key]: session.get(key) };
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        },
      },
    },
    scripting: {
      async executeScript() {
        return [{
          frameId: 0,
          documentId: 'chrome-doc-1',
          result: {
            url: 'https://example.com/page',
            documentInstanceId: 'doc-1',
          },
        }];
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, url: 'https://example.com/page' };
      },
      sendMessage(_tabId, message, _options, callback) {
        const done = typeof _options === 'function' ? _options : callback;
        done(message?.action === 'GET_DOCUMENT_CONTEXT_V1'
          ? { ok: true, url: 'https://example.com/page', documentInstanceId: 'doc-1' }
          : { ok: true });
      },
    },
  };
});

afterEach(() => {
  __resetFeatureFlagCacheForTests();
  delete global.chrome;
});

test('applyModeScopedV2 dedupes identical mode applies on the same tab frame', async () => {
  const applier = new CssApplier();
  const deferred = createDeferred();
  const calls = [];

  applier._applyModeScopedV2 = async (tabId, modeId, params, source, attemptId) => {
    calls.push({ tabId, modeId, frameId: params?.frameId, source, attemptId });
    await deferred.promise;
    return { ok: true, modeId, attemptId };
  };

  const first = applier.applyModeScopedV2(42, MODE_IDS.COMFORT_VISUAL, { frameId: 3 }, 'test');
  const second = applier.applyModeScopedV2(42, MODE_IDS.COMFORT_VISUAL, { frameId: 3 }, 'test');

  assert.equal(calls.length, 1);
  deferred.resolve();

  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.attemptId),
    [results[0].attemptId, results[0].attemptId],
  );
});

test('applyModeScopedV2 keeps concurrent exclusive modes separate on the same tab frame', async () => {
  const applier = new CssApplier();
  const deferred = createDeferred();
  const calls = [];

  applier._applyModeScopedV2 = async (tabId, modeId, params, source, attemptId) => {
    calls.push({ tabId, modeId, frameId: params?.frameId, source, attemptId });
    await deferred.promise;
    return { ok: true, modeId, attemptId };
  };

  const comfort = applier.applyModeScopedV2(42, MODE_IDS.COMFORT_VISUAL, { frameId: 3 }, 'test');
  const focus = applier.applyModeScopedV2(42, MODE_IDS.FOCUS, { frameId: 3 }, 'test');

  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.modeId),
    [MODE_IDS.COMFORT_VISUAL, MODE_IDS.FOCUS],
  );

  deferred.resolve();
  const results = await Promise.all([comfort, focus]);
  assert.notEqual(results[0].attemptId, results[1].attemptId);
});

test('applyModeScopedV2 queues forced preference reapply and uses latest params', async () => {
  const applier = new CssApplier();
  const deferred = createDeferred();
  const calls = [];

  applier._applyModeScopedV2 = async (tabId, modeId, params, source, attemptId) => {
    calls.push({
      tabId,
      modeId,
      frameId: params?.frameId,
      marker: params?.marker,
      forceReapply: params?.forceReapply === true,
      reapplyReason: params?.reapplyReason,
      source,
      attemptId,
    });
    if (calls.length === 1) {
      await deferred.promise;
    }
    return { ok: true, modeId, marker: params?.marker, attemptId };
  };

  const first = applier.applyModeScopedV2(
    42,
    MODE_IDS.COMFORT_VISUAL,
    { frameId: 3, marker: 'initial' },
    'test',
  );
  const queuedOld = applier.applyModeScopedV2(
    42,
    MODE_IDS.COMFORT_VISUAL,
    {
      frameId: 3,
      marker: 'old',
      forceReapply: true,
      reapplyReason: 'prefs:comfortVisual',
    },
    'rehydrate',
  );
  const queuedLatest = applier.applyModeScopedV2(
    42,
    MODE_IDS.COMFORT_VISUAL,
    {
      frameId: 3,
      marker: 'latest',
      forceReapply: true,
      reapplyReason: 'prefs:comfortVisual',
    },
    'rehydrate',
  );

  assert.equal(calls.length, 1);
  deferred.resolve();

  const results = await Promise.all([first, queuedOld, queuedLatest]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].marker, 'latest');
  assert.equal(calls[1].forceReapply, true);
  assert.equal(calls[1].source, 'rehydrate');
  assert.notEqual(results[0].attemptId, results[1].attemptId);
  assert.equal(results[1].marker, 'latest');
  assert.equal(results[2].marker, 'latest');
});

test('public applyMode and removeMode share one lifecycle queue per tab and mode', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const deferred = createDeferred();
  const calls = [];
  const manager = {
    async getModeState() {
      return { state: STATES.ACTIVE, pendingDecision: false, scopedV2: { scopeSelector: 'main' } };
    },
  };
  const applier = new CssApplier({}, manager, {});
  applier.applyModeScopedV2 = async () => {
    calls.push('apply:start');
    await deferred.promise;
    calls.push('apply:end');
    return { ok: true };
  };
  applier.removeModeScopedV2 = async () => {
    calls.push('remove');
    return { ok: true };
  };

  const applyPromise = applier.applyMode(42, MODE_IDS.COMFORT_VISUAL, {}, 'popup');
  while (calls.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const removePromise = applier.removeMode(42, MODE_IDS.COMFORT_VISUAL);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['apply:start']);

  deferred.resolve();
  await Promise.all([applyPromise, removePromise]);
  assert.deepEqual(calls, ['apply:start', 'apply:end', 'remove']);
});

test('queued rehydrate is skipped when restore made the mode inactive', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  let state = { state: STATES.ACTIVE, pendingDecision: true, scopedV2: { scopeSelector: 'main' } };
  let applyCalls = 0;
  const manager = {
    async getModeState() {
      return state;
    },
  };
  const applier = new CssApplier({}, manager, {});
  applier.removeModeScopedV2 = async () => {
    state = { state: STATES.INACTIVE, pendingDecision: false, scopedV2: null };
    return { ok: true };
  };
  applier.applyModeScopedV2 = async () => {
    applyCalls += 1;
    return { ok: true };
  };

  const removePromise = applier.removeMode(42, MODE_IDS.COMFORT_VISUAL);
  const rehydratePromise = applier.applyMode(42, MODE_IDS.COMFORT_VISUAL, {}, 'rehydrate');
  const [, rehydrateResult] = await Promise.all([removePromise, rehydratePromise]);

  assert.equal(applyCalls, 0);
  assert.equal(rehydrateResult.ok, true, JSON.stringify(rehydrateResult));
  assert.equal(rehydrateResult.skipped, true);
  assert.ok(['mode-inactive', 'newer-lifecycle-intent'].includes(rehydrateResult.reason));
});
