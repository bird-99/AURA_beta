import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import {
  applyScopedModeV2,
  getScopedModeV2State,
  removeScopedModeV2,
  CssApplier,
} from '../background/css-applier.js';
import { computeSitePolicy } from '../background/site-policy-manager.js';
import * as modeEngineCss from '../background/mode-engine-css.js';
import * as scopedModeV2 from '../shared/mode-engine-scoped-v2.js';
import {
  ACTIONS,
  ACTIVE_QUALITIES,
  MODE_IDS,
  SITE_BLOCK_REASONS,
  SMARTSCOPE_ACTIONS,
  STATES,
  STORAGE_KEYS,
} from '../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';
import { createTemplateEvidenceV1 } from '../background/template-evidence.js';
import {
  FOCUS_SAFE_DOWNGRADE_PROFILE_IDS,
  SAFE_DOWNGRADE_CSS_REASONS,
} from '../background/safe-downgrade-css.js';
import { PAGE_CLARITY_CSS_PROFILE_IDS } from '../background/page-clarity-css.js';
import { APPLY_FAILURE_REASONS } from '../background/apply-failure-reasons.js';
import { GLOBAL_SAFE_FALLBACK_VARIANT } from '../background/global-safe-fallback-policy.js';
import {
  ADAPTATION_ACTION_IDS,
  ACTION_POLICY_DECISIONS,
  ACTIVATION_STAGES,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  getGuaranteedEffectV1,
} from '../shared/engine-core/index.js';

function createRegistry({ failRegister = false } = {}) {
  const store = new Map();
  const removed = [];
  return {
    async register(cssText, origin, meta = {}) {
      if (failRegister) {
        throw new Error('registry failed');
      }
      const cssId = `css-${store.size + 1}`;
      const entry = { cssId, cssText, origin, ...meta };
      store.set(cssId, entry);
      return entry;
    },
    async get(id) {
      return store.get(id) || null;
    },
    async remove(id) {
      removed.push(id);
      store.delete(id);
    },
    removed,
  };
}

function createStateManager({ failActiveUpdate = false } = {}) {
  const states = new Map();
  const smartStatuses = [];
  const updates = [];

  return {
    async getModeState(tabId, modeId) {
      return states.get(`${tabId}:${modeId}`) || null;
    },
    async updateModeState(tabId, modeId, state, extras = {}) {
      updates.push({ tabId, modeId, state, extras });
      if (failActiveUpdate && state === STATES.ACTIVE) {
        throw new Error('state write failed');
      }
      states.set(`${tabId}:${modeId}`, { state, ...extras });
    },
    async setSmartScopeStatus(tabId, modeId, status) {
      smartStatuses.push({ tabId, modeId, status });
    },
    async getTabsWithActiveMode(modeId) {
      const activeTabs = [];
      states.forEach((value, key) => {
        const [tab] = key.split(':');
        if (value?.state === STATES.ACTIVE && key.endsWith(`:${modeId}`)) {
          activeTabs.push(Number(tab));
        }
      });
      return activeTabs;
    },
    statuses: smartStatuses,
    updates,
  };
}

function createPerformanceMonitor() {
  return {
    degradedTriggered: false,
    async measureLatency(fn) {
      return fn();
    },
    async measureHeapDelta(fn) {
      return fn();
    },
  };
}

function runtimeEffectPlan({
  modeId = MODE_IDS.FOCUS,
  pageType = PAGE_TYPES.UNKNOWN,
  frameId = 0,
  policyDecision = ACTION_POLICY_DECISIONS.DENY,
  actionId: requestedActionId = null,
} = {}) {
  const row = getGuaranteedEffectV1(modeId, pageType);
  const actionId =
    requestedActionId
    || (modeId === MODE_IDS.COMFORT_VISUAL
      ? ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY
      : ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);

  return {
    version: 1,
    matrixVersion: row.version,
    modeId,
    actionId,
    pageType,
    frameId,
    strongEffect: row.strongEffect,
    safeDowngrade: row.safeDowngrade,
    readerAllowed: row.readerAllowed,
    overrideAllowed: row.overrideAllowed,
    overrideScope: row.overrideScope,
    postChecks: row.postChecks,
    policyDecision,
    confidence: 0.6,
  };
}

function pageClarityRuntimeEffectPlan({
  pageType = PAGE_TYPES.SEARCH,
  frameId = 0,
  policyDecision = ACTION_POLICY_DECISIONS.DENY,
  primary = false,
} = {}) {
  const plan = runtimeEffectPlan({
    modeId: MODE_IDS.COMFORT_VISUAL,
    pageType,
    frameId,
    policyDecision,
    actionId: primary ? ADAPTATION_ACTION_IDS.PAGE_CLARITY : undefined,
  });
  const isForm = pageType === PAGE_TYPES.FORM;
  return {
    ...plan,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
      desiredEffect: isForm
        ? 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW'
        : 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW',
      targetKind: isForm ? TARGET_KINDS.FORM_REGION : TARGET_KINDS.RECORD_REGION,
      effectClass: isForm ? EFFECT_CLASSES.FORM_LABEL_CLARITY : EFFECT_CLASSES.RECORD_CARD_CLARITY,
      sourceBlockId: 'b1',
      regionId: 'r1',
      collectionEpoch: 'aura_pse_collection_test_v1',
      routeEpoch: 'aura_pse_route_test_v1',
      capabilityStatus: CAPABILITY_STATUSES.SUPPORTED,
      supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
      activationStage: ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED,
      executor: RUNTIME_EXECUTORS.REGION_CLASS_TOKENS,
      activePlanAllowed: true,
      actionTargetDecisionHint: 'SHADOW_ONLY',
      actionTargetConfidence: 0.82,
      shadowOnly: true,
    },
  };
}

