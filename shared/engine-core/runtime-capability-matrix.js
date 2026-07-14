// shared/engine-core/runtime-capability-matrix.js

import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';
import {
  assertValidDto,
  validateLearningEffectKeyV1,
  validateRuntimeCapabilityDecisionV1,
  validateRuntimeCapabilityKeyV1,
  validateRuntimeEffectPlanV1,
} from './validators.js';
import { findActionRegistryEntryV1 } from './action-registry.js';

export const RUNTIME_CAPABILITY_MATRIX_VERSION = 1;

const INTENTIONAL_DENY_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.DASHBOARD,
  PAGE_TYPES.VIDEO,
]);
const SAFE_ABSTAIN_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.UNKNOWN,
  PAGE_TYPES.WEB_APP,
]);
const FOCUS_HIGH_RISK_SAFE_DOWNGRADES = Object.freeze({
  [PAGE_TYPES.DASHBOARD]: 'SAFE_DASHBOARD_FOCUS_VISIBLE',
  [PAGE_TYPES.VIDEO]: 'SAFE_MEDIA_FOCUS_VISIBLE',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function activationStageForAction(actionId) {
  return findActionRegistryEntryV1(actionId)?.activationStage || ACTIVATION_STAGES.REPORT_ONLY;
}

function activationStageAllowsActivePlan(activationStage) {
  return [
    ACTIVATION_STAGES.MANUAL_LIMITED,
    ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED,
    ACTIVATION_STAGES.VERIFIED,
    ACTIVATION_STAGES.ASSISTED,
  ].includes(activationStage);
}

export function targetKindForPageType(pageType) {
  switch (pageType) {
    case PAGE_TYPES.ARTICLE:
    case PAGE_TYPES.DOC:
      return TARGET_KINDS.READING_REGION;
    case PAGE_TYPES.SEARCH:
    case PAGE_TYPES.SHOP:
    case PAGE_TYPES.FEED:
      return TARGET_KINDS.RECORD_REGION;
    case PAGE_TYPES.FORM:
      return TARGET_KINDS.FORM_REGION;
    case PAGE_TYPES.DASHBOARD:
      return TARGET_KINDS.DASHBOARD_REGION;
    case PAGE_TYPES.VIDEO:
      return TARGET_KINDS.MEDIA_REGION;
    case PAGE_TYPES.WEB_APP:
      return TARGET_KINDS.APP_REGION;
    case PAGE_TYPES.UNKNOWN:
      return TARGET_KINDS.BASELINE_OR_ABSTAIN;
    default:
      return TARGET_KINDS.NONE;
  }
}

export function effectClassForActionTarget(actionId, pageType) {
  if (actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    return EFFECT_CLASSES.DARK_THEME_ADAPTATION;
  }
  if (actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY) {
    return EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY;
  }
  if (actionId === ADAPTATION_ACTION_IDS.REDUCE_MOTION) {
    return EFFECT_CLASSES.DISTRACTION_REDUCTION;
  }
  if (actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE) {
    return EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT;
  }
  if (pageType === PAGE_TYPES.UNKNOWN) {
    return EFFECT_CLASSES.NOOP;
  }
  if (actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    if (pageType === PAGE_TYPES.FORM) {
      return EFFECT_CLASSES.FORM_LABEL_CLARITY;
    }
    if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) {
      return EFFECT_CLASSES.RECORD_CARD_CLARITY;
    }
    return EFFECT_CLASSES.REGION_LIGHT_CLARITY;
  }
  if ([PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType)) {
    return EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY;
  }
  if (pageType === PAGE_TYPES.FORM) {
    return EFFECT_CLASSES.FORM_LABEL_CLARITY;
  }
  if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) {
    return EFFECT_CLASSES.RECORD_CARD_CLARITY;
  }
  return EFFECT_CLASSES.REGION_LIGHT_CLARITY;
}

