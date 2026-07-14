import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  ADAPTATION_ACTION_IDS,
  INVARIANT_CODES,
  PAGE_TYPES,
  PROBLEM_CODES,
  REASON_CODES,
  evaluateActionPolicyDecisionV1,
  evaluateAdaptationContractV1,
  routePageSignalsV1,
  validateActionPolicyDecisionV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');
const ACTIONS = ADAPTATION_ACTION_IDS;
const DECISIONS = ACTION_POLICY_DECISIONS;
const SOURCES = ACTION_CONTEXT_SOURCES;
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
    .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')));
}

function expectedActionSets(fixture) {
  return {
    allowed: new Set(fixture.expected?.allowedActions || []),
    denied: new Set(fixture.expected?.deniedActions || []),
  };
}

function fixtureProfile(name) {
  const fixture = readFixtures().find((payload) => payload.name === name);
  assert.ok(fixture, `missing fixture ${name}`);
  return routePageSignalsV1(fixture.input);
}

function context(actionId, overrides = {}) {
  return {
    schemaVersion: 1,
    actionId,
    source: SOURCES.USER_REQUEST,
    userExplicit: true,
    autoApplyCandidate: false,
    ...overrides,
  };
}

function messages(validation) {
  return validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

test('action policy converts passing user requests into inspection-gated decisions', () => {
  for (const fixture of readFixtures()) {
    const profile = routePageSignalsV1(fixture.input);
    const { allowed, denied } = expectedActionSets(fixture);

    for (const actionId of ALL_ACTIONS) {
      assert.notEqual(
        allowed.has(actionId),
        denied.has(actionId),
        `${fixture.name} ${actionId} should be declared exactly once as allowed or denied`,
      );
    }

    for (const actionId of allowed) {
      const result = evaluateActionPolicyDecisionV1(profile, context(actionId));

      assert.equal(result.actionId, actionId, `${fixture.name} ${actionId}`);
      assert.equal(result.decision, DECISIONS.REQUIRE_POST_APPLY_INSPECTION, `${fixture.name} ${actionId}`);
      assert.equal(typeof result.selectedScopeId, 'string', `${fixture.name} ${actionId}`);
      assert.equal(result.constraints.postApplyInspectionRequired, true);
      assert.equal(result.constraints.autoApplyAllowed, false);
      assert.equal(result.constraints.scopeRequired, true);
      if (profile.reasons.length > 0) {
        assert.equal(result.reasons.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), false, `${fixture.name} ${actionId}`);
      }
      assert.equal(validateActionPolicyDecisionV1(result).ok, true, messages(validateActionPolicyDecisionV1(result)));
      assert.equal(validatePrivacySafeJson(result).ok, true);
      assert.equal('passed' in result, false, 'PR5 result must not be the PR4 readiness shape');
      assert.equal('blockingFailures' in result, false, 'PR5 result must not expose PR4 internals as the top-level result');
    }
  }
});

test('action policy denies every failed PR4 contract and hides selected scopes on deny', () => {
  for (const fixture of readFixtures()) {
    const profile = routePageSignalsV1(fixture.input);
    const { denied } = expectedActionSets(fixture);

    for (const actionId of denied) {
      const readiness = evaluateAdaptationContractV1(profile, actionId);
      const result = evaluateActionPolicyDecisionV1(profile, context(actionId));

      assert.equal(readiness.passed, false, `${fixture.name} ${actionId} should be blocked by PR4`);
      assert.equal(result.decision, DECISIONS.DENY, `${fixture.name} ${actionId}`);
      assert.equal(result.selectedScopeId, null);
      assert.equal(result.constraints.autoApplyAllowed, false);
      assert.equal(result.reasons.length > 0, true);
    }
  }
});

