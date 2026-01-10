import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeModePrefs, normalizeTabState, pickAllowedTabStateFields } from '../../background/state-manager.js';
import { MODE_IDS, MODE_PREFS_DEFAULTS, STATES } from '../../shared/constants.js';

test('pickAllowedTabStateFields strips unknown fields (including appliedAt)', () => {
  const cleaned = pickAllowedTabStateFields({
    state: STATES.ACTIVE,
    cssId: 'aura-cv-1',
    pendingDecision: true,
    lastScore: 0.7,
    appliedAt: 123,
    extra: 'surprise',
  });

  assert.equal(cleaned.state, STATES.ACTIVE);
  assert.equal(cleaned.cssId, 'aura-cv-1');
  assert.equal(cleaned.pendingDecision, true);
  assert.equal(cleaned.lastScore, 0.7);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'appliedAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cleaned, 'extra'), false);
});

test('normalizeTabState applies defaults and removes appliedAt', () => {
  const normalized = normalizeTabState({
    state: STATES.ACTIVE,
    appliedAt: 456,
    pendingDecision: 'nope',
    lastDecision: 'ENABLED',
  });

  assert.equal(normalized.state, STATES.ACTIVE);
  assert.equal(normalized.cssId, null);
  assert.equal(normalized.pendingDecision, false);
  assert.equal(normalized.lastScore, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'appliedAt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'lastDecision'), false);
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
  assert.equal(normalized[MODE_IDS.FOCUS].ultraFocus, true);
  assert.equal(normalized[MODE_IDS.FOCUS].targetBoost, MODE_PREFS_DEFAULTS[MODE_IDS.FOCUS].targetBoost);
});
