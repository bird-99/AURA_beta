import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { decisionHandler, normalizeDecision } from '../../background/decision-handler.js';
import { COOLDOWN_DURATIONS, DECISIONS, STORAGE_KEYS } from '../../shared/constants.js';

function setupChromeStorage() {
  const store = new Map();
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
          Object.entries(data).forEach(([key, value]) => {
            store.set(key, value);
          });
        },
        async clear() {
          store.clear();
        },
      },
    },
  };

  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('normalizeDecision maps DISMISSED to NOT_NOW and rejects unknown values', () => {
  assert.equal(normalizeDecision('DISMISSED'), DECISIONS.NOT_NOW);
  assert.equal(normalizeDecision('NOT_NOW'), DECISIONS.NOT_NOW);
  assert.equal(normalizeDecision('MAYBE'), null);
});

test('recordDecision normalizes DISMISSED and creates a cooldown entry', async () => {
  const store = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  await decisionHandler.recordDecision(siteKey, modeId, 'DISMISSED');

  const perDomainPrefs = store.get(STORAGE_KEYS.PER_DOMAIN_PREFS);
  assert.equal(perDomainPrefs[siteKey][modeId].decision, DECISIONS.NOT_NOW);

  const cooldowns = store.get(STORAGE_KEYS.COOLDOWNS);
  const until = cooldowns[siteKey][modeId].until;
  assert.ok(typeof until === 'number');
  assert.ok(until >= Date.now());
  assert.ok(until <= Date.now() + COOLDOWN_DURATIONS.NOT_NOW + 1000);

  const denylist = store.get(STORAGE_KEYS.DENYLIST);
  assert.deepEqual(denylist || [], []);

  const learningWeights = store.get(STORAGE_KEYS.LEARNING_WEIGHTS);
  assert.equal(learningWeights[siteKey][modeId].lastDecision, DECISIONS.NOT_NOW);
});

test('recordDecision ENABLED clears cooldowns without adding to denylist', async () => {
  const store = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.NOT_NOW);
  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.ENABLED);

  const cooldowns = store.get(STORAGE_KEYS.COOLDOWNS);
  assert.equal(cooldowns?.[siteKey]?.[modeId], undefined);

  const denylist = store.get(STORAGE_KEYS.DENYLIST);
  assert.deepEqual(denylist || [], []);
});

test('recordDecision NEVER adds denylist and clears existing cooldowns', async () => {
  const store = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.NOT_NOW);
  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.NEVER);

  const denylist = store.get(STORAGE_KEYS.DENYLIST);
  assert.deepEqual(denylist, [siteKey]);

  const cooldowns = store.get(STORAGE_KEYS.COOLDOWNS);
  assert.equal(cooldowns?.[siteKey]?.[modeId], undefined);
});

test('handleDecision ignores unknown decisions safely', async () => {
  setupChromeStorage();

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', 'MAYBE', { siteKey: 'example.com' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Invalid decision');
});
