import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { afterEach, test } from 'node:test';

import { learningEngine } from '../../background/learning-engine.js';
import {
  clearOutcomeLedgerForTests,
  recordAcceptedApplyOutcome,
} from '../../background/outcome-ledger.js';
import {
  clearTemplateMemoryForTests,
  evaluateTemplatePersonalizationGate,
  getTemplateMemoryForTests,
  recordEligibleTemplateOutcome,
  recordTemplateMemoryNegativeOutcome,
  recordTemplateMemoryOutcome,
} from '../../background/template-memory.js';
import {
  DECISIONS,
  MODE_IDS,
  STORAGE_KEYS,
} from '../../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  EFFECT_CLASSES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
  createEmptyTemplateMemoryV1,
} from '../../shared/engine-core/index.js';

const DOMAIN_HASH = 'tmh1_dddddddddddddddddddddd';
const TEMPLATE_HASH = 'tmh1_eeeeeeeeeeeeeeeeeeeeee';
const OTHER_TEMPLATE_HASH = 'tmh1_ffffffffffffffffffffff';
const FOCUS_LEARNING_KEY = Object.freeze({
  modeId: MODE_IDS.FOCUS,
  actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
  targetKind: TARGET_KINDS.RECORD_REGION,
  effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
  pageType: PAGE_TYPES.ARTICLE,
});
const PAGE_CLARITY_LEARNING_KEY = Object.freeze({
  modeId: MODE_IDS.COMFORT_VISUAL,
  actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
  targetKind: TARGET_KINDS.RECORD_REGION,
  effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
  pageType: PAGE_TYPES.SEARCH,
});

let cryptoWasInjected = false;

function validEntry(index) {
  return {
    domainHash: DOMAIN_HASH,
    templateHash: `tmh1_${String(index).padStart(22, '0').slice(-22)}`,
    pageType: PAGE_TYPES.ARTICLE,
    roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 1 }],
    riskBands: { layout: 'LOW', interaction: 'LOW', confidence: 'LOW' },
    scopeFingerprints: [],
    actionCounters: [{
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      postApplyPassedCount: 0,
      learningEligibleCount: 1,
      undoCount: 0,
      rollbackCount: 0,
      postApplyFailedCount: 0,
      neverOnSiteCount: 0,
      lastOutcomeEvent: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      lastOutcomeBucket: 100,
    }],
    seenCount: 1,
    firstSeenBucket: 100,
    lastSeenBucket: 100 + index,
  };
}

function setupChromeStorage({ bytesInUse = null } = {}) {
  cryptoWasInjected = false;
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    cryptoWasInjected = true;
  }
  const localStore = new Map();
  const sessionStore = new Map();
  const calls = { getBytesInUse: 0 };
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            const result = {};
            key.forEach((item) => {
              result[item] = localStore.get(item);
            });
            return result;
          }
          return { [key]: localStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            localStore.set(key, value);
          });
        },
        async clear() {
          localStore.clear();
        },
        async getBytesInUse() {
          calls.getBytesInUse += 1;
          if (bytesInUse != null) return bytesInUse;
          const value = localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1);
          return value ? JSON.stringify(value).length : 0;
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
  return { localStore, sessionStore, calls };
}

afterEach(() => {
  delete global.chrome;
  if (cryptoWasInjected) {
    delete globalThis.crypto;
  }
  cryptoWasInjected = false;
});

test('recordTemplateMemoryOutcome stores only compact hashed template fields', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const now = Date.now();

  const result = await recordTemplateMemoryOutcome({
    siteKey: 'https://private.example/path?q=secret',
    templateSignature: {
      pageType: PAGE_TYPES.ARTICLE,
      roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 2 }],
      riskBands: { layout: 'LOW', interaction: 'LOW', confidence: 'MEDIUM' },
    },
    pageType: PAGE_TYPES.ARTICLE,
    roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 2 }],
    riskBands: { layout: 0.2, interaction: 0.1, confidence: 0.4 },
    scopeFingerprints: [{
      selector: '#private .account',
      roleHint: BLOCK_ROLES.ARTICLE,
      confidenceBand: 'HIGH',
      boxBins: { x: 1, y: 2, w: 8, h: 6, visible: 10 },
      metricBins: { textDensity: 8, linkDensity: 1, interactiveDensity: 1, mediaDensity: 0, formDensity: 0, tableDensity: 0, viewportCoverage: 7 },
      reasonCodes: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    }],
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    learningEligible: true,
  }, { nowMs: now });

  assert.equal(result.recorded, true);
  const store = await getTemplateMemoryForTests();
  assert.equal(store.entries.length, 1);
  assert.match(store.entries[0].domainHash, /^tmh1_/);
  assert.match(store.entries[0].templateHash, /^tmh1_/);

  const serialized = JSON.stringify(store);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/path'), false);
  assert.equal(serialized.includes('selector'), false);
  assert.equal(serialized.includes('#private'), false);
});

test('recordEligibleTemplateOutcome rejects raw positives and non-versioned hashes', async () => {
  const { localStore } = setupChromeStorage();
  await clearTemplateMemoryForTests();

  assert.deepEqual(await recordEligibleTemplateOutcome({
    decision: DECISIONS.ENABLED,
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
  }), { recorded: false, reason: 'NOT_LEARNING_ELIGIBLE' });

  assert.deepEqual(await recordTemplateMemoryOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: 'h123',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    learningEligible: true,
  }), { recorded: false, reason: 'MISSING_TEMPLATE_HASH' });

  assert.equal(localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1)?.entries.length, 0);
});

