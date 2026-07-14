import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRehydrateManager } from '../../background/rehydrate-manager.js';
import { MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
} from '../../shared/engine-core/enums.js';
import { createTemplateEvidenceV1 } from '../../background/template-evidence.js';
import { getTemplateMemoryForTests } from '../../background/template-memory.js';
import {
  clearOutcomeLedgerForTests,
  consumeEligibleLearningEvents,
  getOutcomeLedgerForTests,
  recordAcceptedApplyOutcome,
} from '../../background/outcome-ledger.js';

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

test('rehydrate records exclusive loser removal as a learning blocker', async () => {
  const tabId = 123;
  const base = Date.now();
  const previousChrome = global.chrome;
  const sessionStore = new Map();
  const localStore = new Map();
  const removeCalls = [];
  const updateCalls = [];
  const templateEvidence = createTemplateEvidenceV1({
    domainHash: 'tmh1_dddddddddddddddddddddd',
    templateHash: 'tmh1_eeeeeeeeeeeeeeeeeeeeee',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 0,
  });

  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: localStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => localStore.set(key, value));
        },
        async getBytesInUse() {
          return JSON.stringify(localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1) || {}).length;
        },
      },
      session: {
        async get(key) {
          return { [key]: sessionStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => sessionStore.set(key, value));
        },
      },
    },
  };

  const modeStates = {
    [MODE_IDS.COMFORT_VISUAL]: {
      state: STATES.ACTIVE,
      activatedAt: 100,
      scopedV2: {
        intensity: 1,
        attemptId: 'rehydrate-attempt',
        outcomeAttemptId: 'user-attempt',
        templateEvidence,
      },
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
      modeStates[modeId] = { ...modeStates[modeId], state, ...details };
    },
  };

  const cssApplier = {
    async removeMode(_tabId, modeId) {
      removeCalls.push(modeId);
      return { ok: true };
    },
    async applyMode() {
      return { ok: true };
    },
  };

  try {
    await clearOutcomeLedgerForTests();
    await recordAcceptedApplyOutcome({
      siteKey: 'example.com',
      modeId: MODE_IDS.COMFORT_VISUAL,
      attemptId: 'user-attempt',
      timestampMs: base,
      noUndoWindowMs: 10,
    });

    const manager = createRehydrateManager({
      modeIds: MODE_IDS,
      stateManager,
      cssApplier,
      isValidTabId: (value) => typeof value === 'number',
      tabsApi: { get: async () => ({ id: tabId, url: 'https://example.com/article' }) },
      states: STATES,
    });

    await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');

    assert.deepEqual(removeCalls, [MODE_IDS.COMFORT_VISUAL]);
    assert.equal(updateCalls[0].modeId, MODE_IDS.COMFORT_VISUAL);

    const ledger = await getOutcomeLedgerForTests();
    assert.ok(ledger.some((entry) =>
      entry.event === OUTCOME_LEDGER_EVENTS.USER_UNDID &&
      entry.modeId === MODE_IDS.COMFORT_VISUAL &&
      entry.attemptId === 'user-attempt' &&
      entry.templateHash === templateEvidence.templateHash &&
      entry.pageType === PAGE_TYPES.ARTICLE,
    ));

    const templateMemory = await getTemplateMemoryForTests();
    assert.equal(templateMemory.entries.length, 1);
    assert.equal(templateMemory.entries[0].templateHash, templateEvidence.templateHash);
    assert.equal(templateMemory.entries[0].actionCounters[0].undoCount, 1);

    const decisions = await consumeEligibleLearningEvents({
      siteKey: 'example.com',
      modeId: MODE_IDS.COMFORT_VISUAL,
      now: base + 1000,
    });
    assert.deepEqual(decisions, []);
  } finally {
    global.chrome = previousChrome;
  }
});

test('rehydrate keeps exclusive loser active when CSS removal fails', async () => {
  const tabId = 123;
  const applyCalls = [];
  const removeCalls = [];
  const updateCalls = [];
  const originalWarn = console.warn;

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
      return { ok: false, reason: 'remove-failed' };
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

  console.warn = () => {};
  try {
    const result = await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');

    assert.equal(result.ok, false);
    assert.deepEqual(removeCalls, [MODE_IDS.COMFORT_VISUAL]);
    assert.deepEqual(updateCalls, []);
    assert.deepEqual(applyCalls, [MODE_IDS.FOCUS]);
    assert.deepEqual(result.applied, [
      {
        modeId: MODE_IDS.COMFORT_VISUAL,
        ok: false,
        skipped: true,
        reason: 'exclusive-removal-failed',
        error: 'remove-failed',
        winnerModeId: MODE_IDS.FOCUS,
      },
      {
        modeId: MODE_IDS.FOCUS,
        ok: true,
      },
    ]);
  } finally {
    console.warn = originalWarn;
  }
});

test('rehydrate reports failure when exclusive loser state update fails', async () => {
  const tabId = 123;
  const applyCalls = [];
  const removeCalls = [];
  const updateCalls = [];
  const originalWarn = console.warn;

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
      throw new Error('state-update-failed');
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

  console.warn = () => {};
  try {
    const result = await manager.rehydrateActiveModesForTab(tabId, 'rehydrate');

    assert.equal(result.ok, false);
    assert.deepEqual(removeCalls, [MODE_IDS.COMFORT_VISUAL]);
    assert.deepEqual(updateCalls, [
      {
        modeId: MODE_IDS.COMFORT_VISUAL,
        state: STATES.INACTIVE,
        details: { pendingDecision: false },
      },
    ]);
    assert.deepEqual(applyCalls, [MODE_IDS.FOCUS]);
    assert.deepEqual(result.applied, [
      {
        modeId: MODE_IDS.COMFORT_VISUAL,
        ok: false,
        skipped: true,
        reason: 'exclusive-state-update-failed',
        error: 'state-update-failed',
        winnerModeId: MODE_IDS.FOCUS,
      },
      {
        modeId: MODE_IDS.FOCUS,
        ok: true,
      },
    ]);
  } finally {
    console.warn = originalWarn;
  }
});
