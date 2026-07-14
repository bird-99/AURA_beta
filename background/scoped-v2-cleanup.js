import { ACTIONS } from '../shared/constants.js';
import { SCOPE_OWNER_VALUE } from '../shared/mode-engine-scoped-v2.js';
import { cssRegistry } from './css-registry.js';
import { sendScopeTokenMessage } from './scoped-v2-page-bridge.js';
import { deleteScopedModeV2State, getScopedModeV2State } from './scoped-v2-state.js';

const CSS_ORIGIN = 'AUTHOR';
const SCOPED_MODE_OWNER_KEY = SCOPE_OWNER_VALUE;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConfirmedMissingScope(cleanupResult) {
  const detail = `${cleanupResult?.detail || cleanupResult?.reason || ''}`.toLowerCase();
  return detail.includes('scope-root-missing') || detail.includes('not-owner');
}

export async function removeScopedModeV2({
  tabId,
  frameId = 0,
  modeId = null,
  cssId,
  scopedState,
  preserveScope = false,
  transitionMs = 0,
  requireTokenCleanup = false,
  registry = cssRegistry,
} = {}) {
  const fallbackState = scopedState && typeof scopedState === 'object' ? scopedState : null;
  const existing = getScopedModeV2State(tabId, frameId) || fallbackState || (cssId ? { cssId } : null);

  if (!existing) {
    return { ok: true, removed: false };
  }

  const ownerKey = existing.owner || SCOPED_MODE_OWNER_KEY;
  let cssRemoved = false;
  let registryRemoved = false;
  let tokensRemoved = false;
  let scopeUnmarked = false;
  let cleanupFailure = null;
  const hasTransition = typeof transitionMs === 'number' && transitionMs > 0;
  const shouldPreserveScope = Boolean(preserveScope) || hasTransition;

  const target = { tabId };
  if (typeof frameId === 'number') {
    target.frameIds = [frameId];
  }

  const cssLookupId = cssId || existing.cssId || null;
  let cssText = existing.cssText || '';
  let cssOrigin = CSS_ORIGIN;

  try {
    const entry = cssLookupId ? await registry.get(cssLookupId) : null;
    if (entry) {
      cssText = entry.cssText || cssText;
      cssOrigin = entry.origin || cssOrigin;
    }
  } catch (error) {
    // ignore registry errors
  }

  const updateCleanupOutcome = (cleanupResult) => {
    const removed = cleanupResult?.ok && typeof cleanupResult.removed === 'number' ? cleanupResult.removed > 0 : false;
    const unmarked = cleanupResult?.ok && cleanupResult?.scopeUnmarked === true;
    tokensRemoved = tokensRemoved || removed;
    scopeUnmarked = scopeUnmarked || unmarked;
  };

  const cleanupPayload = {
    ownerKey,
    preserveScope: shouldPreserveScope,
    ...(typeof modeId === 'string' && modeId ? { modeId } : {}),
  };
  const ownedKeys = Array.isArray(existing?.ownedKeys)
    ? existing.ownedKeys
    : (Array.isArray(existing?.tokenKeys) ? existing.tokenKeys : []);
  if (ownedKeys.length > 0) {
    cleanupPayload.ownedKeys = ownedKeys;
  }
  if (hasTransition) {
    cleanupPayload.smoothTransitions = true;
    cleanupPayload.transitionMs = transitionMs;
  }

  const initialCleanupResult = await sendScopeTokenMessage(
    tabId,
    ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    cleanupPayload,
    { frameId },
  );
  updateCleanupOutcome(initialCleanupResult);
  if (initialCleanupResult?.ok === false && !isConfirmedMissingScope(initialCleanupResult)) {
    cleanupFailure = initialCleanupResult?.detail || initialCleanupResult?.error || 'TOKEN_CLEANUP_FAILED';
  }

  if (hasTransition) {
    await delay(transitionMs + 50);
  }

  if (cssText) {
    try {
      await chrome.scripting.removeCSS({ target, css: cssText, origin: cssOrigin });
      cssRemoved = true;
    } catch (error) {
      cssRemoved = false;
      return {
        ok: false,
        reason: 'RESTORE_CSS_REMOVE_FAILED',
        error: 'RESTORE_CSS_REMOVE_FAILED',
        retryable: true,
        removed: false,
        details: {
          cssRemoved,
          registryRemoved,
          tokensRemoved,
          scopeUnmarked,
          cssRemovalError: error?.message || 'removeCSS failed',
        },
      };
    }
  }

  if (shouldPreserveScope) {
    const cleanupResult = await sendScopeTokenMessage(
      tabId,
      ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
      {
        ownerKey,
        preserveScope: false,
        ...(typeof modeId === 'string' && modeId ? { modeId } : {}),
        ...(ownedKeys.length > 0 ? { ownedKeys } : {}),
      },
      { frameId },
    );
    updateCleanupOutcome(cleanupResult);
    cleanupFailure = cleanupResult?.ok === false && !isConfirmedMissingScope(cleanupResult)
      ? (cleanupResult?.detail || cleanupResult?.error || 'TOKEN_CLEANUP_FAILED')
      : null;
  }

  if (cleanupFailure && requireTokenCleanup) {
    return {
      ok: false,
      reason: 'RESTORE_TOKEN_CLEANUP_FAILED',
      error: 'RESTORE_TOKEN_CLEANUP_FAILED',
      retryable: true,
      removed: false,
      details: {
        cssRemoved,
        registryRemoved,
        tokensRemoved,
        scopeUnmarked,
        tokenCleanupError: cleanupFailure,
      },
    };
  }

  if (cssLookupId) {
    try {
      await registry.remove(cssLookupId);
      registryRemoved = true;
    } catch (error) {
      return {
        ok: false,
        reason: 'RESTORE_REGISTRY_REMOVE_FAILED',
        error: 'RESTORE_REGISTRY_REMOVE_FAILED',
        retryable: true,
        removed: false,
        details: {
          cssRemoved,
          registryRemoved,
          tokensRemoved,
          scopeUnmarked,
          registryRemovalError: error?.message || 'registry.remove failed',
        },
      };
    }
  }

  deleteScopedModeV2State(tabId, frameId);
  return {
    ok: true,
    removed: true,
    details: {
      cssRemoved,
      registryRemoved,
      tokensRemoved,
      scopeUnmarked,
    },
  };
}
