import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  QUALITY_RESULTS,
  REGION_TYPES,
  buildQualityRows,
  readPageIntelligenceFixtures,
  renderQualityReport,
  summarizeQualityRows,
} from '../../scripts/page-understanding-quality-report.mjs';

test('page understanding quality report covers every fixture and manual mode', () => {
  const fixtures = readPageIntelligenceFixtures();
  const rows = buildQualityRows(fixtures);
  const summary = summarizeQualityRows(rows);

  assert.equal(rows.length, fixtures.length * 4);
  assert.equal(summary.fixtures, fixtures.length);
  assert.equal(summary.modes, 2);
  assert.equal(summary.totalRows, rows.length);
});

test('page understanding quality report exposes universal manual dark readiness', () => {
  const rows = buildQualityRows();
  const articleDark = rows.find((row) => row.fixture === 'article' && row.actionId === 'DARK_COMFORT_THEME');
  const searchDark = rows.find((row) => row.fixture === 'search-results' && row.actionId === 'DARK_COMFORT_THEME');
  const dashboardDark = rows.find((row) => row.fixture === 'dashboard' && row.actionId === 'DARK_COMFORT_THEME');

  assert.equal(articleDark.rowKind, 'DARK');
  assert.equal(articleDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(articleDark.activePlanAllowed, true);
  assert.equal(articleDark.learningEligible, false);
  assert.equal(searchDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(searchDark.activePlanAllowed, true);
  assert.equal(searchDark.learningEligible, false);
  assert.equal(dashboardDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(dashboardDark.activePlanAllowed, true);
  assert.equal(dashboardDark.learningEligible, false);
});

test('page understanding quality report keeps article Comfort target while exposing missing fallback capability', () => {
  const rows = buildQualityRows();
  const articleComfort = rows.find((row) => row.fixture === 'article' && row.modeId === 'comfort-visual');

  assert.ok(articleComfort, 'article Comfort row should exist');
  assert.equal(articleComfort.expectedPrimaryRegion, REGION_TYPES.READING_REGION);
  assert.equal(articleComfort.expectedRegionFound, true);
  assert.equal(articleComfort.v3LiteTarget, REGION_TYPES.READING_REGION);
  assert.equal(articleComfort.v3LiteTargetFound, true);
  assert.equal(articleComfort.currentStrongPath, true);
  assert.equal(articleComfort.capabilityStatus, 'CAPABILITY_MISSING');
  assert.equal(articleComfort.supportLevel, 'NOT_IMPLEMENTED');
  assert.equal(articleComfort.activePlanAllowed, false);
  assert.equal(articleComfort.learningEligible, false);
  assert.equal(articleComfort.learningEffectActionId, 'READING_COMFORT_TYPOGRAPHY');
  assert.equal(articleComfort.learningEffectTargetKind, 'READING_REGION');
  assert.equal(articleComfort.learningEffectEffectClass, 'SCOPED_READING_TYPOGRAPHY');
  assert.equal(articleComfort.qualityResult, QUALITY_RESULTS.CAPABILITY_MISSING);
});

test('page understanding quality report exposes non-executable form Comfort capability', () => {
  const rows = buildQualityRows();
  const formComfort = rows.find((row) => row.fixture === 'form' && row.modeId === 'comfort-visual');

  assert.ok(formComfort, 'form Comfort row should exist');
  assert.equal(formComfort.expectedPrimaryRegion, REGION_TYPES.FORM_REGION);
  assert.equal(formComfort.expectedRegionFound, true);
  assert.equal(formComfort.v3LiteTarget, REGION_TYPES.BASELINE_OR_ABSTAIN);
  assert.equal(formComfort.v3LiteTargetFound, false);
  assert.equal(formComfort.actionTargetDecisionHint, 'UNSUPPORTED_PAGE_ABSTAIN');
  assert.equal(formComfort.currentStrongPath, false);
  assert.equal(formComfort.currentFallbackReason, 'CURRENT_POLICY_DENY');
  assert.equal(formComfort.capabilityStatus, 'CAPABILITY_MISSING');
  assert.equal(formComfort.supportLevel, 'NOT_IMPLEMENTED');
  assert.equal(formComfort.executor, 'NONE');
  assert.equal(formComfort.activePlanAllowed, false);
  assert.equal(formComfort.v3LiteWouldAvoidFallback, false);
  assert.equal(formComfort.qualityResult, QUALITY_RESULTS.CAPABILITY_MISSING);
});

test('page understanding quality report treats unknown pages as safe abstain', () => {
  const rows = buildQualityRows();
  const unknownFocus = rows.find((row) => row.fixture === 'unknown' && row.modeId === 'focus');

  assert.ok(unknownFocus, 'unknown Focus row should exist');
  assert.equal(unknownFocus.expectedPrimaryRegion, REGION_TYPES.BASELINE_OR_ABSTAIN);
  assert.equal(unknownFocus.v3LiteTargetFound, false);
  assert.equal(unknownFocus.currentStrongPath, false);
  assert.equal(unknownFocus.capabilityStatus, 'SAFE_ABSTAIN');
  assert.equal(unknownFocus.activePlanAllowed, false);
  assert.equal(unknownFocus.qualityResult, QUALITY_RESULTS.SAFE_ABSTAIN_UNKNOWN);
});

test('page understanding quality report does not count dashboard and video Comfort as opportunities', () => {
  const rows = buildQualityRows();
  const dashboardComfort = rows.find((row) => row.fixture === 'dashboard' && row.modeId === 'comfort-visual');
  const videoComfort = rows.find((row) => row.fixture === 'video-watch' && row.modeId === 'comfort-visual');
  const modalComfort = rows.find((row) => row.fixture === 'dashboard-modal' && row.modeId === 'comfort-visual');

  assert.equal(dashboardComfort.capabilityStatus, 'INTENTIONAL_DENY');
  assert.equal(dashboardComfort.v3LiteWouldAvoidFallback, false);
  assert.equal(dashboardComfort.qualityResult, QUALITY_RESULTS.INTENTIONAL_DENY);
  assert.equal(videoComfort.capabilityStatus, 'INTENTIONAL_DENY');
  assert.equal(videoComfort.v3LiteWouldAvoidFallback, false);
  assert.equal(videoComfort.qualityResult, QUALITY_RESULTS.INTENTIONAL_DENY);
  assert.equal(modalComfort.capabilityStatus, 'HARD_BLOCKED');
  assert.equal(modalComfort.qualityResult, QUALITY_RESULTS.HARD_BLOCKED);
});

test('page understanding quality report separates PAGE_CLARITY UI shadow from supported V3-light runtime', () => {
  const rows = buildQualityRows();
  const articleReading = rows.find((row) => (
    row.fixture === 'article'
    && row.modeId === 'comfort-visual'
    && row.actionId === 'READING_COMFORT_TYPOGRAPHY'
  ));
  const articleShadow = rows.find((row) => (
    row.fixture === 'article'
    && row.modeId === 'comfort-visual'
    && row.actionId === 'PAGE_CLARITY'
  ));
  const formShadow = rows.find((row) => (
    row.fixture === 'form-simple'
    && row.modeId === 'comfort-visual'
    && row.actionId === 'PAGE_CLARITY'
  ));

  assert.equal(articleReading.rowKind, 'PRIMARY');
  assert.equal(articleShadow.rowKind, 'SHADOW');
  assert.equal(articleShadow.currentPolicyDecision, 'SHADOW_ONLY');
  assert.equal(articleShadow.effectClass, 'REGION_LIGHT_CLARITY');
  assert.equal(articleShadow.supportLevel, 'SHADOW_ONLY');
  assert.equal(articleShadow.activePlanAllowed, false);
  assert.equal(articleShadow.learningEligible, false);
  assert.equal(articleShadow.learningEffectActionId, 'PAGE_CLARITY');
  assert.equal(articleShadow.currentFallbackDependent, false);
  assert.equal(formShadow.effectClass, 'FORM_LABEL_CLARITY');
  assert.equal(formShadow.v3LiteTarget, REGION_TYPES.FORM_REGION);
  assert.equal(formShadow.currentPolicyDecision, 'ACTIVE_MANUAL');
  assert.equal(formShadow.actionTargetDecisionHint, 'ACTIVE_MANUAL');
  assert.equal(formShadow.capabilityStatus, 'SUPPORTED');
  assert.equal(formShadow.supportLevel, 'ACTIVE_RUNTIME');
  assert.equal(formShadow.executor, 'REGION_CLASS_TOKENS');
  assert.equal(formShadow.activePlanAllowed, true);
  assert.equal(formShadow.learningEligible, false);
  assert.equal(formShadow.qualityResult, QUALITY_RESULTS.V3_LIGHT_OPPORTUNITY);
});

test('page understanding quality report renders markdown summary', () => {
  const report = renderQualityReport(buildQualityRows());

  assert.match(report, /^# Page Understanding Quality Report/);
  assert.match(report, /Current fallback dependency rate/);
  assert.match(report, /V3-lite opportunity rate/);
  assert.match(report, /FORM_REGION/);
  assert.match(report, /CAPABILITY_MISSING/);
  assert.match(report, /PAGE_CLARITY/);
  assert.match(report, /SHADOW_ONLY/);
  assert.match(report, /learningEffectActionId/);
  assert.match(report, /learningEligible/);
  assert.match(report, /activePlanAllowed/);
  assert.match(report, /observedSignalsVersion/);
  assert.match(report, /v2Coverage/);
  assert.match(report, /actionTargetInputIndicator/);
  assert.match(report, /graphNodes/);
  assert.match(report, /graphGroups/);
  assert.match(report, /repeatedRecordGroups/);
  assert.match(report, /PR9 action target hit rate/);
  assert.match(report, /PR9 confident wrong rate/);
  assert.match(report, /PR9 eligible fallback dependency rate/);
  assert.match(report, /PR10 registry entries/);
  assert.match(report, /modeRegistryFound/);
  assert.match(report, /actionActivationStage/);
  assert.match(report, /registryPagePolicy/);
  assert.match(report, /PR21 promotion gates allowed/);
  assert.match(report, /promotionRequestedStage/);
  assert.match(report, /promotionAllowed/);
  assert.match(report, /promotionReason/);
  assert.match(report, /PR-D6 dark readiness rows/);
  assert.match(report, /darkReadinessStage/);
  assert.match(report, /darkRollbackRisk/);
});
