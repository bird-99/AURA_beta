import { ACTIONS, STATES } from '../shared/constants.js';
import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';
import { cssApplier } from './css-applier.js';
import { stateManager } from './state-manager.js';

export async function ensureExclusiveModeActive(tabId, modeId, ctx = {}) {
  const peerModeId = getExclusivePeerModeId(modeId);
  if (!peerModeId) {
    return { ok: true };
  }

  let peerState = null;
  try {
    peerState = await stateManager.getModeState(tabId, peerModeId);
  } catch (error) {
    console.warn('[ModeExclusivity] Failed to read peer mode state', { tabId, modeId, peerModeId, error });
    return { ok: false, error: 'PEER_STATE_LOOKUP_FAILED' };
  }

  if (peerState?.state !== STATES.ACTIVE) {
    return { ok: true };
  }

  let removalError = null;
  try {
    const removalResult = await cssApplier.removeMode(tabId, peerModeId);
    if (removalResult?.ok === false) {
      removalError = removalResult?.error || removalResult?.reason || 'REMOVE_MODE_FAILED';
      console.warn('[ModeExclusivity] Peer mode CSS removal reported failure', {
        tabId,
        modeId,
        peerModeId,
        reason: ctx.reason || 'unknown',
        siteKey: ctx.siteKey || 'unknown',
        details: removalResult,
      });
    }
  } catch (error) {
    removalError = 'REMOVE_MODE_FAILED';
    console.warn('[ModeExclusivity] Failed to remove peer mode CSS', {
      tabId,
      modeId,
      peerModeId,
      reason: ctx.reason || 'unknown',
      siteKey: ctx.siteKey || 'unknown',
      error,
    });
  }

  try {
    await stateManager.updateModeState(tabId, peerModeId, STATES.INACTIVE, { pendingDecision: false });
  } catch (error) {
    console.warn('[ModeExclusivity] Failed to update peer mode state', { tabId, modeId, peerModeId, error });
    return { ok: false, error: removalError || 'PEER_STATE_UPDATE_FAILED' };
  }

  try {
    await chrome.tabs.sendMessage(tabId, { action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId: peerModeId });
  } catch (error) {
    console.warn('[ModeExclusivity] Failed to remove peer restore button', { tabId, peerModeId, error });
  }

  if (removalError) {
    return { ok: false, error: removalError };
  }

  return { ok: true };
}
