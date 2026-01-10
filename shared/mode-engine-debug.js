// shared/mode-engine-debug.js

import { isFlagEnabled } from './feature-flags.js';

const PREFIX = '[AURA][ModeEngine]';

function isDebugEnabled() {
  return isFlagEnabled('debugModeEngine');
}

function createLogger(method) {
  return (...args) => {
    if (!isDebugEnabled()) {
      return;
    }

    const target = console?.[method] || console.log;
    target.call(console, PREFIX, ...args);
  };
}

function normalizeTags(tags) {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    return {};
  }

  return tags;
}

function normalizeName(name) {
  return typeof name === 'string' ? name : 'unknown';
}

export const log = createLogger('log');
export const warn = createLogger('warn');
export const error = createLogger('error');

export function recordMetric(name, value, tags) {
  if (!isDebugEnabled()) {
    return;
  }

  const safeName = normalizeName(name);
  const payload = {
    value,
    tags: normalizeTags(tags),
  };

  console.debug(`${PREFIX} metric:${safeName}`, payload);
}

export function recordTiming(name, elapsedMs, tags) {
  if (!isDebugEnabled()) {
    return;
  }

  const safeName = normalizeName(name);
  const payload = {
    elapsedMs,
    tags: normalizeTags(tags),
  };

  console.debug(`${PREFIX} timing:${safeName}`, payload);
}

export const modeEngineDebug = Object.freeze({
  log,
  warn,
  error,
  recordMetric,
  recordTiming,
  prefix: PREFIX,
});

export const modeEngineLog = log;
export const recordModeEngineMetric = recordMetric;

export function getModeEngineDebugPrefix() {
  return PREFIX;
}
