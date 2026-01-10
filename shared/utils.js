// shared/utils.js

import { ERROR_CODES, MODE_IDS, STATES } from './constants.js';

// ========== STORAGE HELPERS ==========

/**
 * Wrapper sécurisé pour chrome.storage.local.get
 * @param {string} key - Clé storage
 * @returns {Promise<any>} Valeur ou null si erreur
 */
export async function getFromLocal(key) {
  try {
    const data = await chrome.storage.local.get(key);
    return data[key] || null;
  } catch (error) {
    console.error(`[Utils] getFromLocal(${key}) error:`, error);
    return null;
  }
}

/**
 * Wrapper sécurisé pour chrome.storage.local.set
 * @param {string} key - Clé storage
 * @param {any} value - Valeur à stocker
 * @returns {Promise<boolean>} true si succès, false si erreur
 */
export async function setToLocal(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
    return true;
  } catch (error) {
    console.error(`[Utils] setToLocal(${key}) error:`, error);
    return false;
  }
}

/**
 * Wrapper sécurisé pour chrome.storage.session.get
 * @param {string} key - Clé storage
 * @returns {Promise<any>} Valeur ou null si erreur
 */
export async function getFromSession(key) {
  try {
    const data = await chrome.storage.session.get(key);
    return data[key] || null;
  } catch (error) {
    console.error(`[Utils] getFromSession(${key}) error:`, error);
    return null;
  }
}

/**
 * Wrapper sécurisé pour chrome.storage.session.set
 * @param {string} key - Clé storage
 * @param {any} value - Valeur à stocker
 * @returns {Promise<boolean>} true si succès, false si erreur
 */
export async function setToSession(key, value) {
  try {
    await chrome.storage.session.set({ [key]: value });
    return true;
  } catch (error) {
    console.error(`[Utils] setToSession(${key}) error:`, error);
    return false;
  }
}

// ========== VALIDATION HELPERS ==========

/**
 * Valide un tabId
 * @param {any} tabId
 * @returns {boolean}
 */
export function isValidTabId(tabId) {
  return typeof tabId === 'number' && tabId > 0;
}

/**
 * Valide un modeId
 * @param {any} modeId
 * @returns {boolean}
 */
export function isValidModeId(modeId) {
  return typeof modeId === 'string' && Object.values(MODE_IDS).includes(modeId);
}

/**
 * Valide un state
 * @param {any} state
 * @returns {boolean}
 */
export function isValidState(state) {
  return typeof state === 'string' && Object.values(STATES).includes(state);
}

// ========== TIME HELPERS ==========

/**
 * Retourne le timestamp actuel en secondes
 * @returns {number}
 */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convertit des millisecondes en secondes (arrondi inférieur)
 * @param {number} ms
 * @returns {number}
 */
export function msToSeconds(ms) {
  return Math.floor(ms / 1000);
}

/**
 * Convertit des secondes en millisecondes
 * @param {number} seconds
 * @returns {number}
 */
export function secondsToMs(seconds) {
  return Math.floor(seconds * 1000);
}

/**
 * Crée un timestamp d'expiration
 * @param {number} durationMs - Durée en ms
 * @returns {number} Timestamp d'expiration
 */
export function createExpiresAt(durationMs) {
  return Date.now() + durationMs;
}

/**
 * Vérifie si un timestamp est expiré
 * @param {number} expiresAt - Timestamp en ms
 * @returns {boolean}
 */
export function isExpired(expiresAt) {
  return Date.now() > expiresAt;
}

/**
 * Calcule le temps restant avant expiration (ms)
 * @param {number} expiresAt - Timestamp en ms
 * @returns {number}
 */
export function remainingMs(expiresAt) {
  return Math.max(0, expiresAt - Date.now());
}

// ========== CAPABILITY HELPERS ==========

/**
 * Vérifie la disponibilité de chrome.action.openPopup()
 * @returns {boolean}
 */
export function canOpenPopup() {
  return typeof chrome !== 'undefined' && typeof chrome?.action?.openPopup === 'function';
}

function buildOptionsFallbackUrl({ modeId, reason }) {
  const params = new URLSearchParams();
  params.set('scrollTo', 'why');
  if (modeId) {
    params.set('modeId', modeId);
  }
  if (reason) {
    params.set('reason', reason);
  }
  const query = params.toString();
  const base = chrome?.runtime?.getURL ? chrome.runtime.getURL('options/options.html') : 'options/options.html';
  return query ? `${base}?${query}` : base;
}

function buildWelcomeFallbackUrl() {
  return chrome?.runtime?.getURL ? chrome.runtime.getURL('welcome/welcome.html') : 'welcome/welcome.html';
}

/**
 * Tente d'ouvrir la popup toolbar ou applique un fallback.
 * @param {{ fallback: "openOptions" | "openWelcome" | "notify", reason?: string, modeId?: string }} opts
 * @returns {Promise<{ used: "openPopup"|"fallback", error?: string }>}
 */