function setupChromeMock({
  scopeSelector = 'article',
  tokenResult = { ok: true, applied: 1 },
  tokenResults = null,
  setScopeRootResult = { ok: true },
  setScopeRootResponses = null,
  profileByFrameId = null,
  probeFramesResults = null,
  verifyOk = true,
  verifyReason = 'ROOT_NULL',
  verifyResponses = null,
  cleanupReason = 'not-owner',
  profileOk = true,
  profileDetail = '',
  profileReason = 'v2-selected',
  salvageResponse = { ok: false, tried: true, reason: 'ROOT_NULL' },
  salvageThrows = false,
  verifyThrows = false,
  inspectResult = {
    ok: true,
    inspected: true,
    checks: [{ code: 'SCOPED_CSS_SENTINEL_PRESENT', passed: true }],
    blockingFailures: [],
    warnings: [],
    stats: { nodesScanned: 0, elapsedMs: 1, budgetHit: false },
  },
  inspectResults = null,
  inspectThrows = false,
  baselineResult = {
    ok: true,
    baseline: { horizontalOverflow: 0 },
    stats: { elapsedMs: 1, budgetHit: false },
  },
  pageClarityBaselineResult = {
    ok: true,
    reason: 'OK',
    frameId: 0,
    markedTargets: 1,
    baselineElements: 3,
  },
  pageClarityMarkResult = {
    schemaVersion: 1,
    ok: true,
    reason: 'OK',
    sameEpoch: true,
    stillConnected: true,
    stillVisible: true,
    roleHintStillMatches: true,
    confidence: 1,
    frameId: 0,
    marked: true,
    markedCount: 1,
  },
  pageClarityProbeResult = {
    ok: true,
    reason: 'OK',
    frameId: 0,
    markedTargets: 1,
    matchedLinks: 3,
    matchedLabels: 0,
    matchedInputs: 0,
    changedElements: 3,
    inspectedElements: 3,
    targetsWithRegionDelta: 0,
    visibleEffectScore: 1,
  },
  storageValues = {},
  insertCssHandler = null,
} = {}) {
  const insertCSS = mock.fn(async (details) => {
    if (typeof insertCssHandler === 'function') {
      return insertCssHandler(details);
    }
    return undefined;
  });
  const removeCSS = mock.fn(async () => {});
  const verifyCalls = [];
  const salvageCalls = [];
  const inspectCalls = [];
  const baselineCalls = [];
  let executeScriptCall = 0;
  const darkRuntimeReceipts = new Map();
  const executeScript = mock.fn(async ({ func, args, target, files }) => {
    if (files) {
      return [];
    }
    if (Array.isArray(target?.documentIds) && target.documentIds.length === 1) {
      const documentId = target.documentIds[0];
      if (Array.isArray(args) && args.length >= 2) {
        const [tokenMap, receiptId] = args;
        Object.entries(tokenMap || {}).forEach(([key, value]) => {
          globalThis.document?.body?.style?.setProperty?.(key, value);
        });
        darkRuntimeReceipts.set(documentId, receiptId);
        return [{ frameId: 0, documentId, result: { ok: true, active: true, receiptId } }];
      }
      if (Array.isArray(args) && args.length === 1) {
        darkRuntimeReceipts.delete(documentId);
        return [{ frameId: 0, documentId, result: { ok: true, active: false } }];
      }
      const receiptId = darkRuntimeReceipts.get(documentId) || null;
      return [{
        frameId: 0,
        documentId,
        result: { active: Boolean(receiptId), receiptId, preimageAvailable: Boolean(receiptId) },
      }];
    }
    if (target?.allFrames && Array.isArray(probeFramesResults)) {
      return probeFramesResults;
    }
    executeScriptCall += 1;
    if (verifyThrows && executeScriptCall === 1) {
      throw new Error('Receiving end does not exist');
    }
    if (salvageThrows) {
      const shouldThrow = profileOk ? executeScriptCall === 2 : executeScriptCall === 1;
      if (shouldThrow) {
        throw new Error('Receiving end does not exist');
      }
    }
    return [{
      frameId: 0,
      documentId: 'test-chrome-document-10',
      result: func(...(args || [])),
    }];
  });
  const verifyQueue = Array.isArray(verifyResponses) ? [...verifyResponses] : null;
  const localStore = { ...storageValues };

  const setScopeRootQueue = Array.isArray(setScopeRootResponses) ? [...setScopeRootResponses] : null;
  const inspectQueue = Array.isArray(inspectResults) ? [...inspectResults] : null;
  const tokenQueue = Array.isArray(tokenResults) ? [...tokenResults] : null;
  const sendMessage = mock.fn((tabId, message, options, callback) => {
    const actualCallback = typeof options === 'function' ? options : callback;
    let response = null;

    if (message.action === ACTIONS.TEST_PING_CONTENT) {
      response = { ok: true };
    } else if (message.action === SMARTSCOPE_ACTIONS.GET_PROFILE) {
      const frameId = typeof options?.frameId === 'number' ? options.frameId : 0;
      const frameProfile = profileByFrameId && typeof profileByFrameId === 'object' ? profileByFrameId[frameId] : null;
      response = {
        profile: {
          scopeSelector: frameProfile?.scopeSelector ?? scopeSelector,
          frameId: typeof frameProfile?.frameId === 'number' ? frameProfile.frameId : 0,
          ok: frameProfile?.ok ?? profileOk,
          detail: frameProfile?.detail ?? profileDetail,
          reason: frameProfile?.reason ?? profileReason,
        },
      };
    } else if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
      response = tokenQueue?.length ? tokenQueue.shift() : tokenResult;
    } else if (message.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT) {
      if (setScopeRootQueue?.length) {
        response = setScopeRootQueue.shift();
      } else {
        response = setScopeRootResult;
      }
    } else if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
      if (cleanupReason === 'not-owner') {
        response = { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'not-owner' };
      } else {
        response = { ok: true, removed: 0, scopeUnmarked: true };
      }
    } else if (message.action === ACTIONS.PAGE_CLARITY_MARK_TARGET_V1) {
      response = {
        ...pageClarityMarkResult,
        frameId: typeof pageClarityMarkResult.frameId === 'number'
          ? pageClarityMarkResult.frameId
          : typeof message.frameId === 'number'
            ? message.frameId
            : 0,
      };
    } else if (message.action === ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1) {
      response = {
        ...pageClarityBaselineResult,
        frameId: typeof pageClarityBaselineResult.frameId === 'number'
          ? pageClarityBaselineResult.frameId
          : typeof message.frameId === 'number'
            ? message.frameId
            : 0,
      };
    } else if (message.action === ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1) {
      response = {
        ...pageClarityProbeResult,
        frameId: typeof pageClarityProbeResult.frameId === 'number'
          ? pageClarityProbeResult.frameId
          : typeof message.frameId === 'number'
            ? message.frameId
            : 0,
      };
    } else if (message.action === ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1) {
      response = { ok: true, removedCount: 1 };
    }

    if (typeof actualCallback === 'function') {
      actualCallback(response);
    }

    return response;
  });

  const tabsGet = mock.fn(async () => ({ url: 'https://example.com/page' }));
  const storageGet = mock.fn(async (key) => {
    if (Array.isArray(key)) {
      const result = {};
      key.forEach((item) => {
        result[item] = localStore[item];
      });
      return result;
    }
    return { [key]: localStore[key] };
  });
  const storageSet = mock.fn(async (entries) => {
    Object.assign(localStore, entries);
  });

  globalThis.chrome = {
    scripting: { insertCSS, removeCSS, executeScript },
    tabs: { sendMessage, get: tabsGet },
    storage: {
      local: { get: storageGet, set: storageSet },
      session: { get: storageGet, set: storageSet },
    },
    runtime: { lastError: null },
  };

  globalThis.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: (selector) => {
      verifyCalls.push({ selector });
      if (verifyQueue?.length) {
        const next = verifyQueue.shift();
        return { ok: next.ok, reason: next.reason, detail: next.detail };
      }
      return { ok: verifyOk, reason: verifyOk ? undefined : verifyReason };
    },
    salvageScopeRootBySelector: (selector, debugEnabled) => {
      salvageCalls.push({ selector, debugEnabled });
      return { ...salvageResponse };
    },
    collectInspectionBaseline: (options) => {
      baselineCalls.push(options);
      return { ...baselineResult };
    },
    inspectPostApply: (options) => {
      inspectCalls.push(options);
      if (inspectThrows) {
        throw new Error('inspect boom');
      }
      if (inspectQueue?.length) {
        return { ...inspectQueue.shift() };
      }
      return { ...inspectResult };
    },
  };
  globalThis.__AURA_DOCUMENT_INSTANCE_ID__ = 'test-document-10';

  return {
    insertCSS,
    removeCSS,
    executeScript,
    sendMessage,
    tabsGet,
    storageGet,
    storageSet,
    localStore,
    verifyCalls,
    salvageCalls,
    inspectCalls,
    baselineCalls,
  };
}

afterEach(() => {
  mock.restoreAll();
  __resetFeatureFlagCacheForTests();
  delete globalThis.chrome;
  delete globalThis.AURA_MODE_ENGINE_SCOPED_V2;
  delete globalThis.__AURA_DOCUMENT_INSTANCE_ID__;
});

test('guard rejection prevents insertCSS when scoped v2 flag is enabled', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS } = setupChromeMock();

  const result = await modeEngineCss.insertModeCssSafely({ tabId: 1, cssText: '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }' });

  assert.equal(result.ok, false);
  assert.equal(insertCSS.mock.callCount(), 0);
});

test('applyScopedModeV2 is idempotent for identical payloads', () => {
  const first = applyScopedModeV2({ tabId: 99, frameId: 0, cssId: 'a', modeId: MODE_IDS.FOCUS, cssText: 'p{}' });
  assert.equal(first.applied, true);

  const second = applyScopedModeV2({ tabId: 99, frameId: 0, cssId: 'a', modeId: MODE_IDS.FOCUS, cssText: 'p{}' });
  assert.equal(second.applied, false);

  const state = getScopedModeV2State(99, 0);
  assert.equal(state?.cssId, 'a');
  removeScopedModeV2({ tabId: 99, frameId: 0 });
});

test('rejects html/body scopes before any CSS insertion', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({ scopeSelector: 'html', verifyOk: false });
  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(2, MODE_IDS.FOCUS, {});

  assert.equal(result.ok, false);
  assert.equal(insertCSS.mock.callCount(), 0);
});

test('site policy blocks apply before scope messaging', async () => {
  __applyFlagOverridesForTests({ siteSuppressV1: true });
  const blockedUntil = Date.now() + 5000;
  const { sendMessage, insertCSS } = setupChromeMock({
    storageValues: {
      [STORAGE_KEYS.SITE_FAILURES_V1]: {
        'example.com': {
          failCount: 3,
          windowStartAt: 0,
          lastFailAt: 0,
          lastFailReason: 'SCOPE_REJECTED',
          blockedUntil,
        },
      },
    },
  });
  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(2, MODE_IDS.FOCUS, {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'SITE_BLOCKED');
  assert.equal(result.detail, SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE);
  assert.equal(sendMessage.mock.callCount(), 0);
  assert.equal(insertCSS.mock.callCount(), 0);
});

test('removal skips tokens not owned by scoped v2', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  setupChromeMock();
  const applied = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, {});
  assert.equal(applied.ok, true);
  assert.ok(getScopedModeV2State(3, 0));
  const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.activeQuality, ACTIVE_QUALITIES.SCOPED_V2_VERIFIED);

  const { sendMessage } = setupChromeMock({ cleanupReason: 'not-owner' });

  const removal = await applier.removeModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, { updateState: true });

  assert.equal(removal.ok, true);
  const details = removal.details || {};
  assert.equal(details.tokensRemoved, false);
  assert.equal(details.scopeUnmarked, false);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS),
    true,
  );
});

test('applyModeScopedV2 preserves user outcome attempt id across rehydrate', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());
  const tabId = 31;

  setupChromeMock();
  const initial = await applier.applyModeScopedV2(tabId, MODE_IDS.COMFORT_VISUAL, {}, 'popup');
  assert.equal(initial.ok, true);
  const initialState = await stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(initialState.scopedV2.outcomeAttemptId, initial.attemptId);

  setupChromeMock();
  const rehydrated = await applier.applyModeScopedV2(tabId, MODE_IDS.COMFORT_VISUAL, {}, 'rehydrate');
  assert.equal(rehydrated.ok, true);
  assert.notEqual(rehydrated.attemptId, initial.attemptId);

  const rehydratedState = await stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(rehydratedState.scopedV2.attemptId, rehydrated.attemptId);
  assert.equal(rehydratedState.scopedV2.outcomeAttemptId, initial.attemptId);
  removeScopedModeV2({ tabId, frameId: 0 });
});

