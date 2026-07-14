import {
  ACTIONS,
  ACTIVE_QUALITIES,
  MODE_IDS,
  SMARTSCOPE_ACTIONS,
  STATES,
  STORAGE_KEYS,
} from '../shared/constants.js';
import { extractDomain, getFromLocal, isValidTabId } from '../shared/utils.js';
import { isFlagEnabled } from '../shared/feature-flags.js';
import {
  MODE_ENGINE_SCOPE_SELECTOR,
  buildScopedModeCssV2,
  computeTokensV2,
  SCOPE_OWNER_VALUE,
  makeScopedV2Key,
} from '../shared/mode-engine-scoped-v2.js';
import { cssRegistry } from './css-registry.js';
import { stateManager } from './state-manager.js';
import { performanceMonitor } from './degraded-manager.js';
import { smartScopeDebugger } from './smartscope-debugger.js';
import { insertModeCssRaw, insertModeCssSafely } from './mode-engine-css.js';
import { recordModeEngineMetric, modeEngineLog } from '../shared/mode-engine-debug.js';
import { getTabRuntime, patchTabRuntime } from './runtime-state.js';
import { recordApplyOutcome } from './site-policy-manager.js';
import { contentBridge } from './content-bridge.js';
import {
  STRICT_VARIANT,
  buildComfortCss,
  buildFocusCss,
  buildModeCss,
  buildComfortEmergencyReflowGuardTokenOverrides,
  buildComfortVisualTokenOverrides,
  buildSmartScopePatchCSS,
  COMFORT_DARK_GUARD_TOKENS,
  COMFORT_DARK_RETRY_TOKENS,
  COMFORT_LIGHT_GUARD_TOKENS,
  COMFORT_LIGHT_RETRY_TOKENS,
  getSmoothTransitionSettings,
  isComfortDarkModeEnabled,
} from './mode-css-builders.js';
import {
  applyPreludeCss as applyPreludeCssLifecycle,
  ensureTransitionsCss as ensureTransitionsCssLifecycle,
  getComfortVisualPrefsFromStorage,
  removePreludeCss as removePreludeCssLifecycle,
  removeTransitionsCss as removeTransitionsCssLifecycle,
} from './scoped-v2-css-lifecycle.js';
import {
  getIntensityForSite,
  getPerDomainModePrefs,
  getSmartScopeConfig,
} from './mode-engine-apply-prefs.js';
import {
  buildSiteBlockedResult,
  classifyApplyFailureForPolicy,
  formatDetail,
  getSiteKey,
  recordV2Metric,
  resolveSitePolicy,
  resolveUrlKey,
} from './mode-engine-apply-policy.js';
import {
  applyWithSmartScope,
  loadFocusCssTemplate,
  materializeScopedCss,
  validateScopedCss,
} from './smartscope-v1-apply.js';
import {
  rememberResolvedScopedV2Scope,
  resolveScopedV2Scope,
} from './scoped-v2-scope-resolver.js';
import { APPLY_FAILURE_REASONS } from './apply-failure-reasons.js';
import {
  ensureContentInFrame,
  collectScopedV2InspectionBaselineInPage,
  inspectScopedV2PostApplyInPage,
  isNonTrivialScope,
  pickBestFrame,
  probeFrames,
  sendScopeTokenMessage,
  shouldAttemptFrameFallback,
} from './scoped-v2-page-bridge.js';
import {
  applyScopedModeV2,
  getScopedModeV2State,
  scopedV2InFlightKeyToString,
} from './scoped-v2-state.js';
import { removeScopedModeV2 } from './scoped-v2-cleanup.js';
import {
  advanceScopedV2Transaction,
  beginScopedV2Transaction,
  completeScopedV2Transaction,
  SCOPED_V2_TRANSACTION_PHASES,
} from './scoped-v2-transaction-ledger.js';
import { templateEvidenceForFrame } from './template-evidence.js';
import {
  beginLifecycleIntent,
  claimLifecycleIntent,
  finishLifecycleIntent,
  markLifecycleArtifactDone,
  recordLifecycleArtifactBeforeEffect,
} from './lifecycle-controller.js';
import { LIFECYCLE_OPERATION_KINDS } from './lifecycle-operation-journal.js';
import { cleanupLifecycleArtifacts } from './lifecycle-recovery.js';
import {
  GLOBAL_SAFE_FALLBACK_VARIANT,
  shouldApplyFocusLimitedFallback,
  shouldApplyGlobalSafeFallback,
} from './global-safe-fallback-policy.js';
import {
  SAFE_DOWNGRADE_CSS_REASONS,
  buildSafeDowngradeCss,
} from './safe-downgrade-css.js';
import {
  PAGE_CLARITY_CSS_REASONS,
  PAGE_CLARITY_SCOPE,
  buildPageClarityCssV1,
} from './page-clarity-css.js';
import {
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  PAGE_TYPES,
  RUNTIME_EXECUTORS,
  TARGET_KINDS,
  desiredEffectForActionTargetV1,
  evaluateRuntimeCapabilityV1,
  getGuaranteedEffectV1,
  targetKindForPageType,
  validateRuntimeEffectPlanV1,
} from '../shared/engine-core/index.js';
import { buildDarkComfortThemeApplyRequestV1 } from './dark-comfort-theme-executor.js';
import {
  buildDarkComfortThemePaletteV1,
  buildDarkComfortThemeTokenMap,
} from './dark-comfort-theme-css.js';

export { applyScopedModeV2, getScopedModeV2State, removeScopedModeV2 };
export { buildManualDarkComfortThemeRequest };
export {
  applyPreludeCss,
  ensureTransitionsCss,
  getComfortVisualPrefsFromStorage,
  removePreludeCss,
  removeTransitionsCss,
} from './scoped-v2-css-lifecycle.js';

const CSS_ORIGIN = 'AUTHOR';
const DARK_COMFORT_FRAME_RUNTIME_FILES = Object.freeze([
  'content/mode-engine-scoped-v2.runtime.js',
  'content/dark-comfort-theme.runtime.js',
]);
const PAGE_CLARITY_LIMITED_VARIANT = 'PAGE_CLARITY_LIMITED';
const PAGE_CLARITY_MEDIUM_VARIANT = 'PAGE_CLARITY_MEDIUM';
const PAGE_CLARITY_MIN_VISIBLE_EFFECT_SCORE = 0.5;
const COMFORT_READING_RUNTIME_NOT_ALLOWED = 'COMFORT_READING_RUNTIME_NOT_ALLOWED';
const COMFORT_READING_PAGE_TYPES = new Set(['ARTICLE', 'DOC']);
const REFLOW_GUARD_LAYOUT_FAILURE_CODES = new Set([
  'NO_HORIZONTAL_SCROLL_REGRESSION',
  'NO_CLIPPED_TEXT',
]);

function normalizeRefreshCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.min(20, Math.floor(numeric));
}

async function getGlobalReduceMotionPreference() {
  if (!globalThis.chrome?.storage?.local?.get) {
    return false;
  }

  try {
    const userPrefs = await getFromLocal(STORAGE_KEYS.USER_PREFS);
    return userPrefs?.reducedMotion === true;
  } catch (_) {
    return false;
  }
}

const SCOPED_MODE_OWNER_KEY = SCOPE_OWNER_VALUE;
const CONTRAST_GUARD_THRESHOLD = 4.5;
const inFlightApplyByTab = new Map();
let lastAttemptId = 0;

function shouldQueueScopedV2Apply(params = {}) {
  return (
    params?.forceReapply === true
    || (typeof params?.reapplyReason === 'string'
      && (params.reapplyReason.startsWith('prefs:') || params.reapplyReason.includes(':prefs:')))
  );
}

