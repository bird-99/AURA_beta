export const COMFORT_VISUAL_DEFAULTS = {
  textScale: true,
  spacingPack: true,
  linkEnhance: true,
  typoSmoothing: true,
  reflowGuard: true,
  darkMode: true,
};

export function normalizeComfortVisualPrefs(raw) {
  const base = { ...COMFORT_VISUAL_DEFAULTS };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  for (const key of Object.keys(base)) {
    if (typeof raw[key] === 'boolean') {
      base[key] = raw[key];
    }
  }

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

  return next;
}
