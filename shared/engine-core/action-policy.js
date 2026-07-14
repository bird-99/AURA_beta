// shared/engine-core/action-policy.js

import { ENGINE_CORE_SCHEMA_VERSION } from './contracts.js';
import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  INVARIANT_CODES,
  PAGE_TYPES,
  REASON_CODES,
} from './enums.js';
import {
  evaluateAdaptationContractV1,
  getAdaptationContractV1,
} from './adaptation-contracts.js';
import {
  assertValidDto,
  validateActionContextV1,
  validateActionPolicyDecisionV1,
  validatePageUnderstandingProfileV1,
} from './validators.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueReasons(...groups) {
  const reasons = new Set();
  for (const group of groups) {
    for (const reason of group || []) {
      reasons.add(reason);
    }
  }
  return Array.from(reasons).slice(0, 20);
}

function decisionConfidence(profile) {
  const pageConfidence = clamp01(profile.pageTypeConfidence);
  const confidenceRisk = clamp01(profile.risk?.confidenceRisk || 0);
  return clamp01(Math.min(pageConfidence, 1 - confidenceRisk));
}

function cappedStrength(readiness, context) {
  const contractMax = typeof readiness.constraints?.maxStrength === 'number'
    ? readiness.constraints.maxStrength
    : 1;
  if (typeof context.requestedStrength === 'number') {
    return Math.min(contractMax, context.requestedStrength);
  }
  return contractMax;
}

function scopeRequired(contract) {
  return contract?.applyPlan?.kind === 'SCOPED_CSS';
}

function safetyReasons(profile, readiness, extra = []) {
  const profileReasons = Array.isArray(profile.reasons) ? profile.reasons : [];
  const reasons = uniqueReasons(readiness?.reasons, profileReasons, extra);
  return reasons.length ? reasons : [REASON_CODES.UNKNOWN_LOW_CONFIDENCE];
}

function buildDecision({
  profile,
  context,
  contract,
  readiness,
  decision,
  selectedScopeId,
  reasons,
  autoApplyAllowed = false,
}) {
  const result = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    actionId: context.actionId,
    decision,
    confidence: decisionConfidence(profile),
    selectedScopeId,
    contractId: readiness.contractId,
    reasons,
    risk: clone(readiness.risk),
    constraints: {
      maxStrength: cappedStrength(readiness, context),
      scopeRequired: scopeRequired(contract),
      autoApplyAllowed,
      postApplyInspectionRequired: Boolean(readiness.constraints?.postApplyInspectionRequired),
    },
  };

  return assertValidDto(result, validateActionPolicyDecisionV1, 'ActionPolicyDecisionV1');
}

function deny(profile, context, contract, readiness, extraReasons = []) {
  return buildDecision({
    profile,
    context,
    contract,
    readiness,
    decision: ACTION_POLICY_DECISIONS.DENY,
    selectedScopeId: null,
    reasons: safetyReasons(profile, readiness, extraReasons),
  });
}

function safetyShieldBlocks(profile, context, readiness) {
  if (!readiness.passed) return true;
  if (readiness.warnings?.some((check) => check.code === INVARIANT_CODES.TOP_CANDIDATE_NOT_AMBIGUOUS)) return true;
  if (profile.stats?.budgetHit) return true;
  if (profile.pageType === PAGE_TYPES.UNKNOWN) return true;
  if ((profile.risk?.privacyRisk || 0) > 0) return true;
  if (context.source === ACTION_CONTEXT_SOURCES.RESTORE) return true;
  if (context.source === ACTION_CONTEXT_SOURCES.USER_REQUEST && !context.userExplicit) return true;
  if (context.source === ACTION_CONTEXT_SOURCES.AUTO_APPLY && !context.autoApplyCandidate) return true;
  if (context.source === ACTION_CONTEXT_SOURCES.AUTO_APPLY && context.userExplicit) return true;
  return false;
}

function positiveDecisionForSource(context, readiness) {
  if (context.source === ACTION_CONTEXT_SOURCES.SUGGESTION) {
    return ACTION_POLICY_DECISIONS.SUGGEST_ONLY;
  }
  if (context.source === ACTION_CONTEXT_SOURCES.AUTO_APPLY) {
    return ACTION_POLICY_DECISIONS.SUGGEST_ONLY;
  }
  if (context.source === ACTION_CONTEXT_SOURCES.DEBUG) {
    return ACTION_POLICY_DECISIONS.SUGGEST_ONLY;
  }
  if (readiness.constraints?.postApplyInspectionRequired) {
    return ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION;
  }
  return ACTION_POLICY_DECISIONS.ALLOW;
}

export function evaluateActionPolicyDecisionV1(profile, actionContext) {
  const checkedProfile = assertValidDto(profile, validatePageUnderstandingProfileV1, 'PageUnderstandingProfileV1');
  const checkedContext = assertValidDto(actionContext, validateActionContextV1, 'ActionContextV1');
  const contract = getAdaptationContractV1(checkedContext.actionId);
  if (!contract) {
    throw new TypeError(`Unknown adaptation contract: ${checkedContext.actionId}`);
  }

  const readiness = evaluateAdaptationContractV1(checkedProfile, checkedContext.actionId);
  if (safetyShieldBlocks(checkedProfile, checkedContext, readiness)) {
    return deny(checkedProfile, checkedContext, contract, readiness);
  }

  const decision = positiveDecisionForSource(checkedContext, readiness);
  return buildDecision({
    profile: checkedProfile,
    context: checkedContext,
    contract,
    readiness,
    decision,
    selectedScopeId: readiness.selectedScopeId,
    reasons: safetyReasons(checkedProfile, readiness),
  });
}
