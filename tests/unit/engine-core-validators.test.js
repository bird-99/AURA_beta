import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTION_POLICY_DECISIONS,
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  INVARIANT_CODES,
  INVARIANT_PHASES,
  INVARIANT_SEVERITIES,
  OUTCOME_IDS,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  POST_APPLY_CHECK_CODES,
  PROBLEM_CODES,
  REASON_CODES,
  RUNTIME_EXECUTORS,
  SHADOW_NOT_APPLIED_REASONS,
  SHADOW_POLICY_IDS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  USER_OUTCOME_EVENTS,
  validateLearningEffectKeyV1,
  validateRuntimeCapabilityDecisionV1,
  validateRuntimeCapabilityKeyV1,
  validateRegionTargetValidationRequestV1,
  validateRegionTargetValidationResultV1,
  validateShadowPolicySummaryV1,
  validateShadowReplayComparisonV1,
  validateShadowReplayEventV1,
  validateActionContextV1,
  validateActionPolicyDecisionV1,
  validateAdaptationContractV1,
  validateCollectedPageSignalsV1,
  validateObservedNodeSignalsV2,
  validateOutcomeLedgerEventV1,
  validatePageUnderstandingProfileV1,
  validatePostApplyInspectionResultV1,
  validatePrivacySafeJson,
  validateRepeatedRecordGroupsV1,
  validateRuntimeEffectPlanV1,
  validateVisualRegionGraphLiteV1,
  validateShadowReplayStoreV1,
  validateShadowDecisionV1,
  validateUserOutcomeEventV1,
} from '../../shared/engine-core/index.js';

function validSignals(overrides = {}) {
  return {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_test_v1',
    routeEpoch: 'aura_pse_route_test_v1',
    viewport: { w: 1280, h: 720 },
    pageHints: {
      urlKind: 'UNKNOWN',
      semanticArticleCount: 1,
      formCount: 0,
      tableCount: 0,
      mediaCount: 1,
      fixedOrStickyCount: 0,
      modalLikeCount: 0,
    },
    aggregateMetrics: {
      textDensity: 0.8,
      linkDensity: 0.1,
      interactiveDensity: 0.05,
      mediaDensity: 0.1,
      formDensity: 0,
      tableDensity: 0,
      viewportCoverage: 0.7,
    },
    blocks: [
      {
        blockId: 'b1',
        roleHint: BLOCK_ROLES.ARTICLE,
        rectRatio: {
          xRatio: 0.1,
          yRatio: 0.1,
          widthRatio: 0.6,
          heightRatio: 0.7,
          visibleRatio: 0.9,
        },
        metrics: {
          textDensity: 0.88,
          linkDensity: 0.08,
          interactiveDensity: 0.02,
          mediaDensity: 0.05,
          formDensity: 0,
          tableDensity: 0,
          viewportCoverage: 0.6,
        },
        flags: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
      },
    ],
    stats: { elapsedMs: 5, nodesScanned: 200, candidatesSeen: 3, budgetHit: false },
    ...overrides,
  };
}

function messages(validation) {
  return validation.errors.map((error) => error.message).join('\n');
}

test('CollectedPageSignalsV1 accepts plain privacy-safe JSON', () => {
  const validation = validateCollectedPageSignalsV1(validSignals());
  assert.equal(validation.ok, true, messages(validation));
});

function validObservedNodeSignals(overrides = {}) {
  return {
    version: 2,
    collectionMode: 'BLOCK_SUMMARY',
    readiness: {
      documentReadyState: 'complete',
      lateLoadLikely: false,
      layoutStableHint: true,
    },
    coverage: {
      blocksObserved: 1,
      blocksWithSignals: 1,
      candidatesSeen: 3,
      nodesSampled: 200,
      elapsedMs: 5,
      v2Coverage: 1,
      budgetHit: false,
      partial: false,
    },
    blockSignals: [{
      blockId: 'b1',
      rectBuckets: { x: 1, y: 1, w: 6, h: 7 },
      visibleAreaBucket: 4,
      viewportIntersectionBucket: 9,
      sameRowHint: false,
      sameColumnHint: false,
      verticalAdjacencyHint: false,
      repeatedSiblingShapeHint: false,
      siblingIndexBucket: 0,
      siblingCountBucket: 1,
      formControlDensityBucket: 0,
      linkDensityBucket: 1,
      mediaControlSeparationHint: false,
      headingHint: true,
      listHint: false,
      cardHint: false,
      centralityBucket: 8,
    }],
    ...overrides,
  };
}

