import {
  ACTIONS,
  FOCUS_CSS_TEMPLATE_PATH,
  FOCUS_SCOPE_PLACEHOLDER,
  MODE_IDS,
  SMARTSCOPE_ACTIONS,
  SMARTSCOPE_LEVELS,
  STATES,
  MODE_ENGINE_SMOOTH_TRANSITION_MS,
  STORAGE_KEYS,
} from '../shared/constants.js';
import { extractDomain, getFromLocal, isValidTabId, setToLocal } from '../shared/utils.js';
import { isFlagEnabled } from '../shared/feature-flags.js';
import { normalizeComfortVisualPrefs } from '../shared/comfort-visual-prefs.js';
import {
  MODE_ENGINE_SCOPE_SELECTOR,
  buildScopedModeCssV2,
  computeTokensV2,
  computeAppliedHash,
  SCOPE_OWNER_VALUE,
  makeScopedV2Key,
  ANIM_ATTR,
  ANIM_ATTR_VALUE,
} from '../shared/mode-engine-scoped-v2.js';
import { cssRegistry } from './css-registry.js';
import { stateManager } from './state-manager.js';
import { performanceMonitor } from './degraded-manager.js';
import { smartScopeDebugger } from './smartscope-debugger.js';
import { insertModeCssRaw, insertModeCssSafely, removeModeCssRaw } from './mode-engine-css.js';
import { recordModeEngineMetric, modeEngineLog } from '../shared/mode-engine-debug.js';
import { getTabRuntime, patchTabRuntime } from './runtime-state.js';
import { computeSitePolicy, isStructuralFailureReason, recordApplyOutcome } from './site-policy-manager.js';
import { contentBridge } from './content-bridge.js';
import {
  isTrivialScope,
  materializeScopedCss as materializeScopedCssImpl,
  validateScopedCss as validateScopedCssImpl,
} from './css-guardrails.js';

const CSS_COMFORT_VISUAL = `
  [data-aura-scope="1"] {
    --aura-intensity: 1.0;
    --aura-me2-css: 1;
    --aura-font-size: calc(16px * var(--aura-intensity) * 1.1);
    --aura-line-height: calc(1.6 * var(--aura-intensity));
    --aura-letter-spacing: calc(0.35px * var(--aura-intensity));
    --aura-paragraph-spacing: calc(0.9em * var(--aura-intensity));
    --aura-measure: 70ch;
    font-size: var(--aura-font-size);
    line-height: var(--aura-line-height);
    letter-spacing: var(--aura-letter-spacing);
  }
  [data-aura-scope="1"] :is(main, article, [role="main"]) {
    max-inline-size: min(var(--aura-measure), 100%);
    width: min(100%, var(--aura-measure));
    margin-inline: auto;
  }
  [data-aura-scope="1"] :is(p, li, blockquote, pre, code) {
    max-inline-size: min(var(--aura-measure), 100%);
    width: min(100%, var(--aura-measure));
    margin-inline: auto;
    font-size: var(--aura-font-size);
    line-height: var(--aura-line-height);
    letter-spacing: var(--aura-letter-spacing);
  }
  [data-aura-scope="1"] :is(p, blockquote) {
    margin-block: var(--aura-paragraph-spacing);
  }
  [data-aura-scope="1"] :is(img, video, picture, figure) {
    max-inline-size: 100%;
    height: auto;
  }
`;

const CSS_ORIGIN = 'AUTHOR';

const STRICT_VARIANT = 'STRICT';
const SMARTSCOPE_TIMEOUT_MS = 60;
const SCOPED_MODE_OWNER_KEY = SCOPE_OWNER_VALUE;
const CONTRAST_GUARD_THRESHOLD = 4.5;
const COMFORT_DARK_TOKENS = Object.freeze({
  '--aura-color-scheme': 'dark',
  '--aura-bg-color': '#0b1020',
  '--aura-text-color': '#e6e6e6',
  '--aura-muted-text-color': '#a8b0bf',
  '--aura-border-color': 'rgba(255,255,255,0.12)',
  '--aura-surface-1': '#101a2f',
  '--aura-surface-2': '#0d1526',
  '--aura-link-color': '#8ab4ff',
  '--aura-link-visited-color': '#c58af9',
  '--aura-link-hover-color': '#b1ccff',
});
const COMFORT_DARK_GUARD_TOKENS = Object.freeze({
  '--aura-text-color': '#f4f7ff',
  '--aura-bg-color': '#0b0d12',
  '--aura-link-color': '#b7caff',
});
const COMFORT_LIGHT_GUARD_TOKENS = Object.freeze({
  '--aura-text-color': '#0f172a',
  '--aura-bg-color': '#ffffff',
  '--aura-link-color': '#1d4ed8',
});
const COMFORT_DARK_RETRY_TOKENS = Object.freeze({
  '--aura-text-color': '#ffffff',
  '--aura-bg-color': '#07080d',
  '--aura-surface-1': '#0a0f1c',
  '--aura-surface-2': '#0b1220',
  '--aura-muted-text-color': '#cbd5f5',
  '--aura-link-color': '#c5d7ff',
});
const COMFORT_LIGHT_RETRY_TOKENS = Object.freeze({
  '--aura-text-color': '#0b0f19',
  '--aura-bg-color': '#ffffff',
  '--aura-surface-1': '#ffffff',
  '--aura-surface-2': '#f8fafc',
  '--aura-muted-text-color': '#475569',
  '--aura-link-color': '#1e40af',
});
const APPLY_FAILURE_REASONS = {
  EXT_CONTEXT_INVALID: 'EXT_CONTEXT_INVALID',
  NO_SCOPE: 'NO_SCOPE',
  SCOPE_ROOT_UNRESOLVED: 'SCOPE_ROOT_UNRESOLVED',
  SCOPE_REJECTED: 'SCOPE_REJECTED',
  NO_RECEIVER: 'NO_RECEIVER',
  GUARDRAILS_REJECTED: 'GUARDRAILS_REJECTED',
  INSERT_CSS_FAILED: 'INSERT_CSS_FAILED',
  TOKEN_APPLY_FAILED: 'TOKEN_APPLY_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DEGRADED: 'DEGRADED',
  REGISTRY_FAILED: 'REGISTRY_FAILED',
  SALVAGE_CRASH: 'SALVAGE_CRASH',
};
const FRAME_CONTENT_FILES = [
  'content/smartscope-v2.runtime.js',
  'content/mode-engine-scoped-v2.runtime.js',
  'content/content-main.js',
];
const SALVAGEABLE_SCOPE_REASONS = new Set([
  'ROOT_NULL',
  'ROOT_NOT_CONNECTED',
  'ROOT_TOO_LARGE',
  'ROOT_SELECTOR_NON_UNIQUE',
  'ROOT_TOO_SMALL',
  'ROOT_HIDDEN',
]);
const SCOPE_ROOT_FALLBACK_SELECTORS = ['main', 'article', '[role="main"]', '#main', '#content'];
const scopedV2State = new Map();
const inFlightApplyByTab = new Map();
const lastScopeCache = new Map();
const LAST_SCOPE_CACHE_MAX = 100;
const LAST_SCOPE_CACHE_TTL_MS = 10 * 60 * 1000;
let lastAttemptId = 0;
let focusCssTemplateCache = null;
let focusCssTemplatePromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scopedV2KeyToString(key) {
  return `${key.tabId}:${key.frameId}`;
}

function makeScopeCacheKey(tabId, modeId) {
  return `${tabId}:${modeId}`;
}

function makeUrlKey(url = '') {
  if (typeof url !== 'string' || !url.trim()) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return '';
  }
}

function getSmoothTransitionSettings(modeId, modePrefs) {
  const reduceMotionPref = modePrefs?.reduceMotion === true;
  const reduceMotionEnabled =
    modeId === MODE_IDS.FOCUS ? isFlagEnabled('focusReduceMotionV1') && reduceMotionPref : reduceMotionPref;
  const smoothTransitionsEnabled = isFlagEnabled('smoothThemeTransitionsV2') && !reduceMotionEnabled;
  const transitionMs = MODE_ENGINE_SMOOTH_TRANSITION_MS;

  return {
    reduceMotionEnabled,
    smoothTransitionsEnabled,
    transitionMs,
  };
}

function buildScopedTransitionsCssV2({ transitionMs, animAttrName = ANIM_ATTR } = {}) {
  const scope = MODE_ENGINE_SCOPE_SELECTOR;
  const resolvedAnimAttr = typeof animAttrName === 'string' && animAttrName.trim() ? animAttrName.trim() : ANIM_ATTR;
  const normalizedTransitionMs =
    typeof transitionMs === 'number' && Number.isFinite(transitionMs) && transitionMs >= 0
      ? Math.round(transitionMs)
      : 160;
  const transitionSelector = `${scope}[${resolvedAnimAttr}="${ANIM_ATTR_VALUE}"] :where(*, *::before, *::after)`;
  const transitionProperties = 'color, background-color, border-color, text-decoration-color, fill, stroke, box-shadow';
  const transitionRule =
    `${transitionSelector} { transition-property: ${transitionProperties}; transition-duration: ${normalizedTransitionMs}ms; transition-timing-function: ease; }`;
  const prefersReduceMotionRule =
    `@media (prefers-reduced-motion: reduce) { ${transitionSelector} { animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; } }`;

  return [transitionRule, prefersReduceMotionRule].filter(Boolean).join(' ');
}

function getCachedScopeEntry(cacheKey) {
  if (!lastScopeCache.has(cacheKey)) {
    return null;
  }

  const entry = lastScopeCache.get(cacheKey);
  lastScopeCache.delete(cacheKey);
  lastScopeCache.set(cacheKey, entry);
  return entry;
}

function setCachedScopeEntry(cacheKey, entry) {
  if (!entry || typeof entry.scopeSelector !== 'string' || !entry.scopeSelector.trim()) {
    return;
  }

  lastScopeCache.set(cacheKey, entry);
  if (lastScopeCache.size > LAST_SCOPE_CACHE_MAX) {
    const oldestKey = lastScopeCache.keys().next().value;
    if (oldestKey) {
      lastScopeCache.delete(oldestKey);
    }
  }
}

async function resolveUrlKey(tabId, fallbackUrl = '') {
  const fromFallback = makeUrlKey(fallbackUrl);
  if (fromFallback) {
    return fromFallback;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return makeUrlKey(tab?.url || '');
  } catch (error) {
    return '';
  }
}

