import { DECISIONS, MODE_IDS, STORAGE_KEYS } from '../shared/constants.js';
import { extractDomain, getFromSession, mutateSessionValue } from '../shared/utils.js';
import {
  ADAPTATION_ACTION_IDS,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
} from '../shared/engine-core/enums.js';
import { ENGINE_CORE_SCHEMA_VERSION } from '../shared/engine-core/contracts.js';
import {
  assertValidDto,
  validateOutcomeLedgerEventV1,
} from '../shared/engine-core/validators.js';
import { evaluateLearningEligibilityV1 } from '../shared/engine-core/learning-eligibility.js';
import { isTemplateMemoryHashV1 } from '../shared/engine-core/template-memory.js';
import {
  buildLearningEffectKeyV1,
  legacyLearningEffectKeyV1,
} from '../shared/engine-core/runtime-capability-matrix.js';

export const OUTCOME_LEDGER_LIMIT = 100;
export const OUTCOME_LEDGER_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_NO_UNDO_WINDOW_MS = 90000;

const MODE_ACTION_ID = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
  [MODE_IDS.FOCUS]: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
});

const BLOCKING_EVENTS = new Set([
  OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED,
  OUTCOME_LEDGER_EVENTS.ROLLED_BACK,
  OUTCOME_LEDGER_EVENTS.USER_UNDID,
]);
const SAFE_PROFILE_HASH_RE = /^(?:shr1|tmh1)_[A-Za-z0-9_-]{6,96}$/;

function nowMs() {
  return Date.now();
}

function timestampBucket(ms = nowMs()) {
  const rounded = Math.floor(ms / 60000) * 60000;
  return new Date(rounded).toISOString();
}

function simpleHash(value = '') {
  let hash = 0;
  const normalized = `${value}`;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

function normalizeSiteKey(siteKey = '') {
  if (typeof siteKey !== 'string' || !siteKey.trim()) {
    return 'unknown';
  }
  return extractDomain(siteKey);
}

function actionIdForMode(modeId) {
  return MODE_ACTION_ID[modeId] || ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY;
}

function normalizeAttemptId(attemptId) {
  if (attemptId == null || attemptId === '') {
    return undefined;
  }
  return `${attemptId}`.slice(0, 96);
}

function normalizeLedgerArray(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
}

async function readLedger() {
  return normalizeLedgerArray(await getFromSession(STORAGE_KEYS.OUTCOME_LEDGER_V1));
}

function pruneLedger(entries, referenceNow = nowMs()) {
  const cutoff = referenceNow - OUTCOME_LEDGER_TTL_MS;
  return normalizeLedgerArray(entries)
    .filter((entry) => typeof entry.timestampMs !== 'number' || entry.timestampMs >= cutoff)
    .slice(-OUTCOME_LEDGER_LIMIT);
}

async function mutateLedger(updater, referenceNow = nowMs()) {
  return mutateSessionValue(STORAGE_KEYS.OUTCOME_LEDGER_V1, (storedLedger) => {
    const current = pruneLedger(storedLedger, referenceNow).map((entry) => ({ ...entry }));
    const next = updater(current);
    return pruneLedger(Array.isArray(next) ? next : current, referenceNow);
  });
}

function normalizeOutcomeEvent({
  siteKey,
  modeId,
  event,
  attemptId,
  learningEligible = false,
  timestampMs = nowMs(),
  eligibleAtMs,
  consumedAtMs,
  rejectionReason,
  profileHash,
  templateHash,
  pageType,
  learningEffectKey,
} = {}) {
  const normalizedSiteKey = normalizeSiteKey(siteKey);
  const normalizedModeId = Object.values(MODE_IDS).includes(modeId) ? modeId : MODE_IDS.FOCUS;
  const normalized = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    event,
    actionId: actionIdForMode(normalizedModeId),
    modeId: normalizedModeId,
    siteKeyHash: simpleHash(normalizedSiteKey),
    learningEligible: learningEligible === true,
    timestampBucket: timestampBucket(timestampMs),
    timestampMs,
    reasons: [],
  };
  const normalizedAttemptId = normalizeAttemptId(attemptId);
  if (normalizedAttemptId) {
    normalized.attemptId = normalizedAttemptId;
  }
  if (typeof eligibleAtMs === 'number' && Number.isFinite(eligibleAtMs)) {
    normalized.eligibleAtMs = eligibleAtMs;
  }
  if (typeof consumedAtMs === 'number' && Number.isFinite(consumedAtMs)) {
    normalized.consumedAtMs = consumedAtMs;
  }
  if (typeof rejectionReason === 'string' && rejectionReason) {
    normalized.rejectionReason = rejectionReason.slice(0, 96);
  }
  if (typeof profileHash === 'string' && SAFE_PROFILE_HASH_RE.test(profileHash)) {
    normalized.profileHash = profileHash.slice(0, 96);
  }
  if (isTemplateMemoryHashV1(templateHash)) {
    normalized.templateHash = templateHash;
  }
  if (Object.values(PAGE_TYPES).includes(pageType)) {
    normalized.pageType = pageType;
  }
  try {
    const key = buildLearningEffectKeyV1(learningEffectKey);
    if (
      key.actionId === normalized.actionId
      && key.modeId === normalized.modeId
      && (!normalized.pageType || key.pageType === normalized.pageType)
    ) {
      normalized.learningEffectKey = key;
    }
  } catch {
    if (normalized.templateHash && normalized.pageType) {
      const fallbackKey = legacyLearningEffectKeyV1({
        modeId: normalized.modeId,
        actionId: normalized.actionId,
        pageType: normalized.pageType,
      });
      if (fallbackKey) {
        normalized.learningEffectKey = fallbackKey;
      }
    }
  }
  if (normalized.learningEffectKey?.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    normalized.learningEligible = false;
  }

  assertValidDto(normalized, validateOutcomeLedgerEventV1, 'OutcomeLedgerEventV1');
  return normalized;
}