test('ObservedNodeSignalsV2 is optional, bounded and privacy-safe', () => {
  const observed = validObservedNodeSignals();
  assert.equal(validateObservedNodeSignalsV2(observed).ok, true, messages(validateObservedNodeSignalsV2(observed)));
  assert.equal(validateCollectedPageSignalsV1(validSignals({ observedNodeSignalsV2: observed })).ok, true);
  assert.equal(validateCollectedPageSignalsV1(validSignals()).ok, true);

  const tooManyBlocks = validObservedNodeSignals({
    coverage: { ...observed.coverage, blocksObserved: 21, blocksWithSignals: 21 },
    blockSignals: Array.from({ length: 21 }, (_, index) => ({
      ...observed.blockSignals[0],
      blockId: `b${index}`,
    })),
  });
  assert.equal(validateObservedNodeSignalsV2(tooManyBlocks).ok, false);

  const badBucket = validObservedNodeSignals({
    blockSignals: [{ ...observed.blockSignals[0], centralityBucket: 11 }],
  });
  assert.equal(validateObservedNodeSignalsV2(badBucket).ok, false);
});

test('ObservedNodeSignalsV2 rejects graph, runtime, DOM and private data fields', () => {
  const observed = validObservedNodeSignals();
  const cases = [
    { ...observed, selector: 'main' },
    { ...observed, rawText: 'private text' },
    { ...observed, pageUrl: 'https://private.example/' },
    { ...observed, visualRegionGraph: {} },
    { ...observed, actionTargets: [] },
    { ...observed, executor: 'REGION_CLASS_TOKENS' },
    { ...observed, blockSignals: [{ ...observed.blockSignals[0], rect: { x: 0, y: 0, width: 1, height: 1, top: 0 } }] },
    { ...observed, blockSignals: [{ ...observed.blockSignals[0], element: { nodeType: 1, tagName: 'MAIN' } }] },
  ];

  for (const payload of cases) {
    assert.equal(validateObservedNodeSignalsV2(payload).ok, false);
    assert.equal(validateCollectedPageSignalsV1(validSignals({ observedNodeSignalsV2: payload })).ok, false);
  }
});

