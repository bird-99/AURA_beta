(() => {
  const DEFAULT_STIFFNESS = 220;
  const DEFAULT_DAMPING = 28;
  const DEFAULT_LERP_ALPHA = 0.18;
  const DEFAULT_EPSILON = 0.5;
  const DEFAULT_VELOCITY_EPSILON = 0.02;
  const MAX_DT_SEC = 0.05;

  function toFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return NaN;
    return Math.min(Math.max(value, min), max);
  }

  function resolveViewport(doc) {
    const view = doc?.defaultView || globalThis;
    const width = toFiniteNumber(doc?.documentElement?.clientWidth);
    const height = toFiniteNumber(doc?.documentElement?.clientHeight);
    const fallbackWidth = toFiniteNumber(view?.innerWidth);
    const fallbackHeight = toFiniteNumber(view?.innerHeight);
    return {
      w: Number.isFinite(width) && width > 0 ? width : Number.isFinite(fallbackWidth) ? fallbackWidth : 0,
      h: Number.isFinite(height) && height > 0 ? height : Number.isFinite(fallbackHeight) ? fallbackHeight : 0,
    };
  }

  function normalizeRectInput(rect) {
    if (!rect) return null;
    const x = toFiniteNumber(rect.x ?? rect.left);
    const y = toFiniteNumber(rect.y ?? rect.top);
    const wInput = toFiniteNumber(rect.w ?? rect.width);
    const hInput = toFiniteNumber(rect.h ?? rect.height);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(wInput) || !Number.isFinite(hInput)) {
      return null;
    }
    const w = Math.max(0, wInput);
    const h = Math.max(0, hInput);
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function clampRectToViewport(rect, viewport) {
    if (!rect || !viewport) return null;
    const left = clamp(rect.x, 0, viewport.w);
    const top = clamp(rect.y, 0, viewport.h);
    const right = clamp(left + rect.w, 0, viewport.w);
    const bottom = clamp(top + rect.h, 0, viewport.h);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    if (width <= 0 || height <= 0) return null;
    return { x: left, y: top, w: width, h: height };
  }

  function buildAnimatorOptions(opts = {}) {
    const mode = opts.mode === 'lerp' ? 'lerp' : 'spring';
    const stiffness = toFiniteNumber(opts.stiffness);
    const damping = toFiniteNumber(opts.damping);
    const lerpAlpha = toFiniteNumber(opts.lerpAlpha);
    const epsilon = toFiniteNumber(opts.epsilon);
    const velocityEpsilon = toFiniteNumber(opts.velocityEpsilon);
    return {
      mode,
      stiffness: Number.isFinite(stiffness) ? stiffness : DEFAULT_STIFFNESS,
      damping: Number.isFinite(damping) ? damping : DEFAULT_DAMPING,
      lerpAlpha: Number.isFinite(lerpAlpha) ? clamp(lerpAlpha, 0.02, 0.6) : DEFAULT_LERP_ALPHA,
      epsilon: Number.isFinite(epsilon) ? Math.max(0, epsilon) : DEFAULT_EPSILON,
      velocityEpsilon: Number.isFinite(velocityEpsilon) ? Math.max(0, velocityEpsilon) : DEFAULT_VELOCITY_EPSILON,
      onUpdate: typeof opts.onUpdate === 'function' ? opts.onUpdate : null,
    };
  }

  function createRectAnimator(opts = {}) {
    const view = opts.doc?.defaultView || globalThis;
    const doc = opts.doc || document;
    const options = buildAnimatorOptions(opts);
    const raf = typeof view?.requestAnimationFrame === 'function'
      ? view.requestAnimationFrame.bind(view)
      : (cb) => setTimeout(cb, 16);
    const caf = typeof view?.cancelAnimationFrame === 'function'
      ? view.cancelAnimationFrame.bind(view)
      : (id) => clearTimeout(id);

    let enabled = false;
    let target = null;
    let current = null;
    let velocity = { x: 0, y: 0, w: 0, h: 0 };
    let rafId = null;
    let lastTime = null;

    const stop = () => {
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      lastTime = null;
    };

    const notify = (rect, speed, settled) => {
      if (typeof options.onUpdate === 'function') {
        options.onUpdate({ rect, velocity: { ...velocity }, speed, settled: settled === true });
      }
    };

    const step = (timestamp) => {
      rafId = null;
      if (!enabled) {
        return;
      }

      const resolvedTarget = target;
      if (!resolvedTarget) {
        current = null;
        velocity = { x: 0, y: 0, w: 0, h: 0 };
        notify(null, 0, true);
        stop();
        return;
      }

      if (!current) {
        current = { ...resolvedTarget };
        velocity = { x: 0, y: 0, w: 0, h: 0 };
        notify(current, 0, true);
        stop();
        return;
      }

      const now = typeof timestamp === 'number' ? timestamp : performance?.now?.() ?? Date.now();
      const rawDt = lastTime === null ? 0.016 : (now - lastTime) / 1000;
      const dt = Math.max(0.001, Math.min(rawDt, MAX_DT_SEC));
      lastTime = now;

      const prev = { ...current };
      if (options.mode === 'lerp') {
        const alpha = options.lerpAlpha;
        current.x += (resolvedTarget.x - current.x) * alpha;
        current.y += (resolvedTarget.y - current.y) * alpha;
        current.w += (resolvedTarget.w - current.w) * alpha;
        current.h += (resolvedTarget.h - current.h) * alpha;
        velocity.x = (current.x - prev.x) / dt;
        velocity.y = (current.y - prev.y) / dt;
        velocity.w = (current.w - prev.w) / dt;
        velocity.h = (current.h - prev.h) / dt;
      } else {
        const k = options.stiffness;
        const c = options.damping;
        const dx = resolvedTarget.x - current.x;
        const dy = resolvedTarget.y - current.y;
        const dw = resolvedTarget.w - current.w;
        const dh = resolvedTarget.h - current.h;
        velocity.x += (k * dx - c * velocity.x) * dt;
        velocity.y += (k * dy - c * velocity.y) * dt;
        velocity.w += (k * dw - c * velocity.w) * dt;
        velocity.h += (k * dh - c * velocity.h) * dt;
        current.x += velocity.x * dt;
        current.y += velocity.y * dt;
        current.w += velocity.w * dt;
        current.h += velocity.h * dt;
      }

      const viewport = resolveViewport(doc);
      current = clampRectToViewport(current, viewport);
      if (!current) {
        velocity = { x: 0, y: 0, w: 0, h: 0 };
        notify(null, 0, true);
        stop();
        return;
      }

      const speed = Math.max(
        Math.abs(velocity.x),
        Math.abs(velocity.y),
        Math.abs(velocity.w),
        Math.abs(velocity.h),
      );
      notify(current, speed, false);

      const maxDelta = Math.max(
        Math.abs(resolvedTarget.x - current.x),
        Math.abs(resolvedTarget.y - current.y),
        Math.abs(resolvedTarget.w - current.w),
        Math.abs(resolvedTarget.h - current.h),
      );

      if (maxDelta <= options.epsilon && speed <= options.velocityEpsilon) {
        current = { ...resolvedTarget };
        velocity = { x: 0, y: 0, w: 0, h: 0 };
        notify(current, 0, true);
        stop();
        return;
      }

      rafId = raf(step);
    };

    const ensureLoop = () => {
      if (!enabled) return;
      if (rafId !== null) return;
      rafId = raf(step);
    };

    const setTarget = (rect) => {
      const normalized = normalizeRectInput(rect);
      target = normalized;
      if (!target) {
        current = null;
        velocity = { x: 0, y: 0, w: 0, h: 0 };
        notify(null, 0, true);
        stop();
        return;
      }
      if (!current) {
        current = { ...target };
      }
      ensureLoop();
    };

    const getCurrent = () => (current ? { ...current } : null);

    const setEnabled = (value) => {
      enabled = value === true;
      if (!enabled) {
        stop();
      } else if (target) {
        ensureLoop();
      }
    };

    const destroy = () => {
      enabled = false;
      target = null;
      current = null;
      velocity = { x: 0, y: 0, w: 0, h: 0 };
      stop();
    };

    return {
      setTarget,
      getCurrent,
      setEnabled,
      destroy,
    };
  }

  globalThis.AURA_RECT_ANIMATOR = Object.freeze({
    createRectAnimator,
  });
})();
