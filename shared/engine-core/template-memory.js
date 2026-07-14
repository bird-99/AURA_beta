import { DTO_CAPS, ENGINE_CORE_SCHEMA_VERSION, PRIVACY_FORBIDDEN_KEYS } from './contracts.js';
import {
  ADAPTATION_ACTION_ID_VALUES,
  BLOCK_ROLE_VALUES,
  EFFECT_CLASS_VALUES,
  TARGET_KIND_VALUES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPE_VALUES,
  REASON_CODE_VALUES,
  isEnumValue,
} from './enums.js';
import { GUARANTEED_EFFECT_MODE_IDS } from './guaranteed-effect-matrix.js';

export const TEMPLATE_MEMORY_SCHEMA_VERSION = 1;
export const TEMPLATE_MEMORY_HASH_VERSION = 'tmh1';
export const TEMPLATE_MEMORY_HASH_RE = /^tmh1_[A-Za-z0-9_-]{22}$/;
export const TEMPLATE_MEMORY_MAX_ENTRIES = 300;
export const TEMPLATE_MEMORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const TEMPLATE_MEMORY_MAX_BYTES = 256 * 1024;
export const TEMPLATE_MEMORY_MAX_ENTRY_BYTES = 1536;
export const TEMPLATE_MEMORY_MIN_RELIABLE_POSITIVES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_COUNTER = 1000000;
const MAX_ROLE_DISTRIBUTION = 12;
const MAX_SCOPE_FINGERPRINTS = 5;
const MAX_REASONS_PER_SCOPE = 5;
const BIN_KEYS = Object.freeze(['x', 'y', 'w', 'h', 'visible']);
const METRIC_BIN_KEYS = Object.freeze([
  'textDensity',
  'linkDensity',
  'interactiveDensity',
  'mediaDensity',
  'formDensity',
  'tableDensity',
  'viewportCoverage',
]);
const RISK_KEYS = Object.freeze(['layout', 'interaction', 'confidence']);
const RISK_BANDS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);
const COUNTER_KEYS = Object.freeze([
  'postApplyPassedCount',
  'learningEligibleCount',
  'undoCount',
  'rollbackCount',
  'postApplyFailedCount',
  'neverOnSiteCount',
]);
const OUTCOME_TO_COUNTER = Object.freeze({
  [OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED]: 'postApplyPassedCount',
  [OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE]: 'learningEligibleCount',
  [OUTCOME_LEDGER_EVENTS.USER_UNDID]: 'undoCount',
  [OUTCOME_LEDGER_EVENTS.ROLLED_BACK]: 'rollbackCount',
  [OUTCOME_LEDGER_EVENTS.POST_APPLY_FAILED]: 'postApplyFailedCount',
  [OUTCOME_LEDGER_EVENTS.USER_NEVER_ON_SITE]: 'neverOnSiteCount',
});
const TEMPLATE_MEMORY_FORBIDDEN_KEYS = Object.freeze([
  ...PRIVACY_FORBIDDEN_KEYS,
  'scopeSelector',
  'urlKey',
  'routeFingerprint',
  'chosenRoot',
  'id',
  'class',
  'className',
  'cssText',
  'cssId',
  'attemptId',
  'timestampMs',
  'pathname',
  'query',
]);
const STORE_KEYS = Object.freeze(['schemaVersion', 'hashVersion', 'entries']);
const ENTRY_KEYS = Object.freeze([
  'domainHash',
  'templateHash',
  'pageType',
  'roleDistribution',
  'riskBands',
  'scopeFingerprints',
  'actionCounters',
  'seenCount',
  'firstSeenBucket',
  'lastSeenBucket',
]);
const ROLE_KEYS = Object.freeze(['role', 'count']);
const SCOPE_KEYS = Object.freeze([
  'scopeHash',
  'roleHint',
  'confidenceBand',
  'boxBins',
  'metricBins',
  'reasonCodes',
]);
const COUNTER_RECORD_KEYS = Object.freeze([
  'actionId',
  'learningEffectKey',
  ...COUNTER_KEYS,
  'lastOutcomeEvent',
  'lastOutcomeBucket',
]);
const LEARNING_EFFECT_KEY_KEYS = Object.freeze([
  'modeId',
  'actionId',
  'targetKind',
  'effectClass',
  'pageType',
]);

