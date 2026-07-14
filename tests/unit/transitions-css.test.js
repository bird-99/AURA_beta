import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CssApplier } from '../../background/css-applier.js';
import { MODE_IDS } from '../../shared/constants.js';

function createChromeScriptingSpies() {
  const calls = { insert: [], remove: [] };
  global.chrome = {
    scripting: {
      insertCSS: async (payload) => {
        calls.insert.push(payload);
      },
      removeCSS: async (payload) => {
        calls.remove.push(payload);
      },
    },
  };
  return calls;
}

function createStateManager(initialState = {}) {
  const state = { ...initialState };
  return {
    getModeState: async (tabId, modeId) => state?.[tabId]?.[modeId] || null,
    updateModeState: async (tabId, modeId, nextState, updates = {}) => {
      state[tabId] = state[tabId] || {};
      state[tabId][modeId] = {
        ...(state[tabId][modeId] || {}),
        state: nextState,
        ...updates,
      };
    },
    state,
  };
}

function createRegistry() {
  const entries = new Map();
  let counter = 0;
  return {
    register: async (cssText, origin, meta) => {
      counter += 1;
      const cssId = `css-${counter}`;
      entries.set(cssId, { cssText, origin, meta });
      return { cssId, cssHash: `hash-${counter}` };
    },
    get: async (cssId) => entries.get(cssId) || null,
    remove: async (cssId) => {
      entries.delete(cssId);
    },
    entries,
  };
}

afterEach(() => {
  delete global.chrome;
});

test('ensureTransitionsCss injects raw transition sheet and removeTransitionsCss removes it', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { scopedV2: {} },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);
  const callOrder = [];

  const originalInsert = global.chrome.scripting.insertCSS;
  global.chrome.scripting.insertCSS = async (payload) => {
    callOrder.push('insert');
    await originalInsert(payload);
  };
  const originalRegister = registry.register;
  registry.register = async (...args) => {
    callOrder.push('register');
    return originalRegister(...args);
  };

  const result = await applier.ensureTransitionsCss(1, MODE_IDS.COMFORT_VISUAL, {
    transitionMs: 160,
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(callOrder[0], 'insert');
  assert.equal(callOrder[1], 'register');
  assert.equal(calls.insert.length, 1);
  assert.match(calls.insert[0].css, /transition-property: color/);
  assert.match(calls.insert[0].css, /transition-duration: 160ms/);

  stateManager.state[1][MODE_IDS.COMFORT_VISUAL] = {
    scopedV2: {
      transitionCssId: result.cssId,
      transitionCssHash: result.cssHash,
    },
  };

  const removed = await applier.removeTransitionsCss(1, MODE_IDS.COMFORT_VISUAL);

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 1);
  assert.equal(calls.remove[0].css, calls.insert[0].css);
  assert.equal(registry.entries.has(result.cssId), false);
});

test('ensureTransitionsCss skips reinsertion when transition hash is already active', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { scopedV2: {} },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const first = await applier.ensureTransitionsCss(1, MODE_IDS.COMFORT_VISUAL, {
    transitionMs: 160,
  });
  stateManager.state[1][MODE_IDS.COMFORT_VISUAL] = {
    scopedV2: {
      transitionCssId: first.cssId,
      transitionCssHash: first.cssHash,
    },
  };

  const second = await applier.ensureTransitionsCss(1, MODE_IDS.COMFORT_VISUAL, {
    transitionMs: 160,
  });

  assert.equal(first.ok, true);
  assert.equal(first.applied, true);
  assert.equal(second.ok, true);
  assert.equal(second.applied, false);
  assert.equal(second.cssId, first.cssId);
  assert.equal(second.cssHash, first.cssHash);
  assert.equal(calls.insert.length, 1);
});