test('VisualRegionGraphLiteV1 and RepeatedRecordGroupsV1 validate compact PR9 DTOs', () => {
  const graph = {
    version: 1,
    frameId: 0,
    pageType: PAGE_TYPES.SEARCH,
    nodes: [{
      nodeId: 'n1',
      sourceBlockId: 'b1',
      regionId: 'r1',
      roleHint: BLOCK_ROLES.CARD,
      targetKind: TARGET_KINDS.RECORD_REGION,
      confidence: 0.8,
      rectBuckets: { x: 1, y: 1, w: 6, h: 5 },
      buckets: {
        visibleArea: 4,
        viewportIntersection: 9,
        centrality: 8,
        linkDensity: 6,
        formControlDensity: 0,
        siblingCount: 6,
      },
      hints: {
        heading: false,
        list: true,
        card: true,
        repeatedSiblingShape: true,
        sameRow: false,
        sameColumn: true,
        verticalAdjacency: true,
        mediaControlSeparation: false,
      },
      flags: {
        primaryCandidate: true,
        repeatedRecordLike: true,
        boilerplateLike: false,
        gceCandidate: true,
        riskyInteractive: false,
      },
      score: 0.84,
    }],
    edges: [],
    groups: [{
      groupId: 'g1',
      type: 'REPEATED_RECORDS',
      memberNodeIds: ['n1'],
      primaryNodeId: 'n1',
      targetKind: TARGET_KINDS.RECORD_REGION,
      confidence: 0.84,
      score: 0.84,
      reasons: [REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    }],
    stats: {
      nodesSeen: 1,
      edgesSeen: 0,
      groupsSeen: 1,
      budgetHit: false,
      partial: false,
    },
  };
  const repeated = {
    version: 1,
    frameId: 0,
    groups: [{
      groupId: 'rrg1',
      targetKind: TARGET_KINDS.RECORD_REGION,
      sourceRegionIds: ['r1'],
      sourceBlockIds: ['b1'],
      confidence: 0.86,
      reasons: [REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
      metrics: {
        memberCountBucket: 6,
        repeatedShapeScore: 1,
        sameRowScore: 0,
        sameColumnScore: 1,
        linkDensityBucket: 6,
        mediaSeparationScore: 0,
      },
    }],
    stats: {
      groupsSeen: 1,
      nodesSeen: 1,
      budgetHit: false,
    },
  };

  assert.equal(validateVisualRegionGraphLiteV1(graph).ok, true, messages(validateVisualRegionGraphLiteV1(graph)));
  assert.equal(validateRepeatedRecordGroupsV1(repeated).ok, true, messages(validateRepeatedRecordGroupsV1(repeated)));
  assert.equal(validateVisualRegionGraphLiteV1({ ...graph, edges: [{ from: 'n1', to: 'n404', type: 'SAME_ROW', weight: 0.5, reasons: [] }] }).ok, false);
  assert.equal(validateVisualRegionGraphLiteV1({ ...graph, nodes: [{ ...graph.nodes[0], rect: { x: 0, y: 0, width: 1, height: 1, top: 0 } }] }).ok, false);
  assert.equal(validateRepeatedRecordGroupsV1({ ...repeated, groups: [{ ...repeated.groups[0], css: '.x{}' }] }).ok, false);
  assert.equal(validateRepeatedRecordGroupsV1({ ...repeated, groups: [{ ...repeated.groups[0], targetKind: TARGET_KINDS.FORM_REGION }] }).ok, false);
});

test('privacy validator rejects non-JSON, live-handle-like, rect-like and sensitive payloads', () => {
  const cyclic = {};
  cyclic.self = cyclic;

  const cases = [
    { payload: { callback: () => {} }, expected: 'function is not JSON-serializable' },
    { payload: cyclic, expected: 'cyclic objects are not allowed' },
    { payload: { value: Number.POSITIVE_INFINITY }, expected: 'number must be finite' },
    { payload: { value: BigInt(1) }, expected: 'bigint is not JSON-serializable' },
    { payload: { value: new Date() }, expected: 'only plain JSON objects are allowed' },
    { payload: { value: new Map() }, expected: 'only plain JSON objects are allowed' },
    { payload: { handle: { nodeType: 1, tagName: 'MAIN' } }, expected: 'live handle-like objects are not allowed' },
    {
      payload: { box: { x: 0, y: 0, width: 10, height: 20, top: 0, right: 10, bottom: 20, left: 0 } },
      expected: 'rect-like objects are not allowed',
    },
    { payload: { url: 'https://example.com/private?q=1' }, expected: 'privacy-forbidden key "url"' },
    { payload: { note: 'https://example.com/private?q=1' }, expected: 'full URLs are not allowed' },
    { payload: { textContent: 'raw content' }, expected: 'privacy-forbidden key "textContent"' },
    { payload: { screenshot: 'bucketed-image' }, expected: 'privacy-forbidden key "screenshot"' },
  ];

  for (const { payload, expected } of cases) {
    const validation = validatePrivacySafeJson(payload);
    assert.equal(validation.ok, false, `expected rejection for ${expected}`);
    assert.match(messages(validation), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('CollectedPageSignalsV1 rejects ratio and cap violations', () => {
  const badRatio = validSignals({
    aggregateMetrics: { ...validSignals().aggregateMetrics, textDensity: 1.2 },
    pageHints: { ...validSignals().pageHints, urlKind: 'PRIVATE_SEARCH_PATH' },
  });
  const ratioValidation = validateCollectedPageSignalsV1(badRatio);
  assert.equal(ratioValidation.ok, false);
  assert.match(messages(ratioValidation), /expected finite number in range/);
  assert.match(messages(ratioValidation), /expected one of/);

  const tooManyBlocks = validSignals({
    blocks: Array.from({ length: 21 }, (_, index) => ({
      ...validSignals().blocks[0],
      blockId: `b${index}`,
    })),
  });
  const capValidation = validateCollectedPageSignalsV1(tooManyBlocks);
  assert.equal(capValidation.ok, false);
  assert.match(messages(capValidation), /array exceeds cap 20/);

  const missingEpoch = validSignals();
  delete missingEpoch.collectionEpoch;
  assert.equal(validateCollectedPageSignalsV1(missingEpoch).ok, false);

  const routeFingerprint = validateCollectedPageSignalsV1({
    ...validSignals(),
    routeFingerprint: 'route_private',
  });
  assert.equal(routeFingerprint.ok, false);
  assert.ok(routeFingerprint.errors.some((error) => error.path === '$.routeFingerprint'));
});

test('PageUnderstandingProfileV1 validates nested candidates, selected scope and problems', () => {
  const validProfile = {
    schemaVersion: 1,
    frameId: 0,
    pageType: PAGE_TYPES.ARTICLE,
    pageTypeConfidence: 0.82,
    selectedScope: {
      blockId: 'b1',
      roleHint: BLOCK_ROLES.ARTICLE,
      confidence: 0.8,
      reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    },
    candidates: [{
      blockId: 'b1',
      roleHint: BLOCK_ROLES.ARTICLE,
      score: 0.88,
      confidence: 0.8,
      reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
      rectRatio: {
        xRatio: 0.1,
        yRatio: 0.1,
        widthRatio: 0.5,
        heightRatio: 0.6,
        visibleRatio: 0.9,
      },
      metrics: validSignals().aggregateMetrics,
    }],
    problems: [],
    risk: { layoutRisk: 0.2, interactionRisk: 0.1, confidenceRisk: 0.1, privacyRisk: 0 },
    reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    stats: validSignals().stats,
  };

  assert.equal(validatePageUnderstandingProfileV1(validProfile).ok, true);

  const badCandidate = validatePageUnderstandingProfileV1({
    ...validProfile,
    candidates: ['b1'],
  });
  assert.equal(badCandidate.ok, false);
  assert.match(messages(badCandidate), /expected scope candidate object/);

  const badSelectedScope = validatePageUnderstandingProfileV1({
    ...validProfile,
    selectedScope: { ...validProfile.selectedScope, selector: 'main' },
  });
  assert.equal(badSelectedScope.ok, false);
  assert.match(messages(badSelectedScope), /privacy-forbidden key "selector"/);

  const badProblem = validatePageUnderstandingProfileV1({
    ...validProfile,
    problems: [{ code: PROBLEM_CODES.LOW_CONFIDENCE_PAGE_TYPE }],
  });
  assert.equal(badProblem.ok, false);
  assert.match(messages(badProblem), /expected one of INFO, WARN, BLOCK/);

  const badPolicyMix = validatePageUnderstandingProfileV1({
    ...validProfile,
    allowedActions: [ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY],
  });
  assert.equal(badPolicyMix.ok, false);
  assert.match(messages(badPolicyMix), /action policy fields do not belong/);
});

test('RegionTargetValidationV1 DTOs reject unsafe or malformed payloads', () => {
  const request = {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_1',
    routeEpoch: 'aura_pse_route_1',
    sourceBlockId: 'b1',
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  };
  const result = {
    schemaVersion: 1,
    ok: true,
    reason: 'OK',
    sameEpoch: true,
    stillConnected: true,
    stillVisible: true,
    roleHintStillMatches: true,
    confidence: 1,
    frameId: 0,
  };

  assert.equal(validateRegionTargetValidationRequestV1(request).ok, true);
  const { sourceBlockId, ...regionRequest } = request;
  assert.equal(validateRegionTargetValidationRequestV1({ ...regionRequest, regionId: 'r1' }).ok, true);
  assert.equal(validateRegionTargetValidationRequestV1(regionRequest).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...request, expectedTargetKind: 'ARTICLE' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...request, frameId: 0.4 }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...request, selector: 'main' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...request, textContent: 'private text' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...request, element: { nodeType: 1, tagName: 'MAIN' } }).ok, false);

  assert.equal(validateRegionTargetValidationResultV1(result).ok, true);
  assert.equal(validateRegionTargetValidationResultV1({ ...result, confidence: 2 }).ok, false);
  assert.equal(validateRegionTargetValidationResultV1({ ...result, rawText: 'private text' }).ok, false);
});

test('contract and decision skeleton DTOs validate without runtime wiring', () => {
  const evidence = [{
    reason: REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH,
    metricPath: 'blocks[0].metrics.textDensity',
    operator: 'GTE',
    observed: 0.88,
    threshold: 0.7,
    blockId: 'b1',
  }];
  const invariant = {
    code: INVARIANT_CODES.SAFE_SCOPE_REQUIRED,
    phase: INVARIANT_PHASES.PRE_APPLY,
    severity: INVARIANT_SEVERITIES.BLOCK,
    evidence,
  };
  const contract = {
    schemaVersion: 1,
    contractId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    outcome: OUTCOME_IDS.READING_COMFORT,
    allowedPageTypes: [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC],
    deniedPageTypes: [PAGE_TYPES.VIDEO, PAGE_TYPES.FORM, PAGE_TYPES.DASHBOARD],
    requiredScopeRoles: [BLOCK_ROLES.ARTICLE, BLOCK_ROLES.PRIMARY_CONTENT],
    forbiddenScopeRoles: [BLOCK_ROLES.PLAYER, BLOCK_ROLES.FORM, BLOCK_ROLES.TABLE],
    preconditions: [invariant],
    applyPlan: { kind: 'SCOPED_CSS', modeId: 'comfort-visual', maxStrength: 0.5 },
    postconditions: [{ ...invariant, code: INVARIANT_CODES.NO_HORIZONTAL_SCROLL_REGRESSION, phase: INVARIANT_PHASES.POST_APPLY }],
    rollbackPlan: { kind: 'REMOVE_OWNED_CSS_AND_TOKENS' },
    learningEligibility: {
      requiresPostApplyPass: true,
      requiresNoUndoWindowMs: 90000,
      ignoredIsWeakNegative: true,
      rollbackIsHardNegative: true,
    },
    explanation: {
      userFacingSummaryKey: 'reading_comfort_typography',
      debugReasonCodes: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    },
  };

  assert.equal(validateAdaptationContractV1(contract).ok, true);
  assert.equal(validateActionContextV1({
    schemaVersion: 1,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    source: 'USER_REQUEST',
    requestedStrength: 0.4,
    userExplicit: true,
    autoApplyCandidate: false,
  }).ok, true);
  assert.equal(validateActionPolicyDecisionV1({
    schemaVersion: 1,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    decision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    confidence: 0.82,
    selectedScopeId: 'b1',
    contractId: 'READING_COMFORT_TYPOGRAPHY',
    reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    risk: { layoutRisk: 0.2, interactionRisk: 0.1, confidenceRisk: 0.1, privacyRisk: 0 },
    constraints: {
      maxStrength: 0.5,
      scopeRequired: true,
      autoApplyAllowed: false,
      postApplyInspectionRequired: true,
    },
  }).ok, true);
});

test('post-apply, outcome and shadow DTO skeletons validate as privacy-safe JSON', () => {
  assert.equal(validateRuntimeEffectPlanV1({
    version: 1,
    matrixVersion: 1,
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    pageType: PAGE_TYPES.ARTICLE,
    frameId: 0,
    strongEffect: 'SCOPED_STRONG_READING_TRANSFORM',
    safeDowngrade: 'SAFE_READING_TEXT_LINK_CLARITY',
    readerAllowed: true,
    overrideAllowed: true,
    overrideScope: 'TAB_SESSION',
    postChecks: [POST_APPLY_CHECK_CODES.HORIZONTAL_SCROLL],
    policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    confidence: 0.8,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      targetKind: TARGET_KINDS.READING_REGION,
      effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
      capabilityStatus: CAPABILITY_STATUSES.CAPABILITY_MISSING,
      supportLevel: SUPPORT_LEVELS.NOT_IMPLEMENTED,
      activationStage: ACTIVATION_STAGES.REPORT_ONLY,
      executor: RUNTIME_EXECUTORS.NONE,
      activePlanAllowed: false,
      actionTargetDecisionHint: 'CANDIDATE_TARGET',
      actionTargetConfidence: 0.8,
      shadowOnly: true,
    },
  }).ok, true);

  assert.equal(validatePostApplyInspectionResultV1({
    schemaVersion: 1,
    attemptId: 'attempt_1',
    passed: true,
    checks: [{
      code: POST_APPLY_CHECK_CODES.HORIZONTAL_SCROLL,
      passed: true,
      observed: 0,
      threshold: 0,
    }],
    rollbackRequired: false,
    reasons: [],
  }).ok, true);

  assert.equal(validateUserOutcomeEventV1({
    schemaVersion: 1,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    templateHash: 'template_a',
    pageType: PAGE_TYPES.ARTICLE,
    event: USER_OUTCOME_EVENTS.ACCEPT,
    postApplyAttemptId: 'attempt_1',
    timestampBucket: '2026-06-22',
  }).ok, true);

  assert.equal(validateOutcomeLedgerEventV1({
    schemaVersion: 1,
    attemptId: 'attempt_1',
    profileHash: 'shr1_profileprofileprof1',
    templateHash: 'tmh1_eeeeeeeeeeeeeeeeeeeeee',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    learningEligible: true,
    timestampBucket: '2026-06-22',
  }).ok, true);

  assert.equal(validateShadowDecisionV1({
    schemaVersion: 1,
    shadowRunId: 'shr1_runrunrunrunrunrun1',
    policyId: SHADOW_POLICY_IDS.ACTION_POLICY_V1,
    policyVersion: 'action-policy-v1',
    profileHash: 'shr1_profileprofileprof1',
    actionId: ADAPTATION_ACTION_IDS.REDUCE_MOTION,
    actionContextSource: 'USER_REQUEST',
    predictedDecision: ACTION_POLICY_DECISIONS.SUGGEST_ONLY,
    predictedRisk: { layoutRisk: 0.1, interactionRisk: 0.2, confidenceRisk: 0.3, privacyRisk: 0 },
    reasonCodes: [REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH],
    notAppliedBecause: SHADOW_NOT_APPLIED_REASONS.SHADOW_MODE,
  }).ok, true);

  const active = {
    schemaVersion: 1,
    activePolicyId: 'LEGACY_SCORE_POLICY',
    activePolicyVersion: 'legacy-score-v1',
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    decisionKind: 'APPLY',
    score: 0.91,
    reasons: ['TEST_POLICY'],
    thresholds: { enter: 0.6, exit: 0.48, apply: 0.85 },
  };
  const shadow = {
    schemaVersion: 1,
    shadowRunId: 'shr1_runrunrunrunrunrun2',
    policyId: SHADOW_POLICY_IDS.ACTION_POLICY_V1,
    policyVersion: 'action-policy-v1',
    profileHash: 'shr1_profileprofileprof2',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    actionContextSource: 'USER_REQUEST',
    predictedDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    predictedRisk: { layoutRisk: 0.1, interactionRisk: 0.2, confidenceRisk: 0.3, privacyRisk: 0 },
    reasonCodes: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    notAppliedBecause: SHADOW_NOT_APPLIED_REASONS.SHADOW_MODE,
  };
  const comparison = {
    schemaVersion: 1,
    comparisonKind: 'ACTIVE_MORE_AGGRESSIVE',
    activeWouldApply: true,
    shadowWouldApply: true,
    diverged: true,
    reasons: ['ACTIVE_MORE_AGGRESSIVE'],
  };
  const event = {
    schemaVersion: 1,
    shadowRunId: 'shr1_runrunrunrunrunrun2',
    timestampBucket: '2026-06-22T00:00:00.000Z',
    active,
    shadow,
    comparison,
  };
  assert.equal(validateShadowPolicySummaryV1(active).ok, true);
  assert.equal(validateShadowReplayComparisonV1(comparison).ok, true);
  assert.equal(validateShadowReplayEventV1(event).ok, true);
  assert.equal(validateShadowReplayStoreV1({ schemaVersion: 1, entries: [event] }).ok, true);
});

test('OutcomeLedgerEventV1 rejects unexpected and privacy-sensitive fields', () => {
  const base = {
    schemaVersion: 1,
    attemptId: 'attempt_1',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    reasons: [],
    learningEligible: true,
    timestampBucket: '2026-06-22',
  };

  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    pageUrl: 'https://private.example/path',
  }).ok, false);

  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    selector: '#private-node',
  }).ok, false);

  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    profileHash: 'profile_raw',
  }).ok, false);

  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    templateHash: 'h123',
  }).ok, false);

  const cyclic = { ...base };
  cyclic.self = cyclic;
  assert.equal(validateOutcomeLedgerEventV1(cyclic).ok, false);
});

