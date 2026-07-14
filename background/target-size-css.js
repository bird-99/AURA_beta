export const TARGET_SIZE_CSS_PROFILE_IDS = Object.freeze({
  FORM_SEARCH_SIMPLE_CONTROLS: 'target-size-form-search-simple-controls-v1',
});

export const TARGET_SIZE_CLASS = 'aura-target-boost';
export const TARGET_SIZE_MIN_PX = 24;

export function buildTargetSizeClassRuleV1(scopeSelector = '[data-aura-scope="1"]') {
  const scope = typeof scopeSelector === 'string' && scopeSelector.trim()
    ? scopeSelector.trim()
    : '[data-aura-scope="1"]';

  return [
    `${scope} .${TARGET_SIZE_CLASS} { min-inline-size: ${TARGET_SIZE_MIN_PX}px; min-block-size: ${TARGET_SIZE_MIN_PX}px; max-inline-size: 100%; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; vertical-align: middle; }`,
    `${scope} .${TARGET_SIZE_CLASS}:focus-visible { outline: 2px solid var(--aura-focus-color, #0a84ff); outline-offset: 3px; }`,
  ].join(' ');
}

export function buildTargetSizeCssV1(input = {}) {
  const pageType = input.pageType || '';
  if (!['FORM', 'SEARCH'].includes(pageType)) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_TARGET_SIZE_PAGE',
      cssText: '',
      profileId: '',
    };
  }

  return {
    ok: true,
    reason: 'OK',
    cssText: buildTargetSizeClassRuleV1(input.scopeSelector),
    profileId: TARGET_SIZE_CSS_PROFILE_IDS.FORM_SEARCH_SIMPLE_CONTROLS,
  };
}
