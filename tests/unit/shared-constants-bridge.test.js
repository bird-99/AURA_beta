import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SHARED_CONSTANTS_REQUEST_TYPE,
  handleSharedConstantsRequest,
} from '../../background/shared-constants-bridge.js';
import {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_IDS,
} from '../../shared/constants.js';

test('shared constants bridge responds with constants payload', () => {
  let response;
  const handled = handleSharedConstantsRequest(
    { type: SHARED_CONSTANTS_REQUEST_TYPE },
    (payload) => {
      response = payload;
    },
  );

  assert.equal(handled, true);
  assert.equal(response.ok, true);
  assert.deepEqual(response.constants.ACTIONS, ACTIONS);
  assert.deepEqual(response.constants.CONTENT_MESSAGE_ROUTES_V1, CONTENT_MESSAGE_ROUTES_V1);
  assert.deepEqual(response.constants.CONTENT_ROUTE_OWNERSHIP, CONTENT_ROUTE_OWNERSHIP);
  assert.deepEqual(response.constants.DECISIONS, DECISIONS);
  assert.deepEqual(response.constants.MODE_IDS, MODE_IDS);
});

test('shared constants bridge ignores unknown messages', () => {
  let called = false;
  const handled = handleSharedConstantsRequest({ type: 'UNKNOWN' }, () => {
    called = true;
  });

  assert.equal(handled, false);
  assert.equal(called, false);
});

test('shared constants bridge reports errors if response fails', () => {
  let calls = 0;
  let response;
  const handled = handleSharedConstantsRequest(
    { type: SHARED_CONSTANTS_REQUEST_TYPE },
    (payload) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('boom');
      }
      response = payload;
    },
  );

  assert.equal(handled, true);
  assert.equal(response.ok, false);
  assert.equal(response.reason, 'SW_ERROR');
});
