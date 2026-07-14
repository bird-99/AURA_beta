import { MODE_IDS, STATES, STORAGE_KEYS } from '../shared/constants.js';
import { mutateSessionValue, readSessionValueResult } from '../shared/utils.js';

export const LIFECYCLE_JOURNAL_SCHEMA_VERSION = 1;
export const MAX_LIFECYCLE_RECOVERY_ATTEMPTS = 3;

export const LIFECYCLE_OPERATION_KINDS = Object.freeze({
  APPLY: 'APPLY',
  REMOVE: 'REMOVE',
  REHYDRATE: 'REHYDRATE',
});

export const LIFECYCLE_PHASES = Object.freeze({
  PREPARED: 'PREPARED',
  MUTATING: 'MUTATING',
  STATE_COMMITTED: 'STATE_COMMITTED',
  POST_COMMIT: 'POST_COMMIT',
  COMMITTED: 'COMMITTED',
  ROLLING_BACK: 'ROLLING_BACK',
  RETRYABLE: 'RETRYABLE',
  QUARANTINED: 'QUARANTINED',
});

export const LIFECYCLE_ARTIFACT_STATUSES = Object.freeze({
  PLANNED: 'PLANNED',
  DONE: 'DONE',
  CLEANED: 'CLEANED',
});

const VALID_KINDS = new Set(Object.values(LIFECYCLE_OPERATION_KINDS));
const VALID_PHASES = new Set(Object.values(LIFECYCLE_PHASES));
const VALID_ARTIFACT_STATUSES = new Set(Object.values(LIFECYCLE_ARTIFACT_STATUSES));
const VALID_TARGET_STATES = new Set([STATES.ACTIVE, STATES.INACTIVE]);
const VALID_MODE_IDS = new Set(Object.values(MODE_IDS));

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function emptyJournal() {
  return { schemaVersion: LIFECYCLE_JOURNAL_SCHEMA_VERSION, tabs: {} };
}

function validateTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new TypeError('A non-negative integer tabId is required');
  }
}

function validateModeId(modeId) {
  if (!VALID_MODE_IDS.has(modeId)) {
    throw new TypeError('A supported modeId is required');
  }
}

function validateOperationKind(kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new TypeError('A supported lifecycle operation kind is required');
  }
}

function intentPriority(kind, source) {
  if (kind === LIFECYCLE_OPERATION_KINDS.REMOVE) return 100;
  if (source === 'user-decision' || source === 'popup') return 90;
  if (kind === LIFECYCLE_OPERATION_KINDS.APPLY) return 30;
  if (kind === LIFECYCLE_OPERATION_KINDS.REHYDRATE) return 10;
  return 20;
}

function normalizeJournal(raw, { allowMissing = true } = {}) {
  if (raw == null && allowMissing) return emptyJournal();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('LIFECYCLE_JOURNAL_CORRUPT');
  }
  if (raw.schemaVersion !== LIFECYCLE_JOURNAL_SCHEMA_VERSION) {
    throw new Error('LIFECYCLE_JOURNAL_VERSION_UNSUPPORTED');
  }
  if (!raw.tabs || typeof raw.tabs !== 'object' || Array.isArray(raw.tabs)) {
    throw new Error('LIFECYCLE_JOURNAL_CORRUPT');
  }
  return { ...raw, tabs: { ...raw.tabs } };
}

function getSlot(journal, tabId) {
  const raw = journal.tabs[String(tabId)];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { generation: 0, desired: null, running: null, lastFinished: null };
  }
  return {
    generation: Number.isInteger(raw.generation) && raw.generation >= 0 ? raw.generation : 0,
    desired: raw.desired && typeof raw.desired === 'object' ? { ...raw.desired } : null,
    running: raw.running && typeof raw.running === 'object' ? clone(raw.running) : null,
    lastFinished: raw.lastFinished && typeof raw.lastFinished === 'object' ? { ...raw.lastFinished } : null,
  };
}

function setSlot(journal, tabId, slot) {
  journal.tabs[String(tabId)] = slot;
}

function assertRunningOwner(slot, opId, generation) {
  if (!slot.running || slot.running.opId !== opId || slot.running.generation !== generation) {
    throw new Error('LIFECYCLE_OPERATION_STALE');
  }
}

