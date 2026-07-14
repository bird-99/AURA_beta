import { STORAGE_KEYS } from '../shared/constants.js';
import { mutateSessionValue } from '../shared/utils.js';

const DEFAULT_STORAGE_KEY = STORAGE_KEYS.CSS_REGISTRY;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

/**
 * @typedef {'AUTHOR' | 'USER'} CssOrigin
 */

/**
 * @typedef {Object} CssRegistryEntry
 * @property {string} cssId
 * @property {string} cssHash
 * @property {string} cssText
 * @property {CssOrigin} origin
 * @property {{
 *  tabId: number;
 *  modeId: string;
 *  createdAt: number;
 *  scopeKey?: string | null;
 *  variant?: string | null;
 *  intensity?: number | null;
 * }} meta
 */

async function computeHash(cssText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(cssText || '');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadRegistry(storageKey) {
  const existing = await chrome.storage.session.get(storageKey);
  return existing?.[storageKey] || {};
}

export class CssRegistry {
  constructor(storageKey = DEFAULT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async register(cssText, origin, meta, options = {}) {
    const now = Date.now();
    const cssHash = await computeHash(cssText);
    const requestedCssId = typeof options?.cssId === 'string' ? options.cssId.trim() : '';
    const cssId = requestedCssId || `aura-css-${now}-${crypto.randomUUID()}`;

    const entry = {
      cssId,
      cssHash,
      cssText,
      origin,
      meta: {
        ...meta,
        createdAt: meta?.createdAt || now,
      },
    };

    await mutateSessionValue(this.storageKey, (storedRegistry) => ({
      ...(storedRegistry && typeof storedRegistry === 'object' ? storedRegistry : {}),
      [cssId]: entry,
    }));

    return { cssId, cssHash };
  }

  async get(cssId) {
    if (!cssId) {
      return null;
    }
    const registry = await loadRegistry(this.storageKey);
    return registry[cssId] || null;
  }

  async list() {
    const registry = await loadRegistry(this.storageKey);
    return Object.values(registry || {});
  }

  async remove(cssId) {
    if (!cssId) {
      return;
    }
    await mutateSessionValue(this.storageKey, (storedRegistry) => {
      const registry = storedRegistry && typeof storedRegistry === 'object' ? { ...storedRegistry } : {};
      delete registry[cssId];
      return registry;
    });
  }

  async cleanup(params = {}) {
    const { maxAgeMs = DEFAULT_MAX_AGE_MS, maxEntries = DEFAULT_MAX_ENTRIES, preserveCssIds = [] } = params;
    const now = Date.now();
    const preserved = new Set((Array.isArray(preserveCssIds) ? preserveCssIds : []).filter(Boolean));
    let removed = 0;
    await mutateSessionValue(this.storageKey, (storedRegistry) => {
      const registry = storedRegistry && typeof storedRegistry === 'object' ? { ...storedRegistry } : {};
      const entries = Object.values(registry);
      if (maxAgeMs && Number.isFinite(maxAgeMs)) {
        for (const entry of entries) {
          if (preserved.has(entry?.cssId)) continue;
          if (typeof entry?.meta?.createdAt === 'number' && now - entry.meta.createdAt > maxAgeMs) {
            delete registry[entry.cssId];
            removed += 1;
          }
        }
      }
      const remainingEntries = Object.values(registry);
      if (maxEntries && Number.isFinite(maxEntries) && remainingEntries.length > maxEntries) {
        const sorted = [...remainingEntries].sort((a, b) => (b?.meta?.createdAt || 0) - (a?.meta?.createdAt || 0));
        const protectedCount = sorted.filter((entry) => preserved.has(entry?.cssId)).length;
        const effectiveMaxEntries = Math.max(maxEntries, protectedCount);
        const toDrop = sorted.slice(effectiveMaxEntries).filter((entry) => !preserved.has(entry?.cssId));
        for (const entry of toDrop) {
          if (registry[entry.cssId]) {
            delete registry[entry.cssId];
            removed += 1;
          }
        }
      }
      return registry;
    });

    return { removed };
  }
}

export const cssRegistry = new CssRegistry();
