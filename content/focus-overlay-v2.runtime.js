(() => {
  const OVERLAY_ATTR = 'data-aura-focus-overlay';
  const OVERLAY_VERSION = 'v2';
  const PANEL_ATTR = 'data-aura-panel';
  const PANEL_KEYS = ['top', 'right', 'bottom', 'left'];
  const PANEL_ALPHA = 0.2;
  const MAX_Z_INDEX = 2147483647;

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

  function setOverlayVisible(handle, visible) {
    if (!handle?.root) return;
    handle.root.style.display = visible ? 'block' : 'none';
  }

  function setPanelAlpha(handle, alpha) {
    if (!handle?.panels) return;
    const resolved = normalizeAlpha(alpha, PANEL_ALPHA);
    Object.values(handle.panels).forEach((panel) => {
      panel.style.backgroundColor = `rgba(0, 0, 0, ${resolved})`;
    });
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

  function getViewport(doc) {
    const view = doc?.defaultView || globalThis;
    const width = toFiniteNumber(doc?.documentElement?.clientWidth);
    const height = toFiniteNumber(doc?.documentElement?.clientHeight);
    const fallbackWidth = toFiniteNumber(view?.innerWidth);
    const fallbackHeight = toFiniteNumber(view?.innerHeight);

    const w = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
    const h = Number.isFinite(height) && height > 0 ? height : fallbackHeight;

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

  function buildPanel(doc, key, alpha = PANEL_ALPHA) {
    const panel = doc.createElement('div');
    panel.setAttribute(PANEL_ATTR, key);
    panel.style.position = 'fixed';
    panel.style.pointerEvents = 'none';
    panel.style.top = '0px';
    panel.style.left = '0px';
    panel.style.width = '0px';
    panel.style.height = '0px';
    panel.style.backgroundColor = `rgba(0, 0, 0, ${normalizeAlpha(alpha)})`;
    panel.style.zIndex = String(MAX_Z_INDEX);
    return panel;
  }

  function ensurePanels(doc, root, alpha = PANEL_ALPHA) {
    const panels = {};

    PANEL_KEYS.forEach((key) => {
      const existing = root.querySelector?.(`[${PANEL_ATTR}="${key}"]`) || null;
      const panel = existing || buildPanel(doc, key, alpha);
      if (!existing) {
        root.appendChild(panel);
      }
      panels[key] = panel;
    });

    setPanelAlpha({ panels }, alpha);

    return panels;
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
      return { root: existing, panels: ensurePanels(doc, existing, alpha) };
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

    const panels = ensurePanels(doc, root, alpha);
    const parent = doc.body || doc.documentElement;
    parent?.appendChild(root);

    return { root, panels };
  }

  function applyPanelStyle(panel, geom) {
    if (!panel || !geom) return;
    panel.style.top = `${geom.top}px`;
    panel.style.left = `${geom.left}px`;
    panel.style.width = `${geom.width}px`;
    panel.style.height = `${geom.height}px`;
  }

  function updateFocusOverlayV2(handle, focusRect, viewport) {
    if (!handle || !handle.root || !handle.panels) {
      return;
    }

    const viewportWidth = toFiniteNumber(viewport?.w);
    const viewportHeight = toFiniteNumber(viewport?.h);

    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      setOverlayVisible(handle, false);
      return;
    }

    const normalized = normalizeRect(focusRect, viewportWidth, viewportHeight);
    if (!normalized) {
      setOverlayVisible(handle, false);
      return;
    }

    const geometries = {
      top: { top: 0, left: 0, width: viewportWidth, height: normalized.top },
      bottom: { top: normalized.bottom, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - normalized.bottom) },
      left: { top: normalized.top, left: 0, width: normalized.left, height: normalized.height },
      right: { top: normalized.top, left: normalized.right, width: Math.max(0, viewportWidth - normalized.right), height: normalized.height },
    };

    PANEL_KEYS.forEach((key) => {
      applyPanelStyle(handle.panels[key], geometries[key]);
    });

    setOverlayVisible(handle, true);
  }

  function destroyFocusOverlayV2(handle) {
    if (!handle || !handle.root) {
      return;
    }
    try {
      handle.root.remove();
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

        updateFocusOverlayV2(handle, focusRect, viewport);
      });
    }

    function setScopeEl(el) {
      currentScopeEl = el;
      if (running) {
        scheduleUpdate();
      }
    }

    function setEnabled(enabled, opts = {}) {
      const nextAlpha = normalizeAlpha(opts?.alpha, currentAlpha);
      if (Number.isFinite(nextAlpha)) {
        currentAlpha = nextAlpha;
        setPanelAlpha(handle, currentAlpha);
      }

      if (enabled === false) {
        stop();
        return;
      }

      start();
    }

    function start() {
      if (running) {
        return;
      }

      running = true;

      setPanelAlpha(handle, currentAlpha);
      view?.addEventListener?.('scroll', onViewportChange, scrollListenerOptions);
      view?.addEventListener?.('resize', onViewportChange);

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

  function initFocusOverlayEventBridge() {
    if (globalThis.__AURA_FOCUS_OVERLAY_V2_EVENTS_BOUND__) {
      return;
    }

    globalThis.__AURA_FOCUS_OVERLAY_V2_EVENTS_BOUND__ = true;

    let controller = null;

    const ensureController = () => {
      if (controller) {
        return controller;
      }
      controller = createFocusOverlayControllerV2(document);
      return controller;
    };

    const handler = (event) => {
      if (!event?.detail || typeof event.detail !== 'object') {
        return;
      }

      const detail = event.detail;
      const enabled = detail.enabled;
      const alpha = detail.alpha;
      const scopeTarget = detail.scope;
      const destroy = detail.destroy === true;

      if (destroy && controller) {
        controller.destroy?.();
        controller = null;
        return;
      }

      const resolvedController = ensureController();
      if (!resolvedController) {
        return;
      }

      if (scopeTarget !== undefined) {
        const scopeEl = resolveScopeElement(document, scopeTarget);
        resolvedController.setScopeEl?.(scopeEl);
      }

      resolvedController.setEnabled?.(enabled, { alpha });
    };

    try {
      globalThis.addEventListener('aura:focusOverlay:set', handler);
    } catch (error) {
      // ignore binding errors
    }
  }

  initFocusOverlayEventBridge();

  globalThis.AURA_FOCUS_OVERLAY_V2 = Object.freeze({
    OVERLAY_ATTR,
    OVERLAY_VERSION,
    PANEL_ATTR,
    PANEL_KEYS,
    PANEL_ALPHA,
    MAX_Z_INDEX,
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
