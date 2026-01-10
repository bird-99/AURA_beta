import { stateManager } from './state-manager.js';
import { autoApplyManager, scorer } from './scorer.js';
import { badgeManager } from './badge-manager.js';
import { decisionHandler } from './decision-handler.js';
import { spaDetector } from './spa-detector.js';
import { cssApplier } from './css-applier.js';
import { cssRegistry } from './css-registry.js';
import {
  ACTIONS,
  MODE_IDS,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  SMARTSCOPE_LEVELS,
  STATES,
  STORAGE_KEYS,
  ZOOM_CONFIG,
} from '../shared/constants.js';
import {
  createError,
  extractDomain,
  getFromLocal,
  getFromSession,
  isValidTabId,
  logError,
  setToLocal,
  setToSession,
  tryOpenPopupOrFallback,
} from '../shared/utils.js';
import { performanceMonitor } from './degraded-manager.js';
import { telemetry } from './telemetry.js';
import { smartScopeDebugger } from './smartscope-debugger.js';
import { initFeatureFlags, isFlagEnabled } from '../shared/feature-flags.js';
import { ensureSpaHooksMainInjected } from './spa-hooks-injector.js';
import { contentBridge } from './content-bridge.js';
import {
  computeSitePolicy,
  getHostFromUrl,
  isUnsupportedScheme,
  setHostOverride,
} from './site-policy-manager.js';
import { createRehydrateManager } from './rehydrate-manager.js';
import { createTabRehydrateHandlers } from './rehydrate-tab-events.js';
import {
  FEATURE_FLAGS_REQUEST_TYPE,
  handleGetFeatureFlagsRequest,
} from './feature-flags-bridge.js';
import { handleSharedConstantsRequest } from './shared-constants-bridge.js';
import { getTabRuntime, patchTabRuntime } from './runtime-state.js';
import { modeEngineLog, recordTiming } from '../shared/mode-engine-debug.js';

// Initialize performance monitor singleton (global reference used by css-applier)
void performanceMonitor;

console.log('[SW] AURA Service Worker started');

let initPromise;

// Initialization must stay lazy to keep MV3 service worker registration synchronous (no TLA).
function initOnce() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureSessionAccessLevel();
      await initFeatureFlags();
      setupModeEngineTimingInstrumentation();
      const smartScopeConfig = await ensureSmartScopeDefaultsInUserPrefs();

      try {
        await cssRegistry.cleanup({ maxAgeMs: 1000 * 60 * 60 * 24, maxEntries: 500 });
      } catch (error) {
        console.warn('[SW] CssRegistry cleanup failed', error);
      }

      try {
        await spaDetector.init();
      } catch (error) {
        console.warn('[SW] Failed to initialize SPA detector', error);
      }

      try {
        await telemetry.init();
      } catch (error) {
        console.warn('[SW] Failed to initialize telemetry', error);
      }

      smartScopeDebugger.setEnabled(smartScopeConfig?.debugEnabled === true);
    })().catch((error) => {
      console.error('[SW] Initialization failed', error);
      throw error;
    });
  }

  return initPromise;
}

function ensureInitInHandler(handlerName, fn, { onError } = {}) {
  (async () => {
    try {
      await initOnce();
      await fn();
    } catch (error) {
      console.error(`[SW] ${handlerName} handler failed`, error);
      if (typeof onError === 'function') {
        onError(error);
      }
    }
  })();
}

const SMARTSCOPE_DEFAULT_CONFIG = {
  enabled: true,
  level: SMARTSCOPE_LEVELS.CONSERVATIVE,
  perDomain: {},
  debugEnabled: false,
};

const DEFAULT_TEST_CONFIDENCE = 0.75;
const SITE_OVERRIDE_DEFAULT_MS = 5 * 60 * 1000;
const SITE_OVERRIDE_MIN_MS = 60 * 1000;
const SITE_OVERRIDE_MAX_MS = 60 * 60 * 1000;
const CONTRAST_REPORT_MIN_RATIO = 4.5;
const MODE_ENGINE_TIMING_STEPS = Object.freeze({
  NAV_START: 'nav_start',
  PRELUDE_INJECTED: 'prelude_injected',
  FINAL_CSS_INJECTED: 'final_css_injected',
  TOKENS_APPLIED: 'tokens_applied',
  PRELUDE_REMOVED: 'prelude_removed',
});
const MODE_ENGINE_TIMING_EDGES = [
  { name: 'nav_to_prelude', from: MODE_ENGINE_TIMING_STEPS.NAV_START, to: MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED },
  { name: 'prelude_to_final_css', from: MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED, to: MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED },
  { name: 'final_css_to_tokens', from: MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED, to: MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED },
  { name: 'tokens_to_prelude_removed', from: MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED, to: MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED },
];

let modeEngineTimingInstrumented = false;

function isModeEngineDebugEnabled() {
  return isFlagEnabled('debugModeEngine');
}

function normalizeModeEngineTimingState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const steps = raw.steps && typeof raw.steps === 'object' && !Array.isArray(raw.steps) ? raw.steps : {};

  return {
    sequenceId: typeof raw.sequenceId === 'number' ? raw.sequenceId : null,
    activeModeId: typeof raw.activeModeId === 'string' ? raw.activeModeId : null,
    activeSource: typeof raw.activeSource === 'string' ? raw.activeSource : null,
    steps,
  };
}

