import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  __resetFeatureFlagCacheForTests,
  getAllFlags,
  getAllFeatureFlags,
  initFeatureFlags,
  isFlagEnabled,
} from '../shared/feature-flags.js';
import { MODE_ENGINE_FLAG_DEFAULTS, MODE_ENGINE_FLAG_KEYS, STORAGE_KEYS } from '../shared/constants.js';

function buildChromeStub(initialFeatureFlags = {}) {
  const store = {
    [STORAGE_KEYS.FEATURE_FLAGS]: initialFeatureFlags,
  };

  let getCallCount = 0;
  const onChangedListeners = [];

  return {
    storage: {
      local: {
        async get(key) {
          getCallCount += 1;
          return { [key]: store[key] };
        },
        async set(entries) {
          Object.assign(store, entries);
        },
      },
      onChanged: {
        addListener(callback) {
          onChangedListeners.push(callback);
        },
      },
    },
    __emitChange(key, newValue) {
      store[key] = newValue;
      const payload = {
        [key]: { newValue },
      };
      onChangedListeners.forEach((listener) => listener(payload, 'local'));
    },
    __getCallCount() {
      return { get: getCallCount };
    },
  };
}

afterEach(() => {
  __resetFeatureFlagCacheForTests();
  delete global.chrome;
});

test('defaults resolve to ModeEngine defaults for all flags', async () => {
  global.chrome = buildChromeStub();

  await initFeatureFlags();
  const flags = getAllFlags();

  Object.entries(MODE_ENGINE_FLAG_DEFAULTS).forEach(([key, value]) => {
    assert.equal(flags[key], value, `${key} should fall back to default`);
  });

  assert.deepEqual(
    Object.keys(flags).sort(),
    MODE_ENGINE_FLAG_KEYS.slice().sort(),
    'enumerator should expose exactly the ModeEngine flags'
  );
});

test('unknown flag names are reported as disabled', async () => {
  global.chrome = buildChromeStub();

  await initFeatureFlags();

  assert.equal(isFlagEnabled('nonexistent-flag'), false);
});

test('storage overrides are applied when present', async () => {
  global.chrome = buildChromeStub({
    modeEngineCssGuardrails: true,
    debugModeEngine: true,
  });

  await initFeatureFlags();

  assert.equal(isFlagEnabled('modeEngineCssGuardrails'), true);
  assert.equal(isFlagEnabled('debugModeEngine'), true);
  assert.equal(isFlagEnabled('smartScopeV2'), true);
});

test('explicit false overrides are respected', async () => {
  const chromeStub = buildChromeStub({
    smartScopeV2: true,
  });
  global.chrome = chromeStub;

  await initFeatureFlags();
  assert.equal(isFlagEnabled('smartScopeV2'), true);

  chromeStub.__emitChange(STORAGE_KEYS.FEATURE_FLAGS, { smartScopeV2: false });

  assert.equal(isFlagEnabled('smartScopeV2'), false, 'explicit false should be applied');
});

test('ignores non-boolean override values', async () => {
  global.chrome = buildChromeStub({
    smartScopeV2: 'true',
    focusOverlayV2: 1,
  });

  await initFeatureFlags();
  const flags = getAllFeatureFlags();

  assert.equal(flags.smartScopeV2, true);
  assert.equal(flags.focusOverlayV2, true);
});

test('ignores unknown override keys while keeping known ones', async () => {
  global.chrome = buildChromeStub({
    smartScopeSpaHooks: true,
    unknownFlag: true,
  });

  await initFeatureFlags();
  const flags = getAllFeatureFlags();

  assert.equal(flags.smartScopeSpaHooks, true);
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'unknownFlag'), false);
});

test('cache updates when storage changes are observed', async () => {
  const chromeStub = buildChromeStub({
    smartScopeV2: true,
  });
  global.chrome = chromeStub;

  await initFeatureFlags();
  assert.equal(isFlagEnabled('smartScopeV2'), true);

  chromeStub.__emitChange(STORAGE_KEYS.FEATURE_FLAGS, { smartScopeSpaHooks: true });

  assert.equal(isFlagEnabled('smartScopeV2'), true, 'flag should reflect new overrides');
  assert.equal(isFlagEnabled('smartScopeSpaHooks'), true, 'updated flag should be enabled');
});

test('subsequent reads use the cached values without re-hitting storage', async () => {
  const chromeStub = buildChromeStub({
    smartScopeV2: false,
  });
  global.chrome = chromeStub;

  await initFeatureFlags();

  assert.equal(chromeStub.__getCallCount().get, 1, 'init should read overrides once');

  // Multiple reads should stay cached
  isFlagEnabled('smartScopeV2');
  getAllFlags();
  getAllFeatureFlags();

  assert.equal(chromeStub.__getCallCount().get, 1, 'cache should prevent extra storage reads');

  // Storage change should update cache without new storage.get calls
  chromeStub.__emitChange(STORAGE_KEYS.FEATURE_FLAGS, { smartScopeV2: true });

  assert.equal(isFlagEnabled('smartScopeV2'), true, 'onChanged should refresh cached flags');
  assert.equal(chromeStub.__getCallCount().get, 1, 'updates should rely on listener cache, not storage.get');
});