test('recordTemplateMemoryOutcome refuses every non-eligible direct write', async () => {
  const { localStore } = setupChromeStorage();
  await clearTemplateMemoryForTests();

  for (const event of [
    OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED,
    OUTCOME_LEDGER_EVENTS.USER_ACCEPTED,
    OUTCOME_LEDGER_EVENTS.USER_UNDID,
    OUTCOME_LEDGER_EVENTS.ROLLED_BACK,
    OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED,
    OUTCOME_LEDGER_EVENTS.USER_NEVER_ON_SITE,
  ]) {
    const result = await recordTemplateMemoryOutcome({
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      event,
      learningEligible: event === OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      source: event === OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED ? 'rehydrate' : 'auto',
    });
    assert.deepEqual(result, { recorded: false, reason: 'NOT_LEARNING_ELIGIBLE' });
  }

  assert.deepEqual(await recordTemplateMemoryOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    learningEligible: false,
  }), { recorded: false, reason: 'NOT_LEARNING_ELIGIBLE' });

  assert.equal(localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1)?.entries.length, 0);
});

test('recordTemplateMemoryNegativeOutcome records only strong negative template blockers', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  assert.deepEqual(await recordTemplateMemoryNegativeOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.USER_ACCEPTED,
  }), { recorded: false, reason: 'NOT_NEGATIVE_OUTCOME' });

  const result = await recordTemplateMemoryNegativeOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  });

  assert.equal(result.recorded, true);
  const store = await getTemplateMemoryForTests();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].actionCounters[0].undoCount, 1);
  assert.equal(JSON.stringify(store).includes('https://'), false);
});

test('learning engine promotes eligible ledger metadata into template memory only after PR7 eligibility', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  await clearTemplateMemoryForTests();
  const base = Date.now();

  await learningEngine.applyDecision('example.com', MODE_IDS.FOCUS, DECISIONS.ENABLED);
  assert.equal((await getTemplateMemoryForTests()).entries.length, 0);

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-template',
    timestampMs: base,
    noUndoWindowMs: 10,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
  });

  await learningEngine.applyEligibleOutcomeEvents(MODE_IDS.FOCUS, 'example.com', base + 10);
  const store = await getTemplateMemoryForTests();
  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].templateHash, TEMPLATE_HASH);
  assert.equal(store.entries[0].actionCounters[0].learningEligibleCount, 1);
  assert.deepEqual(store.entries[0].actionCounters[0].learningEffectKey, {
    modeId: MODE_IDS.FOCUS,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    targetKind: TARGET_KINDS.READING_REGION,
    effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
    pageType: PAGE_TYPES.ARTICLE,
  });
});

test('evaluateTemplatePersonalizationGate reads only validated template counters', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  for (let index = 0; index < 3; index += 1) {
    await recordTemplateMemoryOutcome({
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      learningEligible: true,
    }, { nowMs: Date.now() + index });
  }

  const allowed = await evaluateTemplatePersonalizationGate({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    risk: { layoutRisk: 0.1, interactionRisk: 0.1, confidenceRisk: 0.1 },
  });
  assert.equal(allowed.allowed, true);

  await recordTemplateMemoryNegativeOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.ROLLED_BACK,
  });

  const blocked = await evaluateTemplatePersonalizationGate({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    risk: { layoutRisk: 0.1, interactionRisk: 0.1, confidenceRisk: 0.1 },
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.includes('ROLLBACK_BLOCK'));
});

test('template memory uses LearningEffectKeyV1 before legacy action counters', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  for (let index = 0; index < 3; index += 1) {
    await recordTemplateMemoryOutcome({
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      learningEffectKey: FOCUS_LEARNING_KEY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      learningEligible: true,
    }, { nowMs: Date.now() + index });
  }

  const keyed = await evaluateTemplatePersonalizationGate({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    learningEffectKey: FOCUS_LEARNING_KEY,
    risk: { layoutRisk: 0.1, interactionRisk: 0.1, confidenceRisk: 0.1 },
  });
  assert.equal(keyed.allowed, true);

  const wrongKey = await evaluateTemplatePersonalizationGate({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    learningEffectKey: {
      ...FOCUS_LEARNING_KEY,
      targetKind: TARGET_KINDS.READING_REGION,
    },
    risk: { layoutRisk: 0.1, interactionRisk: 0.1, confidenceRisk: 0.1 },
  });
  assert.equal(wrongKey.allowed, false);
  assert.ok(wrongKey.reasons.includes('MISSING_ACTION_COUNTER'));
});

test('PAGE_CLARITY cannot create positive template learning', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  const result = await recordTemplateMemoryOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.SEARCH,
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    learningEffectKey: PAGE_CLARITY_LEARNING_KEY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    learningEligible: true,
  });

  assert.deepEqual(result, { recorded: false, reason: 'PAGE_CLARITY_LEARNING_DISABLED' });
  assert.equal((await getTemplateMemoryForTests()).entries.length, 0);
});

test('template memory applies LRU pressure when local bytes are already high', async () => {
  const { localStore, calls } = setupChromeStorage({ bytesInUse: 999999 });
  localStore.set(STORAGE_KEYS.TEMPLATE_MEMORY_V1, {
    ...createEmptyTemplateMemoryV1(),
    entries: Array.from({ length: 12 }, (_, index) => validEntry(index)),
  });

  const result = await recordTemplateMemoryOutcome({
    domainHash: DOMAIN_HASH,
    templateHash: OTHER_TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    learningEligible: true,
  }, { nowMs: 150 * 24 * 60 * 60 * 1000 });

  assert.equal(result.recorded, true);
  assert.ok(calls.getBytesInUse >= 1);
  assert.ok(localStore.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1).entries.length <= 6);
});
