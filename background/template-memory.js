import { DECISIONS, STORAGE_KEYS } from '../shared/constants.js';
import { extractDomain, getFromLocal, mutateLocalValue } from '../shared/utils.js';
import {
  ADAPTATION_ACTION_IDS,
  ADAPTATION_ACTION_ID_VALUES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  isEnumValue,
} from '../shared/engine-core/enums.js';
import {
  buildLearningEffectKeyV1,
  legacyLearningEffectKeyV1,
} from '../shared/engine-core/runtime-capability-matrix.js';
import {
  TEMPLATE_MEMORY_HASH_RE,
  TEMPLATE_MEMORY_HASH_VERSION,
  TEMPLATE_MEMORY_MAX_BYTES,
  TEMPLATE_MEMORY_MAX_ENTRIES,
  createEmptyTemplateMemoryV1,
  isTemplateMemoryHashV1,
  normalizeTemplateMemoryStoreV1,
  pruneTemplateMemoryV1,
  reduceTemplateMemoryOutcomeV1,
  validateTemplateMemoryStoreV1,
} from '../shared/engine-core/template-memory.js';
import { evaluateConservativePersonalizationGateV1 } from '../shared/engine-core/personalization-gate.js';
import { createTemplateEvidenceV1 } from './template-evidence.js';

const SECRET_RE = /^tms1_[A-Za-z0-9_-]{22}$/;
const HASH_BYTES = 16;
const NEGATIVE_TEMPLATE_MEMORY_EVENTS = new Set([
  OUTCOME_LEDGER_EVENTS.USER_UNDID,
  OUTCOME_LEDGER_EVENTS.ROLLED_BACK,
  OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED,
  OUTCOME_LEDGER_EVENTS.USER_NEVER_ON_SITE,
]);

function byteSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}

function base64UrlFromBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : typeof Buffer !== 'undefined'
      ? Buffer.from(binary, 'binary').toString('base64')
      : '';
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getCrypto() {
  return typeof globalThis !== 'undefined' ? globalThis.crypto : null;
}

function randomSecretValue() {
  const runtimeCrypto = getCrypto();
  if (!runtimeCrypto?.getRandomValues) {
    return null;
  }
  const bytes = new Uint8Array(HASH_BYTES);
  runtimeCrypto.getRandomValues(bytes);
  return `tms1_${base64UrlFromBytes(bytes).slice(0, 22)}`;
}

async function digestSha256(value) {
  const runtimeCrypto = getCrypto();
  if (!runtimeCrypto?.subtle?.digest || typeof TextEncoder !== 'function') {
    return null;
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await runtimeCrypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest).slice(0, HASH_BYTES);
}

async function getTemplateMemorySecret() {
  const current = await getFromLocal(STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1);
  if (SECRET_RE.test(current)) {
    return current;
  }
  const next = randomSecretValue();
  if (!next) {
    return null;
  }
  let selected = next;
  await mutateLocalValue(STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1, (storedSecret) => {
    if (SECRET_RE.test(storedSecret)) {
      selected = storedSecret;
      return storedSecret;
    }
    return next;
  });
  return selected;
}

async function hashTemplateValue(kind, value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return null;
  }
  const secret = await getTemplateMemorySecret();
  if (!secret) {
    return null;
  }
  const digest = await digestSha256(`${secret}:${kind}:${normalized}`);
  if (!digest) {
    return null;
  }
  return `${TEMPLATE_MEMORY_HASH_VERSION}_${base64UrlFromBytes(digest).slice(0, 22)}`;
}

function normalizeSiteKey(siteKey) {
  if (typeof siteKey !== 'string' || !siteKey.trim()) {
    return null;
  }
  const domain = extractDomain(siteKey);
  return domain && domain !== 'unknown' ? domain : null;
}

function canonicalShape(value) {
  const normalized = stableJsonValue(value);
  if (!normalized || typeof normalized !== 'object') {
    return null;
  }
  const json = JSON.stringify(normalized);
  return json && json !== '{}' && json !== '[]' ? json : null;
}

function stableJsonValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      const child = stableJsonValue(value[key]);
      if (child !== null) {
        acc[key] = child;
      }
      return acc;
    }, {});
}

async function resolveDomainHash(input) {
  if (isTemplateMemoryHashV1(input?.domainHash)) {
    return input.domainHash;
  }
  const siteKey = normalizeSiteKey(input?.siteKey);
  return siteKey ? hashTemplateValue('domain', siteKey) : null;
}

