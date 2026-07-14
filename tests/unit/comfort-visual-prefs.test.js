import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMFORT_VISUAL_DEFAULTS,
  COMFORT_VISUAL_PREF_FEATURE_IDS,
  COMFORT_VISUAL_SAFETY_PREF_KEYS,
  COMFORT_VISUAL_USER_TOGGLEABLE_PREF_KEYS,
  getDefaultComfortVisualPrefs,
  mergeComfortVisualPrefs,
  normalizeComfortVisualPrefs,
} from '../../shared/comfort-visual-prefs.js';
import { FEATURE_IDS, findFeatureRegistryEntryV1 } from '../../shared/engine-core/index.js';

test('getDefaultComfortVisualPrefs returns a stable copy of defaults', () => {
  const first = getDefaultComfortVisualPrefs();
  const second = getDefaultComfortVisualPrefs();

  assert.deepEqual(first, COMFORT_VISUAL_DEFAULTS);
  assert.deepEqual(second, COMFORT_VISUAL_DEFAULTS);
  assert.notStrictEqual(first, second);

  first.darkMode = false;
  assert.equal(second.darkMode, COMFORT_VISUAL_DEFAULTS.darkMode);
});

test('Comfort Visual prefs map every visible option to FeatureRegistry truth', () => {
  assert.deepEqual(COMFORT_VISUAL_PREF_FEATURE_IDS, {
    textScale: FEATURE_IDS.TEXT_SCALE,
    spacingPack: FEATURE_IDS.SPACING_PACK,
    linkEnhance: FEATURE_IDS.LINK_ENHANCEMENT,
    typoSmoothing: FEATURE_IDS.TEXT_RENDERING_REFINEMENT,
    darkMode: FEATURE_IDS.DARK_COMFORT_THEME,
    reflowGuard: FEATURE_IDS.REFLOW_GUARD,
  });

  for (const featureId of Object.values(COMFORT_VISUAL_PREF_FEATURE_IDS)) {
    assert.ok(findFeatureRegistryEntryV1(featureId), featureId);
  }
});

test('Comfort Visual reflow guard is a safety invariant, not a normal off switch', () => {
  assert.deepEqual(COMFORT_VISUAL_SAFETY_PREF_KEYS, ['reflowGuard']);
  assert.equal(COMFORT_VISUAL_USER_TOGGLEABLE_PREF_KEYS.includes('reflowGuard'), false);
  assert.equal(normalizeComfortVisualPrefs({ reflowGuard: false }).reflowGuard, true);
  assert.equal(mergeComfortVisualPrefs({ reflowGuard: true }, { reflowGuard: false }).reflowGuard, true);

  const reflow = findFeatureRegistryEntryV1(FEATURE_IDS.REFLOW_GUARD);
  assert.equal(reflow.safetyInvariant, true);
  assert.equal(reflow.userToggleable, false);
});
