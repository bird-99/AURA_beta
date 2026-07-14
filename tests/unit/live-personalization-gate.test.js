import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  buildLiveTemplateEvidence,
  buildLivePersonalizationGate,
  buildLiveRuntimeApplyContext,
  LIVE_PERSONALIZATION_GATE_BUDGET,
} from '../../background/live-personalization-gate.js';
import {
  clearOutcomeLedgerForTests,
  consumeEligibleLearningEvents,
  getOutcomeLedgerForTests,
  recordAcceptedApplyOutcome,
  recordRejectedApplyOutcome,
  recordUserOutcome,
} from '../../background/outcome-ledger.js';
import {
  clearTemplateMemoryForTests,
  getTemplateMemoryForTests,
  recordTemplateMemoryNegativeOutcome,
  recordTemplateMemoryOutcome,
} from '../../background/template-memory.js';
import {
  templateEvidenceForFrame,
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from '../../background/template-evidence.js';
import {
  ACTION_POLICY_DECISIONS,
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  TARGET_KINDS,
  buildTemplateShapeSignatureV1,
  routePageSignalsV1,
} from '../../shared/engine-core/index.js';
import { MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');

let cryptoWasInjected = false;

function setupChromeStorage() {
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
  if (cryptoWasInjected) {
    delete globalThis.crypto;
  }
  cryptoWasInjected = false;
});

function articleSignals(overrides = {}) {
  return {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_article_test_v1',
    routeEpoch: 'aura_pse_route_article_test_v1',
    viewport: { w: 1280, h: 720 },
    pageHints: {
      urlKind: 'UNKNOWN',
      semanticArticleCount: 1,
      formCount: 0,
      tableCount: 0,
      mediaCount: 0,
      fixedOrStickyCount: 0,
      modalLikeCount: 0,
    },
    aggregateMetrics: {
      textDensity: 0.84,
      linkDensity: 0.08,
      interactiveDensity: 0.03,
      mediaDensity: 0.02,
      formDensity: 0,
      tableDensity: 0,
      viewportCoverage: 0.72,
    },
    blocks: [{
      blockId: 'b1',
      roleHint: 'ARTICLE',
      rectRatio: { xRatio: 0.2, yRatio: 0.08, widthRatio: 0.58, heightRatio: 0.78, visibleRatio: 0.95 },
      metrics: {
        textDensity: 0.9,
        linkDensity: 0.07,
        interactiveDensity: 0.02,
        mediaDensity: 0.01,
        formDensity: 0,
        tableDensity: 0,
        viewportCoverage: 0.64,
      },
      flags: ['ARTICLE_TEXT_DENSITY_HIGH'],
    }],
    stats: { elapsedMs: 4, nodesScanned: 300, candidatesSeen: 4, budgetHit: false },
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureSignals(name, { frameId = 0 } = {}) {
  const fixture = fs.readdirSync(fixtureDir)
    .filter((candidate) => candidate.endsWith('.signals.v1.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')))
    .find((payload) => payload.name === name);
  assert.ok(fixture, `missing fixture ${name}`);
  const signals = clone(fixture.input);
  delete signals.routeFingerprint;
  signals.frameId = frameId;
  signals.blocks = signals.blocks.map((block, index) => ({
    ...block,
    blockId: `b${index + 1}`,
  }));
  return { fixture, signals };
}

function makeBridge(response, calls = []) {
  return {
    async safeSend(tabId, message, opts) {
      calls.push({ tabId, message, opts });
      return response;
    },
  };
}

function makeBridgeSequence(responses, calls = []) {
  let index = 0;
  return {
    async safeSend(tabId, message, opts) {
      calls.push({ tabId, message, opts });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    },
  };
}

async function seedTemplateMemoryFromSignals(signals, { siteKey = 'example.com', nowMs = Date.now() } = {}) {
  const profile = routePageSignalsV1(signals);
  const templateSignature = buildTemplateShapeSignatureV1(profile);
  for (let index = 0; index < 3; index += 1) {
    await recordTemplateMemoryOutcome({
      siteKey,
      templateSignature,
      pageType: profile.pageType,
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      learningEligible: true,
    }, { nowMs: nowMs + index });
  }
  return profile;
}

test('live personalization gate collects via safeSend and returns a valid PR10 gate', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const signals = articleSignals();
  await seedTemplateMemoryFromSignals(signals);
  const calls = [];

  const result = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals } }, calls),
    nowMs: Date.now() + 100,
  });

  assert.equal(result.ok, true);
  assert.equal(result.gate.allowed, true);
  assert.equal(result.policyDecision.decision, ACTION_POLICY_DECISIONS.SUGGEST_ONLY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tabId, 7);
  assert.equal(calls[0].message.action, 'PAGE_SIGNALS_COLLECT_V1');
  assert.equal(calls[0].message.budgetMs, LIVE_PERSONALIZATION_GATE_BUDGET.budgetMs);
  assert.equal(calls[0].message.maxBlocks, LIVE_PERSONALIZATION_GATE_BUDGET.maxBlocks);
  assert.deepEqual(calls[0].opts, { frameId: 0 });
});

