import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { decisionHandler, normalizeDecision } from '../../background/decision-handler.js';
import { cssApplier } from '../../background/css-applier.js';
import { ACTIVE_QUALITIES, COOLDOWN_DURATIONS, DECISIONS, MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';
import { PROFILE_ACTIONS } from '../../shared/site-profiles.js';
import { ADAPTATION_ACTION_IDS, PAGE_TYPES } from '../../shared/engine-core/index.js';
import { readPageIntelligenceFixtures } from '../../scripts/page-understanding-quality-report.mjs';

const ORIGINAL_APPLY_MODE = cssApplier.applyMode;

function setupChromeStorage({ withRuntime = false, failGetKeys = [] } = {}) {
  const store = new Map();
  const sessionStore = new Map();
  const failedKeys = new Set(failGetKeys);
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          const requestedKeys = Array.isArray(key) ? key : [key];
          if (requestedKeys.some((item) => failedKeys.has(item))) {
            throw new Error('storage unavailable');
          }
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
      session: {
        async get(key) {
          if (Array.isArray(key)) {
            const result = {};
            key.forEach((item) => {
              result[item] = sessionStore.get(item);
            });
            return result;
          }
          return { [key]: sessionStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            sessionStore.set(key, value);
          });
        },
      },
    },
  };

  if (withRuntime) {
    global.chrome.tabs = {
      async get() {
        return { url: 'https://example.com/article' };
      },
      async sendMessage() {
        return { ok: true };
      },
    };
    global.chrome.action = {
      async setBadgeText() {},
    };
  }

  return { store, sessionStore };
}

function articleSignals() {
  return {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_decision_article_v1',
    routeEpoch: 'aura_pse_route_decision_article_v1',
    viewport: { w: 1280, h: 720 },
    pageHints: {
      urlKind: 'UNKNOWN',
      semanticArticleCount: 1,
      formCount: 0,
      tableCount: 0,
      mediaCount: 0,
      fixedOrStickyCount: 0,
      modalLikeCount: 0,
    },
    aggregateMetrics: {
      textDensity: 0.84,
      linkDensity: 0.08,
      interactiveDensity: 0.03,
      mediaDensity: 0.02,
      formDensity: 0,
      tableDensity: 0,
      viewportCoverage: 0.72,
    },
    blocks: [{
      blockId: 'b1',
      roleHint: 'ARTICLE',
      rectRatio: { xRatio: 0.2, yRatio: 0.08, widthRatio: 0.58, heightRatio: 0.78, visibleRatio: 0.95 },
      metrics: {
        textDensity: 0.9,
        linkDensity: 0.07,
        interactiveDensity: 0.02,
        mediaDensity: 0.01,
        formDensity: 0,
        tableDensity: 0,
        viewportCoverage: 0.64,
      },
      flags: ['ARTICLE_TEXT_DENSITY_HIGH'],
    }],
    stats: { elapsedMs: 4, nodesScanned: 300, candidatesSeen: 4, budgetHit: false },
  };
}

function unknownSignals() {
  return {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_decision_unknown_v1',
    routeEpoch: 'aura_pse_route_decision_unknown_v1',
    viewport: { w: 1280, h: 720 },
    pageHints: {
      urlKind: 'UNKNOWN',
      semanticArticleCount: 0,
      formCount: 0,
      tableCount: 0,
      mediaCount: 1,
      fixedOrStickyCount: 1,
      modalLikeCount: 0,
    },
    aggregateMetrics: {
      textDensity: 0.3,
      linkDensity: 0.22,
      interactiveDensity: 0.32,
      mediaDensity: 0.12,
      formDensity: 0.06,
      tableDensity: 0.04,
      viewportCoverage: 0.74,
    },
    blocks: [{
      blockId: 'b1',
      roleHint: 'UNKNOWN',
      rectRatio: { xRatio: 0.04, yRatio: 0.04, widthRatio: 0.92, heightRatio: 0.86, visibleRatio: 0.84 },
      metrics: {
        textDensity: 0.28,
        linkDensity: 0.2,
        interactiveDensity: 0.34,
        mediaDensity: 0.12,
        formDensity: 0.06,
        tableDensity: 0.04,
        viewportCoverage: 0.72,
      },
      flags: ['UNKNOWN_LOW_CONFIDENCE', 'TOP_CANDIDATES_AMBIGUOUS'],
    }],
    stats: { elapsedMs: 10, nodesScanned: 860, candidatesSeen: 17, budgetHit: false },
  };
}

