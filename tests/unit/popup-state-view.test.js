import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getModeVisualState,
  getPopupStatusView,
  isRestoreFailedState,
  isRetryableRestoreState,
} from '../../popup/popup-state-view.js';
import { ACTIVE_QUALITIES, STATES } from '../../shared/constants.js';

test('getModeVisualState treats restore CSS removal failure as retryable active control', () => {
  const state = {
    state: STATES.ERROR,
    cssId: 'css-1',
    smartScopeStatus: {
      action: 'restore',
      ok: false,
      error: 'RESTORE_CSS_REMOVE_FAILED',
    },
  };

  assert.equal(isRestoreFailedState(state), true);
  assert.equal(isRetryableRestoreState(state), true);
  assert.deepEqual(getModeVisualState(state), {
    isActive: true,
    restoreFailed: true,
    limitedFallback: false,
    mediumVerified: false,
    chipLabel: 'RESTORE FAILED',
    chipTitle: 'Restore failed. Retry cleanup.',
    ariaAction: 'Retry restore for',
    liveState: 'restore failed. Retry restore.',
  });
});

test('getModeVisualState requires a preserved cleanup handle for restore retry', () => {
  const visual = getModeVisualState({
    state: STATES.ERROR,
    smartScopeStatus: {
      action: 'restore',
      ok: false,
      retryable: true,
      error: 'RESTORE_CSS_REMOVE_FAILED',
    },
  });

  assert.equal(visual.isActive, false);
  assert.equal(visual.restoreFailed, false);
  assert.equal(visual.chipLabel, 'OFF');
});

test('getModeVisualState labels global safe fallback as limited', () => {
  const visual = getModeVisualState({
    state: STATES.ACTIVE,
    activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
    smartScope: { fallbackDetail: 'LOW_SCORE' },
  });

  assert.equal(visual.isActive, true);
  assert.equal(visual.restoreFailed, false);
  assert.equal(visual.limitedFallback, true);
  assert.equal(visual.chipLabel, 'LIMITED');
  assert.equal(visual.chipTitle, 'Limited safe effect: LOW_SCORE');
  assert.equal(visual.liveState, 'enabled in limited fallback mode: LOW_SCORE');
});

test('getModeVisualState labels verified PAGE_CLARITY medium separately from limited fallback', () => {
  const visual = getModeVisualState({
    state: STATES.ACTIVE,
    activeQuality: ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED,
    smartScope: { fallbackDetail: 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW' },
  });

  assert.equal(visual.isActive, true);
  assert.equal(visual.restoreFailed, false);
  assert.equal(visual.limitedFallback, false);
  assert.equal(visual.mediumVerified, true);
  assert.equal(visual.chipLabel, 'MEDIUM');
  assert.equal(visual.chipTitle, 'Verified medium effect: PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW');
  assert.equal(visual.liveState, 'enabled with verified medium effect: PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW');
});

test('getModeVisualState allows explicit retryable restore status with a cleanup handle', () => {
  const visual = getModeVisualState({
    state: STATES.ERROR,
    scopedV2: { scopeId: 'scope-1' },
    smartScopeStatus: {
      action: 'restore',
      ok: false,
      retryable: true,
      error: 'RESTORE_FAILED',
    },
  });

  assert.equal(visual.isActive, true);
  assert.equal(visual.restoreFailed, true);
  assert.equal(visual.chipLabel, 'RESTORE FAILED');
});

test('getModeVisualState keeps generic errors off', () => {
  const visual = getModeVisualState({
    state: STATES.ERROR,
    cssId: 'css-1',
    smartScopeStatus: {
      action: 'apply',
      ok: false,
      error: 'NO_SCOPE',
    },
  });

  assert.equal(visual.isActive, false);
  assert.equal(visual.restoreFailed, false);
  assert.equal(visual.chipLabel, 'OFF');
});

test('getModeVisualState does not treat retryable apply errors as restore retry', () => {
  const visual = getModeVisualState({
    state: STATES.ERROR,
    cssId: 'css-1',
    smartScopeStatus: {
      action: 'apply',
      ok: false,
      retryable: true,
      error: 'INSERT_CSS_FAILED',
    },
  });

  assert.equal(visual.isActive, false);
  assert.equal(visual.restoreFailed, false);
  assert.equal(visual.chipLabel, 'OFF');
});

test('getPopupStatusView prioritizes restore failure over active and degraded states', () => {
  const view = getPopupStatusView([
    { state: STATES.ACTIVE },
    { state: STATES.DEGRADED },
    {
      state: STATES.ERROR,
      cssId: 'css-1',
      smartScopeStatus: { action: 'restore', ok: false, error: 'RESTORE_CSS_REMOVE_FAILED' },
    },
  ]);

  assert.deepEqual(view, {
    label: 'Restore failed',
    className: 'status-degraded',
    title: 'Restore failed. Use the mode button to retry cleanup.',
  });
});
