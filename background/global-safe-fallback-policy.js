import { APPLY_FAILURE_REASONS } from './apply-failure-reasons.js';

export const GLOBAL_SAFE_FALLBACK_VARIANT = 'GLOBAL_SAFE_FALLBACK';

export const GLOBAL_SAFE_FALLBACK_REASON_TOKENS = Object.freeze([
  'AMBIGUOUS',
  'TOP_CANDIDATES_AMBIGUOUS',
  'LOW_SCORE',
  'NO_CANDIDATES_FOUND',
  'NO_VALID_CANDIDATE',
  'TIME_BUDGET_EXCEEDED',
]);

export const GLOBAL_SAFE_FALLBACK_HARD_DENY_TOKENS = Object.freeze([
  'NO_RECEIVER',
  'INTERNAL_ERROR',
  'SMARTSCOPE_FAILED',
  'V2_DISABLED',
  'V2_UNAVAILABLE',
  'INVALID_DOCUMENT',
  'QUERY_FAILED',
  'UNEXPECTED_ERROR',
  'SCOPE_REJECTED',
  'SCOPE_ROOT_UNRESOLVED',
  'ROOT_IS_HTML',
  'ROOT_IS_BODY',
  'ROOT_TOO_LARGE',
  'ROOT_HIDDEN',
  'ROOT_NOT_CONNECTED',
  'ROOT_SELECTOR_NON_UNIQUE',
  'ROOT_TOO_SMALL',
  'SANITY_CHECK_FAILED',
  'INVALID_FINAL_ELEMENT',
  'GUARDRAILS_REJECTED',
  'INSERT_CSS_FAILED',
  'TOKEN_APPLY_FAILED',
  'REGISTRY_FAILED',
  'POST_APPLY_INSPECTION_FAILED',
  'DEGRADED',
  'EXT_CONTEXT_INVALID',
]);

const SAFE_TOKENS = new Set(GLOBAL_SAFE_FALLBACK_REASON_TOKENS);
const HARD_DENY_TOKENS = new Set(GLOBAL_SAFE_FALLBACK_HARD_DENY_TOKENS);
const FOCUS_LIMITED_RECOVERABLE_TOKENS = new Set([
  ...GLOBAL_SAFE_FALLBACK_REASON_TOKENS,
  'SCOPE_REJECTED',
  'SCOPE_ROOT_UNRESOLVED',
  'ROOT_TOO_LARGE',
  'ROOT_HIDDEN',
  'ROOT_NOT_CONNECTED',
  'ROOT_SELECTOR_NON_UNIQUE',
  'ROOT_TOO_SMALL',
  'SANITY_CHECK_FAILED',
  'INVALID_FINAL_ELEMENT',
]);

export function extractGlobalSafeFallbackTokens(value = '') {
  return `${value}`
    .toUpperCase()
    .replace(/-/g, '_')
    .split(/[^A-Z0-9_]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function shouldApplyGlobalSafeFallback(result = {}) {
  if (result?.reason !== APPLY_FAILURE_REASONS.NO_SCOPE && result?.error !== APPLY_FAILURE_REASONS.NO_SCOPE) {
    return false;
  }

  const tokens = extractGlobalSafeFallbackTokens(`${result?.detail || result?.details || ''}`);
  if (tokens.some((token) => HARD_DENY_TOKENS.has(token))) {
    return false;
  }
  return tokens.some((token) => SAFE_TOKENS.has(token));
}

export function shouldApplyFocusLimitedFallback(result = {}) {
  const reason = `${result?.reason || result?.error || ''}`.toUpperCase().replace(/-/g, '_');
  const tokens = new Set([
    reason,
    ...extractGlobalSafeFallbackTokens(`${result?.detail || result?.details || ''}`),
  ]);
  if (tokens.has('NO_RECEIVER') || tokens.has('INVALID_DOCUMENT') || tokens.has('EXT_CONTEXT_INVALID')) {
    return false;
  }
  return [...tokens].some((token) => FOCUS_LIMITED_RECOVERABLE_TOKENS.has(token));
}
