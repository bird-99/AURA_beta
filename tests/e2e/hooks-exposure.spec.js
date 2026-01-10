import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchWithExtension } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

async function setFeatureFlags(serviceWorker, featureFlags) {
  await serviceWorker.evaluate(async (flags) => {
    await chrome.storage.local.set({ featureFlags: flags });
  }, featureFlags);
}

async function getAuraPresence(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return false;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'ISOLATED',
      func: () => typeof globalThis.AURA !== 'undefined',
    });

    return results?.[0]?.result === true;
  });
}

test.describe('Test hook exposure', () => {
  let context;
  let serviceWorker;

  test.beforeAll(async () => {
    ({ context } = await launchWithExtension({
      extensionPath,
      headless: true,
      verbose: !!process.env.CI,
    }));

    serviceWorker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('does not expose window.AURA in production mode', async () => {
    await setFeatureFlags(serviceWorker, { debugTestHooks: false });

    const page = await context.newPage();
    await page.goto('https://example.com/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => document.documentElement.dataset.auraReady === '1', null, { timeout: 10000 });
    await page.bringToFront();

    const hasAura = await getAuraPresence(serviceWorker);
    expect(hasAura).toBe(false);

    await page.close();
  });

  test('exposes window.AURA when debug test hooks are enabled', async () => {
    await setFeatureFlags(serviceWorker, { debugTestHooks: true });

    const page = await context.newPage();
    await page.goto('https://example.com/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => document.documentElement.dataset.auraReady === '1', null, { timeout: 10000 });
    await page.bringToFront();

    const hasAura = await getAuraPresence(serviceWorker);
    expect(hasAura).toBe(true);

    await page.close();
  });
});
