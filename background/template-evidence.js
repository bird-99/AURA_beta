import {
  ADAPTATION_ACTION_ID_VALUES,
  PAGE_TYPE_VALUES,
  isEnumValue,
} from '../shared/engine-core/enums.js';
import { buildLearningEffectKeyV1 } from '../shared/engine-core/runtime-capability-matrix.js';
import { isTemplateMemoryHashV1 } from '../shared/engine-core/template-memory.js';

export const TEMPLATE_EVIDENCE_VERSION = 1;
export const TEMPLATE_EVIDENCE_SOURCE = 'TEMPLATE_EVIDENCE_V1';
const SAFE_PROFILE_HASH_RE = /^(?:shr1|tmh1)_[A-Za-z0-9_-]{6,96}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeProfileHash(value) {
  if (typeof value !== 'string' || !SAFE_PROFILE_HASH_RE.test(value)) {
    return null;
  }
  return value.slice(0, 96);
}

export function createTemplateEvidenceV1({
  domainHash,
  templateHash,
  pageType,
  actionId,
  frameId,
  profileHash,
  learningEffectKey,
} = {}) {
  if (!isTemplateMemoryHashV1(templateHash)
    || !isEnumValue(PAGE_TYPE_VALUES, pageType)
    || !isEnumValue(ADAPTATION_ACTION_ID_VALUES, actionId)
    || typeof frameId !== 'number'
    || !Number.isFinite(frameId)
    || frameId < 0) {
    return null;
  }

  const evidence = {
    version: TEMPLATE_EVIDENCE_VERSION,
    source: TEMPLATE_EVIDENCE_SOURCE,
    templateHash,
    pageType,
    actionId,
    frameId: Math.floor(frameId),
  };
  if (isTemplateMemoryHashV1(domainHash)) {
    evidence.domainHash = domainHash;
  }
  try {
    const normalizedLearningEffectKey = buildLearningEffectKeyV1(learningEffectKey);
    if (normalizedLearningEffectKey.actionId === actionId && normalizedLearningEffectKey.pageType === pageType) {
      evidence.learningEffectKey = normalizedLearningEffectKey;
    }
  } catch {
    // LearningEffectKeyV1 is optional evidence; invalid or missing keys are ignored for legacy compatibility.
  }
  const normalizedProfileHash = safeProfileHash(profileHash);
  if (normalizedProfileHash) {
    evidence.profileHash = normalizedProfileHash;
  }
  return evidence;
}

export function normalizeTemplateEvidenceV1(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.version !== TEMPLATE_EVIDENCE_VERSION || value.source !== TEMPLATE_EVIDENCE_SOURCE) {
    return null;
  }
  return createTemplateEvidenceV1(value);
}

export function templateEvidenceForFrame(value, frameId) {
  const evidence = normalizeTemplateEvidenceV1(value);
  if (!evidence || evidence.frameId !== frameId) {
    return null;
  }
  return evidence;
}

export function templateEvidenceForLedger(value) {
  const evidence = normalizeTemplateEvidenceV1(value);
  if (!evidence) {
    return {};
  }
  const ledger = {
    templateHash: evidence.templateHash,
    pageType: evidence.pageType,
  };
  if (evidence.profileHash) {
    ledger.profileHash = evidence.profileHash;
  }
  if (evidence.learningEffectKey) {
    ledger.learningEffectKey = evidence.learningEffectKey;
  }
  return ledger;
}

export function templateEvidenceForTemplateMemory(value, { siteKey, event } = {}) {
  const evidence = normalizeTemplateEvidenceV1(value);
  if (!evidence) {
    return null;
  }
  const templateMemoryEvidence = {
    siteKey,
    templateHash: evidence.templateHash,
    pageType: evidence.pageType,
    actionId: evidence.actionId,
    event,
  };
  if (evidence.learningEffectKey) {
    templateMemoryEvidence.learningEffectKey = evidence.learningEffectKey;
  }
  if (evidence.domainHash) {
    templateMemoryEvidence.domainHash = evidence.domainHash;
  }
  return templateMemoryEvidence;
}
