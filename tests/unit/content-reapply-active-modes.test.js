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
  const sentMessages = [];

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
  global.location = global.window.location;

  global.document = new StubDocument();

  const storage = { local: { featureFlags: {} }, session: {} };

  global.chrome = {
    runtime: {
      id: 'aura-test',
      lastError: null,
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
          const response = { ok: true, constants: constantsPayload };
          callback?.(response);
          return response;
        }
        if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
          return {
            ok: true,
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, ...initialFlags, debugTestHooks: true },
          };
        }
        if (message?.action === ACTIONS.GET_TAB_ID) {
          const response = { tabId: 1 };
          callback?.(response);
          return response;
        }
        if (message?.action === ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES) {
          sentMessages.push(message);
          const response = { ok: true };
          callback?.(response);
          return response;
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

  return { sentMessages };
}

afterEach(() => {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.performance;
});

async function waitForTestHook(getter, { timeoutMs = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = getter();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

test('requestV2Reapply sends mode-engine v2 reapply message', async () => {
  const { sentMessages } = setupGlobals({
    initialFlags: { scopedModeCssV2: true },
  });

  await import(`../../content/content-main.js?run=${Date.now()}`);
  const handler = await waitForTestHook(() => global.window?.AURA?.__TEST_REQUEST_V2_REAPPLY__);
  assert.equal(typeof handler, 'function');

  await handler('navigate');

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].action, ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES);
  assert.equal(sentMessages[0].reason, 'navigate');
});
