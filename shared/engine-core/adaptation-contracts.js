// shared/engine-core/adaptation-contracts.js

import { CONTRACT_IDS, ENGINE_CORE_SCHEMA_VERSION } from './contracts.js';
import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  EVIDENCE_OPERATORS,
  INVARIANT_CODES,
  INVARIANT_PHASES,
  INVARIANT_SEVERITIES,
  OUTCOME_IDS,
  PAGE_TYPES,
  PROBLEM_CODES,
  REASON_CODES,
} from './enums.js';
import {
  assertValidDto,
  validateAdaptationContractV1,
  validatePageUnderstandingProfileV1,
} from './validators.js';

const LAYOUT_RISK_MAX = 0.65;
const CONFIDENCE_RISK_MAX = 0.55;
const MIN_PAGE_CONFIDENCE = 0.55;

function learningEligibility() {
  return {
    requiresPostApplyPass: true,
    requiresNoUndoWindowMs: 90000,
    ignoredIsWeakNegative: true,
    rollbackIsHardNegative: true,
  };
}

function evidence(reason, metricPath, operator, observed, threshold, blockId) {
  const item = { reason, metricPath, operator, observed };
  if (threshold !== undefined) {
    item.threshold = threshold;
  }
  if (blockId) {
    item.blockId = blockId;
  }
  return item;
}

function invariant(code, severity, evidenceItems = []) {
  return {
    code,
    phase: INVARIANT_PHASES.PRE_APPLY,
    severity,
    evidence: evidenceItems,
  };
}

/**
 * @param {string} code
 * @param {string} [severity]
 */
function postInvariant(code, severity = INVARIANT_SEVERITIES.BLOCK) {
  return {
    code,
    phase: INVARIANT_PHASES.POST_APPLY,
    severity,
    evidence: [],
  };
}

function baseContract({
  actionId,
  outcome,
  allowedPageTypes,
  deniedPageTypes,
  requiredScopeRoles = [],
  forbiddenScopeRoles = [],
  toleratedBlockingProblems = [],
  preconditions,
  postconditions,
  modeId,
  maxStrength,
  explanationKey,
  debugReasonCodes,
}) {
  return {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    contractId: CONTRACT_IDS[actionId] || actionId,
    actionId,
    outcome,
    allowedPageTypes,
    deniedPageTypes,
    requiredScopeRoles,
    forbiddenScopeRoles,
    toleratedBlockingProblems,
    preconditions,
    postconditions,
    applyPlan: { kind: 'SCOPED_CSS', modeId, maxStrength },
    rollbackPlan: { kind: 'REMOVE_OWNED_CSS_AND_TOKENS' },
    learningEligibility: learningEligibility(),
    explanation: {
      userFacingSummaryKey: explanationKey,
      debugReasonCodes,
    },
  };
}

