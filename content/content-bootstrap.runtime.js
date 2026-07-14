(() => {
  'use strict';

  const API_KEY = 'AURA_CONTENT_BOOTSTRAP_V1';
  const STATE_KEY = '__AURA_CONTENT_BOOTSTRAP_STATE_V1__';
  const DOCUMENT_ID_KEY = '__AURA_DOCUMENT_INSTANCE_ID__';
  const MAIN_LOADED_KEY = '__AURA_CONTENT_MAIN_LOADED__';
  const READY_KEY = '__AURA_CONTENT_READY_FOR_PING__';
  const EARLY_LISTENER_KEY = '__AURA_PING_LISTENER__';
  const MAIN_LISTENER_KEY = '__AURA_CONTENT_MAIN_MESSAGE_LISTENER__';
  const DEFAULT_PING_ACTION = 'TEST_PING_CONTENT';
  const DEFAULT_DOCUMENT_CONTEXT_ACTION = 'GET_DOCUMENT_CONTEXT_V1';

  const PHASES = Object.freeze({
    NEW: 'NEW',
    BOOTSTRAPPING: 'BOOTSTRAPPING',
    READY: 'READY',
    RETRYABLE_FAILED: 'RETRYABLE_FAILED',
    INVALIDATED: 'INVALIDATED',
  });

  /**
   * @typedef {{
   *   addListener: (listener: Function) => void,
   *   removeListener: (listener: Function) => void,
   * }} BootstrapMessagePort
   */

  /**
   * @param {unknown} value
   * @returns {value is BootstrapMessagePort}
   */
  function isMessagePort(value) {
    const candidate = /** @type {Partial<BootstrapMessagePort> | null} */ (
      value && typeof value === 'object' ? value : null
    );
    return Boolean(
      candidate
      && typeof candidate.addListener === 'function'
      && typeof candidate.removeListener === 'function'
    );
  }

  function isBootstrapState(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && value.version === 1
      && typeof value.documentInstanceId === 'string'
      && value.documentInstanceId
      && typeof value.claim === 'function'
      && typeof value.markRetryableFailed === 'function'
      && typeof value.markReady === 'function'
      && typeof value.rearmMainListener === 'function'
      && typeof value.detachEarlyListener === 'function'
      && typeof value.invalidate === 'function'
    );
  }

  /**
   * @param {Record<string, any>} scope
   * @param {(() => string) | undefined} createDocumentId
   */
  function resolveDocumentId(scope, createDocumentId) {
    if (typeof scope[DOCUMENT_ID_KEY] === 'string' && scope[DOCUMENT_ID_KEY]) {
      return scope[DOCUMENT_ID_KEY];
    }
    if (typeof createDocumentId === 'function') {
      const candidate = createDocumentId();
      if (typeof candidate === 'string' && candidate) {
        return candidate;
      }
    }
    return globalThis.crypto?.randomUUID?.()
      || `aura-document-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /**
   * @param {{
   *   scope?: Record<string, any>,
   *   messagePort?: BootstrapMessagePort,
   *   isTopFrame?: () => boolean,
   *   createDocumentId?: () => string,
   *   now?: () => number,
   *   pingAction?: string,
   *   documentContextAction?: string,
   * }} [options]
   */
  function createBootstrapRuntime(options = {}) {
    const scope = options.scope || globalThis;
    const existing = scope[STATE_KEY];
    if (isBootstrapState(existing)) {
      return existing;
    }
    if (existing != null) {
      throw new Error('CONTENT_BOOTSTRAP_STATE_INCOMPATIBLE');
    }

    const messagePort = isMessagePort(options.messagePort) ? options.messagePort : null;
    const isTopFrame = typeof options.isTopFrame === 'function' ? options.isTopFrame : () => false;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const pingAction = typeof options.pingAction === 'string' && options.pingAction
      ? options.pingAction
      : DEFAULT_PING_ACTION;
    const documentContextAction = (
      typeof options.documentContextAction === 'string' && options.documentContextAction
        ? options.documentContextAction
        : DEFAULT_DOCUMENT_CONTEXT_ACTION
    );
    const documentInstanceId = resolveDocumentId(scope, options.createDocumentId);

    const state = {
      version: 1,
      phase: /** @type {string} */ (PHASES.NEW),
      generation: 0,
      documentInstanceId,
      mainListener: null,
      earlyListener: null,
      lastFailure: null,
      claim() {
        if (this.phase === PHASES.INVALIDATED) {
          return { claimed: false, invalidated: true, generation: this.generation };
        }
        if (this.phase === PHASES.BOOTSTRAPPING || this.phase === PHASES.READY) {
          return { claimed: false, alreadyLoaded: true, generation: this.generation };
        }
        this.generation += 1;
        this.phase = PHASES.BOOTSTRAPPING;
        this.lastFailure = null;
        scope[MAIN_LOADED_KEY] = true;
        scope[READY_KEY] = false;
        return { claimed: true, alreadyLoaded: false, generation: this.generation };
      },
      markRetryableFailed(generation, reason, attempts = 1) {
        if (generation !== this.generation || this.phase === PHASES.INVALIDATED) {
          return false;
        }
        this.phase = PHASES.RETRYABLE_FAILED;
        this.lastFailure = {
          reason: typeof reason === 'string' && reason ? reason : 'BOOTSTRAP_FAILED',
          attempts: Number.isInteger(attempts) && attempts > 0 ? attempts : 1,
          timestamp: now(),
        };
        this.mainListener = null;
        scope[MAIN_LOADED_KEY] = false;
        scope[READY_KEY] = false;
        return true;
      },
      markReady(generation, listener) {
        if (generation !== this.generation || this.phase !== PHASES.BOOTSTRAPPING) {
          return false;
        }
        this.mainListener = typeof listener === 'function' ? listener : null;
        this.phase = PHASES.READY;
        this.lastFailure = null;
        scope[MAIN_LOADED_KEY] = true;
        scope[READY_KEY] = true;
        return true;
      },
      rearmMainListener() {
        const listener = this.mainListener || scope[MAIN_LISTENER_KEY];
        if (!messagePort || typeof listener !== 'function') {
          return false;
        }
        messagePort.removeListener(listener);
        messagePort.addListener(listener);
        return true;
      },
      detachEarlyListener() {
        if (!messagePort || typeof this.earlyListener !== 'function') {
          return false;
        }
        messagePort.removeListener(this.earlyListener);
        if (scope[EARLY_LISTENER_KEY] === this.earlyListener) {
          delete scope[EARLY_LISTENER_KEY];
        }
        this.earlyListener = null;
        return true;
      },
      invalidate(generation, reason = 'context-invalidated') {
        if (Number.isInteger(generation) && generation !== this.generation) {
          return false;
        }
        this.phase = PHASES.INVALIDATED;
        this.lastFailure = { reason, attempts: 0, timestamp: now() };
        scope[MAIN_LOADED_KEY] = false;
        scope[READY_KEY] = false;
        return true;
      },
    };

    scope[DOCUMENT_ID_KEY] = documentInstanceId;
    scope[STATE_KEY] = state;

    if (messagePort) {
      const earlyListener = (message, sender, sendResponse) => {
        const action = message?.action;
        if (action === documentContextAction) {
          if (!isTopFrame() || state.phase === PHASES.INVALIDATED) {
            return false;
          }
          sendResponse({
            ok: true,
            documentInstanceId,
            url: typeof scope.location?.href === 'string' ? scope.location.href : '',
          });
          return true;
        }
        if (action !== pingAction || state.phase === PHASES.READY) {
          return false;
        }
        sendResponse({
          ok: false,
          phase: state.phase,
          reason: state.lastFailure?.reason || null,
          retryable: state.phase === PHASES.RETRYABLE_FAILED,
        });
        return true;
      };
      state.earlyListener = earlyListener;
      scope[EARLY_LISTENER_KEY] = earlyListener;
      messagePort.addListener(earlyListener);
    }

    return state;
  }

  const existingApi = globalThis[API_KEY];
  if (existingApi?.version === 1 && typeof existingApi.getOrCreate === 'function') {
    return;
  }

  globalThis[API_KEY] = Object.freeze({
    version: 1,
    phases: PHASES,
    getOrCreate: createBootstrapRuntime,
  });
})();
