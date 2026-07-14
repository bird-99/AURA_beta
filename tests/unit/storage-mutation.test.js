import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function installNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
}

function createLockManager() {
  const tails = new Map();
  return {
    request(name, _options, callback) {
      const previous = tails.get(name) || Promise.resolve();
      const run = previous.catch(() => undefined).then(callback);
      const tail = run.then(() => undefined, () => undefined).finally(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
      tails.set(name, tail);
      return run;
    },
  };
}

afterEach(() => {
  delete globalThis.chrome;
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
});

test('serializes one storage key across independent extension module contexts', async () => {
  const store = { shared: 0 };
  installNavigator({ locks: createLockManager() });
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          await new Promise((resolve) => setImmediate(resolve));
          return { [key]: store[key] };
        },
        async set(values) {
          await new Promise((resolve) => setImmediate(resolve));
          Object.assign(store, values);
        },
      },
    },
  };

  const first = await import(`../../shared/utils.js?storage-context=first-${Date.now()}`);
  const second = await import(`../../shared/utils.js?storage-context=second-${Date.now()}`);
  await Promise.all([
    first.mutateSessionValue('shared', (value) => Number(value || 0) + 1),
    second.mutateSessionValue('shared', (value) => Number(value || 0) + 1),
  ]);

  assert.equal(store.shared, 2);
});

test('set helpers propagate persistence errors', async () => {
  installNavigator({});
  globalThis.chrome = {
    storage: {
      local: {
        async set() {
          throw new Error('quota unavailable');
        },
      },
    },
  };
  const { setToLocal } = await import(`../../shared/utils.js?storage-errors=${Date.now()}`);
  await assert.rejects(setToLocal('key', {}), /quota unavailable/);
});

test('structured reads distinguish found, missing, and storage errors', async () => {
  installNavigator({});
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === 'broken') throw new Error('storage offline');
          if (key === 'present') return { present: false };
          return {};
        },
      },
    },
  };
  const { readLocalValueResult } = await import(`../../shared/utils.js?structured-reads=${Date.now()}`);
  assert.deepEqual(await readLocalValueResult('present'), {
    ok: true,
    status: 'found',
    value: false,
    error: null,
  });
  assert.deepEqual(await readLocalValueResult('missing'), {
    ok: true,
    status: 'missing',
    value: null,
    error: null,
  });
  const failed = await readLocalValueResult('broken');
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'error');
  assert.match(failed.error.message, /storage offline/);
});
