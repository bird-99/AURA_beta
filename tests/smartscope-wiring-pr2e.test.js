import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import '../content/content-bootstrap.runtime.js';
import '../content/content-message-router.runtime.js';
import { MODE_ENGINE_FLAG_DEFAULTS } from './fixtures/stub-constants.js';

const fixtureBase = path.join(process.cwd(), 'tests', 'fixtures');
const constantsUrl = pathToFileURL(path.join(fixtureBase, 'stub-constants.js')).toString();
const smartScopeV2Url = pathToFileURL(path.join(fixtureBase, 'stub-smartscope-v2.js')).toString();
const FEATURE_FLAGS_REQUEST_TYPE = 'AURA_GET_FEATURE_FLAGS_V1';

async function waitFor(predicate, { timeoutMs = 250, stepMs = 5 } = {}) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }

  const timeoutError = new Error('Timed out waiting for SmartScope test hooks to initialize.');
  if (lastError) {
    timeoutError.cause = lastError;
  }
  throw timeoutError;
}

function setupGlobals({ featureFlags: featureFlagOverrides = {} } = {}) {
  // Reset global references to allow re-importing the content script.
  delete global.window;
  delete global.document;
  delete global.chrome;
  delete global.NodeFilter;
  delete global.performance;
  delete global.__AURA_TEST_MODULE_URLS__;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
  delete global.AURA_PAGE_SIGNALS_ADAPTER_V1;

  const versionTag = Math.random().toString(36).slice(2);
  const taggedConstantsUrl = `${constantsUrl}?v=${versionTag}`;
  const taggedSmartScopeUrl = `${smartScopeV2Url}?v=${versionTag}`;

  const body = buildFixtureBody();
  const document = new StubDocument(body);
  const runtimeListeners = [];

  global.NodeFilter = { SHOW_ELEMENT: 1 };
  global.performance = { now: () => 0 };
  global.Element = StubElement;

  global.window = {
    getSelection: () => ({ rangeCount: 0 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }),
    location: { hostname: 'example.test' },
  };

  global.document = document;

  const storage = { local: { featureFlags: featureFlagOverrides }, session: {} };
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
        if (message?.type === 'AURA_GET_SHARED_CONSTANTS_V1') {
          void import(taggedConstantsUrl).then((constants) => {
            if (typeof callback === 'function') {
              callback({ ok: true, constants });
            }
          });
          return;
        }
        if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
          const response = {
            ok: true,
            flags: { ...MODE_ENGINE_FLAG_DEFAULTS, ...featureFlagOverrides, debugTestHooks: true },
          };
          if (typeof callback === 'function') {
            callback(response);
          }
          return response;
        }

        const response = { tabId: 1 };
        if (typeof callback === 'function') {
          callback(response);
        }
        return response;
      },
      onMessage: {
        addListener: (listener) => {
          if (typeof listener === 'function' && !runtimeListeners.includes(listener)) {
            runtimeListeners.push(listener);
          }
        },
        removeListener: (listener) => {
          const index = runtimeListeners.indexOf(listener);
          if (index >= 0) {
            runtimeListeners.splice(index, 1);
          }
        },
      },
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
        async remove(key) {
          delete storage.session[key];
        },
      },
      onChanged: { addListener: () => {} },
    },
    tabs: { get: async () => ({ id: 1 }) },
  };

  const moduleUrls = {
    constants: taggedConstantsUrl,
    smartScope: taggedSmartScopeUrl,
  };

  global.__AURA_TEST_MODULE_URLS__ = moduleUrls;

  return { document, moduleUrls, runtimeListeners };
}

class StubElement {
  constructor(tagName = 'div', textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.children = [];
    this.dataset = {};
    this.id = '';
    this.classList = new Set();
    this.parentNode = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const isMatch = (el) => {
      if (selector === 'main' || selector === 'article' || selector === '[role="main"]') {
        return el.tagName.toLowerCase() === selector.replace(/[^a-z]/g, '') || el.role === 'main';
      }
      if (selector === '#content' || selector === '#main-content' || selector === '#main') {
        return selector.slice(1) === el.id;
      }
      if (selector === '[data-article-body]') {
        return Boolean(el.dataset.articleBody);
      }
      if (selector === '.article__body') {
        return el.classList.has('article__body');
      }
      return false;
    };

    const walk = (el) => {
      if (isMatch(el)) {
        matches.push(el);
      }
      el.children.forEach((child) => walk(child));
    };

    walk(this);
    return matches;
  }

