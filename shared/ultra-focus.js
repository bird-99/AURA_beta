// shared/ultra-focus.js

const OVERLAY_ATTR = 'data-aura-ultra-focus';
const OVERLAY_VERSION = 'v1';
const LENS_ATTR = 'data-aura-ultra-focus-lens';
const ICON_ATTR = 'data-aura-ultra-focus-icon';
const MAX_Z_INDEX = 2147483647;
const DEFAULT_MIN_TEXT_LENGTH = 120;
const DEFAULT_MAX_CANDIDATES = 200;

export function getExistingUltraFocusRoot(doc) {
  if (!doc?.querySelector) return null;
  try {
    return doc.querySelector(`[${OVERLAY_ATTR}="${OVERLAY_VERSION}"]`);
  } catch (error) {
    return null;
  }
}

export function createUltraFocusRoot(doc) {
  const existing = getExistingUltraFocusRoot(doc);
  if (existing) {
    return {
      root: existing,
      lens: existing.querySelector?.(`[${LENS_ATTR}]`) || null,
      icon: existing.querySelector?.(`[${ICON_ATTR}]`) || null,
    };
  }

  const root = doc?.createElement?.('div');
  if (!root) {
    throw new Error('Cannot create ultra focus root without a document');
  }

  root.setAttribute(OVERLAY_ATTR, OVERLAY_VERSION);
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.pointerEvents = 'none';
  root.style.zIndex = String(MAX_Z_INDEX);
  root.style.display = 'none';

  const lens = doc.createElement('div');
  lens.setAttribute(LENS_ATTR, '');
  lens.style.position = 'fixed';
  lens.style.pointerEvents = 'none';
  lens.style.border = '2px solid rgba(255, 255, 255, 0.9)';
  lens.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, 0.25), 0 8px 20px rgba(0, 0, 0, 0.35)';
  lens.style.borderRadius = '8px';

  const icon = doc.createElement('button');
  icon.setAttribute(ICON_ATTR, '');
  icon.type = 'button';
  icon.textContent = '◎';
  icon.style.position = 'fixed';
  icon.style.pointerEvents = 'auto';
  icon.style.width = '24px';
  icon.style.height = '24px';
  icon.style.borderRadius = '999px';
  icon.style.border = '1px solid rgba(255, 255, 255, 0.6)';
  icon.style.background = 'rgba(0, 0, 0, 0.55)';
  icon.style.color = '#fff';
  icon.style.display = 'flex';
  icon.style.alignItems = 'center';
  icon.style.justifyContent = 'center';
  icon.style.fontSize = '14px';
  icon.style.lineHeight = '1';

  root.appendChild(lens);
  root.appendChild(icon);

  const parent = doc.body || doc.documentElement;
  parent?.appendChild(root);

  return { root, lens, icon };
}

export function setUltraFocusVisible(handle, visible) {
  if (!handle?.root) return;
  handle.root.style.display = visible ? 'block' : 'none';
}

export function getParagraphCandidates(scopeEl, options = {}) {
  if (!scopeEl?.querySelectorAll) {
    return [];
  }

  const minLength = typeof options.minLength === 'number' ? options.minLength : DEFAULT_MIN_TEXT_LENGTH;
  const maxCandidates = typeof options.maxCandidates === 'number' ? options.maxCandidates : DEFAULT_MAX_CANDIDATES;

  const paragraphs = Array.from(scopeEl.querySelectorAll('p'));
  const filtered = paragraphs.filter((node) => {
    const text = (node.textContent || '').trim();
    return text.length >= minLength;
  });

  return filtered.slice(0, Math.max(0, maxCandidates));
}

export function createUltraFocusController(doc, options = {}) {
  let handle = null;
  let enabled = false;
  let scopeEl = options.scopeEl || doc?.body || null;
  const minLength = typeof options.minLength === 'number' ? options.minLength : DEFAULT_MIN_TEXT_LENGTH;
  const maxCandidates = typeof options.maxCandidates === 'number' ? options.maxCandidates : DEFAULT_MAX_CANDIDATES;

  function setScopeEl(nextScope) {
    scopeEl = nextScope;
  }

  function setEnabled(nextEnabled) {
    if (!nextEnabled) {
      enabled = false;
      if (handle?.root) {
        handle.root.remove();
      }
      handle = null;
      return;
    }

    enabled = true;
    if (!handle) {
      handle = createUltraFocusRoot(doc);
    }
    setUltraFocusVisible(handle, true);
    getParagraphCandidates(scopeEl, { minLength, maxCandidates });
  }

  function getCandidates() {
    return getParagraphCandidates(scopeEl, { minLength, maxCandidates });
  }

  return {
    setEnabled,
    setScopeEl,
    getCandidates,
    isEnabled: () => enabled,
  };
}

export const ULTRA_FOCUS_CONSTANTS = Object.freeze({
  OVERLAY_ATTR,
  OVERLAY_VERSION,
  LENS_ATTR,
  ICON_ATTR,
  MAX_Z_INDEX,
  DEFAULT_MIN_TEXT_LENGTH,
  DEFAULT_MAX_CANDIDATES,
});
