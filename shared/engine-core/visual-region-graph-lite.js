import { DTO_CAPS } from './contracts.js';
import {
  BLOCK_ROLES,
  PAGE_TYPES,
  REASON_CODES,
  TARGET_KINDS,
} from './enums.js';
import { buildRegionInventoryV1 } from './region-inventory.js';
import {
  assertValidDto,
  validateVisualRegionGraphLiteV1,
} from './validators.js';

export const VISUAL_REGION_GRAPH_LITE_VERSION = 1;

const EDGE_TYPES = Object.freeze({
  CONTAINS_ISH: 'CONTAINS_ISH',
  VERTICAL_NEXT: 'VERTICAL_NEXT',
  SAME_ROW: 'SAME_ROW',
  SAME_COLUMN: 'SAME_COLUMN',
});

const GROUP_TYPES = Object.freeze({
  ROW: 'ROW',
  COLUMN: 'COLUMN',
  VERTICAL_STACK: 'VERTICAL_STACK',
  REPEATED_RECORDS: 'REPEATED_RECORDS',
  CONTENT_CLUSTER: 'CONTENT_CLUSTER',
});

function clamp(value, min, max) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, number));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function bucket01(value) {
  return clamp(Math.round(clamp01(value) * 10), 0, 10);
}

function metric(candidate, key) {
  return clamp01(candidate?.metrics?.[key]);
}

function observedSignals(signalsOrOptions = {}) {
  const observed = signalsOrOptions?.observedNodeSignalsV2 || signalsOrOptions;
  return Array.isArray(observed?.blockSignals) ? observed.blockSignals : [];
}

function observedByBlockId(signalsOrOptions) {
  const map = new Map();
  observedSignals(signalsOrOptions).forEach((block) => {
    if (typeof block?.blockId === 'string') {
      map.set(block.blockId, block);
    }
  });
  return map;
}

function regionByBlockId(inventory = {}) {
  const map = new Map();
  (inventory.regions || []).forEach((region) => {
    if (typeof region?.sourceBlockId === 'string') {
      map.set(region.sourceBlockId, region);
    }
  });
  return map;
}

function rectBuckets(candidate, observed) {
  if (observed?.rectBuckets) {
    return {
      x: clamp(Math.round(observed.rectBuckets.x), 0, 10),
      y: clamp(Math.round(observed.rectBuckets.y), 0, 10),
      w: clamp(Math.round(observed.rectBuckets.w), 0, 10),
      h: clamp(Math.round(observed.rectBuckets.h), 0, 10),
    };
  }
  return {
    x: bucket01(candidate?.rectRatio?.xRatio),
    y: bucket01(candidate?.rectRatio?.yRatio),
    w: bucket01(candidate?.rectRatio?.widthRatio),
    h: bucket01(candidate?.rectRatio?.heightRatio),
  };
}

function center(bucket) {
  return {
    x: clamp(bucket.x + bucket.w / 2, 0, 10),
    y: clamp(bucket.y + bucket.h / 2, 0, 10),
  };
}

function horizontalOverlap(left, right) {
  const start = Math.max(left.x, right.x);
  const end = Math.min(left.x + left.w, right.x + right.w);
  return clamp((end - start) / Math.max(1, Math.min(left.w, right.w)), 0, 1);
}

function containsIsh(outer, inner) {
  return outer.x <= inner.x + 1
    && outer.y <= inner.y + 1
    && outer.x + outer.w >= inner.x + inner.w - 1
    && outer.y + outer.h >= inner.y + inner.h - 1
    && (outer.w * outer.h) > (inner.w * inner.h);
}

function sameRow(left, right) {
  return Math.abs(center(left).y - center(right).y) <= 1;
}

function sameColumn(left, right) {
  return Math.abs(center(left).x - center(right).x) <= 1;
}

function verticalNext(left, right) {
  const top = left.y <= right.y ? left : right;
  const bottom = top === left ? right : left;
  const gap = bottom.y - (top.y + top.h);
  return gap >= -1 && gap <= 2 && horizontalOverlap(top, bottom) >= 0.25;
}

