import { MODE_IDS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import { normalizeComfortVisualPrefs } from '../shared/comfort-visual-prefs.js';
import { MODE_ENGINE_SCOPE_SELECTOR, computeAppliedHash } from '../shared/mode-engine-scoped-v2.js';
import { getFromLocal, isValidTabId, mutateLocalValue } from '../shared/utils.js';
import { cssRegistry } from './css-registry.js';
import { stateManager } from './state-manager.js';
import { insertModeCssRaw, removeModeCssRaw } from './mode-engine-css.js';
import {
  buildComfortPreludeCss,
  buildScopedTransitionsCssV2,
  isComfortDarkModeEnabled,
} from './mode-css-builders.js';

const CSS_ORIGIN = 'AUTHOR';

function normalizeRefreshCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.min(20, Math.floor(numeric));
}

function isGoneDocumentError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('no document')
    || message.includes('document not found')
    || message.includes('no frame with id')
    || message.includes('frame was removed');
}

function resolveLifecycleDeps(deps = {}) {
  return {
    registry: deps.registry || cssRegistry,
    stateManager: deps.stateManager || stateManager,
    origin: deps.origin || CSS_ORIGIN,
    now: typeof deps.now === 'function' ? deps.now : Date.now,
    getComfortVisualPrefs: deps.getComfortVisualPrefs || getComfortVisualPrefsFromStorage,
    modeState: deps.modeState || null,
    updateState: deps.updateState !== false,
  };
}

export async function getComfortVisualPrefsFromStorage() {
  const storedPrefs = await getFromLocal(STORAGE_KEYS.USER_PREFS);
  const userPrefs =
    storedPrefs && typeof storedPrefs === 'object' && !Array.isArray(storedPrefs) ? storedPrefs : {};
  const modePrefs =
    userPrefs.modePrefs && typeof userPrefs.modePrefs === 'object' && !Array.isArray(userPrefs.modePrefs)
      ? userPrefs.modePrefs
      : {};
  const preferred = modePrefs[MODE_IDS.COMFORT_VISUAL];
  const legacy = modePrefs.comfortVisual;
  const effective = normalizeComfortVisualPrefs(preferred ?? legacy);

  if (!preferred && legacy) {
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (latestPrefs) => {
      const current = latestPrefs && typeof latestPrefs === 'object' && !Array.isArray(latestPrefs) ? latestPrefs : {};
      const currentModePrefs = current.modePrefs && typeof current.modePrefs === 'object' && !Array.isArray(current.modePrefs)
        ? current.modePrefs
        : {};
      if (currentModePrefs[MODE_IDS.COMFORT_VISUAL]) {
        return current;
      }
      return {
        ...current,
        modePrefs: { ...currentModePrefs, [MODE_IDS.COMFORT_VISUAL]: effective },
      };
    });
  }

  return effective;
}

export async function applyPreludeCss(tabId, source = 'system', deps = {}) {
  const lifecycle = resolveLifecycleDeps(deps);
  if (!isValidTabId(tabId)) {
    return { ok: false, applied: false, reason: 'invalid-tab' };
  }

  const modeId = MODE_IDS.COMFORT_VISUAL;
  const modeState = lifecycle.modeState || (await lifecycle.stateManager.getModeState(tabId, modeId));
  if (modeState?.state !== STATES.ACTIVE) {
    return { ok: true, applied: false, reason: 'mode-inactive' };
  }

  const comfortPrefs = await lifecycle.getComfortVisualPrefs();
  const darkModeEnabled = isComfortDarkModeEnabled({ comfortPrefs });
  if (!darkModeEnabled) {
    return { ok: true, applied: false, reason: 'dark-mode-disabled' };
  }

  const scopedState = modeState?.scopedV2 || {};
  const cssText = buildComfortPreludeCss({
    darkModeEnabled,
    tokenMap: scopedState?.tokens || null,
  });
  if (!cssText.trim()) {
    return { ok: true, applied: false, reason: 'dark-mode-disabled' };
  }
  const preludeHash = computeAppliedHash({ cssText, cssId: 'prelude', modeId });

  if (scopedState?.preludeHash === preludeHash && scopedState?.preludeCssId) {
    return { ok: true, applied: false, reason: 'already-applied' };
  }

  const insertionResult = await insertModeCssRaw({
    tabId,
    allFrames: true,
    includeTopFrame: true,
    cssText,
    origin: lifecycle.origin,
    modeId,
  });

  if (!insertionResult?.ok) {
    return { ok: false, applied: false, reason: 'insert-failed', detail: insertionResult?.error || null };
  }

  const registration = await lifecycle.registry.register(insertionResult?.cssText || cssText, lifecycle.origin, {
    tabId,
    modeId,
    createdAt: lifecycle.now(),
    scopeKey: 'html,body',
    variant: 'PRELUDE',
    allFrames: true,
    includeTopFrame: true,
  });

  const preludeAppliedAt = lifecycle.now();
  if (lifecycle.updateState) {
    await lifecycle.stateManager.updateModeState(tabId, modeId, modeState.state, {
      scopedV2: {
        ...scopedState,
        preludeCssId: registration.cssId,
        preludeHash,
        preludeAppliedAt,
        preludeRefreshCount: 0,
        preludeDocuments: [],
      },
    });
  }

  return {
    ok: true,
    applied: true,
    cssId: registration.cssId,
    preludeHash,
    preludeAppliedAt,
    preludeRefreshCount: 0,
    source,
  };
}

