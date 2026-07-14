(() => {

const MODE_IDS = globalThis?.AURA?.MODE_IDS || {
  COMFORT_VISUAL: 'comfort-visual',
  FOCUS: 'focus'
};

const SCOPE_ATTR = 'data-aura-scope';
const SCOPE_ATTR_VALUE = '1';
const SCOPE_OWNER_ATTR = 'data-aura-scope-owner';
const SCOPE_OWNER_VALUE = 'aura-me2';
const ANIM_ATTR = 'data-aura-anim';
const ANIM_ATTR_VALUE = '1';

const MODE_ENGINE_SCOPE_SELECTOR = '[data-aura-scope="1"]';
const MODE_ENGINE_SCOPE_ATTR = SCOPE_ATTR;
const MODE_ENGINE_SCOPE_VALUE = SCOPE_ATTR_VALUE;
const MODE_ENGINE_SCOPE_OWNER_ATTR = SCOPE_OWNER_ATTR;
const MODE_ENGINE_SCOPE_TOKENS_ATTR = 'data-aura-scope-tokens';
const AURA_SURFACE_ATTR = 'data-aura-surface';
const AURA_FORCE_TEXT_ATTR = 'data-aura-force-text';
const AURA_SURFACE_KIND_ATTR = 'data-aura-surface-kind';
const AURA_SURFACE_DEFAULT_BUDGET = { maxNodes: 600, maxMs: 12 };
const AURA_SURFACE_MIN_AREA = 16000;
const AURA_SURFACE_LIGHT_THRESHOLD = 0.8;
const AURA_SURFACE_MAX_SURFACES = 40;
const AURA_FORCE_TEXT_MAX_NODES = 80;
const AURA_SURFACE_OBSERVER_DELAY = 200;
const AURA_SURFACE_SKIP_TAGS = new Set([
  'AUDIO',
  'CANVAS',
  'EMBED',
  'IFRAME',
  'IMG',
  'OBJECT',
  'PICTURE',
  'SVG',
  'VIDEO',
]);
const AURA_FORM_CONTROL_TAGS = new Set([
  'BUTTON',
  'INPUT',
  'METER',
  'OPTGROUP',
  'OPTION',
  'PROGRESS',
  'SELECT',
  'TEXTAREA',
]);
const AURA_CODE_SURFACE_TAGS = new Set([
  'CODE',
  'KBD',
  'PRE',
  'SAMP',
]);
const AURA_APP_SHELL_TAGS = new Set(['ASIDE', 'FOOTER', 'HEADER', 'NAV']);
const AURA_APP_SHELL_ROLES = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'menubar',
  'navigation',
  'search',
  'toolbar',
]);
const AURA_APP_SHELL_IDENTITY_TOKENS = [
  'appbar',
  'app-bar',
  'app_shell',
  'app-shell',
  'commandbar',
  'command-bar',
  'drawer',
  'layout-header',
  'masthead',
  'navbar',
  'nav-bar',
  'rail',
  'side-nav',
  'sidebar',
  'sidepanel',
  'side-panel',
  'stickybar',
  'sticky-bar',
  'toolbar',
  'topbar',
  'top-bar',
];
const AURA_INLINE_SURFACE_DEFAULTS = {
  maxNodes: 600,
  maxMs: 12,
  minArea: 16000,
  lumThreshold: 0.8,
  cardLumThreshold: 0.86,
  maxCandidates: 40,
  maxForceText: 80,
};
// Targeted skip list for known decorative/layout containers (keep minimal).
const AURA_SURFACE_DENYLIST_SELECTORS = [
  '.mw-page-base',
  '#mw-page-base',
  '#mw-navigation',
  '.vector-header-container',
  '.vector-page-toolbar',
];
// KEEP IN SYNC with shared/mode-engine-scoped-v2.js (SCOPED_TOKEN_KEYS).
const SCOPED_TOKEN_KEYS = [
  '--aura-font-size',
  '--aura-line-height',
  '--aura-letter-spacing',
  '--aura-paragraph-spacing',
  '--aura-font-smoothing',
  '--aura-measure-max-inline-size',
  '--aura-overflow-wrap',
  '--aura-word-break',
  '--aura-hyphens',
  '--aura-text-color',
  '--aura-bg-color',
  '--aura-surface-1',
  '--aura-surface-2',
  '--aura-muted-text-color',
  '--aura-border-color',
  '--aura-link-color',
  '--aura-link-visited-color',
  '--aura-link-hover-color',
  '--aura-link-decoration',
  '--aura-link-decoration-thickness',
  '--aura-link-decoration-offset',
  '--aura-link-underline-position',
  '--aura-color-scheme',
  '--aura-focus-color',
];

const AURA_SURFACE_OBSERVERS = new WeakMap();
const AURA_SURFACE_TAG_STATE = {
  surface: new Set(),
  forceText: new Set(),
};
const AURA_INLINE_SURFACE_STATE = {
  prev: new WeakMap(),
  applied: new WeakMap(),
  touched: new Set(),
};

function isModeEngineDebugEnabled() {
  try {
    return Boolean(globalThis?.AURA?.modeEngineFlags?.isEnabled?.('debugModeEngine'));
  } catch (_) {
    return false;
  }
}

function modeEngineDebugLog(...args) {
  if (!isModeEngineDebugEnabled()) {
    return;
  }

  const logger = globalThis?.AURA?.modeEngineDebugLog;
  if (typeof logger === 'function') {
    logger(...args);
    return;
  }

  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[AURA][ModeEngine]', ...args);
  }
}

function describeScopeElement(el) {
  if (!el) {
    return null;
  }

  return {
    tag: typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '',
    id: typeof el.id === 'string' ? el.id : '',
    class: typeof el.className === 'string' ? el.className : '',
  };
}

function mapVerificationReason(element, evaluation) {
  if (!element) {
    return 'ROOT_NULL';
  }

  const tagName = (element.tagName || '').toLowerCase();
  if (tagName === 'html') {
    return 'ROOT_IS_HTML';
  }
  if (tagName === 'body') {
    return 'ROOT_IS_BODY';
  }
  if (element.isConnected === false) {
    return 'ROOT_NOT_CONNECTED';
  }
  if (evaluation?.reason === 'not-visible') {
    return 'ROOT_HIDDEN';
  }

  if (evaluation?.reason === 'too-small') {
    return 'ROOT_TOO_SMALL';
  }

  if (evaluation?.reason === 'too-large') {
    return 'ROOT_TOO_LARGE';
  }

  if (evaluation?.reason === 'selector-non-unique') {
    return 'ROOT_SELECTOR_NON_UNIQUE';
  }

  return 'OTHER';
}

/**
 * @typedef {Record<string, string>} TokenMap
 */

function getTokenKeys(tokens = {}) {
  return Object.keys(tokens || {}).filter((key) => typeof key === 'string');
}

function computeTokensV2({ profile, intensity, modeId, overrides = {} } = {}) {
  const normalized = clampIntensity(intensity);
  const tokens = buildScopedTokenMap(modeId, normalized, profile);
  const mergedTokens = { ...tokens, ...(overrides || {}) };

  return { tokens: mergedTokens, ownedKeys: getTokenKeys(mergedTokens) };
}

/**
 * @typedef {Object} ScopedV2State
 * @property {string} cssId
 * @property {string} modeId
 * @property {string} scopeSelector
 * @property {{ tag: string, role?: string | null }} [scopeRootInfo]
 * @property {string} [lastAppliedHash]
 * @property {string[]} ownedTokenKeys
 * @property {boolean} [ownedScopeAttr]
 * @property {number} [lastAppliedAtMs]
 */

function makeScopedV2Key(tabId, frameId = 0) {
  const normalizedTabId = typeof tabId === 'number' && Number.isFinite(tabId) ? tabId : -1;
  const normalizedFrameId = typeof frameId === 'number' && Number.isFinite(frameId) ? frameId : 0;
  return { tabId: normalizedTabId, frameId: normalizedFrameId };
}

