import {
  ACTIONS,
  FOCUS_CSS_TEMPLATE_PATH,
  FOCUS_SCOPE_PLACEHOLDER,
  MODE_IDS,
  SMARTSCOPE_ACTIONS,
  SMARTSCOPE_LEVELS,
} from '../shared/constants.js';
import { MODE_ENGINE_SCOPE_SELECTOR } from '../shared/mode-engine-scoped-v2.js';
import {
  STRICT_VARIANT,
  buildSmartScopePatchCSS,
} from './mode-css-builders.js';
import { smartScopeDebugger } from './smartscope-debugger.js';
import { insertModeCssSafely } from './mode-engine-css.js';
import { contentBridge } from './content-bridge.js';
import {
  isTrivialScope,
  materializeScopedCss as materializeScopedCssImpl,
  validateScopedCss as validateScopedCssImpl,
} from './css-guardrails.js';
import { getComfortVisualPrefsFromStorage } from './scoped-v2-css-lifecycle.js';
import { getPerDomainModePrefs } from './mode-engine-apply-prefs.js';
import { APPLY_FAILURE_REASONS } from './apply-failure-reasons.js';
import { isNonTrivialScope, sendScopeTokenMessage } from './scoped-v2-page-bridge.js';

const SMARTSCOPE_TIMEOUT_MS = 60;
const fallbackPerformanceMonitor = {
  measureHeapDelta: async (fn) => fn(),
  measureLatency: async (fn) => fn(),
};

let focusCssTemplateCache = null;
let focusCssTemplatePromise = null;

export async function loadFocusCssTemplate() {
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

function normalizeScopedFocusSelector(scopeSelector) {
  const normalized = typeof scopeSelector === 'string' ? scopeSelector.trim() : '';
  if (!normalized || normalized === '.aura-scope') {
    return MODE_ENGINE_SCOPE_SELECTOR;
  }
  return normalized;
}

export function materializeScopedCss(template, scopeSelector) {
  const normalizedScope = normalizeScopedFocusSelector(scopeSelector);
  return materializeScopedCssImpl(template, normalizedScope);
}

export function validateScopedCss(cssText, scopeSelector) {
  const normalizedScope = normalizeScopedFocusSelector(scopeSelector);
  if (cssText.includes(FOCUS_SCOPE_PLACEHOLDER)) {
    return { ok: false, reason: 'unresolved-placeholder' };
  }

  if (isTrivialScope(normalizedScope)) {
    return { ok: false, reason: 'trivial-scope' };
  }

  return validateScopedCssImpl(cssText, normalizedScope);
}

export async function applyWithSmartScope(
  tabId,
  modeId,
  intensity,
  config,
  siteKey,
  origin,
  registry,
  monitor = fallbackPerformanceMonitor,
  options = {},
) {
  const frameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
  const removalTarget = typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId };
  const comfortPrefs = modeId === MODE_IDS.COMFORT_VISUAL ? await getComfortVisualPrefsFromStorage() : null;
  const perDomainModePrefs =
    modeId === MODE_IDS.COMFORT_VISUAL ? await getPerDomainModePrefs(siteKey, modeId) : null;
  const effectiveComfortPrefs =
    perDomainModePrefs?.darkMode === false && comfortPrefs
      ? { ...comfortPrefs, darkMode: false }
      : comfortPrefs;
  const darkModeEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? effectiveComfortPrefs?.darkMode === true
      : true;
  const textScaleEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? effectiveComfortPrefs?.textScale !== false
      : true;
  const spacingPackEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? effectiveComfortPrefs?.spacingPack !== false
      : true;
  const linkEnhanceEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? effectiveComfortPrefs?.linkEnhance !== false
      : false;
  const typoSmoothingEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? effectiveComfortPrefs?.typoSmoothing !== false
      : true;
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
    const cssText = buildSmartScopePatchCSS(modeId, intensity, variant, {
      darkModeEnabled,
      textScaleEnabled,
      spacingPackEnabled,
      linkEnhanceEnabled,
      typoSmoothingEnabled,
    });
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
        darkModeEnabled,
        textScaleEnabled,
        spacingPackEnabled,
        linkEnhanceEnabled,
        typoSmoothingEnabled,
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
          darkModeEnabled,
          textScaleEnabled,
          spacingPackEnabled,
          linkEnhanceEnabled,
          typoSmoothingEnabled,
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

export async function verifyComputedStyles(tabId, modeId, variant, options = {}) {
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

export function getChecksForVariant(modeId, variant, scopeSelector = 'body') {
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
