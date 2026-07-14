import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  ACTIVATION_STAGES,
  CAPABILITY_STATUSES,
  SUPPORT_LEVELS,
} from '../../shared/engine-core/enums.js';
import {
  buildDarkComfortThemeApplyRequestV1,
  canActivateDarkComfortThemeV1,
  createDarkComfortThemeCleanupManifestV1,
} from '../../background/dark-comfort-theme-executor.js';
import {
  buildDarkComfortThemePaletteV1,
  buildDarkComfortThemeScopedCss,
  buildDarkComfortThemeTokenMap,
  DARK_THEME_V1_BUDGET,
  getDarkComfortThemePaletteDiagnosticsV1,
  isAlreadyDarkVisualSnapshot,
} from '../../background/dark-comfort-theme-css.js';
import { evaluateDarkComfortThemePostcheckV1 } from '../../background/dark-comfort-theme-postcheck.js';

test('Dark Comfort Theme executor activates only after manual limited gate passes', () => {
  const gate = canActivateDarkComfortThemeV1({
    userOptIn: true,
    pageType: 'ARTICLE',
    capability: {
      actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
      status: CAPABILITY_STATUSES.SUPPORTED,
      supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      activePlanAllowed: true,
    },
    postcheck: {
      textContrast: 4.8,
      largeTextContrast: 3.2,
      linksDistinct: true,
      controlsVisible: true,
      focusRingVisible: true,
      placeholdersReadable: true,
      codeReadable: true,
      mediaPreserved: true,
      svgVisible: true,
      noHorizontalScrollRegression: true,
      noClippedTextRegression: true,
      cleanupExact: true,
    },
  });

  assert.equal(gate.activePlanAllowed, true);
  assert.equal(gate.runtimeEnabled, true);
  assert.deepEqual(gate.failures, []);
});

test('Dark Comfort Theme apply request includes compact cleanup manifest and inactive message patch without capability', () => {
  const request = buildDarkComfortThemeApplyRequestV1({
    userOptIn: true,
    pageType: 'ARTICLE',
    frameId: 3,
    ownerKey: 'aura-me2',
  });

  assert.equal(request.version, 1);
  assert.equal(request.actionId, ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME);
  assert.equal(request.executor, 'DARK_THEME_TRANSFORM');
  assert.equal(request.activePlanAllowed, false);
  assert.equal(request.messagePatch.darkThemeExecutorActive, false);
  assert.equal(request.tokenMap['--aura-color-scheme'], 'dark');
  assert.equal(request.cleanupManifest.version, 1);
  assert.equal(request.cleanupManifest.frameId, 3);
  assert.equal(request.cleanupManifest.css.removeByExactIdentity, true);
  assert.equal(request.cleanupManifest.postCheck.required, true);
  assert.equal(request.cleanupManifest.rollbackRequired, true);
  assert.deepEqual(Object.keys(request.budget), Object.keys(DARK_THEME_V1_BUDGET));
});

test('Dark Comfort Theme apply request enables executor with supported capability', () => {
  const request = buildDarkComfortThemeApplyRequestV1({
    userOptIn: true,
    pageType: 'DOC',
    frameId: 2,
    ownerKey: 'aura-me2',
    capability: {
      key: {
        actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
        pageType: 'DOC',
      },
      status: CAPABILITY_STATUSES.SUPPORTED,
      supportLevel: SUPPORT_LEVELS.ACTIVE_RUNTIME,
      activationStage: ACTIVATION_STAGES.MANUAL_LIMITED,
      activePlanAllowed: true,
    },
  });

  assert.equal(request.activePlanAllowed, true);
  assert.equal(request.messagePatch.darkThemeExecutorActive, true);
  assert.equal(request.cleanupManifest.frameId, 2);
});

test('Dark Comfort Theme cleanup manifest records token keys without unsafe page data', () => {
  const tokenMap = buildDarkComfortThemeTokenMap();
  const manifest = createDarkComfortThemeCleanupManifestV1({
    tokenMap,
    cssIds: ['css-1'],
    ownerKey: 'aura-me2',
  });

  assert.equal(manifest.css.cssIds[0], 'css-1');
  assert.equal(manifest.tokens.keys.includes('--aura-color-scheme'), true);
  assert.equal(JSON.stringify(manifest).includes('https://'), false);
  assert.equal(JSON.stringify(manifest).includes('selector'), false);
  assert.equal(JSON.stringify(manifest).includes('rawText'), false);
});

