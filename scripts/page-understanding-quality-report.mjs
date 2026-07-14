#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  TARGET_KINDS,
  buildActionTargetsV1,
  buildLearningEffectKeyV1,
  buildRepeatedRecordGroupsV1,
  buildRegionInventoryV1,
  buildVisualRegionGraphLiteV1,
  countRegionsByTargetKind,
  desiredEffectForActionTargetV1,
  evaluatePromotionGateV1,
  evaluateRuntimeCapabilityV1,
  findActionTargetV1,
  findActionRegistryEntryV1,
  findModeRegistryEntryV1,
  getActionRegistryV1,
  getFeatureRegistryV1,
  getGuaranteedEffectV1,
  getModeRegistryV1,
  listFeatureRegistryEntriesForActionV1,
  PAGE_TYPES,
  PROBLEM_CODES,
  evaluateActionPolicyDecisionV1,
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

export const REGION_TYPES = Object.freeze({
  READING_REGION: TARGET_KINDS.READING_REGION,
  RECORD_REGION: TARGET_KINDS.RECORD_REGION,
  FORM_REGION: TARGET_KINDS.FORM_REGION,
  DASHBOARD_REGION: TARGET_KINDS.DASHBOARD_REGION,
  MEDIA_REGION: TARGET_KINDS.MEDIA_REGION,
  APP_REGION: TARGET_KINDS.APP_REGION,
  BASELINE_OR_ABSTAIN: TARGET_KINDS.BASELINE_OR_ABSTAIN,
  NONE: TARGET_KINDS.NONE,
});

