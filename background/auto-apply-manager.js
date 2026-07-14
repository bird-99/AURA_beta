import {
  ACTIONS,
  LEARNING_STAGES,
  MODE_IDS,
  STATES,
  STORAGE_KEYS,
  THRESHOLDS
} from '../shared/constants.js';
import { extractDomain, readLocalValueResult } from '../shared/utils.js';
import { computeSitePolicy } from './site-policy-manager.js';
import { ensureExclusiveModeActive } from './mode-exclusivity-manager.js';
import { PROFILE_ACTIONS, resolveSiteProfileForUrl } from '../shared/site-profiles.js';
import { readSiteProfilesResult } from './site-profile-store.js';
import { isConservativePersonalizationGateAllowedV1 } from '../shared/engine-core/personalization-gate.js';
import { claimLifecycleIntent, finishLifecycleIntent } from './lifecycle-controller.js';
import { LIFECYCLE_OPERATION_KINDS } from './lifecycle-operation-journal.js';

export class AutoApplyManager {
  constructor(stateManager, cssApplier, badgeManager, learningEngine, decisionHandler, liveGateBuilder = null) {
    this.stateManager = stateManager;
    this.cssApplier = cssApplier;
    this.badgeManager = badgeManager;
    this.learningEngine = learningEngine;
    this.decisionHandler = decisionHandler;
    this.liveGateBuilder = liveGateBuilder;
  }

  async isFocusDefaultEnabled() {
    const read = await readLocalValueResult(STORAGE_KEYS.USER_PREFS);
    if (!read.ok || read.status !== 'found' || !read.value || typeof read.value !== 'object') {
      return false;
    }
    return read.value.focusDefaultEnabled === true;
  }

  async readSiteProfiles() {
    return readSiteProfilesResult();
  }

  async readDecisionStatus(statusMethod, legacyMethod, field, args) {
    if (typeof this.decisionHandler?.[statusMethod] === 'function') {
      return this.decisionHandler[statusMethod](...args);
    }
    try {
      return { ok: true, [field]: await this.decisionHandler[legacyMethod](...args) };
    } catch (error) {
      return { ok: false, error: error?.message || 'STORAGE_UNAVAILABLE' };
    }
  }

  async readAutoApplyGuards(siteKey, modeId) {
    const [denylist, allowlist, cooldown, userPrefs, perDomainPrefs] = await Promise.all([
      this.readDecisionStatus('readDenylistStatus', 'isDenylisted', 'denylisted', [siteKey]),
      this.readDecisionStatus('readAllowlistStatus', 'isAllowlisted', 'allowlisted', [siteKey]),
      this.readDecisionStatus('readCooldownStatus', 'isInCooldown', 'active', [siteKey, modeId]),
      readLocalValueResult(STORAGE_KEYS.USER_PREFS),
      readLocalValueResult(STORAGE_KEYS.PER_DOMAIN_PREFS),
    ]);
    if (!denylist.ok || !allowlist.ok || !cooldown.ok || !userPrefs.ok || !perDomainPrefs.ok) {
      return { ok: false, error: 'STORAGE_UNAVAILABLE' };
    }
    if (
      (userPrefs.status === 'found' && (!userPrefs.value || typeof userPrefs.value !== 'object'))
      || (perDomainPrefs.status === 'found' && (!perDomainPrefs.value || typeof perDomainPrefs.value !== 'object'))
    ) return { ok: false, error: 'INVALID_STORAGE_VALUE' };
    return {
      ok: true,
      denylisted: denylist.denylisted === true,
      allowlisted: allowlist.allowlisted === true,
      cooldownActive: cooldown.active === true,
    };
  }

  async readLearningState(modeId, siteKey) {
    if (typeof this.learningEngine?.readLearningState === 'function') {
      try {
        return await this.learningEngine.readLearningState(modeId, siteKey);
      } catch (error) {
        return { ok: false, error: error?.message || 'STORAGE_UNAVAILABLE' };
      }
    }
    try {
      return { ok: true, state: await this.learningEngine.getLearningState(modeId, siteKey) };
    } catch (error) {
      return { ok: false, error: error?.message || 'STORAGE_UNAVAILABLE' };
    }
  }

