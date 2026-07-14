import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEARNING_ELIGIBILITY_REASONS,
  evaluateLearningEligibilityV1,
} from '../../shared/engine-core/learning-eligibility.js';

test('learning eligibility requires post-apply pass, user accept and elapsed undo window', () => {
  const result = evaluateLearningEligibilityV1({
    postApplyPassed: true,
    userAccepted: true,
    acceptedAtMs: 1000,
    nowMs: 1090,
    noUndoWindowMs: 90,
  });

  assert.equal(result.learningEligible, true);
  assert.deepEqual(result.reasons, [LEARNING_ELIGIBILITY_REASONS.ELIGIBLE]);
  assert.equal(result.eligibleAtMs, 1090);
});

test('learning eligibility stays blocked while undo window is active', () => {
  const result = evaluateLearningEligibilityV1({
    postApplyPassed: true,
    userAccepted: true,
    acceptedAtMs: 1000,
    nowMs: 1089,
    noUndoWindowMs: 90,
  });

  assert.equal(result.learningEligible, false);
  assert.ok(result.reasons.includes(LEARNING_ELIGIBILITY_REASONS.UNDO_WINDOW_ACTIVE));
});

test('learning eligibility rejects rollback, undo and failed post-apply outcomes', () => {
  const result = evaluateLearningEligibilityV1({
    postApplyPassed: true,
    userAccepted: true,
    userUndid: true,
    rolledBack: true,
    postApplyFailed: true,
    acceptedAtMs: 1000,
    nowMs: 2000,
    noUndoWindowMs: 90,
  });

  assert.equal(result.learningEligible, false);
  assert.ok(result.reasons.includes(LEARNING_ELIGIBILITY_REASONS.USER_UNDID));
  assert.ok(result.reasons.includes(LEARNING_ELIGIBILITY_REASONS.ROLLED_BACK));
  assert.ok(result.reasons.includes(LEARNING_ELIGIBILITY_REASONS.POST_APPLY_FAILED));
});
