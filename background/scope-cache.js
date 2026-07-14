const DEFAULT_SCOPE_CACHE_MAX = 100;

export const LAST_SCOPE_CACHE_MAX = DEFAULT_SCOPE_CACHE_MAX;
export const LAST_SCOPE_CACHE_TTL_MS = 10 * 60 * 1000;

export function makeScopeCacheKey(tabId, modeId) {
  return `${tabId}:${modeId}`;
}

export function makeUrlKey(url = '') {
  if (typeof url !== 'string' || !url.trim()) {
    return '';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return '';
  }
}

export function createScopeCache(maxEntries = LAST_SCOPE_CACHE_MAX) {
  const entries = new Map();

  return {
    get(cacheKey) {
      if (!entries.has(cacheKey)) {
        return null;
      }

      const entry = entries.get(cacheKey);
      entries.delete(cacheKey);
      entries.set(cacheKey, entry);
      return entry;
    },

    set(cacheKey, entry) {
      if (!entry || typeof entry.scopeSelector !== 'string' || !entry.scopeSelector.trim()) {
        return;
      }

      entries.set(cacheKey, entry);
      if (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey) {
          entries.delete(oldestKey);
        }
      }
    },

    delete(cacheKey) {
      return entries.delete(cacheKey);
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    },
  };
}

export function isCachedScopeEntryFresh(
  entry,
  urlKey,
  nowMs = Date.now(),
  ttlMs = LAST_SCOPE_CACHE_TTL_MS,
) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  if (!urlKey || entry.urlKey !== urlKey) {
    return false;
  }

  const savedAtMs = typeof entry.savedAtMs === 'number' ? entry.savedAtMs : NaN;
  const ageMs = nowMs - savedAtMs;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < ttlMs;
}

const lastScopeCache = createScopeCache();

export function getCachedScopeEntry(cacheKey) {
  return lastScopeCache.get(cacheKey);
}

export function setCachedScopeEntry(cacheKey, entry) {
  lastScopeCache.set(cacheKey, entry);
}

export function deleteCachedScopeEntry(cacheKey) {
  return lastScopeCache.delete(cacheKey);
}
