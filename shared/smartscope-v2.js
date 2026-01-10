// shared/smartscope-v2.js
// SmartScope v2: deterministic, SAFE-by-default scope detector (foundation)

export const DEFAULT_BUDGET_MS = 80;
export const MAX_CANDIDATES = 180;
export const MAX_NODES_SCANNED = 3000;
export const TOP_K = 30;
export const MEDIA_MIN_C = 8;
export const MIN_SCORE = 300;
export const MIN_GAP = 120;
const MEDIA_EARLY_EXIT = MEDIA_MIN_C + 1;
const CENTER_DIST_EPSILON = 1e-3;
const TEXT_LEN_CAP = 20000;
const LINK_TEXT_LEN_CAP = 12000;
const CHUNK_THRESHOLD_MS = 25;

const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;

/**
 * @typedef {'A' | 'B' | 'C' | 'NONE'} SmartScopeBranch
 *
 * @typedef {{ code: string; message?: string; details?: unknown }} SmartScopeReason
 *
 * @typedef {{
 *   area: number;
 *   centerDist: number;
 *   textLen: number;
 *   pCount: number;
 *   linkCount: number;
 *   linkTextLen: number;
 *   mediaCount: number;
 *   innerTextLen?: number;
 * }} CandidateMetrics
 *
 * @typedef {{
 *   elapsedMs: number;
 *   budgetMs: number;
 *   candidatesSeen: number;
 *   nodesScanned: number;
 * }} SmartScopeStats
 *
 * @typedef {{
 *   ok: boolean;
 *   scopeEl: Element | null;
 *   branch: SmartScopeBranch;
 *   score: number;
 *   metrics: Record<string, unknown>;
 *   reasons: SmartScopeReason[];
 *   stats: SmartScopeStats;
 * }} SmartScopeV2Result
 */

const defaultNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

function safeNow(clock) {
  try {
    const value = clock();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  } catch (_) {
    // fall through to Date.now()
  }
  return Date.now();
}

function shouldYield(chunkStart, clock) {
  if (!Number.isFinite(chunkStart)) {
    return false;
  }
  const now = safeNow(clock);
  return now - chunkStart > CHUNK_THRESHOLD_MS;
}

async function yieldIfNeeded(chunkStart, clock) {
  if (shouldYield(chunkStart, clock)) {
    await Promise.resolve();
    return safeNow(clock);
  }
  return chunkStart;
}

function getRole(el) {
  if (!el) {
    return null;
  }
  if (typeof el.getAttribute === 'function') {
    return el.getAttribute('role');
  }
  return el.role || null;
}

function getAttr(el, name) {
  if (!el) {
    return null;
  }
  if (typeof el.getAttribute === 'function') {
    return el.getAttribute(name);
  }
  return el[name] || null;
}

function getComputedStyleSafe(el) {
  try {
    if (el?.ownerDocument?.defaultView && typeof el.ownerDocument.defaultView.getComputedStyle === 'function') {
      return el.ownerDocument.defaultView.getComputedStyle(el);
    }
    if (typeof getComputedStyle === 'function') {
      return getComputedStyle(el);
    }
  } catch (_) {
    // ignore and fallback
  }
  return null;
}

function clampNumber(value, defaultValue = 0) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return num;
  }
  return defaultValue;
}

function cappedLength(str, cap) {
  if (typeof str !== 'string') {
    return 0;
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    return str.length;
  }
  return Math.min(str.length, cap);
}

function viewportSize(el) {
  const doc = el?.ownerDocument;
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
  const width = clampNumber(win?.innerWidth || doc?.documentElement?.clientWidth, 1);
  const height = clampNumber(win?.innerHeight || doc?.documentElement?.clientHeight, 1);
  return { width, height };
}

function computeCenterDistance(rect, el) {
  const { width: vw, height: vh } = viewportSize(el);
  const rectWidth = clampNumber(rect?.width, 0);
  const rectHeight = clampNumber(rect?.height, 0);
  const centerX = clampNumber(rect?.left, 0) + rectWidth / 2;
  const centerY = clampNumber(rect?.top, 0) + rectHeight / 2;
  const viewportCenterX = vw / 2;
  const viewportCenterY = vh / 2;

  const dx = centerX - viewportCenterX;
  const dy = centerY - viewportCenterY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = Math.sqrt((vw / 2) ** 2 + (vh / 2) ** 2) || 1;
  return dist / maxDist;
}

