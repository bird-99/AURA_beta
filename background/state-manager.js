import { ACTIVE_QUALITIES, MODE_IDS, MODE_PREFS_DEFAULTS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import {
  getFromLocal,
  getFromSession,
  isValidTabId,
  isValidState,
  mutateLocalValue,
  mutateSessionValue,
  readSessionValueResult,
  removeSessionValue,
  setToSession,
} from '../shared/utils.js';

function getDefaultState() {
  return {
    state: STATES.INACTIVE,
    cssId: null,
    cssHash: null,
    pendingDecision: false,
    lastScore: 0,
    activatedAt: null,
    frameId: null,
    activeQuality: null,
    smartScope: null,
    scopedV2: null,
    lastLifecycleOpId: null,
    lastLifecycleGeneration: 0,
  };
}

export function normalizeModePrefs(rawModePrefs) {
  const defaults = MODE_PREFS_DEFAULTS;
  const normalized = {};
  const source = rawModePrefs && typeof rawModePrefs === 'object' && !Array.isArray(rawModePrefs)
    ? rawModePrefs
    : {};

  for (const [modeId, defaultPrefs] of Object.entries(defaults)) {
    const rawModeConfig = source[modeId];
    const sanitized = {};

    if (rawModeConfig && typeof rawModeConfig === 'object' && !Array.isArray(rawModeConfig)) {
      for (const key of Object.keys(defaultPrefs)) {
        if (typeof rawModeConfig[key] === 'boolean') {
          sanitized[key] = rawModeConfig[key];
        }
      }
    }

    normalized[modeId] = {
      ...defaultPrefs,
      ...sanitized,
    };

    if (modeId === MODE_IDS.FOCUS) {
      normalized[modeId].focusNotObscured = true;
    }
  }

  return normalized;
}

function isValidModeId(modeId) {
  return typeof modeId === 'string' && Object.values(MODE_IDS).includes(modeId);
}

function isValidActiveQuality(value) {
  return typeof value === 'string' && Object.values(ACTIVE_QUALITIES).includes(value);
}

export function pickAllowedTabStateFields(rawState) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return {};
  }

  const cleaned = {};

  if (isValidState(rawState.state)) {
    cleaned.state = rawState.state;
  }

  if (typeof rawState.cssId === 'string' || rawState.cssId === null) {
    cleaned.cssId = rawState.cssId;
  }

  if (typeof rawState.cssHash === 'string' || rawState.cssHash === null) {
    cleaned.cssHash = rawState.cssHash;
  }

  if (typeof rawState.pendingDecision === 'boolean') {
    cleaned.pendingDecision = rawState.pendingDecision;
  }

  if (typeof rawState.lastScore === 'number' && Number.isFinite(rawState.lastScore)) {
    cleaned.lastScore = rawState.lastScore;
  }

  if (rawState.activatedAt === null || (typeof rawState.activatedAt === 'number' && Number.isFinite(rawState.activatedAt))) {
    cleaned.activatedAt = rawState.activatedAt;
  }

  if (rawState.frameId === null || (Number.isInteger(rawState.frameId) && rawState.frameId >= 0)) {
    cleaned.frameId = rawState.frameId;
  }

  if (rawState.activeQuality === null || isValidActiveQuality(rawState.activeQuality)) {
    cleaned.activeQuality = rawState.activeQuality;
  }

  if (
    rawState.smartScope === null ||
    (rawState.smartScope && typeof rawState.smartScope === 'object' && !Array.isArray(rawState.smartScope))
  ) {
    cleaned.smartScope = rawState.smartScope;
  }

  if (
    rawState.scopedV2 === null ||
    (rawState.scopedV2 && typeof rawState.scopedV2 === 'object' && !Array.isArray(rawState.scopedV2))
  ) {
    cleaned.scopedV2 = rawState.scopedV2;
  }

  if (rawState.lastLifecycleOpId === null || typeof rawState.lastLifecycleOpId === 'string') {
    cleaned.lastLifecycleOpId = rawState.lastLifecycleOpId;
  }

  if (Number.isInteger(rawState.lastLifecycleGeneration) && rawState.lastLifecycleGeneration >= 0) {
    cleaned.lastLifecycleGeneration = rawState.lastLifecycleGeneration;
  }

  return cleaned;
}

