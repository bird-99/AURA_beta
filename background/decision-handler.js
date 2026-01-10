import {
  ACTIONS,
  COOLDOWN_DURATIONS,
  DECISION_ALIASES,
  DECISIONS,
  STATES,
  STORAGE_KEYS
} from '../shared/constants.js';
import { getFromLocal, setToLocal } from '../shared/utils.js';
import { badgeManager } from './badge-manager.js';
import { cssApplier } from './css-applier.js';
import { learningEngine } from './learning-engine.js';
import { stateManager } from './state-manager.js';
import { telemetry } from './telemetry.js';
import { computeSitePolicy } from './site-policy-manager.js';
import { ensureExclusiveModeActive } from './mode-exclusivity-manager.js';

export function normalizeDecision(decision) {
  if (typeof decision !== 'string') {
    return null;
  }

  if (Object.values(DECISIONS).includes(decision)) {
    return decision;
  }

  if (decision in DECISION_ALIASES) {
    return DECISION_ALIASES[decision];
  }

  return null;
}

class DecisionHandler {
  async getPerDomainPrefs() {
    return (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  }

  async getCooldowns() {
    return (await getFromLocal(STORAGE_KEYS.COOLDOWNS)) || {};
  }

  async getDenylist() {
    return (await getFromLocal(STORAGE_KEYS.DENYLIST)) || [];
  }

  async isDenylisted(siteKey) {
    const denylist = await this.getDenylist();
    return denylist.includes(siteKey);
  }

  async addToDenylist(siteKey) {
    const denylist = await this.getDenylist();

    if (!denylist.includes(siteKey)) {
      denylist.push(siteKey);
      await setToLocal(STORAGE_KEYS.DENYLIST, denylist);
    }
  }

  async getCooldownUntil(siteKey, modeId) {
    const cooldowns = await this.getCooldowns();
    return cooldowns?.[siteKey]?.[modeId]?.until || null;
  }

  async isInCooldown(siteKey, modeId) {
    const until = await this.getCooldownUntil(siteKey, modeId);
    return typeof until === 'number' && until > Date.now();
  }

  async setCooldown(siteKey, modeId) {
    const cooldowns = await this.getCooldowns();
    const siteCooldown = cooldowns[siteKey] || {};

    siteCooldown[modeId] = {
      until: Date.now() + COOLDOWN_DURATIONS.NOT_NOW
    };

    cooldowns[siteKey] = siteCooldown;
    await setToLocal(STORAGE_KEYS.COOLDOWNS, cooldowns);
  }

  async addCooldown(siteKey, modeId, reason = 'degraded', durationMs = COOLDOWN_DURATIONS.DEGRADED) {
    const cooldowns = await this.getCooldowns();
    const siteCooldown = cooldowns[siteKey] || {};

    siteCooldown[modeId] = {
      until: Date.now() + durationMs,
      reason
    };

    cooldowns[siteKey] = siteCooldown;
    await setToLocal(STORAGE_KEYS.COOLDOWNS, cooldowns);
  }

  async clearCooldown(siteKey, modeId) {
    const cooldowns = await this.getCooldowns();

    if (cooldowns?.[siteKey]?.[modeId]) {
      delete cooldowns[siteKey][modeId];
      if (Object.keys(cooldowns[siteKey]).length === 0) {
        delete cooldowns[siteKey];
      }
      await setToLocal(STORAGE_KEYS.COOLDOWNS, cooldowns);
    }
  }

  async handleDecision(tabId, modeId, decision, { siteKey = 'unknown' } = {}) {
    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      console.debug('[DecisionHandler] Unknown decision ignored', decision);
      return { ok: false, error: 'Invalid decision' };
    }

    await this.recordDecision(siteKey, modeId, normalizedDecision);
    await telemetry.trackDecision(modeId, siteKey, normalizedDecision);

    if (normalizedDecision === DECISIONS.ENABLED) {
      let policy = { allowed: false, reason: 'TAB_LOOKUP_FAILED', blockedUntil: null };
      try {
        const tab = await chrome.tabs.get(tabId);
        policy = await computeSitePolicy({ url: tab?.url || '', now: Date.now() });
      } catch (error) {
        console.warn('[DecisionHandler] Unable to resolve tab for policy', tabId, error);
      }

      if (!policy.allowed) {
        await stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'apply',
          ok: false,
          error: 'SITE_BLOCKED',
          detail: policy.reason || 'POLICY_BLOCKED',
          blockedUntil: policy.blockedUntil ?? null,
          timestamp: Date.now(),
        });
        await stateManager.updateTabModeState(tabId, modeId, {
          state: STATES.INACTIVE,
          pendingDecision: false,
        });
        await badgeManager.refresh();
        return {
          ok: false,
          error: 'SITE_BLOCKED',
          detail: policy.reason || 'POLICY_BLOCKED',
          blockedUntil: policy.blockedUntil ?? null,
        };
      }

