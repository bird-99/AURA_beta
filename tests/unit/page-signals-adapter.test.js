import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BLOCK_ROLES,
  REASON_CODES,
  TARGET_KINDS,
  validateCollectedPageSignalsV1,
  validateObservedNodeSignalsV2,
  validatePrivacySafeJson,
  validateRegionTargetValidationRequestV1,
  validateRegionTargetValidationResultV1,
} from '../../shared/engine-core/index.js';
import {
  FakeDocument,
  FakeElement,
  buildArticleDocument,
  buildMixedDocument,
  walkElements,
} from '../fixtures/page-intelligence/fake-dom.js';

const adapterPath = path.join(process.cwd(), 'content', 'page-signals-adapter.runtime.js');

async function loadAdapter() {
  delete globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
  await import(`${pathToFileURL(adapterPath).toString()}?v=${Date.now()}-${Math.random()}`);
  return globalThis.AURA_PAGE_SIGNALS_ADAPTER_V1;
}

function validationMessages(validation) {
  return validation.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

test('page signals adapter exposes a read-only DTO collector', async () => {
  const adapter = await loadAdapter();
  assert.equal(typeof adapter?.collectPageSignalsV1, 'function');

  const signals = adapter.collectPageSignalsV1({
    doc: buildArticleDocument(),
    now: () => 10,
    frameId: 2,
  });
  const validation = validateCollectedPageSignalsV1(signals);

  assert.equal(validation.ok, true, validationMessages(validation));
  assert.equal(signals.schemaVersion, 1);
  assert.equal(signals.frameId, 2);
  assert.match(signals.collectionEpoch, /^aura_pse_collection_/);
  assert.match(signals.routeEpoch, /^aura_pse_route_/);
  assert.equal(signals.blocks[0].roleHint, BLOCK_ROLES.PRIMARY_CONTENT);
  assert.ok(signals.blocks[0].flags.includes(REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH));
  assert.ok(signals.blocks[0].flags.includes(REASON_CODES.DOC_STRUCTURE_DETECTED));
  assert.equal(signals.observedNodeSignalsV2.version, 2);
  assert.equal(signals.observedNodeSignalsV2.collectionMode, 'BLOCK_SUMMARY');
  assert.equal(validateObservedNodeSignalsV2(signals.observedNodeSignalsV2).ok, true);
  assert.equal(signals.observedNodeSignalsV2.blockSignals[0].blockId, signals.blocks[0].blockId);
  assert.equal(signals.observedNodeSignalsV2.blockSignals[0].headingHint, true);
  assert.equal(signals.observedNodeSignalsV2.blockSignals[0].rectBuckets.w >= 0, true);
  assert.equal(signals.observedNodeSignalsV2.blockSignals[0].rectBuckets.w <= 10, true);
});

test('page signals adapter validates a still-live registered target locally', async () => {
  const adapter = await loadAdapter();
  const doc = buildArticleDocument();
  const signals = adapter.collectPageSignalsV1({ doc, now: () => 10, frameId: 4 });

  const request = {
    schemaVersion: 1,
    frameId: 4,
    collectionEpoch: signals.collectionEpoch,
    routeEpoch: signals.routeEpoch,
    sourceBlockId: signals.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  };
  const result = adapter.validateRegionTargetV1(request, { doc });

  assert.equal(validateRegionTargetValidationRequestV1(request).ok, true);
  assert.equal(validateRegionTargetValidationResultV1(result).ok, true);
  assert.deepEqual(result, {
    schemaVersion: 1,
    ok: true,
    reason: 'OK',
    sameEpoch: true,
    stillConnected: true,
    stillVisible: true,
    roleHintStillMatches: true,
    confidence: 1,
    frameId: 4,
  });
});

test('page signals adapter fails closed for stale, missing and frame-mismatched targets', async () => {
  const adapter = await loadAdapter();
  const doc = buildArticleDocument();
  const first = adapter.collectPageSignalsV1({ doc, now: () => 10, frameId: 1 });
  adapter.collectPageSignalsV1({ doc, now: () => 20, frameId: 1 });

  const stale = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 1,
    collectionEpoch: first.collectionEpoch,
    routeEpoch: first.routeEpoch,
    sourceBlockId: first.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'TARGET_STALE');
  assert.equal(stale.sameEpoch, false);

  const current = adapter.collectPageSignalsV1({ doc, now: () => 30, frameId: 1 });
  const missing = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 1,
    collectionEpoch: current.collectionEpoch,
    routeEpoch: current.routeEpoch,
    sourceBlockId: 'b999',
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'TARGET_NOT_FOUND');
  assert.equal(missing.sameEpoch, true);

  const frameMismatch = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 2,
    collectionEpoch: current.collectionEpoch,
    routeEpoch: current.routeEpoch,
    sourceBlockId: current.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(frameMismatch.ok, false);
  assert.equal(frameMismatch.reason, 'FRAME_MISMATCH');

  const missingFrame = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    collectionEpoch: current.collectionEpoch,
    routeEpoch: current.routeEpoch,
    sourceBlockId: current.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(missingFrame.ok, false);
  assert.equal(missingFrame.reason, 'INVALID_REQUEST');

  const negativeFrame = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: -1,
    collectionEpoch: current.collectionEpoch,
    routeEpoch: current.routeEpoch,
    sourceBlockId: current.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(negativeFrame.ok, false);
  assert.equal(negativeFrame.reason, 'INVALID_REQUEST');

  const fractionalFrame = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 0.4,
    collectionEpoch: current.collectionEpoch,
    routeEpoch: current.routeEpoch,
    sourceBlockId: current.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });
  assert.equal(fractionalFrame.ok, false);
  assert.equal(fractionalFrame.reason, 'INVALID_REQUEST');
});

