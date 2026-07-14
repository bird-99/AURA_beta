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

function setupGlobals(sendMessageImpl) {
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
  global.window.top = global.window;

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
        if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
          const response = { ok: true, flags: { ...MODE_ENGINE_FLAG_DEFAULTS, debugTestHooks: true } };
          if (typeof callback === 'function') {
            callback(response);
          }
          return response;
        }
        return sendMessageImpl(message, callback);
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
  return waitForTestHook(() => global.window?.AURA?.__TEST_LOAD_SHARED_CONSTANTS__, {
    label: '__TEST_LOAD_SHARED_CONSTANTS__',
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

test('loadSharedConstantsFromSW returns constants on success', async () => {
  setupGlobals((message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      callback?.({ ok: true, constants: constantsPayload });
      return;
    }
    callback?.({ tabId: 1 });
  });

  const loader = await loadContentMainWithTestHooks();
  const result = await loader();

  assert.equal(result.ok, true);
  assert.deepEqual(result.constants.ACTIONS, ACTIONS);
  assert.deepEqual(result.constants.DECISIONS, DECISIONS);
});

test('loadSharedConstantsFromSW handles missing receiver', async () => {
  setupGlobals((message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      callback?.({ ok: true, constants: constantsPayload });
      return;
    }
    callback?.({ tabId: 1 });
  });

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      global.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
      callback?.(undefined);
      delete global.chrome.runtime.lastError;
      return;
    }
    callback?.({ tabId: 1 });
  };
  const result = await loader();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_RECEIVER');
});

test('loadSharedConstantsFromSW times out when no response', async () => {
  setupGlobals((message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      callback?.({ ok: true, constants: constantsPayload });
      return;
    }
    callback?.({ tabId: 1 });
  });

  const loader = await loadContentMainWithTestHooks();
  global.chrome.runtime.sendMessage = (message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      return;
    }
    callback?.({ tabId: 1 });
  };
  const result = await loader({ timeoutMs: 5 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TIMEOUT');
});

test('content bootstrap recovers after constants failure without changing document identity', async () => {
  let constantsAvailable = false;
  const listeners = new Set();

  setupGlobals((message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      if (constantsAvailable) {
        callback?.({ ok: true, constants: constantsPayload });
        return;
      }
      global.chrome.runtime.lastError = { message: 'Receiving end does not exist.' };
      callback?.(undefined);
      delete global.chrome.runtime.lastError;
      return;
    }
    callback?.({ tabId: 1 });
  });
  global.chrome.runtime.onMessage = {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
  };
  global.chrome.storage.onChanged = {
    addListener() {},
    removeListener() {},
  };

  await import(`../../content/content-main.js?bootstrap-failed=${Date.now()}-${Math.random()}`);
  await waitForTestHook(
    () => global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__?.phase === 'RETRYABLE_FAILED',
    { label: 'bootstrap RETRYABLE_FAILED after constants failure' },
  );
  const failedState = global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__;
  assert.equal(failedState.phase, 'RETRYABLE_FAILED');
  assert.equal(failedState.generation, 1);
  assert.equal(failedState.lastFailure.reason, 'NO_RECEIVER');
  assert.equal(failedState.lastFailure.attempts, 3);
  const firstDocumentInstanceId = failedState.documentInstanceId;

  constantsAvailable = true;
  await import(`../../content/content-main.js?bootstrap-retry=${Date.now()}-${Math.random()}`);
  await waitForTestHook(
    () => global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__?.phase === 'READY',
    { label: 'bootstrap READY after retry' },
  );

  const readyState = global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__;
  assert.equal(readyState.generation, 2);
  assert.equal(readyState.documentInstanceId, firstDocumentInstanceId);
  assert.equal(global.window.__AURA_DOCUMENT_INSTANCE_ID__, firstDocumentInstanceId);
  assert.equal(listeners.size, 2, 'one early listener and one main listener should remain');
});

test('entrypoint retry restores a missing router before content-main claims readiness', async () => {
  const listeners = new Set();
  setupGlobals((message, callback) => {
    if (message?.type === SHARED_CONSTANTS_REQUEST_TYPE) {
      callback?.({ ok: true, constants: constantsPayload });
      return;
    }
    callback?.({ tabId: 1 });
  });
  global.chrome.runtime.onMessage = {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
  };
  global.chrome.storage.onChanged = { addListener() {}, removeListener() {} };
  delete globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1;

  await import(`../../content/content-main.js?router-missing=${Date.now()}-${Math.random()}`);
  const failedState = global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__;
  assert.equal(failedState.phase, 'RETRYABLE_FAILED');
  assert.equal(failedState.lastFailure.reason, 'CONTENT_MESSAGE_ROUTER_UNAVAILABLE');
  assert.equal(failedState.generation, 1);
  const documentInstanceId = failedState.documentInstanceId;
  assert.equal(listeners.size, 1, 'the failed attempt leaves only the early listener');

  await import(`../../content/content-message-router.runtime.js?entrypoint-retry=${Date.now()}-${Math.random()}`);
  await import(`../../content/content-main.js?router-recovered=${Date.now()}-${Math.random()}`);
  await waitForTestHook(
    () => global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__?.phase === 'READY',
    { label: 'bootstrap READY after router entrypoint retry' },
  );

  const readyState = global.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__;
  assert.equal(readyState.generation, 2);
  assert.equal(readyState.documentInstanceId, documentInstanceId);
  assert.equal(typeof global.window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__, 'function');
  assert.equal(listeners.size, 2, 'one early listener and one router-created main listener remain');
});