test('OutcomeLedgerEventV1 accepts LearningEffectKeyV1 but rejects PAGE_CLARITY positive learning', () => {
  const learningEffectKey = {
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
  };
  const base = {
    schemaVersion: 1,
    attemptId: 'attempt_1',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    modeId: 'focus',
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
    reasons: [],
    learningEligible: true,
    timestampBucket: '2026-06-22',
    learningEffectKey,
  };

  assert.equal(validateOutcomeLedgerEventV1(base).ok, true);
  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    learningEffectKey: { ...learningEffectKey, selector: '#private' },
  }).ok, false);
  assert.equal(validateOutcomeLedgerEventV1({
    ...base,
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    modeId: 'comfort-visual',
    learningEffectKey: {
      modeId: 'comfort-visual',
      actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
      pageType: PAGE_TYPES.SEARCH,
    },
  }).ok, false);
});

test('RuntimeEffectPlanV1 rejects unsafe payloads and unknown checks', () => {
  const base = {
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
    postChecks: [POST_APPLY_CHECK_CODES.FOCUS_LOST],
    policyDecision: ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
    confidence: 0.7,
  };

  assert.equal(validateRuntimeEffectPlanV1({ ...base, url: 'https://private.example/' }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({ ...base, selector: 'main' }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({ ...base, rawText: 'private text' }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({ ...base, handle: { nodeType: 1, tagName: 'MAIN' } }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({ ...base, callback: () => {} }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({ ...base, postChecks: ['NOT_A_CHECK'] }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
      capabilityStatus: CAPABILITY_STATUSES.SAFE_ABSTAIN,
      supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      executor: RUNTIME_EXECUTORS.NOOP,
      activePlanAllowed: false,
      actionTargetDecisionHint: 'SAFE_ABSTAIN',
      actionTargetConfidence: 0,
      shadowOnly: true,
    },
  }).ok, true);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
      capabilityStatus: CAPABILITY_STATUSES.CAPABILITY_MISSING,
      supportLevel: SUPPORT_LEVELS.NOT_IMPLEMENTED,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      executor: RUNTIME_EXECUTORS.NONE,
      activePlanAllowed: true,
      actionTargetDecisionHint: 'CANDIDATE_TARGET',
      actionTargetConfidence: 0.8,
      shadowOnly: true,
    },
  }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
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
      actionTargetConfidence: 0.8,
      shadowOnly: false,
    },
  }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
    v3LightShadow: {
      version: 1,
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      targetKind: TARGET_KINDS.RECORD_REGION,
      effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
      capabilityStatus: CAPABILITY_STATUSES.SUPPORTED,
      supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      executor: RUNTIME_EXECUTORS.NONE,
      activePlanAllowed: true,
      actionTargetDecisionHint: 'CANDIDATE_TARGET',
      actionTargetConfidence: 0.8,
      shadowOnly: true,
    },
  }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
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
      actionTargetConfidence: 0.8,
      shadowOnly: true,
      rawSignals: {},
    },
  }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
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
      actionTargetDecisionHint: 'https://private.example/',
      actionTargetConfidence: 0.8,
      shadowOnly: true,
    },
  }).ok, false);
  assert.equal(validateRuntimeEffectPlanV1({
    ...base,
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
      actionTargetConfidence: 0.8,
      shadowOnly: true,
      handle: { nodeType: 1, tagName: 'MAIN' },
    },
  }).ok, false);

  const cyclic = { ...base };
  cyclic.self = cyclic;
  assert.equal(validateRuntimeEffectPlanV1(cyclic).ok, false);
});

