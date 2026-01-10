import assert from 'node:assert';
import { buildComfortCss, buildFocusCss } from '../background/css-applier.js';

function testStrictContainsBaseline() {
  const css = buildComfortCss('STRICT', 1);
  assert(css.includes('[data-aura-scope="1"]'), 'STRICT should target the scoped root');
  assert(/\[data-aura-scope="1"\]\s*\{/.test(css), 'STRICT should style the scope root element');
  assert(css.includes('--aura-me2-css: 1;'), 'STRICT should include the debug sentinel');
  assert(css.includes('--aura-letter-spacing'), 'STRICT should define the letter-spacing token');
  assert(css.includes('letter-spacing: var(--aura-letter-spacing)'), 'STRICT should consume the letter-spacing token');
  assert(
    /\[data-aura-scope="1"\]\s*:is\(p,\s*li,\s*blockquote,\s*pre,\s*code\)/.test(css),
    'STRICT should target readable elements without generic divs'
  );
  assert(!/div/.test(css), 'STRICT should not target generic divs');
  assert(!/body\s*\{[^}]*\}/i.test(css), 'STRICT should not target body');
  assert(!/html\s*\{[^}]*\}/i.test(css), 'STRICT should not target html');
  assert(!/:root\s*\{[^}]*\}/i.test(css), 'STRICT should not target :root');
}

function testMinimalContainerFirst() {
  const css = buildComfortCss('MINIMAL', 1, '.aura-scope');
  assert(css.includes('--aura-measure'), 'MINIMAL should define a responsive measure on the scope');
  assert(css.includes('max-inline-size: min(var(--aura-measure'), 'MINIMAL should limit width per text block');
  assert(css.includes('padding-inline'), 'MINIMAL should use padding on the scope to avoid cramping');
  assert(css.includes('@media (prefers-color-scheme: dark) { .aura-scope'), 'MINIMAL dark mode should be scoped to aura-scope');
  assert(!css.includes('body { background'), 'MINIMAL dark mode should not override body background');
}

function testScopedSemanticMeasure() {
  const css = buildComfortCss('SCOPED', 1, '.aura-scope');
  assert(css.includes('.aura-scope :where(p, blockquote, pre, code'), 'SCOPED should target semantic text blocks');
  assert(css.includes('clamp(58ch, 68ch, 76ch)'), 'SCOPED should include responsive measure');
  assert(css.includes('max-inline-size: min'), 'SCOPED should cap measure responsively');
  assert(!css.includes('span,'), 'SCOPED should not target spans for measure');
  assert(!css.includes('div { max-width'), 'SCOPED should not target generic divs for measure');
  assert(css.includes('@media (prefers-color-scheme: dark) { .aura-scope'), 'SCOPED dark mode should be scoped to aura-scope');
  assert(!css.includes('body { background'), 'SCOPED dark mode should not set body background');
}

function testScopedFunctionsPresent() {
  const css = buildComfortCss('SCOPED', 1, '.aura-scope');
  assert(css.includes('clamp('), 'SCOPED should use clamp for responsive sizing');
  assert(css.includes('min('), 'SCOPED should use min() to guard layout width');
  assert(css.includes('.aura-scope'), 'SCOPED should target the aura scope');
}

function run() {
  testStrictContainsBaseline();
  testMinimalContainerFirst();
  testScopedSemanticMeasure();
  testScopedFunctionsPresent();
  testFocusScopedResponsive();
  testFocusMinimalResponsive();
  console.log('SmartScope template tests passed');
}

function testFocusScopedResponsive() {
  const css = buildFocusCss('SCOPED', 1, '.aura-scope');
  assert(css.includes('clamp(64ch, 74ch, 80ch)'), 'FOCUS scoped should use adaptive width on the scope');
  assert(css.includes('padding-inline'), 'FOCUS scoped should apply responsive inline padding');
  assert(css.includes('.aura-focus-hide'), 'FOCUS scoped should hide focus-hidden elements');
  assert(css.includes('animation: none'), 'FOCUS scoped should reduce animations within scoped text/media');
}

function testFocusMinimalResponsive() {
  const css = buildFocusCss('MINIMAL', 1, '.aura-scope');
  assert(css.includes('clamp(66ch, 76ch, 80ch)'), 'FOCUS minimal should use a wider adaptive scope width');
  assert(css.includes('padding-inline'), 'FOCUS minimal should add scope padding instead of altering layout containers');
  assert(css.includes('.aura-focus-hide'), 'FOCUS minimal should hide focus-hidden elements');
  assert(css.includes('animation: none'), 'FOCUS minimal should reduce animation noise on text/media');
}

run();
