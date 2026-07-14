import { MODE_ENGINE_SCOPE_SELECTOR } from '../shared/mode-engine-scoped-v2.js';
import { contrastRatio, parseCssColor, relativeLuminance } from '../shared/contrast-utils.js';

const DARK_THEME_EXECUTOR = 'DARK_THEME_TRANSFORM';
const DARK_THEME_OWNER = 'aura-dark-comfort-theme-v1';

const DARK_THEME_V1_BUDGET = Object.freeze({
  precheck: Object.freeze({
    maxNodes: 600,
    maxMs: 12,
    textSamples: 30,
    linkSamples: 12,
    controlSamples: 12,
    codeSamples: 8,
    svgIconSamples: 10,
  }),
  initialSurfaceScan: Object.freeze({
    maxNodes: 2000,
    maxMs: 28,
    maxSurfaces: 40,
    minSurfaceAreaPx: 16000,
    lightSurfaceLuminanceMin: 0.8,
  }),
  initialExtraPass: Object.freeze({
    maxPasses: 2,
    delaysMs: Object.freeze([80, 240]),
    maxNodes: 1200,
    maxMs: 18,
  }),
  mutationRescan: Object.freeze({
    debounceMs: 400,
    maxNodes: 600,
    maxMs: 12,
    maxPerMinute: 12,
  }),
  inlineOverrides: Object.freeze({
    maxNodes: 600,
    maxMs: 12,
    maxCandidates: 40,
  }),
  shadowInlineOverrides: Object.freeze({
    maxNodes: 240,
    maxMs: 12,
    maxOverrides: 24,
    minArea: 400,
  }),
  mutationMinIntervalMs: 1000,
  maxShadowRoots: 8,
  maxNestedDepth: 12,
});

const DARK_COMFORT_THEME_PALETTE_V1 = Object.freeze({
  background: '#0b1020',
  surface: '#101a2f',
  surfaceRaised: '#0d1526',
  text: '#e6e6e6',
  mutedText: '#a8b0bf',
  border: 'rgba(255,255,255,0.12)',
  link: '#8ab4ff',
  linkVisited: '#c58af9',
  linkHover: '#b1ccff',
  focusRing: '#9ab7ff',
  controls: '#0d1526',
  code: '#111827',
});
const DARK_COMFORT_ALREADY_DARK_PALETTE_V1 = Object.freeze({
  background: '#10141f',
  surface: '#151b2a',
  surfaceRaised: '#1b2333',
  text: '#eef2f8',
  mutedText: '#b7c0cf',
  border: 'rgba(255,255,255,0.16)',
  link: '#9ec1ff',
  linkVisited: '#d7a8ff',
  linkHover: '#c3d7ff',
  focusRing: '#a8c7ff',
  controls: '#1b2333',
  code: '#151b2a',
});
const DARK_COMFORT_THEME_MIN_TEXT_CONTRAST = 4.5;
const DARK_COMFORT_THEME_MIN_LARGE_TEXT_CONTRAST = 3;
const DARK_COMFORT_THEME_MIN_LINK_CONTRAST = 4.5;
const DARK_COMFORT_THEME_MIN_LINK_DISTINCTION = 1.25;
const DEFAULT_VISUAL_SNAPSHOT = Object.freeze({
  backgroundColor: '#ffffff',
  textColor: '#111827',
  linkColor: '#1d4ed8',
  prefersColorScheme: 'light',
});

