// content/content-main.js

// ========== SECTION 1: CONSTANTS ==========
// Shared constants loaded via service worker bridge
const AURA = {};
let debugTestHooksEnabled = false;
const pendingTestHooks = new Map();
const HEADING_FIX_ATTR = 'data-aura-heading-fix';
const HEADING_FIX_MAX = 120;
const HEADING_FIX_MAX_MS = 12;
const HEADING_CONTRAST_THRESHOLD = 4.5;
let headingFixSet = new Set();

function exposeAuraNamespace() {
  if (!debugTestHooksEnabled) {
    return;
  }

  if (typeof window !== 'undefined') {
    window.AURA = AURA;
  }
}

function applyPendingTestHooks() {
  if (!debugTestHooksEnabled) {
    return;
  }

  pendingTestHooks.forEach((value, key) => {
    AURA[key] = value;
  });
  pendingTestHooks.clear();
}

function setAuraTestHook(key, value) {
  if (!debugTestHooksEnabled) {
    pendingTestHooks.set(key, value);
    return;
  }

  exposeAuraNamespace();
  AURA[key] = value;
}

function updateDebugTestHooksEnabled(value) {
  debugTestHooksEnabled = value === true;
  if (debugTestHooksEnabled) {
    exposeAuraNamespace();
    applyPendingTestHooks();
  }
}

function setAuraReadyMarker() {
  try {
    const root = document.documentElement;

    if (root && root.dataset) {
      root.dataset.auraReady = '1';
    }
  } catch (error) {
    console.warn('[CS] Failed to set ready marker', error);
  }
}

setAuraReadyMarker();

function isExtContextValid() {
  return Boolean(globalThis.chrome?.runtime?.id && typeof chrome.runtime.getURL === 'function');
}

function safeGetURL(path) {
  if (!isExtContextValid()) {
    return null;
  }

  try {
    const url = chrome.runtime.getURL(path);
    if (typeof url === 'string' && url.includes('chrome-extension://invalid/')) {
      return null;
    }

    return url;
  } catch (error) {
    return null;
  }
}

function ensureAuraContentLoaded() {
  const alreadyLoaded = window.__AURA_CONTENT_MAIN_LOADED__ === true;

  if (alreadyLoaded) {
    const existingListener = window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__;

    if (typeof existingListener === 'function') {
      chrome.runtime.onMessage.removeListener(existingListener);
      chrome.runtime.onMessage.addListener(existingListener);
    }

    return { alreadyLoaded: true };
  }

  window.__AURA_CONTENT_MAIN_LOADED__ = true;

  return { alreadyLoaded: false };
}

const AURA_CONTENT_LOAD_STATE = ensureAuraContentLoaded();
const EARLY_PING_ACTION = 'TEST_PING_CONTENT';

if (typeof window !== 'undefined' && window.__AURA_CONTENT_READY_FOR_PING__ !== true) {
  window.__AURA_CONTENT_READY_FOR_PING__ = false;
}

function ensurePingListener() {
  if (typeof window === 'undefined' || !isExtContextValid()) {
    return;
  }

  const existingListener = window.__AURA_PING_LISTENER__;

  if (typeof existingListener === 'function') {
    chrome.runtime.onMessage.removeListener(existingListener);
    chrome.runtime.onMessage.addListener(existingListener);
    return;
  }

  const pingListener = (message, sender, sendResponse) => {
    const action = message?.action;
    const isPingAction =
      action === EARLY_PING_ACTION || (typeof ACTIONS !== 'undefined' && action === ACTIONS.TEST_PING_CONTENT);

    if (!isPingAction) {
      return false;
    }

    sendResponse({ ok: window.__AURA_CONTENT_READY_FOR_PING__ === true });
    return true;
  };

  window.__AURA_PING_LISTENER__ = pingListener;
  chrome.runtime.onMessage.addListener(pingListener);
}

ensurePingListener();

let BOOTSTRAP_ABORTED = false;
let BOOTSTRAP_ABORT_LOGGED = false;

(async function bootstrapAuraContentMain() {
  if (AURA_CONTENT_LOAD_STATE.alreadyLoaded) {
    return;
  }

let MODE_IDS = {};
let MODES = MODE_IDS;
let SIGNALS = {};
let ACTIONS = {};
let DECISIONS = {};
let SMARTSCOPE_ACTIONS = {};
let STORAGE_KEYS = {};
let MODE_PREFS_DEFAULTS = {};

const SHARED_CONSTANTS_REQUEST_TYPE = 'AURA_GET_SHARED_CONSTANTS_V1';
const SHARED_CONSTANTS_TIMEOUT_MS = 2000;
let sharedConstantsWarningLogged = false;

function logSharedConstantsWarning(reason, detail) {
  if (sharedConstantsWarningLogged) {
    return;
  }

  sharedConstantsWarningLogged = true;
  console.warn('[AURA][CS] Shared constants request failed', { reason, detail });
}

function loadSharedConstantsFromSW({ timeoutMs = SHARED_CONSTANTS_TIMEOUT_MS } = {}) {
  if (!isExtContextValid()) {
    return Promise.resolve({ ok: false, reason: 'EXT_CONTEXT_INVALID' });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish({ ok: false, reason: 'TIMEOUT' });
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage({ type: SHARED_CONSTANTS_REQUEST_TYPE }, (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || '';
          const reason = errorMessage.includes('Receiving end does not exist')
            ? 'NO_RECEIVER'
            : 'SW_ERROR';
          finish({ ok: false, reason, error: errorMessage });
          return;
        }

        if (!response || response.ok !== true || !response.constants) {
          finish({ ok: false, reason: response?.reason || 'NO_RECEIVER' });
          return;
        }

        finish({ ok: true, constants: response.constants });
      });
    } catch (error) {
      finish({ ok: false, reason: 'SW_ERROR', error });
    }
  });
}

setAuraTestHook('__TEST_LOAD_SHARED_CONSTANTS__', loadSharedConstantsFromSW);

const sharedConstantsResultPromise = (async () => {
  const result = await loadSharedConstantsFromSW();

  if (!result.ok) {
    logSharedConstantsWarning(result.reason, result.error);
  }

  return result;
})();

function applySharedConstants(constants) {
  if (!constants) {
    return;
  }

  MODE_IDS = constants.MODE_IDS || MODE_IDS;
  MODES = constants.MODES || MODE_IDS;
  SIGNALS = constants.SIGNALS || SIGNALS;
  ACTIONS = constants.ACTIONS || ACTIONS;
  DECISIONS = constants.DECISIONS || DECISIONS;
  SMARTSCOPE_ACTIONS = constants.SMARTSCOPE_ACTIONS || SMARTSCOPE_ACTIONS;
  STORAGE_KEYS = constants.STORAGE_KEYS || STORAGE_KEYS;
  MODE_PREFS_DEFAULTS = constants.MODE_PREFS_DEFAULTS || MODE_PREFS_DEFAULTS;

  AURA.ACTIONS = ACTIONS;
  AURA.MODES = MODES;
  AURA.MODE_IDS = MODE_IDS;
  AURA.SIGNALS = SIGNALS;
  AURA.SMARTSCOPE_ACTIONS = SMARTSCOPE_ACTIONS;
  AURA.DECISIONS = DECISIONS;
  AURA.STORAGE_KEYS = STORAGE_KEYS;
  AURA.MODE_PREFS_DEFAULTS = MODE_PREFS_DEFAULTS;
}

const READING_CONFIG = {
  SCROLL_THRESHOLD: 3,
  SCROLL_WINDOW: 10 * 1000,
  SELECTION_MIN_LENGTH: 20
};

const CONFIDENCE_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

const DEFAULT_TEST_CONFIDENCE = 0.75;

// ========== MODE ENGINE FEATURE FLAGS (canonical API) ==========
let modeEngineFlagDefaults = {};
let modeEngineFlagStorageKey = 'featureFlags';
let isFlagEnabled = (flagName) =>
  Object.prototype.hasOwnProperty.call(modeEngineFlagDefaults, flagName) && modeEngineFlagDefaults[flagName] === true;
let getAllModeEngineFlags = () => ({ ...modeEngineFlagDefaults });
let didLogFlagsLoadFailure = false;

async function loadFeatureFlagsFromSW({ timeoutMs = 2000 } = {}) {
  try {
    const res = await Promise.race([
      chrome.runtime.sendMessage({ type: 'AURA_GET_FEATURE_FLAGS_V1' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs)),
    ]);
    if (!res?.ok || !res?.flags) {
      return { ok: false, reason: res?.reason || 'NO_RECEIVER' };
    }
    return { ok: true, flags: res.flags };
  } catch (error) {
    return { ok: false, reason: error?.message === 'TIMEOUT' ? 'TIMEOUT' : 'SEND_FAILED' };
  }
}

setAuraTestHook('__TEST_LOAD_FEATURE_FLAGS__', loadFeatureFlagsFromSW);

const initModeEngineFlagApiResultPromise = (async function initModeEngineFlagApi() {
  const constantsResult = await sharedConstantsResultPromise;

  modeEngineDebugLog('initModeEngineFlagApi source', {
    constantsOk: constantsResult?.ok,
    constantsReason: constantsResult?.reason
  });

  if (!constantsResult?.ok) {
    return { ok: false, reason: constantsResult?.reason || 'EXT_CONTEXT_INVALID' };
  }

  const defaultFlags = { ...(constantsResult?.constants?.MODE_ENGINE_FLAG_DEFAULTS || {}) };
  const featureFlagsResult = await loadFeatureFlagsFromSW();
  const flags = featureFlagsResult.ok
    ? { ...defaultFlags, ...featureFlagsResult.flags }
    : { ...defaultFlags };
  if (!featureFlagsResult.ok && !didLogFlagsLoadFailure) {
    console.warn('[AURA][ModeEngine] Failed to load feature flags from service worker', {
      reason: featureFlagsResult.reason
    });
    didLogFlagsLoadFailure = true;
  }

  try {
    modeEngineFlagDefaults = { ...defaultFlags };
    modeEngineFlagStorageKey =
      constantsResult?.constants?.STORAGE_KEYS?.FEATURE_FLAGS || modeEngineFlagStorageKey;
    if (chrome?.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, modeEngineFlagStorageKey)) {
          maybeRunModeEngineV2();
        }
      });
    }

    isFlagEnabled = (flagName) => flags?.[flagName] === true;
    getAllModeEngineFlags = () => ({ ...flags });
    AURA.modeEngineFlags = {
      isEnabled: isFlagEnabled,
      getAll: getAllModeEngineFlags,
    };
    updateDebugTestHooksEnabled(typeof isFlagEnabled === 'function' && isFlagEnabled('debugTestHooks'));
    setAuraTestHook('__TEST_MODEENGINE_INIT__', initModeEngineFlagApiResultPromise);

    return { ok: true };
  } catch (error) {
    console.warn('[AURA][ModeEngine] Failed to initialize flag modules', error);
    return { ok: false, reason: 'IMPORT_FAILED' };
  }
})();

const MODE_ENGINE_DEBUG_PREFIX = '[AURA][ModeEngine]';

function modeEngineDebugLog(...args) {
  if (!isFlagEnabled('debugModeEngine')) {
    return;
  }

  console.log(MODE_ENGINE_DEBUG_PREFIX, ...args);
}

function recordModeEngineMetric(name, value, tags = {}) {
  if (!isFlagEnabled('debugModeEngine')) {
    return;
  }

  const safeName = typeof name === 'string' ? name : 'unknown';
  console.debug(`${MODE_ENGINE_DEBUG_PREFIX} metric:${safeName}`, { value, tags });
}

function markBootstrapAborted(reason = 'EXT_CONTEXT_INVALID') {
  if (BOOTSTRAP_ABORTED) {
    return;
  }

  BOOTSTRAP_ABORTED = true;

  if (typeof isFlagEnabled === 'function' && isFlagEnabled('debugModeEngine') && !BOOTSTRAP_ABORT_LOGGED) {
    console.warn('[AURA][BOOT] aborted', { reason, href: location.href });
    BOOTSTRAP_ABORT_LOGGED = true;
  }
}

AURA.modeEngineFlags = {
  isEnabled: isFlagEnabled,
  getAll: getAllModeEngineFlags,
};

AURA.modeEngineDebugLog = modeEngineDebugLog;
AURA.recordModeEngineMetric = recordModeEngineMetric;

const sharedConstantsResult = await sharedConstantsResultPromise;
if (!sharedConstantsResult.ok) {
  markBootstrapAborted(sharedConstantsResult.reason || 'EXT_CONTEXT_INVALID');
  return;
}

applySharedConstants(sharedConstantsResult.constants);

if (isFlagEnabled('debugModeEngine')) {
  console.info('[AURA][ME2] content-script alive', window.location?.href || '');
}

function logError(component, method, error) {
  console.error(`[${component}] ${method} error:`, error);
}

function createError(code, message) {
  return {
    code,
    message,
    timestamp: Date.now()
  };
}

AURA.READING_CONFIG = READING_CONFIG;
AURA.CONFIDENCE_LEVELS = CONFIDENCE_LEVELS;

// ========== SECTION 2A: SAFE MESSAGING & TEARDOWN ==========
const CONTEXT_INVALIDATED_MESSAGE = 'Extension context invalidated';
let AURA_CONTEXT_INVALIDATED = false;

let activeDetectors = [];
let activeBanner = null;
let activeRestoreButton = null;
let sitePolicyCache = null;
let sitePolicyRequest = null;
let sitePolicyWatcherEnabled = false;
const sitePolicySuppressionLoggedHosts = new Set();

const SITE_POLICY_CACHE_TTL_MS = 30 * 1000;
const SITE_POLICY_ERROR_TTL_MS = 5 * 1000;
const SITE_POLICY_REFRESH_DEBOUNCE_MS = 150;

function getCurrentHost() {
  try {
    return window.location?.hostname || '';
  } catch (error) {
    return '';
  }
}

function buildFallbackPolicy(host) {
  return {
    allowed: true,
    reason: 'UNKNOWN',
    host: host || null,
    blockedUntil: null,
    overrideUntil: null
  };
}

function getSitePolicyCacheTtl(cache) {
  return cache?.error ? SITE_POLICY_ERROR_TTL_MS : SITE_POLICY_CACHE_TTL_MS;
}

function isSitePolicyCacheFresh(cache, host) {
  if (!cache || !cache.policy || !host) {
    return false;
  }

  if (cache.host !== host) {
    return false;
  }

  const ttl = getSitePolicyCacheTtl(cache);
  return Date.now() - cache.fetchedAt < ttl;
}

async function fetchSitePolicy({ forceRefresh = false, reason = 'unknown' } = {}) {
  if (BOOTSTRAP_ABORTED || AURA_CONTEXT_INVALIDATED) {
    return { ok: false, policy: buildFallbackPolicy(getCurrentHost()) };
  }

  const host = getCurrentHost();
  if (!isFlagEnabled('siteSuppressV1')) {
    const policy = {
      allowed: true,
      reason: null,
      host: host || null,
      blockedUntil: null,
      overrideUntil: null
    };
    sitePolicyCache = {
      host: host || null,
      fetchedAt: Date.now(),
      policy,
      error: false
    };
    return { ok: true, policy, source: 'flag-off' };
  }

  if (!forceRefresh && isSitePolicyCacheFresh(sitePolicyCache, host)) {
    return { ok: true, policy: sitePolicyCache.policy, source: 'cache' };
  }

  if (sitePolicyRequest) {
    return sitePolicyRequest;
  }

  sitePolicyRequest = (async () => {
    if (typeof CURRENT_TAB_ID !== 'number') {
      const fallbackPolicy = buildFallbackPolicy(host);
      sitePolicyCache = {
        host,
        fetchedAt: Date.now(),
        policy: fallbackPolicy,
        error: true
      };
      return { ok: false, policy: fallbackPolicy, source: 'no-tab-id' };
    }

    const response = await safeSendMessage(
      {
        action: ACTIONS.GET_SITE_POLICY,
        tabId: CURRENT_TAB_ID,
        url: window.location?.href || ''
      },
      { contextLabel: `site-policy-${reason}` },
    );

    const fallbackPolicy = buildFallbackPolicy(host);
    const policy =
      response?.ok && response.policy && typeof response.policy.allowed === 'boolean'
        ? response.policy
        : fallbackPolicy;

    sitePolicyCache = {
      host: policy.host || host || null,
      fetchedAt: Date.now(),
      policy,
      error: !response?.ok
    };

    return { ok: Boolean(response?.ok), policy, source: response?.ok ? 'sw' : 'fallback' };
  })();

  try {
    return await sitePolicyRequest;
  } finally {
    sitePolicyRequest = null;
  }
}

function logPolicySuppressionOnce(policy, context) {
  const host = policy?.host || getCurrentHost();
  if (!host || sitePolicySuppressionLoggedHosts.has(host)) {
    return;
  }

  sitePolicySuppressionLoggedHosts.add(host);
  console.info('[CS] Suppressing AURA actions due to site policy', {
    host,
    reason: policy?.reason || 'POLICY_BLOCKED',
    context: context || 'unknown'
  });
}

async function ensureSitePolicyAllowed({ forceRefresh = false, context = 'unknown' } = {}) {
  const result = await fetchSitePolicy({ forceRefresh, reason: context });
  const policy = result?.policy;

  if (policy?.allowed === false) {
    logPolicySuppressionOnce(policy, context);
    if (activeBanner?.destroy) {
      activeBanner.destroy();
      activeBanner = null;
    }
    return false;
  }

  return true;
}

function scheduleSitePolicyRefresh(reason) {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  if (!sitePolicyCache) {
    sitePolicyCache = { host: null, fetchedAt: 0, policy: null, error: true };
  }

  if (sitePolicyCache.refreshTimer) {
    clearTimeout(sitePolicyCache.refreshTimer);
  }

  sitePolicyCache.refreshTimer = setTimeout(() => {
    fetchSitePolicy({ forceRefresh: true, reason }).then((result) => {
      if (result?.policy?.allowed === false && activeBanner?.destroy) {
        activeBanner.destroy();
        activeBanner = null;
      }
    });
  }, SITE_POLICY_REFRESH_DEBOUNCE_MS);
}

