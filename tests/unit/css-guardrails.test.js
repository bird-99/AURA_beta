import assert from 'node:assert/strict';
import { test } from 'node:test';

import { materializeScopedCss, validateScopedCss } from '../../background/css-guardrails.js';

test('materializeScopedCss replaces the scope placeholder', () => {
  const template = '__AURA_SCOPE__ :is(nav, aside) { display: none; }';
  const scoped = materializeScopedCss(template, '.aura-scope');
  assert.equal(scoped, '.aura-scope :is(nav, aside) { display: none; }');
});

test('validateScopedCss accepts scoped focus rules', () => {
  const cssText = '.aura-scope :is(nav, aside) { display: none; }';
  const result = validateScopedCss(cssText, '.aura-scope');
  assert.equal(result.ok, true);
});

test('validateScopedCss rejects when the scope is missing', () => {
  const cssText = '.aura-scope nav { display: none; }';
  const result = validateScopedCss(cssText, '');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-scope');
});

test('validateScopedCss rejects unresolved placeholders', () => {
  const cssText = '__AURA_SCOPE__ :is(nav, aside) { display: none; }';
  const result = validateScopedCss(cssText, '.aura-scope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unresolved-placeholder');
});

test('validateScopedCss rejects unscoped selectors', () => {
  const cssText = 'body { margin: 0; }';
  const result = validateScopedCss(cssText, '.aura-scope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unscoped-selector');
});

test('validateScopedCss rejects !important usage', () => {
  const cssText = '.aura-scope nav { display: none !important; }';
  const result = validateScopedCss(cssText, '.aura-scope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'important-disallowed');
});
