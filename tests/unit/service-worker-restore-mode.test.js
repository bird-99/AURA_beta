import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { cssApplier } from '../../background/css-applier.js';
import { ACTIONS, ACTIVE_QUALITIES, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import { __resetFeatureFlagCacheForTests } from '../../shared/feature-flags.js';

function createEventTarget(capture) {
  return {
    addListener: (listener) => {
      if (capture) {
        capture(listener);
      }
    },
    removeListener: () => {},
    hasListener: () => false,
  };
}

function createStorageArea(initial = {}) {
  const store = { ...initial };
  return {
    get: async (key) => {
      if (key == null) {
        return { ...store };
      }
      if (typeof key === 'string') {
        return { [key]: store[key] };
      }
      if (Array.isArray(key)) {
        return Object.fromEntries(key.map((item) => [item, store[item]]));
      }
      return { ...key, ...store };
    },
    set: async (values) => {
      Object.assign(store, values || {});
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete store[key];
      }
    },
    setAccessLevel: async () => {},
  };
}

function installChromeMock({ tabs = [], sessionInitial = {}, failRemoveCss = false } = {}) {
  let runtimeMessageListener = null;
  let tabRemovedListener = null;
  let tabReplacedListener = null;
  const tabMessages = [];
  const scriptExecutions = [];
  const noopEvent = createEventTarget();
  const local = createStorageArea({
    [STORAGE_KEYS.USER_PREFS]: {
      smartScope: {
        enabled: true,
        level: 'conservative',
        perDomain: {},
        debugEnabled: false,
      },
    },
  });
  const session = createStorageArea(sessionInitial);

  global.chrome = {
    action: {
      setBadgeText: async () => {},
    },
    permissions: {
      contains: async () => false,
    },
    runtime: {
      getURL: (path) => `chrome-extension://aura-test/${path}`,
      onInstalled: noopEvent,
      onMessage: createEventTarget((listener) => {
        runtimeMessageListener = listener;
      }),
      onStartup: noopEvent,
    },
    scripting: {
      executeScript: async (details) => {
        scriptExecutions.push(details);
        return [{
          frameId: 0,
          documentId: 'restore-test-chrome-document',
          result: String(details.func).includes('__AURA_DOCUMENT_INSTANCE_ID__')
            ? {
                url: 'https://example.com/article',
                documentInstanceId: 'restore-test-document',
              }
            : null,
        }];
      },
      insertCSS: async () => {},
      removeCSS: async () => {
        if (failRemoveCss) {
          throw new Error('simulated removeCSS failure');
        }
      },
    },
    storage: {
      local,
      session,
      onChanged: noopEvent,
    },
    tabs: {
      create: async () => ({}),
      get: async (tabId) => ({ id: tabId, url: 'https://example.com/article' }),
      query: async () => tabs,
      sendMessage: async (tabId, message, optionsOrCallback, callback) => {
        tabMessages.push({ tabId, message });
        const response = { ok: true };
        const done = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (typeof done === 'function') {
          done(response);
        }
        return response;
      },
      onActivated: noopEvent,
      onRemoved: createEventTarget((listener) => {
        tabRemovedListener = listener;
      }),
      onReplaced: createEventTarget((listener) => {
        tabReplacedListener = listener;
      }),
      onUpdated: noopEvent,
      onZoomChange: noopEvent,
    },
    webNavigation: {
      onHistoryStateUpdated: noopEvent,
    },
  };
  global.self = {
    addEventListener: () => {},
  };

  return {
    getRuntimeMessageListener: () => runtimeMessageListener,
    getTabRemovedListener: () => tabRemovedListener,
    getTabReplacedListener: () => tabReplacedListener,
    getTabMessages: () => [...tabMessages],
    getScriptExecutions: () => [...scriptExecutions],
    getSession: async () => chrome.storage.session.get(null),
  };
}

afterEach(() => {
  delete global.chrome;
  delete global.self;
  __resetFeatureFlagCacheForTests();
});

test('RESTORE_MODE reports removeMode ok=false instead of succeeding', async () => {
  const chromeMock = installChromeMock();
  const originalRemoveMode = cssApplier.removeMode;
  cssApplier.removeMode = async () => ({
    ok: false,
    reason: 'RESTORE_CSS_REMOVE_FAILED',
    retryable: true,
    details: { cssRemoved: false },
  });

  try {
    await import(`../../background/service-worker.js?restore-mode-test=${Date.now()}`);
    const listener = chromeMock.getRuntimeMessageListener();
    assert.equal(typeof listener, 'function');

    const response = await new Promise((resolve) => {
      const keepAlive = listener(
        {
          action: ACTIONS.RESTORE_MODE,
          tabId: 123,
          modeId: MODE_IDS.FOCUS,
        },
        {},
        resolve,
      );
      assert.equal(keepAlive, true);
    });

    assert.equal(response.ok, false);
    assert.equal(response.error, 'RESTORE_CSS_REMOVE_FAILED');
    assert.equal(response.reason, 'RESTORE_CSS_REMOVE_FAILED');
    assert.equal(response.retryable, true);
    assert.deepEqual(response.details, { cssRemoved: false });
    assert.equal(
      chromeMock.getScriptExecutions().some((entry) => String(entry.func).includes('__AURA_DOCUMENT_INSTANCE_ID__')),
      true,
    );
    assert.deepEqual(chromeMock.getTabMessages(), []);
  } finally {
    cssApplier.removeMode = originalRemoveMode;
  }
});

