// shared/engine-core/runtime-effect-planner.js

import { getGuaranteedEffectV1 } from './guaranteed-effect-matrix.js';
import { buildActionTargetsV1, findActionTargetV1 } from './action-targets.js';
import { ADAPTATION_ACTION_IDS, PAGE_TYPES, PROBLEM_CODES } from './enums.js';
import { buildRegionInventoryV1 } from './region-inventory.js';
import {
  desiredEffectForActionTargetV1,
  evaluateRuntimeCapabilityV1,
} from './runtime-capability-matrix.js';
import {
  assertValidDto,
  validateActionPolicyDecisionV1,
  validatePageUnderstandingProfileV1,
  validateRuntimeEffectPlanV1,
} from './validators.js';

export const RUNTIME_EFFECT_PLAN_VERSION = 1;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasBlockingProblem(profile) {
  return (profile.problems || []).some((problem) => problem?.code === PROBLEM_CODES.MODAL_OVERLAY_PRESENT);
}

function buildV3LightShadowPlan({ modeId, profile, actionId, desiredEffect }) {
  const inventory = buildRegionInventoryV1(profile);
  const actionTargets = buildActionTargetsV1(profile, inventory);
  const actionTarget = findActionTargetV1(actionTargets, actionId);
  const capability = evaluateRuntimeCapabilityV1({
    modeId,
    actionId,
    pageType: profile.pageType,
    targetKind: actionTarget?.targetKind,
    effectClass: actionTarget?.effectClass,
    desiredEffect,
    hardBlocked: hasBlockingProblem(profile),
  });

  return {
    version: 1,
    actionId,
    desiredEffect: capability.desiredEffect,
    targetKind: capability.key.targetKind,
    effectClass: capability.key.effectClass,
    sourceBlockId: actionTarget?.sourceBlockId || 'none',
    regionId: actionTarget?.regionId || 'none',
    collectionEpoch: profile.collectionEpoch || '',
    routeEpoch: profile.routeEpoch || '',
    capabilityStatus: capability.status,
    supportLevel: capability.supportLevel,
    activationStage: capability.activationStage,
    executor: capability.executor,
    activePlanAllowed: capability.activePlanAllowed,
    actionTargetDecisionHint: actionTarget?.decisionHint || 'TARGET_MISSING_ABSTAIN',
    actionTargetConfidence: clamp01(actionTarget?.confidence || 0),
    shadowOnly: true,
  };
}

function actionIdForV3LightShadow({ modeId, profile, actionId }) {
  if (
    modeId === 'comfort-visual'
    && [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM].includes(profile.pageType)
  ) {
    return ADAPTATION_ACTION_IDS.PAGE_CLARITY;
  }
  return actionId;
}

/**
 * @param {{
 *   modeId?: string,
 *   profile?: unknown,
 *   actionPolicyDecision?: unknown,
 *   includeV3LightShadow?: boolean,
 * }} [input]
 */
export function buildRuntimeEffectPlanV1(input = {}) {
  const { modeId, profile, actionPolicyDecision, includeV3LightShadow = false } = input;
  const checkedProfile = assertValidDto(profile, validatePageUnderstandingProfileV1, 'PageUnderstandingProfileV1');
  const checkedDecision = assertValidDto(
    actionPolicyDecision,
    validateActionPolicyDecisionV1,
    'ActionPolicyDecisionV1',
  );
  const matrixRow = getGuaranteedEffectV1(modeId, checkedProfile.pageType);
  if (!matrixRow) {
    throw new TypeError(`No guaranteed effect row for ${modeId}:${checkedProfile.pageType}`);
  }

  const plan = {
    version: RUNTIME_EFFECT_PLAN_VERSION,
    matrixVersion: matrixRow.version,
    modeId: matrixRow.modeId,
    actionId: checkedDecision.actionId,
    pageType: checkedProfile.pageType,
    frameId: checkedProfile.frameId,
    strongEffect: matrixRow.strongEffect,
    safeDowngrade: matrixRow.safeDowngrade,
    readerAllowed: matrixRow.readerAllowed === true,
    overrideAllowed: matrixRow.overrideAllowed === true,
    overrideScope: matrixRow.overrideScope,
    postChecks: clone(matrixRow.postChecks),
    policyDecision: checkedDecision.decision,
    confidence: clamp01(Math.min(checkedProfile.pageTypeConfidence, checkedDecision.confidence)),
  };

  if (includeV3LightShadow === true) {
    try {
      const shadowActionId = actionIdForV3LightShadow({
        modeId: matrixRow.modeId,
        profile: checkedProfile,
        actionId: checkedDecision.actionId,
      });
      plan.v3LightShadow = buildV3LightShadowPlan({
        modeId: matrixRow.modeId,
        profile: checkedProfile,
        actionId: shadowActionId,
        desiredEffect: shadowActionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
          ? desiredEffectForActionTargetV1(shadowActionId, checkedProfile.pageType)
          : matrixRow.safeDowngrade,
      });
    } catch {
      // V3-light is shadow-only in PR4; failures must not block the current plan.
    }
  }

  return assertValidDto(plan, validateRuntimeEffectPlanV1, 'RuntimeEffectPlanV1');
}