function startSitePolicyWatcher() {
  if (sitePolicyWatcherEnabled || typeof window === 'undefined') {
    return;
  }

  sitePolicyWatcherEnabled = true;

  let lastUrl = window.location?.href || '';
  const checkForUrlChange = (reason) => {
    const nextUrl = window.location?.href || '';
    if (nextUrl && nextUrl !== lastUrl) {
      lastUrl = nextUrl;
      scheduleSitePolicyRefresh(reason || 'spa');
    }
  };

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function pushStateWrapper(...args) {
    const result = originalPushState(...args);
    checkForUrlChange('pushState');
    return result;
  };

  history.replaceState = function replaceStateWrapper(...args) {
    const result = originalReplaceState(...args);
    checkForUrlChange('replaceState');
    return result;
  };

  window.addEventListener('popstate', () => checkForUrlChange('popstate'));
  window.addEventListener('hashchange', () => checkForUrlChange('hashchange'));

  scheduleSitePolicyRefresh('init');
}

function markContextInvalidated(reason = 'context-invalidated') {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  AURA_CONTEXT_INVALIDATED = true;
  if (debugTestHooksEnabled && typeof window !== 'undefined') {
    window.AURA_CONTEXT_INVALIDATED = true;
  }
  console.debug('[CS] Teardown triggered:', reason);
  performTeardown();
}

function performTeardown() {
  activeDetectors.forEach((detector) => {
    try {
      detector?.destroy?.();
    } catch (error) {
      console.warn('[CS] Detector teardown failed', error);
    }
  });
  activeDetectors = [];

  if (activeBanner) {
    try {
      activeBanner.destroy?.();
    } catch (error) {
      console.warn('[CS] Banner teardown failed', error);
    }
    activeBanner = null;
  }

  if (activeRestoreButton) {
    try {
      activeRestoreButton.remove?.();
    } catch (error) {
      console.warn('[CS] Restore button teardown failed', error);
    }
    activeRestoreButton = null;
  }

  stopSpaHooksV2IfRunning();

  teardownFocusOverlayV2({ destroyRoot: true });
}

function isContextInvalidatedError(errorMessage = '') {
  return errorMessage.includes(CONTEXT_INVALIDATED_MESSAGE);
}

function safeSendMessage(message, { contextLabel, callback } = {}) {
  if (BOOTSTRAP_ABORTED || AURA_CONTEXT_INVALIDATED) {
    return Promise.resolve(null);
  }

  const label = contextLabel ? ` [${contextLabel}]` : '';

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || '';

          if (isContextInvalidatedError(errorMessage)) {
            markContextInvalidated('messaging-context-invalidated');
            resolve(null);
            return;
          }

          console.error(`[CS] sendMessage error${label}:`, errorMessage);
          resolve(null);
          return;
        }

        const payload = response ?? null;

        if (typeof callback === 'function') {
          try {
            callback(payload);
          } catch (callbackError) {
            console.error(`[CS] sendMessage callback failed${label}:`, callbackError);
          }
        }

        resolve(payload);
      });
    } catch (error) {
      const errorMessage = error?.message || '';

      if (isContextInvalidatedError(errorMessage)) {
        markContextInvalidated('messaging-context-invalidated');
        resolve(null);
        return;
      }

      console.error(`[CS] sendMessage threw${label}:`, error);
      resolve(null);
    }
  });
}

const SILENT_WARNING_KEYS = {
  READY_V2: 'ready-v2',
  REAPPLY_V2: 'reapply-v2',
};
const silentWarningState = new Set();

function sendMessageSilently(message, { warnKey, warnMessage } = {}) {
  if (BOOTSTRAP_ABORTED || AURA_CONTEXT_INVALIDATED) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message || '';

          if (isContextInvalidatedError(errorMessage)) {
            markContextInvalidated('messaging-context-invalidated');
            resolve(null);
            return;
          }

          if (warnKey && !silentWarningState.has(warnKey)) {
            silentWarningState.add(warnKey);
            console.warn(warnMessage || '[CS] sendMessage warning', errorMessage);
          }
          resolve(null);
          return;
        }

        resolve(response ?? null);
      });
    } catch (error) {
      const errorMessage = error?.message || '';

      if (isContextInvalidatedError(errorMessage)) {
        markContextInvalidated('messaging-context-invalidated');
        resolve(null);
        return;
      }

      if (warnKey && !silentWarningState.has(warnKey)) {
        silentWarningState.add(warnKey);
        console.warn(warnMessage || '[CS] sendMessage warning', error);
      }
      resolve(null);
    }
  });
}

// ========== SECTION 2: TAB ID ACQUISITION ==========
let CURRENT_TAB_ID = null;
let contentReadySentV2 = false;

function notifyContentReadyV2(tabId) {
  if (AURA_CONTEXT_INVALIDATED || contentReadySentV2) {
    return;
  }

  if (typeof ACTIONS.CONTENT_SCRIPT_READY_V2 !== 'string' || typeof tabId !== 'number') {
    if (!silentWarningState.has(SILENT_WARNING_KEYS.READY_V2)) {
      silentWarningState.add(SILENT_WARNING_KEYS.READY_V2);
      console.warn('[CS] READY handshake skipped: missing action or tabId');
    }
    return;
  }

  contentReadySentV2 = true;
  sendMessageSilently(
    { action: ACTIONS.CONTENT_SCRIPT_READY_V2, tabId, url: location.href },
    { warnKey: SILENT_WARNING_KEYS.READY_V2, warnMessage: '[CS] READY handshake failed (cs-ready-v2)' },
  );
}

function requestV2Reapply(reason) {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  if (typeof ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES !== 'string') {
    if (!silentWarningState.has(SILENT_WARNING_KEYS.REAPPLY_V2)) {
      silentWarningState.add(SILENT_WARNING_KEYS.REAPPLY_V2);
      console.warn('[CS] V2 reapply request skipped: missing action');
    }
    return;
  }

  const safeReason = typeof reason === 'string' && reason.trim() ? reason : 'unknown';

  sendMessageSilently(
    { action: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES, reason: safeReason },
    { warnKey: SILENT_WARNING_KEYS.REAPPLY_V2, warnMessage: '[CS] V2 reapply request failed' },
  );
}

setAuraTestHook('__TEST_REQUEST_V2_REAPPLY__', requestV2Reapply);

initModeEngineFlagApiResultPromise
  .then((initResult) => {
    if (initResult && initResult.ok === false) {
      markBootstrapAborted(initResult.reason || 'EXT_CONTEXT_INVALID');
      return null;
    }

    return safeSendMessage({ action: ACTIONS.GET_TAB_ID }, { contextLabel: 'get-tab-id' }).then((response) => {
      if (!response || typeof response.tabId !== 'number') {
        console.error('[CS] Failed to acquire tabId: invalid response');
        return null;
      }

      CURRENT_TAB_ID = response.tabId;
      init();
      startSitePolicyWatcher();
      maybeRunModeEngineV2();
      startReadingRulerShortcut();
      handleReadingRulerStateChange().catch((error) => {
        modeEngineDebugLog('Reading ruler entry failed', error);
      });
      handleFocusNotObscuredStateChange().catch((error) => {
        modeEngineDebugLog('Focus not obscured entry failed', error);
      });
      notifyContentReadyV2(CURRENT_TAB_ID);
      return null;
    });
  })
  .catch(() => {
    markBootstrapAborted('EXT_CONTEXT_INVALID');
  });

// ========== SECTION 3: ZOOM DETECTOR (STUB) ==========
// Zoom detection handled entirely in Service Worker
class ZoomDetector {
  // Intentionally empty stub
}

// ========== SECTION 4: COLOR SCHEME DETECTOR ==========
class ColorSchemeDetector {
  constructor(tabId) {
    this.tabId = tabId;
    this.currentScheme = null;
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this._onChange = this.checkColorScheme.bind(this);
    this.init();
  }

  init() {
    if (typeof this.tabId !== 'number') {
      console.error('[CS] ColorSchemeDetector cannot init: missing tabId');
      return;
    }

    this.checkColorScheme();
    this.mediaQuery.addEventListener('change', this._onChange);
  }

  checkColorScheme() {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    const scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (scheme !== this.currentScheme) {
      this.currentScheme = scheme;
      safeSendMessage(
        {
          action: ACTIONS.SIGNAL_DETECTED,
          tabId: this.tabId,
          signal: SIGNALS.COLOR_SCHEME,
          value: scheme,
          timestamp: Date.now()
        },
        { contextLabel: 'signal-color-scheme' },
      );
    }
  }

  destroy() {
    try {
      this.mediaQuery.removeEventListener('change', this._onChange);
    } catch (error) {
      console.warn('[CS] Failed to remove color scheme listener', error);
    }
  }
}

// ========== SECTION 5: READING BEHAVIOR DETECTOR ==========
class ReadingBehaviorDetector {
  constructor(tabId) {
    this.tabId = tabId;
    this.scrollEvents = [];
    this._onScrollBound = this.onScroll.bind(this);
    this._onSelectionChangeBound = this.onSelectionChange.bind(this);
    this.init();
  }

  init() {
    if (typeof this.tabId !== 'number') {
      console.error('[CS] ReadingBehaviorDetector cannot init: missing tabId');
      return;
    }

    window.addEventListener('scroll', this._onScrollBound, { passive: true });
    document.addEventListener('selectionchange', this._onSelectionChangeBound);
  }

  onScroll() {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    const now = Date.now();
    this.scrollEvents.push(now);

    const windowStart = now - READING_CONFIG.SCROLL_WINDOW;
    this.scrollEvents = this.scrollEvents.filter((timestamp) => timestamp > windowStart);

    if (this.scrollEvents.length >= READING_CONFIG.SCROLL_THRESHOLD) {
      safeSendMessage(
        {
          action: ACTIONS.SIGNAL_DETECTED,
          tabId: this.tabId,
          signal: SIGNALS.READING_BEHAVIOR,
          value: 'rapid-scrolling',
          timestamp: now
        },
        { contextLabel: 'signal-reading-scroll' },
      );
      this.scrollEvents = [];
    }
  }

  onSelectionChange() {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : '';
    if (text.length >= READING_CONFIG.SELECTION_MIN_LENGTH) {
      safeSendMessage(
        {
          action: ACTIONS.SIGNAL_DETECTED,
          tabId: this.tabId,
          signal: SIGNALS.READING_BEHAVIOR,
          value: 'text-selection',
          timestamp: Date.now()
        },
        { contextLabel: 'signal-reading-selection' },
      );
    }
  }

  destroy() {
    window.removeEventListener('scroll', this._onScrollBound);
    document.removeEventListener('selectionchange', this._onSelectionChangeBound);
  }
}

// Expose classes
AURA.ZoomDetector = ZoomDetector;
AURA.ColorSchemeDetector = ColorSchemeDetector;
AURA.ReadingBehaviorDetector = ReadingBehaviorDetector;

// ========== SECTION 6: SUGGESTION BANNER ==========
const BANNER_POSITION = {
  TOP_RIGHT: 'top-right',
  BOTTOM_RIGHT: 'bottom-right'
};

function getModeMessage(modeId) {
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    return chrome.i18n.getMessage('bannerMessageComfort');
  }

  if (modeId === MODE_IDS.FOCUS) {
    return chrome.i18n.getMessage('bannerMessageFocus');
  }

  return chrome.i18n.getMessage('bannerTitle');
}

function getConfidenceDescriptor(score = 0) {
  if (score >= 0.85) {
    return { level: CONFIDENCE_LEVELS.HIGH, label: chrome.i18n.getMessage('bannerConfidenceHigh') || 'High confidence' };
  }

  if (score >= 0.7) {
    return { level: CONFIDENCE_LEVELS.MEDIUM, label: chrome.i18n.getMessage('bannerConfidenceMedium') || 'Medium confidence' };
  }

  return { level: CONFIDENCE_LEVELS.LOW, label: chrome.i18n.getMessage('bannerConfidenceLow') || 'Low confidence' };
}

function createButton(label, onActivate) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onActivate);
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  });
  return button;
}

class SuggestionBanner {
  constructor() {
    this.bannerHost = document.createElement('div');
    this.bannerHost.id = 'aura-suggestion-banner';
    this.bannerHost.setAttribute('aria-live', 'polite');
    this.bannerHost.setAttribute('role', 'status');

    this.shadowRoot = this.bannerHost.attachShadow({ mode: 'closed' });

    this.container = document.createElement('div');
    this.container.className = 'aura-banner';

    const style = document.createElement('style');
    style.textContent = `
      .aura-banner {
        position: fixed;
        top: 10px;
        right: 10px;
        max-width: 320px;
        background: #1f2937;
        color: #f9fafb;
        padding: 12px 14px;
        border-radius: 10px;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        z-index: 2147483647;
        display: grid;
        gap: 8px;
      }

      .aura-banner.bottom {
        top: auto;
        bottom: 10px;
      }

      .aura-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .aura-title {
        font-size: 15px;
        font-weight: 700;
        margin: 0;
      }

      .aura-confidence {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 12px;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }

      .confidence-low {
        background: rgba(234, 179, 8, 0.18);
        color: #facc15;
      }

      .confidence-medium {
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
      }

      .confidence-high {
        background: rgba(16, 185, 129, 0.2);
        color: #6ee7b7;
      }

      .aura-message {
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
      }

      .aura-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .aura-actions button,
      .aura-actions a {
        cursor: pointer;
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 14px;
        font-weight: 600;
        color: #111827;
        background: #f9fafb;
      }

      .aura-actions button:focus,
      .aura-actions a:focus {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
      }

      .aura-actions .secondary {
        background: #e5e7eb;
      }

      .aura-actions .danger {
        background: #fca5a5;
      }

      .aura-link {
        background: transparent;
        color: #bfdbfe;
        text-decoration: underline;
        padding: 0;
      }
    `;

    this.title = document.createElement('p');
    this.title.className = 'aura-title';
    this.title.textContent = chrome.i18n.getMessage('bannerTitle');

    this.confidence = document.createElement('span');
    this.confidence.className = 'aura-confidence confidence-low';
    this.confidence.textContent = chrome.i18n.getMessage('bannerConfidenceLow') || 'Low confidence';

    const header = document.createElement('div');
    header.className = 'aura-header';
    header.appendChild(this.title);
    header.appendChild(this.confidence);

    this.message = document.createElement('p');
    this.message.className = 'aura-message';

    this.actions = document.createElement('div');
    this.actions.className = 'aura-actions';

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(this.container);

    this.container.appendChild(header);
    this.container.appendChild(this.message);
    this.container.appendChild(this.actions);

    document.documentElement.appendChild(this.bannerHost);
  }

  setPosition(position) {
    if (position === BANNER_POSITION.BOTTOM_RIGHT) {
      this.container.classList.add('bottom');
    } else {
      this.container.classList.remove('bottom');
    }
  }

  updateConfidence(score) {
    const descriptor = getConfidenceDescriptor(score);
    this.confidence.textContent = `${chrome.i18n.getMessage('bannerConfidenceLabel') || 'Confidence'}: ${descriptor.label}`;
    this.confidence.className = `aura-confidence confidence-${descriptor.level}`;
  }

  async show({ modeId, score = 0, position = BANNER_POSITION.TOP_RIGHT }) {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    this.setPosition(position);
    this.title.textContent = chrome.i18n.getMessage('bannerTitle');
    this.message.textContent = getModeMessage(modeId);
    this.updateConfidence(score);

    while (this.actions.firstChild) {
      this.actions.removeChild(this.actions.firstChild);
    }

    const enableButton = createButton(chrome.i18n.getMessage('bannerButtonEnable'), () =>
      this.handleDecision(DECISIONS.ENABLED, modeId),
    );
    const notNowButton = createButton(chrome.i18n.getMessage('bannerButtonNotNow'), () =>
      this.handleDecision(DECISIONS.NOT_NOW, modeId),
    );
    notNowButton.classList.add('secondary');
    const neverButton = createButton(chrome.i18n.getMessage('bannerButtonNever'), () =>
      this.handleDecision(DECISIONS.NEVER, modeId),
    );
    neverButton.classList.add('danger');

    const whyLink = document.createElement('button');
    whyLink.type = 'button';
    whyLink.className = 'aura-link';
    whyLink.textContent = chrome.i18n.getMessage('bannerLinkWhy');
    whyLink.addEventListener('click', () => this.handleWhy(modeId));
    whyLink.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleWhy(modeId);
      }
    });

    this.actions.appendChild(enableButton);
    this.actions.appendChild(notNowButton);
    this.actions.appendChild(neverButton);
    this.actions.appendChild(whyLink);
  }

  async handleDecision(decision, modeId) {
    if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
      return;
    }

    if (!Object.values(DECISIONS).includes(decision)) {
      console.warn('[CS] Invalid decision payload', { decision, modeId });
      return;
    }

    await safeSendMessage(
      {
        action: ACTIONS.USER_DECISION,
        tabId: CURRENT_TAB_ID,
        modeId,
        decision
      },
      { contextLabel: 'banner-decision' },
    );

    this.destroy();
  }

  handleWhy(modeId) {
    if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
      return;
    }

    safeSendMessage(
      {
        action: ACTIONS.SHOW_WHY_SECTION,
        tabId: CURRENT_TAB_ID,
        modeId
      },
      { contextLabel: 'banner-why' },
    );
  }

  destroy() {
    if (this.bannerHost && this.bannerHost.parentNode) {
      this.bannerHost.parentNode.removeChild(this.bannerHost);
    }

    activeBanner = null;
  }
}

function ensureSuggestionBannerConstructor() {
  if (AURA.SuggestionBanner !== SuggestionBanner) {
    AURA.SuggestionBanner = SuggestionBanner;
  }
}

function normalizeTestConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULT_TEST_CONFIDENCE;
}

function handleTestPing() {
  return { ok: true };
}

