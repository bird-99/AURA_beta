import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createTemplateEvidenceV1,
  normalizeTemplateEvidenceV1,
  templateEvidenceForFrame,
  templateEvidenceForLedger,
  templateEvidenceForTemplateMemory,
} from '../../background/template-evidence.js';
import {
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  TARGET_KINDS,
} from '../../shared/engine-core/enums.js';

const DOMAIN_HASH = 'tmh1_dddddddddddddddddddddd';
const TEMPLATE_HASH = 'tmh1_eeeeeeeeeeeeeeeeeeeeee';
const PROFILE_HASH = 'shr1_profileprofileprof1';
const FOCUS_LEARNING_KEY = Object.freeze({
  modeId: 'focus',
  actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
  targetKind: TARGET_KINDS.READING_REGION,
  effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
  pageType: PAGE_TYPES.ARTICLE,
});

test('TemplateEvidenceV1 normalizes compact versioned template metadata', () => {
  const evidence = createTemplateEvidenceV1({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 0,
    profileHash: PROFILE_HASH,
    learningEffectKey: {
      modeId: 'comfort-visual',
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      targetKind: TARGET_KINDS.READING_REGION,
      effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
      pageType: PAGE_TYPES.ARTICLE,
    },
  });

  assert.deepEqual(evidence, {
    version: 1,
    source: 'TEMPLATE_EVIDENCE_V1',
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    frameId: 0,
    learningEffectKey: {
      modeId: 'comfort-visual',
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      targetKind: TARGET_KINDS.READING_REGION,
      effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
      pageType: PAGE_TYPES.ARTICLE,
    },
    profileHash: PROFILE_HASH,
  });
  assert.deepEqual(normalizeTemplateEvidenceV1({ ...evidence }), evidence);
});

test('TemplateEvidenceV1 rejects raw, unversioned or frame-unsafe evidence', () => {
  assert.equal(createTemplateEvidenceV1({
    templateHash: 'h123',
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
  }), null);
  assert.equal(createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: 'ARTICLE_PAGE',
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
  }), null);
  assert.equal(createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: -1,
  }), null);

  const withRawProfile = createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
    profileHash: 'https://example.com/private/path',
  });
  assert.equal(withRawProfile.profileHash, undefined);
  const withUnversionedProfile = createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
    profileHash: 'profile_hash_1',
  });
  assert.equal(withUnversionedProfile.profileHash, undefined);
});

test('TemplateEvidenceV1 creates separate ledger and template-memory views', () => {
  const evidence = createTemplateEvidenceV1({
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 2,
    profileHash: PROFILE_HASH,
    learningEffectKey: FOCUS_LEARNING_KEY,
  });

  assert.equal(templateEvidenceForFrame(evidence, 0), null);
  assert.deepEqual(templateEvidenceForFrame(evidence, 2), evidence);
  assert.deepEqual(templateEvidenceForLedger(evidence), {
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    profileHash: PROFILE_HASH,
    learningEffectKey: FOCUS_LEARNING_KEY,
  });
  assert.deepEqual(templateEvidenceForTemplateMemory(evidence, {
    siteKey: 'example.com',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  }), {
    siteKey: 'example.com',
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    learningEffectKey: FOCUS_LEARNING_KEY,
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
  });
});

test('TemplateEvidenceV1 ignores malformed or colliding learning effect keys', () => {
  const malformed = createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
    learningEffectKey: {
      modeId: 'focus',
      actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
      targetKind: 'selector',
      effectClass: EFFECT_CLASSES.FOCUS_VISIBLE_CLARITY,
      pageType: PAGE_TYPES.ARTICLE,
    },
  });
  assert.equal(malformed.learningEffectKey, undefined);

  const colliding = createTemplateEvidenceV1({
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    frameId: 0,
    learningEffectKey: {
      ...FOCUS_LEARNING_KEY,
      actionId: ADAPTATION_ACTION_IDS.PAGE_CLARITY,
    },
  });
  assert.equal(colliding.learningEffectKey, undefined);
});
