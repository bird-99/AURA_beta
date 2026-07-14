import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAuraTabId, resolveAuraTabForTest } from '../e2e/helpers/launch-with-extension.js';

function createServiceWorker(tabs) {
  return {
    async evaluate(fn, args) {
      const previousChrome = global.chrome;
      global.chrome = {
        tabs: {
          query: async () => tabs,
        },
      };

      try {
        return await fn(args);
      } finally {
        global.chrome = previousChrome;
      }
    },
  };
}

test('getAuraTabId resolves an exact tab url match', async () => {
  const serviceWorker = createServiceWorker([
    { id: 1, url: 'http://aura.local/other.html' },
    { id: 2, url: 'http://aura.local/basic.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html');

  assert.equal(tabId, 2);
});

test('getAuraTabId resolves an exact pendingUrl match', async () => {
  const serviceWorker = createServiceWorker([
    { id: 3, url: 'http://aura.local/old.html', pendingUrl: 'http://aura.local/basic.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html');

  assert.equal(tabId, 3);
});

test('getAuraTabId does not fall back to a same-host tab by default', async () => {
  const serviceWorker = createServiceWorker([
    { id: 4, url: 'http://aura.local/other.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html');

  assert.equal(tabId, null);
});

test('getAuraTabId can use an explicit unambiguous host fallback', async () => {
  const serviceWorker = createServiceWorker([
    { id: 5, url: 'http://aura.local/other.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html', {
    allowHostFallback: true,
  });

  assert.equal(tabId, 5);
});

test('getAuraTabId rejects ambiguous exact matches', async () => {
  const serviceWorker = createServiceWorker([
    { id: 6, url: 'http://aura.local/basic.html' },
    { id: 7, pendingUrl: 'http://aura.local/basic.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html');

  assert.equal(tabId, null);
});

test('getAuraTabId rejects ambiguous host fallbacks', async () => {
  const serviceWorker = createServiceWorker([
    { id: 8, url: 'http://aura.local/first.html' },
    { id: 9, url: 'http://aura.local/second.html' },
  ]);

  const tabId = await getAuraTabId(serviceWorker, 'http://aura.local/basic.html', {
    allowHostFallback: true,
  });

  assert.equal(tabId, null);
});

test('resolveAuraTabForTest exposes diagnostics for missing exact matches', async () => {
  const serviceWorker = createServiceWorker([
    { id: 10, url: 'http://aura.local/other.html' },
  ]);

  const resolution = await resolveAuraTabForTest(serviceWorker, 'http://aura.local/basic.html');

  assert.equal(resolution.ok, false);
  assert.equal(resolution.tabId, null);
  assert.equal(resolution.reason, 'NO_EXACT_MATCH');
  assert.deepEqual(resolution.candidates, [
    {
      id: 10,
      url: 'http://aura.local/other.html',
      pendingUrl: null,
      active: false,
    },
  ]);
});