function countWithEarlyExit(el, matcher, limit) {
  if (!el || typeof limit !== 'number' || limit <= 0) {
    return 0;
  }

  let count = 0;

  const showElement = typeof NodeFilter === 'object' && Number.isFinite(NodeFilter?.SHOW_ELEMENT)
    ? NodeFilter.SHOW_ELEMENT
    : 1;

  if (el?.ownerDocument?.createTreeWalker) {
    const walker = el.ownerDocument.createTreeWalker(el, showElement);
    let current = walker.currentNode;
    while (current) {
      if (current !== el && matcher(current)) {
        count += 1;
        if (count >= limit) {
          break;
        }
      }
      current = walker.nextNode();
    }
    return count;
  }

  if (typeof el.querySelectorAll === 'function') {
    try {
      const nodes = el.querySelectorAll('img, video, picture, figure');
      for (const node of nodes) {
        if (matcher(node)) {
          count += 1;
          if (count >= limit) {
            break;
          }
        }
      }
      return count;
    } catch (_) {
      // ignore
    }
  }

  return 0;
}

function safeQueryCount(el, selector, cap = Number.POSITIVE_INFINITY) {
  if (!el || typeof el.querySelectorAll !== 'function') {
    return 0;
  }
  try {
    const nodes = el.querySelectorAll(selector) || [];
    return Math.min(nodes.length, Number.isFinite(cap) ? cap : nodes.length);
  } catch (_) {
    return 0;
  }
}

/**
 * Compute cheap metrics for a candidate. Avoids expensive DOM operations.
 * @param {{ el: Element; deadline: number; now: () => number }} input
 * @returns {{ ok: boolean; m?: import('./smartscope-v2.js').CandidateMetrics; reason?: SmartScopeReason }}
 */
export function computeMetricsCheap(input) {
  const { el, deadline, now } = input || {};
  const clock = typeof now === 'function' ? now : defaultNow;

  if (safeNow(clock) > (deadline ?? Number.POSITIVE_INFINITY)) {
    return { ok: false, reason: { code: 'TIME_BUDGET_EXCEEDED' } };
  }

  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return { ok: false, reason: { code: 'INVALID_ELEMENT' } };
  }

  try {
    const rect = el.getBoundingClientRect() || { width: 0, height: 0, left: 0, top: 0 };
    const width = clampNumber(rect.width, 0);
    const height = clampNumber(rect.height, 0);
    const area = width * height;
    const centerDist = computeCenterDistance(rect, el);
    const textLen = cappedLength(el.textContent || '', TEXT_LEN_CAP);
    const pCount = safeQueryCount(el, 'p', 400);
    const linkNodes = typeof el.querySelectorAll === 'function' ? el.querySelectorAll('a') || [] : [];
    const linkCount = Math.min(linkNodes.length, 400);
    let linkTextLen = 0;
    for (let i = 0; i < linkNodes.length && i < 200; i += 1) {
      const node = linkNodes[i];
      linkTextLen += cappedLength(node?.textContent || '', LINK_TEXT_LEN_CAP - linkTextLen);
      if (linkTextLen >= LINK_TEXT_LEN_CAP) {
        linkTextLen = LINK_TEXT_LEN_CAP;
        break;
      }
    }

    const mediaCount = countWithEarlyExit(
      el,
      (node) => {
        const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
        return tag === 'img' || tag === 'video' || tag === 'picture' || tag === 'figure';
      },
      MEDIA_EARLY_EXIT,
    );

    /**
     * Early-exit on mediaCount is intentional: we only need "enough" media for Branch C.
     * Counting beyond MEDIA_MIN_C+1 provides no additional value and hurts performance on heavy pages.
     */
    const metrics = { area, centerDist, textLen, pCount, linkCount, linkTextLen, mediaCount };
    return { ok: true, m: metrics };
  } catch (error) {
    return { ok: false, reason: { code: 'METRICS_CHEAP_FAILED', message: error?.message } };
  }
}

