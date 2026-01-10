import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { getRuntimeState, getTabRuntime, patchRuntimeState, patchTabRuntime } from '../../background/runtime-state.js';
import { STORAGE_KEYS } from '../../shared/constants.js';

function setupSessionStorage({ shouldThrow = false } = {}) {
  const store = new Map();
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          if (shouldThrow) {
            throw new Error('session get failed');
          }
          if (Array.isArray(key)) {
            const result = {};
            key.forEach((item) => {
              result[item] = store.get(item);
            });
            return result;
          }
          return { [key]: store.get(key) };
        },
        async set(data) {
          if (shouldThrow) {
            throw new Error('session set failed');
          }
          Object.entries(data).forEach(([key, value]) => {
            store.set(key, value);
          });
        },
        async clear() {
          store.clear();
        },
      },
    },
  };

  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('getRuntimeState returns empty object when missing', async () => {
  setupSessionStorage();
  const state = await getRuntimeState();
  assert.deepEqual(state, {});
});

test('patchRuntimeState merges tabs and degraded fields', async () => {
  const store = setupSessionStorage();
  store.set(STORAGE_KEYS.RUNTIME_STATE, {
    tabs: {
      '123': { cssId: 'aura-1' },
    },
    degraded: { triggered: false },
  });

  await patchRuntimeState({
    tabs: {
      '123': { modeId: 'comfort-visual' },
      '456': { cssId: 'aura-2', modeId: 'focus' },
    },
    degraded: { triggered: true, reason: 'thresholds' },
  });

  const nextState = store.get(STORAGE_KEYS.RUNTIME_STATE);
  assert.equal(nextState.tabs['123'].cssId, 'aura-1');
  assert.equal(nextState.tabs['123'].modeId, 'comfort-visual');
  assert.equal(nextState.tabs['456'].cssId, 'aura-2');
  assert.equal(nextState.tabs['456'].modeId, 'focus');
  assert.equal(nextState.degraded.triggered, true);
  assert.equal(nextState.degraded.reason, 'thresholds');
});

test('patchTabRuntime clears empty entries', async () => {
  const store = setupSessionStorage();
  store.set(STORAGE_KEYS.RUNTIME_STATE, {
    tabs: {
      '99': { cssId: 'aura-99', modeId: 'comfort-visual' },
    },
  });

  await patchTabRuntime(99, { cssId: undefined, modeId: undefined, appliedAt: undefined });

  const nextState = store.get(STORAGE_KEYS.RUNTIME_STATE);
  assert.equal(nextState.tabs?.['99'], undefined);
});

test('getTabRuntime returns undefined when session fails', async () => {
  setupSessionStorage({ shouldThrow: true });
  const state = await getTabRuntime(123);
  assert.equal(state, undefined);
});
