import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  LIFECYCLE_OPERATION_KINDS,
  LIFECYCLE_PHASES,
  LifecycleOperationJournal,
} from '../../background/lifecycle-operation-journal.js';
import {
  LIFECYCLE_DOCUMENT_RELATIONS,
  recoverLifecycleJournal,
} from '../../background/lifecycle-recovery.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';

function createJournalHarness() {
  let stored;
  let sequence = 0;
  const create = () => new LifecycleOperationJournal({
    readResult: async () => stored === undefined
      ? { ok: true, status: 'missing', value: null, error: null }
      : { ok: true, status: 'found', value: structuredClone(stored), error: null },
    mutateValue: async (_key, updater) => {
      stored = await updater(stored);
      return stored;
    },
    now: () => 1000 + sequence,
    uuid: () => `crash-op-${++sequence}`,
  });
  return { create, read: () => structuredClone(stored) };
}

function createManager(initialState = {}) {
  let state = structuredClone(initialState);
  return {
    async getModeState() {
      return structuredClone(state);
    },
    async updateTabModeState(_tabId, _modeId, updates) {
      state = { ...state, ...structuredClone(updates) };
    },
    read: () => structuredClone(state),
  };
}

const tabsApi = { get: async (tabId) => ({ id: tabId, url: 'https://example.com/page' }) };
const contextResolver = async () => ({
  status: 'verified',
  urlKey: 'https://example.com/page',
  documentInstanceId: 'document-1',
  chromeDocumentId: 'chrome-document-1',
});
const bridge = { safeSend: async () => ({ ok: true, data: { ok: true } }) };

afterEach(() => {
  delete global.chrome;
});

test('a new recovery instance compensates an apply abandoned after CSS insertion', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 21,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    urlKey: 'https://example.com/page',
    documentInstanceId: 'document-1',
    chromeDocumentId: 'chrome-document-1',
  });
  await writer.begin(intent, { beforeState: { state: STATES.INACTIVE } });
  await writer.planArtifact(intent, {
    id: 'inserted-css',
    kind: 'CSS_INSERT',
    cleanup: {
      action: 'REMOVE_CSS',
      target: { tabId: 21 },
      cssText: '.aura { color: red; }',
      origin: 'AUTHOR',
    },
  });

  const removals = [];
  global.chrome = {
    scripting: {
      async removeCSS(details) {
        removals.push(details);
      },
    },
  };
  const manager = createManager({ state: STATES.INACTIVE });
  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager,
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver,
  });

  assert.equal(recovery.ok, true);
  assert.equal(removals.length, 1);
  assert.equal(manager.read().state, STATES.ERROR);
  assert.equal((await harness.create().listPendingTabs()).entries.length, 0);
});

test('recovery finalizes an operation whose state already carries the durable op id', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 22,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
  });
  await writer.begin(intent);
  await writer.setPhase(intent, LIFECYCLE_PHASES.STATE_COMMITTED);
  let removed = false;
  global.chrome = { scripting: { async removeCSS() { removed = true; } } };
  const manager = createManager({
    state: STATES.ACTIVE,
    lastLifecycleOpId: intent.opId,
    lastLifecycleGeneration: intent.generation,
  });

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager,
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver,
  });

  assert.equal(recovery.ok, true);
  assert.equal(recovery.results[0].finalized, true);
  assert.equal(removed, false);
});

test('failed cleanup keeps a remove journal retryable for the next restart', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 23,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
    urlKey: 'https://example.com/page',
    documentInstanceId: 'document-1',
    chromeDocumentId: 'chrome-document-1',
  });
  await writer.begin(intent, { beforeState: { state: STATES.ACTIVE } });
  await writer.planArtifact(intent, {
    id: 'css-remove-retry',
    kind: 'CSS_REMOVE',
    cleanup: {
      action: 'REMOVE_CSS',
      target: { tabId: 23 },
      cssText: '.aura { color: red; }',
      origin: 'AUTHOR',
    },
  });
  global.chrome = {
    scripting: {
      async removeCSS() {
        throw new Error('temporary chrome failure');
      },
    },
  };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.ACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver,
  });

  assert.equal(recovery.ok, true);
  assert.equal(recovery.degraded, true);
  const slot = harness.read().tabs['23'];
  assert.equal(slot.running.phase, LIFECYCLE_PHASES.RETRYABLE);
  assert.equal(slot.running.artifacts[0].status, 'PLANNED');
});

