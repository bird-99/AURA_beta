import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { buildScopedModeCssV2, computeTokensV2 } from '../shared/mode-engine-scoped-v2.js';
import { ACTIONS, MODE_IDS, SMARTSCOPE_ACTIONS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';
import { CssApplier } from '../background/css-applier.js';
import {
  ACTION_POLICY_DECISIONS,
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  getGuaranteedEffectV1,
} from '../shared/engine-core/index.js';

function createRegistry() {
  const store = new Map();
  return {
    entries: store,
    async register(cssText, origin, meta = {}) {
      const cssId = `css-${store.size + 1}`;
      const entry = { cssId, cssText, origin, ...meta };
      store.set(cssId, entry);
      return entry;
    },
    async get(cssId) {
      return store.get(cssId) || null;
    },
    async remove(cssId) {
      store.delete(cssId);
    },
  };
}

function createStateManager() {
  const states = new Map();
  return {
    async updateModeState(tabId, modeId, state, extras = {}) {
      states.set(`${tabId}:${modeId}`, { state, ...extras });
    },
    async setSmartScopeStatus() {},
    async getModeState(tabId, modeId) {
      return states.get(`${tabId}:${modeId}`) || { state: STATES.INACTIVE };
    },
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

function searchPageClarityRuntimeEffectPlan() {
  const row = getGuaranteedEffectV1(MODE_IDS.COMFORT_VISUAL, PAGE_TYPES.SEARCH);
  return {
    version: 1,
    matrixVersion: row.version,
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
    frameId: 0,
    strongEffect: row.strongEffect,
    safeDowngrade: row.safeDowngrade,
    readerAllowed: row.readerAllowed,
    overrideAllowed: row.overrideAllowed,
    overrideScope: row.overrideScope,
    postChecks: row.postChecks,
    policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    confidence: 0.72,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
      desiredEffect: 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW',
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
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
  actionLog,
  setScopeRootResponse = { ok: true },
  applyScopeTokensResponse = { ok: true, applied: 1 },
  userPrefs = {},
  onApplyTokens,
  insertCssCalls,
  removeCssCalls,
}) {
  globalThis.chrome = {
    scripting: {
      insertCSS: async (payload) => {
        if (Array.isArray(insertCssCalls)) {
          insertCssCalls.push(payload);
        }
      },
      removeCSS: async (payload) => {
        if (Array.isArray(removeCssCalls)) {
          removeCssCalls.push(payload);
        }
      },
      executeScript: async ({ func, args }) => [{ result: func(...(args || [])) }],
    },
    tabs: {
      sendMessage: (_tabId, message, options, callback) => {
        const actualCallback = typeof options === 'function' ? options : callback;
        actionLog.push(message.action);
        let response = null;
        if (message.action === ACTIONS.TEST_PING_CONTENT) {
          response = { ok: true };
        } else if (message.action === SMARTSCOPE_ACTIONS.GET_PROFILE) {
          response = {
            profile: {
              scopeSelector: 'main',
              pageType: PAGE_TYPES.SEARCH,
              frameId: 0,
              ok: true,
              detail: '',
              reason: 'v2-selected',
            },
          };
        } else if (message.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT) {
          response = setScopeRootResponse;
        } else if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
          if (typeof onApplyTokens === 'function') {
            onApplyTokens(message.tokenMap, message);
          }
          response = applyScopeTokensResponse;
        } else if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
          response = { ok: true, removed: 0, scopeUnmarked: true };
        }

        if (typeof actualCallback === 'function') {
          actualCallback(response);
        }

        return response;
      },
      get: async () => ({ url: 'https://example.com/page' }),
    },
    storage: {
      local: {
        get: async (key) => {
          if (key === STORAGE_KEYS.USER_PREFS) {
            return { [STORAGE_KEYS.USER_PREFS]: userPrefs };
          }
          return {};
        },
        set: async () => {},
      },
    },
    runtime: { lastError: null },
  };

  globalThis.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: () => ({ ok: true }),
    salvageScopeRootBySelector: () => ({ ok: true, tried: true, selector: 'main' }),
    collectInspectionBaseline: () => ({
      ok: true,
      baseline: { horizontalOverflow: 0 },
      stats: { elapsedMs: 1, budgetHit: false },
    }),
    inspectPostApply: () => ({
      ok: true,
      inspected: true,
      checks: [{ code: 'SCOPED_CSS_SENTINEL_PRESENT', passed: true }],
      blockingFailures: [],
      warnings: [],
      stats: { nodesScanned: 0, elapsedMs: 1, budgetHit: false },
    }),
  };
}

