(() => {

const DARK_THEME_EXECUTOR = 'DARK_THEME_TRANSFORM';
const DARK_THEME_OWNER = 'aura-dark-comfort-theme-v1';
const DARK_SURFACE_DEBOUNCE_MS = 350;
const DARK_SURFACE_MAX_RESCANS_PER_MIN = 12;
const DARK_SURFACE_RESCAN_WINDOW_MS = 60000;
const DARK_SURFACE_SCAN_BUDGET = { maxNodes: 600, maxMs: 12, maxSurfaces: 40, maxForceText: 80 };
const DARK_SURFACE_INITIAL_SCAN_BUDGET = { maxNodes: 2000, maxMs: 28, maxSurfaces: 40, maxForceText: 80 };
const DARK_SURFACE_INITIAL_EXTRA_BUDGET = { maxNodes: 1200, maxMs: 18, maxSurfaces: 40, maxForceText: 80 };
const DARK_SURFACE_CLEANUP_BUDGET = { maxNodes: 2000, maxMs: 28, maxSurfaces: 40, maxForceText: 80 };
const DARK_SURFACE_INITIAL_EXTRA_PASSES = 2;
const DARK_SURFACE_INITIAL_PASS_DELAYS_MS = [80, 240];
const DARK_INLINE_DEBOUNCE_MS = 400;
const DARK_INLINE_SCAN_BUDGET = { maxNodes: 600, maxMs: 12, maxCandidates: 40 };
const DARK_DOCUMENT_GRADIENT_SCAN_BUDGET = { maxNodes: 800, maxMs: 12, maxOverrides: 48 };
const DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET = { maxNodes: 800, maxMs: 12, maxOverrides: 48 };
const DARK_AUTHORED_BACKGROUND_RULE_BUDGET = { maxStyleSheets: 12, maxRules: 600 };
const DARK_LOCAL_TOKEN_SCAN_BUDGET = { maxNodes: 260, maxMs: 24, maxOverrides: 32 };
const DARK_ICON_SCAN_BUDGET = { maxNodes: 600, maxMs: 10, maxIcons: 32, maxPaintSamples: 8, maxPaintNodes: 18 };
const DARK_ADDED_ROOT_DEBOUNCE_MS = 90;
const DARK_ADDED_ROOT_MAX_ROOTS = 16;
const DARK_DOCUMENT_OBSERVER_NODE_BUDGET = 160;
const DARK_ADDED_ROOT_SCAN_BUDGET = {
  maxNodes: 180,
  maxMs: 8,
  maxCandidates: 24,
  maxIcons: 12,
  maxForceText: 32,
  maxMediaBackgrounds: 24,
  maxGradientBackgrounds: 48,
};
const DARK_ADDED_SURFACE_SCAN_BUDGET = {
  maxNodes: DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes,
  maxMs: DARK_ADDED_ROOT_SCAN_BUDGET.maxMs,
  maxSurfaces: 24,
  maxForceText: DARK_ADDED_ROOT_SCAN_BUDGET.maxForceText,
};
const DARK_SHADOW_SCAN_BUDGET = { maxNodes: 600, maxMs: 12, maxShadowRoots: 8, maxNestedDepth: 12 };
const DARK_SHADOW_INLINE_SCAN_BUDGET = { maxNodes: 240, maxMs: 12, maxOverrides: 24, minArea: 400 };
const DARK_SHADOW_STYLE_ATTR = 'data-aura-dark-comfort-shadow-style';
const DARK_SHADOW_STYLE_VALUE = DARK_THEME_OWNER;
const DARK_BG_MEDIA_ATTR = 'data-aura-bg-media';
const DARK_BG_GRADIENT_ATTR = 'data-aura-bg-gradient';
const DARK_BG_TEXT_GRADIENT_ATTR = 'data-aura-bg-text-gradient';
const DARK_ICON_LIGHT_PAINT = 'var(--aura-text-color, #e6e6e6)';
const DARK_FRAME_READY_ACTION = 'DARK_COMFORT_FRAME_READY';
const DARK_FRAME_READY_DEBOUNCE_MS = 300;
const DARK_FRAME_READY_IFRAME_SCAN_CAP = 24;
const DARK_POSTCHECK_BUDGET = {
  maxNodes: 160,
  maxMs: 16,
  textSamples: 30,
  linkSamples: 12,
  controlSamples: 12,
  codeSamples: 8,
  mediaSamples: 12,
  svgSamples: 10,
};
const DARK_POSTCHECK_THRESHOLDS = {
  textContrast: 4.5,
  largeTextContrast: 3,
  linkContrast: 4.5,
  linkDistinct: 1.25,
  nonTextContrast: 3,
  controlTextContrast: 4.5,
  codeContrast: 4.5,
};
const DARK_COMFORT_THEME_TOKEN_KEYS = Object.freeze([
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
const DARK_INLINE_RESCAN_MIN_INTERVAL_MS = 1000;
const DARK_INLINE_RESCAN_DELAYS_MS = [250, 800];
const DARK_SHADOW_RESCAN_DELAYS_MS = [600, 1600, 3600];
const DARK_MUTATION_SELF_MUTE_MS = 80;
const DARK_MUTATION_ATTRIBUTE_FILTER = Object.freeze([
  'class',
  'style',
  'hidden',
  'open',
  'aria-hidden',
  'data-theme',
  'data-color-mode',
  'data-bs-theme',
  'data-mui-color-scheme',
]);
const DARK_DOCUMENT_LOCAL_TOKEN_SELECTOR =
  ':where([data-theme], [data-color-mode], [data-bs-theme], [data-mui-color-scheme], [data-surface], [data-card], [data-panel], [data-dialog], [data-popover], [class*="card" i], [class*="panel" i], [class*="surface" i], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="menu" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tabpanel"])';
const DARK_DOCUMENT_ADDED_ROOT_TAGS = new Set(['ASIDE', 'DIALOG', 'FOOTER', 'HEADER', 'NAV']);
const DARK_DOCUMENT_LOCAL_TOKEN_CONSUMER_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'LABEL',
  'OPTION',
  'SELECT',
  'SUMMARY',
  'TEXTAREA',
]);
const DARK_DOCUMENT_ADDED_ROOT_ROLES = new Set([
  'alertdialog',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'listbox',
  'menu',
  'menubar',
  'navigation',
  'search',
  'tablist',
  'toolbar',
  'tooltip',
  'tree',
]);
const DARK_DOCUMENT_ADDED_ROOT_ATTRS = [
  'popover',
  'aria-modal',
  'data-theme',
  'data-color-mode',
  'data-bs-theme',
  'data-mui-color-scheme',
  'data-surface',
  'data-card',
  'data-panel',
  'data-dialog',
  'data-popover',
  'data-radix-popper-content-wrapper',
  'data-headlessui-portal',
  'data-floating-ui-portal',
];
const DARK_DOCUMENT_ADDED_ROOT_IDENTITY_TOKENS = [
  'appbar',
  'app-bar',
  'card',
  'commandbar',
  'command-bar',
  'dialog',
  'drawer',
  'dropdown',
  'layout-header',
  'masthead',
  'modal',
  'navbar',
  'nav-bar',
  'overlay',
  'panel',
  'popover',
  'portal',
  'sheet',
  'side-nav',
  'sidebar',
  'sidepanel',
  'side-panel',
  'surface',
  'toast',
  'toolbar',
  'tooltip',
  'topbar',
  'top-bar',
];
const DARK_DOCUMENT_LOCAL_TOKEN_MAP = Object.freeze([
  ['--background', 'var(--aura-bg-color, #0b1020)'],
  ['--foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--card', 'var(--aura-surface-1, #101a2f)'],
  ['--card-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--popover', 'var(--aura-surface-1, #101a2f)'],
  ['--popover-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--primary', 'var(--aura-link-color, #8ab4ff)'],
  ['--primary-foreground', 'var(--aura-bg-color, #0b1020)'],
  ['--secondary', 'var(--aura-surface-2, #0d1526)'],
  ['--secondary-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--muted', 'var(--aura-surface-2, #0d1526)'],
  ['--muted-foreground', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--accent', 'var(--aura-surface-2, #0d1526)'],
  ['--accent-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--destructive', '#7f1d1d'],
  ['--destructive-foreground', '#fecaca'],
  ['--border', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--input', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--ring', 'var(--aura-focus-color, #9ab7ff)'],
  ['--sidebar', 'var(--aura-surface-1, #101a2f)'],
  ['--sidebar-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--sidebar-primary', 'var(--aura-link-color, #8ab4ff)'],
  ['--sidebar-primary-foreground', 'var(--aura-bg-color, #0b1020)'],
  ['--sidebar-accent', 'var(--aura-surface-2, #0d1526)'],
  ['--sidebar-accent-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--sidebar-border', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--sidebar-ring', 'var(--aura-focus-color, #9ab7ff)'],
  ['--surface', 'var(--aura-surface-1, #101a2f)'],
  ['--surface-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--panel', 'var(--aura-surface-1, #101a2f)'],
  ['--panel-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--color-background', 'var(--aura-bg-color, #0b1020)'],
  ['--color-foreground', 'var(--aura-text-color, #e6e6e6)'],
  ['--color-surface', 'var(--aura-surface-1, #101a2f)'],
  ['--color-surface-2', 'var(--aura-surface-2, #0d1526)'],
  ['--color-text', 'var(--aura-text-color, #e6e6e6)'],
  ['--color-muted', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--color-border', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--color-link', 'var(--aura-link-color, #8ab4ff)'],
  ['--bs-body-bg', 'var(--aura-bg-color, #0b1020)'],
  ['--bs-body-color', 'var(--aura-text-color, #e6e6e6)'],
  ['--bs-border-color', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--bs-link-color', 'var(--aura-link-color, #8ab4ff)'],
  ['--bs-link-hover-color', 'var(--aura-link-hover-color, #b1ccff)'],
  ['--bs-secondary-bg', 'var(--aura-surface-2, #0d1526)'],
  ['--bs-tertiary-bg', 'var(--aura-surface-1, #101a2f)'],
  ['--bs-emphasis-color', 'var(--aura-text-color, #e6e6e6)'],
  ['--mui-palette-background-default', 'var(--aura-bg-color, #0b1020)'],
  ['--mui-palette-background-paper', 'var(--aura-surface-1, #101a2f)'],
  ['--mui-palette-text-primary', 'var(--aura-text-color, #e6e6e6)'],
  ['--mui-palette-text-secondary', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--mui-palette-divider', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--mui-palette-primary-main', 'var(--aura-link-color, #8ab4ff)'],
  ['--mui-palette-action-hover', 'var(--aura-surface-2, #0d1526)'],
  ['--ant-color-bg-container', 'var(--aura-surface-1, #101a2f)'],
  ['--ant-color-bg-elevated', 'var(--aura-surface-1, #101a2f)'],
  ['--ant-color-bg-layout', 'var(--aura-bg-color, #0b1020)'],
  ['--ant-color-text', 'var(--aura-text-color, #e6e6e6)'],
  ['--ant-color-text-secondary', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--ant-color-border', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--ant-color-primary', 'var(--aura-link-color, #8ab4ff)'],
  ['--ant-color-link', 'var(--aura-link-color, #8ab4ff)'],
  ['--chakra-colors-chakra-body-bg', 'var(--aura-bg-color, #0b1020)'],
  ['--chakra-colors-chakra-body-text', 'var(--aura-text-color, #e6e6e6)'],
  ['--chakra-colors-bg', 'var(--aura-bg-color, #0b1020)'],
  ['--chakra-colors-bg-subtle', 'var(--aura-surface-1, #101a2f)'],
  ['--chakra-colors-bg-muted', 'var(--aura-surface-2, #0d1526)'],
  ['--chakra-colors-fg', 'var(--aura-text-color, #e6e6e6)'],
  ['--chakra-colors-fg-muted', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--chakra-colors-border', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--md-sys-color-background', 'var(--aura-bg-color, #0b1020)'],
  ['--md-sys-color-on-background', 'var(--aura-text-color, #e6e6e6)'],
  ['--md-sys-color-surface', 'var(--aura-surface-1, #101a2f)'],
  ['--md-sys-color-surface-container', 'var(--aura-surface-1, #101a2f)'],
  ['--md-sys-color-surface-container-high', 'var(--aura-surface-2, #0d1526)'],
  ['--md-sys-color-on-surface', 'var(--aura-text-color, #e6e6e6)'],
  ['--md-sys-color-outline', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--md-sys-color-primary', 'var(--aura-link-color, #8ab4ff)'],
  ['--md-sys-color-on-primary', 'var(--aura-bg-color, #0b1020)'],
  ['--bgColor-default', 'var(--aura-bg-color, #0b1020)'],
  ['--bgColor-muted', 'var(--aura-surface-1, #101a2f)'],
  ['--fgColor-default', 'var(--aura-text-color, #e6e6e6)'],
  ['--fgColor-muted', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--borderColor-default', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--color-canvas-default', 'var(--aura-bg-color, #0b1020)'],
  ['--color-canvas-subtle', 'var(--aura-surface-1, #101a2f)'],
  ['--color-fg-default', 'var(--aura-text-color, #e6e6e6)'],
  ['--color-fg-muted', 'var(--aura-muted-text-color, #a8b0bf)'],
  ['--color-border-default', 'var(--aura-border-color, rgba(255,255,255,0.12))'],
  ['--color-accent-fg', 'var(--aura-link-color, #8ab4ff)'],
]);
const DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_MAP = Object.freeze([
  ['--background', '224 60% 8%'],
  ['--foreground', '0 0% 90%'],
  ['--card', '218 49% 12%'],
  ['--card-foreground', '0 0% 90%'],
  ['--popover', '218 49% 12%'],
  ['--popover-foreground', '0 0% 90%'],
  ['--primary', '216 100% 77%'],
  ['--primary-foreground', '224 60% 8%'],
  ['--secondary', '219 49% 10%'],
  ['--secondary-foreground', '0 0% 90%'],
  ['--muted', '219 49% 10%'],
  ['--muted-foreground', '220 14% 70%'],
  ['--accent', '219 49% 10%'],
  ['--accent-foreground', '0 0% 90%'],
  ['--destructive', '0 63% 31%'],
  ['--destructive-foreground', '0 96% 89%'],
  ['--border', '220 13% 28%'],
  ['--input', '220 13% 28%'],
  ['--ring', '224 100% 80%'],
  ['--sidebar', '218 49% 12%'],
  ['--sidebar-foreground', '0 0% 90%'],
  ['--sidebar-primary', '216 100% 77%'],
  ['--sidebar-primary-foreground', '224 60% 8%'],
  ['--sidebar-accent', '219 49% 10%'],
  ['--sidebar-accent-foreground', '0 0% 90%'],
  ['--sidebar-border', '220 13% 28%'],
  ['--sidebar-ring', '224 100% 80%'],
  ['--surface', '218 49% 12%'],
  ['--surface-foreground', '0 0% 90%'],
  ['--panel', '218 49% 12%'],
  ['--panel-foreground', '0 0% 90%'],
  ['--color-background', '224 60% 8%'],
  ['--color-foreground', '0 0% 90%'],
  ['--color-surface', '218 49% 12%'],
  ['--color-surface-2', '219 49% 10%'],
  ['--color-text', '0 0% 90%'],
  ['--color-muted', '220 14% 70%'],
  ['--color-border', '220 13% 28%'],
  ['--color-link', '216 100% 77%'],
]);
const DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_MAP = Object.freeze([
  ['--background', '11 16 32'],
  ['--foreground', '230 230 230'],
  ['--card', '16 26 47'],
  ['--card-foreground', '230 230 230'],
  ['--popover', '16 26 47'],
  ['--popover-foreground', '230 230 230'],
  ['--primary', '138 180 255'],
  ['--primary-foreground', '11 16 32'],
  ['--secondary', '13 21 38'],
  ['--secondary-foreground', '230 230 230'],
  ['--muted', '13 21 38'],
  ['--muted-foreground', '168 176 191'],
  ['--accent', '13 21 38'],
  ['--accent-foreground', '230 230 230'],
  ['--destructive', '127 29 29'],
  ['--destructive-foreground', '254 202 202'],
  ['--border', '71 85 105'],
  ['--input', '71 85 105'],
  ['--ring', '154 183 255'],
  ['--sidebar', '16 26 47'],
  ['--sidebar-foreground', '230 230 230'],
  ['--sidebar-primary', '138 180 255'],
  ['--sidebar-primary-foreground', '11 16 32'],
  ['--sidebar-accent', '13 21 38'],
  ['--sidebar-accent-foreground', '230 230 230'],
  ['--sidebar-border', '71 85 105'],
  ['--sidebar-ring', '154 183 255'],
  ['--surface', '16 26 47'],
  ['--surface-foreground', '230 230 230'],
  ['--panel', '16 26 47'],
  ['--panel-foreground', '230 230 230'],
  ['--color-background', '11 16 32'],
  ['--color-foreground', '230 230 230'],
  ['--color-surface', '16 26 47'],
  ['--color-surface-2', '13 21 38'],
  ['--color-text', '230 230 230'],
  ['--color-muted', '168 176 191'],
  ['--color-border', '71 85 105'],
  ['--color-link', '138 180 255'],
]);
const DARK_DOCUMENT_LOCAL_TOKEN_EXPLICIT_NAMES = new Set(
  DARK_DOCUMENT_LOCAL_TOKEN_MAP.map(([property]) => String(property || '').trim().toLowerCase()),
);
const DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_LOOKUP = new Map(
  DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_MAP.map(([property, value]) => [
    String(property || '').trim().toLowerCase(),
    value,
  ]),
);
const DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_LOOKUP = new Map(
  DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_MAP.map(([property, value]) => [
    String(property || '').trim().toLowerCase(),
    value,
  ]),
);
const DARK_LOCAL_TOKEN_SURFACE_REPLACEMENTS = Object.freeze({
  background: 'var(--aura-bg-color, #0b1020)',
  surface: 'var(--aura-surface-1, #101a2f)',
  surface2: 'var(--aura-surface-2, #0d1526)',
  text: 'var(--aura-text-color, #e6e6e6)',
  mutedText: 'var(--aura-muted-text-color, #a8b0bf)',
  border: 'var(--aura-border-color, rgba(255,255,255,0.12))',
  link: 'var(--aura-link-color, #8ab4ff)',
  focus: 'var(--aura-focus-color, #9ab7ff)',
});
const DARK_LOCAL_TOKEN_HSL_CHANNEL_REPLACEMENTS = Object.freeze({
  background: '224 60% 8%',
  surface: '218 49% 12%',
  surface2: '219 49% 10%',
  text: '0 0% 90%',
  mutedText: '220 14% 70%',
  border: '220 13% 28%',
  link: '216 100% 77%',
  focus: '224 100% 80%',
});
const DARK_LOCAL_TOKEN_RGB_CHANNEL_REPLACEMENTS = Object.freeze({
  background: '11 16 32',
  surface: '16 26 47',
  surface2: '13 21 38',
  text: '230 230 230',
  mutedText: '168 176 191',
  border: '71 85 105',
  link: '138 180 255',
  focus: '154 183 255',
});
const DARK_NEUTRAL_PALETTE_FAMILIES = new Set([
  'white',
  'black',
  'gray',
  'grey',
  'slate',
  'zinc',
  'neutral',
  'stone',
]);
const DARK_NAMED_CSS_COLORS = Object.freeze({
  aliceblue: [240, 248, 255],
  antiquewhite: [250, 235, 215],
  azure: [240, 255, 255],
  beige: [245, 245, 220],
  black: [0, 0, 0],
  cornsilk: [255, 248, 220],
  floralwhite: [255, 250, 240],
  gainsboro: [220, 220, 220],
  ghostwhite: [248, 248, 255],
  honeydew: [240, 255, 240],
  ivory: [255, 255, 240],
  lavender: [230, 230, 250],
  linen: [250, 240, 230],
  mintcream: [245, 255, 250],
  oldlace: [253, 245, 230],
  seashell: [255, 245, 238],
  silver: [192, 192, 192],
  snow: [255, 250, 250],
  white: [255, 255, 255],
  whitesmoke: [245, 245, 245],
});

let darkObserver = null;
let darkRescanTimer = null;
let darkRescanWindowStart = 0;
let darkRescanCount = 0;
let darkObservedScopeRoot = null;
let darkInlineObserver = null;
let darkDocumentObserver = null;
let darkDocumentObservedRoot = null;
let darkInlineDebounceTimer = null;
let darkInlineThrottleTimer = null;
let darkMutedMutationTimer = null;
let darkInlineSliceTimers = [];
let darkAddedRootTimer = null;
let darkPendingAddedRoots = [];
let darkInlineObservedScopeRoot = null;
let darkInlineNextAllowedAt = 0;
let darkInitialApplyScopeRoot = null;
let darkInitialApplyPassCount = 0;
let darkInitialApplyTimers = [];
let darkShadowRescanTimers = [];
let darkShadowStyleNodes = new Set();
let darkMediaBackgroundElements = new Set();
let darkGradientBackgroundElements = new Set();
let darkTextGradientBackgroundElements = new Set();
let darkAttributeOverrideState = {
  touched: new Set(),
  prev: new WeakMap(),
  applied: new WeakMap(),
};
let darkShadowInlineOverrideState = {
  touched: new Set(),
  prev: new WeakMap(),
  applied: new WeakMap(),
};
let darkDocumentInlineOverrideState = {
  touched: new Set(),
  prev: new WeakMap(),
  applied: new WeakMap(),
};
let darkIconOverrideState = {
  touched: new Set(),
  prev: new WeakMap(),
  applied: new WeakMap(),
};
let darkFrameReadyObserver = null;
let darkFrameReadyTimer = null;
let darkFrameReadyIframes = new WeakSet();
let activeCleanupManifest = null;
let activeDarkRuntimeReceiptId = null;
let darkPreparedTokenRoots = new WeakSet();
let darkMutationMuteUntil = 0;
let lastDarkApplySummary = null;

function defaultLogger() {}

function getLogger(options = {}) {
  return typeof options.logger === 'function' ? options.logger : defaultLogger;
}

function canNotifyDarkFrameReady() {
  return Boolean(globalThis.chrome?.runtime?.sendMessage);
}

function notifyDarkFrameReady(source = 'iframe') {
  if (!canNotifyDarkFrameReady()) {
    return;
  }

  if (darkFrameReadyTimer) {
    clearTimeout(darkFrameReadyTimer);
  }

  darkFrameReadyTimer = setTimeout(() => {
    darkFrameReadyTimer = null;
    try {
      const response = chrome.runtime.sendMessage({
        action: DARK_FRAME_READY_ACTION,
        source,
        observedAt: Date.now(),
      });
      if (response && typeof response.catch === 'function') {
        response.catch(() => {});
      }
    } catch (_) {
      // Best-effort lifecycle signal; dark mode remains reversible without it.
    }
  }, DARK_FRAME_READY_DEBOUNCE_MS);
}

function registerDarkFrameReadyIframe(iframe) {
  if (!iframe || darkFrameReadyIframes.has(iframe)) {
    return;
  }
  darkFrameReadyIframes.add(iframe);
  try {
    iframe.addEventListener('load', () => notifyDarkFrameReady('iframe-load'), { passive: true });
  } catch (_) {
    // Ignore inert or unusual iframe-like objects.
  }
}

function scanDarkFrameReadyIframes(root) {
  if (!root?.querySelectorAll) {
    return;
  }
  try {
    const iframes = root.querySelectorAll('iframe');
    const count = Math.min(iframes.length, DARK_FRAME_READY_IFRAME_SCAN_CAP);
    for (let index = 0; index < count; index += 1) {
      registerDarkFrameReadyIframe(iframes[index]);
    }
  } catch (_) {
    // Selector support is not guaranteed in tests or unusual documents.
  }
}

function startDarkFrameReadyObserver() {
  if (darkFrameReadyObserver || !globalThis.document?.documentElement || !globalThis.MutationObserver) {
    return;
  }
  if (globalThis.top && globalThis.self && globalThis.top !== globalThis.self) {
    notifyDarkFrameReady('frame-runtime-ready');
    return;
  }

  scanDarkFrameReadyIframes(globalThis.document);
  try {
    darkFrameReadyObserver = new MutationObserver((mutations) => {
      let iframeSeen = false;
      for (const mutation of mutations || []) {
        for (const node of mutation.addedNodes || []) {
          if (!node || node.nodeType !== 1) {
            continue;
          }
          if (`${node.tagName || ''}`.toUpperCase() === 'IFRAME') {
            registerDarkFrameReadyIframe(node);
            iframeSeen = true;
            continue;
          }
          if (typeof node.querySelectorAll === 'function') {
            scanDarkFrameReadyIframes(node);
          }
        }
      }
      if (iframeSeen) {
        notifyDarkFrameReady('iframe-added');
      }
    });
    darkFrameReadyObserver.observe(globalThis.document.documentElement, { childList: true, subtree: true });
  } catch (_) {
    darkFrameReadyObserver = null;
  }
}

function getScopedRuntimeModule() {
  return globalThis.AURA_MODE_ENGINE_SCOPED_V2 || null;
}

function isDarkFromTokenMap(tokenMap) {
  if (!tokenMap || typeof tokenMap !== 'object') {
    return false;
  }

  return tokenMap['--aura-color-scheme'] === 'dark';
}

function describeScope(scopeRoot) {
  if (!scopeRoot || typeof scopeRoot !== 'object') {
    return null;
  }

  return {
    tag: typeof scopeRoot.tagName === 'string' ? scopeRoot.tagName.toLowerCase() : '',
    auraScope: typeof scopeRoot.getAttribute === 'function'
      ? scopeRoot.getAttribute('data-aura-scope') === '1'
      : false,
  };
}

function createDarkComfortCleanupManifest(scopeRoot, options = {}) {
  const tokenMap = options.tokenMap && typeof options.tokenMap === 'object' ? options.tokenMap : {};
  const tokenKeys = Object.keys(tokenMap).filter((key) => typeof key === 'string');
  return {
    version: 1,
    owner: DARK_THEME_OWNER,
    executor: DARK_THEME_EXECUTOR,
    source: typeof options.source === 'string' ? options.source : 'runtime',
    createdAt: Date.now(),
    receipt: {
      id: typeof options.receiptId === 'string' && options.receiptId
        ? options.receiptId
        : activeDarkRuntimeReceiptId,
      documentBound: true,
      preimageAvailable: Boolean(scopeRoot),
    },
    scope: describeScope(scopeRoot),
    css: {
      insertedCssIds: [],
      styleElementIds: [],
    },
    tokens: {
      ownerKey: typeof options.ownerKey === 'string' ? options.ownerKey : null,
      keys: tokenKeys,
    },
    attributes: [
      'data-aura-surface',
      'data-aura-surface-kind',
      'data-aura-force-text',
      DARK_BG_MEDIA_ATTR,
      DARK_BG_GRADIENT_ATTR,
      DARK_BG_TEXT_GRADIENT_ATTR,
    ],
    inlineOverrides: {
      trackedBy: 'AURA_MODE_ENGINE_SCOPED_V2',
      restorable: true,
    },
    shadowRoots: {
      maxRoots: DARK_SHADOW_SCAN_BUDGET.maxShadowRoots,
      styleAttribute: DARK_SHADOW_STYLE_ATTR,
      restorable: true,
    },
    observers: ['surface-rescan', 'inline-rescan'],
    timers: ['initial-surface-pass', 'surface-rescan', 'inline-rescan', 'shadow-rescan'],
    postCheck: {
      required: true,
      passed: false,
    },
    rollbackRequired: true,
  };
}

function prepareDarkComfortThemeRuntime(options = {}) {
  const receiptId = typeof options.receiptId === 'string' && options.receiptId
    ? options.receiptId
    : activeDarkRuntimeReceiptId || `dark-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  activeDarkRuntimeReceiptId = receiptId;
  const scopeRoot = options.scopeRoot || null;
  if (scopeRoot) {
    Object.keys(options.tokenMap || {})
      .filter((key) => DARK_COMFORT_THEME_TOKEN_KEYS.includes(key))
      .forEach((key) => prepareDarkDocumentInlineOverride(scopeRoot, key));
    darkPreparedTokenRoots.add(scopeRoot);
  }
  const manifest = createDarkComfortCleanupManifest(options.scopeRoot || null, {
    source: typeof options.source === 'string' ? options.source : 'prepare',
    tokenMap: options.tokenMap,
    ownerKey: options.ownerKey,
    receiptId,
  });
  activeCleanupManifest = manifest;
  return { ok: true, receiptId, manifest };
}

function resetDarkRescanBudget(now = Date.now()) {
  darkRescanWindowStart = now;
  darkRescanCount = 0;
}

function canPerformDarkRescan(now = Date.now()) {
  if (!darkRescanWindowStart || now - darkRescanWindowStart > DARK_SURFACE_RESCAN_WINDOW_MS) {
    resetDarkRescanBudget(now);
  }
  return darkRescanCount < DARK_SURFACE_MAX_RESCANS_PER_MIN;
}

function muteDarkMutationObservers(now = Date.now()) {
  darkMutationMuteUntil = Math.max(darkMutationMuteUntil, now + DARK_MUTATION_SELF_MUTE_MS);
}

function shouldHandleDarkMutations(mutations = [], now = Date.now()) {
  for (const mutation of mutations || []) {
    if (mutation?.type === 'childList' && (mutation.addedNodes?.length || mutation.removedNodes?.length)) {
      return true;
    }
  }

  if (now < darkMutationMuteUntil) {
    return false;
  }

  for (const mutation of mutations || []) {
    if (
      mutation?.type === 'attributes'
      && DARK_MUTATION_ATTRIBUTE_FILTER.includes(String(mutation.attributeName || ''))
    ) {
      return true;
    }
  }

  return false;
}

function hasDarkAttributeMutation(mutations = []) {
  for (const mutation of mutations || []) {
    if (
      mutation?.type === 'attributes'
      && DARK_MUTATION_ATTRIBUTE_FILTER.includes(String(mutation.attributeName || ''))
    ) {
      return true;
    }
  }
  return false;
}

function shouldDelayDarkMutedAttributeMutations(mutations = [], now = Date.now()) {
  return now < darkMutationMuteUntil && hasDarkAttributeMutation(mutations);
}

function applyDarkSurfaceTagsSafe(scopeRoot, source = 'apply', budget = DARK_SURFACE_SCAN_BUDGET, options = {}) {
  if (!scopeRoot) {
    return null;
  }

  const runtimeModule = getScopedRuntimeModule();
  const applyDarkSurfaceTags = runtimeModule?.applyDarkSurfaceTags;
  if (typeof applyDarkSurfaceTags !== 'function') {
    return null;
  }

  try {
    muteDarkMutationObservers();
    return applyDarkSurfaceTags(scopeRoot, budget);
  } catch (error) {
    getLogger(options)(`Dark surface scan failed (${source})`, error);
    return { ok: false, reason: 'dark-surface-scan-failed' };
  }
}

function applyDarkRootColorSchemeOverride(scopeRoot) {
  if (!scopeRoot?.style || typeof scopeRoot.style.setProperty !== 'function') {
    return null;
  }

  prepareDarkDocumentInlineOverride(scopeRoot, 'color-scheme');
  scopeRoot.style.setProperty('color-scheme', 'dark', 'important');
  rememberDarkDocumentInlineOverride(scopeRoot, 'color-scheme', 'dark', 'important');
  darkDocumentInlineOverrideState.touched.add(scopeRoot);
  return { ok: true, overridden: 1 };
}

function applyDarkSurfaceInlineOverridesSafe(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot) {
    return null;
  }

  const runtimeModule = getScopedRuntimeModule();
  const applyDarkSurfaceInlineOverrides = runtimeModule?.applyDarkSurfaceInlineOverrides;
  let result = null;
  const rootColorScheme = applyDarkRootColorSchemeOverride(scopeRoot);
  const mediaBackgrounds = markDarkMediaBackgrounds(scopeRoot, source, options);
  const documentGradientOverrides = applyDarkDocumentGradientOverrides(scopeRoot, source, options);
  const inlineImportantSurfaceOverrides = applyDarkInlineImportantSurfaceOverrides(scopeRoot, source, options);
  const iconOverrides = applyDarkIconOverrides(scopeRoot, source, options);
  const localTokenOverrides = applyDarkDocumentLocalTokenOverrides(scopeRoot, source, options);

  if (typeof applyDarkSurfaceInlineOverrides === 'function') {
    try {
      const inlineBudget = options.inlineBudget && typeof options.inlineBudget === 'object'
        ? options.inlineBudget
        : DARK_INLINE_SCAN_BUDGET;
      muteDarkMutationObservers();
      result = applyDarkSurfaceInlineOverrides(scopeRoot, inlineBudget);
    } catch (error) {
      getLogger(options)(`Inline dark surface override failed (${source})`, error);
      result = { ok: false, reason: 'inline-dark-surface-override-failed' };
    }
  }

  if (options.documentInlineTextFallback === true) {
    const fallback = applyDarkDocumentInlineTextFallback(scopeRoot, source, options);
    if (fallback) {
      return {
        ok: result?.ok !== false
          && fallback.ok !== false
          && rootColorScheme?.ok !== false
          && mediaBackgrounds?.ok !== false
          && documentGradientOverrides?.ok !== false
          && inlineImportantSurfaceOverrides?.ok !== false
          && iconOverrides?.ok !== false
          && localTokenOverrides?.ok !== false,
        scanned: Math.max(0, Number(result?.scanned) || 0) + Math.max(0, Number(fallback.scanned) || 0),
        overridden:
          Math.max(0, Number(result?.overridden) || 0)
          + Math.max(0, Number(inlineImportantSurfaceOverrides?.overridden) || 0),
        forcedText:
          Math.max(0, Number(result?.forcedText) || 0)
          + Math.max(0, Number(fallback.forcedText) || 0)
          + Math.max(0, Number(inlineImportantSurfaceOverrides?.forcedText) || 0),
        budgetHit: result?.budgetHit === true
          || fallback.budgetHit === true
          || rootColorScheme?.budgetHit === true
          || mediaBackgrounds?.budgetHit === true
          || documentGradientOverrides?.budgetHit === true
          || inlineImportantSurfaceOverrides?.budgetHit === true
          || iconOverrides?.budgetHit === true
          || localTokenOverrides?.budgetHit === true,
        primary: result || null,
        documentTextFallback: fallback,
        rootColorScheme: rootColorScheme || null,
        localTokenOverrides: localTokenOverrides || null,
        mediaBackgrounds: mediaBackgrounds || null,
        documentGradientOverrides: documentGradientOverrides || null,
        inlineImportantSurfaceOverrides: inlineImportantSurfaceOverrides || null,
        iconOverrides: iconOverrides || null,
      };
    }
  }

  if (
    rootColorScheme
    || mediaBackgrounds
    || documentGradientOverrides
    || inlineImportantSurfaceOverrides
    || iconOverrides
    || localTokenOverrides
  ) {
    return {
      ...(result || {}),
      ok: result?.ok !== false
        && rootColorScheme?.ok !== false
        && mediaBackgrounds?.ok !== false
        && documentGradientOverrides?.ok !== false
        && inlineImportantSurfaceOverrides?.ok !== false
        && iconOverrides?.ok !== false
        && localTokenOverrides?.ok !== false,
      budgetHit: result?.budgetHit === true
        || rootColorScheme?.budgetHit === true
        || mediaBackgrounds?.budgetHit === true
        || documentGradientOverrides?.budgetHit === true
        || inlineImportantSurfaceOverrides?.budgetHit === true
        || iconOverrides?.budgetHit === true
        || localTokenOverrides?.budgetHit === true,
      rootColorScheme: rootColorScheme || null,
      localTokenOverrides: localTokenOverrides || null,
      mediaBackgrounds: mediaBackgrounds || null,
      documentGradientOverrides: documentGradientOverrides || null,
      inlineImportantSurfaceOverrides: inlineImportantSurfaceOverrides || null,
      iconOverrides: iconOverrides || null,
      overridden:
        Math.max(0, Number(result?.overridden) || 0)
        + Math.max(0, Number(inlineImportantSurfaceOverrides?.overridden) || 0),
      forcedText:
        Math.max(0, Number(result?.forcedText) || 0)
        + Math.max(0, Number(inlineImportantSurfaceOverrides?.forcedText) || 0),
    };
  }

  return result;
}

function clearDarkSurfaceInlineOverridesSafe(source = 'cleanup', options = {}) {
  const runtimeModule = getScopedRuntimeModule();
  const clearDarkSurfaceInlineOverrides = runtimeModule?.clearDarkSurfaceInlineOverrides;
  if (typeof clearDarkSurfaceInlineOverrides !== 'function') {
    return null;
  }

  try {
    return clearDarkSurfaceInlineOverrides();
  } catch (error) {
    getLogger(options)(`Inline dark surface cleanup failed (${source})`, error);
    return { ok: false, reason: 'inline-dark-surface-cleanup-failed' };
  }
}

function clearDarkSurfaceTagsSafe(scopeRoot, source = 'cleanup', options = {}) {
  if (!scopeRoot) {
    return null;
  }

  const runtimeModule = getScopedRuntimeModule();
  const clearDarkSurfaceTags = runtimeModule?.clearDarkSurfaceTags;
  if (typeof clearDarkSurfaceTags !== 'function') {
    return null;
  }

  try {
    return clearDarkSurfaceTags(scopeRoot, DARK_SURFACE_CLEANUP_BUDGET);
  } catch (error) {
    getLogger(options)(`Dark surface cleanup failed (${source})`, error);
    return { ok: false, reason: 'dark-surface-cleanup-failed' };
  }
}

function clearDarkScopedTokensSafe(scopeRoot, source = 'cleanup', options = {}) {
  if (!scopeRoot) {
    return null;
  }

  const runtimeModule = getScopedRuntimeModule();
  const removeTokensOwned = runtimeModule?.removeTokensOwned;
  if (typeof removeTokensOwned !== 'function') {
    return null;
  }

  try {
    return removeTokensOwned(scopeRoot, DARK_COMFORT_THEME_TOKEN_KEYS);
  } catch (error) {
    getLogger(options)(`Dark token cleanup failed (${source})`, error);
    return { ok: false, reason: 'dark-token-cleanup-failed' };
  }
}

function darkNowMs() {
  return globalThis?.performance?.now ? performance.now() : Date.now();
}

function normalizeDarkShadowBudget(budget = {}) {
  return {
    maxNodes: Number.isFinite(budget.maxNodes) ? Math.max(0, Math.floor(budget.maxNodes)) : DARK_SHADOW_SCAN_BUDGET.maxNodes,
    maxMs: Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_SHADOW_SCAN_BUDGET.maxMs,
    maxShadowRoots: Number.isFinite(budget.maxShadowRoots)
      ? Math.max(0, Math.floor(budget.maxShadowRoots))
      : DARK_SHADOW_SCAN_BUDGET.maxShadowRoots,
    maxNestedDepth: Number.isFinite(budget.maxNestedDepth)
      ? Math.max(0, Math.floor(budget.maxNestedDepth))
      : DARK_SHADOW_SCAN_BUDGET.maxNestedDepth,
  };
}

function elementChildren(node) {
  if (!node?.children || typeof node.children.length !== 'number') {
    return [];
  }
  return Array.from(node.children).filter(Boolean);
}

function collectOpenShadowRoots(scopeRoot, budget = DARK_SHADOW_SCAN_BUDGET) {
  const normalized = normalizeDarkShadowBudget(budget);
  const startedAt = darkNowMs();
  const roots = [];
  const queue = [{ node: scopeRoot, depth: 0 }];
  let nodesSeen = 0;
  let budgetHit = false;

  while (queue.length > 0) {
    if (nodesSeen >= normalized.maxNodes || roots.length >= normalized.maxShadowRoots) {
      budgetHit = true;
      break;
    }
    if (darkNowMs() - startedAt > normalized.maxMs) {
      budgetHit = true;
      break;
    }

    const { node, depth } = queue.shift();
    if (!node || depth > normalized.maxNestedDepth) {
      continue;
    }
    nodesSeen += 1;

    const shadowRoot = node.shadowRoot || null;
    if (shadowRoot && typeof shadowRoot.appendChild === 'function') {
      roots.push(shadowRoot);
      if (roots.length >= normalized.maxShadowRoots) {
        budgetHit = true;
        break;
      }
      for (const child of elementChildren(shadowRoot)) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }

    for (const child of elementChildren(node)) {
      queue.push({ node: child, depth: depth + 1 });
    }
  }

  return { roots, nodesSeen, budgetHit };
}

const DARK_SHADOW_DESIGN_SYSTEM_LOCAL_TOKEN_SELECTOR =
  ':where(dialog, [popover], [aria-modal="true"], [data-theme], [data-color-mode], [data-bs-theme], [data-mui-color-scheme], [data-surface], [data-card], [data-panel], [data-dialog], [data-popover], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="card" i], [class*="panel" i], [class*="surface" i], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="menu" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"], [role="tabpanel"])';

const DARK_SHADOW_FORMAT_SENSITIVE_TOKENS = new Set([
  '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
  '--primary', '--primary-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
  '--accent', '--accent-foreground', '--destructive', '--destructive-foreground', '--border', '--input', '--ring',
  '--sidebar', '--sidebar-foreground', '--sidebar-primary', '--sidebar-primary-foreground', '--sidebar-accent',
  '--sidebar-accent-foreground', '--sidebar-border', '--sidebar-ring', '--surface', '--surface-foreground',
  '--panel', '--panel-foreground', '--color-background', '--color-foreground', '--color-surface', '--color-surface-2',
  '--color-text', '--color-muted', '--color-border', '--color-link',
]);

const DARK_SHADOW_DESIGN_SYSTEM_TOKEN_DECLARATIONS = [
  `:host, :host ${DARK_SHADOW_DESIGN_SYSTEM_LOCAL_TOKEN_SELECTOR} {`,
  '--background: var(--aura-bg-color, #0b1020) !important;',
  '--foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--card: var(--aura-surface-1, #101a2f) !important;',
  '--card-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--popover: var(--aura-surface-1, #101a2f) !important;',
  '--popover-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--primary: var(--aura-link-color, #8ab4ff) !important;',
  '--primary-foreground: var(--aura-bg-color, #0b1020) !important;',
  '--secondary: var(--aura-surface-2, #0d1526) !important;',
  '--secondary-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--muted: var(--aura-surface-2, #0d1526) !important;',
  '--muted-foreground: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--accent: var(--aura-surface-2, #0d1526) !important;',
  '--accent-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--destructive: #7f1d1d !important;',
  '--destructive-foreground: #fecaca !important;',
  '--border: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--input: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--ring: var(--aura-focus-color, #9ab7ff) !important;',
  '--sidebar: var(--aura-surface-1, #101a2f) !important;',
  '--sidebar-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--sidebar-primary: var(--aura-link-color, #8ab4ff) !important;',
  '--sidebar-primary-foreground: var(--aura-bg-color, #0b1020) !important;',
  '--sidebar-accent: var(--aura-surface-2, #0d1526) !important;',
  '--sidebar-accent-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--sidebar-border: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--sidebar-ring: var(--aura-focus-color, #9ab7ff) !important;',
  '--surface: var(--aura-surface-1, #101a2f) !important;',
  '--surface-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--panel: var(--aura-surface-1, #101a2f) !important;',
  '--panel-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--color-background: var(--aura-bg-color, #0b1020) !important;',
  '--color-foreground: var(--aura-text-color, #e6e6e6) !important;',
  '--color-surface: var(--aura-surface-1, #101a2f) !important;',
  '--color-surface-2: var(--aura-surface-2, #0d1526) !important;',
  '--color-text: var(--aura-text-color, #e6e6e6) !important;',
  '--color-muted: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--color-border: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--color-link: var(--aura-link-color, #8ab4ff) !important;',
  '--bs-body-bg: var(--aura-bg-color, #0b1020) !important;',
  '--bs-body-color: var(--aura-text-color, #e6e6e6) !important;',
  '--bs-border-color: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--bs-link-color: var(--aura-link-color, #8ab4ff) !important;',
  '--bs-link-hover-color: var(--aura-link-hover-color, #b1ccff) !important;',
  '--bs-secondary-bg: var(--aura-surface-2, #0d1526) !important;',
  '--bs-tertiary-bg: var(--aura-surface-1, #101a2f) !important;',
  '--bs-emphasis-color: var(--aura-text-color, #e6e6e6) !important;',
  '--mui-palette-background-default: var(--aura-bg-color, #0b1020) !important;',
  '--mui-palette-background-paper: var(--aura-surface-1, #101a2f) !important;',
  '--mui-palette-text-primary: var(--aura-text-color, #e6e6e6) !important;',
  '--mui-palette-text-secondary: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--mui-palette-divider: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--mui-palette-primary-main: var(--aura-link-color, #8ab4ff) !important;',
  '--mui-palette-action-hover: var(--aura-surface-2, #0d1526) !important;',
  '--ant-color-bg-container: var(--aura-surface-1, #101a2f) !important;',
  '--ant-color-bg-elevated: var(--aura-surface-1, #101a2f) !important;',
  '--ant-color-bg-layout: var(--aura-bg-color, #0b1020) !important;',
  '--ant-color-text: var(--aura-text-color, #e6e6e6) !important;',
  '--ant-color-text-secondary: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--ant-color-border: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--ant-color-primary: var(--aura-link-color, #8ab4ff) !important;',
  '--ant-color-link: var(--aura-link-color, #8ab4ff) !important;',
  '--chakra-colors-chakra-body-bg: var(--aura-bg-color, #0b1020) !important;',
  '--chakra-colors-chakra-body-text: var(--aura-text-color, #e6e6e6) !important;',
  '--chakra-colors-bg: var(--aura-bg-color, #0b1020) !important;',
  '--chakra-colors-bg-subtle: var(--aura-surface-1, #101a2f) !important;',
  '--chakra-colors-bg-muted: var(--aura-surface-2, #0d1526) !important;',
  '--chakra-colors-fg: var(--aura-text-color, #e6e6e6) !important;',
  '--chakra-colors-fg-muted: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--chakra-colors-border: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--md-sys-color-background: var(--aura-bg-color, #0b1020) !important;',
  '--md-sys-color-on-background: var(--aura-text-color, #e6e6e6) !important;',
  '--md-sys-color-surface: var(--aura-surface-1, #101a2f) !important;',
  '--md-sys-color-surface-container: var(--aura-surface-1, #101a2f) !important;',
  '--md-sys-color-surface-container-high: var(--aura-surface-2, #0d1526) !important;',
  '--md-sys-color-on-surface: var(--aura-text-color, #e6e6e6) !important;',
  '--md-sys-color-outline: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--md-sys-color-primary: var(--aura-link-color, #8ab4ff) !important;',
  '--md-sys-color-on-primary: var(--aura-bg-color, #0b1020) !important;',
  '--bgColor-default: var(--aura-bg-color, #0b1020) !important;',
  '--bgColor-muted: var(--aura-surface-1, #101a2f) !important;',
  '--fgColor-default: var(--aura-text-color, #e6e6e6) !important;',
  '--fgColor-muted: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--borderColor-default: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--color-canvas-default: var(--aura-bg-color, #0b1020) !important;',
  '--color-canvas-subtle: var(--aura-surface-1, #101a2f) !important;',
  '--color-fg-default: var(--aura-text-color, #e6e6e6) !important;',
  '--color-fg-muted: var(--aura-muted-text-color, #a8b0bf) !important;',
  '--color-border-default: var(--aura-border-color, rgba(255,255,255,0.12)) !important;',
  '--color-accent-fg: var(--aura-link-color, #8ab4ff) !important;',
  '}',
];

const DARK_SHADOW_DESIGN_SYSTEM_TOKEN_RULE = DARK_SHADOW_DESIGN_SYSTEM_TOKEN_DECLARATIONS.filter((declaration) => {
  const tokenName = /^\s*(--[-\w]+)\s*:/.exec(declaration)?.[1] || null;
  return !tokenName || !DARK_SHADOW_FORMAT_SENSITIVE_TOKENS.has(tokenName);
}).join(' ');

const DARK_SHADOW_DESIGN_SYSTEM_FULL_TOKEN_RULE = DARK_SHADOW_DESIGN_SYSTEM_TOKEN_DECLARATIONS.join(' ');

function shadowRootUsesChannelTokens(shadowRoot) {
  const host = shadowRoot?.host || null;
  const view = host?.ownerDocument?.defaultView || globalThis;
  if (!host || typeof view?.getComputedStyle !== 'function') {
    return true;
  }
  try {
    const computedStyle = view.getComputedStyle(host);
    let hasFullColorToken = false;
    for (const tokenName of DARK_SHADOW_FORMAT_SENSITIVE_TOKENS) {
      const tokenValue = computedStyle?.getPropertyValue?.(tokenName) || '';
      if (isDarkChannelTokenValue(tokenValue)) {
        return true;
      }
      if (getDarkLocalTokenColor(tokenValue)) {
        hasFullColorToken = true;
      }
    }
    return !hasFullColorToken;
  } catch (_) {
    return true;
  }
}

function buildDarkShadowRootCss(shadowRoot = null) {
  const designSystemTokenRule = shadowRoot && !shadowRootUsesChannelTokens(shadowRoot)
    ? DARK_SHADOW_DESIGN_SYSTEM_FULL_TOKEN_RULE
    : DARK_SHADOW_DESIGN_SYSTEM_TOKEN_RULE;
  return [
    ':host { color-scheme: dark !important; background-color: var(--aura-surface-1, #101a2f); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); }',
    designSystemTokenRule,
    ':host ::selection { background-color: #1d4ed8; color: #f8fafc; -webkit-text-fill-color: #f8fafc; }',
    ':host * { scrollbar-color: var(--aura-muted-text-color, #a8b0bf) var(--aura-bg-color, #0b1020); }',
    ':host ::-webkit-scrollbar, :host ::-webkit-scrollbar-track { background-color: var(--aura-bg-color, #0b1020); }',
    ':host ::-webkit-scrollbar-thumb { background-color: rgba(168, 176, 191, 0.55); border: 2px solid var(--aura-bg-color, #0b1020); border-radius: 999px; }',
    ':host :where(main, section, article, aside, nav, header, footer, div, form, table, thead, tbody, tfoot, tr, th, td, caption, ul, ol, li, p, span, label, summary, details, fieldset, legend, figure, figcaption, blockquote, dl, dt, dd, hr, mark, kbd, samp, dialog, [popover], [role="main"], [role="navigation"], [role="search"], [role="form"], [role="complementary"], [role="contentinfo"], [role="region"], [role="dialog"], [role="alertdialog"], [role="grid"], [role="table"], [role="rowgroup"], [role="row"], [role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"], [role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="tooltip"], [role="tablist"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], [role="tab"], [role="tabpanel"]) { color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(main, section, article, aside, nav, header, footer, div, form, table, tbody, tfoot, tr, td, caption, dialog, [popover], [role="dialog"], [role="alertdialog"], [role="grid"], [role="table"], [role="rowgroup"], [role="row"], [role="cell"], [role="gridcell"], [role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="tooltip"], [role="tablist"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"], [role="tab"], [role="tabpanel"]) { background-color: transparent; }',
    ':host :where(dialog, [popover], [aria-modal="true"], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="sheet" i], [class*="drawer" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"]) { background-color: var(--aura-surface-1, #101a2f); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35); }',
    ':host :where(dialog, [popover], [aria-modal="true"], [data-radix-popper-content-wrapper], [data-headlessui-portal], [data-floating-ui-portal], [class*="modal" i], [class*="dialog" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="overlay" i], [class*="portal" i], [class*="sheet" i], [class*="drawer" i], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="tooltip"], [role="tree"], [role="tablist"]) :where(a, [role="link"], button, [role="button"], input, textarea, select, label, summary, div, span, p, small, strong, em, li) { color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(header, nav, aside, footer, [role="banner"], [role="navigation"], [role="toolbar"], [role="search"], [role="complementary"], [role="contentinfo"], [class*="appbar" i], [class*="app-bar" i], [class*="app-shell" i], [class*="commandbar" i], [class*="drawer" i], [class*="layout-header" i], [class*="masthead" i], [class*="navbar" i], [class*="nav-bar" i], [class*="side-nav" i], [class*="sidebar" i], [class*="sidepanel" i], [class*="side-panel" i], [class*="stickybar" i], [class*="sticky-bar" i], [class*="toolbar" i], [class*="topbar" i], [class*="top-bar" i]) { background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); box-shadow: 0 1px 0 var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(header, nav, aside, footer, [role="banner"], [role="navigation"], [role="toolbar"], [role="search"], [role="complementary"], [role="contentinfo"], [class*="appbar" i], [class*="app-bar" i], [class*="app-shell" i], [class*="commandbar" i], [class*="drawer" i], [class*="layout-header" i], [class*="masthead" i], [class*="navbar" i], [class*="nav-bar" i], [class*="side-nav" i], [class*="sidebar" i], [class*="sidepanel" i], [class*="side-panel" i], [class*="stickybar" i], [class*="sticky-bar" i], [class*="toolbar" i], [class*="topbar" i], [class*="top-bar" i]) :where(a, [role="link"], button, [role="button"], span, p, small, strong, em, label, summary) { color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(details, fieldset, figure, blockquote, dl) { background-color: var(--aura-surface-1, #101a2f); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(summary, legend, figcaption, dt, dd) { background-color: transparent; color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where([class*="card" i], [class*="panel" i], [class*="modal" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="surface" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [class*="banner" i], [data-surface], [data-card], [data-panel], [data-callout], [popover], [role="dialog"], [role="alertdialog"], [role="tooltip"])::before, :host :where([class*="card" i], [class*="panel" i], [class*="modal" i], [class*="popover" i], [class*="dropdown" i], [class*="tooltip" i], [class*="surface" i], [class*="sheet" i], [class*="drawer" i], [class*="callout" i], [class*="toast" i], [class*="banner" i], [data-surface], [data-card], [data-panel], [data-callout], [popover], [role="dialog"], [role="alertdialog"], [role="tooltip"])::after { background-color: var(--aura-surface-1, #101a2f); background-image: none !important; color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(hr) { background-color: var(--aura-border-color, rgba(255,255,255,0.12)); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); color: var(--aura-border-color, rgba(255,255,255,0.12)); -webkit-text-fill-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(mark) { background-color: #3a2a0a; color: #fde68a; -webkit-text-fill-color: #fde68a; }',
    ':host :where(thead, th, [role="columnheader"], [role="rowheader"]) { background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where([role="status"], [aria-live], [data-status], [data-severity], [data-tone], [class*="badge" i], [class*="pill" i], [class*="tag" i]) { background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where([class*="info" i], [class*="notice" i], [data-status*="info" i], [data-state*="info" i], [data-variant*="info" i], [data-severity*="info" i], [data-tone*="info" i], [data-status*="notice" i], [data-state*="notice" i], [data-variant*="notice" i], [data-severity*="notice" i], [data-tone*="notice" i]) { background-color: #102a43; color: #bfdbfe; -webkit-text-fill-color: #bfdbfe; border-color: #60a5fa; }',
    ':host :where([class*="success" i], [class*="positive" i], [data-status*="success" i], [data-state*="success" i], [data-variant*="success" i], [data-severity*="success" i], [data-tone*="success" i], [data-status*="positive" i], [data-state*="positive" i], [data-variant*="positive" i], [data-severity*="positive" i], [data-tone*="positive" i], [data-status*="ok" i], [data-state*="ok" i], [data-variant*="ok" i], [data-severity*="ok" i], [data-tone*="ok" i]) { background-color: #0f2e1e; color: #bbf7d0; -webkit-text-fill-color: #bbf7d0; border-color: #22c55e; }',
    ':host :where([class*="warning" i], [class*="warn" i], [class*="caution" i], [data-status*="warning" i], [data-state*="warning" i], [data-variant*="warning" i], [data-severity*="warning" i], [data-tone*="warning" i], [data-status*="warn" i], [data-state*="warn" i], [data-variant*="warn" i], [data-severity*="warn" i], [data-tone*="warn" i], [data-status*="caution" i], [data-state*="caution" i], [data-variant*="caution" i], [data-severity*="caution" i], [data-tone*="caution" i]) { background-color: #3a2a0a; color: #fde68a; -webkit-text-fill-color: #fde68a; border-color: #f59e0b; }',
    ':host :where([role="alert"]:not([class*="warning" i]):not([class*="warn" i]):not([class*="caution" i]):not([class*="success" i]):not([class*="positive" i]):not([class*="info" i]):not([class*="notice" i]):not([data-status*="warning" i]):not([data-state*="warning" i]):not([data-variant*="warning" i]):not([data-severity*="warning" i]):not([data-tone*="warning" i]):not([data-status*="success" i]):not([data-state*="success" i]):not([data-variant*="success" i]):not([data-severity*="success" i]):not([data-tone*="success" i]):not([data-status*="info" i]):not([data-state*="info" i]):not([data-variant*="info" i]):not([data-severity*="info" i]):not([data-tone*="info" i]), [class*="error" i], [class*="danger" i], [class*="destructive" i], [data-status*="error" i], [data-state*="error" i], [data-variant*="error" i], [data-severity*="error" i], [data-tone*="error" i], [data-status*="danger" i], [data-state*="danger" i], [data-variant*="danger" i], [data-severity*="danger" i], [data-tone*="danger" i], [data-status*="destructive" i], [data-state*="destructive" i], [data-variant*="destructive" i], [data-severity*="destructive" i], [data-tone*="destructive" i]) { background-color: #3a1115; color: #fecaca; -webkit-text-fill-color: #fecaca; border-color: #ef4444; }',
    ':host :where(a, [role="link"]) { color: var(--aura-link-color, #8ab4ff); -webkit-text-fill-color: var(--aura-link-color, #8ab4ff); text-decoration-color: currentColor; }',
    ':host a:visited { color: var(--aura-link-visited-color, #c58af9); -webkit-text-fill-color: var(--aura-link-visited-color, #c58af9); }',
    ':host :where(button, input, textarea, select, option, optgroup, progress, meter) { color-scheme: dark !important; background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); accent-color: var(--aura-focus-color, #9ab7ff); }',
    ':host input::file-selector-button { color-scheme: dark !important; background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(input, textarea, select):-webkit-autofill { -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); caret-color: var(--aura-text-color, #e6e6e6); box-shadow: 0 0 0 1000px var(--aura-surface-2, #0d1526) inset; border-color: var(--aura-border-color, rgba(255,255,255,0.12)); color-scheme: dark !important; }',
    ':host input::-webkit-search-cancel-button, :host input::-webkit-calendar-picker-indicator, :host input::-webkit-inner-spin-button, :host input::-webkit-outer-spin-button { filter: invert(1) brightness(1.35) contrast(0.95); opacity: 0.86; }',
    ':host :where(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]):focus, :host :where(a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"]):focus-visible { outline: 2px solid var(--aura-focus-color, #9ab7ff); outline-offset: 2px; box-shadow: 0 0 0 3px rgba(154, 183, 255, 0.22); }',
    ':host :where([aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-checked="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="checked" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]) { background-color: #1d2f55; color: #dbeafe; -webkit-text-fill-color: #dbeafe; border-color: #60a5fa; accent-color: #93c5fd; }',
    ':host a:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]), :host [role="link"]:where([aria-current]:not([aria-current="false"]), [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-current="true"], [data-state="active" i], [data-state="selected" i], [data-state="current" i], [class~="active" i], [class~="selected" i], [class~="current" i]) { color: #dbeafe; -webkit-text-fill-color: #dbeafe; }',
    ':host :where(:disabled, [disabled], [aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]) { background-color: #101827; color: #94a3b8; -webkit-text-fill-color: #94a3b8; border-color: #475569; opacity: 1; cursor: not-allowed; }',
    ':host a:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]), :host [role="link"]:where([aria-disabled="true"], [data-disabled="true"], [data-state="disabled" i], [class~="disabled" i]) { color: #94a3b8; -webkit-text-fill-color: #94a3b8; }',
    ':host :where(input, textarea, select)[aria-invalid="true"] { border-color: #ef4444; outline-color: #fca5a5; }',
    ':host :where(input, textarea)::placeholder { color: var(--aura-muted-text-color, #a8b0bf); -webkit-text-fill-color: var(--aura-muted-text-color, #a8b0bf); opacity: 1; }',
    ':host :where(pre, code, kbd, samp) { background-color: var(--aura-surface-2, #0d1526); color: var(--aura-text-color, #e6e6e6); -webkit-text-fill-color: var(--aura-text-color, #e6e6e6); border-color: var(--aura-border-color, rgba(255,255,255,0.12)); }',
    ':host :where(img, video, canvas, svg, picture, iframe) { color-scheme: normal; }',
  ].join(' ');
}

function findDarkShadowStyle(shadowRoot) {
  if (!shadowRoot || typeof shadowRoot.querySelector !== 'function') {
    return null;
  }
  try {
    return shadowRoot.querySelector(`style[${DARK_SHADOW_STYLE_ATTR}="${DARK_SHADOW_STYLE_VALUE}"]`);
  } catch (_) {
    return null;
  }
}

function createDarkShadowStyleNode(shadowRoot) {
  const doc = shadowRoot?.ownerDocument || shadowRoot?.host?.ownerDocument || globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') {
    return null;
  }
  const style = doc.createElement('style');
  style.setAttribute(DARK_SHADOW_STYLE_ATTR, DARK_SHADOW_STYLE_VALUE);
  style.textContent = buildDarkShadowRootCss(shadowRoot);
  return style;
}

function ensureDarkShadowStyleLast(shadowRoot, style) {
  if (!shadowRoot || !style || typeof shadowRoot.appendChild !== 'function') {
    return false;
  }

  const elementChildrenList = elementChildren(shadowRoot);
  if (elementChildrenList.length > 0 && elementChildrenList[elementChildrenList.length - 1] === style) {
    return false;
  }

  try {
    shadowRoot.appendChild(style);
    return true;
  } catch (_) {
    return false;
  }
}

function readDarkInlineValue(style, property) {
  if (!style || typeof style.getPropertyValue !== 'function') {
    return { value: null, priority: '' };
  }
  const value = style.getPropertyValue(property);
  const priority = style.getPropertyPriority?.(property) || '';
  return {
    value: value ? value : null,
    priority: priority ? priority : '',
  };
}

function escapeDarkRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasDarkExplicitInlineProperty(style, property) {
  if (!style || typeof property !== 'string' || !property) {
    return false;
  }

  const normalized = property.toLowerCase();
  if (typeof style.cssText === 'string' && style.cssText.trim()) {
    return new RegExp(`(?:^|;)\\s*${escapeDarkRegExp(normalized)}\\s*:`, 'i').test(style.cssText);
  }

  if (typeof style.length === 'number' && typeof style.item === 'function') {
    for (let index = 0; index < style.length; index += 1) {
      if (String(style.item(index) || '').toLowerCase() === normalized) {
        return true;
      }
    }
    return false;
  }

  return Boolean(readDarkInlineValue(style, property).value);
}

function readDarkExplicitInlineValue(style, property) {
  return hasDarkExplicitInlineProperty(style, property)
    ? readDarkInlineValue(style, property)
    : { value: null, priority: '' };
}

const DARK_SHADOW_INLINE_FIELDS = {
  background: ['background', 'backgroundPriority'],
  'background-color': ['bg', 'bgPriority'],
  'background-image': ['bgImage', 'bgImagePriority'],
  border: ['borderShorthand', 'borderShorthandPriority'],
  'border-color': ['border', 'borderPriority'],
  'box-shadow': ['boxShadow', 'boxShadowPriority'],
  'column-rule-color': ['columnRuleColor', 'columnRuleColorPriority'],
  'color-scheme': ['colorScheme', 'colorSchemePriority'],
  color: ['color', 'colorPriority'],
  '-webkit-text-fill-color': ['textFillColor', 'textFillColorPriority'],
  'caret-color': ['caretColor', 'caretColorPriority'],
  'accent-color': ['accentColor', 'accentColorPriority'],
  'outline-color': ['outlineColor', 'outlineColorPriority'],
  'text-decoration-color': ['textDecorationColor', 'textDecorationColorPriority'],
  'text-shadow': ['textShadow', 'textShadowPriority'],
  fill: ['fill', 'fillPriority'],
  stroke: ['stroke', 'strokePriority'],
};

function captureDarkShadowInlineSnapshot(element) {
  if (!element?.style) {
    return null;
  }
  const background = readDarkExplicitInlineValue(element.style, 'background');
  const bg = readDarkExplicitInlineValue(element.style, 'background-color');
  const bgImage = readDarkExplicitInlineValue(element.style, 'background-image');
  const borderShorthand = readDarkExplicitInlineValue(element.style, 'border');
  const border = readDarkExplicitInlineValue(element.style, 'border-color');
  const boxShadow = readDarkInlineValue(element.style, 'box-shadow');
  const columnRuleColor = readDarkInlineValue(element.style, 'column-rule-color');
  const colorScheme = readDarkInlineValue(element.style, 'color-scheme');
  const color = readDarkInlineValue(element.style, 'color');
  const textFillColor = readDarkInlineValue(element.style, '-webkit-text-fill-color');
  const caretColor = readDarkInlineValue(element.style, 'caret-color');
  const accentColor = readDarkInlineValue(element.style, 'accent-color');
  const outlineColor = readDarkInlineValue(element.style, 'outline-color');
  const textDecorationColor = readDarkInlineValue(element.style, 'text-decoration-color');
  const textShadow = readDarkInlineValue(element.style, 'text-shadow');
  const fill = readDarkInlineValue(element.style, 'fill');
  const stroke = readDarkInlineValue(element.style, 'stroke');
  return {
    background: background.value,
    backgroundPriority: background.priority,
    bg: bg.value,
    bgPriority: bg.priority,
    bgImage: bgImage.value,
    bgImagePriority: bgImage.priority,
    borderShorthand: borderShorthand.value,
    borderShorthandPriority: borderShorthand.priority,
    border: border.value,
    borderPriority: border.priority,
    boxShadow: boxShadow.value,
    boxShadowPriority: boxShadow.priority,
    columnRuleColor: columnRuleColor.value,
    columnRuleColorPriority: columnRuleColor.priority,
    colorScheme: colorScheme.value,
    colorSchemePriority: colorScheme.priority,
    color: color.value,
    colorPriority: color.priority,
    textFillColor: textFillColor.value,
    textFillColorPriority: textFillColor.priority,
    caretColor: caretColor.value,
    caretColorPriority: caretColor.priority,
    accentColor: accentColor.value,
    accentColorPriority: accentColor.priority,
    outlineColor: outlineColor.value,
    outlineColorPriority: outlineColor.priority,
    textDecorationColor: textDecorationColor.value,
    textDecorationColorPriority: textDecorationColor.priority,
    textShadow: textShadow.value,
    textShadowPriority: textShadow.priority,
    fill: fill.value,
    fillPriority: fill.priority,
    stroke: stroke.value,
    strokePriority: stroke.priority,
    custom: {},
  };
}

function updateDarkShadowInlineSnapshot(snapshot, property, inlineValue) {
  const fields = DARK_SHADOW_INLINE_FIELDS[property];
  if (!snapshot || !fields) {
    if (snapshot && typeof property === 'string' && property.startsWith('--')) {
      if (!snapshot.custom || typeof snapshot.custom !== 'object') {
        snapshot.custom = {};
      }
      snapshot.custom[property] = {
        value: inlineValue?.value || null,
        priority: inlineValue?.priority || '',
      };
    }
    return;
  }
  snapshot[fields[0]] = inlineValue?.value || null;
  snapshot[fields[1]] = inlineValue?.priority || '';
}

function darkInlineValueMatches(inlineValue, trackedValue) {
  if (!trackedValue) {
    return false;
  }
  return (
    (inlineValue?.value || null) === (trackedValue.value || null)
    && (inlineValue?.priority || '') === (trackedValue.priority || '')
  );
}

function getDarkShadowInlineSnapshot(element) {
  let snapshot = darkShadowInlineOverrideState.prev.get(element);
  if (!snapshot) {
    snapshot = captureDarkShadowInlineSnapshot(element);
    if (snapshot) {
      darkShadowInlineOverrideState.prev.set(element, snapshot);
    }
  }
  return snapshot;
}

function prepareDarkShadowInlineOverride(element, property) {
  const current = readDarkInlineValue(element?.style, property);
  const snapshot = getDarkShadowInlineSnapshot(element);
  const applied = darkShadowInlineOverrideState.applied.get(element) || {};
  if (!darkInlineValueMatches(current, applied[property])) {
    updateDarkShadowInlineSnapshot(snapshot, property, current);
  }
  return applied;
}

function rememberDarkShadowInlineOverride(element, property, value, priority = '') {
  const applied = darkShadowInlineOverrideState.applied.get(element) || {};
  applied[property] = {
    value: value || null,
    priority: priority || '',
  };
  darkShadowInlineOverrideState.applied.set(element, applied);
}

function getDarkDocumentInlineSnapshot(element) {
  let snapshot = darkDocumentInlineOverrideState.prev.get(element);
  if (!snapshot) {
    snapshot = captureDarkShadowInlineSnapshot(element);
    if (snapshot) {
      darkDocumentInlineOverrideState.prev.set(element, snapshot);
    }
  }
  return snapshot;
}

function prepareDarkDocumentInlineOverride(element, property) {
  const current = readDarkInlineValue(element?.style, property);
  const snapshot = getDarkDocumentInlineSnapshot(element);
  const applied = darkDocumentInlineOverrideState.applied.get(element) || {};
  if (!darkInlineValueMatches(current, applied[property])) {
    updateDarkShadowInlineSnapshot(snapshot, property, current);
  }
  return applied;
}

function rememberDarkDocumentInlineOverride(element, property, value, priority = '') {
  const applied = darkDocumentInlineOverrideState.applied.get(element) || {};
  applied[property] = {
    value: value || null,
    priority: priority || '',
  };
  darkDocumentInlineOverrideState.applied.set(element, applied);
}

function applyDarkRuntimeTokensExact(scopeRoot, tokenMap = {}) {
  if (!scopeRoot?.style || typeof scopeRoot.style.setProperty !== 'function') {
    return { ok: true, applied: 0, skipped: true, reason: 'external-token-owner' };
  }
  const entries = Object.entries(tokenMap)
    .filter(([key, value]) => (
      DARK_COMFORT_THEME_TOKEN_KEYS.includes(key) && typeof value === 'string'
    ));
  const wasPrepared = darkPreparedTokenRoots.has(scopeRoot);
  if (wasPrepared) darkPreparedTokenRoots.delete(scopeRoot);
  entries.forEach(([key, value]) => {
    if (!wasPrepared) prepareDarkDocumentInlineOverride(scopeRoot, key);
    scopeRoot.style.setProperty(key, value);
    rememberDarkDocumentInlineOverride(scopeRoot, key, value, '');
  });
  darkDocumentInlineOverrideState.touched.add(scopeRoot);
  return { ok: true, applied: entries.length };
}

function getDarkIconInlineSnapshot(element) {
  let snapshot = darkIconOverrideState.prev.get(element);
  if (!snapshot) {
    snapshot = captureDarkShadowInlineSnapshot(element);
    if (snapshot) {
      darkIconOverrideState.prev.set(element, snapshot);
    }
  }
  return snapshot;
}

function prepareDarkIconInlineOverride(element, property) {
  const current = readDarkInlineValue(element?.style, property);
  const snapshot = getDarkIconInlineSnapshot(element);
  const applied = darkIconOverrideState.applied.get(element) || {};
  if (!darkInlineValueMatches(current, applied[property])) {
    updateDarkShadowInlineSnapshot(snapshot, property, current);
  }
  return applied;
}

function rememberDarkIconInlineOverride(element, property, value, priority = '') {
  const applied = darkIconOverrideState.applied.get(element) || {};
  applied[property] = {
    value: value || null,
    priority: priority || '',
  };
  darkIconOverrideState.applied.set(element, applied);
}

function restoreDarkInlineValue(element, property, value, priority) {
  if (!element?.style || typeof element.style.setProperty !== 'function') {
    return;
  }
  if (value == null || value === '') {
    element.style.removeProperty?.(property);
    return;
  }
  element.style.setProperty(property, value, priority || '');
}

function restoreDarkShadowInlineOverride(element, snapshot, applied = {}, options = {}) {
  if (!snapshot || !element?.style) {
    return;
  }
  const restoreIfStillAura = (property, value, priority) => {
    const current = readDarkInlineValue(element.style, property);
    const tracked = applied?.[property] || null;
    const allowMissing = options.tokensAlreadyRemoved === true
      && property.startsWith('--aura-')
      && current.value == null;
    if (tracked && (darkInlineValueMatches(current, tracked) || allowMissing)) {
      restoreDarkInlineValue(element, property, value, priority);
    }
  };
  restoreIfStillAura('background', snapshot.background, snapshot.backgroundPriority);
  restoreIfStillAura('background-color', snapshot.bg, snapshot.bgPriority);
  restoreIfStillAura('background-image', snapshot.bgImage, snapshot.bgImagePriority);
  restoreIfStillAura('border', snapshot.borderShorthand, snapshot.borderShorthandPriority);
  restoreIfStillAura('border-color', snapshot.border, snapshot.borderPriority);
  restoreIfStillAura('box-shadow', snapshot.boxShadow, snapshot.boxShadowPriority);
  restoreIfStillAura('column-rule-color', snapshot.columnRuleColor, snapshot.columnRuleColorPriority);
  restoreIfStillAura('color-scheme', snapshot.colorScheme, snapshot.colorSchemePriority);
  restoreIfStillAura('color', snapshot.color, snapshot.colorPriority);
  restoreIfStillAura('-webkit-text-fill-color', snapshot.textFillColor, snapshot.textFillColorPriority);
  restoreIfStillAura('caret-color', snapshot.caretColor, snapshot.caretColorPriority);
  restoreIfStillAura('accent-color', snapshot.accentColor, snapshot.accentColorPriority);
  restoreIfStillAura('outline-color', snapshot.outlineColor, snapshot.outlineColorPriority);
  restoreIfStillAura('text-decoration-color', snapshot.textDecorationColor, snapshot.textDecorationColorPriority);
  restoreIfStillAura('text-shadow', snapshot.textShadow, snapshot.textShadowPriority);
  restoreIfStillAura('fill', snapshot.fill, snapshot.fillPriority);
  restoreIfStillAura('stroke', snapshot.stroke, snapshot.strokePriority);
  Object.entries(snapshot.custom || {}).forEach(([property, entry]) => {
    restoreIfStillAura(property, entry?.value || null, entry?.priority || '');
  });
}

function getDarkShadowElementArea(element) {
  const rect = typeof element?.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (!rect) {
    return 0;
  }
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  return Math.max(0, width) * Math.max(0, height);
}

function isDarkShadowProtectedElement(element) {
  const tag = String(element?.tagName || '').toUpperCase();
  return ['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'PICTURE', 'AUDIO', 'OBJECT', 'EMBED', 'STYLE', 'SCRIPT'].includes(tag);
}

function isDarkCustomElementHost(element) {
  const tag = typeof element?.tagName === 'string' ? element.tagName.toLowerCase() : '';
  return tag.includes('-');
}

function isDarkLocalTokenConsumerElement(element) {
  const tag = String(element?.tagName || '').toUpperCase();
  return DARK_DOCUMENT_LOCAL_TOKEN_CONSUMER_TAGS.has(tag);
}

function isDecorativeDarkGradient(backgroundImage = '') {
  const value = typeof backgroundImage === 'string' ? backgroundImage.trim().toLowerCase() : '';
  if (!value || value === 'none') {
    return false;
  }
  if (/\burl\s*\(/.test(value) || /\bimage-set\s*\(/.test(value) || /\bcross-fade\s*\(/.test(value)) {
    return false;
  }
  return /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/.test(value);
}

function isDarkTextClippedBackground(element, computedStyle = null) {
  const values = [
    computedStyle?.backgroundClip,
    computedStyle?.webkitBackgroundClip,
    typeof computedStyle?.getPropertyValue === 'function' ? computedStyle.getPropertyValue('background-clip') : '',
    typeof computedStyle?.getPropertyValue === 'function' ? computedStyle.getPropertyValue('-webkit-background-clip') : '',
    readDarkInlineValue(element?.style, 'background-clip').value,
    readDarkInlineValue(element?.style, '-webkit-background-clip').value,
  ];
  return values.some((value) => /\btext\b/i.test(String(value || '')));
}

function isMediaDarkBackground(backgroundImage = '') {
  const value = typeof backgroundImage === 'string' ? backgroundImage.trim().toLowerCase() : '';
  if (!value || value === 'none') {
    return false;
  }
  return /\b(?:url|image-set|cross-fade)\s*\(/.test(value);
}

function readDarkRuleBackgroundImage(rule) {
  const style = rule?.style;
  if (!style || typeof style.getPropertyValue !== 'function') {
    return '';
  }
  return String(
    style.getPropertyValue('background-image')
      || style.backgroundImage
      || style.getPropertyValue('background')
      || style.background
      || '',
  ).trim();
}

function createDarkAuthoredBackgroundReader(scopeRoot, options = {}) {
  const doc = scopeRoot?.ownerDocument;
  const styleSheets = doc?.styleSheets;
  if (!styleSheets || typeof styleSheets.length !== 'number') {
    return { read: () => '', stats: { rulesSeen: 0, rulesKept: 0, budgetHit: false } };
  }

  const budget = options.authoredBackgroundBudget && typeof options.authoredBackgroundBudget === 'object'
    ? options.authoredBackgroundBudget
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET;
  const maxStyleSheets = Number.isFinite(budget.maxStyleSheets)
    ? Math.max(0, Math.floor(budget.maxStyleSheets))
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxStyleSheets;
  const maxRules = Number.isFinite(budget.maxRules)
    ? Math.max(0, Math.floor(budget.maxRules))
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxRules;
  const rules = [];
  let sheetsSeen = 0;
  let rulesSeen = 0;
  let budgetHit = false;

  const visitRules = (ruleList) => {
    if (!ruleList || typeof ruleList.length !== 'number' || rulesSeen >= maxRules) {
      return;
    }

    for (let index = 0; index < ruleList.length; index += 1) {
      if (rulesSeen >= maxRules) {
        budgetHit = true;
        break;
      }
      const rule = ruleList[index];
      rulesSeen += 1;
      const backgroundImage = readDarkRuleBackgroundImage(rule);
      if (
        typeof rule?.selectorText === 'string'
        && (isMediaDarkBackground(backgroundImage) || isDecorativeDarkGradient(backgroundImage))
      ) {
        rules.push({
          selectorText: rule.selectorText,
          backgroundImage,
        });
      }
      if (rule?.cssRules && typeof rule.cssRules.length === 'number') {
        visitRules(rule.cssRules);
      }
    }
  };

  for (let index = styleSheets.length - 1; index >= 0; index -= 1) {
    if (sheetsSeen >= maxStyleSheets || rulesSeen >= maxRules) {
      budgetHit = index >= 0;
      break;
    }
    sheetsSeen += 1;
    try {
      visitRules(styleSheets[index].cssRules || styleSheets[index].rules);
    } catch (_) {
      // Cross-origin stylesheets are intentionally skipped.
    }
  }

  return {
    read: (element) => {
      if (!element || typeof element.matches !== 'function') {
        return '';
      }
      for (let index = rules.length - 1; index >= 0; index -= 1) {
        try {
          if (element.matches(rules[index].selectorText)) {
            return rules[index].backgroundImage;
          }
        } catch (_) {
          // Ignore unsupported selector syntax.
        }
      }
      return '';
    },
    stats: {
      sheetsSeen,
      rulesSeen,
      rulesKept: rules.length,
      budgetHit,
    },
  };
}

function getDarkAttributeMap(store, element) {
  let values = store.get(element);
  if (!values) {
    values = {};
    store.set(element, values);
  }
  return values;
}

function applyDarkTrackedAttribute(element, name, value) {
  if (!element || typeof element.setAttribute !== 'function') return false;
  const previous = getDarkAttributeMap(darkAttributeOverrideState.prev, element);
  const applied = getDarkAttributeMap(darkAttributeOverrideState.applied, element);
  const currentPresent = typeof element.hasAttribute === 'function'
    ? element.hasAttribute(name)
    : element.getAttribute?.(name) != null;
  const currentValue = currentPresent ? element.getAttribute?.(name) : null;
  if (!Object.hasOwn(previous, name) || currentValue !== applied[name]) {
    previous[name] = { present: currentPresent, value: currentValue };
  }
  element.setAttribute(name, value);
  applied[name] = value;
  darkAttributeOverrideState.touched.add(element);
  return true;
}

function clearDarkTrackedAttribute(element, name) {
  const applied = darkAttributeOverrideState.applied.get(element) || {};
  if (!Object.hasOwn(applied, name)) return false;
  if (element?.getAttribute?.(name) !== applied[name]) return false;
  const previous = darkAttributeOverrideState.prev.get(element)?.[name];
  if (previous?.present) element.setAttribute?.(name, previous.value ?? '');
  else element.removeAttribute?.(name);
  delete applied[name];
  return true;
}

function markDarkMediaBackgrounds(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }

  const budget = options.mediaBackgroundBudget && typeof options.mediaBackgroundBudget === 'object'
    ? options.mediaBackgroundBudget
    : options.inlineBudget && typeof options.inlineBudget === 'object'
      ? options.inlineBudget
      : DARK_INLINE_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes) ? Math.max(0, Math.floor(budget.maxNodes)) : DARK_INLINE_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_INLINE_SCAN_BUDGET.maxMs;
  const maxMediaMarked = Number.isFinite(budget.maxMediaBackgrounds)
    ? Math.max(0, Math.floor(budget.maxMediaBackgrounds))
    : 40;
  const maxGradientMarked = Number.isFinite(budget.maxGradientBackgrounds)
    ? Math.max(0, Math.floor(budget.maxGradientBackgrounds))
    : 160;
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
  const authoredBackgrounds = createDarkAuthoredBackgroundReader(scopeRoot, options);
  const startedAt = darkNowMs();

  let scanned = 0;
  let marked = 0;
  let mediaInlineRestored = 0;
  let gradientMarked = 0;
  let textGradientMarked = 0;
  let cleared = 0;
  let gradientCleared = 0;
  let textGradientCleared = 0;
  let budgetHit = authoredBackgrounds.stats.budgetHit === true;

  try {
    let node = walker.currentNode;
    while (node) {
      if (scanned >= maxNodes || darkNowMs() - startedAt > maxMs) {
        budgetHit = true;
        break;
      }
      scanned += 1;

      const element = node.nodeType === 1 ? node : null;
      if (element && !isDarkShadowProtectedElement(element)) {
        const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
        const computedBackgroundImage = style?.backgroundImage || '';
        const inlineBackgroundImage = readDarkInlineValue(element.style, 'background-image').value
          || readDarkInlineValue(element.style, 'background').value
          || '';
        const authoredBackgroundImage = authoredBackgrounds.read(element);
        const mediaBackgroundImage = [
          computedBackgroundImage,
          inlineBackgroundImage,
          authoredBackgroundImage,
        ].find((value) => isMediaDarkBackground(value)) || '';
        const hasMediaBackground = Boolean(mediaBackgroundImage);
        const hasTextClippedBackground = isDarkTextClippedBackground(element, style);
        const hasAnyGradientBackground =
          isDecorativeDarkGradient(computedBackgroundImage)
          || isDecorativeDarkGradient(inlineBackgroundImage)
          || isDecorativeDarkGradient(authoredBackgroundImage);
        const hasGradientBackground =
          !hasMediaBackground
          && !hasTextClippedBackground
          && hasAnyGradientBackground;
        const ownsMediaMark = element.getAttribute?.(DARK_BG_MEDIA_ATTR) === '1'
          && darkMediaBackgroundElements.has(element);
        const ownsGradientMark = element.getAttribute?.(DARK_BG_GRADIENT_ATTR) === '1'
          && darkGradientBackgroundElements.has(element);
        const ownsTextGradientMark = element.getAttribute?.(DARK_BG_TEXT_GRADIENT_ATTR) === '1'
          && darkTextGradientBackgroundElements.has(element);

        if (hasTextClippedBackground) {
          if (!ownsTextGradientMark) {
            applyDarkTrackedAttribute(element, DARK_BG_TEXT_GRADIENT_ATTR, '1');
            darkTextGradientBackgroundElements.add(element);
            textGradientMarked += 1;
          }
          if (ownsGradientMark) {
            clearDarkTrackedAttribute(element, DARK_BG_GRADIENT_ATTR);
            darkGradientBackgroundElements.delete(element);
            gradientCleared += 1;
          }
        } else if (ownsTextGradientMark) {
          clearDarkTrackedAttribute(element, DARK_BG_TEXT_GRADIENT_ATTR);
          darkTextGradientBackgroundElements.delete(element);
          textGradientCleared += 1;
        }

        if (hasMediaBackground && style && isVisibleElement(element, style)) {
          if (!ownsMediaMark && marked < maxMediaMarked) {
            applyDarkTrackedAttribute(element, DARK_BG_MEDIA_ATTR, '1');
            darkMediaBackgroundElements.add(element);
            marked += 1;
          }
          if (!isMediaDarkBackground(computedBackgroundImage) && mediaBackgroundImage) {
            if (applyDarkDocumentInlineOverrideValue(element, 'background-image', mediaBackgroundImage, 'important')) {
              mediaInlineRestored += 1;
            }
          }
          if (ownsGradientMark) {
            clearDarkTrackedAttribute(element, DARK_BG_GRADIENT_ATTR);
            darkGradientBackgroundElements.delete(element);
            gradientCleared += 1;
          }
        } else if (hasGradientBackground && style && isVisibleElement(element, style)) {
          if (!ownsGradientMark && gradientMarked < maxGradientMarked) {
            applyDarkTrackedAttribute(element, DARK_BG_GRADIENT_ATTR, '1');
            darkGradientBackgroundElements.add(element);
            gradientMarked += 1;
          }
          if (ownsMediaMark) {
            clearDarkTrackedAttribute(element, DARK_BG_MEDIA_ATTR);
            darkMediaBackgroundElements.delete(element);
            cleared += 1;
          }
        } else {
          if (ownsMediaMark) {
            clearDarkTrackedAttribute(element, DARK_BG_MEDIA_ATTR);
            darkMediaBackgroundElements.delete(element);
            cleared += 1;
          }
          if (ownsGradientMark) {
            clearDarkTrackedAttribute(element, DARK_BG_GRADIENT_ATTR);
            darkGradientBackgroundElements.delete(element);
            gradientCleared += 1;
          }
        }
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Media background mark failed (${source})`, error);
    return {
      ok: false,
      scanned,
      marked,
      mediaInlineRestored,
      gradientMarked,
      textGradientMarked,
      cleared,
      gradientCleared,
      textGradientCleared,
      reason: 'media-background-mark-failed',
    };
  }

  return {
    ok: true,
    scanned,
    marked,
    mediaInlineRestored,
    gradientMarked,
    textGradientMarked,
    cleared,
    gradientCleared,
    textGradientCleared,
    authoredRulesSeen: authoredBackgrounds.stats.rulesSeen,
    authoredRulesKept: authoredBackgrounds.stats.rulesKept,
    budgetHit,
  };
}

function getDarkInlineImportantSurfaceBudget(options = {}) {
  const budget = options.inlineImportantSurfaceBudget && typeof options.inlineImportantSurfaceBudget === 'object'
    ? options.inlineImportantSurfaceBudget
    : options.inlineBudget && typeof options.inlineBudget === 'object'
      ? options.inlineBudget
      : DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET;
  const maxOverrideValue = Number.isFinite(budget.maxInlineImportantOverrides)
    ? budget.maxInlineImportantOverrides
    : Number.isFinite(budget.maxOverrides)
      ? budget.maxOverrides
      : budget.maxCandidates;
  return {
    maxNodes: Number.isFinite(budget.maxNodes)
      ? Math.max(0, Math.floor(budget.maxNodes))
      : DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxNodes,
    maxMs: Number.isFinite(budget.maxMs)
      ? Math.max(0, budget.maxMs)
      : DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxMs,
    maxOverrides: Number.isFinite(maxOverrideValue)
      ? Math.max(0, Math.floor(maxOverrideValue))
      : DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxOverrides,
  };
}

function isLightDarkInlineSurfaceColor(value) {
  const color = extractDarkCssColor(value || '');
  return Boolean(color && color.alpha >= 0.85 && Number(relativeLuminance(color)) > 0.72);
}

function isLowLuminanceDarkInlineTextColor(value) {
  const color = extractDarkCssColor(value || '');
  return Boolean(color && color.alpha >= 0.85 && Number(relativeLuminance(color)) < 0.42);
}

function isLightDarkInlineShadow(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized === 'none') {
    return false;
  }

  return extractDarkCssColors(normalized).some((color) => (
    color
    && color.alpha >= 0.6
    && Number(relativeLuminance(color)) > 0.72
  ));
}

function getDarkBoxShadowReplacement(value) {
  return /\binset\b/i.test(String(value || ''))
    ? 'inset 0 0 0 9999px var(--aura-surface-2, #0d1526)'
    : '0 0 0 1px var(--aura-border-color, rgba(255,255,255,0.12)), 0 12px 32px rgba(0, 0, 0, 0.35)';
}

function applyDarkDocumentInlineOverrideValue(element, property, value, priority = 'important') {
  if (!element?.style || typeof element.style.setProperty !== 'function') {
    return false;
  }
  prepareDarkDocumentInlineOverride(element, property);
  element.style.setProperty(property, value, priority);
  rememberDarkDocumentInlineOverride(element, property, value, priority);
  darkDocumentInlineOverrideState.touched.add(element);
  return true;
}

function applyDarkInlineImportantSurfaceOverrides(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }

  const budget = getDarkInlineImportantSurfaceBudget(options);
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
  const startedAt = darkNowMs();
  let scanned = 0;
  let candidates = 0;
  let overridden = 0;
  let backgroundOverrides = 0;
  let imageOverrides = 0;
  let borderOverrides = 0;
  let shadowOverrides = 0;
  let forcedText = 0;
  let accessoryOverrides = 0;
  let decorationOverrides = 0;
  let budgetHit = false;

  try {
    let node = walker.currentNode;
    while (node) {
      if (scanned >= budget.maxNodes || overridden >= budget.maxOverrides || darkNowMs() - startedAt > budget.maxMs) {
        budgetHit = true;
        break;
      }
      scanned += 1;

      const element = node.nodeType === 1 ? node : null;
      if (!element?.style || isDarkShadowProtectedElement(element)) {
        node = walker.nextNode();
        continue;
      }

      const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
      if (style && !isVisibleElement(element, style)) {
        node = walker.nextNode();
        continue;
      }

      const inlineBackground = readDarkInlineValue(element.style, 'background');
      const inlineBackgroundColor = readDarkInlineValue(element.style, 'background-color');
      const inlineBackgroundImage = readDarkInlineValue(element.style, 'background-image');
      const inlineBorder = readDarkInlineValue(element.style, 'border');
      const inlineBorderColor = readDarkInlineValue(element.style, 'border-color');
      const inlineBorderTop = readDarkInlineValue(element.style, 'border-top');
      const inlineBorderRight = readDarkInlineValue(element.style, 'border-right');
      const inlineBorderBottom = readDarkInlineValue(element.style, 'border-bottom');
      const inlineBorderLeft = readDarkInlineValue(element.style, 'border-left');
      const inlineBoxShadow = readDarkInlineValue(element.style, 'box-shadow');
      const inlineColumnRule = readDarkInlineValue(element.style, 'column-rule');
      const inlineColumnRuleColor = readDarkInlineValue(element.style, 'column-rule-color');
      const inlineColor = readDarkInlineValue(element.style, 'color');
      const inlineTextFill = readDarkInlineValue(element.style, '-webkit-text-fill-color');
      const inlineCaretColor = readDarkInlineValue(element.style, 'caret-color');
      const inlineAccentColor = readDarkInlineValue(element.style, 'accent-color');
      const inlineOutline = readDarkInlineValue(element.style, 'outline');
      const inlineOutlineColor = readDarkInlineValue(element.style, 'outline-color');
      const inlineTextDecorationColor = readDarkInlineValue(element.style, 'text-decoration-color');
      const inlineTextShadow = readDarkInlineValue(element.style, 'text-shadow');
      const hasExplicitBackgroundShorthand =
        Boolean(inlineBackground.value)
        && hasDarkExplicitInlineProperty(element.style, 'background')
        && !hasDarkExplicitInlineProperty(element.style, 'background-color')
        && !hasDarkExplicitInlineProperty(element.style, 'background-image');
      const hasMediaInlineBackground = isMediaDarkBackground(inlineBackground.value || inlineBackgroundImage.value || '');
      const hasLightInlineBackground =
        isLightDarkInlineSurfaceColor(inlineBackgroundColor.value)
        || (hasExplicitBackgroundShorthand && isLightDarkInlineSurfaceColor(inlineBackground.value));
      const hasTextClippedBackground = isDarkTextClippedBackground(element, style);
      const hasDecorativeInlineGradient = isDecorativeDarkGradient(
        inlineBackgroundImage.value || inlineBackground.value || '',
      ) && !hasTextClippedBackground;
      const hasSurfaceCandidate = hasLightInlineBackground || hasDecorativeInlineGradient;
      const hasLightInlineBorder =
        isLightDarkInlineSurfaceColor(inlineBorderColor.value)
        || isLightDarkInlineSurfaceColor(inlineBorder.value)
        || isLightDarkInlineSurfaceColor(inlineBorderTop.value)
        || isLightDarkInlineSurfaceColor(inlineBorderRight.value)
        || isLightDarkInlineSurfaceColor(inlineBorderBottom.value)
        || isLightDarkInlineSurfaceColor(inlineBorderLeft.value);
      const hasLightInlineBoxShadow = isLightDarkInlineShadow(inlineBoxShadow.value);
      const hasLightInlineColumnRule =
        isLightDarkInlineSurfaceColor(inlineColumnRuleColor.value)
        || isLightDarkInlineSurfaceColor(inlineColumnRule.value);
      const hasDarkInlineColor = isLowLuminanceDarkInlineTextColor(inlineColor.value);
      const hasDarkInlineTextFill = isLowLuminanceDarkInlineTextColor(inlineTextFill.value);
      const hasDarkInlineCaret = isLowLuminanceDarkInlineTextColor(inlineCaretColor.value);
      const hasDarkInlineAccent = isLowLuminanceDarkInlineTextColor(inlineAccentColor.value);
      const hasDarkInlineOutline =
        isLowLuminanceDarkInlineTextColor(inlineOutlineColor.value)
        || isLowLuminanceDarkInlineTextColor(inlineOutline.value);
      const hasDarkInlineTextDecoration = isLowLuminanceDarkInlineTextColor(inlineTextDecorationColor.value);
      const hasLightInlineTextShadow = isLightDarkInlineShadow(inlineTextShadow.value);

      if (
        !hasSurfaceCandidate
        && !hasLightInlineBorder
        && !hasLightInlineBoxShadow
        && !hasLightInlineColumnRule
        && !hasDarkInlineColor
        && !hasDarkInlineTextFill
        && !hasDarkInlineCaret
        && !hasDarkInlineAccent
        && !hasDarkInlineOutline
        && !hasDarkInlineTextDecoration
        && !hasLightInlineTextShadow
      ) {
        node = walker.nextNode();
        continue;
      }

      candidates += 1;
      let touched = false;

      if (hasExplicitBackgroundShorthand && hasSurfaceCandidate && !hasMediaInlineBackground) {
        if (applyDarkDocumentInlineOverrideValue(element, 'background', 'var(--aura-surface-2)', 'important')) {
          backgroundOverrides += 1;
          touched = true;
        }
      } else if (hasSurfaceCandidate) {
        if (applyDarkDocumentInlineOverrideValue(element, 'background-color', 'var(--aura-surface-2)', 'important')) {
          backgroundOverrides += 1;
          touched = true;
        }
      }

      if (hasDecorativeInlineGradient) {
        if (applyDarkDocumentInlineOverrideValue(element, 'background-image', 'none', 'important')) {
          imageOverrides += 1;
          touched = true;
        }
      }

      if (hasLightInlineBorder) {
        if (
          applyDarkDocumentInlineOverrideValue(
            element,
            'border-color',
            'var(--aura-border-color, rgba(255,255,255,0.12))',
            'important',
          )
        ) {
          borderOverrides += 1;
          touched = true;
        }
      }

      if (hasLightInlineColumnRule) {
        if (
          applyDarkDocumentInlineOverrideValue(
            element,
            'column-rule-color',
            'var(--aura-border-color, rgba(255,255,255,0.12))',
            'important',
          )
        ) {
          borderOverrides += 1;
          touched = true;
        }
      }

      if (hasLightInlineBoxShadow) {
        if (
          applyDarkDocumentInlineOverrideValue(
            element,
            'box-shadow',
            getDarkBoxShadowReplacement(inlineBoxShadow.value),
            'important',
          )
        ) {
          shadowOverrides += 1;
          touched = true;
        }
      }

      if (hasLightInlineTextShadow) {
        if (applyDarkDocumentInlineOverrideValue(element, 'text-shadow', 'none', 'important')) {
          decorationOverrides += 1;
          touched = true;
        }
      }

      if (hasDarkInlineColor || (hasSurfaceCandidate && isLowLuminanceDarkInlineTextColor(style?.color || ''))) {
        if (applyDarkDocumentInlineOverrideValue(element, 'color', 'var(--aura-text-color, #e6e6e6)', 'important')) {
          forcedText += 1;
          touched = true;
        }
      }
      if (
        hasDarkInlineTextFill
        || (hasSurfaceCandidate && isLowLuminanceDarkInlineTextColor(style?.webkitTextFillColor || ''))
      ) {
        if (
          applyDarkDocumentInlineOverrideValue(
            element,
            '-webkit-text-fill-color',
            'var(--aura-text-color, #e6e6e6)',
            'important',
          )
        ) {
          forcedText += 1;
          touched = true;
        }
      }

      if (hasDarkInlineCaret) {
        if (applyDarkDocumentInlineOverrideValue(element, 'caret-color', 'var(--aura-text-color, #e6e6e6)', 'important')) {
          accessoryOverrides += 1;
          touched = true;
        }
      }
      if (hasDarkInlineAccent) {
        if (applyDarkDocumentInlineOverrideValue(element, 'accent-color', 'var(--aura-focus-color, #9ab7ff)', 'important')) {
          accessoryOverrides += 1;
          touched = true;
        }
      }
      if (hasDarkInlineOutline) {
        if (applyDarkDocumentInlineOverrideValue(element, 'outline-color', 'var(--aura-focus-color, #9ab7ff)', 'important')) {
          accessoryOverrides += 1;
          touched = true;
        }
      }
      if (hasDarkInlineTextDecoration) {
        if (applyDarkDocumentInlineOverrideValue(element, 'text-decoration-color', 'currentColor', 'important')) {
          accessoryOverrides += 1;
          touched = true;
        }
      }

      if (touched) {
        overridden += 1;
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Inline important dark surface override failed (${source})`, error);
    return {
      ok: false,
      scanned,
      candidates,
      overridden,
      backgroundOverrides,
      imageOverrides,
      borderOverrides,
      shadowOverrides,
      forcedText,
      accessoryOverrides,
      decorationOverrides,
      reason: 'inline-important-surface-override-failed',
    };
  }

  return {
    ok: true,
    scanned,
    candidates,
    overridden,
    backgroundOverrides,
    imageOverrides,
    borderOverrides,
    shadowOverrides,
    forcedText,
    accessoryOverrides,
    decorationOverrides,
    budgetHit,
  };
}

function applyDarkDocumentGradientOverrides(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }

  const budget = options.gradientOverrideBudget && typeof options.gradientOverrideBudget === 'object'
    ? options.gradientOverrideBudget
    : options.inlineBudget && typeof options.inlineBudget === 'object'
      ? options.inlineBudget
      : DARK_DOCUMENT_GRADIENT_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes)
    ? Math.max(0, Math.floor(budget.maxNodes))
    : DARK_DOCUMENT_GRADIENT_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs)
    ? Math.max(0, budget.maxMs)
    : DARK_DOCUMENT_GRADIENT_SCAN_BUDGET.maxMs;
  const maxOverrideValue = Number.isFinite(budget.maxGradientOverrides)
    ? budget.maxGradientOverrides
    : budget.maxOverrides;
  const maxOverrides = Number.isFinite(maxOverrideValue)
    ? Math.max(0, Math.floor(maxOverrideValue))
    : DARK_DOCUMENT_GRADIENT_SCAN_BUDGET.maxOverrides;
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
  const startedAt = darkNowMs();
  let scanned = 0;
  let candidates = 0;
  let overridden = 0;
  let forcedText = 0;
  let budgetHit = false;

  try {
    let node = walker.currentNode;
    while (node) {
      if (scanned >= maxNodes || overridden >= maxOverrides || darkNowMs() - startedAt > maxMs) {
        budgetHit = true;
        break;
      }
      scanned += 1;

      const element = node.nodeType === 1 ? node : null;
      if (element && !isDarkShadowProtectedElement(element)) {
        const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
        if (
          style
          && isVisibleElement(element, style)
          && isDecorativeDarkGradient(style.backgroundImage || '')
          && !isDarkTextClippedBackground(element, style)
        ) {
          candidates += 1;
          prepareDarkDocumentInlineOverride(element, 'background-image');
          element.style.setProperty('background-image', 'none', 'important');
          rememberDarkDocumentInlineOverride(element, 'background-image', 'none', 'important');

          const background = parseCssColor(style.backgroundColor || '');
          if (background && background.alpha >= 0.85 && Number(relativeLuminance(background)) > 0.72) {
            prepareDarkDocumentInlineOverride(element, 'background-color');
            element.style.setProperty('background-color', 'var(--aura-surface-1, #101827)', 'important');
            rememberDarkDocumentInlineOverride(element, 'background-color', 'var(--aura-surface-1, #101827)', 'important');
          }

          const textColor = parseCssColor(style.color || '');
          const surfaceColor = parseCssColor('#101827');
          if (
            textColor
            && (
              Number(relativeLuminance(textColor)) < 0.4
              || Number(contrastRatio(textColor, surfaceColor)) < DARK_POSTCHECK_THRESHOLDS.textContrast
            )
          ) {
            prepareDarkDocumentInlineOverride(element, 'color');
            element.style.setProperty('color', 'var(--aura-text-color, #e6e6e6)', 'important');
            rememberDarkDocumentInlineOverride(element, 'color', 'var(--aura-text-color, #e6e6e6)', 'important');
            prepareDarkDocumentInlineOverride(element, '-webkit-text-fill-color');
            element.style.setProperty('-webkit-text-fill-color', 'var(--aura-text-color, #e6e6e6)', 'important');
            rememberDarkDocumentInlineOverride(
              element,
              '-webkit-text-fill-color',
              'var(--aura-text-color, #e6e6e6)',
              'important',
            );
            forcedText += 1;
          }

          darkDocumentInlineOverrideState.touched.add(element);
          overridden += 1;
        }
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Document gradient override failed (${source})`, error);
    return { ok: false, scanned, candidates, overridden, reason: 'document-gradient-override-failed' };
  }

  return { ok: true, scanned, candidates, overridden, forcedText, budgetHit };
}

function clearDarkMediaBackgrounds() {
  let removed = 0;
  let gradientRemoved = 0;
  let textGradientRemoved = 0;
  darkMediaBackgroundElements.forEach((element) => {
    if (clearDarkTrackedAttribute(element, DARK_BG_MEDIA_ATTR)) {
      removed += 1;
    }
  });
  darkGradientBackgroundElements.forEach((element) => {
    if (clearDarkTrackedAttribute(element, DARK_BG_GRADIENT_ATTR)) {
      gradientRemoved += 1;
    }
  });
  darkTextGradientBackgroundElements.forEach((element) => {
    if (clearDarkTrackedAttribute(element, DARK_BG_TEXT_GRADIENT_ATTR)) {
      textGradientRemoved += 1;
    }
  });
  darkMediaBackgroundElements = new Set();
  darkGradientBackgroundElements = new Set();
  darkTextGradientBackgroundElements = new Set();
  darkAttributeOverrideState = {
    touched: new Set(),
    prev: new WeakMap(),
    applied: new WeakMap(),
  };
  return { ok: true, removed, gradientRemoved, textGradientRemoved };
}

function getDarkElementClassText(element) {
  const className = element?.className;
  if (typeof className === 'string') {
    return className;
  }
  if (typeof className?.baseVal === 'string') {
    return className.baseVal;
  }
  return '';
}

function hasDarkBrandLikeIconHint(element) {
  const hint = [
    element?.id || '',
    getDarkElementClassText(element),
    element?.getAttribute?.('aria-label') || '',
    element?.getAttribute?.('role') || '',
  ].join(' ');
  return /(^|[-_\s])(brand|logo|avatar|photo|image|media|flag|sponsor|ad)([-_\s]|$)/i.test(hint);
}

function hasDarkBrandLikeSvgHint(svg) {
  return hasDarkBrandLikeIconHint(svg);
}

function getDarkSvgPaintElements(svg, maxPaintNodes = DARK_ICON_SCAN_BUDGET.maxPaintNodes) {
  const elements = [svg];
  const selector = 'path,circle,rect,line,polyline,polygon,ellipse,use,g';
  try {
    if (typeof svg?.querySelectorAll === 'function') {
      for (const element of svg.querySelectorAll(selector)) {
        if (elements.length >= maxPaintNodes) {
          break;
        }
        elements.push(element);
      }
      return elements;
    }
  } catch (_) {
    return elements;
  }

  const visit = (node) => {
    if (!node || elements.length >= maxPaintNodes) {
      return;
    }
    for (const child of Array.from(node.children || [])) {
      if (elements.length >= maxPaintNodes) {
        break;
      }
      const tag = String(child?.tagName || '').toUpperCase();
      if (['PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON', 'ELLIPSE', 'USE', 'G'].includes(tag)) {
        elements.push(child);
      }
      visit(child);
    }
  };
  visit(svg);
  return elements;
}

function hasDarkSvgUnsafeDescendant(svg) {
  const selector = 'image,foreignObject,video,canvas,iframe,object,embed,text';
  try {
    return typeof svg?.querySelector === 'function' && Boolean(svg.querySelector(selector));
  } catch (_) {
    return false;
  }
}

function readDarkComputedPaint(style, property) {
  const value = typeof style?.getPropertyValue === 'function'
    ? style.getPropertyValue(property)
    : '';
  return value || style?.[property] || '';
}

function normalizeDarkPaintColor(rawValue, fallbackColor) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value || value === 'none' || value === 'transparent') {
    return null;
  }
  if (value === 'currentcolor') {
    return fallbackColor || null;
  }
  return parseCssColor(value);
}

function getDarkColorSpread(color) {
  if (!color) {
    return 0;
  }
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
}

function isDarkNeutralPaint(color) {
  return color
    && color.alpha >= 0.45
    && getDarkColorSpread(color) <= 36
    && Number(relativeLuminance(color)) < 0.38;
}

function isDarkColorfulPaint(color) {
  return color
    && color.alpha >= 0.45
    && getDarkColorSpread(color) > 54
    && Number(relativeLuminance(color)) >= 0.035;
}

function shouldLiftDarkIconPaint(color, background) {
  if (!isDarkNeutralPaint(color)) {
    return false;
  }
  const ratio = contrastRatio(color, background);
  return !Number.isFinite(ratio) || ratio < DARK_POSTCHECK_THRESHOLDS.nonTextContrast;
}

function getDarkIconPaintDecision(scopeRoot, svg, style, options = {}) {
  const budget = options.iconBudget && typeof options.iconBudget === 'object'
    ? options.iconBudget
    : DARK_ICON_SCAN_BUDGET;
  const maxPaintNodes = Number.isFinite(budget.maxPaintNodes)
    ? Math.max(1, Math.floor(budget.maxPaintNodes))
    : DARK_ICON_SCAN_BUDGET.maxPaintNodes;
  const maxPaintSamples = Number.isFinite(budget.maxPaintSamples)
    ? Math.max(1, Math.floor(budget.maxPaintSamples))
    : DARK_ICON_SCAN_BUDGET.maxPaintSamples;
  const elements = getDarkSvgPaintElements(svg, maxPaintNodes);
  if (elements.length > maxPaintNodes) {
    return { eligible: false, reason: 'complex-svg' };
  }

  const background = getReadableBackground(scopeRoot, svg) || parseCssColor('#0b1020');
  const svgColor = parseCssColor(style?.color || '');
  let darkPaints = 0;
  let colorfulPaints = 0;
  const paints = [];

  for (const element of elements) {
    if (paints.length >= maxPaintSamples) {
      break;
    }
    const paintStyle = getComputedStyleSafe(scopeRoot, element) || style;
    const fallbackColor = parseCssColor(paintStyle?.color || '') || svgColor;
    const fill = normalizeDarkPaintColor(readDarkComputedPaint(paintStyle, 'fill'), fallbackColor);
    const stroke = normalizeDarkPaintColor(readDarkComputedPaint(paintStyle, 'stroke'), fallbackColor);

    [
      ['fill', fill],
      ['stroke', stroke],
    ].forEach(([property, color]) => {
      if (!color || paints.length >= maxPaintSamples) {
        return;
      }
      if (isDarkColorfulPaint(color)) {
        colorfulPaints += 1;
      }
      if (shouldLiftDarkIconPaint(color, background)) {
        darkPaints += 1;
        paints.push({ element, property, color });
      }
    });
  }

  if (colorfulPaints > 0) {
    return { eligible: false, reason: 'colorful-svg' };
  }
  if (darkPaints === 0) {
    return { eligible: false, reason: 'no-low-contrast-paint' };
  }
  return { eligible: true, paints };
}

function isDarkIconSvgCandidate(scopeRoot, svg, style) {
  if (String(svg?.tagName || '').toUpperCase() !== 'SVG') {
    return false;
  }
  if (!style || !isVisibleElement(svg, style)) {
    return false;
  }
  if (hasDarkBrandLikeSvgHint(svg) || hasDarkSvgUnsafeDescendant(svg)) {
    return false;
  }
  const rect = typeof svg.getBoundingClientRect === 'function' ? svg.getBoundingClientRect() : null;
  const width = Math.max(0, Number(rect?.width) || 0);
  const height = Math.max(0, Number(rect?.height) || 0);
  if (width < 4 || height < 4 || width > 96 || height > 96 || width * height > 9216) {
    return false;
  }
  const background = getReadableBackground(scopeRoot, svg);
  return Number(relativeLuminance(background)) < 0.22;
}

function readDarkComputedMaskImage(style) {
  const read = (property) => (
    typeof style?.getPropertyValue === 'function'
      ? style.getPropertyValue(property)
      : ''
  );
  return String(
    read('-webkit-mask-image')
      || read('mask-image')
      || style?.webkitMaskImage
      || style?.maskImage
      || '',
  ).trim();
}

function hasVisibleDarkMaskImage(style) {
  const value = readDarkComputedMaskImage(style).toLowerCase();
  return Boolean(value && value !== 'none' && value !== 'initial' && value !== 'inherit' && value !== 'unset');
}

function isDarkMaskedIconCandidate(scopeRoot, element, style) {
  if (!element || String(element?.tagName || '').toUpperCase() === 'SVG') {
    return false;
  }
  if (!style || !isVisibleElement(element, style) || isDarkShadowProtectedElement(element)) {
    return false;
  }
  if (hasDarkBrandLikeIconHint(element) || !hasVisibleDarkMaskImage(style)) {
    return false;
  }
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  const width = Math.max(0, Number(rect?.width) || 0);
  const height = Math.max(0, Number(rect?.height) || 0);
  if (width < 4 || height < 4 || width > 96 || height > 96 || width * height > 9216) {
    return false;
  }
  const background = getReadableBackground(scopeRoot, element);
  if (Number(relativeLuminance(background)) >= 0.22) {
    return false;
  }
  const paint = parseCssColor(style?.backgroundColor || '');
  return shouldLiftDarkIconPaint(paint, background);
}

function applyDarkIconPaintOverride(element, property) {
  if (!element?.style || typeof element.style.setProperty !== 'function') {
    return false;
  }
  prepareDarkIconInlineOverride(element, property);
  element.style.setProperty(property, DARK_ICON_LIGHT_PAINT, 'important');
  rememberDarkIconInlineOverride(element, property, DARK_ICON_LIGHT_PAINT, 'important');
  darkIconOverrideState.touched.add(element);
  return true;
}

function applyDarkIconOverrides(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }

  const budget = options.iconBudget && typeof options.iconBudget === 'object'
    ? options.iconBudget
    : DARK_ICON_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes) ? Math.max(0, Math.floor(budget.maxNodes)) : DARK_ICON_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_ICON_SCAN_BUDGET.maxMs;
  const maxIcons = Number.isFinite(budget.maxIcons) ? Math.max(0, Math.floor(budget.maxIcons)) : DARK_ICON_SCAN_BUDGET.maxIcons;
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
  const startedAt = darkNowMs();

  let scanned = 0;
  let candidates = 0;
  let overridden = 0;
  let paintOverrides = 0;
  let maskOverrides = 0;
  let rejected = 0;
  let budgetHit = false;

  try {
    let node = walker.currentNode;
    while (node) {
      if (scanned >= maxNodes || overridden >= maxIcons || darkNowMs() - startedAt > maxMs) {
        budgetHit = true;
        break;
      }
      scanned += 1;

      const element = node.nodeType === 1 ? node : null;
      const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
      if (String(element?.tagName || '').toUpperCase() === 'SVG') {
        const svg = element;
        if (isDarkIconSvgCandidate(scopeRoot, svg, style)) {
          candidates += 1;
          const decision = getDarkIconPaintDecision(scopeRoot, svg, style, options);
          if (decision.eligible === true) {
            const touchedElements = new Set();
            const svgColor = parseCssColor(style?.color || '');
            const background = getReadableBackground(scopeRoot, svg);
            if (shouldLiftDarkIconPaint(svgColor, background) && applyDarkIconPaintOverride(svg, 'color')) {
              touchedElements.add(svg);
              paintOverrides += 1;
            }
            for (const paint of decision.paints || []) {
              if (applyDarkIconPaintOverride(paint.element, paint.property)) {
                touchedElements.add(paint.element);
                paintOverrides += 1;
              }
            }
            if (touchedElements.size > 0) {
              overridden += 1;
            }
          } else {
            rejected += 1;
          }
        }
      } else if (isDarkMaskedIconCandidate(scopeRoot, element, style)) {
        candidates += 1;
        if (applyDarkIconPaintOverride(element, 'background-color')) {
          overridden += 1;
          paintOverrides += 1;
          maskOverrides += 1;
        } else {
          rejected += 1;
        }
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Dark icon override failed (${source})`, error);
    return { ok: false, scanned, candidates, overridden, paintOverrides, maskOverrides, reason: 'dark-icon-override-failed' };
  }

  return { ok: true, scanned, candidates, overridden, paintOverrides, maskOverrides, rejected, budgetHit };
}

function clearDarkIconOverrides() {
  let restored = 0;
  darkIconOverrideState.touched.forEach((element) => {
    const snapshot = darkIconOverrideState.prev.get(element);
    const applied = darkIconOverrideState.applied.get(element) || {};
    restoreDarkShadowInlineOverride(element, snapshot, applied);
    restored += 1;
  });
  darkIconOverrideState = {
    touched: new Set(),
    prev: new WeakMap(),
    applied: new WeakMap(),
  };
  return { ok: true, restored };
}

function hasInlineShadowBackground(element) {
  if (!element?.style) {
    return false;
  }
  return Boolean(
    readDarkInlineValue(element.style, 'background').value
      || readDarkInlineValue(element.style, 'background-color').value
      || readDarkInlineValue(element.style, 'background-image').value,
  );
}

function hasVisibleDarkShadowBorder(style) {
  if (!style) {
    return false;
  }
  const width = Math.max(
    Number.parseFloat(style.borderTopWidth) || 0,
    Number.parseFloat(style.borderRightWidth) || 0,
    Number.parseFloat(style.borderBottomWidth) || 0,
    Number.parseFloat(style.borderLeftWidth) || 0,
  );
  if (width <= 0) {
    return false;
  }
  const borderStyle = style.borderTopStyle || style.borderStyle || '';
  return borderStyle && borderStyle !== 'none' && borderStyle !== 'hidden';
}

function applyDarkShadowRootInlineOverrides(roots = [], options = {}) {
  const budget = options.shadowInlineBudget && typeof options.shadowInlineBudget === 'object'
    ? options.shadowInlineBudget
    : DARK_SHADOW_INLINE_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes) ? Math.max(0, Math.floor(budget.maxNodes)) : DARK_SHADOW_INLINE_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_SHADOW_INLINE_SCAN_BUDGET.maxMs;
  const maxOverrides = Number.isFinite(budget.maxOverrides)
    ? Math.max(0, Math.floor(budget.maxOverrides))
    : DARK_SHADOW_INLINE_SCAN_BUDGET.maxOverrides;
  const minArea = Number.isFinite(budget.minArea) ? Math.max(0, budget.minArea) : DARK_SHADOW_INLINE_SCAN_BUDGET.minArea;
  const startedAt = darkNowMs();
  let nodesSeen = 0;
  let overridden = 0;
  let forcedText = 0;
  let borderOverrides = 0;
  let shadowOverrides = 0;
  let accessoryOverrides = 0;
  let decorationOverrides = 0;
  let budgetHit = false;

  for (const shadowRoot of roots || []) {
    if (!shadowRoot?.ownerDocument?.createTreeWalker) {
      continue;
    }
    const view = shadowRoot.ownerDocument.defaultView || globalThis;
    const walker = shadowRoot.ownerDocument.createTreeWalker(
      shadowRoot,
      view.NodeFilter?.SHOW_ELEMENT || 1,
    );
    let node = walker.currentNode;
    while (node) {
      if (nodesSeen >= maxNodes || overridden >= maxOverrides || darkNowMs() - startedAt > maxMs) {
        budgetHit = true;
        break;
      }
      nodesSeen += 1;

      const element = node.nodeType === 1 ? node : null;
      if (element && !isDarkShadowProtectedElement(element)) {
        const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
        const area = getDarkShadowElementArea(element);
        const background = parseCssColor(style?.backgroundColor || '');
        const hasLightBackground =
          background
          && background.alpha >= 0.85
          && Number(relativeLuminance(background)) > 0.72;
        const hasTextClippedBackground = isDarkTextClippedBackground(element, style);
        const hasDecorativeGradient =
          isDecorativeDarkGradient(style?.backgroundImage || '')
          && !hasTextClippedBackground;
        const hasGradientArea = hasDecorativeGradient && area >= 24;
        const inlineBackground = readDarkInlineValue(element.style, 'background');
        const inlineBackgroundColor = readDarkInlineValue(element.style, 'background-color');
        const inlineBorder = readDarkInlineValue(element.style, 'border');
        const inlineBorderColor = readDarkInlineValue(element.style, 'border-color');
        const inlineBorderTop = readDarkInlineValue(element.style, 'border-top');
        const inlineBorderRight = readDarkInlineValue(element.style, 'border-right');
        const inlineBorderBottom = readDarkInlineValue(element.style, 'border-bottom');
        const inlineBorderLeft = readDarkInlineValue(element.style, 'border-left');
        const inlineBoxShadow = readDarkInlineValue(element.style, 'box-shadow');
        const inlineColumnRule = readDarkInlineValue(element.style, 'column-rule');
        const inlineColumnRuleColor = readDarkInlineValue(element.style, 'column-rule-color');
        const inlineColor = readDarkInlineValue(element.style, 'color');
        const inlineTextFill = readDarkInlineValue(element.style, '-webkit-text-fill-color');
        const inlineCaretColor = readDarkInlineValue(element.style, 'caret-color');
        const inlineAccentColor = readDarkInlineValue(element.style, 'accent-color');
        const inlineOutline = readDarkInlineValue(element.style, 'outline');
        const inlineOutlineColor = readDarkInlineValue(element.style, 'outline-color');
        const inlineTextDecorationColor = readDarkInlineValue(element.style, 'text-decoration-color');
        const inlineTextShadow = readDarkInlineValue(element.style, 'text-shadow');
        const hasInlineLightBackground =
          isLightDarkInlineSurfaceColor(inlineBackgroundColor.value)
          || isLightDarkInlineSurfaceColor(inlineBackground.value);
        const hasInlineLightBorder =
          isLightDarkInlineSurfaceColor(inlineBorderColor.value)
          || isLightDarkInlineSurfaceColor(inlineBorder.value)
          || isLightDarkInlineSurfaceColor(inlineBorderTop.value)
          || isLightDarkInlineSurfaceColor(inlineBorderRight.value)
          || isLightDarkInlineSurfaceColor(inlineBorderBottom.value)
          || isLightDarkInlineSurfaceColor(inlineBorderLeft.value);
        const hasInlineLightBoxShadow = isLightDarkInlineShadow(inlineBoxShadow.value);
        const hasInlineLightColumnRule =
          isLightDarkInlineSurfaceColor(inlineColumnRuleColor.value)
          || isLightDarkInlineSurfaceColor(inlineColumnRule.value);
        const hasInlineDarkColor = isLowLuminanceDarkInlineTextColor(inlineColor.value);
        const hasInlineDarkTextFill = isLowLuminanceDarkInlineTextColor(inlineTextFill.value);
        const hasInlineDarkCaret = isLowLuminanceDarkInlineTextColor(inlineCaretColor.value);
        const hasInlineDarkAccent = isLowLuminanceDarkInlineTextColor(inlineAccentColor.value);
        const hasInlineDarkOutline =
          isLowLuminanceDarkInlineTextColor(inlineOutlineColor.value)
          || isLowLuminanceDarkInlineTextColor(inlineOutline.value);
        const hasInlineDarkTextDecoration = isLowLuminanceDarkInlineTextColor(inlineTextDecorationColor.value);
        const hasInlineLightTextShadow = isLightDarkInlineShadow(inlineTextShadow.value);
        const hasSurfaceIssue =
          (area >= minArea || hasGradientArea)
          && (hasInlineShadowBackground(element) || hasDecorativeGradient)
          && (hasLightBackground || hasDecorativeGradient || hasInlineLightBackground);
        const hasInlineIssue =
          hasInlineLightBorder
          || hasInlineLightBoxShadow
          || hasInlineLightColumnRule
          || hasInlineDarkColor
          || hasInlineDarkTextFill
          || hasInlineDarkCaret
          || hasInlineDarkAccent
          || hasInlineDarkOutline
          || hasInlineDarkTextDecoration
          || hasInlineLightTextShadow;
        if (
          style
          && isVisibleElement(element, style)
          && (hasSurfaceIssue || hasInlineIssue)
        ) {
          let touched = false;

          if (hasSurfaceIssue) {
            prepareDarkShadowInlineOverride(element, 'background-color');
            element.style.setProperty('background-color', 'var(--aura-surface-1, #101827)', 'important');
            rememberDarkShadowInlineOverride(element, 'background-color', 'var(--aura-surface-1, #101827)', 'important');
            touched = true;
          }

          if (hasDecorativeGradient) {
            prepareDarkShadowInlineOverride(element, 'background-image');
            element.style.setProperty('background-image', 'none', 'important');
            rememberDarkShadowInlineOverride(element, 'background-image', 'none', 'important');
            touched = true;
          }

          if (hasVisibleDarkShadowBorder(style) || hasInlineLightBorder) {
            prepareDarkShadowInlineOverride(element, 'border-color');
            element.style.setProperty('border-color', 'var(--aura-border-color, rgba(255,255,255,0.12))', 'important');
            rememberDarkShadowInlineOverride(element, 'border-color', 'var(--aura-border-color, rgba(255,255,255,0.12))', 'important');
            borderOverrides += 1;
            touched = true;
          }

          if (hasInlineLightColumnRule) {
            prepareDarkShadowInlineOverride(element, 'column-rule-color');
            element.style.setProperty('column-rule-color', 'var(--aura-border-color, rgba(255,255,255,0.12))', 'important');
            rememberDarkShadowInlineOverride(
              element,
              'column-rule-color',
              'var(--aura-border-color, rgba(255,255,255,0.12))',
              'important',
            );
            borderOverrides += 1;
            touched = true;
          }

          if (hasInlineLightBoxShadow) {
            const boxShadowReplacement = getDarkBoxShadowReplacement(inlineBoxShadow.value);
            prepareDarkShadowInlineOverride(element, 'box-shadow');
            element.style.setProperty('box-shadow', boxShadowReplacement, 'important');
            rememberDarkShadowInlineOverride(element, 'box-shadow', boxShadowReplacement, 'important');
            shadowOverrides += 1;
            touched = true;
          }

          if (hasInlineLightTextShadow) {
            prepareDarkShadowInlineOverride(element, 'text-shadow');
            element.style.setProperty('text-shadow', 'none', 'important');
            rememberDarkShadowInlineOverride(element, 'text-shadow', 'none', 'important');
            decorationOverrides += 1;
            touched = true;
          }

          const textColor = parseCssColor(style.color || '');
          const surfaceColor = parseCssColor('#101827');
          const shouldForceText =
            hasInlineDarkColor
            || hasInlineDarkTextFill
            || (
            textColor
            && (
              Number(relativeLuminance(textColor)) < 0.4
              || Number(contrastRatio(textColor, surfaceColor)) < DARK_POSTCHECK_THRESHOLDS.textContrast
            ));
          if (shouldForceText) {
            prepareDarkShadowInlineOverride(element, 'color');
            element.style.setProperty('color', 'var(--aura-text-color, #e6e6e6)', 'important');
            rememberDarkShadowInlineOverride(element, 'color', 'var(--aura-text-color, #e6e6e6)', 'important');
            prepareDarkShadowInlineOverride(element, '-webkit-text-fill-color');
            element.style.setProperty('-webkit-text-fill-color', 'var(--aura-text-color, #e6e6e6)', 'important');
            rememberDarkShadowInlineOverride(
              element,
              '-webkit-text-fill-color',
              'var(--aura-text-color, #e6e6e6)',
              'important',
            );
            forcedText += 1;
            touched = true;
          }

          if (hasInlineDarkCaret) {
            prepareDarkShadowInlineOverride(element, 'caret-color');
            element.style.setProperty('caret-color', 'var(--aura-text-color, #e6e6e6)', 'important');
            rememberDarkShadowInlineOverride(element, 'caret-color', 'var(--aura-text-color, #e6e6e6)', 'important');
            accessoryOverrides += 1;
            touched = true;
          }

          if (hasInlineDarkAccent) {
            prepareDarkShadowInlineOverride(element, 'accent-color');
            element.style.setProperty('accent-color', 'var(--aura-focus-color, #9ab7ff)', 'important');
            rememberDarkShadowInlineOverride(element, 'accent-color', 'var(--aura-focus-color, #9ab7ff)', 'important');
            accessoryOverrides += 1;
            touched = true;
          }

          if (hasInlineDarkOutline) {
            prepareDarkShadowInlineOverride(element, 'outline-color');
            element.style.setProperty('outline-color', 'var(--aura-focus-color, #9ab7ff)', 'important');
            rememberDarkShadowInlineOverride(element, 'outline-color', 'var(--aura-focus-color, #9ab7ff)', 'important');
            accessoryOverrides += 1;
            touched = true;
          }

          if (hasInlineDarkTextDecoration) {
            prepareDarkShadowInlineOverride(element, 'text-decoration-color');
            element.style.setProperty('text-decoration-color', 'currentColor', 'important');
            rememberDarkShadowInlineOverride(element, 'text-decoration-color', 'currentColor', 'important');
            accessoryOverrides += 1;
            touched = true;
          }

          if (touched) {
            darkShadowInlineOverrideState.touched.add(element);
            overridden += 1;
          }
        }
      }

      node = walker.nextNode();
    }

    if (budgetHit) {
      break;
    }
  }

  return {
    ok: true,
    rootsSeen: Array.isArray(roots) ? roots.length : 0,
    nodesSeen,
    overridden,
    forcedText,
    borderOverrides,
    shadowOverrides,
    accessoryOverrides,
    decorationOverrides,
    budgetHit,
  };
}

function clearDarkShadowInlineOverrides() {
  let restored = 0;
  darkShadowInlineOverrideState.touched.forEach((element) => {
    const snapshot = darkShadowInlineOverrideState.prev.get(element);
    const applied = darkShadowInlineOverrideState.applied.get(element) || {};
    restoreDarkShadowInlineOverride(element, snapshot, applied);
    restored += 1;
  });
  darkShadowInlineOverrideState = {
    touched: new Set(),
    prev: new WeakMap(),
    applied: new WeakMap(),
  };
  return { ok: true, restored };
}

function clearDarkDocumentInlineOverrides(options = {}) {
  let restored = 0;
  darkDocumentInlineOverrideState.touched.forEach((element) => {
    const snapshot = darkDocumentInlineOverrideState.prev.get(element);
    const applied = darkDocumentInlineOverrideState.applied.get(element) || {};
    restoreDarkShadowInlineOverride(element, snapshot, applied, options);
    restored += 1;
  });
  darkDocumentInlineOverrideState = {
    touched: new Set(),
    prev: new WeakMap(),
    applied: new WeakMap(),
  };
  return { ok: true, restored };
}

function hasDarkInlineTextColor(element) {
  if (!element?.style) {
    return false;
  }
  return Boolean(
    readDarkInlineValue(element.style, 'color').value
      || readDarkInlineValue(element.style, '-webkit-text-fill-color').value,
  );
}

function hasDarkSignificantText(element, style) {
  if (!element || !style) {
    return false;
  }
  const tagName = `${element.tagName || ''}`.toUpperCase();
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK'].includes(tagName)) {
    return false;
  }
  const text = `${element.innerText || element.textContent || ''}`.trim();
  if (text.length < 20) {
    return false;
  }
  return (Number.parseFloat(style.fontSize) || 0) >= 12;
}

function isDarkPriorityTextCandidate(element, style) {
  if (!hasDarkSignificantText(element, style)) {
    return false;
  }
  const tagName = `${element.tagName || ''}`.toUpperCase();
  const role = `${element.getAttribute?.('role') || ''}`.toLowerCase();
  return /^H[1-6]$/.test(tagName) || role === 'heading' || hasDarkInlineTextColor(element);
}

function shouldForceDarkDocumentText(scopeRoot, element, style) {
  const inlineTextColor = parseCssColor(
    readDarkInlineValue(element?.style, '-webkit-text-fill-color').value
      || readDarkInlineValue(element?.style, 'color').value
      || '',
  );
  const textColor = inlineTextColor || parseCssColor(style?.color || style?.webkitTextFillColor || '');
  if (!textColor) {
    return false;
  }
  const background = getReadableBackground(scopeRoot, element) || parseCssColor('#101827');
  const ratio = contrastRatio(textColor, background);
  return Number(relativeLuminance(textColor)) < 0.4
    || (Number.isFinite(ratio) && ratio < DARK_POSTCHECK_THRESHOLDS.textContrast);
}

function applyDarkDocumentInlineTextFallback(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }
  const budget = options.inlineBudget && typeof options.inlineBudget === 'object'
    ? options.inlineBudget
    : DARK_INLINE_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes) ? Math.max(0, Math.floor(budget.maxNodes)) : DARK_INLINE_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_INLINE_SCAN_BUDGET.maxMs;
  const maxForceText = Number.isFinite(budget.maxForceText)
    ? Math.max(0, Math.floor(budget.maxForceText))
    : 80;
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
  const startedAt = darkNowMs();

  let scanned = 0;
  let forcedText = 0;
  let priorityCandidates = 0;
  let inlineTextCandidates = 0;
  let contrastRejected = 0;
  let budgetHit = false;
  const seen = new Set();

  const visitElement = (element) => {
    if (!element || seen.has(element) || forcedText >= maxForceText) {
      return;
    }
    seen.add(element);
    scanned += 1;

    if (isDarkShadowProtectedElement(element)) {
      return;
    }

    const style = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
    const priorityCandidate = style
      && isVisibleElement(element, style)
      && isDarkPriorityTextCandidate(element, style);
    if (priorityCandidate) {
      priorityCandidates += 1;
      if (hasDarkInlineTextColor(element)) {
        inlineTextCandidates += 1;
      }
    }
    if (priorityCandidate && shouldForceDarkDocumentText(scopeRoot, element, style)) {
      prepareDarkDocumentInlineOverride(element, 'color');
      element.style.setProperty('color', 'var(--aura-text-color, #e6e6e6)', 'important');
      rememberDarkDocumentInlineOverride(element, 'color', 'var(--aura-text-color, #e6e6e6)', 'important');
      prepareDarkDocumentInlineOverride(element, '-webkit-text-fill-color');
      element.style.setProperty('-webkit-text-fill-color', 'var(--aura-text-color, #e6e6e6)', 'important');
      rememberDarkDocumentInlineOverride(
        element,
        '-webkit-text-fill-color',
        'var(--aura-text-color, #e6e6e6)',
        'important',
      );
      darkDocumentInlineOverrideState.touched.add(element);
      forcedText += 1;
    } else if (priorityCandidate) {
      contrastRejected += 1;
    }
  };

  try {
    if (typeof scopeRoot.querySelectorAll === 'function') {
      const priorityNodes = scopeRoot.querySelectorAll(
        'h1,h2,h3,h4,h5,h6,[role="heading"],[style*="color"],[style*="-webkit-text-fill-color"]',
      );
      const priorityLimit = Math.min(Number(priorityNodes?.length) || 0, maxNodes, maxForceText * 3);
      for (let index = 0; index < priorityLimit; index += 1) {
        if (darkNowMs() - startedAt > maxMs || forcedText >= maxForceText) {
          budgetHit = true;
          break;
        }
        visitElement(priorityNodes[index]);
      }
    }

    let node = walker.currentNode;
    while (node) {
      if (scanned >= maxNodes || darkNowMs() - startedAt > maxMs || forcedText >= maxForceText) {
        budgetHit = true;
        break;
      }

      const element = node.nodeType === 1 ? node : null;
      if (element) {
        visitElement(element);
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Document inline dark fallback failed (${source})`, error);
    return { ok: false, scanned, forcedText, reason: 'document-inline-dark-fallback-failed' };
  }

  return { ok: true, scanned, forcedText, priorityCandidates, inlineTextCandidates, contrastRejected, budgetHit };
}

function listDarkInlineCustomProperties(style) {
  if (!style) {
    return [];
  }

  const names = new Set();
  const length = Number.isFinite(style.length) ? Math.max(0, Math.floor(style.length)) : 0;
  for (let index = 0; index < length; index += 1) {
    const name = typeof style.item === 'function' ? style.item(index) : style[index];
    if (typeof name === 'string' && name.startsWith('--')) {
      names.add(name);
    }
  }

  if (typeof style.snapshot === 'function') {
    Object.keys(style.snapshot() || {}).forEach((name) => {
      if (typeof name === 'string' && name.startsWith('--')) {
        names.add(name);
      }
    });
  }

  const cssText = typeof style.cssText === 'string' ? style.cssText : '';
  const customPropertyPattern = /(?:^|;)\s*(--[-_a-z0-9]+)\s*:/gi;
  let match = customPropertyPattern.exec(cssText);
  while (match) {
    names.add(match[1]);
    match = customPropertyPattern.exec(cssText);
  }

  return Array.from(names);
}

function normalizeDarkLocalTokenName(property) {
  return String(property || '').trim().toLowerCase();
}

function isUnsafeInferredDarkLocalTokenName(tokenName) {
  return (
    !tokenName
    || !tokenName.startsWith('--')
    || tokenName.startsWith('--aura-')
    || /(?:^|[-_])(brand|logo|avatar|photo|media|image|chart|graph|series|plot|map|syntax|token|rainbow)(?:[-_]|$)/i.test(tokenName)
    || /(?:^|[-_])(success|positive|ok|warning|warn|danger|error|critical|info|notice|status)(?:[-_]|$)/i.test(tokenName)
  );
}

function tokenNameHasAnyHint(tokenName, hints) {
  return hints.some((hint) => tokenName.includes(hint));
}

function getDarkInferredSurfaceReplacement(tokenName) {
  if (tokenNameHasAnyHint(tokenName, ['muted', 'subtle', 'secondary', 'tertiary', 'elevated', 'hover', 'active'])) {
    return DARK_LOCAL_TOKEN_SURFACE_REPLACEMENTS.surface2;
  }
  if (tokenNameHasAnyHint(tokenName, ['body', 'page', 'canvas', 'app', 'base', 'root', 'background', 'bg-default'])) {
    return DARK_LOCAL_TOKEN_SURFACE_REPLACEMENTS.background;
  }
  return DARK_LOCAL_TOKEN_SURFACE_REPLACEMENTS.surface;
}

function parseDarkHslChannelColor(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (
    !value
    || value.includes('(')
    || value.includes(')')
    || value.includes(',')
    || value.includes('#')
    || /\bvar\s*\(/i.test(value)
  ) {
    return null;
  }

  const parts = parseDarkColorFunctionParts(value);
  if (parts.channels.length < 3 || !/%$/.test(parts.channels[1]) || !/%$/.test(parts.channels[2])) {
    return null;
  }

  const hue = parseDarkHue(parts.channels[0]);
  const saturation = parseDarkPercentage(parts.channels[1]);
  const lightness = parseDarkPercentage(parts.channels[2]);
  const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
  if (![hue, saturation, lightness, alpha].every(Number.isFinite)) {
    return null;
  }
  return { ...hslToDarkRgb(hue, saturation, lightness), alpha };
}

function parseDarkRgbChannelColor(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (
    !value
    || value.includes('(')
    || value.includes(')')
    || value.includes('#')
    || /\bvar\s*\(/i.test(value)
  ) {
    return null;
  }

  const parts = parseDarkColorFunctionParts(value);
  if (parts.channels.length < 3 || parts.channels.some((channel) => String(channel || '').includes('%'))) {
    return null;
  }

  const channels = parts.channels.slice(0, 3).map((part) => parseDarkRgbChannel(part));
  const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
  if (channels.some((part) => !Number.isFinite(part)) || !Number.isFinite(alpha)) {
    return null;
  }
  return {
    r: channels[0],
    g: channels[1],
    b: channels[2],
    alpha,
    format: value.includes(',') ? 'rgb-comma' : 'rgb-space',
  };
}

function getDarkLocalTokenColor(value) {
  return extractDarkCssColor(value) || parseDarkHslChannelColor(value) || parseDarkRgbChannelColor(value);
}

function isDarkHslChannelTokenValue(value) {
  return Boolean(parseDarkHslChannelColor(value));
}

function getDarkRgbChannelTokenFormat(value) {
  return parseDarkRgbChannelColor(value)?.format || null;
}

function formatDarkRgbChannelValue(value, format) {
  return format === 'rgb-comma' ? String(value || '').replace(/\s+/g, ', ') : value;
}

function getDarkLocalTokenChannelFormat(value) {
  if (isDarkHslChannelTokenValue(value)) {
    return 'hsl';
  }
  return getDarkRgbChannelTokenFormat(value);
}

function isDarkChannelTokenValue(value) {
  return Boolean(getDarkLocalTokenChannelFormat(value));
}

function selectDarkLocalTokenReplacement(role, channelFormat) {
  if (channelFormat === 'hsl') {
    return DARK_LOCAL_TOKEN_HSL_CHANNEL_REPLACEMENTS[role] || null;
  }
  if (channelFormat === 'rgb-space' || channelFormat === 'rgb-comma') {
    return formatDarkRgbChannelValue(DARK_LOCAL_TOKEN_RGB_CHANNEL_REPLACEMENTS[role], channelFormat);
  }
  return DARK_LOCAL_TOKEN_SURFACE_REPLACEMENTS[role] || null;
}

function parseDarkLocalTokenAlias(value) {
  const match = /^var\(\s*(--[-_a-z0-9]+)\s*(?:,\s*(.*))?\)$/i.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  return {
    property: normalizeDarkLocalTokenName(match[1]),
    fallback: String(match[2] || '').trim(),
  };
}

function resolveDarkLocalTokenAliasValue(value, authoredCustomProperties, style = null, seen = new Set()) {
  const rawValue = String(value || '').trim();
  const alias = parseDarkLocalTokenAlias(rawValue);
  if (!alias || seen.size >= 3 || seen.has(alias.property)) {
    return rawValue;
  }

  seen.add(alias.property);
  const inlineValue = style ? readDarkInlineValue(style, alias.property).value : '';
  const authoredValue = authoredCustomProperties?.get?.(alias.property) || '';
  const nextValue = String(inlineValue || authoredValue || alias.fallback || '').trim();
  if (!nextValue) {
    return rawValue;
  }
  const resolved = resolveDarkLocalTokenAliasValue(nextValue, authoredCustomProperties, style, seen);
  return resolved || nextValue;
}

function getDarkExplicitLocalTokenReplacement(property, directValue, rawValue, computedValue, authoredValue = '') {
  const tokenName = normalizeDarkLocalTokenName(property);
  const hslReplacement = DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_LOOKUP.get(tokenName);
  if (
    hslReplacement
    && (
      isDarkHslChannelTokenValue(rawValue)
      || isDarkHslChannelTokenValue(authoredValue)
      || isDarkHslChannelTokenValue(computedValue)
    )
  ) {
    return hslReplacement;
  }
  const rgbReplacement = DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_LOOKUP.get(tokenName);
  const rgbChannelFormat = getDarkRgbChannelTokenFormat(rawValue)
    || getDarkRgbChannelTokenFormat(authoredValue)
    || getDarkRgbChannelTokenFormat(computedValue);
  if (rgbReplacement && rgbChannelFormat) {
    return formatDarkRgbChannelValue(rgbReplacement, rgbChannelFormat);
  }
  return directValue;
}

function getDarkNeutralPaletteTokenInfo(tokenName) {
  const parts = String(tokenName || '')
    .replace(/^--/, '')
    .toLowerCase()
    .split(/[-_]+/)
    .filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const family = parts[index];
    if (!DARK_NEUTRAL_PALETTE_FAMILIES.has(family)) {
      continue;
    }
    const shade = Number.parseInt(parts[index + 1] || '', 10);
    return {
      family,
      shade: Number.isFinite(shade) ? shade : null,
    };
  }
  return null;
}

function getDarkNeutralPaletteReplacement(tokenName, luminance, channelFormat) {
  const info = getDarkNeutralPaletteTokenInfo(tokenName);
  if (!info || !Number.isFinite(luminance)) {
    return null;
  }

  if (info.family === 'white') {
    return luminance >= 0.72 ? selectDarkLocalTokenReplacement('surface', channelFormat) : null;
  }
  if (info.family === 'black') {
    return luminance <= 0.22 ? selectDarkLocalTokenReplacement('text', channelFormat) : null;
  }

  if (Number.isFinite(info.shade)) {
    if (info.shade <= 100 && luminance >= 0.72) {
      return selectDarkLocalTokenReplacement('surface', channelFormat);
    }
    if (info.shade <= 200 && luminance >= 0.42) {
      return selectDarkLocalTokenReplacement('surface2', channelFormat);
    }
    if (info.shade <= 400 && luminance >= 0.28) {
      return selectDarkLocalTokenReplacement('border', channelFormat);
    }
    if (info.shade <= 700) {
      return selectDarkLocalTokenReplacement('mutedText', channelFormat);
    }
    if (luminance <= 0.32) {
      return selectDarkLocalTokenReplacement('text', channelFormat);
    }
  }

  if (luminance >= 0.72) {
    return selectDarkLocalTokenReplacement('surface', channelFormat);
  }
  if (luminance >= 0.42) {
    return selectDarkLocalTokenReplacement('border', channelFormat);
  }
  if (luminance <= 0.32) {
    return selectDarkLocalTokenReplacement('text', channelFormat);
  }
  return selectDarkLocalTokenReplacement('mutedText', channelFormat);
}

function getDarkTailwindProseReplacement(tokenName, channelFormat) {
  const name = normalizeDarkLocalTokenName(tokenName);
  if (!name.startsWith('--tw-prose-')) {
    return null;
  }

  const proseName = name.replace(/^--tw-prose-/, '');
  const role = proseName.startsWith('invert-') ? proseName.slice('invert-'.length) : proseName;
  if (['body', 'headings', 'bold', 'quotes', 'code', 'pre-code', 'kbd'].includes(role)) {
    return selectDarkLocalTokenReplacement('text', channelFormat);
  }
  if (['lead', 'counters', 'bullets', 'captions'].includes(role)) {
    return selectDarkLocalTokenReplacement('mutedText', channelFormat);
  }
  if (role === 'links') {
    return selectDarkLocalTokenReplacement('link', channelFormat);
  }
  if (['hr', 'quote-borders', 'th-borders', 'td-borders', 'kbd-shadows'].includes(role)) {
    return selectDarkLocalTokenReplacement('border', channelFormat);
  }
  if (role === 'pre-bg') {
    return selectDarkLocalTokenReplacement('surface2', channelFormat);
  }
  return null;
}

function inferDarkLocalTokenReplacement(property, rawValue, computedValue = '') {
  const tokenName = normalizeDarkLocalTokenName(property);
  if (
    DARK_DOCUMENT_LOCAL_TOKEN_EXPLICIT_NAMES.has(tokenName)
    || isUnsafeInferredDarkLocalTokenName(tokenName)
  ) {
    return null;
  }

  const value = String(rawValue || computedValue || '').trim();
  const channelFormat = getDarkLocalTokenChannelFormat(value);
  const color = getDarkLocalTokenColor(value);
  if (!color || color.alpha < 0.45) {
    return null;
  }

  const luminance = Number(relativeLuminance(color));
  const proseReplacement = getDarkTailwindProseReplacement(tokenName, channelFormat);
  if (proseReplacement) {
    return proseReplacement;
  }

  const neutralPaletteReplacement = getDarkNeutralPaletteReplacement(tokenName, luminance, channelFormat);
  if (neutralPaletteReplacement) {
    return neutralPaletteReplacement;
  }

  const textHints = ['foreground', 'fg', 'text', 'copy', 'heading', 'title', 'label', 'caption', 'description'];
  const mutedTextHints = ['muted', 'subtle', 'secondary', 'placeholder', 'help', 'hint', 'description', 'caption'];
  const surfaceHints = [
    'background',
    'bg',
    'surface',
    'canvas',
    'page',
    'body',
    'app',
    'shell',
    'layout',
    'container',
    'content',
    'paper',
    'card',
    'panel',
    'popover',
    'dropdown',
    'menu',
    'modal',
    'dialog',
    'sheet',
    'drawer',
    'sidebar',
    'nav',
    'header',
    'footer',
    'toolbar',
  ];

  if (tokenNameHasAnyHint(tokenName, ['link', 'anchor'])) {
    return selectDarkLocalTokenReplacement('link', channelFormat);
  }
  if (tokenNameHasAnyHint(tokenName, ['focus', 'ring', 'caret', 'selection'])) {
    return luminance < 0.72 ? selectDarkLocalTokenReplacement('focus', channelFormat) : null;
  }
  if (tokenNameHasAnyHint(tokenName, ['border', 'divider', 'separator', 'stroke', 'outline', 'rule'])) {
    return luminance > 0.38 ? selectDarkLocalTokenReplacement('border', channelFormat) : null;
  }
  if (
    tokenName.startsWith('--on-')
    || tokenName.includes('-on-')
    || tokenNameHasAnyHint(tokenName, textHints)
  ) {
    if (luminance >= 0.72) {
      return null;
    }
    return tokenNameHasAnyHint(tokenName, mutedTextHints)
      ? selectDarkLocalTokenReplacement('mutedText', channelFormat)
      : selectDarkLocalTokenReplacement('text', channelFormat);
  }
  if (tokenNameHasAnyHint(tokenName, surfaceHints)) {
    if (luminance <= 0.58) {
      return null;
    }
    if (!channelFormat) {
      return getDarkInferredSurfaceReplacement(tokenName);
    }
    if (tokenNameHasAnyHint(tokenName, ['muted', 'subtle', 'secondary', 'tertiary', 'elevated', 'hover', 'active'])) {
      return selectDarkLocalTokenReplacement('surface2', channelFormat);
    }
    if (tokenNameHasAnyHint(tokenName, ['body', 'page', 'canvas', 'app', 'base', 'root', 'background', 'bg-default'])) {
      return selectDarkLocalTokenReplacement('background', channelFormat);
    }
    return selectDarkLocalTokenReplacement('surface', channelFormat);
  }

  return null;
}

function getDarkInferredLocalTokenOverrides(element, computedStyle = null, authoredCustomProperties = null) {
  const overrides = [];
  const properties = new Set(listDarkInlineCustomProperties(element?.style));
  if (authoredCustomProperties && typeof authoredCustomProperties.entries === 'function') {
    for (const [property] of authoredCustomProperties.entries()) {
      if (typeof property === 'string' && property.startsWith('--')) {
        properties.add(property);
      }
    }
  }

  for (const property of properties) {
    const rawValue = readDarkInlineValue(element.style, property).value;
    const authoredValue = authoredCustomProperties?.get?.(normalizeDarkLocalTokenName(property)) || '';
    const computedValue = typeof computedStyle?.getPropertyValue === 'function'
      ? computedStyle.getPropertyValue(property)
      : '';
    const resolvedValue = resolveDarkLocalTokenAliasValue(
      rawValue || authoredValue || computedValue,
      authoredCustomProperties,
      element?.style,
    );
    const replacement = inferDarkLocalTokenReplacement(property, resolvedValue || rawValue || authoredValue, computedValue);
    if (replacement) {
      overrides.push([property, replacement]);
    }
  }
  return overrides;
}

function collectDarkAuthoredCustomPropertyRules(documentRef, options = {}) {
  if (!documentRef?.styleSheets) {
    return [];
  }
  const budget = options.ruleBudget && typeof options.ruleBudget === 'object'
    ? options.ruleBudget
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET;
  const maxStyleSheets = Number.isFinite(budget.maxStyleSheets)
    ? Math.max(0, Math.floor(budget.maxStyleSheets))
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxStyleSheets;
  const maxRules = Number.isFinite(budget.maxRules)
    ? Math.max(0, Math.floor(budget.maxRules))
    : DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxRules;
  const deadlineAt = Number.isFinite(options.deadlineAt) ? options.deadlineAt : Infinity;
  const authoredRules = [];
  let sheetsSeen = 0;
  let rulesSeen = 0;

  const rememberChannelTokenUsages = (text, declarations) => {
    const source = String(text || '');
    if (!source || !/\b(?:hsla?|rgba?)\s*\(/i.test(source)) {
      return;
    }
    const hslPattern = /\bhsla?\s*\(\s*var\s*\(\s*(--[-_a-z0-9]+)\s*\)/gi;
    let hslMatch = hslPattern.exec(source);
    while (hslMatch) {
      const tokenName = normalizeDarkLocalTokenName(hslMatch[1]);
      if (DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_LOOKUP.has(tokenName) && !declarations.has(tokenName)) {
        declarations.set(tokenName, '0 0% 100%');
      }
      hslMatch = hslPattern.exec(source);
    }

    const rgbPattern = /\brgba?\s*\(\s*var\s*\(\s*(--[-_a-z0-9]+)\s*\)\s*(,|\/|\))/gi;
    let rgbMatch = rgbPattern.exec(source);
    while (rgbMatch) {
      const tokenName = normalizeDarkLocalTokenName(rgbMatch[1]);
      if (DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_LOOKUP.has(tokenName) && !declarations.has(tokenName)) {
        declarations.set(tokenName, rgbMatch[2] === ',' ? '255, 255, 255' : '255 255 255');
      }
      rgbMatch = rgbPattern.exec(source);
    }
  };

  const readDeclarations = (style, cssText = '') => {
    const declarations = new Map();
    if (!style || typeof style.length !== 'number' || typeof style.getPropertyValue !== 'function') {
      return declarations;
    }
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item ? style.item(index) : style[index];
      const tokenName = normalizeDarkLocalTokenName(property);
      if (!tokenName || !tokenName.startsWith('--')) {
        continue;
      }
      const value = String(style.getPropertyValue(property) || '').trim();
      if (!value) {
        continue;
      }
      const previous = declarations.get(tokenName);
      if (!previous || (!isDarkHslChannelTokenValue(previous) && isDarkHslChannelTokenValue(value))) {
        declarations.set(tokenName, value);
      }
    }
    rememberChannelTokenUsages(cssText || style.cssText || '', declarations);
    return declarations;
  };

  const visitRules = (rules) => {
    if (!rules) {
      return;
    }
    for (let index = 0; index < rules.length; index += 1) {
      if (rulesSeen >= maxRules || darkNowMs() > deadlineAt) {
        return;
      }
      const rule = rules[index];
      rulesSeen += 1;
      if (rule?.selectorText && rule?.style) {
        const declarations = readDeclarations(rule.style, rule.cssText);
        if (declarations.size > 0) {
          authoredRules.push({ selectorText: rule.selectorText, declarations });
        }
      } else if (rule?.cssRules) {
        try {
          visitRules(rule.cssRules);
        } catch (_) {
          // Cross-origin and unusual nested rules are intentionally ignored.
        }
      }
    }
  };

  for (let index = 0; index < documentRef.styleSheets.length; index += 1) {
    if (sheetsSeen >= maxStyleSheets || rulesSeen >= maxRules || darkNowMs() > deadlineAt) {
      break;
    }
    const sheet = documentRef.styleSheets[index];
    sheetsSeen += 1;
    try {
      visitRules(sheet.cssRules);
    } catch (_) {
      // Cross-origin stylesheets are not readable from the content script.
    }
  }

  return authoredRules;
}

function collectDarkAuthoredCustomPropertiesForElement(element, options = {}) {
  if (!element || typeof element.matches !== 'function') {
    return new Map();
  }

  const authoredRules = Array.isArray(options.authoredRuleCache)
    ? options.authoredRuleCache
    : collectDarkAuthoredCustomPropertyRules(element.ownerDocument || globalThis.document, options);
  const authored = new Map();
  for (const rule of authoredRules) {
    if (!rule?.selectorText || !rule?.declarations) {
      continue;
    }
    try {
      if (!element.matches(rule.selectorText)) {
        continue;
      }
    } catch (_) {
      // Complex or unsupported selectors should not block dark mode.
      continue;
    }
    for (const [tokenName, value] of rule.declarations.entries()) {
      const previous = authored.get(tokenName);
      if (!previous || (!isDarkHslChannelTokenValue(previous) && isDarkHslChannelTokenValue(value))) {
        authored.set(tokenName, value);
      }
    }
  }
  return authored;
}

function hasDarkTransformableAuthoredToken(authoredCustomProperties) {
  if (!authoredCustomProperties || typeof authoredCustomProperties.entries !== 'function') {
    return false;
  }
  for (const [tokenName, value] of authoredCustomProperties.entries()) {
    const normalizedTokenName = normalizeDarkLocalTokenName(tokenName);
    if (
      (
        DARK_DOCUMENT_LOCAL_TOKEN_HSL_CHANNEL_LOOKUP.has(normalizedTokenName)
        && isDarkHslChannelTokenValue(value)
      )
      || (
        DARK_DOCUMENT_LOCAL_TOKEN_RGB_CHANNEL_LOOKUP.has(normalizedTokenName)
        && getDarkRgbChannelTokenFormat(value)
      )
    ) {
      return true;
    }
    if (
      DARK_DOCUMENT_LOCAL_TOKEN_EXPLICIT_NAMES.has(normalizedTokenName)
      && getDarkLocalTokenColor(value)
    ) {
      return true;
    }
    const resolvedValue = resolveDarkLocalTokenAliasValue(value, authoredCustomProperties);
    if (inferDarkLocalTokenReplacement(normalizedTokenName, resolvedValue || value, '')) {
      return true;
    }
  }
  return false;
}

function mergeDarkAuthoredCustomProperties(inheritedProperties, ownProperties) {
  const merged = new Map();
  if (inheritedProperties && typeof inheritedProperties.entries === 'function') {
    for (const [tokenName, value] of inheritedProperties.entries()) {
      merged.set(tokenName, value);
    }
  }
  if (ownProperties && typeof ownProperties.entries === 'function') {
    for (const [tokenName, value] of ownProperties.entries()) {
      const previous = merged.get(tokenName);
      if (previous && isDarkChannelTokenValue(previous) && !isDarkChannelTokenValue(value)) {
        continue;
      }
      merged.set(tokenName, value);
    }
  }
  return merged;
}

function applyDarkDocumentLocalTokenOverrides(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot?.ownerDocument?.createTreeWalker) {
    return null;
  }

  const budget = options.localTokenBudget && typeof options.localTokenBudget === 'object'
    ? options.localTokenBudget
    : DARK_LOCAL_TOKEN_SCAN_BUDGET;
  const maxNodes = Number.isFinite(budget.maxNodes)
    ? Math.max(0, Math.floor(budget.maxNodes))
    : DARK_LOCAL_TOKEN_SCAN_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? Math.max(0, budget.maxMs) : DARK_LOCAL_TOKEN_SCAN_BUDGET.maxMs;
  const maxOverrides = Number.isFinite(budget.maxOverrides)
    ? Math.max(0, Math.floor(budget.maxOverrides))
    : DARK_LOCAL_TOKEN_SCAN_BUDGET.maxOverrides;
  const view = scopeRoot.ownerDocument.defaultView || globalThis;
  const authoredRuleCache = collectDarkAuthoredCustomPropertyRules(scopeRoot.ownerDocument);
  const startedAt = darkNowMs();
  let scanned = 0;
  let candidates = 0;
  let overridden = 0;
  let customHosts = 0;
  let tokenProperties = 0;
  let inferredTokenProperties = 0;
  let targetMatches = 0;
  let skippedWithoutTokens = 0;
  let documentTokenHosts = 0;
  let budgetHit = false;
  const preAppliedHosts = new Set();

  const applyTokenOverrides = (element, options = {}) => {
    if (!element?.style || typeof element.style.setProperty !== 'function') {
      return;
    }
    const authoredCustomProperties = options.authoredCustomProperties || collectDarkAuthoredCustomPropertiesForElement(
      element,
      { authoredRuleCache },
    );
    const explicitOverrides = [];
    for (const [property, value] of DARK_DOCUMENT_LOCAL_TOKEN_MAP) {
      const tokenName = normalizeDarkLocalTokenName(property);
      const rawValue = readDarkInlineValue(element.style, property).value;
      const authoredValue = authoredCustomProperties.get(tokenName) || '';
      if (!rawValue && !authoredValue) {
        continue;
      }
      const computedValue = typeof options.computedStyle?.getPropertyValue === 'function'
        ? options.computedStyle.getPropertyValue(property)
        : '';
      const replacement = getDarkExplicitLocalTokenReplacement(property, value, rawValue, computedValue, authoredValue);
      explicitOverrides.push([property, replacement]);
    }
    const inferredOverrides = getDarkInferredLocalTokenOverrides(
      element,
      options.computedStyle || null,
      authoredCustomProperties,
    );
    if (options.customHost === true && explicitOverrides.length === 0 && inferredOverrides.length === 0) {
      for (const [property, value] of DARK_DOCUMENT_LOCAL_TOKEN_MAP) {
        explicitOverrides.push([property, value]);
      }
    }
    if (explicitOverrides.length === 0 && inferredOverrides.length === 0) {
      skippedWithoutTokens += 1;
      return;
    }

    candidates += 1;
    if (options.customHost === true) {
      customHosts += 1;
    }
    for (const [property, replacement] of explicitOverrides) {
      prepareDarkDocumentInlineOverride(element, property);
      element.style.setProperty(property, replacement, 'important');
      rememberDarkDocumentInlineOverride(element, property, replacement, 'important');
      tokenProperties += 1;
    }
    for (const [property, value] of inferredOverrides) {
      prepareDarkDocumentInlineOverride(element, property);
      element.style.setProperty(property, value, 'important');
      rememberDarkDocumentInlineOverride(element, property, value, 'important');
      tokenProperties += 1;
      inferredTokenProperties += 1;
    }
    darkDocumentInlineOverrideState.touched.add(element);
    overridden += 1;
  };

  const applyDocumentTokenHost = (element, authoredCustomProperties = null) => {
    if (!element || preAppliedHosts.has(element)) {
      return;
    }
    const resolvedAuthoredCustomProperties = authoredCustomProperties || collectDarkAuthoredCustomPropertiesForElement(
      element,
      { authoredRuleCache },
    );
    if (!hasDarkTransformableAuthoredToken(resolvedAuthoredCustomProperties)) {
      return;
    }
    targetMatches += 1;
    documentTokenHosts += 1;
    const computedStyle = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
    applyTokenOverrides(element, { authoredCustomProperties: resolvedAuthoredCustomProperties, computedStyle });
    preAppliedHosts.add(element);
  };

  try {
    const documentElement = scopeRoot.ownerDocument.documentElement || null;
    const bodyElement = scopeRoot.ownerDocument.body || null;
    const rootAuthoredProperties = documentElement
      ? collectDarkAuthoredCustomPropertiesForElement(documentElement, { authoredRuleCache })
      : new Map();
    applyDocumentTokenHost(documentElement, rootAuthoredProperties);
    if (bodyElement && bodyElement !== documentElement) {
      const bodyAuthoredProperties = collectDarkAuthoredCustomPropertiesForElement(bodyElement, { authoredRuleCache });
      applyDocumentTokenHost(
        bodyElement,
        mergeDarkAuthoredCustomProperties(rootAuthoredProperties, bodyAuthoredProperties),
      );
    }

    const walker = scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1);
    let node = walker.currentNode;
    while (node) {
      if (scanned >= maxNodes || overridden >= maxOverrides || darkNowMs() - startedAt > maxMs) {
        budgetHit = true;
        break;
      }

      const element = node.nodeType === 1 ? node : null;
      scanned += 1;
      if (element && !preAppliedHosts.has(element) && !isDarkShadowProtectedElement(element)) {
        const isLocalTokenTarget =
          typeof element.matches === 'function'
          && element.matches(DARK_DOCUMENT_LOCAL_TOKEN_SELECTOR);
        const isCustomHostTarget = isDarkCustomElementHost(element);
        const isTokenConsumerTarget = isDarkLocalTokenConsumerElement(element);
        if (isLocalTokenTarget || isCustomHostTarget || isTokenConsumerTarget) {
          targetMatches += 1;
          const computedStyle = typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
          applyTokenOverrides(element, { customHost: isCustomHostTarget, computedStyle });
        }
      }

      node = walker.nextNode();
    }
  } catch (error) {
    getLogger(options)(`Document local token dark fallback failed (${source})`, error);
    return {
      ok: false,
      scanned,
      candidates,
      customHosts,
      overridden,
      tokenProperties,
      inferredTokenProperties,
      targetMatches,
      skippedWithoutTokens,
      documentTokenHosts,
      reason: 'document-local-token-fallback-failed',
    };
  }

  return {
    ok: true,
    scanned,
    candidates,
    customHosts,
    overridden,
    tokenProperties,
    inferredTokenProperties,
    targetMatches,
    skippedWithoutTokens,
    documentTokenHosts,
    budgetHit,
  };
}

function applyDarkShadowRootStyles(scopeRoot, source = 'apply', options = {}) {
  if (!scopeRoot) {
    return null;
  }

  try {
    const budget = options.shadowBudget || DARK_SHADOW_SCAN_BUDGET;
    const collected = collectOpenShadowRoots(scopeRoot, budget);
    let injected = 0;
    let updated = 0;
    let reordered = 0;

    for (const shadowRoot of collected.roots) {
      const cssText = buildDarkShadowRootCss(shadowRoot);
      const existing = findDarkShadowStyle(shadowRoot);
      if (existing) {
        if (existing.textContent !== cssText) {
          existing.textContent = cssText;
          updated += 1;
        }
        if (ensureDarkShadowStyleLast(shadowRoot, existing)) {
          reordered += 1;
        }
        darkShadowStyleNodes.add(existing);
        continue;
      }

      const style = createDarkShadowStyleNode(shadowRoot);
      if (!style) {
        continue;
      }
      shadowRoot.appendChild(style);
      darkShadowStyleNodes.add(style);
      injected += 1;
    }

    const inlineOverrides = applyDarkShadowRootInlineOverrides(collected.roots, options);
    const iconOverrideResults = collected.roots
      .map((shadowRoot) => applyDarkIconOverrides(shadowRoot, `${source}:shadow`, options))
      .filter(Boolean);
    const iconOverrides = iconOverrideResults.length
      ? {
          ok: iconOverrideResults.every((result) => result.ok !== false),
          rootsSeen: iconOverrideResults.length,
          scanned: iconOverrideResults.reduce((total, result) => total + (Number(result.scanned) || 0), 0),
          overridden: iconOverrideResults.reduce((total, result) => total + (Number(result.overridden) || 0), 0),
          paintOverrides: iconOverrideResults.reduce((total, result) => total + (Number(result.paintOverrides) || 0), 0),
          maskOverrides: iconOverrideResults.reduce((total, result) => total + (Number(result.maskOverrides) || 0), 0),
          budgetHit: iconOverrideResults.some((result) => result.budgetHit === true),
        }
      : null;

    return {
      ok: true,
      source,
      nodesSeen: collected.nodesSeen,
      rootsSeen: collected.roots.length,
      injected,
      updated,
      reordered,
      inlineOverrides,
      iconOverrides,
      budgetHit: collected.budgetHit === true
        || inlineOverrides?.budgetHit === true
        || iconOverrides?.budgetHit === true,
    };
  } catch (error) {
    getLogger(options)(`Dark shadow root styling failed (${source})`, error);
    return { ok: false, reason: 'dark-shadow-root-style-failed' };
  }
}

function clearDarkShadowRootStyles(source = 'cleanup', options = {}) {
  let removed = 0;
  for (const style of Array.from(darkShadowStyleNodes)) {
    try {
      if (style?.parentNode && typeof style.parentNode.removeChild === 'function') {
        style.parentNode.removeChild(style);
        removed += 1;
      } else if (typeof style?.remove === 'function') {
        style.remove();
        removed += 1;
      }
    } catch (error) {
      getLogger(options)(`Dark shadow root cleanup failed (${source})`, error);
    }
  }
  darkShadowStyleNodes = new Set();
  return { ok: true, source, removed };
}

function parseCssColor(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const value = rawValue.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'currentcolor') {
    return null;
  }

  const named = DARK_NAMED_CSS_COLORS[value];
  if (named) {
    return { r: named[0], g: named[1], b: named[2], alpha: 1 };
  }

  const rgbArgs = getDarkCssFunctionArgs(value, 'rgb') || getDarkCssFunctionArgs(value, 'rgba');
  if (rgbArgs != null) {
    const parts = parseDarkColorFunctionParts(rgbArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const channels = parts.channels.slice(0, 3).map((part) => parseDarkRgbChannel(part));
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (channels.some((part) => !Number.isFinite(part)) || !Number.isFinite(alpha)) {
      return null;
    }
    return { r: channels[0], g: channels[1], b: channels[2], alpha };
  }

  const hslArgs = getDarkCssFunctionArgs(value, 'hsl') || getDarkCssFunctionArgs(value, 'hsla');
  if (hslArgs != null) {
    const parts = parseDarkColorFunctionParts(hslArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const hue = parseDarkHue(parts.channels[0]);
    const saturation = parseDarkPercentage(parts.channels[1]);
    const lightness = parseDarkPercentage(parts.channels[2]);
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (![hue, saturation, lightness, alpha].every(Number.isFinite)) {
      return null;
    }
    const rgbColor = hslToDarkRgb(hue, saturation, lightness);
    return { ...rgbColor, alpha };
  }

  const labArgs = getDarkCssFunctionArgs(value, 'lab');
  if (labArgs != null) {
    const parts = parseDarkColorFunctionParts(labArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const lightness = parseDarkLightness(parts.channels[0]);
    const a = parseDarkLabAxis(parts.channels[1]);
    const b = parseDarkLabAxis(parts.channels[2]);
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (![lightness, a, b, alpha].every(Number.isFinite)) {
      return null;
    }
    const rgbColor = labToDarkRgb(lightness, a, b);
    return { ...rgbColor, alpha };
  }

  const lchArgs = getDarkCssFunctionArgs(value, 'lch');
  if (lchArgs != null) {
    const parts = parseDarkColorFunctionParts(lchArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const lightness = parseDarkLightness(parts.channels[0]);
    const chroma = parseDarkLchChroma(parts.channels[1]);
    const hue = parseDarkHue(parts.channels[2]);
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (![lightness, chroma, hue, alpha].every(Number.isFinite)) {
      return null;
    }
    const rgbColor = lchToDarkRgb(lightness, chroma, hue);
    return { ...rgbColor, alpha };
  }

  const oklabArgs = getDarkCssFunctionArgs(value, 'oklab');
  if (oklabArgs != null) {
    const parts = parseDarkColorFunctionParts(oklabArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const lightness = parseDarkLightness(parts.channels[0]);
    const a = parseDarkOklabAxis(parts.channels[1]);
    const b = parseDarkOklabAxis(parts.channels[2]);
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (![lightness, a, b, alpha].every(Number.isFinite)) {
      return null;
    }
    const rgbColor = oklabToDarkRgb(lightness, a, b);
    return { ...rgbColor, alpha };
  }

  const oklchArgs = getDarkCssFunctionArgs(value, 'oklch');
  if (oklchArgs != null) {
    const parts = parseDarkColorFunctionParts(oklchArgs);
    if (parts.channels.length < 3) {
      return null;
    }
    const lightness = parseDarkLightness(parts.channels[0]);
    const chroma = parseDarkOklchChroma(parts.channels[1]);
    const hue = parseDarkHue(parts.channels[2]);
    const alpha = parts.alpha != null ? parseDarkAlpha(parts.alpha) : 1;
    if (![lightness, chroma, hue, alpha].every(Number.isFinite)) {
      return null;
    }
    const rgbColor = oklchToDarkRgb(lightness, chroma, hue);
    return { ...rgbColor, alpha };
  }

  const colorFunctionArgs = getDarkCssFunctionArgs(value, 'color');
  if (colorFunctionArgs != null) {
    return parseDarkCssColorFunctionColor(colorFunctionArgs);
  }

  const lightDarkArgs = getDarkCssFunctionArgs(value, 'light-dark');
  if (lightDarkArgs != null) {
    return parseDarkLightDarkColor(lightDarkArgs);
  }

  const colorMixArgs = getDarkCssFunctionArgs(value, 'color-mix');
  if (colorMixArgs != null) {
    return parseDarkColorMix(colorMixArgs);
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        alpha: 1,
      };
    }
    if (hex.length === 4) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        alpha: Number.parseInt(hex[3] + hex[3], 16) / 255,
      };
    }
    if (hex.length === 6) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        alpha: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        alpha: Number.parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  return null;
}

function getDarkCssFunctionArgs(value, functionName) {
  const normalized = String(value || '').trim();
  const prefix = `${functionName}(`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(')')) {
    return null;
  }

  let depth = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0 || (depth === 0 && index !== normalized.length - 1)) {
        return null;
      }
    }
  }

  return depth === 0 ? normalized.slice(prefix.length, -1).trim() : null;
}

function parseDarkColorFunctionParts(rawArgs = '') {
  const value = String(rawArgs || '').trim();
  const slashParts = value.split('/');
  const channelText = slashParts[0] || '';
  const alphaText = slashParts.length > 1 ? slashParts.slice(1).join('/').trim() : null;
  const channels = channelText.includes(',')
    ? channelText.split(',').map((part) => part.trim()).filter(Boolean)
    : channelText.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const alpha = alphaText != null && alphaText
    ? alphaText
    : channels.length >= 4
      ? channels[3]
      : null;
  return {
    channels: channels.slice(0, 3),
    alpha,
  };
}

function clampDarkNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(max, Math.max(min, value));
}

function parseDarkRgbChannel(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber((Number.parseFloat(value) / 100) * 255, 0, 255);
  }
  return clampDarkNumber(Number.parseFloat(value), 0, 255);
}

