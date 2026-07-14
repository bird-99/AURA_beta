import { stateManager } from './state-manager.js';
import { autoApplyManager, scorer } from './scorer.js';
import { badgeManager } from './badge-manager.js';
import { decisionHandler } from './decision-handler.js';
import { spaDetector } from './spa-detector.js';
import { cssApplier } from './css-applier.js';
import { cssRegistry } from './css-registry.js';
import {
  ACTIONS,
  MODE_IDS,
  DECISIONS,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  SMARTSCOPE_LEVELS,
  STATES,
  STORAGE_KEYS,
  ZOOM_CONFIG,
} from '../shared/constants.js';
import {
  createError,
  extractDomain,
  getFromLocal,
  getFromSession,
  isValidTabId,
  logError,
  mutateLocalValue,
  mutateSessionValue,
  readSessionValueResult,
  runStorageAreaTransaction,
  setToSession,
  tryOpenPopupOrFallback,
} from '../shared/utils.js';
import { performanceMonitor } from './degraded-manager.js';
import { telemetry } from './telemetry.js';
import { smartScopeDebugger } from './smartscope-debugger.js';
import { initFeatureFlags, isFlagEnabled } from '../shared/feature-flags.js';
import { ensureSpaHooksMainInjected } from './spa-hooks-injector.js';
import { contentBridge } from './content-bridge.js';
import { signalBroker } from './signals/signal-broker.js';
import { buildModeEngineDiagnosticSnapshot, getDebugEvents } from './debug-snapshot.js';
import {
  computeSitePolicy,
  getSiteKeyFromUrl,
  isUnsupportedScheme,
  setSiteOverride,
} from './site-policy-manager.js';
import { createRehydrateManager } from './rehydrate-manager.js';
import {
  runObservedRehydrate,
  scheduleObservedRehydrate,
} from './rehydrate-result-observer.js';
import { createTabRehydrateHandlers } from './rehydrate-tab-events.js';
import {
  FEATURE_FLAGS_REQUEST_TYPE,
  handleGetFeatureFlagsRequest,
} from './feature-flags-bridge.js';
import { handleSharedConstantsRequest } from './shared-constants-bridge.js';
import { getTabRuntime, patchTabRuntime } from './runtime-state.js';
import { modeEngineLog, recordTiming } from '../shared/mode-engine-debug.js';
import { clearPolicyState } from './policy-engine.js';
import { OUTCOME_LEDGER_EVENTS } from '../shared/engine-core/enums.js';
import { recordAcceptedApplyOutcome, recordUserOutcome } from './outcome-ledger.js';
import { learningEngine } from './learning-engine.js';
import {
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from './template-evidence.js';
import { recordTemplateMemoryNegativeOutcome } from './template-memory.js';
import {
  runGlobalLifecycleOperation,
  runTabLifecycleOperation,
} from './tab-lifecycle-coordinator.js';
import { createResetAllDataManager } from './reset-all-data-manager.js';
import { resetAllData as clearAllStoredData } from '../shared/data-portability.js';
import {
  inspectLegacyDomainMigration,
  migrateLegacyDomainData,
} from './legacy-domain-migration.js';
import {
  claimLifecycleIntent,
  currentLifecycleOwner,
  finishLifecycleIntent,
  lifecycleStateMetadata,
  markLifecycleArtifactDone,
  markLifecycleStateCommitted,
  recordLifecycleArtifactBeforeEffect,
} from './lifecycle-controller.js';
import {
  LIFECYCLE_OPERATION_KINDS,
  LIFECYCLE_PHASES,
  lifecycleOperationJournal,
} from './lifecycle-operation-journal.js';
import { recoverLifecycleJournal } from './lifecycle-recovery.js';
import {
  armLifecyclePause,
  getLifecyclePauseState,
  maybePauseLifecycleCheckpoint,
} from './lifecycle-test-hooks.js';

// Initialize performance monitor singleton (global reference used by css-applier)
void performanceMonitor;

console.log('[SW] AURA Service Worker started');

let initPromise;
const LIFECYCLE_RECOVERY_ALARM = 'aura-lifecycle-recovery-v1';

const resetAllDataManager = createResetAllDataManager({
  readTabState: () => readSessionValueResult(STORAGE_KEYS.TAB_STATE),
  readLifecycleJournal: () => lifecycleOperationJournal.read(),
  runGlobalOperation: runGlobalLifecycleOperation,
  removeTarget: removeModeForResetAll,
  clearStorage: clearAllStoredData,
});

async function scheduleLifecycleRecoveryAlarm(recovery) {
  if (!chrome.alarms) return;
  try {
    if (Number.isFinite(recovery?.nextRetryAt)) {
      await chrome.alarms.create(LIFECYCLE_RECOVERY_ALARM, { when: recovery.nextRetryAt });
    } else {
      await chrome.alarms.clear(LIFECYCLE_RECOVERY_ALARM);
    }
  } catch (error) {
    console.warn('[SW] Failed to schedule lifecycle recovery alarm', error);
  }
}

async function runLifecycleRecoveryCycle() {
  const recovery = await recoverLifecycleJournal({
    onDesiredIntent: recoverDesiredLifecycleIntent,
    onCommittedOperation: recoverCommittedLifecyclePostActions,
  });
  await scheduleLifecycleRecoveryAlarm(recovery);
  if (recovery.degraded) {
    console.warn('[SW] Lifecycle recovery completed in degraded mode', {
      retryableCount: recovery.retryableCount,
      quarantinedCount: recovery.quarantinedCount,
      results: recovery.results,
    });
  }
  return recovery;
}

// Initialization must stay lazy to keep MV3 service worker registration synchronous (no TLA).
function initOnce() {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureSessionAccessLevel();
      await initFeatureFlags();
      setupModeEngineTimingInstrumentation();
      const smartScopeConfig = await ensureSmartScopeDefaultsInUserPrefs();

      await runLifecycleRecoveryCycle();

      try {
        const preserveCssIds = await collectReferencedCssIdsFromTabState();
        await cssRegistry.cleanup({ maxAgeMs: 1000 * 60 * 60 * 24, maxEntries: 500, preserveCssIds });
      } catch (error) {
        console.warn('[SW] CssRegistry cleanup failed', error);
      }

      try {
        await spaDetector.init();
      } catch (error) {
        console.warn('[SW] Failed to initialize SPA detector', error);
      }

      try {
        await telemetry.init();
      } catch (error) {
        console.warn('[SW] Failed to initialize telemetry', error);
      }

      smartScopeDebugger.setEnabled(smartScopeConfig?.debugEnabled === true);
      await recoverInterruptedLifecycleOperations();
    })().catch((error) => {
      console.error('[SW] Initialization failed', error);
      throw error;
    });
  }

  return initPromise;
}

async function recoverDesiredLifecycleIntent(intent) {
  if (!intent || !Number.isInteger(intent.tabId) || typeof intent.modeId !== 'string') {
    return { ok: false, reason: 'INVALID_RECOVERED_LIFECYCLE_INTENT' };
  }

  if (intent.kind === LIFECYCLE_OPERATION_KINDS.REMOVE) {
    const result = await runTabLifecycleOperation(
      intent.tabId,
      `recover-durable-remove:${intent.modeId}`,
      () => handleRestoreModeRequest(intent.tabId, intent.modeId, intent),
    );
    await finishLifecycleIntent(intent, result || { ok: false, reason: 'RECOVERED_REMOVE_FAILED' });
    return result || { ok: false, reason: 'RECOVERED_REMOVE_FAILED' };
  }

  if (intent.kind === LIFECYCLE_OPERATION_KINDS.REHYDRATE || intent.recoveryReplay === true) {
    return runTabLifecycleOperation(
      intent.tabId,
      `recover-durable-rehydrate:${intent.modeId}`,
      () => rehydrateActiveModesForTab(intent.tabId, 'lifecycle-recovery'),
    );
  }

  await stateManager.updateTabModeState(intent.tabId, intent.modeId, {
    state: STATES.ERROR,
    pendingDecision: false,
    activeQuality: null,
  });
  await finishLifecycleIntent(intent, { ok: false, reason: 'INTERRUPTED_APPLY_BEFORE_START' });
  return { ok: true, cancelled: true, reason: 'INTERRUPTED_APPLY_BEFORE_START' };
}

async function recoverCommittedLifecyclePostActions(operation) {
  let tab;
  try {
    tab = await chrome.tabs.get(operation.tabId);
  } catch (_) {
    return { ok: true, skipped: true, reason: 'TAB_CLOSED' };
  }
  const siteKey = extractDomain(tab?.url || '');

  if (operation.kind === LIFECYCLE_OPERATION_KINDS.APPLY) {
    await recordAcceptedApplyOutcome({
      siteKey,
      modeId: operation.modeId,
      attemptId: operation.opId,
    });
    await decisionHandler.recordDecision(siteKey, operation.modeId, DECISIONS.ENABLED, {
      committedAt: Date.now(),
      lifecycleOperationId: operation.opId,
    });
    try {
      await chrome.tabs.sendMessage(operation.tabId, {
        action: ACTIONS.INJECT_RESTORE_BUTTON,
        modeId: operation.modeId,
      }, { frameId: 0 });
    } catch (_) {
      // The state is committed; the content-ready path can restore the control later.
    }
  } else if (operation.kind === LIFECYCLE_OPERATION_KINDS.REMOVE) {
    if (operation.source !== 'reset-all-data') {
      await recordUserOutcome({
        siteKey,
        modeId: operation.modeId,
        event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
        attemptId: operation.opId,
      });
      await learningEngine.applyDecision(siteKey, operation.modeId, DECISIONS.NOT_NOW, {
        effectId: `${operation.opId}:learning:not-now`,
      });
    }
    try {
      await chrome.tabs.sendMessage(operation.tabId, {
        action: ACTIONS.REMOVE_RESTORE_BUTTON,
        modeId: operation.modeId,
      }, { frameId: 0 });
    } catch (_) {
      // Removing a missing control is already converged.
    }
  }

  await badgeManager.refresh();
  return { ok: true };
}

