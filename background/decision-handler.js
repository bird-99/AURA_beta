import {
  ACTIONS,
  COOLDOWN_DURATIONS,
  DECISION_ALIASES,
  DECISIONS,
  MODE_IDS,
  STATES,
  STORAGE_KEYS
} from '../shared/constants.js';
import {
  extractDomain,
  getDomainKeyCandidates,
  getFromLocal,
  mutateLocalValue,
  readLocalValueResult,
} from '../shared/utils.js';
import {
  PROFILE_ACTIONS,
  resolveSiteProfileForHost,
  resolveSiteProfileForUrl,
} from '../shared/site-profiles.js';
import { readSiteProfilesResult } from './site-profile-store.js';
import { badgeManager } from './badge-manager.js';
import { cssApplier } from './css-applier.js';
import { learningEngine } from './learning-engine.js';
import { stateManager } from './state-manager.js';
import { telemetry } from './telemetry.js';
import { computeSitePolicy } from './site-policy-manager.js';
import { ensureExclusiveModeActive } from './mode-exclusivity-manager.js';
import {
  ACTION_POLICY_DECISIONS,
  OUTCOME_LEDGER_EVENTS,
} from '../shared/engine-core/enums.js';
import {
  recordAcceptedApplyOutcome,
  recordRejectedApplyOutcome,
  recordUserOutcome,
} from './outcome-ledger.js';
import { buildLiveRuntimeApplyContext } from './live-personalization-gate.js';
import {
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from './template-evidence.js';
import { recordTemplateMemoryNegativeOutcome } from './template-memory.js';

const LEGACY_COMFORT_RUNTIME_CONTEXT_FALLBACK_REASONS = new Set([
  'LIVE_BUDGET_HIT',
  'LIVE_GATE_TIMEOUT',
  'PAGE_SIGNALS_UNAVAILABLE',
  'PAGE_SIGNALS_COLLECT_FAILED',
  'LIVE_RUNTIME_CONTEXT_FAILED',
  'LIVE_RUNTIME_CONTEXT_UNAVAILABLE',
]);

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

function normalizeSiteKey(siteKey) {
  if (typeof siteKey !== 'string' || siteKey.trim() === '') {
    return 'unknown';
  }
  return extractDomain(siteKey);
}

function shouldUseLegacyComfortFallback(modeId, runtimeContextFailure) {
  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return false;
  }

  const reason = runtimeContextFailure?.reason || runtimeContextFailure?.error || null;
  return LEGACY_COMFORT_RUNTIME_CONTEXT_FALLBACK_REASONS.has(reason);
}

function storageReadFailure(result, key) {
  return {
    ok: false,
    status: 'error',
    error: result?.error?.message || `Unable to read ${key}`,
  };
}

async function readSensitiveCollection(key, fallback, validator) {
  const result = await readLocalValueResult(key);
  if (!result.ok) return storageReadFailure(result, key);
  if (result.status === 'missing') return { ok: true, status: 'missing', value: fallback };
  if (!validator(result.value)) {
    return { ok: false, status: 'error', error: `Invalid storage value for ${key}` };
  }
  return { ok: true, status: 'found', value: result.value };
}

