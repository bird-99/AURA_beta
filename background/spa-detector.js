import { STATES, STORAGE_KEYS } from '../shared/constants.js';
import { getFromLocal, mutateSessionValue } from '../shared/utils.js';
import { stateManager } from './state-manager.js';
import { clearPolicyState } from './policy-engine.js';

export class SpaDetector {
  constructor() {
    this.enabled = false;
    this.handleSpaNavigation = this.onSpaNavigation.bind(this);
    this.handlePermissionAdded = this.onPermissionAdded.bind(this);
    this.handlePermissionRemoved = this.onPermissionRemoved.bind(this);
    this.reapplyHandler = null;
    this.permissionObserversInstalled = false;
  }

  async init() {
    this.ensurePermissionObservers();
    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    const spaDetectionEnabled = prefs.spaDetectionEnabled === true;

    if (!spaDetectionEnabled) {
      this.disable();
      return;
    }

    await this.enable();
  }

  async enable() {
    this.ensurePermissionObservers();
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

  ensurePermissionObservers() {
    if (this.permissionObserversInstalled) return;
    chrome.permissions?.onAdded?.addListener?.(this.handlePermissionAdded);
    chrome.permissions?.onRemoved?.addListener?.(this.handlePermissionRemoved);
    this.permissionObserversInstalled = true;
  }

  async onPermissionAdded(permissions) {
    if (!permissions?.permissions?.includes('webNavigation')) return;
    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    if (prefs.spaDetectionEnabled === true) {
      await this.enable();
    }
  }

  onPermissionRemoved(permissions) {
    if (permissions?.permissions?.includes('webNavigation')) {
      this.disable();
    }
  }

  setReapplyHandler(handler) {
    this.reapplyHandler = typeof handler === 'function' ? handler : null;
  }

  async onSpaNavigation(details) {
    if (!this.enabled) return;
    if (typeof details?.tabId !== 'number') return;
    if (details.frameId !== 0) return;
    const hasPermission = await chrome.permissions.contains({ permissions: ['webNavigation'] });
    if (!hasPermission) {
      this.disable();
      return;
    }

    console.info(`[SPA Detector] SPA navigation detected on tab ${details.tabId}`);
    await this.resetTabSignals(details.tabId);
    await this.reapplyActiveModes(details.tabId, {
      url: typeof details.url === 'string' ? details.url : null,
    });
  }

  async resetTabSignals(tabId) {
    await mutateSessionValue(STORAGE_KEYS.ACTIVE_SIGNALS, (storedSignals) => {
      const activeSignals = storedSignals && typeof storedSignals === 'object' ? { ...storedSignals } : {};
      delete activeSignals[tabId];
      return activeSignals;
    });

    await mutateSessionValue(STORAGE_KEYS.SIGNAL_SNAPSHOTS, (storedSnapshots) => {
      const signalSnapshots = storedSnapshots && typeof storedSnapshots === 'object' ? { ...storedSnapshots } : {};
      delete signalSnapshots[tabId];
      return signalSnapshots;
    });

    await clearPolicyState(tabId);
  }

  async reapplyActiveModes(tabId, navigationContext = null) {
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

      await this.reapplyHandler(tabId, 'spa', navigationContext);
    } catch (error) {
      console.warn('[SPA Detector] Failed to trigger re-apply after SPA navigation', error);
    }
  }
}

export const spaDetector = new SpaDetector();
export default spaDetector;
