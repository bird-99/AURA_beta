import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  buildLearningEffectKeyV1,
  buildRuntimeCapabilityKeyV1,
  learningEffectKeyFromRuntimeCapabilityDecisionV1,
  learningEffectKeyFromRuntimeEffectPlanV1,
  legacyLearningEffectKeyV1,
  evaluateRuntimeCapabilityV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

test('RuntimeCapabilityMatrix marks unsupported Comfort effects as non-active missing capabilities', () => {
  const decision = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    pageType: PAGE_TYPES.FORM,
    desiredEffect: 'SAFE_FORM_TEXT_LABEL_CLARITY',
  });

  assert.equal(decision.key.targetKind, TARGET_KINDS.FORM_REGION);
  assert.equal(decision.key.effectClass, EFFECT_CLASSES.FORM_LABEL_CLARITY);
  assert.equal(decision.status, CAPABILITY_STATUSES.CAPABILITY_MISSING);
  assert.equal(decision.supportLevel, SUPPORT_LEVELS.NOT_IMPLEMENTED);
  assert.equal(decision.activationStage, ACTIVATION_STAGES.REPORT_ONLY);
  assert.equal(decision.executor, RUNTIME_EXECUTORS.NONE);
  assert.equal(decision.activePlanAllowed, false);
  assert.equal(decision.learningEligible, false);
});

test('RuntimeCapabilityMatrix preserves existing Focus runtime support on known page types', () => {
  const decision = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.SEARCH,
    desiredEffect: 'SAFE_RESULT_FOCUS_TARGETS',
  });

  assert.equal(decision.key.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(decision.key.effectClass, EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY);
  assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
  assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
  assert.equal(decision.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
  assert.equal(decision.executor, RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS);
  assert.equal(decision.activePlanAllowed, true);
  assert.equal(decision.postChecksRequired, true);
  assert.equal(decision.learningEligible, false);
});

test('RuntimeCapabilityMatrix denies unsafe page types and abstains on unknown', () => {
  const dashboard = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.DASHBOARD,
    desiredEffect: 'DASHBOARD_TEXT_CONTRAST_DENSITY_CLARITY',
  });
  const unknown = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.UNKNOWN,
    desiredEffect: 'GLOBAL_VISIBLE_TEXT_LINK_CLARITY',
  });
  const modalBlocked = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.DASHBOARD,
    desiredEffect: 'DASHBOARD_TEXT_CONTRAST_DENSITY_CLARITY',
    hardBlocked: true,
  });

  assert.equal(dashboard.status, CAPABILITY_STATUSES.INTENTIONAL_DENY);
  assert.equal(dashboard.activePlanAllowed, false);
  const videoFocus = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.VIDEO,
    desiredEffect: 'SAFE_MEDIA_FOCUS_VISIBLE',
  });
  assert.equal(videoFocus.status, CAPABILITY_STATUSES.SUPPORTED);
  assert.equal(videoFocus.activePlanAllowed, true);
  assert.equal(unknown.status, CAPABILITY_STATUSES.SAFE_ABSTAIN);
  assert.equal(unknown.executor, RUNTIME_EXECUTORS.NOOP);
  assert.equal(modalBlocked.status, CAPABILITY_STATUSES.HARD_BLOCKED);
  assert.equal(modalBlocked.executor, RUNTIME_EXECUTORS.NONE);
});

