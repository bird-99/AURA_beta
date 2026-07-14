import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { DECISIONS, LEARNING_STAGES, MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';
import {
  DATA_PORTABILITY_SCHEMA_VERSION,
  buildExportPayload,
  importPayloadAndApply,
  resetAllData,
} from '../../shared/data-portability.js';
import { inspectLegacyDomainMigration } from '../../background/legacy-domain-migration.js';

function setupChromeStorage() {
  const store = new Map();
  let setCalls = 0;
  Object.defineProperty(store, 'setCalls', { get: () => setCalls });
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
        async set(data) {
          setCalls += 1;
          Object.entries(data).forEach(([key, value]) => {
            store.set(key, value);
          });
        },
        async clear() {
          store.clear();
        },
      },
      session: {
        async clear() {
          store.delete('session');
        },
      },
    },
  };

  return store;
}

function buildBasePayload(overrides = {}) {
  return {
    schemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    appVersion: 'test',
    userPrefs: {},
    perDomainPrefs: {},
    learningWeights: {},
    cooldowns: {},
    allowlist: [],
    denylist: [],
    ...overrides,
  };
}

afterEach(() => {
  delete global.chrome;
});

test('export/import preserves learning fields and drops unknown keys', async () => {
  const store = setupChromeStorage();
  store.set(STORAGE_KEYS.LEARNING_WEIGHTS, {
    'example.com': {
      'comfort-visual': {
        weight: 0.72,
        stage: LEARNING_STAGES.ASSISTED,
        decisionCount: 3,
        enableCount: 2,
        eligibilityVersion: 1,
        eligiblePositiveCount: 2,
        lastDecision: DECISIONS.NOT_NOW,
        extraField: 'ignore-me',
      },
    },
  });

  const payload = await buildExportPayload('1.2.3');
  await resetAllData();
  await importPayloadAndApply(payload);

  const learningWeights = store.get(STORAGE_KEYS.LEARNING_WEIGHTS);
  assert.deepEqual(learningWeights, {
    'example.com': {
      'comfort-visual': {
        weight: 0.72,
        stage: LEARNING_STAGES.ASSISTED,
        decisionCount: 3,
        enableCount: 2,
        eligibilityVersion: 1,
        eligiblePositiveCount: 2,
        lastDecision: DECISIONS.NOT_NOW,
      },
    },
  });
});

test('import fills missing learning fields with defaults', async () => {
  setupChromeStorage();
  const payload = buildBasePayload({
    learningWeights: {
      'example.com': {
        'comfort-visual': {
          weight: 0.4,
          lastDecision: 'DISMISSED',
        },
      },
    },
  });

  await importPayloadAndApply(payload);

  const learningWeights = (await chrome.storage.local.get(STORAGE_KEYS.LEARNING_WEIGHTS))[STORAGE_KEYS.LEARNING_WEIGHTS];
  assert.deepEqual(learningWeights, {
    'example.com': {
      'comfort-visual': {
        weight: 0.4,
        stage: LEARNING_STAGES.MANUAL,
        decisionCount: 0,
        enableCount: 0,
        eligibilityVersion: 0,
        eligiblePositiveCount: 0,
        lastDecision: DECISIONS.NOT_NOW,
      },
    },
  });
});

test('export/import excludes outcome ledger session data', async () => {
  const store = setupChromeStorage();
  store.set(STORAGE_KEYS.OUTCOME_LEDGER_V1, [{ pageUrl: 'https://private.example/path' }]);

  const payload = await buildExportPayload('1.2.3');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, STORAGE_KEYS.OUTCOME_LEDGER_V1), false);

  await resetAllData();
  await importPayloadAndApply(buildBasePayload({
    [STORAGE_KEYS.OUTCOME_LEDGER_V1]: [{ rawText: 'do not import' }],
  }));

  assert.equal(store.get(STORAGE_KEYS.OUTCOME_LEDGER_V1), undefined);
});

test('export/import excludes template memory by default', async () => {
  const store = setupChromeStorage();
  store.set(STORAGE_KEYS.TEMPLATE_MEMORY_V1, {
    schemaVersion: 1,
    hashVersion: 'tmh1',
    entries: [{ pageUrl: 'https://private.example/path', rawText: 'secret' }],
  });
  store.set(STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1, 'tms1_secretsecretsecretse');

  const payload = await buildExportPayload('1.2.3');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, STORAGE_KEYS.TEMPLATE_MEMORY_V1), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1), false);

  await resetAllData();
  await importPayloadAndApply(buildBasePayload({
    [STORAGE_KEYS.TEMPLATE_MEMORY_V1]: [{ rawText: 'do not import' }],
    [STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1]: 'do-not-import',
  }));

  assert.equal(store.get(STORAGE_KEYS.TEMPLATE_MEMORY_V1), undefined);
  assert.equal(store.get(STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1), undefined);
});

