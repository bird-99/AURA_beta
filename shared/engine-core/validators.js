// shared/engine-core/validators.js

import {
  ACTIVE_POLICY_DECISION_KIND_VALUES,
  ACTION_CONTEXT_SOURCE_VALUES,
  ACTION_POLICY_DECISIONS,
  ACTIVATION_STAGE_VALUES,
  ADAPTATION_ACTION_ID_VALUES,
  ACTION_POLICY_DECISION_VALUES,
  BLOCK_ROLE_VALUES,
  CAPABILITY_STATUS_VALUES,
  EFFECT_CLASS_VALUES,
  EVIDENCE_OPERATOR_VALUES,
  FEATURE_ID_VALUES,
  FEATURE_MATURITY_VALUES,
  FEATURE_SECTION_VALUES,
  INVARIANT_CODE_VALUES,
  INVARIANT_PHASES,
  INVARIANT_PHASE_VALUES,
  INVARIANT_SEVERITY_VALUES,
  OUTCOME_ID_VALUES,
  OUTCOME_LEDGER_EVENT_VALUES,
  PAGE_TYPE_VALUES,
  POST_APPLY_CHECK_CODE_VALUES,
  PROBLEM_CODE_VALUES,
  REASON_CODE_VALUES,
  RUNTIME_EXECUTOR_VALUES,
  SHADOW_COMPARISON_KIND_VALUES,
  SHADOW_NOT_APPLIED_REASON_VALUES,
  SHADOW_POLICY_ID_VALUES,
  SUPPORT_LEVEL_VALUES,
  TARGET_KIND_VALUES,
  USER_OUTCOME_EVENT_VALUES,
  isEnumValue,
} from './enums.js';
import { CONTRACT_IDS, DTO_CAPS, ENGINE_CORE_SCHEMA_VERSION, PRIVACY_FORBIDDEN_KEYS } from './contracts.js';
import {
  GUARANTEED_EFFECT_MATRIX_VERSION,
  GUARANTEED_EFFECT_MODE_IDS,
} from './guaranteed-effect-matrix.js';

const FULL_URL_RE = /\bhttps?:\/\/[^\s]+/i;
const SHADOW_HASH_RE = /^shr1_[A-Za-z0-9_-]{16,64}$/;
const SAFE_PROFILE_HASH_RE = /^(?:shr1|tmh1)_[A-Za-z0-9_-]{6,96}$/;
const TEMPLATE_MEMORY_HASH_RE = /^tmh1_[A-Za-z0-9_-]{22}$/;
const OBSERVED_NODE_SIGNAL_COLLECTION_MODES = Object.freeze(['BLOCK_SUMMARY']);
const OBSERVED_NODE_SIGNAL_READY_STATES = Object.freeze(['loading', 'interactive', 'complete', 'unknown']);
const VISUAL_REGION_GRAPH_EDGE_TYPES = Object.freeze(['CONTAINS_ISH', 'VERTICAL_NEXT', 'SAME_ROW', 'SAME_COLUMN']);
const VISUAL_REGION_GRAPH_GROUP_TYPES = Object.freeze(['ROW', 'COLUMN', 'VERTICAL_STACK', 'REPEATED_RECORDS', 'CONTENT_CLUSTER']);
const OBSERVED_NODE_SIGNALS_FORBIDDEN_KEYS = Object.freeze([
  'visualRegionGraph',
  'graph',
  'edges',
  'edge',
  'regions',
  'regionGraph',
  'actionTargets',
  'pageClarityActive',
  'activePlanAllowed',
  'executor',
  'apply',
  'applyPlan',
  'css',
  'style',
  'className',
  'id',
]);
const SHADOW_EXTRA_FORBIDDEN_KEYS = Object.freeze([
  'actionPayload',
  'payload',
  'rawDecision',
  'rawProfile',
  'rawSignals',
  'fixtureHtml',
  'tokens',
  'applyPlan',
  'rollbackPlan',
  'constraints',
  'selectedScopeId',
  'siteKey',
  'domain',
  'host',
  'routeFingerprint',
  'attemptId',
  'tabId',
  'frameUrl',
]);
function result(errors) {
  return { ok: errors.length === 0, errors };
}

function add(errors, path, message) {
  errors.push({ path, message });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isLiveHandleLike(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (typeof value.nodeType === 'number' && ('nodeName' in value || 'tagName' in value)) {
    return true;
  }
  return Boolean(value.ownerDocument || value.style || value.classList);
}

function isRectObjectLike(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number')
    && ['top', 'right', 'bottom', 'left'].some((key) => key in value);
}

function validateJsonValue(value, path, errors, seen) {
  const type = typeof value;

  if (value === null || type === 'boolean') {
    return;
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      add(errors, path, 'number must be finite');
    }
    return;
  }

  if (type === 'string') {
    if (value.length > DTO_CAPS.maxStringLength) {
      add(errors, path, `string exceeds ${DTO_CAPS.maxStringLength} characters`);
    }
    if (FULL_URL_RE.test(value)) {
      add(errors, path, 'full URLs are not allowed');
    }
    return;
  }

  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    add(errors, path, `${type} is not JSON-serializable`);
    return;
  }

  if (seen.has(value)) {
    add(errors, path, 'cyclic objects are not allowed');
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateJsonValue(value[index], `${path}[${index}]`, errors, seen);
    }
    seen.delete(value);
    return;
  }

  if (!isPlainObject(value)) {
    add(errors, path, 'only plain JSON objects are allowed');
    seen.delete(value);
    return;
  }

  if (isLiveHandleLike(value)) {
    add(errors, path, 'live handle-like objects are not allowed');
  }
  if (isRectObjectLike(value)) {
    add(errors, path, 'rect-like objects are not allowed');
  }

  for (const [key, child] of Object.entries(value)) {
    if (PRIVACY_FORBIDDEN_KEYS.includes(key)) {
      add(errors, `${path}.${key}`, `privacy-forbidden key "${key}"`);
    }
    validateJsonValue(child, `${path}.${key}`, errors, seen);
  }

  seen.delete(value);
}

export function validatePrivacySafeJson(value) {
  const errors = [];
  validateJsonValue(value, '$', errors, new WeakSet());
  return result(errors);
}

function schema(value, errors, path = '$') {
  if (!isPlainObject(value)) {
    add(errors, path, 'DTO must be a plain object');
    return false;
  }
  if (value.schemaVersion !== ENGINE_CORE_SCHEMA_VERSION) {
    add(errors, `${path}.schemaVersion`, `schemaVersion must be ${ENGINE_CORE_SCHEMA_VERSION}`);
  }
  return true;
}

/**
 * @param {{ optional?: boolean, max?: number }} [options]
 */
function stringField(value, key, errors, path = '$', options = {}) {
  const { optional = false, max = DTO_CAPS.maxStringLength } = options;
  const next = value?.[key];
  if (next == null && optional) return;
  if (typeof next !== 'string' || next.length < 1 || next.length > max) {
    add(errors, `${path}.${key}`, 'expected bounded non-empty string');
  }
}

function shadowHashField(value, key, errors, path = '$', { optional = false } = {}) {
  const next = value?.[key];
  if (next == null && optional) return;
  if (typeof next !== 'string' || !SHADOW_HASH_RE.test(next)) {
    add(errors, `${path}.${key}`, 'expected versioned shadow hash');
  }
}

function safeProfileHashField(value, key, errors, path = '$', { optional = false } = {}) {
  const next = value?.[key];
  if (next == null && optional) return;
  if (typeof next !== 'string' || !SAFE_PROFILE_HASH_RE.test(next)) {
    add(errors, `${path}.${key}`, 'expected safe versioned profile hash');
  }
}

function templateMemoryHashField(value, key, errors, path = '$', { optional = false } = {}) {
  const next = value?.[key];
  if (next == null && optional) return;
  if (typeof next !== 'string' || !TEMPLATE_MEMORY_HASH_RE.test(next)) {
    add(errors, `${path}.${key}`, 'expected versioned template hash');
  }
}

function numberField(value, key, errors, path = '$', { optional = false, min = -Infinity, max = Infinity } = {}) {
  const next = value?.[key];
  if (next == null && optional) return;
  if (typeof next !== 'number' || !Number.isFinite(next) || next < min || next > max) {
    add(errors, `${path}.${key}`, 'expected finite number in range');
  }
}

function integerField(value, key, errors, path = '$', { optional = false, min = -Infinity, max = Infinity } = {}) {
  const next = value?.[key];
  numberField(value, key, errors, path, { optional, min, max });
  if (next != null && typeof next === 'number' && Number.isFinite(next) && !Number.isInteger(next)) {
    add(errors, `${path}.${key}`, 'expected integer');
  }
}

function bucketField(value, key, errors, path = '$') {
  integerField(value, key, errors, path, { min: 0, max: 10 });
}

function booleanField(value, key, errors, path = '$') {
  if (typeof value?.[key] !== 'boolean') {
    add(errors, `${path}.${key}`, 'expected boolean');
  }
}

function enumField(value, key, values, errors, path = '$', { optional = false } = {}) {
  const next = value?.[key];
  if (next == null && optional) return;
  if (!isEnumValue(values, next)) {
    add(errors, `${path}.${key}`, `expected one of ${values.join(', ')}`);
  }
}

function boundedArray(value, key, max, errors, path = '$', { optional = false } = {}) {
  const next = value?.[key];
  if (next == null && optional) return [];
  if (!Array.isArray(next)) {
    add(errors, `${path}.${key}`, 'expected array');
    return [];
  }
  if (next.length > max) {
    add(errors, `${path}.${key}`, `array exceeds cap ${max}`);
  }
  return next;
}

function validateReasonArray(value, key, errors, path = '$') {
  const reasons = boundedArray(value, key, DTO_CAPS.maxReasons, errors, path, { optional: true });
  reasons.forEach((reason, index) => {
    if (!isEnumValue(REASON_CODE_VALUES, reason)) {
      add(errors, `${path}.${key}[${index}]`, 'expected known reason code');
    }
  });
}