  getElementsByTagName(tagName) {
    const matches = [];
    const normalized = tagName === '*' ? '*' : tagName.toUpperCase();

    const walk = (el) => {
      if (normalized === '*' || el.tagName === normalized) {
        matches.push(el);
      }
      el.children.forEach((child) => walk(child));
    };

    walk(this);
    return matches;
  }
}

class StubDocument {
  constructor(body) {
    this.body = body;
    this.documentElement = { dataset: {} };
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

function buildFixtureBody() {
  const body = new StubElement('body');
  const main = new StubElement('main', 'x'.repeat(320));
  main.id = 'content';
  body.appendChild(main);
  return body;
}

afterEach(async () => {
  const urls = global.__AURA_TEST_MODULE_URLS__ || {};
  if (urls.smartScope) {
    const smartScope = await import(urls.smartScope);
    smartScope.setSmartScopeResult(null);
  }
});

test('flag OFF skips SmartScope v2', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: false } });
  const smartScope = await import(moduleUrls.smartScope);
  const sentinel = { tag: 'v2-sentinel' };
  smartScope.setSmartScopeResult({
    ok: true,
    scopeEl: sentinel,
    branch: 'TEST',
    score: 1,
    metrics: { elapsedMs: 1 },
    reasons: [{ code: 'SHOULD_NOT_USE' }],
    stats: { elapsedMs: 1, budgetMs: 1, candidatesSeen: 1, nodesScanned: 1 },
  });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  const { selectScopeRoot } = testHooks;

  const { root, profile } = await selectScopeRoot(document, 'conservative', 50);
  assert.equal(root, null);
  assert.notEqual(root, sentinel);
  assert.equal(profile.reason, 'v2-disabled');
});

test('flag ON uses SmartScope v2 result', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const smartScope = await import(moduleUrls.smartScope);
  const scopedEl = new StubElement('article', 'hello world');
  smartScope.setSmartScopeResult({
    ok: true,
    scopeEl: scopedEl,
    branch: 'A',
    score: 500,
    metrics: { elapsedMs: 3 },
    reasons: [{ code: 'BRANCH_A' }],
    stats: { elapsedMs: 3, budgetMs: 50, candidatesSeen: 1, nodesScanned: 1 },
  });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  await window.AURA.__TEST_MODEENGINE_INIT__;
  const { selectScopeRoot, selectScopeRootV2 } = testHooks;
  assert.equal(window.AURA.modeEngineFlags?.isEnabled('smartScopeV2'), true);
  const v2Direct = await selectScopeRootV2(document, 'conservative', 50);
  assert.equal(v2Direct.root, scopedEl);

  const { root, profile } = await selectScopeRoot(document, 'conservative', 50);
  assert.equal(root, scopedEl);
  assert.equal(profile.branch, 'A');
  assert.equal(profile.reason.includes('BRANCH_A'), true);
});

test('SmartScope v2 NONE returns no scope', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const smartScope = await import(moduleUrls.smartScope);
  smartScope.setSmartScopeResult({
    ok: false,
    scopeEl: null,
    branch: 'NONE',
    score: 0,
    metrics: { elapsedMs: 2 },
    reasons: [{ code: 'NO_SCOPE' }],
    stats: { elapsedMs: 2, budgetMs: 5, candidatesSeen: 0, nodesScanned: 0 },
  });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  await window.AURA.__TEST_MODEENGINE_INIT__;
  const { selectScopeRoot } = testHooks;
  assert.equal(window.AURA.modeEngineFlags?.isEnabled('smartScopeV2'), true);

  const { root, profile } = await selectScopeRoot(document, 'conservative', 50);
  assert.equal(root, null);
  assert.equal(profile.reason.includes('v2-none'), true);
});

test('SmartScope v2 verifies chosen scope and descends oversized roots', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const smartScope = await import(moduleUrls.smartScope);
  const main = new StubElement('main', 'x'.repeat(320));
  const article = new StubElement('article', 'content');
  main.appendChild(article);
  smartScope.setSmartScopeResult({
    ok: true,
    scopeEl: main,
    branch: 'TEST',
    score: 42,
    metrics: { elapsedMs: 2 },
    reasons: [{ code: 'BRANCH_TEST' }],
    stats: { elapsedMs: 2, budgetMs: 50, candidatesSeen: 1, nodesScanned: 1 },
  });
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRoot: (element) => {
      if (element === main) {
        return { ok: false, reason: 'ROOT_TOO_LARGE' };
      }
      if (element === article) {
        return { ok: true };
      }
      return { ok: false, reason: 'UNKNOWN' };
    },
    descendCandidateForContentRoot: () => ({ ok: true, element: article, reason: 'DESCEND_OK' }),
  };

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  await window.AURA.__TEST_MODEENGINE_INIT__;
  const { selectScopeRoot } = testHooks;

  const { root, profile } = await selectScopeRoot(document, 'conservative', 50);
  assert.equal(root, article);
  assert.equal(profile.detail, 'DESCEND_OK');
});

