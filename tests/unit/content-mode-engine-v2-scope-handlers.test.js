import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../../content/content-bootstrap.runtime.js';
import '../../content/content-message-router.runtime.js';

import {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_ENGINE_FLAG_DEFAULTS,
  MODE_IDS,
  MODES,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  STORAGE_KEYS,
} from '../../shared/constants.js';

const fixtureBase = path.join(process.cwd(), 'tests', 'fixtures');
const smartScopeUrl = pathToFileURL(path.join(fixtureBase, 'stub-smartscope-v2.js')).toString();
const SHARED_CONSTANTS_REQUEST_TYPE = 'AURA_GET_SHARED_CONSTANTS_V1';
const FEATURE_FLAGS_REQUEST_TYPE = 'AURA_GET_FEATURE_FLAGS_V1';

const constantsPayload = {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_ENGINE_FLAG_DEFAULTS,
  MODE_IDS,
  MODES,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  STORAGE_KEYS,
};

class StubElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.isConnected = true;
    this.computedStyle = {};
    this.dataset = {};
    this.style = {
      setProperty: (name, value, priority = '') => {
        this.style[name] = String(value);
        this.style[`${name}Priority`] = String(priority || '');
      },
      removeProperty: (name) => {
        delete this.style[name];
        delete this.style[`${name}Priority`];
      },
      getPropertyValue: (name) => {
        return this.style[name] || '';
      },
      getPropertyPriority: (name) => {
        return this.style[`${name}Priority`] || '';
      },
    };
    this.classList = new Set();
    this.attributes = new Map();
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelector() {
    return this.querySelectorAll()[0] || null;
  }

  querySelectorAll(selector = '') {
    const matches = [];
    const visit = (element) => {
      if (element !== this && element.matches(selector)) {
        matches.push(element);
      }
      for (const child of element.children || []) {
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  getElementsByTagName() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector = '') {
    const selectors = String(selector).split(',').map((item) => item.trim()).filter(Boolean);
    return selectors.some((item) => {
      if (item === 'a[href]') return this.tagName === 'A' && this.attributes.has('href');
      if (item === '[role="link"]') return this.getAttribute('role') === 'link';
      if (item === 'label') return this.tagName === 'LABEL';
      if (item === 'legend') return this.tagName === 'LEGEND';
      if (item === '[aria-label]') return this.attributes.has('aria-label');
      if (item === 'input') return this.tagName === 'INPUT';
      if (item === 'select') return this.tagName === 'SELECT';
      if (item === 'textarea') return this.tagName === 'TEXTAREA';
      if (item === 'button') return this.tagName === 'BUTTON';
      if (item === '[role="checkbox"]') return this.getAttribute('role') === 'checkbox';
      if (item === '[role="radio"]') return this.getAttribute('role') === 'radio';
      return item.toUpperCase() === this.tagName;
    });
  }
}

class StubDocument {
  constructor() {
    this.body = new StubElement('body');
    this.documentElement = { dataset: {} };
  }

  addEventListener() {}

  removeEventListener() {}

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getElementById() {
    return null;
  }

  createElement() {
    return new StubElement();
  }
}

function setupGlobals({
  featureFlags = {},
  runtimeMessageResponse = null,
  debugTestHooks = true,
  isTopFrame = true,
} = {}) {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
  delete global.getComputedStyle;
  delete global.MutationObserver;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
  delete global.AURA_DARK_COMFORT_THEME_RUNTIME;

  const versionTag = Math.random().toString(36).slice(2);
  const taggedSmartScopeUrl = `${smartScopeUrl}?v=${versionTag}`;

  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.Element = StubElement;
  global.performance = { now: () => 0 };

  global.window = {
    location: { href: 'https://example.test' },
    getSelection: () => ({ rangeCount: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: (element) => ({
      textDecorationLine: element?.computedStyle?.textDecorationLine || 'none',
      textDecorationColor: element?.computedStyle?.textDecorationColor || 'rgb(0, 0, 0)',
      textDecorationThickness: element?.computedStyle?.textDecorationThickness || 'auto',
      textUnderlineOffset: element?.computedStyle?.textUnderlineOffset || 'auto',
      color: element?.computedStyle?.color || 'rgb(0, 0, 0)',
      backgroundColor: element?.computedStyle?.backgroundColor || 'rgba(0, 0, 0, 0)',
      outlineColor: element?.computedStyle?.outlineColor || 'rgb(0, 0, 0)',
      outlineStyle: element?.computedStyle?.outlineStyle || 'none',
      outlineWidth: element?.computedStyle?.outlineWidth || '0px',
      caretColor: element?.computedStyle?.caretColor || 'auto',
      accentColor: element?.computedStyle?.accentColor || 'auto',
      boxShadow: element?.computedStyle?.boxShadow || 'none',
      getPropertyValue: () => '',
    }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    requestAnimationFrame: (callback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
  };
  global.window.top = isTopFrame ? global.window : {};
  global.getComputedStyle = global.window.getComputedStyle;
  global.requestAnimationFrame = global.window.requestAnimationFrame;
  global.cancelAnimationFrame = global.window.cancelAnimationFrame;

  global.document = new StubDocument();

  const storage = { local: { featureFlags: {} }, session: {} };

  global.chrome = {
    runtime: {
      id: 'aura-test',
      getURL: (modulePath) => {
        switch (modulePath) {
          case 'shared/smartscope-v2.js':
            return taggedSmartScopeUrl;
          default:
            return modulePath;
        }
      },
      sendMessage: (message, callback) => {
        if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
          callback?.({ ok: true, constants: constantsPayload });
          return;
        }
        if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
          const response = {
            ok: true,
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, ...featureFlags, debugTestHooks },
          };
          callback?.(response);
          return response;
        }
        const response = typeof runtimeMessageResponse === 'function'
          ? runtimeMessageResponse(message)
          : { tabId: 1 };
        callback?.(response);
        return response;
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: storage.local[key] };
        },
        async set(entries) {
          Object.assign(storage.local, entries);
        },
      },
      session: {
        async get(key) {
          return { [key]: storage.session[key] };
        },
        async set(entries) {
          Object.assign(storage.session, entries);
        },
      },
      onChanged: { addListener: () => {} },
    },
    tabs: { get: async () => ({ id: 1 }) },
  };
}

