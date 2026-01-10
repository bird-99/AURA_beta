import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

function buildChromeStub() {
  const localStore = {
    userPrefs: {
      smartScope: {
        enabled: true,
        level: 'conservative',
      },
    },
    perDomainPrefs: {},
  };

  const sessionStore = {};

  return {
    storage: {
      local: {
        async get(key) {
          return { [key]: localStore[key] };
        },
        async set(entries) {
          Object.assign(localStore, entries);
        },
      },
      session: {
        async get(key) {
          return { [key]: sessionStore[key] };
        },
        async set(entries) {
          Object.assign(sessionStore, entries);
        },
        async remove(key) {
          delete sessionStore[key];
        },
      },
    },
    tabs: {
      async get() {
        return { url: 'https://example.com/article' };
      },
      sendMessage(_tabId, payload, options, callback) {
        const actualCallback = typeof options === 'function' ? options : callback;
        let response = { ok: true };
        switch (payload.action) {
          case 'TEST_PING_CONTENT':
            response = { ok: true };
            break;
          case 'SMARTSCOPE_GET_PROFILE_V1':
            response = {
              ok: true,
              profile: {
                scopeSelector: 'main',
                reason: 'semantic',
                score: 0.9,
                processingTimeMs: 10,
              },
            };
            break;
          case 'MODE_ENGINE_V2_SET_SCOPE_ROOT':
            response = { ok: true };
            break;
          case 'MODE_ENGINE_V2_APPLY_SCOPE_TOKENS':
            response = {
              ok: true,
              applied: Object.keys(payload.tokenMap || {}).length,
              ownedKeys: Object.keys(payload.tokenMap || {}),
            };
            break;
          case 'MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS':
            response = { ok: true, removed: 1, scopeUnmarked: true };
            break;
          default:
            response = { ok: true };
        }

        if (typeof actualCallback === 'function') {
          actualCallback(response);
        }

        return response;
      },
    },
    scripting: {
      async executeScript() {
        return [{ result: { ok: true } }];
      },
      async insertCSS() {
        return true;
      },
      async removeCSS() {
        return true;
      },
    },
    runtime: { lastError: null },
  };
}

class FakeRegistry {
  constructor() {
    this.map = new Map();
    this.counter = 0;
  }

  async register(cssText, origin, metadata = {}) {
    this.counter += 1;
    const entry = {
      cssId: `css-${this.counter}`,
      cssHash: `hash-${this.counter}`,
      cssText,
      origin,
      metadata,
    };
    this.map.set(entry.cssId, entry);
    return entry;
  }

  async get(id) {
    return this.map.get(id) || null;
  }

  async remove(id) {
    this.map.delete(id);
  }
}

class FakeStateManager {
  constructor(defaults) {
    this.state = new Map();
    this.defaults = defaults;
    this.status = new Map();
  }

  async getModeState(tabId, modeId) {
    return this.state.get(`${tabId}-${modeId}`) || { ...this.defaults };
  }

  async updateModeState(tabId, modeId, state, metadata = {}) {
    const previous = await this.getModeState(tabId, modeId);
    const merged = {
      ...previous,
      ...metadata,
      state,
    };
    this.state.set(`${tabId}-${modeId}`, merged);
    return merged;
  }

  async setSmartScopeStatus(tabId, modeId, status) {
    this.status.set(`${tabId}-${modeId}`, status);
  }

  async getSmartScopeStatus(tabId, modeId) {
    return this.status.get(`${tabId}-${modeId}`) || null;
  }
}

const performanceMonitor = {
  degradedTriggered: false,
  async measureLatency(operation) {
    return operation();
  },
  async measureHeapDelta(operation) {
    return operation();
  },
};

afterEach(() => {
  delete global.chrome;
});

test('SmartScope application persists non-null state when enabled', async () => {
  global.chrome = buildChromeStub();
  const [{ CssApplier }, constants] = await Promise.all([
    import('../background/css-applier.js'),
    import('../shared/constants.js'),
  ]);

  const registry = new FakeRegistry();
  const defaults = {
    state: constants.STATES.INACTIVE,
    cssId: null,
    cssHash: null,
    pendingDecision: false,
    lastScore: 0,
    smartScope: null,
  };
  const manager = new FakeStateManager(defaults);
  const applier = new CssApplier(registry, manager, performanceMonitor);

  const result = await applier.applyMode(1, constants.MODE_IDS.COMFORT_VISUAL);
  const stored = await manager.getModeState(1, constants.MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.ok, true);
  assert.equal(stored.state, constants.STATES.ACTIVE);
  assert.equal(stored.smartScope, null);
  assert.ok(stored.scopedV2, 'scopedV2 should be set when enabled');
  assert.ok(stored.scopedV2.scopeSelector, 'scopeSelector should be recorded');
});
