import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  EFFECT_CLASSES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
  createEmptyTemplateMemoryV1,
  isTemplateMemoryEntryReliableV1,
  normalizeTemplateMemoryStoreV1,
  pruneTemplateMemoryV1,
  reduceTemplateMemoryOutcomeV1,
  validateTemplateMemoryStoreV1,
} from '../../shared/engine-core/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DOMAIN_HASH = 'tmh1_aaaaaaaaaaaaaaaaaaaaaa';
const TEMPLATE_HASH = 'tmh1_bbbbbbbbbbbbbbbbbbbbbb';
const SCOPE_HASH = 'tmh1_cccccccccccccccccccccc';
const FOCUS_LEARNING_KEY = Object.freeze({
  modeId: 'focus',
  actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
  targetKind: TARGET_KINDS.READING_REGION,
  effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
  pageType: PAGE_TYPES.ARTICLE,
});
const COMFORT_LEARNING_KEY = Object.freeze({
  modeId: 'comfort-visual',
  actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
  targetKind: TARGET_KINDS.READING_REGION,
  effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
  pageType: PAGE_TYPES.ARTICLE,
});
const PAGE_CLARITY_LEARNING_KEY = Object.freeze({
  modeId: 'comfort-visual',
  actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
  targetKind: TARGET_KINDS.RECORD_REGION,
  effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
  pageType: PAGE_TYPES.SEARCH,
});

function validEntry(overrides = {}) {
  return {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 2 }],
    riskBands: { layout: 'LOW', interaction: 'LOW', confidence: 'MEDIUM' },
    scopeFingerprints: [{
      scopeHash: SCOPE_HASH,
      roleHint: BLOCK_ROLES.ARTICLE,
      confidenceBand: 'HIGH',
      boxBins: { x: 1, y: 2, w: 8, h: 6, visible: 10 },
      metricBins: { textDensity: 8, linkDensity: 1, interactiveDensity: 1, mediaDensity: 0, formDensity: 0, tableDensity: 0, viewportCoverage: 7 },
      reasonCodes: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    }],
    actionCounters: [{
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
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
    ...overrides,
  };
}

test('TemplateMemoryStoreV1 validates only versioned compact fields', () => {
  const store = {
    schemaVersion: 1,
    hashVersion: 'tmh1',
    entries: [validEntry()],
  };

  assert.equal(validateTemplateMemoryStoreV1(store).ok, true);
  assert.equal(isTemplateMemoryEntryReliableV1(store.entries[0], ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY), true);

  assert.equal(validateTemplateMemoryStoreV1({
    ...store,
    entries: [validEntry({ domainHash: 'example.com' })],
  }).ok, false);

  assert.equal(validateTemplateMemoryStoreV1({
    ...store,
    entries: [validEntry({ templateHash: 'h123' })],
  }).ok, false);
});

test('TemplateMemoryStoreV1 rejects durable privacy leaks recursively', () => {
  const leaked = {
    schemaVersion: 1,
    hashVersion: 'tmh1',
    entries: [{
      ...validEntry(),
      scopeFingerprints: [{
        ...validEntry().scopeFingerprints[0],
        selector: '#account .private',
      }],
    }],
  };

  const validation = validateTemplateMemoryStoreV1(leaked);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.path.includes('selector')));

  assert.equal(validateTemplateMemoryStoreV1({
    schemaVersion: 1,
    hashVersion: 'tmh1',
    entries: [validEntry({ pageUrl: 'https://private.example/path' })],
  }).ok, false);
});