function validateRisk(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected risk object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'layoutRisk',
    'interactionRisk',
    'confidenceRisk',
    'privacyRisk',
  ], errors, path, 'risk');
  ['layoutRisk', 'interactionRisk', 'confidenceRisk', 'privacyRisk'].forEach((key) => {
    numberField(value, key, errors, path, { min: 0, max: 1 });
  });
}

function validateMetrics(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected metrics object');
    return;
  }
  [
    'textDensity',
    'linkDensity',
    'interactiveDensity',
    'mediaDensity',
    'formDensity',
    'tableDensity',
    'viewportCoverage',
  ].forEach((key) => numberField(value, key, errors, path, { min: 0, max: 1 }));
}

function validateRectRatio(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected rectRatio object');
    return;
  }
  ['xRatio', 'yRatio', 'widthRatio', 'heightRatio', 'visibleRatio'].forEach((key) => {
    numberField(value, key, errors, path, { min: 0, max: 1 });
  });
}

function validateStats(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected stats object');
    return;
  }
  numberField(value, 'elapsedMs', errors, path, { min: 0, max: 10000 });
  numberField(value, 'nodesScanned', errors, path, { min: 0, max: DTO_CAPS.maxNodesScanned });
  numberField(value, 'candidatesSeen', errors, path, { min: 0, max: DTO_CAPS.maxCandidatesSeen });
  booleanField(value, 'budgetHit', errors, path);
}

function rejectObservedNodeSignalsForbiddenKeys(value, errors, path = '$', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectObservedNodeSignalsForbiddenKeys(item, errors, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (OBSERVED_NODE_SIGNALS_FORBIDDEN_KEYS.includes(key)) {
      add(errors, `${path}.${key}`, `observed-node-signals-forbidden key "${key}"`);
    }
    rejectObservedNodeSignalsForbiddenKeys(child, errors, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function validateObservedRectBucketsV2(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected rectBuckets object');
    return;
  }
  rejectUnexpectedKeys(value, ['x', 'y', 'w', 'h'], errors, path, 'rectBuckets');
  ['x', 'y', 'w', 'h'].forEach((key) => bucketField(value, key, errors, path));
}

function validateObservedReadinessV2(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected readiness object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'documentReadyState',
    'lateLoadLikely',
    'layoutStableHint',
  ], errors, path, 'observed readiness');
  enumField(value, 'documentReadyState', OBSERVED_NODE_SIGNAL_READY_STATES, errors, path);
  booleanField(value, 'lateLoadLikely', errors, path);
  booleanField(value, 'layoutStableHint', errors, path);
}

function validateObservedCoverageV2(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected coverage object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'blocksObserved',
    'blocksWithSignals',
    'candidatesSeen',
    'nodesSampled',
    'elapsedMs',
    'v2Coverage',
    'budgetHit',
    'partial',
  ], errors, path, 'observed coverage');
  integerField(value, 'blocksObserved', errors, path, { min: 0, max: DTO_CAPS.maxBlocks });
  integerField(value, 'blocksWithSignals', errors, path, { min: 0, max: DTO_CAPS.maxBlocks });
  integerField(value, 'candidatesSeen', errors, path, { min: 0, max: DTO_CAPS.maxCandidatesSeen });
  integerField(value, 'nodesSampled', errors, path, { min: 0, max: DTO_CAPS.maxNodesScanned });
  numberField(value, 'elapsedMs', errors, path, { min: 0, max: 10000 });
  numberField(value, 'v2Coverage', errors, path, { min: 0, max: 1 });
  booleanField(value, 'budgetHit', errors, path);
  booleanField(value, 'partial', errors, path);
  if (
    typeof value.blocksWithSignals === 'number'
    && typeof value.blocksObserved === 'number'
    && value.blocksWithSignals > value.blocksObserved
  ) {
    add(errors, `${path}.blocksWithSignals`, 'blocksWithSignals cannot exceed blocksObserved');
  }
}

function validateObservedBlockSignalV2(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected observed block signal object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'blockId',
    'rectBuckets',
    'visibleAreaBucket',
    'viewportIntersectionBucket',
    'sameRowHint',
    'sameColumnHint',
    'verticalAdjacencyHint',
    'repeatedSiblingShapeHint',
    'siblingIndexBucket',
    'siblingCountBucket',
    'formControlDensityBucket',
    'linkDensityBucket',
    'mediaControlSeparationHint',
    'headingHint',
    'listHint',
    'cardHint',
    'centralityBucket',
  ], errors, path, 'observed block signal');

  stringField(value, 'blockId', errors, path, { max: 64 });
  validateObservedRectBucketsV2(value.rectBuckets, errors, `${path}.rectBuckets`);
  [
    'visibleAreaBucket',
    'viewportIntersectionBucket',
    'siblingIndexBucket',
    'siblingCountBucket',
    'formControlDensityBucket',
    'linkDensityBucket',
    'centralityBucket',
  ].forEach((key) => bucketField(value, key, errors, path));
  [
    'sameRowHint',
    'sameColumnHint',
    'verticalAdjacencyHint',
    'repeatedSiblingShapeHint',
    'mediaControlSeparationHint',
    'headingHint',
    'listHint',
    'cardHint',
  ].forEach((key) => booleanField(value, key, errors, path));
}

export function validateObservedNodeSignalsV2(value) {
  const errors = baseValidate(value);
  rejectObservedNodeSignalsForbiddenKeys(value, errors);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'collectionMode',
    'readiness',
    'coverage',
    'blockSignals',
  ], errors, '$', 'observed node signals');

  numberField(value, 'version', errors, '$', { min: 2, max: 2 });
  enumField(value, 'collectionMode', OBSERVED_NODE_SIGNAL_COLLECTION_MODES, errors);
  validateObservedReadinessV2(value.readiness, errors, '$.readiness');
  validateObservedCoverageV2(value.coverage, errors, '$.coverage');
  const blockSignals = boundedArray(value, 'blockSignals', DTO_CAPS.maxBlocks, errors);
  blockSignals.forEach((block, index) => validateObservedBlockSignalV2(block, errors, `$.blockSignals[${index}]`));

  if (
    isPlainObject(value.coverage)
    && typeof value.coverage.blocksObserved === 'number'
    && Array.isArray(value.blockSignals)
    && value.coverage.blocksObserved !== value.blockSignals.length
  ) {
    add(errors, '$.coverage.blocksObserved', 'blocksObserved must match blockSignals length');
  }

  return result(errors);
}

function validateVisualBucketsV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected buckets object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'visibleArea',
    'viewportIntersection',
    'centrality',
    'linkDensity',
    'formControlDensity',
    'siblingCount',
  ], errors, path, 'visual graph buckets');
  ['visibleArea', 'viewportIntersection', 'centrality', 'linkDensity', 'formControlDensity'].forEach((key) => {
    bucketField(value, key, errors, path);
  });
  if ('siblingCount' in value) bucketField(value, 'siblingCount', errors, path);
}

function validateVisualHintsV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected hints object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'heading',
    'list',
    'card',
    'repeatedSiblingShape',
    'sameRow',
    'sameColumn',
    'verticalAdjacency',
    'mediaControlSeparation',
  ], errors, path, 'visual graph hints');
  [
    'heading',
    'list',
    'card',
    'repeatedSiblingShape',
    'sameRow',
    'sameColumn',
    'verticalAdjacency',
    'mediaControlSeparation',
  ].forEach((key) => booleanField(value, key, errors, path));
}

function validateVisualFlagsV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected flags object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'primaryCandidate',
    'repeatedRecordLike',
    'boilerplateLike',
    'gceCandidate',
    'riskyInteractive',
  ], errors, path, 'visual graph flags');
  [
    'primaryCandidate',
    'repeatedRecordLike',
    'boilerplateLike',
    'gceCandidate',
    'riskyInteractive',
  ].forEach((key) => booleanField(value, key, errors, path));
}

function validateReasonCodeArray(value, key, errors, path = '$', { max = DTO_CAPS.maxReasons } = {}) {
  const reasons = boundedArray(value, key, max, errors, path);
  reasons.forEach((reason, index) => {
    if (!isEnumValue(REASON_CODE_VALUES, reason)) {
      add(errors, `${path}.${key}[${index}]`, 'expected known reason code');
    }
  });
}

function validateEnumArray(value, key, values, errors, path = '$', { optional = false, max = Number(DTO_CAPS.maxReasons) } = {}) {
  const items = boundedArray(value, key, max, errors, path, { optional });
  items.forEach((item, index) => {
    if (!isEnumValue(values, item)) {
      add(errors, `${path}.${key}[${index}]`, `expected one of ${values.join(', ')}`);
    }
  });
  return items;
}

function validateModeDefaultActivationV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected mode default activation object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'visibleInPopup',
    'optInOnly',
    'autoApplyAllowed',
  ], errors, path, 'mode default activation');
  booleanField(value, 'visibleInPopup', errors, path);
  booleanField(value, 'optInOnly', errors, path);
  booleanField(value, 'autoApplyAllowed', errors, path);
}

function validateModeLearningPolicyV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected mode learning policy object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'allowPositiveLearning',
    'requireInspectedOutcome',
    'blockLearningForFallback',
  ], errors, path, 'mode learning policy');
  booleanField(value, 'allowPositiveLearning', errors, path);
  booleanField(value, 'requireInspectedOutcome', errors, path);
  booleanField(value, 'blockLearningForFallback', errors, path);
}

function validateUserFacingCopyV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected user-facing copy object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'on',
    'limited',
    'denied',
    'error',
  ], errors, path, 'user-facing copy');
  ['on', 'limited', 'denied', 'error'].forEach((key) => {
    stringField(value, key, errors, path, { max: DTO_CAPS.maxStringLength });
  });
}