export const QUALITY_RESULTS = Object.freeze({
  OK_STRONG_PATH: 'OK_STRONG_PATH',
  V3_LIGHT_OPPORTUNITY: 'V3_LIGHT_OPPORTUNITY',
  SAFE_ABSTAIN_UNKNOWN: 'SAFE_ABSTAIN_UNKNOWN',
  HARD_BLOCKED: 'HARD_BLOCKED',
  UNDERSTANDING_FAIL: 'UNDERSTANDING_FAIL',
  REGION_MISSING: 'REGION_MISSING',
  V3_TARGET_MISSING: 'V3_TARGET_MISSING',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  INTENTIONAL_DENY: 'INTENTIONAL_DENY',
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function actionTargetInputIndicator(observedSummary, target) {
  if (!target?.sourceBlockId) return 'NO_SOURCE_BLOCK';
  return observedSummary.blockIds.has(target.sourceBlockId)
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

function graphTargetInputIndicator(graph, target) {
  if (!target?.sourceBlockId || target.sourceBlockId === 'none') return 'NO_SOURCE_BLOCK';
  return (graph.nodes || []).some((node) => node.sourceBlockId === target.sourceBlockId)
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

function isActionTargetHitEligible({ rowKind, pageType, hardBlocked, target, capabilityStatus }) {
  if (rowKind !== 'PRIMARY') return false;
  if ([PAGE_TYPES.UNKNOWN, PAGE_TYPES.DASHBOARD, PAGE_TYPES.VIDEO, PAGE_TYPES.WEB_APP].includes(pageType)) return false;
  if (hardBlocked) return false;
  if (!target || target.reason === 'UNSUPPORTED_PAGE_ABSTAIN' || target.reason === 'SAFE_ABSTAIN') return false;
  if (capabilityStatus === CAPABILITY_STATUSES.INTENTIONAL_DENY) return false;
  return true;
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

export function expectedPrimaryRegionForPageType(pageType) {
  switch (pageType) {
    case PAGE_TYPES.ARTICLE:
    case PAGE_TYPES.DOC:
      return REGION_TYPES.READING_REGION;
    case PAGE_TYPES.SEARCH:
    case PAGE_TYPES.SHOP:
    case PAGE_TYPES.FEED:
      return REGION_TYPES.RECORD_REGION;
    case PAGE_TYPES.FORM:
      return REGION_TYPES.FORM_REGION;
    case PAGE_TYPES.DASHBOARD:
      return REGION_TYPES.DASHBOARD_REGION;
    case PAGE_TYPES.VIDEO:
      return REGION_TYPES.MEDIA_REGION;
    case PAGE_TYPES.WEB_APP:
      return REGION_TYPES.APP_REGION;
    default:
      return REGION_TYPES.BASELINE_OR_ABSTAIN;
  }
}

function targetForMode({ actionId, actionTargets }) {
  const target = findActionTargetV1(actionTargets, actionId);
  if (!target) {
    return {
      found: false,
      target: 'BASELINE_OR_ABSTAIN',
      reason: 'TARGET_MISSING',
    };
  }
  return {
    found: target.regionId !== 'none' && !target.decisionHint.includes('ABSTAIN'),
    target: target.targetKind,
    reason: target.decisionHint,
    regionId: target.regionId,
    sourceBlockId: target.sourceBlockId,
    effectClass: target.effectClass,
    confidence: target.confidence,
  };
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

function summarizeDarkReadiness({ fixtureInput, profile, observedSummary, target, capability, combinedBudgetHit }) {
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
    (target?.confidence || 0) * 0.35
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

function blockingProblemCodes(profile) {
  return (profile.problems || [])
    .filter((problem) => problem.severity === 'BLOCK')
    .map((problem) => problem.code);
}

function currentStrongPathPossible({ profile, policy }) {
  if (!policy) return false;
  if (policy.decision === ACTION_POLICY_DECISIONS.DENY) return false;
  if (!profile.selectedScope) return false;
  if (profile.pageType === PAGE_TYPES.UNKNOWN) return false;
  return true;
}

function classifyQuality({
  understanding,
  expectedRegion,
  expectedRegionFound,
  v3TargetFound,
  currentStrongPath,
  pageType,
  hardBlocked,
  capabilityStatus,
}) {
  if (!understanding.ok) return QUALITY_RESULTS.UNDERSTANDING_FAIL;
  if (pageType === PAGE_TYPES.UNKNOWN) return QUALITY_RESULTS.SAFE_ABSTAIN_UNKNOWN;
  if (hardBlocked) return QUALITY_RESULTS.HARD_BLOCKED;
  if (capabilityStatus === CAPABILITY_STATUSES.INTENTIONAL_DENY) return QUALITY_RESULTS.INTENTIONAL_DENY;
  if (capabilityStatus === CAPABILITY_STATUSES.CAPABILITY_MISSING) return QUALITY_RESULTS.CAPABILITY_MISSING;
  if (expectedRegion !== REGION_TYPES.NONE && !expectedRegionFound) return QUALITY_RESULTS.REGION_MISSING;
  if (!v3TargetFound) return QUALITY_RESULTS.V3_TARGET_MISSING;
  if (!currentStrongPath && v3TargetFound) return QUALITY_RESULTS.V3_LIGHT_OPPORTUNITY;
  return QUALITY_RESULTS.OK_STRONG_PATH;
}

function fallbackReason({ currentStrongPath, policy, profile }) {
  if (!policy) return 'SHADOW_ONLY';
  if (currentStrongPath) return 'NONE';
  if (policy.decision === ACTION_POLICY_DECISIONS.DENY) return 'CURRENT_POLICY_DENY';
  if (!profile.selectedScope) return 'NO_SELECTED_SCOPE';
  if (profile.pageType === PAGE_TYPES.UNKNOWN) return 'UNKNOWN_PAGE';
  const blocking = blockingProblemCodes(profile);
  if (blocking.includes(PROBLEM_CODES.MODAL_OVERLAY_PRESENT)) return 'MODAL_OVERLAY_PRESENT';
  return blocking[0] || 'CURRENT_STRONG_PATH_BLOCKED';
}

export function buildQualityRows(fixtures = readPageIntelligenceFixtures()) {
  const rows = [];

  for (const fixture of fixtures) {
    const observedSummary = summarizeObservedNodeSignalsV2(fixture.input);
    const profile = routePageSignalsV1(fixture.input);
    const understanding = checkUnderstanding(fixture, profile);
    const {
      inventory,
      actionTargets,
      visualGraph,
      repeatedRecordGroups,
    } = buildPr9Artifacts(fixture, profile);
    const regionCounts = countRegionsByTargetKind(inventory);
    const expectedRegion = expectedPrimaryRegionForPageType(fixture.expected.pageType || profile.pageType);
    const expectedRegionFound = [REGION_TYPES.NONE, REGION_TYPES.BASELINE_OR_ABSTAIN].includes(expectedRegion)
      || (regionCounts[expectedRegion] || 0) > 0;

    for (const mode of MODE_ACTIONS) {
      const shadowOnly = mode.rowKind === 'SHADOW';
      const policy = shadowOnly || mode.rowKind === 'DARK'
        ? null
        : evaluateActionPolicyDecisionV1(profile, actionContext(mode.actionId));
      const target = targetForMode({ actionId: mode.actionId, actionTargets });
      const currentStrongPath = currentStrongPathPossible({ profile, policy });
      const blockingProblems = blockingProblemCodes(profile);
      const hardBlocked = blockingProblems.includes(PROBLEM_CODES.MODAL_OVERLAY_PRESENT);
      const desiredEffect = desiredEffectForReportRow(
        mode.actionId,
        profile.pageType,
        getGuaranteedEffectV1(mode.modeId, profile.pageType)?.safeDowngrade || 'NOOP',
      );
      const capability = evaluateRuntimeCapabilityV1({
        modeId: mode.modeId,
        actionId: mode.actionId,
        pageType: profile.pageType,
        targetKind: target.target,
        effectClass: target.effectClass,
        desiredEffect,
        hardBlocked,
      });
      const learningEffectKey = buildLearningEffectKeyV1(capability);
      const result = classifyQuality({
        understanding,
        expectedRegion,
        expectedRegionFound,
        v3TargetFound: target.found,
        currentStrongPath,
        pageType: profile.pageType,
        hardBlocked,
        capabilityStatus: capability.status,
      });
      const actionTargetEligible = isActionTargetHitEligible({
        rowKind: mode.rowKind,
        pageType: profile.pageType,
        hardBlocked,
        target,
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
          actionTargetHitRate: target.found ? 1 : 0,
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
        target,
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
        currentPolicyDecision: policy?.decision || target.reason || 'SHADOW_ONLY',
        currentStrongPath,
        currentFallbackDependent: !shadowOnly && !currentStrongPath,
        currentFallbackReason: fallbackReason({ currentStrongPath, policy, profile }),
        expectedPrimaryRegion: expectedRegion,
        expectedRegionFound,
        v3LiteTarget: target.target,
        v3LiteTargetFound: target.found,
        actionTargetDecisionHint: target.reason,
        actionTargetRegionId: target.regionId || '',
        actionTargetSourceBlockId: target.sourceBlockId || '',
        desiredEffect,
        targetKind: capability.key.targetKind,
        effectClass: capability.key.effectClass,
        capabilityStatus: capability.status,
        supportLevel: capability.supportLevel,
        executor: capability.executor,
        activePlanAllowed: capability.activePlanAllowed,
        learningEligible: capability.learningEligible,
        learningEffectModeId: learningEffectKey.modeId,
        learningEffectActionId: learningEffectKey.actionId,
        learningEffectTargetKind: learningEffectKey.targetKind,
        learningEffectEffectClass: learningEffectKey.effectClass,
        learningEffectPageType: learningEffectKey.pageType,
        gapReason: capability.reason,
        v3LiteWouldAvoidFallback: !currentStrongPath && target.found && !hardBlocked && capability.activePlanAllowed,
        qualityResult: result,
        understandingDetail: understanding.problems.join('; '),
        blockingProblems: blockingProblems.join(',') || 'none',
        elapsedMs: profile.stats.elapsedMs,
        nodesScanned: profile.stats.nodesScanned,
        candidatesSeen: profile.stats.candidatesSeen,
        budgetHit: profile.stats.budgetHit,
        graphNodes: visualGraph.stats.nodesSeen,
        graphGroups: visualGraph.stats.groupsSeen,
        repeatedRecordGroups: repeatedRecordGroups.stats.groupsSeen,
        graphBudgetHit: visualGraph.stats.budgetHit || repeatedRecordGroups.stats.budgetHit,
        combinedBudgetHit,
        graphTargetInputIndicator: graphTargetInputIndicator(visualGraph, target),
        actionTargetHitEligible: actionTargetEligible,
        actionTargetHit: actionTargetEligible && target.found === true,
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
        actionTargetInputIndicator: actionTargetInputIndicator(observedSummary, target),
        promotionRequestedStage: promotionGate.requestedStage,
        promotionAllowed: promotionGate.allowed,
        promotionReason: promotionGate.reason,
        ...darkReadiness,
      });
    }
  }

  return rows;
}

export function summarizeQualityRows(rows) {
  const byResult = {};
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
      if (row.currentFallbackDependent) eligibleFallbackDependent += 1;
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
    byResult[row.qualityResult] = (byResult[row.qualityResult] || 0) + 1;
    byMode[row.modeId] = byMode[row.modeId] || {
      total: 0,
      shadow: 0,
      okStrongPath: 0,
      v3LightOpportunity: 0,
      safeAbstainUnknown: 0,
      capabilityMissing: 0,
      intentionalDeny: 0,
      hardBlocked: 0,
      currentFallbackDependent: 0,
      v3LiteWouldAvoidFallback: 0,
    };
    byMode[row.modeId].total += 1;
    if (row.rowKind === 'SHADOW') byMode[row.modeId].shadow += 1;
    if (row.qualityResult === QUALITY_RESULTS.OK_STRONG_PATH) byMode[row.modeId].okStrongPath += 1;
    if (row.qualityResult === QUALITY_RESULTS.V3_LIGHT_OPPORTUNITY) byMode[row.modeId].v3LightOpportunity += 1;
    if (row.qualityResult === QUALITY_RESULTS.SAFE_ABSTAIN_UNKNOWN) byMode[row.modeId].safeAbstainUnknown += 1;
    if (row.qualityResult === QUALITY_RESULTS.CAPABILITY_MISSING) byMode[row.modeId].capabilityMissing += 1;
    if (row.qualityResult === QUALITY_RESULTS.INTENTIONAL_DENY) byMode[row.modeId].intentionalDeny += 1;
    if (row.qualityResult === QUALITY_RESULTS.HARD_BLOCKED) byMode[row.modeId].hardBlocked += 1;
    if (row.currentFallbackDependent) byMode[row.modeId].currentFallbackDependent += 1;
    if (row.v3LiteWouldAvoidFallback) byMode[row.modeId].v3LiteWouldAvoidFallback += 1;
  }

  const primaryRows = rows.filter((row) => row.rowKind === 'PRIMARY');
  const currentFallbackDependencyRate = primaryRows.length
    ? primaryRows.filter((row) => row.currentFallbackDependent).length / primaryRows.length
    : 0;
  const v3LiteOpportunityRate = primaryRows.length
    ? primaryRows.filter((row) => row.v3LiteWouldAvoidFallback).length / primaryRows.length
    : 0;

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
    confidentWrongRate: summarySafeRate(confidentWrong, rows.length),
    eligibleFallbackDependencyRate: eligibleFallbackRows ? Number((eligibleFallbackDependent / eligibleFallbackRows).toFixed(3)) : 0,
    currentFallbackDependencyRate: Number(currentFallbackDependencyRate.toFixed(3)),
    v3LiteOpportunityRate: Number(v3LiteOpportunityRate.toFixed(3)),
    byResult,
    byMode,
  };
}

function summarySafeRate(count, total) {
  return total ? Number((count / total).toFixed(3)) : 0;
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

export function renderQualityReport(rows = buildQualityRows()) {
  const summary = summarizeQualityRows(rows);
  const generatedAt = new Date().toISOString();
  const summaryRows = Object.entries(summary.byMode).map(([modeId, value]) => ({
    modeId,
    total: value.total,
    shadow: value.shadow,
    okStrongPath: value.okStrongPath,
    v3LightOpportunity: value.v3LightOpportunity,
    safeAbstainUnknown: value.safeAbstainUnknown,
    capabilityMissing: value.capabilityMissing,
    intentionalDeny: value.intentionalDeny,
    hardBlocked: value.hardBlocked,
    currentFallbackDependent: value.currentFallbackDependent,
    v3LiteWouldAvoidFallback: value.v3LiteWouldAvoidFallback,
  }));
  const tableRows = rows.map((row) => ({
    fixture: row.fixture,
    modeId: row.modeId,
    actionId: row.actionId,
    rowKind: row.rowKind,
    label: row.label,
    pageType: row.pageType,
    currentPolicyDecision: row.currentPolicyDecision,
    currentStrongPath: row.currentStrongPath,
    currentFallbackReason: row.currentFallbackReason,
    expectedPrimaryRegion: row.expectedPrimaryRegion,
    expectedRegionFound: row.expectedRegionFound,
    v3LiteTarget: row.v3LiteTarget,
    v3LiteTargetFound: row.v3LiteTargetFound,
    actionTargetDecisionHint: row.actionTargetDecisionHint,
    desiredEffect: row.desiredEffect,
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
        learningEffectActionId: row.learningEffectActionId,
        learningEffectTargetKind: row.learningEffectTargetKind,
        learningEffectEffectClass: row.learningEffectEffectClass,
        learningEffectPageType: row.learningEffectPageType,
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
        qualityResult: row.qualityResult,
  }));
  const opportunityRows = rows
    .filter((row) => row.qualityResult === QUALITY_RESULTS.V3_LIGHT_OPPORTUNITY)
    .map((row) => ({
      fixture: row.fixture,
      modeId: row.modeId,
      pageType: row.pageType,
      currentFallbackReason: row.currentFallbackReason,
      v3LiteTarget: row.v3LiteTarget,
      capabilityStatus: row.capabilityStatus,
      supportLevel: row.supportLevel,
      activePlanAllowed: row.activePlanAllowed,
      blockingProblems: row.blockingProblems,
    }));

  return [
    '# Page Understanding Quality Report',
    '',
    `Generated: ${generatedAt}`,
    '',
    'This report measures whether PageUnderstanding finds plausible action targets and whether the runtime capability exists. It does not change runtime behavior.',
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
    `- Current fallback dependency rate: ${summary.currentFallbackDependencyRate}`,
    `- V3-lite opportunity rate: ${summary.v3LiteOpportunityRate}`,
    `- Results: ${Object.entries(summary.byResult).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`,
    '',
    markdownTable(
      [
        'modeId',
        'total',
        'shadow',
        'okStrongPath',
        'v3LightOpportunity',
        'safeAbstainUnknown',
        'capabilityMissing',
        'intentionalDeny',
        'hardBlocked',
        'currentFallbackDependent',
        'v3LiteWouldAvoidFallback',
      ],
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
        'currentPolicyDecision',
        'currentStrongPath',
        'currentFallbackReason',
        'expectedPrimaryRegion',
        'expectedRegionFound',
        'v3LiteTarget',
        'v3LiteTargetFound',
        'actionTargetDecisionHint',
        'desiredEffect',
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
        'qualityResult',
      ],
      tableRows,
    ),
    '',
    '## V3-lite Opportunities',
    '',
    opportunityRows.length
      ? markdownTable(
        ['fixture', 'modeId', 'pageType', 'currentFallbackReason', 'v3LiteTarget', 'capabilityStatus', 'supportLevel', 'activePlanAllowed', 'blockingProblems'],
        opportunityRows,
      )
      : 'No V3-lite opportunities detected.',
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
  const report = renderQualityReport();
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
