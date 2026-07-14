import { DTO_CAPS, ENGINE_CORE_SCHEMA_VERSION } from './contracts.js';
import {
  ACTION_POLICY_DECISIONS,
  ACTIVE_POLICY_DECISION_KINDS,
  SHADOW_COMPARISON_KINDS,
  SHADOW_NOT_APPLIED_REASONS,
  SHADOW_POLICY_IDS,
} from './enums.js';
import { evaluateActionPolicyDecisionV1 } from './action-policy.js';
import {
  assertValidDto,
  validateShadowDecisionV1,
  validateShadowPolicySummaryV1,
  validateShadowReplayComparisonV1,
  validateShadowReplayEventV1,
  validateShadowReplayStoreV1,
} from './validators.js';

export const SHADOW_REPLAY_SCHEMA_VERSION = 1;
export const SHADOW_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
export const SHADOW_REPLAY_MAX_ENTRIES = DTO_CAPS.maxShadowEntries;
export const SHADOW_REPLAY_MAX_BYTES = DTO_CAPS.maxShadowReplayBytes;
export const SHADOW_REPLAY_MAX_ENTRY_BYTES = DTO_CAPS.maxShadowReplayEntryBytes;
export const SHADOW_REPLAY_POLICY_VERSION = 'action-policy-v1';
export const ACTIVE_POLICY_VERSION = 'legacy-score-v1';

const HOUR_MS = 60 * 60 * 1000;
const HASH_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';
const POSITIVE_SHADOW_DECISIONS = new Set([
  ACTION_POLICY_DECISIONS.ALLOW,
  ACTION_POLICY_DECISIONS.REQUIRE_POST_APPLY_INSPECTION,
]);
const ACTIVE_APPLY = ACTIVE_POLICY_DECISION_KINDS.APPLY;
const ACTIVE_SUGGEST = ACTIVE_POLICY_DECISION_KINDS.SUGGEST;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp01(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function byteSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function stableValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      const next = stableValue(value[key]);
      if (next !== null) {
        acc[key] = next;
      }
      return acc;
    }, {});
}

export function makeShadowReplayHashV1(value) {
  const input = stableJson(value);
  let a = 2166136261;
  let b = 16777619;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 16777619) >>> 0;
    b ^= code + index;
    b = Math.imul(b, 2166136261) >>> 0;
  }
  let mixed = BigInt(a) << 32n | BigInt(b);
  let out = '';
  for (let index = 0; index < 22; index += 1) {
    out += HASH_ALPHABET[Number(mixed & 63n)];
    mixed = (mixed >> 3n) ^ BigInt((a + index * 2654435761) >>> 0);
  }
  return `shr1_${out}`;
}

function timestampBucket(ms) {
  const value = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : Date.now();
  return new Date(Math.floor(value / HOUR_MS) * HOUR_MS).toISOString();
}

function profileSignature(profile) {
  return {
    pageType: profile?.pageType || 'UNKNOWN',
    pageTypeConfidence: Math.round(clamp01(profile?.pageTypeConfidence) * 10),
    selectedScopeRole: profile?.selectedScope?.roleHint || null,
    reasons: Array.isArray(profile?.reasons) ? profile.reasons.slice(0, DTO_CAPS.maxReasons) : [],
    risk: {
      layoutRisk: Math.round(clamp01(profile?.risk?.layoutRisk) * 10),
      interactionRisk: Math.round(clamp01(profile?.risk?.interactionRisk) * 10),
      confidenceRisk: Math.round(clamp01(profile?.risk?.confidenceRisk) * 10),
      privacyRisk: Math.round(clamp01(profile?.risk?.privacyRisk) * 10),
    },
    stats: {
      budgetHit: profile?.stats?.budgetHit === true,
      candidatesSeen: Math.min(1000, Math.max(0, Math.floor(profile?.stats?.candidatesSeen || 0))),
    },
  };
}

