import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectCandidates,
  computeCandidateMetrics,
  computeMetricsCheap,
  detectScopeRootV2,
  isExcludedCandidate,
  passesPrefilter,
  selectTopK,
  smartScopeV2Constants,
} from '../shared/smartscope-v2.js';

test('Budget exceeded returns NONE with TIME_BUDGET_EXCEEDED reason', async () => {
  const now = (() => {
    let calls = 0;
    return () => {
      calls += 1;
      return calls === 1 ? 100 : 200;
    };
  })();

  const result = await detectScopeRootV2({ doc: {}, budgetMs: 50, now });

  assert.equal(result.ok, false);
  assert.equal(result.scopeEl, null);
  assert.equal(result.branch, 'NONE');
  assert.ok(result.reasons.some((reason) => reason.code === 'TIME_BUDGET_EXCEEDED'));
});

test('detectScopeRootV2 never throws and returns a stable shape', async () => {
  const result = await detectScopeRootV2({ doc: { body: null } });
  assert.equal(typeof result.ok, 'boolean');
  assert.ok(result.stats);
  assert.equal(result.scopeEl, null);
});

function makeStubElement({
  tagName = 'div',
  role,
  display = 'block',
  visibility = 'visible',
  width = 200,
  height = 200,
  position = 'static',
} = {}) {
  const upperTag = tagName.toUpperCase();
  const element = {
    tagName: upperTag,
    role,
    getAttribute: (name) => {
      if (name === 'role') {
        return role || null;
      }
      if (name === 'aria-modal') {
        return element.ariaModal || null;
      }
      return null;
    },
    ownerDocument: {},
    getBoundingClientRect: () => ({ width, height }),
  };

  element.ownerDocument.defaultView = {
    getComputedStyle: () => ({ display, visibility, position }),
  };

  return element;
}

function makeStubDoc(elements) {
  return {
    querySelectorAll: () => elements,
  };
}

test('isExcludedCandidate skips banned tags and roles', async () => {
  const header = makeStubElement({ tagName: 'header' });
  const navRole = makeStubElement({ tagName: 'div', role: 'navigation' });
  const main = makeStubElement({ tagName: 'main' });
  const article = makeStubElement({ tagName: 'article' });

  assert.equal(isExcludedCandidate(header), true);
  assert.equal(isExcludedCandidate(navRole), true);
  assert.equal(isExcludedCandidate(main), false);

  const doc = makeStubDoc([header, navRole, main, article]);
  const { candidates, nodesScanned, reasons } = await collectCandidates({ doc, deadline: Number.MAX_SAFE_INTEGER, now: () => 0 });

  assert.equal(nodesScanned, 4);
  assert.deepEqual(reasons, []);
  assert.deepEqual(
    candidates.map((c) => c.el.tagName),
    ['MAIN', 'ARTICLE'],
    'Only allowed elements should remain'
  );
});

test('passesPrefilter rejects visibility hidden elements', async () => {
  const visible = makeStubElement({ width: 150, height: 100 });
  const hidden = makeStubElement({ visibility: 'hidden' });

  assert.equal(passesPrefilter(visible), true);
  assert.equal(passesPrefilter(hidden), false);

  const doc = makeStubDoc([hidden, visible]);
  const { candidates } = await collectCandidates({ doc, deadline: Number.MAX_SAFE_INTEGER, now: () => 0 });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].el, visible);
});

test('collectCandidates enforces MAX_CANDIDATES cap', async () => {
  const pool = Array.from({ length: 500 }, () => makeStubElement({ width: 200, height: 200 }));
  const doc = makeStubDoc(pool);
  const { candidates, nodesScanned, reasons } = await collectCandidates({
    doc,
    deadline: Number.MAX_SAFE_INTEGER,
    now: () => 0,
  });

  assert.equal(candidates.length, smartScopeV2Constants.MAX_CANDIDATES);
  assert.ok(nodesScanned >= smartScopeV2Constants.MAX_CANDIDATES);
  assert.ok(reasons.some((reason) => reason.code === 'CANDIDATE_CAP_REACHED'));
});

test('computeMetricsCheap early-exits mediaCount at MEDIA_MIN_C+1', () => {
  const images = Array.from({ length: 50 }, () => ({ tagName: 'img' }));
  const el = {
    textContent: 'hello',
    innerText: 'hello',
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 800 } },
    getBoundingClientRect: () => ({ width: 200, height: 200, left: 0, top: 0 }),
    querySelectorAll: (selector) => {
      if (selector === 'img, video, picture, figure') return images;
      return [];
    },
  };

  const { ok, m } = computeMetricsCheap({
    el,
    deadline: Date.now() + 1000,
    now: () => Date.now(),
  });

  assert.equal(ok, true);
  assert.equal(m.mediaCount, smartScopeV2Constants.MEDIA_MIN_C + 1);
});