async function waitForTestHook(getter, { timeoutMs = 2000, stepMs = 5, label = 'test hook' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getter();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`waitForTestHook timed out after ${timeoutMs}ms waiting for ${label}`);
}

async function loadContentMain() {
  await import(`../../content/content-main.js?run=${Date.now()}`);
  return waitForTestHook(() => global.window?.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__, {
    label: '__AURA_CONTENT_MAIN_MESSAGE_LISTENER__',
  });
}

function sendMessage(listener, message) {
  return new Promise((resolve, reject) => {
    let responseCount = 0;
    let firstResponse;
    let settleTimer = null;
    const timeoutTimer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${message?.action || message?.type || 'message'} response`));
    }, 2000);
    const claimed = listener(message, {}, (response) => {
      responseCount += 1;
      if (responseCount > 1) {
        clearTimeout(timeoutTimer);
        clearTimeout(settleTimer);
        reject(new Error(`${message?.action || message?.type || 'message'} responded more than once`));
        return;
      }
      firstResponse = response;
      settleTimer = setTimeout(() => {
        clearTimeout(timeoutTimer);
        resolve(firstResponse);
      }, 0);
    });
    assert.equal(claimed, true, `${message?.action || message?.type || 'message'} must be claimed`);
  });
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
  delete global.getComputedStyle;
  delete global.MutationObserver;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
  delete global.AURA_DARK_COMFORT_THEME_RUNTIME;
});

test('MODE_ENGINE_V2_VERIFY_SCOPE_ROOT reports missing runtime', async () => {
  setupGlobals();
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT,
    selector: '.article',
  });

  assert.deepEqual(response, {
    ok: false,
    error: 'INTERNAL_ERROR',
    detail: 'scoped-verifier-runtime-missing',
    source: 'verifyScopeRoot',
  });
});

test('MODE_ENGINE_V2_VERIFY_SCOPE_ROOT rejects invalid selector', async () => {
  setupGlobals();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: () => ({ ok: true }),
  };
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT,
    selector: '   ',
  });

  assert.deepEqual(response, {
    ok: false,
    error: 'VERIFY_SCOPE_ROOT_FAILED',
    detail: 'invalid-selector',
    source: 'verifyScopeRoot',
  });
});

test('MODE_ENGINE_V2_SET_SCOPE_ROOT rejects invalid selectors', async () => {
  setupGlobals();
  global.document.querySelector = () => {
    throw new Error('Invalid selector');
  };
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: 'div[',
  });

  assert.deepEqual(response, {
    ok: false,
    reason: 'invalid-selector',
  });
});

test('MODE_ENGINE_V2_SET_SCOPE_ROOT rejects missing elements', async () => {
  setupGlobals();
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: '.missing',
  });

  assert.deepEqual(response, {
    ok: false,
    reason: 'ELEMENT_NOT_FOUND',
  });
});

test('MODE_ENGINE_V2_SET_SCOPE_ROOT rejects trivial scope', async () => {
  setupGlobals();
  global.document.querySelector = () => global.document.body;
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: 'body',
  });

  assert.deepEqual(response, {
    ok: false,
    reason: 'TRIVIAL_SCOPE',
  });
});

test('MODE_ENGINE_V2_SET_SCOPE_ROOT applies scope token on match', async () => {
  setupGlobals();
  const root = new StubElement('main');
  global.document.querySelector = () => root;
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: 'main',
  });

  assert.deepEqual(response, { ok: true });
  assert.equal(root.getAttribute('data-aura-scope'), '1');
  assert.equal(root.getAttribute('data-aura-scope-owner'), 'aura-me2');
});

test('MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT passes debugEnabled payload', async () => {
  setupGlobals();
  let receivedDebugEnabled = null;
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: () => ({ ok: true }),
    salvageScopeRootBySelector: (selector, debugEnabled) => {
      receivedDebugEnabled = debugEnabled;
      return { ok: true, tried: true, selector, reason: 'OK' };
    },
  };
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT,
    selector: '.article',
    debugEnabled: { debugEnabled: true },
  });

  assert.deepEqual(receivedDebugEnabled, { debugEnabled: true });
  assert.deepEqual(response, {
    ok: true,
    tried: true,
    selector: '.article',
    reason: 'OK',
    source: 'salvageScopeRoot',
  });
});

test('MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS preserves owned scope until final cleanup', async () => {
  setupGlobals();
  await import('../../content/mode-engine-scoped-v2.runtime.js');
  const listener = await loadContentMain();

  const scopeRoot = new StubElement('main');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  scopeRoot.setAttribute('data-aura-scope-tokens', '--aura-font-size,--aura-line-height');
  scopeRoot.style.setProperty('--aura-font-size', '18px');
  scopeRoot.style.setProperty('--aura-line-height', '1.8');

  global.window.AURA.modeEngineScopeRoot = scopeRoot;
  global.window.AURA.modeEngineScopeTokens = ['--aura-font-size', '--aura-line-height'];

  const preserved = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    preserveScope: true,
  });

  assert.equal(preserved.ok, true);
  assert.equal(preserved.scopeUnmarked, false);
  assert.equal(scopeRoot.getAttribute('data-aura-scope'), '1');
  assert.equal(scopeRoot.getAttribute('data-aura-scope-owner'), 'aura-me2');
  assert.equal(scopeRoot.getAttribute('data-aura-scope-tokens'), null);
  assert.equal(scopeRoot.style['--aura-font-size'], undefined);
  assert.equal(scopeRoot.style['--aura-line-height'], undefined);
  assert.deepEqual(global.window.AURA.modeEngineScopeTokens, []);

  const removed = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    preserveScope: false,
  });

  assert.equal(removed.ok, true);
  assert.equal(removed.scopeUnmarked, true);
  assert.equal(scopeRoot.getAttribute('data-aura-scope'), null);
  assert.equal(scopeRoot.getAttribute('data-aura-scope-owner'), null);
});

test('MODE_ENGINE_V2_APPLY_SCOPE_TOKENS does not start dark runtime without executor flag', async () => {
  setupGlobals();
  let darkRuntimeApplyCalls = 0;
  let darkRuntimeExecutorActive = null;
  let appliedTokenKeys = [];
  let mutationObservers = 0;
  global.MutationObserver = class {
    constructor() {
      mutationObservers += 1;
    }
    observe() {}
    disconnect() {}
  };
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyScopedTokens: (_scopeRoot, tokenMap) => {
      appliedTokenKeys = Object.keys(tokenMap || {});
      return {
        ok: true,
        applied: appliedTokenKeys.length,
        ownedKeys: appliedTokenKeys,
      };
    },
  };
  global.AURA_DARK_COMFORT_THEME_RUNTIME = {
    applyDarkComfortThemeRuntime: (payload) => {
      darkRuntimeApplyCalls += 1;
      darkRuntimeExecutorActive = payload?.executorActive;
      return { ok: true, active: payload?.executorActive === true };
    },
  };
  const listener = await loadContentMain();

  const scopeRoot = new StubElement('main');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  global.window.AURA.modeEngineScopeRoot = scopeRoot;

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
    tokenMap: {
      '--aura-color-scheme': 'dark',
      '--aura-bg-color': '#0b1020',
    },
    ownerKey: 'aura-me2',
  });

  assert.equal(response.ok, true);
  assert.equal(appliedTokenKeys.includes('--aura-color-scheme'), false);
  assert.equal(appliedTokenKeys.includes('--aura-bg-color'), false);
  assert.equal(darkRuntimeApplyCalls, 1);
  assert.equal(darkRuntimeExecutorActive, false);
  assert.equal(mutationObservers, 0);
});

test('MODE_ENGINE_V2_APPLY_SCOPE_TOKENS prepares dark manifest before active dark token mutation', async () => {
  setupGlobals();
  const callOrder = [];
  let darkRuntimeExecutorActive = null;
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyScopedTokens: (_scopeRoot, tokenMap) => {
      callOrder.push('applyScopedTokens');
      return {
        ok: true,
        applied: Object.keys(tokenMap || {}).length,
        ownedKeys: Object.keys(tokenMap || {}),
      };
    },
  };
  global.AURA_DARK_COMFORT_THEME_RUNTIME = {
    prepareDarkComfortThemeRuntime: () => {
      callOrder.push('prepareDarkManifest');
      return { ok: true, manifest: { version: 1, rollbackRequired: true } };
    },
    applyDarkComfortThemeRuntime: (payload) => {
      darkRuntimeExecutorActive = payload?.executorActive;
      callOrder.push('applyDarkRuntime');
      return { ok: true, active: payload?.executorActive === true };
    },
  };
  const listener = await loadContentMain();

  const scopeRoot = new StubElement('main');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  global.window.AURA.modeEngineScopeRoot = scopeRoot;

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
    darkThemeExecutorActive: true,
    tokenMap: {
      '--aura-color-scheme': 'dark',
      '--aura-bg-color': '#0b1020',
    },
    ownerKey: 'aura-me2',
  });

  assert.equal(response.ok, true);
  assert.equal(darkRuntimeExecutorActive, true);
  assert.deepEqual(callOrder, ['prepareDarkManifest', 'applyScopedTokens', 'applyDarkRuntime']);
});

test('MODE_ENGINE_V2_APPLY_SCOPE_TOKENS reports active dark rollback', async () => {
  setupGlobals();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyScopedTokens: (_scopeRoot, tokenMap) => ({
      ok: true,
      applied: Object.keys(tokenMap || {}).length,
      ownedKeys: Object.keys(tokenMap || {}),
    }),
  };
  global.AURA_DARK_COMFORT_THEME_RUNTIME = {
    prepareDarkComfortThemeRuntime: () => ({
      ok: true,
      manifest: { version: 1, rollbackRequired: true },
    }),
    applyDarkComfortThemeRuntime: () => ({
      ok: false,
      active: false,
      rolledBack: true,
      reason: 'postcheck-failed',
      detail: 'contrast-regression',
    }),
  };
  const listener = await loadContentMain();

  const scopeRoot = new StubElement('main');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  global.window.AURA.modeEngineScopeRoot = scopeRoot;

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
    darkThemeExecutorActive: true,
    tokenMap: {
      '--aura-color-scheme': 'dark',
      '--aura-bg-color': '#0b1020',
    },
    ownerKey: 'aura-me2',
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, 'DARK_COMFORT_THEME_ROLLED_BACK');
  assert.equal(response.reason, 'postcheck-failed');
  assert.equal(response.detail, 'contrast-regression');
  assert.deepEqual(response.darkComfortTheme, {
    active: false,
    rolledBack: true,
    reason: 'postcheck-failed',
    failures: null,
    postCheck: null,
  });
});

test('MODE_ENGINE_V2_APPLY_SCOPE_TOKENS maps a rejected handler to one route-specific response', async () => {
  setupGlobals();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyScopedTokens: () => {
      throw new Error('forced-token-apply-failure');
    },
  };
  const listener = await loadContentMain();
  const scopeRoot = new StubElement('main');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  global.window.AURA.modeEngineScopeRoot = scopeRoot;

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
    tokenMap: { '--aura-font-size': '18px' },
    ownerKey: 'aura-me2',
  });

  assert.deepEqual(response, {
    ok: false,
    error: 'TOKEN_APPLY_FAILED',
    detail: 'forced-token-apply-failure',
  });
});

test('MODE_ENGINE_V2_APPLY_SCOPE_TOKENS restores dark heading fixes exactly on cleanup', async () => {
  setupGlobals();
  const scopeRoot = new StubElement('main');
  const heading = new StubElement('h1');
  scopeRoot.setAttribute('data-aura-scope', '1');
  scopeRoot.setAttribute('data-aura-scope-owner', 'aura-me2');
  scopeRoot.computedStyle = {
    backgroundColor: 'rgb(11, 16, 32)',
    color: 'rgb(230, 230, 230)',
  };
  heading.computedStyle = {
    color: 'rgb(20, 20, 20)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
  };
  heading.style.setProperty('color', 'rgb(20, 20, 20)', 'important');
  heading.style.setProperty('-webkit-text-fill-color', 'rgb(25, 25, 25)', 'important');
  scopeRoot.appendChild(heading);

  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyScopedTokens: (_scopeRoot, tokenMap) => ({
      ok: true,
      applied: Object.keys(tokenMap || {}).length,
      ownedKeys: Object.keys(tokenMap || {}),
    }),
    cleanupScopedTokens: (_scopeRoot, _ownerKey, ownedKeys) => ({
      ok: true,
      removed: ownedKeys.length,
    }),
  };
  global.AURA_DARK_COMFORT_THEME_RUNTIME = {
    prepareDarkComfortThemeRuntime: () => ({
      ok: true,
      manifest: { version: 1, rollbackRequired: true },
    }),
    applyDarkComfortThemeRuntime: (payload) => {
      payload?.callbacks?.fixUnreadableHeadings?.(payload.scopeRoot);
      return { ok: true, active: true };
    },
    cleanupDarkComfortThemeRuntime: (payload) => {
      payload?.callbacks?.clearHeadingFixes?.();
      return { ok: true };
    },
  };

  const listener = await loadContentMain();
  global.window.AURA.modeEngineScopeRoot = scopeRoot;

  const applied = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
    darkThemeExecutorActive: true,
    tokenMap: {
      '--aura-color-scheme': 'dark',
      '--aura-bg-color': '#0b1020',
    },
    ownerKey: 'aura-me2',
  });

  assert.equal(applied.ok, true);
  assert.equal(heading.style.getPropertyValue('color'), 'var(--aura-text-color)');
  assert.equal(heading.style.getPropertyPriority('color'), 'important');
  assert.equal(heading.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color)');
  assert.equal(heading.style.getPropertyPriority('-webkit-text-fill-color'), 'important');
  assert.equal(heading.getAttribute('data-aura-heading-fix'), '1');

  const cleaned = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    ownerKey: 'aura-me2',
    preserveScope: true,
  });

  assert.equal(cleaned.ok, true);
  assert.equal(heading.style.getPropertyValue('color'), 'rgb(20, 20, 20)');
  assert.equal(heading.style.getPropertyPriority('color'), 'important');
  assert.equal(heading.style.getPropertyValue('-webkit-text-fill-color'), 'rgb(25, 25, 25)');
  assert.equal(heading.style.getPropertyPriority('-webkit-text-fill-color'), 'important');
  assert.equal(heading.getAttribute('data-aura-heading-fix'), null);
});

test('SMARTSCOPE_APPLY_CLASSES_V1 applies and removes token-owned classes', async () => {
  setupGlobals();
  const target = new StubElement('main');
  global.document.querySelectorAll = (selector) => (selector === 'main' ? [target] : []);
  const listener = await loadContentMain();

  const applied = await sendMessage(listener, {
    action: SMARTSCOPE_ACTIONS.APPLY_CLASSES,
    token: 'token-classes',
    operations: [
      {
        selector: 'main',
        add: ['aura-scope', 'aura-comfort-scope'],
      },
    ],
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.token, 'token-classes');
  assert.deepEqual(applied.applied.sort(), ['aura-comfort-scope', 'aura-scope']);
  assert.equal(target.classList.has('aura-scope'), true);
  assert.equal(target.classList.has('aura-comfort-scope'), true);

  const removed = await sendMessage(listener, {
    action: SMARTSCOPE_ACTIONS.REMOVE_TOKEN,
    token: 'token-classes',
  });

  assert.deepEqual(removed, { ok: true, removed: 2 });
  assert.equal(target.classList.has('aura-scope'), false);
  assert.equal(target.classList.has('aura-comfort-scope'), false);
});

test('PAGE_CLARITY_EFFECT_PROBE rejects unchanged baseline styles', async () => {
  setupGlobals();
  const target = new StubElement('main');
  const link = new StubElement('a');
  link.setAttribute('href', '/result');
  link.computedStyle = {
    textDecorationLine: 'underline',
    textDecorationColor: 'rgb(15, 61, 140)',
    textDecorationThickness: '0.15em',
    textUnderlineOffset: '0.23em',
    backgroundColor: 'rgba(250, 204, 21, 0.2)',
    color: 'rgb(15, 61, 140)',
    outlineStyle: 'solid',
    outlineWidth: '1px',
    outlineColor: 'rgba(15, 98, 254, 0.68)',
  };
  target.appendChild(link);
  global.AURA_PAGE_SIGNALS_ADAPTER_V1 = {
    validateRegionTargetV1: () => ({ ok: true, reason: 'OK' }),
    getRegionTargetElementV1: () => target,
  };
  const listener = await loadContentMain();

  const marked = await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_MARK_TARGET_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });
  assert.equal(marked.ok, true);

  const baseline = await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });
  assert.equal(baseline.ok, true);

  const probe = await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });

  assert.equal(probe.ok, false);
  assert.equal(probe.reason, 'STYLE_UNCHANGED');
  assert.equal(probe.changedElements, 0);
  assert.equal(probe.visibleEffectScore, 0);
});

test('PAGE_CLARITY_EFFECT_PROBE accepts differential visible style changes', async () => {
  setupGlobals();
  const target = new StubElement('main');
  const linkA = new StubElement('a');
  const linkB = new StubElement('a');
  linkA.setAttribute('href', '/a');
  linkB.setAttribute('href', '/b');
  target.appendChild(linkA);
  target.appendChild(linkB);
  global.AURA_PAGE_SIGNALS_ADAPTER_V1 = {
    validateRegionTargetV1: () => ({ ok: true, reason: 'OK' }),
    getRegionTargetElementV1: () => target,
  };
  const listener = await loadContentMain();

  await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_MARK_TARGET_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });
  const baseline = await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });
  assert.equal(baseline.ok, true);
  assert.equal(baseline.baselineElements, 2);

  for (const link of [linkA, linkB]) {
    link.computedStyle = {
      textDecorationLine: 'underline',
      textDecorationColor: 'rgb(15, 61, 140)',
      textDecorationThickness: '0.15em',
      textUnderlineOffset: '0.23em',
      backgroundColor: 'rgba(250, 204, 21, 0.2)',
      color: 'rgb(15, 61, 140)',
      outlineStyle: 'solid',
      outlineWidth: '1px',
      outlineColor: 'rgba(15, 98, 254, 0.68)',
    };
  }

  const probe = await sendMessage(listener, {
    action: ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1,
    frameId: 0,
    expectedTargetKind: 'RECORD_REGION',
  });

  assert.equal(probe.ok, true);
  assert.equal(probe.reason, 'OK');
  assert.equal(probe.changedElements, 2);
  assert.equal(probe.inspectedElements, 2);
  assert.equal(probe.visibleEffectScore, 1);
});

test('unknown action is not claimed by the content router', async () => {
  setupGlobals();
  const listener = await loadContentMain();
  let responded = false;

  const claimed = listener({ action: 'UNKNOWN_ACTION' }, {}, () => {
    responded = true;
  });

  assert.equal(claimed, false);
  assert.equal(responded, false);
});

test('TEST_ONLY routes require enabled debug hooks in the top frame', async () => {
  setupGlobals({ debugTestHooks: false });
  const listener = await loadContentMain();
  let responded = false;

  const claimed = listener(
    { action: ACTIONS.TEST_CLEAR_SUGGESTION_BANNER },
    {},
    () => {
      responded = true;
    },
  );

  assert.equal(claimed, false);
  assert.equal(responded, false);
});

test('TEST_ONLY routes remain available with enabled debug hooks in the top frame', async () => {
  setupGlobals({ debugTestHooks: true });
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.TEST_CLEAR_SUGGESTION_BANNER,
  });

  assert.deepEqual(response, { ok: true });
});

test('top-owned and TEST_ONLY routes are not claimed in child frames', async () => {
  setupGlobals({ isTopFrame: false, debugTestHooks: true });
  const listener = await loadContentMain();

  for (const action of [ACTIONS.INJECT_RESTORE_BUTTON, ACTIONS.TEST_CLEAR_SUGGESTION_BANNER]) {
    let responded = false;
    const claimed = listener({ action, modeId: MODE_IDS.COMFORT_VISUAL }, {}, () => {
      responded = true;
    });
    assert.equal(claimed, false, `${action} must not be claimed in a child frame`);
    assert.equal(responded, false, `${action} must not respond in a child frame`);
  }
});

test('identity checks follow NONE and SUPPLIED_STRICT route metadata', async () => {
  setupGlobals();
  const listener = await loadContentMain();

  const readiness = await sendMessage(listener, {
    action: ACTIONS.TEST_PING_CONTENT,
    expectedDocumentInstanceId: 'intentionally-stale-document',
  });
  assert.deepEqual(readiness, { ok: true });

  const strictMismatch = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: 'main',
    expectedDocumentInstanceId: 'intentionally-stale-document',
  });
  assert.deepEqual(strictMismatch, {
    ok: false,
    error: 'DOCUMENT_IDENTITY_MISMATCH',
  });

  const currentDocumentId = global.window.__AURA_DOCUMENT_INSTANCE_ID__;
  assert.equal(typeof currentDocumentId, 'string');
  const strictMatch = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
    selector: '.missing',
    expectedDocumentInstanceId: currentDocumentId,
  });
  assert.deepEqual(strictMatch, { ok: false, reason: 'ELEMENT_NOT_FOUND' });
});

test('every async route returns true before exactly one response', async () => {
  setupGlobals();
  const listener = await loadContentMain();
  const scenarios = [
    { action: SMARTSCOPE_ACTIONS.GET_PROFILE, level: 'conservative' },
    { action: ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS, tokenMap: {} },
    { action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS },
    { action: ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT, selector: '.missing' },
    { action: ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT, selector: '.missing' },
    { action: ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT, selector: '.missing' },
    { action: ACTIONS.SHOW_BANNER, modeId: 'not-a-real-mode' },
  ];

  assert.deepEqual(
    scenarios.map(({ action }) => action).sort(),
    Object.entries(CONTENT_MESSAGE_ROUTES_V1)
      .filter(([, route]) => route.response === 'async')
      .map(([action]) => action)
      .sort(),
  );

  for (const message of scenarios) {
    let responseCount = 0;
    let response;
    const claimed = listener(message, {}, (value) => {
      responseCount += 1;
      response = value;
    });

    assert.equal(claimed, true, `${message.action} must be claimed synchronously`);
    assert.equal(responseCount, 0, `${message.action} must answer after the listener returns`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(responseCount, 1, `${message.action} must answer exactly once`);
    assert.equal(response && typeof response === 'object', true, `${message.action} returns a payload`);
  }
});

test('SHOW_BANNER fails closed when site policy is unavailable', async () => {
  setupGlobals({
    featureFlags: { siteSuppressV1: true },
    runtimeMessageResponse: (message) => message?.action === ACTIONS.GET_SITE_POLICY
      ? { ok: false, error: 'STORAGE_UNAVAILABLE' }
      : { tabId: 1 },
  });
  const listener = await loadContentMain();

  const response = await sendMessage(listener, {
    action: ACTIONS.SHOW_BANNER,
    modeId: MODE_IDS.COMFORT_VISUAL,
    score: 0.8,
  });

  assert.deepEqual(response, {
    ok: false,
    received: false,
    suppressed: true,
    error: 'SITE_POLICY_DENIED',
  });
});

test('main runtime leaves document context responses to the early top-frame listener', async () => {
  setupGlobals();
  const listener = await loadContentMain();
  let responded = false;

  const claimed = listener(
    { action: ACTIONS.GET_DOCUMENT_CONTEXT_V1 },
    {},
    () => {
      responded = true;
    },
  );

  assert.equal(claimed, false);
  assert.equal(responded, false);
});
