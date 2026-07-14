import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuraServiceWorkerRestartController } from '../e2e/helpers/service-worker-restart.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createFakeCdp() {
  const listeners = new Map();
  const sent = [];
  let closeTargetHandler = async () => {};
  let detachHandler = async () => {};
  let detachCalls = 0;

  return {
    sent,
    get detachCalls() {
      return detachCalls;
    },
    on(eventName, listener) {
      const eventListeners = listeners.get(eventName) || new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    off(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
    listenerCount(eventName) {
      return listeners.get(eventName)?.size || 0;
    },
    emit(eventName, payload) {
      for (const listener of listeners.get(eventName) || []) {
        listener(payload);
      }
    },
    onCloseTarget(handler) {
      closeTargetHandler = handler;
    },
    onDetach(handler) {
      detachHandler = handler;
    },
    async send(method, params) {
      sent.push({ method, params });
      if (method === 'Target.closeTarget') {
        await closeTargetHandler(params);
      }
      return {};
    },
    async detach() {
      detachCalls += 1;
      await detachHandler();
    },
  };
}

function createContext(cdp) {
  return {
    async newCDPSession() {
      return cdp;
    },
  };
}

function workerVersion(scriptUrl, overrides = {}) {
  return {
    scriptURL: scriptUrl,
    versionId: 'version-1',
    runningStatus: 'running',
    targetId: 'target-1',
    ...overrides,
  };
}

test('service worker restart stop closes the running target and waits for stopped', async () => {
  const cdp = createFakeCdp();
  const controller = await createAuraServiceWorkerRestartController(
    createContext(cdp),
    {},
    'aura-extension',
    { timeoutMs: 500 },
  );

  assert.deepEqual(cdp.sent, [{ method: 'ServiceWorker.enable', params: undefined }]);

  cdp.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      workerVersion(controller.scriptUrl),
      workerVersion('chrome-extension://other/background/service-worker.js', {
        versionId: 'ignored',
        targetId: 'ignored-target',
      }),
    ],
  });

  cdp.onCloseTarget(async ({ targetId }) => {
    assert.equal(targetId, 'target-1');
    cdp.emit('ServiceWorker.workerVersionUpdated', {
      versions: [
        workerVersion(controller.scriptUrl, {
          runningStatus: 'stopped',
          targetId: undefined,
        }),
      ],
    });
  });

  const stopped = await controller.stop();

  assert.deepEqual(stopped, {
    versionId: 'version-1',
    targetId: 'target-1',
    stoppedSequence: 2,
  });
  assert.deepEqual(
    cdp.sent.map(({ method }) => method),
    ['ServiceWorker.enable', 'Target.closeTarget'],
  );

  await controller.dispose();
});

test('waitForRunningAfter ignores old running sequences and accepts a newer one', async () => {
  const cdp = createFakeCdp();
  const controller = await createAuraServiceWorkerRestartController(
    createContext(cdp),
    {},
    'aura-extension',
    { timeoutMs: 500 },
  );

  cdp.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      workerVersion(controller.scriptUrl, {
        versionId: 'old-version',
        targetId: 'old-target',
      }),
    ],
  });

  const waitForRestart = controller.waitForRunningAfter(1);
  const oldSequenceResult = await Promise.race([
    waitForRestart.then(() => 'resolved'),
    sleep(30).then(() => 'pending'),
  ]);

  assert.equal(oldSequenceResult, 'pending');

  cdp.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      workerVersion(controller.scriptUrl, {
        versionId: 'new-version',
        targetId: 'new-target',
      }),
    ],
  });

  const restarted = await waitForRestart;

  assert.equal(restarted.versionId, 'new-version');
  assert.equal(restarted.targetId, 'new-target');
  assert.equal(restarted.seenSequence, 2);

  await controller.dispose();
});

test('waitForRunningAfter ignores running versions without a targetId', async () => {
  const cdp = createFakeCdp();
  const controller = await createAuraServiceWorkerRestartController(
    createContext(cdp),
    {},
    'aura-extension',
    { timeoutMs: 500, pollIntervalMs: 1 },
  );

  const waitForRestart = controller.waitForRunningAfter(0);

  cdp.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      workerVersion(controller.scriptUrl, {
        versionId: 'missing-target',
        targetId: undefined,
      }),
    ],
  });

  const missingTargetResult = await Promise.race([
    waitForRestart.then(() => 'resolved'),
    sleep(30).then(() => 'pending'),
  ]);

  assert.equal(missingTargetResult, 'pending');

  cdp.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      workerVersion(controller.scriptUrl, {
        versionId: 'new-version',
        targetId: 'new-target',
      }),
    ],
  });

  const restarted = await waitForRestart;

  assert.equal(restarted.versionId, 'new-version');
  assert.equal(restarted.targetId, 'new-target');
  assert.equal(restarted.seenSequence, 2);

  await controller.dispose();
});

test('dispose removes the CDP listener and detaches the session', async () => {
  const cdp = createFakeCdp();
  const controller = await createAuraServiceWorkerRestartController(
    createContext(cdp),
    {},
    'aura-extension',
    { timeoutMs: 100 },
  );

  assert.equal(cdp.listenerCount('ServiceWorker.workerVersionUpdated'), 1);

  await controller.dispose();

  assert.equal(cdp.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
  assert.equal(cdp.detachCalls, 1);
});

test('dispose swallows CDP detach failures after removing the listener', async () => {
  const cdp = createFakeCdp();
  const controller = await createAuraServiceWorkerRestartController(
    createContext(cdp),
    {},
    'aura-extension',
    { timeoutMs: 100 },
  );

  cdp.onDetach(async () => {
    throw new Error('detach failed');
  });

  await controller.dispose();

  assert.equal(cdp.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
  assert.equal(cdp.detachCalls, 1);
});
