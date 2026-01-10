import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleGetFeatureFlagsRequest } from '../../background/feature-flags-bridge.js';

test('feature flags bridge returns flags from shared module', async () => {
  const flags = { smartScopeV2: true, debugTestHooks: true };
  const result = await handleGetFeatureFlagsRequest({
    init: async () => {},
    getAll: () => flags,
  });

  assert.deepEqual(result, { ok: true, flags });
});

test('feature flags bridge reports errors when initialization fails', async () => {
  const result = await handleGetFeatureFlagsRequest({
    init: async () => {
      throw new Error('boom');
    },
    getAll: () => ({ debugTestHooks: false }),
  });

  assert.deepEqual(result, { ok: false, reason: 'SW_ERROR' });
});