test('applyModeScopedV2 stores template evidence only when final frame matches', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());
  const tabId = 32;
  const matchingEvidence = createTemplateEvidenceV1({
    domainHash: 'tmh1_dddddddddddddddddddddd',
    templateHash: 'tmh1_eeeeeeeeeeeeeeeeeeeeee',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 0,
  });

  setupChromeMock();
  const matched = await applier.applyModeScopedV2(tabId, MODE_IDS.COMFORT_VISUAL, {
    templateEvidence: matchingEvidence,
  }, 'popup');
  assert.equal(matched.ok, true);
  assert.deepEqual(matched.templateEvidence, matchingEvidence);
  const matchedState = await stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
  assert.deepEqual(matchedState.scopedV2.templateEvidence, matchingEvidence);

  const mismatchedEvidence = createTemplateEvidenceV1({
    domainHash: 'tmh1_dddddddddddddddddddddd',
    templateHash: 'tmh1_ffffffffffffffffffffff',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 3,
  });

  setupChromeMock();
  const mismatched = await applier.applyModeScopedV2(tabId, MODE_IDS.COMFORT_VISUAL, {
    templateEvidence: mismatchedEvidence,
  }, 'popup');
  assert.equal(mismatched.ok, true);
  assert.equal(mismatched.templateEvidence, undefined);
  const mismatchedState = await stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(mismatchedState.scopedV2.templateEvidence, undefined);
  removeScopedModeV2({ tabId, frameId: 0 });
});

test('applyModeScopedV2 rolls back inserted CSS when post-apply inspection fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, removeCSS, sendMessage, inspectCalls, baselineCalls } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResult: {
      ok: false,
      inspected: true,
      checks: [{ code: 'SCOPED_CSS_SENTINEL_PRESENT', passed: false }],
      blockingFailures: ['SCOPED_CSS_SENTINEL_PRESENT'],
      warnings: [],
      stats: { nodesScanned: 0, elapsedMs: 1, budgetHit: false },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, { preventFrameFallback: true }, 'auto');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.calls[0].arguments[0].css, insertCSS.mock.calls[0].arguments[0].css);
  assert.deepEqual(removeCSS.mock.calls[0].arguments[0].target, { tabId: 3, frameIds: [0] });
  assert.equal(registry.removed.includes('css-1'), true);
  assert.equal(result.rollback.cssRemoved, true);
  assert.equal(result.rollback.registryRemoved, true);
  assert.equal(result.rollback.tokensRemoved, true);
  assert.equal(baselineCalls.length, 1);
  assert.equal(inspectCalls.length, 1);
  assert.ok(inspectCalls[0].tokenKeys.includes('--aura-font-size'));
  assert.deepEqual(inspectCalls[0].baseline, { horizontalOverflow: 0 });
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS),
    true,
  );
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('applyModeScopedV2 retries emergency reflow guard only for targeted layout failures', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, removeCSS, sendMessage, inspectCalls } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResults: [
      {
        ok: false,
        inspected: true,
        checks: [{ code: 'NO_HORIZONTAL_SCROLL_REGRESSION', passed: false }],
        blockingFailures: ['NO_HORIZONTAL_SCROLL_REGRESSION'],
        warnings: [],
        stats: { nodesScanned: 12, elapsedMs: 2, budgetHit: false },
      },
      {
        ok: true,
        inspected: true,
        checks: [{ code: 'NO_HORIZONTAL_SCROLL_REGRESSION', passed: true }],
        blockingFailures: [],
        warnings: [],
        stats: { nodesScanned: 12, elapsedMs: 2, budgetHit: false },
      },
    ],
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, { preventFrameFallback: true }, 'auto');
  const tokenMessages = sendMessage.mock.calls
    .map((call) => call.arguments[1])
    .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS);

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'SCOPED_V2');
  assert.equal(result.reflowGuardLevel, 'emergency');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 0);
  assert.equal(inspectCalls.length, 2);
  assert.equal(tokenMessages.length, 2);
  assert.equal(tokenMessages[0].tokenMap['--aura-overflow-wrap'], 'break-word');
  assert.equal(tokenMessages[0].tokenMap['--aura-hyphens'], 'manual');
  assert.equal(tokenMessages[1].tokenMap['--aura-overflow-wrap'], 'anywhere');
  assert.equal(tokenMessages[1].tokenMap['--aura-hyphens'], 'auto');

  const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.state, STATES.ACTIVE);
  assert.equal(activeState.scopedV2.reflowGuardLevel, 'emergency');
});

test('applyModeScopedV2 does not retry emergency reflow guard when inspection budget is hit', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, removeCSS, sendMessage, inspectCalls } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResult: {
      ok: false,
      inspected: true,
      checks: [{ code: 'NO_HORIZONTAL_SCROLL_REGRESSION', passed: false }],
      blockingFailures: ['NO_HORIZONTAL_SCROLL_REGRESSION'],
      warnings: [],
      stats: { nodesScanned: 80, elapsedMs: 9, budgetHit: true },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, { preventFrameFallback: true }, 'auto');
  const tokenMessages = sendMessage.mock.calls
    .map((call) => call.arguments[1])
    .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount() >= 1, true);
  assert.equal(
    removeCSS.mock.calls.some((call) => call.arguments[0].css === insertCSS.mock.calls[0].arguments[0].css),
    true,
  );
  assert.equal(inspectCalls.length, 1);
  assert.equal(tokenMessages.length, 1);
  assert.equal(tokenMessages[0].tokenMap['--aura-overflow-wrap'], 'break-word');
});

test('applyModeScopedV2 does not retry emergency reflow guard for PAGE_CLARITY shadow plans', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, sendMessage, inspectCalls } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResult: {
      ok: false,
      inspected: true,
      checks: [{ code: 'NO_HORIZONTAL_SCROLL_REGRESSION', passed: false }],
      blockingFailures: ['NO_HORIZONTAL_SCROLL_REGRESSION'],
      warnings: [],
      stats: { nodesScanned: 12, elapsedMs: 2, budgetHit: false },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());
  const plan = pageClarityRuntimeEffectPlan({
    pageType: PAGE_TYPES.ARTICLE,
    frameId: 0,
    policyDecision: ACTION_POLICY_DECISIONS.ALLOW,
  });

  const result = await applier.applyModeScopedV2(
    3,
    MODE_IDS.COMFORT_VISUAL,
    { runtimeEffectPlan: plan, preventFrameFallback: true },
    'auto',
  );
  const tokenMessages = sendMessage.mock.calls
    .map((call) => call.arguments[1])
    .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(inspectCalls.length, 1);
  assert.equal(tokenMessages.length, 1);
  assert.equal(tokenMessages[0].tokenMap['--aura-overflow-wrap'], 'break-word');
});

test('applyModeScopedV2 downgrades popup apply to limited fallback after clean post-apply rollback', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, removeCSS } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResult: {
      ok: false,
      inspected: true,
      checks: [{ code: 'SCOPED_CSS_SENTINEL_PRESENT', passed: false }],
      blockingFailures: ['SCOPED_CSS_SENTINEL_PRESENT'],
      warnings: [],
      stats: { nodesScanned: 0, elapsedMs: 1, budgetHit: false },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, {}, 'popup');

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 2);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(registry.removed.includes('css-1'), true);
  const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.state, STATES.ACTIVE);
  assert.equal(activeState.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(activeState.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(activeState.smartScope.fallbackReason, 'POST_APPLY_INSPECTION_FAILED');
});

test('applyModeScopedV2 falls back globally when Comfort dark scoped post-check rolls back', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS, removeCSS, sendMessage } = setupChromeMock({
    cleanupReason: 'ok',
    tokenResults: [
      { ok: true, applied: 1, ownedKeys: ['--aura-color-scheme', '--aura-bg-color', '--aura-link-color'] },
      {
        ok: false,
        error: 'DARK_COMFORT_THEME_ROLLED_BACK',
        reason: 'DARK_COMFORT_THEME_POSTCHECK_FAILED',
        detail: 'textContrast,linksDistinct|textContrast=1.18;linkContrast=1.98',
      },
    ],
    storageValues: {
      [STORAGE_KEYS.USER_PREFS]: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, {}, 'popup');

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount() >= 2, true);
  assert.equal(removeCSS.mock.callCount() >= 1, true);
  assert.equal(registry.removed.includes('css-1'), true);

  const tokenMessages = sendMessage.mock.calls
    .map((call) => call.arguments[1])
    .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS);
  assert.equal(tokenMessages.length, 2);
  assert.equal(tokenMessages[0].darkThemeExecutorActive, false);
  assert.equal(tokenMessages[1].darkThemeExecutorActive, true);

  const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.state, STATES.ACTIVE);
  assert.equal(activeState.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(activeState.scopedV2, null);
  assert.equal(activeState.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(activeState.smartScope.fallbackReason, 'TOKEN_APPLY_FAILED');
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), false);
});

