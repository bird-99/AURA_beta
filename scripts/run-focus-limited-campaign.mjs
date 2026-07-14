import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchWithExtension } from '../tests/e2e/helpers/launch-with-extension.js';
import { getAuraTabId } from '../tests/e2e/helpers/tab-resolution.js';
import { MODE_IDS, STATES, STORAGE_KEYS } from '../shared/constants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'artifacts', 'focus-limited-v2-2026-07-11');
const allCases = [
  ['article', 'https://en.wikipedia.org/wiki/Web_accessibility'],
  ['doc', 'https://developer.mozilla.org/en-US/docs/Web/Accessibility'],
  ['search', 'https://html.duckduckgo.com/html/?q=web+accessibility'],
  ['shop-feed', 'https://github.com/explore'],
  ['form', 'https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/examples/checkbox/'],
  ['dashboard-web-app', 'https://github.com/'],
  ['video', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'],
  ['unknown', 'https://example.com/'],
];
const requestedCase = process.argv[2] || '';
const cases = requestedCase ? allCases.filter(([name]) => name === requestedCase) : allCases;

async function readVisualState(page) {
  return page.evaluate(() => ({
    focusOverlayRoots: document.querySelectorAll('[data-aura-focus-overlay]').length,
    focusOverlayVisible: Array.from(document.querySelectorAll('[data-aura-focus-overlay]'))
      .some((element) => getComputedStyle(element).display !== 'none'),
    scopeRoots: document.querySelectorAll('[data-aura-scope="1"]').length,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
  }));
}

function compactReason(state, status) {
  return state?.smartScope?.fallbackScopeDetail
    || state?.smartScope?.safeDowngrade
    || state?.smartScope?.fallbackReason
    || state?.smartScope?.variantReason
    || status?.detail
    || status?.error
    || null;
}

function hasPositiveEligibleLearning(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.eligible === true && value.positive === true) return true;
  return Object.values(value).some(hasPositiveEligibleLearning);
}

async function openPopup(context, extensionId, tabId, tabUrl) {
  const popup = await context.newPage();
  await popup.addInitScript(({ resolvedTabId, resolvedTabUrl }) => {
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (queryInfo) => (
      queryInfo?.active && queryInfo?.currentWindow
        ? [{ id: resolvedTabId, url: resolvedTabUrl }]
        : originalQuery(queryInfo)
    );
  }, { resolvedTabId: tabId, resolvedTabUrl: tabUrl });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.getByTestId('popup-root').waitFor({ timeout: 15000 });
  return popup;
}

async function readEvidence(serviceWorker, tabId) {
  return serviceWorker.evaluate(async ({ id, stateKey, statusKey, ledgerKey }) => {
    const session = await chrome.storage.session.get([stateKey, statusKey]);
    const local = await chrome.storage.local.get(ledgerKey);
    return {
      state: session?.[stateKey]?.[id]?.['focus'] || null,
      status: session?.[statusKey]?.[id]?.['focus'] || null,
      ledger: local?.[ledgerKey] || null,
    };
  }, {
    id: tabId,
    stateKey: STORAGE_KEYS.TAB_STATE,
    statusKey: STORAGE_KEYS.SMARTSCOPE_STATUS,
    ledgerKey: STORAGE_KEYS.OUTCOME_LEDGER_V1,
  });
}

await fs.mkdir(outputDir, { recursive: true });
const launched = await launchWithExtension({ extensionPath: root, headless: true });
const { context, extensionId } = launched;
let serviceWorker = context.serviceWorkers()[0];
if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
const chromeVersion = context.browser()?.version() || 'unknown';
const results = [];

