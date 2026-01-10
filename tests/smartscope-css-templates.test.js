import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildComfortCss, buildSmartScopePatchCSS } from '../background/css-applier.js';
import { MODE_IDS } from '../shared/constants.js';

test('Comfort scoped v2 avoids generic container targets', () => {
  const css = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 1, 'SCOPED');
  assert(css.includes('.aura-scope'), 'Scoped CSS should be limited to the aura scope');
  assert(!/div\s*\{[^}]*max-inline-size/i.test(css), 'Scoped CSS should not cap generic div widths');
  assert(!/span\s*\{[^}]*max-inline-size/i.test(css), 'Scoped CSS should not cap generic span widths');
});

test('Scoped typography keeps generous line-height floor', () => {
  const css = buildSmartScopePatchCSS(MODE_IDS.COMFORT_VISUAL, 0, 'SCOPED');
  const lineHeights = Array.from(css.matchAll(/line-height:\s*clamp\(([^,]+)/gi)).map((match) => Number.parseFloat(match[1]));
  assert(lineHeights.length > 0, 'Line-height clamps should be present');
  lineHeights.forEach((value) => assert(value >= 1.5, 'Line-height should not drop below 1.5'));
});

test('Dark mode colors remain scoped', () => {
  const css = buildSmartScopePatchCSS(MODE_IDS.FOCUS, 1, 'SCOPED');
  assert(css.includes('@media (prefers-color-scheme: dark) { .aura-scope'), 'Dark mode should be scoped to aura root');
  assert(!/body\s*\{[^}]*background-color/i.test(css), 'Scoped dark mode should not override body background');
});

test('Comfort Visual strict template targets scope root and descendants', () => {
  const css = buildComfortCss('STRICT', 1, 'body');
  assert(css.includes('[data-aura-scope="1"]'), 'Template should target the scope root');
  assert(!/body\s*\{[^}]*\}/i.test(css), 'Template should not target body');
  assert(!/:root\s*\{[^}]*\}/i.test(css), 'Template should not target :root');
});
