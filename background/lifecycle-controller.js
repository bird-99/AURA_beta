import { ACTIONS, STATES } from '../shared/constants.js';
import {
  LIFECYCLE_ARTIFACT_STATUSES,
  LIFECYCLE_PHASES,
  lifecycleOperationJournal,
} from './lifecycle-operation-journal.js';
import { makeUrlKey } from './scope-cache.js';
import { stateManager } from './state-manager.js';

let instrumentationSuppressionDepth = 0;

function lifecycleError(result = {}) {
  return result?.error || result?.reason || result?.detail || 'LIFECYCLE_OPERATION_FAILED';
}

export async function resolveDocumentContext(tabId, fallbackUrl = '') {
  let url = typeof fallbackUrl === 'string' ? fallbackUrl : '';
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab?.url || url;
  } catch (_) {
    return {
      status: 'tab-gone',
      reason: 'TAB_GONE',
      url,
      urlKey: makeUrlKey(url),
      documentInstanceId: null,
      chromeDocumentId: null,
    };
  }

  if (typeof chrome.scripting?.executeScript === 'function') {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: 'ISOLATED',
        func: () => ({
          url: globalThis.location?.href || '',
          documentInstanceId: typeof globalThis.__AURA_DOCUMENT_INSTANCE_ID__ === 'string'
            ? globalThis.__AURA_DOCUMENT_INSTANCE_ID__
            : null,
        }),
      });
      const mainFrame = Array.isArray(results)
        ? results.find((entry) => entry?.frameId === 0) || results[0]
        : null;
      const data = mainFrame?.result;
      if (typeof data?.documentInstanceId === 'string' && data.documentInstanceId) {
        const resolvedUrl = typeof data.url === 'string' ? data.url : url;
        return {
          status: 'verified',
          reason: null,
          url: resolvedUrl,
          urlKey: makeUrlKey(resolvedUrl),
          documentInstanceId: data.documentInstanceId,
          chromeDocumentId: typeof mainFrame?.documentId === 'string' ? mainFrame.documentId : null,
        };
      }
    } catch (_) {
      // The early content listener below remains the compatibility fallback.
    }
  }

  try {
    const response = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || { data: null, reason: 'NO_RESPONSE' });
      };
      const timeoutId = setTimeout(() => finish({ data: null, reason: 'TIMEOUT' }), 250);
      const callback = (messageResponse) => {
        clearTimeout(timeoutId);
        finish(chrome.runtime?.lastError
          ? { data: null, reason: 'NO_RECEIVER' }
          : { data: messageResponse, reason: null });
      };
      try {
        const maybePromise = chrome.tabs.sendMessage(
          tabId,
          { action: ACTIONS.GET_DOCUMENT_CONTEXT_V1 },
          { frameId: 0 },
          callback,
        );
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((messageResponse) => {
            clearTimeout(timeoutId);
            finish({ data: messageResponse, reason: null });
          }).catch(() => {
            clearTimeout(timeoutId);
            finish({ data: null, reason: 'NO_RECEIVER' });
          });
        }
      } catch (_) {
        clearTimeout(timeoutId);
        finish({ data: null, reason: 'SEND_FAILED' });
      }
    });
    const data = response?.data;
    const resolvedUrl = typeof data?.url === 'string' ? data.url : url;
    const documentInstanceId = typeof data?.documentInstanceId === 'string' && data.documentInstanceId
      ? data.documentInstanceId
      : null;
    return {
      status: documentInstanceId ? 'verified' : 'unverifiable',
      reason: documentInstanceId ? null : response?.reason || 'DOCUMENT_IDENTITY_UNVERIFIABLE',
      url: resolvedUrl,
      urlKey: makeUrlKey(resolvedUrl),
      documentInstanceId,
      chromeDocumentId: null,
    };
  } catch (_) {
    return {
      status: 'unverifiable',
      reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE',
      url,
      urlKey: makeUrlKey(url),
      documentInstanceId: null,
      chromeDocumentId: null,
    };
  }
}

export async function claimLifecycleIntent({ tabId, modeId, kind, targetState, source, url = '' } = {}) {
  const documentContext = await resolveDocumentContext(tabId, url);
  if (
    documentContext.status !== 'verified'
    || !documentContext.documentInstanceId
    || !documentContext.chromeDocumentId
  ) {
    const reason = documentContext.reason
      || (!documentContext.chromeDocumentId
        ? 'CHROME_DOCUMENT_ID_UNVERIFIABLE'
        : 'DOCUMENT_IDENTITY_UNVERIFIABLE');
    const error = new Error(reason);
    error.code = reason;
    throw error;
  }
  return lifecycleOperationJournal.claimIntent({
    tabId,
    modeId,
    kind,
    targetState,
    source,
    urlKey: documentContext.urlKey,
    documentInstanceId: documentContext.documentInstanceId,
    chromeDocumentId: documentContext.chromeDocumentId,
  });
}