export const ADAPTATION_CONTRACTS_V1 = Object.freeze([
  baseContract({
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    outcome: OUTCOME_IDS.READING_COMFORT,
    allowedPageTypes: [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC],
    deniedPageTypes: [PAGE_TYPES.VIDEO, PAGE_TYPES.FEED, PAGE_TYPES.FORM, PAGE_TYPES.DASHBOARD, PAGE_TYPES.UNKNOWN],
    requiredScopeRoles: [BLOCK_ROLES.ARTICLE, BLOCK_ROLES.PRIMARY_CONTENT],
    forbiddenScopeRoles: [BLOCK_ROLES.PLAYER, BLOCK_ROLES.FORM, BLOCK_ROLES.TABLE, BLOCK_ROLES.NAV, BLOCK_ROLES.AD],
    preconditions: [
      invariant(INVARIANT_CODES.PAGE_TYPE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SAFE_SCOPE_REQUIRED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SCOPE_ROLE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.LOW_LAYOUT_RISK, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.TOP_CANDIDATE_NOT_AMBIGUOUS, INVARIANT_SEVERITIES.WARN),
      invariant(INVARIANT_CODES.NO_MODAL_OVERLAY, INVARIANT_SEVERITIES.BLOCK),
    ],
    postconditions: [
      postInvariant(INVARIANT_CODES.NO_HORIZONTAL_SCROLL_REGRESSION),
      postInvariant(INVARIANT_CODES.NO_CLIPPED_TEXT),
      postInvariant(INVARIANT_CODES.SCOPE_STILL_VISIBLE),
    ],
    modeId: 'comfort-visual',
    maxStrength: 0.5,
    explanationKey: 'reading_comfort_typography',
    debugReasonCodes: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH, REASON_CODES.DOC_STRUCTURE_DETECTED],
  }),
  baseContract({
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    outcome: OUTCOME_IDS.FORM_CONFIDENCE,
    allowedPageTypes: [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM],
    deniedPageTypes: [
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.FEED,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.UNKNOWN,
    ],
    requiredScopeRoles: [],
    forbiddenScopeRoles: [BLOCK_ROLES.PLAYER, BLOCK_ROLES.TABLE, BLOCK_ROLES.NAV, BLOCK_ROLES.AD],
    toleratedBlockingProblems: [PROBLEM_CODES.HIGH_LAYOUT_RISK, PROBLEM_CODES.HIGH_INTERACTION_RISK],
    preconditions: [
      invariant(INVARIANT_CODES.PAGE_TYPE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SAFE_SCOPE_REQUIRED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SCOPE_ROLE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_MODAL_OVERLAY, INVARIANT_SEVERITIES.BLOCK),
    ],
    postconditions: [
      postInvariant(INVARIANT_CODES.NO_CONTROL_OCCLUSION),
      postInvariant(INVARIANT_CODES.FOCUS_REMAINS_VISIBLE),
      postInvariant(INVARIANT_CODES.SCOPE_STILL_VISIBLE, INVARIANT_SEVERITIES.WARN),
    ],
    modeId: 'comfort-visual',
    maxStrength: 0.75,
    explanationKey: 'page_clarity',
    debugReasonCodes: [REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED, REASON_CODES.FORM_CONTROLS_PRESENT],
  }),
  baseContract({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    outcome: OUTCOME_IDS.FOCUS_NAVIGATION,
    allowedPageTypes: [
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.FEED,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.FORM,
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.SEARCH,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.WEB_APP,
    ],
    deniedPageTypes: [PAGE_TYPES.UNKNOWN],
    requiredScopeRoles: [],
    forbiddenScopeRoles: [BLOCK_ROLES.AD, BLOCK_ROLES.NAV],
    toleratedBlockingProblems: [PROBLEM_CODES.HIGH_LAYOUT_RISK, PROBLEM_CODES.HIGH_INTERACTION_RISK],
    preconditions: [
      invariant(INVARIANT_CODES.PAGE_TYPE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SAFE_SCOPE_REQUIRED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SCOPE_ROLE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.TOP_CANDIDATE_NOT_AMBIGUOUS, INVARIANT_SEVERITIES.WARN),
      invariant(INVARIANT_CODES.NO_MODAL_OVERLAY, INVARIANT_SEVERITIES.BLOCK),
    ],
    postconditions: [
      postInvariant(INVARIANT_CODES.FOCUS_REMAINS_VISIBLE),
      postInvariant(INVARIANT_CODES.NO_CONTROL_OCCLUSION),
      postInvariant(INVARIANT_CODES.SCOPE_STILL_VISIBLE),
    ],
    modeId: 'focus',
    maxStrength: 0.6,
    explanationKey: 'focus_visibility',
    debugReasonCodes: [
      REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH,
      REASON_CODES.FORM_CONTROLS_PRESENT,
      REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED,
      REASON_CODES.SHOP_PRODUCT_GRID_DETECTED,
    ],
  }),
  baseContract({
    actionId: ADAPTATION_ACTION_IDS.REDUCE_MOTION,
    outcome: OUTCOME_IDS.MOTION_REDUCTION,
    allowedPageTypes: [PAGE_TYPES.FEED, PAGE_TYPES.VIDEO, PAGE_TYPES.DASHBOARD, PAGE_TYPES.WEB_APP],
    deniedPageTypes: [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC, PAGE_TYPES.FORM, PAGE_TYPES.UNKNOWN],
    requiredScopeRoles: [],
    forbiddenScopeRoles: [BLOCK_ROLES.AD],
    toleratedBlockingProblems: [PROBLEM_CODES.HIGH_LAYOUT_RISK, PROBLEM_CODES.HIGH_INTERACTION_RISK],
    preconditions: [
      invariant(INVARIANT_CODES.PAGE_TYPE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SAFE_SCOPE_REQUIRED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SCOPE_ROLE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_MODAL_OVERLAY, INVARIANT_SEVERITIES.BLOCK),
    ],
    postconditions: [
      postInvariant(INVARIANT_CODES.NO_CONTROL_OCCLUSION),
      postInvariant(INVARIANT_CODES.SCOPE_STILL_VISIBLE, INVARIANT_SEVERITIES.WARN),
    ],
    modeId: 'focus',
    maxStrength: 1,
    explanationKey: 'reduce_motion',
    debugReasonCodes: [REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH, REASON_CODES.FEED_CARD_REPETITION_DETECTED],
  }),
  baseContract({
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    outcome: OUTCOME_IDS.TARGET_ACCESSIBILITY,
    allowedPageTypes: [PAGE_TYPES.FORM, PAGE_TYPES.SEARCH],
    deniedPageTypes: [
      PAGE_TYPES.ARTICLE,
      PAGE_TYPES.DOC,
      PAGE_TYPES.FEED,
      PAGE_TYPES.VIDEO,
      PAGE_TYPES.SHOP,
      PAGE_TYPES.WEB_APP,
      PAGE_TYPES.DASHBOARD,
      PAGE_TYPES.UNKNOWN,
    ],
    requiredScopeRoles: [],
    forbiddenScopeRoles: [BLOCK_ROLES.AD, BLOCK_ROLES.NAV, BLOCK_ROLES.TABLE],
    preconditions: [
      invariant(INVARIANT_CODES.PAGE_TYPE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SAFE_SCOPE_REQUIRED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.SCOPE_ROLE_ALLOWED, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS, INVARIANT_SEVERITIES.BLOCK),
      invariant(INVARIANT_CODES.LOW_LAYOUT_RISK, INVARIANT_SEVERITIES.WARN),
      invariant(INVARIANT_CODES.NO_MODAL_OVERLAY, INVARIANT_SEVERITIES.BLOCK),
    ],
    postconditions: [
      postInvariant(INVARIANT_CODES.NO_HORIZONTAL_SCROLL_REGRESSION),
      postInvariant(INVARIANT_CODES.NO_CONTROL_OCCLUSION),
      postInvariant(INVARIANT_CODES.SCOPE_STILL_VISIBLE),
    ],
    modeId: 'focus',
    maxStrength: 0.45,
    explanationKey: 'target_size',
    debugReasonCodes: [
      REASON_CODES.FORM_CONTROLS_PRESENT,
      REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH,
      REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED,
      REASON_CODES.SHOP_PRODUCT_GRID_DETECTED,
    ],
  }),
].map((contract) => Object.freeze(contract)));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getAdaptationContractsV1() {
  return ADAPTATION_CONTRACTS_V1.map((contract) => clone(contract));
}

