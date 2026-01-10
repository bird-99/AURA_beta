import { STORAGE_KEYS } from '../shared/constants.js';

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

async function saveRegistry(storageKey, registry) {
  await chrome.storage.session.set({ [storageKey]: registry });
}

export class CssRegistry {
  constructor(storageKey = DEFAULT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async register(cssText, origin, meta) {
    const now = Date.now();
    const cssHash = await computeHash(cssText);
    const cssId = `aura-css-${now}-${crypto.randomUUID()}`;

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

    const registry = await loadRegistry(this.storageKey);
    registry[cssId] = entry;
    await saveRegistry(this.storageKey, registry);

    return { cssId, cssHash };
  }

  async get(cssId) {
    if (!cssId) {
      return null;
    }
    const registry = await loadRegistry(this.storageKey);
    return registry[cssId] || null;
  }

  async remove(cssId) {
    if (!cssId) {
      return;
    }
    const registry = await loadRegistry(this.storageKey);
    if (registry[cssId]) {
      delete registry[cssId];
      await saveRegistry(this.storageKey, registry);
    }
  }

  async cleanup(params = {}) {
    const { maxAgeMs = DEFAULT_MAX_AGE_MS, maxEntries = DEFAULT_MAX_ENTRIES } = params;
    const now = Date.now();
    const registry = await loadRegistry(this.storageKey);
    const entries = Object.values(registry || {});
    let removed = 0;

    if (maxAgeMs && Number.isFinite(maxAgeMs)) {
      for (const entry of entries) {
        if (typeof entry?.meta?.createdAt === 'number' && now - entry.meta.createdAt > maxAgeMs) {
          delete registry[entry.cssId];
          removed += 1;
        }
      }
    }

    const remainingEntries = Object.values(registry || {});
    if (maxEntries && Number.isFinite(maxEntries) && remainingEntries.length > maxEntries) {
      const sorted = [...remainingEntries].sort((a, b) => (b?.meta?.createdAt || 0) - (a?.meta?.createdAt || 0));
      const toDrop = sorted.slice(maxEntries);
      for (const entry of toDrop) {
        if (registry[entry.cssId]) {
          delete registry[entry.cssId];
          removed += 1;
        }
      }
    }

    if (removed > 0) {
      await saveRegistry(this.storageKey, registry);
    }

    return { removed };
  }
}

export const cssRegistry = new CssRegistry();