async function resolveTemplateHash(input) {
  if (isTemplateMemoryHashV1(input?.templateHash)) {
    return input.templateHash;
  }
  const signature = canonicalShape(input?.templateSignature || input?.shape);
  return signature ? hashTemplateValue('template', signature) : null;
}

function normalizeEvent(input) {
  const event = input?.event;
  return Object.values(OUTCOME_LEDGER_EVENTS).includes(event) ? event : null;
}

function normalizePageType(input) {
  return isEnumValue(Object.values(PAGE_TYPES), input?.pageType) ? input.pageType : PAGE_TYPES.UNKNOWN;
}

function normalizeActionId(input) {
  return isEnumValue(ADAPTATION_ACTION_ID_VALUES, input?.actionId) ? input.actionId : null;
}

function normalizeLearningEffectKey(input) {
  try {
    const key = buildLearningEffectKeyV1(input?.learningEffectKey);
    if (key.actionId === input?.actionId && key.pageType === input?.pageType) {
      return key;
    }
    return null;
  } catch {
    return legacyLearningEffectKeyV1({
      modeId: input?.modeId,
      actionId: input?.actionId,
      pageType: input?.pageType,
      targetKind: input?.targetKind,
      effectClass: input?.effectClass,
    });
  }
}

async function readTemplateMemoryStore(nowMs = Date.now()) {
  return normalizeTemplateMemoryStoreV1(await getFromLocal(STORAGE_KEYS.TEMPLATE_MEMORY_V1), { nowMs });
}

async function getTemplateMemoryBytesInUse() {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.getBytesInUse) {
      return await chrome.storage.local.getBytesInUse(STORAGE_KEYS.TEMPLATE_MEMORY_V1);
    }
  } catch {
    return null;
  }
  return null;
}

async function enforceTemplateMemoryQuota(store, nowMs) {
  let next = pruneTemplateMemoryV1(store, { nowMs });
  const currentBytes = await getTemplateMemoryBytesInUse();
  if (typeof currentBytes === 'number' && currentBytes > TEMPLATE_MEMORY_MAX_BYTES && next.entries.length > 1) {
    next = pruneTemplateMemoryV1(next, {
      nowMs,
      maxEntries: Math.max(1, Math.floor(next.entries.length / 2)),
      maxBytes: TEMPLATE_MEMORY_MAX_BYTES,
    });
  }
  while (next.entries.length > 0 && byteSize(next) > TEMPLATE_MEMORY_MAX_BYTES) {
    next = pruneTemplateMemoryV1({
      ...next,
      entries: next.entries.slice(0, -1),
    }, { nowMs, maxEntries: TEMPLATE_MEMORY_MAX_ENTRIES, maxBytes: TEMPLATE_MEMORY_MAX_BYTES });
  }
  return next;
}

async function writeTemplateMemoryEvent(input = {}, { nowMs = Date.now() } = {}) {
  const event = normalizeEvent(input);
  const actionId = normalizeActionId(input);
  if (!event || !actionId) {
    return { recorded: false, reason: 'INVALID_EVENT' };
  }
  if (event === OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE && actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    return { recorded: false, reason: 'PAGE_CLARITY_LEARNING_DISABLED' };
  }

  const domainHash = await resolveDomainHash(input);
  const templateHash = await resolveTemplateHash(input);
  if (!TEMPLATE_MEMORY_HASH_RE.test(domainHash || '') || !TEMPLATE_MEMORY_HASH_RE.test(templateHash || '')) {
    return { recorded: false, reason: 'MISSING_TEMPLATE_HASH' };
  }

  const learningEffectKey = normalizeLearningEffectKey({
    ...input,
    actionId,
    pageType: normalizePageType(input),
  });
  if (
    event === OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE
    && !learningEffectKey
    && ![
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    ].includes(actionId)
  ) {
    return { recorded: false, reason: 'MISSING_LEARNING_EFFECT_KEY' };
  }
  let result = null;
  await mutateLocalValue(STORAGE_KEYS.TEMPLATE_MEMORY_V1, async (storedMemory) => {
    const current = normalizeTemplateMemoryStoreV1(storedMemory, { nowMs });
    const next = reduceTemplateMemoryOutcomeV1(current, {
      domainHash,
      templateHash,
      pageType: normalizePageType(input),
      roleDistribution: input.roleDistribution,
      riskBands: input.riskBands,
      scopeFingerprints: input.scopeFingerprints,
      actionId,
      learningEffectKey,
      event,
    }, { nowMs });
    const bounded = await enforceTemplateMemoryQuota(next, nowMs);
    const validation = validateTemplateMemoryStoreV1(bounded);
    if (!validation.ok) {
      result = { recorded: false, reason: 'VALIDATION_FAILED', errors: validation.errors };
      return current;
    }
    result = { recorded: true, store: bounded };
    return bounded;
  });
  return result;
}

