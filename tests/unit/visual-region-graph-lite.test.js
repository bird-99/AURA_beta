import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLOCK_ROLES,
  PAGE_TYPES,
  TARGET_KINDS,
  buildRegionInventoryV1,
  buildVisualRegionGraphLiteV1,
  routePageSignalsV1,
  validatePrivacySafeJson,
  validateVisualRegionGraphLiteV1,
} from '../../shared/engine-core/index.js';
import { readPageIntelligenceFixtures } from '../../scripts/page-understanding-quality-report.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(name) {
  const entry = readPageIntelligenceFixtures().find((item) => item.name === name);
  assert.ok(entry, `${name} fixture should exist`);
  return entry;
}

function graphFor(name) {
  const entry = fixture(name);
  const profile = routePageSignalsV1(entry.input);
  const inventory = buildRegionInventoryV1(profile);
  return {
    entry,
    profile,
    graph: buildVisualRegionGraphLiteV1(profile, { signals: entry.input, inventory }),
  };
}

test('VisualRegionGraphLiteV1 validates fixture-derived compact graphs', () => {
  for (const entry of readPageIntelligenceFixtures()) {
    const profile = routePageSignalsV1(entry.input);
    const inventory = buildRegionInventoryV1(profile);
    const graph = buildVisualRegionGraphLiteV1(profile, { signals: entry.input, inventory });

    assert.equal(validateVisualRegionGraphLiteV1(graph).ok, true, entry.name);
    assert.equal(validatePrivacySafeJson(graph).ok, true, entry.name);
    assert.equal(graph.version, 1);
    assert.equal(graph.frameId, profile.frameId);
    assert.equal(graph.pageType, profile.pageType);
    assert.equal(graph.nodes.length <= 12, true);
    assert.equal(graph.edges.length <= 48, true);
    assert.equal(graph.groups.length <= 8, true);
  }
});

test('VisualRegionGraphLiteV1 is deterministic and does not mutate inputs', () => {
  const entry = fixture('search-results');
  const profile = routePageSignalsV1(entry.input);
  const inventory = buildRegionInventoryV1(profile);
  const beforeProfile = clone(profile);
  const beforeInput = clone(entry.input);

  const first = buildVisualRegionGraphLiteV1(profile, { signals: entry.input, inventory });
  const second = buildVisualRegionGraphLiteV1(profile, { signals: entry.input, inventory });

  assert.deepEqual(second, first);
  assert.deepEqual(profile, beforeProfile);
  assert.deepEqual(entry.input, beforeInput);
});

test('VisualRegionGraphLiteV1 builds record, form and guarded page nodes without changing page semantics', () => {
  const search = graphFor('search-results');
  const form = graphFor('form-simple');
  const dashboard = graphFor('dashboard');
  const video = graphFor('video-watch');
  const unknown = graphFor('unknown');

  assert.equal(search.graph.nodes.some((node) => node.targetKind === TARGET_KINDS.RECORD_REGION), true);
  assert.equal(search.graph.groups.some((group) => group.type === 'REPEATED_RECORDS'), true);
  assert.equal(form.graph.nodes.some((node) => node.targetKind === TARGET_KINDS.FORM_REGION), true);
  assert.equal(form.graph.groups.some((group) => group.type === 'REPEATED_RECORDS'), false);
  assert.equal(dashboard.profile.pageType, PAGE_TYPES.DASHBOARD);
  assert.equal(dashboard.graph.nodes.some((node) => node.targetKind === TARGET_KINDS.DASHBOARD_REGION), true);
  assert.equal(video.profile.pageType, PAGE_TYPES.VIDEO);
  assert.equal(video.graph.nodes.some((node) => node.targetKind === TARGET_KINDS.MEDIA_REGION), true);
  assert.equal(unknown.profile.pageType, PAGE_TYPES.UNKNOWN);
  assert.equal(unknown.graph.nodes.every((node) => node.targetKind === TARGET_KINDS.BASELINE_OR_ABSTAIN), true);
});

test('VisualRegionGraphLiteV1 caps graph size under large candidate sets', () => {
  const base = graphFor('feed');
  const manyCandidates = Array.from({ length: 40 }, (_, index) => ({
    ...base.profile.candidates[0],
    blockId: `b${index + 1}`,
    roleHint: BLOCK_ROLES.CARD,
  }));
  const profile = {
    ...base.profile,
    candidates: manyCandidates,
  };
  const inventory = {
    version: 1,
    frameId: profile.frameId,
    pageType: profile.pageType,
    regions: [],
    stats: { regionsSeen: 0, budgetHit: false },
  };
  const graph = buildVisualRegionGraphLiteV1(profile, { inventory });

  assert.equal(validateVisualRegionGraphLiteV1(graph).ok, true);
  assert.equal(graph.nodes.length, 12);
  assert.equal(graph.edges.length <= 48, true);
  assert.equal(graph.groups.length <= 8, true);
  assert.equal(graph.stats.budgetHit, true);
});

test('VisualRegionGraphLiteV1 validator rejects unsafe, oversized and incoherent graphs', () => {
  const { graph } = graphFor('article');
  assert.equal(validateVisualRegionGraphLiteV1({ ...graph, selector: 'main' }).ok, false);
  assert.equal(validateVisualRegionGraphLiteV1({
    ...graph,
    nodes: [{ ...graph.nodes[0], element: { nodeType: 1, tagName: 'MAIN' } }],
  }).ok, false);
  assert.equal(validateVisualRegionGraphLiteV1({
    ...graph,
    nodes: Array.from({ length: 13 }, (_, index) => ({ ...graph.nodes[0], nodeId: `n${index + 1}`, sourceBlockId: `b${index + 1}` })),
  }).ok, false);
  assert.equal(validateVisualRegionGraphLiteV1({
    ...graph,
    edges: [{ from: 'n1', to: 'n404', type: 'SAME_ROW', weight: 0.5, reasons: ['TOP_CANDIDATES_AMBIGUOUS'] }],
  }).ok, false);
  assert.equal(validateVisualRegionGraphLiteV1({
    ...graph,
    edges: [
      { from: 'n1', to: 'n2', type: 'SAME_ROW', weight: 0.5, reasons: ['TOP_CANDIDATES_AMBIGUOUS'] },
      { from: 'n1', to: 'n2', type: 'SAME_ROW', weight: 0.5, reasons: ['TOP_CANDIDATES_AMBIGUOUS'] },
    ],
    nodes: [
      graph.nodes[0],
      { ...graph.nodes[0], nodeId: 'n2', sourceBlockId: 'b2' },
    ],
  }).ok, false);
});