test('live template evidence builds compact frame-bound metadata without template memory positives', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const calls = [];

  const result = await buildLiveTemplateEvidence({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'https://example.com/private/path?q=secret',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals() } }, calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.evidence.version, 1);
  assert.equal(result.evidence.source, 'TEMPLATE_EVIDENCE_V1');
  assert.match(result.evidence.domainHash, /^tmh1_/);
  assert.match(result.evidence.templateHash, /^tmh1_/);
  assert.equal(result.evidence.pageType, PAGE_TYPES.ARTICLE);
  assert.equal(result.evidence.actionId, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(result.evidence.frameId, 0);
  assert.deepEqual(result.evidence.learningEffectKey, {
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    targetKind: TARGET_KINDS.READING_REGION,
    effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
    pageType: PAGE_TYPES.ARTICLE,
  });
  assert.equal(calls[0].opts.frameId, 0);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private/path'), false);
  assert.equal(serialized.includes('q=secret'), false);
});

test('live runtime apply context builds plan and template evidence from one collection', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const calls = [];
  const { signals } = fixtureSignals('article', { frameId: 2 });

  const result = await buildLiveRuntimeApplyContext({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'https://example.com/private/path?q=secret',
    bridge: makeBridge({ ok: true, data: { ok: true, signals } }, calls),
    frameId: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message.action, 'PAGE_SIGNALS_COLLECT_V1');
  assert.deepEqual(calls[0].opts, { frameId: 2 });
  assert.equal(result.runtimeEffectPlan.modeId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(result.runtimeEffectPlan.actionId, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(result.runtimeEffectPlan.pageType, PAGE_TYPES.ARTICLE);
  assert.equal(result.runtimeEffectPlan.frameId, 2);
  assert.equal(result.runtimeEffectPlan.strongEffect, 'SCOPED_STRONG_READING_TRANSFORM');
  assert.equal(result.runtimeEffectPlan.safeDowngrade, 'SAFE_READING_TEXT_LINK_CLARITY');
  assert.equal(result.runtimeEffectPlan.policyDecision, ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION);
  assert.deepEqual(Object.keys(result.runtimeEffectPlan.v3LightShadow).sort(), [
    'actionId',
    'actionTargetConfidence',
    'actionTargetDecisionHint',
    'activationStage',
    'activePlanAllowed',
    'capabilityStatus',
    'collectionEpoch',
    'desiredEffect',
    'effectClass',
    'executor',
    'regionId',
    'routeEpoch',
    'shadowOnly',
    'sourceBlockId',
    'supportLevel',
    'targetKind',
    'version',
  ].sort());
  assert.equal(result.runtimeEffectPlan.v3LightShadow.actionId, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.targetKind, 'READING_REGION');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.effectClass, 'SCOPED_READING_TYPOGRAPHY');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.capabilityStatus, 'CAPABILITY_MISSING');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.supportLevel, 'NOT_IMPLEMENTED');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.activationStage, 'REPORT_ONLY');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.executor, 'NONE');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.activePlanAllowed, false);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.shadowOnly, true);
  assert.equal(result.templateEvidence.pageType, PAGE_TYPES.ARTICLE);
  assert.equal(result.templateEvidence.frameId, 2);
  assert.deepEqual(result.templateEvidence.learningEffectKey, {
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    targetKind: TARGET_KINDS.READING_REGION,
    effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
    pageType: PAGE_TYPES.ARTICLE,
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private/path'), false);
  assert.equal(serialized.includes('q=secret'), false);
});

