import {
  MODE_ENGINE_SCOPE_SELECTOR,
  SCOPE_OWNER_VALUE,
  computeAppliedHash,
  makeScopedV2Key,
} from '../shared/mode-engine-scoped-v2.js';

const scopedV2State = new Map();

export function scopedV2KeyToString(key) {
  return `${key.tabId}:${key.frameId}`;
}

export function scopedV2InFlightKeyToString(key, modeId) {
  return `${scopedV2KeyToString(key)}:${modeId || 'unknown-mode'}`;
}

export function getScopedModeV2State(tabId, frameId) {
  const key = makeScopedV2Key(tabId, frameId);
  return scopedV2State.get(scopedV2KeyToString(key)) || null;
}

export function applyScopedModeV2({
  tabId,
  frameId = 0,
  cssId,
  modeId,
  scopeSelector = MODE_ENGINE_SCOPE_SELECTOR,
  cssText = '',
  tokens = {},
} = {}) {
  const key = makeScopedV2Key(tabId, frameId);
  const hash = computeAppliedHash({ cssText, tokens, cssId, modeId });
  const keyString = scopedV2KeyToString(key);
  const previous = scopedV2State.get(keyString);

  if (previous?.lastAppliedHash === hash) {
    return { ok: true, applied: false, state: previous };
  }

  const ownedTokenKeys = Object.keys(tokens || {}).filter((name) => typeof name === 'string');
  const nextState = {
    cssId: String(cssId || ''),
    modeId: String(modeId || ''),
    scopeSelector: scopeSelector || MODE_ENGINE_SCOPE_SELECTOR,
    lastAppliedHash: hash,
    ownedTokenKeys,
    lastAppliedAtMs: Date.now(),
    cssText: cssText || '',
    owner: SCOPE_OWNER_VALUE,
  };

  scopedV2State.set(keyString, nextState);
  return { ok: true, applied: true, state: nextState };
}

export function deleteScopedModeV2State(tabId, frameId) {
  const key = makeScopedV2Key(tabId, frameId);
  return scopedV2State.delete(scopedV2KeyToString(key));
}
