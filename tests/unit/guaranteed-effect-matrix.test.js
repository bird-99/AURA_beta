import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getGuaranteedEffectMatrixV1,
  getGuaranteedEffectV1,
  GUARANTEED_EFFECT_MODE_IDS,
  validateGuaranteedEffectMatrixV1,
} from '../../shared/engine-core/guaranteed-effect-matrix.js';
import { PAGE_TYPES, PAGE_TYPE_VALUES, POST_APPLY_CHECK_CODE_VALUES } from '../../shared/engine-core/enums.js';

test('GuaranteedEffectMatrixV1 covers every mode and page type exactly once', () => {
  const result = validateGuaranteedEffectMatrixV1();

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(
    getGuaranteedEffectMatrixV1().length,
    Object.values(GUARANTEED_EFFECT_MODE_IDS).length * PAGE_TYPE_VALUES.length,
  );
});

test('GuaranteedEffectMatrixV1 allows reader reconstruction only for article and doc comfort pages', () => {
  const readerEntries = getGuaranteedEffectMatrixV1().filter((entry) => entry.readerAllowed);

  assert.deepEqual(
    readerEntries.map((entry) => `${entry.modeId}:${entry.pageType}`).sort(),
    [
      `${GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL}:${PAGE_TYPES.ARTICLE}`,
      `${GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL}:${PAGE_TYPES.DOC}`,
    ].sort(),
  );
});

test('GuaranteedEffectMatrixV1 keeps manual override tab-session scoped', () => {
  const entries = getGuaranteedEffectMatrixV1();

  assert.ok(entries.every((entry) => entry.overrideAllowed === true));
  assert.ok(entries.every((entry) => entry.overrideScope === 'TAB_SESSION'));
});

test('GuaranteedEffectMatrixV1 uses known post-apply checks only', () => {
  const entries = getGuaranteedEffectMatrixV1();

  for (const entry of entries) {
    assert.ok(entry.postChecks.length > 0, `${entry.modeId}:${entry.pageType} must declare checks`);
    for (const check of entry.postChecks) {
      assert.ok(
        POST_APPLY_CHECK_CODE_VALUES.includes(check),
        `${entry.modeId}:${entry.pageType} uses unknown check ${check}`,
      );
    }
  }

  const bad = getGuaranteedEffectMatrixV1();
  bad[0].postChecks = ['NOT_A_CHECK'];
  const result = validateGuaranteedEffectMatrixV1(bad);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Unknown postCheck/);
});

test('GuaranteedEffectMatrixV1 defines strong and downgrade effects for unknown pages', () => {
  const comfort = getGuaranteedEffectV1(GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL, PAGE_TYPES.UNKNOWN);
  const focus = getGuaranteedEffectV1(GUARANTEED_EFFECT_MODE_IDS.FOCUS, PAGE_TYPES.UNKNOWN);

  assert.equal(comfort.strongEffect, 'GLOBAL_VISIBLE_TEXT_LINK_CLARITY');
  assert.equal(comfort.safeDowngrade, 'SAFE_GLOBAL_TEXT_LINK_CLARITY');
  assert.equal(focus.strongEffect, 'UNKNOWN_PAGE_DIM_AND_CLARIFY');
  assert.equal(focus.safeDowngrade, 'SAFE_GLOBAL_FOCUS_VISIBLE');
  assert.equal(comfort.limitedLabelOnDowngrade, true);
  assert.equal(focus.limitedLabelOnDowngrade, true);
});
