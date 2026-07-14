import assert from 'node:assert/strict';
import test from 'node:test';

import { createModeEngineDiagnosticsController } from '../../options/modeengine-diagnostics.js';

function diagnostic(tabId, marker = `tab-${tabId}`) {
  return {
    kind: 'ModeEngineDiagnosticSnapshotV1',
    target: { tabId },
    marker,
    signals: {
      snapshot: { byType: {} },
      recentSignals: [],
      recentDecisions: [],
    },
  };
}

function createViewSpy() {
  return {
    targets: [],
    selectedTabId: null,
    diagnostics: [],
    emptyCount: 0,
    statuses: [],
    renderTargets(tabs, selectedTabId) {
      this.targets = tabs.map((tab) => ({ ...tab }));
      this.selectedTabId = selectedTabId;
    },
    renderDiagnostic(value) {
      this.diagnostics.push(value);
    },
    renderEmpty() {
      this.emptyCount += 1;
    },
    reportStatus(kind, message) {
      this.statuses.push({ kind, message });
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('diagnostics controller filters targets, prioritizes the active tab and requests an explicit tab id', async () => {
  const requested = [];
  const view = createViewSpy();
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [
      { id: 9, url: 'chrome://settings', active: true },
      { id: 7, url: 'https://seven.example/page', active: false },
      { id: 5, url: 'http://five.example/page', active: true },
      { id: null, url: 'https://invalid.example/' },
    ],
    requestSnapshot: async (tabId) => {
      requested.push(tabId);
      return { ok: true, diagnostic: diagnostic(tabId) };
    },
    downloadSnapshot: () => {},
    view,
  });

  await controller.initialize();

  assert.deepEqual(view.targets.map((tab) => tab.id), [5, 7]);
  assert.equal(view.selectedTabId, 5);
  assert.deepEqual(requested, [5]);
  assert.equal(view.diagnostics.at(-1).target.tabId, 5);
});

test('diagnostics controller retains an available selection and exports only the diagnostic DTO', async () => {
  const view = createViewSpy();
  const downloads = [];
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [
      { id: 11, url: 'https://eleven.example/', active: true },
      { id: 12, url: 'https://twelve.example/', active: false },
    ],
    requestSnapshot: async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId) }),
    downloadSnapshot: (payload, filename) => downloads.push({ payload, filename }),
    view,
    now: () => new Date('2026-07-12T10:00:00.000Z'),
  });

  await controller.initialize();
  await controller.selectTarget(12);
  await controller.refreshTargets();
  const result = await controller.exportSnapshot();

  assert.equal(result.ok, true);
  assert.equal(view.selectedTabId, 12);
  assert.deepEqual(downloads, [{
    payload: diagnostic(12),
    filename: 'aura-debug-snapshot-2026-07-12.json',
  }]);
});

test('diagnostics controller fails safely when no supported target or snapshot is available', async () => {
  const view = createViewSpy();
  const downloads = [];
  let requested = 0;
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 3, url: 'chrome-extension://aura/options.html', active: true }],
    requestSnapshot: async () => {
      requested += 1;
      return { ok: false, error: 'UNEXPECTED' };
    },
    downloadSnapshot: (...args) => downloads.push(args),
    view,
  });

  await controller.initialize();
  const refreshResult = await controller.refresh();
  const exportResult = await controller.exportSnapshot();

  assert.equal(view.selectedTabId, null);
  assert.equal(requested, 0);
  assert.equal(refreshResult.ok, false);
  assert.equal(exportResult.ok, false);
  assert.equal(downloads.length, 0);
  assert.ok(view.statuses.some(({ kind }) => kind === 'error'));
});

test('a late response for a previous target never replaces the newly selected diagnostic', async () => {
  const view = createViewSpy();
  let request = async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId, 'initial') });
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [
      { id: 21, url: 'https://first.example/', active: true },
      { id: 22, url: 'https://second.example/', active: false },
    ],
    requestSnapshot: (tabId) => request(tabId),
    downloadSnapshot: () => {},
    view,
  });
  await controller.initialize();

  const first = deferred();
  const second = deferred();
  request = (tabId) => (tabId === 21 ? first.promise : second.promise);
  const oldRefresh = controller.refresh();
  const newSelection = controller.selectTarget(22);
  second.resolve({ ok: true, diagnostic: diagnostic(22, 'new') });
  await newSelection;
  first.resolve({ ok: true, diagnostic: diagnostic(21, 'stale') });
  await oldRefresh;

  assert.equal(view.diagnostics.at(-1).target.tabId, 22);
  assert.equal(view.diagnostics.at(-1).marker, 'new');
});

