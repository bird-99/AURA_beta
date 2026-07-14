import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearShadowReplayStoreForTests,
  getShadowReplayStoreForTests,
  recordShadowReplayEvent,
} from '../../background/shadow-replay-lab.js';
import { STORAGE_KEYS } from '../../shared/constants.js';
import {
  ACTION_CONTEXT_SOURCES,
  ACTIVE_POLICY_DECISION_KINDS,
  ADAPTATION_ACTION_IDS,
  buildShadowPolicySummaryV1,
  buildShadowReplayEventV1,
  createEmptyShadowReplayStoreV1,
} from '../../shared/engine-core/index.js';

function setupChromeStorage({ bytesInUse = null } = {}) {
  const localStore = new Map();
  const sessionStore = new Map();
  const calls = { sessionBytes: 0 };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: localStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => localStore.set(key, value));
        },
      },
      session: {
        async get(key) {
          return { [key]: sessionStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => sessionStore.set(key, value));
        },
        async getBytesInUse() {
          calls.sessionBytes += 1;
          if (bytesInUse != null) return bytesInUse;
          const value = sessionStore.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1);
          return value ? JSON.stringify(value).length : 0;
        },
      },
    },
  };
  return { localStore, sessionStore, calls };
}

function validEvent(overrides = {}) {
  const active = buildShadowPolicySummaryV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    decisionKind: ACTIVE_POLICY_DECISION_KINDS.APPLY,
    score: 0.9,
    reasons: ['TEST_POLICY'],
    thresholds: { enter: 0.6, exit: 0.48, apply: 0.85 },
  });
  const shadow = {
    schemaVersion: 1,
    shadowRunId: 'shr1_runrunrunrunrunrun1',
    policyId: 'ACTION_POLICY_V1',
    policyVersion: 'action-policy-v1',
    profileHash: 'shr1_profileprofileprof1',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    actionContextSource: ACTION_CONTEXT_SOURCES.USER_REQUEST,
    predictedDecision: 'REQUIRE_POST_APPLY_INSPECTION',
    predictedRisk: { layoutRisk: 0.1, interactionRisk: 0.2, confidenceRisk: 0.1, privacyRisk: 0 },
    reasonCodes: ['ARTICLE_TEXT_DENSITY_HIGH'],
    notAppliedBecause: 'SHADOW_MODE',
  };
  return buildShadowReplayEventV1({
    active,
    shadow: { ...shadow, ...(overrides.shadow || {}) },
    nowMs: overrides.nowMs || Date.now(),
    shadowRunId: overrides.shadowRunId,
  });
}

afterEach(() => {
  delete global.chrome;
});

test('shadow replay adapter writes only to session storage', async () => {
  const { localStore, sessionStore, calls } = setupChromeStorage();
  await clearShadowReplayStoreForTests();

  const result = await recordShadowReplayEvent(validEvent(), { nowMs: Date.now() });

  assert.equal(result.recorded, true);
  assert.equal(sessionStore.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1).entries.length, 1);
  assert.equal(localStore.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1), undefined);
  assert.equal(localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1), undefined);
  assert.ok(calls.sessionBytes >= 1);

  const store = await getShadowReplayStoreForTests();
  assert.equal(store.entries.length, 1);
});

test('shadow replay adapter rejects invalid privacy payloads without changing the ledger', async () => {
  const { sessionStore } = setupChromeStorage();
  await clearShadowReplayStoreForTests();
  sessionStore.set(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1, createEmptyShadowReplayStoreV1());

  const event = validEvent();
  const invalid = {
    ...event,
    shadow: {
      ...event.shadow,
      rawSignals: { pageUrl: 'https://private.example/path', selector: '#account' },
    },
  };
  const result = await recordShadowReplayEvent(invalid, { nowMs: Date.now() });

  assert.equal(result.recorded, false);
  assert.equal(result.reason, 'INVALID_SHADOW_REPLAY_EVENT');
  assert.equal(sessionStore.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1).entries.length, 0);
});

test('shadow replay adapter prunes under session byte pressure', async () => {
  const { sessionStore } = setupChromeStorage({ bytesInUse: 999999 });
  const base = validEvent();
  sessionStore.set(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1, {
    schemaVersion: 1,
    entries: Array.from({ length: 8 }, (_, index) => ({
      ...base,
      shadowRunId: `shr1_pressurepressure${index}aa`,
      timestampBucket: new Date(Date.now() - index * 1000).toISOString(),
      shadow: {
        ...base.shadow,
        shadowRunId: `shr1_pressurepressure${index}aa`,
      },
    })),
  });

  const result = await recordShadowReplayEvent(validEvent({
    shadowRunId: 'shr1_newnewnewnewnewnew1',
    shadow: { shadowRunId: 'shr1_newnewnewnewnewnew1' },
  }), { nowMs: Date.now() });

  assert.equal(result.recorded, true);
  assert.ok(sessionStore.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1).entries.length <= 4);
});
