import { ACTIONS, MODE_IDS, STATES, STORAGE_KEYS, THRESHOLDS } from '../shared/constants.js';
import { extractDomain, getFromLocal, getFromSession, mutateSessionValue } from '../shared/utils.js';
import { stateManager } from './state-manager.js';
import { badgeManager } from './badge-manager.js';
import { decisionHandler } from './decision-handler.js';
import { cssApplier } from './css-applier.js';
import { learningEngine } from './learning-engine.js';
import AutoApplyManager from './auto-apply-manager.js';
import { telemetry } from './telemetry.js';
import { DECISION_KINDS } from '../shared/types/policy.js';
import { evaluatePolicyDecision, logDecisionTrace } from './policy-engine.js';
import { signalBroker } from './signals/signal-broker.js';
import { PROFILE_ACTIONS, resolveSiteProfileForUrl } from '../shared/site-profiles.js';
import { readSiteProfilesResult } from './site-profile-store.js';
import { recordDecisionEvent } from './debug-snapshot.js';
import { buildLivePersonalizationGate } from './live-personalization-gate.js';

export class Scorer {
  constructor(stateManagerInstance, badgeManagerInstance, autoApplyManagerInstance) {
    this.stateManager = stateManagerInstance;
    this.badgeManager = badgeManagerInstance;
    this.autoApplyManager = autoApplyManagerInstance;
  }

