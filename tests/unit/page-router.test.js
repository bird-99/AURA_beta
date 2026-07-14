import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  PAGE_TYPES,
  PROBLEM_CODES,
  REASON_CODES,
  routePageSignalsV1,
  validatePageUnderstandingProfileV1,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readFixtures() {
  return fs.readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.signals.v1.json'))
    .map((file) => {
      const filePath = path.join(fixtureDir, file);
      return { file, payload: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    });
}

function messages(validation) {
  return validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

function riskBand(value) {
  if (value < 0.34) return 'LOW';
  if (value >= 0.65) return 'HIGH';
  return 'MEDIUM';
}

function observedNodeSignalsFixtureFor(input) {
  return {
    version: 2,
    collectionMode: 'BLOCK_SUMMARY',
    readiness: {
      documentReadyState: 'complete',
      lateLoadLikely: false,
      layoutStableHint: true,
    },
    coverage: {
      blocksObserved: input.blocks.length,
      blocksWithSignals: input.blocks.length,
      candidatesSeen: input.stats.candidatesSeen,
      nodesSampled: input.stats.nodesScanned,
      elapsedMs: input.stats.elapsedMs,
      v2Coverage: input.blocks.length ? 1 : 0,
      budgetHit: input.stats.budgetHit,
      partial: input.stats.budgetHit,
    },
    blockSignals: input.blocks.map((block) => ({
      blockId: block.blockId,
      rectBuckets: { x: 1, y: 1, w: 5, h: 5 },
      visibleAreaBucket: 5,
      viewportIntersectionBucket: 8,
      sameRowHint: false,
      sameColumnHint: false,
      verticalAdjacencyHint: false,
      repeatedSiblingShapeHint: block.roleHint === 'CARD',
      siblingIndexBucket: 0,
      siblingCountBucket: 1,
      formControlDensityBucket: 0,
      linkDensityBucket: 0,
      mediaControlSeparationHint: false,
      headingHint: false,
      listHint: false,
      cardHint: block.roleHint === 'CARD',
      centralityBucket: 5,
    })),
  };
}

function assertFixtureProfile(file, payload, profile) {
  const validation = validatePageUnderstandingProfileV1(profile);
  assert.equal(validation.ok, true, `${file} profile validation failed: ${messages(validation)}`);
  assert.equal(validatePrivacySafeJson(profile).ok, true, `${file} profile should be privacy-safe`);
  assert.equal(profile.pageType, payload.expected.pageType, `${file} pageType`);
  assert.equal(
    profile.pageTypeConfidence >= payload.expected.minConfidence
      && profile.pageTypeConfidence <= payload.expected.maxConfidence,
    true,
    `${file} confidence ${profile.pageTypeConfidence} outside expected range`,
  );

  for (const reason of payload.expected.requiredReasons || []) {
    assert.equal(profile.reasons.includes(reason), true, `${file} missing reason ${reason}`);
  }

  for (const problem of payload.expected.requiredProblems || []) {
    assert.equal(
      profile.problems.some((entry) => entry.code === problem),
      true,
      `${file} missing problem ${problem}`,
    );
  }
  for (const problem of payload.expected.forbiddenProblems || []) {
    assert.equal(
      profile.problems.some((entry) => entry.code === problem),
      false,
      `${file} should not report problem ${problem}`,
    );
  }
  for (const reason of payload.expected.forbiddenReasons || []) {
    assert.equal(profile.reasons.includes(reason), false, `${file} should not report reason ${reason}`);
  }

  for (const [riskKey, expectedBand] of Object.entries(payload.expected.riskBands || {})) {
    assert.equal(riskBand(profile.risk[riskKey]), expectedBand, `${file} ${riskKey}`);
  }

  if (payload.expected.selectedScopeBlockId === null) {
    assert.equal(profile.selectedScope, null, `${file} selectedScope should be null`);
  } else {
    assert.equal(profile.selectedScope?.blockId, payload.expected.selectedScopeBlockId, `${file} selectedScope`);
    const inputBlock = payload.input.blocks.find((block) => block.blockId === profile.selectedScope.blockId);
    assert.ok(inputBlock, `${file} selectedScope must reference input block`);
    assert.equal(profile.selectedScope.roleHint, inputBlock.roleHint, `${file} selectedScope role`);
  }
}

test('page router turns fixture signals into PageUnderstandingProfileV1', () => {
  for (const { file, payload } of readFixtures()) {
    const inputBefore = clone(payload.input);
    const profile = routePageSignalsV1(payload.input);

    assertFixtureProfile(file, payload, profile);
    assert.deepEqual(payload.input, inputBefore, `${file} input should not be mutated`);
  }
});

test('page router is deterministic for the same signal DTO', () => {
  for (const { payload } of readFixtures()) {
    const first = routePageSignalsV1(payload.input);
    const second = routePageSignalsV1(payload.input);
    assert.deepEqual(second, first);
  }
});

test('page router ignores optional ObservedNodeSignalsV2 metadata', () => {
  for (const { file, payload } of readFixtures()) {
    const baseline = routePageSignalsV1(payload.input);
    const enriched = clone(payload.input);
    enriched.observedNodeSignalsV2 = observedNodeSignalsFixtureFor(enriched);

    assert.deepEqual(routePageSignalsV1(enriched), baseline, `${file} profile should ignore ObservedNodeSignalsV2`);
  }
});

test('page router keeps page type stable across metadata-only fixture changes', () => {
  for (const { file, payload } of readFixtures()) {
    const changed = clone(payload.input);
    changed.collectionEpoch = 'aura_pse_collection_renamed_v1';
    changed.routeEpoch = 'aura_pse_route_renamed_v1';
    changed.blocks = changed.blocks.map((block, index) => ({
      ...block,
      blockId: `renamed_${index}`,
    }));
    changed.blocks.push({
      blockId: 'neutral_extra',
      roleHint: 'UNKNOWN',
      rectRatio: { xRatio: 0, yRatio: 0, widthRatio: 0.1, heightRatio: 0.1, visibleRatio: 0.5 },
      metrics: {
        textDensity: 0.05,
        linkDensity: 0.05,
        interactiveDensity: 0.02,
        mediaDensity: 0,
        formDensity: 0,
        tableDensity: 0,
        viewportCoverage: 0.01,
      },
      flags: [],
    });

    const profile = routePageSignalsV1(changed);
    assert.equal(profile.pageType, payload.expected.pageType, `${file} pageType should not depend on route/block ids`);
    for (const reason of payload.expected.requiredReasons || []) {
      assert.equal(profile.reasons.includes(reason), true, `${file} missing reason after metadata change`);
    }
  }
});

test('page router synthesizes video typography risk from runtime-style video signals', () => {
  const video = clone(readFixtures().find(({ payload }) => payload.name === 'video-watch').payload.input);
  video.blocks[0].flags = [REASON_CODES.VIDEO_MEDIA_DENSITY_HIGH];

  const profile = routePageSignalsV1(video);

  assert.equal(profile.pageType, PAGE_TYPES.VIDEO);
  assert.equal(profile.reasons.includes(REASON_CODES.VIDEO_PAGE_TYPOGRAPHY_BLOCKED), true);
});

test('page router reports low confidence and modal problems on unknown shells', () => {
  const unknown = clone(readFixtures().find(({ payload }) => payload.name === 'unknown').payload.input);
  const profile = routePageSignalsV1(unknown);

  assert.equal(profile.pageType, PAGE_TYPES.UNKNOWN);
  assert.equal(profile.selectedScope, null);
  assert.equal(profile.problems.some((problem) => problem.code === PROBLEM_CODES.LOW_CONFIDENCE_PAGE_TYPE), true);
  assert.equal(profile.problems.some((problem) => problem.code === PROBLEM_CODES.MODAL_OVERLAY_PRESENT), true);
});
