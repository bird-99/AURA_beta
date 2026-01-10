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

async function resetStorage(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
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

async function getTabId(serviceWorker, url) {
  return serviceWorker.evaluate(async (pageUrl) => {
    const target = new URL(pageUrl);
    const tabs = await chrome.tabs.query({ url: [`*://${target.host}/*`] });
    const exactMatch = tabs.find(
      (tab) => tab?.url === pageUrl || tab?.pendingUrl === pageUrl,
    );
    const resolved = exactMatch || tabs.find((tab) => typeof tab?.id === 'number');
    return typeof resolved?.id === 'number' ? resolved.id : null;
  }, url);
}

async function sendMessageToTab(serviceWorker, tabId, message) {
  return serviceWorker.evaluate(async ({ id, payload }) => {
    try {
      return await chrome.tabs.sendMessage(id, payload);
    } catch (error) {
      return { ok: false, error: { message: error?.message || 'send failed' } };
    }
  }, { id: tabId, payload: message });
}

async function waitForAuraReady(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.auraReady === '1',
    null,
    { timeout: 10000 },
  );
}

async function waitForScopedToken(page) {
  await page.waitForFunction(() => {
    const scope = document.querySelector('[data-aura-scope="1"]');
    return scope && scope.getAttribute('data-aura-scope-owner') === 'aura-me2';
  }, null, { timeout: 10000 });
}

test.describe('Banner decision flow', () => {
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

  test('clicking Not now sends NOT_NOW and creates a cooldown', async () => {
    await resetStorage(serviceWorker);
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
    await waitForAuraReady(page);
    await waitForExtensionReady(serviceWorker, page);

    const targetPattern = `*://${new URL(page.url()).host}/*`;
    const modeId = 'comfort-visual';
    const injectResponse = await injectSuggestionBanner(serviceWorker, {
      action: 'TEST_INJECT_SUGGESTION_BANNER',
      type: 'TEST_INJECT_SUGGESTION_BANNER',
      targetUrl: page.url(),
      targetPattern,
      modeId,
      confidence: 0.75,
      signals: [],
    });

    expect(injectResponse?.ok).toBeTruthy();
    await page.getByRole('button', { name: 'Not now' }).click();

    const siteKey = new URL(page.url()).host;

    await expect.poll(async () => {
      return serviceWorker.evaluate(async ({ siteKey: site, mode }) => {
        const { perDomainPrefs, cooldowns } = await chrome.storage.local.get([
          'perDomainPrefs',
          'cooldowns',
        ]);

        return {
          decision: perDomainPrefs?.[site]?.[mode]?.decision ?? null,
          hasCooldown: typeof cooldowns?.[site]?.[mode]?.until === 'number',
        };
      }, { siteKey, mode: modeId });
    }).toEqual({ decision: 'NOT_NOW', hasCooldown: true });

    const denylisted = await serviceWorker.evaluate(async (site) => {
      const { denylist } = await chrome.storage.local.get(['denylist']);
      return Array.isArray(denylist) ? denylist.includes(site) : false;
    }, siteKey);

    expect(denylisted).toBe(false);

    await page.close();
  });

  test('suppresses suggestion banner when a mode is active', async () => {
    await resetStorage(serviceWorker);
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
    await waitForAuraReady(page);
    await waitForExtensionReady(serviceWorker, page);

    const tabId = await getTabId(serviceWorker, page.url());
    expect(typeof tabId).toBe('number');

    const modeId = 'comfort-visual';
    const injectResponse = await sendMessageToTab(serviceWorker, tabId, {
      action: 'TEST_INJECT_SUGGESTION_BANNER',
      modeId,
      confidence: 0.75,
      signals: [],
    });

    expect(injectResponse?.ok).toBeTruthy();
    await page.getByRole('button', { name: 'Enable' }).click();
    await waitForScopedToken(page);

    const suppressedResponse = await sendMessageToTab(serviceWorker, tabId, {
      action: 'TEST_INJECT_SUGGESTION_BANNER',
      modeId,
      confidence: 0.7,
      signals: [],
    });

    expect(suppressedResponse?.ok).toBeTruthy();
    expect(suppressedResponse?.suppressed).toBe(true);
    await expect(page.locator('#aura-suggestion-banner')).toHaveCount(0);

    await page.close();
  });
});
