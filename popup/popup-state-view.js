import { ACTIVE_QUALITIES, STATES } from '../shared/constants.js';

export function isRestoreFailedState(state) {
  return isRetryableRestoreState(state);
}

export function isRetryableRestoreState(state) {
  if (state?.state !== STATES.ERROR) {
    return false;
  }

  const hasCleanupHandle = Boolean(state?.cssId || state?.smartScope || state?.scopedV2);
  if (!hasCleanupHandle) {
    return false;
  }

  const status = state?.smartScopeStatus;
  const reason = status?.error || status?.reason;
  return (
    status?.action === 'restore' &&
    status?.ok === false &&
    (status?.retryable === true || reason === 'RESTORE_CSS_REMOVE_FAILED')
  );
}

export function getModeVisualState(state = {}) {
  const restoreFailed = isRetryableRestoreState(state);
  const isActive = state?.state === STATES.ACTIVE || restoreFailed;
  const limitedFallback =
    isActive && !restoreFailed && state?.activeQuality === ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED;
  const mediumVerified =
    isActive && !restoreFailed && state?.activeQuality === ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED;
  const limitedDetail = state?.smartScope?.fallbackDetail || state?.smartScope?.scopeReason || null;

  return {
    isActive,
    restoreFailed,
    limitedFallback,
    mediumVerified,
    chipLabel: restoreFailed ? 'RESTORE FAILED' : limitedFallback ? 'LIMITED' : mediumVerified ? 'MEDIUM' : isActive ? 'ON' : 'OFF',
    chipTitle: restoreFailed
      ? 'Restore failed. Retry cleanup.'
      : limitedFallback
        ? `Limited safe effect${limitedDetail ? `: ${limitedDetail}` : ''}`
        : mediumVerified
          ? `Verified medium effect${limitedDetail ? `: ${limitedDetail}` : ''}`
        : '',
    ariaAction: restoreFailed ? 'Retry restore for' : isActive ? 'Disable' : 'Enable',
    liveState: restoreFailed
      ? 'restore failed. Retry restore.'
      : limitedFallback
        ? `enabled in limited fallback mode${limitedDetail ? `: ${limitedDetail}` : ''}`
        : mediumVerified
          ? `enabled with verified medium effect${limitedDetail ? `: ${limitedDetail}` : ''}`
        : isActive
          ? 'enabled'
          : 'disabled',
  };
}

export function getPopupStatusView(states = []) {
  const list = Array.isArray(states) ? states : [];
  const hasRestoreFailed = list.some((state) => isRetryableRestoreState(state));
  const hasDegraded = list.some((state) => state?.state === STATES.DEGRADED);
  const hasActive = list.some((state) => state?.state === STATES.ACTIVE);

  if (hasRestoreFailed) {
    return {
      label: 'Restore failed',
      className: 'status-degraded',
      title: 'Restore failed. Use the mode button to retry cleanup.',
    };
  }

  if (hasDegraded) {
    return {
      label: 'Degraded',
      className: 'status-degraded',
      title: 'Performance degraded. Modes paused.',
    };
  }

  if (hasActive) {
    return { label: 'Active', className: 'status-active', title: '' };
  }

  return { label: 'Paused', className: 'status-paused', title: '' };
}