function handleTestInjectSuggestionBanner(modeId, confidence, signals) {
  try {
    ensureSuggestionBannerConstructor();

    if (isAnyModeActive()) {
      hideSuggestionBannerIfPresent();
      return { ok: true, suppressed: true, reason: 'mode-active' };
    }

    if (typeof modeId !== 'string' || !modeId.trim()) {
      return { ok: false, error: createError('E006', 'Invalid modeId') };
    }

    if (!Object.values(MODE_IDS).includes(modeId)) {
      return { ok: false, error: createError('E006', 'Invalid modeId') };
    }

    const normalizedConfidence = normalizeTestConfidence(confidence);
    const normalizedSignals = Array.isArray(signals) ? signals : [];

    if (!activeBanner) {
      activeBanner = new AURA.SuggestionBanner();
    }

    activeBanner.show({
      modeId,
      score: normalizedConfidence,
      position: BANNER_POSITION.TOP_RIGHT,
      signals: normalizedSignals
    });

    const host = document.getElementById('aura-suggestion-banner');
    if (host) {
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
    }

    return { ok: true };
  } catch (error) {
    logError('content-main', 'handleTestInjectSuggestionBanner', error);
    return { ok: false, error: createError('E001', 'Banner inject failed (TEST)') };
  }
}

function handleTestClearSuggestionBanner() {
  try {
    hideSuggestionBannerIfPresent();
    return { ok: true };
  } catch (error) {
    logError('content-main', 'handleTestClearSuggestionBanner', error);
    return { ok: false, error: createError('E001', 'Banner clear failed (TEST)') };
  }
}

// ========== SECTION 7: RESTORE BUTTON ==========

class RestoreButton {
  constructor(modeId) {
    this.modeId = modeId;
    this.host = null;
    this.shadowRoot = null;
    this.button = null;
  }

  inject() {
    const existingButton = document.getElementById('aura-restore-button');
    if (existingButton && existingButton.parentNode) {
      existingButton.parentNode.removeChild(existingButton);
    }

    this.host = document.createElement('div');
    this.host.id = 'aura-restore-button';
    this.shadowRoot = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      button {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #667eea;
        color: #fff;
        border: none;
        padding: 12px 24px;
        border-radius: 24px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        cursor: pointer;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        font-weight: 600;
        z-index: 999998;
        transition: transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
        outline: none;
      }
      button:focus {
        outline: 2px solid #667eea;
        outline-offset: 2px;
      }
    `;

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = chrome.i18n.getMessage('restoreButtonText') || 'Restore';
    this.button.setAttribute('aria-label', 'Restore original page');

    const handleHoverIn = () => {
      this.button.style.backgroundColor = '#5568d3';
      this.button.style.transform = 'scale(1.05)';
      this.button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    };

    const handleHoverOut = () => {
      this.button.style.backgroundColor = '#667eea';
      this.button.style.transform = 'scale(1)';
      this.button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    };

    this.button.addEventListener('mouseenter', handleHoverIn);
    this.button.addEventListener('mouseleave', handleHoverOut);
    this.button.addEventListener('focus', handleHoverIn);
    this.button.addEventListener('blur', handleHoverOut);
    this.button.addEventListener('click', () => this.handleRestore());
    this.button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.handleRestore();
      }
    });

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(this.button);

    document.documentElement.appendChild(this.host);
  }

  async handleRestore() {
    if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
      return;
    }

    await safeSendMessage(
      {
        action: ACTIONS.RESTORE_MODE,
        tabId: CURRENT_TAB_ID,
        modeId: this.modeId
      },
      { contextLabel: 'restore-mode' },
    );

    this.remove();
  }

  remove() {
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }

    this.host = null;
    this.shadowRoot = null;
    this.button = null;

    if (activeRestoreButton === this) {
      activeRestoreButton = null;
    }
  }
}

function ensureRestoreButtonConstructor() {
  const ctor = AURA?.RestoreButton;
  if (typeof ctor !== 'function') {
    AURA.RestoreButton = RestoreButton;
    return;
  }

  try {
    const instance = new ctor('sanity-check');
    if (!(instance instanceof ctor)) {
      AURA.RestoreButton = RestoreButton;
    }
  } catch (error) {
    console.warn('[CS] Repairing RestoreButton constructor after failure', error);
    AURA.RestoreButton = RestoreButton;
  }
}

ensureRestoreButtonConstructor();
AURA.RestoreButton = AURA.RestoreButton || RestoreButton;

// ========== SECTION 8: SMARTSCOPE PAGE PROFILER V1 ==========
const MODE_ENGINE_SCOPE_OWNER = 'aura-me2';
const MODE_ENGINE_SCOPE_ATTR = 'data-aura-scope';
const MODE_ENGINE_SCOPE_OWNER_ATTR = 'data-aura-scope-owner';
const MODE_ENGINE_SCOPE_VALUE = '1';
const MODE_ENGINE_SCOPE_TOKENS_ATTR = 'data-aura-scope-tokens';
const MODE_ENGINE_ANIM_ATTR = 'data-aura-anim';
const MODE_ENGINE_ANIM_VALUE = '1';
const MODE_ENGINE_ANIM_GRACE_MS = 50;
const MODE_ENGINE_SMOOTH_TRANSITION_MS_DEFAULT = 160;
let modeEngineAnimDisarmTimerId = null;
let modeEngineAnimFrameId = null;

function clearModeEngineAnimTimers() {
  if (modeEngineAnimFrameId != null) {
    cancelAnimationFrame(modeEngineAnimFrameId);
  }
  modeEngineAnimFrameId = null;

  if (modeEngineAnimDisarmTimerId != null) {
    clearTimeout(modeEngineAnimDisarmTimerId);
  }
  modeEngineAnimDisarmTimerId = null;
}

function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

function disarmModeEngineAnim(scopeRoot) {
  clearModeEngineAnimTimers();

  if (!scopeRoot || typeof scopeRoot.removeAttribute !== 'function') {
    return;
  }

  try {
    scopeRoot.removeAttribute(MODE_ENGINE_ANIM_ATTR);
  } catch (_) {
    // noop - fail-safe for rare DOM attribute errors
  }
}

async function shouldReduceMotionForModeEngine() {
  if (prefersReducedMotion()) {
    return true;
  }

  try {
    const userPrefs = await loadUserPrefs();
    if (!userPrefs || typeof userPrefs !== 'object') {
      return false;
    }

    if (userPrefs.reducedMotion === true) {
      return true;
    }

    const comfortModeId = MODE_IDS.COMFORT_VISUAL || 'comfort-visual';
    const focusModeId = MODE_IDS.FOCUS || 'focus';
    const modePrefs = userPrefs.modePrefs;

    return (
      modePrefs?.[comfortModeId]?.reduceMotion === true || modePrefs?.[focusModeId]?.reduceMotion === true
    );
  } catch (error) {
    return false;
  }
}

function queueModeEngineAnimDisarm(scopeRoot, transitionMs = MODE_ENGINE_SMOOTH_TRANSITION_MS_DEFAULT) {
  if (!scopeRoot || typeof scopeRoot.setAttribute !== 'function') {
    return;
  }

  clearModeEngineAnimTimers();

  const disarmDelayMs =
    typeof transitionMs === 'number' && Number.isFinite(transitionMs) && transitionMs >= 0
      ? transitionMs + MODE_ENGINE_ANIM_GRACE_MS
      : MODE_ENGINE_SMOOTH_TRANSITION_MS_DEFAULT + MODE_ENGINE_ANIM_GRACE_MS;

  modeEngineAnimFrameId = requestAnimationFrame(() => {
    modeEngineAnimDisarmTimerId = setTimeout(() => {
      modeEngineAnimDisarmTimerId = null;
      disarmModeEngineAnim(scopeRoot);
    }, disarmDelayMs);
  });
}

async function armModeEngineAnim(scopeRoot, transitionMs = MODE_ENGINE_SMOOTH_TRANSITION_MS_DEFAULT) {
  if (!scopeRoot || typeof scopeRoot.setAttribute !== 'function') {
    return;
  }

  const reduceMotion = await shouldReduceMotionForModeEngine();
  if (reduceMotion) {
    disarmModeEngineAnim(scopeRoot);
    return;
  }

  clearModeEngineAnimTimers();

  try {
    scopeRoot.setAttribute(MODE_ENGINE_ANIM_ATTR, MODE_ENGINE_ANIM_VALUE);
  } catch (_) {
    return;
  }

  queueModeEngineAnimDisarm(scopeRoot, transitionMs);
}

function escapeSelectorValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
    return globalThis.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function applyScopeTokenToRoot(root) {
  if (!root || typeof root.setAttribute !== 'function') {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'invalid-root' };
  }

  const previous = AURA.modeEngineScopeRoot;
  if (previous && previous !== root && typeof previous.removeAttribute === 'function') {
    clearHeadingFixes();
    const previousTokens = Array.isArray(AURA.modeEngineScopeTokens) ? AURA.modeEngineScopeTokens : [];
    previousTokens.forEach((token) => {
      if (previous?.style?.removeProperty) {
        previous.style.removeProperty(token);
      }
    });
    previous.removeAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR);
    previous.removeAttribute(MODE_ENGINE_SCOPE_ATTR);
    previous.removeAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR);
  }

  root.setAttribute(MODE_ENGINE_SCOPE_ATTR, MODE_ENGINE_SCOPE_VALUE);
  root.setAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR, MODE_ENGINE_SCOPE_OWNER);
  if (root.getAttribute(MODE_ENGINE_SCOPE_ATTR) !== MODE_ENGINE_SCOPE_VALUE) {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'setAttribute failed' };
  }

  AURA.modeEngineScopeRoot = root;
  AURA.modeEngineScopeTokens = AURA.modeEngineScopeTokens || [];
  return { ok: true };
}

function getStoredScopeRoot() {
  const stored = AURA?.modeEngineScopeRoot;
  if (stored && typeof stored.setAttribute === 'function' && stored.isConnected !== false) {
    return stored;
  }

  const fallback = document.querySelector(
    `[${MODE_ENGINE_SCOPE_ATTR}="${MODE_ENGINE_SCOPE_VALUE}"][${MODE_ENGINE_SCOPE_OWNER_ATTR}="${MODE_ENGINE_SCOPE_OWNER}"]`,
  );
  if (fallback) {
    AURA.modeEngineScopeRoot = fallback;
  }
  return fallback || null;
}

const CONTRAST_MIN_RATIO = 4.5;
const CONTRAST_SAMPLE_LIMIT = 6;
const CONTRAST_REPORT_SAMPLE_LIMIT = 30;
let lastContrastReportAttemptId = null;

function parseCssColorValue(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('#')) {
    return parseHexColorValue(trimmed);
  }

  if (trimmed.startsWith('rgb')) {
    return parseRgbColorValue(trimmed);
  }

  return null;
}

function parseHexColorValue(value) {
  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return { r, g, b, a: 1 };
  }

  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return { r, g, b, a: 1 };
  }

  return null;
}

function parseRgbColorValue(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  const a = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;

  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return {
    r: clampChannelValue(r),
    g: clampChannelValue(g),
    b: clampChannelValue(b),
    a: clampAlphaValue(a),
  };
}

function clampChannelValue(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlphaValue(value) {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

function blendColorsValue(foreground, background) {
  if (!foreground || !background) {
    return null;
  }

  const alpha = clampAlphaValue(foreground.a ?? 1);
  const bgAlpha = clampAlphaValue(background.a ?? 1);
  if (alpha >= 1 && bgAlpha >= 1) {
    return { r: foreground.r, g: foreground.g, b: foreground.b, a: 1 };
  }

  const outAlpha = alpha + bgAlpha * (1 - alpha);
  if (outAlpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const r = (foreground.r * alpha + background.r * bgAlpha * (1 - alpha)) / outAlpha;
  const g = (foreground.g * alpha + background.g * bgAlpha * (1 - alpha)) / outAlpha;
  const b = (foreground.b * alpha + background.b * bgAlpha * (1 - alpha)) / outAlpha;

  return {
    r: clampChannelValue(r),
    g: clampChannelValue(g),
    b: clampChannelValue(b),
    a: outAlpha,
  };
}

function relativeLuminanceValue(color) {
  if (!color) {
    return null;
  }

  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function computeContrastRatioValue(foreground, background) {
  const fg = foreground?.a != null && foreground.a < 1 ? blendColorsValue(foreground, background) : foreground;
  if (!fg || !background) {
    return null;
  }

  const lum1 = relativeLuminanceValue(fg);
  const lum2 = relativeLuminanceValue(background);
  if (lum1 == null || lum2 == null) {
    return null;
  }

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveFallbackBackgroundColor(scopeRoot) {
  const doc = scopeRoot?.ownerDocument;
  if (!doc) {
    return null;
  }

  const bodyColor = doc.body ? parseCssColorValue(getComputedStyle(doc.body).backgroundColor) : null;
  if (bodyColor && bodyColor.a > 0) {
    return bodyColor;
  }

  const htmlColor = doc.documentElement
    ? parseCssColorValue(getComputedStyle(doc.documentElement).backgroundColor)
    : null;
  if (htmlColor && htmlColor.a > 0) {
    return htmlColor;
  }

  return null;
}

function resolveElementBackgroundColor(element, fallbackBackground) {
  if (!element) {
    return null;
  }

  const style = getComputedStyle(element);
  const background = parseCssColorValue(style.backgroundColor);
  if (!background) {
    return fallbackBackground || null;
  }

  if (background.a >= 1) {
    return background;
  }

  if (fallbackBackground) {
    return blendColorsValue(background, fallbackBackground);
  }

  return background.a > 0 ? background : null;
}

function resolveHeadingBackgroundColor(element, fallbackBackground) {
  if (!element) {
    return fallbackBackground || null;
  }

  let current = element instanceof Element ? element : null;
  while (current) {
    const style = getComputedStyle(current);
    const background = parseCssColorValue(style.backgroundColor);
    if (background && background.a > 0) {
      if (background.a < 1 && fallbackBackground) {
        return blendColorsValue(background, fallbackBackground);
      }
      return background;
    }
    current = current.parentElement;
  }

  return fallbackBackground || null;
}

function fixUnreadableHeadings(scopeRoot) {
  if (!scopeRoot || !scopeRoot.isConnected) {
    return;
  }

  const headings = scopeRoot.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]');
  if (!headings.length) {
    return;
  }

  const fallbackBackground = resolveFallbackBackgroundColor(scopeRoot);
  const scopeBackground = resolveElementBackgroundColor(scopeRoot, fallbackBackground);
  const maxMs = HEADING_FIX_MAX_MS;
  const start = performance.now();
  let scanned = 0;

  for (const heading of headings) {
    if (scanned >= HEADING_FIX_MAX) {
      break;
    }

    scanned += 1;

    if (performance.now() - start > maxMs) {
      break;
    }

    if (!(heading instanceof Element)) {
      continue;
    }

    const style = getComputedStyle(heading);
    const textColor = parseCssColorValue(style.color);
    if (!textColor) {
      continue;
    }

    const backgroundColor = resolveHeadingBackgroundColor(heading, scopeBackground || fallbackBackground);
    if (!backgroundColor) {
      continue;
    }

    const resolvedText =
      textColor.a != null && textColor.a < 1 ? blendColorsValue(textColor, backgroundColor) : textColor;
    if (!resolvedText) {
      continue;
    }

    const contrastRatio = computeContrastRatioValue(resolvedText, backgroundColor);
    if (typeof contrastRatio !== 'number' || contrastRatio >= HEADING_CONTRAST_THRESHOLD) {
      continue;
    }

    heading.style.setProperty('color', 'var(--aura-text-color)', 'important');
    heading.style.setProperty('-webkit-text-fill-color', 'var(--aura-text-color)', 'important');
    heading.setAttribute(HEADING_FIX_ATTR, '1');
    headingFixSet.add(heading);
  }
}

function clearHeadingFixes() {
  if (!headingFixSet || headingFixSet.size === 0) {
    headingFixSet = new Set();
    return;
  }

  headingFixSet.forEach((heading) => {
    if (!heading || !(heading instanceof Element) || !heading.isConnected) {
      return;
    }

    if (heading.style?.removeProperty) {
      heading.style.removeProperty('color');
      heading.style.removeProperty('-webkit-text-fill-color');
    }

    heading.removeAttribute(HEADING_FIX_ATTR);
  });

  headingFixSet = new Set();
}

function measureScopeContrast(sampleLimit = CONTRAST_SAMPLE_LIMIT) {
  const scopeRoot = getStoredScopeRoot();
  if (!scopeRoot) {
    return { ok: false, reason: 'scope-root-missing' };
  }

  const fallbackBackground = resolveFallbackBackgroundColor(scopeRoot);
  const candidates = [scopeRoot, ...Array.from(scopeRoot.querySelectorAll('p')).slice(0, sampleLimit)];
  let minRatio = null;
  let sampleCount = 0;

  candidates.forEach((element) => {
    const style = getComputedStyle(element);
    const textColor = parseCssColorValue(style.color);
    const backgroundColor = resolveElementBackgroundColor(element, fallbackBackground);

    if (!textColor || !backgroundColor) {
      return;
    }

    const resolvedText =
      textColor.a != null && textColor.a < 1 ? blendColorsValue(textColor, backgroundColor) : textColor;
    if (!resolvedText) {
      return;
    }

    const ratio = computeContrastRatioValue(resolvedText, backgroundColor);
    if (typeof ratio === 'number') {
      sampleCount += 1;
      minRatio = minRatio == null ? ratio : Math.min(minRatio, ratio);
    }
  });

  if (!sampleCount || minRatio == null) {
    return { ok: false, reason: 'no-samples' };
  }

  return {
    ok: true,
    minRatio,
    sampleCount,
    threshold: CONTRAST_MIN_RATIO,
  };
}

async function buildContrastReport(sampleLimit = CONTRAST_REPORT_SAMPLE_LIMIT) {
  const scopeRoot = getStoredScopeRoot();
  if (!scopeRoot) {
    return { ok: false, reason: 'scope-root-missing' };
  }

  const runtimeModule = await loadScopedVerifierModule();
  const sampler = runtimeModule?.sampleContrast;
  if (typeof sampler !== 'function') {
    return { ok: false, reason: 'contrast-sampler-missing' };
  }

  const report = sampler(scopeRoot, sampleLimit);
  if (!report || typeof report !== 'object') {
    return { ok: false, reason: 'contrast-sampler-invalid' };
  }

  const minRatio = typeof report.minRatio === 'number' ? report.minRatio : null;
  const samples = typeof report.samples === 'number' ? report.samples : report.sampleCount;
  if (minRatio == null) {
    return { ok: false, reason: 'contrast-sampler-invalid' };
  }

  return {
    ok: report.ok === true,
    minRatio,
    samples: typeof samples === 'number' ? samples : 0,
    isDark: report.isDark === true,
  };
}

async function sendContrastReport(modeId, attemptId) {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return;
  }

  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return;
  }

  if (typeof attemptId === 'number') {
    if (attemptId === lastContrastReportAttemptId) {
      return;
    }
    lastContrastReportAttemptId = attemptId;
  }

  const report = await buildContrastReport(CONTRAST_REPORT_SAMPLE_LIMIT);
  if (!report || typeof report.minRatio !== 'number') {
    return;
  }

  chrome.runtime.sendMessage({
    action: ACTIONS.MODE_ENGINE_V2_CONTRAST_REPORT,
    tabId: CURRENT_TAB_ID,
    modeId,
    report,
  });
}

function isDarkFromTokenMap(tokenMap) {
  if (!tokenMap || typeof tokenMap !== 'object') {
    return false;
  }

  return tokenMap['--aura-color-scheme'] === 'dark';
}

function resetDarkRescanBudget(now = Date.now()) {
  darkRescanWindowStart = now;
  darkRescanCount = 0;
}

function canPerformDarkRescan(now = Date.now()) {
  if (!darkRescanWindowStart || now - darkRescanWindowStart > DARK_SURFACE_RESCAN_WINDOW_MS) {
    resetDarkRescanBudget(now);
  }
  return darkRescanCount < DARK_SURFACE_MAX_RESCANS_PER_MIN;
}

function applyDarkSurfaceTagsSafe(scopeRoot, source = 'apply', budget = DARK_SURFACE_SCAN_BUDGET) {
  if (!scopeRoot) {
    return;
  }

  const runtimeModule = globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
  const applyDarkSurfaceTags = runtimeModule?.applyDarkSurfaceTags;
  if (typeof applyDarkSurfaceTags !== 'function') {
    return;
  }

  try {
    applyDarkSurfaceTags(scopeRoot, budget);
  } catch (error) {
    modeEngineDebugLog(`Dark surface scan failed (${source})`, error);
  }
}

function applyDarkSurfaceInlineOverridesSafe(scopeRoot, source = 'apply') {
  if (!scopeRoot) {
    return;
  }

  const runtimeModule = globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
  const applyDarkSurfaceInlineOverrides = runtimeModule?.applyDarkSurfaceInlineOverrides;
  if (typeof applyDarkSurfaceInlineOverrides !== 'function') {
    return;
  }

  try {
    applyDarkSurfaceInlineOverrides(scopeRoot);
  } catch (error) {
    modeEngineDebugLog(`Inline dark surface override failed (${source})`, error);
  }
}

function clearDarkSurfaceInlineOverridesSafe(source = 'cleanup') {
  const runtimeModule = globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
  const clearDarkSurfaceInlineOverrides = runtimeModule?.clearDarkSurfaceInlineOverrides;
  if (typeof clearDarkSurfaceInlineOverrides !== 'function') {
    return;
  }

  try {
    clearDarkSurfaceInlineOverrides();
  } catch (error) {
    modeEngineDebugLog(`Inline dark surface cleanup failed (${source})`, error);
  }
}

function clearDarkSurfaceTagsSafe(scopeRoot, source = 'cleanup') {
  if (!scopeRoot) {
    return;
  }

  const runtimeModule = globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
  const clearDarkSurfaceTags = runtimeModule?.clearDarkSurfaceTags;
  if (typeof clearDarkSurfaceTags !== 'function') {
    return;
  }

  try {
    clearDarkSurfaceTags(scopeRoot, DARK_SURFACE_SCAN_BUDGET);
  } catch (error) {
    modeEngineDebugLog(`Dark surface cleanup failed (${source})`, error);
  }
}

function clearDarkInlineSliceTimers() {
  if (darkInlineSliceTimers.length) {
    darkInlineSliceTimers.forEach((timerId) => clearTimeout(timerId));
  }
  darkInlineSliceTimers = [];
}

function clearDarkInitialApplyTimers() {
  if (darkInitialApplyTimers.length) {
    darkInitialApplyTimers.forEach((timerId) => {
      if (timerId?.type === 'idle' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(timerId.id);
        return;
      }
      clearTimeout(timerId.id);
    });
  }
  darkInitialApplyTimers = [];
}

function stopDarkInitialApplyPasses() {
  clearDarkInitialApplyTimers();
  darkInitialApplyPassCount = 0;
  darkInitialApplyScopeRoot = null;
}

function shouldRunDarkInitialPass(scopeRoot) {
  if (!scopeRoot || !scopeRoot.isConnected) {
    return false;
  }

  if (darkInitialApplyScopeRoot && darkInitialApplyScopeRoot !== scopeRoot) {
    return false;
  }

  return getModeActive(MODE_IDS.COMFORT_VISUAL) !== false;
}

function scheduleDarkInitialPass(scopeRoot, delayMs, source, budget) {
  const runPass = () => {
    if (!shouldRunDarkInitialPass(scopeRoot)) {
      return;
    }
    darkInitialApplyPassCount += 1;
    applyDarkSurfaceTagsSafe(scopeRoot, source, budget);
  };

  if (typeof requestIdleCallback === 'function') {
    const idleId = requestIdleCallback(runPass, { timeout: delayMs + 200 });
    darkInitialApplyTimers.push({ type: 'idle', id: idleId });
    return;
  }

  const timerId = setTimeout(runPass, delayMs);
  darkInitialApplyTimers.push({ type: 'timeout', id: timerId });
}

function scheduleDarkInitialApplyPasses(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  stopDarkInitialApplyPasses();
  darkInitialApplyScopeRoot = scopeRoot;

  applyDarkSurfaceTagsSafe(scopeRoot, 'apply-initial', DARK_SURFACE_INITIAL_SCAN_BUDGET);

  for (let i = 0; i < DARK_SURFACE_INITIAL_EXTRA_PASSES; i += 1) {
    const delayMs = DARK_SURFACE_INITIAL_PASS_DELAYS_MS[i] || 0;
    scheduleDarkInitialPass(scopeRoot, delayMs, 'apply-initial-pass', DARK_SURFACE_INITIAL_EXTRA_BUDGET);
  }
}

function stopDarkObservers() {
  if (darkInlineObserver) {
    darkInlineObserver.disconnect();
  }
  darkInlineObserver = null;
  darkInlineObservedScopeRoot = null;

  if (darkInlineDebounceTimer) {
    clearTimeout(darkInlineDebounceTimer);
  }
  darkInlineDebounceTimer = null;

  if (darkInlineThrottleTimer) {
    clearTimeout(darkInlineThrottleTimer);
  }
  darkInlineThrottleTimer = null;

  clearDarkInlineSliceTimers();
  darkInlineNextAllowedAt = 0;
}

function runDarkInlineRescan(scopeRoot, source = 'observer') {
  if (!scopeRoot) {
    return;
  }

  const now = Date.now();
  if (darkInlineNextAllowedAt && now < darkInlineNextAllowedAt) {
    if (!darkInlineThrottleTimer) {
      const waitMs = darkInlineNextAllowedAt - now;
      darkInlineThrottleTimer = setTimeout(() => {
        darkInlineThrottleTimer = null;
        runDarkInlineRescan(scopeRoot, source);
      }, waitMs);
    }
    return;
  }

  darkInlineNextAllowedAt = now + DARK_INLINE_RESCAN_MIN_INTERVAL_MS;
  applyDarkSurfaceInlineOverridesSafe(scopeRoot, source);
}

function scheduleDarkInlineDebouncedRescan(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  if (darkInlineDebounceTimer) {
    clearTimeout(darkInlineDebounceTimer);
  }

  darkInlineDebounceTimer = setTimeout(() => {
    darkInlineDebounceTimer = null;
    runDarkInlineRescan(scopeRoot, 'observer');
  }, DARK_INLINE_DEBOUNCE_MS);
}

function scheduleDarkInlineSliceRescans(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  clearDarkInlineSliceTimers();

  DARK_INLINE_RESCAN_DELAYS_MS.forEach((delayMs) => {
    const timerId = setTimeout(() => {
      darkInlineSliceTimers = darkInlineSliceTimers.filter((entry) => entry !== timerId);
      runDarkInlineRescan(scopeRoot, 'slice');
    }, delayMs);
    darkInlineSliceTimers.push(timerId);
  });
}

function startDarkObservers(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  if (darkInlineObserver && darkInlineObservedScopeRoot === scopeRoot) {
    return;
  }

  stopDarkObservers();
  darkInlineObservedScopeRoot = scopeRoot;

  try {
    darkInlineObserver = new MutationObserver(() => {
      scheduleDarkInlineDebouncedRescan(scopeRoot);
    });
    darkInlineObserver.observe(scopeRoot, { childList: true, subtree: true, attributes: false });
  } catch (error) {
    modeEngineDebugLog('Inline dark surface observer failed', error);
    stopDarkObservers();
  }
}

function teardownDarkObserver() {
  if (darkObserver) {
    darkObserver.disconnect();
  }
  darkObserver = null;
  darkObservedScopeRoot = null;

  if (darkRescanTimer) {
    clearTimeout(darkRescanTimer);
  }
  darkRescanTimer = null;
  darkRescanCount = 0;
  darkRescanWindowStart = 0;
}

function performDarkRescan(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  const now = Date.now();
  if (!canPerformDarkRescan(now)) {
    return;
  }

  darkRescanCount += 1;
  applyDarkSurfaceTagsSafe(scopeRoot, 'observer');
}

function scheduleDarkRescan(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  if (darkRescanTimer) {
    clearTimeout(darkRescanTimer);
  }
  darkRescanTimer = setTimeout(() => {
    darkRescanTimer = null;
    performDarkRescan(scopeRoot);
  }, DARK_SURFACE_DEBOUNCE_MS);
}

function ensureDarkObserver(scopeRoot) {
  if (!scopeRoot) {
    return;
  }

  if (darkObserver && darkObservedScopeRoot === scopeRoot) {
    return;
  }

  teardownDarkObserver();
  darkObservedScopeRoot = scopeRoot;

  try {
    darkObserver = new MutationObserver(() => {
      scheduleDarkRescan(scopeRoot);
    });
    darkObserver.observe(scopeRoot, { childList: true, subtree: true, attributes: false });
  } catch (error) {
    modeEngineDebugLog('Dark surface observer failed', error);
    teardownDarkObserver();
  }
}

async function applyScopeTokensToStoredRoot(tokenMap = {}, ownerKey = MODE_ENGINE_SCOPE_OWNER, options = {}) {
  const scopeRoot = getStoredScopeRoot();
  if (!scopeRoot) {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'scope-root-missing' };
  }

  const module = await loadScopedVerifierModule();
  const applyScopedTokens = module?.applyScopedTokens;
  if (typeof applyScopedTokens !== 'function') {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'applyScopedTokens missing' };
  }

  await armModeEngineAnim(scopeRoot, options?.transitionMs);

  const result = applyScopedTokens(scopeRoot, tokenMap, ownerKey);
  if (!result?.ok) {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: result?.reason || 'apply-failed' };
  }

  AURA.modeEngineScopeTokens = result.ownedKeys || Object.keys(tokenMap || {});
  if (scopeRoot.getAttribute(MODE_ENGINE_ANIM_ATTR) === MODE_ENGINE_ANIM_VALUE) {
    queueModeEngineAnimDisarm(scopeRoot, options?.transitionMs);
  }
  return { ok: true, applied: result.applied, ownedKeys: AURA.modeEngineScopeTokens };
}

async function cleanupScopeTokensFromStoredRoot(ownerKey = MODE_ENGINE_SCOPE_OWNER, options = {}) {
  const scopeRoot = getStoredScopeRoot();
  if (!scopeRoot) {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'scope-root-missing' };
  }

  const module = await loadScopedVerifierModule();
  const cleanupScopedTokens = module?.cleanupScopedTokens;
  if (typeof cleanupScopedTokens !== 'function') {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: 'cleanupScopedTokens missing' };
  }

  const ownedKeys = Array.isArray(AURA?.modeEngineScopeTokens) ? AURA.modeEngineScopeTokens : [];
  const result = cleanupScopedTokens(scopeRoot, ownerKey, ownedKeys, options);
  if (!result?.ok && result?.reason === 'not-owner') {
    const removedKeys = ownedKeys.filter((token) => {
      if (!scopeRoot?.style?.removeProperty) {
        return false;
      }
      scopeRoot.style.removeProperty(token);
      return true;
    });
    return {
      ok: true,
      removed: removedKeys.length,
      scopeUnmarked: false,
      reason: 'not-owner',
    };
  }
  if (!result?.ok) {
    return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: result?.reason || 'cleanup-failed' };
  }

  const scopeUnmarked = scopeRoot.getAttribute(MODE_ENGINE_SCOPE_ATTR) !== MODE_ENGINE_SCOPE_VALUE;
  AURA.modeEngineScopeTokens = [];
  return { ok: true, removed: result.removed, scopeUnmarked };
}

async function handleModeEngineV2VerifyScopeRoot(selector) {
  const source = 'verifyScopeRoot';
  if (typeof selector !== 'string' || !selector.trim()) {
    return { ok: false, error: 'VERIFY_SCOPE_ROOT_FAILED', detail: 'invalid-selector', source };
  }

  const module = await loadScopedVerifierModule();
  if (!module) {
    return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-verifier-runtime-missing', source };
  }

  const verifyScopeRootBySelector = module.verifyScopeRootBySelector;
  if (typeof verifyScopeRootBySelector !== 'function') {
    return { ok: false, error: 'INTERNAL_ERROR', detail: 'verifyScopeRootBySelector missing', source };
  }

  try {
    const result = verifyScopeRootBySelector(selector);
    if (!result || typeof result !== 'object') {
      return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result', source };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: 'VERIFY_SCOPE_ROOT_FAILED',
        detail: result.reason || result.detail || 'verifyScopeRoot failed',
        source,
      };
    }
    return { ...result, source };
  } catch (error) {
    return {
      ok: false,
      error: 'VERIFY_SCOPE_ROOT_FAILED',
      detail: error?.message || 'verifyScopeRoot failed',
      source,
    };
  }
}

async function handleModeEngineV2SetScopeRoot(selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    return { ok: false, reason: 'invalid-selector' };
  }

  let element;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    return { ok: false, reason: 'invalid-selector' };
  }

  if (!element) {
    return { ok: false, reason: 'ELEMENT_NOT_FOUND' };
  }

  if (element === document.documentElement || element === document.body) {
    return { ok: false, reason: 'TRIVIAL_SCOPE' };
  }

  const tokenResult = applyScopeTokenToRoot(element);
  if (!tokenResult?.ok) {
    return {
      ok: false,
      error: tokenResult.error,
      detail: tokenResult.detail,
    };
  }

  return { ok: true };
}

async function handleModeEngineV2SalvageScopeRoot(selector, debugEnabled) {
  const source = 'salvageScopeRoot';
  if (typeof selector !== 'string' || !selector.trim()) {
    return { ok: false, error: 'SALVAGE_SCOPE_ROOT_FAILED', detail: 'invalid-selector', source };
  }

  const module = await loadScopedVerifierModule();
  if (!module) {
    return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-verifier-runtime-missing', source };
  }

  const salvageScopeRootBySelector = module.salvageScopeRootBySelector;
  if (typeof salvageScopeRootBySelector !== 'function') {
    return { ok: false, error: 'INTERNAL_ERROR', detail: 'salvageScopeRootBySelector missing', source };
  }

  try {
    const result = salvageScopeRootBySelector(selector, debugEnabled);
    if (!result || typeof result !== 'object') {
      return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result', source };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: 'SALVAGE_SCOPE_ROOT_FAILED',
        detail: result.reason || result.detail || 'salvageScopeRoot failed',
        source,
      };
    }
    const normalized = { ...result };
    if (typeof normalized.selector !== 'string' || !normalized.selector.trim()) {
      normalized.selector = selector;
    }
    if (typeof normalized.tried !== 'boolean') {
      normalized.tried = true;
    }
    return { ...normalized, source };
  } catch (error) {
    return {
      ok: false,
      error: 'SALVAGE_SCOPE_ROOT_FAILED',
      detail: error?.message || 'salvageScopeRoot failed',
      source,
    };
  }
}

function buildScopeSelectorHint(element) {
  if (!element || !(element instanceof Element)) {
    return 'body';
  }

  if (element.id) {
    return `${element.tagName.toLowerCase()}#${escapeSelectorValue(element.id)}`;
  }

