import {
  ACTIONS,
  LEARNING_STAGES,
  MODE_IDS,
  STATES,
  STORAGE_KEYS,
  THRESHOLDS
} from '../shared/constants.js';
import { extractDomain, getFromLocal } from '../shared/utils.js';
import { computeSitePolicy } from './site-policy-manager.js';
import { ensureExclusiveModeActive } from './mode-exclusivity-manager.js';

export class AutoApplyManager {
  constructor(stateManager, cssApplier, badgeManager, learningEngine, decisionHandler) {
    this.stateManager = stateManager;
    this.cssApplier = cssApplier;
    this.badgeManager = badgeManager;
    this.learningEngine = learningEngine;
    this.decisionHandler = decisionHandler;
  }

  async isFocusDefaultEnabled() {
    const prefs = await getFromLocal(STORAGE_KEYS.USER_PREFS);
    if (!prefs || typeof prefs !== 'object') {
      return true;
    }
    return prefs.focusDefaultEnabled !== false;
  }

  async evaluateFocusDefault(tabId, urlOverride) {
    const focusDefaultEnabled = await this.isFocusDefaultEnabled();
    if (!focusDefaultEnabled) {
      return false;
    }

    let siteKey = 'unknown';
    let url = urlOverride;
    try {
      if (!url) {
        const tab = await chrome.tabs.get(tabId);
        url = tab?.url || '';
      }
      siteKey = url ? extractDomain(url) : 'unknown';
      const policy = await computeSitePolicy({ url: url || '', now: Date.now() });
      if (!policy.allowed) {
        return false;
      }
    } catch (error) {
      console.warn('[AutoApplyManager] Unable to resolve site key for focus default', tabId, error);
      return false;
    }

    const denylisted = await this.decisionHandler.isDenylisted(siteKey);
    if (denylisted) {
      return false;
    }

    const inCooldown = await this.decisionHandler.isInCooldown(siteKey, MODE_IDS.FOCUS);
    if (inCooldown) {
      return false;
    }

    const focusState = await this.stateManager.getModeState(tabId, MODE_IDS.FOCUS);
    if (!focusState || focusState.state !== STATES.INACTIVE) {
      return false;
    }

    const comfortState = await this.stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
    if (comfortState?.state === STATES.ACTIVE) {
      return false;
    }

    await this.autoApplyMode(tabId, MODE_IDS.FOCUS, siteKey, 'focus-default');
    return true;
  }

  async evaluateAutoApply(tabId, modeId, score) {
    if (typeof score !== 'number' || score < THRESHOLDS.AUTO_APPLY) {
      return false;
    }

    let siteKey = 'unknown';
    try {
      const tab = await chrome.tabs.get(tabId);
      siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';
      const policy = await computeSitePolicy({ url: tab?.url || '', now: Date.now() });
      if (!policy.allowed) {
        await this.stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'apply',
          ok: false,
          error: 'SITE_BLOCKED',
          detail: policy.reason || 'POLICY_BLOCKED',
          blockedUntil: policy.blockedUntil ?? null,
          timestamp: Date.now(),
        });
        return false;
      }
    } catch (error) {
      console.warn('[AutoApplyManager] Unable to resolve site key for tab', tabId, error);
      return false;
    }

    const learning = await this.learningEngine.getLearningState(modeId, siteKey);
    if (learning.stage !== LEARNING_STAGES.AUTO) {
      return false;
    }

    if (typeof learning.weight !== 'number' || learning.weight < THRESHOLDS.AUTO_APPLY) {
      return false;
    }

    if (learning.lastDecision === 'NEVER') {
      return false;
    }

    const denylisted = await this.decisionHandler.isDenylisted(siteKey);
    if (denylisted) {
      return false;
    }

    const inCooldown = await this.decisionHandler.isInCooldown(siteKey, modeId);
    if (inCooldown) {
      return false;
    }

    const modeState = (await this.stateManager.getModeState(tabId, modeId)) || { state: STATES.INACTIVE };
    if (modeState.state === STATES.BLOCKED || modeState.state === STATES.DEGRADED || modeState.state === STATES.ERROR) {
      return false;
    }

    if (!modeState || modeState.state !== STATES.INACTIVE) {
      return false;
    }

    await this.autoApplyMode(tabId, modeId, siteKey);
    return true;
  }

  async autoApplyMode(tabId, modeId, siteKey, source = 'auto') {
    await ensureExclusiveModeActive(tabId, modeId, { siteKey, reason: source });

    const applied = await this.cssApplier.applyMode(tabId, modeId, undefined, source);
    if (!applied || applied.ok === false) {
      console.warn('[AutoApplyManager] CSS application failed, skipping state update');
      return;
    }

    await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
      activatedAt: Date.now(),
      pendingDecision: false,
    });

    try {
      await chrome.tabs.sendMessage(tabId, { action: ACTIONS.INJECT_RESTORE_BUTTON, modeId });
    } catch (error) {
      console.error('[AutoApplyManager] Failed to inject restore button', error);
    }

    await this.badgeManager.refresh();
  }
}

export default AutoApplyManager;
