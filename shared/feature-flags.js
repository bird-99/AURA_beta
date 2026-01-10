// shared/feature-flags.js

import { MODE_ENGINE_FLAG_DEFAULTS, STORAGE_KEYS } from './constants.js';

const FLAG_DEFAULTS = { ...MODE_ENGINE_FLAG_DEFAULTS };

let cachedFlags = { ...FLAG_DEFAULTS };
let initPromise = null;
let storageListenerRegistered = false;

function normalizeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const normalized = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key in FLAG_DEFAULTS && typeof value === 'boolean') {
      normalized[key] = value;
    }
  }

  return normalized;
}

function mergeFlags(overrides = {}) {
  return { ...FLAG_DEFAULTS, ...overrides };
}

async function readOverridesFromStorage() {
  try {
    if (!chrome?.storage?.local?.get) {
      return {};
    }

    const stored = await chrome.storage.local.get(STORAGE_KEYS.FEATURE_FLAGS);
    return normalizeOverrides(stored?.[STORAGE_KEYS.FEATURE_FLAGS]);
  } catch (error) {
    console.warn('[FeatureFlags] Failed to read overrides from storage', error);
    return {};
  }
}

function registerStorageListener() {
  if (storageListenerRegistered) {
    return;
  }

  if (!chrome?.storage?.onChanged?.addListener) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.FEATURE_FLAGS)) {
      const nextOverrides = normalizeOverrides(changes[STORAGE_KEYS.FEATURE_FLAGS]?.newValue);
      cachedFlags = mergeFlags(nextOverrides);
    }
  });

  storageListenerRegistered = true;
}

export async function initFeatureFlags() {
  if (!initPromise) {
    initPromise = (async () => {
      const overrides = await readOverridesFromStorage();
      cachedFlags = mergeFlags(overrides);
      registerStorageListener();
      return cachedFlags;
    })().catch((error) => {
      console.warn('[FeatureFlags] Initialization failed; using defaults', error);
      cachedFlags = { ...FLAG_DEFAULTS };
      return cachedFlags;
    });
  }

  return initPromise;
}

export function isFlagEnabled(flagName) {
  if (!(flagName in FLAG_DEFAULTS)) {
    return false;
  }

  return cachedFlags[flagName] === true;
}

export function getAllFeatureFlags() {
  return { ...cachedFlags };
}

export const getAllFlags = getAllFeatureFlags;

export function __resetFeatureFlagCacheForTests() {
  cachedFlags = { ...FLAG_DEFAULTS };
  initPromise = null;
  storageListenerRegistered = false;
}

export function __applyFlagOverridesForTests(overrides = {}) {
  cachedFlags = mergeFlags(normalizeOverrides(overrides));
}

export { FLAG_DEFAULTS as MODE_ENGINE_FLAGS }; 