function roleTargetKind(roleHint, pageType, region) {
  if (region?.targetKind) return region.targetKind;
  if (pageType === PAGE_TYPES.UNKNOWN) return TARGET_KINDS.BASELINE_OR_ABSTAIN;
  if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) return TARGET_KINDS.RECORD_REGION;
  if (pageType === PAGE_TYPES.FORM) return TARGET_KINDS.FORM_REGION;
  if (pageType === PAGE_TYPES.DASHBOARD) return TARGET_KINDS.DASHBOARD_REGION;
  if (pageType === PAGE_TYPES.VIDEO) return TARGET_KINDS.MEDIA_REGION;
  if ([PAGE_TYPES.ARTICLE, PAGE_TYPES.DOC].includes(pageType)) return TARGET_KINDS.READING_REGION;
  if (roleHint === BLOCK_ROLES.FORM) return TARGET_KINDS.FORM_REGION;
  if (roleHint === BLOCK_ROLES.CARD) return TARGET_KINDS.RECORD_REGION;
  return TARGET_KINDS.BASELINE_OR_ABSTAIN;
}

function nodeHints(observed) {
  return {
    heading: observed?.headingHint === true,
    list: observed?.listHint === true,
    card: observed?.cardHint === true,
    repeatedSiblingShape: observed?.repeatedSiblingShapeHint === true,
    sameRow: observed?.sameRowHint === true,
    sameColumn: observed?.sameColumnHint === true,
    verticalAdjacency: observed?.verticalAdjacencyHint === true,
    mediaControlSeparation: observed?.mediaControlSeparationHint === true,
  };
}

function nodeBuckets(candidate, observed, rect) {
  return {
    visibleArea: observed ? clamp(Math.round(observed.visibleAreaBucket), 0, 10) : bucket01(metric(candidate, 'viewportCoverage')),
    viewportIntersection: observed ? clamp(Math.round(observed.viewportIntersectionBucket), 0, 10) : bucket01(candidate?.rectRatio?.visibleRatio),
    centrality: observed ? clamp(Math.round(observed.centralityBucket), 0, 10) : bucket01(1 - Math.min(1, Math.abs(center(rect).x / 10 - 0.5) + Math.abs(center(rect).y / 10 - 0.5))),
    linkDensity: observed ? clamp(Math.round(observed.linkDensityBucket), 0, 10) : bucket01(metric(candidate, 'linkDensity')),
    formControlDensity: observed ? clamp(Math.round(observed.formControlDensityBucket), 0, 10) : bucket01(metric(candidate, 'formDensity')),
    siblingCount: observed ? clamp(Math.round(observed.siblingCountBucket), 0, 10) : 0,
  };
}

function nodeFlags({ candidate, buckets, hints, pageType }) {
  const repeatedRecordLike = hints.card || hints.repeatedSiblingShape || candidate.roleHint === BLOCK_ROLES.CARD;
  const boilerplateLike = (
    candidate.roleHint === BLOCK_ROLES.NAV
    || candidate.roleHint === BLOCK_ROLES.AD
    || (buckets.linkDensity >= 8 && buckets.centrality <= 4)
    || (buckets.visibleArea <= 1 && buckets.centrality <= 3)
  );
  const riskyInteractive = (
    candidate.roleHint === BLOCK_ROLES.TABLE
    || pageType === PAGE_TYPES.DASHBOARD
    || metric(candidate, 'interactiveDensity') >= 0.45
  );
  const gceCandidate = buckets.centrality >= 5 && buckets.visibleArea >= 2 && buckets.viewportIntersection >= 5 && !boilerplateLike;

  return {
    primaryCandidate: candidate.score >= 0.5 || candidate.confidence >= 0.45,
    repeatedRecordLike,
    boilerplateLike,
    gceCandidate,
    riskyInteractive,
  };
}

function scoreNode({ candidate, buckets, flags, pageType }) {
  const visualScore = (buckets.centrality + buckets.visibleArea + buckets.viewportIntersection) / 30;
  const roleBonus = (
    [PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)
    && candidate.roleHint === BLOCK_ROLES.CARD
  ) ? 0.16 : 0;
  const formBonus = pageType === PAGE_TYPES.FORM && candidate.roleHint === BLOCK_ROLES.FORM ? 0.18 : 0;
  const penalty = (flags.boilerplateLike ? 0.18 : 0) + (flags.riskyInteractive ? 0.08 : 0);
  return clamp01(candidate.confidence * 0.55 + visualScore * 0.3 + roleBonus + formBonus - penalty);
}

