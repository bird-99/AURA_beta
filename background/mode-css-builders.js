import {
  MODE_ENGINE_SMOOTH_TRANSITION_MS,
  MODE_IDS,
} from '../shared/constants.js';
import { normalizeComfortVisualPrefs } from '../shared/comfort-visual-prefs.js';
import {
  ANIM_ATTR,
  ANIM_ATTR_VALUE,
  MODE_ENGINE_SCOPE_SELECTOR,
} from '../shared/mode-engine-scoped-v2.js';

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

const STRICT_VARIANT = 'STRICT';
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
const COMFORT_TEXT_SCALE_DISABLED_TOKENS = Object.freeze({
  '--aura-font-size': '1em',
});
const COMFORT_SPACING_PACK_DISABLED_TOKENS = Object.freeze({
  '--aura-line-height': 'normal',
  '--aura-paragraph-spacing': '0px',
});
const COMFORT_REFLOW_GUARD_SOFT_TOKENS = Object.freeze({
  '--aura-overflow-wrap': 'break-word',
  '--aura-hyphens': 'manual',
  '--aura-word-break': 'normal',
});
const COMFORT_REFLOW_GUARD_EMERGENCY_TOKENS = Object.freeze({
  '--aura-overflow-wrap': 'anywhere',
  '--aura-hyphens': 'auto',
  '--aura-word-break': 'normal',
});
const COMFORT_DARK_RUNTIME_ENABLED = true;

function isComfortDarkRuntimeEnabled() {
  return COMFORT_DARK_RUNTIME_ENABLED === true;
}

function isComfortDarkModeRequested({ comfortPrefs, modePrefs } = {}) {
  return comfortPrefs?.darkMode === true || modePrefs?.darkMode === true;
}

function isComfortDarkModeEnabled({ comfortPrefs, modePrefs } = {}) {
  return isComfortDarkModeRequested({ comfortPrefs, modePrefs }) && isComfortDarkRuntimeEnabled();
}

function buildComfortVisualTokenOverrides(cvPrefs) {
  const prefs = normalizeComfortVisualPrefs(cvPrefs);
  const overrides = {};

  if (prefs.textScale === false) {
    Object.assign(overrides, COMFORT_TEXT_SCALE_DISABLED_TOKENS);
  }

  if (prefs.spacingPack === false) {
    Object.assign(overrides, COMFORT_SPACING_PACK_DISABLED_TOKENS);
  }

  if (prefs.linkEnhance === true) {
    overrides['--aura-link-decoration'] = 'underline';
    overrides['--aura-link-decoration-thickness'] = '0.12em';
    overrides['--aura-link-decoration-offset'] = '0.18em';
    overrides['--aura-link-underline-position'] = 'under';
  }

  if (prefs.typoSmoothing === true) {
    overrides['--aura-font-smoothing'] = 'antialiased';
  }

  if (prefs.reflowGuard === true) {
    Object.assign(overrides, COMFORT_REFLOW_GUARD_SOFT_TOKENS);
  } else {
    overrides['--aura-overflow-wrap'] = 'normal';
    overrides['--aura-hyphens'] = 'manual';
    overrides['--aura-word-break'] = 'normal';
  }

  if (isComfortDarkModeEnabled({ comfortPrefs: prefs })) {
    Object.assign(overrides, COMFORT_DARK_TOKENS);
  }

  return overrides;
}

function buildComfortEmergencyReflowGuardTokenOverrides() {
  return { ...COMFORT_REFLOW_GUARD_EMERGENCY_TOKENS };
}

