import { ACTIONS, STATES } from '../shared/constants.js';
import { contentBridge } from './content-bridge.js';
import { cssRegistry } from './css-registry.js';
import {
  lifecycleStateMetadata,
  resolveDocumentContext,
  runWithoutLifecycleInstrumentation,
} from './lifecycle-controller.js';
import {
  LIFECYCLE_ARTIFACT_STATUSES,
  MAX_LIFECYCLE_RECOVERY_ATTEMPTS,
  LIFECYCLE_OPERATION_KINDS,
  LIFECYCLE_PHASES,
  lifecycleOperationJournal,
} from './lifecycle-operation-journal.js';
import { stateManager } from './state-manager.js';

export const LIFECYCLE_DOCUMENT_RELATIONS = Object.freeze({
  SAME: 'SAME',
  DIFFERENT: 'DIFFERENT',
  UNVERIFIABLE: 'UNVERIFIABLE',
  TAB_GONE: 'TAB_GONE',
});

export const LIFECYCLE_RECOVERY_BACKOFF_MS = Object.freeze([30_000, 120_000]);

export function classifyLifecycleDocument(running, context, tabAvailable = true) {
  if (!tabAvailable || context?.status === 'tab-gone') return LIFECYCLE_DOCUMENT_RELATIONS.TAB_GONE;
  const previousId = typeof running?.documentInstanceId === 'string' ? running.documentInstanceId : '';
  const currentId = typeof context?.documentInstanceId === 'string' ? context.documentInstanceId : '';
  if (!previousId || !currentId) return LIFECYCLE_DOCUMENT_RELATIONS.UNVERIFIABLE;
  if (previousId !== currentId) return LIFECYCLE_DOCUMENT_RELATIONS.DIFFERENT;
  const previousChromeId = typeof running?.chromeDocumentId === 'string' ? running.chromeDocumentId : '';
  const currentChromeId = typeof context?.chromeDocumentId === 'string' ? context.chromeDocumentId : '';
  if (previousChromeId && currentChromeId && previousChromeId !== currentChromeId) {
    return LIFECYCLE_DOCUMENT_RELATIONS.DIFFERENT;
  }
  return LIFECYCLE_DOCUMENT_RELATIONS.SAME;
}

function collectStateCssIds(state = {}) {
  const ids = new Set();
  for (const value of [
    state?.cssId,
    state?.scopedV2?.cssId,
    state?.scopedV2?.preludeCssId,
    state?.scopedV2?.transitionCssId,
    state?.smartScope?.cssId,
    state?.smartScope?.patchCssId,
    state?.smartScope?.baseCssId,
  ]) {
    if (typeof value === 'string' && value) ids.add(value);
  }
  return [...ids];
}

async function tabExists(tabsApi, tabId) {
  try {
    await tabsApi.get(tabId);
    return true;
  } catch (_) {
    return false;
  }
}

function isDomCleanup(cleanup = {}) {
  return cleanup.action === 'REMOVE_CSS' || cleanup.action !== 'REMOVE_REGISTRY';
}

function hasUnverifiableFrameTarget(cleanup = {}) {
  if (Number.isInteger(cleanup.frameId) && cleanup.frameId !== 0) return true;
  const target = cleanup.target || {};
  if (target.allFrames === true) return true;
  if (Array.isArray(target.frameIds) && target.frameIds.some((frameId) => frameId !== 0)) return true;
  if (
    Array.isArray(target.documentIds)
    && target.documentIds.some((documentId) => typeof documentId !== 'string' || !documentId)
  ) return true;
  return false;
}

function exactDocumentTarget(cleanup, running) {
  const recordedDocumentIds = cleanup?.target?.documentIds;
  if (Array.isArray(recordedDocumentIds) && recordedDocumentIds.length > 0) {
    return { tabId: running.tabId, documentIds: [...recordedDocumentIds] };
  }
  if (typeof running?.chromeDocumentId !== 'string' || !running.chromeDocumentId) return null;
  return { tabId: running.tabId, documentIds: [running.chromeDocumentId] };
}