export async function appendOutcomeLedgerEvent(event) {
  const normalized = normalizeOutcomeEvent(event);
  let storedEvent = normalized;
  await mutateLedger((ledger) => {
    const duplicate = normalized.attemptId
      ? ledger.find((entry) => (
          entry.attemptId === normalized.attemptId
          && entry.event === normalized.event
          && entry.modeId === normalized.modeId
          && entry.siteKey === normalized.siteKey
        ))
      : null;
    if (duplicate) {
      storedEvent = duplicate;
      return ledger;
    }
    return [...ledger, normalized];
  });
  return storedEvent;
}

export async function recordAcceptedApplyOutcome({
  siteKey,
  modeId,
  attemptId,
  noUndoWindowMs = DEFAULT_NO_UNDO_WINDOW_MS,
  timestampMs = nowMs(),
  profileHash,
  templateHash,
  pageType,
  learningEffectKey,
} = {}) {
  await appendOutcomeLedgerEvent({
    siteKey,
    modeId,
    attemptId,
    event: OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED,
    learningEligible: false,
    timestampMs,
    profileHash,
    templateHash,
    pageType,
    learningEffectKey,
  });

  return appendOutcomeLedgerEvent({
    siteKey,
    modeId,
    attemptId,
    event: OUTCOME_LEDGER_EVENTS.USER_ACCEPTED,
    learningEligible: false,
    timestampMs,
    eligibleAtMs: timestampMs + Math.max(0, noUndoWindowMs),
    profileHash,
    templateHash,
    pageType,
    learningEffectKey,
  });
}

export async function recordRejectedApplyOutcome({
  siteKey,
  modeId,
  attemptId,
  reason,
  timestampMs = nowMs(),
  profileHash,
  templateHash,
  pageType,
  learningEffectKey,
} = {}) {
  const event =
    reason === OUTCOME_LEDGER_EVENTS.ROLLED_BACK
      ? OUTCOME_LEDGER_EVENTS.ROLLED_BACK
      : OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED;
  return appendOutcomeLedgerEvent({
    siteKey,
    modeId,
    attemptId,
    event,
    learningEligible: false,
    timestampMs,
    profileHash,
    templateHash,
    pageType,
    learningEffectKey,
  });
}

export async function recordUserOutcome({
  siteKey,
  modeId,
  event,
  attemptId,
  timestampMs = nowMs(),
  profileHash,
  templateHash,
  pageType,
  learningEffectKey,
} = {}) {
  return appendOutcomeLedgerEvent({
    siteKey,
    modeId,
    attemptId,
    event,
    learningEligible: false,
    timestampMs,
    profileHash,
    templateHash,
    pageType,
    learningEffectKey,
  });
}

function sameCandidateScope(candidate, entry) {
  if (candidate.siteKeyHash !== entry.siteKeyHash || candidate.modeId !== entry.modeId) {
    return false;
  }
  if (candidate.attemptId && entry.attemptId) {
    return candidate.attemptId === entry.attemptId;
  }
  return entry.timestampMs >= candidate.timestampMs;
}

