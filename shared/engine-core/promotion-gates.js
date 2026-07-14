// shared/engine-core/promotion-gates.js

import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
} from './enums.js';
import { validatePrivacySafeJson } from './validators.js';

export const PROMOTION_GATES_VERSION = 1;

export const PROMOTION_GATE_REASONS = Object.freeze({
  ALLOWED: 'PROMOTION_ALLOWED',
  UNSUPPORTED_STAGE_TRANSITION: 'UNSUPPORTED_STAGE_TRANSITION',
  REQUIREMENTS_NOT_MET: 'PROMOTION_REQUIREMENTS_NOT_MET',
  AUTO_BLOCKED_FOR_PAGE_CLARITY: 'AUTO_BLOCKED_FOR_PAGE_CLARITY',
  AUTO_BLOCKED_FOR_HIGH_RISK_PAGE: 'AUTO_BLOCKED_FOR_HIGH_RISK_PAGE',
});

const HIGH_RISK_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.DASHBOARD,
  PAGE_TYPES.VIDEO,
  PAGE_TYPES.WEB_APP,
  PAGE_TYPES.UNKNOWN,
]);

const STAGE_RANK = Object.freeze({
  [ACTIVATION_STAGES.REPORT_ONLY]: 0,
  [ACTIVATION_STAGES.SHADOW_ONLY]: 1,
  [ACTIVATION_STAGES.MANUAL_LIMITED]: 2,
  [ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED]: 3,
  [ACTIVATION_STAGES.VERIFIED]: 4,
  [ACTIVATION_STAGES.ASSISTED]: 5,
  [ACTIVATION_STAGES.AUTO]: 6,
});

function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function metric(metrics, key, fallback = 0) {
  return finiteNumber(metrics && typeof metrics === 'object' ? metrics[key] : undefined, fallback);
}

function metricBoolean(metrics, key) {
  return metrics && typeof metrics === 'object' && metrics[key] === true;
}

function booleanMetric(value) {
  return value === true ? 1 : 0;
}

function requirement(id, observed, threshold, passed) {
  return Object.freeze({
    id,
    observed,
    threshold,
    passed: passed === true,
  });
}

function normalizeStage(stage, fallback) {
  return Object.prototype.hasOwnProperty.call(STAGE_RANK, stage) ? stage : fallback;
}

function isHighRiskPageType(pageType) {
  return HIGH_RISK_PAGE_TYPES.includes(pageType);
}

function buildRequirements({ requestedStage, metrics = {}, capabilitySupported }) {
  if (requestedStage === ACTIVATION_STAGES.MANUAL_LIMITED) {
    return [
      requirement('fixtureCount', metric(metrics, 'fixtureCount'), 3, metric(metrics, 'fixtureCount') >= 3),
      requirement('actionTargetHitRate', metric(metrics, 'actionTargetHitRate'), 0.8, metric(metrics, 'actionTargetHitRate') >= 0.8),
      requirement('postCheckPassRate', metric(metrics, 'postCheckPassRate'), 0.95, metric(metrics, 'postCheckPassRate') >= 0.95),
      requirement('capabilitySupported', booleanMetric(capabilitySupported), 1, capabilitySupported === true),
    ];
  }

  if ([ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED, ACTIVATION_STAGES.VERIFIED].includes(requestedStage)) {
    return [
      requirement('rollbackSuccessRate', metric(metrics, 'rollbackSuccessRate'), 0.99, metric(metrics, 'rollbackSuccessRate') >= 0.99),
      requirement('postApplyRegressionRate', metric(metrics, 'postApplyRegressionRate'), 0.02, metric(metrics, 'postApplyRegressionRate') <= 0.02),
      requirement('postCheckPassRate', metric(metrics, 'postCheckPassRate'), 0.98, metric(metrics, 'postCheckPassRate') >= 0.98),
    ];
  }

  if (requestedStage === ACTIVATION_STAGES.ASSISTED) {
    return [
      requirement('inspectedOutcomeCount', metric(metrics, 'inspectedOutcomeCount'), 20, metric(metrics, 'inspectedOutcomeCount') >= 20),
      requirement('positiveOutcomeRate', metric(metrics, 'positiveOutcomeRate'), 0.9, metric(metrics, 'positiveOutcomeRate') >= 0.9),
      requirement('postApplyRegressionRate', metric(metrics, 'postApplyRegressionRate'), 0.02, metric(metrics, 'postApplyRegressionRate') <= 0.02),
    ];
  }

  if (requestedStage === ACTIVATION_STAGES.AUTO) {
    return [
      requirement('explicitAutoApproval', booleanMetric(metricBoolean(metrics, 'explicitAutoApproval')), 1, metricBoolean(metrics, 'explicitAutoApproval')),
      requirement('inspectedOutcomeCount', metric(metrics, 'inspectedOutcomeCount'), 100, metric(metrics, 'inspectedOutcomeCount') >= 100),
      requirement('postApplyRegressionRate', metric(metrics, 'postApplyRegressionRate'), 0.01, metric(metrics, 'postApplyRegressionRate') <= 0.01),
      requirement('rollbackSuccessRate', metric(metrics, 'rollbackSuccessRate'), 1, metric(metrics, 'rollbackSuccessRate') >= 1),
    ];
  }

  return [];
}