export class LifecycleOperationJournal {
  constructor({
    readResult = readSessionValueResult,
    mutateValue = mutateSessionValue,
    now = () => Date.now(),
    uuid = () => crypto.randomUUID(),
  } = {}) {
    this.readResult = readResult;
    this.mutateValue = mutateValue;
    this.now = now;
    this.uuid = uuid;
  }

  async read() {
    const result = await this.readResult(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1);
    if (!result?.ok) {
      return {
        ok: false,
        status: 'error',
        journal: null,
        error: result?.error || { message: 'LIFECYCLE_STORAGE_UNAVAILABLE' },
      };
    }
    try {
      return {
        ok: true,
        status: result.status,
        journal: normalizeJournal(result.status === 'missing' ? null : result.value),
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'corrupt',
        journal: null,
        error: { message: error?.message || 'LIFECYCLE_JOURNAL_CORRUPT' },
      };
    }
  }

  /**
   * @param {{ tabId?: number, modeId?: string, kind?: string, targetState?: string, source?: string, urlKey?: string, documentInstanceId?: string | null, chromeDocumentId?: string | null }} [options]
   */
  async claimIntent({
    tabId,
    modeId,
    kind,
    targetState,
    source = 'unknown',
    urlKey = '',
    documentInstanceId = null,
    chromeDocumentId = null,
  } = {}) {
    validateTabId(tabId);
    validateModeId(modeId);
    validateOperationKind(kind);
    if (!VALID_TARGET_STATES.has(targetState)) {
      throw new TypeError('A valid lifecycle targetState is required');
    }
    const opId = this.uuid();
    const timestamp = this.now();
    let claimed = null;
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored);
      const slot = getSlot(journal, tabId);
      if (slot.running?.phase === LIFECYCLE_PHASES.QUARANTINED && kind !== LIFECYCLE_OPERATION_KINDS.REMOVE) {
        throw new Error('LIFECYCLE_OPERATION_QUARANTINED');
      }
      const priority = intentPriority(kind, source);
      if (slot.desired && Number.isFinite(slot.desired.priority) && slot.desired.priority > priority) {
        throw new Error('LIFECYCLE_INTENT_SUPERSEDED');
      }
      const generation = slot.generation + 1;
      claimed = {
        opId,
        generation,
        tabId,
        modeId,
        kind,
        targetState,
        source: typeof source === 'string' ? source : 'unknown',
        priority,
        urlKey: typeof urlKey === 'string' ? urlKey : '',
        documentInstanceId: typeof documentInstanceId === 'string' ? documentInstanceId : null,
        chromeDocumentId: typeof chromeDocumentId === 'string' ? chromeDocumentId : null,
        createdAt: timestamp,
      };
      setSlot(journal, tabId, { ...slot, generation, desired: claimed });
      return journal;
    });
    return clone(claimed);
  }

  async begin(intent, { beforeState = null } = {}) {
    if (!intent?.opId) throw new TypeError('A claimed lifecycle intent is required');
    let running = null;
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored, { allowMissing: false });
      const slot = getSlot(journal, intent.tabId);
      if (slot.desired?.opId !== intent.opId || slot.desired?.generation !== intent.generation) {
        throw new Error('LIFECYCLE_OPERATION_STALE');
      }
      if (slot.running && slot.running.opId !== intent.opId) {
        if ((intent.priority || 0) < (slot.running.priority || 0)) {
          throw new Error('LIFECYCLE_OPERATION_IN_PROGRESS');
        }
        running = {
          ...clone(intent),
          phase: LIFECYCLE_PHASES.PREPARED,
          beforeState: clone(slot.running.beforeState || beforeState),
          artifacts: clone(slot.running.artifacts || []),
          postCommit: [],
          recoveryAttempts: 0,
          lastError: null,
          lastAttemptAt: null,
          nextRetryAt: null,
          quarantinedAt: null,
          quarantineReason: null,
          supersededOperation: {
            opId: slot.running.opId,
            generation: slot.running.generation,
            kind: slot.running.kind,
          },
          updatedAt: this.now(),
        };
      }
      running = running || slot.running || {
        ...clone(intent),
        phase: LIFECYCLE_PHASES.PREPARED,
        beforeState: clone(beforeState),
        artifacts: [],
        postCommit: [],
        recoveryAttempts: 0,
        lastError: null,
        updatedAt: this.now(),
      };
      setSlot(journal, intent.tabId, { ...slot, running });
      return journal;
    });
    return clone(running);
  }

  /** @param {{ tabId?: number, opId?: string, generation?: number }} [owner] */
  async isCurrent({ tabId, opId, generation } = {}) {
    const read = await this.read();
    if (!read.ok) return { ok: false, current: false, status: read.status, error: read.error };
    const slot = getSlot(read.journal, tabId);
    return {
      ok: true,
      current: slot.desired?.opId === opId && slot.desired?.generation === generation,
      status: read.status,
      error: null,
    };
  }

  async getTabSlot(tabId) {
    validateTabId(tabId);
    const read = await this.read();
    if (!read.ok) return { ok: false, status: read.status, slot: null, error: read.error };
    return { ok: true, status: read.status, slot: clone(getSlot(read.journal, tabId)), error: null };
  }

  async listPendingTabs() {
    const read = await this.read();
    if (!read.ok) return { ok: false, status: read.status, entries: [], error: read.error };
    const entries = Object.entries(read.journal.tabs)
      .map(([tabId, rawSlot]) => ({ tabId: Number.parseInt(tabId, 10), slot: getSlot({ tabs: { [tabId]: rawSlot } }, tabId) }))
      .filter((entry) => Number.isInteger(entry.tabId) && (entry.slot.running || entry.slot.desired));
    return { ok: true, status: read.status, entries: clone(entries), error: null };
  }

  async listTabs() {
    const read = await this.read();
    if (!read.ok) return { ok: false, status: read.status, entries: [], error: read.error };
    const entries = Object.entries(read.journal.tabs)
      .map(([tabId, rawSlot]) => ({
        tabId: Number.parseInt(tabId, 10),
        slot: getSlot({ tabs: { [tabId]: rawSlot } }, tabId),
      }))
      .filter((entry) => Number.isInteger(entry.tabId));
    return { ok: true, status: read.status, entries: clone(entries), error: null };
  }

  async setPhase({ tabId, opId, generation }, phase, updates = {}) {
    if (!VALID_PHASES.has(phase)) throw new TypeError('Invalid lifecycle phase');
    return this.#updateRunning({ tabId, opId, generation }, (running) => ({
      ...running,
      ...clone(updates),
      phase,
      updatedAt: this.now(),
    }));
  }

  async startRecoveryAttempt(owner, { attemptedAt = this.now() } = {}) {
    return this.#updateRunning(owner, (running) => {
      const recoveryAttempts = (Number.isInteger(running.recoveryAttempts) ? running.recoveryAttempts : 0) + 1;
      const interruptedPhase = running.interruptedPhase
        || (![LIFECYCLE_PHASES.ROLLING_BACK, LIFECYCLE_PHASES.RETRYABLE, LIFECYCLE_PHASES.QUARANTINED]
          .includes(running.phase) ? running.phase : 'UNKNOWN');
      return {
        ...running,
        phase: LIFECYCLE_PHASES.ROLLING_BACK,
        recoveryAttempts,
        interruptedPhase,
        lastAttemptAt: attemptedAt,
        nextRetryAt: null,
        updatedAt: this.now(),
      };
    });
  }

  async recordRecoveryFailure(owner, {
    reason = 'RECOVERY_FAILED',
    lastError = reason,
    nextRetryAt = null,
    maxAttempts = MAX_LIFECYCLE_RECOVERY_ATTEMPTS,
  } = {}) {
    return this.#updateRunning(owner, (running) => {
      const attempts = Number.isInteger(running.recoveryAttempts) ? running.recoveryAttempts : 0;
      const quarantined = attempts >= maxAttempts;
      return {
        ...running,
        phase: quarantined ? LIFECYCLE_PHASES.QUARANTINED : LIFECYCLE_PHASES.RETRYABLE,
        reason,
        lastError: clone(lastError),
        nextRetryAt: quarantined || !Number.isFinite(nextRetryAt) ? null : nextRetryAt,
        quarantinedAt: quarantined ? this.now() : null,
        quarantineReason: quarantined ? reason : null,
        updatedAt: this.now(),
      };
    });
  }

  async planArtifact(owner, artifact = {}) {
    if (!artifact?.id || typeof artifact.id !== 'string' || !artifact.kind) {
      throw new TypeError('A lifecycle artifact id and kind are required');
    }
    return this.#updateRunning(owner, (running) => {
      if (running.artifacts.some((entry) => entry.id === artifact.id)) {
        throw new Error('LIFECYCLE_ARTIFACT_DUPLICATE');
      }
      return {
        ...running,
        phase: LIFECYCLE_PHASES.MUTATING,
        artifacts: [...running.artifacts, {
          ...clone(artifact),
          status: LIFECYCLE_ARTIFACT_STATUSES.PLANNED,
          plannedAt: this.now(),
        }],
        updatedAt: this.now(),
      };
    });
  }

  async markArtifact(owner, artifactId, status, updates = {}) {
    if (!VALID_ARTIFACT_STATUSES.has(status)) throw new TypeError('Invalid lifecycle artifact status');
    return this.#updateRunning(owner, (running) => {
      let found = false;
      const artifacts = running.artifacts.map((entry) => {
        if (entry.id !== artifactId) return entry;
        found = true;
        return { ...entry, ...clone(updates), status, updatedAt: this.now() };
      });
      if (!found) throw new Error('LIFECYCLE_ARTIFACT_MISSING');
      return { ...running, artifacts, updatedAt: this.now() };
    });
  }

  async addPostCommitEffect(owner, effect = {}) {
    if (!effect?.id || typeof effect.id !== 'string') {
      throw new TypeError('A post-commit effect id is required');
    }
    return this.#updateRunning(owner, (running) => ({
      ...running,
      postCommit: running.postCommit.some((entry) => entry.id === effect.id)
        ? running.postCommit
        : [...running.postCommit, { ...clone(effect), status: 'PENDING' }],
      updatedAt: this.now(),
    }));
  }

  async complete(owner) {
    let completed = null;
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored, { allowMissing: false });
      const slot = getSlot(journal, owner.tabId);
      assertRunningOwner(slot, owner.opId, owner.generation);
      completed = {
        opId: owner.opId,
        generation: owner.generation,
        phase: LIFECYCLE_PHASES.COMMITTED,
        completedAt: this.now(),
      };
      setSlot(journal, owner.tabId, {
        ...slot,
        desired: slot.desired?.opId === owner.opId ? null : slot.desired,
        running: null,
        lastFinished: completed,
      });
      return journal;
    });
    return clone(completed);
  }

  async cancelIntent(intent, reason = 'CANCELLED') {
    if (!intent?.opId) return false;
    let cancelled = false;
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored, { allowMissing: false });
      const slot = getSlot(journal, intent.tabId);
      if (slot.running?.opId === intent.opId) {
        return journal;
      }
      if (slot.desired?.opId === intent.opId && slot.desired?.generation === intent.generation) {
        cancelled = true;
        setSlot(journal, intent.tabId, {
          ...slot,
          desired: null,
          lastFinished: {
            opId: intent.opId,
            generation: intent.generation,
            phase: 'CANCELLED',
            reason,
            completedAt: this.now(),
          },
        });
      }
      return journal;
    });
    return cancelled;
  }

  async clearTab(tabId) {
    validateTabId(tabId);
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored);
      delete journal.tabs[String(tabId)];
      return journal;
    });
  }

  async pruneTabs(validTabIds) {
    const valid = new Set(
      Array.from(validTabIds || []).filter((tabId) => Number.isInteger(tabId)).map(String),
    );
    const removed = [];
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored);
      for (const tabId of Object.keys(journal.tabs)) {
        if (valid.has(tabId)) continue;
        removed.push(Number.parseInt(tabId, 10));
        delete journal.tabs[tabId];
      }
      return journal;
    });
    return removed.filter(Number.isInteger);
  }

  async #updateRunning(owner, updater) {
    let updated = null;
    await this.mutateValue(STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, (stored) => {
      const journal = normalizeJournal(stored, { allowMissing: false });
      const slot = getSlot(journal, owner.tabId);
      assertRunningOwner(slot, owner.opId, owner.generation);
      updated = updater(clone(slot.running));
      setSlot(journal, owner.tabId, { ...slot, running: updated });
      return journal;
    });
    return clone(updated);
  }
}

export const lifecycleOperationJournal = new LifecycleOperationJournal();
