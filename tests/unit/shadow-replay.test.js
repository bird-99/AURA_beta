import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  ACTIVE_POLICY_DECISION_KINDS,
  ADAPTATION_ACTION_IDS,
  REASON_CODES,
  SHADOW_COMPARISON_KINDS,
  buildShadowDecisionV1,
  buildShadowPolicySummaryV1,
  buildShadowReplayEventV1,
  compareShadowReplayV1,
  createEmptyShadowReplayStoreV1,
  reduceShadowReplayStoreV1,
  routePageSignalsV1,
  validatePrivacySafeJson,
  validateShadowDecisionV1,
  validateShadowReplayEventV1,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureProfile(name) {
  const file = fs.readdirSync(fixtureDir)
    .find((candidate) => candidate.endsWith('.signals.v1.json') && candidate.startsWith(name));
  assert.ok(file, `missing fixture ${name}`);
  const payload = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
  return routePageSignalsV1(payload.input);
}

function context(actionId, overrides = {}) {
  return {
    schemaVersion: 1,
    actionId,
    source: ACTION_CONTEXT_SOURCES.USER_REQUEST,
    userExplicit: true,
    autoApplyCandidate: false,
    ...overrides,
  };
}

function activeSummary({ kind = ACTIVE_POLICY_DECISION_KINDS.APPLY, actionId = ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY } = {}) {
  return buildShadowPolicySummaryV1({
    modeId: 'comfort-visual',
    actionId,
    decisionKind: kind,
    score: kind === ACTIVE_POLICY_DECISION_KINDS.NOOP ? 0.1 : 0.91,
    reasons: ['TEST_POLICY'],
  });
}

test('shadow replay builds privacy-safe decisions from page-intelligence fixtures', () => {
  const profile = fixtureProfile('article');
  const beforeProfile = clone(profile);
  const actionContext = context(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  const beforeContext = clone(actionContext);

  const shadow = buildShadowDecisionV1(profile, actionContext);
  assert.equal(shadow.policyId, 'ACTION_POLICY_V1');
  assert.match(shadow.profileHash, /^shr1_/);
  assert.equal(shadow.predictedDecision, ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION);
  assert.equal(validateShadowDecisionV1(shadow).ok, true);
  assert.equal(validatePrivacySafeJson(shadow).ok, true);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(actionContext, beforeContext);

  const second = buildShadowDecisionV1(profile, actionContext);
  assert.deepEqual(second, shadow);
});

test('shadow replay preserves specific search and shop reason codes', () => {
  const cases = [
    ['search-results', ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['search-results', ADAPTATION_ACTION_IDS.TARGET_SIZE, REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED],
    ['product-grid', ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY, REASON_CODES.SHOP_PRODUCT_GRID_DETECTED],
  ];

  for (const [fixtureName, actionId, reason] of cases) {
    const shadow = buildShadowDecisionV1(fixtureProfile(fixtureName), context(actionId));
    assert.equal(shadow.predictedDecision, ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION, fixtureName);
    assert.equal(shadow.reasonCodes.includes(reason), true, fixtureName);
    assert.equal(shadow.reasonCodes.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), false, fixtureName);
    assert.equal(validateShadowDecisionV1(shadow).ok, true);
    assert.equal(validatePrivacySafeJson(shadow).ok, true);
  }

  const unknown = buildShadowDecisionV1(
    fixtureProfile('unknown'),
    context(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY),
  );
  assert.equal(unknown.predictedDecision, ACTION_POLICY_DECISIONS.DENY);
  assert.equal(unknown.reasonCodes.includes(REASON_CODES.UNKNOWN_LOW_CONFIDENCE), true);
});

test('shadow replay compares active and shadow decisions without runtime side effects', () => {
  const article = fixtureProfile('article');
  const shadow = buildShadowDecisionV1(article, context(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY));
  const comparison = compareShadowReplayV1(activeSummary(), shadow);

  assert.equal(comparison.comparisonKind, SHADOW_COMPARISON_KINDS.ACTIVE_MORE_AGGRESSIVE);
  assert.equal(comparison.activeWouldApply, true);
  assert.equal(comparison.shadowWouldApply, true);
  assert.equal(comparison.diverged, true);

  const unknown = fixtureProfile('unknown');
  const blocked = buildShadowDecisionV1(unknown, context(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY));
  const noopComparison = compareShadowReplayV1(
    activeSummary({ kind: ACTIVE_POLICY_DECISION_KINDS.NOOP, actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY }),
    blocked,
  );
  assert.equal(noopComparison.comparisonKind, SHADOW_COMPARISON_KINDS.MATCH_NOOP);
  assert.equal(noopComparison.diverged, false);
});

test('shadow replay event and store stay bounded and reject malformed payloads', () => {
  const profile = fixtureProfile('article');
  const shadow = buildShadowDecisionV1(profile, context(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY));
  const event = buildShadowReplayEventV1({
    active: activeSummary({ actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY }),
    shadow,
    nowMs: 1000,
  });

  assert.equal(validateShadowReplayEventV1(event).ok, true);

  let store = createEmptyShadowReplayStoreV1();
  store = reduceShadowReplayStoreV1(store, event, { nowMs: 1000 });
  assert.equal(store.entries.length, 1);

  const malicious = {
    ...event,
    shadow: {
      ...event.shadow,
      rawProfile: { pageUrl: 'https://private.example/path', selector: '#account' },
    },
  };
  const next = reduceShadowReplayStoreV1(store, malicious, { nowMs: 1000 });
  assert.deepEqual(next, store);

  const expired = reduceShadowReplayStoreV1(store, {
    ...event,
    shadowRunId: 'shr1_expiredexpiredexpired1',
    timestampBucket: new Date(0).toISOString(),
  }, { nowMs: 3 * 24 * 60 * 60 * 1000 });
  assert.equal(expired.entries.length, 0);
});
