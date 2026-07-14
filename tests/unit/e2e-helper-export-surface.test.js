import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as helpers from '../e2e/helpers/launch-with-extension.js';

test('e2e helper facade exposes the stable public API', () => {
  assert.deepEqual(Object.keys(helpers).sort(), [
    'activateSuggestionBannerAction',
    'clearTestSuggestionBanner',
    'createAuraServiceWorkerRestartController',
    'evaluateInExtensionPage',
    'getAuraTabId',
    'getTabModeStateFromExtensionPage',
    'injectTestSuggestionBanner',
    'launchWithExtension',
    'resolveAuraTabForTest',
    'sendMessageToTab',
    'showSuggestionBanner',
    'sendRuntimeMessageFromExtensionPage',
    'setFeatureFlagsForTest',
    'waitForAuraContentReady',
    'waitForAuraReady',
    'waitForExtensionReady',
    'waitForStableModeEngine',
  ].sort());
});
