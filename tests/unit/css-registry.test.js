import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CssRegistry } from '../../background/css-registry.js';

function setupSessionStorage() {
  const store = new Map();
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: store.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => store.set(key, value));
        },
      },
    },
  };
  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('CssRegistry cleanup preserves explicitly referenced CSS ids', async () => {
  const store = setupSessionStorage();
  const registry = new CssRegistry('testCssRegistry');
  const now = Date.now();

  store.set('testCssRegistry', {
    keep: {
      cssId: 'keep',
      cssText: 'body { color: red; }',
      origin: 'AUTHOR',
      meta: { createdAt: now - 100_000 },
    },
    drop: {
      cssId: 'drop',
      cssText: 'body { color: blue; }',
      origin: 'AUTHOR',
      meta: { createdAt: now - 100_000 },
    },
  });

  const result = await registry.cleanup({ maxAgeMs: 1, preserveCssIds: ['keep'] });

  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(store.get('testCssRegistry')).sort(), ['keep']);
});

test('CssRegistry max entry cleanup never drops preserved CSS ids', async () => {
  const store = setupSessionStorage();
  const registry = new CssRegistry('testCssRegistry');

  store.set('testCssRegistry', {
    old: {
      cssId: 'old',
      cssText: 'body { color: red; }',
      origin: 'AUTHOR',
      meta: { createdAt: 1 },
    },
    new: {
      cssId: 'new',
      cssText: 'body { color: blue; }',
      origin: 'AUTHOR',
      meta: { createdAt: 2 },
    },
  });

  const result = await registry.cleanup({ maxAgeMs: 0, maxEntries: 1, preserveCssIds: ['old'] });

  assert.equal(result.removed, 0);
  assert.deepEqual(Object.keys(store.get('testCssRegistry')).sort(), ['new', 'old']);
});