test('RuntimeCapabilityMatrix makes high-risk policy explicit without vague capability missing', () => {
  const dashboardFocus = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.DASHBOARD,
    targetKind: TARGET_KINDS.DASHBOARD_REGION,
    effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
    desiredEffect: 'SAFE_DASHBOARD_FOCUS_VISIBLE',
  });
  const dashboardPageClarity = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.DASHBOARD,
    desiredEffect: 'PAGE_CLARITY_DASHBOARD_INTENTIONAL_DENY',
  });
  const videoPageClarity = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.VIDEO,
    desiredEffect: 'PAGE_CLARITY_MEDIA_INTENTIONAL_DENY',
  });
  const webAppFocus = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.WEB_APP,
    desiredEffect: 'SAFE_APP_FOCUS_VISIBLE',
  });
  const webAppPageClarity = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.WEB_APP,
    desiredEffect: 'PAGE_CLARITY_APP_INTENTIONAL_DENY',
  });

  assert.equal(dashboardFocus.status, CAPABILITY_STATUSES.SUPPORTED);
  assert.equal(dashboardFocus.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
  assert.equal(dashboardFocus.executor, RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS);
  assert.equal(dashboardFocus.activePlanAllowed, true);
  assert.equal(dashboardFocus.learningEligible, false);

  for (const decision of [dashboardPageClarity, videoPageClarity]) {
    assert.equal(decision.status, CAPABILITY_STATUSES.INTENTIONAL_DENY);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.REPORT_ONLY);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.NONE);
    assert.equal(decision.activePlanAllowed, false);
    assert.notEqual(decision.status, CAPABILITY_STATUSES.CAPABILITY_MISSING);
  }

  for (const decision of [webAppFocus, webAppPageClarity]) {
    assert.equal(decision.status, CAPABILITY_STATUSES.SAFE_ABSTAIN);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.REPORT_ONLY);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.NOOP);
    assert.equal(decision.activePlanAllowed, false);
    assert.notEqual(decision.status, CAPABILITY_STATUSES.CAPABILITY_MISSING);
  }
});

test('RuntimeCapabilityMatrix exposes explicit keys and privacy-safe JSON', () => {
  const key = buildRuntimeCapabilityKeyV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  });
  const learningKey = buildLearningEffectKeyV1(key);
  const decision = evaluateRuntimeCapabilityV1({
    ...key,
    desiredEffect: 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW',
  });

  assert.deepEqual(learningKey, {
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  });
  assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
  assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
  assert.equal(decision.activationStage, ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED);
  assert.equal(decision.executor, RUNTIME_EXECUTORS.REGION_CLASS_TOKENS);
  assert.equal(decision.activePlanAllowed, true);
  assert.equal(decision.learningEligible, false);
  assert.equal(validatePrivacySafeJson(decision).ok, true);
  assert.equal(JSON.stringify(decision).includes('{'), true);
  assert.equal(JSON.stringify(decision).includes('querySelector'), false);
});

test('RuntimeCapabilityMatrix keeps PAGE_CLARITY SHOP and FEED non-active until promoted', () => {
  for (const pageType of [PAGE_TYPES.SHOP, PAGE_TYPES.FEED]) {
    const decision = evaluateRuntimeCapabilityV1({
      modeId: 'comfort-visual',
      actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
      pageType,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
      desiredEffect: pageType === PAGE_TYPES.SHOP
        ? 'PAGE_CLARITY_RECORD_CARD_HIERARCHY_SHADOW'
        : 'PAGE_CLARITY_FEED_CARD_HIERARCHY_SHADOW',
    });

    assert.equal(decision.status, CAPABILITY_STATUSES.CAPABILITY_MISSING, pageType);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.SHADOW_ONLY, pageType);
    assert.equal(decision.activationStage, ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED, pageType);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.NONE, pageType);
    assert.equal(decision.activePlanAllowed, false, pageType);
    assert.equal(decision.learningEligible, false, pageType);
  }
});

test('RuntimeCapabilityMatrix supports Target Size only for Search and Form first', () => {
  const search = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    pageType: PAGE_TYPES.SEARCH,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT,
    desiredEffect: 'TARGET_SIZE_SEARCH_SIMPLE_CONTROLS',
  });
  const form = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    pageType: PAGE_TYPES.FORM,
    targetKind: TARGET_KINDS.FORM_REGION,
    effectClass: EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT,
    desiredEffect: 'TARGET_SIZE_FORM_SIMPLE_CONTROLS',
  });
  const feed = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    pageType: PAGE_TYPES.FEED,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT,
    desiredEffect: 'TARGET_SIZE_RECORD_CONTROLS_SHADOW',
  });

  for (const decision of [search, form]) {
    assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
    assert.equal(decision.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.SCOPED_V2);
    assert.equal(decision.activePlanAllowed, true);
    assert.equal(decision.learningEligible, false);
  }

  assert.equal(feed.status, CAPABILITY_STATUSES.CAPABILITY_MISSING);
  assert.equal(feed.supportLevel, SUPPORT_LEVELS.SHADOW_ONLY);
  assert.equal(feed.activePlanAllowed, false);
});