export async function recordTemplateMemoryOutcome(input = {}, { nowMs = Date.now() } = {}) {
  if (input?.event !== OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE || input?.learningEligible !== true) {
    return { recorded: false, reason: 'NOT_LEARNING_ELIGIBLE' };
  }
  return writeTemplateMemoryEvent(input, { nowMs });
}

export async function recordTemplateMemoryNegativeOutcome(input = {}, { nowMs = Date.now() } = {}) {
  const event = normalizeEvent(input);
  if (!NEGATIVE_TEMPLATE_MEMORY_EVENTS.has(event)) {
    return { recorded: false, reason: 'NOT_NEGATIVE_OUTCOME' };
  }
  return writeTemplateMemoryEvent(input, { nowMs });
}

export async function recordEligibleTemplateOutcome(event = {}, options = {}) {
  if (event?.event !== OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE || event?.learningEligible !== true) {
    return { recorded: false, reason: 'NOT_LEARNING_ELIGIBLE' };
  }
  if (event?.decision && event.decision !== DECISIONS.ENABLED) {
    return { recorded: false, reason: 'NOT_POSITIVE_DECISION' };
  }
  return recordTemplateMemoryOutcome({
    ...event,
    event: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
  }, options);
}

export async function buildTemplateMemoryEvidence(input = {}) {
  const actionId = normalizeActionId(input);
  if (!actionId) {
    return null;
  }
  const domainHash = await resolveDomainHash(input);
  const templateHash = await resolveTemplateHash(input);
  return createTemplateEvidenceV1({
    domainHash,
    templateHash,
    pageType: normalizePageType(input),
    actionId,
    frameId: input.frameId,
    profileHash: input.profileHash,
    learningEffectKey: normalizeLearningEffectKey({
      ...input,
      actionId,
      pageType: normalizePageType(input),
    }),
  });
}

export async function evaluateTemplatePersonalizationGate(input = {}, { nowMs = Date.now(), allowedPageTypes, explicitlyAllowedPageTypes } = {}) {
  const actionId = normalizeActionId(input);
  if (!actionId) {
    return { allowed: false, reasons: ['INVALID_ACTION_ID'] };
  }
  const templateHash = await resolveTemplateHash(input);
  const domainHash = await resolveDomainHash(input);
  if (!TEMPLATE_MEMORY_HASH_RE.test(domainHash || '') || !TEMPLATE_MEMORY_HASH_RE.test(templateHash || '')) {
    return { allowed: false, reasons: ['MISSING_TEMPLATE_HASH'] };
  }
  const store = await readTemplateMemoryStore(nowMs);
  const pageType = normalizePageType(input);
  const entry = store.entries.find((candidate) =>
    candidate.domainHash === domainHash
    && candidate.templateHash === templateHash
    && candidate.pageType === pageType
  );
  return evaluateConservativePersonalizationGateV1({
    ...input.profile,
    domainHash,
    templateHash,
    pageType,
    learningEffectKey: normalizeLearningEffectKey({
      ...input,
      actionId,
      pageType,
    }),
    risk: input.risk || input.profile?.risk,
  }, actionId, entry, { allowedPageTypes, explicitlyAllowedPageTypes });
}

export async function hashTemplateMemoryValueForTests(kind, value) {
  return hashTemplateValue(kind, value);
}

export async function getTemplateMemoryForTests() {
  return readTemplateMemoryStore();
}

export async function clearTemplateMemoryForTests() {
  await mutateLocalValue(STORAGE_KEYS.TEMPLATE_MEMORY_V1, () => createEmptyTemplateMemoryV1());
  await mutateLocalValue(STORAGE_KEYS.TEMPLATE_MEMORY_SECRET_V1, () => null);
}
