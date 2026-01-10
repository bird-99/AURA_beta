import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { canOpenPopup, tryOpenPopupOrFallback } from '../../shared/utils.js';

afterEach(() => {
  delete global.chrome;
});

test('canOpenPopup returns false when chrome.action.openPopup is missing', () => {
  global.chrome = {};
  assert.equal(canOpenPopup(), false);
});

test('tryOpenPopupOrFallback uses openPopup when available', async () => {
  let openPopupCalled = false;
  let tabsCreateCalled = false;

  global.chrome = {
    action: {
      async openPopup() {
        openPopupCalled = true;
      },
    },
    tabs: {
      async create() {
        tabsCreateCalled = true;
      },
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://id/${path}`;
      },
    },
  };

  const result = await tryOpenPopupOrFallback({ fallback: 'openOptions', reason: 'openPopup_failed' });

  assert.equal(result.used, 'openPopup');
  assert.equal(openPopupCalled, true);
  assert.equal(tabsCreateCalled, false);
});

test('tryOpenPopupOrFallback falls back to options when openPopup fails', async () => {
  let createdUrl = null;

  global.chrome = {
    action: {
      async openPopup() {
        throw new Error('blocked');
      },
    },
    tabs: {
      async create({ url }) {
        createdUrl = url;
      },
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://id/${path}`;
      },
    },
  };

  const result = await tryOpenPopupOrFallback({
    fallback: 'openOptions',
    reason: 'openPopup_failed',
    modeId: 'comfort-visual',
  });

  assert.equal(result.used, 'fallback');
  assert.ok(createdUrl?.includes('options/options.html'), 'expected options page fallback');
  assert.ok(createdUrl?.includes('scrollTo=why'), 'expected why anchor param');
  assert.ok(createdUrl?.includes('modeId=comfort-visual'), 'expected modeId param');
  assert.ok(createdUrl?.includes('reason=openPopup_failed'), 'expected reason param');
});
