import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LIFECYCLE_ARTIFACT_STATUSES,
  LIFECYCLE_OPERATION_KINDS,
  LIFECYCLE_PHASES,
  LifecycleOperationJournal,
} from '../../background/lifecycle-operation-journal.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';

function createHarness() {
  let stored;
  let id = 0;
  const journal = new LifecycleOperationJournal({
    readResult: async () => stored === undefined
      ? { ok: true, status: 'missing', value: null, error: null }
      : { ok: true, status: 'found', value: structuredClone(stored), error: null },
    mutateValue: async (_key, updater) => {
      stored = await updater(stored);
      return stored;
    },
    now: () => 1000 + id,
    uuid: () => `op-${++id}`,
  });
  return { journal, readStored: () => structuredClone(stored) };
}

test('lifecycle journal preserves the running cleanup recipe when a newer intent arrives', async () => {
  const { journal, readStored } = createHarness();
  const apply = await journal.claimIntent({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    source: 'popup',
    urlKey: 'https://example.com/page',
  });
  await journal.begin(apply, { beforeState: { state: STATES.INACTIVE } });
  await journal.planArtifact(apply, {
    id: 'css-main',
    kind: 'CSS',
    cleanup: { cssText: '.x{}', origin: 'AUTHOR', frameId: 0 },
  });

  const remove = await journal.claimIntent({
    tabId: 7,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
    source: 'restore',
  });

  const slot = readStored().tabs['7'];
  assert.equal(slot.desired.opId, remove.opId);
  assert.equal(slot.running.opId, apply.opId);
  assert.equal(slot.running.artifacts[0].cleanup.cssText, '.x{}');
  assert.equal((await journal.isCurrent(apply)).current, false);
  assert.equal((await journal.isCurrent(remove)).current, true);
});

test('stale lifecycle operations cannot checkpoint or clear a newer running operation', async () => {
  const { journal } = createHarness();
  const first = await journal.claimIntent({
    tabId: 8,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
  });
  await journal.begin(first);
  await journal.claimIntent({
    tabId: 8,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
  });

  await assert.rejects(
    journal.setPhase({ ...first, generation: first.generation + 1 }, LIFECYCLE_PHASES.STATE_COMMITTED),
    /LIFECYCLE_OPERATION_STALE/,
  );
  await assert.rejects(
    journal.complete({ ...first, opId: 'not-owner' }),
    /LIFECYCLE_OPERATION_STALE/,
  );
});

test('artifact transitions are durable and duplicate artifact ids are rejected', async () => {
  const { journal, readStored } = createHarness();
  const intent = await journal.claimIntent({
    tabId: 9,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.REHYDRATE,
    targetState: STATES.ACTIVE,
  });
  await journal.begin(intent);
  await journal.planArtifact(intent, { id: 'tokens', kind: 'TOKENS', cleanup: { ownedKeys: ['--aura-x'] } });
  await journal.markArtifact(intent, 'tokens', LIFECYCLE_ARTIFACT_STATUSES.DONE);
  assert.equal(readStored().tabs['9'].running.artifacts[0].status, LIFECYCLE_ARTIFACT_STATUSES.DONE);
  await assert.rejects(
    journal.planArtifact(intent, { id: 'tokens', kind: 'TOKENS' }),
    /LIFECYCLE_ARTIFACT_DUPLICATE/,
  );
});

test('structured read errors and corrupt journal versions fail closed', async () => {
  const unavailable = new LifecycleOperationJournal({
    readResult: async () => ({ ok: false, status: 'error', value: null, error: { message: 'offline' } }),
  });
  assert.deepEqual(await unavailable.read(), {
    ok: false,
    status: 'error',
    journal: null,
    error: { message: 'offline' },
  });

  const corrupt = new LifecycleOperationJournal({
    readResult: async () => ({ ok: true, status: 'found', value: { schemaVersion: 99, tabs: {} }, error: null }),
  });
  assert.equal((await corrupt.read()).status, 'corrupt');
});

test('automatic rehydrate cannot supersede a durable remove intent', async () => {
  const { journal } = createHarness();
  await journal.claimIntent({
    tabId: 10,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
    source: 'restore',
  });

  await assert.rejects(
    journal.claimIntent({
      tabId: 10,
      modeId: MODE_IDS.COMFORT_VISUAL,
      kind: LIFECYCLE_OPERATION_KINDS.REHYDRATE,
      targetState: STATES.ACTIVE,
      source: 'rehydrate',
    }),
    /LIFECYCLE_INTENT_SUPERSEDED/,
  );
});

test('a newer remove takes ownership of an interrupted rehydrate without losing artifacts', async () => {
  const { journal, readStored } = createHarness();
  const rehydrate = await journal.claimIntent({
    tabId: 11,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.REHYDRATE,
    targetState: STATES.ACTIVE,
    source: 'rehydrate',
  });
  await journal.begin(rehydrate, { beforeState: { state: STATES.ACTIVE, cssId: 'old-css' } });
  await journal.planArtifact(rehydrate, {
    id: 'partial-css',
    kind: 'CSS_INSERT',
    cleanup: { action: 'REMOVE_CSS', cssText: '.partial{}', target: { tabId: 11 } },
  });
  const remove = await journal.claimIntent({
    tabId: 11,
    modeId: MODE_IDS.COMFORT_VISUAL,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
    source: 'restore',
  });

  const takeover = await journal.begin(remove);

  assert.equal(takeover.opId, remove.opId);
  assert.equal(takeover.supersededOperation.opId, rehydrate.opId);
  assert.equal(takeover.artifacts[0].id, 'partial-css');
  assert.equal(readStored().tabs['11'].running.opId, remove.opId);
});

test('an explicit remove takes ownership of quarantined cleanup artifacts', async () => {
  const { journal, readStored } = createHarness();
  const apply = await journal.claimIntent({
    tabId: 12,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.APPLY,
    targetState: STATES.ACTIVE,
    source: 'user-decision',
  });
  await journal.begin(apply, { beforeState: { state: STATES.INACTIVE } });
  await journal.planArtifact(apply, {
    id: 'quarantined-css',
    kind: 'CSS_INSERT',
    cleanup: { action: 'REMOVE_CSS', cssText: '.partial{}', target: { tabId: 12 } },
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await journal.startRecoveryAttempt(apply);
    await journal.recordRecoveryFailure(apply, { reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE' });
  }
  assert.equal(readStored().tabs['12'].running.phase, LIFECYCLE_PHASES.QUARANTINED);

  const remove = await journal.claimIntent({
    tabId: 12,
    modeId: MODE_IDS.FOCUS,
    kind: LIFECYCLE_OPERATION_KINDS.REMOVE,
    targetState: STATES.INACTIVE,
    source: 'restore',
  });
  const takeover = await journal.begin(remove);

  assert.equal(takeover.supersededOperation.opId, apply.opId);
  assert.equal(takeover.supersededOperation.kind, LIFECYCLE_OPERATION_KINDS.APPLY);
  assert.equal(takeover.artifacts.length, 1);
  assert.equal(takeover.artifacts[0].id, 'quarantined-css');
  assert.equal(takeover.artifacts[0].status, LIFECYCLE_ARTIFACT_STATUSES.PLANNED);
});
