import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { CssApplier, buildManualDarkComfortThemeRequest } from '../../background/css-applier.js';
import { contentBridge } from '../../background/content-bridge.js';
import { MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function createChromeMock({ failRemoveCss = false } = {}) {
  const calls = { insert: [], remove: [], localSet: [], sessionSet: [] };
  global.chrome = {
    tabs: {
      get: async () => ({ id: 7, url: 'https://example.com/article' }),
    },
    scripting: {
      insertCSS: async (payload) => {
        calls.insert.push(payload);
      },
      removeCSS: async (payload) => {
        calls.remove.push(payload);
        if (failRemoveCss) {
          throw new Error('remove failed');
        }
      },
      executeScript: async (payload) => {
        if (Array.isArray(payload.args) && payload.args.length > 0) {
          return [{
            frameId: 0,
            documentId: payload.target?.documentIds?.[0] || 'doc-main',
            result: { ok: true, active: false },
          }];
        }
        return [{
          frameId: 0,
          documentId: 'doc-main',
          result: {
            active: true,
            receiptId: 'receipt-main',
            preimageAvailable: true,
            backgroundColor: 'rgb(255, 255, 255)',
            surfaceColor: 'rgb(255, 255, 255)',
            textColor: 'rgb(17, 24, 39)',
            linkColor: 'rgb(29, 78, 216)',
            mutedTextColor: 'rgb(75, 85, 99)',
            prefersColorScheme: 'light',
          },
        }];
      },
    },
    storage: {
      local: {
        get: async (key) => {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((entry) => [entry, undefined]));
          }
          if (key === STORAGE_KEYS.USER_PREFS) {
            return {
              [STORAGE_KEYS.USER_PREFS]: {
                smartScope: { enabled: true, level: 'conservative' },
                modePrefs: {
                  [MODE_IDS.COMFORT_VISUAL]: { darkMode: true },
                },
              },
            };
          }
          return {};
        },
        set: async (payload) => {
          calls.localSet.push(payload);
        },
      },
      session: {
        get: async () => ({ [STORAGE_KEYS.RUNTIME_STATE]: {} }),
        set: async (payload) => {
          calls.sessionSet.push(payload);
        },
      },
    },
  };
  return calls;
}

function createRegistry(entries) {
  const store = new Map(Object.entries(entries));
  const calls = { get: [], register: [], remove: [] };
  let counter = 0;
  return {
    calls,
    register: async (cssText, origin, meta) => {
      counter += 1;
      const cssId = `css-${counter}`;
      const entry = { cssText, origin, meta, cssHash: `hash-${counter}` };
      store.set(cssId, entry);
      calls.register.push({ cssId, cssText, origin, meta });
      return { cssId, cssHash: entry.cssHash };
    },
    get: async (cssId) => {
      calls.get.push(cssId);
      return store.get(cssId) || null;
    },
    remove: async (cssId) => {
      calls.remove.push(cssId);
      store.delete(cssId);
    },
  };
}

function createStateManager(modeState) {
  const calls = { updates: [], smartScopeStatus: [] };
  let currentModeState = modeState;
  return {
    calls,
    getModeState: async () => currentModeState,
    updateModeState: async (tabId, modeId, state, updates) => {
      calls.updates.push({ tabId, modeId, state, updates });
      currentModeState = { ...currentModeState, ...updates, state };
    },
    setSmartScopeStatus: async (tabId, modeId, status) => {
      calls.smartScopeStatus.push({ tabId, modeId, status });
    },
  };
}

afterEach(() => {
  delete global.chrome;
});

