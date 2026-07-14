// shared/engine-core/action-targets.js

import {
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
} from './enums.js';
import {
  effectClassForActionTarget,
  targetKindForPageType,
} from './runtime-capability-matrix.js';
import { buildRegionInventoryV1, findFirstRegionByTargetKind } from './region-inventory.js';
import {
  assertValidDto,
  validateActionTargetsV1,
} from './validators.js';

export const ACTION_TARGETS_VERSION = 1;

const KNOWN_ACTION_IDS = Object.freeze(Object.values(ADAPTATION_ACTION_IDS));

function decisionHintForAction(actionId, pageType, region) {
  if (actionId === ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY && ![PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType)) {
    return 'UNSUPPORTED_PAGE_ABSTAIN';
  }
  if (actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    return 'ACTIVE_MANUAL';
  }
  if (pageType === PAGE_TYPES.UNKNOWN) return 'SAFE_ABSTAIN';
  if (actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE) {
    if ([PAGE_TYPES.DASHBOARD, PAGE_TYPES.VIDEO, PAGE_TYPES.WEB_APP].includes(pageType)) {
      return 'INTENTIONAL_DENY_SHADOW';
    }
    if ([PAGE_TYPES.SEARCH, PAGE_TYPES.FORM].includes(pageType)) {
      return region ? 'ACTIVE_MANUAL' : 'TARGET_MISSING_ABSTAIN';
    }
    if ([PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) {
      return 'SHADOW_ONLY';
    }
    return 'UNSUPPORTED_PAGE_ABSTAIN';
  }
  if (!region) return 'TARGET_MISSING_ABSTAIN';
  if (actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY) {
    if ([PAGE_TYPES.DASHBOARD, PAGE_TYPES.VIDEO, PAGE_TYPES.WEB_APP].includes(pageType)) {
      return 'INTENTIONAL_DENY_SHADOW';
    }
    if ([PAGE_TYPES.SEARCH, PAGE_TYPES.FORM].includes(pageType)) {
      return 'ACTIVE_MANUAL';
    }
    return 'SHADOW_ONLY';
  }
  return 'CANDIDATE_TARGET';
}

function targetKindForAction(actionId, pageType) {
  if (pageType === PAGE_TYPES.UNKNOWN) return TARGET_KINDS.BASELINE_OR_ABSTAIN;
  if (actionId === ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY) {
    return [PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType)
      ? TARGET_KINDS.READING_REGION
      : TARGET_KINDS.BASELINE_OR_ABSTAIN;
  }
  if (actionId === ADAPTATION_ACTION_IDS.REDUCE_MOTION) {
    if (pageType === PAGE_TYPES.VIDEO) return TARGET_KINDS.MEDIA_REGION;
    if (pageType === PAGE_TYPES.DASHBOARD) return TARGET_KINDS.DASHBOARD_REGION;
    if (pageType === PAGE_TYPES.WEB_APP) return TARGET_KINDS.APP_REGION;
    if (pageType === PAGE_TYPES.FEED) return TARGET_KINDS.RECORD_REGION;
    return TARGET_KINDS.BASELINE_OR_ABSTAIN;
  }
  if (actionId === ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    if ([PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType)) return TARGET_KINDS.READING_REGION;
    if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) return TARGET_KINDS.RECORD_REGION;
    if (pageType === PAGE_TYPES.FORM) return TARGET_KINDS.FORM_REGION;
    if (pageType === PAGE_TYPES.DASHBOARD) return TARGET_KINDS.DASHBOARD_REGION;
    if (pageType === PAGE_TYPES.VIDEO) return TARGET_KINDS.MEDIA_REGION;
    if (pageType === PAGE_TYPES.WEB_APP) return TARGET_KINDS.APP_REGION;
    return TARGET_KINDS.BASELINE_OR_ABSTAIN;
  }
  if (actionId === ADAPTATION_ACTION_IDS.TARGET_SIZE) {
    if (pageType === PAGE_TYPES.FORM) return TARGET_KINDS.FORM_REGION;
    if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) return TARGET_KINDS.RECORD_REGION;
    return TARGET_KINDS.BASELINE_OR_ABSTAIN;
  }
  return targetKindForPageType(pageType);
}

function repeatedRecordGroupForRegion(region, repeatedRecordGroups) {
  if (!region) return null;
  return (repeatedRecordGroups?.groups || []).find((group) => (
    Array.isArray(group?.sourceBlockIds) && group.sourceBlockIds.includes(region.sourceBlockId)
  )) || null;
}

function targetReasons(profile, region, decisionHint, repeatedRecordGroups) {
  const repeated = repeatedRecordGroupForRegion(region, repeatedRecordGroups);
  if (region?.reasons?.length || repeated?.reasons?.length) {
    return Array.from(new Set([
      ...(region?.reasons || []),
      ...(repeated?.reasons || []),
    ])).slice(0, 4);
  }
  if (Array.isArray(profile.reasons) && profile.reasons.length) return profile.reasons.slice(0, 4);
  if (decisionHint === 'SAFE_ABSTAIN') return [REASON_CODES.UNKNOWN_LOW_CONFIDENCE];
  return [REASON_CODES.TOP_CANDIDATES_AMBIGUOUS];
}

function targetConfidence(region, repeatedRecordGroups) {
  const repeated = repeatedRecordGroupForRegion(region, repeatedRecordGroups);
  if (!region) return 0;
  if (!repeated) return region.confidence || 0;
  return Math.min(1, Number(Math.max(region.confidence || 0, repeated.confidence || 0).toFixed(3)));
}

function buildActionTarget(profile, inventory, actionId, options = {}) {
  const pageType = profile.pageType || PAGE_TYPES.UNKNOWN;
  const targetKind = targetKindForAction(actionId, pageType);
  const region = targetKind === TARGET_KINDS.BASELINE_OR_ABSTAIN
    ? null
    : findFirstRegionByTargetKind(inventory, targetKind);
  const decisionHint = decisionHintForAction(actionId, pageType, region);

  return {
    actionId,
    targetKind,
    regionId: region?.regionId || 'none',
    sourceBlockId: region?.sourceBlockId || 'none',
    effectClass: region
      ? effectClassForActionTarget(actionId, pageType)
      : effectClassForActionTarget(actionId, PAGE_TYPES.UNKNOWN),
    confidence: targetConfidence(region, options.repeatedRecordGroups),
    decisionHint,
    reasons: targetReasons(profile, region, decisionHint, options.repeatedRecordGroups),
  };
}

export function buildActionTargetsV1(profile = {}, inventory = buildRegionInventoryV1(profile), options = {}) {
  const output = {
    version: ACTION_TARGETS_VERSION,
    frameId: profile.frameId || 0,
    actionTargets: KNOWN_ACTION_IDS.map((actionId) => buildActionTarget(profile, inventory, actionId, options)),
  };

  return assertValidDto(output, validateActionTargetsV1, 'ActionTargetsV1');
}

export function findActionTargetV1(actionTargets = {}, actionId) {
  return (actionTargets.actionTargets || []).find((target) => target.actionId === actionId) || null;
}
