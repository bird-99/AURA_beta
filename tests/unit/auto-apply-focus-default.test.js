import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import AutoApplyManager from '../../background/auto-apply-manager.js';
import { DECISIONS, LEARNING_STAGES, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  evaluateConservativePersonalizationGateV1,
} from '../../shared/engine-core/index.js';
import { PROFILE_ACTIONS, PROFILE_MATCH_TYPES } from '../../shared/site-profiles.js';

const DOMAIN_HASH = 'tmh1_aaaaaaaaaaaaaaaaaaaaaa';
const TEMPLATE_HASH = 'tmh1_bbbbbbbbbbbbbbbbbbbbbb';

function setupChromeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  global.chrome = {
    storage: {
      local: {
        async get(key) {
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
          Object.entries(data).forEach(([itemKey, value]) => {
            store.set(itemKey, value);
          });
        },
      },
    },
    tabs: {
      async get() {
        return { id: 1, url: 'https://example.com/article' };
      },
      async sendMessage() {
        return { ok: true };
      },
    },
  };
  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('isFocusDefaultEnabled is false when user prefs are missing', async () => {
  setupChromeStorage();
  const manager = new AutoApplyManager({}, {}, {}, {}, {});

  const enabled = await manager.isFocusDefaultEnabled();

  assert.equal(enabled, false);
});

test('isFocusDefaultEnabled is true only when explicitly enabled', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.USER_PREFS]: { focusDefaultEnabled: true },
  });
  const manager = new AutoApplyManager({}, {}, {}, {}, {});

  const enabled = await manager.isFocusDefaultEnabled();

  assert.equal(enabled, true);
});

test('isFocusDefaultEnabled is false when explicitly disabled', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.USER_PREFS]: { focusDefaultEnabled: false },
  });
  const manager = new AutoApplyManager({}, {}, {}, {}, {});

  const enabled = await manager.isFocusDefaultEnabled();

  assert.equal(enabled, false);
});

test('evaluateFocusDefault does not auto-apply Focus without trusted live evidence', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.USER_PREFS]: { focusDefaultEnabled: true },
  });
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.MANUAL,
    weight: 0,
    lastDecision: null,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  });

  const applied = await manager.evaluateFocusDefault(1);

  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateFocusDefault applies Focus only with frame-bound conservative live evidence', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.USER_PREFS]: { focusDefaultEnabled: true },
  });
  let builderCalls = 0;
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.MANUAL,
    weight: 0,
    lastDecision: null,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  }, {
    liveGateBuilder: async ({ tabId, modeId, siteKey, requestedStrength }) => {
      builderCalls += 1;
      assert.equal(tabId, 1);
      assert.equal(modeId, MODE_IDS.FOCUS);
      assert.equal(siteKey, 'example.com');
      assert.equal(requestedStrength, 1);
      return {
        ok: true,
        gate: validPersonalizationGate(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY),
        frameId: 0,
      };
    },
  });

  const applied = await manager.evaluateFocusDefault(1);

  assert.equal(applied, true);
  assert.equal(builderCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'focus-default');
  assert.equal(calls[0].modeId, MODE_IDS.FOCUS);
  assert.deepEqual(calls[0].params, { frameId: 0, preventFrameFallback: true });
});

test('evaluateFocusDefault preserves explicit profile-always Focus override', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.USER_PREFS]: { focusDefaultEnabled: true },
    [STORAGE_KEYS.SITE_PROFILES]: {
      entries: [{
        id: 'focus-profile-always-example',
        action: PROFILE_ACTIONS.ALWAYS,
        matchType: PROFILE_MATCH_TYPES.DOMAIN,
        modeId: MODE_IDS.FOCUS,
        value: 'example.com',
      }],
    },
  });
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.MANUAL,
    weight: 0,
    lastDecision: null,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  });

  const applied = await manager.evaluateFocusDefault(1);

  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'profile-always');
  assert.equal(calls[0].modeId, MODE_IDS.FOCUS);
});

