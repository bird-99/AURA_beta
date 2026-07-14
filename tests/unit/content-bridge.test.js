import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ContentBridge } from '../../background/content-bridge.js';

function installChromeMock({ pingResults }) {
  const scriptCalls = [];
  const responses = [...pingResults];

  globalThis.chrome = {
    runtime: { lastError: null },
    tabs: {
      async get(tabId) {
        return { id: tabId, url: 'https://example.test/article' };
      },
      sendMessage(tabId, message, options, callback) {
        const actualCallback = typeof options === 'function' ? options : callback;
        const next = responses.shift() || { ok: true };
        if (next?.error) {
          globalThis.chrome.runtime.lastError = { message: next.error };
          actualCallback(undefined);
          globalThis.chrome.runtime.lastError = null;
          return;
        }
        actualCallback(next);
      },
    },
    scripting: {
      async executeScript(payload) {
        scriptCalls.push(payload);
      },
    },
  };

  return scriptCalls;
}

function createBridge() {
  return new ContentBridge({
    receiverMaxAttempts: 4,
    receiverBaseDelayMs: 0,
    injectFiles: [
      'runtime-a.js',
      'content/content-message-router.runtime.js',
      'content/content-main.js',
    ],
    entrypointFiles: [
      'content/content-message-router.runtime.js',
      'content/content-main.js',
    ],
    debug: true,
  });
}

afterEach(() => {
  delete globalThis.chrome;
});

test('ContentBridge waits for BOOTSTRAPPING without injecting', async () => {
  const scriptCalls = installChromeMock({
    pingResults: [
      { ok: false, phase: 'BOOTSTRAPPING', retryable: false },
      { ok: true },
    ],
  });

  const result = await createBridge().ensureReceiver(7);

  assert.equal(result.ok, true);
  assert.equal(result.injected, false);
  assert.equal(result.attempts, 2);
  assert.deepEqual(scriptCalls, []);
});

test('ContentBridge reinjects the router and entrypoint after a retryable bootstrap failure', async () => {
  const scriptCalls = installChromeMock({
    pingResults: [
      { ok: false, phase: 'RETRYABLE_FAILED', reason: 'TIMEOUT', retryable: true },
      { ok: true },
    ],
  });

  const result = await createBridge().ensureReceiver(8, { frameId: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.injected, true);
  assert.deepEqual(scriptCalls, [{
    target: { tabId: 8, frameIds: [0] },
    files: [
      'content/content-message-router.runtime.js',
      'content/content-main.js',
    ],
  }]);
});

test('ContentBridge injects the complete runtime only when the receiver is absent', async () => {
  const scriptCalls = installChromeMock({
    pingResults: [
      { error: 'Receiving end does not exist.' },
      { ok: true },
    ],
  });

  const result = await createBridge().ensureReceiver(9);

  assert.equal(result.ok, true);
  assert.equal(result.injected, true);
  assert.deepEqual(scriptCalls, [{
    target: { tabId: 9 },
    files: [
      'runtime-a.js',
      'content/content-message-router.runtime.js',
      'content/content-main.js',
    ],
  }]);
});

test('ContentBridge fails closed for an invalidated bootstrap', async () => {
  const scriptCalls = installChromeMock({
    pingResults: [{
      ok: false,
      phase: 'INVALIDATED',
      reason: 'context-invalidated',
      retryable: false,
    }],
  });

  const result = await createBridge().ensureReceiver(10);

  assert.equal(result.ok, false);
  assert.equal(result.lastErrorMessage, 'context-invalidated');
  assert.deepEqual(scriptCalls, []);
});
