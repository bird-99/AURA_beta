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
const AURA_SURFACE_DEFAULT_BUDGET = { maxNodes: 600, maxMs: 12 };
const AURA_SURFACE_MIN_AREA = 16000;
const AURA_SURFACE_LIGHT_THRESHOLD = 0.8;
const AURA_SURFACE_OBSERVER_DELAY = 200;
const AURA_SURFACE_SKIP_TAGS = new Set(['IMG', 'VIDEO', 'SVG', 'CANVAS', 'IFRAME']);
const AURA_INLINE_SURFACE_DEFAULTS = {
  maxNodes: 600,
  maxMs: 12,
  minArea: 16000,
  lumThreshold: 0.8,
  cardLumThreshold: 0.86,
  maxCandidates: 40,
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
  '--aura-selection-bg',
  '--aura-selection-text',
  '--aura-color-scheme',
  '--aura-focus-color',
];

const AURA_SURFACE_OBSERVERS = new WeakMap();
const AURA_INLINE_SURFACE_STATE = {
  prev: new WeakMap(),
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
    '--aura-text-color': 'inherit',
    '--aura-bg-color': 'transparent',
    '--aura-link-color': 'revert',
    '--aura-link-visited-color': 'revert',
    '--aura-link-hover-color': 'revert',
    '--aura-link-decoration': 'revert',
    '--aura-link-decoration-thickness': 'revert',
    '--aura-link-decoration-offset': 'revert',
    '--aura-link-underline-position': 'revert',
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
} = {}) {
  const scope = MODE_ENGINE_SCOPE_SELECTOR;
  const normalized = clampIntensity(intensity);
  const baseFontSize = 16 * (1 + normalized * 0.08);
  const baseLineHeight = 1.55 + normalized * 0.25;
  const headingLineHeight = Math.min(baseLineHeight + 0.05, 2);
  const paragraphSpacing = 10 + normalized * 4;
  const letterSpacing = 0.15 + normalized * 0.2;
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

  const containerRule =
    `${scope} { font-size: var(--aura-font-size, ${baseFontSize.toFixed(2)}px); line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)}); color: var(--aura-text-color, inherit); background-color: var(--aura-bg-color, transparent); box-sizing: border-box; }`;
  const textRule =
    `${scope} :is(p, li, blockquote, pre, code, dd, dt) { font-size: var(--aura-font-size, ${baseFontSize.toFixed(2)}px); line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)}); color: var(--aura-text-color, inherit); letter-spacing: var(--aura-letter-spacing, ${letterSpacing.toFixed(2)}px); max-inline-size: 72ch; }`;
  const paragraphRule =
    `${scope} p + p { margin-top: var(--aura-paragraph-spacing, ${paragraphSpacing.toFixed(2)}px); }`;
  const headingRule =
    `${scope} :where(h1, h2, h3, h4, h5, h6, [role="heading"]), ${scope} :where(h1, h2, h3, h4, h5, h6, [role="heading"]) * { line-height: var(--aura-line-height, ${headingLineHeight.toFixed(2)}); color: var(--aura-text-color, inherit); -webkit-text-fill-color: currentColor; text-decoration-color: currentColor; }`;
  const anchorRule = `${scope} :is(a) { color: var(--aura-link-color, revert); text-decoration-line: var(--aura-link-decoration, initial); text-decoration-thickness: var(--aura-link-decoration-thickness, initial); text-underline-offset: var(--aura-link-decoration-offset, initial); text-decoration-color: currentColor; text-underline-position: var(--aura-link-underline-position, initial); }`;
  const anchorVisitedRule =
    `${scope} :is(a):visited { color: var(--aura-link-visited-color, var(--aura-link-color, revert)); }`;
  const anchorHoverRule =
    `${scope} :is(a):hover { color: var(--aura-link-hover-color, var(--aura-link-color, revert)); }`;
  const reduceMotionRule =
    reduceMotion && (modeId === MODE_IDS.FOCUS || smoothTransitions)
      ? [
          `${scope} :where(*, *::before, *::after) { animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; }`,
          `${scope}, ${scope} :where(*) { scroll-behavior: auto; }`,
        ].join(' ')
      : '';
  const preRule = `${scope} :is(pre, code) { line-height: var(--aura-line-height, ${baseLineHeight.toFixed(2)}); }`;
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
    paragraphRule,
    headingRule,
    anchorRule,
    anchorVisitedRule,
    anchorHoverRule,
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
    if (!ownedKeys.length || preserveScope) {
      element.removeAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR);
    }
    element.removeAttribute(SCOPE_OWNER_ATTR);
    if (!preserveScope) {
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

function captureInlineOverride(element) {
  if (!element?.style) {
    return null;
  }
  const bg = readInlineValue(element.style, 'background-color');
  const border = readInlineValue(element.style, 'border-color');
  const color = readInlineValue(element.style, 'color');
  return {
    bg: bg.value,
    bgPriority: bg.priority,
    border: border.value,
    borderPriority: border.priority,
    color: color.value,
    colorPriority: color.priority,
  };
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

function restoreInlineOverride(element, snapshot) {
  if (!snapshot || !element?.style) {
    return;
  }
  restoreInlineValue(element, 'background-color', snapshot.bg, snapshot.bgPriority);
  restoreInlineValue(element, 'border-color', snapshot.border, snapshot.borderPriority);
  restoreInlineValue(element, 'color', snapshot.color, snapshot.colorPriority);
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

  const start = typeof view.performance?.now === 'function' ? view.performance.now() : Date.now();
  const walker = scopeRoot.ownerDocument?.createTreeWalker
    ? scopeRoot.ownerDocument.createTreeWalker(scopeRoot, view.NodeFilter?.SHOW_ELEMENT || 1)
    : null;
  const fallbackBackground = resolveScopeRootBackground(scopeRoot);

  let scanned = 0;
  let budgetHit = false;
  const candidates = [];

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

    if (AURA_SURFACE_SKIP_TAGS.has(node.tagName)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (isSurfaceDenylisted(node)) {
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

    if (style.backgroundImage && style.backgroundImage !== 'none') {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const area = getElementArea(node);
    if (!area || area < minArea) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const background = resolveEffectiveBackground(node, scopeRoot, fallbackBackground);
    if (!background || background.alpha < 0.85) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    const luminance = computeLuminance(background);
    const isCard = looksLikeCard(style);
    const threshold = isCard ? cardLumThreshold : lumThreshold;
    if (typeof luminance === 'number' && luminance > threshold) {
      candidates.push({ element: node, area, isCard, luminance });
    }

    scanned += 1;
    node = walker ? walker.nextNode() : null;
  }

  candidates.sort((a, b) => b.area - a.area);
  const shortlist = candidates.slice(0, maxCandidates);

  let overridden = 0;
  let forcedText = 0;
  const state = AURA_INLINE_SURFACE_STATE;

  shortlist.forEach(({ element, isCard }) => {
    if (!element || !element.style) {
      return;
    }
    if (!state.prev.has(element)) {
      const snapshot = captureInlineOverride(element);
      if (snapshot) {
        state.prev.set(element, snapshot);
      }
    }

    const surfaceToken = isCard ? '--aura-surface-2' : '--aura-surface-1';
    element.style.setProperty('background-color', `var(${surfaceToken})`, 'important');
    overridden += 1;

    const style = view.getComputedStyle(element);
    if (hasVisibleBorder(style)) {
      element.style.setProperty('border-color', 'var(--aura-border-color)', 'important');
    }

    if (hasSignificantText(element, style) && shouldForceTextColor(element, scopeRoot, surfaceToken)) {
      element.style.setProperty('color', 'var(--aura-text-color)', 'important');
      forcedText += 1;
    }

    state.touched.add(element);
  });

  const result = { ok: true, scanned, overridden, forcedText };
  if (budgetHit) {
    result.budgetHit = true;
    if (isModeEngineDebugEnabled()) {
      modeEngineDebugLog('[ME2] inline surface override budget hit', {
        scanned,
        overridden,
        forcedText,
        maxNodes,
        maxMs,
      });
    }
  }

  return result;
}

function clearDarkSurfaceInlineOverrides() {
  const state = AURA_INLINE_SURFACE_STATE;
  let restored = 0;

  state.touched.forEach((element) => {
    if (!element || element.isConnected === false) {
      return;
    }
    const snapshot = state.prev.get(element);
    restoreInlineOverride(element, snapshot);
    restored += 1;
  });

  state.touched.clear();
  state.prev = new WeakMap();

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

    if (AURA_SURFACE_SKIP_TAGS.has(node.tagName)) {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (isSurfaceDenylisted(node)) {
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

    if (style.backgroundImage && style.backgroundImage !== 'none') {
      scanned += 1;
      node = walker ? walker.nextNode() : null;
      continue;
    }

    if (!node.hasAttribute(AURA_SURFACE_ATTR) && isLargeEnough(node, minArea)) {
      const { rgba, isTransparent } = getComputedBgColor(node);
      if (rgba && !isTransparent && rgba.alpha >= 0.85) {
        const luminance = relativeLuminance(rgba);
        if (typeof luminance === 'number' && luminance > surfaceLum) {
          const tag = looksLikeCard(style) ? '2' : '1';
          node.setAttribute(AURA_SURFACE_ATTR, tag);
          surfaced += 1;
        }
      }
    }

    if (!node.hasAttribute(AURA_FORCE_TEXT_ATTR) && hasSignificantText(node, style)) {
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
  return result;
}

function clearDarkSurfaceTags(scopeEl, options = {}) {
  if (!scopeEl || scopeEl.nodeType !== 1) {
    return { ok: false, scanned: 0, clearedSurface: 0, clearedForceText: 0, reason: 'invalid-scope' };
  }

  const view = scopeEl.ownerDocument?.defaultView;
  if (!view) {
    return { ok: false, scanned: 0, clearedSurface: 0, clearedForceText: 0, reason: 'missing-view' };
  }

  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : AURA_SURFACE_DEFAULT_BUDGET.maxNodes;
  const maxMs = Number.isFinite(options.maxMs) ? options.maxMs : AURA_SURFACE_DEFAULT_BUDGET.maxMs;
  const start = typeof view.performance?.now === 'function' ? view.performance.now() : Date.now();

  const walker = scopeEl.ownerDocument?.createTreeWalker
    ? scopeEl.ownerDocument.createTreeWalker(scopeEl, view.NodeFilter?.SHOW_ELEMENT || 1)
    : null;

  let scanned = 0;
  let clearedSurface = 0;
  let clearedForceText = 0;
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
    if (node.hasAttribute(AURA_FORCE_TEXT_ATTR)) {
      node.removeAttribute(AURA_FORCE_TEXT_ATTR);
      clearedForceText += 1;
    }

    scanned += 1;
    node = walker ? walker.nextNode() : null;
  }

  const result = { ok: true, scanned, clearedSurface, clearedForceText };
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