test('live runtime apply context records denied policy without blocking manual plan', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const { signals } = fixtureSignals('unknown-shell-nomodal');

  const result = await buildLiveRuntimeApplyContext({
    tabId: 7,
    modeId: MODE_IDS.FOCUS,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeEffectPlan.pageType, PAGE_TYPES.UNKNOWN);
  assert.equal(result.runtimeEffectPlan.policyDecision, ACTION_POLICY_DECISIONS.DENY);
  assert.equal(result.runtimeEffectPlan.safeDowngrade, 'SAFE_GLOBAL_FOCUS_VISIBLE');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.capabilityStatus, 'SAFE_ABSTAIN');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.activePlanAllowed, false);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.shadowOnly, true);
});

test('live runtime apply context routes Comfort search to PAGE_CLARITY primary target', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const calls = [];
  const { signals } = fixtureSignals('search-results', { frameId: 3 });

  const result = await buildLiveRuntimeApplyContext({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals } }, calls),
    frameId: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(result.runtimeEffectPlan.modeId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(result.runtimeEffectPlan.actionId, ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  assert.equal(result.runtimeEffectPlan.policyDecision, ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.actionId, ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.effectClass, EFFECT_CLASSES.RECORD_CARD_CLARITY);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.capabilityStatus, 'SUPPORTED');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.executor, 'REGION_CLASS_TOKENS');
  assert.equal(result.runtimeEffectPlan.v3LightShadow.activePlanAllowed, true);
  assert.match(result.runtimeEffectPlan.v3LightShadow.collectionEpoch, /^aura_pse_collection_/);
  assert.match(result.runtimeEffectPlan.v3LightShadow.routeEpoch, /^aura_pse_route_/);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.shadowOnly, true);
  assert.deepEqual(result.templateEvidence.learningEffectKey, {
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  });
});

test('live runtime apply context retries transient unavailable page signals for manual popup planning', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const calls = [];
  const { signals } = fixtureSignals('search-results', { frameId: 3 });

  const result = await buildLiveRuntimeApplyContext({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridgeSequence([
      { ok: false, error: 'PAGE_SIGNALS_UNAVAILABLE' },
      { ok: true, data: { ok: true, signals } },
    ], calls),
    frameId: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(result.runtimeEffectPlan.actionId, ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  assert.equal(result.runtimeEffectPlan.v3LightShadow.activePlanAllowed, true);
});

test('live template evidence is frame-bound for representative fixture-derived profiles', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  const cases = [
    ['search-results', 3, PAGE_TYPES.SEARCH],
    ['product-grid', 4, PAGE_TYPES.SHOP],
    ['video-shorts', 5, PAGE_TYPES.VIDEO],
    ['form-simple', 6, PAGE_TYPES.FORM],
    ['dashboard', 7, PAGE_TYPES.DASHBOARD],
  ];

  for (const [fixtureName, frameId, pageType] of cases) {
    const { signals } = fixtureSignals(fixtureName, { frameId });
    const calls = [];
    const result = await buildLiveTemplateEvidence({
      tabId: 7,
      modeId: MODE_IDS.FOCUS,
      siteKey: 'https://fixture.example/private/path?q=secret',
      bridge: makeBridge({ ok: true, data: { ok: true, signals } }, calls),
      frameId,
    });

    assert.equal(result.ok, true, `${fixtureName} should build template evidence`);
    assert.equal(result.evidence.frameId, frameId, fixtureName);
    assert.equal(result.evidence.pageType, pageType, fixtureName);
    assert.equal(result.evidence.actionId, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY, fixtureName);
    assert.match(result.evidence.domainHash, /^tmh1_/, fixtureName);
    assert.match(result.evidence.templateHash, /^tmh1_/, fixtureName);
    assert.deepEqual(templateEvidenceForFrame(result.evidence, frameId), result.evidence, fixtureName);
    assert.equal(templateEvidenceForFrame(result.evidence, frameId + 1), null, fixtureName);
    assert.deepEqual(templateEvidenceForLedger(result.evidence), {
      templateHash: result.evidence.templateHash,
      pageType,
      learningEffectKey: result.evidence.learningEffectKey,
    }, fixtureName);
    assert.deepEqual(templateEvidenceForTemplateMemory(result.evidence, {
      siteKey: 'fixture.example',
      event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    }), {
      siteKey: 'fixture.example',
      domainHash: result.evidence.domainHash,
      templateHash: result.evidence.templateHash,
      pageType,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      learningEffectKey: result.evidence.learningEffectKey,
      event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    }, fixtureName);
    assert.equal(calls[0].opts.frameId, frameId, fixtureName);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('https://'), false, fixtureName);
    assert.equal(serialized.includes('/private/path'), false, fixtureName);
    assert.equal(serialized.includes('q=secret'), false, fixtureName);
    assert.equal(serialized.includes('route_'), false, fixtureName);
  }
});

