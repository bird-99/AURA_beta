(() => {
  const ENGINE_ATTR = 'data-aura-focus-engine';
  const ENGINE_VERSION = 'v1';
  const BAND_PANEL_ATTR = 'data-aura-focus-band-panel';
  const DEFAULT_BAND_ALPHA = 0.12;
  const DEFAULT_BAND_BLUR_PX = 0;
  const DEFAULT_BAND_FEATHER_PX = 24;
  const DEFAULT_BAND_TRANSITION_MS = 140;

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
  }

  function normalizeAlpha(value, fallback = DEFAULT_BAND_ALPHA) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(numeric, 0, 0.6);
  }

  function normalizeBandBlurPx(value, fallback = DEFAULT_BAND_BLUR_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(numeric, 0, 24);
  }

  function normalizeBandFeatherPx(value, fallback = DEFAULT_BAND_FEATHER_PX) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(numeric, 0, 120);
  }

  function normalizeBandTransitionMs(value, fallback = DEFAULT_BAND_TRANSITION_MS) {
    const numeric = toFiniteNumber(value);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(numeric, 0, 240);
  }

  function supportsCssValue(view, prop, value) {
    const css = view?.CSS;
    if (!css?.supports) return false;
    try {
      return css.supports(prop, value);
    } catch (error) {
      return false;
    }
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
      w: Number.isFinite(resolvedWidth) && resolvedWidth > 0 ? resolvedWidth : 0,
      h: Number.isFinite(resolvedHeight) && resolvedHeight > 0 ? resolvedHeight : 0,
    };
  }

  function normalizeRect(rect, viewport) {
    if (!rect || !viewport) return null;

    const x = toFiniteNumber(rect.x ?? rect.left);
    const y = toFiniteNumber(rect.y ?? rect.top);
    const wInput = toFiniteNumber(rect.w ?? rect.width);
    const hInput = toFiniteNumber(rect.h ?? rect.height);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(wInput) || !Number.isFinite(hInput)) {
      return null;
    }

    const width = Math.max(0, wInput);
    const height = Math.max(0, hInput);

    if (width <= 0 || height <= 0) return null;

    const left = clamp(x, 0, viewport.w);
    const top = clamp(y, 0, viewport.h);
    const right = clamp(left + width, 0, viewport.w);
    const bottom = clamp(top + height, 0, viewport.h);

    const clampedWidth = Math.max(0, right - left);
    const clampedHeight = Math.max(0, bottom - top);

    if (clampedWidth <= 0 || clampedHeight <= 0) return null;

    return {
      left,
      top,
      width: clampedWidth,
      height: clampedHeight,
    };
  }

  function createEngineRoot(doc, host, key) {
    const root = doc?.createElement?.('div');
    if (!root) {
      throw new Error('Cannot create focus engine root without a document');
    }

    root.setAttribute(ENGINE_ATTR, `${ENGINE_VERSION}-${key}`);
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.display = 'block';
    root.style.contain = 'layout style paint';

    const overlayRoot = host.getOverlayRoot();
    if (overlayRoot) {
      overlayRoot.appendChild(root);
    }

    return root;
  }

  function ensureBandPanels(doc, engineRoot) {
    const existing = engineRoot?.querySelectorAll?.(`[${BAND_PANEL_ATTR}]`);
    if (existing && existing.length === 2) {
      const [top, bottom] = existing;
      return { top, bottom };
    }

    const top = doc.createElement('div');
    const bottom = doc.createElement('div');
    [top, bottom].forEach((panel) => {
      panel.setAttribute(BAND_PANEL_ATTR, '');
      panel.style.position = 'fixed';
      panel.style.left = '0px';
      panel.style.width = '100%';
      panel.style.pointerEvents = 'none';
      panel.style.display = 'block';
    });

    engineRoot.appendChild(top);
    engineRoot.appendChild(bottom);

    return { top, bottom };
  }

  function createFocusOverlayHandle(doc, engineRoot, options) {
    const module = globalThis.AURA_FOCUS_OVERLAY_V2 || null;
    const create = module?.createFocusOverlayV2;
    if (typeof create !== 'function') {
      return null;
    }

    const handle = create(doc, options || {});
    if (handle?.root && engineRoot && handle.root.parentNode !== engineRoot) {
      engineRoot.appendChild(handle.root);
    }

    return handle;
  }

  function destroyFocusOverlayHandle(handle) {
    const module = globalThis.AURA_FOCUS_OVERLAY_V2 || null;
    const destroy = module?.destroyFocusOverlayV2;
    if (typeof destroy === 'function') {
      destroy(handle);
      return;
    }
    if (handle?.root) {
      try {
        handle.root.remove();
      } catch (error) {
        // ignore cleanup errors
      }
    }
  }

  function createFocusEngineController(host, deps = {}) {
    const doc = deps?.doc || document;
    const view = doc?.defaultView || globalThis;
    const key = deps?.key || 'shared';

    host.mount();
    const engineRoot = createEngineRoot(doc, host, key);

    let enabled = false;
    let mode = deps?.mode === 'band' ? 'band' : 'rect';
    let targetRect = null;
    let band = null;
    let bandAlpha = normalizeAlpha(deps?.bandAlpha, DEFAULT_BAND_ALPHA);
    let bandBlurPx = normalizeBandBlurPx(deps?.bandBlurPx, DEFAULT_BAND_BLUR_PX);
    let bandFeatherPx = normalizeBandFeatherPx(deps?.bandFeatherPx, DEFAULT_BAND_FEATHER_PX);
    let bandTransitionMs = normalizeBandTransitionMs(deps?.bandTransitionMs, DEFAULT_BAND_TRANSITION_MS);
    let overlayOptions = deps?.overlayOptions ? { ...deps.overlayOptions } : {};
    let focusOverlayHandle = null;
    let bandPanels = null;
    let rectAnimator = null;
    let rectAnimatorEnabled = false;
    let rectAnimatorConfig = null;
    let scheduled = false;
    let rafId = null;
    const supportsBackdrop =
      supportsCssValue(view, 'backdrop-filter', 'blur(1px)') ||
      supportsCssValue(view, '-webkit-backdrop-filter', 'blur(1px)');
    const supportsMask =
      supportsCssValue(view, 'mask-image', 'linear-gradient(#000, #000)') ||
      supportsCssValue(view, '-webkit-mask-image', 'linear-gradient(#000, #000)');

    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (cb) => setTimeout(cb, 16);
    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    const getRectAnimatorModule = () => globalThis.AURA_RECT_ANIMATOR || null;

    const normalizeRectAnimatorConfig = (config) => {
      if (!config || typeof config !== 'object') return null;
      return {
        enabled: config.enabled === true,
        mode: config.mode === 'lerp' ? 'lerp' : 'spring',
        stiffness: typeof config.stiffness === 'number' ? config.stiffness : undefined,
        damping: typeof config.damping === 'number' ? config.damping : undefined,
        lerpAlpha: typeof config.lerpAlpha === 'number' ? config.lerpAlpha : undefined,
      };
    };

    const ensureRectAnimator = (config) => {
      const module = getRectAnimatorModule();
      const create = module?.createRectAnimator;
      if (typeof create !== 'function') {
        rectAnimator = null;
        rectAnimatorConfig = null;
        rectAnimatorEnabled = false;
        return;
      }

      const nextConfig = config || rectAnimatorConfig || {};
      const shouldRebuild =
        !rectAnimator ||
        !rectAnimatorConfig ||
        JSON.stringify(nextConfig) !== JSON.stringify(rectAnimatorConfig);

      if (shouldRebuild) {
        rectAnimator?.destroy?.();
        rectAnimator = create({
          ...nextConfig,
          doc,
          onUpdate: () => {
            scheduleRender();
          },
        });
        rectAnimatorConfig = nextConfig;
      }
    };

    const scheduleRender = () => {
      if (scheduled) return;
      scheduled = true;
      rafId = raf(() => {
        scheduled = false;
        rafId = null;
        render();
      });
    };

    const applyOverlayOptions = (options) => {
      if (!options) return;
      overlayOptions = { ...overlayOptions, ...options };
      if (focusOverlayHandle) {
        destroyFocusOverlayHandle(focusOverlayHandle);
        focusOverlayHandle = null;
      }
    };

    const ensureFocusOverlay = () => {
      if (focusOverlayHandle) return focusOverlayHandle;
      focusOverlayHandle = createFocusOverlayHandle(doc, engineRoot, overlayOptions);
      return focusOverlayHandle;
    };

    const renderRect = (viewport) => {
      const module = globalThis.AURA_FOCUS_OVERLAY_V2 || null;
      const update = module?.updateFocusOverlayV2;
      const setPanelAlpha = module?.setPanelAlpha;

      if (typeof update !== 'function') {
        return;
      }

      const handle = ensureFocusOverlay();
      if (!handle) return;

      if (typeof setPanelAlpha === 'function' && typeof overlayOptions?.alpha === 'number') {
        setPanelAlpha(handle, overlayOptions.alpha);
      }

      const rectSource = rectAnimatorEnabled && rectAnimator ? rectAnimator.getCurrent() || targetRect : targetRect;
      const normalized = normalizeRect(rectSource, viewport);
      if (!normalized) {
        if (handle?.root) {
          handle.root.style.display = 'none';
        }
        return;
      }

      update(handle, normalized, viewport, overlayOptions);
    };

    const renderBand = (viewport) => {
      if (!band) {
        if (bandPanels) {
          bandPanels.top.style.display = 'none';
          bandPanels.bottom.style.display = 'none';
        }
        return;
      }

      bandPanels = bandPanels || ensureBandPanels(doc, engineRoot);
      const height = clamp(toFiniteNumber(band.height), 0, viewport.h);
      const y = clamp(toFiniteNumber(band.y), 0, viewport.h);
      const topHeight = Math.max(0, y);
      const bottomStart = Math.max(0, Math.min(viewport.h, y + height));
      const bottomHeight = Math.max(0, viewport.h - bottomStart);
      const color = `rgba(0, 0, 0, ${bandAlpha})`;
      const featherTop = Math.min(Math.max(bandFeatherPx, 0), topHeight);
      const featherBottom = Math.min(Math.max(bandFeatherPx, 0), bottomHeight);
      const transitionMs = Math.max(0, bandTransitionMs);
      const transition =
        transitionMs > 0
          ? `background-color ${transitionMs}ms ease, opacity ${transitionMs}ms ease, backdrop-filter ${transitionMs}ms ease, -webkit-backdrop-filter ${transitionMs}ms ease, mask-image ${transitionMs}ms ease, -webkit-mask-image ${transitionMs}ms ease`
          : 'none';
      const transparent = 'rgba(0, 0, 0, 0)';
      const topMask = featherTop > 0
        ? `linear-gradient(to bottom, #000 0px, #000 ${Math.max(0, topHeight - featherTop)}px, transparent ${topHeight}px)`
        : '';
      const bottomMask = featherBottom > 0
        ? `linear-gradient(to bottom, transparent 0px, #000 ${featherBottom}px, #000 ${bottomHeight}px)`
        : '';
      const topFallback = featherTop > 0
        ? `linear-gradient(to bottom, ${color} 0px, ${color} ${Math.max(0, topHeight - featherTop)}px, ${transparent} ${topHeight}px)`
        : '';
      const bottomFallback = featherBottom > 0
        ? `linear-gradient(to bottom, ${transparent} 0px, ${color} ${featherBottom}px, ${color} ${bottomHeight}px)`
        : '';

      bandPanels.top.style.display = 'block';
      bandPanels.bottom.style.display = 'block';
      bandPanels.top.style.top = '0px';
      bandPanels.top.style.height = `${topHeight}px`;
      bandPanels.bottom.style.top = `${bottomStart}px`;
      bandPanels.bottom.style.height = `${bottomHeight}px`;
      bandPanels.top.style.transition = transition;
      bandPanels.bottom.style.transition = transition;
      bandPanels.top.style.backgroundColor = supportsMask && featherTop > 0 ? color : featherTop > 0 ? 'transparent' : color;
      bandPanels.bottom.style.backgroundColor = supportsMask && featherBottom > 0 ? color : featherBottom > 0 ? 'transparent' : color;
      bandPanels.top.style.backgroundImage = supportsMask ? '' : topFallback;
      bandPanels.bottom.style.backgroundImage = supportsMask ? '' : bottomFallback;
      if (supportsMask) {
        const topMaskValue = topMask || '';
        const bottomMaskValue = bottomMask || '';
        bandPanels.top.style.maskImage = topMaskValue;
        bandPanels.top.style.webkitMaskImage = topMaskValue;
        bandPanels.bottom.style.maskImage = bottomMaskValue;
        bandPanels.bottom.style.webkitMaskImage = bottomMaskValue;
      } else {
        bandPanels.top.style.maskImage = '';
        bandPanels.top.style.webkitMaskImage = '';
        bandPanels.bottom.style.maskImage = '';
        bandPanels.bottom.style.webkitMaskImage = '';
      }
      if (supportsBackdrop && bandBlurPx > 0) {
        const blurValue = `blur(${bandBlurPx}px)`;
        bandPanels.top.style.backdropFilter = blurValue;
        bandPanels.top.style.webkitBackdropFilter = blurValue;
        bandPanels.bottom.style.backdropFilter = blurValue;
        bandPanels.bottom.style.webkitBackdropFilter = blurValue;
      } else {
        bandPanels.top.style.backdropFilter = '';
        bandPanels.top.style.webkitBackdropFilter = '';
        bandPanels.bottom.style.backdropFilter = '';
        bandPanels.bottom.style.webkitBackdropFilter = '';
      }
    };

    const render = () => {
      if (!enabled) {
        if (focusOverlayHandle?.root) {
          focusOverlayHandle.root.style.display = 'none';
        }
        if (bandPanels) {
          bandPanels.top.style.display = 'none';
          bandPanels.bottom.style.display = 'none';
        }
        return;
      }

      const viewport = getViewport(doc);
      if (!viewport.w || !viewport.h) {
        if (focusOverlayHandle?.root) {
          focusOverlayHandle.root.style.display = 'none';
        }
        if (bandPanels) {
          bandPanels.top.style.display = 'none';
          bandPanels.bottom.style.display = 'none';
        }
        return;
      }

      if (mode === 'band') {
        if (focusOverlayHandle?.root) {
          focusOverlayHandle.root.style.display = 'none';
        }
        renderBand(viewport);
      } else {
        if (bandPanels) {
          bandPanels.top.style.display = 'none';
          bandPanels.bottom.style.display = 'none';
        }
        renderRect(viewport);
      }
    };

    const setEnabled = (value, options = null) => {
      enabled = value === true;
      if (options && typeof options === 'object') {
        if (typeof options.bandAlpha === 'number') {
          bandAlpha = normalizeAlpha(options.bandAlpha, bandAlpha);
        }
        if (typeof options.bandBlurPx === 'number') {
          bandBlurPx = normalizeBandBlurPx(options.bandBlurPx, bandBlurPx);
        }
        if (typeof options.bandFeatherPx === 'number') {
          bandFeatherPx = normalizeBandFeatherPx(options.bandFeatherPx, bandFeatherPx);
        }
        if (typeof options.bandTransitionMs === 'number') {
          bandTransitionMs = normalizeBandTransitionMs(options.bandTransitionMs, bandTransitionMs);
        }
        if (options.overlayOptions && typeof options.overlayOptions === 'object') {
          applyOverlayOptions(options.overlayOptions);
        }
        if (options.rectAnimator && typeof options.rectAnimator === 'object') {
          const nextConfig = normalizeRectAnimatorConfig(options.rectAnimator);
          rectAnimatorEnabled = nextConfig?.enabled === true;
          rectAnimatorConfig = nextConfig;
          if (rectAnimatorEnabled) {
            ensureRectAnimator(nextConfig);
            rectAnimator?.setEnabled?.(true);
            if (targetRect) {
              rectAnimator?.setTarget?.(targetRect);
            }
          } else if (rectAnimator) {
            rectAnimator.setTarget?.(null);
            rectAnimator.setEnabled?.(false);
          }
        }
      }
      if (!enabled && rectAnimator) {
        rectAnimator.setEnabled?.(false);
        rectAnimator.setTarget?.(null);
      } else if (enabled && rectAnimatorEnabled && rectAnimator) {
        rectAnimator.setEnabled?.(true);
        if (targetRect) {
          rectAnimator.setTarget?.(targetRect);
        }
      }
      scheduleRender();
    };

    const setMode = (nextMode) => {
      mode = nextMode === 'band' ? 'band' : 'rect';
      scheduleRender();
    };

    const setTargetRect = (rect) => {
      targetRect = rect || null;
      if (rectAnimatorEnabled && rectAnimator) {
        rectAnimator.setTarget?.(targetRect);
        rectAnimator.setEnabled?.(enabled);
      }
      scheduleRender();
    };

    const setBand = (nextBand) => {
      if (!nextBand) {
        band = null;
      } else {
        band = {
          y: toFiniteNumber(nextBand.y),
          height: toFiniteNumber(nextBand.height),
        };
        if (typeof nextBand.opacity === 'number') {
          bandAlpha = normalizeAlpha(nextBand.opacity, bandAlpha);
        }
        if (typeof nextBand.blurPx === 'number') {
          bandBlurPx = normalizeBandBlurPx(nextBand.blurPx, bandBlurPx);
        }
        if (typeof nextBand.featherPx === 'number') {
          bandFeatherPx = normalizeBandFeatherPx(nextBand.featherPx, bandFeatherPx);
        }
      }
      scheduleRender();
    };

    const destroy = () => {
      enabled = false;
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      scheduled = false;
      if (rectAnimator) {
        rectAnimator.destroy?.();
        rectAnimator = null;
      }
      rectAnimatorEnabled = false;
      rectAnimatorConfig = null;
      if (focusOverlayHandle) {
        destroyFocusOverlayHandle(focusOverlayHandle);
        focusOverlayHandle = null;
      }
      if (engineRoot?.parentNode) {
        try {
          engineRoot.remove();
        } catch (error) {
          // ignore cleanup errors
        }
      }
      bandPanels = null;
    };

    return {
      setEnabled,
      setMode,
      setTargetRect,
      setBand,
      destroy,
    };
  }

  const controllerCache = new Map();
  let sharedHost = null;

  function getSharedHost() {
    if (sharedHost) return sharedHost;
    const hostModule = globalThis.AURA_TOP_LAYER_HOST;
    const createHost = hostModule?.createTopLayerHost;
    if (typeof createHost !== 'function') {
      return null;
    }
    sharedHost = createHost({ doc: document });
    return sharedHost;
  }

  function getSharedController(mode, keyOverride) {
    const resolvedMode = mode === 'band' ? 'band' : 'rect';
    const key = keyOverride || resolvedMode;
    if (controllerCache.has(key)) {
      return controllerCache.get(key);
    }

    const host = getSharedHost();
    if (!host) return null;

    const controller = createFocusEngineController(host, { mode: resolvedMode, key });
    controllerCache.set(key, controller);
    return controller;
  }

  globalThis.AURA_FOCUS_ENGINE = Object.freeze({
    createFocusEngineController,
    getSharedController,
  });
})();