function stableTokenPairs(tokens = {}) {
  return Object.entries(tokens)
    .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

function simpleHash(str = '') {
  let hash = 0;
  const normalized = `${str}`;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return `h${Math.abs(hash)}`;
}

function computeAppliedHash({ cssText = '', tokens = {}, cssId = '', modeId = '' } = {}) {
  const parts = [String(cssId), String(modeId), String(cssText), stableTokenPairs(tokens)].join('#');
  return simpleHash(parts);
}

function clampIntensity(rawIntensity) {
  if (typeof rawIntensity !== 'number' || Number.isNaN(rawIntensity)) {
    return 1;
  }
  return Math.min(Math.max(rawIntensity, 0), 1);
}

function buildScopedTokenMap(modeId, intensity = 1, _profile = null) {
  const normalized = clampIntensity(intensity);
  const baseScale = 1 + normalized * 0.08;
  const fontSizePx = 16 * baseScale;
  const lineHeight = 1.55 + normalized * 0.25;
  const spacingPx = 10 + normalized * 4;
  const letterSpacingPx = 0.15 + normalized * 0.2;

  const isFocus = modeId === MODE_IDS.FOCUS;
  const adjustedLineHeight = isFocus ? Math.min(lineHeight + 0.05, 2) : Math.min(lineHeight, 2);

  return {
    '--aura-font-size': `${fontSizePx.toFixed(2)}px`,
    '--aura-line-height': adjustedLineHeight.toFixed(2),
    '--aura-measure-max-inline-size': 'none',
    '--aura-overflow-wrap': 'normal',
    '--aura-word-break': 'normal',
    '--aura-hyphens': 'manual',
    '--aura-letter-spacing': `${letterSpacingPx.toFixed(2)}px`,
    '--aura-paragraph-spacing': `${spacingPx.toFixed(2)}px`,
  };
}

function buildScopedModeCssV2({
  modeId,
  intensity,
  includeDebugSentinels = false,
  reduceMotion = false,
  smoothTransitions = false,
  transitionMs = 160,
  animAttrName = ANIM_ATTR,
  textScaleEnabled = true,
  spacingPackEnabled = true,
  linkEnhanceEnabled = true,
  linkColorEnabled = linkEnhanceEnabled,
  typoSmoothingEnabled = true,
} = {}) {
  const scope = MODE_ENGINE_SCOPE_SELECTOR;
  const normalized = clampIntensity(intensity);
  const baseFontSize = 16 * (1 + normalized * 0.08);
  const baseLineHeight = 1.55 + normalized * 0.25;
  const headingLineHeight = Math.min(baseLineHeight + 0.05, 2);
  const paragraphSpacing = 10 + normalized * 4;
  const letterSpacing = 0.15 + normalized * 0.2;
  const textScaleActive = modeId !== MODE_IDS.COMFORT_VISUAL || textScaleEnabled !== false;
  const spacingPackActive = modeId !== MODE_IDS.COMFORT_VISUAL || spacingPackEnabled !== false;
  const typoSmoothingActive = modeId === MODE_IDS.COMFORT_VISUAL && typoSmoothingEnabled !== false;
  const letterSpacingActive = modeId === MODE_IDS.FOCUS || typoSmoothingActive;
  const normalizedTransitionMs =
    typeof transitionMs === 'number' && Number.isFinite(transitionMs) && transitionMs >= 0
      ? Math.round(transitionMs)
      : 160;
  const resolvedAnimAttr = typeof animAttrName === 'string' && animAttrName.trim() ? animAttrName.trim() : ANIM_ATTR;
  const transitionSelector = `${scope}[${resolvedAnimAttr}="${ANIM_ATTR_VALUE}"] :where(*, *::before, *::after)`;
  const transitionProperties = 'color, background-color, border-color, text-decoration-color, fill, stroke, box-shadow';
  const transitionRule = smoothTransitions
    ? `${transitionSelector} { transition-property: ${transitionProperties}; transition-duration: ${normalizedTransitionMs}ms; transition-timing-function: ease; }`
    : '';
  const prefersReduceMotionRule = smoothTransitions
    ? `@media (prefers-reduced-motion: reduce) { ${transitionSelector} { animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; } ${scope}, ${scope} :where(*) { scroll-behavior: auto; } }`
    : '';

  const containerLineHeight = spacingPackActive
    ? ` line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)});`
    : '';
  const textLineHeight = spacingPackActive
    ? ` line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)});`
    : '';
  const headingLineHeightRule = spacingPackActive
    ? ` line-height: var(--aura-line-height, ${headingLineHeight.toFixed(2)});`
    : '';
  const containerFontSize = textScaleActive
    ? ` font-size: var(--aura-font-size, ${baseFontSize.toFixed(2)}px);`
    : '';
  const textFontSize = textScaleActive
    ? ` font-size: var(--aura-font-size, ${baseFontSize.toFixed(2)}px);`
    : '';
  const containerFontSmoothing = typoSmoothingActive
    ? ' -webkit-font-smoothing: var(--aura-font-smoothing);'
    : '';
  const textLetterSpacing = letterSpacingActive
    ? ` letter-spacing: var(--aura-letter-spacing, ${letterSpacing.toFixed(2)}px);`
    : '';
  const containerRule =
    `${scope} { --aura-me2-applied: 1;${containerFontSize}${containerLineHeight} color: var(--aura-text-color, inherit); background-color: var(--aura-bg-color, transparent); color-scheme: var(--aura-color-scheme) !important;${containerFontSmoothing} box-sizing: border-box; }`;
  const textRule =
    `${scope} :is(p, li, blockquote, pre, code, dd, dt) {${textFontSize}${textLineHeight} color: var(--aura-text-color, inherit);${textLetterSpacing} max-inline-size: var(--aura-measure-max-inline-size, none); }`;
  const darkTextDescendantRule =
    `${scope} :where(p, li, blockquote, dd, dt, span, em, strong, small, th, td, label, legend, caption, figcaption) { color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; }`;
  const proseReflowRule =
    `${scope} :where(p, blockquote, dd, dt) { overflow-wrap: var(--aura-overflow-wrap, normal); word-break: var(--aura-word-break, normal); hyphens: var(--aura-hyphens, manual); }`;
  const codeReflowResetRule =
    `${scope} :where(pre, code, kbd, samp) { overflow-wrap: normal; word-break: normal; hyphens: manual; }`;
  const paragraphRule =
    spacingPackActive
      ? `${scope} p + p { margin-top: var(--aura-paragraph-spacing, ${paragraphSpacing.toFixed(2)}px); }`
      : '';
  const headingRule =
    `${scope} :where(h1, h2, h3, h4, h5, h6, [role="heading"]), ${scope} :where(h1, h2, h3, h4, h5, h6, [role="heading"]) * {${headingLineHeightRule} color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; text-decoration-color: currentColor; }`;
  const anchorColorRule = linkColorEnabled
    ? `${scope} :is(a, [role="link"]) { color: var(--aura-link-color); -webkit-text-fill-color: var(--aura-link-color); }`
    : '';
  const anchorDecorationRule = linkEnhanceEnabled
    ? `${scope} :is(a, [role="link"]) { text-decoration-line: var(--aura-link-decoration); text-decoration-thickness: var(--aura-link-decoration-thickness); text-underline-offset: var(--aura-link-decoration-offset); text-decoration-color: currentColor; text-underline-position: var(--aura-link-underline-position); }`
    : '';
  const anchorVisitedRule =
    linkColorEnabled ? `${scope} :is(a):visited { color: var(--aura-link-visited-color); -webkit-text-fill-color: var(--aura-link-visited-color); }` : '';
  const anchorHoverRule =
    linkColorEnabled ? `${scope} :is(a, [role="link"]):hover { color: var(--aura-link-hover-color); -webkit-text-fill-color: var(--aura-link-hover-color); }` : '';
  const taggedSurfaceRule =
    `${scope} [data-aura-surface="1"] { background-color: var(--aura-surface-1) !important; border-color: var(--aura-border-color) !important; }`;
  const taggedSurfaceRaisedRule =
    `${scope} [data-aura-surface="2"] { background-color: var(--aura-surface-2) !important; border-color: var(--aura-border-color) !important; }`;
  const taggedAppShellRule =
    `${scope} [data-aura-surface-kind="app-shell"] { background-color: var(--aura-surface-2) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; box-shadow: 0 1px 0 var(--aura-border-color) !important; }`;
  const taggedAppShellContentRule =
    `${scope} [data-aura-surface-kind="app-shell"] :where(a, [role="link"], button, [role="button"], span, p, small, strong, em, label, summary) { color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const forceTextRule =
    `${scope} [data-aura-force-text="1"] { color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; }`;
  const forceTextContentRule =
    `${scope} [data-aura-force-text="1"] :where(p, li, span, h1, h2, h3, h4, h5, h6, dt, dd, blockquote, code, pre) { color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; }`;
  const borderRule =
    `${scope} :is(table, thead, tbody, tr, td, th, blockquote, pre, code, hr) { border-color: var(--aura-border-color); }`;
  const mutedTextRule =
    `${scope} :is(caption, figcaption, small) { color: var(--aura-muted-text-color, inherit); -webkit-text-fill-color: var(--aura-muted-text-color, inherit); }`;
  const controlRule =
    `${scope} :where(input, textarea, select, button) { background-color: var(--aura-surface-2) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const controlPlaceholderRule =
    `${scope} :is(input, textarea, select)::placeholder { color: var(--aura-muted-text-color, inherit); -webkit-text-fill-color: var(--aura-muted-text-color, inherit); }`;
  const darkTokenScope = `${scope}[data-aura-scope-tokens*="--aura-color-scheme"]`;
  const darkTokenScopeRootRule =
    `${darkTokenScope} { background-color: var(--aura-bg-color) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const darkDesignSystemLocalTokenSelector =
    ':where(dialog, [popover], [aria-modal="true"], [data-theme], [data-color-mode], [data-bs-theme], [data-mui-color-scheme], [data-surface], [data-card], [data-panel], [data-dialog], [data-popover], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="card" i], [class*="panel" i], [class*="surface" i], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="menu" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"], [role="tabpanel"])';
  const darkDesignSystemTokenDeclarationsRaw =
    '--background: var(--aura-bg-color) !important; --foreground: var(--aura-text-color) !important; --card: var(--aura-surface-1) !important; --card-foreground: var(--aura-text-color) !important; --popover: var(--aura-surface-1) !important; --popover-foreground: var(--aura-text-color) !important; --primary: var(--aura-link-color) !important; --primary-foreground: var(--aura-bg-color) !important; --secondary: var(--aura-surface-2) !important; --secondary-foreground: var(--aura-text-color) !important; --muted: var(--aura-surface-2) !important; --muted-foreground: var(--aura-muted-text-color) !important; --accent: var(--aura-surface-2) !important; --accent-foreground: var(--aura-text-color) !important; --destructive: #7f1d1d !important; --destructive-foreground: #fecaca !important; --border: var(--aura-border-color) !important; --input: var(--aura-border-color) !important; --ring: var(--aura-focus-color) !important; --sidebar: var(--aura-surface-1) !important; --sidebar-foreground: var(--aura-text-color) !important; --sidebar-primary: var(--aura-link-color) !important; --sidebar-primary-foreground: var(--aura-bg-color) !important; --sidebar-accent: var(--aura-surface-2) !important; --sidebar-accent-foreground: var(--aura-text-color) !important; --sidebar-border: var(--aura-border-color) !important; --sidebar-ring: var(--aura-focus-color) !important; --surface: var(--aura-surface-1) !important; --surface-foreground: var(--aura-text-color) !important; --panel: var(--aura-surface-1) !important; --panel-foreground: var(--aura-text-color) !important; --color-background: var(--aura-bg-color) !important; --color-foreground: var(--aura-text-color) !important; --color-surface: var(--aura-surface-1) !important; --color-surface-2: var(--aura-surface-2) !important; --color-text: var(--aura-text-color) !important; --color-muted: var(--aura-muted-text-color) !important; --color-border: var(--aura-border-color) !important; --color-link: var(--aura-link-color) !important; --bs-body-bg: var(--aura-bg-color) !important; --bs-body-color: var(--aura-text-color) !important; --bs-border-color: var(--aura-border-color) !important; --bs-link-color: var(--aura-link-color) !important; --bs-link-hover-color: var(--aura-link-hover-color) !important; --bs-secondary-bg: var(--aura-surface-2) !important; --bs-tertiary-bg: var(--aura-surface-1) !important; --bs-emphasis-color: var(--aura-text-color) !important; --mui-palette-background-default: var(--aura-bg-color) !important; --mui-palette-background-paper: var(--aura-surface-1) !important; --mui-palette-text-primary: var(--aura-text-color) !important; --mui-palette-text-secondary: var(--aura-muted-text-color) !important; --mui-palette-divider: var(--aura-border-color) !important; --mui-palette-primary-main: var(--aura-link-color) !important; --mui-palette-action-hover: var(--aura-surface-2) !important; --ant-color-bg-container: var(--aura-surface-1) !important; --ant-color-bg-elevated: var(--aura-surface-1) !important; --ant-color-bg-layout: var(--aura-bg-color) !important; --ant-color-text: var(--aura-text-color) !important; --ant-color-text-secondary: var(--aura-muted-text-color) !important; --ant-color-border: var(--aura-border-color) !important; --ant-color-primary: var(--aura-link-color) !important; --ant-color-link: var(--aura-link-color) !important; --chakra-colors-chakra-body-bg: var(--aura-bg-color) !important; --chakra-colors-chakra-body-text: var(--aura-text-color) !important; --chakra-colors-bg: var(--aura-bg-color) !important; --chakra-colors-bg-subtle: var(--aura-surface-1) !important; --chakra-colors-bg-muted: var(--aura-surface-2) !important; --chakra-colors-fg: var(--aura-text-color) !important; --chakra-colors-fg-muted: var(--aura-muted-text-color) !important; --chakra-colors-border: var(--aura-border-color) !important; --md-sys-color-background: var(--aura-bg-color) !important; --md-sys-color-on-background: var(--aura-text-color) !important; --md-sys-color-surface: var(--aura-surface-1) !important; --md-sys-color-surface-container: var(--aura-surface-1) !important; --md-sys-color-surface-container-high: var(--aura-surface-2) !important; --md-sys-color-on-surface: var(--aura-text-color) !important; --md-sys-color-outline: var(--aura-border-color) !important; --md-sys-color-primary: var(--aura-link-color) !important; --md-sys-color-on-primary: var(--aura-bg-color) !important; --bgColor-default: var(--aura-bg-color) !important; --bgColor-muted: var(--aura-surface-1) !important; --fgColor-default: var(--aura-text-color) !important; --fgColor-muted: var(--aura-muted-text-color) !important; --borderColor-default: var(--aura-border-color) !important; --color-canvas-default: var(--aura-bg-color) !important; --color-canvas-subtle: var(--aura-surface-1) !important; --color-fg-default: var(--aura-text-color) !important; --color-fg-muted: var(--aura-muted-text-color) !important; --color-border-default: var(--aura-border-color) !important; --color-accent-fg: var(--aura-link-color) !important;';
  const formatSensitiveDesignTokens = new Set([
    '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
    '--primary', '--primary-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--destructive', '--destructive-foreground', '--border', '--input', '--ring',
    '--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-accent',
    '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring', '--surface', '--surface-foreground',
    '--panel', '--panel-foreground', '--color-background', '--color-foreground', '--color-surface', '--color-surface-2',
    '--color-text', '--color-muted', '--color-border', '--color-link',
  ]);
  const darkDesignSystemTokenDeclarations = darkDesignSystemTokenDeclarationsRaw
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !formatSensitiveDesignTokens.has(declaration.split(':', 1)[0].trim()))
    .join('; ');
  const darkDesignSystemTokenRule =
    `${darkTokenScope}, ${darkTokenScope} ${darkDesignSystemLocalTokenSelector} { ${darkDesignSystemTokenDeclarations} }`;
  const darkOverlaySurfaceSelector =
    ':where(dialog, [popover], [aria-modal="true"], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="sheet" i], [class*="drawer" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"])';
  const darkOverlaySurfaceRule =
    `${darkTokenScope} ${darkOverlaySurfaceSelector} { background-color: var(--aura-surface-1) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35) !important; }`;
  const darkOverlaySurfaceContentRule =
    `${darkTokenScope} ${darkOverlaySurfaceSelector} :where(a, [role="link"], button, [role="button"], input, textarea, select, label, summary, div, span, p, small, strong, em, li) { color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const darkComplexArticleSurfaceRule =
    `${darkTokenScope} :where(table, thead, tbody, tfoot, tr, th, td, caption, aside, nav, header, footer, section, article, figure, figcaption, details, summary, fieldset, legend, blockquote, dl, dt, dd, [role="navigation"], [role="complementary"], [role="note"], [role="region"], [role="contentinfo"], [class*="mw-" i], [class*="vector-" i], [class*="wiki" i], [class*="infobox" i], [class*="toc" i], [class*="thumb" i], [class*="navbox" i], [class*="metadata" i], [class*="ambox" i]) { background-color: var(--aura-surface-1) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const darkComplexArticleImageRule =
    `${darkTokenScope} :is([class*="mw-" i], [class*="vector-" i], [class*="wiki" i], [class*="infobox" i], [class*="toc" i], [class*="thumb" i], [class*="navbox" i], [class*="metadata" i], [class*="ambox" i], [id*="mw-" i], [id*="wiki" i], [id*="infobox" i], [id*="toc" i], [id*="thumb" i], [id*="navbox" i], [id*="metadata" i], [id*="ambox" i]):not([data-aura-bg-text-gradient="1"]) { background-image: none !important; }`;
  const darkComplexArticleRaisedSurfaceRule =
    `${darkTokenScope} :where(th, thead, tfoot, caption, [class*="toc" i], [class*="infobox" i], [class*="thumbinner" i], [class*="navbox" i], [class*="mw-portlet" i], [class*="vector-menu" i]) { background-color: var(--aura-surface-2) !important; }`;
  const darkPseudoSurfaceSelector =
    ':where([class*="card" i], [class*="panel" i], [class*="modal" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="surface" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [class*="banner" i], [data-surface], [data-card], [data-panel], [data-callout], [popover], [role="dialog"], [role="alertdialog"], [role="tooltip"])';
  const darkPseudoSurfaceRule =
    `${darkTokenScope} ${darkPseudoSurfaceSelector}::before, ${darkTokenScope} ${darkPseudoSurfaceSelector}::after { background-color: var(--aura-surface-1) !important; background-image: none !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const darkPartSurfaceSelector = [
    'base',
    'surface',
    'container',
    'content',
    'panel',
    'card',
    'dialog',
    'popover',
    'menu',
    'listbox',
    'option',
    'item',
    'body',
    'header',
    'footer',
    'heading',
    'label',
    'description',
  ].map((part) => `${darkTokenScope} :where(*)::part(${part})`).join(', ');
  const darkPartControlSelector = [
    'button',
    'control',
    'input',
    'textarea',
    'select',
    'checkbox',
    'radio',
    'switch',
    'thumb',
    'track',
  ].map((part) => `${darkTokenScope} :where(*)::part(${part})`).join(', ');
  const darkPartSurfaceRule =
    `${darkPartSurfaceSelector} { ${darkDesignSystemTokenDeclarations} background-color: var(--aura-surface-1) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; }`;
  const darkPartControlRule =
    `${darkPartControlSelector} { ${darkDesignSystemTokenDeclarations} background-color: var(--aura-surface-2) !important; color: var(--aura-text-color) !important; -webkit-text-fill-color: var(--aura-text-color) !important; border-color: var(--aura-border-color) !important; accent-color: var(--aura-focus-color); }`;
  const comfortSpecific =
    modeId === MODE_IDS.COMFORT_VISUAL && typoSmoothingActive
      ? [
          `${scope} :is(p, li, blockquote, dd, dt, span, em, strong) { word-spacing: 0.02em; text-rendering: optimizeLegibility; font-kerning: normal; }`,
        ].join(' ')
      : '';
  const focusSpecific =
    modeId === MODE_IDS.FOCUS
      ? [
          `${scope} :is(a, button, input, select, textarea, [tabindex]):focus-visible { outline: 2px solid var(--aura-focus-color, #0a84ff); outline-offset: 3px; }`,
          `${scope} :is(a, button, input, select, textarea, [tabindex]):focus { outline: 2px solid var(--aura-focus-color, #0a84ff); outline-offset: 3px; }`,
          `${scope} :is(a):focus-visible { text-decoration: underline; text-decoration-offset: 0.2em; text-decoration-thickness: 0.14em; text-decoration-color: currentColor; }`,
          `${scope} :is(a):focus { text-decoration: underline; text-decoration-offset: 0.2em; text-decoration-thickness: 0.14em; text-decoration-color: currentColor; }`,
          `${scope} .aura-target-boost { min-inline-size: 24px; min-block-size: 24px; max-inline-size: 100%; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; vertical-align: middle; }`,
          `${scope} .aura-target-boost:focus-visible { outline: 2px solid var(--aura-focus-color, #0a84ff); outline-offset: 3px; }`,
        ].join(' ')
      : '';
  const reduceMotionSelector =
    `${scope} :where(*, *::before, *::after):not(video):not(audio):not(canvas):not(svg):not(iframe):not(progress):not([role="progressbar"]):not([aria-busy="true"]):not([data-aura-allow-motion="1"])`;
  const reduceMotionRule = reduceMotion
    ? [
        `${reduceMotionSelector} { animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; }`,
        `${scope}, ${scope} :where(*) { scroll-behavior: auto; }`,
      ].join(' ')
    : '';
  const preRule = spacingPackActive
    ? `${scope} :is(pre, code) { line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)}); }`
    : '';
  const mediaRule = `${scope} :is(img, video, picture, figure) { max-inline-size: 100%; height: auto; }`;
  const modeSpecific = modeId === MODE_IDS.FOCUS
    ? `${scope} :is(p, li, blockquote) { letter-spacing: var(--aura-letter-spacing, ${letterSpacing.toFixed(2)}px); }`
    : '';

  const sentinels = includeDebugSentinels
    ? [
        `${scope} { --aura-me2-scope-present: "1"; }`,
        `${scope} { --aura-me2-path: "v2"; }`,
      ]
    : [];

  return [
    transitionRule,
    prefersReduceMotionRule,
    containerRule,
    textRule,
    darkTextDescendantRule,
    proseReflowRule,
    codeReflowResetRule,
    paragraphRule,
    headingRule,
    anchorColorRule,
    anchorDecorationRule,
    anchorVisitedRule,
    anchorHoverRule,
    taggedSurfaceRule,
    taggedSurfaceRaisedRule,
    taggedAppShellRule,
    taggedAppShellContentRule,
    forceTextRule,
    forceTextContentRule,
    borderRule,
    mutedTextRule,
    controlRule,
    controlPlaceholderRule,
    darkTokenScopeRootRule,
    darkDesignSystemTokenRule,
    darkOverlaySurfaceRule,
    darkOverlaySurfaceContentRule,
    darkComplexArticleSurfaceRule,
    darkComplexArticleImageRule,
    darkComplexArticleRaisedSurfaceRule,
    darkPseudoSurfaceRule,
    darkPartSurfaceRule,
    darkPartControlRule,
    comfortSpecific,
    focusSpecific,
    reduceMotionRule,
    preRule,
    mediaRule,
    modeSpecific,
    ...sentinels,
  ]
    .filter(Boolean)
    .join(' ');
}

function hasNonTrivialSize(element) {
  if (!element) return false;
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (rect) {
    return rect.width > 1 && rect.height > 1;
  }
  const width = element.clientWidth || element.offsetWidth || 0;
  const height = element.clientHeight || element.offsetHeight || 0;
  return width > 1 && height > 1;
}

function isSemanticContentRoot(element, tagName, role) {
  if (!element) return false;
  const normalizedTag = (tagName ?? element.tagName ?? '').toLowerCase();
  const normalizedRole = (role ?? element.getAttribute?.('role') ?? '').toLowerCase();
  return normalizedTag === 'main' || normalizedTag === 'article' || normalizedRole === 'main';
}

function evaluateScopeRoot(element) {
  if (!element || element.nodeType !== 1) {
    return { ok: false, reason: 'invalid-element' };
  }

  if (element.isConnected === false) {
    return { ok: false, reason: 'detached' };
  }

  const tagName = (element.tagName || '').toLowerCase();
  const invalidTags = new Set(['nav', 'header', 'footer', 'aside', 'body', 'html']);
  if (invalidTags.has(tagName)) {
    return { ok: false, reason: 'disallowed-tag' };
  }

  const role = (element.getAttribute && element.getAttribute('role')) || '';
  const normalizedRole = role.toLowerCase();
  const invalidRoles = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'dialog']);
  if (normalizedRole && invalidRoles.has(normalizedRole)) {
    return { ok: false, reason: 'disallowed-role' };
  }

  const view = element.ownerDocument && element.ownerDocument.defaultView;
  const computed = view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
  if (computed) {
    if (computed.visibility === 'hidden' || computed.display === 'none') {
      return { ok: false, reason: 'not-visible' };
    }
  } else {
    return { ok: false, reason: 'not-visible' };
  }

  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (rect) {
    const view = element.ownerDocument?.defaultView;
    const viewportWidth = Number(view?.innerWidth) || element.ownerDocument?.documentElement?.clientWidth || 0;
    const viewportHeight = Number(view?.innerHeight) || element.ownerDocument?.documentElement?.clientHeight || 0;
    const viewportArea = viewportWidth * viewportHeight;
    const rectLeft = Number(rect.left) || 0;
    const rectTop = Number(rect.top) || 0;
    const rectRight = Number(rect.right) || rectLeft + (Number(rect.width) || 0);
    const rectBottom = Number(rect.bottom) || rectTop + (Number(rect.height) || 0);
    const visibleWidth = Math.max(0, Math.min(rectRight, viewportWidth) - Math.max(rectLeft, 0));
    const visibleHeight = Math.max(0, Math.min(rectBottom, viewportHeight) - Math.max(rectTop, 0));
    const coverage = viewportArea > 0 ? (visibleWidth * visibleHeight) / viewportArea : 0;
    const metrics = {
      rectWidth: Number(rect.width) || 0,
      rectHeight: Number(rect.height) || 0,
      visibleWidth,
      visibleHeight,
      coverage,
    };

    const fullyCoveringViewport =
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      coverage >= 0.92 &&
      Math.abs(rectLeft) <= 8 &&
      Math.abs(rectTop) <= 8 &&
      visibleWidth / viewportWidth >= 0.98 &&
      visibleHeight / viewportHeight >= 0.98;

    const semanticContentRoot = isSemanticContentRoot(element, tagName, normalizedRole);

    if (fullyCoveringViewport && !semanticContentRoot) {
      return {
        ok: false,
        reason: 'too-large',
        metrics,
      };
    }

    if (!hasNonTrivialSize(element)) {
      return { ok: false, reason: 'too-small', metrics };
    }

    return { ok: true, metrics };
  }

  if (!hasNonTrivialSize(element)) {
    return { ok: false, reason: 'too-small' };
  }

  return { ok: true, metrics: null };
}

function verifyScopeRoot(element) {
  let evaluation;
  try {
    evaluation = evaluateScopeRoot(element);
  } catch (error) {
    const detail = `${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`;
    const result = { ok: false, reason: 'OTHER', detail, metrics: null };
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ME2] verifyScopeRoot', {
        ...result,
        chosenRoot: describeScopeElement(element),
      });
    }
    return result;
  }

  const reason = mapVerificationReason(element, evaluation);
  const metrics = evaluation?.metrics || null;
  const result =
    evaluation.ok === true ? { ok: true, metrics } : { ok: false, reason, metrics };

  if (isModeEngineDebugEnabled()) {
    modeEngineDebugLog('[ME2] verifyScopeRoot', {
      ...result,
      chosenRoot: describeScopeElement(element),
    });
  }

  return result;
}