async function cleanupArtifact({ artifact, running, documentRelation, registry, bridge }) {
  const cleanup = artifact?.cleanup || {};
  if (!cleanup.action) return { ok: true, skipped: true };
  if (
    artifact?.status === LIFECYCLE_ARTIFACT_STATUSES.DONE
    && ['CSS_REMOVE', 'REGISTRY_REMOVE', 'SCOPE_TOKEN_CLEANUP'].includes(artifact?.kind)
  ) {
    return { ok: true, skipped: true, reason: 'cleanup-already-confirmed' };
  }

  if (cleanup.action === 'REMOVE_REGISTRY') {
    await registry.remove(cleanup.cssId);
    return { ok: true };
  }

  if (isDomCleanup(cleanup) && documentRelation === LIFECYCLE_DOCUMENT_RELATIONS.UNVERIFIABLE) {
    return { ok: false, retryable: true, reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE' };
  }

  if (
    isDomCleanup(cleanup)
    && [LIFECYCLE_DOCUMENT_RELATIONS.DIFFERENT, LIFECYCLE_DOCUMENT_RELATIONS.TAB_GONE]
      .includes(documentRelation)
  ) {
    return { ok: true, skipped: true, reason: 'DOCUMENT_GONE' };
  }

  if (isDomCleanup(cleanup) && hasUnverifiableFrameTarget(cleanup)) {
    return { ok: false, retryable: true, reason: 'FRAME_DOCUMENT_IDENTITY_UNVERIFIABLE' };
  }

  if (cleanup.action === 'REMOVE_CSS') {
    const target = exactDocumentTarget(cleanup, running);
    if (!target) return { ok: false, retryable: true, reason: 'CHROME_DOCUMENT_ID_UNVERIFIABLE' };
    await chrome.scripting.removeCSS({
      target,
      css: cleanup.cssText,
      origin: cleanup.origin || 'AUTHOR',
    });
    return { ok: true };
  }

  if (cleanup.action === 'CLEANUP_DARK_RUNTIME') {
    const target = exactDocumentTarget(cleanup, running);
    if (!target || typeof cleanup.receiptId !== 'string' || !cleanup.receiptId) {
      return { ok: false, retryable: true, reason: 'DARK_RUNTIME_RECEIPT_UNVERIFIABLE' };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target,
        world: 'ISOLATED',
        args: [cleanup.receiptId],
        func: (expectedReceiptId) => {
          const runtime = globalThis.AURA_DARK_COMFORT_THEME_RUNTIME;
          const scopeRoot = document.body || document.documentElement;
          if (typeof runtime?.cleanupDarkComfortThemeRuntime !== 'function') {
            return { ok: false, reason: 'runtime-preimage-unavailable' };
          }
          return runtime.cleanupDarkComfortThemeRuntime({
            scopeRoot,
            source: 'lifecycle-recovery',
            expectedReceiptId,
            requirePreimage: true,
          });
        },
      });
      const result = Array.isArray(results) ? results[0]?.result : null;
      if (result?.ok !== true) {
        return { ok: false, retryable: true, reason: result?.reason || 'DARK_RUNTIME_CLEANUP_FAILED' };
      }
      return { ok: true };
    } catch (error) {
      const message = error?.message || String(error);
      if (/no document|document.*not found|frame.*removed/i.test(message)) {
        return { ok: true, skipped: true, reason: 'DOCUMENT_GONE' };
      }
      return { ok: false, retryable: true, reason: message || 'DARK_RUNTIME_CLEANUP_FAILED' };
    }
  }

  const frameId = Number.isInteger(cleanup.frameId) ? cleanup.frameId : undefined;
  const message = {
    ...cleanup,
    expectedDocumentInstanceId: running.documentInstanceId,
  };
  delete message.frameId;
  const options = typeof running?.chromeDocumentId === 'string' && running.chromeDocumentId
    ? { documentId: running.chromeDocumentId }
    : frameId === undefined ? {} : { frameId };
  const result = await bridge.safeSend(running.tabId, message, options);
  if (result?.ok !== true || result?.data?.ok === false) {
    return {
      ok: false,
      reason: result?.data?.error || result?.data?.reason || result?.error?.message || 'CONTENT_CLEANUP_FAILED',
    };
  }
  return { ok: true };
}

