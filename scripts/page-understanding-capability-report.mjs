#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  RUNTIME_EXECUTORS,
  desiredEffectForActionTargetV1,
  buildLearningEffectKeyV1,
  buildActionTargetsV1,
  buildRepeatedRecordGroupsV1,
  buildRegionInventoryV1,
  buildRuntimeEffectPlanV1,
  buildVisualRegionGraphLiteV1,
  evaluatePromotionGateV1,
  evaluateActionPolicyDecisionV1,
  evaluateRuntimeCapabilityV1,
  findActionRegistryEntryV1,
  findActionTargetV1,
  findModeRegistryEntryV1,
  getActionRegistryV1,
  getFeatureRegistryV1,
  getModeRegistryV1,
  listFeatureRegistryEntriesForActionV1,
  PROBLEM_CODES,
  routePageSignalsV1,
  validateActionRegistryV1,
  validateFeatureRegistryV1,
  validateModeRegistryV1,
} from '../shared/engine-core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_FIXTURE_DIR = path.join(repoRoot, 'tests', 'fixtures', 'page-intelligence');

export const MODE_ACTIONS = Object.freeze([
  {
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    rowKind: 'PRIMARY',
    label: 'Comfort Reading',
  },
  {
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    rowKind: 'PRIMARY',
    label: 'Focus Visibility',
  },
  {
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    rowKind: 'SHADOW',
    label: 'Page Clarity Shadow',
  },
  {
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    rowKind: 'DARK',
    label: 'Dark Comfort Theme Readiness',
  },
]);

export const GAP_TYPES = Object.freeze({
  OK: 'OK',
  UNDERSTANDING_FAIL: 'UNDERSTANDING_FAIL',
  POLICY_UNEXPECTED: 'POLICY_UNEXPECTED',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  INTENTIONAL_DENY: 'INTENTIONAL_DENY',
  SAFE_ABSTAIN: 'SAFE_ABSTAIN',
  HARD_BLOCKED: 'HARD_BLOCKED',
  PLANNER_FAIL: 'PLANNER_FAIL',
});

function actionContext(actionId) {
  return {
    schemaVersion: 1,
    actionId,
    source: ACTION_CONTEXT_SOURCES.USER_REQUEST,
    userExplicit: true,
    autoApplyCandidate: false,
  };
}

function riskBand(value) {
  if (value < 0.34) return 'LOW';
  if (value >= 0.65) return 'HIGH';
  return 'MEDIUM';
}

function summarizeObservedNodeSignalsV2(input) {
  const observed = input?.observedNodeSignalsV2;
  const blockSignals = Array.isArray(observed?.blockSignals) ? observed.blockSignals : [];
  const blockIds = new Set(blockSignals.map((block) => block.blockId).filter(Boolean));
  const repeatedHints = blockSignals.filter((block) => block.repeatedSiblingShapeHint === true).length;
  const coverage = observed?.coverage || {};

  return {
    observedSignalsVersion: observed?.version === 2 ? 2 : 0,
    v2Coverage: Number((typeof coverage.v2Coverage === 'number' ? coverage.v2Coverage : 0).toFixed(3)),
    observedBudgetHit: coverage.budgetHit === true,
    observedBlocks: typeof coverage.blocksObserved === 'number' ? coverage.blocksObserved : blockSignals.length,
    observedNodesSampled: typeof coverage.nodesSampled === 'number' ? coverage.nodesSampled : 0,
    repeatedHintsCoverage: Number((blockSignals.length ? repeatedHints / blockSignals.length : 0).toFixed(3)),
    blockIds,
  };
}

function actionTargetInputIndicator(observedSummary, actionTarget) {
  if (!actionTarget?.sourceBlockId) return 'NO_SOURCE_BLOCK';
  return observedSummary.blockIds.has(actionTarget.sourceBlockId)
    ? 'SOURCE_BLOCK_OBSERVED'
    : 'SOURCE_BLOCK_NOT_OBSERVED';
}

function buildPr9Artifacts(fixture, profile) {
  const baseInventory = buildRegionInventoryV1(profile);
  const visualGraph = buildVisualRegionGraphLiteV1(profile, {
    signals: fixture.input,
    inventory: baseInventory,
  });
  const repeatedRecordGroups = buildRepeatedRecordGroupsV1(profile, {
    graph: visualGraph,
  });
  const inventory = buildRegionInventoryV1(profile, {
    visualGraph,
    repeatedRecordGroups,
  });
  const actionTargets = buildActionTargetsV1(profile, inventory, {
    visualGraph,
    repeatedRecordGroups,
  });

  return {
    inventory,
    actionTargets,
    visualGraph,
    repeatedRecordGroups,
  };
}

