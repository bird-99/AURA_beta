import {
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  PAGE_TYPES,
  TARGET_KINDS,
} from '../shared/engine-core/enums.js';

export const PAGE_CLARITY_CSS_REASONS = Object.freeze({
  UNSUPPORTED_PAGE_CLARITY_PROFILE: 'UNSUPPORTED_PAGE_CLARITY_PROFILE',
});

export const PAGE_CLARITY_CSS_PROFILE_IDS = Object.freeze({
  SEARCH_RECORD_CARD: 'page-clarity-search-record-card-v1',
  FORM_LABEL: 'page-clarity-form-label-v1',
});

export const PAGE_CLARITY_SCOPE = '[data-aura-page-clarity="1"]';
const SEARCH_DESIRED_EFFECT = 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW';
const FORM_DESIRED_EFFECT = 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW';

function unsupported() {
  return {
    ok: false,
    reason: PAGE_CLARITY_CSS_REASONS.UNSUPPORTED_PAGE_CLARITY_PROFILE,
  };
}

function normalizeIntensity(intensity) {
  if (typeof intensity !== 'number' || !Number.isFinite(intensity)) {
    return 1;
  }
  return Math.min(Math.max(intensity, 0), 1);
}

function pageClarityValues(intensity) {
  const normalized = normalizeIntensity(intensity);
  const outlineAlpha = (0.5 + normalized * 0.18).toFixed(2);
  const tintAlpha = (0.16 + normalized * 0.10).toFixed(3);
  const shadowAlpha = (0.18 + normalized * 0.10).toFixed(2);
  return {
    underlineThickness: (0.11 + normalized * 0.04).toFixed(2),
    underlineOffset: (0.18 + normalized * 0.05).toFixed(2),
    outlineWidth: `${Math.round(1 + normalized)}px`,
    accentColor: '#0f62fe',
    inkColor: '#0f3d8c',
    outlineColor: `rgba(15, 98, 254, ${outlineAlpha})`,
    tintColor: `rgba(250, 204, 21, ${tintAlpha})`,
    shadowColor: `rgba(15, 98, 254, ${shadowAlpha})`,
  };
}

function buildSearchRecordCss(intensity) {
  const values = pageClarityValues(intensity);
  return `
    ${PAGE_CLARITY_SCOPE}[href],
    ${PAGE_CLARITY_SCOPE}[role="link"],
    ${PAGE_CLARITY_SCOPE} a[href],
    ${PAGE_CLARITY_SCOPE} [role="link"] {
      outline-color: ${values.outlineColor};
      outline-style: solid;
      outline-width: 1px;
      text-decoration-color: ${values.inkColor};
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-thickness: ${values.underlineThickness}em;
      text-underline-offset: ${values.underlineOffset}em;
      background-color: ${values.tintColor};
      box-shadow: 0 0 0 1px ${values.shadowColor};
      color: ${values.inkColor};
    }
    ${PAGE_CLARITY_SCOPE}[href]:focus,
    ${PAGE_CLARITY_SCOPE}[href]:focus-visible,
    ${PAGE_CLARITY_SCOPE}[role="link"]:focus,
    ${PAGE_CLARITY_SCOPE}[role="link"]:focus-visible,
    ${PAGE_CLARITY_SCOPE} a[href]:focus,
    ${PAGE_CLARITY_SCOPE} a[href]:focus-visible,
    ${PAGE_CLARITY_SCOPE} [role="link"]:focus,
    ${PAGE_CLARITY_SCOPE} [role="link"]:focus-visible {
      outline-color: ${values.accentColor};
      outline-style: solid;
      outline-width: ${values.outlineWidth};
      text-decoration-color: ${values.accentColor};
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-thickness: ${(0.1 + normalizeIntensity(intensity) * 0.03).toFixed(2)}em;
      text-underline-offset: ${values.underlineOffset}em;
    }
  `;
}

