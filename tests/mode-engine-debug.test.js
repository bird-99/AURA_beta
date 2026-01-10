import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getModeEngineDebugPrefix,
  log,
  modeEngineDebug,
  recordMetric,
  recordTiming,
  warn,
  error,
} from '../shared/mode-engine-debug.js';
import { __applyFlagOverridesForTests, __resetFeatureFlagCacheForTests } from '../shared/feature-flags.js';

function withConsoleSpies(run) {
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
    run(calls);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  }
}

test.afterEach(() => {
  __resetFeatureFlagCacheForTests();
});

test('modeEngine debug helpers are no-ops when debug flag is disabled', () => {
  __applyFlagOverridesForTests({ debugModeEngine: false });

  withConsoleSpies((calls) => {
    log('message');
    warn('warning');
    error('oops');
    recordMetric('metric.name', 1, { tag: 'x' });
    recordTiming('timing.name', 12, { tag: 'y' });

    assert.equal(calls.log.length, 0);
    assert.equal(calls.warn.length, 0);
    assert.equal(calls.error.length, 0);
    assert.equal(calls.debug.length, 0);
  });
});

test('modeEngine debug helpers log with prefix when debug flag is enabled', () => {
  __applyFlagOverridesForTests({ debugModeEngine: true });

  withConsoleSpies((calls) => {
    modeEngineDebug.log('hello', { ok: true });
    recordMetric('metric.name', 3, { tag: 'z' });

    assert.equal(calls.log.length, 1);
    assert.equal(calls.log[0][0], getModeEngineDebugPrefix());

    assert.equal(calls.debug.length, 1);
    assert.match(calls.debug[0][0], /metric\.name/);
    assert.deepEqual(calls.debug[0][1], { value: 3, tags: { tag: 'z' } });
  });
});
