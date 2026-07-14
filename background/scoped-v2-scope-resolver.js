import { SMARTSCOPE_ACTIONS, SMARTSCOPE_LEVELS } from '../shared/constants.js';
import { modeEngineLog } from '../shared/mode-engine-debug.js';
import { APPLY_FAILURE_REASONS } from './apply-failure-reasons.js';
import { contentBridge } from './content-bridge.js';
import {
  deleteCachedScopeEntry,
  getCachedScopeEntry,
  isCachedScopeEntryFresh,
  makeScopeCacheKey,
  setCachedScopeEntry,
} from './scope-cache.js';
import {
  ensureScopeRootMarked,
  isNonTrivialScope,
  salvageScopeRootBySelectorInPage,
  sendScopeTokenMessage,
  verifyScopeRootBySelectorInPage,
} from './scoped-v2-page-bridge.js';

const SMARTSCOPE_TIMEOUT_MS = 60;
const SALVAGEABLE_SCOPE_REASONS = new Set([
  'ROOT_NULL',
  'ROOT_NOT_CONNECTED',
  'ROOT_TOO_LARGE',
  'ROOT_SELECTOR_NON_UNIQUE',
  'ROOT_TOO_SMALL',
  'ROOT_HIDDEN',
]);

function formatDetail(value, fallback = '') {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function formatVerificationDetail(verification) {
  const reason = formatDetail(verification?.reason, '');
  const detail = formatDetail(verification?.detail, '');
  if (detail) {
    return reason ? `${reason}: ${detail}` : detail;
  }
  return reason || '';
}

function formatNoScopeDetail(reason, detail, fallback = 'SMARTSCOPE_FAILED') {
  const tokenize = (value) =>
    formatDetail(value, '')
      .replace(/v2[-_]none/gi, '')
      .toUpperCase()
      .split(/[^A-Z0-9_]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  const parts = [...tokenize(reason), ...tokenize(detail)]
    .filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.length ? unique.join(',') : fallback;
}

async function recordApplyNoScope({ modeId, recordV2Metric, recordSmartScopeStatus, status }) {
  if (typeof recordV2Metric === 'function') {
    recordV2Metric('apply.no_scope', 1, { modeId });
  }
  if (typeof recordSmartScopeStatus === 'function') {
    await recordSmartScopeStatus('apply', status);
  }
}

export function rememberResolvedScopedV2Scope({ tabId, modeId, applyUrlKey, scopeSelector, frameId }) {
  if (applyUrlKey && isNonTrivialScope(scopeSelector)) {
    setCachedScopeEntry(makeScopeCacheKey(tabId, modeId), {
      scopeSelector,
      frameId,
      urlKey: applyUrlKey,
      savedAtMs: Date.now(),
    });
  }
}

export async function resolveScopedV2Scope({
  tabId,
  modeId,
  frameId = 0,
  source = '',
  applyUrlKey = '',
  smartScopeConfig = {},
  debugEnabled = false,
  attemptId = 0,
  recordSmartScopeStatus = async () => {},
  recordV2Metric = () => {},
} = {}) {
  const cacheKey = makeScopeCacheKey(tabId, modeId);
  if (source === 'popup') {
    deleteCachedScopeEntry(cacheKey);
  }
  const cachedEntry = getCachedScopeEntry(cacheKey);
  const now = Date.now();
  let cachedScopeSelector = '';
  let cachedVerification = null;
  let cachedVerificationFailure = null;
  let resolvedFrameId = frameId;
  let profileResponse = null;
  let scopeDetail = null;
  let profileOk = false;

  if (cachedEntry) {
    if (isCachedScopeEntryFresh(cachedEntry, applyUrlKey, now)) {
      const cachedFrameId = typeof cachedEntry.frameId === 'number' ? cachedEntry.frameId : frameId;
      const verification = await verifyScopeRootBySelectorInPage(tabId, cachedEntry.scopeSelector, {
        frameId: cachedFrameId,
      });

      if (verification?.ok) {
        cachedScopeSelector = cachedEntry.scopeSelector;
        cachedVerification = verification;
        resolvedFrameId = cachedFrameId;
        profileOk = true;
        scopeDetail = 'CACHE_REUSE';
        profileResponse = {
          profile: {
            ok: true,
            scopeSelector: cachedScopeSelector,
            reason: 'cache',
            detail: scopeDetail,
            frameId: resolvedFrameId,
          },
        };
      } else {
        cachedVerificationFailure = verification;
        deleteCachedScopeEntry(cacheKey);
      }
    } else {
      deleteCachedScopeEntry(cacheKey);
    }
  }

  const receiverResult = await contentBridge.ensureReceiver(tabId, { frameId: resolvedFrameId });
  if (!receiverResult?.ok) {
    const detail = formatDetail(receiverResult?.lastErrorMessage, APPLY_FAILURE_REASONS.NO_RECEIVER);
    await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
    return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
  }

  if (!profileResponse) {
    profileResponse = await sendScopeTokenMessage(
      tabId,
      SMARTSCOPE_ACTIONS.GET_PROFILE,
      {
        level: smartScopeConfig.level || SMARTSCOPE_LEVELS.CONSERVATIVE,
        budgetMs: SMARTSCOPE_TIMEOUT_MS,
      },
      { frameId: resolvedFrameId },
    );
  }

  if (profileResponse?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
    const detail = formatDetail(profileResponse?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
    await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
    return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
  }

  let scopeSelector = cachedScopeSelector || (profileResponse?.profile?.scopeSelector || '').trim();
  resolvedFrameId =
    typeof profileResponse?.profile?.frameId === 'number' ? profileResponse.profile.frameId : resolvedFrameId;
  scopeDetail = scopeDetail || profileResponse?.profile?.detail || null;
  profileOk =
    profileOk ||
    profileResponse?.profile?.ok === true ||
    (profileResponse?.profile?.ok == null && Boolean(scopeSelector));
  const reasonIfFail = profileResponse?.profile?.reason || scopeDetail || 'SMARTSCOPE_FAILED';
  const noScopeDetail = formatNoScopeDetail(profileResponse?.profile?.reason, scopeDetail);

  if (!profileOk) {
    if (scopeDetail === 'TIME_BUDGET_EXCEEDED') {
      if (!scopeSelector || !isNonTrivialScope(scopeSelector)) {
        await recordApplyNoScope({
          modeId,
          recordV2Metric,
          recordSmartScopeStatus,
          status: { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail },
        });
        return { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail };
      }
    } else {
      await recordApplyNoScope({
        modeId,
        recordV2Metric,
        recordSmartScopeStatus,
        status: { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail },
      });
      return { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail };
    }
  }

  if (!scopeSelector || !isNonTrivialScope(scopeSelector)) {
    const fallbackDetail = formatDetail(scopeDetail, noScopeDetail);
    await recordApplyNoScope({
      modeId,
      recordV2Metric,
      recordSmartScopeStatus,
      status: { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: fallbackDetail },
    });
    return { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: fallbackDetail };
  }

  let verifiedByScope = false;
  let verification = cachedVerification
    ? cachedVerification
    : profileOk
      ? await verifyScopeRootBySelectorInPage(tabId, scopeSelector, { frameId: resolvedFrameId })
      : { ok: false, reason: reasonIfFail, source: 'profile' };
  verifiedByScope = profileOk;
  modeEngineLog('[CssApplier][V2] Scope verification', { scopeSelector, verification, attemptId });

  if (verification == null) {
    const detail = 'VERIFY_SCOPE_ROOT_FAILED';
    await recordApplyNoScope({
      modeId,
      recordV2Metric,
      recordSmartScopeStatus,
      status: { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail },
    });
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
  }

  if (verification?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
    const detail = formatDetail(verification?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
    await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
    return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
  }

  let scopeRootMarked = false;
  const cachedFailureReason = cachedVerificationFailure?.reason || null;
  const shouldAttemptSalvage =
    (!profileOk && scopeDetail === 'TIME_BUDGET_EXCEEDED') ||
    SALVAGEABLE_SCOPE_REASONS.has(cachedFailureReason || verification?.reason);
  const shouldHandleVerificationFailure =
    !verification?.ok || (cachedVerificationFailure && shouldAttemptSalvage);
  if (shouldHandleVerificationFailure) {
    try {
      const initialReason = cachedFailureReason || verification?.reason;
      let salvageResult = null;
      let salvageDetail = '';
      let salvageAttempted = false;
      const allowSalvageFailure = verification?.ok && cachedVerificationFailure && shouldAttemptSalvage;

      if (shouldAttemptSalvage) {
        salvageAttempted = true;
        salvageResult = await salvageScopeRootBySelectorInPage(tabId, scopeSelector, {
          debugEnabled,
          frameId: resolvedFrameId,
        });

        if (salvageResult == null) {
          const detail = 'SALVAGE_SCOPE_ROOT_FAILED';
          if (allowSalvageFailure) {
            salvageDetail = detail;
            salvageResult = null;
          } else {
            await recordApplyNoScope({
              modeId,
              recordV2Metric,
              recordSmartScopeStatus,
              status: { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail },
            });
            return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
          }
        }

        if (salvageResult?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
          const detail = formatDetail(salvageResult?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
          if (allowSalvageFailure) {
            salvageDetail = detail;
            salvageResult = null;
          } else {
            await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
            return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
          }
        }

        if (salvageResult?.error === APPLY_FAILURE_REASONS.INTERNAL_ERROR) {
          const detail = formatDetail(salvageResult?.detail, 'INTERNAL_ERROR');
          if (allowSalvageFailure) {
            salvageDetail = detail;
            salvageResult = null;
          } else {
            await recordSmartScopeStatus('apply', {
              ok: false,
              error: APPLY_FAILURE_REASONS.INTERNAL_ERROR,
              detail,
            });
            return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
          }
        }

        if (!salvageResult) {
          // Allow fallback to the already verified scope when salvage fails but verification is ok.
        } else if (salvageResult?.ok && salvageResult.selector) {
          scopeSelector = salvageResult.selector;
          verification = await verifyScopeRootBySelectorInPage(tabId, scopeSelector, { frameId: resolvedFrameId });
          verifiedByScope = true;
          if (verification?.ok) {
            const scopeRootResult = await ensureScopeRootMarked(tabId, scopeSelector, {
              frameId: resolvedFrameId,
              debugEnabled,
              attemptId,
            });
            if (!scopeRootResult?.ok) {
              if (scopeRootResult?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
                const detail = formatDetail(scopeRootResult?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
                await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
                return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
              }
              const detail = formatDetail(scopeRootResult?.detail, APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED);
              await recordSmartScopeStatus('apply', {
                ok: false,
                reason: APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED,
                detail,
              });
              return { ok: false, reason: APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED, detail };
            }

            if (scopeRootResult?.selector && scopeRootResult.selector !== scopeSelector) {
              scopeSelector = scopeRootResult.selector;
            }
            scopeRootMarked = true;
          }
        } else {
          const salvageReason = formatDetail(salvageResult?.detail || salvageResult?.reason, '');
          salvageDetail = salvageReason ? `SALVAGE_NO_SELECTOR: ${salvageReason}` : 'SALVAGE_NO_SELECTOR';
        }
      }

      if (verification == null) {
        const detail = 'VERIFY_SCOPE_ROOT_FAILED';
        await recordApplyNoScope({
          modeId,
          recordV2Metric,
          recordSmartScopeStatus,
          status: { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail },
        });
        return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
      }

      if (verification?.error === APPLY_FAILURE_REASONS.INTERNAL_ERROR) {
        const detail = formatDetail(verification?.detail, 'INTERNAL_ERROR');
        await recordApplyNoScope({
          modeId,
          recordV2Metric,
          recordSmartScopeStatus,
          status: { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail },
        });
        return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
      }

      if (!verification?.ok) {
        if (!verifiedByScope && !salvageAttempted) {
          const detail = formatDetail(initialReason, 'INTERNAL_ERROR');
          await recordApplyNoScope({
            modeId,
            recordV2Metric,
            recordSmartScopeStatus,
            status: { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail },
          });
          return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
        }

        const baseDetail = formatVerificationDetail(verification) || formatDetail(initialReason, 'SCOPE_REJECTED');
        const detail = salvageDetail ? `${baseDetail}; ${salvageDetail}` : baseDetail;
        await recordApplyNoScope({
          modeId,
          recordV2Metric,
          recordSmartScopeStatus,
          status: {
            ok: false,
            reason: APPLY_FAILURE_REASONS.SCOPE_REJECTED,
            detail,
          },
        });
        return {
          ok: false,
          reason: APPLY_FAILURE_REASONS.SCOPE_REJECTED,
          detail,
          details: detail,
          salvageTried: salvageResult?.tried === true,
        };
      }
    } catch (error) {
      const detail = `${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`;
      await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail });
      return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
    }
  }

  if (!scopeRootMarked) {
    const scopeRootResult = await ensureScopeRootMarked(tabId, scopeSelector, {
      frameId: resolvedFrameId,
      debugEnabled,
      attemptId,
    });
    if (!scopeRootResult?.ok) {
      if (scopeRootResult?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
        const detail = formatDetail(scopeRootResult?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
        await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
        return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
      }
      const detail = formatDetail(scopeRootResult?.detail, APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED);
      await recordSmartScopeStatus('apply', {
        ok: false,
        reason: APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED,
        detail,
      });
      return { ok: false, reason: APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED, detail };
    }

    if (scopeRootResult?.selector && scopeRootResult.selector !== scopeSelector) {
      scopeSelector = scopeRootResult.selector;
    }
  }

  return {
    ok: true,
    scopeSelector,
    frameId: resolvedFrameId,
    profileResponse,
    verification,
  };
}