function hasComfortSpacingCssRules(cssText = '') {
  const normalized = typeof cssText === 'string' ? cssText : '';
  return (
    /line-height:\s*var\(--aura-line-height/i.test(normalized)
    || /p\s*\+\s*p\s*\{\s*margin-top:\s*var\(--aura-paragraph-spacing/i.test(normalized)
  );
}

function hasComfortTextScaleCssRules(cssText = '') {
  const normalized = typeof cssText === 'string' ? cssText : '';
  return /font-size:\s*var\(--aura-font-size/i.test(normalized);
}

function hasComfortLinkEnhanceCssRules(cssText = '') {
  const normalized = typeof cssText === 'string' ? cssText : '';
  return /text-decoration-line:\s*var\(--aura-link-decoration/i.test(normalized);
}

function hasComfortLinkColorCssRules(cssText = '') {
  const normalized = typeof cssText === 'string' ? cssText : '';
  return /color:\s*var\(--aura-link-color/i.test(normalized);
}

function hasComfortTextRenderingCssRules(cssText = '') {
  const normalized = typeof cssText === 'string' ? cssText : '';
  return (
    /-webkit-font-smoothing:\s*var\(--aura-font-smoothing/i.test(normalized)
    || /text-rendering:\s*optimizeLegibility/i.test(normalized)
    || /font-kerning:\s*normal/i.test(normalized)
    || /word-spacing:\s*0\.02em/i.test(normalized)
    || /letter-spacing:\s*var\(--aura-letter-spacing/i.test(normalized)
  );
}

function hasLinkColorOverrides(overrides = null) {
  return Boolean(
    overrides
      && (
        Object.prototype.hasOwnProperty.call(overrides, '--aura-link-color')
        || Object.prototype.hasOwnProperty.call(overrides, '--aura-link-visited-color')
        || Object.prototype.hasOwnProperty.call(overrides, '--aura-link-hover-color')
      ),
  );
}

function getComfortLinkCssOptions(modeId, comfortPrefs, modePrefs, retryOverrides = null) {
  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return {
      linkEnhanceEnabled: true,
      linkColorEnabled: true,
    };
  }

  return {
    linkEnhanceEnabled: comfortPrefs?.linkEnhance !== false,
    linkColorEnabled:
      isComfortDarkModeEnabled({ comfortPrefs })
      || modePrefs?.contrastGuard === true
      || hasLinkColorOverrides(retryOverrides),
  };
}

function getComfortTextRenderingCssOptions(modeId, comfortPrefs) {
  return {
    typoSmoothingEnabled: modeId !== MODE_IDS.COMFORT_VISUAL || comfortPrefs?.typoSmoothing !== false,
  };
}

function sanitizeRuntimeEffectPlan(plan) {
  if (!plan) {
    return { ok: true, plan: null };
  }

  const validation = validateRuntimeEffectPlanV1(plan);
  if (!validation.ok) {
    return {
      ok: false,
      plan: null,
      reason: SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN,
    };
  }

  const matrixRow = getGuaranteedEffectV1(plan.modeId, plan.pageType);
  if (
    !matrixRow
    || matrixRow.version !== plan.matrixVersion
    || matrixRow.strongEffect !== plan.strongEffect
    || matrixRow.safeDowngrade !== plan.safeDowngrade
    || matrixRow.readerAllowed !== plan.readerAllowed
    || matrixRow.overrideAllowed !== plan.overrideAllowed
    || matrixRow.overrideScope !== plan.overrideScope
    || JSON.stringify(matrixRow.postChecks) !== JSON.stringify(plan.postChecks)
  ) {
    return {
      ok: false,
      plan: null,
      reason: SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN,
    };
  }

  return {
    ok: true,
    plan: {
      version: plan.version,
      matrixVersion: plan.matrixVersion,
      modeId: plan.modeId,
      actionId: plan.actionId,
      pageType: plan.pageType,
      frameId: plan.frameId,
      strongEffect: plan.strongEffect,
      safeDowngrade: plan.safeDowngrade,
      readerAllowed: plan.readerAllowed === true,
      overrideAllowed: plan.overrideAllowed === true,
      overrideScope: plan.overrideScope,
      postChecks: [...plan.postChecks],
      policyDecision: plan.policyDecision,
      confidence: plan.confidence,
      v3LightShadow: plan.v3LightShadow
        ? {
            version: plan.v3LightShadow.version,
            actionId: plan.v3LightShadow.actionId,
            desiredEffect: plan.v3LightShadow.desiredEffect,
            targetKind: plan.v3LightShadow.targetKind,
            effectClass: plan.v3LightShadow.effectClass,
            sourceBlockId: plan.v3LightShadow.sourceBlockId,
            regionId: plan.v3LightShadow.regionId,
            collectionEpoch: plan.v3LightShadow.collectionEpoch,
            routeEpoch: plan.v3LightShadow.routeEpoch,
            capabilityStatus: plan.v3LightShadow.capabilityStatus,
            supportLevel: plan.v3LightShadow.supportLevel,
            executor: plan.v3LightShadow.executor,
            activePlanAllowed: plan.v3LightShadow.activePlanAllowed,
            actionTargetDecisionHint: plan.v3LightShadow.actionTargetDecisionHint,
            actionTargetConfidence: plan.v3LightShadow.actionTargetConfidence,
            shadowOnly: plan.v3LightShadow.shadowOnly === true,
          }
        : undefined,
    },
  };
}

function buildGlobalSafeFallbackCss(modeId, intensity = 1, comfortPrefs = null, options = {}) {
  const normalized = Math.min(Math.max(Number.isFinite(intensity) ? intensity : 1, 0), 1);
  const lineHeight = (1.52 + normalized * 0.06).toFixed(2);
  const underlineThickness = (0.07 + normalized * 0.02).toFixed(2);
  const spacingPackEnabled = modeId !== MODE_IDS.COMFORT_VISUAL || comfortPrefs?.spacingPack !== false;
  const linkEnhanceEnabled = modeId !== MODE_IDS.COMFORT_VISUAL || comfortPrefs?.linkEnhance !== false;
  const typoSmoothingEnabled = modeId !== MODE_IDS.COMFORT_VISUAL || comfortPrefs?.typoSmoothing !== false;
  const darkModeEnabled = modeId === MODE_IDS.COMFORT_VISUAL && comfortPrefs?.darkMode === true;
  const darkPalette = darkModeEnabled
    ? options?.darkPalette || buildDarkComfortThemePaletteV1(options?.visualSnapshot || {})
    : null;
  const darkDesignSystemTokenDeclarations = darkPalette
    ? [
        ['--background', darkPalette.background],
        ['--foreground', darkPalette.text],
        ['--card', darkPalette.surface],
        ['--card-foreground', darkPalette.text],
        ['--popover', darkPalette.surface],
        ['--popover-foreground', darkPalette.text],
        ['--primary', darkPalette.link],
        ['--primary-foreground', darkPalette.background],
        ['--secondary', darkPalette.controls],
        ['--secondary-foreground', darkPalette.text],
        ['--muted', darkPalette.controls],
        ['--muted-foreground', darkPalette.mutedText],
        ['--accent', darkPalette.controls],
        ['--accent-foreground', darkPalette.text],
        ['--border', darkPalette.border],
        ['--input', darkPalette.border],
        ['--ring', darkPalette.focusRing],
        ['--color-background', darkPalette.background],
        ['--color-foreground', darkPalette.text],
        ['--color-surface', darkPalette.surface],
        ['--color-surface-2', darkPalette.controls],
        ['--color-text', darkPalette.text],
        ['--color-muted', darkPalette.mutedText],
        ['--color-border', darkPalette.border],
        ['--color-link', darkPalette.link],
        ['--bs-body-bg', darkPalette.background],
        ['--bs-body-color', darkPalette.text],
        ['--bs-border-color', darkPalette.border],
        ['--bs-link-color', darkPalette.link],
        ['--bs-link-hover-color', darkPalette.linkHover],
        ['--bs-secondary-bg', darkPalette.controls],
        ['--bs-tertiary-bg', darkPalette.surface],
        ['--bs-emphasis-color', darkPalette.text],
        ['--md-sys-color-background', darkPalette.background],
        ['--md-sys-color-on-background', darkPalette.text],
        ['--md-sys-color-surface', darkPalette.surface],
        ['--md-sys-color-surface-container', darkPalette.surface],
        ['--md-sys-color-surface-container-high', darkPalette.controls],
        ['--md-sys-color-on-surface', darkPalette.text],
        ['--md-sys-color-outline', darkPalette.border],
        ['--md-sys-color-primary', darkPalette.link],
        ['--md-sys-color-on-primary', darkPalette.background],
        ['--bgColor-default', darkPalette.background],
        ['--bgColor-muted', darkPalette.surface],
        ['--fgColor-default', darkPalette.text],
        ['--fgColor-muted', darkPalette.mutedText],
        ['--borderColor-default', darkPalette.border],
        ['--color-canvas-default', darkPalette.background],
        ['--color-canvas-subtle', darkPalette.surface],
        ['--color-fg-default', darkPalette.text],
        ['--color-fg-muted', darkPalette.mutedText],
        ['--color-border-default', darkPalette.border],
        ['--color-accent-fg', darkPalette.link],
      ].map(([name, value]) => `${name}: ${value} !important;`).join('\n      ')
    : '';
  const darkDesignSystemLocalTokenSelector =
    ':where(dialog, [popover], [aria-modal="true"], [data-theme], [data-color-mode], [data-bs-theme], [data-mui-color-scheme], [data-surface], [data-card], [data-panel], [data-dialog], [data-popover], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="card" i], [class*="panel" i], [class*="surface" i], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="menu" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"], [role="tabpanel"])';
  const mediaBackgroundExclusion = ':not([data-aura-bg-media="1"]):not([data-aura-bg-text-gradient="1"])';
  const wikiSurfaceSelector = [
    'body #mw-page-base',
    'body .mw-page-base',
    'body #mw-navigation',
    'body .mw-body',
    'body .mw-parser-output',
    'body .vector-header-container',
    'body .vector-page-toolbar',
    'body .vector-page-titlebar',
    'body .vector-page-container',
    'body .vector-toc',
    'body .vector-menu',
    'body .vector-menu-content',
    'body .mw-portlet',
    'body .portal',
    'body #wiki-infobox',
    'body .infobox',
    'body .toc',
    'body .thumbinner',
    'body .wikitable',
    'body .navbox',
    'body .metadata',
    'body .ambox',
  ].map((selector) => `${selector}${mediaBackgroundExclusion}`).join(',\n    ');
  const protectedVisualExclusion =
    ':not(:is(img, video, canvas, svg, svg *, picture, picture *, iframe, audio, object, embed, [data-aura-bg-media="1"], [data-aura-bg-text-gradient="1"]))';
  const darkThemeBlock = darkPalette
    ? `
    html {
      --aura-color-scheme: dark;
      --aura-bg-color: ${darkPalette.background};
      --aura-text-color: ${darkPalette.text};
      --aura-muted-text-color: ${darkPalette.mutedText};
      --aura-border-color: ${darkPalette.border};
      --aura-surface-1: ${darkPalette.surface};
      --aura-surface-2: ${darkPalette.controls};
      --aura-link-color: ${darkPalette.link};
      --aura-link-visited-color: ${darkPalette.linkVisited};
      --aura-link-hover-color: ${darkPalette.linkHover};
      --aura-focus-color: ${darkPalette.focusRing};
      color-scheme: dark !important;
      background-color: ${darkPalette.background} !important;
      scrollbar-color: ${darkPalette.mutedText} ${darkPalette.background};
    }
    html,
    body {
      ${darkDesignSystemTokenDeclarations}
    }
    body ${darkDesignSystemLocalTokenSelector} {
      ${darkDesignSystemTokenDeclarations}
    }
    body {
      color-scheme: dark !important;
      background-color: ${darkPalette.background} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
    }
    body ::selection {
      background-color: #1d4ed8 !important;
      color: #f8fafc !important;
      -webkit-text-fill-color: #f8fafc !important;
    }
    body * {
      scrollbar-color: ${darkPalette.mutedText} ${darkPalette.background};
    }
    body ::-webkit-scrollbar {
      background-color: ${darkPalette.background} !important;
    }
    body ::-webkit-scrollbar-track {
      background-color: ${darkPalette.background} !important;
    }
    body ::-webkit-scrollbar-thumb {
      background-color: rgba(168, 176, 191, 0.55) !important;
      border: 2px solid ${darkPalette.background} !important;
      border-radius: 999px !important;
    }
    body :where(main, article, section, aside, nav, header, footer, form, table, details, summary, fieldset, legend, figure, figcaption, blockquote, dl, dialog, [popover], [role="main"], [role="navigation"], [role="search"], [role="form"], [role="complementary"], [role="contentinfo"], [role="region"], [role="dialog"], [role="alertdialog"], [role="grid"], [role="table"], [role="feed"], [role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="tooltip"], [role="tablist"], [class], [id])${protectedVisualExclusion} {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where(details, summary, fieldset, legend, figure, figcaption, blockquote, dl, dt, dd)${protectedVisualExclusion} {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where([class*="card" i], [class*="panel" i], [class*="modal" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="surface" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [class*="banner" i], [data-surface], [data-card], [data-panel], [data-callout], [popover], [role="dialog"], [role="alertdialog"], [role="tooltip"])::before,
    body :where([class*="card" i], [class*="panel" i], [class*="modal" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="surface" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [class*="banner" i], [data-surface], [data-card], [data-panel], [data-callout], [popover], [role="dialog"], [role="alertdialog"], [role="tooltip"])::after {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where(*)::part(base),
    body :where(*)::part(surface),
    body :where(*)::part(container),
    body :where(*)::part(content),
    body :where(*)::part(panel),
    body :where(*)::part(card),
    body :where(*)::part(dialog),
    body :where(*)::part(popover),
    body :where(*)::part(menu),
    body :where(*)::part(listbox),
    body :where(*)::part(option),
    body :where(*)::part(item),
    body :where(*)::part(body),
    body :where(*)::part(header),
    body :where(*)::part(footer),
    body :where(*)::part(heading),
    body :where(*)::part(label),
    body :where(*)::part(description) {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where(*)::part(button),
    body :where(*)::part(control),
    body :where(*)::part(input),
    body :where(*)::part(textarea),
    body :where(*)::part(select),
    body :where(*)::part(checkbox),
    body :where(*)::part(radio),
    body :where(*)::part(switch),
    body :where(*)::part(thumb),
    body :where(*)::part(track) {
      background-color: ${darkPalette.controls} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
      accent-color: ${darkPalette.focusRing} !important;
    }
    body :is([class*="mw-" i], [class*="vector-" i], [class*="wiki" i], [class*="infobox" i], [class*="toc" i], [class*="thumb" i], [class*="navbox" i], [class*="metadata" i], [class*="ambox" i], [id*="mw-" i], [id*="wiki" i], [id*="infobox" i], [id*="toc" i], [id*="thumb" i], [id*="navbox" i], [id*="metadata" i], [id*="ambox" i])${protectedVisualExclusion} {
      background-color: ${darkPalette.surface} !important;
      background-image: none !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    ${wikiSurfaceSelector} {
      background-color: ${darkPalette.surface} !important;
      background-image: none !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body [data-aura-bg-gradient="1"]:not([data-aura-bg-media="1"]):not([data-aura-bg-text-gradient="1"]) {
      background-image: none !important;
    }
    body :where(blockquote)${protectedVisualExclusion} {
      border-left-color: ${darkPalette.border} !important;
    }
    body :where(hr)${protectedVisualExclusion} {
      background-color: ${darkPalette.border} !important;
      border-color: ${darkPalette.border} !important;
      color: ${darkPalette.border} !important;
      -webkit-text-fill-color: ${darkPalette.border} !important;
    }
    body :where(mark)${protectedVisualExclusion} {
      background-color: #3a2a0a !important;
      color: #fde68a !important;
      -webkit-text-fill-color: #fde68a !important;
    }
    body :where(thead, tbody, tfoot, tr, th, td, caption, [role="rowgroup"], [role="row"], [role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"])${protectedVisualExclusion} {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where(thead, tfoot, th, [role="columnheader"], [role="rowheader"])${protectedVisualExclusion} {
      background-color: ${darkPalette.controls} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], [role="tab"], [role="tabpanel"])${protectedVisualExclusion} {
      background-color: ${darkPalette.surface} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where([role="status"], [aria-live], [data-status], [data-severity], [data-tone], [class*="badge" i], [class*="pill" i], [class*="tag" i])${protectedVisualExclusion} {
      background-color: ${darkPalette.controls} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where([class*="info" i]:not([class*="infobox" i]), [class*="notice" i], [data-status*="info" i], [data-state*="info" i], [data-variant*="info" i], [data-severity*="info" i], [data-tone*="info" i], [data-status*="notice" i], [data-state*="notice" i], [data-variant*="notice" i], [data-severity*="notice" i], [data-tone*="notice" i])${protectedVisualExclusion} {
      background-color: #102a43 !important;
      color: #bfdbfe !important;
      -webkit-text-fill-color: #bfdbfe !important;
      border-color: #60a5fa !important;
    }
    body :where([class*="success" i], [class*="positive" i], [data-status*="success" i], [data-state*="success" i], [data-variant*="success" i], [data-severity*="success" i], [data-tone*="success" i], [data-status*="positive" i], [data-state*="positive" i], [data-variant*="positive" i], [data-severity*="positive" i], [data-tone*="positive" i], [data-status*="ok" i], [data-state*="ok" i], [data-variant*="ok" i], [data-severity*="ok" i], [data-tone*="ok" i])${protectedVisualExclusion} {
      background-color: #0f2e1e !important;
      color: #bbf7d0 !important;
      -webkit-text-fill-color: #bbf7d0 !important;
      border-color: #22c55e !important;
    }
    body :where([class*="warning" i], [class*="warn" i], [class*="caution" i], [data-status*="warning" i], [data-state*="warning" i], [data-variant*="warning" i], [data-severity*="warning" i], [data-tone*="warning" i], [data-status*="warn" i], [data-state*="warn" i], [data-variant*="warn" i], [data-severity*="warn" i], [data-tone*="warn" i], [data-status*="caution" i], [data-state*="caution" i], [data-variant*="caution" i], [data-severity*="caution" i], [data-tone*="caution" i])${protectedVisualExclusion} {
      background-color: #3a2a0a !important;
      color: #fde68a !important;
      -webkit-text-fill-color: #fde68a !important;
      border-color: #f59e0b !important;
    }
    body :where([role="alert"]:not([class*="warning" i]):not([class*="warn" i]):not([class*="caution" i]):not([class*="success" i]):not([class*="positive" i]):not([class*="info" i]):not([class*="notice" i]):not([data-status*="warning" i]):not([data-state*="warning" i]):not([data-variant*="warning" i]):not([data-severity*="warning" i]):not([data-tone*="warning" i]):not([data-status*="success" i]):not([data-state*="success" i]):not([data-variant*="success" i]):not([data-severity*="success" i]):not([data-tone*="success" i]):not([data-status*="info" i]):not([data-state*="info" i]):not([data-variant*="info" i]):not([data-severity*="info" i]):not([data-tone*="info" i]), [class*="error" i], [class*="danger" i], [class*="destructive" i], [data-status*="error" i], [data-state*="error" i], [data-variant*="error" i], [data-severity*="error" i], [data-tone*="error" i], [data-status*="danger" i], [data-state*="danger" i], [data-variant*="danger" i], [data-severity*="danger" i], [data-tone*="danger" i], [data-status*="destructive" i], [data-state*="destructive" i], [data-variant*="destructive" i], [data-severity*="destructive" i], [data-tone*="destructive" i])${protectedVisualExclusion} {
      background-color: #3a1115 !important;
      color: #fecaca !important;
      -webkit-text-fill-color: #fecaca !important;
      border-color: #ef4444 !important;
    }
    body a[href],
    body [role="link"] {
      color: ${darkPalette.link} !important;
      -webkit-text-fill-color: ${darkPalette.link} !important;
    }
    body input,
    body textarea,
    body select,
    body button,
    body option,
    body optgroup,
    body progress,
    body meter {
      background-color: ${darkPalette.controls} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
      accent-color: ${darkPalette.focusRing};
    }
    body input::file-selector-button {
      background-color: ${darkPalette.controls} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
      color-scheme: dark !important;
    }
    body input:-webkit-autofill,
    body textarea:-webkit-autofill,
    body select:-webkit-autofill {
      -webkit-text-fill-color: ${darkPalette.text} !important;
      caret-color: ${darkPalette.text} !important;
      box-shadow: 0 0 0 1000px ${darkPalette.controls} inset !important;
      border-color: ${darkPalette.border} !important;
      color-scheme: dark !important;
    }
    body input::-webkit-search-cancel-button,
    body input::-webkit-calendar-picker-indicator,
    body input::-webkit-inner-spin-button,
    body input::-webkit-outer-spin-button {
      filter: invert(1) brightness(1.35) contrast(0.95);
      opacity: 0.86;
    }
    body :where(progress, meter) {
      accent-color: ${darkPalette.focusRing};
    }
    body :where(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]):focus,
    body :where(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]):focus-visible {
      outline: 2px solid ${darkPalette.focusRing} !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 3px rgba(154, 183, 255, 0.22) !important;
    }
    body :where([aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-checked="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="checked" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i])${protectedVisualExclusion} {
      background-color: #1d2f55 !important;
      color: #dbeafe !important;
      -webkit-text-fill-color: #dbeafe !important;
      border-color: #60a5fa !important;
      accent-color: #93c5fd;
    }
    body a[href]:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]),
    body [role="link"]:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]) {
      color: #dbeafe !important;
      -webkit-text-fill-color: #dbeafe !important;
    }
    body :where(:disabled, [disabled], [aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i])${protectedVisualExclusion} {
      background-color: #101827 !important;
      color: #94a3b8 !important;
      -webkit-text-fill-color: #94a3b8 !important;
      border-color: #475569 !important;
      opacity: 1 !important;
      cursor: not-allowed;
    }
    body a[href]:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]),
    body [role="link"]:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]) {
      color: #94a3b8 !important;
      -webkit-text-fill-color: #94a3b8 !important;
    }
    body :where(input, textarea, select)[aria-invalid="true"] {
      border-color: #ef4444 !important;
      outline-color: #fca5a5 !important;
    }
    body :where(input, textarea)::placeholder {
      color: ${darkPalette.mutedText} !important;
      -webkit-text-fill-color: ${darkPalette.mutedText} !important;
      opacity: 1 !important;
    }
    body pre,
    body code,
    body kbd,
    body samp {
      background-color: ${darkPalette.code} !important;
      color: ${darkPalette.text} !important;
      -webkit-text-fill-color: ${darkPalette.text} !important;
      border-color: ${darkPalette.border} !important;
    }
    body :where(img, video, canvas, picture, iframe, svg) {
      opacity: 1;
    }
    body {
      background-color: var(--aura-bg-color, ${darkPalette.background}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
    }
    body * {
      scrollbar-color: var(--aura-muted-text-color, ${darkPalette.mutedText}) var(--aura-bg-color, ${darkPalette.background});
    }
    body :where(main, article, section, aside, nav, header, footer, form, table, details, summary, fieldset, legend, figure, figcaption, blockquote, dl, dialog, [popover], [role="main"], [role="navigation"], [role="search"], [role="form"], [role="complementary"], [role="contentinfo"], [role="region"], [role="dialog"], [role="alertdialog"], [role="grid"], [role="table"], [role="feed"], [role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="tooltip"], [role="tablist"], [class], [id])${protectedVisualExclusion} {
      background-color: var(--aura-surface-1, ${darkPalette.surface}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body :where(details, summary, fieldset, legend, figure, figcaption, blockquote, dl, dt, dd, thead, tbody, tfoot, tr, th, td, caption, [role="rowgroup"], [role="row"], [role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], [role="tab"], [role="tabpanel"])${protectedVisualExclusion} {
      background-color: var(--aura-surface-1, ${darkPalette.surface}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body a[href],
    body [role="link"] {
      color: var(--aura-link-color, ${darkPalette.link}) !important;
      -webkit-text-fill-color: var(--aura-link-color, ${darkPalette.link}) !important;
    }
    body input,
    body textarea,
    body select,
    body button,
    body option,
    body optgroup,
    body progress,
    body meter {
      background-color: var(--aura-surface-2, ${darkPalette.controls}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
      accent-color: var(--aura-focus-color, ${darkPalette.focusRing});
    }
    body input::file-selector-button {
      background-color: var(--aura-surface-2, ${darkPalette.controls}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body input:-webkit-autofill,
    body textarea:-webkit-autofill,
    body select:-webkit-autofill {
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      caret-color: var(--aura-text-color, ${darkPalette.text}) !important;
      box-shadow: 0 0 0 1000px var(--aura-surface-2, ${darkPalette.controls}) inset !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body pre,
    body code,
    body kbd,
    body samp {
      background-color: ${darkPalette.code} !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body :where(hr)${protectedVisualExclusion} {
      background-color: var(--aura-border-color, ${darkPalette.border}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
      color: var(--aura-border-color, ${darkPalette.border}) !important;
      -webkit-text-fill-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body :where(mark)${protectedVisualExclusion} {
      background-color: #3a2a0a !important;
      color: #fde68a !important;
      -webkit-text-fill-color: #fde68a !important;
    }
    body :where([role="status"], [aria-live], [data-status], [data-severity], [data-tone], [class*="badge" i], [class*="pill" i], [class*="tag" i])${protectedVisualExclusion} {
      background-color: var(--aura-surface-2, ${darkPalette.controls}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body :where(thead, tfoot, th, [role="columnheader"], [role="rowheader"])${protectedVisualExclusion} {
      background-color: var(--aura-surface-2, ${darkPalette.controls}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
    }
    body :where([class*="info" i]:not([class*="infobox" i]), [class*="notice" i], [data-status*="info" i], [data-state*="info" i], [data-variant*="info" i], [data-severity*="info" i], [data-tone*="info" i], [data-status*="notice" i], [data-state*="notice" i], [data-variant*="notice" i], [data-severity*="notice" i], [data-tone*="notice" i])${protectedVisualExclusion} {
      background-color: #102a43 !important;
      color: #bfdbfe !important;
      -webkit-text-fill-color: #bfdbfe !important;
      border-color: #60a5fa !important;
    }
    body :where([class*="success" i], [class*="positive" i], [data-status*="success" i], [data-state*="success" i], [data-variant*="success" i], [data-severity*="success" i], [data-tone*="success" i], [data-status*="positive" i], [data-state*="positive" i], [data-variant*="positive" i], [data-severity*="positive" i], [data-tone*="positive" i], [data-status*="ok" i], [data-state*="ok" i], [data-variant*="ok" i], [data-severity*="ok" i], [data-tone*="ok" i])${protectedVisualExclusion} {
      background-color: #0f2e1e !important;
      color: #bbf7d0 !important;
      -webkit-text-fill-color: #bbf7d0 !important;
      border-color: #22c55e !important;
    }
    body :where([class*="warning" i], [class*="warn" i], [class*="caution" i], [data-status*="warning" i], [data-state*="warning" i], [data-variant*="warning" i], [data-severity*="warning" i], [data-tone*="warning" i], [data-status*="warn" i], [data-state*="warn" i], [data-variant*="warn" i], [data-severity*="warn" i], [data-tone*="warn" i], [data-status*="caution" i], [data-state*="caution" i], [data-variant*="caution" i], [data-severity*="caution" i], [data-tone*="caution" i])${protectedVisualExclusion} {
      background-color: #3a2a0a !important;
      color: #fde68a !important;
      -webkit-text-fill-color: #fde68a !important;
      border-color: #f59e0b !important;
    }
    body :where([role="alert"]:not([class*="warning" i]):not([class*="warn" i]):not([class*="caution" i]):not([class*="success" i]):not([class*="positive" i]):not([class*="info" i]):not([class*="notice" i]):not([data-status*="warning" i]):not([data-state*="warning" i]):not([data-variant*="warning" i]):not([data-severity*="warning" i]):not([data-tone*="warning" i]):not([data-status*="success" i]):not([data-state*="success" i]):not([data-variant*="success" i]):not([data-severity*="success" i]):not([data-tone*="success" i]):not([data-status*="info" i]):not([data-state*="info" i]):not([data-variant*="info" i]):not([data-severity*="info" i]):not([data-tone*="info" i]), [class*="error" i], [class*="danger" i], [class*="destructive" i], [data-status*="error" i], [data-state*="error" i], [data-variant*="error" i], [data-severity*="error" i], [data-tone*="error" i], [data-status*="danger" i], [data-state*="danger" i], [data-variant*="danger" i], [data-severity*="danger" i], [data-tone*="danger" i], [data-status*="destructive" i], [data-state*="destructive" i], [data-variant*="destructive" i], [data-severity*="destructive" i], [data-tone*="destructive" i])${protectedVisualExclusion} {
      background-color: #3a1115 !important;
      color: #fecaca !important;
      -webkit-text-fill-color: #fecaca !important;
      border-color: #ef4444 !important;
    }
    body :where([aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-checked="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="checked" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i])${protectedVisualExclusion} {
      background-color: #1d2f55 !important;
      color: #dbeafe !important;
      -webkit-text-fill-color: #dbeafe !important;
      border-color: #60a5fa !important;
      accent-color: #93c5fd;
    }
    body a[href]:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]),
    body [role="link"]:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]) {
      color: #dbeafe !important;
      -webkit-text-fill-color: #dbeafe !important;
    }
    body :where(:disabled, [disabled], [aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i])${protectedVisualExclusion} {
      background-color: #101827 !important;
      color: #94a3b8 !important;
      -webkit-text-fill-color: #94a3b8 !important;
      border-color: #475569 !important;
      opacity: 1 !important;
      cursor: not-allowed;
    }
    body a[href]:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]),
    body [role="link"]:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]) {
      color: #94a3b8 !important;
      -webkit-text-fill-color: #94a3b8 !important;
    }
    body :where(input, textarea, select, button, option, optgroup, progress, meter) {
      background-color: var(--aura-surface-2, ${darkPalette.controls}) !important;
      color: var(--aura-text-color, ${darkPalette.text}) !important;
      -webkit-text-fill-color: var(--aura-text-color, ${darkPalette.text}) !important;
      border-color: var(--aura-border-color, ${darkPalette.border}) !important;
      accent-color: var(--aura-focus-color, ${darkPalette.focusRing});
    }
    body :where(input, textarea, select)[aria-invalid="true"] {
      border-color: #ef4444 !important;
      outline-color: #fca5a5 !important;
    }`
    : '';
  const textRenderingBlock = typoSmoothingEnabled
    ? `body {
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }`
    : '';
  const letterSpacingRule = typoSmoothingEnabled ? 'letter-spacing: 0.005em !important;' : '';

  if (modeId === MODE_IDS.FOCUS) {
    return `
      body :where(a, button, input, select, textarea, [tabindex]):focus,
      body :where(a, button, input, select, textarea, [tabindex]):focus-visible {
        outline-color: #0a84ff;
        text-decoration-line: underline;
        text-decoration-thickness: 0.14em;
        text-underline-offset: 0.18em;
      }
      body :where(button, input, select, textarea, [role="button"]) {
        accent-color: #0a84ff;
      }
    `;
  }

  return `
    ${darkThemeBlock}
    ${textRenderingBlock}
    body :where(p, blockquote, dd, dt) {
      ${spacingPackEnabled ? `line-height: ${lineHeight} !important;` : ''}
      ${letterSpacingRule}
      overflow-wrap: break-word;
    }
    ${linkEnhanceEnabled ? `body a[href],
    body [role="link"] {
      text-decoration-line: underline !important;
      text-underline-offset: 0.18em !important;
      text-decoration-thickness: ${underlineThickness}em !important;
      text-decoration-color: currentColor !important;
      text-underline-position: under !important;
    }` : ''}
  `;
}

function collectGlobalDarkVisualSnapshotInPage() {
  const clamp = (value) => (typeof value === 'string' ? value.trim().slice(0, 64) : '');
  const readColor = (element, property) => {
    if (!element || typeof getComputedStyle !== 'function') {
      return '';
    }
    try {
      const value = clamp(getComputedStyle(element).getPropertyValue(property));
      return value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' ? value : '';
    } catch (_) {
      return '';
    }
  };
  const firstColor = (elements, property) => {
    for (const element of elements) {
      const value = readColor(element, property);
      if (value) {
        return value;
      }
    }
    return '';
  };
  const docEl = document.documentElement || null;
  const body = document.body || null;
  const surface = document.querySelector?.('main, article, section, [role="main"], [role="region"], form, table, aside') || null;
  const link = document.querySelector?.('a[href], [role="link"]') || null;
  const muted = document.querySelector?.('small, figcaption, caption, [class*="muted" i], [class*="secondary" i]') || null;
  return {
    backgroundColor: firstColor([body, docEl], 'background-color'),
    surfaceColor: firstColor([surface, body, docEl], 'background-color'),
    textColor: firstColor([body, docEl], 'color'),
    linkColor: firstColor([link], 'color'),
    mutedTextColor: firstColor([muted], 'color'),
    prefersColorScheme: window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light',
  };
}

function normalizeCollectedDarkVisualSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return null;
  }
  const read = (key) => (typeof snapshot[key] === 'string' ? snapshot[key].trim().slice(0, 64) : '');
  return {
    backgroundColor: read('backgroundColor'),
    surfaceColor: read('surfaceColor'),
    textColor: read('textColor'),
    linkColor: read('linkColor'),
    mutedTextColor: read('mutedTextColor'),
    prefersColorScheme: snapshot.prefersColorScheme === 'dark' ? 'dark' : 'light',
  };
}

async function collectGlobalDarkVisualSnapshots(tabId) {
  if (!isValidTabId(tabId) || !globalThis.chrome?.scripting?.executeScript) {
    return [];
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'ISOLATED',
      func: collectGlobalDarkVisualSnapshotInPage,
    });
    if (!Array.isArray(results)) {
      return [];
    }
    return results
      .map((entry) => ({
        frameId: Number.isInteger(entry?.frameId) ? entry.frameId : 0,
        documentId: typeof entry?.documentId === 'string' ? entry.documentId : null,
        snapshot: normalizeCollectedDarkVisualSnapshot(entry?.result),
      }))
      .filter((entry) => entry.snapshot);
  } catch (_) {
    return [];
  }
}

async function collectGlobalDarkVisualSnapshot(tabId, frameId = 0) {
  if (!isValidTabId(tabId) || !globalThis.chrome?.scripting?.executeScript) {
    return null;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [typeof frameId === 'number' ? frameId : 0] },
      world: 'ISOLATED',
      func: collectGlobalDarkVisualSnapshotInPage,
    });
    const snapshot = Array.isArray(results) ? results[0]?.result : null;
    return normalizeCollectedDarkVisualSnapshot(snapshot);
  } catch (_) {
    return null;
  }
}