function result(errors) {
  return { ok: errors.length === 0, errors };
}

function add(errors, path, message) {
  errors.push({ path, message });
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectExtraKeys(value, allowedKeys, errors, path, label) {
  if (!isPlainRecord(value)) return;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      add(errors, `${path}.${key}`, `unexpected ${label} field`);
    }
  }
}

function checkSensitiveKeys(value, errors, path = '$', seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    add(errors, path, 'cyclic objects are not allowed');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkSensitiveKeys(item, errors, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!isPlainRecord(value)) {
    add(errors, path, 'only plain JSON records are allowed');
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (TEMPLATE_MEMORY_FORBIDDEN_KEYS.includes(key)) {
      add(errors, `${path}.${key}`, `forbidden template memory key "${key}"`);
    }
    if (typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint' || typeof child === 'undefined') {
      add(errors, `${path}.${key}`, 'value must be JSON-compatible');
    }
    if (typeof child === 'number' && !Number.isFinite(child)) {
      add(errors, `${path}.${key}`, 'number must be finite');
    }
    if (typeof child === 'string' && /\bhttps?:\/\//i.test(child)) {
      add(errors, `${path}.${key}`, 'full URLs are not allowed');
    }
    checkSensitiveKeys(child, errors, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function createEmptyTemplateMemoryV1() {
  return {
    schemaVersion: TEMPLATE_MEMORY_SCHEMA_VERSION,
    hashVersion: TEMPLATE_MEMORY_HASH_VERSION,
    entries: [],
  };
}

export function isTemplateMemoryHashV1(value) {
  return typeof value === 'string' && TEMPLATE_MEMORY_HASH_RE.test(value);
}

export function toTemplateMemoryDayBucket(ms) {
  const value = typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0;
  return Math.floor(value / DAY_MS);
}

function byteSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Infinity;
  }
}

function clampCounter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.min(MAX_COUNTER, Math.floor(numeric));
}

function clampBin(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.min(10, Math.floor(numeric));
}

function bandFromNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'UNKNOWN';
  if (numeric <= 0.34) return 'LOW';
  if (numeric >= 0.65) return 'HIGH';
  return 'MEDIUM';
}

function normalizeBand(value) {
  return RISK_BANDS.includes(value) ? value : bandFromNumber(value);
}

function normalizeRiskBands(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  return {
    layout: normalizeBand(source.layout ?? source.layoutRisk),
    interaction: normalizeBand(source.interaction ?? source.interactionRisk),
    confidence: normalizeBand(source.confidence ?? source.confidenceRisk),
  };
}

function normalizeRoleDistribution(raw) {
  if (!Array.isArray(raw)) return [];
  const counts = new Map();
  raw.slice(0, MAX_ROLE_DISTRIBUTION).forEach((entry) => {
    if (!isPlainRecord(entry) || !isEnumValue(BLOCK_ROLE_VALUES, entry.role)) return;
    counts.set(entry.role, Math.min(1000, (counts.get(entry.role) || 0) + clampCounter(entry.count)));
  });
  return Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((left, right) => left.role.localeCompare(right.role));
}

function normalizeBins(raw, keys) {
  const source = isPlainRecord(raw) ? raw : {};
  return Object.fromEntries(keys.map((key) => [key, clampBin(source[key])]));
}

function normalizeScopeFingerprints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SCOPE_FINGERPRINTS)
    .filter(isPlainRecord)
    .map((entry) => {
      const next = {
        roleHint: isEnumValue(BLOCK_ROLE_VALUES, entry.roleHint) ? entry.roleHint : 'UNKNOWN',
        confidenceBand: normalizeBand(entry.confidenceBand),
        boxBins: normalizeBins(entry.boxBins, BIN_KEYS),
        metricBins: normalizeBins(entry.metricBins, METRIC_BIN_KEYS),
        reasonCodes: Array.isArray(entry.reasonCodes)
          ? entry.reasonCodes.filter((reason) => isEnumValue(REASON_CODE_VALUES, reason)).slice(0, MAX_REASONS_PER_SCOPE)
          : [],
      };
      if (isTemplateMemoryHashV1(entry.scopeHash)) {
        next.scopeHash = entry.scopeHash;
      }
      return next;
    });
}

