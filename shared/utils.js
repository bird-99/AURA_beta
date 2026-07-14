// shared/utils.js

import { ERROR_CODES, MODE_IDS, STATES } from './constants.js';
import { getDomain, parse as parseTldts } from './vendor/tldts.esm.min.js';

const TLDTS_OPTIONS = Object.freeze({
  allowIcannDomains: true,
  allowPrivateDomains: true,
  detectIp: true,
  extractHostname: false,
  validateHostname: true,
});

const LEGACY_SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'ac.jp', 'co.jp',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz',
]);

const storageMutationTails = new Map();

function getCrossContextStorageLockName(areaName, key) {
  return `aura-storage:${areaName}:${key}`;
}

function getCrossContextStorageAreaLockName(areaName) {
  return `aura-storage:${areaName}:*`;
}

async function withStorageLock(name, mode, operation) {
  const lockManager = globalThis.navigator?.locks;
  if (!lockManager || typeof lockManager.request !== 'function') {
    return operation();
  }
  return lockManager.request(name, { mode }, operation);
}

async function withCrossContextStorageLock(areaName, key, operation) {
  return withStorageLock(getCrossContextStorageAreaLockName(areaName), 'shared', () => (
    withStorageLock(getCrossContextStorageLockName(areaName, key), 'exclusive', operation)
  ));
}

export function runStorageAreaTransaction(areaName, operation) {
  if (!['local', 'session'].includes(areaName)) {
    return Promise.reject(new TypeError('Storage area must be local or session'));
  }
  if (typeof operation !== 'function') {
    return Promise.reject(new TypeError('Storage transaction callback is required'));
  }
  return withStorageLock(getCrossContextStorageAreaLockName(areaName), 'exclusive', operation);
}

function enqueueStorageMutation(areaName, key, mutation) {
  const queueKey = `${areaName}:${key}`;
  const previousTail = storageMutationTails.get(queueKey) || Promise.resolve();
  const run = previousTail.catch(() => undefined).then(mutation);
  const settledTail = run.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    if (storageMutationTails.get(queueKey) === settledTail) {
      storageMutationTails.delete(queueKey);
    }
  });
  storageMutationTails.set(queueKey, settledTail);
  return run;
}

async function mutateStorageValue(areaName, key, updater) {
  if (typeof updater !== 'function') {
    throw new TypeError('Storage updater must be a function');
  }

  return enqueueStorageMutation(areaName, key, () => withCrossContextStorageLock(areaName, key, async () => {
    const area = globalThis.chrome?.storage?.[areaName];
    if (!area?.get || !area?.set) {
      throw new Error(`chrome.storage.${areaName} unavailable`);
    }

    try {
      const data = await area.get(key);
      const nextValue = await updater(data?.[key]);
      await area.set({ [key]: nextValue });
      return nextValue;
    } catch (error) {
      const storageError = new Error(`Failed to mutate chrome.storage.${areaName}.${key}`);
      storageError.cause = error;
      throw storageError;
    }
  }));
}

export function mutateLocalValue(key, updater) {
  return mutateStorageValue('local', key, updater);
}

export function mutateSessionValue(key, updater) {
  return mutateStorageValue('session', key, updater);
}

async function replaceStorageValue(areaName, key, value) {
  return enqueueStorageMutation(areaName, key, () => withCrossContextStorageLock(areaName, key, async () => {
    const area = globalThis.chrome?.storage?.[areaName];
    if (!area?.set) throw new Error(`chrome.storage.${areaName} unavailable`);
    await area.set({ [key]: value });
    return true;
  }));
}

async function removeStorageValue(areaName, key) {
  return enqueueStorageMutation(areaName, key, () => withCrossContextStorageLock(areaName, key, async () => {
    const area = globalThis.chrome?.storage?.[areaName];
    if (!area?.remove) throw new Error(`chrome.storage.${areaName} unavailable`);
    await area.remove(key);
    return true;
  }));
}

export function removeLocalValue(key) {
  return removeStorageValue('local', key);
}

export function removeSessionValue(key) {
  return removeStorageValue('session', key);
}

function normalizeHostnameInput(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { hostname: '', protocol: '' };

  const protocolMatch = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed);
  try {
    const parsed = protocolMatch ? new URL(trimmed) : new URL(`http://${trimmed}`);
    return {
      hostname: String(parsed.hostname || '').toLowerCase().replace(/\.$/, ''),
      protocol: String(parsed.protocol || '').toLowerCase(),
    };
  } catch (_) {
    return { hostname: '', protocol: protocolMatch?.[0]?.toLowerCase?.() || '' };
  }
}

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
 * @returns {Promise<boolean>} true si succès; rejette si l'écriture échoue
 */