test('RuntimeCapabilityDecisionV1 validates capability taxonomy and rejects unsafe payloads', () => {
  const key = {
    modeId: 'comfort-visual',
    actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    pageType: PAGE_TYPES.SEARCH,
    targetKind: TARGET_KINDS.RECORD_REGION,
    effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
  };
  const decision = {
    version: 1,
    key,
    desiredEffect: 'SAFE_RESULTS_TEXT_LINK_CLARITY',
    status: CAPABILITY_STATUSES.CAPABILITY_MISSING,
    supportLevel: SUPPORT_LEVELS.NOT_IMPLEMENTED,
    activationStage: ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED,
    executor: RUNTIME_EXECUTORS.NONE,
    activePlanAllowed: false,
    reason: 'NO_ACTIVE_RUNTIME_EXECUTOR',
    postChecksRequired: false,
    learningEligible: false,
  };

  assert.equal(validateRuntimeCapabilityKeyV1(key).ok, true);
  assert.equal(validateLearningEffectKeyV1(key).ok, true);
  assert.equal(validateLearningEffectKeyV1({ ...key, pageUrl: 'https://private.example/' }).ok, false);
  assert.equal(validateLearningEffectKeyV1({ ...key, selector: '#private' }).ok, false);
  assert.equal(validateLearningEffectKeyV1({ ...key, rawText: 'private text' }).ok, false);
  assert.equal(validateLearningEffectKeyV1({ ...key, targetKind: 'UNKNOWN_TARGET' }).ok, false);
  assert.equal(validateLearningEffectKeyV1({ ...key, effectClass: undefined }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1(decision).ok, true);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    supportLevel: SUPPORT_LEVELS.SHADOW_ONLY,
    reason: 'PAGE_CLARITY_SHADOW_NO_ACTIVE_EXECUTOR',
  }).ok, true);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, selector: '.private' }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, pageUrl: 'https://private.example/' }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, key: { ...key, effectClass: 'UNKNOWN_EFFECT' } }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, status: 'ACTIVE_RUNTIME' }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, supportLevel: 'CAPABILITY_MISSING' }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, executor: 'STYLE_TAG' }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({ ...decision, key: { ...key, handle: { nodeType: 1, tagName: 'MAIN' } } }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
    activePlanAllowed: true,
  }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    status: CAPABILITY_STATUSES.INTENTIONAL_DENY,
    supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    postChecksRequired: true,
  }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    status: CAPABILITY_STATUSES.SAFE_ABSTAIN,
    supportLevel: SUPPORT_LEVELS.REPORT_ONLY,
    executor: RUNTIME_EXECUTORS.NOOP,
    learningEligible: true,
  }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
    executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
    activePlanAllowed: true,
    postChecksRequired: true,
    learningEligible: false,
  }).ok, true);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
    activePlanAllowed: true,
    postChecksRequired: false,
    learningEligible: false,
  }).ok, false);
  assert.equal(validateRuntimeCapabilityDecisionV1({
    ...decision,
    status: CAPABILITY_STATUSES.SUPPORTED,
    supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
    executor: RUNTIME_EXECUTORS.SAFE_DOWNGRADE_CSS,
    activePlanAllowed: true,
    postChecksRequired: true,
    learningEligible: true,
  }).ok, false);
});