export function validateModeRegistryEntryV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'modeId',
    'publicLabel',
    'publicIntent',
    'shortDescription',
    'allowedPrefs',
    'internalActions',
    'exclusivityGroup',
    'defaultActivation',
    'learningPolicy',
    'forbiddenPageTypes',
    'userFacingCopy',
  ], errors, '$', 'mode registry entry');
  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  enumField(value, 'modeId', Object.values(GUARANTEED_EFFECT_MODE_IDS), errors);
  stringField(value, 'publicLabel', errors);
  stringField(value, 'publicIntent', errors);
  stringField(value, 'shortDescription', errors);
  validateBoundedStringArray(value, 'allowedPrefs', errors, '$', { max: DTO_CAPS.maxFeatureRegistryEntries });
  validateEnumArray(value, 'internalActions', ADAPTATION_ACTION_ID_VALUES, errors, '$', { max: DTO_CAPS.maxActionRegistryEntries });
  stringField(value, 'exclusivityGroup', errors);
  validateModeDefaultActivationV1(value.defaultActivation, errors, '$.defaultActivation');
  validateModeLearningPolicyV1(value.learningPolicy, errors, '$.learningPolicy');
  validateEnumArray(value, 'forbiddenPageTypes', PAGE_TYPE_VALUES, errors, '$', { max: PAGE_TYPE_VALUES.length });
  validateUserFacingCopyV1(value.userFacingCopy, errors, '$.userFacingCopy');
  if (value.defaultActivation?.autoApplyAllowed === true) {
    add(errors, '$.defaultActivation.autoApplyAllowed', 'mode registry must not enable auto apply by default');
  }
  return result(errors);
}

function validateActionLearningEligibilityV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected action learning eligibility object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'positiveLearningAllowed',
    'requiresNoUndoWindow',
    'blockedWhenLimited',
  ], errors, path, 'action learning eligibility');
  booleanField(value, 'positiveLearningAllowed', errors, path);
  booleanField(value, 'requiresNoUndoWindow', errors, path);
  booleanField(value, 'blockedWhenLimited', errors, path);
}

function validateActionDefaultPolicyV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected action default policy object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'userRequest',
    'autoApply',
  ], errors, path, 'action default policy');
  enumField(value, 'userRequest', ACTION_POLICY_DECISION_VALUES, errors, path);
  enumField(value, 'autoApply', ACTION_POLICY_DECISION_VALUES, errors, path);
  if (value.autoApply !== ACTION_POLICY_DECISIONS.DENY && value.autoApply !== ACTION_POLICY_DECISIONS.SUGGEST_ONLY) {
    add(errors, `${path}.autoApply`, 'autoApply policy must be DENY or SUGGEST_ONLY');
  }
}

export function validateActionRegistryEntryV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'actionId',
    'parentModes',
    'targetKinds',
    'effectClasses',
    'allowedPageTypes',
    'shadowPageTypes',
    'deniedPageTypes',
    'defaultSupportLevel',
    'activationStage',
    'requiresCapability',
    'requiresPostChecks',
    'learningEligibility',
    'defaultPolicy',
  ], errors, '$', 'action registry entry');
  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  validateEnumArray(value, 'parentModes', Object.values(GUARANTEED_EFFECT_MODE_IDS), errors, '$', { max: DTO_CAPS.maxModeRegistryEntries });
  validateEnumArray(value, 'targetKinds', TARGET_KIND_VALUES, errors, '$', { max: DTO_CAPS.maxCandidates });
  validateEnumArray(value, 'effectClasses', EFFECT_CLASS_VALUES, errors, '$', { max: DTO_CAPS.maxCandidates });
  const allowed = validateEnumArray(value, 'allowedPageTypes', PAGE_TYPE_VALUES, errors, '$', { max: PAGE_TYPE_VALUES.length });
  const shadow = validateEnumArray(value, 'shadowPageTypes', PAGE_TYPE_VALUES, errors, '$', { max: PAGE_TYPE_VALUES.length });
  const denied = validateEnumArray(value, 'deniedPageTypes', PAGE_TYPE_VALUES, errors, '$', { max: PAGE_TYPE_VALUES.length });
  enumField(value, 'defaultSupportLevel', SUPPORT_LEVEL_VALUES, errors);
  enumField(value, 'activationStage', ACTIVATION_STAGE_VALUES, errors);
  booleanField(value, 'requiresCapability', errors);
  booleanField(value, 'requiresPostChecks', errors);
  validateActionLearningEligibilityV1(value.learningEligibility, errors, '$.learningEligibility');
  validateActionDefaultPolicyV1(value.defaultPolicy, errors, '$.defaultPolicy');
  assertDisjoint(allowed, shadow, errors, '$.allowedPageTypes', 'allowed and shadow page types');
  assertDisjoint(allowed, denied, errors, '$.allowedPageTypes', 'allowed and denied page types');
  assertDisjoint(shadow, denied, errors, '$.shadowPageTypes', 'shadow and denied page types');
  if (value.activationStage === 'AUTO') {
    add(errors, '$.activationStage', 'PR10 registry entries must not be AUTO');
  }
  if (value.actionId === 'PAGE_CLARITY' && value.learningEligibility?.positiveLearningAllowed === true) {
    add(errors, '$.learningEligibility.positiveLearningAllowed', 'PAGE_CLARITY cannot create positive learning');
  }
  return result(errors);
}

function validateFeatureUiV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected feature ui object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'label',
    'description',
    'section',
  ], errors, path, 'feature ui');
  stringField(value, 'label', errors, path, { max: DTO_CAPS.maxUserFacingKeyLength });
  stringField(value, 'description', errors, path);
  enumField(value, 'section', FEATURE_SECTION_VALUES, errors, path);
}

export function validateFeatureRegistryEntryV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'featureId',
    'publicModeId',
    'actionIds',
    'userVisible',
    'userToggleable',
    'defaultEnabled',
    'maturity',
    'learningEligible',
    'safetyInvariant',
    'ui',
  ], errors, '$', 'feature registry entry');
  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  enumField(value, 'featureId', FEATURE_ID_VALUES, errors);
  enumField(value, 'publicModeId', [...Object.values(GUARANTEED_EFFECT_MODE_IDS), 'global', 'safety'], errors);
  validateEnumArray(value, 'actionIds', ADAPTATION_ACTION_ID_VALUES, errors, '$', { max: DTO_CAPS.maxActionRegistryEntries });
  booleanField(value, 'userVisible', errors);
  booleanField(value, 'userToggleable', errors);
  booleanField(value, 'defaultEnabled', errors);
  enumField(value, 'maturity', FEATURE_MATURITY_VALUES, errors);
  booleanField(value, 'learningEligible', errors);
  booleanField(value, 'safetyInvariant', errors);
  validateFeatureUiV1(value.ui, errors, '$.ui');
  if (value.safetyInvariant === true) {
    if (value.userToggleable !== false) {
      add(errors, '$.userToggleable', 'safety invariant must not be user-toggleable');
    }
    if (value.defaultEnabled !== true) {
      add(errors, '$.defaultEnabled', 'safety invariant must be enabled by default');
    }
    if (value.maturity !== 'SAFETY_ALWAYS_ON') {
      add(errors, '$.maturity', 'safety invariant requires SAFETY_ALWAYS_ON maturity');
    }
  }
  return result(errors);
}

function validateVisualGraphNodeV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected visual graph node object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'nodeId',
    'sourceBlockId',
    'regionId',
    'roleHint',
    'targetKind',
    'confidence',
    'rectBuckets',
    'buckets',
    'hints',
    'flags',
    'score',
  ], errors, path, 'visual graph node');
  stringField(value, 'nodeId', errors, path, { max: 32 });
  if (typeof value.nodeId === 'string' && !/^n[1-9][0-9]*$/.test(value.nodeId)) {
    add(errors, `${path}.nodeId`, 'expected compact node id');
  }
  stringField(value, 'sourceBlockId', errors, path, { max: 64 });
  stringField(value, 'regionId', errors, path, { max: 64 });
  if (typeof value.sourceBlockId === 'string' && !/^b[\w-]{1,62}$/.test(value.sourceBlockId)) {
    add(errors, `${path}.sourceBlockId`, 'expected compact source block id');
  }
  if (typeof value.regionId === 'string' && value.regionId !== 'none' && !/^r[\w-]{1,62}$/.test(value.regionId)) {
    add(errors, `${path}.regionId`, 'expected compact region id');
  }
  enumField(value, 'roleHint', BLOCK_ROLE_VALUES, errors, path);
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors, path);
  numberField(value, 'confidence', errors, path, { min: 0, max: 1 });
  validateObservedRectBucketsV2(value.rectBuckets, errors, `${path}.rectBuckets`);
  validateVisualBucketsV1(value.buckets, errors, `${path}.buckets`);
  validateVisualHintsV1(value.hints, errors, `${path}.hints`);
  validateVisualFlagsV1(value.flags, errors, `${path}.flags`);
  numberField(value, 'score', errors, path, { min: 0, max: 1 });
}

function validateVisualGraphEdgeV1(value, errors, path, nodeIds, degree, seenEdges) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected visual graph edge object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'from',
    'to',
    'type',
    'weight',
    'reasons',
  ], errors, path, 'visual graph edge');
  stringField(value, 'from', errors, path, { max: 32 });
  stringField(value, 'to', errors, path, { max: 32 });
  enumField(value, 'type', VISUAL_REGION_GRAPH_EDGE_TYPES, errors, path);
  numberField(value, 'weight', errors, path, { min: 0, max: 1 });
  validateReasonCodeArray(value, 'reasons', errors, path, { max: DTO_CAPS.maxReasons });
  if (typeof value.from === 'string' && !nodeIds.has(value.from)) {
    add(errors, `${path}.from`, 'edge endpoint must reference a node');
  }
  if (typeof value.to === 'string' && !nodeIds.has(value.to)) {
    add(errors, `${path}.to`, 'edge endpoint must reference a node');
  }
  if (value.from === value.to) {
    add(errors, `${path}.to`, 'self edges are not allowed');
  }
  const edgeKey = `${value.from}|${value.to}|${value.type}`;
  if (seenEdges.has(edgeKey)) {
    add(errors, path, 'duplicate edge is not allowed');
  }
  seenEdges.add(edgeKey);
  [value.from, value.to].forEach((id) => {
    if (typeof id !== 'string') return;
    degree.set(id, (degree.get(id) || 0) + 1);
    if (degree.get(id) > 6) {
      add(errors, path, 'edge degree exceeds cap 6');
    }
  });
}