/**
 * Compute expensive metrics. Runs only on TOP_K candidates.
 * @param {{ el: Element; deadline: number; now: () => number }} input
 * @returns {{ ok: boolean; m?: Partial<import('./smartscope-v2.js').CandidateMetrics>; reason?: SmartScopeReason }}
 */
export function computeMetricsExpensive(input) {
  const { el, deadline, now } = input || {};
  const clock = typeof now === 'function' ? now : defaultNow;

  if (safeNow(clock) > (deadline ?? Number.POSITIVE_INFINITY)) {
    return { ok: false, reason: { code: 'TIME_BUDGET_EXCEEDED' } };
  }

  if (!el) {
    return { ok: false, reason: { code: 'INVALID_ELEMENT' } };
  }

  try {
    const innerTextLen = cappedLength(el.innerText || '', TEXT_LEN_CAP);
    const richLinkTextLen = (() => {
      if (typeof el.querySelectorAll !== 'function') return 0;
      try {
        const nodes = el.querySelectorAll('a');
        let total = 0;
        for (let i = 0; i < nodes.length && total < LINK_TEXT_LEN_CAP; i += 1) {
          total += cappedLength(nodes[i]?.innerText || nodes[i]?.textContent || '', LINK_TEXT_LEN_CAP - total);
        }
        return total;
      } catch (_) {
        return 0;
      }
    })();

    return { ok: true, m: { innerTextLen, linkTextLen: richLinkTextLen } };
  } catch (error) {
    return { ok: false, reason: { code: 'METRICS_EXPENSIVE_FAILED', message: error?.message } };
  }
}

function cheapScore(m) {
  if (!m) return 0;
  const areaScore = m.area || 0;
  const textScore = (m.textLen || 0) * 2;
  const paragraphScore = (m.pCount || 0) * 100;
  const mediaScore = (m.mediaCount || 0) * 150;
  const linkPenalty = (m.linkCount || 0) * 30;
  return areaScore + textScore + paragraphScore + mediaScore - linkPenalty;
}

/**
 * Decide SmartScope branch based on metrics.
 * @param {CandidateMetrics} m
 * @returns {SmartScopeBranch}
 */
export function decideBranch(m) {
  if (!m) return 'NONE';
  if ((m.mediaCount || 0) >= MEDIA_MIN_C) return 'C';
  if ((m.pCount || 0) >= 3) return 'B';
  if ((m.textLen || 0) >= 300) return 'A';
  return 'NONE';
}

/**
 * Deterministic scoring per branch.
 * @param {{ m: CandidateMetrics; branch: SmartScopeBranch }} input
 */
export function scoreCandidate(input) {
  const { m, branch } = input || {};
  if (!m || !branch || branch === 'NONE') return 0;

  const baseArea = clampNumber(m.area, 0);
  const baseText = clampNumber(m.textLen, 0);
  const baseParagraphs = clampNumber(m.pCount, 0);
  const baseLinks = clampNumber(m.linkCount, 0);
  const baseMedia = clampNumber(m.mediaCount, 0);
  const centerPenalty = clampNumber(m.centerDist, 0);

  if (branch === 'A') {
    return baseText * 1.2 + baseArea * 0.05 + baseParagraphs * 60 - baseLinks * 5 - centerPenalty * 10;
  }

  if (branch === 'B') {
    return baseParagraphs * 160 + baseText * 0.9 + baseArea * 0.05 - baseLinks * 6 - centerPenalty * 12;
  }

  // Branch C
  return baseMedia * 320 + baseArea * 0.03 + baseText * 0.2 - baseLinks * 3 - centerPenalty * 20;
}

function compareScored(a, b) {
  const scoreDiff = b.score - a.score;
  if (Math.abs(scoreDiff) > 0) {
    return scoreDiff;
  }

  const textDiff = (b.m?.textLen || 0) - (a.m?.textLen || 0);
  if (Math.abs(textDiff) > 0) {
    return textDiff;
  }

  const areaDiff = (b.m?.area || 0) - (a.m?.area || 0);
  if (Math.abs(areaDiff) > 0) {
    return areaDiff;
  }

  const centerDiff = clampNumber(a.m?.centerDist, 0) - clampNumber(b.m?.centerDist, 0);
  if (Math.abs(centerDiff) > CENTER_DIST_EPSILON) {
    return centerDiff;
  }

  const domA = typeof a.domIndex === 'number' ? a.domIndex : Number.POSITIVE_INFINITY;
  const domB = typeof b.domIndex === 'number' ? b.domIndex : Number.POSITIVE_INFINITY;
  return domA - domB;
}

