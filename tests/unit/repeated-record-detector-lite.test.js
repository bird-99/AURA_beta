import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PAGE_TYPES,
  TARGET_KINDS,
  buildRegionInventoryV1,
  buildRepeatedRecordGroupsV1,
  buildVisualRegionGraphLiteV1,
  routePageSignalsV1,
  validatePrivacySafeJson,
  validateRepeatedRecordGroupsV1,
} from '../../shared/engine-core/index.js';
import { readPageIntelligenceFixtures } from '../../scripts/page-understanding-quality-report.mjs';

function fixture(name) {
  const entry = readPageIntelligenceFixtures().find((item) => item.name === name);
  assert.ok(entry, `${name} fixture should exist`);
  return entry;
}

function repeatedFor(name) {
  const entry = fixture(name);
  const profile = routePageSignalsV1(entry.input);
  const inventory = buildRegionInventoryV1(profile);
  const graph = buildVisualRegionGraphLiteV1(profile, { signals: entry.input, inventory });
  return {
    entry,
    profile,
    graph,
    repeated: buildRepeatedRecordGroupsV1(profile, { graph }),
  };
}

test('RepeatedRecordGroupsV1 detects search, product and feed record groups', () => {
  for (const name of ['search-results', 'product-grid', 'feed']) {
    const { repeated } = repeatedFor(name);
    assert.equal(validateRepeatedRecordGroupsV1(repeated).ok, true, name);
    assert.equal(validatePrivacySafeJson(repeated).ok, true, name);
    assert.equal(repeated.groups.length >= 1, true, `${name} should have repeated record evidence`);
    assert.equal(repeated.groups[0].targetKind, TARGET_KINDS.RECORD_REGION);
    assert.equal(repeated.groups[0].sourceBlockIds.length >= 1, true);
    assert.equal(repeated.groups[0].sourceBlockIds.length <= 3, true);
    assert.equal(repeated.groups[0].confidence > 0.5, true);
    assert.equal(repeated.groups[0].metrics.memberCountBucket >= 1, true);
  }
});

test('RepeatedRecordGroupsV1 does not create record groups for form, dashboard, video or unknown pages', () => {
  for (const name of ['form-simple', 'dashboard', 'video-watch', 'unknown']) {
    const { profile, repeated } = repeatedFor(name);
    assert.equal(validateRepeatedRecordGroupsV1(repeated).ok, true, name);
    assert.equal([PAGE_TYPES.FORM, PAGE_TYPES.DASHBOARD, PAGE_TYPES.VIDEO, PAGE_TYPES.UNKNOWN].includes(profile.pageType), true);
    assert.equal(repeated.groups.length, 0, `${name} should not create repeated record groups`);
  }
});

test('RepeatedRecordGroupsV1 is deterministic and bounded', () => {
  const { profile, graph } = repeatedFor('product-grid');
  const first = buildRepeatedRecordGroupsV1(profile, { graph });
  const second = buildRepeatedRecordGroupsV1(profile, { graph });

  assert.deepEqual(second, first);
  assert.equal(first.groups.length <= 8, true);
  assert.equal(first.groups.every((group) => group.sourceBlockIds.length <= 3), true);
});

test('RepeatedRecordGroupsV1 validator rejects unsafe and oversized payloads', () => {
  const { repeated } = repeatedFor('search-results');

  assert.equal(validateRepeatedRecordGroupsV1({ ...repeated, rawText: 'private text' }).ok, false);
  assert.equal(validateRepeatedRecordGroupsV1({
    ...repeated,
    groups: [{ ...repeated.groups[0], selector: 'main' }],
  }).ok, false);
  assert.equal(validateRepeatedRecordGroupsV1({
    ...repeated,
    groups: Array.from({ length: 9 }, (_, index) => ({ ...repeated.groups[0], groupId: `rrg${index + 1}` })),
  }).ok, false);
  assert.equal(validateRepeatedRecordGroupsV1({
    ...repeated,
    groups: [{ ...repeated.groups[0], sourceBlockIds: ['not-a-block'] }],
  }).ok, false);
});