  const firstClass = (element.className || '').split(' ').filter(Boolean)[0];
  if (firstClass) {
    return `${element.tagName.toLowerCase()}.${escapeSelectorValue(firstClass)}`;
  }

  return element.tagName.toLowerCase();
}

function hashString(input) {
  let hash = 0;
  const text = input || '';

  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  return `h${Math.abs(hash)}`;
}

function buildScopeKey(element) {
  if (!element || !(element instanceof Element)) {
    return 'body:h0';
  }

  const parts = [];
  let current = element;
  let depth = 0;

  while (current && depth < 5) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    } else if (current.classList && current.classList.length > 0) {
      part += `.${current.classList[0]}`;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const index = siblings.indexOf(current);
      if (index >= 0) {
        part += `:nth-of-type(${index + 1})`;
      }
    }

    parts.unshift(part);
    current = parent;
    depth += 1;
  }

  const path = parts.join('>');
  return `${buildScopeSelectorHint(element)}:${hashString(path)}`;
}

function scoreScopeCandidate(element) {
  if (!element || !(element instanceof Element)) {
    return { score: 0, reason: 'invalid' };
  }

  const textContent = (element.textContent || '').trim();
  const textLength = textContent.length;
  const nodeCount = element.getElementsByTagName('*').length + 1;
  const links = Array.from(element.getElementsByTagName('a'));
  const linkTextLength = links.reduce((sum, link) => sum + ((link.textContent || '').trim().length), 0);

  const textDensity = textLength / Math.max(1, nodeCount);
  const linkDensity = textLength === 0 ? 0 : linkTextLength / Math.max(1, textLength);
  const textRatio = textLength === 0 ? 0 : textLength / (textLength + linkTextLength);
  const structurePenalty = /(nav|menu|sidebar|footer|header|aside|comment|related)/i.test(
    `${element.tagName.toLowerCase()} ${element.className || ''}`
  )
    ? 0.35
    : 0;

  const score = Math.max(0, textDensity * 0.5 + textRatio * 40 * (1 - linkDensity) - structurePenalty * 20);
  const reasonParts = [];

  if (textDensity > 25) reasonParts.push('dense-text');
  if (linkDensity < 0.25) reasonParts.push('low-link');
  if (structurePenalty > 0) reasonParts.push('structure-penalty');

  return { score, reason: reasonParts.join(',') || 'default' };
}