async function recoverInterruptedLifecycleOperations() {
  const pending = await stateManager.getAllPendingDecisions();
  for (const { tabId, modeId } of pending) {
    const modeState = await stateManager.getModeState(tabId, modeId);
    if (modeState?.state === STATES.SUGGESTED) continue;
    const lifecycleSlot = await lifecycleOperationJournal.getTabSlot(tabId);
    if (lifecycleSlot.ok && lifecycleSlot.slot?.running?.phase === LIFECYCLE_PHASES.QUARANTINED) {
      console.warn('[SW] Skipping legacy recovery for quarantined lifecycle operation', { tabId, modeId });
      continue;
    }

    try {
      await runTabLifecycleOperation(tabId, `recover-interrupted-restore:${modeId}`, async () => {
        const latest = await stateManager.getModeState(tabId, modeId);
        if (latest?.pendingDecision !== true || latest?.state === STATES.SUGGESTED) return;
        const result = await handleRestoreModeRequest(tabId, modeId);
        if (result?.ok !== true) {
          console.warn('[SW] Interrupted lifecycle recovery remains retryable', { tabId, modeId, result });
        }
      });
    } catch (error) {
      console.warn('[SW] Interrupted lifecycle recovery isolated', { tabId, modeId, error });
    }
  }
}

function addCssId(target, value) {
  if (typeof value === 'string' && value.trim()) {
    target.add(value);
  }
}

async function collectReferencedCssIdsFromTabState() {
  const ids = new Set();
  try {
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    for (const modes of Object.values(tabState || {})) {
      for (const modeState of Object.values(modes || {})) {
        addCssId(ids, modeState?.cssId);
        addCssId(ids, modeState?.smartScope?.cssId);
        addCssId(ids, modeState?.smartScope?.baseCssId);
        addCssId(ids, modeState?.smartScope?.patchCssId);
        addCssId(ids, modeState?.scopedV2?.cssId);
        addCssId(ids, modeState?.scopedV2?.transitionCssId);
        addCssId(ids, modeState?.scopedV2?.preludeCssId);
      }
    }
  } catch (error) {
    console.warn('[SW] Failed to collect active CSS registry references', error);
  }
  return Array.from(ids);
}

function ensureInitInHandler(handlerName, fn, { onError } = {}) {
  (async () => {
    try {
      await initOnce();
      await fn();
    } catch (error) {
      console.error(`[SW] ${handlerName} handler failed`, error);
      if (typeof onError === 'function') {
        onError(error);
      }
    }
  })();
}

const SMARTSCOPE_DEFAULT_CONFIG = {
  enabled: true,
  level: SMARTSCOPE_LEVELS.CONSERVATIVE,
  perDomain: {},
  debugEnabled: false,
};

const DEFAULT_TEST_CONFIDENCE = 0.75;
const SITE_OVERRIDE_DEFAULT_MS = 5 * 60 * 1000;
const SITE_OVERRIDE_MIN_MS = 60 * 1000;
const SITE_OVERRIDE_MAX_MS = 60 * 60 * 1000;
const CONTRAST_REPORT_MIN_RATIO = 4.5;
const MODE_ENGINE_TIMING_STEPS = Object.freeze({
  NAV_START: 'nav_start',
  PRELUDE_INJECTED: 'prelude_injected',
  FINAL_CSS_INJECTED: 'final_css_injected',
  TOKENS_APPLIED: 'tokens_applied',
  PRELUDE_REMOVED: 'prelude_removed',
});
const MODE_ENGINE_TIMING_EDGES = [
  { name: 'nav_to_prelude', from: MODE_ENGINE_TIMING_STEPS.NAV_START, to: MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED },
  { name: 'prelude_to_final_css', from: MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED, to: MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED },
  { name: 'final_css_to_tokens', from: MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED, to: MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED },
  { name: 'tokens_to_prelude_removed', from: MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED, to: MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED },
];

let modeEngineTimingInstrumented = false;

function isModeEngineDebugEnabled() {
  return isFlagEnabled('debugModeEngine');
}

async function resolveTabIdForDebug(sender, message) {
  const requestedTabId = isValidTabId(message?.tabId)
    ? message.tabId
    : isValidTabId(sender?.tab?.id)
      ? sender.tab.id
      : null;
  if (!requestedTabId) {
    return { ok: false, error: 'DEBUG_TARGET_REQUIRED' };
  }
  try {
    const tab = await chrome.tabs.get(requestedTabId);
    if (!/^https?:\/\//i.test(tab?.url || '')) {
      return { ok: false, error: 'DEBUG_TARGET_UNSUPPORTED' };
    }
    return { ok: true, tabId: requestedTabId };
  } catch (error) {
    return { ok: false, error: 'DEBUG_TARGET_UNAVAILABLE' };
  }
}

function normalizeModeEngineTimingState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const steps = raw.steps && typeof raw.steps === 'object' && !Array.isArray(raw.steps) ? raw.steps : {};

  return {
    sequenceId: typeof raw.sequenceId === 'number' ? raw.sequenceId : null,
    activeModeId: typeof raw.activeModeId === 'string' ? raw.activeModeId : null,
    activeSource: typeof raw.activeSource === 'string' ? raw.activeSource : null,
    steps,
  };
}

async function recordModeEngineTiming(tabId, step, context = {}) {
  if (!isValidTabId(tabId)) {
    return;
  }
  if (!isModeEngineDebugEnabled()) {
    return;
  }

  const timestamp = Date.now();
  const runtime = await getTabRuntime(tabId);
  const timing = normalizeModeEngineTimingState(runtime?.modeEngineTiming);
  const isNavStart = step === MODE_ENGINE_TIMING_STEPS.NAV_START;
  const shouldClearActive = isNavStart || step === MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED;
  const sequenceId = isNavStart || !timing.sequenceId ? timestamp : timing.sequenceId;
  const activeModeId = context.modeId || timing.activeModeId || null;
  const activeSource = context.source || timing.activeSource || null;
  const entry = {
    ts: timestamp,
    reason: context.reason || null,
    modeId: activeModeId,
    source: activeSource,
  };
  const baseSteps = isNavStart ? {} : timing.steps || {};
  const nextTiming = {
    sequenceId,
    activeModeId: shouldClearActive ? undefined : activeModeId || undefined,
    activeSource: shouldClearActive ? undefined : activeSource || undefined,
    steps: {
      ...baseSteps,
      [step]: entry,
    },
  };

  await patchTabRuntime(tabId, { modeEngineTiming: nextTiming });

  modeEngineLog('Timing marker', { tabId, step, sequenceId, ...entry });

  const existingSteps = baseSteps;
  for (const edge of MODE_ENGINE_TIMING_EDGES) {
    if (edge.to !== step) {
      continue;
    }
    const startEntry = existingSteps[edge.from];
    if (!startEntry?.ts) {
      continue;
    }
    recordTiming(`modeengine.timeline.${edge.name}`, timestamp - startEntry.ts, {
      tabId,
      modeId: activeModeId || undefined,
      source: activeSource || undefined,
      sequenceId,
    });
  }
}

function isModeEngineCssPayload(cssText = '') {
  if (typeof cssText !== 'string') {
    return false;
  }
  return cssText.includes('--aura-me2-css') || cssText.includes('--aura-me2-path');
}

