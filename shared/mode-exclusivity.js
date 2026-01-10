// shared/mode-exclusivity.js

import { MODE_IDS } from './constants.js';

export const EXCLUSIVE_MODE_MAP = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: MODE_IDS.FOCUS,
  [MODE_IDS.FOCUS]: MODE_IDS.COMFORT_VISUAL
});

/**
 * Retourne le mode exclusif (peer) pour un mode donné.
 * @param {string} modeId
 * @returns {string|null}
 */
export function getExclusivePeerModeId(modeId) {
  if (typeof modeId !== 'string' || !modeId) {
    return null;
  }

  return EXCLUSIVE_MODE_MAP[modeId] || null;
}

/**
 * Indique si un mode participe à l'exclusivité Comfort ↔ Focus.
 * @param {string} modeId
 * @returns {boolean}
 */
export function isExclusiveMode(modeId) {
  return getExclusivePeerModeId(modeId) !== null;
}