function isScopeMarkingEnabled() {
  return isFlagEnabled('smartScopeV2') || isFlagEnabled('scopedModeCssV2');
}

async function selectScopeRoot(doc, level = 'conservative', budgetMs = SMARTSCOPE_TIMEOUT_MS) {
  await initModeEngineFlagApiResultPromise;
  const scopeMarkingEnabled = isScopeMarkingEnabled();
  if (isFlagEnabled('smartScopeV2')) {
    const result = await selectScopeRootV2(doc, level, budgetMs);
    if (result?.root) {
      if (scopeMarkingEnabled) {
        const tokenResult = applyScopeTokenToRoot(result.root);
        if (!tokenResult.ok) {
          modeEngineDebugLog('[SmartScopeV2] Failed to apply scope token', tokenResult);
        }
      }
      return result;
    }

    if (result?.profile) {
      const baseReason = result.profile.reason || '';
      result.profile.reason = baseReason ? `${baseReason},v2-none` : 'v2-none';
      return { root: null, profile: result.profile };
    }

    return { root: null, profile: { reason: 'v2-none', branch: 'NONE', score: 0, timingMs: 0 } };
  }

  return { root: null, profile: { reason: 'v2-disabled', branch: 'NONE', score: 0, timingMs: 0 } };
}

let focusOverlayController = null;
let focusOverlayPrefsListenerAttached = false;
const FOCUS_OVERLAY_DEFAULT_ALPHA = 0.2;
const READING_RULER_DEFAULT_HEIGHT_PX = 120;
const READING_RULER_DEFAULT_OPACITY = 0.12;
const FOCUS_OVERLAY_EVENT_NAME = 'aura:focusOverlay:set';
const READING_RULER_EVENT_NAME = 'aura:readingRuler:set';
const ULTRA_FOCUS_EVENT_NAME = 'aura:ultraFocus:set';
const ULTRA_FOCUS_LOCK_EVENT_NAME = 'aura:ultraFocus:lock';
let readingRulerShortcutListenerAttached = false;
const FOCUS_NOT_OBSCURED_THRESHOLD_PX = 64;
const FOCUS_NOT_OBSCURED_KEYBOARD_WINDOW_MS = 1200;
const FOCUS_NOT_OBSCURED_REPEAT_WINDOW_MS = 800;
const TARGET_BOOST_CLASS = 'aura-target-boost';
const TARGET_BOOST_MIN_SIZE_PX = 24;
const TARGET_BOOST_MAX_ELEMENTS = 50;
const TARGET_BOOST_SCAN_THROTTLE_MS = 200;
const TARGET_BOOST_FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
const DARK_SURFACE_DEBOUNCE_MS = 350;
const DARK_SURFACE_MAX_RESCANS_PER_MIN = 12;
const DARK_SURFACE_RESCAN_WINDOW_MS = 60000;
const DARK_SURFACE_SCAN_BUDGET = { maxNodes: 600, maxMs: 12 };
const DARK_SURFACE_INITIAL_SCAN_BUDGET = { maxNodes: 2000, maxMs: 28 };
const DARK_SURFACE_INITIAL_EXTRA_BUDGET = { maxNodes: 1200, maxMs: 18 };
const DARK_SURFACE_INITIAL_EXTRA_PASSES = 2;
const DARK_SURFACE_INITIAL_PASS_DELAYS_MS = [80, 240];
const DARK_INLINE_DEBOUNCE_MS = 400;
const DARK_INLINE_RESCAN_MIN_INTERVAL_MS = 1000;
const DARK_INLINE_RESCAN_DELAYS_MS = [250, 800];
const focusNotObscuredState = {
  enabled: false,
  reduceMotion: false,
  lastKeyboardAt: 0,
  lastHandledAt: 0,
  lastHandledElement: null,
  focusInHandler: null,
  keydownHandler: null,
  listenersAttached: false,
};
const targetBoostState = {
  enabled: false,
  scopeEl: null,
  observer: null,
  scanTimer: null,
  boostedElements: new Set(),
};
let darkObserver = null;
let darkRescanTimer = null;
let darkRescanWindowStart = 0;
let darkRescanCount = 0;
let darkObservedScopeRoot = null;
let darkInlineObserver = null;
let darkInlineDebounceTimer = null;
let darkInlineThrottleTimer = null;
let darkInlineSliceTimers = [];
let darkInlineObservedScopeRoot = null;
let darkInlineNextAllowedAt = 0;
let darkInitialApplyScopeRoot = null;
let darkInitialApplyPassCount = 0;
let darkInitialApplyTimers = [];
const runtimeModeState = {
  activeModes: {},
  prefs: null,
};

function setRuntimePrefs(nextPrefs) {
  if (nextPrefs && typeof nextPrefs === 'object' && !Array.isArray(nextPrefs)) {
    runtimeModeState.prefs = nextPrefs;
    return;
  }

  runtimeModeState.prefs = null;
}

function setModeActive(modeId, active) {
  if (typeof modeId !== 'string' || !modeId) {
    return;
  }

  runtimeModeState.activeModes[modeId] = active === true;

  if (active === true) {
    hideSuggestionBannerIfPresent();
  }
}

function getModeActive(modeId) {
  if (typeof modeId !== 'string' || !modeId) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(runtimeModeState.activeModes, modeId)) {
    return null;
  }

  return runtimeModeState.activeModes[modeId] === true;
}

function isAnyModeActive() {
  return Object.values(runtimeModeState.activeModes).some((value) => value === true);
}

function isFlagEnabledWithOverride(flagName, flagsOverride) {
  if (flagsOverride && typeof flagsOverride === 'object') {
    if (Object.prototype.hasOwnProperty.call(flagsOverride, flagName)) {
      return flagsOverride[flagName] === true;
    }
  }

  return isFlagEnabled(flagName);
}

function hideSuggestionBannerIfPresent() {
  if (activeBanner?.destroy) {
    activeBanner.destroy();
  } else {
    const host = document.getElementById('aura-suggestion-banner');
    if (host && host.parentNode) {
      host.parentNode.removeChild(host);
    }
  }

  activeBanner = null;
}

async function loadUserPrefs() {
  if (runtimeModeState.prefs && typeof runtimeModeState.prefs === 'object') {
    return runtimeModeState.prefs;
  }

  if (!chrome?.storage?.local?.get) {
    return {};
  }

  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    const userPrefs = stored?.[STORAGE_KEYS.USER_PREFS] || {};
    setRuntimePrefs(userPrefs);
    return userPrefs;
  } catch (error) {
    return {};
  }
}

function clampNumber(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return NaN;
  }
  return Math.min(Math.max(value, min), max);
}

function normalizeFocusOverlayAlpha(value, fallback = FOCUS_OVERLAY_DEFAULT_ALPHA) {
  const numeric = clampNumber(value, 0, 1);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function getUserPrefsStorageKey() {
  return STORAGE_KEYS?.USER_PREFS || 'userPrefs';
}

function normalizeFocusModePrefs(rawModePrefs) {
  const focusModeId = MODE_IDS.FOCUS || 'focus';
  const defaults =
    (MODE_PREFS_DEFAULTS && MODE_PREFS_DEFAULTS[focusModeId]) ||
    { distractionDim: false, ultraFocus: false, targetBoost: false, reduceMotion: false, readingRuler: false };
  const focusPrefs =
    rawModePrefs && typeof rawModePrefs === 'object' && !Array.isArray(rawModePrefs)
      ? rawModePrefs[focusModeId]
    : null;
  const normalized = { ...defaults };

  if (focusPrefs && typeof focusPrefs === 'object' && !Array.isArray(focusPrefs)) {
    Object.keys(defaults).forEach((key) => {
      if (typeof focusPrefs[key] === 'boolean') {
        normalized[key] = focusPrefs[key];
      }
    });
  }

  return normalized;
}

function normalizeReadingRulerHeight(value, fallback = READING_RULER_DEFAULT_HEIGHT_PX) {
  const numeric = clampNumber(value, 40, 400);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function normalizeReadingRulerOpacity(value, fallback = READING_RULER_DEFAULT_OPACITY) {
  const numeric = clampNumber(value, 0, 0.6);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function prefersReducedMotion() {
  if (!window?.matchMedia) {
    return false;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (error) {
    return false;
  }
}

async function loadTargetBoostPrefs() {
  if (!chrome?.storage?.local?.get) {
    return { enabled: false };
  }

  try {
    const prefsKey = getUserPrefsStorageKey();
    const stored = await chrome.storage.local.get(prefsKey);
    const userPrefs = stored?.[prefsKey] || {};
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);

    return { enabled: modePrefs.targetBoost === true };
  } catch (error) {
    return { enabled: false };
  }
}

function clearTargetBoostedElements() {
  targetBoostState.boostedElements.forEach((element) => {
    if (element && element.classList) {
      element.classList.remove(TARGET_BOOST_CLASS);
    }
  });
  targetBoostState.boostedElements.clear();
}

function stopTargetBoostObserver() {
  if (targetBoostState.observer) {
    targetBoostState.observer.disconnect();
    targetBoostState.observer = null;
  }
}

function stopTargetBoost({ resetScope = true } = {}) {
  if (targetBoostState.scanTimer) {
    clearTimeout(targetBoostState.scanTimer);
    targetBoostState.scanTimer = null;
  }

  stopTargetBoostObserver();
  clearTargetBoostedElements();
  targetBoostState.enabled = false;
  if (resetScope) {
    targetBoostState.scopeEl = null;
  }
}

function isElementSmallTarget(element) {
  let rect;
  try {
    rect = element.getBoundingClientRect();
  } catch (error) {
    return false;
  }

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return rect.width < TARGET_BOOST_MIN_SIZE_PX && rect.height < TARGET_BOOST_MIN_SIZE_PX;
}

function isNavigationContainer(element, scopeRoot) {
  if (!element || !(element instanceof Element)) {
    return false;
  }

  const navContainer = element.closest('nav, [role="navigation"]');
  if (navContainer && (!scopeRoot || scopeRoot.contains(navContainer))) {
    return true;
  }

  return false;
}

function isDenseFocusableContainer(container, focusableSelector) {
  if (!container || !(container instanceof Element)) {
    return false;
  }

  let rect;
  try {
    rect = container.getBoundingClientRect();
  } catch (error) {
    return false;
  }

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const area = rect.width * rect.height;
  if (!Number.isFinite(area) || area <= 0) {
    return false;
  }

  const focusables = container.querySelectorAll(focusableSelector);
  const count = focusables.length;
  if (count < 12) {
    return false;
  }

  return area < 60000 || count / area > 0.002;
}

function shouldSkipTargetBoost(element, scopeRoot, densityCache) {
  if (isNavigationContainer(element, scopeRoot)) {
    return true;
  }

  const container = element.closest('nav, [role="navigation"], [role="menubar"], [aria-label*="menu" i]') || element.parentElement;
  if (!container) {
    return false;
  }

  if (densityCache.has(container)) {
    return densityCache.get(container);
  }

  const isDense = isDenseFocusableContainer(container, TARGET_BOOST_FOCUSABLE_SELECTOR);
  densityCache.set(container, isDense);
  return isDense;
}

function scanTargetBoostCandidates(scopeEl) {
  const focusableElements = Array.from(scopeEl.querySelectorAll(TARGET_BOOST_FOCUSABLE_SELECTOR));
  const candidates = [];
  const densityCache = new WeakMap();

  for (const element of focusableElements) {
    if (!(element instanceof Element)) {
      continue;
    }

    if (shouldSkipTargetBoost(element, scopeEl, densityCache)) {
      continue;
    }

    if (!isElementSmallTarget(element)) {
      continue;
    }

    candidates.push(element);
    if (candidates.length > TARGET_BOOST_MAX_ELEMENTS) {
      return { tooMany: true, candidates: [] };
    }
  }

  return { tooMany: false, candidates };
}

function applyTargetBoostClasses(candidates) {
  const nextSet = new Set(candidates);

  targetBoostState.boostedElements.forEach((element) => {
    if (!element || !element.isConnected || !nextSet.has(element)) {
      if (element?.classList) {
        element.classList.remove(TARGET_BOOST_CLASS);
      }
      targetBoostState.boostedElements.delete(element);
    }
  });

  candidates.forEach((element) => {
    if (!element.classList.contains(TARGET_BOOST_CLASS)) {
      element.classList.add(TARGET_BOOST_CLASS);
    }
    targetBoostState.boostedElements.add(element);
  });
}

function runTargetBoostScan(reason) {
  if (!targetBoostState.enabled || AURA_CONTEXT_INVALIDATED) {
    return;
  }

  const scopeEl = targetBoostState.scopeEl;
  if (!scopeEl || !scopeEl.isConnected) {
    stopTargetBoost();
    return;
  }

  const { tooMany, candidates } = scanTargetBoostCandidates(scopeEl);
  if (tooMany) {
    modeEngineDebugLog('Target boost disabled: too many candidates', { reason, cap: TARGET_BOOST_MAX_ELEMENTS });
    stopTargetBoost({ resetScope: false });
    return;
  }

  applyTargetBoostClasses(candidates);

  if (isFlagEnabled('debugModeEngine')) {
    modeEngineDebugLog('Target boost scan complete', { reason, boosted: candidates.length });
  }
}

function scheduleTargetBoostScan(reason) {
  if (!targetBoostState.enabled) {
    return;
  }

  if (targetBoostState.scanTimer) {
    clearTimeout(targetBoostState.scanTimer);
  }

  targetBoostState.scanTimer = setTimeout(() => {
    targetBoostState.scanTimer = null;
    runTargetBoostScan(reason);
  }, TARGET_BOOST_SCAN_THROTTLE_MS);
}

function ensureTargetBoostObserver(scopeEl) {
  if (targetBoostState.observer && targetBoostState.scopeEl === scopeEl) {
    return;
  }

  stopTargetBoostObserver();

  const observer = new MutationObserver(() => {
    scheduleTargetBoostScan('mutation');
  });

  try {
    observer.observe(scopeEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'tabindex', 'role', 'href', 'aria-label'],
    });
  } catch (error) {
    modeEngineDebugLog('Target boost observer failed', error);
    return;
  }

  targetBoostState.observer = observer;
}

async function handleTargetBoostStateChange(scopeEl = null, flagsOverride = null) {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    stopTargetBoost();
    return;
  }

  if (!isFlagEnabledWithOverride('targetBoostV1', flagsOverride)) {
    stopTargetBoost();
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadTargetBoostPrefs(), isFocusModeActive()]);

  if (!focusActive || !prefs.enabled) {
    stopTargetBoost();
    return;
  }

  const targetScope = scopeEl || getActiveScopeRoot();
  if (!targetScope) {
    stopTargetBoost();
    return;
  }

  if (targetBoostState.scopeEl !== targetScope) {
    clearTargetBoostedElements();
    targetBoostState.scopeEl = targetScope;
  }

  targetBoostState.enabled = true;
  ensureTargetBoostObserver(targetScope);
  scheduleTargetBoostScan('enable');
}

async function loadFocusOverlayPrefs() {
  if (!chrome?.storage?.local?.get) {
    return {
      distractionDim: false,
      alpha: FOCUS_OVERLAY_DEFAULT_ALPHA,
    };
  }

  try {
    const userPrefs = await loadUserPrefs();
    const focusModeId = MODE_IDS.FOCUS || 'focus';
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
    const rawAlpha = userPrefs.focusOverlayAlpha ?? userPrefs?.modePrefs?.[focusModeId]?.distractionDimAlpha;

    return {
      distractionDim: modePrefs.distractionDim === true,
      alpha: normalizeFocusOverlayAlpha(rawAlpha, FOCUS_OVERLAY_DEFAULT_ALPHA),
    };
  } catch (error) {
    return {
      distractionDim: false,
      alpha: FOCUS_OVERLAY_DEFAULT_ALPHA,
    };
  }
}

async function loadFocusNotObscuredPrefs() {
  if (!chrome?.storage?.local?.get) {
    return {
      enabled: false,
      reduceMotion: prefersReducedMotion(),
    };
  }

  try {
    const userPrefs = await loadUserPrefs();
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);

    return {
      enabled: modePrefs.focusNotObscured === true,
      reduceMotion: userPrefs.reducedMotion === true || modePrefs.reduceMotion === true,
    };
  } catch (error) {
    return {
      enabled: false,
      reduceMotion: prefersReducedMotion(),
    };
  }
}

async function loadReadingRulerPrefs() {
  if (!chrome?.storage?.local?.get) {
    return {
      enabled: false,
      heightPx: READING_RULER_DEFAULT_HEIGHT_PX,
      opacity: READING_RULER_DEFAULT_OPACITY,
    };
  }

  try {
    const userPrefs = await loadUserPrefs();
    const focusModeId = MODE_IDS.FOCUS || 'focus';
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
    const rawHeight = userPrefs.readingRulerHeightPx ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerHeightPx;
    const rawOpacity = userPrefs.readingRulerOpacity ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerOpacity;

  return {
    enabled: modePrefs.readingRuler === true,
    heightPx: normalizeReadingRulerHeight(rawHeight, READING_RULER_DEFAULT_HEIGHT_PX),
    opacity: normalizeReadingRulerOpacity(rawOpacity, READING_RULER_DEFAULT_OPACITY),
    };
  } catch (error) {
    return {
      enabled: false,
      heightPx: READING_RULER_DEFAULT_HEIGHT_PX,
      opacity: READING_RULER_DEFAULT_OPACITY,
    };
  }
}

function dispatchFocusOverlayEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(FOCUS_OVERLAY_EVENT_NAME, { detail }));
  } catch (error) {
    modeEngineDebugLog('Focus overlay event dispatch failed', error);
  }
}

function dispatchReadingRulerEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(READING_RULER_EVENT_NAME, { detail }));
  } catch (error) {
    modeEngineDebugLog('Reading ruler event dispatch failed', error);
  }
}