export function getScopedModeV2State(tabId, frameId) {
  const key = makeScopedV2Key(tabId, frameId);
  return scopedV2State.get(scopedV2KeyToString(key)) || null;
}

export function applyScopedModeV2({
  tabId,
  frameId = 0,
  cssId,
  modeId,
  scopeSelector = MODE_ENGINE_SCOPE_SELECTOR,
  cssText = '',
  tokens = {},
} = {}) {
  const key = makeScopedV2Key(tabId, frameId);
  const hash = computeAppliedHash({ cssText, tokens, cssId, modeId });
  const keyString = scopedV2KeyToString(key);
  const previous = scopedV2State.get(keyString);

  if (previous?.lastAppliedHash === hash) {
    return { ok: true, applied: false, state: previous };
  }

  const ownedTokenKeys = Object.keys(tokens || {}).filter((name) => typeof name === 'string');
  const nextState = {
    cssId: String(cssId || ''),
    modeId: String(modeId || ''),
    scopeSelector: scopeSelector || MODE_ENGINE_SCOPE_SELECTOR,
    lastAppliedHash: hash,
    ownedTokenKeys,
    lastAppliedAtMs: Date.now(),
    cssText: cssText || '',
    owner: SCOPED_MODE_OWNER_KEY,
  };

  scopedV2State.set(keyString, nextState);
  return { ok: true, applied: true, state: nextState };
}

export async function removeScopedModeV2({
  tabId,
  frameId = 0,
  cssId,
  preserveScope = false,
  transitionMs = 0,
} = {}) {
  const key = makeScopedV2Key(tabId, frameId);
  const keyString = scopedV2KeyToString(key);
  const existing = scopedV2State.get(keyString);

  if (!existing) {
    return { ok: true, removed: false };
  }

  const ownerKey = existing.owner || SCOPED_MODE_OWNER_KEY;
  let cssRemoved = false;
  let tokensRemoved = false;
  let scopeUnmarked = false;
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
    const entry = cssLookupId ? await cssRegistry.get(cssLookupId) : null;
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
  };
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

  if (hasTransition) {
    await delay(transitionMs + 50);
  }

  if (cssText) {
    try {
      await chrome.scripting.removeCSS({ target, css: cssText, origin: cssOrigin });
      cssRemoved = true;
    } catch (error) {
      cssRemoved = false;
    }
  }

  if (cssLookupId) {
    try {
      await cssRegistry.remove(cssLookupId);
    } catch (error) {
      // ignore registry removal failures
    }
  }

  if (shouldPreserveScope) {
    const cleanupResult = await sendScopeTokenMessage(
      tabId,
      ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
      { ownerKey, preserveScope: false },
      { frameId },
    );
    updateCleanupOutcome(cleanupResult);
  }

  scopedV2State.delete(keyString);
  return {
    ok: true,
    removed: true,
    details: {
      cssRemoved,
      tokensRemoved,
      scopeUnmarked,
    },
  };
}

function normalizeLevel(level) {
  if (Object.values(SMARTSCOPE_LEVELS).includes(level)) {
    return level;
  }
  return SMARTSCOPE_LEVELS.CONSERVATIVE;
}

function normalizeIntensity(intensity) {
  if (typeof intensity !== 'number' || Number.isNaN(intensity)) {
    return 1.0;
  }
  return Math.min(Math.max(intensity, 0), 1);
}

async function getComfortVisualPrefsFromStorage() {
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
    const nextModePrefs = { ...modePrefs, [MODE_IDS.COMFORT_VISUAL]: effective };
    const nextUserPrefs = { ...userPrefs, modePrefs: nextModePrefs };
    await setToLocal(STORAGE_KEYS.USER_PREFS, nextUserPrefs);
  }

  return effective;
}

function buildComfortVisualTokenOverrides(cvPrefs) {
  const prefs = normalizeComfortVisualPrefs(cvPrefs);
  const overrides = {};

  if (prefs.linkEnhance === true) {
    overrides['--aura-link-decoration'] = 'underline';
    overrides['--aura-link-decoration-thickness'] = '0.12em';
    overrides['--aura-link-decoration-offset'] = '0.18em';
    overrides['--aura-link-underline-position'] = 'under';
  } else {
    overrides['--aura-link-decoration'] = 'none';
    overrides['--aura-link-decoration-thickness'] = '0';
    overrides['--aura-link-decoration-offset'] = '0';
    overrides['--aura-link-underline-position'] = 'auto';
  }

  if (prefs.typoSmoothing === true) {
    overrides['--aura-font-smoothing'] = 'antialiased';
  } else {
    overrides['--aura-font-smoothing'] = 'auto';
  }

  if (prefs.reflowGuard === true) {
    overrides['--aura-overflow-wrap'] = 'anywhere';
    overrides['--aura-hyphens'] = 'auto';
    overrides['--aura-word-break'] = 'normal';
  } else {
    overrides['--aura-overflow-wrap'] = 'normal';
    overrides['--aura-hyphens'] = 'manual';
    overrides['--aura-word-break'] = 'normal';
  }

  if (prefs.darkMode === true) {
    Object.assign(overrides, COMFORT_DARK_TOKENS);
  }

  return overrides;
}

async function getComfortContrastGuardOverrides({ tabId, modePrefs, comfortPrefs, frameId }) {
  if (modePrefs?.contrastGuard !== true) {
    return null;
  }

  const response = await sendScopeTokenMessage(
    tabId,
    ACTIONS.MODE_ENGINE_V2_MEASURE_CONTRAST,
    {
      sampleLimit: 6,
    },
    { frameId },
  );
  if (!response?.ok || typeof response.minRatio !== 'number') {
    return null;
  }

  if (response.minRatio >= CONTRAST_GUARD_THRESHOLD) {
    return null;
  }

  if (comfortPrefs?.darkMode === true || modePrefs?.darkMode === true) {
    return { ...COMFORT_DARK_GUARD_TOKENS };
  }

  return { ...COMFORT_LIGHT_GUARD_TOKENS };
}

async function resolveSitePolicy(tabId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return {
      policy: {
        allowed: false,
        reason: 'TAB_LOOKUP_FAILED',
        blockedUntil: null,
        overrideUntil: null,
        host: null,
      },
      url: null,
    };
  }

  const url = tab?.url || null;
  if (!url) {
    return {
      policy: {
        allowed: false,
        reason: 'TAB_URL_MISSING',
        blockedUntil: null,
        overrideUntil: null,
        host: null,
      },
      url: null,
    };
  }

  const policy = await computeSitePolicy({ url, now: Date.now() });
  return { policy, url };
}

function buildSiteBlockedResult(policy) {
  return {
    ok: false,
    error: 'SITE_BLOCKED',
    detail: policy?.reason || 'POLICY_BLOCKED',
    blockedUntil: policy?.blockedUntil ?? null,
  };
}

function recordV2Metric(name, value, tags = {}) {
  recordModeEngineMetric(`modeengine.v2.${name}`, value, tags);
}

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

function isNoReceiverError(error) {
  const message = `${error?.message || error || ''}`;
  return message.includes('Receiving end does not exist');
}

async function sendPingMessage(tabId, frameId) {
  return new Promise((resolve, reject) => {
    const callback = (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    };

    if (typeof frameId === 'number') {
      chrome.tabs.sendMessage(tabId, { action: ACTIONS.TEST_PING_CONTENT }, { frameId }, callback);
      return;
    }

    chrome.tabs.sendMessage(tabId, { action: ACTIONS.TEST_PING_CONTENT }, callback);
  });
}

async function ensureContentInFrame(tabId, frameId) {
  if (!isValidTabId(tabId) || typeof frameId !== 'number') {
    return { ok: false, error: 'invalid-target' };
  }

  try {
    const response = await sendPingMessage(tabId, frameId);
    if (response?.ok === true) {
      return { ok: true, injected: false };
    }
  } catch (error) {
    if (!isNoReceiverError(error)) {
      return { ok: false, error: formatDetail(error?.message, 'PING_FAILED') };
    }
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: FRAME_CONTENT_FILES,
    });
  } catch (error) {
    return { ok: false, error: formatDetail(error?.message, 'INJECT_FAILED') };
  }

  try {
    const response = await sendPingMessage(tabId, frameId);
    if (response?.ok === true) {
      return { ok: true, injected: true };
    }
  } catch (error) {
    if (!isNoReceiverError(error)) {
      return { ok: false, error: formatDetail(error?.message, 'PING_FAILED') };
    }
  }

  return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER };
}

function classifyApplyFailureForPolicy(result) {
  if (!result || result.ok !== false) {
    return null;
  }

  const reason = typeof result.reason === 'string' ? result.reason : null;
  const error = typeof result.error === 'string' ? result.error : null;
  const candidate = reason || error || null;

  if (!candidate) {
    return null;
  }

  return isStructuralFailureReason(candidate) ? candidate : null;
}

async function loadFocusCssTemplate() {
  if (focusCssTemplateCache) {
    return focusCssTemplateCache;
  }

  if (focusCssTemplatePromise) {
    return focusCssTemplatePromise;
  }

  focusCssTemplatePromise = (async () => {
    const url = chrome?.runtime?.getURL ? chrome.runtime.getURL(FOCUS_CSS_TEMPLATE_PATH) : null;
    if (!url) {
      throw new Error('focus_css_url_missing');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`focus_css_load_failed:${response.status}`);
    }
    const text = await response.text();
    focusCssTemplateCache = text;
    return text;
  })().catch((error) => {
    focusCssTemplatePromise = null;
    throw error;
  });

  return focusCssTemplatePromise;
}

function materializeScopedCss(template, scopeSelector) {
  return materializeScopedCssImpl(template, scopeSelector);
}

function validateScopedCss(cssText, scopeSelector) {
  if (cssText.includes(FOCUS_SCOPE_PLACEHOLDER)) {
    return { ok: false, reason: 'unresolved-placeholder' };
  }

  if (isTrivialScope(scopeSelector)) {
    return { ok: false, reason: 'trivial-scope' };
  }

  return validateScopedCssImpl(cssText, scopeSelector);
}

async function sendScopeTokenMessage(tabId, action, payload = {}, options = {}) {
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const message = { action, ...payload };
  const result =
    typeof frameId === 'number'
      ? await contentBridge.safeSend(tabId, message, { frameId })
      : await contentBridge.safeSend(tabId, message);
  if (result?.ok) {
    return result.data;
  }

  if (isNoReceiverError(result?.lastErrorMessage)) {
    return {
      ok: false,
      error: APPLY_FAILURE_REASONS.NO_RECEIVER,
      detail: formatDetail(result?.lastErrorMessage, 'NO_RECEIVER'),
    };
  }

  return null;
}

