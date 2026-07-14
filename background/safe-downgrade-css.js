import { MODE_IDS } from '../shared/constants.js';

export const SAFE_DOWNGRADE_CSS_REASONS = Object.freeze({
  UNSUPPORTED_DOWNGRADE: 'UNSUPPORTED_DOWNGRADE',
  INVALID_RUNTIME_EFFECT_PLAN: 'INVALID_RUNTIME_EFFECT_PLAN',
});

export const FOCUS_SAFE_DOWNGRADE_PROFILE_IDS = Object.freeze({
  READING_LINKS: 'focus-reading-links-v2',
  SEARCH_LINKS: 'focus-search-links-v2',
  CARD_FOCUS: 'focus-card-focus-v2',
  FORM_FOCUS: 'focus-form-focus-v2',
  APP_FOCUS: 'focus-app-focus-v2',
});

export const FOCUS_SAFE_DOWNGRADE_PROFILE_ID = FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS;

export const FOCUS_SAFE_DOWNGRADES = Object.freeze([
  'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
  'SAFE_RESULT_FOCUS_TARGETS',
  'SAFE_PRODUCT_FOCUS_TARGETS',
  'SAFE_FORM_FOCUS_TARGETS',
  'SAFE_DASHBOARD_FOCUS_VISIBLE',
  'SAFE_MEDIA_FOCUS_VISIBLE',
  'SAFE_FEED_FOCUS_VISIBLE',
  'SAFE_APP_FOCUS_VISIBLE',
  'SAFE_GLOBAL_FOCUS_VISIBLE',
]);

const FOCUS_SAFE_DOWNGRADE_SET = new Set(FOCUS_SAFE_DOWNGRADES);
const READING_PAGE_TYPES = new Set(['ARTICLE', 'DOC']);
const SEARCH_PAGE_TYPES = new Set(['SEARCH']);
const CARD_PAGE_TYPES = new Set(['SHOP', 'FEED']);
const FORM_PAGE_TYPES = new Set(['FORM']);
const HIGH_RISK_PAGE_TYPES = new Set(['DASHBOARD', 'VIDEO', 'WEB_APP', 'UNKNOWN']);

function normalizeIntensity(intensity) {
  if (typeof intensity !== 'number' || !Number.isFinite(intensity)) {
    return 1;
  }
  return Math.min(Math.max(intensity, 0), 1);
}

function focusValues(intensity) {
  const normalized = normalizeIntensity(intensity);
  return {
    passiveUnderlineThickness: (0.08 + normalized * 0.03).toFixed(2),
    focusUnderlineThickness: (0.12 + normalized * 0.03).toFixed(2),
    underlineOffset: (0.16 + normalized * 0.04).toFixed(2),
    outlineWidth: `${Math.round(1 + normalized)}px`,
    focusColor: '#0a84ff',
  };
}

function buildPassiveLinkCss(values) {
  return `
    body a[href],
    body [role="link"] {
      text-decoration-line: underline;
      text-decoration-thickness: ${values.passiveUnderlineThickness}em;
      text-underline-offset: ${values.underlineOffset}em;
      text-decoration-skip-ink: auto;
    }
  `;
}

function buildFocusTargetCss(values) {
  return `
    body a[href]:focus,
    body [role="link"]:focus,
    body button:focus,
    body input:focus,
    body select:focus,
    body textarea:focus,
    body [role="button"]:focus,
    body [role="checkbox"]:focus,
    body [role="radio"]:focus,
    body [tabindex]:not([tabindex="-1"]):focus,
    body a[href]:focus-visible,
    body [role="link"]:focus-visible,
    body button:focus-visible,
    body input:focus-visible,
    body select:focus-visible,
    body textarea:focus-visible,
    body [role="button"]:focus-visible,
    body [role="checkbox"]:focus-visible,
    body [role="radio"]:focus-visible,
    body [tabindex]:not([tabindex="-1"]):focus-visible {
      outline-color: ${values.focusColor};
      outline-style: solid;
      outline-width: ${values.outlineWidth};
      text-decoration-line: underline;
      text-decoration-thickness: ${values.focusUnderlineThickness}em;
      text-underline-offset: ${values.underlineOffset}em;
    }
    body input:focus,
    body select:focus,
    body textarea:focus,
    body [role="checkbox"]:focus,
    body [role="radio"]:focus,
    body input:focus-visible,
    body select:focus-visible,
    body textarea:focus-visible,
    body [role="checkbox"]:focus-visible,
    body [role="radio"]:focus-visible {
      accent-color: ${values.focusColor};
      caret-color: ${values.focusColor};
      border-color: ${values.focusColor};
    }
  `;
}