function validateVisualGraphGroupV1(value, errors, path, nodeIds) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected visual graph group object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'groupId',
    'type',
    'memberNodeIds',
    'primaryNodeId',
    'targetKind',
    'confidence',
    'score',
    'reasons',
  ], errors, path, 'visual graph group');
  stringField(value, 'groupId', errors, path, { max: 32 });
  if (typeof value.groupId === 'string' && !/^g[1-9][0-9]*$/.test(value.groupId)) {
    add(errors, `${path}.groupId`, 'expected compact group id');
  }
  enumField(value, 'type', VISUAL_REGION_GRAPH_GROUP_TYPES, errors, path);
  const members = boundedArray(value, 'memberNodeIds', DTO_CAPS.maxVisualGraphNodes, errors, path);
  members.forEach((id, index) => {
    if (typeof id !== 'string' || !nodeIds.has(id)) {
      add(errors, `${path}.memberNodeIds[${index}]`, 'group member must reference a node');
    }
  });
  stringField(value, 'primaryNodeId', errors, path, { max: 32 });
  if (typeof value.primaryNodeId === 'string' && value.primaryNodeId !== 'none' && !nodeIds.has(value.primaryNodeId)) {
    add(errors, `${path}.primaryNodeId`, 'primaryNodeId must reference a node');
  }
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors, path);
  numberField(value, 'confidence', errors, path, { min: 0, max: 1 });
  numberField(value, 'score', errors, path, { min: 0, max: 1 });
  validateReasonCodeArray(value, 'reasons', errors, path, { max: DTO_CAPS.maxReasons });
}

export function validateVisualRegionGraphLiteV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'frameId',
    'pageType',
    'nodes',
    'edges',
    'groups',
    'stats',
  ], errors, '$', 'visual region graph lite');
  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 10000 });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  const nodes = boundedArray(value, 'nodes', DTO_CAPS.maxVisualGraphNodes, errors);
  nodes.forEach((node, index) => validateVisualGraphNodeV1(node, errors, `$.nodes[${index}]`));
  const nodeIds = new Set(nodes.map((node) => node?.nodeId).filter((id) => typeof id === 'string'));
  const edges = boundedArray(value, 'edges', DTO_CAPS.maxVisualGraphEdges, errors);
  const degree = new Map();
  const seenEdges = new Set();
  edges.forEach((edge, index) => validateVisualGraphEdgeV1(edge, errors, `$.edges[${index}]`, nodeIds, degree, seenEdges));
  const groups = boundedArray(value, 'groups', DTO_CAPS.maxVisualGraphGroups, errors);
  groups.forEach((group, index) => validateVisualGraphGroupV1(group, errors, `$.groups[${index}]`, nodeIds));
  if (!isPlainObject(value.stats)) {
    add(errors, '$.stats', 'expected stats object');
  } else {
    rejectUnexpectedKeys(value.stats, [
      'nodesSeen',
      'edgesSeen',
      'groupsSeen',
      'budgetHit',
      'partial',
    ], errors, '$.stats', 'visual graph stats');
    integerField(value.stats, 'nodesSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxVisualGraphNodes });
    integerField(value.stats, 'edgesSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxVisualGraphEdges });
    integerField(value.stats, 'groupsSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxVisualGraphGroups });
    booleanField(value.stats, 'budgetHit', errors, '$.stats');
    booleanField(value.stats, 'partial', errors, '$.stats');
  }

  return result(errors);
}

function validateRepeatedRecordMetricsV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected repeated record metrics object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'memberCountBucket',
    'repeatedShapeScore',
    'sameRowScore',
    'sameColumnScore',
    'linkDensityBucket',
    'mediaSeparationScore',
  ], errors, path, 'repeated record metrics');
  bucketField(value, 'memberCountBucket', errors, path);
  bucketField(value, 'linkDensityBucket', errors, path);
  ['repeatedShapeScore', 'sameRowScore', 'sameColumnScore', 'mediaSeparationScore'].forEach((key) => {
    numberField(value, key, errors, path, { min: 0, max: 1 });
  });
}

function validateRepeatedRecordGroupV1(value, errors, path) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected repeated record group object');
    return;
  }
  rejectUnexpectedKeys(value, [
    'groupId',
    'targetKind',
    'sourceRegionIds',
    'sourceBlockIds',
    'confidence',
    'reasons',
    'metrics',
  ], errors, path, 'repeated record group');
  stringField(value, 'groupId', errors, path, { max: 32 });
  if (typeof value.groupId === 'string' && !/^rrg[1-9][0-9]*$/.test(value.groupId)) {
    add(errors, `${path}.groupId`, 'expected compact repeated record group id');
  }
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors, path);
  if (value.targetKind !== 'RECORD_REGION') {
    add(errors, `${path}.targetKind`, 'repeated record groups must target RECORD_REGION');
  }
  const regionIds = boundedArray(value, 'sourceRegionIds', DTO_CAPS.maxRepeatedRecordSamples, errors, path);
  regionIds.forEach((id, index) => {
    if (typeof id !== 'string' || !/^r[\w-]{1,62}$/.test(id)) {
      add(errors, `${path}.sourceRegionIds[${index}]`, 'expected compact region id');
    }
  });
  const blockIds = boundedArray(value, 'sourceBlockIds', DTO_CAPS.maxRepeatedRecordSamples, errors, path);
  blockIds.forEach((id, index) => {
    if (typeof id !== 'string' || !/^b[\w-]{1,62}$/.test(id)) {
      add(errors, `${path}.sourceBlockIds[${index}]`, 'expected compact source block id');
    }
  });
  numberField(value, 'confidence', errors, path, { min: 0, max: 1 });
  validateReasonCodeArray(value, 'reasons', errors, path, { max: DTO_CAPS.maxReasons });
  validateRepeatedRecordMetricsV1(value.metrics, errors, `${path}.metrics`);
}

export function validateRepeatedRecordGroupsV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }
  rejectUnexpectedKeys(value, [
    'version',
    'frameId',
    'groups',
    'stats',
  ], errors, '$', 'repeated record groups');
  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 10000 });
  boundedArray(value, 'groups', DTO_CAPS.maxRepeatedRecordGroups, errors).forEach((group, index) => {
    validateRepeatedRecordGroupV1(group, errors, `$.groups[${index}]`);
  });
  if (!isPlainObject(value.stats)) {
    add(errors, '$.stats', 'expected stats object');
  } else {
    rejectUnexpectedKeys(value.stats, [
      'groupsSeen',
      'nodesSeen',
      'budgetHit',
    ], errors, '$.stats', 'repeated record stats');
    integerField(value.stats, 'groupsSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxRepeatedRecordGroups });
    integerField(value.stats, 'nodesSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxVisualGraphNodes });
    booleanField(value.stats, 'budgetHit', errors, '$.stats');
  }

  return result(errors);
}

function validateScopeCandidate(value, errors, path, { selected = false } = {}) {
  if (!isPlainObject(value)) {
    add(errors, path, 'expected scope candidate object');
    return;
  }

  stringField(value, 'blockId', errors, path);
  enumField(value, 'roleHint', BLOCK_ROLE_VALUES, errors, path);
  numberField(value, 'confidence', errors, path, { min: 0, max: 1 });
  validateReasonArray(value, 'reasons', errors, path);

  if (!selected) {
    numberField(value, 'score', errors, path, { min: 0, max: 1 });
    validateRectRatio(value.rectRatio, errors, `${path}.rectRatio`);
    validateMetrics(value.metrics, errors, `${path}.metrics`);
  }
}

function baseValidate(value) {
  const privacy = validatePrivacySafeJson(value);
  return [...privacy.errors];
}

export function validateCollectedPageSignalsV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'frameId',
    'collectionEpoch',
    'routeEpoch',
    'viewport',
    'pageHints',
    'aggregateMetrics',
    'blocks',
    'stats',
    'observedNodeSignalsV2',
  ], errors, '$', 'collected page signals');

  numberField(value, 'frameId', errors, '$', { min: 0 });
  stringField(value, 'collectionEpoch', errors, '$', { max: 64 });
  stringField(value, 'routeEpoch', errors, '$', { max: 64 });

  if (!isPlainObject(value.viewport)) {
    add(errors, '$.viewport', 'expected viewport object');
  } else {
    numberField(value.viewport, 'w', errors, '$.viewport', { min: 1, max: 10000 });
    numberField(value.viewport, 'h', errors, '$.viewport', { min: 1, max: 10000 });
  }

  if (!isPlainObject(value.pageHints)) {
    add(errors, '$.pageHints', 'expected pageHints object');
  } else {
    enumField(value.pageHints, 'urlKind', PAGE_TYPE_VALUES, errors, '$.pageHints');
    [
      'semanticArticleCount',
      'formCount',
      'smallTargetCount',
      'tableCount',
      'mediaCount',
      'fixedOrStickyCount',
      'modalLikeCount',
    ].forEach((key) => numberField(value.pageHints, key, errors, '$.pageHints', {
      optional: key === 'smallTargetCount',
      min: 0,
      max: 1000,
    }));
  }

  validateMetrics(value.aggregateMetrics, errors, '$.aggregateMetrics');
  validateStats(value.stats, errors, '$.stats');

  const blocks = boundedArray(value, 'blocks', DTO_CAPS.maxBlocks, errors);
  blocks.forEach((block, index) => {
    const path = `$.blocks[${index}]`;
    if (!isPlainObject(block)) {
      add(errors, path, 'expected block object');
      return;
    }
    stringField(block, 'blockId', errors, path);
    enumField(block, 'roleHint', BLOCK_ROLE_VALUES, errors, path);
    validateRectRatio(block.rectRatio, errors, `${path}.rectRatio`);
    validateMetrics(block.metrics, errors, `${path}.metrics`);
    validateReasonArray(block, 'flags', errors, path);
  });

  if (value.observedNodeSignalsV2 != null) {
    const observedValidation = validateObservedNodeSignalsV2(value.observedNodeSignalsV2);
    observedValidation.errors.forEach((error) => {
      add(errors, `$.observedNodeSignalsV2${error.path === '$' ? '' : error.path.slice(1)}`, error.message);
    });
  }

  return result(errors);
}

