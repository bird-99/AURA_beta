// shared/engine-core/router.js

import { DTO_CAPS, ENGINE_CORE_SCHEMA_VERSION } from './contracts.js';
import {
  BLOCK_ROLES,
  PAGE_TYPES,
  PROBLEM_CODES,
  REASON_CODES,
} from './enums.js';
import {
  assertValidDto,
  validateCollectedPageSignalsV1,
  validatePageUnderstandingProfileV1,
} from './validators.js';

const RISK_LOW_MAX = 0.34;
const RISK_HIGH_MIN = 0.65;
const MIN_NON_UNKNOWN_SCORE = 0.42;

function clamp(value, min, max) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, number));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function boundedCount(value, max = 1000) {
  return clamp(value, 0, max);
}

function metric(source, key) {
  return clamp01(source?.[key]);
}

function hint(signals) {
  const raw = typeof signals?.pageHints?.urlKind === 'string' ? signals.pageHints.urlKind : 'UNKNOWN';
  if (raw.endsWith('_LIKE')) {
    return raw.slice(0, -5);
  }
  return raw;
}

function blocks(signals) {
  return Array.isArray(signals?.blocks) ? signals.blocks.slice(0, DTO_CAPS.maxBlocks) : [];
}

function hasFlag(block, reason) {
  return Array.isArray(block?.flags) && block.flags.includes(reason);
}

function anyFlag(items, reason) {
  return items.some((block) => hasFlag(block, reason));
}

function countRole(items, roles) {
  const accepted = new Set(roles);
  return items.reduce((count, block) => (accepted.has(block?.roleHint) ? count + 1 : count), 0);
}

function rolePresence(items, roles) {
  return Math.min(1, countRole(items, roles));
}

function scorePageTypes(signals) {
  const pageHint = hint(signals);
  const pageHints = signals?.pageHints || {};
  const aggregate = signals?.aggregateMetrics || {};
  const items = blocks(signals);
  const semanticArticleCount = boundedCount(pageHints.semanticArticleCount);
  const formCount = boundedCount(pageHints.formCount);
  const tableCount = boundedCount(pageHints.tableCount);
  const mediaCount = boundedCount(pageHints.mediaCount);
  const modalCount = boundedCount(pageHints.modalLikeCount);
  const textDensity = metric(aggregate, 'textDensity');
  const linkDensity = metric(aggregate, 'linkDensity');
  const interactiveDensity = metric(aggregate, 'interactiveDensity');
  const mediaDensity = metric(aggregate, 'mediaDensity');
  const formDensity = metric(aggregate, 'formDensity');
  const tableDensity = metric(aggregate, 'tableDensity');

  const articleSignal = anyFlag(items, REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH) ? 1 : 0;
  const docSignal = anyFlag(items, REASON_CODES.DOC_STRUCTURE_DETECTED) ? 1 : 0;
  const videoSignal = anyFlag(items, REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH) ? 1 : 0;
  const feedSignal = anyFlag(items, REASON_CODES.FEED_CARD_REPETITION_DETECTED) ? 1 : 0;
  const formSignal = anyFlag(items, REASON_CODES.FORM_CONTROLS_PRESENT) ? 1 : 0;
  const dashboardSignal = anyFlag(items, REASON_CODES.DASHBOARD_TABLE_DENSITY_HIGH) ? 1 : 0;
  const unknownSignal = anyFlag(items, REASON_CODES.UNKNOWN_LOW_CONFIDENCE) ? 1 : 0;
  const ambiguousSignal = anyFlag(items, REASON_CODES.TOP_CANDIDATES_AMBIGUOUS) ? 1 : 0;

  return {
    [PAGE_TYPES.ARTICLE]: clamp01(
      articleSignal * 0.45
      + Math.min(semanticArticleCount, 2) * 0.08
      + rolePresence(items, [BLOCK_ROLES.ARTICLE, BLOCK_ROLES.PRIMARY_CONTENT]) * 0.16
      + textDensity * 0.3
      + (linkDensity <= 0.3 ? 0.04 : 0)
      - mediaDensity * 0.12
      - formDensity * 0.2
      - tableDensity * 0.08
    ),
    [PAGE_TYPES.DOC]: clamp01(
      (pageHint === PAGE_TYPES.DOC ? 0.3 : 0)
      + docSignal * 0.42
      + Math.min(semanticArticleCount, 2) * 0.05
      + rolePresence(items, [BLOCK_ROLES.PRIMARY_CONTENT, BLOCK_ROLES.ARTICLE]) * 0.08
      + textDensity * 0.22
      + tableDensity * 0.12
      - formDensity * 0.18
    ),
    [PAGE_TYPES.VIDEO]: clamp01(
      (pageHint === PAGE_TYPES.VIDEO ? 0.35 : 0)
      + videoSignal * 0.35
      + rolePresence(items, [BLOCK_ROLES.PLAYER]) * 0.2
      + mediaDensity * 0.45
      + Math.min(mediaCount, 4) * 0.025
      + interactiveDensity * 0.08
    ),
    [PAGE_TYPES.FORM]: clamp01(
      formSignal * 0.42
      + Math.min(formCount, 3) * 0.12
      + rolePresence(items, [BLOCK_ROLES.FORM]) * 0.2
      + formDensity * 0.55
      + interactiveDensity * 0.18
    ),
    [PAGE_TYPES.DASHBOARD]: clamp01(
      dashboardSignal * 0.42
      + Math.min(tableCount, 4) * 0.08
      + rolePresence(items, [BLOCK_ROLES.TABLE]) * 0.18
      + tableDensity * 0.58
      + interactiveDensity * 0.18
      + formDensity * 0.08
    ),
    [PAGE_TYPES.FEED]: clamp01(
      feedSignal * 0.48
      + rolePresence(items, [BLOCK_ROLES.CARD]) * 0.2
      + mediaDensity * 0.22
      + interactiveDensity * 0.22
      + (semanticArticleCount === 0 ? 0.04 : 0)
    ),
    [PAGE_TYPES.SEARCH]: clamp01(
      (pageHint === PAGE_TYPES.SEARCH ? 0.7 : 0)
      + (linkDensity > 0.45 && interactiveDensity > 0.35 ? 0.18 : 0)
    ),
    [PAGE_TYPES.SHOP]: clamp01(
      (pageHint === PAGE_TYPES.SHOP ? 0.7 : 0)
      + (rolePresence(items, [BLOCK_ROLES.CARD]) && mediaDensity > 0.25 && interactiveDensity > 0.25 ? 0.22 : 0)
    ),
    [PAGE_TYPES.WEB_APP]: clamp01(
      (interactiveDensity > 0.48 && formDensity < 0.25 && tableDensity < 0.25 ? 0.32 : 0)
      + (modalCount > 0 ? 0.08 : 0)
    ),
    [PAGE_TYPES.UNKNOWN]: clamp01(
      unknownSignal * 0.48
      + ambiguousSignal * 0.28
      + (modalCount > 0 ? 0.1 : 0)
      + (signals?.stats?.budgetHit ? 0.08 : 0)
      + (items.length === 0 ? 0.15 : 0)
    ),
  };
}

