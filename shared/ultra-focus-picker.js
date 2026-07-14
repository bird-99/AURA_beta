// shared/ultra-focus-picker.js

const DEFAULT_MIN_TEXT_LENGTH = 80;
const DEFAULT_MEANINGFUL_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code, table, figure, article, section, main, aside';
const DEFAULT_BLOCK_SELECTOR = 'article, section, main, aside, div, table, figure, ul, ol, dl';
const DEFAULT_PAD_STEPS = [8, 16, 32];
const IGNORE_TAGS = new Set(['HTML', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK']);

function toFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return NaN;
  return Math.min(Math.max(value, min), max);
}

function getViewport(doc) {
  const view = doc?.defaultView || globalThis;
  const width = toFiniteNumber(doc?.documentElement?.clientWidth);
  const height = toFiniteNumber(doc?.documentElement?.clientHeight);
  const fallbackWidth = toFiniteNumber(view?.innerWidth);
  const fallbackHeight = toFiniteNumber(view?.innerHeight);

  const resolvedWidth = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
  const resolvedHeight = Number.isFinite(height) && height > 0 ? height : fallbackHeight;

  return {
    width: Number.isFinite(resolvedWidth) && resolvedWidth > 0 ? resolvedWidth : 0,
    height: Number.isFinite(resolvedHeight) && resolvedHeight > 0 ? resolvedHeight : 0,
  };
}

function getTextLength(node) {
  if (!node) return 0;
  const text = (node.textContent || '').trim();
  return text.length;
}

function hasAuraSignature(el) {
  if (!el || !el.getAttributeNames) return false;
  const attrNames = el.getAttributeNames();
  if (attrNames.some((name) => name.startsWith('data-aura'))) {
    return true;
  }
  const id = el.getAttribute?.('id') || '';
  if (id.startsWith('aura-')) return true;
  const className = el.getAttribute?.('class') || '';
  if (className.split(/\s+/).some((name) => name.startsWith('aura-'))) {
    return true;
  }
  return false;
}

function isShadowElement(el) {
  const root = el?.getRootNode?.();
  if (!root) return false;
  return root.nodeType === 11 && Boolean(root.host);
}

function getComputedStyleSafe(view, el) {
  if (!view?.getComputedStyle) return null;
  try {
    return view.getComputedStyle(el);
  } catch (error) {
    return null;
  }
}

function isVisibleElement(view, el) {
  const style = getComputedStyleSafe(view, el);
  if (!style) return true;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  return true;
}

function shouldIgnoreElement(el, options = {}) {
  if (!el || el.nodeType !== 1) return true;
  const tagName = el.tagName || '';
  if (IGNORE_TAGS.has(tagName)) return true;
  if (isShadowElement(el)) return true;

  let current = el;
  while (current) {
    if (hasAuraSignature(current)) return true;
    current = current.parentElement;
  }

  if (options.excludeElements?.has?.(el)) return true;
  if (options.excludeElement === el) return true;
  return false;
}

function scoreCandidate(candidate, point, viewport, options = {}) {
  const rect = candidate?.getBoundingClientRect?.();
  if (!rect) return { score: 0, reason: 'no-rect' };
  const width = toFiniteNumber(rect.width);
  const height = toFiniteNumber(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { score: 0, reason: 'zero-size' };
  }

  const centerX = rect.left + width / 2;
  const centerY = rect.top + height / 2;
  const distance = Math.hypot(centerX - point.x, centerY - point.y);
  const distanceScore = 1 / (1 + distance);

  const textLength = getTextLength(candidate);
  const minTextLength = typeof options.minTextLength === 'number' ? options.minTextLength : DEFAULT_MIN_TEXT_LENGTH;
  const textScore = Math.min(1, Math.log1p(textLength) / Math.log1p(minTextLength * 4));

  const area = width * height;
  const viewportArea = Math.max(1, viewport.width * viewport.height);
  const idealArea = viewportArea * 0.18;
  const sizePenalty = Math.min(1, Math.abs(area - idealArea) / idealArea);
  const sizeScore = 1 - sizePenalty;

  const inViewport = rect.right > 0 && rect.bottom > 0 && rect.left < viewport.width && rect.top < viewport.height;
  const viewportScore = inViewport ? 0.6 : 0.1;

  const score = distanceScore * 2.2 + textScore * 1.4 + sizeScore * 0.9 + viewportScore;
  return {
    score,
    reason: JSON.stringify({
      distance: Number(distance.toFixed(1)),
      textLength,
      area: Math.round(area),
      inViewport,
    }),
  };
}

export function pickMeaningfulElement(el, options = {}) {
  if (!el) return null;
  const rootDoc = el.ownerDocument || options.rootDoc || null;
  const view = rootDoc?.defaultView || globalThis;

  if (shouldIgnoreElement(el, options)) return null;
  if (!isVisibleElement(view, el)) return null;

  const meaningfulSelector = options.meaningfulSelector || DEFAULT_MEANINGFUL_SELECTOR;
  const blockSelector = options.blockSelector || DEFAULT_BLOCK_SELECTOR;

  let candidate = null;
  if (typeof el.closest === 'function') {
    candidate = el.closest(meaningfulSelector);
    if (candidate && !shouldIgnoreElement(candidate, options)) {
      return candidate;
    }
  }

  let current = el;
  const minTextLength = typeof options.minTextLength === 'number' ? options.minTextLength : DEFAULT_MIN_TEXT_LENGTH;
  while (current) {
    if (IGNORE_TAGS.has(current.tagName)) {
      current = current.parentElement;
      if (!current) break;
      continue;
    }
    const matchesBlock = typeof current.matches === 'function'
      ? current.matches(blockSelector)
      : current.tagName && blockSelector.toLowerCase().includes(current.tagName.toLowerCase());
    const textLength = getTextLength(current);
    const style = getComputedStyleSafe(view, current);
    const isBlockish = style
      ? ['block', 'list-item', 'table', 'flex', 'grid'].includes(style.display)
      : true;

    if (matchesBlock && isBlockish && textLength >= minTextLength) {
      return current;
    }

    if (!current.parentElement) {
      break;
    }
    current = current.parentElement;
  }

  return null;
}

export function pickCandidateFromPoint(rootDoc, point, options = {}) {
  const candidates = [];
  const scoredCandidates = [];
  if (!rootDoc?.elementsFromPoint || !point) {
    return { picked: null, candidates, scoredCandidates };
  }

  const viewport = getViewport(rootDoc);
  const elements = rootDoc.elementsFromPoint(point.x, point.y) || [];
  const seen = new Set();

  elements.forEach((el) => {
    if (shouldIgnoreElement(el, options)) return;
    const meaningful = pickMeaningfulElement(el, { ...options, rootDoc });
    if (!meaningful || seen.has(meaningful)) return;
    seen.add(meaningful);
    const scoreMeta = scoreCandidate(meaningful, point, viewport, options);
    scoredCandidates.push({ element: meaningful, score: scoreMeta.score, reason: scoreMeta.reason });
    candidates.push(meaningful);
  });

  scoredCandidates.sort((a, b) => b.score - a.score);
  const picked = scoredCandidates.length ? scoredCandidates[0].element : null;
  return { picked, candidates, scoredCandidates };
}

export function navigateNeighbor(rootDoc, currentEl, direction, options = {}) {
  if (!currentEl || !rootDoc) return null;
  const rect = currentEl.getBoundingClientRect?.();
  if (!rect) return null;

  const padSteps = Array.isArray(options.padSteps) && options.padSteps.length
    ? options.padSteps
    : DEFAULT_PAD_STEPS;

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const excludeElements = new Set(options.excludeElements || []);
  excludeElements.add(currentEl);

  for (const pad of padSteps) {
    let point = null;
    switch (direction) {
      case 'RIGHT':
        point = { x: rect.right + pad, y: centerY };
        break;
      case 'LEFT':
        point = { x: rect.left - pad, y: centerY };
        break;
      case 'DOWN':
        point = { x: centerX, y: rect.bottom + pad };
        break;
      case 'UP':
        point = { x: centerX, y: rect.top - pad };
        break;
      default:
        return null;
    }

    const result = pickCandidateFromPoint(rootDoc, point, { ...options, excludeElements });
    if (result.picked && result.picked !== currentEl) {
      return result.picked;
    }
  }

  return null;
}

export const ULTRA_FOCUS_PICKER_DEFAULTS = Object.freeze({
  minTextLength: DEFAULT_MIN_TEXT_LENGTH,
  meaningfulSelector: DEFAULT_MEANINGFUL_SELECTOR,
  blockSelector: DEFAULT_BLOCK_SELECTOR,
  padSteps: DEFAULT_PAD_STEPS,
});