class DecisionHandler {
  async getPerDomainPrefs() {
    return (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  }

  async getCooldownDuration() {
    const prefs = await getFromLocal(STORAGE_KEYS.USER_PREFS);
    const duration = prefs?.cooldownDuration;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
    return COOLDOWN_DURATIONS.NOT_NOW;
  }

  async getCooldowns() {
    const result = await this.readCooldowns();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  async getDenylist() {
    const result = await this.readDenylist();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  async getAllowlist() {
    const result = await this.readAllowlist();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  async readCooldowns() {
    return readSensitiveCollection(
      STORAGE_KEYS.COOLDOWNS,
      {},
      (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    );
  }

  async readDenylist() {
    return readSensitiveCollection(STORAGE_KEYS.DENYLIST, [], Array.isArray);
  }

  async readAllowlist() {
    return readSensitiveCollection(STORAGE_KEYS.ALLOWLIST, [], Array.isArray);
  }

  async readDenylistStatus(siteKey) {
    const result = await this.readDenylist();
    if (!result.ok) return result;
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    return {
      ok: true,
      status: result.status,
      denylisted: getDomainKeyCandidates(normalizedSiteKey).some((key) => result.value.includes(key)),
    };
  }

  async readAllowlistStatus(siteKey) {
    const result = await this.readAllowlist();
    if (!result.ok) return result;
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    return {
      ok: true,
      status: result.status,
      allowlisted: getDomainKeyCandidates(normalizedSiteKey).some((key) => result.value.includes(key)),
    };
  }

  async readCooldownStatus(siteKey, modeId, now = Date.now()) {
    const result = await this.readCooldowns();
    if (!result.ok) return result;
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const key = getDomainKeyCandidates(normalizedSiteKey)[0];
    const until = key ? result.value?.[key]?.[modeId]?.until : null;
    return {
      ok: true,
      status: result.status,
      active: typeof until === 'number' && until > now,
      until: typeof until === 'number' ? until : null,
    };
  }

  async getSiteProfiles() {
    const result = await readSiteProfilesResult();
    if (!result.ok) throw new Error(result.error);
    return result.profiles;
  }

  async getProfileAction(siteKey, modeId) {
    const profiles = await this.getSiteProfiles();
    const entry = resolveSiteProfileForHost({ hostname: siteKey, modeId, profiles });
    return entry?.action || null;
  }

  async getProfileEntryForUrl(url, modeId) {
    const profiles = await this.getSiteProfiles();
    return resolveSiteProfileForUrl({ url, modeId, profiles });
  }

  async isDenylisted(siteKey) {
    const result = await this.readDenylistStatus(siteKey);
    if (!result.ok) throw new Error(result.error);
    return result.denylisted;
  }

  async isAllowlisted(siteKey) {
    const result = await this.readAllowlistStatus(siteKey);
    if (!result.ok) throw new Error(result.error);
    return result.allowlisted;
  }

  async addToDenylist(siteKey) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    await mutateLocalValue(STORAGE_KEYS.DENYLIST, (storedDenylist) => {
      const denylist = Array.isArray(storedDenylist) ? [...storedDenylist] : [];
      if (!denylist.includes(normalizedSiteKey)) {
        denylist.push(normalizedSiteKey);
      }
      return denylist;
    });
  }

  async getCooldownUntil(siteKey, modeId) {
    const result = await this.readCooldownStatus(siteKey, modeId, Number.NEGATIVE_INFINITY);
    if (!result.ok) throw new Error(result.error);
    return result.until;
  }

  async isInCooldown(siteKey, modeId) {
    const until = await this.getCooldownUntil(siteKey, modeId);
    return typeof until === 'number' && until > Date.now();
  }

  async setCooldown(siteKey, modeId) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const cooldownDuration = await this.getCooldownDuration();
    await mutateLocalValue(STORAGE_KEYS.COOLDOWNS, (storedCooldowns) => {
      const cooldowns = storedCooldowns && typeof storedCooldowns === 'object' ? { ...storedCooldowns } : {};
      const existingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => cooldowns[key]);
      cooldowns[normalizedSiteKey] = {
        ...(existingKey ? cooldowns[existingKey] : {}),
        [modeId]: { until: Date.now() + cooldownDuration },
      };
      return cooldowns;
    });
  }

  async addCooldown(siteKey, modeId, reason = 'degraded', durationMs = COOLDOWN_DURATIONS.DEGRADED) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    await mutateLocalValue(STORAGE_KEYS.COOLDOWNS, (storedCooldowns) => {
      const cooldowns = storedCooldowns && typeof storedCooldowns === 'object' ? { ...storedCooldowns } : {};
      const existingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => cooldowns[key]);
      cooldowns[normalizedSiteKey] = {
        ...(existingKey ? cooldowns[existingKey] : {}),
        [modeId]: { until: Date.now() + durationMs, reason },
      };
      return cooldowns;
    });
  }

