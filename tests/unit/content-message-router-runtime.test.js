import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const API_KEY = 'AURA_CONTENT_MESSAGE_ROUTER_V1';
const STATE_KEY = '__AURA_CONTENT_MESSAGE_ROUTER_STATE_V1__';

async function loadFresh(label = 'router') {
  await import(`../../content/content-message-router.runtime.js?${label}=${Date.now()}-${Math.random()}`);
  return globalThis[API_KEY];
}

function route(ownership = 'FRAME_SAFE', response = 'sync', identity = 'SUPPLIED_STRICT') {
  return { owner: 'test', ownership, response, identity, effect: 'READ' };
}

function createFixture(overrides = {}) {
  const routes = {
    SYNC: route(),
    ASYNC: route('FRAME_TARGETED', 'async'),
    TOP: route('TOP_FRAME_ONLY'),
    TEST: route('TEST_ONLY'),
    NONE: route('FRAME_SAFE', 'sync', 'NONE'),
  };
  const handlers = {
    SYNC: (message) => ({ ok: true, value: message.value }),
    ASYNC: async () => ({ ok: true, async: true }),
    TOP: () => ({ ok: true, top: true }),
    TEST: () => ({ ok: true, test: true }),
    NONE: () => ({ ok: true, identity: 'none' }),
  };
  return {
    routes,
    handlers,
    isTopFrame: () => true,
    isTestHooksEnabled: () => true,
    isInvalidated: () => false,
    getDocumentInstanceId: () => 'document-current',
    mapError: (action, error) => ({ ok: false, action, detail: error?.message }),
    ...overrides,
  };
}

function callListener(listener, message, sender = {}) {
  const responses = [];
  const claimed = listener(message, sender, (payload) => responses.push(payload));
  return { claimed, responses };
}

afterEach(() => {
  delete globalThis[API_KEY];
  delete globalThis[STATE_KEY];
  delete globalThis.chrome;
  delete globalThis.window;
  delete globalThis.document;
});

test('router facade is frozen, inert, Chrome-free and DOM-free at load', async () => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    get() {
      throw new Error('chrome must not be read');
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get() {
      throw new Error('window must not be read');
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    get() {
      throw new Error('document must not be read');
    },
  });

  const api = await loadFresh('inert');

  assert.equal(api.version, 1);
  assert.equal(typeof api.createListener, 'function');
  assert.equal(Object.isFrozen(api), true);
  assert.equal(globalThis[STATE_KEY], undefined);
});

test('compatible reinjection preserves the same facade', async () => {
  const first = await loadFresh('first');
  const second = await loadFresh('second');

  assert.equal(second, first);
  assert.equal(Object.isFrozen(second), true);
});

test('incompatible pre-existing facade fails instead of being overwritten', async () => {
  const incompatible = { version: 2, createListener() {} };
  globalThis[API_KEY] = incompatible;

  await assert.rejects(loadFresh('incompatible'), /CONTENT_MESSAGE_ROUTER_API_INCOMPATIBLE/);
  assert.equal(globalThis[API_KEY], incompatible);
});

test('factory rejects missing, extra and invalid route handlers', async () => {
  const api = await loadFresh('registry');
  const fixture = createFixture();

  assert.throws(
    () => api.createListener({ ...fixture, handlers: { ...fixture.handlers, ASYNC: undefined } }),
    /CONTENT_MESSAGE_ROUTER_ROUTE_INVALID:ASYNC/,
  );
  assert.throws(
    () => api.createListener({ ...fixture, handlers: { ...fixture.handlers, EXTRA() {} } }),
    /CONTENT_MESSAGE_ROUTER_REGISTRY_MISMATCH/,
  );
  assert.throws(
    () => api.createListener({ ...fixture, routes: { ...fixture.routes, TOP: route('UNKNOWN') } }),
    /CONTENT_MESSAGE_ROUTER_ROUTE_INVALID:TOP/,
  );
});