function choosePageType(scores) {
  const entries = Object.entries(scores)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [bestType, bestScore] = entries[0] || [PAGE_TYPES.UNKNOWN, 0];
  const [, runnerUpScore] = entries[1] || [PAGE_TYPES.UNKNOWN, 0];
  const unknownScore = scores[PAGE_TYPES.UNKNOWN] || 0;
  const gap = bestScore - runnerUpScore;

  if (bestType === PAGE_TYPES.UNKNOWN || unknownScore >= bestScore || bestScore < MIN_NON_UNKNOWN_SCORE) {
    return { pageType: PAGE_TYPES.UNKNOWN, bestScore: Math.max(bestScore, unknownScore), runnerUpScore, gap };
  }

  if (gap < 0.08 && unknownScore >= 0.25) {
    return { pageType: PAGE_TYPES.UNKNOWN, bestScore: unknownScore, runnerUpScore: bestScore, gap: 0 };
  }

  return { pageType: bestType, bestScore, runnerUpScore, gap };
}

function confidenceFromChoice(choice) {
  if (choice.pageType === PAGE_TYPES.UNKNOWN) {
    return clamp01(Math.max(0.25, Math.min(0.48, choice.bestScore)));
  }
  return clamp01(0.4 + choice.bestScore * 0.45 + Math.max(0, choice.gap) * 0.25);
}

function riskProfile(signals, pageTypeConfidence) {
  const pageHints = signals?.pageHints || {};
  const aggregate = signals?.aggregateMetrics || {};
  const fixed = Math.min(4, boundedCount(pageHints.fixedOrStickyCount));
  const modal = Math.min(1, boundedCount(pageHints.modalLikeCount));
  const layoutRisk = clamp01(
    0.08
    + fixed * 0.06
    + modal * 0.35
    + metric(aggregate, 'tableDensity') * 1.0
    + metric(aggregate, 'formDensity') * 0.65
    + metric(aggregate, 'mediaDensity') * 0.65
    + metric(aggregate, 'interactiveDensity') * 0.2
    + metric(aggregate, 'viewportCoverage') * 0.08
    + (signals?.stats?.budgetHit ? 0.1 : 0)
  );
  const interactionRisk = clamp01(
    0.05
    + metric(aggregate, 'interactiveDensity') * 1.1
    + metric(aggregate, 'formDensity') * 0.5
    + metric(aggregate, 'mediaDensity') * 0.4
    + metric(aggregate, 'tableDensity') * 0.4
    + modal * 0.3
    + fixed * 0.03
  );
  const confidenceRisk = clamp01(1 - pageTypeConfidence + (signals?.stats?.budgetHit ? 0.1 : 0));

  return {
    layoutRisk,
    interactionRisk,
    confidenceRisk,
    privacyRisk: 0,
  };
}

