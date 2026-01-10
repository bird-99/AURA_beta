import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchWithExtension, waitForExtensionReady } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/basic.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

async function setFeatureFlags(serviceWorker, featureFlags) {
  await serviceWorker.evaluate(async (flags) => {
    await chrome.storage.local.set({ featureFlags: flags });
  }, featureFlags);
}

async function injectSuggestionBanner(serviceWorker, payload) {
  return serviceWorker.evaluate(async (message) => {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return { ok: false, error: { message: error?.message || 'send failed' } };
    }
  }, payload);
}

test.describe('Focus scoped sentinel', () => {
  let context;
  let serviceWorker;
  let fixtureHtml;

  test.beforeAll(async () => {
    fixtureHtml = await loadFixtureHtml();
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

  test('applies data-aura-scope when enabling Focus mode', async () => {
    await setFeatureFlags(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => document.documentElement.dataset.auraReady === '1',
      null,
      { timeout: 10000 },
    );
    await waitForExtensionReady(serviceWorker, page);

    const targetPattern = `*://${new URL(page.url()).host}/*`;
    const injectResponse = await injectSuggestionBanner(serviceWorker, {
      action: 'TEST_INJECT_SUGGESTION_BANNER',
      type: 'TEST_INJECT_SUGGESTION_BANNER',
      targetUrl: page.url(),
      targetPattern,
      modeId: 'focus',
      confidence: 0.9,
      signals: [],
    });

    expect(injectResponse?.ok).toBeTruthy();
    await page.getByRole('button', { name: 'Enable' }).click();

    await page.waitForFunction(() => {
      const scope = document.querySelector('[data-aura-scope="1"]');
      return scope && scope.getAttribute('data-aura-scope-owner') === 'aura-me2';
    }, null, { timeout: 10000 });

    const scopeOwner = await page.evaluate(() => {
      const scope = document.querySelector('[data-aura-scope="1"]');
      return scope ? scope.getAttribute('data-aura-scope-owner') : null;
    });

    expect(scopeOwner).toBe('aura-me2');

    await page.close();
  });
});