export async function setToLocal(key, value) {
  try {
    return await replaceStorageValue('local', key, value);
  } catch (error) {
    console.error(`[Utils] setToLocal(${key}) error:`, error);
    throw error;
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
 * @returns {Promise<boolean>} true si succès; rejette si l'écriture échoue
 */
export async function setToSession(key, value) {
  try {
    return await replaceStorageValue('session', key, value);
  } catch (error) {
    console.error(`[Utils] setToSession(${key}) error:`, error);
    throw error;
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
 * @param {{ fallback?: "openOptions" | "openWelcome" | "notify", reason?: string, modeId?: string }} opts
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
 * Extrait le siteKey (eTLD+1) d'une URL/hostname pour normalisation per-domain prefs/learning
 *
 * Roadmap v5.2 requirement: Use eTLD+1 (e.g., bbc.co.uk, github.com) via Public Suffix List.
 *
 * Implementation uses `tldts` (PSL-based).
 *
 * @param {string} url - Full URL or hostname
 * @returns {string} siteKey (eTLD+1) or fallback
 *
 * Examples:
 * - https://news.bbc.co.uk/article → bbc.co.uk
 * - https://gist.github.com/user → github.com
 * - https://www.amazon.com/product → amazon.com
 * - http://localhost:3000 → localhost
 * - https://192.168.1.1 → 192.168.1.1
 * - file:///Users/me/doc.pdf → file
 * - chrome-extension://<id>/popup.html → chrome-extension
 */
export function extractDomain(url) {
  try {
    if (typeof url !== 'string' || url.trim() === '') {
      return 'unknown';
    }

    const { hostname, protocol } = normalizeHostnameInput(url);
    if (protocol === 'file:') return 'file';
    if (['chrome-extension:', 'chrome:', 'edge:', 'moz-extension:'].includes(protocol)) {
      return protocol.slice(0, -1);
    }
    if (!hostname) {
      return protocol ? protocol.slice(0, -1) : 'unknown';
    }

    const siteKey = getDomain(hostname, TLDTS_OPTIONS);
    return siteKey || hostname;
  } catch (error) {
    console.error('[Utils] extractDomain error:', error);
    return 'unknown';
  }
}

/**
 * Parses a user-entered site hostname without accepting URLs, paths or broad
 * public suffixes. The returned siteKey includes private PSL suffixes.
 *
 * @param {unknown} input
 * @returns {{ ok: true, hostname: string, siteKey: string, isIp: boolean } | { ok: false, reason: string }}
 */
export function parseStrictDomainInput(input) {
  const trimmed = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!trimmed) return { ok: false, reason: 'Domain required' };
  if (trimmed.length > 255) return { ok: false, reason: 'Invalid domain' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { ok: false, reason: 'Enter a domain without a scheme' };
  if (/[\s/\\?#@]/.test(trimmed)) return { ok: false, reason: 'Enter a domain without a path' };

  let hostname = '';
  try {
    const parsedUrl = new URL(`https://${trimmed}`);
    if (parsedUrl.port || parsedUrl.username || parsedUrl.password) {
      return { ok: false, reason: 'Enter a domain without credentials or a port' };
    }
    hostname = String(parsedUrl.hostname || '').toLowerCase().replace(/\.$/, '');
  } catch (_) {
    return { ok: false, reason: 'Invalid domain' };
  }

  const parsed = parseTldts(hostname, TLDTS_OPTIONS);
  if (!parsed.hostname) return { ok: false, reason: 'Invalid domain' };
  if (parsed.isIp || hostname === 'localhost') {
    return { ok: true, hostname, siteKey: hostname, isIp: parsed.isIp === true };
  }
  if (!parsed.domain) return { ok: false, reason: 'Public suffix is not a site' };
  return {
    ok: true,
    hostname,
    siteKey: parsed.domain.toLowerCase(),
    isIp: false,
  };
}

async function readStorageValueResult(areaName, key) {
  const area = globalThis.chrome?.storage?.[areaName];
  if (!area?.get) {
    return {
      ok: false,
      status: 'error',
      value: null,
      error: { message: `chrome.storage.${areaName} unavailable` },
    };
  }

  try {
    const data = await area.get(key);
    if (!Object.prototype.hasOwnProperty.call(data || {}, key) || data[key] === undefined) {
      return { ok: true, status: 'missing', value: null, error: null };
    }
    return { ok: true, status: 'found', value: data[key], error: null };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      value: null,
      error: { message: error?.message || String(error) },
    };
  }
}

export function readLocalValueResult(key) {
  return readStorageValueResult('local', key);
}

export function readSessionValueResult(key) {
  return readStorageValueResult('session', key);
}

export function extractLegacyDomain(url) {
  try {
    const { hostname, protocol } = normalizeHostnameInput(url);
    if (protocol === 'file:') return 'file';
    if (['chrome-extension:', 'chrome:', 'edge:', 'moz-extension:'].includes(protocol)) {
      return protocol.slice(0, -1);
    }
    if (!hostname) return protocol ? protocol.slice(0, -1) : 'unknown';

    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 1 || hostname.startsWith('[')) return hostname;
    const lastTwo = parts.slice(-2).join('.');
    if (LEGACY_SECOND_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return lastTwo;
  } catch (_) {
    return 'unknown';
  }
}

export function getDomainKeyCandidates(url) {
  const current = extractDomain(url);
  return current && current !== 'unknown' ? [current] : [];
}

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
