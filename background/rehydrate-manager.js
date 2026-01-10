import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';

const DEFAULT_REHYDRATE_DEBOUNCE_MS = 700;

export function resolveRehydrateIntensity(modeState) {
  const scopedIntensity = modeState?.scopedV2?.intensity;
  if (typeof scopedIntensity === 'number' && Number.isFinite(scopedIntensity)) {
    return scopedIntensity;
  }

  const smartScopeIntensity = modeState?.smartScope?.intensity;
  if (typeof smartScopeIntensity === 'number' && Number.isFinite(smartScopeIntensity)) {
    return smartScopeIntensity;
  }

  return 1;
}

export function createRehydrateManager({
  modeIds,
  stateManager,
  cssApplier,
  isValidTabId,
  tabsApi,
  states,
  now = Date.now,
  debounceMs = DEFAULT_REHYDRATE_DEBOUNCE_MS,
  resolveIntensity = resolveRehydrateIntensity,
} = {}) {
  const rehydrateDebounceState = new Map();

  async function runRehydrateActiveModesForTab(tabId, reason = 'rehydrate') {
    if (!isValidTabId(tabId)) {
      return { ok: false, reason: 'INVALID_TAB_ID' };
    }

    try {
      await tabsApi.get(tabId);
    } catch (error) {
      return { ok: false, reason: 'TAB_NOT_FOUND' };
    }

    const applied = [];
    const activeModes = new Map();
    const modeIdList = Object.values(modeIds);

    for (const modeId of modeIdList) {
      const modeState = await stateManager.getModeState(tabId, modeId);
      if (modeState?.state === states.ACTIVE) {
        activeModes.set(modeId, modeState);
      }
    }

    let loserModeId = null;

    for (const modeId of activeModes.keys()) {
      const peerModeId = getExclusivePeerModeId(modeId);
      if (!peerModeId || !activeModes.has(peerModeId)) {
        continue;
      }

      const modeState = activeModes.get(modeId);
      const peerState = activeModes.get(peerModeId);
      const modeActivatedAt = typeof modeState?.activatedAt === 'number' ? modeState.activatedAt : null;
      const peerActivatedAt = typeof peerState?.activatedAt === 'number' ? peerState.activatedAt : null;

      let winnerModeId = null;
      if (modeActivatedAt !== null && peerActivatedAt !== null && modeActivatedAt !== peerActivatedAt) {
        winnerModeId = modeActivatedAt > peerActivatedAt ? modeId : peerModeId;
      } else if (modeActivatedAt !== null && peerActivatedAt === null) {
        winnerModeId = modeId;
      } else if (modeActivatedAt === null && peerActivatedAt !== null) {
        winnerModeId = peerModeId;
      } else {
        const fallbackWinner = modeIds?.FOCUS;
        if (fallbackWinner === modeId || fallbackWinner === peerModeId) {
          winnerModeId = fallbackWinner;
        } else {
          winnerModeId = modeId;
        }
      }

      loserModeId = winnerModeId === modeId ? peerModeId : modeId;
      try {
        const removalResult = await cssApplier.removeMode(tabId, loserModeId);
        if (removalResult?.ok === false) {
          console.warn('[RehydrateManager] Exclusive mode removal reported failure', {
            tabId,
            winnerModeId,
            loserModeId,
            reason,
            details: removalResult,
          });
        }
      } catch (error) {
        console.warn('[RehydrateManager] Failed to remove exclusive mode during rehydrate', {
          tabId,
          winnerModeId,
          loserModeId,
          reason,
          error,
        });
      }

      try {
        await stateManager.updateModeState(tabId, loserModeId, states.INACTIVE, { pendingDecision: false });
      } catch (error) {
        console.warn('[RehydrateManager] Failed to update exclusive mode state during rehydrate', {
          tabId,
          winnerModeId,
          loserModeId,
          reason,
          error,
        });
      }

      break;
    }

    for (const modeId of modeIdList) {
      if (modeId === loserModeId) {
        continue;
      }

      const modeState = activeModes.get(modeId);
      if (!modeState) {
        continue;
      }

      const intensity = resolveIntensity(modeState);
      try {
        const result = await cssApplier.applyMode(tabId, modeId, { intensity }, 'rehydrate');
        const entry = {
          modeId,
          ok: result?.ok !== false,
        };
        if (result?.error || result?.reason) {
          entry.error = result?.error || result?.reason;
        }
        if (result?.detail || result?.details) {
          entry.detail = result?.detail || result?.details;
        }
        applied.push(entry);
      } catch (error) {
        applied.push({
          modeId,
          ok: false,
          error: error?.message || 'APPLY_FAILED',
        });
      }
    }

    return { ok: true, reason, applied };
  }

  async function rehydrateActiveModesForTab(tabId, reason = 'rehydrate') {
    const nowTimestamp = now();
    const existing = rehydrateDebounceState.get(tabId);

    if (existing?.inFlightPromise) {
      return existing.inFlightPromise;
    }

    if (existing && nowTimestamp - existing.lastStartAt < debounceMs) {
      return { ok: true, reason, applied: [] };
    }

    const inFlightPromise = runRehydrateActiveModesForTab(tabId, reason).finally(() => {
      const current = rehydrateDebounceState.get(tabId);
      if (current?.inFlightPromise === inFlightPromise) {
        rehydrateDebounceState.set(tabId, { ...current, inFlightPromise: null });
      }
    });

    rehydrateDebounceState.set(tabId, { inFlightPromise, lastStartAt: nowTimestamp });
    return inFlightPromise;
  }

  return {
    rehydrateActiveModesForTab,
    runRehydrateActiveModesForTab,
  };
}