async function descendCandidateForContentRoot(
  candidate,
  { maxNodes = 320, chunkSize = 50, yieldToMain = null } = {}
) {
  try {
    if (!candidate || typeof candidate.querySelector !== 'function') {
      return { ok: false, reason: 'NO_CANDIDATE' };
    }

    const doc = candidate.ownerDocument;
    const view = doc?.defaultView;
    const viewportWidth = Number(view?.innerWidth) || doc?.documentElement?.clientWidth || 0;

    const yieldFn =
      typeof yieldToMain === 'function'
        ? yieldToMain
        : () =>
            new Promise((resolve) => {
              if (view?.requestAnimationFrame) {
                view.requestAnimationFrame(() => resolve());
                return;
              }
              setTimeout(resolve, 0);
            });

    const preferredSelectors = ['article', 'section', '[role="article"]', '[role="main"]'];
    for (const selector of preferredSelectors) {
      const match = candidate.querySelector(selector);
      if (match) {
        return { ok: true, element: match, reason: 'PREFERRED_DESCENDANT' };
      }
    }

    const isCandidateVisible = (el) => {
      const style = el?.ownerDocument?.defaultView?.getComputedStyle?.(el);
      if (!style) {
        return false;
      }
      return !(style.display === 'none' || style.visibility === 'hidden');
    };

    const computeWidthRatio = (rect) => {
      if (!rect) {
        return 0;
      }
      const width = Number(rect.width) || 0;
      return viewportWidth > 0 ? width / viewportWidth : 0;
    };

    const nodes = [];
    const walker = doc?.createTreeWalker
      ? doc.createTreeWalker(candidate, view?.NodeFilter?.SHOW_ELEMENT || 1)
      : null;

    if (walker) {
      let current = walker.nextNode();
      while (current && nodes.length < maxNodes) {
        nodes.push(current);
        current = walker.nextNode();
      }
    } else if (typeof candidate.querySelectorAll === 'function') {
      const matches = candidate.querySelectorAll('*');
      for (const node of matches) {
        nodes.push(node);
        if (nodes.length >= maxNodes) {
          break;
        }
      }
    }

    let best = { element: null, density: 0, textLen: 0 };
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (!node || node === candidate || typeof node.getBoundingClientRect !== 'function') {
        continue;
      }

      if (!isCandidateVisible(node)) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      const widthRatio = computeWidthRatio(rect);
      if (viewportWidth > 0 && (widthRatio < 0.55 || widthRatio > 0.95)) {
        continue;
      }

      const textLen = (node.innerText || node.textContent || '').trim().length;
      if (!textLen) {
        continue;
      }

      const area = Math.max(1, (Number(rect.width) || 0) * (Number(rect.height) || 0));
      const density = textLen / area;
      if (density > best.density || (density === best.density && textLen > best.textLen)) {
        best = { element: node, density, textLen };
      }

      if (index > 0 && index % chunkSize === 0) {
        await yieldFn();
      }
    }

    if (best.element) {
      return { ok: true, element: best.element, reason: 'DENSITY_DESCENDANT' };
    }

    return { ok: false, reason: 'NO_DESCENDANT' };
  } catch (error) {
    return { ok: false, error: 'SALVAGE_CRASH', detail: error?.message || String(error) };
  }
}

function normalizeOwnerKey(ownerKey = '') {
  return ownerKey || SCOPE_OWNER_VALUE;
}

function ownsScope(element, ownerKey) {
  if (!element || typeof element.getAttribute !== 'function') return false;
  const currentOwner = element.getAttribute(SCOPE_OWNER_ATTR);
  return currentOwner === ownerKey;
}

function normalizeTokenEntries(tokenMap = {}) {
  return Object.entries(tokenMap).filter(([name, value]) => typeof name === 'string' && typeof value === 'string');
}

function applyScopedTokens(element, tokenMap = {}, ownerKey = '') {
  if (!element || !element.style || typeof element.style.setProperty !== 'function') {
    const response = { ok: false, applied: 0, reason: 'invalid-element' };
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ScopedTokens][apply]', {
        applied: false,
        reason: response.reason,
        target: describeScopeElement(element),
        tokenValue: null,
        appliedCount: 0,
      });
    }
    return response;
  }

  const evaluation = evaluateScopeRoot(element);
  if (!evaluation.ok) {
    const response = { ok: false, applied: 0, reason: evaluation.reason };
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ScopedTokens][apply]', {
        applied: false,
        reason: response.reason,
        target: describeScopeElement(element),
        tokenValue: null,
        appliedCount: 0,
      });
    }
    return response;
  }

  const normalizedOwner = normalizeOwnerKey(ownerKey);
  const existingOwner = element.getAttribute ? element.getAttribute(SCOPE_OWNER_ATTR) : '';
  if (existingOwner && existingOwner !== normalizedOwner) {
    const response = { ok: false, applied: 0, reason: 'not-owner' };
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ScopedTokens][apply]', {
        applied: false,
        reason: response.reason,
        target: describeScopeElement(element),
        tokenValue: element.getAttribute ? element.getAttribute(SCOPE_ATTR) : null,
        appliedCount: 0,
      });
    }
    return response;
  }

  const scopeAttr = element.getAttribute ? element.getAttribute(SCOPE_ATTR) : null;
  if (scopeAttr && scopeAttr !== SCOPE_ATTR_VALUE) {
    const response = { ok: false, applied: 0, reason: 'invalid-scope-value' };
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ScopedTokens][apply]', {
        applied: false,
        reason: response.reason,
        target: describeScopeElement(element),
        tokenValue: scopeAttr,
        appliedCount: 0,
      });
    }
    return response;
  }

  const tokenEntries = normalizeTokenEntries(tokenMap);
  const ownedKeys = tokenEntries.map(([name]) => name);

  const previousTokens = (element.getAttribute && element.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR)) || '';
  const previousList = previousTokens ? previousTokens.split(',').filter(Boolean) : [];
  previousList.forEach((token) => {
    if (!ownedKeys.includes(token)) {
      element.style.removeProperty(token);
    }
  });

  ownedKeys.forEach((token) => {
    element.style.removeProperty(token);
  });

  tokenEntries.forEach(([name, value]) => {
    element.style.setProperty(name, value);
  });

  if (typeof element.setAttribute === 'function') {
    element.setAttribute(SCOPE_ATTR, SCOPE_ATTR_VALUE);
    element.setAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR, ownedKeys.join(','));
    element.setAttribute(SCOPE_OWNER_ATTR, normalizedOwner);
  }

  const result = { ok: true, applied: tokenEntries.length, ownedKeys };

  if (isModeEngineDebugEnabled()) {
    modeEngineDebugLog('[ScopedTokens][apply]', {
      applied: result.ok,
      target: describeScopeElement(element),
      tokenValue: element.getAttribute ? element.getAttribute(SCOPE_ATTR) : null,
      appliedCount: result.applied,
    });
  }

  return result;
}

