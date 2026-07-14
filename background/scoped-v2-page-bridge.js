import { ACTIONS } from '../shared/constants.js';
import { isValidTabId } from '../shared/utils.js';
import { modeEngineLog, recordModeEngineMetric } from '../shared/mode-engine-debug.js';
import { APPLY_FAILURE_REASONS } from './apply-failure-reasons.js';
import { contentBridge } from './content-bridge.js';

const FRAME_CONTENT_FILES = [
  'content/smartscope-v2.runtime.js',
  'content/mode-engine-scoped-v2.runtime.js',
  'content/dark-comfort-theme.runtime.js',
  'content/content-bootstrap.runtime.js',
  'content/content-message-router.runtime.js',
  'content/content-main.js',
];
const FRAME_ENTRYPOINT_FILES = [
  'content/content-message-router.runtime.js',
  'content/content-main.js',
];
const FRAME_RECEIVER_MAX_ATTEMPTS = 6;
const FRAME_RECEIVER_BASE_DELAY_MS = 100;
const RETRYABLE_BOOTSTRAP_PHASE = 'RETRYABLE_FAILED';
const TERMINAL_BOOTSTRAP_PHASE = 'INVALIDATED';
const SCOPE_ROOT_FALLBACK_SELECTORS = ['main', 'article', '[role="main"]', '#main', '#content'];

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

export function isNoReceiverError(error) {
  const message = `${error?.message || error || ''}`;
  return message.includes('Receiving end does not exist');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function ensureContentInFrame(tabId, frameId) {
  if (!isValidTabId(tabId) || typeof frameId !== 'number') {
    return { ok: false, error: 'invalid-target' };
  }

  let fullInjectionAttempted = false;
  let entrypointInjectionAttempted = false;

  for (let attempt = 1; attempt <= FRAME_RECEIVER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await sendPingMessage(tabId, frameId);
      if (response?.ok === true) {
        return {
          ok: true,
          injected: fullInjectionAttempted || entrypointInjectionAttempted,
        };
      }
      if (response?.phase === TERMINAL_BOOTSTRAP_PHASE) {
        return { ok: false, error: response?.reason || 'CONTENT_CONTEXT_INVALIDATED' };
      }
      if (
        response?.phase === RETRYABLE_BOOTSTRAP_PHASE
        && response?.retryable === true
        && !entrypointInjectionAttempted
      ) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          files: FRAME_ENTRYPOINT_FILES,
        });
        entrypointInjectionAttempted = true;
      }
    } catch (error) {
      if (!isNoReceiverError(error)) {
        return { ok: false, error: formatDetail(error?.message, 'PING_FAILED') };
      }
      if (!fullInjectionAttempted) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            files: FRAME_CONTENT_FILES,
          });
          fullInjectionAttempted = true;
        } catch (injectError) {
          return { ok: false, error: formatDetail(injectError?.message, 'INJECT_FAILED') };
        }
      }
    }

    await delay(FRAME_RECEIVER_BASE_DELAY_MS * attempt);
  }

  return { ok: false, error: APPLY_FAILURE_REASONS.NO_RECEIVER };
}

