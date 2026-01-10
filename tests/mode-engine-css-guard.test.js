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

test('important is stripped from declarations', () => {
  const result = guardCss({ cssText: 'p { color: red !important; }' });
  assert.equal(result.ok, true);
  assert.ok(!IMPORTANT_REGEX.test(result.cssText));
  assert.match(result.cssText, /color:\s*red/);
  assert.equal(result.stats.importantBlocked, 1);
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