function cleanupScopedTokens(element, ownerKey = '', ownedKeys = [], options = {}) {
  if (!element || !element.style || typeof element.style.removeProperty !== 'function') {
    return { ok: false, removed: 0, reason: 'invalid-element' };
  }

  const normalizedOwner = normalizeOwnerKey(ownerKey);
  if (!ownsScope(element, normalizedOwner)) {
    return { ok: false, removed: 0, reason: 'not-owner' };
  }

  const keys = ownedKeys.length
    ? ownedKeys.filter((key) => typeof key === 'string')
    : ((element.getAttribute && element.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR)) || '')
        .split(',')
        .filter(Boolean);

  keys.forEach((token) => {
    element.style.removeProperty(token);
  });

  if (typeof element.removeAttribute === 'function') {
    const preserveScope = options?.preserveScope === true;
    element.removeAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR);
    if (!preserveScope) {
      element.removeAttribute(SCOPE_OWNER_ATTR);
      const scopeValue = element.getAttribute ? element.getAttribute(SCOPE_ATTR) : null;
      if (scopeValue === SCOPE_ATTR_VALUE) {
        element.removeAttribute(SCOPE_ATTR);
      }
    }
  }

  teardownAuraSurfaceObserver(element);

  return { ok: true, removed: keys.length };
}

function markScopeOwned(element, ownerKey = '') {
  if (!element || typeof element.setAttribute !== 'function') {
    return { didMark: false };
  }

  const evaluation = evaluateScopeRoot(element);
  if (!evaluation.ok) {
    return { didMark: false };
  }

  const normalizedOwner = normalizeOwnerKey(ownerKey);
  const existingOwner = element.getAttribute ? element.getAttribute(SCOPE_OWNER_ATTR) : '';
  if (existingOwner && existingOwner !== normalizedOwner) {
    return { didMark: false };
  }

  element.setAttribute(SCOPE_ATTR, SCOPE_ATTR_VALUE);
  element.setAttribute(SCOPE_OWNER_ATTR, normalizedOwner);
  const response = { didMark: true };
  if (isModeEngineDebugEnabled()) {
    modeEngineDebugLog('[ScopedTokens][markOwned]', {
      applied: response.didMark,
      target: describeScopeElement(element),
      tokenValue: element.getAttribute ? element.getAttribute(SCOPE_ATTR) : null,
      appliedCount: response.didMark ? 1 : 0,
    });
  }
  return response;
}

function unmarkScopeIfOwned(element, ownerKey = '') {
  if (!element || typeof element.removeAttribute !== 'function') {
    return { didUnmark: false };
  }

  const normalizedOwner = normalizeOwnerKey(ownerKey);
  if (!ownsScope(element, normalizedOwner)) {
    return { didUnmark: false };
  }

  element.removeAttribute(SCOPE_OWNER_ATTR);
  element.removeAttribute(SCOPE_ATTR);
  teardownAuraSurfaceObserver(element);
  return { didUnmark: true };
}

function unmarkScopeIfOwnedBySelector(selector, ownerKey = '') {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { didUnmark: false, reason: 'not-found' };
    }

    return unmarkScopeIfOwned(element, ownerKey);
  } catch (error) {
    return { didUnmark: false, reason: 'invalid-selector' };
  }
}

function verifyScopeRootBySelector(selector) {
  try {
    const matches = document.querySelectorAll(selector);
    const element = matches?.[0] || null;

    if (!element) {
      return { ok: false, reason: 'ROOT_NULL' };
    }

    if (matches.length > 1) {
      return { ok: false, reason: 'ROOT_SELECTOR_NON_UNIQUE' };
    }

    const verification = verifyScopeRoot(element);
    return verification.ok ? { ...verification, chosenRoot: describeScopeElement(element) } : verification;
  } catch (error) {
    const detail = `${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`;
    return { ok: false, reason: 'OTHER', detail };
  }
}

function nowMs() {
  return globalThis?.performance?.now ? performance.now() : Date.now();
}

function stripCssValue(value = '') {
  return `${value}`.trim().replace(/^['"]|['"]$/g, '');
}

function isElementNode(value) {
  return value && value.nodeType === 1;
}

function resolvePostApplyScopeRoot(options = {}) {
  const ownerKey = normalizeOwnerKey(options.ownerKey);
  const storedRoot = globalThis?.AURA?.modeEngineScopeRoot;
  if (isElementNode(storedRoot) && ownsScope(storedRoot, ownerKey)) {
    return storedRoot;
  }

  const candidates = [];
  if (typeof options.scopeSelector === 'string' && options.scopeSelector.trim()) {
    candidates.push(options.scopeSelector.trim());
  }
  candidates.push(`${MODE_ENGINE_SCOPE_SELECTOR}[${SCOPE_OWNER_ATTR}="${ownerKey}"]`);

  for (const selector of candidates) {
    try {
      const match = document.querySelector(selector);
      if (isElementNode(match)) {
        return match;
      }
    } catch (_) {
      // Ignore invalid selectors supplied by stale background state.
    }
  }

  return null;
}

function describePostApplyScope(element, ownerKey) {
  if (!element) {
    return {
      found: false,
      connected: false,
      visible: false,
      owned: false,
      tag: '',
      role: '',
      fingerprint: '',
    };
  }

  const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  const role = typeof element.getAttribute === 'function' ? element.getAttribute('role') || '' : '';
  return {
    found: true,
    connected: element.isConnected !== false,
    visible: isScopeVisible(element),
    owned: ownsScope(element, ownerKey),
    tag,
    role,
    fingerprint: simpleHash([tag, role, element.getAttribute?.(SCOPE_ATTR) || '', element.getAttribute?.(SCOPE_OWNER_ATTR) || ''].join('|')),
  };
}

function isScopeVisible(element) {
  if (!isElementNode(element)) {
    return false;
  }

  const view = element.ownerDocument?.defaultView || globalThis;
  const computed = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
  if (!computed || computed.display === 'none' || computed.visibility === 'hidden') {
    return false;
  }

  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (rect) {
    return (Number(rect.width) || 0) > 1 && (Number(rect.height) || 0) > 1;
  }

  return (element.clientWidth || element.offsetWidth || 0) > 1 && (element.clientHeight || element.offsetHeight || 0) > 1;
}

function makeInspectionCheck(code, passed, extra = {}) {
  return {
    code,
    passed: passed === true,
    ...extra,
  };
}

function measureHorizontalOverflow(element) {
  const doc = element?.ownerDocument || document;
  const docEl = doc?.documentElement;
  const body = doc?.body;
  const viewportWidth = Number(docEl?.clientWidth) || Number(globalThis?.innerWidth) || 0;
  const pageOverflow = Math.max(0, Number(docEl?.scrollWidth || 0) - viewportWidth, Number(body?.scrollWidth || 0) - viewportWidth);
  const scopeOverflow = Math.max(0, Number(element?.scrollWidth || 0) - Number(element?.clientWidth || 0));
  return Math.max(pageOverflow, scopeOverflow);
}

function clampCssSnapshotString(value, max = 64) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function readComputedColor(view, element, property) {
  if (!view || !element || typeof view.getComputedStyle !== 'function') {
    return '';
  }
  try {
    return clampCssSnapshotString(view.getComputedStyle(element).getPropertyValue(property));
  } catch (_) {
    return '';
  }
}

function firstUsableComputedColor(view, elements, property) {
  for (const element of elements) {
    const value = readComputedColor(view, element, property);
    if (value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') {
      return value;
    }
  }
  return '';
}

function collectVisualSnapshot(scopeRoot) {
  const doc = scopeRoot?.ownerDocument || document;
  const view = doc?.defaultView || globalThis;
  const docEl = doc?.documentElement || null;
  const body = doc?.body || null;
  const firstSurface = (() => {
    try {
      return scopeRoot?.querySelector?.('main, article, section, [role="main"], [role="region"], form, table, aside') || null;
    } catch (_) {
      return null;
    }
  })();
  const firstLink = (() => {
    try {
      return scopeRoot?.querySelector?.('a[href], [role="link"]') || null;
    } catch (_) {
      return null;
    }
  })();
  const mutedText = (() => {
    try {
      return scopeRoot?.querySelector?.('small, figcaption, caption, [class*="muted" i], [class*="secondary" i]') || null;
    } catch (_) {
      return null;
    }
  })();

  return {
    backgroundColor: firstUsableComputedColor(view, [body, docEl, scopeRoot], 'background-color'),
    surfaceColor: firstUsableComputedColor(view, [firstSurface, scopeRoot, body, docEl], 'background-color'),
    textColor: firstUsableComputedColor(view, [scopeRoot, body, docEl], 'color'),
    linkColor: firstUsableComputedColor(view, [firstLink], 'color'),
    mutedTextColor: firstUsableComputedColor(view, [mutedText], 'color'),
    prefersColorScheme: (() => {
      try {
        return view?.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
      } catch (_) {
        return 'light';
      }
    })(),
  };
}

function collectInspectionBaseline(options = {}) {
  const startedAt = nowMs();
  const ownerKey = normalizeOwnerKey(options.ownerKey);
  const scopeRoot = resolvePostApplyScopeRoot({ ...options, ownerKey });
  if (!scopeRoot) {
    return {
      ok: false,
      error: 'NO_SCOPE',
      baseline: { horizontalOverflow: 0 },
      stats: { elapsedMs: Math.max(0, Math.round(nowMs() - startedAt)), budgetHit: false },
    };
  }

  return {
    ok: true,
    baseline: {
      horizontalOverflow: Math.round(measureHorizontalOverflow(scopeRoot)),
      visualSnapshot: collectVisualSnapshot(scopeRoot),
    },
    stats: {
      elapsedMs: Math.max(0, Math.round(nowMs() - startedAt)),
      budgetHit: false,
    },
  };
}

function collectMatchingElements(scopeRoot, selector, budget = {}) {
  const maxNodes = Math.max(1, Math.min(Number(budget.maxNodes) || 80, 160));
  const maxVisited = Math.max(maxNodes, Math.min(Number(budget.maxVisited) || maxNodes * 8, 800));
  const maxMs = Math.max(1, Math.min(Number(budget.maxMs) || 8, 30));
  const startedAt = nowMs();
  const nodes = [];
  let visited = 0;
  let budgetHit = false;

  const shouldStop = () => {
    if (nodes.length >= maxNodes || visited >= maxVisited) {
      budgetHit = true;
      return true;
    }
    if (nowMs() - startedAt > maxMs) {
      budgetHit = true;
      return true;
    }
    return false;
  };

  const doc = scopeRoot?.ownerDocument || document;
  const view = doc?.defaultView || globalThis;
  const nodeFilter = view?.NodeFilter?.SHOW_ELEMENT || globalThis?.NodeFilter?.SHOW_ELEMENT || 1;
  const walker = doc?.createTreeWalker ? doc.createTreeWalker(scopeRoot, nodeFilter) : null;

  if (walker) {
    let current = walker.nextNode();
    while (current) {
      visited += 1;
      if (typeof current.matches === 'function' && current.matches(selector)) {
        nodes.push(current);
      }
      if (shouldStop()) {
        break;
      }
      current = walker.nextNode();
    }
    return { nodes, visited, budgetHit };
  }

  const stack = [];
  if (scopeRoot?.children && typeof scopeRoot.children.length === 'number') {
    for (let index = scopeRoot.children.length - 1; index >= 0; index -= 1) {
      stack.push(scopeRoot.children[index]);
    }
  }

  while (stack.length) {
    const current = stack.pop();
    visited += 1;
    if (typeof current?.matches === 'function' && current.matches(selector)) {
      nodes.push(current);
    }
    if (shouldStop()) {
      break;
    }
    const children = current?.children;
    if (children && typeof children.length === 'number') {
      for (let index = children.length - 1; index >= 0 && stack.length < maxVisited; index -= 1) {
        stack.push(children[index]);
      }
    }
  }

  return { nodes, visited, budgetHit };
}

function inspectClippedText(scopeRoot, budget = {}) {
  if (!scopeRoot) {
    return { clipped: false, nodesScanned: 0, budgetHit: false };
  }

  const selector = 'p, li, blockquote, pre, code, h1, h2, h3, h4, h5, h6, button, a, input, textarea, select';
  const collected = collectMatchingElements(scopeRoot, selector, budget);
  const { nodes } = collected;
  let scanned = 0;

  for (const node of nodes) {
    scanned += 1;
    const rect = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null;
    if (rect && ((Number(rect.width) || 0) <= 1 || (Number(rect.height) || 0) <= 1)) {
      continue;
    }

    const view = node.ownerDocument?.defaultView || globalThis;
    const style = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(node) : null;
    const overflowHidden =
      style?.overflow === 'hidden' ||
      style?.overflow === 'clip' ||
      style?.overflowX === 'hidden' ||
      style?.overflowX === 'clip' ||
      style?.overflowY === 'hidden' ||
      style?.overflowY === 'clip';
    if (!overflowHidden) {
      continue;
    }

    const clippedX = Number(node.scrollWidth || 0) > Number(node.clientWidth || 0) + 2;
    const clippedY = Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 2;
    if (clippedX || clippedY) {
      return { clipped: true, nodesScanned: Math.max(scanned, collected.visited), budgetHit: collected.budgetHit };
    }
  }

  return { clipped: false, nodesScanned: Math.max(scanned, collected.visited), budgetHit: collected.budgetHit };
}

function isElementInViewport(element) {
  if (!isElementNode(element) || typeof element.getBoundingClientRect !== 'function') {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const width = Number(globalThis?.innerWidth) || element.ownerDocument?.documentElement?.clientWidth || 0;
  const height = Number(globalThis?.innerHeight) || element.ownerDocument?.documentElement?.clientHeight || 0;
  return (Number(rect.width) || 0) > 0 && (Number(rect.height) || 0) > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= height && rect.left <= width;
}

function inspectVisibleControls(scopeRoot, budget = {}) {
  if (!scopeRoot) {
    return { hiddenControls: 0, nodesScanned: 0, budgetHit: false };
  }

  const collected = collectMatchingElements(
    scopeRoot,
    'button, input, textarea, select, a[href], [role="button"], [tabindex]',
    budget,
  );
  const controls = collected.nodes;
  let hiddenControls = 0;

  for (const control of controls) {
    const view = control.ownerDocument?.defaultView || globalThis;
    const style = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(control) : null;
    if (!style || style.display === 'none' || style.visibility === 'hidden' || !isElementInViewport(control)) {
      hiddenControls += 1;
    }
  }

  return { hiddenControls, nodesScanned: Math.max(controls.length, collected.visited), budgetHit: collected.budgetHit };
}

function inspectPostApply(options = {}) {
  const startedAt = nowMs();
  const budget = options?.budget && typeof options.budget === 'object' ? options.budget : {};
  const ownerKey = normalizeOwnerKey(options.ownerKey);
  const tokenKeys = Array.isArray(options.tokenKeys)
    ? options.tokenKeys.filter((key) => typeof key === 'string' && key.startsWith('--aura-')).slice(0, 80)
    : [];
  const blockingFailures = [];
  const warnings = [];
  const checks = [];
  const scopeRoot = resolvePostApplyScopeRoot({ ...options, ownerKey });
  const scope = describePostApplyScope(scopeRoot, ownerKey);

  const scopeVisible = scope.found && scope.connected && scope.visible && scope.owned;
  checks.push(makeInspectionCheck('SCOPE_STILL_VISIBLE', scopeVisible));
  if (!scopeVisible) {
    blockingFailures.push('SCOPE_STILL_VISIBLE');
  }

  const tokenAttr = scopeRoot?.getAttribute?.(MODE_ENGINE_SCOPE_TOKENS_ATTR) || '';
  const appliedTokenKeys = tokenAttr.split(',').filter(Boolean);
  const missingTokenKeys = tokenKeys.filter((key) => !appliedTokenKeys.includes(key));
  const tokensPresent = scopeVisible && tokenKeys.length > 0 && missingTokenKeys.length === 0;
  checks.push(
    makeInspectionCheck('SCOPED_TOKENS_PRESENT', tokensPresent, {
      expected: tokenKeys.length,
      missing: missingTokenKeys.length,
    }),
  );
  if (!tokensPresent) {
    blockingFailures.push('SCOPED_TOKENS_PRESENT');
  }

  const view = scopeRoot?.ownerDocument?.defaultView || globalThis;
  const computed = scopeRoot && typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(scopeRoot) : null;
  const sentinelValue = stripCssValue(computed?.getPropertyValue?.('--aura-me2-applied') || '');
  const sentinelPresent = sentinelValue === '1';
  checks.push(makeInspectionCheck('SCOPED_CSS_SENTINEL_PRESENT', sentinelPresent));
  if (!sentinelPresent) {
    blockingFailures.push('SCOPED_CSS_SENTINEL_PRESENT');
  }

  const horizontalOverflow = scopeRoot ? measureHorizontalOverflow(scopeRoot) : 0;
  const baselineOverflow =
    typeof options?.baseline?.horizontalOverflow === 'number' && Number.isFinite(options.baseline.horizontalOverflow)
      ? Math.max(0, options.baseline.horizontalOverflow)
      : null;
  const overflowThreshold = Math.max(8, Number(options?.thresholds?.horizontalOverflowPx) || 8);
  const horizontalPassed =
    baselineOverflow === null ? true : horizontalOverflow <= baselineOverflow + overflowThreshold;
  checks.push(
    makeInspectionCheck('NO_HORIZONTAL_SCROLL_REGRESSION', horizontalPassed, {
      observed: Math.round(horizontalOverflow),
      baseline: baselineOverflow === null ? null : Math.round(baselineOverflow),
      threshold: overflowThreshold,
    }),
  );
  if (!horizontalPassed) {
    blockingFailures.push('NO_HORIZONTAL_SCROLL_REGRESSION');
  } else if (baselineOverflow === null && horizontalOverflow > overflowThreshold) {
    warnings.push('HORIZONTAL_OVERFLOW_BASELINE_MISSING');
  }

  const clipped = inspectClippedText(scopeRoot, budget);
  checks.push(
    makeInspectionCheck('NO_CLIPPED_TEXT', !clipped.clipped, {
      nodesScanned: clipped.nodesScanned,
    }),
  );
  if (clipped.clipped) {
    blockingFailures.push('NO_CLIPPED_TEXT');
  }

  const activeElement = scopeRoot?.ownerDocument?.activeElement || null;
  if (activeElement && scopeRoot?.contains?.(activeElement)) {
    const focusVisible = isElementInViewport(activeElement);
    checks.push(makeInspectionCheck('FOCUS_REMAINS_VISIBLE', focusVisible));
    if (!focusVisible) {
      blockingFailures.push('FOCUS_REMAINS_VISIBLE');
    }
  }

  const controls = inspectVisibleControls(scopeRoot, budget);
  checks.push(
    makeInspectionCheck('NO_CONTROL_OCCLUSION', controls.hiddenControls === 0, {
      hiddenControls: controls.hiddenControls,
      nodesScanned: controls.nodesScanned,
    }),
  );
  if (controls.hiddenControls > 0) {
    warnings.push('CONTROL_VISIBILITY_PROXY_WARNING');
  }

  const elapsedMs = Math.max(0, Math.round(nowMs() - startedAt));
  const nodesScanned = clipped.nodesScanned + controls.nodesScanned;
  const budgetHit =
    clipped.budgetHit ||
    controls.budgetHit ||
    (typeof budget.maxMs === 'number' && budget.maxMs > 0 && elapsedMs > budget.maxMs);

  return {
    ok: blockingFailures.length === 0,
    inspected: true,
    scope,
    checks,
    blockingFailures,
    warnings,
    stats: {
      nodesScanned,
      elapsedMs,
      budgetHit,
    },
  };
}

function getVisibleArea(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return 0;
  }

  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return 0;
  }

  return rect.width * rect.height;
}

function describeSalvageCandidate(element) {
  if (!element) {
    return null;
  }

  return {
    ...describeScopeElement(element),
    area: getVisibleArea(element),
    textLength: typeof element.innerText === 'string' ? element.innerText.length : undefined,
  };
}

function pickLargestElement(elements = []) {
  return elements.reduce(
    (best, el) => {
      const { ok } = verifyScopeRoot(el);
      if (!ok) {
        return best;
      }

      const area = getVisibleArea(el);
      if (area > best.area) {
        return { element: el, area };
      }
      return best;
    },
    { element: null, area: 0 },
  ).element;
}

function pickBestDescendantBlock(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return null;
  }

  const candidates = Array.from(root.querySelectorAll('article, main, section, div, p')).slice(0, 150);
  let best = { element: null, score: 0 };

  for (const el of candidates) {
    const verification = verifyScopeRoot(el);
    if (!verification.ok) {
      continue;
    }

    const area = getVisibleArea(el);
    if (!area) {
      continue;
    }

    const textLength = (el.innerText || el.textContent || '').trim().length;
    if (!textLength) {
      continue;
    }

    const density = textLength / Math.max(area, 1);
    const score = area * 0.7 + textLength * 0.2 + density * 50;

    if (score > best.score) {
      best = { element: el, score };
    }
  }

  return best.element;
}

