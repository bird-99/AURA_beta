import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  INVARIANT_CODES,
  INVARIANT_PHASES,
  PAGE_TYPES,
  evaluateAdaptationContractV1,
  getAdaptationContractV1,
  getAdaptationContractsV1,
  routePageSignalsV1,
  validateAdaptationContractV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');
const ACTIONS = ADAPTATION_ACTION_IDS;
const ALL_ACTIONS = Object.freeze([
  ACTIONS.READING_COMFORT_TYPOGRAPHY,
  ACTIONS.FOCUS_VISIBILITY,
  ACTIONS.REDUCE_MOTION,
  ACTIONS.TARGET_SIZE,
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readFixtures() {
  return fs.readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.signals.v1.json'))
    .map((file) => {
      const filePath = path.join(fixtureDir, file);
      return { file, payload: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    });
}

function fixtureProfile(name) {
  const fixture = readFixtures().find(({ payload }) => payload.name === name);
  assert.ok(fixture, `missing fixture ${name}`);
  return routePageSignalsV1(fixture.payload.input);
}

function messages(validation) {
  return validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

function byAction(actionId) {
  const contract = getAdaptationContractV1(actionId);
  assert.ok(contract, `missing contract ${actionId}`);
  return contract;
}

test('adaptation contract catalog exposes pure runtime contracts including PAGE_CLARITY', () => {
  const contracts = getAdaptationContractsV1();
  assert.deepEqual(
    contracts.map((contract) => contract.actionId).sort(),
    [
      ACTIONS.FOCUS_VISIBILITY,
      ACTIONS.PAGE_CLARITY,
      ACTIONS.READING_COMFORT_TYPOGRAPHY,
      ACTIONS.REDUCE_MOTION,
      ACTIONS.TARGET_SIZE,
    ].sort(),
  );

  for (const contract of contracts) {
    const validation = validateAdaptationContractV1(contract);
    assert.equal(validation.ok, true, messages(validation));
    assert.equal(validatePrivacySafeJson(contract).ok, true);
    assert.equal(contract.contractId, contract.actionId);
    assert.equal(contract.applyPlan.kind, 'SCOPED_CSS');
    assert.equal('cssText' in contract.applyPlan, false);
    assert.equal('selector' in contract.applyPlan, false);
    assert.equal(contract.rollbackPlan.kind, 'REMOVE_OWNED_CSS_AND_TOKENS');
    assert.equal(contract.learningEligibility.requiresPostApplyPass, true);
    assert.equal(contract.postconditions.length > 0, true);
    assert.equal(contract.postconditions.every((check) => check.phase === INVARIANT_PHASES.POST_APPLY), true);
  }
});

test('page clarity contract is target-backed for search and form pages', () => {
  const contract = byAction(ACTIONS.PAGE_CLARITY);

  assert.deepEqual(contract.allowedPageTypes, [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM]);
  assert.equal(contract.deniedPageTypes.includes(PAGE_TYPES.UNKNOWN), true);
  assert.equal(contract.deniedPageTypes.includes(PAGE_TYPES.VIDEO), true);
  assert.equal(contract.requiredScopeRoles.length, 0);
  assert.equal(contract.forbiddenScopeRoles.includes(BLOCK_ROLES.PLAYER), true);
  assert.equal(contract.postconditions.some((check) => check.code === INVARIANT_CODES.NO_CONTROL_OCCLUSION), true);
  assert.equal(contract.postconditions.some((check) => check.code === INVARIANT_CODES.FOCUS_REMAINS_VISIBLE), true);

  const searchWithoutScope = {
    ...fixtureProfile('search-results'),
    selectedScope: null,
  };
  const formWithoutScope = {
    ...fixtureProfile('form-simple'),
    selectedScope: null,
  };

  assert.equal(evaluateAdaptationContractV1(searchWithoutScope, ACTIONS.PAGE_CLARITY).passed, true);
  assert.equal(evaluateAdaptationContractV1(formWithoutScope, ACTIONS.PAGE_CLARITY).passed, true);
});

test('reading comfort typography contract has the intended semantic boundaries', () => {
  const contract = byAction(ACTIONS.READING_COMFORT_TYPOGRAPHY);

  assert.deepEqual(contract.allowedPageTypes, [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC]);
  assert.equal(contract.deniedPageTypes.includes(PAGE_TYPES.VIDEO), true);
  assert.equal(contract.deniedPageTypes.includes(PAGE_TYPES.FORM), true);
  assert.equal(contract.deniedPageTypes.includes(PAGE_TYPES.DASHBOARD), true);
  assert.equal(contract.requiredScopeRoles.includes(BLOCK_ROLES.ARTICLE), true);
  assert.equal(contract.requiredScopeRoles.includes(BLOCK_ROLES.PRIMARY_CONTENT), true);
  assert.equal(contract.forbiddenScopeRoles.includes(BLOCK_ROLES.PLAYER), true);
  assert.equal(contract.forbiddenScopeRoles.includes(BLOCK_ROLES.FORM), true);
  assert.equal(contract.forbiddenScopeRoles.includes(BLOCK_ROLES.TABLE), true);
  assert.equal(contract.postconditions.some((check) => check.code === INVARIANT_CODES.NO_HORIZONTAL_SCROLL_REGRESSION), true);
  assert.equal(contract.postconditions.some((check) => check.code === INVARIANT_CODES.NO_CLIPPED_TEXT), true);
  assert.equal(contract.postconditions.some((check) => check.code === INVARIANT_CODES.SCOPE_STILL_VISIBLE), true);
});

test('adaptation contracts evaluate fixture profiles without becoming policy decisions', () => {
  for (const { payload } of readFixtures()) {
    const profile = routePageSignalsV1(payload.input);
    const allowed = new Set(payload.expected.allowedActions || []);
    const denied = new Set(payload.expected.deniedActions || []);
    for (const actionId of ALL_ACTIONS) {
      assert.notEqual(
        allowed.has(actionId),
        denied.has(actionId),
        `${payload.name} ${actionId} should be declared exactly once as allowed or denied`,
      );

      const expectedPassed = allowed.has(actionId);
      const result = evaluateAdaptationContractV1(profile, actionId);
      assert.equal(result.passed, expectedPassed, `${payload.name} ${actionId}`);
      assert.equal('decision' in result, false, 'PR4 must not emit ActionPolicyDecisionV1 decisions');
      assert.deepEqual(result.risk, profile.risk);
      assert.notEqual(result.risk, profile.risk);
      if (!expectedPassed) {
        assert.equal(result.selectedScopeId, null, `${payload.name} ${actionId} denied result should not expose selected scope`);
        assert.equal(result.blockingFailures.length > 0, true, `${payload.name} ${actionId} should explain blocking failures`);
      }
    }
  }
});

test('scoped CSS contracts require a selected scope even when no role is required', () => {
  const searchWithoutScope = {
    ...fixtureProfile('doc'),
    pageType: PAGE_TYPES.SEARCH,
    pageTypeConfidence: 0.86,
    selectedScope: null,
    candidates: [],
    problems: [],
    risk: {
      layoutRisk: 0.12,
      interactionRisk: 0.18,
      confidenceRisk: 0.08,
      privacyRisk: 0,
    },
  };

  for (const actionId of [ACTIONS.FOCUS_VISIBILITY, ACTIONS.TARGET_SIZE]) {
    const result = evaluateAdaptationContractV1(searchWithoutScope, actionId);
    assert.equal(result.passed, false);
    assert.equal(result.selectedScopeId, null);
    assert.equal(result.blockingFailures.some((check) => check.code === INVARIANT_CODES.SAFE_SCOPE_REQUIRED), true);
  }
});

test('blocking profile problems fail closed unless the contract explicitly tolerates them', () => {
  const form = fixtureProfile('form');
  const video = fixtureProfile('video-watch');

  const formTarget = evaluateAdaptationContractV1(form, ACTIONS.TARGET_SIZE);
  assert.equal(formTarget.passed, false);
  assert.equal(formTarget.blockingFailures.some((check) => check.code === INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS), true);

  const videoTarget = evaluateAdaptationContractV1(video, ACTIONS.TARGET_SIZE);
  assert.equal(videoTarget.passed, false);
  assert.equal(videoTarget.blockingFailures.some((check) => check.code === INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS), true);

  const formFocus = evaluateAdaptationContractV1(form, ACTIONS.FOCUS_VISIBILITY);
  assert.equal(formFocus.passed, true);
  assert.equal(formFocus.checks.some((check) => (
    check.code === INVARIANT_CODES.NO_BLOCKING_PROFILE_PROBLEMS
    && check.passed
    && check.evidence.some((item) => item.metricPath === 'problems.HIGH_INTERACTION_RISK')
  )), true);
});

test('adaptation contract evaluator checks page type before scope role shortcuts', () => {
  const videoAsArticleScope = {
    ...fixtureProfile('video-watch'),
    selectedScope: {
      blockId: 'pretend_article',
      roleHint: BLOCK_ROLES.ARTICLE,
      confidence: 0.9,
      reasons: [],
    },
  };
  const articleAsPlayerScope = {
    ...fixtureProfile('article'),
    selectedScope: {
      blockId: 'pretend_player',
      roleHint: BLOCK_ROLES.PLAYER,
      confidence: 0.9,
      reasons: [],
    },
  };

  const videoResult = evaluateAdaptationContractV1(videoAsArticleScope, ACTIONS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(videoResult.passed, false);
  assert.equal(videoResult.blockingFailures.some((check) => check.code === INVARIANT_CODES.PAGE_TYPE_ALLOWED), true);

  const articleResult = evaluateAdaptationContractV1(articleAsPlayerScope, ACTIONS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(articleResult.passed, false);
  assert.equal(articleResult.blockingFailures.some((check) => check.code === INVARIANT_CODES.SCOPE_ROLE_ALLOWED), true);
});

test('adaptation contract evaluator is deterministic and does not mutate profiles', () => {
  const profile = fixtureProfile('article');
  const before = clone(profile);

  const first = evaluateAdaptationContractV1(profile, ACTIONS.READING_COMFORT_TYPOGRAPHY);
  const second = evaluateAdaptationContractV1(profile, ACTIONS.READING_COMFORT_TYPOGRAPHY);

  assert.deepEqual(second, first);
  assert.deepEqual(profile, before);
});

test('adaptation contract validator rejects unsafe or incoherent contract shapes', () => {
  const contract = byAction(ACTIONS.READING_COMFORT_TYPOGRAPHY);

  const overlappingPages = validateAdaptationContractV1({
    ...contract,
    deniedPageTypes: [...contract.deniedPageTypes, PAGE_TYPES.ARTICLE],
  });
  assert.equal(overlappingPages.ok, false);
  assert.match(messages(overlappingPages), /allowed and denied page types must be disjoint/);

  const overlappingRoles = validateAdaptationContractV1({
    ...contract,
    forbiddenScopeRoles: [...contract.forbiddenScopeRoles, BLOCK_ROLES.ARTICLE],
  });
  assert.equal(overlappingRoles.ok, false);
  assert.match(messages(overlappingRoles), /required and forbidden scope roles must be disjoint/);

  const wrongPhase = validateAdaptationContractV1({
    ...contract,
    preconditions: [{ ...contract.preconditions[0], phase: INVARIANT_PHASES.POST_APPLY }],
  });
  assert.equal(wrongPhase.ok, false);
  assert.match(messages(wrongPhase), /preconditions must be PRE_APPLY/);

  const unsafePlan = validateAdaptationContractV1({
    ...contract,
    applyPlan: { ...contract.applyPlan, cssText: '.x{}' },
  });
  assert.equal(unsafePlan.ok, false);
  assert.match(messages(unsafePlan), /unexpected apply plan field/);

  const unsafeTopLevel = validateAdaptationContractV1({
    ...contract,
    cssText: '.x{}',
  });
  assert.equal(unsafeTopLevel.ok, false);
  assert.match(messages(unsafeTopLevel), /unexpected contract field/);

  const unknownToleratedProblem = validateAdaptationContractV1({
    ...contract,
    toleratedBlockingProblems: ['NOT_A_PROBLEM'],
  });
  assert.equal(unknownToleratedProblem.ok, false);
  assert.match(messages(unknownToleratedProblem), /unknown problem code/);

  const wrongPostPhase = validateAdaptationContractV1({
    ...contract,
    postconditions: [{ ...contract.postconditions[0], phase: INVARIANT_PHASES.PRE_APPLY }],
  });
  assert.equal(wrongPostPhase.ok, false);
  assert.match(messages(wrongPostPhase), /postconditions must be POST_APPLY/);

  const noLearning = validateAdaptationContractV1({
    ...contract,
    learningEligibility: undefined,
  });
  assert.equal(noLearning.ok, false);
  assert.match(messages(noLearning), /expected learning eligibility object/);
});
