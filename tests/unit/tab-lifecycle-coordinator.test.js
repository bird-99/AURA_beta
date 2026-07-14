import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  clearTabLifecycleForTests,
  runGlobalLifecycleOperation,
  runTabLifecycleOperation,
} from '../../background/tab-lifecycle-coordinator.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => clearTabLifecycleForTests());

test('serializes complete lifecycle transactions across modes on one tab', async () => {
  const gate = deferred();
  const calls = [];
  const first = runTabLifecycleOperation(7, 'comfort-enable', async () => {
    calls.push('comfort:start');
    await gate.promise;
    calls.push('comfort:end');
  });
  const second = runTabLifecycleOperation(7, 'focus-enable', async () => {
    calls.push('focus');
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['comfort:start']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['comfort:start', 'comfort:end', 'focus']);
});

test('preserves submission order for apply followed by restore', async () => {
  const calls = [];
  await Promise.all([
    runTabLifecycleOperation(9, 'apply', async () => calls.push('apply')),
    runTabLifecycleOperation(9, 'restore', async () => calls.push('restore')),
  ]);
  assert.deepEqual(calls, ['apply', 'restore']);
});

test('keeps different tabs independent', async () => {
  const gate = deferred();
  const calls = [];
  const firstTab = runTabLifecycleOperation(1, 'slow', async () => {
    calls.push('tab1:start');
    await gate.promise;
    calls.push('tab1:end');
  });
  const secondTab = runTabLifecycleOperation(2, 'fast', async () => calls.push('tab2'));
  await secondTab;
  assert.deepEqual(calls, ['tab1:start', 'tab2']);
  gate.resolve();
  await firstTab;
});

test('global lifecycle operation waits for prior tab work and blocks new tab work', async () => {
  const releaseExisting = deferred();
  const releaseGlobal = deferred();
  const calls = [];
  const existing = runTabLifecycleOperation(1, 'existing', async () => {
    calls.push('existing:start');
    await releaseExisting.promise;
    calls.push('existing:end');
  });
  const global = runGlobalLifecycleOperation('reset-all', async () => {
    calls.push('global:start');
    await releaseGlobal.promise;
    calls.push('global:end');
  });
  const later = runTabLifecycleOperation(2, 'later', async () => calls.push('later'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['existing:start']);
  releaseExisting.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['existing:start', 'existing:end', 'global:start']);
  releaseGlobal.resolve();
  await Promise.all([existing, global, later]);
  assert.deepEqual(calls, ['existing:start', 'existing:end', 'global:start', 'global:end', 'later']);
});

test('global lifecycle operation can run internal tab cleanup ahead of blocked later work', async () => {
  const releaseCleanup = deferred();
  const calls = [];
  const global = runGlobalLifecycleOperation('reset-all', async ({ runTabOperation }) => {
    calls.push('global:start');
    await runTabOperation(7, 'reset:focus', async () => {
      calls.push('cleanup:start');
      await releaseCleanup.promise;
      calls.push('cleanup:end');
    });
    calls.push('global:end');
  });
  const later = runTabLifecycleOperation(7, 'later-apply', async () => calls.push('later'));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['global:start', 'cleanup:start']);
  releaseCleanup.resolve();
  await Promise.all([global, later]);
  assert.deepEqual(calls, ['global:start', 'cleanup:start', 'cleanup:end', 'global:end', 'later']);
});