function markSalvagedRoot(element) {
  if (!element || typeof element.setAttribute !== 'function') {
    return null;
  }

  const token = `aura-salvage-${Math.random().toString(36).slice(2, 8)}`;
  element.setAttribute('data-aura-scope-salvage', token);
  return `[data-aura-scope-salvage="${token}"]`;
}

function salvageScopeRootBySelector(selector, debugEnabled = false) {
  const debug =
    typeof debugEnabled === 'object' && debugEnabled !== null ? Boolean(debugEnabled.debugEnabled) : Boolean(debugEnabled);
  const logDebug = (...args) => {
    if (!debug) {
      return;
    }

    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[AURA][ModeEngine]', ...args);
    }
  };

  try {
    const matches = document.querySelectorAll(selector);
    const candidate = matches?.[0] || null;
    const initial = verifyScopeRoot(candidate);

    if (initial.ok) {
      const result = { ok: true, tried: false, selector, chosenRoot: describeSalvageCandidate(candidate) };
      logDebug('[ME2] salvage', result);
      return result;
    }

    const preferredMatches = candidate?.querySelectorAll?.('main, article, [role="main"]') || [];
    const preferred = pickLargestElement(preferredMatches);

    if (preferred) {
      const verification = verifyScopeRoot(preferred);
      if (verification.ok) {
        const markedSelector = markSalvagedRoot(preferred);
        const result = {
          ok: true,
          tried: true,
          selector: markedSelector || selector,
          reason: verification.reason,
          chosenRoot: describeSalvageCandidate(preferred),
        };
        logDebug('[ME2] salvage', result);
        return result;
      }
    }

    const best = pickBestDescendantBlock(candidate);
    if (best) {
      const verification = verifyScopeRoot(best);
      if (verification.ok) {
        const markedSelector = markSalvagedRoot(best);
        const result = {
          ok: true,
          tried: true,
          selector: markedSelector || selector,
          reason: verification.reason,
          chosenRoot: describeSalvageCandidate(best),
        };
        logDebug('[ME2] salvage', result);
        return result;
      }
    }

    const result = { ok: false, tried: true, reason: initial.reason };

    logDebug('[ME2] salvage', result);

    return result;
  } catch (error) {
    const result = { ok: false, tried: true, reason: 'OTHER' };
    logDebug('[ME2] salvage', result);
    return result;
  }
}

function applyScopedTokensBySelector(selector, tokenMap = {}, ownerKey = '') {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { ok: false, applied: 0, reason: 'not-found' };
    }
    return applyScopedTokens(element, tokenMap, ownerKey);
  } catch (error) {
    return { ok: false, applied: 0, reason: 'invalid-selector' };
  }
}

function cleanupScopedTokensBySelector(selector, ownerKey = '', ownedKeys = [], options = {}) {
  try {
    const element = document.querySelector(selector);
    if (!element) {
      return { ok: false, removed: 0, reason: 'not-found' };
    }
    return cleanupScopedTokens(element, ownerKey, ownedKeys, options);
  } catch (error) {
    return { ok: false, removed: 0, reason: 'invalid-selector' };
  }
}

function applyTokensToScopeRoot(scopeEl, tokenMap = {}) {
  if (!scopeEl || !scopeEl.style || typeof scopeEl.style.setProperty !== 'function') {
    return { ok: false, applied: 0, reason: 'invalid-element' };
  }

  const evaluation = evaluateScopeRoot(scopeEl);
  if (!evaluation.ok) {
    return { ok: false, applied: 0, reason: evaluation.reason };
  }

  const entries = normalizeTokenEntries(tokenMap);
  entries.forEach(([key]) => scopeEl.style.removeProperty(key));
  entries.forEach(([key, value]) => scopeEl.style.setProperty(key, value));

  const result = { ok: true, applied: entries.length, ownedKeys: entries.map(([key]) => key) };
  return result;
}

function removeTokensOwned(scopeEl, ownedKeys = []) {
  if (!scopeEl || !scopeEl.style || typeof scopeEl.style.removeProperty !== 'function') {
    return { ok: false, removed: 0, reason: 'invalid-element' };
  }

  const keys = ownedKeys.filter((key) => typeof key === 'string');
  if (!keys.length) {
    return { ok: true, removed: 0 };
  }

  keys.forEach((key) => scopeEl.style.removeProperty(key));
  if (typeof scopeEl.getAttribute === 'function' && typeof scopeEl.setAttribute === 'function') {
    const previousTokens = scopeEl.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR) || '';
    const remaining = previousTokens
      .split(',')
      .filter(Boolean)
      .filter((key) => !keys.includes(key));
    if (remaining.length) {
      scopeEl.setAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR, remaining.join(','));
    } else if (typeof scopeEl.removeAttribute === 'function') {
      scopeEl.removeAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR);
    }
  }
  return { ok: true, removed: keys.length };
}

function applyTokensToScopeBySelector(selector, tokenMap = {}) {
  let scopeEl = null;
  try {
    scopeEl = document.querySelector(selector);
  } catch (error) {
    return {
      ok: false,
      applied: 0,
      error: 'TOKEN_APPLY_FAILED',
      detail: {
        reason: 'invalid-selector',
        selector,
        message: error?.message || 'Invalid selector',
      },
    };
  }

  if (!scopeEl) {
    return { ok: false, applied: 0, reason: 'not-found' };
  }

  return applyTokensToScopeRoot(scopeEl, tokenMap);
}

function removeTokensOwnedBySelector(selector, ownedKeys = []) {
  try {
    const scopeEl = document.querySelector(selector);
    if (!scopeEl) {
      return { ok: false, removed: 0, reason: 'not-found' };
    }
    return removeTokensOwned(scopeEl, ownedKeys);
  } catch (error) {
    return { ok: false, removed: 0, reason: 'invalid-selector' };
  }
}

function parseCssColorToRgba(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'transparent') {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }

  if (normalized.startsWith('rgb')) {
    const match = normalized.match(/rgba?\(([^)]+)\)/);
    if (!match) {
      return null;
    }
    const parts = match[1].split(',').map((part) => part.trim());
    if (parts.length < 3) {
      return null;
    }
    const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    const alpha = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
    if ([r, g, b, alpha].some((value) => Number.isNaN(value))) {
      return null;
    }
    return { r, g, b, alpha };
  }

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0] + hex[0], 16);
      const g = Number.parseInt(hex[1] + hex[1], 16);
      const b = Number.parseInt(hex[2] + hex[2], 16);
      return { r, g, b, alpha: 1 };
    }
    if (hex.length === 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return { r, g, b, alpha: 1 };
    }
  }

  return null;
}

function parseColorToRgb(rawValue) {
  return parseCssColorToRgba(rawValue);
}

