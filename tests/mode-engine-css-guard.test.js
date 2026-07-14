import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { guardCss, DEFAULT_SCOPE } from '../shared/mode-engine-css-guard.js';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCOPE_REGEX = new RegExp(`^${escapeRegex(DEFAULT_SCOPE)}\\s+p`);
const IMPORTANT_REGEX = /!important/i;
const WHITESPACE_MARGIN_12 = /margin-top:\s*12px/;

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

function loadFixture(name) {
  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'css', name);
  return fs.readFileSync(fixturePath, 'utf8');
}

test('scoping enforcement prefixes selectors', () => {
  const result = guardCss({ cssText: 'p { color: red; }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, SCOPE_REGEX);
  assert.ok(!result.cssText.includes(':root'));
});

test('already scoped selectors remain accepted', () => {
  const result = guardCss({ cssText: '[data-aura-scope="1"] p { color: red; }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, /^\[data-aura-scope="1"\]\s+p/);
});

test('scoped v2 applied sentinel survives guardrails', () => {
  const result = guardCss({ cssText: '[data-aura-scope="1"] { --aura-me2-applied: 1; color: red; }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, /--aura-me2-applied:\s*1/);
});

test('idempotence when applying guard twice', () => {
  const first = guardCss({ cssText: 'p { color: blue; }' });
  const second = guardCss({ cssText: first.cssText });
  assert.equal(second.ok, true);
  assert.equal(first.cssText, second.cssText);
});

test('rejects global at-rules', () => {
  const result = guardCss({ cssText: '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }' });
  assert.equal(result.ok, false);
  assert.equal(result.stats.atRulesBlocked, 1);
  assert.ok(reasonCodes(result).includes('AT_RULE_BLOCKED'));
});

test('rejects font-face as banned at-rule', () => {
  const result = guardCss({ cssText: '@font-face { font-family: X; src: url(x.woff2); }' });
  assert.equal(result.ok, false);
  assert.ok(reasonCodes(result).includes('AT_RULE_BLOCKED'));
  assert.equal(result.stats.atRulesBlocked, 1);
});

test('parse error handling returns ok=false', () => {
  const result = guardCss({ cssText: 'p color: red' });
  assert.equal(result.ok, false);
  assert.ok(reasonCodes(result).includes('PARSE_ERROR'));
});

test('blocked property is removed but allowed ones stay', () => {
  const result = guardCss({ cssText: 'p { display: none; color: red; }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, SCOPE_REGEX);
  assert.ok(!result.cssText.includes('display'));
  assert.match(result.cssText, /color:\s*red/);
});

test('box-shadow is allowed for scoped non-layout visual emphasis', () => {
  const result = guardCss({
    cssText: 'p { box-shadow: 0 0 0 1px rgba(15, 98, 254, 0.28); }',
  });
  assert.equal(result.ok, true);
  assert.match(result.cssText, SCOPE_REGEX);
  assert.match(result.cssText, /box-shadow:\s*0 0 0 1px rgba\(15,\s*98,\s*254,\s*0\.28\)/);
});

test('spacing value above threshold is blocked and empties stylesheet', () => {
  const result = guardCss({ cssText: 'p { margin-top: 48px; }' });
  assert.equal(result.ok, false);
  const codes = reasonCodes(result);
  assert.ok(codes.includes('BLOCKED_VALUE'));
  assert.ok(codes.includes('EMPTY_AFTER_GUARD'));
});

test('spacing value negative is blocked', () => {
  const result = guardCss({ cssText: 'p { margin-top: -4px; }' });
  assert.equal(result.ok, false);
  const codes = reasonCodes(result);
  assert.ok(codes.includes('BLOCKED_VALUE'));
  assert.ok(codes.includes('EMPTY_AFTER_GUARD'));
});

test('spacing value within allowlist is kept', () => {
  const result = guardCss({ cssText: 'p { margin-top: 12px; }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, WHITESPACE_MARGIN_12);
  assert.match(result.cssText, SCOPE_REGEX);
});

test('spacing value accepts aura var with bounded fallback', () => {
  const result = guardCss({ cssText: 'p { margin-top: var(--aura-paragraph-spacing, 12px); }' });
  assert.equal(result.ok, true);
  assert.match(result.cssText, /margin-top:\s*var\(--aura-paragraph-spacing,\s*12px\)/);
  assert.match(result.cssText, SCOPE_REGEX);
});

test('spacing value rejects aura var with unsafe fallback', () => {
  const result = guardCss({ cssText: 'p { margin-top: var(--aura-paragraph-spacing, 48px); }' });
  assert.equal(result.ok, false);
  const codes = reasonCodes(result);
  assert.ok(codes.includes('BLOCKED_VALUE'));
  assert.ok(codes.includes('EMPTY_AFTER_GUARD'));
});

test('important is stripped from declarations', () => {
  const result = guardCss({ cssText: 'p { color: red !important; }' });
  assert.equal(result.ok, true);
  assert.ok(!IMPORTANT_REGEX.test(result.cssText));
  assert.match(result.cssText, /color:\s*red/);
  assert.equal(result.stats.importantBlocked, 1);
});

test('background-image none is allowed and keeps important for scoped gradient cleanup', () => {
  const result = guardCss({ cssText: 'p { background-image: none !important; }' });

  assert.equal(result.ok, true);
  assert.match(result.cssText, SCOPE_REGEX);
  assert.match(result.cssText, /background-image:\s*none\s*!important/);
  assert.equal(result.stats.importantBlocked, 0);
});

test('design-system dark custom properties accept only aura token values and keep important', () => {
  const result = guardCss({
    cssText: '[data-aura-scope="1"] { --background: var(--aura-bg-color) !important; --bs-body-bg: var(--aura-bg-color) !important; --md-sys-color-surface: var(--aura-surface-1) !important; --bgColor-default: var(--aura-bg-color) !important; }',
  });

  assert.equal(result.ok, true);
  assert.match(result.cssText, /--background:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(result.cssText, /--bs-body-bg:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(result.cssText, /--md-sys-color-surface:\s*var\(--aura-surface-1\)\s*!important/);
  assert.match(result.cssText, /--bgColor-default:\s*var\(--aura-bg-color\)\s*!important/);
  assert.equal(result.stats.importantBlocked, 0);
});

test('design-system dark custom properties reject raw values and unknown custom properties', () => {
  const rawValue = guardCss({ cssText: '[data-aura-scope="1"] { --background: #000 !important; color: red; }' });
  const unknown = guardCss({ cssText: '[data-aura-scope="1"] { --site-private-theme-color: var(--aura-bg-color) !important; color: red; }' });

  assert.equal(rawValue.ok, true);
  assert.ok(reasonCodes(rawValue).includes('BLOCKED_VALUE'));
  assert.doesNotMatch(rawValue.cssText, /--background/);
  assert.match(rawValue.cssText, /color:\s*red/);

  assert.equal(unknown.ok, true);
  assert.ok(reasonCodes(unknown).includes('BLOCKED_PROPERTY'));
  assert.doesNotMatch(unknown.cssText, /--site-private-theme-color/);
  assert.match(unknown.cssText, /color:\s*red/);
});

test('background-image urls and gradients remain blocked', () => {
  const urlResult = guardCss({ cssText: 'p { background-image: url("x.svg"); }' });
  const gradientResult = guardCss({ cssText: 'p { background-image: linear-gradient(red, blue); }' });

  assert.equal(urlResult.ok, false);
  assert.ok(reasonCodes(urlResult).includes('BLOCKED_VALUE'));
  assert.ok(reasonCodes(urlResult).includes('EMPTY_AFTER_GUARD'));
  assert.equal(gradientResult.ok, false);
  assert.ok(reasonCodes(gradientResult).includes('BLOCKED_VALUE'));
  assert.ok(reasonCodes(gradientResult).includes('EMPTY_AFTER_GUARD'));
});

test('allows media queries while keeping scoping', () => {
  const result = guardCss({ cssText: '@media (prefers-color-scheme: dark) { p { color: #fff; } }' });

  assert.equal(result.ok, true);
  assert.match(result.cssText, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.match(result.cssText, new RegExp(`${escapeRegex(DEFAULT_SCOPE)}\\s+p`));
});

test('spacing via calc or clamp is blocked and leads to empty output', () => {
  const result = guardCss({ cssText: 'p { padding-top: clamp(12px, 2vw, 26px); }' });
  assert.equal(result.ok, false);
  const codes = reasonCodes(result);
  assert.ok(codes.includes('BLOCKED_VALUE'));
  assert.ok(codes.includes('EMPTY_AFTER_GUARD'));
});

test('empty input is rejected quickly', () => {
  const result = guardCss({ cssText: '   ' });
  assert.equal(result.ok, false);
  assert.ok(reasonCodes(result).includes('EMPTY_INPUT'));
});

test('fixture resembling wikipedia style remains scoped and filtered', () => {
  const cssText = loadFixture('wikipedia-ish.css');
  const result = guardCss({ cssText });

  assert.equal(result.ok, true);
  assert.match(result.cssText, new RegExp(`${escapeRegex(DEFAULT_SCOPE)}\\s+body`));
  assert.match(result.cssText, new RegExp(`${escapeRegex(DEFAULT_SCOPE)}\\s+#content`));
  assert.ok(!result.cssText.includes('display'));
  assert.ok(!IMPORTANT_REGEX.test(result.cssText));
  assert.ok(result.cssText.includes('@media'));
});