async function writeInterruptedCssApply(journal, {
  tabId,
  modeId = MODE_IDS.COMFORT_VISUAL,
  documentInstanceId = `document-${tabId}`,
  chromeDocumentId = `chrome-document-${tabId}`,
} = {}) {
  const intent = await journal.claimIntent({
    tabId,
    modeId,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    urlKey: 'https://example.com/page',
    documentInstanceId,
    chromeDocumentId,
  });
  await journal.begin(intent, { beforeState: { state: STATES.INACTIVE } });
  await journal.planArtifact(intent, {
    id: `css-${tabId}`,
    kind: 'CSS_INSERT',
    cleanup: {
      action: 'REMOVE_CSS',
      target: { tabId },
      cssText: `.aura-${tabId} { color: red; }`,
      origin: 'AUTHOR',
    },
  });
  return intent;
}

test('reload to the same URL never cleans the replacement document', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), {
    tabId: 31,
    documentInstanceId: 'document-old',
    chromeDocumentId: 'chrome-old',
  });
  const removals = [];
  global.chrome = { scripting: { removeCSS: async (details) => removals.push(details) } };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver: async () => ({
      status: 'verified',
      urlKey: 'https://example.com/page',
      documentInstanceId: 'document-new',
      chromeDocumentId: 'chrome-new',
    }),
    pruneOrphans: false,
  });

  assert.equal(recovery.results[0].documentRelation, LIFECYCLE_DOCUMENT_RELATIONS.DIFFERENT);
  assert.equal(removals.length, 0);
  assert.equal((await harness.create().listPendingTabs()).entries.length, 0);
});

test('SPA URL changes keep the same document eligible for exact cleanup', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), {
    tabId: 32,
    documentInstanceId: 'document-spa',
    chromeDocumentId: 'chrome-spa',
  });
  const removals = [];
  global.chrome = { scripting: { removeCSS: async (details) => removals.push(details) } };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver: async () => ({
      status: 'verified',
      urlKey: 'https://example.com/spa-route',
      documentInstanceId: 'document-spa',
      chromeDocumentId: 'chrome-spa',
    }),
    pruneOrphans: false,
  });

  assert.equal(recovery.results[0].documentRelation, LIFECYCLE_DOCUMENT_RELATIONS.SAME);
  assert.equal(removals.length, 1);
  assert.deepEqual(removals[0].target, { tabId: 32, documentIds: ['chrome-spa'] });
});

test('unverifiable identity leaves DOM artifacts pending then quarantines after three attempts', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), { tabId: 33 });
  global.chrome = { scripting: { removeCSS: async () => assert.fail('DOM cleanup must stay closed') } };
  const options = {
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver: async () => ({
      status: 'unverifiable',
      urlKey: 'https://example.com/page',
      documentInstanceId: null,
      chromeDocumentId: null,
    }),
    pruneOrphans: false,
  };

  const first = await recoverLifecycleJournal({ ...options, now: () => 1_000 });
  assert.equal(first.results[0].retryable, true);
  const second = await recoverLifecycleJournal({ ...options, now: () => 31_001 });
  assert.equal(second.results[0].retryable, true);
  const third = await recoverLifecycleJournal({ ...options, now: () => 151_002 });
  assert.equal(third.results[0].quarantined, true);

  const running = harness.read().tabs['33'].running;
  assert.equal(running.phase, LIFECYCLE_PHASES.QUARANTINED);
  assert.equal(running.recoveryAttempts, 3);
  assert.equal(running.interruptedPhase, LIFECYCLE_PHASES.MUTATING);
  assert.equal(running.reason, 'DOCUMENT_IDENTITY_UNVERIFIABLE');
  assert.equal(running.quarantineReason, 'DOCUMENT_IDENTITY_UNVERIFIABLE');
  assert.equal(running.quarantinedAt, 1001);
  assert.equal(running.artifacts[0].status, 'PLANNED');
});