async function runScopedScript(tabId, func, args = [], options = {}) {
  if (!isValidTabId(tabId)) {
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: 'invalid-tab' };
  }

  const world = options.world || 'ISOLATED';
  const target = { tabId };
  if (Array.isArray(options.frameIds) && options.frameIds.length > 0) {
    target.frameIds = options.frameIds;
  } else if (typeof options.frameId === 'number') {
    target.frameIds = [options.frameId];
  }

  try {
    const results = await chrome.scripting.executeScript({ target, func, args, world });
    return results?.[0]?.result ?? null;
  } catch (error) {
    if (isNoReceiverError(error)) {
      return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail: formatDetail(error?.message, 'NO_RECEIVER') };
    }
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: formatDetail(error?.message, 'EXECUTE_SCRIPT_FAILED') };
  }
}

function isHttpUrl(href = '') {
  return /^https?:\/\//i.test(href);
}

async function probeFrames(tabId) {
  if (!isValidTabId(tabId)) {
    return [];
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const body = document.body;
        return {
          href: window.location.href || '',
          textLen: body?.innerText?.length || 0,
          hasMain: Boolean(document.querySelector('main,article,[role="main"]')),
          isTop: window.top === window,
          isBlank: window.location.href === 'about:blank' || !body,
        };
      },
    });

    if (!Array.isArray(results)) {
      return [];
    }

    const candidates = [];
    for (const entry of results) {
      if (!entry || typeof entry.frameId !== 'number' || !entry.result) {
        continue;
      }

      const payload = entry.result || {};
      candidates.push({
        frameId: entry.frameId,
        href: typeof payload.href === 'string' ? payload.href : '',
        textLen: typeof payload.textLen === 'number' ? payload.textLen : 0,
        hasMain: payload.hasMain === true,
        isTop: payload.isTop === true,
        isBlank: payload.isBlank === true,
      });
    }

    return candidates;
  } catch (error) {
    return [];
  }
}

function pickBestFrame(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!candidate || candidate.isBlank) {
      continue;
    }
    if (!isHttpUrl(candidate.href)) {
      continue;
    }

    const textLen = typeof candidate.textLen === 'number' ? candidate.textLen : 0;
    const score = textLen + (candidate.hasMain ? 5000 : 0) + (candidate.isTop ? 0 : 1000);

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best || typeof best.textLen !== 'number' || best.textLen < 1500) {
    return null;
  }

  return { frameId: best.frameId };
}

function shouldAttemptFrameFallback(result = {}, source = '', frameId = 0) {
  if (!result || result.ok || frameId !== 0) {
    return false;
  }

  const candidate = typeof result.reason === 'string' ? result.reason : typeof result.error === 'string' ? result.error : '';

  if (
    candidate === APPLY_FAILURE_REASONS.NO_SCOPE ||
    candidate === APPLY_FAILURE_REASONS.NO_RECEIVER ||
    candidate === APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED
  ) {
    return true;
  }

  return false;
}

async function verifyScopeRootBySelectorInPage(tabId, selector, options = {}) {
  const source = 'verifyScopeRoot';
  if (typeof selector !== 'string' || !selector.trim()) {
    return { ok: false, error: 'VERIFY_SCOPE_ROOT_FAILED', detail: 'invalid-selector', source };
  }

  const response = await runScopedScript(
    tabId,
    (requestedSelector) => {
      const module = globalThis.AURA_MODE_ENGINE_SCOPED_V2;
      if (!module) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-runtime-missing' };
      }
      const verifyScopeRootBySelector = module.verifyScopeRootBySelector;
      if (typeof verifyScopeRootBySelector !== 'function') {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'verifyScopeRootBySelector missing' };
      }
      try {
        const result = verifyScopeRootBySelector(requestedSelector);
        if (!result || typeof result !== 'object') {
          return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result' };
        }
        return result;
      } catch (error) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: error?.message || 'verifyScopeRoot failed' };
      }
    },
    [selector],
    { world: 'ISOLATED', frameId: options.frameId },
  );

  if (!response || typeof response !== 'object') {
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: 'bad-result', source };
  }

  if (response.error === APPLY_FAILURE_REASONS.NO_RECEIVER || response.error === APPLY_FAILURE_REASONS.INTERNAL_ERROR) {
    return { ...response, source };
  }

  return { ...response, source };
}

async function salvageScopeRootBySelectorInPage(tabId, selector, options = {}) {
  const source = 'salvageScopeRoot';
  if (typeof selector !== 'string' || !selector.trim()) {
    return { ok: false, error: 'SALVAGE_SCOPE_ROOT_FAILED', detail: 'invalid-selector', source };
  }

  const response = await runScopedScript(
    tabId,
    (requestedSelector, debugOptions) => {
      const module = globalThis.AURA_MODE_ENGINE_SCOPED_V2;
      if (!module) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-runtime-missing' };
      }
      const salvageScopeRootBySelector = module.salvageScopeRootBySelector;
      if (typeof salvageScopeRootBySelector !== 'function') {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'salvageScopeRootBySelector missing' };
      }
      try {
        const result = salvageScopeRootBySelector(requestedSelector, debugOptions);
        if (!result || typeof result !== 'object') {
          return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result' };
        }
        return result;
      } catch (error) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: error?.message || 'salvageScopeRoot failed' };
      }
    },
    [selector, options?.debugEnabled],
    { world: 'ISOLATED', frameId: options.frameId },
  );

  if (!response || typeof response !== 'object') {
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: 'bad-result', source };
  }

  if (response.error === APPLY_FAILURE_REASONS.NO_RECEIVER || response.error === APPLY_FAILURE_REASONS.INTERNAL_ERROR) {
    return { ...response, source };
  }

  if (!response.ok) {
    return { ...response, source };
  }

  const normalized = { ...response };
  if (typeof normalized.selector !== 'string' || !normalized.selector.trim()) {
    normalized.selector = selector;
  }
  if (typeof normalized.tried !== 'boolean') {
    normalized.tried = true;
  }

  return { ...normalized, source };
}

async function ensureScopeRootMarked(tabId, scopeSelectorFinal, options = {}) {
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const attemptId = typeof options?.attemptId === 'number' ? options.attemptId : undefined;
  const debugEnabled = options?.debugEnabled === true;
  let selectorTried = '';
  let result = null;

  if (typeof scopeSelectorFinal !== 'string' || !scopeSelectorFinal.trim()) {
    result = { ok: false, reason: 'NO_SCOPE_SELECTOR' };
  } else {
    const seen = new Set();
    const candidates = [scopeSelectorFinal, ...SCOPE_ROOT_FALLBACK_SELECTORS];
    let lastDetail = '';

    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim() || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      selectorTried = candidate;
      const response = await sendScopeTokenMessage(
        tabId,
        ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT,
        { selector: candidate },
        { frameId },
      );

      if (response?.ok) {
        result = { ok: true, selector: candidate };
        break;
      }

      if (response?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
        result = { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail: response?.detail };
        break;
      }

      lastDetail = formatDetail(response?.detail || response?.reason || response?.error || 'SET_SCOPE_ROOT_FAILED', '');
    }

    if (!result) {
      result = {
        ok: false,
        reason: APPLY_FAILURE_REASONS.SCOPE_ROOT_UNRESOLVED,
        detail: lastDetail || 'SCOPE_ROOT_UNRESOLVED',
      };
    }
  }

  if (result?.ok) {
    recordModeEngineMetric('modeengine.scopedv2.scopeRoot.ensure.ok', 1, { frameId });
  } else {
    recordModeEngineMetric('modeengine.scopedv2.scopeRoot.ensure.fail', 1, { frameId });
  }

  if (debugEnabled) {
    modeEngineLog('[CssApplier][V2] Scope root ensure', {
      attemptId,
      frameId,
      scopeSelector: scopeSelectorFinal,
      selectorTried: result?.selector || selectorTried || scopeSelectorFinal,
      ok: result?.ok === true,
      failReason: result?.reason || result?.error || null,
      detail: result?.detail || null,
    });
  }

  return result;
}

function isNonTrivialScope(scopeKey = '') {
  const normalized = `${scopeKey}`.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === 'body' || normalized === 'html') {
    return false;
  }

  return !normalized.startsWith('body:');
}

function getScopedTypographyConfig(modeId, normalized, variant = 'SCOPED') {
  const isFocus = modeId === MODE_IDS.FOCUS;
  const config = {
    measure: variant === 'SCOPED' ? 'clamp(58ch, 68ch, 76ch)' : 'clamp(60ch, 72ch, 78ch)',
    fontSize: `clamp(16px, calc(16px * ${normalized} * 1.05), 19px)`,
    lineHeight: `clamp(1.5, calc(1.65 * ${normalized}), 2)`,
    headingLineHeight: `clamp(1.5, calc(1.65 * ${normalized}), 1.95)`,
    letterSpacing: `clamp(0px, calc(0.35px * ${normalized}), 0.7px)`,
    paddingInline: variant === 'SCOPED' ? 'clamp(12px, 2vw, 26px)' : 'clamp(10px, 1.5vw, 22px)',
  };

  if (isFocus) {
    config.measure = variant === 'SCOPED' ? 'clamp(64ch, 74ch, 80ch)' : 'clamp(66ch, 76ch, 80ch)';
    config.fontSize = `clamp(16px, calc(16px * ${normalized} * 1.08), 20px)`;
    config.lineHeight = `clamp(1.5, calc(1.68 * ${normalized}), 2.05)`;
    config.headingLineHeight = `clamp(1.5, calc(1.7 * ${normalized}), 2)`;
  }

  return config;
}

