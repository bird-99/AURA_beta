import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  applyPreludeCss,
  ensureTransitionsCss,
  removeTransitionsCss,
} from '../../background/scoped-v2-css-lifecycle.js';
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
  const updates = [];
  return {
    getModeState: async (tabId, modeId) => state?.[tabId]?.[modeId] || null,
    updateModeState: async (tabId, modeId, nextState, update = {}) => {
      updates.push({ tabId, modeId, nextState, update });
      state[tabId] = state[tabId] || {};
      state[tabId][modeId] = {
        ...(state[tabId][modeId] || {}),
        state: nextState,
        ...update,
      };
    },
    state,
    updates,
  };
}

function createRegistry() {
  const entries = new Map();
  let counter = 0;
  return {
    register: async (cssText, origin, meta) => {
      counter += 1;
      const cssId = `lifecycle-css-${counter}`;
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

test('scoped-v2 css lifecycle module does not import css-applier', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'background', 'scoped-v2-css-lifecycle.js'), 'utf8');

  assert.equal(source.includes('css-applier'), false);
});

test('applyPreludeCss direct API uses injected registry and state manager', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { state: STATES.ACTIVE, scopedV2: {} },
    },
  });

  const result = await applyPreludeCss(1, 'test', {
    registry,
    stateManager,
    getComfortVisualPrefs: async () => ({ darkMode: true }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(calls.insert.length, 2);
  assert.deepEqual(calls.insert[0].target, { tabId: 1 });
  assert.deepEqual(calls.insert[1].target, { tabId: 1, allFrames: true });
  assert.match(calls.insert[0].css, /html\s*\{/);
  assert.match(calls.insert[0].css, /body\s*\{/);
  assert.match(calls.insert[0].css, /color-scheme:\s*dark/);
  assert.equal(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeCssId, 'lifecycle-css-1');
  assert.equal(registry.entries.size, 1);
});

test('transition lifecycle direct API respects frameId and updateState false', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.FOCUS]: { state: STATES.ACTIVE, scopedV2: {} },
    },
  });

  const applied = await ensureTransitionsCss(
    1,
    MODE_IDS.FOCUS,
    { frameId: 5, transitionMs: 120 },
    { registry, stateManager },
  );
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.deepEqual(calls.insert[0].target, { tabId: 1, frameIds: [5] });

  const modeState = {
    state: STATES.ACTIVE,
    scopedV2: {
      frameId: 5,
      transitionCssId: applied.cssId,
      transitionCssHash: applied.cssHash,
    },
  };
  const removed = await removeTransitionsCss(
    1,
    MODE_IDS.FOCUS,
    { modeState, updateState: false },
    { registry, stateManager },
  );

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.deepEqual(calls.remove[0].target, { tabId: 1, frameIds: [5] });
  assert.equal(registry.entries.has(applied.cssId), false);
  assert.deepEqual(stateManager.updates, []);
});
