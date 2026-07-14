import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { StateManager, normalizeModePrefs, normalizeTabState, pickAllowedTabStateFields } from '../../background/state-manager.js';
import { ACTIVE_QUALITIES, MODE_IDS, MODE_PREFS_DEFAULTS, STATES, STORAGE_KEYS } from '../../shared/constants.js';

afterEach(() => {
  delete global.chrome;
});

test('pickAllowedTabStateFields strips unknown fields (including appliedAt)', () => {
  const cleaned = pickAllowedTabStateFields({
    state: STATES.ACTIVE,
    cssId: 'aura-cv-1',
    frameId: 3,
    activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
    pendingDecision: true,
    lastScore: 0.7,
    appliedAt: 123,
    extra: 'surprise',
  });

  assert.equal(cleaned.state, STATES.ACTIVE);
  assert.equal(cleaned.cssId, 'aura-cv-1');
  assert.equal(cleaned.frameId, 3);
  assert.equal(cleaned.activeQuality, ACTIVE_QUALITIES.SCOPED_V2_VERIFIED);
  assert.equal(cleaned.pendingDecision, true);
  assert.equal(cleaned.lastScore, 0.7);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'appliedAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'extra'), false);
});

test('tab state preserves durable lifecycle ownership fields', () => {
  const normalized = normalizeTabState({
    state: STATES.ACTIVE,
    activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
    lastLifecycleOpId: 'op-123',
    lastLifecycleGeneration: 4,
  });

  assert.equal(normalized.lastLifecycleOpId, 'op-123');
  assert.equal(normalized.lastLifecycleGeneration, 4);
});

test('pickAllowedTabStateFields rejects unknown activeQuality values', () => {
  const cleaned = pickAllowedTabStateFields({
    state: STATES.ACTIVE,
    activeQuality: 'TRUST_ME',
  });

  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'activeQuality'), false);
});

test('pickAllowedTabStateFields accepts verified PAGE_CLARITY medium activeQuality', () => {
  const cleaned = pickAllowedTabStateFields({
    state: STATES.ACTIVE,
    activeQuality: ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED,
  });

  assert.equal(cleaned.activeQuality, ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED);
});

test('normalizeTabState applies defaults and removes appliedAt', () => {
  const normalized = normalizeTabState({
    state: STATES.ACTIVE,
    frameId: -1,
    activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
    appliedAt: 456,
    pendingDecision: 'nope',
    lastDecision: 'ENABLED',
  });

  assert.equal(normalized.state, STATES.ACTIVE);
  assert.equal(normalized.cssId, null);
  assert.equal(normalized.frameId, null);
  assert.equal(normalized.activeQuality, ACTIVE_QUALITIES.SCOPED_V2_VERIFIED);
  assert.equal(normalized.pendingDecision, false);
  assert.equal(normalized.lastScore, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'appliedAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'lastDecision'), false);
});

test('normalizeTabState clears activeQuality outside ACTIVE state', () => {
  const normalized = normalizeTabState({
    state: STATES.ERROR,
    activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
  });

  assert.equal(normalized.state, STATES.ERROR);
  assert.equal(normalized.activeQuality, null);
});

test('normalizeModePrefs merges defaults with partial overrides', () => {
  const normalized = normalizeModePrefs({
    [MODE_IDS.COMFORT_VISUAL]: {
      darkMode: true,
      readingRuler: 'nope',
    },
    [MODE_IDS.FOCUS]: {
      ultraFocus: true,
      targetBoost: 'yes',
    },
  });

  assert.equal(normalized[MODE_IDS.COMFORT_VISUAL].darkMode, true);
  assert.equal(normalized[MODE_IDS.COMFORT_VISUAL].contrastGuard, MODE_PREFS_DEFAULTS[MODE_IDS.COMFORT_VISUAL].contrastGuard);
  assert.equal(normalized[MODE_IDS.COMFORT_VISUAL].readingRuler, MODE_PREFS_DEFAULTS[MODE_IDS.COMFORT_VISUAL].readingRuler);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized[MODE_IDS.FOCUS], 'ultraFocus'), false);
  assert.equal(normalized[MODE_IDS.FOCUS].targetBoost, MODE_PREFS_DEFAULTS[MODE_IDS.FOCUS].targetBoost);
});

test('normalizeModePrefs keeps focus not obscured as an always-on safety invariant', () => {
  const normalized = normalizeModePrefs({
    [MODE_IDS.FOCUS]: {
      focusNotObscured: false,
    },
  });

  assert.equal(normalized[MODE_IDS.FOCUS].focusNotObscured, true);
});

test('concurrent tab state updates preserve both tabs', async () => {
  const store = {};
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          await Promise.resolve();
          return { [key]: store[key] };
        },
        async set(values) {
          await Promise.resolve();
          Object.assign(store, values);
        },
      },
    },
  };
  const manager = new StateManager();

  await Promise.all([
    manager.updateTabModeState(1, MODE_IDS.COMFORT_VISUAL, { state: STATES.ACTIVE }),
    manager.updateTabModeState(2, MODE_IDS.FOCUS, { state: STATES.SUGGESTED }),
  ]);

  assert.equal(store[STORAGE_KEYS.TAB_STATE][1][MODE_IDS.COMFORT_VISUAL].state, STATES.ACTIVE);
  assert.equal(store[STORAGE_KEYS.TAB_STATE][2][MODE_IDS.FOCUS].state, STATES.SUGGESTED);
});

test('tab state update rejects when session persistence fails', async () => {
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: {} };
        },
        async set() {
          throw new Error('quota unavailable');
        },
      },
    },
  };
  const manager = new StateManager();

  await assert.rejects(
    manager.updateTabModeState(1, MODE_IDS.COMFORT_VISUAL, { state: STATES.ACTIVE }),
    /Failed to mutate chrome\.storage\.session\.tabState/,
  );
});