test('applyModeScopedV2 retries dark global fallback on the top frame when all-frames CSS injection fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { insertCSS } = setupChromeMock({
    cleanupReason: 'ok',
    tokenResults: [
      { ok: true, applied: 1, ownedKeys: ['--aura-color-scheme', '--aura-bg-color', '--aura-link-color'] },
      {
        ok: false,
        error: 'DARK_COMFORT_THEME_ROLLED_BACK',
        reason: 'DARK_COMFORT_THEME_POSTCHECK_FAILED',
        detail: 'textContrast,linksDistinct|textContrast=1.18;linkContrast=1.98',
      },
    ],
    storageValues: {
      [STORAGE_KEYS.USER_PREFS]: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
    },
    insertCssHandler: async (details) => {
      if (details?.target?.allFrames === true) {
        throw new Error('all frames unavailable');
      }
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, {}, 'popup');

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.calls.some((call) => call.arguments[0]?.target?.allFrames === true), true);
  assert.equal(
    insertCSS.mock.calls.filter((call) => (
      call.arguments[0]?.target?.tabId === 3
      && !call.arguments[0]?.target?.allFrames
      && !call.arguments[0]?.target?.frameIds
    )).length >= 2,
    true,
  );

  const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.state, STATES.ACTIVE);
  assert.equal(activeState.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(activeState.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(activeState.smartScope.fallbackReason, 'TOKEN_APPLY_FAILED');
  assert.equal(activeState.smartScope.darkModeEnabled, true);
  assert.equal(activeState.smartScope.allFrames, false);
  assert.equal(activeState.smartScope.includeTopFrame, false);
});

test('applyModeScopedV2 keeps manual dark fallback active with runtime-only cleanup when fallback CSS injection fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const bodyStyleValues = new Map();
  let fallbackInsertionStarted = false;
  const bodyStyle = {
    setProperty: (key, value) => bodyStyleValues.set(key, String(value)),
    removeProperty: (key) => bodyStyleValues.delete(key),
    getPropertyValue: (key) => bodyStyleValues.get(key) || '',
  };
  const body = { style: bodyStyle };
  const documentElement = {};
  globalThis.document = {
    body,
    documentElement,
    querySelector: () => null,
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false }),
  };
  globalThis.getComputedStyle = (element) => ({
    getPropertyValue: (property) => {
      if (property === 'background-color') return element === body ? 'rgb(255, 255, 255)' : '';
      if (property === 'color') return 'rgb(17, 24, 39)';
      return '';
    },
  });

  try {
    const { insertCSS } = setupChromeMock({
      cleanupReason: 'ok',
      tokenResults: [
        { ok: true, applied: 1, ownedKeys: ['--aura-color-scheme', '--aura-bg-color', '--aura-link-color'] },
        {
          ok: false,
          error: 'DARK_COMFORT_THEME_ROLLED_BACK',
          reason: 'DARK_COMFORT_THEME_POSTCHECK_FAILED',
          detail: 'textContrast,linksDistinct|textContrast=1.18;linkContrast=1.98',
        },
      ],
      storageValues: {
        [STORAGE_KEYS.USER_PREFS]: {
          modePrefs: {
            [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
          },
        },
      },
      insertCssHandler: async (details) => {
        if (details?.target?.allFrames === true) {
          fallbackInsertionStarted = true;
          throw new Error('all-frame fallback insertion unavailable');
        }
        if (fallbackInsertionStarted && !details?.target?.frameIds) {
          throw new Error('author fallback insertion unavailable');
        }
      },
    });
    const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(3, MODE_IDS.COMFORT_VISUAL, {}, 'popup');

    assert.equal(result.ok, true);
    assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
    assert.equal(result.runtimeOnly, true);
    assert.equal(insertCSS.mock.calls.some((call) => call.arguments[0]?.origin === 'AUTHOR'), true);
    assert.equal(bodyStyleValues.get('--aura-color-scheme'), 'dark');

    const activeState = await stateManager.getModeState(3, MODE_IDS.COMFORT_VISUAL);
    assert.equal(activeState.state, STATES.ACTIVE);
    assert.equal(activeState.cssId, null);
    assert.equal(activeState.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
    assert.equal(activeState.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
    assert.equal(activeState.smartScope.runtimeOnly, true);
    assert.equal(activeState.smartScope.fallbackCssFailed, true);
    assert.equal(activeState.smartScope.darkModeEnabled, true);
    assert.equal(activeState.smartScope.globalDarkRuntime.ok, true);
    assert.equal(activeState.smartScope.globalDarkRuntime.activeCount, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.getComputedStyle = previousGetComputedStyle;
  }
});

test('applyModeScopedV2 rolls back when post-apply inspection throws', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  const { removeCSS } = setupChromeMock({ cleanupReason: 'ok', inspectThrows: true });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.FOCUS, {}, 'auto');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(result.inspection.error, 'INTERNAL_ERROR');
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
});

test('applyModeScopedV2 marks ERROR instead of stale ACTIVE when scoped token apply fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const stateManager = createStateManager();
  const { insertCSS } = setupChromeMock({
    tokenResult: { ok: false, reason: 'token-denied' },
  });
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.FOCUS, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TOKEN_APPLY_FAILED');
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('applyModeScopedV2 fails before mutation when inspection baseline cannot be collected', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const stateManager = createStateManager();
  const { insertCSS, sendMessage } = setupChromeMock({
    baselineResult: { ok: false, error: 'NO_SCOPE', detail: 'scope-root-missing' },
  });
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());
  const templateEvidence = createTemplateEvidenceV1({
    domainHash: 'tmh1_dddddddddddddddddddddd',
    templateHash: 'tmh1_eeeeeeeeeeeeeeeeeeeeee',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
  });

  const result = await applier.applyModeScopedV2(3, MODE_IDS.FOCUS, { templateEvidence });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(result.detail, 'scope-root-missing');
  assert.equal(result.templateEvidence, undefined);
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
    false,
  );
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('applyModeScopedV2 rolls back inserted CSS and marks ERROR when registry registration fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const stateManager = createStateManager();
  const registry = createRegistry({ failRegister: true });
  const { insertCSS, removeCSS } = setupChromeMock({ cleanupReason: 'ok' });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(3, MODE_IDS.FOCUS, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REGISTRY_FAILED');
  assert.ok(insertCSS.mock.callCount() >= 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(
    insertCSS.mock.calls.some((call) => call.arguments[0].css === removeCSS.mock.calls[0].arguments[0].css),
    true,
  );
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('updateTokensScopedV2 inspects token changes and removes mode on inspection failure', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const registry = createRegistry();
  const stateManager = createStateManager();
  await stateManager.updateModeState(3, MODE_IDS.FOCUS, STATES.ACTIVE, {
    cssId: 'css-active',
    scopedV2: {
      scopeSelector: 'main',
      owner: 'aura-me2',
      tokenKeys: ['--aura-font-size'],
      cssId: 'css-active',
      cssText: '[data-aura-scope="1"] { --aura-me2-applied: 1; }',
      frameId: 0,
      intensity: 1,
    },
  });
  const { removeCSS } = setupChromeMock({
    cleanupReason: 'ok',
    inspectResult: {
      ok: false,
      inspected: true,
      checks: [{ code: 'NO_CLIPPED_TEXT', passed: false }],
      blockingFailures: ['NO_CLIPPED_TEXT'],
      warnings: [],
      stats: { nodesScanned: 1, elapsedMs: 1, budgetHit: false },
    },
  });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.updateTokensScopedV2(3, MODE_IDS.FOCUS, { '--aura-font-size': '18px' });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'POST_APPLY_INSPECTION_FAILED');
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(stateManager.updates.at(-1).state, STATES.ERROR);
});

test('structural failures trigger site suppression after threshold', async () => {
  mock.timers.enable({ apis: ['Date'] });
  try {
    __applyFlagOverridesForTests({ siteSuppressV1: true });
    const { localStore } = setupChromeMock({
      verifyOk: false,
      verifyReason: 'ROOT_TOO_LARGE',
      salvageResponse: { ok: false, tried: true, reason: 'ROOT_NULL' },
    });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    for (let i = 0; i < 3; i += 1) {
      const result = await applier.applyModeScopedV2(4, MODE_IDS.COMFORT_VISUAL, {});
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'SCOPE_REJECTED');
    }

    const policy = await computeSitePolicy({ url: 'https://example.com', now: Date.now() });
    const failures = localStore[STORAGE_KEYS.SITE_FAILURES_V1];

    assert.equal(policy.allowed, false);
    assert.equal(policy.reason, SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE);
    assert.equal(failures['example.com'].failCount, 3);
  } finally {
    mock.timers.reset();
  }
});

