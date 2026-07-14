import {
  ADAPTATION_ACTION_ID_VALUES,
  EFFECT_CLASS_VALUES,
  PAGE_TYPES,
  PAGE_TYPE_VALUES,
  TARGET_KIND_VALUES,
  isEnumValue,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';
import {
  TEMPLATE_MEMORY_MIN_RELIABLE_POSITIVES,
  isTemplateMemoryHashV1,
} from './template-memory.js';

export const CONSERVATIVE_PERSONALIZATION_GATE_VERSION = 1;
export const CONSERVATIVE_PERSONALIZATION_GATE_SOURCE = 'CONSERVATIVE_PERSONALIZATION_V1';
export const CONSERVATIVE_PERSONALIZATION_MIN_ACCEPTS = TEMPLATE_MEMORY_MIN_RELIABLE_POSITIVES;
export const CONSERVATIVE_PERSONALIZATION_MAX_LAYOUT_RISK = 0.25;
export const CONSERVATIVE_PERSONALIZATION_MAX_INTERACTION_RISK = 0.30;
export const CONSERVATIVE_PERSONALIZATION_ALLOWED_PAGE_TYPES = Object.freeze([
  PAGE_TYPES.ARTICLE,
  PAGE_TYPES.DOC,
  PAGE_TYPES.SEARCH,
]);

const COUNTER_KEYS = Object.freeze([
  'postApplyPassedCount',
  'learningEligibleCount',
  'undoCount',
  'rollbackCount',
  'postApplyFailedCount',
  'neverOnSiteCount',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.min(1000000, Math.floor(numeric));
}

function clamp01OrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(1, Math.max(0, numeric));
}

function normalizeCounter(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const counter = {
    actionId: isEnumValue(ADAPTATION_ACTION_ID_VALUES, source.actionId) ? source.actionId : null,
    learningEffectKey: normalizeLearningEffectKey(source.learningEffectKey),
    postApplyPassedCount: 0,
    learningEligibleCount: 0,
    undoCount: 0,
    rollbackCount: 0,
    postApplyFailedCount: 0,
    neverOnSiteCount: 0,
  };
  COUNTER_KEYS.forEach((key) => {
    counter[key] = clampCounter(source[key]);
  });
  return counter;
}

function normalizeLearningEffectKey(raw) {
  if (!isPlainObject(raw)) return null;
  const key = {
    modeId: Object.values(GUARANTEED_EFFECT_MODE_IDS).includes(raw.modeId) ? raw.modeId : null,
    actionId: isEnumValue(ADAPTATION_ACTION_ID_VALUES, raw.actionId) ? raw.actionId : null,
    targetKind: isEnumValue(TARGET_KIND_VALUES, raw.targetKind) ? raw.targetKind : null,
    effectClass: isEnumValue(EFFECT_CLASS_VALUES, raw.effectClass) ? raw.effectClass : null,
    pageType: isEnumValue(PAGE_TYPE_VALUES, raw.pageType) ? raw.pageType : null,
  };
  return Object.values(key).some((value) => value == null) ? null : key;
}

function learningEffectKeyId(key) {
  const normalized = normalizeLearningEffectKey(key);
  return normalized
    ? [
      normalized.modeId,
      normalized.actionId,
      normalized.targetKind,
      normalized.effectClass,
      normalized.pageType,
    ].join('|')
    : null;
}

function counterForAction(entry, actionId, learningEffectKey = null) {
  if (!isPlainObject(entry) || !Array.isArray(entry.actionCounters)) {
    return null;
  }
  const keyId = learningEffectKeyId(learningEffectKey);
  if (keyId) {
    const keyedCounter = entry.actionCounters.find((candidate) =>
      learningEffectKeyId(candidate?.learningEffectKey) === keyId
    );
    if (keyedCounter) {
      return normalizeCounter(keyedCounter);
    }
  }
  const legacyCounter = entry.actionCounters.find((candidate) =>
    candidate?.actionId === actionId && !candidate?.learningEffectKey
  );
  return legacyCounter ? normalizeCounter(legacyCounter) : null;
}

function riskFromProfile(profile) {
  const risk = isPlainObject(profile?.risk) ? profile.risk : {};
  return {
    layoutRisk: clamp01OrNull(risk.layoutRisk),
    interactionRisk: clamp01OrNull(risk.interactionRisk),
  };
}

function normalizePageType(profile, entry) {
  if (isEnumValue(PAGE_TYPE_VALUES, profile?.pageType)) {
    return profile.pageType;
  }
  if (isEnumValue(PAGE_TYPE_VALUES, entry?.pageType)) {
    return entry.pageType;
  }
  return PAGE_TYPES.UNKNOWN;
}

function makeGate(reasons, evidence) {
  return {
    version: CONSERVATIVE_PERSONALIZATION_GATE_VERSION,
    source: CONSERVATIVE_PERSONALIZATION_GATE_SOURCE,
    allowed: reasons.length === 0,
    reasons: reasons.length ? reasons : ['OK'],
    evidence,
    constraints: {
      denyOnly: true,
      policyRequired: true,
      postApplyInspectionRequired: true,
      runtimeApplyMayNotBypassExistingGuards: true,
    },
  };
}

export function evaluateConservativePersonalizationGateV1(profile, actionId, entry, options = {}) {
  const reasons = [];
  const pageType = normalizePageType(profile, entry);
  const allowedPageTypes = new Set(
    Array.isArray(options.allowedPageTypes)
      ? options.allowedPageTypes.filter((candidate) => isEnumValue(PAGE_TYPE_VALUES, candidate))
      : CONSERVATIVE_PERSONALIZATION_ALLOWED_PAGE_TYPES,
  );
  const explicitlyAllowedPageTypes = new Set(
    Array.isArray(options.explicitlyAllowedPageTypes)
      ? options.explicitlyAllowedPageTypes.filter((candidate) => isEnumValue(PAGE_TYPE_VALUES, candidate))
      : [],
  );

  if (!isEnumValue(ADAPTATION_ACTION_ID_VALUES, actionId)) {
    reasons.push('INVALID_ACTION_ID');
  }
  if (!isPlainObject(profile)) {
    reasons.push('MISSING_PROFILE');
  }
  if (!isPlainObject(entry)) {
    reasons.push('MISSING_TEMPLATE_ENTRY');
  }

  const profileTemplateHash = profile?.templateHash;
  const profileDomainHash = profile?.domainHash;
  if (!isTemplateMemoryHashV1(profileDomainHash)) {
    reasons.push('MISSING_PROFILE_DOMAIN_HASH');
  }
  if (!isTemplateMemoryHashV1(entry?.domainHash)) {
    reasons.push('MISSING_ENTRY_DOMAIN_HASH');
  }
  if (
    isTemplateMemoryHashV1(profileDomainHash)
    && isTemplateMemoryHashV1(entry?.domainHash)
    && profileDomainHash !== entry.domainHash
  ) {
    reasons.push('DOMAIN_MISMATCH');
  }
  if (!isTemplateMemoryHashV1(profileTemplateHash)) {
    reasons.push('MISSING_PROFILE_TEMPLATE_HASH');
  }
  if (!isTemplateMemoryHashV1(entry?.templateHash)) {
    reasons.push('MISSING_ENTRY_TEMPLATE_HASH');
  }
  if (
    isTemplateMemoryHashV1(profileTemplateHash)
    && isTemplateMemoryHashV1(entry?.templateHash)
    && profileTemplateHash !== entry.templateHash
  ) {
    reasons.push('TEMPLATE_MISMATCH');
  }

  if (!allowedPageTypes.has(pageType) && !explicitlyAllowedPageTypes.has(pageType)) {
    reasons.push('PAGE_TYPE_NOT_ALLOWED');
  }

  const learningEffectKey = normalizeLearningEffectKey(options.learningEffectKey || profile?.learningEffectKey);
  const counter = counterForAction(entry, actionId, learningEffectKey);
  if (!counter) {
    reasons.push('MISSING_ACTION_COUNTER');
  } else {
    if (counter.learningEligibleCount < CONSERVATIVE_PERSONALIZATION_MIN_ACCEPTS) {
      reasons.push('INSUFFICIENT_ACCEPTS');
    }
    if (counter.learningEligibleCount < CONSERVATIVE_PERSONALIZATION_MIN_ACCEPTS && counter.postApplyPassedCount <= 0) {
      reasons.push('MISSING_POST_APPLY_SAFETY_EVIDENCE');
    }
    if (counter.undoCount > 0) reasons.push('USER_UNDID_BLOCK');
    if (counter.rollbackCount > 0) reasons.push('ROLLBACK_BLOCK');
    if (counter.postApplyFailedCount > 0) reasons.push('POST_APPLY_FAILED_BLOCK');
    if (counter.neverOnSiteCount > 0) reasons.push('NEVER_ON_SITE_BLOCK');
  }

  const risk = riskFromProfile(profile);
  if (risk.layoutRisk == null) {
    reasons.push('MISSING_LIVE_LAYOUT_RISK');
  } else if (risk.layoutRisk >= CONSERVATIVE_PERSONALIZATION_MAX_LAYOUT_RISK) {
    reasons.push('LAYOUT_RISK_TOO_HIGH');
  }
  if (risk.interactionRisk == null) {
    reasons.push('MISSING_LIVE_INTERACTION_RISK');
  } else if (risk.interactionRisk >= CONSERVATIVE_PERSONALIZATION_MAX_INTERACTION_RISK) {
    reasons.push('INTERACTION_RISK_TOO_HIGH');
  }

  return makeGate(reasons, {
    actionId,
    pageType,
    domainMatch: isTemplateMemoryHashV1(profileDomainHash)
      && isTemplateMemoryHashV1(entry?.domainHash)
      && profileDomainHash === entry.domainHash,
    templateMatch: isTemplateMemoryHashV1(profileTemplateHash)
      && isTemplateMemoryHashV1(entry?.templateHash)
      && profileTemplateHash === entry.templateHash,
    layoutRisk: risk.layoutRisk,
    interactionRisk: risk.interactionRisk,
    counts: counter || null,
    learningEffectKey,
    thresholds: {
      minAccepts: CONSERVATIVE_PERSONALIZATION_MIN_ACCEPTS,
      maxLayoutRisk: CONSERVATIVE_PERSONALIZATION_MAX_LAYOUT_RISK,
      maxInteractionRisk: CONSERVATIVE_PERSONALIZATION_MAX_INTERACTION_RISK,
    },
  });
}

export function isConservativePersonalizationGateAllowedV1(gate) {
  if (!isPlainObject(gate)
    || gate.version !== CONSERVATIVE_PERSONALIZATION_GATE_VERSION
    || gate.source !== CONSERVATIVE_PERSONALIZATION_GATE_SOURCE
    || gate.allowed !== true) {
    return false;
  }
  if (!Array.isArray(gate.reasons) || gate.reasons.length !== 1 || gate.reasons[0] !== 'OK') {
    return false;
  }
  const constraints = gate.constraints;
  if (!isPlainObject(constraints)
    || constraints.denyOnly !== true
    || constraints.policyRequired !== true
    || constraints.postApplyInspectionRequired !== true
    || constraints.runtimeApplyMayNotBypassExistingGuards !== true) {
    return false;
  }
  const evidence = gate.evidence;
  const counts = evidence?.counts;
  return isPlainObject(evidence)
    && evidence.domainMatch === true
    && evidence.templateMatch === true
    && CONSERVATIVE_PERSONALIZATION_ALLOWED_PAGE_TYPES.includes(evidence.pageType)
    && clamp01OrNull(evidence.layoutRisk) !== null
    && evidence.layoutRisk < CONSERVATIVE_PERSONALIZATION_MAX_LAYOUT_RISK
    && clamp01OrNull(evidence.interactionRisk) !== null
    && evidence.interactionRisk < CONSERVATIVE_PERSONALIZATION_MAX_INTERACTION_RISK
    && isPlainObject(counts)
    && counts.learningEligibleCount >= CONSERVATIVE_PERSONALIZATION_MIN_ACCEPTS
    && counts.undoCount === 0
    && counts.rollbackCount === 0
    && counts.postApplyFailedCount === 0
    && counts.neverOnSiteCount === 0;
}