test('SmartScope v2 skips verification when scoped verifier runtime is missing', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const smartScope = await import(moduleUrls.smartScope);
  const scopedEl = new StubElement('article', 'hello world');
  smartScope.setSmartScopeResult({
    ok: true,
    scopeEl: scopedEl,
    branch: 'A',
    score: 500,
    metrics: { elapsedMs: 3 },
    reasons: [{ code: 'BRANCH_A' }],
    stats: { elapsedMs: 3, budgetMs: 50, candidatesSeen: 1, nodesScanned: 1 },
  });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  await window.AURA.__TEST_MODEENGINE_INIT__;
  const { selectScopeRoot } = testHooks;

  const { root } = await selectScopeRoot(document, 'conservative', 50);
  assert.equal(root, scopedEl);
});

test('Budget below minimum triggers v2 NONE without fallback', async () => {
  const { moduleUrls } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const smartScope = await import(moduleUrls.smartScope);
  smartScope.setSmartScopeResult({
    ok: false,
    scopeEl: null,
    branch: 'NONE',
    score: 0,
    metrics: { elapsedMs: 1 },
    reasons: [{ code: 'TIME_BUDGET_EXCEEDED' }],
    stats: { elapsedMs: 1, budgetMs: 1, candidatesSeen: 0, nodesScanned: 0 },
  });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => globalThis?.window?.AURA?.__TEST_SMARTSCOPE__);
  const testHooks = globalThis?.window?.AURA?.__TEST_SMARTSCOPE__;
  assert.ok(testHooks, 'SmartScope test hooks should be available for wiring tests');
  await window.AURA.__TEST_MODEENGINE_INIT__;
  const { selectScopeRoot, SMARTSCOPE_TIMEOUT_MS } = testHooks;
  assert.equal(window.AURA.modeEngineFlags?.isEnabled('smartScopeV2'), true);

  const { root, profile } = await selectScopeRoot(document, 'conservative', 1);
  assert.equal(root, null);
  assert.equal(profile.reason.includes('v2-none'), true);
  assert.equal(typeof SMARTSCOPE_TIMEOUT_MS, 'number');
});

test('PAGE_SIGNALS_COLLECT_V1 returns compact page signals on demand', async () => {
  const { document, runtimeListeners } = setupGlobals({ featureFlags: { smartScopeV2: true } });
  const signals = {
    schemaVersion: 1,
    frameId: 4,
    viewport: { w: 800, h: 600 },
    pageHints: {
      urlKind: 'UNKNOWN',
      semanticArticleCount: 1,
      formCount: 0,
      tableCount: 0,
      mediaCount: 0,
      fixedOrStickyCount: 0,
      modalLikeCount: 0,
    },
    aggregateMetrics: {
      textDensity: 0.4,
      linkDensity: 0.1,
      interactiveDensity: 0,
      mediaDensity: 0,
      formDensity: 0,
      tableDensity: 0,
      viewportCoverage: 0.5,
    },
    blocks: [],
    stats: { elapsedMs: 1, nodesScanned: 3, candidatesSeen: 1, budgetHit: false },
  };
  global.AURA_PAGE_SIGNALS_ADAPTER_V1 = {
    collectPageSignalsV1: (options) => {
      assert.equal(options.doc, document);
      assert.equal(options.frameId, 4);
      assert.equal(options.budgetMs, 12);
      return signals;
    },
  };

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => runtimeListeners.length >= 2);
  const listener = runtimeListeners[runtimeListeners.length - 1];
  let response;
  const handled = listener(
    { action: 'PAGE_SIGNALS_COLLECT_V1', frameId: 4, budgetMs: 12 },
    {},
    (payload) => {
      response = payload;
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(response, { ok: true, signals });
});

test('PAGE_SIGNALS_COLLECT_V1 reports unavailable adapter without throwing', async () => {
  const { runtimeListeners } = setupGlobals({ featureFlags: { smartScopeV2: true } });

  await import(`../content/content-main.js?run=${Date.now()}`);
  await waitFor(() => runtimeListeners.length >= 2);
  const listener = runtimeListeners[runtimeListeners.length - 1];
  let response;
  const handled = listener(
    { action: 'PAGE_SIGNALS_COLLECT_V1' },
    {},
    (payload) => {
      response = payload;
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(response, { ok: false, error: 'PAGE_SIGNALS_ADAPTER_UNAVAILABLE' });
});