export function normalizeTabState(rawState) {
  const defaults = getDefaultState();
  const cleaned = pickAllowedTabStateFields(rawState);

  return {
    ...defaults,
    ...cleaned,
    cssId: cleaned.cssId ?? defaults.cssId,
    cssHash: cleaned.cssHash ?? defaults.cssHash,
    pendingDecision: typeof cleaned.pendingDecision === 'boolean' ? cleaned.pendingDecision : defaults.pendingDecision,
    lastScore: typeof cleaned.lastScore === 'number' ? cleaned.lastScore : defaults.lastScore,
    activatedAt: typeof cleaned.activatedAt === 'number' ? cleaned.activatedAt : defaults.activatedAt,
    frameId: typeof cleaned.frameId === 'number' ? cleaned.frameId : defaults.frameId,
    activeQuality:
      cleaned.state === STATES.ACTIVE && isValidActiveQuality(cleaned.activeQuality)
        ? cleaned.activeQuality
        : defaults.activeQuality,
    smartScope: cleaned.smartScope ?? defaults.smartScope,
    scopedV2: cleaned.scopedV2 ?? defaults.scopedV2,
    lastLifecycleOpId: cleaned.lastLifecycleOpId ?? defaults.lastLifecycleOpId,
    lastLifecycleGeneration: Number.isInteger(cleaned.lastLifecycleGeneration)
      ? cleaned.lastLifecycleGeneration
      : defaults.lastLifecycleGeneration,
  };
}

function getSmartScopeTokenKey(tabId, modeId) {
  return `smartscope_token_${tabId}_${modeId}`;
}

export class StateManager {
  async getState(tabId, modeId) {
    if (!isValidTabId(tabId)) {
      return getDefaultState();
    }

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    const modeState = tabState?.[tabId]?.[modeId];

    if (!modeState) {
      return getDefaultState();
    }

    return normalizeTabState(modeState);
  }

  async getModePrefs(modeId) {
    if (!isValidModeId(modeId)) {
      return null;
    }

    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    const normalized = normalizeModePrefs(prefs.modePrefs);

    return normalized[modeId] || { ...MODE_PREFS_DEFAULTS[modeId] };
  }

