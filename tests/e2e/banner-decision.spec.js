import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ACTIONS, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  activateSuggestionBannerAction,
  getAuraTabId,
  launchWithExtension,
  sendMessageToTab,
  showSuggestionBanner,
  waitForAuraReady,
  waitForAuraContentReady,
  waitForStableModeEngine,
} from './helpers/launch-with-extension.js';

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

async function waitForScopedToken(page) {
  await page.waitForFunction(() => {
    const scope = document.querySelector('[data-aura-scope="1"]');
    return scope && scope.getAttribute('data-aura-scope-owner') === 'aura-me2';
  }, null, { timeout: 10000 });
  await waitForStableModeEngine(page);
}

async function waitForRestoreButton(page) {
  await page.waitForSelector('#aura-restore-button', { state: 'attached', timeout: 10000 });
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
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const modeId = MODE_IDS.COMFORT_VISUAL;
    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId,
      score: 0.75,
    });

    expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
    await activateSuggestionBannerAction(page, 'notNow');

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
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const modeId = MODE_IDS.COMFORT_VISUAL;
    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId,
      score: 0.75,
    });

    expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
    await activateSuggestionBannerAction(page, 'enable');
    await waitForScopedToken(page);
    await waitForRestoreButton(page);

    await expect.poll(async () => {
      const response = await showSuggestionBanner(serviceWorker, page, {
        modeId,
        score: 0.7,
      });

      return {
        ok: response?.ok === true,
        suppressed: response?.suppressed === true,
      };
    }).toEqual({ ok: true, suppressed: true });
    await expect(page.locator('#aura-suggestion-banner')).toHaveCount(0);

    await page.close();
  });

  test('keeps suggestion banner visible when enable fails', async () => {
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
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const siteKey = new URL(page.url()).host;
    const modeId = MODE_IDS.COMFORT_VISUAL;
    await serviceWorker.evaluate(
      async ({ site, mode }) => {
        await chrome.storage.local.set({
          siteProfiles: {
            entries: [
              {
                id: 'block-current-fixture',
                action: 'never',
                matchType: 'domain',
                modeId: mode,
                value: site,
              },
            ],
          },
        });
      },
      { site: siteKey, mode: modeId },
    );

    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId,
      score: 0.75,
    });

    expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
    await activateSuggestionBannerAction(page, 'enable');

    await expect(page.locator('#aura-suggestion-banner')).toHaveCount(1);
    await expect.poll(async () => {
      return serviceWorker.evaluate(async ({ site, mode }) => {
        const { perDomainPrefs } = await chrome.storage.local.get('perDomainPrefs');
        return perDomainPrefs?.[site]?.[mode] || null;
      }, { site: siteKey, mode: modeId });
    }, {
      timeout: 10000,
      intervals: [100, 250, 500, 1000],
    }).toMatchObject({ userIntent: 'ENABLED' });
    const prefs = await serviceWorker.evaluate(async ({ site, mode }) => {
      const { perDomainPrefs } = await chrome.storage.local.get('perDomainPrefs');
      return perDomainPrefs?.[site]?.[mode] || null;
    }, { site: siteKey, mode: modeId });
    expect(prefs?.userIntent).toBe('ENABLED');
    expect(prefs?.decision ?? null).toBe(null);

    await page.close();
  });

  test('production Never decision persists denylist and removes the banner', async () => {
    await resetStorage(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fixtureHtml,
    }));

    await page.goto(targetUrl);
    await waitForAuraReady(serviceWorker, page);
    const modeId = MODE_IDS.COMFORT_VISUAL;
    const response = await showSuggestionBanner(serviceWorker, page, { modeId, score: 0.8 });
    expect(response.ok).toBe(true);
    await activateSuggestionBannerAction(page, 'never');

    const siteKey = new URL(page.url()).host;
    await expect.poll(() => serviceWorker.evaluate(async ({ site, mode }) => {
      const { perDomainPrefs, denylist } = await chrome.storage.local.get(['perDomainPrefs', 'denylist']);
      return {
        decision: perDomainPrefs?.[site]?.[mode]?.decision || null,
        denied: Array.isArray(denylist) && denylist.includes(site),
      };
    }, { site: siteKey, mode: modeId })).toEqual({ decision: 'NEVER', denied: true });
    await expect(page.locator('[data-aura-ui-owner="suggestion-banner"]')).toHaveCount(0);

    await page.close();
  });

  test('production site policy blocks the banner without reporting success', async () => {
    await resetStorage(serviceWorker);
    await serviceWorker.evaluate(async ({ flagsKey, failuresKey, site }) => {
      await chrome.storage.local.set({
        [flagsKey]: { siteSuppressV1: true },
        [failuresKey]: {
          [site]: {
            failCount: 3,
            windowStartAt: Date.now(),
            lastFailAt: Date.now(),
            lastFailReason: 'NO_RECEIVER',
            blockedUntil: Date.now() + 60_000,
          },
        },
      });
    }, {
      flagsKey: STORAGE_KEYS.FEATURE_FLAGS,
      failuresKey: STORAGE_KEYS.SITE_FAILURES_V1,
      site: 'aura.local',
    });

    const page = await context.newPage();
    await page.route('http://aura.local/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fixtureHtml,
    }));
    await page.goto(targetUrl);
    await waitForAuraReady(serviceWorker, page);

    const response = await showSuggestionBanner(serviceWorker, page, {
      modeId: MODE_IDS.COMFORT_VISUAL,
      score: 0.8,
    });
    expect(response).toMatchObject({
      ok: false,
      received: false,
      suppressed: true,
      error: 'SITE_POLICY_DENIED',
    });
    await expect(page.locator('[data-aura-ui-owner="suggestion-banner"]')).toHaveCount(0);
    await page.close();
  });

  test('keyboard Restore follows the real lifecycle and removes active effects', async () => {
    await resetStorage(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fixtureHtml,
    }));
    await page.goto(targetUrl);
    await waitForAuraReady(serviceWorker, page);
    const tabId = await getAuraTabId(serviceWorker, page);
    const modeId = MODE_IDS.COMFORT_VISUAL;

    expect((await showSuggestionBanner(serviceWorker, page, { modeId, score: 0.8 })).ok).toBe(true);
    await activateSuggestionBannerAction(page, 'enable');
    await waitForScopedToken(page);
    await waitForRestoreButton(page);

    let restoreFocused = false;
    for (let index = 0; index < 20 && !restoreFocused; index += 1) {
      await page.keyboard.press('Tab');
      restoreFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-aura-ui-owner') === 'restore-button');
    }
    expect(restoreFocused).toBe(true);
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-aura-scope="1"]')).toHaveCount(0);
    await expect(page.locator('[data-aura-ui-owner="restore-button"]')).toHaveCount(0);
    await expect.poll(() => serviceWorker.evaluate(async ({ key, id, mode }) => {
      const stored = await chrome.storage.session.get(key);
      return stored?.[key]?.[id]?.[mode]?.state || null;
    }, { key: STORAGE_KEYS.TAB_STATE, id: tabId, mode: modeId })).toBe(STATES.INACTIVE);

    await page.close();
  });

  test('Banner and Restore preserve page-owned colliding ids exactly', async () => {
    await resetStorage(serviceWorker);
    const collisionHtml = `<!doctype html><html><body>
      <main>Collision fixture</main>
      <div id="aura-suggestion-banner" data-aura-ui-owner="suggestion-banner" data-page-owner="banner" style="color: red !important">page banner</div>
      <div id="aura-restore-button" data-aura-ui-owner="restore-button" data-page-owner="restore" style="color: blue !important">page restore</div>
    </body></html>`;
    const page = await context.newPage();
    await page.route('http://aura.local/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: collisionHtml,
    }));
    await page.goto(targetUrl);
    await waitForAuraReady(serviceWorker, page);
    const tabId = await getAuraTabId(serviceWorker, page);

    expect((await showSuggestionBanner(serviceWorker, page, {
      modeId: MODE_IDS.COMFORT_VISUAL,
      score: 0.8,
    })).ok).toBe(true);
    await expect(page.locator('#aura-suggestion-banner-aura[data-aura-ui-owner="suggestion-banner"]')).toHaveCount(1);
    expect(await page.locator('#aura-suggestion-banner[data-page-owner="banner"]').evaluate((element) => ({
      text: element.textContent,
      color: element.style.getPropertyValue('color'),
      priority: element.style.getPropertyPriority('color'),
    }))).toEqual({ text: 'page banner', color: 'red', priority: 'important' });

    expect((await sendMessageToTab(serviceWorker, tabId, {
      action: ACTIONS.INJECT_RESTORE_BUTTON,
      modeId: MODE_IDS.COMFORT_VISUAL,
    }, { frameId: 0 })).ok).toBe(true);

    await expect(page.locator('#aura-suggestion-banner-aura')).toHaveCount(0);
    await expect(page.locator('#aura-restore-button-aura[data-aura-ui-owner="restore-button"]')).toHaveCount(1);
    expect(await page.locator('#aura-restore-button[data-page-owner="restore"]').evaluate((element) => ({
      text: element.textContent,
      color: element.style.getPropertyValue('color'),
      priority: element.style.getPropertyPriority('color'),
    }))).toEqual({ text: 'page restore', color: 'blue', priority: 'important' });

    await sendMessageToTab(serviceWorker, tabId, {
      action: ACTIONS.REMOVE_RESTORE_BUTTON,
      modeId: MODE_IDS.COMFORT_VISUAL,
    }, { frameId: 0 });
    await expect(page.locator('#aura-suggestion-banner-aura, #aura-restore-button-aura')).toHaveCount(0);
    await expect(page.locator('#aura-suggestion-banner[data-page-owner="banner"]')).toHaveText('page banner');
    await expect(page.locator('#aura-restore-button[data-page-owner="restore"]')).toHaveText('page restore');

    await page.close();
  });
});