test('salvageScopeRootBySelector ignores undefined debug flag', () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
  };

  try {
    const result = scopedModeV2.salvageScopeRootBySelector('main');
    assert.equal(result.ok, false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('applyModeScopedV2 returns NO_RECEIVER when salvage messaging fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  setupChromeMock({
    scopeSelector: 'main',
    profileOk: false,
    profileDetail: 'TIME_BUDGET_EXCEEDED',
    profileReason: 'TIME_BUDGET_EXCEEDED',
    salvageThrows: true,
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(4, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_RECEIVER');
  assert.equal(result.detail, 'Receiving end does not exist');
});

test('applyModeScopedV2 salvages and re-verifies when scope is too large', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { verifyCalls, salvageCalls } = setupChromeMock({
    scopeSelector: 'main',
    verifyResponses: [{ ok: false, reason: 'ROOT_TOO_LARGE' }, { ok: true }],
    salvageResponse: { ok: true, tried: true, selector: 'main' },
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(6, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(verifyCalls.length, 2);
  assert.equal(salvageCalls.length, 1);
});

test('applyModeScopedV2 salvages when scope root is disconnected', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { verifyCalls, salvageCalls, sendMessage } = setupChromeMock({
    scopeSelector: 'main',
    verifyResponses: [{ ok: false, reason: 'ROOT_NOT_CONNECTED' }, { ok: true }],
    salvageResponse: { ok: true, tried: true, selector: 'article' },
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(6, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(verifyCalls.length, 2);
  assert.equal(salvageCalls.length, 1);
  const scopeRootCalls = sendMessage.mock.calls.filter(
    (call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
  );
  assert.equal(scopeRootCalls.some((call) => call.arguments[1].selector === 'article'), true);
});

test('applyModeScopedV2 returns SCOPE_REJECTED when salvage yields no selector', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  setupChromeMock({
    scopeSelector: 'main',
    verifyResponses: [{ ok: false, reason: 'ROOT_TOO_SMALL' }],
    salvageResponse: { ok: false, tried: true, reason: 'ROOT_TOO_SMALL' },
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(7, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCOPE_REJECTED');
  assert.equal(result.detail.includes('SALVAGE_NO_SELECTOR'), true);
});

test('applyModeScopedV2 does not salvage on non-salvageable reasons', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { salvageCalls } = setupChromeMock({
    scopeSelector: 'main',
    verifyResponses: [{ ok: false, reason: 'ROOT_IS_HTML' }],
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(8, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCOPE_REJECTED');
  assert.equal(salvageCalls.length, 0);
});

test('applyModeScopedV2 returns NO_RECEIVER when verify messaging fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  setupChromeMock({
    scopeSelector: 'main',
    verifyThrows: true,
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(5, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_RECEIVER');
  assert.equal(result.detail, 'Receiving end does not exist');
});

test('applyModeScopedV2 returns SCOPE_ROOT_UNRESOLVED when scope root cannot be marked', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  setupChromeMock({
    scopeSelector: 'main',
    setScopeRootResponses: Array.from({ length: 6 }, () => ({ ok: false, reason: 'ELEMENT_NOT_FOUND' })),
  });

  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());
  const result = await applier.applyModeScopedV2(9, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCOPE_ROOT_UNRESOLVED');
});

test('applyModeScopedV2 falls back to iframe with a valid scope root', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { sendMessage } = setupChromeMock({
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'TIME_BUDGET_EXCEEDED',
        reason: 'TIME_BUDGET_EXCEEDED',
      },
      2: {
        scopeSelector: 'main',
        frameId: 2,
        ok: true,
        detail: '',
        reason: 'v2-selected',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.frameId, 2);
  const getProfileCalls = sendMessage.mock.calls.filter(
    (call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE,
  );
  assert.ok(getProfileCalls.some((call) => call.arguments[2]?.frameId === 2));
  const setScopeCalls = sendMessage.mock.calls.filter(
    (call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
  );
  assert.ok(setScopeCalls.some((call) => call.arguments[2]?.frameId === 2));
});

test('applyModeScopedV2 applies global safe fallback when SmartScope is ambiguous', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage, inspectCalls, baselineCalls } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  const injectedCss = insertCSS.mock.calls[0].arguments[0].css;
  assert.match(injectedCss, /body :where\(p, blockquote, dd, dt\)/);
  assert.match(injectedCss, /line-height:\s*1\.58/);
  assert.doesNotMatch(injectedCss, /!important/);
  assert.doesNotMatch(injectedCss, /data-aura-scope/);
  assert.doesNotMatch(injectedCss, /body :where\(p, li/);
  assert.doesNotMatch(injectedCss, /\bli\b/);
  assert.doesNotMatch(injectedCss, /\bform\b/);
  assert.doesNotMatch(injectedCss, /\binput\b/);
  assert.doesNotMatch(injectedCss, /\btextarea\b/);
  assert.doesNotMatch(injectedCss, /\bselect\b/);
  assert.doesNotMatch(injectedCss, /\bbutton\b/);
  assert.doesNotMatch(injectedCss, /role="grid"/);
  assert.doesNotMatch(injectedCss, /role="table"/);
  assert.doesNotMatch(injectedCss, /overflow-x/);
  assert.doesNotMatch(injectedCss, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(injectedCss, /max-inline-size/);
  assert.doesNotMatch(injectedCss, /\bimg\b/);
  assert.doesNotMatch(injectedCss, /video/);
  assert.doesNotMatch(injectedCss, /\bcanvas\b/);
  assert.doesNotMatch(injectedCss, /\bsvg\b/);
  assert.doesNotMatch(injectedCss, /\bdisplay\s*:/);
  assert.doesNotMatch(injectedCss, /\bposition\s*:/);
  assert.doesNotMatch(injectedCss, /(^|[;{\s])width\s*:/);
  assert.doesNotMatch(injectedCss, /(^|[;{\s])height\s*:/);
  assert.doesNotMatch(injectedCss, /\boverflow(?:-[xy])?\s*:/);
  assert.doesNotMatch(injectedCss, /\btransform\s*:/);
  assert.doesNotMatch(injectedCss, /\bfilter\s*:/);
  assert.doesNotMatch(injectedCss, /\bz-index\s*:/);
  assert.doesNotMatch(injectedCss, /\bpointer-events\s*:/);

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(state.scopedV2, null);
  assert.equal(state.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(state.smartScope.fallbackReason, 'NO_SCOPE');
  assert.equal(state.smartScope.fallbackDetail, 'AMBIGUOUS');
  assert.equal(state.smartScope.outcomeAttemptId, undefined);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
    false,
  );
  assert.equal(baselineCalls.length, 0);
  assert.equal(inspectCalls.length, 0);

  const entry = await registry.get(state.cssId);
  assert.equal(entry.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(entry.scopeKey, 'body');
});

test('applyModeScopedV2 does not use global fallback for Comfort reading runtime plans', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: runtimeEffectPlan({
      modeId: MODE_IDS.COMFORT_VISUAL,
      pageType: PAGE_TYPES.ARTICLE,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SCOPE');
  assert.equal(result.variant, undefined);
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
    false,
  );
  assert.equal(baselineCalls.length, 0);
  assert.equal(inspectCalls.length, 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state?.state, undefined);
});

test('applyModeScopedV2 rolls back global fallback CSS when registration fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, removeCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const registry = createRegistry({ failRegister: true });
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'INSERT_CSS_FAILED');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.calls[0].arguments[0].css, insertCSS.mock.calls[0].arguments[0].css);
  assert.deepEqual(removeCSS.mock.calls[0].arguments[0].target, { tabId: 10, frameIds: [0] });
  assert.equal(removeCSS.mock.calls[0].arguments[0].origin, 'AUTHOR');
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ACTIVE), false);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('applyModeScopedV2 rolls back global fallback CSS when ACTIVE state write fails', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, removeCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager({ failActiveUpdate: true });
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'INSERT_CSS_FAILED');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.calls[0].arguments[0].css, insertCSS.mock.calls[0].arguments[0].css);
  assert.deepEqual(registry.removed, ['css-1']);
  assert.equal(stateManager.updates.some((update) => update.state === STATES.ERROR), true);
});

test('applyModeScopedV2 forces guardrails for global safe fallback even when guardrail flag is disabled', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: false });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  const injectedCss = insertCSS.mock.calls[0].arguments[0].css;
  assert.doesNotMatch(injectedCss, /!important/);
  assert.doesNotMatch(injectedCss, /data-aura-scope/);
  assert.doesNotMatch(injectedCss, /\boverflow(?:-[xy])?\s*:/);
});

test('applyModeScopedV2 does not use global fallback for non-popup auto apply with frame fallback disabled', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'LOW_SCORE,v2-none',
    profileReason: 'LOW_SCORE',
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(
    10,
    MODE_IDS.COMFORT_VISUAL,
    { frameId: 0, preventFrameFallback: true },
    'auto',
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SCOPE');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

[
  ['LOW_SCORE,v2-none', 'LOW_SCORE'],
  ['NO_CANDIDATES_FOUND,v2-none', 'NO_CANDIDATES_FOUND'],
  ['NO_VALID_CANDIDATE,v2-none', 'NO_VALID_CANDIDATE'],
  ['TIME_BUDGET_EXCEEDED', 'TIME_BUDGET_EXCEEDED'],
].forEach(([profileDetail, profileReason]) => {
  test(`applyModeScopedV2 applies global safe fallback for safe no-scope reason ${profileReason}`, async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const { insertCSS } = setupChromeMock({
      scopeSelector: '',
      profileOk: false,
      profileDetail,
      profileReason,
    });
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, true);
    assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
    assert.equal(insertCSS.mock.callCount(), 1);
    const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state.state, STATES.ACTIVE);
    assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
    assert.equal(state.scopedV2, null);
    assert.equal(state.smartScope.fallbackDetail, profileReason);
  });
});

test('applyModeScopedV2 does not use global fallback for unknown no-scope reasons', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'NONE,v2-none',
    profileReason: 'NONE',
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SCOPE');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

test('applyModeScopedV2 applies global safe fallback when generic no-scope reason carries safe detail', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'LOW_SCORE',
    profileReason: 'NONE',
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(state.smartScope.fallbackDetail, 'NONE,LOW_SCORE');
});

[
  'LOW_SCORE,UNEXPECTED_ERROR,v2-none',
  'TIME_BUDGET_EXCEEDED,SMARTSCOPE_FAILED',
  'NO_CANDIDATES_FOUND,INVALID_DOCUMENT',
  'LOW_SCORE,ROOT_TOO_LARGE',
].forEach((profileReason) => {
  test(`applyModeScopedV2 denies global fallback when safe reason is mixed with hard failure ${profileReason}`, async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const { insertCSS } = setupChromeMock({
      scopeSelector: '',
      profileOk: false,
      profileDetail: profileReason,
      profileReason,
    });
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'NO_SCOPE');
    assert.equal(insertCSS.mock.callCount(), 0);
    const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state, null);
  });
});

test('applyModeScopedV2 does not use global fallback after iframe scope rejection', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'AMBIGUOUS,v2-none',
        reason: 'AMBIGUOUS',
      },
      2: {
        scopeSelector: 'main',
        frameId: 2,
        ok: true,
        detail: '',
        reason: 'v2-selected',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
    verifyResponses: [{ ok: false, reason: 'ROOT_IS_HTML' }],
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCOPE_REJECTED');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

test('applyModeScopedV2 does not use global fallback when any frame has an unsafe no-scope reason', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'LOW_SCORE,v2-none',
        reason: 'LOW_SCORE',
      },
      2: {
        scopeSelector: '',
        frameId: 2,
        ok: false,
        detail: 'NONE,v2-none',
        reason: 'NONE',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SCOPE');
  assert.equal(result.detail, 'NONE');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

test('applyModeScopedV2 does not use global fallback after top-frame no-receiver failure', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: 'main',
    verifyThrows: true,
    profileByFrameId: {
      2: {
        scopeSelector: '',
        frameId: 2,
        ok: false,
        detail: 'LOW_SCORE,v2-none',
        reason: 'LOW_SCORE',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SCOPE');
  assert.equal(result.detail, 'LOW_SCORE');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

test('applyModeScopedV2 does not use global fallback after iframe no-receiver failure', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    verifyThrows: true,
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'LOW_SCORE,v2-none',
        reason: 'LOW_SCORE',
      },
      2: {
        scopeSelector: 'main',
        frameId: 2,
        ok: true,
        detail: '',
        reason: 'v2-selected',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_RECEIVER');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state, null);
});

test('applyModeScopedV2 applies global fallback when every scoped attempt has a safe no-scope reason', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'LOW_SCORE,v2-none',
        reason: 'LOW_SCORE',
      },
      2: {
        scopeSelector: '',
        frameId: 2,
        ok: false,
        detail: 'AMBIGUOUS,v2-none',
        reason: 'AMBIGUOUS',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(state.scopedV2, null);
});

test('applyModeScopedV2 applies global fallback when every scoped frame attempt is ambiguous', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS, removeCSS } = setupChromeMock({
    profileByFrameId: {
      0: {
        scopeSelector: '',
        frameId: 0,
        ok: false,
        detail: 'AMBIGUOUS,v2-none',
        reason: 'AMBIGUOUS',
      },
      2: {
        scopeSelector: '',
        frameId: 2,
        ok: false,
        detail: 'TOP_CANDIDATES_AMBIGUOUS,v2-none',
        reason: 'TOP_CANDIDATES_AMBIGUOUS',
      },
    },
    probeFramesResults: [
      {
        frameId: 0,
        result: {
          href: 'https://example.com',
          textLen: 120,
          hasMain: false,
          isTop: true,
          isBlank: false,
        },
      },
      {
        frameId: 2,
        result: {
          href: 'https://example.com/article',
          textLen: 2400,
          hasMain: true,
          isTop: false,
          isBlank: false,
        },
      },
    ],
  });
  const stateManager = createStateManager();
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(result.frameId, 2);
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.deepEqual(insertCSS.mock.calls[0].arguments[0].target, { tabId: 10, frameIds: [2] });

  const activeState = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  const activeCssId = activeState.cssId;
  const removeResult = await applier.removeMode(10, MODE_IDS.COMFORT_VISUAL);

  assert.equal(removeResult.ok, true);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.deepEqual(removeCSS.mock.calls[0].arguments[0].target, { tabId: 10, frameIds: [2] });
  assert.equal(await registry.get(activeCssId), null);
});

test('applyModeScopedV2 applies focus global safe fallback when SmartScope is ambiguous', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.FOCUS, {});

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.match(insertCSS.mock.calls[0].arguments[0].css, /focus-visible/);
  assert.match(insertCSS.mock.calls[0].arguments[0].css, /outline/);
});

test('applyModeScopedV2 applies planned Focus safe downgrade with visible non-interaction CSS', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.FOCUS, {
    runtimeEffectPlan: runtimeEffectPlan({ pageType: PAGE_TYPES.UNKNOWN, frameId: 0 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(result.fallback.detail, 'SAFE_GLOBAL_FOCUS_VISIBLE');
  assert.equal(result.fallback.cssProfileId, FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS);
  assert.deepEqual(result.fallback.diagnostics, {
    modeId: MODE_IDS.FOCUS,
    pageType: PAGE_TYPES.UNKNOWN,
    policyDecision: ACTION_POLICY_DECISIONS.DENY,
    safeDowngrade: 'SAFE_GLOBAL_FOCUS_VISIBLE',
    cssProfileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
    frameIdMatch: true,
  });
  assert.equal(insertCSS.mock.callCount(), 1);
  const injectedCss = insertCSS.mock.calls[0].arguments[0].css;
  assert.doesNotMatch(
    injectedCss,
    /body a\[href\],\s*body \[role="link"\]\s*\{[^}]*text-decoration-line:\s*underline/s,
  );
  assert.match(injectedCss, /accent-color:\s*#0a84ff/);
  assert.match(injectedCss, /border-color:\s*#0a84ff/);
  assert.match(injectedCss, /:focus-visible/);
  assert.match(injectedCss, /outline-style:\s*solid/);
  assert.match(injectedCss, /outline-width:\s*\d+px/);
  assert.doesNotMatch(injectedCss, /\bdisplay\s*:/);
  assert.doesNotMatch(injectedCss, /\bposition\s*:/);
  assert.doesNotMatch(injectedCss, /(^|[;{\s])width\s*:/);
  assert.doesNotMatch(injectedCss, /(^|[;{\s])height\s*:/);
  assert.doesNotMatch(injectedCss, /\bopacity\s*:/);
  assert.doesNotMatch(injectedCss, /\bfilter\s*:/);
  assert.doesNotMatch(injectedCss, /\btransform\s*:/);
  assert.doesNotMatch(injectedCss, /\bpointer-events\s*:/);

  const state = await stateManager.getModeState(10, MODE_IDS.FOCUS);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(state.scopedV2, null);
  assert.equal(state.smartScope.fallbackCssProfileId, FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS);
  assert.equal(state.smartScope.safeDowngrade, 'SAFE_GLOBAL_FOCUS_VISIBLE');
  assert.deepEqual(state.smartScope.fallbackDiagnostics, result.fallback.diagnostics);
});

['ROOT_SELECTOR_NON_UNIQUE', 'ROOT_TOO_LARGE', 'SANITY_CHECK_FAILED'].forEach((failureReason) => {
  test(`applyModeScopedV2 converts recoverable ${failureReason} into planned Focus LIMITED`, async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
    const { insertCSS, sendMessage } = setupChromeMock({
      scopeSelector: '',
      profileOk: false,
      profileDetail: failureReason,
      profileReason: failureReason,
    });
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.FOCUS, {}, 'popup');

    assert.equal(result.ok, true);
    assert.equal(result.variant, GLOBAL_SAFE_FALLBACK_VARIANT);
    assert.equal(result.fallback.reason, APPLY_FAILURE_REASONS.NO_SCOPE);
    assert.equal(result.fallback.detail, failureReason);
    assert.equal(result.fallback.scopeDetail, failureReason);
    assert.equal(insertCSS.mock.callCount(), 1);
    const cleanupMessages = sendMessage.mock.calls
      .map((call) => call.arguments[1])
      .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(cleanupMessages.length, 1);
    assert.equal(cleanupMessages[0].modeId, MODE_IDS.FOCUS);
    assert.deepEqual(insertCSS.mock.calls[0].arguments[0].target, { tabId: 10, frameIds: [0] });
    const state = await stateManager.getModeState(10, MODE_IDS.FOCUS);
    assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
    assert.equal(state.smartScope.safeDowngrade, null);
  });
});

test('applyModeScopedV2 safeDowngradeOnly applies supported Focus fallback without scoped attempt', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock();
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.FOCUS, {
    safeDowngradeOnly: true,
    runtimeEffectPlan: runtimeEffectPlan({ pageType: PAGE_TYPES.UNKNOWN, frameId: 0 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'GLOBAL_SAFE_FALLBACK');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE),
    false,
  );
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
    false,
  );
  assert.equal(baselineCalls.length, 0);
  assert.equal(inspectCalls.length, 0);

  const state = await stateManager.getModeState(10, MODE_IDS.FOCUS);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
});

test('applyModeScopedV2 safeDowngradeOnly applies PAGE_CLARITY LIMITED to validated target', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, removeCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock();
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    safeDowngradeOnly: true,
    runtimeEffectPlan: pageClarityRuntimeEffectPlan({ pageType: PAGE_TYPES.SEARCH, frameId: 0 }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'PAGE_CLARITY_LIMITED');
  assert.equal(result.fallback.from, 'V3_LIGHT_PAGE_CLARITY');
  assert.equal(result.pageClarity.cssProfileId, PAGE_CLARITY_CSS_PROFILE_IDS.SEARCH_RECORD_CARD);
  assert.equal(insertCSS.mock.callCount(), 1);
  const injectedCss = insertCSS.mock.calls[0].arguments[0].css;
  assert.match(injectedCss, /\[data-aura-page-clarity="1"\]/);
  assert.match(injectedCss, /text-decoration-thickness/);
  assert.match(injectedCss, /box-shadow/);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_MARK_TARGET_V1),
    true,
  );
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1),
    true,
  );
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE),
    false,
  );
  assert.equal(baselineCalls.length, 0);
  assert.equal(inspectCalls.length, 0);

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.activeQuality, ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
  assert.equal(state.scopedV2, null);
  assert.equal(state.smartScope.variant, 'PAGE_CLARITY_LIMITED');
  assert.equal(state.smartScope.fallbackFrom, 'V3_LIGHT_PAGE_CLARITY');
  assert.equal(state.smartScope.fallbackCssProfileId, PAGE_CLARITY_CSS_PROFILE_IDS.SEARCH_RECORD_CARD);

  const restore = await applier.removeModeV1(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(restore.ok, true);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1),
    true,
  );
  const restoredState = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(restoredState.state, STATES.INACTIVE);
});