test('search and shop positive policy reasons are specific, not unknown fallbacks', () => {
  const cases = [
    ['search-results', ACTIONS.FOCUS_VISIBILITY, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['search-results', ACTIONS.TARGET_SIZE, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['product-grid', ACTIONS.FOCUS_VISIBILITY, REASON_CODES.SHOP_PRODUCT_GRID_DETECTED],
  ];

  for (const [fixtureName, actionId, expectedReason] of cases) {
    const profile = fixtureProfile(fixtureName);
    const result = evaluateActionPolicyDecisionV1(profile, context(actionId));

    assert.equal(result.decision, DECISIONS.REQUIRE_POST_APPLY_INSPECTION, `${fixtureName} ${actionId}`);
    assert.equal(result.reasons.includes(expectedReason), true, `${fixtureName} ${actionId}`);
    assert.equal(result.reasons.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), false, `${fixtureName} ${actionId}`);
  }
});

test('search and shop policy fallbacks stay page-specific even when profile reasons are empty', () => {
  const cases = [
    ['search-results', ACTIONS.FOCUS_VISIBILITY, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['search-results', ACTIONS.TARGET_SIZE, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['product-grid', ACTIONS.FOCUS_VISIBILITY, REASON_CODES.SHOP_PRODUCT_GRID_DETECTED],
  ];

  for (const [fixtureName, actionId, expectedReason] of cases) {
    const profile = { ...fixtureProfile(fixtureName), reasons: [] };
    const readiness = evaluateAdaptationContractV1(profile, actionId);
    const result = evaluateActionPolicyDecisionV1(profile, context(actionId));

    assert.equal(readiness.passed, true, `${fixtureName} ${actionId}`);
    assert.equal(readiness.reasons.includes(expectedReason), true, `${fixtureName} ${actionId}`);
    assert.equal(readiness.reasons.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), false, `${fixtureName} ${actionId}`);
    assert.equal(result.decision, DECISIONS.REQUIRE_POST_APPLY_INSPECTION, `${fixtureName} ${actionId}`);
    assert.equal(result.reasons.includes(expectedReason), true, `${fixtureName} ${actionId}`);
    assert.equal(result.reasons.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), false, `${fixtureName} ${actionId}`);
  }
});

test('suggestion and auto-apply contexts never return ALLOW in PR5', () => {
  for (const fixture of readFixtures()) {
    const profile = routePageSignalsV1(fixture.input);
    const { allowed } = expectedActionSets(fixture);

    for (const actionId of allowed) {
      const suggestion = evaluateActionPolicyDecisionV1(
        profile,
        context(actionId, {
          source: SOURCES.SUGGESTION,
          userExplicit: false,
        }),
      );
      assert.equal(suggestion.decision, DECISIONS.SUGGEST_ONLY, `${fixture.name} ${actionId} suggestion`);
      assert.equal(suggestion.constraints.autoApplyAllowed, false);

      const autoCandidate = evaluateActionPolicyDecisionV1(
        profile,
        context(actionId, {
          source: SOURCES.AUTO_APPLY,
          userExplicit: false,
          autoApplyCandidate: true,
        }),
      );
      assert.equal(autoCandidate.decision, DECISIONS.SUGGEST_ONLY, `${fixture.name} ${actionId} auto`);
      assert.equal(autoCandidate.constraints.autoApplyAllowed, false);

      const debug = evaluateActionPolicyDecisionV1(
        profile,
        context(actionId, {
          source: SOURCES.DEBUG,
        }),
      );
      assert.equal(debug.decision, DECISIONS.SUGGEST_ONLY, `${fixture.name} ${actionId} debug`);
      assert.equal(debug.constraints.autoApplyAllowed, false);
    }
  }

  const profile = fixtureProfile('article');

  const invalidAuto = evaluateActionPolicyDecisionV1(
    profile,
    context(ACTIONS.READING_COMFORT_TYPOGRAPHY, {
      source: SOURCES.AUTO_APPLY,
      userExplicit: false,
      autoApplyCandidate: false,
    }),
  );
  assert.equal(invalidAuto.decision, DECISIONS.DENY);
  assert.equal(invalidAuto.selectedScopeId, null);

  const inconsistentAuto = evaluateActionPolicyDecisionV1(
    profile,
    context(ACTIONS.READING_COMFORT_TYPOGRAPHY, {
      source: SOURCES.AUTO_APPLY,
      userExplicit: true,
      autoApplyCandidate: true,
    }),
  );
  assert.equal(inconsistentAuto.decision, DECISIONS.DENY);
  assert.equal(inconsistentAuto.selectedScopeId, null);
});

test('safety shield denies unsafe contexts beyond PR4 readiness', () => {
  const article = fixtureProfile('article');

  const privacyRisk = {
    ...article,
    risk: { ...article.risk, privacyRisk: 0.2 },
  };
  const privacyResult = evaluateActionPolicyDecisionV1(privacyRisk, context(ACTIONS.READING_COMFORT_TYPOGRAPHY));
  assert.equal(privacyResult.decision, DECISIONS.DENY);
  assert.equal(privacyResult.selectedScopeId, null);

  const nonExplicitUserRequest = evaluateActionPolicyDecisionV1(
    article,
    context(ACTIONS.READING_COMFORT_TYPOGRAPHY, { userExplicit: false }),
  );
  assert.equal(nonExplicitUserRequest.decision, DECISIONS.DENY);

  const restoreAttempt = evaluateActionPolicyDecisionV1(
    article,
    context(ACTIONS.READING_COMFORT_TYPOGRAPHY, { source: SOURCES.RESTORE }),
  );
  assert.equal(restoreAttempt.decision, DECISIONS.DENY);

  const unknownLookingValid = {
    ...article,
    pageType: PAGE_TYPES.UNKNOWN,
    problems: [
      { code: PROBLEM_CODES.LOW_CONFIDENCE_PAGE_TYPE, severity: 'WARN', reasons: [] },
    ],
  };
  const unknownResult = evaluateActionPolicyDecisionV1(unknownLookingValid, context(ACTIONS.READING_COMFORT_TYPOGRAPHY));
  assert.equal(unknownResult.decision, DECISIONS.DENY);
});

test('safety shield blocks ambiguous and budget-hit profiles even when PR4 only warns', () => {
  const article = fixtureProfile('article');
  const ambiguous = {
    ...article,
    pageTypeConfidence: 0.54,
    risk: { ...article.risk, confidenceRisk: 0.2 },
  };
  const ambiguousReadiness = evaluateAdaptationContractV1(ambiguous, ACTIONS.READING_COMFORT_TYPOGRAPHY);
  const ambiguousResult = evaluateActionPolicyDecisionV1(ambiguous, context(ACTIONS.READING_COMFORT_TYPOGRAPHY));

  assert.equal(ambiguousReadiness.passed, true);
  assert.equal(ambiguousReadiness.warnings.some((check) => check.code === INVARIANT_CODES.TOP_CANDIDATE_NOT_AMBIGUOUS), true);
  assert.equal(ambiguousResult.decision, DECISIONS.DENY);
  assert.equal(ambiguousResult.selectedScopeId, null);

  const budgetHit = {
    ...article,
    stats: { ...article.stats, budgetHit: true },
  };
  const budgetReadiness = evaluateAdaptationContractV1(budgetHit, ACTIONS.READING_COMFORT_TYPOGRAPHY);
  const budgetResult = evaluateActionPolicyDecisionV1(budgetHit, context(ACTIONS.READING_COMFORT_TYPOGRAPHY));

  assert.equal(budgetReadiness.passed, true);
  assert.equal(budgetResult.decision, DECISIONS.DENY);
  assert.equal(budgetResult.selectedScopeId, null);
});

test('scoped policy denies missing selected scope even when contract role is broad', () => {
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

  const readiness = evaluateAdaptationContractV1(searchWithoutScope, ACTIONS.FOCUS_VISIBILITY);
  const result = evaluateActionPolicyDecisionV1(searchWithoutScope, context(ACTIONS.FOCUS_VISIBILITY));

  assert.equal(readiness.blockingFailures.some((check) => check.code === INVARIANT_CODES.SAFE_SCOPE_REQUIRED), true);
  assert.equal(result.decision, DECISIONS.DENY);
  assert.equal(result.selectedScopeId, null);
});

test('action policy clamps requested strength and preserves decision purity', () => {
  const profile = fixtureProfile('article');
  const highRequest = evaluateActionPolicyDecisionV1(
    profile,
    context(ACTIONS.FOCUS_VISIBILITY, { requestedStrength: 0.95 }),
  );
  const lowRequest = evaluateActionPolicyDecisionV1(
    profile,
    context(ACTIONS.FOCUS_VISIBILITY, { requestedStrength: 0.25 }),
  );

  assert.equal(highRequest.constraints.maxStrength, 0.6);
  assert.equal(lowRequest.constraints.maxStrength, 0.25);
});

test('action policy is deterministic and does not mutate profile or context', () => {
  const profile = fixtureProfile('doc');
  const actionContext = context(ACTIONS.READING_COMFORT_TYPOGRAPHY);
  const beforeProfile = clone(profile);
  const beforeContext = clone(actionContext);

  const first = evaluateActionPolicyDecisionV1(profile, actionContext);
  const second = evaluateActionPolicyDecisionV1(profile, actionContext);

  assert.deepEqual(second, first);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(actionContext, beforeContext);
});

test('action policy validates inputs and rejects runtime-shaped decision payloads', () => {
  const profile = fixtureProfile('article');

  assert.throws(
    () => evaluateActionPolicyDecisionV1(profile, context(ACTIONS.READING_COMFORT_TYPOGRAPHY, { source: 'BOGUS' })),
    /ActionContextV1 validation failed/,
  );

  assert.throws(
    () => evaluateActionPolicyDecisionV1(profile, {
      ...context(ACTIONS.READING_COMFORT_TYPOGRAPHY),
      tabId: 123,
    }),
    /ActionContextV1 validation failed/,
  );

  assert.throws(
    () => evaluateActionPolicyDecisionV1({ ...profile, allowedActions: [ACTIONS.FOCUS_VISIBILITY] }, context(ACTIONS.FOCUS_VISIBILITY)),
    /PageUnderstandingProfileV1 validation failed/,
  );

  const valid = evaluateActionPolicyDecisionV1(profile, context(ACTIONS.FOCUS_VISIBILITY));
  const badRuntimeField = validateActionPolicyDecisionV1({
    ...valid,
    applyPlan: { kind: 'SCOPED_CSS' },
  });
  assert.equal(badRuntimeField.ok, false);
  assert.match(messages(badRuntimeField), /unexpected action policy decision field/);

  const badConstraint = validateActionPolicyDecisionV1({
    ...valid,
    constraints: {
      ...valid.constraints,
      cssInserted: true,
    },
  });
  assert.equal(badConstraint.ok, false);
  assert.match(messages(badConstraint), /unexpected constraints field/);

  const badRisk = validateActionPolicyDecisionV1({
    ...valid,
    risk: {
      ...valid.risk,
      tabId: 123,
    },
  });
  assert.equal(badRisk.ok, false);
  assert.match(messages(badRisk), /unexpected risk field/);

  const denyWithScope = validateActionPolicyDecisionV1({
    ...valid,
    decision: DECISIONS.DENY,
    selectedScopeId: 'leaked_scope',
  });
  assert.equal(denyWithScope.ok, false);
  assert.match(messages(denyWithScope), /DENY decisions must not expose selected scope/);

  const badSelector = validateActionPolicyDecisionV1({
    ...valid,
    selector: 'main',
  });
  assert.equal(badSelector.ok, false);
  assert.match(messages(badSelector), /privacy-forbidden key "selector"|unexpected action policy decision field/);
});
