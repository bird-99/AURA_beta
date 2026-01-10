import { MODE_IDS, MODE_PREFS_DEFAULTS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import { getFromLocal, getFromSession, setToLocal, setToSession, isValidTabId, isValidState } from '../shared/utils.js';

function getDefaultState() {
  return {
    state: STATES.INACTIVE,
    cssId: null,
    cssHash: null,
    pendingDecision: false,
    lastScore: 0,
    activatedAt: null,
    smartScope: null,
    scopedV2: null,
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
  }

  return normalized;
}

function isValidModeId(modeId) {
  return typeof modeId === 'string' && Object.values(MODE_IDS).includes(modeId);
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
    smartScope: cleaned.smartScope ?? defaults.smartScope,
    scopedV2: cleaned.scopedV2 ?? defaults.scopedV2,
  };
}

function getSmartScopeTokenKey(tabId, modeId) {
  return `smartscope_token_${tabId}_${modeId}`;
}

class StateManager {
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

    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    const normalized = normalizeModePrefs(prefs.modePrefs);
    const current = normalized[modeId] || { ...MODE_PREFS_DEFAULTS[modeId] };
    const nextModePrefs = { ...current };

    if (updates && typeof updates === 'object' && !Array.isArray(updates)) {
      for (const key of Object.keys(current)) {
        if (typeof updates[key] === 'boolean') {
          nextModePrefs[key] = updates[key];
        }
      }
    }

    const nextPrefs = {
      ...prefs,
      modePrefs: {
        ...normalized,
        [modeId]: nextModePrefs,
      },
    };

    await setToLocal(STORAGE_KEYS.USER_PREFS, nextPrefs);

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

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    const existingModeState = normalizeTabState(tabState?.[tabId]?.[modeId] || getDefaultState());

    const updatedModeState = normalizeTabState({
      ...existingModeState,
      state,
    });

    tabState[tabId] = tabState[tabId] || {};
    tabState[tabId][modeId] = updatedModeState;

    await setToSession(STORAGE_KEYS.TAB_STATE, tabState);
  }

  async updateTabModeState(tabId, modeId, updates) {
    if (!isValidTabId(tabId)) {
      return;
    }

    if (updates && Object.prototype.hasOwnProperty.call(updates, 'state') && !isValidState(updates.state)) {
      console.warn('[StateManager] Invalid state provided to updateTabModeState:', updates.state);
      return;
    }

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
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

    tabState[tabId] = tabState[tabId] || {};
    tabState[tabId][modeId] = updatedModeState;

    await setToSession(STORAGE_KEYS.TAB_STATE, tabState);
  }

  async clearTab(tabId) {
    if (!isValidTabId(tabId)) {
      return;
    }

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};

    if (tabState[tabId]) {
      delete tabState[tabId];
      await setToSession(STORAGE_KEYS.TAB_STATE, tabState);
    }

    const smartScopeStatus = (await getFromSession(STORAGE_KEYS.SMARTSCOPE_STATUS)) || {};
    if (smartScopeStatus[tabId]) {
      delete smartScopeStatus[tabId];
      await setToSession(STORAGE_KEYS.SMARTSCOPE_STATUS, smartScopeStatus);
    }
  }

  async getAllPendingDecisions() {
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
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
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
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

    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    const existingModeState = normalizeTabState(tabState?.[tabId]?.[modeId] || getDefaultState());

    const mergedSmartScope = smartScope
      ? {
          ...(existingModeState.smartScope || {}),
          ...smartScope,
        }
      : null;

    const updatedModeState = normalizeTabState({
      ...existingModeState,
      smartScope: mergedSmartScope,
    });

    tabState[tabId] = tabState[tabId] || {};
    tabState[tabId][modeId] = updatedModeState;

    await setToSession(STORAGE_KEYS.TAB_STATE, tabState);
  }

  async setSmartScopeToken(tabId, modeId, tokenEntry) {
    if (!isValidTabId(tabId)) {
      return;
    }

    const tokenKey = getSmartScopeTokenKey(tabId, modeId);

    try {
      await chrome.storage.session.set({ [tokenKey]: tokenEntry });
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

    const existing = (await getFromSession(STORAGE_KEYS.SMARTSCOPE_STATUS)) || {};
    const perTab = existing[tabId] || {};
    perTab[modeId] = status;
    existing[tabId] = perTab;
    await setToSession(STORAGE_KEYS.SMARTSCOPE_STATUS, existing);
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
      await chrome.storage.session.remove(tokenKey);
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