test('a quarantined tab does not block recovery in another tab', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), { tabId: 34 });
  const unavailable = {
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi: { get: async (tabId) => ({ id: tabId }), query: undefined },
    contextResolver: async () => ({ status: 'unverifiable', documentInstanceId: null }),
    pruneOrphans: false,
  };
  await recoverLifecycleJournal({ ...unavailable, now: () => 1_000 });
  await recoverLifecycleJournal({ ...unavailable, now: () => 31_001 });
  await recoverLifecycleJournal({ ...unavailable, now: () => 151_002 });

  await writeInterruptedCssApply(harness.create(), { tabId: 35 });
  const removals = [];
  global.chrome = { scripting: { removeCSS: async (details) => removals.push(details) } };
  const recovery = await recoverLifecycleJournal({
    ...unavailable,
    contextResolver: async (tabId) => tabId === 34
      ? { status: 'unverifiable', documentInstanceId: null }
      : {
          status: 'verified',
          documentInstanceId: 'document-35',
          chromeDocumentId: 'chrome-document-35',
        },
    now: () => 200_000,
  });

  assert.equal(recovery.quarantinedCount, 1);
  assert.equal(removals.length, 1);
  const pending = await harness.create().listPendingTabs();
  assert.deepEqual(pending.entries.map((entry) => entry.tabId), [34]);
});

test('content cleanup is bound to both the AURA and Chrome document identities', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 36,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    documentInstanceId: 'document-36',
    chromeDocumentId: 'chrome-document-36',
  });
  await writer.begin(intent, { beforeState: { state: STATES.INACTIVE } });
  await writer.planArtifact(intent, {
    id: 'tokens-36',
    kind: 'SCOPE_TOKEN_APPLY',
    cleanup: { action: 'MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS', frameId: 0 },
  });
  const sends = [];

  await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge: {
      safeSend: async (tabId, message, options) => {
        sends.push({ tabId, message, options });
        return { ok: true, data: { ok: true } };
      },
    },
    tabsApi,
    contextResolver: async () => ({
      status: 'verified',
      documentInstanceId: 'document-36',
      chromeDocumentId: 'chrome-document-36',
    }),
    pruneOrphans: false,
  });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].message.expectedDocumentInstanceId, 'document-36');
  assert.deepEqual(sends[0].options, { documentId: 'chrome-document-36' });
});

test('dark runtime recovery uses the recorded document and receipt only', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 41,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    documentInstanceId: 'document-41',
    chromeDocumentId: 'chrome-main-41',
  });
  await writer.begin(intent, { beforeState: { state: STATES.INACTIVE } });
  await writer.planArtifact(intent, {
    id: 'dark-receipt-41',
    kind: 'DARK_RUNTIME_RECEIPT',
    cleanup: {
      action: 'CLEANUP_DARK_RUNTIME',
      target: { documentIds: ['chrome-frame-old'] },
      receiptId: 'receipt-old',
    },
  });
  const executions = [];
  global.chrome = {
    scripting: {
      executeScript: async (details) => {
        executions.push(details);
        return [{ documentId: 'chrome-frame-old', frameId: 3, result: { ok: true } }];
      },
    },
  };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver: async () => ({
      status: 'verified',
      documentInstanceId: 'document-41',
      chromeDocumentId: 'chrome-main-41',
    }),
    pruneOrphans: false,
  });

  assert.equal(recovery.degraded, false);
  assert.equal(executions.length, 1);
  assert.deepEqual(executions[0].target, { tabId: 41, documentIds: ['chrome-frame-old'] });
  assert.deepEqual(executions[0].args, ['receipt-old']);
});