  resolveProfileAction(url, modeId, profiles) {
    const entry = resolveSiteProfileForUrl({ url, modeId, profiles });
    return entry?.action || null;
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

    const profileRead = await this.readSiteProfiles();
    if (!profileRead.ok) return false;
    const guards = await this.readAutoApplyGuards(siteKey, MODE_IDS.FOCUS);
    if (!guards.ok || guards.denylisted || guards.cooldownActive) return false;
    const profileAction = this.resolveProfileAction(url, MODE_IDS.FOCUS, profileRead.profiles);
    if (profileAction === PROFILE_ACTIONS.NEVER) {
      return false;
    }
    if (profileAction === PROFILE_ACTIONS.ALWAYS) {
      await this.autoApplyMode(tabId, MODE_IDS.FOCUS, siteKey, 'profile-always');
      return true;
    }

    const focusState = await this.stateManager.getModeState(tabId, MODE_IDS.FOCUS);
    if (!focusState || focusState.state !== STATES.INACTIVE) {
      return false;
    }

    const comfortState = await this.stateManager.getModeState(tabId, MODE_IDS.COMFORT_VISUAL);
    if (comfortState?.state === STATES.ACTIVE) {
      return false;
    }

    const personalization = await this.resolvePersonalizationGate({
      tabId,
      modeId: MODE_IDS.FOCUS,
      siteKey,
      requestedStrength: 1,
      options: {},
    });
    if (!isConservativePersonalizationGateAllowedV1(personalization?.gate)) {
      return false;
    }

    const applyParams = typeof personalization.frameId === 'number'
      ? { frameId: personalization.frameId, preventFrameFallback: true }
      : {};
    await this.autoApplyMode(tabId, MODE_IDS.FOCUS, siteKey, 'focus-default', applyParams);
    return true;
  }

  async evaluateAutoApply(tabId, modeId, score, options = {}) {
    const autoThreshold = normalizeThreshold(options.autoThreshold);
    let siteKey = 'unknown';
    let url = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';
      url = tab?.url || '';
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

    const profileRead = await this.readSiteProfiles();
    if (!profileRead.ok) return false;
    const guards = await this.readAutoApplyGuards(siteKey, modeId);
    if (!guards.ok) return false;
    const profileAction = this.resolveProfileAction(url, modeId, profileRead.profiles);
    if (profileAction === PROFILE_ACTIONS.NEVER) {
      return false;
    }
    if (guards.denylisted || guards.cooldownActive) {
      return false;
    }
    if (profileAction === PROFILE_ACTIONS.ALWAYS) {
      await this.autoApplyMode(tabId, modeId, siteKey, 'profile-always');
      return true;
    }

    if (!guards.allowlisted) {
      if (typeof score !== 'number' || score < autoThreshold) {
        return false;
      }
    }

    const learningRead = await this.readLearningState(modeId, siteKey);
    if (!learningRead.ok) return false;
    const learning = learningRead.state;
    if (learning.stage !== LEARNING_STAGES.AUTO) {
      return false;
    }

    if (learning.eligibilityVersion !== 1 || learning.eligiblePositiveCount < 1) {
      return false;
    }

    if (typeof learning.weight !== 'number' || learning.weight < autoThreshold) {
      return false;
    }

    if (learning.lastDecision === 'NEVER') {
      return false;
    }

    const modeState = (await this.stateManager.getModeState(tabId, modeId)) || { state: STATES.INACTIVE };
    if (modeState.state === STATES.BLOCKED || modeState.state === STATES.DEGRADED || modeState.state === STATES.ERROR) {
      return false;
    }

    if (!modeState || modeState.state !== STATES.INACTIVE) {
      return false;
    }

    const personalization = await this.resolvePersonalizationGate({
      tabId,
      modeId,
      siteKey,
      requestedStrength: score,
      options,
    });
    if (!isConservativePersonalizationGateAllowedV1(personalization?.gate)) {
      return false;
    }

    const applyParams = typeof personalization.frameId === 'number'
      ? { frameId: personalization.frameId, preventFrameFallback: true }
      : {};
    await this.autoApplyMode(tabId, modeId, siteKey, 'auto', applyParams);
    return true;
  }

  async resolvePersonalizationGate({ tabId, modeId, siteKey, requestedStrength, options = {} }) {
    if (typeof this.liveGateBuilder === 'function') {
      try {
        const result = await this.liveGateBuilder({
          tabId,
          modeId,
          siteKey,
          requestedStrength,
        });
        if (result?.ok !== true || typeof result?.frameId !== 'number') {
          return null;
        }
        return {
          gate: result.gate || null,
          frameId: result.frameId,
        };
      } catch {
        return null;
      }
    }

    if (
      isConservativePersonalizationGateAllowedV1(options.personalizationGate)
      && typeof options.personalizationFrameId === 'number'
    ) {
      return {
        gate: options.personalizationGate,
        frameId: options.personalizationFrameId,
      };
    }

    return null;
  }

