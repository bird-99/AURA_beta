(() => {
  const OVERLAY_ATTR = 'data-aura-ultra-focus';
  const OVERLAY_VERSION = 'v1';
  const LENS_ATTR = 'data-aura-ultra-focus-lens';
  const ICON_ATTR = 'data-aura-ultra-focus-icon';
  const CONTROLS_ATTR = 'data-aura-ultra-focus-controls';
  const EXPAND_ATTR = 'data-aura-ultra-focus-expand';
  const LOCK_ATTR = 'data-aura-ultra-focus-lock';
  const MAGNIFIER_CLIP_ATTR = 'data-aura-ultra-focus-magnifier-clip';
  const MAGNIFIER_STAGE_ATTR = 'data-aura-ultra-focus-magnifier-stage';
  const MAGNIFIER_CLONE_ATTR = 'data-aura-ultra-focus-magnifier-clone-root';
  const MAX_Z_INDEX = 2147483647;
  const MAX_OBSERVED = 200;
  const MIN_TEXT_LENGTH = 120;
  const PICKER_MIN_TEXT_LENGTH = 80;
  const PICKER_MEANINGFUL_SELECTOR =
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, code, table, figure, article, section, main, aside';
  const PICKER_BLOCK_SELECTOR = 'article, section, main, aside, div, table, figure, ul, ol, dl';
  const PICKER_PAD_STEPS = [8, 16, 32];
  const PICKER_IGNORE_TAGS = new Set(['HTML', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK']);
  const ICON_SIZE = 24;
  const ICON_GAP = 12;
  const ICON_OFFSET = 12;
  const ICON_EDGE_PADDING = 8;
  const EXPAND_GAP = 6;
  const ZOOM_FALLBACK_MARGIN = 12;
  const LENS_PADDING = 6;
  const LENS_BASE_RADIUS = 10;
  const LENS_RADIUS_MAX_EXTRA = 6;
  const LENS_RADIUS_SPEED_FACTOR = 0.02;
  const LENS_LERP_ALPHA = 0.22;
  const ZOOM_LERP_BOOST = 0.42;
  const ZOOM_LERP_BOOST_MS = 220;
  const LENS_SNAP_THRESHOLD = 500;
  const LENS_SETTLE_EPSILON = 0.5;
  const DEFAULT_ALPHA = 0.2;
  const EXPAND_VIEWPORT_RATIO = 0.9;
  const EXPAND_SCALE = 1.03;
  const MAGNIFIER_SCALE = 1.45;
  const MAGNIFIER_CLONE_MAX_MS = 25;
  const MAGNIFIER_CLONE_WARN_WINDOW_MS = 1000;
  const ZOOM_MIN_WIDTH = 120;
  const ZOOM_MIN_HEIGHT = 60;
  const ZOOMED_CLASS = 'aura-ultra-focus-zoomed';
  const ZOOMED_FALLBACK_CLASS = 'aura-ultra-focus-zoomed-fallback';
  const ZOOMED_TEXT_CLASS = 'aura-ultra-focus-zoomed-text';
  const ZOOM_STYLE_ATTR = 'data-aura-ultra-focus-style';
  const SCOPE_ATTR = 'data-aura-scope';
  const SCOPE_OWNER_ATTR = 'data-aura-scope-owner';
  const SCOPE_VALUE = '1';
  const SCOPE_OWNER = 'aura-me2';
  const ultraFocusState = (() => {
    if (globalThis.__AURA_ULTRA_FOCUS_STATE__ && typeof globalThis.__AURA_ULTRA_FOCUS_STATE__ === 'object') {
      return globalThis.__AURA_ULTRA_FOCUS_STATE__;
    }
    const state = { desiredExpanded: false };
    globalThis.__AURA_ULTRA_FOCUS_STATE__ = state;
    return state;
  })();

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
  }

  function lerp(current, target, alpha) {
    if (!Number.isFinite(current) || !Number.isFinite(target) || !Number.isFinite(alpha)) {
      return NaN;
    }
    return current + (target - current) * alpha;
  }

  function prefersReducedMotion(view) {
    if (!view?.matchMedia) return false;
    try {
      return view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  function isUltraFocusDebugEnabled() {
    try {
      return Boolean(globalThis?.AURA?.modeEngineFlags?.isEnabled?.('debugModeEngine'));
    } catch (_) {
      return false;
    }
  }

  function isMagnifierEnabled() {
    try {
      return Boolean(globalThis?.AURA?.modeEngineFlags?.isEnabled?.('ultraFocusMagnifierV1'));
    } catch (_) {
      return false;
    }
  }

  function ultraFocusDebugLog(...args) {
    if (!isUltraFocusDebugEnabled()) {
      return;
    }

    const logger = globalThis?.AURA?.modeEngineDebugLog;
    if (typeof logger === 'function') {
      logger(...args);
      return;
    }

    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[AURA][UltraFocus]', ...args);
    }
  }

  function normalizeRect(rect, viewport) {
    if (!rect || !viewport) return null;
    const leftInput = toFiniteNumber(rect.left);
    const topInput = toFiniteNumber(rect.top);
    const rightInput = toFiniteNumber(rect.right);
    const bottomInput = toFiniteNumber(rect.bottom);
    const widthInput = toFiniteNumber(rect.width);
    const heightInput = toFiniteNumber(rect.height);

    if (!Number.isFinite(leftInput) || !Number.isFinite(topInput)) return null;

    const left = clamp(leftInput, 0, viewport.width);
    const top = clamp(topInput, 0, viewport.height);
    const rightBase = Number.isFinite(rightInput)
      ? rightInput
      : Number.isFinite(widthInput)
        ? left + widthInput
        : NaN;
    const bottomBase = Number.isFinite(bottomInput)
      ? bottomInput
      : Number.isFinite(heightInput)
        ? top + heightInput
        : NaN;

    if (!Number.isFinite(rightBase) || !Number.isFinite(bottomBase)) return null;

    const right = clamp(Math.max(left, rightBase), 0, viewport.width);
    const bottom = clamp(Math.max(top, bottomBase), 0, viewport.height);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width <= 0 || height <= 0) return null;

    return { left, top, right, bottom, width, height };
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

  function ensureZoomStyles(doc) {
    if (!doc?.head || !doc.createElement) return;
    if (doc.querySelector?.(`[${ZOOM_STYLE_ATTR}]`)) return;
    const style = doc.createElement('style');
    style.setAttribute(ZOOM_STYLE_ATTR, '1');
    style.textContent = `
.${ZOOMED_CLASS} {
  transform: scale(${EXPAND_SCALE});
  transform-origin: center;
  transition: transform 180ms ease;
}
.${ZOOMED_FALLBACK_CLASS} {
  filter: contrast(1.02) saturate(1.02);
  transition: filter 180ms ease;
}
.${ZOOMED_TEXT_CLASS} {
  text-rendering: optimizeLegibility;
}
`;
    doc.head.appendChild(style);
  }

  function getExistingOverlayRoot(doc) {
    if (!doc?.querySelector) return null;
    try {
      return doc.querySelector(`[${OVERLAY_ATTR}="${OVERLAY_VERSION}"]`);
    } catch (error) {
      return null;
    }
  }

  function getTopLayerHost(doc) {
    const module = globalThis.AURA_TOP_LAYER_HOST;
    const createHost = module?.createTopLayerHost;
    if (typeof createHost !== 'function') return null;
    return createHost({ doc });
  }

  function createMagnifierNodes(doc) {
    const root = getExistingOverlayRoot(doc);
    if (!root || !doc?.createElement) {
      return {
        magnifierClip: null,
        magnifierStage: null,
        magnifierCloneRoot: null,
        magnifierSourceEl: null,
      };
    }

    let clip = root.querySelector?.(`[${MAGNIFIER_CLIP_ATTR}]`) || null;
    if (!clip) {
      clip = doc.createElement('div');
      clip.setAttribute(MAGNIFIER_CLIP_ATTR, '');
      clip.style.position = 'fixed';
      clip.style.overflow = 'hidden';
      clip.style.pointerEvents = 'none';
      clip.style.display = 'none';
      clip.style.zIndex = String(MAX_Z_INDEX - 1);
      root.appendChild(clip);
    }

    let stage = clip.querySelector?.(`[${MAGNIFIER_STAGE_ATTR}]`) || null;
    if (!stage) {
      stage = doc.createElement('div');
      stage.setAttribute(MAGNIFIER_STAGE_ATTR, '');
      stage.style.position = 'absolute';
      stage.style.left = '0';
      stage.style.top = '0';
      stage.style.transformOrigin = '0 0';
      stage.style.willChange = 'transform';
      stage.style.pointerEvents = 'none';
      clip.appendChild(stage);
    }

    let cloneRoot = stage.querySelector?.(`[${MAGNIFIER_CLONE_ATTR}]`) || null;
    if (!cloneRoot) {
      cloneRoot = doc.createElement('div');
      cloneRoot.setAttribute(MAGNIFIER_CLONE_ATTR, '');
      cloneRoot.setAttribute('aria-hidden', 'true');
      cloneRoot.style.pointerEvents = 'none';
      cloneRoot.style.userSelect = 'none';
      stage.appendChild(cloneRoot);
    }
    cloneRoot.tabIndex = -1;

    return {
      magnifierClip: clip,
      magnifierStage: stage,
      magnifierCloneRoot: cloneRoot,
      magnifierSourceEl: null,
    };
  }

  function createOverlayRoot(doc) {
    const host = getTopLayerHost(doc);
    if (host) {
      host.mount();
    }

    const overlayParent = host?.getOverlayRoot?.() || doc?.body || doc?.documentElement;
    const controlsParent = host?.getControlsRoot?.() || doc?.documentElement || doc?.body;

    let root = overlayParent?.querySelector?.(`[${OVERLAY_ATTR}="${OVERLAY_VERSION}"]`) || getExistingOverlayRoot(doc);
    if (root && overlayParent && root.parentNode !== overlayParent) {
      overlayParent.appendChild(root);
    }

    if (!root) {
      root = doc?.createElement?.('div');
      if (!root) {
        throw new Error('Cannot create ultra focus overlay without document');
      }
      root.setAttribute(OVERLAY_ATTR, OVERLAY_VERSION);
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.pointerEvents = 'none';
      root.style.zIndex = String(MAX_Z_INDEX);
      root.style.display = 'none';
      overlayParent?.appendChild(root);
    }

    let controlsRoot = controlsParent?.querySelector?.(`[${CONTROLS_ATTR}]`) || null;
    if (controlsRoot && controlsParent && controlsRoot.parentNode !== controlsParent) {
      controlsParent.appendChild(controlsRoot);
    }
    if (!controlsRoot) {
      controlsRoot = doc?.createElement?.('div');
      if (!controlsRoot) {
        throw new Error('Cannot create ultra focus controls without document');
      }
      controlsRoot.setAttribute(CONTROLS_ATTR, '');
      controlsRoot.style.position = 'fixed';
      controlsRoot.style.inset = '0';
      controlsRoot.style.pointerEvents = 'none';
      controlsRoot.style.zIndex = String(MAX_Z_INDEX);
      controlsRoot.style.display = 'none';
      controlsParent?.appendChild(controlsRoot);
    }

    let lens = root.querySelector?.(`[${LENS_ATTR}]`) || null;
    if (!lens) {
      lens = doc.createElement('div');
      lens.setAttribute(LENS_ATTR, '');
      lens.style.position = 'fixed';
      lens.style.pointerEvents = 'none';
      lens.style.border = '2px solid rgba(255, 255, 255, 0.9)';
      lens.style.borderRadius = `${LENS_BASE_RADIUS}px`;
      lens.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, 0.25), 0 8px 20px rgba(0, 0, 0, 0.35)';
      lens.style.willChange = 'transform, width, height';
      lens.style.transform = 'translate3d(0, 0, 0)';
      root.appendChild(lens);
    }

    let icon = controlsRoot.querySelector?.(`[${ICON_ATTR}]`) || null;
    if (!icon) {
      const legacyIcon = root.querySelector?.(`[${ICON_ATTR}]`) || null;
      if (legacyIcon) {
        icon = legacyIcon;
        controlsRoot.appendChild(icon);
      }
    }

    if (!icon) {
      icon = doc.createElement('button');
      icon.setAttribute(ICON_ATTR, '');
      icon.type = 'button';
      icon.setAttribute('aria-label', 'Ultra focus');
      icon.textContent = '◎';
      icon.style.position = 'fixed';
      icon.style.pointerEvents = 'auto';
      icon.style.width = `${ICON_SIZE}px`;
      icon.style.height = `${ICON_SIZE}px`;
      icon.style.borderRadius = '999px';
      icon.style.border = '1px solid rgba(255, 255, 255, 0.6)';
      icon.style.background = 'rgba(0, 0, 0, 0.55)';
      icon.style.color = '#fff';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.justifyContent = 'center';
      icon.style.fontSize = '14px';
      icon.style.lineHeight = '1';
      icon.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.4)';
      icon.style.willChange = 'transform';
      controlsRoot.appendChild(icon);
    }

    let expandButton = controlsRoot.querySelector?.(`[${EXPAND_ATTR}]`) || null;
    if (!expandButton) {
      expandButton = doc.createElement('button');
      expandButton.setAttribute(EXPAND_ATTR, '');
      expandButton.type = 'button';
      expandButton.setAttribute('aria-label', 'Expand focus');
      expandButton.setAttribute('aria-pressed', 'false');
      expandButton.textContent = '⤢';
      expandButton.style.position = 'fixed';
      expandButton.style.pointerEvents = 'auto';
      expandButton.style.width = `${ICON_SIZE}px`;
      expandButton.style.height = `${ICON_SIZE}px`;
      expandButton.style.borderRadius = '999px';
      expandButton.style.border = '1px solid rgba(255, 255, 255, 0.6)';
      expandButton.style.background = 'rgba(0, 0, 0, 0.55)';
      expandButton.style.color = '#fff';
      expandButton.style.display = 'flex';
      expandButton.style.alignItems = 'center';
      expandButton.style.justifyContent = 'center';
      expandButton.style.fontSize = '12px';
      expandButton.style.lineHeight = '1';
      expandButton.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.4)';
      expandButton.style.willChange = 'transform';
      controlsRoot.appendChild(expandButton);
    }

    const magnifierNodes = isMagnifierEnabled() ? createMagnifierNodes(doc) : null;

    return {
      root,
      controlsRoot,
      lens,
      icon,
      expandButton,
      magnifierClip: magnifierNodes?.magnifierClip || null,
      magnifierStage: magnifierNodes?.magnifierStage || null,
      magnifierCloneRoot: magnifierNodes?.magnifierCloneRoot || null,
      magnifierSourceEl: magnifierNodes?.magnifierSourceEl || null,
    };
  }

  function clearMagnifierNodes(handle) {
    if (!handle) return;
    if (handle.magnifierCloneRoot) {
      while (handle.magnifierCloneRoot.firstChild) {
        handle.magnifierCloneRoot.removeChild(handle.magnifierCloneRoot.firstChild);
      }
    }
    if (handle.magnifierClip?.remove) {
      handle.magnifierClip.remove();
    } else if (handle.magnifierStage?.remove) {
      handle.magnifierStage.remove();
    }
    handle.magnifierClip = null;
    handle.magnifierStage = null;
    handle.magnifierCloneRoot = null;
    handle.magnifierSourceEl = null;
  }

  function setOverlayVisible(handle, visible) {
    if (!handle?.root) return;
    handle.root.style.display = visible ? 'block' : 'none';
  }

  function setControlsVisible(handle, visible) {
    if (!handle?.controlsRoot) return;
    handle.controlsRoot.style.display = visible ? 'block' : 'none';
  }

  function sanitizeMagnifierClone(root) {
    if (!root) return;
    if (root.removeAttribute) {
      root.removeAttribute('id');
    }
    const elementsWithIds = root.querySelectorAll?.('[id]') || [];
    elementsWithIds.forEach((el) => el.removeAttribute('id'));
    const heavyElements = root.querySelectorAll?.('video, audio, iframe, canvas') || [];
    heavyElements.forEach((el) => el.remove());
    const images = root.querySelectorAll?.('img') || [];
    images.forEach((img) => img.setAttribute('loading', 'lazy'));
  }

  function setLensRect(handle, rect) {
    if (!handle?.lens) return;
    if (isMagnifierEnabled()) {
      // TODO: ultraFocusMagnifierV1 - wire magnifier-specific rendering here (keep legacy lens behavior otherwise).
    }
    if (!rect) {
      handle.lens.style.display = 'none';
      return;
    }

    const left = Math.max(0, rect.left - LENS_PADDING);
    const top = Math.max(0, rect.top - LENS_PADDING);
    const width = rect.width + LENS_PADDING * 2;
    const height = rect.height + LENS_PADDING * 2;

    handle.lens.style.display = 'block';
    handle.lens.style.left = '0px';
    handle.lens.style.top = '0px';
    handle.lens.style.width = `${width}px`;
    handle.lens.style.height = `${height}px`;
    handle.lens.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function setLensRadius(handle, speed) {
    if (!handle?.lens) return;
    const extra = clamp(speed * LENS_RADIUS_SPEED_FACTOR, 0, LENS_RADIUS_MAX_EXTRA);
    const radius = LENS_BASE_RADIUS + (Number.isFinite(extra) ? extra : 0);
    handle.lens.style.borderRadius = `${radius}px`;
  }

  function getIconSize(handle) {
    if (!handle?.icon) {
      return { width: ICON_SIZE, height: ICON_SIZE };
    }
    const measured = handle.icon.getBoundingClientRect?.();
    const width = toFiniteNumber(measured?.width);
    const height = toFiniteNumber(measured?.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : ICON_SIZE,
      height: Number.isFinite(height) && height > 0 ? height : ICON_SIZE,
    };
  }

  function getIconPosition(rect, viewport, size) {
    const width = toFiniteNumber(viewport?.width);
    const height = toFiniteNumber(viewport?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const iconWidth = toFiniteNumber(size?.width);
    const iconHeight = toFiniteNumber(size?.height);
    if (!Number.isFinite(iconWidth) || !Number.isFinite(iconHeight)) return null;

    const fitsRight = rect.right + ICON_GAP + iconWidth <= width;
    const fitsLeft = rect.left - ICON_GAP - iconWidth >= 0;

    let x;
    if (fitsRight) {
      x = rect.right + ICON_GAP;
    } else if (fitsLeft) {
      x = rect.left - ICON_GAP - iconWidth;
    } else {
      x = clamp(rect.right + ICON_GAP, 0, width - iconWidth);
    }

    const y = clamp(rect.top + ICON_OFFSET, ICON_EDGE_PADDING, height - iconHeight - ICON_EDGE_PADDING);

    return { x, y };
  }

  function getZoomPosition(rect, viewport, size) {
    if (!viewport || !size) return null;
    const width = toFiniteNumber(viewport.width);
    const height = toFiniteNumber(viewport.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    const iconWidth = toFiniteNumber(size.width);
    const iconHeight = toFiniteNumber(size.height);
    if (!Number.isFinite(iconWidth) || !Number.isFinite(iconHeight)) return null;

    if (!rect) {
      return {
        x: clamp(width - iconWidth - ZOOM_FALLBACK_MARGIN, ZOOM_FALLBACK_MARGIN, width - iconWidth - ZOOM_FALLBACK_MARGIN),
        y: clamp(ZOOM_FALLBACK_MARGIN, ZOOM_FALLBACK_MARGIN, height - iconHeight - ZOOM_FALLBACK_MARGIN),
      };
    }

    const fitsRight = rect.right + ICON_GAP + iconWidth <= width;
    const fitsLeft = rect.left - ICON_GAP - iconWidth >= 0;

    let x;
    if (fitsRight) {
      x = rect.right + ICON_GAP;
    } else if (fitsLeft) {
      x = rect.left - ICON_GAP - iconWidth;
    } else {
      x = clamp(rect.right + ICON_GAP, ZOOM_FALLBACK_MARGIN, width - iconWidth - ZOOM_FALLBACK_MARGIN);
    }

    const y = clamp(rect.top + ICON_OFFSET, ZOOM_FALLBACK_MARGIN, height - iconHeight - ZOOM_FALLBACK_MARGIN);
    return { x, y };
  }

  function setIconRect(handle, rect, viewport, visible, fallbackRect = null) {
    if (!handle?.icon) return;
    if (!visible || !viewport) {
      handle.icon.style.display = 'none';
      return;
    }

    const anchorRect = rect || fallbackRect || null;
    const iconSize = getIconSize(handle);
    const position = anchorRect
      ? getIconPosition(anchorRect, viewport, iconSize)
      : getZoomPosition(null, viewport, iconSize);
    if (!position) {
      handle.icon.style.display = 'none';
      return;
    }

    handle.icon.style.display = 'flex';
    handle.icon.style.left = '0px';
    handle.icon.style.top = '0px';
    handle.icon.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
  }

  function setExpandRect(handle, rect, viewport, visible, fallbackRect = null) {
    if (!handle?.expandButton) return;
    if (!visible) {
      handle.expandButton.style.display = 'none';
      ultraFocusDebugLog('UF_ZOOM_RENDER', {
        visible: false,
        reason: 'DISABLED_STATE',
      });
      return;
    }

    if (!viewport) {
      handle.expandButton.style.display = 'none';
      ultraFocusDebugLog('UF_ZOOM_RENDER', {
        visible: false,
        reason: 'OFFSCREEN',
      });
      return;
    }

    const anchorRect = rect || fallbackRect || null;
    const iconSize = getIconSize(handle);
    const fallbackPosition = {
      x: viewport.width / 2 - iconSize.width / 2,
      y: viewport.height / 2 - iconSize.height / 2,
    };
    const basePosition = getZoomPosition(anchorRect, viewport, iconSize) || fallbackPosition;
    if (!basePosition) {
      handle.expandButton.style.display = 'none';
      ultraFocusDebugLog('UF_ZOOM_RENDER', {
        visible: false,
        reason: anchorRect ? 'OFFSCREEN' : 'NO_RECT',
      });
      return;
    }

    const maxX = Math.max(0, viewport.width - iconSize.width);
    const maxY = Math.max(0, viewport.height - iconSize.height);
    const x = clamp(basePosition.x, 0, maxX);
    const y = clamp(basePosition.y + iconSize.height + EXPAND_GAP, 0, maxY);

    handle.expandButton.style.display = 'flex';
    handle.expandButton.style.left = '0px';
    handle.expandButton.style.top = '0px';
    handle.expandButton.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ultraFocusDebugLog('UF_ZOOM_RENDER', {
      visible: true,
      reason: rect ? 'OK' : 'NO_RECT',
      rect: rect
        ? {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        : null,
      viewport: viewport ? { width: Math.round(viewport.width), height: Math.round(viewport.height) } : null,
    });
  }

  function setExpandDisabled(handle, disabled) {
    if (!handle?.expandButton) return;
    handle.expandButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    handle.expandButton.style.opacity = disabled ? '0.55' : '1';
    handle.expandButton.style.cursor = disabled ? 'not-allowed' : 'pointer';
  }

  function getScopeRoot(doc) {
    try {
      return doc.querySelector(
        `[${SCOPE_ATTR}="${SCOPE_VALUE}"][${SCOPE_OWNER_ATTR}="${SCOPE_OWNER}"]`,
      );
    } catch (error) {
      return null;
    }
  }

  function getFocusOverlayModule() {
    return globalThis.AURA_FOCUS_OVERLAY_V2 || null;
  }

  function getFocusEngineController() {
    const engine = globalThis.AURA_FOCUS_ENGINE;
    const getShared = engine?.getSharedController;
    if (typeof getShared !== 'function') return null;
    return getShared('rect', 'ultra-focus-lock');
  }

  function getExpandedRect(viewport) {
    if (!viewport) return null;
    const width = toFiniteNumber(viewport.width);
    const height = toFiniteNumber(viewport.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    const expandedWidth = Math.max(0, width * EXPAND_VIEWPORT_RATIO);
    const expandedHeight = Math.max(0, height * EXPAND_VIEWPORT_RATIO);
    if (expandedWidth <= 0 || expandedHeight <= 0) return null;
    const left = (width - expandedWidth) / 2;
    const top = (height - expandedHeight) / 2;
    return {
      left,
      top,
      width: expandedWidth,
      height: expandedHeight,
      right: left + expandedWidth,
      bottom: top + expandedHeight,
    };
  }

  function scoreCandidate(entry, textLength) {
    const ratio = typeof entry?.intersectionRatio === 'number' ? entry.intersectionRatio : 0;
    if (ratio <= 0) return 0;
    const lengthScore = Math.log1p(Math.max(0, textLength));
    return ratio * lengthScore;
  }

  function getTextLength(node) {
    if (!node) return 0;
    const text = (node.textContent || '').trim();
    return text.length;
  }

  function getElementSummary(el) {
    if (!el) return null;
    const tagName = el.tagName || 'UNKNOWN';
    const id = el.getAttribute?.('id') || '';
    const className = el.getAttribute?.('class') || '';
    const trimmedClass = className.split(/\s+/).slice(0, 3).join('.');
    const rect = el.getBoundingClientRect?.();
    const rectSummary = rect
      ? {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      : null;
    return {
      tagName,
      id,
      className: trimmedClass,
      textLength: getTextLength(el),
      rect: rectSummary,
    };
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

  function isZoomEligibleTarget(view, target, viewport) {
    if (!target) return false;
    const rect = target.getBoundingClientRect?.();
    if (!rect) return false;
    const width = toFiniteNumber(rect.width);
    const height = toFiniteNumber(rect.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width < ZOOM_MIN_WIDTH || height < ZOOM_MIN_HEIGHT) return false;
    const style = getComputedStyleSafe(view, target);
    if (!style) return true;
    if (style.position === 'fixed') return false;
    if (viewport?.width && viewport?.height) {
      const maxWidth = viewport.width * 0.98;
      const maxHeight = viewport.height * 0.98;
      if (width > maxWidth || height > maxHeight) return false;
    }
    return true;
  }

  function shouldIgnoreElement(el, options = {}) {
    if (!el || el.nodeType !== 1) return true;
    const tagName = el.tagName || '';
    if (PICKER_IGNORE_TAGS.has(tagName)) return true;
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

  function scorePickerCandidate(candidate, point, viewport, options = {}) {
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
    const minTextLength = typeof options.minTextLength === 'number' ? options.minTextLength : PICKER_MIN_TEXT_LENGTH;
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
      reason: {
        distance: Number(distance.toFixed(1)),
        textLength,
        area: Math.round(area),
        inViewport,
      },
    };
  }

  function pickMeaningfulElement(el, options = {}) {
    if (!el) return null;
    const rootDoc = el.ownerDocument || options.rootDoc || null;
    const view = rootDoc?.defaultView || globalThis;

    if (shouldIgnoreElement(el, options)) return null;
    if (!isVisibleElement(view, el)) return null;

    const meaningfulSelector = options.meaningfulSelector || PICKER_MEANINGFUL_SELECTOR;
    const blockSelector = options.blockSelector || PICKER_BLOCK_SELECTOR;

    let candidate = null;
    if (typeof el.closest === 'function') {
      candidate = el.closest(meaningfulSelector);
      if (candidate && !shouldIgnoreElement(candidate, options)) {
        return candidate;
      }
    }

    let current = el;
    const minTextLength = typeof options.minTextLength === 'number' ? options.minTextLength : PICKER_MIN_TEXT_LENGTH;
    while (current) {
      if (PICKER_IGNORE_TAGS.has(current.tagName)) {
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

  function pickCandidateFromPoint(rootDoc, point, options = {}) {
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
      const scoreMeta = scorePickerCandidate(meaningful, point, viewport, options);
      scoredCandidates.push({ element: meaningful, score: scoreMeta.score, reason: scoreMeta.reason });
      candidates.push(meaningful);
    });

    scoredCandidates.sort((a, b) => b.score - a.score);
    const picked = scoredCandidates.length ? scoredCandidates[0].element : null;
    return { picked, candidates, scoredCandidates };
  }

  function navigateNeighbor(rootDoc, currentEl, direction, options = {}) {
    if (!currentEl || !rootDoc) return null;
    const rect = currentEl.getBoundingClientRect?.();
    if (!rect) return null;

    const padSteps = Array.isArray(options.padSteps) && options.padSteps.length
      ? options.padSteps
      : PICKER_PAD_STEPS;
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

  function collectParagraphs(scopeEl) {
    if (!scopeEl?.querySelectorAll) return [];
    const paragraphs = Array.from(scopeEl.querySelectorAll('p'));
    const filtered = paragraphs.filter((node) => getTextLength(node) >= MIN_TEXT_LENGTH);
    return filtered.slice(0, MAX_OBSERVED);
  }

  function pickFallbackCandidate(scopeEl) {
    if (!scopeEl?.querySelectorAll) return null;
    const paragraphs = collectParagraphs(scopeEl);
    if (paragraphs.length) {
      return paragraphs[0];
    }
    const meaningfulSelector = PICKER_MEANINGFUL_SELECTOR;
    const candidates = Array.from(scopeEl.querySelectorAll(meaningfulSelector));
    return candidates.find((node) => getTextLength(node) >= PICKER_MIN_TEXT_LENGTH) || null;
  }

  function createController(doc) {
    const view = doc?.defaultView || globalThis;
    const overlay = createOverlayRoot(doc);
    ensureZoomStyles(doc);
    const ratios = new Map();
    let observer = null;
    let enabled = false;
    let locked = false;
    let lockedElement = null;
    let bestCandidate = null;
    let renderScheduled = false;
    let renderDirty = false;
    let renderRafId = null;
    let zoomRafId = null;
    let scopeRoot = null;
    let focusEngineController = null;
    let isSuspended = false;
    let listenersAttached = false;
    let expanded = false;
    let expandedTarget = null;
    let desiredExpanded = ultraFocusState.desiredExpanded === true;
    let state = 'idle';
    let zoomBoostUntil = 0;
    const scaledTargets = new WeakMap();
    let resizeObserver = null;
    let observedTarget = null;
    let resizeScheduled = false;
    let resizeRafId = null;
    let lastResizeTick = 0;
    let lastPointer = null;
    let lastPointerAt = 0;
    let currentRect = null;
    let targetRect = null;
    let lastGoodRect = null;
    let preZoomRect = null;
    let preZoomTarget = null;
    let magnifierDisabled = ultraFocusState.magnifierDisabledByPerf === true;
    let magnifierCloneBuilds = 0;
    let magnifierCloneBuildTimes = [];

    const pickerOptions = {
      minTextLength: PICKER_MIN_TEXT_LENGTH,
      meaningfulSelector: PICKER_MEANINGFUL_SELECTOR,
      blockSelector: PICKER_BLOCK_SELECTOR,
      padSteps: PICKER_PAD_STEPS,
    };

    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (callback) => setTimeout(callback, 16);
    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    const recordMagnifierCloneBuild = () => {
      if (!isUltraFocusDebugEnabled()) return;
      magnifierCloneBuilds += 1;
      const now = Date.now();
      magnifierCloneBuildTimes = magnifierCloneBuildTimes.filter(
        (timestamp) => now - timestamp <= MAGNIFIER_CLONE_WARN_WINDOW_MS,
      );
      magnifierCloneBuildTimes.push(now);
      ultraFocusDebugLog('UF_MAGNIFIER_CLONE_BUILD', {
        magnifierCloneBuilds,
        recentBuilds: magnifierCloneBuildTimes.length,
        windowMs: MAGNIFIER_CLONE_WARN_WINDOW_MS,
      });
      if (magnifierCloneBuildTimes.length > 1) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[AURA][UltraFocus]', 'UF_MAGNIFIER_CLONE_RATE_HIGH', {
            magnifierCloneBuilds,
            recentBuilds: magnifierCloneBuildTimes.length,
            windowMs: MAGNIFIER_CLONE_WARN_WINDOW_MS,
          });
        } else {
          ultraFocusDebugLog('UF_MAGNIFIER_CLONE_RATE_HIGH', {
            magnifierCloneBuilds,
            recentBuilds: magnifierCloneBuildTimes.length,
            windowMs: MAGNIFIER_CLONE_WARN_WINDOW_MS,
          });
        }
      }
    };

    const disableMagnifierForPerf = (durationMs) => {
      if (magnifierDisabled) return;
      magnifierDisabled = true;
      ultraFocusState.magnifierDisabledByPerf = true;
      clearMagnifierNodes(overlay);
      ultraFocusDebugLog('UF_MAGNIFIER_DISABLED_PERF', {
        durationMs: Number(durationMs?.toFixed ? durationMs.toFixed(2) : durationMs),
        thresholdMs: MAGNIFIER_CLONE_MAX_MS,
      });
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[AURA][UltraFocus]', 'UF_MAGNIFIER_DISABLED_PERF', {
          durationMs,
          thresholdMs: MAGNIFIER_CLONE_MAX_MS,
        });
      }
    };

    const scheduleRender = () => {
      if (!enabled) return;
      if (renderScheduled) return;
      renderScheduled = true;
      renderRafId = raf(() => {
        renderScheduled = false;
        renderRafId = null;
        renderFrame();
      });
    };

    const markDirty = () => {
      renderDirty = true;
      scheduleRender();
    };

    const scheduleResizeUpdate = () => {
      if (resizeScheduled) return;
      resizeScheduled = true;
      resizeRafId = raf(() => {
        resizeScheduled = false;
        resizeRafId = null;
        const now = Date.now();
        if (now - lastResizeTick < 80) {
          return;
        }
        lastResizeTick = now;
        markDirty();
      });
    };

    const ensureResizeObserver = () => {
      if (resizeObserver) return resizeObserver;
      if (typeof view?.ResizeObserver !== 'function') return null;
      resizeObserver = new view.ResizeObserver(() => {
        scheduleResizeUpdate();
      });
      return resizeObserver;
    };

    const observeTargetResize = (target) => {
      if (observedTarget === target) return;
      if (resizeObserver && observedTarget) {
        try {
          resizeObserver.unobserve(observedTarget);
        } catch (error) {
          // ignore unobserve errors
        }
      }
      observedTarget = target;
      if (!observedTarget) return;
      const observer = ensureResizeObserver();
      if (!observer) return;
      try {
        observer.observe(observedTarget);
      } catch (error) {
        // ignore observe errors
      }
    };

    const scheduleUpdate = () => {
      markDirty();
    };

    const ensureMagnifierClone = (target) => {
      if (!isMagnifierEnabled() || magnifierDisabled) return false;
      if (!overlay?.magnifierClip && !overlay?.magnifierStage && !overlay?.magnifierCloneRoot) {
        const nodes = createMagnifierNodes(doc);
        overlay.magnifierClip = nodes.magnifierClip;
        overlay.magnifierStage = nodes.magnifierStage;
        overlay.magnifierCloneRoot = nodes.magnifierCloneRoot;
        overlay.magnifierSourceEl = nodes.magnifierSourceEl;
      }
      if (!overlay?.magnifierCloneRoot || !overlay?.magnifierStage || !target) return false;
      if (overlay.magnifierSourceEl === target) {
        ultraFocusDebugLog('CLONE_REUSED', { target: getElementSummary(target) });
        return true;
      }

      overlay.magnifierCloneRoot.tabIndex = -1;
      try {
        const start = typeof view?.performance?.now === 'function' ? view.performance.now() : Date.now();
        const clone = target.cloneNode(true);
        const duration = (typeof view?.performance?.now === 'function' ? view.performance.now() : Date.now()) - start;
        if (duration > MAGNIFIER_CLONE_MAX_MS) {
          disableMagnifierForPerf(duration);
          return false;
        }
        sanitizeMagnifierClone(clone);
        while (overlay.magnifierCloneRoot.firstChild) {
          overlay.magnifierCloneRoot.removeChild(overlay.magnifierCloneRoot.firstChild);
        }
        overlay.magnifierCloneRoot.appendChild(clone);
        overlay.magnifierSourceEl = target;
        recordMagnifierCloneBuild();
        ultraFocusDebugLog('CLONE_REBUILT', { target: getElementSummary(target) });
        return true;
      } catch (error) {
        magnifierDisabled = true;
        ultraFocusState.magnifierDisabledByPerf = true;
        overlay.magnifierSourceEl = null;
        if (overlay?.magnifierClip) {
          overlay.magnifierClip.style.display = 'none';
        }
        while (overlay.magnifierCloneRoot.firstChild) {
          overlay.magnifierCloneRoot.removeChild(overlay.magnifierCloneRoot.firstChild);
        }
        ultraFocusDebugLog('CLONE_FAILED', {
          target: getElementSummary(target),
          error: error instanceof Error ? error.message : null,
        });
        return false;
      }
    };

    const schedulePostZoomRender = () => {
      if (!enabled) return;
      if (zoomRafId !== null) {
        caf(zoomRafId);
      }
      zoomRafId = raf(() => {
        zoomRafId = null;
        markDirty();
      });
    };

    const scheduleFinalRectSyncAfterTransform = (target) => {
      if (!target || typeof target.addEventListener !== 'function') {
        setTimeout(scheduleUpdate, 250);
        return;
      }
      let completed = false;
      const finalize = () => {
        if (completed) return;
        completed = true;
        scheduleUpdate();
      };
      const onTransition = (event) => {
        if (event?.propertyName && !String(event.propertyName).includes('transform')) {
          return;
        }
        clearTimeout(fallbackId);
        target.removeEventListener('transitionend', onTransition);
        target.removeEventListener('transitioncancel', onTransition);
        finalize();
      };
      const fallbackId = setTimeout(() => {
        target.removeEventListener('transitionend', onTransition);
        target.removeEventListener('transitioncancel', onTransition);
        finalize();
      }, 250);
      target.addEventListener('transitionend', onTransition, { once: true });
      target.addEventListener('transitioncancel', onTransition, { once: true });
    };

    const setState = (nextState) => {
      if (state === nextState) return;
      const prev = state;
      state = nextState;
      ultraFocusDebugLog('UF_STATE', { from: prev, to: nextState });
    };

    const setupObserver = () => {
      if (!scopeRoot) return;
      if (observer) {
        observer.disconnect();
      }

      const thresholds = [0, 0.1, 0.25, 0.5, 0.75, 1];
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry?.target) return;
          ratios.set(entry.target, entry);
        });
        scheduleUpdate();
      }, { threshold: thresholds });

      const paragraphs = collectParagraphs(scopeRoot);
      paragraphs.forEach((node) => observer.observe(node));
    };

    const destroyObserver = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      ratios.clear();
    };

    const logPickResult = (label, point, result) => {
      if (!isUltraFocusDebugEnabled()) return;
      ultraFocusDebugLog(label, {
        point: point ? { x: Math.round(point.x), y: Math.round(point.y) } : null,
        candidates: result?.scoredCandidates?.map((entry) => ({
          ...getElementSummary(entry.element),
          score: Number(entry.score.toFixed(3)),
          reason: entry.reason,
        })),
        selected: result?.picked ? getElementSummary(result.picked) : null,
      });
    };

    const isEditableTarget = (target) => {
      if (!target) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName || '';
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
    };

    const setPointerFromEvent = (event) => {
      if (!event) return;
      if (locked) return;
      if (shouldIgnoreElement(event?.target, pickerOptions)) return;
      const x = toFiniteNumber(event.clientX);
      const y = toFiniteNumber(event.clientY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      lastPointer = { x, y };
      lastPointerAt = Date.now();
      scheduleUpdate();
    };

    const pickFromPointer = (point) => {
      const result = pickCandidateFromPoint(doc, point, pickerOptions);
      logPickResult('UF_PICK_POINT', point, result);
      logPickResult('UF_PICK_CANDIDATES', point, result);
      if (result?.picked) {
        ultraFocusDebugLog('UF_PICK_SELECTED', {
          selected: getElementSummary(result.picked),
        });
      }
      return result;
    };

    const destroyResizeObserver = () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      observedTarget = null;
      if (resizeRafId !== null) {
        caf(resizeRafId);
        resizeRafId = null;
      }
      resizeScheduled = false;
    };

    const enableFocusOverlayLock = (target) => {
      if (!target) return;
      if (!focusEngineController) {
        focusEngineController = getFocusEngineController();
      }
      if (!focusEngineController) return;
      focusEngineController.setMode?.('rect');
      focusEngineController.setEnabled?.(true, { overlayOptions: { alpha: DEFAULT_ALPHA } });
    };

    const disableFocusOverlayLock = () => {
      if (!focusEngineController) return;
      focusEngineController.setTargetRect?.(null);
      focusEngineController.setEnabled?.(false);
    };

    const buildRect = (rect) => {
      if (!rect) return null;
      const left = rect.left;
      const top = rect.top;
      const width = rect.width;
      const height = rect.height;
      if (![left, top, width, height].every(Number.isFinite)) return null;
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    };

    const applyScale = (target, viewport) => {
      if (!target?.classList) return;
      if (scaledTargets.has(target)) return;
      if (!isZoomEligibleTarget(view, target, viewport)) {
        scaledTargets.set(target, { mode: 'skipped' });
        return;
      }
      const style = getComputedStyleSafe(view, target);
      const transform = style?.transform;
      const filter = style?.filter;
      if (!transform || transform === 'none') {
        target.classList.add(ZOOMED_CLASS);
        scaledTargets.set(target, { mode: 'scale' });
        return;
      }
      if (!filter || filter === 'none') {
        target.classList.add(ZOOMED_FALLBACK_CLASS);
        scaledTargets.set(target, { mode: 'fallback' });
        return;
      }
      target.classList.add(ZOOMED_TEXT_CLASS);
      scaledTargets.set(target, { mode: 'text' });
    };

    const removeScale = (target) => {
      if (!target?.classList) return;
      const prev = scaledTargets.get(target);
      if (!prev) return;
      target.classList.remove(ZOOMED_CLASS, ZOOMED_FALLBACK_CLASS, ZOOMED_TEXT_CLASS);
      scaledTargets.delete(target);
    };

    const setExpandedTarget = (target, viewport) => {
      if (expandedTarget === target) return;
      if (expandedTarget) {
        removeScale(expandedTarget);
      }
      expandedTarget = target;
      if (expandedTarget) {
        applyScale(expandedTarget, viewport);
        ensureMagnifierClone(expandedTarget);
      }
    };

    const resolveZoomTarget = (candidate, viewport) => {
      if (!viewport || !viewport.width || !viewport.height) {
        return null;
      }

      const isEligible = (el) => el && el.isConnected && isZoomEligibleTarget(view, el, viewport);
      if (isEligible(candidate)) return candidate;

      let current = candidate?.parentElement || null;
      while (current) {
        if (isEligible(current)) return current;
        if (current === scopeRoot) break;
        current = current.parentElement;
      }

      const fallbackScope = scopeRoot || getScopeRoot(doc);
      if (isEligible(fallbackScope)) return fallbackScope;

      return null;
    };

    const setExpanded = (nextExpanded, target = null, options = {}) => {
      let resolvedTarget = target;
      let resolvedOptions = options;
      if (typeof target === 'string') {
        resolvedTarget = null;
        resolvedOptions = { ...options, source: target };
      }
      const shouldPersist = resolvedOptions.persist !== false;
      if (shouldPersist) {
        desiredExpanded = nextExpanded === true;
        ultraFocusState.desiredExpanded = desiredExpanded;
      }

      if (!locked && nextExpanded === true) {
        return;
      }

      const wasExpanded = expanded;
      expanded = nextExpanded === true;
      if (!overlay?.expandButton) {
        expanded = false;
      }
      if (!expanded) {
        overlay?.expandButton?.setAttribute?.('aria-pressed', 'false');
        const zoomedEl = wasExpanded ? (expandedTarget || preZoomTarget || lockedElement || bestCandidate) : null;
        setExpandedTarget(null, null);
        zoomBoostUntil = 0;
        if (wasExpanded) {
          const viewport = getViewport(doc);
          const restoreTarget = resolvedTarget || lockedElement || bestCandidate || preZoomTarget;
          let restoreRect = preZoomRect;
          if (!restoreRect && restoreTarget) {
            try {
              restoreRect = normalizeRect(restoreTarget.getBoundingClientRect?.(), viewport);
            } catch (error) {
              restoreRect = null;
            }
          }
          if (restoreRect) {
            lastGoodRect = restoreRect;
            targetRect = restoreRect;
            currentRect = restoreRect;
          }
          preZoomRect = null;
          preZoomTarget = null;
          if (!resolvedOptions.skipRender) {
            schedulePostZoomRender();
            scheduleFinalRectSyncAfterTransform(zoomedEl);
          }
        } else {
          if (!resolvedOptions.skipRender) {
            scheduleUpdate();
          }
        }
        ultraFocusDebugLog('UF_ZOOM_APPLY', { enabled: false, source: resolvedOptions.source || null });
        setState(locked ? 'locked' : enabled ? 'selecting' : 'idle');
        return;
      }
      overlay?.expandButton?.setAttribute?.('aria-pressed', 'true');
      if (!resolvedTarget) {
        resolvedTarget = lockedElement || bestCandidate;
      }
      const viewport = getViewport(doc);
      const resolvedZoomTarget = resolveZoomTarget(resolvedTarget, viewport);
      if (!resolvedZoomTarget) {
        expanded = false;
        overlay?.expandButton?.setAttribute?.('aria-pressed', 'false');
        setExpandedTarget(null, null);
        zoomBoostUntil = 0;
        preZoomRect = null;
        preZoomTarget = null;
        ultraFocusDebugLog('UF_ZOOM_APPLY', {
          enabled: false,
          reason: 'NO_ZOOM_TARGET',
          source: resolvedOptions.source || null,
        });
        setState(locked ? 'locked' : enabled ? 'selecting' : 'idle');
        if (!resolvedOptions.skipRender) {
          schedulePostZoomRender();
        }
        return;
      }
      if (!wasExpanded) {
        try {
          preZoomRect = normalizeRect(resolvedZoomTarget.getBoundingClientRect?.(), viewport);
        } catch (error) {
          preZoomRect = null;
        }
        preZoomTarget = resolvedZoomTarget;
        if (preZoomRect) {
          lastGoodRect = preZoomRect;
          targetRect = preZoomRect;
          currentRect = preZoomRect;
        }
      }
      zoomBoostUntil = Date.now() + ZOOM_LERP_BOOST_MS;
      ultraFocusDebugLog('UF_ZOOM_APPLY', {
        enabled: true,
        source: resolvedOptions.source || null,
        targetRect: resolvedZoomTarget
          ? (() => {
              try {
                const rect = resolvedZoomTarget.getBoundingClientRect?.();
                return rect
                  ? {
                      left: Math.round(rect.left),
                      top: Math.round(rect.top),
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                    }
                  : null;
              } catch (error) {
                return null;
              }
            })()
          : null,
      });
      setExpandedTarget(resolvedZoomTarget, viewport);
      setState('lockedZoomed');
      if (!resolvedOptions.skipRender) {
        schedulePostZoomRender();
      }
    };

    const setLocked = (nextLocked, target = null) => {
      locked = nextLocked;
      lockedElement = nextLocked ? target : null;
      if (!overlay?.root) return;
      if (nextLocked) {
        overlay.root.setAttribute(LOCK_ATTR, '1');
        if (target) {
          enableFocusOverlayLock(target);
        }
      } else {
        overlay.root.removeAttribute(LOCK_ATTR);
        disableFocusOverlayLock();
        if (expanded) {
          setExpanded(false);
        }
      }
      if (nextLocked) {
        setState(expanded ? 'lockedZoomed' : 'locked');
        if (expanded && target) {
          setExpandedTarget(target, getViewport(doc));
        }
      } else {
        setState(enabled ? 'selecting' : 'idle');
      }
      scheduleUpdate();
    };

    const updateSuspensionState = () => {
      const module = getFocusOverlayModule();
      const shouldSuspend = module?.shouldSuspendFocusOverlayV2?.(doc) === true;
      if (shouldSuspend === isSuspended) {
        return;
      }
      isSuspended = shouldSuspend;
      if (isSuspended) {
        setOverlayVisible(overlay, false);
        targetRect = null;
        currentRect = null;
        if (expanded) {
          setExpanded(false);
        }
        if (locked) {
          disableFocusOverlayLock();
        }
      } else if (locked && lockedElement) {
        enableFocusOverlayLock(lockedElement);
      }
    };

    const pickBestCandidate = () => {
      if (!scopeRoot) return null;
      const entries = Array.from(ratios.entries());
      let best = null;
      let bestScore = 0;

      entries.forEach(([node, entry]) => {
        if (!node?.isConnected) {
          ratios.delete(node);
          return;
        }
        const length = getTextLength(node);
        if (length < MIN_TEXT_LENGTH) return;
        const score = scoreCandidate(entry, length);
        if (score > bestScore) {
          bestScore = score;
          best = node;
        }
      });

      return best || pickFallbackCandidate(scopeRoot);
    };

    const renderFrame = () => {
      if (!enabled) return;

      updateSuspensionState();
      if (isSuspended) {
        targetRect = null;
        currentRect = null;
        setOverlayVisible(overlay, false);
        setIconRect(overlay, null, null, false);
        setLensRect(overlay, null);
        setExpandRect(overlay, null, null, false);
        setControlsVisible(overlay, false);
        if (locked && focusEngineController) {
          focusEngineController.setTargetRect?.(null);
        }
        return;
      }

      if (!scopeRoot || !scopeRoot.isConnected) {
        scopeRoot = getScopeRoot(doc);
      if (!scopeRoot) {
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, true);
        setLensRect(overlay, null);
        const viewport = getViewport(doc);
        setIconRect(overlay, null, viewport, true, lastGoodRect);
        setExpandDisabled(overlay, true);
        setExpandRect(overlay, null, viewport, true, lastGoodRect);
        return;
      }
      setupObserver();
    }

      const viewport = getViewport(doc);
      if (!viewport.width || !viewport.height) {
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, true);
        setIconRect(overlay, null, viewport, true, lastGoodRect);
        setExpandDisabled(overlay, true);
        setExpandRect(overlay, null, viewport, true, lastGoodRect);
        return;
      }

      if (expanded && !locked) {
        setExpanded(false);
      }

      if (expanded) {
        if (!expandedTarget || !expandedTarget.isConnected) {
          const fallbackTarget = resolveZoomTarget(lockedElement || bestCandidate, viewport);
          if (fallbackTarget) {
            setExpandedTarget(fallbackTarget, viewport);
          } else {
            setExpanded(false, null, { persist: false });
          }
        }
      } else if (desiredExpanded && locked) {
        const fallbackTarget = resolveZoomTarget(lockedElement || bestCandidate, viewport);
        if (fallbackTarget) {
          setExpanded(true, fallbackTarget, { persist: false });
        }
      }

      let target = null;
      if (expanded) {
        observeTargetResize(null);
        if (lockedElement && lockedElement !== expandedTarget) {
          setExpandedTarget(lockedElement, getViewport(doc));
        }
      } else if (locked) {
        target = lockedElement;
      } else if (lastPointer) {
        const result = pickFromPointer(lastPointer);
        bestCandidate = result?.picked || null;
        target = bestCandidate;
      }

      if (!expanded && !target) {
        target = pickBestCandidate();
        bestCandidate = target;
      }

      if (!expanded && !target) {
        bestCandidate = null;
        observeTargetResize(null);
        targetRect = null;
        currentRect = null;
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, true);
        setIconRect(overlay, null, viewport, true, lastGoodRect);
        setExpandDisabled(overlay, true);
        setExpandRect(overlay, null, viewport, true, lastGoodRect);
        return;
      }

      if (!expanded && target) {
        observeTargetResize(target);
      }

      if (renderDirty || !targetRect) {
        let rect = null;
        if (expanded) {
          rect = getExpandedRect(viewport);
        } else {
          try {
            rect = target?.getBoundingClientRect?.() || null;
          } catch (error) {
            rect = null;
          }
          rect = normalizeRect(rect, viewport);
        }

        if (!rect) {
          setOverlayVisible(overlay, false);
          observeTargetResize(null);
          targetRect = null;
          currentRect = null;
          setControlsVisible(overlay, true);
          setIconRect(overlay, null, viewport, true, lastGoodRect);
          setExpandDisabled(overlay, true);
          setExpandRect(overlay, null, viewport, true, lastGoodRect);
          return;
        }

        targetRect = rect;
        renderDirty = false;
      }

      if (!targetRect) {
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, true);
        setIconRect(overlay, null, viewport, true, lastGoodRect);
        setExpandDisabled(overlay, true);
        setExpandRect(overlay, null, viewport, true, lastGoodRect);
        return;
      }

      const reduceMotion = prefersReducedMotion(view);
      const nextTarget = buildRect(targetRect);
      if (!nextTarget) {
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, true);
        setIconRect(overlay, null, viewport, true, lastGoodRect);
        setExpandDisabled(overlay, true);
        setExpandRect(overlay, null, viewport, true, lastGoodRect);
        return;
      }

      let nextRect = nextTarget;
      let maxDelta = 0;
      const lerpAlpha = expanded && Date.now() < zoomBoostUntil ? ZOOM_LERP_BOOST : LENS_LERP_ALPHA;
      if (!reduceMotion && currentRect) {
        const deltaLeft = nextTarget.left - currentRect.left;
        const deltaTop = nextTarget.top - currentRect.top;
        const deltaWidth = nextTarget.width - currentRect.width;
        const deltaHeight = nextTarget.height - currentRect.height;
        maxDelta = Math.max(
          Math.abs(deltaLeft),
          Math.abs(deltaTop),
          Math.abs(deltaWidth),
          Math.abs(deltaHeight),
        );
        if (maxDelta > LENS_SNAP_THRESHOLD) {
          nextRect = nextTarget;
        } else {
          const left = lerp(currentRect.left, nextTarget.left, lerpAlpha);
          const top = lerp(currentRect.top, nextTarget.top, lerpAlpha);
          const width = lerp(currentRect.width, nextTarget.width, lerpAlpha);
          const height = lerp(currentRect.height, nextTarget.height, lerpAlpha);
          nextRect = buildRect({ left, top, width, height });
        }
      }

      if (reduceMotion || !currentRect) {
        nextRect = nextTarget;
      }

      currentRect = nextRect;
      if (!expanded) {
        lastGoodRect = currentRect || lastGoodRect;
      } else if (preZoomRect) {
        lastGoodRect = preZoomRect;
      }

      setOverlayVisible(overlay, true);
      setControlsVisible(overlay, true);
      setLensRect(overlay, currentRect);
      setIconRect(overlay, currentRect, viewport, true, lastGoodRect);
      setExpandDisabled(overlay, false);
      setExpandRect(overlay, currentRect, viewport, true, lastGoodRect);
      setLensRadius(overlay, maxDelta);
      const magnifierActive = isMagnifierEnabled() && !magnifierDisabled && expanded;
      if (!magnifierActive) {
        if (overlay?.magnifierClip) {
          overlay.magnifierClip.style.display = 'none';
        }
      } else if (overlay?.magnifierClip && overlay?.magnifierStage && expandedTarget && currentRect) {
        let targetRect = null;
        try {
          targetRect = normalizeRect(expandedTarget.getBoundingClientRect?.(), viewport);
        } catch (error) {
          targetRect = null;
        }
        if (!targetRect) {
          overlay.magnifierClip.style.display = 'none';
        } else if (ensureMagnifierClone(expandedTarget)) {
          const clipRect = currentRect;
          overlay.magnifierClip.style.display = 'block';
          overlay.magnifierClip.style.left = `${clipRect.left}px`;
          overlay.magnifierClip.style.top = `${clipRect.top}px`;
          overlay.magnifierClip.style.width = `${clipRect.width}px`;
          overlay.magnifierClip.style.height = `${clipRect.height}px`;

          const tx = targetRect.left - clipRect.left;
          const ty = targetRect.top - clipRect.top;
          if ('translate' in overlay.magnifierStage.style && 'scale' in overlay.magnifierStage.style) {
            overlay.magnifierStage.style.translate = `${tx}px ${ty}px`;
            overlay.magnifierStage.style.scale = String(MAGNIFIER_SCALE);
            overlay.magnifierStage.style.transform = '';
          } else {
            overlay.magnifierStage.style.transform = `translate(${tx}px, ${ty}px) scale(${MAGNIFIER_SCALE})`;
          }
        } else {
          overlay.magnifierClip.style.display = 'none';
        }
      } else if (overlay?.magnifierClip) {
        overlay.magnifierClip.style.display = 'none';
      }

      if (locked && focusEngineController) {
        focusEngineController.setMode?.('rect');
        focusEngineController.setEnabled?.(true, { overlayOptions: { alpha: DEFAULT_ALPHA } });
        focusEngineController.setTargetRect?.({
          x: currentRect.left,
          y: currentRect.top,
          w: currentRect.width,
          h: currentRect.height,
        });
      }

      if (renderDirty || (!reduceMotion && maxDelta > LENS_SETTLE_EPSILON)) {
        scheduleRender();
      }
    };

    const onScroll = () => scheduleUpdate();
    const onResize = () => scheduleUpdate();

    const onIconClick = async (event) => {
      if (!enabled) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (expanded) {
        const focusTarget = lockedElement || bestCandidate || preZoomTarget;
        await setExpanded(false, null, { source: 'focus-click', skipRender: false });
        if (focusTarget) {
          setLocked(true, focusTarget);
        }
        return;
      }
      if (locked) {
        setLocked(false, null);
        return;
      }
      if (bestCandidate) {
        setLocked(true, bestCandidate);
      }
    };

    const onExpandClick = (event) => {
      if (!enabled) {
        ultraFocusDebugLog('UF_ZOOM_CLICK', { allowed: false, reasonIfBlocked: 'DISABLED_STATE', state });
        return;
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (expanded) {
        ultraFocusDebugLog('UF_ZOOM_CLICK', { allowed: true, state });
        setExpanded(false);
        return;
      }
      const target = lockedElement || bestCandidate;
      if (!target) {
        ultraFocusDebugLog('UF_ZOOM_CLICK', { allowed: false, reasonIfBlocked: 'NO_TARGET', state });
        return;
      }
      ultraFocusDebugLog('UF_ZOOM_CLICK', { allowed: true, state });
      if (!locked) {
        setLocked(true, target);
      }
      setExpanded(true, target);
    };

    const onControlsClick = (event) => {
      const iconTarget = event?.target?.closest?.(`[${ICON_ATTR}]`);
      if (iconTarget && overlay?.controlsRoot?.contains?.(iconTarget)) {
        onIconClick(event);
        return;
      }
      const expandTarget = event?.target?.closest?.(`[${EXPAND_ATTR}]`);
      if (!expandTarget) return;
      if (!overlay?.controlsRoot?.contains?.(expandTarget)) return;
      onExpandClick(event);
    };

    const onDocumentClick = (event) => {
      if (!locked) return;
      const target = event?.target;
      if (target === overlay.icon || overlay.icon?.contains?.(target)) {
        return;
      }
      if (lockedElement && lockedElement.contains?.(target)) {
        return;
      }
      setLocked(false, null);
    };

    const onPointerMove = (event) => {
      if (!enabled || locked) return;
      setPointerFromEvent(event);
    };

    const onPointerDown = (event) => {
      if (!enabled || locked) return;
      setPointerFromEvent(event);
    };

    const onKeydown = (event) => {
      if (!enabled) return;
      if (event?.isTrusted !== true) return;
      if (event?.key === 'Escape' || event?.code === 'Escape') {
        if (!locked) return;
        if (expanded) {
          setExpanded(false);
        } else {
          setLocked(false, null);
        }
        return;
      }

      const key = event?.key || '';
      const direction =
        key === 'ArrowRight'
          ? 'RIGHT'
          : key === 'ArrowLeft'
            ? 'LEFT'
            : key === 'ArrowDown' || key.toLowerCase() === 'j'
              ? 'DOWN'
              : key === 'ArrowUp' || key.toLowerCase() === 'k'
                ? 'UP'
                : null;

      if (!direction) return;
      if (isEditableTarget(event?.target)) return;

      const current = locked ? lockedElement : bestCandidate;
      if (!current) return;

      const next = navigateNeighbor(doc, current, direction, pickerOptions);
      ultraFocusDebugLog('UF_NAV_DIRECTION', {
        direction,
        current: getElementSummary(current),
      });

      if (next) {
        ultraFocusDebugLog('UF_NAV_SELECTED', {
          direction,
          selected: getElementSummary(next),
        });
        if (locked) {
          setLocked(true, next);
        } else {
          bestCandidate = next;
          const rect = next.getBoundingClientRect?.();
          if (rect) {
            lastPointer = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
          scheduleUpdate();
        }
        event?.preventDefault?.();
      }
    };

    const attachListeners = () => {
      if (listenersAttached) return;
      overlay.controlsRoot?.addEventListener?.('click', onControlsClick);
      view?.addEventListener?.('scroll', onScroll, { passive: true });
      view?.addEventListener?.('resize', onResize);
      view?.visualViewport?.addEventListener?.('resize', onResize);
      view?.addEventListener?.('pointermove', onPointerMove, { passive: true });
      view?.addEventListener?.('pointerdown', onPointerDown, { passive: true });
      doc?.addEventListener?.('click', onDocumentClick, true);
      view?.addEventListener?.('keydown', onKeydown, true);
      listenersAttached = true;
    };

    const detachListeners = () => {
      if (!listenersAttached) return;
      overlay.controlsRoot?.removeEventListener?.('click', onControlsClick);
      view?.removeEventListener?.('scroll', onScroll, { passive: true });
      view?.removeEventListener?.('resize', onResize);
      view?.visualViewport?.removeEventListener?.('resize', onResize);
      view?.removeEventListener?.('pointermove', onPointerMove, { passive: true });
      view?.removeEventListener?.('pointerdown', onPointerDown, { passive: true });
      doc?.removeEventListener?.('click', onDocumentClick, true);
      view?.removeEventListener?.('keydown', onKeydown, true);
      listenersAttached = false;
    };

    const setEnabled = (nextEnabled) => {
      if (!nextEnabled) {
        enabled = false;
        setLocked(false, null);
        setExpanded(false);
        detachListeners();
        destroyObserver();
        destroyResizeObserver();
        clearMagnifierNodes(overlay);
        if (renderRafId !== null) {
          caf(renderRafId);
          renderRafId = null;
        }
        if (zoomRafId !== null) {
          caf(zoomRafId);
          zoomRafId = null;
        }
        renderScheduled = false;
        renderDirty = false;
        targetRect = null;
        currentRect = null;
        lastPointer = null;
        lastPointerAt = 0;
        setState('idle');
        setOverlayVisible(overlay, false);
        setControlsVisible(overlay, false);
        return;
      }

      if (enabled) {
        markDirty();
        return;
      }

      enabled = true;
      if (isMagnifierEnabled() && !magnifierDisabled && !overlay?.magnifierClip) {
        const nodes = createMagnifierNodes(doc);
        overlay.magnifierClip = nodes.magnifierClip;
        overlay.magnifierStage = nodes.magnifierStage;
        overlay.magnifierCloneRoot = nodes.magnifierCloneRoot;
        overlay.magnifierSourceEl = nodes.magnifierSourceEl;
      }
      setState(locked ? (expanded ? 'lockedZoomed' : 'locked') : 'selecting');
      scopeRoot = getScopeRoot(doc);
      if (scopeRoot) {
        setupObserver();
      } else {
        setOverlayVisible(overlay, false);
      }
      setControlsVisible(overlay, true);
      attachListeners();
      markDirty();
    };

    const lock = (nextLocked) => {
      if (!enabled) return;
      if (nextLocked) {
        if (bestCandidate) {
          setLocked(true, bestCandidate);
        }
      } else {
        setLocked(false, null);
      }
    };

    const destroy = () => {
      setEnabled(false);
      disableFocusOverlayLock();
      setExpanded(false);
      destroyResizeObserver();
      if (zoomRafId !== null) {
        caf(zoomRafId);
        zoomRafId = null;
      }
      focusEngineController = null;
      scopeRoot = null;
      bestCandidate = null;
      lockedElement = null;
      try {
        overlay.root?.remove?.();
      } catch (error) {
        // ignore cleanup errors
      }
      try {
        overlay.controlsRoot?.remove?.();
      } catch (error) {
        // ignore cleanup errors
      }
    };

    return {
      setEnabled,
      lock,
      destroy,
      update: markDirty,
    };
  }

  function initUltraFocusBridge() {
    if (globalThis.__AURA_ULTRA_FOCUS_BOUND__) {
      return globalThis.__AURA_ULTRA_FOCUS_BRIDGE__ || null;
    }

    globalThis.__AURA_ULTRA_FOCUS_BOUND__ = true;

    let controller = null;
    const ensureController = () => {
      if (controller) return controller;
      controller = createController(document);
      return controller;
    };

    const setState = (detail = {}) => {
      const enabled = detail.enabled === true;
      const resolved = ensureController();
      if (!resolved) return;
      if (!enabled) {
        resolved.destroy?.();
        controller = null;
        return;
      }

      resolved.setEnabled(true);
    };

    const setLock = (detail = {}) => {
      const lock = detail.lock === true;
      if (!lock && !controller) {
        return;
      }
      const resolved = ensureController();
      if (!resolved) return;
      resolved.lock(lock);
    };

    const bridge = Object.freeze({ setState, setLock });
    globalThis.__AURA_ULTRA_FOCUS_BRIDGE__ = bridge;
    return bridge;
  }

  const ultraFocusBridge = initUltraFocusBridge();

  globalThis.AURA_ULTRA_FOCUS = Object.freeze({
    OVERLAY_ATTR,
    OVERLAY_VERSION,
    LENS_ATTR,
    ICON_ATTR,
    LOCK_ATTR,
    setState: ultraFocusBridge?.setState,
    setLock: ultraFocusBridge?.setLock,
    createController,
  });
})();
