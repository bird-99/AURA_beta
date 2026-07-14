import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  PAGE_CLARITY_CSS_PROFILE_IDS,
  PAGE_CLARITY_CSS_REASONS,
  buildPageClarityCssV1,
} from '../../background/page-clarity-css.js';
import {
  ADAPTATION_ACTION_IDS,
  CAPABILITY_STATUSES,
  EFFECT_CLASSES,
  PAGE_TYPES,
  SUPPORT_LEVELS,
  TARGET_KINDS,
  evaluateRuntimeCapabilityV1,
} from '../../shared/engine-core/index.js';
import { MODE_IDS } from '../../shared/constants.js';

const searchProfile = Object.freeze({
  actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
  pageType: PAGE_TYPES.SEARCH,
  targetKind: TARGET_KINDS.RECORD_REGION,
  effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY,
  desiredEffect: 'PAGE_CLARITY_RESULTS_TEXT_LINK_HIERARCHY_SHADOW',
  intensity: 0.7,
});

const formProfile = Object.freeze({
  actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
  pageType: PAGE_TYPES.FORM,
  targetKind: TARGET_KINDS.FORM_REGION,
  effectClass: EFFECT_CLASSES.FORM_LABEL_CLARITY,
  desiredEffect: 'PAGE_CLARITY_FORM_LABEL_CLARITY_SHADOW',
  intensity: 0.7,
});

const FORBIDDEN_PROPERTIES = Object.freeze([
  'display',
  'position',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'padding',
  'opacity',
  'filter',
  'transform',
  'pointer-events',
  'animation',
  'transition',
  'z-index',
  'overflow',
  'visibility',
  'content',
]);

function unsupportedResult(result) {
  assert.deepEqual(result, {
    ok: false,
    reason: PAGE_CLARITY_CSS_REASONS.UNSUPPORTED_PAGE_CLARITY_PROFILE,
  });
}

function cssRules(cssText) {
  return [...cssText.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2].trim(),
  }));
}

