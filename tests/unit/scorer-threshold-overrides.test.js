import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { Scorer } from '../../background/scorer.js';
import { MODE_IDS, SIGNALS, STORAGE_KEYS } from '../../shared/constants.js';

function setupChromeStorage({ failGetKeys = [] } = {}) {
  const store = new Map();
  const failedKeys = new Set(failGetKeys);
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (failedKeys.has(key)) throw new Error('storage unavailable');
          return { [key]: store.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([storedKey, value]) => {
            store.set(storedKey, value);
          });
        },
      },
      session: {
        async get(key) {
          return { [key]: store.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([storedKey, value]) => {
            store.set(storedKey, value);
          });
        },
      },
    },
    tabs: {
      async get() {
        return { id: 123, url: 'https://example.com/article' };
      },
    },
  };
  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('scorer uses preference overrides for suggestion and auto thresholds', async () => {
  const store = setupChromeStorage();
  store.set(STORAGE_KEYS.USER_PREFS, {
    suggestionThreshold: 0.95,
    autoThreshold: 0.95,
    modePrefs: {
      [MODE_IDS.COMFORT_VISUAL]: {
        suggestionThreshold: 0.65,
        autoThreshold: 0.55,
      },
    },
  });
  const now = Date.now();
  store.set(STORAGE_KEYS.SIGNAL_SNAPSHOTS, {
    123: {
      updatedAt: now,
      lastSeenAt: now,
      byType: {
        zoom: { value: 1.2, confidence: 1, ts: now },
        readingBehavior: { value: 1, confidence: 1, ts: now },
      },
    },
  });
  store.set(STORAGE_KEYS.POLICY_STATE, {
    123: {
      [MODE_IDS.COMFORT_VISUAL]: {
        latched: true,
        lastDecision: 'SUGGEST',
        lastDecisionAt: now - 60000,
      },
    },
  });

  const stateManager = {
    async getState() {
      return { state: 'INACTIVE', pendingDecision: false };
    },
    async updateTabModeState() {},
    async getTabState() {
      return {};
    },
  };
  const badgeManager = { async refresh() {} };

  const autoApplyCalls = [];
  const autoApplyManager = {
    async evaluateAutoApply(tabId, modeId, score, { autoThreshold }) {
      autoApplyCalls.push({ tabId, modeId, score, autoThreshold });
      return false;
    },
  };

  const scorer = new Scorer(stateManager, badgeManager, autoApplyManager);
  scorer.calculateScore = async (_tabId, modeId) => (modeId === MODE_IDS.COMFORT_VISUAL ? 0.6 : 0);

  const suggestionCalls = [];
  scorer.triggerSuggestion = async (tabId, modeId, score) => {
    suggestionCalls.push({ tabId, modeId, score });
  };

  await scorer.handleSignal(123, SIGNALS.ZOOM, 1.2);

  assert.equal(autoApplyCalls.length, 1);
  assert.equal(autoApplyCalls[0].autoThreshold, 0.55);
  assert.equal(suggestionCalls.length, 0);
});

test('scorer performs no policy or auto-apply work when site profiles are unreadable', async () => {
  setupChromeStorage({ failGetKeys: [STORAGE_KEYS.SITE_PROFILES] });
  let policyCalls = 0;
  let autoApplyCalls = 0;
  const scorer = new Scorer({
    async getState() {
      policyCalls += 1;
      return { state: 'INACTIVE' };
    },
  }, {}, {
    async evaluateAutoApply() {
      autoApplyCalls += 1;
      return true;
    },
  });

  await scorer.handleSignal(123, SIGNALS.ZOOM, 1.2);

  assert.equal(policyCalls, 0);
  assert.equal(autoApplyCalls, 0);
});
