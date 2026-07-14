// shared/engine-core/feature-registry.js

import {
  ADAPTATION_ACTION_IDS,
  FEATURE_IDS,
  FEATURE_MATURITIES,
  FEATURE_SECTIONS,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';
import {
  assertValidDto,
  validateFeatureRegistryEntryV1,
} from './validators.js';

export const FEATURE_REGISTRY_VERSION = 1;
export const FEATURE_PUBLIC_MODE_IDS = Object.freeze({
  COMFORT_VISUAL: GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL,
  FOCUS: GUARANTEED_EFFECT_MODE_IDS.FOCUS,
  GLOBAL: 'global',
  SAFETY: 'safety',
});

function entry(config) {
  return Object.freeze(assertValidDto({
    version: FEATURE_REGISTRY_VERSION,
    ...config,
  }, validateFeatureRegistryEntryV1, 'FeatureRegistryEntryV1'));
}

function ui(label, description, section) {
  return Object.freeze({ label, description, section });
}

export const FEATURE_REGISTRY_V1 = Object.freeze([
  entry({
    featureId: FEATURE_IDS.TEXT_SCALE,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.COMFORT_VISUAL,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.STABLE,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Text scale', 'Increase bounded reading text size when supported.', FEATURE_SECTIONS.CORE),
  }),
  entry({
    featureId: FEATURE_IDS.SPACING_PACK,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.COMFORT_VISUAL,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.STABLE,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Spacing pack', 'Improve line height and paragraph spacing when supported.', FEATURE_SECTIONS.CORE),
  }),
  entry({
    featureId: FEATURE_IDS.LINK_ENHANCEMENT,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.COMFORT_VISUAL,
    actionIds: Object.freeze([
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    ]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.STABLE,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Link enhancement', 'Improve link visibility without relying on color alone.', FEATURE_SECTIONS.CORE),
  }),
  entry({
    featureId: FEATURE_IDS.TEXT_RENDERING_REFINEMENT,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.COMFORT_VISUAL,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Text rendering refinement', 'Refine letter spacing and text rendering when supported.', FEATURE_SECTIONS.ADVANCED),
  }),
  entry({
    featureId: FEATURE_IDS.DARK_COMFORT_THEME,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.COMFORT_VISUAL,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui(
      'Dark mode',
      'Use a reversible dark comfort theme when Comfort Visual is active.',
      FEATURE_SECTIONS.ADVANCED,
    ),
  }),
  entry({
    featureId: FEATURE_IDS.REFLOW_GUARD,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.SAFETY,
    actionIds: Object.freeze([]),
    userVisible: true,
    userToggleable: false,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.SAFETY_ALWAYS_ON,
    learningEligible: false,
    safetyInvariant: true,
    ui: ui('Reflow protection', 'Always on safety check for layout regressions.', FEATURE_SECTIONS.SAFETY),
  }),
  entry({
    featureId: FEATURE_IDS.CONTRAST_GUARD,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.SAFETY,
    actionIds: Object.freeze([]),
    userVisible: true,
    userToggleable: false,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.SAFETY_ALWAYS_ON,
    learningEligible: false,
    safetyInvariant: true,
    ui: ui('Contrast guard', 'Always on safety check for visibility regressions.', FEATURE_SECTIONS.SAFETY),
  }),
  entry({
    featureId: FEATURE_IDS.FOCUS_VISIBILITY,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.STABLE,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Focus visibility', 'Make focus and active targets easier to see.', FEATURE_SECTIONS.CORE),
  }),
  entry({
    featureId: FEATURE_IDS.FOCUS_NOT_OBSCURED,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.SAFETY,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: false,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.SAFETY_ALWAYS_ON,
    learningEligible: false,
    safetyInvariant: true,
    ui: ui('Focus not obscured', 'Always on safety check for keyboard focus visibility.', FEATURE_SECTIONS.SAFETY),
  }),
  entry({
    featureId: FEATURE_IDS.REDUCE_MOTION,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.GLOBAL,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.REDUCE_MOTION]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Reduce motion', 'Reduce non-essential motion when supported.', FEATURE_SECTIONS.OPTIONAL),
  }),
  entry({
    featureId: FEATURE_IDS.TARGET_BOOST,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.TARGET_SIZE]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.EXPERIMENTAL,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Target boost', 'Emphasize small controls on supported pages.', FEATURE_SECTIONS.OPTIONAL),
  }),
  entry({
    featureId: FEATURE_IDS.DISTRACTION_DIM,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Distraction dim', 'Dim surrounding content only when explicitly enabled.', FEATURE_SECTIONS.ADVANCED),
  }),
  entry({
    featureId: FEATURE_IDS.OVERLAY_BLUR,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Overlay blur', 'Optional blur for advanced focus sessions.', FEATURE_SECTIONS.ADVANCED),
  }),
  entry({
    featureId: FEATURE_IDS.READING_RULER,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Reading ruler', 'Highlight the active reading band when explicitly enabled.', FEATURE_SECTIONS.OPTIONAL),
  }),
  entry({
    featureId: FEATURE_IDS.ULTRA_FOCUS,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.FOCUS,
    actionIds: Object.freeze([ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY]),
    userVisible: true,
    userToggleable: true,
    defaultEnabled: false,
    maturity: FEATURE_MATURITIES.ADVANCED,
    learningEligible: false,
    safetyInvariant: false,
    ui: ui('Ultra focus', 'Advanced manual focus session, never automatic initially.', FEATURE_SECTIONS.ADVANCED),
  }),
  entry({
    featureId: FEATURE_IDS.POST_APPLY_INSPECTION,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.SAFETY,
    actionIds: Object.freeze([]),
    userVisible: true,
    userToggleable: false,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.SAFETY_ALWAYS_ON,
    learningEligible: false,
    safetyInvariant: true,
    ui: ui('Post-apply inspection', 'Always on safety check before active success.', FEATURE_SECTIONS.SAFETY),
  }),
  entry({
    featureId: FEATURE_IDS.ROLLBACK,
    publicModeId: FEATURE_PUBLIC_MODE_IDS.SAFETY,
    actionIds: Object.freeze([]),
    userVisible: true,
    userToggleable: false,
    defaultEnabled: true,
    maturity: FEATURE_MATURITIES.SAFETY_ALWAYS_ON,
    learningEligible: false,
    safetyInvariant: true,
    ui: ui('Rollback', 'Always available recovery path for applied effects.', FEATURE_SECTIONS.SAFETY),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getFeatureRegistryV1() {
  return clone(FEATURE_REGISTRY_V1);
}

export function findFeatureRegistryEntryV1(featureId) {
  const found = FEATURE_REGISTRY_V1.find((item) => item.featureId === featureId);
  return found ? clone(found) : null;
}

export function listFeatureRegistryEntriesForActionV1(actionId) {
  return clone(FEATURE_REGISTRY_V1.filter((item) => item.actionIds.includes(actionId)));
}

export function validateFeatureRegistryV1(registry = FEATURE_REGISTRY_V1) {
  const errors = [];
  const entries = Array.isArray(registry) ? registry : [];
  const visibleFeatures = Object.values(FEATURE_IDS);
  const seen = new Set();

  for (const featureId of visibleFeatures) {
    const matches = entries.filter((entryItem) => entryItem?.featureId === featureId);
    if (matches.length !== 1) {
      errors.push(`Expected exactly one feature registry entry for ${featureId}`);
    }
  }

  for (const item of entries) {
    const validation = validateFeatureRegistryEntryV1(item);
    validation.errors.forEach((error) => errors.push(`${item?.featureId || 'unknown'}${error.path}: ${error.message}`));
    if (seen.has(item?.featureId)) {
      errors.push(`Duplicate feature registry entry for ${item.featureId}`);
    }
    seen.add(item?.featureId);
    if (item?.safetyInvariant === true && item?.userToggleable === true) {
      errors.push(`${item.featureId} safety invariant must not be user-toggleable`);
    }
    if (item?.safetyInvariant === true && item?.defaultEnabled !== true) {
      errors.push(`${item.featureId} safety invariant must be enabled by default`);
    }
  }

  return { ok: errors.length === 0, errors };
}
