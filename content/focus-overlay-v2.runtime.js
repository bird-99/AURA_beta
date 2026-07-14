(() => {
  const OVERLAY_ATTR = 'data-aura-focus-overlay';
  const OVERLAY_VERSION = 'v2';
  const HOLE_ATTR = 'data-aura-focus-overlay-hole';
  const LEGACY_PANEL_ATTR = 'data-aura-panel';
  const BLOCKER_ATTR = 'data-aura-focus-overlay-blocker';
  const BLUR_PANEL_ATTR = 'data-aura-focus-overlay-blur';
  const BLOCKER_KEYS = ['top', 'right', 'bottom', 'left'];
  const BLUR_PANEL_KEYS = ['top', 'right', 'bottom', 'left'];
  const PANEL_ALPHA = 0.2;
  const DEFAULT_PADDING_PX = 8;
  const DEFAULT_RADIUS_PX = 12;
  const DEFAULT_TRANSITION_MS = 160;
  const DEFAULT_BLUR_PX = 0;
  const MAX_BLUR_PX = 24;
  const MAX_Z_INDEX = 2147483646;
  const SHADOW_SPREAD_PX = 9999;
  const HOLE_OUTLINE = '2px solid rgba(255, 255, 255, 0.16)';
  const HOLE_INNER_SHADOW = 'inset 0 0 16px rgba(0, 0, 0, 0.18)';
  const POINTER_BLOCK_OUTSIDE_ALLOWED = false;

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
  }

  function normalizeAlpha(value, fallback = PANEL_ALPHA) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 1);
  }

  function normalizePadding(value, fallback = DEFAULT_PADDING_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 80);
  }

  function normalizeRadius(value, fallback = DEFAULT_RADIUS_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 120);
  }

  function normalizeTransitionMs(value, fallback = DEFAULT_TRANSITION_MS) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 600);
  }

  function normalizeBlurPx(value, fallback = DEFAULT_BLUR_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, MAX_BLUR_PX);
  }

  function isModeEngineDebugEnabled() {
    try {
      return Boolean(globalThis?.AURA?.modeEngineFlags?.isEnabled?.('debugModeEngine'));
    } catch (_) {
      return false;
    }
  }

  function focusOverlayDebugLog(...args) {
    if (!isModeEngineDebugEnabled()) {
      return;
    }

    const logger = globalThis?.AURA?.modeEngineDebugLog;
    if (typeof logger === 'function') {
      logger(...args);
      return;
    }

    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[AURA][FocusOverlay]', ...args);
    }
  }

  function setOverlayVisible(handle, visible) {
    if (!handle?.root) return;
    handle.root.style.display = visible ? 'block' : 'none';
  }

  function setPanelAlpha(handle, alpha) {
    const resolved = normalizeAlpha(alpha, PANEL_ALPHA);
    if (handle?.overlayMode === 'blur') {
      setBlurPanelAlpha(handle, resolved);
      return;
    }
    if (!handle?.hole) return;
    handle.hole.style.boxShadow = `0 0 0 ${SHADOW_SPREAD_PX}px rgba(0, 0, 0, ${resolved}), ${HOLE_INNER_SHADOW}`;
  }

  function applyHoleBaseStyles(hole, alpha, transitionMs) {
    if (!hole) return;
    hole.style.position = 'fixed';
    hole.style.top = '0px';
    hole.style.left = '0px';
    hole.style.width = '0px';
    hole.style.height = '0px';
    hole.style.pointerEvents = 'none';
    hole.style.background = 'transparent';
    hole.style.boxShadow = `0 0 0 ${SHADOW_SPREAD_PX}px rgba(0, 0, 0, ${normalizeAlpha(alpha)}), ${HOLE_INNER_SHADOW}`;
    hole.style.outline = HOLE_OUTLINE;
    hole.style.outlineOffset = '0px';
    setHoleTransition(hole, transitionMs);
  }

  function setHoleTransition(hole, transitionMs) {
    if (!hole) return;
    const duration = normalizeTransitionMs(transitionMs, DEFAULT_TRANSITION_MS);
    hole.style.transition = `transform ${duration}ms ease, width ${duration}ms ease, height ${duration}ms ease, border-radius ${duration}ms ease, box-shadow ${duration}ms ease`;
  }

  function setBlurPanelTransition(panels, transitionMs) {
    if (!panels) return;
    const duration = normalizeTransitionMs(transitionMs, DEFAULT_TRANSITION_MS);
    const transition = `top ${duration}ms ease, left ${duration}ms ease, width ${duration}ms ease, height ${duration}ms ease, backdrop-filter ${duration}ms ease`;
    Object.values(panels).forEach((panel) => {
      if (!panel) return;
      panel.style.transition = transition;
    });
  }

  function applyRootPointerMode(root, pointerBlockOutside) {
    if (!root) return;
    root.style.pointerEvents = 'none';
  }

  function normalizePointerBlockOutside() {
    return POINTER_BLOCK_OUTSIDE_ALLOWED;
  }

  function shouldSuspendFocusOverlayV2(doc) {
    if (!doc?.querySelector) return false;

    try {
      if (doc.querySelector('dialog[open]')) return true;
      if (doc.querySelector('[aria-modal="true"]')) return true;
      if (doc.querySelector('[role="dialog"]')) return true;
    } catch (error) {
      return true;
    }

    try {
      if (doc.querySelector('[popover]:popover-open')) return true;
    } catch (error) {
      // Ignore selector support errors and rely on fallback below
    }

    try {
      if (doc.querySelector('[popover][open]')) return true;
    } catch (error) {
      return true;
    }

    return false;
  }

  function normalizeRect(rect, viewportWidth, viewportHeight) {
    if (!rect) return null;

    const leftInput = toFiniteNumber(rect.left);
    const topInput = toFiniteNumber(rect.top);
    const rightInput = toFiniteNumber(rect.right);
    const bottomInput = toFiniteNumber(rect.bottom);
    const widthInput = toFiniteNumber(rect.width);
    const heightInput = toFiniteNumber(rect.height);

    if (!Number.isFinite(leftInput) || !Number.isFinite(topInput)) {
      return null;
    }

    const left = clamp(leftInput, 0, viewportWidth);
    const top = clamp(topInput, 0, viewportHeight);
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

    if (!Number.isFinite(rightBase) || !Number.isFinite(bottomBase)) {
      return null;
    }

    const right = clamp(Math.max(left, rightBase), 0, viewportWidth);
    const bottom = clamp(Math.max(top, bottomBase), 0, viewportHeight);

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    if (width <= 0 || height <= 0) {
      return null;
    }

    return { left, top, right, bottom, width, height };
  }

  function applyPadding(rect, padding, viewportWidth, viewportHeight) {
    if (!rect) return null;
    const pad = normalizePadding(padding, DEFAULT_PADDING_PX);

    const left = clamp(rect.left - pad, 0, viewportWidth);
    const top = clamp(rect.top - pad, 0, viewportHeight);
    const width = clamp(rect.width + pad * 2, 0, viewportWidth - left);
    const height = clamp(rect.height + pad * 2, 0, viewportHeight - top);

    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  function buildBlurPanel(doc, key, alpha = PANEL_ALPHA, blurPx = DEFAULT_BLUR_PX) {
    const panel = doc.createElement('div');
    panel.setAttribute(BLUR_PANEL_ATTR, key);
    panel.style.position = 'fixed';
    panel.style.pointerEvents = 'none';
    panel.style.top = '0px';
    panel.style.left = '0px';
    panel.style.width = '0px';
    panel.style.height = '0px';
    panel.style.background = `rgba(0, 0, 0, ${normalizeAlpha(alpha)})`;
    const blurValue = normalizeBlurPx(blurPx, DEFAULT_BLUR_PX);
    if (blurValue > 0) {
      panel.style.backdropFilter = `blur(${blurValue}px)`;
      panel.style.webkitBackdropFilter = `blur(${blurValue}px)`;
    } else {
      panel.style.backdropFilter = 'none';
      panel.style.webkitBackdropFilter = 'none';
    }
    panel.style.zIndex = String(MAX_Z_INDEX);
    return panel;
  }

  function ensureBlurPanels(doc, root, alpha = PANEL_ALPHA, blurPx = DEFAULT_BLUR_PX) {
    const panels = {};

    BLUR_PANEL_KEYS.forEach((key) => {
      const existing = root.querySelector?.(`[${BLUR_PANEL_ATTR}="${key}"]`) || null;
      const panel = existing || buildBlurPanel(doc, key, alpha, blurPx);
      if (!existing) {
        root.appendChild(panel);
      }
      panels[key] = panel;
    });

    setBlurPanelAlpha({ blurPanels: panels }, alpha);
    setBlurPanelBlurPx({ blurPanels: panels }, blurPx);

    return panels;
  }

  function removeBlurPanels(handle) {
    if (!handle?.root) return;
    const panels = handle.blurPanels || {};
    Object.values(panels).forEach((panel) => {
      try {
        panel?.remove?.();
      } catch (_) {
        // ignore cleanup errors
      }
    });
    handle.root.querySelectorAll?.(`[${BLUR_PANEL_ATTR}]`)?.forEach((panel) => {
      try {
        panel.remove();
      } catch (_) {
        // ignore cleanup errors
      }
    });
    handle.blurPanels = null;
  }

  function setBlurPanelAlpha(handle, alpha) {
    if (!handle?.blurPanels) return;
    const resolved = normalizeAlpha(alpha, PANEL_ALPHA);
    Object.values(handle.blurPanels).forEach((panel) => {
      if (!panel) return;
      panel.style.background = `rgba(0, 0, 0, ${resolved})`;
    });
  }

  function setBlurPanelBlurPx(handle, blurPx) {
    if (!handle?.blurPanels) return;
    const resolved = normalizeBlurPx(blurPx, DEFAULT_BLUR_PX);
    const value = resolved > 0 ? `blur(${resolved}px)` : 'none';
    Object.values(handle.blurPanels).forEach((panel) => {
      if (!panel) return;
      panel.style.backdropFilter = value;
      panel.style.webkitBackdropFilter = value;
    });
  }

  function getViewport(doc) {
    const view = doc?.defaultView || globalThis;
    const visualViewport = view?.visualViewport;
    const width = toFiniteNumber(doc?.documentElement?.clientWidth);
    const height = toFiniteNumber(doc?.documentElement?.clientHeight);
    const fallbackWidth = toFiniteNumber(view?.innerWidth);
    const fallbackHeight = toFiniteNumber(view?.innerHeight);
    const visualWidth = toFiniteNumber(visualViewport?.width);
    const visualHeight = toFiniteNumber(visualViewport?.height);

    const w = Number.isFinite(visualWidth) && visualWidth > 0
      ? visualWidth
      : Number.isFinite(width) && width > 0
        ? width
        : fallbackWidth;
    const h = Number.isFinite(visualHeight) && visualHeight > 0
      ? visualHeight
      : Number.isFinite(height) && height > 0
        ? height
        : fallbackHeight;

    return {
      w: Number.isFinite(w) && w > 0 ? w : 0,
      h: Number.isFinite(h) && h > 0 ? h : 0,
    };
  }

  function computeFocusRect(scopeEl, viewport) {
    if (!scopeEl) return null;

    const viewportWidth = toFiniteNumber(viewport?.w);
    const viewportHeight = toFiniteNumber(viewport?.h);

    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      return null;
    }

    let rect = null;
    try {
      rect = scopeEl.getBoundingClientRect?.() || null;
    } catch (error) {
      return null;
    }

    if (!rect) return null;

    const widthInput = toFiniteNumber(rect.width);
    const heightInput = toFiniteNumber(rect.height);

    if (!Number.isFinite(widthInput) || !Number.isFinite(heightInput) || widthInput <= 0 || heightInput <= 0) {
      return null;
    }

    const left = clamp(toFiniteNumber(rect.left), 0, viewportWidth);
    const top = clamp(toFiniteNumber(rect.top), 0, viewportHeight);
    const right = clamp(Math.max(left, toFiniteNumber(rect.right)), 0, viewportWidth);
    const bottom = clamp(Math.max(top, toFiniteNumber(rect.bottom)), 0, viewportHeight);

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    if (width <= 0 || height <= 0) {
      return null;
    }

    return { left, top, right, bottom, width, height };
  }

  function buildBlocker(doc, key) {
    const blocker = doc.createElement('div');
    blocker.setAttribute(BLOCKER_ATTR, key);
    blocker.style.position = 'fixed';
    blocker.style.pointerEvents = 'auto';
    blocker.style.top = '0px';
    blocker.style.left = '0px';
    blocker.style.width = '0px';
    blocker.style.height = '0px';
    blocker.style.background = 'transparent';
    blocker.style.zIndex = String(MAX_Z_INDEX);
    return blocker;
  }

  function ensureBlockers(doc, root) {
    const blockers = {};

    BLOCKER_KEYS.forEach((key) => {
      const existing = root.querySelector?.(`[${BLOCKER_ATTR}="${key}"]`) || null;
      const blocker = existing || buildBlocker(doc, key);
      if (!existing) {
        root.appendChild(blocker);
      }
      blockers[key] = blocker;
    });

    return blockers;
  }

  function removeBlockers(handle) {
    if (!handle?.root) return;
    const blockers = handle.blockers || {};
    Object.values(blockers).forEach((blocker) => {
      try {
        blocker?.remove?.();
      } catch (_) {
        // ignore cleanup errors
      }
    });
    handle.root.querySelectorAll?.(`[${BLOCKER_ATTR}]`)?.forEach((blocker) => {
      try {
        blocker.remove();
      } catch (_) {
        // ignore cleanup errors
      }
    });
    handle.blockers = null;
  }

  function getExistingOverlayRoot(doc) {
    if (!doc?.querySelector) return null;
    try {
      return doc.querySelector(`[${OVERLAY_ATTR}="${OVERLAY_VERSION}"]`);
    } catch (error) {
      return null;
    }
  }

  function createFocusOverlayV2(doc, options = {}) {
    const alpha = normalizeAlpha(options?.alpha, PANEL_ALPHA);
    const existing = getExistingOverlayRoot(doc);
    if (existing) {
      existing.querySelectorAll?.(`[${LEGACY_PANEL_ATTR}]`)?.forEach((panel) => {
        try {
          panel.remove();
        } catch (_) {
          // ignore cleanup errors
        }
      });
      let existingHole = existing.querySelector?.(`[${HOLE_ATTR}]`) || null;
      if (!existingHole) {
        existingHole = doc.createElement('div');
        existingHole.setAttribute(HOLE_ATTR, '');
        existing.appendChild(existingHole);
      }
      applyHoleBaseStyles(existingHole, alpha, options?.transitionMs);
      const handle = {
        root: existing,
        hole: existingHole,
        blockers: null,
        pointerBlockOutside: normalizePointerBlockOutside(),
        blurPanels: null,
        overlayMode: 'shadow',
        blurPx: DEFAULT_BLUR_PX,
      };
      removeBlockers(handle);
      const blurPx = normalizeBlurPx(options?.blurPx, DEFAULT_BLUR_PX);
      handle.blurPx = blurPx;
      handle.overlayMode = blurPx > 0 ? 'blur' : 'shadow';
      if (handle.overlayMode === 'blur') {
        handle.blurPanels = ensureBlurPanels(doc, existing, alpha, blurPx);
        setBlurPanelTransition(handle.blurPanels, options?.transitionMs);
        handle.hole.style.boxShadow = HOLE_INNER_SHADOW;
      } else {
        removeBlurPanels(handle);
        handle.hole.style.boxShadow = `0 0 0 ${SHADOW_SPREAD_PX}px rgba(0, 0, 0, ${alpha}), ${HOLE_INNER_SHADOW}`;
      }
      return handle;
    }

    const root = doc?.createElement?.('div');
    if (!root) {
      throw new Error('Cannot create focus overlay without a document');
    }

    root.setAttribute(OVERLAY_ATTR, OVERLAY_VERSION);
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = String(MAX_Z_INDEX);
    root.style.display = 'none';
    root.style.contain = 'layout style paint';

    const hole = doc.createElement('div');
    hole.setAttribute(HOLE_ATTR, '');
    applyHoleBaseStyles(hole, alpha, options?.transitionMs);

    root.appendChild(hole);

    const parent = doc.documentElement || doc.body;
    parent?.appendChild(root);

    focusOverlayDebugLog('Spotlight overlay mounted', {
      parent: parent === doc.documentElement ? 'documentElement' : 'body',
      version: OVERLAY_VERSION,
    });

    const blurPx = normalizeBlurPx(options?.blurPx, DEFAULT_BLUR_PX);
    if (blurPx > 0) {
      hole.style.boxShadow = HOLE_INNER_SHADOW;
    }

    return {
      root,
      hole,
      blockers: null,
      pointerBlockOutside: normalizePointerBlockOutside(),
      blurPanels: blurPx > 0 ? ensureBlurPanels(doc, root, alpha, blurPx) : null,
      overlayMode: blurPx > 0 ? 'blur' : 'shadow',
      blurPx,
    };
  }

  function applyBlockerStyle(blocker, geom) {
    if (!blocker || !geom) return;
    blocker.style.top = `${geom.top}px`;
    blocker.style.left = `${geom.left}px`;
    blocker.style.width = `${geom.width}px`;
    blocker.style.height = `${geom.height}px`;
  }

  function updateFocusOverlayV2(handle, focusRect, viewport, options = {}) {
    if (!handle || !handle.root || !handle.hole) {
      return;
    }

    const viewportWidth = toFiniteNumber(viewport?.w);
    const viewportHeight = toFiniteNumber(viewport?.h);

    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      setOverlayVisible(handle, false);
      return;
    }

    const normalized = normalizeRect(focusRect, viewportWidth, viewportHeight);
    const padded = normalized ? applyPadding(normalized, options.padding, viewportWidth, viewportHeight) : null;
    if (!padded) {
      setOverlayVisible(handle, false);
      return;
    }

    const radius = normalizeRadius(options.radius, DEFAULT_RADIUS_PX);
    const safeRadius = Math.max(0, Math.min(radius, padded.width / 2, padded.height / 2));

    handle.hole.style.width = `${padded.width}px`;
    handle.hole.style.height = `${padded.height}px`;
    handle.hole.style.borderRadius = `${safeRadius}px`;
    handle.hole.style.transform = `translate3d(${padded.left}px, ${padded.top}px, 0)`;

    if (handle.overlayMode === 'blur' && handle.blurPanels) {
      const geometries = {
        top: { top: 0, left: 0, width: viewportWidth, height: padded.top },
        bottom: { top: padded.bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - padded.bottom) },
        left: { top: padded.top, left: 0, width: padded.left, height: padded.height },
        right: { top: padded.top, left: padded.right, width: Math.max(0, viewportWidth - padded.right), height: padded.height },
      };

      BLUR_PANEL_KEYS.forEach((key) => {
        applyBlockerStyle(handle.blurPanels[key], geometries[key]);
      });
    }

    if (handle.blockers) {
      const geometries = {
        top: { top: 0, left: 0, width: viewportWidth, height: padded.top },
        bottom: { top: padded.bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - padded.bottom) },
        left: { top: padded.top, left: 0, width: padded.left, height: padded.height },
        right: { top: padded.top, left: padded.right, width: Math.max(0, viewportWidth - padded.right), height: padded.height },
      };

      BLOCKER_KEYS.forEach((key) => {
        applyBlockerStyle(handle.blockers[key], geometries[key]);
      });
    }

    setOverlayVisible(handle, true);

    focusOverlayDebugLog('Spotlight overlay updated', {
      enabled: true,
      viewport: { w: viewportWidth, h: viewportHeight },
      rect: { x: padded.left, y: padded.top, width: padded.width, height: padded.height },
      pointerBlockOutside: handle.pointerBlockOutside === true,
    });
  }

  function destroyFocusOverlayV2(handle) {
    if (!handle || !handle.root) {
      return;
    }
    try {
      handle.root.remove();
      focusOverlayDebugLog('Spotlight overlay unmounted', { version: OVERLAY_VERSION });
    } catch (error) {
      // ignore cleanup errors
    }
  }

  function createFocusOverlayControllerV2(doc, options = {}) {
    const handle = createFocusOverlayV2(doc, options);
    const view = doc?.defaultView || globalThis;

    let currentScopeEl = null;
    let scheduled = false;
    let running = false;
    let rafId = null;
    let currentAlpha = normalizeAlpha(options?.alpha, PANEL_ALPHA);
    let currentPadding = normalizePadding(options?.padding, DEFAULT_PADDING_PX);
    let currentRadius = normalizeRadius(options?.radius, DEFAULT_RADIUS_PX);
    let currentTransitionMs = normalizeTransitionMs(options?.transitionMs, DEFAULT_TRANSITION_MS);
    let currentBlurPx = normalizeBlurPx(options?.blurPx, DEFAULT_BLUR_PX);
    let pointerBlockOutside = normalizePointerBlockOutside();

    const scrollListenerOptions = { passive: true };

    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (callback) => setTimeout(callback, 16);

    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    const onViewportChange = () => scheduleUpdate();

    function scheduleUpdate() {
      if (!running) {
        return;
      }

      if (scheduled) {
        return;
      }

      scheduled = true;
      rafId = raf(() => {
        scheduled = false;
        rafId = null;

        if (shouldSuspendFocusOverlayV2(doc)) {
          setOverlayVisible(handle, false);
          return;
        }

        const viewport = getViewport(doc);
        const focusRect = computeFocusRect(currentScopeEl, viewport);

        if (!focusRect) {
          setOverlayVisible(handle, false);
          return;
        }

        updateFocusOverlayV2(handle, focusRect, viewport, {
          padding: currentPadding,
          radius: currentRadius,
        });
      });
    }

    function setScopeEl(el) {
      currentScopeEl = el;
      if (running) {
        scheduleUpdate();
      }
    }

    function updateOverlayMode() {
      const nextMode = currentBlurPx > 0 ? 'blur' : 'shadow';
      if (handle.overlayMode !== nextMode) {
        handle.overlayMode = nextMode;
        if (nextMode === 'blur') {
          handle.blurPanels = ensureBlurPanels(doc, handle.root, currentAlpha, currentBlurPx);
        } else {
          removeBlurPanels(handle);
        }
      }

      if (handle.overlayMode === 'blur') {
        handle.hole.style.boxShadow = HOLE_INNER_SHADOW;
        setBlurPanelAlpha(handle, currentAlpha);
        setBlurPanelBlurPx(handle, currentBlurPx);
        setBlurPanelTransition(handle.blurPanels, currentTransitionMs);
      } else {
        handle.hole.style.boxShadow = `0 0 0 ${SHADOW_SPREAD_PX}px rgba(0, 0, 0, ${currentAlpha}), ${HOLE_INNER_SHADOW}`;
      }
    }

    function setEnabled(enabled, opts = {}) {
      const nextAlpha = normalizeAlpha(opts?.alpha, currentAlpha);
      if (Number.isFinite(nextAlpha)) {
        currentAlpha = nextAlpha;
        setPanelAlpha(handle, currentAlpha);
      }

      if (typeof opts?.padding === 'number') {
        currentPadding = normalizePadding(opts.padding, currentPadding);
      }

      if (typeof opts?.radius === 'number') {
        currentRadius = normalizeRadius(opts.radius, currentRadius);
      }

      if (typeof opts?.transitionMs === 'number') {
        currentTransitionMs = normalizeTransitionMs(opts.transitionMs, currentTransitionMs);
        setHoleTransition(handle?.hole, currentTransitionMs);
        setBlurPanelTransition(handle?.blurPanels, currentTransitionMs);
      }

      if (typeof opts?.blurPx === 'number') {
        currentBlurPx = normalizeBlurPx(opts.blurPx, currentBlurPx);
        updateOverlayMode();
      }

      if (typeof opts?.pointerBlockOutside === 'boolean') {
        pointerBlockOutside = normalizePointerBlockOutside();
        handle.pointerBlockOutside = pointerBlockOutside;
        removeBlockers(handle);
      }

      applyRootPointerMode(handle?.root, pointerBlockOutside);

      if (enabled === false) {
        stop();
        return;
      }

      updateOverlayMode();
      start();
    }

    function start() {
      if (running) {
        return;
      }

      running = true;

      setPanelAlpha(handle, currentAlpha);
      applyRootPointerMode(handle?.root, pointerBlockOutside);
      updateOverlayMode();
      view?.addEventListener?.('scroll', onViewportChange, scrollListenerOptions);
      view?.addEventListener?.('resize', onViewportChange);
      view?.visualViewport?.addEventListener?.('scroll', onViewportChange, scrollListenerOptions);
      view?.visualViewport?.addEventListener?.('resize', onViewportChange);

      scheduleUpdate();
    }

    function stop() {
      if (!running) {
        return;
      }

      running = false;

      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }

      scheduled = false;

      view?.removeEventListener?.('scroll', onViewportChange, scrollListenerOptions);
      view?.removeEventListener?.('resize', onViewportChange);
      view?.visualViewport?.removeEventListener?.('scroll', onViewportChange, scrollListenerOptions);
      view?.visualViewport?.removeEventListener?.('resize', onViewportChange);

      setOverlayVisible(handle, false);
    }

    function destroy() {
      stop();
      destroyFocusOverlayV2(handle);
      currentScopeEl = null;
    }

    return {
      handle,
      setScopeEl,
      setEnabled,
      start,
      stop,
      destroy,
    };
  }

  function resolveScopeElement(doc, selectorOrElement) {
    if (!selectorOrElement) return null;
    if (selectorOrElement instanceof Element) return selectorOrElement;
    if (!doc?.querySelector || typeof selectorOrElement !== 'string') return null;
    try {
      return doc.querySelector(selectorOrElement);
    } catch (error) {
      return null;
    }
  }

  function initFocusOverlayBridge() {
    if (globalThis.__AURA_FOCUS_OVERLAY_V2_EVENTS_BOUND__) {
      return globalThis.__AURA_FOCUS_OVERLAY_BRIDGE__ || null;
    }

    globalThis.__AURA_FOCUS_OVERLAY_V2_EVENTS_BOUND__ = true;

    let controller = null;
    let scopeEl = null;
    let running = false;
    let scheduled = false;
    let rafId = null;
    let overlayOptions = {};

    const view = document?.defaultView || globalThis;
    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (callback) => setTimeout(callback, 16);
    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    const scrollListenerOptions = { passive: true };

    const ensureController = () => {
      if (controller) {
        return controller;
      }
      const engine = globalThis.AURA_FOCUS_ENGINE;
      const getShared = engine?.getSharedController;
      if (typeof getShared !== 'function') {
        return null;
      }
      controller = getShared('rect', 'focus-overlay');
      return controller;
    };

    const scheduleUpdate = () => {
      if (!running) return;
      if (scheduled) return;

      scheduled = true;
      rafId = raf(() => {
        scheduled = false;
        rafId = null;

        if (shouldSuspendFocusOverlayV2(document)) {
          controller?.setTargetRect?.(null);
          return;
        }

        const viewport = getViewport(document);
        const focusRect = computeFocusRect(scopeEl, viewport);
        if (!focusRect) {
          controller?.setTargetRect?.(null);
          return;
        }

        controller?.setTargetRect?.({
          x: focusRect.left,
          y: focusRect.top,
          w: focusRect.width,
          h: focusRect.height,
        });
      });
    };

    const start = () => {
      if (running) return;
      running = true;
      view?.addEventListener?.('scroll', scheduleUpdate, scrollListenerOptions);
      view?.addEventListener?.('resize', scheduleUpdate);
      view?.visualViewport?.addEventListener?.('scroll', scheduleUpdate, scrollListenerOptions);
      view?.visualViewport?.addEventListener?.('resize', scheduleUpdate);
      scheduleUpdate();
    };

    const stop = () => {
      if (!running) return;
      running = false;
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      scheduled = false;
      view?.removeEventListener?.('scroll', scheduleUpdate);
      view?.removeEventListener?.('resize', scheduleUpdate);
      view?.visualViewport?.removeEventListener?.('scroll', scheduleUpdate);
      view?.visualViewport?.removeEventListener?.('resize', scheduleUpdate);
    };

    const setState = (detail) => {
      if (!detail || typeof detail !== 'object') {
        return;
      }

      const enabled = detail.enabled;
      const alpha = detail.alpha;
      const blurPx = detail.blurPx;
      const transitionMs = detail.transitionMs;
      const padding = detail.padding;
      const radius = detail.radius;
      const pointerBlockOutside = detail.pointerBlockOutside;
      const scopeTarget = detail.scope;
      const destroy = detail.destroy === true;

      if (scopeTarget !== undefined) {
        scopeEl = resolveScopeElement(document, scopeTarget);
      }

      overlayOptions = {
        ...overlayOptions,
        alpha,
        blurPx,
        transitionMs,
        padding,
        radius,
        pointerBlockOutside,
      };

      if (enabled === false || destroy) {
        stop();
        controller?.setEnabled?.(false, { overlayOptions });
        controller?.setTargetRect?.(null);
        return;
      }

      const resolvedController = ensureController();
      if (!resolvedController) {
        return;
      }

      resolvedController.setMode?.('rect');
      resolvedController.setEnabled?.(true, { overlayOptions });
      start();
    };

    const bridge = Object.freeze({ setState });
    globalThis.__AURA_FOCUS_OVERLAY_BRIDGE__ = bridge;
    return bridge;
  }

  const focusOverlayBridge = initFocusOverlayBridge();

  globalThis.AURA_FOCUS_OVERLAY_V2 = Object.freeze({
    OVERLAY_ATTR,
    OVERLAY_VERSION,
    PANEL_ATTR: HOLE_ATTR,
    PANEL_KEYS: BLOCKER_KEYS,
    PANEL_ALPHA,
    MAX_Z_INDEX,
    setState: focusOverlayBridge?.setState,
    setOverlayVisible,
    setPanelAlpha,
    shouldSuspendFocusOverlayV2,
    getViewport,
    computeFocusRect,
    createFocusOverlayV2,
    updateFocusOverlayV2,
    destroyFocusOverlayV2,
    _normalizeRect: normalizeRect,
    createFocusOverlayControllerV2,
  });
})();