export function desiredEffectForActionTargetV1(actionId, pageType) {
  if (actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    return 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL';
  }
  if (actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    switch (pageType) {
      case PAGE_TYPES.ARTICLE:
      case PAGE_TYPES.DOC:
        return 'PAGE_CLARITY_REGION_LIGHT_SHADOW';
      case PAGE_TYPES.SEARCH:
        return 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW';
      case PAGE_TYPES.SHOP:
        return 'PAGE_CLARITY_RECORD_CARD_HIERARCHY_SHADOW';
      case PAGE_TYPES.FORM:
        return 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW';
      case PAGE_TYPES.FEED:
        return 'PAGE_CLARITY_FEED_CARD_HIERARCHY_SHADOW';
      case PAGE_TYPES.DASHBOARD:
        return 'PAGE_CLARITY_DASHBOARD_INTENTIONAL_DENY';
      case PAGE_TYPES.VIDEO:
        return 'PAGE_CLARITY_MEDIA_INTENTIONAL_DENY';
      case PAGE_TYPES.WEB_APP:
        return 'PAGE_CLARITY_APP_INTENTIONAL_DENY';
      default:
        return 'PAGE_CLARITY_SAFE_ABSTAIN';
    }
  }
  if (actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE) {
    switch (pageType) {
      case PAGE_TYPES.SEARCH:
        return 'TARGET_SIZE_SEARCH_SIMPLE_CONTROLS';
      case PAGE_TYPES.FORM:
        return 'TARGET_SIZE_FORM_SIMPLE_CONTROLS';
      case PAGE_TYPES.SHOP:
      case PAGE_TYPES.FEED:
        return 'TARGET_SIZE_RECORD_CONTROLS_SHADOW';
      case PAGE_TYPES.DASHBOARD:
      case PAGE_TYPES.VIDEO:
      case PAGE_TYPES.WEB_APP:
        return 'TARGET_SIZE_HIGH_RISK_DENY';
      default:
        return 'TARGET_SIZE_SAFE_ABSTAIN';
    }
  }
  return 'NOOP';
}

export function buildRuntimeCapabilityKeyV1(input = {}) {
  const key = {
    modeId: input.modeId || '',
    actionId: input.actionId || '',
    pageType: input.pageType || PAGE_TYPES.UNKNOWN,
    targetKind: input.targetKind || targetKindForPageType(input.pageType || PAGE_TYPES.UNKNOWN),
    effectClass: input.effectClass || effectClassForActionTarget(input.actionId || '', input.pageType || PAGE_TYPES.UNKNOWN),
  };

  return assertValidDto(key, validateRuntimeCapabilityKeyV1, 'RuntimeCapabilityKeyV1');
}

export function buildLearningEffectKeyV1(input = {}) {
  const key = input?.key || input || {};
  const learningKey = {
    modeId: key.modeId || '',
    actionId: key.actionId || '',
    targetKind: key.targetKind || TARGET_KINDS.NONE,
    effectClass: key.effectClass || EFFECT_CLASSES.NOOP,
    pageType: key.pageType || PAGE_TYPES.UNKNOWN,
  };

  return assertValidDto(learningKey, validateLearningEffectKeyV1, 'LearningEffectKeyV1');
}

export function learningEffectKeyFromRuntimeCapabilityDecisionV1(decisionInput = {}) {
  const capabilityDecision = assertValidDto(
    decisionInput,
    validateRuntimeCapabilityDecisionV1,
    'RuntimeCapabilityDecisionV1',
  );
  return buildLearningEffectKeyV1(capabilityDecision.key);
}

export function learningEffectKeyFromRuntimeEffectPlanV1(planInput = {}) {
  const plan = assertValidDto(planInput, validateRuntimeEffectPlanV1, 'RuntimeEffectPlanV1');
  const shadow = plan.v3LightShadow;
  if (!shadow || shadow.shadowOnly !== true) {
    return null;
  }
  return buildLearningEffectKeyV1({
    modeId: plan.modeId,
    actionId: shadow.actionId,
    targetKind: shadow.targetKind,
    effectClass: shadow.effectClass,
    pageType: plan.pageType,
  });
}