export async function tryOpenPopupOrFallback(opts = {}) {
  const { fallback = 'notify', reason, modeId } = opts;
  let errorMessage;

  if (canOpenPopup()) {
    try {
      await chrome.action.openPopup();
      console.debug('[Popup] openPopup used');
      return { used: 'openPopup' };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      console.debug('[Popup] openPopup failed, using fallback', error);
    }
  }

  const fallbackReason = reason || 'openPopup_failed';

  try {
    if (fallback === 'openOptions') {
      const url = buildOptionsFallbackUrl({ modeId, reason: fallbackReason });
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url });
      } else if (chrome?.runtime?.openOptionsPage) {
        await chrome.runtime.openOptionsPage();
      }
    } else if (fallback === 'openWelcome') {
      const url = buildWelcomeFallbackUrl();
      if (chrome?.tabs?.create) {
        await chrome.tabs.create({ url });
      }
    } else if (fallback === 'notify') {
      if (chrome?.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({ action: 'POPUP_FALLBACK', reason: fallbackReason, modeId });
      }
    }

    console.debug('[Popup] fallback used');
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    console.debug('[Popup] fallback failed', error);
  }

  return { used: 'fallback', error: errorMessage };
}

// ========== DOMAIN HELPERS (eTLD+1 - Roadmap v5.2) ==========

/**
 * Extrait le siteKey (eTLD+1) d'une URL pour normalisation per-domain prefs/learning
 *
 * Roadmap v5.2 requirement: Use eTLD+1 (e.g., bbc.co.uk, github.com) via Public Suffix List.
 *
 * Implementation requires bundling a PSL parser (tldts or psl) with extension build.
 * Recommended: `tldts` (modern, maintained, 84KB minified)
 *
 * Build setup:
 * ```bash
 * npm install tldts
 * # Bundler (esbuild/rollup/webpack) will inline the library
 * ```
 *
 * @param {string} url - Full URL (e.g., https://news.bbc.co.uk/article)
 * @returns {string} siteKey (eTLD+1) or fallback
 *
 * Examples:
 * - https://news.bbc.co.uk/article → bbc.co.uk
 * - https://gist.github.com/user → github.com
 * - https://www.amazon.com/product → amazon.com
 * - http://localhost:3000 → localhost
 * - https://192.168.1.1 → 192.168.1.1
 */
export function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;

    // Fallback 1: localhost
    if (hostname === 'localhost') {
      return 'localhost';
    }

    // Fallback 2: IP addresses (IPv4)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return hostname;
    }

    // Fallback 3: IPv6 (contains colons)
    if (hostname.includes(':')) {
      return hostname;
    }

    // eTLD+1 extraction via tldts (bundled via build)
    // NOTE: This import must be resolved by bundler (esbuild/rollup)
    // For MVP without bundler: use simple fallback below

    // Option A: With tldts (production - requires bundler)
    // import { getDomain } from 'tldts';
    // const siteKey = getDomain(hostname);
    // return siteKey || hostname;

    // Option B: Simple fallback (MVP without bundler - less accurate for UK/Japanese domains)
    // Extract last 2 parts of hostname
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.'); // e.g., bbc.co.uk → co.uk (WRONG for UK!)
    }
    return hostname;
  } catch (error) {
    console.error('[Utils] extractDomain error:', error);
    return 'unknown';
  }
}

/**
 * PRODUCTION NOTE (when implementing):
 *
 * Replace Option B simple fallback with Option A (tldts):
 *
 * ```javascript
 * import { getDomain } from 'tldts';
 *
 * export function extractDomain(url) {
 *   try {
 *     const hostname = new URL(url).hostname;
 *     if (hostname === 'localhost') return 'localhost';
 *     if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
 *
 *     const siteKey = getDomain(hostname);
 *     return siteKey || hostname;
 *   } catch (error) {
 *     console.error('[Utils] extractDomain error:', error);
 *     return 'unknown';
 *   }
 * }
 * ```
 *
 * This requires build step:
 * 1. npm install tldts
 * 2. esbuild shared/utils.js --bundle --outfile=shared/utils.bundle.js
 * 3. Update manifest.json to reference shared/utils.bundle.js
 */

// ========== ERROR HELPERS ==========

/**
 * Log une erreur avec contexte
 * @param {string} component - Nom du composant
 * @param {string} method - Nom de la méthode
 * @param {Error} error - Erreur
 */
export function logError(component, method, error) {
  console.error(`[${component}] ${method} error:`, error);
}

/**
 * Crée un objet d'erreur standardisé
 * @param {string} code - Code erreur (voir ERROR_CODES)
 * @param {string} message - Message
 * @returns {{ code: string, message: string, timestamp: number }}
 */
export function createError(code, message) {
  return {
    code,
    message,
    timestamp: Date.now()
  };
}