function setupModeEngineTimingInstrumentation() {
  if (modeEngineTimingInstrumented) {
    return;
  }
  modeEngineTimingInstrumented = true;

  const originalApplyMode = cssApplier.applyMode.bind(cssApplier);
  cssApplier.applyMode = async (tabId, modeId, params, source) => {
    await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.PRELUDE_INJECTED, {
      modeId,
      source,
      reason: source || 'apply',
    });
    return originalApplyMode(tabId, modeId, params, source);
  };

  const originalSafeSend = contentBridge.safeSend.bind(contentBridge);
  contentBridge.safeSend = async (tabId, message, options = {}) => {
    let lifecycleArtifact = null;
    if (message && typeof message.action === 'string') {
      if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
        lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(tabId, {
          kind: 'SCOPE_TOKENS',
          effect: { action: message.action, frameId: options?.frameId ?? 0 },
          cleanup: {
            action: ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS,
            frameId: options?.frameId ?? 0,
            ownerKey: message.ownerKey,
            ownedKeys: Array.isArray(message.ownedKeys)
              ? message.ownedKeys
              : Object.keys(message.tokenMap || {}),
          },
        });
      } else if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
        lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(tabId, {
          kind: 'SCOPE_TOKEN_CLEANUP',
          effect: { ...message, frameId: options?.frameId ?? 0 },
          cleanup: { ...message, frameId: options?.frameId ?? 0 },
        });
      } else if (message.action === ACTIONS.PAGE_CLARITY_MARK_TARGET_V1) {
        lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(tabId, {
          kind: 'PAGE_CLARITY_TARGET',
          effect: { ...message, frameId: options?.frameId ?? message.frameId ?? 0 },
          cleanup: {
            action: ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1,
            frameId: options?.frameId ?? message.frameId ?? 0,
          },
        });
      }
    }
    const result = await originalSafeSend(tabId, message, options);
    if (lifecycleArtifact && result?.ok) {
      await markLifecycleArtifactDone(lifecycleArtifact);
      const checkpoint = message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS
        ? 'TOKENS_DONE'
        : null;
      if (checkpoint) await maybePauseLifecycleCheckpoint(tabId, checkpoint);
    }
    if (!message || typeof message.action !== 'string') {
      return result;
    }

    if (result?.ok) {
      if (message.action === ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.TOKENS_APPLIED, {
          reason: 'apply_scope_tokens',
        });
      } else if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.PRELUDE_REMOVED, {
          reason: 'cleanup_scope_tokens',
        });
      }
    }

    return result;
  };

  if (chrome?.scripting?.insertCSS) {
    const originalInsertCSS = chrome.scripting.insertCSS.bind(chrome.scripting);
    chrome.scripting.insertCSS = async (details) => {
      const lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(details?.target?.tabId, {
        kind: 'CSS_INSERT',
        effect: {
          target: details?.target || null,
          cssText: details?.css || '',
          origin: details?.origin || 'AUTHOR',
        },
        cleanup: {
          action: 'REMOVE_CSS',
          target: details?.target || null,
          cssText: details?.css || '',
          origin: details?.origin || 'AUTHOR',
        },
      });
      const result = await originalInsertCSS(details);
      await markLifecycleArtifactDone(lifecycleArtifact);
      await maybePauseLifecycleCheckpoint(details?.target?.tabId, 'CSS_INSERT_DONE');
      const tabId = details?.target?.tabId;
      const cssText = details?.css;
      if (isValidTabId(tabId) && isModeEngineCssPayload(cssText)) {
        await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.FINAL_CSS_INJECTED, {
          reason: 'insert_css',
        });
      }
      return result;
    };
  }

  if (chrome?.scripting?.removeCSS) {
    const originalRemoveCSS = chrome.scripting.removeCSS.bind(chrome.scripting);
    chrome.scripting.removeCSS = async (details) => {
      const lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(details?.target?.tabId, {
        kind: 'CSS_REMOVE',
        effect: {
          target: details?.target || null,
          cssText: details?.css || '',
          origin: details?.origin || 'AUTHOR',
        },
        cleanup: {
          action: 'REMOVE_CSS',
          target: details?.target || null,
          cssText: details?.css || '',
          origin: details?.origin || 'AUTHOR',
        },
      });
      const result = await originalRemoveCSS(details);
      await markLifecycleArtifactDone(lifecycleArtifact);
      await maybePauseLifecycleCheckpoint(details?.target?.tabId, 'CSS_REMOVE_DONE');
      return result;
    };
  }

  const originalUpdateModeState = stateManager.updateModeState.bind(stateManager);
  stateManager.updateModeState = async (tabId, modeId, newState, metadata = {}) => {
    let owner = null;
    try {
      const candidate = await currentLifecycleOwner(tabId);
      owner = candidate?.modeId === modeId ? candidate : null;
    } catch (error) {
      if (error?.message === 'LIFECYCLE_OPERATION_STALE') throw error;
      console.warn('[SW] Lifecycle state checkpoint unavailable', error);
    }
    const result = await originalUpdateModeState(tabId, modeId, newState, {
      ...metadata,
      ...lifecycleStateMetadata(owner),
    });
    if (owner) {
      await markLifecycleStateCommitted(tabId, modeId, newState, owner);
      await maybePauseLifecycleCheckpoint(tabId, 'STATE_COMMITTED');
    }
    return result;
  };

  const originalRegistryRegister = cssRegistry.register.bind(cssRegistry);
  cssRegistry.register = async (cssText, origin, meta, options = {}) => {
    const cssId = typeof options?.cssId === 'string' && options.cssId
      ? options.cssId
      : `aura-css-${Date.now()}-${crypto.randomUUID()}`;
    const lifecycleArtifact = await recordLifecycleArtifactBeforeEffect(meta?.tabId, {
      kind: 'REGISTRY_ADD',
      effect: { cssId, modeId: meta?.modeId || null },
      cleanup: { action: 'REMOVE_REGISTRY', cssId },
    });
    const result = await originalRegistryRegister(cssText, origin, meta, { ...options, cssId });
    await markLifecycleArtifactDone(lifecycleArtifact, { cssId: result?.cssId || cssId });
    await maybePauseLifecycleCheckpoint(meta?.tabId, 'REGISTRY_DONE');
    return result;
  };

  const originalRegistryRemove = cssRegistry.remove.bind(cssRegistry);
  cssRegistry.remove = async (cssId) => {
    let tabId = null;
    try {
      const entry = await cssRegistry.get(cssId);
      tabId = entry?.meta?.tabId ?? null;
    } catch (_) {
      // Registry removal remains authoritative even when metadata lookup fails.
    }
    const lifecycleArtifact = Number.isInteger(tabId)
      ? await recordLifecycleArtifactBeforeEffect(tabId, {
          kind: 'REGISTRY_REMOVE',
          effect: { cssId },
          cleanup: { action: 'REMOVE_REGISTRY', cssId },
        })
      : null;
    const result = await originalRegistryRemove(cssId);
    await markLifecycleArtifactDone(lifecycleArtifact);
    return result;
  };
}

function normalizeSmartScopeConfig(raw = {}) {
  const level = Object.values(SMARTSCOPE_LEVELS).includes(raw.level)
    ? raw.level
    : SMARTSCOPE_LEVELS.CONSERVATIVE;

  const normalizedPerDomain = {};
  if (raw.perDomain && typeof raw.perDomain === 'object' && !Array.isArray(raw.perDomain)) {
    for (const [domain, cfg] of Object.entries(raw.perDomain)) {
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
      const domainLevel = Object.values(SMARTSCOPE_LEVELS).includes(cfg.level)
        ? cfg.level
        : level;
      normalizedPerDomain[domain] = {
        enabled: cfg.enabled === true,
        level: domainLevel,
      };
    }
  }

  return {
    enabled: raw.enabled !== false,
    level,
    perDomain: normalizedPerDomain,
    debugEnabled: raw.debugEnabled === true,
  };
}

async function ensureSmartScopeDefaultsInUserPrefs() {
  try {
    let normalized = SMARTSCOPE_DEFAULT_CONFIG;
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
      const prefs = storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {};
      normalized = normalizeSmartScopeConfig(prefs.smartScope || SMARTSCOPE_DEFAULT_CONFIG);
      return { ...prefs, smartScope: normalized };
    });

    smartScopeDebugger.setEnabled(normalized.debugEnabled === true);

    return normalized;
  } catch (error) {
    console.warn('[SW] Failed to ensure SmartScope defaults:', error);
    return SMARTSCOPE_DEFAULT_CONFIG;
  }
}

async function ensureUserPrefsDefaultsOnInstall() {
  try {
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => (
      storedPrefs && typeof storedPrefs === 'object'
        ? storedPrefs
        : { focusDefaultEnabled: false }
    ));
  } catch (error) {
    console.warn('[SW] Failed to ensure user prefs defaults on install:', error);
  }
}

async function setSmartScopeConfig(next = {}) {
  try {
    let updated = null;
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
      const prefs = storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {};
      updated = { ...normalizeSmartScopeConfig(prefs.smartScope || SMARTSCOPE_DEFAULT_CONFIG) };
      if (typeof next.enabled === 'boolean') updated.enabled = next.enabled;
      if (next.level && Object.values(SMARTSCOPE_LEVELS).includes(next.level)) updated.level = next.level;
      if (typeof next.debugEnabled === 'boolean') updated.debugEnabled = next.debugEnabled;
      if ('perDomain' in next) {
        if (next.perDomain && typeof next.perDomain === 'object' && !Array.isArray(next.perDomain)) {
          const normalizedPerDomain = {};
          for (const [domain, cfg] of Object.entries(next.perDomain)) {
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
            normalizedPerDomain[domain] = {
              enabled: cfg.enabled === true,
              level: Object.values(SMARTSCOPE_LEVELS).includes(cfg.level) ? cfg.level : updated.level,
            };
          }
          updated.perDomain = normalizedPerDomain;
        } else {
          updated.perDomain = {};
        }
      }
      return { ...prefs, smartScope: updated };
    });

    smartScopeDebugger.setEnabled(updated.debugEnabled === true);

    return { ok: true };
  } catch (error) {
    console.error('[SW] Failed to set SmartScope config:', error);
    return { ok: false, error: error?.message || 'SMARTSCOPE_CONFIG_FAILED' };
  }
}