function graphTargetInputIndicator(graph, actionTarget) {
  if (!actionTarget?.sourceBlockId || actionTarget.sourceBlockId === 'none') return 'NO_SOURCE_BLOCK';
  return (graph.nodes || []).some((node) => node.sourceBlockId === actionTarget.sourceBlockId)
    ? 'SOURCE_BLOCK_IN_GRAPH'
    : 'SOURCE_BLOCK_NOT_IN_GRAPH';
}

function registryCoverageSummary() {
  return {
    modeRegistryEntries: getModeRegistryV1().length,
    actionRegistryEntries: getActionRegistryV1().length,
    featureRegistryEntries: getFeatureRegistryV1().length,
    modeRegistryValid: validateModeRegistryV1().ok,
    actionRegistryValid: validateActionRegistryV1().ok,
    featureRegistryValid: validateFeatureRegistryV1().ok,
  };
}

function registryInfoForRow({ modeId, actionId, pageType }) {
  const modeEntry = findModeRegistryEntryV1(modeId);
  const actionEntry = findActionRegistryEntryV1(actionId);
  const featureEntries = listFeatureRegistryEntriesForActionV1(actionId);
  let registryPagePolicy = 'ACTION_MISSING';
  if (actionEntry) {
    if ((actionEntry.allowedPageTypes || []).includes(pageType)) registryPagePolicy = 'ALLOWED';
    else if ((actionEntry.shadowPageTypes || []).includes(pageType)) registryPagePolicy = 'SHADOW';
    else if ((actionEntry.deniedPageTypes || []).includes(pageType)) registryPagePolicy = 'DENIED';
    else registryPagePolicy = 'UNDECLARED';
  }

  return {
    modeRegistryFound: Boolean(modeEntry),
    modePublicLabel: modeEntry?.publicLabel || '',
    actionRegistryFound: Boolean(actionEntry),
    actionActivationStage: actionEntry?.activationStage || '',
    actionDefaultSupportLevel: actionEntry?.defaultSupportLevel || '',
    registryPagePolicy,
    registryFeatureCount: featureEntries.length,
  };
}

function isActionTargetHitEligible({ rowKind, pageType, hardBlocked, actionTarget, capabilityStatus }) {
  if (rowKind !== 'PRIMARY') return false;
  if (['UNKNOWN', 'DASHBOARD', 'VIDEO', 'WEB_APP'].includes(pageType)) return false;
  if (hardBlocked) return false;
  if (!actionTarget || ['UNSUPPORTED_PAGE_ABSTAIN', 'SAFE_ABSTAIN'].includes(actionTarget.decisionHint)) return false;
  if (capabilityStatus === CAPABILITY_STATUSES.INTENTIONAL_DENY) return false;
  return true;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readPageIntelligenceFixtures(fixtureDir = DEFAULT_FIXTURE_DIR) {
  return fs.readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.signals.v1.json'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const payload = readJson(path.join(fixtureDir, file));
      return {
        file,
        name: payload.name || file.replace(/\.signals\.v1\.json$/, ''),
        input: payload.input,
        expected: payload.expected || {},
      };
    });
}

function expectedActionDecision(expected, actionId) {
  if (Array.isArray(expected.allowedActions) && expected.allowedActions.includes(actionId)) {
    return 'EXPECTED_ALLOW';
  }
  if (Array.isArray(expected.deniedActions) && expected.deniedActions.includes(actionId)) {
    return 'EXPECTED_DENY';
  }
  return 'EXPECTED_UNKNOWN';
}

function policyMatchesExpectation(policyDecision, expectedDecision) {
  if (expectedDecision === 'EXPECTED_UNKNOWN') return true;
  if (expectedDecision === 'EXPECTED_DENY') return policyDecision === ACTION_POLICY_DECISIONS.DENY;
  return policyDecision !== ACTION_POLICY_DECISIONS.DENY;
}

