import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
  evaluatePromotionGateV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

test('PromotionGateV1 allows shadow to manual only with fixtures, target hit and post-check evidence', () => {
  const blocked = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SHOP,
    currentStage: ACTIVATION_STAGES.SHADOW_ONLY,
    requestedStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    capabilitySupported: true,
    metrics: {
      fixtureCount: 2,
      actionTargetHitRate: 0.9,
      postCheckPassRate: 0.99,
    },
  });
  const allowed = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    pageType: PAGE_TYPES.FORM,
    currentStage: ACTIVATION_STAGES.SHADOW_ONLY,
    requestedStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    capabilitySupported: true,
    metrics: {
      fixtureCount: 4,
      actionTargetHitRate: 0.9,
      postCheckPassRate: 0.96,
    },
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'PROMOTION_REQUIREMENTS_NOT_MET');
  assert.equal(blocked.requirements.find((item) => item.id === 'fixtureCount').passed, false);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'PROMOTION_ALLOWED');
});

test('PromotionGateV1 requires rollback success and low regression for verified stages', () => {
  const decision = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.SEARCH,
    currentStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requestedStage: ACTIVATION_STAGES.VERIFIED,
    capabilitySupported: true,
    metrics: {
      rollbackSuccessRate: 0.995,
      postApplyRegressionRate: 0.01,
      postCheckPassRate: 0.99,
    },
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requestedStage, ACTIVATION_STAGES.VERIFIED);
});

test('PromotionGateV1 requires inspected outcomes for assisted promotion', () => {
  const blocked = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.ARTICLE,
    currentStage: ACTIVATION_STAGES.VERIFIED,
    requestedStage: ACTIVATION_STAGES.ASSISTED,
    capabilitySupported: true,
    metrics: {
      inspectedOutcomeCount: 4,
      positiveOutcomeRate: 1,
      postApplyRegressionRate: 0,
    },
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requirements.find((item) => item.id === 'inspectedOutcomeCount').passed, false);
});

test('PromotionGateV1 rejects non-adjacent stage jumps even when metrics pass', () => {
  const shadowToVerified = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.ARTICLE,
    currentStage: ACTIVATION_STAGES.SHADOW_ONLY,
    requestedStage: ACTIVATION_STAGES.VERIFIED,
    capabilitySupported: true,
    metrics: {
      rollbackSuccessRate: 1,
      postApplyRegressionRate: 0,
      postCheckPassRate: 1,
    },
  });
  const manualToAssisted = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.ARTICLE,
    currentStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requestedStage: ACTIVATION_STAGES.ASSISTED,
    capabilitySupported: true,
    metrics: {
      inspectedOutcomeCount: 40,
      positiveOutcomeRate: 1,
      postApplyRegressionRate: 0,
    },
  });
  const reportToAuto = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.ARTICLE,
    currentStage: ACTIVATION_STAGES.REPORT_ONLY,
    requestedStage: ACTIVATION_STAGES.AUTO,
    capabilitySupported: true,
    metrics: {
      explicitAutoApproval: true,
      inspectedOutcomeCount: 200,
      postApplyRegressionRate: 0,
      rollbackSuccessRate: 1,
    },
  });

  assert.equal(shadowToVerified.allowed, false);
  assert.equal(shadowToVerified.reason, 'UNSUPPORTED_STAGE_TRANSITION');
  assert.equal(manualToAssisted.allowed, false);
  assert.equal(manualToAssisted.reason, 'UNSUPPORTED_STAGE_TRANSITION');
  assert.equal(reportToAuto.allowed, false);
  assert.equal(reportToAuto.reason, 'UNSUPPORTED_STAGE_TRANSITION');
});

test('PromotionGateV1 blocks AUTO for PAGE_CLARITY and high-risk page types', () => {
  const pageClarity = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
    currentStage: ACTIVATION_STAGES.ASSISTED,
    requestedStage: ACTIVATION_STAGES.AUTO,
    metrics: {
      explicitAutoApproval: true,
      inspectedOutcomeCount: 200,
      postApplyRegressionRate: 0,
      rollbackSuccessRate: 1,
    },
  });
  const highRisk = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.VIDEO,
    currentStage: ACTIVATION_STAGES.ASSISTED,
    requestedStage: ACTIVATION_STAGES.AUTO,
    metrics: {
      explicitAutoApproval: true,
      inspectedOutcomeCount: 200,
      postApplyRegressionRate: 0,
      rollbackSuccessRate: 1,
    },
  });

  assert.equal(pageClarity.allowed, false);
  assert.equal(pageClarity.reason, 'AUTO_BLOCKED_FOR_PAGE_CLARITY');
  assert.equal(highRisk.allowed, false);
  assert.equal(highRisk.reason, 'AUTO_BLOCKED_FOR_HIGH_RISK_PAGE');
});

test('PromotionGateV1 output is compact and privacy-safe', () => {
  const decision = evaluatePromotionGateV1({
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    pageType: PAGE_TYPES.DOC,
    currentStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    requestedStage: ACTIVATION_STAGES.VERIFIED,
    capabilitySupported: true,
    metrics: {
      rollbackSuccessRate: 1,
      postApplyRegressionRate: 0,
      postCheckPassRate: 1,
    },
  });

  assert.equal(validatePrivacySafeJson(decision).ok, true);
  assert.equal(JSON.stringify(decision).includes('selector'), false);
  assert.equal(JSON.stringify(decision).includes('http'), false);
});
