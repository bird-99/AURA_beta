import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './axe-helpers.js';
import {
  launchWithExtension,
  showSuggestionBanner,
  waitForAuraContentReady,
  waitForAuraReady,
} from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/basic.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

test.describe('Suggestion banner accessibility', () => {
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

  test('has no serious accessibility violations', async () => {
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
        return;
      }

      await route.fulfill({ status: 404, body: '' });
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId: 'comfort-visual',
      score: 0.75,
    });

    if (!injectResponse?.ok) {
      // Surfacing failure details helps CI logs without affecting runtime behaviour
      console.error('Banner inject error:', injectResponse);
    }

    expect(injectResponse?.ok).toBeTruthy();

    await page.waitForSelector('#aura-suggestion-banner[role="status"][aria-live="polite"]', {
      state: 'attached',
    });

    await expectNoSeriousA11yViolations(page);

    await page.close();
  });
});
