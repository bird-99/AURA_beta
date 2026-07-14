(() => {
  const RULER_ATTR = 'data-aura-reading-ruler';
  const RULER_VERSION = 'v2';
  const DEFAULT_HEIGHT_PX = 120;
  const DEFAULT_OPACITY = 0.12;
  const DEFAULT_BLUR_PX = 0;
  const DEFAULT_FEATHER_PX = 24;
  const DEFAULT_TRANSITION_MS = 140;
  const LINE_STEP_PX = 24;
  const PAGE_STEP_RATIO = 0.9;

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
  }

  function normalizeHeight(value, fallback = DEFAULT_HEIGHT_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 40, 400);
  }

  function normalizeOpacity(value, fallback = DEFAULT_OPACITY) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 0.6);
  }

  function normalizeBlurPx(value, fallback = DEFAULT_BLUR_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 24);
  }

  function normalizeFeatherPx(value, fallback = DEFAULT_FEATHER_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }
    return clamp(numeric, 0, 120);
  }

  function getViewportHeight(doc) {
    const view = doc?.defaultView || globalThis;
    const height = toFiniteNumber(doc?.documentElement?.clientHeight);
    const fallback = toFiniteNumber(view?.innerHeight);
    return Number.isFinite(height) && height > 0 ? height : Number.isFinite(fallback) ? fallback : 0;
  }

  function getSelectionAnchorY(doc, viewportHeight, bandHeight) {
    if (!doc?.getSelection) return null;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount < 1) return null;
    let rect = null;
    try {
      rect = selection.getRangeAt(0)?.getBoundingClientRect?.() || null;
    } catch (error) {
      rect = null;
    }
    const rectTop = toFiniteNumber(rect?.top);
    const rectHeight = toFiniteNumber(rect?.height);
    if (!Number.isFinite(rectTop) || !Number.isFinite(rectHeight) || rectHeight <= 0) {
      return null;
    }
    const rectBottom = rectTop + rectHeight;
    if (rectBottom <= 0 || rectTop >= viewportHeight) {
      return null;
    }
    const centerY = rectTop + rectHeight / 2;
    const target = centerY - bandHeight / 2;
    return clamp(target, 0, Math.max(0, viewportHeight - bandHeight));
  }

  function isEditableElement(element) {
    if (!element) return false;
    const tag = element.tagName?.toLowerCase?.() || '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return element.isContentEditable === true;
  }

  function getEngineController() {
    const engine = globalThis.AURA_FOCUS_ENGINE;
    const getShared = engine?.getSharedController;
    if (typeof getShared !== 'function') {
      return null;
    }
    return getShared('band', 'reading-ruler');
  }

  function initReadingRulerBridge() {
    if (globalThis.__AURA_READING_RULER_EVENTS_BOUND__) {
      return globalThis.__AURA_READING_RULER_BRIDGE__ || null;
    }

    globalThis.__AURA_READING_RULER_EVENTS_BOUND__ = true;

    const view = document?.defaultView || globalThis;
    let enabled = false;
    let heightPx = DEFAULT_HEIGHT_PX;
    let opacity = DEFAULT_OPACITY;
    let blurPx = DEFAULT_BLUR_PX;
    let featherPx = DEFAULT_FEATHER_PX;
    let reduceMotion = false;
    let scheduled = false;
    let rafId = null;
    let controller = null;
    let listenersAttached = false;
    let keyboardOffset = 0;
    let lastAnchorY = null;
    let exitHandler = null;

    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (callback) => setTimeout(callback, 16);
    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    const scheduleUpdate = () => {
      if (!enabled) return;
      if (scheduled) return;
      scheduled = true;
      rafId = raf(() => {
        scheduled = false;
        rafId = null;
        updateBand();
      });
    };

    const updateBand = () => {
      if (!enabled) return;
      if (!controller) {
        controller = getEngineController();
        if (!controller) return;
      }

      const viewportHeight = getViewportHeight(document);
      if (!viewportHeight) {
        controller.setBand?.(null);
        return;
      }

      const bandHeight = normalizeHeight(heightPx, DEFAULT_HEIGHT_PX);
      const anchorY = getSelectionAnchorY(document, viewportHeight, bandHeight);
      const baseY = Number.isFinite(anchorY)
        ? anchorY
        : Math.max(0, (viewportHeight - bandHeight) / 2);
      if (Number.isFinite(anchorY)) {
        lastAnchorY = anchorY;
      } else {
        lastAnchorY = null;
      }
      const top = clamp(baseY + keyboardOffset, 0, Math.max(0, viewportHeight - bandHeight));

      controller.setMode?.('band');
      controller.setBand?.({
        y: top,
        height: bandHeight,
        opacity,
        blurPx,
        featherPx,
      });
      controller.setEnabled?.(true, {
        bandAlpha: opacity,
        bandBlurPx: blurPx,
        bandFeatherPx: featherPx,
        bandTransitionMs: reduceMotion ? 0 : DEFAULT_TRANSITION_MS,
      });
    };

    const ensureMarker = () => {
      if (document.querySelector(`[${RULER_ATTR}="${RULER_VERSION}"]`)) {
        return;
      }
      const marker = document.createElement('div');
      marker.setAttribute(RULER_ATTR, RULER_VERSION);
      marker.style.display = 'none';
      document.documentElement?.appendChild(marker);
    };

    const removeMarker = () => {
      try {
        document.querySelector(`[${RULER_ATTR}="${RULER_VERSION}"]`)?.remove?.();
      } catch (error) {
        // ignore cleanup errors
      }
    };

    const stop = () => {
      enabled = false;
      keyboardOffset = 0;
      lastAnchorY = null;
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      scheduled = false;
      if (controller) {
        controller.setBand?.(null);
        controller.setEnabled?.(false);
      }
      removeMarker();
      if (listenersAttached) {
        view?.removeEventListener?.('scroll', scheduleUpdate);
        view?.removeEventListener?.('resize', scheduleUpdate);
        document?.removeEventListener?.('selectionchange', scheduleUpdate);
        view?.removeEventListener?.('keydown', handleKeydown, true);
        listenersAttached = false;
      }
    };

    const resolveStepSizes = () => {
      const viewportHeight = getViewportHeight(document);
      const bandHeight = normalizeHeight(heightPx, DEFAULT_HEIGHT_PX);
      const lineStep = Math.max(12, Math.round(Math.min(LINE_STEP_PX, bandHeight / 2)));
      const pageStep = Math.max(lineStep * 4, Math.round(bandHeight * PAGE_STEP_RATIO));
      return { lineStep, pageStep, maxOffset: Math.max(0, viewportHeight - bandHeight) };
    };

    const handleKeydown = (event) => {
      if (!enabled) return;
      if (event?.isTrusted !== true) return;
      if (event?.defaultPrevented) return;
      if (isEditableElement(document?.activeElement)) return;

      const key = event?.key || event?.code;
      if (!key) return;

      const { lineStep, pageStep, maxOffset } = resolveStepSizes();
      let delta = 0;

      if (key === 'ArrowUp' || key === 'Up') {
        delta = -lineStep;
      } else if (key === 'ArrowDown' || key === 'Down') {
        delta = lineStep;
      } else if (key === 'PageUp') {
        delta = -pageStep;
      } else if (key === 'PageDown') {
        delta = pageStep;
      } else if (key === 'Escape') {
        stop();
        try {
          exitHandler?.({ reason: 'escape' });
        } catch (error) {
          // ignore exit notification errors
        }
        event?.preventDefault?.();
        return;
      } else {
        return;
      }

      event?.preventDefault?.();
      keyboardOffset = clamp((keyboardOffset || 0) + delta, -maxOffset, maxOffset);
      if (lastAnchorY === null) {
        scheduleUpdate();
        return;
      }
      scheduleUpdate();
    };

    const start = () => {
      if (!listenersAttached) {
        view?.addEventListener?.('scroll', scheduleUpdate, { passive: true });
        view?.addEventListener?.('resize', scheduleUpdate);
        document?.addEventListener?.('selectionchange', scheduleUpdate);
        view?.addEventListener?.('keydown', handleKeydown, true);
        listenersAttached = true;
      }
      scheduleUpdate();
    };

    const setState = (detail) => {
      if (!detail || typeof detail !== 'object') {
        return;
      }

      enabled = detail.enabled === true;
      heightPx = normalizeHeight(detail.heightPx, heightPx);
      opacity = normalizeOpacity(detail.opacity, opacity);
      blurPx = normalizeBlurPx(detail.blurPx, blurPx);
      featherPx = normalizeFeatherPx(detail.featherPx, featherPx);
      reduceMotion = detail.reduceMotion === true;

      if (!enabled) {
        stop();
        return;
      }

      if (!controller) {
        controller = getEngineController();
        if (!controller) return;
      }

      controller.setMode?.('band');
      controller.setEnabled?.(true, {
        bandAlpha: opacity,
        bandBlurPx: blurPx,
        bandFeatherPx: featherPx,
        bandTransitionMs: reduceMotion ? 0 : DEFAULT_TRANSITION_MS,
      });
      controller.setBand?.({ y: 0, height: 0, opacity, blurPx, featherPx });

      ensureMarker();

      start();
    };

    const bridge = Object.freeze({
      setState,
      onExit(handler) {
        exitHandler = typeof handler === 'function' ? handler : null;
      },
    });
    globalThis.__AURA_READING_RULER_BRIDGE__ = bridge;
    return bridge;
  }

  const bridge = initReadingRulerBridge();

  globalThis.AURA_READING_RULER = Object.freeze({
    setState: bridge?.setState,
    onExit: bridge?.onExit,
  });
})();