function buildNodes(profile, inventory, signalsOrOptions) {
  const observed = observedByBlockId(signalsOrOptions);
  const regions = regionByBlockId(inventory);
  const candidates = Array.isArray(profile?.candidates) ? profile.candidates.slice(0, DTO_CAPS.maxVisualGraphNodes) : [];
  return candidates.map((candidate, index) => {
    const blockId = String(candidate.blockId || `b${index + 1}`);
    const observedBlock = observed.get(blockId);
    const region = regions.get(blockId);
    const rect = rectBuckets(candidate, observedBlock);
    const buckets = nodeBuckets(candidate, observedBlock, rect);
    const hints = nodeHints(observedBlock);
    const flags = nodeFlags({ candidate, buckets, hints, pageType: profile.pageType || PAGE_TYPES.UNKNOWN });
    const node = {
      nodeId: `n${index + 1}`,
      sourceBlockId: blockId,
      regionId: region?.regionId || 'none',
      roleHint: candidate.roleHint || BLOCK_ROLES.UNKNOWN,
      targetKind: roleTargetKind(candidate.roleHint, profile.pageType || PAGE_TYPES.UNKNOWN, region),
      confidence: clamp01(candidate.confidence),
      rectBuckets: rect,
      buckets,
      hints,
      flags,
      score: 0,
    };
    node.score = Number(scoreNode({ candidate, buckets, flags, pageType: profile.pageType || PAGE_TYPES.UNKNOWN }).toFixed(3));
    return node;
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

function edgeReasons(type) {
  if (type === EDGE_TYPES.SAME_ROW || type === EDGE_TYPES.SAME_COLUMN) return [REASON_CODES.FEED_CARD_REPETITION_DETECTED];
  if (type === EDGE_TYPES.VERTICAL_NEXT) return [REASON_CODES.DOC_STRUCTURE_DETECTED];
  return [REASON_CODES.TOP_CANDIDATES_AMBIGUOUS];
}

function addEdge(edges, degree, from, to, type, weight) {
  if (edges.length >= DTO_CAPS.maxVisualGraphEdges) return;
  if ((degree.get(from) || 0) >= 6 || (degree.get(to) || 0) >= 6) return;
  const duplicate = edges.some((edge) => edge.from === from && edge.to === to && edge.type === type);
  if (duplicate) return;
  edges.push({
    from,
    to,
    type,
    weight: Number(clamp01(weight).toFixed(3)),
    reasons: edgeReasons(type),
  });
  degree.set(from, (degree.get(from) || 0) + 1);
  degree.set(to, (degree.get(to) || 0) + 1);
}

function buildEdges(nodes) {
  const edges = [];
  const degree = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i];
      const right = nodes[j];
      if (containsIsh(left.rectBuckets, right.rectBuckets)) {
        addEdge(edges, degree, left.nodeId, right.nodeId, EDGE_TYPES.CONTAINS_ISH, 0.75);
      } else if (containsIsh(right.rectBuckets, left.rectBuckets)) {
        addEdge(edges, degree, right.nodeId, left.nodeId, EDGE_TYPES.CONTAINS_ISH, 0.75);
      }
      if (verticalNext(left.rectBuckets, right.rectBuckets)) {
        addEdge(edges, degree, left.rectBuckets.y <= right.rectBuckets.y ? left.nodeId : right.nodeId, left.rectBuckets.y <= right.rectBuckets.y ? right.nodeId : left.nodeId, EDGE_TYPES.VERTICAL_NEXT, 0.72);
      }
      if (sameRow(left.rectBuckets, right.rectBuckets)) {
        addEdge(edges, degree, left.nodeId, right.nodeId, EDGE_TYPES.SAME_ROW, 0.68);
      }
      if (sameColumn(left.rectBuckets, right.rectBuckets)) {
        addEdge(edges, degree, left.nodeId, right.nodeId, EDGE_TYPES.SAME_COLUMN, 0.64);
      }
    }
  }
  return edges;
}

function membersForType(edges, type) {
  const ids = new Set();
  edges.filter((edge) => edge.type === type).forEach((edge) => {
    ids.add(edge.from);
    ids.add(edge.to);
  });
  return Array.from(ids).sort();
}