export function legacyLearningEffectKeyV1(input = {}) {
  const actionId = input.actionId || '';
  const pageType = input.pageType || PAGE_TYPES.UNKNOWN;
  const modeId = input.modeId
    || (actionId === ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY
      ? GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL
      : actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY
        ? GUARANTEED_EFFECT_MODE_IDS.FOCUS
        : '');

  if (
    ![
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    ].includes(actionId)
  ) {
    return null;
  }

  try {
    return buildLearningEffectKeyV1({
      modeId,
      actionId,
      targetKind: input.targetKind || targetKindForPageType(pageType),
      effectClass: input.effectClass || effectClassForActionTarget(actionId, pageType),
      pageType,
    });
  } catch {
    return null;
  }
}

function decision(input) {
  const activationStage = input.activationStage || activationStageForAction(input.key?.actionId);
  const output = {
    version: RUNTIME_CAPABILITY_MATRIX_VERSION,
    key: clone(input.key),
    desiredEffect: input.desiredEffect || 'NOOP',
    status: input.status,
    supportLevel: input.supportLevel,
    activationStage,
    executor: input.executor,
    activePlanAllowed: input.activePlanAllowed === true && activationStageAllowsActivePlan(activationStage),
    reason: input.reason,
    postChecksRequired: input.postChecksRequired === true,
    learningEligible: input.learningEligible === true,
  };

  return assertValidDto(output, validateRuntimeCapabilityDecisionV1, 'RuntimeCapabilityDecisionV1');
}

function safeAbstain(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.SAFE_ABSTAIN,
    supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    executor: RUNTIME_EXECUTORS.NOOP,
    activePlanAllowed: false,
    reason: 'UNKNOWN_PAGE_SAFE_ABSTAIN',
    postChecksRequired: false,
    learningEligible: false,
  });
}

function hardBlocked(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.HARD_BLOCKED,
    supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    executor: RUNTIME_EXECUTORS.NONE,
    activePlanAllowed: false,
    reason: 'BLOCKING_PROFILE_PROBLEM',
    postChecksRequired: false,
    learningEligible: false,
  });
}

function intentionalDeny(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.INTENTIONAL_DENY,
    supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    executor: RUNTIME_EXECUTORS.NONE,
    activePlanAllowed: false,
    reason: 'PAGE_TYPE_DENIED_UNTIL_ACTIVE_PROOF',
    postChecksRequired: false,
    learningEligible: false,
  });
}

function capabilityMissing(key, desiredEffect) {
  if (key.actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    return decision({
      key,
      desiredEffect,
      status: CAPABILITY_STATUSES.MISSING_EXECUTOR,
      supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
      executor: RUNTIME_EXECUTORS.NONE,
      activePlanAllowed: false,
      reason: 'DARK_COMFORT_THEME_REPORT_ONLY_NO_EXECUTOR',
      postChecksRequired: false,
      learningEligible: false,
    });
  }
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.CAPABILITY_MISSING,
    supportLevel: [ADAPTATION_ACTION_IDS.PAGE_CLARITY, ADAPTATION_ACTION_IDS.TARGET_SIZE].includes(key.actionId)
      ? SUPPORT_LEVELS.SHADOW_ONLY
      : SUPPORT_LEVELS.NOT_IMPLEMENTED,
    executor: RUNTIME_EXECUTORS.NONE,
    activePlanAllowed: false,
    reason: key.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
      ? 'PAGE_CLARITY_SHADOW_NO_ACTIVE_EXECUTOR'
      : key.actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE
        ? 'TARGET_SIZE_SHADOW_NO_ACTIVE_EXECUTOR'
        : 'NO_ACTIVE_RUNTIME_EXECUTOR',
    postChecksRequired: false,
    learningEligible: false,
  });
}

function supportedFocus(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
    activePlanAllowed: true,
    reason: 'FOCUS_SAFE_DOWNGRADE_RUNTIME_SUPPORTED',
    postChecksRequired: true,
    learningEligible: false,
  });
}

