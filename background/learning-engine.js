import {
  DECISION_ALIASES,
  DECISIONS,
  LEARNING_ADJUSTMENTS,
  LEARNING_STAGES,
  STORAGE_KEYS,
  THRESHOLDS
} from '../shared/constants.js';
import { extractDomain, getDomainKeyCandidates, mutateLocalValue, readLocalValueResult } from '../shared/utils.js';
import { consumeEligibleLearningEvents } from './outcome-ledger.js';
import { recordEligibleTemplateOutcome } from './template-memory.js';
import { OUTCOME_LEDGER_EVENTS } from '../shared/engine-core/enums.js';

function normalizeSiteKey(siteKey) {
  if (typeof siteKey !== 'string' || siteKey.trim() === '') {
    return 'unknown';
  }
  return extractDomain(siteKey);
}

class LearningEngine {
  getDefaultState() {
    return {
      stage: LEARNING_STAGES.MANUAL,
      weight: 0,
      decisionCount: 0,
      enableCount: 0,
      lastDecision: null,
      eligibilityVersion: 0,
      eligiblePositiveCount: 0,
    };
  }

  async getLearningState(modeId, siteKey) {
    const result = await this.readLearningState(modeId, siteKey);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }

  async readLearningState(modeId, siteKey) {
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    try {
      await this.applyEligibleOutcomeEvents(modeId, normalizedSiteKey);
    } catch (error) {
      return { ok: false, status: 'error', error: error?.message || 'LEARNING_STORAGE_UNAVAILABLE' };
    }
    const read = await readLocalValueResult(STORAGE_KEYS.LEARNING_WEIGHTS);
    if (!read.ok) {
      return { ok: false, status: 'error', error: read.error?.message || 'LEARNING_STORAGE_UNAVAILABLE' };
    }
    const weights = read.status === 'missing' ? {} : read.value;
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
      return { ok: false, status: 'error', error: 'INVALID_LEARNING_STORAGE' };
    }
    const matchingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => weights[key]);
    const siteWeights = matchingKey ? weights[matchingKey] : {};
    const current = siteWeights[modeId] || {};

    const state = {
      ...this.getDefaultState(),
      ...current,
      weight: typeof current.weight === 'number' ? current.weight : 0,
      stage: current.stage || LEARNING_STAGES.MANUAL,
      decisionCount: typeof current.decisionCount === 'number' ? current.decisionCount : 0,
      enableCount: typeof current.enableCount === 'number' ? current.enableCount : 0,
      lastDecision: current.lastDecision || null,
      eligibilityVersion: current.eligibilityVersion === 1 ? 1 : 0,
      eligiblePositiveCount: typeof current.eligiblePositiveCount === 'number' ? current.eligiblePositiveCount : 0,
    };
    return { ok: true, status: read.status, state };
  }

  async getStage(modeId, siteKey) {
    const state = await this.getLearningState(modeId, siteKey);
    return state.stage;
  }

  async onUserDecision(modeId, siteKey, decision) {
    const normalizedDecision = decision in DECISION_ALIASES ? DECISION_ALIASES[decision] : decision;
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    await this.applyDecisionToWeights(normalizedSiteKey, modeId, normalizedDecision, {
      positiveEligible: false,
    });
  }

  async applyDecisionToWeights(siteKey, modeId, decision, { positiveEligible = false, effectId = null } = {}) {
    const normalizedDecision = decision in DECISION_ALIASES ? DECISION_ALIASES[decision] : decision;
    const normalizedSiteKey = normalizeSiteKey(siteKey);
    if (normalizedDecision === DECISIONS.ENABLED && positiveEligible !== true) {
      return;
    }

    await mutateLocalValue(STORAGE_KEYS.LEARNING_WEIGHTS, (storedWeights) => {
      const weights = storedWeights && typeof storedWeights === 'object' ? { ...storedWeights } : {};
      const existingKey = getDomainKeyCandidates(normalizedSiteKey).find((key) => weights[key]);
      const siteWeights = { ...(existingKey ? weights[existingKey] : {}) };
      const currentRaw = siteWeights[modeId] || {};
      const current = {
        ...this.getDefaultState(),
        ...currentRaw,
        weight: typeof currentRaw.weight === 'number' ? currentRaw.weight : 0,
        stage: currentRaw.stage || LEARNING_STAGES.MANUAL,
        decisionCount: typeof currentRaw.decisionCount === 'number' ? currentRaw.decisionCount : 0,
        enableCount: typeof currentRaw.enableCount === 'number' ? currentRaw.enableCount : 0,
        lastDecision: currentRaw.lastDecision || null,
        eligibilityVersion: currentRaw.eligibilityVersion === 1 ? 1 : 0,
        eligiblePositiveCount: typeof currentRaw.eligiblePositiveCount === 'number' ? currentRaw.eligiblePositiveCount : 0,
        appliedEffectIds: Array.isArray(currentRaw.appliedEffectIds)
          ? currentRaw.appliedEffectIds.filter((entry) => typeof entry === 'string').slice(-32)
          : [],
      };

      const normalizedEffectId = typeof effectId === 'string' ? effectId.slice(0, 160) : null;
      if (normalizedEffectId && current.appliedEffectIds.includes(normalizedEffectId)) {
        return weights;
      }

      let { weight, stage, decisionCount, enableCount, eligiblePositiveCount } = current;
      let lastDecision = current.lastDecision;
      let eligibilityVersion = current.eligibilityVersion || 0;

      if (normalizedDecision === DECISIONS.ENABLED) {
        weight = Math.min(1, weight + LEARNING_ADJUSTMENTS.ENABLED);
        decisionCount += 1;
        enableCount += 1;
        eligiblePositiveCount += 1;
        eligibilityVersion = 1;
        lastDecision = DECISIONS.ENABLED;
        if (stage === LEARNING_STAGES.MANUAL) stage = LEARNING_STAGES.ASSISTED;
      } else if (normalizedDecision === DECISIONS.NOT_NOW) {
        weight = Math.max(0, weight + LEARNING_ADJUSTMENTS.NOT_NOW);
        decisionCount += 1;
        lastDecision = DECISIONS.NOT_NOW;
      } else if (normalizedDecision === DECISIONS.NEVER) {
        weight = 0;
        decisionCount += 1;
        lastDecision = DECISIONS.NEVER;
      }

      if (stage === LEARNING_STAGES.ASSISTED && weight >= THRESHOLDS.AUTO_APPLY) {
        stage = LEARNING_STAGES.AUTO;
      }

      const nextModeState = {
        weight: Number(weight.toFixed(3)),
        stage,
        decisionCount,
        enableCount,
        lastDecision,
        eligibilityVersion,
        eligiblePositiveCount,
      };
      if (normalizedEffectId || current.appliedEffectIds.length > 0) {
        nextModeState.appliedEffectIds = normalizedEffectId
          ? [...current.appliedEffectIds, normalizedEffectId].slice(-32)
          : current.appliedEffectIds;
      }
      siteWeights[modeId] = nextModeState;
      weights[normalizedSiteKey] = siteWeights;
      return weights;
    });
  }

  async applyDecision(siteKey, modeId, decision, { effectId = null } = {}) {
    const normalizedDecision = decision in DECISION_ALIASES ? DECISION_ALIASES[decision] : decision;
    await this.applyDecisionToWeights(siteKey, modeId, normalizedDecision, {
      positiveEligible: false,
      effectId,
    });
  }

  async applyEligiblePositive(siteKey, modeId) {
    await this.applyDecisionToWeights(siteKey, modeId, DECISIONS.ENABLED, {
      positiveEligible: true,
    });
  }

  async applyEligibleOutcomeEvents(modeId, siteKey, now = Date.now()) {
    const eligible = await consumeEligibleLearningEvents({ siteKey, modeId, now });
    for (const event of eligible) {
      await this.applyEligiblePositive(event.siteKey, event.modeId);
      try {
        await recordEligibleTemplateOutcome({
          ...event,
          event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
          learningEligible: true,
        }, { nowMs: now });
      } catch {
        // Template memory is shadow state; learning must not depend on it.
      }
    }
    return eligible;
  }
}

export const learningEngine = new LearningEngine();
export default learningEngine;