async function loadUltraFocusPrefs() {
  if (!chrome?.storage?.local?.get) {
    return { enabled: false };
  }

  try {
    const stored = await chrome.storage.local.get(getUserPrefsStorageKey());
    const userPrefs = stored?.[getUserPrefsStorageKey()] || {};
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);

    return { enabled: modePrefs.ultraFocus === true };
  } catch (error) {
    return { enabled: false };
  }
}

function dispatchUltraFocusEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(ULTRA_FOCUS_EVENT_NAME, { detail }));
  } catch (error) {
    modeEngineDebugLog('Ultra focus event dispatch failed', error);
  }
}

function dispatchUltraFocusLockEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(ULTRA_FOCUS_LOCK_EVENT_NAME, { detail }));
  } catch (error) {
    modeEngineDebugLog('Ultra focus lock event dispatch failed', error);
  }
}

async function loadSmartScopeV2Module() {
  const runtimeModule = globalThis.AURA_SMARTSCOPE_V2 || null;
  if (runtimeModule) {
    return runtimeModule;
  }

  const testModuleUrl = globalThis.__AURA_TEST_MODULE_URLS__?.smartScope;
  if (testModuleUrl) {
    return import(testModuleUrl).catch((error) => {
      modeEngineDebugLog('SmartScope v2 test import failed', error);
      return null;
    });
  }

  modeEngineDebugLog('SmartScope v2 runtime missing');
  return null;
}

async function loadScopedVerifierModule() {
  const runtimeModule = globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
  if (!runtimeModule) {
    modeEngineDebugLog('Scoped verifier runtime missing');
  }
  return runtimeModule;
}

async function loadFocusOverlayModule() {
  const runtimeModule = globalThis.AURA_FOCUS_OVERLAY_V2 || null;
  if (!runtimeModule) {
    modeEngineDebugLog('Focus overlay v2 runtime missing');
  }
  return runtimeModule;
}

async function loadReadingRulerModule() {
  const runtimeModule = globalThis.AURA_READING_RULER || null;
  if (!runtimeModule) {
    modeEngineDebugLog('Reading ruler runtime missing');
  }
  return runtimeModule;
}

async function loadUltraFocusModule() {
  const runtimeModule = globalThis.AURA_ULTRA_FOCUS || null;
  if (!runtimeModule) {
    modeEngineDebugLog('Ultra focus runtime missing');
  }
  return runtimeModule;
}

async function ensureFocusOverlayController(options = {}) {
  if (focusOverlayController) {
    if (options?.alpha !== undefined) {
      focusOverlayController.setEnabled?.(true, { alpha: options.alpha });
    }
    return focusOverlayController;
  }

  const module = await loadFocusOverlayModule();
  const createController = module?.createFocusOverlayControllerV2;

  if (typeof createController !== 'function') {
    return null;
  }

  focusOverlayController = createController(document, options);
  return focusOverlayController;
}

function teardownFocusOverlayV2({ destroyRoot = false } = {}) {
  if (!focusOverlayController) {
    return;
  }

  try {
    focusOverlayController.stop?.();
  } catch (error) {
    modeEngineDebugLog('Focus overlay v2 stop failed', error);
  }

  if (destroyRoot) {
    try {
      focusOverlayController.destroy?.();
    } catch (error) {
      modeEngineDebugLog('Focus overlay v2 destroy failed', error);
    }

    focusOverlayController = null;
  }
}

function getActiveScopeRoot() {
  try {
    return document.querySelector(
      `[${MODE_ENGINE_SCOPE_ATTR}="${MODE_ENGINE_SCOPE_VALUE}"][${MODE_ENGINE_SCOPE_OWNER_ATTR}="${MODE_ENGINE_SCOPE_OWNER}"]`,
    );
  } catch (error) {
    modeEngineDebugLog('Focus overlay v2 scope lookup failed', error);
    return null;
  }
}

async function isFocusModeActive() {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return false;
  }

  if (typeof ACTIONS.GET_STATE !== 'string') {
    return false;
  }

  const focusModeId = MODE_IDS.FOCUS || 'focus';
  const cachedState = getModeActive(focusModeId);
  if (typeof cachedState === 'boolean') {
    return cachedState;
  }
  const response = await safeSendMessage(
    { action: ACTIONS.GET_STATE, tabId: CURRENT_TAB_ID, modeId: focusModeId },
    { contextLabel: 'focus-overlay-get-state' },
  );

  return response?.state?.state === 'ACTIVE';
}

async function handleFocusOverlayScopeChange(scopeEl = null, flagsOverride = null) {
  if (!isFlagEnabledWithOverride('focusOverlayV2', flagsOverride)) {
    dispatchFocusOverlayEvent({ enabled: false, destroy: true });
    teardownFocusOverlayV2({ destroyRoot: true });
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadFocusOverlayPrefs(), isFocusModeActive()]);
  if (!prefs.distractionDim || !focusActive) {
    dispatchFocusOverlayEvent({ enabled: false, destroy: true });
    teardownFocusOverlayV2({ destroyRoot: true });
    return;
  }

  const targetScope = scopeEl || getActiveScopeRoot();

  if (!targetScope) {
    dispatchFocusOverlayEvent({ enabled: false, destroy: true });
    teardownFocusOverlayV2({ destroyRoot: true });
    return;
  }

  dispatchFocusOverlayEvent({ enabled: true, alpha: prefs.alpha, scope: targetScope });
}

async function handleReadingRulerStateChange() {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return;
  }

  await loadReadingRulerModule();
  const [prefs, focusActive] = await Promise.all([loadReadingRulerPrefs(), isFocusModeActive()]);

  if (!prefs.enabled || !focusActive) {
    dispatchReadingRulerEvent({ enabled: false });
    return;
  }

  dispatchReadingRulerEvent({
    enabled: true,
    heightPx: prefs.heightPx,
    opacity: prefs.opacity,
  });
}

async function handleUltraFocusStateChange() {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return;
  }

  await loadUltraFocusModule();
  const [prefs, focusActive] = await Promise.all([loadUltraFocusPrefs(), isFocusModeActive()]);

  if (!prefs.enabled || !focusActive) {
    dispatchUltraFocusEvent({ enabled: false });
    dispatchUltraFocusLockEvent({ lock: false });
    return;
  }

  dispatchUltraFocusEvent({ enabled: true });
}

function startFocusOverlayPrefsWatcher() {
  if (focusOverlayPrefsListenerAttached) {
    return;
  }

  if (!chrome?.storage?.onChanged?.addListener) {
    return;
  }

  focusOverlayPrefsListenerAttached = true;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    const prefsKey = getUserPrefsStorageKey();
    if (!Object.prototype.hasOwnProperty.call(changes, prefsKey)) {
      return;
    }

    const nextPrefs = changes[prefsKey]?.newValue || {};
    setRuntimePrefs(nextPrefs);
    applyFocusRuntime(nextPrefs).catch((error) => {
      modeEngineDebugLog('Focus runtime prefs refresh failed', error);
    });
  });
}

async function toggleReadingRulerPreference() {
  if (!chrome?.storage?.local?.get || !chrome?.storage?.local?.set) {
    return;
  }

  const prefsKey = getUserPrefsStorageKey();
  const stored = await chrome.storage.local.get(prefsKey);
  const userPrefs = stored?.[prefsKey] || {};
  const focusModeId = MODE_IDS.FOCUS || 'focus';
  const currentModePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
  const nextValue = currentModePrefs.readingRuler !== true;

  const nextPrefs = {
    ...userPrefs,
    modePrefs: {
      ...(userPrefs.modePrefs || {}),
      [focusModeId]: {
        ...currentModePrefs,
        readingRuler: nextValue,
      },
    },
  };

  await chrome.storage.local.set({ [prefsKey]: nextPrefs });
  setRuntimePrefs(nextPrefs);

  if (typeof ACTIONS.PREFS_UPDATED === 'string') {
    safeSendMessage({ action: ACTIONS.PREFS_UPDATED, prefs: nextPrefs }, { contextLabel: 'reading-ruler-toggle' });
  }

  handleReadingRulerStateChange().catch((error) => {
    modeEngineDebugLog('Reading ruler toggle failed', error);
  });
}

function startReadingRulerShortcut() {
  if (readingRulerShortcutListenerAttached) {
    return;
  }

  readingRulerShortcutListenerAttached = true;

  window.addEventListener('keydown', async (event) => {
    if (!event || event.defaultPrevented) {
      return;
    }

    const isR = event.key?.toLowerCase?.() === 'r' || event.code === 'KeyR';
    if (!event.altKey || !isR) {
      return;
    }

    const focusActive = await isFocusModeActive();
    if (!focusActive) {
      return;
    }

    event.preventDefault();
    toggleReadingRulerPreference().catch((error) => {
      modeEngineDebugLog('Reading ruler shortcut failed', error);
    });
  });
}

function attachFocusNotObscuredListeners() {
  if (focusNotObscuredState.listenersAttached) {
    return;
  }

  const handleKeydown = (event) => {
    if (!event || event.defaultPrevented) {
      return;
    }

    const isTab =
      event.key === 'Tab' ||
      event.code === 'Tab' ||
      event.keyCode === 9;

    if (!isTab) {
      return;
    }

    focusNotObscuredState.lastKeyboardAt = Date.now();
  };

  const handleFocusIn = (event) => {
    if (AURA_CONTEXT_INVALIDATED || !focusNotObscuredState.enabled) {
      return;
    }

    const target = event?.target;
    if (!target || !(target instanceof Element)) {
      return;
    }

    const now = Date.now();
    if (now - focusNotObscuredState.lastKeyboardAt > FOCUS_NOT_OBSCURED_KEYBOARD_WINDOW_MS) {
      return;
    }

    if (
      focusNotObscuredState.lastHandledElement === target &&
      now - focusNotObscuredState.lastHandledAt < FOCUS_NOT_OBSCURED_REPEAT_WINDOW_MS
    ) {
      return;
    }

    let rect;
    try {
      rect = target.getBoundingClientRect();
    } catch (error) {
      return;
    }

    if (!rect) {
      return;
    }

    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    if (!viewportHeight) {
      return;
    }

    const thresholdTop = FOCUS_NOT_OBSCURED_THRESHOLD_PX;
    const thresholdBottom = viewportHeight - FOCUS_NOT_OBSCURED_THRESHOLD_PX;
    const needsScroll = rect.top < thresholdTop || rect.bottom > thresholdBottom;

    if (!needsScroll) {
      return;
    }

    focusNotObscuredState.lastHandledElement = target;
    focusNotObscuredState.lastHandledAt = now;

    const shouldReduceMotion = focusNotObscuredState.reduceMotion || prefersReducedMotion();
    const behavior = shouldReduceMotion ? 'auto' : 'smooth';

    try {
      target.scrollIntoView({ behavior, block: 'center', inline: 'nearest' });
      modeEngineDebugLog('Focus not obscured scroll', { behavior, top: rect.top, bottom: rect.bottom });
    } catch (error) {
      modeEngineDebugLog('Focus not obscured scroll failed', error);
    }
  };

  focusNotObscuredState.keydownHandler = handleKeydown;
  focusNotObscuredState.focusInHandler = handleFocusIn;
  window.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('focusin', handleFocusIn, true);
  focusNotObscuredState.listenersAttached = true;
}

function detachFocusNotObscuredListeners() {
  if (!focusNotObscuredState.listenersAttached) {
    return;
  }

  if (focusNotObscuredState.keydownHandler) {
    window.removeEventListener('keydown', focusNotObscuredState.keydownHandler, true);
  }

  if (focusNotObscuredState.focusInHandler) {
    document.removeEventListener('focusin', focusNotObscuredState.focusInHandler, true);
  }

  focusNotObscuredState.keydownHandler = null;
  focusNotObscuredState.focusInHandler = null;
  focusNotObscuredState.listenersAttached = false;
  focusNotObscuredState.lastHandledElement = null;
  focusNotObscuredState.lastHandledAt = 0;
  focusNotObscuredState.lastKeyboardAt = 0;
}

async function handleFocusNotObscuredStateChange() {
  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    focusNotObscuredState.enabled = false;
    detachFocusNotObscuredListeners();
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadFocusNotObscuredPrefs(), isFocusModeActive()]);

  if (!focusActive || !prefs.enabled) {
    focusNotObscuredState.enabled = false;
    detachFocusNotObscuredListeners();
    return;
  }

  focusNotObscuredState.enabled = true;
  focusNotObscuredState.reduceMotion = prefs.reduceMotion === true;
  attachFocusNotObscuredListeners();
}

function cleanupFocusRuntime() {
  dispatchFocusOverlayEvent({ enabled: false, destroy: true });
  teardownFocusOverlayV2({ destroyRoot: true });
  dispatchReadingRulerEvent({ enabled: false });
  dispatchUltraFocusEvent({ enabled: false });
  dispatchUltraFocusLockEvent({ lock: false });
  stopTargetBoost();
  focusNotObscuredState.enabled = false;
  detachFocusNotObscuredListeners();
}

async function applyFocusSubmodes(focusState, prefsOverride = null, flagsOverride = null, scopeRoot = null) {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  if (prefsOverride) {
    setRuntimePrefs(prefsOverride);
  }

  let focusActive = focusState;
  if (typeof focusActive !== 'boolean') {
    focusActive = await isFocusModeActive();
  }

  if (focusActive === false) {
    cleanupFocusRuntime();
    return;
  }

  await handleFocusOverlayScopeChange(scopeRoot, flagsOverride);
  await handleReadingRulerStateChange();
  await handleUltraFocusStateChange();
  await handleFocusNotObscuredStateChange();
  await handleTargetBoostStateChange(scopeRoot, flagsOverride);
}

async function applyFocusRuntime(prefsOverride = null) {
  const focusModeId = MODE_IDS.FOCUS || 'focus';
  const focusActive = getModeActive(focusModeId);
  const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
  await applyFocusSubmodes(focusActive, prefsOverride, flags);
}

async function selectScopeRootV2(doc, level = 'conservative', budgetMs = SMARTSCOPE_TIMEOUT_MS) {
  const debug = isFlagEnabled('debugModeEngine');
  const module = await loadSmartScopeV2Module();
  const detector = module?.detectScopeRootV2 || module?.detectSmartScopeV2;
  if (!detector) {
    return {
      root: null,
      profile: {
        chosenSelectorHint: '',
        scopeKey: '',
        score: 0,
        reason: 'v2-unavailable',
        timingMs: 0,
        branch: 'NONE',
      },
    };
  }

  const budget = typeof budgetMs === 'number' ? budgetMs : SMARTSCOPE_TIMEOUT_MS;
  const detectStart = performance.now();
  const result = await detector({ doc, budgetMs: budget, level });
  const detectElapsed = performance.now() - detectStart;
  const scopeEl = result?.scopeEl || null;
  let chosenScope = scopeEl;

  const reasonCodes = Array.isArray(result?.reasons)
    ? result.reasons
        .map((reason) => {
          if (!reason) return null;
          if (typeof reason === 'string') return reason;
          if (reason?.code) return reason.code;
          return null;
        })
        .filter(Boolean)
    : [];
  const timedOut = reasonCodes.includes('TIME_BUDGET_EXCEEDED');
  let fallbackDetail = '';
  let fallbackAttempted = false;
  let verificationReason = '';

  if ((!result?.ok || !chosenScope) && timedOut) {
    fallbackAttempted = true;
    const fallbackCandidate = pickFallbackScopeCandidate(doc);
    if (fallbackCandidate) {
      const verification = await verifyFallbackScopeCandidate(fallbackCandidate);
      if (verification?.ok) {
        chosenScope = fallbackCandidate;
      } else if (verification?.reason === 'ROOT_TOO_LARGE') {
        const descendResult = await descendCandidateForContentRoot(fallbackCandidate);
        if (descendResult?.ok && descendResult.element) {
          const descendVerification = await verifyFallbackScopeCandidate(descendResult.element);
          if (descendVerification?.ok) {
            chosenScope = descendResult.element;
            fallbackDetail = descendResult?.reason || 'DESCEND_OK';
          } else {
            fallbackDetail = descendVerification?.reason || descendResult?.reason || 'DESCEND_REJECTED';
          }
        } else if (descendResult?.error) {
          fallbackDetail = descendResult.detail
            ? `${descendResult.error}:${descendResult.detail}`
            : descendResult.error;
        } else {
          fallbackDetail = descendResult?.reason || 'DESCEND_FAILED';
        }
      } else {
        fallbackDetail = verification?.reason || 'FALLBACK_REJECTED';
      }
    } else {
      fallbackDetail = 'NO_FALLBACK_CANDIDATE';
    }
  }

  if (result?.ok && chosenScope) {
    const verification = await verifyFallbackScopeCandidate(chosenScope);
    if (verification?.ok) {
      // Keep chosen scope as-is.
    } else if (verification?.reason === 'ROOT_TOO_LARGE') {
      const descendResult = await descendCandidateForContentRoot(chosenScope);
      if (descendResult?.ok && descendResult.element) {
        const descendVerification = await verifyFallbackScopeCandidate(descendResult.element);
        if (descendVerification?.ok) {
          chosenScope = descendResult.element;
          if (!fallbackDetail) {
            fallbackDetail = descendResult?.reason || 'DESCEND_OK';
          }
        } else if (descendVerification?.reason && descendVerification?.reason !== 'VERIFY_UNAVAILABLE') {
          verificationReason =
            descendVerification?.reason || descendResult?.reason || verification?.reason || 'DESCEND_REJECTED';
          if (!fallbackDetail) {
            fallbackDetail = descendVerification?.reason || descendResult?.reason || 'DESCEND_REJECTED';
          }
        }
      } else if (descendResult?.reason && descendResult?.reason !== 'DESCEND_UNAVAILABLE') {
        verificationReason = descendResult?.reason || verification?.reason || 'DESCEND_FAILED';
        if (!fallbackDetail) {
          fallbackDetail = descendResult?.reason || 'DESCEND_FAILED';
        }
      }
    } else if (verification?.reason && verification?.reason !== 'VERIFY_UNAVAILABLE') {
      verificationReason = verification.reason;
    }
  }

  const scopeSelector = chosenScope ? buildScopeSelectorHint(chosenScope) : '';
  const chosenRoot = chosenScope
    ? {
        tag: typeof chosenScope.tagName === 'string' ? chosenScope.tagName.toLowerCase() : '',
        id: chosenScope.id || '',
        class: typeof chosenScope.className === 'string' ? chosenScope.className : '',
      }
    : null;
  const reasonLabel = reasonCodes.join(',');
  const detail = fallbackDetail || (timedOut ? 'TIME_BUDGET_EXCEEDED' : '');
  const profile = {
    chosenSelectorHint: scopeSelector,
    scopeKey: chosenScope ? buildScopeKey(chosenScope) : '',
    score: result?.score || 0,
    reason: reasonLabel || (result?.ok ? 'v2-selected' : 'v2-none'),
    timingMs: result?.stats?.elapsedMs || result?.metrics?.elapsedMs || detectElapsed,
    branch: result?.branch || 'NONE',
    metrics: result?.metrics,
    ok: Boolean((result?.ok && chosenScope) || (!scopeEl && chosenScope)),
    detail,
    verificationReason,
    fallbackAttempted,
    fallbackUsed: fallbackAttempted && Boolean(!scopeEl && chosenScope),
  };

  if (debug) {
    recordModeEngineMetric('smartscope.v2.totalMs', profile.timingMs);
    recordModeEngineMetric('smartscope.v2.candidatesScanned', result?.metrics?.scanned || 0);
    recordModeEngineMetric('smartscope.v2.topK', result?.metrics?.topK || 0);
    const outcome = profile.ok ? 'found' : timedOut ? 'timeout' : 'none';
    recordModeEngineMetric(`smartscope.v2.${outcome}`, 1);
    modeEngineDebugLog('[SmartScopeV2]', {
      branch: profile.branch,
      reason: profile.reason,
      score: profile.score,
      scope: scopeSelector,
      elapsed: profile.timingMs,
      budget,
      fallbackAttempted,
      fallbackDetail: fallbackDetail || undefined,
      verificationReason: verificationReason || undefined,
    });
    modeEngineDebugLog('[SmartScopeV2][selectScopeRoot]', {
      ok: Boolean(profile.ok && chosenScope),
      reasonIfFail: profile.ok ? '' : profile.reason || reasonLabel || 'unknown',
      chosenRoot: chosenRoot || undefined,
      score: profile.score,
      detail: profile.detail || undefined,
      fallbackUsed: profile.fallbackUsed,
    });
  }

  if (!profile.ok || !chosenScope) {
    return { root: null, profile };
  }

  return { root: chosenScope, profile };
}

