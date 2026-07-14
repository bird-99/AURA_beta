import {
  FEATURE_IDS,
  FEATURE_MATURITIES,
  FEATURE_SECTIONS,
  getFeatureRegistryV1,
} from './engine-core/index.js';

export const MODE_FEATURE_UI_VERSION = 1;

export const MODE_FEATURE_UI_SECTION_TITLES = Object.freeze({
  [FEATURE_SECTIONS.CORE]: 'Core',
  [FEATURE_SECTIONS.OPTIONAL]: 'Optional tools',
  [FEATURE_SECTIONS.ADVANCED]: 'Advanced',
  [FEATURE_SECTIONS.SAFETY]: 'Safety',
});

const SECTION_ORDER = Object.freeze([
  FEATURE_SECTIONS.CORE,
  FEATURE_SECTIONS.OPTIONAL,
  FEATURE_SECTIONS.ADVANCED,
  FEATURE_SECTIONS.SAFETY,
]);

const GLOBAL_PUBLIC_MODE_ID = 'global';
const SAFETY_PUBLIC_MODE_ID = 'safety';

const DEPENDENT_FEATURES = Object.freeze({
  [FEATURE_IDS.OVERLAY_BLUR]: FEATURE_IDS.DISTRACTION_DIM,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function controlPolicyForFeature(entry) {
  if (entry.safetyInvariant === true || entry.userToggleable === false) {
    return 'always_on';
  }
  if (DEPENDENT_FEATURES[entry.featureId]) {
    return 'dependent';
  }
  return 'toggle';
}

function availabilityForFeature(entry) {
  if (entry.safetyInvariant === true) {
    return 'always_on_safety';
  }
  if (entry.maturity === FEATURE_MATURITIES.ADVANCED || entry.maturity === FEATURE_MATURITIES.EXPERIMENTAL) {
    return 'advanced_opt_in';
  }
  if (entry.maturity === FEATURE_MATURITIES.SHADOW_ONLY) {
    return 'report_only';
  }
  return 'available';
}

function toUiFeature(entry) {
  return {
    featureId: entry.featureId,
    publicModeId: entry.publicModeId,
    actionIds: clone(entry.actionIds),
    label: entry.ui.label,
    description: entry.ui.description,
    section: entry.ui.section,
    userToggleable: entry.userToggleable === true,
    defaultEnabled: entry.defaultEnabled === true,
    safetyInvariant: entry.safetyInvariant === true,
    maturity: entry.maturity,
    controlPolicy: controlPolicyForFeature(entry),
    availability: availabilityForFeature(entry),
    dependsOnFeatureId: DEPENDENT_FEATURES[entry.featureId] || null,
  };
}

function isFeatureVisibleForMode(entry, modeId) {
  return entry.userVisible === true
    && (
      entry.publicModeId === modeId
      || entry.publicModeId === GLOBAL_PUBLIC_MODE_ID
      || entry.publicModeId === SAFETY_PUBLIC_MODE_ID
    );
}

export function buildModeFeatureUiModelV1(modeId) {
  const features = getFeatureRegistryV1()
    .filter((entry) => isFeatureVisibleForMode(entry, modeId))
    .map(toUiFeature);

  return {
    version: MODE_FEATURE_UI_VERSION,
    modeId,
    sections: SECTION_ORDER.map((section) => ({
      section,
      title: MODE_FEATURE_UI_SECTION_TITLES[section],
      features: features.filter((feature) => feature.section === section),
    })).filter((section) => section.features.length > 0),
  };
}

