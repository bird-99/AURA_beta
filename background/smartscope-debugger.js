import { mutateLocalValue, removeLocalValue } from '../shared/utils.js';

/**
 * @typedef {'PROFILE' | 'APPLY' | 'REMOVE' | 'FALLBACK' | 'ERROR'} SmartScopeDebugAction
 *
 * @typedef {Object} SmartScopeDebugEntry
 * @property {number} timestamp
 * @property {string} siteKey
 * @property {number} [tabId]
 * @property {string} modeId
 * @property {SmartScopeDebugAction} action
 * @property {Object} [profile]
 * @property {boolean} profile.isDocumentLike
 * @property {string} profile.chosenScope
 * @property {string} profile.scopeReason
 * @property {number} profile.textDensity
 * @property {number} profile.linkDensity
 * @property {number} profile.processingTimeMs
 * @property {Object} [application]
 * @property {string} application.variant
 * @property {string} application.cssId
 * @property {string} application.domClassToken
 * @property {number} application.classesApplied
 * @property {number} application.elementsHidden
 * @property {boolean} application.verificationPassed
 * @property {Object} [fallback]
 * @property {string} fallback.fromVariant
 * @property {string|null} fallback.toVariant
 * @property {string} fallback.reason
 * @property {Object} [error]
 * @property {string} error.code
 * @property {string} error.message
 * @property {string} [error.stack]
 * @property {string} [context]
 */

export class SmartScopeDebugger {
  constructor(opts = {}) {
    this.enabled = false;
    this.maxLogs = Number.isFinite(opts.maxLogs) && opts.maxLogs > 0 ? opts.maxLogs : 100;
    this.storageKey = 'smartScopeDebugLogs';
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
  }

  async log(entry) {
    if (!this.enabled || !entry) {
      return;
    }

    try {
      await mutateLocalValue(this.storageKey, (storedLogs) => {
        const logs = Array.isArray(storedLogs) ? storedLogs : [];
        return [...logs, { ...entry, timestamp: Date.now() }].slice(-this.maxLogs);
      });
    } catch (error) {
      console.warn('[SmartScopeDebugger] Failed to log entry', error);
    }
  }

  async getLogs() {
    try {
      const existing = await chrome.storage.local.get(this.storageKey);
      return Array.isArray(existing?.[this.storageKey]) ? existing[this.storageKey] : [];
    } catch (error) {
      console.warn('[SmartScopeDebugger] Failed to read logs', error);
      return [];
    }
  }

  async exportLogs() {
    const logs = await this.getLogs();
    try {
      return JSON.stringify(logs, null, 2);
    } catch (error) {
      console.warn('[SmartScopeDebugger] Failed to serialize logs', error);
      return '[]';
    }
  }

  async clearLogs() {
    try {
      await removeLocalValue(this.storageKey);
    } catch (error) {
      console.warn('[SmartScopeDebugger] Failed to clear logs', error);
    }
  }
}

export const smartScopeDebugger = new SmartScopeDebugger();
