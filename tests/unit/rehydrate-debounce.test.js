import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRehydrateManager } from '../../background/rehydrate-manager.js';

test('rehydrateActiveModesForTab debounces in-flight runs per tab', async () => {
  const applyCalls = [];
  const tabId = 123;

  const stateManager = {
    async getModeState() {
      return { state: 'ACTIVE', scopedV2: { intensity: 1 } };
    },
  };

  const cssApplier = {
    async applyMode() {
      applyCalls.push('apply');
      return { ok: true };
    },
  };

  const manager = createRehydrateManager({
    modeIds: { comfort: 'comfort-visual' },
    stateManager,
    cssApplier,
    isValidTabId: (value) => typeof value === 'number',
    tabsApi: { get: async () => ({ id: tabId }) },
    states: { ACTIVE: 'ACTIVE' },
    now: () => 1000,
  });

  await Promise.all([
    manager.rehydrateActiveModesForTab(tabId, 'rehydrate'),
    manager.rehydrateActiveModesForTab(tabId, 'rehydrate'),
    manager.rehydrateActiveModesForTab(tabId, 'rehydrate'),
  ]);

  assert.equal(applyCalls.length, 1);
});
