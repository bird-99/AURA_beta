import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CssApplier, applyScopedModeV2, removeScopedModeV2 } from '../../background/css-applier.js';
import { contentBridge } from '../../background/content-bridge.js';
import { cssRegistry } from '../../background/css-registry.js';
import { ACTIONS, MODE_IDS, STATES } from '../../shared/constants.js';

function createChromeScriptingSpies() {
  const calls = { remove: [] };
  global.chrome = {
    scripting: {
      removeCSS: async (payload) => {
        calls.remove.push(payload);
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete global.chrome;
});

test('removeScopedModeV2 preserves scope but still cleans up tokens afterward', async () => {
  const calls = createChromeScriptingSpies();
  const safeSendCalls = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      safeSendCalls.push({ tabId, message, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: true } };
    };
    cssRegistry.get = async () => ({ cssText: 'body { color: red; }', origin: 'AUTHOR' });
    cssRegistry.remove = async () => {};

    applyScopedModeV2({
      tabId: 1,
      frameId: 0,
      cssId: 'test-css',
      modeId: MODE_IDS.COMFORT_VISUAL,
      cssText: 'body { color: red; }',
      tokens: { '--aura-token': '1' },
    });

    const result = await removeScopedModeV2({ tabId: 1, frameId: 0, cssId: 'test-css', preserveScope: true });

    assert.equal(result.ok, true);
    assert.equal(safeSendCalls.length, 2);
    assert.equal(safeSendCalls[0].message.action, ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(safeSendCalls[0].message.preserveScope, true);
    assert.equal(safeSendCalls[1].message.action, ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(safeSendCalls[1].message.preserveScope, false);
    assert.equal(calls.remove.length, 1);
    assert.equal(calls.remove[0].css, 'body { color: red; }');
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});

test('removeScopedModeV2 cleans up from persisted scoped state when memory state is missing', async () => {
  const calls = createChromeScriptingSpies();
  const safeSendCalls = [];
  const removedCssIds = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      safeSendCalls.push({ tabId, message, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: true } };
    };
    cssRegistry.get = async (cssId) => ({
      id: cssId,
      cssText: 'main[data-aura-scope="1"] { color: blue; }',
      origin: 'AUTHOR',
    });
    cssRegistry.remove = async (cssId) => {
      removedCssIds.push(cssId);
    };

    const result = await removeScopedModeV2({
      tabId: 1,
      frameId: 0,
      scopedState: {
        cssId: 'persisted-css',
        modeId: MODE_IDS.COMFORT_VISUAL,
        owner: 'aura-me2',
        scopeSelector: '[data-aura-scope="1"]',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.equal(result.details.cssRemoved, true);
    assert.equal(result.details.tokensRemoved, true);
    assert.equal(result.details.scopeUnmarked, true);
    assert.equal(safeSendCalls.length, 1);
    assert.equal(safeSendCalls[0].message.action, ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(safeSendCalls[0].message.ownerKey, 'aura-me2');
    assert.equal(calls.remove.length, 1);
    assert.equal(calls.remove[0].css, 'main[data-aura-scope="1"] { color: blue; }');
    assert.deepEqual(removedCssIds, ['persisted-css']);
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});

test('removeScopedModeV2 runs preserve cleanup, css removal, registry removal, then final cleanup for transitions', async () => {
  createChromeScriptingSpies();
  const events = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      events.push({ type: 'cleanup', preserveScope: message.preserveScope, tabId, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: message.preserveScope !== true } };
    };
    cssRegistry.get = async () => ({ cssText: '.scope { color: red; }', origin: 'AUTHOR' });
    cssRegistry.remove = async (cssId) => {
      events.push({ type: 'registry-remove', cssId });
    };
    global.chrome.scripting.removeCSS = async (payload) => {
      events.push({ type: 'remove-css', payload });
    };

    applyScopedModeV2({
      tabId: 33,
      frameId: 4,
      cssId: 'transition-css',
      modeId: MODE_IDS.COMFORT_VISUAL,
      cssText: '.scope { color: red; }',
      tokens: { '--aura-token': '1' },
    });

    const result = await removeScopedModeV2({
      tabId: 33,
      frameId: 4,
      cssId: 'transition-css',
      transitionMs: 1,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      events.map((event) => event.type),
      ['cleanup', 'remove-css', 'cleanup', 'registry-remove'],
    );
    assert.equal(events[0].preserveScope, true);
    assert.equal(events[2].preserveScope, false);
    assert.deepEqual(events[1].payload.target, { tabId: 33, frameIds: [4] });
    assert.equal(events[1].payload.css, '.scope { color: red; }');
    assert.equal(events[1].payload.origin, 'AUTHOR');
    assert.equal(events[3].cssId, 'transition-css');
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});

test('removeScopedModeV2 falls back to persisted scopedState cssText when registry lookup misses', async () => {
  const calls = createChromeScriptingSpies();
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  const removedCssIds = [];
  try {
    contentBridge.safeSend = async () => ({ ok: true, data: { ok: true, removed: 0, scopeUnmarked: true } });
    cssRegistry.get = async () => null;
    cssRegistry.remove = async (cssId) => {
      removedCssIds.push(cssId);
    };

    const result = await removeScopedModeV2({
      tabId: 44,
      frameId: 1,
      scopedState: {
        cssId: 'missing-registry-css',
        modeId: MODE_IDS.FOCUS,
        owner: 'aura-me2',
        cssText: 'main[data-aura-scope="1"] { outline: 0; }',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.remove.length, 1);
    assert.equal(calls.remove[0].css, 'main[data-aura-scope="1"] { outline: 0; }');
    assert.equal(calls.remove[0].origin, 'AUTHOR');
    assert.deepEqual(removedCssIds, ['missing-registry-css']);
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});

test('removeScopedModeV2 removes CSS by cssId when no scoped state exists', async () => {
  createChromeScriptingSpies();
  const events = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      events.push({ type: 'cleanup', tabId, message, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: true } };
    };
    cssRegistry.get = async (cssId) => ({
      id: cssId,
      cssText: '[data-aura-scope="1"] { color: green; }',
      origin: 'USER',
    });
    cssRegistry.remove = async (cssId) => {
      events.push({ type: 'registry-remove', cssId });
    };
    global.chrome.scripting.removeCSS = async (payload) => {
      events.push({ type: 'remove-css', payload });
    };

    const result = await removeScopedModeV2({
      tabId: 55,
      frameId: 2,
      cssId: 'css-id-only',
    });

    assert.equal(result.ok, true);
    assert.equal(result.details.cssRemoved, true);
    assert.equal(result.details.tokensRemoved, true);
    assert.equal(result.details.scopeUnmarked, true);
    assert.deepEqual(
      events.map((event) => event.type),
      ['cleanup', 'remove-css', 'registry-remove'],
    );
    assert.equal(events[0].message.preserveScope, false);
    assert.deepEqual(events[1].payload.target, { tabId: 55, frameIds: [2] });
    assert.equal(events[1].payload.css, '[data-aura-scope="1"] { color: green; }');
    assert.equal(events[1].payload.origin, 'USER');
    assert.equal(events[2].cssId, 'css-id-only');
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});

test('CssApplier.removeModeScopedV2 cleans up by cssId when scopeSelector is missing', async () => {
  createChromeScriptingSpies();
  const events = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      events.push({ type: 'cleanup', tabId, message, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: true } };
    };
    cssRegistry.get = async (cssId) => ({
      id: cssId,
      cssText: '[data-aura-scope="1"] { color: purple; }',
      origin: 'AUTHOR',
    });
    cssRegistry.remove = async (cssId) => {
      events.push({ type: 'registry-remove', cssId });
    };
    global.chrome.scripting.removeCSS = async (payload) => {
      events.push({ type: 'remove-css', payload });
    };

    const modeState = {
      state: STATES.ACTIVE,
      cssId: 'facade-css',
      scopedV2: {
        cssId: 'facade-css',
        frameId: 7,
        owner: 'aura-me2',
      },
    };
    const stateUpdates = [];
    const stateManager = {
      getModeState: async () => modeState,
      updateModeState: async (...args) => {
        stateUpdates.push(args);
      },
      setSmartScopeStatus: async (...args) => {
        stateUpdates.push(args);
      },
    };
    const applier = new CssApplier(cssRegistry, stateManager, null);

    const result = await applier.removeModeScopedV2(88, MODE_IDS.FOCUS, {
      modeState,
      updateState: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.details.cssRemoved, true);
    assert.deepEqual(
      events.map((event) => event.type),
      ['cleanup', 'remove-css', 'registry-remove'],
    );
    assert.deepEqual(events[1].payload.target, { tabId: 88, frameIds: [7] });
    assert.equal(events[1].payload.css, '[data-aura-scope="1"] { color: purple; }');
    assert.equal(events[2].cssId, 'facade-css');
    assert.deepEqual(stateUpdates, []);
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});
