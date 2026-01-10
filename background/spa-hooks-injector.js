import { isFlagEnabled } from '../shared/feature-flags.js';
import { isUnsupportedScheme } from './site-policy-manager.js';

const SPA_HOOKS_RUNTIME_FILE = 'content/spa-hooks-v2.runtime.js';

function isSupportedUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }

  if (isUnsupportedScheme(url)) {
    return false;
  }

  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch (error) {
    return false;
  }
}

async function checkSpaHooksInstalled(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () =>
      Boolean(globalThis[Symbol.for('AURA_SPA_HOOKS_V2')] || globalThis.AURA_SPA_HOOKS_V2),
  });

  return Boolean(results?.[0]?.result);
}

async function injectSpaHooksRuntime(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: [SPA_HOOKS_RUNTIME_FILE],
  });
}

export async function ensureSpaHooksMainInjected(tabId) {
  if (typeof tabId !== 'number') {
    return { ok: false, error: 'INVALID_TAB_ID' };
  }

  if (!isFlagEnabled('smartScopeSpaHooks')) {
    return { ok: false, error: 'FLAG_DISABLED' };
  }

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    console.warn('[SW] Failed to fetch tab for SPA hooks runtime', error);
    return { ok: false, error: 'TAB_LOOKUP_FAILED' };
  }

  if (!isSupportedUrl(tab?.url)) {
    return { ok: false, error: 'UNSUPPORTED_SCHEME' };
  }

  try {
    const alreadyInstalled = await checkSpaHooksInstalled(tabId);
    if (alreadyInstalled) {
      return { ok: true };
    }

    await injectSpaHooksRuntime(tabId);
    const installed = await checkSpaHooksInstalled(tabId);
    return { ok: installed };
  } catch (error) {
    console.warn('[SW] SPA hooks runtime injection failed', error);
    return { ok: false, error: 'INJECTION_FAILED' };
  }
}
