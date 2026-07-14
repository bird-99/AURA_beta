import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODE_IDS } from '../../shared/constants.js';
import {
  collectResetAllDataTargets,
  createResetAllDataManager,
} from '../../background/reset-all-data-manager.js';

function found(value) {
  return { ok: true, status: 'found', value };
}

function createHarness({
  tabState = {},
  journal = { tabs: {} },
  tabStateRead = null,
  journalRead = null,
  remove = async () => ({ ok: true }),
  clear = async () => {},
} = {}) {
  const calls = [];
  const manager = createResetAllDataManager({
    readTabState: async () => tabStateRead || found(tabState),
    readLifecycleJournal: async () => journalRead || { ok: true, journal },
    runGlobalOperation: async (kind, operation) => {
      calls.push(['global', kind]);
      return operation({
        runTabOperation: async (tabId, tabKind, tabOperation) => {
          calls.push(['tab', tabId, tabKind]);
          return tabOperation();
        },
      });
    },
    removeTarget: async (target) => {
      calls.push(['remove', target]);
      return remove(target);
    },
    clearStorage: async () => {
      calls.push(['clear']);
      return clear();
    },
  });
  return { manager, calls };
}

test('collects and de-duplicates supported targets from tab state and lifecycle journal', () => {
  const targets = collectResetAllDataTargets({
    8: {
      [MODE_IDS.FOCUS]: { state: 'ACTIVE' },
      unsupported: { state: 'ACTIVE' },
    },
    3: { [MODE_IDS.COMFORT_VISUAL]: { state: 'ERROR' } },
  }, {
    tabs: {
      8: { running: { modeId: MODE_IDS.FOCUS } },
      4: { desired: { modeId: MODE_IDS.COMFORT_VISUAL } },
    },
  });

  assert.deepEqual(targets, [
    { tabId: 3, modeId: MODE_IDS.COMFORT_VISUAL },
    { tabId: 4, modeId: MODE_IDS.COMFORT_VISUAL },
    { tabId: 8, modeId: MODE_IDS.FOCUS },
  ]);
});

test('fails closed when tab state cannot be read', async () => {
  const { manager, calls } = createHarness({
    tabStateRead: { ok: false, status: 'error', error: { message: 'storage unavailable' } },
  });
  const result = await manager.reset();
  assert.deepEqual(result, {
    ok: false,
    reason: 'RESET_TAB_STATE_UNAVAILABLE',
    error: 'storage unavailable',
  });
  assert.equal(calls.some(([kind]) => kind === 'remove' || kind === 'clear'), false);
});

test('does not clear storage when any document cleanup fails', async () => {
  const { manager, calls } = createHarness({
    tabState: {
      1: { [MODE_IDS.FOCUS]: { state: 'ACTIVE' } },
      2: { [MODE_IDS.COMFORT_VISUAL]: { state: 'ACTIVE' } },
    },
    remove: async ({ tabId }) => tabId === 1
      ? { ok: true }
      : { ok: false, reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE', retryable: true },
  });
  const result = await manager.reset();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESET_CLEANUP_FAILED');
  assert.deepEqual(result.failures, [{
    tabId: 2,
    modeId: MODE_IDS.COMFORT_VISUAL,
    reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE',
    retryable: true,
  }]);
  assert.equal(calls.some(([kind]) => kind === 'clear'), false);
});

test('clears storage only after every target converges', async () => {
  const { manager, calls } = createHarness({
    tabState: {
      12: {
        [MODE_IDS.FOCUS]: { state: 'ACTIVE' },
        [MODE_IDS.COMFORT_VISUAL]: { state: 'ERROR' },
      },
    },
  });
  const result = await manager.reset();
  assert.deepEqual(result, { ok: true, cleanedTargets: 2 });
  const callKinds = calls.map(([kind]) => kind);
  assert.equal(callKinds.at(-1), 'clear');
  assert.equal(callKinds.filter((kind) => kind === 'remove').length, 2);
});

test('reports final storage failure after cleanup without a false success', async () => {
  const { manager } = createHarness({
    tabState: { 3: { [MODE_IDS.FOCUS]: { state: 'ACTIVE' } } },
    clear: async () => { throw new Error('clear unavailable'); },
  });
  const result = await manager.reset();
  assert.deepEqual(result, {
    ok: false,
    reason: 'RESET_STORAGE_CLEAR_FAILED',
    error: 'clear unavailable',
    cleanedTargets: 1,
  });
});
