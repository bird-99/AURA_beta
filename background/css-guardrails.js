import { FOCUS_SCOPE_PLACEHOLDER } from '../shared/constants.js';

const FORBIDDEN_SELECTOR_PREFIX = /^(?:\*|html\b|body\b|:root\b)/i;
const IMPORTANT_PATTERN = /!important\b/i;
const SELECTOR_BLOCK_PATTERN = /(^|}|{)\s*([^@{}][^{]+)\{/g;

function stripCssComments(cssText) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeScopeSelector(scopeSelector = '') {
  return `${scopeSelector}`.trim();
}

export function materializeScopedCss(template, scopeSelector) {
  const scope = normalizeScopeSelector(scopeSelector);
  return template.replaceAll(FOCUS_SCOPE_PLACEHOLDER, scope);
}

export function validateScopedCss(cssText, scopeSelector) {
  const scope = normalizeScopeSelector(scopeSelector);

  if (!scope) {
    return { ok: false, reason: 'missing-scope' };
  }

  if (!cssText || !cssText.trim()) {
    return { ok: false, reason: 'empty-css' };
  }

  if (cssText.includes(FOCUS_SCOPE_PLACEHOLDER)) {
    return { ok: false, reason: 'unresolved-placeholder' };
  }

  if (IMPORTANT_PATTERN.test(cssText)) {
    return { ok: false, reason: 'important-disallowed' };
  }

  const stripped = stripCssComments(cssText);
  const selectorMatches = stripped.matchAll(SELECTOR_BLOCK_PATTERN);
  let scopeFound = false;

  for (const match of selectorMatches) {
    const selectorGroup = match[2];
    if (!selectorGroup) {
      continue;
    }

    const sanitizedGroup = selectorGroup
      .replace(/:is\([^)]*\)/g, ':is()')
      .replace(/:where\([^)]*\)/g, ':where()');
    const selectors = sanitizedGroup.split(',');
    for (const selector of selectors) {
      const trimmed = selector.trim();
      if (!trimmed) {
        continue;
      }

      if (selectorGroup.includes(scope)) {
        scopeFound = true;
      }

      if (!trimmed.startsWith(scope)) {
        return { ok: false, reason: 'unscoped-selector', detail: trimmed };
      }

      if (FORBIDDEN_SELECTOR_PREFIX.test(trimmed)) {
        return { ok: false, reason: 'global-selector', detail: trimmed };
      }
    }
  }

  if (!scopeFound) {
    return { ok: false, reason: 'scope-not-found' };
  }

  return { ok: true };
}

export function isTrivialScope(scopeSelector) {
  const scope = normalizeScopeSelector(scopeSelector).toLowerCase();
  if (!scope) {
    return true;
  }
  return scope === 'body' || scope === 'html' || scope.startsWith('body:');
}