  async getUserPrefs() {
    const prefs = await getFromLocal(STORAGE_KEYS.USER_PREFS);
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
      return {};
    }
    return prefs;
  }

  async getActiveSignals(tabId) {
    const data = (await getFromSession(STORAGE_KEYS.ACTIVE_SIGNALS)) || {};
    return data[tabId] || {};
  }

  async saveActiveSignals(tabId, signals) {
    await mutateSessionValue(STORAGE_KEYS.ACTIVE_SIGNALS, (storedSignals) => ({
      ...(storedSignals && typeof storedSignals === 'object' ? storedSignals : {}),
      [tabId]: signals,
    }));
  }

  async handleSignal(tabId, signalType, value, { snapshot } = {}) {
    if (typeof tabId !== 'number' || !signalType) {
      console.warn('[Scorer] Invalid signal payload', { tabId, signalType });
      return;
    }

    console.log(`[Scorer] Signal received: ${signalType} on tab ${tabId}`);

    const signals = await this.getActiveSignals(tabId);
    signals[signalType] = { value, timestamp: Date.now() };
    await this.saveActiveSignals(tabId, signals);

    let siteKey = 'unknown';
    let url = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';
      url = tab?.url || '';
    } catch (error) {
      console.warn('[Scorer] Unable to resolve site key for tab', tabId, error);
    }
    const userPrefs = await this.getUserPrefs();
    const siteProfileRead = await readSiteProfilesResult();
    if (!siteProfileRead.ok) {
      console.warn('[Scorer] Site profile storage unavailable; skipping suggestion and auto-apply', { tabId });
      return;
    }
    const siteProfiles = siteProfileRead.profiles;
    const resolvedSnapshot = snapshot || (await signalBroker.getSnapshot(tabId));

    for (const modeId of Object.values(MODE_IDS)) {
      const profileEntry = resolveSiteProfileForUrl({ url, modeId, profiles: siteProfiles });
      const profileAction = profileEntry?.action || null;
      const [allowlistRead, denylistRead, cooldownRead] = await Promise.all([
        decisionHandler.readAllowlistStatus(siteKey),
        decisionHandler.readDenylistStatus(siteKey),
        decisionHandler.readCooldownStatus(siteKey, modeId),
      ]);
      if (!allowlistRead.ok || !denylistRead.ok || !cooldownRead.ok) {
        console.warn('[Scorer] Sensitive storage unavailable; skipping suggestion and auto-apply', {
          tabId,
          modeId,
        });
        continue;
      }
      const allowlisted = profileAction === PROFILE_ACTIONS.ALWAYS
        ? true
        : allowlistRead.allowlisted;
      const denylisted = profileAction === PROFILE_ACTIONS.NEVER
        ? true
        : denylistRead.denylisted;
      const currentState = await this.stateManager.getState(tabId, modeId);
      const cooldownActive = cooldownRead.active;
      const policyDecision = await evaluatePolicyDecision({
        tabId,
        modeId,
        snapshot: resolvedSnapshot,
        currentState,
        userPrefs,
        allowlisted,
        denylisted,
        cooldownActive,
        now: Date.now(),
      });

      await recordDecisionEvent(tabId, policyDecision);
      await this.stateManager.updateTabModeState(tabId, modeId, { lastScore: policyDecision.score });
      logDecisionTrace(policyDecision);

      const autoThreshold = getAutoThreshold(userPrefs, modeId);

      if (policyDecision.kind === DECISION_KINDS.APPLY) {
        const autoApplied = await this.autoApplyManager.evaluateAutoApply(tabId, modeId, policyDecision.score, {
          autoThreshold,
        });
        if (autoApplied) {
          continue;
        }
      }
      if (policyDecision.kind === DECISION_KINDS.SUGGEST) {
        await this.triggerSuggestion(tabId, modeId, policyDecision.score, siteKey);
      }
    }
  }

  async triggerSuggestion(tabId, modeId, score, siteKey = 'unknown') {
    const currentState = await this.stateManager.getState(tabId, modeId);
    if (currentState.state === STATES.BLOCKED || currentState.state === STATES.ACTIVE) {
      return;
    }

    const tabState = await this.stateManager.getTabState(tabId);
    const hasActiveMode = Object.values(tabState || {}).some((modeState) => modeState?.state === STATES.ACTIVE);
    if (hasActiveMode) {
      if (currentState.pendingDecision) {
        await this.stateManager.updateTabModeState(tabId, modeId, {
          state: currentState.state === STATES.SUGGESTED ? STATES.INACTIVE : currentState.state,
          pendingDecision: false,
        });
      }
      return;
    }

    console.log(`[Scorer] Triggering suggestion for ${modeId} on tab ${tabId} with score ${score}`);

    await this.stateManager.updateTabModeState(tabId, modeId, {
      state: STATES.SUGGESTED,
      lastScore: score,
      pendingDecision: true,
    });

    await this.badgeManager.refresh();

    await telemetry.trackSuggestionShown(siteKey, modeId, score);

    try {
      await chrome.tabs.sendMessage(tabId, {
        action: ACTIONS.SHOW_BANNER,
        modeId,
        score,
      }, { frameId: 0 });
    } catch (error) {
      console.error('[Scorer] Failed to send SHOW_BANNER message', error);
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeThreshold(rawValue, fallbackValue) {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return fallbackValue;
  }
  return Math.min(Math.max(rawValue, 0), 1);
}

function getThresholdFromPrefs(userPrefs, modeId, key, fallbackValue) {
  const modePrefs = isPlainObject(userPrefs?.modePrefs) ? userPrefs.modePrefs : null;
  const modeOverrides = modePrefs && isPlainObject(modePrefs[modeId]) ? modePrefs[modeId] : null;
  const overrideValue = modeOverrides ? modeOverrides[key] : undefined;
  const globalValue = userPrefs ? userPrefs[key] : undefined;

  if (typeof overrideValue === 'number') {
    return normalizeThreshold(overrideValue, fallbackValue);
  }

  return normalizeThreshold(globalValue, fallbackValue);
}

function getAutoThreshold(userPrefs, modeId) {
  return getThresholdFromPrefs(userPrefs, modeId, 'autoThreshold', THRESHOLDS.AUTO_APPLY);
}

export const autoApplyManager = new AutoApplyManager(
  stateManager,
  cssApplier,
  badgeManager,
  learningEngine,
  decisionHandler,
  buildLivePersonalizationGate
);

export const scorer = new Scorer(stateManager, badgeManager, autoApplyManager);
export default scorer;