function buildComfortPreludeCss({ darkModeEnabled, tokenMap = null } = {}) {
  if (darkModeEnabled !== true) {
    return '';
  }

  const tokens = tokenMap && typeof tokenMap === 'object' ? tokenMap : {};
  const readToken = (key) => (typeof tokens[key] === 'string' && tokens[key].trim()
    ? tokens[key].trim()
    : COMFORT_DARK_TOKENS[key]);
  const bg = readToken('--aura-bg-color');
  const text = readToken('--aura-text-color');
  const muted = readToken('--aura-muted-text-color');
  const border = readToken('--aura-border-color');
  const surface1 = readToken('--aura-surface-1');
  const surface2 = readToken('--aura-surface-2');
  const link = readToken('--aura-link-color');
  const visited = readToken('--aura-link-visited-color');
  const hover = readToken('--aura-link-hover-color');
  const focus = readToken('--aura-focus-color') || '#9ab7ff';
  const shellSelector =
    'body > :not([data-aura-scope="1"]):not(script):not(style):not(link):not(meta):not(noscript):not(template)';
  const wikiShellSelector =
    ':where(.mw-page-base, #mw-page-base, #mw-navigation, .mw-body, .mw-parser-output, .vector-header-container, .vector-page-toolbar, .vector-page-titlebar, .vector-page-container, .vector-toc, .vector-menu, .vector-menu-content, .mw-portlet, .portal, .infobox, #wiki-infobox, [id*="infobox" i], .toc, .thumbinner, .wikitable, .navbox, [id*="navbox" i], .metadata, [id*="metadata" i], .ambox, [id*="ambox" i])';
  const wikiShellStrongSelector =
    ':is(.mw-page-base, #mw-page-base, #mw-navigation, .mw-body, .mw-parser-output, .vector-header-container, .vector-page-toolbar, .vector-page-titlebar, .vector-page-container, .vector-toc, .vector-menu, .vector-menu-content, .mw-portlet, .portal, .infobox, #wiki-infobox, [id*="infobox" i], .toc, .thumbinner, .wikitable, .navbox, [id*="navbox" i], .metadata, [id*="metadata" i], .ambox, [id*="ambox" i])';
  const partSurfaceSelector = [
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
  ].map((part) => `body :where(*)::part(${part})`).join(', ');
  const partControlSelector = [
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
  ].map((part) => `body :where(*)::part(${part})`).join(', ');
  const formatSensitiveDesignTokens = new Set([
    '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
    '--primary', '--primary-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
    '--accent', '--accent-foreground', '--border', '--input', '--ring', '--color-background', '--color-foreground',
    '--color-surface', '--color-surface-2', '--color-text', '--color-muted', '--color-border', '--color-link',
  ]);
  const designSystemTokenDeclarations = [
    ['--background', bg],
    ['--foreground', text],
    ['--card', surface1],
    ['--card-foreground', text],
    ['--popover', surface1],
    ['--popover-foreground', text],
    ['--primary', link],
    ['--primary-foreground', bg],
    ['--secondary', surface2],
    ['--secondary-foreground', text],
    ['--muted', surface2],
    ['--muted-foreground', muted],
    ['--accent', surface2],
    ['--accent-foreground', text],
    ['--border', border],
    ['--input', border],
    ['--ring', focus],
    ['--color-background', bg],
    ['--color-foreground', text],
    ['--color-surface', surface1],
    ['--color-surface-2', surface2],
    ['--color-text', text],
    ['--color-muted', muted],
    ['--color-border', border],
    ['--color-link', link],
    ['--bs-body-bg', bg],
    ['--bs-body-color', text],
    ['--bs-border-color', border],
    ['--bs-link-color', link],
    ['--bs-link-hover-color', hover],
    ['--bs-secondary-bg', surface2],
    ['--bs-tertiary-bg', surface1],
    ['--bs-emphasis-color', text],
    ['--md-sys-color-background', bg],
    ['--md-sys-color-on-background', text],
    ['--md-sys-color-surface', surface1],
    ['--md-sys-color-surface-container', surface1],
    ['--md-sys-color-surface-container-high', surface2],
    ['--md-sys-color-on-surface', text],
    ['--md-sys-color-outline', border],
    ['--md-sys-color-primary', link],
    ['--md-sys-color-on-primary', bg],
    ['--bgColor-default', bg],
    ['--bgColor-muted', surface1],
    ['--fgColor-default', text],
    ['--fgColor-muted', muted],
    ['--borderColor-default', border],
    ['--color-canvas-default', bg],
    ['--color-canvas-subtle', surface1],
    ['--color-fg-default', text],
    ['--color-fg-muted', muted],
    ['--color-border-default', border],
    ['--color-accent-fg', link],
  ]
    .filter(([name]) => !formatSensitiveDesignTokens.has(name))
    .map(([name, value]) => `${name}: ${value} !important;`)
    .join(' ');
  const designSystemLocalTokenSelector =
    ':where([data-theme], [data-color-mode], [data-bs-theme], [data-mui-color-scheme], [data-surface], [data-card], [data-panel], [data-dialog], [data-popover], [class*="card" i], [class*="panel" i], [class*="surface" i], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="menu" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tabpanel"])';

  return [
    `html, body { ${designSystemTokenDeclarations} }`,
    `body ${designSystemLocalTokenSelector} { ${designSystemTokenDeclarations} }`,
    `html { color-scheme: dark !important; background-color: ${bg} !important; scrollbar-color: ${muted} ${bg}; }`,
    `body { color-scheme: dark !important; background-color: ${bg} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; }`,
    `${shellSelector} { background-color: ${surface1} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; }`,
    `${shellSelector} :where(header, nav, aside, footer, main, section, article, div, form, table, thead, tbody, tr, th, td, ul, ol, dl, blockquote) { background-color: transparent; color: inherit; border-color: ${border} !important; }`,
    `${shellSelector} :where(p, li, span, small, label, legend, caption, figcaption, summary, dt, dd, strong, em, b, i, h1, h2, h3, h4, h5, h6, th, td) { color: ${text} !important; -webkit-text-fill-color: ${text} !important; }`,
    `${shellSelector} :where(a, [role="link"]) { color: ${link} !important; -webkit-text-fill-color: ${link} !important; text-decoration-color: currentColor !important; }`,
    `${shellSelector} a:visited { color: ${visited} !important; -webkit-text-fill-color: ${visited} !important; }`,
    `${shellSelector} :where(a, [role="link"]):hover { color: ${hover} !important; -webkit-text-fill-color: ${hover} !important; }`,
    `${shellSelector} :where(input, textarea, select, button) { background-color: ${surface2} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; color-scheme: dark !important; }`,
    `${shellSelector} input::placeholder, ${shellSelector} textarea::placeholder { color: ${muted} !important; -webkit-text-fill-color: ${muted} !important; opacity: 1; }`,
    `${shellSelector} :where(pre, code, kbd, samp) { background-color: ${surface2} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; }`,
    `${shellSelector} :where(hr) { border-color: ${border} !important; }`,
    `body > ${wikiShellSelector} { background-color: ${surface1} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; }`,
    `${shellSelector} ${wikiShellSelector} { background-color: ${surface1} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; }`,
    `body > ${wikiShellStrongSelector}:not([data-aura-bg-text-gradient="1"]), ${shellSelector} ${wikiShellStrongSelector}:not([data-aura-bg-text-gradient="1"]) { background-image: none !important; }`,
    `body > [data-aura-scope="1"]${wikiShellStrongSelector}:not([data-aura-bg-text-gradient="1"]), body [data-aura-scope="1"] ${wikiShellStrongSelector}:not([data-aura-bg-text-gradient="1"]) { background-image: none !important; }`,
    `${shellSelector} ${wikiShellSelector} :where(p, li, span, small, label, legend, caption, figcaption, summary, dt, dd, strong, em, b, i, h1, h2, h3, h4, h5, h6, th, td) { color: ${text} !important; -webkit-text-fill-color: ${text} !important; }`,
    `${shellSelector} ${wikiShellSelector} :where(a, [role="link"]) { color: ${link} !important; -webkit-text-fill-color: ${link} !important; }`,
    `${partSurfaceSelector} { ${designSystemTokenDeclarations} background-color: ${surface1} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; }`,
    `${partControlSelector} { ${designSystemTokenDeclarations} background-color: ${surface2} !important; color: ${text} !important; -webkit-text-fill-color: ${text} !important; border-color: ${border} !important; accent-color: ${focus} !important; }`,
    `${shellSelector} :where(img, video, canvas, svg, picture, iframe) { color-scheme: normal; }`,
  ].join(' ');
}