async function clearSmartScopeSessionState() {
  const errors = [];

  try {
    await runStorageAreaTransaction('session', async () => {
      const sessionData = await chrome.storage.session.get(null);
      const removalKeys = Object.keys(sessionData || {}).filter(
        (key) => key.startsWith('smartscope_') || key === STORAGE_KEYS.CSS_REGISTRY,
      );
      if (removalKeys.length) await chrome.storage.session.remove(removalKeys);
    });
  } catch (error) {
    errors.push(error?.message || 'SESSION_CLEANUP_FAILED');
  }

  try {
    const tabState = (await getFromSession(STORAGE_KEYS.TAB_STATE)) || {};
    let mutated = false;
    for (const [tabId, modes] of Object.entries(tabState)) {
      const parsedTabId = Number.parseInt(tabId, 10);
      if (Number.isNaN(parsedTabId)) {
        continue;
      }
      for (const [modeId, modeState] of Object.entries(modes || {})) {
        if (modeState?.smartScope) {
          await stateManager.updateTabModeState(parsedTabId, modeId, { smartScope: null });
          mutated = true;
        }
      }
    }
    if (mutated) {
      console.debug('[SW] Cleared smartScope state from session tabState');
    }
  } catch (error) {
    errors.push(error?.message || 'TABSTATE_CLEANUP_FAILED');
  }

  return errors;
}

async function resetSmartScopeEverywhere() {
  const result = { ok: true, cleanedTabs: 0, errors: [] };

  try {
    await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => ({
      ...(storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {}),
      smartScope: { ...SMARTSCOPE_DEFAULT_CONFIG, perDomain: {} },
    }));
  } catch (error) {
    result.errors.push(error?.message || 'PREF_RESET_FAILED');
  }

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (error) {
    result.errors.push(error?.message || 'TAB_QUERY_FAILED');
  }

  for (const tab of tabs) {
    const tabId = tab?.id;
    if (!tabId) continue;

    const siteKey = tab?.url ? extractDomain(tab.url) : 'unknown';
    let tabCleaned = true;

    try {
      for (const modeId of Object.values(MODE_IDS)) {
        if (!tabCleaned) {
          continue;
        }

        let removalFailed = false;
        try {
          const removal = await cssApplier.removeMode(tabId, modeId, siteKey, { trackRestore: false });
          if (removal?.ok === false) {
            removalFailed = true;
            tabCleaned = false;
            result.ok = false;
            result.errors.push(removal.error || removal.reason || `REMOVE_FAILED_${modeId}`);
          }
        } catch (removeError) {
          removalFailed = true;
          tabCleaned = false;
          result.ok = false;
          result.errors.push(removeError?.message || `REMOVE_FAILED_${modeId}`);
        }

        if (removalFailed) {
          continue;
        }

        try {
          await chrome.tabs.sendMessage(tabId, { action: SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP });
        } catch (cleanupError) {
          console.warn('[SW] Emergency cleanup failed', cleanupError);
        }

        try {
          await stateManager.setSmartScope(tabId, modeId, null);
          await stateManager.removeSmartScopeToken(tabId, modeId);
          await stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, { pendingDecision: false });
        } catch (stateError) {
          result.errors.push(stateError?.message || `STATE_RESET_FAILED_${modeId}`);
        }
      }
      if (tabCleaned) {
        result.cleanedTabs += 1;
      }
    } catch (error) {
      result.ok = false;
      result.errors.push(error?.message || `TAB_CLEAN_FAILED_${tabId}`);
    }
  }

  if (result.ok) {
    const sessionErrors = await clearSmartScopeSessionState();
    if (sessionErrors.length) {
      result.ok = false;
      result.errors.push(...sessionErrors);
    }
  }

  return result;
}

async function ensureSessionAccessLevel() {
  if (chrome.storage?.session?.setAccessLevel) {
    try {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch (error) {
      console.warn('[SW] Unable to set session access level:', error);
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureInitInHandler('onInstalled', async () => {
    console.log('[SW] Extension installed/updated:', details.reason);

    if (details.reason === 'install') {
      const url = chrome.runtime.getURL('welcome/welcome.html');
      await chrome.tabs.create({ url });
      await ensureUserPrefsDefaultsOnInstall();
    }

    await telemetry.init();
    await spaDetector.init();
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureInitInHandler('onStartup', async () => {
    console.log('[SW] Browser started, Service Worker initializing');
    await telemetry.init();
    await spaDetector.init();
  });
});

async function clearClosedTabData(tabId, reason) {
  return runTabLifecycleOperation(tabId, `tab-disposed:${reason}`, async () => {
    const failures = [];
    for (const cleanup of [
      () => lifecycleOperationJournal.clearTab(tabId),
      () => removeZoomHistory(tabId),
      () => clearContrastGuardState(tabId),
      () => clearPolicyState(tabId),
      () => stateManager.clearTab(tabId),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      console.warn('[SW] Tab disposal completed with failures', { tabId, reason, failures });
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('[SW] Tab closed:', tabId);
  clearClosedTabData(tabId, 'removed').catch((error) => {
    console.warn('[SW] Failed to dispose removed tab', { tabId, error });
  });
});

if (chrome.tabs.onReplaced?.addListener) {
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    clearClosedTabData(removedTabId, 'replaced').catch((error) => {
      console.warn('[SW] Failed to dispose replaced tab', { removedTabId, error });
    });
    ensureInitInHandler('onReplaced', async () => {
      maybeEnsureSpaHooksMainInjected(addedTabId);
      scheduleObservedRehydrate(rehydrateActiveModesForTab, addedTabId, 'tab-replaced', {
        source: 'tab-replaced',
      });
    });
  });
}

if (chrome.alarms?.onAlarm?.addListener) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== LIFECYCLE_RECOVERY_ALARM) return;
    ensureInitInHandler('lifecycleRecoveryAlarm', async () => {
      await runLifecycleRecoveryCycle();
    });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  ensureInitInHandler('onUpdated', async () => {
    if (changeInfo?.status === 'loading') {
      await recordModeEngineTiming(tabId, MODE_ENGINE_TIMING_STEPS.NAV_START, {
        reason: 'loading',
      });
    }
    await handleTabUpdated(tabId, changeInfo, tab);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureInitInHandler('onActivated', async () => {
    await handleTabActivated(activeInfo);
  });
});

// ========== ZOOM DETECTION ==========

async function getZoomHistory(tabId) {
  const zoomHistory = (await getFromSession(STORAGE_KEYS.ZOOM_HISTORY)) || {};
  return zoomHistory[tabId] || [];
}

async function saveZoomHistory(tabId, history) {
  await mutateSessionValue(STORAGE_KEYS.ZOOM_HISTORY, (storedHistory) => ({
    ...(storedHistory && typeof storedHistory === 'object' ? storedHistory : {}),
    [tabId]: history,
  }));
}

async function removeZoomHistory(tabId) {
  await mutateSessionValue(STORAGE_KEYS.ZOOM_HISTORY, (storedHistory) => {
    const zoomHistory = storedHistory && typeof storedHistory === 'object' ? { ...storedHistory } : {};
    delete zoomHistory[tabId];
    return zoomHistory;
  });
}

async function getSiteKeyFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url ? extractDomain(tab.url) : 'unknown';
  } catch (error) {
    console.warn('[SW] Unable to resolve siteKey for tab', tabId, error);
    return 'unknown';
  }
}

async function getContrastGuardState(tabId, modeId) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? runtime.contrastGuard
    : {};
  const modeState = contrastGuard?.[modeId];
  return modeState && typeof modeState === 'object' ? modeState : {};
}

async function updateContrastGuardState(tabId, modeId, updates) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? runtime.contrastGuard
    : {};
  const current = contrastGuard?.[modeId] && typeof contrastGuard[modeId] === 'object'
    ? contrastGuard[modeId]
    : {};

  const nextModeState = { ...current, ...(updates || {}) };
  const nextContrastGuard = { ...contrastGuard, [modeId]: nextModeState };
  await patchTabRuntime(tabId, { contrastGuard: nextContrastGuard });
  return nextModeState;
}

async function clearContrastGuardState(tabId, modeId) {
  const runtime = await getTabRuntime(tabId);
  const contrastGuard = runtime?.contrastGuard && typeof runtime.contrastGuard === 'object'
    ? { ...runtime.contrastGuard }
    : {};

  if (modeId) {
    delete contrastGuard[modeId];
  }

  const hasEntries = Object.keys(contrastGuard).length > 0;
  await patchTabRuntime(tabId, { contrastGuard: hasEntries ? contrastGuard : undefined });
}

async function disableDarkModeForSite(tabId, modeId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return { ok: false, reason: 'TAB_LOOKUP_FAILED' };
  }

  const siteKey = tab?.url ? extractDomain(tab.url) : null;
  if (!siteKey || siteKey === 'unknown') {
    return { ok: false, reason: 'SITE_KEY_MISSING' };
  }

  await mutateLocalValue(STORAGE_KEYS.PER_DOMAIN_PREFS, (storedPrefs) => {
    const perDomainPrefs = storedPrefs && typeof storedPrefs === 'object' ? { ...storedPrefs } : {};
    const sitePrefs = { ...(perDomainPrefs[siteKey] || {}) };
    sitePrefs[modeId] = {
      ...(sitePrefs[modeId] || {}),
      darkMode: false,
      timestamp: Date.now(),
    };
    perDomainPrefs[siteKey] = sitePrefs;
    return perDomainPrefs;
  });
  return { ok: true, siteKey };
}

