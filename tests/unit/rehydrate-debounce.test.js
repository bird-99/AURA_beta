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

test('rehydrateActiveModesForTab does not drop lifecycle rehydrate events during debounce window', async () => {
  const applyCalls = [];
  const tabId = 123;
  let timestamp = 1000;

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
    now: () => timestamp,
  });

  await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');
  timestamp += 100;
  await manager.rehydrateActiveModesForTab(tabId, 'content-ready');

  assert.equal(applyCalls.length, 2);
});

test('rehydrateActiveModesForTab coalesces webNavigation and tab-complete for the same URL only', async () => {
  const applyCalls = [];
  const tabId = 123;
  let timestamp = 1000;

  const manager = createRehydrateManager({
    modeIds: { comfort: 'comfort-visual' },
    stateManager: {
      async getModeState() {
        return { state: 'ACTIVE', scopedV2: { intensity: 1 } };
      },
    },
    cssApplier: {
      async applyMode(_tabId, _modeId, params) {
        applyCalls.push(params.reapplyReason);
        return { ok: true };
      },
    },
    isValidTabId: (value) => typeof value === 'number',
    tabsApi: { get: async () => ({ id: tabId, url: 'https://example.com/page-2' }) },
    states: { ACTIVE: 'ACTIVE' },
    now: () => timestamp,
  });

  await manager.rehydrateActiveModesForTab(tabId, 'spa', { url: 'https://example.com/page-2' });
  timestamp += 100;
  const duplicate = await manager.rehydrateActiveModesForTab(
    tabId,
    'tab-complete',
    { url: 'https://example.com/page-2' },
  );
  timestamp += 100;
  await manager.rehydrateActiveModesForTab(tabId, 'spa', { url: 'https://example.com/page-3' });

  assert.equal(duplicate.deduped, true);
  assert.equal(applyCalls.length, 2);
});

test('rehydrateActiveModesForTab does not drop preference reapply during debounce window', async () => {
  const applyCalls = [];
  const tabId = 123;
  let timestamp = 1000;

  const stateManager = {
    async getModeState() {
      return { state: 'ACTIVE', scopedV2: { intensity: 1 } };
    },
  };

  const cssApplier = {
    async applyMode(_tabId, _modeId, params) {
      applyCalls.push(params);
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
    now: () => timestamp,
  });

  await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');
  timestamp += 100;
  await manager.rehydrateActiveModesForTab(tabId, 'popup:prefs:comfort-visual');

  assert.equal(applyCalls.length, 2);
  assert.equal(applyCalls[1].forceReapply, true);
  assert.equal(applyCalls[1].reapplyReason, 'popup:prefs:comfort-visual');
});

test('rehydrateActiveModesForTab queues lifecycle rehydrate events while a run is in flight', async () => {
  const applyCalls = [];
  const tabId = 123;
  let finishFirstApply;

  const firstApplyComplete = new Promise((resolve) => {
    finishFirstApply = resolve;
  });

  const stateManager = {
    async getModeState() {
      return { state: 'ACTIVE', scopedV2: { intensity: 1 } };
    },
  };

  const cssApplier = {
    async applyMode() {
      applyCalls.push('apply');
      if (applyCalls.length === 1) {
        await firstApplyComplete;
      }
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

  const firstRun = manager.rehydrateActiveModesForTab(tabId, 'rehydrate');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(applyCalls.length, 1);

  const queuedRun = manager.rehydrateActiveModesForTab(tabId, 'content-ready');

  assert.equal(applyCalls.length, 1);
  finishFirstApply();

  await Promise.all([firstRun, queuedRun]);

  assert.equal(applyCalls.length, 2);
});

test('rehydrateActiveModesForTab queues preference reapply while a run is in flight', async () => {
  const applyCalls = [];
  const tabId = 123;
  let finishFirstApply;

  const firstApplyComplete = new Promise((resolve) => {
    finishFirstApply = resolve;
  });

  const stateManager = {
    async getModeState() {
      return { state: 'ACTIVE', scopedV2: { intensity: 1 } };
    },
  };

  const cssApplier = {
    async applyMode(_tabId, _modeId, params) {
      applyCalls.push(params);
      if (applyCalls.length === 1) {
        await firstApplyComplete;
      }
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

  const firstRun = manager.rehydrateActiveModesForTab(tabId, 'rehydrate');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(applyCalls.length, 1);

  const queuedRun = manager.rehydrateActiveModesForTab(tabId, 'prefs:comfortVisual');

  assert.equal(applyCalls.length, 1);
  finishFirstApply();

  await Promise.all([firstRun, queuedRun]);

  assert.equal(applyCalls.length, 2);
  assert.equal(applyCalls[1].forceReapply, true);
  assert.equal(applyCalls[1].reapplyReason, 'prefs:comfortVisual');
});

test('rehydrateActiveModesForTab skips apply when mode is inactive before reapply', async () => {
  const applyCalls = [];
  const tabId = 123;
  let reads = 0;

  const stateManager = {
    async getModeState() {
      reads += 1;
      return reads === 1
        ? { state: 'ACTIVE', scopedV2: { intensity: 1 } }
        : { state: 'INACTIVE', scopedV2: null };
    },
  };

  const cssApplier = {
    async applyMode() {
      applyCalls.push('apply');
      return { ok: true };
    },
  };

  const manager = createRehydrateManager({
    modeIds: { focus: 'focus' },
    stateManager,
    cssApplier,
    isValidTabId: (value) => typeof value === 'number',
    tabsApi: { get: async () => ({ id: tabId }) },
    states: { ACTIVE: 'ACTIVE' },
    now: () => 1000,
  });

  const result = await manager.rehydrateActiveModesForTab(tabId, 'content-ready');

  assert.equal(applyCalls.length, 0);
  assert.deepEqual(result.applied, [
    {
      modeId: 'focus',
      ok: true,
      skipped: true,
      reason: 'mode-inactive',
    },
  ]);
});

test('rehydrateActiveModesForTab marks ERROR when reapply fails', async () => {
  const tabId = 123;
  const updates = [];
  const statuses = [];

  const stateManager = {
    async getModeState() {
      return { state: 'ACTIVE', activeQuality: 'SCOPED_V2_VERIFIED', scopedV2: { intensity: 1 } };
    },
    async updateTabModeState(tabIdArg, modeId, updatesArg) {
      updates.push({ tabId: tabIdArg, modeId, updates: updatesArg });
    },
    async setSmartScopeStatus(tabIdArg, modeId, status) {
      statuses.push({ tabId: tabIdArg, modeId, status });
    },
  };

  const cssApplier = {
    async applyMode() {
      return { ok: false, reason: 'NO_SCOPE' };
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

  const result = await manager.rehydrateActiveModesForTab(tabId, 'content-ready');

  assert.equal(result.ok, false);
  assert.deepEqual(result.applied, [{ modeId: 'comfort-visual', ok: false, error: 'NO_SCOPE' }]);
  assert.deepEqual(updates, [
    {
      tabId,
      modeId: 'comfort-visual',
      updates: {
        state: 'ERROR',
        pendingDecision: false,
        activeQuality: null,
      },
    },
  ]);
  assert.equal(statuses[0].status.error, 'REHYDRATE_FAILED');
  assert.equal(statuses[0].status.reason, 'NO_SCOPE');
});
