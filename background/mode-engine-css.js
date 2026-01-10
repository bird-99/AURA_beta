import { isFlagEnabled } from '../shared/feature-flags.js';
import { guardCss, DEFAULT_SCOPE } from '../shared/mode-engine-css-guard.js';
import { getModeEngineDebugPrefix, modeEngineLog, recordModeEngineMetric } from '../shared/mode-engine-debug.js';

const MAX_REASONS_TO_LOG = 5;
const EMPTY_INPUT = { code: 'EMPTY_INPUT', message: 'CSS text is empty' };
const SENTINELS = Object.freeze({
  scopedV2: `${DEFAULT_SCOPE} { --aura-me2-path: scoped-v2; --aura-me2-css: "applied"; }`,
});

function maybeWrapWithSentinel(cssText, { path, debugEnabled }) {
  if (!debugEnabled) {
    return cssText;
  }

  if (path === 'scoped-v2') {
    return `${SENTINELS.scopedV2}\n${cssText}`;
  }

  return cssText;
}

function emitGuardrailsDiagnostics({ guardResult, origin, modeId, cssTextLength, debugEnabled }) {
  if (!debugEnabled || !guardResult) {
    return;
  }

  const stats = guardResult.stats || {};
  const selectorsRewritten = stats.selectorsRewritten ?? 0;
  const declarationsBlocked = stats.declarationsBlocked ?? 0;
  const atRulesBlocked = stats.atRulesBlocked ?? 0;
  const elapsedMs = stats.elapsedMs;
  const reasons = guardResult.reasons || [];
  const reasonsToLog = reasons.slice(0, MAX_REASONS_TO_LOG);
  const tags = { origin, modeId };
  const accepted = Boolean(guardResult.ok && cssTextLength);

  modeEngineLog(`Guard ${accepted ? 'ACCEPT' : 'REJECT'}`, {
    origin,
    modeId,
    elapsedMs,
    selectorsRewritten,
    declarationsBlocked,
    atRulesBlocked,
    cssLength: cssTextLength,
    reasons: reasonsToLog,
    totalReasons: reasons.length,
  });

  recordModeEngineMetric(accepted ? 'modeengine.guardrails.accepted' : 'modeengine.guardrails.rejected', 1, tags);
  recordModeEngineMetric('modeengine.guardrails.rewrittenSelectors', selectorsRewritten, tags);
  recordModeEngineMetric('modeengine.guardrails.blockedDecls', declarationsBlocked, tags);
  recordModeEngineMetric('modeengine.guardrails.atRulesBlocked', atRulesBlocked, tags);
  if (elapsedMs !== undefined) {
    recordModeEngineMetric('modeengine.guardrails.elapsedMs', elapsedMs, tags);
  }
}

function buildTarget({ tabId, frameId, frameIds }) {
  const target = { tabId };
  if (Array.isArray(frameIds) && frameIds.length > 0) {
    target.frameIds = frameIds;
  } else if (typeof frameId === 'number') {
    target.frameIds = [frameId];
  }
  return target;
}

export async function insertModeCssSafely({
  tabId,
  frameId,
  frameIds,
  cssText,
  origin,
  modeId,
  forceGuard = false,
  scopeSelector = DEFAULT_SCOPE,
  modeEnginePath = null,
}) {
  const guardrailsEnabled = forceGuard || isFlagEnabled('modeEngineCssGuardrails');
  const debugEnabled = isFlagEnabled('debugModeEngine');
  const target = buildTarget({ tabId, frameId, frameIds });
  let guardResult = null;
  let finalCssText = cssText || '';

  if (!finalCssText.trim()) {
    return { ok: false, injected: false, guarded: guardrailsEnabled, reasons: [EMPTY_INPUT] };
  }

  if (guardrailsEnabled) {
    guardResult = guardCss({ cssText, scopeSelector, modeId, debug: debugEnabled });
    finalCssText = guardResult.cssText || '';

    emitGuardrailsDiagnostics({
      guardResult,
      origin,
      modeId,
      cssTextLength: finalCssText.length,
      debugEnabled,
    });

    if (!guardResult.ok || !finalCssText.trim()) {
      return {
        ok: false,
        injected: false,
        guarded: true,
        guardResult,
        reasons: guardResult?.reasons || [],
      };
    }
  }

  finalCssText = maybeWrapWithSentinel(finalCssText, { path: modeEnginePath, debugEnabled });

  if (debugEnabled && modeEnginePath) {
    modeEngineLog(`apply path=${modeEnginePath}`, { modeId, origin: origin || 'AUTHOR' });
  }

  try {
    await chrome.scripting.insertCSS({ target, css: finalCssText, origin });
    return { ok: true, injected: true, guarded: guardrailsEnabled, cssText: finalCssText, guardResult };
  } catch (error) {
    if (debugEnabled) {
      console.warn(`${getModeEngineDebugPrefix()} insertCSS failed`, error);
    }
    return {
      ok: false,
      injected: false,
      guarded: guardrailsEnabled,
      guardResult,
      error,
      reasons: [{ code: 'INJECT_ERROR', message: error?.message || 'insertCSS failed' }],
    };
  }
}

export async function insertModeCssRaw({
  tabId,
  frameId,
  frameIds,
  cssText,
  origin,
  modeId,
}) {
  const debugEnabled = isFlagEnabled('debugModeEngine');
  const target = buildTarget({ tabId, frameId, frameIds });
  const finalCssText = cssText || '';

  if (!finalCssText.trim()) {
    return { ok: false, injected: false, reasons: [EMPTY_INPUT] };
  }

  if (debugEnabled) {
    modeEngineLog('insert raw css', { modeId, origin: origin || 'AUTHOR' });
  }

  try {
    await chrome.scripting.insertCSS({ target, css: finalCssText, origin });
    return { ok: true, injected: true, cssText: finalCssText };
  } catch (error) {
    if (debugEnabled) {
      console.warn(`${getModeEngineDebugPrefix()} insertCSS raw failed`, error);
    }
    return {
      ok: false,
      injected: false,
      error,
      reasons: [{ code: 'INJECT_ERROR', message: error?.message || 'insertCSS failed' }],
    };
  }
}

export async function removeModeCssRaw({
  tabId,
  frameId,
  frameIds,
  cssText,
  origin,
}) {
  const debugEnabled = isFlagEnabled('debugModeEngine');
  const target = buildTarget({ tabId, frameId, frameIds });
  const finalCssText = cssText || '';

  if (!finalCssText.trim()) {
    return { ok: false, removed: false, error: EMPTY_INPUT };
  }

  if (debugEnabled) {
    modeEngineLog('remove raw css', { origin: origin || 'AUTHOR' });
  }

  try {
    await chrome.scripting.removeCSS({ target, css: finalCssText, origin });
    return { ok: true, removed: true };
  } catch (error) {
    if (debugEnabled) {
      console.warn(`${getModeEngineDebugPrefix()} removeCSS raw failed`, error);
    }
    return { ok: false, removed: false, error };
  }
}