test('fixture-derived template evidence propagates strong negative counters only as compact memory', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  const cases = [
    ['search-results', OUTCOME_LEDGER_EVENTS.USER_UNDID, 'undoCount'],
    ['product-grid', OUTCOME_LEDGER_EVENTS.ROLLED_BACK, 'rollbackCount'],
    ['video-shorts', OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED, 'postApplyFailedCount'],
    ['form-simple', OUTCOME_LEDGER_EVENTS.USER_NEVER_ON_SITE, 'neverOnSiteCount'],
  ];

  for (const [fixtureName, event, counterKey] of cases) {
    const frameId = cases.findIndex(([name]) => name === fixtureName) + 1;
    const { signals } = fixtureSignals(fixtureName, { frameId });
    const evidenceResult = await buildLiveTemplateEvidence({
      tabId: 7,
      modeId: MODE_IDS.FOCUS,
      siteKey: 'https://fixture.example/private/path?q=secret',
      bridge: makeBridge({ ok: true, data: { ok: true, signals } }),
      frameId,
    });

    assert.equal(evidenceResult.ok, true, fixtureName);
    const result = await recordTemplateMemoryNegativeOutcome(
      templateEvidenceForTemplateMemory(evidenceResult.evidence, {
        siteKey: 'fixture.example',
        event,
      }),
      { nowMs: Date.now() + frameId },
    );
    assert.equal(result.recorded, true, `${fixtureName} ${event}`);

    const store = await getTemplateMemoryForTests();
    const entry = store.entries.find((candidate) =>
      candidate.templateHash === evidenceResult.evidence.templateHash
      && candidate.pageType === evidenceResult.evidence.pageType
    );
    assert.ok(entry, `${fixtureName} should create a template-memory entry`);
    const counter = entry.actionCounters.find((candidate) =>
      candidate.actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY
    );
    assert.equal(counter?.[counterKey], 1, `${fixtureName} should increment ${counterKey}`);
    for (const key of ['undoCount', 'rollbackCount', 'postApplyFailedCount', 'neverOnSiteCount']) {
      assert.equal(counter[key], key === counterKey ? 1 : 0, `${fixtureName} ${key}`);
    }
  }

  const serialized = JSON.stringify(await getTemplateMemoryForTests());
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private/path'), false);
  assert.equal(serialized.includes('q=secret'), false);
  assert.equal(serialized.includes('route_'), false);
  assert.equal(serialized.includes('frameId'), false);
  assert.equal(serialized.includes('b_search_results'), false);
  assert.equal(serialized.includes('b_product_grid'), false);
  assert.equal(serialized.includes('b_shorts_player'), false);
  assert.equal(serialized.includes('b_form_simple'), false);
});