export async function cleanupLifecycleArtifacts(running, {
  journal = lifecycleOperationJournal,
  registry = cssRegistry,
  bridge = contentBridge,
  tabsApi = chrome.tabs,
  contextResolver = resolveDocumentContext,
  includeStateRegistry = false,
} = {}) {
  const tabAvailable = await tabExists(tabsApi, running.tabId);
  const context = tabAvailable
    ? await contextResolver(running.tabId)
    : { status: 'tab-gone', documentInstanceId: null, chromeDocumentId: null };
  const documentRelation = classifyLifecycleDocument(running, context, tabAvailable);
  const failures = [];

  await runWithoutLifecycleInstrumentation(async () => {
    for (const artifact of [...(running.artifacts || [])].reverse()) {
      if (artifact.status === LIFECYCLE_ARTIFACT_STATUSES.CLEANED) continue;
      try {
        const cleanupResult = await cleanupArtifact({
          artifact,
          running,
          documentRelation,
          registry,
          bridge,
        });
        if (cleanupResult.ok !== true) {
          failures.push({ artifactId: artifact.id, reason: cleanupResult.reason });
          continue;
        }
        await journal.markArtifact(running, artifact.id, LIFECYCLE_ARTIFACT_STATUSES.CLEANED, {
          recoveredAt: Date.now(),
        });
      } catch (error) {
        failures.push({ artifactId: artifact.id, reason: error?.message || 'RECOVERY_CLEANUP_FAILED' });
      }
    }
    if (includeStateRegistry) {
      for (const cssId of collectStateCssIds(running.beforeState)) {
        try {
          await registry.remove(cssId);
        } catch (error) {
          failures.push({ artifactId: `state-registry:${cssId}`, reason: error?.message || 'REGISTRY_REMOVE_FAILED' });
        }
      }
    }
  });

  return {
    ok: failures.length === 0,
    failures,
    documentRelation,
    documentMatches: documentRelation === LIFECYCLE_DOCUMENT_RELATIONS.SAME,
    tabAvailable,
  };
}

async function settleRecoveredState({ manager, running, targetState }) {
  const base = {
    ...lifecycleStateMetadata(running),
    pendingDecision: false,
  };
  if (targetState === STATES.INACTIVE) {
    await manager.updateTabModeState(running.tabId, running.modeId, {
      ...base,
      state: STATES.INACTIVE,
      cssId: null,
      cssHash: null,
      frameId: null,
      activeQuality: null,
      smartScope: null,
      scopedV2: null,
    });
    return;
  }
  if (targetState === STATES.ACTIVE) {
    await manager.updateTabModeState(running.tabId, running.modeId, {
      ...(running.beforeState || {}),
      ...base,
      state: STATES.ACTIVE,
      cssId: null,
      cssHash: null,
      smartScope: null,
      scopedV2: null,
    });
    return;
  }
  await manager.updateTabModeState(running.tabId, running.modeId, {
    ...base,
    state: STATES.ERROR,
    cssId: null,
    cssHash: null,
    activeQuality: null,
    smartScope: null,
    scopedV2: null,
  });
}

function failureReason(failures, fallback = 'RECOVERY_FAILED') {
  const first = Array.isArray(failures) ? failures[0] : failures;
  const value = first?.reason || first?.error || first || fallback;
  return String(value).slice(0, 240);
}

function sanitizeFailures(failures) {
  const source = Array.isArray(failures) ? failures : [{ reason: failures }];
  return source.slice(0, 20).map((failure) => ({
    ...(typeof failure?.artifactId === 'string'
      ? { artifactId: failure.artifactId.slice(0, 160) }
      : {}),
    reason: String(failure?.reason || failure?.error || failure || 'RECOVERY_FAILED').slice(0, 240),
  }));
}

function retryAtForAttempt(attempt, now) {
  const delay = LIFECYCLE_RECOVERY_BACKOFF_MS[Math.max(0, attempt - 1)];
  return Number.isFinite(delay) ? now + delay : null;
}

async function recordRecoveryFailure(journal, owner, failures, now) {
  const safeFailures = sanitizeFailures(failures);
  const reason = failureReason(safeFailures);
  const retryAt = retryAtForAttempt(owner.recoveryAttempts, now);
  const updated = await journal.recordRecoveryFailure(owner, {
    reason,
    lastError: safeFailures,
    nextRetryAt: retryAt,
    maxAttempts: MAX_LIFECYCLE_RECOVERY_ATTEMPTS,
  });
  return {
    ok: false,
    retryable: updated.phase === LIFECYCLE_PHASES.RETRYABLE,
    quarantined: updated.phase === LIFECYCLE_PHASES.QUARANTINED,
    tabId: owner.tabId,
    modeId: owner.modeId,
    failures: safeFailures,
    recoveryAttempts: updated.recoveryAttempts,
    nextRetryAt: updated.nextRetryAt,
  };
}