test('applyModeScopedV2 applies PAGE_CLARITY as primary Comfort path for supported runtime plan', async () => {
  for (const pageType of [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM]) {
    __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
    const { insertCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock({
      pageClarityProbeResult: {
        ok: true,
        reason: 'OK',
        frameId: 0,
        markedTargets: 1,
        matchedLinks: pageType === PAGE_TYPES.SEARCH ? 3 : 0,
        matchedLabels: pageType === PAGE_TYPES.FORM ? 2 : 0,
        matchedInputs: pageType === PAGE_TYPES.FORM ? 2 : 0,
        changedElements: 3,
        inspectedElements: 3,
        targetsWithRegionDelta: 0,
        visibleEffectScore: 1,
      },
    });
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
      runtimeEffectPlan: pageClarityRuntimeEffectPlan({
        pageType,
        frameId: 0,
        policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
        primary: true,
      }),
    });

    const expectedProfileId = pageType === PAGE_TYPES.FORM
      ? PAGE_CLARITY_CSS_PROFILE_IDS.FORM_LABEL
      : PAGE_CLARITY_CSS_PROFILE_IDS.SEARCH_RECORD_CARD;

    assert.equal(result.ok, true, pageType);
    assert.equal(result.variant, 'PAGE_CLARITY_MEDIUM', pageType);
    assert.equal(result.fallback.reason, 'PRIMARY_PAGE_CLARITY', pageType);
    assert.equal(result.fallback.from, null, pageType);
    assert.equal(result.pageClarity.cssProfileId, expectedProfileId, pageType);
    assert.equal(result.pageClarity.probe.reason, 'OK', pageType);
    assert.equal(insertCSS.mock.callCount(), 1, pageType);
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_MARK_TARGET_V1),
      true,
      pageType,
    );
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1),
      true,
      pageType,
    );
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1),
      true,
      pageType,
    );
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE),
      false,
      pageType,
    );
    assert.equal(baselineCalls.length, 0, pageType);
    assert.equal(inspectCalls.length, 0, pageType);

    const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state.state, STATES.ACTIVE, pageType);
    assert.equal(state.activeQuality, ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED, pageType);
    assert.equal(state.scopedV2, null, pageType);
    assert.equal(state.smartScope.variant, 'PAGE_CLARITY_MEDIUM', pageType);
    assert.equal(state.smartScope.fallbackFrom, null, pageType);
    assert.equal(state.smartScope.pageClarity.probe.reason, 'OK', pageType);
  }
});