  async updateModePrefs(modeId, updates = {}) {
    if (!isValidModeId(modeId)) {
      return null;
    }

    let nextModePrefs = null;
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
      const prefs = storedPrefs && typeof storedPrefs === 'object' && !Array.isArray(storedPrefs) ? storedPrefs : {};
      const normalized = normalizeModePrefs(prefs.modePrefs);
      const current = normalized[modeId] || { ...MODE_PREFS_DEFAULTS[modeId] };
      nextModePrefs = { ...current };

      if (updates && typeof updates === 'object' && !Array.isArray(updates)) {
        for (const key of Object.keys(current)) {
          if (typeof updates[key] === 'boolean') {
            nextModePrefs[key] = updates[key];
          }
        }
      }

      return {
        ...prefs,
        modePrefs: {
          ...normalized,
          [modeId]: nextModePrefs,
        },
      };
    });

    return nextModePrefs;
  }

  async setState(tabId, modeId, state) {
    if (!isValidTabId(tabId)) {
      return;
    }

    if (!isValidState(state)) {
      console.warn('[StateManager] Invalid state provided to setState:', state);
      return;
    }

    await mutateSessionValue(STORAGE_KEYS.TAB_STATE, (storedTabState) => {
      const tabState = storedTabState && typeof storedTabState === 'object' && !Array.isArray(storedTabState)
        ? { ...storedTabState }
        : {};
      const existingModeState = normalizeTabState(tabState?.[tabId]?.[modeId] || getDefaultState());
      const updatedModeState = normalizeTabState({ ...existingModeState, state });
      tabState[tabId] = { ...(tabState[tabId] || {}), [modeId]: updatedModeState };
      return tabState;
    });
  }

  async updateTabModeState(tabId, modeId, updates) {
    if (!isValidTabId(tabId)) {
      return;
    }

    if (updates && Object.prototype.hasOwnProperty.call(updates, 'state') && !isValidState(updates.state)) {
      console.warn('[StateManager] Invalid state provided to updateTabModeState:', updates.state);
      return;
    }

    await mutateSessionValue(STORAGE_KEYS.TAB_STATE, (storedTabState) => {
      const tabState = storedTabState && typeof storedTabState === 'object' && !Array.isArray(storedTabState)
        ? { ...storedTabState }
        : {};
      const existingModeState = normalizeTabState(tabState?.[tabId]?.[modeId] || getDefaultState());
      const cleanedUpdates = pickAllowedTabStateFields(updates);

      if (Object.prototype.hasOwnProperty.call(cleanedUpdates, 'smartScope')) {
        delete cleanedUpdates.smartScope;
      }

      let mergedSmartScope = existingModeState.smartScope;
      if (updates && Object.prototype.hasOwnProperty.call(updates, 'smartScope')) {
        if (updates.smartScope === null) {
          mergedSmartScope = null;
        } else if (updates.smartScope && typeof updates.smartScope === 'object' && !Array.isArray(updates.smartScope)) {
          mergedSmartScope = { ...(existingModeState.smartScope || {}), ...(updates.smartScope || {}) };
        }
      }

      const updatedModeState = normalizeTabState({
        ...existingModeState,
        ...cleanedUpdates,
        smartScope: mergedSmartScope,
      });
      tabState[tabId] = { ...(tabState[tabId] || {}), [modeId]: updatedModeState };
      return tabState;
    });
  }

  async clearTab(tabId) {
    if (!isValidTabId(tabId)) {
      return;
    }

    await mutateSessionValue(STORAGE_KEYS.TAB_STATE, (storedTabState) => {
      const tabState = storedTabState && typeof storedTabState === 'object' && !Array.isArray(storedTabState)
        ? { ...storedTabState }
        : {};
      delete tabState[tabId];
      return tabState;
    });

    await mutateSessionValue(STORAGE_KEYS.SMARTSCOPE_STATUS, (storedStatus) => {
      const smartScopeStatus = storedStatus && typeof storedStatus === 'object' && !Array.isArray(storedStatus)
        ? { ...storedStatus }
        : {};
      delete smartScopeStatus[tabId];
      return smartScopeStatus;
    });
  }

  async getAllPendingDecisions() {
    const read = await readSessionValueResult(STORAGE_KEYS.TAB_STATE);
    if (!read.ok) {
      throw new Error(read.error?.message || 'TAB_STATE_STORAGE_UNAVAILABLE');
    }
    const tabState = read.status === 'found' && read.value && typeof read.value === 'object'
      ? read.value
      : {};
    const pending = [];

    for (const [tabId, modes] of Object.entries(tabState)) {
      for (const [modeId, modeState] of Object.entries(modes)) {
        if (modeState?.pendingDecision === true) {
          const parsedTabId = Number.parseInt(tabId, 10);
          if (!Number.isNaN(parsedTabId)) {
            pending.push({ tabId: parsedTabId, modeId });
          }
        }
      }
    }

    return pending;
  }

  // Compatibility helpers (non-authoritative API)
  async getTabState(tabId) {
    if (!isValidTabId(tabId)) {
      return null;
    }

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    return tabState[tabId] || null;
  }

  async getModeState(tabId, modeId) {
    const read = await readSessionValueResult(STORAGE_KEYS.TAB_STATE);
    if (!read.ok) {
      throw new Error(read.error?.message || 'TAB_STATE_STORAGE_UNAVAILABLE');
    }
    const tabState = read.status === 'found' && read.value && typeof read.value === 'object'
      ? read.value
      : {};
    const modeState = tabState?.[tabId]?.[modeId];
    return normalizeTabState(modeState ?? getDefaultState());
  }

  async updateModeState(tabId, modeId, newState, metadata = {}) {
    if (!isValidState(newState)) {
      console.warn('[StateManager] Invalid state provided to updateModeState:', newState);
      return;
    }

    await this.updateTabModeState(tabId, modeId, {
      ...metadata,
      state: newState,
    });
  }

  async getSmartScope(tabId, modeId) {
    const modeState = await this.getModeState(tabId, modeId);
    return modeState ? modeState.smartScope ?? null : null;
  }

  async setSmartScope(tabId, modeId, smartScope) {
    if (!isValidTabId(tabId)) {
      return;
    }

    await mutateSessionValue(STORAGE_KEYS.TAB_STATE, (storedTabState) => {
      const tabState = storedTabState && typeof storedTabState === 'object' && !Array.isArray(storedTabState)
        ? { ...storedTabState }
        : {};
      const existingModeState = normalizeTabState(tabState?.[tabId]?.[modeId] || getDefaultState());
      const mergedSmartScope = smartScope
        ? { ...(existingModeState.smartScope || {}), ...smartScope }
        : null;
      const updatedModeState = normalizeTabState({ ...existingModeState, smartScope: mergedSmartScope });
      tabState[tabId] = { ...(tabState[tabId] || {}), [modeId]: updatedModeState };
      return tabState;
    });
  }

  async setSmartScopeToken(tabId, modeId, tokenEntry) {
    if (!isValidTabId(tabId)) {
      return;
    }

    const tokenKey = getSmartScopeTokenKey(tabId, modeId);

    try {
      await setToSession(tokenKey, tokenEntry);
    } catch (error) {
      console.error('[StateManager] Failed to set SmartScope token:', error);
    }
  }

  async getSmartScopeToken(tabId, modeId) {
    if (!isValidTabId(tabId)) {
      return null;
    }

    const tokenKey = getSmartScopeTokenKey(tabId, modeId);

    try {
      const stored = await chrome.storage.session.get(tokenKey);
      return stored?.[tokenKey] || null;
    } catch (error) {
      console.error('[StateManager] Failed to get SmartScope token:', error);
      return null;
    }
  }

  async setSmartScopeStatus(tabId, modeId, status) {
    if (!isValidTabId(tabId)) {
      return;
    }

    await mutateSessionValue(STORAGE_KEYS.SMARTSCOPE_STATUS, (storedStatus) => {
      const existing = storedStatus && typeof storedStatus === 'object' && !Array.isArray(storedStatus)
        ? { ...storedStatus }
        : {};
      existing[tabId] = { ...(existing[tabId] || {}), [modeId]: status };
      return existing;
    });
  }

  async getSmartScopeStatus(tabId, modeId) {
    if (!isValidTabId(tabId)) {
      return null;
    }

    const existing = (await getFromSession(STORAGE_KEYS.SMARTSCOPE_STATUS)) || {};
    return existing?.[tabId]?.[modeId] || null;
  }

  async removeSmartScopeToken(tabId, modeId) {
    if (!isValidTabId(tabId)) {
      return;
    }

    const tokenKey = getSmartScopeTokenKey(tabId, modeId);

    try {
      await removeSessionValue(tokenKey);
    } catch (error) {
      console.error('[StateManager] Failed to remove SmartScope token:', error);
    }
  }

  async getTabsWithActiveMode(modeId) {
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    const activeTabs = [];

    for (const [tabId, modes] of Object.entries(tabState)) {
      if (modes?.[modeId]?.state === STATES.ACTIVE) {
        const parsedTabId = Number.parseInt(tabId, 10);
        if (!Number.isNaN(parsedTabId)) {
          activeTabs.push(parsedTabId);
        }
      }
    }

    return activeTabs;
  }

  async isModeActive(tabId, modeId) {
    const modeState = await this.getModeState(tabId, modeId);
    return modeState?.state === STATES.ACTIVE;
  }

  async isModeBlocked(tabId, modeId) {
    const modeState = await this.getModeState(tabId, modeId);
    return modeState?.state === STATES.BLOCKED;
  }
}

export const stateManager = new StateManager();
export default stateManager;
