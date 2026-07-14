import { ACTIONS } from '../shared/constants.js';
import { createError, isValidTabId } from '../shared/utils.js';
import { isUnsupportedScheme } from './site-policy-manager.js';

export const DEFAULT_INJECT_FILES = [
  'content/top-layer-host.runtime.js',
  'content/rect-animator.runtime.js',
  'content/focus-engine-controller.runtime.js',
  'content/focus-overlay-v2.runtime.js',
  'content/ultra-focus.runtime.js',
  'content/reading-ruler.runtime.js',
  'content/smartscope-v2.runtime.js',
  'content/mode-engine-scoped-v2.runtime.js',
  'content/dark-comfort-theme.runtime.js',
  'content/page-signals-adapter.runtime.js',
  'content/content-bootstrap.runtime.js',
  'content/content-message-router.runtime.js',
  'content/content-main.js',
];

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 100,
  receiverMaxAttempts: 6,
  receiverBaseDelayMs: 250,
  pingAction: ACTIONS.TEST_PING_CONTENT,
  injectFiles: DEFAULT_INJECT_FILES,
  entrypointFiles: [
    'content/content-message-router.runtime.js',
    'content/content-main.js',
  ],
};

const RETRYABLE_BOOTSTRAP_PHASE = 'RETRYABLE_FAILED';
const TERMINAL_BOOTSTRAP_PHASE = 'INVALIDATED';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ContentBridge {
  constructor(opts = {}) {
    this.maxAttempts = typeof opts.maxAttempts === 'number' ? opts.maxAttempts : DEFAULTS.maxAttempts;
    this.baseDelayMs = typeof opts.baseDelayMs === 'number' ? opts.baseDelayMs : DEFAULTS.baseDelayMs;
    this.receiverMaxAttempts =
      typeof opts.receiverMaxAttempts === 'number' ? opts.receiverMaxAttempts : DEFAULTS.receiverMaxAttempts;
    this.receiverBaseDelayMs =
      typeof opts.receiverBaseDelayMs === 'number' ? opts.receiverBaseDelayMs : DEFAULTS.receiverBaseDelayMs;
    this.pingAction = typeof opts.pingAction === 'string' ? opts.pingAction : DEFAULTS.pingAction;
    this.injectFiles = Array.isArray(opts.injectFiles) && opts.injectFiles.length > 0 ? opts.injectFiles : DEFAULTS.injectFiles;
    this.entrypointFiles = Array.isArray(opts.entrypointFiles) && opts.entrypointFiles.length > 0
      ? opts.entrypointFiles
      : DEFAULTS.entrypointFiles;
    this.debug = opts.debug === true;
  }

  _logDebug(message, ...args) {
    if (this.debug) {
      console.debug(`[SW][ContentBridge] ${message}`, ...args);
    }
  }

  _isReceivingEndMissing(errorMessage = '') {
    return errorMessage.includes('Receiving end does not exist');
  }

  async _getTab(tabId) {
    if (!isValidTabId(tabId)) {
      return { ok: false, error: createError('E004', 'Invalid tabId'), code: 'E004' };
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url) {
        return { ok: false, error: createError('E004', 'Tab URL missing'), code: 'E004' };
      }
      if (isUnsupportedScheme(tab.url)) {
        return { ok: false, error: createError('UNSUPPORTED_SCHEME', 'Unsupported scheme'), code: 'UNSUPPORTED_SCHEME' };
      }
      return { ok: true, tab };
    } catch (error) {
      return { ok: false, error: createError('E004', 'Tab lookup failed'), code: 'E004' };
    }
  }

  async _sendMessage(tabId, message, opts = {}) {
    return new Promise((resolve, reject) => {
      const callback = (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      };

      if (typeof opts.documentId === 'string' && opts.documentId) {
        chrome.tabs.sendMessage(tabId, message, { documentId: opts.documentId }, callback);
        return;
      }

      if (typeof opts.frameId === 'number') {
        chrome.tabs.sendMessage(tabId, message, { frameId: opts.frameId }, callback);
        return;
      }

      chrome.tabs.sendMessage(tabId, message, callback);
    });
  }

  async _inject(tabId, opts = {}, files = this.injectFiles) {
    const target = { tabId };
    if (typeof opts.documentId === 'string' && opts.documentId) {
      target.documentIds = [opts.documentId];
    } else if (typeof opts.frameId === 'number') {
      target.frameIds = [opts.frameId];
    }

    await chrome.scripting.executeScript({ target, files });
  }

  async ensureReceiver(tabId, opts = {}) {
    const validation = await this._getTab(tabId);
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error,
        code: validation.code,
        attempts: 0,
        injected: false,
        lastErrorMessage: '',
      };
    }

    let fullInjectionAttempted = false;
    let entrypointInjectionAttempted = false;
    let lastErrorMessage = '';

    for (let attempt = 1; attempt <= this.receiverMaxAttempts; attempt += 1) {
      try {
        const pingResponse = await this._sendMessage(tabId, { action: this.pingAction }, opts);
        if (pingResponse?.ok === true) {
          return {
            ok: true,
            attempts: attempt,
            injected: fullInjectionAttempted || entrypointInjectionAttempted,
            lastErrorMessage,
          };
        }
        if (pingResponse?.phase === TERMINAL_BOOTSTRAP_PHASE) {
          return {
            ok: false,
            error: createError('E001', 'Content bootstrap invalidated'),
            code: 'E001',
            attempts: attempt,
            injected: fullInjectionAttempted || entrypointInjectionAttempted,
            lastErrorMessage: pingResponse?.reason || TERMINAL_BOOTSTRAP_PHASE,
          };
        }
        if (
          pingResponse?.phase === RETRYABLE_BOOTSTRAP_PHASE
          && pingResponse?.retryable === true
          && !entrypointInjectionAttempted
        ) {
          try {
            await this._inject(tabId, opts, this.entrypointFiles);
            entrypointInjectionAttempted = true;
            this._logDebug('Content entrypoint reinjected after retryable bootstrap failure', attempt);
          } catch (injectError) {
            return {
              ok: false,
              error: createError('E001', 'Content entrypoint reinjection failed'),
              code: 'E001',
              attempts: attempt,
              injected: fullInjectionAttempted || entrypointInjectionAttempted,
              lastErrorMessage: injectError?.message || pingResponse?.reason || '',
            };
          }
        }
      } catch (error) {
        const errorMessage = error?.message || '';
        lastErrorMessage = errorMessage;
        if (this._isReceivingEndMissing(errorMessage)) {
          if (!fullInjectionAttempted) {
            try {
              await this._inject(tabId, opts);
              fullInjectionAttempted = true;
              this._logDebug('Content script injected on attempt', attempt);
            } catch (injectError) {
              const code = injectError?.message?.includes('No tab with id') ? 'E004' : 'E001';
              return {
                ok: false,
                error: createError(code, 'Content script injection failed'),
                code,
                attempts: attempt,
                injected: fullInjectionAttempted || entrypointInjectionAttempted,
                lastErrorMessage: injectError?.message || errorMessage,
              };
            }
          }
        } else {
          return {
            ok: false,
            error: createError('E001', errorMessage || 'Ping failed'),
            attempts: attempt,
            injected: fullInjectionAttempted || entrypointInjectionAttempted,
            lastErrorMessage: errorMessage,
          };
        }
      }

      await delay(this.receiverBaseDelayMs * attempt);
    }

    if (!this.debug) {
      console.warn('[SW][ContentBridge] Content receiver not ready', {
        tabId,
        attempts: this.receiverMaxAttempts,
        injected: fullInjectionAttempted || entrypointInjectionAttempted,
        lastErrorMessage,
      });
    }

    return {
      ok: false,
      error: createError('E001', 'Content script not ready'),
      attempts: this.receiverMaxAttempts,
      injected: fullInjectionAttempted || entrypointInjectionAttempted,
      lastErrorMessage,
    };
  }

  async safeSend(tabId, message, opts = {}) {
    const validation = await this._getTab(tabId);
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error,
        code: validation.code,
        attempts: 0,
        injected: false,
        lastErrorMessage: '',
      };
    }

    let injectionAttempted = false;
    let lastErrorMessage = '';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const data = await this._sendMessage(tabId, message, opts);
        return { ok: true, data, attempts: attempt, injected: injectionAttempted, lastErrorMessage };
      } catch (error) {
        const errorMessage = error?.message || '';
        lastErrorMessage = errorMessage;

        if (this._isReceivingEndMissing(errorMessage)) {
          const receiverResult = await this.ensureReceiver(tabId, opts);
          injectionAttempted = injectionAttempted || receiverResult.injected;
          lastErrorMessage = receiverResult.lastErrorMessage || lastErrorMessage;

          if (!receiverResult.ok && attempt >= this.maxAttempts) {
            return {
              ok: false,
              error: receiverResult.error || createError('E001', 'Receiving end missing'),
              code: receiverResult.code,
              attempts: attempt,
              injected: injectionAttempted,
              lastErrorMessage,
            };
          }

          if (receiverResult.ok) {
            try {
              const data = await this._sendMessage(tabId, message, opts);
              return { ok: true, data, attempts: attempt, injected: injectionAttempted, lastErrorMessage };
            } catch (retryError) {
              lastErrorMessage = retryError?.message || lastErrorMessage;
            }
          }
        } else {
          return {
            ok: false,
            error: createError('E001', errorMessage || 'Message failed'),
            attempts: attempt,
            injected: injectionAttempted,
            lastErrorMessage,
          };
        }
      }

      await delay(this.baseDelayMs * attempt);
    }

    return {
      ok: false,
      error: createError('E001', 'Max attempts reached'),
      attempts: this.maxAttempts,
      injected: injectionAttempted,
      lastErrorMessage,
    };
  }
}

export const contentBridge = new ContentBridge();
