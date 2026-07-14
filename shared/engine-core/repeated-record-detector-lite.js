import { DTO_CAPS } from './contracts.js';
import {
  BLOCK_ROLES,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
} from './enums.js';
import { buildVisualRegionGraphLiteV1 } from './visual-region-graph-lite.js';
import {
  assertValidDto,
  validateRepeatedRecordGroupsV1,
} from './validators.js';

export const REPEATED_RECORD_GROUPS_VERSION = 1;

function clamp(value, min, max) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, number));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function pageSupportsRepeatedRecords(pageType) {
  return [PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType);
}

function reasonForPageType(pageType) {
  if (pageType === PAGE_TYPES.SEARCH) return REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED;
  if (pageType === PAGE_TYPES.SHOP) return REASON_CODES.SHOP_PRODUCT_GRID_DETECTED;
  return REASON_CODES.FEED_CARD_REPETITION_DETECTED;
}

function memberCountBucket(nodes) {
  const hintedMax = nodes.reduce((max, node) => Math.max(max, node.buckets?.siblingCount || 0), 0);
  const count = Math.max(nodes.length, hintedMax || 0);
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 3;
  if (count <= 7) return 6;
  return 10;
}

function average(nodes, read) {
  if (!nodes.length) return 0;
  return nodes.reduce((sum, node) => sum + read(node), 0) / nodes.length;
}

function candidateRepeatedNodes(graph) {
  return (graph.nodes || []).filter((node) => (
    node.targetKind === TARGET_KINDS.RECORD_REGION
    && node.flags?.boilerplateLike !== true
    && (
      node.flags?.repeatedRecordLike === true
      || node.hints?.card === true
      || node.hints?.repeatedSiblingShape === true
      || node.roleHint === BLOCK_ROLES.CARD
    )
  ));
}

function repeatedRecordConfidence(nodes, pageType) {
  const base = average(nodes, (node) => node.score || node.confidence || 0);
  const repeatedHint = nodes.some((node) => node.hints?.repeatedSiblingShape === true) ? 0.18 : 0;
  const cardHint = nodes.some((node) => node.hints?.card === true || node.roleHint === BLOCK_ROLES.CARD) ? 0.12 : 0;
  const pageBonus = pageSupportsRepeatedRecords(pageType) ? 0.12 : 0;
  return Number(clamp01(base + repeatedHint + cardHint + pageBonus).toFixed(3));
}

function buildGroup(groupId, nodes, pageType) {
  const sortedNodes = nodes.slice().sort((a, b) => b.score - a.score || a.sourceBlockId.localeCompare(b.sourceBlockId));
  const samples = sortedNodes.slice(0, DTO_CAPS.maxRepeatedRecordSamples);
  return {
    groupId: `rrg${groupId}`,
    targetKind: TARGET_KINDS.RECORD_REGION,
    sourceRegionIds: samples.map((node) => node.regionId || 'none').filter((id) => id !== 'none'),
    sourceBlockIds: samples.map((node) => node.sourceBlockId),
    confidence: repeatedRecordConfidence(sortedNodes, pageType),
    reasons: [reasonForPageType(pageType), REASON_CODES.FEED_CARD_REPETITION_DETECTED].filter((reason, index, all) => all.indexOf(reason) === index),
    metrics: {
      memberCountBucket: memberCountBucket(sortedNodes),
      repeatedShapeScore: sortedNodes.some((node) => node.hints?.repeatedSiblingShape === true) ? 1 : 0,
      sameRowScore: Number(average(sortedNodes, (node) => node.hints?.sameRow === true ? 1 : 0).toFixed(3)),
      sameColumnScore: Number(average(sortedNodes, (node) => node.hints?.sameColumn === true ? 1 : 0).toFixed(3)),
      linkDensityBucket: Math.round(average(sortedNodes, (node) => node.buckets?.linkDensity || 0)),
      mediaSeparationScore: Number(average(sortedNodes, (node) => node.hints?.mediaControlSeparation === true ? 1 : 0).toFixed(3)),
    },
  };
}

export function buildRepeatedRecordGroupsV1(profile = {}, {
  graph = null,
  signals = null,
  observedNodeSignalsV2 = null,
  inventory = null,
} = {}) {
  const resolvedGraph = graph || buildVisualRegionGraphLiteV1(profile, {
    signals,
    observedNodeSignalsV2,
    inventory,
  });
  const pageType = profile.pageType || resolvedGraph.pageType || PAGE_TYPES.UNKNOWN;
  const repeatedNodes = pageSupportsRepeatedRecords(pageType)
    ? candidateRepeatedNodes(resolvedGraph)
    : [];
  const groups = repeatedNodes.length
    ? [buildGroup(1, repeatedNodes, pageType)].slice(0, DTO_CAPS.maxRepeatedRecordGroups)
    : [];
  const output = {
    version: REPEATED_RECORD_GROUPS_VERSION,
    frameId: profile.frameId || resolvedGraph.frameId || 0,
    groups,
    stats: {
      groupsSeen: groups.length,
      nodesSeen: repeatedNodes.length,
      budgetHit: resolvedGraph.stats?.budgetHit === true || groups.length >= DTO_CAPS.maxRepeatedRecordGroups,
    },
  };

  return assertValidDto(output, validateRepeatedRecordGroupsV1, 'RepeatedRecordGroupsV1');
}