function relativeLuminance({ r, g, b }) {
  const normalize = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  const rLinear = normalize(r);
  const gLinear = normalize(g);
  const bLinear = normalize(b);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

function computeLuminance(color) {
  if (!color) {
    return null;
  }
  return relativeLuminance(color);
}

function contrastRatio(lum1, lum2) {
  if (!Number.isFinite(lum1) || !Number.isFinite(lum2)) {
    return null;
  }
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function blendColors(foreground, background) {
  if (!foreground || !background) {
    return null;
  }

  const alpha = Number.isFinite(foreground.alpha) ? foreground.alpha : 1;
  const bgAlpha = Number.isFinite(background.alpha) ? background.alpha : 1;

  if (alpha >= 1 && bgAlpha >= 1) {
    return { r: foreground.r, g: foreground.g, b: foreground.b, alpha: 1 };
  }

  const outAlpha = alpha + bgAlpha * (1 - alpha);
  if (outAlpha <= 0) {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }

  const r = (foreground.r * alpha + background.r * bgAlpha * (1 - alpha)) / outAlpha;
  const g = (foreground.g * alpha + background.g * bgAlpha * (1 - alpha)) / outAlpha;
  const b = (foreground.b * alpha + background.b * bgAlpha * (1 - alpha)) / outAlpha;

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
    alpha: outAlpha,
  };
}

function getComputedBgColor(element) {
  if (!element?.ownerDocument?.defaultView) {
    return { rgba: null, isTransparent: true };
  }
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  const rgba = parseCssColorToRgba(style?.backgroundColor || '');
  const isTransparent = !rgba || rgba.alpha === 0;
  return { rgba, isTransparent };
}

function getComputedTextColor(element) {
  if (!element?.ownerDocument?.defaultView) {
    return null;
  }
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return parseCssColorToRgba(style?.color || '');
}

function resolveScopeRootBackground(scopeRoot) {
  if (!scopeRoot || !scopeRoot.ownerDocument?.defaultView) {
    return null;
  }

  const view = scopeRoot.ownerDocument.defaultView;
  const style = view.getComputedStyle(scopeRoot);
  let background = parseColorToRgb(style.backgroundColor);

  if (!background || background.alpha === 0) {
    const tokenValue = style.getPropertyValue('--aura-bg-color');
    if (tokenValue) {
      background = parseColorToRgb(tokenValue.trim());
    }
  }

  if (!background || background.alpha === 0) {
    const body = scopeRoot.ownerDocument?.body;
    const bodyStyle = body ? view.getComputedStyle(body) : null;
    background = parseColorToRgb(bodyStyle?.backgroundColor || '');
  }

  if (!background || background.alpha === 0) {
    const docStyle = scopeRoot.ownerDocument?.documentElement
      ? view.getComputedStyle(scopeRoot.ownerDocument.documentElement)
      : null;
    background = parseColorToRgb(docStyle?.backgroundColor || '');
  }

  return background && background.alpha > 0 ? background : null;
}

function resolveElementBackground(element, scopeRoot, fallbackBackground) {
  if (!element || !scopeRoot) {
    return fallbackBackground || null;
  }

  let node = element;
  while (node) {
    if (!node.ownerDocument?.defaultView) {
      break;
    }
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    const background = parseColorToRgb(style.backgroundColor);
    if (background && background.alpha > 0) {
      if (background.alpha >= 1 || !fallbackBackground) {
        return background;
      }
      return blendColors(background, fallbackBackground) || background;
    }
    if (node === scopeRoot) {
      break;
    }
    node = node.parentElement;
  }

  return fallbackBackground || null;
}

function contrastRatioFromColors(foreground, background) {
  if (!foreground || !background) {
    return null;
  }

  const fg = foreground.alpha != null && foreground.alpha < 1
    ? blendColors(foreground, background)
    : foreground;

  if (!fg) {
    return null;
  }

  const lum1 = computeLuminance(fg);
  const lum2 = computeLuminance(background);
  return contrastRatio(lum1, lum2);
}

function getBackgroundLuminance(style) {
  if (!style) {
    return null;
  }
  const rgb = parseColorToRgb(style.backgroundColor);
  if (!rgb || rgb.alpha === 0) {
    return null;
  }
  return computeLuminance(rgb);
}

function isAuraDarkEnabled(scopeRoot) {
  if (!scopeRoot || !scopeRoot.ownerDocument?.defaultView) {
    return false;
  }

  const style = scopeRoot.ownerDocument.defaultView.getComputedStyle(scopeRoot);
  const colorScheme = style?.colorScheme || style?.getPropertyValue?.('color-scheme') || '';
  if (typeof colorScheme === 'string' && colorScheme.toLowerCase().includes('dark')) {
    return true;
  }

  const luminance = getBackgroundLuminance(style);
  if (typeof luminance === 'number') {
    return luminance < 0.4;
  }

  return false;
}

function sampleContrast(scopeRoot, maxSamples = 30) {
  if (!scopeRoot || typeof scopeRoot.querySelectorAll !== 'function') {
    return { ok: false, minRatio: 0, samples: 0, reason: 'scope-root-missing' };
  }

  const limit = Number.isFinite(maxSamples) ? Math.max(1, maxSamples) : 30;
  const fallbackBackground = resolveScopeRootBackground(scopeRoot);
  const candidates = Array.from(scopeRoot.querySelectorAll('p, li, span, a')).slice(0, limit);

  let minRatio = Infinity;
  let sampleCount = 0;

  candidates.forEach((element) => {
    if (!element || !element.ownerDocument?.defaultView) {
      return;
    }
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const fg = parseColorToRgb(style.color);
    const bg = resolveElementBackground(element, scopeRoot, fallbackBackground);

    if (!fg || !bg) {
      return;
    }

    const ratio = contrastRatioFromColors(fg, bg);
    if (typeof ratio === 'number') {
      sampleCount += 1;
      minRatio = Math.min(minRatio, ratio);
    }
  });

  if (!sampleCount || !Number.isFinite(minRatio)) {
    return { ok: false, minRatio: 0, samples: 0, reason: 'no-samples' };
  }

  return {
    ok: minRatio >= 4.5,
    minRatio,
    samples: sampleCount,
    isDark: isAuraDarkEnabled(scopeRoot),
  };
}

function getElementArea(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return 0;
  }
  const rect = element.getBoundingClientRect();
  if (!rect) {
    return 0;
  }
  return Math.max(0, rect.width * rect.height);
}

function isLargeEnough(element, minArea = AURA_SURFACE_MIN_AREA) {
  return getElementArea(element) > minArea;
}

function looksLikeCard(style) {
  if (!style) {
    return false;
  }
  const radius = Number.parseFloat(style.borderRadius) || 0;
  const borderWidth = Math.max(
    Number.parseFloat(style.borderTopWidth) || 0,
    Number.parseFloat(style.borderRightWidth) || 0,
    Number.parseFloat(style.borderBottomWidth) || 0,
    Number.parseFloat(style.borderLeftWidth) || 0,
  );
  const hasShadow = style.boxShadow && style.boxShadow !== 'none';
  return radius > 0 || borderWidth > 0 || hasShadow;
}

function getNodeTextLength(element) {
  if (!element) {
    return 0;
  }
  const text = (element.innerText || element.textContent || '').trim();
  return text.length;
}

function getNodeIdentityText(element) {
  if (!element) {
    return '';
  }
  const className = typeof element.className === 'string'
    ? element.className
    : typeof element.getAttribute === 'function'
      ? element.getAttribute('class') || ''
      : '';
  const id = typeof element.id === 'string'
    ? element.id
    : typeof element.getAttribute === 'function'
      ? element.getAttribute('id') || ''
      : '';
  const role = typeof element.getAttribute === 'function' ? element.getAttribute('role') || '' : '';
  return `${element.tagName || ''} ${id} ${className} ${role}`.toLowerCase();
}

