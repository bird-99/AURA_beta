import { MODE_ENGINE_FLAG_DEFAULTS } from './stub-constants.js';

const flagState = { ...MODE_ENGINE_FLAG_DEFAULTS };

export async function initFeatureFlags() {
  return { ...flagState };
}

export function isFlagEnabled(name) {
  return flagState[name] === true;
}

export function getAllFeatureFlags() {
  return { ...flagState };
}

export const getAllFlags = getAllFeatureFlags;

export function __resetFlags() {
  Object.keys(flagState).forEach((key) => {
    flagState[key] = false;
  });
}

export function __setFlag(name, value) {
  if (name in flagState) {
    flagState[name] = Boolean(value);
  }
}