try {
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/options/options.html`);
  await control.evaluate(async ({ prefsKey, flagsKey }) => {
    const stored = await chrome.storage.local.get([prefsKey, flagsKey]);
    await chrome.storage.local.set({
      [flagsKey]: { ...(stored?.[flagsKey] || {}), debugTestHooks: true, smoothThemeTransitionsV2: false },
      [prefsKey]: { ...(stored?.[prefsKey] || {}), reducedMotion: true },
    });
  }, { prefsKey: STORAGE_KEYS.USER_PREFS, flagsKey: STORAGE_KEYS.FEATURE_FLAGS });
  await control.close();

  for (const [classificationTarget, url] of cases) {
    const page = await context.newPage();
    const item = { classificationTarget, url, outcome: 'ERROR' };
    let popup;
    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      item.finalUrl = page.url();
      item.title = await page.title();
      item.visualBefore = await readVisualState(page);
      await page.screenshot({ path: path.join(outputDir, `${classificationTarget}-before.jpg`), type: 'jpeg', quality: 55 });

      const tabId = await getAuraTabId(serviceWorker, page);
      popup = await openPopup(context, extensionId, tabId, page.url());
      await popup.locator('#focus-toggle').waitFor({ state: 'visible', timeout: 15000 });
      await popup.locator('#focus-toggle').click();
      await popup.locator('#focus-status').waitFor({ state: 'visible' });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const evidence = await readEvidence(serviceWorker, tabId);
        if ([STATES.ACTIVE, STATES.ERROR].includes(evidence.state?.state)) break;
        await page.waitForTimeout(100);
      }

      const during = await readEvidence(serviceWorker, tabId);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const label = (await popup.locator('#focus-status').textContent())?.trim();
        if (label && label !== 'OFF') break;
        await page.waitForTimeout(100);
      }
      item.popupDuring = (await popup.locator('#focus-status').textContent())?.trim() || null;
      item.runtimeState = during.state?.state || null;
      item.activeQuality = during.state?.activeQuality || null;
      item.pageClassification = during.state?.smartScope?.scopeProfile?.pageType
        || during.state?.smartScope?.fallbackDiagnostics?.pageType
        || during.state?.scopedV2?.pageType
        || null;
      item.reason = compactReason(during.state, during.status);
      item.statusEvidence = during.status;
      item.positiveEligibleLearning = hasPositiveEligibleLearning(during.ledger);
      item.visualDuring = await readVisualState(page);
      item.outcome = during.state?.state === STATES.ACTIVE ? 'ACTIVE' : during.state?.state || 'NO_STATE';
      await page.screenshot({ path: path.join(outputDir, `${classificationTarget}-during.jpg`), type: 'jpeg', quality: 55 });

      if (during.state?.state === STATES.ACTIVE) {
        await popup.locator('#focus-toggle').click();
      } else {
        await serviceWorker.evaluate(async ({ tabId: id, modeId }) => chrome.runtime.sendMessage({
          action: 'RESTORE_MODE', tabId: id, modeId,
        }), { tabId, modeId: MODE_IDS.FOCUS });
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const after = await readEvidence(serviceWorker, tabId);
        if (after.state?.state === STATES.INACTIVE) break;
        await page.waitForTimeout(100);
      }
      item.restoredState = (await readEvidence(serviceWorker, tabId)).state?.state || null;
      await page.waitForTimeout(300);
      item.popupAfter = (await popup.locator('#focus-status').textContent())?.trim() || null;
      item.visualAfter = await readVisualState(page);
      await page.screenshot({ path: path.join(outputDir, `${classificationTarget}-after.jpg`), type: 'jpeg', quality: 55 });
    } catch (error) {
      item.error = error?.message || String(error);
    } finally {
      await popup?.close().catch(() => {});
      await page.close().catch(() => {});
      results.push(item);
    }
  }
} finally {
  await context.close();
  await fs.rm(launched.userDataDir, { recursive: true, force: true });
}

const report = {
  checkedAt: new Date().toISOString(),
  auraCommit: 'b8330e0',
  chromeVersion,
  nodeVersion: process.version,
  expectedMode: MODE_IDS.FOCUS,
  results,
};
await fs.writeFile(path.join(outputDir, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
