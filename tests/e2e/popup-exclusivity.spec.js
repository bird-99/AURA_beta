import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchWithExtension } from './helpers/launch-with-extension.js';
import { STATES } from '../../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/basic.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

async function getTabIdForUrl(serviceWorker, url) {
  return serviceWorker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => tab.url === target);
    return match?.id ?? null;
  }, url);
}

async function getModeStates(serviceWorker, tabId) {
  return serviceWorker.evaluate(async (targetTabId) => {
    const { tabState } = await chrome.storage.session.get('tabState');
    const entry = tabState?.[targetTabId] || {};
    return {
      comfort: entry['comfort-visual']?.state ?? null,
      focus: entry['focus']?.state ?? null,
    };
  }, tabId);
}

test.describe('Popup exclusivity', () => {
  let context;
  let serviceWorker;
  let fixtureHtml;
  let extensionId;

  test.beforeAll(async () => {
    fixtureHtml = await loadFixtureHtml();
    ({ context, extensionId } = await launchWithExtension({
      extensionPath,
      headless: true,
      verbose: !!process.env.CI,
    }));

    serviceWorker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('switching Comfort Visual to Focus keeps only one ACTIVE', async () => {
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

    const tabId = await getTabIdForUrl(serviceWorker, targetUrl);
    expect(tabId).not.toBeNull();

    const popupPage = await context.newPage();
    await popupPage.addInitScript(({ resolvedTabId, resolvedTabUrl }) => {
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (queryInfo) => {
        if (queryInfo?.active && queryInfo?.currentWindow) {
          return [{ id: resolvedTabId, url: resolvedTabUrl }];
        }
        return originalQuery(queryInfo);
      };
    }, { resolvedTabId: tabId, resolvedTabUrl: targetUrl });

    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.getByTestId('popup-root').waitFor();

    await popupPage.getByRole('button', { name: 'Enable Comfort Visual mode' }).click();

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.comfort;
    }).toBe(STATES.ACTIVE);

    const comfortFirstPass = await getModeStates(serviceWorker, tabId);
    expect(comfortFirstPass.focus).not.toBe(STATES.ACTIVE);

    await popupPage.getByRole('button', { name: 'Enable Focus mode' }).click();

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.focus;
    }).toBe(STATES.ACTIVE);

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.comfort;
    }).toBe(STATES.INACTIVE);

    await popupPage.close();
    await page.close();
  });
});
