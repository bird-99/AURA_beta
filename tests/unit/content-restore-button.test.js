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
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.id = '';
    this.type = '';
    this.title = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    child.parentNode = null;
    return child;
  }

  attachShadow() {
    this.shadowRoot = new StubElement('shadow-root');
    return this.shadowRoot;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type) {
    this.listeners.delete(type);
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

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  getElementsByTagName() {
    return [];
  }
}

class StubDocument {
  constructor() {
    this.body = new StubElement('body');
    this.documentElement = new StubElement('html');
  }

  addEventListener() {}

  removeEventListener() {}

  createElement(tagName) {
    return new StubElement(tagName);
  }

  getElementById(id) {
    const visit = (node) => {
      if (node?.id === id) {
        return node;
      }
      for (const child of node?.children || []) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    return visit(this.documentElement) || visit(this.body);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

function setupGlobals({ restoreResponse = { ok: false, error: 'RESTORE_CSS_REMOVE_FAILED' } } = {}) {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;

  const sentMessages = [];
  const taggedSmartScopeUrl = `${smartScopeUrl}?v=${Math.random().toString(36).slice(2)}`;

  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.Element = StubElement;
  global.performance = { now: () => 0 };
  global.document = new StubDocument();
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
  global.location = global.window.location;
  global.requestAnimationFrame = global.window.requestAnimationFrame;
  global.cancelAnimationFrame = global.window.cancelAnimationFrame;

  global.chrome = {
    i18n: {
      getMessage: () => 'Restore',
    },
    runtime: {
      id: 'aura-test',
      lastError: null,
      getURL: (modulePath) => {
        if (modulePath === 'shared/smartscope-v2.js') {
          return taggedSmartScopeUrl;
        }
        return modulePath;
      },
      sendMessage: (message, callback) => {
        sentMessages.push(message);
        if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
          const response = { ok: true, constants: constantsPayload };
          callback?.(response);
          return response;
        }
        if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
          const response = {
            ok: true,
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, debugTestHooks: true },
          };
          callback?.(response);
          return response;
        }
        if (message?.action === ACTIONS.GET_TAB_ID) {
          const response = { tabId: 1 };
          callback?.(response);
          return response;
        }
        if (message?.action === ACTIONS.RESTORE_MODE) {
          callback?.(restoreResponse);
          return restoreResponse;
        }
        const response = { ok: true };
        callback?.(response);
        return response;
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: undefined };
        },
        async set() {},
      },
      session: {
        async get(key) {
          return { [key]: undefined };
        },
        async set() {},
      },
      onChanged: { addListener: () => {} },
    },
    tabs: { get: async () => ({ id: 1 }) },
  };

  return { sentMessages };
}

async function waitFor(getter, { timeoutMs = 2000, stepMs = 5, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getter();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
  delete global.location;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
});

test('RestoreButton stays visible and becomes retry affordance when restore fails', async () => {
  const { sentMessages } = setupGlobals({
    restoreResponse: {
      ok: false,
      error: 'RESTORE_CSS_REMOVE_FAILED',
      reason: 'RESTORE_CSS_REMOVE_FAILED',
      retryable: true,
    },
  });

  await import(`../../content/content-main.js?restore-button-test=${Date.now()}`);
  const RestoreButton = await waitFor(() => global.window?.AURA?.RestoreButton, {
    label: 'RestoreButton constructor',
  });

  const restoreButton = new RestoreButton(MODE_IDS.COMFORT_VISUAL);
  restoreButton.inject();
  assert.ok(document.getElementById('aura-restore-button'));

  await restoreButton.handleRestore();

  assert.ok(document.getElementById('aura-restore-button'));
  assert.equal(restoreButton.button.textContent, 'Retry restore');
  assert.equal(restoreButton.button.getAttribute('aria-label'), 'Retry restore original page');
  assert.equal(restoreButton.button.title, 'RESTORE_CSS_REMOVE_FAILED');
  assert.ok(
    sentMessages.some(
      (message) =>
        message?.action === ACTIONS.RESTORE_MODE &&
        message?.tabId === 1 &&
        message?.modeId === MODE_IDS.COMFORT_VISUAL,
    ),
  );
});

test('RestoreButton removes only its owned host after a successful restore', async () => {
  const { sentMessages } = setupGlobals({ restoreResponse: { ok: true } });

  await import(`../../content/content-main.js?restore-button-success=${Date.now()}-${Math.random()}`);
  const RestoreButton = await waitFor(() => global.window?.AURA?.RestoreButton, {
    label: 'RestoreButton constructor',
  });

  const restoreButton = new RestoreButton(MODE_IDS.COMFORT_VISUAL);
  restoreButton.inject();
  const host = document.getElementById('aura-restore-button');
  assert.equal(host?.getAttribute('data-aura-ui-owner'), 'restore-button');

  await restoreButton.handleRestore();

  assert.equal(document.getElementById('aura-restore-button'), null);
  assert.ok(sentMessages.some((message) => message?.action === ACTIONS.RESTORE_MODE));
});