function normalizeLearningEffectKey(raw) {
  if (!isPlainRecord(raw)) return null;
  const key = {
    modeId: Object.values(GUARANTEED_EFFECT_MODE_IDS).includes(raw.modeId) ? raw.modeId : null,
    actionId: isEnumValue(ADAPTATION_ACTION_ID_VALUES, raw.actionId) ? raw.actionId : null,
    targetKind: isEnumValue(TARGET_KIND_VALUES, raw.targetKind) ? raw.targetKind : null,
    effectClass: isEnumValue(EFFECT_CLASS_VALUES, raw.effectClass) ? raw.effectClass : null,
    pageType: isEnumValue(PAGE_TYPE_VALUES, raw.pageType) ? raw.pageType : null,
  };
  if (Object.values(key).some((value) => value == null)) {
    return null;
  }
  return key;
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

function normalizeActionCounters(raw) {
  if (!Array.isArray(raw)) return [];
  const byAction = new Map();
  raw.forEach((entry) => {
    if (!isPlainRecord(entry) || !isEnumValue(ADAPTATION_ACTION_ID_VALUES, entry.actionId)) return;
    const candidateLearningEffectKey = normalizeLearningEffectKey(entry.learningEffectKey);
    const learningEffectKey = candidateLearningEffectKey?.actionId === entry.actionId
      ? candidateLearningEffectKey
      : null;
    const identity = learningEffectKeyId(learningEffectKey) || `legacy:${entry.actionId}`;
    const current = byAction.get(identity) || {
      actionId: entry.actionId,
      postApplyPassedCount: 0,
      learningEligibleCount: 0,
      undoCount: 0,
      rollbackCount: 0,
      postApplyFailedCount: 0,
      neverOnSiteCount: 0,
      lastOutcomeEvent: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      lastOutcomeBucket: 0,
    };
    if (learningEffectKey) {
      current.learningEffectKey = learningEffectKey;
    }
    COUNTER_KEYS.forEach((key) => {
      current[key] = Math.min(MAX_COUNTER, current[key] + clampCounter(entry[key]));
    });
    if (Object.prototype.hasOwnProperty.call(OUTCOME_TO_COUNTER, entry.lastOutcomeEvent)) {
      current.lastOutcomeEvent = entry.lastOutcomeEvent;
    }
    current.lastOutcomeBucket = Math.max(current.lastOutcomeBucket, clampCounter(entry.lastOutcomeBucket));
    byAction.set(identity, current);
  });
  return Array.from(byAction.values()).sort((left, right) =>
    left.actionId.localeCompare(right.actionId)
    || String(learningEffectKeyId(left.learningEffectKey) || '').localeCompare(String(learningEffectKeyId(right.learningEffectKey) || '')));
}

function normalizeEntry(raw) {
  if (!isPlainRecord(raw)) return null;
  if (!isTemplateMemoryHashV1(raw.domainHash) || !isTemplateMemoryHashV1(raw.templateHash)) {
    return null;
  }
  if (!isEnumValue(PAGE_TYPE_VALUES, raw.pageType)) {
    return null;
  }
  const entry = {
    domainHash: raw.domainHash,
    templateHash: raw.templateHash,
    pageType: raw.pageType,
    roleDistribution: normalizeRoleDistribution(raw.roleDistribution),
    riskBands: normalizeRiskBands(raw.riskBands),
    scopeFingerprints: normalizeScopeFingerprints(raw.scopeFingerprints),
    actionCounters: normalizeActionCounters(raw.actionCounters),
    seenCount: clampCounter(raw.seenCount),
    firstSeenBucket: clampCounter(raw.firstSeenBucket),
    lastSeenBucket: clampCounter(raw.lastSeenBucket),
  };
  return byteSize(entry) <= TEMPLATE_MEMORY_MAX_ENTRY_BYTES ? entry : null;
}

export function validateTemplateMemoryStoreV1(value) {
  const errors = [];
  checkSensitiveKeys(value, errors);
  if (!isPlainRecord(value)) {
    add(errors, '$', 'template memory must be a plain record');
    return result(errors);
  }
  rejectExtraKeys(value, STORE_KEYS, errors, '$', 'template memory');
  if (value.schemaVersion !== TEMPLATE_MEMORY_SCHEMA_VERSION) {
    add(errors, '$.schemaVersion', `schemaVersion must be ${TEMPLATE_MEMORY_SCHEMA_VERSION}`);
  }
  if (value.hashVersion !== TEMPLATE_MEMORY_HASH_VERSION) {
    add(errors, '$.hashVersion', `hashVersion must be ${TEMPLATE_MEMORY_HASH_VERSION}`);
  }
  if (!Array.isArray(value.entries)) {
    add(errors, '$.entries', 'entries must be an array');
    return result(errors);
  }
  if (value.entries.length > TEMPLATE_MEMORY_MAX_ENTRIES) {
    add(errors, '$.entries', `entries exceed cap ${TEMPLATE_MEMORY_MAX_ENTRIES}`);
  }
  value.entries.forEach((entry, index) => {
    const path = `$.entries[${index}]`;
    if (!isPlainRecord(entry)) {
      add(errors, path, 'entry must be a plain record');
      return;
    }
    rejectExtraKeys(entry, ENTRY_KEYS, errors, path, 'entry');
    if (!isTemplateMemoryHashV1(entry.domainHash)) add(errors, `${path}.domainHash`, 'expected versioned hash');
    if (!isTemplateMemoryHashV1(entry.templateHash)) add(errors, `${path}.templateHash`, 'expected versioned hash');
    if (!isEnumValue(PAGE_TYPE_VALUES, entry.pageType)) add(errors, `${path}.pageType`, 'expected page type');
    if (!Number.isInteger(entry.seenCount) || entry.seenCount < 0 || entry.seenCount > MAX_COUNTER) {
      add(errors, `${path}.seenCount`, 'expected bounded counter');
    }
    ['firstSeenBucket', 'lastSeenBucket'].forEach((key) => {
      if (!Number.isInteger(entry[key]) || entry[key] < 0) {
        add(errors, `${path}.${key}`, 'expected day bucket');
      }
    });
    if (!Array.isArray(entry.roleDistribution)) {
      add(errors, `${path}.roleDistribution`, 'expected array');
    } else {
      entry.roleDistribution.forEach((role, roleIndex) => {
        const rolePath = `${path}.roleDistribution[${roleIndex}]`;
        rejectExtraKeys(role, ROLE_KEYS, errors, rolePath, 'role');
        if (!isEnumValue(BLOCK_ROLE_VALUES, role?.role)) add(errors, `${rolePath}.role`, 'expected block role');
        if (!Number.isInteger(role?.count) || role.count < 0 || role.count > 1000) {
          add(errors, `${rolePath}.count`, 'expected bounded count');
        }
      });
    }
    if (!isPlainRecord(entry.riskBands)) {
      add(errors, `${path}.riskBands`, 'expected risk bands');
    } else {
      rejectExtraKeys(entry.riskBands, RISK_KEYS, errors, `${path}.riskBands`, 'risk band');
      RISK_KEYS.forEach((key) => {
        if (!RISK_BANDS.includes(entry.riskBands[key])) {
          add(errors, `${path}.riskBands.${key}`, 'expected risk band');
        }
      });
    }
    if (!Array.isArray(entry.scopeFingerprints)) {
      add(errors, `${path}.scopeFingerprints`, 'expected array');
    } else if (entry.scopeFingerprints.length > MAX_SCOPE_FINGERPRINTS) {
      add(errors, `${path}.scopeFingerprints`, `scope fingerprints exceed cap ${MAX_SCOPE_FINGERPRINTS}`);
    } else {
      entry.scopeFingerprints.forEach((scope, scopeIndex) => {
        const scopePath = `${path}.scopeFingerprints[${scopeIndex}]`;
        rejectExtraKeys(scope, SCOPE_KEYS, errors, scopePath, 'scope fingerprint');
        if (scope?.scopeHash != null && !isTemplateMemoryHashV1(scope.scopeHash)) {
          add(errors, `${scopePath}.scopeHash`, 'expected versioned hash');
        }
        if (!isEnumValue(BLOCK_ROLE_VALUES, scope?.roleHint)) add(errors, `${scopePath}.roleHint`, 'expected block role');
        if (!RISK_BANDS.includes(scope?.confidenceBand)) add(errors, `${scopePath}.confidenceBand`, 'expected band');
        validateBins(scope?.boxBins, BIN_KEYS, errors, `${scopePath}.boxBins`);
        validateBins(scope?.metricBins, METRIC_BIN_KEYS, errors, `${scopePath}.metricBins`);
        if (!Array.isArray(scope?.reasonCodes)) {
          add(errors, `${scopePath}.reasonCodes`, 'expected array');
        } else {
          scope.reasonCodes.forEach((reason, reasonIndex) => {
            if (!isEnumValue(REASON_CODE_VALUES, reason)) {
              add(errors, `${scopePath}.reasonCodes[${reasonIndex}]`, 'expected reason code');
            }
          });
        }
      });
    }
    if (!Array.isArray(entry.actionCounters)) {
      add(errors, `${path}.actionCounters`, 'expected array');
    } else {
      entry.actionCounters.forEach((counter, counterIndex) => {
        const counterPath = `${path}.actionCounters[${counterIndex}]`;
        rejectExtraKeys(counter, COUNTER_RECORD_KEYS, errors, counterPath, 'action counter');
        if (!isEnumValue(ADAPTATION_ACTION_ID_VALUES, counter?.actionId)) {
          add(errors, `${counterPath}.actionId`, 'expected action id');
        }
        if (counter?.learningEffectKey != null) {
          rejectExtraKeys(counter.learningEffectKey, LEARNING_EFFECT_KEY_KEYS, errors, `${counterPath}.learningEffectKey`, 'learning effect key');
          if (!Object.values(GUARANTEED_EFFECT_MODE_IDS).includes(counter.learningEffectKey.modeId)) {
            add(errors, `${counterPath}.learningEffectKey.modeId`, 'expected mode id');
          }
          if (!isEnumValue(ADAPTATION_ACTION_ID_VALUES, counter.learningEffectKey.actionId)) {
            add(errors, `${counterPath}.learningEffectKey.actionId`, 'expected action id');
          }
          if (!isEnumValue(TARGET_KIND_VALUES, counter.learningEffectKey.targetKind)) {
            add(errors, `${counterPath}.learningEffectKey.targetKind`, 'expected target kind');
          }
          if (!isEnumValue(EFFECT_CLASS_VALUES, counter.learningEffectKey.effectClass)) {
            add(errors, `${counterPath}.learningEffectKey.effectClass`, 'expected effect class');
          }
          if (!isEnumValue(PAGE_TYPE_VALUES, counter.learningEffectKey.pageType)) {
            add(errors, `${counterPath}.learningEffectKey.pageType`, 'expected page type');
          }
          if (counter.learningEffectKey.actionId !== counter.actionId) {
            add(errors, `${counterPath}.learningEffectKey.actionId`, 'learning key action must match counter action');
          }
        }
        COUNTER_KEYS.forEach((key) => {
          if (!Number.isInteger(counter?.[key]) || counter[key] < 0 || counter[key] > MAX_COUNTER) {
            add(errors, `${counterPath}.${key}`, 'expected bounded counter');
          }
        });
        if (!Object.prototype.hasOwnProperty.call(OUTCOME_TO_COUNTER, counter?.lastOutcomeEvent)) {
          add(errors, `${counterPath}.lastOutcomeEvent`, 'expected template memory event');
        }
        if (!Number.isInteger(counter?.lastOutcomeBucket) || counter.lastOutcomeBucket < 0) {
          add(errors, `${counterPath}.lastOutcomeBucket`, 'expected day bucket');
        }
      });
    }
    if (byteSize(entry) > TEMPLATE_MEMORY_MAX_ENTRY_BYTES) {
      add(errors, path, `entry exceeds ${TEMPLATE_MEMORY_MAX_ENTRY_BYTES} bytes`);
    }
  });
  if (byteSize(value) > TEMPLATE_MEMORY_MAX_BYTES) {
    add(errors, '$', `template memory exceeds ${TEMPLATE_MEMORY_MAX_BYTES} bytes`);
  }
  return result(errors);
}

function validateBins(value, keys, errors, path) {
  if (!isPlainRecord(value)) {
    add(errors, path, 'expected bins');
    return;
  }
  rejectExtraKeys(value, keys, errors, path, 'bin');
  keys.forEach((key) => {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 10) {
      add(errors, `${path}.${key}`, 'expected bin from 0 to 10');
    }
  });
}