export function validateRegionTargetValidationRequestV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'frameId',
    'collectionEpoch',
    'routeEpoch',
    'sourceBlockId',
    'regionId',
    'expectedTargetKind',
  ], errors, '$', 'region target validation request');

  numberField(value, 'schemaVersion', errors, '$', { min: 1, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 1000000 });
  if (typeof value.frameId === 'number' && !Number.isInteger(value.frameId)) {
    add(errors, '$.frameId', 'expected integer frameId');
  }
  stringField(value, 'collectionEpoch', errors, '$', { max: 64 });
  stringField(value, 'routeEpoch', errors, '$', { max: 64 });
  stringField(value, 'sourceBlockId', errors, '$', { optional: true, max: 64 });
  stringField(value, 'regionId', errors, '$', { optional: true, max: 64 });
  if (!value.sourceBlockId && !value.regionId) {
    add(errors, '$.sourceBlockId', 'expected sourceBlockId or regionId');
  }
  enumField(value, 'expectedTargetKind', TARGET_KIND_VALUES, errors);

  return result(errors);
}

export function validateRegionTargetValidationResultV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'ok',
    'reason',
    'sameEpoch',
    'stillConnected',
    'stillVisible',
    'roleHintStillMatches',
    'confidence',
    'frameId',
  ], errors, '$', 'region target validation result');

  numberField(value, 'schemaVersion', errors, '$', { min: 1, max: 1 });
  booleanField(value, 'ok', errors);
  stringField(value, 'reason', errors, '$', { max: 96 });
  booleanField(value, 'sameEpoch', errors);
  booleanField(value, 'stillConnected', errors);
  booleanField(value, 'stillVisible', errors);
  booleanField(value, 'roleHintStillMatches', errors);
  numberField(value, 'confidence', errors, '$', { min: 0, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 1000000 });

  return result(errors);
}

export function validatePageUnderstandingProfileV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  ['allowedActions', 'deniedActions', 'actionDecisions', 'policy', 'applyPlan', 'rollbackPlan'].forEach((key) => {
    if (key in value) {
      add(errors, `$.${key}`, 'action policy fields do not belong in PageUnderstandingProfileV1');
    }
  });

  numberField(value, 'frameId', errors, '$', { min: 0 });
  stringField(value, 'collectionEpoch', errors, '$', { optional: true, max: 64 });
  stringField(value, 'routeEpoch', errors, '$', { optional: true, max: 64 });
  stringField(value, 'domainHash', errors, '$', { optional: true });
  stringField(value, 'templateHash', errors, '$', { optional: true });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  numberField(value, 'pageTypeConfidence', errors, '$', { min: 0, max: 1 });
  validateRisk(value.risk, errors, '$.risk');
  validateStats(value.stats, errors, '$.stats');
  validateReasonArray(value, 'reasons', errors);
  boundedArray(value, 'candidates', DTO_CAPS.maxCandidates, errors).forEach((candidate, index) => {
    validateScopeCandidate(candidate, errors, `$.candidates[${index}]`);
  });
  boundedArray(value, 'problems', DTO_CAPS.maxProblems, errors).forEach((problem, index) => {
    const path = `$.problems[${index}]`;
    if (isPlainObject(problem)) {
      enumField(problem, 'code', PROBLEM_CODE_VALUES, errors, path);
      enumField(problem, 'severity', INVARIANT_SEVERITY_VALUES, errors, path);
      validateReasonArray(problem, 'reasons', errors, path);
    } else {
      add(errors, path, 'expected problem object');
    }
  });

  if (value.selectedScope !== null && value.selectedScope !== undefined) {
    validateScopeCandidate(value.selectedScope, errors, '$.selectedScope', { selected: true });
  }

  return result(errors);
}

export function validateActionContextV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'actionId',
    'source',
    'requestedStrength',
    'userExplicit',
    'autoApplyCandidate',
  ], errors, '$', 'action context');

  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'source', ACTION_CONTEXT_SOURCE_VALUES, errors);
  numberField(value, 'requestedStrength', errors, '$', { optional: true, min: 0, max: 1 });
  booleanField(value, 'userExplicit', errors);
  booleanField(value, 'autoApplyCandidate', errors);

  return result(errors);
}

function validateEvidenceArray(value, key, errors, path = '$') {
  const evidence = boundedArray(value, key, DTO_CAPS.maxEvidence, errors, path, { optional: true });
  evidence.forEach((item, index) => {
    const nextPath = `${path}.${key}[${index}]`;
    if (!isPlainObject(item)) {
      add(errors, nextPath, 'expected evidence object');
      return;
    }
    enumField(item, 'reason', REASON_CODE_VALUES, errors, nextPath);
    stringField(item, 'metricPath', errors, nextPath);
    enumField(item, 'operator', EVIDENCE_OPERATOR_VALUES, errors, nextPath);
    if (!['number', 'string', 'boolean'].includes(typeof item.observed)) {
      add(errors, `${nextPath}.observed`, 'expected primitive observed value');
    }
  });
}

function validateInvariantCheck(check, errors, path) {
  if (!isPlainObject(check)) {
    add(errors, path, 'expected invariant object');
    return;
  }
  enumField(check, 'code', INVARIANT_CODE_VALUES, errors, path);
  enumField(check, 'phase', INVARIANT_PHASE_VALUES, errors, path);
  enumField(check, 'severity', INVARIANT_SEVERITY_VALUES, errors, path);
  validateEvidenceArray(check, 'evidence', errors, path);
}

function assertDisjoint(left, right, errors, path, label) {
  const rightSet = new Set(Array.isArray(right) ? right : []);
  for (const entry of Array.isArray(left) ? left : []) {
    if (rightSet.has(entry)) {
      add(errors, path, `${label} must be disjoint`);
    }
  }
}

function validateApplyPlan(value, errors, path) {
  if (!isPlainObject(value) || value.kind !== 'SCOPED_CSS') {
    add(errors, path, 'expected SCOPED_CSS apply plan');
    return;
  }
  const allowedKeys = new Set(['kind', 'modeId', 'maxStrength']);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      add(errors, `${path}.${key}`, 'unexpected apply plan field');
    }
  }
  stringField(value, 'modeId', errors, path);
  numberField(value, 'maxStrength', errors, path, { optional: true, min: 0, max: 1 });
}

function rejectUnexpectedKeys(value, allowedKeys, errors, path, label) {
  if (!isPlainObject(value)) return;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      add(errors, `${path}.${key}`, `unexpected ${label} field`);
    }
  }
}

function rejectShadowForbiddenKeys(value, errors, path = '$', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectShadowForbiddenKeys(item, errors, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SHADOW_EXTRA_FORBIDDEN_KEYS.includes(key)) {
      add(errors, `${path}.${key}`, `shadow-forbidden key "${key}"`);
    }
    rejectShadowForbiddenKeys(child, errors, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function validateBoundedStringArray(value, key, errors, path = '$', { optional = false, max = Number(DTO_CAPS.maxShadowReasons) } = {}) {
  const items = boundedArray(value, key, max, errors, path, { optional });
  items.forEach((item, index) => {
    if (typeof item !== 'string' || item.length < 1 || item.length > DTO_CAPS.maxUserFacingKeyLength) {
      add(errors, `${path}.${key}[${index}]`, 'expected bounded string');
    }
  });
}

export function validateAdaptationContractV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'contractId',
    'actionId',
    'outcome',
    'allowedPageTypes',
    'deniedPageTypes',
    'requiredScopeRoles',
    'forbiddenScopeRoles',
    'toleratedBlockingProblems',
    'preconditions',
    'postconditions',
    'applyPlan',
    'rollbackPlan',
    'learningEligibility',
    'explanation',
  ], errors, '$', 'contract');

  stringField(value, 'contractId', errors);
  if (typeof value?.contractId === 'string' && !Object.values(CONTRACT_IDS).includes(value.contractId)) {
    add(errors, '$.contractId', 'unknown contract id');
  }
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'outcome', OUTCOME_ID_VALUES, errors);
  const allowedPageTypes = boundedArray(value, 'allowedPageTypes', DTO_CAPS.maxCandidates, errors);
  const deniedPageTypes = boundedArray(value, 'deniedPageTypes', DTO_CAPS.maxCandidates, errors);
  const requiredScopeRoles = boundedArray(value, 'requiredScopeRoles', DTO_CAPS.maxCandidates, errors);
  const forbiddenScopeRoles = boundedArray(value, 'forbiddenScopeRoles', DTO_CAPS.maxCandidates, errors);
  const toleratedBlockingProblems = boundedArray(value, 'toleratedBlockingProblems', DTO_CAPS.maxProblems, errors, '$', { optional: true });
  if (allowedPageTypes.length === 0) add(errors, '$.allowedPageTypes', 'expected at least one allowed page type');
  if (value.actionId && value.contractId && value.actionId !== value.contractId) {
    add(errors, '$.contractId', 'contract id must match action id');
  }
  assertDisjoint(allowedPageTypes, deniedPageTypes, errors, '$.allowedPageTypes', 'allowed and denied page types');
  assertDisjoint(requiredScopeRoles, forbiddenScopeRoles, errors, '$.requiredScopeRoles', 'required and forbidden scope roles');

  allowedPageTypes.forEach((entry, index) => {
    if (!isEnumValue(PAGE_TYPE_VALUES, entry)) add(errors, `$.allowedPageTypes[${index}]`, 'unknown page type');
  });
  deniedPageTypes.forEach((entry, index) => {
    if (!isEnumValue(PAGE_TYPE_VALUES, entry)) add(errors, `$.deniedPageTypes[${index}]`, 'unknown page type');
  });
  requiredScopeRoles.forEach((entry, index) => {
    if (!isEnumValue(BLOCK_ROLE_VALUES, entry)) add(errors, `$.requiredScopeRoles[${index}]`, 'unknown block role');
  });
  forbiddenScopeRoles.forEach((entry, index) => {
    if (!isEnumValue(BLOCK_ROLE_VALUES, entry)) add(errors, `$.forbiddenScopeRoles[${index}]`, 'unknown block role');
  });
  toleratedBlockingProblems.forEach((entry, index) => {
    if (!isEnumValue(PROBLEM_CODE_VALUES, entry)) add(errors, `$.toleratedBlockingProblems[${index}]`, 'unknown problem code');
  });
  const preconditions = boundedArray(value, 'preconditions', DTO_CAPS.maxChecks, errors);
  const postconditions = boundedArray(value, 'postconditions', DTO_CAPS.maxChecks, errors);
  if (preconditions.length === 0) add(errors, '$.preconditions', 'expected at least one precondition');
  if (postconditions.length === 0) add(errors, '$.postconditions', 'expected at least one postcondition');
  preconditions.forEach((check, index) => {
    const path = `$.preconditions[${index}]`;
    validateInvariantCheck(check, errors, path);
    if (check?.phase !== INVARIANT_PHASES.PRE_APPLY) {
      add(errors, `${path}.phase`, 'preconditions must be PRE_APPLY');
    }
  });
  postconditions.forEach((check, index) => {
    const path = `$.postconditions[${index}]`;
    validateInvariantCheck(check, errors, path);
    if (check?.phase !== INVARIANT_PHASES.POST_APPLY) {
      add(errors, `${path}.phase`, 'postconditions must be POST_APPLY');
    }
  });
  validateApplyPlan(value.applyPlan, errors, '$.applyPlan');
  if (!isPlainObject(value.rollbackPlan) || value.rollbackPlan.kind !== 'REMOVE_OWNED_CSS_AND_TOKENS') {
    add(errors, '$.rollbackPlan', 'expected owned CSS/token rollback plan');
  }
  if (!isPlainObject(value.learningEligibility)) {
    add(errors, '$.learningEligibility', 'expected learning eligibility object');
  } else {
    booleanField(value.learningEligibility, 'requiresPostApplyPass', errors, '$.learningEligibility');
    numberField(value.learningEligibility, 'requiresNoUndoWindowMs', errors, '$.learningEligibility', { min: 0 });
    booleanField(value.learningEligibility, 'ignoredIsWeakNegative', errors, '$.learningEligibility');
    booleanField(value.learningEligibility, 'rollbackIsHardNegative', errors, '$.learningEligibility');
  }
  if (!isPlainObject(value.explanation)) {
    add(errors, '$.explanation', 'expected explanation object');
  } else {
    stringField(value.explanation, 'userFacingSummaryKey', errors, '$.explanation', { max: 96 });
    validateReasonArray(value.explanation, 'debugReasonCodes', errors, '$.explanation');
  }

  return result(errors);
}

