import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('popup exposes expandable feature panels for each public mode', () => {
  const html = read('popup/popup.html');

  assert.match(html, /id="comfort-dark-theme-slot"/);
  assert.match(html, /id="comfort-features-toggle"/);
  assert.match(html, /aria-controls="comfort-features-panel"/);
  assert.match(html, /id="comfort-features-panel"/);
  assert.match(html, /id="focus-features-toggle"/);
  assert.match(html, /aria-controls="focus-features-panel"/);
  assert.match(html, /id="focus-features-panel"/);
  assert.match(html, /<span class="feature-toggle-label">Options<\/span>/);
  assert.match(html, /<span class="caret" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(html, /id="comfort-features-toggle"[\s\S]*?<span aria-hidden="true">/);
  assert.doesNotMatch(html, /id="focus-features-toggle"[\s\S]*?<span aria-hidden="true">/);
});

test('popup feature controls use shared feature model and persist only supported prefs', () => {
  const js = read('popup/popup.js');

  assert.match(js, /buildModeFeatureUiModelV1/);
  assert.match(js, /MODE_FEATURE_PREF_KEYS/);
  assert.doesNotMatch(js, /MODE_PRIMARY_FEATURES/);
  assert.match(js, /TEXT_SCALE\]: 'textScale'/);
  assert.match(js, /DARK_COMFORT_THEME\]: 'darkMode'/);
  assert.match(js, /DISTRACTION_DIM\]: 'distractionDim'/);
  assert.match(js, /READING_RULER\]: 'readingRuler'/);
  assert.match(js, /TARGET_BOOST\]: 'targetBoost'/);
  assert.match(js, /feature\.controlPolicy === 'always_on'/);
  assert.match(js, /feature\.safetyInvariant === true/);
  assert.doesNotMatch(js, /Always on/);
  assert.doesNotMatch(js, /Session only/);
  assert.match(js, /MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES/);
  assert.match(js, /shouldAutoEnableModeForFeature/);
  assert.match(js, /FEATURE_IDS\.DARK_COMFORT_THEME/);
  assert.match(js, /handleEnable\(modeId\)/);
  assert.match(js, /\[MODE_IDS\.COMFORT_VISUAL\]: merged/);
  assert.match(js, /comfortVisual: merged/);
  assert.doesNotMatch(js, /\/dark\/i/);
});

test('popup exposes Dark Comfort Theme directly inside the Comfort card', () => {
  const html = read('popup/popup.html');
  const js = read('popup/popup.js');
  const css = read('popup/popup.css');

  assert.match(html, /id="comfort-dark-theme-slot"[\s\S]*?class="mode-quick-feature is-hidden"/);
  assert.match(html, /id="comfort-features-panel"/);
  assert.doesNotMatch(html, /id="comfort-primary-features"/);
  assert.doesNotMatch(js, /slotId: 'comfort-primary-features'/);
  assert.match(js, /MODE_FEATURE_QUICK_SLOTS/);
  assert.match(js, /slotId: 'comfort-dark-theme-slot'/);
  assert.match(js, /isPopupQuickFeature\(modeId, item\)/);
  assert.match(js, /MODE_FEATURE_CONTROL_IDS/);
  assert.match(js, /comfort-dark-theme-option/);
  assert.match(js, /comfort-dark-theme-toggle/);
  assert.doesNotMatch(js, /renderModePrimaryFeatureSlots\(\)/);
  assert.doesNotMatch(js, /isPrimaryPopupFeature\(modeId, feature\.featureId\)/);
  assert.match(js, /update feature preference/);
  assert.match(js, /requestModeRefreshAfterFeatureUpdate\(modeId, prefKey, enabled, options\)/);
  assert.match(css, /\.feature-row-quick \.feature-checkbox:checked/);
  assert.match(css, /\.feature-row-quick \.feature-checkbox::before/);
});

test('popup feature controls avoid non-actionable badges and section clutter', () => {
  const css = read('popup/popup.css');

  assert.doesNotMatch(css, /feature-badge/);
  assert.doesNotMatch(css, /feature-section h4/);
  assert.match(css, /\.caret/);
  assert.match(css, /\.feature-toggle-label/);
  assert.doesNotMatch(css, /\.mode-primary-feature/);
  assert.doesNotMatch(css, /\.feature-row-primary/);
});

test('popup mode card body delegates to the primary mode toggle', () => {
  const js = read('popup/popup.js');

  assert.match(js, /querySelectorAll\('\.mode-card-main'\)/);
  assert.match(js, /closest\?\.\('button, input, a, label, select, textarea'\)/);
  assert.match(js, /querySelector\('\.btn-toggle'\)/);
  assert.match(js, /button\.click\(\)/);
});

test('service worker rehydrates active modes when popup-updated Focus prefs change', () => {
  const serviceWorker = read('background/service-worker.js');

  assert.match(serviceWorker, /const prevComfortVisual = prevModePrefs\[MODE_IDS\.COMFORT_VISUAL\] \|\| prevModePrefs\.comfortVisual/);
  assert.match(serviceWorker, /const nextComfortVisual = nextModePrefs\[MODE_IDS\.COMFORT_VISUAL\] \|\| nextModePrefs\.comfortVisual/);
  assert.match(serviceWorker, /const prevFocus = prevModePrefs\[MODE_IDS\.FOCUS\]/);
  assert.match(serviceWorker, /const focusChanged = JSON\.stringify\(prevFocus\) !== JSON\.stringify\(nextFocus\)/);
  assert.match(serviceWorker, /rehydrateActiveModesForActiveTabs\('prefs:focus'\)/);
});