function getSmoothTransitionSettings(modeId, modePrefs, flags = {}) {
  const reduceMotionPref = modePrefs?.reduceMotion === true;
  const globalReduceMotionPref = flags?.reducedMotion === true;
  const focusReduceMotionEnabled = flags?.focusReduceMotionV1 === true;
  const smoothThemeTransitionsEnabled = flags?.smoothThemeTransitionsV2 === true;
  const reduceMotionEnabled =
    modeId === MODE_IDS.FOCUS
      ? globalReduceMotionPref || (focusReduceMotionEnabled && reduceMotionPref)
      : globalReduceMotionPref || reduceMotionPref;
  const smoothTransitionsEnabled = smoothThemeTransitionsEnabled && !reduceMotionEnabled;
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

function normalizeIntensity(intensity) {
  if (typeof intensity !== 'number' || Number.isNaN(intensity)) {
    return 1.0;
  }
  return Math.min(Math.max(intensity, 0), 1);
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

function buildScopedTypographyCss(
  modeId,
  normalized,
  variant = 'SCOPED',
  scopeRoot = MODE_ENGINE_SCOPE_SELECTOR,
  options = {},
) {
  const isFocus = modeId === MODE_IDS.FOCUS;
  const requestedDarkMode = options?.darkModeEnabled !== false;
  const darkModeEnabled = isFocus ? requestedDarkMode : requestedDarkMode && isComfortDarkRuntimeEnabled();
  const textScaleEnabled = isFocus || options?.textScaleEnabled !== false;
  const spacingPackEnabled = isFocus || options?.spacingPackEnabled !== false;
  const typoSmoothingEnabled = modeId === MODE_IDS.COMFORT_VISUAL && options?.typoSmoothingEnabled !== false;
  const letterSpacingEnabled = isFocus || typoSmoothingEnabled;
  const { measure, fontSize, lineHeight, headingLineHeight, letterSpacing, paddingInline } =
    getScopedTypographyConfig(modeId, normalized, variant);
  const textFontSize = textScaleEnabled ? ` font-size: ${fontSize} !important;` : '';
  const textLineHeight = spacingPackEnabled ? ` line-height: ${lineHeight} !important;` : '';
  const headingLineHeightRule = spacingPackEnabled ? ` line-height: ${headingLineHeight} !important;` : '';
  const textLetterSpacing = letterSpacingEnabled ? ` letter-spacing: ${letterSpacing} !important;` : '';
  const headingLetterSpacing = letterSpacingEnabled
    ? ` letter-spacing: clamp(0px, calc(0.25px * ${normalized}), 0.6px) !important;`
    : '';
  const typographyRendering = typoSmoothingEnabled
    ? `${scopeRoot} :where(p, li, blockquote, dd, dt) { word-spacing: 0.02em !important; text-rendering: optimizeLegibility; font-kerning: normal; } ${scopeRoot} { -webkit-font-smoothing: antialiased; }`
    : '';
  const reflowRules = modeId === MODE_IDS.COMFORT_VISUAL
    ? [
        `${scopeRoot} :where(p, blockquote, dd, dt) { overflow-wrap: break-word !important; word-break: normal !important; hyphens: manual !important; }`,
        `${scopeRoot} :where(pre, code, kbd, samp) { overflow-wrap: normal !important; word-break: normal !important; hyphens: manual !important; }`,
      ].join(' ')
    : '';

  const headingMeasure = `min(calc(${measure} + 6ch), 88ch, 100%)`;

  const darkMode = darkModeEnabled
    ? `${scopeRoot} { color-scheme: dark !important; background-color: #0f1116 !important; color: #e7ecf3 !important; -webkit-text-fill-color: #e7ecf3 !important; } ${scopeRoot} :where(a, [role="link"]) { color: ${COMFORT_DARK_TOKENS['--aura-link-color']} !important; -webkit-text-fill-color: ${COMFORT_DARK_TOKENS['--aura-link-color']} !important; }`
    : '';

  const baseText = `${scopeRoot} { --aura-intensity: ${normalized}; --aura-measure: ${measure}; padding-inline: ${paddingInline} !important; box-sizing: border-box !important; color: inherit; }`;
  const typographyBlocks = `${scopeRoot} :where(p, blockquote, pre, code) { max-inline-size: min(var(--aura-measure), 100%) !important; width: min(100%, var(--aura-measure)) !important; margin-inline: auto !important;${textFontSize}${textLineHeight}${textLetterSpacing} }`;
  const headingBlocks = `${scopeRoot} :where(h1, h2, h3, h4, h5, h6) { max-inline-size: ${headingMeasure} !important; margin-inline: auto !important;${headingLineHeightRule}${headingLetterSpacing} }`;
  const listBlocks = `${scopeRoot} :where(li) {${textFontSize}${textLineHeight}${headingLetterSpacing} }`;
  const mediaRules = `${scopeRoot} :where(img, video, picture, figure) { max-inline-size: 100% !important; height: auto !important; }`;
  const codeRules = `${scopeRoot} :where(pre, code) { overflow-x: auto !important; }`;
  const linkEnhanceEnabled = modeId === MODE_IDS.COMFORT_VISUAL && options?.linkEnhanceEnabled !== false;
  const linkRules = linkEnhanceEnabled
    ? `${scopeRoot} :where(a, [role="link"]) { text-decoration-line: underline !important; text-decoration-thickness: 0.12em !important; text-underline-offset: 0.18em !important; text-decoration-color: currentColor !important; text-underline-position: under; }`
    : '';

  const focusExtras = isFocus
    ? `${scopeRoot} :where(p, li, blockquote, pre, code, img, video, picture, figure) { animation: none !important; transition: none !important; }`
    : '';

  return [baseText, typographyBlocks, headingBlocks, listBlocks, typographyRendering, reflowRules, codeRules, mediaRules, linkRules, focusExtras, darkMode]
    .filter(Boolean)
    .join(' ');
}

function buildComfortCss(variant, intensity, scopeSelector = MODE_ENGINE_SCOPE_SELECTOR, options = {}) {
  const normalizedIntensity = normalizeIntensity(intensity);
  const textScaleEnabled = options?.textScaleEnabled !== false;
  const spacingPackEnabled = options?.spacingPackEnabled !== false;
  const typoSmoothingEnabled = options?.typoSmoothingEnabled !== false;

  if (variant === STRICT_VARIANT) {
    let css = CSS_COMFORT_VISUAL.replace('--aura-intensity: 1.0', `--aura-intensity: ${normalizedIntensity}`);
    if (!textScaleEnabled) {
      css = css
        .replace('    --aura-font-size: calc(16px * var(--aura-intensity) * 1.1);\n', '')
        .replaceAll('    font-size: var(--aura-font-size);\n', '');
    }
    if (!spacingPackEnabled) {
      css = css
        .replace(
          '--aura-line-height: calc(1.6 * var(--aura-intensity));',
          '--aura-line-height: normal;',
        )
        .replace(
          '--aura-paragraph-spacing: calc(0.9em * var(--aura-intensity));',
          '--aura-paragraph-spacing: 0px;',
        );
    }
    if (!typoSmoothingEnabled) {
      css = css
        .replace('    --aura-letter-spacing: calc(0.35px * var(--aura-intensity));\n', '')
        .replace('    letter-spacing: var(--aura-letter-spacing);\n', '')
        .replace('    letter-spacing: var(--aura-letter-spacing);\n', '');
    }
    return css;
  }

  const scope = scopeSelector || MODE_ENGINE_SCOPE_SELECTOR;
  const darkModeEnabled = options?.darkModeEnabled === true;
  return buildScopedTypographyCss(MODE_IDS.COMFORT_VISUAL, normalizedIntensity, variant, scope, {
    darkModeEnabled,
    textScaleEnabled,
    spacingPackEnabled,
    typoSmoothingEnabled,
  });
}

function buildFocusCss(variant, intensity, scopeSelector = MODE_ENGINE_SCOPE_SELECTOR) {
  const normalizedIntensity = normalizeIntensity(intensity);

  if (variant === STRICT_VARIANT) {
    return '';
  }

  const scope = scopeSelector || MODE_ENGINE_SCOPE_SELECTOR;
  return buildScopedTypographyCss(MODE_IDS.FOCUS, normalizedIntensity, variant, scope, { darkModeEnabled: true });
}

function buildSmartScopePatchCSS(modeId, intensity, variant, options = {}) {
  const normalized = normalizeIntensity(intensity);
  const darkModeEnabled =
    modeId === MODE_IDS.COMFORT_VISUAL
      ? options?.darkModeEnabled === true
      : true;
  const textScaleEnabled = modeId === MODE_IDS.COMFORT_VISUAL ? options?.textScaleEnabled !== false : true;
  const spacingPackEnabled = modeId === MODE_IDS.COMFORT_VISUAL ? options?.spacingPackEnabled !== false : true;
  const linkEnhanceEnabled = modeId === MODE_IDS.COMFORT_VISUAL ? options?.linkEnhanceEnabled !== false : false;
  const typoSmoothingEnabled = modeId === MODE_IDS.COMFORT_VISUAL ? options?.typoSmoothingEnabled !== false : true;
  return buildScopedTypographyCss(modeId, normalized, variant, '.aura-scope', {
    darkModeEnabled,
    textScaleEnabled,
    spacingPackEnabled,
    linkEnhanceEnabled,
    typoSmoothingEnabled,
  });
}

function buildCss(modeId, variant, scopeSelector, intensity) {
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    return buildComfortCss(variant, intensity, scopeSelector);
  }

  return buildFocusCss(variant, intensity, scopeSelector);
}

export {
  STRICT_VARIANT,
  COMFORT_DARK_TOKENS,
  COMFORT_DARK_GUARD_TOKENS,
  COMFORT_LIGHT_GUARD_TOKENS,
  COMFORT_DARK_RETRY_TOKENS,
  COMFORT_LIGHT_RETRY_TOKENS,
  COMFORT_DARK_RUNTIME_ENABLED,
  isComfortDarkRuntimeEnabled,
  isComfortDarkModeRequested,
  isComfortDarkModeEnabled,
  buildComfortEmergencyReflowGuardTokenOverrides,
  buildComfortVisualTokenOverrides,
  buildComfortPreludeCss,
  getSmoothTransitionSettings,
  buildScopedTransitionsCssV2,
  normalizeIntensity,
  getScopedTypographyConfig,
  buildScopedTypographyCss,
  buildComfortCss,
  buildFocusCss,
  buildSmartScopePatchCSS,
  buildCss,
  buildCss as buildModeCss,
};
