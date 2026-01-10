import { ACTIONS, MODE_IDS, SIGNALS, STATES, STORAGE_KEYS, THRESHOLDS } from '../shared/constants.js';
import { extractDomain, getFromSession, setToSession } from '../shared/utils.js';
import { stateManager } from './state-manager.js';
import { badgeManager } from './badge-manager.js';
import { decisionHandler } from './decision-handler.js';
import { cssApplier } from './css-applier.js';
import { learningEngine } from './learning-engine.js';
import AutoApplyManager from './auto-apply-manager.js';
import { telemetry } from './telemetry.js';

export class Scorer {
  constructor(stateManagerInstance, badgeManagerInstance, autoApplyManagerInstance) {
    this.stateManager = stateManagerInstance;
    this.badgeManager = badgeManagerInstance;
    this.autoApplyManager = autoApplyManagerInstance;
    this.weights = {
      [MODE_IDS.COMFORT_VISUAL]: {
        [SIGNALS.ZOOM]: 0.4,
        [SIGNALS.COLOR_SCHEME]: 0.3,
        [SIGNALS.READING_BEHAVIOR]: 0.3,
      },
      [MODE_IDS.FOCUS]: {
        [SIGNALS.READING_BEHAVIOR]: 0.5,
        [SIGNALS.ZOOM]: 0.1,
        [SIGNALS.COLOR_SCHEME]: 0.2,
      },
    };
  }

  async getActiveSignals(tabId) {
    const data = (await getFromSession(STORAGE_KEYS.ACTIVE_SIGNALS)) || {};
    return data[tabId] || {};
  }

  async saveActiveSignals(tabId, signals) {
    const data = (await getFromSession(STORAGE_KEYS.ACTIVE_SIGNALS)) || {};
    data[tabId] = signals;
    await setToSession(STORAGE_KEYS.ACTIVE_SIGNALS, data);
  }

  async handleSignal(tabId, signalType, value) {
    if (typeof tabId !== 'number' || !signalType) {
      console.warn('[Scorer] Invalid signal payload', { tabId, signalType });
      return;
    }

    console.log(`[Scorer] Signal received: ${signalType} on tab ${tabId}`);

    const signals = await this.getActiveSignals(tabId);
    signals[signalType] = { value, timestamp: Date.now() };
    await this.saveActiveSignals(tabId, signals);

    for (const modeId of Object.values(MODE_IDS)) {
      const score = await this.calculateScore(tabId, modeId);
      await this.stateManager.updateTabModeState(tabId, modeId, { lastScore: score });
      if (score >= THRESHOLDS.AUTO_APPLY) {
        const autoApplied = await this.autoApplyManager.evaluateAutoApply(tabId, modeId, score);
        if (autoApplied) {
          continue;
        }
      }
      if (score >= THRESHOLDS.SUGGESTION) {
        await this.triggerSuggestion(tabId, modeId, score);
      }
    }
  }

  async calculateScore(tabId, modeId) {
    const signals = await this.getActiveSignals(tabId);
    const weights = this.weights[modeId] || {};

    let score = 0;

    const rawZoom = signals[SIGNALS.ZOOM]?.value ?? signals[SIGNALS.ZOOM];
    const zoomValue = typeof rawZoom === 'number' ? Math.min(1, rawZoom) : rawZoom ? 1 : 0;
    const rawColorScheme = signals[SIGNALS.COLOR_SCHEME]?.value ?? signals[SIGNALS.COLOR_SCHEME];
    const colorValue = rawColorScheme === 'dark' ? 1 : 0;
    const hasReadingSignal = signals[SIGNALS.READING_BEHAVIOR] !== undefined;
    const readingValue = hasReadingSignal ? 1 : 0;

    for (const [signal, weight] of Object.entries(weights)) {
      let contribution = 0;

      if (signal === SIGNALS.ZOOM && zoomValue) {
        contribution = zoomValue * weight;
      } else if (signal === SIGNALS.COLOR_SCHEME) {
        contribution = colorValue * weight;
      } else if (signal === SIGNALS.READING_BEHAVIOR) {
        contribution = readingValue * weight;
      }

      score += contribution;
    }

    return Math.min(1, score);
  }

  async triggerSuggestion(tabId, modeId, score) {
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

    let siteKey = 'unknown';
    try {
      const tab = await chrome.tabs.get(tabId);
      siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';
    } catch (error) {
      console.warn('[Scorer] Unable to resolve site key for tab', tabId, error);
    }

    const allowed = await decisionHandler.shouldSuggest(siteKey, modeId);
    if (!allowed) {
      console.log('[Scorer] Suggestion suppressed due to denylist/cooldown', { siteKey, modeId });
      return;
    }

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
      });
    } catch (error) {
      console.error('[Scorer] Failed to send SHOW_BANNER message', error);
    }
  }
}

export const autoApplyManager = new AutoApplyManager(
  stateManager,
  cssApplier,
  badgeManager,
  learningEngine,
  decisionHandler
);

export const scorer = new Scorer(stateManager, badgeManager, autoApplyManager);
export default scorer;
