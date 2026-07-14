import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CssApplier } from '../../background/css-applier.js';
import { MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';

function createChromeScriptingSpies({ userPrefs } = {}) {
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
    storage: {
      local: {
        get: async (key) => {
          if (key === STORAGE_KEYS.USER_PREFS) {
            return { [STORAGE_KEYS.USER_PREFS]: userPrefs || {} };
          }
          return {};
        },
        set: async () => {},
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
    get: async (cssId) => {
      const entry = entries.get(cssId);
      return entry ? { cssId, ...entry } : null;
    },
    list: async () => Array.from(entries.entries()).map(([cssId, entry]) => ({ cssId, ...entry })),
    remove: async (cssId) => {
      entries.delete(cssId);
    },
    entries,
  };
}

afterEach(() => {
  delete global.chrome;
});

test('applyPreludeCss injects dark shell prelude when comfort dark mode is active', async () => {
  const calls = createChromeScriptingSpies({
    userPrefs: {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
      },
    },
  });
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { state: STATES.ACTIVE, scopedV2: {} },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const applied = await applier.applyPreludeCss(1, 'system');

  assert.equal(applied.ok, true);
  assert.equal(applied.applied, true);
  assert.equal(calls.insert.length, 2);
  assert.deepEqual(calls.insert[0].target, { tabId: 1 });
  assert.deepEqual(calls.insert[1].target, { tabId: 1, allFrames: true });
  assert.match(calls.insert[0].css, /html\s*\{/);
  assert.match(calls.insert[0].css, /body\s*\{/);
  assert.match(calls.insert[0].css, /color-scheme:\s*dark/);
  assert.match(calls.insert[0].css, /:not\(\[data-aura-scope="1"\]\)/);
  assert.equal(registry.entries.size, 1);
  assert.equal(registry.entries.get('css-1')?.meta?.allFrames, true);
  assert.equal(registry.entries.get('css-1')?.meta?.includeTopFrame, true);
  assert.equal(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeCssId, 'css-1');
  assert.deepEqual(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeDocuments, []);
});

test('removePreludeCss removes exact document refresh receipts', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const preludeCss = 'html, body { color-scheme: dark !important; }';
  registry.entries.set('css-prelude', {
    cssText: preludeCss,
    origin: 'AUTHOR',
    meta: { variant: 'PRELUDE', allFrames: true, includeTopFrame: true },
  });
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.ACTIVE,
        scopedV2: {
          preludeCssId: 'css-prelude',
          preludeDocuments: [
            { documentId: 'doc-main', frameId: 0 },
            { documentId: 'doc-frame', frameId: 2 },
          ],
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'mode-disabled');

  assert.equal(removed.ok, true);
  assert.deepEqual(calls.remove.map((call) => call.target), [
    { tabId: 1, allFrames: true },
    { tabId: 1 },
    { tabId: 1, documentIds: ['doc-main'] },
    { tabId: 1, documentIds: ['doc-frame'] },
  ]);
  assert.equal(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeDocuments, null);
});

test('removePreludeCss cleans stale prelude by stored identity', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  registry.entries.set('css-stale-prelude', {
    cssText: 'html, body { color-scheme: dark !important; }',
    origin: 'AUTHOR',
    meta: { variant: 'PRELUDE', allFrames: true, includeTopFrame: true },
  });
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.ACTIVE,
        scopedV2: {
          preludeCssId: 'css-stale-prelude',
          preludeHash: 'hash-stale',
          preludeAppliedAt: 123,
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'system');

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 2);
  assert.deepEqual(calls.remove[0].target, { tabId: 1, allFrames: true });
  assert.deepEqual(calls.remove[1].target, { tabId: 1 });
  assert.equal(calls.remove[0].origin, 'AUTHOR');
  assert.equal(calls.remove[0].css, 'html, body { color-scheme: dark !important; }');
  assert.equal(registry.entries.has('css-stale-prelude'), false);
  const clearedState = stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2;
  assert.equal(clearedState.preludeCssId, null);
});

test('removePreludeCss reconstructs exact generated CSS when the registry pointer is stale', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.ACTIVE,
        scopedV2: {
          preludeCssId: 'missing-prelude',
          preludeHash: 'stale-hash',
          preludeAppliedAt: 123,
          preludeRefreshCount: 0,
          darkModeEnabled: true,
          tokens: {
            '--aura-bg-color': '#10141f',
            '--aura-text-color': '#e6e6e6',
          },
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'mode-disabled');

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 2);
  assert.match(calls.remove[0].css, /#10141f/);
  assert.equal(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeCssId, null);
});

