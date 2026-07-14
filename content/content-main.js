// content/content-main.js

// ========== SECTION 1: CONSTANTS ==========
// Shared constants loaded via service worker bridge
const AURA = {};
let debugTestHooksEnabled = false;
const pendingTestHooks = new Map();
const TEST_PING_ACTION = 'AURA_PING_TEST_V1';
const TEST_PONG_ACTION = 'AURA_PONG_TEST_V1';
const HEADING_FIX_ATTR = 'data-aura-heading-fix';
const HEADING_FIX_ATTR_VALUE = '1';
const HEADING_FIX_TEXT_VALUE = 'var(--aura-text-color)';
const HEADING_FIX_PRIORITY = 'important';
const HEADING_FIX_MAX = 120;
const HEADING_FIX_MAX_MS = 12;
const HEADING_CONTRAST_THRESHOLD = 4.5;
const AURA_UI_OWNER_ATTR = 'data-aura-ui-owner';
const SUGGESTION_BANNER_OWNER = 'suggestion-banner';
const RESTORE_BUTTON_OWNER = 'restore-button';
const SUGGESTION_BANNER_ID = 'aura-suggestion-banner';
const RESTORE_BUTTON_ID = 'aura-restore-button';
let headingFixSet = new Set();
let headingFixSnapshots = new WeakMap();
let headingFixApplied = new WeakMap();
const auraOwnedUiHosts = new WeakSet();

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

const DOCUMENT_CONTEXT_ACTION = 'GET_DOCUMENT_CONTEXT_V1';
const EARLY_PING_ACTION = 'TEST_PING_CONTENT';

function isTopFrameDocument() {
  try {
    return window.top === window;
  } catch (_) {
    return false;
  }
}

function activateContentBootstrapRuntime() {
  const api = globalThis.AURA_CONTENT_BOOTSTRAP_V1;
  if (
    !isExtContextValid()
    || api?.version !== 1
    || typeof api.getOrCreate !== 'function'
  ) {
    console.error('[CS] Content bootstrap runtime unavailable');
    return null;
  }

  try {
    const state = api.getOrCreate({
      scope: window,
      messagePort: {
        addListener(listener) {
          chrome.runtime.onMessage.addListener(listener);
        },
        removeListener(listener) {
          chrome.runtime.onMessage.removeListener(listener);
        },
      },
      isTopFrame: isTopFrameDocument,
      pingAction: EARLY_PING_ACTION,
      documentContextAction: DOCUMENT_CONTEXT_ACTION,
    });
    if (
      state?.version !== 1
      || typeof state.documentInstanceId !== 'string'
      || !state.documentInstanceId
      || typeof state.claim !== 'function'
      || typeof state.markRetryableFailed !== 'function'
      || typeof state.markReady !== 'function'
      || typeof state.rearmMainListener !== 'function'
      || typeof state.detachEarlyListener !== 'function'
      || typeof state.invalidate !== 'function'
    ) {
      throw new Error('CONTENT_BOOTSTRAP_STATE_INVALID');
    }
    return state;
  } catch (error) {
    console.error('[CS] Content bootstrap runtime activation failed', error);
    return null;
  }
}

const AURA_CONTENT_BOOTSTRAP_STATE = activateContentBootstrapRuntime();
const DOCUMENT_INSTANCE_ID = AURA_CONTENT_BOOTSTRAP_STATE?.documentInstanceId || null;
const AURA_CONTENT_LOAD_STATE = AURA_CONTENT_BOOTSTRAP_STATE?.claim() || {
  claimed: false,
  invalidated: true,
  generation: 0,
};

if (AURA_CONTENT_LOAD_STATE.alreadyLoaded) {
  AURA_CONTENT_BOOTSTRAP_STATE.rearmMainListener();
}

let BOOTSTRAP_ABORTED = false;
let BOOTSTRAP_ABORT_LOGGED = false;

