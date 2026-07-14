// shared/types/policy.js

/**
 * Decision kinds emitted by the policy engine.
 * @typedef {'SUGGEST' | 'APPLY' | 'NOOP'} DecisionKind
 */

/**
 * Policy decision outcome.
 * @typedef {Object} PolicyDecision
 * @property {DecisionKind} kind
 * @property {string} modeId
 * @property {number} score
 * @property {string[]} reasonCodes
 * @property {string[]} strongSignals
 * @property {string[]} contributingSignals
 * @property {{ enter: number, exit: number, apply: number }} thresholds
 */

/**
 * Decision context used by the policy engine.
 * @typedef {Object} DecisionContext
 * @property {number} tabId
 * @property {string} modeId
 * @property {Object | null} snapshot
 * @property {Object} currentState
 * @property {Object} userPrefs
 * @property {boolean} allowlisted
 * @property {boolean} denylisted
 * @property {number} now
 */

export const DECISION_KINDS = {
  SUGGEST: 'SUGGEST',
  APPLY: 'APPLY',
  NOOP: 'NOOP',
};
