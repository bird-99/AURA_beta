import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { contentBridge } from '../../background/content-bridge.js';
import {
  deleteCachedScopeEntry,
  getCachedScopeEntry,
  makeScopeCacheKey,
  setCachedScopeEntry,
} from '../../background/scope-cache.js';
import {
  rememberResolvedScopedV2Scope,
  resolveScopedV2Scope,
} from '../../background/scoped-v2-scope-resolver.js';
import { ACTIONS, MODE_IDS, SMARTSCOPE_ACTIONS } from '../../shared/constants.js';

const touchedCacheKeys = new Set();

function trackCacheKey(tabId, modeId) {
  const key = makeScopeCacheKey(tabId, modeId);
  touchedCacheKeys.add(key);
  return key;
}

function installChromeScriptQueue(results = []) {
  const calls = [];
  global.chrome = {
    scripting: {
      executeScript: async (payload) => {
        calls.push(payload);
        return [{ result: results.shift() ?? { ok: true } }];
      },
    },
  };
  return calls;
}

function patchContentBridge({ ensureReceiverResult = { ok: true }, safeSendImpl } = {}) {
  const originalEnsureReceiver = contentBridge.ensureReceiver;
  const originalSafeSend = contentBridge.safeSend;
  const messages = [];

  contentBridge.ensureReceiver = async (tabId, options) => {
    messages.push({ type: 'ensureReceiver', tabId, options });
    return ensureReceiverResult;
  };
  contentBridge.safeSend = async (tabId, message, options = {}) => {
    messages.push({ type: 'safeSend', tabId, message, options });
    if (typeof safeSendImpl === 'function') {
      return safeSendImpl(tabId, message, options);
    }
    return { ok: true, data: { ok: true } };
  };

  return {
    messages,
    restore: () => {
      contentBridge.ensureReceiver = originalEnsureReceiver;
      contentBridge.safeSend = originalSafeSend;
    },
  };
}

afterEach(() => {
  for (const key of touchedCacheKeys) {
    deleteCachedScopeEntry(key);
  }
  touchedCacheKeys.clear();
  delete global.chrome;
});

test('scoped-v2 scope resolver module does not import css-applier', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'background', 'scoped-v2-scope-resolver.js'), 'utf8');

  assert.equal(source.includes('css-applier'), false);
});

