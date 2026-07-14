import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  COMFORT_DARK_GUARD_TOKENS,
  COMFORT_DARK_RETRY_TOKENS,
  COMFORT_LIGHT_GUARD_TOKENS,
  COMFORT_LIGHT_RETRY_TOKENS,
  buildComfortCss,
  buildComfortEmergencyReflowGuardTokenOverrides,
  buildComfortPreludeCss,
  buildComfortVisualTokenOverrides,
  buildFocusCss,
  buildModeCss,
  buildSmartScopePatchCSS,
  buildScopedTransitionsCssV2,
  getSmoothTransitionSettings,
  isComfortDarkModeRequested,
  isComfortDarkModeEnabled,
  isComfortDarkRuntimeEnabled,
  normalizeIntensity,
} from '../../background/mode-css-builders.js';
import { MODE_IDS } from '../../shared/constants.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('normalizeIntensity clamps non numeric and out-of-range values', () => {
  assert.equal(normalizeIntensity(undefined), 1);
  assert.equal(normalizeIntensity(Number.NaN), 1);
  assert.equal(normalizeIntensity(-0.5), 0);
  assert.equal(normalizeIntensity(1.5), 1);
  assert.equal(normalizeIntensity(0.4), 0.4);
});

test('buildModeCss delegates comfort visual strict CSS without body overrides', () => {
  const css = buildModeCss(MODE_IDS.COMFORT_VISUAL, 'STRICT', 'body', 0.5);

  assert.match(css, /\[data-aura-scope="1"\]\s*\{/);
  assert.match(css, /--aura-intensity: 0.5/);
  assert.doesNotMatch(css, /body\s*\{[^}]*\}/i);
});