test('ShadowDecisionV1 rejects unexpected runtime and privacy-sensitive fields', () => {
  const base = {
    schemaVersion: 1,
    shadowRunId: 'shr1_runrunrunrunrunrun1',
    policyId: SHADOW_POLICY_IDS.ACTION_POLICY_V1,
    policyVersion: 'action-policy-v1',
    profileHash: 'shr1_profileprofileprof1',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    actionContextSource: 'USER_REQUEST',
    predictedDecision: ACTION_POLICY_DECISIONS.DENY,
    predictedRisk: { layoutRisk: 0.1, interactionRisk: 0.2, confidenceRisk: 0.3, privacyRisk: 0 },
    reasonCodes: [REASON_CODES.UNKNOWN_LOW_CONFIDENCE],
    notAppliedBecause: SHADOW_NOT_APPLIED_REASONS.SHADOW_MODE,
  };

  assert.equal(validateShadowDecisionV1({ ...base, profileHash: 'profile_a' }).ok, false);
  assert.equal(validateShadowDecisionV1({ ...base, selectedScopeId: 'block-1' }).ok, false);
  assert.equal(validateShadowDecisionV1({ ...base, actionPayload: { cssText: '.secret{}' } }).ok, false);
  assert.equal(validateShadowDecisionV1({ ...base, rawProfile: { pageUrl: 'https://private.example/path' } }).ok, false);
});
