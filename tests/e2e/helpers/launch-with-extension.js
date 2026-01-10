import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const SERVICE_WORKER_TIMEOUT_MS = 10000;
const EXTENSION_READY_TIMEOUT_MS = 10000;
const EXTENSION_READY_RETRY_MS = 250;

export async function launchWithExtension({ extensionPath, headless = true, slowMoMs, verbose = false }) {
  if (!extensionPath) {
    throw new Error('launchWithExtension: extensionPath is required');
  }

  const resolvedExtensionPath = path.resolve(extensionPath);
  const manifestPath = path.join(resolvedExtensionPath, 'manifest.json');

  try {
    await fs.access(manifestPath);
  } catch (error) {
    throw new Error(`launchWithExtension: manifest.json not found at ${manifestPath}`);
  }

  const userDataDir = await fs.mkdtemp(path.join(tmpdir(), 'aura-playwright-'));

  const args = [
    `--disable-extensions-except=${resolvedExtensionPath}`,
    `--load-extension=${resolvedExtensionPath}`,
  ];

  if (verbose) {
    console.log('[launchWithExtension] Using extension path:', resolvedExtensionPath);
    console.log('[launchWithExtension] Headless:', headless);
    console.log('[launchWithExtension] Channel: chromium');
    console.log('[launchWithExtension] Args:', args.join(' '));
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    channel: 'chromium',
    args,
    slowMo: slowMoMs,
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    if (verbose) {
      console.log('[launchWithExtension] Waiting for extension service worker...');
    }

    try {
      worker = await context.waitForEvent('serviceworker', { timeout: SERVICE_WORKER_TIMEOUT_MS });
    } catch (error) {
      await context.close();
      throw new Error(`launchWithExtension: service worker not detected within ${SERVICE_WORKER_TIMEOUT_MS}ms`);
    }
  }

  const workerUrl = worker.url();
  const [, , extensionId] = workerUrl.split('/');

  if (!extensionId) {
    await context.close();
    throw new Error(`launchWithExtension: could not determine extensionId from service worker URL (${workerUrl})`);
  }

  if (verbose) {
    console.log('[launchWithExtension] Extension ID:', extensionId);
  }

  return { context, extensionId };
}

async function enableDebugTestHooks(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    const { featureFlags } = await chrome.storage.local.get('featureFlags');
    await chrome.storage.local.set({
      featureFlags: {
        ...(featureFlags || {}),
        debugTestHooks: true,
      },
    });
  });
}

export async function waitForExtensionReady(
  serviceWorker,
  page,
  { timeoutMs = EXTENSION_READY_TIMEOUT_MS, retryMs = EXTENSION_READY_RETRY_MS, verbose = false } = {},
) {
  if (!serviceWorker || !page) {
    throw new Error('waitForExtensionReady: serviceWorker and page are required');
  }

  await enableDebugTestHooks(serviceWorker);

  const start = Date.now();
  const pageUrl = page.url();

  while (Date.now() - start < timeoutMs) {
    const result = await serviceWorker.evaluate(async (url) => {
      const target = new URL(url);
      const tabs = await chrome.tabs.query({ url: [`*://${target.host}/*`] });
      const exactMatch = tabs.find(
        (tab) => tab?.url === url || tab?.pendingUrl === url,
      );
      const resolved = exactMatch || tabs.find((tab) => typeof tab?.id === 'number');

      if (!resolved?.id) {
        return { ok: false, reason: 'NO_TAB' };
      }

      try {
        const response = await chrome.tabs.sendMessage(resolved.id, { type: 'AURA_PING_TEST_V1' });
        return { ok: response?.ok === true && response?.type === 'AURA_PONG_TEST_V1' };
      } catch (error) {
        return { ok: false, error: error?.message || 'send failed' };
      }
    }, pageUrl);

    if (result?.ok) {
      return;
    }

    if (verbose) {
      console.log('[waitForExtensionReady] Waiting for content script...', result);
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  throw new Error(`waitForExtensionReady: timed out after ${timeoutMs}ms`);
}
