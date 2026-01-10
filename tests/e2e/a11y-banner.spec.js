import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './axe-helpers.js';
import { launchWithExtension, waitForExtensionReady } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

test.describe('Suggestion banner accessibility', () => {
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

  test('has no serious accessibility violations', async () => {
    const page = await context.newPage();
    await page.goto('https://example.com/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => document.documentElement.dataset.auraReady === '1',
      null,
      { timeout: 10000 },
    );
    await waitForExtensionReady(serviceWorker, page);

    const targetPattern = `*://${new URL(page.url()).host}/*`;

    const injectResponse = await serviceWorker.evaluate(async (payload) => {
      try {
        return await chrome.runtime.sendMessage(payload);
      } catch (error) {
        return { ok: false, error: { message: error?.message || 'send failed' } };
      }
    }, {
      action: 'TEST_INJECT_SUGGESTION_BANNER',
      type: 'TEST_INJECT_SUGGESTION_BANNER',
      targetUrl: page.url(),
      targetPattern,
      modeId: 'comfort-visual',
      confidence: 0.75,
      signals: [],
    });

    if (!injectResponse?.ok) {
      // Surfacing failure details helps CI logs without affecting runtime behaviour
      console.error('Banner inject error (TEST):', injectResponse);
    }

    expect(injectResponse?.ok).toBeTruthy();

    const tabId = injectResponse?.tabId;
    expect(tabId).toBeDefined();

    await page.waitForSelector('[role="status"][aria-live="polite"]');

    await expectNoSeriousA11yViolations(page);

    await serviceWorker.evaluate(async (payload) => {
      try {
        return await chrome.runtime.sendMessage(payload);
      } catch (error) {
        return { ok: false, error: { message: error?.message || 'send failed' } };
      }
    }, {
      action: 'TEST_CLEAR_SUGGESTION_BANNER',
      tabId,
    });

    await page.close();
  });
});
