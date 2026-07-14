import { ACTIONS } from '../../../shared/constants.js';
import { sendMessageToTab } from './messaging.js';
import { resolveAuraTabForTest } from './tab-resolution.js';
import { sleep } from './polling.js';

const EXTENSION_READY_TIMEOUT_MS = 10000;
const EXTENSION_READY_RETRY_MS = 250;

export async function waitForAuraContentReady(page, { timeoutMs = 10000 } = {}) {
  if (!page) {
    throw new Error('waitForAuraContentReady: page is required');
  }
  const context = page.context();
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await waitForContentPing(serviceWorker, page, { timeoutMs });
}

async function applyTestDefaults(serviceWorker, { debugTestHooks } = {}) {
  await serviceWorker.evaluate(async (options) => {
    const { featureFlags, userPrefs } = await chrome.storage.local.get(['featureFlags', 'userPrefs']);
    const modePrefs =
      userPrefs?.modePrefs && typeof userPrefs.modePrefs === 'object' && !Array.isArray(userPrefs.modePrefs)
        ? userPrefs.modePrefs
        : {};
    const comfortPrefs =
      modePrefs['comfort-visual'] && typeof modePrefs['comfort-visual'] === 'object' ? modePrefs['comfort-visual'] : {};
    const focusPrefs = modePrefs.focus && typeof modePrefs.focus === 'object' ? modePrefs.focus : {};
    const nextFeatureFlags = {
      ...(featureFlags || {}),
      smoothThemeTransitionsV2: false,
    };

    if (typeof options?.debugTestHooks === 'boolean') {
      nextFeatureFlags.debugTestHooks = options.debugTestHooks;
    }

    await chrome.storage.local.set({
      featureFlags: nextFeatureFlags,
      userPrefs: {
        ...(userPrefs || {}),
        reducedMotion: true,
        modePrefs: {
          ...modePrefs,
          'comfort-visual': { ...comfortPrefs, reduceMotion: true },
          focus: { ...focusPrefs, reduceMotion: true },
        },
      },
    });
  }, { debugTestHooks });
}

async function waitForContentPing(
  serviceWorker,
  page,
  {
    timeoutMs = EXTENSION_READY_TIMEOUT_MS,
    retryMs = EXTENSION_READY_RETRY_MS,
    verbose = false,
    allowHostFallback = false,
  } = {},
) {
  if (!serviceWorker || !page) {
    throw new Error('waitForContentPing: serviceWorker and page are required');
  }

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tabResolution = await resolveAuraTabForTest(serviceWorker, page.url(), { allowHostFallback });

    if (typeof tabResolution?.tabId === 'number') {
      try {
        const response = await sendMessageToTab(serviceWorker, tabResolution.tabId, {
          action: ACTIONS.TEST_PING_CONTENT,
        });
        if (response?.ok === true) {
          return;
        }

        if (verbose) {
          console.log('[waitForAuraReady] Waiting for content script...', {
            tab: tabResolution,
            ping: response,
          });
        }
      } catch (error) {
        if (verbose) {
          console.log('[waitForAuraReady] Waiting for content script...', {
            tab: tabResolution,
            error: error?.message || error,
          });
        }
      }
    } else if (verbose) {
      console.log('[waitForAuraReady] Waiting for matching tab...', tabResolution);
    }

    await sleep(retryMs);
  }

  throw new Error(`waitForContentPing: timed out after ${timeoutMs}ms`);
}

export async function waitForAuraReady(
  serviceWorker,
  page,
  options = {},
) {
  if (!serviceWorker || !page) {
    throw new Error('waitForAuraReady: serviceWorker and page are required');
  }
  await applyTestDefaults(serviceWorker, { debugTestHooks: options.debugTestHooks });
  return waitForContentPing(serviceWorker, page, options);
}

export async function waitForExtensionReady(
  serviceWorker,
  page,
  options = {},
) {
  return waitForAuraReady(serviceWorker, page, options);
}

export async function waitForStableModeEngine(page, { timeoutMs = 5000 } = {}) {
  await page.waitForFunction(
    () => !document.querySelector('[data-aura-anim="1"]'),
    null,
    { timeout: timeoutMs },
  );
}