function assertGuardrailCss(cssText) {
  assert.equal(typeof cssText, 'string');
  assert.notEqual(cssText.trim(), '');
  assert.doesNotMatch(cssText, /!important/i);
  assert.doesNotMatch(cssText, /\bhttps?:\/\//i);
  assert.doesNotMatch(cssText, /\b(?:nodeType|tagName|textContent|innerHTML|outerHTML|selector|cssSelector)\b/);
  assert.doesNotMatch(cssText, /(?:^|[,{]\s*)(?:html|body)\b/i);

  for (const property of FORBIDDEN_PROPERTIES) {
    const escaped = property.replace('-', '\\-');
    assert.doesNotMatch(cssText, new RegExp(`(?:^|[;{]\\s*)${escaped}\\s*:`, 'i'), property);
  }

  for (const rule of cssRules(cssText)) {
    assert.match(rule.selector, /\[data-aura-page-clarity="1"\]/);
  }
}

test('PAGE_CLARITY SEARCH profile returns scoped non-empty CSS and profileId', () => {
  const result = buildPageClarityCssV1(searchProfile);

  assert.equal(result.ok, true);
  assert.equal(result.profileId, PAGE_CLARITY_CSS_PROFILE_IDS.SEARCH_RECORD_CARD);
  assertGuardrailCss(result.cssText);
});

test('PAGE_CLARITY FORM profile returns scoped non-empty CSS and profileId', () => {
  const result = buildPageClarityCssV1(formProfile);

  assert.equal(result.ok, true);
  assert.equal(result.profileId, PAGE_CLARITY_CSS_PROFILE_IDS.FORM_LABEL);
  assertGuardrailCss(result.cssText);
});

test('PAGE_CLARITY builder supports only SEARCH and FORM first profiles', () => {
  const unsupportedPages = [
    PAGE_TYPES.ARTICLE,
    PAGE_TYPES.DOC,
    PAGE_TYPES.SHOP,
    PAGE_TYPES.FEED,
    PAGE_TYPES.DASHBOARD,
    PAGE_TYPES.VIDEO,
    PAGE_TYPES.WEB_APP,
    PAGE_TYPES.UNKNOWN,
  ];

  for (const pageType of unsupportedPages) {
    unsupportedResult(buildPageClarityCssV1({ ...searchProfile, pageType }));
  }

  unsupportedResult(buildPageClarityCssV1({ ...searchProfile, targetKind: TARGET_KINDS.FORM_REGION }));
  unsupportedResult(buildPageClarityCssV1({ ...formProfile, effectClass: EFFECT_CLASSES.RECORD_CARD_CLARITY }));
  unsupportedResult(buildPageClarityCssV1({ ...formProfile, desiredEffect: 'PAGE_CLARITY_SAFE_ABSTAIN' }));
});

test('PAGE_CLARITY builder rejects non PAGE_CLARITY actions', () => {
  unsupportedResult(buildPageClarityCssV1({
    ...searchProfile,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
  }));
  unsupportedResult(buildPageClarityCssV1({
    ...formProfile,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
  }));
});

test('SEARCH CSS contains passive visible clarity effects', () => {
  const result = buildPageClarityCssV1(searchProfile);
  assert.equal(result.ok, true);

  const passiveRule = cssRules(result.cssText).find((rule) => !rule.selector.includes(':focus'));
  assert.ok(passiveRule, 'search profile should include a passive rule');
  assert.match(passiveRule.declarations, /outline-style:\s*solid/i);
  assert.match(passiveRule.declarations, /outline-width:\s*1px/i);
  assert.match(passiveRule.declarations, /text-decoration-color:/i);
  assert.match(passiveRule.declarations, /text-decoration-line:\s*underline/i);
  assert.match(passiveRule.declarations, /background-color:\s*rgba\(250,\s*204,\s*21,\s*0\.[1-9][0-9]+\)/i);
  assert.match(passiveRule.declarations, /box-shadow:\s*0 0 0 1px rgba\(15,\s*98,\s*254,\s*0\.[1-9][0-9]+\)/i);
});

test('FORM CSS keeps border-color limited to focus states', () => {
  const result = buildPageClarityCssV1(formProfile);
  assert.equal(result.ok, true);

  const borderRules = cssRules(result.cssText).filter((rule) => /border-color\s*:/i.test(rule.declarations));
  assert.notEqual(borderRules.length, 0);
  for (const rule of borderRules) {
    assert.match(rule.selector, /:focus/);
    assert.match(rule.selector, /input|select|textarea|button|\[role="checkbox"\]|\[role="radio"\]/);
  }
});

test('FORM CSS includes passive label and input clarity without layout properties', () => {
  const result = buildPageClarityCssV1(formProfile);
  assert.equal(result.ok, true);

  const passiveRules = cssRules(result.cssText).filter((rule) => !rule.selector.includes(':focus'));
  assert.ok(passiveRules.some((rule) => /text-decoration-line:\s*underline/i.test(rule.declarations)));
  assert.ok(passiveRules.some((rule) => /box-shadow:\s*0 0 0 1px rgba\(15,\s*98,\s*254,\s*0\.[1-9][0-9]+\)/i.test(rule.declarations)));
});

test('RuntimeCapabilityMatrix enables PAGE_CLARITY first SEARCH and FORM profiles', () => {
  for (const profile of [searchProfile, formProfile]) {
    const decision = evaluateRuntimeCapabilityV1({
      modeId: MODE_IDS.COMFORT_VISUAL,
      ...profile,
    });

    assert.equal(decision.status, CAPABILITY_STATUSES.SUPPORTED);
    assert.equal(decision.supportLevel, SUPPORT_LEVELS.ACTIVE_RUNTIME);
    assert.equal(decision.executor, 'REGION_CLASS_TOKENS');
    assert.equal(decision.activePlanAllowed, true);
    assert.equal(decision.reason, 'PAGE_CLARITY_RUNTIME_SUPPORTED');
    assert.equal(decision.learningEligible, false);
  }
});

test('css-applier imports PAGE_CLARITY builder only for guarded runtime integration', async () => {
  const source = await fs.readFile(path.join(process.cwd(), 'background', 'css-applier.js'), 'utf8');

  assert.equal(source.includes('page-clarity-css'), true);
  assert.equal(source.includes('buildPageClarityCssV1'), true);
  assert.equal(source.includes('PAGE_CLARITY_LIMITED_VARIANT'), true);
  assert.equal(source.includes('PAGE_SIGNALS_COLLECT_V1'), false);
});