test('page signals adapter treats hash route changes as stale and clears live handles', async () => {
  const adapter = await loadAdapter();
  const doc = buildArticleDocument();
  const signals = adapter.collectPageSignalsV1({ doc, now: () => 10, frameId: 0 });
  doc.location.hash = '#next-view';

  const stale = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: signals.collectionEpoch,
    routeEpoch: signals.routeEpoch,
    sourceBlockId: signals.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'TARGET_STALE');
  assert.equal(stale.sameEpoch, false);

  const recollected = adapter.collectPageSignalsV1({ doc, now: () => 20, frameId: 0 });
  assert.notEqual(recollected.routeEpoch, signals.routeEpoch);
  assert.notEqual(recollected.collectionEpoch, signals.collectionEpoch);
});

test('page signals adapter clearTargetRegistry invalidates collected targets', async () => {
  const adapter = await loadAdapter();
  const doc = buildArticleDocument();
  const signals = adapter.collectPageSignalsV1({ doc, now: () => 10, frameId: 0 });
  adapter.clearTargetRegistry();

  const stale = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: signals.collectionEpoch,
    routeEpoch: signals.routeEpoch,
    sourceBlockId: signals.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc });

  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'TARGET_STALE');
});

test('page signals adapter fails closed for detached or hidden targets', async () => {
  const adapter = await loadAdapter();
  const detachedDoc = buildArticleDocument();
  const detachedSignals = adapter.collectPageSignalsV1({ doc: detachedDoc, now: () => 10, frameId: 0 });
  const detachedTarget = detachedDoc.querySelector('main');
  detachedDoc.body.children = detachedDoc.body.children.filter((child) => child !== detachedTarget);
  detachedTarget.parentNode = null;

  const detached = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: detachedSignals.collectionEpoch,
    routeEpoch: detachedSignals.routeEpoch,
    sourceBlockId: detachedSignals.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc: detachedDoc });
  assert.equal(detached.ok, false);
  assert.equal(detached.reason, 'TARGET_DETACHED');
  assert.equal(detached.stillConnected, false);

  const hiddenDoc = buildArticleDocument();
  const hiddenSignals = adapter.collectPageSignalsV1({ doc: hiddenDoc, now: () => 20, frameId: 0 });
  hiddenDoc.querySelector('main')._style.display = 'none';

  const hidden = adapter.validateRegionTargetV1({
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: hiddenSignals.collectionEpoch,
    routeEpoch: hiddenSignals.routeEpoch,
    sourceBlockId: hiddenSignals.blocks[0].blockId,
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  }, { doc: hiddenDoc });
  assert.equal(hidden.ok, false);
  assert.equal(hidden.reason, 'TARGET_HIDDEN');
  assert.equal(hidden.stillVisible, false);
});

test('region target validation DTOs reject unsafe payloads', () => {
  const validRequest = {
    schemaVersion: 1,
    frameId: 0,
    collectionEpoch: 'aura_pse_collection_1',
    routeEpoch: 'aura_pse_route_1',
    sourceBlockId: 'b1',
    expectedTargetKind: TARGET_KINDS.READING_REGION,
  };
  const validResult = {
    schemaVersion: 1,
    ok: false,
    reason: 'TARGET_STALE',
    sameEpoch: false,
    stillConnected: false,
    stillVisible: false,
    roleHintStillMatches: false,
    confidence: 0,
    frameId: 0,
  };

  assert.equal(validateRegionTargetValidationRequestV1(validRequest).ok, true);
  assert.equal(validateRegionTargetValidationResultV1(validResult).ok, true);
  assert.equal(validateRegionTargetValidationRequestV1({ ...validRequest, selector: 'main' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...validRequest, rawText: 'private text' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...validRequest, url: 'https://private.example/' }).ok, false);
  assert.equal(validateRegionTargetValidationRequestV1({ ...validRequest, handle: { nodeType: 1, tagName: 'MAIN' } }).ok, false);
  assert.equal(validateRegionTargetValidationResultV1({ ...validResult, rect: { x: 0, y: 0, width: 1, height: 1 } }).ok, false);
});

