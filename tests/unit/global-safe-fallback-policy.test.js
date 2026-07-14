import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractGlobalSafeFallbackTokens,
  GLOBAL_SAFE_FALLBACK_HARD_DENY_TOKENS,
  GLOBAL_SAFE_FALLBACK_REASON_TOKENS,
  GLOBAL_SAFE_FALLBACK_VARIANT,
  shouldApplyFocusLimitedFallback,
  shouldApplyGlobalSafeFallback,
} from '../../background/global-safe-fallback-policy.js';

test('GLOBAL_SAFE_FALLBACK_VARIANT is stable for state and registry metadata', () => {
  assert.equal(GLOBAL_SAFE_FALLBACK_VARIANT, 'GLOBAL_SAFE_FALLBACK');
});

['ROOT_SELECTOR_NON_UNIQUE', 'ROOT_TOO_LARGE', 'SANITY_CHECK_FAILED'].forEach((reason) => {
  test(`Focus LIMITED accepts recoverable scoped failure ${reason}`, () => {
    assert.equal(shouldApplyFocusLimitedFallback({ reason }), true);
  });
});

['NO_RECEIVER', 'INVALID_DOCUMENT', 'EXT_CONTEXT_INVALID'].forEach((reason) => {
  test(`Focus LIMITED stays closed for unverifiable failure ${reason}`, () => {
    assert.equal(shouldApplyFocusLimitedFallback({ reason, detail: 'LOW_SCORE' }), false);
  });
});

test('extractGlobalSafeFallbackTokens normalizes case and separators', () => {
  assert.deepEqual(
    extractGlobalSafeFallbackTokens('low_score, v2-disabled; top-candidates-ambiguous'),
    ['LOW_SCORE', 'V2_DISABLED', 'TOP_CANDIDATES_AMBIGUOUS'],
  );
});

[
  'AMBIGUOUS,v2-none',
  'TOP_CANDIDATES_AMBIGUOUS,v2-none',
  'LOW_SCORE,v2-none',
  'NO_CANDIDATES_FOUND,v2-none',
  'NO_VALID_CANDIDATE,v2-none',
  'TIME_BUDGET_EXCEEDED',
].forEach((detail) => {
  test(`shouldApplyGlobalSafeFallback allows safe no-scope detail ${detail}`, () => {
    assert.equal(shouldApplyGlobalSafeFallback({ reason: 'NO_SCOPE', detail }), true);
  });
});

GLOBAL_SAFE_FALLBACK_REASON_TOKENS.forEach((token) => {
  test(`shouldApplyGlobalSafeFallback allows exported safe token ${token}`, () => {
    assert.equal(shouldApplyGlobalSafeFallback({ reason: 'NO_SCOPE', detail: `${token},v2-none` }), true);
  });
});

GLOBAL_SAFE_FALLBACK_HARD_DENY_TOKENS.forEach((token) => {
  test(`shouldApplyGlobalSafeFallback hard-denies exported token ${token}`, () => {
    assert.equal(shouldApplyGlobalSafeFallback({ reason: 'NO_SCOPE', detail: `LOW_SCORE,${token}` }), false);
  });
});

test('shouldApplyGlobalSafeFallback accepts details alias from older callers', () => {
  assert.equal(shouldApplyGlobalSafeFallback({ reason: 'NO_SCOPE', details: 'LOW_SCORE,v2-none' }), true);
});

test('shouldApplyGlobalSafeFallback allows generic no-scope reason when detail includes safe token', () => {
  assert.equal(shouldApplyGlobalSafeFallback({ reason: 'NO_SCOPE', detail: 'NONE,LOW_SCORE' }), true);
});

[
  { reason: 'SCOPE_REJECTED', detail: 'LOW_SCORE' },
  { error: 'NO_RECEIVER', detail: 'LOW_SCORE' },
  { reason: 'NO_SCOPE', detail: '' },
  { reason: 'NO_SCOPE', detail: 'NONE,v2-none' },
  { reason: 'NO_SCOPE', detail: 'LOW_SCORE,UNEXPECTED_ERROR,v2-none' },
  { reason: 'NO_SCOPE', detail: 'TIME_BUDGET_EXCEEDED,smartscope-failed' },
  { reason: 'NO_SCOPE', detail: 'NO_CANDIDATES_FOUND,invalid-document' },
  { reason: 'NO_SCOPE', detail: 'LOW_SCORE,root-too-large' },
  { reason: 'NO_SCOPE', detail: 'NO_CANDIDATE,v2-none' },
].forEach((result) => {
  test(`shouldApplyGlobalSafeFallback denies ${JSON.stringify(result)}`, () => {
    assert.equal(shouldApplyGlobalSafeFallback(result), false);
  });
});