function parseDarkAlpha(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber(Number.parseFloat(value) / 100, 0, 1);
  }
  return clampDarkNumber(Number.parseFloat(value), 0, 1);
}

function parseDarkPercentage(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber(Number.parseFloat(value) / 100, 0, 1);
  }
  const numeric = Number.parseFloat(value);
  return clampDarkNumber(numeric > 1 ? numeric / 100 : numeric, 0, 1);
}

function parseDarkLightness(rawValue = '') {
  return parseDarkPercentage(rawValue);
}

function parseDarkOklabAxis(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber((Number.parseFloat(value) / 100) * 0.4, -0.5, 0.5);
  }
  return clampDarkNumber(Number.parseFloat(value), -0.5, 0.5);
}

function parseDarkLabAxis(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber((Number.parseFloat(value) / 100) * 125, -160, 160);
  }
  return clampDarkNumber(Number.parseFloat(value), -160, 160);
}

function parseDarkOklchChroma(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber((Number.parseFloat(value) / 100) * 0.4, 0, 0.5);
  }
  return clampDarkNumber(Number.parseFloat(value), 0, 0.5);
}

function parseDarkLchChroma(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value) {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber((Number.parseFloat(value) / 100) * 150, 0, 200);
  }
  return clampDarkNumber(Number.parseFloat(value), 0, 200);
}

