import { MODE_IDS } from './constants.js';

export const SCOPE_ATTR = 'data-aura-scope';
export const SCOPE_ATTR_VALUE = '1';
export const SCOPE_OWNER_ATTR = 'data-aura-scope-owner';
export const SCOPE_OWNER_VALUE = 'aura-me2';
export const ANIM_ATTR = 'data-aura-anim';
export const ANIM_ATTR_VALUE = '1';

export const MODE_ENGINE_SCOPE_SELECTOR = '[data-aura-scope="1"]';
export const MODE_ENGINE_SCOPE_ATTR = SCOPE_ATTR;
export const MODE_ENGINE_SCOPE_VALUE = SCOPE_ATTR_VALUE;
export const MODE_ENGINE_SCOPE_OWNER_ATTR = SCOPE_OWNER_ATTR;
export const MODE_ENGINE_SCOPE_TOKENS_ATTR = 'data-aura-scope-tokens';
// KEEP IN SYNC with content/mode-engine-scoped-v2.runtime.js (SCOPED_TOKEN_KEYS).
export const SCOPED_TOKEN_KEYS = [
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

export function getTokenKeys(tokens = {}) {
  return Object.keys(tokens || {}).filter((key) => typeof key === 'string');
}

export function computeTokensV2({ profile, intensity, modeId, overrides = {} } = {}) {
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

export function makeScopedV2Key(tabId, frameId = 0) {
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

export function computeAppliedHash({ cssText = '', tokens = {}, cssId = '', modeId = '' } = {}) {
  const parts = [String(cssId), String(modeId), String(cssText), stableTokenPairs(tokens)].join('#');
  return simpleHash(parts);
}

function clampIntensity(rawIntensity) {
  if (typeof rawIntensity !== 'number' || Number.isNaN(rawIntensity)) {
    return 1;
  }
  return Math.min(Math.max(rawIntensity, 0), 1);
}

export function buildScopedTokenMap(modeId, intensity = 1, _profile = null) {
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

export function buildScopedModeCssV2({
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

export function verifyScopeRoot(element) {
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

export async function descendCandidateForContentRoot(
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

export function applyScopedTokens(element, tokenMap = {}, ownerKey = '') {
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

export function cleanupScopedTokens(element, ownerKey = '', ownedKeys = [], options = {}) {
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

  return { ok: true, removed: keys.length };
}

export function markScopeOwned(element, ownerKey = '') {
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

export function unmarkScopeIfOwned(element, ownerKey = '') {
  if (!element || typeof element.removeAttribute !== 'function') {
    return { didUnmark: false };
  }

  const normalizedOwner = normalizeOwnerKey(ownerKey);
  if (!ownsScope(element, normalizedOwner)) {
    return { didUnmark: false };
  }

  element.removeAttribute(SCOPE_OWNER_ATTR);
  element.removeAttribute(SCOPE_ATTR);
  return { didUnmark: true };
}

export function unmarkScopeIfOwnedBySelector(selector, ownerKey = '') {
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

export function verifyScopeRootBySelector(selector) {
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

export function salvageScopeRootBySelector(selector, debugEnabled = false) {
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

export function applyScopedTokensBySelector(selector, tokenMap = {}, ownerKey = '') {
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

export function cleanupScopedTokensBySelector(selector, ownerKey = '', ownedKeys = [], options = {}) {
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

export function applyTokensToScopeRoot(scopeEl, tokenMap = {}) {
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

  return { ok: true, applied: entries.length, ownedKeys: entries.map(([key]) => key) };
}

export function removeTokensOwned(scopeEl, ownedKeys = []) {
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

export function applyTokensToScopeBySelector(selector, tokenMap = {}) {
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

export function removeTokensOwnedBySelector(selector, ownedKeys = []) {
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