test('removePreludeCss removes tracked all-frame refresh copies', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const preludeCss = 'html, body { color-scheme: dark !important; }';
  registry.entries.set('css-stale-prelude', {
    cssText: preludeCss,
    origin: 'AUTHOR',
    meta: { variant: 'PRELUDE', allFrames: true, includeTopFrame: true },
  });
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.ACTIVE,
        scopedV2: {
          preludeCssId: 'css-stale-prelude',
          preludeHash: 'hash-stale',
          preludeAppliedAt: 123,
          preludeRefreshCount: 2,
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'system');

  assert.equal(removed.ok, true);
  assert.equal(calls.remove.length, 4);
  assert.equal(calls.remove.filter((call) => call.css === preludeCss && call.target?.allFrames === true).length, 3);
  assert.equal(
    calls.remove.filter((call) => call.css === preludeCss && call.target?.tabId === 1 && !call.target?.allFrames).length,
    1,
  );
  const clearedState = stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2;
  assert.equal(clearedState.preludeCssId, null);
  assert.equal(clearedState.preludeRefreshCount, null);
});

test('removePreludeCss cleans stored prelude even after mode state flips inactive', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  registry.entries.set('css-stale-prelude', {
    cssText: 'html, body { color-scheme: dark !important; }',
    origin: 'AUTHOR',
    meta: { variant: 'PRELUDE', allFrames: true, includeTopFrame: true },
  });
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.INACTIVE,
        scopedV2: {
          preludeCssId: 'css-stale-prelude',
          preludeHash: 'hash-stale',
          preludeAppliedAt: 123,
        },
      },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'mode-disabled');

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 2);
  assert.deepEqual(calls.remove[0].target, { tabId: 1, allFrames: true });
  assert.deepEqual(calls.remove[1].target, { tabId: 1 });
  assert.equal(registry.entries.has('css-stale-prelude'), false);
  const clearedState = stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2;
  assert.equal(clearedState.preludeCssId, null);
});

test('removePreludeCss can clean orphaned prelude entries after storage state is cleared', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  registry.entries.set('css-captured-prelude', {
    cssId: 'css-captured-prelude',
    cssText: 'html, body { background: #0b1020 !important; }',
    origin: 'AUTHOR',
    meta: { tabId: 1, modeId: MODE_IDS.COMFORT_VISUAL, variant: 'PRELUDE', allFrames: true, includeTopFrame: true },
  });
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: {
        state: STATES.INACTIVE,
        scopedV2: null,
      },
    },
  });
  const capturedModeState = {
    state: STATES.ACTIVE,
    scopedV2: null,
  };
  const applier = new CssApplier(registry, stateManager, null);

  const removed = await applier.removePreludeCss(1, 'mode-disabled', { modeState: capturedModeState });

  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.equal(calls.remove.length, 2);
  assert.deepEqual(calls.remove[0].target, { tabId: 1, allFrames: true });
  assert.deepEqual(calls.remove[1].target, { tabId: 1 });
  assert.equal(registry.entries.has('css-captured-prelude'), false);
});

test('applyPreludeCss does not reinsert an identical active prelude', async () => {
  const calls = createChromeScriptingSpies({
    userPrefs: {
      modePrefs: {
        [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
      },
    },
  });
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { state: STATES.ACTIVE, scopedV2: {} },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const first = await applier.applyPreludeCss(1, 'system');
  const second = await applier.applyPreludeCss(1, 'system');

  assert.equal(first.ok, true);
  assert.equal(first.applied, true);
  assert.equal(second.ok, true);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'already-applied');
  assert.equal(calls.insert.length, 2);
  assert.equal(stateManager.state[1][MODE_IDS.COMFORT_VISUAL].scopedV2.preludeCssId, 'css-1');
});

test('applyPreludeCss skips when comfort dark mode is disabled', async () => {
  const calls = createChromeScriptingSpies();
  const registry = createRegistry();
  const stateManager = createStateManager({
    1: {
      [MODE_IDS.COMFORT_VISUAL]: { state: STATES.ACTIVE, scopedV2: {} },
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const applied = await applier.applyPreludeCss(1, 'system');

  assert.equal(applied.ok, true);
  assert.equal(applied.applied, false);
  assert.equal(applied.reason, 'dark-mode-disabled');
  assert.equal(calls.insert.length, 0);
});