export async function pruneOrphanedLifecycleTabs({
  journal = lifecycleOperationJournal,
  manager = stateManager,
  registry = cssRegistry,
  tabsApi = chrome.tabs,
} = {}) {
  if (typeof tabsApi?.query !== 'function' || typeof journal.listTabs !== 'function') {
    return { ok: true, skipped: true, removed: [] };
  }
  let liveTabs;
  try {
    liveTabs = await tabsApi.query({});
  } catch (error) {
    return { ok: false, skipped: true, removed: [], reason: error?.message || 'TAB_QUERY_FAILED' };
  }
  const listed = await journal.listTabs();
  if (!listed.ok) return { ok: false, skipped: true, removed: [], reason: listed.error?.message };
  const liveIds = new Set((liveTabs || []).map((tab) => tab?.id).filter(Number.isInteger));
  const orphaned = listed.entries.filter((entry) => !liveIds.has(entry.tabId));
  for (const { tabId, slot } of orphaned) {
    const running = slot?.running;
    if (running) {
      const registryIds = new Set(collectStateCssIds(running.beforeState));
      for (const artifact of running.artifacts || []) {
        if (artifact?.cleanup?.action === 'REMOVE_REGISTRY' && artifact.cleanup.cssId) {
          registryIds.add(artifact.cleanup.cssId);
        }
      }
      for (const cssId of registryIds) {
        try { await registry.remove(cssId); } catch (_) { /* later registry cleanup remains available */ }
      }
    }
    if (typeof manager?.clearTab === 'function') {
      try { await manager.clearTab(tabId); } catch (_) { /* journal pruning must still converge */ }
    }
  }
  const removed = await journal.pruneTabs(liveIds);
  return { ok: true, skipped: false, removed };
}

async function recoverRunningOperation({
  tabId,
  running,
  journal,
  manager,
  registry,
  bridge,
  tabsApi,
  contextResolver,
  onDesiredIntent,
  onCommittedOperation,
  now,
}) {
  if (running.phase === LIFECYCLE_PHASES.QUARANTINED) {
    return { ok: false, quarantined: true, skipped: true, tabId, modeId: running.modeId };
  }
  if (Number.isFinite(running.nextRetryAt) && running.nextRetryAt > now) {
    return {
      ok: false,
      retryable: true,
      deferred: true,
      tabId,
      modeId: running.modeId,
      nextRetryAt: running.nextRetryAt,
    };
  }

  const modeState = await manager.getModeState(tabId, running.modeId);
  const committedPhase = [LIFECYCLE_PHASES.STATE_COMMITTED, LIFECYCLE_PHASES.POST_COMMIT]
    .includes(running.phase)
    || [LIFECYCLE_PHASES.STATE_COMMITTED, LIFECYCLE_PHASES.POST_COMMIT]
      .includes(running.interruptedPhase);
  const stateAlreadyCommitted = modeState?.lastLifecycleOpId === running.opId
    && modeState?.lastLifecycleGeneration === running.generation
    && modeState?.state === running.targetState
    && committedPhase;

  const attemptOwner = await journal.startRecoveryAttempt(running, { attemptedAt: now });
  if (stateAlreadyCommitted) {
    if (typeof onCommittedOperation === 'function') {
      try {
        const postCommit = await onCommittedOperation(attemptOwner, modeState);
        if (postCommit?.ok === false) {
          return recordRecoveryFailure(
            journal,
            attemptOwner,
            [{ reason: postCommit.reason || postCommit.error || 'POST_COMMIT_RECOVERY_FAILED' }],
            now,
          );
        }
      } catch (error) {
        return recordRecoveryFailure(
          journal,
          attemptOwner,
          [{ reason: error?.message || 'POST_COMMIT_RECOVERY_FAILED' }],
          now,
        );
      }
    }
    await journal.complete(attemptOwner);
    return { ok: true, tabId, modeId: running.modeId, finalized: true };
  }

  const cleanup = await cleanupLifecycleArtifacts(attemptOwner, {
    journal,
    registry,
    bridge,
    tabsApi,
    contextResolver,
    includeStateRegistry: running.kind === LIFECYCLE_OPERATION_KINDS.REMOVE,
  });
  const { failures, documentMatches, documentRelation } = cleanup;

  if (documentRelation === LIFECYCLE_DOCUMENT_RELATIONS.TAB_GONE) {
    if (typeof manager?.clearTab === 'function') await manager.clearTab(tabId);
    await journal.clearTab(tabId);
    return { ok: true, tabId, modeId: running.modeId, orphaned: true };
  }
  if (failures.length > 0) {
    return recordRecoveryFailure(journal, attemptOwner, failures, now);
  }

  const targetState = running.kind === LIFECYCLE_OPERATION_KINDS.REMOVE
    ? STATES.INACTIVE
    : running.kind === LIFECYCLE_OPERATION_KINDS.REHYDRATE && documentMatches
      ? STATES.ACTIVE
      : STATES.ERROR;
  await settleRecoveredState({ manager, running: attemptOwner, targetState });
  await journal.complete(attemptOwner);
  const result = { ok: true, tabId, modeId: running.modeId, recoveredState: targetState, documentRelation };

  if (
    running.kind === LIFECYCLE_OPERATION_KINDS.REHYDRATE
    && documentMatches
    && typeof onDesiredIntent === 'function'
  ) {
    const replay = await onDesiredIntent({
      tabId,
      modeId: running.modeId,
      kind: LIFECYCLE_OPERATION_KINDS.REHYDRATE,
      targetState: STATES.ACTIVE,
      source: 'recovery-rehydrate',
      recoveryReplay: true,
    }, { recovered: true, documentMatches: true, previousKind: running.kind });
    result.replay = replay;
  }

  const refreshedSlot = await journal.getTabSlot(tabId);
  const desired = refreshedSlot.ok ? refreshedSlot.slot?.desired : null;
  if (desired && typeof onDesiredIntent === 'function') {
    result.desired = await onDesiredIntent(desired, {
      recovered: true,
      documentMatches,
      previousKind: running.kind,
    });
  }
  return result;
}