export function buildShadowDecisionV1(profile, actionContext, options = {}) {
  const policyDecision = evaluateActionPolicyDecisionV1(profile, actionContext);
  const shadowRunId = options.shadowRunId || makeShadowReplayHashV1({
    policyId: SHADOW_POLICY_IDS.ACTION_POLICY_V1,
    policyVersion: options.policyVersion || SHADOW_REPLAY_POLICY_VERSION,
    profile: profileSignature(profile),
    actionId: actionContext?.actionId,
    source: actionContext?.source,
  });
  const shadow = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    shadowRunId,
    policyId: SHADOW_POLICY_IDS.ACTION_POLICY_V1,
    policyVersion: options.policyVersion || SHADOW_REPLAY_POLICY_VERSION,
    profileHash: options.profileHash || makeShadowReplayHashV1(profileSignature(profile)),
    actionId: policyDecision.actionId,
    actionContextSource: actionContext.source,
    predictedDecision: policyDecision.decision,
    predictedRisk: clone(policyDecision.risk),
    reasonCodes: Array.isArray(policyDecision.reasons)
      ? policyDecision.reasons.slice(0, DTO_CAPS.maxShadowReasons)
      : [],
    notAppliedBecause: options.notAppliedBecause || SHADOW_NOT_APPLIED_REASONS.SHADOW_MODE,
  };
  if (options.templateHash) {
    shadow.templateHash = options.templateHash;
  }
  if (profile?.pageType) {
    shadow.pageType = profile.pageType;
  }
  return assertValidDto(shadow, validateShadowDecisionV1, 'ShadowDecisionV1');
}

export function buildShadowPolicySummaryV1(activePolicy, options = {}) {
  const summary = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    activePolicyId: options.activePolicyId || 'LEGACY_SCORE_POLICY',
    activePolicyVersion: options.activePolicyVersion || ACTIVE_POLICY_VERSION,
    actionId: activePolicy.actionId,
    decisionKind: activePolicy.decisionKind || activePolicy.kind,
    score: clamp01(activePolicy.score),
    reasons: Array.isArray(activePolicy.reasons)
      ? activePolicy.reasons.slice(0, DTO_CAPS.maxShadowReasons)
      : [],
  };
  if (activePolicy.modeId) {
    summary.modeId = activePolicy.modeId;
  }
  if (activePolicy.thresholds && typeof activePolicy.thresholds === 'object') {
    summary.thresholds = {
      enter: clamp01(activePolicy.thresholds.enter),
      exit: clamp01(activePolicy.thresholds.exit),
      apply: clamp01(activePolicy.thresholds.apply),
    };
  }
  return assertValidDto(summary, validateShadowPolicySummaryV1, 'ShadowPolicySummaryV1');
}

function activePositive(kind) {
  return kind === ACTIVE_APPLY || kind === ACTIVE_SUGGEST;
}

function activeWouldApply(kind) {
  return kind === ACTIVE_APPLY;
}

function shadowPositive(decision) {
  return POSITIVE_SHADOW_DECISIONS.has(decision) || decision === ACTION_POLICY_DECISIONS.SUGGEST_ONLY;
}

function shadowWouldApply(decision) {
  return POSITIVE_SHADOW_DECISIONS.has(decision);
}

export function compareShadowReplayV1(activeSummary, shadowDecision) {
  const active = assertValidDto(activeSummary, validateShadowPolicySummaryV1, 'ShadowPolicySummaryV1');
  const shadow = assertValidDto(shadowDecision, validateShadowDecisionV1, 'ShadowDecisionV1');
  const activeApply = activeWouldApply(active.decisionKind);
  const shadowApply = shadowWouldApply(shadow.predictedDecision);
  /** @type {string} */
  let comparisonKind = SHADOW_COMPARISON_KINDS.MATCH_NOOP;
  const reasons = [];

  if (!activePositive(active.decisionKind) && !shadowPositive(shadow.predictedDecision)) {
    comparisonKind = SHADOW_COMPARISON_KINDS.MATCH_NOOP;
    reasons.push('BOTH_NEGATIVE');
  } else if (activeApply && shadowApply) {
    comparisonKind = active.decisionKind === ACTIVE_APPLY && shadow.predictedDecision !== ACTION_POLICY_DECISIONS.ALLOW
      ? SHADOW_COMPARISON_KINDS.ACTIVE_MORE_AGGRESSIVE
      : SHADOW_COMPARISON_KINDS.MATCH_POSITIVE;
    reasons.push(comparisonKind);
  } else if (activeApply && !shadowApply) {
    comparisonKind = SHADOW_COMPARISON_KINDS.SHADOW_REJECTS_ACTIVE;
    reasons.push('ACTIVE_APPLY_SHADOW_BLOCKS');
  } else if (!activePositive(active.decisionKind) && shadowPositive(shadow.predictedDecision)) {
    comparisonKind = SHADOW_COMPARISON_KINDS.SHADOW_MORE_SENSITIVE;
    reasons.push('ACTIVE_NOOP_SHADOW_POSITIVE');
  } else if (activePositive(active.decisionKind) && !shadowPositive(shadow.predictedDecision)) {
    comparisonKind = SHADOW_COMPARISON_KINDS.ACTIVE_MORE_AGGRESSIVE;
    reasons.push('ACTIVE_POSITIVE_SHADOW_DENY');
  } else {
    comparisonKind = SHADOW_COMPARISON_KINDS.DIVERGENT_POSITIVE;
    reasons.push('POSITIVE_KIND_DIFFERS');
  }

  const comparison = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    comparisonKind,
    activeWouldApply: activeApply,
    shadowWouldApply: shadowApply,
    diverged: comparisonKind !== SHADOW_COMPARISON_KINDS.MATCH_NOOP
      && comparisonKind !== SHADOW_COMPARISON_KINDS.MATCH_POSITIVE,
    reasons,
  };
  return assertValidDto(comparison, validateShadowReplayComparisonV1, 'ShadowReplayComparisonV1');
}