export async function sendScopeTokenMessage(tabId, action, payload = {}, options = {}) {
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

export async function runScopedScript(tabId, func, args = [], options = {}) {
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

export async function probeFrames(tabId) {
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

export function pickBestFrame(candidates = []) {
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

export function shouldAttemptFrameFallback(result = {}, source = '', frameId = 0) {
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

export async function verifyScopeRootBySelectorInPage(tabId, selector, options = {}) {
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

function clampString(value, max = 120) {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.slice(0, max);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeStringList(values, maxItems = 12) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value) => typeof value === 'string')
    .slice(0, maxItems)
    .map((value) => value.slice(0, 80));
}

function sanitizeInspectionCheck(check = {}) {
  if (!check || typeof check !== 'object') {
    return null;
  }
  const sanitized = {
    code: clampString(check.code, 80) || 'UNKNOWN_CHECK',
    passed: check.passed === true,
  };
  for (const key of ['expected', 'missing', 'observed', 'baseline', 'threshold', 'nodesScanned', 'hiddenControls']) {
    const value = finiteNumber(check[key]);
    if (value !== undefined) {
      sanitized[key] = value;
    } else if (check[key] === null && key === 'baseline') {
      sanitized[key] = null;
    }
  }
  return sanitized;
}

function sanitizeInspectionResult(response = {}, source) {
  const scope = response?.scope && typeof response.scope === 'object' ? response.scope : {};
  const stats = response?.stats && typeof response.stats === 'object' ? response.stats : {};
  const checks = Array.isArray(response?.checks)
    ? response.checks.map(sanitizeInspectionCheck).filter(Boolean).slice(0, 16)
    : [];

  const sanitized = {
    ok: response?.ok === true,
    inspected: response?.inspected === true,
    source,
    scope: {
      found: scope.found === true,
      connected: scope.connected === true,
      visible: scope.visible === true,
      owned: scope.owned === true,
      tag: clampString(scope.tag, 32) || '',
      role: clampString(scope.role, 64) || '',
      fingerprint: clampString(scope.fingerprint, 64) || '',
    },
    checks,
    blockingFailures: sanitizeStringList(response?.blockingFailures),
    warnings: sanitizeStringList(response?.warnings),
    stats: {
      nodesScanned: finiteNumber(stats.nodesScanned) ?? 0,
      elapsedMs: finiteNumber(stats.elapsedMs) ?? 0,
      budgetHit: stats.budgetHit === true,
    },
  };

  const error = clampString(response?.error, 120);
  const reason = clampString(response?.reason, 120);
  const detail = clampString(response?.detail, 240);
  if (error) {
    sanitized.error = error;
  }
  if (reason) {
    sanitized.reason = reason;
  }
  if (detail) {
    sanitized.detail = detail;
  }
  return sanitized;
}

function sanitizeVisualSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const snapshot = {};
  for (const key of ['backgroundColor', 'surfaceColor', 'textColor', 'linkColor', 'mutedTextColor']) {
    const sanitized = clampString(value[key], 64);
    if (sanitized) {
      snapshot[key] = sanitized;
    }
  }
  snapshot.prefersColorScheme = value.prefersColorScheme === 'dark' ? 'dark' : 'light';
  return snapshot;
}

function sanitizeBaselineResult(response = {}, source) {
  const baseline = response?.baseline && typeof response.baseline === 'object' ? response.baseline : {};
  const stats = response?.stats && typeof response.stats === 'object' ? response.stats : {};
  const visualSnapshot = sanitizeVisualSnapshot(baseline.visualSnapshot);
  const sanitized = {
    ok: response?.ok === true,
    source,
    baseline: {
      horizontalOverflow: finiteNumber(baseline.horizontalOverflow) ?? 0,
    },
    stats: {
      elapsedMs: finiteNumber(stats.elapsedMs) ?? 0,
      budgetHit: stats.budgetHit === true,
    },
  };
  if (visualSnapshot) {
    sanitized.baseline.visualSnapshot = visualSnapshot;
  }
  const error = clampString(response?.error, 120);
  const reason = clampString(response?.reason, 120);
  const detail = clampString(response?.detail, 240);
  if (error) {
    sanitized.error = error;
  }
  if (reason) {
    sanitized.reason = reason;
  }
  if (detail) {
    sanitized.detail = detail;
  }
  return sanitized;
}

export async function collectScopedV2InspectionBaselineInPage(tabId, options = {}) {
  const source = 'postApplyBaseline';
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const payload = {
    scopeSelector: typeof options?.scopeSelector === 'string' ? options.scopeSelector : '',
    ownerKey: typeof options?.ownerKey === 'string' ? options.ownerKey : '',
    budget: options?.budget && typeof options.budget === 'object' ? options.budget : null,
  };

  const response = await runScopedScript(
    tabId,
    (baselineOptions) => {
      const module = globalThis.AURA_MODE_ENGINE_SCOPED_V2;
      if (!module) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-runtime-missing' };
      }
      const collectInspectionBaseline = module.collectInspectionBaseline;
      if (typeof collectInspectionBaseline !== 'function') {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'collectInspectionBaseline missing' };
      }
      try {
        const result = collectInspectionBaseline(baselineOptions);
        if (!result || typeof result !== 'object') {
          return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result' };
        }
        return result;
      } catch (error) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: error?.message || 'collectInspectionBaseline failed' };
      }
    },
    [payload],
    { world: 'ISOLATED', frameId },
  );

  if (!response || typeof response !== 'object') {
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: 'bad-result', source };
  }

  if (response.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
    return { ...response, source };
  }

  return sanitizeBaselineResult(response, source);
}

export async function inspectScopedV2PostApplyInPage(tabId, options = {}) {
  const source = 'postApplyInspection';
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const payload = {
    scopeSelector: typeof options?.scopeSelector === 'string' ? options.scopeSelector : '',
    ownerKey: typeof options?.ownerKey === 'string' ? options.ownerKey : '',
    tokenKeys: Array.isArray(options?.tokenKeys) ? options.tokenKeys.filter((key) => typeof key === 'string') : [],
    baseline: options?.baseline && typeof options.baseline === 'object' ? options.baseline : null,
    thresholds: options?.thresholds && typeof options.thresholds === 'object' ? options.thresholds : null,
    budget: options?.budget && typeof options.budget === 'object' ? options.budget : null,
  };

  const response = await runScopedScript(
    tabId,
    (inspectionOptions) => {
      const module = globalThis.AURA_MODE_ENGINE_SCOPED_V2;
      if (!module) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'scoped-runtime-missing' };
      }
      const inspectPostApply = module.inspectPostApply;
      if (typeof inspectPostApply !== 'function') {
        return { ok: false, error: 'INTERNAL_ERROR', detail: 'inspectPostApply missing' };
      }
      try {
        const result = inspectPostApply(inspectionOptions);
        if (!result || typeof result !== 'object') {
          return { ok: false, error: 'INTERNAL_ERROR', detail: 'bad-result' };
        }
        return result;
      } catch (error) {
        return { ok: false, error: 'INTERNAL_ERROR', detail: error?.message || 'inspectPostApply failed' };
      }
    },
    [payload],
    { world: 'ISOLATED', frameId },
  );

  if (!response || typeof response !== 'object') {
    return { ok: false, error: APPLY_FAILURE_REASONS.INTERNAL_ERROR, detail: 'bad-result', source };
  }

  if (response.error === APPLY_FAILURE_REASONS.NO_RECEIVER) {
    return { ...response, source };
  }

  return sanitizeInspectionResult(response, source);
}

export async function salvageScopeRootBySelectorInPage(tabId, selector, options = {}) {
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

export async function ensureScopeRootMarked(tabId, scopeSelectorFinal, options = {}) {
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

export function isNonTrivialScope(scopeKey = '') {
  const normalized = `${scopeKey}`.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === 'body' || normalized === 'html') {
    return false;
  }

  return !normalized.startsWith('body:');
}