export async function recoverLifecycleJournal({
  journal = lifecycleOperationJournal,
  manager = stateManager,
  registry = cssRegistry,
  bridge = contentBridge,
  tabsApi = chrome.tabs,
  contextResolver = resolveDocumentContext,
  onDesiredIntent = null,
  onCommittedOperation = null,
  now = () => Date.now(),
  pruneOrphans = true,
} = {}) {
  const orphanPrune = pruneOrphans
    ? await pruneOrphanedLifecycleTabs({ journal, manager, registry, tabsApi })
    : { ok: true, skipped: true, removed: [] };
  const pending = await journal.listPendingTabs();
  if (!pending.ok) {
    const error = new Error(pending.error?.message || 'LIFECYCLE_STORAGE_UNAVAILABLE');
    error.code = pending.status === 'corrupt' ? 'LIFECYCLE_JOURNAL_CORRUPT' : 'LIFECYCLE_STORAGE_UNAVAILABLE';
    throw error;
  }

  const results = [];
  for (const { tabId, slot } of pending.entries) {
    try {
      if (!slot.running) {
        if (slot.desired && typeof onDesiredIntent === 'function') {
          results.push(await onDesiredIntent(slot.desired, { recovered: true, noRunningOperation: true }));
        }
        continue;
      }
      results.push(await recoverRunningOperation({
        tabId,
        running: slot.running,
        journal,
        manager,
        registry,
        bridge,
        tabsApi,
        contextResolver,
        onDesiredIntent,
        onCommittedOperation,
        now: now(),
      }));
    } catch (error) {
      const failures = [{ reason: error?.message || 'LIFECYCLE_ENTRY_RECOVERY_FAILED' }];
      try {
        const current = await journal.getTabSlot(tabId);
        let owner = current.ok ? current.slot?.running : null;
        if (owner && owner.phase !== LIFECYCLE_PHASES.QUARANTINED) {
          if (owner.phase !== LIFECYCLE_PHASES.ROLLING_BACK) {
            owner = await journal.startRecoveryAttempt(owner, { attemptedAt: now() });
          }
          results.push({
            ...(await recordRecoveryFailure(journal, owner, failures, now())),
            isolated: true,
          });
          continue;
        }
      } catch (_) {
        // Preserve the original isolated failure if the journal itself became unavailable.
      }
      results.push({
        ok: false,
        isolated: true,
        tabId,
        modeId: slot.running?.modeId || slot.desired?.modeId || null,
        failures,
      });
    }
  }

  const degraded = results.some((entry) => entry?.ok === false) || orphanPrune.ok === false;
  return {
    ok: true,
    degraded,
    retryableCount: results.filter((entry) => entry?.retryable).length,
    quarantinedCount: results.filter((entry) => entry?.quarantined).length,
    nextRetryAt: results
      .map((entry) => entry?.nextRetryAt)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0] || null,
    orphanPrune,
    results,
  };
}

export function isCleanupContentAction(action) {
  return [
    ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
    ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1,
  ].includes(action);
}
