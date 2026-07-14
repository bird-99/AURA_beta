import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  applyWithSmartScope,
  getChecksForVariant,
  materializeScopedCss,
  validateScopedCss,
  verifyComputedStyles,
} from '../../background/smartscope-v1-apply.js';
import { contentBridge } from '../../background/content-bridge.js';
import {
  FOCUS_SCOPE_PLACEHOLDER,
  MODE_IDS,
  SMARTSCOPE_ACTIONS,
  SMARTSCOPE_LEVELS,
  STORAGE_KEYS,
} from '../../shared/constants.js';

const originalSafeSend = contentBridge.safeSend;

function setupChrome(storageValues = {}) {
  const calls = { insert: [], remove: [], localSet: [] };
  global.chrome = {
    scripting: {
      insertCSS: async (payload) => {
        calls.insert.push(payload);
      },
      removeCSS: async (payload) => {
        calls.remove.push(payload);
      },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: storageValues[key] }),
        set: async (payload) => {
          calls.localSet.push(payload);
        },
      },
    },
  };
  return calls;
}

function createRegistry() {
  const entries = new Map();
  const calls = { register: [], remove: [] };
  let counter = 0;
  return {
    calls,
    register: async (cssText, origin, meta) => {
      counter += 1;
      const cssId = `v1-css-${counter}`;
      entries.set(cssId, { cssText, origin, meta });
      calls.register.push({ cssId, cssText, origin, meta });
      return { cssId, cssHash: `hash-${counter}` };
    },
    remove: async (cssId) => {
      calls.remove.push(cssId);
      entries.delete(cssId);
    },
    entries,
  };
}

const monitor = {
  measureHeapDelta: async (fn) => fn(),
  measureLatency: async (fn) => fn(),
};

afterEach(() => {
  contentBridge.safeSend = originalSafeSend;
  delete global.chrome;
});

test('smartscope-v1 apply module does not import css-applier', async () => {
  const source = await readFile(join(process.cwd(), 'background', 'smartscope-v1-apply.js'), 'utf8');

  assert.equal(source.includes('./css-applier.js'), false);
  assert.equal(source.includes('css-applier'), false);
});

test('focus CSS helpers normalize legacy aura scope and reject unsafe scopes', () => {
  const materialized = materializeScopedCss(`${FOCUS_SCOPE_PLACEHOLDER} p { color: red; }`, '.aura-scope');

  assert.match(materialized, /\[data-aura-scope="1"\] p/);
  assert.equal(validateScopedCss(`${FOCUS_SCOPE_PLACEHOLDER} p { color: red; }`, '.article').reason, 'unresolved-placeholder');
  assert.equal(validateScopedCss('.article p { color: red; }', 'body').reason, 'trivial-scope');
});

test('verifyComputedStyles sends v1 checks to the requested frame', async () => {
  const calls = [];
  contentBridge.safeSend = async (tabId, message, options) => {
    calls.push({ tabId, message, options });
    return { ok: true, data: { allPassed: true } };
  };

  const verified = await verifyComputedStyles(7, MODE_IDS.COMFORT_VISUAL, 'MINIMAL', { frameId: 4 });

  assert.equal(verified, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tabId, 7);
  assert.equal(calls[0].message.action, 'SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1');
  assert.deepEqual(calls[0].options, { frameId: 4 });
  assert.ok(calls[0].message.checks.length >= 3);
});

test('getChecksForVariant preserves legacy check contracts', () => {
  assert.deepEqual(getChecksForVariant(MODE_IDS.FOCUS, 'STRICT'), [
    { selector: 'main, article, [role="main"]', property: 'maxWidth', compare: 'exists' },
    { selector: 'body', property: 'animationDuration', compare: 'eq', value: '0s' },
  ]);
  assert.equal(getChecksForVariant('unknown', 'STRICT').length, 0);
});