function checkUnderstanding(fixture, profile) {
  const expected = fixture.expected || {};
  const problems = [];

  if (expected.pageType && profile.pageType !== expected.pageType) {
    problems.push(`pageType expected ${expected.pageType}, got ${profile.pageType}`);
  }
  if (
    typeof expected.minConfidence === 'number'
    && profile.pageTypeConfidence < expected.minConfidence
  ) {
    problems.push(`confidence below min ${expected.minConfidence}`);
  }
  if (
    typeof expected.maxConfidence === 'number'
    && profile.pageTypeConfidence > expected.maxConfidence
  ) {
    problems.push(`confidence above max ${expected.maxConfidence}`);
  }
  if (Object.hasOwn(expected, 'selectedScopeBlockId')) {
    const actualScope = profile.selectedScope?.blockId || null;
    if (actualScope !== expected.selectedScopeBlockId) {
      problems.push(`selectedScope expected ${expected.selectedScopeBlockId}, got ${actualScope}`);
    }
  }
  for (const [riskKey, expectedBand] of Object.entries(expected.riskBands || {})) {
    const actualBand = riskBand(profile.risk?.[riskKey] || 0);
    if (actualBand !== expectedBand) {
      problems.push(`${riskKey} expected ${expectedBand}, got ${actualBand}`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
  };
}

function predictedManualPath({ policyDecision, fallbackSupported, activePlanAllowed, executor }) {
  if (activePlanAllowed === true && executor === RUNTIME_EXECUTORS.DARK_THEME_TRANSFORM) {
    return 'ACTIVE_MANUAL_LIMITED_DARK';
  }
  if (activePlanAllowed === true && executor === RUNTIME_EXECUTORS.REGION_CLASS_TOKENS) {
    return 'ACTIVE_MANUAL_MEDIUM_VERIFIED';
  }
  if (policyDecision === 'SHADOW_ONLY') {
    return 'SHADOW_ONLY_NOT_APPLIED';
  }
  if (policyDecision === ACTION_POLICY_DECISIONS.DENY) {
    return fallbackSupported ? 'LIMITED_ONLY_SUPPORTED' : 'DENIED_NO_SUPPORTED_LIMITED';
  }
  if (fallbackSupported) {
    return 'TRY_STRONG_THEN_SUPPORTED_LIMITED';
  }
  return 'TRY_STRONG_NO_SUPPORTED_LIMITED';
}

function classifyGap({ understanding, policyDecision, expectedDecision, capabilityStatus, plannerError }) {
  if (!understanding.ok) return GAP_TYPES.UNDERSTANDING_FAIL;
  if (plannerError) return GAP_TYPES.PLANNER_FAIL;
  if (!policyMatchesExpectation(policyDecision, expectedDecision)) return GAP_TYPES.POLICY_UNEXPECTED;
  if (capabilityStatus !== CAPABILITY_STATUSES.SUPPORTED) return capabilityStatus;
  return GAP_TYPES.OK;
}

function compactReasons(reasons) {
  return Array.isArray(reasons) ? reasons.slice(0, 4).join(',') : '';
}

function desiredEffectForReportRow(actionId, pageType, fallbackDesiredEffect = 'NOOP') {
  if ([ADAPTATION_ACTION_IDS.PAGE_CLARITY, ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME].includes(actionId)) {
    return desiredEffectForActionTargetV1(actionId, pageType);
  }
  return fallbackDesiredEffect;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function metric(input, key) {
  const value = input?.aggregateMetrics?.[key];
  return Number.isFinite(value) ? clamp01(value) : 0;
}

function summarizeDarkReadiness({ fixtureInput, profile, observedSummary, actionTarget, capability, combinedBudgetHit }) {
  if (capability.key.actionId !== ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    return {
      darkReadinessStage: '',
      darkReadinessScore: '',
      darkBrightSurfaceRate: '',
      darkControlVisibilityRisk: '',
      darkMediaRisk: '',
      darkRollbackRisk: '',
      darkReadinessGap: '',
    };
  }

  const controlRisk = clamp01(metric(fixtureInput, 'interactiveDensity') * 0.6 + metric(fixtureInput, 'formDensity') * 0.7);
  const mediaRisk = clamp01(metric(fixtureInput, 'mediaDensity') * 0.9);
  const layoutRisk = clamp01(profile.risk?.layoutRisk || 0);
  const rollbackRisk = clamp01(
    (combinedBudgetHit ? 0.35 : 0)
    + layoutRisk * 0.35
    + controlRisk * 0.2
    + mediaRisk * 0.2
    + (observedSummary.v2Coverage < 0.75 ? 0.2 : 0)
  );
  const score = clamp01(
    (actionTarget?.confidence || 0) * 0.35
    + observedSummary.v2Coverage * 0.25
    + (1 - rollbackRisk) * 0.25
    + (capability.activePlanAllowed ? 0.15 : 0)
  );
  const brightSurfaceProxy = profile.selectedScope ? clamp01(metric(fixtureInput, 'viewportCoverage')) : 0;

  let stage = 'SHADOW_MEASURE_ONLY';
  if (capability.activePlanAllowed) stage = 'MANUAL_LIMITED_ACTIVE';
  else if ([CAPABILITY_STATUSES.INTENTIONAL_DENY, CAPABILITY_STATUSES.SAFE_ABSTAIN, CAPABILITY_STATUSES.HARD_BLOCKED].includes(capability.status)) {
    stage = capability.status;
  }

  const gaps = [];
  if (combinedBudgetHit) gaps.push('BUDGET_HIT');
  if (rollbackRisk >= 0.5) gaps.push('ROLLBACK_RISK');
  if (controlRisk >= 0.4) gaps.push('CONTROL_VISIBILITY_RISK');
  if (mediaRisk >= 0.25) gaps.push('MEDIA_RISK');
  if (!capability.activePlanAllowed && stage === 'SHADOW_MEASURE_ONLY') gaps.push('NON_READING_SURFACE_SHADOW');
  if (!observedSummary.observedSignalsVersion) gaps.push('OBSERVED_V2_MISSING');

  return {
    darkReadinessStage: stage,
    darkReadinessScore: Number(score.toFixed(3)),
    darkBrightSurfaceRate: Number(brightSurfaceProxy.toFixed(3)),
    darkControlVisibilityRisk: Number(controlRisk.toFixed(3)),
    darkMediaRisk: Number(mediaRisk.toFixed(3)),
    darkRollbackRisk: Number(rollbackRisk.toFixed(3)),
    darkReadinessGap: gaps.join(',') || 'NONE',
  };
}

export function buildCapabilityRows(fixtures = readPageIntelligenceFixtures()) {
  const rows = [];

  for (const fixture of fixtures) {
    const observedSummary = summarizeObservedNodeSignalsV2(fixture.input);
    const profile = routePageSignalsV1(fixture.input);
    const {
      actionTargets,
      visualGraph,
      repeatedRecordGroups,
    } = buildPr9Artifacts(fixture, profile);
    const understanding = checkUnderstanding(fixture, profile);

    for (const mode of MODE_ACTIONS) {
      const shadowOnly = mode.rowKind === 'SHADOW';
      const policy = shadowOnly || mode.rowKind === 'DARK'
        ? null
        : evaluateActionPolicyDecisionV1(profile, actionContext(mode.actionId));
      const expectedDecision = expectedActionDecision(fixture.expected, mode.actionId);
      let plan = null;
      let plannerError = '';

      if (!shadowOnly && mode.rowKind !== 'DARK') {
        try {
          plan = buildRuntimeEffectPlanV1({
            modeId: mode.modeId,
            profile,
            actionPolicyDecision: policy,
            includeV3LightShadow: true,
          });
        } catch (error) {
          plannerError = error instanceof Error ? error.message : String(error);
        }
      }

      const hardBlocked = (profile.problems || []).some((problem) => problem?.code === PROBLEM_CODES.MODAL_OVERLAY_PRESENT);
      const actionTarget = findActionTargetV1(actionTargets, mode.actionId);
      const desiredEffect = desiredEffectForReportRow(
        mode.actionId,
        profile.pageType,
        plan?.safeDowngrade || 'NOOP',
      );
      const capability = evaluateRuntimeCapabilityV1({
        modeId: mode.modeId,
        actionId: mode.actionId,
        pageType: profile.pageType,
        targetKind: actionTarget?.targetKind,
        effectClass: actionTarget?.effectClass,
        desiredEffect,
        hardBlocked,
      });
      const learningEffectKey = buildLearningEffectKeyV1(capability);
      const fallbackSupported = capability.status === CAPABILITY_STATUSES.SUPPORTED
        && capability.executor === RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS;
      const gap = classifyGap({
        understanding,
        policyDecision: policy?.decision || actionTarget?.decisionHint || 'SHADOW_ONLY',
        expectedDecision,
        capabilityStatus: capability.status,
        plannerError,
      });
      const actionTargetHitEligible = isActionTargetHitEligible({
        rowKind: mode.rowKind,
        pageType: profile.pageType,
        hardBlocked,
        actionTarget,
        capabilityStatus: capability.status,
      });
      const combinedBudgetHit = profile.stats.budgetHit
        || observedSummary.observedBudgetHit
        || visualGraph.stats.budgetHit
        || repeatedRecordGroups.stats.budgetHit;
      const registryInfo = registryInfoForRow({
        modeId: mode.modeId,
        actionId: mode.actionId,
        pageType: profile.pageType,
      });
      const promotionGate = evaluatePromotionGateV1({
        actionId: mode.actionId,
        pageType: profile.pageType,
        currentStage: registryInfo.actionActivationStage,
        capabilitySupported: capability.status === CAPABILITY_STATUSES.SUPPORTED,
        metrics: {
          fixtureCount: 1,
          actionTargetHitRate: actionTarget?.regionId && actionTarget.regionId !== 'none' ? 1 : 0,
          postCheckPassRate: 0,
          rollbackSuccessRate: 0,
          postApplyRegressionRate: 1,
          inspectedOutcomeCount: 0,
          positiveOutcomeRate: 0,
          explicitAutoApproval: false,
        },
      });
      const darkReadiness = summarizeDarkReadiness({
        fixtureInput: fixture.input,
        profile,
        observedSummary,
        actionTarget,
        capability,
        combinedBudgetHit,
      });

      rows.push({
        fixture: fixture.name,
        modeId: mode.modeId,
        actionId: mode.actionId,
        rowKind: mode.rowKind,
        label: mode.label,
        expectedPageType: fixture.expected.pageType || '',
        pageType: profile.pageType,
        confidence: Number(profile.pageTypeConfidence.toFixed(3)),
        selectedScope: profile.selectedScope?.blockId || 'null',
        policyDecision: policy?.decision || actionTarget?.decisionHint || 'SHADOW_ONLY',
        expectedDecision,
        strongEffect: plan?.strongEffect || '',
        desiredEffect,
        safeDowngrade: plan?.safeDowngrade || '',
        fallbackSupported,
        runtimeExecutorSupported: capability.activePlanAllowed,
        actionTargetKind: actionTarget?.targetKind || '',
        actionTargetDecisionHint: actionTarget?.decisionHint || '',
        actionTargetRegionId: actionTarget?.regionId || '',
        actionTargetSourceBlockId: actionTarget?.sourceBlockId || '',
        targetKind: capability.key.targetKind,
        effectClass: capability.key.effectClass,
        capabilityStatus: capability.status,
        supportLevel: capability.supportLevel,
        executor: capability.executor,
        activePlanAllowed: capability.activePlanAllowed,
        capabilityReason: capability.reason,
        plannerShadow: plan?.v3LightShadow?.shadowOnly === true,
        plannerShadowActionId: plan?.v3LightShadow?.actionId || '',
        plannerShadowCapabilityStatus: plan?.v3LightShadow?.capabilityStatus || '',
        postChecksRequired: capability.postChecksRequired,
        learningEligible: capability.learningEligible,
        learningEffectModeId: learningEffectKey.modeId,
        learningEffectActionId: learningEffectKey.actionId,
        learningEffectTargetKind: learningEffectKey.targetKind,
        learningEffectEffectClass: learningEffectKey.effectClass,
        learningEffectPageType: learningEffectKey.pageType,
        predictedManualPath: predictedManualPath({
          policyDecision: policy?.decision || actionTarget?.decisionHint || 'SHADOW_ONLY',
          fallbackSupported,
          activePlanAllowed: capability.activePlanAllowed,
          executor: capability.executor,
        }),
        gap,
        detail: plannerError || understanding.problems.join('; ') || compactReasons(policy?.reasons),
        elapsedMs: profile.stats.elapsedMs,
        nodesScanned: profile.stats.nodesScanned,
        candidatesSeen: profile.stats.candidatesSeen,
        budgetHit: profile.stats.budgetHit,
        graphNodes: visualGraph.stats.nodesSeen,
        graphGroups: visualGraph.stats.groupsSeen,
        repeatedRecordGroups: repeatedRecordGroups.stats.groupsSeen,
        graphBudgetHit: visualGraph.stats.budgetHit || repeatedRecordGroups.stats.budgetHit,
        combinedBudgetHit,
        graphTargetInputIndicator: graphTargetInputIndicator(visualGraph, actionTarget),
        actionTargetHitEligible,
        actionTargetHit: actionTargetHitEligible && actionTarget?.regionId !== 'none',
        ...registryInfo,
        confidentWrong: profile.pageTypeConfidence >= 0.7
          && fixture.expected.pageType
          && profile.pageType !== fixture.expected.pageType,
        observedSignalsVersion: observedSummary.observedSignalsVersion,
        v2Coverage: observedSummary.v2Coverage,
        observedBudgetHit: observedSummary.observedBudgetHit,
        observedBlocks: observedSummary.observedBlocks,
        observedNodesSampled: observedSummary.observedNodesSampled,
        repeatedHintsCoverage: observedSummary.repeatedHintsCoverage,
        actionTargetInputIndicator: actionTargetInputIndicator(observedSummary, actionTarget),
        promotionRequestedStage: promotionGate.requestedStage,
        promotionAllowed: promotionGate.allowed,
        promotionReason: promotionGate.reason,
        ...darkReadiness,
      });
    }
  }

  return rows;
}

export function summarizeCapabilityRows(rows) {
  const byGap = {};
  const byMode = {};
  const registryCoverage = registryCoverageSummary();
  let rowsWithV2 = 0;
  let v2CoverageTotal = 0;
  let actionTargetEligible = 0;
  let actionTargetHits = 0;
  let eligibleFallbackRows = 0;
  let eligibleFallbackDependent = 0;
  let confidentWrong = 0;
  let promotionAllowed = 0;
  let darkReadinessRows = 0;
  let darkActiveManualRows = 0;
  let darkShadowRows = 0;
  let darkBudgetHitRows = 0;
  let darkReadinessScoreTotal = 0;

  for (const row of rows) {
    if (row.observedSignalsVersion === 2) rowsWithV2 += 1;
    v2CoverageTotal += row.v2Coverage || 0;
    if (row.actionTargetHitEligible) {
      actionTargetEligible += 1;
      if (row.actionTargetHit) actionTargetHits += 1;
      eligibleFallbackRows += 1;
      if (!row.fallbackSupported && row.policyDecision !== 'SHADOW_ONLY') eligibleFallbackDependent += 1;
    }
    if (row.confidentWrong) confidentWrong += 1;
    if (row.promotionAllowed) promotionAllowed += 1;
    if (row.actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
      darkReadinessRows += 1;
      if (row.activePlanAllowed) darkActiveManualRows += 1;
      if (row.darkReadinessStage === 'SHADOW_MEASURE_ONLY') darkShadowRows += 1;
      if (row.combinedBudgetHit) darkBudgetHitRows += 1;
      if (Number.isFinite(row.darkReadinessScore)) darkReadinessScoreTotal += row.darkReadinessScore;
    }
    byGap[row.gap] = (byGap[row.gap] || 0) + 1;
    byMode[row.modeId] = byMode[row.modeId] || {
      total: 0,
      shadow: 0,
      ok: 0,
      capabilityMissing: 0,
      intentionalDeny: 0,
      safeAbstain: 0,
      hardBlocked: 0,
      understandingFail: 0,
      policyUnexpected: 0,
      plannerFail: 0,
    };
    byMode[row.modeId].total += 1;
    if (row.rowKind === 'SHADOW') byMode[row.modeId].shadow += 1;
    if (row.gap === GAP_TYPES.OK) byMode[row.modeId].ok += 1;
    if (row.gap === GAP_TYPES.CAPABILITY_MISSING) byMode[row.modeId].capabilityMissing += 1;
    if (row.gap === GAP_TYPES.INTENTIONAL_DENY) byMode[row.modeId].intentionalDeny += 1;
    if (row.gap === GAP_TYPES.SAFE_ABSTAIN) byMode[row.modeId].safeAbstain += 1;
    if (row.gap === GAP_TYPES.HARD_BLOCKED) byMode[row.modeId].hardBlocked += 1;
    if (row.gap === GAP_TYPES.UNDERSTANDING_FAIL) byMode[row.modeId].understandingFail += 1;
    if (row.gap === GAP_TYPES.POLICY_UNEXPECTED) byMode[row.modeId].policyUnexpected += 1;
    if (row.gap === GAP_TYPES.PLANNER_FAIL) byMode[row.modeId].plannerFail += 1;
  }

  return {
    totalRows: rows.length,
    fixtures: new Set(rows.map((row) => row.fixture)).size,
    modes: Object.keys(byMode).length,
    rowsWithV2,
    v2CoverageAverage: rows.length ? Number((v2CoverageTotal / rows.length).toFixed(3)) : 0,
    actionTargetHitRate: actionTargetEligible ? Number((actionTargetHits / actionTargetEligible).toFixed(3)) : 0,
    actionTargetHits,
    actionTargetEligible,
    promotionAllowed,
    darkReadinessRows,
    darkActiveManualRows,
    darkShadowRows,
    darkBudgetHitRows,
    darkReadinessScoreAverage: darkReadinessRows ? Number((darkReadinessScoreTotal / darkReadinessRows).toFixed(3)) : 0,
    ...registryCoverage,
    confidentWrongRate: rows.length ? Number((confidentWrong / rows.length).toFixed(3)) : 0,
    eligibleFallbackDependencyRate: eligibleFallbackRows ? Number((eligibleFallbackDependent / eligibleFallbackRows).toFixed(3)) : 0,
    byGap,
    byMode,
  };
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => String(row[header] ?? '')).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function renderCapabilityReport(rows = buildCapabilityRows()) {
  const summary = summarizeCapabilityRows(rows);
  const generatedAt = new Date().toISOString();
  const gapRows = rows.filter((row) => row.gap !== GAP_TYPES.OK);
  const summaryRows = Object.entries(summary.byMode).map(([modeId, value]) => ({
    modeId,
    total: value.total,
    shadow: value.shadow,
    ok: value.ok,
    capabilityMissing: value.capabilityMissing,
    intentionalDeny: value.intentionalDeny,
    safeAbstain: value.safeAbstain,
    hardBlocked: value.hardBlocked,
    understandingFail: value.understandingFail,
    policyUnexpected: value.policyUnexpected,
    plannerFail: value.plannerFail,
  }));
  const tableRows = rows.map((row) => ({
    fixture: row.fixture,
    modeId: row.modeId,
    actionId: row.actionId,
    rowKind: row.rowKind,
    label: row.label,
    pageType: row.pageType,
    confidence: row.confidence,
    policyDecision: row.policyDecision,
    safeDowngrade: row.safeDowngrade,
    desiredEffect: row.desiredEffect,
    targetKind: row.targetKind,
    effectClass: row.effectClass,
    actionTargetKind: row.actionTargetKind,
    actionTargetDecisionHint: row.actionTargetDecisionHint,
    capabilityStatus: row.capabilityStatus,
    supportLevel: row.supportLevel,
    executor: row.executor,
    activePlanAllowed: row.activePlanAllowed,
    learningEligible: row.learningEligible,
    observedSignalsVersion: row.observedSignalsVersion,
    v2Coverage: row.v2Coverage,
    observedBudgetHit: row.observedBudgetHit,
    graphNodes: row.graphNodes,
    graphGroups: row.graphGroups,
    repeatedRecordGroups: row.repeatedRecordGroups,
    graphBudgetHit: row.graphBudgetHit,
    combinedBudgetHit: row.combinedBudgetHit,
    graphTargetInputIndicator: row.graphTargetInputIndicator,
    actionTargetHit: row.actionTargetHit,
    actionTargetHitEligible: row.actionTargetHitEligible,
    modeRegistryFound: row.modeRegistryFound,
    modePublicLabel: row.modePublicLabel,
    actionRegistryFound: row.actionRegistryFound,
    actionActivationStage: row.actionActivationStage,
    actionDefaultSupportLevel: row.actionDefaultSupportLevel,
    registryPagePolicy: row.registryPagePolicy,
    registryFeatureCount: row.registryFeatureCount,
    confidentWrong: row.confidentWrong,
    actionTargetInputIndicator: row.actionTargetInputIndicator,
    repeatedHintsCoverage: row.repeatedHintsCoverage,
    learningEffectModeId: row.learningEffectModeId,
    learningEffectActionId: row.learningEffectActionId,
    learningEffectTargetKind: row.learningEffectTargetKind,
    learningEffectEffectClass: row.learningEffectEffectClass,
    learningEffectPageType: row.learningEffectPageType,
    plannerShadow: row.plannerShadow,
    plannerShadowActionId: row.plannerShadowActionId,
    plannerShadowCapabilityStatus: row.plannerShadowCapabilityStatus,
    fallbackSupported: row.fallbackSupported,
    runtimeExecutorSupported: row.runtimeExecutorSupported,
    predictedManualPath: row.predictedManualPath,
    promotionRequestedStage: row.promotionRequestedStage,
    promotionAllowed: row.promotionAllowed,
    promotionReason: row.promotionReason,
    darkReadinessStage: row.darkReadinessStage,
    darkReadinessScore: row.darkReadinessScore,
    darkBrightSurfaceRate: row.darkBrightSurfaceRate,
    darkControlVisibilityRisk: row.darkControlVisibilityRisk,
    darkMediaRisk: row.darkMediaRisk,
    darkRollbackRisk: row.darkRollbackRisk,
    darkReadinessGap: row.darkReadinessGap,
    gap: row.gap,
  }));
  const detailRows = gapRows.map((row) => ({
    fixture: row.fixture,
    modeId: row.modeId,
    actionId: row.actionId,
    rowKind: row.rowKind,
    pageType: row.pageType,
    desiredEffect: row.desiredEffect,
    targetKind: row.targetKind,
    effectClass: row.effectClass,
    capabilityStatus: row.capabilityStatus,
    supportLevel: row.supportLevel,
    executor: row.executor,
    activePlanAllowed: row.activePlanAllowed,
    learningEligible: row.learningEligible,
    learningEffectActionId: row.learningEffectActionId,
    learningEffectTargetKind: row.learningEffectTargetKind,
    learningEffectEffectClass: row.learningEffectEffectClass,
    gap: row.gap,
    detail: row.capabilityReason || row.detail,
  }));

  return [
    '# Page Understanding Capability Gap Report',
    '',
    `Generated: ${generatedAt}`,
    '',
    'This report is read-only. It routes existing page-intelligence fixtures through PageUnderstanding, action policy, runtime planning, and the pure runtime capability matrix.',
    '',
    '## Summary',
    '',
    `- Fixtures: ${summary.fixtures}`,
    `- Modes: ${summary.modes}`,
    `- Rows: ${summary.totalRows}`,
    `- PR8 observed V2 rows: ${summary.rowsWithV2}`,
    `- PR8 average v2Coverage: ${summary.v2CoverageAverage}`,
    `- PR9 action target hit rate: ${summary.actionTargetHitRate} (${summary.actionTargetHits}/${summary.actionTargetEligible})`,
    `- PR10 registry entries: modes=${summary.modeRegistryEntries}, actions=${summary.actionRegistryEntries}, features=${summary.featureRegistryEntries}`,
    `- PR10 registry valid: modes=${summary.modeRegistryValid}, actions=${summary.actionRegistryValid}, features=${summary.featureRegistryValid}`,
    `- PR21 promotion gates allowed: ${summary.promotionAllowed}`,
    `- PR-D6 dark readiness rows: ${summary.darkReadinessRows}`,
    `- PR-D6 dark active manual rows: ${summary.darkActiveManualRows}`,
    `- PR-D6 dark shadow rows: ${summary.darkShadowRows}`,
    `- PR-D6 dark budget-hit rows: ${summary.darkBudgetHitRows}`,
    `- PR-D6 average dark readiness score: ${summary.darkReadinessScoreAverage}`,
    `- PR9 confident wrong rate: ${summary.confidentWrongRate}`,
    `- PR9 eligible fallback dependency rate: ${summary.eligibleFallbackDependencyRate}`,
    `- Gaps: ${Object.entries(summary.byGap).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
    '',
    markdownTable(
      ['modeId', 'total', 'shadow', 'ok', 'capabilityMissing', 'intentionalDeny', 'safeAbstain', 'hardBlocked', 'understandingFail', 'policyUnexpected', 'plannerFail'],
      summaryRows,
    ),
    '',
    '## All Rows',
    '',
    markdownTable(
      [
        'fixture',
        'modeId',
        'actionId',
        'rowKind',
        'label',
        'pageType',
        'confidence',
        'policyDecision',
        'desiredEffect',
        'targetKind',
        'effectClass',
        'actionTargetKind',
        'actionTargetDecisionHint',
        'capabilityStatus',
        'supportLevel',
        'executor',
        'activePlanAllowed',
        'learningEligible',
        'observedSignalsVersion',
        'v2Coverage',
        'observedBudgetHit',
        'graphNodes',
        'graphGroups',
        'repeatedRecordGroups',
        'graphBudgetHit',
        'combinedBudgetHit',
        'graphTargetInputIndicator',
        'actionTargetHit',
        'actionTargetHitEligible',
        'modeRegistryFound',
        'modePublicLabel',
        'actionRegistryFound',
        'actionActivationStage',
        'actionDefaultSupportLevel',
        'registryPagePolicy',
        'registryFeatureCount',
        'confidentWrong',
        'actionTargetInputIndicator',
        'repeatedHintsCoverage',
        'learningEffectActionId',
        'learningEffectTargetKind',
        'learningEffectEffectClass',
        'learningEffectPageType',
        'plannerShadow',
        'plannerShadowActionId',
        'plannerShadowCapabilityStatus',
        'fallbackSupported',
        'runtimeExecutorSupported',
        'predictedManualPath',
        'promotionRequestedStage',
        'promotionAllowed',
        'promotionReason',
        'darkReadinessStage',
        'darkReadinessScore',
        'darkBrightSurfaceRate',
        'darkControlVisibilityRisk',
        'darkMediaRisk',
        'darkRollbackRisk',
        'darkReadinessGap',
        'gap',
      ],
      tableRows,
    ),
    '',
    '## Gap Details',
    '',
    detailRows.length
      ? markdownTable(['fixture', 'modeId', 'actionId', 'rowKind', 'pageType', 'desiredEffect', 'targetKind', 'effectClass', 'capabilityStatus', 'supportLevel', 'executor', 'activePlanAllowed', 'learningEligible', 'learningEffectActionId', 'learningEffectTargetKind', 'learningEffectEffectClass', 'gap', 'detail'], detailRows)
      : 'No gaps detected.',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const result = {
    write: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      result.write = argv[index + 1] || '';
      index += 1;
    }
  }
  return result;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = renderCapabilityReport();
  if (args.write) {
    const outputPath = path.resolve(repoRoot, args.write);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, 'utf8');
    process.stdout.write(`Wrote ${outputPath}\n`);
    return outputPath;
  }
  process.stdout.write(`${report}\n`);
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
