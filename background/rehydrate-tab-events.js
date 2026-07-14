import { MODE_IDS } from '../shared/constants.js';

/**
 * @typedef {object} TabRehydrateDependencies
 * @property {{ applyPreludeCss?: (tabId: number, reason: string) => Promise<unknown> }} [cssApplier]
 * @property {{ getTabState: (tabId: number) => Promise<object | null>, isModeActive: (tabId: number, modeId: string) => Promise<boolean>, isModeBlocked: (tabId: number, modeId: string) => Promise<boolean> }} [stateManager]
 * @property {(tabId: number, reason: string, context?: { url?: string }) => Promise<unknown>} [rehydrateActiveModesForTab]
 * @property {(url: string) => boolean} [isUnsupportedScheme]
 * @property {(tabId: unknown) => boolean} [isValidTabId]
 * @property {(context: { tabId: number, url: string, tab?: object }) => Promise<unknown>} [onTabReady]
 * @property {{ ACTIVE?: string }} [states]
 * @property {{ get?: (tabId: number) => Promise<{ url?: string }> }} [tabsApi]
 */

/** @param {TabRehydrateDependencies} [dependencies] */
export function createTabRehydrateHandlers(dependencies = {}) {
  const {
  cssApplier,
  stateManager,
  rehydrateActiveModesForTab,
  isUnsupportedScheme,
  isValidTabId,
  onTabReady,
  states,
  tabsApi,
  } = dependencies;
  function isSupportedUrl(url) {
    if (typeof url !== 'string') {
      return false;
    }

    if (isUnsupportedScheme(url)) {
      return false;
    }

    try {
      const { protocol } = new URL(url);
      return protocol === 'http:' || protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  async function resolveTabUrl(tabId, tab) {
    if (typeof tab?.url === 'string' && tab.url) {
      return tab.url;
    }

    if (!tabsApi?.get) {
      return null;
    }

    try {
      const resolved = await tabsApi.get(tabId);
      return resolved?.url || null;
    } catch (error) {
      return null;
    }
  }

  async function shouldRehydrateTab(tabId) {
    if (!isValidTabId(tabId)) {
      return false;
    }

    const tabState = await stateManager.getTabState(tabId);
    if (!tabState || typeof tabState !== 'object' || Array.isArray(tabState)) {
      return false;
    }

    return Object.values(tabState).some((modeState) => modeState?.state === states.ACTIVE);
  }

  async function handleTabUpdated(tabId, changeInfo, tab) {
    if (!changeInfo?.status) {
      return;
    }

    const url = await resolveTabUrl(tabId, tab);
    if (!isSupportedUrl(url)) {
      return;
    }

    if (changeInfo.status === 'loading') {
      if (!cssApplier?.applyPreludeCss) {
        return;
      }

      const modeId = MODE_IDS.COMFORT_VISUAL;
      const isActive = await stateManager.isModeActive(tabId, modeId);
      if (!isActive) {
        return;
      }

      const isBlocked = await stateManager.isModeBlocked(tabId, modeId);
      if (isBlocked) {
        return;
      }

      await cssApplier.applyPreludeCss(tabId, 'nav-loading');
      return;
    }

    if (changeInfo.status !== 'complete') {
      return;
    }

    if (await shouldRehydrateTab(tabId)) {
      await rehydrateActiveModesForTab(tabId, 'tab-complete', { url });
      return;
    }

    if (typeof onTabReady === 'function') {
      await onTabReady({ tabId, url, tab });
    }
  }

  async function handleTabActivated(activeInfo) {
    const tabId = activeInfo?.tabId;
    if (!isValidTabId(tabId)) {
      return;
    }

    const url = await resolveTabUrl(tabId);
    if (!isSupportedUrl(url)) {
      return;
    }

    if (!(await shouldRehydrateTab(tabId))) {
      return;
    }

    await rehydrateActiveModesForTab(tabId, 'tab-activated');
  }

  return {
    handleTabActivated,
    handleTabUpdated,
    shouldRehydrateTab,
  };
}