function normalizeScopeSelector(scopeSelector) {
  return typeof scopeSelector === 'string' && scopeSelector.trim()
    ? scopeSelector.trim()
    : MODE_ENGINE_SCOPE_SELECTOR;
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function colorToHex(color) {
  if (!color) {
    return null;
  }
  return `#${[color.r, color.g, color.b].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mixColors(colorA, colorB, amount = 0.5) {
  if (!colorA || !colorB) {
    return colorA || colorB || null;
  }
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: clampChannel(colorA.r * (1 - t) + colorB.r * t),
    g: clampChannel(colorA.g * (1 - t) + colorB.g * t),
    b: clampChannel(colorA.b * (1 - t) + colorB.b * t),
    a: 1,
  };
}

function normalizeColor(value, fallback) {
  return parseCssColor(value) || parseCssColor(fallback);
}

function getColorLuminance(value, fallback) {
  const color = normalizeColor(value, fallback);
  const luminance = relativeLuminance(color);
  return typeof luminance === 'number' ? luminance : null;
}

function isAlreadyDarkVisualSnapshot(snapshot = {}) {
  const backgroundLuminance = getColorLuminance(snapshot.backgroundColor, DEFAULT_VISUAL_SNAPSHOT.backgroundColor);
  const surfaceLuminance = getColorLuminance(snapshot.surfaceColor, snapshot.backgroundColor || DEFAULT_VISUAL_SNAPSHOT.backgroundColor);
  const visualLuminance = typeof surfaceLuminance === 'number'
    ? Math.max(backgroundLuminance ?? surfaceLuminance, surfaceLuminance)
    : backgroundLuminance;

  return typeof visualLuminance === 'number' && visualLuminance < 0.32;
}

function ensureContrast(foreground, background, fallback, minimum = DARK_COMFORT_THEME_MIN_TEXT_CONTRAST) {
  const bg = normalizeColor(background, DARK_COMFORT_THEME_PALETTE_V1.background);
  let fg = normalizeColor(foreground, fallback);
  const safeFallback = normalizeColor(fallback, DARK_COMFORT_THEME_PALETTE_V1.text);

  if (!fg || !bg) {
    return colorToHex(safeFallback);
  }

  let ratio = contrastRatio(fg, bg);
  if (typeof ratio === 'number' && ratio >= minimum) {
    return colorToHex(fg);
  }

  for (let step = 0.1; step <= 1; step += 0.1) {
    fg = mixColors(fg, safeFallback, step);
    ratio = contrastRatio(fg, bg);
    if (typeof ratio === 'number' && ratio >= minimum) {
      return colorToHex(fg);
    }
  }

  return colorToHex(safeFallback);
}

function makeBorderColor(alreadyDark) {
  return alreadyDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.12)';
}

function buildDarkComfortThemePaletteV1(snapshot = {}) {
  const normalizedSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const alreadyDark = isAlreadyDarkVisualSnapshot(normalizedSnapshot);
  const base = alreadyDark ? DARK_COMFORT_ALREADY_DARK_PALETTE_V1 : DARK_COMFORT_THEME_PALETTE_V1;
  const background = base.background;
  const surface = alreadyDark ? base.surface : '#101827';
  const surfaceRaised = alreadyDark ? base.surfaceRaised : '#0f1726';
  const text = alreadyDark
    ? ensureContrast(normalizedSnapshot.textColor, background, base.text)
    : base.text;
  const mutedText = alreadyDark
    ? ensureContrast(
      normalizedSnapshot.mutedTextColor,
      background,
      base.mutedText,
      DARK_COMFORT_THEME_MIN_LARGE_TEXT_CONTRAST,
    )
    : base.mutedText;
  const link = alreadyDark
    ? ensureContrast(normalizedSnapshot.linkColor, background, base.link, DARK_COMFORT_THEME_MIN_LINK_CONTRAST)
    : base.link;
  const linkContrastWithText = contrastRatio(parseCssColor(link), parseCssColor(text));
  const safeLink = typeof linkContrastWithText === 'number' && linkContrastWithText >= DARK_COMFORT_THEME_MIN_LINK_DISTINCTION
    ? link
    : base.link;

  return Object.freeze({
    background,
    surface,
    surfaceRaised,
    text,
    mutedText,
    border: makeBorderColor(alreadyDark),
    link: safeLink,
    linkVisited: alreadyDark ? base.linkVisited : DARK_COMFORT_THEME_PALETTE_V1.linkVisited,
    linkHover: alreadyDark ? base.linkHover : DARK_COMFORT_THEME_PALETTE_V1.linkHover,
    focusRing: alreadyDark ? base.focusRing : DARK_COMFORT_THEME_PALETTE_V1.focusRing,
    controls: alreadyDark ? base.controls : surfaceRaised,
    code: alreadyDark ? base.code : '#111827',
    alreadyDark,
    prefersColorScheme: normalizedSnapshot.prefersColorScheme === 'dark' ? 'dark' : 'light',
  });
}

function getDarkComfortThemePaletteDiagnosticsV1(palette = DARK_COMFORT_THEME_PALETTE_V1) {
  const bg = parseCssColor(palette.background);
  const text = parseCssColor(palette.text);
  const link = parseCssColor(palette.link);
  return {
    version: 1,
    alreadyDark: palette.alreadyDark === true,
    textContrast: contrastRatio(text, bg),
    linkContrast: contrastRatio(link, bg),
    linkDistinctFromText: contrastRatio(link, text),
    prefersColorScheme: palette.prefersColorScheme === 'dark' ? 'dark' : 'light',
  };
}

function buildDarkComfortThemeTokenMap(palette = DARK_COMFORT_THEME_PALETTE_V1) {
  return {
    '--aura-color-scheme': 'dark',
    '--aura-bg-color': palette.background,
    '--aura-text-color': palette.text,
    '--aura-muted-text-color': palette.mutedText,
    '--aura-border-color': palette.border,
    '--aura-surface-1': palette.surface,
    '--aura-surface-2': palette.surfaceRaised,
    '--aura-link-color': palette.link,
    '--aura-link-visited-color': palette.linkVisited,
    '--aura-link-hover-color': palette.linkHover,
    '--aura-focus-color': palette.focusRing,
  };
}

function buildDarkComfortThemeScopedCss({ scopeSelector, palette = DARK_COMFORT_THEME_PALETTE_V1 } = {}) {
  const scope = normalizeScopeSelector(scopeSelector);
  return [
    `${scope} { color-scheme: dark; background-color: ${palette.background} !important; color: ${palette.text} !important; -webkit-text-fill-color: ${palette.text} !important; }`,
    `${scope} :where(a, [role="link"]) { color: ${palette.link} !important; -webkit-text-fill-color: ${palette.link} !important; }`,
    `${scope} :where(input, textarea, select, button) { background-color: ${palette.controls} !important; color: ${palette.text} !important; -webkit-text-fill-color: ${palette.text} !important; border-color: ${palette.border} !important; }`,
    `${scope} :where(pre, code) { background-color: ${palette.code} !important; color: ${palette.text} !important; -webkit-text-fill-color: ${palette.text} !important; }`,
  ].join(' ');
}

export {
  DARK_THEME_EXECUTOR,
  DARK_THEME_OWNER,
  DARK_THEME_V1_BUDGET,
  DARK_COMFORT_THEME_PALETTE_V1,
  DARK_COMFORT_ALREADY_DARK_PALETTE_V1,
  buildDarkComfortThemePaletteV1,
  getDarkComfortThemePaletteDiagnosticsV1,
  isAlreadyDarkVisualSnapshot,
  buildDarkComfortThemeTokenMap,
  buildDarkComfortThemeScopedCss,
};
