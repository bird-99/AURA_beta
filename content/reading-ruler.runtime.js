(() => {
  const RULER_ATTR = 'data-aura-reading-ruler';
  const RULER_VERSION = 'v1';
  const BAND_ATTR = 'data-aura-reading-ruler-band';
  const DEFAULT_HEIGHT_PX = 120;
  const DEFAULT_OPACITY = 0.12;
  const MAX_Z_INDEX = 2147483647;
  const EVENT_NAME = 'aura:readingRuler:set';

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

  function getViewportHeight(doc) {
    const view = doc?.defaultView || globalThis;
    const height = toFiniteNumber(doc?.documentElement?.clientHeight);
    const fallback = toFiniteNumber(view?.innerHeight);
    return Number.isFinite(height) && height > 0 ? height : Number.isFinite(fallback) ? fallback : 0;
  }

  function getExistingReadingRulerRoot(doc) {
    if (!doc?.querySelector) return null;
    try {
      return doc.querySelector(`[${RULER_ATTR}="${RULER_VERSION}"]`);
    } catch (error) {
      return null;
    }
  }

  function createReadingRulerRoot(doc, options = {}) {
    const existing = getExistingReadingRulerRoot(doc);
    if (existing) {
      const band = existing.querySelector(`[${BAND_ATTR}]`);
      return { root: existing, band };
    }

    const root = doc?.createElement?.('div');
    if (!root) {
      throw new Error('Cannot create reading ruler without a document');
    }

    root.setAttribute(RULER_ATTR, RULER_VERSION);
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = String(MAX_Z_INDEX);
    root.style.display = 'none';

    const band = doc.createElement('div');
    band.setAttribute(BAND_ATTR, '');
    band.style.position = 'absolute';
    band.style.left = '0px';
    band.style.width = '100%';
    band.style.pointerEvents = 'none';
    band.style.backgroundColor = `rgba(0, 0, 0, ${normalizeOpacity(options.opacity)})`;
    band.style.height = `${normalizeHeight(options.heightPx)}px`;

    root.appendChild(band);
    const parent = doc.body || doc.documentElement;
    parent?.appendChild(root);

    return { root, band };
  }

  function setReadingRulerVisible(handle, visible) {
    if (!handle?.root) return;
    handle.root.style.display = visible ? 'block' : 'none';
  }

  function updateReadingRuler(handle, options = {}) {
    if (!handle?.band) return;
    const height = normalizeHeight(options.heightPx);
    const opacity = normalizeOpacity(options.opacity);
    const viewportHeight = getViewportHeight(handle.root.ownerDocument);

    const top = Math.max(0, (viewportHeight - height) / 2);
    handle.band.style.top = `${top}px`;
    handle.band.style.height = `${height}px`;
    handle.band.style.backgroundColor = `rgba(0, 0, 0, ${opacity})`;
  }

  function destroyReadingRuler(handle) {
    if (!handle?.root) return;
    handle.root.remove();
  }

  function createReadingRulerController(doc, options = {}) {
    const view = doc?.defaultView || globalThis;
    let handle = null;
    let enabled = false;
    let heightPx = normalizeHeight(options.heightPx);
    let opacity = normalizeOpacity(options.opacity);
    let rafId = null;
    let listenersAttached = false;

    const scheduleUpdate = () => {
      if (!enabled || !handle) {
        return;
      }
      if (rafId !== null) {
        return;
      }
      const request = view?.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
      rafId = request(() => {
        rafId = null;
        updateReadingRuler(handle, { heightPx, opacity });
      });
    };

    const stopRaf = () => {
      if (rafId === null) return;
      const cancel = view?.cancelAnimationFrame || clearTimeout;
      cancel(rafId);
      rafId = null;
    };

    const onScroll = () => scheduleUpdate();
    const onResize = () => scheduleUpdate();

    const attachListeners = () => {
      if (listenersAttached || !view?.addEventListener) return;
      view.addEventListener('scroll', onScroll, { passive: true });
      view.addEventListener('resize', onResize);
      listenersAttached = true;
    };

    const detachListeners = () => {
      if (!listenersAttached || !view?.removeEventListener) return;
      view.removeEventListener('scroll', onScroll, { passive: true });
      view.removeEventListener('resize', onResize);
      listenersAttached = false;
    };

    const setEnabled = (nextEnabled, nextOptions = {}) => {
      if (typeof nextOptions.heightPx === 'number') {
        heightPx = normalizeHeight(nextOptions.heightPx, heightPx);
      }
      if (typeof nextOptions.opacity === 'number') {
        opacity = normalizeOpacity(nextOptions.opacity, opacity);
      }

      if (!nextEnabled) {
        enabled = false;
        stopRaf();
        detachListeners();
        if (handle) {
          destroyReadingRuler(handle);
          handle = null;
        }
        return;
      }

      enabled = true;
      if (!handle) {
        handle = createReadingRulerRoot(doc, { heightPx, opacity });
      }
      setReadingRulerVisible(handle, true);
      updateReadingRuler(handle, { heightPx, opacity });
      attachListeners();
    };

    const destroy = () => {
      enabled = false;
      stopRaf();
      detachListeners();
      if (handle) {
        destroyReadingRuler(handle);
        handle = null;
      }
    };

    return {
      setEnabled,
      destroy,
    };
  }

  function ensureController(runtime) {
    if (!runtime.controller) {
      runtime.controller = createReadingRulerController(document, {
        heightPx: DEFAULT_HEIGHT_PX,
        opacity: DEFAULT_OPACITY,
      });
    }
    return runtime.controller;
  }

  function handleReadingRulerEvent(event, runtime) {
    const detail = event?.detail || {};
    const enabled = detail.enabled === true;
    if (!enabled && !runtime.controller) {
      return;
    }

    const controller = ensureController(runtime);
    controller.setEnabled(enabled, {
      heightPx: detail.heightPx,
      opacity: detail.opacity,
    });

    if (!enabled) {
      controller.destroy();
      runtime.controller = null;
    }
  }

  if (globalThis.__AURA_READING_RULER_EVENTS_BOUND__) {
    return;
  }

  globalThis.__AURA_READING_RULER_EVENTS_BOUND__ = true;

  const runtimeState = {
    controller: null,
  };

  window.addEventListener(EVENT_NAME, (event) => handleReadingRulerEvent(event, runtimeState));

  globalThis.AURA_READING_RULER = Object.freeze({
    createReadingRulerController,
    getExistingReadingRulerRoot,
  });
})();
