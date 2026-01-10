import {
  DECISION_ALIASES,
  DECISIONS,
  LEARNING_ADJUSTMENTS,
  LEARNING_STAGES,
  STORAGE_KEYS,
  THRESHOLDS
} from '../shared/constants.js';
import { getFromLocal, setToLocal } from '../shared/utils.js';

class LearningEngine {
  getDefaultState() {
    return {
      stage: LEARNING_STAGES.MANUAL,
      weight: 0,
      decisionCount: 0,
      enableCount: 0,
      lastDecision: null,
    };
  }

  async getLearningState(modeId, siteKey) {
    const weights = (await getFromLocal(STORAGE_KEYS.LEARNING_WEIGHTS)) || {};
    const siteWeights = weights[siteKey] || {};
    const current = siteWeights[modeId] || {};

    return {
      ...this.getDefaultState(),
      ...current,
      weight: typeof current.weight === 'number' ? current.weight : 0,
      stage: current.stage || LEARNING_STAGES.MANUAL,
      decisionCount: typeof current.decisionCount === 'number' ? current.decisionCount : 0,
      enableCount: typeof current.enableCount === 'number' ? current.enableCount : 0,
      lastDecision: current.lastDecision || null,
    };
  }

  async getStage(modeId, siteKey) {
    const state = await this.getLearningState(modeId, siteKey);
    return state.stage;
  }

  async onUserDecision(modeId, siteKey, decision) {
    const normalizedDecision = decision in DECISION_ALIASES ? DECISION_ALIASES[decision] : decision;
    const weights = (await getFromLocal(STORAGE_KEYS.LEARNING_WEIGHTS)) || {};
    const siteWeights = weights[siteKey] || {};
    const current = await this.getLearningState(modeId, siteKey);

    let { weight, stage, decisionCount, enableCount } = current;
    let lastDecision = current.lastDecision;

    if (normalizedDecision === DECISIONS.ENABLED) {
      weight = Math.min(1, weight + LEARNING_ADJUSTMENTS.ENABLED);
      decisionCount += 1;
      enableCount += 1;
      lastDecision = DECISIONS.ENABLED;
      if (stage === LEARNING_STAGES.MANUAL) {
        stage = LEARNING_STAGES.ASSISTED;
      }
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

    siteWeights[modeId] = {
      weight: Number(weight.toFixed(3)),
      stage,
      decisionCount,
      enableCount,
      lastDecision,
    };

    weights[siteKey] = siteWeights;
    await setToLocal(STORAGE_KEYS.LEARNING_WEIGHTS, weights);
  }

  async applyDecision(siteKey, modeId, decision) {
    await this.onUserDecision(modeId, siteKey, decision);
  }
}

export const learningEngine = new LearningEngine();
export default learningEngine;
