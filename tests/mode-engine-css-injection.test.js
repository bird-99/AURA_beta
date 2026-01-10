import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import { insertModeCssSafely } from '../background/mode-engine-css.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';
import { guardCss } from '../shared/mode-engine-css-guard.js';

function setupChromeMock(insertImpl = async () => {}) {
  const insertCSS = mock.fn(insertImpl);
  globalThis.chrome = {
    scripting: { insertCSS },
  };
  return insertCSS;
}

async function withConsoleSpies(run) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const calls = {
    log: [],
    warn: [],
    error: [],
    debug: [],
  };

  console.log = (...args) => calls.log.push(args);
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);
  console.debug = (...args) => calls.debug.push(args);

  try {
    await run(calls);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  }
}

afterEach(() => {
  mock.restoreAll();
  __resetFeatureFlagCacheForTests();
  delete globalThis.chrome;
});

test('guardrails reject prevents insertCSS', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: true });

  const result = await insertModeCssSafely({ tabId: 1, cssText: '@keyframes spin {}' });

  assert.equal(result.ok, false);
  assert.equal(result.injected, false);
  assert.equal(insertCssMock.mock.callCount(), 0);
});

test('guardrails accept injects rewritten css', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: true });

  const expected = guardCss({ cssText: 'p { color: blue; }' }).cssText;

  const result = await insertModeCssSafely({ tabId: 2, cssText: 'p { color: blue; }', modeId: 'focus' });

  assert.equal(insertCssMock.mock.callCount(), 1);
  const [call] = insertCssMock.mock.calls[0].arguments;
  assert.equal(call.css, expected);
  assert.equal(result.injected, true);
});

test('guardrails off injects raw css', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: false });

  const cssText = 'body { color: red; }';

  const result = await insertModeCssSafely({ tabId: 3, cssText });

  assert.equal(insertCssMock.mock.callCount(), 1);
  const [call] = insertCssMock.mock.calls[0].arguments;
  assert.equal(call.css, cssText);
  assert.equal(result.ok, true);
  assert.equal(result.injected, true);
});

test('injection errors return ok=false without throwing', async () => {
  const insertCssMock = setupChromeMock(async () => {
    throw new Error('boom');
  });
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: false });

  const result = await insertModeCssSafely({ tabId: 4, cssText: 'p { color: green; }' });

  assert.equal(insertCssMock.mock.callCount(), 1);
  assert.equal(result.ok, false);
  assert.equal(result.injected, false);
});

test('empty cssText is rejected safely', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: true });

  const result = await insertModeCssSafely({ tabId: 5, cssText: '   ' });

  assert.equal(insertCssMock.mock.callCount(), 0);
  assert.equal(result.ok, false);
  assert.equal(result.injected, false);
});

test('instrumentation is gated off when debug flag is disabled', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: true, debugModeEngine: false });

  await withConsoleSpies(async (calls) => {
    const result = await insertModeCssSafely({ tabId: 6, cssText: '@keyframes spin {}' });

    assert.equal(result.ok, false);
    assert.equal(insertCssMock.mock.callCount(), 0);
    assert.equal(calls.log.length, 0);
    assert.equal(calls.debug.length, 0);
    assert.equal(calls.warn.length, 0);
    assert.equal(calls.error.length, 0);
  });
});

test('instrumentation emits capped reasons and metrics when debug flag is enabled', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: true, debugModeEngine: true });

  await withConsoleSpies(async (calls) => {
    const cssText = `
      @keyframes spin {}
      p {
        position: absolute;
        width: 10px;
        height: 10px;
        display: block;
        color: red !important;
        margin-top: -10px;
        animation-name: spin;
      }
    `;

    const result = await insertModeCssSafely({ tabId: 7, cssText, origin: 'TEST', modeId: 'focus' });

    assert.equal(result.ok, false);
    assert.equal(insertCssMock.mock.callCount(), 0);
    assert.equal(calls.log.length, 1);
    const logPayload = calls.log[0][2];
    assert.ok(logPayload);
    assert.ok(logPayload.reasons.length <= 5);
    assert.equal(logPayload.totalReasons, result.reasons.length);
    assert.equal(calls.debug.length >= 1, true);
  });
});

test('scoped v2 sentinel is injected when debug flag is enabled', async () => {
  const insertCssMock = setupChromeMock();
  __applyFlagOverridesForTests({ modeEngineCssGuardrails: false, debugModeEngine: true });

  const result = await insertModeCssSafely({
    tabId: 8,
    cssText: 'p { color: navy; }',
    modeEnginePath: 'scoped-v2',
  });

  assert.equal(insertCssMock.mock.callCount(), 1);
  const [call] = insertCssMock.mock.calls[0].arguments;
  const sentinel = ':where([data-aura-scope="1"]) { --aura-me2-path: scoped-v2; --aura-me2-css: "applied"; }';
  assert.equal(call.css.startsWith(sentinel), true);
  assert.equal(result.cssText.startsWith(sentinel), true);
});