afterEach(() => {
  __resetFeatureFlagCacheForTests();
  delete globalThis.chrome;
  delete globalThis.AURA_MODE_ENGINE_SCOPED_V2;
});

describe('scoped-v2 comfort css', () => {
  it('contains token-driven link rules', () => {
    const css = buildScopedModeCssV2({
      modeId: MODE_IDS.COMFORT_VISUAL,
      intensity: 0.6,
    });

    assert.ok(css.includes('text-decoration-thickness: var(--aura-link-decoration-thickness'));
    assert.ok(css.includes('text-underline-offset: var(--aura-link-decoration-offset'));
    assert.ok(css.includes(':is(a, [role="link"]) { color: var(--aura-link-color)'));
    assert.ok(css.includes(':is(a):visited { color: var(--aura-link-visited-color)'));
    assert.ok(css.includes(':is(a, [role="link"]):hover { color: var(--aura-link-hover-color)'));
    assert.ok(!css.includes('a { color: var(--aura-text-color'));
  });

  it('contains token-driven reflow rules', () => {
    const css = buildScopedModeCssV2({
      modeId: MODE_IDS.COMFORT_VISUAL,
      intensity: 0.6,
    });

    assert.ok(css.includes('max-inline-size: var(--aura-measure-max-inline-size'));
    assert.ok(css.includes('overflow-wrap: var(--aura-overflow-wrap'));
    assert.match(css, /:where\(p, blockquote, dd, dt\)\s*\{[^}]*overflow-wrap: var\(--aura-overflow-wrap/);
    assert.match(css, /:where\(pre, code, kbd, samp\)\s*\{[^}]*overflow-wrap: normal/);
    assert.doesNotMatch(css, /:is\(p, li, blockquote, pre, code, dd, dt\)\s*\{[^}]*overflow-wrap/);
    assert.ok(css.includes('color-scheme: var(--aura-color-scheme'));
    assert.ok(css.includes('-webkit-font-smoothing: var(--aura-font-smoothing'));
  });

  it('accepts overrides in computeTokensV2', () => {
    const { tokens } = computeTokensV2({
      modeId: MODE_IDS.COMFORT_VISUAL,
      intensity: 0.6,
      overrides: {
        '--aura-link-decoration': 'underline',
      },
    });

    assert.equal(tokens['--aura-link-decoration'], 'underline');
  });

  it('marks the scope root before applying scoped-v2 tokens', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    setupChromeMock({ actionLog });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, true);
    const setIndex = actionLog.indexOf(ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT);
    const applyIndex = actionLog.indexOf(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS);
    assert.ok(setIndex > -1);
    assert.ok(applyIndex > -1);
    assert.ok(setIndex < applyIndex);
  });

  it('injects comfort dark tokens when dark theme is requested', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-bg-color'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-text-color'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-color-scheme'), true);
  });

  it('turns dark theme on with a full reapply when Comfort is already active', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { darkMode: false },
      },
    };
    const registry = createRegistry();
    const stateManager = createStateManager();
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    assert.equal(initial.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-color-scheme'), false);

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { darkMode: true };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, undefined);
    assert.equal(refreshed.preludeApplied, true);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), true);
    assert.equal(insertCssCalls.length, 3);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(appliedTokenMaps.some((tokenMap) => tokenMap['--aura-color-scheme'] === 'dark'), true);
    assert.match(insertCssCalls.at(-1).css, /html\s*\{/);
    assert.deepEqual(insertCssCalls.at(-2).target, { tabId: 1 });
    assert.deepEqual(insertCssCalls.at(-1).target, { tabId: 1, allFrames: true });

    const state = await stateManager.getModeState(1, MODE_IDS.COMFORT_VISUAL);
    assert.equal(Boolean(state.scopedV2?.preludeCssId), true);
  });

  it('turns dark theme off with full cleanup when Comfort is already active', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
      },
    };
    const registry = createRegistry();
    const stateManager = createStateManager();
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const applier = new CssApplier(registry, stateManager, createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    const initialState = await stateManager.getModeState(1, MODE_IDS.COMFORT_VISUAL);
    const initialPreludeCssId = initialState.scopedV2?.preludeCssId;
    assert.equal(initial.ok, true);
    assert.equal(initial.preludeApplied, true);
    assert.equal(Boolean(initialPreludeCssId), true);
    assert.equal(appliedTokenMaps.at(-1)['--aura-color-scheme'], 'dark');

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { darkMode: false };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, undefined);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), true);
    assert.equal(removeCssCalls.length, 2);
    assert.equal(insertCssCalls.length, 1);
    assert.match(removeCssCalls[0].css, /html\s*\{/);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-color-scheme'), false);
    assert.equal(registry.entries.has(initialPreludeCssId), false);

    const state = await stateManager.getModeState(1, MODE_IDS.COMFORT_VISUAL);
    assert.equal(state.scopedV2?.preludeCssId || null, null);
  });

  it('keeps dark theme primary when a Search PAGE_CLARITY plan is present', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    let applyTokenMessage = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
        },
      },
      onApplyTokens: (tokenMap, message) => {
        appliedTokens = tokenMap;
        applyTokenMessage = message;
      },
    });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {
      runtimeEffectPlan: searchPageClarityRuntimeEffectPlan(),
    });

    assert.equal(result.ok, true);
    assert.notEqual(result.variant, 'PAGE_CLARITY_MEDIUM');
    assert.ok(appliedTokens);
    assert.equal(appliedTokens['--aura-color-scheme'], 'dark');
    assert.equal(applyTokenMessage?.darkThemeExecutorActive, true);
    assert.equal(actionLog.includes(ACTIONS.PAGE_CLARITY_MARK_TARGET_V1), false);
    assert.equal(actionLog.includes(ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1), false);
    assert.equal(actionLog.includes(ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1), false);
  });

  it('omits comfort font scale tokens and css when text scale is disabled', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { textScale: false },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const registry = createRegistry();
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    const registeredCss = Array.from(registry.entries.values()).at(-1)?.cssText || '';

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-font-size'), false);
    assert.match(appliedTokens['--aura-line-height'], /^\d+\.\d+$/);
    assert.doesNotMatch(registeredCss, /font-size:\s*var\(--aura-font-size/);
    assert.ok(actionLog.includes(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS));
  });

  it('neutralizes comfort spacing tokens when spacing pack is disabled', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { spacingPack: false },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const registry = createRegistry();
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    const registeredCss = Array.from(registry.entries.values()).at(-1)?.cssText || '';

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-line-height'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-paragraph-spacing'), false);
    assert.notEqual(appliedTokens['--aura-font-size'], '1em');
    assert.doesNotMatch(registeredCss, /line-height: var\(--aura-line-height/);
    assert.doesNotMatch(registeredCss, /p \+ p \{ margin-top: var\(--aura-paragraph-spacing/);
    assert.ok(actionLog.includes(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS));
  });

  it('omits comfort link enhancement tokens when link enhancement is disabled', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { linkEnhance: false },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const registry = createRegistry();
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    const registeredCss = Array.from(registry.entries.values()).at(-1)?.cssText || '';

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-link-decoration'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-link-decoration-thickness'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-link-decoration-offset'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-link-underline-position'), false);
    assert.doesNotMatch(registeredCss, /--aura-link-decoration/);
    assert.doesNotMatch(registeredCss, /text-decoration-line:\s*var\(--aura-link-decoration/);
    assert.doesNotMatch(registeredCss, /text-decoration-thickness:\s*var\(--aura-link-decoration-thickness/);
    assert.ok(actionLog.includes(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS));
  });

  it('omits comfort text rendering refinement tokens and css when disabled', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { typoSmoothing: false },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const registry = createRegistry();
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    const registeredCss = Array.from(registry.entries.values()).at(-1)?.cssText || '';

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-font-smoothing'), false);
    assert.doesNotMatch(registeredCss, /-webkit-font-smoothing/);
    assert.doesNotMatch(registeredCss, /letter-spacing: var\(--aura-letter-spacing/);
    assert.doesNotMatch(registeredCss, /word-spacing:\s*0\.02em/);
    assert.doesNotMatch(registeredCss, /text-rendering:\s*optimizeLegibility/);
    assert.doesNotMatch(registeredCss, /font-kerning:\s*normal/);
    assert.ok(actionLog.includes(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS));
  });

  it('refreshes comfort text scale prefs in place and removes stale css', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { textScale: true, spacingPack: true },
      },
    };
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const registry = createRegistry();
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    assert.equal(initial.ok, true);
    const initialCssId = initial.cssId;

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { textScale: false, spacingPack: true };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, true);
    assert.notEqual(refreshed.cssId, initialCssId);
    assert.equal(insertCssCalls.length, 1);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-font-size'), false);
    assert.doesNotMatch(registry.entries.get(refreshed.cssId)?.cssText || '', /font-size:\s*var\(--aura-font-size/);
  });

  it('refreshes comfort spacing pack prefs in place before removing stale css', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { textScale: true, spacingPack: true },
      },
    };
    const registry = createRegistry();
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    assert.equal(initial.ok, true);
    const initialCssId = initial.cssId;

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { textScale: true, spacingPack: false };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );
    const refreshedCss = registry.entries.get(refreshed.cssId)?.cssText || '';

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, true);
    assert.notEqual(refreshed.cssId, initialCssId);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), false);
    assert.equal(insertCssCalls.length, 1);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-line-height'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-paragraph-spacing'), false);
    assert.doesNotMatch(refreshedCss, /line-height: var\(--aura-line-height/);
    assert.doesNotMatch(refreshedCss, /p \+ p \{ margin-top: var\(--aura-paragraph-spacing/);
  });

  it('refreshes comfort link enhancement prefs in place while removing stale link css rules', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { linkEnhance: true, spacingPack: true },
      },
    };
    const registry = createRegistry();
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    assert.equal(initial.ok, true);
    const initialCssId = initial.cssId;
    assert.equal(appliedTokenMaps.at(-1)['--aura-link-decoration'], 'underline');

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { linkEnhance: false, spacingPack: true };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, true);
    assert.notEqual(refreshed.cssId, initialCssId);
    assert.equal(insertCssCalls.length, 1);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-link-decoration'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-link-decoration-thickness'), false);
    const refreshedCss = registry.entries.get(refreshed.cssId)?.cssText || '';
    assert.doesNotMatch(refreshedCss, /--aura-link-decoration/);
    assert.doesNotMatch(refreshedCss, /text-decoration-line:\s*var\(--aura-link-decoration/);
    assert.doesNotMatch(refreshedCss, /text-decoration-thickness:\s*var\(--aura-link-decoration-thickness/);
  });

  it('refreshes comfort text rendering refinement prefs in place while removing stale css rules', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    const insertCssCalls = [];
    const removeCssCalls = [];
    const appliedTokenMaps = [];
    const userPrefs = {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { typoSmoothing: true, spacingPack: true },
      },
    };
    const registry = createRegistry();
    setupChromeMock({
      actionLog,
      userPrefs,
      insertCssCalls,
      removeCssCalls,
      onApplyTokens: (tokenMap) => {
        appliedTokenMaps.push({ ...tokenMap });
      },
    });
    const applier = new CssApplier(registry, createStateManager(), createPerformanceMonitor());

    const initial = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});
    assert.equal(initial.ok, true);
    const initialCssId = initial.cssId;
    assert.equal(appliedTokenMaps.at(-1)['--aura-font-smoothing'], 'antialiased');

    actionLog.length = 0;
    insertCssCalls.length = 0;
    removeCssCalls.length = 0;
    userPrefs.modePrefs[MODE_IDS.COMFORT_VISUAL] = { typoSmoothing: false, spacingPack: true };

    const refreshed = await applier.applyModeScopedV2(
      1,
      MODE_IDS.COMFORT_VISUAL,
      { forceReapply: true, reapplyReason: 'prefs:comfortVisual' },
      'rehydrate',
    );

    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.inPlace, true);
    assert.notEqual(refreshed.cssId, initialCssId);
    assert.equal(insertCssCalls.length, 1);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokenMaps.at(-1), '--aura-font-smoothing'), false);
    const refreshedCss = registry.entries.get(refreshed.cssId)?.cssText || '';
    assert.doesNotMatch(refreshedCss, /-webkit-font-smoothing/);
    assert.doesNotMatch(refreshedCss, /letter-spacing: var\(--aura-letter-spacing/);
    assert.doesNotMatch(refreshedCss, /word-spacing:\s*0\.02em/);
    assert.doesNotMatch(refreshedCss, /text-rendering:\s*optimizeLegibility/);
    assert.doesNotMatch(refreshedCss, /font-kerning:\s*normal/);
  });

  it('omits comfort dark tokens when dark mode is disabled', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    let appliedTokens = null;
    setupChromeMock({
      actionLog,
      userPrefs: {
        modePrefs: {
          [MODE_IDS.COMFORT_VISUAL]: { darkMode: false },
        },
      },
      onApplyTokens: (tokenMap) => {
        appliedTokens = tokenMap;
      },
    });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, true);
    assert.ok(appliedTokens);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-bg-color'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(appliedTokens, '--aura-text-color'), false);
  });

  it('returns SCOPE_ROOT_UNRESOLVED when scope root marking fails', async () => {
    __applyFlagOverridesForTests({ scopedModeCssV2: true });
    const actionLog = [];
    setupChromeMock({ actionLog, setScopeRootResponse: { ok: false, reason: 'ELEMENT_NOT_FOUND' } });
    const applier = new CssApplier(createRegistry(), createStateManager(), createPerformanceMonitor());

    const result = await applier.applyModeScopedV2(1, MODE_IDS.COMFORT_VISUAL, {});

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'SCOPE_ROOT_UNRESOLVED');
    assert.ok(actionLog.includes(ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT));
    assert.equal(actionLog.includes(ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS), false);
  });
});