function fixtureSignals(name) {
  const fixture = readPageIntelligenceFixtures().find((entry) => entry.name === name);
  assert.ok(fixture, `${name} fixture should exist`);
  const signals = JSON.parse(JSON.stringify(fixture.input));
  delete signals.routeFingerprint;
  signals.frameId = 0;
  signals.blocks = signals.blocks.map((block, index) => ({
    ...block,
    blockId: `b${index + 1}`,
  }));
  return signals;
}

function installPageSignals(signals) {
  global.chrome.runtime = { lastError: null };
  global.chrome.tabs.sendMessage = (tabId, message, optionsOrCallback, maybeCallback) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const response = message?.action === 'PAGE_SIGNALS_COLLECT_V1'
      ? { ok: true, signals }
      : { ok: true };
    if (typeof callback !== 'function') {
      return Promise.resolve(response);
    }
    callback(response);
  };
}

afterEach(() => {
  cssApplier.applyMode = ORIGINAL_APPLY_MODE;
  delete global.chrome;
});

test('normalizeDecision maps DISMISSED to NOT_NOW and rejects unknown values', () => {
  assert.equal(normalizeDecision('DISMISSED'), DECISIONS.NOT_NOW);
  assert.equal(normalizeDecision('NOT_NOW'), DECISIONS.NOT_NOW);
  assert.equal(normalizeDecision('MAYBE'), null);
});

test('recordDecision normalizes DISMISSED and creates a cooldown entry', async () => {
  const { store } = setupChromeStorage();
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
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.NOT_NOW);
  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.ENABLED);

  const cooldowns = store.get(STORAGE_KEYS.COOLDOWNS);
  assert.equal(cooldowns?.[siteKey]?.[modeId], undefined);

  const denylist = store.get(STORAGE_KEYS.DENYLIST);
  assert.deepEqual(denylist || [], []);

  const learningWeights = store.get(STORAGE_KEYS.LEARNING_WEIGHTS);
  assert.equal(learningWeights[siteKey][modeId].lastDecision, DECISIONS.NOT_NOW);
  assert.equal(learningWeights[siteKey][modeId].enableCount, 0);
});

test('recordDecision ENABLED does not create positive learning before outcome eligibility', async () => {
  const { store } = setupChromeStorage();

  await decisionHandler.recordDecision('example.com', 'comfort-visual', DECISIONS.ENABLED);

  assert.equal(store.get(STORAGE_KEYS.LEARNING_WEIGHTS), undefined);
});

