import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchWithExtension, waitForExtensionReady } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePathA = path.resolve(__dirname, '../fixtures/nav/a.html');
const fixturePathB = path.resolve(__dirname, '../fixtures/nav/b.html');
const fixturePathSpa = path.resolve(__dirname, '../fixtures/nav/spa.html');
const targetUrlA = 'http://aura.local/nav/a.html';
const targetUrlB = 'http://aura.local/nav/b.html';
const targetUrlSpa = 'http://aura.local/nav/spa.html';

async function loadFixtureHtml(fixturePath) {
  return fs.readFile(fixturePath, 'utf8');
}

async function resetStorage(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  });
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

test.describe('Navigation persistence', () => {
  let context;
  let serviceWorker;
  let fixtureHtmlA;
  let fixtureHtmlB;
  let fixtureHtmlSpa;

  test.beforeAll(async () => {
    fixtureHtmlA = await loadFixtureHtml(fixturePathA);
    fixtureHtmlB = await loadFixtureHtml(fixturePathB);
    fixtureHtmlSpa = await loadFixtureHtml(fixturePathSpa);

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

  test('keeps scoped mode on same-origin navigation', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlags(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });

    const page = await context.newPage();
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

    await page.goto(targetUrlA);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraReady(page);
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
    await waitForScopedToken(page);

    await page.goto(targetUrlB);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraReady(page);
    await waitForScopedToken(page);

    const scopeOwner = await page.evaluate(() => {
      const scope = document.querySelector('[data-aura-scope="1"]');
      return scope ? scope.getAttribute('data-aura-scope-owner') : null;
    });

    expect(scopeOwner).toBe('aura-me2');

    await page.close();
  });

  test('keeps scoped mode after SPA navigation', async () => {
    await resetStorage(serviceWorker);
    await setFeatureFlags(serviceWorker, {
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
    await waitForAuraReady(page);
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
    await waitForScopedToken(page);

    await page.evaluate(() => {
      window.triggerSpaNavigation?.();
    });

    await page.waitForFunction(() => {
      const content = document.getElementById('spa-content');
      return content?.textContent === 'SPA page 2';
    }, null, { timeout: 10000 });

    await waitForScopedToken(page);

    const scopeOwner = await page.evaluate(() => {
      const scope = document.querySelector('[data-aura-scope="1"]');
      return scope ? scope.getAttribute('data-aura-scope-owner') : null;
    });

    expect(scopeOwner).toBe('aura-me2');

    await page.close();
  });
});