function buildAutoApplyHarness(learningState, { liveGateBuilder = null, decisionHandlerOverrides = {}, stateManagerOverrides = {} } = {}) {
  const calls = [];
  class HarnessAutoApplyManager extends AutoApplyManager {
    async autoApplyMode(tabId, modeId, siteKey, source = 'auto', params = {}) {
      calls.push({ tabId, modeId, siteKey, source, params });
    }
  }

  const manager = new HarnessAutoApplyManager(
    {
      async setSmartScopeStatus() {},
      async getModeState() {
        return { state: STATES.INACTIVE };
      },
      ...stateManagerOverrides,
    },
    {},
    {},
    {
      async getLearningState() {
        return learningState;
      },
    },
    {
      async isDenylisted() {
        return false;
      },
      async isAllowlisted() {
        return false;
      },
      async isInCooldown() {
        return false;
      },
      ...decisionHandlerOverrides,
    },
    liveGateBuilder,
  );

  return { manager, calls };
}

function validPersonalizationGate(actionId = ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY) {
  return evaluateConservativePersonalizationGateV1({
    schemaVersion: 1,
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    pageTypeConfidence: 0.92,
    risk: { layoutRisk: 0.1, interactionRisk: 0.1, confidenceRisk: 0.1 },
    reasons: [],
    candidates: [],
    problems: [],
    stats: { elapsedMs: 1, nodesScanned: 1, candidatesSeen: 1, budgetHit: false },
    selectedScope: null,
  }, actionId, {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 1 }],
    riskBands: { layout: 'LOW', interaction: 'LOW', confidence: 'LOW' },
    scopeFingerprints: [],
    actionCounters: [{
      actionId,
      postApplyPassedCount: 0,
      learningEligibleCount: 3,
      undoCount: 0,
      rollbackCount: 0,
      postApplyFailedCount: 0,
      neverOnSiteCount: 0,
      lastOutcomeEvent: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      lastOutcomeBucket: 100,
    }],
    seenCount: 3,
    firstSeenBucket: 98,
    lastSeenBucket: 100,
  });
}

test('evaluateAutoApply rejects legacy AUTO learning without PR7 eligibility provenance', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, { autoThreshold: 0.8 });

  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply allows an injected PR10 gate only with explicit frame identity when no live builder exists', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 1,
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, {
    autoThreshold: 0.8,
    personalizationGate: validPersonalizationGate(),
    personalizationFrameId: 0,
  });

  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].siteKey, 'example.com');
  assert.deepEqual(calls[0].params, { frameId: 0, preventFrameFallback: true });
});

test('evaluateAutoApply rejects forged or bypassed PR10 gates', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  });

  const forged = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, {
    autoThreshold: 0.8,
    personalizationGate: {
      version: 1,
      source: 'CONSERVATIVE_PERSONALIZATION_V1',
      allowed: true,
    },
  });
  const bypassed = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, {
    autoThreshold: 0.8,
    personalizationGateRequired: false,
  });

  assert.equal(forged, false);
  assert.equal(bypassed, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply fails closed without a PR10 personalization gate', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, { autoThreshold: 0.8 });

  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply rejects a valid injected PR10 gate without frame identity', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, {
    autoThreshold: 0.8,
    personalizationGate: validPersonalizationGate(),
  });

  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply preserves explicit profile-always override without PR10 gate', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.SITE_PROFILES]: {
      entries: [{
        id: 'profile-always-example',
        action: PROFILE_ACTIONS.ALWAYS,
        matchType: PROFILE_MATCH_TYPES.DOMAIN,
        modeId: 'comfort-visual',
        value: 'example.com',
      }],
    },
  });
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.MANUAL,
    weight: 0,
    lastDecision: null,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.1, { autoThreshold: 0.8 });

  assert.equal(applied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'profile-always');
});