test('global dark fallback keeps explicit high-specificity Wikipedia surface rules', () => {
  const source = readRepoFile('background/css-applier.js');

  assert.match(source, /const wikiSurfaceSelector = \[/);
  assert.match(source, /'body #mw-page-base'/);
  assert.match(source, /'body #wiki-infobox'/);
  assert.match(source, /'body \.infobox'/);
  assert.match(source, /'body \.wikitable'/);
  const blockStart = source.indexOf('${wikiSurfaceSelector} {');
  assert.notEqual(blockStart, -1);
  const blockEnd = source.indexOf('body [data-aura-bg-gradient', blockStart);
  const block = source.slice(blockStart, blockEnd);
  assert.match(block, /background-color:\s*\$\{darkPalette\.surface\}\s*!important;/);
  assert.match(block, /background-image:\s*none\s*!important;/);
});

test('global dark fallback covers modern overlay token surfaces', () => {
  const source = readRepoFile('background/css-applier.js');

  assert.match(source, /\[popover\]/);
  assert.match(source, /\[aria-modal="true"\]/);
  assert.match(source, /\[data-radix-popper-content-wrapper\]/);
  assert.match(source, /\[data-headlessui-portal\]/);
  assert.match(source, /\[data-floating-ui-portal\]/);
  assert.match(source, /\[class\*="tooltip" i\]/);
  assert.match(source, /\[class\*="overlay" i\]/);
  assert.match(source, /\[class\*="portal" i\]/);
  assert.match(source, /\[role="tooltip"\]/);
  assert.match(source, /\[role="tree"\]/);
  assert.match(source, /\[role="tablist"\]/);
});

test('manual dark comfort gate supports universal popup dark requests and fallback plans', () => {
  const base = {
    modeId: MODE_IDS.COMFORT_VISUAL,
    source: 'popup',
    comfortPrefs: { darkMode: true },
    runtimeEffectPlan: {
      modeId: MODE_IDS.COMFORT_VISUAL,
      frameId: 3,
      pageType: 'ARTICLE',
    },
    frameId: 3,
    ownerKey: 'aura-me2',
    postCheckBaseline: { horizontalOverflow: 0 },
  };

  const active = buildManualDarkComfortThemeRequest(base);
  assert.equal(active?.activePlanAllowed, true);
  assert.equal(active?.messagePatch?.darkThemeExecutorActive, true);

  const rehydrate = buildManualDarkComfortThemeRequest({ ...base, source: 'rehydrate' });
  assert.equal(rehydrate?.activePlanAllowed, true);
  assert.equal(rehydrate?.messagePatch?.darkThemeExecutorActive, true);
  assert.equal(buildManualDarkComfortThemeRequest({ ...base, frameId: 4 }), null);
  const search = buildManualDarkComfortThemeRequest({
    ...base,
    runtimeEffectPlan: { ...base.runtimeEffectPlan, pageType: 'SEARCH' },
  });
  assert.equal(search?.activePlanAllowed, true);
  assert.equal(search?.messagePatch?.darkThemeExecutorActive, true);
  const fallback = buildManualDarkComfortThemeRequest({
    ...base,
    runtimeEffectPlan: null,
    profilePageType: 'UNKNOWN',
  });
  assert.equal(fallback?.activePlanAllowed, true);
  assert.equal(fallback?.messagePatch?.darkThemeExecutorActive, true);
  assert.equal(buildManualDarkComfortThemeRequest({
    ...base,
    comfortPrefs: { darkMode: false },
  }), null);

  const budgetAllowed = buildManualDarkComfortThemeRequest({ ...base, budgetHit: true });
  assert.equal(budgetAllowed?.activePlanAllowed, true);
  assert.equal(budgetAllowed?.messagePatch?.darkThemeExecutorActive, true);
  assert.equal(budgetAllowed?.gate?.failures.includes('BUDGET_HIT'), false);
});

test('removeModeV1 removes SmartScope patch CSS stored under legacy smartScope.cssId', async () => {
  const chromeCalls = createChromeMock();
  const patchCss =
    '@media (prefers-color-scheme: dark) { .aura-scope { background-color: #0f1116 !important; } }';
  const baseCss = '[data-aura-scope="1"] { --aura-me2-css: 1; }';
  const registry = createRegistry({
    'patch-css': { cssText: patchCss, origin: 'AUTHOR' },
    'base-css': { cssText: baseCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'patch-css',
    smartScope: {
      cssId: 'patch-css',
      baseCssId: 'base-css',
      domClassToken: 'token-1',
      variant: 'SCOPED',
      intensity: 1,
      darkModeEnabled: true,
    },
  });
  const originalSafeSend = contentBridge.safeSend;

  try {
    const safeSendCalls = [];
    contentBridge.safeSend = async (tabId, message) => {
      safeSendCalls.push({ tabId, message });
      return { ok: true };
    };

    const applier = new CssApplier(registry, stateManager, null);
    const result = await applier.removeModeV1(7, MODE_IDS.COMFORT_VISUAL);

    assert.equal(result.ok, true);
    assert.deepEqual(registry.calls.get, ['patch-css', 'base-css']);
    assert.deepEqual(registry.calls.remove, ['patch-css', 'base-css']);
    assert.equal(chromeCalls.remove.length, 2);
    assert.equal(chromeCalls.remove[0].css, patchCss);
    assert.equal(chromeCalls.remove[1].css, baseCss);
    assert.equal(safeSendCalls.length, 1);
    assert.equal(safeSendCalls[0].message.token, 'token-1');
    assert.equal(stateManager.calls.updates[0].state, STATES.INACTIVE);
  } finally {
    contentBridge.safeSend = originalSafeSend;
  }
});

test('removeModeV1 scopes SmartScope cleanup to the frame stored in state', async () => {
  const chromeCalls = createChromeMock();
  const patchCss = '.aura-scope { color: #f5f5f5 !important; }';
  const baseCss = 'body { --aura-v1-base: 1; }';
  const registry = createRegistry({
    'patch-css': { cssText: patchCss, origin: 'AUTHOR' },
    'base-css': { cssText: baseCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'patch-css',
    smartScope: {
      cssId: 'patch-css',
      baseCssId: 'base-css',
      domClassToken: 'token-frame',
      variant: 'SCOPED',
      intensity: 1,
      frameId: 9,
    },
  });
  const originalSafeSend = contentBridge.safeSend;

  try {
    const safeSendCalls = [];
    contentBridge.safeSend = async (tabId, message, options) => {
      safeSendCalls.push({ tabId, message, options });
      return { ok: true };
    };

    const applier = new CssApplier(registry, stateManager, null);
    const result = await applier.removeModeV1(7, MODE_IDS.COMFORT_VISUAL);

    assert.equal(result.ok, true);
    assert.deepEqual(safeSendCalls[0].options, { frameId: 9 });
    assert.equal(chromeCalls.remove.length, 2);
    assert.ok(chromeCalls.remove.every((call) => call.target.tabId === 7));
    assert.ok(chromeCalls.remove.every((call) => call.target.frameIds?.[0] === 9));
    assert.equal(stateManager.calls.updates[0].updates.frameId, null);
  } finally {
    contentBridge.safeSend = originalSafeSend;
  }
});

test('removeModeV1 scopes base-only cleanup to the top-level frame stored in state', async () => {
  const chromeCalls = createChromeMock();
  const baseCss = 'body { --aura-v1-base: 1; }';
  const registry = createRegistry({
    'base-css': { cssText: baseCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'base-css',
    frameId: 4,
    smartScope: null,
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.FOCUS);

  assert.equal(result.ok, true);
  assert.equal(chromeCalls.remove.length, 1);
  assert.deepEqual(chromeCalls.remove[0].target, { tabId: 7, frameIds: [4] });
  assert.equal(stateManager.calls.updates[0].updates.frameId, null);
});

test('removeModeV1 preserves state and registry when registered CSS removal fails', async () => {
  const chromeCalls = createChromeMock({ failRemoveCss: true });
  const baseCss = 'body { --aura-v1-base: 1; }';
  const registry = createRegistry({
    'base-css': { cssText: baseCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'base-css',
    frameId: 4,
    smartScope: null,
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.FOCUS);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(chromeCalls.remove.length, 1);
  assert.deepEqual(registry.calls.remove, []);
  assert.equal(stateManager.calls.updates.length, 1);
  assert.equal(stateManager.calls.updates[0].state, STATES.ERROR);
  assert.deepEqual(stateManager.calls.updates[0].updates, { pendingDecision: false });
  assert.equal(stateManager.calls.smartScopeStatus.length, 1);
  assert.equal(stateManager.calls.smartScopeStatus[0].status.ok, false);
  assert.equal(stateManager.calls.smartScopeStatus[0].status.error, 'RESTORE_CSS_REMOVE_FAILED');
});

test('removeModeV1 preserves GLOBAL_SAFE_FALLBACK state and registry when removeCSS fails', async () => {
  const chromeCalls = createChromeMock({ failRemoveCss: true });
  const fallbackCss = 'body :where(p) { line-height: 1.58; }';
  const registry = createRegistry({
    'fallback-css': { cssText: fallbackCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'fallback-css',
    frameId: 2,
    smartScope: {
      variant: 'GLOBAL_SAFE_FALLBACK',
      baseCssId: 'fallback-css',
      frameId: 2,
    },
    scopedV2: null,
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.FOCUS);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(result.details.cssRemovalFailures[0].label, 'base');
  assert.match(result.details.cssRemovalFailures[0].error, /remove failed/);
  assert.equal(chromeCalls.remove.length, 1);
  assert.deepEqual(chromeCalls.remove[0].target, { tabId: 7, frameIds: [2] });
  assert.deepEqual(registry.calls.remove, []);
  assert.equal(stateManager.calls.updates.length, 1);
  assert.equal(stateManager.calls.updates[0].state, STATES.ERROR);
  assert.deepEqual(stateManager.calls.updates[0].updates, { pendingDecision: false });
  assert.equal(stateManager.calls.smartScopeStatus[0].status.ok, false);
  assert.equal(stateManager.calls.smartScopeStatus[0].status.error, 'RESTORE_CSS_REMOVE_FAILED');
});

test('removeModeV1 removes dark GLOBAL_SAFE_FALLBACK from all frames', async () => {
  const chromeCalls = createChromeMock();
  const fallbackCss = 'body { background: #0b1020 !important; color: #e6e6e6 !important; }';
  const registry = createRegistry({
    'fallback-css': { cssText: fallbackCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'fallback-css',
    frameId: 0,
    smartScope: {
      variant: 'GLOBAL_SAFE_FALLBACK',
      baseCssId: 'fallback-css',
      frameId: 0,
      allFrames: true,
      darkModeEnabled: true,
    },
    scopedV2: null,
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.ok, true);
  const baseRemoval = chromeCalls.remove.find((call) => call.css === fallbackCss);
  assert.ok(baseRemoval);
  assert.deepEqual(baseRemoval.target, { tabId: 7, allFrames: true });
  assert.equal(chromeCalls.remove.some((call) => call.css === fallbackCss && call.target?.tabId === 7 && !call.target.frameIds && !call.target.allFrames), true);
  assert.deepEqual(registry.calls.remove, ['fallback-css']);
  assert.equal(stateManager.calls.updates.at(-1).state, STATES.INACTIVE);
});

test('refreshDarkComfortDocumentCss injects CSS only into the verified document', async () => {
  const chromeCalls = createChromeMock();
  const preludeCss = 'html, body { color-scheme: dark; }';
  const fallbackCss = 'body { background: #0b1020 !important; color: #e6e6e6 !important; }';
  const registry = createRegistry({
    'prelude-css': {
      cssText: preludeCss,
      origin: 'AUTHOR',
      meta: { variant: 'PRELUDE', allFrames: true },
    },
    'fallback-css': {
      cssText: fallbackCss,
      origin: 'USER',
      meta: { variant: 'GLOBAL_SAFE_FALLBACK', allFrames: true },
    },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'fallback-css',
    smartScope: {
      variant: 'GLOBAL_SAFE_FALLBACK',
      baseCssId: 'fallback-css',
      allFrames: true,
      darkModeEnabled: true,
    },
    scopedV2: {
      preludeCssId: 'prelude-css',
    },
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.refreshDarkComfortDocumentCss(7, {
    documentId: 'doc-main',
    frameId: 0,
    source: 'test',
  });

  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(chromeCalls.insert.length, 2);
  assert.deepEqual(chromeCalls.insert[0].target, { tabId: 7, documentIds: ['doc-main'] });
  assert.equal(chromeCalls.insert[0].origin, 'AUTHOR');
  assert.equal(chromeCalls.insert[0].css, preludeCss);
  assert.deepEqual(chromeCalls.insert[1].target, { tabId: 7, documentIds: ['doc-main'] });
  assert.equal(chromeCalls.insert[1].origin, 'USER');
  assert.equal(chromeCalls.insert[1].css, fallbackCss);
  assert.equal(stateManager.calls.updates.length, 1);
  assert.deepEqual(stateManager.calls.updates[0].updates.smartScope.globalDarkRuntime.documents, [{
    documentId: 'doc-main',
    frameId: 0,
    receiptId: 'receipt-main',
  }]);
  assert.equal(stateManager.calls.updates[0].updates.smartScope.allFrameRefreshCount, 1);
});

test('scoped prelude refresh records one bounded receipt per live document', async () => {
  const chromeCalls = createChromeMock();
  const preludeCss = 'html, body { color-scheme: dark; }';
  const registry = createRegistry({
    'prelude-css': {
      cssText: preludeCss,
      origin: 'AUTHOR',
      meta: { variant: 'PRELUDE', allFrames: true },
    },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    smartScope: {
      variant: 'SCOPED_V2',
      allFrames: false,
      darkModeEnabled: true,
    },
    scopedV2: {
      preludeCssId: 'prelude-css',
      preludeDocuments: [],
    },
  });
  const applier = new CssApplier(registry, stateManager, null);

  const first = await applier.refreshDarkComfortDocumentCss(7, {
    documentId: 'doc-main', frameId: 0, source: 'first-ready',
  });
  const repeated = await applier.refreshDarkComfortDocumentCss(7, {
    documentId: 'doc-main', frameId: 0, source: 'repeated-ready',
  });

  assert.equal(first.refreshed, true);
  assert.equal(repeated.refreshed, false);
  assert.equal(repeated.reason, 'document-already-refreshed');
  assert.equal(chromeCalls.insert.filter((call) => call.css === preludeCss).length, 1);
  assert.deepEqual(stateManager.calls.updates[0].updates.scopedV2.preludeDocuments, [{
    documentId: 'doc-main',
    frameId: 0,
  }]);
});

test('document refresh is idempotent beyond twenty notifications and targets a replacement document once', async () => {
  const chromeCalls = createChromeMock();
  const fallbackCss = 'body { background: #0b1020 !important; color: #e6e6e6 !important; }';
  const registry = createRegistry({
    'fallback-css': {
      cssText: fallbackCss,
      origin: 'USER',
      meta: { variant: 'GLOBAL_SAFE_FALLBACK', allFrames: true },
    },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'fallback-css',
    smartScope: {
      variant: 'GLOBAL_SAFE_FALLBACK',
      baseCssId: 'fallback-css',
      allFrames: true,
      darkModeEnabled: true,
      frameId: 0,
    },
    scopedV2: null,
  });
  const executeCalls = [];
  const activeReceipts = new Map();
  const visual = {
    backgroundColor: 'rgb(255, 255, 255)',
    surfaceColor: 'rgb(255, 255, 255)',
    textColor: 'rgb(17, 24, 39)',
    linkColor: 'rgb(29, 78, 216)',
    mutedTextColor: 'rgb(75, 85, 99)',
    prefersColorScheme: 'light',
  };
  chrome.scripting.executeScript = async (payload) => {
    executeCalls.push(payload);
    if (payload.files) return [];
    const documentId = payload.target?.documentIds?.[0];
    if (documentId && !payload.args) {
      const receiptId = activeReceipts.get(documentId) || null;
      return [{ frameId: 2, documentId, result: { active: Boolean(receiptId), receiptId, preimageAvailable: Boolean(receiptId) } }];
    }
    if (documentId && payload.args) {
      const receiptId = payload.args[1];
      activeReceipts.set(documentId, receiptId);
      return [{ frameId: 2, documentId, result: { ok: true, active: true, receiptId } }];
    }
    return [{ frameId: 2, documentId: 'doc-frame-a', result: visual }];
  };

  const applier = new CssApplier(registry, stateManager, null);
  for (let index = 0; index < 25; index += 1) {
    const result = await applier.refreshDarkComfortDocumentCss(7, {
      documentId: 'doc-frame-a', frameId: 2, source: 'test-repeat',
    });
    assert.equal(result.ok, true);
  }
  assert.equal(chromeCalls.insert.filter((call) => call.css === fallbackCss).length, 1);
  assert.equal(chromeCalls.insert.some((call) => call.target?.allFrames === true), false);
  assert.deepEqual(chromeCalls.insert[0].target, { tabId: 7, documentIds: ['doc-frame-a'] });

  chrome.scripting.executeScript = async (payload) => {
    executeCalls.push(payload);
    if (payload.files) return [];
    const documentId = payload.target?.documentIds?.[0];
    if (documentId && !payload.args) return [{ frameId: 2, documentId, result: { active: false, receiptId: null, preimageAvailable: false } }];
    if (documentId && payload.args) return [{ frameId: 2, documentId, result: { ok: true, active: true, receiptId: payload.args[1] } }];
    return [{ frameId: 2, documentId: 'doc-frame-b', result: visual }];
  };
  const replacement = await applier.refreshDarkComfortDocumentCss(7, {
    documentId: 'doc-frame-b', frameId: 2, source: 'iframe-reload',
  });
  assert.equal(replacement.ok, true);
  assert.equal(chromeCalls.insert.filter((call) => call.css === fallbackCss).length, 2);
  assert.deepEqual(chromeCalls.insert.at(-1).target, { tabId: 7, documentIds: ['doc-frame-b'] });
  assert.equal(chromeCalls.insert.some((call) => call.target?.documentIds?.includes('doc-frame-a') && call.target?.documentIds?.includes('doc-frame-b')), false);
});

test('removeModeV1 does not use telemetry refresh counts as cleanup authority', async () => {
  const chromeCalls = createChromeMock();
  const fallbackCss = 'body { background: #0b1020 !important; color: #e6e6e6 !important; }';
  const registry = createRegistry({
    'fallback-css': {
      cssText: fallbackCss,
      origin: 'USER',
    },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'fallback-css',
    frameId: 0,
    smartScope: {
      variant: 'GLOBAL_SAFE_FALLBACK',
      baseCssId: 'fallback-css',
      frameId: 0,
      allFrames: true,
      allFrameRefreshCount: 2,
      darkModeEnabled: true,
    },
    scopedV2: null,
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.ok, true);
  const fallbackRemovals = chromeCalls.remove.filter((call) => call.css === fallbackCss);
  assert.equal(fallbackRemovals.length, 2);
  assert.equal(fallbackRemovals.filter((call) => call.target?.allFrames === true).length, 1);
  assert.equal(
    fallbackRemovals.filter((call) => call.target?.tabId === 7 && !call.target?.allFrames && !call.target?.frameIds).length,
    1,
  );
});

test('removeModeV1 keeps all registry entries when base removal fails after patch removal succeeds', async () => {
  const chromeCalls = createChromeMock();
  const patchCss = '.aura-scope { color: #f5f5f5 !important; }';
  const baseCss = 'body { --aura-v1-base: 1; }';
  chrome.scripting.removeCSS = async (payload) => {
    chromeCalls.remove.push(payload);
    if (payload.css === baseCss) {
      throw new Error('base remove failed');
    }
  };
  const registry = createRegistry({
    'patch-css': { cssText: patchCss, origin: 'AUTHOR' },
    'base-css': { cssText: baseCss, origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'patch-css',
    smartScope: {
      cssId: 'patch-css',
      baseCssId: 'base-css',
      variant: 'SCOPED',
      intensity: 1,
    },
  });

  const applier = new CssApplier(registry, stateManager, null);
  const result = await applier.removeModeV1(7, MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(chromeCalls.remove.length, 2);
  assert.deepEqual(registry.calls.remove, []);
  assert.equal(stateManager.calls.updates.length, 1);
  assert.equal(stateManager.calls.updates[0].state, STATES.ERROR);
  assert.deepEqual(stateManager.calls.updates[0].updates, { pendingDecision: false });
  assert.equal(stateManager.calls.smartScopeStatus[0].status.ok, false);
  assert.match(stateManager.calls.smartScopeStatus[0].status.detail, /base:base remove failed/);
});

test('applyModeScopedV2 pre-cleans legacy v1 state with removeModeV1', async () => {
  createChromeMock();
  const registry = createRegistry({
    'base-css': { cssText: 'body { --legacy: 1; }', origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'base-css',
    frameId: 6,
    smartScope: null,
    scopedV2: null,
  });
  const monitor = { isDegradedTriggered: async () => false };
  const applier = new CssApplier(registry, stateManager, monitor);
  const stopAfterCleanup = new Error('stop-after-cleanup');
  const calls = { v1: [], scopedV2: [] };

  applier.removeModeV1 = async (tabId, modeId) => {
    calls.v1.push({ tabId, modeId });
    throw stopAfterCleanup;
  };
  applier.removeModeScopedV2 = async (tabId, modeId, options) => {
    calls.scopedV2.push({ tabId, modeId, options });
  };

  await assert.rejects(
    () => applier._applyModeScopedV2(7, MODE_IDS.COMFORT_VISUAL, { frameId: 6 }, 'test', 1),
    stopAfterCleanup,
  );

  assert.deepEqual(calls.v1, [{ tabId: 7, modeId: MODE_IDS.COMFORT_VISUAL }]);
  assert.deepEqual(calls.scopedV2, []);
});

test('applyModeScopedV2 aborts when pre-apply cleanup reports failure', async () => {
  createChromeMock();
  const registry = createRegistry({
    'base-css': { cssText: 'body { --legacy: 1; }', origin: 'AUTHOR' },
  });
  const stateManager = createStateManager({
    state: STATES.ACTIVE,
    cssId: 'base-css',
    frameId: 6,
    smartScope: null,
    scopedV2: null,
  });
  const monitor = { isDegradedTriggered: async () => false };
  const applier = new CssApplier(registry, stateManager, monitor);

  applier.removePreludeCss = async () => ({ ok: true });
  applier.removeModeV1 = async () => ({
    ok: false,
    reason: 'RESTORE_CSS_REMOVE_FAILED',
    detail: 'base remove failed',
  });

  const result = await applier._applyModeScopedV2(7, MODE_IDS.COMFORT_VISUAL, { frameId: 6 }, 'test', 1);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESTORE_CSS_REMOVE_FAILED');
  assert.match(result.detail, /PRE_APPLY_CLEANUP_FAILED/);
  assert.equal(registry.calls.register.length, 0);
  assert.equal(stateManager.calls.smartScopeStatus.at(-1).status.ok, false);
});

test('applyModeV1 persists distinct base and SmartScope patch CSS ids', async () => {
  createChromeMock();
  const registry = createRegistry({});
  const stateManager = createStateManager(null);
  const monitor = {
    isDegradedTriggered: async () => false,
    measureHeapDelta: async (fn) => fn(),
    measureLatency: async (fn) => fn(),
  };
  const originalSafeSend = contentBridge.safeSend;

  try {
    contentBridge.safeSend = async (tabId, message) => {
      assert.equal(tabId, 7);
      if (message.action === 'SMARTSCOPE_GET_PROFILE_V1') {
        return {
          ok: true,
          data: {
            ok: true,
            profile: {
              scopeSelector: 'main',
              reason: 'test',
              score: 0.9,
            },
          },
        };
      }

      if (message.action === 'SMARTSCOPE_APPLY_CLASSES_V1') {
        return { ok: true, data: { ok: true, applied: ['aura-scope'] } };
      }

      if (message.action === 'SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1') {
        return { ok: true, data: { allPassed: true } };
      }

      return { ok: true, data: { ok: true } };
    };

    const applier = new CssApplier(registry, stateManager, monitor);
    const result = await applier.applyModeV1(7, MODE_IDS.COMFORT_VISUAL, { intensity: 1, frameId: 5 }, 'test');

    assert.equal(result.ok, true);
    assert.equal(registry.calls.register.length, 2);

    const update = stateManager.calls.updates.at(-1);
    assert.equal(update.state, STATES.ACTIVE);
    assert.equal(update.updates.cssId, 'css-2');
    assert.equal(update.updates.frameId, 5);
    assert.equal(update.updates.smartScope.cssId, 'css-2');
    assert.equal(update.updates.smartScope.patchCssId, 'css-2');
    assert.equal(update.updates.smartScope.baseCssId, 'css-1');
    assert.equal(update.updates.smartScope.darkModeEnabled, true);
    assert.equal(update.updates.smartScope.frameId, 5);
    assert.match(registry.calls.register[1].cssText, /aura-scope \{ color-scheme: dark/);
    assert.match(registry.calls.register[1].cssText, /background-color:\s*#0f1116/i);
    assert.doesNotMatch(registry.calls.register[1].cssText, /body\s*\{[^}]*background-color/i);
  } finally {
    contentBridge.safeSend = originalSafeSend;
  }
});

test('applyModeV1 rolls back SmartScope patch CSS when class application fails', async () => {
  const chromeCalls = createChromeMock();
  const registry = createRegistry({});
  const stateManager = createStateManager(null);
  const monitor = {
    isDegradedTriggered: async () => false,
    measureHeapDelta: async (fn) => fn(),
    measureLatency: async (fn) => fn(),
  };
  const originalSafeSend = contentBridge.safeSend;
  const sentActions = [];

  try {
    contentBridge.safeSend = async (tabId, message) => {
      assert.equal(tabId, 7);
      sentActions.push(message.action);

      if (message.action === 'SMARTSCOPE_GET_PROFILE_V1') {
        return {
          ok: true,
          data: {
            ok: true,
            profile: {
              scopeSelector: 'main',
              reason: 'test',
              score: 0.9,
            },
          },
        };
      }

      if (message.action === 'SMARTSCOPE_APPLY_CLASSES_V1') {
        return { ok: true, data: { ok: false, error: 'class-apply-failed' } };
      }

      return { ok: true, data: { ok: true } };
    };

    const applier = new CssApplier(registry, stateManager, monitor);
    const result = await applier.applyModeV1(7, MODE_IDS.COMFORT_VISUAL, { intensity: 1 }, 'test');

    assert.equal(result.ok, true);
    assert.equal(result.cssId, 'css-1');
    assert.equal(result.variant, 'STRICT');
    assert.equal(registry.calls.register.length, 4);
    assert.deepEqual(registry.calls.remove, ['css-2', 'css-3', 'css-4']);
    assert.equal(chromeCalls.remove.length, 3);
    assert.ok(chromeCalls.remove.every((call) => call.target.tabId === 7));
    assert.ok(!sentActions.includes('SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1'));

    const update = stateManager.calls.updates.at(-1);
    assert.equal(update.state, STATES.ACTIVE);
    assert.equal(update.updates.cssId, 'css-1');
    assert.equal(update.updates.smartScope.cssId, null);
    assert.equal(update.updates.smartScope.patchCssId, null);
    assert.equal(update.updates.smartScope.baseCssId, 'css-1');
    assert.equal(update.updates.smartScope.variantReason, 'fallback:all-variants-failed');
  } finally {
    contentBridge.safeSend = originalSafeSend;
  }
});