function pickFallbackScopeCandidate(doc) {
  if (!doc || typeof doc.querySelector !== 'function') {
    return null;
  }

  const selectors = ['article', 'main article', '[role="main"] article', 'main', '[role="main"]'];
  for (const selector of selectors) {
    const candidate = doc.querySelector(selector);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function verifyFallbackScopeCandidate(el) {
  const module = await loadScopedVerifierModule();
  const verifier = module?.verifyScopeRoot;
  if (typeof verifier !== 'function') {
    return { ok: false, reason: 'VERIFY_UNAVAILABLE' };
  }

  return verifier(el) || { ok: false, reason: 'VERIFY_FAILED' };
}

async function descendCandidateForContentRoot(candidate) {
  const module = await loadScopedVerifierModule();
  const descender = module?.descendCandidateForContentRoot;
  if (typeof descender !== 'function') {
    return { ok: false, reason: 'DESCEND_UNAVAILABLE' };
  }

  return descender(candidate, { maxNodes: 320, chunkSize: 50 });
}

// Public API (TypeScript) — documentation only
// export type SmartScopeRiskFlag =
//   | 'HAS_MODAL_OVERLAY'
//   | 'MULTI_COLUMN_LAYOUT'
//   | 'MISSING_MAIN_CONTENT'
//   | 'DENSE_NAV'
//   | 'UNKNOWN';
//
// export type DocumentSignals = {
//   score: number;
//   reasons: string[];
// };
//
// export type ScopeCandidate = {
//   selector: string;
//   kind: 'semantic' | 'density' | 'fallback';
//   score: number;
// };
//
// export type ProfileV1 = {
//   isDocumentLike: boolean;
//   documentSignals: DocumentSignals;
//   chosenScope: {
//     selector: string;
//     confidence: number;
//     candidateKind: ScopeCandidate['kind'];
//     topCandidates: ScopeCandidate[];
//   };
//   riskFlags: SmartScopeRiskFlag[];
//   processingTimeMs: number;
//   meta?: { url: string; title?: string; timeoutHit?: boolean };
// };
//
// export type SmartScopeProfileResponse =
//   | { ok: true; profile: ProfileV1 }
//   | { ok: false; errorCode: 'PROFILER_TIMEOUT' | 'PROFILER_ERROR'; error?: string };
//
// export type SmartScopeGetProfileMessage = { action: 'SMARTSCOPE_GET_PROFILE_V1' };
//
// Pseudo-code reference (Session 17):
// PageProfiler.getProfile():
//   start = performance.now()
//   set timeout(TIMEOUT_MS = 50): resolve(ok=false, errorCode=PROFILER_TIMEOUT)
//   try { profile = _computeProfile(); profile.processingTimeMs = now-start; resolve(ok=true, profile) }
//   catch e { resolve(ok=false, errorCode=PROFILER_ERROR, error=e.message) }
//
// _computeProfile():
//   docSignals = _detectDocumentSignals()
//   candidates = _findCandidates()
//   scored = candidates.map(scoreCandidate).sort(desc)
//   chosen = _selectBestCandidate(scored)
//   risks = _detectRisks()
//   return ProfileV1 { isDocumentLike, docSignals, chosenScope, risks, ... }
//
// _findCandidates():
//   collect semantic selectors if visible; then density-based fallbacks (bounded); fallback to body
//
// scoreCandidate(candidate):
//   textDensity = textChars / max(1, tagCount)
//   linkDensity = linkTextChars / max(1, textChars)
//   score = textDensity * (1 - linkDensity) + semanticBonus + patternBonus
//
// _detectDocumentSignals(): heuristics (paragraphs, headings, text length, optional Readability signal)
const SMARTSCOPE_TIMEOUT_MS = 50;
const SMARTSCOPE_MAX_DENSITY_CANDIDATES = 12;
const SMARTSCOPE_SEMANTIC_SELECTORS = [
  'main',
  '[role="main"]',
  'article',
  '#content',
  '#main-content',
  '#main',
  '[data-article-body]',
  '.article__body'
];

setAuraTestHook('__TEST_SMARTSCOPE__', {
  selectScopeRoot,
  selectScopeRootV2,
  SMARTSCOPE_TIMEOUT_MS,
});

class PageProfilerV1 {
  constructor() {
    this.lastProfile = null;
  }

  getProfile() {
    const start = performance.now();

    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        settled = true;
        resolve({ ok: false, errorCode: 'PROFILER_TIMEOUT' });
      }, SMARTSCOPE_TIMEOUT_MS);

      try {
        const profile = this._computeProfile();
        profile.processingTimeMs = Math.max(0, performance.now() - start);
        const exceededDeadline = profile.processingTimeMs > SMARTSCOPE_TIMEOUT_MS;

        if (settled) {
          return;
        }

        clearTimeout(timeoutId);

        if (exceededDeadline) {
          profile.meta = profile.meta || {};
          profile.meta.timeoutHit = true;
          resolve({ ok: false, errorCode: 'PROFILER_TIMEOUT' });
          return;
        }

        this.lastProfile = profile;
        resolve({ ok: true, profile });
      } catch (error) {
        if (settled) {
          return;
        }

        clearTimeout(timeoutId);
        resolve({ ok: false, errorCode: 'PROFILER_ERROR', error: error?.message || 'unknown' });
      }
    });
  }

  _computeProfile() {
    const documentSignals = this._detectDocumentSignals();
    const candidates = this._findCandidates();
    const scoredCandidates = candidates
      .map((candidate) => ({ ...candidate, score: this._scoreCandidate(candidate) }))
      .sort((a, b) => b.score - a.score);

    const chosen = this._selectBestCandidate(scoredCandidates);
    const riskFlags = this._detectRisks(chosen, documentSignals);

    return {
      isDocumentLike: documentSignals.score >= 0.5,
      documentSignals,
      chosenScope: {
        selector: chosen.selector,
        confidence: chosen.confidence,
        candidateKind: chosen.kind,
        topCandidates: scoredCandidates.slice(0, 3).map((candidate) => ({
          selector: candidate.selector,
          kind: candidate.kind,
          score: candidate.score
        }))
      },
      riskFlags,
      processingTimeMs: 0,
      meta: {
        url: window.location.href,
        title: document.title || undefined,
        timeoutHit: false
      }
    };
  }

  _detectDocumentSignals() {
    const reasons = [];
    const bodyText = (document.body && document.body.textContent ? document.body.textContent : '') || '';
    const truncatedLength = Math.min(bodyText.length, 5000);
    const paragraphCount = document.querySelectorAll('p').length;
    const headingCount = document.querySelectorAll('h1, h2').length;
    const linkCount = document.querySelectorAll('a').length;

    if (paragraphCount > 5) {
      reasons.push('paragraphs>5');
    }

    if (headingCount > 0) {
      reasons.push('has-heading');
    }

    if (truncatedLength > 1200) {
      reasons.push('text>1200');
    }

    if (linkCount > 100) {
      reasons.push('many-links');
    }

    const heuristicScore = Math.min(1, (paragraphCount / 12 + headingCount / 6 + truncatedLength / 6000) / 3);

    return {
      score: heuristicScore,
      reasons
    };
  }

  _findCandidates() {
    const candidates = [];
    const negativePattern = /(nav|menu|sidebar|footer|header)/i;

    SMARTSCOPE_SEMANTIC_SELECTORS.forEach((selector) => {
      const element = document.querySelector(selector);
      if (element && this._isVisible(element) && !negativePattern.test(element.className || '')) {
        candidates.push({ selector, kind: 'semantic' });
      }
    });

    const densityPool = Array.from(
      document.querySelectorAll('main, article, section, div[id], div[class], aside')
    ).slice(0, SMARTSCOPE_MAX_DENSITY_CANDIDATES * 2);

    const scoredDensity = densityPool
      .filter((element) => this._isVisible(element))
      .map((element) => ({ element, score: this._quickDensity(element) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SMARTSCOPE_MAX_DENSITY_CANDIDATES);

    scoredDensity.forEach(({ element }) => {
      candidates.push({ selector: this._buildSelector(element), kind: 'density' });
    });

    if (!candidates.length) {
      candidates.push({ selector: 'body', kind: 'fallback' });
    }

    return candidates;
  }

  _scoreCandidate(candidate) {
    const element = document.querySelector(candidate.selector);
    if (!element) {
      return 0;
    }

    const textContent = (element.textContent || '').trim();
    const textLength = textContent.length;
    const tagCount = element.getElementsByTagName('*').length + 1;
    const links = Array.from(element.getElementsByTagName('a'));
    const linkTextLength = links.reduce((sum, link) => sum + ((link.textContent || '').length), 0);

    const textDensity = textLength / Math.max(1, tagCount);
    const linkDensity = textLength === 0 ? 0 : linkTextLength / textLength;

    const semanticBonus = candidate.kind === 'semantic' ? 0.2 : 0;
    const navigationPenalty = /(nav|menu|sidebar|footer|header)/i.test(candidate.selector) ? -0.2 : 0;

    return Math.max(0, textDensity * (1 - linkDensity) / 100 + semanticBonus + navigationPenalty);
  }

  _selectBestCandidate(scoredCandidates) {
    if (!scoredCandidates.length) {
      return { selector: 'body', kind: 'fallback', confidence: 0 };
    }

    const best = scoredCandidates[0];
    const maxScore = Math.max(best.score, 0.0001);
    const second = scoredCandidates[1];
    const secondScore = second ? second.score : 0;

    const confidence = Math.min(1, maxScore === 0 ? 0 : maxScore / (maxScore + secondScore + 0.0001));

    return {
      selector: best.selector,
      kind: best.kind,
      confidence
    };
  }

  _detectRisks(chosen, documentSignals) {
    const flags = [];
    const chosenElement = document.querySelector(chosen.selector);

    if (this._hasModalOverlay()) {
      flags.push('HAS_MODAL_OVERLAY');
    }

    if (chosenElement && this._isMultiColumn(chosenElement)) {
      flags.push('MULTI_COLUMN_LAYOUT');
    }

    if (documentSignals.score < 0.35) {
      flags.push('MISSING_MAIN_CONTENT');
    }

    if (this._hasDenseNavigation()) {
      flags.push('DENSE_NAV');
    }

    if (!flags.length) {
      flags.push('UNKNOWN');
    }

    return flags;
  }

  _hasModalOverlay() {
    const overlaySelectors = ['[role="dialog"]', '.modal', '.overlay', '.backdrop'];
    return overlaySelectors.some((selector) => {
      const element = document.querySelector(selector);
      if (!element || !this._isVisible(element)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const viewportArea = window.innerWidth * window.innerHeight;
      const area = rect.width * rect.height;
      return area > viewportArea * 0.4;
    });
  }

  _isMultiColumn(element) {
    const computed = window.getComputedStyle(element);
    const columnCount = parseInt(computed.columnCount, 10);
    return Number.isFinite(columnCount) && columnCount > 1;
  }

  _hasDenseNavigation() {
    const navs = Array.from(document.querySelectorAll('nav, header, .nav, .menu'));
    if (navs.length < 2) {
      return false;
    }
    const shortLinks = navs.reduce((sum, nav) => {
      const links = Array.from(nav.querySelectorAll('a'));
      return sum + links.filter((link) => (link.textContent || '').trim().length < 15).length;
    }, 0);
    return shortLinks > 15;
  }

  _quickDensity(element) {
    const textLength = ((element.textContent || '').trim().length) || 0;
    const tagCount = element.getElementsByTagName('*').length + 1;
    return textLength / Math.max(1, tagCount);
  }

  _isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const hasSize = rect.width > 1 && rect.height > 1;
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    const style = window.getComputedStyle(element);
    return hasSize && inViewport && style.visibility !== 'hidden' && style.display !== 'none';
  }

  _buildSelector(element) {
    if (!element || !(element instanceof Element)) {
      return 'body';
    }
    if (element.id) {
      return `#${element.id}`;
    }
    if (element.className && typeof element.className === 'string') {
      const className = element.className.split(' ').filter(Boolean)[0];
      if (className) {
        return `${element.tagName.toLowerCase()}.${className}`;
      }
    }
    return element.tagName.toLowerCase();
  }
}

const pageProfilerV1 = new PageProfilerV1();

const SPA_HOOKS_REAPPLY_POLICY = {
  debounceMs: 200,
  maxWaitMs: 800,
  cooldownMs: 1200,
  rateLimitWindowMs: 5000,
  maxRunsPerWindow: 5,
  modalDeferPolicy: { maxAttempts: 3, maxWindowMs: 5000, baseDelayMs: 200 },
};

const SPA_HOOKS_RUNTIME_STATE = {
  scheduler: null,
  handler: null,
  active: false,
};

let didLogSpaHooksMissing = false;

function createSpaHooksScheduler() {
  if (SPA_HOOKS_RUNTIME_STATE.scheduler) {
    return SPA_HOOKS_RUNTIME_STATE.scheduler;
  }

  const debounceDelay = Number.isFinite(SPA_HOOKS_REAPPLY_POLICY.debounceMs)
    ? Math.max(0, SPA_HOOKS_REAPPLY_POLICY.debounceMs)
    : 0;
  const maxWaitDelay = Number.isFinite(SPA_HOOKS_REAPPLY_POLICY.maxWaitMs)
    ? Math.max(0, SPA_HOOKS_REAPPLY_POLICY.maxWaitMs)
    : 0;
  const cooldownDelay = Number.isFinite(SPA_HOOKS_REAPPLY_POLICY.cooldownMs)
    ? Math.max(0, SPA_HOOKS_REAPPLY_POLICY.cooldownMs)
    : 0;
  const rateWindow = Number.isFinite(SPA_HOOKS_REAPPLY_POLICY.rateLimitWindowMs)
    ? Math.max(0, SPA_HOOKS_REAPPLY_POLICY.rateLimitWindowMs)
    : 0;
  const maxRuns = Number.isFinite(SPA_HOOKS_REAPPLY_POLICY.maxRunsPerWindow)
    ? Math.max(0, SPA_HOOKS_REAPPLY_POLICY.maxRunsPerWindow)
    : 0;

  let debounceTimer = null;
  let maxWaitTimer = null;
  let lastRunAtMs = null;
  let windowStartMs = Date.now();
  let runCountWindow = 0;
  let pendingReason = null;
  let scheduledCount = 0;
  let suppressedCount = 0;
  let lastReason = null;

  const clearDebounceTimer = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const clearMaxWaitTimer = () => {
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const clearTimers = () => {
    clearDebounceTimer();
    clearMaxWaitTimer();
  };

  const updateRateLimitWindow = (currentMs) => {
    if (rateWindow <= 0) {
      return;
    }
    if (currentMs - windowStartMs > rateWindow) {
      windowStartMs = currentMs;
      runCountWindow = 0;
    }
  };

  const runWithBookkeeping = (reason, runAtMs) => {
    updateRateLimitWindow(runAtMs);

    if (maxRuns > 0 && runCountWindow >= maxRuns) {
      suppressedCount += 1;
      clearTimers();
      return;
    }

    runCountWindow += 1;
    lastRunAtMs = runAtMs;
    lastReason = reason;
    clearTimers();

    requestV2Reapply(lastReason);
  };

  const attemptRun = () => {
    const currentMs = Date.now();
    clearDebounceTimer();

    if (pendingReason == null) {
      return;
    }

    if (lastRunAtMs != null && cooldownDelay > 0 && currentMs - lastRunAtMs < cooldownDelay) {
      const waitMs = cooldownDelay - (currentMs - lastRunAtMs);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        attemptRun();
      }, waitMs);
      return;
    }

    const reason = pendingReason;
    pendingReason = null;
    clearMaxWaitTimer();

    runWithBookkeeping(reason, currentMs);
  };

  const scheduleAfter = (delayMs) => {
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      attemptRun();
    }, delayMs);
  };

  const ensureMaxWaitTimer = () => {
    if (maxWaitDelay <= 0 || maxWaitTimer) {
      return;
    }

    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      attemptRun();
    }, maxWaitDelay);
  };

  const schedule = (reason) => {
    scheduledCount += 1;
    pendingReason = reason;
    clearDebounceTimer();
    scheduleAfter(debounceDelay);
    ensureMaxWaitTimer();
  };

  const reset = () => {
    clearTimers();
    pendingReason = null;
    lastReason = null;
    lastRunAtMs = null;
    scheduledCount = 0;
    suppressedCount = 0;
    runCountWindow = 0;
    windowStartMs = Date.now();
  };

  const cancel = () => {
    clearTimers();
    pendingReason = null;
  };

  const getDebugState = () => ({
    pending: pendingReason != null,
    lastRunAtMs,
    scheduledCount,
    runCountWindow,
    suppressedCount,
    lastReason,
  });

  const scheduler = { schedule, reset, cancel, getDebugState };
  SPA_HOOKS_RUNTIME_STATE.scheduler = scheduler;
  return scheduler;
}

