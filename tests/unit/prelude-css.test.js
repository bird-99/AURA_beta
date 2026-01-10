import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CssApplier } from '../../background/css-applier.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';

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

test('applyPreludeCss inserts raw prelude css and removePreludeCss cleans it up', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { state: STATES.ACTIVE, scopedV2: {} },
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

  const applied = await applier.applyPreludeCss(1, 'system');

  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.equal(callOrder[0], 'insert');
  assert.equal(callOrder[1], 'register');
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.insert[0].origin, 'AUTHOR');
  assert.match(calls.insert[0].css, /color-scheme/);
  assert.match(calls.insert[0].css, /background-color/);

  const scopedState = stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2;
  assert.equal(scopedState.preludeCssId, applied.cssId);

  const removed = await applier.removePreludeCss(1, 'system');

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 1);
  assert.equal(calls.remove[0].origin, 'AUTHOR');
  assert.equal(calls.remove[0].css, calls.insert[0].css);
  const clearedState = stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2;
  assert.equal(clearedState.preludeCssId, null);
});
