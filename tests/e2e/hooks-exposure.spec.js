import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  getAuraTabId,
  launchWithExtension,
  setFeatureFlagsForTest,
  waitForAuraContentReady,
} from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/basic.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

async function routeFixture(page, fixtureHtml) {
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
}

async function getAuraPresence(serviceWorker, page) {
  const tabId = await getAuraTabId(serviceWorker, page);
  if (typeof tabId !== 'number') {
    return { isolated: false, main: false };
  }

  return serviceWorker.evaluate(async (id) => {
    async function hasAuraInWorld(world) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: id },
        world,
        func: () => typeof globalThis.AURA !== 'undefined',
      });

      return results?.[0]?.result === true;
    }

    return {
      isolated: await hasAuraInWorld('ISOLATED'),
      main: await hasAuraInWorld('MAIN'),
    };
  }, tabId);
}

test.describe('Test hook exposure', () => {
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

  test('does not expose window.AURA in production mode', async () => {
    await setFeatureFlagsForTest(serviceWorker, { debugTestHooks: false });

    const page = await context.newPage();
    await routeFixture(page, fixtureHtml);
    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await page.bringToFront();

    await expect.poll(async () => getAuraPresence(serviceWorker, page)).toEqual({
      isolated: false,
      main: false,
    });

    await page.close();
  });

  test('exposes window.AURA when debug test hooks are enabled', async () => {
    await setFeatureFlagsForTest(serviceWorker, { debugTestHooks: true });

    const page = await context.newPage();
    await routeFixture(page, fixtureHtml);
    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await page.bringToFront();

    await expect.poll(async () => getAuraPresence(serviceWorker, page)).toEqual({
      isolated: true,
      main: false,
    });

    await page.close();
  });
});
