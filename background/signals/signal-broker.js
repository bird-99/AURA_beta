import { ACTIONS, STORAGE_KEYS } from '../../shared/constants.js';
import { SIGNAL_SOURCES, SIGNAL_TYPES } from '../../shared/types/signals.js';
import { getFromSession, isValidTabId, mutateSessionValue } from '../../shared/utils.js';
import { recordSignalEvent } from '../debug-snapshot.js';

const SIGNAL_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000;
const MAX_PAST_AGE_MS = 24 * 60 * 60 * 1000;

const SIGNAL_TYPE_LIST = Object.freeze(Object.values(SIGNAL_TYPES));
const SIGNAL_SOURCE_LIST = Object.freeze(Object.values(SIGNAL_SOURCES));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedSignalType(type) {
  return typeof type === 'string' && SIGNAL_TYPE_LIST.includes(type);
}

function isAllowedSignalSource(source) {
  return typeof source === 'string' && SIGNAL_SOURCE_LIST.includes(source);
}

function normalizeConfidence(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  if (value < 0 || value > 1) {
    return null;
  }
  return value;
}

function normalizeSignalTimestamp(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return now;
  }

  if (ts > now + MAX_FUTURE_DRIFT_MS) {
    return null;
  }

  if (ts < now - MAX_PAST_AGE_MS) {
    return null;
  }

  return ts;
}

function isValidSignalValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }

  if (isPlainObject(value)) {
    return true;
  }

  return false;
}

function sanitizeSignalContext(raw) {
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

function sanitizeSignalEvent(raw, now) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'INVALID_EVENT' };
  }

  const type = raw.type;
  if (!isAllowedSignalType(type)) {
    return { ok: false, error: 'UNKNOWN_SIGNAL_TYPE' };
  }

  if (!isValidSignalValue(raw.value)) {
    return { ok: false, error: 'INVALID_SIGNAL_VALUE' };
  }

  const confidence = normalizeConfidence(raw.confidence);
  if (confidence === null) {
    return { ok: false, error: 'INVALID_CONFIDENCE' };
  }

  const ts = normalizeSignalTimestamp(raw.ts, now);
  if (ts === null) {
    return { ok: false, error: 'INVALID_TIMESTAMP' };
  }

  const source = isAllowedSignalSource(raw.source) ? raw.source : SIGNAL_SOURCES.UNKNOWN;
  const context = sanitizeSignalContext(raw.context);

  return {
    ok: true,
    event: {
      type,
      value: raw.value,
      confidence,
      ts,
      source,
      context,
    },
  };
}

function buildSnapshotEntry(tabId, raw) {
  const byType = isPlainObject(raw?.byType) ? raw.byType : {};
  const normalizedByType = {};

  for (const type of SIGNAL_TYPE_LIST) {
    const entry = byType[type];
    if (entry && typeof entry === 'object' && typeof entry.ts === 'number') {
      normalizedByType[type] = entry;
    } else {
      normalizedByType[type] = undefined;
    }
  }

  return {
    tabId,
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
    lastSeenAt: typeof raw?.lastSeenAt === 'number' ? raw.lastSeenAt : 0,
    byType: normalizedByType,
  };
}

function pruneSnapshots(data, now) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  const next = {};
  let changed = false;
  for (const [tabKey, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') {
      changed = true;
      continue;
    }

    const lastSeenAt = typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : entry.updatedAt;
    if (typeof lastSeenAt !== 'number' || now - lastSeenAt > SIGNAL_TTL_MS) {
      changed = true;
      continue;
    }

    next[tabKey] = entry;
  }

  return changed ? next : data;
}

export class SignalBroker {
  constructor({ broadcastEnabled = false } = {}) {
    this.broadcastEnabled = broadcastEnabled;
  }

  async onSignal(tabId, rawEvent) {
    if (!isValidTabId(tabId)) {
      return { ok: false, error: 'INVALID_TAB_ID' };
    }

    const now = Date.now();
    const sanitized = sanitizeSignalEvent(rawEvent, now);
    if (!sanitized.ok) {
      return sanitized;
    }

    let nextEntry = null;
    await mutateSessionValue(STORAGE_KEYS.SIGNAL_SNAPSHOTS, (storedSnapshots) => {
      const data = isPlainObject(storedSnapshots) ? storedSnapshots : {};
      const pruned = { ...pruneSnapshots(data, now) };
      const existing = pruned[tabId] || { byType: {}, updatedAt: 0, lastSeenAt: 0 };
      const byType = isPlainObject(existing.byType) ? { ...existing.byType } : {};
      nextEntry = { ...existing, updatedAt: now, lastSeenAt: now, byType };

      const current = byType[sanitized.event.type];
      const shouldUpdate =
        !current ||
        typeof current.ts !== 'number' ||
        sanitized.event.ts >= current.ts ||
        sanitized.event.confidence > current.confidence;

      if (shouldUpdate) {
        byType[sanitized.event.type] = {
          value: sanitized.event.value,
          confidence: sanitized.event.confidence,
          ts: sanitized.event.ts,
          source: sanitized.event.source,
          context: sanitized.event.context,
        };
      }

      pruned[tabId] = nextEntry;
      return pruned;
    });

    const snapshot = buildSnapshotEntry(tabId, nextEntry);
    if (this.broadcastEnabled) {
      this.broadcastSnapshot(snapshot);
    }

    await recordSignalEvent(tabId, sanitized.event);
    return { ok: true, snapshot, event: sanitized.event };
  }

  async getSnapshot(tabId) {
    if (!isValidTabId(tabId)) {
      return null;
    }

    const now = Date.now();
    const data = (await getFromSession(STORAGE_KEYS.SIGNAL_SNAPSHOTS)) || {};
    let pruned = pruneSnapshots(data, now);

    if (pruned !== data) {
      pruned = await mutateSessionValue(
        STORAGE_KEYS.SIGNAL_SNAPSHOTS,
        (latest) => pruneSnapshots(isPlainObject(latest) ? latest : {}, now),
      );
    }

    const entry = pruned[tabId];
    if (!entry) {
      return null;
    }

    return buildSnapshotEntry(tabId, entry);
  }

  async getActiveSnapshot() {
    const now = Date.now();
    const data = (await getFromSession(STORAGE_KEYS.SIGNAL_SNAPSHOTS)) || {};
    let pruned = pruneSnapshots(data, now);

    if (pruned !== data) {
      pruned = await mutateSessionValue(
        STORAGE_KEYS.SIGNAL_SNAPSHOTS,
        (latest) => pruneSnapshots(isPlainObject(latest) ? latest : {}, now),
      );
    }

    return Object.entries(pruned)
      .map(([tabKey, entry]) => buildSnapshotEntry(Number(tabKey), entry))
      .filter((snapshot) => isValidTabId(snapshot.tabId));
  }

  async prune(now = Date.now()) {
    await mutateSessionValue(
      STORAGE_KEYS.SIGNAL_SNAPSHOTS,
      (latest) => pruneSnapshots(isPlainObject(latest) ? latest : {}, now),
    );
  }

  broadcastSnapshot(snapshot) {
    if (!snapshot) {
      return;
    }

    try {
      chrome.runtime.sendMessage({
        action: ACTIONS.SIGNAL_SNAPSHOT_UPDATED,
        snapshot,
      });
    } catch (error) {
      console.warn('[SignalBroker] Failed to broadcast snapshot');
    }
  }
}

export const signalBroker = new SignalBroker();
