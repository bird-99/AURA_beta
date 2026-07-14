import { FEATURE_IDS } from './engine-core/enums.js';

export const COMFORT_VISUAL_DEFAULTS = {
  textScale: true,
  spacingPack: true,
  linkEnhance: true,
  typoSmoothing: true,
  reflowGuard: true,
  darkMode: false,
};

export const COMFORT_VISUAL_PREF_FEATURE_IDS = Object.freeze({
  textScale: FEATURE_IDS.TEXT_SCALE,
  spacingPack: FEATURE_IDS.SPACING_PACK,
  linkEnhance: FEATURE_IDS.LINK_ENHANCEMENT,
  typoSmoothing: FEATURE_IDS.TEXT_RENDERING_REFINEMENT,
  darkMode: FEATURE_IDS.DARK_COMFORT_THEME,
  reflowGuard: FEATURE_IDS.REFLOW_GUARD,
});

export const COMFORT_VISUAL_USER_TOGGLEABLE_PREF_KEYS = Object.freeze([
  'textScale',
  'spacingPack',
  'linkEnhance',
  'typoSmoothing',
  'darkMode',
]);

export const COMFORT_VISUAL_SAFETY_PREF_KEYS = Object.freeze([
  'reflowGuard',
]);

export function getDefaultComfortVisualPrefs() {
  return { ...COMFORT_VISUAL_DEFAULTS };
}

export function normalizeComfortVisualPrefs(raw) {
  const base = getDefaultComfortVisualPrefs();

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  for (const key of Object.keys(base)) {
    if (typeof raw[key] === 'boolean') {
      base[key] = raw[key];
    }
  }

  base.reflowGuard = true;
  return base;
}

export function mergeComfortVisualPrefs(prev, patch) {
  const next = normalizeComfortVisualPrefs(prev);

  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return next;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (typeof next[key] !== 'undefined' && typeof value === 'boolean') {
      next[key] = value;
    }
  }

  next.reflowGuard = true;
  return next;
}