      await ensureExclusiveModeActive(tabId, modeId, { siteKey, reason: 'popup' });

      const applied = await cssApplier.applyMode(tabId, modeId, undefined, 'popup');

      if (!applied || applied.ok === false) {
        if (applied?.error === 'SITE_BLOCKED') {
          await stateManager.updateTabModeState(tabId, modeId, {
            state: STATES.INACTIVE,
            pendingDecision: false,
          });

          await badgeManager.refresh();
          return {
            ok: false,
            error: 'SITE_BLOCKED',
            detail: applied?.detail || applied?.reason || null,
            blockedUntil: applied?.blockedUntil ?? null,
            attemptId: applied?.attemptId,
          };
        }

        await stateManager.updateTabModeState(tabId, modeId, {
          state: STATES.ERROR,
          pendingDecision: false,
        });

        await badgeManager.refresh();
        return {
          ok: false,
          error: applied?.error || applied?.reason || 'APPLY_FAILED',
          reason: applied?.reason,
          detail: applied?.detail || applied?.details || applied?.reason || null,
          blockedUntil: applied?.blockedUntil ?? null,
          attemptId: applied?.attemptId,
        };
      }

      await stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        activatedAt: Date.now(),
        pendingDecision: false,
      });

      try {
        await chrome.tabs.sendMessage(tabId, { action: ACTIONS.INJECT_RESTORE_BUTTON, modeId });
      } catch (error) {
        console.warn('[DecisionHandler] Failed to inject restore button', error);
      }

      await badgeManager.refresh();
      return { ok: true, state: STATES.ACTIVE, attemptId: applied?.attemptId };
    }

    if (normalizedDecision === DECISIONS.NEVER) {
      await stateManager.updateModeState(tabId, modeId, STATES.BLOCKED, {
        pendingDecision: false,
      });

      await badgeManager.refresh();
      return { ok: true, state: STATES.BLOCKED };
    }

    await stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
      pendingDecision: false,
    });

    await badgeManager.refresh();
    return { ok: true, state: STATES.INACTIVE };
  }

  async recordDecision(siteKey, modeId, decision, meta = {}) {
    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      console.debug('[DecisionHandler] Unknown decision ignored', decision);
      return;
    }

    const timestamp = Date.now();
    const perDomainPrefs = await this.getPerDomainPrefs();

    perDomainPrefs[siteKey] = perDomainPrefs[siteKey] || {};
    perDomainPrefs[siteKey][modeId] = {
      ...(perDomainPrefs[siteKey][modeId] || {}),
      decision: normalizedDecision,
      timestamp,
      ...meta
    };

    await setToLocal(STORAGE_KEYS.PER_DOMAIN_PREFS, perDomainPrefs);

    if (normalizedDecision === DECISIONS.NOT_NOW) {
      await this.setCooldown(siteKey, modeId);
    } else {
      await this.clearCooldown(siteKey, modeId);
    }

    if (normalizedDecision === DECISIONS.NEVER) {
      await this.addToDenylist(siteKey);
    }

    await learningEngine.applyDecision(siteKey, modeId, normalizedDecision);
  }

  async shouldSuggest(siteKey, modeId) {
    const denylisted = await this.isDenylisted(siteKey);
    if (denylisted) {
      return false;
    }

    const onCooldown = await this.isInCooldown(siteKey, modeId);
    return !onCooldown;
  }
}

export const decisionHandler = new DecisionHandler();
export default decisionHandler;