function riskBand(value) {
  if (value <= RISK_LOW_MAX) return 'LOW';
  if (value >= RISK_HIGH_MIN) return 'HIGH';
  return 'MEDIUM';
}

function getRiskBand(value) {
  return riskBand(clamp01(value));
}

function reasonPriority(reason) {
  const order = [
    REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH,
    REASON_CODES.DOC_STRUCTURE_DETECTED,
    REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH,
    REASON_CODES.VIDEO_PAGE_TYPOGRAPHY_BLOCKED,
    REASON_CODES.FEED_CARD_REPETITION_DETECTED,
    REASON_CODES.FORM_CONTROLS_PRESENT,
    REASON_CODES.DASHBOARD_TABLE_DENSITY_HIGH,
    REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED,
    REASON_CODES.SHOP_PRODUCT_GRID_DETECTED,
    REASON_CODES.UNKNOWN_LOW_CONFIDENCE,
    REASON_CODES.TOP_CANDIDATES_AMBIGUOUS,
  ];
  const index = order.indexOf(reason);
  return index === -1 ? order.length : index;
}

function collectReasons(signals, choice) {
  const set = new Set();
  for (const block of blocks(signals)) {
    for (const reason of block?.flags || []) {
      set.add(reason);
    }
  }
  if (choice.pageType === PAGE_TYPES.UNKNOWN) {
    set.add(REASON_CODES.UNKNOWN_LOW_CONFIDENCE);
    if (choice.gap < 0.08) {
      set.add(REASON_CODES.TOP_CANDIDATES_AMBIGUOUS);
    }
  }
  if (choice.pageType === PAGE_TYPES.VIDEO) {
    set.add(REASON_CODES.VIDEO_PAGE_TYPOGRAPHY_BLOCKED);
  }
  if (choice.pageType === PAGE_TYPES.SEARCH) {
    set.add(REASON_CODES.SEARCH_RESULTS_STRUCTURE_DETECTED);
  }
  if (choice.pageType === PAGE_TYPES.SHOP) {
    set.add(REASON_CODES.SHOP_PRODUCT_GRID_DETECTED);
  }
  return Array.from(set)
    .sort((a, b) => reasonPriority(a) - reasonPriority(b) || a.localeCompare(b))
    .slice(0, DTO_CAPS.maxReasons);
}

function blockScoreForPageType(block, pageType) {
  const metrics = block?.metrics || {};
  const role = block?.roleHint || BLOCK_ROLES.UNKNOWN;
  const coverage = metric(metrics, 'viewportCoverage');
  const visible = clamp01(block?.rectRatio?.visibleRatio);
  const base = 0.1 + coverage * 0.25 + visible * 0.15;
  const roleBonus = {
    [PAGE_TYPES.ARTICLE]: [BLOCK_ROLES.ARTICLE, BLOCK_ROLES.PRIMARY_CONTENT],
    [PAGE_TYPES.DOC]: [BLOCK_ROLES.PRIMARY_CONTENT, BLOCK_ROLES.ARTICLE],
    [PAGE_TYPES.VIDEO]: [BLOCK_ROLES.PLAYER],
    [PAGE_TYPES.FEED]: [BLOCK_ROLES.CARD],
    [PAGE_TYPES.FORM]: [BLOCK_ROLES.FORM],
    [PAGE_TYPES.DASHBOARD]: [BLOCK_ROLES.TABLE],
    [PAGE_TYPES.SEARCH]: [BLOCK_ROLES.PRIMARY_CONTENT, BLOCK_ROLES.CARD],
    [PAGE_TYPES.SHOP]: [BLOCK_ROLES.CARD],
    [PAGE_TYPES.WEB_APP]: [BLOCK_ROLES.PRIMARY_CONTENT, BLOCK_ROLES.UNKNOWN],
  }[pageType] || [];
  const roleScore = roleBonus.includes(role) ? 0.35 : 0;
  const flagScore = (block?.flags || []).length > 0 ? 0.15 : 0;
  return clamp01(base + roleScore + flagScore);
}