test('page signals adapter derives compact media, form and table signals without handles', async () => {
  const adapter = await loadAdapter();
  const signals = adapter.collectPageSignalsV1({
    doc: buildMixedDocument(),
    now: () => 20,
    routeFingerprint: 'https://example.test/private-route',
  });
  const validation = validateCollectedPageSignalsV1(signals);

  assert.equal(validation.ok, true, validationMessages(validation));
  assert.equal(signals.pageHints.urlKind, 'VIDEO');
  assert.equal(signals.pageHints.formCount, 1);
  assert.equal(signals.pageHints.tableCount, 1);
  assert.ok(signals.blocks.some((block) => block.roleHint === BLOCK_ROLES.PLAYER));
  assert.ok(signals.blocks.some((block) => block.roleHint === BLOCK_ROLES.FORM));
  assert.ok(signals.blocks.some((block) => block.roleHint === BLOCK_ROLES.TABLE));
  assert.equal(validatePrivacySafeJson(signals).ok, true);
  const serialized = JSON.stringify(signals);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private'), false);
  assert.equal(serialized.includes('?'), false);
  assert.equal(serialized.includes('#'), false);
  assert.equal(serialized.includes('PRIVATE_'), false);
  assert.equal(serialized.includes('href'), false);
  assert.equal(serialized.includes('src'), false);
  assert.equal('routeFingerprint' in signals, false);
  assert.equal(signals.observedNodeSignalsV2.blockSignals.some((block) => block.formControlDensityBucket > 0), true);
  assert.equal(signals.observedNodeSignalsV2.blockSignals.some((block) => block.mediaControlSeparationHint === true), true);
});

test('page signals adapter counts compact small targets using width or height below 24px', async () => {
  const adapter = await loadAdapter();
  const body = new FakeElement('body');
  const form = body.appendChild(new FakeElement('form', {
    rect: { left: 0, top: 0, width: 420, height: 180 },
  }));
  form.appendChild(new FakeElement('button', {
    text: 'wide low control',
    rect: { left: 10, top: 10, width: 160, height: 18 },
  }));
  form.appendChild(new FakeElement('button', {
    text: 'tall narrow control',
    rect: { left: 180, top: 10, width: 18, height: 60 },
  }));
  form.appendChild(new FakeElement('button', {
    text: 'large control',
    rect: { left: 210, top: 10, width: 80, height: 40 },
  }));
  const doc = new FakeDocument(body, { pathname: '/contact', search: '' });

  const signals = adapter.collectPageSignalsV1({ doc, now: () => 20 });
  const validation = validateCollectedPageSignalsV1(signals);

  assert.equal(validation.ok, true, validationMessages(validation));
  assert.equal(signals.pageHints.formCount, 1);
  assert.equal(signals.pageHints.smallTargetCount, 2);
});

test('page signals adapter enforces caps and reports budget hits', async () => {
  const adapter = await loadAdapter();
  const body = new FakeElement('body');
  for (let index = 0; index < 30; index += 1) {
    body.appendChild(new FakeElement('section', {
      text: 'x'.repeat(300),
      rect: { left: 0, top: index * 10, width: 300, height: 120 },
    }));
  }
  const doc = new FakeDocument(body);
  const signals = adapter.collectPageSignalsV1({
    doc,
    now: () => 100,
    maxBlocks: 3,
    maxNodes: 5,
  });

  const validation = validateCollectedPageSignalsV1(signals);
  assert.equal(validation.ok, true, validationMessages(validation));
  assert.equal(signals.blocks.length, 3);
  assert.equal(signals.stats.nodesScanned, 5);
  assert.equal(signals.stats.budgetHit, true);
  assert.equal(signals.observedNodeSignalsV2.blockSignals.length, 3);
  assert.equal(signals.observedNodeSignalsV2.coverage.blocksObserved, 3);
  assert.equal(signals.observedNodeSignalsV2.coverage.nodesSampled, 5);
  assert.equal(signals.observedNodeSignalsV2.coverage.budgetHit, true);
  assert.equal(signals.observedNodeSignalsV2.coverage.partial, true);
  assert.equal(validateObservedNodeSignalsV2(signals.observedNodeSignalsV2).ok, true);
});

test('page signals adapter does not mutate observed elements', async () => {
  const adapter = await loadAdapter();
  const doc = buildArticleDocument();

  adapter.collectPageSignalsV1({ doc, now: () => 30 });

  const mutations = [];
  walkElements(doc.body, (el) => {
    mutations.push(...el.mutations);
  });
  assert.deepEqual(mutations, []);
});

test('page signals adapter stays isolated from extension side effects', async () => {
  const source = await fs.readFile(adapterPath, 'utf8');
  const forbidden = [
    /\bchrome\b/,
    /\bsendMessage\b/,
    /\bonMessage\b/,
    /\bstorage\b/,
    /\binsertCSS\b/,
    /\bremoveCSS\b/,
    /\bexecuteScript\b/,
    /\.classList\.(?:add|remove|toggle)\b/,
    /\.setAttribute\b/,
    /\.appendChild\b/,
    /\.removeChild\b/,
  ];

  for (const pattern of forbidden) {
    assert.equal(pattern.test(source), false, `forbidden side-effect token found: ${pattern}`);
  }
});
