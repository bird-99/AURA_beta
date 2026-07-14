import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  FEATURE_IDS,
  FEATURE_MATURITIES,
  FEATURE_SECTIONS,
  findFeatureRegistryEntryV1,
  getFeatureRegistryV1,
  listFeatureRegistryEntriesForActionV1,
  validateFeatureRegistryEntryV1,
  validateFeatureRegistryV1,
} from '../../shared/engine-core/index.js';

function readSource(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function listJavaScriptFiles(relativeDir) {
  const root = new URL(`../../${relativeDir}/`, import.meta.url);
  const files = [];

  function walk(url, relativePrefix) {
    for (const name of readdirSync(url)) {
      const child = new URL(name, url);
      const relativePath = `${relativePrefix}${name}`;
      if (statSync(child).isDirectory()) {
        walk(new URL(`${child.href}/`), `${relativePath}/`);
      } else if (relativePath.endsWith('.js')) {
        files.push(`${relativeDir}/${relativePath}`);
      }
    }
  }

  walk(root, '');
  return files;
}

test('FeatureRegistryV1 covers every known visible feature and safety invariant', () => {
  const registry = getFeatureRegistryV1();
  const validation = validateFeatureRegistryV1();

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.deepEqual(
    registry.map((entry) => entry.featureId).sort(),
    Object.values(FEATURE_IDS).sort(),
  );
  registry.forEach((entry) => {
    assert.equal(entry.version, 1);
    assert.equal(entry.userVisible, true);
    assert.ok(entry.ui.label);
    assert.ok(entry.ui.description);
  });
});

test('FeatureRegistryV1 marks safety invariants as always-on and not toggleable', () => {
  const safetyIds = [
    FEATURE_IDS.REFLOW_GUARD,
    FEATURE_IDS.CONTRAST_GUARD,
    FEATURE_IDS.FOCUS_NOT_OBSCURED,
    FEATURE_IDS.POST_APPLY_INSPECTION,
    FEATURE_IDS.ROLLBACK,
  ];

  safetyIds.forEach((featureId) => {
    const entry = findFeatureRegistryEntryV1(featureId);
    assert.equal(entry.safetyInvariant, true, featureId);
    assert.equal(entry.userToggleable, false, featureId);
    assert.equal(entry.defaultEnabled, true, featureId);
    assert.equal(entry.maturity, FEATURE_MATURITIES.SAFETY_ALWAYS_ON, featureId);
    assert.equal(entry.ui.section, FEATURE_SECTIONS.SAFETY, featureId);
  });
});

test('FeatureRegistryV1 keeps risky and dark features opt-in or advanced', () => {
  const dark = findFeatureRegistryEntryV1(FEATURE_IDS.DARK_COMFORT_THEME);
  const dim = findFeatureRegistryEntryV1(FEATURE_IDS.DISTRACTION_DIM);
  const blur = findFeatureRegistryEntryV1(FEATURE_IDS.OVERLAY_BLUR);
  const ultra = findFeatureRegistryEntryV1(FEATURE_IDS.ULTRA_FOCUS);
  const target = findFeatureRegistryEntryV1(FEATURE_IDS.TARGET_BOOST);

  assert.equal(dark.defaultEnabled, false);
  assert.equal(dark.maturity, FEATURE_MATURITIES.ADVANCED);
  assert.deepEqual(dark.actionIds, [ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME]);
  assert.equal(dark.learningEligible, false);
  assert.equal(dark.ui.label, 'Dark mode');
  assert.equal(dark.ui.description.includes('reversible dark comfort theme'), true);
  assert.equal(dark.ui.description.includes('supported reading pages'), false);
  assert.equal(dim.defaultEnabled, false);
  assert.equal(dim.maturity, FEATURE_MATURITIES.ADVANCED);
  assert.equal(blur.defaultEnabled, false);
  assert.equal(ultra.defaultEnabled, false);
  assert.equal(ultra.learningEligible, false);
  assert.equal(target.actionIds.includes(ADAPTATION_ACTION_IDS.TARGET_SIZE), true);
});

test('FeatureRegistryV1 maps reportable actions back to visible features', () => {
  const clarityFeatures = listFeatureRegistryEntriesForActionV1(ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const darkFeatures = listFeatureRegistryEntriesForActionV1(ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const focusFeatures = listFeatureRegistryEntriesForActionV1(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);

  assert.equal(clarityFeatures.some((entry) => entry.featureId === FEATURE_IDS.LINK_ENHANCEMENT), true);
  assert.equal(darkFeatures.some((entry) => entry.featureId === FEATURE_IDS.DARK_COMFORT_THEME), true);
  assert.equal(focusFeatures.some((entry) => entry.featureId === FEATURE_IDS.FOCUS_VISIBILITY), true);
  assert.equal(focusFeatures.some((entry) => entry.featureId === FEATURE_IDS.FOCUS_NOT_OBSCURED), true);
});

test('Dark Comfort Theme runtime stays behind dedicated executor boundary', () => {
  const runtimeSources = [
    ...listJavaScriptFiles('background'),
    ...listJavaScriptFiles('content'),
    ...listJavaScriptFiles('popup'),
  ];
  const allowedDarkRuntimeSources = new Set([
    'background/dark-comfort-theme-css.js',
    'background/dark-comfort-theme-executor.js',
    'background/dark-comfort-theme-postcheck.js',
    'background/css-applier.js',
    'background/lifecycle-recovery.js',
    'background/mode-css-builders.js',
    'content/content-main.js',
    'content/dark-comfort-theme.runtime.js',
    'popup/popup.js',
  ]);

  for (const relativePath of runtimeSources) {
    const source = readSource(relativePath);
    if (!allowedDarkRuntimeSources.has(relativePath)) {
      assert.equal(/DARK_COMFORT_THEME|DARK_THEME_ADAPTATION|DARK_THEME_TRANSFORM/.test(source), false, relativePath);
    }
    assert.equal(/DarkReader|darkreader|dark-reader/.test(source), false, relativePath);
  }
});

test('FeatureRegistryV1 validator rejects unsafe and incoherent entries', () => {
  const reflow = findFeatureRegistryEntryV1(FEATURE_IDS.REFLOW_GUARD);

  assert.equal(validateFeatureRegistryEntryV1(reflow).ok, true);
  assert.equal(validateFeatureRegistryEntryV1({ ...reflow, selector: '.scope' }).ok, false);
  assert.equal(validateFeatureRegistryEntryV1({ ...reflow, userToggleable: true }).ok, false);
  assert.equal(validateFeatureRegistryEntryV1({ ...reflow, defaultEnabled: false }).ok, false);
});
