// shared/engine-core/guaranteed-effect-matrix.js

import {
  PAGE_TYPES,
  PAGE_TYPE_VALUES,
  POST_APPLY_CHECK_CODES,
  POST_APPLY_CHECK_CODE_VALUES,
} from './enums.js';

export const GUARANTEED_EFFECT_MATRIX_VERSION = 1;

export const GUARANTEED_EFFECT_MODE_IDS = Object.freeze({
  COMFORT_VISUAL: 'comfort-visual',
  FOCUS: 'focus',
});

export const EFFECT_STRENGTHS = Object.freeze({
  STRONG: 'STRONG',
  SAFE_DOWNGRADE: 'SAFE_DOWNGRADE',
});

const BASE_POST_CHECKS = Object.freeze([
  POST_APPLY_CHECK_CODES.HORIZONTAL_SCROLL,
  POST_APPLY_CHECK_CODES.CLIPPED_TEXT,
  POST_APPLY_CHECK_CODES.HIDDEN_SCOPE,
  POST_APPLY_CHECK_CODES.CONTROL_OCCLUDED,
]);

const FOCUS_POST_CHECKS = Object.freeze([
  POST_APPLY_CHECK_CODES.HORIZONTAL_SCROLL,
  POST_APPLY_CHECK_CODES.FOCUS_LOST,
  POST_APPLY_CHECK_CODES.CONTROL_OCCLUDED,
  POST_APPLY_CHECK_CODES.HIDDEN_SCOPE,
]);

/**
 * @param {{
 *   modeId: string,
 *   pageType: string,
 *   strongEffect: string,
 *   safeDowngrade: string,
 *   readerAllowed?: boolean,
 *   overrideAllowed?: boolean,
 *   postChecks?: readonly string[],
 * }} config
 */
function entry({
  modeId,
  pageType,
  strongEffect,
  safeDowngrade,
  readerAllowed = false,
  overrideAllowed = true,
  postChecks,
}) {
  const checks = Array.isArray(postChecks) ? postChecks : BASE_POST_CHECKS;

  return Object.freeze({
    version: GUARANTEED_EFFECT_MATRIX_VERSION,
    modeId,
    pageType,
    strongEffect,
    safeDowngrade,
    readerAllowed,
    overrideAllowed,
    overrideScope: overrideAllowed ? 'TAB_SESSION' : 'NONE',
    postChecks: [...checks],
    limitedLabelOnDowngrade: true,
  });
}

const COMFORT = GUARANTEED_EFFECT_MODE_IDS.COMFORT_VISUAL;
const FOCUS = GUARANTEED_EFFECT_MODE_IDS.FOCUS;