test('a disappeared subframe receipt never mutates its replacement document', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  const intent = await writer.claimIntent({
    tabId: 42,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    documentInstanceId: 'document-1',
    chromeDocumentId: 'chrome-document-1',
  });
  await writer.begin(intent, { beforeState: { state: STATES.INACTIVE } });
  await writer.planArtifact(intent, {
    id: 'dark-receipt-42',
    kind: 'DARK_RUNTIME_RECEIPT',
    cleanup: {
      action: 'CLEANUP_DARK_RUNTIME',
      target: { documentIds: ['chrome-subframe-gone'] },
      receiptId: 'receipt-gone',
    },
  });
  const targets = [];
  global.chrome = {
    scripting: {
      executeScript: async (details) => {
        targets.push(details.target);
        throw new Error('No document with id chrome-subframe-gone');
      },
    },
  };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi,
    contextResolver,
    pruneOrphans: false,
  });

  assert.equal(recovery.degraded, false);
  assert.deepEqual(targets, [{ tabId: 42, documentIds: ['chrome-subframe-gone'] }]);
});

test('an exception in one tab is persisted and does not stop the next tab', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), { tabId: 37 });
  await writeInterruptedCssApply(harness.create(), { tabId: 38 });
  const removals = [];
  global.chrome = { scripting: { removeCSS: async (details) => removals.push(details) } };

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager({ state: STATES.INACTIVE }),
    registry: { remove: async () => {} },
    bridge,
    tabsApi: { get: async (tabId) => ({ id: tabId }) },
    contextResolver: async (tabId) => {
      if (tabId === 37) throw new Error('context resolver failed');
      return {
        status: 'verified',
        documentInstanceId: 'document-38',
        chromeDocumentId: 'chrome-document-38',
      };
    },
    now: () => 10_000,
    pruneOrphans: false,
  });

  assert.equal(recovery.results[0].isolated, true);
  assert.equal(recovery.results[0].retryable, true);
  assert.equal(removals.length, 1);
  assert.equal(harness.read().tabs['37'].running.phase, LIFECYCLE_PHASES.RETRYABLE);
  assert.equal(harness.read().tabs['38'].running, null);
});

test('startup pruning removes running and last-finished slots only after a successful tab query', async () => {
  const harness = createJournalHarness();
  const writer = harness.create();
  await writeInterruptedCssApply(writer, { tabId: 39 });
  const finished = await writer.claimIntent({
    tabId: 40,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    documentInstanceId: 'document-40',
    chromeDocumentId: 'chrome-document-40',
  });
  await writer.begin(finished);
  await writer.complete(finished);
  const cleared = [];

  await recoverLifecycleJournal({
    journal: harness.create(),
    manager: {
      ...createManager(),
      clearTab: async (tabId) => cleared.push(tabId),
    },
    registry: { remove: async () => {} },
    bridge,
    tabsApi: { query: async () => [{ id: 41 }], get: async () => { throw new Error('gone'); } },
  });

  assert.deepEqual(cleared.sort((a, b) => a - b), [39, 40]);
  assert.deepEqual((await harness.create().listTabs()).entries, []);
});

test('failed tab enumeration never prunes lifecycle data', async () => {
  const harness = createJournalHarness();
  await writeInterruptedCssApply(harness.create(), { tabId: 42 });

  const recovery = await recoverLifecycleJournal({
    journal: harness.create(),
    manager: createManager(),
    registry: { remove: async () => {} },
    bridge,
    tabsApi: {
      query: async () => { throw new Error('tabs unavailable'); },
      get: async () => ({ id: 42 }),
    },
    contextResolver: async () => ({ status: 'unverifiable', documentInstanceId: null }),
  });

  assert.equal(recovery.orphanPrune.skipped, true);
  assert.equal((await harness.create().listTabs()).entries.length, 1);
});