export async function beginLifecycleIntent(intent) {
  const beforeState = await stateManager.getModeState(intent.tabId, intent.modeId);
  return lifecycleOperationJournal.begin(intent, { beforeState });
}

export function lifecycleStateMetadata(intent) {
  if (!intent?.opId || !Number.isInteger(intent?.generation)) return {};
  return {
    lastLifecycleOpId: intent.opId,
    lastLifecycleGeneration: intent.generation,
  };
}

export async function finishLifecycleIntent(intent, result = {}) {
  if (!intent?.opId) return { ok: false, reason: 'LIFECYCLE_INTENT_MISSING' };
  const tabSlot = await lifecycleOperationJournal.getTabSlot(intent.tabId);
  if (!tabSlot.ok) return { ok: false, reason: 'LIFECYCLE_STORAGE_UNAVAILABLE', error: tabSlot.error };

  const running = tabSlot.slot?.running;
  if (!running || running.opId !== intent.opId || running.generation !== intent.generation) {
    await lifecycleOperationJournal.cancelIntent(intent, lifecycleError(result));
    return { ok: true, cancelled: true };
  }

  if (result?.ok === true) {
    await lifecycleOperationJournal.setPhase(intent, LIFECYCLE_PHASES.POST_COMMIT);
    await lifecycleOperationJournal.complete(intent);
    return { ok: true, committed: true };
  }

  const hasUncleanArtifacts = (running.artifacts || []).some(
    (artifact) => artifact.status !== LIFECYCLE_ARTIFACT_STATUSES.CLEANED,
  );
  if (result?.retryable === true || hasUncleanArtifacts) {
    await lifecycleOperationJournal.setPhase(intent, LIFECYCLE_PHASES.RETRYABLE, {
      lastError: lifecycleError(result),
    });
    return { ok: false, retryable: true, reason: lifecycleError(result) };
  }

  await lifecycleOperationJournal.setPhase(intent, LIFECYCLE_PHASES.ROLLING_BACK, {
    lastError: lifecycleError(result),
  });
  await lifecycleOperationJournal.complete(intent);
  return { ok: true, rolledBack: true };
}

export async function currentLifecycleOwner(tabId) {
  const tabSlot = await lifecycleOperationJournal.getTabSlot(tabId);
  if (!tabSlot.ok) {
    throw new Error(tabSlot.error?.message || 'LIFECYCLE_STORAGE_UNAVAILABLE');
  }
  const running = tabSlot.slot?.running;
  if (!running) return null;
  const current = await lifecycleOperationJournal.isCurrent(running);
  if (!current.ok) throw new Error(current.error?.message || 'LIFECYCLE_STORAGE_UNAVAILABLE');
  if (!current.current) throw new Error('LIFECYCLE_OPERATION_STALE');
  return running;
}

export async function recordLifecycleArtifactBeforeEffect(tabId, artifact) {
  if (instrumentationSuppressionDepth > 0) return null;
  const owner = await currentLifecycleOwner(tabId);
  if (!owner) return null;
  const id = artifact?.id || `${artifact?.kind || 'effect'}:${crypto.randomUUID()}`;
  await lifecycleOperationJournal.planArtifact(owner, { ...artifact, id });
  return { owner, id };
}

export async function runWithoutLifecycleInstrumentation(operation) {
  instrumentationSuppressionDepth += 1;
  try {
    return await operation();
  } finally {
    instrumentationSuppressionDepth = Math.max(0, instrumentationSuppressionDepth - 1);
  }
}

export async function markLifecycleArtifactDone(planned, updates = {}) {
  if (!planned?.owner || !planned?.id) return;
  await lifecycleOperationJournal.markArtifact(
    planned.owner,
    planned.id,
    LIFECYCLE_ARTIFACT_STATUSES.DONE,
    updates,
  );
}

export async function markLifecycleStateCommitted(tabId, modeId, newState, capturedOwner = null) {
  if (![STATES.ACTIVE, STATES.INACTIVE, STATES.ERROR].includes(newState)) return null;
  const owner = capturedOwner || await currentLifecycleOwner(tabId);
  if (!owner || owner.modeId !== modeId) return owner;
  await lifecycleOperationJournal.setPhase(owner, LIFECYCLE_PHASES.STATE_COMMITTED, { committedState: newState });
  return owner;
}