export function validateActionPolicyDecisionV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'actionId',
    'decision',
    'confidence',
    'selectedScopeId',
    'contractId',
    'reasons',
    'risk',
    'constraints',
  ], errors, '$', 'action policy decision');

  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'decision', ACTION_POLICY_DECISION_VALUES, errors);
  numberField(value, 'confidence', errors, '$', { min: 0, max: 1 });
  stringField(value, 'selectedScopeId', errors, '$', { optional: true });
  stringField(value, 'contractId', errors, '$', { optional: true });
  if (value.decision === ACTION_POLICY_DECISIONS.DENY && value.selectedScopeId != null) {
    add(errors, '$.selectedScopeId', 'DENY decisions must not expose selected scope');
  }
  validateReasonArray(value, 'reasons', errors);
  validateRisk(value.risk, errors, '$.risk');
  if (!isPlainObject(value.constraints)) {
    add(errors, '$.constraints', 'expected constraints object');
  } else {
    rejectUnexpectedKeys(value.constraints, [
      'maxStrength',
      'scopeRequired',
      'autoApplyAllowed',
      'postApplyInspectionRequired',
    ], errors, '$.constraints', 'constraints');
    numberField(value.constraints, 'maxStrength', errors, '$.constraints', { optional: true, min: 0, max: 1 });
    booleanField(value.constraints, 'scopeRequired', errors, '$.constraints');
    booleanField(value.constraints, 'autoApplyAllowed', errors, '$.constraints');
    booleanField(value.constraints, 'postApplyInspectionRequired', errors, '$.constraints');
    if (value.decision !== ACTION_POLICY_DECISIONS.DENY && value.constraints.scopeRequired === true && value.selectedScopeId == null) {
      add(errors, '$.selectedScopeId', 'positive scoped decisions must expose selected scope');
    }
  }

  return result(errors);
}

function validateV3LightShadowPlanV1(value, errors, path) {
  if (value == null) return;
  if (!isPlainObject(value)) {
    add(errors, path, 'expected v3LightShadow object');
    return;
  }

  rejectUnexpectedKeys(value, [
    'version',
    'actionId',
    'desiredEffect',
    'targetKind',
    'effectClass',
    'sourceBlockId',
    'regionId',
    'collectionEpoch',
    'routeEpoch',
    'capabilityStatus',
    'supportLevel',
    'activationStage',
    'executor',
    'activePlanAllowed',
    'actionTargetDecisionHint',
    'actionTargetConfidence',
    'shadowOnly',
  ], errors, path, 'v3LightShadow');

  numberField(value, 'version', errors, path, { min: 1, max: 1 });
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors, path);
  stringField(value, 'desiredEffect', errors, path, { optional: true, max: 128 });
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors, path);
  enumField(value, 'effectClass', EFFECT_CLASS_VALUES, errors, path);
  stringField(value, 'sourceBlockId', errors, path, { optional: true, max: 64 });
  stringField(value, 'regionId', errors, path, { optional: true, max: 64 });
  stringField(value, 'collectionEpoch', errors, path, { optional: true, max: 64 });
  stringField(value, 'routeEpoch', errors, path, { optional: true, max: 64 });
  enumField(value, 'capabilityStatus', CAPABILITY_STATUS_VALUES, errors, path);
  enumField(value, 'supportLevel', SUPPORT_LEVEL_VALUES, errors, path);
  enumField(value, 'activationStage', ACTIVATION_STAGE_VALUES, errors, path);
  enumField(value, 'executor', RUNTIME_EXECUTOR_VALUES, errors, path);
  booleanField(value, 'activePlanAllowed', errors, path);
  stringField(value, 'actionTargetDecisionHint', errors, path);
  numberField(value, 'actionTargetConfidence', errors, path, { min: 0, max: 1 });
  booleanField(value, 'shadowOnly', errors, path);
  if (value.shadowOnly !== true) {
    add(errors, `${path}.shadowOnly`, 'v3LightShadow must remain shadowOnly true');
  }
  if (['REPORT_ONLY', 'SHADOW_ONLY', 'AUTO'].includes(value.activationStage) && value.activePlanAllowed === true) {
    add(errors, `${path}.activePlanAllowed`, 'activationStage cannot produce an active V3-light plan');
  }
  if (value.capabilityStatus === 'CAPABILITY_MISSING') {
    const expectedSupport = value.actionId === 'PAGE_CLARITY'
      ? ['NOT_IMPLEMENTED', 'SHADOW_ONLY']
      : ['NOT_IMPLEMENTED'];
    if (!expectedSupport.includes(value.supportLevel)) {
      add(errors, `${path}.supportLevel`, 'CAPABILITY_MISSING has invalid support level');
    }
    if (value.executor !== 'NONE') {
      add(errors, `${path}.executor`, 'CAPABILITY_MISSING requires NONE executor');
    }
    if (value.activePlanAllowed !== false) {
      add(errors, `${path}.activePlanAllowed`, 'CAPABILITY_MISSING cannot produce an active V3-light plan');
    }
  }
  if (['INTENTIONAL_DENY', 'HARD_BLOCKED'].includes(value.capabilityStatus)) {
    if (value.supportLevel !== 'REPORT_ONLY') {
      add(errors, `${path}.supportLevel`, `${value.capabilityStatus} requires REPORT_ONLY support`);
    }
    if (value.executor !== 'NONE') {
      add(errors, `${path}.executor`, `${value.capabilityStatus} requires NONE executor`);
    }
    if (value.activePlanAllowed !== false) {
      add(errors, `${path}.activePlanAllowed`, `${value.capabilityStatus} cannot produce an active V3-light plan`);
    }
  }
  if (value.capabilityStatus === 'SAFE_ABSTAIN') {
    if (value.supportLevel !== 'REPORT_ONLY') {
      add(errors, `${path}.supportLevel`, 'SAFE_ABSTAIN requires REPORT_ONLY support');
    }
    if (value.executor !== 'NOOP') {
      add(errors, `${path}.executor`, 'SAFE_ABSTAIN requires NOOP executor');
    }
    if (value.activePlanAllowed !== false) {
      add(errors, `${path}.activePlanAllowed`, 'SAFE_ABSTAIN cannot produce an active V3-light plan');
    }
  }
  if (value.capabilityStatus === 'SUPPORTED') {
    if (value.supportLevel !== 'ACTIVE_RUNTIME') {
      add(errors, `${path}.supportLevel`, 'SUPPORTED requires ACTIVE_RUNTIME support');
    }
    if (value.executor === 'NONE' || value.executor === 'NOOP') {
      add(errors, `${path}.executor`, 'SUPPORTED requires an active executor');
    }
    if (value.activePlanAllowed !== true) {
      add(errors, `${path}.activePlanAllowed`, 'SUPPORTED requires activePlanAllowed true');
    }
    if (value.executor === 'REGION_CLASS_TOKENS') {
      if (
        typeof value.sourceBlockId !== 'string'
        || typeof value.regionId !== 'string'
        || (value.sourceBlockId === 'none' && value.regionId === 'none')
      ) {
        add(errors, `${path}.sourceBlockId`, 'REGION_CLASS_TOKENS requires a target block or region');
      }
      if (typeof value.collectionEpoch !== 'string' || typeof value.routeEpoch !== 'string') {
        add(errors, `${path}.collectionEpoch`, 'REGION_CLASS_TOKENS requires collection and route epochs');
      }
    }
  }
}