function isExactHighRiskFocusLimitedAction(key, desiredEffect) {
  return key.modeId === GUARANTEED_EFFECT_MODE_IDS.FOCUS
    && key.actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY
    && key.effectClass === EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY
    && FOCUS_HIGH_RISK_SAFE_DOWNGRADES[key.pageType] === desiredEffect;
}

function supportedPageClarity(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.REGION_CLASS_TOKENS,
    activePlanAllowed: true,
    reason: 'PAGE_CLARITY_RUNTIME_SUPPORTED',
    postChecksRequired: true,
    learningEligible: false,
  });
}

function supportedTargetSize(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.SCOPED_V2,
    activePlanAllowed: true,
    reason: 'TARGET_SIZE_FORM_SEARCH_RUNTIME_SUPPORTED',
    postChecksRequired: true,
    learningEligible: false,
  });
}

function supportedDarkComfortTheme(key, desiredEffect) {
  return decision({
    key,
    desiredEffect,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.DARK_THEME_TRANSFORM,
    activePlanAllowed: true,
    reason: 'DARK_COMFORT_THEME_MANUAL_LIMITED_SUPPORTED',
    postChecksRequired: true,
    learningEligible: false,
  });
}

export function evaluateRuntimeCapabilityV1(input = {}) {
  const key = buildRuntimeCapabilityKeyV1(input);
  const desiredEffect = input.desiredEffect || 'NOOP';

  if (
    key.modeId === GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL
    && key.actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME
    && key.targetKind !== TARGET_KINDS.NONE
    && key.effectClass === EFFECT_CLASSES.DARK_THEME_ADAPTATION
    && desiredEffect === 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL'
  ) {
    return supportedDarkComfortTheme(key, desiredEffect);
  }
  if (SAFE_ABSTAIN_PAGE_TYPES.includes(key.pageType)) {
    return safeAbstain(key, desiredEffect);
  }
  if (input.hardBlocked === true) {
    return hardBlocked(key, desiredEffect);
  }
  if (INTENTIONAL_DENY_PAGE_TYPES.includes(key.pageType) && !isExactHighRiskFocusLimitedAction(key, desiredEffect)) {
    return intentionalDeny(key, desiredEffect);
  }
  if (
    key.modeId === GUARANTEED_EFFECT_MODE_IDS.FOCUS
    && key.actionId === ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY
    && key.effectClass === EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY
  ) {
    return supportedFocus(key, desiredEffect);
  }
  if (
    key.modeId === GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL
    && key.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
    && (
      (key.pageType === PAGE_TYPES.SEARCH
        && key.targetKind === TARGET_KINDS.RECORD_REGION
        && key.effectClass === EFFECT_CLASSES.RECORD_CARD_CLARITY
        && desiredEffect === 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW')
      || (key.pageType === PAGE_TYPES.FORM
        && key.targetKind === TARGET_KINDS.FORM_REGION
        && key.effectClass === EFFECT_CLASSES.FORM_LABEL_CLARITY
        && desiredEffect === 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW')
    )
  ) {
    return supportedPageClarity(key, desiredEffect);
  }
  if (
    key.modeId === GUARANTEED_EFFECT_MODE_IDS.FOCUS
    && key.actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE
    && key.effectClass === EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT
    && (
      (key.pageType === PAGE_TYPES.SEARCH
        && key.targetKind === TARGET_KINDS.RECORD_REGION
        && desiredEffect === 'TARGET_SIZE_SEARCH_SIMPLE_CONTROLS')
      || (key.pageType === PAGE_TYPES.FORM
        && key.targetKind === TARGET_KINDS.FORM_REGION
        && desiredEffect === 'TARGET_SIZE_FORM_SIMPLE_CONTROLS')
    )
  ) {
    return supportedTargetSize(key, desiredEffect);
  }
  return capabilityMissing(key, desiredEffect);
}