test('applyModeScopedV2 keeps Comfort reading scoped to ARTICLE and DOC runtime plans', async () => {
  for (const pageType of [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC]) {
    __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
    const { insertCSS, sendMessage } = setupChromeMock();
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
      runtimeEffectPlan: runtimeEffectPlan({
        modeId: MODE_IDS.COMFORT_VISUAL,
        pageType,
        frameId: 0,
        policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      }),
    });

    assert.equal(result.ok, true, pageType);
    assert.equal(result.variant, 'SCOPED_V2', pageType);
    assert.equal(insertCSS.mock.callCount(), 1, pageType);
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
      true,
      pageType,
    );

    const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state.state, STATES.ACTIVE, pageType);
    assert.equal(state.activeQuality, ACTIVE_QUALITIES.SCOPED_V2_VERIFIED, pageType);
  }
});

test('applyModeScopedV2 applies dark prelude when Comfort dark tokens are active', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS } = setupChromeMock({
    storageValues: {
      [STORAGE_KEYS.USER_PREFS]: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: runtimeEffectPlan({
      modeId: MODE_IDS.COMFORT_VISUAL,
      pageType: PAGE_TYPES.ARTICLE,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.variant, 'SCOPED_V2');
  assert.equal(result.preludeApplied, true);
  assert.equal(insertCSS.mock.callCount(), 3);
  assert.match(insertCSS.mock.calls[1].arguments[0].css, /html\s*\{/);
  assert.match(insertCSS.mock.calls[1].arguments[0].css, /body\s*\{/);
  assert.deepEqual(insertCSS.mock.calls[1].arguments[0].target, { tabId: 10 });
  assert.match(insertCSS.mock.calls[2].arguments[0].css, /html\s*\{/);
  assert.deepEqual(insertCSS.mock.calls[2].arguments[0].target, { tabId: 10, allFrames: true });

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.scopedV2.preludeCssId, 'css-2');
  assert.equal(state.scopedV2.preludeError, undefined);
});

test('applyModeScopedV2 reuses already-dark visual snapshot for Comfort dark palette and prelude', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage } = setupChromeMock({
    baselineResult: {
      ok: true,
      baseline: {
        horizontalOverflow: 0,
        visualSnapshot: {
          backgroundColor: 'rgb(9, 12, 20)',
          surfaceColor: 'rgb(15, 23, 42)',
          textColor: 'rgb(226, 232, 240)',
          linkColor: 'rgb(147, 197, 253)',
          mutedTextColor: 'rgb(148, 163, 184)',
          prefersColorScheme: 'dark',
        },
      },
      stats: { elapsedMs: 1, budgetHit: false },
    },
    storageValues: {
      [STORAGE_KEYS.USER_PREFS]: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: runtimeEffectPlan({
      modeId: MODE_IDS.COMFORT_VISUAL,
      pageType: PAGE_TYPES.ARTICLE,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    }),
  });

  assert.equal(result.ok, true);
  const tokenMessages = sendMessage.mock.calls
    .map((call) => call.arguments[1])
    .filter((message) => message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS && message.tokenMap);
  assert.equal(tokenMessages.some((message) => message.tokenMap['--aura-bg-color'] === '#10141f'), true);
  assert.match(insertCSS.mock.calls[1].arguments[0].css, /background-color:\s*#10141f\s*!important/);

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.scopedV2.darkModeEnabled, true);
  assert.equal(state.scopedV2.darkPaletteAlreadyDark, true);
  assert.equal(state.scopedV2.darkPalettePrefersColorScheme, 'dark');
});

test('applyModeScopedV2 rejects Comfort reading runtime plans outside ARTICLE/DOC before scoped apply', async () => {
  for (const pageType of [PAGE_TYPES.SHOP, PAGE_TYPES.FEED]) {
    __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
    const { insertCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock();
    const stateManager = createStateManager();
    const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
      runtimeEffectPlan: runtimeEffectPlan({
        modeId: MODE_IDS.COMFORT_VISUAL,
        pageType,
        frameId: 0,
        policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      }),
    });

    assert.equal(result.ok, false, pageType);
    assert.equal(result.reason, 'COMFORT_READING_RUNTIME_NOT_ALLOWED', pageType);
    assert.equal(result.detail, `${ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY}:${pageType}`);
    assert.equal(insertCSS.mock.callCount(), 0, pageType);
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE),
      false,
      pageType,
    );
    assert.equal(
      sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
      false,
      pageType,
    );
    assert.equal(baselineCalls.length, 0, pageType);
    assert.equal(inspectCalls.length, 0, pageType);

    const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state.state, STATES.ERROR, pageType);
    assert.equal(state.scopedV2, null, pageType);
  }
});

