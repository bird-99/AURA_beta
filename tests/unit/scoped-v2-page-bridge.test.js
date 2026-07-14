import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  collectScopedV2InspectionBaselineInPage,
  ensureContentInFrame,
  ensureScopeRootMarked,
  inspectScopedV2PostApplyInPage,
  isNonTrivialScope,
  pickBestFrame,
  runScopedScript,
  salvageScopeRootBySelectorInPage,
  shouldAttemptFrameFallback,
  verifyScopeRootBySelectorInPage,
} from '../../background/scoped-v2-page-bridge.js';
import { contentBridge } from '../../background/content-bridge.js';
import { ACTIONS } from '../../shared/constants.js';

const originalSafeSend = contentBridge.safeSend;

afterEach(() => {
  contentBridge.safeSend = originalSafeSend;
  delete global.chrome;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
});

test('scoped-v2 page bridge does not import css-applier', async () => {
  const source = await readFile(join(process.cwd(), 'background/scoped-v2-page-bridge.js'), 'utf8');

  assert.equal(source.includes('./css-applier.js'), false);
  assert.equal(source.includes('css-applier'), false);
});

test('ensureContentInFrame injects scoped runtime files in order after a missing receiver', async () => {
  const sendMessages = [];
  const scriptCalls = [];
  let pingCount = 0;

  global.chrome = {
    runtime: { lastError: null },
    tabs: {
      sendMessage: (tabId, message, options, callback) => {
        const actualCallback = typeof options === 'function' ? options : callback;
        sendMessages.push({ tabId, message, options: typeof options === 'function' ? null : options });
        pingCount += 1;

        if (pingCount === 1) {
          global.chrome.runtime.lastError = { message: 'Receiving end does not exist' };
          actualCallback();
          global.chrome.runtime.lastError = null;
          return;
        }

        actualCallback({ ok: true });
      },
    },
    scripting: {
      executeScript: async (payload) => {
        scriptCalls.push(payload);
      },
    },
  };

  const result = await ensureContentInFrame(7, 2);

  assert.deepEqual(result, { ok: true, injected: true });
  assert.equal(sendMessages.length, 2);
  assert.equal(sendMessages[0].message.action, ACTIONS.TEST_PING_CONTENT);
  assert.deepEqual(scriptCalls[0].target, { tabId: 7, frameIds: [2] });
  assert.deepEqual(scriptCalls[0].files, [
    'content/smartscope-v2.runtime.js',
    'content/mode-engine-scoped-v2.runtime.js',
    'content/dark-comfort-theme.runtime.js',
    'content/content-bootstrap.runtime.js',
    'content/content-message-router.runtime.js',
    'content/content-main.js',
  ]);
});

test('ensureContentInFrame waits for BOOTSTRAPPING without reinjecting frame runtimes', async () => {
  const scriptCalls = [];
  const responses = [
    { ok: false, phase: 'BOOTSTRAPPING', retryable: false },
    { ok: true },
  ];
  global.chrome = {
    runtime: { lastError: null },
    tabs: {
      sendMessage(tabId, message, options, callback) {
        callback(responses.shift());
      },
    },
    scripting: {
      async executeScript(payload) {
        scriptCalls.push(payload);
      },
    },
  };

  const result = await ensureContentInFrame(8, 3);

  assert.deepEqual(result, { ok: true, injected: false });
  assert.deepEqual(scriptCalls, []);
});

test('ensureContentInFrame reinjects the router and content-main after retryable bootstrap failure', async () => {
  const scriptCalls = [];
  const responses = [
    { ok: false, phase: 'RETRYABLE_FAILED', reason: 'TIMEOUT', retryable: true },
    { ok: true },
  ];
  global.chrome = {
    runtime: { lastError: null },
    tabs: {
      sendMessage(tabId, message, options, callback) {
        callback(responses.shift());
      },
    },
    scripting: {
      async executeScript(payload) {
        scriptCalls.push(payload);
      },
    },
  };

  const result = await ensureContentInFrame(9, 4);

  assert.deepEqual(result, { ok: true, injected: true });
  assert.deepEqual(scriptCalls, [{
    target: { tabId: 9, frameIds: [4] },
    files: [
      'content/content-message-router.runtime.js',
      'content/content-main.js',
    ],
  }]);
});

test('runScopedScript uses isolated world and targeted frame ids', async () => {
  const calls = [];
  global.chrome = {
    scripting: {
      executeScript: async (payload) => {
        calls.push(payload);
        return [{ result: { ok: true, value: payload.func(...payload.args) } }];
      },
    },
  };

  const result = await runScopedScript(9, (value) => value + 1, [41], { frameId: 5 });

  assert.deepEqual(result, { ok: true, value: 42 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].target, { tabId: 9, frameIds: [5] });
  assert.equal(calls[0].world, 'ISOLATED');
  assert.equal('allFrames' in calls[0].target, false);
});

