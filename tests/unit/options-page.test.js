import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('options page uses the PR13 mode truth model and avoids forced dark copy', () => {
  const html = read('options/options.html');
  const js = read('options/options.js');

  assert.match(html, /AURA Settings/);
  assert.match(html, /href="#section-general"/);
  assert.match(html, /href="#section-modes"/);
  assert.match(html, /href="#section-suggestions"/);
  assert.match(html, /href="#section-domains"/);
  assert.match(html, /href="#section-smartscope"/);
  assert.match(html, /href="#section-learning"/);
  assert.match(html, /href="#section-data"/);
  assert.match(html, /href="#section-advanced"/);
  assert.match(html, /<h2>Modes<\/h2>/);
  assert.match(html, /Comfort Visual/);
  assert.match(html, /Focus/);
  assert.equal(/cv-reflow-guard/.test(html), false);
  assert.equal(/Reflow guard/.test(html), false);
  assert.match(html, /Auto-apply Focus on trusted pages/);
  assert.equal(/Enable Focus by default/i.test(html), false);
  assert.match(js, /buildModeFeatureUiModelV1/);
  assert.match(js, /getComfortVisualPrefsFromModePrefs/);
  assert.match(js, /withComfortVisualPrefs\(modePrefs, mergedPrefs\)/);
  assert.match(js, /\[MODE_IDS\.COMFORT_VISUAL\]: normalized/);
  assert.match(js, /comfortVisual: normalized/);
  assert.match(js, /focusInputs\.ultraFocus\.checked = false/);
  assert.match(js, /focusInputs\.ultraFocus\.disabled = true/);
  assert.equal(/ultraFocus:\s*focusInputs\.ultraFocus/.test(js), false);
  assert.match(`${html}\n${js}`, /optional dark comfort theme/);
  assert.equal(/force a dark|forced dark|Force a dark/i.test(`${html}\n${js}`), false);
});

test('options page renders safety and dependent controls from explicit policies', () => {
  const js = read('options/options.js');

  assert.match(js, /always_on/);
  assert.match(js, /FOCUS_NOT_OBSCURED/);
  assert.match(js, /COMFORT_VISUAL_SAFETY_PREF_KEYS/);
  assert.equal(/cv-reflow-guard/.test(js), false);
  assert.equal(/reflowGuard:\s*document\.getElementById/.test(js), false);
  assert.match(js, /dependsOnFeatureId/);
  assert.match(js, /DISTRACTION_DIM/);
  assert.match(js, /distractionDimBlurPx/);
});

test('UltraFocus remains advanced session-only instead of persistent prefs driven', () => {
  const constants = read('shared/constants.js');
  const contentMain = read('content/content-main.js');

  assert.equal(/ultraFocus:\s*false/.test(constants), false);
  assert.equal(/'ultraFocus'/.test(constants), false);
  assert.match(contentMain, /async function loadUltraFocusPrefs\(\)\s*{\s*return { enabled: false };\s*}/);
  assert.equal(/modePrefs\.ultraFocus === true/.test(contentMain), false);
});

test('ModeEngine diagnostics require an explicit non-persisted HTTP tab target', () => {
  const html = read('options/options.html');
  const js = read('options/options.js');
  const diagnostics = read('options/modeengine-diagnostics.js');

  assert.match(html, /id="debug-target-tab"/);
  assert.match(html, /The selection and URL are never stored or exported/);
  assert.match(js, /createModeEngineDiagnosticsController/);
  assert.match(js, /chrome\.tabs\.query\(\{ currentWindow: true \}\)/);
  assert.match(js, /action: ACTIONS\.GET_DEBUG_SNAPSHOT,\s*tabId/);
  assert.match(diagnostics, /\^https\?:\\\/\\\//i);
  assert.equal(/chrome\.storage/.test(diagnostics), false);
  assert.equal(/currentDebug(?:Snapshot|TargetTabId)/.test(js), false);
});