async function handleContrastReport(tabId, modeId, report) {
  if (!isValidTabId(tabId)) {
    return { ok: false, reason: 'INVALID_TAB_ID' };
  }

  if (modeId !== MODE_IDS.COMFORT_VISUAL) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  if (!report || typeof report.minRatio !== 'number') {
    return { ok: false, reason: 'INVALID_REPORT' };
  }

  if (report.ok === true || report.minRatio >= CONTRAST_REPORT_MIN_RATIO) {
    await clearContrastGuardState(tabId, modeId);
    return { ok: true, action: 'ok' };
  }

  const guardState = await getContrastGuardState(tabId, modeId);
  if (!guardState?.retried) {
    await updateContrastGuardState(tabId, modeId, {
      retried: true,
      retryActive: true,
      lastReportAt: Date.now(),
    });
    scheduleObservedRehydrate(rehydrateActiveModesForTab, tabId, 'contrast-guard-retry', {
      source: 'contrast-guard',
    });
    return { ok: true, action: 'retry' };
  }

  await updateContrastGuardState(tabId, modeId, {
    retried: true,
    retryActive: false,
    lastReportAt: Date.now(),
  });

  if (report.isDark === false) {
    return { ok: true, action: 'no-dark-mode' };
  }

  const disabled = await disableDarkModeForSite(tabId, modeId);
  await updateContrastGuardState(tabId, modeId, {
    retried: true,
    retryActive: false,
    disabled: disabled.ok === true,
    lastReportAt: Date.now(),
  });
  scheduleObservedRehydrate(rehydrateActiveModesForTab, tabId, 'contrast-guard-disable-dark', {
    source: 'contrast-guard',
  });
  return { ok: disabled.ok === true, action: 'disable-dark', siteKey: disabled.siteKey || null };
}