export function validateRuntimeEffectPlanV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'version',
    'matrixVersion',
    'modeId',
    'actionId',
    'pageType',
    'frameId',
    'strongEffect',
    'safeDowngrade',
    'readerAllowed',
    'overrideAllowed',
    'overrideScope',
    'postChecks',
    'policyDecision',
    'confidence',
    'v3LightShadow',
  ], errors, '$', 'runtime effect plan');

  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  numberField(value, 'matrixVersion', errors, '$', {
    min: GUARANTEED_EFFECT_MATRIX_VERSION,
    max: GUARANTEED_EFFECT_MATRIX_VERSION,
  });
  enumField(value, 'modeId', Object.values(GUARANTEED_EFFECT_MODE_IDS), errors);
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  numberField(value, 'frameId', errors, '$', { min: 0, max: 10000 });
  stringField(value, 'strongEffect', errors);
  stringField(value, 'safeDowngrade', errors);
  booleanField(value, 'readerAllowed', errors);
  booleanField(value, 'overrideAllowed', errors);
  if (value.overrideAllowed === true) {
    if (value.overrideScope !== 'TAB_SESSION') {
      add(errors, '$.overrideScope', 'override must be tab-session scoped');
    }
  } else if (value.overrideScope !== 'NONE') {
    add(errors, '$.overrideScope', 'override scope must be NONE when override is disabled');
  }
  const postChecks = boundedArray(value, 'postChecks', DTO_CAPS.maxChecks, errors);
  postChecks.forEach((check, index) => {
    if (!isEnumValue(POST_APPLY_CHECK_CODE_VALUES, check)) {
      add(errors, `$.postChecks[${index}]`, 'expected known post-apply check code');
    }
  });
  enumField(value, 'policyDecision', ACTION_POLICY_DECISION_VALUES, errors);
  numberField(value, 'confidence', errors, '$', { min: 0, max: 1 });
  validateV3LightShadowPlanV1(value.v3LightShadow, errors, '$.v3LightShadow');

  return result(errors);
}

export function validateRuntimeCapabilityKeyV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'modeId',
    'actionId',
    'pageType',
    'targetKind',
    'effectClass',
  ], errors, '$', 'runtime capability key');

  enumField(value, 'modeId', Object.values(GUARANTEED_EFFECT_MODE_IDS), errors);
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors);
  enumField(value, 'effectClass', EFFECT_CLASS_VALUES, errors);

  return result(errors);
}

export function validateLearningEffectKeyV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'modeId',
    'actionId',
    'targetKind',
    'effectClass',
    'pageType',
  ], errors, '$', 'learning effect key');

  enumField(value, 'modeId', Object.values(GUARANTEED_EFFECT_MODE_IDS), errors);
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors);
  enumField(value, 'effectClass', EFFECT_CLASS_VALUES, errors);
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);

  return result(errors);
}

export function validateRuntimeCapabilityDecisionV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'version',
    'key',
    'desiredEffect',
    'status',
    'supportLevel',
    'activationStage',
    'executor',
    'activePlanAllowed',
    'reason',
    'postChecksRequired',
    'learningEligible',
  ], errors, '$', 'runtime capability decision');

  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  const keyValidation = validateRuntimeCapabilityKeyV1(value.key);
  keyValidation.errors.forEach((error) => {
    add(errors, `$.key${error.path.slice(1)}`, error.message);
  });
  stringField(value, 'desiredEffect', errors);
  enumField(value, 'status', CAPABILITY_STATUS_VALUES, errors);
  enumField(value, 'supportLevel', SUPPORT_LEVEL_VALUES, errors);
  enumField(value, 'activationStage', ACTIVATION_STAGE_VALUES, errors);
  enumField(value, 'executor', RUNTIME_EXECUTOR_VALUES, errors);
  booleanField(value, 'activePlanAllowed', errors);
  stringField(value, 'reason', errors);
  booleanField(value, 'postChecksRequired', errors);
  booleanField(value, 'learningEligible', errors);

  if (['REPORT_ONLY', 'SHADOW_ONLY', 'AUTO'].includes(value.activationStage) && value.activePlanAllowed === true) {
    add(errors, '$.activePlanAllowed', 'activationStage cannot produce an active runtime plan');
  }

  if (value.status === 'CAPABILITY_MISSING') {
    const shadowMissingAction = ['PAGE_CLARITY', 'TARGET_SIZE'].includes(value.key?.actionId);
    const expectedSupport = shadowMissingAction ? ['NOT_IMPLEMENTED', 'SHADOW_ONLY'] : ['NOT_IMPLEMENTED'];
    if (!expectedSupport.includes(value.supportLevel)) {
      add(errors, '$.supportLevel', shadowMissingAction
        ? `${value.key?.actionId} CAPABILITY_MISSING requires NOT_IMPLEMENTED or SHADOW_ONLY support`
        : 'CAPABILITY_MISSING requires NOT_IMPLEMENTED support');
    }
    if (value.executor !== 'NONE') {
      add(errors, '$.executor', 'CAPABILITY_MISSING requires NONE executor');
    }
    if (value.activePlanAllowed !== false) {
      add(errors, '$.activePlanAllowed', 'CAPABILITY_MISSING requires activePlanAllowed false');
    }
    if (value.learningEligible !== false) {
      add(errors, '$.learningEligible', 'CAPABILITY_MISSING requires learningEligible false');
    }
  }
  if (['INTENTIONAL_DENY', 'HARD_BLOCKED'].includes(value.status)) {
    if (value.supportLevel !== 'REPORT_ONLY') {
      add(errors, '$.supportLevel', `${value.status} requires REPORT_ONLY support`);
    }
    if (value.executor !== 'NONE') {
      add(errors, '$.executor', `${value.status} requires NONE executor`);
    }
    if (value.activePlanAllowed !== false) {
      add(errors, '$.activePlanAllowed', `${value.status} requires activePlanAllowed false`);
    }
    if (value.postChecksRequired !== false) {
      add(errors, '$.postChecksRequired', `${value.status} requires postChecksRequired false`);
    }
    if (value.learningEligible !== false) {
      add(errors, '$.learningEligible', `${value.status} requires learningEligible false`);
    }
  }
  if (value.status === 'SAFE_ABSTAIN') {
    if (value.supportLevel !== 'REPORT_ONLY') {
      add(errors, '$.supportLevel', 'SAFE_ABSTAIN requires REPORT_ONLY support');
    }
    if (value.executor !== 'NOOP') {
      add(errors, '$.executor', 'SAFE_ABSTAIN requires NOOP executor');
    }
    if (value.activePlanAllowed !== false) {
      add(errors, '$.activePlanAllowed', 'SAFE_ABSTAIN requires activePlanAllowed false');
    }
    if (value.postChecksRequired !== false) {
      add(errors, '$.postChecksRequired', 'SAFE_ABSTAIN requires postChecksRequired false');
    }
    if (value.learningEligible !== false) {
      add(errors, '$.learningEligible', 'SAFE_ABSTAIN requires learningEligible false');
    }
  }
  if (value.status === 'SUPPORTED') {
    if (value.supportLevel !== 'ACTIVE_RUNTIME') {
      add(errors, '$.supportLevel', 'SUPPORTED requires ACTIVE_RUNTIME support');
    }
    if (value.executor === 'NONE' || value.executor === 'NOOP') {
      add(errors, '$.executor', 'SUPPORTED requires an active executor');
    }
    if (value.activePlanAllowed !== true) {
      add(errors, '$.activePlanAllowed', 'SUPPORTED requires activePlanAllowed true');
    }
    if (['REPORT_ONLY', 'SHADOW_ONLY', 'AUTO'].includes(value.activationStage)) {
      add(errors, '$.activationStage', 'SUPPORTED requires manual or verified activation stage');
    }
    if (value.postChecksRequired !== true) {
      add(errors, '$.postChecksRequired', 'SUPPORTED requires postChecksRequired true');
    }
    if (value.learningEligible !== false) {
      add(errors, '$.learningEligible', 'SUPPORTED runtime capability does not grant learning eligibility');
    }
  }

  return result(errors);
}

export function validateRegionCandidateV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'regionId',
    'sourceBlockId',
    'targetKind',
    'roleHint',
    'confidence',
    'reasons',
    'risk',
    'metrics',
  ], errors, '$', 'region candidate');

  stringField(value, 'regionId', errors);
  stringField(value, 'sourceBlockId', errors);
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors);
  enumField(value, 'roleHint', BLOCK_ROLE_VALUES, errors);
  numberField(value, 'confidence', errors, '$', { min: 0, max: 1 });
  validateReasonArray(value, 'reasons', errors);
  validateRisk(value.risk, errors, '$.risk');
  validateMetrics(value.metrics, errors, '$.metrics');

  return result(errors);
}

export function validateRegionInventoryV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'version',
    'frameId',
    'pageType',
    'regions',
    'stats',
  ], errors, '$', 'region inventory');

  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 10000 });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  boundedArray(value, 'regions', DTO_CAPS.maxCandidates, errors).forEach((region, index) => {
    const validation = validateRegionCandidateV1(region);
    validation.errors.forEach((error) => {
      add(errors, `$.regions[${index}]${error.path.slice(1)}`, error.message);
    });
  });
  if (!isPlainObject(value.stats)) {
    add(errors, '$.stats', 'expected stats object');
  } else {
    rejectUnexpectedKeys(value.stats, [
      'regionsSeen',
      'budgetHit',
    ], errors, '$.stats', 'region inventory stats');
    numberField(value.stats, 'regionsSeen', errors, '$.stats', { min: 0, max: DTO_CAPS.maxCandidates });
    booleanField(value.stats, 'budgetHit', errors, '$.stats');
  }

  return result(errors);
}

export function validateActionTargetV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'actionId',
    'targetKind',
    'regionId',
    'sourceBlockId',
    'effectClass',
    'confidence',
    'decisionHint',
    'reasons',
  ], errors, '$', 'action target');

  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'targetKind', TARGET_KIND_VALUES, errors);
  stringField(value, 'regionId', errors);
  stringField(value, 'sourceBlockId', errors);
  enumField(value, 'effectClass', EFFECT_CLASS_VALUES, errors);
  numberField(value, 'confidence', errors, '$', { min: 0, max: 1 });
  stringField(value, 'decisionHint', errors);
  validateReasonArray(value, 'reasons', errors);

  return result(errors);
}

