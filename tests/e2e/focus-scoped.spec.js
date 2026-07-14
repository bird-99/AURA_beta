import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  activateSuggestionBannerAction,
  getAuraTabId,
  launchWithExtension,
  sendMessageToTab,
  sendRuntimeMessageFromExtensionPage,
  setFeatureFlagsForTest,
  showSuggestionBanner,
  waitForAuraReady,
  waitForAuraContentReady,
  waitForStableModeEngine,
} from './helpers/launch-with-extension.js';
import { ACTIONS, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/basic.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

async function routeFixture(page, fixtureHtml) {
  await page.route('http://aura.local/**', async (route) => {
    if (route.request().url().startsWith(targetUrl)) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
}

async function openFixture(page, serviceWorker, url = targetUrl) {
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await waitForAuraContentReady(page);
  await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
}

async function activateFocus(serviceWorker, page) {
  const injectResponse = await showSuggestionBanner(serviceWorker, page, {
    modeId: MODE_IDS.FOCUS,
    confidence: 0.9,
    signals: [],
  });
  expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
  await activateSuggestionBannerAction(page, 'enable');
  await page.waitForFunction(() => {
    const scope = document.querySelector('[data-aura-scope="1"]');
    return scope && scope.getAttribute('data-aura-scope-owner') === 'aura-me2';
  }, null, { timeout: 10000 });
  await waitForStableModeEngine(page);
}

function buildFocusPrefs(enabled) {
  return {
    modePrefs: {
      [MODE_IDS.FOCUS]: {
        distractionDim: enabled,
        targetBoost: enabled,
        reduceMotion: true,
        readingRuler: enabled,
        focusNotObscured: true,
      },
    },
  };
}

async function setStoredFocusPrefs(serviceWorker, enabled) {
  await serviceWorker.evaluate(async ({ storageKey, modeId, nextEnabled }) => {
    const stored = await chrome.storage.local.get(storageKey);
    const prefs = stored?.[storageKey] || {};
    await chrome.storage.local.set({
      [storageKey]: {
        ...prefs,
        modePrefs: {
          ...(prefs.modePrefs || {}),
          [modeId]: {
            ...(prefs.modePrefs?.[modeId] || {}),
            distractionDim: nextEnabled,
            targetBoost: nextEnabled,
            reduceMotion: true,
            readingRuler: nextEnabled,
            focusNotObscured: true,
          },
        },
      },
    });
  }, {
    storageKey: STORAGE_KEYS.USER_PREFS,
    modeId: MODE_IDS.FOCUS,
    nextEnabled: enabled,
  });
}

async function readFocusArtifacts(page) {
  return page.evaluate(() => ({
    overlay: document.querySelectorAll('[data-aura-focus-overlay]').length,
    ruler: document.querySelectorAll('[data-aura-reading-ruler]').length,
    ultraFocus: document.querySelectorAll('[data-aura-ultra-focus]').length,
    boosted: document.querySelectorAll('.aura-target-boost').length,
    restore: document.querySelectorAll('#aura-restore-button').length,
  }));
}

test.describe('Focus scoped sentinel', () => {
  let context;
  let extensionId;
  let serviceWorker;
  let fixtureHtml;

  test.beforeAll(async () => {
    fixtureHtml = await loadFixtureHtml();
  });

  test.beforeEach(async () => {
    ({ context, extensionId } = await launchWithExtension({
      extensionPath,
      headless: true,
      verbose: !!process.env.CI,
    }));

    serviceWorker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  });

  test.afterEach(async () => {
    await context?.close();
    context = null;
    extensionId = null;
    serviceWorker = null;
  });

  test('applies data-aura-scope when enabling Focus mode', async () => {
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
    await routeFixture(page, fixtureHtml);
    await openFixture(page, serviceWorker);
    await activateFocus(serviceWorker, page);

    const scopeOwner = await page.evaluate(() => {
      const scope = document.querySelector('[data-aura-scope="1"]');
      return scope ? scope.getAttribute('data-aura-scope-owner') : null;
    });

    expect(scopeOwner).toBe('aura-me2');

    await page.close();
  });

  test('latest Focus intent wins real MV3 apply/remove races and remains tab-local', async () => {
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
      focusOverlayV2: true,
      targetBoostV1: true,
      ultraFocusV1: true,
    });

    const page = await context.newPage();
    const otherPage = await context.newPage();
    await routeFixture(page, fixtureHtml);
    await routeFixture(otherPage, fixtureHtml);

    try {
      await openFixture(page, serviceWorker);
      await openFixture(otherPage, serviceWorker, `${targetUrl}?tab=other`);
      await activateFocus(serviceWorker, page);
      const tabId = await getAuraTabId(serviceWorker, page);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const responses = await serviceWorker.evaluate(async ({ id, actions, modeId, prefs }) => {
          const applying = chrome.tabs.sendMessage(id, { action: actions.prefs, prefs });
          const removing = chrome.tabs.sendMessage(id, { action: actions.remove, modeId });
          return Promise.all([applying, removing]);
        }, {
          id: tabId,
          actions: { prefs: ACTIONS.PREFS_UPDATED, remove: ACTIONS.REMOVE_RESTORE_BUTTON },
          modeId: MODE_IDS.FOCUS,
          prefs: buildFocusPrefs(true),
        });
        expect(responses[0]).toEqual({ received: true });
        expect(responses[1]).toEqual({ ok: true, removed: true });

        await page.waitForTimeout(350);
        expect(await readFocusArtifacts(page)).toEqual({
          overlay: 0,
          ruler: 0,
          ultraFocus: 0,
          boosted: 0,
          restore: 0,
        });

        expect(await readFocusArtifacts(otherPage)).toEqual({
          overlay: 0,
          ruler: 0,
          ultraFocus: 0,
          boosted: 0,
          restore: 0,
        });

        const injectResponse = await sendMessageToTab(serviceWorker, tabId, {
          action: ACTIONS.INJECT_RESTORE_BUTTON,
          modeId: MODE_IDS.FOCUS,
        });
        expect(injectResponse).toEqual({ ok: true, injected: true });
      }

      await sendMessageToTab(serviceWorker, tabId, {
        action: ACTIONS.PREFS_UPDATED,
        prefs: buildFocusPrefs(true),
      });
      await expect.poll(() => readFocusArtifacts(page)).toMatchObject({ overlay: 1, restore: 1 });
      expect(await readFocusArtifacts(otherPage)).toEqual({
        overlay: 0,
        ruler: 0,
        ultraFocus: 0,
        boosted: 0,
        restore: 0,
      });
    } finally {
      await otherPage.close();
      await page.close();
    }
  });

  test('Focus survives SPA and reload rehydrate, then yields atomically to Comfort', async () => {
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
      focusOverlayV2: true,
    });
    await setStoredFocusPrefs(serviceWorker, true);

    const page = await context.newPage();
    await routeFixture(page, fixtureHtml);

    try {
      await openFixture(page, serviceWorker);
      await activateFocus(serviceWorker, page);
      const tabId = await getAuraTabId(serviceWorker, page);
      await expect.poll(() => readFocusArtifacts(page)).toMatchObject({ overlay: 1, restore: 1 });

      await page.evaluate(() => history.pushState({}, '', '/basic.html?spa=1'));
      await expect.poll(async () => page.evaluate(() => ({
        url: location.href,
        scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
        overlay: document.querySelectorAll('[data-aura-focus-overlay]').length,
      }))).toEqual({ url: `${targetUrl}?spa=1`, scoped: true, overlay: 1 });

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await expect.poll(async () => page.evaluate(() => ({
        scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
        overlay: document.querySelectorAll('[data-aura-focus-overlay]').length,
      }))).toEqual({ scoped: true, overlay: 1 });
      await expect.poll(async () => serviceWorker.evaluate(async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.focus?.state || null;
      }, { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE })).toBe(STATES.ACTIVE);

      const switchResponse = await sendRuntimeMessageFromExtensionPage(context, extensionId, {
        action: ACTIONS.USER_DECISION,
        tabId,
        modeId: MODE_IDS.COMFORT_VISUAL,
        decision: 'ENABLED',
      });
      expect(switchResponse?.ok, JSON.stringify(switchResponse, null, 2)).toBe(true);

      await expect.poll(async () => serviceWorker.evaluate(async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.['comfort-visual']?.state || null;
      }, { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE })).toBe(STATES.ACTIVE);

      const finalModeEntries = await serviceWorker.evaluate(async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return {
          focus: tabState?.[targetTabId]?.focus || null,
          comfort: tabState?.[targetTabId]?.['comfort-visual'] || null,
        };
      }, { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE });
      const focusDiagnostic = {
        state: finalModeEntries.focus?.state || null,
        smartScopeStatus: finalModeEntries.focus?.smartScopeStatus || null,
        cssId: finalModeEntries.focus?.cssId || null,
        scopedV2: finalModeEntries.focus?.scopedV2
          ? {
              cssId: finalModeEntries.focus.scopedV2.cssId || null,
              frameId: finalModeEntries.focus.scopedV2.frameId ?? null,
              scopeSelector: finalModeEntries.focus.scopedV2.scopeSelector || null,
            }
          : null,
      };
      expect(finalModeEntries.focus?.state, JSON.stringify(focusDiagnostic, null, 2)).toBe(STATES.INACTIVE);
      await expect.poll(() => readFocusArtifacts(page)).toMatchObject({ overlay: 0, ruler: 0, restore: 1 });
    } finally {
      await page.close();
      await setStoredFocusPrefs(serviceWorker, false);
    }
  });
});