test('comfort scoped builders default to the owned scope instead of body', () => {
  const css = buildComfortCss('SCOPED', 0.7);

  assert.match(css, /\[data-aura-scope="1"\]\s*\{/);
  assert.doesNotMatch(css, /body\s*\{/i);
  assert.doesNotMatch(css, /body\s+:where/i);
});

test('buildFocusCss returns no strict fallback and keeps scoped focus non-hiding by default', () => {
  assert.equal(buildFocusCss('STRICT', 1, 'body'), '');

  const css = buildFocusCss('SCOPED', 1, '.aura-scope');

  assert.doesNotMatch(css, /\.aura-focus-hide/);
  assert.doesNotMatch(css, /display:\s*none/i);
  assert.match(css, /animation: none/);
  assert.match(css, /clamp\(64ch, 74ch, 80ch\)/);
  assert.doesNotMatch(css, /text-rendering:\s*optimizeLegibility/);
  assert.doesNotMatch(css, /-webkit-font-smoothing/);
});

test('buildSmartScopePatchCSS enables comfort dark only when requested and keeps focus dark enabled', () => {
  const comfortLight = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');
  const comfortDark = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED', {
    darkModeEnabled: true,
  });
  const focus = buildSmartScopePatchCSS(MODE_IDS.FOCUS, 1, 'SCOPED');

  assert.doesNotMatch(comfortLight, /prefers-color-scheme: dark/);
  assert.doesNotMatch(comfortLight, /\.aura-scope \{ color-scheme: dark/);
  assert.match(comfortDark, /\.aura-scope \{ color-scheme: dark !important/);
  assert.match(comfortDark, /background-color:\s*#0f1116/i);
  assert.match(comfortDark, /color:\s*#e7ecf3/i);
  assert.match(comfortDark, /-webkit-text-fill-color:\s*#e7ecf3/i);
  assert.match(comfortDark, /:where\(a, \[role="link"\]\)\s*\{[^}]*-webkit-text-fill-color:\s*#8ab4ff/i);
  assert.match(focus, /\.aura-scope \{ color-scheme: dark !important/);
  assert.doesNotMatch(comfortDark, /body\s*\{[^}]*background-color/i);
  assert.doesNotMatch(focus, /body\s*\{[^}]*background-color/i);
});

test('legacy Focus CSS template does not hide content by default', () => {
  const css = readRepoFile('background/css/focus.css');

  assert.doesNotMatch(css, /display:\s*none/i);
  assert.doesNotMatch(css, /\.aura-focus-hide/);
  assert.doesNotMatch(css, /:is\(aside,\s*nav/i);
});

test('comfort mode helpers expose stable dark mode decisions and token copies', () => {
  assert.equal(isComfortDarkModeEnabled(), false);
  assert.equal(isComfortDarkModeRequested({ comfortPrefs: { darkMode: true } }), true);
  assert.equal(isComfortDarkModeRequested({ modePrefs: { darkMode: true } }), true);
  assert.equal(isComfortDarkRuntimeEnabled(), true);
  assert.equal(isComfortDarkModeEnabled({ comfortPrefs: { darkMode: true } }), true);
  assert.equal(isComfortDarkModeEnabled({ modePrefs: { darkMode: true } }), true);

  assert.deepEqual(COMFORT_DARK_GUARD_TOKENS, {
    '--aura-text-color': '#f4f7ff',
    '--aura-bg-color': '#0b0d12',
    '--aura-link-color': '#b7caff',
  });
  assert.deepEqual(COMFORT_LIGHT_GUARD_TOKENS, {
    '--aura-text-color': '#0f172a',
    '--aura-bg-color': '#ffffff',
    '--aura-link-color': '#1d4ed8',
  });
  assert.equal(COMFORT_DARK_RETRY_TOKENS['--aura-link-color'], '#c5d7ff');
  assert.equal(COMFORT_LIGHT_RETRY_TOKENS['--aura-link-color'], '#1e40af');
});

test('buildComfortVisualTokenOverrides normalizes optional visual preferences', () => {
  const defaults = buildComfortVisualTokenOverrides({});
  assert.equal(defaults['--aura-link-decoration'], 'underline');
  assert.equal(defaults['--aura-font-smoothing'], 'antialiased');
  assert.equal(defaults['--aura-overflow-wrap'], 'break-word');
  assert.equal(defaults['--aura-hyphens'], 'manual');
  assert.equal(defaults['--aura-font-size'], undefined);
  assert.equal(defaults['--aura-line-height'], undefined);
  assert.equal(defaults['--aura-paragraph-spacing'], undefined);
  assert.equal(defaults['--aura-color-scheme'], undefined);

  const disabled = buildComfortVisualTokenOverrides({
    textScale: false,
    spacingPack: false,
    linkEnhance: false,
    typoSmoothing: false,
    reflowGuard: false,
  });
  assert.equal(disabled['--aura-font-size'], '1em');
  assert.equal(disabled['--aura-line-height'], 'normal');
  assert.equal(disabled['--aura-paragraph-spacing'], '0px');
  assert.equal(disabled['--aura-link-decoration'], undefined);
  assert.equal(disabled['--aura-link-decoration-thickness'], undefined);
  assert.equal(disabled['--aura-link-decoration-offset'], undefined);
  assert.equal(disabled['--aura-link-underline-position'], undefined);
  assert.equal(disabled['--aura-font-smoothing'], undefined);
  assert.equal(disabled['--aura-overflow-wrap'], 'break-word');
  assert.equal(disabled['--aura-hyphens'], 'manual');

  const requested = buildComfortVisualTokenOverrides({
    darkMode: true,
    linkEnhance: true,
    typoSmoothing: true,
    reflowGuard: true,
  });
  assert.equal(requested['--aura-font-size'], undefined);
  assert.equal(requested['--aura-line-height'], undefined);
  assert.equal(requested['--aura-paragraph-spacing'], undefined);
  assert.equal(requested['--aura-link-decoration'], 'underline');
  assert.equal(requested['--aura-font-smoothing'], 'antialiased');
  assert.equal(requested['--aura-overflow-wrap'], 'break-word');
  assert.equal(requested['--aura-hyphens'], 'manual');
  assert.equal(requested['--aura-color-scheme'], 'dark');
  assert.equal(requested['--aura-bg-color'], '#0b1020');
  assert.equal(requested['--aura-text-color'], '#e6e6e6');
});

test('comfort reflow guard keeps emergency wrapping separate from default tokens', () => {
  const emergency = buildComfortEmergencyReflowGuardTokenOverrides();

  assert.deepEqual(emergency, {
    '--aura-overflow-wrap': 'anywhere',
    '--aura-hyphens': 'auto',
    '--aura-word-break': 'normal',
  });
  emergency['--aura-overflow-wrap'] = 'normal';
  assert.equal(buildComfortEmergencyReflowGuardTokenOverrides()['--aura-overflow-wrap'], 'anywhere');
});

test('comfort legacy css builders honor link enhancement preference without degrading native links', () => {
  const defaultScoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');
  const disabledScoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED', {
    linkEnhanceEnabled: false,
  });

  assert.match(defaultScoped, /:where\(a, \[role="link"\]\)/);
  assert.match(defaultScoped, /text-decoration-line:\s*underline\s*!important/);
  assert.doesNotMatch(disabledScoped, /text-decoration-line:\s*underline\s*!important/);
  assert.doesNotMatch(disabledScoped, /text-decoration-line:\s*none/i);
});

test('comfort legacy css builders honor text rendering refinement disabled', () => {
  const scoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED', {
    typoSmoothingEnabled: false,
  });
  const strict = buildComfortCss('STRICT', 1, 'body', {
    typoSmoothingEnabled: false,
  });
  const defaultScoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');

  assert.match(defaultScoped, /text-rendering:\s*optimizeLegibility/);
  assert.match(defaultScoped, /font-kerning:\s*normal/);
  assert.match(defaultScoped, /-webkit-font-smoothing:\s*antialiased/);
  assert.match(defaultScoped, /letter-spacing:/);
  assert.doesNotMatch(scoped, /text-rendering:\s*optimizeLegibility/);
  assert.doesNotMatch(scoped, /font-kerning:\s*normal/);
  assert.doesNotMatch(scoped, /-webkit-font-smoothing/);
  assert.doesNotMatch(scoped, /letter-spacing:/);
  assert.doesNotMatch(strict, /--aura-letter-spacing/);
  assert.doesNotMatch(strict, /letter-spacing:/);
});

test('comfort legacy css builders honor text scale disabled', () => {
  const scoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED', {
    textScaleEnabled: false,
  });
  const strict = buildComfortCss('STRICT', 1, 'body', {
    textScaleEnabled: false,
  });
  const defaultScoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');

  assert.doesNotMatch(scoped, /font-size:/);
  assert.match(defaultScoped, /font-size:/);
  assert.doesNotMatch(strict, /--aura-font-size/);
  assert.doesNotMatch(strict, /font-size:\s*var\(--aura-font-size/);
});

test('comfort legacy css builders honor spacing pack disabled', () => {
  const scoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED', {
    spacingPackEnabled: false,
  });
  const strict = buildComfortCss('STRICT', 1, 'body', {
    spacingPackEnabled: false,
  });
  const defaultScoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');

  assert.doesNotMatch(scoped, /line-height:/);
  assert.match(defaultScoped, /line-height:/);
  assert.match(strict, /--aura-line-height:\s*normal;/);
  assert.match(strict, /--aura-paragraph-spacing:\s*0px;/);
});

test('comfort legacy css builders keep reflow guard soft and preserve code blocks', () => {
  const scoped = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');

  assert.match(scoped, /overflow-wrap:\s*break-word\s*!important/);
  assert.doesNotMatch(scoped, /overflow-wrap:\s*anywhere/i);
  assert.match(scoped, /:where\(pre, code, kbd, samp\)/);
  assert.match(scoped, /hyphens:\s*manual\s*!important/);
});

test('buildComfortPreludeCss builds a bounded dark shell prelude only when enabled', () => {
  assert.equal(buildComfortPreludeCss({ darkModeEnabled: false }), '');

  const css = buildComfortPreludeCss({ darkModeEnabled: true });
  assert.match(css, /html\s*\{/);
  assert.match(css, /body\s*\{/);
  assert.match(css, /color-scheme:\s*dark\s*!important/);
  assert.doesNotMatch(css, /--background\s*:/);
  assert.doesNotMatch(css, /--foreground\s*:/);
  assert.doesNotMatch(css, /--card\s*:/);
  assert.match(css, /--bs-body-bg:\s*#0b1020\s*!important/);
  assert.match(css, /--bs-body-color:\s*#e6e6e6\s*!important/);
  assert.match(css, /--md-sys-color-surface:\s*#101a2f\s*!important/);
  assert.match(css, /--bgColor-default:\s*#0b1020\s*!important/);
  assert.match(css, /body :where\(\[data-theme\]/);
  assert.match(css, /\[class\*="card" i\]/);
  assert.match(css, /\[data-bs-theme\]/);
  assert.match(css, /background-color:\s*#0b1020\s*!important/);
  assert.match(css, /:not\(\[data-aura-scope="1"\]\)/);
  assert.match(
    css,
    /:where\(input, textarea, select, button\)\s*\{[^}]*color:\s*#e6e6e6\s*!important;\s*-webkit-text-fill-color:\s*#e6e6e6\s*!important;/,
  );
  assert.match(
    css,
    /:where\(a, \[role="link"\]\)\s*\{[^}]*color:\s*#8ab4ff\s*!important;\s*-webkit-text-fill-color:\s*#8ab4ff\s*!important;/,
  );
  assert.match(css, /a:visited\s*\{[^}]*-webkit-text-fill-color:\s*#c58af9\s*!important;/);
  assert.match(css, /:where\(a, \[role="link"\]\):hover\s*\{[^}]*-webkit-text-fill-color:\s*#b1ccff\s*!important;/);
  assert.match(css, /body > :where\(\.mw-page-base/);
  assert.match(css, /\.vector-header-container/);
  assert.match(css, /\.infobox/);
  assert.match(css, /#wiki-infobox/);
  assert.match(css, /body > :is\(\.mw-page-base/);
  assert.match(css, /body \[data-aura-scope="1"\] :is\(/);
  assert.match(css, /body :where\(\*\)::part\(surface\)/);
  assert.match(css, /body :where\(\*\)::part\(panel\)/);
  assert.match(css, /body :where\(\*\)::part\(heading\)/);
  assert.match(css, /body :where\(\*\)::part\(button\)/);
  assert.match(css, /body :where\(\*\)::part\(input\)/);
  assert.match(css, /::part\(surface\)[^{]+\{[^}]*background-color:\s*#101a2f\s*!important;/);
  assert.match(css, /::part\(button\)[^{]+\{[^}]*accent-color:\s*#9ab7ff\s*!important;/);
  assert.doesNotMatch(css, /::part\(\*\)/);
  assert.match(css, /background-image:\s*none\s*!important/);
  assert.doesNotMatch(css, /body\s+\*\s*\{[^}]*background-image:\s*none\s*!important/);
  assert.match(
    css,
    /:where\(pre, code, kbd, samp\)\s*\{[^}]*color:\s*#e6e6e6\s*!important;\s*-webkit-text-fill-color:\s*#e6e6e6\s*!important;/,
  );
  assert.match(css, /:where\(img, video, canvas, svg, picture, iframe\)/);
  assert.doesNotMatch(css, /filter:\s*invert/i);
});

test('buildComfortPreludeCss can reuse adaptive dark tokens', () => {
  const css = buildComfortPreludeCss({
    darkModeEnabled: true,
    tokenMap: {
      '--aura-bg-color': '#10141f',
      '--aura-text-color': '#eef2f8',
      '--aura-muted-text-color': '#b7c0cf',
      '--aura-border-color': 'rgba(255,255,255,0.16)',
      '--aura-surface-1': '#151b2a',
      '--aura-surface-2': '#1b2333',
      '--aura-link-color': '#9ec1ff',
      '--aura-link-visited-color': '#d7a8ff',
      '--aura-link-hover-color': '#c3d7ff',
    },
  });

  assert.match(css, /background-color:\s*#10141f\s*!important/);
  assert.match(css, /color:\s*#eef2f8\s*!important/);
  assert.match(css, /color:\s*#9ec1ff\s*!important/);
  assert.doesNotMatch(css, /#0b1020/);
});

test('buildScopedTransitionsCssV2 normalizes duration and animation attribute', () => {
  const fallback = buildScopedTransitionsCssV2({ transitionMs: -1 });
  assert.match(fallback, /transition-duration: 160ms/);

  const rounded = buildScopedTransitionsCssV2({ transitionMs: 74.6, animAttrName: 'data-test-anim' });
  assert.match(rounded, /\[data-test-anim="1"\]/);
  assert.match(rounded, /transition-duration: 75ms/);
  assert.match(rounded, /prefers-reduced-motion: reduce/);
});

test('getSmoothTransitionSettings honors smooth transition and reduce motion flags', () => {
  const enabledFlags = {
    focusReduceMotionV1: true,
    smoothThemeTransitionsV2: true,
  };

  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.COMFORT_VISUAL, {}, enabledFlags), {
    reduceMotionEnabled: false,
    smoothTransitionsEnabled: true,
    transitionMs: 160,
  });
  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.COMFORT_VISUAL, { reduceMotion: true }, enabledFlags), {
    reduceMotionEnabled: true,
    smoothTransitionsEnabled: false,
    transitionMs: 160,
  });
  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.FOCUS, { reduceMotion: true }, enabledFlags), {
    reduceMotionEnabled: true,
    smoothTransitionsEnabled: false,
    transitionMs: 160,
  });

  assert.deepEqual(getSmoothTransitionSettings(MODE_IDS.FOCUS, { reduceMotion: true }, {
    focusReduceMotionV1: false,
    smoothThemeTransitionsV2: true,
  }), {
    reduceMotionEnabled: false,
    smoothTransitionsEnabled: true,
    transitionMs: 160,
  });
});

test('css-applier facade re-exports the mode CSS builders', async () => {
  const facade = await import('../../background/css-applier.js');

  assert.equal(facade.buildComfortCss, buildComfortCss);
  assert.equal(facade.buildFocusCss, buildFocusCss);
  assert.equal(facade.buildModeCss, buildModeCss);
  assert.equal(facade.buildSmartScopePatchCSS, buildSmartScopePatchCSS);
});
