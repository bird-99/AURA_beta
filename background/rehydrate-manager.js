import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';
import { OUTCOME_LEDGER_EVENTS } from '../shared/engine-core/enums.js';
import { extractDomain } from '../shared/utils.js';
import { recordUserOutcome } from './outcome-ledger.js';
import {
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from './template-evidence.js';
import { recordTemplateMemoryNegativeOutcome } from './template-memory.js';

const DEFAULT_REHYDRATE_DEBOUNCE_MS = 700;
const LIFECYCLE_REHYDRATE_REASONS = new Set([
  'content-ready',
  'tab-complete',
  'tab-activated',
  'spa',
]);
const NAVIGATION_REHYDRATE_REASONS = new Set(['spa', 'tab-complete']);

function navigationKeyFor(reason, context) {
  if (!NAVIGATION_REHYDRATE_REASONS.has(reason) || typeof context?.url !== 'string') {
    return null;
  }
  const url = context.url.trim();
  return url || null;
}

function isSameNavigation(firstReason, firstKey, secondReason, secondKey) {
  return NAVIGATION_REHYDRATE_REASONS.has(firstReason)
    && NAVIGATION_REHYDRATE_REASONS.has(secondReason)
    && firstKey !== null
    && firstKey === secondKey;
}

function isPreferenceRehydrateReason(reason) {
  return typeof reason === 'string' && (reason.startsWith('prefs:') || reason.includes(':prefs:'));
}

function shouldBypassRecentDebounce(reason) {
  return LIFECYCLE_REHYDRATE_REASONS.has(reason) || isPreferenceRehydrateReason(reason);
}

async function recordExclusiveRemovalOutcome(details, templateEvidence = null) {
  if (!globalThis.chrome?.storage?.session) {
    return;
  }
  await recordUserOutcome({
    ...details,
    ...templateEvidenceForLedger(templateEvidence),
  });
  const negativeEvidence = templateEvidenceForTemplateMemory(templateEvidence, {
    siteKey: details?.siteKey || 'unknown',
    event: details?.event,
  });
  if (negativeEvidence) {
    try {
      await recordTemplateMemoryNegativeOutcome(negativeEvidence);
    } catch (error) {
      console.warn('[RehydrateManager] Template negative evidence write failed', error);
    }
  }
}

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

  async function runRehydrateActiveModesForTab(tabId, reason = 'rehydrate', _context = {}) {
    if (!isValidTabId(tabId)) {
      return { ok: false, reason: 'INVALID_TAB_ID' };
    }

    let tab = null;
    try {
      tab = await tabsApi.get(tabId);
    } catch (error) {
      return { ok: false, reason: 'TAB_NOT_FOUND' };
    }
    const siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';

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
    let exclusiveResolutionFailed = false;

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
      const loserState = activeModes.get(loserModeId);
      let removalError = null;

      try {
        const removalResult = await cssApplier.removeMode(tabId, loserModeId);
        if (removalResult?.ok === false) {
          removalError = removalResult?.error || removalResult?.reason || 'REMOVE_MODE_FAILED';
          console.warn('[RehydrateManager] Exclusive mode removal reported failure', {
            tabId,
            winnerModeId,
            loserModeId,
            reason,
            details: removalResult,
          });
        }
      } catch (error) {
        removalError = error?.message || 'REMOVE_MODE_FAILED';
        console.warn('[RehydrateManager] Failed to remove exclusive mode during rehydrate', {
          tabId,
          winnerModeId,
          loserModeId,
          reason,
          error,
        });
      }

      if (removalError) {
        exclusiveResolutionFailed = true;
        applied.push({
          modeId: loserModeId,
          ok: false,
          skipped: true,
          reason: 'exclusive-removal-failed',
          error: removalError,
          winnerModeId,
        });
        break;
      }

      await recordExclusiveRemovalOutcome({
        siteKey,
        modeId: loserModeId,
        event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
        attemptId: loserState?.scopedV2?.outcomeAttemptId || loserState?.scopedV2?.attemptId || null,
      }, loserState?.scopedV2?.templateEvidence || null);

      try {
        await stateManager.updateModeState(tabId, loserModeId, states.INACTIVE, { pendingDecision: false });
      } catch (error) {
        exclusiveResolutionFailed = true;
        applied.push({
          modeId: loserModeId,
          ok: false,
          skipped: true,
          reason: 'exclusive-state-update-failed',
          error: error?.message || 'STATE_UPDATE_FAILED',
          winnerModeId,
        });
        console.warn('[RehydrateManager] Failed to update exclusive mode state during rehydrate', {
          tabId,
          winnerModeId,
          loserModeId,
          reason,
          error,
        });
        break;
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

      const latestModeState = await stateManager.getModeState(tabId, modeId);
      if (latestModeState?.state !== states.ACTIVE || latestModeState?.pendingDecision === true) {
        applied.push({
          modeId,
          ok: true,
          skipped: true,
          reason: latestModeState?.pendingDecision === true ? 'mode-operation-pending' : 'mode-inactive',
        });
        continue;
      }

      const intensity = resolveIntensity(latestModeState);
      const markRehydrateFailure = async (failure = {}) => {
        if (!stateManager?.updateTabModeState) {
          return;
        }
        const error = failure?.error || failure?.reason || 'REHYDRATE_FAILED';
        try {
          await stateManager.updateTabModeState(tabId, modeId, {
            state: states.ERROR || 'ERROR',
            pendingDecision: false,
            activeQuality: null,
          });
          if (typeof stateManager.setSmartScopeStatus === 'function') {
            await stateManager.setSmartScopeStatus(tabId, modeId, {
              action: 'rehydrate',
              ok: false,
              error: 'REHYDRATE_FAILED',
              reason: error,
              detail: failure?.detail || failure?.details || error,
              timestamp: Date.now(),
            });
          }
        } catch (_) {
          // best-effort failure marker
        }
      };
      try {
        const result = await cssApplier.applyMode(
          tabId,
          modeId,
          {
            intensity,
            forceReapply: isPreferenceRehydrateReason(reason),
            reapplyReason: reason,
          },
          'rehydrate',
        );
        const entry = {
          modeId,
          ok: result?.ok !== false,
        };
        if (result?.ok === false) {
          await markRehydrateFailure(result);
        }
        if (result?.error || result?.reason) {
          entry.error = result?.error || result?.reason;
        }
        if (result?.detail || result?.details) {
          entry.detail = result?.detail || result?.details;
        }
        applied.push(entry);
      } catch (error) {
        await markRehydrateFailure({ error: error?.message || 'APPLY_FAILED' });
        applied.push({
          modeId,
          ok: false,
          error: error?.message || 'APPLY_FAILED',
        });
      }
    }

    const applyFailed = applied.some((entry) => entry?.ok === false);
    return { ok: !exclusiveResolutionFailed && !applyFailed, reason, applied };
  }

  async function rehydrateActiveModesForTab(tabId, reason = 'rehydrate', context = {}) {
    const nowTimestamp = now();
    const existing = rehydrateDebounceState.get(tabId);
    const navigationKey = navigationKeyFor(reason, context);

    if (existing?.inFlightPromise) {
      if (isSameNavigation(existing.activeReason, existing.activeNavigationKey, reason, navigationKey)) {
        return existing.inFlightPromise;
      }
      if (shouldBypassRecentDebounce(reason)) {
        rehydrateDebounceState.set(tabId, {
          ...existing,
          queuedReason: reason,
          queuedContext: context,
          queuedNavigationKey: navigationKey,
        });
      }

      return existing.inFlightPromise;
    }

    if (existing && nowTimestamp - existing.lastStartAt < debounceMs) {
      if (isSameNavigation(existing.lastReason, existing.lastNavigationKey, reason, navigationKey)) {
        return { ok: true, reason, applied: [], deduped: true };
      }
      if (!shouldBypassRecentDebounce(reason)) {
        return { ok: true, reason, applied: [] };
      }
    }

    const startRun = (runReason, startedAt, runContext = {}, runNavigationKey = null) => {
      const inFlightPromise = runRehydrateActiveModesForTab(tabId, runReason, runContext).finally(() => {
        const current = rehydrateDebounceState.get(tabId);
        if (current?.inFlightPromise !== inFlightPromise) {
          return;
        }

        if (current?.queuedReason) {
          return startRun(
            current.queuedReason,
            now(),
            current.queuedContext || {},
            current.queuedNavigationKey ?? null,
          );
        }

        rehydrateDebounceState.set(tabId, {
          ...current,
          inFlightPromise: null,
          activeReason: null,
          activeNavigationKey: null,
        });
      });

      const current = rehydrateDebounceState.get(tabId);
      rehydrateDebounceState.set(tabId, {
        ...current,
        inFlightPromise,
        lastStartAt: startedAt,
        lastReason: runReason,
        lastNavigationKey: runNavigationKey,
        activeReason: runReason,
        activeNavigationKey: runNavigationKey,
        queuedReason: null,
        queuedContext: null,
        queuedNavigationKey: null,
      });

      return inFlightPromise;
    };

    return startRun(reason, nowTimestamp, context, navigationKey);
  }

  return {
    rehydrateActiveModesForTab,
    runRehydrateActiveModesForTab,
  };
}
