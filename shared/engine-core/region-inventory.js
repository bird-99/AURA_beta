// shared/engine-core/region-inventory.js

import {
  BLOCK_ROLES,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
} from './enums.js';
import {
  assertValidDto,
  validateRegionInventoryV1,
} from './validators.js';

export const REGION_INVENTORY_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function metric(candidate, key) {
  const value = candidate?.metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function candidateHasReason(candidate, reason) {
  return Array.isArray(candidate?.reasons) && candidate.reasons.includes(reason);
}

function isReadingCandidate(candidate) {
  return (
    candidate.roleHint === BLOCK_ROLES.ARTICLE
    || candidate.roleHint === BLOCK_ROLES.PRIMARY_CONTENT
    || metric(candidate, 'textDensity') >= 0.45
  ) && metric(candidate, 'linkDensity') <= 0.5;
}

function isRecordCandidate(candidate, pageType) {
  return (
    candidate.roleHint === BLOCK_ROLES.CARD
    || candidateHasReason(candidate, REASON_CODES.FEED_CARD_REPETITION_DETECTED)
    || [PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)
  );
}

function isFormCandidate(candidate) {
  return (
    candidate.roleHint === BLOCK_ROLES.FORM
    || metric(candidate, 'formDensity') >= 0.15
    || candidateHasReason(candidate, REASON_CODES.FORM_CONTROLS_PRESENT)
  );
}

function isDashboardCandidate(candidate) {
  return (
    candidate.roleHint === BLOCK_ROLES.TABLE
    || metric(candidate, 'tableDensity') >= 0.15
    || candidateHasReason(candidate, REASON_CODES.DASHBOARD_TABLE_DENSITY_HIGH)
  );
}

function isMediaCandidate(candidate, pageType) {
  return (
    candidate.roleHint === BLOCK_ROLES.PLAYER
    || metric(candidate, 'mediaDensity') >= 0.25
    || candidateHasReason(candidate, REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH)
    || pageType === PAGE_TYPES.VIDEO
  );
}

function targetKindForCandidate(candidate, pageType) {
  if (pageType === PAGE_TYPES.UNKNOWN) return null;
  if ([PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType) && isReadingCandidate(candidate)) {
    return TARGET_KINDS.READING_REGION;
  }
  if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType) && isRecordCandidate(candidate, pageType)) {
    return TARGET_KINDS.RECORD_REGION;
  }
  if (pageType === PAGE_TYPES.FORM && isFormCandidate(candidate)) {
    return TARGET_KINDS.FORM_REGION;
  }
  if (pageType === PAGE_TYPES.DASHBOARD && isDashboardCandidate(candidate)) {
    return TARGET_KINDS.DASHBOARD_REGION;
  }
  if (pageType === PAGE_TYPES.VIDEO && isMediaCandidate(candidate, pageType)) {
    return TARGET_KINDS.MEDIA_REGION;
  }
  if (pageType === PAGE_TYPES.WEB_APP) {
    return TARGET_KINDS.APP_REGION;
  }
  return null;
}

function compactMetrics(candidate) {
  return {
    textDensity: metric(candidate, 'textDensity'),
    linkDensity: metric(candidate, 'linkDensity'),
    interactiveDensity: metric(candidate, 'interactiveDensity'),
    mediaDensity: metric(candidate, 'mediaDensity'),
    formDensity: metric(candidate, 'formDensity'),
    tableDensity: metric(candidate, 'tableDensity'),
    viewportCoverage: metric(candidate, 'viewportCoverage'),
  };
}

function compactRisk(profile) {
  return {
    layoutRisk: profile.risk?.layoutRisk || 0,
    interactionRisk: profile.risk?.interactionRisk || 0,
    confidenceRisk: profile.risk?.confidenceRisk || 0,
    privacyRisk: profile.risk?.privacyRisk || 0,
  };
}

function compactReasons(candidate, profile) {
  const reasons = Array.isArray(candidate?.reasons) && candidate.reasons.length
    ? candidate.reasons
    : profile.reasons || [];
  return reasons.slice(0, 4);
}

function repeatedRecordReasonsForBlock(blockId, repeatedRecordGroups) {
  const group = (repeatedRecordGroups?.groups || []).find((entry) => (
    Array.isArray(entry?.sourceBlockIds) && entry.sourceBlockIds.includes(blockId)
  ));
  return Array.isArray(group?.reasons) ? group.reasons : [];
}

/**
 * @param {any} options
 */
function graphConfidenceBoost(candidate, targetKind, options = {}) {
  const { visualGraph, repeatedRecordGroups } = options;
  const graphNode = (visualGraph?.nodes || []).find((node) => node.sourceBlockId === candidate.blockId);
  const repeatedReasons = repeatedRecordReasonsForBlock(candidate.blockId, repeatedRecordGroups);
  let boost = 0;
  if (graphNode?.targetKind === targetKind && graphNode.score >= 0.5) boost += 0.04;
  if (targetKind === TARGET_KINDS.RECORD_REGION && repeatedReasons.length) boost += 0.08;
  if (targetKind === TARGET_KINDS.FORM_REGION && graphNode?.buckets?.formControlDensity >= 2) boost += 0.04;
  return Math.min(0.14, boost);
}

/**
 * @param {any} options
 */
function compactGraphReasons(candidate, profile, options = {}) {
  const { repeatedRecordGroups } = options;
  return Array.from(new Set([
    ...compactReasons(candidate, profile),
    ...repeatedRecordReasonsForBlock(candidate.blockId, repeatedRecordGroups),
  ])).slice(0, 4);
}

export function buildRegionInventoryV1(profile = {}, options = {}) {
  const candidates = Array.isArray(profile.candidates) ? profile.candidates : [];
  const regions = [];

  candidates.forEach((candidate) => {
    const targetKind = targetKindForCandidate(candidate, profile.pageType || PAGE_TYPES.UNKNOWN);
    if (!targetKind) return;
    const graphBoost = graphConfidenceBoost(candidate, targetKind, options);
    regions.push({
      regionId: `r${regions.length + 1}`,
      sourceBlockId: candidate.blockId,
      targetKind,
      roleHint: candidate.roleHint,
      confidence: Math.min(1, Number((candidate.confidence + graphBoost).toFixed(3))),
      reasons: compactGraphReasons(candidate, profile, options),
      risk: compactRisk(profile),
      metrics: compactMetrics(candidate),
    });
  });

  const inventory = {
    version: REGION_INVENTORY_VERSION,
    frameId: profile.frameId || 0,
    pageType: profile.pageType || PAGE_TYPES.UNKNOWN,
    regions,
    stats: {
      regionsSeen: regions.length,
      budgetHit: profile.stats?.budgetHit === true,
    },
  };

  return assertValidDto(inventory, validateRegionInventoryV1, 'RegionInventoryV1');
}

export function countRegionsByTargetKind(inventory = {}) {
  const counts = {};
  for (const region of inventory.regions || []) {
    counts[region.targetKind] = (counts[region.targetKind] || 0) + 1;
  }
  return counts;
}

export function findFirstRegionByTargetKind(inventory = {}, targetKind) {
  const region = (inventory.regions || []).find((entry) => entry.targetKind === targetKind);
  return region ? clone(region) : null;
}