test('recordDecision NEVER adds denylist and clears existing cooldowns', async () => {
  const { store } = setupChromeStorage();
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

test('handleDecision treats global safe fallback as active without positive scoped-v2 learning evidence', async () => {
  const { sessionStore } = setupChromeStorage({ withRuntime: true });
  installPageSignals(articleSignals());
  const calls = [];
  cssApplier.applyMode = async (...args) => {
    calls.push(args);
    return { ok: true, variant: 'GLOBAL_SAFE_FALLBACK', cssId: 'css-fallback', attemptId: 'fb-1' };
  };

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ACTIVE');
  assert.equal(calls.length, 1);
  const tabState = sessionStore.get(STORAGE_KEYS.TAB_STATE);
  assert.equal(tabState[123]['comfort-visual'].state, 'ACTIVE');
  const ledger = sessionStore.get(STORAGE_KEYS.OUTCOME_LEDGER_V1) || [];
  assert.deepEqual(ledger, []);
});

test('handleDecision passes runtime effect plan from live page context to applyMode', async () => {
  setupChromeStorage({ withRuntime: true });
  installPageSignals(articleSignals());
  const calls = [];
  cssApplier.applyMode = async (...args) => {
    calls.push(args);
    return { ok: true, variant: 'GLOBAL_SAFE_FALLBACK', cssId: 'css-fallback', attemptId: 'fb-1' };
  };

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const applyParams = calls[0][2];
  assert.equal(applyParams.runtimeEffectPlan.modeId, 'comfort-visual');
  assert.equal(applyParams.runtimeEffectPlan.pageType, 'ARTICLE');
  assert.equal(applyParams.runtimeEffectPlan.safeDowngrade, 'SAFE_READING_TEXT_LINK_CLARITY');
  assert.equal(calls[0][3], 'popup');
});

test('handleDecision passes PAGE_CLARITY runtime plans for Comfort Search and Form to applyMode', async () => {
  for (const [fixtureName, pageType, actionTargetKind] of [
    ['search-results', PAGE_TYPES.SEARCH, 'RECORD_REGION'],
    ['form-simple', PAGE_TYPES.FORM, 'FORM_REGION'],
  ]) {
    const { sessionStore } = setupChromeStorage({ withRuntime: true });
    installPageSignals(fixtureSignals(fixtureName));
    const calls = [];
    cssApplier.applyMode = async (...args) => {
      calls.push(args);
      return { ok: true, variant: 'PAGE_CLARITY_MEDIUM', cssId: 'css-page-clarity', attemptId: `pc-${fixtureName}` };
    };

    const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
      siteKey: 'example.com',
    });

    assert.equal(result.ok, true, fixtureName);
    assert.equal(calls.length, 1, fixtureName);
    const applyParams = calls[0][2];
    assert.equal(applyParams.runtimeEffectPlan.modeId, 'comfort-visual', fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.pageType, pageType, fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.actionId, ADAPTATION_ACTION_IDS.PAGE_CLARITY, fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.v3LightShadow.actionId, ADAPTATION_ACTION_IDS.PAGE_CLARITY, fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.v3LightShadow.targetKind, actionTargetKind, fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.v3LightShadow.activePlanAllowed, true, fixtureName);
    assert.equal(applyParams.runtimeEffectPlan.v3LightShadow.executor, 'REGION_CLASS_TOKENS', fixtureName);
    assert.equal(applyParams.safeDowngradeOnly, undefined, fixtureName);
    assert.equal(calls[0][3], 'popup', fixtureName);
    assert.deepEqual(sessionStore.get(STORAGE_KEYS.OUTCOME_LEDGER_V1) || [], [], fixtureName);

    cssApplier.applyMode = ORIGINAL_APPLY_MODE;
    delete global.chrome;
  }
});

test('handleDecision fails closed for Comfort when live runtime context is frame-incoherent', async () => {
  const { sessionStore } = setupChromeStorage({ withRuntime: true });
  installPageSignals({ ...articleSignals(), frameId: 2 });
  let applyCalls = 0;
  cssApplier.applyMode = async () => {
    applyCalls += 1;
    return { ok: true };
  };

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'RUNTIME_EFFECT_PLAN_UNAVAILABLE');
  assert.equal(result.reason, 'LIVE_FRAME_MISMATCH');
  assert.equal(applyCalls, 0);
  const tabState = sessionStore.get(STORAGE_KEYS.TAB_STATE);
  assert.equal(tabState[123]['comfort-visual'].state, 'ERROR');
});

test('handleDecision falls back to legacy Comfort apply when live runtime collection hits budget', async () => {
  const { sessionStore } = setupChromeStorage({ withRuntime: true });
  installPageSignals({
    ...articleSignals(),
    stats: { elapsedMs: 20, nodesScanned: 1500, candidatesSeen: 200, budgetHit: true },
  });
  const calls = [];
  cssApplier.applyMode = async (...args) => {
    calls.push(args);
    return { ok: true, variant: 'SCOPED_V2', cssId: 'css-legacy-comfort', attemptId: 'legacy-1' };
  };

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ACTIVE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 123);
  assert.equal(calls[0][1], 'comfort-visual');
  assert.deepEqual(calls[0][2], {});
  assert.equal(calls[0][3], 'popup');
  const tabState = sessionStore.get(STORAGE_KEYS.TAB_STATE);
  assert.equal(tabState[123]['comfort-visual'].state, 'ACTIVE');
});

