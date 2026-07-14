import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { ACTIONS } from '../../shared/constants.js';

afterEach(() => {
  delete globalThis.chrome;
});

test('resolveDocumentContext fallback targets only the top frame', async () => {
  const calls = [];
  globalThis.chrome = {
    runtime: {},
    scripting: {
      async executeScript() {
        throw new Error('executeScript unavailable');
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, url: 'https://example.test/article' };
      },
      sendMessage(tabId, message, options, callback) {
        calls.push({ tabId, message, options });
        callback({
          ok: true,
          documentInstanceId: 'document-top-frame',
          url: 'https://example.test/article',
        });
      },
    },
  };

  const { resolveDocumentContext } = await import(
    `../../background/lifecycle-controller.js?top-frame=${Date.now()}`
  );
  const result = await resolveDocumentContext(42);

  assert.deepEqual(calls, [{
    tabId: 42,
    message: { action: ACTIONS.GET_DOCUMENT_CONTEXT_V1 },
    options: { frameId: 0 },
  }]);
  assert.equal(result.status, 'verified');
  assert.equal(result.documentInstanceId, 'document-top-frame');
});