async function recordModeEngineTiming(tabId, step, context = {}) {
  if (!isValidTabId(tabId)) {
    return;
  }
  if (!isModeEngineDebugEnabled()) {
    return;
  }

  const timestamp = Date.now();
  const runtime = await getTabRuntime(tabId);
  const timing = normalizeModeEngineTimingState(runtime?.modeEngineTiming);
  const isNavStart = step === MODE_ENGINE_TIMING_STEPS.NAV_START;
  const shouldClearActive = isNavStart || step === MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED;
  const sequenceId = isNavStart || !timing.sequenceId ? timestamp : timing.sequenceId;
  const activeModeId = context.modeId || timing.activeModeId || null;
  const activeSource = context.source || timing.activeSource || null;
  const entry = {
    ts: timestamp,
    reason: context.reason || null,
    modeId: activeModeId,
    source: activeSource,
  };
  const baseSteps = isNavStart ? {} : timing.steps || {};
  const nextTiming = {
    sequenceId,
    activeModeId: shouldClearActive ? undefined : activeModeId || undefined,
    activeSource: shouldClearActive ? undefined : activeSource || undefined,
    steps: {
      ...baseSteps,
      [step]: entry,
    },
  };

  await patchTabRuntime(tabId, { modeEngineTiming: nextTiming });

  modeEngineLog('Timing marker', { tabId, step, sequenceId, ...entry });

  const existingSteps = baseSteps;
  for (const edge of MODE_ENGINE_TIMING_EDGES) {
    if (edge.to !== step) {
      continue;
    }
    const startEntry = existingSteps[edge.from];
    if (!startEntry?.ts) {
      continue;
    }
    recordTiming(`modeengine.timeline.${edge.name}`, timestamp - startEntry.ts, {
      tabId,
      modeId: activeModeId || undefined,
      source: activeSource || undefined,
      sequenceId,
    });
  }
}

function isModeEngineCssPayload(cssText = '') {
  if (typeof cssText !== 'string') {
    return false;
  }
  return cssText.includes('--aura-me2-css') || cssText.includes('--aura-me2-path');
}

function setupModeEngineTimingInstrumentation() {
  if (modeEngineTimingInstrumented) {
    return;
  }
  modeEngineTimingInstrumented = true;

  const originalApplyMode = cssApplier.applyMode.bind(cssApplier);
  cssApplier.applyMode = async (tabId, modeId, params, source) => {
    await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED, {
      modeId,
      source,
      reason: source || 'apply',
    });
    return originalApplyMode(tabId, modeId, params, source);
  };

  const originalSafeSend = contentBridge.safeSend.bind(contentBridge);
  contentBridge.safeSend = async (tabId, message, options = {}) => {
    const result = await originalSafeSend(tabId, message, options);
    if (!message || typeof message.action !== 'string') {
      return result;
    }

    if (result?.ok) {
      if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED, {
          reason: 'apply_scope_tokens',
        });
      } else if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED, {
          reason: 'cleanup_scope_tokens',
        });
      }
    }

    return result;
  };

  if (chrome?.scripting?.insertCSS) {
    const originalInsertCSS = chrome.scripting.insertCSS.bind(chrome.scripting);
    chrome.scripting.insertCSS = async (details) => {
      const result = await originalInsertCSS(details);
      const tabId = details?.target?.tabId;
      const cssText = details?.css;
      if (isValidTabId(tabId) && isModeEngineCssPayload(cssText)) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED, {
          reason: 'insert_css',
        });
      }
      return result;
    };
  }
}

function normalizeSmartScopeConfig(raw = {}) {
  const level = Object.values(SMARTSCOPE_LEVELS).includes(raw.level)
    ? raw.level
    : SMARTSCOPE_LEVELS.CONSERVATIVE;

  const normalizedPerDomain = {};
  if (raw.perDomain && typeof raw.perDomain === 'object' && !Array.isArray(raw.perDomain)) {
    for (const [domain, cfg] of Object.entries(raw.perDomain)) {
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
      const domainLevel = Object.values(SMARTSCOPE_LEVELS).includes(cfg.level)
        ? cfg.level
        : level;
      normalizedPerDomain[domain] = {
        enabled: cfg.enabled === true,
        level: domainLevel,
      };
    }
  }

  return {
    enabled: raw.enabled !== false,
    level,
    perDomain: normalizedPerDomain,
    debugEnabled: raw.debugEnabled === true,
  };
}

async function ensureSmartScopeDefaultsInUserPrefs() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    const prefs = stored?.[STORAGE_KEYS.USER_PREFS] || {};

    const existing = prefs.smartScope;
    const normalized = normalizeSmartScopeConfig(existing || SMARTSCOPE_DEFAULT_CONFIG);
    const needsPerDomainInit = !existing || typeof existing.perDomain !== 'object';

    if (
      !existing ||
      existing.enabled !== normalized.enabled ||
      existing.level !== normalized.level ||
      existing.debugEnabled !== normalized.debugEnabled ||
      needsPerDomainInit
    ) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.USER_PREFS]: {
          ...prefs,
          smartScope: normalized,
        },
      });
    }

    smartScopeDebugger.setEnabled(normalized.debugEnabled === true);

    return normalized;
  } catch (error) {
    console.warn('[SW] Failed to ensure SmartScope defaults:', error);
    return SMARTSCOPE_DEFAULT_CONFIG;
  }
}