function buildGlobalDarkTokenMapEntries(snapshots = [], fallbackSnapshot = null, fallbackFrameId = 0) {
  const entries = [];
  const seen = new Set();
  for (const entry of Array.isArray(snapshots) ? snapshots : []) {
    if (!Number.isInteger(entry?.frameId) || !entry.snapshot) {
      continue;
    }
    const palette = buildDarkComfortThemePaletteV1(entry.snapshot);
    entries.push({
      frameId: entry.frameId,
      tokenMap: buildDarkComfortThemeTokenMap(palette),
      alreadyDark: palette.alreadyDark === true,
      prefersColorScheme: palette.prefersColorScheme || null,
    });
    seen.add(entry.frameId);
  }
  if (!seen.size) {
    const palette = buildDarkComfortThemePaletteV1(fallbackSnapshot || {});
    entries.push({
      frameId: Number.isInteger(fallbackFrameId) ? fallbackFrameId : 0,
      tokenMap: buildDarkComfortThemeTokenMap(palette),
      alreadyDark: palette.alreadyDark === true,
      prefersColorScheme: palette.prefersColorScheme || null,
    });
  }
  return entries;
}

async function applyGlobalDarkComfortRuntime(tabId, tokenMap = null, options = {}) {
  if (!isValidTabId(tabId) || !globalThis.chrome?.scripting?.executeScript) {
    return { ok: false, reason: 'runtime-unavailable' };
  }

  const frameTokenEntries = Array.isArray(tokenMap)
    ? tokenMap
        .filter((entry) => Number.isInteger(entry?.frameId) && entry?.tokenMap && typeof entry.tokenMap === 'object')
        .map((entry) => ({ frameId: entry.frameId, tokenMap: entry.tokenMap }))
    : [];
  const runtimeTokenMap = tokenMap && typeof tokenMap === 'object' && !Array.isArray(tokenMap)
    ? tokenMap
    : buildDarkComfortThemeTokenMap(buildDarkComfortThemePaletteV1());
  const applyRuntimeInPage = (resolvedTokenMap, receiptId) => {
    const scopeRoot = document.body || document.documentElement;
    if (!scopeRoot) {
      return { ok: false, reason: 'scope-missing' };
    }
    const runtime = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME;
    if (typeof runtime?.applyDarkComfortThemeRuntime !== 'function') {
      return {
        ok: false,
        active: false,
        reason: 'runtime-missing',
      };
    }
    const applyResult = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: resolvedTokenMap,
      executorActive: true,
      source: 'global-safe-fallback',
      rollbackOnPostCheckFailure: false,
      documentInlineTextFallback: true,
      inlineBudget: {
        maxNodes: 1200,
        maxMs: 18,
        maxCandidates: 40,
        maxForceText: 80,
      },
      modeActive: () => true,
      receiptId,
    });
    return applyResult;
  };
  const isRuntimeMissingResult = (entry) => (
    entry
    && Number.isInteger(entry.frameId)
    && (
      entry.reason === 'runtime-missing'
      || entry.reason === 'runtime-preimage-unavailable'
    )
  );
  const injectDarkRuntimeInDocument = async (documentId) => {
    if (typeof documentId !== 'string' || !documentId) {
      return { ok: false, reason: 'invalid-document' };
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId, documentIds: [documentId] },
        files: DARK_COMFORT_FRAME_RUNTIME_FILES,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: 'dark-runtime-frame-injection-failed',
        detail: error?.message || String(error),
      };
    }
  };
  const applyRuntimeInDocument = async (document, resolvedTokenMap, receiptId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [document.documentId] },
      world: 'ISOLATED',
      args: [resolvedTokenMap, receiptId],
      func: applyRuntimeInPage,
    });
    return (Array.isArray(results) ? results : [])
      .map((resultEntry) => (resultEntry?.result
        ? {
            frameId: Number.isInteger(resultEntry.frameId) ? resultEntry.frameId : document.frameId,
            documentId: resultEntry.documentId || document.documentId,
            ...resultEntry.result,
          }
        : null))
      .filter(Boolean);
  };
  const retryRuntimeMissingFrames = async (frames, tokenMapForFrame, receiptByDocument) => {
    const nextFrames = Array.isArray(frames) ? frames.slice() : [];
    for (let index = 0; index < nextFrames.length; index += 1) {
      const frame = nextFrames[index];
      if (!isRuntimeMissingResult(frame)) {
        continue;
      }

      const injection = await injectDarkRuntimeInDocument(frame.documentId);
      if (injection.ok !== true) {
        nextFrames[index] = {
          ...frame,
          runtimeInjection: injection,
        };
        continue;
      }

      try {
        const retryFrames = await applyRuntimeInDocument(
          frame,
          tokenMapForFrame(frame.frameId),
          receiptByDocument.get(frame.documentId),
        );
        nextFrames[index] = {
          ...(retryFrames[0] || frame),
          frameId: frame.frameId,
          runtimeInjected: true,
          previousReason: frame.reason || null,
        };
      } catch (error) {
        nextFrames[index] = {
          ...frame,
          runtimeInjection: {
            ok: false,
            reason: 'dark-runtime-frame-retry-failed',
            detail: error?.message || String(error),
          },
        };
      }
    }
    return nextFrames;
  };

  try {
    const probeResults = await chrome.scripting.executeScript({
      target: typeof options.documentId === 'string' && options.documentId
        ? { tabId, documentIds: [options.documentId] }
        : { tabId, allFrames: true },
      world: 'ISOLATED',
      func: () => {
        const runtime = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME;
        const state = typeof runtime?.getDarkComfortThemeRuntimeState === 'function'
          ? runtime.getDarkComfortThemeRuntimeState()
          : null;
        return {
          active: state?.active === true,
          receiptId: typeof state?.receiptId === 'string' ? state.receiptId : null,
          preimageAvailable: state?.preimageAvailable === true,
        };
      },
    });
    const documents = (Array.isArray(probeResults) ? probeResults : [])
      .map((entry) => ({
        frameId: Number.isInteger(entry?.frameId) ? entry.frameId : 0,
        documentId: typeof entry?.documentId === 'string' ? entry.documentId : null,
        ...(entry?.result || {}),
      }))
      .filter((entry) => entry.documentId)
      .slice(0, 64);
    const tokenByFrame = new Map(frameTokenEntries.map((entry) => [entry.frameId, entry.tokenMap]));
    const receiptByDocument = new Map();
    const frames = [];
    for (const document of documents) {
      if (document.active && document.preimageAvailable && document.receiptId) {
        if (options.reapplyActive !== true) {
          frames.push({ ...document, ok: true, active: true, reused: true });
          continue;
        }
        try {
          frames.push(...await applyRuntimeInDocument(
            document,
            tokenByFrame.get(document.frameId) || runtimeTokenMap,
            document.receiptId,
          ));
        } catch (error) {
          frames.push({ ...document, ok: false, reason: 'global-dark-runtime-document-reapply-failed', detail: error?.message || String(error) });
        }
        continue;
      }
      const receiptId = `dark-runtime:${crypto.randomUUID()}`;
      receiptByDocument.set(document.documentId, receiptId);
      const lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(tabId, {
        kind: 'DARK_RUNTIME_RECEIPT',
        effect: { documentId: document.documentId, frameId: document.frameId, receiptId },
        cleanup: {
          action: 'CLEANUP_DARK_RUNTIME',
          target: { documentIds: [document.documentId] },
          receiptId,
        },
      });
      try {
        const resolvedTokenMap = tokenByFrame.get(document.frameId) || runtimeTokenMap;
        let applied = await applyRuntimeInDocument(document, resolvedTokenMap, receiptId);
        if (applied[0]?.reason === 'runtime-missing') {
          const injection = await injectDarkRuntimeInDocument(document.documentId);
          if (injection.ok === true) {
            applied = await applyRuntimeInDocument(document, resolvedTokenMap, receiptId);
          }
        }
        frames.push(...applied);
        if (applied.some((entry) => entry?.ok === true)) {
          await markLifecycleArtifactDone(lifecycleArtifact, { receiptId });
        }
      } catch (error) {
        frames.push({
          ...document,
          ok: false,
          active: false,
          reason: 'global-dark-runtime-document-apply-failed',
          detail: error?.message || String(error),
        });
      }
    }
    const finalFrames = await retryRuntimeMissingFrames(
      frames,
      (frameId) => tokenByFrame.get(frameId) || runtimeTokenMap,
      receiptByDocument,
    );
    return {
      ok: finalFrames.some((entry) => entry?.ok === true),
      frames: finalFrames,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'global-dark-runtime-apply-failed',
      detail: error?.message || String(error),
    };
  }
}

function mergeGlobalDarkRuntimePasses(beforeCss, afterCss) {
  if (!beforeCss) return afterCss;
  if (!afterCss) return beforeCss;
  const beforeByDocument = new Map((beforeCss.frames || [])
    .filter((entry) => typeof entry?.documentId === 'string')
    .map((entry) => [entry.documentId, entry]));
  const frames = (afterCss.frames || []).map((entry) => {
    const previous = beforeByDocument.get(entry?.documentId);
    if (!previous) return entry;
    const previousInline = previous.inlineOverrides || {};
    const currentInline = entry.inlineOverrides || {};
    const previousFallback = previousInline.documentTextFallback || {};
    const currentFallback = currentInline.documentTextFallback || {};
    return {
      ...entry,
      inlineOverrides: {
        ...currentInline,
        overridden: Math.max(0, Number(previousInline.overridden) || 0)
          + Math.max(0, Number(currentInline.overridden) || 0),
        forcedText: Math.max(0, Number(previousInline.forcedText) || 0)
          + Math.max(0, Number(currentInline.forcedText) || 0),
        documentTextFallback: (previousInline.documentTextFallback || currentInline.documentTextFallback)
          ? {
              ...currentFallback,
              scanned: Math.max(0, Number(previousFallback.scanned) || 0)
                + Math.max(0, Number(currentFallback.scanned) || 0),
              forcedText: Math.max(0, Number(previousFallback.forcedText) || 0)
                + Math.max(0, Number(currentFallback.forcedText) || 0),
              priorityCandidates: Math.max(0, Number(previousFallback.priorityCandidates) || 0)
                + Math.max(0, Number(currentFallback.priorityCandidates) || 0),
              inlineTextCandidates: Math.max(0, Number(previousFallback.inlineTextCandidates) || 0)
                + Math.max(0, Number(currentFallback.inlineTextCandidates) || 0),
              contrastRejected: Math.max(0, Number(previousFallback.contrastRejected) || 0)
                + Math.max(0, Number(currentFallback.contrastRejected) || 0),
            }
          : null,
      },
    };
  });
  return { ...afterCss, ok: beforeCss.ok === true && afterCss.ok === true, frames };
}

async function cleanupGlobalDarkComfortRuntime(tabId, recordedDocuments = []) {
  if (!isValidTabId(tabId) || !globalThis.chrome?.scripting?.executeScript) {
    return { ok: false, reason: 'runtime-unavailable' };
  }

  try {
    const probeResults = recordedDocuments.length
      ? recordedDocuments.map((entry) => ({
          documentId: entry?.documentId,
          frameId: entry?.frameId,
          result: { receiptId: entry?.receiptId, active: true, preimageAvailable: true },
        }))
      : await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          world: 'ISOLATED',
          func: () => {
            const runtime = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME;
            return typeof runtime?.getDarkComfortThemeRuntimeState === 'function'
              ? runtime.getDarkComfortThemeRuntimeState()
              : null;
          },
        });
    const documents = (Array.isArray(probeResults) ? probeResults : [])
      .map((entry) => ({
        documentId: typeof entry?.documentId === 'string' ? entry.documentId : null,
        frameId: Number.isInteger(entry?.frameId) ? entry.frameId : null,
        receiptId: typeof entry?.result?.receiptId === 'string' ? entry.result.receiptId : null,
        active: entry?.result?.active === true,
        preimageAvailable: entry?.result?.preimageAvailable === true,
      }))
      .filter((entry) => entry.documentId && entry.active && entry.preimageAvailable && entry.receiptId);
    if (!documents.length) {
      return { ok: false, reason: 'global-dark-runtime-preimage-unavailable', frames: [] };
    }
    const frames = [];
    for (const document of documents) {
      try {
        const results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [document.documentId] },
      world: 'ISOLATED',
      args: [document.receiptId],
      func: (expectedReceiptId) => {
        const runtime = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME;
        const scopeRoot = document.body || document.documentElement;
        if (typeof runtime?.cleanupDarkComfortThemeRuntime !== 'function') {
          return { ok: false, active: false, reason: 'runtime-preimage-unavailable' };
        }
        return runtime.cleanupDarkComfortThemeRuntime({
          scopeRoot,
          source: 'global-safe-fallback-cleanup',
          expectedReceiptId,
          requirePreimage: true,
        });
      },
    });
        frames.push(...(Array.isArray(results) ? results.map((entry) => ({
          documentId: entry?.documentId || document.documentId,
          frameId: Number.isInteger(entry?.frameId) ? entry.frameId : document.frameId,
          ...(entry?.result || {}),
        })) : []));
      } catch (error) {
        frames.push({ ...document, ok: false, reason: 'document-cleanup-failed', detail: error?.message || String(error) });
      }
    }
    return {
      ok: frames.length > 0 && frames.every((entry) => entry?.ok === true),
      frames,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'global-dark-runtime-cleanup-failed',
      detail: error?.message || String(error),
    };
  }
}

function isComfortReadingRuntimePlanAllowed(plan) {
  return plan?.modeId === MODE_IDS.COMFORT_VISUAL
    && plan?.actionId === ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY
    && plan?.readerAllowed === true
    && COMFORT_READING_PAGE_TYPES.has(plan?.pageType);
}

function unsupportedComfortReadingRuntimePlan(plan, modeId) {
  if (!plan || modeId !== MODE_IDS.COMFORT_VISUAL) {
    return null;
  }
  if (plan.actionId !== ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY) {
    return null;
  }
  if (isComfortReadingRuntimePlanAllowed(plan)) {
    return null;
  }
  return {
    ok: false,
    reason: COMFORT_READING_RUNTIME_NOT_ALLOWED,
    detail: `${plan.actionId || 'UNKNOWN_ACTION'}:${plan.pageType || 'UNKNOWN_PAGE'}`,
  };
}

function isPageClarityRuntimeEffectPlan(plan) {
  return (
    plan?.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
    || plan?.v3LightShadow?.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
  );
}

function buildManualDarkComfortThemeRequest({
  modeId,
  source,
  comfortPrefs,
  runtimeEffectPlan,
  profilePageType,
  frameId,
  ownerKey,
  postCheckBaseline,
  budgetHit,
} = {}) {
  const hasRuntimePlan = Boolean(runtimeEffectPlan);
  const runtimePlanMatches = hasRuntimePlan
    && runtimeEffectPlan.modeId === MODE_IDS.COMFORT_VISUAL
    && runtimeEffectPlan.frameId === frameId;
  const pageType = runtimePlanMatches
    ? runtimeEffectPlan.pageType
    : Object.values(PAGE_TYPES).includes(profilePageType)
      ? profilePageType
      : PAGE_TYPES.UNKNOWN;
  const targetKind = targetKindForPageType(pageType);
  const sourceAllowsUserRequestedDark = source === 'popup' || source === 'rehydrate';

  if (
    modeId !== MODE_IDS.COMFORT_VISUAL
    || !sourceAllowsUserRequestedDark
    || comfortPrefs?.darkMode !== true
    || (hasRuntimePlan && !runtimePlanMatches)
  ) {
    return null;
  }

  const capability = evaluateRuntimeCapabilityV1({
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    pageType,
    targetKind,
    effectClass: EFFECT_CLASSES.DARK_THEME_ADAPTATION,
    desiredEffect: desiredEffectForActionTargetV1(
      ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
      pageType,
    ),
  });

  return buildDarkComfortThemeApplyRequestV1({
    userOptIn: true,
    pageType,
    frameId,
    ownerKey,
    capability,
    visualSnapshot: postCheckBaseline?.visualSnapshot,
    precheckSnapshot: postCheckBaseline?.visualSnapshot || postCheckBaseline,
    budgetHit: budgetHit === true,
  });
}

function shouldRetryEmergencyReflowGuard({ modeId, inspection, runtimeEffectPlan } = {}) {
  if (modeId !== MODE_IDS.COMFORT_VISUAL || !inspection || inspection.ok === true) {
    return false;
  }
  if (isPageClarityRuntimeEffectPlan(runtimeEffectPlan)) {
    return false;
  }
  if (inspection?.stats?.budgetHit === true) {
    return false;
  }

  const failures = Array.isArray(inspection.blockingFailures) ? inspection.blockingFailures : [];
  return (
    failures.length > 0
    && failures.every((code) => REFLOW_GUARD_LAYOUT_FAILURE_CODES.has(code))
  );
}

function pruneDisabledComfortVisualTokens({ modeId, comfortPrefs, tokenMap, tokens: rawTokens, ownedKeys } = {}) {
  const inputTokens = tokenMap || rawTokens;
  const tokens = inputTokens && typeof inputTokens === 'object' ? inputTokens : {};
  const keys = Array.isArray(ownedKeys) ? ownedKeys : Object.keys(tokens);
  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return { tokens, ownedKeys: keys };
  }

  const disabled = new Set();
  if (comfortPrefs?.textScale === false) {
    disabled.add('--aura-font-size');
  }
  if (comfortPrefs?.spacingPack === false) {
    disabled.add('--aura-line-height');
    disabled.add('--aura-paragraph-spacing');
  }

  disabled.forEach((key) => {
    delete tokens[key];
  });

  return {
    tokens,
    ownedKeys: keys.filter((key) => !disabled.has(key)),
  };
}

function trustedPageClarityCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pageClarityFrameMatches(data, frameId) {
  return typeof frameId === 'number' && data?.frameId === frameId;
}

function validatePageClarityMarkData(data = {}, frameId) {
  if (
    data?.ok === true
    && data?.reason === 'OK'
    && pageClarityFrameMatches(data, frameId)
    && data?.marked === true
    && trustedPageClarityCount(data?.markedCount) > 0
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: data?.reason && data.reason !== 'OK'
      ? data.reason
      : data?.error || 'PAGE_CLARITY_TARGET_INVALID',
  };
}

function validatePageClarityBaselineData(data = {}, frameId) {
  if (
    data?.ok === true
    && data?.reason === 'OK'
    && pageClarityFrameMatches(data, frameId)
    && trustedPageClarityCount(data?.markedTargets) > 0
    && trustedPageClarityCount(data?.baselineElements) > 0
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: data?.reason && data.reason !== 'OK'
      ? data.reason
      : data?.error || 'PAGE_CLARITY_BASELINE_FAILED',
  };
}

