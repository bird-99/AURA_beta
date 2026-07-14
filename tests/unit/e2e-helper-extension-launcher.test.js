import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { chromium } from '@playwright/test';

import { launchWithExtension } from '../e2e/helpers/extension-launcher.js';

async function createExtensionFixture() {
  const extensionPath = await fs.mkdtemp(path.join(tmpdir(), 'aura-extension-fixture-'));
  await fs.writeFile(
    path.join(extensionPath, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'AURA test extension',
      version: '0.0.0',
      background: { service_worker: 'background/service-worker.js' },
    }),
  );
  return extensionPath;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function createWorker(url) {
  return { url: () => url };
}

function createContext({
  serviceWorkers = [],
  waitForEvent = async () => {
    throw new Error('service worker unavailable');
  },
} = {}) {
  const state = {
    closeCalls: 0,
    waitForEventCalls: [],
  };

  return {
    state,
    serviceWorkers: () => serviceWorkers,
    waitForEvent: async (eventName, options) => {
      state.waitForEventCalls.push({ eventName, options });
      return waitForEvent(eventName, options);
    },
    close: async () => {
      state.closeCalls += 1;
    },
  };
}

test('launchWithExtension retries failures, extracts extensionId, and closes idempotently', async (t) => {
  const extensionPath = await createExtensionFixture();
  t.after(async () => {
    await fs.rm(extensionPath, { recursive: true, force: true });
  });

  const userDataDirs = [];
  const contexts = [];
  let attempts = 0;

  t.mock.method(chromium, 'launchPersistentContext', async (userDataDir, options) => {
    attempts += 1;
    userDataDirs.push(userDataDir);

    assert.equal(options.headless, true);
    assert.equal(options.channel, 'chromium');
    assert.equal(options.reducedMotion, 'reduce');
    assert.equal(options.slowMo, 7);
    assert.deepEqual(options.args, [
      `--disable-extensions-except=${path.resolve(extensionPath)}`,
      `--load-extension=${path.resolve(extensionPath)}`,
    ]);

    if (attempts < 3) {
      throw new Error(`launch failed ${attempts}`);
    }

    const context = createContext({
      serviceWorkers: [
        createWorker('chrome-extension://fake-extension-id/background/service-worker.js'),
      ],
    });
    contexts.push(context);
    return context;
  });

  const result = await launchWithExtension({
    extensionPath,
    slowMoMs: 7,
  });

  assert.equal(attempts, 3);
  assert.equal(result.extensionId, 'fake-extension-id');
  assert.equal(result.context, contexts[0]);
  assert.equal(result.userDataDir, userDataDirs[2]);

  assert.equal(await pathExists(userDataDirs[0]), false);
  assert.equal(await pathExists(userDataDirs[1]), false);
  assert.equal(await pathExists(result.userDataDir), true);

  await result.context.close();
  await result.context.close();

  assert.equal(contexts[0].state.closeCalls, 1);
  assert.equal(await pathExists(result.userDataDir), false);
});

test('launchWithExtension closes contexts and removes userDataDirs when all attempts fail', async (t) => {
  const extensionPath = await createExtensionFixture();
  t.after(async () => {
    await fs.rm(extensionPath, { recursive: true, force: true });
  });

  const userDataDirs = [];
  const contexts = [];

  t.mock.method(chromium, 'launchPersistentContext', async (userDataDir) => {
    userDataDirs.push(userDataDir);
    const context = createContext();
    contexts.push(context);
    return context;
  });

  await assert.rejects(
    () => launchWithExtension({ extensionPath }),
    /launchWithExtension: service worker not detected within 20000ms/,
  );

  assert.equal(userDataDirs.length, 3);
  assert.equal(contexts.length, 3);

  for (const context of contexts) {
    assert.equal(context.state.closeCalls, 1);
    assert.equal(context.state.waitForEventCalls.length, 1);
    assert.equal(context.state.waitForEventCalls[0].eventName, 'serviceworker');
    assert.deepEqual(context.state.waitForEventCalls[0].options, { timeout: 20000 });
  }

  for (const userDataDir of userDataDirs) {
    assert.equal(await pathExists(userDataDir), false);
  }
});

test('launchWithExtension waits for the serviceworker event when no worker is registered yet', async (t) => {
  const extensionPath = await createExtensionFixture();
  t.after(async () => {
    await fs.rm(extensionPath, { recursive: true, force: true });
  });

  let context;
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    context = createContext({
      waitForEvent: async () => createWorker('chrome-extension://event-extension/background/service-worker.js'),
    });
    return context;
  });

  const result = await launchWithExtension({ extensionPath });

  assert.equal(result.extensionId, 'event-extension');
  assert.deepEqual(context.state.waitForEventCalls, [{
    eventName: 'serviceworker',
    options: { timeout: 20000 },
  }]);

  await result.context.close();
});

test('launchWithExtension closes failed contexts and retries invalid worker URLs', async (t) => {
  const extensionPath = await createExtensionFixture();
  t.after(async () => {
    await fs.rm(extensionPath, { recursive: true, force: true });
  });

  const userDataDirs = [];
  const invalidContext = createContext({
    serviceWorkers: [createWorker('chrome-extension:///background/service-worker.js')],
  });
  const validContext = createContext({
    serviceWorkers: [createWorker('chrome-extension://valid-extension/background/service-worker.js')],
  });

  t.mock.method(chromium, 'launchPersistentContext', async (userDataDir) => {
    userDataDirs.push(userDataDir);
    return userDataDirs.length === 1 ? invalidContext : validContext;
  });

  const result = await launchWithExtension({ extensionPath });

  assert.equal(result.extensionId, 'valid-extension');
  assert.equal(userDataDirs.length, 2);
  assert.equal(invalidContext.state.closeCalls, 1);
  assert.equal(await pathExists(userDataDirs[0]), false);
  assert.equal(await pathExists(userDataDirs[1]), true);

  await result.context.close();

  assert.equal(validContext.state.closeCalls, 1);
  assert.equal(await pathExists(userDataDirs[1]), false);
});