export async function ensureTransitionsCss(tabId, modeId, options = {}, deps = {}) {
  const lifecycle = resolveLifecycleDeps(deps);
  if (!isValidTabId(tabId)) {
    return { ok: false, applied: false, reason: 'invalid-tab' };
  }

  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const modeState = options?.modeState || (await lifecycle.stateManager.getModeState(tabId, modeId));
  const scopedState = modeState?.scopedV2 || {};
  const cssText = buildScopedTransitionsCssV2({
    transitionMs: options.transitionMs,
    animAttrName: options.animAttrName,
  });
  const transitionHash = computeAppliedHash({ cssText, cssId: 'transition', modeId });

  if (scopedState?.transitionCssId && scopedState?.transitionCssHash === transitionHash) {
    return { ok: true, applied: false, cssId: scopedState.transitionCssId, cssHash: transitionHash };
  }

  const insertionResult = await insertModeCssRaw({
    tabId,
    frameId,
    cssText,
    origin: lifecycle.origin,
    modeId,
  });

  if (!insertionResult?.ok) {
    return { ok: false, applied: false, reason: 'insert-failed', detail: insertionResult?.error || null };
  }

  let registration = null;
  try {
    registration = await lifecycle.registry.register(insertionResult?.cssText || cssText, lifecycle.origin, {
      tabId,
      modeId,
      createdAt: lifecycle.now(),
      scopeKey: MODE_ENGINE_SCOPE_SELECTOR,
      variant: 'SCOPED_V2_TRANSITION',
    });
  } catch (error) {
    await removeModeCssRaw({
      tabId,
      frameId,
      cssText: insertionResult?.cssText || cssText,
      origin: lifecycle.origin,
    }).catch(() => {});
    return { ok: false, applied: false, reason: 'registry-failed' };
  }

  return {
    ok: true,
    applied: true,
    cssId: registration.cssId,
    cssHash: transitionHash,
  };
}

export async function removeTransitionsCss(tabId, modeId, options = {}, deps = {}) {
  const lifecycle = resolveLifecycleDeps(deps);
  if (!isValidTabId(tabId)) {
    return { ok: false, removed: false, reason: 'invalid-tab' };
  }

  const modeState = options?.modeState || (await lifecycle.stateManager.getModeState(tabId, modeId));
  const scopedState = modeState?.scopedV2 || {};
  const transitionCssId = scopedState?.transitionCssId;

  if (!transitionCssId) {
    return { ok: true, removed: false, reason: 'not-applied' };
  }

  const entry = await lifecycle.registry.get(transitionCssId);
  if (!entry?.cssText) {
    if (options?.updateState !== false) {
      await lifecycle.stateManager.updateModeState(tabId, modeId, modeState.state, {
        scopedV2: {
          ...scopedState,
          transitionCssId: null,
          transitionCssHash: null,
        },
      });
    }
    return { ok: false, removed: false, reason: 'missing-css' };
  }

  const removalResult = await removeModeCssRaw({
    tabId,
    frameId: scopedState?.frameId,
    cssText: entry.cssText,
    origin: entry.origin || lifecycle.origin,
  });

  if (!removalResult?.ok) {
    return { ok: false, removed: false, reason: 'remove-failed', detail: removalResult?.error || null };
  }

  await lifecycle.registry.remove(transitionCssId);

  if (options?.updateState !== false) {
    await lifecycle.stateManager.updateModeState(tabId, modeId, modeState.state, {
      scopedV2: {
        ...scopedState,
        transitionCssId: null,
        transitionCssHash: null,
      },
    });
  }

  return { ok: true, removed: true };
}

