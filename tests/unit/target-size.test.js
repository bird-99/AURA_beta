import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildTargetSizeClassRuleV1,
  buildTargetSizeCssV1,
  TARGET_SIZE_CLASS,
  TARGET_SIZE_MIN_PX,
} from '../../background/target-size-css.js';
import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  desiredEffectForActionTargetV1,
  evaluateRuntimeCapabilityV1,
  findActionRegistryEntryV1,
} from '../../shared/engine-core/index.js';

function targetSizeDecision(pageType, targetKind) {
  return evaluateRuntimeCapabilityV1({
    modeId: 'focus',
    actionId: ADAPTATION_ACTION_IDS.TARGET_SIZE,
    pageType,
    targetKind,
    effectClass: EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT,
    desiredEffect: desiredEffectForActionTargetV1(ADAPTATION_ACTION_IDS.TARGET_SIZE, pageType),
  });
}

test('Target Size registry is limited to manual FORM and SEARCH runtime first', () => {
  const entry = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.TARGET_SIZE);

  assert.deepEqual(entry.allowedPageTypes, [PAGE_TYPES.FORM, PAGE_TYPES.SEARCH]);
  assert.equal(entry.shadowPageTypes.includes(PAGE_TYPES.SHOP), true);
  assert.equal(entry.shadowPageTypes.includes(PAGE_TYPES.FEED), true);
  assert.equal(entry.deniedPageTypes.includes(PAGE_TYPES.DASHBOARD), true);
  assert.equal(entry.deniedPageTypes.includes(PAGE_TYPES.VIDEO), true);
  assert.equal(entry.deniedPageTypes.includes(PAGE_TYPES.WEB_APP), true);
  assert.equal(entry.deniedPageTypes.includes(PAGE_TYPES.UNKNOWN), true);
  assert.deepEqual(entry.effectClasses, [EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT]);
  assert.equal(entry.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
  assert.equal(entry.learningEligibility.positiveLearningAllowed, false);
});

test('Target Size capability supports only FORM and SEARCH active limited runtime', () => {
  const search = targetSizeDecision(PAGE_TYPES.SEARCH, TARGET_KINDS.RECORD_REGION);
  const form = targetSizeDecision(PAGE_TYPES.FORM, TARGET_KINDS.FORM_REGION);
  const shop = targetSizeDecision(PAGE_TYPES.SHOP, TARGET_KINDS.RECORD_REGION);
  const dashboard = targetSizeDecision(PAGE_TYPES.DASHBOARD, TARGET_KINDS.DASHBOARD_REGION);
  const unknown = targetSizeDecision(PAGE_TYPES.UNKNOWN, TARGET_KINDS.BASELINE_OR_ABSTAIN);

  for (const decision of [search, form]) {
    assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
    assert.equal(decision.executor, RUNTIME_EXECUTORS.SCOPED_V2);
    assert.equal(decision.activePlanAllowed, true);
    assert.equal(decision.learningEligible, false);
  }

  assert.equal(shop.status, CAPABILITY_STATUSES.CAPABILITY_MISSING);
  assert.equal(dashboard.status, CAPABILITY_STATUSES.INTENTIONAL_DENY);
  assert.equal(unknown.status, CAPABILITY_STATUSES.SAFE_ABSTAIN);
});

test('Target Size CSS is scoped, bounded and keeps focus visible without layout positioning', () => {
  const rule = buildTargetSizeClassRuleV1('[data-aura-scope="1"]');
  const result = buildTargetSizeCssV1({ pageType: PAGE_TYPES.FORM, scopeSelector: '[data-aura-scope="1"]' });
  const denied = buildTargetSizeCssV1({ pageType: PAGE_TYPES.DASHBOARD });

  assert.equal(result.ok, true);
  assert.equal(result.cssText, rule);
  assert.match(rule, new RegExp(`\\.${TARGET_SIZE_CLASS}`));
  assert.match(rule, new RegExp(`min-inline-size: ${TARGET_SIZE_MIN_PX}px`));
  assert.match(rule, new RegExp(`min-block-size: ${TARGET_SIZE_MIN_PX}px`));
  assert.match(rule, /max-inline-size: 100%/);
  assert.match(rule, /box-sizing: border-box/);
  assert.match(rule, /:focus-visible/);
  assert.doesNotMatch(rule, /\bposition\s*:/i);
  assert.doesNotMatch(rule, /\bdisplay\s*:\s*none/i);
  assert.doesNotMatch(rule, /\boverflow-x\s*:\s*scroll/i);
  assert.equal(denied.ok, false);
  assert.equal(denied.cssText, '');
});
