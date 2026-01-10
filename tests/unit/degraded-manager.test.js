import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { performanceMonitor } from '../../background/degraded-manager.js';
import { stateManager } from '../../background/state-manager.js';
import { telemetry } from '../../background/telemetry.js';
import { STORAGE_KEYS } from '../../shared/constants.js';

function setupSessionStorage() {
  const store = new Map();
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: store.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            store.set(key, value);
          });
        },
      },
    },
    tabs: {
      async get() {
        return { url: 'https://example.com' };
      },
    },
  };

  return store;
}

afterEach(() => {
  delete global.chrome;
});

test('checkThresholds is idempotent when degraded already triggered', async () => {
  const store = setupSessionStorage();
  store.set(STORAGE_KEYS.RUNTIME_STATE, { degraded: { triggered: true } });

  performanceMonitor.degradedTriggered = false;

  const originalGetMutationRate = performanceMonitor.getMutationRate;
  const originalGetAverageLatency = performanceMonitor.getAverageLatency;
  const originalGetHeapDelta = performanceMonitor.getHeapDelta;
  const originalTrigger = performanceMonitor.triggerDegraded;

  let triggerCalls = 0;
  performanceMonitor.getMutationRate = async () => 999;
  performanceMonitor.getAverageLatency = async () => 999;
  performanceMonitor.getHeapDelta = async () => 999;
  performanceMonitor.triggerDegraded = async () => {
    triggerCalls += 1;
  };

  await performanceMonitor.checkThresholds();

  assert.equal(triggerCalls, 0);

  performanceMonitor.getMutationRate = originalGetMutationRate;
  performanceMonitor.getAverageLatency = originalGetAverageLatency;
  performanceMonitor.getHeapDelta = originalGetHeapDelta;
  performanceMonitor.triggerDegraded = originalTrigger;
});

test('triggerDegraded records runtime state once', async () => {
  const store = setupSessionStorage();
  store.set(STORAGE_KEYS.RUNTIME_STATE, {});

  performanceMonitor.degradedTriggered = false;

  const originalGetTabsWithActiveMode = stateManager.getTabsWithActiveMode;
  const originalIsModeActive = stateManager.isModeActive;
  const originalUpdateModeState = stateManager.updateModeState;
  const originalTrackDegraded = telemetry.trackDegraded;

  stateManager.getTabsWithActiveMode = async () => [];
  stateManager.isModeActive = async () => false;
  stateManager.updateModeState = async () => {};
  let trackCalls = 0;
  telemetry.trackDegraded = async () => {
    trackCalls += 1;
  };

  await performanceMonitor.triggerDegraded('HIGH_OPERATION_RATE');
  await performanceMonitor.triggerDegraded('HIGH_OPERATION_RATE');

  const runtimeState = store.get(STORAGE_KEYS.RUNTIME_STATE);
  assert.equal(runtimeState.degraded.triggered, true);
  assert.equal(runtimeState.degraded.reason, 'HIGH_OPERATION_RATE');
  assert.equal(trackCalls, 1);

  stateManager.getTabsWithActiveMode = originalGetTabsWithActiveMode;
  stateManager.isModeActive = originalIsModeActive;
  stateManager.updateModeState = originalUpdateModeState;
  telemetry.trackDegraded = originalTrackDegraded;
});
