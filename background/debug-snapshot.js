import { MODE_IDS, STORAGE_KEYS } from '../shared/constants.js';
import { getFromSession, isValidTabId, mutateSessionValue } from '../shared/utils.js';

const DEBUG_SIGNAL_LIMIT = 50;
const DEBUG_DECISION_LIMIT = 50;
const MAX_STRING_LENGTH = 160;
const MAX_OBJECT_KEYS = 6;
const DIAGNOSTIC_EVENT_LIMIT = 25;
const DIAGNOSTIC_ARTIFACT_LIMIT = 24;
const DIAGNOSTIC_HANDLE_LIMIT = 12;
const SAFE_DEBUG_STRING_VALUES = new Set([
  'dark',
  'light',
  'no-preference',
  'rapid-scrolling',
  'text-selection',
]);

export const MODE_ENGINE_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const MODE_ENGINE_DIAGNOSTIC_KIND = 'ModeEngineDiagnosticSnapshotV1';
export const MODE_ENGINE_DIAGNOSTIC_MAX_BYTES = 64 * 1024;

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  let sanitized = value.replace(/https?:\/\/\S+/gi, '[redacted-url]');
  sanitized = sanitized.replace(/\b\S+@\S+\b/g, '[redacted-email]');
  sanitized = sanitized.replace(/\b(?:token|secret|password|authorization|cookie)\b\s*[:=]\s*\S+/gi, '[redacted-secret]');
  if (/\b(?:secret|password|authorization|bearer)\b/i.test(sanitized)) {
    return '[redacted-string]';
  }
  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH - 1)}…`;
  }
  return sanitized;
}

function sanitizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const sanitized = sanitizeString(value);
    if (sanitized.startsWith('[redacted-')) return sanitized;
    return SAFE_DEBUG_STRING_VALUES.has(sanitized) ? sanitized : '[redacted-string]';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    const result = {};

    for (const [key, entryValue] of entries) {
      if (/(host|url|token|secret|password|email)/i.test(key)) {
        continue;
      }
      const sanitizedKey = sanitizeCode(key);
      if (!sanitizedKey) continue;
      if (typeof entryValue === 'string') {
        result[sanitizedKey] = sanitizeValue(entryValue);
      } else if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
        result[sanitizedKey] = entryValue;
      }
    }

    return Object.keys(result).length ? result : '[object]';
  }

  return '[unsupported]';
}

function sanitizeContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const context = {};
  if (typeof raw.frameId === 'number') {
    context.frameId = raw.frameId;
  }
  if (typeof raw.viewportWidth === 'number') {
    context.viewportWidth = raw.viewportWidth;
  }
  if (typeof raw.viewportHeight === 'number') {
    context.viewportHeight = raw.viewportHeight;
  }

  return Object.keys(context).length ? context : null;
}

async function pushDebugEntry(key, entry, limit) {
  return mutateSessionValue(key, (stored) => {
    const list = Array.isArray(stored) ? stored : [];
    const trimmed = list.slice(Math.max(0, list.length - limit + 1));
    trimmed.push(entry);
    return trimmed;
  });
}

function sanitizeCode(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || !/^[a-z0-9_.:-]+$/i.test(trimmed)) return fallback;
  if (/(secret|password|authorization|bearer|cookie)/i.test(trimmed)) return fallback;
  return trimmed;
}

function sanitizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeCount(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
}

function sanitizeReadResult(read, targetFound = null) {
  if (!read?.ok) {
    return {
      status: 'error',
      error: sanitizeCode(read?.error?.code)
        || sanitizeCode(read?.error?.message)
        || 'STORAGE_UNAVAILABLE',
    };
  }
  const status = targetFound === false ? 'missing' : read.status === 'found' ? 'found' : 'missing';
  return { status, error: null };
}

function collectModeHandles(modeState) {
  const candidates = [
    ['css', modeState?.cssId],
    ['smartScope.css', modeState?.smartScope?.cssId],
    ['smartScope.baseCss', modeState?.smartScope?.baseCssId],
    ['smartScope.patchCss', modeState?.smartScope?.patchCssId],
    ['scopedV2.css', modeState?.scopedV2?.cssId],
    ['scopedV2.transitionCss', modeState?.scopedV2?.transitionCssId],
    ['scopedV2.preludeCss', modeState?.scopedV2?.preludeCssId],
  ];
  const handles = [];
  const seen = new Set();
  for (const [kind, rawId] of candidates) {
    const id = sanitizeCode(rawId);
    if (!id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    handles.push({ kind, id });
    if (handles.length >= DIAGNOSTIC_HANDLE_LIMIT) break;
  }
  return handles;
}

export function sanitizeModeStateForDebug(rawTabState, tabId) {
  const rawModes = rawTabState && typeof rawTabState === 'object' && !Array.isArray(rawTabState)
    ? rawTabState[String(tabId)] || rawTabState[tabId]
    : null;
  if (!rawModes || typeof rawModes !== 'object' || Array.isArray(rawModes)) {
    return { found: false, modes: [] };
  }

  const modes = [];
  for (const modeId of Object.values(MODE_IDS)) {
    const state = rawModes[modeId];
    if (!state || typeof state !== 'object' || Array.isArray(state)) continue;
    modes.push({
      modeId,
      state: sanitizeCode(state.state, 'UNKNOWN'),
      pendingDecision: state.pendingDecision === true,
      activeQuality: sanitizeCode(state.activeQuality),
      lastLifecycleGeneration: sanitizeCount(state.lastLifecycleGeneration),
      handles: collectModeHandles(state),
    });
  }
  return { found: modes.length > 0, modes };
}

export function sanitizeCssRegistryForDebug(rawRegistry, modes = []) {
  const registry = rawRegistry && typeof rawRegistry === 'object' && !Array.isArray(rawRegistry)
    ? rawRegistry
    : {};
  const referenced = [];
  for (const mode of modes) {
    for (const handle of mode.handles || []) {
      const entry = Object.prototype.hasOwnProperty.call(registry, handle.id) ? registry[handle.id] : null;
      referenced.push({
        modeId: mode.modeId,
        kind: handle.kind,
        id: handle.id,
        present: Boolean(entry && typeof entry === 'object'),
        origin: sanitizeCode(entry?.origin),
      });
      if (referenced.length >= DIAGNOSTIC_HANDLE_LIMIT) break;
    }
    if (referenced.length >= DIAGNOSTIC_HANDLE_LIMIT) break;
  }
  return { referenced };
}

function sanitizeLifecycleArtifact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    kind: sanitizeCode(raw.kind, 'UNKNOWN'),
    status: sanitizeCode(raw.status, 'UNKNOWN'),
    plannedAt: sanitizeTimestamp(raw.plannedAt),
    updatedAt: sanitizeTimestamp(raw.updatedAt),
  };
}

function sanitizeLifecycleOperation(raw, { includeArtifacts = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const operation = {
    generation: sanitizeCount(raw.generation),
    modeId: sanitizeCode(raw.modeId),
    kind: sanitizeCode(raw.kind),
    targetState: sanitizeCode(raw.targetState),
    source: sanitizeCode(raw.source),
    phase: sanitizeCode(raw.phase),
    interruptedPhase: sanitizeCode(raw.interruptedPhase),
    reason: sanitizeCode(raw.reason),
    quarantineReason: sanitizeCode(raw.quarantineReason),
    recoveryAttempts: sanitizeCount(raw.recoveryAttempts),
    createdAt: sanitizeTimestamp(raw.createdAt),
    updatedAt: sanitizeTimestamp(raw.updatedAt),
    lastAttemptAt: sanitizeTimestamp(raw.lastAttemptAt),
    nextRetryAt: sanitizeTimestamp(raw.nextRetryAt),
    quarantinedAt: sanitizeTimestamp(raw.quarantinedAt),
    lastError: sanitizeCode(raw.lastError?.code)
      || sanitizeCode(raw.lastError?.reason)
      || sanitizeCode(raw.lastError)
      || (raw.lastError ? 'REDACTED_ERROR' : null),
  };
  if (includeArtifacts) {
    operation.artifacts = Array.isArray(raw.artifacts)
      ? raw.artifacts.slice(0, DIAGNOSTIC_ARTIFACT_LIMIT).map(sanitizeLifecycleArtifact).filter(Boolean)
      : [];
  }
  return operation;
}

export function sanitizeLifecycleSnapshot(rawSlot) {
  if (!rawSlot || typeof rawSlot !== 'object' || Array.isArray(rawSlot)) {
    return { generation: 0, desired: null, running: null, lastFinished: null };
  }
  return {
    generation: sanitizeCount(rawSlot.generation),
    desired: sanitizeLifecycleOperation(rawSlot.desired),
    running: sanitizeLifecycleOperation(rawSlot.running, { includeArtifacts: true }),
    lastFinished: sanitizeLifecycleOperation(rawSlot.lastFinished),
  };
}

export function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const byType = snapshot.byType && typeof snapshot.byType === 'object' ? snapshot.byType : {};
  const sanitizedByType = {};

  for (const [rawType, entry] of Object.entries(byType).slice(0, DIAGNOSTIC_EVENT_LIMIT)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const type = sanitizeCode(rawType);
    if (!type) continue;
    sanitizedByType[type] = {
      value: sanitizeValue(entry.value),
      confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
      ts: typeof entry.ts === 'number' ? entry.ts : null,
      source: sanitizeCode(entry.source, 'unknown'),
      context: sanitizeContext(entry.context),
    };
  }

  return {
    tabId: isValidTabId(snapshot.tabId) ? snapshot.tabId : null,
    updatedAt: typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : null,
    lastSeenAt: typeof snapshot.lastSeenAt === 'number' ? snapshot.lastSeenAt : null,
    byType: sanitizedByType,
  };
}

function sanitizeSignalEventForDebug(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = sanitizeCode(raw.type);
  if (!type) return null;
  return {
    type,
    value: sanitizeValue(raw.value),
    confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : null,
    ts: sanitizeTimestamp(raw.ts),
    source: sanitizeCode(raw.source, 'unknown'),
    context: sanitizeContext(raw.context),
  };
}

function sanitizeDecisionEventForDebug(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const modeId = sanitizeCode(raw.modeId);
  if (!modeId) return null;
  const sanitizeCodes = (values) => Array.isArray(values)
    ? values.map((value) => sanitizeCode(value)).filter(Boolean).slice(0, MAX_OBJECT_KEYS)
    : [];
  return {
    decision: sanitizeCode(raw.decision, 'NOOP'),
    modeId,
    score: typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : null,
    reasonCodes: sanitizeCodes(raw.reasonCodes),
    contributingSignals: sanitizeCodes(raw.contributingSignals),
    strongSignals: sanitizeCodes(raw.strongSignals),
    ts: sanitizeTimestamp(raw.ts),
  };
}

function enforceDiagnosticSize(diagnostic) {
  const signals = diagnostic.signals.recentSignals;
  const decisions = diagnostic.signals.recentDecisions;
  let truncated = false;
  while (JSON.stringify(diagnostic).length > MODE_ENGINE_DIAGNOSTIC_MAX_BYTES && (signals.length || decisions.length)) {
    if (signals.length >= decisions.length) signals.pop();
    else decisions.pop();
    truncated = true;
  }
  if (JSON.stringify(diagnostic).length > MODE_ENGINE_DIAGNOSTIC_MAX_BYTES) {
    diagnostic.lifecycle.running = diagnostic.lifecycle.running
      ? { ...diagnostic.lifecycle.running, artifacts: [] }
      : null;
    truncated = true;
  }
  if (JSON.stringify(diagnostic).length > MODE_ENGINE_DIAGNOSTIC_MAX_BYTES) {
    diagnostic.signals.snapshot = null;
    diagnostic.cssRegistry.referenced = [];
    truncated = true;
  }
  diagnostic.truncated = truncated;
  return diagnostic;
}

/**
 * @param {{
 *  tabId?: number;
 *  signalSnapshot?: any;
 *  signals?: any[];
 *  decisions?: any[];
 *  tabStateRead?: any;
 *  cssRegistryRead?: any;
 *  lifecycleRead?: any;
 *  generatedAt?: number;
 * }} [options]
 */
export function buildModeEngineDiagnosticSnapshot({
  tabId,
  signalSnapshot = null,
  signals = [],
  decisions = [],
  tabStateRead = null,
  cssRegistryRead = null,
  lifecycleRead = null,
  generatedAt = Date.now(),
} = {}) {
  if (!isValidTabId(tabId)) {
    throw new TypeError('A valid diagnostic tabId is required');
  }

  const modeState = sanitizeModeStateForDebug(tabStateRead?.ok ? tabStateRead.value : null, tabId);
  const registry = sanitizeCssRegistryForDebug(
    cssRegistryRead?.ok && cssRegistryRead.status === 'found' ? cssRegistryRead.value : null,
    modeState.modes,
  );
  const lifecycle = sanitizeLifecycleSnapshot(lifecycleRead?.ok ? lifecycleRead.slot : null);
  const sanitizedSignalSnapshot = sanitizeSnapshot(signalSnapshot);
  if (sanitizedSignalSnapshot) sanitizedSignalSnapshot.tabId = tabId;
  const diagnostic = {
    schemaVersion: MODE_ENGINE_DIAGNOSTIC_SCHEMA_VERSION,
    kind: MODE_ENGINE_DIAGNOSTIC_KIND,
    generatedAt: sanitizeTimestamp(generatedAt),
    target: { tabId },
    storage: {
      modeState: sanitizeReadResult(tabStateRead, modeState.found),
      cssRegistry: sanitizeReadResult(cssRegistryRead),
      lifecycle: sanitizeReadResult(lifecycleRead),
    },
    modeState: modeState.modes,
    cssRegistry: registry,
    lifecycle,
    signals: {
      snapshot: sanitizedSignalSnapshot,
      recentSignals: (Array.isArray(signals) ? signals : [])
        .filter((entry) => entry?.tabId === tabId)
        .slice(-DIAGNOSTIC_EVENT_LIMIT)
        .map(sanitizeSignalEventForDebug)
        .filter(Boolean),
      recentDecisions: (Array.isArray(decisions) ? decisions : [])
        .filter((entry) => entry?.tabId === tabId)
        .slice(-DIAGNOSTIC_EVENT_LIMIT)
        .map(sanitizeDecisionEventForDebug)
        .filter(Boolean),
    },
    truncated: false,
  };

  return enforceDiagnosticSize(diagnostic);
}

export async function recordSignalEvent(tabId, event) {
  if (!isValidTabId(tabId) || !event || typeof event.type !== 'string') {
    return;
  }

  const entry = {
    tabId,
    type: event.type,
    value: sanitizeValue(event.value),
    confidence: typeof event.confidence === 'number' ? event.confidence : null,
    ts: typeof event.ts === 'number' ? event.ts : Date.now(),
    source: typeof event.source === 'string' ? event.source : 'unknown',
    context: sanitizeContext(event.context),
  };

  await pushDebugEntry(STORAGE_KEYS.DEBUG_SIGNAL_EVENTS, entry, DEBUG_SIGNAL_LIMIT);
}

export async function recordDecisionEvent(tabId, decision) {
  if (!isValidTabId(tabId) || !decision || typeof decision.modeId !== 'string') {
    return;
  }

  const entry = {
    tabId,
    decision: decision.kind || 'NOOP',
    modeId: decision.modeId,
    score: typeof decision.score === 'number' ? Number(decision.score.toFixed(3)) : null,
    reasonCodes: Array.isArray(decision.reasonCodes)
      ? decision.reasonCodes.filter((code) => typeof code === 'string').slice(0, MAX_OBJECT_KEYS)
      : [],
    contributingSignals: Array.isArray(decision.contributingSignals)
      ? decision.contributingSignals.filter((code) => typeof code === 'string').slice(0, MAX_OBJECT_KEYS)
      : [],
    strongSignals: Array.isArray(decision.strongSignals)
      ? decision.strongSignals.filter((code) => typeof code === 'string').slice(0, MAX_OBJECT_KEYS)
      : [],
    thresholds: decision.thresholds && typeof decision.thresholds === 'object' ? decision.thresholds : null,
    ts: Date.now(),
  };

  await pushDebugEntry(STORAGE_KEYS.DEBUG_DECISION_EVENTS, entry, DEBUG_DECISION_LIMIT);
}

export async function getDebugEvents(tabId) {
  const rawSignals = (await getFromSession(STORAGE_KEYS.DEBUG_SIGNAL_EVENTS)) || [];
  const rawDecisions = (await getFromSession(STORAGE_KEYS.DEBUG_DECISION_EVENTS)) || [];
  const signals = Array.isArray(rawSignals) ? rawSignals : [];
  const decisions = Array.isArray(rawDecisions) ? rawDecisions : [];

  if (!isValidTabId(tabId)) {
    return { signals, decisions };
  }

  return {
    signals: signals.filter((entry) => entry?.tabId === tabId),
    decisions: decisions.filter((entry) => entry?.tabId === tabId),
  };
}
