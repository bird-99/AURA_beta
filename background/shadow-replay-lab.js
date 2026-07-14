import { STORAGE_KEYS } from '../shared/constants.js';
import { getFromSession, mutateSessionValue } from '../shared/utils.js';
import {
  SHADOW_REPLAY_MAX_BYTES,
  SHADOW_REPLAY_MAX_ENTRIES,
  createEmptyShadowReplayStoreV1,
  normalizeShadowReplayStoreV1,
  pruneShadowReplayStoreV1,
  reduceShadowReplayStoreV1,
  validateShadowReplayEventV1,
  validateShadowReplayStoreV1,
} from '../shared/engine-core/index.js';

async function readShadowReplayStore(nowMs = Date.now()) {
  return normalizeShadowReplayStoreV1(await getFromSession(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1), { nowMs });
}

async function getSessionBytesInUse() {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.session?.getBytesInUse) {
      return await chrome.storage.session.getBytesInUse(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1);
    }
  } catch {
    return null;
  }
  return null;
}

async function enforceQuota(store, nowMs) {
  let next = pruneShadowReplayStoreV1(store, { nowMs });
  const currentBytes = await getSessionBytesInUse();
  if (typeof currentBytes === 'number' && currentBytes > SHADOW_REPLAY_MAX_BYTES && next.entries.length > 1) {
    next = pruneShadowReplayStoreV1(next, {
      nowMs,
      maxEntries: Math.max(1, Math.floor(next.entries.length / 2)),
      maxBytes: SHADOW_REPLAY_MAX_BYTES,
    });
  }
  return next;
}

export async function recordShadowReplayEvent(event, { nowMs = Date.now() } = {}) {
  const validation = validateShadowReplayEventV1(event);
  if (!validation.ok) {
    return { recorded: false, reason: 'INVALID_SHADOW_REPLAY_EVENT', errors: validation.errors };
  }
  try {
    let result = null;
    await mutateSessionValue(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1, async (storedReplay) => {
      const current = normalizeShadowReplayStoreV1(storedReplay, { nowMs });
      const next = reduceShadowReplayStoreV1(current, event, { nowMs });
      const bounded = await enforceQuota(next, nowMs);
      const storeValidation = validateShadowReplayStoreV1(bounded);
      if (!storeValidation.ok) {
        result = { recorded: false, reason: 'INVALID_SHADOW_REPLAY_STORE', errors: storeValidation.errors };
        return current;
      }
      result = { recorded: true, store: bounded };
      return bounded;
    });
    return result;
  } catch (error) {
    return { recorded: false, reason: 'SHADOW_REPLAY_WRITE_FAILED', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getShadowReplayStoreForTests() {
  return readShadowReplayStore();
}

export async function clearShadowReplayStoreForTests() {
  await mutateSessionValue(STORAGE_KEYS.SHADOW_REPLAY_LEDGER_V1, () => createEmptyShadowReplayStoreV1());
}
