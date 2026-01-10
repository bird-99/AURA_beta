import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRehydrateManager } from '../../background/rehydrate-manager.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';

test('rehydrate resolves exclusive ACTIVE modes to a single winner', async () => {
  const tabId = 123;
  const applyCalls = [];
  const removeCalls = [];
  const updateCalls = [];

  const modeStates = {
    [MODE_IDS.COMFORT_VISUAL]: {
      state: STATES.ACTIVE,
      activatedAt: 100,
      scopedV2: { intensity: 1 },
    },
    [MODE_IDS.FOCUS]: {
      state: STATES.ACTIVE,
      activatedAt: 200,
      scopedV2: { intensity: 1 },
    },
  };

  const stateManager = {
    async getModeState(_tabId, modeId) {
      return modeStates[modeId] || null;
    },
    async updateModeState(_tabId, modeId, state, details) {
      updateCalls.push({ modeId, state, details });
    },
  };

  const cssApplier = {
    async removeMode(_tabId, modeId) {
      removeCalls.push(modeId);
      return { ok: true };
    },
    async applyMode(_tabId, modeId) {
      applyCalls.push(modeId);
      return { ok: true };
    },
  };

  const manager = createRehydrateManager({
    modeIds: MODE_IDS,
    stateManager,
    cssApplier,
    isValidTabId: (value) => typeof value === 'number',
    tabsApi: { get: async () => ({ id: tabId }) },
    states: STATES,
  });

  await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');

  assert.deepEqual(removeCalls, [MODE_IDS.COMFORT_VISUAL]);
  assert.deepEqual(applyCalls, [MODE_IDS.FOCUS]);
  assert.deepEqual(updateCalls, [
    {
      modeId: MODE_IDS.COMFORT_VISUAL,
      state: STATES.INACTIVE,
      details: { pendingDecision: false },
    },
  ]);
});
