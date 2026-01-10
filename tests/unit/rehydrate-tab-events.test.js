import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTabRehydrateHandlers } from '../../background/rehydrate-tab-events.js';

function createHarness({
  tabState = { 'comfort-visual': { state: 'ACTIVE' } },
  tabUrl = 'https://example.com',
  isUnsupportedScheme = () => false,
} = {}) {
  const calls = [];

  const stateManager = {
    async getTabState() {
      return tabState;
    },
  };

  const rehydrateActiveModesForTab = async (tabId, reason) => {
    calls.push({ tabId, reason });
  };

  const tabsApi = {
    async get() {
      return { id: 123, url: tabUrl };
    },
  };

  const handlers = createTabRehydrateHandlers({
    stateManager,
    rehydrateActiveModesForTab,
    isUnsupportedScheme,
    isValidTabId: (value) => typeof value === 'number',
    states: { ACTIVE: 'ACTIVE' },
    tabsApi,
  });

  return { calls, handlers };
}

test('handleTabUpdated ignores non-complete updates', async () => {
  const { calls, handlers } = createHarness();

  await handlers.handleTabUpdated(123, { status: 'loading' }, { url: 'https://example.com' });

  assert.equal(calls.length, 0);
});

test('handleTabUpdated skips when no active modes', async () => {
  const { calls, handlers } = createHarness({
    tabState: { 'comfort-visual': { state: 'INACTIVE' } },
  });

  await handlers.handleTabUpdated(123, { status: 'complete' }, { url: 'https://example.com' });

  assert.equal(calls.length, 0);
});

test('handleTabUpdated rehydrates on complete with active mode', async () => {
  const { calls, handlers } = createHarness();

  await handlers.handleTabUpdated(123, { status: 'complete' }, { url: 'https://example.com' });

  assert.deepEqual(calls, [{ tabId: 123, reason: 'tab-complete' }]);
});

test('handleTabActivated rehydrates active tabs with supported url', async () => {
  const { calls, handlers } = createHarness();

  await handlers.handleTabActivated({ tabId: 456 });

  assert.deepEqual(calls, [{ tabId: 456, reason: 'tab-activated' }]);
});

test('handleTabActivated skips unsupported schemes', async () => {
  const { calls, handlers } = createHarness({
    tabUrl: 'chrome://extensions/',
    isUnsupportedScheme: () => true,
  });

  await handlers.handleTabActivated({ tabId: 789 });

  assert.equal(calls.length, 0);
});
