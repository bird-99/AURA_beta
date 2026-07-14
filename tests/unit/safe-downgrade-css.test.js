import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FOCUS_SAFE_DOWNGRADE_PROFILE_IDS,
  FOCUS_SAFE_DOWNGRADES,
  SAFE_DOWNGRADE_CSS_REASONS,
  buildSafeDowngradeCss,
} from '../../background/safe-downgrade-css.js';
import { MODE_IDS } from '../../shared/constants.js';
import { guardCss } from '../../shared/mode-engine-css-guard.js';

const BANNED_CSS_PATTERNS = Object.freeze([
  /\bdisplay\s*:/,
  /\bposition\s*:/,
  /(^|[;{\s])width\s*:/,
  /(^|[;{\s])height\s*:/,
  /\bopacity\s*:/,
  /\bfilter\s*:/,
  /\btransform\s*:/,
  /\bpointer-events\s*:/,
  /\banimation(?:-[a-z]+)?\s*:/,
  /\btransition(?:-[a-z]+)?\s*:/,
  /!important/,
]);

const FOCUS_PROFILE_CASES = Object.freeze([
  {
    safeDowngrade: 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
    pageType: 'ARTICLE',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.READING_LINKS,
    passiveUnderline: true,
  },
  {
    safeDowngrade: 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
    pageType: 'DOC',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.READING_LINKS,
    passiveUnderline: true,
  },
  {
    safeDowngrade: 'SAFE_RESULT_FOCUS_TARGETS',
    pageType: 'SEARCH',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.SEARCH_LINKS,
    passiveUnderline: true,
  },
  {
    safeDowngrade: 'SAFE_PRODUCT_FOCUS_TARGETS',
    pageType: 'SHOP',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.CARD_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_FORM_FOCUS_TARGETS',
    pageType: 'FORM',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.FORM_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_DASHBOARD_FOCUS_VISIBLE',
    pageType: 'DASHBOARD',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_MEDIA_FOCUS_VISIBLE',
    pageType: 'VIDEO',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_FEED_FOCUS_VISIBLE',
    pageType: 'FEED',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.CARD_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_APP_FOCUS_VISIBLE',
    pageType: 'WEB_APP',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    passiveUnderline: false,
  },
  {
    safeDowngrade: 'SAFE_GLOBAL_FOCUS_VISIBLE',
    pageType: 'UNKNOWN',
    profileId: FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS,
    passiveUnderline: false,
  },
]);

const PASSIVE_UNDERLINE_RE = /body a\[href\],\s*body \[role="link"\]\s*\{[^}]*text-decoration-line:\s*underline/s;

test('Focus safe downgrades produce page-aware guardrail-safe CSS profiles', () => {
  const coveredDowngrades = new Set();

  for (const testCase of FOCUS_PROFILE_CASES) {
    const { safeDowngrade, pageType, profileId, passiveUnderline } = testCase;
    coveredDowngrades.add(safeDowngrade);
    const result = buildSafeDowngradeCss({
      modeId: MODE_IDS.FOCUS,
      safeDowngrade,
      pageType,
      intensity: 1,
    });

    assert.equal(result.ok, true, safeDowngrade);
    assert.equal(result.profileId, profileId, safeDowngrade);
    assert.equal(typeof result.cssText, 'string', safeDowngrade);
    assert.ok(result.cssText.trim().length > 0, safeDowngrade);
    assert.equal(result.safeDowngrade, safeDowngrade);
    assert.equal(result.pageType, pageType, safeDowngrade);
    assert.match(result.cssText, /:focus-visible/, safeDowngrade);
    assert.match(result.cssText, /outline-color:/, safeDowngrade);
    assert.match(result.cssText, /outline-style:\s*solid/, safeDowngrade);
    assert.match(result.cssText, /outline-width:\s*\d+px/, safeDowngrade);
    assert.match(result.cssText, /accent-color:/, safeDowngrade);
    assert.match(result.cssText, /caret-color:/, safeDowngrade);

    if (passiveUnderline) {
      assert.match(result.cssText, PASSIVE_UNDERLINE_RE, `${safeDowngrade} passive underline`);
    } else {
      assert.doesNotMatch(result.cssText, PASSIVE_UNDERLINE_RE, `${safeDowngrade} no passive underline`);
    }

    const borderIndex = result.cssText.indexOf('border-color:');
    assert.notEqual(borderIndex, -1, `${safeDowngrade} border color exists`);
    assert.match(result.cssText.slice(Math.max(0, borderIndex - 420), borderIndex), /:focus/, `${safeDowngrade} border focus-only`);

    for (const pattern of BANNED_CSS_PATTERNS) {
      assert.doesNotMatch(result.cssText, pattern, `${safeDowngrade} ${pattern}`);
    }

    const guarded = guardCss({ cssText: result.cssText, scopeSelector: 'body' });
    assert.equal(guarded.ok, true, `${safeDowngrade} guard`);
    assert.ok(guarded.cssText.trim().length > 0, safeDowngrade);
  }

  assert.deepEqual([...coveredDowngrades].sort(), [...FOCUS_SAFE_DOWNGRADES].sort());
});

test('high-risk page types keep focus-only profile even with a lower-risk label', () => {
  const result = buildSafeDowngradeCss({
    modeId: MODE_IDS.FOCUS,
    safeDowngrade: 'SAFE_FOCUS_VISIBLE_REDUCE_MOTION',
    pageType: 'UNKNOWN',
    intensity: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.profileId, FOCUS_SAFE_DOWNGRADE_PROFILE_IDS.APP_FOCUS);
  assert.doesNotMatch(result.cssText, PASSIVE_UNDERLINE_RE);
});

test('safe downgrade CSS matrix rejects Comfort and unknown downgrade labels', () => {
  const comfort = buildSafeDowngradeCss({
    modeId: MODE_IDS.COMFORT_VISUAL,
    safeDowngrade: 'SAFE_READING_TEXT_LINK_CLARITY',
    pageType: 'ARTICLE',
    intensity: 1,
  });
  const unknown = buildSafeDowngradeCss({
    modeId: MODE_IDS.FOCUS,
    safeDowngrade: 'SAFE_NOT_REAL',
    pageType: 'UNKNOWN',
    intensity: 1,
  });

  assert.deepEqual(comfort, {
    ok: false,
    reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
  });
  assert.deepEqual(unknown, {
    ok: false,
    reason: SAFE_DOWNGRADE_CSS_REASONS.UNSUPPORTED_DOWNGRADE,
  });
});