function hasSelectorMatch(element, selector) {
  if (!element || typeof selector !== 'string') {
    return false;
  }
  try {
    if (typeof element.matches === 'function' && element.matches(selector)) {
      return true;
    }
    if (typeof element.closest === 'function' && element.closest(selector)) {
      return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function isCodeBlockLike(element) {
  if (!element) {
    return false;
  }
  if (['CODE', 'KBD', 'PRE', 'SAMP'].includes(element.tagName)) {
    return true;
  }
  return hasSelectorMatch(element, 'pre, code, kbd, samp');
}

function isEditableOrCodeEditorLike(element) {
  if (!element) {
    return false;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
    return true;
  }
  if (element.isContentEditable === true) {
    return true;
  }
  const contentEditable = typeof element.getAttribute === 'function'
    ? element.getAttribute('contenteditable')
    : null;
  if (contentEditable && contentEditable.toLowerCase() !== 'false') {
    return true;
  }

  const role = typeof element.getAttribute === 'function'
    ? (element.getAttribute('role') || '').toLowerCase()
    : '';
  if (['combobox', 'searchbox', 'textbox'].includes(role)) {
    return true;
  }

  if (hasSelectorMatch(element, '[contenteditable=""], [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]')) {
    return true;
  }

  const identity = getNodeIdentityText(element);
  return [
    'ace_editor',
    'cm-editor',
    'codemirror',
    'monaco-editor',
    'prosemirror',
  ].some((token) => identity.includes(token));
}

function hasProtectedMediaSurface(element, area = 0) {
  if (!element) {
    return false;
  }
  if (AURA_SURFACE_SKIP_TAGS.has(element.tagName)) {
    return true;
  }
  if (typeof element.querySelector !== 'function') {
    return false;
  }

  let media = null;
  try {
    media = element.querySelector('img, video, canvas, svg, iframe, audio, picture, object, embed');
  } catch (_) {
    return false;
  }
  if (!media) {
    return false;
  }

  const textLength = getNodeTextLength(element);
  if (textLength >= 120) {
    return false;
  }

  const mediaArea = getElementArea(media);
  const candidateArea = Number.isFinite(area) && area > 0 ? area : getElementArea(element);
  return textLength < 40 || (candidateArea > 0 && mediaArea / candidateArea >= 0.45);
}

function isDecorativeGradientBackground(backgroundImage = '') {
  const value = typeof backgroundImage === 'string' ? backgroundImage.trim().toLowerCase() : '';
  if (!value || value === 'none') {
    return false;
  }
  if (/\burl\s*\(/.test(value) || /\bimage-set\s*\(/.test(value) || /\bcross-fade\s*\(/.test(value)) {
    return false;
  }
  return /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/.test(value);
}

function isTextClippedBackground(element, style = null) {
  const values = [
    style?.backgroundClip,
    style?.webkitBackgroundClip,
    style?.WebkitBackgroundClip,
    typeof style?.getPropertyValue === 'function' ? style.getPropertyValue('background-clip') : '',
    typeof style?.getPropertyValue === 'function' ? style.getPropertyValue('-webkit-background-clip') : '',
    typeof element?.style?.getPropertyValue === 'function' ? element.style.getPropertyValue('background-clip') : '',
    typeof element?.style?.getPropertyValue === 'function' ? element.style.getPropertyValue('-webkit-background-clip') : '',
  ];
  return values.some((value) => /\btext\b/i.test(String(value || '')));
}

function isDarkTransformProtectedNode(element, style = null, area = 0) {
  if (!element) {
    return true;
  }
  if (AURA_SURFACE_SKIP_TAGS.has(element.tagName)) {
    return true;
  }
  if (isSurfaceDenylisted(element) && !isDecorativeGradientBackground(style?.backgroundImage)) {
    return true;
  }
  if (isCodeBlockLike(element) || isEditableOrCodeEditorLike(element)) {
    return true;
  }
  if (
    style?.backgroundImage
    && style.backgroundImage !== 'none'
    && !isDecorativeGradientBackground(style.backgroundImage)
  ) {
    return true;
  }
  return hasProtectedMediaSurface(element, area);
}

function countFormControls(element) {
  if (!element || typeof element.querySelectorAll !== 'function') {
    return 0;
  }
  try {
    return element.querySelectorAll('input, textarea, select, button').length;
  } catch (_) {
    return 0;
  }
}

function classifyDarkSurfaceKind(element, style) {
  if (!element) {
    return 'panel';
  }
  const role = typeof element.getAttribute === 'function'
    ? (element.getAttribute('role') || '').toLowerCase()
    : '';
  const identity = getNodeIdentityText(element);
  const position = `${style?.position || ''}`.toLowerCase();
  const isAppShell =
    AURA_APP_SHELL_TAGS.has(element.tagName)
    || AURA_APP_SHELL_ROLES.has(role)
    || AURA_APP_SHELL_IDENTITY_TOKENS.some((token) => identity.includes(token))
    || (
      (position === 'fixed' || position === 'sticky')
      && !['dialog', 'alertdialog', 'tooltip', 'listbox'].includes(role)
    );
  if (isAppShell) {
    return 'app-shell';
  }
  if (element.tagName === 'FORM' || role === 'form' || countFormControls(element) >= 2) {
    return 'form';
  }
  if (looksLikeCard(style)) {
    return 'card';
  }
  return 'panel';
}

function resolveEffectiveBackground(element, scopeRoot, fallbackBackground) {
  if (!element || !scopeRoot) {
    return fallbackBackground || null;
  }

  let node = element;
  while (node) {
    const { rgba, isTransparent } = getComputedBgColor(node);
    if (rgba && !isTransparent) {
      if (rgba.alpha >= 1 || !fallbackBackground) {
        return rgba;
      }
      return blendColors(rgba, fallbackBackground) || rgba;
    }
    if (node === scopeRoot) {
      break;
    }
    node = node.parentElement;
  }

  return fallbackBackground || null;
}

function isElementHidden(element, style) {
  if (!element || !style) {
    return true;
  }
  const ariaHidden = element.getAttribute?.('aria-hidden');
  if (ariaHidden === 'true') {
    return true;
  }
  if (element.hidden) {
    return true;
  }
  return style.display === 'none' || style.visibility === 'hidden';
}

function hasSignificantText(element, style) {
  if (!element || !style) {
    return false;
  }
  const disallowedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK']);
  if (disallowedTags.has(element.tagName)) {
    return false;
  }
  const text = (element.innerText || element.textContent || '').trim();
  if (text.length < 20) {
    return false;
  }
  const fontSize = Number.parseFloat(style.fontSize) || 0;
  return fontSize >= 12;
}

function isSurfaceDenylisted(node) {
  if (!node || typeof node.closest !== 'function') {
    return false;
  }
  return AURA_SURFACE_DENYLIST_SELECTORS.some((selector) => node.closest(selector));
}

function isNativeFormControlNode(node) {
  return Boolean(node?.tagName && AURA_FORM_CONTROL_TAGS.has(String(node.tagName).toUpperCase()));
}

function isDedicatedDarkSurfaceNode(node) {
  return Boolean(node?.tagName && AURA_CODE_SURFACE_TAGS.has(String(node.tagName).toUpperCase()));
}

function isKnownComplexArticleSurface(element) {
  if (!element || element.nodeType !== 1) {
    return false;
  }
  const signature = [
    element.className || '',
    element.id || '',
    element.getAttribute?.('role') || '',
  ].join(' ').toLowerCase();
  return /\b(?:infobox|toc|thumb|thumbinner|navbox|metadata|ambox|portal)\b/.test(signature)
    || signature.includes('mw-')
    || signature.includes('vector-')
    || signature.includes('wiki');
}

function readInlineValue(style, property) {
  if (!style || typeof style.getPropertyValue !== 'function') {
    return { value: null, priority: '' };
  }
  const value = style.getPropertyValue(property);
  const priority = style.getPropertyPriority(property);
  return {
    value: value ? value : null,
    priority: priority ? priority : '',
  };
}

function hasInlineTextColorOverride(element) {
  if (!element?.style) {
    return false;
  }
  return Boolean(
    readInlineValue(element.style, 'color').value
      || readInlineValue(element.style, '-webkit-text-fill-color').value,
  );
}

function isPriorityTextForceCandidate(element, style) {
  if (!element || !style || !hasSignificantText(element, style)) {
    return false;
  }
  const tagName = `${element.tagName || ''}`.toUpperCase();
  const role = `${element.getAttribute?.('role') || ''}`.toLowerCase();
  return /^H[1-6]$/.test(tagName) || role === 'heading' || hasInlineTextColorOverride(element);
}

function captureInlineOverride(element) {
  if (!element?.style) {
    return null;
  }
  const bg = readInlineValue(element.style, 'background-color');
  const bgImage = readInlineValue(element.style, 'background-image');
  const border = readInlineValue(element.style, 'border-color');
  const color = readInlineValue(element.style, 'color');
  const textFillColor = readInlineValue(element.style, '-webkit-text-fill-color');
  return {
    bg: bg.value,
    bgPriority: bg.priority,
    bgImage: bgImage.value,
    bgImagePriority: bgImage.priority,
    border: border.value,
    borderPriority: border.priority,
    color: color.value,
    colorPriority: color.priority,
    textFillColor: textFillColor.value,
    textFillColorPriority: textFillColor.priority,
  };
}

const AURA_INLINE_OVERRIDE_FIELDS = {
  'background-color': ['bg', 'bgPriority'],
  'background-image': ['bgImage', 'bgImagePriority'],
  'border-color': ['border', 'borderPriority'],
  color: ['color', 'colorPriority'],
  '-webkit-text-fill-color': ['textFillColor', 'textFillColorPriority'],
};

function updateInlineSnapshotProperty(snapshot, property, inlineValue) {
  const fields = AURA_INLINE_OVERRIDE_FIELDS[property];
  if (!snapshot || !fields) {
    return;
  }
  snapshot[fields[0]] = inlineValue?.value || null;
  snapshot[fields[1]] = inlineValue?.priority || '';
}

function getTrackedInlineSnapshot(state, element) {
  let snapshot = state.prev.get(element);
  if (!snapshot) {
    snapshot = captureInlineOverride(element);
    if (snapshot) {
      state.prev.set(element, snapshot);
    }
  }
  return snapshot;
}

function inlineValueMatchesTrackedAura(inlineValue, trackedValue) {
  if (!trackedValue) {
    return false;
  }
  return (
    (inlineValue?.value || null) === (trackedValue.value || null)
    && (inlineValue?.priority || '') === (trackedValue.priority || '')
  );
}

function prepareInlineAuraOverride(state, element, property) {
  const current = readInlineValue(element?.style, property);
  const snapshot = getTrackedInlineSnapshot(state, element);
  const applied = state.applied.get(element) || {};
  if (!inlineValueMatchesTrackedAura(current, applied[property])) {
    updateInlineSnapshotProperty(snapshot, property, current);
  }
  return applied;
}

function rememberInlineAuraOverride(state, element, property, value, priority = '') {
  const applied = state.applied.get(element) || {};
  applied[property] = {
    value: value || null,
    priority: priority || '',
  };
  state.applied.set(element, applied);
}

function restoreInlineValue(element, property, value, priority) {
  if (!element?.style || typeof element.style.setProperty !== 'function') {
    return;
  }
  if (value == null || value === '') {
    element.style.removeProperty(property);
    return;
  }
  element.style.setProperty(property, value, priority || '');
}

function restoreInlineOverride(element, snapshot, applied = {}) {
  if (!snapshot || !element?.style) {
    return;
  }
  const restoreIfStillAura = (property, value, priority) => {
    const current = readInlineValue(element.style, property);
    const tracked = applied?.[property] || null;
    if (tracked && inlineValueMatchesTrackedAura(current, tracked)) {
      restoreInlineValue(element, property, value, priority);
    }
  };
  restoreIfStillAura('background-color', snapshot.bg, snapshot.bgPriority);
  restoreIfStillAura('background-image', snapshot.bgImage, snapshot.bgImagePriority);
  restoreIfStillAura('border-color', snapshot.border, snapshot.borderPriority);
  restoreIfStillAura('color', snapshot.color, snapshot.colorPriority);
  restoreIfStillAura('-webkit-text-fill-color', snapshot.textFillColor, snapshot.textFillColorPriority);
}

function hasVisibleBorder(style) {
  if (!style) {
    return false;
  }
  const widths = [
    Number.parseFloat(style.borderTopWidth) || 0,
    Number.parseFloat(style.borderRightWidth) || 0,
    Number.parseFloat(style.borderBottomWidth) || 0,
    Number.parseFloat(style.borderLeftWidth) || 0,
  ];
  const hasWidth = widths.some((value) => value > 0);
  if (!hasWidth) {
    return false;
  }
  const styles = [
    style.borderTopStyle,
    style.borderRightStyle,
    style.borderBottomStyle,
    style.borderLeftStyle,
  ];
  if (styles.every((value) => !value || value === 'none' || value === 'hidden')) {
    return false;
  }
  const borderColor = parseColorToRgb(style.borderTopColor || style.borderColor || '');
  return !borderColor || borderColor.alpha > 0;
}

function resolveTokenColor(scopeRoot, tokenName) {
  if (!scopeRoot?.ownerDocument?.defaultView) {
    return null;
  }
  const style = scopeRoot.ownerDocument.defaultView.getComputedStyle(scopeRoot);
  const value = style.getPropertyValue(tokenName);
  if (!value) {
    return null;
  }
  return parseColorToRgb(value.trim());
}

function shouldForceTextColor(element, scopeRoot, surfaceToken) {
  if (!element || !scopeRoot) {
    return false;
  }

  const textColor = getComputedTextColor(element);
  if (!textColor) {
    return false;
  }

  const targetBackground = resolveTokenColor(scopeRoot, surfaceToken);
  if (targetBackground) {
    const ratio = contrastRatioFromColors(textColor, targetBackground);
    return Number.isFinite(ratio) ? ratio < 4.5 : false;
  }

  const textLum = computeLuminance(textColor);
  return isAuraDarkEnabled(scopeRoot) && Number.isFinite(textLum) && textLum < 0.4;
}

function applyDarkSurfaceInlineOverrides(scopeRoot, opts = {}) {
  if (!scopeRoot || scopeRoot.nodeType !== 1) {
    return { ok: false, scanned: 0, overridden: 0, forcedText: 0, reason: 'invalid-scope' };
  }

  const view = scopeRoot.ownerDocument?.defaultView;
  if (!view) {
    return { ok: false, scanned: 0, overridden: 0, forcedText: 0, reason: 'missing-view' };
  }

  const maxNodes = Number.isFinite(opts.maxNodes) ? opts.maxNodes : AURA_INLINE_SURFACE_DEFAULTS.maxNodes;
  const maxMs = Number.isFinite(opts.maxMs) ? opts.maxMs : AURA_INLINE_SURFACE_DEFAULTS.maxMs;
  const minArea = Number.isFinite(opts.minArea) ? opts.minArea : AURA_INLINE_SURFACE_DEFAULTS.minArea;
  const lumThreshold = Number.isFinite(opts.lumThreshold)
    ? opts.lumThreshold
    : AURA_INLINE_SURFACE_DEFAULTS.lumThreshold;
  const cardLumThreshold = Number.isFinite(opts.cardLumThreshold)
    ? opts.cardLumThreshold
    : AURA_INLINE_SURFACE_DEFAULTS.cardLumThreshold;
  const maxCandidates = Number.isFinite(opts.maxCandidates)
    ? Math.max(1, opts.maxCandidates)
    : AURA_INLINE_SURFACE_DEFAULTS.maxCandidates;
  const maxForceText = Number.isFinite(opts.maxForceText)
    ? Math.max(0, opts.maxForceText)
    : AURA_INLINE_SURFACE_DEFAULTS.maxForceText;

  const start = typeof view.performance?.now === 'function' ? view.performance.now() : Date.now();
  const walker = scopeRoot.ownerDocument?.createTreeWalker
    ? scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1)
    : null;
  const fallbackBackground = resolveScopeRootBackground(scopeRoot);

  let scanned = 0;
  let budgetHit = false;
  const candidates = [];
  const forceTextCandidates = [];

  let node = walker ? walker.currentNode : scopeRoot;
  while (node) {
    const elapsed =
      (typeof view.performance?.now === 'function' ? view.performance.now() : Date.now()) - start;
    if (scanned >= maxNodes || elapsed > maxMs) {
      budgetHit = true;
      break;
    }

    if (!node || node.nodeType !== 1) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }
    const tagName = String(node.tagName || '').toUpperCase();

    const style = view.getComputedStyle(node);
    if (!style || isElementHidden(node, style)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const hasDecorativeGradient = isDecorativeGradientBackground(style.backgroundImage);
    const isNativeControl = isNativeFormControlNode(node);
    if ((isNativeControl || isDedicatedDarkSurfaceNode(node)) && !hasDecorativeGradient) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const area = getElementArea(node);
    const knownComplexArticleSurface = isKnownComplexArticleSurface(node);
    const hasGradientSurfaceArea = Boolean(hasDecorativeGradient && area && area >= 24);
    const hasSurfaceArea = Boolean(
      area && (area >= minArea || hasGradientSurfaceArea || (knownComplexArticleSurface && area >= 400)),
    );
    if (
      !hasSurfaceArea
      && forceTextCandidates.length < maxForceText
      && isPriorityTextForceCandidate(node, style)
      && shouldForceTextColor(node, scopeRoot, '--aura-surface-1')
    ) {
      forceTextCandidates.push(node);
    }
    if (!area || !hasSurfaceArea) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (isDarkTransformProtectedNode(node, style, area)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (
      forceTextCandidates.length < maxForceText
      && hasSignificantText(node, style)
      && shouldForceTextColor(node, scopeRoot, '--aura-surface-1')
    ) {
      forceTextCandidates.push(node);
    }

    const background = resolveEffectiveBackground(node, scopeRoot, fallbackBackground);
    if ((!background || background.alpha < 0.85) && !hasDecorativeGradient) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const luminance = computeLuminance(background);
    const isCard = knownComplexArticleSurface || looksLikeCard(style);
    const threshold = isCard ? cardLumThreshold : lumThreshold;
    if (hasDecorativeGradient || (typeof luminance === 'number' && luminance > threshold)) {
      candidates.push({
        element: node,
        area,
        isCard,
        isNativeControl,
        isDocumentRoot: tagName === 'HTML' || tagName === 'BODY',
        knownComplexArticleSurface,
        luminance,
        hasDecorativeGradient,
      });
    }

    scanned += 1;
    node = walker ? walker.nextNode() : null;
  }

  if (budgetHit) {
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ME2] inline surface override budget hit', {
        scanned,
        maxNodes,
        maxMs,
        candidates: candidates.length,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.hasDecorativeGradient !== b.hasDecorativeGradient) {
      return a.hasDecorativeGradient ? -1 : 1;
    }
    return b.area - a.area;
  });
  const shortlist = candidates.slice(0, maxCandidates);

  let overridden = 0;
  let forcedText = 0;
  const state = AURA_INLINE_SURFACE_STATE;
  const forcedTextElements = new Set();

  const forceTextElement = (element) => {
    if (!element || !element.style || forcedTextElements.has(element)) {
      return;
    }
    prepareInlineAuraOverride(state, element, 'color');
    element.style.setProperty('color', 'var(--aura-text-color)', 'important');
    rememberInlineAuraOverride(state, element, 'color', 'var(--aura-text-color)', 'important');
    prepareInlineAuraOverride(state, element, '-webkit-text-fill-color');
    element.style.setProperty('-webkit-text-fill-color', 'var(--aura-text-color)', 'important');
    rememberInlineAuraOverride(state, element, '-webkit-text-fill-color', 'var(--aura-text-color)', 'important');
    state.touched.add(element);
    forcedTextElements.add(element);
    forcedText += 1;
  };

  shortlist.forEach(({ element, isCard, isNativeControl, isDocumentRoot, knownComplexArticleSurface }) => {
    if (!element || !element.style) {
      return;
    }

    const surfaceToken = isDocumentRoot
      ? '--aura-bg-color'
      : isNativeControl || (isCard && !knownComplexArticleSurface)
        ? '--aura-surface-2'
        : '--aura-surface-1';
    const backgroundValue = isDocumentRoot ? 'var(--aura-bg-color, #0b1020)' : `var(${surfaceToken})`;
    const style = view.getComputedStyle(element);
    prepareInlineAuraOverride(state, element, 'background-color');
    element.style.setProperty('background-color', backgroundValue, 'important');
    rememberInlineAuraOverride(state, element, 'background-color', backgroundValue, 'important');
    if (isDecorativeGradientBackground(style.backgroundImage) && !isTextClippedBackground(element, style)) {
      prepareInlineAuraOverride(state, element, 'background-image');
      element.style.setProperty('background-image', 'none', 'important');
      rememberInlineAuraOverride(state, element, 'background-image', 'none', 'important');
    }
    overridden += 1;

    if (hasVisibleBorder(style)) {
      prepareInlineAuraOverride(state, element, 'border-color');
      element.style.setProperty('border-color', 'var(--aura-border-color)', 'important');
      rememberInlineAuraOverride(state, element, 'border-color', 'var(--aura-border-color)', 'important');
    }

    if (hasSignificantText(element, style) && shouldForceTextColor(element, scopeRoot, surfaceToken)) {
      forceTextElement(element);
    }

    state.touched.add(element);
  });

  forceTextCandidates.forEach((element) => {
    forceTextElement(element);
  });

  return {
    ok: budgetHit !== true,
    scanned,
    overridden,
    forcedText,
    budgetHit,
    ...(budgetHit ? { reason: 'budget-hit-partial' } : {}),
  };
}

function clearDarkSurfaceInlineOverrides() {
  const state = AURA_INLINE_SURFACE_STATE;
  let restored = 0;

  state.touched.forEach((element) => {
    if (!element?.style) {
      return;
    }
    const snapshot = state.prev.get(element);
    const applied = state.applied.get(element) || {};
    restoreInlineOverride(element, snapshot, applied);
    restored += 1;
  });

  state.touched.clear();
  state.prev = new WeakMap();
  state.applied = new WeakMap();

  return { ok: true, restored };
}

function applyDarkSurfaceTags(scopeEl, options = {}) {
  if (!scopeEl || scopeEl.nodeType !== 1) {
    return { ok: false, scanned: 0, surfaced: 0, forcedText: 0, reason: 'invalid-scope' };
  }

  const view = scopeEl.ownerDocument?.defaultView;
  if (!view) {
    return { ok: false, scanned: 0, surfaced: 0, forcedText: 0, reason: 'missing-view' };
  }

  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : AURA_SURFACE_DEFAULT_BUDGET.maxNodes;
  const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : AURA_SURFACE_DEFAULT_BUDGET.maxMs;
  const maxSurfaces = Number.isFinite(options.maxSurfaces)
    ? Math.max(0, Math.floor(options.maxSurfaces))
    : AURA_SURFACE_MAX_SURFACES;
  const maxForceText = Number.isFinite(options.maxForceText)
    ? Math.max(0, Math.floor(options.maxForceText))
    : AURA_FORCE_TEXT_MAX_NODES;
  const surfaceLum = Number.isFinite(options.surfaceLum) ? options.surfaceLum : AURA_SURFACE_LIGHT_THRESHOLD;
  const minArea = Number.isFinite(options.minArea) ? options.minArea : AURA_SURFACE_MIN_AREA;

  const start = typeof view.performance?.now === 'function' ? view.performance.now() : Date.now();
  const walker = scopeEl.ownerDocument?.createTreeWalker
    ? scopeEl.ownerDocument.createTreeWalker(scopeEl, view.NodeFilter?.SHOW_ELEMENT || 1)
    : null;
  const fallbackBackground = resolveScopeRootBackground(scopeEl);

  let scanned = 0;
  let surfaced = 0;
  let forcedText = 0;
  let budgetHit = false;

  let node = walker ? walker.currentNode : scopeEl;
  while (node) {
    const elapsed =
      (typeof view.performance?.now === 'function' ? view.performance.now() : Date.now()) - start;
    if (scanned >= maxNodes || elapsed > maxMs) {
      budgetHit = true;
      break;
    }

    if (!node || node.nodeType !== 1) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const style = view.getComputedStyle(node);
    if (!style || isElementHidden(node, style)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const area = getElementArea(node);
    if (isDarkTransformProtectedNode(node, style, area)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (surfaced < maxSurfaces && !node.hasAttribute(AURA_SURFACE_ATTR) && area > minArea) {
      const { rgba, isTransparent } = getComputedBgColor(node);
      if (rgba && !isTransparent && rgba.alpha >= 0.85) {
        const luminance = relativeLuminance(rgba);
        if (typeof luminance === 'number' && luminance > surfaceLum) {
          const surfaceKind = classifyDarkSurfaceKind(node, style);
          const tag = surfaceKind === 'app-shell' || looksLikeCard(style) ? '2' : '1';
          node.setAttribute(AURA_SURFACE_ATTR, tag);
          node.setAttribute(AURA_SURFACE_KIND_ATTR, surfaceKind);
          AURA_SURFACE_TAG_STATE.surface.add(node);
          surfaced += 1;
        }
      }
    }

    if (forcedText < maxForceText && !node.hasAttribute(AURA_FORCE_TEXT_ATTR) && hasSignificantText(node, style)) {
      const textColor = getComputedTextColor(node);
      const background = resolveEffectiveBackground(node, scopeEl, fallbackBackground);
      if (textColor && background) {
        const effectiveTextColor =
          Number.isFinite(textColor.alpha) && textColor.alpha < 1
            ? blendColors(textColor, background)
            : textColor;
        const textLum = effectiveTextColor ? relativeLuminance(effectiveTextColor) : null;
        const bgLum = relativeLuminance(background);
        const ratio = contrastRatio(textLum, bgLum);
        const isDarkText = Number.isFinite(textLum) && textLum < 0.4;
        const isDarkBackground = Number.isFinite(bgLum) && bgLum < 0.4;
        if ((Number.isFinite(ratio) && ratio < 4.5) || (isDarkText && isDarkBackground)) {
          node.setAttribute(AURA_FORCE_TEXT_ATTR, '1');
          AURA_SURFACE_TAG_STATE.forceText.add(node);
          forcedText += 1;
        }
      }
    }

    scanned += 1;
    node = walker ? walker.nextNode() : null;
  }

  const result = { ok: true, scanned, surfaced, forcedText };
  if (budgetHit) {
    result.budgetHit = true;
  }
  if (surfaced >= maxSurfaces || forcedText >= maxForceText) {
    result.capHit = true;
  }
  return result;
}

function clearTrackedDarkSurfaceTags() {
  let clearedSurface = 0;
  let clearedSurfaceKind = 0;
  let clearedForceText = 0;

  AURA_SURFACE_TAG_STATE.surface.forEach((node) => {
    if (node && typeof node.removeAttribute === 'function' && node.hasAttribute?.(AURA_SURFACE_ATTR)) {
      node.removeAttribute(AURA_SURFACE_ATTR);
      clearedSurface += 1;
    }
    if (node && typeof node.removeAttribute === 'function' && node.hasAttribute?.(AURA_SURFACE_KIND_ATTR)) {
      node.removeAttribute(AURA_SURFACE_KIND_ATTR);
      clearedSurfaceKind += 1;
    }
  });
  AURA_SURFACE_TAG_STATE.forceText.forEach((node) => {
    if (node && typeof node.removeAttribute === 'function' && node.hasAttribute?.(AURA_FORCE_TEXT_ATTR)) {
      node.removeAttribute(AURA_FORCE_TEXT_ATTR);
      clearedForceText += 1;
    }
  });

  AURA_SURFACE_TAG_STATE.surface.clear();
  AURA_SURFACE_TAG_STATE.forceText.clear();

  return { clearedSurface, clearedSurfaceKind, clearedForceText };
}

function clearDarkSurfaceTags(scopeEl, options = {}) {
  const tracked = clearTrackedDarkSurfaceTags();

  if (!scopeEl || scopeEl.nodeType !== 1) {
    return {
      ok: false,
      scanned: 0,
      clearedSurface: tracked.clearedSurface,
      clearedSurfaceKind: tracked.clearedSurfaceKind,
      clearedForceText: tracked.clearedForceText,
      reason: 'invalid-scope',
    };
  }

  const view = scopeEl.ownerDocument?.defaultView;
  if (!view) {
    return {
      ok: false,
      scanned: 0,
      clearedSurface: tracked.clearedSurface,
      clearedSurfaceKind: tracked.clearedSurfaceKind,
      clearedForceText: tracked.clearedForceText,
      reason: 'missing-view',
    };
  }

  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : AURA_SURFACE_DEFAULT_BUDGET.maxNodes;
  const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : AURA_SURFACE_DEFAULT_BUDGET.maxMs;
  const start = typeof view.performance?.now === 'function' ? view.performance.now() : Date.now();

  const walker = scopeEl.ownerDocument?.createTreeWalker
    ? scopeEl.ownerDocument.createTreeWalker(scopeEl, view.NodeFilter?.SHOW_ELEMENT || 1)
    : null;

  let scanned = 0;
  let clearedSurface = tracked.clearedSurface;
  let clearedSurfaceKind = tracked.clearedSurfaceKind;
  let clearedForceText = tracked.clearedForceText;
  let budgetHit = false;

  let node = walker ? walker.currentNode : scopeEl;
  while (node) {
    const elapsed =
      (typeof view.performance?.now === 'function' ? view.performance.now() : Date.now()) - start;
    if (scanned >= maxNodes || elapsed > maxMs) {
      budgetHit = true;
      break;
    }

    if (!node || node.nodeType !== 1) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (node.hasAttribute(AURA_SURFACE_ATTR)) {
      node.removeAttribute(AURA_SURFACE_ATTR);
      clearedSurface += 1;
    }
    if (node.hasAttribute(AURA_SURFACE_KIND_ATTR)) {
      node.removeAttribute(AURA_SURFACE_KIND_ATTR);
      clearedSurfaceKind += 1;
    }
    if (node.hasAttribute(AURA_FORCE_TEXT_ATTR)) {
      node.removeAttribute(AURA_FORCE_TEXT_ATTR);
      clearedForceText += 1;
    }

    scanned += 1;
    node = walker ? walker.nextNode() : null;
  }

  const result = { ok: true, scanned, clearedSurface, clearedSurfaceKind, clearedForceText };
  if (budgetHit) {
    result.budgetHit = true;
  }
  return result;
}

function scanAndTagLightSurfaces(scopeRoot, budget = AURA_SURFACE_DEFAULT_BUDGET) {
  applyDarkSurfaceTags(scopeRoot, {
    maxNodes: budget?.maxNodes,
    maxMs: budget?.maxMs,
    surfaceLum: AURA_SURFACE_LIGHT_THRESHOLD,
    minArea: AURA_SURFACE_MIN_AREA,
  });
}

function removeAuraSurfaceTags(scopeRoot, budget = AURA_SURFACE_DEFAULT_BUDGET) {
  clearDarkSurfaceTags(scopeRoot, {
    maxNodes: budget?.maxNodes,
    maxMs: budget?.maxMs,
  });
}

function setupAuraSurfaceObserver(scopeRoot) {
  if (!scopeRoot || typeof scopeRoot.querySelectorAll !== 'function') {
    return;
  }

  const existing = AURA_SURFACE_OBSERVERS.get(scopeRoot);
  if (!isAuraDarkEnabled(scopeRoot)) {
    if (existing?.observer) {
      existing.observer.disconnect();
    }
    if (existing?.timerId) {
      scopeRoot.ownerDocument?.defaultView?.clearTimeout?.(existing.timerId);
    }
    AURA_SURFACE_OBSERVERS.delete(scopeRoot);
    removeAuraSurfaceTags(scopeRoot);
    return;
  }

  if (existing?.observer) {
    return;
  }

  const view = scopeRoot.ownerDocument?.defaultView;
  const scheduleScan = () => {
    const current = AURA_SURFACE_OBSERVERS.get(scopeRoot);
    if (current?.timerId) {
      view?.clearTimeout?.(current.timerId);
    }
    const timerId = view?.setTimeout?.(() => {
      scanAndTagLightSurfaces(scopeRoot);
    }, AURA_SURFACE_OBSERVER_DELAY);
    if (current) {
      current.timerId = timerId;
    }
  };

  const observer = new MutationObserver(() => {
    if (!isAuraDarkEnabled(scopeRoot)) {
      setupAuraSurfaceObserver(scopeRoot);
      return;
    }
    scheduleScan();
  });

  observer.observe(scopeRoot, { childList: true, subtree: true });
  AURA_SURFACE_OBSERVERS.set(scopeRoot, { observer, timerId: null });
  scanAndTagLightSurfaces(scopeRoot);
}

function teardownAuraSurfaceObserver(scopeRoot) {
  const existing = AURA_SURFACE_OBSERVERS.get(scopeRoot);
  if (existing?.observer) {
    existing.observer.disconnect();
  }
  if (existing?.timerId) {
    scopeRoot.ownerDocument?.defaultView?.clearTimeout?.(existing.timerId);
  }
  AURA_SURFACE_OBSERVERS.delete(scopeRoot);
  removeAuraSurfaceTags(scopeRoot);
}

  globalThis.AURA_MODE_ENGINE_SCOPED_V2 = Object.freeze({
    SCOPE_ATTR,
    SCOPE_ATTR_VALUE,
    SCOPE_OWNER_ATTR,
    SCOPE_OWNER_VALUE,
    MODE_ENGINE_SCOPE_SELECTOR,
    MODE_ENGINE_SCOPE_ATTR,
    MODE_ENGINE_SCOPE_VALUE,
    MODE_ENGINE_SCOPE_OWNER_ATTR,
    MODE_ENGINE_SCOPE_TOKENS_ATTR,
    SCOPED_TOKEN_KEYS,
    getTokenKeys,
    computeTokensV2,
    makeScopedV2Key,
    computeAppliedHash,
    buildScopedTokenMap,
    buildScopedModeCssV2,
    verifyScopeRoot,
    descendCandidateForContentRoot,
    applyScopedTokens,
    cleanupScopedTokens,
    markScopeOwned,
    unmarkScopeIfOwned,
    unmarkScopeIfOwnedBySelector,
    verifyScopeRootBySelector,
    collectInspectionBaseline,
    inspectPostApply,
    salvageScopeRootBySelector,
    applyScopedTokensBySelector,
    cleanupScopedTokensBySelector,
    applyTokensToScopeRoot,
    removeTokensOwned,
    applyTokensToScopeBySelector,
    removeTokensOwnedBySelector,
    isAuraDarkEnabled,
    sampleContrast,
    applyDarkSurfaceTags,
    clearDarkSurfaceTags,
    applyDarkSurfaceInlineOverrides,
    clearDarkSurfaceInlineOverrides,
    scanAndTagLightSurfaces,
    setupAuraSurfaceObserver,
  });
})();
