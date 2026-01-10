import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { applyScopedModeV2, removeScopedModeV2 } from '../../background/css-applier.js';
import { contentBridge } from '../../background/content-bridge.js';
import { cssRegistry } from '../../background/css-registry.js';
import { ACTIONS, MODE_IDS } from '../../shared/constants.js';

function createChromeScriptingSpies() {
  const calls = { remove: [] };
  global.chrome = {
    scripting: {
      removeCSS: async (payload) => {
        calls.remove.push(payload);
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete global.chrome;
});

test('removeScopedModeV2 preserves scope but still cleans up tokens afterward', async () => {
  const calls = createChromeScriptingSpies();
  const safeSendCalls = [];
  const originalSafeSend = contentBridge.safeSend;
  const originalGet = cssRegistry.get;
  const originalRemove = cssRegistry.remove;
  try {
    contentBridge.safeSend = async (tabId, message, options) => {
      safeSendCalls.push({ tabId, message, options });
      return { ok: true, data: { ok: true, removed: 1, scopeUnmarked: true } };
    };
    cssRegistry.get = async () => ({ cssText: 'body { color: red; }', origin: 'AUTHOR' });
    cssRegistry.remove = async () => {};

    applyScopedModeV2({
      tabId: 1,
      frameId: 0,
      cssId: 'test-css',
      modeId: MODE_IDS.COMFORT_VISUAL,
      cssText: 'body { color: red; }',
      tokens: { '--aura-token': '1' },
    });

    const result = await removeScopedModeV2({ tabId: 1, frameId: 0, cssId: 'test-css', preserveScope: true });

    assert.equal(result.ok, true);
    assert.equal(safeSendCalls.length, 2);
    assert.equal(safeSendCalls[0].message.action, ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(safeSendCalls[0].message.preserveScope, true);
    assert.equal(safeSendCalls[1].message.action, ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS);
    assert.equal(safeSendCalls[1].message.preserveScope, false);
    assert.equal(calls.remove.length, 1);
    assert.equal(calls.remove[0].css, 'body { color: red; }');
  } finally {
    contentBridge.safeSend = originalSafeSend;
    cssRegistry.get = originalGet;
    cssRegistry.remove = originalRemove;
  }
});
