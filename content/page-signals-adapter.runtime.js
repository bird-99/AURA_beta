// content/page-signals-adapter.runtime.js

(function initAuraPageSignalsAdapter(globalScope) {
  const SCHEMA_VERSION = 1;
  const DEFAULT_BUDGET_MS = 16;
  const MAX_BLOCKS = 20;
  const MAX_NODES_SCANNED = 5000;
  const MAX_CANDIDATES_SEEN = 1000;
  const COUNT_CAP = 1000;
  const TEXT_CAP = 20000;
  const EPOCH_PREFIX = 'aura_pse';

  const BLOCK_ROLES = Object.freeze({
    PRIMARY_CONTENT: 'PRIMARY_CONTENT',
    ARTICLE: 'ARTICLE',
    CARD: 'CARD',
    PLAYER: 'PLAYER',
    COMMENTS: 'COMMENTS',
    FORM: 'FORM',
    TABLE: 'TABLE',
    NAV: 'NAV',
    AD: 'AD',
    UNKNOWN: 'UNKNOWN',
  });

  const REASONS = Object.freeze({
    ARTICLE_TEXT_DENSITY_HIGH: 'ARTICLE_TEXT_DENSITY_HIGH',
    DOC_STRUCTURE_DETECTED: 'DOC_STRUCTURE_DETECTED',
    VIDEO_MEDIA_DENSITY_HIGH: 'VIDEO_MEDIA_DENSITY_HIGH',
    FEED_CARD_REPETITION_DETECTED: 'FEED_CARD_REPETITION_DETECTED',
    FORM_CONTROLS_PRESENT: 'FORM_CONTROLS_PRESENT',
    DASHBOARD_TABLE_DENSITY_HIGH: 'DASHBOARD_TABLE_DENSITY_HIGH',
  });

  const TARGET_KINDS = Object.freeze({
    READING_REGION: 'READING_REGION',
    RECORD_REGION: 'RECORD_REGION',
    FORM_REGION: 'FORM_REGION',
    DASHBOARD_REGION: 'DASHBOARD_REGION',
    MEDIA_REGION: 'MEDIA_REGION',
    APP_REGION: 'APP_REGION',
    FOCUSABLE_REGION: 'FOCUSABLE_REGION',
    BASELINE_OR_ABSTAIN: 'BASELINE_OR_ABSTAIN',
    NONE: 'NONE',
  });

  const CANDIDATE_SELECTOR = [
    'main',
    'article',
    'section',
    'form',
    'table',
    'aside',
    'video',
    '[role="main"]',
    '[role="article"]',
    '[role="feed"]',
    '[role="grid"]',
    '[role="table"]',
    '[role="form"]',
    '[role="dialog"]',
  ].join(', ');
  const SMALL_TARGET_SELECTOR =
    'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const SMALL_TARGET_MIN_PX = 24;
  const SMALL_TARGET_SCAN_CAP = 200;

  const registryState = {
    collectionCounter: 0,
    routeCounter: 0,
    routeKey: '',
    collectionEpoch: '',
    routeEpoch: `${EPOCH_PREFIX}_route_0`,
    frameId: 0,
    collectedAtMs: 0,
    targets: new Map(),
  };

  function safeNumber(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, safeNumber(value, min)));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function bucket01(value, bucketMax = 10) {
    return clamp(Math.round(clamp01(value) * bucketMax), 0, bucketMax);
  }

  function countBucket(value) {
    const count = Math.max(0, Math.round(safeNumber(value, 0)));
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 3;
    if (count <= 7) return 6;
    return 10;
  }

  function safeNow(clock) {
    try {
      const value = typeof clock === 'function' ? clock() : Date.now();
      return safeNumber(value, 0);
    } catch {
      return 0;
    }
  }

  function getDefaultClock(doc) {
    const view = doc?.defaultView || globalScope?.window || null;
    const perfNow = view?.performance?.now || globalScope?.performance?.now;
    if (typeof perfNow === 'function') {
      return () => perfNow.call(view?.performance || globalScope.performance);
    }
    return () => Date.now();
  }

  function currentRouteKey(doc) {
    const loc = doc?.location || globalScope?.location || {};
    return `${String(loc.pathname || '')}|${String(loc.search || '')}|${String(loc.hash || '')}`;
  }

  function clearTargetRegistry() {
    registryState.collectionEpoch = '';
    registryState.frameId = 0;
    registryState.collectedAtMs = 0;
    registryState.targets.clear();
  }

  function ensureRouteEpoch(doc) {
    const nextRouteKey = currentRouteKey(doc);
    if (registryState.routeKey !== nextRouteKey) {
      registryState.routeKey = nextRouteKey;
      registryState.routeCounter += 1;
      registryState.routeEpoch = `${EPOCH_PREFIX}_route_${registryState.routeCounter}`;
      clearTargetRegistry();
    }
    return registryState.routeEpoch;
  }

  function nextCollectionEpoch() {
    registryState.collectionCounter += 1;
    return `${EPOCH_PREFIX}_collection_${registryState.collectionCounter}`;
  }

  function getViewport(doc) {
    const view = doc?.defaultView || globalScope?.window || {};
    const root = doc?.documentElement || {};
    const body = doc?.body || {};
    const w = safeNumber(view.innerWidth, safeNumber(root.clientWidth, safeNumber(body.clientWidth, 1)));
    const h = safeNumber(view.innerHeight, safeNumber(root.clientHeight, safeNumber(body.clientHeight, 1)));
    return {
      w: clamp(Math.round(w), 1, 10000),
      h: clamp(Math.round(h), 1, 10000),
    };
  }

  function toArray(value, cap = COUNT_CAP) {
    if (!value) return [];
    try {
      return Array.prototype.slice.call(value, 0, cap);
    } catch {
      return [];
    }
  }

  function queryAll(root, selector, cap = COUNT_CAP) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    try {
      return toArray(root.querySelectorAll(selector), cap);
    } catch {
      return [];
    }
  }

  function countAll(root, selector, cap = COUNT_CAP) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    try {
      const matches = root.querySelectorAll(selector);
      if (typeof matches?.length === 'number') {
        return Math.min(matches.length, cap);
      }
      return toArray(matches, cap).length;
    } catch {
      return 0;
    }
  }

  function getAttribute(el, name) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    try {
      return String(el.getAttribute(name) || '');
    } catch {
      return '';
    }
  }

  function getTag(el) {
    return String(el?.tagName || '').toLowerCase();
  }

  function getRole(el) {
    return getAttribute(el, 'role').toLowerCase();
  }

  function getClassAndIdBucket(el) {
    const className = typeof el?.className === 'string' ? el.className : '';
    const id = typeof el?.id === 'string' ? el.id : '';
    return `${className} ${id}`.toLowerCase();
  }

  function safeTextLength(el, cap = TEXT_CAP) {
    try {
      const value = typeof el?.textContent === 'string' ? el.textContent : '';
      return Math.min(value.length, cap);
    } catch {
      return 0;
    }
  }

  function getRectRatio(el, viewport) {
    let rect = null;
    try {
      rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    } catch {
      rect = null;
    }

    const width = Math.max(0, safeNumber(rect?.width, 0));
    const height = Math.max(0, safeNumber(rect?.height, 0));
    const left = safeNumber(rect?.left, safeNumber(rect?.x, 0));
    const top = safeNumber(rect?.top, safeNumber(rect?.y, 0));
    const viewportArea = Math.max(1, viewport.w * viewport.h);
    const elementArea = Math.max(0, width * height);
    const visibleWidth = Math.max(0, Math.min(left + width, viewport.w) - Math.max(left, 0));
    const visibleHeight = Math.max(0, Math.min(top + height, viewport.h) - Math.max(top, 0));
    const visibleArea = visibleWidth * visibleHeight;

    return {
      xRatio: clamp01(left / viewport.w),
      yRatio: clamp01(top / viewport.h),
      widthRatio: clamp01(width / viewport.w),
      heightRatio: clamp01(height / viewport.h),
      visibleRatio: clamp01(visibleArea / Math.max(1, elementArea || viewportArea)),
    };
  }

  function getComputedPosition(el, doc) {
    try {
      const view = doc?.defaultView || globalScope?.window || null;
      const computed = view?.getComputedStyle?.(el);
      return String(computed?.position || '').toLowerCase();
    } catch {
      return '';
    }
  }

  function isProbablyVisible(el, doc) {
    try {
      const view = doc?.defaultView || globalScope?.window || null;
      const computed = view?.getComputedStyle?.(el);
      if (computed?.display === 'none' || computed?.visibility === 'hidden') return false;
    } catch {
      // Visibility is a best-effort signal; lack of computed style should not drop the block.
    }

    try {
      const rect = typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
      if (rect && safeNumber(rect.width, 0) <= 0 && safeNumber(rect.height, 0) <= 0) return false;
    } catch {
      return true;
    }

    return true;
  }

  function isElementInDocument(doc, target) {
    if (!target) return false;
    if (typeof target.isConnected === 'boolean') return target.isConnected;
    const root = doc?.body || doc?.documentElement || null;
    if (!root) return false;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      toArray(current?.children, COUNT_CAP).forEach((child) => stack.push(child));
    }
    return false;
  }

  function computeMetrics(root, viewport) {
    const elementCount = Math.max(1, countAll(root, '*', COUNT_CAP) + 1);
    const textLen = safeTextLength(root);
    const links = queryAll(root, 'a', COUNT_CAP);
    const linkTextLen = links.reduce((sum, link) => sum + safeTextLength(link, 512), 0);
    const interactiveCount = countAll(
      root,
      'a, button, input, textarea, select, summary, [role="button"], [role="link"], [tabindex]',
      COUNT_CAP
    );
    const mediaCount = countAll(root, 'img, video, audio, picture, figure, canvas, iframe', COUNT_CAP);
    const formCount = countAll(root, 'form, input, textarea, select, button, [role="form"]', COUNT_CAP);
    const tableCount = countAll(root, 'table, [role="table"], [role="grid"], tr, [role="row"]', COUNT_CAP);
    const rectRatio = getRectRatio(root, viewport);

    return {
      textDensity: clamp01(textLen / Math.max(240, elementCount * 120)),
      linkDensity: clamp01(linkTextLen / Math.max(1, textLen)),
      interactiveDensity: clamp01(interactiveCount / elementCount),
      mediaDensity: clamp01(mediaCount / elementCount),
      formDensity: clamp01(formCount / elementCount),
      tableDensity: clamp01(tableCount / elementCount),
      viewportCoverage: clamp01(rectRatio.widthRatio * rectRatio.heightRatio),
    };
  }

  function inferRoleHint(el, metrics) {
    const tag = getTag(el);
    const role = getRole(el);
    const bucket = getClassAndIdBucket(el);

    if (/\b(ad|ads|advert|sponsor|promoted)\b/.test(bucket)) return BLOCK_ROLES.AD;
    if (tag === 'nav' || role === 'navigation') return BLOCK_ROLES.NAV;
    if (tag === 'form' || role === 'form' || metrics.formDensity >= 0.2) return BLOCK_ROLES.FORM;
    if (tag === 'table' || role === 'table' || role === 'grid' || metrics.tableDensity >= 0.2) return BLOCK_ROLES.TABLE;
    if (tag === 'video' || tag === 'iframe' || metrics.mediaDensity >= 0.35) return BLOCK_ROLES.PLAYER;
    if (role === 'feed' || role === 'list' || bucket.includes('card')) return BLOCK_ROLES.CARD;
    if (tag === 'article' || role === 'article') return BLOCK_ROLES.ARTICLE;
    if (tag === 'main' || role === 'main') return BLOCK_ROLES.PRIMARY_CONTENT;
    if (bucket.includes('comment')) return BLOCK_ROLES.COMMENTS;
    return BLOCK_ROLES.UNKNOWN;
  }

  function inferBlockFlags(el, roleHint, metrics) {
    const flags = [];
    const headingCount = countAll(el, 'h1, h2, h3, [role="heading"]', 50);

    if (
      (roleHint === BLOCK_ROLES.ARTICLE || roleHint === BLOCK_ROLES.PRIMARY_CONTENT)
      && metrics.textDensity >= 0.45
      && metrics.linkDensity <= 0.45
    ) {
      flags.push(REASONS.ARTICLE_TEXT_DENSITY_HIGH);
    }
    if (headingCount >= 2) {
      flags.push(REASONS.DOC_STRUCTURE_DETECTED);
    }
    if (roleHint === BLOCK_ROLES.PLAYER || metrics.mediaDensity >= 0.25) {
      flags.push(REASONS.VIDEO_MEDIA_DENSITY_HIGH);
    }
    if (roleHint === BLOCK_ROLES.CARD) {
      flags.push(REASONS.FEED_CARD_REPETITION_DETECTED);
    }
    if (roleHint === BLOCK_ROLES.FORM || metrics.formDensity >= 0.15) {
      flags.push(REASONS.FORM_CONTROLS_PRESENT);
    }
    if (roleHint === BLOCK_ROLES.TABLE || metrics.tableDensity >= 0.15) {
      flags.push(REASONS.DASHBOARD_TABLE_DENSITY_HIGH);
    }

    return flags.slice(0, 20);
  }

  function deriveUrlKind(doc) {
    const loc = doc?.location || globalScope?.location || {};
    const pathname = String(loc.pathname || '').toLowerCase();
    const search = String(loc.search || '').toLowerCase();

    if (pathname.includes('/watch') || pathname.includes('/shorts') || search.includes('v=')) return 'VIDEO';
    if (pathname.includes('/search') || search.includes('q=') || search.includes('query=')) return 'SEARCH';
    if (pathname.includes('/docs') || pathname.includes('/documentation') || pathname.includes('/guide')) return 'DOC';
    if (pathname.includes('/shop') || pathname.includes('/product')) return 'SHOP';
    return 'UNKNOWN';
  }

  function collectPageHints(doc, candidateElements) {
    const modalLikeSelector = 'dialog, [role="dialog"], [aria-modal="true"], [data-modal], .modal';
    const fixedOrStickyCount = candidateElements.reduce((count, el) => {
      const position = getComputedPosition(el, doc);
      return position === 'fixed' || position === 'sticky' ? count + 1 : count;
    }, 0);

    return {
      urlKind: deriveUrlKind(doc),
      semanticArticleCount: countAll(doc, 'article, main, [role="main"], [role="article"], [data-article-body]', COUNT_CAP),
      formCount: countAll(doc, 'form', COUNT_CAP),
      smallTargetCount: countSmallTargets(doc),
      tableCount: countAll(doc, 'table, [role="table"], [role="grid"]', COUNT_CAP),
      mediaCount: countAll(doc, 'video, audio, img, picture, figure, canvas, iframe', COUNT_CAP),
      fixedOrStickyCount: Math.min(fixedOrStickyCount, COUNT_CAP),
      modalLikeCount: countAll(doc, modalLikeSelector, COUNT_CAP),
    };
  }

  function countSmallTargets(doc) {
    const candidates = queryAll(doc, SMALL_TARGET_SELECTOR, SMALL_TARGET_SCAN_CAP);
    let count = 0;

    for (const el of candidates) {
      if (!isProbablyVisible(el, doc)) continue;
      let rect;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        continue;
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (rect.width < SMALL_TARGET_MIN_PX || rect.height < SMALL_TARGET_MIN_PX) {
        count += 1;
      }
    }

    return Math.min(count, COUNT_CAP);
  }

  function collectCandidateElements(doc, maxCandidatesSeen) {
    const candidates = [];
    const seen = new Set();

    const add = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      candidates.push(el);
    };

    ['main', 'article', '[role="main"]'].forEach((selector) => {
      queryAll(doc, selector, 5).forEach(add);
    });
    queryAll(doc, CANDIDATE_SELECTOR, maxCandidatesSeen).forEach(add);

    if (!candidates.length && doc?.body) {
      add(doc.body);
    }

    return candidates.slice(0, maxCandidatesSeen);
  }

  function collectBlocks(doc, viewport, options) {
    const visibleCandidates = Array.isArray(options.visibleCandidates)
      ? options.visibleCandidates.slice(0, options.maxBlocks)
      : options.candidateElements
        .filter((el) => isProbablyVisible(el, doc))
        .slice(0, options.maxBlocks);
    const blockDetails = visibleCandidates.map((el, index) => {
      const metrics = computeMetrics(el, viewport);
      const roleHint = inferRoleHint(el, metrics);
      const rectRatio = getRectRatio(el, viewport);
      return {
        el,
        block: {
          blockId: `b${index + 1}`,
          roleHint,
          rectRatio,
          metrics,
          flags: inferBlockFlags(el, roleHint, metrics),
        },
      };
    });

    return {
      blocks: blockDetails.map((detail) => detail.block),
      observedBlocks: blockDetails.map((detail, index) => buildObservedBlockSignalV2({
        detail,
        index,
        blockDetails,
      })),
    };
  }

  function rectCenter(rectRatio) {
    return {
      x: clamp01(rectRatio.xRatio + (rectRatio.widthRatio / 2)),
      y: clamp01(rectRatio.yRatio + (rectRatio.heightRatio / 2)),
    };
  }

  function rectHorizontalOverlap(left, right) {
    const start = Math.max(left.xRatio, right.xRatio);
    const end = Math.min(left.xRatio + left.widthRatio, right.xRatio + right.widthRatio);
    return clamp01((end - start) / Math.max(0.01, Math.min(left.widthRatio, right.widthRatio)));
  }

  function isVerticallyAdjacent(left, right) {
    const leftBottom = left.yRatio + left.heightRatio;
    const rightBottom = right.yRatio + right.heightRatio;
    const gap = Math.min(
      Math.abs(right.yRatio - leftBottom),
      Math.abs(left.yRatio - rightBottom)
    );
    return gap <= 0.08 && rectHorizontalOverlap(left, right) >= 0.25;
  }

  function siblingShapeKey(el) {
    return `${getTag(el)}|${getRole(el)}|${countBucket(toArray(el?.children, 50).length)}`;
  }

  function siblingHints(el) {
    const siblings = toArray(el?.parentNode?.children, 100);
    const count = siblings.length;
    const index = Math.max(0, siblings.indexOf(el));
    const shape = siblingShapeKey(el);
    const similarCount = siblings.filter((sibling) => siblingShapeKey(sibling) === shape).length;

    return {
      siblingIndexBucket: count <= 1 ? 0 : bucket01(index / Math.max(1, count - 1)),
      siblingCountBucket: countBucket(count),
      repeatedSiblingShapeHint: similarCount >= 2,
    };
  }

  function buildObservedBlockSignalV2({ detail, index, blockDetails }) {
    const { el, block } = detail;
    const rectRatio = block.rectRatio;
    const center = rectCenter(rectRatio);
    const neighborRatios = [
      blockDetails[index - 1]?.block?.rectRatio,
      blockDetails[index + 1]?.block?.rectRatio,
    ].filter(Boolean);
    const sameRowHint = neighborRatios.some((neighbor) => Math.abs(rectCenter(neighbor).y - center.y) <= 0.08);
    const sameColumnHint = neighborRatios.some((neighbor) => Math.abs(rectCenter(neighbor).x - center.x) <= 0.08);
    const verticalAdjacencyHint = neighborRatios.some((neighbor) => isVerticallyAdjacent(rectRatio, neighbor));
    const siblings = siblingHints(el);
    const headingCount = countAll(el, 'h1, h2, h3, [role="heading"]', 20);
    const listCount = countAll(el, 'ul, ol, li, [role="list"], [role="listitem"]', 50);
    const mediaCount = countAll(el, 'video, audio, img, picture, figure, canvas, iframe', 50);
    const hasMediaSignal = mediaCount > 0 || block.roleHint === BLOCK_ROLES.PLAYER || block.metrics.mediaDensity > 0.1;
    const bucket = getClassAndIdBucket(el);
    const centrality = 1 - clamp01(Math.abs(center.x - 0.5) + Math.abs(center.y - 0.5));

    return {
      blockId: block.blockId,
      rectBuckets: {
        x: bucket01(rectRatio.xRatio),
        y: bucket01(rectRatio.yRatio),
        w: bucket01(rectRatio.widthRatio),
        h: bucket01(rectRatio.heightRatio),
      },
      visibleAreaBucket: bucket01(rectRatio.widthRatio * rectRatio.heightRatio * rectRatio.visibleRatio),
      viewportIntersectionBucket: bucket01(rectRatio.visibleRatio),
      sameRowHint,
      sameColumnHint,
      verticalAdjacencyHint,
      repeatedSiblingShapeHint: siblings.repeatedSiblingShapeHint || block.roleHint === BLOCK_ROLES.CARD,
      siblingIndexBucket: siblings.siblingIndexBucket,
      siblingCountBucket: siblings.siblingCountBucket,
      formControlDensityBucket: bucket01(block.metrics.formDensity),
      linkDensityBucket: bucket01(block.metrics.linkDensity),
      mediaControlSeparationHint: hasMediaSignal && block.metrics.interactiveDensity <= 0.2,
      headingHint: headingCount > 0,
      listHint: listCount > 0 || block.roleHint === BLOCK_ROLES.TABLE,
      cardHint: block.roleHint === BLOCK_ROLES.CARD || /\b(card|grid|feed|result|product)\b/.test(bucket),
      centralityBucket: bucket01(centrality),
    };
  }

  function collectObservedNodeSignalsV2({ doc, observedBlocks, stats }) {
    const readyState = ['loading', 'interactive', 'complete'].includes(doc?.readyState)
      ? doc.readyState
      : 'unknown';
    const blocksWithSignals = observedBlocks.filter((block) => block && typeof block.blockId === 'string').length;
    const observedCount = observedBlocks.length;

    return {
      version: 2,
      collectionMode: 'BLOCK_SUMMARY',
      readiness: {
        documentReadyState: readyState,
        lateLoadLikely: readyState === 'loading' || stats.budgetHit === true,
        layoutStableHint: readyState === 'complete' && stats.budgetHit !== true,
      },
      coverage: {
        blocksObserved: observedCount,
        blocksWithSignals,
        candidatesSeen: stats.candidatesSeen,
        nodesSampled: stats.nodesScanned,
        elapsedMs: stats.elapsedMs,
        v2Coverage: observedCount ? clamp01(blocksWithSignals / observedCount) : 0,
        budgetHit: stats.budgetHit,
        partial: stats.budgetHit === true,
      },
      blockSignals: observedBlocks.slice(0, MAX_BLOCKS),
    };
  }

  function targetKindStillMatches(el, doc, expectedTargetKind) {
    if (expectedTargetKind === TARGET_KINDS.BASELINE_OR_ABSTAIN) return true;
    if (expectedTargetKind === TARGET_KINDS.NONE) return false;

    const viewport = getViewport(doc);
    const metrics = computeMetrics(el, viewport);
    const roleHint = inferRoleHint(el, metrics);

    switch (expectedTargetKind) {
      case TARGET_KINDS.READING_REGION:
        return (
          roleHint === BLOCK_ROLES.ARTICLE
          || roleHint === BLOCK_ROLES.PRIMARY_CONTENT
          || metrics.textDensity >= 0.35
        ) && metrics.linkDensity <= 0.6;
      case TARGET_KINDS.RECORD_REGION:
        return roleHint === BLOCK_ROLES.CARD || metrics.viewportCoverage > 0.02;
      case TARGET_KINDS.FORM_REGION:
        return roleHint === BLOCK_ROLES.FORM || metrics.formDensity >= 0.1;
      case TARGET_KINDS.DASHBOARD_REGION:
        return roleHint === BLOCK_ROLES.TABLE || metrics.tableDensity >= 0.1;
      case TARGET_KINDS.MEDIA_REGION:
        return roleHint === BLOCK_ROLES.PLAYER || metrics.mediaDensity >= 0.15;
      case TARGET_KINDS.APP_REGION:
        return metrics.interactiveDensity >= 0.05 || roleHint === BLOCK_ROLES.PRIMARY_CONTENT;
      case TARGET_KINDS.FOCUSABLE_REGION:
        return metrics.interactiveDensity >= 0.02 || metrics.viewportCoverage > 0.02;
      default:
        return false;
    }
  }

  function registerCollectedTargets({ doc, frameId, visibleCandidates, collectionEpoch, routeEpoch, collectedAtMs }) {
    registryState.collectionEpoch = collectionEpoch;
    registryState.routeEpoch = routeEpoch;
    registryState.frameId = frameId;
    registryState.collectedAtMs = collectedAtMs;
    registryState.targets.clear();

    visibleCandidates.slice(0, MAX_BLOCKS).forEach((el, index) => {
      const blockId = `b${index + 1}`;
      const regionId = `r${index + 1}`;
      const entry = { el, blockId, regionId };
      registryState.targets.set(blockId, entry);
      registryState.targets.set(regionId, entry);
    });

    if (!doc?.body && !doc?.documentElement) {
      clearTargetRegistry();
    }
  }

  function validationResult({
    ok = false,
    reason = 'TARGET_INVALID',
    sameEpoch = false,
    stillConnected = false,
    stillVisible = false,
    roleHintStillMatches = false,
    confidence = 0,
    frameId = 0,
  } = {}) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: ok === true,
      reason,
      sameEpoch: sameEpoch === true,
      stillConnected: stillConnected === true,
      stillVisible: stillVisible === true,
      roleHintStillMatches: roleHintStillMatches === true,
      confidence: clamp01(confidence),
      frameId: clamp(Math.round(safeNumber(frameId, 0)), 0, 1000000),
    };
  }

  function validateRegionTargetV1(request = {}, options = {}) {
    const doc = options.doc || globalScope?.document || null;
    ensureRouteEpoch(doc);
    const hasFrameId = typeof request.frameId === 'number'
      && Number.isFinite(request.frameId)
      && Number.isInteger(request.frameId)
      && request.frameId >= 0
      && request.frameId <= 1000000;
    const frameId = hasFrameId ? request.frameId : 0;
    const targetId = typeof request.sourceBlockId === 'string' && request.sourceBlockId
      ? request.sourceBlockId
      : typeof request.regionId === 'string'
        ? request.regionId
        : '';

    if (
      !hasFrameId
      || !targetId
      || typeof request.collectionEpoch !== 'string'
      || typeof request.routeEpoch !== 'string'
      || typeof request.expectedTargetKind !== 'string'
    ) {
      return validationResult({ reason: 'INVALID_REQUEST', frameId });
    }
    if (frameId !== registryState.frameId) {
      return validationResult({ reason: 'FRAME_MISMATCH', frameId });
    }

    const sameEpoch = request.collectionEpoch === registryState.collectionEpoch
      && request.routeEpoch === registryState.routeEpoch
      && Boolean(registryState.collectionEpoch)
      && Boolean(registryState.routeEpoch);
    if (!sameEpoch) {
      return validationResult({ reason: 'TARGET_STALE', frameId, sameEpoch: false });
    }

    const entry = registryState.targets.get(targetId);
    if (!entry?.el) {
      return validationResult({ reason: 'TARGET_NOT_FOUND', frameId, sameEpoch: true });
    }

    const stillConnected = isElementInDocument(doc, entry.el);
    const stillVisible = stillConnected && isProbablyVisible(entry.el, doc);
    const roleHintStillMatches = stillVisible && targetKindStillMatches(entry.el, doc, request.expectedTargetKind);
    const ok = sameEpoch && stillConnected && stillVisible && roleHintStillMatches;
    const reason = ok
      ? 'OK'
      : !stillConnected
        ? 'TARGET_DETACHED'
        : !stillVisible
          ? 'TARGET_HIDDEN'
          : !roleHintStillMatches
            ? 'TARGET_KIND_MISMATCH'
            : 'TARGET_INVALID';

    return validationResult({
      ok,
      reason,
      sameEpoch,
      stillConnected,
      stillVisible,
      roleHintStillMatches,
      confidence: ok ? 1 : 0,
      frameId,
    });
  }

  function getRegionTargetElementV1(request = {}, options = {}) {
    const validation = validateRegionTargetV1(request, options);
    if (validation?.ok !== true) {
      return null;
    }

    const targetId = typeof request.sourceBlockId === 'string' && request.sourceBlockId
      ? request.sourceBlockId
      : typeof request.regionId === 'string'
        ? request.regionId
        : '';
    return registryState.targets.get(targetId)?.el || null;
  }

  function collectPageSignalsV1(options = {}) {
    const doc = options.doc || globalScope?.document || null;
    const clock = options.now || getDefaultClock(doc);
    const start = safeNow(clock);
    const budgetMs = clamp(safeNumber(options.budgetMs, DEFAULT_BUDGET_MS), 1, 1000);
    const maxBlocks = clamp(Math.round(safeNumber(options.maxBlocks, MAX_BLOCKS)), 1, MAX_BLOCKS);
    const maxNodes = clamp(Math.round(safeNumber(options.maxNodes, MAX_NODES_SCANNED)), 1, MAX_NODES_SCANNED);
    const maxCandidatesSeen = clamp(
      Math.round(safeNumber(options.maxCandidatesSeen, MAX_CANDIDATES_SEEN)),
      1,
      MAX_CANDIDATES_SEEN
    );
    const frameId = clamp(Math.round(safeNumber(options.frameId, 0)), 0, 1000000);
    const routeEpoch = ensureRouteEpoch(doc);
    const collectionEpoch = nextCollectionEpoch();
    const viewport = getViewport(doc);
    const body = doc?.body || doc?.documentElement || null;
    const candidateElements = collectCandidateElements(doc, maxCandidatesSeen);
    const pageHints = collectPageHints(doc, candidateElements);
    const aggregateMetrics = body
      ? computeMetrics(body, viewport)
      : {
          textDensity: 0,
          linkDensity: 0,
          interactiveDensity: 0,
          mediaDensity: 0,
          formDensity: 0,
          tableDensity: 0,
          viewportCoverage: 0,
        };
    const visibleCandidates = candidateElements
      .filter((el) => isProbablyVisible(el, doc))
      .slice(0, maxBlocks);
    const elapsedMs = Math.max(0, safeNow(clock) - start);
    const nodesScanned = Math.min(countAll(doc, '*', maxNodes), maxNodes);
    const budgetHit = elapsedMs > budgetMs || nodesScanned >= maxNodes || candidateElements.length >= maxCandidatesSeen;
    const stats = {
      elapsedMs,
      nodesScanned,
      candidatesSeen: candidateElements.length,
      budgetHit,
    };
    const { blocks, observedBlocks } = collectBlocks(doc, viewport, { visibleCandidates, maxBlocks });
    registerCollectedTargets({
      doc,
      frameId,
      visibleCandidates,
      collectionEpoch,
      routeEpoch,
      collectedAtMs: Date.now(),
    });

    const dto = {
      schemaVersion: SCHEMA_VERSION,
      frameId,
      collectionEpoch,
      routeEpoch,
      viewport,
      pageHints,
      aggregateMetrics,
      blocks,
      stats,
      observedNodeSignalsV2: collectObservedNodeSignalsV2({ doc, observedBlocks, stats }),
    };

    return dto;
  }

  globalScope.AURA_PAGE_SIGNALS_ADAPTER_V1 = Object.freeze({
    collectPageSignalsV1,
    validateRegionTargetV1,
    getRegionTargetElementV1,
    clearTargetRegistry,
  });
})(globalThis);