function candidateWasBlocked(candidate, ledger) {
  return ledger.some((entry) => BLOCKING_EVENTS.has(entry.event) && sameBlockingScope(candidate, entry));
}

function sameBlockingScope(candidate, entry) {
  if (candidate.siteKeyHash !== entry.siteKeyHash || candidate.modeId !== entry.modeId) {
    return false;
  }
  return entry.timestampMs >= candidate.timestampMs;
}

export async function consumeEligibleLearningEvents({ siteKey, modeId, now = nowMs() } = {}) {
  const normalizedSiteKey = normalizeSiteKey(siteKey);
  const normalizedSiteKeyHash = simpleHash(normalizedSiteKey);
  const decisions = [];
  await mutateLedger((ledger) => {
    const generated = [];
    for (const entry of ledger) {
    if (entry.event !== OUTCOME_LEDGER_EVENTS.USER_ACCEPTED) {
      continue;
    }
    if (entry.consumedAtMs) {
      continue;
    }
    if (entry.siteKeyHash !== normalizedSiteKeyHash || entry.modeId !== modeId) {
      continue;
    }

    const postApplyPassed = ledger.some(
      (candidate) =>
        candidate.event === OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED &&
        sameCandidateScope(entry, candidate),
    );
    const blocked = candidateWasBlocked(entry, ledger);
    const eligibility = evaluateLearningEligibilityV1({
      postApplyPassed,
      userAccepted: true,
      userUndid: blocked && ledger.some((candidate) => candidate.event === OUTCOME_LEDGER_EVENTS.USER_UNDID && sameBlockingScope(entry, candidate)),
      rolledBack: blocked && ledger.some((candidate) => candidate.event === OUTCOME_LEDGER_EVENTS.ROLLED_BACK && sameBlockingScope(entry, candidate)),
      postApplyFailed: blocked && ledger.some((candidate) => candidate.event === OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED && sameBlockingScope(entry, candidate)),
      acceptedAtMs: entry.timestampMs,
      nowMs: now,
      noUndoWindowMs: Math.max(0, (entry.eligibleAtMs || entry.timestampMs) - entry.timestampMs),
    });

    if (!eligibility.learningEligible) {
      if (!eligibility.reasons.includes('UNDO_WINDOW_ACTIVE')) {
        entry.consumedAtMs = now;
        entry.rejectionReason = eligibility.reasons[0] || 'LEARNING_REJECTED';
        generated.push(normalizeOutcomeEvent({
          siteKey: normalizedSiteKey,
          modeId: entry.modeId,
          attemptId: entry.attemptId,
          event: OUTCOME_LEDGER_EVENTS.LEARNING_REJECTED,
          learningEligible: false,
          timestampMs: now,
          rejectionReason: entry.rejectionReason,
          profileHash: entry.profileHash,
          templateHash: entry.templateHash,
          pageType: entry.pageType,
          learningEffectKey: entry.learningEffectKey,
        }));
      }
      continue;
    }

    entry.consumedAtMs = now;
    entry.learningEligible = true;
    const decision = {
      siteKey: normalizedSiteKey,
      modeId: entry.modeId,
      decision: DECISIONS.ENABLED,
      attemptId: entry.attemptId || null,
    };
    if (entry.profileHash) decision.profileHash = entry.profileHash;
    if (entry.templateHash) decision.templateHash = entry.templateHash;
    if (entry.pageType) decision.pageType = entry.pageType;
    if (entry.templateHash && entry.actionId) decision.actionId = entry.actionId;
    if (entry.learningEffectKey) decision.learningEffectKey = entry.learningEffectKey;
    decisions.push(decision);
    generated.push(normalizeOutcomeEvent({
      siteKey: normalizedSiteKey,
      modeId: entry.modeId,
      attemptId: entry.attemptId,
      event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      learningEligible: true,
      timestampMs: now,
      profileHash: entry.profileHash,
      templateHash: entry.templateHash,
      pageType: entry.pageType,
      learningEffectKey: entry.learningEffectKey,
    }));
    }
    return [...ledger, ...generated];
  }, now);

  return decisions;
}

export async function getOutcomeLedgerForTests() {
  return readLedger();
}

export async function clearOutcomeLedgerForTests() {
  await mutateSessionValue(STORAGE_KEYS.OUTCOME_LEDGER_V1, () => []);
}
