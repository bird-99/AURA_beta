// shared/engine-core/action-registry.js

import {
  ACTION_POLICY_DECISIONS,
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  PAGE_TYPES,
  SUPPORT_LEVELS,
  TARGET_KINDS,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';
import {
  assertValidDto,
  validateActionRegistryEntryV1,
} from './validators.js';

export const ACTION_REGISTRY_VERSION = 1;

/** @type {ReadonlyArray<string>} */
const ALL_PAGE_TYPES = Object.freeze(Object.values(PAGE_TYPES));
/** @type {ReadonlyArray<string>} */
const CORE_CONTENT_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.ARTICLE,
  PAGE_TYPES.DOC,
]);
/** @type {ReadonlyArray<string>} */
const RECORD_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.SEARCH,
  PAGE_TYPES.SHOP,
  PAGE_TYPES.FEED,
]);
/** @type {ReadonlyArray<string>} */
const HIGH_RISK_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.DASHBOARD,
  PAGE_TYPES.VIDEO,
  PAGE_TYPES.WEB_APP,
]);

function entry(config) {
  return Object.freeze(assertValidDto({
    version: ACTION_REGISTRY_VERSION,
    ...config,
  }, validateActionRegistryEntryV1, 'ActionRegistryEntryV1'));
}

function learningEligibility({
  positiveLearningAllowed,
  requiresNoUndoWindow = true,
  blockedWhenLimited = true,
}) {
  return Object.freeze({
    positiveLearningAllowed,
    requiresNoUndoWindow,
    blockedWhenLimited,
  });
}

/**
 * @param {string} [userRequest]
 */
function defaultPolicy(userRequest = ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION) {
  return Object.freeze({
    userRequest,
    autoApply: ACTION_POLICY_DECISIONS.DENY,
  });
}