function buildScopedTypographyCss(modeId, normalized, variant = 'SCOPED', scopeRoot = '.aura-scope') {
  const isFocus = modeId === MODE_IDS.FOCUS;
  const { measure, fontSize, lineHeight, headingLineHeight, letterSpacing, paddingInline } =
    getScopedTypographyConfig(modeId, normalized, variant);

  const headingMeasure = `min(calc(${measure} + 6ch), 88ch, 100%)`;

  const darkMode = `@media (prefers-color-scheme: dark) { ${scopeRoot} { color-scheme: dark; background-color: #0f1116 !important; color: #e7ecf3 !important; } ${scopeRoot} a { color: #9ab7ff !important; } }`;

  const baseText = `${scopeRoot} { --aura-intensity: ${normalized}; --aura-measure: ${measure}; padding-inline: ${paddingInline} !important; box-sizing: border-box !important; color: inherit; }`;
  const typographyBlocks = `${scopeRoot} :where(p, blockquote, pre, code) { max-inline-size: min(var(--aura-measure), 100%) !important; width: min(100%, var(--aura-measure)) !important; margin-inline: auto !important; font-size: ${fontSize} !important; line-height: ${lineHeight} !important; letter-spacing: ${letterSpacing} !important; }`;
  const headingBlocks = `${scopeRoot} :where(h1, h2, h3, h4, h5, h6) { max-inline-size: ${headingMeasure} !important; margin-inline: auto !important; line-height: ${headingLineHeight} !important; letter-spacing: clamp(0px, calc(0.25px * ${normalized}), 0.6px) !important; }`;
  const listBlocks = `${scopeRoot} :where(li) { font-size: ${fontSize} !important; line-height: ${lineHeight} !important; letter-spacing: clamp(0px, calc(0.25px * ${normalized}), 0.6px) !important; }`;
  const mediaRules = `${scopeRoot} :where(img, video, picture, figure) { max-inline-size: 100% !important; height: auto !important; }`;
  const codeRules = `${scopeRoot} :where(pre, code) { overflow-x: auto !important; }`;

  const focusExtras = isFocus
    ? `${scopeRoot} :where(p, li, blockquote, pre, code, img, video, picture, figure) { animation: none !important; transition: none !important; } ${scopeRoot} :where(.aura-focus-hide) { display: none !important; }`
    : '';

  return [baseText, typographyBlocks, headingBlocks, listBlocks, codeRules, mediaRules, focusExtras, darkMode]
    .filter(Boolean)
    .join(' ');
}

async function getSiteKey(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url ? extractDomain(tab.url) : 'unknown';
  } catch (error) {
    console.warn('[CssApplier] Failed to extract siteKey', error);
    return 'unknown';
  }
}

async function getSmartScopeConfig(siteKey) {
  const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
  const raw = prefs.smartScope || {};

  const baseEnabled = raw.enabled !== false;
  const baseLevel = normalizeLevel(raw.level);
  const perDomain = raw.perDomain && typeof raw.perDomain === 'object' ? raw.perDomain : {};
  const domainCfg = siteKey && perDomain[siteKey] ? perDomain[siteKey] : null;

  if (domainCfg) {
    const enabled = domainCfg.enabled !== false;
    const level = normalizeLevel(domainCfg.level || baseLevel);
    return { enabled, level, source: 'domain', debugEnabled: raw.debugEnabled === true };
  }

  return { enabled: baseEnabled, level: baseLevel, source: 'global', debugEnabled: raw.debugEnabled === true };
}

async function getIntensityForSite(siteKey, modeId, fallbackIntensity) {
  const perDomainPrefs = (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  const sitePref = perDomainPrefs?.[siteKey]?.[modeId]?.intensity;

  if (typeof fallbackIntensity === 'number') {
    return normalizeIntensity(fallbackIntensity);
  }

  if (typeof sitePref === 'number') {
    return normalizeIntensity(sitePref);
  }

  return 1.0;
}

async function getPerDomainModePrefs(siteKey, modeId) {
  if (!siteKey || !modeId) {
    return null;
  }

  const perDomainPrefs = (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  const sitePref = perDomainPrefs?.[siteKey]?.[modeId];
  if (!sitePref || typeof sitePref !== 'object') {
    return null;
  }

  return sitePref;
}

async function getContrastRetryOverrides(tabId, modeId, comfortPrefs) {
  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return null;
  }

  const runtime = await getTabRuntime(tabId);
  const guardState = runtime?.contrastGuard?.[modeId];
  if (!guardState?.retryActive) {
    return null;
  }

  if (comfortPrefs?.darkMode === true) {
    return { ...COMFORT_DARK_RETRY_TOKENS };
  }

  return { ...COMFORT_LIGHT_RETRY_TOKENS };
}

async function applyWithSmartScope(
  tabId,
  modeId,
  intensity,
  config,
  siteKey,
  origin,
  registry,
  monitor = performanceMonitor,
  options = {},
) {
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const variants = config.level === SMARTSCOPE_LEVELS.AGGRESSIVE
    ? ['SCOPED', 'MINIMAL', STRICT_VARIANT]
    : ['MINIMAL', 'SCOPED', STRICT_VARIANT];

  const profileResponse = await sendScopeTokenMessage(tabId, SMARTSCOPE_ACTIONS.GET_PROFILE, {
    level: config.level,
    budgetMs: SMARTSCOPE_TIMEOUT_MS,
  }, { frameId });

  if (profileResponse?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
    return {
      success: false,
      failureReason: APPLY_FAILURE_REASONS.NO_RECEIVER,
      scopeKey: 'body',
      scopeReason: 'no-receiver',
      profiledAt: Date.now(),
    };
  }

  const scopeKey = profileResponse?.profile?.scopeSelector || 'body';
  const scopeProfile = profileResponse?.profile || null;
  const profiledAt = Date.now();
  if (!isNonTrivialScope(scopeKey)) {
    return {
      success: false,
      failureReason: 'trivial-scope',
      scopeKey,
      scopeReason: scopeProfile?.reason || 'fallback',
      scopeProfile,
      profiledAt,
    };
  }
  const scopeClasses = ['aura-scope'];
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    scopeClasses.push('aura-comfort-scope');
  }

  for (const variant of variants) {
    const cssText = buildSmartScopePatchCSS(modeId, intensity, variant);
    let cssId = null;
    let cssHash = null;
    let safeCssText = cssText;
    let domClassToken = '';

    try {
      await monitor.measureHeapDelta(() =>
        monitor.measureLatency(async () => {
          const insertionResult = await insertModeCssSafely({
            tabId,
            frameId,
            cssText,
            origin,
            modeId,
          });

          if (!insertionResult?.ok) {
            throw new Error('insert_failed');
          }

          safeCssText = insertionResult.cssText || cssText;
        }),
      );

      const registration = await registry.register(safeCssText, origin, {
        tabId,
        modeId,
        createdAt: Date.now(),
        scopeKey,
        variant,
        intensity,
      });

      cssId = registration.cssId;
      cssHash = registration.cssHash;

      domClassToken = crypto.randomUUID();
      const classResponse = await sendScopeTokenMessage(tabId, SMARTSCOPE_ACTIONS.APPLY_CLASSES, {
        token: domClassToken,
        operations: [{ selector: scopeKey, add: [...scopeClasses] }],
      }, { frameId });

      if (classResponse?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
        throw new Error(APPLY_FAILURE_REASONS.NO_RECEIVER);
      }

      if (!classResponse?.ok) {
        await chrome.scripting.removeCSS({ target: removalTarget, css: safeCssText, origin }).catch(() => {});
        await registry.remove(cssId);
        continue;
      }

      const verified = await verifyComputedStyles(tabId, modeId, variant, { frameId });

      if (config.debugEnabled) {
        await smartScopeDebugger.log({
          action: 'APPLY',
          tabId,
          siteKey,
          modeId,
          scope: scopeKey,
          diagnostics: {
            chosenScope: scopeKey,
            scopeScore: scopeProfile?.score,
            variant,
            patchCssHash: cssHash,
            verificationResult: verified,
          },
        });
      }

      if (verified) {
        return {
          success: true,
          appliedVariant: variant,
          domClassToken,
          scopeKey,
          scopeProfile,
          verificationPassed: true,
          cssHash,
          cssId,
          profiledAt,
          intensity,
          appliedClasses: classResponse?.applied || [],
        };
      }

      await chrome.scripting.removeCSS({ target: removalTarget, css: safeCssText, origin }).catch(() => {});
      await registry.remove(cssId);
      await sendScopeTokenMessage(tabId, SMARTSCOPE_ACTIONS.REMOVE_TOKEN, { token: domClassToken }, { frameId });
    } catch (error) {
      await chrome.scripting.removeCSS({ target: removalTarget, css: safeCssText, origin }).catch(() => {});
      await registry.remove(cssId);
      await sendScopeTokenMessage(tabId, SMARTSCOPE_ACTIONS.REMOVE_TOKEN, { token: domClassToken }, { frameId });
      await smartScopeDebugger.log({
        action: 'ERROR',
        tabId,
        siteKey,
        modeId,
        error: { code: 'VARIANT_FAILURE', message: error?.message },
        scope: scopeKey,
      });
    }
  }

  await smartScopeDebugger.log({
    action: 'ERROR',
    tabId,
    siteKey,
    modeId,
    error: { code: 'ALL_VARIANTS_FAILED', message: 'all-variants-failed' },
  });

  return { success: false, failureReason: 'all-variants-failed', scopeKey, scopeReason: 'fallback', profiledAt };
}

function buildComfortCss(variant, intensity, scopeSelector = 'body') {
  const normalizedIntensity = normalizeIntensity(intensity);

  if (variant === STRICT_VARIANT) {
    return CSS_COMFORT_VISUAL.replace('--aura-intensity: 1.0', `--aura-intensity: ${normalizedIntensity}`);
  }

  const scope = scopeSelector || '.aura-scope';
  return buildScopedTypographyCss(MODE_IDS.COMFORT_VISUAL, normalizedIntensity, variant, scope);
}

function buildComfortPreludeCss() {
  const backgroundColor = COMFORT_DARK_TOKENS['--aura-bg-color'];
  const textColor = COMFORT_DARK_TOKENS['--aura-text-color'];
  const colorScheme = COMFORT_DARK_TOKENS['--aura-color-scheme'];

  return `
    html,
    body {
      background-color: ${backgroundColor} !important;
      color: ${textColor} !important;
      color-scheme: ${colorScheme} !important;
    }
  `;
}

function buildFocusCss(variant, intensity, scopeSelector = 'body') {
  const normalizedIntensity = normalizeIntensity(intensity);

  if (variant === STRICT_VARIANT) {
    return '';
  }

  const scope = scopeSelector || '.aura-scope';
  return buildScopedTypographyCss(MODE_IDS.FOCUS, normalizedIntensity, variant, scope);
}

function buildSmartScopePatchCSS(modeId, intensity, variant) {
  const normalized = normalizeIntensity(intensity);
  return buildScopedTypographyCss(modeId, normalized, variant, '.aura-scope');
}