test('export/import excludes shadow replay lab data by default', async () => {
  const store = setupChromeStorage();
  store.set(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1, {
    schemaVersion: 1,
    entries: [{ rawSignals: { pageUrl: 'https://private.example/path' } }],
  });

  const payload = await buildExportPayload('1.2.3');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1), false);

  await resetAllData();
  await importPayloadAndApply(buildBasePayload({
    [STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1]: [{ selector: '#private' }],
  }));

  assert.equal(store.get(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1), undefined);
});

test('schema v2 round-trip preserves current mode, SmartScope and per-domain preferences', async () => {
  const store = setupChromeStorage();
  const userPrefs = {
    bannerPosition: 'bottom',
    displayDensity: 'compact',
    reducedMotion: true,
    highContrast: true,
    spaDetectionEnabled: true,
    focusDefaultEnabled: true,
    suggestionThreshold: 0.55,
    autoThreshold: 0.9,
    cooldownDuration: 43200000,
    focusOverlayAlpha: 0.33,
    focusOverlayBlurPx: 8,
    readingRulerHeightPx: 156,
    readingRulerOpacity: 0.24,
    readingRulerBlurPx: 4,
    readingRulerFeatherPx: 36,
    smartScope: {
      enabled: true,
      level: 'aggressive',
      perDomain: { 'example.com': { enabled: true, level: 'aggressive' } },
      debugEnabled: false,
    },
    modePrefs: {
      [MODE_IDS.COMFORT_VISUAL]: {
        textScale: false,
        spacingPack: true,
        linkEnhance: false,
        typoSmoothing: true,
        reflowGuard: true,
        darkMode: true,
        contrastGuard: true,
        reduceMotion: true,
        readingRuler: false,
      },
      [MODE_IDS.FOCUS]: {
        distractionDim: true,
        targetBoost: true,
        reduceMotion: true,
        readingRuler: true,
        focusNotObscured: true,
        distractionDimAlpha: 0.33,
        distractionDimBlurPx: 8,
        readingRulerHeightPx: 156,
        readingRulerOpacity: 0.24,
        readingRulerBlurPx: 4,
        readingRulerFeatherPx: 36,
      },
    },
  };
  const perDomainPrefs = {
    'example.com': {
      [MODE_IDS.COMFORT_VISUAL]: {
        intensity: 0.8,
        decision: DECISIONS.ENABLED,
        timestamp: 100,
        userIntent: DECISIONS.ENABLED,
        intentTimestamp: 90,
        committedAt: 110,
      },
    },
  };
  store.set(STORAGE_KEYS.USER_PREFS, userPrefs);
  store.set(STORAGE_KEYS.PER_DOMAIN_PREFS, perDomainPrefs);

  const payload = await buildExportPayload('2.0.0');
  assert.equal(payload.schemaVersion, DATA_PORTABILITY_SCHEMA_VERSION);
  await resetAllData();
  await importPayloadAndApply(payload);

  assert.deepEqual(store.get(STORAGE_KEYS.USER_PREFS), userPrefs);
  assert.deepEqual(store.get(STORAGE_KEYS.PER_DOMAIN_PREFS), perDomainPrefs);
});

test('legacy schema defaults missing SmartScope config to the runtime-safe enabled state', async () => {
  const store = setupChromeStorage();
  await importPayloadAndApply(buildBasePayload({ userPrefs: {} }));
  assert.equal(store.get(STORAGE_KEYS.USER_PREFS).smartScope.enabled, true);
});

test('genuinely partial schema v1 payload is normalized before one atomic write', async () => {
  const store = setupChromeStorage();

  const result = await importPayloadAndApply({
    schemaVersion: '1.0',
    allowlist: ['example.com'],
  });

  assert.equal(store.setCalls, 1);
  assert.deepEqual(result, { domains: 1, modes: 0 });
  assert.deepEqual(store.get(STORAGE_KEYS.ALLOWLIST), ['example.com']);
  assert.deepEqual(store.get(STORAGE_KEYS.DENYLIST), []);
  assert.deepEqual(store.get(STORAGE_KEYS.PER_DOMAIN_PREFS), {});
  assert.equal(store.get(STORAGE_KEYS.USER_PREFS).smartScope.enabled, true);
});