export function getAdaptationContractV1(actionId) {
  const contract = ADAPTATION_CONTRACTS_V1.find((entry) => entry.actionId === actionId);
  return contract ? clone(contract) : null;
}

function hasProblem(profile, code) {
  return Array.isArray(profile?.problems) && profile.problems.some((problem) => problem?.code === code);
}

function profileReasons(profile, fallbackReason) {
  const reasons = Array.isArray(profile?.reasons) ? profile.reasons.slice(0, 4) : [];
  return reasons.length ? reasons : [fallbackReason];
}

function makeCheck(template, passed, evidenceItems) {
  return {
    code: template.code,
    phase: template.phase,
    severity: template.severity,
    passed,
    evidence: evidenceItems,
  };
}

function findTemplate(contract, code) {
  return contract.preconditions.find((entry) => entry.code === code);
}

function pageTypeReason(profile) {
  if (profile.pageType === PAGE_TYPES.ARTICLE) return REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH;
  if (profile.pageType === PAGE_TYPES.DOC) return REASON_CODES.DOC_STRUCTURE_DETECTED;
  if (profile.pageType === PAGE_TYPES.VIDEO) return REASON_CODES.VIDEO_PAGE_TYPOGRAPHY_BLOCKED;
  if (profile.pageType === PAGE_TYPES.FORM) return REASON_CODES.FORM_CONTROLS_PRESENT;
  if (profile.pageType === PAGE_TYPES.DASHBOARD) return REASON_CODES.DASHBOARD_TABLE_DENSITY_HIGH;
  if (profile.pageType === PAGE_TYPES.FEED) return REASON_CODES.FEED_CARD_REPETITION_DETECTED;
  if (profile.pageType === PAGE_TYPES.SEARCH) return REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED;
  if (profile.pageType === PAGE_TYPES.SHOP) return REASON_CODES.SHOP_PRODUCT_GRID_DETECTED;
  if (profile.pageType === PAGE_TYPES.UNKNOWN) return REASON_CODES.UNKNOWN_LOW_CONFIDENCE;
  return profileReasons(profile, REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH)[0];
}

