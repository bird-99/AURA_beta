import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FEATURE_IDS,
  FEATURE_SECTIONS,
} from '../../shared/engine-core/index.js';
import { buildModeFeatureUiModelV1 } from '../../shared/mode-feature-ui.js';

function flatten(model) {
  return model.sections.flatMap((section) => section.features);
}

function feature(model, featureId) {
  return flatten(model).find((entry) => entry.featureId === featureId);
}

test('Mode feature UI model groups Comfort options without making safety toggles', () => {
  const model = buildModeFeatureUiModelV1('comfort-visual');

  assert.equal(model.version, 1);
  assert.deepEqual(model.sections.map((section) => section.section), [
    FEATURE_SECTIONS.CORE,
    FEATURE_SECTIONS.OPTIONAL,
    FEATURE_SECTIONS.ADVANCED,
    FEATURE_SECTIONS.SAFETY,
  ]);

  assert.equal(feature(model, FEATURE_IDS.TEXT_SCALE).section, FEATURE_SECTIONS.CORE);
  assert.equal(feature(model, FEATURE_IDS.SPACING_PACK).section, FEATURE_SECTIONS.CORE);
  assert.equal(feature(model, FEATURE_IDS.LINK_ENHANCEMENT).section, FEATURE_SECTIONS.CORE);

  const dark = feature(model, FEATURE_IDS.DARK_COMFORT_THEME);
  assert.equal(dark.section, FEATURE_SECTIONS.ADVANCED);
  assert.equal(dark.label, 'Dark mode');
  assert.equal(dark.defaultEnabled, false);
  assert.equal(dark.availability, 'advanced_opt_in');
  assert.equal(dark.description.includes('reversible dark comfort theme'), true);
  assert.equal(/force/i.test(dark.description), false);

  const reflow = feature(model, FEATURE_IDS.REFLOW_GUARD);
  assert.equal(reflow.section, FEATURE_SECTIONS.SAFETY);
  assert.equal(reflow.controlPolicy, 'always_on');
  assert.equal(reflow.userToggleable, false);
});

test('Mode feature UI model groups Focus core, optional tools, advanced tools and safety', () => {
  const model = buildModeFeatureUiModelV1('focus');

  assert.equal(feature(model, FEATURE_IDS.FOCUS_VISIBILITY).section, FEATURE_SECTIONS.CORE);
  assert.equal(feature(model, FEATURE_IDS.READING_RULER).section, FEATURE_SECTIONS.OPTIONAL);
  assert.equal(feature(model, FEATURE_IDS.TARGET_BOOST).section, FEATURE_SECTIONS.OPTIONAL);
  assert.equal(feature(model, FEATURE_IDS.REDUCE_MOTION).section, FEATURE_SECTIONS.OPTIONAL);

  const dim = feature(model, FEATURE_IDS.DISTRACTION_DIM);
  const blur = feature(model, FEATURE_IDS.OVERLAY_BLUR);
  const ultra = feature(model, FEATURE_IDS.ULTRA_FOCUS);
  assert.equal(dim.section, FEATURE_SECTIONS.ADVANCED);
  assert.equal(ultra.section, FEATURE_SECTIONS.ADVANCED);
  assert.equal(blur.controlPolicy, 'dependent');
  assert.equal(blur.dependsOnFeatureId, FEATURE_IDS.DISTRACTION_DIM);

  const focusNotObscured = feature(model, FEATURE_IDS.FOCUS_NOT_OBSCURED);
  assert.equal(focusNotObscured.section, FEATURE_SECTIONS.SAFETY);
  assert.equal(focusNotObscured.controlPolicy, 'always_on');
  assert.equal(focusNotObscured.userToggleable, false);
});