async function verifyComputedStyles(tabId, modeId, variant, options = {}) {
  const checks = [];
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    checks.push({ selector: '.aura-scope :where(p, blockquote)', property: 'maxInlineSize', compare: 'gt', value: 360 });
    checks.push({ selector: '.aura-scope :where(p, blockquote)', property: 'lineHeight', compare: 'gt', value: 1.4 });
    checks.push({ selector: 'body :where(nav, aside)', property: 'maxInlineSize', compare: 'lte', value: 2000 });
  } else {
    checks.push({ selector: '.aura-scope :where(p, blockquote)', property: 'maxInlineSize', compare: 'gt', value: 380 });
    checks.push({ selector: '.aura-scope :where(p, blockquote)', property: 'lineHeight', compare: 'gt', value: 1.4 });
    checks.push({ selector: 'body :where(nav, aside)', property: 'maxInlineSize', compare: 'lte', value: 2000 });
  }

  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const response = await contentBridge.safeSend(
    tabId,
    {
      action: ACTIONS.SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1,
      checks,
    },
    { frameId },
  );

  if (!response?.ok) {
    return false;
  }

  return response?.data?.allPassed === true;
}


function buildCss(modeId, variant, scopeSelector, intensity) {
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    return buildComfortCss(variant, intensity, scopeSelector);
  }

  return buildFocusCss(variant, intensity, scopeSelector);
}

function getChecksForVariant(modeId, variant, scopeSelector = 'body') {
  const scope = variant === STRICT_VARIANT ? scopeSelector || 'body' : '.aura-scope';

  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    if (variant === STRICT_VARIANT) {
      return [
        { selector: 'body', property: 'fontSize', compare: 'gt', value: 16 },
        { selector: 'body', property: 'lineHeight', compare: 'gt', value: 1.2 },
      ];
    }

    return [
      { selector: '.aura-scope :where(p, blockquote)', property: 'fontSize', compare: 'gt', value: 15.5 },
      { selector: '.aura-scope', property: 'paddingInlineStart', compare: 'gt', value: 6 },
      { selector: '.aura-scope :where(p, blockquote)', property: 'maxInlineSize', compare: 'gt', value: 360 },
    ];
  }

  if (modeId === MODE_IDS.FOCUS) {
    if (variant === STRICT_VARIANT) {
      return [
        { selector: 'main, article, [role="main"]', property: 'maxWidth', compare: 'exists' },
        { selector: 'body', property: 'animationDuration', compare: 'eq', value: '0s' },
      ];
    }

    return [
      { selector: '.aura-scope', property: 'paddingInlineStart', compare: 'gt', value: 6 },
      { selector: '.aura-scope :where(p, blockquote)', property: 'maxInlineSize', compare: 'gt', value: 380 },
      { selector: '.aura-scope :where(p, blockquote)', property: 'fontSize', compare: 'gt', value: 15.5 },
    ];
  }

  return [];
}

export { buildCss as buildModeCss, buildComfortCss, buildFocusCss, buildSmartScopePatchCSS };

export class CssApplier {
  constructor(registry = cssRegistry, manager = stateManager, monitor = performanceMonitor) {
    this.registry = registry;
    this.stateManager = manager;
    this.performanceMonitor = monitor;
  }

  async applyPreludeCss(tabId, source = 'system') {
    if (!isValidTabId(tabId)) {
      return { ok: false, applied: false, reason: 'invalid-tab' };
    }

    const modeId = MODE_IDS.COMFORT_VISUAL;
    const modeState = await this.stateManager.getModeState(tabId, modeId);
    if (modeState?.state !== STATES.ACTIVE) {
      return { ok: true, applied: false, reason: 'mode-inactive' };
    }

    const scopedState = modeState?.scopedV2 || {};
    const cssText = buildComfortPreludeCss();
    const preludeHash = computeAppliedHash({ cssText, cssId: 'prelude', modeId });

    if (scopedState?.preludeHash === preludeHash && scopedState?.preludeCssId) {
      return { ok: true, applied: false, reason: 'already-applied' };
    }

    const insertionResult = await insertModeCssRaw({
      tabId,
      cssText,
      origin: CSS_ORIGIN,
      modeId,
    });

    if (!insertionResult?.ok) {
      return { ok: false, applied: false, reason: 'insert-failed', detail: insertionResult?.error || null };
    }

    const registration = await this.registry.register(insertionResult?.cssText || cssText, CSS_ORIGIN, {
      tabId,
      modeId,
      createdAt: Date.now(),
      scopeKey: 'html,body',
      variant: 'PRELUDE',
    });

    await this.stateManager.updateModeState(tabId, modeId, modeState.state, {
      scopedV2: {
        ...scopedState,
        preludeCssId: registration.cssId,
        preludeHash,
        preludeAppliedAt: Date.now(),
      },
    });

    return { ok: true, applied: true, cssId: registration.cssId, source };
  }