function handleSpaNavEvent(event) {
  if (!event || typeof event.detail !== 'object' || event.detail == null) {
    if (!didLogSpaHooksMissing) {
      didLogSpaHooksMissing = true;
      modeEngineDebugLog('SPA hooks v2 event detail missing; skipping reapply');
    }
    return;
  }

  const scheduler = SPA_HOOKS_RUNTIME_STATE.scheduler;
  if (!scheduler) {
    return;
  }

  const rawKind = event.detail.kind;
  const kind = typeof rawKind === 'string' && rawKind.trim() ? rawKind.trim() : 'nav';
  scheduler.schedule(`spa:${kind}`);
}

async function startSpaHooksV2IfEnabled() {
  if (!isFlagEnabled('smartScopeSpaHooks')) {
    stopSpaHooksV2IfRunning();
    return;
  }

  if (SPA_HOOKS_RUNTIME_STATE.active) {
    return;
  }

  const scheduler = createSpaHooksScheduler();
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    return;
  }

  try {
    window.addEventListener('aura:spa-nav', handleSpaNavEvent, true);
    SPA_HOOKS_RUNTIME_STATE.active = true;
    SPA_HOOKS_RUNTIME_STATE.handler = handleSpaNavEvent;
  } catch (error) {
    modeEngineDebugLog('SPA hooks v2 start failed', error);
  }
}

function stopSpaHooksV2IfRunning() {
  if (SPA_HOOKS_RUNTIME_STATE.active && SPA_HOOKS_RUNTIME_STATE.handler) {
    try {
      window.removeEventListener('aura:spa-nav', SPA_HOOKS_RUNTIME_STATE.handler, true);
    } catch (error) {
      modeEngineDebugLog('SPA hooks v2 stop failed', error);
    }
  }

  SPA_HOOKS_RUNTIME_STATE.active = false;
  SPA_HOOKS_RUNTIME_STATE.handler = null;

  if (SPA_HOOKS_RUNTIME_STATE.scheduler) {
    SPA_HOOKS_RUNTIME_STATE.scheduler.cancel?.();
    SPA_HOOKS_RUNTIME_STATE.scheduler.reset?.();
  }
}

async function maybeRunModeEngineV2() {
  if (BOOTSTRAP_ABORTED) {
    return;
  }

  const flags = getAllModeEngineFlags();
  const enabled =
    flags.modeEngineCssGuardrails ||
    flags.smartScopeV2 ||
    flags.scopedModeCssV2 ||
    flags.focusOverlayV2 ||
    flags.smartScopeSpaHooks;

  const debugEnabled = isFlagEnabled('debugModeEngine');

  if (!enabled) {
    if (debugEnabled && !maybeRunModeEngineV2._loggedDisabled) {
      modeEngineDebugLog('ModeEngine v2 disabled (no flags enabled)');
      maybeRunModeEngineV2._loggedDisabled = true;
    }
    stopSpaHooksV2IfRunning();
    dispatchFocusOverlayEvent({ enabled: false, destroy: true });
    teardownFocusOverlayV2({ destroyRoot: true });
    return;
  }

  if (debugEnabled && !maybeRunModeEngineV2._loggedEnabled) {
    const enabledFlags = Object.entries({
      modeEngineCssGuardrails: flags.modeEngineCssGuardrails,
      smartScopeV2: flags.smartScopeV2,
      scopedModeCssV2: flags.scopedModeCssV2,
      focusOverlayV2: flags.focusOverlayV2,
      smartScopeSpaHooks: flags.smartScopeSpaHooks,
    })
      .filter(([, value]) => Boolean(value))
      .map(([name]) => name);

    modeEngineDebugLog('ModeEngine v2 flags enabled', enabledFlags);
    maybeRunModeEngineV2._loggedEnabled = true;
  }

  startSpaHooksV2IfEnabled();

  // TODO(PR1): Guardrails integration point
  // TODO(PR2): SmartScope v2 orchestration
  // TODO(PR3): Scoped CSS v2 application
  // TODO(PR4): Focus overlay v2 entry
  // TODO(PR5): SPA hooks v2 wiring

  if (flags.focusOverlayV2) {
    startFocusOverlayPrefsWatcher();
  }

  applyFocusSubmodes(null, null, flags).catch((error) => {
    modeEngineDebugLog('Focus runtime entry failed', error);
  });
}

// ========== SECTION 10: INIT ==========
function init() {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  if (typeof CURRENT_TAB_ID !== 'number') {
    console.error('[CS] Cannot initialize detectors without tabId');
    return;
  }

  const zoomDetector = new ZoomDetector(CURRENT_TAB_ID);
  const colorSchemeDetector = new ColorSchemeDetector(CURRENT_TAB_ID);
  const readingBehaviorDetector = new ReadingBehaviorDetector(CURRENT_TAB_ID);

  activeDetectors = [zoomDetector, colorSchemeDetector, readingBehaviorDetector];
}

function toKebabCase(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function evaluateComputedStyles(checks = []) {
  const results = [];

  checks.forEach((check) => {
    const result = {
      selector: check?.selector,
      property: check?.property,
      passed: false,
    };

    try {
      if (!check?.selector || !check?.property || !check?.compare) {
        result.reason = 'invalid-check';
        results.push(result);
        return;
      }

      const element = document.querySelector(check.selector);

      if (check.compare === 'exists') {
        result.passed = Boolean(element);
        if (!result.passed) {
          result.reason = 'missing-element';
        }
        results.push(result);
        return;
      }

      if (!element) {
        result.reason = 'missing-element';
        results.push(result);
        return;
      }

      const computed = window.getComputedStyle(element);
      const propertyName = check.property || '';
      const actual =
        computed?.[propertyName] || computed?.getPropertyValue?.(toKebabCase(propertyName)) || '';

      result.actual = actual;
      result.expected = check.value;

      switch (check.compare) {
        case 'eq': {
          result.passed = String(actual) === String(check.value ?? '');
          if (!result.passed) {
            result.reason = 'value-mismatch';
          }
          break;
        }
        case 'gt': {
          const numericActual = Number.parseFloat(actual);
          const numericExpected = Number.parseFloat(check.value);
          if (Number.isNaN(numericActual) || Number.isNaN(numericExpected)) {
            result.reason = 'non-numeric';
            break;
          }
          result.passed = numericActual > numericExpected;
          if (!result.passed) {
            result.reason = 'comparison-failed';
          }
          break;
        }
        case 'lte': {
          const numericActual = Number.parseFloat(actual);
          const numericExpected = Number.parseFloat(check.value);
          if (Number.isNaN(numericActual) || Number.isNaN(numericExpected)) {
            result.reason = 'non-numeric';
            break;
          }
          result.passed = numericActual <= numericExpected;
          if (!result.passed) {
            result.reason = 'comparison-failed';
          }
          break;
        }
        default:
          result.reason = 'unknown-compare';
          break;
      }
    } catch (error) {
      result.reason = error?.message || 'error';
      result.passed = false;
    }

    results.push(result);
  });

  const allPassed = results.every((entry) => entry.passed);
  return { allPassed, results };
}

// ========== SECTION 11: MESSAGE LISTENER ==========
const runtimeMessageListener = (message, sender, sendResponse) => {
  if (AURA_CONTEXT_INVALIDATED) {
    sendResponse({ received: false, reason: 'context-invalidated' });
    return true;
  }

  if (debugTestHooksEnabled && message?.type === 'AURA_PING_TEST_V1') {
    sendResponse({ ok: true, type: 'AURA_PONG_TEST_V1' });
    return true;
  }

  let responsePayload = { received: true };

  switch (message.action) {
    case SMARTSCOPE_ACTIONS.GET_PROFILE: {
      const budgetMs = typeof message.budgetMs === 'number' ? message.budgetMs : SMARTSCOPE_TIMEOUT_MS;
      const level = message.level || 'conservative';
      ensureSitePolicyAllowed({ context: 'smartscope-profile' })
        .then((allowed) => {
          if (!allowed) {
            sendResponse({ ok: false, error: 'SITE_POLICY_BLOCKED' });
            return;
          }

          selectScopeRoot(document, level, budgetMs)
            .then(({ root, profile }) => {
              const scopeSelector = root ? buildScopeSelectorHint(root) : '';
              sendResponse({
                ok: true,
                profile: {
                  ...profile,
                  scopeSelector,
                }
              });
            })
            .catch(() => {
              sendResponse({ ok: false, error: 'SMARTSCOPE_FAILED' });
            });
        })
        .catch(() => {
          sendResponse({ ok: false, error: 'SMARTSCOPE_FAILED' });
        });
      return true;
    }
    case ACTIONS.SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1: {
      const payload = evaluateComputedStyles(message.checks || []);
      sendResponse(payload);
      return true;
    }
    case ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS:
      applyScopeTokensToStoredRoot(message.tokenMap || {}, message.ownerKey || MODE_ENGINE_SCOPE_OWNER, {
        transitionMs: message?.transitionMs,
      })
        .then((result) => {
          const scopeRoot = getStoredScopeRoot();
          if (result?.ok) {
            const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
            applyFocusSubmodes(null, null, flags, scopeRoot).catch((error) => {
              modeEngineDebugLog('Focus runtime scope apply failed', error);
            });
            try {
              const darkEnabled = isDarkFromTokenMap(message.tokenMap || {});
              if (darkEnabled && scopeRoot) {
                scheduleDarkInitialApplyPasses(scopeRoot);
                ensureDarkObserver(scopeRoot);
                applyDarkSurfaceInlineOverridesSafe(scopeRoot, 'apply');
                fixUnreadableHeadings(scopeRoot);
                scheduleDarkInlineSliceRescans(scopeRoot);
                startDarkObservers(scopeRoot);
              } else {
                if (scopeRoot) {
                  clearDarkSurfaceTagsSafe(scopeRoot, 'apply');
                }
                teardownDarkObserver();
                stopDarkObservers();
                stopDarkInitialApplyPasses();
                clearDarkSurfaceInlineOverridesSafe('apply');
              }
            } catch (error) {
              modeEngineDebugLog('Dark surface apply failed', error);
            }
          }
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: 'TOKEN_APPLY_FAILED',
            detail: error?.message || 'applyScopeTokens failed',
          });
        });
      return true;
    case ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS:
      clearHeadingFixes();
      if (message?.smoothTransitions === true || message?.preserveScope === true) {
        const scopeRoot = getStoredScopeRoot();
        if (scopeRoot) {
          armModeEngineAnim(scopeRoot, message?.transitionMs);
        }
      }
      cleanupScopeTokensFromStoredRoot(
        message.ownerKey || MODE_ENGINE_SCOPE_OWNER,
        message?.preserveScope ? { preserveScope: true } : {},
      )
        .then((result) => {
          const scopeRoot = getStoredScopeRoot();
          if (result?.ok) {
            const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
            applyFocusSubmodes(null, null, flags, scopeRoot).catch((error) => {
              modeEngineDebugLog('Focus runtime scope cleanup failed', error);
            });
          }
          try {
            if (scopeRoot) {
              clearDarkSurfaceTagsSafe(scopeRoot, 'cleanup');
            }
            teardownDarkObserver();
            stopDarkObservers();
            stopDarkInitialApplyPasses();
            clearDarkSurfaceInlineOverridesSafe('cleanup');
          } catch (error) {
            modeEngineDebugLog('Dark surface cleanup failed', error);
          }
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: 'TOKEN_APPLY_FAILED',
            detail: error?.message || 'cleanupScopeTokens failed',
          });
        });
      return true;
    case ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT:
      handleModeEngineV2SetScopeRoot(message?.selector)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: 'SET_SCOPE_ROOT_FAILED',
            detail: error?.message || 'setScopeRoot failed',
          });
        });
      return true;
    case ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT:
      handleModeEngineV2VerifyScopeRoot(message?.selector)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: 'VERIFY_SCOPE_ROOT_FAILED',
            detail: error?.message || 'verifyScopeRoot failed',
            source: 'verifyScopeRoot',
          });
        });
      return true;
    case ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT:
      handleModeEngineV2SalvageScopeRoot(message?.selector, message?.debugEnabled)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: 'SALVAGE_SCOPE_ROOT_FAILED',
            detail: error?.message || 'salvageScopeRoot failed',
            source: 'salvageScopeRoot',
          });
        });
      return true;
    case ACTIONS.MODE_ENGINE_V2_MEASURE_CONTRAST: {
      try {
        const sampleLimit = typeof message.sampleLimit === 'number' ? message.sampleLimit : CONTRAST_SAMPLE_LIMIT;
        sendResponse(measureScopeContrast(sampleLimit));
      } catch (error) {
        sendResponse({
          ok: false,
          reason: 'contrast-check-failed',
          detail: error?.message || 'measureScopeContrast failed',
        });
      }
      return true;
    }
    case ACTIONS.SHOW_BANNER:
      if (isAnyModeActive()) {
        hideSuggestionBannerIfPresent();
        sendResponse({ ok: true, suppressed: true, reason: 'mode-active' });
        return true;
      }
      ensureSitePolicyAllowed({ context: 'show-banner' })
        .then((allowed) => {
          if (!allowed) {
            sendResponse({ received: true, suppressed: true });
            return;
          }

          if (!activeBanner) {
            activeBanner = new SuggestionBanner();
          }
          activeBanner.show({
            modeId: message.modeId,
            score: typeof message.score === 'number' ? message.score : message.confidence,
            position: message.position || BANNER_POSITION.TOP_RIGHT
          });
          sendResponse({ received: true });
        })
        .catch(() => {
          sendResponse({ received: true, suppressed: true });
        });
      return true;
    case ACTIONS.TEST_PING_CONTENT:
      responsePayload = handleTestPing();
      break;
    case ACTIONS.TEST_INJECT_SUGGESTION_BANNER:
      responsePayload = handleTestInjectSuggestionBanner(
        message.modeId,
        message.confidence,
        message.signals,
      );
      break;
    case ACTIONS.TEST_CLEAR_SUGGESTION_BANNER:
      responsePayload = handleTestClearSuggestionBanner();
      break;
    case ACTIONS.INJECT_RESTORE_BUTTON:
      ensureRestoreButtonConstructor();
      if (typeof AURA?.RestoreButton !== 'function') {
        console.error('[CS] RestoreButton missing or not constructible');
        responsePayload = { injected: false, error: 'RESTORE_BUTTON_INVALID' };
        break;
      }
      if (typeof message.modeId === 'string') {
        setModeActive(message.modeId, true);
      }
      if (activeRestoreButton) {
        activeRestoreButton.remove();
      }
      activeRestoreButton = new AURA.RestoreButton(message.modeId);
      activeRestoreButton.inject();
      if (message.modeId === (MODE_IDS.FOCUS || 'focus')) {
        applyFocusRuntime().catch((error) => {
          modeEngineDebugLog('Focus runtime enable failed', error);
        });
      }
      responsePayload = { injected: true };
      break;
    case ACTIONS.REMOVE_RESTORE_BUTTON:
      if (activeRestoreButton) {
        activeRestoreButton.remove();
        activeRestoreButton = null;
      } else {
        const existingButton = document.getElementById('aura-restore-button');
        if (existingButton && existingButton.parentNode) {
          existingButton.parentNode.removeChild(existingButton);
        }
      }
      if (message.modeId === (MODE_IDS.FOCUS || 'focus')) {
        setModeActive(message.modeId, false);
        applyFocusRuntime().catch((error) => {
          modeEngineDebugLog('Focus runtime disable failed', error);
        });
      } else if (typeof message.modeId === 'string') {
        setModeActive(message.modeId, false);
      }
      responsePayload = { removed: true };
      break;
    case ACTIONS.PREFS_UPDATED:
      setRuntimePrefs(message?.prefs || {});
      applyFocusRuntime(message?.prefs).catch((error) => {
        modeEngineDebugLog('Focus runtime prefs update failed', error);
      });
      responsePayload = { received: true };
      break;
    case ACTIONS.MODE_ENGINE_V2_APPLY_RESULT:
      modeEngineDebugLog('ModeEngine v2 apply result', {
        ok: message?.ok !== false,
        reason: message?.reason || null,
        mode: message?.modeId || message?.mode,
        attemptId: message?.attemptId,
      });
      if (typeof message?.modeId === 'string' || typeof message?.mode === 'string') {
        const resolvedModeId = message?.modeId || message?.mode;
        setModeActive(resolvedModeId, message?.ok !== false);
        if (resolvedModeId === (MODE_IDS.FOCUS || 'focus')) {
          applyFocusRuntime().catch((error) => {
            modeEngineDebugLog('Focus runtime apply result update failed', error);
          });
        }
        if (message?.ok !== false && resolvedModeId === MODE_IDS.COMFORT_VISUAL) {
          setTimeout(() => {
            sendContrastReport(resolvedModeId, message?.attemptId).catch((error) => {
              modeEngineDebugLog('Contrast report failed', error);
            });
          }, 0);
        }
      }
      responsePayload = { received: true };
      break;
    default:
      // Unknown action placeholder
      break;
  }

  sendResponse(responsePayload);
  return true;
};

window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__ = runtimeMessageListener;
window.__AURA_CONTENT_READY_FOR_PING__ = true;
chrome.runtime.onMessage.addListener(runtimeMessageListener);

console.log('[CS] AURA content script loaded');
})();
