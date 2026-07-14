import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  applyScopedModeV2 as applyScopedModeV2FromCssApplier,
  getScopedModeV2State as getScopedModeV2StateFromCssApplier,
} from '../../background/css-applier.js';
import {
  applyScopedModeV2,
  deleteScopedModeV2State,
  getScopedModeV2State,
  scopedV2InFlightKeyToString,
  scopedV2KeyToString,
} from '../../background/scoped-v2-state.js';
import { MODE_IDS } from '../../shared/constants.js';
import { MODE_ENGINE_SCOPE_SELECTOR, SCOPE_OWNER_VALUE } from '../../shared/mode-engine-scoped-v2.js';

const cleanupKeys = [];

function trackState(tabId, frameId = 0) {
  cleanupKeys.push({ tabId, frameId });
}

afterEach(() => {
  for (const key of cleanupKeys) {
    deleteScopedModeV2State(key.tabId, key.frameId);
  }
  cleanupKeys.length = 0;
});

test('scoped v2 state stores and dedupes applied css by tab and frame', () => {
  trackState(9001, 5);

  const first = applyScopedModeV2({
    tabId: 9001,
    frameId: 5,
    cssId: 'css-a',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
    tokens: { '--aura-token': '1' },
  });

  assert.equal(first.ok, true);
  assert.equal(first.applied, true);
  assert.equal(first.state.cssId, 'css-a');
  assert.equal(first.state.modeId, MODE_IDS.COMFORT_VISUAL);
  assert.equal(first.state.scopeSelector, MODE_ENGINE_SCOPE_SELECTOR);
  assert.deepEqual(first.state.ownedTokenKeys, ['--aura-token']);
  assert.equal(first.state.owner, SCOPE_OWNER_VALUE);
  assert.equal(typeof first.state.lastAppliedHash, 'string');
  assert.equal(typeof first.state.lastAppliedAtMs, 'number');
  assert.equal(getScopedModeV2State(9001, 5), first.state);

  const duplicate = applyScopedModeV2({
    tabId: 9001,
    frameId: 5,
    cssId: 'css-a',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
    tokens: { '--aura-token': '1' },
  });

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.state, first.state);
});

test('css-applier historical state exports share the extracted scoped v2 state', () => {
  trackState(9002);

  const applied = applyScopedModeV2FromCssApplier({
    tabId: 9002,
    cssId: 'css-b',
    modeId: MODE_IDS.FOCUS,
    scopeSelector: 'main[data-aura-scope="1"]',
    cssText: 'main[data-aura-scope="1"] { outline: 0; }',
  });

  assert.equal(applied.ok, true);
  assert.equal(getScopedModeV2State(9002, 0), applied.state);
  assert.equal(getScopedModeV2StateFromCssApplier(9002, 0), applied.state);

  assert.equal(deleteScopedModeV2State(9002, 0), true);
  assert.equal(getScopedModeV2StateFromCssApplier(9002, 0), null);
});

test('scoped v2 key helpers keep frame identity and mode-specific in-flight identity', () => {
  const key = { tabId: 11, frameId: 3 };

  assert.equal(scopedV2KeyToString(key), '11:3');
  assert.equal(scopedV2InFlightKeyToString(key, MODE_IDS.COMFORT_VISUAL), `11:3:${MODE_IDS.COMFORT_VISUAL}`);
  assert.equal(scopedV2InFlightKeyToString(key, MODE_IDS.FOCUS), `11:3:${MODE_IDS.FOCUS}`);
  assert.notEqual(
    scopedV2InFlightKeyToString(key, MODE_IDS.COMFORT_VISUAL),
    scopedV2InFlightKeyToString(key, MODE_IDS.FOCUS),
  );
});