async function setSmartScopeConfig(next = {}) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    const prefs = stored?.[STORAGE_KEYS.USER_PREFS] || {};
    const current = normalizeSmartScopeConfig(prefs.smartScope || SMARTSCOPE_DEFAULT_CONFIG);

    const updated = { ...current };

    if (typeof next.enabled === 'boolean') {
      updated.enabled = next.enabled;
    }

    if (next.level && Object.values(SMARTSCOPE_LEVELS).includes(next.level)) {
      updated.level = next.level;
    }

    if (typeof next.debugEnabled === 'boolean') {
      updated.debugEnabled = next.debugEnabled;
    }

    if ('perDomain' in next) {
      if (next.perDomain && typeof next.perDomain === 'object' && !Array.isArray(next.perDomain)) {
        const normalizedPerDomain = {};
        for (const [domain, cfg] of Object.entries(next.perDomain)) {
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
          const domainLevel = Object.values(SMARTSCOPE_LEVELS).includes(cfg.level)
            ? cfg.level
            : updated.level;
          normalizedPerDomain[domain] = {
            enabled: cfg.enabled === true,
            level: domainLevel,
          };
        }
        updated.perDomain = normalizedPerDomain;
      } else {
        updated.perDomain = {};
      }
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PREFS]: {
        ...prefs,
        smartScope: updated,
      },
    });

    smartScopeDebugger.setEnabled(updated.debugEnabled === true);

    return { ok: true };
  } catch (error) {
    console.error('[SW] Failed to set SmartScope config:', error);
    return { ok: false, error: error?.message || 'SMARTSCOPE_CONFIG_FAILED' };
  }
}

async function clearSmartScopeSessionState() {
  const errors = [];

  try {
    const sessionData = await chrome.storage.session.get(null);
    const removalKeys = Object.keys(sessionData || {}).filter(
      (key) => key.startsWith('smartscope_') || key === STORAGE_KEYS.CSS_REGISTRY,
    );
    if (removalKeys.length) {
      await chrome.storage.session.remove(removalKeys);
    }
  } catch (error) {
    errors.push(error?.message || 'SESSION_CLEANUP_FAILED');
  }

  try {
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    let mutated = false;
    for (const [tabId, modes] of Object.entries(tabState)) {
      const parsedTabId = Number.parseInt(tabId, 10);
      if (Number.isNaN(parsedTabId)) {
        continue;
      }
      for (const [modeId, modeState] of Object.entries(modes || {})) {
        if (modeState?.smartScope) {
          await stateManager.updateTabModeState(parsedTabId, modeId, { smartScope: null });
          mutated = true;
        }
      }
    }
    if (mutated) {
      console.debug('[SW] Cleared smartScope state from session tabState');
    }
  } catch (error) {
    errors.push(error?.message || 'TABSTATE_CLEANUP_FAILED');
  }

  return errors;
}

async function resetSmartScopeEverywhere() {
  const result = { ok: true, cleanedTabs: 0, errors: [] };

  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    const prefs = stored?.[STORAGE_KEYS.USER_PREFS] || {};
    await chrome.storage.local.set({
      [STORAGE_KEYS.USER_PREFS]: {
        ...prefs,
        smartScope: { ...SMARTSCOPE_DEFAULT_CONFIG, perDomain: {} },
      },
    });
  } catch (error) {
    result.errors.push(error?.message || 'PREF_RESET_FAILED');
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    result.errors.push(error?.message || 'TAB_QUERY_FAILED');
  }

  for (const tab of tabs) {
    const tabId = tab?.id;
    if (!tabId) continue;

    const siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';

    try {
      for (const modeId of Object.values(MODE_IDS)) {
        try {
          await cssApplier.removeMode(tabId, modeId, siteKey, { trackRestore: false });
        } catch (removeError) {
          result.errors.push(removeError?.message || `REMOVE_FAILED_${modeId}`);
        }

        try {
          await chrome.tabs.sendMessage(tabId, { action: SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP });
        } catch (cleanupError) {
          console.warn('[SW] Emergency cleanup failed', cleanupError);
        }

        try {
          await stateManager.setSmartScope(tabId, modeId, null);
          await stateManager.removeSmartScopeToken(tabId, modeId);
          await stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, { pendingDecision: false });
        } catch (stateError) {
          result.errors.push(stateError?.message || `STATE_RESET_FAILED_${modeId}`);
        }
      }
      result.cleanedTabs += 1;
    } catch (error) {
      result.errors.push(error?.message || `TAB_CLEAN_FAILED_${tabId}`);
    }
  }

  const sessionErrors = await clearSmartScopeSessionState();
  if (sessionErrors.length) {
    result.errors.push(...sessionErrors);
  }

  return result;
}

