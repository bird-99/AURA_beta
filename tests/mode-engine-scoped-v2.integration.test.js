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
import { ACTIONS, MODE_IDS, SITE_BLOCK_REASONS, SMARTSCOPE_ACTIONS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';

function createRegistry() {
  const store = new Map();
  return {
    async register(cssText, origin, meta = {}) {
      const cssId = `css-${store.size + 1}`;
      const entry = { cssId, cssText, origin, ...meta };
      store.set(cssId, entry);
      return entry;
    },
    async get(id) {
      return store.get(id) || null;
    },
    async remove(id) {
      store.delete(id);
    },
  };
}

function createStateManager() {
  const states = new Map();
  const smartStatuses = [];

  return {
    async getModeState(tabId, modeId) {
      return states.get(`${tabId}:${modeId}`) || null;
    },
    async updateModeState(tabId, modeId, state, extras = {}) {
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

function setupChromeMock({
  scopeSelector = 'article',
  tokenResult = { ok: true, applied: 1 },
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
  storageValues = {},
} = {}) {
  const insertCSS = mock.fn(async () => {});
  const removeCSS = mock.fn(async () => {});
  const verifyCalls = [];
  const salvageCalls = [];
  let executeScriptCall = 0;
  const executeScript = mock.fn(async ({ func, args, target, files }) => {
    if (files) {
      return [];
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
    return [{ result: func(...(args || [])) }];
  });
  const verifyQueue = Array.isArray(verifyResponses) ? [...verifyResponses] : null;
  const localStore = { ...storageValues };

  const setScopeRootQueue = Array.isArray(setScopeRootResponses) ? [...setScopeRootResponses] : null;
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
      response = tokenResult;
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
    storage: { local: { get: storageGet, set: storageSet } },
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
  };

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
  };
}

afterEach(() => {
  mock.restoreAll();
  __resetFeatureFlagCacheForTests();
  delete globalThis.chrome;
  delete globalThis.AURA_MODE_ENGINE_SCOPED_V2;
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
