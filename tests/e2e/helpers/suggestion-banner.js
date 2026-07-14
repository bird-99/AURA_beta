import { ACTIONS } from '../../../shared/constants.js';
import { sendMessageToTab } from './messaging.js';
import { resolveAuraTabForTest } from './tab-resolution.js';

export async function injectTestSuggestionBanner(serviceWorker, page, payload) {
  const tabResolution = await resolveAuraTabForTest(serviceWorker, page);
  const tabId = tabResolution?.tabId;
  if (typeof tabId !== 'number') {
    return {
      ok: false,
      error: { message: 'No matching tab', reason: tabResolution?.reason || 'UNKNOWN' },
      tabId: null,
      tabResolution,
    };
  }

  const response = await sendMessageToTab(serviceWorker, tabId, {
    action: ACTIONS.TEST_INJECT_SUGGESTION_BANNER,
    ...payload,
  });

  return { ...(response || {}), tabId };
}

export async function showSuggestionBanner(serviceWorker, page, payload) {
  const tabResolution = await resolveAuraTabForTest(serviceWorker, page);
  const tabId = tabResolution?.tabId;
  if (typeof tabId !== 'number') {
    return {
      ok: false,
      error: { message: 'No matching tab', reason: tabResolution?.reason || 'UNKNOWN' },
      tabId: null,
      tabResolution,
    };
  }

  const response = await sendMessageToTab(serviceWorker, tabId, {
    action: ACTIONS.SHOW_BANNER,
    ...payload,
  }, { frameId: 0 });

  return { ...(response || {}), tabId };
}

export async function clearTestSuggestionBanner(serviceWorker, tabId) {
  return sendMessageToTab(serviceWorker, tabId, {
    action: ACTIONS.TEST_CLEAR_SUGGESTION_BANNER,
  });
}

const suggestionBannerActionTabOffsets = {
  enable: 1,
  notNow: 2,
  never: 3,
  why: 4,
};

async function activateSuggestionBannerActionWithKeyboard(page, action) {
  const actionOffset = suggestionBannerActionTabOffsets[action];
  if (!actionOffset) {
    throw new Error(`activateSuggestionBannerAction: unsupported action "${action}"`);
  }

  await page.waitForSelector('#aura-suggestion-banner', { state: 'attached' });

  try {
    const focusableBeforeBanner = await page.evaluate(() => {
      const previousTabIndex = document.body.getAttribute('tabindex');
      if (previousTabIndex === null) {
        document.body.dataset.auraE2eHadBodyTabindex = '0';
      } else {
        document.body.dataset.auraE2eHadBodyTabindex = '1';
        document.body.dataset.auraE2eBodyTabindex = previousTabIndex;
      }

      document.body.setAttribute('tabindex', '-1');
      document.body.focus();

      const selectors = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');

      return Array.from(document.body.querySelectorAll(selectors)).filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).length;
    });

    for (let index = 0; index < focusableBeforeBanner + actionOffset; index += 1) {
      await page.keyboard.press('Tab');
    }

    await page.keyboard.press('Enter');
  } finally {
    await page.evaluate(() => {
      if (document.body.dataset.auraE2eHadBodyTabindex === '1') {
        document.body.setAttribute('tabindex', document.body.dataset.auraE2eBodyTabindex || '');
      } else if (document.body.dataset.auraE2eHadBodyTabindex === '0') {
        document.body.removeAttribute('tabindex');
      }
      delete document.body.dataset.auraE2eHadBodyTabindex;
      delete document.body.dataset.auraE2eBodyTabindex;
    }).catch(() => {});
  }
}

export async function activateSuggestionBannerAction(page, action) {
  await activateSuggestionBannerActionWithKeyboard(page, action);
}
