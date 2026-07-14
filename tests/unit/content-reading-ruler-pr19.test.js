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
  MODE_PREFS_DEFAULTS,
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
  MODE_PREFS_DEFAULTS,
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
    this.attributes = new Map();
    this.classList = new Set();
  }

  appendChild(child) {
    this.children.push(child);
    return child;
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
    this.documentElement = new StubElement('html');
    this.documentElement.dataset = {};
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

  createElement(tagName) {
    return new StubElement(tagName);
  }
}

function setupGlobals({ signals }) {
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.history;
  delete global.performance;
  delete global.AURA_READING_RULER;
  delete global.AURA_PAGE_SIGNALS_ADAPTER_V1;

  const taggedSmartScopeUrl = `${smartScopeUrl}?v=${Math.random().toString(36).slice(2)}`;
  const dispatchedEvents = [];
  const sentMessages = [];
  const storage = {
    local: {
      [STORAGE_KEYS.USER_PREFS]: {
        modePrefs: {
          [MODE_IDS.FOCUS]: {
            readingRuler: true,
            focusNotObscured: true,
          },
        },
      },
    },
    session: {},
  };

  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.Element = StubElement;
  global.performance = { now: () => 0 };
  global.document = new StubDocument();
  global.window = {
    location: { href: 'https://example.test' },
    getSelection: () => ({ rangeCount: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      dispatchedEvents.push(event);
      return true;
    },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    requestAnimationFrame: (callback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
  };
  global.location = global.window.location;
  global.history = {
    pushState() {},
    replaceState() {},
  };
  global.requestAnimationFrame = global.window.requestAnimationFrame;
  global.cancelAnimationFrame = global.window.cancelAnimationFrame;

  global.AURA_READING_RULER = { setState() {}, onExit() {} };
  global.AURA_PAGE_SIGNALS_ADAPTER_V1 = {
    collectPageSignalsV1: () => signals,
  };

  global.chrome = {
    runtime: {
      id: 'aura-test',
      lastError: null,
      getURL: (modulePath) => (modulePath === 'shared/smartscope-v2.js' ? taggedSmartScopeUrl : modulePath),
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
        if (message?.action === ACTIONS.GET_STATE) {
          const response = { state: { state: 'ACTIVE' } };
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

  global.__AURA_TEST_SENT_MESSAGES__ = sentMessages;

  return { dispatchedEvents, sentMessages };
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

async function loadReadingRulerGuard() {
  await import(`../../content/content-main.js?reading-ruler-pr19=${Date.now()}-${Math.random()}`);
  const modeEngineInit = await waitFor(() => global.window?.AURA?.__TEST_MODEENGINE_INIT__, {
    label: '__TEST_MODEENGINE_INIT__',
  });
  await modeEngineInit;
  return waitFor(() => global.window?.AURA?.__TEST_IS_READING_RULER_ALLOWED_BY_SIGNALS__, {
    label: '__TEST_IS_READING_RULER_ALLOWED_BY_SIGNALS__',
  });
}

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.Element;
  delete global.history;
  delete global.performance;
  delete global.location;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
  delete global.AURA_READING_RULER;
  delete global.AURA_PAGE_SIGNALS_ADAPTER_V1;
  delete global.__AURA_TEST_SENT_MESSAGES__;
});

test('PR19 Reading Ruler stays disabled on high-risk dashboard signals', async () => {
  setupGlobals({
    signals: {
      stats: { budgetHit: false },
      pageHints: { urlKind: 'UNKNOWN', modalLikeCount: 0, tableCount: 4 },
      aggregateMetrics: { tableDensity: 0.66, interactiveDensity: 0.52 },
      blocks: [{ roleHint: 'TABLE', metrics: { tableDensity: 0.82, mediaDensity: 0.04 } }],
    },
  });

  const isAllowed = await loadReadingRulerGuard();

  assert.equal(isAllowed({
    stats: { budgetHit: false },
    pageHints: { urlKind: 'UNKNOWN', modalLikeCount: 0, tableCount: 4 },
    aggregateMetrics: { tableDensity: 0.66, interactiveDensity: 0.52 },
    blocks: [{ roleHint: 'TABLE', metrics: { tableDensity: 0.82, mediaDensity: 0.04 } }],
  }), false);
});

test('PR19 Reading Ruler stays disabled when live signal budget is hit', async () => {
  setupGlobals({
    signals: {
      stats: { budgetHit: true },
      pageHints: { urlKind: 'ARTICLE', modalLikeCount: 0, tableCount: 0 },
      aggregateMetrics: { tableDensity: 0, interactiveDensity: 0.1 },
      blocks: [],
    },
  });

  const isAllowed = await loadReadingRulerGuard();

  assert.equal(isAllowed({
    stats: { budgetHit: true },
    pageHints: { urlKind: 'ARTICLE', modalLikeCount: 0, tableCount: 0 },
    aggregateMetrics: { tableDensity: 0, interactiveDensity: 0.1 },
    blocks: [],
  }), false);
});

test('PR19 Reading Ruler can still enable on a low-risk reading surface', async () => {
  setupGlobals({
    signals: {
      stats: { budgetHit: false },
      pageHints: { urlKind: 'ARTICLE', modalLikeCount: 0, tableCount: 0 },
      aggregateMetrics: { tableDensity: 0, interactiveDensity: 0.12 },
      blocks: [{ roleHint: 'ARTICLE', metrics: { tableDensity: 0, mediaDensity: 0.02 } }],
    },
  });

  const isAllowed = await loadReadingRulerGuard();

  assert.equal(isAllowed({
    stats: { budgetHit: false },
    pageHints: { urlKind: 'ARTICLE', modalLikeCount: 0, tableCount: 0 },
    aggregateMetrics: { tableDensity: 0, interactiveDensity: 0.12 },
    blocks: [{ roleHint: 'ARTICLE', metrics: { tableDensity: 0, mediaDensity: 0.02 } }],
  }), true);
});