test('listener preserves reserved, unknown, top-frame and test-only ownership', async () => {
  const api = await loadFresh('ownership');
  const topListener = api.createListener(createFixture());

  assert.deepEqual(callListener(topListener, { action: 'GET_DOCUMENT_CONTEXT_V1' }), {
    claimed: false,
    responses: [],
  });
  assert.deepEqual(callListener(topListener, { action: 'UNKNOWN' }), { claimed: false, responses: [] });
  assert.deepEqual(callListener(topListener, { action: '__proto__' }), { claimed: false, responses: [] });
  assert.deepEqual(callListener(topListener, { action: 'TOP' }), {
    claimed: true,
    responses: [{ ok: true, top: true }],
  });

  const childListener = api.createListener(createFixture({ isTopFrame: () => false }));
  assert.deepEqual(callListener(childListener, { action: 'TOP' }), { claimed: false, responses: [] });
  assert.deepEqual(callListener(childListener, { action: 'TEST' }), { claimed: false, responses: [] });

  const hooksOffListener = api.createListener(createFixture({ isTestHooksEnabled: () => false }));
  assert.deepEqual(callListener(hooksOffListener, { action: 'TEST' }), { claimed: false, responses: [] });
});

test('identity NONE ignores a supplied mismatch while SUPPLIED_STRICT rejects it', async () => {
  const api = await loadFresh('identity');
  const listener = api.createListener(createFixture());

  assert.deepEqual(callListener(listener, {
    action: 'NONE',
    expectedDocumentInstanceId: 'old-document',
  }), {
    claimed: true,
    responses: [{ ok: true, identity: 'none' }],
  });
  assert.deepEqual(callListener(listener, {
    action: 'SYNC',
    expectedDocumentInstanceId: 'old-document',
  }), {
    claimed: true,
    responses: [{ ok: false, error: 'DOCUMENT_IDENTITY_MISMATCH' }],
  });
});

test('invalidated contexts and diagnostic test pings preserve preflight behavior', async () => {
  const api = await loadFresh('preflight');
  const invalidated = api.createListener(createFixture({ isInvalidated: () => true }));
  assert.deepEqual(callListener(invalidated, { action: 'SYNC' }), {
    claimed: true,
    responses: [{ received: false, reason: 'context-invalidated' }],
  });

  const top = api.createListener(createFixture());
  assert.deepEqual(callListener(top, { type: 'AURA_PING_TEST_V1' }), {
    claimed: true,
    responses: [{ ok: true, type: 'AURA_PONG_TEST_V1' }],
  });
  const child = api.createListener(createFixture({ isTopFrame: () => false }));
  assert.deepEqual(callListener(child, { type: 'AURA_PING_TEST_V1' }), {
    claimed: false,
    responses: [],
  });
});

test('sync and async handlers are claimed synchronously and answer exactly once', async () => {
  const api = await loadFresh('responses');
  const listener = api.createListener(createFixture());

  const sync = callListener(listener, { action: 'SYNC', value: 42 });
  assert.deepEqual(sync, { claimed: true, responses: [{ ok: true, value: 42 }] });

  const asyncResult = callListener(listener, { action: 'ASYNC' });
  assert.equal(asyncResult.claimed, true);
  assert.deepEqual(asyncResult.responses, []);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(asyncResult.responses, [{ ok: true, async: true }]);
});

test('handler failures use error mapping and sync thenables fail closed', async () => {
  const api = await loadFresh('errors');
  const rejectedFixture = createFixture();
  rejectedFixture.handlers.ASYNC = async () => {
    throw new Error('forced-async-failure');
  };
  const rejected = callListener(api.createListener(rejectedFixture), { action: 'ASYNC' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(rejected.responses, [{
    ok: false,
    action: 'ASYNC',
    detail: 'forced-async-failure',
  }]);

  const mismatchFixture = createFixture();
  mismatchFixture.handlers.SYNC = () => Promise.resolve({ ok: true });
  assert.deepEqual(callListener(api.createListener(mismatchFixture), { action: 'SYNC' }), {
    claimed: true,
    responses: [{ ok: false, error: 'CONTENT_ROUTE_RESPONSE_MISMATCH' }],
  });
});
