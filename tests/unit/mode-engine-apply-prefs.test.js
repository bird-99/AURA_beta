import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  getIntensityForSite,
  getPerDomainModePrefs,
  getSmartScopeConfig,
  normalizeSmartScopeLevel,
} from '../../background/mode-engine-apply-prefs.js';
import { MODE_IDS, SMARTSCOPE_LEVELS, STORAGE_KEYS } from '../../shared/constants.js';

function setupStorage(values = {}) {
  global.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: values[key] }),
      },
    },
  };
}

afterEach(() => {
  delete global.chrome;
});

test('mode-engine apply prefs module does not import css-applier', async () => {
  const source = await readFile(join(process.cwd(), 'background', 'mode-engine-apply-prefs.js'), 'utf8');

  assert.equal(source.includes('./css-applier.js'), false);
  assert.equal(source.includes('css-applier'), false);
});

test('normalizeSmartScopeLevel falls back to conservative', () => {
  assert.equal(normalizeSmartScopeLevel(SMARTSCOPE_LEVELS.AGGRESSIVE), SMARTSCOPE_LEVELS.AGGRESSIVE);
  assert.equal(normalizeSmartScopeLevel('unknown'), SMARTSCOPE_LEVELS.CONSERVATIVE);
  assert.equal(normalizeSmartScopeLevel(null), SMARTSCOPE_LEVELS.CONSERVATIVE);
});

test('getSmartScopeConfig merges global defaults with per-domain overrides', async () => {
  setupStorage({
    [STORAGE_KEYS.USER_PREFS]: {
      smartScope: {
        enabled: true,
        level: SMARTSCOPE_LEVELS.AGGRESSIVE,
        debugEnabled: true,
        perDomain: {
          'example.com': {
            enabled: false,
            level: 'invalid',
          },
        },
      },
    },
  });

  assert.deepEqual(await getSmartScopeConfig('example.com'), {
    enabled: false,
    level: SMARTSCOPE_LEVELS.CONSERVATIVE,
    source: 'domain',
    debugEnabled: true,
  });
  assert.deepEqual(await getSmartScopeConfig('other.test'), {
    enabled: true,
    level: SMARTSCOPE_LEVELS.AGGRESSIVE,
    source: 'global',
    debugEnabled: true,
  });
});

test('getIntensityForSite prefers explicit fallback and clamps per-domain values', async () => {
  setupStorage({
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {
      'example.com': {
        [MODE_IDS.COMFORT_VISUAL]: { intensity: 1.4, darkMode: false },
      },
    },
  });

  assert.equal(await getIntensityForSite('example.com', MODE_IDS.COMFORT_VISUAL, 0.25), 0.25);
  assert.equal(await getIntensityForSite('example.com', MODE_IDS.COMFORT_VISUAL), 1);
  assert.equal(await getIntensityForSite('missing.test', MODE_IDS.COMFORT_VISUAL), 1);
});

test('getPerDomainModePrefs returns only existing mode preference objects', async () => {
  const modePrefs = { intensity: 0.5, darkMode: false };
  setupStorage({
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {
      'example.com': {
        [MODE_IDS.COMFORT_VISUAL]: modePrefs,
        [MODE_IDS.FOCUS]: null,
      },
    },
  });

  assert.deepEqual(await getPerDomainModePrefs('example.com', MODE_IDS.COMFORT_VISUAL), modePrefs);
  assert.equal(await getPerDomainModePrefs('example.com', MODE_IDS.FOCUS), null);
  assert.equal(await getPerDomainModePrefs('', MODE_IDS.FOCUS), null);
});

test('ambiguous pre-PSL per-domain preferences are not read automatically', async () => {
  const legacyPrefs = { intensity: 0.7, darkMode: true };
  setupStorage({
    [STORAGE_KEYS.PER_DOMAIN_PREFS]: {
      'co.ma': { [MODE_IDS.COMFORT_VISUAL]: legacyPrefs },
    },
    [STORAGE_KEYS.USER_PREFS]: {
      smartScope: { enabled: true, perDomain: { 'co.ma': { enabled: false } } },
    },
  });

  assert.equal(await getPerDomainModePrefs('bank.co.ma', MODE_IDS.COMFORT_VISUAL), null);
  assert.equal(await getPerDomainModePrefs('shop.co.ma', MODE_IDS.COMFORT_VISUAL), null);
  assert.equal(await getIntensityForSite('bank.co.ma', MODE_IDS.COMFORT_VISUAL), 1);
  assert.equal((await getSmartScopeConfig('bank.co.ma')).enabled, true);
});
