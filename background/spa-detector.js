import { STATES, STORAGE_KEYS } from '../shared/constants.js';
import { getFromLocal, getFromSession, setToSession } from '../shared/utils.js';
import { stateManager } from './state-manager.js';

class SpaDetector {
  constructor() {
    this.enabled = false;
    this.handleSpaNavigation = this.onSpaNavigation.bind(this);
    this.reapplyHandler = null;
  }

  async init() {
    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    const spaDetectionEnabled = prefs.spaDetectionEnabled === true;

    if (!spaDetectionEnabled) {
      this.disable();
      return;
    }

    await this.enable();
  }

  async enable() {
    const hasPermission = await chrome.permissions.contains({ permissions: ['webNavigation'] });
    if (!hasPermission) {
      console.warn('[SPA Detector] webNavigation permission not granted; skipping SPA detection.');
      this.disable();
      return;
    }

    if (!this.enabled) {
      if (!chrome.webNavigation.onHistoryStateUpdated.hasListener(this.handleSpaNavigation)) {
        chrome.webNavigation.onHistoryStateUpdated.addListener(this.handleSpaNavigation);
      }

      this.enabled = true;
      console.log('[SPA Detector] Enabled');
    }
  }

  disable() {
    if (chrome.webNavigation?.onHistoryStateUpdated.hasListener(this.handleSpaNavigation)) {
      chrome.webNavigation.onHistoryStateUpdated.removeListener(this.handleSpaNavigation);
    }

    this.enabled = false;
  }

  setReapplyHandler(handler) {
    this.reapplyHandler = typeof handler === 'function' ? handler : null;
  }

  async onSpaNavigation(details) {
    if (!this.enabled) return;
    if (typeof details?.tabId !== 'number') return;
    if (details.frameId !== 0) return;

    console.info(`[SPA Detector] SPA navigation detected on tab ${details.tabId}`);
    await this.resetTabSignals(details.tabId);
    await this.reapplyActiveModes(details.tabId);
  }

  async resetTabSignals(tabId) {
    const activeSignals = (await getFromSession(STORAGE_KEYS.ACTIVE_SIGNALS)) || {};
    if (tabId in activeSignals) {
      delete activeSignals[tabId];
      await setToSession(STORAGE_KEYS.ACTIVE_SIGNALS, activeSignals);
    }
  }

  async reapplyActiveModes(tabId) {
    try {
      const modes = await stateManager.getTabState(tabId);
      if (!modes) {
        return;
      }

      const hasActiveMode = Object.values(modes).some((modeState) => modeState?.state === STATES.ACTIVE);
      if (!hasActiveMode) {
        return;
      }

      if (!this.reapplyHandler) {
        console.warn('[SPA Detector] Reapply handler missing; skipping reapply');
        return;
      }

      await this.reapplyHandler(tabId, 'spa');
    } catch (error) {
      console.warn('[SPA Detector] Failed to trigger re-apply after SPA navigation', error);
    }
  }
}

export const spaDetector = new SpaDetector();
export default spaDetector;