function checkPageType(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.PAGE_TYPE_ALLOWED);
  if (!template) return null;
  const denied = contract.deniedPageTypes.includes(profile.pageType);
  const allowed = contract.allowedPageTypes.includes(profile.pageType);
  return makeCheck(template, allowed && !denied, [
    evidence(pageTypeReason(profile), 'pageType', denied ? EVIDENCE_OPERATORS.NEQ : EVIDENCE_OPERATORS.EXISTS, profile.pageType, contract.allowedPageTypes.join('|')),
  ]);
}

function checkSafeScope(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.SAFE_SCOPE_REQUIRED);
  if (!template) return null;
  const selected = profile.selectedScope || null;
  const required = contract.requiredScopeRoles || [];
  const actionTargetBacked = contract.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY;
  const scopeRequired = (contract.applyPlan?.kind === 'SCOPED_CSS' || required.length > 0) && !actionTargetBacked;
  const passed = actionTargetBacked || !scopeRequired || Boolean(selected);
  return makeCheck(template, passed, [
    evidence(
      profileReasons(profile, pageTypeReason(profile))[0],
      actionTargetBacked ? 'actionTargets.regionId' : 'selectedScope.blockId',
      EVIDENCE_OPERATORS.EXISTS,
      actionTargetBacked || Boolean(selected),
      true,
      selected?.blockId,
    ),
  ]);
}

function checkScopeRole(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.SCOPE_ROLE_ALLOWED);
  if (!template) return null;
  const selected = profile.selectedScope || null;
  const role = selected?.roleHint || BLOCK_ROLES.UNKNOWN;
  const required = contract.requiredScopeRoles || [];
  const forbidden = contract.forbiddenScopeRoles || [];
  const requiredPassed = required.length === 0 || required.includes(role);
  const forbiddenPassed = !forbidden.includes(role);
  return makeCheck(template, requiredPassed && forbiddenPassed, [
    evidence(profileReasons(profile, pageTypeReason(profile))[0], 'selectedScope.roleHint', EVIDENCE_OPERATORS.EXISTS, role, required.join('|') || `not:${forbidden.join('|')}`, selected?.blockId),
  ]);
}

function checkLayoutRisk(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.LOW_LAYOUT_RISK);
  if (!template) return null;
  const value = profile.risk?.layoutRisk;
  return makeCheck(template, value < LAYOUT_RISK_MAX, [
    evidence(profileReasons(profile, pageTypeReason(profile))[0], 'risk.layoutRisk', EVIDENCE_OPERATORS.LT, value, LAYOUT_RISK_MAX, profile.selectedScope?.blockId),
  ]);
}

