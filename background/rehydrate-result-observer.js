export async function runObservedRehydrate(
  rehydrateActiveModesForTab,
  tabId,
  reason,
  { source = 'rehydrate', warn = console.warn } = {},
) {
  const result = await rehydrateActiveModesForTab(tabId, reason);

  if (result?.ok === false && typeof warn === 'function') {
    warn('[Rehydrate] Rehydrate reported failure', {
      tabId,
      reason,
      source,
      result,
    });
  }

  return result;
}

export function scheduleObservedRehydrate(
  rehydrateActiveModesForTab,
  tabId,
  reason,
  { source = 'rehydrate', warn = console.warn } = {},
) {
  return runObservedRehydrate(rehydrateActiveModesForTab, tabId, reason, { source, warn }).catch((error) => {
    if (typeof warn === 'function') {
      warn('[Rehydrate] Rehydrate failed', {
        tabId,
        reason,
        source,
        error,
      });
    }

    return { ok: false, reason, error: error?.message || 'REHYDRATE_FAILED' };
  });
}
