import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  PAGE_TYPES,
  TARGET_KINDS,
  buildActionTargetsV1,
  buildRepeatedRecordGroupsV1,
  buildRegionInventoryV1,
  buildVisualRegionGraphLiteV1,
  findActionTargetV1,
  routePageSignalsV1,
  validateActionTargetsV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';
import { readPageIntelligenceFixtures } from '../../scripts/page-understanding-quality-report.mjs';

function targetsFor(name) {
  const fixture = readPageIntelligenceFixtures().find((entry) => entry.name === name);
  assert.ok(fixture, `${name} fixture should exist`);
  const profile = routePageSignalsV1(fixture.input);
  const inventory = buildRegionInventoryV1(profile);
  return {
    profile,
    targets: buildActionTargetsV1(profile, inventory),
  };
}

function pr9TargetsFor(name) {
  const fixture = readPageIntelligenceFixtures().find((entry) => entry.name === name);
  assert.ok(fixture, `${name} fixture should exist`);
  const profile = routePageSignalsV1(fixture.input);
  const baseInventory = buildRegionInventoryV1(profile);
  const graph = buildVisualRegionGraphLiteV1(profile, { signals: fixture.input, inventory: baseInventory });
  const repeatedRecordGroups = buildRepeatedRecordGroupsV1(profile, { graph });
  const inventory = buildRegionInventoryV1(profile, { visualGraph: graph, repeatedRecordGroups });
  return {
    profile,
    graph,
    repeatedRecordGroups,
    targets: buildActionTargetsV1(profile, inventory, { visualGraph: graph, repeatedRecordGroups }),
  };
}

function targetFor(name, actionId) {
  return findActionTargetV1(targetsFor(name).targets, actionId);
}

test('ActionTargetsV1 validates every fixture and covers every known action', () => {
  for (const fixture of readPageIntelligenceFixtures()) {
    const profile = routePageSignalsV1(fixture.input);
    const inventory = buildRegionInventoryV1(profile);
    const targets = buildActionTargetsV1(profile, inventory);

    assert.equal(validateActionTargetsV1(targets).ok, true, fixture.name);
    assert.equal(validatePrivacySafeJson(targets).ok, true, fixture.name);
    assert.equal(targets.version, 1);
    assert.equal(targets.frameId, profile.frameId);
    assert.equal(targets.actionTargets.length, Object.values(ADAPTATION_ACTION_IDS).length);
  }
});