function defaultRequestedStage(currentStage) {
  switch (currentStage) {
    case ACTIVATION_STAGES.REPORT_ONLY:
    case ACTIVATION_STAGES.SHADOW_ONLY:
      return ACTIVATION_STAGES.MANUAL_LIMITED;
    case ACTIVATION_STAGES.MANUAL_LIMITED:
      return ACTIVATION_STAGES.VERIFIED;
    case ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED:
      return ACTIVATION_STAGES.VERIFIED;
    case ACTIVATION_STAGES.VERIFIED:
      return ACTIVATION_STAGES.ASSISTED;
    case ACTIVATION_STAGES.ASSISTED:
      return ACTIVATION_STAGES.AUTO;
    default:
      return currentStage;
  }
}

function isSupportedStageTransition(currentStage, requestedStage) {
  return requestedStage === defaultRequestedStage(currentStage)
    && STAGE_RANK[requestedStage] > STAGE_RANK[currentStage];
}

function assertPrivacySafe(value) {
  const validation = validatePrivacySafeJson(value);
  if (!validation.ok) {
    const detail = validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new TypeError(`PromotionGateDecisionV1 validation failed: ${detail}`);
  }
  return value;
}

export function evaluatePromotionGateV1(input = {}) {
  const currentStage = normalizeStage(input.currentStage, ACTIVATION_STAGES.REPORT_ONLY);
  const requestedStage = normalizeStage(input.requestedStage, defaultRequestedStage(currentStage));
  const actionId = typeof input.actionId === 'string' ? input.actionId : '';
  const pageType = typeof input.pageType === 'string' ? input.pageType : PAGE_TYPES.UNKNOWN;
  const capabilitySupported = input.capabilitySupported === true;
  const requirements = buildRequirements({
    requestedStage,
    metrics: input.metrics || {},
    capabilitySupported,
  });
  const requirementsPassed = requirements.length > 0 && requirements.every((item) => item.passed === true);
  const transitionSupported = isSupportedStageTransition(currentStage, requestedStage);

  let reason = String(PROMOTION_GATE_REASONS.ALLOWED);
  let allowed = true;

  if (!transitionSupported || requirements.length === 0) {
    allowed = false;
    reason = PROMOTION_GATE_REASONS.UNSUPPORTED_STAGE_TRANSITION;
  } else if (requestedStage === ACTIVATION_STAGES.AUTO && actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    allowed = false;
    reason = PROMOTION_GATE_REASONS.AUTO_BLOCKED_FOR_PAGE_CLARITY;
  } else if (requestedStage === ACTIVATION_STAGES.AUTO && isHighRiskPageType(pageType)) {
    allowed = false;
    reason = PROMOTION_GATE_REASONS.AUTO_BLOCKED_FOR_HIGH_RISK_PAGE;
  } else if (!requirementsPassed) {
    allowed = false;
    reason = PROMOTION_GATE_REASONS.REQUIREMENTS_NOT_MET;
  }

  return assertPrivacySafe({
    version: PROMOTION_GATES_VERSION,
    actionId,
    pageType,
    currentStage,
    requestedStage,
    allowed,
    reason,
    highRiskPage: isHighRiskPageType(pageType),
    requirements,
  });
}