async function ensureSessionAccessLevel() {
  if (chrome.storage?.session?.setAccessLevel) {
    try {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch (error) {
      console.warn('[SW] Unable to set session access level:', error);
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureInitInHandler('onInstalled', async () => {
    console.log('[SW] Extension installed/updated:', details.reason);

    if (details.reason === 'install') {
      const url = chrome.runtime.getURL('welcome/welcome.html');
      await chrome.tabs.create({ url });
    }

    await telemetry.init();
    await spaDetector.init();
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitInHandler('onStartup', async () => {
    console.log('[SW] Browser started, Service Worker initializing');
    await telemetry.init();
    await spaDetector.init();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  ensureInitInHandler('onRemoved', async () => {
    console.log('[SW] Tab closed:', tabId);
    await stateManager.clearTab(tabId);
    await removeZoomHistory(tabId);
    await clearContrastGuardState(tabId);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ensureInitInHandler('onUpdated', async () => {
    if (changeInfo?.status === 'loading') {
      await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.NAV_START, {
        reason: 'loading',
      });
    }
    await handleTabUpdated(tabId, changeInfo, tab);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureInitInHandler('onActivated', async () => {
    await handleTabActivated(activeInfo);
  });
});

// ========== ZOOM DETECTION ==========

async function getZoomHistory(tabId) {
  const zoomHistory = (await getFromSession(STORAGE_KEYS.ZOOM_HISTORY)) || {};
  return zoomHistory[tabId] || [];
}

async function saveZoomHistory(tabId, history) {
  const zoomHistory = (await getFromSession(STORAGE_KEYS.ZOOM_HISTORY)) || {};
  zoomHistory[tabId] = history;
  await setToSession(STORAGE_KEYS.ZOOM_HISTORY, zoomHistory);
}

async function removeZoomHistory(tabId) {
  const zoomHistory = (await getFromSession(STORAGE_KEYS.ZOOM_HISTORY)) || {};
  delete zoomHistory[tabId];
  await setToSession(STORAGE_KEYS.ZOOM_HISTORY, zoomHistory);
}

async function getSiteKeyFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url ? extractDomain(tab.url) : 'unknown';
  } catch (error) {
    console.warn('[SW] Unable to resolve siteKey for tab', tabId, error);
    return 'unknown';
  }
}

async function getContrastGuardState(tabId, modeId) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? runtime.contrastGuard
    : {};
  const modeState = contrastGuard?.[modeId];
  return modeState && typeof modeState === 'object' ? modeState : {};
}

async function updateContrastGuardState(tabId, modeId, updates) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? runtime.contrastGuard
    : {};
  const current = contrastGuard?.[modeId] && typeof contrastGuard[modeId] === 'object'
    ? contrastGuard[modeId]
    : {};

  const nextModeState = { ...current, ...(updates || {}) };
  const nextContrastGuard = { ...contrastGuard, [modeId]: nextModeState };
  await patchTabRuntime(tabId, { contrastGuard: nextContrastGuard });
  return nextModeState;
}

async function clearContrastGuardState(tabId, modeId) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? { ...runtime.contrastGuard }
    : {};

  if (modeId) {
    delete contrastGuard[modeId];
  }

  const hasEntries = Object.keys(contrastGuard).length > 0;
  await patchTabRuntime(tabId, { contrastGuard: hasEntries ? contrastGuard : undefined });
}

async function disableDarkModeForSite(tabId, modeId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return { ok: false, reason: 'TAB_LOOKUP_FAILED' };
  }

  const siteKey = tab?.url ? extractDomain(tab.url) : null;
  if (!siteKey || siteKey === 'unknown') {
    return { ok: false, reason: 'SITE_KEY_MISSING' };
  }

  const perDomainPrefs = (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  const sitePrefs = perDomainPrefs[siteKey] || {};
  const modePrefs = sitePrefs[modeId] || {};

  const nextModePrefs = {
    ...modePrefs,
    darkMode: false,
    timestamp: Date.now(),
  };

  const nextPrefs = {
    ...perDomainPrefs,
    [siteKey]: {
      ...sitePrefs,
      [modeId]: nextModePrefs,
    },
  };

  await setToLocal(STORAGE_KEYS.PER_DOMAIN_PREFS, nextPrefs);
  return { ok: true, siteKey };
}

async function handleContrastReport(tabId, modeId, report) {
  if (!isValidTabId(tabId)) {
    return { ok: false, reason: 'INVALID_TAB_ID' };
  }

  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  if (!report || typeof report.minRatio !== 'number') {
    return { ok: false, reason: 'INVALID_REPORT' };
  }

  if (report.ok === true || report.minRatio >= CONTRAST_REPORT_MIN_RATIO) {
    await clearContrastGuardState(tabId, modeId);
    return { ok: true, action: 'ok' };
  }

  const guardState = await getContrastGuardState(tabId, modeId);
  if (!guardState?.retried) {
    await updateContrastGuardState(tabId, modeId, {
      retried: true,
      retryActive: true,
      lastReportAt: Date.now(),
    });
    rehydrateActiveModesForTab(tabId, 'contrast-guard-retry').catch(() => {});
    return { ok: true, action: 'retry' };
  }

  await updateContrastGuardState(tabId, modeId, {
    retried: true,
    retryActive: false,
    lastReportAt: Date.now(),
  });

  if (report.isDark === false) {
    return { ok: true, action: 'no-dark-mode' };
  }

  const disabled = await disableDarkModeForSite(tabId, modeId);
  await updateContrastGuardState(tabId, modeId, {
    retried: true,
    retryActive: false,
    disabled: disabled.ok === true,
    lastReportAt: Date.now(),
  });
  rehydrateActiveModesForTab(tabId, 'contrast-guard-disable-dark').catch(() => {});
  return { ok: disabled.ok === true, action: 'disable-dark', siteKey: disabled.siteKey || null };
}

function generateToken() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `smartscope-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function patchSmartScope(tabId, modeId, patch) {
  const existing = (await stateManager.getSmartScope(tabId, modeId)) || {};
  await stateManager.setSmartScope(tabId, modeId, { ...existing, ...patch });
}

async function recordSmartScopeStatus(tabId, modeId, action, result = {}) {
  const status = {
    action,
    ok: result?.ok !== false,
    error: result?.error || null,
    timestamp: Date.now(),
  };

  await stateManager.setSmartScopeStatus(tabId, modeId, status);
}

async function smartScopeApplyDomClasses(tabId, modeId, ops = []) {
  const token = generateToken();
  let response;

  const recordResult = async (result) => {
    await recordSmartScopeStatus(tabId, modeId, 'apply', result);
  };

  try {
    response = await chrome.tabs.sendMessage(tabId, {
      action: SMARTSCOPE_ACTIONS.APPLY_CLASSES,
      token,
      operations: ops,
    });
  } catch (error) {
    const fallback = { ok: false, error: error?.message || 'APPLY_FAILED' };
    await recordResult(fallback);
    return fallback;
  }

  if (response?.ok) {
    const now = Date.now();
    await stateManager.setSmartScopeToken(tabId, modeId, {
      token,
      appliedClasses: response.applied || [],
      createdAt: now,
    });

    await patchSmartScope(tabId, modeId, {
      domClassToken: token,
      appliedClasses: response.applied || [],
      appliedAt: now,
    });

    await recordResult({ ok: true });

    return { ok: true, token, appliedClasses: response.applied };
  }

  const errorMessage = response?.errors?.[0]?.error || response?.error || 'APPLY_FAILED';
  const result = { ok: false, error: errorMessage };
  await recordResult(result);
  return result;
}

async function smartScopeRemoveDomToken(tabId, modeId) {
  const entry = await stateManager.getSmartScopeToken(tabId, modeId);
  let removed = 0;

  if (entry?.token) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: SMARTSCOPE_ACTIONS.REMOVE_TOKEN,
        token: entry.token,
      });
      removed = response?.removed || 0;
    } catch (error) {
      console.warn('[SW] Failed to remove DOM token, attempting emergency cleanup', error);
      try {
        const emergencyResponse = await chrome.tabs.sendMessage(tabId, {
          action: SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP,
        });
        removed = emergencyResponse?.removed || removed;
      } catch (cleanupError) {
        console.warn('[SW] Emergency cleanup failed', cleanupError);
      }
    }
  }

  await stateManager.removeSmartScopeToken(tabId, modeId);
  await patchSmartScope(tabId, modeId, {
    domClassToken: null,
    appliedClasses: [],
    appliedAt: null,
  });

  const result = { ok: true, removed };
  await recordSmartScopeStatus(tabId, modeId, 'restore', result);
  return result;
}

const { rehydrateActiveModesForTab } = createRehydrateManager({
  modeIds: MODE_IDS,
  stateManager,
  cssApplier,
  isValidTabId,
  tabsApi: chrome.tabs,
  states: STATES,
});

spaDetector.setReapplyHandler(rehydrateActiveModesForTab);

const { handleTabActivated, handleTabUpdated } = createTabRehydrateHandlers({
  cssApplier,
  stateManager,
  rehydrateActiveModesForTab,
  isUnsupportedScheme,
  isValidTabId,
  onTabReady: async ({ tabId, url }) => {
    await autoApplyManager.evaluateFocusDefault(tabId, url);
  },
  states: STATES,
  tabsApi: chrome.tabs,
});

function maybeEnsureSpaHooksMainInjected(tabId) {
  if (!isValidTabId(tabId)) {
    return;
  }

  ensureSpaHooksMainInjected(tabId).catch((error) => {
    console.warn('[SW] Failed to ensure SPA hooks runtime', error);
  });
}

async function rehydrateActiveModesForActiveTabs(reason) {
  const activeTabIds = new Set();

  for (const modeId of Object.values(MODE_IDS)) {
    try {
      const tabs = await stateManager.getTabsWithActiveMode(modeId);
      tabs.forEach((tabId) => activeTabIds.add(tabId));
    } catch (error) {
      console.warn('[SW] Failed to collect active tabs for mode', modeId, error);
    }
  }

  for (const tabId of activeTabIds) {
    await rehydrateActiveModesForTab(tabId, reason);
  }
}

function isRestrictedUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'chrome:' || protocol === 'chrome-extension:' || protocol === 'about:';
  } catch (error) {
    console.warn('[SW] Unable to parse URL for restriction check:', error);
    return true;
  }
}

function normalizeTestConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULT_TEST_CONFIDENCE;
}

function normalizeOverrideDuration(rawValue) {
  const duration = Number(rawValue);
  if (!Number.isFinite(duration)) {
    return SITE_OVERRIDE_DEFAULT_MS;
  }
  return Math.min(Math.max(duration, SITE_OVERRIDE_MIN_MS), SITE_OVERRIDE_MAX_MS);
}

async function resolveUrlFromMessage(sender, message) {
  if (typeof message?.url === 'string' && message.url) {
    return message.url;
  }

  if (typeof sender?.tab?.url === 'string' && sender.tab.url) {
    return sender.tab.url;
  }

  if (typeof message?.tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(message.tabId);
      return tab?.url || null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

async function handleTestInjectBanner(payload = {}) {
  const { modeId, targetUrl, targetPattern } = payload;
  if (typeof modeId !== 'string' || !modeId.trim()) {
    return { ok: false, error: createError('E006', 'Invalid test banner payload') };
  }

  if (!Object.values(MODE_IDS).includes(modeId)) {
    return { ok: false, error: createError('E006', 'Unsupported modeId') };
  }

  const confidence = normalizeTestConfidence(payload.confidence);
  const signals = Array.isArray(payload.signals) ? payload.signals : [];
  const debugTabs = new Map();
  const collectDebugTabs = (tabs = []) => {
    for (const tab of tabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      if (debugTabs.has(tab.id)) continue;
      debugTabs.set(tab.id, { id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl });
    }
  };

  let resolvedTabId = null;

  const matchesTargetUrl = (tab) =>
    targetUrl &&
    ((typeof tab?.url === 'string' && tab.url.startsWith(targetUrl)) ||
      (typeof tab?.pendingUrl === 'string' && tab.pendingUrl.startsWith(targetUrl)));

  if (targetPattern) {
    try {
      const patternTabs = await chrome.tabs.query({ url: [targetPattern] });
      collectDebugTabs(patternTabs);

      const targetMatch = patternTabs.find((tab) => matchesTargetUrl(tab));
      resolvedTabId =
        (typeof targetMatch?.id === 'number' ? targetMatch.id : null) ||
        patternTabs.find((tab) => typeof tab?.id === 'number')?.id ||
        null;
    } catch (error) {
      console.warn('[SW][TEST] Failed tab query by pattern', error);
    }
  }

  if (resolvedTabId === null) {
    try {
      const allTabs = await chrome.tabs.query({});
      collectDebugTabs(allTabs);

      const match = allTabs.find((tab) => matchesTargetUrl(tab));

      resolvedTabId = typeof match?.id === 'number' ? match.id : null;
    } catch (error) {
      console.warn('[SW][TEST] Failed tab query for fallback resolution', error);
    }
  }

  const tabId = resolvedTabId ?? (typeof payload.tabId === 'number' ? payload.tabId : null);

  if (typeof tabId !== 'number') {
    return {
      ok: false,
      message: 'No matching tab',
      targetUrl,
      targetPattern,
      debugTabs: Array.from(debugTabs.values()),
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.querySelector('[data-aura-test="suggestion-banner"]')) return;
        const banner = document.createElement('div');
        banner.setAttribute('data-aura-test', 'suggestion-banner');
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        banner.style.position = 'fixed';
        banner.style.left = '0';
        banner.style.right = '0';
        banner.style.bottom = '0';
        banner.style.zIndex = '2147483647';
        banner.textContent = 'AURA suggestion banner (test)';
        document.documentElement.appendChild(banner);
      },
    });
  } catch (error) {
    return {
      ok: false,
      message: error?.message || 'Banner inject failed (executeScript)',
      targetUrl,
      targetPattern,
      tabId,
      debugTabs: Array.from(debugTabs.values()),
    };
  }

  return {
    ok: true,
    attempts: 1,
    tabId,
    confidence,
    signals,
  };
}

async function handleTestClearBanner(tabId) {
  if (typeof tabId !== 'number') {
    return { ok: false, error: createError('E006', 'Invalid tabId for banner clear') };
  }

  const sendResult = await contentBridge.safeSend(tabId, { action: ACTIONS.TEST_CLEAR_SUGGESTION_BANNER });

  if (!sendResult.ok) {
    return {
      ok: false,
      error: sendResult.error || createError('E001', 'Banner clear failed (tabs.sendMessage)'),
      code: sendResult.code,
      attempts: sendResult.attempts,
    };
  }

  const response = sendResult.data;
  if (response?.ok === true) {
    return { ok: true, attempts: sendResult.attempts };
  }

  return {
    ok: false,
    error: response?.error || createError('E001', 'Banner clear failed (content)'),
    attempts: sendResult.attempts,
  };
}

chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  ensureInitInHandler('onZoomChange', async () => {
    const { tabId, newZoomFactor } = zoomChangeInfo;

    console.log(`[SW] Zoom changed on tab ${tabId}: ${newZoomFactor}`);

    const history = await getZoomHistory(tabId);
    history.push({ time: Date.now(), factor: newZoomFactor });

    if (history.length > ZOOM_CONFIG.HISTORY_SIZE) {
      history.shift();
    }

    await saveZoomHistory(tabId, history);

    const windowStart = Date.now() - ZOOM_CONFIG.PATTERN_WINDOW;
    const recentZooms = history.filter(
      (entry) => entry.time > windowStart && entry.factor > ZOOM_CONFIG.MIN_FACTOR,
    );

    if (recentZooms.length >= ZOOM_CONFIG.PATTERN_THRESHOLD) {
      console.log(
        `[SW] Zoom pattern detected: ${recentZooms.length} zooms > ${ZOOM_CONFIG.MIN_FACTOR * 100}% in window`,
      );
      await scorer.handleSignal(tabId, SIGNALS.ZOOM, newZoomFactor);
    }
  });
});

const ACTION_ALIASES = {
  REQUEST_STATE: ACTIONS.GET_STATE,
  APPLY_MODE: ACTIONS.USER_DECISION,
  REMOVE_MODE: ACTIONS.RESTORE_MODE,
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  ensureInitInHandler('onStorageChanged', async () => {
    if (areaName !== 'local') {
      return;
    }

    const prefsChange = changes?.[STORAGE_KEYS.USER_PREFS];
    if (!prefsChange) {
      return;
    }

    const previousPrefs = prefsChange.oldValue || {};
    const nextPrefs = prefsChange.newValue || {};

    const prevSpaDetection = previousPrefs.spaDetectionEnabled === true;
    const nextSpaDetection = nextPrefs.spaDetectionEnabled === true;

    if (prevSpaDetection !== nextSpaDetection) {
      if (nextSpaDetection) {
        await spaDetector.enable();
      } else {
        spaDetector.disable();
      }
    }

    const prevSmartScope = previousPrefs.smartScope || {};
    const nextSmartScope = nextPrefs.smartScope || {};

    const smartScopeChanged =
      prevSmartScope.enabled !== nextSmartScope.enabled ||
      prevSmartScope.level !== nextSmartScope.level ||
      JSON.stringify(prevSmartScope.perDomain || {}) !== JSON.stringify(nextSmartScope.perDomain || {});

    if (smartScopeChanged || prevSpaDetection !== nextSpaDetection) {
      await rehydrateActiveModesForActiveTabs('prefs');
    }

    const prevComfortVisual = previousPrefs.modePrefs?.comfortVisual || {};
    const nextComfortVisual = nextPrefs.modePrefs?.comfortVisual || {};
    const comfortVisualChanged = JSON.stringify(prevComfortVisual) !== JSON.stringify(nextComfortVisual);

    if (comfortVisualChanged) {
      await rehydrateActiveModesForActiveTabs('prefs:comfortVisual');
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
    handleGetFeatureFlagsRequest()
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, reason: 'SW_ERROR' });
      });
    return true;
  }

  if (handleSharedConstantsRequest(message, sendResponse)) {
    return;
  }

  console.log('[SW] Message received:', message.action);

  const normalizedAction = ACTION_ALIASES[message.action] || message.action;

  ensureInitInHandler(
    'onMessage',
    async () => {
      switch (normalizedAction) {
        case ACTIONS.GET_TAB_ID:
          sendResponse({ tabId: sender.tab?.id });
          break;
        case ACTIONS.GET_STATE: {
          const state = await stateManager.getState(message.tabId, message.modeId);
          const smartScopeStatus = await stateManager.getSmartScopeStatus(message.tabId, message.modeId);
          const stateWithStatus = smartScopeStatus ? { ...state, smartScopeStatus } : state;
          sendResponse({ state: stateWithStatus });
          break;
        }
        case ACTIONS.CONTENT_SCRIPT_READY_V2: {
          const tabId = message.tabId ?? sender?.tab?.id;

          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          sendResponse({ ok: true });
          maybeEnsureSpaHooksMainInjected(tabId);
          rehydrateActiveModesForTab(tabId, 'content-ready').catch(() => {});
          break;
        }
        case ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES: {
          const tabId = message.tabId ?? sender?.tab?.id;

          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          const reason = message.reason || 'spa';
          sendResponse({ ok: true });
          rehydrateActiveModesForTab(tabId, reason).catch(() => {});
          break;
        }
        case ACTIONS.MODE_ENGINE_V2_CONTRAST_REPORT: {
          const tabId = message.tabId ?? sender?.tab?.id;
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          const reportResult = await handleContrastReport(tabId, message.modeId, message.report);
          sendResponse(reportResult);
          break;
        }
        case ACTIONS.GET_SITE_POLICY: {
          const url = await resolveUrlFromMessage(sender, message);
          if (!url) {
            sendResponse({ ok: false, error: 'URL_REQUIRED' });
            break;
          }

          const policy = await computeSitePolicy({ url, now: Date.now() });
          sendResponse({ ok: true, policy });
          break;
        }
        case ACTIONS.SET_SITE_OVERRIDE: {
          const url = await resolveUrlFromMessage(sender, message);
          if (!url) {
            sendResponse({ ok: false, error: 'URL_REQUIRED' });
            break;
          }

          if (isUnsupportedScheme(url)) {
            sendResponse({ ok: false, error: 'UNSUPPORTED_SCHEME' });
            break;
          }

          const host = getHostFromUrl(url);
          if (!host) {
            sendResponse({ ok: false, error: 'INVALID_HOST' });
            break;
          }

          const durationMs = normalizeOverrideDuration(message.durationMs);
          const overrideUntil = Date.now() + durationMs;
          const saved = await setHostOverride({ host, overrideUntil });

          if (!saved) {
            sendResponse({ ok: false, error: 'OVERRIDE_FAILED' });
            break;
          }

          const policy = await computeSitePolicy({ url, now: Date.now() });
          sendResponse({ ok: true, policy });
          break;
        }
        case ACTIONS.SIGNAL_DETECTED: {
          const signalType = message.signal?.type ?? message.signal;
          const signalValue = message.signal?.value ?? message.value;
          await scorer.handleSignal(message.tabId, signalType, signalValue);
          sendResponse({ received: true });
          break;
        }
        case ACTIONS.USER_DECISION: {
          const { tabId, modeId } = message;
          const decision =
            message.decision || (message.action === 'APPLY_MODE' ? 'ENABLED' : undefined);

          if (typeof tabId !== 'number' || typeof modeId !== 'string' || !decision) {
            sendResponse({ ok: false, error: 'Invalid decision payload' });
            break;
          }

          let tab;
          try {
            tab = await chrome.tabs.get(tabId);
          } catch (error) {
            sendResponse({ ok: false, error: 'Tab not found' });
            break;
          }

          const tabUrl = tab?.url || '';
          if (isRestrictedUrl(tabUrl)) {
            await stateManager.updateTabModeState(tabId, modeId, {
              state: STATES.BLOCKED,
              pendingDecision: false,
            });

            sendResponse({ ok: false, blocked: true, reason: 'Restricted URL' });
            break;
          }

          const siteKey = tabUrl ? extractDomain(tabUrl) : 'unknown';
          const result = await decisionHandler.handleDecision(tabId, modeId, decision, { siteKey });

          if (result?.ok) {
            sendResponse(result);
          } else {
            sendResponse(result || { ok: false, error: 'Decision handling failed' });
          }
          break;
        }
        case ACTIONS.RESTORE_MODE: {
          const { tabId, modeId } = message;

          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'Invalid restore payload' });
            break;
          }

          let tab;
          try {
            tab = await chrome.tabs.get(tabId);
          } catch (error) {
            sendResponse({ ok: false, error: 'Tab not found' });
            break;
          }

          const tabUrl = tab?.url || '';
          if (isRestrictedUrl(tabUrl)) {
            await stateManager.updateTabModeState(tabId, modeId, {
              state: STATES.BLOCKED,
              pendingDecision: false,
            });

            sendResponse({ ok: false, blocked: true, reason: 'Restricted URL' });
            break;
          }

          const siteKey = tabUrl ? extractDomain(tabUrl) : 'unknown';
          const removed = await cssApplier.removeMode(tabId, modeId, siteKey);

          if (!removed) {
            sendResponse({ ok: false, error: 'Failed to remove mode' });
            break;
          }

          await stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
            pendingDecision: false,
          });

          try {
            await chrome.tabs.sendMessage(tabId, { action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId });
          } catch (error) {
            console.warn('[SW] Failed to remove restore button', error);
          }

          await badgeManager.refresh();
          sendResponse({ ok: true, success: true, state: STATES.INACTIVE });
          break;
        }
        case ACTIONS.SHOW_WHY_SECTION: {
          const pending = {
            action: ACTIONS.SCROLL_TO_WHY,
            tabId: message.tabId,
            modeId: message.modeId,
            timestamp: Date.now(),
          };

          await setToSession(STORAGE_KEYS.PENDING_POPUP, pending);

          const result = await tryOpenPopupOrFallback({
            fallback: 'openOptions',
            reason: 'openPopup_failed',
            modeId: message.modeId,
          });

          if (result.used === 'fallback' && result.error) {
            console.error('[SW] Failed to open popup for WHY section', result.error);
          }

          sendResponse({ success: true });
          break;
        }
        case ACTIONS.POPUP_READY: {
          const pending = await getFromSession(STORAGE_KEYS.PENDING_POPUP);

          if (pending?.action === ACTIONS.SCROLL_TO_WHY) {
            sendResponse({
              pendingAction: {
                action: ACTIONS.SCROLL_TO_WHY,
                tabId: pending.tabId,
                modeId: pending.modeId,
              },
              action: ACTIONS.SCROLL_TO_WHY,
            });

            await setToSession(STORAGE_KEYS.PENDING_POPUP, null);
          } else {
            sendResponse({ success: true });
          }

          break;
        }
        case ACTIONS.GET_PERFORMANCE_METRICS: {
          const metrics = await performanceMonitor.getAllMetrics();
          sendResponse({ metrics });
          break;
        }
        case ACTIONS.TEST_INJECT_SUGGESTION_BANNER: {
          const result = await handleTestInjectBanner(message);
          sendResponse(result);
          break;
        }
        case ACTIONS.TEST_CLEAR_SUGGESTION_BANNER: {
          const result = await handleTestClearBanner(message.tabId);
          sendResponse(result);
          break;
        }
        case ACTIONS.SMARTSCOPE_SET_CONFIG_V1: {
          const payload = message.payload || {};
          const result = await setSmartScopeConfig(payload);
          sendResponse(result);
          break;
        }
        case ACTIONS.SMARTSCOPE_RESET_V1: {
          const result = await resetSmartScopeEverywhere();
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.APPLY_CLASSES: {
          const { tabId, modeId, operations } = message;
          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          const result = await smartScopeApplyDomClasses(tabId, modeId, operations || []);
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.REMOVE_TOKEN: {
          const { tabId, modeId } = message;
          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          const result = await smartScopeRemoveDomToken(tabId, modeId);
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.VERIFY_SCOPE:
        case SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP: {
          if (typeof message.tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          try {
            const response = await chrome.tabs.sendMessage(message.tabId, message);
            if (message.modeId) {
              await recordSmartScopeStatus(message.tabId, message.modeId, normalizedAction === SMARTSCOPE_ACTIONS.VERIFY_SCOPE ? 'verify' : 'cleanup', response || {});
            }
            sendResponse(response);
          } catch (error) {
            const failure = { ok: false, error: error?.message || 'CS_UNREACHABLE' };
            if (message.modeId) {
              await recordSmartScopeStatus(message.tabId, message.modeId, normalizedAction === SMARTSCOPE_ACTIONS.VERIFY_SCOPE ? 'verify' : 'cleanup', failure);
            }
            sendResponse(failure);
          }
          break;
        }
        default:
          console.warn('[SW] Unknown action:', message.action);
          sendResponse({ error: 'Unknown action' });
          break;
      }
    },
    {
      onError: (error) => {
        sendResponse({ error: error?.message || 'Unhandled error' });
      },
    },
  );

  return true;
});

self.addEventListener('error', (event) => {
  console.error('[SW] Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});
