import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cssApplier } from '../../background/css-applier.js';
import { ensureExclusiveModeActive } from '../../background/mode-exclusivity-manager.js';
import { stateManager } from '../../background/state-manager.js';
import { MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
} from '../../shared/engine-core/enums.js';
import { getExclusivePeerModeId } from '../../shared/mode-exclusivity.js';
import { createTemplateEvidenceV1 } from '../../background/template-evidence.js';
import { getTemplateMemoryForTests } from '../../background/template-memory.js';

test('getExclusivePeerModeId returns the mapped peer for exclusive modes', () => {
  assert.equal(getExclusivePeerModeId(MODE_IDS.COMFORT_VISUAL), MODE_IDS.FOCUS);
  assert.equal(getExclusivePeerModeId(MODE_IDS.FOCUS), MODE_IDS.COMFORT_VISUAL);
});

test('getExclusivePeerModeId returns null for unknown modes', () => {
  assert.equal(getExclusivePeerModeId('unknown'), null);
});

test('ensureExclusiveModeActive keeps peer active when CSS removal fails', async () => {
  const originalGetModeState = stateManager.getModeState;
  const originalUpdateModeState = stateManager.updateModeState;
  const originalRemoveMode = cssApplier.removeMode;
  const previousChrome = global.chrome;
  const updates = [];
  const messages = [];

  stateManager.getModeState = async (_tabId, modeId) => {
    if (modeId === MODE_IDS.COMFORT_VISUAL) {
      return { state: STATES.ACTIVE };
    }
    return { state: STATES.INACTIVE };
  };
  stateManager.updateModeState = async (...args) => {
    updates.push(args);
  };
  cssApplier.removeMode = async () => ({ ok: false, reason: 'remove-failed' });
  global.chrome = {
    tabs: {
      async sendMessage(...args) {
        messages.push(args);
      },
    },
  };

  try {
    const result = await ensureExclusiveModeActive(7, MODE_IDS.FOCUS, { reason: 'test' });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'remove-failed');
    assert.equal(result.peerModeId, MODE_IDS.COMFORT_VISUAL);
    assert.deepEqual(updates, []);
    assert.deepEqual(messages, []);
  } finally {
    stateManager.getModeState = originalGetModeState;
    stateManager.updateModeState = originalUpdateModeState;
    cssApplier.removeMode = originalRemoveMode;
    global.chrome = previousChrome;
  }
});

test('ensureExclusiveModeActive records peer removal as a learning blocker', async () => {
  const originalGetModeState = stateManager.getModeState;
  const originalUpdateModeState = stateManager.updateModeState;
  const originalRemoveMode = cssApplier.removeMode;
  const previousChrome = global.chrome;
  const updates = [];
  const sessionStore = new Map();
  const localStore = new Map();
  const templateEvidence = createTemplateEvidenceV1({
    domainHash: 'tmh1_dddddddddddddddddddddd',
    templateHash: 'tmh1_eeeeeeeeeeeeeeeeeeeeee',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 0,
  });

  stateManager.getModeState = async (_tabId, modeId) => {
    if (modeId === MODE_IDS.COMFORT_VISUAL) {
      return {
        state: STATES.ACTIVE,
        scopedV2: {
          attemptId: 'rehydrate-attempt',
          outcomeAttemptId: 'user-attempt',
          templateEvidence,
        },
      };
    }
    return { state: STATES.INACTIVE };
  };
  stateManager.updateModeState = async (...args) => {
    updates.push(args);
  };
  cssApplier.removeMode = async () => ({ ok: true });
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
          const value = localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1);
          return value ? JSON.stringify(value).length : 0;
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
    tabs: {
      async sendMessage() {
        return { ok: true };
      },
    },
  };

  try {
    const result = await ensureExclusiveModeActive(7, MODE_IDS.FOCUS, {
      siteKey: 'example.com',
      reason: 'popup',
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(updates.length, 1);

    const ledger = sessionStore.get(STORAGE_KEYS.OUTCOME_LEDGER_V1);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].event, OUTCOME_LEDGER_EVENTS.USER_UNDID);
    assert.equal(ledger[0].modeId, MODE_IDS.COMFORT_VISUAL);
    assert.equal(ledger[0].attemptId, 'user-attempt');
    assert.equal(ledger[0].templateHash, templateEvidence.templateHash);
    assert.equal(ledger[0].pageType, PAGE_TYPES.ARTICLE);

    const templateMemory = await getTemplateMemoryForTests();
    assert.equal(templateMemory.entries.length, 1);
    assert.equal(templateMemory.entries[0].templateHash, templateEvidence.templateHash);
    assert.equal(templateMemory.entries[0].actionCounters[0].undoCount, 1);
  } finally {
    stateManager.getModeState = originalGetModeState;
    stateManager.updateModeState = originalUpdateModeState;
    cssApplier.removeMode = originalRemoveMode;
    global.chrome = previousChrome;
  }
});
