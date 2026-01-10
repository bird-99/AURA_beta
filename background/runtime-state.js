import { STORAGE_KEYS } from '../shared/constants.js';
import { isValidTabId } from '../shared/utils.js';

const EMPTY_STATE = Object.freeze({});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRuntimeState(raw) {
  if (!isPlainObject(raw)) {
    return {};
  }

  const normalized = {};

  if (isPlainObject(raw.tabs)) {
    normalized.tabs = raw.tabs;
  }

  if (isPlainObject(raw.degraded)) {
    normalized.degraded = raw.degraded;
  }

  return normalized;
}

function mergeRecord(existing, patch) {
  const merged = { ...(existing || {}) };
  if (!isPlainObject(patch)) {
    return merged;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeRuntimeState(state, patch) {
  const current = isPlainObject(state) ? state : EMPTY_STATE;
  const update = isPlainObject(patch) ? patch : EMPTY_STATE;
  const merged = { ...current };

  if (isPlainObject(update.tabs)) {
    const nextTabs = { ...(current.tabs || {}) };
    for (const [tabKey, tabPatch] of Object.entries(update.tabs)) {
      const nextEntry = mergeRecord(nextTabs[tabKey], tabPatch);
      if (Object.keys(nextEntry).length === 0) {
        delete nextTabs[tabKey];
      } else {
        nextTabs[tabKey] = nextEntry;
      }
    }
    merged.tabs = nextTabs;
  }

  if (isPlainObject(update.degraded)) {
    const nextDegraded = mergeRecord(current.degraded, update.degraded);
    if (Object.keys(nextDegraded).length === 0) {
      delete merged.degraded;
    } else {
      merged.degraded = nextDegraded;
    }
  }

  return merged;
}

export async function getRuntimeState() {
  try {
    if (!chrome?.storage?.session?.get) {
      console.warn('[RuntimeState] chrome.storage.session unavailable');
      return {};
    }
    const data = await chrome.storage.session.get(STORAGE_KEYS.RUNTIME_STATE);
    return normalizeRuntimeState(data?.[STORAGE_KEYS.RUNTIME_STATE]);
  } catch (error) {
    console.warn('[RuntimeState] Failed to read runtime state:', error);
    return {};
  }
}

export async function patchRuntimeState(patch) {
  try {
    if (!chrome?.storage?.session?.set) {
      console.warn('[RuntimeState] chrome.storage.session unavailable');
      return;
    }
    const state = await getRuntimeState();
    const merged = mergeRuntimeState(state, patch);
    await chrome.storage.session.set({ [STORAGE_KEYS.RUNTIME_STATE]: merged });
  } catch (error) {
    console.warn('[RuntimeState] Failed to patch runtime state:', error);
  }
}

export async function getTabRuntime(tabId) {
  if (!isValidTabId(tabId)) {
    return undefined;
  }

  const state = await getRuntimeState();
  return state.tabs?.[String(tabId)];
}

export async function patchTabRuntime(tabId, patch) {
  if (!isValidTabId(tabId)) {
    return;
  }

  const tabKey = String(tabId);
  await patchRuntimeState({ tabs: { [tabKey]: patch } });
}
