import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIVATION_STAGES,
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
  SUPPORT_LEVELS,
  findActionRegistryEntryV1,
  getActionRegistryV1,
  listActionRegistryEntriesForModeV1,
  validateActionRegistryEntryV1,
  validateActionRegistryV1,
} from '../../shared/engine-core/index.js';

test('ActionRegistryV1 covers every known internal action without enabling AUTO', () => {
  const registry = getActionRegistryV1();
  const validation = validateActionRegistryV1();

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.deepEqual(
    registry.map((entry) => entry.actionId).sort(),
    Object.values(ADAPTATION_ACTION_IDS).sort(),
  );
  registry.forEach((entry) => {
    assert.notEqual(entry.activationStage, ACTIVATION_STAGES.AUTO);
    assert.equal(entry.requiresCapability, true);
    assert.equal(entry.requiresPostChecks, true);
    assert.equal(entry.defaultPolicy.autoApply, 'DENY');
  });
});

test('ActionRegistryV1 declares the intended PR10 page policies', () => {
  const reading = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY);
  const clarity = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.PAGE_CLARITY);
  const dark = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  const focus = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY);
  const reduceMotion = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.REDUCE_MOTION);
  const targetSize = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.TARGET_SIZE);

  assert.deepEqual(reading.allowedPageTypes, [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC]);
  assert.equal(reading.deniedPageTypes.includes(PAGE_TYPES.SEARCH), true);
  assert.equal(reading.defaultSupportLevel, SUPPORT_LEVELS.NOT_IMPLEMENTED);
  assert.deepEqual(clarity.allowedPageTypes, [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM]);
  assert.equal(clarity.shadowPageTypes.includes(PAGE_TYPES.SHOP), true);
  assert.equal(clarity.deniedPageTypes.includes(PAGE_TYPES.DASHBOARD), true);
  assert.equal(clarity.learningEligibility.positiveLearningAllowed, false);
  assert.equal(clarity.activationStage, ACTIVATION_STAGES.MANUAL_MEDIUM_VERIFIED);
  assert.deepEqual([...dark.allowedPageTypes].sort(), Object.values(PAGE_TYPES).sort());
  assert.deepEqual(dark.shadowPageTypes, []);
  assert.deepEqual(dark.deniedPageTypes, []);
  assert.equal(dark.defaultSupportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
  assert.equal(dark.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
  assert.equal(dark.defaultPolicy.userRequest, 'REQUIRE_POST_APPLY_INSPECTION');
  assert.equal(dark.learningEligibility.positiveLearningAllowed, false);
  assert.equal(focus.allowedPageTypes.includes(PAGE_TYPES.FEED), true);
  assert.equal(focus.shadowPageTypes.includes(PAGE_TYPES.VIDEO), true);
  assert.equal(reduceMotion.activationStage, ACTIVATION_STAGES.SHADOW_ONLY);
  assert.deepEqual(targetSize.allowedPageTypes, [PAGE_TYPES.FORM, PAGE_TYPES.SEARCH]);
  assert.equal(targetSize.shadowPageTypes.includes(PAGE_TYPES.SHOP), true);
  assert.equal(targetSize.shadowPageTypes.includes(PAGE_TYPES.FEED), true);
  assert.equal(targetSize.deniedPageTypes.includes(PAGE_TYPES.VIDEO), true);
  assert.equal(targetSize.activationStage, ACTIVATION_STAGES.MANUAL_LIMITED);
  assert.equal(targetSize.defaultSupportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
});

test('ActionRegistryV1 lists actions per public mode', () => {
  const comfortActions = listActionRegistryEntriesForModeV1('comfort-visual').map((entry) => entry.actionId);
  const focusActions = listActionRegistryEntriesForModeV1('focus').map((entry) => entry.actionId);

  assert.deepEqual(comfortActions.sort(), [
    ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    ADAPTATION_ACTION_IDS.REDUCE_MOTION,
  ].sort());
  assert.deepEqual(focusActions.sort(), [
    ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    ADAPTATION_ACTION_IDS.REDUCE_MOTION,
    ADAPTATION_ACTION_IDS.TARGET_SIZE,
  ].sort());
});

test('ActionRegistryV1 validator rejects unsafe and incoherent action entries', () => {
  const clarity = findActionRegistryEntryV1(ADAPTATION_ACTION_IDS.PAGE_CLARITY);

  assert.equal(validateActionRegistryEntryV1(clarity).ok, true);
  assert.equal(validateActionRegistryEntryV1({ ...clarity, rawText: 'private' }).ok, false);
  assert.equal(validateActionRegistryEntryV1({
    ...clarity,
    learningEligibility: { ...clarity.learningEligibility, positiveLearningAllowed: true },
  }).ok, false);
  assert.equal(validateActionRegistryEntryV1({
    ...clarity,
    activationStage: ACTIVATION_STAGES.AUTO,
  }).ok, false);
});