test('Dark Comfort Theme postcheck fails closed on contrast, budget, or missing cleanup', () => {
  const failed = evaluateDarkComfortThemePostcheckV1({
    textContrast: 4.4,
    largeTextContrast: 3.1,
    linksDistinct: true,
    controlsVisible: true,
    focusRingVisible: true,
    placeholdersReadable: true,
    codeReadable: true,
    mediaPreserved: true,
    svgVisible: true,
    noHorizontalScrollRegression: true,
    noClippedTextRegression: true,
    cleanupExact: false,
    budgetHit: true,
  });

  assert.equal(failed.postCheckPassed, false);
  assert.equal(failed.failures.includes('textContrast'), true);
  assert.equal(failed.failures.includes('cleanupExact'), true);
  assert.equal(failed.failures.includes('budgetHit'), true);
});

test('Dark Comfort Theme adaptive palette detects already-dark pages from visual colors only', () => {
  assert.equal(isAlreadyDarkVisualSnapshot({
    backgroundColor: '#f8fafc',
    prefersColorScheme: 'dark',
  }), false);
  assert.equal(isAlreadyDarkVisualSnapshot({
    backgroundColor: '#080b12',
    textColor: '#eef2ff',
    prefersColorScheme: 'light',
  }), true);
});

test('Dark Comfort Theme adaptive palette preserves contrast and reports diagnostics', () => {
  const palette = buildDarkComfortThemePaletteV1({
    backgroundColor: '#ffffff',
    textColor: '#777777',
    linkColor: '#999999',
    prefersColorScheme: 'dark',
  });
  const diagnostics = getDarkComfortThemePaletteDiagnosticsV1(palette);

  assert.equal(palette.prefersColorScheme, 'dark');
  assert.equal(palette.alreadyDark, false);
  assert.ok(diagnostics.textContrast >= 4.5);
  assert.ok(diagnostics.linkContrast >= 4.5);
  assert.ok(diagnostics.linkDistinctFromText >= 1.25);
});

test('Dark Comfort Theme keeps standard palette on light pages', () => {
  const palette = buildDarkComfortThemePaletteV1({
    backgroundColor: '#ffffff',
    textColor: '#18181b',
    linkColor: '#1d4ed8',
    prefersColorScheme: 'light',
  });

  assert.equal(palette.alreadyDark, false);
  assert.equal(palette.text, '#e6e6e6');
  assert.equal(palette.mutedText, '#a8b0bf');
  assert.equal(palette.link, '#8ab4ff');
});

test('Dark Comfort Theme scoped CSS applies color-scheme only to the Aura scope', () => {
  const css = buildDarkComfortThemeScopedCss({
    scopeSelector: '.aura-scope',
    palette: buildDarkComfortThemePaletteV1({ backgroundColor: '#111111' }),
  });

  assert.match(css, /\.aura-scope \{ color-scheme: dark/);
  assert.match(css, /\.aura-scope \{[^}]*-webkit-text-fill-color:\s*#[0-9a-f]{6}\s*!important;/i);
  assert.match(
    css,
    /\.aura-scope :where\(a, \[role="link"\]\)\s*\{[^}]*-webkit-text-fill-color:\s*#[0-9a-f]{6}\s*!important;/i,
  );
  assert.match(
    css,
    /\.aura-scope :where\(input, textarea, select, button\)\s*\{[^}]*color:\s*#[0-9a-f]{6}\s*!important;\s*-webkit-text-fill-color:\s*#[0-9a-f]{6}\s*!important;/i,
  );
  assert.match(
    css,
    /\.aura-scope :where\(pre, code\)\s*\{[^}]*-webkit-text-fill-color:\s*#[0-9a-f]{6}\s*!important;/i,
  );
  assert.doesNotMatch(css, /html\s*,\s*body/i);
  assert.doesNotMatch(css, /:root\s*\{/i);
});

test('Dark Comfort Theme apply request carries adaptive palette without enabling runtime', () => {
  const request = buildDarkComfortThemeApplyRequestV1({
    userOptIn: true,
    pageType: 'ARTICLE',
    visualSnapshot: {
      backgroundColor: '#090b10',
      textColor: '#dbeafe',
      linkColor: '#93c5fd',
      prefersColorScheme: 'light',
    },
  });

  assert.equal(request.palette.alreadyDark, true);
  assert.equal(request.paletteDiagnostics.alreadyDark, true);
  assert.equal(request.paletteDiagnostics.prefersColorScheme, 'light');
  assert.equal(request.messagePatch.darkThemeExecutorActive, false);
});