test('fixture-derived template evidence carries ledger metadata and blocks later eligibility', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  await clearTemplateMemoryForTests();
  const base = Date.now();
  const { signals } = fixtureSignals('article', { frameId: 2 });
  const evidenceResult = await buildLiveTemplateEvidence({
    tabId: 7,
    modeId: MODE_IDS.FOCUS,
    siteKey: 'https://fixture.example/private/path?q=secret',
    bridge: makeBridge({ ok: true, data: { ok: true, signals } }),
    frameId: 2,
  });
  assert.equal(evidenceResult.ok, true);
  const ledgerEvidence = templateEvidenceForLedger(evidenceResult.evidence);
  const memoryEvidence = templateEvidenceForTemplateMemory(evidenceResult.evidence, {
    siteKey: 'fixture.example',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  });

  await recordAcceptedApplyOutcome({
    siteKey: 'fixture.example',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-fixture-undo',
    timestampMs: base,
    noUndoWindowMs: 10,
    ...ledgerEvidence,
  });
  await recordUserOutcome({
    siteKey: 'fixture.example',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-fixture-undo',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    timestampMs: base + 5,
    ...ledgerEvidence,
  });
  const negative = await recordTemplateMemoryNegativeOutcome(memoryEvidence, { nowMs: base + 5 });
  assert.equal(negative.recorded, true);

  assert.deepEqual(await consumeEligibleLearningEvents({
    siteKey: 'fixture.example',
    modeId: MODE_IDS.FOCUS,
    now: base + 20,
  }), []);

  const ledger = await getOutcomeLedgerForTests();
  const rejected = ledger.find((entry) => entry.event === OUTCOME_LEDGER_EVENTS.LEARNING_REJECTED);
  assert.equal(rejected?.rejectionReason, 'USER_UNDID');
  assert.equal(rejected.templateHash, evidenceResult.evidence.templateHash);
  assert.equal(rejected.pageType, PAGE_TYPES.ARTICLE);
  assert.equal(ledgerEvidence.domainHash, undefined);
  assert.equal(ledgerEvidence.actionId, undefined);
  assert.equal(ledgerEvidence.frameId, undefined);
  assert.deepEqual(ledgerEvidence.learningEffectKey, evidenceResult.evidence.learningEffectKey);
  assert.equal(ledger.every((entry) => entry.domainHash === undefined), true);
  assert.equal(ledger.every((entry) => entry.actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY), true);
  assert.equal(ledger.every((entry) => entry.frameId === undefined), true);

  const failed = await recordRejectedApplyOutcome({
    siteKey: 'fixture.example',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-fixture-failed',
    reason: OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED,
    timestampMs: base + 30,
    ...ledgerEvidence,
  });
  assert.equal(failed.event, OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED);
  assert.equal(failed.templateHash, evidenceResult.evidence.templateHash);
  assert.equal(failed.pageType, PAGE_TYPES.ARTICLE);

  const serialized = JSON.stringify({
    ledger: await getOutcomeLedgerForTests(),
    memory: await getTemplateMemoryForTests(),
  });
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private/path'), false);
  assert.equal(serialized.includes('q=secret'), false);
  assert.equal(serialized.includes('route_'), false);
  assert.equal(serialized.includes('frameId'), false);
});

test('live personalization gate fails closed on unavailable or malformed content signals', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  const unavailable = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: false, error: 'PAGE_SIGNALS_ADAPTER_UNAVAILABLE' } }),
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.reason, 'PAGE_SIGNALS_ADAPTER_UNAVAILABLE');

  const privateLeak = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals({ routeFingerprint: 'route_private' }) } }),
  });
  assert.equal(privateLeak.ok, false);
  assert.equal(privateLeak.reason, 'LIVE_SIGNAL_FORBIDDEN_KEY');
});

test('live personalization gate blocks unsafe profile and missing template evidence', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();

  const video = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({
      ok: true,
      data: {
        ok: true,
        signals: articleSignals({
          pageHints: { ...articleSignals().pageHints, urlKind: 'VIDEO' },
          aggregateMetrics: { ...articleSignals().aggregateMetrics, mediaDensity: 0.95, textDensity: 0.05 },
        }),
      },
    }),
  });
  assert.equal(video.ok, false);
  assert.equal(video.reason, 'ACTION_POLICY_DENIED');

  const missingTemplate = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals() } }),
  });
  assert.equal(missingTemplate.ok, false);
  assert.equal(missingTemplate.reason, 'PERSONALIZATION_GATE_DENIED');
  assert.equal(missingTemplate.gate.allowed, false);
});

test('live personalization gate enforces live DTO caps and frame identity', async () => {
  setupChromeStorage();
  await clearTemplateMemoryForTests();
  const badFrame = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals({ frameId: 2 }) } }),
  });
  assert.equal(badFrame.ok, false);
  assert.equal(badFrame.reason, 'LIVE_FRAME_MISMATCH');

  const budgetHit = await buildLivePersonalizationGate({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals({ stats: { elapsedMs: 20, nodesScanned: 1500, candidatesSeen: 200, budgetHit: true } }) } }),
  });
  assert.equal(budgetHit.ok, false);
  assert.equal(budgetHit.reason, 'LIVE_BUDGET_HIT');

  const runtimeBudgetHit = await buildLiveRuntimeApplyContext({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    siteKey: 'example.com',
    bridge: makeBridge({ ok: true, data: { ok: true, signals: articleSignals({ stats: { elapsedMs: 20, nodesScanned: 1500, candidatesSeen: 200, budgetHit: true } }) } }),
  });
  assert.equal(runtimeBudgetHit.ok, false);
  assert.equal(runtimeBudgetHit.reason, 'LIVE_BUDGET_HIT');
}
);
