// shared/engine-core/mode-registry.js

import {
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';
import {
  assertValidDto,
  validateModeRegistryEntryV1,
} from './validators.js';

export const MODE_REGISTRY_VERSION = 1;
export const MODE_EXCLUSIVITY_GROUPS = Object.freeze({
  VISUAL_ADAPTATION: 'visual-adaptation',
});

function entry(config) {
  return Object.freeze(assertValidDto({
    version: MODE_REGISTRY_VERSION,
    ...config,
  }, validateModeRegistryEntryV1, 'ModeRegistryEntryV1'));
}

export const MODE_REGISTRY_V1 = Object.freeze([
  entry({
    modeId: GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL,
    publicLabel: 'Comfort Visual',
    publicIntent: 'Improve visual comfort while keeping page behavior intact.',
    shortDescription: 'Reading comfort for long text and light clarity for supported page types.',
    allowedPrefs: Object.freeze([
      'darkMode',
      'contrastGuard',
      'reduceMotion',
      'readingRuler',
    ]),
    internalActions: Object.freeze([
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      ADAPTATION_ACTION_IDS.PAGE_CLARITY,
      ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
      ADAPTATION_ACTION_IDS.REDUCE_MOTION,
    ]),
    exclusivityGroup: MODE_EXCLUSIVITY_GROUPS.VISUAL_ADAPTATION,
    defaultActivation: Object.freeze({
      visibleInPopup: true,
      optInOnly: false,
      autoApplyAllowed: false,
    }),
    learningPolicy: Object.freeze({
      allowPositiveLearning: true,
      requireInspectedOutcome: true,
      blockLearningForFallback: true,
    }),
    forbiddenPageTypes: Object.freeze([
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.UNKNOWN,
    ]),
    userFacingCopy: Object.freeze({
      on: 'Comfort is active.',
      limited: 'Comfort is running in a limited supported path.',
      denied: 'Comfort is not available on this page type.',
      error: 'Comfort could not be applied safely.',
    }),
  }),
  entry({
    modeId: GUARANTEED_EFFECT_MODE_IDS.FOCUS,
    publicLabel: 'Focus',
    publicIntent: 'Improve orientation, focus visibility and target discovery.',
    shortDescription: 'Visible focus and optional focus tools without hiding content by default.',
    allowedPrefs: Object.freeze([
      'distractionDim',
      'ultraFocus',
      'targetBoost',
      'reduceMotion',
      'readingRuler',
      'focusNotObscured',
    ]),
    internalActions: Object.freeze([
      ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      ADAPTATION_ACTION_IDS.REDUCE_MOTION,
      ADAPTATION_ACTION_IDS.TARGET_SIZE,
    ]),
    exclusivityGroup: MODE_EXCLUSIVITY_GROUPS.VISUAL_ADAPTATION,
    defaultActivation: Object.freeze({
      visibleInPopup: true,
      optInOnly: false,
      autoApplyAllowed: false,
    }),
    learningPolicy: Object.freeze({
      allowPositiveLearning: true,
      requireInspectedOutcome: true,
      blockLearningForFallback: true,
    }),
    forbiddenPageTypes: Object.freeze([
      PAGE_TYPES.UNKNOWN,
    ]),
    userFacingCopy: Object.freeze({
      on: 'Focus is active.',
      limited: 'Focus is running in a limited supported path.',
      denied: 'Focus is not available on this page type.',
      error: 'Focus could not be applied safely.',
    }),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getModeRegistryV1() {
  return clone(MODE_REGISTRY_V1);
}

export function findModeRegistryEntryV1(modeId) {
  const found = MODE_REGISTRY_V1.find((item) => item.modeId === modeId);
  return found ? clone(found) : null;
}

export function validateModeRegistryV1(registry = MODE_REGISTRY_V1) {
  const errors = [];
  const entries = Array.isArray(registry) ? registry : [];
  const expectedModes = Object.values(GUARANTEED_EFFECT_MODE_IDS);
  const seen = new Set();

  for (const modeId of expectedModes) {
    const matches = entries.filter((entryItem) => entryItem?.modeId === modeId);
    if (matches.length !== 1) {
      errors.push(`Expected exactly one mode registry entry for ${modeId}`);
    }
  }

  for (const item of entries) {
    const validation = validateModeRegistryEntryV1(item);
    validation.errors.forEach((error) => errors.push(`${item?.modeId || 'unknown'}${error.path}: ${error.message}`));
    if (seen.has(item?.modeId)) {
      errors.push(`Duplicate mode registry entry for ${item.modeId}`);
    }
    seen.add(item?.modeId);
    if (item?.defaultActivation?.autoApplyAllowed === true) {
      errors.push(`${item.modeId} must not enable auto apply by default`);
    }
    if (!Array.isArray(item?.internalActions) || item.internalActions.length === 0) {
      errors.push(`${item?.modeId || 'unknown'} must declare at least one internal action`);
    }
  }

  return { ok: errors.length === 0, errors };
}
