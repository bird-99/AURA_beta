import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { ACTIONS, MODE_IDS, SMARTSCOPE_ACTIONS } from '../../shared/constants.js';
import {
  getAuraTabId,
  launchWithExtension,
  waitForAuraReady,
} from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const parentUrl = 'http://aura.local/content-routing.html';
const sameFrameUrl = 'http://aura.local/content-routing-same-frame.html';
const crossFrameUrl = 'http://frame.aura.test/content-routing-cross-frame.html';

const parentHtml = `<!doctype html>
<html><body>
  <main><h1>Content routing fixture</h1></main>
  <iframe id="same-frame" src="${sameFrameUrl}"></iframe>
  <iframe id="cross-frame" src="${crossFrameUrl}"></iframe>
</body></html>`;

const childHtml = '<!doctype html><html><body><main>Frame target</main></body></html>';

async function openControlPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/welcome/welcome.html`);
  return page;
}

test('real MV3 routing keeps UI top-owned and scoped actions frame-targeted', async () => {
  const { context, extensionId } = await launchWithExtension({ extensionPath, headless: true });
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const controlPage = await openControlPage(context, extensionId);

  await page.route('http://aura.local/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: route.request().url() === parentUrl ? parentHtml : childHtml,
  }));
  await page.route('http://frame.aura.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: childHtml,
  }));

  try {
    await page.goto(parentUrl);
    await waitForAuraReady(serviceWorker, page, { debugTestHooks: false });
    await expect.poll(() => page.frames().filter((frame) => frame !== page.mainFrame()).length).toBe(2);
    const tabId = await getAuraTabId(serviceWorker, page);

    const [bootstrapRuntime] = await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => ({
        version: globalThis.AURA_CONTENT_BOOTSTRAP_V1?.version ?? null,
        frozen: Object.isFrozen(globalThis.AURA_CONTENT_BOOTSTRAP_V1),
        phasesFrozen: Object.isFrozen(globalThis.AURA_CONTENT_BOOTSTRAP_V1?.phases),
      }),
    }), tabId);
    expect(bootstrapRuntime.result).toEqual({ version: 1, frozen: true, phasesFrozen: true });

    const [routerBefore] = await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      func: () => {
        globalThis.__AURA_E2E_ROUTER_REFERENCE__ = globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1;
        globalThis.__AURA_E2E_MAIN_LISTENER_REFERENCE__ = globalThis.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__;
        return {
          version: globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1?.version ?? null,
          frozen: Object.isFrozen(globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1),
          factory: typeof globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1?.createListener,
          stateCreated: '__AURA_CONTENT_MESSAGE_ROUTER_STATE_V1__' in globalThis,
          listenerFrozen: Object.isFrozen(globalThis.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__),
        };
      },
    }), tabId);
    expect(routerBefore.result).toEqual({
      version: 1,
      frozen: true,
      factory: 'function',
      stateCreated: false,
      listenerFrozen: true,
    });

    await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      files: ['content/content-message-router.runtime.js'],
    }), tabId);
    const [routerAfter] = await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      func: () => ({
        sameFacade: globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1 === globalThis.__AURA_E2E_ROUTER_REFERENCE__,
        sameMainListener: globalThis.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__
          === globalThis.__AURA_E2E_MAIN_LISTENER_REFERENCE__,
        stateCreated: '__AURA_CONTENT_MESSAGE_ROUTER_STATE_V1__' in globalThis,
      }),
    }), tabId);
    expect(routerAfter.result).toEqual({
      sameFacade: true,
      sameMainListener: true,
      stateCreated: false,
    });

    const frameEntries = await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: () => ({ href: location.href, isTop: window.top === window }),
    }), tabId);
    const childEntries = frameEntries.filter((entry) => entry.result?.isTop === false);
    expect(childEntries).toHaveLength(2);

    await serviceWorker.evaluate(({ id, readyAction, reapplyAction }) => {
      globalThis.__AURA_SUBFRAME_GLOBAL_MESSAGE_COUNTS__ = { ready: 0, reapply: 0 };
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (sender?.tab?.id !== id || sender?.frameId === 0) {
          return;
        }
        if (message?.action === readyAction) {
          globalThis.__AURA_SUBFRAME_GLOBAL_MESSAGE_COUNTS__.ready += 1;
        }
        if (message?.action === reapplyAction) {
          globalThis.__AURA_SUBFRAME_GLOBAL_MESSAGE_COUNTS__.reapply += 1;
        }
      });
    }, {
      id: tabId,
      readyAction: ACTIONS.CONTENT_SCRIPT_READY_V2,
      reapplyAction: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES,
    });

    for (const entry of childEntries) {
      const injection = await controlPage.evaluate(async ({ id, frameId }) => {
        const bridge = await import(chrome.runtime.getURL('background/scoped-v2-page-bridge.js'));
        return bridge.ensureContentInFrame(id, frameId);
      }, { id: tabId, frameId: entry.frameId });
      expect(injection.ok).toBe(true);

      const [childRouter] = await serviceWorker.evaluate(async ({ id, frameId }) => chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [frameId] },
        func: () => ({
          version: globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1?.version ?? null,
          frozen: Object.isFrozen(globalThis.AURA_CONTENT_MESSAGE_ROUTER_V1),
          stateCreated: '__AURA_CONTENT_MESSAGE_ROUTER_STATE_V1__' in globalThis,
        }),
      }), { id: tabId, frameId: entry.frameId });
      expect(childRouter.result).toEqual({ version: 1, frozen: true, stateCreated: false });

      const ping = await controlPage.evaluate(async ({ id, frameId, action }) => chrome.tabs.sendMessage(
        id,
        { action },
        { frameId },
      ), { id: tabId, frameId: entry.frameId, action: ACTIONS.TEST_PING_CONTENT });
      expect(ping).toEqual({ ok: true });

      const documentContext = await controlPage.evaluate(async ({ id, frameId, action }) => {
        try {
          const response = await chrome.tabs.sendMessage(id, { action }, { frameId });
          return { claimed: response !== undefined, response: response ?? null };
        } catch (error) {
          return { claimed: false, error: error?.message || String(error) };
        }
      }, { id: tabId, frameId: entry.frameId, action: ACTIONS.GET_DOCUMENT_CONTEXT_V1 });
      expect(documentContext.claimed).toBe(false);
    }

    const testOnlyWithoutHooks = await controlPage.evaluate(async ({ id, action, modeId }) => {
      try {
        const response = await chrome.tabs.sendMessage(id, { action, modeId, confidence: 0.9 });
        return { claimed: response !== undefined, response: response ?? null };
      } catch (error) {
        return { claimed: false, error: error?.message || String(error) };
      }
    }, {
      id: tabId,
      action: ACTIONS.TEST_INJECT_SUGGESTION_BANNER,
      modeId: MODE_IDS.COMFORT_VISUAL,
    });
    expect(testOnlyWithoutHooks.claimed).toBe(false);
    await expect(page.locator('#aura-suggestion-banner')).toHaveCount(0);

    for (const entry of childEntries) {
      const childTopOwned = await controlPage.evaluate(async ({ id, frameId, action, modeId }) => {
        try {
          const response = await chrome.tabs.sendMessage(id, { action, modeId }, { frameId });
          return { claimed: response !== undefined, response: response ?? null };
        } catch (error) {
          return { claimed: false, error: error?.message || String(error) };
        }
      }, {
        id: tabId,
        frameId: entry.frameId,
        action: ACTIONS.INJECT_RESTORE_BUTTON,
        modeId: MODE_IDS.COMFORT_VISUAL,
      });
      expect(childTopOwned.claimed).toBe(false);
    }
    await expect(page.locator('#aura-restore-button')).toHaveCount(0);

    for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
      await frame.evaluate(() => {
        window.dispatchEvent(new CustomEvent('aura:spa-nav', {
          detail: { reason: 'test-subframe', kind: 'pathname', url: location.href },
        }));
      });
    }
    await page.waitForTimeout(500);
    expect(await serviceWorker.evaluate(() => globalThis.__AURA_SUBFRAME_GLOBAL_MESSAGE_COUNTS__)).toEqual({
      ready: 0,
      reapply: 0,
    });

    const restoreResponse = await controlPage.evaluate(async ({ id, action, modeId }) => chrome.tabs.sendMessage(
      id,
      { action, modeId },
    ), { id: tabId, action: ACTIONS.INJECT_RESTORE_BUTTON, modeId: MODE_IDS.COMFORT_VISUAL });
    expect(restoreResponse).toEqual({ ok: true, injected: true });
    await expect(page.locator('#aura-restore-button')).toHaveCount(1);
    for (const frame of page.frames().filter((candidate) => candidate !== page.mainFrame())) {
      await expect(frame.locator('#aura-restore-button')).toHaveCount(0);
    }

    const sameEntry = childEntries.find((entry) => entry.result?.href === sameFrameUrl);
    expect(sameEntry).toBeTruthy();
    const scopedResponse = await controlPage.evaluate(async ({ id, frameId, action }) => chrome.tabs.sendMessage(
      id,
      {
        action,
        token: 'frame-owned-token',
        operations: [{ selector: 'body', add: ['aura-frame-owned'] }],
      },
      { frameId },
    ), { id: tabId, frameId: sameEntry.frameId, action: SMARTSCOPE_ACTIONS.APPLY_CLASSES });
    expect(scopedResponse.ok).toBe(true);
    expect(await page.locator('body').evaluate((body) => body.classList.contains('aura-frame-owned'))).toBe(false);
    expect(await page.frames().find((frame) => frame.url() === sameFrameUrl)
      .locator('body').evaluate((body) => body.classList.contains('aura-frame-owned'))).toBe(true);
    expect(await page.frames().find((frame) => frame.url() === crossFrameUrl)
      .locator('body').evaluate((body) => body.classList.contains('aura-frame-owned'))).toBe(false);

    const sameFrame = page.frames().find((frame) => frame.url() === sameFrameUrl);
    await sameFrame.goto(`${sameFrameUrl}?reloaded=1`);
    const [reloadedEntry] = (await serviceWorker.evaluate(async (id) => chrome.scripting.executeScript({
      target: { tabId: id, allFrames: true },
      func: () => ({ href: location.href, isTop: window.top === window }),
    }), tabId)).filter((entry) => entry.result?.href.includes('content-routing-same-frame.html?reloaded=1'));
    expect(reloadedEntry).toBeTruthy();
    const reinjection = await controlPage.evaluate(async ({ id, frameId }) => {
      const bridge = await import(chrome.runtime.getURL('background/scoped-v2-page-bridge.js'));
      return bridge.ensureContentInFrame(id, frameId);
    }, { id: tabId, frameId: reloadedEntry.frameId });
    expect(reinjection.ok).toBe(true);
    await page.waitForTimeout(500);
    expect(await serviceWorker.evaluate(() => globalThis.__AURA_SUBFRAME_GLOBAL_MESSAGE_COUNTS__)).toEqual({
      ready: 0,
      reapply: 0,
    });

    const unknown = await controlPage.evaluate(async ({ id }) => {
      try {
        const response = await chrome.tabs.sendMessage(id, { action: 'AURA_UNKNOWN_CONTENT_ACTION' });
        return { claimed: response !== undefined, response: response ?? null };
      } catch (error) {
        return { claimed: false, error: error?.message || String(error) };
      }
    }, { id: tabId });
    expect(unknown.claimed).toBe(false);

    await controlPage.evaluate(async ({ id, action, modeId }) => chrome.tabs.sendMessage(
      id,
      { action, modeId },
    ), { id: tabId, action: ACTIONS.REMOVE_RESTORE_BUTTON, modeId: MODE_IDS.COMFORT_VISUAL });
    await expect(page.locator('#aura-restore-button')).toHaveCount(0);

    await serviceWorker.evaluate(({ id, action }) => {
      globalThis.__AURA_POST_TEARDOWN_REAPPLY_COUNT__ = 0;
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (sender?.tab?.id === id && sender?.frameId === 0 && message?.action === action) {
          globalThis.__AURA_POST_TEARDOWN_REAPPLY_COUNT__ += 1;
        }
      });
    }, { id: tabId, action: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES });
    const teardownResult = await serviceWorker.evaluate(async (id) => {
      const [entry] = await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        func: () => {
          const teardown = globalThis.__AURA_CONTENT_MAIN_TEARDOWN__;
          const wrappedPushState = history.pushState;
          teardown?.('e2e-teardown-proof');
          return {
            hookFound: typeof teardown === 'function',
            historyRestored: history.pushState !== wrappedPushState,
            listenerReleased: typeof globalThis.__AURA_CONTENT_MAIN_MESSAGE_LISTENER__ !== 'function',
          };
        },
      });
      return entry?.result || null;
    }, tabId);
    expect(teardownResult).toEqual({
      hookFound: true,
      historyRestored: true,
      listenerReleased: true,
    });

    await page.evaluate(() => {
      history.pushState({}, '', '/after-content-teardown');
      window.dispatchEvent(new CustomEvent('aura:spa-nav', {
        detail: { reason: 'post-teardown', kind: 'pathname', url: location.href },
      }));
    });
    await page.waitForTimeout(500);
    expect(await serviceWorker.evaluate(() => globalThis.__AURA_POST_TEARDOWN_REAPPLY_COUNT__ || 0)).toBe(0);
  } finally {
    await controlPage.close();
    await page.close();
    await context.close();
  }
});
