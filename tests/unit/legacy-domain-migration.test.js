import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  inspectLegacyDomainMigration,
  migrateLegacyDomainData,
} from '../../background/legacy-domain-migration.js';
import { MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';

function setupStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
          }
          return { [keys]: store.get(keys) };
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) store.set(key, value);
        },
      },
    },
  };
  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('ambiguous co.ma history is copied only after confirmation and only to the current site', async () => {
  const modeId = MODE_IDS.COMFORT_VISUAL;
  const store = setupStorage({
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {
      'co.ma': { [modeId]: { decision: 'NEVER', intensity: 0.7 } },
    },
    [STORAGE_KEYS.DENYLIST]: ['co.ma'],
    [STORAGE_KEYS.ALLOWLIST]: ['co.ma'],
    [STORAGE_KEYS.COOLDOWNS]: {
      'co.ma': { [modeId]: { until: Date.now() + 60_000 } },
    },
    [STORAGE_KEYS.LEARNING_WEIGHTS]: {
      'co.ma': { [modeId]: { stage: 'AUTO', weight: 0.9 } },
    },
    [STORAGE_KEYS.SITE_FAILURES_V1]: { 'co.ma': { failCount: 3 } },
    [STORAGE_KEYS.SITE_OVERRIDES_V1]: { 'co.ma': { overrideUntil: Date.now() + 60_000 } },
    [STORAGE_KEYS.USER_PREFS]: {
      smartScope: { perDomain: { 'co.ma': { enabled: false } } },
    },
  });

  const bankInspection = await inspectLegacyDomainMigration('https://bank.co.ma/login');
  const shopInspection = await inspectLegacyDomainMigration('https://shop.co.ma/cart');
  assert.equal(bankInspection.available, true);
  assert.equal(shopInspection.available, true);
  assert.equal(store.get(STORAGE_KEYS.PER_DOMAIN_PREFS)['bank.co.ma'], undefined);
  assert.equal(store.get(STORAGE_KEYS.PER_DOMAIN_PREFS)['shop.co.ma'], undefined);

  assert.deepEqual(
    await migrateLegacyDomainData({ url: 'https://bank.co.ma/login', confirmed: false }),
    { ok: false, error: 'USER_CONFIRMATION_REQUIRED' },
  );
  const migrated = await migrateLegacyDomainData({
    url: 'https://bank.co.ma/login',
    confirmed: true,
  });
  assert.equal(migrated.ok, true);

  const perDomain = store.get(STORAGE_KEYS.PER_DOMAIN_PREFS);
  assert.deepEqual(perDomain['bank.co.ma'], perDomain['co.ma']);
  assert.equal(perDomain['shop.co.ma'], undefined);
  assert.ok(store.get(STORAGE_KEYS.DENYLIST).includes('bank.co.ma'));
  assert.equal(store.get(STORAGE_KEYS.DENYLIST).includes('shop.co.ma'), false);
  assert.ok(store.get(STORAGE_KEYS.COOLDOWNS)['bank.co.ma']);
  assert.equal(store.get(STORAGE_KEYS.COOLDOWNS)['shop.co.ma'], undefined);
  assert.ok(store.get(STORAGE_KEYS.LEARNING_WEIGHTS)['bank.co.ma']);
  assert.ok(store.get(STORAGE_KEYS.SITE_FAILURES_V1)['bank.co.ma']);
  assert.ok(store.get(STORAGE_KEYS.SITE_OVERRIDES_V1)['bank.co.ma']);
  assert.equal(store.get(STORAGE_KEYS.USER_PREFS).smartScope.perDomain['bank.co.ma'].enabled, false);
  assert.ok(store.get(STORAGE_KEYS.PER_DOMAIN_PREFS)['co.ma'], 'historical data must be retained');
});