test('runScopedScript maps receiving-end failures to NO_RECEIVER', async () => {
  global.chrome = {
    scripting: {
      executeScript: async () => {
        throw new Error('Receiving end does not exist');
      },
    },
  };

  const result = await runScopedScript(9, () => ({ ok: true }));

  assert.deepEqual(result, {
    ok: false,
    error: 'NO_RECEIVER',
    detail: 'Receiving end does not exist',
  });
});

test('verify and salvage use the isolated scoped runtime contract and preserve source', async () => {
  const calls = [];
  global.chrome = {
    scripting: {
      executeScript: async (payload) => {
        calls.push(payload);
        return [{ result: payload.func(...payload.args) }];
      },
    },
  };
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    verifyScopeRootBySelector: (selector) => ({ ok: true, selector }),
    salvageScopeRootBySelector: (selector, debugEnabled) => ({ ok: true, selector: `${selector} > article`, debugEnabled }),
  };

  const verified = await verifyScopeRootBySelectorInPage(4, 'main', { frameId: 2 });
  const salvaged = await salvageScopeRootBySelectorInPage(4, 'main', { frameId: 2, debugEnabled: true });

  assert.deepEqual(verified, { ok: true, selector: 'main', source: 'verifyScopeRoot' });
  assert.deepEqual(salvaged, {
    ok: true,
    selector: 'main > article',
    debugEnabled: true,
    tried: true,
    source: 'salvageScopeRoot',
  });
  assert.equal(calls.every((call) => call.world === 'ISOLATED'), true);
  assert.deepEqual(calls.map((call) => call.target), [
    { tabId: 4, frameIds: [2] },
    { tabId: 4, frameIds: [2] },
  ]);
});

test('post-apply inspection uses isolated scoped runtime and preserves source', async () => {
  const calls = [];
  let receivedOptions = null;
  global.chrome = {
    scripting: {
      executeScript: async (payload) => {
        calls.push(payload);
        return [{ result: payload.func(...payload.args) }];
      },
    },
  };
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    inspectPostApply: (options) => {
      receivedOptions = options;
      return {
        ok: true,
        inspected: true,
        received: options,
        rawText: 'leak',
        scopeSelector: 'main',
        scope: { found: true, connected: true, visible: true, owned: true, tag: 'main', role: 'main', id: 'private' },
        checks: [{ code: 'SCOPED_CSS_SENTINEL_PRESENT', passed: true, selector: 'main', observed: 1 }],
        blockingFailures: [],
        warnings: [],
        stats: { nodesScanned: 0, elapsedMs: 1, budgetHit: false },
      };
    },
  };

  const inspected = await inspectScopedV2PostApplyInPage(4, {
    frameId: 2,
    scopeSelector: 'main',
    ownerKey: 'aura-me2',
    tokenKeys: ['--aura-font-size'],
    budget: { maxNodes: 8, maxMs: 4 },
  });

  assert.equal(inspected.ok, true);
  assert.equal(inspected.source, 'postApplyInspection');
  assert.equal(receivedOptions.scopeSelector, 'main');
  assert.deepEqual(receivedOptions.tokenKeys, ['--aura-font-size']);
  assert.equal('received' in inspected, false);
  assert.equal('rawText' in inspected, false);
  assert.equal('scopeSelector' in inspected, false);
  assert.equal('id' in inspected.scope, false);
  assert.equal('selector' in inspected.checks[0], false);
  assert.deepEqual(calls[0].target, { tabId: 4, frameIds: [2] });
  assert.equal(calls[0].world, 'ISOLATED');
});

test('post-apply baseline uses isolated runtime and strips unsafe fields', async () => {
  const calls = [];
  global.chrome = {
    scripting: {
      executeScript: async (payload) => {
        calls.push(payload);
        return [{ result: payload.func(...payload.args) }];
      },
    },
  };
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    collectInspectionBaseline: () => ({
      ok: true,
      baseline: {
        horizontalOverflow: 12,
        selector: 'main',
        visualSnapshot: {
          backgroundColor: 'rgb(9, 12, 20)',
          surfaceColor: 'rgb(15, 23, 42)',
          textColor: 'rgb(226, 232, 240)',
          linkColor: 'rgb(147, 197, 253)',
          mutedTextColor: 'rgb(148, 163, 184)',
          prefersColorScheme: 'dark',
          rawText: 'leak',
          selector: 'body',
        },
      },
      rawText: 'leak',
      stats: { elapsedMs: 1, budgetHit: false },
    }),
  };

  const result = await collectScopedV2InspectionBaselineInPage(4, {
    frameId: 2,
    scopeSelector: 'main',
    ownerKey: 'aura-me2',
  });

  assert.deepEqual(result, {
    ok: true,
    source: 'postApplyBaseline',
    baseline: {
      horizontalOverflow: 12,
      visualSnapshot: {
        backgroundColor: 'rgb(9, 12, 20)',
        surfaceColor: 'rgb(15, 23, 42)',
        textColor: 'rgb(226, 232, 240)',
        linkColor: 'rgb(147, 197, 253)',
        mutedTextColor: 'rgb(148, 163, 184)',
        prefersColorScheme: 'dark',
      },
    },
    stats: { elapsedMs: 1, budgetHit: false },
  });
  assert.equal('rawText' in result.baseline.visualSnapshot, false);
  assert.equal('selector' in result.baseline.visualSnapshot, false);
  assert.deepEqual(calls[0].target, { tabId: 4, frameIds: [2] });
  assert.equal(calls[0].world, 'ISOLATED');
});

