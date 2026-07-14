import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
  findModeRegistryEntryV1,
  getModeRegistryV1,
  validateModeRegistryEntryV1,
  validateModeRegistryV1,
} from '../../shared/engine-core/index.js';

test('ModeRegistryV1 declares only the public AURA modes without behavior activation', () => {
  const registry = getModeRegistryV1();
  const validation = validateModeRegistryV1();

  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.deepEqual(registry.map((entry) => entry.modeId).sort(), ['comfort-visual', 'focus']);
  registry.forEach((entry) => {
    assert.equal(entry.version, 1);
    assert.equal(entry.exclusivityGroup, 'visual-adaptation');
    assert.equal(entry.defaultActivation.visibleInPopup, true);
    assert.equal(entry.defaultActivation.autoApplyAllowed, false);
    assert.equal(entry.learningPolicy.requireInspectedOutcome, true);
    assert.equal(entry.learningPolicy.blockLearningForFallback, true);
    assert.ok(entry.internalActions.length > 0);
  });
});

test('ModeRegistryV1 keeps PAGE_CLARITY internal to Comfort and avoids public mode sprawl', () => {
  const comfort = findModeRegistryEntryV1('comfort-visual');
  const focus = findModeRegistryEntryV1('focus');

  assert.ok(comfort);
  assert.ok(focus);
  assert.equal(comfort.publicLabel, 'Comfort Visual');
  assert.equal(focus.publicLabel, 'Focus');
  assert.deepEqual(comfort.internalActions, [
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    ADAPTATION_ACTION_IDS.REDUCE_MOTION,
  ]);
  assert.equal(comfort.forbiddenPageTypes.includes(PAGE_TYPES.UNKNOWN), true);
  assert.equal(focus.internalActions.includes(ADAPTATION_ACTION_IDS.PAGE_CLARITY), false);
});

test('ModeRegistryV1 validator rejects unsafe or incoherent entries', () => {
  const comfort = findModeRegistryEntryV1('comfort-visual');
  assert.equal(validateModeRegistryEntryV1(comfort).ok, true);
  assert.equal(validateModeRegistryEntryV1({ ...comfort, selector: '.main' }).ok, false);
  assert.equal(validateModeRegistryEntryV1({
    ...comfort,
    defaultActivation: { ...comfort.defaultActivation, autoApplyAllowed: true },
  }).ok, false);
  assert.equal(validateModeRegistryEntryV1({
    ...comfort,
    internalActions: ['NOT_A_REAL_ACTION'],
  }).ok, false);
});
