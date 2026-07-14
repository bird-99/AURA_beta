import { ACTIONS, STATES } from '../shared/constants.js';
import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';
import { OUTCOME_LEDGER_EVENTS } from '../shared/engine-core/enums.js';
import { cssApplier } from './css-applier.js';
import { recordUserOutcome } from './outcome-ledger.js';
import { stateManager } from './state-manager.js';
import {
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from './template-evidence.js';
import { recordTemplateMemoryNegativeOutcome } from './template-memory.js';

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
    const removalResult = await cssApplier.removeMode(tabId, peerModeId, {
      lifecycleIntent: ctx.lifecycleIntent || null,
      parentModeId: modeId,
    });
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

  if (removalError) {
    return { ok: false, error: removalError, peerModeId };
  }

  const peerTemplateEvidence = peerState?.scopedV2?.templateEvidence || null;
  await recordUserOutcome({
    siteKey: ctx.siteKey || 'unknown',
    modeId: peerModeId,
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    attemptId: peerState?.scopedV2?.outcomeAttemptId || peerState?.scopedV2?.attemptId || null,
    ...templateEvidenceForLedger(peerTemplateEvidence),
  });
  const negativeEvidence = templateEvidenceForTemplateMemory(peerTemplateEvidence, {
    siteKey: ctx.siteKey || 'unknown',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  });
  if (negativeEvidence) {
    try {
      await recordTemplateMemoryNegativeOutcome(negativeEvidence);
    } catch (error) {
      console.warn('[ModeExclusivity] Template negative evidence write failed', { tabId, peerModeId, error });
    }
  }

  try {
    await stateManager.updateModeState(tabId, peerModeId, STATES.INACTIVE, { pendingDecision: false });
  } catch (error) {
    console.warn('[ModeExclusivity] Failed to update peer mode state', { tabId, modeId, peerModeId, error });
    return { ok: false, error: removalError || 'PEER_STATE_UPDATE_FAILED' };
  }

  try {
    await chrome.tabs.sendMessage(
      tabId,
      { action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId: peerModeId },
      { frameId: 0 },
    );
  } catch (error) {
    console.warn('[ModeExclusivity] Failed to remove peer restore button', { tabId, peerModeId, error });
  }

  return { ok: true };
}
