import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODE_IDS } from '../../shared/constants.js';
import { getExclusivePeerModeId } from '../../shared/mode-exclusivity.js';

test('getExclusivePeerModeId returns the mapped peer for exclusive modes', () => {
  assert.equal(getExclusivePeerModeId(MODE_IDS.COMFORT_VISUAL), MODE_IDS.FOCUS);
  assert.equal(getExclusivePeerModeId(MODE_IDS.FOCUS), MODE_IDS.COMFORT_VISUAL);
});

test('getExclusivePeerModeId returns null for unknown modes', () => {
  assert.equal(getExclusivePeerModeId('unknown'), null);
});
