import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

const API_KEY = 'AURA_CONTENT_BOOTSTRAP_V1';
const STATE_KEY = '__AURA_CONTENT_BOOTSTRAP_STATE_V1__';
const ROUTER_API_KEY = 'AURA_CONTENT_MESSAGE_ROUTER_V1';

function createMessagePort() {
  const listeners = new Set();
  return {
    listeners,
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
  };
}

async function loadFacade() {
  delete globalThis[API_KEY];
  delete globalThis[ROUTER_API_KEY];
  await import(`../../content/content-bootstrap.runtime.js?test=${Date.now()}-${Math.random()}`);
  return globalThis[API_KEY];
}

afterEach(() => {
  delete globalThis[API_KEY];
  delete globalThis[STATE_KEY];
  delete globalThis.chrome;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.__AURA_DOCUMENT_INSTANCE_ID__;
  delete globalThis.__AURA_CONTENT_MAIN_LOADED__;
});

test('content bootstrap script publishes one frozen inert facade', async () => {
  const facade = await loadFacade();

  assert.equal(facade.version, 1);
  assert.equal(Object.isFrozen(facade), true);
  assert.equal(Object.isFrozen(facade.phases), true);
  assert.equal(globalThis[STATE_KEY], undefined, 'loading the classic script must not activate a runtime');
});

test('content-main fails closed when its preloaded bootstrap facade is absent', async () => {
  delete globalThis[API_KEY];
  delete globalThis.chrome;
  delete globalThis.window;
  delete globalThis.document;

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await import(`../../content/content-main.js?missing-bootstrap=${Date.now()}-${Math.random()}`);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(errors[0]?.[0], '[CS] Content bootstrap runtime unavailable');
  assert.equal(globalThis[STATE_KEY], undefined);
  assert.equal(globalThis.__AURA_DOCUMENT_INSTANCE_ID__, undefined);
  assert.equal(globalThis.__AURA_CONTENT_MAIN_LOADED__, undefined);
});

test('content-main fails closed when a versioned facade returns an invalid state', async () => {
  globalThis[API_KEY] = Object.freeze({ version: 1, getOrCreate: () => ({ version: 1 }) });
  globalThis.chrome = {
    runtime: {
      id: 'aura-test',
      getURL: (value) => value,
      onMessage: { addListener() {}, removeListener() {} },
    },
  };
  globalThis.window = {};
  globalThis.window.top = globalThis.window;

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await import(`../../content/content-main.js?invalid-bootstrap=${Date.now()}-${Math.random()}`);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(errors[0]?.[0], '[CS] Content bootstrap runtime activation failed');
  assert.equal(errors[0]?.[1]?.message, 'CONTENT_BOOTSTRAP_STATE_INVALID');
  assert.equal(globalThis.window.__AURA_CONTENT_BOOTSTRAP_STATE_V1__, undefined);
  assert.equal(globalThis.window.__AURA_DOCUMENT_INSTANCE_ID__, undefined);
  assert.equal(globalThis.window.__AURA_CONTENT_MAIN_LOADED__, undefined);
});

test('content-main contains no legacy inline bootstrap fallback', () => {
  const source = readFileSync(new URL('../../content/content-main.js', import.meta.url), 'utf8');

  assert.match(source, /AURA_CONTENT_BOOTSTRAP_V1/);
  assert.match(source, /api\.getOrCreate/);
  assert.doesNotMatch(source, /createInlineBootstrapState/);
  assert.doesNotMatch(source, /CONTENT_BOOTSTRAP_PHASES/);
  assert.doesNotMatch(source, /function ensurePingListener/);
});

test('content-main records a missing router as retryable without registering a main listener', async () => {
  const facade = await loadFacade();
  const listeners = new Set();
  globalThis.chrome = {
    runtime: {
      id: 'aura-test',
      getURL: (value) => value,
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
    },
  };
  globalThis.window = {};
  globalThis.window.top = globalThis.window;
  globalThis[API_KEY] = facade;
  delete globalThis[ROUTER_API_KEY];

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await import(`../../content/content-main.js?missing-router=${Date.now()}-${Math.random()}`);
  } finally {
    console.error = originalConsoleError;
  }

  const state = globalThis.window[STATE_KEY];
  assert.equal(errors[0]?.[0], '[CS] Content message router unavailable');
  assert.equal(state.phase, 'RETRYABLE_FAILED');
  assert.equal(state.lastFailure.reason, 'CONTENT_MESSAGE_ROUTER_UNAVAILABLE');
  assert.equal(typeof globalThis.window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__, 'undefined');
  assert.equal(listeners.size, 1, 'only the bootstrap early listener remains');
});

test('content-main treats an incompatible router facade as terminal without registering a listener', async () => {
  const facade = await loadFacade();
  const listeners = new Set();
  globalThis.chrome = {
    runtime: {
      id: 'aura-test',
      getURL: (value) => value,
      onMessage: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
    },
  };
  globalThis.window = {};
  globalThis.window.top = globalThis.window;
  globalThis[API_KEY] = facade;
  globalThis[ROUTER_API_KEY] = Object.freeze({ version: 2, createListener() {} });

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await import(`../../content/content-main.js?incompatible-router=${Date.now()}-${Math.random()}`);
  } finally {
    console.error = originalConsoleError;
  }

  const state = globalThis.window[STATE_KEY];
  assert.equal(errors[0]?.[0], '[CS] Content message router incompatible');
  assert.equal(state.phase, 'INVALIDATED');
  assert.equal(state.lastFailure.reason, 'CONTENT_MESSAGE_ROUTER_INCOMPATIBLE');
  assert.equal(typeof globalThis.window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__, 'undefined');
  assert.equal(listeners.size, 1, 'only the bootstrap early listener remains');
});