test('reduceTemplateMemoryOutcomeV1 promotes only bounded eligible counters', () => {
  const now = 100 * DAY_MS;
  let store = createEmptyTemplateMemoryV1();

  for (let index = 0; index < 3; index += 1) {
    store = reduceTemplateMemoryOutcomeV1(store, {
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 2 }],
      riskBands: { layout: 0.2, interaction: 0.1, confidence: 0.4 },
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    }, { nowMs: now + index });
  }

  const entry = store.entries[0];
  assert.equal(entry.actionCounters[0].learningEligibleCount, 3);
  assert.equal(isTemplateMemoryEntryReliableV1(entry, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY), true);

  store = reduceTemplateMemoryOutcomeV1(store, {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  }, { nowMs: now + 4 });

  assert.equal(store.entries[0].actionCounters[0].undoCount, 1);
  assert.equal(isTemplateMemoryEntryReliableV1(store.entries[0], ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY), false);
});

test('TemplateMemoryStoreV1 separates counters by LearningEffectKeyV1 while preserving legacy counters', () => {
  const now = 100 * DAY_MS;
  let store = createEmptyTemplateMemoryV1();

  store = reduceTemplateMemoryOutcomeV1(store, {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
  }, { nowMs: now });
  assert.equal(isTemplateMemoryEntryReliableV1(store.entries[0], ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY), false);

  for (let index = 0; index < 3; index += 1) {
    store = reduceTemplateMemoryOutcomeV1(store, {
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      learningEffectKey: COMFORT_LEARNING_KEY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    }, { nowMs: now + index + 1 });
    store = reduceTemplateMemoryOutcomeV1(store, {
      domainHash: DOMAIN_HASH,
      templateHash: TEMPLATE_HASH,
      pageType: PAGE_TYPES.ARTICLE,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      learningEffectKey: FOCUS_LEARNING_KEY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    }, { nowMs: now + index + 10 });
  }

  const entry = store.entries[0];
  assert.equal(entry.actionCounters.length, 3);
  assert.equal(
    isTemplateMemoryEntryReliableV1(entry, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY, {
      learningEffectKey: COMFORT_LEARNING_KEY,
    }),
    true,
  );
  assert.equal(
    isTemplateMemoryEntryReliableV1(entry, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY, {
      learningEffectKey: FOCUS_LEARNING_KEY,
    }),
    true,
  );
  assert.equal(isTemplateMemoryEntryReliableV1(entry, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY), false);
});

test('TemplateMemoryStoreV1 refuses PAGE_CLARITY positive learning counters', () => {
  const store = reduceTemplateMemoryOutcomeV1(createEmptyTemplateMemoryV1(), {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.SEARCH,
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    learningEffectKey: PAGE_CLARITY_LEARNING_KEY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
  }, { nowMs: 100 * DAY_MS });

  assert.equal(store.entries.length, 1);
  assert.equal(store.entries[0].actionCounters.length, 0);
  assert.equal(
    isTemplateMemoryEntryReliableV1(store.entries[0], ADAPTATION_ACTION_IDS.PAGE_CLARITY, {
      learningEffectKey: PAGE_CLARITY_LEARNING_KEY,
    }),
    false,
  );
});

test('template memory normalization prunes malformed, expired and excess entries', () => {
  const now = 100 * DAY_MS;
  const entries = [];
  for (let index = 0; index < 305; index += 1) {
    entries.push(validEntry({
      templateHash: `tmh1_${String(index).padStart(22, 'a').slice(-22)}`,
      seenCount: index,
      firstSeenBucket: index,
      lastSeenBucket: index,
    }));
  }
  entries.push(validEntry({
    domainHash: 'bad',
    lastSeenBucket: 100,
  }));

  const normalized = normalizeTemplateMemoryStoreV1({
    schemaVersion: 1,
    hashVersion: 'tmh1',
    entries,
  }, { nowMs: now });
  const pruned = pruneTemplateMemoryV1(normalized, { nowMs: now, maxEntries: 10, ttlMs: 20 * DAY_MS });

  assert.equal(pruned.entries.length, 10);
  assert.equal(pruned.entries.some((entry) => entry.domainHash === 'bad'), false);
  assert.ok(pruned.entries.every((entry) => entry.lastSeenBucket >= 80));
});