function validatePageClarityProbeData(data = {}, frameId, expectedTargetKind) {
  const hasExpectedTargetEvidence = expectedTargetKind === 'FORM_REGION'
    ? trustedPageClarityCount(data?.matchedLabels) > 0 || trustedPageClarityCount(data?.matchedInputs) > 0
    : trustedPageClarityCount(data?.matchedLinks) > 0;

  if (
    data?.ok === true
    && data?.reason === 'OK'
    && pageClarityFrameMatches(data, frameId)
    && trustedPageClarityCount(data?.markedTargets) > 0
    && trustedPageClarityCount(data?.inspectedElements) > 0
    && trustedPageClarityCount(data?.changedElements) > 0
    && trustedPageClarityCount(data?.visibleEffectScore) >= PAGE_CLARITY_MIN_VISIBLE_EFFECT_SCORE
    && hasExpectedTargetEvidence
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: data?.reason && data.reason !== 'OK'
      ? data.reason
      : data?.error || 'PAGE_CLARITY_EFFECT_NOT_VISIBLE',
  };
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

  if (isComfortDarkModeEnabled({ comfortPrefs, modePrefs })) {
    return { ...COMFORT_DARK_GUARD_TOKENS };
  }

  return { ...COMFORT_LIGHT_GUARD_TOKENS };
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

  if (isComfortDarkModeEnabled({ comfortPrefs })) {
    return { ...COMFORT_DARK_RETRY_TOKENS };
  }

  return { ...COMFORT_LIGHT_RETRY_TOKENS };
}

export { buildModeCss, buildComfortCss, buildFocusCss, buildSmartScopePatchCSS };

export class CssApplier {
  constructor(registry = cssRegistry, manager = stateManager, monitor = performanceMonitor) {
    this.registry = registry;
    this.stateManager = manager;
    this.performanceMonitor = monitor;
    this.modeOperationTails = new Map();
  }

  _modeOperationKey(tabId, modeId) {
    return `${tabId}:${modeId}`;
  }