test('unknown keys are dropped from every imported section', async () => {
  const store = setupChromeStorage();
  await importPayloadAndApply(buildBasePayload({
    userPrefs: {
      unknownUserPref: 'drop',
      smartScope: {
        enabled: true,
        unknownSmartScope: 'drop',
        perDomain: {
          'example.com': { enabled: true, level: 'conservative', unknownDomainConfig: 'drop' },
        },
      },
    },
    perDomainPrefs: {
      'example.com': {
        [MODE_IDS.FOCUS]: { intensity: 0.5, unknownPreference: 'drop' },
      },
    },
    learningWeights: {
      'example.com': {
        [MODE_IDS.FOCUS]: { weight: 0.4, unknownLearning: 'drop' },
      },
    },
    cooldowns: {
      'example.com': {
        [MODE_IDS.FOCUS]: { until: 10, unknownCooldown: 'drop' },
      },
    },
    siteProfiles: {
      version: 1,
      entries: [{
        id: 'profile-1',
        action: 'ask',
        matchType: 'domain',
        modeId: MODE_IDS.FOCUS,
        value: 'example.com',
        createdAt: 1,
        updatedAt: 2,
        unknownProfile: 'drop',
      }],
      unknownProfileStore: 'drop',
    },
    unknownTopLevel: 'drop',
  }));

  const serialized = JSON.stringify(Object.fromEntries(store));
  assert.doesNotMatch(serialized, /unknown/i);
  assert.equal(store.setCalls, 1);
});

test('malformed SmartScope aborts validation before any storage write', async () => {
  const store = setupChromeStorage();
  await assert.rejects(
    importPayloadAndApply(buildBasePayload({ userPrefs: { smartScope: [] } })),
    /Invalid SmartScope config/,
  );
  assert.equal(store.setCalls, 0);
  assert.equal(store.size, 0);
});

test('invalid siteProfiles abort validation before any storage write', async () => {
  const store = setupChromeStorage();
  await assert.rejects(
    importPayloadAndApply(buildBasePayload({
      siteProfiles: {
        version: 1,
        entries: [{ action: 'always', matchType: 'domain', modeId: 'not-a-mode', value: 'example.com' }],
      },
    })),
    /Invalid siteProfiles entry/,
  );
  assert.equal(store.setCalls, 0);
  assert.equal(store.size, 0);
});

test('malformed siteProfiles container aborts validation before any storage write', async () => {
  const store = setupChromeStorage();
  await assert.rejects(
    importPayloadAndApply(buildBasePayload({ siteProfiles: { entries: 'not-an-array' } })),
    /Invalid siteProfiles entries/,
  );
  assert.equal(store.setCalls, 0);
  assert.equal(store.size, 0);
});

test('ambiguous legacy PSL keys remain historical and require explicit site migration', async () => {
  const store = setupChromeStorage();
  await importPayloadAndApply(buildBasePayload({
    perDomainPrefs: {
      'co.ma': { [MODE_IDS.FOCUS]: { decision: DECISIONS.NEVER } },
    },
    cooldowns: {
      'co.ma': { [MODE_IDS.FOCUS]: { until: Date.now() + 60_000 } },
    },
    learningWeights: {
      'co.ma': { [MODE_IDS.FOCUS]: { weight: 0.9 } },
    },
    allowlist: ['co.ma'],
    denylist: ['co.ma'],
    userPrefs: {
      smartScope: { enabled: true, perDomain: { 'co.ma': { enabled: false } } },
    },
    siteProfiles: {
      entries: [{
        id: 'legacy-profile',
        action: 'never',
        matchType: 'domain',
        modeId: MODE_IDS.FOCUS,
        value: 'co.ma',
        createdAt: 1,
        updatedAt: 1,
      }],
    },
  }));

  for (const key of [
    STORAGE_KEYS.PER_DOMAIN_PREFS,
    STORAGE_KEYS.COOLDOWNS,
    STORAGE_KEYS.LEARNING_WEIGHTS,
  ]) {
    assert.ok(store.get(key)['co.ma']);
    assert.equal(store.get(key)['bank.co.ma'], undefined);
    assert.equal(store.get(key)['shop.co.ma'], undefined);
  }
  assert.equal(store.get(STORAGE_KEYS.USER_PREFS).smartScope.perDomain['bank.co.ma'], undefined);
  assert.equal(store.get(STORAGE_KEYS.SITE_PROFILES).entries.some((entry) => entry.value === 'bank.co.ma'), false);

  const bank = await inspectLegacyDomainMigration('https://bank.co.ma/login');
  const shop = await inspectLegacyDomainMigration('https://shop.co.ma/cart');
  assert.equal(bank.available, true);
  assert.equal(shop.available, true);
  assert.equal(bank.siteKey, 'bank.co.ma');
  assert.equal(shop.siteKey, 'shop.co.ma');
});
