import assert from 'node:assert/strict';
import { afterEach, test, mock } from 'node:test';

import {
  BLOCK_MS,
  computeSitePolicy,
  recordApplyOutcome,
} from '../../background/site-policy-manager.js';
import { SITE_BLOCK_REASONS, STORAGE_KEYS } from '../../shared/constants.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../../shared/feature-flags.js';

function setupChromeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));

  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            const result = {};
            key.forEach((item) => {
              result[item] = store.get(item);
            });
            return result;
          }
          return { [key]: store.get(key) };
        },
        async set(entries) {
          Object.entries(entries).forEach(([key, value]) => {
            store.set(key, value);
          });
        },
      },
    },
  };

  return store;
}

afterEach(() => {
  mock.timers.reset();
  __resetFeatureFlagCacheForTests();
  delete global.chrome;
});

test('computeSitePolicy blocks unsupported schemes', async () => {
  setupChromeStorage();

  const policy = await computeSitePolicy({ url: 'chrome://extensions', now: 1000 });
  const firefoxExtensionPolicy = await computeSitePolicy({ url: 'moz-extension://extension-id/options.html', now: 1000 });

  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, SITE_BLOCK_REASONS.UNSUPPORTED_SCHEME);
  assert.equal(firefoxExtensionPolicy.allowed, false);
  assert.equal(firefoxExtensionPolicy.reason, SITE_BLOCK_REASONS.UNSUPPORTED_SCHEME);
});

test('recordApplyOutcome blocks host after structural failures', async () => {
  mock.timers.enable({ apis: ['Date'] });
  const store = setupChromeStorage();

  await recordApplyOutcome({ url: 'https://example.com', ok: false, failReason: 'SCOPE_REJECTED' });
  await recordApplyOutcome({ url: 'https://example.com', ok: false, failReason: 'SCOPE_REJECTED' });
  await recordApplyOutcome({ url: 'https://example.com', ok: false, failReason: 'SCOPE_REJECTED' });

  const failures = store.get(STORAGE_KEYS.SITE_FAILURES_V1);
  const entry = failures?.['example.com'];
  const now = Date.now();

  assert.equal(entry.failCount, 3);
  assert.equal(entry.blockedUntil, now + BLOCK_MS);

  __applyFlagOverridesForTests({ siteSuppressV1: true });
  const policy = await computeSitePolicy({ url: 'https://example.com', now });

  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE);
  assert.equal(policy.blockedUntil, entry.blockedUntil);
});

test('recordApplyOutcome resets failures on success', async () => {
  const store = setupChromeStorage({
    [STORAGE_KEYS.SITE_FAILURES_V1]: {
      'example.com': {
        failCount: 2,
        windowStartAt: 0,
        lastFailAt: 0,
        lastFailReason: 'SCOPE_REJECTED',
        blockedUntil: 1000,
      },
    },
  });

  await recordApplyOutcome({ url: 'https://example.com', ok: true });

  const failures = store.get(STORAGE_KEYS.SITE_FAILURES_V1);
  assert.equal(failures?.['example.com'], undefined);
});

test('computeSitePolicy allows overrides to bypass suppression', async () => {
  setupChromeStorage({
    [STORAGE_KEYS.SITE_OVERRIDES_V1]: {
      'example.com': {
        overrideUntil: 5000,
      },
    },
  });

  __applyFlagOverridesForTests({ siteSuppressV1: true });
  const policy = await computeSitePolicy({ url: 'https://example.com', now: 1000 });

  assert.equal(policy.allowed, true);
  assert.equal(policy.reason, SITE_BLOCK_REASONS.OVERRIDE_ACTIVE);
  assert.equal(policy.overrideUntil, 5000);
});

test('computeSitePolicy does not apply an ambiguous pre-PSL failure key', async () => {
  const now = Date.now();
  setupChromeStorage({
    [STORAGE_KEYS.SITE_FAILURES_V1]: {
      'co.ma': { blockedUntil: now + 60_000 },
    },
  });
  __applyFlagOverridesForTests({ siteSuppressV1: true });

  const policy = await computeSitePolicy({ url: 'https://secure.bank.co.ma/login', now });
  assert.equal(policy.allowed, true);
  assert.equal(policy.host, 'bank.co.ma');
});

test('computeSitePolicy fails closed when sensitive storage cannot be read', async () => {
  setupChromeStorage();
  __applyFlagOverridesForTests({ siteSuppressV1: true });
  global.chrome.storage.local.get = async () => {
    throw new Error('storage offline');
  };

  const policy = await computeSitePolicy({ url: 'https://example.com', now: Date.now() });
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, 'INTERNAL_ERROR');
  assert.equal(policy.detail, 'STORAGE_UNAVAILABLE');
});