function generateToken() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `smartscope-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function patchSmartScope(tabId, modeId, patch) {
  const existing = (await stateManager.getSmartScope(tabId, modeId)) || {};
  await stateManager.setSmartScope(tabId, modeId, { ...existing, ...patch });
}

async function recordSmartScopeStatus(tabId, modeId, action, result = {}) {
  const status = {
    action,
    ok: result?.ok !== false,
    error: result?.error || null,
    timestamp: Date.now(),
  };

  await stateManager.setSmartScopeStatus(tabId, modeId, status);
}

async function smartScopeApplyDomClasses(tabId, modeId, ops = []) {
  const token = generateToken();
  let response;

  const recordResult = async (result) => {
    await recordSmartScopeStatus(tabId, modeId, 'apply', result);
  };

  try {
    response = await chrome.tabs.sendMessage(tabId, {
      action: SMARTSCOPE_ACTIONS.APPLY_CLASSES,
      token,
      operations: ops,
    });
  } catch (error) {
    const fallback = { ok: false, error: error?.message || 'APPLY_FAILED' };
    await recordResult(fallback);
    return fallback;
  }

  if (response?.ok) {
    const now = Date.now();
    await stateManager.setSmartScopeToken(tabId, modeId, {
      token,
      appliedClasses: response.applied || [],
      createdAt: now,
    });

    await patchSmartScope(tabId, modeId, {
      domClassToken: token,
      appliedClasses: response.applied || [],
      appliedAt: now,
    });

    await recordResult({ ok: true });

    return { ok: true, token, appliedClasses: response.applied };
  }

  const errorMessage = response?.errors?.[0]?.error || response?.error || 'APPLY_FAILED';
  const result = { ok: false, error: errorMessage };
  await recordResult(result);
  return result;
}

async function smartScopeRemoveDomToken(tabId, modeId) {
  const entry = await stateManager.getSmartScopeToken(tabId, modeId);
  let removed = 0;

  if (entry?.token) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: SMARTSCOPE_ACTIONS.REMOVE_TOKEN,
        token: entry.token,
      });
      removed = response?.removed || 0;
    } catch (error) {
      console.warn('[SW] Failed to remove DOM token, attempting emergency cleanup', error);
      try {
        const emergencyResponse = await chrome.tabs.sendMessage(tabId, {
          action: SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP,
        });
        removed = emergencyResponse?.removed || removed;
      } catch (cleanupError) {
        console.warn('[SW] Emergency cleanup failed', cleanupError);
      }
    }
  }

  await stateManager.removeSmartScopeToken(tabId, modeId);
  await patchSmartScope(tabId, modeId, {
    domClassToken: null,
    appliedClasses: [],
    appliedAt: null,
  });

  const result = { ok: true, removed };
  await recordSmartScopeStatus(tabId, modeId, 'restore', result);
  return result;
}

const { rehydrateActiveModesForTab: runRehydrateActiveModesForTab } = createRehydrateManager({
  modeIds: MODE_IDS,
  stateManager,
  cssApplier,
  isValidTabId,
  tabsApi: chrome.tabs,
  states: STATES,
});
const navigationRehydrateInFlight = new Map();

function navigationRehydrateKey(tabId, reason, context) {
  if (!['spa', 'tab-complete'].includes(reason) || typeof context?.url !== 'string') {
    return null;
  }
  const url = context.url.trim();
  return url ? `${tabId}:${url}` : null;
}

function rehydrateActiveModesForTab(tabId, reason = 'rehydrate', context = {}) {
  const navigationKey = navigationRehydrateKey(tabId, reason, context);
  if (navigationKey && navigationRehydrateInFlight.has(navigationKey)) {
    return navigationRehydrateInFlight.get(navigationKey);
  }

  const operation = runTabLifecycleOperation(
    tabId,
    `rehydrate:${reason}`,
    () => runRehydrateActiveModesForTab(tabId, reason, context),
  );
  if (navigationKey) {
    navigationRehydrateInFlight.set(navigationKey, operation);
    const release = () => {
      if (navigationRehydrateInFlight.get(navigationKey) === operation) {
        navigationRehydrateInFlight.delete(navigationKey);
      }
    };
    operation.then(release, release);
  }
  return operation;
}

spaDetector.setReapplyHandler((tabId, reason, context) =>
  runObservedRehydrate(
    (resolvedTabId, resolvedReason) => rehydrateActiveModesForTab(resolvedTabId, resolvedReason, context),
    tabId,
    reason,
    { source: 'spa-detector' },
  ),
);

const { handleTabActivated, handleTabUpdated } = createTabRehydrateHandlers({
  cssApplier,
  stateManager,
  rehydrateActiveModesForTab,
  isUnsupportedScheme,
  isValidTabId,
  onTabReady: ({ tabId, url }) => runTabLifecycleOperation(tabId, 'tab-ready:auto-apply', async () => {
    await autoApplyManager.applyProfileOverrides(tabId, url);
    await autoApplyManager.evaluateFocusDefault(tabId, url);
  }),
  states: STATES,
  tabsApi: chrome.tabs,
});

function maybeEnsureSpaHooksMainInjected(tabId) {
  if (!isValidTabId(tabId)) {
    return;
  }

  ensureSpaHooksMainInjected(tabId).catch((error) => {
    console.warn('[SW] Failed to ensure SPA hooks runtime', error);
  });
}

async function rehydrateActiveModesForActiveTabs(reason) {
  const activeTabIds = new Set();

  for (const modeId of Object.values(MODE_IDS)) {
    try {
      const tabs = await stateManager.getTabsWithActiveMode(modeId);
      tabs.forEach((tabId) => activeTabIds.add(tabId));
    } catch (error) {
      console.warn('[SW] Failed to collect active tabs for mode', modeId, error);
    }
  }

  for (const tabId of activeTabIds) {
    await runObservedRehydrate(rehydrateActiveModesForTab, tabId, reason, { source: 'active-tabs' });
  }
}

function isRestrictedUrl(url) {
  return isUnsupportedScheme(url);
}

function normalizeTestConfidence(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : DEFAULT_TEST_CONFIDENCE;
}

function normalizeOverrideDuration(rawValue) {
  const duration = Number(rawValue);
  if (!Number.isFinite(duration)) {
    return SITE_OVERRIDE_DEFAULT_MS;
  }
  return Math.min(Math.max(duration, SITE_OVERRIDE_MIN_MS), SITE_OVERRIDE_MAX_MS);
}

async function resolveUrlFromMessage(sender, message) {
  if (typeof message?.url === 'string' && message.url) {
    return message.url;
  }

  if (typeof sender?.tab?.url === 'string' && sender.tab.url) {
    return sender.tab.url;
  }

  if (typeof message?.tabId === 'number') {
    try {
      const tab = await chrome.tabs.get(message.tabId);
      return tab?.url || null;
    } catch (error) {
      return null;
    }
  }

  return null;
}

async function handleTestInjectBanner(payload = {}) {
  const { modeId, targetUrl, targetPattern } = payload;
  if (typeof modeId !== 'string' || !modeId.trim()) {
    return { ok: false, error: createError('E006', 'Invalid test banner payload') };
  }

  if (!Object.values(MODE_IDS).includes(modeId)) {
    return { ok: false, error: createError('E006', 'Unsupported modeId') };
  }

  const confidence = normalizeTestConfidence(payload.confidence);
  const signals = Array.isArray(payload.signals) ? payload.signals : [];
  const debugTabs = new Map();
  const collectDebugTabs = (tabs = []) => {
    for (const tab of tabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      if (debugTabs.has(tab.id)) continue;
      debugTabs.set(tab.id, { id: tab.id, url: tab.url, pendingUrl: tab.pendingUrl });
    }
  };

  let resolvedTabId = null;

  const matchesTargetUrl = (tab) =>
    targetUrl &&
    ((typeof tab?.url === 'string' && tab.url.startsWith(targetUrl)) ||
      (typeof tab?.pendingUrl === 'string' && tab.pendingUrl.startsWith(targetUrl)));

  if (targetPattern) {
    try {
      const patternTabs = await chrome.tabs.query({ url: [targetPattern] });
      collectDebugTabs(patternTabs);

      const targetMatch = patternTabs.find((tab) => matchesTargetUrl(tab));
      resolvedTabId =
        (typeof targetMatch?.id === 'number' ? targetMatch.id : null) ||
        patternTabs.find((tab) => typeof tab?.id === 'number')?.id ||
        null;
    } catch (error) {
      console.warn('[SW][TEST] Failed tab query by pattern', error);
    }
  }

  if (resolvedTabId === null) {
    try {
      const allTabs = await chrome.tabs.query({});
      collectDebugTabs(allTabs);

      const match = allTabs.find((tab) => matchesTargetUrl(tab));

      resolvedTabId = typeof match?.id === 'number' ? match.id : null;
    } catch (error) {
      console.warn('[SW][TEST] Failed tab query for fallback resolution', error);
    }
  }

  const tabId = resolvedTabId ?? (typeof payload.tabId === 'number' ? payload.tabId : null);

  if (typeof tabId !== 'number') {
    return {
      ok: false,
      message: 'No matching tab',
      targetUrl,
      targetPattern,
      debugTabs: Array.from(debugTabs.values()),
    };
  }

  const sendResult = await contentBridge.safeSend(tabId, {
    action: ACTIONS.TEST_INJECT_SUGGESTION_BANNER,
    modeId,
    confidence,
    signals,
  });

  if (!sendResult.ok || sendResult.data?.ok !== true) {
    return {
      ok: false,
      message: sendResult.error || sendResult.data?.error?.message || 'Banner inject failed (content)',
      targetUrl,
      targetPattern,
      tabId,
      attempts: sendResult.attempts,
      code: sendResult.code,
      response: sendResult.data,
      debugTabs: Array.from(debugTabs.values()),
    };
  }

  return {
    ok: true,
    attempts: sendResult.attempts,
    tabId,
    confidence,
    signals,
    suppressed: sendResult.data?.suppressed === true,
    reason: sendResult.data?.reason,
  };
}

async function resolveCurrentTabUrlForMigration(sender, message) {
  const tabId = typeof message?.tabId === 'number' ? message.tabId : sender?.tab?.id;
  if (typeof tabId !== 'number') return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return typeof tab?.url === 'string' ? tab.url : null;
  } catch (_) {
    return null;
  }
}

async function handleTestClearBanner(tabId) {
  if (typeof tabId !== 'number') {
    return { ok: false, error: createError('E006', 'Invalid tabId for banner clear') };
  }

  const sendResult = await contentBridge.safeSend(tabId, { action: ACTIONS.TEST_CLEAR_SUGGESTION_BANNER });

  if (!sendResult.ok) {
    return {
      ok: false,
      error: sendResult.error || createError('E001', 'Banner clear failed (tabs.sendMessage)'),
      code: sendResult.code,
      attempts: sendResult.attempts,
    };
  }

  const response = sendResult.data;
  if (response?.ok === true) {
    return { ok: true, attempts: sendResult.attempts };
  }

  return {
    ok: false,
    error: response?.error || createError('E001', 'Banner clear failed (content)'),
    attempts: sendResult.attempts,
  };
}

chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  ensureInitInHandler('onZoomChange', async () => {
    const { tabId, newZoomFactor } = zoomChangeInfo;

    console.log(`[SW] Zoom changed on tab ${tabId}: ${newZoomFactor}`);

    const history = await getZoomHistory(tabId);
    history.push({ time: Date.now(), factor: newZoomFactor });

    if (history.length > ZOOM_CONFIG.HISTORY_SIZE) {
      history.shift();
    }

    await saveZoomHistory(tabId, history);

    const windowStart = Date.now() - ZOOM_CONFIG.PATTERN_WINDOW;
    const recentZooms = history.filter(
      (entry) => entry.time > windowStart && entry.factor > ZOOM_CONFIG.MIN_FACTOR,
    );

    if (recentZooms.length >= ZOOM_CONFIG.PATTERN_THRESHOLD) {
      console.log(
        `[SW] Zoom pattern detected: ${recentZooms.length} zooms > ${ZOOM_CONFIG.MIN_FACTOR * 100}% in window`,
      );
      const zoomSignalResult = await signalBroker.onSignal(tabId, {
        type: SIGNALS.ZOOM,
        value: newZoomFactor,
        confidence: 1,
        ts: Date.now(),
        source: 'service-worker',
      });
      if (zoomSignalResult.ok) {
        await runTabLifecycleOperation(tabId, 'zoom:auto-apply', () => (
          scorer.handleSignal(tabId, zoomSignalResult.event.type, zoomSignalResult.event.value, {
            snapshot: zoomSignalResult.snapshot,
          })
        ));
      }
    }
  });
});

const ACTION_ALIASES = {
  REQUEST_STATE: ACTIONS.GET_STATE,
  APPLY_MODE: ACTIONS.USER_DECISION,
  REMOVE_MODE: ACTIONS.RESTORE_MODE,
};

async function handleUserDecisionRequest(tabId, modeId, decision, lifecycleIntent = null) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    return { ok: false, error: 'Tab not found' };
  }

  const tabUrl = tab?.url || '';
  if (isRestrictedUrl(tabUrl)) {
    await stateManager.updateTabModeState(tabId, modeId, {
      state: STATES.BLOCKED,
      pendingDecision: false,
    });
    return { ok: false, blocked: true, reason: 'Restricted URL' };
  }

  const siteKey = tabUrl ? extractDomain(tabUrl) : 'unknown';
  return decisionHandler.handleDecision(tabId, modeId, decision, { siteKey, lifecycleIntent });
}

async function clearGoneResetTarget(tabId) {
  await Promise.all([
    lifecycleOperationJournal.clearTab(tabId),
    stateManager.clearTab(tabId),
  ]);
}

async function removeModeForResetAll({ tabId, modeId }) {
  let lifecycleIntent;
  try {
    lifecycleIntent = await claimLifecycleIntent({
      tabId,
      modeId,
      kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
      targetState: STATES.INACTIVE,
      source: 'reset-all-data',
    });
  } catch (error) {
    if (error?.code === 'TAB_GONE' || error?.message === 'TAB_GONE') {
      await clearGoneResetTarget(tabId);
      return { ok: true, removed: false, reason: 'TAB_GONE' };
    }
    return {
      ok: false,
      reason: error?.code || error?.message || 'RESET_LIFECYCLE_CLAIM_FAILED',
      retryable: true,
    };
  }

  const result = await handleRestoreModeRequest(tabId, modeId, lifecycleIntent);
  await finishLifecycleIntent(
    lifecycleIntent,
    result || { ok: false, reason: 'RESET_MODE_REMOVE_FAILED' },
  );
  if (result?.error === 'Tab not found') {
    await clearGoneResetTarget(tabId);
    return { ok: true, removed: false, reason: 'TAB_GONE' };
  }
  return result || { ok: false, reason: 'RESET_MODE_REMOVE_FAILED' };
}

async function handleRestoreModeRequest(tabId, modeId, lifecycleIntent = null) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_) {
    return { ok: false, error: 'Tab not found' };
  }

  const tabUrl = tab?.url || '';
  if (isRestrictedUrl(tabUrl)) {
    await stateManager.updateTabModeState(tabId, modeId, {
      state: STATES.BLOCKED,
      pendingDecision: false,
    });
    return { ok: false, blocked: true, reason: 'Restricted URL' };
  }

  const siteKey = tabUrl ? extractDomain(tabUrl) : 'unknown';
  const previousModeState = await stateManager.getModeState(tabId, modeId);
  const previousTemplateEvidence = previousModeState?.scopedV2?.templateEvidence || null;
  const attemptId =
    previousModeState?.scopedV2?.outcomeAttemptId ||
    previousModeState?.scopedV2?.attemptId ||
    previousModeState?.attemptId ||
    null;
  await stateManager.updateTabModeState(tabId, modeId, { pendingDecision: true });
  const removed = await cssApplier.removeMode(tabId, modeId, { lifecycleIntent, siteKey });

  if (!removed?.ok) {
    const failedModeState = await stateManager.getModeState(tabId, modeId);
    const failureState = removed?.retryable === true || failedModeState?.state === STATES.ERROR
      ? STATES.ERROR
      : failedModeState?.state || STATES.ERROR;
    await stateManager.updateTabModeState(tabId, modeId, {
      state: failureState,
      pendingDecision: false,
      ...(failureState === STATES.ERROR ? { activeQuality: null } : {}),
    });
    const error = removed?.error || removed?.reason || 'Failed to remove mode';
    return {
      ok: false,
      error,
      reason: removed?.reason || error,
      retryable: removed?.retryable === true,
      details: removed?.details,
    };
  }

  await stateManager.updateModeState(tabId, modeId, STATES.INACTIVE, { pendingDecision: false });
  if (lifecycleIntent?.source !== 'reset-all-data') {
    await recordUserOutcome({
      siteKey,
      modeId,
      event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
      attemptId: lifecycleIntent?.opId || attemptId,
      ...templateEvidenceForLedger(previousTemplateEvidence),
    });
    const negativeEvidence = templateEvidenceForTemplateMemory(previousTemplateEvidence, {
      siteKey,
      event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    });
    if (negativeEvidence) {
      try {
        await recordTemplateMemoryNegativeOutcome(negativeEvidence);
      } catch (error) {
        console.warn('[SW] Template negative evidence write failed', error);
      }
    }
    await learningEngine.applyDecision(siteKey, modeId, DECISIONS.NOT_NOW, {
      effectId: lifecycleIntent?.opId ? `${lifecycleIntent.opId}:learning:not-now` : null,
    });
  }

  try {
    await chrome.tabs.sendMessage(
      tabId,
      { action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId },
      { frameId: 0 },
    );
  } catch (error) {
    console.warn('[SW] Failed to remove restore button', error);
  }
  await badgeManager.refresh();
  return { ok: true, success: true, state: STATES.INACTIVE };
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  ensureInitInHandler('onStorageChanged', async () => {
    if (areaName !== 'local') {
      return;
    }

    const prefsChange = changes?.[STORAGE_KEYS.USER_PREFS];
    if (!prefsChange) {
      return;
    }

    const previousPrefs = prefsChange.oldValue || {};
    const nextPrefs = prefsChange.newValue || {};

    const prevSpaDetection = previousPrefs.spaDetectionEnabled === true;
    const nextSpaDetection = nextPrefs.spaDetectionEnabled === true;

    if (prevSpaDetection !== nextSpaDetection) {
      if (nextSpaDetection) {
        await spaDetector.enable();
      } else {
        spaDetector.disable();
      }
    }

    const prevSmartScope = previousPrefs.smartScope || {};
    const nextSmartScope = nextPrefs.smartScope || {};

    const smartScopeChanged =
      prevSmartScope.enabled !== nextSmartScope.enabled ||
      prevSmartScope.level !== nextSmartScope.level ||
      JSON.stringify(prevSmartScope.perDomain || {}) !== JSON.stringify(nextSmartScope.perDomain || {});

    if (smartScopeChanged || prevSpaDetection !== nextSpaDetection) {
      await rehydrateActiveModesForActiveTabs('prefs');
    }

    const prevModePrefs = previousPrefs.modePrefs || {};
    const nextModePrefs = nextPrefs.modePrefs || {};
    const prevComfortVisual = prevModePrefs[MODE_IDS.COMFORT_VISUAL] || prevModePrefs.comfortVisual || {};
    const nextComfortVisual = nextModePrefs[MODE_IDS.COMFORT_VISUAL] || nextModePrefs.comfortVisual || {};
    const comfortVisualChanged = JSON.stringify(prevComfortVisual) !== JSON.stringify(nextComfortVisual);
    const prevFocus = prevModePrefs[MODE_IDS.FOCUS] || {};
    const nextFocus = nextModePrefs[MODE_IDS.FOCUS] || {};
    const focusChanged = JSON.stringify(prevFocus) !== JSON.stringify(nextFocus);

    if (comfortVisualChanged) {
      await rehydrateActiveModesForActiveTabs('prefs:comfortVisual');
    }
    if (focusChanged) {
      await rehydrateActiveModesForActiveTabs('prefs:focus');
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === FEATURE_FLAGS_REQUEST_TYPE) {
    handleGetFeatureFlagsRequest()
      .then((result) => {
        sendResponse(result);
      })
      .catch(() => {
        sendResponse({ ok: false, reason: 'SW_ERROR' });
      });
    return true;
  }

  if (handleSharedConstantsRequest(message, sendResponse)) {
    return;
  }

  console.log('[SW] Message received:', message.action);

  const normalizedAction = ACTION_ALIASES[message.action] || message.action;

  ensureInitInHandler(
    'onMessage',
    async () => {
      switch (normalizedAction) {
        case ACTIONS.GET_TAB_ID:
          sendResponse({ tabId: sender.tab?.id });
          break;
        case ACTIONS.GET_STATE: {
          const state = await stateManager.getState(message.tabId, message.modeId);
          const smartScopeStatus = await stateManager.getSmartScopeStatus(message.tabId, message.modeId);
          const stateWithStatus = smartScopeStatus ? { ...state, smartScopeStatus } : state;
          sendResponse({ state: stateWithStatus });
          break;
        }
        case ACTIONS.RESET_ALL_DATA: {
          const result = await resetAllDataManager.reset();
          sendResponse(result);
          break;
        }
        case ACTIONS.GET_DEBUG_SNAPSHOT: {
          const target = await resolveTabIdForDebug(sender, message);
          if (!target.ok) {
            sendResponse({ ok: false, error: target.error });
            break;
          }
          const tabId = target.tabId;
          const rawSnapshot = await signalBroker.getSnapshot(tabId);
          const events = await getDebugEvents(tabId);
          const [tabStateRead, cssRegistryRead, lifecycleRead] = await Promise.all([
            readSessionValueResult(STORAGE_KEYS.TAB_STATE),
            readSessionValueResult(STORAGE_KEYS.CSS_REGISTRY),
            lifecycleOperationJournal.getTabSlot(tabId),
          ]);
          const diagnostic = buildModeEngineDiagnosticSnapshot({
            tabId,
            signalSnapshot: rawSnapshot,
            signals: events.signals,
            decisions: events.decisions,
            tabStateRead,
            cssRegistryRead,
            lifecycleRead,
            generatedAt: Date.now(),
          });
          sendResponse({
            ok: true,
            diagnostic,
          });
          break;
        }
        case ACTIONS.CONTENT_SCRIPT_READY_V2: {
          const tabId = message.tabId ?? sender?.tab?.id;

          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          sendResponse({ ok: true });
          maybeEnsureSpaHooksMainInjected(tabId);
          scheduleObservedRehydrate(rehydrateActiveModesForTab, tabId, 'content-ready', {
            source: 'content-ready',
          });
          break;
        }
        case ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES: {
          const tabId = message.tabId ?? sender?.tab?.id;

          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          const reason = message.reason || 'spa';
          sendResponse({ ok: true });
          scheduleObservedRehydrate(rehydrateActiveModesForTab, tabId, reason, {
            source: 'content-message',
          });
          break;
        }
        case ACTIONS.DARK_COMFORT_FRAME_READY: {
          const tabId = sender?.tab?.id;

          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          const exactSenderDocument = message.source === 'frame-runtime-ready';
          const refresh = await cssApplier.refreshDarkComfortDocumentCss(tabId, {
            documentId: exactSenderDocument && typeof sender?.documentId === 'string' ? sender.documentId : null,
            frameId: exactSenderDocument && Number.isInteger(sender?.frameId) ? sender.frameId : null,
            source: message.source || 'frame-ready',
          });
          sendResponse(refresh);
          break;
        }
        case ACTIONS.MODE_ENGINE_V2_CONTRAST_REPORT: {
          const tabId = message.tabId ?? sender?.tab?.id;
          if (typeof tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_TAB_ID' });
            break;
          }

          const reportResult = await handleContrastReport(tabId, message.modeId, message.report);
          sendResponse(reportResult);
          break;
        }
        case ACTIONS.GET_SITE_POLICY: {
          const url = await resolveUrlFromMessage(sender, message);
          if (!url) {
            sendResponse({ ok: false, error: 'URL_REQUIRED' });
            break;
          }

          const policy = await computeSitePolicy({ url, now: Date.now() });
          sendResponse({ ok: true, policy });
          break;
        }
        case ACTIONS.SET_SITE_OVERRIDE: {
          const url = await resolveUrlFromMessage(sender, message);
          if (!url) {
            sendResponse({ ok: false, error: 'URL_REQUIRED' });
            break;
          }

          if (isUnsupportedScheme(url)) {
            sendResponse({ ok: false, error: 'UNSUPPORTED_SCHEME' });
            break;
          }

          const siteKey = getSiteKeyFromUrl(url);
          if (!siteKey) {
            sendResponse({ ok: false, error: 'INVALID_HOST' });
            break;
          }

          const durationMs = normalizeOverrideDuration(message.durationMs);
          const overrideUntil = Date.now() + durationMs;
          const saved = await setSiteOverride({ siteKey, overrideUntil });

          if (!saved) {
            sendResponse({ ok: false, error: 'OVERRIDE_FAILED' });
            break;
          }

          const policy = await computeSitePolicy({ url, now: Date.now() });
          sendResponse({ ok: true, policy });
          break;
        }
        case ACTIONS.GET_LEGACY_DOMAIN_MIGRATION: {
          const url = await resolveCurrentTabUrlForMigration(sender, message);
          if (!url || isUnsupportedScheme(url)) {
            sendResponse({ ok: false, error: 'CURRENT_TAB_REQUIRED' });
            break;
          }
          sendResponse(await inspectLegacyDomainMigration(url));
          break;
        }
        case ACTIONS.CONFIRM_LEGACY_DOMAIN_MIGRATION: {
          const url = await resolveCurrentTabUrlForMigration(sender, message);
          if (!url || isUnsupportedScheme(url)) {
            sendResponse({ ok: false, error: 'CURRENT_TAB_REQUIRED' });
            break;
          }
          const result = await migrateLegacyDomainData({
            url,
            confirmed: message.confirmed === true,
          });
          sendResponse(result);
          break;
        }
        case ACTIONS.SIGNAL_DETECTED: {
          const tabId = typeof message.tabId === 'number' ? message.tabId : sender?.tab?.id;
          const signalPayload =
            message.signal && typeof message.signal === 'object'
              ? message.signal
              : {
                  type: message.signal ?? message.type,
                  value: message.value,
                  confidence: message.confidence,
                  ts: message.timestamp ?? message.ts,
                  source: message.source,
                  context: message.context,
                };

          const result = await signalBroker.onSignal(tabId, signalPayload);
          if (!result.ok) {
            sendResponse({ ok: false, error: result.error || 'INVALID_SIGNAL' });
            break;
          }

          await runTabLifecycleOperation(tabId, 'signal:auto-apply', () => (
            scorer.handleSignal(tabId, result.event.type, result.event.value, {
              snapshot: result.snapshot,
            })
          ));
          sendResponse({ ok: true, received: true });
          break;
        }
        case ACTIONS.USER_DECISION: {
          const { tabId, modeId } = message;
          const decision =
            message.decision || (message.action === 'APPLY_MODE' ? 'ENABLED' : undefined);

          if (typeof tabId !== 'number' || typeof modeId !== 'string' || !decision) {
            sendResponse({ ok: false, error: 'Invalid decision payload' });
            break;
          }

          const lifecycleIntent = decision === DECISIONS.ENABLED
            ? await claimLifecycleIntent({
                tabId,
                modeId,
                kind: LIFECYCLE_OPERATION_KINDS.APPLY,
                targetState: STATES.ACTIVE,
                source: 'user-decision',
              })
            : null;
          const result = await runTabLifecycleOperation(
            tabId,
            `user-decision:${modeId}:${decision}`,
            () => handleUserDecisionRequest(tabId, modeId, decision, lifecycleIntent),
          );
          if (lifecycleIntent) {
            await finishLifecycleIntent(lifecycleIntent, result || { ok: false, reason: 'Decision handling failed' });
          }
          sendResponse(result || { ok: false, error: 'Decision handling failed' });
          break;
        }
        case ACTIONS.RESTORE_MODE: {
          const { tabId, modeId } = message;

          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'Invalid restore payload' });
            break;
          }

          const lifecycleIntent = await claimLifecycleIntent({
            tabId,
            modeId,
            kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
            targetState: STATES.INACTIVE,
            source: 'restore',
          });
          const result = await runTabLifecycleOperation(
            tabId,
            `restore:${modeId}`,
            () => handleRestoreModeRequest(tabId, modeId, lifecycleIntent),
          );
          await finishLifecycleIntent(lifecycleIntent, result || { ok: false, reason: 'Restore handling failed' });
          sendResponse(result);
          break;
        }
        case ACTIONS.SHOW_WHY_SECTION: {
          const pending = {
            action: ACTIONS.SCROLL_TO_WHY,
            tabId: message.tabId,
            modeId: message.modeId,
            timestamp: Date.now(),
          };

          await setToSession(STORAGE_KEYS.PENDING_POPUP, pending);

          const result = await tryOpenPopupOrFallback({
            fallback: 'openOptions',
            reason: 'openPopup_failed',
            modeId: message.modeId,
          });

          if (result.used === 'fallback' && result.error) {
            console.error('[SW] Failed to open popup for WHY section', result.error);
          }

          sendResponse({ success: true });
          break;
        }
        case ACTIONS.POPUP_READY: {
          const pending = await getFromSession(STORAGE_KEYS.PENDING_POPUP);

          if (pending?.action === ACTIONS.SCROLL_TO_WHY) {
            sendResponse({
              pendingAction: {
                action: ACTIONS.SCROLL_TO_WHY,
                tabId: pending.tabId,
                modeId: pending.modeId,
              },
              action: ACTIONS.SCROLL_TO_WHY,
            });

            await setToSession(STORAGE_KEYS.PENDING_POPUP, null);
          } else {
            sendResponse({ success: true });
          }

          break;
        }
        case ACTIONS.PREFS_UPDATED: {
          if (typeof sender?.tab?.id !== 'number' || typeof message?.preferencePatch?.readingRuler !== 'boolean') {
            sendResponse({ ok: false, error: 'INVALID_PREFERENCE_PATCH' });
            break;
          }

          const readingRuler = message.preferencePatch.readingRuler;
          const prefs = await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
            const latest = storedPrefs && typeof storedPrefs === 'object' ? storedPrefs : {};
            const modePrefs = latest.modePrefs && typeof latest.modePrefs === 'object' ? latest.modePrefs : {};
            const focusPrefs = modePrefs[MODE_IDS.FOCUS] && typeof modePrefs[MODE_IDS.FOCUS] === 'object'
              ? modePrefs[MODE_IDS.FOCUS]
              : {};
            return {
              ...latest,
              modePrefs: {
                ...modePrefs,
                [MODE_IDS.FOCUS]: { ...focusPrefs, readingRuler },
              },
            };
          });
          sendResponse({ ok: true, prefs });
          break;
        }
        case ACTIONS.GET_PERFORMANCE_METRICS: {
          const metrics = await performanceMonitor.getAllMetrics();
          sendResponse({ metrics });
          break;
        }
        case ACTIONS.TEST_INJECT_SUGGESTION_BANNER: {
          const result = await handleTestInjectBanner(message);
          sendResponse(result);
          break;
        }
        case ACTIONS.TEST_CLEAR_SUGGESTION_BANNER: {
          const result = await handleTestClearBanner(message.tabId);
          sendResponse(result);
          break;
        }
        case ACTIONS.TEST_LIFECYCLE_ARM_PAUSE_V1: {
          if (!isFlagEnabled('debugTestHooks')) {
            sendResponse({ ok: false, error: 'TEST_HOOKS_DISABLED' });
            break;
          }
          sendResponse(armLifecyclePause({ tabId: message.tabId, checkpoint: message.checkpoint }));
          break;
        }
        case ACTIONS.TEST_LIFECYCLE_GET_PAUSE_V1: {
          if (!isFlagEnabled('debugTestHooks')) {
            sendResponse({ ok: false, error: 'TEST_HOOKS_DISABLED' });
            break;
          }
          sendResponse(getLifecyclePauseState());
          break;
        }
        case ACTIONS.SMARTSCOPE_SET_CONFIG_V1: {
          const payload = message.payload || {};
          const result = await setSmartScopeConfig(payload);
          sendResponse(result);
          break;
        }
        case ACTIONS.SMARTSCOPE_RESET_V1: {
          const result = await resetSmartScopeEverywhere();
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.APPLY_CLASSES: {
          const { tabId, modeId, operations } = message;
          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          const result = await smartScopeApplyDomClasses(tabId, modeId, operations || []);
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.REMOVE_TOKEN: {
          const { tabId, modeId } = message;
          if (typeof tabId !== 'number' || typeof modeId !== 'string') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          const result = await smartScopeRemoveDomToken(tabId, modeId);
          sendResponse(result);
          break;
        }
        case SMARTSCOPE_ACTIONS.VERIFY_SCOPE:
        case SMARTSCOPE_ACTIONS.EMERGENCY_CLEANUP: {
          if (typeof message.tabId !== 'number') {
            sendResponse({ ok: false, error: 'INVALID_PAYLOAD' });
            break;
          }

          try {
            const response = await chrome.tabs.sendMessage(message.tabId, message);
            if (message.modeId) {
              await recordSmartScopeStatus(message.tabId, message.modeId, normalizedAction === SMARTSCOPE_ACTIONS.VERIFY_SCOPE ? 'verify' : 'cleanup', response || {});
            }
            sendResponse(response);
          } catch (error) {
            const failure = { ok: false, error: error?.message || 'CS_UNREACHABLE' };
            if (message.modeId) {
              await recordSmartScopeStatus(message.tabId, message.modeId, normalizedAction === SMARTSCOPE_ACTIONS.VERIFY_SCOPE ? 'verify' : 'cleanup', failure);
            }
            sendResponse(failure);
          }
          break;
        }
        default:
          console.warn('[SW] Unknown action:', message.action);
          sendResponse({ error: 'Unknown action' });
          break;
      }
    },
    {
      onError: (error) => {
        sendResponse({ error: error?.message || 'Unhandled error' });
      },
    },
  );

  return true;
});

self.addEventListener('error', (event) => {
  console.error('[SW] Uncaught error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});
