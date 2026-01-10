import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { buildScopedModeCssV2, computeTokensV2 } from '../shared/mode-engine-scoped-v2.js';
import { ACTIONS, MODE_IDS, SMARTSCOPE_ACTIONS, STATES } from '../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';
import { CssApplier } from '../background/css-applier.js';

function createRegistry() {
  const store = new Map();
  return {
    async register(cssText, origin, meta = {}) {
      const cssId = `css-${store.size + 1}`;
      const entry = { cssId, cssText, origin, ...meta };
      store.set(cssId, entry);
      return entry;
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

function setupChromeMock({ actionLog, setScopeRootResponse = { ok: true }, applyScopeTokensResponse = { ok: true, applied: 1 } }) {
  globalThis.chrome = {
    scripting: {
      insertCSS: async () => {},
      removeCSS: async () => {},
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
              frameId: 0,
              ok: true,
              detail: '',
              reason: 'v2-selected',
            },
          };
        } else if (message.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT) {
          response = setScopeRootResponse;
        } else if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
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
        get: async () => ({}),
        set: async () => {},
      },
    },
    runtime: { lastError: null },
  };

  globalThis.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: () => ({ ok: true }),
    salvageScopeRootBySelector: () => ({ ok: true, tried: true, selector: 'main' }),
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
    assert.ok(css.includes(':is(a) { color: var(--aura-link-color)'));
    assert.ok(css.includes(':is(a):visited { color: var(--aura-link-visited-color)'));
    assert.ok(css.includes(':is(a):hover { color: var(--aura-link-hover-color)'));
    assert.ok(!css.includes('a { color: var(--aura-text-color'));
  });

  it('contains token-driven reflow rules', () => {
    const css = buildScopedModeCssV2({
      modeId: MODE_IDS.COMFORT_VISUAL,
      intensity: 0.6,
    });

    assert.ok(css.includes('max-inline-size: var(--aura-measure-max-inline-size'));
    assert.ok(css.includes('overflow-wrap: var(--aura-overflow-wrap'));
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