function groupFromMembers({ id, type, members, nodes, targetKind, reasons }) {
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const memberNodes = members.map((member) => nodeMap.get(member)).filter(Boolean);
  const primary = memberNodes.slice().sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))[0] || null;
  const avgScore = memberNodes.length
    ? memberNodes.reduce((sum, node) => sum + node.score, 0) / memberNodes.length
    : 0;
  return {
    groupId: `g${id}`,
    type,
    memberNodeIds: members.slice(0, DTO_CAPS.maxVisualGraphNodes),
    primaryNodeId: primary?.nodeId || 'none',
    targetKind: targetKind || primary?.targetKind || TARGET_KINDS.BASELINE_OR_ABSTAIN,
    confidence: Number(clamp01(avgScore).toFixed(3)),
    score: Number(clamp01(avgScore).toFixed(3)),
    reasons: reasons.slice(0, 4),
  };
}

function repeatedMembers(nodes) {
  const members = nodes
    .filter((node) => node.flags.repeatedRecordLike && !node.flags.boilerplateLike)
    .map((node) => node.nodeId);
  return members.length >= 1 ? members : [];
}

function buildGroups(nodes, edges, pageType) {
  const groups = [];
  const add = (type, members, targetKind, reasons) => {
    const unique = Array.from(new Set(members)).sort();
    if (groups.length >= DTO_CAPS.maxVisualGraphGroups || unique.length === 0) return;
    groups.push(groupFromMembers({
      id: groups.length + 1,
      type,
      members: unique,
      nodes,
      targetKind,
      reasons,
    }));
  };

  add(GROUP_TYPES.ROW, membersForType(edges, EDGE_TYPES.SAME_ROW), null, [REASON_CODES.FEED_CARD_REPETITION_DETECTED]);
  add(GROUP_TYPES.COLUMN, membersForType(edges, EDGE_TYPES.SAME_COLUMN), null, [REASON_CODES.DOC_STRUCTURE_DETECTED]);
  add(GROUP_TYPES.VERTICAL_STACK, membersForType(edges, EDGE_TYPES.VERTICAL_NEXT), null, [REASON_CODES.DOC_STRUCTURE_DETECTED]);
  if ([PAGE_TYPES.SEARCH, PAGE_TYPES.SHOP, PAGE_TYPES.FEED].includes(pageType)) {
    add(GROUP_TYPES.REPEATED_RECORDS, repeatedMembers(nodes), TARGET_KINDS.RECORD_REGION, [
      pageType === PAGE_TYPES.SHOP ? REASON_CODES.SHOP_PRODUCT_GRID_DETECTED : REASON_CODES.FEED_CARD_REPETITION_DETECTED,
    ]);
  }
  add(
    GROUP_TYPES.CONTENT_CLUSTER,
    nodes.filter((node) => node.flags.gceCandidate && !node.flags.boilerplateLike).map((node) => node.nodeId),
    null,
    [REASON_CODES.TOP_CANDIDATES_AMBIGUOUS],
  );

  return groups;
}

export function buildVisualRegionGraphLiteV1(profile = {}, {
  signals = null,
  observedNodeSignalsV2 = null,
  inventory = null,
} = {}) {
  const resolvedInventory = inventory || buildRegionInventoryV1(profile);
  const observedSource = observedNodeSignalsV2 || signals?.observedNodeSignalsV2 || null;
  const nodes = buildNodes(profile, resolvedInventory, observedSource);
  const edges = buildEdges(nodes);
  const groups = buildGroups(nodes, edges, profile.pageType || PAGE_TYPES.UNKNOWN);
  const budgetHit = profile.stats?.budgetHit === true
    || signals?.stats?.budgetHit === true
    || observedSource?.coverage?.budgetHit === true
    || nodes.length >= DTO_CAPS.maxVisualGraphNodes
    || edges.length >= DTO_CAPS.maxVisualGraphEdges
    || groups.length >= DTO_CAPS.maxVisualGraphGroups;

  const graph = {
    version: VISUAL_REGION_GRAPH_LITE_VERSION,
    frameId: profile.frameId || 0,
    pageType: profile.pageType || PAGE_TYPES.UNKNOWN,
    nodes,
    edges,
    groups,
    stats: {
      nodesSeen: nodes.length,
      edgesSeen: edges.length,
      groupsSeen: groups.length,
      budgetHit,
      partial: budgetHit,
    },
  };

  return assertValidDto(graph, validateVisualRegionGraphLiteV1, 'VisualRegionGraphLiteV1');
}
