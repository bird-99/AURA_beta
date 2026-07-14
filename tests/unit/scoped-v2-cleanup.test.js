import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  CssApplier,
  applyScopedModeV2,
  getScopedModeV2State,
  removeScopedModeV2 as removeFromCssApplier,
} from '../../background/css-applier.js';
import { removeScopedModeV2 as removeFromCleanup } from '../../background/scoped-v2-cleanup.js';
import { deleteScopedModeV2State } from '../../background/scoped-v2-state.js';
import { MODE_IDS, STATES } from '../../shared/constants.js';

afterEach(() => {
  delete global.chrome;
  deleteScopedModeV2State(701, 0);
  deleteScopedModeV2State(702, 0);
});

test('scoped-v2 cleanup module does not import css-applier', async () => {
  const source = await readFile(join(process.cwd(), 'background/scoped-v2-cleanup.js'), 'utf8');

  assert.equal(source.includes('./css-applier.js'), false);
  assert.equal(source.includes('css-applier'), false);
});

test('css-applier facade re-exports scoped-v2 cleanup remove function', () => {
  assert.equal(removeFromCssApplier, removeFromCleanup);
});

test('scoped-v2 cleanup preserves registry and memory state when registered CSS removal fails', async () => {
  const calls = { removeCss: [], registryRemove: [] };
  global.chrome = {
    scripting: {
      async removeCSS(payload) {
        calls.removeCss.push(payload);
        throw new Error('remove failed');
      },
    },
  };
  const registry = {
    async get(cssId) {
      assert.equal(cssId, 'css-scoped');
      return { cssText: '[data-aura-scope="1"] { color: red; }', origin: 'AUTHOR' };
    },
    async remove(cssId) {
      calls.registryRemove.push(cssId);
    },
  };
  applyScopedModeV2({
    tabId: 701,
    frameId: 0,
    cssId: 'css-scoped',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
  });

  const result = await removeFromCleanup({
    tabId: 701,
    frameId: 0,
    cssId: 'css-scoped',
    registry,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(result.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(result.retryable, true);
  assert.equal(result.details.registryRemoved, false);
  assert.equal(calls.removeCss.length, 1);
  assert.deepEqual(calls.registryRemove, []);
  assert.equal(getScopedModeV2State(701, 0)?.cssId, 'css-scoped');
});

test('css-applier scoped-v2 restore marks ERROR but keeps handles when registered CSS removal fails', async () => {
  const calls = { removeCss: [], registryRemove: [], updates: [], statuses: [] };
  global.chrome = {
    scripting: {
      async removeCSS(payload) {
        calls.removeCss.push(payload);
        throw new Error('remove failed');
      },
    },
    storage: {
      session: {
        async get() {
          return {};
        },
        async set() {},
      },
    },
  };
  const registry = {
    async get(cssId) {
      assert.equal(cssId, 'css-scoped');
      return { cssText: '[data-aura-scope="1"] { color: red; }', origin: 'AUTHOR' };
    },
    async remove(cssId) {
      calls.registryRemove.push(cssId);
    },
  };
  const stateManager = {
    async getModeState() {
      return {
        state: STATES.ACTIVE,
        cssId: 'css-scoped',
        scopedV2: { cssId: 'css-scoped', frameId: 0, scopeSelector: 'main' },
      };
    },
    async getModePrefs() {
      return null;
    },
    async updateModeState(tabId, modeId, state, updates) {
      calls.updates.push({ tabId, modeId, state, updates });
    },
    async setSmartScopeStatus(tabId, modeId, status) {
      calls.statuses.push({ tabId, modeId, status });
    },
  };
  applyScopedModeV2({
    tabId: 702,
    frameId: 0,
    cssId: 'css-scoped',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
  });
  const applier = new CssApplier(registry, stateManager, null);

  const result = await applier.removeModeScopedV2(702, MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(result.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(result.retryable, true);
  assert.deepEqual(calls.registryRemove, []);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].state, STATES.ERROR);
  assert.deepEqual(calls.updates[0].updates, { pendingDecision: false });
  assert.equal(calls.statuses[0].status.ok, false);
  assert.equal(calls.statuses[0].status.error, 'RESTORE_CSS_REMOVE_FAILED');
  assert.equal(getScopedModeV2State(702, 0)?.cssId, 'css-scoped');
});

test('scoped-v2 cleanup keeps the registry recipe when token cleanup fails', async () => {
  const calls = { registryRemove: [] };
  global.chrome = {
    runtime: { lastError: null },
    scripting: {
      async removeCSS() {},
    },
    tabs: {
      async get() {
        return { id: 701, url: 'https://example.com/' };
      },
      sendMessage(_tabId, _message, _options, callback) {
        const done = typeof _options === 'function' ? _options : callback;
        done({ ok: false, error: 'TOKEN_CLEANUP_FAILED', detail: 'content unavailable' });
      },
    },
  };
  const registry = {
    async get() {
      return { cssText: '[data-aura-scope="1"] { color: red; }', origin: 'AUTHOR' };
    },
    async remove(cssId) {
      calls.registryRemove.push(cssId);
    },
  };
  applyScopedModeV2({
    tabId: 701,
    frameId: 0,
    cssId: 'css-token-retry',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
  });

  const result = await removeFromCleanup({
    tabId: 701,
    frameId: 0,
    cssId: 'css-token-retry',
    requireTokenCleanup: true,
    registry,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESTORE_TOKEN_CLEANUP_FAILED');
  assert.equal(result.retryable, true);
  assert.deepEqual(calls.registryRemove, []);
  assert.equal(getScopedModeV2State(701, 0)?.cssId, 'css-token-retry');
});

test('scoped-v2 cleanup keeps memory state when registry removal fails', async () => {
  global.chrome = {
    runtime: { lastError: null },
    scripting: {
      async removeCSS() {},
    },
    tabs: {
      async get() {
        return { id: 701, url: 'https://example.com/' };
      },
      sendMessage(_tabId, _message, _options, callback) {
        const done = typeof _options === 'function' ? _options : callback;
        done({ ok: true, removed: 1, scopeUnmarked: true });
      },
    },
  };
  const registry = {
    async get() {
      return { cssText: '[data-aura-scope="1"] { color: red; }', origin: 'AUTHOR' };
    },
    async remove() {
      throw new Error('session storage unavailable');
    },
  };
  applyScopedModeV2({
    tabId: 701,
    frameId: 0,
    cssId: 'css-registry-retry',
    modeId: MODE_IDS.COMFORT_VISUAL,
    cssText: '[data-aura-scope="1"] { color: red; }',
  });

  const result = await removeFromCleanup({
    tabId: 701,
    frameId: 0,
    cssId: 'css-registry-retry',
    registry,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RESTORE_REGISTRY_REMOVE_FAILED');
  assert.equal(result.retryable, true);
  assert.equal(getScopedModeV2State(701, 0)?.cssId, 'css-registry-retry');
});

test('Focus scoped cleanup tells content runtime to disable submodes before state commit', async () => {
  const messages = [];
  global.chrome = {
    runtime: { lastError: null },
    scripting: { async removeCSS() {} },
    tabs: {
      async get() { return { id: 701, url: 'https://example.com/' }; },
      sendMessage(_tabId, message, _options, callback) {
        messages.push(message);
        const done = typeof _options === 'function' ? _options : callback;
        done({ ok: true, removed: 1, scopeUnmarked: true });
      },
    },
  };
  const registry = {
    async get() { return { cssText: '[data-aura-scope="1"] { color: red; }', origin: 'AUTHOR' }; },
    async remove() {},
  };
  applyScopedModeV2({
    tabId: 701,
    frameId: 0,
    cssId: 'css-focus-cleanup',
    modeId: MODE_IDS.FOCUS,
    cssText: '[data-aura-scope="1"] { color: red; }',
  });

  const result = await removeFromCleanup({
    tabId: 701,
    frameId: 0,
    modeId: MODE_IDS.FOCUS,
    cssId: 'css-focus-cleanup',
    registry,
  });

  assert.equal(result.ok, true);
  assert.equal(messages[0].modeId, MODE_IDS.FOCUS);
});