test('one document keeps identity across SPA URL changes and retry generations', async () => {
  const facade = await loadFacade();
  const scope = { location: { href: 'https://example.test/article' } };
  const messagePort = createMessagePort();
  let idCounter = 0;
  let clock = 100;
  const state = facade.getOrCreate({
    scope,
    messagePort,
    isTopFrame: () => true,
    createDocumentId: () => `document-${++idCounter}`,
    now: () => ++clock,
  });

  assert.equal(state.phase, 'NEW');
  assert.equal(messagePort.listeners.size, 1);
  const firstClaim = state.claim();
  assert.deepEqual(firstClaim, { claimed: true, alreadyLoaded: false, generation: 1 });
  assert.equal(state.markRetryableFailed(1, 'TIMEOUT', 3), true);
  assert.deepEqual(state.lastFailure, { reason: 'TIMEOUT', attempts: 3, timestamp: 101 });

  scope.location.href = 'https://example.test/article?page=2';
  const sameState = facade.getOrCreate({
    scope,
    messagePort,
    isTopFrame: () => true,
    createDocumentId: () => `document-${++idCounter}`,
  });
  assert.equal(sameState, state);
  assert.equal(sameState.documentInstanceId, 'document-1');
  assert.deepEqual(sameState.claim(), { claimed: true, alreadyLoaded: false, generation: 2 });
  assert.equal(sameState.markReady(1, () => {}), false, 'a stale completion cannot own the new generation');
  assert.equal(sameState.markReady(2, () => {}), true);
  assert.equal(sameState.phase, 'READY');
});

test('a complete reload to the same URL receives a different document identity', async () => {
  const facade = await loadFacade();
  let idCounter = 0;
  const options = {
    isTopFrame: () => true,
    createDocumentId: () => `reload-${++idCounter}`,
  };
  const first = facade.getOrCreate({
    ...options,
    scope: { location: { href: 'https://example.test/same' } },
  });
  const second = facade.getOrCreate({
    ...options,
    scope: { location: { href: 'https://example.test/same' } },
  });

  assert.equal(first.documentInstanceId, 'reload-1');
  assert.equal(second.documentInstanceId, 'reload-2');
});

test('early responses expose structured retry state and top-frame-only context', async () => {
  const facade = await loadFacade();
  const topScope = { location: { href: 'https://example.test/top' } };
  const topPort = createMessagePort();
  const topState = facade.getOrCreate({
    scope: topScope,
    messagePort: topPort,
    isTopFrame: () => true,
    createDocumentId: () => 'top-document',
  });
  const [topListener] = topPort.listeners;
  topState.claim();
  topState.markRetryableFailed(1, 'NO_RECEIVER', 3);

  let pingResponse;
  assert.equal(topListener({ action: 'TEST_PING_CONTENT' }, {}, (value) => {
    pingResponse = value;
  }), true);
  assert.deepEqual(pingResponse, {
    ok: false,
    phase: 'RETRYABLE_FAILED',
    reason: 'NO_RECEIVER',
    retryable: true,
  });

  let contextResponse;
  assert.equal(topListener({ action: 'GET_DOCUMENT_CONTEXT_V1' }, {}, (value) => {
    contextResponse = value;
  }), true);
  assert.deepEqual(contextResponse, {
    ok: true,
    documentInstanceId: 'top-document',
    url: 'https://example.test/top',
  });

  const childPort = createMessagePort();
  const childState = facade.getOrCreate({
    scope: { location: { href: 'https://example.test/child' } },
    messagePort: childPort,
    isTopFrame: () => false,
    createDocumentId: () => 'child-document',
  });
  const [childListener] = childPort.listeners;
  assert.equal(childListener({ action: 'GET_DOCUMENT_CONTEXT_V1' }, {}, () => {
    assert.fail('a child frame must never answer the document context route');
  }), false);
  childState.invalidate(0, 'test-invalidated');
  assert.equal(childListener({ action: 'TEST_PING_CONTENT' }, {}, () => {}), true);
});

test('listener ownership can be rearmed and terminal invalidation rejects stale work', async () => {
  const facade = await loadFacade();
  const scope = {};
  const messagePort = createMessagePort();
  const state = facade.getOrCreate({
    scope,
    messagePort,
    isTopFrame: () => true,
    createDocumentId: () => 'owned-document',
  });
  const claim = state.claim();
  const mainListener = () => false;
  assert.equal(state.markReady(claim.generation, mainListener), true);

  messagePort.addListener(mainListener);
  assert.equal(state.rearmMainListener(), true);
  assert.equal(messagePort.listeners.size, 2);
  assert.equal(state.detachEarlyListener(), true);
  assert.deepEqual([...messagePort.listeners], [mainListener]);
  assert.equal(state.invalidate(claim.generation, 'context-invalidated'), true);
  assert.deepEqual(state.claim(), { claimed: false, invalidated: true, generation: 1 });
  assert.equal(state.markReady(claim.generation, mainListener), false);
});