test('handleDecision sends denied manual policy as safeDowngradeOnly runtime apply', async () => {
  setupChromeStorage({ withRuntime: true });
  global.chrome.runtime = { lastError: null };
  global.chrome.tabs.sendMessage = (tabId, message, optionsOrCallback, maybeCallback) => {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const response = message?.action === 'PAGE_SIGNALS_COLLECT_V1'
      ? { ok: true, signals: unknownSignals() }
      : { ok: true };
    if (typeof callback !== 'function') {
      return Promise.resolve(response);
    }
    callback(response);
  };
  const calls = [];
  cssApplier.applyMode = async (...args) => {
    calls.push(args);
    return { ok: true, variant: 'GLOBAL_SAFE_FALLBACK', cssId: 'css-fallback', attemptId: 'fb-1' };
  };

  const result = await decisionHandler.handleDecision(123, MODE_IDS.FOCUS, DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const applyParams = calls[0][2];
  assert.equal(applyParams.runtimeEffectPlan.modeId, MODE_IDS.FOCUS);
  assert.equal(applyParams.runtimeEffectPlan.pageType, 'UNKNOWN');
  assert.equal(applyParams.runtimeEffectPlan.policyDecision, 'DENY');
  assert.equal(applyParams.runtimeEffectPlan.safeDowngrade, 'SAFE_GLOBAL_FOCUS_VISIBLE');
  assert.equal(applyParams.safeDowngradeOnly, true);
  assert.equal(calls[0][3], 'popup');
});

test('handleDecision stores ENABLED as intent only when apply fails', async () => {
  const { store, sessionStore } = setupChromeStorage({ withRuntime: true });
  installPageSignals(articleSignals());
  cssApplier.applyMode = async () => ({ ok: false, reason: 'NO_SCOPE', detail: 'LOW_SCORE' });

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_SCOPE');

  const perDomainPrefs = store.get(STORAGE_KEYS.PER_DOMAIN_PREFS);
  assert.equal(perDomainPrefs['example.com']['comfort-visual'].userIntent, DECISIONS.ENABLED);
  assert.equal(perDomainPrefs['example.com']['comfort-visual'].decision, undefined);

  const tabState = sessionStore.get(STORAGE_KEYS.TAB_STATE);
  assert.equal(tabState[123]['comfort-visual'].state, 'ERROR');
});

test('handleDecision preserves activeQuality written by cssApplier', async () => {
  const { sessionStore } = setupChromeStorage({ withRuntime: true });
  installPageSignals(articleSignals());
  cssApplier.applyMode = async () => {
    sessionStore.set(STORAGE_KEYS.TAB_STATE, {
      123: {
        'comfort-visual': {
          state: 'ACTIVE',
          cssId: 'css-scoped',
          activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
          scopedV2: { scopeSelector: 'main' },
        },
      },
    });
    return { ok: true, variant: 'SCOPED_V2', cssId: 'css-scoped', attemptId: 'attempt-1' };
  };

  const result = await decisionHandler.handleDecision(123, 'comfort-visual', DECISIONS.ENABLED, {
    siteKey: 'example.com',
  });

  assert.equal(result.ok, true);
  const tabState = sessionStore.get(STORAGE_KEYS.TAB_STATE);
  assert.equal(tabState[123]['comfort-visual'].state, 'ACTIVE');
  assert.equal(tabState[123]['comfort-visual'].activeQuality, ACTIVE_QUALITIES.SCOPED_V2_VERIFIED);
});

test('recordDecision uses cooldown duration from user prefs', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  store.set(STORAGE_KEYS.USER_PREFS, { cooldownDuration: 1000 });
  const now = Date.now();

  await decisionHandler.recordDecision(siteKey, modeId, DECISIONS.NOT_NOW);

  const cooldowns = store.get(STORAGE_KEYS.COOLDOWNS);
  const until = cooldowns[siteKey][modeId].until;
  assert.ok(until >= now + 900);
  assert.ok(until <= now + 2000);
});

test('shouldSuggest denies denylisted sites even when allowlisted', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  store.set(STORAGE_KEYS.DENYLIST, [siteKey]);
  store.set(STORAGE_KEYS.ALLOWLIST, [siteKey]);

  const allowed = await decisionHandler.shouldSuggest(siteKey, modeId, 0.2, 0.6);

  assert.equal(allowed, false);
});