test('post-apply inspection maps missing runtime and no receiver as failed DTOs', async () => {
  global.chrome = {
    scripting: {
      executeScript: async (payload) => [{ result: payload.func(...payload.args) }],
    },
  };

  const missingRuntime = await inspectScopedV2PostApplyInPage(4, { frameId: 2 });
  assert.equal(missingRuntime.ok, false);
  assert.equal(missingRuntime.error, 'INTERNAL_ERROR');
  assert.equal(missingRuntime.source, 'postApplyInspection');

  global.chrome = {
    scripting: {
      executeScript: async () => {
        throw new Error('Receiving end does not exist');
      },
    },
  };

  const noReceiver = await inspectScopedV2PostApplyInPage(4, { frameId: 2 });
  assert.deepEqual(noReceiver, {
    ok: false,
    error: 'NO_RECEIVER',
    detail: 'Receiving end does not exist',
    source: 'postApplyInspection',
  });
});

test('ensureScopeRootMarked tries selector and fallback selectors with de-dupe', async () => {
  const selectors = [];
  const optionsSeen = [];
  contentBridge.safeSend = async (tabId, message, options) => {
    selectors.push(message.selector);
    optionsSeen.push({ tabId, options });
    return { ok: true, data: { ok: false, reason: 'ELEMENT_NOT_FOUND' } };
  };

  const result = await ensureScopeRootMarked(12, 'main', { frameId: 3 });

  assert.deepEqual(selectors, ['main', 'article', '[role="main"]', '#main', '#content']);
  assert.equal(optionsSeen.every((entry) => entry.tabId === 12), true);
  assert.equal(optionsSeen.every((entry) => entry.options?.frameId === 3), true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCOPE_ROOT_UNRESOLVED');
  assert.equal(result.detail, 'ELEMENT_NOT_FOUND');
});

test('ensureScopeRootMarked stops on NO_RECEIVER', async () => {
  const selectors = [];
  contentBridge.safeSend = async (_tabId, message) => {
    selectors.push(message.selector);
    return { ok: false, lastErrorMessage: 'Receiving end does not exist' };
  };

  const result = await ensureScopeRootMarked(12, 'main');

  assert.deepEqual(selectors, ['main']);
  assert.deepEqual(result, {
    ok: false,
    error: 'NO_RECEIVER',
    detail: 'Receiving end does not exist',
  });
});

test('pickBestFrame ignores invalid candidates and enforces the text threshold', () => {
  const best = pickBestFrame([
    { frameId: 0, href: 'https://example.com/top', textLen: 4000, hasMain: false, isTop: true },
    { frameId: 1, href: 'about:blank', textLen: 100000, hasMain: true, isBlank: true },
    { frameId: 2, href: 'https://example.com/frame', textLen: 2000, hasMain: true, isTop: false },
    { frameId: 3, href: 'chrome://settings', textLen: 50000, hasMain: true, isTop: false },
  ]);

  assert.deepEqual(best, { frameId: 2 });
  assert.equal(pickBestFrame([{ frameId: 4, href: 'https://example.com/short', textLen: 1499, hasMain: true }]), null);
});

test('frame fallback and non-trivial scope predicates preserve current rules', () => {
  assert.equal(shouldAttemptFrameFallback({ ok: false, reason: 'NO_SCOPE' }, 'system', 0), true);
  assert.equal(shouldAttemptFrameFallback({ ok: false, error: 'NO_RECEIVER' }, 'system', 0), true);
  assert.equal(shouldAttemptFrameFallback({ ok: false, reason: 'SCOPE_ROOT_UNRESOLVED' }, 'system', 0), true);
  assert.equal(shouldAttemptFrameFallback({ ok: false, reason: 'NO_SCOPE' }, 'system', 2), false);
  assert.equal(shouldAttemptFrameFallback({ ok: true }, 'system', 0), false);

  assert.equal(isNonTrivialScope('main'), true);
  assert.equal(isNonTrivialScope('html'), false);
  assert.equal(isNonTrivialScope('body'), false);
  assert.equal(isNonTrivialScope('body:main'), false);
});