test('applyModeScopedV2 rejects invalid Comfort runtime plans before scoped apply', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage, baselineCalls, inspectCalls } = setupChromeMock();
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: {
      modeId: MODE_IDS.COMFORT_VISUAL,
      frameId: 0,
      pageType: PAGE_TYPES.ARTICLE,
      safeDowngrade: 'SAFE_READING_TEXT_LINK_CLARITY',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN);
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.GET_PROFILE),
    false,
  );
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS),
    false,
  );
  assert.equal(baselineCalls.length, 0);
  assert.equal(inspectCalls.length, 0);

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ERROR);
  assert.equal(state.scopedV2, null);
});

test('applyModeScopedV2 rejects PAGE_CLARITY mark responses with mismatched frame before CSS insertion', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage } = setupChromeMock({
    pageClarityMarkResult: {
      schemaVersion: 1,
      ok: true,
      reason: 'OK',
      sameEpoch: true,
      stillConnected: true,
      stillVisible: true,
      roleHintStillMatches: true,
      confidence: 1,
      frameId: 3,
      marked: true,
      markedCount: 1,
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: pageClarityRuntimeEffectPlan({
      pageType: PAGE_TYPES.SEARCH,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      primary: true,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PAGE_CLARITY_TARGET_INVALID');
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1),
    false,
  );
});

test('applyModeScopedV2 rejects PAGE_CLARITY baseline responses with mismatched frame before CSS insertion', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, sendMessage } = setupChromeMock({
    pageClarityBaselineResult: {
      ok: true,
      reason: 'OK',
      frameId: 4,
      markedTargets: 1,
      baselineElements: 3,
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: pageClarityRuntimeEffectPlan({
      pageType: PAGE_TYPES.FORM,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      primary: true,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PAGE_CLARITY_BASELINE_FAILED');
  assert.equal(insertCSS.mock.callCount(), 0);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1),
    true,
  );
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1),
    false,
  );
});

test('applyModeScopedV2 rolls back PAGE_CLARITY when probe claims OK with weak visible effect', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, removeCSS, sendMessage } = setupChromeMock({
    pageClarityProbeResult: {
      ok: true,
      reason: 'OK',
      frameId: 0,
      markedTargets: 1,
      matchedLinks: 3,
      matchedLabels: 0,
      matchedInputs: 0,
      changedElements: 1,
      inspectedElements: 3,
      targetsWithRegionDelta: 0,
      visibleEffectScore: 0.33,
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: pageClarityRuntimeEffectPlan({
      pageType: PAGE_TYPES.SEARCH,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      primary: true,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PAGE_CLARITY_EFFECT_NOT_VISIBLE');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1),
    true,
  );

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ERROR);
  assert.equal(state.pendingDecision, false);
});

test('applyModeScopedV2 rolls back PAGE_CLARITY when probe reports weak effect', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS, removeCSS, sendMessage } = setupChromeMock({
    pageClarityProbeResult: {
      ok: true,
      reason: 'WEAK_EFFECT',
      frameId: 0,
      markedTargets: 1,
      matchedLinks: 3,
      matchedLabels: 0,
      matchedInputs: 0,
      changedElements: 1,
      inspectedElements: 3,
      targetsWithRegionDelta: 0,
      visibleEffectScore: 0.33,
    },
  });
  const stateManager = createStateManager();
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    runtimeEffectPlan: pageClarityRuntimeEffectPlan({
      pageType: PAGE_TYPES.SEARCH,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
      primary: true,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WEAK_EFFECT');
  assert.equal(insertCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(
    sendMessage.mock.calls.some((call) => call.arguments[1].action === ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1),
    true,
  );

  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ERROR);
  assert.equal(state.pendingDecision, false);
});

test('applyModeScopedV2 safeDowngradeOnly rejects unsupported downgrade before cleanup', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS } = setupChromeMock();
  const stateManager = createStateManager();
  await stateManager.updateModeState(10, MODE_IDS.COMFORT_VISUAL, STATES.ACTIVE, {
    cssId: 'existing-css',
    activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
    smartScope: { variant: 'GLOBAL_SAFE_FALLBACK' },
    scopedV2: null,
  });
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {
    safeDowngradeOnly: true,
    runtimeEffectPlan: runtimeEffectPlan({
      modeId: MODE_IDS.COMFORT_VISUAL,
      pageType: PAGE_TYPES.VIDEO,
      frameId: 0,
      policyDecision: ACTION_POLICY_DECISIONS.DENY,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'UNSUPPORTED_DOWNGRADE');
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.cssId, 'existing-css');
});

test('applyModeScopedV2 safeDowngradeOnly rejects invalid runtime plan before cleanup', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true, modeEngineCssGuardrails: true });
  const { insertCSS } = setupChromeMock();
  const stateManager = createStateManager();
  await stateManager.updateModeState(10, MODE_IDS.FOCUS, STATES.ACTIVE, {
    cssId: 'existing-focus-css',
    activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
    smartScope: { variant: 'GLOBAL_SAFE_FALLBACK' },
    scopedV2: null,
  });
  const applier = new CssApplier(createRegistry(), stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.FOCUS, {
    safeDowngradeOnly: true,
    runtimeEffectPlan: {
      modeId: MODE_IDS.FOCUS,
      frameId: 0,
      pageType: PAGE_TYPES.UNKNOWN,
      safeDowngrade: 'SAFE_GLOBAL_FOCUS_VISIBLE',
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN);
  assert.equal(insertCSS.mock.callCount(), 0);
  const state = await stateManager.getModeState(10, MODE_IDS.FOCUS);
  assert.equal(state.state, STATES.ACTIVE);
  assert.equal(state.cssId, 'existing-focus-css');
});

test('removeMode removes global safe fallback after previous scoped state is cleared', async () => {
  __applyFlagOverridesForTests({ scopedModeCssV2: true });
  const { insertCSS, removeCSS, sendMessage } = setupChromeMock({
    scopeSelector: '',
    profileOk: false,
    profileDetail: 'AMBIGUOUS,v2-none',
    profileReason: 'AMBIGUOUS',
  });
  const stateManager = createStateManager();
  await stateManager.updateModeState(10, MODE_IDS.COMFORT_VISUAL, STATES.ACTIVE, {
    cssId: 'old-css',
    scopedV2: {
      scopeSelector: 'main',
      cssId: 'old-css',
      frameId: 0,
      tokenKeys: ['--aura-font-size'],
    },
  });
  const registry = createRegistry();
  const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

  const result = await applier.applyModeScopedV2(10, MODE_IDS.COMFORT_VISUAL, {});
  assert.equal(result.ok, true);

  const activeState = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(activeState.scopedV2, null);
  assert.equal(activeState.smartScope.variant, 'GLOBAL_SAFE_FALLBACK');
  const activeCssId = activeState.cssId;
  assert.equal(await registry.get(activeCssId) != null, true);
  const cleanupCallsBeforeRestore = sendMessage.mock.calls.filter(
    (call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
  ).length;
  const removeTokenCallsBeforeRestore = sendMessage.mock.calls.filter(
    (call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.REMOVE_TOKEN,
  ).length;

  const removeResult = await applier.removeMode(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(removeResult.ok, true);
  assert.equal(removeCSS.mock.callCount(), 1);
  assert.equal(removeCSS.mock.calls[0].arguments[0].css, insertCSS.mock.calls[0].arguments[0].css);
  assert.deepEqual(removeCSS.mock.calls[0].arguments[0].target, { tabId: 10, frameIds: [0] });
  assert.equal(removeCSS.mock.calls[0].arguments[0].origin, 'AUTHOR');
  assert.equal(await registry.get(activeCssId), null);
  assert.equal(registry.removed.includes(activeCssId), true);
  assert.equal(
    sendMessage.mock.calls.filter((call) => call.arguments[1].action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS)
      .length,
    cleanupCallsBeforeRestore,
  );
  assert.equal(
    sendMessage.mock.calls.filter((call) => call.arguments[1].action === SMARTSCOPE_ACTIONS.REMOVE_TOKEN).length,
    removeTokenCallsBeforeRestore,
  );

  const inactiveState = await stateManager.getModeState(10, MODE_IDS.COMFORT_VISUAL);
  assert.equal(inactiveState.state, STATES.INACTIVE);
  assert.equal(inactiveState.cssId, null);
  assert.equal(inactiveState.smartScope, null);
});