function buildFormLabelCss(intensity) {
  const values = pageClarityValues(intensity);
  return `
    label${PAGE_CLARITY_SCOPE},
    legend${PAGE_CLARITY_SCOPE},
    ${PAGE_CLARITY_SCOPE}[aria-label],
    ${PAGE_CLARITY_SCOPE} label,
    ${PAGE_CLARITY_SCOPE} legend,
    ${PAGE_CLARITY_SCOPE} [aria-label] {
      color: #1f2937;
      text-decoration-color: ${values.inkColor};
      text-decoration-line: underline;
      text-decoration-style: solid;
      text-decoration-thickness: ${values.underlineThickness}em;
      text-underline-offset: ${values.underlineOffset}em;
      background-color: ${values.tintColor};
      box-shadow: inset 0 -0.18em 0 ${values.tintColor};
    }
    input${PAGE_CLARITY_SCOPE},
    select${PAGE_CLARITY_SCOPE},
    textarea${PAGE_CLARITY_SCOPE},
    ${PAGE_CLARITY_SCOPE} input,
    ${PAGE_CLARITY_SCOPE} select,
    ${PAGE_CLARITY_SCOPE} textarea {
      outline-color: ${values.outlineColor};
      outline-style: solid;
      outline-width: 1px;
      caret-color: ${values.accentColor};
      accent-color: ${values.accentColor};
      box-shadow: 0 0 0 1px ${values.shadowColor};
    }
    input${PAGE_CLARITY_SCOPE}:focus,
    input${PAGE_CLARITY_SCOPE}:focus-visible,
    select${PAGE_CLARITY_SCOPE}:focus,
    select${PAGE_CLARITY_SCOPE}:focus-visible,
    textarea${PAGE_CLARITY_SCOPE}:focus,
    textarea${PAGE_CLARITY_SCOPE}:focus-visible,
    button${PAGE_CLARITY_SCOPE}:focus,
    button${PAGE_CLARITY_SCOPE}:focus-visible,
    ${PAGE_CLARITY_SCOPE}[role="checkbox"]:focus,
    ${PAGE_CLARITY_SCOPE}[role="checkbox"]:focus-visible,
    ${PAGE_CLARITY_SCOPE}[role="radio"]:focus,
    ${PAGE_CLARITY_SCOPE}[role="radio"]:focus-visible,
    ${PAGE_CLARITY_SCOPE} input:focus,
    ${PAGE_CLARITY_SCOPE} input:focus-visible,
    ${PAGE_CLARITY_SCOPE} select:focus,
    ${PAGE_CLARITY_SCOPE} select:focus-visible,
    ${PAGE_CLARITY_SCOPE} textarea:focus,
    ${PAGE_CLARITY_SCOPE} textarea:focus-visible,
    ${PAGE_CLARITY_SCOPE} button:focus,
    ${PAGE_CLARITY_SCOPE} button:focus-visible,
    ${PAGE_CLARITY_SCOPE} [role="checkbox"]:focus,
    ${PAGE_CLARITY_SCOPE} [role="checkbox"]:focus-visible,
    ${PAGE_CLARITY_SCOPE} [role="radio"]:focus,
    ${PAGE_CLARITY_SCOPE} [role="radio"]:focus-visible {
      outline-color: ${values.accentColor};
      outline-style: solid;
      outline-width: ${values.outlineWidth};
      border-color: ${values.accentColor};
      caret-color: ${values.accentColor};
      accent-color: ${values.accentColor};
    }
  `;
}

function isSearchRecordProfile(input) {
  return input.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
    && input.pageType === PAGE_TYPES.SEARCH
    && input.targetKind === TARGET_KINDS.RECORD_REGION
    && input.effectClass === EFFECT_CLASSES.RECORD_CARD_CLARITY
    && input.desiredEffect === SEARCH_DESIRED_EFFECT;
}

function isFormLabelProfile(input) {
  return input.actionId === ADAPTATION_ACTION_IDS.PAGE_CLARITY
    && input.pageType === PAGE_TYPES.FORM
    && input.targetKind === TARGET_KINDS.FORM_REGION
    && input.effectClass === EFFECT_CLASSES.FORM_LABEL_CLARITY
    && input.desiredEffect === FORM_DESIRED_EFFECT;
}

export function buildPageClarityCssV1(input = {}) {
  if (isSearchRecordProfile(input)) {
    return {
      ok: true,
      cssText: buildSearchRecordCss(input.intensity),
      profileId: PAGE_CLARITY_CSS_PROFILE_IDS.SEARCH_RECORD_CARD,
    };
  }

  if (isFormLabelProfile(input)) {
    return {
      ok: true,
      cssText: buildFormLabelCss(input.intensity),
      profileId: PAGE_CLARITY_CSS_PROFILE_IDS.FORM_LABEL,
    };
  }

  return unsupported();
}