export function validateActionTargetsV1(value) {
  const errors = baseValidate(value);
  if (!isPlainObject(value)) {
    add(errors, '$', 'DTO must be a plain object');
    return result(errors);
  }

  rejectUnexpectedKeys(value, [
    'version',
    'frameId',
    'actionTargets',
  ], errors, '$', 'action targets');

  numberField(value, 'version', errors, '$', { min: 1, max: 1 });
  numberField(value, 'frameId', errors, '$', { min: 0, max: 10000 });
  boundedArray(value, 'actionTargets', DTO_CAPS.maxCandidates, errors).forEach((target, index) => {
    const validation = validateActionTargetV1(target);
    validation.errors.forEach((error) => {
      add(errors, `$.actionTargets[${index}]${error.path.slice(1)}`, error.message);
    });
  });

  return result(errors);
}

export function validatePostApplyInspectionResultV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  stringField(value, 'attemptId', errors);
  booleanField(value, 'passed', errors);
  booleanField(value, 'rollbackRequired', errors);
  validateReasonArray(value, 'reasons', errors);
  boundedArray(value, 'checks', DTO_CAPS.maxChecks, errors).forEach((check, index) => {
    const path = `$.checks[${index}]`;
    if (!isPlainObject(check)) {
      add(errors, path, 'expected check object');
      return;
    }
    enumField(check, 'code', POST_APPLY_CHECK_CODE_VALUES, errors, path);
    booleanField(check, 'passed', errors, path);
    if (!['number', 'string', 'boolean'].includes(typeof check.observed)) {
      add(errors, `${path}.observed`, 'expected primitive observed value');
    }
  });

  return result(errors);
}

export function validateUserOutcomeEventV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  stringField(value, 'templateHash', errors, '$', { optional: true });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors);
  enumField(value, 'event', USER_OUTCOME_EVENT_VALUES, errors);
  stringField(value, 'postApplyAttemptId', errors, '$', { optional: true });
  stringField(value, 'timestampBucket', errors);

  return result(errors);
}

export function validateOutcomeLedgerEventV1(value) {
  const errors = baseValidate(value);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'attemptId',
    'profileHash',
    'templateHash',
    'pageType',
    'learningEffectKey',
    'actionId',
    'modeId',
    'siteKeyHash',
    'event',
    'reasons',
    'learningEligible',
    'timestampBucket',
    'timestampMs',
    'eligibleAtMs',
    'consumedAtMs',
    'rejectionReason',
  ], errors, '$', 'outcome ledger event');
  stringField(value, 'attemptId', errors, '$', { optional: true });
  safeProfileHashField(value, 'profileHash', errors, '$', { optional: true });
  templateMemoryHashField(value, 'templateHash', errors, '$', { optional: true });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors, '$', { optional: true });
  if (value.learningEffectKey != null) {
    const keyValidation = validateLearningEffectKeyV1(value.learningEffectKey);
    keyValidation.errors.forEach((error) => {
      add(errors, `$.learningEffectKey${error.path.slice(1)}`, error.message);
    });
  }
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  stringField(value, 'modeId', errors, '$', { optional: true });
  stringField(value, 'siteKeyHash', errors, '$', { optional: true });
  enumField(value, 'event', OUTCOME_LEDGER_EVENT_VALUES, errors);
  validateReasonArray(value, 'reasons', errors);
  booleanField(value, 'learningEligible', errors);
  stringField(value, 'timestampBucket', errors);
  numberField(value, 'timestampMs', errors, '$', { optional: true, min: 0 });
  numberField(value, 'eligibleAtMs', errors, '$', { optional: true, min: 0 });
  numberField(value, 'consumedAtMs', errors, '$', { optional: true, min: 0 });
  stringField(value, 'rejectionReason', errors, '$', { optional: true });
  if (value.learningEligible === true && value.learningEffectKey?.actionId === 'PAGE_CLARITY') {
    add(errors, '$.learningEffectKey.actionId', 'PAGE_CLARITY cannot create positive learning');
  }

  return result(errors);
}

export function validateShadowDecisionV1(value) {
  const errors = baseValidate(value);
  rejectShadowForbiddenKeys(value, errors);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'shadowRunId',
    'policyId',
    'policyVersion',
    'profileHash',
    'templateHash',
    'pageType',
    'actionId',
    'actionContextSource',
    'predictedDecision',
    'predictedRisk',
    'reasonCodes',
    'notAppliedBecause',
  ], errors, '$', 'shadow decision');

  shadowHashField(value, 'shadowRunId', errors);
  enumField(value, 'policyId', SHADOW_POLICY_ID_VALUES, errors);
  stringField(value, 'policyVersion', errors, '$', { max: DTO_CAPS.maxShadowIdLength });
  stringField(value, 'profileHash', errors);
  shadowHashField(value, 'profileHash', errors);
  shadowHashField(value, 'templateHash', errors, '$', { optional: true });
  enumField(value, 'pageType', PAGE_TYPE_VALUES, errors, '$', { optional: true });
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'actionContextSource', ACTION_CONTEXT_SOURCE_VALUES, errors);
  enumField(value, 'predictedDecision', ACTION_POLICY_DECISION_VALUES, errors);
  validateRisk(value.predictedRisk, errors, '$.predictedRisk');
  const reasons = boundedArray(value, 'reasonCodes', DTO_CAPS.maxReasons, errors);
  reasons.forEach((reason, index) => {
    if (!isEnumValue(REASON_CODE_VALUES, reason)) {
      add(errors, `$.reasonCodes[${index}]`, 'expected known reason code');
    }
  });
  enumField(value, 'notAppliedBecause', SHADOW_NOT_APPLIED_REASON_VALUES, errors);

  return result(errors);
}

export function validateShadowPolicySummaryV1(value) {
  const errors = baseValidate(value);
  rejectShadowForbiddenKeys(value, errors);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'activePolicyId',
    'activePolicyVersion',
    'modeId',
    'actionId',
    'decisionKind',
    'score',
    'reasons',
    'thresholds',
  ], errors, '$', 'shadow active policy summary');

  stringField(value, 'activePolicyId', errors, '$', { max: DTO_CAPS.maxShadowIdLength });
  stringField(value, 'activePolicyVersion', errors, '$', { max: DTO_CAPS.maxShadowIdLength });
  stringField(value, 'modeId', errors, '$', { optional: true, max: DTO_CAPS.maxUserFacingKeyLength });
  enumField(value, 'actionId', ADAPTATION_ACTION_ID_VALUES, errors);
  enumField(value, 'decisionKind', ACTIVE_POLICY_DECISION_KIND_VALUES, errors);
  numberField(value, 'score', errors, '$', { min: 0, max: 1 });
  validateBoundedStringArray(value, 'reasons', errors, '$', { optional: true });

  if (value.thresholds != null) {
    if (!isPlainObject(value.thresholds)) {
      add(errors, '$.thresholds', 'expected thresholds object');
    } else {
      rejectUnexpectedKeys(value.thresholds, ['enter', 'exit', 'apply'], errors, '$.thresholds', 'thresholds');
      ['enter', 'exit', 'apply'].forEach((key) => {
        numberField(value.thresholds, key, errors, '$.thresholds', { optional: true, min: 0, max: 1 });
      });
    }
  }

  return result(errors);
}

export function validateShadowReplayComparisonV1(value) {
  const errors = baseValidate(value);
  rejectShadowForbiddenKeys(value, errors);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'comparisonKind',
    'activeWouldApply',
    'shadowWouldApply',
    'diverged',
    'reasons',
  ], errors, '$', 'shadow replay comparison');

  enumField(value, 'comparisonKind', SHADOW_COMPARISON_KIND_VALUES, errors);
  booleanField(value, 'activeWouldApply', errors);
  booleanField(value, 'shadowWouldApply', errors);
  booleanField(value, 'diverged', errors);
  validateBoundedStringArray(value, 'reasons', errors);

  return result(errors);
}

export function validateShadowReplayEventV1(value) {
  const errors = baseValidate(value);
  rejectShadowForbiddenKeys(value, errors);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, [
    'schemaVersion',
    'shadowRunId',
    'timestampBucket',
    'active',
    'shadow',
    'comparison',
  ], errors, '$', 'shadow replay event');

  shadowHashField(value, 'shadowRunId', errors);
  stringField(value, 'timestampBucket', errors);
  if (!validateShadowPolicySummaryV1(value.active).ok) {
    validateShadowPolicySummaryV1(value.active).errors.forEach((error) => {
      add(errors, `$.active${error.path.slice(1)}`, error.message);
    });
  }
  if (!validateShadowDecisionV1(value.shadow).ok) {
    validateShadowDecisionV1(value.shadow).errors.forEach((error) => {
      add(errors, `$.shadow${error.path.slice(1)}`, error.message);
    });
  }
  if (!validateShadowReplayComparisonV1(value.comparison).ok) {
    validateShadowReplayComparisonV1(value.comparison).errors.forEach((error) => {
      add(errors, `$.comparison${error.path.slice(1)}`, error.message);
    });
  }

  return result(errors);
}

export function validateShadowReplayStoreV1(value) {
  const errors = baseValidate(value);
  rejectShadowForbiddenKeys(value, errors);
  if (!schema(value, errors)) return result(errors);

  rejectUnexpectedKeys(value, ['schemaVersion', 'entries'], errors, '$', 'shadow replay store');
  boundedArray(value, 'entries', DTO_CAPS.maxShadowEntries, errors).forEach((entry, index) => {
    const validation = validateShadowReplayEventV1(entry);
    validation.errors.forEach((error) => {
      add(errors, `$.entries[${index}]${error.path.slice(1)}`, error.message);
    });
  });

  return result(errors);
}

export function assertValidDto(value, validator, label = 'DTO') {
  const validation = validator(value);
  if (!validation.ok) {
    const detail = validation.errors.map((error) => `${error.path}: ${error.message}`).join('; ');
    throw new TypeError(`${label} validation failed: ${detail}`);
  }
  return value;
}