function checkBlockingProfileProblems(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS);
  if (!template) return null;
  const tolerated = new Set(contract.toleratedBlockingProblems || []);
  const blockingProblems = (profile.problems || []).filter((problem) => problem?.severity === INVARIANT_SEVERITIES.BLOCK);
  const unhandled = blockingProblems.filter((problem) => !tolerated.has(problem.code));
  const evidenceItems = (blockingProblems.length ? blockingProblems : [{ code: 'none' }])
    .slice(0, 6)
    .map((problem) => evidence(
      profileReasons(profile, pageTypeReason(profile))[0],
      `problems.${problem.code}`,
      EVIDENCE_OPERATORS.NEQ,
      blockingProblems.some((entry) => entry.code === problem.code),
      tolerated.has(problem.code) ? 'tolerated' : false,
      profile.selectedScope?.blockId,
    ));
  return makeCheck(template, unhandled.length === 0, evidenceItems);
}

function checkAmbiguity(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.TOP_CANDIDATE_NOT_AMBIGUOUS);
  if (!template) return null;
  const confidenceRisk = profile.risk?.confidenceRisk;
  const passed = confidenceRisk < CONFIDENCE_RISK_MAX && profile.pageTypeConfidence >= MIN_PAGE_CONFIDENCE;
  return makeCheck(template, passed, [
    evidence(REASON_CODES.TOP_CANDIDATES_AMBIGUOUS, 'risk.confidenceRisk', EVIDENCE_OPERATORS.LT, confidenceRisk, CONFIDENCE_RISK_MAX, profile.selectedScope?.blockId),
  ]);
}

function checkModal(profile, contract) {
  const template = findTemplate(contract, INVARIANT_CODES.NO_MODAL_OVERLAY);
  if (!template) return null;
  const modalPresent = hasProblem(profile, PROBLEM_CODES.MODAL_OVERLAY_PRESENT);
  return makeCheck(template, !modalPresent, [
    evidence(REASON_CODES.UNKNOWN_LOW_CONFIDENCE, 'problems.MODAL_OVERLAY_PRESENT', EVIDENCE_OPERATORS.NEQ, modalPresent, true),
  ]);
}

function evaluatePreconditions(profile, contract) {
  return [
    checkPageType(profile, contract),
    checkSafeScope(profile, contract),
    checkScopeRole(profile, contract),
    checkBlockingProfileProblems(profile, contract),
    checkLayoutRisk(profile, contract),
    checkAmbiguity(profile, contract),
    checkModal(profile, contract),
  ].filter(Boolean);
}

function collectContractReasons(profile, checks) {
  const reasons = new Set(profileReasons(profile, pageTypeReason(profile)));
  for (const check of checks) {
    if (!check.passed) {
      for (const item of check.evidence || []) {
        reasons.add(item.reason);
      }
    }
  }
  return Array.from(reasons).slice(0, 20);
}

export function evaluateAdaptationContractV1(profile, actionIdOrContract) {
  const checkedProfile = assertValidDto(profile, validatePageUnderstandingProfileV1, 'PageUnderstandingProfileV1');
  const contract = typeof actionIdOrContract === 'string'
    ? getAdaptationContractV1(actionIdOrContract)
    : clone(actionIdOrContract);
  if (!contract) {
    throw new TypeError(`Unknown adaptation contract: ${actionIdOrContract}`);
  }
  const checkedContract = assertValidDto(contract, validateAdaptationContractV1, 'AdaptationContractV1');
  const checks = evaluatePreconditions(checkedProfile, checkedContract);
  const blockingFailures = checks.filter((check) => !check.passed && check.severity === INVARIANT_SEVERITIES.BLOCK);
  const warnings = checks.filter((check) => !check.passed && check.severity !== INVARIANT_SEVERITIES.BLOCK);

  return {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    actionId: checkedContract.actionId,
    contractId: CONTRACT_IDS[checkedContract.actionId] || checkedContract.actionId,
    passed: blockingFailures.length === 0,
    selectedScopeId: blockingFailures.length === 0 ? checkedProfile.selectedScope?.blockId || null : null,
    checks,
    blockingFailures,
    warnings,
    reasons: collectContractReasons(checkedProfile, checks),
    risk: clone(checkedProfile.risk),
    constraints: {
      maxStrength: checkedContract.applyPlan.maxStrength,
      postApplyInspectionRequired: checkedContract.learningEligibility.requiresPostApplyPass,
      noUndoWindowMs: checkedContract.learningEligibility.requiresNoUndoWindowMs,
    },
  };
}