test('computeCandidateMetrics only calls expensive metrics for TOP_K candidates', async () => {
  let innerTextHits = 0;
  const candidates = Array.from({ length: smartScopeV2Constants.TOP_K + 5 }, (_, idx) => {
    const el = {
      textContent: 'content',
      get innerText() {
        innerTextHits += 1;
        return 'content';
      },
      ownerDocument: { defaultView: { innerWidth: 800, innerHeight: 600 } },
      getBoundingClientRect: () => ({ width: 300, height: 200, left: idx, top: 0 }),
      querySelectorAll: () => [],
    };
    return { el, domIndex: idx };
  });

  const { cheapResults, topKResults } = await computeCandidateMetrics({
    candidates,
    deadline: Date.now() + 1000,
    now: () => Date.now(),
  });

  assert.equal(cheapResults.length, candidates.length);
  assert.equal(topKResults.length, smartScopeV2Constants.TOP_K);
  assert.equal(innerTextHits, smartScopeV2Constants.TOP_K, 'innerText should be read only for TOP_K candidates');
});

test('selectTopK handles near-equal centerDist without unstable float comparisons', () => {
  const candidates = [
    {
      el: { id: 'first' },
      domIndex: 0,
      m: { area: 1000, textLen: 100, pCount: 1, linkCount: 0, linkTextLen: 0, mediaCount: 0, centerDist: 0.5 },
    },
    {
      el: { id: 'second' },
      domIndex: 1,
      m: { area: 1000, textLen: 100, pCount: 1, linkCount: 0, linkTextLen: 0, mediaCount: 0, centerDist: 0.5005 },
    },
  ];

  const [first, second] = selectTopK(candidates, 2);

  assert.equal(first.el.id, 'first');
  assert.equal(second.el.id, 'second');
});

test('detectScopeRootV2 picks branch C for media-heavy candidate with confidence', async () => {
  const mediaNodes = Array.from({ length: 12 }, () => ({ tagName: 'img' }));
  const mediaEl = {
    tagName: 'div',
    textContent: 'gallery',
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    querySelectorAll: (selector) => {
      if (selector === 'img, video, picture, figure') return mediaNodes;
      if (selector === 'a') return [];
      return [];
    },
  };

  const textEl = {
    tagName: 'article',
    textContent: 'text'.repeat(500),
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 400, height: 400, left: 100, top: 100 }),
    querySelectorAll: (selector) => {
      if (selector === 'a') return [];
      if (selector === 'img, video, picture, figure') return [];
      if (selector === 'p') return Array.from({ length: 4 }, () => ({}));
      return [];
    },
  };

  const doc = { querySelectorAll: () => [mediaEl, textEl] };
  const result = await detectScopeRootV2({ doc, budgetMs: 200, now: () => 0 });

  assert.equal(result.ok, true);
  assert.equal(result.branch, 'C');
  assert.equal(result.scopeEl, mediaEl);
});

test('ambiguity gating returns NONE when score gap is too small', async () => {
  const baseEl = {
    tagName: 'section',
    textContent: 'lorem '.repeat(80),
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 500, height: 500, left: 0, top: 0 }),
    querySelectorAll: (selector) => {
      if (selector === 'a') return [];
      if (selector === 'p') return Array.from({ length: 3 }, () => ({}));
      if (selector === 'img, video, picture, figure') return [];
      return [];
    },
  };

  const doc = { querySelectorAll: () => [baseEl, { ...baseEl }] };
  const result = await detectScopeRootV2({ doc, budgetMs: 200, now: () => 0 });

  assert.equal(result.ok, false);
  assert.equal(result.scopeEl, null);
  assert.equal(result.branch, 'NONE');
});

test('detectScopeRootV2 is deterministic for same DOM inputs', async () => {
  const elA = {
    tagName: 'main',
    textContent: 'a'.repeat(800),
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 700, height: 500, left: 0, top: 0 }),
    querySelectorAll: (selector) => {
      if (selector === 'a') return [];
      if (selector === 'p') return Array.from({ length: 5 }, () => ({}));
      if (selector === 'img, video, picture, figure') return [];
      return [];
    },
  };

  const elB = {
    tagName: 'section',
    textContent: 'short',
    ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 900, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 300, height: 200, left: 200, top: 200 }),
    querySelectorAll: () => [],
  };

  const doc = { querySelectorAll: () => [elB, elA] };

  const first = await detectScopeRootV2({ doc, budgetMs: 200, now: () => 0 });
  const second = await detectScopeRootV2({ doc, budgetMs: 200, now: () => 0 });

  assert.equal(first.ok, true);
  assert.equal(first.scopeEl, elA);
  assert.equal(second.scopeEl, elA);
  assert.equal(first.branch, second.branch);
});

test('verifyFinalScopeEl rejects html/body as final scope', async () => {
  const bodyEl = {
    tagName: 'body',
    textContent: 'content'.repeat(200),
    ownerDocument: { defaultView: { innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ display: 'block', visibility: 'visible', position: 'static' }) } },
    getBoundingClientRect: () => ({ width: 1200, height: 900, left: 0, top: 0 }),
    querySelectorAll: (selector) => {
      if (selector === 'a') return [];
      if (selector === 'p') return Array.from({ length: 4 }, () => ({}));
      if (selector === 'img, video, picture, figure') return Array.from({ length: 10 }, () => ({}));
      return [];
    },
  };

  const doc = { querySelectorAll: () => [bodyEl] };
  const result = await detectScopeRootV2({ doc, budgetMs: 200, now: () => 0 });

  assert.equal(result.ok, false);
  assert.equal(result.scopeEl, null);
  assert.equal(result.branch, 'NONE');
});