test('ActionTargetsV1 produces primary region targets for representative actions', () => {
  assert.equal(targetFor('article', ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY).targetKind, TARGET_KINDS.READING_REGION);
  assert.equal(targetFor('search-results', ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY).targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(targetFor('form', ADAPTATION_ACTION_IDS.TARGET_SIZE).targetKind, TARGET_KINDS.FORM_REGION);
  assert.equal(targetFor('video-watch', ADAPTATION_ACTION_IDS.REDUCE_MOTION).targetKind, TARGET_KINDS.MEDIA_REGION);
});

test('ActionTargetsV1 can use PR9 repeated record evidence while preserving guardrails', () => {
  for (const name of ['search-results', 'product-grid', 'feed']) {
    const { graph, repeatedRecordGroups, targets } = pr9TargetsFor(name);
    const focus = findActionTargetV1(targets, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);

    assert.equal(repeatedRecordGroups.groups.length >= 1, true, `${name} should have repeated groups`);
    assert.equal(focus.targetKind, TARGET_KINDS.RECORD_REGION);
    assert.equal(focus.regionId !== 'none', true);
    assert.equal(graph.nodes.some((node) => node.sourceBlockId === focus.sourceBlockId), true);
    assert.equal(focus.confidence >= repeatedRecordGroups.groups[0].confidence || focus.confidence > 0, true);
  }

  const unknown = pr9TargetsFor('unknown');
  const unknownFocus = findActionTargetV1(unknown.targets, ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);
  assert.equal(unknownFocus.targetKind, TARGET_KINDS.BASELINE_OR_ABSTAIN);
  assert.equal(unknownFocus.regionId, 'none');
  assert.equal(unknownFocus.decisionHint, 'SAFE_ABSTAIN');
});

test('ActionTargetsV1 marks PAGE_CLARITY Search/Form active manual and keeps other surfaces shadowed', () => {
  const search = targetFor('search-results', ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const form = targetFor('form-simple', ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const shop = targetFor('product-grid', ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const feed = targetFor('feed', ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const dashboard = targetFor('dashboard', ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const unknown = targetFor('unknown', ADAPTATION_ACTION_IDS.PAGE_CLARITY);

  assert.equal(search.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(search.effectClass, EFFECT_CLASSES.RECORD_CARD_CLARITY);
  assert.equal(search.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(form.targetKind, TARGET_KINDS.FORM_REGION);
  assert.equal(form.effectClass, EFFECT_CLASSES.FORM_LABEL_CLARITY);
  assert.equal(form.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(shop.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(shop.decisionHint, 'SHADOW_ONLY');
  assert.equal(feed.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(feed.decisionHint, 'SHADOW_ONLY');
  assert.equal(dashboard.targetKind, TARGET_KINDS.DASHBOARD_REGION);
  assert.equal(dashboard.decisionHint, 'INTENTIONAL_DENY_SHADOW');
  assert.equal(unknown.targetKind, TARGET_KINDS.BASELINE_OR_ABSTAIN);
  assert.equal(unknown.regionId, 'none');
  assert.equal(unknown.decisionHint, 'SAFE_ABSTAIN');
});

test('ActionTargetsV1 marks TARGET_SIZE active only for Search/Form first surfaces', () => {
  const search = targetFor('search-results', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const form = targetFor('form-simple', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const shop = targetFor('product-grid', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const feed = targetFor('feed', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const article = targetFor('article', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const dashboard = targetFor('dashboard', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const video = targetFor('video-watch', ADAPTATION_ACTION_IDS.TARGET_SIZE);
  const unknown = targetFor('unknown', ADAPTATION_ACTION_IDS.TARGET_SIZE);

  assert.equal(search.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(search.effectClass, EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT);
  assert.equal(search.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(form.targetKind, TARGET_KINDS.FORM_REGION);
  assert.equal(form.effectClass, EFFECT_CLASSES.TARGET_SIZE_ADJUSTMENT);
  assert.equal(form.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(shop.decisionHint, 'SHADOW_ONLY');
  assert.equal(feed.decisionHint, 'SHADOW_ONLY');
  assert.equal(article.targetKind, TARGET_KINDS.BASELINE_OR_ABSTAIN);
  assert.equal(article.decisionHint, 'UNSUPPORTED_PAGE_ABSTAIN');
  assert.equal(dashboard.decisionHint, 'INTENTIONAL_DENY_SHADOW');
  assert.equal(video.decisionHint, 'INTENTIONAL_DENY_SHADOW');
  assert.equal(unknown.decisionHint, 'SAFE_ABSTAIN');
});

test('ActionTargetsV1 marks dark comfort theme active manual on every page type', () => {
  const article = targetFor('article', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const search = targetFor('search-results', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const form = targetFor('form-simple', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const dashboard = targetFor('dashboard', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const video = targetFor('video-watch', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const unknown = targetFor('unknown', ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);

  assert.equal(article.targetKind, TARGET_KINDS.READING_REGION);
  assert.equal(article.effectClass, EFFECT_CLASSES.DARK_THEME_ADAPTATION);
  assert.equal(article.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(search.targetKind, TARGET_KINDS.RECORD_REGION);
  assert.equal(search.effectClass, EFFECT_CLASSES.DARK_THEME_ADAPTATION);
  assert.equal(search.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(form.targetKind, TARGET_KINDS.FORM_REGION);
  assert.equal(form.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(dashboard.targetKind, TARGET_KINDS.DASHBOARD_REGION);
  assert.equal(dashboard.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(video.targetKind, TARGET_KINDS.MEDIA_REGION);
  assert.equal(video.decisionHint, 'ACTIVE_MANUAL');
  assert.equal(unknown.targetKind, TARGET_KINDS.BASELINE_OR_ABSTAIN);
  assert.equal(unknown.regionId, 'none');
  assert.equal(unknown.effectClass, EFFECT_CLASSES.DARK_THEME_ADAPTATION);
  assert.equal(unknown.decisionHint, 'ACTIVE_MANUAL');
});

test('ActionTargetsV1 abstains Reading Comfort outside article/doc instead of reusing Page Clarity evidence', () => {
  const formReading = targetFor('form', ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);

  assert.equal(formReading.targetKind, TARGET_KINDS.BASELINE_OR_ABSTAIN);
  assert.equal(formReading.regionId, 'none');
  assert.equal(formReading.decisionHint, 'UNSUPPORTED_PAGE_ABSTAIN');
  assert.equal(formReading.effectClass, EFFECT_CLASSES.NOOP);
});

test('ActionTargetsV1 rejects runtime and privacy-shaped payloads', () => {
  const { targets } = targetsFor('article');

  assert.equal(validateActionTargetsV1({ ...targets, cssText: '.a{}' }).ok, false);
  assert.equal(validateActionTargetsV1({
    ...targets,
    actionTargets: [{ ...targets.actionTargets[0], element: { nodeType: 1, tagName: 'MAIN' } }],
  }).ok, false);
});
