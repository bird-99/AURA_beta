(() => {
  const INSTALL_SYMBOL = Symbol.for('AURA_SPA_HOOKS_V2');

  if (globalThis[INSTALL_SYMBOL]) {
    return;
  }

  globalThis[INSTALL_SYMBOL] = true;

  const noop = () => {};
  const shouldSuspendFocusOverlayV2 =
    globalThis.AURA_FOCUS_OVERLAY_V2?.shouldSuspendFocusOverlayV2 || (() => false);

  function classifyUrlChange(prevUrl, nextUrl) {
    if (prevUrl === nextUrl) {
      return 'none';
    }

    try {
      const base = 'http://example.com';
      const prev = new URL(prevUrl, base);
      const next = new URL(nextUrl, base);

      if (prev.pathname !== next.pathname) {
        return 'pathname';
      }

      if (prev.search !== next.search) {
        return 'search';
      }

      if (prev.hash !== next.hash) {
        return 'hash';
      }

      return 'none';
    } catch (_) {
      return prevUrl === nextUrl ? 'none' : 'pathname';
    }
  }

  function shouldTriggerReapply(input) {
    const { prevUrl = '', nextUrl = '', reason = '', policy = {} } = input || {};
    let kind;

    try {
      kind = classifyUrlChange(prevUrl, nextUrl);
    } catch (_) {
      kind = prevUrl === nextUrl ? 'none' : 'pathname';
    }

    if (kind === 'pathname' || kind === 'search') {
      return { trigger: true, kind };
    }

    if (kind === 'hash') {
      const includeHash = Boolean(policy.includeHash);
      const allowlist = Array.isArray(policy.hashAllowlist) ? policy.hashAllowlist : [];

      const normalizeHash = (hashValue) => {
        if (!hashValue) return '';
        return hashValue.startsWith('#') ? hashValue : `#${hashValue}`;
      };

      let parsedHash = '';
      try {
        parsedHash = new URL(nextUrl, 'http://example.com').hash;
      } catch (_) {
        parsedHash = '';
      }

      const nextHash = normalizeHash(parsedHash);

      const matchesAllowlist = allowlist.some((entry) => normalizeHash(entry) === nextHash);

      return { trigger: includeHash || matchesAllowlist, kind };
    }

    return { trigger: false, kind };
  }

  function safeNow(now) {
    try {
      return now();
    } catch (_) {
      return Date.now();
    }
  }

  function safeCall(fn, ...args) {
    try {
      fn(...args);
    } catch (_) {
      /* noop */
    }
  }

  function normalizeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function dispatchAuraSpaNav(payload, win) {
    const target = win || (typeof window !== 'undefined' ? window : null);
    if (!target || typeof target.dispatchEvent !== 'function') {
      return;
    }

    const reason = normalizeString(payload?.reason);
    const kind = normalizeString(payload?.kind);
    const url = normalizeString(payload?.url);
    const CustomEventCtor =
      typeof target.CustomEvent === 'function'
        ? target.CustomEvent
        : typeof CustomEvent === 'function'
          ? CustomEvent
          : null;

    if (!CustomEventCtor) {
      return;
    }

    try {
      const event = new CustomEventCtor('aura:spa-nav', {
        detail: { reason, kind, url },
        bubbles: true,
      });
      target.dispatchEvent(event);
    } catch (_) {
      /* noop */
    }
  }

  /**
   * @typedef {Object} ModalDeferPolicy
   * @property {number} maxAttempts
   * @property {number} maxWindowMs
   * @property {number} baseDelayMs
   */

  function shouldDeferBecauseModal(doc) {
    if (!doc) {
      return false;
    }

    try {
      return Boolean(shouldSuspendFocusOverlayV2(doc));
    } catch (_) {
      return true;
    }
  }

  function createModalRetryController(options) {
    const { doc, policy, now = () => Date.now(), run } = options || {};

    const maxAttempts = Number.isFinite(policy?.maxAttempts) ? Math.max(0, policy.maxAttempts) : 0;
    const maxWindowMs = Number.isFinite(policy?.maxWindowMs) ? Math.max(0, policy.maxWindowMs) : 0;
    const baseDelayMs = Number.isFinite(policy?.baseDelayMs) ? Math.max(0, policy.baseDelayMs) : 0;
    const safeRun = typeof run === 'function' ? run : noop;

    let attempts = 0;
    let startedAt = null;
    let timerId = null;

    const clearTimer = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
    };

    const reset = () => {
      attempts = 0;
      startedAt = null;
      clearTimer();
    };

    const cancel = () => {
      clearTimer();
    };

    const scheduleNext = (reason, delayMs) => {
      clearTimer();
      timerId = setTimeout(() => {
        timerId = null;
        maybeDeferOrRun(reason);
      }, delayMs);
    };

    const maybeDeferOrRun = (reason) => {
      const nowMs = safeNow(now);

      if (!shouldDeferBecauseModal(doc)) {
        reset();
        try {
          safeRun(reason);
        } catch (error) {
          reset();
          throw error;
        }
        return { deferred: false };
      }

      if (startedAt == null) {
        startedAt = nowMs;
      }

      if (maxWindowMs > 0 && nowMs - startedAt > maxWindowMs) {
        reset();
        return { deferred: true };
      }

      if (attempts >= maxAttempts) {
        reset();
        return { deferred: true };
      }

      attempts += 1;
      const delayMs = baseDelayMs * Math.pow(2, attempts - 1);
      scheduleNext(reason, delayMs);
      return { deferred: true };
    };

    return { maybeDeferOrRun, cancel, reset };
  }

  function createReapplyScheduler(options) {
    const {
      debounceMs,
      maxWaitMs,
      cooldownMs,
      rateLimitWindowMs,
      maxRunsPerWindow,
      run,
      now = () => Date.now(),
      modalDeferPolicy,
      doc,
    } = options || {};

    const debounceDelay = Number.isFinite(debounceMs) ? Math.max(0, debounceMs) : 0;
    const maxWaitDelay = Number.isFinite(maxWaitMs) ? Math.max(0, maxWaitMs) : 0;
    const cooldownDelay = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 0;
    const rateWindow = Number.isFinite(rateLimitWindowMs) ? Math.max(0, rateLimitWindowMs) : 0;
    const maxRuns = Number.isFinite(maxRunsPerWindow) ? Math.max(0, maxRunsPerWindow) : 0;

    const safeRun = typeof run === 'function' ? run : noop;

    let debounceTimer = null;
    let maxWaitTimer = null;
    let lastRunAtMs = null;
    let windowStartMs = safeNow(now);
    let runCountWindow = 0;
    let pendingReason = null;
    let scheduledCount = 0;
    let suppressedCount = 0;
    let lastReason = null;
    let modalController = null;

    const clearDebounceTimer = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    };

    const clearMaxWaitTimer = () => {
      if (maxWaitTimer) {
        clearTimeout(maxWaitTimer);
        maxWaitTimer = null;
      }
    };

    const clearTimers = () => {
      clearDebounceTimer();
      clearMaxWaitTimer();
    };

    const scheduleAfter = (delayMs) => {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        attemptRun();
      }, delayMs);
    };

    const ensureMaxWaitTimer = () => {
      if (maxWaitTimer) {
        return;
      }

      maxWaitTimer = setTimeout(() => {
        maxWaitTimer = null;
        attemptRun();
      }, maxWaitDelay);
    };

    const updateRateLimitWindow = (currentMs) => {
      if (currentMs - windowStartMs > rateWindow) {
        windowStartMs = currentMs;
        runCountWindow = 0;
      }
    };

    const runWithBookkeeping = (reason, runAtMs = safeNow(now)) => {
      updateRateLimitWindow(runAtMs);

      if (runCountWindow >= maxRuns) {
        suppressedCount += 1;
        clearTimers();
        return;
      }

      runCountWindow += 1;
      lastRunAtMs = runAtMs;
      lastReason = reason;
      clearTimers();

      safeCall(safeRun, lastReason);
    };

    const modalDoc = doc || (typeof document !== 'undefined' ? document : null);

    if (modalDeferPolicy && modalDoc) {
      try {
        modalController = createModalRetryController({
          doc: modalDoc,
          policy: modalDeferPolicy,
          now,
          run: (reason) => runWithBookkeeping(reason),
        });
      } catch (_) {
        modalController = null;
      }
    }

    const attemptRun = () => {
      const currentMs = safeNow(now);
      clearDebounceTimer();

      if (pendingReason == null) {
        return;
      }

      if (lastRunAtMs != null && cooldownDelay > 0 && currentMs - lastRunAtMs < cooldownDelay) {
        scheduleAfter(cooldownDelay - (currentMs - lastRunAtMs));
        return;
      }

      const reason = pendingReason;
      pendingReason = null;
      clearMaxWaitTimer();

      if (modalController) {
        const { deferred } = modalController.maybeDeferOrRun(reason) || {};
        if (deferred) {
          return;
        }
        return;
      }

      runWithBookkeeping(reason, currentMs);
    };

    const schedule = (reason) => {
      scheduledCount += 1;
      pendingReason = reason;

      clearDebounceTimer();
      scheduleAfter(debounceDelay);
      ensureMaxWaitTimer();
    };

    const flush = () => {
      attemptRun();
    };

    const reset = () => {
      clearTimers();
      pendingReason = null;
      lastReason = null;
      lastRunAtMs = null;
      scheduledCount = 0;
      suppressedCount = 0;
      runCountWindow = 0;
      windowStartMs = safeNow(now);
      modalController?.reset?.();
    };

    const cancel = () => {
      clearTimers();
      pendingReason = null;
      modalController?.cancel?.();
    };

    const getDebugState = () => ({
      pending: pendingReason != null,
      lastRunAtMs,
      scheduledCount,
      runCountWindow,
      suppressedCount,
      lastReason,
    });

    return { schedule, flush, reset, cancel, getDebugState };
  }

  function getGuard(win) {
    if (!win) return null;
    return win[INSTALL_SYMBOL] || null;
  }

  function setGuard(win, value) {
    if (!win) return;
    if (value) {
      win[INSTALL_SYMBOL] = value;
    } else {
      try {
        delete win[INSTALL_SYMBOL];
      } catch (_) {
        /* noop */
      }
    }
  }

  function createPatchedHistory(historyObj, emit, win) {
    const originalPush = typeof historyObj?.pushState === 'function' ? historyObj.pushState : null;
    const originalReplace = typeof historyObj?.replaceState === 'function' ? historyObj.replaceState : null;

    const wrappedPush =
      originalPush &&
      function patchedPushState(...args) {
        let result;
        let errorToThrow = null;
        try {
          result = originalPush.apply(historyObj, args);
        } catch (error) {
          errorToThrow = error;
        }

        safeCall(emit, 'pushState', { url: win?.location?.href, state: historyObj?.state });

        if (errorToThrow) {
          throw errorToThrow;
        }
        return result;
      };

    const wrappedReplace =
      originalReplace &&
      function patchedReplaceState(...args) {
        let result;
        let errorToThrow = null;
        try {
          result = originalReplace.apply(historyObj, args);
        } catch (error) {
          errorToThrow = error;
        }

        safeCall(emit, 'replaceState', { url: win?.location?.href, state: historyObj?.state });

        if (errorToThrow) {
          throw errorToThrow;
        }
        return result;
      };

    return { originalPush, originalReplace, wrappedPush, wrappedReplace };
  }

  function createSpaHooksV2(options = {}) {
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : noop;
    const scheduler = options.scheduler && typeof options.scheduler.schedule === 'function' ? options.scheduler : null;
    const policy = options.locationPolicy || { includeHash: false };

    let lastUrl = null;

    const emit = (reason, detail = {}) => {
      const nextUrl = win?.location?.href || '';
      const prevUrl = lastUrl ?? nextUrl;
      const decision = shouldTriggerReapply({ prevUrl, nextUrl, reason, policy });

      lastUrl = nextUrl || lastUrl;

      const enrichedDetail = { ...detail, url: nextUrl, kind: decision.kind };

      dispatchAuraSpaNav({ reason, kind: decision.kind, url: nextUrl }, win);

      if (scheduler) {
        if (decision.trigger) {
          safeCall(scheduler.schedule, reason);
        }
        return;
      }

      safeCall(onNavigate, reason, enrichedDetail);
    };

    let localGuard = null;

    const controller = {
      start() {
        const existingGuard = getGuard(win);
        if (existingGuard?.active) {
          localGuard = existingGuard;
          return;
        }

        if (!win || !win.history) {
          return;
        }

        try {
          lastUrl = win?.location?.href || lastUrl;
          const historyObj = win.history;
          const { originalPush, originalReplace, wrappedPush, wrappedReplace } = createPatchedHistory(
            historyObj,
            emit,
            win
          );

          const popHandler = () => emit('popstate', { url: win?.location?.href, state: historyObj?.state });
          const hashHandler = () => emit('hashchange', { url: win?.location?.href, state: historyObj?.state });

          if (wrappedPush) {
            historyObj.pushState = wrappedPush;
          }
          if (wrappedReplace) {
            historyObj.replaceState = wrappedReplace;
          }

          win.addEventListener?.('popstate', popHandler, { passive: true });
          win.addEventListener?.('hashchange', hashHandler, { passive: true });

          localGuard = {
            active: true,
            historyObj,
            originalPush,
            originalReplace,
            popHandler,
            hashHandler,
          };
          setGuard(win, localGuard);
        } catch (_) {
          // Fail open: do not throw or keep partial patch
          this.stop();
        }
      },

      stop() {
        const guard = getGuard(win) || localGuard;
        if (!guard || !guard.historyObj) {
          setGuard(win, null);
          localGuard = null;
          return;
        }

        try {
          if (guard.originalPush) {
            guard.historyObj.pushState = guard.originalPush;
          }
          if (guard.originalReplace) {
            guard.historyObj.replaceState = guard.originalReplace;
          }
        } catch (_) {
          /* noop */
        }

        try {
          win?.removeEventListener?.('popstate', guard.popHandler);
          win?.removeEventListener?.('hashchange', guard.hashHandler);
        } catch (_) {
          /* noop */
        }

        setGuard(win, null);
        localGuard = null;
        lastUrl = null;
      },

      isActive() {
        return Boolean(getGuard(win)?.active);
      },
    };

    return controller;
  }

  function startSpaHooksV2(options = {}) {
    const controller = createSpaHooksV2(options);
    controller.start();
    return controller;
  }

  function stopSpaHooksV2(options = {}) {
    const controller = createSpaHooksV2(options);
    controller.stop();
  }

  function installSpaHooksV2(options = {}) {
    return startSpaHooksV2(options);
  }

  function uninstallSpaHooksV2(options = {}) {
    stopSpaHooksV2(options);
  }

  globalThis.AURA_SPA_HOOKS_V2 = Object.freeze({
    classifyUrlChange,
    shouldTriggerReapply,
    shouldDeferBecauseModal,
    createModalRetryController,
    createReapplyScheduler,
    createSpaHooksV2,
    startSpaHooksV2,
    stopSpaHooksV2,
    installSpaHooksV2,
    uninstallSpaHooksV2,
  });
})();