test('RuntimeCapabilityMatrix supports dark comfort theme as universal manual runtime', () => {
  const article = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    pageType: PAGE_TYPES.ARTICLE,
    desiredEffect: 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL',
  });
  const search = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    pageType: PAGE_TYPES.SEARCH,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.DARK_THEME_ADAPTATION,
    desiredEffect: 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL',
  });
  const dashboard = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    pageType: PAGE_TYPES.DASHBOARD,
    targetKind: TARGET_KINDS.DASHBOARD_REGION,
    effectClass: EFFECT_CLASSES.DARK_THEME_ADAPTATION,
    desiredEffect: 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL',
  });
  const unknown = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    pageType: PAGE_TYPES.UNKNOWN,
    targetKind: TARGET_KINDS.BASELINE_OR_ABSTAIN,
    effectClass: EFFECT_CLASSES.DARK_THEME_ADAPTATION,
    desiredEffect: 'DARK_COMFORT_THEME_UNIVERSAL_MANUAL',
  });

  assert.equal(article.key.targetKind, TARGET_KINDS.READING_REGION);
  assert.equal(article.key.effectClass, EFFECT_CLASSES.DARK_THEME_ADAPTATION);
  for (const decision of [article, search, dashboard, unknown]) {
    assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
    assert.equal(decision.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.DARK_THEME_TRANSFORM);
    assert.equal(decision.activePlanAllowed, true);
    assert.equal(decision.learningEligible, false);
  }
});

test('LearningEffectKeyV1 derivation separates active actions from PAGE_CLARITY shadow', () => {
  const focusDecision = evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.SEARCH,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
    desiredEffect: 'SAFE_RESULT_FOCUS_TARGETS',
  });
  const pageClarityDecision = evaluateRuntimeCapabilityV1({
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
    desiredEffect: 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW',
  });
  const comfortLegacy = legacyLearningEffectKeyV1({
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    pageType: PAGE_TYPES.ARTICLE,
  });

  assert.notDeepEqual(
    learningEffectKeyFromRuntimeCapabilityDecisionV1(focusDecision),
    learningEffectKeyFromRuntimeCapabilityDecisionV1(pageClarityDecision),
  );
  assert.notDeepEqual(comfortLegacy, learningEffectKeyFromRuntimeCapabilityDecisionV1(pageClarityDecision));
  assert.equal(pageClarityDecision.learningEligible, false);
  assert.equal(legacyLearningEffectKeyV1({
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  }), null);
});

test('LearningEffectKeyV1 derives from RuntimeEffectPlanV1 V3-light shadow only when present', () => {
  const plan = {
    version: 1,
    matrixVersion: 1,
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.SEARCH,
    frameId: 0,
    strongEffect: 'SEARCH_RESULT_DISTRACTION_DIMMING',
    safeDowngrade: 'SAFE_RESULT_FOCUS_TARGETS',
    readerAllowed: false,
    overrideAllowed: true,
    overrideScope: 'TAB_SESSION',
    postChecks: ['FOCUS_LOST'],
    policyDecision: 'REQUIRE_POST_APPLY_INSPECTION',
    confidence: 0.8,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
      capabilityStatus: CAPABILITY_STATUSES.SUPPORTED,
      supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
      activePlanAllowed: true,
      actionTargetDecisionHint: 'CANDIDATE_TARGET',
      actionTargetConfidence: 0.9,
      shadowOnly: true,
    },
  };

  assert.deepEqual(learningEffectKeyFromRuntimeEffectPlanV1(plan), {
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  });
  const { v3LightShadow, ...planWithoutShadow } = plan;
  assert.equal(v3LightShadow.shadowOnly, true);
  assert.equal(learningEffectKeyFromRuntimeEffectPlanV1(planWithoutShadow), null);
});