test('applyWithSmartScope returns trivial-scope fallback before inserting CSS', async () => {
  const chromeCalls = setupChrome({
    [STORAGE_KEYS.USER_PREFS]: { modePrefs: { [MODE_IDS.COMFORT_VISUAL]: { darkMode: true } } },
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {},
  });
  const registry = createRegistry();

  contentBridge.safeSend = async (tabId, message, options) => {
    assert.equal(tabId, 7);
    assert.deepEqual(options, { frameId: 2 });
    assert.equal(message.action, SMARTSCOPE_ACTIONS.GET_PROFILE);
    return { ok: true, data: { ok: true, profile: { scopeSelector: 'body', reason: 'root' } } };
  };

  const result = await applyWithSmartScope(
    7,
    MODE_IDS.COMFORT_VISUAL,
    1,
    { level: SMARTSCOPE_LEVELS.CONSERVATIVE, debugEnabled: false },
    'example.com',
    'AUTHOR',
    registry,
    monitor,
    { frameId: 2 },
  );

  assert.equal(result.success, false);
  assert.equal(result.failureReason, 'trivial-scope');
  assert.equal(chromeCalls.insert.length, 0);
  assert.equal(registry.calls.register.length, 0);
});

test('applyWithSmartScope applies patch CSS, classes and verification in-frame', async () => {
  const chromeCalls = setupChrome({
    [STORAGE_KEYS.USER_PREFS]: {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: {
          darkMode: true,
          textScale: false,
          spacingPack: false,
          linkEnhance: false,
          typoSmoothing: false,
        },
      },
    },
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {},
  });
  const registry = createRegistry();
  const sent = [];

  contentBridge.safeSend = async (tabId, message, options) => {
    sent.push({ tabId, message, options });
    if (message.action === SMARTSCOPE_ACTIONS.GET_PROFILE) {
      return { ok: true, data: { ok: true, profile: { scopeSelector: 'main', reason: 'semantic', score: 0.9 } } };
    }
    if (message.action === SMARTSCOPE_ACTIONS.APPLY_CLASSES) {
      return { ok: true, data: { ok: true, applied: ['aura-scope', 'aura-comfort-scope'] } };
    }
    if (message.action === 'SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1') {
      return { ok: true, data: { allPassed: true } };
    }
    throw new Error(`unexpected action ${message.action}`);
  };

  const result = await applyWithSmartScope(
    7,
    MODE_IDS.COMFORT_VISUAL,
    1,
    { level: SMARTSCOPE_LEVELS.CONSERVATIVE, debugEnabled: false },
    'example.com',
    'AUTHOR',
    registry,
    monitor,
    { frameId: 3 },
  );

  assert.equal(result.success, true);
  assert.equal(result.scopeKey, 'main');
  assert.equal(result.cssId, 'v1-css-1');
  assert.equal(result.darkModeEnabled, true);
  assert.equal(result.textScaleEnabled, false);
  assert.equal(result.spacingPackEnabled, false);
  assert.equal(result.linkEnhanceEnabled, false);
  assert.equal(result.typoSmoothingEnabled, false);
  assert.deepEqual(result.appliedClasses, ['aura-scope', 'aura-comfort-scope']);
  assert.equal(chromeCalls.insert.length, 1);
  assert.deepEqual(chromeCalls.insert[0].target, { tabId: 7, frameIds: [3] });
  assert.equal(registry.calls.register.length, 1);
  assert.equal(registry.calls.register[0].meta.scopeKey, 'main');
  assert.equal(registry.calls.register[0].meta.textScaleEnabled, false);
  assert.equal(registry.calls.register[0].meta.spacingPackEnabled, false);
  assert.equal(registry.calls.register[0].meta.linkEnhanceEnabled, false);
  assert.equal(registry.calls.register[0].meta.typoSmoothingEnabled, false);
  assert.equal(registry.calls.register[0].meta.darkModeEnabled, true);
  assert.match(registry.calls.register[0].cssText, /color-scheme:\s*dark/i);
  assert.match(registry.calls.register[0].cssText, /background-color:\s*#0f1116/i);
  assert.doesNotMatch(registry.calls.register[0].cssText, /font-size:/);
  assert.doesNotMatch(registry.calls.register[0].cssText, /line-height:/);
  assert.doesNotMatch(registry.calls.register[0].cssText, /text-decoration-line:\s*underline/);
  assert.doesNotMatch(registry.calls.register[0].cssText, /letter-spacing:/);
  assert.doesNotMatch(registry.calls.register[0].cssText, /text-rendering:\s*optimizeLegibility/);
  assert.doesNotMatch(registry.calls.register[0].cssText, /font-kerning:\s*normal/);
  assert.ok(sent.every((call) => call.options?.frameId === 3));
});