/**
 * @param {{ active?: any, shadow?: any, comparison?: any, nowMs?: number, shadowRunId?: string }} [input]
 */
export function buildShadowReplayEventV1({ active, shadow, comparison, nowMs = Date.now(), shadowRunId } = {}) {
  const checkedActive = assertValidDto(active, validateShadowPolicySummaryV1, 'ShadowPolicySummaryV1');
  const checkedShadow = assertValidDto(shadow, validateShadowDecisionV1, 'ShadowDecisionV1');
  const checkedComparison = comparison
    ? assertValidDto(comparison, validateShadowReplayComparisonV1, 'ShadowReplayComparisonV1')
    : compareShadowReplayV1(checkedActive, checkedShadow);
  const event = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    shadowRunId: shadowRunId || checkedShadow.shadowRunId,
    timestampBucket: timestampBucket(nowMs),
    active: checkedActive,
    shadow: checkedShadow,
    comparison: checkedComparison,
  };
  return assertValidDto(event, validateShadowReplayEventV1, 'ShadowReplayEventV1');
}

export function createEmptyShadowReplayStoreV1() {
  return {
    schemaVersion: SHADOW_REPLAY_SCHEMA_VERSION,
    entries: [],
  };
}

function normalizeEntry(value) {
  const validation = validateShadowReplayEventV1(value);
  if (!validation.ok || byteSize(value) > SHADOW_REPLAY_MAX_ENTRY_BYTES) {
    return null;
  }
  return clone(value);
}

export function normalizeShadowReplayStoreV1(value, { nowMs = Date.now() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== SHADOW_REPLAY_SCHEMA_VERSION) {
    return createEmptyShadowReplayStoreV1();
  }
  const entries = Array.isArray(value.entries)
    ? value.entries.map(normalizeEntry).filter(Boolean)
    : [];
  return pruneShadowReplayStoreV1({ schemaVersion: SHADOW_REPLAY_SCHEMA_VERSION, entries }, { nowMs });
}

function bucketMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function pruneShadowReplayStoreV1(
  store,
  {
    nowMs = Date.now(),
    ttlMs = SHADOW_REPLAY_TTL_MS,
    maxEntries = SHADOW_REPLAY_MAX_ENTRIES,
    maxBytes = SHADOW_REPLAY_MAX_BYTES,
  } = {},
) {
  const cutoff = nowMs - ttlMs;
  const entries = (Array.isArray(store?.entries) ? store.entries : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .filter((entry) => bucketMs(entry.timestampBucket) >= cutoff)
    .sort((left, right) =>
      bucketMs(right.timestampBucket) - bucketMs(left.timestampBucket)
      || left.shadowRunId.localeCompare(right.shadowRunId)
    )
    .slice(0, Math.max(0, maxEntries));
  const next = { schemaVersion: SHADOW_REPLAY_SCHEMA_VERSION, entries };
  while (next.entries.length > 0 && byteSize(next) > maxBytes) {
    next.entries.pop();
  }
  return assertValidDto(next, validateShadowReplayStoreV1, 'ShadowReplayStoreV1');
}

export function reduceShadowReplayStoreV1(store, event, { nowMs = Date.now() } = {}) {
  const base = normalizeShadowReplayStoreV1(store, { nowMs });
  const entry = normalizeEntry(event);
  if (!entry) {
    return base;
  }
  const entries = base.entries.filter((candidate) => candidate.shadowRunId !== entry.shadowRunId);
  entries.push(entry);
  return pruneShadowReplayStoreV1({ schemaVersion: SHADOW_REPLAY_SCHEMA_VERSION, entries }, { nowMs });
}

export function summarizeShadowReplayStoreV1(store) {
  const normalized = normalizeShadowReplayStoreV1(store);
  const summary = {
    total: normalized.entries.length,
    diverged: 0,
    byComparisonKind: {},
  };
  for (const entry of normalized.entries) {
    const kind = entry.comparison.comparisonKind;
    summary.byComparisonKind[kind] = (summary.byComparisonKind[kind] || 0) + 1;
    if (entry.comparison.diverged) {
      summary.diverged += 1;
    }
  }
  return summary;
}