  _enqueueModeOperation(tabId, modeId, operation) {
    const key = this._modeOperationKey(tabId, modeId);
    const previousTail = this.modeOperationTails.get(key) || Promise.resolve();
    const run = previousTail.catch(() => undefined).then(operation);
    const settledTail = run.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (this.modeOperationTails.get(key) === settledTail) {
        this.modeOperationTails.delete(key);
      }
    });
    this.modeOperationTails.set(key, settledTail);
    return run;
  }

  async applyPreludeCss(tabId, source = 'system', deps = {}) {
    return applyPreludeCssLifecycle(tabId, source, {
      registry: this.registry,
      stateManager: this.stateManager,
      ...deps,
    });
  }

  async ensureTransitionsCss(tabId, modeId, options = {}) {
    return ensureTransitionsCssLifecycle(tabId, modeId, options, {
      registry: this.registry,
      stateManager: this.stateManager,
    });
  }

  async removeTransitionsCss(tabId, modeId, options = {}) {
    return removeTransitionsCssLifecycle(tabId, modeId, options, {
      registry: this.registry,
      stateManager: this.stateManager,
    });
  }

  async removePreludeCss(tabId, source = 'system', options = {}) {
    return removePreludeCssLifecycle(tabId, source, {
      registry: this.registry,
      stateManager: this.stateManager,
      ...options,
    });
  }

  async refreshDarkComfortDocumentCss(tabId, { documentId = null, frameId = null, source = 'frame-ready' } = {}) {
    if (!isValidTabId(tabId)) return { ok: false, refreshed: false, reason: 'invalid-tab' };
    return this._enqueueModeOperation(tabId, MODE_IDS.COMFORT_VISUAL, async () => {
      const modeState = await this.stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
      if (modeState?.state !== STATES.ACTIVE) {
        return { ok: true, refreshed: false, reason: 'mode-inactive' };
      }
      const smartScope = modeState.smartScope && typeof modeState.smartScope === 'object'
        ? modeState.smartScope
        : {};
      const scoped = modeState.scopedV2 && typeof modeState.scopedV2 === 'object'
        ? modeState.scopedV2
        : {};
      const isGlobalDark = smartScope.variant === GLOBAL_SAFE_FALLBACK_VARIANT
        && smartScope.darkModeEnabled === true
        && smartScope.allFrames === true;
      if (!isGlobalDark && !scoped.preludeCssId) {
        return { ok: true, refreshed: false, reason: 'no-dark-document-css' };
      }

      const snapshots = await collectGlobalDarkVisualSnapshots(tabId);
      const requested = snapshots.filter((entry) => (
        (typeof documentId !== 'string' || !documentId || entry.documentId === documentId)
        && (!Number.isInteger(frameId) || entry.frameId === frameId)
        && typeof entry.documentId === 'string'
      ));
      if (!requested.length) {
        return { ok: true, refreshed: false, reason: 'document-gone', source };
      }
      const known = new Map((smartScope.globalDarkRuntime?.documents || [])
        .filter((entry) => typeof entry?.documentId === 'string')
        .map((entry) => [entry.documentId, entry]));
      const knownPreludeDocuments = new Map((scoped.preludeDocuments || [])
        .filter((entry) => typeof entry?.documentId === 'string')
        .map((entry) => [entry.documentId, entry]));
      const pending = requested
        .filter((entry) => !(isGlobalDark ? known : knownPreludeDocuments).has(entry.documentId))
        .slice(0, Math.max(0, 64 - (isGlobalDark ? known : knownPreludeDocuments).size));
      if (!pending.length) {
        if (requested.some((entry) => !(isGlobalDark ? known : knownPreludeDocuments).has(entry.documentId))) {
          return { ok: false, refreshed: false, reason: 'document-receipt-capacity-reached', source };
        }
        return { ok: true, refreshed: false, reason: 'document-already-refreshed', source };
      }

      const preludeEntry = scoped.preludeCssId ? await this.registry.get(scoped.preludeCssId) : null;
      const fallbackCssId = smartScope.baseCssId || modeState.cssId;
      const fallbackEntry = isGlobalDark && fallbackCssId ? await this.registry.get(fallbackCssId) : null;
      const refreshes = [];
      const refreshedPalettes = [];
      const refreshedRuntimeFrames = [];
      for (const document of pending) {
        const targetIds = [document.documentId];
        if (preludeEntry?.cssText) {
          const result = await insertModeCssRaw({
            tabId,
            documentIds: targetIds,
            cssText: preludeEntry.cssText,
            origin: preludeEntry.origin || CSS_ORIGIN,
            modeId: MODE_IDS.COMFORT_VISUAL,
          });
          refreshes.push({ label: 'prelude', documentId: document.documentId, ok: result?.ok === true });
          if (result?.ok === true) {
            for (const [knownDocumentId, receipt] of knownPreludeDocuments) {
              if (receipt?.frameId === document.frameId && knownDocumentId !== document.documentId) {
                knownPreludeDocuments.delete(knownDocumentId);
              }
            }
            knownPreludeDocuments.set(document.documentId, {
              documentId: document.documentId,
              frameId: document.frameId,
            });
          }
        }
        const palette = buildDarkComfortThemePaletteV1(document.snapshot || {});
        refreshedPalettes.push(palette);
        const runtime = isGlobalDark
          ? await applyGlobalDarkComfortRuntime(tabId, [{
              frameId: document.frameId,
              tokenMap: buildDarkComfortThemeTokenMap(palette),
            }], { documentId: document.documentId })
          : null;
        if (fallbackEntry?.cssText && runtime?.ok === true) {
          const result = await insertModeCssRaw({
            tabId,
            documentIds: targetIds,
            cssText: fallbackEntry.cssText,
            origin: fallbackEntry.origin || 'USER',
            modeId: MODE_IDS.COMFORT_VISUAL,
          });
          refreshes.push({ label: 'global-fallback', documentId: document.documentId, ok: result?.ok === true });
        }
        const runtimeDocument = runtime?.frames?.find((entry) => entry?.documentId === document.documentId);
        if (runtimeDocument) refreshedRuntimeFrames.push(runtimeDocument);
        if (runtimeDocument?.ok === true && runtimeDocument.receiptId) {
          known.set(document.documentId, {
            documentId: document.documentId,
            frameId: document.frameId,
            receiptId: runtimeDocument.receiptId,
          });
        }
      }
      const failed = refreshes.filter((entry) => entry.ok !== true);
      if (failed.length) return { ok: false, refreshed: false, reason: 'document-refresh-failed', refreshes };
      const stateUpdates = {};
      if (preludeEntry?.cssText) {
        stateUpdates.scopedV2 = {
          ...scoped,
          preludeDocuments: [...knownPreludeDocuments.values()].slice(-64),
        };
      }
      if (isGlobalDark) {
        stateUpdates.smartScope = {
          ...smartScope,
          globalDarkRuntime: {
            ...(smartScope.globalDarkRuntime || {}),
            documents: [...known.values()].slice(-64),
            lastRefreshOk: refreshedRuntimeFrames.length > 0
              && refreshedRuntimeFrames.every((entry) => entry?.ok === true),
            lastRefreshFrameCount: refreshedRuntimeFrames.length,
            lastRefreshActiveCount: refreshedRuntimeFrames.filter((entry) => entry?.active === true).length,
            lastRefreshReason: refreshedRuntimeFrames.find((entry) => entry?.ok !== true)?.reason || null,
          },
          allFrameRefreshCount: normalizeRefreshCount(smartScope.allFrameRefreshCount) + pending.length,
          darkPaletteFrameCount: known.size,
          darkPaletteAlreadyDarkFrameCount:
            Math.max(0, Number(smartScope.darkPaletteAlreadyDarkFrameCount) || 0)
            + refreshedPalettes.filter((entry) => entry.alreadyDark === true).length,
        };
      }
      if (Object.keys(stateUpdates).length > 0) {
        await this.stateManager.updateModeState(
          tabId,
          MODE_IDS.COMFORT_VISUAL,
          modeState.state,
          stateUpdates,
        );
      }
      return { ok: true, refreshed: true, source, refreshes, documentCount: pending.length };
    });
  }

  async refreshDarkComfortAllFrameCss(tabId, source = 'frame-ready') {
    return this.refreshDarkComfortDocumentCss(tabId, { source });
  }

  async applyMode(tabId, modeId, params = {}, source = 'popup') {
    const normalizedParams = params && typeof params === 'object' && !Array.isArray(params)
      ? params
      : { intensity: params };
    let lifecycleIntent = normalizedParams.lifecycleIntent || null;
    const managesLifecycle = !lifecycleIntent;
    if (!lifecycleIntent) {
      try {
        lifecycleIntent = await claimLifecycleIntent({
          tabId,
          modeId,
          kind: source === 'rehydrate'
            ? LIFECYCLE_OPERATION_KINDS.REHYDRATE
            : LIFECYCLE_OPERATION_KINDS.APPLY,
          targetState: STATES.ACTIVE,
          source,
        });
      } catch (error) {
        if (
          error?.message === 'LIFECYCLE_INTENT_SUPERSEDED'
          || error?.cause?.message === 'LIFECYCLE_INTENT_SUPERSEDED'
        ) {
          return { ok: true, skipped: true, reason: 'newer-lifecycle-intent' };
        }
        return { ok: false, reason: 'LIFECYCLE_STORAGE_UNAVAILABLE', detail: error?.message, retryable: true };
      }
    }
    return this._enqueueModeOperation(tabId, modeId, async () => {
      if (lifecycleIntent) {
        try {
          await beginLifecycleIntent(lifecycleIntent);
        } catch (error) {
          const lifecycleError = error?.cause?.message || error?.message;
          if (source === 'rehydrate' && lifecycleError === 'LIFECYCLE_OPERATION_STALE') {
            return { ok: true, skipped: true, reason: 'newer-lifecycle-intent' };
          }
          return {
            ok: false,
            reason: lifecycleError || 'LIFECYCLE_BEGIN_FAILED',
            retryable: lifecycleError !== 'LIFECYCLE_OPERATION_STALE',
          };
        }
      }
      if (source === 'rehydrate') {
        const latestModeState = await this.stateManager.getModeState(tabId, modeId);
        if (latestModeState?.state !== STATES.ACTIVE || latestModeState?.pendingDecision === true) {
          const skipped = { ok: true, skipped: true, reason: 'mode-inactive' };
          if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, skipped);
          return skipped;
        }
      }

      let result;
      if (isFlagEnabled('scopedModeCssV2')) {
        result = await this.applyModeScopedV2(tabId, modeId, normalizedParams, source);
      } else {
        result = await this.applyModeV1(tabId, modeId, normalizedParams, source);
      }
      if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, result);
      return result;
    });
  }

  async applyModeScopedV2(tabId, modeId, params = {}, source = 'popup') {
    const frameId = typeof params?.frameId === 'number' ? params.frameId : 0;
    const inFlightKey = scopedV2InFlightKeyToString(makeScopedV2Key(tabId, frameId), modeId);
    const existingInFlight = inFlightApplyByTab.get(inFlightKey);
    if (existingInFlight) {
      if (!shouldQueueScopedV2Apply(params)) {
        return existingInFlight.promise;
      }

      existingInFlight.latestRequest = { tabId, modeId, params, source };
      if (!existingInFlight.queuedPromise) {
        existingInFlight.queuedPromise = existingInFlight.promise
          .catch(() => null)
          .then(() => this._runQueuedModeScopedV2Apply(inFlightKey, existingInFlight));
      }
      return existingInFlight.queuedPromise;
    }

    const entry = {
      promise: null,
      queuedPromise: null,
      latestRequest: null,
    };
    const applyPromise = this._startModeScopedV2Apply(inFlightKey, entry, tabId, modeId, params, source);
    inFlightApplyByTab.set(inFlightKey, entry);

    return applyPromise;
  }

  _startModeScopedV2Apply(inFlightKey, entry, tabId, modeId, params = {}, source = 'popup') {
    const attemptId = lastAttemptId + 1;
    lastAttemptId = attemptId;
    const applyPromise = this._applyModeScopedV2(tabId, modeId, params, source, attemptId);
    entry.promise = applyPromise;
    applyPromise.finally(() => {
      const current = inFlightApplyByTab.get(inFlightKey);
      if (
        current === entry
        && current.promise === applyPromise
        && !current.queuedPromise
        && !current.latestRequest
      ) {
        inFlightApplyByTab.delete(inFlightKey);
      }
    });
    return applyPromise;
  }

  _runQueuedModeScopedV2Apply(inFlightKey, entry) {
    const current = inFlightApplyByTab.get(inFlightKey);
    if (current !== entry || !current.latestRequest) {
      entry.queuedPromise = null;
      return current?.promise || { ok: false, reason: 'APPLY_QUEUE_DROPPED' };
    }

    const request = current.latestRequest;
    current.latestRequest = null;
    current.queuedPromise = null;
    return this._startModeScopedV2Apply(
      inFlightKey,
      current,
      request.tabId,
      request.modeId,
      request.params,
      request.source,
    );
  }

  async _applyModeScopedV2(tabId, modeId, params = {}, source = 'popup', attemptId = 0) {
    const options = typeof params === 'number' ? { intensity: params } : params || {};
    const requestedFrameId = typeof options?.frameId === 'number' ? options.frameId : undefined;
    const preventFrameFallback = options?.preventFrameFallback === true;
    const requestedTemplateEvidence = options?.templateEvidence || null;
    const requestedRuntimeEffectPlan = options?.runtimeEffectPlan || null;
    const runtimeEffectPlanCheck = sanitizeRuntimeEffectPlan(requestedRuntimeEffectPlan);
    const sanitizedRuntimeEffectPlan = runtimeEffectPlanCheck.ok ? runtimeEffectPlanCheck.plan : null;
    const safeDowngradeOnly = options?.safeDowngradeOnly === true;
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

    const runtimeEffectPlanForFrame = (frameId) => {
      if (!sanitizedRuntimeEffectPlan || typeof frameId !== 'number') {
        return null;
      }
      if (sanitizedRuntimeEffectPlan.modeId !== modeId || sanitizedRuntimeEffectPlan.frameId !== frameId) {
        return null;
      }
      return sanitizedRuntimeEffectPlan;
    };

    const buildFallbackDiagnostics = (runtimeEffectPlan, plannedFallback, frameId) => {
      if (!runtimeEffectPlan || plannedFallback?.ok !== true) {
        return null;
      }

      return {
        modeId,
        pageType: runtimeEffectPlan.pageType,
        policyDecision: runtimeEffectPlan.policyDecision,
        safeDowngrade: plannedFallback.safeDowngrade,
        cssProfileId: plannedFallback.profileId,
        activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
        frameIdMatch: runtimeEffectPlan.frameId === frameId,
      };
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
      if (result?.ok && result?.preludeApplied !== true) {
        await removePreludeBestEffort('after-final-apply');
      } else if (!result?.ok) {
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

    const policyResult = await resolveSitePolicy(tabId, modeId);
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
    const comfortVisualPrefsForApply =
      modeId === MODE_IDS.COMFORT_VISUAL ? await getComfortVisualPrefsFromStorage() : null;
    const perDomainComfortPrefsForApply =
      modeId === MODE_IDS.COMFORT_VISUAL ? await getPerDomainModePrefs(siteKey, modeId) : null;
    const effectiveComfortPrefsForApply =
      perDomainComfortPrefsForApply?.darkMode === false && comfortVisualPrefsForApply
        ? { ...comfortVisualPrefsForApply, darkMode: false }
        : comfortVisualPrefsForApply;
    const comfortDarkModeRequested =
      modeId === MODE_IDS.COMFORT_VISUAL && effectiveComfortPrefsForApply?.darkMode === true;
    const initialFrameId = typeof requestedFrameId === 'number' ? requestedFrameId : 0;
    const safeDowngradeOnlyFrameId =
      typeof sanitizedRuntimeEffectPlan?.frameId === 'number' ? sanitizedRuntimeEffectPlan.frameId : initialFrameId;
    const safeDowngradeOnlyPlan = safeDowngradeOnly ? runtimeEffectPlanForFrame(safeDowngradeOnlyFrameId) : null;
    const safeDowngradeOnlyCss = safeDowngradeOnlyPlan
      ? buildSafeDowngradeCss({
        modeId,
        safeDowngrade: safeDowngradeOnlyPlan.safeDowngrade,
        pageType: safeDowngradeOnlyPlan.pageType,
        intensity: normalizedIntensity,
      })
      : null;
    const pageClarityPlanForFrame = (frameId) => {
      const runtimeEffectPlan = runtimeEffectPlanForFrame(frameId);
      const shadow = runtimeEffectPlan?.v3LightShadow;
      if (
        !runtimeEffectPlan
        || modeId !== MODE_IDS.COMFORT_VISUAL
        || shadow?.actionId !== ADAPTATION_ACTION_IDS.PAGE_CLARITY
        || shadow?.executor !== RUNTIME_EXECUTORS.REGION_CLASS_TOKENS
        || shadow?.activePlanAllowed !== true
        || shadow?.shadowOnly !== true
      ) {
        return null;
      }
      return { runtimeEffectPlan, shadow };
    };
    const safeDowngradeOnlyPageClarityPlan = safeDowngradeOnly
      ? pageClarityPlanForFrame(safeDowngradeOnlyFrameId)
      : null;
    const safeDowngradeOnlyPageClarityCss = safeDowngradeOnlyPageClarityPlan
      ? buildPageClarityCssV1({
        actionId: safeDowngradeOnlyPageClarityPlan.shadow.actionId,
        pageType: safeDowngradeOnlyPageClarityPlan.runtimeEffectPlan.pageType,
        targetKind: safeDowngradeOnlyPageClarityPlan.shadow.targetKind,
        effectClass: safeDowngradeOnlyPageClarityPlan.shadow.effectClass,
        desiredEffect: safeDowngradeOnlyPageClarityPlan.shadow.desiredEffect,
        intensity: normalizedIntensity,
      })
      : null;
    const canApplyPageClarityOnly = safeDowngradeOnlyPageClarityCss?.ok === true;
    const primaryPageClarityFrameId =
      typeof sanitizedRuntimeEffectPlan?.frameId === 'number' ? sanitizedRuntimeEffectPlan.frameId : initialFrameId;
    const primaryPageClarityPlan = !comfortDarkModeRequested && !safeDowngradeOnly && source === 'popup' && !preventFrameFallback
      ? pageClarityPlanForFrame(primaryPageClarityFrameId)
      : null;
    const primaryPageClarityCss = primaryPageClarityPlan
      ? buildPageClarityCssV1({
        actionId: primaryPageClarityPlan.shadow.actionId,
        pageType: primaryPageClarityPlan.runtimeEffectPlan.pageType,
        targetKind: primaryPageClarityPlan.shadow.targetKind,
        effectClass: primaryPageClarityPlan.shadow.effectClass,
        desiredEffect: primaryPageClarityPlan.shadow.desiredEffect,
        intensity: normalizedIntensity,
      })
      : null;
    const canApplyPageClarityPrimary =
      primaryPageClarityPlan
      && primaryPageClarityCss?.ok === true
      && sanitizedRuntimeEffectPlan?.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY;

    if (safeDowngradeOnly) {
      const detail =
        runtimeEffectPlanCheck.ok === false
          ? runtimeEffectPlanCheck.reason
          : safeDowngradeOnlyPageClarityPlan?.shadow?.desiredEffect
            || safeDowngradeOnlyPlan?.safeDowngrade
            || 'NO_SUPPORTED_SAFE_DOWNGRADE';
      if (source !== 'popup' || preventFrameFallback) {
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
          detail,
        });
        return finalize({
          ok: false,
          reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
          detail,
        });
      }
      if (policyBlocked) {
        return finalize(blockedResult);
      }
      if (
        runtimeEffectPlanCheck.ok === false
        || !safeDowngradeOnlyPlan
        || (
          safeDowngradeOnlyCss?.ok !== true
          && !canApplyPageClarityOnly
          && !comfortDarkModeRequested
        )
      ) {
        const reason =
          runtimeEffectPlanCheck.ok === false
            ? SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN
            : safeDowngradeOnlyPageClarityCss?.reason || SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE;
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason,
          detail,
        });
        return finalize({
          ok: false,
          reason,
          detail,
        });
      }
    }

    const tryRefreshComfortPrefsInPlace = async (modeState) => {
      const scopedState = modeState?.scopedV2;
      if (
        modeId !== MODE_IDS.COMFORT_VISUAL
        || !shouldQueueScopedV2Apply(options)
        || source !== 'rehydrate'
        || requestedRuntimeEffectPlan
        || safeDowngradeOnly
        || policyBlocked
        || !scopedState?.scopeSelector
        || typeof scopedState?.frameId !== 'number'
      ) {
        return null;
      }

      const frameId = scopedState.frameId;
      const scopeSelector = scopedState.scopeSelector;
      const inspectionBaselineResult = await collectScopedV2InspectionBaselineInPage(tabId, {
        frameId,
        scopeSelector,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        budget: { maxNodes: 80, maxMs: 8 },
      });
      if (!inspectionBaselineResult?.ok) {
        return null;
      }

      const modePrefs =
        typeof this.stateManager?.getModePrefs === 'function'
          ? await this.stateManager.getModePrefs(modeId)
          : null;
      const globalReduceMotion = await getGlobalReduceMotionPreference();
      const comfortVisualPrefs = await getComfortVisualPrefsFromStorage();
      const perDomainModePrefs = await getPerDomainModePrefs(siteKey, modeId);
      const effectiveComfortPrefs =
        perDomainModePrefs?.darkMode === false && comfortVisualPrefs
          ? { ...comfortVisualPrefs, darkMode: false }
          : comfortVisualPrefs;
      const darkModeCurrentlyApplied =
        Array.isArray(scopedState?.tokenKeys) && scopedState.tokenKeys.includes('--aura-color-scheme');
      const darkModeDesired = isComfortDarkModeEnabled({ comfortPrefs: effectiveComfortPrefs });
      if (darkModeCurrentlyApplied || scopedState?.preludeCssId || darkModeDesired) {
        return null;
      }

      const comfortPrefsForScopedTokens = { ...effectiveComfortPrefs, darkMode: false };
      const baseComfortOverrides = buildComfortVisualTokenOverrides(comfortPrefsForScopedTokens);
      const retryOverrides = await getContrastRetryOverrides(tabId, modeId, comfortPrefsForScopedTokens);
      const comfortOverrides = retryOverrides ? { ...baseComfortOverrides, ...retryOverrides } : baseComfortOverrides;
      const linkCssOptions = getComfortLinkCssOptions(modeId, comfortPrefsForScopedTokens, modePrefs, retryOverrides);
      const textRenderingCssOptions = getComfortTextRenderingCssOptions(modeId, comfortPrefsForScopedTokens);

      let { tokens: tokenMap, ownedKeys } = pruneDisabledComfortVisualTokens({
        modeId,
        comfortPrefs: effectiveComfortPrefs,
        ...computeTokensV2({
          profile: null,
          intensity: normalizedIntensity,
          modeId,
          overrides: comfortOverrides,
        }),
      });

      if (debugEnabled) {
        tokenMap['--aura-me2-scope-present'] = '1';
        if (!ownedKeys.includes('--aura-me2-scope-present')) {
          ownedKeys.push('--aura-me2-scope-present');
        }
      }

      const { reduceMotionEnabled, transitionMs } = getSmoothTransitionSettings(
        modeId,
        modePrefs,
        {
          focusReduceMotionV1: isFlagEnabled('focusReduceMotionV1'),
          reducedMotion: globalReduceMotion,
          smoothThemeTransitionsV2: isFlagEnabled('smoothThemeTransitionsV2'),
        },
      );
      const cssText = buildScopedModeCssV2({
        modeId,
        intensity: normalizedIntensity,
        includeDebugSentinels: debugEnabled,
        reduceMotion: reduceMotionEnabled,
        smoothTransitions: false,
        transitionMs,
        textScaleEnabled: effectiveComfortPrefs?.textScale !== false,
        spacingPackEnabled: effectiveComfortPrefs?.spacingPack !== false,
        ...linkCssOptions,
        ...textRenderingCssOptions,
      });

      const oldCssId = scopedState.cssId || modeState?.cssId || null;
      let oldCssText = scopedState.cssText || '';
      let oldCssOrigin = CSS_ORIGIN;
      if (oldCssId) {
        try {
          const oldEntry = await this.registry.get(oldCssId);
          oldCssText = oldEntry?.cssText || oldCssText;
          oldCssOrigin = oldEntry?.origin || oldCssOrigin;
        } catch (_) {
          // Fall back to persisted scopedState.cssText.
        }
      }

      const needsCssReplace =
        hasComfortTextScaleCssRules(oldCssText) !== hasComfortTextScaleCssRules(cssText)
        || hasComfortSpacingCssRules(oldCssText) !== hasComfortSpacingCssRules(cssText)
        || hasComfortLinkEnhanceCssRules(oldCssText) !== hasComfortLinkEnhanceCssRules(cssText)
        || hasComfortLinkColorCssRules(oldCssText) !== hasComfortLinkColorCssRules(cssText)
        || hasComfortTextRenderingCssRules(oldCssText) !== hasComfortTextRenderingCssRules(cssText);
      let registration = {
        cssId: oldCssId,
        cssHash: scopedState.cssHash || modeState?.cssHash || null,
      };
      let safeCssText = oldCssText || scopedState.cssText || cssText;
      let insertedNewCss = false;

      if (needsCssReplace) {
        const insertionResult = await insertModeCssSafely({
          tabId,
          frameId,
          cssText,
          origin: CSS_ORIGIN,
          modeId,
          forceGuard: true,
          scopeSelector: MODE_ENGINE_SCOPE_SELECTOR,
          modeEnginePath: 'scoped-v2',
        });
        if (!insertionResult?.ok || !insertionResult.cssText) {
          return null;
        }

        safeCssText = insertionResult.cssText || cssText;
        insertedNewCss = true;
        try {
          registration = await this.registry.register(safeCssText, CSS_ORIGIN, {
            tabId,
            modeId,
            createdAt: Date.now(),
            scopeKey: scopeSelector,
            variant: 'SCOPED_V2',
            intensity: normalizedIntensity,
            reapplyReason: options.reapplyReason || 'prefs',
          });
        } catch (_) {
          await chrome.scripting
            .removeCSS({ target: { tabId, frameIds: [frameId] }, css: safeCssText, origin: CSS_ORIGIN })
            .catch(() => {});
          return null;
        }
      }

      const tokenResult = await sendScopeTokenMessage(
        tabId,
        ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
        {
          tokenMap,
          ownerKey: SCOPED_MODE_OWNER_KEY,
        },
        { frameId },
      );

      if (!tokenResult?.ok) {
        if (insertedNewCss) {
          await chrome.scripting
            .removeCSS({ target: { tabId, frameIds: [frameId] }, css: safeCssText, origin: CSS_ORIGIN })
            .catch(() => {});
          await this.registry.remove(registration?.cssId).catch(() => {});
        }
        return null;
      }

      if (modePrefs?.contrastGuard === true) {
        const guardOverrides = await getComfortContrastGuardOverrides({
          tabId,
          modePrefs,
          comfortPrefs: comfortPrefsForScopedTokens,
          frameId,
        });
        if (guardOverrides) {
          const boosted = pruneDisabledComfortVisualTokens({
            modeId,
            comfortPrefs: effectiveComfortPrefs,
            ...computeTokensV2({
              profile: null,
              intensity: normalizedIntensity,
              modeId,
              overrides: { ...comfortOverrides, ...guardOverrides },
            }),
          });
          if (debugEnabled) {
            boosted.tokens['--aura-me2-scope-present'] = '1';
            if (!boosted.ownedKeys.includes('--aura-me2-scope-present')) {
              boosted.ownedKeys.push('--aura-me2-scope-present');
            }
          }
          const guardResult = await sendScopeTokenMessage(
            tabId,
            ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
            {
              tokenMap: boosted.tokens,
              ownerKey: SCOPED_MODE_OWNER_KEY,
            },
            { frameId },
          );
          if (guardResult?.ok) {
            tokenMap = boosted.tokens;
            ownedKeys = boosted.ownedKeys;
          }
        }
      }

      const inspection = await inspectScopedV2PostApplyInPage(tabId, {
        frameId,
        scopeSelector,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || [],
        baseline: inspectionBaselineResult.baseline || null,
        budget: { maxNodes: 80, maxMs: 8 },
      });
      if (!inspection?.ok) {
        if (insertedNewCss) {
          await chrome.scripting
            .removeCSS({ target: { tabId, frameIds: [frameId] }, css: safeCssText, origin: CSS_ORIGIN })
            .catch(() => {});
          await this.registry.remove(registration?.cssId).catch(() => {});
        }
        return null;
      }

      let oldCssCleanup = null;
      if (insertedNewCss && oldCssId && oldCssText) {
        try {
          await chrome.scripting.removeCSS({
            target: { tabId, frameIds: [frameId] },
            css: oldCssText,
            origin: oldCssOrigin,
          });
          await this.registry.remove(oldCssId).catch(() => {});
          oldCssCleanup = { ok: true };
        } catch (error) {
          oldCssCleanup = {
            ok: false,
            reason: 'OLD_SCOPED_CSS_REMOVE_FAILED',
            detail: error?.message || 'removeCSS failed',
          };
        }
      }

      const scopedApply = applyScopedModeV2({
        tabId,
        frameId,
        cssId: registration.cssId,
        modeId,
        cssText: safeCssText,
        tokens: tokenMap,
        scopeSelector,
      });
      const appliedAt = Date.now();
      const existingOutcomeAttemptId = scopedState?.outcomeAttemptId || null;
      const scopedNextState = {
        ...scopedState,
        attemptId,
        outcomeAttemptId: existingOutcomeAttemptId,
        scopeSelector,
        owner: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || [],
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        cssText: safeCssText,
        appliedAt,
        intensity: normalizedIntensity,
        frameId,
        applied: scopedApply?.applied !== false,
      };

      await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
        pendingDecision: false,
        smartScope: null,
        scopedV2: scopedNextState,
      });
      await patchTabRuntime(tabId, { cssId: registration.cssId, modeId, appliedAt });
      await recordSmartScopeStatus('apply', {
        ok: true,
        detail: oldCssCleanup?.ok === false ? oldCssCleanup.reason : 'prefs-in-place',
      });
      recordV2Metric('apply.prefs_in_place', 1, { modeId });

      rememberResolvedScopedV2Scope({
        tabId,
        modeId,
        applyUrlKey,
        scopeSelector,
        frameId,
      });

      return {
        ok: true,
        cssId: registration.cssId,
        variant: 'SCOPED_V2',
        frameId,
        inPlace: true,
        oldCssCleanup: oldCssCleanup || undefined,
      };
    };

    // Clear any existing scoped artifacts before applying again
    const existingModeState = await this.stateManager.getModeState(tabId, modeId);
    const inPlaceRefreshResult = await tryRefreshComfortPrefsInPlace(existingModeState);
    if (inPlaceRefreshResult?.ok) {
      return finalize(inPlaceRefreshResult);
    }

    if (modeId === MODE_IDS.COMFORT_VISUAL && existingModeState?.scopedV2?.preludeCssId) {
      const preludeCleanup = await this.removePreludeCss(tabId, 'pre-apply-replace');
      if (preludeCleanup?.ok === false && preludeCleanup.reason !== 'missing-css') {
        const detail = formatDetail(
          preludeCleanup.detail || preludeCleanup.reason,
          'PRE_APPLY_PRELUDE_CLEANUP_FAILED',
        );
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason: 'PRE_APPLY_PRELUDE_CLEANUP_FAILED',
          detail,
        });
        return finalize({
          ok: false,
          reason: 'PRE_APPLY_PRELUDE_CLEANUP_FAILED',
          detail,
          cleanup: preludeCleanup,
        });
      }
    }

    let preApplyCleanupResult = null;
    if (existingModeState?.smartScope || (existingModeState?.cssId && !existingModeState?.scopedV2)) {
      preApplyCleanupResult = await this.removeModeV1(tabId, modeId);
    } else {
      preApplyCleanupResult = await this.removeModeScopedV2(tabId, modeId, {
        modeState: existingModeState,
        updateState: false,
      });
    }
    if (preApplyCleanupResult?.ok === false && preApplyCleanupResult.reason !== 'no-scope') {
      const cleanupDetail = formatDetail(
        preApplyCleanupResult.detail || preApplyCleanupResult.details || preApplyCleanupResult.error,
        '',
      );
      const detail = cleanupDetail
        ? `PRE_APPLY_CLEANUP_FAILED:${cleanupDetail}`
        : 'PRE_APPLY_CLEANUP_FAILED';
      await recordSmartScopeStatus('apply', {
        ok: false,
        reason: preApplyCleanupResult.reason || 'PRE_APPLY_CLEANUP_FAILED',
        detail,
      });
      return finalize({
        ok: false,
        reason: preApplyCleanupResult.reason || 'PRE_APPLY_CLEANUP_FAILED',
        detail,
        cleanup: preApplyCleanupResult,
      });
    }

    const clearPageClarityTargets = async (frameId) => {
      try {
        await contentBridge.safeSend(
          tabId,
          { action: ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1 },
          typeof frameId === 'number' ? { frameId } : undefined,
        );
      } catch (_) {
        // best-effort cleanup; CSS removal/state truth is handled separately.
      }
    };

    const applyPageClarityLimited = async (planBundle, cssBundle, frameId, applyReason = 'SAFE_DOWNGRADE_ONLY') => {
      if (!planBundle || cssBundle?.ok !== true) {
        return {
          ok: false,
          reason: PAGE_CLARITY_CSS_REASONS.UNSUPPORTED_PAGE_CLARITY_PROFILE,
          detail: planBundle?.shadow?.desiredEffect || 'NO_SUPPORTED_PAGE_CLARITY_PROFILE',
        };
      }

      const { runtimeEffectPlan, shadow } = planBundle;
      const pageClarityVariant =
        applyReason === 'PRIMARY_PAGE_CLARITY' ? PAGE_CLARITY_MEDIUM_VARIANT : PAGE_CLARITY_LIMITED_VARIANT;
      const pageClarityActiveQuality =
        applyReason === 'PRIMARY_PAGE_CLARITY'
          ? ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED
          : ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED;
      const markMessage = {
        action: ACTIONS.PAGE_CLARITY_MARK_TARGET_V1,
        frameId,
        collectionEpoch: shadow.collectionEpoch,
        routeEpoch: shadow.routeEpoch,
        sourceBlockId: shadow.sourceBlockId !== 'none' ? shadow.sourceBlockId : undefined,
        regionId: shadow.regionId !== 'none' ? shadow.regionId : undefined,
        expectedTargetKind: shadow.targetKind,
      };
      const markResult = await contentBridge.safeSend(tabId, markMessage, { frameId });
      const markData = markResult?.data || {};
      const markCheck = validatePageClarityMarkData(markData, frameId);
      if (markResult?.ok !== true || markCheck.ok !== true) {
        const reason = markCheck.reason || markResult?.error || 'PAGE_CLARITY_TARGET_INVALID';
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason,
          detail: shadow.desiredEffect,
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false }).catch(() => {});
        return { ok: false, reason, detail: shadow.desiredEffect };
      }

      let injectedCss = cssBundle.cssText;
      let cssId = null;
      let cssHash = null;
      let appliedAt = null;
      let baselineData = null;
      let probeData = null;
      try {
        const baselineResult = await contentBridge.safeSend(
          tabId,
          {
            action: ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1,
            frameId,
            cssProfileId: cssBundle.profileId,
            expectedTargetKind: shadow.targetKind,
            desiredEffect: shadow.desiredEffect,
          },
          { frameId },
        );
        baselineData = baselineResult?.data || {};
        const baselineCheck = validatePageClarityBaselineData(baselineData, frameId);
        if (baselineResult?.ok !== true || baselineCheck.ok !== true) {
          const reason = baselineCheck.reason || baselineResult?.error || 'PAGE_CLARITY_BASELINE_FAILED';
          await clearPageClarityTargets(frameId);
          await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false }).catch(() => {});
          await recordSmartScopeStatus('apply', {
            ok: false,
            reason,
            detail: shadow.desiredEffect,
          });
          return { ok: false, reason, detail: shadow.desiredEffect, pageClarityBaseline: baselineData };
        }

        await this.performanceMonitor.measureHeapDelta(() =>
          this.performanceMonitor.measureLatency(async () => {
            const insertionResult = await insertModeCssSafely({
              tabId,
              frameId,
              cssText: cssBundle.cssText,
              origin: CSS_ORIGIN,
              modeId,
              forceGuard: true,
              scopeSelector: PAGE_CLARITY_SCOPE,
              modeEnginePath: 'page-clarity-limited',
            });

            if (!insertionResult?.ok) {
              throw new Error('insert_failed');
            }

            injectedCss = insertionResult.cssText || cssBundle.cssText;
          }),
        );

        const registration = await this.registry.register(injectedCss, CSS_ORIGIN, {
          tabId,
          modeId,
          createdAt: Date.now(),
          scopeKey: PAGE_CLARITY_SCOPE,
          variant: pageClarityVariant,
          intensity: normalizedIntensity,
          actionId: shadow.actionId,
          targetKind: shadow.targetKind,
          effectClass: shadow.effectClass,
          desiredEffect: shadow.desiredEffect,
          cssProfileId: cssBundle.profileId,
        });
        cssId = registration.cssId;
        cssHash = registration.cssHash || null;

        const probeResult = await contentBridge.safeSend(
          tabId,
          {
            action: ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1,
            frameId,
            cssProfileId: cssBundle.profileId,
            expectedTargetKind: shadow.targetKind,
            desiredEffect: shadow.desiredEffect,
          },
          { frameId },
        );
        probeData = probeResult?.data || {};
        const probeCheck = validatePageClarityProbeData(probeData, frameId, shadow.targetKind);
        if (probeResult?.ok !== true || probeCheck.ok !== true) {
          const reason = probeCheck.reason || probeResult?.error || 'PAGE_CLARITY_EFFECT_NOT_VISIBLE';
          await chrome.scripting
            .removeCSS({ target: { tabId, frameIds: [frameId] }, css: injectedCss, origin: CSS_ORIGIN })
            .catch(() => {});
          await this.registry.remove(cssId).catch(() => {});
          await clearPageClarityTargets(frameId);
          await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false }).catch(() => {});
          await recordSmartScopeStatus('apply', {
            ok: false,
            reason,
            detail: shadow.desiredEffect,
          });
          return { ok: false, reason, detail: shadow.desiredEffect, pageClarityProbe: probeData };
        }

        appliedAt = Date.now();
        await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
          cssId,
          cssHash,
          frameId,
          activeQuality: pageClarityActiveQuality,
          pendingDecision: false,
          smartScope: {
            scopeKey: PAGE_CLARITY_SCOPE,
            scopeReason: shadow.desiredEffect,
            variant: pageClarityVariant,
            variantReason: applyReason === 'PRIMARY_PAGE_CLARITY'
              ? 'v3-light-page-clarity-primary'
              : 'v3-light-page-clarity-limited',
            domClassToken: null,
            appliedClasses: [],
            patchCssId: null,
            cssId: null,
            cssHash: null,
            baseCssId: cssId,
            baseCssHash: cssHash,
            darkModeEnabled: false,
            profiledAt: appliedAt,
            appliedAt,
            frameId,
            verified: probeData?.reason === 'OK',
            configLevel: smartScopeConfig.level,
            scopeProfile: null,
            intensity: normalizedIntensity,
            fallbackCssProfileId: cssBundle.profileId,
            safeDowngrade: shadow.desiredEffect,
            fallbackDiagnostics: {
              modeId,
              pageType: runtimeEffectPlan.pageType,
              policyDecision: runtimeEffectPlan.policyDecision,
              safeDowngrade: shadow.desiredEffect,
              cssProfileId: cssBundle.profileId,
              activeQuality: pageClarityActiveQuality,
              frameIdMatch: runtimeEffectPlan.frameId === frameId,
            },
            fallbackFrom: applyReason === 'PRIMARY_PAGE_CLARITY' ? null : 'V3_LIGHT_PAGE_CLARITY',
            fallbackReason: applyReason,
            fallbackDetail: shadow.desiredEffect,
            pageClarity: {
              actionId: shadow.actionId,
              targetKind: shadow.targetKind,
              effectClass: shadow.effectClass,
              desiredEffect: shadow.desiredEffect,
              sourceBlockId: shadow.sourceBlockId,
              regionId: shadow.regionId,
              cssProfileId: cssBundle.profileId,
              probe: {
                reason: probeData.reason,
                markedTargets: probeData.markedTargets,
                matchedLinks: probeData.matchedLinks,
                matchedLabels: probeData.matchedLabels,
                matchedInputs: probeData.matchedInputs,
                changedElements: probeData.changedElements,
                inspectedElements: probeData.inspectedElements,
                targetsWithRegionDelta: probeData.targetsWithRegionDelta,
                visibleEffectScore: probeData.visibleEffectScore,
                baselineElements: baselineData?.baselineElements,
              },
            },
          },
          scopedV2: null,
        });
      } catch (error) {
        await chrome.scripting
          .removeCSS({ target: { tabId, frameIds: [frameId] }, css: injectedCss, origin: CSS_ORIGIN })
          .catch(() => {});
        await this.registry.remove(cssId).catch(() => {});
        await clearPageClarityTargets(frameId);
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false }).catch(() => {});
        await recordSmartScopeStatus('apply', {
          ok: false,
          error: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED,
          detail: shadow.desiredEffect,
        });
        return { ok: false, reason: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED, detail: shadow.desiredEffect };
      }

      await patchTabRuntime(tabId, { cssId, modeId, appliedAt });
      await recordSmartScopeStatus('apply', {
        ok: true,
        detail: `page-clarity:${shadow.desiredEffect}`,
      });
      recordModeEngineMetric('modeengine.scopedv2.pageClarityLimited.applied', 1, { modeId });

      return {
        ok: true,
        cssId,
        cssHash,
        variant: pageClarityVariant,
        frameId,
        templateEvidence: templateEvidenceForFrame(requestedTemplateEvidence, frameId),
        pageClarity: {
          actionId: shadow.actionId,
          desiredEffect: shadow.desiredEffect,
          cssProfileId: cssBundle.profileId,
          probe: {
            reason: probeData.reason,
            markedTargets: probeData.markedTargets,
            matchedLinks: probeData.matchedLinks,
            matchedLabels: probeData.matchedLabels,
            matchedInputs: probeData.matchedInputs,
            changedElements: probeData.changedElements,
            inspectedElements: probeData.inspectedElements,
            targetsWithRegionDelta: probeData.targetsWithRegionDelta,
            visibleEffectScore: probeData.visibleEffectScore,
            baselineElements: baselineData?.baselineElements,
          },
        },
        fallback: {
          from: applyReason === 'PRIMARY_PAGE_CLARITY' ? null : 'V3_LIGHT_PAGE_CLARITY',
          reason: applyReason,
          detail: shadow.desiredEffect,
          cssProfileId: cssBundle.profileId,
        },
      };
    };

    const applyGlobalSafeFallback = async (scopeFailure = {}, frameId = 0, fallbackOptions = {}) => {
      const runtimeEffectPlan = runtimeEffectPlanForFrame(frameId);
      const plannedFallback = runtimeEffectPlan
        ? buildSafeDowngradeCss({
          modeId,
          safeDowngrade: runtimeEffectPlan.safeDowngrade,
          pageType: runtimeEffectPlan.pageType,
          intensity: normalizedIntensity,
        })
        : null;
      const fallbackDiagnostics = buildFallbackDiagnostics(runtimeEffectPlan, plannedFallback, frameId);
      const darkGlobalFallbackRequested =
        modeId === MODE_IDS.COMFORT_VISUAL && effectiveComfortPrefsForApply?.darkMode === true;
      let fallbackAllFrames = darkGlobalFallbackRequested;
      let fallbackIncludeTopFrame = darkGlobalFallbackRequested;
      const fallbackOrigin = CSS_ORIGIN;
      const darkGlobalVisualSnapshots = darkGlobalFallbackRequested
        ? await collectGlobalDarkVisualSnapshots(tabId)
        : [];
      let darkGlobalVisualSnapshot = darkGlobalFallbackRequested
        ? darkGlobalVisualSnapshots.find((entry) => entry.frameId === frameId)?.snapshot
          || darkGlobalVisualSnapshots.find((entry) => entry.frameId === 0)?.snapshot
          || darkGlobalVisualSnapshots[0]?.snapshot
          || null
        : null;
      if (darkGlobalFallbackRequested && !darkGlobalVisualSnapshot) {
        darkGlobalVisualSnapshot = await collectGlobalDarkVisualSnapshot(tabId, frameId);
      }
      const darkGlobalFallbackPalette = darkGlobalFallbackRequested
        ? buildDarkComfortThemePaletteV1(darkGlobalVisualSnapshot || {})
        : null;
      const darkGlobalFallbackTokenMapEntries = darkGlobalFallbackRequested
        ? buildGlobalDarkTokenMapEntries(darkGlobalVisualSnapshots, darkGlobalVisualSnapshot, frameId)
        : null;
      const darkGlobalFallbackTokenMap = darkGlobalFallbackPalette
        ? buildDarkComfortThemeTokenMap(darkGlobalFallbackPalette)
        : null;
      if (
        fallbackOptions.requireSupportedSafeDowngrade
        && plannedFallback?.ok !== true
        && !darkGlobalFallbackRequested
      ) {
        const detail = runtimeEffectPlan?.safeDowngrade || 'NO_SUPPORTED_SAFE_DOWNGRADE';
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
          detail,
        });
        return {
          ok: false,
          reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
          detail,
        };
      }

      const fallbackCss =
        darkGlobalFallbackRequested
          ? buildGlobalSafeFallbackCss(
            modeId,
            normalizedIntensity,
            modeId === MODE_IDS.COMFORT_VISUAL ? effectiveComfortPrefsForApply : null,
            {
              darkPalette: darkGlobalFallbackPalette,
              visualSnapshot: darkGlobalVisualSnapshot,
            },
          )
          : plannedFallback?.ok === true
          ? plannedFallback.cssText
          : buildGlobalSafeFallbackCss(
            modeId,
            normalizedIntensity,
            modeId === MODE_IDS.COMFORT_VISUAL ? effectiveComfortPrefsForApply : null,
          );
      const fallbackDetail = formatDetail(
        runtimeEffectPlan?.safeDowngrade || scopeFailure?.detail || scopeFailure?.reason,
        'NO_SCOPE',
      );
      let injectedCss = fallbackCss;
      let cssId = null;
      let cssHash = null;
      let appliedAt = null;
      let globalDarkRuntime = null;
      const summarizeGlobalDarkRuntime = (runtimeResult) => (
        runtimeResult
          ? {
              ok: runtimeResult.ok === true,
              frameCount: Array.isArray(runtimeResult.frames) ? runtimeResult.frames.length : 0,
              activeCount: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.filter((entry) => entry?.active === true).length
                : 0,
              inlineOverrideCount: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => sum + Math.max(0, Number(entry?.inlineOverrides?.overridden) || 0),
                    0,
                  )
                : 0,
              forcedTextCount: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => sum + Math.max(0, Number(entry?.inlineOverrides?.forcedText) || 0),
                    0,
                  )
                : 0,
              documentTextFallbackCount: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.filter((entry) => entry?.inlineOverrides?.documentTextFallback).length
                : 0,
              documentTextFallbackScanned: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => sum + Math.max(0, Number(entry?.inlineOverrides?.documentTextFallback?.scanned) || 0),
                    0,
                  )
                : 0,
              documentTextFallbackPriorityCandidates: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => (
                      sum + Math.max(0, Number(entry?.inlineOverrides?.documentTextFallback?.priorityCandidates) || 0)
                    ),
                    0,
                  )
                : 0,
              documentTextFallbackInlineCandidates: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => (
                      sum + Math.max(0, Number(entry?.inlineOverrides?.documentTextFallback?.inlineTextCandidates) || 0)
                    ),
                    0,
                  )
                : 0,
              documentTextFallbackContrastRejected: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.reduce(
                    (sum, entry) => (
                      sum + Math.max(0, Number(entry?.inlineOverrides?.documentTextFallback?.contrastRejected) || 0)
                    ),
                    0,
                  )
                : 0,
              postCheckFailedCount: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames.filter((entry) => entry?.postCheck?.postCheckPassed === false).length
                : 0,
              reason: runtimeResult.reason || null,
              documents: Array.isArray(runtimeResult.frames)
                ? runtimeResult.frames
                    .filter((entry) => (
                      entry?.ok === true
                      && typeof entry?.documentId === 'string'
                      && typeof entry?.receiptId === 'string'
                    ))
                    .map((entry) => ({
                      documentId: entry.documentId,
                      frameId: Number.isInteger(entry.frameId) ? entry.frameId : null,
                      receiptId: entry.receiptId,
                    }))
                    .slice(0, 64)
                : [],
            }
          : null
      );

      try {
        await this.performanceMonitor.measureHeapDelta(() =>
          this.performanceMonitor.measureLatency(async () => {
            if (darkGlobalFallbackRequested) {
              globalDarkRuntime = await applyGlobalDarkComfortRuntime(
                tabId,
                darkGlobalFallbackTokenMapEntries?.length
                  ? darkGlobalFallbackTokenMapEntries
                  : darkGlobalFallbackTokenMap,
              );
              if (globalDarkRuntime?.ok !== true) {
                throw new Error(globalDarkRuntime?.reason || 'dark_runtime_apply_failed');
              }
            }

            let insertionResult = darkGlobalFallbackRequested
              ? await insertModeCssRaw({
                tabId,
                allFrames: true,
                includeTopFrame: true,
                cssText: fallbackCss,
                origin: fallbackOrigin,
                modeId,
              })
              : await insertModeCssSafely({
                tabId,
                frameId,
                cssText: fallbackCss,
                origin: fallbackOrigin,
                modeId,
                forceGuard: true,
                scopeSelector: 'body',
              });

            if (darkGlobalFallbackRequested && !insertionResult?.ok) {
              const topFrameRetry = await insertModeCssRaw({
                tabId,
                cssText: fallbackCss,
                origin: fallbackOrigin,
                modeId,
              });
              if (topFrameRetry?.ok) {
                insertionResult = topFrameRetry;
                fallbackAllFrames = false;
                fallbackIncludeTopFrame = false;
              }
            }

            if (!insertionResult?.ok) {
              throw new Error('insert_failed');
            }

            injectedCss = insertionResult.cssText || fallbackCss;
          }),
        );

        const registration = await this.registry.register(injectedCss, fallbackOrigin, {
          tabId,
          modeId,
          createdAt: Date.now(),
          scopeKey: 'body',
          variant: GLOBAL_SAFE_FALLBACK_VARIANT,
          intensity: normalizedIntensity,
          fallbackCssProfileId: plannedFallback?.ok === true ? plannedFallback.profileId : null,
          safeDowngrade: plannedFallback?.ok === true ? plannedFallback.safeDowngrade : null,
          fallbackDiagnostics,
          allFrames: fallbackAllFrames,
          includeTopFrame: fallbackIncludeTopFrame,
        });
        cssId = registration.cssId;
        cssHash = registration.cssHash || null;
        if (darkGlobalFallbackRequested) {
          const postCssRuntime = await applyGlobalDarkComfortRuntime(
            tabId,
            darkGlobalFallbackTokenMapEntries?.length
              ? darkGlobalFallbackTokenMapEntries
              : darkGlobalFallbackTokenMap,
            { reapplyActive: true },
          );
          globalDarkRuntime = mergeGlobalDarkRuntimePasses(globalDarkRuntime, postCssRuntime);
        }
        appliedAt = Date.now();
        await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
          cssId,
          cssHash,
          frameId,
          activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
          pendingDecision: false,
          smartScope: {
            scopeKey: 'body',
            scopeReason: fallbackDetail,
            variant: GLOBAL_SAFE_FALLBACK_VARIANT,
            variantReason: 'scoped-v2-no-scope',
            domClassToken: null,
            appliedClasses: [],
            patchCssId: null,
            cssId: null,
            cssHash: null,
            baseCssId: cssId,
            baseCssHash: cssHash,
            darkModeEnabled: modeId === MODE_IDS.COMFORT_VISUAL && effectiveComfortPrefsForApply?.darkMode === true,
            allFrames: fallbackAllFrames,
            includeTopFrame: fallbackIncludeTopFrame,
            profiledAt: appliedAt,
            appliedAt,
            frameId,
            verified: false,
            configLevel: smartScopeConfig.level,
            scopeProfile: null,
            intensity: normalizedIntensity,
            fallbackCssProfileId: plannedFallback?.ok === true ? plannedFallback.profileId : null,
            safeDowngrade: plannedFallback?.ok === true ? plannedFallback.safeDowngrade : null,
            fallbackDiagnostics,
            darkPaletteAlreadyDark: darkGlobalFallbackPalette?.alreadyDark === true,
            darkPalettePrefersColorScheme: darkGlobalFallbackPalette?.prefersColorScheme || null,
            darkPaletteFrameCount: Array.isArray(darkGlobalFallbackTokenMapEntries)
              ? darkGlobalFallbackTokenMapEntries.length
              : 0,
            darkPaletteAlreadyDarkFrameCount: Array.isArray(darkGlobalFallbackTokenMapEntries)
              ? darkGlobalFallbackTokenMapEntries.filter((entry) => entry?.alreadyDark === true).length
              : 0,
            globalDarkRuntime: summarizeGlobalDarkRuntime(globalDarkRuntime),
            fallbackFrom: 'SCOPED_V2',
            fallbackReason: scopeFailure?.reason || scopeFailure?.error || APPLY_FAILURE_REASONS.NO_SCOPE,
            fallbackDetail,
            fallbackScopeDetail: formatDetail(
              scopeFailure?.detail || scopeFailure?.details || scopeFailure?.reason || scopeFailure?.error,
              'NO_SCOPE',
            ),
          },
          scopedV2: null,
        });
      } catch (error) {
        const removalTarget = fallbackAllFrames ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
        await chrome.scripting
          .removeCSS({ target: removalTarget, css: injectedCss, origin: fallbackOrigin })
          .catch(() => {});
        if (fallbackAllFrames) {
          await chrome.scripting
            .removeCSS({ target: { tabId }, css: injectedCss, origin: fallbackOrigin })
            .catch(() => {});
        }
        await this.registry.remove(cssId).catch(() => {});
        if (darkGlobalFallbackRequested) {
          try {
            const runtimeOnlyResult = await applyGlobalDarkComfortRuntime(
              tabId,
              darkGlobalFallbackTokenMapEntries?.length ? darkGlobalFallbackTokenMapEntries : darkGlobalFallbackTokenMap,
            );
            if (runtimeOnlyResult?.ok === true) {
              appliedAt = Date.now();
              await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
                cssId: null,
                cssHash: null,
                frameId,
                activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
                pendingDecision: false,
                smartScope: {
                  scopeKey: 'body',
                  scopeReason: fallbackDetail,
                  variant: GLOBAL_SAFE_FALLBACK_VARIANT,
                  variantReason: 'scoped-v2-no-scope-runtime-only',
                  domClassToken: null,
                  appliedClasses: [],
                  patchCssId: null,
                  cssId: null,
                  cssHash: null,
                  baseCssId: null,
                  baseCssHash: null,
                  darkModeEnabled: true,
                  allFrames: false,
                  includeTopFrame: false,
                  profiledAt: appliedAt,
                  appliedAt,
                  frameId,
                  verified: false,
                  configLevel: smartScopeConfig.level,
                  scopeProfile: null,
                  intensity: normalizedIntensity,
                  fallbackCssProfileId: plannedFallback?.ok === true ? plannedFallback.profileId : null,
                  safeDowngrade: plannedFallback?.ok === true ? plannedFallback.safeDowngrade : null,
                  fallbackDiagnostics,
                  darkPaletteAlreadyDark: darkGlobalFallbackPalette?.alreadyDark === true,
                  darkPalettePrefersColorScheme: darkGlobalFallbackPalette?.prefersColorScheme || null,
                  darkPaletteFrameCount: Array.isArray(darkGlobalFallbackTokenMapEntries)
                    ? darkGlobalFallbackTokenMapEntries.length
                    : 0,
                  darkPaletteAlreadyDarkFrameCount: Array.isArray(darkGlobalFallbackTokenMapEntries)
                    ? darkGlobalFallbackTokenMapEntries.filter((entry) => entry?.alreadyDark === true).length
                    : 0,
                  globalDarkRuntime: summarizeGlobalDarkRuntime(runtimeOnlyResult),
                  fallbackFrom: 'SCOPED_V2',
                  fallbackReason: scopeFailure?.reason || scopeFailure?.error || APPLY_FAILURE_REASONS.NO_SCOPE,
                  fallbackDetail,
                  fallbackCssFailed: true,
                  runtimeOnly: true,
                },
                scopedV2: null,
              });
              await patchTabRuntime(tabId, { cssId: null, modeId, appliedAt });
              await recordSmartScopeStatus('apply', {
                ok: true,
                detail: `fallback-runtime-only:${fallbackDetail}`,
              });
              recordModeEngineMetric('modeengine.scopedv2.globalSafeFallback.runtimeOnlyApplied', 1, { modeId });
              return {
                ok: true,
                cssId: null,
                cssHash: null,
                variant: GLOBAL_SAFE_FALLBACK_VARIANT,
                frameId,
                runtimeOnly: true,
                fallback: {
                  from: 'SCOPED_V2',
                  reason: scopeFailure?.reason || scopeFailure?.error || APPLY_FAILURE_REASONS.NO_SCOPE,
                  detail: fallbackDetail,
                  cssProfileId: plannedFallback?.ok === true ? plannedFallback.profileId : null,
                  diagnostics: fallbackDiagnostics,
                  runtimeOnly: true,
                },
              };
            }
          } catch (_) {
            // Continue to the normal error path when even the runtime-only dark fallback cannot be activated.
          }
        }
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, { pendingDecision: false }).catch(() => {});
        await recordSmartScopeStatus('apply', {
          ok: false,
          error: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED,
          detail: fallbackDetail,
        });
        return { ok: false, reason: APPLY_FAILURE_REASONS.INSERT_CSS_FAILED, detail: fallbackDetail };
      }

      await patchTabRuntime(tabId, { cssId, modeId, appliedAt });
      await recordSmartScopeStatus('apply', {
        ok: true,
        detail: `fallback:${fallbackDetail}`,
      });
      recordModeEngineMetric('modeengine.scopedv2.globalSafeFallback.applied', 1, { modeId });
      modeEngineLog('[CssApplier][V2] Global safe fallback applied', {
        modeId,
        attemptId,
        reason: scopeFailure?.reason || scopeFailure?.error || null,
        detail: fallbackDetail,
        diagnostics: fallbackDiagnostics,
      });

      return {
        ok: true,
        cssId,
        cssHash,
        variant: GLOBAL_SAFE_FALLBACK_VARIANT,
        frameId,
        fallback: {
          from: 'SCOPED_V2',
          reason: scopeFailure?.reason || scopeFailure?.error || APPLY_FAILURE_REASONS.NO_SCOPE,
          detail: fallbackDetail,
          scopeDetail: formatDetail(
            scopeFailure?.detail || scopeFailure?.details || scopeFailure?.reason || scopeFailure?.error,
            'NO_SCOPE',
          ),
          cssProfileId: plannedFallback?.ok === true ? plannedFallback.profileId : null,
          diagnostics: fallbackDiagnostics,
        },
      };
    };

    if (safeDowngradeOnly) {
      if (canApplyPageClarityOnly) {
        const pageClarityResult = await applyPageClarityLimited(
          safeDowngradeOnlyPageClarityPlan,
          safeDowngradeOnlyPageClarityCss,
          safeDowngradeOnlyFrameId,
        );
        return finalize(pageClarityResult);
      }

      const fallbackResult = await applyGlobalSafeFallback(
        {
          reason: APPLY_FAILURE_REASONS.NO_SCOPE,
          detail: safeDowngradeOnlyPlan.safeDowngrade,
        },
        safeDowngradeOnlyFrameId,
        { requireSupportedSafeDowngrade: !comfortDarkModeRequested },
      );
      return finalize(fallbackResult);
    }

    if (canApplyPageClarityPrimary) {
      const pageClarityResult = await applyPageClarityLimited(
        primaryPageClarityPlan,
        primaryPageClarityCss,
        primaryPageClarityFrameId,
        'PRIMARY_PAGE_CLARITY',
      );
      return finalize(pageClarityResult);
    }

    const invalidComfortRuntimePlan = modeId === MODE_IDS.COMFORT_VISUAL
      && requestedRuntimeEffectPlan
      && runtimeEffectPlanCheck.ok === false
      ? {
          ok: false,
          reason: SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN,
          detail: runtimeEffectPlanCheck.reason || SAFE_DOWNGRADE_CSS_REASONS.INVALID_RUNTIME_EFFECT_PLAN,
        }
      : null;
    if (invalidComfortRuntimePlan) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
        pendingDecision: false,
        cssId: null,
        cssHash: null,
        scopedV2: null,
      });
      await recordSmartScopeStatus('apply', invalidComfortRuntimePlan);
      return finalize(invalidComfortRuntimePlan);
    }

    const comfortReadingDenied = !policyBlocked
      ? unsupportedComfortReadingRuntimePlan(sanitizedRuntimeEffectPlan, modeId)
      : null;
    if (comfortReadingDenied) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
        pendingDecision: false,
        cssId: null,
        cssHash: null,
        scopedV2: null,
      });
      await recordSmartScopeStatus('apply', comfortReadingDenied);
      return finalize(comfortReadingDenied);
    }

    const applyInFrame = async (frameId) => {
      const scopeResolution = await resolveScopedV2Scope({
        tabId,
        modeId,
        frameId,
        source,
        applyUrlKey,
        smartScopeConfig,
        debugEnabled,
        attemptId,
        recordSmartScopeStatus,
        recordV2Metric,
      });

      if (!scopeResolution?.ok) {
        return { ...scopeResolution, frameId };
      }

      const {
        scopeSelector,
        frameId: resolvedFrameId,
        profileResponse,
        verification,
      } = scopeResolution;
      const frameTemplateEvidence = templateEvidenceForFrame(requestedTemplateEvidence, resolvedFrameId);
      const scopedTransaction = beginScopedV2Transaction({
        tabId,
        frameId: resolvedFrameId,
        modeId,
        attemptId,
        scopeSelector,
      });
      const rollbackPostApplyAttempt = async ({
        reason,
        registration = null,
        safeCssText = '',
        ownedKeys = [],
        inspection = null,
      } = {}) => {
        const rollback = {
          cssRemoved: false,
          registryRemoved: false,
          tokensRemoved: false,
          scopeUnmarked: false,
          errors: [],
        };

        if (safeCssText) {
          try {
            await chrome.scripting.removeCSS({
              target: { tabId, frameIds: [resolvedFrameId] },
              css: safeCssText,
              origin: CSS_ORIGIN,
            });
            rollback.cssRemoved = true;
          } catch (error) {
            rollback.errors.push({ step: 'remove-css', detail: formatDetail(error?.message, 'REMOVE_CSS_FAILED') });
          }
        }

        if (registration?.cssId) {
          try {
            await this.registry.remove(registration.cssId);
            rollback.registryRemoved = true;
          } catch (error) {
            rollback.errors.push({ step: 'registry-remove', detail: formatDetail(error?.message, 'REGISTRY_REMOVE_FAILED') });
          }
        }

        try {
          const cleanup = await sendScopeTokenMessage(
            tabId,
            ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
            { ownerKey: SCOPED_MODE_OWNER_KEY, ownedKeys },
            { frameId: resolvedFrameId },
          );
          rollback.tokensRemoved = cleanup?.ok === true;
          rollback.scopeUnmarked = cleanup?.scopeUnmarked === true;
          if (cleanup?.ok === false) {
            rollback.errors.push({ step: 'cleanup-tokens', detail: formatDetail(cleanup?.detail || cleanup?.reason, 'TOKEN_CLEANUP_FAILED') });
          }
        } catch (error) {
          rollback.errors.push({ step: 'cleanup-tokens', detail: formatDetail(error?.message, 'TOKEN_CLEANUP_FAILED') });
        }

        completeScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.ROLLED_BACK, {
          reason,
          rollback,
          inspection,
        });
        return rollback;
      };
      const inspectionBaselineResult = await collectScopedV2InspectionBaselineInPage(tabId, {
        frameId: resolvedFrameId,
        scopeSelector,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        budget: { maxNodes: 80, maxMs: 8 },
      });
      if (!inspectionBaselineResult?.ok) {
        const detail = formatDetail(
          inspectionBaselineResult?.detail || inspectionBaselineResult?.error || inspectionBaselineResult?.reason,
          'BASELINE_FAILED',
        );
        completeScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.ROLLED_BACK, {
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          detail,
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
          cssId: null,
          cssHash: null,
          scopedV2: null,
        });
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          detail,
        });
        return {
          ok: false,
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          detail,
          inspection: inspectionBaselineResult,
        };
      }
      const inspectionBaseline = inspectionBaselineResult.baseline || null;

      const modePrefs =
        typeof this.stateManager?.getModePrefs === 'function'
          ? await this.stateManager.getModePrefs(modeId)
          : null;
      const globalReduceMotion = await getGlobalReduceMotionPreference();
      const comfortVisualPrefs = comfortVisualPrefsForApply;
      const effectiveComfortPrefs = effectiveComfortPrefsForApply;
      const frameRuntimeEffectPlan = runtimeEffectPlanForFrame(resolvedFrameId);
      const darkApplyRequest = buildManualDarkComfortThemeRequest({
        modeId,
        source,
        comfortPrefs: effectiveComfortPrefs,
        runtimeEffectPlan: frameRuntimeEffectPlan,
        profilePageType: profileResponse?.profile?.pageType,
        frameId: resolvedFrameId,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        postCheckBaseline: inspectionBaseline,
        budgetHit: inspectionBaselineResult?.stats?.budgetHit === true,
      });
      const comfortPrefsForScopedTokens =
        modeId === MODE_IDS.COMFORT_VISUAL && darkApplyRequest?.activePlanAllowed !== true
          ? { ...effectiveComfortPrefs, darkMode: false }
          : effectiveComfortPrefs;
      const darkTokenOverrides = darkApplyRequest?.activePlanAllowed === true ? darkApplyRequest.tokenMap : {};
      const baseComfortOverrides =
        modeId === MODE_IDS.COMFORT_VISUAL
          ? { ...buildComfortVisualTokenOverrides(comfortPrefsForScopedTokens), ...darkTokenOverrides }
          : {};
      const retryOverrides =
        modeId === MODE_IDS.COMFORT_VISUAL
          ? await getContrastRetryOverrides(tabId, modeId, comfortPrefsForScopedTokens)
          : null;
      const comfortOverrides = retryOverrides ? { ...baseComfortOverrides, ...retryOverrides } : baseComfortOverrides;
      const linkCssOptions = getComfortLinkCssOptions(modeId, comfortPrefsForScopedTokens, modePrefs, retryOverrides);
      const textRenderingCssOptions = getComfortTextRenderingCssOptions(modeId, comfortPrefsForScopedTokens);

      let { tokens: tokenMap, ownedKeys } = pruneDisabledComfortVisualTokens({
        modeId,
        comfortPrefs: effectiveComfortPrefs,
        ...computeTokensV2({
          profile: profileResponse?.profile,
          intensity: normalizedIntensity,
          modeId,
          overrides: comfortOverrides,
        }),
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
      const darkActivationRequested = darkApplyRequest?.messagePatch?.darkThemeExecutorActive === true;
      const darkTokensApplied =
        modeId === MODE_IDS.COMFORT_VISUAL
        && (
          tokenMap?.['--aura-color-scheme'] === 'dark'
          || (ownedKeys || []).includes('--aura-color-scheme')
        );
      const darkPreludeRequested = modeId === MODE_IDS.COMFORT_VISUAL && darkTokensApplied;
      const preludeComfortPrefs = darkPreludeRequested
        ? { ...(effectiveComfortPrefs || {}), darkMode: true }
        : effectiveComfortPrefs;
      const tokenResult = await sendScopeTokenMessage(
        tabId,
        ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
        {
          tokenMap,
          ownerKey: SCOPED_MODE_OWNER_KEY,
          darkThemeExecutorActive: false,
          postCheckBaseline: null,
        },
        { frameId: resolvedFrameId },
      );

      if (!tokenResult?.ok) {
        completeScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.ROLLED_BACK, {
          reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
          cssId: null,
          cssHash: null,
          scopedV2: null,
        });
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
          comfortPrefs: comfortPrefsForScopedTokens,
          frameId: resolvedFrameId,
        });
        if (guardOverrides) {
          const boosted = pruneDisabledComfortVisualTokens({
            modeId,
            comfortPrefs: effectiveComfortPrefs,
            ...computeTokensV2({
              profile: profileResponse?.profile,
              intensity: normalizedIntensity,
              modeId,
              overrides: { ...comfortOverrides, ...guardOverrides },
            }),
          });
          applyDebugToken(boosted.tokens, boosted.ownedKeys);
          const guardResult = await sendScopeTokenMessage(
            tabId,
            ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
            {
              tokenMap: boosted.tokens,
              ownerKey: SCOPED_MODE_OWNER_KEY,
              darkThemeExecutorActive: false,
              postCheckBaseline: null,
            },
            { frameId: resolvedFrameId },
          );
          if (guardResult?.ok) {
            tokenMap = boosted.tokens;
            ownedKeys = boosted.ownedKeys;
          }
        }
      }
      advanceScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.TOKENS_APPLIED, {
        tokenKeys: ownedKeys || [],
      });
      const { reduceMotionEnabled, smoothTransitionsEnabled, transitionMs } = getSmoothTransitionSettings(
        modeId,
        modePrefs,
        {
          focusReduceMotionV1: isFlagEnabled('focusReduceMotionV1'),
          reducedMotion: globalReduceMotion,
          smoothThemeTransitionsV2: isFlagEnabled('smoothThemeTransitionsV2'),
        },
      );
      const cssText = buildScopedModeCssV2({
        modeId,
        intensity: normalizedIntensity,
        includeDebugSentinels: debugEnabled,
        reduceMotion: reduceMotionEnabled,
        smoothTransitions: false,
        transitionMs,
        spacingPackEnabled:
          modeId === MODE_IDS.COMFORT_VISUAL ? effectiveComfortPrefs?.spacingPack !== false : true,
        textScaleEnabled:
          modeId === MODE_IDS.COMFORT_VISUAL ? effectiveComfortPrefs?.textScale !== false : true,
        ...linkCssOptions,
        ...textRenderingCssOptions,
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
        completeScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.ROLLED_BACK, { reason, detail });
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
      advanceScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.CSS_INSERTED, {
        cssText: safeCssText,
      });
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
        await rollbackPostApplyAttempt({
          reason: APPLY_FAILURE_REASONS.REGISTRY_FAILED,
          safeCssText,
          ownedKeys,
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
          cssId: null,
          cssHash: null,
          scopedV2: null,
        });
        await recordSmartScopeStatus('apply', { ok: false, reason: APPLY_FAILURE_REASONS.REGISTRY_FAILED });
        return { ok: false, reason: APPLY_FAILURE_REASONS.REGISTRY_FAILED };
      }
      advanceScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.CSS_REGISTERED, {
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
      });

      if (darkActivationRequested) {
        const darkActivationResult = await sendScopeTokenMessage(
          tabId,
          ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
          {
            tokenMap,
            ownerKey: SCOPED_MODE_OWNER_KEY,
            darkThemeExecutorActive: true,
            postCheckBaseline: inspectionBaseline,
          },
          { frameId: resolvedFrameId },
        );
        if (!darkActivationResult?.ok) {
          const detail = formatDetail(
            darkActivationResult?.detail || darkActivationResult?.reason,
            APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
          );
          const rollback = await rollbackPostApplyAttempt({
            reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
            registration,
            safeCssText,
            ownedKeys,
          });
          let fallbackFailureDetail = '';
          if (modeId === MODE_IDS.COMFORT_VISUAL && effectiveComfortPrefsForApply?.darkMode === true) {
            const fallbackResult = await applyGlobalSafeFallback(
              {
                reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
                detail,
              },
              resolvedFrameId,
            );
            if (fallbackResult?.ok === true) {
              return fallbackResult;
            }
            fallbackFailureDetail = formatDetail(
              fallbackResult?.reason || fallbackResult?.error || fallbackResult?.detail,
              'GLOBAL_FALLBACK_FAILED',
            );
          }
          const finalDetail = fallbackFailureDetail ? `${detail}|fallback=${fallbackFailureDetail}` : detail;
          await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
            pendingDecision: false,
            cssId: null,
            cssHash: null,
            scopedV2: null,
          });
          await recordSmartScopeStatus('apply', {
            ok: false,
            reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
            detail: finalDetail,
          });
          return {
            ok: false,
            reason: APPLY_FAILURE_REASONS.TOKEN_APPLY_FAILED,
            detail: finalDetail,
            rollback,
            templateEvidence: frameTemplateEvidence || undefined,
          };
        }
      }

      advanceScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.INSPECTING);
      let reflowGuardLevel = modeId === MODE_IDS.COMFORT_VISUAL ? 'soft' : null;
      let inspection = await inspectScopedV2PostApplyInPage(tabId, {
        frameId: resolvedFrameId,
        scopeSelector,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || [],
        baseline: inspectionBaseline,
        budget: { maxNodes: 80, maxMs: 8 },
      });
      if (
        shouldRetryEmergencyReflowGuard({
          modeId,
          inspection,
          runtimeEffectPlan: runtimeEffectPlanForFrame(resolvedFrameId),
        })
      ) {
        const emergency = pruneDisabledComfortVisualTokens({
          modeId,
          comfortPrefs: effectiveComfortPrefs,
          ...computeTokensV2({
            profile: profileResponse?.profile,
            intensity: normalizedIntensity,
            modeId,
            overrides: {
              ...comfortOverrides,
              ...buildComfortEmergencyReflowGuardTokenOverrides(),
            },
          }),
        });
        applyDebugToken(emergency.tokens, emergency.ownedKeys);
        const emergencyTokenResult = await sendScopeTokenMessage(
          tabId,
          ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS,
          {
            tokenMap: emergency.tokens,
            ownerKey: SCOPED_MODE_OWNER_KEY,
          },
          { frameId: resolvedFrameId },
        );
        if (emergencyTokenResult?.ok) {
          tokenMap = emergency.tokens;
          ownedKeys = emergency.ownedKeys;
          reflowGuardLevel = 'emergency';
          recordV2Metric('apply.reflow_guard_emergency_retry', 1, { modeId });
          inspection = await inspectScopedV2PostApplyInPage(tabId, {
            frameId: resolvedFrameId,
            scopeSelector,
            ownerKey: SCOPED_MODE_OWNER_KEY,
            tokenKeys: ownedKeys || [],
            baseline: inspectionBaseline,
            budget: { maxNodes: 80, maxMs: 8 },
          });
          recordV2Metric(
            inspection?.ok ? 'apply.reflow_guard_emergency_success' : 'apply.reflow_guard_emergency_failed',
            1,
            { modeId },
          );
        }
      }
      if (!inspection?.ok) {
        const detail = formatDetail(
          inspection?.blockingFailures?.join(',') || inspection?.detail || inspection?.error || inspection?.reason,
          APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
        );
        const rollback = await rollbackPostApplyAttempt({
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          registration,
          safeCssText,
          ownedKeys,
          inspection,
        });
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
          cssId: null,
          cssHash: null,
          scopedV2: null,
        });
        await recordSmartScopeStatus('apply', {
          ok: false,
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          detail,
        });
        recordV2Metric('apply.post_inspection_failed', 1, { modeId });
        return {
          ok: false,
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          detail,
          inspection,
          rollback,
          templateEvidence: frameTemplateEvidence || undefined,
        };
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

      const existingOutcomeAttemptId = existingModeState?.scopedV2?.outcomeAttemptId || null;
      const outcomeAttemptId = source === 'popup' ? attemptId : existingOutcomeAttemptId;
      const scopedState = {
        attemptId,
        outcomeAttemptId,
        scopeSelector,
        owner: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || [],
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        cssText: safeCssText,
        appliedAt: Date.now(),
        intensity: normalizedIntensity,
        tokens: tokenMap,
        verification,
        frameId: resolvedFrameId,
        applied: scopedApply?.applied !== false,
        transitionCssId: transitionResult?.ok ? transitionResult?.cssId : null,
        transitionCssHash: transitionResult?.ok ? transitionResult?.cssHash : null,
      };
      if (modeId === MODE_IDS.COMFORT_VISUAL && darkApplyRequest) {
        scopedState.darkModeEnabled = darkTokensApplied === true;
        scopedState.darkPaletteAlreadyDark = darkApplyRequest.paletteDiagnostics?.alreadyDark === true;
        scopedState.darkPalettePrefersColorScheme = darkApplyRequest.paletteDiagnostics?.prefersColorScheme || null;
      }
      if (reflowGuardLevel) {
        scopedState.reflowGuardLevel = reflowGuardLevel;
      }
      if (frameTemplateEvidence) {
        scopedState.templateEvidence = frameTemplateEvidence;
      }

      let preludeResult = null;
      if (darkPreludeRequested) {
        try {
          preludeResult = await this.applyPreludeCss(tabId, 'dark-mode-activation', {
            getComfortVisualPrefs: async () => preludeComfortPrefs,
            modeState: { state: STATES.ACTIVE, scopedV2: scopedState },
            updateState: false,
          });
        } catch (error) {
          preludeResult = {
            ok: false,
            applied: false,
            reason: 'prelude-apply-threw',
            detail: formatDetail(error?.message || error, ''),
          };
        }

        if (preludeResult?.ok !== true || preludeResult?.applied !== true) {
          recordV2Metric('apply.prelude_failed', 1, { modeId });
          const detail = formatDetail(
            preludeResult?.detail || preludeResult?.reason || preludeResult?.error,
            'PRELUDE_APPLY_FAILED',
          );
          const rollback = await rollbackPostApplyAttempt({
            reason: 'PRELUDE_APPLY_FAILED',
            registration,
            safeCssText,
            ownedKeys,
          });
          let fallbackFailureDetail = '';
          if (modeId === MODE_IDS.COMFORT_VISUAL && effectiveComfortPrefsForApply?.darkMode === true) {
            const fallbackResult = await applyGlobalSafeFallback(
              {
                reason: 'PRELUDE_APPLY_FAILED',
                detail,
              },
              resolvedFrameId,
            );
            if (fallbackResult?.ok === true) {
              return fallbackResult;
            }
            fallbackFailureDetail = formatDetail(
              fallbackResult?.reason || fallbackResult?.error || fallbackResult?.detail,
              'GLOBAL_FALLBACK_FAILED',
            );
          }
          const finalDetail = fallbackFailureDetail ? `${detail}|fallback=${fallbackFailureDetail}` : detail;
          await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
            pendingDecision: false,
            cssId: null,
            cssHash: null,
            scopedV2: null,
          });
          await recordSmartScopeStatus('apply', {
            ok: false,
            reason: 'PRELUDE_APPLY_FAILED',
            detail: finalDetail,
          });
          return {
            ok: false,
            reason: 'PRELUDE_APPLY_FAILED',
            detail: finalDetail,
            rollback,
            templateEvidence: frameTemplateEvidence || undefined,
          };
        }

        scopedState.preludeCssId = preludeResult.cssId;
        scopedState.preludeHash = preludeResult.preludeHash || null;
        scopedState.preludeAppliedAt = preludeResult.preludeAppliedAt || Date.now();
        scopedState.preludeRefreshCount = preludeResult.preludeRefreshCount || 0;
      }

      await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
        pendingDecision: false,
        smartScope: null,
        scopedV2: scopedState,
      });
      await patchTabRuntime(tabId, { cssId: registration.cssId, modeId, appliedAt: scopedState.appliedAt });
      completeScopedV2Transaction(scopedTransaction, SCOPED_V2_TRANSACTION_PHASES.ACTIVE, {
        cssId: registration.cssId,
        cssHash: registration.cssHash || null,
        preludeApplied: preludeResult?.applied === true,
      });

      await recordSmartScopeStatus('apply', { ok: true, preludeApplied: preludeResult?.applied === true });
      recordV2Metric('apply.success', 1, { modeId });
      recordV2Metric(
        'apply.elapsedMs',
        Math.round((globalThis?.performance?.now ? performance.now() : Date.now()) - start),
        { modeId },
      );

      rememberResolvedScopedV2Scope({
        tabId,
        modeId,
        applyUrlKey,
        scopeSelector,
        frameId: resolvedFrameId,
      });

      return {
        ok: true,
        cssId: registration.cssId,
        variant: 'SCOPED_V2',
        frameId: resolvedFrameId,
        preludeApplied: preludeResult?.applied === true,
        reflowGuardLevel: reflowGuardLevel || undefined,
        templateEvidence: frameTemplateEvidence || undefined,
      };
    };

    const initialResult = policyBlocked ? blockedResult : await applyInFrame(initialFrameId);
    let finalScopeFailure = initialResult;
    const scopedFailures = initialResult?.ok ? [] : [initialResult];
    if (!preventFrameFallback && shouldAttemptFrameFallback(initialResult, source, initialFrameId)) {
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
        finalScopeFailure = fallbackResult;
        scopedFailures.push(fallbackResult);
      }
    }

    const allScopedFailuresAllowGlobalFallback =
      scopedFailures.length > 0 && scopedFailures.every((failure) => shouldApplyGlobalSafeFallback(failure));
    const allScopedFailuresAllowSafeDowngrade =
      scopedFailures.length > 0 &&
      scopedFailures.every(
        (failure) =>
          shouldApplyGlobalSafeFallback(failure) ||
          (
            (failure?.reason || failure?.error) === APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED &&
            failure?.rollback?.cssRemoved === true &&
            failure?.rollback?.tokensRemoved === true &&
            Array.isArray(failure?.rollback?.errors) &&
            failure.rollback.errors.length === 0
          ),
      );
    const focusFallbackFrameId = typeof finalScopeFailure?.frameId === 'number'
      ? finalScopeFailure.frameId
      : initialFrameId;
    const focusFallbackPlan = modeId === MODE_IDS.FOCUS
      ? runtimeEffectPlanForFrame(focusFallbackFrameId)
      : null;
    const focusFallbackCss = focusFallbackPlan
      ? buildSafeDowngradeCss({
          modeId,
          safeDowngrade: focusFallbackPlan.safeDowngrade,
          pageType: focusFallbackPlan.pageType,
          intensity: normalizedIntensity,
        })
      : null;
    const allScopedFailuresAllowFocusLimited = modeId === MODE_IDS.FOCUS
      && (!focusFallbackPlan || focusFallbackCss?.ok === true)
      && scopedFailures.length > 0
      && scopedFailures.every((failure) => shouldApplyFocusLimitedFallback(failure));
    const canApplyGlobalSafeFallback =
      source === 'popup'
      && !preventFrameFallback
      && !(modeId === MODE_IDS.COMFORT_VISUAL && sanitizedRuntimeEffectPlan);
    if (
      canApplyGlobalSafeFallback
      && (allScopedFailuresAllowGlobalFallback || allScopedFailuresAllowSafeDowngrade || allScopedFailuresAllowFocusLimited)
    ) {
      if (allScopedFailuresAllowFocusLimited) {
        const cleanupFrameIds = [...new Set(scopedFailures
          .map((failure) => Number.isInteger(failure?.frameId) ? failure.frameId : initialFrameId))];
        for (const cleanupFrameId of cleanupFrameIds) {
          const cleanup = await sendScopeTokenMessage(
            tabId,
            ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
            { ownerKey: SCOPED_MODE_OWNER_KEY, modeId: MODE_IDS.FOCUS, ownedKeys: [] },
            { frameId: cleanupFrameId },
          );
          const missingScope = /scope-root-missing|not-owner/i.test(`${cleanup?.detail || cleanup?.reason || ''}`);
          if (cleanup?.ok === false && !missingScope) {
            return finalize({
              ok: false,
              reason: 'FOCUS_LIMITED_PRECLEAN_FAILED',
              detail: cleanup?.detail || cleanup?.reason || cleanup?.error || 'TOKEN_CLEANUP_FAILED',
              retryable: true,
            });
          }
        }
      }
      const fallbackFrameId = typeof finalScopeFailure?.frameId === 'number' ? finalScopeFailure.frameId : initialFrameId;
      const fallbackResult = await applyGlobalSafeFallback(finalScopeFailure, fallbackFrameId, {
        requireSupportedSafeDowngrade: allScopedFailuresAllowFocusLimited && Boolean(focusFallbackPlan),
      });
      return finalize(fallbackResult);
    }

    return finalize(finalScopeFailure);
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

    const policyResult = await resolveSitePolicy(tabId, modeId);
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
    let baseCssText = buildModeCss(modeId, STRICT_VARIANT, 'body', normalizedIntensity);
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
    let patchDarkModeEnabled = null;
    let patchTextScaleEnabled = null;
    let patchSpacingPackEnabled = null;
    let patchLinkEnhanceEnabled = null;
    let patchTypoSmoothingEnabled = null;

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
        patchDarkModeEnabled = smartResult.darkModeEnabled === true;
        patchTextScaleEnabled = smartResult.textScaleEnabled !== false;
        patchSpacingPackEnabled = smartResult.spacingPackEnabled !== false;
        patchLinkEnhanceEnabled = smartResult.linkEnhanceEnabled !== false;
        patchTypoSmoothingEnabled = smartResult.typoSmoothingEnabled !== false;
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
          patchCssId: patchCssId || null,
          cssId: patchCssId || null,
          cssHash: patchCssHash || null,
          baseCssId,
          baseCssHash,
          darkModeEnabled: patchDarkModeEnabled === true,
          textScaleEnabled: patchTextScaleEnabled !== false,
          spacingPackEnabled: patchSpacingPackEnabled !== false,
          linkEnhanceEnabled: patchLinkEnhanceEnabled !== false,
          typoSmoothingEnabled: patchTypoSmoothingEnabled !== false,
          profiledAt: profiledAt || appliedAt,
          appliedAt,
          frameId: typeof requestedFrameId === 'number' ? requestedFrameId : null,
          verified: verificationPassed,
          configLevel: smartScopeConfig.level,
          scopeProfile,
          intensity: normalizedIntensity,
        }
      : null;

    await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
      cssId: appliedCssId,
      cssHash: appliedCssHash,
      frameId: typeof requestedFrameId === 'number' ? requestedFrameId : null,
      activeQuality:
        usedSmartScope && verificationPassed
          ? ACTIVE_QUALITIES.SMARTSCOPE_V1_VERIFIED
          : ACTIVE_QUALITIES.LEGACY_UNVERIFIED,
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
    const inspectionBaselineResult = await collectScopedV2InspectionBaselineInPage(tabId, {
      frameId,
      scopeSelector: scopedState.scopeSelector,
      ownerKey: SCOPED_MODE_OWNER_KEY,
      budget: { maxNodes: 80, maxMs: 8 },
    });
    if (!inspectionBaselineResult?.ok) {
      return {
        ok: false,
        reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
        inspection: inspectionBaselineResult,
      };
    }

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
      const inspection = await inspectScopedV2PostApplyInPage(tabId, {
        frameId,
        scopeSelector: scopedState.scopeSelector,
        ownerKey: SCOPED_MODE_OWNER_KEY,
        tokenKeys: ownedKeys || Object.keys(tokenMap),
        baseline: inspectionBaselineResult.baseline || null,
        budget: { maxNodes: 80, maxMs: 8 },
      });
      if (!inspection?.ok) {
        await this.removeModeScopedV2(tabId, modeId, { modeState, updateState: false }).catch(() => {});
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
          cssId: null,
          cssHash: null,
          scopedV2: null,
        });
        return {
          ok: false,
          reason: APPLY_FAILURE_REASONS.POST_APPLY_INSPECTION_FAILED,
          inspection,
        };
      }
      await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
        scopedV2: { ...scopedState, tokenKeys: ownedKeys || Object.keys(tokenMap) },
      });
    }

    return result || { ok: false, reason: 'token-update-failed' };
  }

  async removeMode(tabId, modeId, options = {}) {
    const normalizedOptions = options && typeof options === 'object' && !Array.isArray(options) ? { ...options } : {};
    let lifecycleIntent = normalizedOptions.lifecycleIntent || null;
    const managesLifecycle = !lifecycleIntent;
    if (!lifecycleIntent) {
      try {
        lifecycleIntent = await claimLifecycleIntent({
          tabId,
          modeId,
          kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
          targetState: STATES.INACTIVE,
          source: normalizedOptions.source || 'remove',
        });
        normalizedOptions.lifecycleIntent = lifecycleIntent;
      } catch (error) {
        return { ok: false, reason: 'LIFECYCLE_STORAGE_UNAVAILABLE', detail: error?.message, retryable: true };
      }
    }
    return this._enqueueModeOperation(tabId, modeId, async () => {
      if (normalizedOptions.lifecycleIntent) {
        try {
          const runningLifecycle = await beginLifecycleIntent(normalizedOptions.lifecycleIntent);
          if (runningLifecycle?.supersededOperation) {
            const inheritedCleanup = await cleanupLifecycleArtifacts(runningLifecycle);
            if (!inheritedCleanup.ok) {
              return {
                ok: false,
                reason: 'LIFECYCLE_TAKEOVER_CLEANUP_FAILED',
                retryable: true,
                details: inheritedCleanup.failures,
              };
            }
          }
        } catch (error) {
          return {
            ok: false,
            reason: error?.message || 'LIFECYCLE_BEGIN_FAILED',
            retryable: error?.message !== 'LIFECYCLE_OPERATION_STALE',
          };
        }
      }
      if (isFlagEnabled('scopedModeCssV2')) {
        const modeState = await this.stateManager.getModeState(tabId, modeId);
        if (modeState?.scopedV2) {
          const result = await this.removeModeScopedV2(tabId, modeId, { ...normalizedOptions, modeState });
          if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, result);
          return result;
        }

        if (modeState?.smartScope || modeState?.cssId) {
          const result = await this.removeModeV1(tabId, modeId, normalizedOptions);
          if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, result);
          return result;
        }

        const result = await this.removeModeScopedV2(tabId, modeId, { ...normalizedOptions, modeState });
        if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, result);
        return result;
      }

      const result = await this.removeModeV1(tabId, modeId, normalizedOptions);
      if (managesLifecycle) await finishLifecycleIntent(lifecycleIntent, result);
      return result;
    });
  }

  async removeModeScopedV2(tabId, modeId, options = {}) {
    const updateState = options?.updateState !== false;

    if (!isValidTabId(tabId)) {
      return { ok: false };
    }

    const modeState = options.modeState || (await this.stateManager.getModeState(tabId, modeId));
    const scopedState = modeState?.scopedV2;
    const scopeSelector = options.scopeSelector || scopedState?.scopeSelector;
    const frameId = typeof scopedState?.frameId === 'number' ? scopedState.frameId : 0;
    const cssId = scopedState?.cssId || modeState?.cssId || null;
    const memoryState = getScopedModeV2State(tabId, frameId);

    if (!scopeSelector && !scopedState && !cssId && !memoryState) {
      if (options?.lifecycleIntent?.targetState === STATES.INACTIVE) {
        if (updateState) {
          await this.stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
            cssId: null,
            cssHash: null,
            smartScope: null,
            scopedV2: null,
            pendingDecision: false,
          });
        }
        return { ok: true, removed: false, reason: 'already-inactive' };
      }
      return { ok: false, reason: 'no-scope' };
    }

    if (isNonTrivialScope(scopeSelector)) {
      const urlKey = await resolveUrlKey(tabId);
      rememberResolvedScopedV2Scope({
        tabId,
        modeId,
        applyUrlKey: urlKey,
        scopeSelector,
        frameId,
      });
    }

    const modePrefs =
      typeof this.stateManager?.getModePrefs === 'function'
        ? await this.stateManager.getModePrefs(modeId)
        : null;
    const globalReduceMotion = await getGlobalReduceMotionPreference();
    const { smoothTransitionsEnabled, transitionMs } = getSmoothTransitionSettings(modeId, modePrefs, {
      focusReduceMotionV1: isFlagEnabled('focusReduceMotionV1'),
      reducedMotion: globalReduceMotion,
      smoothThemeTransitionsV2: isFlagEnabled('smoothThemeTransitionsV2'),
    });

    const removalResult = await removeScopedModeV2({
      tabId,
      frameId,
      modeId,
      cssId,
      scopedState,
      registry: this.registry,
      preserveScope: smoothTransitionsEnabled,
      transitionMs: smoothTransitionsEnabled ? transitionMs : 0,
      requireTokenCleanup: updateState,
    });

    if (removalResult?.ok === false) {
      if (updateState) {
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
        });
        await this.stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'restore',
          ok: false,
          error: removalResult.error || 'RESTORE_FAILED',
          retryable: removalResult.retryable === true,
          detail: removalResult.details?.cssRemovalError || null,
          timestamp: Date.now(),
        });
      }
      return {
        ...removalResult,
        reason: removalResult.reason || removalResult.error || 'RESTORE_FAILED',
        retryable: true,
      };
    }

    await this.removeTransitionsCss(tabId, modeId, { modeState, updateState: false });

    if (updateState && modeId === MODE_IDS.COMFORT_VISUAL) {
      let preludeRemovalResult = null;
      try {
        preludeRemovalResult = await this.removePreludeCss(tabId, 'mode-disabled', { modeState });
      } catch (error) {
        preludeRemovalResult = {
          ok: false,
          reason: 'RESTORE_PRELUDE_REMOVE_FAILED',
          detail: error?.message || 'removePreludeCss failed',
        };
      }

      if (preludeRemovalResult?.ok === false) {
        await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
          pendingDecision: false,
        });
        await this.stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'restore',
          ok: false,
          error: preludeRemovalResult.reason || 'RESTORE_PRELUDE_REMOVE_FAILED',
          retryable: true,
          detail: preludeRemovalResult.detail || null,
          timestamp: Date.now(),
        });
        return {
          ok: false,
          reason: preludeRemovalResult.reason || 'RESTORE_PRELUDE_REMOVE_FAILED',
          retryable: true,
          details: {
            ...(removalResult?.details || {}),
            preludeRemoval: preludeRemovalResult,
          },
        };
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

  async removeModeV1(tabId, modeId, _options = {}) {
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
    const frameId =
      typeof smartScopeState?.frameId === 'number'
        ? smartScopeState.frameId
        : typeof modeState?.frameId === 'number'
          ? modeState.frameId
          : undefined;
    const allFrames = smartScopeState?.allFrames === true;
    const baseRemovalTargets = allFrames
      ? [
          { tabId, allFrames: true },
          { tabId },
        ]
      : [typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId }];
    const defaultRemovalTargets = allFrames
      ? [{ tabId, allFrames: true }, { tabId }]
      : [typeof frameId === 'number' ? { tabId, frameIds: [frameId] } : { tabId }];
    const messageOptions = !allFrames && typeof frameId === 'number' ? { frameId } : undefined;
    const cssRemovalFailures = [];
    const registryIdsToRemove = new Set();

    const removeCssText = async ({ cssText, origin = CSS_ORIGIN, label }) => {
      if (!cssText) {
        return false;
      }
      let removed = true;
      const targets = label === 'base' ? baseRemovalTargets : defaultRemovalTargets;
      for (const target of targets) {
        try {
          await chrome.scripting.removeCSS({ target, css: cssText, origin });
        } catch (error) {
          removed = false;
          cssRemovalFailures.push({
            label,
            error: error?.message || 'removeCSS failed',
          });
        }
      }
      return removed;
    };

    const removeRegisteredCss = async (cssId, label) => {
      if (!cssId) {
        return false;
      }

      const entry = await this.registry.get(cssId);
      if (entry?.cssText) {
        const removed = await removeCssText({
          cssText: entry.cssText,
          origin: entry.origin || CSS_ORIGIN,
          label,
        });
        if (!removed) {
          return false;
        }
      }

      registryIdsToRemove.add(cssId);
      return Boolean(entry?.cssText);
    };

    if (domClassToken) {
      await contentBridge.safeSend(tabId, { action: SMARTSCOPE_ACTIONS.REMOVE_TOKEN, token: domClassToken }, messageOptions);
    }

    const smartScopePatchCssId = smartScopeState?.patchCssId || smartScopeState?.cssId || null;

    let smartScopePatchRemoved = false;

    if (
      modeId === MODE_IDS.COMFORT_VISUAL
      && smartScopeState?.variant === GLOBAL_SAFE_FALLBACK_VARIANT
      && smartScopeState?.darkModeEnabled === true
    ) {
      const runtimeCleanup = await cleanupGlobalDarkComfortRuntime(
        tabId,
        Array.isArray(smartScopeState?.globalDarkRuntime?.documents)
          ? smartScopeState.globalDarkRuntime.documents
          : [],
      ).catch((error) => ({ ok: false, reason: error?.message || 'global-dark-runtime-cleanup-failed' }));
      if (runtimeCleanup?.ok !== true) {
        await this.stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'restore',
          ok: false,
          error: runtimeCleanup?.reason || 'DARK_RUNTIME_CLEANUP_FAILED',
          retryable: true,
          timestamp: Date.now(),
        });
        return {
          ok: false,
          reason: runtimeCleanup?.reason || 'DARK_RUNTIME_CLEANUP_FAILED',
          retryable: true,
        };
      }
    }

    if (smartScopePatchCssId) {
      smartScopePatchRemoved = await removeRegisteredCss(smartScopePatchCssId, 'smartscope-patch');
    }

    if (
      !smartScopePatchRemoved
      && smartScopeState?.variant
      && ![GLOBAL_SAFE_FALLBACK_VARIANT, PAGE_CLARITY_LIMITED_VARIANT, PAGE_CLARITY_MEDIUM_VARIANT].includes(smartScopeState.variant)
    ) {
      const patchCss = buildSmartScopePatchCSS(modeId, smartScopeState.intensity || 1, smartScopeState.variant, {
        darkModeEnabled: smartScopeState.darkModeEnabled === true,
        textScaleEnabled: smartScopeState.textScaleEnabled !== false,
        spacingPackEnabled: smartScopeState.spacingPackEnabled !== false,
        linkEnhanceEnabled: smartScopeState.linkEnhanceEnabled !== false,
        typoSmoothingEnabled: smartScopeState.typoSmoothingEnabled !== false,
      });
      await removeCssText({ cssText: patchCss, origin: CSS_ORIGIN, label: 'smartscope-patch-reconstructed' });
    }

    const baseCssId = smartScopeState?.baseCssId || modeState?.cssId;

    if (baseCssId) {
      await removeRegisteredCss(baseCssId, 'base');
    } else {
      console.warn('[CssApplier] Missing cssId for removal; performing best-effort cleanup');
    }

    if (cssRemovalFailures.length > 0) {
      await this.stateManager.updateModeState(tabId, modeId, STATES.ERROR, {
        pendingDecision: false,
      });
      await this.stateManager.setSmartScopeStatus(tabId, modeId, {
        action: 'restore',
        ok: false,
        error: 'RESTORE_CSS_REMOVE_FAILED',
        retryable: true,
        detail: cssRemovalFailures.map((failure) => `${failure.label}:${failure.error}`).join(','),
        timestamp: Date.now(),
      });
      return {
        ok: false,
        reason: 'RESTORE_CSS_REMOVE_FAILED',
        error: 'RESTORE_CSS_REMOVE_FAILED',
        retryable: true,
        details: {
          cssRemovalFailures,
        },
      };
    }

    if ([PAGE_CLARITY_LIMITED_VARIANT, PAGE_CLARITY_MEDIUM_VARIANT].includes(smartScopeState?.variant)) {
      await contentBridge.safeSend(
        tabId,
        { action: ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1 },
        messageOptions,
      );
    }

    for (const cssId of registryIdsToRemove) {
      await this.registry.remove(cssId);
    }

    await this.stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
      cssId: null,
      cssHash: null,
      frameId: null,
      pendingDecision: false,
      smartScope: null,
      scopedV2: null,
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