export async function removePreludeCss(tabId, source = 'system', deps = {}) {
  const lifecycle = resolveLifecycleDeps(deps);
  if (!isValidTabId(tabId)) {
    return { ok: false, removed: false, reason: 'invalid-tab' };
  }

  const modeId = MODE_IDS.COMFORT_VISUAL;
  const modeState = deps?.modeState || (await lifecycle.stateManager.getModeState(tabId, modeId));

  const scopedState = modeState?.scopedV2 || {};
  const preludeCssId = scopedState?.preludeCssId;
  const entries = [];

  if (preludeCssId) {
    const entry = await lifecycle.registry.get(preludeCssId);
    if (entry?.cssText) {
      entries.push(entry);
    } else {
      const reconstructedCssText = buildComfortPreludeCss({
        darkModeEnabled: scopedState?.darkModeEnabled === true,
        tokenMap: scopedState?.tokens || null,
      });
      if (!reconstructedCssText.trim()) {
        return { ok: false, removed: false, reason: 'missing-css', source };
      }
      entries.push({
        cssId: null,
        cssText: reconstructedCssText,
        origin: lifecycle.origin,
        meta: { allFrames: true, includeTopFrame: true, reconstructed: true },
      });
    }
  }

  if (typeof lifecycle.registry.list === 'function') {
    const registeredEntries = await lifecycle.registry.list();
    const seenIds = new Set(entries.map((entry) => entry.cssId).filter(Boolean));
    for (const entry of registeredEntries || []) {
      if (
        entry?.meta?.tabId === tabId &&
        entry?.meta?.modeId === modeId &&
        entry?.meta?.variant === 'PRELUDE' &&
        entry?.cssText &&
        !seenIds.has(entry.cssId)
      ) {
        entries.push(entry);
        seenIds.add(entry.cssId);
      }
    }
  }

  if (entries.length === 0) {
    if (
      modeState?.state !== STATES.ACTIVE &&
      modeState?.state !== STATES.ERROR &&
      modeState?.state !== STATES.BLOCKED
    ) {
      return { ok: true, removed: false, reason: 'mode-inactive', source };
    }
    return { ok: true, removed: false, reason: 'not-applied' };
  }

  let removedCount = 0;
  const preludeRefreshCount = normalizeRefreshCount(scopedState?.preludeRefreshCount);
  const preludeDocuments = Array.isArray(scopedState?.preludeDocuments)
    ? scopedState.preludeDocuments
      .filter((entry) => typeof entry?.documentId === 'string')
      .slice(0, 64)
    : [];
  let documentReceiptsRemoved = false;
  for (const entry of entries) {
    const removalResult = await removeModeCssRaw({
      tabId,
      allFrames: entry?.meta?.allFrames === true,
      includeTopFrame: entry?.meta?.includeTopFrame === true,
      cssText: entry.cssText,
      origin: entry.origin || lifecycle.origin,
    });

    if (!removalResult?.ok) {
      return { ok: false, removed: false, reason: 'remove-failed', detail: removalResult?.error || null, source };
    }

    if (!documentReceiptsRemoved && preludeDocuments.length > 0) {
      for (const document of preludeDocuments) {
        const documentRemovalResult = await removeModeCssRaw({
          tabId,
          documentIds: [document.documentId],
          cssText: entry.cssText,
          origin: entry.origin || lifecycle.origin,
        });
        if (!documentRemovalResult?.ok && !isGoneDocumentError(documentRemovalResult?.error)) {
          return {
            ok: false,
            removed: false,
            reason: 'remove-document-refresh-failed',
            detail: documentRemovalResult?.error || null,
            source,
          };
        }
      }
      documentReceiptsRemoved = true;
    }

    if (entry?.meta?.allFrames === true && preludeRefreshCount > 0) {
      for (let index = 0; index < preludeRefreshCount; index += 1) {
        const refreshRemovalResult = await removeModeCssRaw({
          tabId,
          allFrames: true,
          includeTopFrame: false,
          cssText: entry.cssText,
          origin: entry.origin || lifecycle.origin,
        });

        if (!refreshRemovalResult?.ok) {
          return {
            ok: false,
            removed: false,
            reason: 'remove-refresh-failed',
            detail: refreshRemovalResult?.error || null,
            source,
          };
        }
      }
    }

    if (entry.cssId) {
      await lifecycle.registry.remove(entry.cssId);
    }
    removedCount += 1;
  }

  await lifecycle.stateManager.updateModeState(tabId, modeId, modeState?.state || STATES.INACTIVE, {
    scopedV2: {
      ...scopedState,
      preludeCssId: null,
      preludeHash: null,
      preludeAppliedAt: null,
      preludeRefreshCount: null,
      preludeDocuments: null,
    },
  });

  return { ok: true, removed: true, removedCount, source };
}
