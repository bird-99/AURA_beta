import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const runtimePath = path.join(process.cwd(), 'content', 'spa-hooks-v2.runtime.js');

function loadSpaHooksRuntime() {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    Date,
    Symbol,
    Object,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
        this.bubbles = options.bubbles;
      }
    },
  };

  sandbox.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    CustomEvent: null,
    location: { href: 'http://example.com' },
    history: {
      pushState() {},
      replaceState() {},
      state: null,
    },
  };
  sandbox.window.CustomEvent = sandbox.CustomEvent;
  sandbox.document = {};
  sandbox.history = sandbox.window.history;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'spa-hooks-v2.runtime.js' });
  return context;
}

test('spa-hooks runtime exposes expected globals', () => {
  const context = loadSpaHooksRuntime();
  const hooks = context.globalThis.AURA_SPA_HOOKS_V2;

  assert.ok(hooks, 'AURA_SPA_HOOKS_V2 should exist on globalThis');
  assert.equal(typeof hooks.createReapplyScheduler, 'function');
  assert.equal(typeof hooks.createSpaHooksV2, 'function');
});

test('spa-hooks runtime dispatches aura:spa-nav events', () => {
  const context = loadSpaHooksRuntime();
  const hooks = context.globalThis.AURA_SPA_HOOKS_V2;

  let received = null;
  context.window.dispatchEvent = (event) => {
    received = event;
    return true;
  };

  context.window.location.href = 'http://example.com/start';

  const controller = hooks.createSpaHooksV2({
    window: context.window,
    onNavigate: () => {},
  });

  controller.start();

  context.window.location.href = 'http://example.com/next';
  context.window.history.pushState({}, '', '/next');

  assert.ok(received, 'Expected aura:spa-nav event to dispatch');
  assert.equal(received.type, 'aura:spa-nav');
  assert.deepEqual(JSON.parse(JSON.stringify(received.detail)), {
    reason: 'pushState',
    kind: 'pathname',
    url: 'http://example.com/next',
  });
});
