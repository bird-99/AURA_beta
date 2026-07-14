import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { SpaDetector } from '../../background/spa-detector.js';
import { STORAGE_KEYS } from '../../shared/constants.js';

function eventStub() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    hasListener(listener) { return listeners.has(listener); },
    emit(payload) { for (const listener of listeners) listener(payload); },
    get size() { return listeners.size; },
  };
}

function setupChrome({ granted = false, enabled = true } = {}) {
  let permissionGranted = granted;
  const historyEvent = eventStub();
  const addedEvent = eventStub();
  const removedEvent = eventStub();
  global.chrome = {
    permissions: {
      contains: async () => permissionGranted,
      onAdded: addedEvent,
      onRemoved: removedEvent,
    },
    webNavigation: { onHistoryStateUpdated: historyEvent },
    storage: {
      local: {
        async get(key) {
          return { [key]: key === STORAGE_KEYS.USER_PREFS ? { spaDetectionEnabled: enabled } : undefined };
        },
      },
    },
  };
  return {
    historyEvent,
    addedEvent,
    removedEvent,
    setGranted(value) { permissionGranted = value; },
  };
}

afterEach(() => {
  delete global.chrome;
});

test('SPA detector stays detached while optional permission is absent', async () => {
  const env = setupChrome({ granted: false, enabled: true });
  const detector = new SpaDetector();
  await detector.init();
  assert.equal(detector.enabled, false);
  assert.equal(env.historyEvent.size, 0);
  assert.equal(env.addedEvent.size, 1);
  assert.equal(env.removedEvent.size, 1);
});

test('permission grant enables one listener and repeated init remains idempotent', async () => {
  const env = setupChrome({ granted: false, enabled: true });
  const detector = new SpaDetector();
  await detector.init();
  env.setGranted(true);
  await detector.onPermissionAdded({ permissions: ['webNavigation'] });
  await detector.init();
  assert.equal(detector.enabled, true);
  assert.equal(env.historyEvent.size, 1);
  assert.equal(env.addedEvent.size, 1);
  assert.equal(env.removedEvent.size, 1);
});

test('permission revocation removes listener and a revocation race cannot reapply', async () => {
  const env = setupChrome({ granted: true, enabled: true });
  const detector = new SpaDetector();
  let resetCount = 0;
  let reapplyCount = 0;
  detector.resetTabSignals = async () => { resetCount += 1; };
  detector.reapplyActiveModes = async () => { reapplyCount += 1; };
  await detector.init();
  assert.equal(env.historyEvent.size, 1);

  env.setGranted(false);
  await detector.onSpaNavigation({ tabId: 7, frameId: 0 });
  assert.equal(detector.enabled, false);
  assert.equal(env.historyEvent.size, 0);
  assert.equal(resetCount, 0);
  assert.equal(reapplyCount, 0);

  detector.enabled = true;
  detector.onPermissionRemoved({ permissions: ['webNavigation'] });
  assert.equal(detector.enabled, false);
});
