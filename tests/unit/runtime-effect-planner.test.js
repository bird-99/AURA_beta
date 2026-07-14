import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ACTION_CONTEXT_SOURCES,
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  buildRuntimeEffectPlanV1,
  evaluateActionPolicyDecisionV1,
  getGuaranteedEffectV1,
  routePageSignalsV1,
  validatePrivacySafeJson,
  validateRuntimeEffectPlanV1,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');
const MODE_ACTIONS = Object.freeze({
  'comfort-visual': ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
  focus: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
});

function readFixtures() {
  return fs.readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.signals.v1.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')));
}

function actionContext(actionId) {
  return {
    schemaVersion: 1,
    actionId,
    source: ACTION_CONTEXT_SOURCES.USER_REQUEST,
    userExplicit: true,
    autoApplyCandidate: false,
  };
}

function messages(validation) {
  return validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

test('RuntimeEffectPlanV1 maps every fixture page type and mode to the matrix row', () => {
  for (const fixture of readFixtures()) {
    const profile = routePageSignalsV1(fixture.input);

    for (const [modeId, actionId] of Object.entries(MODE_ACTIONS)) {
      const policy = evaluateActionPolicyDecisionV1(profile, actionContext(actionId));
      const plan = buildRuntimeEffectPlanV1({ modeId, profile, actionPolicyDecision: policy });
      const row = getGuaranteedEffectV1(modeId, profile.pageType);
      const validation = validateRuntimeEffectPlanV1(plan);

      assert.equal(validation.ok, true, messages(validation));
      assert.equal(validatePrivacySafeJson(plan).ok, true, `${fixture.name} ${modeId} plan must be privacy-safe`);
      assert.equal(plan.modeId, modeId, `${fixture.name} ${modeId}`);
      assert.equal(plan.actionId, actionId, `${fixture.name} ${modeId}`);
      assert.equal(plan.pageType, profile.pageType, `${fixture.name} ${modeId}`);
      assert.equal(plan.frameId, profile.frameId, `${fixture.name} ${modeId}`);
      assert.equal(plan.strongEffect, row.strongEffect, `${fixture.name} ${modeId}`);
      assert.equal(plan.safeDowngrade, row.safeDowngrade, `${fixture.name} ${modeId}`);
      assert.equal(plan.readerAllowed, row.readerAllowed, `${fixture.name} ${modeId}`);
      assert.equal(plan.overrideScope, 'TAB_SESSION', `${fixture.name} ${modeId}`);
      assert.deepEqual(plan.postChecks, row.postChecks, `${fixture.name} ${modeId}`);
      assert.equal(plan.policyDecision, policy.decision, `${fixture.name} ${modeId}`);
    }
  }
});

test('RuntimeEffectPlanV1 does not mutate profile or policy decision inputs', () => {
  const fixture = readFixtures().find((entry) => entry.name === 'article');
  const profile = routePageSignalsV1(fixture.input);
  const policy = evaluateActionPolicyDecisionV1(
    profile,
    actionContext(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY),
  );
  const beforeProfile = JSON.parse(JSON.stringify(profile));
  const beforePolicy = JSON.parse(JSON.stringify(policy));

  buildRuntimeEffectPlanV1({ modeId: 'comfort-visual', profile, actionPolicyDecision: policy });

  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(policy, beforePolicy);
});

test('RuntimeEffectPlanV1 can include compact V3-light shadow capability metadata', () => {
  const fixture = readFixtures().find((entry) => entry.name === 'search-results');
  const profile = routePageSignalsV1(fixture.input);
  const policy = evaluateActionPolicyDecisionV1(
    profile,
    actionContext(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY),
  );
  const plan = buildRuntimeEffectPlanV1({
    modeId: 'focus',
    profile,
    actionPolicyDecision: policy,
    includeV3LightShadow: true,
  });

  assert.equal(validateRuntimeEffectPlanV1(plan).ok, true);
  assert.equal(validatePrivacySafeJson(plan).ok, true);
  assert.deepEqual(Object.keys(plan.v3LightShadow).sort(), [
    'actionId',
    'actionTargetConfidence',
    'actionTargetDecisionHint',
    'activationStage',
    'activePlanAllowed',
    'capabilityStatus',
    'collectionEpoch',
    'desiredEffect',
    'effectClass',
    'executor',
    'regionId',
    'routeEpoch',
    'shadowOnly',
    'sourceBlockId',
    'supportLevel',
    'targetKind',
    'version',
  ].sort());
  assert.equal(plan.v3LightShadow.version, 1);
  assert.equal(plan.v3LightShadow.actionId, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);
  assert.equal(plan.v3LightShadow.targetKind, 'RECORD_REGION');
  assert.equal(plan.v3LightShadow.effectClass, 'FOCUS_VISIBLE_CLARITY');
  assert.equal(plan.v3LightShadow.capabilityStatus, 'SUPPORTED');
  assert.equal(plan.v3LightShadow.supportLevel, 'ACTIVE_RUNTIME');
  assert.equal(plan.v3LightShadow.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
  assert.equal(plan.v3LightShadow.executor, 'SAFE_DOWNGRADE_CSS');
  assert.equal(plan.v3LightShadow.activePlanAllowed, true);
  assert.equal(plan.v3LightShadow.actionTargetDecisionHint, 'CANDIDATE_TARGET');
  assert.equal(plan.v3LightShadow.sourceBlockId.startsWith('b'), true);
  assert.equal(plan.v3LightShadow.regionId.startsWith('r'), true);
  assert.match(plan.v3LightShadow.collectionEpoch, /^aura_pse_collection_/);
  assert.match(plan.v3LightShadow.routeEpoch, /^aura_pse_route_/);
  assert.equal(plan.v3LightShadow.shadowOnly, true);
});

test('RuntimeEffectPlanV1 V3-light shadow does not activate unsupported capability gaps', () => {
  const fixture = readFixtures().find((entry) => entry.name === 'product-grid');
  const profile = routePageSignalsV1(fixture.input);
  const policy = evaluateActionPolicyDecisionV1(
    profile,
    actionContext(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY),
  );
  const plan = buildRuntimeEffectPlanV1({
    modeId: 'comfort-visual',
    profile,
    actionPolicyDecision: policy,
    includeV3LightShadow: true,
  });

  assert.equal(validateRuntimeEffectPlanV1(plan).ok, true);
  assert.equal(plan.actionId, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(plan.v3LightShadow.actionId, ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  assert.equal(plan.v3LightShadow.capabilityStatus, 'CAPABILITY_MISSING');
  assert.equal(plan.v3LightShadow.activationStage, ACTIVATION_STAGES.REPORT_ONLY);
  assert.equal(plan.v3LightShadow.activePlanAllowed, false);
  assert.equal(plan.v3LightShadow.shadowOnly, true);

  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes('rawSignals'), false);
  assert.equal(serialized.includes('candidates'), false);
  assert.equal(serialized.includes('regions'), false);
  assert.equal(serialized.includes('actionTargets'), false);
  assert.equal(serialized.includes('https://'), false);
});

test('RuntimeEffectPlanV1 fails closed for unsupported mode rows', () => {
  const fixture = readFixtures().find((entry) => entry.name === 'article');
  const profile = routePageSignalsV1(fixture.input);
  const policy = evaluateActionPolicyDecisionV1(
    profile,
    actionContext(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY),
  );

  assert.throws(
    () => buildRuntimeEffectPlanV1({ modeId: 'unknown-mode', profile, actionPolicyDecision: policy }),
    /No guaranteed effect row/,
  );
});