  async clearCooldown(siteKey, modeId) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    await mutateLocalValue(STORAGE_KEYS.COOLDOWNS, (storedCooldowns) => {
      const cooldowns = storedCooldowns && typeof storedCooldowns === 'object' ? { ...storedCooldowns } : {};
      for (const key of getDomainKeyCandidates(normalizedSiteKey)) {
        if (!cooldowns?.[key]?.[modeId]) continue;
        const siteCooldowns = { ...cooldowns[key] };
        delete siteCooldowns[modeId];
        if (Object.keys(siteCooldowns).length === 0) delete cooldowns[key];
        else cooldowns[key] = siteCooldowns;
      }
      return cooldowns;
    });
  }

  async handleDecision(tabId, modeId, decision, { siteKey = 'unknown', lifecycleIntent = null } = {}) {
    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      console.debug('[DecisionHandler] Unknown decision ignored', decision);
      return { ok: false, error: 'Invalid decision' };
    }

    const normalizedSiteKey = normalizeSiteKey(siteKey);
    if (normalizedDecision === DECISIONS.ENABLED) {
      await this.recordUserIntent(normalizedSiteKey, modeId, normalizedDecision);
    } else {
      await this.recordDecision(normalizedSiteKey, modeId, normalizedDecision);
    }
    await telemetry.trackDecision(modeId, normalizedSiteKey, normalizedDecision);

    if (normalizedDecision === DECISIONS.ENABLED) {
      let policy = { allowed: false, reason: 'TAB_LOOKUP_FAILED', blockedUntil: null };
      let profileAction = null;
      try {
        const tab = await chrome.tabs.get(tabId);
        const tabUrl = tab?.url || '';
        const profileEntry = await this.getProfileEntryForUrl(tabUrl, modeId);
        profileAction = profileEntry?.action || null;
        if (profileAction === PROFILE_ACTIONS.NEVER) {
          policy = {
            allowed: false,
            reason: 'USER_DISABLED_FOR_HOST',
            blockedUntil: null,
          };
        } else {
          policy = await computeSitePolicy({ url: tabUrl, now: Date.now() });
        }
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

      const exclusivity = await ensureExclusiveModeActive(tabId, modeId, {
        siteKey: normalizedSiteKey,
        reason: 'popup',
        lifecycleIntent,
      });
      if (exclusivity?.ok === false) {
        await stateManager.updateTabModeState(tabId, modeId, {
          state: STATES.ERROR,
          pendingDecision: false,
        });

        await badgeManager.refresh();
        return {
          ok: false,
          error: exclusivity.error || 'EXCLUSIVITY_FAILED',
          peerModeId: exclusivity.peerModeId || null,
        };
      }

      let runtimeEffectPlan = null;
      let templateEvidence = null;
      let policyDecision = null;
      let runtimeContextFailure = null;
      try {
        const runtimeContext = await buildLiveRuntimeApplyContext({
          tabId,
          modeId,
          siteKey: normalizedSiteKey,
        });
        if (runtimeContext?.ok === true) {
          runtimeEffectPlan = runtimeContext.runtimeEffectPlan || null;
          templateEvidence = runtimeContext.templateEvidence || null;
          policyDecision = runtimeContext.policyDecision || null;
        } else {
          runtimeContextFailure = runtimeContext || { reason: 'LIVE_RUNTIME_CONTEXT_UNAVAILABLE' };
        }
      } catch (error) {
        runtimeEffectPlan = null;
        templateEvidence = null;
        policyDecision = null;
        runtimeContextFailure = {
          reason: 'LIVE_RUNTIME_CONTEXT_FAILED',
          detail: error?.message || null,
        };
      }

      const useLegacyComfortFallback = !runtimeEffectPlan
        && shouldUseLegacyComfortFallback(modeId, runtimeContextFailure);

      if (modeId === MODE_IDS.COMFORT_VISUAL && !runtimeEffectPlan && !useLegacyComfortFallback) {
        await stateManager.updateTabModeState(tabId, modeId, {
          state: STATES.ERROR,
          pendingDecision: false,
        });
        await stateManager.setSmartScopeStatus(tabId, modeId, {
          action: 'apply',
          ok: false,
          error: 'RUNTIME_EFFECT_PLAN_UNAVAILABLE',
          detail: runtimeContextFailure?.reason || 'LIVE_RUNTIME_CONTEXT_UNAVAILABLE',
          timestamp: Date.now(),
        });
        await badgeManager.refresh();
        return {
          ok: false,
          error: 'RUNTIME_EFFECT_PLAN_UNAVAILABLE',
          reason: runtimeContextFailure?.reason || 'LIVE_RUNTIME_CONTEXT_UNAVAILABLE',
          detail: runtimeContextFailure?.detail || null,
        };
      }

      const applyParams = {};
      if (lifecycleIntent) {
        applyParams.lifecycleIntent = lifecycleIntent;
      }
      if (templateEvidence) {
        applyParams.templateEvidence = templateEvidence;
      }
      if (runtimeEffectPlan) {
        applyParams.runtimeEffectPlan = runtimeEffectPlan;
      }
      if (
        runtimeEffectPlan &&
        (policyDecision?.decision === ACTION_POLICY_DECISIONS.DENY ||
          runtimeEffectPlan.policyDecision === ACTION_POLICY_DECISIONS.DENY)
      ) {
        applyParams.safeDowngradeOnly = true;
      }
      const applied = await cssApplier.applyMode(tabId, modeId, applyParams, 'popup');

      if (!applied || applied.ok === false) {
        if (applied?.attemptId) {
          const ledgerReason = applied?.rollback
            ? OUTCOME_LEDGER_EVENTS.ROLLED_BACK
            : OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED;
          await recordRejectedApplyOutcome({
            siteKey: normalizedSiteKey,
            modeId,
            attemptId: lifecycleIntent?.opId || applied.attemptId,
            reason: ledgerReason,
            ...templateEvidenceForLedger(applied.templateEvidence),
          });
          const negativeEvidence = templateEvidenceForTemplateMemory(applied.templateEvidence, {
            siteKey: normalizedSiteKey,
            event: ledgerReason,
          });
          if (negativeEvidence) {
            try {
              await recordTemplateMemoryNegativeOutcome(negativeEvidence);
            } catch (error) {
              console.warn('[DecisionHandler] Template negative evidence write failed', error);
            }
          }
        }

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

      if (applied?.variant === 'SCOPED_V2' && applied?.attemptId) {
        await recordAcceptedApplyOutcome({
          siteKey: normalizedSiteKey,
          modeId,
          attemptId: lifecycleIntent?.opId || applied.attemptId,
          ...templateEvidenceForLedger(applied.templateEvidence),
        });
      }

      await this.recordDecision(normalizedSiteKey, modeId, normalizedDecision, {
        committedAt: Date.now(),
        ...(lifecycleIntent?.opId ? { lifecycleOperationId: lifecycleIntent.opId } : {}),
      });

      await stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
        activatedAt: Date.now(),
        pendingDecision: false,
      });

      try {
        await chrome.tabs.sendMessage(
          tabId,
          { action: ACTIONS.INJECT_RESTORE_BUTTON, modeId },
          { frameId: 0 },
        );
      } catch (error) {
        console.warn('[DecisionHandler] Failed to inject restore button', error);
      }

      await badgeManager.refresh();
      return { ok: true, state: STATES.ACTIVE, attemptId: applied?.attemptId };
    }

    if (normalizedDecision === DECISIONS.NEVER) {
      await recordUserOutcome({
        siteKey: normalizedSiteKey,
        modeId,
        event: OUTCOME_LEDGER_EVENTS.USER_NEVER_ON_SITE,
      });

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

  async recordUserIntent(siteKey, modeId, decision) {
    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      return;
    }

    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const timestamp = Date.now();
    await mutateLocalValue(STORAGE_KEYS.PER_DOMAIN_PREFS, (storedPrefs) => {
      const perDomainPrefs = storedPrefs && typeof storedPrefs === 'object' ? { ...storedPrefs } : {};
      const existingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => perDomainPrefs[key]);
      const sitePrefs = { ...(existingKey ? perDomainPrefs[existingKey] : {}) };
      sitePrefs[modeId] = {
        ...(sitePrefs[modeId] || {}),
        userIntent: normalizedDecision,
        intentTimestamp: timestamp,
      };
      perDomainPrefs[normalizedSiteKey] = sitePrefs;
      return perDomainPrefs;
    });
  }

  async recordDecision(siteKey, modeId, decision, meta = {}) {
    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      console.debug('[DecisionHandler] Unknown decision ignored', decision);
      return;
    }

    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const timestamp = Date.now();
    await mutateLocalValue(STORAGE_KEYS.PER_DOMAIN_PREFS, (storedPrefs) => {
      const perDomainPrefs = storedPrefs && typeof storedPrefs === 'object' ? { ...storedPrefs } : {};
      const existingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => perDomainPrefs[key]);
      const sitePrefs = { ...(existingKey ? perDomainPrefs[existingKey] : {}) };
      sitePrefs[modeId] = {
        ...(sitePrefs[modeId] || {}),
        decision: normalizedDecision,
        timestamp,
        ...meta,
      };
      perDomainPrefs[normalizedSiteKey] = sitePrefs;
      return perDomainPrefs;
    });

    if (normalizedDecision === DECISIONS.NOT_NOW) {
      await this.setCooldown(normalizedSiteKey, modeId);
    } else {
      await this.clearCooldown(normalizedSiteKey, modeId);
    }

    if (normalizedDecision === DECISIONS.NEVER) {
      await this.addToDenylist(normalizedSiteKey);
    }

    if (normalizedDecision !== DECISIONS.ENABLED) {
      await learningEngine.applyDecision(normalizedSiteKey, modeId, normalizedDecision);
    }
  }

  async shouldSuggest(siteKey, modeId, score, suggestionThreshold) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    const profileAction = await this.getProfileAction(normalizedSiteKey, modeId);
    if (profileAction === PROFILE_ACTIONS.NEVER) {
      return false;
    }

    const denylisted = await this.isDenylisted(normalizedSiteKey);
    if (denylisted) {
      return false;
    }

    const onCooldown = await this.isInCooldown(normalizedSiteKey, modeId);
    if (onCooldown) {
      return false;
    }

    if (profileAction === PROFILE_ACTIONS.ALWAYS) {
      return true;
    }

    const allowlisted = await this.isAllowlisted(normalizedSiteKey);
    if (allowlisted) {
      return true;
    }

    if (typeof score !== 'number' || typeof suggestionThreshold !== 'number') {
      return false;
    }

    return score >= suggestionThreshold;
  }
}

export const decisionHandler = new DecisionHandler();
export default decisionHandler;
