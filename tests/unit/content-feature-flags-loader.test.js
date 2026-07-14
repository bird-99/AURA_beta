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
    this.dataset = {};
    this.style = {};
    this.classList = new Set();
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

  setAttribute() {}

  removeAttribute() {}
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

function setupGlobals({ initialFlags = {} } = {}) {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;

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
  };

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
          return {
            ok: true,
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, ...initialFlags, debugTestHooks: true },
          };
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

async function loadContentMainWithTestHooks() {
  await import(`../../content/content-main.js?run=${Date.now()}`);
  return waitForTestHook(() => global.window?.AURA?.__TEST_LOAD_FEATURE_FLAGS__, {
    label: '__TEST_LOAD_FEATURE_FLAGS__',
  });
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
});

test('loadFeatureFlagsFromSW returns flags on success', async () => {
  const flags = { debugTestHooks: true, smartScopeV2: true };
  setupGlobals({ initialFlags: flags });

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message) => {
    if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
      return { ok: true, flags };
    }
    return { tabId: 1 };
  };
  const result = await loader();

  assert.equal(result.ok, true);
  assert.deepEqual(result.flags, flags);
});

test('loadFeatureFlagsFromSW returns error details on SW failure', async () => {
  setupGlobals();

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message) => {
    if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
      return { ok: false, reason: 'SW_ERROR' };
    }
    return { tabId: 1 };
  };
  const result = await loader();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SW_ERROR');
});

test('loadFeatureFlagsFromSW reports send failures', async () => {
  setupGlobals();

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message) => {
    if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
      throw new Error('boom');
    }
    return { tabId: 1 };
  };
  const result = await loader();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SEND_FAILED');
});

test('loadFeatureFlagsFromSW times out when SW never responds', async () => {
  setupGlobals();

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message) => {
    if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
      return new Promise(() => {});
    }
    return { tabId: 1 };
  };
  const result = await loader({ timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TIMEOUT');
});
