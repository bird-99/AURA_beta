import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getSmoothTransitionSettings } from '../../background/mode-css-builders.js';
import { MODE_ENGINE_SCOPE_SELECTOR, buildScopedModeCssV2 } from '../../shared/mode-engine-scoped-v2.js';
import { MODE_IDS } from '../../shared/constants.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('Reduce Motion global preference applies across Comfort and Focus transition settings', () => {
  const flags = {
    focusReduceMotionV1: false,
    reducedMotion: true,
    smoothThemeTransitionsV2: true,
  };

  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.COMFORT_VISUAL, {}, flags), {
    reduceMotionEnabled: true,
    smoothTransitionsEnabled: false,
    transitionMs: 160,
  });
  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.FOCUS, {}, flags), {
    reduceMotionEnabled: true,
    smoothTransitionsEnabled: false,
    transitionMs: 160,
  });
});

test('Reduce Motion scoped CSS is transversal and avoids media or loader controls', () => {
  const comfortCss = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.7,
    reduceMotion: true,
    smoothTransitions: false,
  });
  const focusCss = buildScopedModeCssV2({
    modeId: MODE_IDS.FOCUS,
    intensity: 0.7,
    reduceMotion: true,
  });

  for (const css of [comfortCss, focusCss]) {
    assert.match(css, /animation-duration: 0\.01ms/);
    assert.match(css, /transition-duration: 0\.01ms/);
    assert.match(css, /scroll-behavior: auto/);
    assert.match(css, /:not\(video\)/);
    assert.match(css, /:not\(audio\)/);
    assert.match(css, /:not\(progress\)/);
    assert.match(css, /:not\(\[role="progressbar"\]\)/);
    assert.match(css, /:not\(\[aria-busy="true"\]\)/);
    assert.match(css, /:not\(\[data-aura-allow-motion="1"\]\)/);
    assert.match(css, new RegExp(MODE_ENGINE_SCOPE_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(css, /\bdisplay\s*:\s*none/i);
    assert.doesNotMatch(css, /\bvisibility\s*:\s*hidden/i);
  }
});

test('Options navigation avoids hard-coded smooth scrolling for Reduce Motion', () => {
  const optionsSource = readRepoFile('options/options.js');

  assert.match(optionsSource, /function getOptionsScrollBehavior\(\)/);
  assert.match(optionsSource, /prefers-reduced-motion: reduce/);
  assert.match(optionsSource, /currentUserPrefs\?\.reducedMotion === true/);
  assert.match(optionsSource, /requestReapplyActiveTab\('prefs:reducedMotion'\)/);
  assert.equal(/scrollIntoView\(\{\s*behavior:\s*'smooth'/.test(optionsSource), false);
  assert.equal(/scrollIntoView\(\{\s*behavior:\s*"smooth"/.test(optionsSource), false);
});
