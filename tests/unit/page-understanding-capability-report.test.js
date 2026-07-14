import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GAP_TYPES,
  buildCapabilityRows,
  readPageIntelligenceFixtures,
  renderCapabilityReport,
  summarizeCapabilityRows,
} from '../../scripts/page-understanding-capability-report.mjs';

test('page understanding capability report covers every fixture and manual mode', () => {
  const fixtures = readPageIntelligenceFixtures();
  const rows = buildCapabilityRows(fixtures);
  const summary = summarizeCapabilityRows(rows);

  assert.equal(rows.length, fixtures.length * 4);
  assert.equal(summary.fixtures, fixtures.length);
  assert.equal(summary.modes, 2);
  assert.equal(summary.totalRows, rows.length);
});

test('page understanding capability report exposes universal manual dark readiness', () => {
  const rows = buildCapabilityRows();
  const articleDark = rows.find((row) => row.fixture === 'article' && row.actionId === 'DARK_COMFORT_THEME');
  const formDark = rows.find((row) => row.fixture === 'form-simple' && row.actionId === 'DARK_COMFORT_THEME');
  const videoDark = rows.find((row) => row.fixture === 'video-watch' && row.actionId === 'DARK_COMFORT_THEME');

  assert.equal(articleDark.predictedManualPath, 'ACTIVE_MANUAL_LIMITED_DARK');
  assert.equal(articleDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(articleDark.activePlanAllowed, true);
  assert.equal(articleDark.learningEligible, false);
  assert.equal(formDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(formDark.activePlanAllowed, true);
  assert.equal(formDark.predictedManualPath, 'ACTIVE_MANUAL_LIMITED_DARK');
  assert.equal(videoDark.darkReadinessStage, 'MANUAL_LIMITED_ACTIVE');
  assert.equal(videoDark.activePlanAllowed, true);
  assert.equal(videoDark.learningEligible, false);
});

test('page understanding capability report exposes current Comfort fallback gaps', () => {
  const rows = buildCapabilityRows();
  const comfortRows = rows.filter((row) => row.modeId === 'comfort-visual');
  const formComfort = comfortRows.find((row) => row.fixture === 'form');

  assert.ok(formComfort, 'form Comfort row should exist');
  assert.equal(formComfort.safeDowngrade, 'SAFE_FORM_TEXT_LABEL_CLARITY');
  assert.equal(formComfort.fallbackSupported, false);
  assert.equal(formComfort.desiredEffect, 'SAFE_FORM_TEXT_LABEL_CLARITY');
  assert.equal(formComfort.actionTargetKind, 'BASELINE_OR_ABSTAIN');
  assert.equal(formComfort.actionTargetDecisionHint, 'UNSUPPORTED_PAGE_ABSTAIN');
  assert.equal(formComfort.targetKind, 'BASELINE_OR_ABSTAIN');
  assert.equal(formComfort.effectClass, 'NOOP');
  assert.equal(formComfort.capabilityStatus, 'CAPABILITY_MISSING');
  assert.equal(formComfort.supportLevel, 'NOT_IMPLEMENTED');
  assert.equal(formComfort.executor, 'NONE');
  assert.equal(formComfort.activePlanAllowed, false);
  assert.equal(formComfort.gap, GAP_TYPES.CAPABILITY_MISSING);
  assert.equal(
    comfortRows.some((row) => row.gap === GAP_TYPES.CAPABILITY_MISSING),
    true,
    'current Comfort matrix rows should reveal unsupported limited CSS capabilities',
  );
});

test('page understanding capability report recognizes supported Focus limited fallback', () => {
  const rows = buildCapabilityRows();
  const focusSearch = rows.find((row) => row.modeId === 'focus' && row.fixture === 'search-results');

  assert.ok(focusSearch, 'search Focus row should exist');
  assert.equal(focusSearch.safeDowngrade, 'SAFE_RESULT_FOCUS_TARGETS');
  assert.equal(focusSearch.fallbackSupported, true);
  assert.equal(focusSearch.capabilityStatus, 'SUPPORTED');
  assert.equal(focusSearch.supportLevel, 'ACTIVE_RUNTIME');
  assert.equal(focusSearch.executor, 'SAFE_DOWNGRADE_CSS');
  assert.equal(focusSearch.activePlanAllowed, true);
  assert.equal(focusSearch.plannerShadow, true);
  assert.equal(focusSearch.plannerShadowActionId, 'FOCUS_VISIBILITY');
  assert.equal(focusSearch.plannerShadowCapabilityStatus, 'SUPPORTED');
  assert.equal(focusSearch.learningEligible, false);
  assert.equal(focusSearch.learningEffectActionId, 'FOCUS_VISIBILITY');
  assert.equal(focusSearch.learningEffectTargetKind, 'RECORD_REGION');
  assert.equal(focusSearch.learningEffectEffectClass, 'FOCUS_VISIBLE_CLARITY');
  assert.equal(focusSearch.gap, GAP_TYPES.OK);
});

test('page understanding capability report distinguishes deny, abstain and hard block', () => {
  const rows = buildCapabilityRows();
  const dashboardComfort = rows.find((row) => row.modeId === 'comfort-visual' && row.fixture === 'dashboard');
  const unknownFocus = rows.find((row) => row.modeId === 'focus' && row.fixture === 'unknown');
  const modalComfort = rows.find((row) => row.modeId === 'comfort-visual' && row.fixture === 'dashboard-modal');

  assert.equal(dashboardComfort.capabilityStatus, 'INTENTIONAL_DENY');
  assert.equal(dashboardComfort.activePlanAllowed, false);
  assert.equal(unknownFocus.capabilityStatus, 'SAFE_ABSTAIN');
  assert.equal(unknownFocus.executor, 'NOOP');
  assert.equal(modalComfort.capabilityStatus, 'HARD_BLOCKED');
  assert.equal(modalComfort.supportLevel, 'REPORT_ONLY');
});

test('page understanding capability report exposes PAGE_CLARITY SEARCH/FORM as supported V3-light rows', () => {
  const rows = buildCapabilityRows();
  const searchShadow = rows.find((row) => (
    row.fixture === 'search-results'
    && row.modeId === 'comfort-visual'
    && row.actionId === 'PAGE_CLARITY'
  ));
  const dashboardShadow = rows.find((row) => (
    row.fixture === 'dashboard'
    && row.modeId === 'comfort-visual'
    && row.actionId === 'PAGE_CLARITY'
  ));

  assert.ok(searchShadow, 'search PAGE_CLARITY shadow row should exist');
  assert.equal(searchShadow.rowKind, 'SHADOW');
  assert.equal(searchShadow.policyDecision, 'ACTIVE_MANUAL');
  assert.equal(searchShadow.effectClass, 'RECORD_CARD_CLARITY');
  assert.equal(searchShadow.capabilityStatus, 'SUPPORTED');
  assert.equal(searchShadow.supportLevel, 'ACTIVE_RUNTIME');
  assert.equal(searchShadow.executor, 'REGION_CLASS_TOKENS');
  assert.equal(searchShadow.activePlanAllowed, true);
  assert.equal(searchShadow.learningEligible, false);
  assert.equal(searchShadow.learningEffectActionId, 'PAGE_CLARITY');
  assert.equal(searchShadow.learningEffectTargetKind, 'RECORD_REGION');
  assert.equal(searchShadow.learningEffectEffectClass, 'RECORD_CARD_CLARITY');
  assert.equal(searchShadow.plannerShadow, false);
  assert.equal(searchShadow.predictedManualPath, 'ACTIVE_MANUAL_MEDIUM_VERIFIED');
  assert.equal(dashboardShadow.capabilityStatus, 'INTENTIONAL_DENY');
  assert.equal(dashboardShadow.activePlanAllowed, false);
});

test('page understanding capability report renders markdown summary', () => {
  const report = renderCapabilityReport(buildCapabilityRows());

  assert.match(report, /^# Page Understanding Capability Gap Report/);
  assert.match(report, /## Summary/);
  assert.match(report, /## All Rows/);
  assert.match(report, /SAFE_FORM_TEXT_LABEL_CLARITY/);
  assert.match(report, /CAPABILITY_MISSING/);
  assert.match(report, /PAGE_CLARITY/);
  assert.match(report, /SHADOW_ONLY/);
  assert.match(report, /plannerShadow/);
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
  assert.match(report, /INTENTIONAL_DENY/);
  assert.match(report, /SAFE_ABSTAIN/);
  assert.match(report, /PR21 promotion gates allowed/);
  assert.match(report, /promotionRequestedStage/);
  assert.match(report, /promotionAllowed/);
  assert.match(report, /promotionReason/);
  assert.match(report, /PR-D6 dark readiness rows/);
  assert.match(report, /darkReadinessStage/);
  assert.match(report, /darkRollbackRisk/);
});