  async ensureTransitionsCss(tabId, modeId, options = {}) {
    if (!isValidTabId(tabId)) {
      return { ok: false, applied: false, reason: 'invalid-tab' };
    }

    const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
    const modeState = options?.modeState || (await this.stateManager.getModeState(tabId, modeId));
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
      origin: CSS_ORIGIN,
      modeId,
    });

    if (!insertionResult?.ok) {
      return { ok: false, applied: false, reason: 'insert-failed', detail: insertionResult?.error || null };
    }

    let registration = null;
    try {
      registration = await this.registry.register(insertionResult?.cssText || cssText, CSS_ORIGIN, {
        tabId,
        modeId,
        createdAt: Date.now(),
        scopeKey: MODE_ENGINE_SCOPE_SELECTOR,
        variant: 'SCOPED_V2_TRANSITION',
      });
    } catch (error) {
      await removeModeCssRaw({
        tabId,
        frameId,
        cssText: insertionResult?.cssText || cssText,
        origin: CSS_ORIGIN,
      }).catch(() => {});
      return { ok: false, applied: false, reason: 'registry-failed' };
    }

    return {
      ok: true,
      applied: true,
      cssId: registration.cssId,
      cssHash: registration.cssHash || transitionHash,
    };
  }

  async removeTransitionsCss(tabId, modeId, options = {}) {
    if (!isValidTabId(tabId)) {
      return { ok: false, removed: false, reason: 'invalid-tab' };
    }

    const modeState = options?.modeState || (await this.stateManager.getModeState(tabId, modeId));
    const scopedState = modeState?.scopedV2 || {};
    const transitionCssId = scopedState?.transitionCssId;

    if (!transitionCssId) {
      return { ok: true, removed: false, reason: 'not-applied' };
    }

    const entry = await this.registry.get(transitionCssId);
    if (!entry?.cssText) {
      if (options?.updateState !== false) {
        await this.stateManager.updateModeState(tabId, modeId, modeState.state, {
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
      origin: entry.origin || CSS_ORIGIN,
    });

    if (!removalResult?.ok) {
      return { ok: false, removed: false, reason: 'remove-failed', detail: removalResult?.error || null };
    }

    await this.registry.remove(transitionCssId);

    if (options?.updateState !== false) {
      await this.stateManager.updateModeState(tabId, modeId, modeState.state, {
        scopedV2: {
          ...scopedState,
          transitionCssId: null,
          transitionCssHash: null,
        },
      });
    }

    return { ok: true, removed: true };
  }

  async removePreludeCss(tabId, source = 'system') {
    if (!isValidTabId(tabId)) {
      return { ok: false, removed: false, reason: 'invalid-tab' };
    }

    const modeId = MODE_IDS.COMFORT_VISUAL;
    const modeState = await this.stateManager.getModeState(tabId, modeId);

    if (
      modeState?.state !== STATES.ACTIVE &&
      modeState?.state !== STATES.ERROR &&
      modeState?.state !== STATES.BLOCKED
    ) {
      return { ok: true, removed: false, reason: 'mode-inactive', source };
    }

    const scopedState = modeState?.scopedV2 || {};
    const preludeCssId = scopedState?.preludeCssId;

    if (!preludeCssId) {
      return { ok: true, removed: false, reason: 'not-applied' };
    }

    const entry = await this.registry.get(preludeCssId);
    if (!entry?.cssText) {
      await this.stateManager.updateModeState(tabId, modeId, modeState.state, {
        scopedV2: {
          ...scopedState,
          preludeCssId: null,
          preludeHash: null,
          preludeAppliedAt: null,
        },
      });
      return { ok: false, removed: false, reason: 'missing-css', source };
    }

    const removalResult = await removeModeCssRaw({
      tabId,
      cssText: entry.cssText,
      origin: entry.origin || CSS_ORIGIN,
    });

    if (!removalResult?.ok) {
      return { ok: false, removed: false, reason: 'remove-failed', detail: removalResult?.error || null, source };
    }

    await this.registry.remove(preludeCssId);
    await this.stateManager.updateModeState(tabId, modeId, modeState.state, {
      scopedV2: {
        ...scopedState,
        preludeCssId: null,
        preludeHash: null,
        preludeAppliedAt: null,
      },
    });

    return { ok: true, removed: true, source };
  }

  async applyMode(tabId, modeId, params = {}, source = 'popup') {
    if (isFlagEnabled('scopedModeCssV2')) {
      return this.applyModeScopedV2(tabId, modeId, params, source);
    }

    return this.applyModeV1(tabId, modeId, params, source);
  }

  async applyModeScopedV2(tabId, modeId, params = {}, source = 'popup') {
    const frameId = typeof params?.frameId === 'number' ? params.frameId : 0;
    const inFlightKey = scopedV2KeyToString(makeScopedV2Key(tabId, frameId));
    const existingInFlight = inFlightApplyByTab.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const attemptId = lastAttemptId + 1;
    lastAttemptId = attemptId;
    const applyPromise = this._applyModeScopedV2(tabId, modeId, params, source, attemptId);
    inFlightApplyByTab.set(inFlightKey, applyPromise);
    applyPromise.finally(() => {
      if (inFlightApplyByTab.get(inFlightKey) === applyPromise) {
        inFlightApplyByTab.delete(inFlightKey);
      }
    });

    return applyPromise;
  }

  async _applyModeScopedV2(tabId, modeId, params = {}, source = 'popup', attemptId = 0) {
    const options = typeof params === 'number' ? { intensity: params } : params || {};
    const requestedFrameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
    const start = globalThis?.performance?.now ? performance.now() : Date.now();
    const debugEnabled = isFlagEnabled('debugModeEngine');
    let applyUrl = null;
    let applyUrlKey = '';
    let policyRecorded = false;

    const finish = (result = {}) => {
      const normalized = { ok: result?.ok !== false };
      if (result.reason) {
        normalized.reason = result.reason;
        normalized.error = result.error || result.reason;
      }
      if (result.details) {
        normalized.details = result.details;
      }
      if (result.detail) {
        normalized.detail = result.detail;
      }

      modeEngineLog('[AURA][ModeEngine] v2 apply result', { ...normalized, mode: modeId, attemptId });
      if (debugEnabled) {
        try {
          const resultFrameId = typeof result.frameId === 'number' ? result.frameId : requestedFrameId;
          void contentBridge.safeSend(
            tabId,
            {
              action: ACTIONS.MODE_ENGINE_V2_APPLY_RESULT,
              modeId,
              ok: normalized.ok,
              reason: normalized.reason || null,
              attemptId,
            },
            { frameId: resultFrameId },
          );
        } catch (_) {
          // ignore fire-and-forget notification failures
        }
      }
      return { ...result, ok: normalized.ok, attemptId };
    };

    const recordApplyOutcomeOnce = async (result = {}) => {
      if (policyRecorded) {
        return;
      }
      policyRecorded = true;

      if (!applyUrl) {
        return;
      }

      if (result?.ok) {
        await recordApplyOutcome({ url: applyUrl, ok: true });
        return;
      }

      const failReason = classifyApplyFailureForPolicy(result);
      if (failReason) {
        await recordApplyOutcome({ url: applyUrl, ok: false, failReason });
      }
    };

    const removePreludeBestEffort = async (reason) => {
      if (modeId !== MODE_IDS.COMFORT_VISUAL) {
        return;
      }

      try {
        await this.removePreludeCss(tabId, reason);
      } catch (_) {
        // best-effort cleanup; ignore failures
      }
    };

    const finalize = async (result = {}) => {
      if (result?.ok) {
        await removePreludeBestEffort('after-final-apply');
      } else {
        await removePreludeBestEffort('apply-failed');
      }
      await recordApplyOutcomeOnce(result);
      return finish(result);
    };

    if (!isValidTabId(tabId) || !Object.values(MODE_IDS).includes(modeId)) {
      modeEngineLog('[CssApplier][V2] Invalid input', { tabId, modeId, attemptId });
      return finalize({ ok: false, reason: APPLY_FAILURE_REASONS.EXT_CONTEXT_INVALID });
    }

    const recordSmartScopeStatus = async (action, result = {}) => {
      await this.stateManager.setSmartScopeStatus(tabId, modeId, {
        action,
        ok: result?.ok !== false,
        error: result?.error || result?.reason || null,
        detail: result?.detail || null,
        blockedUntil: result?.blockedUntil ?? null,
        attemptId,
        timestamp: Date.now(),
      });
    };

    const policyResult = await resolveSitePolicy(tabId);
    applyUrl = policyResult.url;
    applyUrlKey = await resolveUrlKey(tabId, applyUrl);
    const policyBlocked = !policyResult.policy?.allowed;
    const blockedResult = policyBlocked ? buildSiteBlockedResult(policyResult.policy) : null;
    if (policyBlocked) {
      await recordSmartScopeStatus('apply', blockedResult);
    }

    recordV2Metric('apply.attempt', 1, { modeId, source });

    const siteKey = policyResult.url ? extractDomain(policyResult.url) : await getSiteKey(tabId);
    const smartScopeConfig = await getSmartScopeConfig(siteKey);
    const degradedTriggered = this.performanceMonitor?.isDegradedTriggered
      ? await this.performanceMonitor.isDegradedTriggered()
      : this.performanceMonitor?.degradedTriggered;
    if (degradedTriggered) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.DEGRADED, { pendingDecision: false });
      await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.DEGRADED });
      return finalize({ ok: false, reason: APPLY_FAILURE_REASONS.DEGRADED });
    }

    const normalizedIntensity = await getIntensityForSite(siteKey, modeId, options.intensity);

    // Clear any existing scoped artifacts before applying again
    await this.removeModeScopedV2(tabId, modeId, { updateState: false });

    const applyInFrame = async (frameId) => {
      const cacheKey = makeScopeCacheKey(tabId, modeId);
      if (source === 'popup') {
        lastScopeCache.delete(cacheKey);
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
        const isFresh = cachedEntry.urlKey === applyUrlKey && now - cachedEntry.savedAtMs < LAST_SCOPE_CACHE_TTL_MS;
        if (isFresh) {
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
            lastScopeCache.delete(cacheKey);
          }
        } else {
          lastScopeCache.delete(cacheKey);
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
      const noScopeDetail = formatDetail(reasonIfFail, 'SMARTSCOPE_FAILED');

      if (!profileOk) {
        if (scopeDetail === 'TIME_BUDGET_EXCEEDED') {
          if (!scopeSelector || !isNonTrivialScope(scopeSelector)) {
            recordV2Metric('apply.no_scope', 1, { modeId });
            await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail });
            return { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail };
          }
        } else {
          recordV2Metric('apply.no_scope', 1, { modeId });
          await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail });
          return { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: noScopeDetail };
        }
      }

      if (!scopeSelector || !isNonTrivialScope(scopeSelector)) {
        recordV2Metric('apply.no_scope', 1, { modeId });
        const fallbackDetail = formatDetail(scopeDetail, noScopeDetail);
        await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.NO_SCOPE, detail: fallbackDetail });
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
        recordV2Metric('apply.no_scope', 1, { modeId });
        await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail });
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
                recordV2Metric('apply.no_scope', 1, { modeId });
                await recordSmartScopeStatus('apply', {
                  ok: false,
                  error: APPLY_FAILURE_REASONS.INTERNAL_ERROR,
                  detail,
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
            recordV2Metric('apply.no_scope', 1, { modeId });
            await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail });
            return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
          }

          if (verification?.error === APPLY_FAILURE_REASONS.INTERNAL_ERROR) {
            const detail = formatDetail(verification?.detail, 'INTERNAL_ERROR');
            recordV2Metric('apply.no_scope', 1, { modeId });
            await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail });
            return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
          }

          if (!verification?.ok) {
            if (!verifiedByScope && !salvageAttempted) {
              const detail = formatDetail(initialReason, 'INTERNAL_ERROR');
              recordV2Metric('apply.no_scope', 1, { modeId });
              await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail });
              return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail };
            }

            const baseDetail = formatVerificationDetail(verification) || formatDetail(initialReason, 'SCOPE_REJECTED');
            const detail = salvageDetail ? `${baseDetail}; ${salvageDetail}` : baseDetail;
            recordV2Metric('apply.no_scope', 1, { modeId });
            await recordSmartScopeStatus('apply', {
              ok: false,
              reason: APPLY_FAILURE_REASONS.SCOPE_REJECTED,
              detail,
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

      if (shouldAttemptSalvage) {
        // Ensure we don't reuse a stale cached failure in subsequent attempts.
        cachedVerificationFailure = null;
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

      const modePrefs =
        typeof this.stateManager?.getModePrefs === 'function'
          ? await this.stateManager.getModePrefs(modeId)
          : null;
      const comfortVisualPrefs =
        modeId === MODE_IDS.COMFORT_VISUAL ? await getComfortVisualPrefsFromStorage() : null;
      const perDomainModePrefs =
        modeId === MODE_IDS.COMFORT_VISUAL ? await getPerDomainModePrefs(siteKey, modeId) : null;
      const effectiveComfortPrefs =
        perDomainModePrefs?.darkMode === false && comfortVisualPrefs
          ? { ...comfortVisualPrefs, darkMode: false }
          : comfortVisualPrefs;
      const baseComfortOverrides =
        modeId === MODE_IDS.COMFORT_VISUAL ? buildComfortVisualTokenOverrides(effectiveComfortPrefs) : {};
      const retryOverrides =
        modeId === MODE_IDS.COMFORT_VISUAL
          ? await getContrastRetryOverrides(tabId, modeId, effectiveComfortPrefs)
          : null;
      const comfortOverrides = retryOverrides ? { ...baseComfortOverrides, ...retryOverrides } : baseComfortOverrides;

      let { tokens: tokenMap, ownedKeys } = computeTokensV2({
        profile: profileResponse?.profile,
        intensity: normalizedIntensity,
        modeId,
        overrides: comfortOverrides,
      });

      const applyDebugToken = (map, keys) => {
        if (!debugEnabled) {
          return;
        }

        map['--aura-me2-scope-present'] = '1';
        if (!keys.includes('--aura-me2-scope-present')) {
          keys.push('--aura-me2-scope-present');
        }
      };

      applyDebugToken(tokenMap, ownedKeys);
      const tokenResult = await sendScopeTokenMessage(
        tabId,
        ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
        {
          tokenMap,
          ownerKey: SCOPED_MODE_OWNER_KEY,
        },
        { frameId: resolvedFrameId },
      );

      if (!tokenResult?.ok) {
        if (tokenResult?.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
          const detail = formatDetail(tokenResult?.detail, APPLY_FAILURE_REASONS.NO_RECEIVER);
          await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail });
          return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER, detail };
        }
        const detail = formatDetail(tokenResult?.detail || tokenResult?.reason, 'TOKEN_APPLY_FAILED');
        await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED, detail });
        recordV2Metric('apply.no_scope', 1, { modeId });
        return { ok: false, reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED, detail };
      }

      if (modeId === MODE_IDS.COMFORT_VISUAL && modePrefs?.contrastGuard === true) {
        const guardOverrides = await getComfortContrastGuardOverrides({
          tabId,
          modePrefs,
          comfortPrefs: effectiveComfortPrefs,
          frameId: resolvedFrameId,
        });
        if (guardOverrides) {
          const boosted = computeTokensV2({
            profile: profileResponse?.profile,
            intensity: normalizedIntensity,
            modeId,
            overrides: { ...comfortOverrides, ...guardOverrides },
          });
          applyDebugToken(boosted.tokens, boosted.ownedKeys);
          const guardResult = await sendScopeTokenMessage(
            tabId,
            ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
            {
              tokenMap: boosted.tokens,
              ownerKey: SCOPED_MODE_OWNER_KEY,
            },
            { frameId: resolvedFrameId },
          );
          if (guardResult?.ok) {
            tokenMap = boosted.tokens;
            ownedKeys = boosted.ownedKeys;
          }
        }
      }
      const { reduceMotionEnabled, smoothTransitionsEnabled, transitionMs } = getSmoothTransitionSettings(
        modeId,
        modePrefs,
      );
      const cssText = buildScopedModeCssV2({
        modeId,
        intensity: normalizedIntensity,
        includeDebugSentinels: debugEnabled,
        reduceMotion: reduceMotionEnabled,
        smoothTransitions: false,
        transitionMs,
      });
      const insertionResult = await insertModeCssSafely({
        tabId,
        frameId: resolvedFrameId,
        cssText,
        origin: CSS_ORIGIN,
        modeId,
        forceGuard: true,
        scopeSelector: MODE_ENGINE_SCOPE_SELECTOR,
        modeEnginePath: 'scoped-v2',
      });

      if (!insertionResult?.ok || !insertionResult.cssText) {
        recordV2Metric('apply.rejected_css', 1, { modeId });
        await sendScopeTokenMessage(
          tabId,
          ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
          { ownerKey: SCOPED_MODE_OWNER_KEY },
          { frameId: resolvedFrameId },
        );
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false, scopedV2: null });
        const guardRejected = insertionResult?.guardResult?.ok === false;
        const reason = guardRejected
          ? APPLY_FAILURE_REASONS.GUARDRAILS_REJECTED
          : APPLY_FAILURE_REASONS.INSERT_CSS_FAILED;
        const guardReason =
          insertionResult?.guardResult?.reasons?.[0]?.message || insertionResult?.guardResult?.reasons?.[0]?.code;
        const insertReason = insertionResult?.error?.message || insertionResult?.reasons?.[0]?.message || insertionResult?.error;
        const detail = formatDetail(guardRejected ? guardReason : insertReason, reason);
        await recordSmartScopeStatus('apply', { ok: false, reason, detail });
        return {
          ok: false,
          reason,
          detail,
          details: insertionResult?.guardResult?.reasons,
          guarded: insertionResult?.guarded,
        };
      }

      const safeCssText = insertionResult.cssText || cssText;
      let registration;
      try {
        registration = await this.registry.register(safeCssText, CSS_ORIGIN, {
          tabId,
          modeId,
          createdAt: Date.now(),
          scopeKey: scopeSelector,
          variant: 'SCOPED_V2',
          intensity: normalizedIntensity,
        });
      } catch (error) {
        const removalTarget = { tabId, frameIds: [resolvedFrameId] };
        await chrome.scripting.removeCSS({ target: removalTarget, css: safeCssText, origin: CSS_ORIGIN }).catch(() => {});
        await sendScopeTokenMessage(
          tabId,
          ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
          { ownerKey: SCOPED_MODE_OWNER_KEY },
          { frameId: resolvedFrameId },
        );
        await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.REGISTRY_FAILED });
        return { ok: false, reason: APPLY_FAILURE_REASONS.REGISTRY_FAILED };
      }

      const scopedApply = applyScopedModeV2({
        tabId,
        frameId: resolvedFrameId,
        cssId: registration.cssId,
        modeId,
        cssText: safeCssText,
        tokens: tokenMap,
        scopeSelector,
      });

      let transitionResult = null;
      if (smoothTransitionsEnabled) {
        transitionResult = await this.ensureTransitionsCss(tabId, modeId, {
          frameId: resolvedFrameId,
          transitionMs,
        });
      }

      const scopedState = {
        scopeSelector,
        owner: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || [],
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        cssText: safeCssText,
        appliedAt: Date.now(),
        intensity: normalizedIntensity,
        verification,
        frameId: resolvedFrameId,
        applied: scopedApply?.applied !== false,
        transitionCssId: transitionResult?.ok ? transitionResult?.cssId : null,
        transitionCssHash: transitionResult?.ok ? transitionResult?.cssHash : null,
      };

      await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        pendingDecision: false,
        smartScope: null,
        scopedV2: scopedState,
      });
      await patchTabRuntime(tabId, { cssId: registration.cssId, modeId, appliedAt: scopedState.appliedAt });

      await recordSmartScopeStatus('apply', { ok: true });
      recordV2Metric('apply.success', 1, { modeId });
      recordV2Metric(
        'apply.elapsedMs',
        Math.round((globalThis?.performance?.now ? performance.now() : Date.now()) - start),
        { modeId },
      );

      if (applyUrlKey && isNonTrivialScope(scopeSelector)) {
        setCachedScopeEntry(makeScopeCacheKey(tabId, modeId), {
          scopeSelector,
          frameId: resolvedFrameId,
          urlKey: applyUrlKey,
          savedAtMs: Date.now(),
        });
      }

      return { ok: true, cssId: registration.cssId, variant: 'SCOPED_V2', frameId: resolvedFrameId };
    };

    const initialFrameId = typeof requestedFrameId === 'number' ? requestedFrameId : 0;
    const initialResult = policyBlocked ? blockedResult : await applyInFrame(initialFrameId);
    if (shouldAttemptFrameFallback(initialResult, source, initialFrameId)) {
      recordModeEngineMetric('modeengine.scopedv2.frameFallback.attempted', 1);
      const topFailReason = initialResult?.reason || initialResult?.error || null;
      const candidates = await probeFrames(tabId);
      const best = pickBestFrame(candidates);
      if (debugEnabled) {
        modeEngineLog('[CssApplier][V2] Frame fallback', {
          attemptId,
          topFailReason,
          bestFrameId: typeof best?.frameId === 'number' ? best.frameId : null,
        });
      }
      if (best && typeof best.frameId === 'number' && best.frameId !== initialFrameId) {
        await ensureContentInFrame(tabId, best.frameId);
        const fallbackResult = await applyInFrame(best.frameId);
        if (fallbackResult?.ok) {
          recordModeEngineMetric('modeengine.scopedv2.frameFallback.success', 1);
          return finalize(fallbackResult);
        }
      }
    }

    return finalize(initialResult);
  }

  async applyModeV1(tabId, modeId, params = {}, source = 'popup') {
    const options = typeof params === 'number' ? { intensity: params } : params || {};
    const requestedFrameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
    const removalTarget = typeof requestedFrameId === 'number' ? { tabId, frameIds: [requestedFrameId] } : { tabId };
    let applyUrl = null;
    let policyRecorded = false;

    const recordApplyOutcomeOnce = async (result = {}) => {
      if (policyRecorded) {
        return;
      }
      policyRecorded = true;

      if (!applyUrl) {
        return;
      }

      if (result?.ok) {
        await recordApplyOutcome({ url: applyUrl, ok: true });
        return;
      }

      const failReason = classifyApplyFailureForPolicy(result);
      if (failReason) {
        await recordApplyOutcome({ url: applyUrl, ok: false, failReason });
      }
    };

    const finalize = async (result = {}) => {
      await recordApplyOutcomeOnce(result);
      return result;
    };

    if (!isValidTabId(tabId) || !Object.values(MODE_IDS).includes(modeId)) {
      console.warn('[CssApplier] Invalid applyMode input', { tabId, modeId });
      return finalize({ ok: false });
    }

    const recordSmartScopeStatus = async (action, result = {}) => {
      await this.stateManager.setSmartScopeStatus(tabId, modeId, {
        action,
        ok: result?.ok !== false,
        error: result?.error || result?.reason || null,
        detail: result?.detail || null,
        blockedUntil: result?.blockedUntil ?? null,
        timestamp: Date.now(),
      });
    };

    const policyResult = await resolveSitePolicy(tabId);
    applyUrl = policyResult.url;
    if (!policyResult.policy?.allowed) {
      const blockedResult = buildSiteBlockedResult(policyResult.policy);
      await recordSmartScopeStatus('apply', blockedResult);
      return finalize(blockedResult);
    }

    const siteKey = policyResult.url ? extractDomain(policyResult.url) : await getSiteKey(tabId);
    const smartScopeConfig = await getSmartScopeConfig(siteKey);
    const degradedTriggered = this.performanceMonitor?.isDegradedTriggered
      ? await this.performanceMonitor.isDegradedTriggered()
      : this.performanceMonitor?.degradedTriggered;
    if (degradedTriggered) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.DEGRADED, { pendingDecision: false });
      await recordSmartScopeStatus('apply', { ok: false, reason: 'degraded' });
      return finalize({ ok: false, reason: 'degraded' });
    }

    const normalizedIntensity = await getIntensityForSite(siteKey, modeId, options.intensity);
    let baseCssText = buildCss(modeId, STRICT_VARIANT, 'body', normalizedIntensity);
    let focusGuardResult = null;

    if (modeId === MODE_IDS.FOCUS) {
      try {
        const focusTemplate = await loadFocusCssTemplate();
        const scopeSelector = MODE_ENGINE_SCOPE_SELECTOR;
        const scopedCss = materializeScopedCss(focusTemplate, scopeSelector);
        focusGuardResult = validateScopedCss(scopedCss, scopeSelector);
        if (!focusGuardResult.ok) {
          modeEngineLog('[CssApplier][Focus] Guardrails rejected focus CSS', {
            reason: focusGuardResult.reason,
            detail: focusGuardResult.detail,
          });
          await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false });
          await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.GUARDRAILS_REJECTED });
          return finalize({ ok: false, reason: APPLY_FAILURE_REASONS.GUARDRAILS_REJECTED });
        }
        baseCssText = scopedCss;
      } catch (error) {
        modeEngineLog('[CssApplier][Focus] Failed to load focus CSS template', {
          error: error?.message || String(error),
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false });
        await recordSmartScopeStatus('apply', { ok: false, error: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED });
        return finalize({ ok: false, reason: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED });
      }
    }
    let baseCssId = null;
    let baseCssHash = null;
    let injectedBaseCss = baseCssText;

    try {
      await this.performanceMonitor.measureHeapDelta(() =>
        this.performanceMonitor.measureLatency(async () => {
          const insertionResult = await insertModeCssSafely({
            tabId,
            frameId: requestedFrameId,
            cssText: baseCssText,
            origin: CSS_ORIGIN,
            modeId,
          });

          if (!insertionResult?.ok) {
            throw new Error('insert_failed');
          }

          injectedBaseCss = insertionResult.cssText || baseCssText;
        }),
      );

      const baseRegistration = await this.registry.register(injectedBaseCss, CSS_ORIGIN, {
        tabId,
        modeId,
        createdAt: Date.now(),
        scopeKey: 'body',
        variant: STRICT_VARIANT,
        intensity: normalizedIntensity,
      });

      baseCssId = baseRegistration.cssId;
      baseCssHash = baseRegistration.cssHash || null;
    } catch (error) {
      await chrome.scripting.removeCSS({ target: removalTarget, css: injectedBaseCss, origin: CSS_ORIGIN }).catch(() => {});
      await this.registry.remove(baseCssId);
      await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false });
      console.warn('[CssApplier] Failed to insert base CSS', error);
      await recordSmartScopeStatus('apply', { ok: false, error: 'insert_failed' });
      return finalize({ ok: false, error: 'insert_failed' });
    }

    let appliedVariant = STRICT_VARIANT;
    let cssId = baseCssId;
    let cssHash = baseCssHash;
    let domClassToken = null;
    let scopeKey = 'body';
    let verificationPassed = true;
    let profiledAt = null;
    let scopeProfile = null;
    let appliedClasses = [];
    let scopeReason = 'profile';
    let variantReason = 'strict-default';
    const usedSmartScope = smartScopeConfig.enabled === true;

    let patchCssHash = null;
    let patchCssId = null;

    if (usedSmartScope) {
      const smartResult = await applyWithSmartScope(
        tabId,
        modeId,
        normalizedIntensity,
        smartScopeConfig,
        siteKey,
        CSS_ORIGIN,
        this.registry,
        this.performanceMonitor,
        { frameId: requestedFrameId },
      );

      if (smartResult.success) {
        appliedVariant = smartResult.appliedVariant || STRICT_VARIANT;
        domClassToken = smartResult.domClassToken || null;
        scopeKey = smartResult.scopeKey || scopeKey;
        verificationPassed = smartResult.verificationPassed !== false;
        profiledAt = smartResult.profiledAt || profiledAt;
        patchCssHash = smartResult.cssHash || null;
        patchCssId = smartResult.cssId || null;
        scopeProfile = smartResult.scopeProfile || null;
        appliedClasses = smartResult.appliedClasses || [];
        scopeReason = smartResult.scopeReason || smartResult.scopeProfile?.reason || 'profile';
        variantReason = 'verification-passed';
        cssId = smartResult.cssId || cssId;
        cssHash = smartResult.cssHash || cssHash;
      } else {
        await smartScopeDebugger.log({
          action: 'FALLBACK',
          tabId,
          siteKey,
          modeId,
          fallback: { fromVariant: 'smartscope', toVariant: STRICT_VARIANT, reason: smartResult.failureReason },
        });
        scopeReason = smartResult.scopeReason || scopeReason;
        variantReason = smartResult.failureReason ? `fallback:${smartResult.failureReason}` : 'fallback:unknown';
      }
    }

    const appliedCssId = patchCssId || cssId;
    const appliedCssHash = patchCssHash || cssHash;
    const appliedAt = Date.now();

    const smartScopeState = usedSmartScope
      ? {
          scopeKey,
          scopeReason,
          variant: appliedVariant,
          variantReason,
          domClassToken,
          appliedClasses,
          cssId: patchCssId || null,
          cssHash: patchCssHash || null,
          baseCssId: cssId,
          baseCssHash: cssHash,
          profiledAt: profiledAt || appliedAt,
          appliedAt,
          verified: verificationPassed,
          configLevel: smartScopeConfig.level,
          scopeProfile,
          intensity: normalizedIntensity,
        }
      : null;

    await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
      cssId: appliedCssId,
      cssHash: appliedCssHash,
      pendingDecision: false,
      smartScope: smartScopeState,
    });
    await patchTabRuntime(tabId, { cssId: appliedCssId, modeId, appliedAt });

    await recordSmartScopeStatus('apply', { ok: true });

    if (smartScopeConfig.debugEnabled) {
      await smartScopeDebugger.log({
        action: 'MODE_APPLIED',
        tabId,
        siteKey,
        modeId,
        application: { variant: appliedVariant, cssId, domClassToken, verificationPassed },
      });
    }

    return finalize({ ok: true, cssId, variant: appliedVariant });
  }

  async updateTokensScopedV2(tabId, modeId, tokenOverrides = {}) {
    if (!isFlagEnabled('scopedModeCssV2')) {
      return { ok: false, reason: 'flag-disabled' };
    }

    const modeState = await this.stateManager.getModeState(tabId, modeId);
    const scopedState = modeState?.scopedV2;
    if (!scopedState?.scopeSelector) {
      return { ok: false, reason: 'no-scope' };
    }

    const { tokens: tokenMap, ownedKeys } = computeTokensV2({
      profile: null,
      intensity: scopedState.intensity || 1,
      modeId,
      overrides: tokenOverrides,
    });
    const frameId = typeof scopedState?.frameId === 'number' ? scopedState.frameId : 0;
    const result = await sendScopeTokenMessage(
      tabId,
      ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
      {
        tokenMap,
        ownerKey: SCOPED_MODE_OWNER_KEY,
      },
      { frameId },
    );

    if (result?.ok) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        scopedV2: { ...scopedState, tokenKeys: ownedKeys || Object.keys(tokenMap) },
      });
    }

    return result || { ok: false, reason: 'token-update-failed' };
  }

  async removeMode(tabId, modeId) {
    if (isFlagEnabled('scopedModeCssV2')) {
      const modeState = await this.stateManager.getModeState(tabId, modeId);
      if (modeState?.scopedV2) {
        return this.removeModeScopedV2(tabId, modeId, { modeState });
      }

      if (modeState?.smartScope || modeState?.cssId) {
        return this.removeModeV1(tabId, modeId);
      }

      return this.removeModeScopedV2(tabId, modeId, { modeState });
    }

    return this.removeModeV1(tabId, modeId);
  }

  async removeModeScopedV2(tabId, modeId, options = {}) {
    const updateState = options?.updateState !== false;

    if (!isValidTabId(tabId)) {
      return { ok: false };
    }

    const modeState = options.modeState || (await this.stateManager.getModeState(tabId, modeId));
    const scopedState = modeState?.scopedV2;
    const scopeSelector = options.scopeSelector || scopedState?.scopeSelector;

    if (!scopeSelector) {
      return { ok: false, reason: 'no-scope' };
    }

    if (isNonTrivialScope(scopeSelector)) {
      const urlKey = await resolveUrlKey(tabId);
      if (urlKey) {
        setCachedScopeEntry(makeScopeCacheKey(tabId, modeId), {
          scopeSelector,
          frameId: scopedState?.frameId || 0,
          urlKey,
          savedAtMs: Date.now(),
        });
      }
    }

    const modePrefs =
      typeof this.stateManager?.getModePrefs === 'function'
        ? await this.stateManager.getModePrefs(modeId)
        : null;
    const { smoothTransitionsEnabled, transitionMs } = getSmoothTransitionSettings(modeId, modePrefs);

    const removalResult = await removeScopedModeV2({
      tabId,
      frameId: scopedState?.frameId || 0,
      cssId: scopedState?.cssId || modeState?.cssId,
      preserveScope: smoothTransitionsEnabled,
      transitionMs: smoothTransitionsEnabled ? transitionMs : 0,
    });

    await this.removeTransitionsCss(tabId, modeId, { modeState, updateState: false });

    if (updateState && modeId === MODE_IDS.COMFORT_VISUAL) {
      try {
        await this.removePreludeCss(tabId, 'mode-disabled');
      } catch (_) {
        // best-effort cleanup; ignore failures
      }
    }

    if (updateState) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
        cssId: null,
        cssHash: null,
        smartScope: null,
        scopedV2: null,
        pendingDecision: false,
      });
      await patchTabRuntime(tabId, { cssId: undefined, modeId: undefined, appliedAt: undefined });

      await this.stateManager.setSmartScopeStatus(tabId, modeId, {
        action: 'restore',
        ok: true,
        error: null,
        timestamp: Date.now(),
      });
    }

    const details = removalResult?.details || {
      cssRemoved: false,
      tokensRemoved: false,
      scopeUnmarked: false,
    };

    recordV2Metric('cleanup.ran', 1, { modeId });
    return { ok: true, details };
  }

  async removeModeV1(tabId, modeId) {
    if (!isValidTabId(tabId)) {
      await this.stateManager.setSmartScopeStatus(tabId, modeId, {
        action: 'restore',
        ok: false,
        error: 'invalid_tab',
        timestamp: Date.now(),
      });
      return { ok: false };
    }

    if (modeId === MODE_IDS.COMFORT_VISUAL) {
      try {
        await this.removePreludeCss(tabId, 'mode-disabled');
      } catch (_) {
        // best-effort cleanup; ignore failures
      }
    }

    const modeState = await this.stateManager.getModeState(tabId, modeId);
    const smartScopeState = modeState?.smartScope;
    const domClassToken = smartScopeState?.domClassToken;

    if (domClassToken) {
      await contentBridge.safeSend(tabId, { action: SMARTSCOPE_ACTIONS.REMOVE_TOKEN, token: domClassToken });
    }

    if (smartScopeState?.patchCssId) {
      const patchEntry = await this.registry.get(smartScopeState.patchCssId);
      if (patchEntry?.cssText) {
        await chrome.scripting
          .removeCSS({ target: { tabId }, css: patchEntry.cssText, origin: patchEntry.origin })
          .catch(() => {});
      }
      await this.registry.remove(smartScopeState.patchCssId);
    } else if (smartScopeState?.variant) {
      const patchCss = buildSmartScopePatchCSS(modeId, smartScopeState.intensity || 1, smartScopeState.variant);
      await chrome.scripting.removeCSS({ target: { tabId }, css: patchCss, origin: CSS_ORIGIN }).catch(() => {});
    }

    const baseCssId = smartScopeState?.baseCssId || modeState?.cssId;

    if (baseCssId) {
      const entry = await this.registry.get(baseCssId);
      if (entry?.cssText) {
        await chrome.scripting
          .removeCSS({ target: { tabId }, css: entry.cssText, origin: entry.origin })
          .catch(() => {});
      }
      await this.registry.remove(baseCssId);
    } else {
      console.warn('[CssApplier] Missing cssId for removal; performing best-effort cleanup');
    }

    await this.stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
      cssId: null,
      pendingDecision: false,
      smartScope: null,
    });
    await patchTabRuntime(tabId, { cssId: undefined, modeId: undefined, appliedAt: undefined });

    await this.stateManager.setSmartScopeStatus(tabId, modeId, {
      action: 'restore',
      ok: true,
      error: null,
      timestamp: Date.now(),
    });

    return { ok: true };
  }
}

export const cssApplier = new CssApplier(cssRegistry, stateManager);
