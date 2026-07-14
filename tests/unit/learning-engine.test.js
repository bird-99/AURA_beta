import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { learningEngine } from '../../background/learning-engine.js';
import {
  DECISIONS,
  LEARNING_ADJUSTMENTS,
  LEARNING_STAGES,
  MODE_IDS,
  STORAGE_KEYS,
} from '../../shared/constants.js';
import {
  clearOutcomeLedgerForTests,
  recordAcceptedApplyOutcome,
} from '../../background/outcome-ledger.js';

function setupChromeStorage() {
  const localStore = new Map();
  const sessionStore = new Map();
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: localStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            localStore.set(key, value);
          });
        },
      },
      session: {
        async get(key) {
          return { [key]: sessionStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            sessionStore.set(key, value);
          });
        },
      },
    },
  };
  return { localStore, sessionStore };
}

afterEach(() => {
  delete global.chrome;
});

test('learningEngine does not treat raw ENABLED decisions as positive learning', async () => {
  const { localStore } = setupChromeStorage();

  await learningEngine.applyDecision('example.com', MODE_IDS.FOCUS, DECISIONS.ENABLED);

  assert.equal(localStore.get(STORAGE_KEYS.LEARNING_WEIGHTS), undefined);
});

test('learningEngine applies positive learning only from eligible outcome ledger events', async () => {
  const { localStore } = setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-learning',
    timestampMs: base,
    noUndoWindowMs: 10,
  });

  const consumed = await learningEngine.applyEligibleOutcomeEvents(MODE_IDS.FOCUS, 'example.com', base + 10);
  assert.equal(consumed.length, 1);

  const weights = localStore.get(STORAGE_KEYS.LEARNING_WEIGHTS);
  assert.deepEqual(weights['example.com'][MODE_IDS.FOCUS], {
    weight: Number(LEARNING_ADJUSTMENTS.ENABLED.toFixed(3)),
    stage: LEARNING_STAGES.ASSISTED,
    decisionCount: 1,
    enableCount: 1,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 1,
  });
});

test('learningEngine applies a lifecycle learning effect at most once', async () => {
  const { localStore } = setupChromeStorage();

  await learningEngine.applyDecision('example.com', MODE_IDS.FOCUS, DECISIONS.NOT_NOW, {
    effectId: 'operation-1:learning:not-now',
  });
  await learningEngine.applyDecision('example.com', MODE_IDS.FOCUS, DECISIONS.NOT_NOW, {
    effectId: 'operation-1:learning:not-now',
  });

  const state = localStore.get(STORAGE_KEYS.LEARNING_WEIGHTS)['example.com'][MODE_IDS.FOCUS];
  assert.equal(state.decisionCount, 1);
  assert.equal(state.lastDecision, DECISIONS.NOT_NOW);
  assert.deepEqual(state.appliedEffectIds, ['operation-1:learning:not-now']);
});
