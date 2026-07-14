import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ACTIONS, MODE_IDS, SMARTSCOPE_ACTIONS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import {
  activateSuggestionBannerAction,
  createAuraServiceWorkerRestartController,
  getAuraTabId,
  launchWithExtension,
  setFeatureFlagsForTest,
  showSuggestionBanner,
  waitForAuraContentReady,
  waitForAuraReady,
  waitForStableModeEngine,
} from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const targetUrl = 'http://aura.local/concurrency.html';

async function openControlPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/welcome/welcome.html`);
  return page;
}

async function openFixturePage(context, fixtureHtml, url = targetUrl) {
  const page = await context.newPage();
  await page.route('http://aura.local/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: fixtureHtml,
  }));
  await page.goto(url);
  await page.waitForLoadState('domcontentloaded');
  await waitForAuraContentReady(page);
  return page;
}

async function readModeStates(serviceWorker, tabId) {
  return serviceWorker.evaluate(async ({ key, id, comfortModeId, focusModeId }) => {
    const stored = await chrome.storage.session.get(key);
    const tabState = stored?.[key]?.[id] || {};
    return {
      comfort: tabState[comfortModeId]?.state || null,
      focus: tabState[focusModeId]?.state || null,
    };
  }, {
    key: STORAGE_KEYS.TAB_STATE,
    id: tabId,
    comfortModeId: MODE_IDS.COMFORT_VISUAL,
    focusModeId: MODE_IDS.FOCUS,
  });
}

test.describe('real MV3 storage and lifecycle concurrency', () => {
  let context;
  let extensionId;
  let serviceWorker;
  let fixtureHtml;

  test.beforeAll(async () => {
    fixtureHtml = await fs.readFile(fixturePath, 'utf8');
    ({ context, extensionId } = await launchWithExtension({ extensionPath, headless: true }));
    serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    const resetPage = await openControlPage(context, extensionId);
    await resetPage.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    });
    await resetPage.close();
  });

  test('vendored tldts imports from a loaded extension page', async () => {
    const controlPage = await openControlPage(context, extensionId);
    try {
      const result = await controlPage.evaluate(async () => {
        const utils = await import(chrome.runtime.getURL('shared/utils.js'));
        return {
          coMa: utils.extractDomain('https://secure.bank.co.ma/login'),
          coUk: utils.extractDomain('shop.example.co.uk'),
          bankTarget: utils.parseStrictDomainInput('bank.co.ma'),
          suffixTarget: utils.parseStrictDomainInput('co.ma'),
          privateTarget: utils.parseStrictDomainInput('alice.github.io'),
        };
      });
      expect(result).toEqual({
        coMa: 'bank.co.ma',
        coUk: 'example.co.uk',
        bankTarget: {
          ok: true,
          hostname: 'bank.co.ma',
          siteKey: 'bank.co.ma',
          isIp: false,
        },
        suffixTarget: {
          ok: false,
          reason: 'Public suffix is not a site',
        },
        privateTarget: {
          ok: true,
          hostname: 'alice.github.io',
          siteKey: 'alice.github.io',
          isIp: false,
        },
      });
    } finally {
      await controlPage.close();
    }
  });

  test('ModeEngine diagnostics target one real web tab without exporting raw runtime data', async () => {
    const targetPage = await openFixturePage(context, fixtureHtml, 'http://aura.local/diagnostic-target.html');
    const otherPage = await openFixturePage(context, fixtureHtml, 'http://aura.local/diagnostic-other.html');
    const controlPage = await openControlPage(context, extensionId);
    const optionPageErrors = [];
    controlPage.on('pageerror', (error) => optionPageErrors.push(error.message));
    try {
      const targetTabId = await getAuraTabId(serviceWorker, targetPage);
      const otherTabId = await getAuraTabId(serviceWorker, otherPage);
      await controlPage.evaluate(async ({ keys, targetId, otherId, focusModeId }) => {
        const { runStorageAreaTransaction } = await import(chrome.runtime.getURL('shared/utils.js'));
        const now = Date.now();
        await runStorageAreaTransaction('session', () => chrome.storage.session.set({
          [keys.tabState]: {
            [targetId]: {
              [focusModeId]: {
                state: 'ERROR',
                pendingDecision: false,
                cssId: 'css-diagnostic-target',
                scopedV2: {
                  cssId: 'css-diagnostic-target',
                  scopeSelector: 'main[data-private="MV3_TARGET_SECRET"]',
                },
              },
            },
            [otherId]: {
              [focusModeId]: { state: 'ACTIVE', cssId: 'MV3_OTHER_TAB_SECRET' },
            },
          },
          [keys.cssRegistry]: {
            'css-diagnostic-target': {
              cssId: 'css-diagnostic-target',
              cssText: '.private { background: url(https://private.example/account); } /* MV3_TARGET_SECRET */',
              origin: 'AUTHOR',
              meta: { createdAt: now, scopeKey: 'main[data-private]' },
            },
          },
          [keys.lifecycle]: {
            schemaVersion: 1,
            tabs: {
              [targetId]: {
                generation: 2,
                desired: null,
                lastFinished: null,
                running: {
                  generation: 2,
                  modeId: focusModeId,
                  kind: 'REMOVE',
                  phase: 'RETRYABLE',
                  recoveryAttempts: 1,
                  urlKey: 'https://private.example/account',
                  documentInstanceId: 'MV3_DOCUMENT_SECRET',
                  artifacts: [{
                    kind: 'CSS_REMOVE',
                    status: 'PLANNED',
                    cleanup: { cssText: '.private{}', selector: 'main[data-private]' },
                  }],
                },
              },
            },
          },
          [keys.signalSnapshots]: {
            [targetId]: {
              updatedAt: now,
              lastSeenAt: now,
              byType: {
                zoom: { value: 1.5, confidence: 0.9, ts: now, source: 'browser' },
              },
            },
          },
          [keys.debugSignals]: [{
            tabId: targetId,
            type: 'zoom',
            value: 'https://private.example/account',
            confidence: 0.9,
            ts: now,
            source: 'browser',
          }],
        }));
      }, {
        keys: {
          tabState: STORAGE_KEYS.TAB_STATE,
          cssRegistry: STORAGE_KEYS.CSS_REGISTRY,
          lifecycle: STORAGE_KEYS.LIFECYCLE_JOURNAL_V1,
          signalSnapshots: STORAGE_KEYS.SIGNAL_SNAPSHOTS,
          debugSignals: STORAGE_KEYS.DEBUG_SIGNAL_EVENTS,
        },
        targetId: targetTabId,
        otherId: otherTabId,
        focusModeId: MODE_IDS.FOCUS,
      });

      const response = await controlPage.evaluate(
        async ({ action, tabId }) => chrome.runtime.sendMessage({ action, tabId }),
        { action: ACTIONS.GET_DEBUG_SNAPSHOT, tabId: targetTabId },
      );

      expect(response.ok).toBe(true);
      expect(response.diagnostic.kind).toBe('ModeEngineDiagnosticSnapshotV1');
      expect(response.diagnostic.target).toEqual({ tabId: targetTabId });
      expect(response.diagnostic.storage.modeState.status).toBe('found');
      expect(response.diagnostic.lifecycle.running.phase).toBe('RETRYABLE');
      expect(response.diagnostic.cssRegistry.referenced[0]).toMatchObject({
        id: 'css-diagnostic-target',
        present: true,
      });
      expect(response.lifecycle).toBeUndefined();
      expect(response.snapshot).toBeUndefined();

      const unsupportedResponse = await controlPage.evaluate(async ({ action }) => {
        const currentTab = await chrome.tabs.getCurrent();
        return chrome.runtime.sendMessage({ action, tabId: currentTab.id });
      }, { action: ACTIONS.GET_DEBUG_SNAPSHOT });
      expect(unsupportedResponse).toEqual({ ok: false, error: 'DEBUG_TARGET_UNSUPPORTED' });

      const serialized = JSON.stringify(response);
      for (const forbidden of [
        'MV3_TARGET_SECRET',
        'MV3_OTHER_TAB_SECRET',
        'MV3_DOCUMENT_SECRET',
        'private.example',
        '.private',
        'main[data-private]',
        'cssText',
        'scopeSelector',
        'documentInstanceId',
        'urlKey',
        'cleanup',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }

      await controlPage.goto(`chrome-extension://${extensionId}/options/options.html`);
      const targetSelect = controlPage.locator('#debug-target-tab');
      await expect.poll(async () => targetSelect.locator('option').evaluateAll(
        (options) => options.map((option) => option.value),
      )).toContain(String(targetTabId));
      await targetSelect.selectOption(String(targetTabId));
      await controlPage.locator('#debug-snapshot-refresh').click();
      await expect(controlPage.locator('#debug-snapshot-status')).toContainText('Debug snapshot refreshed');
      await expect.poll(() => controlPage.locator('#debug-snapshot-body tr').count()).toBeGreaterThan(0);

      const downloadPromise = controlPage.waitForEvent('download');
      await controlPage.locator('#debug-snapshot-export').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^aura-debug-snapshot-\d{4}-\d{2}-\d{2}\.json$/);
      const downloadedPath = await download.path();
      const exportedDiagnostic = JSON.parse(await fs.readFile(downloadedPath, 'utf8'));
      expect(exportedDiagnostic.kind).toBe('ModeEngineDiagnosticSnapshotV1');
      expect(exportedDiagnostic.target).toEqual({ tabId: targetTabId });
      expect(exportedDiagnostic.lifecycle.running.phase).toBe('RETRYABLE');
      const exportedJson = JSON.stringify(exportedDiagnostic);
      for (const forbidden of [
        'MV3_TARGET_SECRET',
        'MV3_OTHER_TAB_SECRET',
        'MV3_DOCUMENT_SECRET',
        'private.example',
        '.private',
        'main[data-private]',
        'cssText',
        'scopeSelector',
        'documentInstanceId',
        'urlKey',
        'cleanup',
      ]) {
        expect(exportedJson).not.toContain(forbidden);
      }

      await targetPage.goto('http://aura.local/diagnostic-after-navigation.html');
      await targetPage.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(targetPage);
      expect(await getAuraTabId(serviceWorker, targetPage)).toBe(targetTabId);
      await controlPage.evaluate(async ({ key, tabId }) => {
        const stored = await chrome.storage.session.get(key);
        const snapshots = stored?.[key] || {};
        const now = Date.now();
        snapshots[tabId] = {
          updatedAt: now,
          lastSeenAt: now,
          byType: {
            zoom: { value: 1.75, confidence: 0.95, ts: now, source: 'browser' },
          },
        };
        await chrome.storage.session.set({ [key]: snapshots });
      }, { key: STORAGE_KEYS.SIGNAL_SNAPSHOTS, tabId: targetTabId });

      const freshDownloadPromise = controlPage.waitForEvent('download');
      await controlPage.locator('#debug-snapshot-export').click();
      const freshDownload = await freshDownloadPromise;
      const freshPath = await freshDownload.path();
      const freshDiagnostic = JSON.parse(await fs.readFile(freshPath, 'utf8'));
      expect(freshDiagnostic.target).toEqual({ tabId: targetTabId });
      expect(freshDiagnostic.signals.snapshot.byType.zoom.value).toBe(1.75);

      await targetPage.close();
      const unexpectedDownload = controlPage.waitForEvent('download', { timeout: 1000 })
        .then(() => true, () => false);
      await controlPage.locator('#debug-snapshot-export').click();
      await expect(controlPage.locator('#debug-snapshot-status')).toContainText('Choose an HTTP(S) tab to export');
      expect(await unexpectedDownload).toBe(false);
      await expect(targetSelect).toHaveValue('');
      await expect.poll(async () => targetSelect.locator('option').evaluateAll(
        (options) => options.map((option) => option.value),
      )).toContain(String(otherTabId));
      expect(optionPageErrors).toEqual([]);
    } finally {
      await controlPage.close();
      await otherPage.close();
      if (!targetPage.isClosed()) await targetPage.close();
    }
  });

  test('document identity is SPA-stable, reload-bound, reinjection-safe, and rejects stale mutations', async () => {
    await setFeatureFlagsForTest(serviceWorker, { smartScopeSpaHooks: true });
    const page = await openFixturePage(context, fixtureHtml);
    const controlPage = await openControlPage(context, extensionId);
    try {
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      const tabId = await getAuraTabId(serviceWorker, page);
      const readContext = () => controlPage.evaluate(async ({ id, action }) => chrome.tabs.sendMessage(
        id,
        { action },
        { frameId: 0 },
      ), {
        id: tabId,
        action: ACTIONS.GET_DOCUMENT_CONTEXT_V1,
      });
      const before = await readContext();
      await page.evaluate(() => history.pushState({}, '', '/spa-route'));
      const afterPushState = await readContext();

      await page.evaluate(() => history.replaceState({}, '', '/spa-replaced#one'));
      const afterReplaceState = await readContext();

      await page.evaluate(() => {
        location.hash = 'two';
      });
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#two');
      const afterHashChange = await readContext();

      expect(afterPushState.url).not.toBe(before.url);
      expect(afterPushState.documentInstanceId).toBe(before.documentInstanceId);
      expect(afterReplaceState.documentInstanceId).toBe(before.documentInstanceId);
      expect(afterHashChange.documentInstanceId).toBe(before.documentInstanceId);

      const staleMutation = await controlPage.evaluate(async ({ id, action, documentId }) => chrome.tabs.sendMessage(
        id,
        {
          action,
          expectedDocumentInstanceId: `${documentId}-stale`,
          token: 'identity-stale-token',
          operations: [{ selector: 'body', add: ['aura-stale-identity-mutation'] }],
        },
        { frameId: 0 },
      ), {
        id: tabId,
        action: SMARTSCOPE_ACTIONS.APPLY_CLASSES,
        documentId: before.documentInstanceId,
      });
      expect(staleMutation).toEqual({ ok: false, error: 'DOCUMENT_IDENTITY_MISMATCH' });
      expect(await page.locator('body').evaluate((body) => body.classList.contains('aura-stale-identity-mutation'))).toBe(false);

      await serviceWorker.evaluate(({ id, readyAction, reapplyAction }) => {
        globalThis.__AURA_REINJECTION_COUNTS__ = { ready: 0, reapply: 0 };
        chrome.runtime.onMessage.addListener((message, sender) => {
          if (sender?.tab?.id !== id || sender?.frameId !== 0) {
            return;
          }
          if (message?.action === readyAction) {
            globalThis.__AURA_REINJECTION_COUNTS__.ready += 1;
          }
          if (message?.action === reapplyAction) {
            globalThis.__AURA_REINJECTION_COUNTS__.reapply += 1;
          }
        });
      }, {
        id: tabId,
        readyAction: ACTIONS.CONTENT_SCRIPT_READY_V2,
        reapplyAction: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES,
      });

      for (let reinjection = 0; reinjection < 3; reinjection += 1) {
        await serviceWorker.evaluate(async (id) => {
          await chrome.scripting.executeScript({
            target: { tabId: id, frameIds: [0] },
            files: [
              'content/content-message-router.runtime.js',
              'content/content-main.js',
            ],
          });
        }, tabId);
        await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      }
      expect(await serviceWorker.evaluate(() => globalThis.__AURA_REINJECTION_COUNTS__?.ready || 0)).toBe(0);
      const afterReinjection = await readContext();
      expect(afterReinjection.documentInstanceId).toBe(before.documentInstanceId);

      await page.evaluate(() => {
        history.pushState({}, '', '/after-reinjection');
        window.dispatchEvent(new CustomEvent('aura:spa-nav', {
          detail: { reason: 'reinjection-proof', kind: 'pathname', url: location.href },
        }));
      });
      await expect.poll(
        () => serviceWorker.evaluate(() => globalThis.__AURA_REINJECTION_COUNTS__?.reapply || 0),
        { timeout: 10000, intervals: [100, 250, 500] },
      ).toBe(1);
      await page.waitForTimeout(1000);
      expect(await serviceWorker.evaluate(() => globalThis.__AURA_REINJECTION_COUNTS__?.reapply || 0)).toBe(1);

      const reloadUrl = page.url();
      await page.reload();
      await waitForAuraContentReady(page);
      const afterReload = await readContext();
      expect(afterReload.url).toBe(reloadUrl);
      expect(afterReload.documentInstanceId).not.toBe(before.documentInstanceId);
    } finally {
      await controlPage.close();
      await page.close();
    }
  });

  test('a quarantined operation in one tab does not block apply and restore in another tab', async () => {
    const isolated = await launchWithExtension({ extensionPath, headless: true });
    const isolatedContext = isolated.context;
    const isolatedExtensionId = isolated.extensionId;
    let isolatedServiceWorker = isolatedContext.serviceWorkers()[0] || await isolatedContext.waitForEvent('serviceworker');
    const quarantinedPage = await openFixturePage(
      isolatedContext,
      fixtureHtml,
      'http://aura.local/quarantine-a.html',
    );
    const healthyPage = await openFixturePage(isolatedContext, fixtureHtml, 'http://aura.local/healthy-b.html');
    const controlPage = await openControlPage(isolatedContext, isolatedExtensionId);
    let restartController;
    try {
      await waitForAuraReady(isolatedServiceWorker, quarantinedPage, { timeoutMs: 20000 });
      await waitForAuraReady(isolatedServiceWorker, healthyPage, { timeoutMs: 20000 });
      const quarantinedTabId = await getAuraTabId(isolatedServiceWorker, quarantinedPage);
      const healthyTabId = await getAuraTabId(isolatedServiceWorker, healthyPage);
      const documentContext = await controlPage.evaluate(async ({ id, action }) => chrome.tabs.sendMessage(id, { action }), {
        id: quarantinedTabId,
        action: ACTIONS.GET_DOCUMENT_CONTEXT_V1,
      });
      const now = Date.now();
      await controlPage.evaluate(async ({ key, tabId, modeId, documentInstanceId, timestamp }) => {
        const operation = {
          opId: 'e2e-quarantined-operation',
          generation: 1,
          tabId,
          modeId,
          kind: 'APPLY',
          targetState: 'ACTIVE',
          source: 'e2e-real-quarantine',
          priority: 30,
          documentInstanceId,
          chromeDocumentId: null,
          phase: 'QUARANTINED',
          beforeState: { state: 'INACTIVE' },
          artifacts: [],
          postCommit: [],
          recoveryAttempts: 3,
          interruptedPhase: 'MUTATING',
          lastAttemptAt: timestamp,
          lastError: 'DOCUMENT_IDENTITY_UNVERIFIABLE',
          reason: 'DOCUMENT_IDENTITY_UNVERIFIABLE',
          nextRetryAt: null,
          quarantinedAt: timestamp,
          quarantineReason: 'DOCUMENT_IDENTITY_UNVERIFIABLE',
          updatedAt: timestamp,
        };
        await chrome.storage.session.set({
          [key]: {
            schemaVersion: 1,
            tabs: {
              [tabId]: {
                generation: 1,
                desired: operation,
                running: operation,
                lastFinished: null,
              },
            },
          },
        });
      }, {
        key: STORAGE_KEYS.LIFECYCLE_JOURNAL_V1,
        tabId: quarantinedTabId,
        modeId: MODE_IDS.FOCUS,
        documentInstanceId: documentContext.documentInstanceId,
        timestamp: now,
      });

      restartController = await createAuraServiceWorkerRestartController(
        isolatedContext,
        healthyPage,
        isolatedExtensionId,
      );
      const stopped = await restartController.stop();
      const wake = controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
        action,
        tabId: id,
        modeId,
      }), { action: ACTIONS.GET_STATE, id: healthyTabId, modeId: MODE_IDS.COMFORT_VISUAL });
      await restartController.waitForRunningAfter(stopped.stoppedSequence);
      isolatedServiceWorker = isolatedContext.serviceWorkers().at(-1)
        || await isolatedContext.waitForEvent('serviceworker');
      await wake;

      const applied = await controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
        action,
        tabId: id,
        modeId,
        decision: 'ENABLED',
      }), { action: ACTIONS.USER_DECISION, id: healthyTabId, modeId: MODE_IDS.COMFORT_VISUAL });
      expect(applied?.ok, JSON.stringify(applied, null, 2)).toBe(true);

      const restored = await controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
        action,
        tabId: id,
        modeId,
      }), { action: ACTIONS.RESTORE_MODE, id: healthyTabId, modeId: MODE_IDS.COMFORT_VISUAL });
      expect(restored?.ok, JSON.stringify(restored, null, 2)).toBe(true);

      const stored = await controlPage.evaluate(async (key) => (await chrome.storage.session.get(key))[key],
        STORAGE_KEYS.LIFECYCLE_JOURNAL_V1);
      expect(stored.tabs[quarantinedTabId].running.phase).toBe('QUARANTINED');
    } finally {
      await restartController?.dispose();
      await controlPage.close();
      await healthyPage.close();
      await quarantinedPage.close();
      await isolatedContext.close();
    }
  });

  test('Web Locks preserve all cross-page storage mutations', async () => {
    const firstPage = await openControlPage(context, extensionId);
    const secondPage = await openControlPage(context, extensionId);
    const storageKey = 'e2eAtomicCounter';

    try {
      const increment = async ({ key, count }) => {
        if (typeof navigator.locks?.request !== 'function') {
          throw new Error('Web Locks unavailable in the loaded MV3 extension page');
        }
        const { mutateLocalValue } = await import(chrome.runtime.getURL('shared/utils.js'));
        for (let index = 0; index < count; index += 1) {
          await mutateLocalValue(key, async (current) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return (Number(current) || 0) + 1;
          });
        }
      };

      await Promise.all([
        firstPage.evaluate(increment, { key: storageKey, count: 50 }),
        secondPage.evaluate(increment, { key: storageKey, count: 50 }),
      ]);

      const stored = await serviceWorker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], storageKey);
      expect(stored).toBe(100);
    } finally {
      await firstPage.close();
      await secondPage.close();
    }
  });

  test('an area transaction cannot be undone by an older in-flight mutation', async () => {
    const mutationPage = await openControlPage(context, extensionId);
    const resetPage = await openControlPage(context, extensionId);
    const storageKey = 'e2eResetRace';

    try {
      const mutation = mutationPage.evaluate(async (key) => {
        const { mutateLocalValue } = await import(chrome.runtime.getURL('shared/utils.js'));
        return mutateLocalValue(key, async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return 'stale-write';
        });
      }, storageKey);
      await expect.poll(async () => mutationPage.evaluate(async () => {
        const snapshot = await navigator.locks.query();
        return snapshot.held.some((lock) => lock.name === 'aura-storage:local:*');
      }), {
        timeout: 1000,
        intervals: [5, 10, 20],
      }).toBe(true);
      const reset = resetPage.evaluate(async () => {
        const { runStorageAreaTransaction } = await import(chrome.runtime.getURL('shared/utils.js'));
        await runStorageAreaTransaction('local', () => chrome.storage.local.clear());
      });

      await Promise.all([mutation, reset]);
      const stored = await serviceWorker.evaluate(async (key) => (await chrome.storage.local.get(key))[key], storageKey);
      expect(stored).toBeUndefined();
    } finally {
      await mutationPage.close();
      await resetPage.close();
    }
  });

  test('Options reset removes active document effects before clearing all storage', async () => {
    await setFeatureFlagsForTest(serviceWorker, {
      scopedModeCssV2: true,
      smartScopeV2: true,
    });
    const firstPage = await openFixturePage(context, fixtureHtml, 'http://aura.local/reset-first.html');
    const secondPage = await openFixturePage(context, fixtureHtml, 'http://aura.local/reset-second.html');
    const optionsPage = await openControlPage(context, extensionId);
    const pageErrors = [];
    optionsPage.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      for (const page of [firstPage, secondPage]) {
        await waitForAuraReady(serviceWorker, page);
        const injected = await showSuggestionBanner(serviceWorker, page, {
          modeId: MODE_IDS.FOCUS,
          confidence: 0.9,
          signals: [],
        });
        expect(injected?.ok, JSON.stringify(injected, null, 2)).toBe(true);
        await activateSuggestionBannerAction(page, 'enable');
        await page.waitForFunction(() => document.querySelector('[data-aura-scope="1"]'));
        await waitForStableModeEngine(page);
        await expect.poll(() => page.evaluate(() => ({
          scope: Boolean(document.querySelector('[data-aura-scope="1"]')),
          restoreButton: Boolean(document.getElementById('aura-restore-button')),
        }))).toEqual({ scope: true, restoreButton: true });
      }

      await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html#section-data`);
      await optionsPage.locator('#reset-all-data').click();
      await expect(optionsPage.locator('#confirm-reset-all')).toBeVisible();
      await optionsPage.locator('#confirm-reset-all-btn').click();
      await expect(optionsPage.locator('#status-data')).toContainText('All data cleared');

      for (const page of [firstPage, secondPage]) {
        await expect.poll(() => page.evaluate(() => ({
          scope: Boolean(document.querySelector('[data-aura-scope="1"]')),
          style: Boolean(document.querySelector('style[data-aura-style], style[id^="aura-"]')),
          restoreButton: Boolean(document.getElementById('aura-restore-button')),
        })), {
          timeout: 15000,
          intervals: [100, 250, 500, 1000],
        }).toEqual({ scope: false, style: false, restoreButton: false });
      }

      const stored = await optionsPage.evaluate(async () => ({
        local: await chrome.storage.local.get(null),
        session: await chrome.storage.session.get(null),
      }));
      expect(stored).toEqual({ local: {}, session: {} });
      expect(pageErrors).toEqual([]);
    } finally {
      await optionsPage.close();
      await secondPage.close();
      await firstPage.close();
    }
  });

  test('apply followed immediately by restore cannot leave stale ACTIVE state or CSS', async () => {
    const page = await openFixturePage(context, fixtureHtml);
    const controlPage = await openControlPage(context, extensionId);

    try {
      await waitForAuraReady(serviceWorker, page);
      const tabId = await getAuraTabId(serviceWorker, page);
      expect(typeof tabId).toBe('number');

      const responses = await controlPage.evaluate(async ({ apply, restore, id, modeId }) => {
        const applyPromise = chrome.runtime.sendMessage({
          action: apply,
          tabId: id,
          modeId,
          decision: 'ENABLED',
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        const restorePromise = chrome.runtime.sendMessage({ action: restore, tabId: id, modeId });
        return Promise.all([applyPromise, restorePromise]);
      }, {
        apply: ACTIONS.USER_DECISION,
        restore: ACTIONS.RESTORE_MODE,
        id: tabId,
        modeId: MODE_IDS.COMFORT_VISUAL,
      });

      expect(responses[1]?.ok, JSON.stringify(responses, null, 2)).toBe(true);
      await expect.poll(async () => (await readModeStates(serviceWorker, tabId)).comfort, {
        timeout: 15000,
        intervals: [100, 250, 500, 1000],
      }).toBe(STATES.INACTIVE);
      await expect.poll(async () => page.evaluate(() => ({
        scope: Boolean(document.querySelector('[data-aura-scope="1"]')),
        style: Boolean(document.querySelector('style[data-aura-style], style[id^="aura-"]')),
      }))).toEqual({ scope: false, style: false });
    } finally {
      await controlPage.close();
      await page.close();
    }
  });

  test('simultaneous exclusive mode decisions finish with exactly one ACTIVE mode', async () => {
    const page = await openFixturePage(context, fixtureHtml);
    const controlPage = await openControlPage(context, extensionId);

    try {
      await waitForAuraReady(serviceWorker, page);
      const tabId = await getAuraTabId(serviceWorker, page);
      expect(typeof tabId).toBe('number');

      await controlPage.evaluate(async ({ action, id, comfortModeId, focusModeId }) => Promise.all([
        chrome.runtime.sendMessage({ action, tabId: id, modeId: comfortModeId, decision: 'ENABLED' }),
        chrome.runtime.sendMessage({ action, tabId: id, modeId: focusModeId, decision: 'ENABLED' }),
      ]), {
        action: ACTIONS.USER_DECISION,
        id: tabId,
        comfortModeId: MODE_IDS.COMFORT_VISUAL,
        focusModeId: MODE_IDS.FOCUS,
      });

      await expect.poll(async () => {
        const states = await readModeStates(serviceWorker, tabId);
        return [states.comfort, states.focus].filter((state) => state === STATES.ACTIVE).length;
      }, {
        timeout: 20000,
        intervals: [100, 250, 500, 1000],
      }).toBe(1);
    } finally {
      await controlPage.close();
      await page.close();
    }
  });

  test('service-worker restart completes an interrupted persisted restore intent', async () => {
    const page = await openFixturePage(context, fixtureHtml);
    const controlPage = await openControlPage(context, extensionId);
    let restartController;

    try {
      await waitForAuraReady(serviceWorker, page);
      const tabId = await getAuraTabId(serviceWorker, page);
      expect(typeof tabId).toBe('number');

      const applied = await controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
        action,
        tabId: id,
        modeId,
        decision: 'ENABLED',
      }), { action: ACTIONS.USER_DECISION, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL });
      expect(applied?.ok, JSON.stringify(applied, null, 2)).toBe(true);

      await serviceWorker.evaluate(async ({ key, id, modeId }) => {
        const stored = await chrome.storage.session.get(key);
        const tabState = stored?.[key] || {};
        tabState[id] = {
          ...(tabState[id] || {}),
          [modeId]: { ...(tabState[id]?.[modeId] || {}), pendingDecision: true },
        };
        await chrome.storage.session.set({ [key]: tabState });
      }, { key: STORAGE_KEYS.TAB_STATE, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL });

      restartController = await createAuraServiceWorkerRestartController(context, page, extensionId);
      const stopped = await restartController.stop();
      const responsePromise = controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
        action,
        tabId: id,
        modeId,
      }), { action: ACTIONS.GET_STATE, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL });
      await restartController.waitForRunningAfter(stopped.stoppedSequence);
      await responsePromise;

      await expect.poll(async () => controlPage.evaluate(async ({ key, id, modeId }) => {
        const stored = await chrome.storage.session.get(key);
        return stored?.[key]?.[id]?.[modeId] || null;
      }, { key: STORAGE_KEYS.TAB_STATE, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL }), {
        timeout: 15000,
        intervals: [100, 250, 500, 1000],
      }).toMatchObject({ state: STATES.INACTIVE, pendingDecision: false });
      await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-aura-scope="1"]')))).toBe(false);
    } finally {
      await restartController?.dispose();
      await controlPage.close();
      await page.close();
    }
  });

  const lifecycleCrashCases = [
    { name: 'apply after tokens', operation: 'apply', checkpoint: 'TOKENS_DONE', expectedState: STATES.ERROR },
    { name: 'apply after CSS insertion', operation: 'apply', checkpoint: 'CSS_INSERT_DONE', expectedState: STATES.ERROR },
    { name: 'apply after registry persistence', operation: 'apply', checkpoint: 'REGISTRY_DONE', expectedState: STATES.ERROR },
    { name: 'apply after ACTIVE state commit', operation: 'apply', checkpoint: 'STATE_COMMITTED', expectedState: STATES.ACTIVE },
    { name: 'rehydrate after ACTIVE state commit', operation: 'rehydrate', checkpoint: 'STATE_COMMITTED', expectedState: STATES.ACTIVE },
    { name: 'remove after CSS removal', operation: 'remove', checkpoint: 'CSS_REMOVE_DONE', expectedState: STATES.INACTIVE },
    { name: 'remove after INACTIVE state commit', operation: 'remove', checkpoint: 'STATE_COMMITTED', expectedState: STATES.INACTIVE },
  ];

  for (const crashCase of lifecycleCrashCases) {
    test(`real MV3 crash recovery converges ${crashCase.name}`, async () => {
      const page = await openFixturePage(context, fixtureHtml);
      const controlPage = await openControlPage(context, extensionId);
      let restartController;

      try {
        await controlPage.evaluate(async () => {
          const { featureFlags, userPrefs } = await chrome.storage.local.get(['featureFlags', 'userPrefs']);
          await chrome.storage.local.set({
            featureFlags: {
              ...(featureFlags || {}),
              debugTestHooks: true,
              smoothThemeTransitionsV2: false,
            },
            userPrefs: {
              ...(userPrefs || {}),
              reducedMotion: true,
            },
          });
        });
        const tabId = await controlPage.evaluate(async (url) => {
          const tabs = await chrome.tabs.query({});
          return tabs.find((tab) => tab.url === url)?.id ?? null;
        }, page.url());
        expect(typeof tabId).toBe('number');

        if (crashCase.operation === 'remove' || crashCase.operation === 'rehydrate') {
          const applied = await controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
            action,
            tabId: id,
            modeId,
            decision: 'ENABLED',
          }), { action: ACTIONS.USER_DECISION, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL });
          expect(applied?.ok, JSON.stringify(applied, null, 2)).toBe(true);
        }

        const armed = await controlPage.evaluate(async ({ action, id, checkpoint }) => chrome.runtime.sendMessage({
          action,
          tabId: id,
          checkpoint,
        }), {
          action: ACTIONS.TEST_LIFECYCLE_ARM_PAUSE_V1,
          id: tabId,
          checkpoint: crashCase.checkpoint,
        });
        expect(armed?.ok, JSON.stringify(armed, null, 2)).toBe(true);

        if (crashCase.operation === 'rehydrate') {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await waitForAuraContentReady(page);
        } else {
          await controlPage.evaluate(({ action, id, modeId, operation }) => {
            const message = operation === 'remove'
              ? { action, tabId: id, modeId }
              : { action, tabId: id, modeId, decision: 'ENABLED' };
            void chrome.runtime.sendMessage(message).catch(() => {});
          }, {
            action: crashCase.operation === 'remove' ? ACTIONS.RESTORE_MODE : ACTIONS.USER_DECISION,
            id: tabId,
            modeId: MODE_IDS.COMFORT_VISUAL,
            operation: crashCase.operation,
          });
        }

        await expect.poll(async () => controlPage.evaluate(async (action) => chrome.runtime.sendMessage({ action }),
          ACTIONS.TEST_LIFECYCLE_GET_PAUSE_V1), {
          timeout: 15000,
          intervals: [50, 100, 250],
        }).toMatchObject({ ok: true, reached: { tabId, checkpoint: crashCase.checkpoint } });

        const journalBeforeCrash = await controlPage.evaluate(async (key) => (await chrome.storage.session.get(key))[key],
          STORAGE_KEYS.LIFECYCLE_JOURNAL_V1);
        expect(journalBeforeCrash?.tabs?.[tabId]?.running?.opId).toBeTruthy();

        restartController = await createAuraServiceWorkerRestartController(context, page, extensionId);
        const stopped = await restartController.stop();
        const wake = controlPage.evaluate(async ({ action, id, modeId }) => chrome.runtime.sendMessage({
          action,
          tabId: id,
          modeId,
        }), { action: ACTIONS.GET_STATE, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL });
        await restartController.waitForRunningAfter(stopped.stoppedSequence);
        await wake;

        await expect.poll(async () => controlPage.evaluate(async ({ journalKey, id }) => {
          const stored = await chrome.storage.session.get(journalKey);
          const slot = stored?.[journalKey]?.tabs?.[id] || null;
          return { desired: slot?.desired || null, running: slot?.running || null };
        }, { journalKey: STORAGE_KEYS.LIFECYCLE_JOURNAL_V1, id: tabId }), {
          timeout: 20000,
          intervals: [100, 250, 500],
        }).toEqual({ desired: null, running: null });

        await expect.poll(async () => controlPage.evaluate(async ({ stateKey, id, modeId }) => {
          const stored = await chrome.storage.session.get(stateKey);
          return stored?.[stateKey]?.[id]?.[modeId]?.state || null;
        }, { stateKey: STORAGE_KEYS.TAB_STATE, id: tabId, modeId: MODE_IDS.COMFORT_VISUAL }), {
          timeout: 15000,
          intervals: [100, 250, 500],
        }).toBe(crashCase.expectedState);

        const registryEntries = await controlPage.evaluate(async ({ key, id }) => {
          const stored = await chrome.storage.session.get(key);
          return Object.values(stored?.[key] || {}).filter((entry) => entry?.meta?.tabId === id).length;
        }, { key: STORAGE_KEYS.CSS_REGISTRY, id: tabId });
        if (crashCase.expectedState === STATES.ACTIVE) {
          expect(registryEntries).toBeGreaterThan(0);
        } else {
          expect(registryEntries).toBe(0);
          await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-aura-scope="1"]')))).toBe(false);
        }
      } finally {
        await restartController?.dispose();
        await controlPage.close();
        await page.close();
      }
    });
  }
});