test('shouldSuggest allows allowlisted sites even below threshold', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  store.set(STORAGE_KEYS.ALLOWLIST, [siteKey]);

  const allowed = await decisionHandler.shouldSuggest(siteKey, modeId, 0.1, 0.6);

  assert.equal(allowed, true);
});

test('ambiguous pre-PSL denylist and cooldown keys never apply to modern sites automatically', async () => {
  const { store } = setupChromeStorage();
  const modeId = MODE_IDS.COMFORT_VISUAL;
  store.set(STORAGE_KEYS.DENYLIST, ['co.ma']);
  store.set(STORAGE_KEYS.COOLDOWNS, {
    'co.ma': { [modeId]: { until: Date.now() + 60_000 } },
  });

  assert.equal(await decisionHandler.isDenylisted('bank.co.ma'), false);
  assert.equal(await decisionHandler.isDenylisted('shop.co.ma'), false);
  assert.equal(await decisionHandler.isInCooldown('bank.co.ma', modeId), false);
  assert.equal(await decisionHandler.isInCooldown('shop.co.ma', modeId), false);

  await decisionHandler.clearCooldown('bank.co.ma', modeId);
  assert.ok(store.get(STORAGE_KEYS.COOLDOWNS)?.['co.ma']);
});

test('denylist and cooldown reads expose storage errors instead of treating them as missing', async () => {
  setupChromeStorage();
  global.chrome.storage.local.get = async () => {
    throw new Error('storage offline');
  };

  const denylist = await decisionHandler.readDenylistStatus('example.com');
  const cooldown = await decisionHandler.readCooldownStatus('example.com', MODE_IDS.COMFORT_VISUAL);
  assert.equal(denylist.ok, false);
  assert.equal(denylist.status, 'error');
  assert.match(denylist.error, /storage offline/);
  assert.equal(cooldown.ok, false);
  await assert.rejects(decisionHandler.isDenylisted('example.com'), /storage offline/);
});

test('shouldSuggest denies sites with a never profile override', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  store.set(STORAGE_KEYS.SITE_PROFILES, {
    entries: [
      { id: 'p1', action: PROFILE_ACTIONS.NEVER, matchType: 'domain', modeId, value: siteKey },
    ],
  });

  const allowed = await decisionHandler.shouldSuggest(siteKey, modeId, 0.9, 0.6);

  assert.equal(allowed, false);
});

test('shouldSuggest allows sites with an always profile override below threshold', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = 'comfort-visual';

  store.set(STORAGE_KEYS.SITE_PROFILES, {
    entries: [
      { id: 'p2', action: PROFILE_ACTIONS.ALWAYS, matchType: 'domain', modeId, value: siteKey },
    ],
  });

  const allowed = await decisionHandler.shouldSuggest(siteKey, modeId, 0.1, 0.6);

  assert.equal(allowed, true);
});

test('shouldSuggest keeps denylist and cooldown ahead of an always profile', async () => {
  const { store } = setupChromeStorage();
  const siteKey = 'example.com';
  const modeId = MODE_IDS.COMFORT_VISUAL;
  store.set(STORAGE_KEYS.SITE_PROFILES, {
    entries: [{ id: 'always', action: PROFILE_ACTIONS.ALWAYS, matchType: 'domain', modeId, value: siteKey }],
  });
  store.set(STORAGE_KEYS.DENYLIST, [siteKey]);
  assert.equal(await decisionHandler.shouldSuggest(siteKey, modeId, 1, 0), false);

  store.set(STORAGE_KEYS.DENYLIST, []);
  store.set(STORAGE_KEYS.COOLDOWNS, { [siteKey]: { [modeId]: { until: Date.now() + 60_000 } } });
  assert.equal(await decisionHandler.shouldSuggest(siteKey, modeId, 1, 0), false);
});

test('shouldSuggest fails closed when site profiles cannot be read', async () => {
  setupChromeStorage({ failGetKeys: [STORAGE_KEYS.SITE_PROFILES] });
  await assert.rejects(
    decisionHandler.shouldSuggest('example.com', MODE_IDS.COMFORT_VISUAL, 1, 0),
    /storage unavailable/,
  );
});