test('RESTORE_MODE keeps ERROR and cleanup handles after a real retryable CSS removal failure', async () => {
  const cssId = 'css-restore-retry';
  const chromeMock = installChromeMock({
    failRemoveCss: true,
    sessionInitial: {
      [STORAGE_KEYS.CSS_REGISTRY]: {
        [cssId]: {
          cssId,
          cssHash: 'hash-restore-retry',
          cssText: '[data-aura-scope="1"] { color: red; }',
          origin: 'AUTHOR',
          meta: { tabId: 123, modeId: MODE_IDS.FOCUS, createdAt: Date.now() },
        },
      },
      [STORAGE_KEYS.TAB_STATE]: {
        123: {
          [MODE_IDS.FOCUS]: {
            state: STATES.ACTIVE,
            activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
            cssId,
            scopedV2: {
              cssId,
              frameId: 0,
              scopeSelector: 'main',
              owner: 'aura-mode-engine-v2',
            },
          },
        },
      },
    },
  });

  await import(`../../background/service-worker.js?restore-mode-real-failure=${Date.now()}`);
  const listener = chromeMock.getRuntimeMessageListener();
  const response = await new Promise((resolve) => {
    const keepAlive = listener(
      { action: ACTIONS.RESTORE_MODE, tabId: 123, modeId: MODE_IDS.FOCUS },
      {},
      resolve,
    );
    assert.equal(keepAlive, true);
  });

  assert.equal(response.ok, false);
  assert.equal(response.reason, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(response.retryable, true);

  const session = await chromeMock.getSession();
  const modeState = session[STORAGE_KEYS.TAB_STATE][123][MODE_IDS.FOCUS];
  assert.equal(modeState.state, STATES.ERROR);
  assert.equal(modeState.activeQuality, null);
  assert.equal(modeState.pendingDecision, false);
  assert.equal(modeState.cssId, cssId);
  assert.equal(modeState.scopedV2.cssId, cssId);
  assert.equal(session[STORAGE_KEYS.CSS_REGISTRY][cssId].cssText, '[data-aura-scope="1"] { color: red; }');
  assert.equal(session[STORAGE_KEYS.LIFECYCLE_JOURNAL_V1].tabs['123'].running.phase, 'RETRYABLE');
});

test('startup registry cleanup preserves CSS referenced only by scopedV2.preludeCssId', async () => {
  const cssId = 'css-prelude-only';
  const chromeMock = installChromeMock({
    sessionInitial: {
      [STORAGE_KEYS.CSS_REGISTRY]: {
        [cssId]: {
          cssId,
          cssHash: 'hash-prelude-only',
          cssText: 'html { color-scheme: dark; }',
          origin: 'AUTHOR',
          meta: { tabId: 123, modeId: MODE_IDS.COMFORT_VISUAL, createdAt: 1 },
        },
      },
      [STORAGE_KEYS.TAB_STATE]: {
        123: {
          [MODE_IDS.COMFORT_VISUAL]: {
            state: STATES.ACTIVE,
            activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
            scopedV2: { preludeCssId: cssId },
          },
        },
      },
    },
  });

  await import(`../../background/service-worker.js?prelude-registry-preservation=${Date.now()}`);
  const listener = chromeMock.getRuntimeMessageListener();
  await new Promise((resolve) => {
    const keepAlive = listener(
      { action: ACTIONS.GET_STATE, tabId: 123, modeId: MODE_IDS.COMFORT_VISUAL },
      {},
      resolve,
    );
    assert.equal(keepAlive, true);
  });

  const session = await chromeMock.getSession();
  assert.equal(session[STORAGE_KEYS.CSS_REGISTRY][cssId].cssText, 'html { color-scheme: dark; }');
});

test('SMARTSCOPE_RESET_V1 preserves retryable remove failures for later restore', async () => {
  const chromeMock = installChromeMock({
    tabs: [{ id: 123, url: 'https://example.com/article' }],
    sessionInitial: {
      [STORAGE_KEYS.CSS_REGISTRY]: {
        'css-1': { cssText: 'body{outline:1px solid red}', origin: 'AUTHOR' },
      },
      [STORAGE_KEYS.TAB_STATE]: {
        123: {
          [MODE_IDS.COMFORT_VISUAL]: {
            state: 'ERROR',
            cssId: 'css-1',
            smartScope: {
              baseCssId: 'css-1',
              scopeKey: 'body',
            },
          },
        },
      },
    },
  });
  const originalRemoveMode = cssApplier.removeMode;
  cssApplier.removeMode = async () => ({
    ok: false,
    reason: 'RESTORE_CSS_REMOVE_FAILED',
    retryable: true,
  });

  try {
    await import(`../../background/service-worker.js?smartscope-reset-test=${Date.now()}`);
    const listener = chromeMock.getRuntimeMessageListener();
    assert.equal(typeof listener, 'function');

    const response = await new Promise((resolve) => {
      const keepAlive = listener(
        {
          action: ACTIONS.SMARTSCOPE_RESET_V1,
        },
        {},
        resolve,
      );
      assert.equal(keepAlive, true);
    });

    assert.equal(response.ok, false);
    assert.equal(response.cleanedTabs, 0);
    assert.match(response.errors.join(','), /RESTORE_CSS_REMOVE_FAILED/);
    assert.deepEqual(chromeMock.getTabMessages(), []);
    const session = await chromeMock.getSession();
    assert.ok(session[STORAGE_KEYS.CSS_REGISTRY]);
    assert.equal(session[STORAGE_KEYS.TAB_STATE][123][MODE_IDS.COMFORT_VISUAL].cssId, 'css-1');
    assert.equal(session[STORAGE_KEYS.TAB_STATE][123][MODE_IDS.COMFORT_VISUAL].smartScope.baseCssId, 'css-1');
  } finally {
    cssApplier.removeMode = originalRemoveMode;
  }
});

test('SMARTSCOPE_RESET_V1 stops tab cleanup after a mixed retryable remove failure', async () => {
  const chromeMock = installChromeMock({
    tabs: [{ id: 123, url: 'https://example.com/article' }],
    sessionInitial: {
      [STORAGE_KEYS.CSS_REGISTRY]: {
        'css-1': { cssText: 'body{outline:1px solid red}', origin: 'AUTHOR' },
      },
    },
  });
  const originalRemoveMode = cssApplier.removeMode;
  const removeCalls = [];
  cssApplier.removeMode = async (_tabId, modeId) => {
    removeCalls.push(modeId);
    if (modeId === MODE_IDS.COMFORT_VISUAL) {
      return {
        ok: false,
        reason: 'RESTORE_CSS_REMOVE_FAILED',
        retryable: true,
      };
    }
    return { ok: true };
  };

  try {
    await import(`../../background/service-worker.js?smartscope-reset-mixed-test=${Date.now()}`);
    const listener = chromeMock.getRuntimeMessageListener();
    assert.equal(typeof listener, 'function');

    const response = await new Promise((resolve) => {
      const keepAlive = listener(
        {
          action: ACTIONS.SMARTSCOPE_RESET_V1,
        },
        {},
        resolve,
      );
      assert.equal(keepAlive, true);
    });

    assert.equal(response.ok, false);
    assert.deepEqual(removeCalls, [MODE_IDS.COMFORT_VISUAL]);
    assert.deepEqual(chromeMock.getTabMessages(), []);
    const session = await chromeMock.getSession();
    assert.ok(session[STORAGE_KEYS.CSS_REGISTRY]);
  } finally {
    cssApplier.removeMode = originalRemoveMode;
  }
});

test('tab removal and replacement clear lifecycle journal slots without waiting for initOnce', async () => {
  const chromeMock = installChromeMock();
  const { lifecycleOperationJournal, LIFECYCLE_OPERATION_KINDS } = await import(
    '../../background/lifecycle-operation-journal.js'
  );
  const { STATES } = await import('../../shared/constants.js');
  for (const tabId of [501, 502]) {
    const intent = await lifecycleOperationJournal.claimIntent({
      tabId,
      modeId: MODE_IDS.FOCUS,
      kind: LIFECYCLE_OPERATION_KINDS.APPLY,
      targetState: STATES.ACTIVE,
      documentInstanceId: `document-${tabId}`,
      chromeDocumentId: `chrome-document-${tabId}`,
    });
    await lifecycleOperationJournal.begin(intent);
  }

  await import(`../../background/service-worker.js?tab-disposal-test=${Date.now()}`);
  chromeMock.getTabRemovedListener()(501);
  chromeMock.getTabReplacedListener()(600, 502);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const first = await lifecycleOperationJournal.getTabSlot(501);
    const second = await lifecycleOperationJournal.getTabSlot(502);
    if (!first.slot?.running && !second.slot?.running) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal((await lifecycleOperationJournal.getTabSlot(501)).slot?.running, null);
  assert.equal((await lifecycleOperationJournal.getTabSlot(502)).slot?.running, null);
});