export function normalizeTemplateMemoryStoreV1(value, { nowMs = Date.now() } = {}) {
  if (!isPlainRecord(value) || value.schemaVersion !== TEMPLATE_MEMORY_SCHEMA_VERSION || value.hashVersion !== TEMPLATE_MEMORY_HASH_VERSION) {
    return createEmptyTemplateMemoryV1();
  }
  const entries = Array.isArray(value.entries)
    ? value.entries.map(normalizeEntry).filter(Boolean)
    : [];
  return pruneTemplateMemoryV1({
    schemaVersion: TEMPLATE_MEMORY_SCHEMA_VERSION,
    hashVersion: TEMPLATE_MEMORY_HASH_VERSION,
    entries,
  }, { nowMs });
}

export function pruneTemplateMemoryV1(
  store,
  {
    nowMs = Date.now(),
    maxEntries = TEMPLATE_MEMORY_MAX_ENTRIES,
    ttlMs = TEMPLATE_MEMORY_TTL_MS,
    maxBytes = TEMPLATE_MEMORY_MAX_BYTES,
  } = {},
) {
  const normalized = isPlainRecord(store) ? store : createEmptyTemplateMemoryV1();
  const currentBucket = toTemplateMemoryDayBucket(nowMs);
  const cutoffBucket = toTemplateMemoryDayBucket(Math.max(0, nowMs - ttlMs));
  const entries = (Array.isArray(normalized.entries) ? normalized.entries : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .filter((entry) => entry.lastSeenBucket >= cutoffBucket && entry.lastSeenBucket <= currentBucket)
    .sort((left, right) =>
      right.lastSeenBucket - left.lastSeenBucket
      || right.seenCount - left.seenCount
      || left.templateHash.localeCompare(right.templateHash)
    )
    .slice(0, Math.max(0, maxEntries));

  const next = {
    schemaVersion: TEMPLATE_MEMORY_SCHEMA_VERSION,
    hashVersion: TEMPLATE_MEMORY_HASH_VERSION,
    entries,
  };
  while (next.entries.length > 0 && byteSize(next) > maxBytes) {
    next.entries.pop();
  }
  return next;
}

function findEntryIndex(entries, input) {
  return entries.findIndex((entry) =>
    entry.domainHash === input.domainHash
    && entry.templateHash === input.templateHash
    && entry.pageType === input.pageType
  );
}

function mergeCounter(entry, actionId, event, bucket, learningEffectKey = null) {
  const counterKey = OUTCOME_TO_COUNTER[event];
  if (!counterKey || !isEnumValue(ADAPTATION_ACTION_ID_VALUES, actionId)) {
    return;
  }
  const candidateLearningEffectKey = normalizeLearningEffectKey(learningEffectKey);
  const normalizedLearningEffectKey = candidateLearningEffectKey?.actionId === actionId
    ? candidateLearningEffectKey
    : null;
  if (
    event === OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE
    && (actionId === 'PAGE_CLARITY' || normalizedLearningEffectKey?.actionId === 'PAGE_CLARITY')
  ) {
    return;
  }
  const counters = normalizeActionCounters(entry.actionCounters);
  const identity = learningEffectKeyId(normalizedLearningEffectKey);
  let counter = counters.find((candidate) => {
    if (identity) {
      return learningEffectKeyId(candidate.learningEffectKey) === identity;
    }
    return candidate.actionId === actionId && !candidate.learningEffectKey;
  });
  if (!counter) {
    counter = {
      actionId,
      postApplyPassedCount: 0,
      learningEligibleCount: 0,
      undoCount: 0,
      rollbackCount: 0,
      postApplyFailedCount: 0,
      neverOnSiteCount: 0,
      lastOutcomeEvent: event,
      lastOutcomeBucket: bucket,
    };
    if (normalizedLearningEffectKey) {
      counter.learningEffectKey = normalizedLearningEffectKey;
    }
    counters.push(counter);
  }
  counter[counterKey] = Math.min(MAX_COUNTER, counter[counterKey] + 1);
  counter.lastOutcomeEvent = event;
  counter.lastOutcomeBucket = bucket;
  entry.actionCounters = counters.sort((left, right) => left.actionId.localeCompare(right.actionId));
}

export function reduceTemplateMemoryOutcomeV1(store, outcome, { nowMs = Date.now() } = {}) {
  const base = normalizeTemplateMemoryStoreV1(store, { nowMs });
  const bucket = toTemplateMemoryDayBucket(nowMs);
  const candidate = normalizeEntry({
    domainHash: outcome?.domainHash,
    templateHash: outcome?.templateHash,
    pageType: outcome?.pageType,
    roleDistribution: outcome?.roleDistribution,
    riskBands: outcome?.riskBands,
    scopeFingerprints: outcome?.scopeFingerprints,
    actionCounters: [],
    seenCount: 0,
    firstSeenBucket: bucket,
    lastSeenBucket: bucket,
  });
  if (!candidate || !Object.prototype.hasOwnProperty.call(OUTCOME_TO_COUNTER, outcome?.event)) {
    return base;
  }
  const entries = base.entries.slice();
  const index = findEntryIndex(entries, candidate);
  const entry = index >= 0
    ? {
      ...entries[index],
      roleDistribution: candidate.roleDistribution.length ? candidate.roleDistribution : entries[index].roleDistribution,
      riskBands: candidate.riskBands,
      scopeFingerprints: candidate.scopeFingerprints.length ? candidate.scopeFingerprints : entries[index].scopeFingerprints,
      actionCounters: normalizeActionCounters(entries[index].actionCounters),
      seenCount: Math.min(MAX_COUNTER, entries[index].seenCount + 1),
      firstSeenBucket: Math.min(entries[index].firstSeenBucket, bucket),
      lastSeenBucket: Math.max(entries[index].lastSeenBucket, bucket),
    }
    : {
      ...candidate,
      seenCount: 1,
      firstSeenBucket: bucket,
      lastSeenBucket: bucket,
    };
  mergeCounter(entry, outcome.actionId, outcome.event, bucket, outcome.learningEffectKey);
  if (index >= 0) {
    entries[index] = entry;
  } else {
    entries.push(entry);
  }
  return pruneTemplateMemoryV1({ ...base, entries }, { nowMs });
}

export function isTemplateMemoryEntryReliableV1(entry, actionId, options = {}) {
  const normalized = normalizeEntry(entry);
  if (!normalized || !isEnumValue(ADAPTATION_ACTION_ID_VALUES, actionId)) {
    return false;
  }
  const learningEffectKey = isPlainRecord(options) ? options.learningEffectKey : null;
  const keyId = learningEffectKeyId(learningEffectKey);
  const counter = normalizeActionCounters(normalized.actionCounters).find((candidate) => {
    if (keyId) {
      return learningEffectKeyId(candidate.learningEffectKey) === keyId;
    }
    return candidate.actionId === actionId && !candidate.learningEffectKey;
  });
  if (!counter) {
    return false;
  }
  return counter.learningEligibleCount >= TEMPLATE_MEMORY_MIN_RELIABLE_POSITIVES
    && counter.undoCount === 0
    && counter.rollbackCount === 0
    && counter.postApplyFailedCount === 0
    && counter.neverOnSiteCount === 0;
}

export function buildTemplateShapeSignatureV1(profile) {
  const pageType = isEnumValue(PAGE_TYPE_VALUES, profile?.pageType) ? profile.pageType : 'UNKNOWN';
  const roleDistribution = normalizeRoleDistribution(profile?.roleDistribution);
  const riskBands = normalizeRiskBands(profile?.riskBands || profile?.risk);
  const scopeFingerprints = normalizeScopeFingerprints(profile?.scopeFingerprints);
  return {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    pageType,
    roleDistribution,
    riskBands,
    scopeFingerprints,
    reasons: Array.isArray(profile?.reasons)
      ? profile.reasons.filter((reason) => isEnumValue(REASON_CODE_VALUES, reason)).slice(0, DTO_CAPS.maxReasons)
      : [],
  };
}