(async function bootstrapAuraContentMain() {
  if (AURA_CONTENT_LOAD_STATE.claimed !== true) {
    return;
  }

  const contentMessageRouterApi = globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1;
  if (contentMessageRouterApi == null) {
    const reason = 'CONTENT_MESSAGE_ROUTER_UNAVAILABLE';
    console.error('[CS] Content message router unavailable');
    BOOTSTRAP_ABORTED = true;
    AURA_CONTENT_BOOTSTRAP_STATE.markRetryableFailed(
      AURA_CONTENT_LOAD_STATE.generation,
      reason,
      1,
    );
    return;
  }
  if (
    contentMessageRouterApi.version !== 1
    || typeof contentMessageRouterApi.createListener !== 'function'
  ) {
    const reason = 'CONTENT_MESSAGE_ROUTER_INCOMPATIBLE';
    console.error('[CS] Content message router incompatible');
    BOOTSTRAP_ABORTED = true;
    AURA_CONTENT_BOOTSTRAP_STATE.invalidate(AURA_CONTENT_LOAD_STATE.generation, reason);
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
let CONTENT_MESSAGE_ROUTES_V1 = {};

const SHARED_CONSTANTS_REQUEST_TYPE = 'AURA_GET_SHARED_CONSTANTS_V1';
const SHARED_CONSTANTS_TIMEOUT_MS = 2000;
const SHARED_CONSTANTS_MAX_ATTEMPTS = 3;
const SHARED_CONSTANTS_RETRY_BASE_DELAY_MS = 100;
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

function isRetryableSharedConstantsFailure(reason) {
  return reason === 'NO_RECEIVER' || reason === 'TIMEOUT' || reason === 'SW_ERROR';
}

async function loadSharedConstantsWithRetry({
  maxAttempts = SHARED_CONSTANTS_MAX_ATTEMPTS,
  timeoutMs = SHARED_CONSTANTS_TIMEOUT_MS,
  baseDelayMs = SHARED_CONSTANTS_RETRY_BASE_DELAY_MS,
} = {}) {
  const attempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1;
  let result = { ok: false, reason: 'NO_RECEIVER' };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await loadSharedConstantsFromSW({ timeoutMs });
    if (result.ok || !isRetryableSharedConstantsFailure(result.reason) || attempt === attempts) {
      return { ...result, attempts: attempt };
    }
    const delayMs = Math.max(0, baseDelayMs) * (2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { ...result, attempts };
}

setAuraTestHook('__TEST_LOAD_SHARED_CONSTANTS__', loadSharedConstantsFromSW);

const sharedConstantsResultPromise = (async () => {
  const result = await loadSharedConstantsWithRetry();

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
  CONTENT_MESSAGE_ROUTES_V1 = constants.CONTENT_MESSAGE_ROUTES_V1 || CONTENT_MESSAGE_ROUTES_V1;

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
let modeEngineFlagStorageListener = null;

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

  if (AURA_CONTEXT_INVALIDATED) {
    return { ok: false, reason: 'EXT_CONTEXT_INVALID' };
  }

  try {
    modeEngineFlagDefaults = { ...defaultFlags };
    modeEngineFlagStorageKey =
      constantsResult?.constants?.STORAGE_KEYS?.FEATURE_FLAGS || modeEngineFlagStorageKey;
    if (chrome?.storage?.onChanged?.addListener) {
      modeEngineFlagStorageListener = (changes, areaName) => {
        if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, modeEngineFlagStorageKey)) {
          maybeRunModeEngineV2();
        }
      };
      chrome.storage.onChanged.addListener(modeEngineFlagStorageListener);
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
  AURA_CONTENT_BOOTSTRAP_STATE.markRetryableFailed(
    AURA_CONTENT_LOAD_STATE.generation,
    sharedConstantsResult.reason || 'BOOTSTRAP_FAILED',
    sharedConstantsResult.attempts,
  );
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
let runtimeMessageListener = null;

let activeDetectors = [];
let activeSignalEngine = null;
let activeBanner = null;
let activeRestoreButton = null;
let sitePolicyCache = null;
let sitePolicyRequest = null;
let sitePolicyWatcherEnabled = false;
const sitePolicyWatcherState = {
  historyObject: null,
  originalPushState: null,
  originalReplaceState: null,
  wrappedPushState: null,
  wrappedReplaceState: null,
  popstateHandler: null,
  hashchangeHandler: null,
};
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

function isOwnedAuraUiHost(element, owner) {
  return Boolean(
    element
    && auraOwnedUiHosts.has(element)
    && element.getAttribute?.(AURA_UI_OWNER_ATTR) === owner,
  );
}

function findOwnedAuraUiHost(owner) {
  try {
    const candidates = document.querySelectorAll?.(`[${AURA_UI_OWNER_ATTR}="${owner}"]`) || [];
    return Array.from(candidates).find((element) => isOwnedAuraUiHost(element, owner)) || null;
  } catch (_) {
    return null;
  }
}

function prepareAuraUiHost(element, preferredId, owner) {
  const idCollision = document.getElementById?.(preferredId);
  element.id = idCollision && !isOwnedAuraUiHost(idCollision, owner)
    ? `${preferredId}-aura`
    : preferredId;
  element.setAttribute(AURA_UI_OWNER_ATTR, owner);
  auraOwnedUiHosts.add(element);
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

  if (result?.ok !== true) {
    if (activeBanner?.destroy) {
      activeBanner.destroy();
      activeBanner = null;
    }
    return false;
  }

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

function clearPageSignalTargetRegistry() {
  try {
    globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1?.clearTargetRegistry?.();
  } catch {
    // Registry cleanup is best-effort and must not affect visible runtime behavior.
  }
}

function startSitePolicyWatcher() {
  if (sitePolicyWatcherEnabled || typeof window === 'undefined' || !isTopFrameDocument()) {
    return;
  }

  sitePolicyWatcherEnabled = true;

  let lastUrl = window.location?.href || '';
  const checkForUrlChange = (reason) => {
    const nextUrl = window.location?.href || '';
    if (nextUrl && nextUrl !== lastUrl) {
      lastUrl = nextUrl;
      clearPageSignalTargetRegistry();
      scheduleSitePolicyRefresh(reason || 'spa');
    }
  };

  const historyObject = history;
  const originalPushState = historyObject.pushState;
  const originalReplaceState = historyObject.replaceState;

  const wrappedPushState = function pushStateWrapper(...args) {
    const result = originalPushState.apply(historyObject, args);
    checkForUrlChange('pushState');
    return result;
  };

  const wrappedReplaceState = function replaceStateWrapper(...args) {
    const result = originalReplaceState.apply(historyObject, args);
    checkForUrlChange('replaceState');
    return result;
  };
  const popstateHandler = () => checkForUrlChange('popstate');
  const hashchangeHandler = () => checkForUrlChange('hashchange');

  historyObject.pushState = wrappedPushState;
  historyObject.replaceState = wrappedReplaceState;
  window.addEventListener('popstate', popstateHandler);
  window.addEventListener('hashchange', hashchangeHandler);

  Object.assign(sitePolicyWatcherState, {
    historyObject,
    originalPushState,
    originalReplaceState,
    wrappedPushState,
    wrappedReplaceState,
    popstateHandler,
    hashchangeHandler,
  });

  scheduleSitePolicyRefresh('init');
}

function stopSitePolicyWatcher() {
  if (sitePolicyCache?.refreshTimer) {
    clearTimeout(sitePolicyCache.refreshTimer);
    sitePolicyCache.refreshTimer = null;
  }

  const {
    historyObject,
    originalPushState,
    originalReplaceState,
    wrappedPushState,
    wrappedReplaceState,
    popstateHandler,
    hashchangeHandler,
  } = sitePolicyWatcherState;

  try {
    if (historyObject?.pushState === wrappedPushState && originalPushState) {
      historyObject.pushState = originalPushState;
    }
    if (historyObject?.replaceState === wrappedReplaceState && originalReplaceState) {
      historyObject.replaceState = originalReplaceState;
    }
  } catch (error) {
    console.warn('[CS] Site policy history teardown failed', error);
  }

  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
  }
  if (hashchangeHandler) {
    window.removeEventListener('hashchange', hashchangeHandler);
  }

  Object.assign(sitePolicyWatcherState, {
    historyObject: null,
    originalPushState: null,
    originalReplaceState: null,
    wrappedPushState: null,
    wrappedReplaceState: null,
    popstateHandler: null,
    hashchangeHandler: null,
  });
  sitePolicyWatcherEnabled = false;
  sitePolicyRequest = null;
  sitePolicyCache = null;
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

function performTeardown({ invalidateBootstrap = true } = {}) {
  clearPageSignalTargetRegistry();
  stopSitePolicyWatcher();

  if (modeEngineFlagStorageListener && chrome?.storage?.onChanged?.removeListener) {
    chrome.storage.onChanged.removeListener(modeEngineFlagStorageListener);
    modeEngineFlagStorageListener = null;
  }

  activeDetectors.forEach((detector) => {
    try {
      detector?.destroy?.();
    } catch (error) {
      console.warn('[CS] Detector teardown failed', error);
    }
  });
  activeDetectors = [];
  activeSignalEngine = null;

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
  stopFocusOverlayPrefsWatcher();
  stopReadingRulerRuntimeControls();
  cleanupFocusRuntime();
  disarmModeEngineAnim(getActiveScopeRoot());

  if (typeof runtimeMessageListener === 'function') {
    try {
      chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    } catch (error) {
      console.warn('[CS] Runtime listener teardown failed', error);
    }
  }

  try {
    AURA_CONTENT_BOOTSTRAP_STATE.detachEarlyListener();
  } catch (error) {
    console.warn('[CS] Early listener teardown failed', error);
  }

  if (invalidateBootstrap) {
    AURA_CONTENT_BOOTSTRAP_STATE.invalidate(
      AURA_CONTENT_LOAD_STATE.generation,
      'content-main-teardown',
    );
  }

  if (window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__ === runtimeMessageListener) {
    delete window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__;
  }
  if (window.__AURA_CONTENT_MAIN_TEARDOWN__ === markContextInvalidated) {
    delete window.__AURA_CONTENT_MAIN_TEARDOWN__;
  }
}

window.__AURA_CONTENT_MAIN_TEARDOWN__ = markContextInvalidated;

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
let currentTabIdRequest = null;
let contentReadySentV2 = false;

async function acquireCurrentTabId() {
  if (typeof CURRENT_TAB_ID === 'number') {
    return CURRENT_TAB_ID;
  }
  if (!currentTabIdRequest) {
    currentTabIdRequest = safeSendMessage(
      { action: ACTIONS.GET_TAB_ID },
      { contextLabel: 'get-tab-id' },
    ).then((response) => {
      if (!response || typeof response.tabId !== 'number') {
        return null;
      }
      CURRENT_TAB_ID = response.tabId;
      return CURRENT_TAB_ID;
    }).finally(() => {
      currentTabIdRequest = null;
    });
  }
  return currentTabIdRequest;
}

function notifyContentReadyV2(tabId) {
  if (AURA_CONTEXT_INVALIDATED || contentReadySentV2 || !isTopFrameDocument()) {
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
    {
      action: ACTIONS.CONTENT_SCRIPT_READY_V2,
      tabId,
      url: location.href,
      documentInstanceId: DOCUMENT_INSTANCE_ID,
    },
    { warnKey: SILENT_WARNING_KEYS.READY_V2, warnMessage: '[CS] READY handshake failed (cs-ready-v2)' },
  );
}

function requestV2Reapply(reason) {
  if (AURA_CONTEXT_INVALIDATED || !isTopFrameDocument()) {
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

    return acquireCurrentTabId().then((tabId) => {
      if (typeof tabId !== 'number') {
        console.error('[CS] Failed to acquire tabId: invalid response');
        return null;
      }
      init();
      startSitePolicyWatcher();
      maybeRunModeEngineV2();
      startReadingRulerRuntimeControls();
      applyFocusRuntime().catch((error) => {
        modeEngineDebugLog('Focus runtime entry failed', error);
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

// ========== SECTION 4: SIGNAL ENGINE ==========
const SIGNAL_EMIT_RULES = {
  colorScheme: { dedupe: true, throttleMs: 0, cooldownMs: 0 },
  readingBehavior: { dedupe: true, throttleMs: 1000, cooldownMs: 2000 },
  viewportScale: { dedupe: true, throttleMs: 250, cooldownMs: 500 },
  viewportScroll: { dedupe: true, throttleMs: 250, cooldownMs: 500 },
};

function buildSignalContext() {
  return {
    pageHost: window.location?.hostname || '',
    frameId: 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function createSignalValueKey(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[object]';
    }
  }

  return String(value);
}

class SignalEngine {
  constructor(tabId) {
    this.tabId = tabId;
    this.lastByType = new Map();
  }

  resetBaseline(reason = 'rearm') {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    this.lastByType.clear();
    modeEngineDebugLog('SignalEngine baseline reset', { reason });
  }

  emit({ type, value, confidence, source, context }) {
    if (AURA_CONTEXT_INVALIDATED) {
      return false;
    }

    if (typeof this.tabId !== 'number' || !type) {
      return false;
    }

    const now = Date.now();
    const rules = SIGNAL_EMIT_RULES[type] || { dedupe: true, throttleMs: 0, cooldownMs: 0 };
    const valueKey = createSignalValueKey(value);
    const last = this.lastByType.get(type);

    if (rules.dedupe && last?.valueKey === valueKey) {
      return false;
    }

    if (rules.throttleMs && last?.sentAt && now - last.sentAt < rules.throttleMs) {
      return false;
    }

    if (rules.cooldownMs && last?.emittedAt && now - last.emittedAt < rules.cooldownMs) {
      return false;
    }

    const signalEvent = {
      type,
      value,
      confidence,
      ts: now,
      source,
      context: context || buildSignalContext(),
    };

    this.lastByType.set(type, { valueKey, sentAt: now, emittedAt: now });

    safeSendMessage(
      {
        action: ACTIONS.SIGNAL_DETECTED,
        tabId: this.tabId,
        signal: signalEvent,
        timestamp: now,
      },
      { contextLabel: `signal-${type}` },
    );

    return true;
  }
}

// ========== SECTION 5: COLOR SCHEME DETECTOR ==========
class ColorSchemeDetector {
  constructor(tabId, signalEngine) {
    this.tabId = tabId;
    this.signalEngine = signalEngine;
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
      this.signalEngine?.emit({
        type: SIGNALS.COLOR_SCHEME,
        value: scheme,
        confidence: 0.8,
        source: 'matchMedia',
        context: buildSignalContext(),
      });
    }
  }

  rearm(reason = 'spa') {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    this.currentScheme = null;
    modeEngineDebugLog('ColorSchemeDetector rearm', { reason });
    this.checkColorScheme();
  }

  destroy() {
    try {
      this.mediaQuery.removeEventListener('change', this._onChange);
    } catch (error) {
      console.warn('[CS] Failed to remove color scheme listener', error);
    }
  }
}

// ========== SECTION 6: VISUAL VIEWPORT DETECTOR ==========
class VisualViewportDetector {
  constructor(tabId, signalEngine) {
    this.tabId = tabId;
    this.signalEngine = signalEngine;
    this.viewport = window.visualViewport || null;
    this._onViewportChangeBound = this.onViewportChange.bind(this);
    this.init();
  }

  init() {
    if (!this.viewport) {
      return;
    }

    if (typeof this.tabId !== 'number') {
      console.error('[CS] VisualViewportDetector cannot init: missing tabId');
      return;
    }

    this.onViewportChange();
    this.viewport.addEventListener('resize', this._onViewportChangeBound, { passive: true });
    this.viewport.addEventListener('scroll', this._onViewportChangeBound, { passive: true });
  }

  onViewportChange() {
    if (AURA_CONTEXT_INVALIDATED || !this.viewport) {
      return;
    }

    const scale = this.viewport.scale;
    if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
      this.signalEngine?.emit({
        type: SIGNALS.VIEWPORT_SCALE,
        value: Number(scale.toFixed(3)),
        confidence: 0.9,
        source: 'visualViewport',
        context: {
          ...buildSignalContext(),
          viewportWidth: Math.round(this.viewport.width),
          viewportHeight: Math.round(this.viewport.height),
        },
      });
    }

    const scrollValue = {
      offsetTop: Number(this.viewport.offsetTop.toFixed(1)),
      offsetLeft: Number(this.viewport.offsetLeft.toFixed(1)),
    };

    this.signalEngine?.emit({
      type: SIGNALS.VIEWPORT_SCROLL,
      value: scrollValue,
      confidence: 0.6,
      source: 'visualViewport',
      context: {
        ...buildSignalContext(),
        viewportWidth: Math.round(this.viewport.width),
        viewportHeight: Math.round(this.viewport.height),
      },
    });
  }

  rearm(reason = 'spa') {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    modeEngineDebugLog('VisualViewportDetector rearm', { reason });
    this.onViewportChange();
  }

  destroy() {
    if (!this.viewport) {
      return;
    }

    try {
      this.viewport.removeEventListener('resize', this._onViewportChangeBound);
      this.viewport.removeEventListener('scroll', this._onViewportChangeBound);
    } catch (error) {
      console.warn('[CS] Failed to remove visual viewport listeners', error);
    }
  }
}

// ========== SECTION 7: READING BEHAVIOR DETECTOR ==========
class ReadingBehaviorDetector {
  constructor(tabId, signalEngine) {
    this.tabId = tabId;
    this.signalEngine = signalEngine;
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
      this.signalEngine?.emit({
        type: SIGNALS.READING_BEHAVIOR,
        value: 'rapid-scrolling',
        confidence: 0.6,
        source: 'readingBehavior',
        context: buildSignalContext(),
      });
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
      this.signalEngine?.emit({
        type: SIGNALS.READING_BEHAVIOR,
        value: 'text-selection',
        confidence: 0.5,
        source: 'readingBehavior',
        context: buildSignalContext(),
      });
    }
  }

  rearm(reason = 'spa') {
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    this.scrollEvents = [];
    modeEngineDebugLog('ReadingBehaviorDetector rearm', { reason });
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
AURA.VisualViewportDetector = VisualViewportDetector;
AURA.SignalEngine = SignalEngine;

// ========== SECTION 8: SUGGESTION BANNER ==========
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
    prepareAuraUiHost(this.bannerHost, SUGGESTION_BANNER_ID, SUGGESTION_BANNER_OWNER);
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

  show({ modeId, score = 0, position = BANNER_POSITION.TOP_RIGHT }) {
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

    const buttons = Array.from(this.actions?.querySelectorAll?.('button') || []);
    buttons.forEach((button) => {
      button.disabled = true;
    });

    const response = await safeSendMessage(
      {
        action: ACTIONS.USER_DECISION,
        tabId: CURRENT_TAB_ID,
        modeId,
        decision
      },
      { contextLabel: 'banner-decision' },
    );

    if (response?.ok !== true) {
      const detail = response?.detail || response?.reason || response?.error || 'Request failed';
      const prefix =
        decision === DECISIONS.ENABLED
          ? 'AURA could not apply this mode yet.'
          : 'AURA could not save this decision yet.';
      this.message.textContent = `${prefix} ${detail}`;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      return;
    }

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

    const host = activeBanner?.bannerHost || findOwnedAuraUiHost(SUGGESTION_BANNER_OWNER);
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
    const existingButton = findOwnedAuraUiHost(RESTORE_BUTTON_OWNER);
    if (existingButton?.parentNode) {
      existingButton.parentNode.removeChild(existingButton);
    }

    this.host = document.createElement('div');
    prepareAuraUiHost(this.host, RESTORE_BUTTON_ID, RESTORE_BUTTON_OWNER);
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
    if (AURA_CONTEXT_INVALIDATED) {
      return;
    }

    const tabId = await acquireCurrentTabId();
    if (typeof tabId !== 'number') return;

    const response = await safeSendMessage(
      {
        action: ACTIONS.RESTORE_MODE,
        tabId,
        modeId: this.modeId
      },
      { contextLabel: 'restore-mode' },
    );

    if (response?.ok === true) {
      this.remove();
    } else if (this.button) {
      this.button.textContent = 'Retry restore';
      this.button.setAttribute('aria-label', 'Retry restore original page');
      this.button.title = response?.error || response?.reason || 'Restore failed';
    }
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

function readHeadingInlineProperty(style, property) {
  if (!style) {
    return { value: '', priority: '' };
  }

  const value = typeof style.getPropertyValue === 'function'
    ? style.getPropertyValue(property)
    : style[property];
  const priority = typeof style.getPropertyPriority === 'function'
    ? style.getPropertyPriority(property)
    : style[`${property}Priority`];

  return {
    value: typeof value === 'string' ? value : '',
    priority: typeof priority === 'string' ? priority : '',
  };
}

function headingInlinePropertyMatches(style, property, expected) {
  if (!expected) {
    return false;
  }
  const current = readHeadingInlineProperty(style, property);
  return current.value === expected.value && current.priority === expected.priority;
}

function captureHeadingFixSnapshot(heading) {
  const attrValue = typeof heading.getAttribute === 'function' ? heading.getAttribute(HEADING_FIX_ATTR) : null;
  return {
    color: readHeadingInlineProperty(heading.style, 'color'),
    textFillColor: readHeadingInlineProperty(heading.style, '-webkit-text-fill-color'),
    attrHad: attrValue !== null,
    attrValue,
  };
}

function getHeadingFixSnapshot(heading) {
  let snapshot = headingFixSnapshots.get(heading);
  if (!snapshot) {
    snapshot = captureHeadingFixSnapshot(heading);
    headingFixSnapshots.set(heading, snapshot);
  }
  return snapshot;
}

function getHeadingFixApplied(heading) {
  let applied = headingFixApplied.get(heading);
  if (!applied) {
    applied = {};
    headingFixApplied.set(heading, applied);
  }
  return applied;
}

function prepareHeadingFixProperty(heading, property, snapshotKey) {
  const snapshot = getHeadingFixSnapshot(heading);
  const applied = getHeadingFixApplied(heading);
  if (applied[property] && !headingInlinePropertyMatches(heading.style, property, applied[property])) {
    snapshot[snapshotKey] = readHeadingInlineProperty(heading.style, property);
  }
}

function rememberHeadingFixProperty(heading, property) {
  const applied = getHeadingFixApplied(heading);
  applied[property] = {
    value: HEADING_FIX_TEXT_VALUE,
    priority: HEADING_FIX_PRIORITY,
  };
}

function prepareHeadingFixAttribute(heading) {
  const snapshot = getHeadingFixSnapshot(heading);
  const applied = getHeadingFixApplied(heading);
  const attrValue = typeof heading.getAttribute === 'function' ? heading.getAttribute(HEADING_FIX_ATTR) : null;
  if (applied.attr === HEADING_FIX_ATTR_VALUE && attrValue !== HEADING_FIX_ATTR_VALUE) {
    snapshot.attrHad = attrValue !== null;
    snapshot.attrValue = attrValue;
  }
}

function restoreHeadingFixProperty(heading, property, snapshotValue, appliedValue) {
  if (!heading?.style || !appliedValue || !headingInlinePropertyMatches(heading.style, property, appliedValue)) {
    return;
  }

  if (snapshotValue?.value) {
    heading.style.setProperty(property, snapshotValue.value, snapshotValue.priority || '');
  } else {
    heading.style.removeProperty(property);
  }
}

function restoreHeadingFixAttribute(heading, snapshot, applied) {
  if (!heading || typeof heading.getAttribute !== 'function') {
    return;
  }

  const currentAttr = heading.getAttribute(HEADING_FIX_ATTR);
  if (currentAttr !== applied?.attr) {
    return;
  }

  if (snapshot?.attrHad) {
    heading.setAttribute(HEADING_FIX_ATTR, snapshot.attrValue);
  } else if (typeof heading.removeAttribute === 'function') {
    heading.removeAttribute(HEADING_FIX_ATTR);
  }
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

    prepareHeadingFixProperty(heading, 'color', 'color');
    prepareHeadingFixProperty(heading, '-webkit-text-fill-color', 'textFillColor');
    prepareHeadingFixAttribute(heading);
    heading.style.setProperty('color', HEADING_FIX_TEXT_VALUE, HEADING_FIX_PRIORITY);
    rememberHeadingFixProperty(heading, 'color');
    heading.style.setProperty('-webkit-text-fill-color', HEADING_FIX_TEXT_VALUE, HEADING_FIX_PRIORITY);
    rememberHeadingFixProperty(heading, '-webkit-text-fill-color');
    heading.setAttribute(HEADING_FIX_ATTR, HEADING_FIX_ATTR_VALUE);
    getHeadingFixApplied(heading).attr = HEADING_FIX_ATTR_VALUE;
    headingFixSet.add(heading);
  }
}

function clearHeadingFixes() {
  if (!headingFixSet || headingFixSet.size === 0) {
    headingFixSet = new Set();
    return;
  }

  headingFixSet.forEach((heading) => {
    if (!heading || !(heading instanceof Element)) {
      return;
    }

    const snapshot = headingFixSnapshots.get(heading);
    const applied = headingFixApplied.get(heading);
    restoreHeadingFixProperty(heading, 'color', snapshot?.color, applied?.color);
    restoreHeadingFixProperty(heading, '-webkit-text-fill-color', snapshot?.textFillColor, applied?.['-webkit-text-fill-color']);
    restoreHeadingFixAttribute(heading, snapshot, applied);
  });

  headingFixSet = new Set();
  headingFixSnapshots = new WeakMap();
  headingFixApplied = new WeakMap();
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

const DARK_COMFORT_THEME_TOKEN_KEYS = new Set([
  '--aura-color-scheme',
  '--aura-bg-color',
  '--aura-text-color',
  '--aura-muted-text-color',
  '--aura-border-color',
  '--aura-surface-1',
  '--aura-surface-2',
  '--aura-link-color',
  '--aura-link-visited-color',
  '--aura-link-hover-color',
  '--aura-focus-color',
]);

function sanitizeDarkComfortThemeTokens(tokenMap, executorActive) {
  if (!isDarkFromTokenMap(tokenMap) || executorActive === true) {
    return tokenMap;
  }

  return Object.fromEntries(
    Object.entries(tokenMap || {}).filter(([key]) => !DARK_COMFORT_THEME_TOKEN_KEYS.has(key)),
  );
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

  const ownedKeys = Array.isArray(options?.ownedKeys)
    ? options.ownedKeys
    : (Array.isArray(AURA?.modeEngineScopeTokens) ? AURA.modeEngineScopeTokens : []);
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
let focusOverlayPrefsListener = null;
const FOCUS_OVERLAY_DEFAULT_ALPHA = 0.2;
const FOCUS_OVERLAY_DEFAULT_BLUR_PX = 0;
const READING_RULER_DEFAULT_HEIGHT_PX = 120;
const READING_RULER_DEFAULT_OPACITY = 0.12;
const READING_RULER_DEFAULT_BLUR_PX = 0;
const READING_RULER_DEFAULT_FEATHER_PX = 24;
let readingRulerShortcutListenerAttached = false;
let readingRulerExitListenerAttached = false;
let readingRulerShortcutHandler = null;
let readingRulerExitHandler = null;
const FOCUS_NOT_OBSCURED_THRESHOLD_PX = 64;
const FOCUS_NOT_OBSCURED_KEYBOARD_WINDOW_MS = 1200;
const FOCUS_NOT_OBSCURED_REPEAT_WINDOW_MS = 800;
const TARGET_BOOST_CLASS = 'aura-target-boost';
const TARGET_BOOST_MIN_SIZE_PX = 24;
const TARGET_BOOST_MAX_ELEMENTS = 50;
const TARGET_BOOST_SCAN_THROTTLE_MS = 200;
const TARGET_BOOST_FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
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
const runtimeModeState = {
  activeModes: {},
  prefs: null,
};
let focusRuntimeIntentRevision = 0;

function beginFocusRuntimeIntent() {
  focusRuntimeIntentRevision += 1;
  const revision = focusRuntimeIntentRevision;
  return {
    revision,
    isCurrent: () => revision === focusRuntimeIntentRevision && !AURA_CONTEXT_INVALIDATED,
  };
}

function isFocusRuntimeIntentCurrent(intent) {
  return !intent || intent.isCurrent();
}

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
    const host = findOwnedAuraUiHost(SUGGESTION_BANNER_OWNER);
    if (host?.parentNode) {
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

function normalizeFocusOverlayBlurPx(value, fallback = FOCUS_OVERLAY_DEFAULT_BLUR_PX) {
  const numeric = clampNumber(value, 0, 24);
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
    { distractionDim: false, targetBoost: false, reduceMotion: false, readingRuler: false };
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

function normalizeReadingRulerBlurPx(value, fallback = READING_RULER_DEFAULT_BLUR_PX) {
  const numeric = clampNumber(value, 0, 24);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function normalizeReadingRulerFeatherPx(value, fallback = READING_RULER_DEFAULT_FEATHER_PX) {
  const numeric = clampNumber(value, 0, 120);
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

function isSearchLikeLocation() {
  try {
    const loc = document?.location || {};
    const pathname = String(loc.pathname || '').toLowerCase();
    const search = String(loc.search || '').toLowerCase();
    return pathname.includes('/search') || search.includes('q=') || search.includes('query=');
  } catch (_) {
    return false;
  }
}

function isSimpleFormSurface(scopeEl) {
  if (!scopeEl || typeof scopeEl.querySelectorAll !== 'function') {
    return false;
  }

  try {
    const formCount = scopeEl.querySelectorAll('form, [role="form"]').length;
    const fieldCount = scopeEl.querySelectorAll('input, textarea, select, button').length;
    const tableCount = scopeEl.querySelectorAll('table, [role="table"], [role="grid"]').length;
    return formCount > 0 && fieldCount > 0 && tableCount === 0;
  } catch (_) {
    return false;
  }
}

function isTargetBoostAllowedBySignals(signals) {
  if (!signals || signals.stats?.budgetHit === true) {
    return false;
  }

  const hints = signals.pageHints || {};
  if (hints.modalLikeCount > 0 || hints.tableCount > 0) {
    return false;
  }
  if (typeof hints.smallTargetCount === 'number' && hints.smallTargetCount <= 0) {
    return false;
  }

  if (hints.urlKind === 'SEARCH') {
    return true;
  }

  const blocks = Array.isArray(signals.blocks) ? signals.blocks : [];
  const hasFormBlock = blocks.some((block) => block?.roleHint === 'FORM');
  return hints.formCount > 0 && hasFormBlock;
}

function isTargetBoostAllowedSurface(scopeEl) {
  const adapter = globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  const collector = adapter?.collectPageSignalsV1;
  if (typeof collector === 'function') {
    try {
      return isTargetBoostAllowedBySignals(collector({
        doc: document,
        frameId: 0,
        budgetMs: 8,
        maxBlocks: 8,
        maxNodes: 800,
        maxCandidatesSeen: 120,
      }));
    } catch (_) {
      return false;
    }
  }

  return isSearchLikeLocation() || isSimpleFormSurface(scopeEl);
}

const READING_RULER_BLOCKED_URL_KINDS = new Set(['DASHBOARD', 'VIDEO', 'WEB_APP', 'UNKNOWN']);
const READING_RULER_BLOCKED_ROLE_HINTS = new Set(['PLAYER', 'TABLE']);

function isReadingRulerAllowedBySignals(signals) {
  if (!signals || typeof signals !== 'object') {
    return true;
  }

  if (signals.stats?.budgetHit === true) {
    return false;
  }

  const hints = signals.pageHints || {};
  if (READING_RULER_BLOCKED_URL_KINDS.has(hints.urlKind)) {
    return false;
  }
  if (hints.modalLikeCount > 0) {
    return false;
  }

  const metrics = signals.aggregateMetrics || {};
  if (hints.tableCount > 1 || metrics.tableDensity > 0.35 || metrics.interactiveDensity > 0.65) {
    return false;
  }

  const blocks = Array.isArray(signals.blocks) ? signals.blocks : [];
  return !blocks.some((block) => {
    if (READING_RULER_BLOCKED_ROLE_HINTS.has(block?.roleHint)) {
      return true;
    }
    const blockMetrics = block?.metrics || {};
    return blockMetrics.tableDensity > 0.5 || blockMetrics.mediaDensity > 0.45;
  });
}

function isReadingRulerAllowedSurface() {
  const adapter = globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  const collector = adapter?.collectPageSignalsV1;
  if (typeof collector !== 'function') {
    return false;
  }

  try {
    return isReadingRulerAllowedBySignals(collector({
      doc: document,
      frameId: 0,
      budgetMs: 8,
      maxBlocks: 8,
      maxNodes: 800,
      maxCandidatesSeen: 120,
    }));
  } catch (_) {
    return false;
  }
}

setAuraTestHook('__TEST_IS_READING_RULER_ALLOWED_BY_SIGNALS__', isReadingRulerAllowedBySignals);

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

  return rect.width < TARGET_BOOST_MIN_SIZE_PX || rect.height < TARGET_BOOST_MIN_SIZE_PX;
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

async function handleTargetBoostStateChange(scopeEl = null, flagsOverride = null, intent = null) {
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    stopTargetBoost();
    return;
  }

  if (!isFlagEnabledWithOverride('targetBoostV1', flagsOverride)) {
    stopTargetBoost();
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadTargetBoostPrefs(), isFocusModeActive()]);

  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (!focusActive || !prefs.enabled) {
    stopTargetBoost();
    return;
  }

  const targetScope = scopeEl || getActiveScopeRoot();
  if (!targetScope) {
    stopTargetBoost();
    return;
  }

  if (!isTargetBoostAllowedSurface(targetScope)) {
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
      blurPx: FOCUS_OVERLAY_DEFAULT_BLUR_PX,
      reduceMotion: prefersReducedMotion(),
    };
  }

  try {
    const userPrefs = await loadUserPrefs();
    const focusModeId = MODE_IDS.FOCUS || 'focus';
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
    const rawAlpha = userPrefs.focusOverlayAlpha ?? userPrefs?.modePrefs?.[focusModeId]?.distractionDimAlpha;
    const rawBlurPx = userPrefs.focusOverlayBlurPx ?? userPrefs?.modePrefs?.[focusModeId]?.distractionDimBlurPx;

    return {
      distractionDim: modePrefs.distractionDim === true,
      alpha: normalizeFocusOverlayAlpha(rawAlpha, FOCUS_OVERLAY_DEFAULT_ALPHA),
      blurPx: normalizeFocusOverlayBlurPx(rawBlurPx, FOCUS_OVERLAY_DEFAULT_BLUR_PX),
      reduceMotion: userPrefs.reducedMotion === true || modePrefs.reduceMotion === true || prefersReducedMotion(),
    };
  } catch (error) {
    return {
      distractionDim: false,
      alpha: FOCUS_OVERLAY_DEFAULT_ALPHA,
      blurPx: FOCUS_OVERLAY_DEFAULT_BLUR_PX,
      reduceMotion: prefersReducedMotion(),
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
      blurPx: READING_RULER_DEFAULT_BLUR_PX,
      featherPx: READING_RULER_DEFAULT_FEATHER_PX,
      reduceMotion: prefersReducedMotion(),
    };
  }

  try {
    const userPrefs = await loadUserPrefs();
    const focusModeId = MODE_IDS.FOCUS || 'focus';
    const modePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
    const rawHeight = userPrefs.readingRulerHeightPx ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerHeightPx;
    const rawOpacity = userPrefs.readingRulerOpacity ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerOpacity;
    const rawBlurPx = userPrefs.readingRulerBlurPx ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerBlurPx;
    const rawFeatherPx = userPrefs.readingRulerFeatherPx ?? userPrefs?.modePrefs?.[focusModeId]?.readingRulerFeatherPx;

    return {
      enabled: modePrefs.readingRuler === true,
      heightPx: normalizeReadingRulerHeight(rawHeight, READING_RULER_DEFAULT_HEIGHT_PX),
      opacity: normalizeReadingRulerOpacity(rawOpacity, READING_RULER_DEFAULT_OPACITY),
      blurPx: normalizeReadingRulerBlurPx(rawBlurPx, READING_RULER_DEFAULT_BLUR_PX),
      featherPx: normalizeReadingRulerFeatherPx(rawFeatherPx, READING_RULER_DEFAULT_FEATHER_PX),
      reduceMotion: userPrefs.reducedMotion === true || modePrefs.reduceMotion === true || prefersReducedMotion(),
    };
  } catch (error) {
    return {
      enabled: false,
      heightPx: READING_RULER_DEFAULT_HEIGHT_PX,
      opacity: READING_RULER_DEFAULT_OPACITY,
      blurPx: READING_RULER_DEFAULT_BLUR_PX,
      featherPx: READING_RULER_DEFAULT_FEATHER_PX,
      reduceMotion: prefersReducedMotion(),
    };
  }
}

function dispatchFocusOverlayEvent(detail) {
  try {
    const setState = globalThis.AURA_FOCUS_OVERLAY_V2?.setState;
    if (typeof setState !== 'function') {
      throw new Error('Focus overlay runtime bridge unavailable');
    }
    setState(detail);
  } catch (error) {
    modeEngineDebugLog('Focus overlay state update failed', error);
  }
}

function dispatchReadingRulerEvent(detail) {
  try {
    const setState = globalThis.AURA_READING_RULER?.setState;
    if (typeof setState !== 'function') {
      throw new Error('Reading ruler runtime bridge unavailable');
    }
    setState(detail);
  } catch (error) {
    modeEngineDebugLog('Reading ruler state update failed', error);
  }
}

async function loadUltraFocusPrefs() {
  return { enabled: false };
}

function dispatchUltraFocusEvent(detail) {
  try {
    const setState = globalThis.AURA_ULTRA_FOCUS?.setState;
    if (typeof setState !== 'function') {
      throw new Error('Ultra Focus runtime bridge unavailable');
    }
    setState(detail);
  } catch (error) {
    modeEngineDebugLog('Ultra focus state update failed', error);
  }
}

function dispatchUltraFocusLockEvent(detail) {
  try {
    const setLock = globalThis.AURA_ULTRA_FOCUS?.setLock;
    if (typeof setLock !== 'function') {
      throw new Error('Ultra Focus runtime lock bridge unavailable');
    }
    setLock(detail);
  } catch (error) {
    modeEngineDebugLog('Ultra focus lock update failed', error);
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

async function loadDarkComfortThemeRuntimeModule() {
  const runtimeModule = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME || null;
  if (!runtimeModule) {
    modeEngineDebugLog('Dark Comfort Theme runtime missing');
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
    if (options?.alpha !== undefined || options?.blurPx !== undefined || options?.transitionMs !== undefined) {
      focusOverlayController.setEnabled?.(true, {
        alpha: options.alpha,
        blurPx: options.blurPx,
        transitionMs: options.transitionMs,
      });
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

async function handleFocusOverlayScopeChange(scopeEl = null, flagsOverride = null, intent = null) {
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (!isFlagEnabledWithOverride('focusOverlayV2', flagsOverride)) {
    dispatchFocusOverlayEvent({ enabled: false, destroy: true });
    teardownFocusOverlayV2({ destroyRoot: true });
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadFocusOverlayPrefs(), isFocusModeActive()]);
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

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

  const transitionMs = prefs.reduceMotion ? 0 : undefined;
  dispatchFocusOverlayEvent({
    enabled: true,
    alpha: prefs.alpha,
    blurPx: prefs.blurPx,
    transitionMs,
    scope: targetScope,
  });
}

async function handleReadingRulerStateChange(intent = null) {
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return;
  }

  await loadReadingRulerModule();
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadReadingRulerPrefs(), isFocusModeActive()]);
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  const safeSurface = isReadingRulerAllowedSurface();
  const readingRulerEnabled = prefs.enabled === true && focusActive === true && safeSurface === true;
  setAuraTestHook('__TEST_READING_RULER_STATE__', {
    enabled: readingRulerEnabled,
    focusActive: focusActive === true,
    safeSurface: safeSurface === true,
    heightPx: prefs.heightPx,
    opacity: prefs.opacity,
    blurPx: prefs.blurPx,
    featherPx: prefs.featherPx,
    timestamp: Date.now(),
  });

  if (!readingRulerEnabled) {
    dispatchReadingRulerEvent({ enabled: false });
    return;
  }

  dispatchReadingRulerEvent({
    enabled: true,
    heightPx: prefs.heightPx,
    opacity: prefs.opacity,
    blurPx: prefs.blurPx,
    featherPx: prefs.featherPx,
    reduceMotion: prefs.reduceMotion,
  });
}

async function handleUltraFocusStateChange(flagsOverride = null, intent = null) {
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    return;
  }

  if (!isFlagEnabledWithOverride('ultraFocusV1', flagsOverride)) {
    dispatchUltraFocusEvent({ enabled: false });
    dispatchUltraFocusLockEvent({ lock: false });
    return;
  }

  await loadUltraFocusModule();
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadUltraFocusPrefs(), isFocusModeActive()]);
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (!prefs.enabled || !focusActive) {
    dispatchUltraFocusEvent({ enabled: false });
    dispatchUltraFocusLockEvent({ lock: false });
    return;
  }

  dispatchUltraFocusEvent({ enabled: true });
}

function startFocusOverlayPrefsWatcher() {
  if (focusOverlayPrefsListenerAttached || !isTopFrameDocument()) {
    return;
  }

  if (!chrome?.storage?.onChanged?.addListener) {
    return;
  }

  focusOverlayPrefsListenerAttached = true;

  focusOverlayPrefsListener = (changes, areaName) => {
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
  };
  chrome.storage.onChanged.addListener(focusOverlayPrefsListener);
}

function stopFocusOverlayPrefsWatcher() {
  if (focusOverlayPrefsListener && chrome?.storage?.onChanged?.removeListener) {
    chrome.storage.onChanged.removeListener(focusOverlayPrefsListener);
  }
  focusOverlayPrefsListener = null;
  focusOverlayPrefsListenerAttached = false;
}

async function setReadingRulerPreference(nextValue, contextLabel = 'reading-ruler-set') {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }

  const normalizedNextValue = nextValue === true;
  const response = await safeSendMessage({
    action: ACTIONS.PREFS_UPDATED,
    preferencePatch: { readingRuler: normalizedNextValue },
  }, { contextLabel });
  if (!response?.ok || !response.prefs) {
    throw new Error(response?.error || 'Reading ruler preference update failed');
  }

  const nextPrefs = response.prefs;
  setRuntimePrefs(nextPrefs);

  applyFocusRuntime(nextPrefs).catch((error) => {
    modeEngineDebugLog('Reading ruler preference update failed', error);
  });
}

async function toggleReadingRulerPreference() {
  if (!chrome?.storage?.local?.get) {
    return;
  }

  const prefsKey = getUserPrefsStorageKey();
  const stored = await chrome.storage.local.get(prefsKey);
  const userPrefs = stored?.[prefsKey] || {};
  const currentModePrefs = normalizeFocusModePrefs(userPrefs.modePrefs);
  await setReadingRulerPreference(currentModePrefs.readingRuler !== true, 'reading-ruler-toggle');
}

function startReadingRulerRuntimeControls() {
  if (readingRulerShortcutListenerAttached || !isTopFrameDocument()) {
    return;
  }

  readingRulerShortcutListenerAttached = true;

  readingRulerShortcutHandler = async (event) => {
    if (!event || event.isTrusted !== true || event.defaultPrevented) {
      return;
    }

    const isR = event.key?.toLowerCase?.() === 'r' || event.code === 'KeyR';
    if (!event.altKey || !isR) {
      return;
    }

    const focusActive = await isFocusModeActive();
    if (AURA_CONTEXT_INVALIDATED || !focusActive) {
      return;
    }

    event.preventDefault();
    toggleReadingRulerPreference().catch((error) => {
      modeEngineDebugLog('Reading ruler shortcut failed', error);
    });
  };
  window.addEventListener('keydown', readingRulerShortcutHandler);

  if (!readingRulerExitListenerAttached) {
    const onExit = globalThis.AURA_READING_RULER?.onExit;
    if (typeof onExit === 'function') {
      readingRulerExitListenerAttached = true;
      readingRulerExitHandler = () => {
        setReadingRulerPreference(false, 'reading-ruler-exit').catch((error) => {
          modeEngineDebugLog('Reading ruler exit failed', error);
        });
      };
      onExit(readingRulerExitHandler);
    }
  }
}

function stopReadingRulerRuntimeControls() {
  if (readingRulerShortcutHandler) {
    window.removeEventListener('keydown', readingRulerShortcutHandler);
  }
  readingRulerShortcutHandler = null;
  readingRulerShortcutListenerAttached = false;

  if (readingRulerExitListenerAttached) {
    try {
      globalThis.AURA_READING_RULER?.onExit?.(null);
    } catch (error) {
      modeEngineDebugLog('Reading ruler exit teardown failed', error);
    }
  }
  readingRulerExitHandler = null;
  readingRulerExitListenerAttached = false;
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

async function handleFocusNotObscuredStateChange(intent = null) {
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (AURA_CONTEXT_INVALIDATED || typeof CURRENT_TAB_ID !== 'number') {
    focusNotObscuredState.enabled = false;
    detachFocusNotObscuredListeners();
    return;
  }

  const [prefs, focusActive] = await Promise.all([loadFocusNotObscuredPrefs(), isFocusModeActive()]);
  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

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

function normalizeFocusPrefsOverride(focusPrefs) {
  if (!focusPrefs || typeof focusPrefs !== 'object' || Array.isArray(focusPrefs)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(focusPrefs, 'modePrefs')) {
    return focusPrefs;
  }

  const focusModeId = MODE_IDS.FOCUS || 'focus';
  return {
    modePrefs: {
      [focusModeId]: focusPrefs,
    },
  };
}

async function applyFocusSubmodes({ isFocusActive, focusPrefs, flags, scopeRoot } = {}) {
  const intent = beginFocusRuntimeIntent();
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  const normalizedPrefs = normalizeFocusPrefsOverride(focusPrefs);
  if (normalizedPrefs) {
    setRuntimePrefs(normalizedPrefs);
  }

  let focusActive = isFocusActive;
  if (typeof focusActive !== 'boolean') {
    focusActive = await isFocusModeActive();
  }

  if (!isFocusRuntimeIntentCurrent(intent)) {
    return;
  }

  if (focusActive === false) {
    cleanupFocusRuntime();
    return;
  }

  await handleFocusOverlayScopeChange(scopeRoot, flags, intent);
  if (!isFocusRuntimeIntentCurrent(intent)) return;
  await handleReadingRulerStateChange(intent);
  if (!isFocusRuntimeIntentCurrent(intent)) return;
  await handleUltraFocusStateChange(flags, intent);
  if (!isFocusRuntimeIntentCurrent(intent)) return;
  await handleFocusNotObscuredStateChange(intent);
  if (!isFocusRuntimeIntentCurrent(intent)) return;
  await handleTargetBoostStateChange(scopeRoot, flags, intent);
}

async function applyFocusRuntime(prefsOverride = null) {
  const focusModeId = MODE_IDS.FOCUS || 'focus';
  const focusActive = getModeActive(focusModeId);
  const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
  await applyFocusSubmodes({ isFocusActive: focusActive, focusPrefs: prefsOverride, flags });
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
  debounceMs: 80,
  maxWaitMs: 350,
  cooldownMs: 800,
  rateLimitWindowMs: 5000,
  maxRunsPerWindow: 5,
  modalDeferPolicy: { maxAttempts: 3, maxWindowMs: 5000, baseDelayMs: 200 },
};

const SPA_HOOKS_RUNTIME_STATE = {
  scheduler: null,
  handler: null,
  active: false,
  lastObservedUrl: null,
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

    rearmSignalDetectors(lastReason);
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

  const currentUrl = String(globalThis.location?.href || '');
  const announcedUrl = typeof event.detail.url === 'string' ? event.detail.url : currentUrl;
  if (!currentUrl || announcedUrl !== currentUrl || SPA_HOOKS_RUNTIME_STATE.lastObservedUrl === currentUrl) {
    return;
  }
  SPA_HOOKS_RUNTIME_STATE.lastObservedUrl = currentUrl;

  const rawKind = event.detail.kind;
  const kind = typeof rawKind === 'string' && rawKind.trim() ? rawKind.trim() : 'nav';
  scheduler.schedule(`spa:${kind}`);
}

function rearmSignalDetectors(reason = 'spa') {
  if (AURA_CONTEXT_INVALIDATED) {
    return;
  }

  if (!activeSignalEngine || !Array.isArray(activeDetectors) || activeDetectors.length === 0) {
    return;
  }

  activeSignalEngine.resetBaseline?.(reason);
  activeDetectors.forEach((detector) => {
    if (typeof detector?.rearm === 'function') {
      detector.rearm(reason);
    }
  });
}

async function startSpaHooksV2IfEnabled() {
  if (!isTopFrameDocument()) {
    stopSpaHooksV2IfRunning();
    return;
  }

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
    SPA_HOOKS_RUNTIME_STATE.lastObservedUrl = String(globalThis.location?.href || '');
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
  SPA_HOOKS_RUNTIME_STATE.lastObservedUrl = null;

  if (SPA_HOOKS_RUNTIME_STATE.scheduler) {
    SPA_HOOKS_RUNTIME_STATE.scheduler.cancel?.();
    SPA_HOOKS_RUNTIME_STATE.scheduler.reset?.();
  }
}

async function maybeRunModeEngineV2() {
  if (BOOTSTRAP_ABORTED || AURA_CONTEXT_INVALIDATED) {
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

  if (flags.focusOverlayV2) {
    startFocusOverlayPrefsWatcher();
  }

  applyFocusSubmodes({ flags }).catch((error) => {
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

  const signalEngine = new SignalEngine(CURRENT_TAB_ID);
  const zoomDetector = new ZoomDetector(CURRENT_TAB_ID);
  const colorSchemeDetector = new ColorSchemeDetector(CURRENT_TAB_ID, signalEngine);
  const visualViewportDetector = new VisualViewportDetector(CURRENT_TAB_ID, signalEngine);
  const readingBehaviorDetector = new ReadingBehaviorDetector(CURRENT_TAB_ID, signalEngine);

  activeSignalEngine = signalEngine;
  activeDetectors = [zoomDetector, colorSchemeDetector, visualViewportDetector, readingBehaviorDetector];
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

const smartScopeClassTokens = new Map();

function normalizeClassListValue(value) {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function addClassName(element, className) {
  if (!element?.classList || !className) {
    return false;
  }

  if (typeof element.classList.add === 'function') {
    element.classList.add(className);
    return true;
  }

  return false;
}

function removeClassName(element, className) {
  if (!element?.classList || !className) {
    return false;
  }

  if (typeof element.classList.remove === 'function') {
    element.classList.remove(className);
    return true;
  }

  if (typeof element.classList.delete === 'function') {
    return element.classList.delete(className);
  }

  return false;
}

function handleSmartScopeApplyClasses(message = {}) {
  const token = typeof message.token === 'string' && message.token.trim() ? message.token.trim() : '';
  const operations = Array.isArray(message.operations) ? message.operations : [];
  if (!token || operations.length === 0) {
    return { ok: false, error: 'INVALID_PAYLOAD' };
  }

  const appliedEntries = [];
  const appliedClasses = [];
  const errors = [];

  operations.forEach((operation, index) => {
    const selector = typeof operation?.selector === 'string' ? operation.selector.trim() : '';
    if (!selector) {
      errors.push({ index, error: 'MISSING_SELECTOR' });
      return;
    }

    let elements = [];
    try {
      elements = Array.from(document.querySelectorAll(selector));
    } catch (error) {
      errors.push({ index, selector, error: error?.message || 'INVALID_SELECTOR' });
      return;
    }

    if (elements.length === 0) {
      errors.push({ index, selector, error: 'NO_MATCH' });
      return;
    }

    const addClasses = Array.isArray(operation.add)
      ? operation.add.flatMap(normalizeClassListValue)
      : normalizeClassListValue(operation.add);
    const removeClasses = Array.isArray(operation.remove)
      ? operation.remove.flatMap(normalizeClassListValue)
      : normalizeClassListValue(operation.remove);

    elements.forEach((element) => {
      const added = [];
      addClasses.forEach((className) => {
        if (addClassName(element, className)) {
          added.push(className);
          if (!appliedClasses.includes(className)) {
            appliedClasses.push(className);
          }
        }
      });
      removeClasses.forEach((className) => {
        removeClassName(element, className);
      });
      if (added.length > 0) {
        appliedEntries.push({ element, classes: added });
      }
    });
  });

  if (appliedEntries.length === 0) {
    return { ok: false, error: errors[0]?.error || 'APPLY_FAILED', errors };
  }

  smartScopeClassTokens.set(token, appliedEntries);
  return { ok: true, token, applied: appliedClasses, errors };
}

function handleSmartScopeRemoveToken(message = {}) {
  const token = typeof message.token === 'string' && message.token.trim() ? message.token.trim() : '';
  if (!token) {
    return { ok: false, error: 'INVALID_PAYLOAD', removed: 0 };
  }

  const entries = smartScopeClassTokens.get(token) || [];
  let removed = 0;
  entries.forEach((entry) => {
    const classes = Array.isArray(entry?.classes) ? entry.classes : [];
    classes.forEach((className) => {
      if (removeClassName(entry.element, className)) {
        removed += 1;
      }
    });
  });
  smartScopeClassTokens.delete(token);

  return { ok: true, removed };
}

function handlePageSignalsCollect(message = {}) {
  const adapter = globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  const collector = adapter?.collectPageSignalsV1;
  if (typeof collector !== 'function') {
    return { ok: false, error: 'PAGE_SIGNALS_ADAPTER_UNAVAILABLE' };
  }

  try {
    const signals = collector({
      doc: document,
      frameId: typeof message.frameId === 'number' ? message.frameId : 0,
      budgetMs: typeof message.budgetMs === 'number' ? message.budgetMs : undefined,
      maxBlocks: typeof message.maxBlocks === 'number' ? message.maxBlocks : undefined,
      maxNodes: typeof message.maxNodes === 'number' ? message.maxNodes : undefined,
      maxCandidatesSeen: typeof message.maxCandidatesSeen === 'number' ? message.maxCandidatesSeen : undefined,
    });
    return { ok: true, signals };
  } catch (error) {
    return { ok: false, error: 'PAGE_SIGNALS_COLLECT_FAILED', detail: error?.message || 'unknown' };
  }
}

const PAGE_CLARITY_TARGET_ATTR = 'data-aura-page-clarity';
const pageClarityMarkedTargets = new Set();
const pageClarityEffectBaselines = new WeakMap();

function normalizeRegionTargetRequest(message = {}) {
  return {
    schemaVersion: 1,
    frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
    collectionEpoch: typeof message.collectionEpoch === 'string' ? message.collectionEpoch : '',
    routeEpoch: typeof message.routeEpoch === 'string' ? message.routeEpoch : '',
    sourceBlockId: typeof message.sourceBlockId === 'string' ? message.sourceBlockId : undefined,
    regionId: typeof message.regionId === 'string' ? message.regionId : undefined,
    expectedTargetKind: typeof message.expectedTargetKind === 'string' ? message.expectedTargetKind : '',
  };
}

function handleRegionTargetValidate(message = {}) {
  const adapter = globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  const validator = adapter?.validateRegionTargetV1;
  if (typeof validator !== 'function') {
    return { ok: false, error: 'REGION_TARGET_REGISTRY_UNAVAILABLE' };
  }

  try {
    return validator(normalizeRegionTargetRequest(message), { doc: document });
  } catch (error) {
    return { ok: false, error: 'REGION_TARGET_VALIDATE_FAILED', detail: error?.message || 'unknown' };
  }
}

function handlePageClarityMarkTarget(message = {}) {
  const adapter = globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  const validator = adapter?.validateRegionTargetV1;
  const getTarget = adapter?.getRegionTargetElementV1;
  if (typeof validator !== 'function' || typeof getTarget !== 'function') {
    return { ok: false, reason: 'REGION_TARGET_REGISTRY_UNAVAILABLE' };
  }

  try {
    const request = normalizeRegionTargetRequest(message);
    const validation = validator(request, { doc: document });
    if (validation?.ok !== true) {
      return validation;
    }

    const target = getTarget(request, { doc: document });
    if (!target || typeof target.setAttribute !== 'function') {
      return { ...validation, ok: false, reason: 'TARGET_NOT_FOUND' };
    }

    target.setAttribute(PAGE_CLARITY_TARGET_ATTR, '1');
    pageClarityMarkedTargets.add(target);
    return {
      ...validation,
      ok: true,
      reason: 'OK',
      marked: true,
      markedCount: pageClarityMarkedTargets.size,
    };
  } catch (error) {
    return { ok: false, reason: 'PAGE_CLARITY_MARK_FAILED', detail: error?.message || 'unknown' };
  }
}

function isTransparentColor(value) {
  if (typeof value !== 'string') {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return !normalized
    || normalized === 'transparent'
    || normalized === 'rgba(0, 0, 0, 0)'
    || normalized === 'rgba(0,0,0,0)';
}

function normalizeCssValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function computedOutlineWidth(style) {
  const raw = style?.outlineWidth || '';
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedOutlineWidth(styleSnapshot) {
  const raw = styleSnapshot?.outlineWidth || '';
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function snapshotPageClarityStyle(element) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return null;
  }

  try {
    const style = window.getComputedStyle(element);
    return {
      textDecorationLine: normalizeCssValue(style.textDecorationLine),
      textDecorationColor: normalizeCssValue(style.textDecorationColor),
      textDecorationThickness: normalizeCssValue(style.textDecorationThickness),
      textUnderlineOffset: normalizeCssValue(style.textUnderlineOffset),
      color: normalizeCssValue(style.color),
      backgroundColor: normalizeCssValue(style.backgroundColor),
      outlineColor: normalizeCssValue(style.outlineColor),
      outlineStyle: normalizeCssValue(style.outlineStyle),
      outlineWidth: normalizeCssValue(style.outlineWidth),
      caretColor: normalizeCssValue(style.caretColor),
      accentColor: normalizeCssValue(style.accentColor),
      boxShadow: normalizeCssValue(style.boxShadow),
    };
  } catch (_) {
    return null;
  }
}

function targetMatchesSelector(target, selector) {
  try {
    return typeof target?.matches === 'function' && target.matches(selector);
  } catch (_) {
    return false;
  }
}

function pageClarityProbeSelector(expectedTargetKind) {
  if (expectedTargetKind === 'RECORD_REGION') {
    return 'a[href], [role="link"]';
  }
  if (expectedTargetKind === 'FORM_REGION') {
    return 'label, legend, [aria-label], input, select, textarea';
  }
  return 'a[href], [role="link"], label, legend, [aria-label], input, select, textarea, button, [role="checkbox"], [role="radio"]';
}

function collectPageClarityProbeElements(target, expectedTargetKind) {
  const selector = pageClarityProbeSelector(expectedTargetKind);
  const elements = [];

  if (targetMatchesSelector(target, selector)) {
    elements.push(target);
  }

  try {
    if (typeof target?.querySelectorAll === 'function') {
      elements.push(...Array.from(target.querySelectorAll(selector)));
    }
  } catch (_) {
    // A malformed page-local selector environment should not crash the probe.
  }

  return elements.slice(0, 80);
}

function createPageClarityBaselineEntry(target, expectedTargetKind) {
  const elements = collectPageClarityProbeElements(target, expectedTargetKind)
    .map((element) => ({ element, before: snapshotPageClarityStyle(element) }))
    .filter((entry) => entry.before);
  const targetStyle = snapshotPageClarityStyle(target);
  return {
    expectedTargetKind,
    collectedAt: Date.now(),
    targetStyle,
    elements,
  };
}

function styleChanged(before, after, keys) {
  if (!before || !after) return false;
  return keys.some((key) => before[key] !== after[key]);
}

function hasVisibleAfterValue(after, keys) {
  if (!after) return false;
  return keys.some((key) => {
    const value = after[key];
    if (!value || value === 'auto' || value === 'none' || value === 'normal') {
      return false;
    }
    if (key === 'backgroundColor' || key === 'caretColor') {
      return !isTransparentColor(value);
    }
    if (key === 'outlineWidth') {
      return normalizedOutlineWidth(after) > 0;
    }
    return true;
  });
}

function elementHasPageClarityDelta(entry, expectedTargetKind) {
  const after = snapshotPageClarityStyle(entry?.element);
  if (!entry?.before || !after) return false;

  if (expectedTargetKind === 'RECORD_REGION') {
    const keys = [
      'textDecorationLine',
      'textDecorationColor',
      'textDecorationThickness',
      'textUnderlineOffset',
      'backgroundColor',
      'color',
      'outlineColor',
      'outlineStyle',
      'outlineWidth',
    ];
    return styleChanged(entry.before, after, keys)
      && hasVisibleAfterValue(after, ['textDecorationLine', 'textDecorationColor', 'backgroundColor', 'color', 'outlineWidth']);
  }

  if (expectedTargetKind === 'FORM_REGION') {
    const keys = [
      'textDecorationLine',
      'textDecorationColor',
      'textDecorationThickness',
      'textUnderlineOffset',
      'backgroundColor',
      'color',
      'outlineColor',
      'outlineStyle',
      'outlineWidth',
      'caretColor',
      'accentColor',
    ];
    return styleChanged(entry.before, after, keys)
      && hasVisibleAfterValue(after, ['textDecorationLine', 'textDecorationColor', 'backgroundColor', 'outlineWidth', 'caretColor', 'accentColor']);
  }

  const keys = ['backgroundColor', 'outlineColor', 'outlineStyle', 'outlineWidth', 'caretColor', 'accentColor'];
  return styleChanged(entry.before, after, keys)
    && hasVisibleAfterValue(after, ['backgroundColor', 'outlineWidth', 'caretColor', 'accentColor']);
}

function targetHasPageClarityRegionDelta(baseline) {
  const after = snapshotPageClarityStyle(baseline?.target);
  if (!baseline?.targetStyle || !after) return false;
  return styleChanged(baseline.targetStyle, after, ['backgroundColor', 'boxShadow', 'outlineColor', 'outlineStyle', 'outlineWidth'])
    && hasVisibleAfterValue(after, ['backgroundColor', 'boxShadow', 'outlineWidth']);
}

function handlePageClarityEffectBaseline(message = {}) {
  const expectedTargetKind = typeof message.expectedTargetKind === 'string' ? message.expectedTargetKind : '';
  const markedTargets = Array.from(pageClarityMarkedTargets).filter((target) => {
    try {
      return target?.isConnected !== false && typeof target?.getAttribute === 'function';
    } catch (_) {
      return false;
    }
  });

  if (markedTargets.length === 0) {
    return {
      ok: false,
      reason: 'NO_MARKED_TARGET',
      frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
      markedTargets: 0,
      baselineElements: 0,
    };
  }

  let baselineElements = 0;
  for (const target of markedTargets) {
    const baseline = createPageClarityBaselineEntry(target, expectedTargetKind);
    baseline.target = target;
    pageClarityEffectBaselines.set(target, baseline);
    baselineElements += baseline.elements.length;
  }

  return {
    ok: baselineElements > 0,
    reason: baselineElements > 0 ? 'OK' : 'NO_MATCHED_ELEMENTS',
    frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
    markedTargets: markedTargets.length,
    baselineElements,
  };
}

function handlePageClarityEffectProbe(message = {}) {
  const expectedTargetKind = typeof message.expectedTargetKind === 'string' ? message.expectedTargetKind : '';
  const markedTargets = Array.from(pageClarityMarkedTargets).filter((target) => {
    try {
      return target?.isConnected !== false && typeof target?.getAttribute === 'function';
    } catch (_) {
      return false;
    }
  });

  if (markedTargets.length === 0) {
    return {
      ok: false,
      reason: 'NO_MARKED_TARGET',
      frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
      markedTargets: 0,
      matchedLinks: 0,
      matchedLabels: 0,
      matchedInputs: 0,
      changedElements: 0,
      visibleEffectScore: 0,
    };
  }

  let matchedLinks = 0;
  let matchedLabels = 0;
  let matchedInputs = 0;
  let changedElements = 0;
  let inspectedElements = 0;
  let targetsWithRegionDelta = 0;
  let targetsWithBaseline = 0;

  for (const target of markedTargets) {
    const baseline = pageClarityEffectBaselines.get(target);
    if (!baseline || !Array.isArray(baseline.elements)) {
      continue;
    }
    targetsWithBaseline += 1;
    if (targetHasPageClarityRegionDelta(baseline)) {
      targetsWithRegionDelta += 1;
    }
    for (const entry of baseline.elements) {
      const element = entry.element;
      inspectedElements += 1;
      if (targetMatchesSelector(element, 'a[href], [role="link"]')) {
        matchedLinks += 1;
      }
      if (targetMatchesSelector(element, 'label, legend, [aria-label]')) {
        matchedLabels += 1;
      }
      if (targetMatchesSelector(element, 'input, select, textarea, button, [role="checkbox"], [role="radio"]')) {
        matchedInputs += 1;
      }
      if (elementHasPageClarityDelta(entry, baseline.expectedTargetKind || expectedTargetKind)) {
        changedElements += 1;
      }
    }
  }

  if (targetsWithBaseline === 0) {
    return {
      ok: false,
      reason: 'NO_BASELINE',
      frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
      markedTargets: markedTargets.length,
      matchedLinks,
      matchedLabels,
      matchedInputs,
      changedElements,
      visibleEffectScore: 0,
    };
  }

  if (inspectedElements === 0) {
    return {
      ok: false,
      reason: 'NO_MATCHED_ELEMENTS',
      frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
      markedTargets: markedTargets.length,
      matchedLinks,
      matchedLabels,
      matchedInputs,
      changedElements,
      visibleEffectScore: 0,
    };
  }

  const visibleEffectScore = Math.min(1, changedElements / Math.max(1, inspectedElements));
  const minimumScore = expectedTargetKind === 'FORM_REGION' ? 0.5 : 0.5;
  const ok = changedElements > 0 && visibleEffectScore >= minimumScore;
  return {
    ok,
    reason: ok ? 'OK' : (changedElements > 0 ? 'WEAK_EFFECT' : 'STYLE_UNCHANGED'),
    frameId: typeof message.frameId === 'number' ? message.frameId : undefined,
    markedTargets: markedTargets.length,
    matchedLinks,
    matchedLabels,
    matchedInputs,
    changedElements,
    inspectedElements,
    targetsWithRegionDelta,
    visibleEffectScore,
  };
}

function handlePageClarityClearTargets() {
  let removedCount = 0;
  for (const target of pageClarityMarkedTargets) {
    try {
      if (target && typeof target.removeAttribute === 'function') {
        target.removeAttribute(PAGE_CLARITY_TARGET_ATTR);
        pageClarityEffectBaselines.delete(target);
        removedCount += 1;
      }
    } catch (_) {
      // best-effort cleanup; restore must continue even if a stale element throws.
    }
  }
  pageClarityMarkedTargets.clear();
  return { ok: true, removedCount };
}

// ========== SECTION 11: MESSAGE LISTENER ==========
async function handleSmartScopeGetProfileRoute(message) {
  const budgetMs = typeof message.budgetMs === 'number' ? message.budgetMs : SMARTSCOPE_TIMEOUT_MS;
  const level = message.level || 'conservative';
  const allowed = await ensureSitePolicyAllowed({ context: 'smartscope-profile' });
  if (!allowed) {
    return { ok: false, error: 'SITE_POLICY_BLOCKED' };
  }

  const { root, profile } = await selectScopeRoot(document, level, budgetMs);
  return {
    ok: true,
    profile: {
      ...profile,
      scopeSelector: root ? buildScopeSelectorHint(root) : '',
    },
  };
}

function handleSmartScopeVerifyComputedStylesRoute(message) {
  return evaluateComputedStyles(message.checks || []);
}

async function handleModeEngineApplyScopeTokensRoute(message) {
  const requestedTokenMap = message.tokenMap || {};
  const ownerKey = message.ownerKey || MODE_ENGINE_SCOPE_OWNER;
  const darkRequested = isDarkFromTokenMap(requestedTokenMap);
  let darkEnabled = message.darkThemeExecutorActive === true && darkRequested;
  const darkRuntime = await loadDarkComfortThemeRuntimeModule();
  let preparedManifest = null;

  if (darkEnabled && typeof darkRuntime?.prepareDarkComfortThemeRuntime === 'function') {
    const prepared = darkRuntime.prepareDarkComfortThemeRuntime({
      scopeRoot: getStoredScopeRoot(),
      tokenMap: requestedTokenMap,
      ownerKey,
      source: 'pre-token-apply',
    });
    preparedManifest = prepared?.manifest || null;
  } else if (darkEnabled) {
    darkEnabled = false;
  }

  const tokenMap = sanitizeDarkComfortThemeTokens(requestedTokenMap, darkEnabled);
  const result = await applyScopeTokensToStoredRoot(tokenMap, ownerKey, {
    transitionMs: message?.transitionMs,
  });
  const scopeRoot = getStoredScopeRoot();

  if (result?.ok) {
    const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
    applyFocusSubmodes({
      flags,
      scopeRoot,
      ...(message?.modeId === (MODE_IDS.FOCUS || 'focus') ? { isFocusActive: false } : {}),
    }).catch((error) => {
      modeEngineDebugLog('Focus runtime scope apply failed', error);
    });

    let darkResult = null;
    try {
      if (typeof darkRuntime?.applyDarkComfortThemeRuntime === 'function') {
        darkResult = darkRuntime.applyDarkComfortThemeRuntime({
          scopeRoot,
          tokenMap,
          ownerKey,
          executorActive: darkEnabled,
          preparedManifest,
          postCheckBaseline: message.postCheckBaseline,
          source: 'apply',
          logger: modeEngineDebugLog,
          modeActive: () => getModeActive(MODE_IDS.COMFORT_VISUAL) !== false,
          callbacks: {
            fixUnreadableHeadings,
          },
        });
      }
    } catch (error) {
      modeEngineDebugLog('Dark surface apply failed', error);
    }

    if (darkEnabled && darkResult?.ok === false) {
      const darkFailureDetail = Array.isArray(darkResult?.postCheck?.failures)
        && darkResult.postCheck.failures.length > 0
          ? darkResult.postCheck.failures.join(',')
          : null;
      const postCheckRatios = darkResult?.postCheck
        ? [
            ['textContrast', darkResult.postCheck.textContrast],
            ['linkContrast', darkResult.postCheck.linkContrast],
            ['linkDistinct', darkResult.postCheck.linkDistinct],
            ['focusRingContrast', darkResult.postCheck.focusRingContrast],
          ]
            .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
            .map(([key, value]) => `${key}=${value.toFixed(2)}`)
            .join(';')
        : '';
      const darkDetail = [darkResult.detail || darkFailureDetail || darkResult.reason || null, postCheckRatios]
        .filter(Boolean)
        .join('|');
      return {
        ...result,
        ok: false,
        error: 'DARK_COMFORT_THEME_ROLLED_BACK',
        reason: darkResult.reason || 'DARK_COMFORT_THEME_POSTCHECK_FAILED',
        detail: darkDetail || null,
        darkComfortTheme: {
          active: darkResult.active === true,
          rolledBack: darkResult.rolledBack === true || darkResult.active === false,
          reason: darkResult.reason || null,
          failures: darkFailureDetail || null,
          postCheck: darkResult.postCheck || null,
        },
      };
    }
  }

  return result;
}

async function handleModeEngineCleanupScopeTokensRoute(message) {
  clearHeadingFixes();
  if (message?.smoothTransitions === true || message?.preserveScope === true) {
    const scopeRoot = getStoredScopeRoot();
    if (scopeRoot) {
      armModeEngineAnim(scopeRoot, message?.transitionMs);
    }
  }

  const result = await cleanupScopeTokensFromStoredRoot(
    message.ownerKey || MODE_ENGINE_SCOPE_OWNER,
    {
      ...(message?.preserveScope ? { preserveScope: true } : {}),
      ...(Array.isArray(message?.ownedKeys) ? { ownedKeys: message.ownedKeys } : {}),
    },
  );
  const scopeRoot = getStoredScopeRoot();
  if (result?.ok) {
    const flags = typeof getAllModeEngineFlags === 'function' ? getAllModeEngineFlags() : null;
    applyFocusSubmodes({ flags, scopeRoot }).catch((error) => {
      modeEngineDebugLog('Focus runtime scope cleanup failed', error);
    });
  }

  try {
    const darkRuntime = await loadDarkComfortThemeRuntimeModule();
    if (typeof darkRuntime?.cleanupDarkComfortThemeRuntime === 'function') {
      darkRuntime.cleanupDarkComfortThemeRuntime({
        scopeRoot,
        source: 'cleanup',
        tokensAlreadyRemoved: true,
        logger: modeEngineDebugLog,
        callbacks: {
          clearHeadingFixes,
        },
      });
    }
  } catch (error) {
    modeEngineDebugLog('Dark surface cleanup failed', error);
  }

  return result;
}

function handleModeEngineSetScopeRootRoute(message) {
  return handleModeEngineV2SetScopeRoot(message?.selector);
}

function handleModeEngineVerifyScopeRootRoute(message) {
  return handleModeEngineV2VerifyScopeRoot(message?.selector);
}

function handleModeEngineSalvageScopeRootRoute(message) {
  return handleModeEngineV2SalvageScopeRoot(message?.selector, message?.debugEnabled);
}

function handleModeEngineMeasureContrastRoute(message) {
  try {
    const sampleLimit = typeof message.sampleLimit === 'number' ? message.sampleLimit : CONTRAST_SAMPLE_LIMIT;
    return measureScopeContrast(sampleLimit);
  } catch (error) {
    return {
      ok: false,
      reason: 'contrast-check-failed',
      detail: error?.message || 'measureScopeContrast failed',
    };
  }
}

async function handleShowBannerRoute(message) {
  if (typeof message.modeId !== 'string' || !Object.values(MODE_IDS).includes(message.modeId)) {
    return { ok: false, received: false, error: 'INVALID_MODE_ID' };
  }
  if (isAnyModeActive()) {
    hideSuggestionBannerIfPresent();
    return { ok: true, suppressed: true, reason: 'mode-active' };
  }

  const allowed = await ensureSitePolicyAllowed({ context: 'show-banner' });
  if (!allowed) {
    return { ok: false, received: false, suppressed: true, error: 'SITE_POLICY_DENIED' };
  }

  if (!activeBanner) {
    activeBanner = new SuggestionBanner();
  }
  activeBanner.show({
    modeId: message.modeId,
    score: typeof message.score === 'number' ? message.score : message.confidence,
    position: message.position || BANNER_POSITION.TOP_RIGHT,
  });
  return { ok: true, received: true };
}

function handleTestInjectSuggestionBannerRoute(message) {
  return handleTestInjectSuggestionBanner(message.modeId, message.confidence, message.signals);
}

function handleInjectRestoreButtonRoute(message) {
  if (typeof message.modeId !== 'string' || !Object.values(MODE_IDS).includes(message.modeId)) {
    return { ok: false, injected: false, error: 'INVALID_MODE_ID' };
  }
  ensureRestoreButtonConstructor();
  if (typeof AURA?.RestoreButton !== 'function') {
    console.error('[CS] RestoreButton missing or not constructible');
    return { ok: false, injected: false, error: 'RESTORE_BUTTON_INVALID' };
  }
  setModeActive(message.modeId, true);
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
  return { ok: true, injected: true };
}

function handleRemoveRestoreButtonRoute(message) {
  if (activeRestoreButton) {
    activeRestoreButton.remove();
    activeRestoreButton = null;
  } else {
    const existingButton = findOwnedAuraUiHost(RESTORE_BUTTON_OWNER);
    if (existingButton?.parentNode) {
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
  return { ok: true, removed: true };
}

function handlePrefsUpdatedRoute(message) {
  setRuntimePrefs(message?.prefs || {});
  applyFocusRuntime(message?.prefs).catch((error) => {
    modeEngineDebugLog('Focus runtime prefs update failed', error);
  });
  return { received: true };
}

function handleModeEngineApplyResultRoute(message) {
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
  return { received: true };
}

function mapContentRouteError(action, error) {
  switch (action) {
    case SMARTSCOPE_ACTIONS.GET_PROFILE:
      return { ok: false, error: 'SMARTSCOPE_FAILED' };
    case ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS:
      return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: error?.message || 'applyScopeTokens failed' };
    case ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS:
      return { ok: false, error: 'TOKEN_APPLY_FAILED', detail: error?.message || 'cleanupScopeTokens failed' };
    case ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT:
      return { ok: false, error: 'SET_SCOPE_ROOT_FAILED', detail: error?.message || 'setScopeRoot failed' };
    case ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT:
      return {
        ok: false,
        error: 'VERIFY_SCOPE_ROOT_FAILED',
        detail: error?.message || 'verifyScopeRoot failed',
        source: 'verifyScopeRoot',
      };
    case ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT:
      return {
        ok: false,
        error: 'SALVAGE_SCOPE_ROOT_FAILED',
        detail: error?.message || 'salvageScopeRoot failed',
        source: 'salvageScopeRoot',
      };
    case ACTIONS.SHOW_BANNER:
      return { ok: false, received: false, suppressed: true, error: 'SHOW_BANNER_FAILED' };
    default:
      return { ok: false, error: 'CONTENT_ROUTE_HANDLER_FAILED' };
  }
}

const CONTENT_ROUTE_HANDLERS_V1 = Object.freeze({
  [SMARTSCOPE_ACTIONS.APPLY_CLASSES]: handleSmartScopeApplyClasses,
  [SMARTSCOPE_ACTIONS.REMOVE_TOKEN]: handleSmartScopeRemoveToken,
  [ACTIONS.PAGE_SIGNALS_COLLECT_V1]: handlePageSignalsCollect,
  [ACTIONS.REGION_TARGET_VALIDATE_V1]: handleRegionTargetValidate,
  [ACTIONS.PAGE_CLARITY_MARK_TARGET_V1]: handlePageClarityMarkTarget,
  [ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1]: handlePageClarityEffectBaseline,
  [ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1]: handlePageClarityEffectProbe,
  [ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1]: handlePageClarityClearTargets,
  [SMARTSCOPE_ACTIONS.GET_PROFILE]: handleSmartScopeGetProfileRoute,
  [ACTIONS.SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1]: handleSmartScopeVerifyComputedStylesRoute,
  [ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS]: handleModeEngineApplyScopeTokensRoute,
  [ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS]: handleModeEngineCleanupScopeTokensRoute,
  [ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT]: handleModeEngineSetScopeRootRoute,
  [ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT]: handleModeEngineVerifyScopeRootRoute,
  [ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT]: handleModeEngineSalvageScopeRootRoute,
  [ACTIONS.MODE_ENGINE_V2_MEASURE_CONTRAST]: handleModeEngineMeasureContrastRoute,
  [ACTIONS.SHOW_BANNER]: handleShowBannerRoute,
  [ACTIONS.TEST_PING_CONTENT]: handleTestPing,
  [ACTIONS.TEST_INJECT_SUGGESTION_BANNER]: handleTestInjectSuggestionBannerRoute,
  [ACTIONS.TEST_CLEAR_SUGGESTION_BANNER]: handleTestClearSuggestionBanner,
  [ACTIONS.INJECT_RESTORE_BUTTON]: handleInjectRestoreButtonRoute,
  [ACTIONS.REMOVE_RESTORE_BUTTON]: handleRemoveRestoreButtonRoute,
  [ACTIONS.PREFS_UPDATED]: handlePrefsUpdatedRoute,
  [ACTIONS.MODE_ENGINE_V2_APPLY_RESULT]: handleModeEngineApplyResultRoute,
});

try {
  runtimeMessageListener = contentMessageRouterApi.createListener({
    routes: CONTENT_MESSAGE_ROUTES_V1,
    handlers: CONTENT_ROUTE_HANDLERS_V1,
    documentContextAction: DOCUMENT_CONTEXT_ACTION,
    diagnosticPingType: TEST_PING_ACTION,
    diagnosticPongType: TEST_PONG_ACTION,
    isTopFrame: isTopFrameDocument,
    isTestHooksEnabled: () => debugTestHooksEnabled,
    isInvalidated: () => AURA_CONTEXT_INVALIDATED,
    getDocumentInstanceId: () => DOCUMENT_INSTANCE_ID,
    mapError: mapContentRouteError,
  });
  if (typeof runtimeMessageListener !== 'function') {
    throw new Error('CONTENT_MESSAGE_ROUTER_LISTENER_INVALID');
  }
} catch (error) {
  const reason = typeof error?.message === 'string' && error.message.startsWith('CONTENT_MESSAGE_ROUTER_')
    ? error.message
    : 'CONTENT_MESSAGE_ROUTER_ACTIVATION_FAILED';
  console.error('[CS] Content message router activation failed', error);
  markBootstrapAborted(reason);
  AURA_CONTENT_BOOTSTRAP_STATE.invalidate(AURA_CONTENT_LOAD_STATE.generation, reason);
  return;
}

window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__ = runtimeMessageListener;
chrome.runtime.onMessage.addListener(runtimeMessageListener);
if (!AURA_CONTENT_BOOTSTRAP_STATE.markReady(
  AURA_CONTENT_LOAD_STATE.generation,
  runtimeMessageListener,
)) {
  chrome.runtime.onMessage.removeListener(runtimeMessageListener);
  if (window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__ === runtimeMessageListener) {
    delete window.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__;
  }
  return;
}

console.log('[CS] AURA content script loaded');
})();