export const ACTION_REGISTRY_V1 = Object.freeze([
  entry({
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    parentModes: Object.freeze([GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL]),
    targetKinds: Object.freeze([TARGET_KINDS.READING_REGION]),
    effectClasses: Object.freeze([EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY]),
    allowedPageTypes: CORE_CONTENT_PAGE_TYPES,
    shadowPageTypes: Object.freeze([]),
    deniedPageTypes: Object.freeze(ALL_PAGE_TYPES.filter((pageType) => !CORE_CONTENT_PAGE_TYPES.includes(pageType))),
    defaultSupportLevel: SUPPORT_LEVELS.NOT_IMPLEMENTED,
    activationStage: ACTIVATION_STAGES.REPORT_ONLY,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: true }),
    defaultPolicy: defaultPolicy(),
  }),
  entry({
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    parentModes: Object.freeze([GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL]),
    targetKinds: Object.freeze([
      TARGET_KINDS.RECORD_REGION,
      TARGET_KINDS.FORM_REGION,
      TARGET_KINDS.READING_REGION,
    ]),
    effectClasses: Object.freeze([
      EFFECT_CLASSES.REGION_LIGHT_CLARITY,
      EFFECT_CLASSES.FORM_LABEL_CLARITY,
      EFFECT_CLASSES.RECORD_CARD_CLARITY,
    ]),
    allowedPageTypes: Object.freeze([
      PAGE_TYPES.SEARCH,
      PAGE_TYPES.FORM,
    ]),
    shadowPageTypes: Object.freeze([
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.FEED,
    ]),
    deniedPageTypes: Object.freeze([
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.UNKNOWN,
    ]),
    defaultSupportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    activationStage: ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: false }),
    defaultPolicy: defaultPolicy(),
  }),
  entry({
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    parentModes: Object.freeze([GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL]),
    targetKinds: Object.freeze([
      TARGET_KINDS.READING_REGION,
      TARGET_KINDS.RECORD_REGION,
      TARGET_KINDS.FORM_REGION,
      TARGET_KINDS.DASHBOARD_REGION,
      TARGET_KINDS.MEDIA_REGION,
      TARGET_KINDS.APP_REGION,
      TARGET_KINDS.BASELINE_OR_ABSTAIN,
    ]),
    effectClasses: Object.freeze([EFFECT_CLASSES.DARK_THEME_ADAPTATION]),
    allowedPageTypes: Object.freeze([
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.SEARCH,
      PAGE_TYPES.FORM,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.FEED,
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.UNKNOWN,
    ]),
    shadowPageTypes: Object.freeze([]),
    deniedPageTypes: Object.freeze([]),
    defaultSupportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: false }),
    defaultPolicy: defaultPolicy(),
  }),
  entry({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    parentModes: Object.freeze([GUARANTEED_EFFECT_MODE_IDS.FOCUS]),
    targetKinds: Object.freeze([
      TARGET_KINDS.FOCUSABLE_REGION,
      TARGET_KINDS.READING_REGION,
      TARGET_KINDS.RECORD_REGION,
      TARGET_KINDS.FORM_REGION,
    ]),
    effectClasses: Object.freeze([EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY]),
    allowedPageTypes: Object.freeze([
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.SEARCH,
      PAGE_TYPES.FORM,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.FEED,
    ]),
    shadowPageTypes: HIGH_RISK_PAGE_TYPES,
    deniedPageTypes: Object.freeze([PAGE_TYPES.UNKNOWN]),
    defaultSupportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: true }),
    defaultPolicy: defaultPolicy(),
  }),
  entry({
    actionId: ADAPTATION_ACTION_IDS.REDUCE_MOTION,
    parentModes: Object.freeze([
      GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL,
      GUARANTEED_EFFECT_MODE_IDS.FOCUS,
    ]),
    targetKinds: Object.freeze([
      TARGET_KINDS.BASELINE_OR_ABSTAIN,
      TARGET_KINDS.RECORD_REGION,
      TARGET_KINDS.MEDIA_REGION,
      TARGET_KINDS.DASHBOARD_REGION,
      TARGET_KINDS.APP_REGION,
    ]),
    effectClasses: Object.freeze([EFFECT_CLASSES.DISTRACTION_REDUCTION]),
    allowedPageTypes: Object.freeze([]),
    shadowPageTypes: Object.freeze(ALL_PAGE_TYPES.filter((pageType) => pageType !== PAGE_TYPES.UNKNOWN)),
    deniedPageTypes: Object.freeze([PAGE_TYPES.UNKNOWN]),
    defaultSupportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    activationStage: ACTIVATION_STAGES.SHADOW_ONLY,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: false }),
    defaultPolicy: defaultPolicy(ACTION_POLICY_DECISIONS.DENY),
  }),
  entry({
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    parentModes: Object.freeze([GUARANTEED_EFFECT_MODE_IDS.FOCUS]),
    targetKinds: Object.freeze([
      TARGET_KINDS.FORM_REGION,
      TARGET_KINDS.RECORD_REGION,
    ]),
    effectClasses: Object.freeze([EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT]),
    allowedPageTypes: Object.freeze([
      PAGE_TYPES.FORM,
      PAGE_TYPES.SEARCH,
    ]),
    shadowPageTypes: Object.freeze([
      PAGE_TYPES.SHOP,
      PAGE_TYPES.FEED,
    ]),
    deniedPageTypes: Object.freeze([
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.UNKNOWN,
    ]),
    defaultSupportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requiresCapability: true,
    requiresPostChecks: true,
    learningEligibility: learningEligibility({ positiveLearningAllowed: false }),
    defaultPolicy: defaultPolicy(ACTION_POLICY_DECISIONS.DENY),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getActionRegistryV1() {
  return clone(ACTION_REGISTRY_V1);
}

export function findActionRegistryEntryV1(actionId) {
  const found = ACTION_REGISTRY_V1.find((item) => item.actionId === actionId);
  return found ? clone(found) : null;
}

export function listActionRegistryEntriesForModeV1(modeId) {
  return clone(ACTION_REGISTRY_V1.filter((item) => item.parentModes.includes(modeId)));
}

export function validateActionRegistryV1(registry = ACTION_REGISTRY_V1) {
  const errors = [];
  const entries = Array.isArray(registry) ? registry : [];
  const knownActions = Object.values(ADAPTATION_ACTION_IDS);
  const seen = new Set();

  for (const actionId of knownActions) {
    const matches = entries.filter((entryItem) => entryItem?.actionId === actionId);
    if (matches.length !== 1) {
      errors.push(`Expected exactly one action registry entry for ${actionId}`);
    }
  }

  for (const item of entries) {
    const validation = validateActionRegistryEntryV1(item);
    validation.errors.forEach((error) => errors.push(`${item?.actionId || 'unknown'}${error.path}: ${error.message}`));
    if (seen.has(item?.actionId)) {
      errors.push(`Duplicate action registry entry for ${item.actionId}`);
    }
    seen.add(item?.actionId);
    const coveredPageTypes = new Set([
      ...(item?.allowedPageTypes || []),
      ...(item?.shadowPageTypes || []),
      ...(item?.deniedPageTypes || []),
    ]);
    for (const pageType of ALL_PAGE_TYPES) {
      if (!coveredPageTypes.has(pageType)) {
        errors.push(`${item?.actionId || 'unknown'} missing page type ${pageType}`);
      }
    }
    if (item?.activationStage === ACTIVATION_STAGES.AUTO) {
      errors.push(`${item.actionId} must not be AUTO in PR10`);
    }
    if (item?.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY && item?.learningEligibility?.positiveLearningAllowed === true) {
      errors.push('PAGE_CLARITY must not allow positive learning in PR10');
    }
  }

  return { ok: errors.length === 0, errors };
}
