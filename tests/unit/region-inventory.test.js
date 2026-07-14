import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PAGE_TYPES,
  TARGET_KINDS,
  buildRepeatedRecordGroupsV1,
  buildRegionInventoryV1,
  buildVisualRegionGraphLiteV1,
  countRegionsByTargetKind,
  routePageSignalsV1,
  validatePrivacySafeJson,
  validateRegionInventoryV1,
} from '../../shared/engine-core/index.js';
import { readPageIntelligenceFixtures } from '../../scripts/page-understanding-quality-report.mjs';

function profileFor(name) {
  const fixture = readPageIntelligenceFixtures().find((entry) => entry.name === name);
  assert.ok(fixture, `${name} fixture should exist`);
  return routePageSignalsV1(fixture.input);
}

function pr9InventoryFor(name) {
  const fixture = readPageIntelligenceFixtures().find((entry) => entry.name === name);
  assert.ok(fixture, `${name} fixture should exist`);
  const profile = routePageSignalsV1(fixture.input);
  const baseInventory = buildRegionInventoryV1(profile);
  const graph = buildVisualRegionGraphLiteV1(profile, { signals: fixture.input, inventory: baseInventory });
  const repeatedRecordGroups = buildRepeatedRecordGroupsV1(profile, { graph });
  return {
    profile,
    graph,
    repeatedRecordGroups,
    inventory: buildRegionInventoryV1(profile, { visualGraph: graph, repeatedRecordGroups }),
  };
}

function inventoryFor(name) {
  return buildRegionInventoryV1(profileFor(name));
}

test('RegionInventoryV1 validates every page-intelligence fixture', () => {
  for (const fixture of readPageIntelligenceFixtures()) {
    const profile = routePageSignalsV1(fixture.input);
    const inventory = buildRegionInventoryV1(profile);

    assert.equal(validateRegionInventoryV1(inventory).ok, true, fixture.name);
    assert.equal(validatePrivacySafeJson(inventory).ok, true, fixture.name);
    assert.equal(inventory.version, 1);
    assert.equal(inventory.frameId, profile.frameId);
    assert.equal(inventory.pageType, profile.pageType);
    assert.equal(inventory.stats.regionsSeen, inventory.regions.length);
  }
});

test('RegionInventoryV1 maps representative page types to compact target kinds', () => {
  assert.equal(countRegionsByTargetKind(inventoryFor('article'))[TARGET_KINDS.READING_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('doc'))[TARGET_KINDS.READING_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('search-results'))[TARGET_KINDS.RECORD_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('product-grid'))[TARGET_KINDS.RECORD_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('feed'))[TARGET_KINDS.RECORD_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('form'))[TARGET_KINDS.FORM_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('dashboard'))[TARGET_KINDS.DASHBOARD_REGION], 1);
  assert.equal(countRegionsByTargetKind(inventoryFor('video-watch'))[TARGET_KINDS.MEDIA_REGION], 1);
});

test('RegionInventoryV1 can use PR9 repeated graph evidence without changing DTO shape', () => {
  for (const name of ['search-results', 'product-grid', 'feed']) {
    const { inventory, repeatedRecordGroups } = pr9InventoryFor(name);
    const record = inventory.regions.find((region) => region.targetKind === TARGET_KINDS.RECORD_REGION);

    assert.ok(record, `${name} should expose record region`);
    assert.equal(repeatedRecordGroups.groups.length >= 1, true, `${name} should have repeated record evidence`);
    assert.equal(record.reasons.some((reason) => [
      'SEARCH_RESULTS_STRUCTURE_DETECTED',
      'SHOP_PRODUCT_GRID_DETECTED',
      'FEED_CARD_REPETITION_DETECTED',
    ].includes(reason)), true);
    assert.equal(validateRegionInventoryV1(inventory).ok, true);
  }

  const form = pr9InventoryFor('form-simple');
  assert.equal(countRegionsByTargetKind(form.inventory)[TARGET_KINDS.FORM_REGION], 1);
  assert.equal(form.repeatedRecordGroups.groups.length, 0);
});

test('RegionInventoryV1 keeps unknown pages as baseline abstention without synthetic regions', () => {
  const profile = profileFor('unknown');
  const inventory = buildRegionInventoryV1(profile);
  const pr9 = pr9InventoryFor('unknown');

  assert.equal(profile.pageType, PAGE_TYPES.UNKNOWN);
  assert.equal(inventory.regions.length, 0);
  assert.equal(inventory.stats.regionsSeen, 0);
  assert.equal(pr9.inventory.regions.length, 0);
});

test('RegionInventoryV1 rejects runtime and privacy-shaped payloads', () => {
  const inventory = inventoryFor('article');

  assert.equal(validateRegionInventoryV1({ ...inventory, selector: 'main' }).ok, false);
  assert.equal(validateRegionInventoryV1({
    ...inventory,
    regions: [{ ...inventory.regions[0], node: { nodeType: 1, tagName: 'MAIN' } }],
  }).ok, false);
});