test('the newest refresh wins when requests for the same tab finish out of order', async () => {
  const view = createViewSpy();
  let request = async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId, 'initial') });
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 31, url: 'https://same.example/', active: true }],
    requestSnapshot: (tabId) => request(tabId),
    downloadSnapshot: () => {},
    view,
  });
  await controller.initialize();

  const older = deferred();
  const newer = deferred();
  const pending = [older, newer];
  request = () => pending.shift().promise;
  const olderRefresh = controller.refresh();
  const newerRefresh = controller.refresh();
  newer.resolve({ ok: true, diagnostic: diagnostic(31, 'newer') });
  await newerRefresh;
  older.resolve({ ok: true, diagnostic: diagnostic(31, 'older') });
  await olderRefresh;

  assert.equal(view.diagnostics.at(-1).marker, 'newer');
});

test('export always performs a fresh read for the selected tab', async () => {
  const view = createViewSpy();
  const downloads = [];
  let version = 'before-navigation';
  let requestCount = 0;
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 41, url: 'https://navigation.example/', active: true }],
    requestSnapshot: async (tabId) => {
      requestCount += 1;
      return { ok: true, diagnostic: diagnostic(tabId, version) };
    },
    downloadSnapshot: (payload) => downloads.push(payload),
    view,
  });
  await controller.initialize();
  version = 'after-navigation';

  const result = await controller.exportSnapshot();

  assert.equal(result.ok, true);
  assert.equal(requestCount, 2);
  assert.equal(downloads.at(-1).marker, 'after-navigation');
});

test('an export failure cannot reuse a previously accepted snapshot', async () => {
  const view = createViewSpy();
  const downloads = [];
  let fail = false;
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 51, url: 'https://failure.example/', active: true }],
    requestSnapshot: async (tabId) => fail
      ? { ok: false, error: 'STORAGE_UNAVAILABLE' }
      : { ok: true, diagnostic: diagnostic(tabId, 'accepted') },
    downloadSnapshot: (...args) => downloads.push(args),
    view,
  });
  await controller.initialize();
  fail = true;

  const result = await controller.exportSnapshot();

  assert.equal(result.ok, false);
  assert.equal(downloads.length, 0);
});

test('export refuses a removed target instead of silently switching tabs', async () => {
  const view = createViewSpy();
  const downloads = [];
  let tabs = [
    { id: 61, url: 'https://removed.example/', active: true },
    { id: 62, url: 'https://remaining.example/', active: false },
  ];
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => tabs,
    requestSnapshot: async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId) }),
    downloadSnapshot: (...args) => downloads.push(args),
    view,
  });
  await controller.initialize();
  tabs = [{ id: 62, url: 'https://remaining.example/', active: true }];

  const result = await controller.exportSnapshot();

  assert.equal(result.ok, false);
  assert.equal(view.selectedTabId, null);
  assert.equal(downloads.length, 0);
});

test('a response whose diagnostic target differs from the request fails closed', async () => {
  const view = createViewSpy();
  const downloads = [];
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 71, url: 'https://requested.example/', active: true }],
    requestSnapshot: async () => ({ ok: true, diagnostic: diagnostic(72, 'wrong-target') }),
    downloadSnapshot: (...args) => downloads.push(args),
    view,
  });

  await controller.initialize();
  const result = await controller.exportSnapshot();

  assert.equal(result.ok, false);
  assert.equal(view.diagnostics.length, 0);
  assert.equal(downloads.length, 0);
});

test('disposing the controller invalidates an in-flight response', async () => {
  const view = createViewSpy();
  let request = async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId, 'initial') });
  const controller = createModeEngineDiagnosticsController({
    listTabs: async () => [{ id: 81, url: 'https://disposed.example/', active: true }],
    requestSnapshot: (tabId) => request(tabId),
    downloadSnapshot: () => {},
    view,
  });
  await controller.initialize();
  const renderedBeforeDispose = view.diagnostics.length;
  const pending = deferred();
  request = () => pending.promise;

  const refresh = controller.refresh();
  controller.dispose();
  pending.resolve({ ok: true, diagnostic: diagnostic(81, 'late') });
  const result = await refresh;

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(view.diagnostics.length, renderedBeforeDispose);
  assert.equal((await controller.exportSnapshot()).ok, false);
});

test('a late target-list response cannot override a newer explicit selection', async () => {
  const view = createViewSpy();
  let listTabs = async () => [
    { id: 91, url: 'https://first-list.example/', active: true },
    { id: 92, url: 'https://second-list.example/', active: false },
  ];
  const controller = createModeEngineDiagnosticsController({
    listTabs: () => listTabs(),
    requestSnapshot: async (tabId) => ({ ok: true, diagnostic: diagnostic(tabId) }),
    downloadSnapshot: () => {},
    view,
  });
  await controller.initialize();
  const staleList = deferred();
  listTabs = () => staleList.promise;

  const pendingTargets = controller.refreshTargets();
  await controller.selectTarget(92);
  staleList.resolve([{ id: 91, url: 'https://first-list.example/', active: true }]);
  const targetsResult = await pendingTargets;

  assert.equal(targetsResult.ok, false);
  assert.equal(targetsResult.stale, true);
  assert.equal(view.selectedTabId, 92);
});