export const GUARANTEED_EFFECT_MATRIX_V1 = Object.freeze([
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.ARTICLE,
    strongEffect: 'SCOPED_STRONG_READING_TRANSFORM',
    safeDowngrade: 'SAFE_READING_TEXT_LINK_CLARITY',
    readerAllowed: true,
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.DOC,
    strongEffect: 'SCOPED_STRONG_DOC_READING_TRANSFORM',
    safeDowngrade: 'SAFE_DOC_TEXT_LINK_CLARITY',
    readerAllowed: true,
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.SEARCH,
    strongEffect: 'RESULTS_TEXT_LINK_HIERARCHY',
    safeDowngrade: 'SAFE_RESULTS_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.SHOP,
    strongEffect: 'PRODUCT_CARD_TEXT_LINK_HIERARCHY',
    safeDowngrade: 'SAFE_PRODUCT_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.FORM,
    strongEffect: 'FORM_LABEL_CONTRAST_CLARITY',
    safeDowngrade: 'SAFE_FORM_TEXT_LABEL_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.DASHBOARD,
    strongEffect: 'DASHBOARD_TEXT_CONTRAST_DENSITY_CLARITY',
    safeDowngrade: 'SAFE_DASHBOARD_TEXT_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.VIDEO,
    strongEffect: 'MEDIA_PAGE_TEXT_CONTROL_CLARITY',
    safeDowngrade: 'SAFE_MEDIA_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.FEED,
    strongEffect: 'FEED_CARD_TEXT_HIERARCHY',
    safeDowngrade: 'SAFE_FEED_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.WEB_APP,
    strongEffect: 'APP_UI_TEXT_CONTRAST_CLARITY',
    safeDowngrade: 'SAFE_APP_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: COMFORT,
    pageType: PAGE_TYPES.UNKNOWN,
    strongEffect: 'GLOBAL_VISIBLE_TEXT_LINK_CLARITY',
    safeDowngrade: 'SAFE_GLOBAL_TEXT_LINK_CLARITY',
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.ARTICLE,
    strongEffect: 'READING_SURROUNDINGS_DECLUTTER',
    safeDowngrade: 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.DOC,
    strongEffect: 'DOC_SURROUNDINGS_DECLUTTER',
    safeDowngrade: 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.SEARCH,
    strongEffect: 'SEARCH_RESULT_DISTRACTION_DIMMING',
    safeDowngrade: 'SAFE_RESULT_FOCUS_TARGETS',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.SHOP,
    strongEffect: 'PRODUCT_GRID_DISTRACTION_DIMMING',
    safeDowngrade: 'SAFE_PRODUCT_FOCUS_TARGETS',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.FORM,
    strongEffect: 'FORM_FIELD_FOCUS_TARGETS',
    safeDowngrade: 'SAFE_FORM_FOCUS_TARGETS',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.DASHBOARD,
    strongEffect: 'DASHBOARD_PANEL_FOCUS_CLARITY',
    safeDowngrade: 'SAFE_DASHBOARD_FOCUS_VISIBLE',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.VIDEO,
    strongEffect: 'MEDIA_CONTROL_FOCUS_AND_DISTRACTION_DIMMING',
    safeDowngrade: 'SAFE_MEDIA_FOCUS_VISIBLE',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.FEED,
    strongEffect: 'FEED_CARD_DISTRACTION_DIMMING',
    safeDowngrade: 'SAFE_FEED_FOCUS_VISIBLE',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.WEB_APP,
    strongEffect: 'APP_FOCUS_PATH_DECLUTTER',
    safeDowngrade: 'SAFE_APP_FOCUS_VISIBLE',
    postChecks: FOCUS_POST_CHECKS,
  }),
  entry({
    modeId: FOCUS,
    pageType: PAGE_TYPES.UNKNOWN,
    strongEffect: 'UNKNOWN_PAGE_DIM_AND_CLARIFY',
    safeDowngrade: 'SAFE_GLOBAL_FOCUS_VISIBLE',
    postChecks: FOCUS_POST_CHECKS,
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getGuaranteedEffectMatrixV1() {
  return clone(GUARANTEED_EFFECT_MATRIX_V1);
}

export function getGuaranteedEffectV1(modeId, pageType) {
  const found = GUARANTEED_EFFECT_MATRIX_V1.find(
    (item) => item.modeId === modeId && item.pageType === pageType,
  );
  return found ? clone(found) : null;
}

export function validateGuaranteedEffectMatrixV1(matrix = GUARANTEED_EFFECT_MATRIX_V1) {
  const errors = [];
  const entries = Array.isArray(matrix) ? matrix : [];
  const modes = Object.values(GUARANTEED_EFFECT_MODE_IDS);
  const seen = new Set();

  for (const modeId of modes) {
    for (const pageType of PAGE_TYPE_VALUES) {
      const key = `${modeId}:${pageType}`;
      const matches = entries.filter((item) => item?.modeId === modeId && item?.pageType === pageType);
      if (matches.length !== 1) {
        errors.push(`Expected exactly one effect contract for ${key}`);
      }
    }
  }

  for (const item of entries) {
    const key = `${item?.modeId}:${item?.pageType}`;
    if (seen.has(key)) {
      errors.push(`Duplicate effect contract for ${key}`);
    }
    seen.add(key);
    if (!modes.includes(item?.modeId)) {
      errors.push(`Unknown modeId ${item?.modeId}`);
    }
    if (!PAGE_TYPE_VALUES.includes(item?.pageType)) {
      errors.push(`Unknown pageType ${item?.pageType}`);
    }
    if (item?.version !== GUARANTEED_EFFECT_MATRIX_VERSION) {
      errors.push(`Invalid version for ${key}`);
    }
    if (typeof item?.strongEffect !== 'string' || !item.strongEffect) {
      errors.push(`Missing strongEffect for ${key}`);
    }
    if (typeof item?.safeDowngrade !== 'string' || !item.safeDowngrade) {
      errors.push(`Missing safeDowngrade for ${key}`);
    }
    if (!Array.isArray(item?.postChecks) || item.postChecks.length === 0) {
      errors.push(`Missing postChecks for ${key}`);
    } else {
      item.postChecks.forEach((check) => {
        if (!POST_APPLY_CHECK_CODE_VALUES.includes(check)) {
          errors.push(`Unknown postCheck ${check} for ${key}`);
        }
      });
    }
    if (item?.overrideAllowed === true && item?.overrideScope !== 'TAB_SESSION') {
      errors.push(`Override must stay tab-session scoped for ${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