function buildReadingLinksCss(intensity) {
  const values = focusValues(intensity);
  return `${buildPassiveLinkCss(values)}${buildFocusTargetCss(values)}`;
}

function buildSearchLinksCss(intensity) {
  const values = focusValues(intensity);
  return `${buildPassiveLinkCss(values)}${buildFocusTargetCss(values)}`;
}

function buildCardFocusCss(intensity) {
  const values = focusValues(intensity);

  return `
    body a[href],
    body [role="link"] {
      text-underline-offset: ${values.underlineOffset}em;
      text-decoration-skip-ink: auto;
    }
    ${buildFocusTargetCss(values)}
  `;
}

function buildFocusOnlyCss(intensity) {
  return buildFocusTargetCss(focusValues(intensity));
}

function resolveFocusProfile({ safeDowngrade, pageType }) {
  if (HIGH_RISK_PAGE_TYPES.has(pageType)) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
      buildCss: buildFocusOnlyCss,
    };
  }

  if (READING_PAGE_TYPES.has(pageType)) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.READING_LINKS,
      buildCss: buildReadingLinksCss,
    };
  }

  if (SEARCH_PAGE_TYPES.has(pageType)) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.SEARCH_LINKS,
      buildCss: buildSearchLinksCss,
    };
  }

  if (CARD_PAGE_TYPES.has(pageType)) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.CARD_FOCUS,
      buildCss: buildCardFocusCss,
    };
  }

  if (FORM_PAGE_TYPES.has(pageType)) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.FORM_FOCUS,
      buildCss: buildFocusOnlyCss,
    };
  }

  if (safeDowngrade === 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION') {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.READING_LINKS,
      buildCss: buildReadingLinksCss,
    };
  }

  if (safeDowngrade === 'SAFE_RESULT_FOCUS_TARGETS') {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.SEARCH_LINKS,
      buildCss: buildSearchLinksCss,
    };
  }

  if (safeDowngrade === 'SAFE_PRODUCT_FOCUS_TARGETS' || safeDowngrade === 'SAFE_FEED_FOCUS_VISIBLE') {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.CARD_FOCUS,
      buildCss: buildCardFocusCss,
    };
  }

  if (safeDowngrade === 'SAFE_FORM_FOCUS_TARGETS') {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.FORM_FOCUS,
      buildCss: buildFocusOnlyCss,
    };
  }

  if (
    safeDowngrade === 'SAFE_DASHBOARD_FOCUS_VISIBLE'
    || safeDowngrade === 'SAFE_MEDIA_FOCUS_VISIBLE'
    || safeDowngrade === 'SAFE_APP_FOCUS_VISIBLE'
    || safeDowngrade === 'SAFE_GLOBAL_FOCUS_VISIBLE'
  ) {
    return {
      profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
      buildCss: buildFocusOnlyCss,
    };
  }

  return {
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    buildCss: buildFocusOnlyCss,
  };
}

export function isSupportedSafeDowngradeCss({ modeId, safeDowngrade } = {}) {
  return modeId === MODE_IDS.FOCUS && FOCUS_SAFE_DOWNGRADE_SET.has(safeDowngrade);
}

export function buildSafeDowngradeCss({ modeId, safeDowngrade, pageType, intensity } = {}) {
  if (!isSupportedSafeDowngradeCss({ modeId, safeDowngrade })) {
    return {
      ok: false,
      reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
    };
  }
  const normalizedPageType = typeof pageType === 'string' ? pageType : 'UNKNOWN';
  const profile = resolveFocusProfile({ safeDowngrade, pageType: normalizedPageType });

  return {
    ok: true,
    cssText: profile.buildCss(intensity),
    profileId: profile.profileId,
    safeDowngrade,
    pageType: normalizedPageType,
  };
}
