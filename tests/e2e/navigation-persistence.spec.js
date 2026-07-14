import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ACTIONS, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  activateSuggestionBannerAction,
  createAuraServiceWorkerRestartController,
  launchWithExtension,
  setFeatureFlagsForTest,
  showSuggestionBanner,
  waitForAuraReady,
  waitForAuraContentReady,
  waitForStableModeEngine,
} from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePathA = path.resolve(__dirname, '../fixtures/nav/a.html');
const fixturePathB = path.resolve(__dirname, '../fixtures/nav/b.html');
const fixturePathSpa = path.resolve(__dirname, '../fixtures/nav/spa.html');
const targetUrlA = 'http://aura.local/nav/a.html';
const targetUrlB = 'http://aura.local/nav/b.html';
const targetUrlSpa = 'http://aura.local/nav/spa.html';

const extensionRuntimeEntries = Object.freeze([
  '_locales',
  'background',
  'content',
  'icons',
  'options',
  'popup',
  'shared',
  'welcome',
]);

async function loadFixtureHtml(fixturePath) {
  return fs.readFile(fixturePath, 'utf8');
}

async function launchWithPreviouslyGrantedOptionalWebNavigation() {
  const testRoot = await fs.mkdtemp(path.join(tmpdir(), 'aura-webnavigation-'));
  const copiedExtensionPath = path.join(testRoot, 'extension');
  const profilePath = path.join(testRoot, 'profile');
  await fs.mkdir(copiedExtensionPath, { recursive: true });
  await fs.mkdir(profilePath, { recursive: true });

  for (const entry of extensionRuntimeEntries) {
    await fs.cp(path.join(extensionPath, entry), path.join(copiedExtensionPath, entry), { recursive: true });
  }

  const productionManifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const seedManifest = {
    ...productionManifest,
    version: '0.9.0',
    permissions: [...new Set([...(productionManifest.permissions || []), 'webNavigation'])],
    optional_permissions: (productionManifest.optional_permissions || []).filter(
      (permission) => permission !== 'webNavigation',
    ),
  };
  await fs.writeFile(
    path.join(copiedExtensionPath, 'manifest.json'),
    `${JSON.stringify(seedManifest, null, 2)}\n`,
    'utf8',
  );

  const seeded = await launchWithExtension({
    extensionPath: copiedExtensionPath,
    headless: true,
    userDataDir: profilePath,
    preserveUserDataDir: true,
  });
  const seededExtensionId = seeded.extensionId;
  await seeded.context.close();

  await fs.writeFile(
    path.join(copiedExtensionPath, 'manifest.json'),
    `${JSON.stringify(productionManifest, null, 2)}\n`,
    'utf8',
  );

  const launched = await launchWithExtension({
    extensionPath: copiedExtensionPath,
    headless: true,
    userDataDir: profilePath,
    preserveUserDataDir: true,
  });
  expect(launched.extensionId).toBe(seededExtensionId);

  return {
    ...launched,
    async cleanup() {
      await launched.context.close().catch(() => {});
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function resetStorage(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
}

async function setComfortDarkModePreference(serviceWorker, darkMode) {
  await serviceWorker.evaluate(
    async ({ storageKey, comfortModeId, enabled }) => {
      const stored = await chrome.storage.local.get(storageKey);
      const prefs = stored?.[storageKey] || {};
      const modePrefs = prefs.modePrefs || {};
      await chrome.storage.local.set({
        [storageKey]: {
          ...prefs,
          modePrefs: {
            ...modePrefs,
            [comfortModeId]: {
              ...(modePrefs[comfortModeId] || {}),
              darkMode: enabled,
            },
          },
        },
      });
    },
    {
      storageKey: STORAGE_KEYS.USER_PREFS,
      comfortModeId: MODE_IDS.COMFORT_VISUAL,
      enabled: darkMode === true,
    },
  );
}

async function waitForScopedToken(page, { timeoutMs = 10000 } = {}) {
  await page.waitForFunction(() => {
    const scope = document.querySelector('[data-aura-scope="1"]');
    return scope && scope.getAttribute('data-aura-scope-owner') === 'aura-me2';
  }, null, { timeout: timeoutMs });
  await waitForStableModeEngine(page);
}

async function getScopedAppliedAt(serviceWorker, tabId, modeId) {
  return serviceWorker.evaluate(async ({ id, mode }) => {
    const { tabState } = await chrome.storage.session.get('tabState');
    const appliedAt = tabState?.[id]?.[mode]?.scopedV2?.appliedAt;
    return typeof appliedAt === 'number' && Number.isFinite(appliedAt) ? appliedAt : null;
  }, { id: tabId, mode: modeId });
}

async function getLifecycleGeneration(serviceWorker, tabId) {
  return serviceWorker.evaluate(async ({ id, journalKey }) => {
    const stored = await chrome.storage.session.get(journalKey);
    return stored?.[journalKey]?.tabs?.[id]?.generation || 0;
  }, { id: tabId, journalKey: STORAGE_KEYS.LIFECYCLE_JOURNAL_V1 });
}

async function waitForLifecycleGeneration(serviceWorker, tabId, expected) {
  await expect.poll(
    () => getLifecycleGeneration(serviceWorker, tabId),
    { timeout: 10000, intervals: [100, 250, 500] },
  ).toBe(expected);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(await getLifecycleGeneration(serviceWorker, tabId)).toBe(expected);
}

async function waitForScopedApplyAfter(serviceWorker, tabId, modeId, previousAppliedAt) {
  try {
    await expect.poll(async () => {
      const appliedAt = await getScopedAppliedAt(serviceWorker, tabId, modeId);
      return typeof appliedAt === 'number' ? appliedAt : -1;
    }, {
      timeout: 10000,
      intervals: [100, 250, 500, 1000],
    }).toBeGreaterThan(previousAppliedAt);
  } catch (error) {
    const diagnostics = await serviceWorker.evaluate(async ({ id, mode }) => {
      const stored = await chrome.storage.session.get(['tabState', 'lifecycleJournalV1', 'cssRegistry']);
      return {
        modeState: stored.tabState?.[id]?.[mode] || null,
        lifecycleSlot: stored.lifecycleJournalV1?.tabs?.[id] || null,
        registryCount: Object.values(stored.cssRegistry || {}).filter((entry) => entry?.meta?.tabId === id).length,
      };
    }, { id: tabId, mode: modeId });
    throw new Error(`${error.message}\nLifecycle diagnostics: ${JSON.stringify(diagnostics, null, 2)}`);
  }
}

async function waitForScopedAppliedAt(serviceWorker, tabId, modeId) {
  await expect.poll(async () => {
    const appliedAt = await getScopedAppliedAt(serviceWorker, tabId, modeId);
    return typeof appliedAt === 'number' ? appliedAt : -1;
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toBeGreaterThan(0);

  return getScopedAppliedAt(serviceWorker, tabId, modeId);
}

async function getScopedDocumentEvidence(page) {
  return page.evaluate(() => {
    const scope = document.querySelector('[data-aura-scope="1"]');
    if (!scope) {
      return null;
    }

    const navFixture = scope.closest('[data-nav-fixture]')?.getAttribute('data-nav-fixture') ||
      scope.querySelector('[data-nav-fixture]')?.getAttribute('data-nav-fixture') ||
      null;
    const spaPage = document.getElementById('spa-content')?.getAttribute('data-spa-page') || null;
    const hasInScope = (selector) => scope.matches(selector) || Boolean(scope.querySelector(selector));

    return {
      owner: scope.getAttribute('data-aura-scope-owner'),
      navFixture,
      spaPage,
      hasNavMarkerA: hasInScope('[data-nav-marker="a"]'),
      hasNavMarkerB: hasInScope('[data-nav-marker="b"]'),
      hasSpaMarker1: hasInScope('[data-spa-marker="1"]'),
      hasSpaMarker2: hasInScope('[data-spa-marker="2"]'),
      text: scope.textContent || '',
      url: location.href,
    };
  });
}

async function waitForScopedNavigationEvidence(page) {
  await expect.poll(async () => {
    const evidence = await getScopedDocumentEvidence(page);
    return {
      owner: evidence?.owner || null,
      url: evidence?.url || null,
      navFixture: evidence?.navFixture || null,
      hasNavMarkerB: evidence?.hasNavMarkerB === true,
      hasNavMarkerA: evidence?.hasNavMarkerA === true,
      containsMarkerB: evidence?.text?.includes('AURA_NAV_MARKER_B_AFTER_REHYDRATION') === true,
      containsMarkerA: evidence?.text?.includes('AURA_NAV_MARKER_A_BEFORE_NAVIGATION') === true,
    };
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toEqual({
    owner: 'aura-me2',
    url: targetUrlB,
    navFixture: 'b',
    hasNavMarkerB: true,
    hasNavMarkerA: false,
    containsMarkerB: true,
    containsMarkerA: false,
  });
}

async function waitForScopedSpaEvidence(page) {
  await expect.poll(async () => {
    const evidence = await getScopedDocumentEvidence(page);
    return {
      owner: evidence?.owner || null,
      spaPage: evidence?.spaPage || null,
      hasSpaMarker2: evidence?.hasSpaMarker2 === true,
      hasSpaMarker1: evidence?.hasSpaMarker1 === true,
      containsMarker2: evidence?.text?.includes('AURA_SPA_MARKER_PAGE_2') === true,
      containsMarker1: evidence?.text?.includes('AURA_SPA_MARKER_PAGE_1') === true,
    };
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toEqual({
    owner: 'aura-me2',
    spaPage: '2',
    hasSpaMarker2: true,
    hasSpaMarker1: false,
    containsMarker2: true,
    containsMarker1: false,
  });
}

async function waitForNoScopedToken(page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-aura-scope="1"][data-aura-scope-owner="aura-me2"]'),
    null,
    { timeout: 10000 },
  );
  await waitForStableModeEngine(page);
}

async function waitForComfortDarkPrelude(serviceWorker, page, tabId) {
  await expect.poll(async () => {
    return serviceWorker.evaluate(
      async ({ targetTabId, tabStateKey, comfortModeId }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.[comfortModeId]?.scopedV2?.preludeCssId || null;
      },
      {
        targetTabId: tabId,
        tabStateKey: STORAGE_KEYS.TAB_STATE,
        comfortModeId: MODE_IDS.COMFORT_VISUAL,
      },
    );
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toBeTruthy();

  await expect.poll(async () => {
    return page.evaluate(() => {
      const scope = document.querySelector('[data-aura-scope="1"][data-aura-scope-owner="aura-me2"]');
      const scopeStyles = scope ? getComputedStyle(scope) : null;
      const bodyStyles = getComputedStyle(document.body);
      return {
        scoped: Boolean(scope),
        auraScheme: scopeStyles?.getPropertyValue('--aura-color-scheme').trim() || '',
        bodyBackground: bodyStyles.backgroundColor,
        bodyColor: bodyStyles.color,
        darkShell: ['rgb(11, 16, 32)', 'rgb(16, 20, 31)'].includes(bodyStyles.backgroundColor),
      };
    });
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toMatchObject({
    scoped: true,
    auraScheme: 'dark',
    darkShell: true,
  });
}

async function openExtensionControlPage(context, extensionId) {
  const controlPage = await context.newPage();
  await controlPage.goto(`chrome-extension://${extensionId}/welcome/welcome.html`);
  return controlPage;
}

async function getTabModeStateFromControlPage(controlPage, tabId, modeId) {
  return controlPage.evaluate(async ({ id, mode }) => {
    const { tabState } = await chrome.storage.session.get('tabState');
    return tabState?.[id]?.[mode] || null;
  }, { id: tabId, mode: modeId });
}

async function getScopedAppliedAtFromControlPage(controlPage, tabId, modeId) {
  const modeState = await getTabModeStateFromControlPage(controlPage, tabId, modeId);
  const appliedAt = modeState?.scopedV2?.appliedAt;
  return typeof appliedAt === 'number' && Number.isFinite(appliedAt) ? appliedAt : null;
}

async function waitForScopedApplyAfterRestartInControlPage(controlPage, tabId, modeId, previousAppliedAt) {
  await expect.poll(async () => {
    const appliedAt = await getScopedAppliedAtFromControlPage(controlPage, tabId, modeId);
    return typeof appliedAt === 'number' ? appliedAt : -1;
  }, {
    timeout: 10000,
    intervals: [100, 250, 500, 1000],
  }).toBeGreaterThan(previousAppliedAt);
}

async function sendRuntimeMessageFromControlPage(controlPage, message) {
  return controlPage.evaluate(async (payload) => chrome.runtime.sendMessage(payload), message);
}

async function installNavRoutes(page, { fixtureHtmlA, fixtureHtmlB }) {
  await page.route('http://aura.local/**', async (route) => {
    const url = route.request().url();
    if (url === targetUrlA) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtmlA,
      });
      return;
    }
    if (url === targetUrlB) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtmlB,
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
}

test.describe('Navigation persistence', () => {
  let context;
  let extensionId;
  let serviceWorker;
  let fixtureHtmlA;
  let fixtureHtmlB;
  let fixtureHtmlSpa;

  test.beforeAll(async () => {
    fixtureHtmlA = await loadFixtureHtml(fixturePathA);
    fixtureHtmlB = await loadFixtureHtml(fixturePathB);
    fixtureHtmlSpa = await loadFixtureHtml(fixturePathSpa);

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

  test('keeps scoped mode on same-origin navigation', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
    await installNavRoutes(page, { fixtureHtmlA, fixtureHtmlB });

    await page.goto(targetUrlA);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId: 'focus',
      confidence: 0.9,
      signals: [],
    });

    expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
    await activateSuggestionBannerAction(page, 'enable');
    await waitForScopedToken(page);
    const tabId = injectResponse.tabId;
    expect(typeof tabId).toBe('number');
    const beforeNavigationAppliedAt = await waitForScopedAppliedAt(serviceWorker, tabId, 'focus');

    await page.goto(targetUrlB);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);
    await waitForScopedApplyAfter(serviceWorker, tabId, 'focus', beforeNavigationAppliedAt);
    await waitForScopedToken(page);
    await waitForScopedNavigationEvidence(page);

    await page.close();
  });

  test('rehydrates Comfort dark shell on same-origin navigation', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
      comfortDarkModeV1: true,
    });

    const page = await context.newPage();
    let controlPage;

    try {
      await installNavRoutes(page, { fixtureHtmlA, fixtureHtmlB });

      await page.goto(targetUrlA);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page);

      const injectResponse = await showSuggestionBanner(serviceWorker, page, {
        modeId: MODE_IDS.COMFORT_VISUAL,
        confidence: 0.9,
        signals: [],
      });

      expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
      await activateSuggestionBannerAction(page, 'enable');
      await waitForScopedToken(page);

      const tabId = injectResponse.tabId;
      expect(typeof tabId).toBe('number');
      const beforeNavigationAppliedAt = await waitForScopedAppliedAt(
        serviceWorker,
        tabId,
        MODE_IDS.COMFORT_VISUAL,
      );
      const initialStyles = await page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      }));

      await setComfortDarkModePreference(serviceWorker, true);
      await page.goto(targetUrlB);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page);
      await waitForScopedApplyAfter(
        serviceWorker,
        tabId,
        MODE_IDS.COMFORT_VISUAL,
        beforeNavigationAppliedAt,
      );
      await waitForScopedToken(page);
      await waitForScopedNavigationEvidence(page);
      await waitForComfortDarkPrelude(serviceWorker, page, tabId);

      const repeatedReady = await serviceWorker.evaluate(async ({ id, action }) => {
        const execution = await chrome.scripting.executeScript({
          target: { tabId: id },
          func: async (messageAction) => {
            const first = await chrome.runtime.sendMessage({
              action: messageAction,
              source: 'frame-runtime-ready',
            });
            const second = await chrome.runtime.sendMessage({
              action: messageAction,
              source: 'frame-runtime-ready',
            });
            return { first, second };
          },
          args: [action],
        });
        return execution?.[0]?.result || null;
      }, { id: tabId, action: ACTIONS.DARK_COMFORT_FRAME_READY });
      expect(repeatedReady?.first?.ok).toBe(true);
      expect(repeatedReady?.second?.ok).toBe(true);

      controlPage = await openExtensionControlPage(context, extensionId);
      const activeState = await getTabModeStateFromControlPage(controlPage, tabId, MODE_IDS.COMFORT_VISUAL);
      expect(activeState?.state).toBe(STATES.ACTIVE);
      expect(activeState?.scopedV2?.tokenKeys || []).toContain('--aura-color-scheme');
      expect(activeState?.scopedV2?.preludeDocuments || []).toEqual(expect.arrayContaining([
        expect.objectContaining({ frameId: 0 }),
      ]));

      const restoreResponse = await sendRuntimeMessageFromControlPage(controlPage, {
        action: ACTIONS.RESTORE_MODE,
        tabId,
        modeId: MODE_IDS.COMFORT_VISUAL,
      });

      expect(restoreResponse?.ok, JSON.stringify(restoreResponse, null, 2)).toBeTruthy();
      await waitForNoScopedToken(page);

      const afterRestoreState = await getTabModeStateFromControlPage(controlPage, tabId, MODE_IDS.COMFORT_VISUAL);
      expect(afterRestoreState?.state).toBe(STATES.INACTIVE);
      expect(afterRestoreState?.scopedV2 ?? null).toBeNull();
      await expect.poll(async () => {
        return page.evaluate(() => ({
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
        }));
      }, {
        timeout: 10000,
        intervals: [100, 250, 500, 1000],
      }).toEqual(initialStyles);
    } finally {
      await controlPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
    }
  });

  test('keeps scoped mode after SPA navigation', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrlSpa) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtmlSpa,
        });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });

    await page.goto(targetUrlSpa);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const injectResponse = await showSuggestionBanner(serviceWorker, page, {
      modeId: 'focus',
      confidence: 0.9,
      signals: [],
    });

    expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
    await activateSuggestionBannerAction(page, 'enable');
    await waitForScopedToken(page);
    const tabId = injectResponse.tabId;
    expect(typeof tabId).toBe('number');
    const beforeSpaAppliedAt = await waitForScopedAppliedAt(serviceWorker, tabId, 'focus');

    await page.evaluate(() => {
      window.triggerSpaNavigation?.();
    });

    await page.waitForFunction(() => {
      const content = document.getElementById('spa-content');
      return content?.textContent?.includes('SPA page 2');
    }, null, { timeout: 10000 });

    await waitForScopedApplyAfter(serviceWorker, tabId, 'focus', beforeSpaAppliedAt);
    await waitForScopedToken(page);
    await waitForScopedSpaEvidence(page);

    await page.close();
  });

  test('optional webNavigation is inert when absent', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
      smartScopeSpaHooks: false,
    });

    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url().startsWith(targetUrlSpa)) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtmlSpa });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });

    try {
      await page.goto(targetUrlSpa);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page);

      expect(await serviceWorker.evaluate(() => (
        chrome.permissions.contains({ permissions: ['webNavigation'] })
      ))).toBe(false);

      const injectResponse = await showSuggestionBanner(serviceWorker, page, {
        modeId: MODE_IDS.FOCUS,
        confidence: 0.9,
        signals: [],
      });
      expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
      await activateSuggestionBannerAction(page, 'enable');
      await waitForScopedToken(page);
      const tabId = injectResponse.tabId;
      const absentGeneration = await getLifecycleGeneration(serviceWorker, tabId);

      await page.evaluate(() => window.triggerSpaNavigation?.());
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(await getLifecycleGeneration(serviceWorker, tabId)).toBe(absentGeneration);
    } finally {
      await page.close().catch(() => {});
    }
  });

  test('optional webNavigation rehydrates once when granted and emits nothing after revoke', async () => {
    const permissionRuntime = await launchWithPreviouslyGrantedOptionalWebNavigation();
    const permissionContext = permissionRuntime.context;
    const permissionExtensionId = permissionRuntime.extensionId;
    const permissionServiceWorker = permissionContext.serviceWorkers()[0]
      || (await permissionContext.waitForEvent('serviceworker'));

    await resetStorage(permissionServiceWorker);
    await setFeatureFlagsForTest(permissionServiceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
      smartScopeSpaHooks: false,
    });

    const page = await permissionContext.newPage();
    let optionsPage;
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url().startsWith(targetUrlSpa)) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtmlSpa });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });

    try {
      await page.goto(targetUrlSpa);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(permissionServiceWorker, page);
      expect(await page.evaluate(() => Boolean(
        globalThis[Symbol.for('AURA_SPA_HOOKS_V2')] || globalThis.AURA_SPA_HOOKS_V2,
      ))).toBe(false);

      expect(await permissionServiceWorker.evaluate(() => (
        chrome.permissions.contains({ permissions: ['webNavigation'] })
      ))).toBe(true);

      const injectResponse = await showSuggestionBanner(permissionServiceWorker, page, {
        modeId: MODE_IDS.FOCUS,
        confidence: 0.9,
        signals: [],
      });
      expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
      await activateSuggestionBannerAction(page, 'enable');
      await waitForScopedToken(page);
      const tabId = injectResponse.tabId;

      optionsPage = await permissionContext.newPage();
      await optionsPage.goto(`chrome-extension://${permissionExtensionId}/options/options.html#advanced`);
      const spaToggle = optionsPage.locator('#spa-toggle');
      await expect(spaToggle).not.toBeChecked();
      await spaToggle.click();
      await expect(spaToggle).toBeChecked();

      await expect.poll(async () => {
        const stored = await permissionServiceWorker.evaluate(async (key) => chrome.storage.local.get(key), STORAGE_KEYS.USER_PREFS);
        return stored?.[STORAGE_KEYS.USER_PREFS]?.spaDetectionEnabled === true;
      }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const grantedGeneration = await getLifecycleGeneration(permissionServiceWorker, tabId);

      await permissionServiceWorker.evaluate(({ targetTabId, reapplyAction }) => {
        globalThis.__AURA_TEST_WEBNAV_COUNT__ = 0;
        globalThis.__AURA_TEST_REAPPLY_MESSAGE_COUNT__ = 0;
        globalThis.__AURA_TEST_TAB_COMPLETE_COUNT__ = 0;
        chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
          if (details.tabId === targetTabId && details.frameId === 0) {
            globalThis.__AURA_TEST_WEBNAV_COUNT__ += 1;
          }
        });
        chrome.runtime.onMessage.addListener((message, sender) => {
          if (sender?.tab?.id === targetTabId && message?.action === reapplyAction) {
            globalThis.__AURA_TEST_REAPPLY_MESSAGE_COUNT__ += 1;
          }
        });
        chrome.tabs.onUpdated.addListener((updatedTabId, changeInfo) => {
          if (updatedTabId === targetTabId && changeInfo?.status === 'complete') {
            globalThis.__AURA_TEST_TAB_COMPLETE_COUNT__ += 1;
          }
        });
      }, { targetTabId: tabId, reapplyAction: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES });

      await page.evaluate(() => window.triggerSpaNavigation?.());
      await expect.poll(
        () => getLifecycleGeneration(permissionServiceWorker, tabId),
        { timeout: 10000, intervals: [100, 250, 500] },
      ).toBeGreaterThan(grantedGeneration);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const navigationDiagnostics = await permissionServiceWorker.evaluate(() => ({
        webNavigationCount: globalThis.__AURA_TEST_WEBNAV_COUNT__ || 0,
        reapplyMessageCount: globalThis.__AURA_TEST_REAPPLY_MESSAGE_COUNT__ || 0,
        tabCompleteCount: globalThis.__AURA_TEST_TAB_COMPLETE_COUNT__ || 0,
      }));
      expect(navigationDiagnostics).toEqual({
        webNavigationCount: 1,
        reapplyMessageCount: 0,
        tabCompleteCount: 1,
      });
      expect(await getLifecycleGeneration(permissionServiceWorker, tabId)).toBe(grantedGeneration + 1);

      await spaToggle.click();
      await expect.poll(() => optionsPage.evaluate(() => (
        chrome.permissions.contains({ permissions: ['webNavigation'] })
      ))).toBe(false);
      await expect(spaToggle).not.toBeChecked();
      await expect.poll(async () => {
        const stored = await permissionServiceWorker.evaluate(async (key) => chrome.storage.local.get(key), STORAGE_KEYS.USER_PREFS);
        return stored?.[STORAGE_KEYS.USER_PREFS]?.spaDetectionEnabled === false;
      }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const revokedGeneration = await getLifecycleGeneration(permissionServiceWorker, tabId);

      await page.evaluate(() => window.triggerSpaNavigation?.());
      await waitForLifecycleGeneration(permissionServiceWorker, tabId, revokedGeneration + 1);
      const revokedDiagnostics = await permissionServiceWorker.evaluate(() => ({
        webNavigationCount: globalThis.__AURA_TEST_WEBNAV_COUNT__ || 0,
        reapplyMessageCount: globalThis.__AURA_TEST_REAPPLY_MESSAGE_COUNT__ || 0,
        tabCompleteCount: globalThis.__AURA_TEST_TAB_COMPLETE_COUNT__ || 0,
      }));
      expect(revokedDiagnostics).toEqual({
        webNavigationCount: 1,
        reapplyMessageCount: 0,
        tabCompleteCount: 2,
      });
    } finally {
      await optionsPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await permissionRuntime.cleanup();
    }
  });

  test('rehydrates and restores after a service worker restart', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
    let controlPage;
    let restartController;

    try {
      await installNavRoutes(page, { fixtureHtmlA, fixtureHtmlB });

      await page.goto(targetUrlA);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page);

      const injectResponse = await showSuggestionBanner(serviceWorker, page, {
        modeId: 'focus',
        confidence: 0.9,
        signals: [],
      });

      expect(injectResponse?.ok, JSON.stringify(injectResponse, null, 2)).toBeTruthy();
      await activateSuggestionBannerAction(page, 'enable');
      await waitForScopedToken(page);

      const tabId = injectResponse.tabId;
      expect(typeof tabId).toBe('number');
      const beforeRestartAppliedAt = await waitForScopedAppliedAt(serviceWorker, tabId, 'focus');
      controlPage = await openExtensionControlPage(context, extensionId);
      const beforeRestartState = await getTabModeStateFromControlPage(controlPage, tabId, 'focus');
      expect(beforeRestartState?.state).toBe(STATES.ACTIVE);

      restartController = await createAuraServiceWorkerRestartController(context, page, extensionId);
      const stoppedWorker = await restartController.stop();

      await page.goto(targetUrlB);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      const restartedWorker = await restartController.waitForRunningAfter(stoppedWorker.stoppedSequence);

      expect(restartedWorker.runningStatus).toBe('running');
      expect(restartedWorker.scriptURL).toBe(restartController.scriptUrl);

      await waitForScopedApplyAfterRestartInControlPage(controlPage, tabId, 'focus', beforeRestartAppliedAt);
      await waitForScopedToken(page);
      await waitForScopedNavigationEvidence(page);

      const afterRestartState = await getTabModeStateFromControlPage(controlPage, tabId, 'focus');
      expect(afterRestartState?.state).toBe(STATES.ACTIVE);
      expect(afterRestartState?.scopedV2?.appliedAt).toBeGreaterThan(beforeRestartAppliedAt);

      const restoreResponse = await sendRuntimeMessageFromControlPage(controlPage, {
        action: ACTIONS.RESTORE_MODE,
        tabId,
        modeId: 'focus',
      });

      expect(restoreResponse?.ok, JSON.stringify(restoreResponse, null, 2)).toBeTruthy();
      await waitForNoScopedToken(page);

      const afterRestoreState = await getTabModeStateFromControlPage(controlPage, tabId, 'focus');
      expect(afterRestoreState?.state).toBe(STATES.INACTIVE);
      expect(afterRestoreState?.scopedV2 ?? null).toBeNull();
    } finally {
      await restartController?.dispose();
      await controlPage?.close().catch(() => {});
      await page.close().catch(() => {});
    }
  });
});