  async applyProfileOverrides(tabId, urlOverride) {
    let url = urlOverride;
    let siteKey = 'unknown';
    try {
      if (!url) {
        const tab = await chrome.tabs.get(tabId);
        url = tab?.url || '';
      }
      siteKey = url ? extractDomain(url) : 'unknown';
    } catch (error) {
      console.warn('[AutoApplyManager] Unable to resolve site key for profile overrides', tabId, error);
      return { applied: [], removed: [] };
    }

    const profileRead = await this.readSiteProfiles();
    if (!profileRead.ok) return { applied: [], removed: [], error: 'STORAGE_UNAVAILABLE' };
    const profiles = profileRead.profiles;
    const applied = [];
    const removed = [];

    for (const modeId of Object.values(MODE_IDS)) {
      const action = this.resolveProfileAction(url, modeId, profiles);
      if (action === PROFILE_ACTIONS.ALWAYS) {
        const guards = await this.readAutoApplyGuards(siteKey, modeId);
        if (!guards.ok || guards.denylisted || guards.cooldownActive) continue;
        const modeState = await this.stateManager.getModeState(tabId, modeId);
        if (!modeState || modeState.state === STATES.ACTIVE) {
          continue;
        }
        if ([STATES.BLOCKED, STATES.DEGRADED, STATES.ERROR].includes(modeState.state)) {
          continue;
        }
        const policy = await computeSitePolicy({ url: url || '', now: Date.now() });
        if (!policy.allowed) {
          continue;
        }
        await this.autoApplyMode(tabId, modeId, siteKey, 'profile-always');
        applied.push(modeId);
      } else if (action === PROFILE_ACTIONS.NEVER) {
        const modeState = await this.stateManager.getModeState(tabId, modeId);
        if (modeState?.state !== STATES.ACTIVE) {
          continue;
        }
        const removal = await this.cssApplier.removeMode(tabId, modeId);
        if (removal?.ok === false) {
          continue;
        }
        await this.stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, {
          pendingDecision: false,
        });
        try {
          await chrome.tabs.sendMessage(
            tabId,
            { action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId },
            { frameId: 0 },
          );
        } catch (error) {
          console.warn('[AutoApplyManager] Failed to remove restore button', error);
        }
        removed.push(modeId);
      }
    }

    if (applied.length || removed.length) {
      await this.badgeManager.refresh();
    }

    return { applied, removed };
  }

  async autoApplyMode(tabId, modeId, siteKey, source = 'auto', params = {}) {
    let lifecycleIntent;
    try {
      lifecycleIntent = await claimLifecycleIntent({
        tabId,
        modeId,
        kind: LIFECYCLE_OPERATION_KINDS.APPLY,
        targetState: STATES.ACTIVE,
        source,
      });
    } catch (error) {
      console.warn('[AutoApplyManager] Lifecycle storage unavailable, skipping auto-apply', error);
      return;
    }

    const exclusivity = await ensureExclusiveModeActive(tabId, modeId, {
      siteKey,
      reason: source,
      lifecycleIntent,
    });
    if (exclusivity?.ok === false) {
      console.warn('[AutoApplyManager] Exclusive peer cleanup failed, skipping auto-apply', {
        tabId,
        modeId,
        peerModeId: exclusivity.peerModeId || null,
        error: exclusivity.error || 'EXCLUSIVITY_FAILED',
      });
      await finishLifecycleIntent(lifecycleIntent, { ok: false, reason: exclusivity.error || 'EXCLUSIVITY_FAILED' });
      return;
    }

    const applied = await this.cssApplier.applyMode(
      tabId,
      modeId,
      { ...(params || {}), lifecycleIntent },
      source,
    );
    if (!applied || applied.ok === false) {
      console.warn('[AutoApplyManager] CSS application failed, skipping state update');
      await finishLifecycleIntent(lifecycleIntent, applied || { ok: false, reason: 'APPLY_FAILED' });
      return;
    }

    await this.stateManager.updateModeState(tabId, modeId, STATES.ACTIVE, {
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
      console.error('[AutoApplyManager] Failed to inject restore button', error);
    }

    await this.badgeManager.refresh();
    await finishLifecycleIntent(lifecycleIntent, { ok: true });
  }
}

function normalizeThreshold(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return THRESHOLDS.AUTO_APPLY;
  }
  return Math.min(Math.max(value, 0), 1);
}

export default AutoApplyManager;
