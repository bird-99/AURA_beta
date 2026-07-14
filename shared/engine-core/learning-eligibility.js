export const LEARNING_ELIGIBILITY_REASONS = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  POST_APPLY_NOT_PASSED: 'POST_APPLY_NOT_PASSED',
  USER_ACCEPT_MISSING: 'USER_ACCEPT_MISSING',
  UNDO_WINDOW_ACTIVE: 'UNDO_WINDOW_ACTIVE',
  USER_UNDID: 'USER_UNDID',
  ROLLED_BACK: 'ROLLED_BACK',
  POST_APPLY_FAILED: 'POST_APPLY_FAILED',
});

function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function evaluateLearningEligibilityV1({
  postApplyPassed = false,
  userAccepted = false,
  userUndid = false,
  rolledBack = false,
  postApplyFailed = false,
  acceptedAtMs = 0,
  nowMs = 0,
  noUndoWindowMs = 90000,
} = {}) {
  const reasons = [];
  const acceptedAt = finiteNumber(acceptedAtMs, 0);
  const now = finiteNumber(nowMs, 0);
  const undoMs = Math.max(0, finiteNumber(noUndoWindowMs, 90000));

  if (postApplyPassed !== true) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.POST_APPLY_NOT_PASSED);
  }
  if (userAccepted !== true) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.USER_ACCEPT_MISSING);
  }
  if (now < acceptedAt + undoMs) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.UNDO_WINDOW_ACTIVE);
  }
  if (userUndid === true) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.USER_UNDID);
  }
  if (rolledBack === true) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.ROLLED_BACK);
  }
  if (postApplyFailed === true) {
    reasons.push(LEARNING_ELIGIBILITY_REASONS.POST_APPLY_FAILED);
  }

  return {
    learningEligible: reasons.length === 0,
    reasons: reasons.length === 0 ? [LEARNING_ELIGIBILITY_REASONS.ELIGIBLE] : reasons,
    eligibleAtMs: acceptedAt + undoMs,
  };
}
