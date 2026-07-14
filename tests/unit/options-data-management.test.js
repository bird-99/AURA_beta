import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOptionsDataManagementController } from '../../options/data-management.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createView() {
  const calls = [];
  let actions = null;
  return {
    calls,
    get actions() { return actions; },
    bind(nextActions) {
      calls.push(['bind']);
      actions = nextActions;
    },
    setBusy(busy) { calls.push(['busy', busy]); },
    openImportPicker() { calls.push(['picker']); },
    resetImportInput() { calls.push(['input-reset']); },
    setResetConfirmationVisible(visible) { calls.push(['confirm', visible]); },
    reportInline(kind, message) { calls.push(['inline', kind, message]); },
    reportData(kind, message) { calls.push(['data', kind, message]); },
    dispose() { calls.push(['dispose']); },
  };
}

function createHarness(overrides = {}) {
  const view = overrides.view || createView();
  const calls = [];
  const controller = createOptionsDataManagementController({
    buildExport: async (version) => {
      calls.push(['build', version]);
      return { schemaVersion: '2.0' };
    },
    importAndApply: async (payload) => {
      calls.push(['import', payload]);
      return { domains: 2, modes: 3 };
    },
    resetAll: async () => { calls.push(['reset']); },
    download: (payload, filename) => calls.push(['download', payload, filename]),
    getVersion: () => '9.8.7',
    reloadState: async () => { calls.push(['reload']); },
    view,
    now: () => new Date('2026-07-12T15:30:00.000Z'),
    ...overrides,
  });
  controller.initialize();
  return { controller, view, calls };
}

test('exports the exact payload with a deterministic filename', async () => {
  const { controller, calls, view } = createHarness();
  const result = await controller.actions.exportData();
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['build', '9.8.7'],
    ['download', { schemaVersion: '2.0' }, 'aura-export-2026-07-12.json'],
  ]);
  assert.ok(view.calls.some((call) => call[0] === 'inline' && call[1] === 'success'));
});

test('invalid JSON never calls import and always resets the file input', async () => {
  const { controller, calls, view } = createHarness();
  const result = await controller.actions.importFile({ text: async () => '{invalid' });
  assert.equal(result.ok, false);
  assert.equal(calls.some(([kind]) => kind === 'import' || kind === 'reload'), false);
  assert.equal(view.calls.filter(([kind]) => kind === 'input-reset').length, 1);
  assert.ok(view.calls.some((call) => call[0] === 'data' && call[2] === 'Import failed'));
});

test('import validation failure performs no reload and reports no success', async () => {
  const view = createView();
  const controller = createOptionsDataManagementController({
    buildExport: async () => ({}),
    importAndApply: async () => { throw new Error('Invalid payload'); },
    resetAll: async () => {},
    download: () => {},
    getVersion: () => '1',
    reloadState: async () => { throw new Error('reload must not run'); },
    view,
  });
  controller.initialize();
  const result = await controller.actions.importFile({ text: async () => '{}' });
  assert.deepEqual(result, { ok: false, reason: 'Invalid payload' });
  assert.equal(view.calls.some((call) => call[0] === 'data' && call[1] === 'success'), false);
  assert.equal(view.calls.filter(([kind]) => kind === 'input-reset').length, 1);
});

test('valid import reloads exactly once before reporting success', async () => {
  const { controller, calls, view } = createHarness();
  const result = await controller.actions.importFile({ text: async () => '{"schemaVersion":"2.0"}' });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['import', { schemaVersion: '2.0' }],
    ['reload'],
  ]);
  assert.equal(view.calls.filter(([kind]) => kind === 'input-reset').length, 1);
  assert.ok(view.calls.some((call) => call[0] === 'data' && call[2] === 'Import complete'));
});

test('reset failure cannot report success or reload state', async () => {
  const view = createView();
  let reloadCount = 0;
  const controller = createOptionsDataManagementController({
    buildExport: async () => ({}),
    importAndApply: async () => ({ domains: 0, modes: 0 }),
    resetAll: async () => { throw new Error('RESET_CLEANUP_FAILED'); },
    download: () => {},
    getVersion: () => '1',
    reloadState: async () => { reloadCount += 1; },
    view,
  });
  controller.initialize();
  const result = await controller.actions.confirmReset();
  assert.deepEqual(result, { ok: false, reason: 'RESET_CLEANUP_FAILED' });
  assert.equal(reloadCount, 0);
  assert.equal(view.calls.some((call) => call[0] === 'data' && call[1] === 'success'), false);
  assert.deepEqual(view.calls.find((call) => call[0] === 'confirm'), ['confirm', false]);
});

test('reset success reloads once and reports completion', async () => {
  const { controller, calls, view } = createHarness();
  const result = await controller.actions.confirmReset();
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [['reset'], ['reload']]);
  assert.ok(view.calls.some((call) => call[0] === 'data' && call[2] === 'All data cleared'));
});

test('a running operation disables controls and rejects overlapping work', async () => {
  const gate = deferred();
  let resetCount = 0;
  const view = createView();
  const controller = createOptionsDataManagementController({
    buildExport: async () => {
      await gate.promise;
      return { exported: true };
    },
    importAndApply: async () => ({ domains: 0, modes: 0 }),
    resetAll: async () => { resetCount += 1; },
    download: () => {},
    getVersion: () => '1',
    reloadState: async () => {},
    view,
  });
  controller.initialize();

  const exporting = controller.actions.exportData();
  await new Promise((resolve) => setImmediate(resolve));
  const overlapping = await controller.actions.confirmReset();
  assert.deepEqual(overlapping, { ok: false, reason: 'DATA_OPERATION_IN_PROGRESS' });
  assert.equal(resetCount, 0);
  assert.deepEqual(view.calls.filter(([kind]) => kind === 'busy'), [['busy', true]]);
  gate.resolve();
  await exporting;
  assert.deepEqual(view.calls.filter(([kind]) => kind === 'busy'), [
    ['busy', true],
    ['busy', false],
  ]);
});

test('initialize is idempotent and dispose unbinds the view', () => {
  const { controller, view } = createHarness();
  controller.initialize();
  controller.dispose();
  assert.equal(view.calls.filter(([kind]) => kind === 'bind').length, 1);
  assert.equal(view.calls.filter(([kind]) => kind === 'dispose').length, 1);
});