function parseDarkUnitColorChannel(rawValue = '') {
  const value = String(rawValue || '').trim();
  if (!value || value === 'none') {
    return NaN;
  }
  if (value.endsWith('%')) {
    return clampDarkNumber(Number.parseFloat(value) / 100, 0, 1);
  }
  return clampDarkNumber(Number.parseFloat(value), 0, 1);
}

function parseDarkCssColorFunctionColor(rawArgs = '') {
  const value = String(rawArgs || '').trim();
  if (!value) {
    return null;
  }

  const slashParts = value.split('/');
  const channelText = slashParts[0] || '';
  const alphaText = slashParts.length > 1 ? slashParts.slice(1).join('/').trim() : null;
  const tokens = channelText.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  const colorSpace = (tokens.shift() || '').toLowerCase();
  const supportedColorSpaces = new Set(['srgb', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020']);
  if (!supportedColorSpaces.has(colorSpace) || tokens.length < 3) {
    return null;
  }

  const channels = tokens.slice(0, 3).map((part) => parseDarkUnitColorChannel(part));
  const alpha = alphaText
    ? parseDarkAlpha(alphaText)
    : tokens.length >= 4
      ? parseDarkAlpha(tokens[3])
      : 1;
  if (channels.some((part) => !Number.isFinite(part)) || !Number.isFinite(alpha)) {
    return null;
  }

  return {
    r: clampDarkNumber(Math.round(channels[0] * 255), 0, 255),
    g: clampDarkNumber(Math.round(channels[1] * 255), 0, 255),
    b: clampDarkNumber(Math.round(channels[2] * 255), 0, 255),
    alpha,
  };
}

function splitDarkTopLevelArgs(rawArgs = '') {
  const args = [];
  let current = '';
  let depth = 0;
  for (const char of String(rawArgs || '')) {
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (char === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        args.push(trimmed);
      }
      current = '';
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) {
    args.push(trimmed);
  }
  return args;
}

function parseDarkLightDarkColor(rawArgs = '') {
  const args = splitDarkTopLevelArgs(rawArgs);
  if (args.length < 2) {
    return null;
  }
  return extractDarkCssColor(args[1]) || extractDarkCssColor(args[0]);
}

function parseDarkColorMixStop(rawStop = '') {
  const stop = String(rawStop || '').trim();
  const color = extractDarkCssColor(stop);
  if (!color) {
    return null;
  }
  const percentageMatch = stop.match(/(-?\d*\.?\d+)%\s*$/);
  const weight = percentageMatch
    ? clampDarkNumber(Number.parseFloat(percentageMatch[1]) / 100, 0, 1)
    : null;
  return { color, weight };
}

function parseDarkColorMix(rawArgs = '') {
  const args = splitDarkTopLevelArgs(rawArgs);
  if (args.length < 3 || !/^in\s+/i.test(args[0])) {
    return null;
  }

  const first = parseDarkColorMixStop(args[1]);
  const second = parseDarkColorMixStop(args[2]);
  if (!first || !second) {
    return null;
  }

  let firstWeight = first.weight;
  let secondWeight = second.weight;
  if (firstWeight == null && secondWeight == null) {
    firstWeight = 0.5;
    secondWeight = 0.5;
  } else if (firstWeight == null) {
    firstWeight = clampDarkNumber(1 - secondWeight, 0, 1);
  } else if (secondWeight == null) {
    secondWeight = clampDarkNumber(1 - firstWeight, 0, 1);
  }

  const total = firstWeight + secondWeight;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const normalizedFirst = firstWeight / total;
  const normalizedSecond = secondWeight / total;
  return {
    r: clampDarkNumber(Math.round(first.color.r * normalizedFirst + second.color.r * normalizedSecond), 0, 255),
    g: clampDarkNumber(Math.round(first.color.g * normalizedFirst + second.color.g * normalizedSecond), 0, 255),
    b: clampDarkNumber(Math.round(first.color.b * normalizedFirst + second.color.b * normalizedSecond), 0, 255),
    alpha: clampDarkNumber(first.color.alpha * normalizedFirst + second.color.alpha * normalizedSecond, 0, 1),
  };
}

function parseDarkHue(rawValue = '') {
  const value = String(rawValue || '').trim().toLowerCase();
  if (!value) {
    return NaN;
  }
  let degrees = Number.parseFloat(value);
  if (!Number.isFinite(degrees)) {
    return NaN;
  }
  if (value.endsWith('turn')) {
    degrees *= 360;
  } else if (value.endsWith('rad')) {
    degrees *= 180 / Math.PI;
  } else if (value.endsWith('grad')) {
    degrees *= 0.9;
  }
  degrees %= 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

function hslToDarkRgb(hueDegrees, saturation, lightness) {
  const hue = hueDegrees / 360;
  if (saturation <= 0) {
    const channel = clampDarkNumber(Math.round(lightness * 255), 0, 255);
    return { r: channel, g: channel, b: channel };
  }
  const hueToRgb = (p, q, t) => {
    let normalized = t;
    if (normalized < 0) normalized += 1;
    if (normalized > 1) normalized -= 1;
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
    if (normalized < 1 / 2) return q;
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
    return p;
  };
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return {
    r: clampDarkNumber(Math.round(hueToRgb(p, q, hue + 1 / 3) * 255), 0, 255),
    g: clampDarkNumber(Math.round(hueToRgb(p, q, hue) * 255), 0, 255),
    b: clampDarkNumber(Math.round(hueToRgb(p, q, hue - 1 / 3) * 255), 0, 255),
  };
}

function labToDarkRgb(lightness, a, b) {
  const l = lightness * 100;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const convert = (value) => {
    const cubed = value ** 3;
    return cubed > epsilon ? cubed : (116 * value - 16) / kappa;
  };

  const xD50 = 0.96422 * convert(fx);
  const yD50 = convert(fy);
  const zD50 = 0.82521 * convert(fz);

  const xD65 = 0.9555766 * xD50 - 0.0230393 * yD50 + 0.0631636 * zD50;
  const yD65 = -0.0282895 * xD50 + 1.0099416 * yD50 + 0.0210077 * zD50;
  const zD65 = 0.0122982 * xD50 - 0.0204830 * yD50 + 1.3299098 * zD50;

  return {
    r: linearDarkSrgbToByte(3.2404542 * xD65 - 1.5371385 * yD65 - 0.4985314 * zD65),
    g: linearDarkSrgbToByte(-0.9692660 * xD65 + 1.8760108 * yD65 + 0.0415560 * zD65),
    b: linearDarkSrgbToByte(0.0556434 * xD65 - 0.2040259 * yD65 + 1.0572252 * zD65),
  };
}

function lchToDarkRgb(lightness, chroma, hueDegrees) {
  const hue = (hueDegrees * Math.PI) / 180;
  return labToDarkRgb(
    lightness,
    chroma * Math.cos(hue),
    chroma * Math.sin(hue),
  );
}

function linearDarkSrgbToByte(channel) {
  const clamped = clampDarkNumber(channel, 0, 1);
  const encoded = clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
  return clampDarkNumber(Math.round(encoded * 255), 0, 255);
}

function oklabToDarkRgb(lightness, a, b) {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b;

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  return {
    r: linearDarkSrgbToByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearDarkSrgbToByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearDarkSrgbToByte(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  };
}

function oklchToDarkRgb(lightness, chroma, hueDegrees) {
  const hue = (hueDegrees * Math.PI) / 180;
  return oklabToDarkRgb(
    lightness,
    chroma * Math.cos(hue),
    chroma * Math.sin(hue),
  );
}

function isDarkCssIdentifierChar(char) {
  return /[a-z0-9_-]/i.test(String(char || ''));
}

function findDarkCssFunctionEnd(value, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }
  return -1;
}

function collectDarkCssColorTokens(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  if (!value) {
    return [];
  }

  const colorFunctionNames = [
    'color-mix',
    'light-dark',
    'oklch',
    'oklab',
    'rgba',
    'rgb',
    'hsla',
    'hsl',
    'lab',
    'lch',
    'color',
  ];
  const mediaFunctionNames = [
    '-webkit-cross-fade',
    '-webkit-image-set',
    'cross-fade',
    'image-set',
    'url',
    'element',
    'paint',
  ];
  const tokens = [];

  for (let index = 0; index < value.length; index += 1) {
    const previous = index > 0 ? value[index - 1] : '';
    if (previous && isDarkCssIdentifierChar(previous)) {
      continue;
    }

    let skippedMediaFunction = false;
    for (const functionName of mediaFunctionNames) {
      const prefix = `${functionName}(`;
      if (!value.startsWith(prefix, index)) {
        continue;
      }
      const openParenIndex = index + functionName.length;
      const end = findDarkCssFunctionEnd(value, openParenIndex);
      if (end > index) {
        index = end;
        skippedMediaFunction = true;
        break;
      }
    }
    if (skippedMediaFunction) {
      continue;
    }

    let matched = false;
    for (const functionName of colorFunctionNames) {
      const prefix = `${functionName}(`;
      if (!value.startsWith(prefix, index)) {
        continue;
      }
      const openParenIndex = index + functionName.length;
      const end = findDarkCssFunctionEnd(value, openParenIndex);
      if (end <= index) {
        continue;
      }
      tokens.push(value.slice(index, end + 1));
      index = end;
      matched = true;
      break;
    }
    if (matched) {
      continue;
    }

    if (value[index] === '#') {
      const hexMatch = value.slice(index).match(/^#[0-9a-f]{3,8}\b/i);
      if (hexMatch) {
        tokens.push(hexMatch[0]);
        index += hexMatch[0].length - 1;
      }
      continue;
    }

    if (/[a-z]/i.test(value[index])) {
      const wordMatch = value.slice(index).match(/^[a-z]+/i);
      const word = wordMatch?.[0] || '';
      if (word && DARK_NAMED_CSS_COLORS[word]) {
        tokens.push(word);
      }
      if (word) {
        index += word.length - 1;
      }
    }
  }

  return tokens;
}

function extractDarkCssColors(rawValue) {
  const direct = parseCssColor(rawValue);
  if (direct) {
    return [direct];
  }

  return collectDarkCssColorTokens(rawValue)
    .map((token) => parseCssColor(token))
    .filter(Boolean);
}

function extractDarkCssColor(rawValue) {
  return extractDarkCssColors(rawValue)[0] || null;
}

function relativeLuminance(color) {
  if (!color) {
    return null;
  }
  const normalize = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * normalize(color.r) + 0.7152 * normalize(color.g) + 0.0722 * normalize(color.b);
}

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  if (!Number.isFinite(fg) || !Number.isFinite(bg)) {
    return null;
  }
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function isVisibleElement(element, style) {
  if (!element || element.isConnected === false || !style) {
    return false;
  }
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  if (!rect) {
    return true;
  }
  return (Number(rect.width) || 0) > 0 && (Number(rect.height) || 0) > 0;
}

function getComputedStyleSafe(scopeRoot, element) {
  const view = scopeRoot?.ownerDocument?.defaultView || globalThis;
  return typeof view.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
}

function getReadableBackground(scopeRoot, element) {
  let current = element;
  while (current) {
    const style = getComputedStyleSafe(scopeRoot, current);
    const color = parseCssColor(style?.backgroundColor || '');
    if (color && color.alpha !== 0) {
      return color;
    }
    if (current === scopeRoot) {
      break;
    }
    current = current.parentElement;
  }

  const rootStyle = getComputedStyleSafe(scopeRoot, scopeRoot);
  const tokenBg = rootStyle?.getPropertyValue?.('--aura-bg-color');
  return parseCssColor(tokenBg || '') || parseCssColor(rootStyle?.backgroundColor || '') || parseCssColor('#0b1020');
}

function minNumber(values = []) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.min(...finite) : null;
}

function hasValidCleanupManifest(manifest) {
  const attrs = Array.isArray(manifest?.attributes) ? manifest.attributes : [];
  return manifest?.rollbackRequired === true
    && manifest?.inlineOverrides?.restorable === true
    && attrs.includes('data-aura-surface')
    && attrs.includes('data-aura-surface-kind')
    && attrs.includes('data-aura-force-text');
}

function collectPostCheckElements(scopeRoot, selector, limit, budget, stats) {
  const elements = [];
  const maxNodes = Number.isFinite(budget.maxNodes) ? budget.maxNodes : DARK_POSTCHECK_BUDGET.maxNodes;
  const maxMs = Number.isFinite(budget.maxMs) ? budget.maxMs : DARK_POSTCHECK_BUDGET.maxMs;
  const startedAt = stats.startedAt;

  const push = (element) => {
    if (!element || elements.length >= limit) {
      return;
    }
    elements.push(element);
  };

  try {
    if (typeof scopeRoot.matches === 'function' && scopeRoot.matches(selector)) {
      push(scopeRoot);
    }
    if (typeof scopeRoot.querySelectorAll === 'function') {
      const matches = scopeRoot.querySelectorAll(selector);
      for (const element of matches) {
        stats.nodesScanned += 1;
        if (stats.nodesScanned > maxNodes || Date.now() - startedAt > maxMs) {
          stats.budgetHit = true;
          break;
        }
        push(element);
        if (elements.length >= limit) {
          break;
        }
      }
    }
  } catch (_) {
    return elements;
  }

  return elements;
}

function sampleTextContrast(scopeRoot, selector, limit, budget, stats, largeOnly = false) {
  const elements = collectPostCheckElements(scopeRoot, selector, limit, budget, stats);
  const ratios = [];
  elements.forEach((element) => {
    if (typeof element.textContent === 'string' && element.textContent.trim().length === 0) {
      return;
    }
    const style = getComputedStyleSafe(scopeRoot, element);
    if (!isVisibleElement(element, style)) {
      return;
    }
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    if (largeOnly && fontSize < 18) {
      return;
    }
    const foreground = parseCssColor(style.color || '');
    const background = getReadableBackground(scopeRoot, element);
    const ratio = contrastRatio(foreground, background);
    if (Number.isFinite(ratio)) {
      ratios.push(ratio);
    }
  });
  return minNumber(ratios);
}

function inspectLinks(scopeRoot, budget, stats) {
  const links = collectPostCheckElements(scopeRoot, 'a[href], [role="link"]', DARK_POSTCHECK_BUDGET.linkSamples, budget, stats);
  if (!links.length) {
    return { ok: true, linkContrast: null, linkDistinct: null };
  }
  const linkRatios = [];
  const distinctionRatios = [];
  links.forEach((link) => {
    const style = getComputedStyleSafe(scopeRoot, link);
    if (!isVisibleElement(link, style)) {
      return;
    }
    const linkColor = parseCssColor(style.color || '');
    const background = getReadableBackground(scopeRoot, link);
    const rootText = parseCssColor(getComputedStyleSafe(scopeRoot, scopeRoot)?.color || '') || parseCssColor('#e6e6e6');
    const linkRatio = contrastRatio(linkColor, background);
    const distinctRatio = contrastRatio(linkColor, rootText);
    if (Number.isFinite(linkRatio)) linkRatios.push(linkRatio);
    if (Number.isFinite(distinctRatio)) distinctionRatios.push(distinctRatio);
  });
  const linkContrast = minNumber(linkRatios);
  const linkDistinct = minNumber(distinctionRatios);
  return {
    ok: linkContrast == null || (
      linkContrast >= DARK_POSTCHECK_THRESHOLDS.linkContrast
      && (linkDistinct == null || linkDistinct >= DARK_POSTCHECK_THRESHOLDS.linkDistinct)
    ),
    linkContrast,
    linkDistinct,
  };
}

function inspectControls(scopeRoot, budget, stats) {
  const controls = collectPostCheckElements(scopeRoot, 'input, textarea, select, button', DARK_POSTCHECK_BUDGET.controlSamples, budget, stats);
  if (!controls.length) {
    return { controlsVisible: true, placeholdersReadable: true, controlTextContrast: null };
  }
  const ratios = [];
  let visibleSamples = 0;
  controls.forEach((control) => {
    const style = getComputedStyleSafe(scopeRoot, control);
    if (!isVisibleElement(control, style)) {
      return;
    }
    visibleSamples += 1;
    const ratio = contrastRatio(parseCssColor(style.color || ''), getReadableBackground(scopeRoot, control));
    if (Number.isFinite(ratio)) {
      ratios.push(ratio);
    }
  });
  const controlTextContrast = minNumber(ratios);
  if (visibleSamples === 0) {
    return { controlsVisible: true, placeholdersReadable: true, controlTextContrast: null };
  }
  return {
    controlsVisible: controlTextContrast == null || controlTextContrast >= DARK_POSTCHECK_THRESHOLDS.controlTextContrast,
    placeholdersReadable: controlTextContrast == null || controlTextContrast >= DARK_POSTCHECK_THRESHOLDS.largeTextContrast,
    controlTextContrast,
  };
}

function inspectCode(scopeRoot, budget, stats) {
  const code = collectPostCheckElements(scopeRoot, 'pre, code, kbd, samp', DARK_POSTCHECK_BUDGET.codeSamples, budget, stats);
  if (!code.length) {
    return { codeReadable: true, codeContrast: null };
  }
  const contrast = sampleTextContrast(scopeRoot, 'pre, code, kbd, samp', DARK_POSTCHECK_BUDGET.codeSamples, budget, stats);
  return {
    codeReadable: contrast == null || contrast >= DARK_POSTCHECK_THRESHOLDS.codeContrast,
    codeContrast: contrast,
  };
}

function inspectMedia(scopeRoot, budget, stats) {
  const media = collectPostCheckElements(scopeRoot, 'img, video, canvas, iframe, picture, object, embed', DARK_POSTCHECK_BUDGET.mediaSamples, budget, stats);
  let mediaPreserved = true;
  media.forEach((element) => {
    const style = getComputedStyleSafe(scopeRoot, element);
    const filter = `${style?.filter || ''}`.toLowerCase();
    if (!isVisibleElement(element, style) || filter.includes('invert(')) {
      mediaPreserved = false;
    }
  });
  const svgs = collectPostCheckElements(scopeRoot, 'svg', DARK_POSTCHECK_BUDGET.svgSamples, budget, stats);
  let svgVisible = true;
  svgs.forEach((element) => {
    const style = getComputedStyleSafe(scopeRoot, element);
    if (!isVisibleElement(element, style)) {
      svgVisible = false;
    }
  });
  return { mediaPreserved, svgVisible };
}

function inspectLayout(scopeRoot, options, budget, stats) {
  const baseline = options.postCheckBaseline && typeof options.postCheckBaseline === 'object'
    ? options.postCheckBaseline
    : {};
  const baselineOverflow = typeof baseline.horizontalOverflow === 'number' ? baseline.horizontalOverflow : 0;
  const currentOverflow = Math.max(
    0,
    Number(scopeRoot.scrollWidth || 0) - Number(scopeRoot.clientWidth || 0),
    Number(scopeRoot.ownerDocument?.documentElement?.scrollWidth || 0) - Number(scopeRoot.ownerDocument?.documentElement?.clientWidth || 0),
  );
  const noHorizontalScrollRegression = currentOverflow <= baselineOverflow + 8;
  const textNodes = collectPostCheckElements(scopeRoot, 'p, li, blockquote, pre, code', DARK_POSTCHECK_BUDGET.textSamples, budget, stats);
  let noClippedTextRegression = true;
  textNodes.forEach((element) => {
    const style = getComputedStyleSafe(scopeRoot, element);
    if (!isVisibleElement(element, style)) {
      return;
    }
    if (Number(element.scrollHeight || 0) > Number(element.clientHeight || element.scrollHeight || 0) + 2) {
      noClippedTextRegression = false;
    }
  });
  return { noHorizontalScrollRegression, noClippedTextRegression };
}

function inspectFocusRing(scopeRoot) {
  const rootStyle = getComputedStyleSafe(scopeRoot, scopeRoot);
  const focusColor = parseCssColor(rootStyle?.getPropertyValue?.('--aura-focus-color') || rootStyle?.outlineColor || '');
  const background = getReadableBackground(scopeRoot, scopeRoot);
  const ratio = contrastRatio(focusColor, background);
  return {
    focusRingVisible: ratio == null || ratio >= DARK_POSTCHECK_THRESHOLDS.nonTextContrast,
    focusRingContrast: ratio,
  };
}

function evaluateDarkPostCheckReport(report) {
  const failures = [];
  if (!Number.isFinite(report.textContrast) || report.textContrast < DARK_POSTCHECK_THRESHOLDS.textContrast) {
    failures.push('textContrast');
  }
  if (Number.isFinite(report.largeTextContrast) && report.largeTextContrast < DARK_POSTCHECK_THRESHOLDS.largeTextContrast) {
    failures.push('largeTextContrast');
  }
  [
    'linksDistinct',
    'controlsVisible',
    'focusRingVisible',
    'placeholdersReadable',
    'codeReadable',
    'mediaPreserved',
    'svgVisible',
    'noHorizontalScrollRegression',
    'noClippedTextRegression',
    'cleanupExact',
  ].forEach((key) => {
    if (report[key] !== true) failures.push(key);
  });
  return failures;
}

function runDarkComfortThemePostCheck(scopeRoot, options = {}) {
  const budget = options.postCheckBudget && typeof options.postCheckBudget === 'object'
    ? options.postCheckBudget
    : DARK_POSTCHECK_BUDGET;
  const stats = { nodesScanned: 0, startedAt: Date.now(), budgetHit: false };

  if (!scopeRoot || !scopeRoot.ownerDocument?.defaultView) {
    return {
      ok: false,
      postCheckPassed: false,
      failures: ['scopeUnavailable'],
      budgetHit: false,
      cleanupExact: hasValidCleanupManifest(options.manifest || activeCleanupManifest),
    };
  }

  const textContrast = sampleTextContrast(scopeRoot, 'p, li, blockquote, span, a, h1, h2, h3, h4, h5, h6', DARK_POSTCHECK_BUDGET.textSamples, budget, stats)
    ?? sampleTextContrast(scopeRoot, '*', 1, budget, stats);
  const largeTextContrast = sampleTextContrast(scopeRoot, 'h1, h2, h3, h4, h5, h6, [role="heading"]', 8, budget, stats);
  const links = inspectLinks(scopeRoot, budget, stats);
  const controls = inspectControls(scopeRoot, budget, stats);
  const code = inspectCode(scopeRoot, budget, stats);
  const media = inspectMedia(scopeRoot, budget, stats);
  const layout = inspectLayout(scopeRoot, options, budget, stats);
  const focus = inspectFocusRing(scopeRoot);

  const report = {
    version: 1,
    textContrast: textContrast ?? 0,
    largeTextContrast,
    linksDistinct: links.ok,
    linkContrast: links.linkContrast,
    linkDistinct: links.linkDistinct,
    controlsVisible: controls.controlsVisible,
    controlTextContrast: controls.controlTextContrast,
    focusRingVisible: focus.focusRingVisible,
    focusRingContrast: focus.focusRingContrast,
    placeholdersReadable: controls.placeholdersReadable,
    codeReadable: code.codeReadable,
    codeContrast: code.codeContrast,
    mediaPreserved: media.mediaPreserved,
    svgVisible: media.svgVisible,
    noHorizontalScrollRegression: layout.noHorizontalScrollRegression,
    noClippedTextRegression: layout.noClippedTextRegression,
    cleanupExact: hasValidCleanupManifest(options.manifest || activeCleanupManifest),
    budgetHit: stats.budgetHit,
    samples: {
      nodesScanned: stats.nodesScanned,
    },
  };
  const failures = evaluateDarkPostCheckReport(report);
  return {
    ...report,
    ok: failures.length === 0,
    postCheckPassed: failures.length === 0,
    failures,
  };
}

function clearDarkInlineSliceTimers() {
  if (darkInlineSliceTimers.length) {
    darkInlineSliceTimers.forEach((timerId) => clearTimeout(timerId));
  }
  darkInlineSliceTimers = [];
}

function clearDarkInitialApplyTimers() {
  if (darkInitialApplyTimers.length) {
    darkInitialApplyTimers.forEach((timerId) => {
      if (timerId?.type === 'idle' && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(timerId.id);
        return;
      }
      clearTimeout(timerId.id);
    });
  }
  darkInitialApplyTimers = [];
}

function stopDarkInitialApplyPasses() {
  clearDarkInitialApplyTimers();
  darkInitialApplyPassCount = 0;
  darkInitialApplyScopeRoot = null;
}

function clearDarkShadowRescanTimers() {
  if (darkShadowRescanTimers.length) {
    darkShadowRescanTimers.forEach((timerId) => clearTimeout(timerId));
  }
  darkShadowRescanTimers = [];
}

function shouldRunDarkInitialPass(scopeRoot, options = {}) {
  if (!scopeRoot || scopeRoot.isConnected === false) {
    return false;
  }

  if (darkInitialApplyScopeRoot && darkInitialApplyScopeRoot !== scopeRoot) {
    return false;
  }

  const modeActive = options.modeActive;
  return typeof modeActive === 'function' ? modeActive() !== false : true;
}

function scheduleDarkInitialPass(scopeRoot, delayMs, source, budget, options = {}) {
  const runPass = () => {
    if (!shouldRunDarkInitialPass(scopeRoot, options)) {
      return;
    }
    darkInitialApplyPassCount += 1;
    applyDarkSurfaceTagsSafe(scopeRoot, source, budget, options);
    applyDarkShadowRootStyles(scopeRoot, source, options);
  };

  if (typeof requestIdleCallback === 'function') {
    const idleId = requestIdleCallback(runPass, { timeout: delayMs + 200 });
    darkInitialApplyTimers.push({ type: 'idle', id: idleId });
    return;
  }

  const timerId = setTimeout(runPass, delayMs);
  darkInitialApplyTimers.push({ type: 'timeout', id: timerId });
}

function scheduleDarkInitialApplyPasses(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return null;
  }

  stopDarkInitialApplyPasses();
  darkInitialApplyScopeRoot = scopeRoot;

  const initialResult = applyDarkSurfaceTagsSafe(scopeRoot, 'apply-initial', DARK_SURFACE_INITIAL_SCAN_BUDGET, options);
  const initialShadowResult = applyDarkShadowRootStyles(scopeRoot, 'apply-initial', options);
  const combinedInitialResult = initialResult && typeof initialResult === 'object'
    ? {
        ...initialResult,
        shadowRoots: initialShadowResult,
        budgetHit: initialResult?.budgetHit === true || initialShadowResult?.budgetHit === true,
      }
    : initialShadowResult;
  if (combinedInitialResult?.budgetHit === true) {
    stopDarkInitialApplyPasses();
    return combinedInitialResult;
  }

  for (let i = 0; i < DARK_SURFACE_INITIAL_EXTRA_PASSES; i += 1) {
    const delayMs = DARK_SURFACE_INITIAL_PASS_DELAYS_MS[i] || 0;
    scheduleDarkInitialPass(scopeRoot, delayMs, 'apply-initial-pass', DARK_SURFACE_INITIAL_EXTRA_BUDGET, options);
  }

  return combinedInitialResult;
}

function stopDarkObservers() {
  if (darkInlineObserver) {
    darkInlineObserver.disconnect();
  }
  darkInlineObserver = null;
  darkInlineObservedScopeRoot = null;

  if (darkDocumentObserver) {
    darkDocumentObserver.disconnect();
  }
  darkDocumentObserver = null;
  darkDocumentObservedRoot = null;

  if (darkInlineDebounceTimer) {
    clearTimeout(darkInlineDebounceTimer);
  }
  darkInlineDebounceTimer = null;

  if (darkInlineThrottleTimer) {
    clearTimeout(darkInlineThrottleTimer);
  }
  darkInlineThrottleTimer = null;

  clearDarkMutedMutationTimer();

  clearDarkInlineSliceTimers();
  clearDarkAddedRootTimer();
  darkInlineNextAllowedAt = 0;
  darkMutationMuteUntil = 0;
}

function clearDarkMutedMutationTimer() {
  if (darkMutedMutationTimer) {
    clearTimeout(darkMutedMutationTimer);
  }
  darkMutedMutationTimer = null;
}

function clearDarkAddedRootTimer() {
  if (darkAddedRootTimer) {
    clearTimeout(darkAddedRootTimer);
  }
  darkAddedRootTimer = null;
  darkPendingAddedRoots = [];
}

function runDarkInlineRescan(scopeRoot, source = 'observer', options = {}) {
  if (!scopeRoot) {
    return;
  }

  const now = Date.now();
  const throttleRescan = source !== 'slice';
  if (throttleRescan && darkInlineNextAllowedAt && now < darkInlineNextAllowedAt) {
    if (!darkInlineThrottleTimer) {
      const waitMs = darkInlineNextAllowedAt - now;
      darkInlineThrottleTimer = setTimeout(() => {
        darkInlineThrottleTimer = null;
        runDarkInlineRescan(scopeRoot, source, options);
      }, waitMs);
    }
    return;
  }

  if (throttleRescan) {
    darkInlineNextAllowedAt = now + DARK_INLINE_RESCAN_MIN_INTERVAL_MS;
  }
  applyDarkSurfaceInlineOverridesSafe(scopeRoot, source, options);
}

function scheduleDarkInlineDebouncedRescan(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  if (darkInlineDebounceTimer) {
    clearTimeout(darkInlineDebounceTimer);
  }

  darkInlineDebounceTimer = setTimeout(() => {
    darkInlineDebounceTimer = null;
    runDarkInlineRescan(scopeRoot, 'observer', options);
  }, DARK_INLINE_DEBOUNCE_MS);
}

function scheduleDarkInlineSliceRescans(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  clearDarkInlineSliceTimers();

  DARK_INLINE_RESCAN_DELAYS_MS.forEach((delayMs) => {
    const timerId = setTimeout(() => {
      darkInlineSliceTimers = darkInlineSliceTimers.filter((entry) => entry !== timerId);
      runDarkInlineRescan(scopeRoot, 'slice', options);
    }, delayMs);
    darkInlineSliceTimers.push(timerId);
  });
}

function scheduleDarkMutedMutationRescan(scopeRoot, options = {}) {
  if (!scopeRoot || darkMutedMutationTimer) {
    return;
  }

  const waitMs = Math.max(0, darkMutationMuteUntil - Date.now()) + 1;
  darkMutedMutationTimer = setTimeout(() => {
    darkMutedMutationTimer = null;
    if (!scopeRoot || scopeRoot.isConnected === false) {
      return;
    }
    scheduleDarkRescan(scopeRoot, options);
    scheduleDarkInlineDebouncedRescan(scopeRoot, options);
  }, waitMs);
}

function getDarkAddedRootScanOptions(options = {}) {
  const inlineBudget = options.inlineBudget && typeof options.inlineBudget === 'object' ? options.inlineBudget : {};
  const iconBudget = options.iconBudget && typeof options.iconBudget === 'object' ? options.iconBudget : {};
  const mediaBudget = options.mediaBackgroundBudget && typeof options.mediaBackgroundBudget === 'object'
    ? options.mediaBackgroundBudget
    : {};
  const capNumber = (value, fallback, cap) => {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(Math.max(0, value), cap);
  };
  const capInteger = (value, fallback, cap) => Math.floor(capNumber(value, fallback, cap));

  return {
    ...options,
    inlineBudget: {
      ...DARK_ADDED_ROOT_SCAN_BUDGET,
      ...inlineBudget,
      maxNodes: capInteger(inlineBudget.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes),
      maxMs: capNumber(inlineBudget.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs),
      maxCandidates: capInteger(
        inlineBudget.maxCandidates,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxCandidates,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxCandidates,
      ),
      maxForceText: capInteger(
        inlineBudget.maxForceText,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxForceText,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxForceText,
      ),
    },
    iconBudget: {
      ...DARK_ICON_SCAN_BUDGET,
      ...iconBudget,
      maxNodes: capInteger(iconBudget.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes),
      maxMs: capNumber(iconBudget.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs),
      maxIcons: capInteger(iconBudget.maxIcons, DARK_ADDED_ROOT_SCAN_BUDGET.maxIcons, DARK_ADDED_ROOT_SCAN_BUDGET.maxIcons),
      maxPaintSamples: capInteger(
        iconBudget.maxPaintSamples,
        DARK_ICON_SCAN_BUDGET.maxPaintSamples,
        DARK_ICON_SCAN_BUDGET.maxPaintSamples,
      ),
      maxPaintNodes: capInteger(
        iconBudget.maxPaintNodes,
        DARK_ICON_SCAN_BUDGET.maxPaintNodes,
        DARK_ICON_SCAN_BUDGET.maxPaintNodes,
      ),
    },
    mediaBackgroundBudget: {
      ...DARK_ADDED_ROOT_SCAN_BUDGET,
      ...mediaBudget,
      maxNodes: capInteger(mediaBudget.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes, DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes),
      maxMs: capNumber(mediaBudget.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs, DARK_ADDED_ROOT_SCAN_BUDGET.maxMs),
      maxMediaBackgrounds: capInteger(
        mediaBudget.maxMediaBackgrounds,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxMediaBackgrounds,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxMediaBackgrounds,
      ),
      maxGradientBackgrounds: capInteger(
        mediaBudget.maxGradientBackgrounds,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxGradientBackgrounds,
        DARK_ADDED_ROOT_SCAN_BUDGET.maxGradientBackgrounds,
      ),
    },
  };
}

function readDarkElementIdentity(element) {
  const tagName = `${element?.tagName || ''}`.toUpperCase();
  const role = `${element?.getAttribute?.('role') || ''}`.trim().toLowerCase();
  const id = typeof element?.id === 'string' ? element.id : '';
  const className = typeof element?.className === 'string' ? element.className : '';
  return {
    tagName,
    role,
    identity: `${tagName} ${role} ${id} ${className}`.toLowerCase(),
  };
}

function hasDarkDocumentAddedRootAttribute(element) {
  if (!element || typeof element.hasAttribute !== 'function') {
    return false;
  }
  for (const attr of DARK_DOCUMENT_ADDED_ROOT_ATTRS) {
    if (element.hasAttribute(attr)) {
      if (attr === 'aria-modal') {
        return `${element.getAttribute?.(attr) || ''}`.toLowerCase() === 'true';
      }
      return true;
    }
  }
  return false;
}

function isDarkDocumentAddedRootCandidate(element) {
  if (!element || element.nodeType !== 1 || isDarkShadowProtectedElement(element)) {
    return false;
  }

  const { tagName, role, identity } = readDarkElementIdentity(element);
  if (DARK_DOCUMENT_ADDED_ROOT_TAGS.has(tagName) || DARK_DOCUMENT_ADDED_ROOT_ROLES.has(role)) {
    return true;
  }
  if (hasDarkDocumentAddedRootAttribute(element) || element.shadowRoot || isDarkCustomElementHost(element)) {
    return true;
  }

  return DARK_DOCUMENT_ADDED_ROOT_IDENTITY_TOKENS.some((token) => identity.includes(token));
}

function collectDarkAddedRootsFromMutations(mutations = []) {
  const priorityRoots = [];
  const fallbackRoots = [];
  const seen = new Set();
  const addRoot = (node) => {
    if (!node || seen.has(node)) {
      return;
    }
    if (node.nodeType === 1) {
      seen.add(node);
      if (isDarkDocumentAddedRootCandidate(node)) {
        priorityRoots.push(node);
      } else {
        fallbackRoots.push(node);
      }
      return;
    }
    if (node.nodeType === 11 && node.children && typeof node.children.length === 'number') {
      for (const child of Array.from(node.children)) {
        addRoot(child);
      }
    }
  };

  for (const mutation of mutations || []) {
    if (mutation?.type !== 'childList') {
      continue;
    }
    for (const node of mutation.addedNodes || []) {
      addRoot(node);
    }
  }

  return [...priorityRoots, ...fallbackRoots].slice(0, DARK_ADDED_ROOT_MAX_ROOTS);
}

function collectDarkDocumentAddedRootsFromMutations(mutations = []) {
  const roots = [];
  const seen = new Set();
  let nodesSeen = 0;

  const addCandidate = (node) => {
    if (!node || roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || seen.has(node)) {
      return;
    }
    if (isDarkDocumentAddedRootCandidate(node)) {
      roots.push(node);
      seen.add(node);
    }
  };

  const scanNode = (node) => {
    if (!node || roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || nodesSeen >= DARK_DOCUMENT_OBSERVER_NODE_BUDGET) {
      return;
    }
    if (node.nodeType === 11 && node.children && typeof node.children.length === 'number') {
      for (const child of Array.from(node.children)) {
        scanNode(child);
        if (roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || nodesSeen >= DARK_DOCUMENT_OBSERVER_NODE_BUDGET) {
          break;
        }
      }
      return;
    }
    if (node.nodeType !== 1) {
      return;
    }

    nodesSeen += 1;
    addCandidate(node);
    for (const child of elementChildren(node)) {
      scanNode(child);
      if (roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || nodesSeen >= DARK_DOCUMENT_OBSERVER_NODE_BUDGET) {
        break;
      }
    }
  };

  for (const mutation of mutations || []) {
    if (mutation?.type === 'childList') {
      for (const node of mutation.addedNodes || []) {
        scanNode(node);
        if (roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || nodesSeen >= DARK_DOCUMENT_OBSERVER_NODE_BUDGET) {
          return roots;
        }
      }
      continue;
    }

    if (
      mutation?.type === 'attributes'
      && DARK_MUTATION_ATTRIBUTE_FILTER.includes(String(mutation.attributeName || ''))
    ) {
      scanNode(mutation.target);
      if (roots.length >= DARK_ADDED_ROOT_MAX_ROOTS || nodesSeen >= DARK_DOCUMENT_OBSERVER_NODE_BUDGET) {
        return roots;
      }
    }
  }

  return roots;
}

function isSameOrInsideScopeRoot(candidate, scopeRoot) {
  if (!candidate || !scopeRoot) {
    return false;
  }
  if (candidate === scopeRoot) {
    return true;
  }
  try {
    if (typeof scopeRoot.contains === 'function') {
      return scopeRoot.contains(candidate);
    }
  } catch (_) {
    return false;
  }
  return false;
}

function collectDarkDocumentCandidateRoots(scopeRoot, budget = {}) {
  const documentRoot = scopeRoot?.ownerDocument?.documentElement || globalThis.document?.documentElement || null;
  const maxNodes = Number.isFinite(budget.maxCandidateNodes)
    ? Math.max(0, Math.floor(budget.maxCandidateNodes))
    : DARK_DOCUMENT_OBSERVER_NODE_BUDGET;
  const roots = [];
  const seen = new Set();
  const queue = elementChildren(documentRoot).map((node) => ({ node, depth: 0 }));
  let nodesSeen = 0;
  let budgetHit = false;

  while (queue.length > 0) {
    if (nodesSeen >= maxNodes || roots.length >= DARK_ADDED_ROOT_MAX_ROOTS) {
      budgetHit = queue.length > 0;
      break;
    }

    const { node, depth } = queue.shift();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    nodesSeen += 1;

    if (!seen.has(node) && !isSameOrInsideScopeRoot(node, scopeRoot) && isDarkDocumentAddedRootCandidate(node)) {
      roots.push(node);
      seen.add(node);
      if (roots.length >= DARK_ADDED_ROOT_MAX_ROOTS) {
        budgetHit = true;
        break;
      }
    }

    if (depth < 8) {
      for (const child of elementChildren(node)) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return { roots, nodesSeen, budgetHit };
}

function applyDarkDocumentCandidateRoots(scopeRoot, source = 'apply-document', options = {}) {
  const collected = collectDarkDocumentCandidateRoots(scopeRoot, options.documentObserverBudget);
  const scanOptions = getDarkAddedRootScanOptions(options);
  let surfaceScans = 0;
  let inlineScans = 0;
  let shadowScans = 0;
  let budgetHit = collected.budgetHit === true;

  for (const root of collected.roots) {
    const surface = applyDarkSurfaceTagsSafe(root, source, DARK_ADDED_SURFACE_SCAN_BUDGET, scanOptions);
    const inline = applyDarkSurfaceInlineOverridesSafe(root, source, scanOptions);
    const shadow = applyDarkShadowRootStyles(root, source, scanOptions);
    surfaceScans += surface ? 1 : 0;
    inlineScans += inline ? 1 : 0;
    shadowScans += shadow ? 1 : 0;
    budgetHit = budgetHit
      || surface?.budgetHit === true
      || inline?.budgetHit === true
      || shadow?.budgetHit === true;
  }

  return {
    ok: true,
    source,
    rootsSeen: collected.roots.length,
    nodesSeen: collected.nodesSeen,
    surfaceScans,
    inlineScans,
    shadowScans,
    budgetHit,
  };
}

function scheduleDarkAddedRoots(roots = [], options = {}) {
  if (!roots.length) {
    return;
  }

  for (const root of roots) {
    if (!darkPendingAddedRoots.includes(root)) {
      darkPendingAddedRoots.push(root);
    }
    if (darkPendingAddedRoots.length >= DARK_ADDED_ROOT_MAX_ROOTS) {
      darkPendingAddedRoots = darkPendingAddedRoots.slice(0, DARK_ADDED_ROOT_MAX_ROOTS);
      break;
    }
  }

  if (darkAddedRootTimer) {
    return;
  }

  darkAddedRootTimer = setTimeout(() => {
    darkAddedRootTimer = null;
    const pendingRoots = darkPendingAddedRoots.splice(0, DARK_ADDED_ROOT_MAX_ROOTS);
    const scanOptions = getDarkAddedRootScanOptions(options);
    for (const root of pendingRoots) {
      if (!root || root.isConnected === false) {
        continue;
      }
      applyDarkSurfaceTagsSafe(root, 'observer-added', DARK_ADDED_SURFACE_SCAN_BUDGET, scanOptions);
      applyDarkSurfaceInlineOverridesSafe(root, 'observer-added', scanOptions);
      applyDarkShadowRootStyles(root, 'observer-added', scanOptions);
    }
  }, DARK_ADDED_ROOT_DEBOUNCE_MS);
}

function scheduleDarkAddedRootRescan(mutations = [], options = {}) {
  scheduleDarkAddedRoots(collectDarkAddedRootsFromMutations(mutations), options);
}

function scheduleDarkDocumentAddedRootRescan(mutations = [], options = {}) {
  scheduleDarkAddedRoots(collectDarkDocumentAddedRootsFromMutations(mutations), options);
}

function scheduleDarkShadowRescans(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  clearDarkShadowRescanTimers();

  DARK_SHADOW_RESCAN_DELAYS_MS.forEach((delayMs, index) => {
    const timerId = setTimeout(() => {
      darkShadowRescanTimers = darkShadowRescanTimers.filter((entry) => entry !== timerId);
      if (!shouldRunDarkInitialPass(scopeRoot, options)) {
        return;
      }
      applyDarkShadowRootStyles(scopeRoot, `shadow-rescan-${index + 1}`, options);
    }, delayMs);
    if (typeof timerId?.unref === 'function') {
      timerId.unref();
    }
    darkShadowRescanTimers.push(timerId);
  });
}

function startDarkObservers(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  if (darkInlineObserver && darkInlineObservedScopeRoot === scopeRoot) {
    return;
  }

  stopDarkObservers();
  darkInlineObservedScopeRoot = scopeRoot;

  try {
    darkInlineObserver = new MutationObserver((mutations) => {
      if (shouldHandleDarkMutations(mutations)) {
        scheduleDarkAddedRootRescan(mutations, options);
        scheduleDarkInlineDebouncedRescan(scopeRoot, options);
      } else if (shouldDelayDarkMutedAttributeMutations(mutations)) {
        scheduleDarkMutedMutationRescan(scopeRoot, options);
      }
    });
    darkInlineObserver.observe(scopeRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: DARK_MUTATION_ATTRIBUTE_FILTER,
    });
  } catch (error) {
    getLogger(options)('Inline dark surface observer failed', error);
    stopDarkObservers();
  }
}

function startDarkDocumentObservers(scopeRoot, options = {}) {
  const documentRoot = scopeRoot?.ownerDocument?.documentElement || globalThis.document?.documentElement || null;
  if (!documentRoot || !globalThis.MutationObserver) {
    return;
  }
  if (darkDocumentObserver && darkDocumentObservedRoot === documentRoot) {
    return;
  }

  if (darkDocumentObserver) {
    darkDocumentObserver.disconnect();
  }
  darkDocumentObserver = null;
  darkDocumentObservedRoot = documentRoot;

  try {
    darkDocumentObserver = new MutationObserver((mutations) => {
      if (shouldHandleDarkMutations(mutations)) {
        scheduleDarkDocumentAddedRootRescan(mutations, options);
      } else if (shouldDelayDarkMutedAttributeMutations(mutations)) {
        scheduleDarkDocumentAddedRootRescan(mutations, options);
      }
    });
    darkDocumentObserver.observe(documentRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: DARK_MUTATION_ATTRIBUTE_FILTER,
    });
  } catch (error) {
    getLogger(options)('Document dark surface observer failed', error);
    if (darkDocumentObserver) {
      darkDocumentObserver.disconnect();
    }
    darkDocumentObserver = null;
    darkDocumentObservedRoot = null;
  }
}

function teardownDarkObserver() {
  if (darkObserver) {
    darkObserver.disconnect();
  }
  darkObserver = null;
  darkObservedScopeRoot = null;

  if (darkRescanTimer) {
    clearTimeout(darkRescanTimer);
  }
  darkRescanTimer = null;
  clearDarkMutedMutationTimer();
  darkRescanCount = 0;
  darkRescanWindowStart = 0;
  darkMutationMuteUntil = 0;
}

function performDarkRescan(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  const now = Date.now();
  if (!canPerformDarkRescan(now)) {
    return;
  }

  darkRescanCount += 1;
  applyDarkSurfaceTagsSafe(scopeRoot, 'observer', DARK_SURFACE_SCAN_BUDGET, options);
  applyDarkShadowRootStyles(scopeRoot, 'observer', options);
}

function scheduleDarkRescan(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  if (darkRescanTimer) {
    clearTimeout(darkRescanTimer);
  }
  darkRescanTimer = setTimeout(() => {
    darkRescanTimer = null;
    performDarkRescan(scopeRoot, options);
  }, DARK_SURFACE_DEBOUNCE_MS);
}

function ensureDarkObserver(scopeRoot, options = {}) {
  if (!scopeRoot) {
    return;
  }

  if (darkObserver && darkObservedScopeRoot === scopeRoot) {
    return;
  }

  teardownDarkObserver();
  darkObservedScopeRoot = scopeRoot;

  try {
    darkObserver = new MutationObserver((mutations) => {
      if (shouldHandleDarkMutations(mutations)) {
        scheduleDarkRescan(scopeRoot, options);
      } else if (shouldDelayDarkMutedAttributeMutations(mutations)) {
        scheduleDarkMutedMutationRescan(scopeRoot, options);
      }
    });
    darkObserver.observe(scopeRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: DARK_MUTATION_ATTRIBUTE_FILTER,
    });
  } catch (error) {
    getLogger(options)('Dark surface observer failed', error);
    teardownDarkObserver();
  }
}

function cleanupDarkComfortThemeRuntime(options = {}) {
  const scopeRoot = options.scopeRoot || null;
  const source = typeof options.source === 'string' ? options.source : 'cleanup';
  const callbacks = options.callbacks && typeof options.callbacks === 'object' ? options.callbacks : {};
  const cleanupResults = {};

  if (
    typeof options.expectedReceiptId === 'string'
    && options.expectedReceiptId
    && options.expectedReceiptId !== activeDarkRuntimeReceiptId
  ) {
    return {
      ok: false,
      active: Boolean(activeCleanupManifest),
      reason: activeDarkRuntimeReceiptId ? 'runtime-receipt-mismatch' : 'runtime-preimage-unavailable',
    };
  }
  if (options.requirePreimage === true && (!activeDarkRuntimeReceiptId || !activeCleanupManifest)) {
    return { ok: false, active: false, reason: 'runtime-preimage-unavailable' };
  }

  if (scopeRoot) {
    cleanupResults.surfaceTags = clearDarkSurfaceTagsSafe(scopeRoot, source, options);
    const appliedTokens = darkDocumentInlineOverrideState.applied.get(scopeRoot) || {};
    const hasExactTokenPreimage = Object.keys(appliedTokens).some((key) => key.startsWith('--aura-'));
    if (!hasExactTokenPreimage) {
      cleanupResults.tokens = clearDarkScopedTokensSafe(scopeRoot, source, options);
    }
  }
  teardownDarkObserver();
  stopDarkObservers();
  stopDarkInitialApplyPasses();
  clearDarkShadowRescanTimers();
  cleanupResults.shadowRoots = clearDarkShadowRootStyles(source, options);
  cleanupResults.shadowInlineOverrides = clearDarkShadowInlineOverrides();
  cleanupResults.documentInlineOverrides = clearDarkDocumentInlineOverrides(options);
  cleanupResults.iconOverrides = clearDarkIconOverrides();
  cleanupResults.mediaBackgrounds = clearDarkMediaBackgrounds();
  cleanupResults.inlineOverrides = clearDarkSurfaceInlineOverridesSafe(source, options);
  if (typeof callbacks.clearHeadingFixes === 'function') {
    callbacks.clearHeadingFixes();
  }
  activeCleanupManifest = null;
  activeDarkRuntimeReceiptId = null;
  darkPreparedTokenRoots = new WeakSet();

  return {
    ok: true,
    active: false,
    source,
    cleanup: cleanupResults,
  };
}

function applyDarkComfortThemeRuntime(options = {}) {
  const scopeRoot = options.scopeRoot || null;
  const tokenMap = options.tokenMap && typeof options.tokenMap === 'object' ? options.tokenMap : {};
  const source = typeof options.source === 'string' ? options.source : 'apply';
  const callbacks = options.callbacks && typeof options.callbacks === 'object' ? options.callbacks : {};
  const receiptId = typeof options.receiptId === 'string' && options.receiptId
    ? options.receiptId
    : activeDarkRuntimeReceiptId || `dark-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (activeDarkRuntimeReceiptId && activeDarkRuntimeReceiptId !== receiptId) {
    return {
      ok: false,
      active: true,
      reason: 'runtime-receipt-conflict',
      receiptId: activeDarkRuntimeReceiptId,
    };
  }
  activeDarkRuntimeReceiptId = receiptId;
  const manifest = options.preparedManifest && typeof options.preparedManifest === 'object'
    ? options.preparedManifest
    : createDarkComfortCleanupManifest(scopeRoot, {
        source,
        tokenMap,
        ownerKey: options.ownerKey,
        receiptId,
      });

  activeCleanupManifest = manifest;

  if (options.executorActive !== true || !isDarkFromTokenMap(tokenMap) || !scopeRoot) {
    const cleanup = cleanupDarkComfortThemeRuntime({
      ...options,
      source,
      callbacks: { ...callbacks, clearHeadingFixes: null },
    });
    lastDarkApplySummary = {
      source,
      active: false,
      reason: options.executorActive === true ? 'dark-tokens-missing' : 'executor-inactive',
    };
    return {
      ok: true,
      active: false,
      reason: options.executorActive === true ? 'dark-tokens-missing' : 'executor-inactive',
      manifest,
      cleanup,
    };
  }

  const tokenApply = applyDarkRuntimeTokensExact(scopeRoot, tokenMap);
  if (tokenApply.ok !== true) {
    return { ok: false, active: false, reason: tokenApply.reason, receiptId, manifest, tokenApply };
  }

  const initialSurfaceResult = scheduleDarkInitialApplyPasses(scopeRoot, options);
  const inlineResult = applyDarkSurfaceInlineOverridesSafe(scopeRoot, source, options);
  const documentCandidatesResult = applyDarkDocumentCandidateRoots(scopeRoot, 'apply-document', options);
  lastDarkApplySummary = {
    source,
    active: true,
    inlineOverrides: {
      ok: inlineResult?.ok !== false,
      localTokenOverrides: inlineResult?.localTokenOverrides || null,
      rootColorScheme: inlineResult?.rootColorScheme || null,
    },
    documentCandidates: documentCandidatesResult || null,
  };

  if (typeof callbacks.fixUnreadableHeadings === 'function') {
    callbacks.fixUnreadableHeadings(scopeRoot);
  }

  const postCheck = runDarkComfortThemePostCheck(scopeRoot, {
    ...options,
    manifest,
  });
  manifest.postCheck = {
    required: true,
    passed: postCheck.postCheckPassed === true,
    failures: Array.isArray(postCheck.failures) ? postCheck.failures.slice(0, 8) : [],
  };
  if (postCheck.postCheckPassed !== true) {
    if (options.rollbackOnPostCheckFailure === false) {
      ensureDarkObserver(scopeRoot, options);
      startDarkObservers(scopeRoot, options);
      startDarkDocumentObservers(scopeRoot, options);
      scheduleDarkInlineSliceRescans(scopeRoot, options);
      scheduleDarkShadowRescans(scopeRoot, options);

      return {
        ok: true,
        active: true,
        reason: 'postcheck-failed-unverified',
        budgetHit: postCheck.budgetHit === true || documentCandidatesResult?.budgetHit === true,
        manifest,
        surfaceTags: {
          ...(initialSurfaceResult || {}),
          documentCandidates: documentCandidatesResult,
        },
        inlineOverrides: inlineResult,
        postCheck,
        receiptId,
        tokenApply,
      };
    }

    const cleanup = cleanupDarkComfortThemeRuntime({
      ...options,
      source: 'rollback-postcheck-failed',
      callbacks,
    });
    return {
      ok: false,
      active: false,
      reason: 'postcheck-failed',
      budgetHit: postCheck.budgetHit === true || documentCandidatesResult?.budgetHit === true,
      manifest,
      cleanup,
      surfaceTags: {
        ...(initialSurfaceResult || {}),
        documentCandidates: documentCandidatesResult,
      },
      inlineOverrides: inlineResult,
      postCheck,
      receiptId,
      tokenApply,
    };
  }

  ensureDarkObserver(scopeRoot, options);
  startDarkObservers(scopeRoot, options);
  startDarkDocumentObservers(scopeRoot, options);
  scheduleDarkInlineSliceRescans(scopeRoot, options);
  scheduleDarkShadowRescans(scopeRoot, options);

  return {
    ok: true,
    active: true,
    budgetHit: initialSurfaceResult?.budgetHit === true
      || inlineResult?.budgetHit === true
      || documentCandidatesResult?.budgetHit === true
      || postCheck.budgetHit === true,
    manifest,
    surfaceTags: {
      ...(initialSurfaceResult || {}),
      documentCandidates: documentCandidatesResult,
    },
    inlineOverrides: inlineResult,
    postCheck,
    receiptId,
    tokenApply,
  };
}

function getDarkComfortThemeRuntimeState() {
  return {
    active: Boolean(activeCleanupManifest),
    manifest: activeCleanupManifest,
    receiptId: activeDarkRuntimeReceiptId,
    preimageAvailable: Boolean(activeCleanupManifest && activeDarkRuntimeReceiptId),
    lastApply: lastDarkApplySummary,
    observers: {
      surface: Boolean(darkObserver),
      inline: Boolean(darkInlineObserver),
      document: Boolean(darkDocumentObserver),
    },
    shadowRoots: {
      styles: darkShadowStyleNodes.size,
      inlineOverrides: darkShadowInlineOverrideState.touched.size,
    },
    iconOverrides: darkIconOverrideState.touched.size,
    timers: {
      surface: Boolean(darkRescanTimer),
      inlineDebounce: Boolean(darkInlineDebounceTimer),
      inlineThrottle: Boolean(darkInlineThrottleTimer),
      mutedMutation: Boolean(darkMutedMutationTimer),
      inlineSlices: darkInlineSliceTimers.length,
      initialPasses: darkInitialApplyTimers.length,
      shadowRescans: darkShadowRescanTimers.length,
    },
    initialApplyPassCount: darkInitialApplyPassCount,
  };
}

startDarkFrameReadyObserver();

globalThis.AURA_DARK_COMFORT_THEME_RUNTIME = Object.freeze({
  DARK_THEME_EXECUTOR,
  DARK_THEME_OWNER,
  DARK_THEME_V1_BUDGET: Object.freeze({
    precheck: Object.freeze({ maxNodes: 600, maxMs: 12 }),
    initialSurfaceScan: Object.freeze({ maxNodes: 2000, maxMs: 28, maxSurfaces: 40 }),
    initialExtraPass: Object.freeze({ maxPasses: 2, delaysMs: Object.freeze([80, 240]), maxNodes: 1200, maxMs: 18 }),
    mutationRescan: Object.freeze({ debounceMs: 400, maxNodes: 600, maxMs: 12, maxPerMinute: 12 }),
    addedRoots: Object.freeze({
      debounceMs: DARK_ADDED_ROOT_DEBOUNCE_MS,
      maxRoots: DARK_ADDED_ROOT_MAX_ROOTS,
      maxNodes: DARK_ADDED_ROOT_SCAN_BUDGET.maxNodes,
      maxMs: DARK_ADDED_ROOT_SCAN_BUDGET.maxMs,
      maxCandidates: DARK_ADDED_ROOT_SCAN_BUDGET.maxCandidates,
      maxForceText: DARK_ADDED_ROOT_SCAN_BUDGET.maxForceText,
    }),
    documentObserver: Object.freeze({
      maxCandidateNodes: DARK_DOCUMENT_OBSERVER_NODE_BUDGET,
      maxRoots: DARK_ADDED_ROOT_MAX_ROOTS,
      attributes: DARK_MUTATION_ATTRIBUTE_FILTER,
    }),
    inlineOverrides: Object.freeze({ maxNodes: 600, maxMs: 12, maxCandidates: 40 }),
    inlineImportantSurfaceOverrides: Object.freeze({
      maxNodes: DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxNodes,
      maxMs: DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxMs,
      maxOverrides: DARK_INLINE_IMPORTANT_SURFACE_SCAN_BUDGET.maxOverrides,
    }),
    authoredBackgroundRules: Object.freeze({
      maxStyleSheets: DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxStyleSheets,
      maxRules: DARK_AUTHORED_BACKGROUND_RULE_BUDGET.maxRules,
    }),
    localTokenOverrides: Object.freeze({
      maxNodes: DARK_LOCAL_TOKEN_SCAN_BUDGET.maxNodes,
      maxMs: DARK_LOCAL_TOKEN_SCAN_BUDGET.maxMs,
      maxOverrides: DARK_LOCAL_TOKEN_SCAN_BUDGET.maxOverrides,
    }),
    attributeMutationObserver: Object.freeze({
      attributes: DARK_MUTATION_ATTRIBUTE_FILTER,
      selfMuteMs: DARK_MUTATION_SELF_MUTE_MS,
    }),
    shadowRoots: Object.freeze({
      maxNodes: 600,
      maxMs: 12,
      maxShadowRoots: 8,
      maxNestedDepth: 12,
      rescanDelaysMs: Object.freeze([600, 1600, 3600]),
    }),
    shadowInlineOverrides: Object.freeze({
      maxNodes: DARK_SHADOW_INLINE_SCAN_BUDGET.maxNodes,
      maxMs: DARK_SHADOW_INLINE_SCAN_BUDGET.maxMs,
      maxOverrides: DARK_SHADOW_INLINE_SCAN_BUDGET.maxOverrides,
      minArea: DARK_SHADOW_INLINE_SCAN_BUDGET.minArea,
    }),
    iconOverrides: Object.freeze({
      maxNodes: DARK_ICON_SCAN_BUDGET.maxNodes,
      maxMs: DARK_ICON_SCAN_BUDGET.maxMs,
      maxIcons: DARK_ICON_SCAN_BUDGET.maxIcons,
      maxPaintSamples: DARK_ICON_SCAN_BUDGET.maxPaintSamples,
      maxPaintNodes: DARK_ICON_SCAN_BUDGET.maxPaintNodes,
    }),
  }),
  createDarkComfortCleanupManifest,
  prepareDarkComfortThemeRuntime,
  applyDarkComfortThemeRuntime,
  cleanupDarkComfortThemeRuntime,
  getDarkComfortThemeRuntimeState,
  runDarkComfortThemePostCheck,
  isDarkFromTokenMap,
});

})();