test('resolveScopedV2Scope reuses a fresh verified cached scope and skips profile', async () => {
  installChromeScriptQueue([{ ok: true, detail: 'cached-ok' }]);
  const bridge = patchContentBridge({
    safeSendImpl: async (_tabId, message) => {
      if (message.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT) {
        return { ok: true, data: { ok: true } };
      }
      return { ok: true, data: { profile: { ok: true, scopeSelector: 'article' } } };
    },
  });
  const cacheKey = trackCacheKey(12, MODE_IDS.FOCUS);
  setCachedScopeEntry(cacheKey, {
    scopeSelector: 'main.reader',
    frameId: 4,
    urlKey: 'https://example.com/read',
    savedAtMs: Date.now(),
  });

  try {
    const result = await resolveScopedV2Scope({
      tabId: 12,
      modeId: MODE_IDS.FOCUS,
      frameId: 0,
      source: 'system',
      applyUrlKey: 'https://example.com/read',
      smartScopeConfig: {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.scopeSelector, 'main.reader');
    assert.equal(result.frameId, 4);
    assert.equal(result.profileResponse.profile.reason, 'cache');
    assert.equal(
      bridge.messages.some((entry) => entry.message?.action === SMARTSCOPE_ACTIONS.GET_PROFILE),
      false,
    );
    const markMessage = bridge.messages.find((entry) => entry.message?.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT);
    assert.equal(markMessage.options.frameId, 4);
    assert.equal(markMessage.message.selector, 'main.reader');
  } finally {
    bridge.restore();
  }
});

test('resolveScopedV2Scope returns NO_SCOPE for non-trivial profile failure and records metric/status', async () => {
  installChromeScriptQueue();
  const metrics = [];
  const statuses = [];
  const bridge = patchContentBridge({
    safeSendImpl: async (_tabId, message) => {
      if (message.action === SMARTSCOPE_ACTIONS.GET_PROFILE) {
        return { ok: true, data: { profile: { ok: false, reason: 'NONE', detail: 'LOW_SCORE' } } };
      }
      return { ok: true, data: { ok: true } };
    },
  });

  try {
    const result = await resolveScopedV2Scope({
      tabId: 13,
      modeId: MODE_IDS.FOCUS,
      frameId: 0,
      source: 'system',
      applyUrlKey: 'https://example.com/no-scope',
      smartScopeConfig: {},
      recordV2Metric: (...args) => metrics.push(args),
      recordSmartScopeStatus: async (...args) => statuses.push(args),
    });

    assert.deepEqual(result, { ok: false, reason: 'NO_SCOPE', detail: 'NONE,LOW_SCORE' });
    assert.deepEqual(metrics[0], ['apply.no_scope', 1, { modeId: MODE_IDS.FOCUS }]);
    assert.equal(statuses[0][0], 'apply');
    assert.equal(statuses[0][1].reason, 'NO_SCOPE');
    assert.equal(statuses[0][1].detail, 'NONE,LOW_SCORE');
  } finally {
    bridge.restore();
  }
});

test('resolveScopedV2Scope salvages salvageable verification failures before marking scope root', async () => {
  installChromeScriptQueue([
    { ok: false, reason: 'ROOT_TOO_LARGE', detail: 'large-root' },
    { ok: true, selector: 'main.article', tried: true },
    { ok: true, detail: 'verified' },
  ]);
  const bridge = patchContentBridge({
    safeSendImpl: async (_tabId, message) => {
      if (message.action === SMARTSCOPE_ACTIONS.GET_PROFILE) {
        return { ok: true, data: { profile: { ok: true, scopeSelector: '#oversized', frameId: 2 } } };
      }
      if (message.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT) {
        return { ok: true, data: { ok: true } };
      }
      return { ok: true, data: { ok: true } };
    },
  });

  try {
    const result = await resolveScopedV2Scope({
      tabId: 14,
      modeId: MODE_IDS.COMFORT_VISUAL,
      frameId: 0,
      source: 'system',
      applyUrlKey: 'https://example.com/salvage',
      smartScopeConfig: {},
      debugEnabled: true,
      attemptId: 9,
    });

    assert.equal(result.ok, true);
    assert.equal(result.scopeSelector, 'main.article');
    assert.equal(result.frameId, 2);
    assert.equal(result.verification.ok, true);
    const markMessage = bridge.messages.find((entry) => entry.message?.action === ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT);
    assert.equal(markMessage.message.selector, 'main.article');
    assert.equal(markMessage.options.frameId, 2);
  } finally {
    bridge.restore();
  }
});

test('resolveScopedV2Scope preserves NO_RECEIVER errors from receiver setup', async () => {
  installChromeScriptQueue();
  const statuses = [];
  const bridge = patchContentBridge({
    ensureReceiverResult: { ok: false, lastErrorMessage: 'Receiving end does not exist.' },
  });

  try {
    const result = await resolveScopedV2Scope({
      tabId: 15,
      modeId: MODE_IDS.FOCUS,
      frameId: 0,
      source: 'system',
      applyUrlKey: 'https://example.com/no-receiver',
      smartScopeConfig: {},
      recordSmartScopeStatus: async (...args) => statuses.push(args),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'NO_RECEIVER');
    assert.match(result.detail, /Receiving end does not exist/);
    assert.equal(statuses[0][1].error, 'NO_RECEIVER');
  } finally {
    bridge.restore();
  }
});

test('rememberResolvedScopedV2Scope writes only non-trivial url-keyed scopes', () => {
  const cacheKey = trackCacheKey(16, MODE_IDS.FOCUS);

  rememberResolvedScopedV2Scope({
    tabId: 16,
    modeId: MODE_IDS.FOCUS,
    applyUrlKey: '',
    scopeSelector: 'main',
    frameId: 1,
  });
  assert.equal(getCachedScopeEntry(cacheKey), null);

  rememberResolvedScopedV2Scope({
    tabId: 16,
    modeId: MODE_IDS.FOCUS,
    applyUrlKey: 'https://example.com/article',
    scopeSelector: 'body',
    frameId: 1,
  });
  assert.equal(getCachedScopeEntry(cacheKey), null);

  rememberResolvedScopedV2Scope({
    tabId: 16,
    modeId: MODE_IDS.FOCUS,
    applyUrlKey: 'https://example.com/article',
    scopeSelector: 'main',
    frameId: 1,
  });
  const cached = getCachedScopeEntry(cacheKey);
  assert.equal(cached.scopeSelector, 'main');
  assert.equal(cached.frameId, 1);
  assert.equal(cached.urlKey, 'https://example.com/article');
});
