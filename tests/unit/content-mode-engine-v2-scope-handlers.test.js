import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ACTIONS,
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
    this.dataset = {};
    this.style = {
      setProperty: (name, value) => {
        this.style[name] = value;
      },
      removeProperty: (name) => {
        delete this.style[name];
      },
    };
    this.classList = new Set();
    this.attributes = new Map();
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
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

  removeAttribute(name) {
    this.attributes.delete(name);
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

function setupGlobals() {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;

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
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    requestAnimationFrame: (callback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
  };
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
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, debugTestHooks: true },
          };
          callback?.(response);
          return response;
        }
        const response = { tabId: 1 };
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

async function loadContentMain() {
  await import(`../../content/content-main.js?run=${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const listener = global.window?.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__;
  assert.equal(typeof listener, 'function');
  return listener;
}

function sendMessage(listener, message) {
  return new Promise((resolve) => {
    listener(message, {}, resolve);
  });
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
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

test('MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS preserves scope when requested', async () => {
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

  const response = await sendMessage(listener, {
    action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    preserveScope: true,
  });

  assert.equal(response.ok, true);
  assert.equal(response.scopeUnmarked, false);
  assert.equal(scopeRoot.getAttribute('data-aura-scope'), '1');
  assert.equal(scopeRoot.getAttribute('data-aura-scope-owner'), null);
  assert.equal(scopeRoot.getAttribute('data-aura-scope-tokens'), null);
  assert.equal(scopeRoot.style['--aura-font-size'], undefined);
  assert.equal(scopeRoot.style['--aura-line-height'], undefined);
  assert.deepEqual(global.window.AURA.modeEngineScopeTokens, []);
});

test('unknown action keeps default response', async () => {
  setupGlobals();
  const listener = await loadContentMain();

  const response = await sendMessage(listener, { action: 'UNKNOWN_ACTION' });

  assert.deepEqual(response, { received: true });
});