/**
 * @param {Array<{ m: CandidateMetrics; score: number; branch: SmartScopeBranch }>} scored
 */
export function pickBest(scored) {
  if (!Array.isArray(scored) || scored.length === 0) {
    return { best: undefined, runnerUp: undefined };
  }

  const sorted = scored.slice().sort(compareScored);
  return { best: sorted[0], runnerUp: sorted[1] };
}

function sanityCheck(candidate) {
  if (!candidate || !candidate.m) return false;
  if (candidate.branch === 'C') {
    return (candidate.m.mediaCount || 0) >= MEDIA_MIN_C;
  }
  if (candidate.branch === 'B') {
    return (candidate.m.pCount || 0) >= 2 && (candidate.m.textLen || 0) >= 150;
  }
  if (candidate.branch === 'A') {
    return (candidate.m.textLen || 0) >= 250 && (candidate.m.pCount || 0) >= 1;
  }
  return false;
}

/**
 * Final safety guard before returning element.
 * @param {Element} el
 */
export function verifyFinalScopeEl(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  if (tag === 'html' || tag === 'body') return false;
  if (isExcludedCandidate(el)) return false;

  const style = getComputedStyleSafe(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) {
    return false;
  }
  return true;
}

/**
 * Select TOP_K candidates with stable ordering and float-safe tie-breaks.
 * @param {Array<{ el: Element; domIndex?: number; m: import('./smartscope-v2.js').CandidateMetrics }>} candidates
 * @param {number} k
 */
export function selectTopK(candidates, k) {
  if (!Array.isArray(candidates) || k <= 0) {
    return [];
  }

  const indexed = candidates.map((c, idx) => ({ ...c, _order: typeof c.domIndex === 'number' ? c.domIndex : idx }));

  const sorted = indexed
    .slice()
    .sort((a, b) => {
      const scoreDiff = cheapScore(b.m) - cheapScore(a.m);
      if (Math.abs(scoreDiff) > 0) {
        return scoreDiff;
      }

      const distA = clampNumber(a.m?.centerDist, 0);
      const distB = clampNumber(b.m?.centerDist, 0);
      const distDiff = distA - distB;
      if (Math.abs(distDiff) > CENTER_DIST_EPSILON) {
        return distDiff;
      }

      return a._order - b._order;
    });

  return sorted.slice(0, Math.min(k, sorted.length)).map(({ _order, ...rest }) => rest);
}

