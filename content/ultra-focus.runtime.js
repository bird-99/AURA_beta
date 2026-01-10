(() => {
  const OVERLAY_ATTR = 'data-aura-ultra-focus';
  const OVERLAY_VERSION = 'v1';
  const LENS_ATTR = 'data-aura-ultra-focus-lens';
  const ICON_ATTR = 'data-aura-ultra-focus-icon';
  const LOCK_ATTR = 'data-aura-ultra-focus-lock';
  const MAX_Z_INDEX = 2147483647;
  const MAX_OBSERVED = 200;
  const MIN_TEXT_LENGTH = 120;
  const ICON_SIZE = 24;
  const ICON_OFFSET = 6;
  const LENS_PADDING = 6;
  const DEFAULT_ALPHA = 0.2;
  const EVENT_SET = 'aura:ultraFocus:set';
  const EVENT_LOCK = 'aura:ultraFocus:lock';
  const SCOPE_ATTR = 'data-aura-scope';
  const SCOPE_OWNER_ATTR = 'data-aura-scope-owner';
  const SCOPE_VALUE = '1';
  const SCOPE_OWNER = 'aura-me2';

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
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

  function getExistingOverlayRoot(doc) {
    if (!doc?.querySelector) return null;
    try {
      return doc.querySelector(`[${OVERLAY_ATTR}="${OVERLAY_VERSION}"]`);
    } catch (error) {
      return null;
    }
  }

  function createOverlayRoot(doc) {
    const existing = getExistingOverlayRoot(doc);
    if (existing) {
      return {
        root: existing,
        lens: existing.querySelector?.(`[${LENS_ATTR}]`) || null,
        icon: existing.querySelector?.(`[${ICON_ATTR}]`) || null,
      };
    }

    const root = doc?.createElement?.('div');
    if (!root) {
      throw new Error('Cannot create ultra focus overlay without document');
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
    lens.style.borderRadius = '10px';
    lens.style.boxShadow = '0 0 0 2px rgba(0, 0, 0, 0.25), 0 8px 20px rgba(0, 0, 0, 0.35)';

    const icon = doc.createElement('button');
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

    root.appendChild(lens);
    root.appendChild(icon);

    const parent = doc.body || doc.documentElement;
    parent?.appendChild(root);

    return { root, lens, icon };
  }

  function setOverlayVisible(handle, visible) {
    if (!handle?.root) return;
    handle.root.style.display = visible ? 'block' : 'none';
  }

  function setLensRect(handle, rect) {
    if (!handle?.lens) return;
    if (!rect) {
      handle.lens.style.display = 'none';
      return;
    }

    handle.lens.style.display = 'block';
    handle.lens.style.left = `${Math.max(0, rect.left - LENS_PADDING)}px`;
    handle.lens.style.top = `${Math.max(0, rect.top - LENS_PADDING)}px`;
    handle.lens.style.width = `${rect.width + LENS_PADDING * 2}px`;
    handle.lens.style.height = `${rect.height + LENS_PADDING * 2}px`;
  }

  function setIconRect(handle, rect, visible) {
    if (!handle?.icon) return;
    if (!rect || !visible) {
      handle.icon.style.display = 'none';
      return;
    }

    handle.icon.style.display = 'flex';
    handle.icon.style.left = `${Math.max(0, rect.left - ICON_OFFSET)}px`;
    handle.icon.style.top = `${Math.max(0, rect.top - ICON_OFFSET)}px`;
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

  function isBackdropFilterSupported(doc) {
    const view = doc?.defaultView || globalThis;
    const css = view?.CSS;
    if (css?.supports) {
      if (css.supports('backdrop-filter', 'blur(4px)')) return true;
      if (css.supports('-webkit-backdrop-filter', 'blur(4px)')) return true;
    }

    const style = doc?.documentElement?.style;
    return Boolean(style?.backdropFilter || style?.webkitBackdropFilter);
  }

  function getFocusOverlayModule() {
    return globalThis.AURA_FOCUS_OVERLAY_V2 || null;
  }

  function setOverlayBlur(controller, enabled, supported) {
    if (!supported || !controller?.handle?.panels) return;
    const value = enabled ? 'blur(6px)' : 'none';
    Object.values(controller.handle.panels).forEach((panel) => {
      panel.style.backdropFilter = value;
      panel.style.webkitBackdropFilter = value;
    });
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

  function collectParagraphs(scopeEl) {
    if (!scopeEl?.querySelectorAll) return [];
    const paragraphs = Array.from(scopeEl.querySelectorAll('p'));
    const filtered = paragraphs.filter((node) => getTextLength(node) >= MIN_TEXT_LENGTH);
    return filtered.slice(0, MAX_OBSERVED);
  }

  function createController(doc) {
    const view = doc?.defaultView || globalThis;
    const overlay = createOverlayRoot(doc);
    const supportsBlur = isBackdropFilterSupported(doc);
    const ratios = new Map();
    let observer = null;
    let enabled = false;
    let locked = false;
    let lockedElement = null;
    let bestCandidate = null;
    let scheduled = false;
    let rafId = null;
    let scopeRoot = null;
    let focusOverlayController = null;
    let isSuspended = false;

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
        update();
      });
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

    const ensureFocusOverlay = () => {
      if (focusOverlayController) return focusOverlayController;
      const module = getFocusOverlayModule();
      const create = module?.createFocusOverlayControllerV2;
      if (typeof create !== 'function') return null;
      focusOverlayController = create(doc, { alpha: DEFAULT_ALPHA });
      return focusOverlayController;
    };

    const enableFocusOverlayLock = (target) => {
      const controller = ensureFocusOverlay();
      if (!controller) return;
      controller.setScopeEl?.(target);
      controller.setEnabled?.(true, { alpha: DEFAULT_ALPHA });
      setOverlayBlur(controller, true, supportsBlur);
    };

    const disableFocusOverlayLock = () => {
      if (!focusOverlayController) return;
      setOverlayBlur(focusOverlayController, false, supportsBlur);
      focusOverlayController.setEnabled?.(false, { alpha: DEFAULT_ALPHA });
      focusOverlayController.setScopeEl?.(null);
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

      return best;
    };

    const update = () => {
      if (!enabled) return;

      updateSuspensionState();
      if (isSuspended) {
        setIconRect(overlay, null, false);
        setLensRect(overlay, null);
        return;
      }

      if (!scopeRoot || !scopeRoot.isConnected) {
        scopeRoot = getScopeRoot(doc);
        if (!scopeRoot) {
          setOverlayVisible(overlay, false);
          return;
        }
        setupObserver();
      }

      const viewport = getViewport(doc);
      if (!viewport.width || !viewport.height) {
        setOverlayVisible(overlay, false);
        return;
      }

      let target = locked ? lockedElement : pickBestCandidate();
      if (!target) {
        bestCandidate = null;
        setOverlayVisible(overlay, false);
        return;
      }

      bestCandidate = target;
      let rect;
      try {
        rect = target.getBoundingClientRect?.();
      } catch (error) {
        rect = null;
      }
      const normalized = normalizeRect(rect, viewport);
      if (!normalized) {
        setOverlayVisible(overlay, false);
        return;
      }

      setOverlayVisible(overlay, true);
      setLensRect(overlay, normalized);
      setIconRect(overlay, normalized, !locked);
    };

    const onScroll = () => scheduleUpdate();
    const onResize = () => scheduleUpdate();

    const onIconClick = (event) => {
      if (!enabled || locked) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (bestCandidate) {
        setLocked(true, bestCandidate);
      }
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

    const onKeydown = (event) => {
      if (!locked) return;
      if (event?.key === 'Escape' || event?.code === 'Escape') {
        setLocked(false, null);
      }
    };

    const attachListeners = () => {
      overlay.icon?.addEventListener?.('click', onIconClick);
      view?.addEventListener?.('scroll', onScroll, { passive: true });
      view?.addEventListener?.('resize', onResize);
      doc?.addEventListener?.('click', onDocumentClick, true);
      view?.addEventListener?.('keydown', onKeydown, true);
    };

    const detachListeners = () => {
      overlay.icon?.removeEventListener?.('click', onIconClick);
      view?.removeEventListener?.('scroll', onScroll, { passive: true });
      view?.removeEventListener?.('resize', onResize);
      doc?.removeEventListener?.('click', onDocumentClick, true);
      view?.removeEventListener?.('keydown', onKeydown, true);
    };

    const setEnabled = (nextEnabled) => {
      if (!nextEnabled) {
        enabled = false;
        setLocked(false, null);
        detachListeners();
        destroyObserver();
        if (rafId !== null) {
          caf(rafId);
          rafId = null;
        }
        scheduled = false;
        setOverlayVisible(overlay, false);
        return;
      }

      enabled = true;
      scopeRoot = getScopeRoot(doc);
      if (scopeRoot) {
        setupObserver();
      } else {
        setOverlayVisible(overlay, false);
      }
      attachListeners();
      scheduleUpdate();
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
      try {
        overlay.root?.remove?.();
      } catch (error) {
        // ignore cleanup errors
      }
    };

    return {
      setEnabled,
      lock,
      destroy,
      update,
    };
  }

  function initUltraFocusEvents() {
    if (globalThis.__AURA_ULTRA_FOCUS_BOUND__) {
      return;
    }

    globalThis.__AURA_ULTRA_FOCUS_BOUND__ = true;

    let controller = null;
    const ensureController = () => {
      if (controller) return controller;
      controller = createController(document);
      return controller;
    };

    const handleSet = (event) => {
      const detail = event?.detail || {};
      const enabled = detail.enabled === true;
      const resolved = ensureController();
      if (!resolved) return;
      resolved.setEnabled(enabled);
    };

    const handleLock = (event) => {
      const detail = event?.detail || {};
      const lock = detail.lock === true;
      const resolved = ensureController();
      if (!resolved) return;
      resolved.lock(lock);
    };

    try {
      globalThis.addEventListener(EVENT_SET, handleSet);
      globalThis.addEventListener(EVENT_LOCK, handleLock);
    } catch (error) {
      // ignore event binding errors
    }
  }

  initUltraFocusEvents();

  globalThis.AURA_ULTRA_FOCUS = Object.freeze({
    OVERLAY_ATTR,
    OVERLAY_VERSION,
    LENS_ATTR,
    ICON_ATTR,
    LOCK_ATTR,
    EVENT_SET,
    EVENT_LOCK,
    createController,
  });
})();