test('evaluateAutoApply fails closed on a structured denylist read error even for profile-always', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.SITE_PROFILES]: {
      entries: [{
        id: 'profile-always-storage-error',
        action: PROFILE_ACTIONS.ALWAYS,
        matchType: PROFILE_MATCH_TYPES.DOMAIN,
        modeId: MODE_IDS.COMFORT_VISUAL,
        value: 'example.com',
      }],
    },
  });
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 1,
  }, {
    decisionHandlerOverrides: {
      async readDenylistStatus() {
        return { ok: false, status: 'error', error: 'storage offline' };
      },
    },
  });

  const applied = await manager.evaluateAutoApply(1, MODE_IDS.COMFORT_VISUAL, 0.95);
  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply keeps denylist and cooldown ahead of profile-always', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.SITE_PROFILES]: {
      entries: [{
        id: 'profile-always-negative-precedence',
        action: PROFILE_ACTIONS.ALWAYS,
        matchType: PROFILE_MATCH_TYPES.DOMAIN,
        modeId: MODE_IDS.COMFORT_VISUAL,
        value: 'example.com',
      }],
    },
  });
  const learningState = {
    stage: LEARNING_STAGES.MANUAL,
    weight: 0,
    lastDecision: null,
    eligibilityVersion: 0,
    eligiblePositiveCount: 0,
  };
  const denied = buildAutoApplyHarness(learningState, {
    decisionHandlerOverrides: {
      async isDenylisted() { return true; },
    },
  });
  const coolingDown = buildAutoApplyHarness(learningState, {
    decisionHandlerOverrides: {
      async isInCooldown() { return true; },
    },
  });

  assert.equal(await denied.manager.evaluateAutoApply(1, MODE_IDS.COMFORT_VISUAL, 0.1), false);
  assert.equal(await coolingDown.manager.evaluateAutoApply(1, MODE_IDS.COMFORT_VISUAL, 0.1), false);
  assert.deepEqual(denied.calls, []);
  assert.deepEqual(coolingDown.calls, []);
});

test('evaluateAutoApply builds live gate only after cheap guards pass', async () => {
  setupChromeStorage();
  let builderCalls = 0;
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  }, {
    liveGateBuilder: async ({ tabId, modeId, siteKey, requestedStrength }) => {
      builderCalls += 1;
      assert.equal(tabId, 1);
      assert.equal(modeId, 'comfort-visual');
      assert.equal(siteKey, 'example.com');
      assert.equal(requestedStrength, 0.95);
      return { ok: true, gate: validPersonalizationGate(), frameId: 0 };
    },
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, { autoThreshold: 0.8 });

  assert.equal(applied, true);
  assert.equal(builderCalls, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, { frameId: 0, preventFrameFallback: true });
});

test('evaluateAutoApply cannot bypass live builder with a supplied PR10 gate', async () => {
  setupChromeStorage();
  let builderCalls = 0;
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  }, {
    liveGateBuilder: async () => {
      builderCalls += 1;
      return { ok: false, gate: validPersonalizationGate(), frameId: 0 };
    },
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, {
    autoThreshold: 0.8,
    personalizationGate: validPersonalizationGate(),
    personalizationFrameId: 0,
  });

  assert.equal(applied, false);
  assert.equal(builderCalls, 1);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply requires live builder results to be ok and frame-bound', async () => {
  setupChromeStorage();
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  }, {
    liveGateBuilder: async () => ({ ok: true, gate: validPersonalizationGate() }),
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, { autoThreshold: 0.8 });

  assert.equal(applied, false);
  assert.deepEqual(calls, []);
});

test('evaluateAutoApply does not collect live gate when cooldown blocks first', async () => {
  setupChromeStorage();
  let builderCalls = 0;
  const { manager, calls } = buildAutoApplyHarness({
    stage: LEARNING_STAGES.AUTO,
    weight: 0.95,
    lastDecision: DECISIONS.ENABLED,
    eligibilityVersion: 1,
    eligiblePositiveCount: 3,
  }, {
    liveGateBuilder: async () => {
      builderCalls += 1;
      return { gate: validPersonalizationGate() };
    },
    decisionHandlerOverrides: {
      async isInCooldown() {
        return true;
      },
    },
  });

  const applied = await manager.evaluateAutoApply(1, 'comfort-visual', 0.95, { autoThreshold: 0.8 });

  assert.equal(applied, false);
  assert.equal(builderCalls, 0);
  assert.deepEqual(calls, []);
});