export async function computeCandidateMetrics({
  candidates,
  deadline,
  now,
  computeExpensive = computeMetricsExpensive,
  topK = TOP_K,
}) {
  const clock = typeof now === 'function' ? now : defaultNow;
  const reasons = [];
  const cheapResults = [];
  let chunkStart = safeNow(clock);

  for (const candidate of candidates || []) {
    if (safeNow(clock) > (deadline ?? Number.POSITIVE_INFINITY)) {
      reasons.push({ code: 'TIME_BUDGET_EXCEEDED' });
      break;
    }

    chunkStart = await yieldIfNeeded(chunkStart, clock);
    const cheap = computeMetricsCheap({ el: candidate.el, deadline, now: clock });
    if (!cheap.ok) {
      if (cheap.reason) {
        reasons.push(cheap.reason);
      }
      continue;
    }
    cheapResults.push({ ...candidate, m: cheap.m });
  }

  if (reasons.some((reason) => reason.code === 'TIME_BUDGET_EXCEEDED')) {
    return { cheapResults, topKResults: [], reasons };
  }

  const top = selectTopK(cheapResults, topK);
  const enrichedTop = [];

  for (const candidate of top) {
    if (safeNow(clock) > (deadline ?? Number.POSITIVE_INFINITY)) {
      reasons.push({ code: 'TIME_BUDGET_EXCEEDED' });
      break;
    }
    chunkStart = await yieldIfNeeded(chunkStart, clock);
    const expensive = computeExpensive({ el: candidate.el, deadline, now: clock });
    if (expensive.ok && expensive.m) {
      enrichedTop.push({ ...candidate, m: { ...candidate.m, ...expensive.m } });
    } else {
      if (expensive.reason) {
        reasons.push(expensive.reason);
      }
      enrichedTop.push(candidate);
    }
  }

  return { cheapResults, topKResults: enrichedTop, reasons };
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function isExcludedCandidate(el) {
  if (!el || typeof el !== 'object') {
    return true;
  }

  const tagName = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  if (tagName && ['nav', 'header', 'footer', 'aside'].includes(tagName)) {
    return true;
  }

  const roleAttr = (getRole(el) || '').toLowerCase();
  const roles = roleAttr.split(/\s+/).filter(Boolean);
  if (roles.some((role) => ['navigation', 'banner', 'contentinfo', 'complementary', 'dialog'].includes(role))) {
    return true;
  }

  const ariaModal = (getAttr(el, 'aria-modal') || '').toString().toLowerCase();
  if (ariaModal === 'true') {
    return true;
  }

  return false;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
export function passesPrefilter(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    return false;
  }

  if (el.hasAttribute?.('hidden') || (el.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true') {
    return false;
  }

  const rect = el.getBoundingClientRect() || { width: 0, height: 0 };
  const width = Math.max(0, Number(rect.width) || 0);
  const height = Math.max(0, Number(rect.height) || 0);

  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    return false;
  }

  const computedStyle = getComputedStyleSafe(el);
  if (!computedStyle) {
    return false;
  }

  if (computedStyle.display === 'none') {
    return false;
  }

  if (computedStyle.visibility === 'hidden') {
    return false;
  }

  const area = width * height;
  if ((computedStyle.position === 'fixed' || computedStyle.position === 'sticky') && area < MIN_WIDTH * MIN_HEIGHT) {
    return false;
  }

  return true;
}

/**
 * Collect candidate elements in DOM order respecting caps and budget.
 * @param {{ doc: Document; deadline: number; now: () => number }} input
 */
export async function collectCandidates(input) {
  const { doc, deadline, now } = input || {};
  const clock = typeof now === 'function' ? now : defaultNow;
  const candidates = [];
  const reasons = [];
  let nodesScanned = 0;
  let chunkStart = safeNow(clock);

  if (!doc || typeof doc.querySelectorAll !== 'function') {
    return { candidates, nodesScanned, reasons };
  }

  let nodeList = [];
  try {
    nodeList = doc.querySelectorAll('main, article, [role="main"], section, div') || [];
  } catch (error) {
    reasons.push({ code: 'QUERY_FAILED', message: error?.message });
    return { candidates, nodesScanned, reasons };
  }

  for (const el of nodeList) {
    if (safeNow(clock) > (deadline ?? Number.POSITIVE_INFINITY)) {
      reasons.push({ code: 'TIME_BUDGET_EXCEEDED' });
      break;
    }

    chunkStart = await yieldIfNeeded(chunkStart, clock);

    if (nodesScanned >= MAX_NODES_SCANNED) {
      reasons.push({ code: 'NODE_CAP_REACHED' });
      break;
    }

    nodesScanned += 1;

    if (isExcludedCandidate(el)) {
      continue;
    }

    if (!passesPrefilter(el)) {
      continue;
    }

    candidates.push({ el, domIndex: nodesScanned - 1 });

    if (candidates.length >= MAX_CANDIDATES) {
      reasons.push({ code: 'CANDIDATE_CAP_REACHED' });
      break;
    }
  }

  return { candidates, nodesScanned, reasons };
}

function baseResult({
  ok = false,
  scopeEl = null,
  branch = 'NONE',
  score = 0,
  metrics = {},
  reasons = [],
  stats,
}) {
  return {
    ok,
    scopeEl,
    branch,
    score,
    metrics,
    reasons,
    stats,
  };
}

/**
 * Stable SmartScope v2 entry point.
 * @param {{ doc: Document; budgetMs?: number; now?: () => number }} input
 * @returns {SmartScopeV2Result}
 */
export async function detectScopeRootV2(input) {
  const { doc, budgetMs, now } = input || {};
  const clock = typeof now === 'function' ? now : defaultNow;
  const start = safeNow(clock);
  const budget = typeof budgetMs === 'number' && Number.isFinite(budgetMs) ? budgetMs : DEFAULT_BUDGET_MS;
  const deadline = start + budget;

  const stats = {
    elapsedMs: 0,
    budgetMs: budget,
    candidatesSeen: 0,
    nodesScanned: 0,
  };
  const reasons = [];

  try {
    const current = safeNow(clock);
    if (current > deadline) {
      stats.elapsedMs = current - start;
      reasons.push({ code: 'TIME_BUDGET_EXCEEDED' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs },
        reasons,
        stats,
      });
    }

    if (!doc || typeof doc.querySelectorAll !== 'function') {
      stats.elapsedMs = safeNow(clock) - start;
      reasons.push({ code: 'INVALID_DOCUMENT' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs },
        reasons,
        stats,
      });
    }

    const { candidates, nodesScanned, reasons: candidateReasons } = await collectCandidates({
      doc,
      deadline,
      now: clock,
    });

    stats.nodesScanned = nodesScanned;
    stats.candidatesSeen = candidates.length;
    reasons.push(...candidateReasons);

    const { cheapResults, topKResults, reasons: metricReasons } = await computeCandidateMetrics({
      candidates,
      deadline,
      now: clock,
    });

    stats.candidatesSeen = cheapResults.length;
    reasons.push(...metricReasons);

    stats.elapsedMs = safeNow(clock) - start;

    if (reasons.some((reason) => reason.code === 'TIME_BUDGET_EXCEEDED')) {
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    if (cheapResults.length === 0) {
      reasons.push({ code: 'NO_CANDIDATES_FOUND' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    const scoredCandidates = topKResults.map((candidate, index) => {
      const branch = decideBranch(candidate.m);
      const score = scoreCandidate({ m: candidate.m, branch });
      return { ...candidate, branch, score, domIndex: typeof candidate.domIndex === 'number' ? candidate.domIndex : index };
    });

    const { best, runnerUp } = pickBest(scoredCandidates);

    if (!best || !Number.isFinite(best.score)) {
      reasons.push({ code: 'NO_VALID_CANDIDATE' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    if (best.score < MIN_SCORE) {
      reasons.push({ code: 'LOW_SCORE' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    if (runnerUp && best.score - runnerUp.score < MIN_GAP) {
      reasons.push({ code: 'AMBIGUOUS', details: { gap: best.score - runnerUp.score } });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    if (!sanityCheck(best)) {
      reasons.push({ code: 'SANITY_CHECK_FAILED' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    if (!verifyFinalScopeEl(best.el)) {
      reasons.push({ code: 'INVALID_FINAL_ELEMENT' });
      return baseResult({
        ok: false,
        scopeEl: null,
        branch: 'NONE',
        score: 0,
        metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
        reasons,
        stats,
      });
    }

    const metrics = {
      cheap: cheapResults,
      topK: topKResults,
      best: { branch: best.branch, score: best.score },
      elapsedMs: stats.elapsedMs,
      scanned: stats.nodesScanned,
      candidates: stats.candidatesSeen,
    };
    return baseResult({ ok: true, scopeEl: best.el, branch: best.branch, score: best.score, metrics, reasons, stats });
  } catch (error) {
    stats.elapsedMs = safeNow(clock) - start;
    reasons.push({ code: 'UNEXPECTED_ERROR', message: error?.message });
    return baseResult({
      ok: false,
      scopeEl: null,
      branch: 'NONE',
      score: 0,
      metrics: { elapsedMs: stats.elapsedMs, scanned: stats.nodesScanned, candidates: stats.candidatesSeen },
      reasons,
      stats,
    });
  }
}

// Temporary compatibility wrapper for existing call sites (until migration completes).
export function detectSmartScopeV2(doc, options = {}) {
  return detectScopeRootV2({
    doc,
    budgetMs: options?.budgetMs,
    now: options?.now,
  });
}

export const smartScopeV2Constants = {
  DEFAULT_BUDGET_MS,
  MAX_CANDIDATES,
  MAX_NODES_SCANNED,
  TOP_K,
  MEDIA_MIN_C,
  MIN_SCORE,
  MIN_GAP,
};

export default detectScopeRootV2;
