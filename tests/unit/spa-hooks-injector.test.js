import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ensureSpaHooksMainInjected } from '../../background/spa-hooks-injector.js';
import {
  __applyFlagOverridesForTests,
  __resetFeatureFlagCacheForTests,
} from '../../shared/feature-flags.js';

function setupChromeStubs({ url = 'https://example.com', executeScript } = {}) {
  global.chrome = {
    tabs: {
      async get() {
        return { id: 123, url };
      },
    },
    scripting: {
      executeScript,
    },
  };
}

afterEach(() => {
  delete global.chrome;
  __resetFeatureFlagCacheForTests();
});

test('ensureSpaHooksMainInjected checks MAIN world before injecting', async () => {
  __applyFlagOverridesForTests({ smartScopeSpaHooks: true });
  const calls = [];
  setupChromeStubs({
    executeScript: async (args) => {
      calls.push(args);
      return [{ result: true }];
    },
  });

  const result = await ensureSpaHooksMainInjected(123);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].world, 'MAIN');
  assert.equal(typeof calls[0].func, 'function');
});

test('ensureSpaHooksMainInjected injects runtime only when needed', async () => {
  __applyFlagOverridesForTests({ smartScopeSpaHooks: true });
  const calls = [];
  const responses = [[{ result: false }], [], [{ result: true }]];

  setupChromeStubs({
    executeScript: async (args) => {
      calls.push(args);
      return responses.shift();
    },
  });

  const result = await ensureSpaHooksMainInjected(456);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].world, 'MAIN');
  assert.equal(typeof calls[0].func, 'function');
  assert.deepEqual(calls[1].files, ['content/spa-hooks-v2.runtime.js']);
  assert.equal(calls[1].world, 'MAIN');
});

test('ensureSpaHooksMainInjected skips unsupported schemes', async () => {
  __applyFlagOverridesForTests({ smartScopeSpaHooks: true });
  const calls = [];

  setupChromeStubs({
    url: 'chrome://extensions/',
    executeScript: async (args) => {
      calls.push(args);
      return [{ result: true }];
    },
  });

  const result = await ensureSpaHooksMainInjected(789);

  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});