function buildCandidates(signals, pageType) {
  return blocks(signals)
    .map((block) => ({
      blockId: String(block?.blockId || ''),
      roleHint: block?.roleHint || BLOCK_ROLES.UNKNOWN,
      score: blockScoreForPageType(block, pageType),
      confidence: clamp01(blockScoreForPageType(block, pageType) * 0.9),
      reasons: Array.isArray(block?.flags) ? block.flags.slice(0, DTO_CAPS.maxReasons) : [],
      rectRatio: {
        xRatio: clamp01(block?.rectRatio?.xRatio),
        yRatio: clamp01(block?.rectRatio?.yRatio),
        widthRatio: clamp01(block?.rectRatio?.widthRatio),
        heightRatio: clamp01(block?.rectRatio?.heightRatio),
        visibleRatio: clamp01(block?.rectRatio?.visibleRatio),
      },
      metrics: {
        textDensity: metric(block?.metrics, 'textDensity'),
        linkDensity: metric(block?.metrics, 'linkDensity'),
        interactiveDensity: metric(block?.metrics, 'interactiveDensity'),
        mediaDensity: metric(block?.metrics, 'mediaDensity'),
        formDensity: metric(block?.metrics, 'formDensity'),
        tableDensity: metric(block?.metrics, 'tableDensity'),
        viewportCoverage: metric(block?.metrics, 'viewportCoverage'),
      },
    }))
    .filter((candidate) => candidate.blockId)
    .sort((a, b) => b.score - a.score || a.blockId.localeCompare(b.blockId))
    .slice(0, DTO_CAPS.maxCandidates);
}

function selectedScopeFor(pageType, candidates, confidence) {
  if (pageType === PAGE_TYPES.UNKNOWN || confidence < 0.45 || candidates.length === 0) {
    return null;
  }
  const selected = candidates[0];
  return {
    blockId: selected.blockId,
    roleHint: selected.roleHint,
    confidence: selected.confidence,
    reasons: selected.reasons,
  };
}

function buildProblems(profileRisk, confidence, signals) {
  const problems = [];
  if (confidence < 0.5) {
    problems.push({
      code: PROBLEM_CODES.LOW_CONFIDENCE_PAGE_TYPE,
      severity: 'WARN',
      reasons: [REASON_CODES.UNKNOWN_LOW_CONFIDENCE],
    });
  }
  if (profileRisk.layoutRisk >= RISK_HIGH_MIN) {
    problems.push({ code: PROBLEM_CODES.HIGH_LAYOUT_RISK, severity: 'BLOCK', reasons: [] });
  }
  if (profileRisk.interactionRisk >= RISK_HIGH_MIN) {
    problems.push({ code: PROBLEM_CODES.HIGH_INTERACTION_RISK, severity: 'BLOCK', reasons: [] });
  }
  if (boundedCount(signals?.pageHints?.modalLikeCount) > 0) {
    problems.push({
      code: PROBLEM_CODES.MODAL_OVERLAY_PRESENT,
      severity: 'BLOCK',
      reasons: [REASON_CODES.UNKNOWN_LOW_CONFIDENCE],
    });
  }
  return problems.slice(0, DTO_CAPS.maxProblems);
}

function buildPageUnderstandingProfileV1(signals) {
  const input = assertValidDto(signals, validateCollectedPageSignalsV1, 'CollectedPageSignalsV1');
  const scores = scorePageTypes(input);
  const choice = choosePageType(scores);
  const pageTypeConfidence = confidenceFromChoice(choice);
  const risk = riskProfile(input, pageTypeConfidence);
  const candidates = buildCandidates(input, choice.pageType);
  const profile = {
    schemaVersion: ENGINE_CORE_SCHEMA_VERSION,
    frameId: input.frameId,
    collectionEpoch: input.collectionEpoch,
    routeEpoch: input.routeEpoch,
    pageType: choice.pageType,
    pageTypeConfidence,
    selectedScope: selectedScopeFor(choice.pageType, candidates, pageTypeConfidence),
    candidates,
    problems: buildProblems(risk, pageTypeConfidence, input),
    risk,
    reasons: collectReasons(input, choice),
    stats: {
      elapsedMs: input.stats.elapsedMs,
      nodesScanned: input.stats.nodesScanned,
      candidatesSeen: input.stats.candidatesSeen,
      budgetHit: input.stats.budgetHit,
    },
  };

  return assertValidDto(profile, validatePageUnderstandingProfileV1, 'PageUnderstandingProfileV1');
}

export function routePageSignalsV1(signals) {
  return buildPageUnderstandingProfileV1(signals);
}
