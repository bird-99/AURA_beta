import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_IDS,
  BLOCK_ROLES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  REASON_CODES,
  CONSERVATIVE_PERSONALIZATION_GATE_SOURCE,
  evaluateConservativePersonalizationGateV1,
  isConservativePersonalizationGateAllowedV1,
} from '../../shared/engine-core/index.js';

const TEMPLATE_HASH = 'tmh1_bbbbbbbbbbbbbbbbbbbbbb';
const DOMAIN_HASH = 'tmh1_aaaaaaaaaaaaaaaaaaaaaa';

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    pageTypeConfidence: 0.91,
    risk: { layoutRisk: 0.12, interactionRisk: 0.18, confidenceRisk: 0.08 },
    reasons: [REASON_CODES.ARTICLE_TEXT_DENSITY_HIGH],
    candidates: [],
    problems: [],
    stats: { elapsedMs: 2, nodesScanned: 10, candidatesSeen: 1, budgetHit: false },
    selectedScope: null,
    ...overrides,
  };
}

function entry(counterOverrides = {}, overrides = {}) {
  return {
    domainHash: DOMAIN_HASH,
    templateHash: TEMPLATE_HASH,
    pageType: PAGE_TYPES.ARTICLE,
    roleDistribution: [{ role: BLOCK_ROLES.ARTICLE, count: 2 }],
    riskBands: { layout: 'LOW', interaction: 'LOW', confidence: 'LOW' },
    scopeFingerprints: [],
    actionCounters: [{
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      postApplyPassedCount: 0,
      learningEligibleCount: 3,
      undoCount: 0,
      rollbackCount: 0,
      postApplyFailedCount: 0,
      neverOnSiteCount: 0,
      lastOutcomeEvent: OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE,
      lastOutcomeBucket: 100,
      ...counterOverrides,
    }],
    seenCount: 3,
    firstSeenBucket: 98,
    lastSeenBucket: 100,
    ...overrides,
  };
}

test('conservative personalization gate allows only same template/action with low live risk', () => {
  const gate = evaluateConservativePersonalizationGateV1(
    profile(),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );

  assert.equal(gate.version, 1);
  assert.equal(gate.source, CONSERVATIVE_PERSONALIZATION_GATE_SOURCE);
  assert.equal(gate.allowed, true);
  assert.equal(isConservativePersonalizationGateAllowedV1(gate), true);
  assert.deepEqual(gate.reasons, ['OK']);
  assert.equal(gate.constraints.denyOnly, true);
  assert.equal(gate.constraints.postApplyInspectionRequired, true);
});

test('conservative personalization gate validator rejects forged minimal gates', () => {
  assert.equal(isConservativePersonalizationGateAllowedV1({
    version: 1,
    source: CONSERVATIVE_PERSONALIZATION_GATE_SOURCE,
    allowed: true,
  }), false);

  const gate = evaluateConservativePersonalizationGateV1(
    profile(),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );
  const weakened = {
    ...gate,
    evidence: {
      ...gate.evidence,
      domainMatch: false,
    },
  };
  assert.equal(isConservativePersonalizationGateAllowedV1(weakened), false);
});

test('conservative personalization gate blocks unsafe page types unless explicit', () => {
  for (const pageType of [PAGE_TYPES.UNKNOWN, PAGE_TYPES.VIDEO, PAGE_TYPES.FORM, PAGE_TYPES.DASHBOARD]) {
    const gate = evaluateConservativePersonalizationGateV1(
      profile({ pageType }),
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      entry({}, { pageType }),
    );
    assert.equal(gate.allowed, false, `${pageType} should be denied by default`);
    assert.ok(gate.reasons.includes('PAGE_TYPE_NOT_ALLOWED'));
  }

  const explicit = evaluateConservativePersonalizationGateV1(
    profile({ pageType: PAGE_TYPES.VIDEO }),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry({}, { pageType: PAGE_TYPES.VIDEO }),
    { explicitlyAllowedPageTypes: [PAGE_TYPES.VIDEO] },
  );
  assert.equal(explicit.allowed, true);
});

test('conservative personalization gate requires current low-risk profile evidence', () => {
  const layout = evaluateConservativePersonalizationGateV1(
    profile({ risk: { layoutRisk: 0.25, interactionRisk: 0.1, confidenceRisk: 0.1 } }),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );
  assert.equal(layout.allowed, false);
  assert.ok(layout.reasons.includes('LAYOUT_RISK_TOO_HIGH'));

  const interaction = evaluateConservativePersonalizationGateV1(
    profile({ risk: { layoutRisk: 0.1, interactionRisk: 0.30, confidenceRisk: 0.1 } }),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );
  assert.equal(interaction.allowed, false);
  assert.ok(interaction.reasons.includes('INTERACTION_RISK_TOO_HIGH'));
});

test('conservative personalization gate blocks weak or negative counters', () => {
  const weak = evaluateConservativePersonalizationGateV1(
    profile(),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry({ learningEligibleCount: 2 }),
  );
  assert.equal(weak.allowed, false);
  assert.ok(weak.reasons.includes('INSUFFICIENT_ACCEPTS'));

  for (const [key, reason] of [
    ['undoCount', 'USER_UNDID_BLOCK'],
    ['rollbackCount', 'ROLLBACK_BLOCK'],
    ['postApplyFailedCount', 'POST_APPLY_FAILED_BLOCK'],
    ['neverOnSiteCount', 'NEVER_ON_SITE_BLOCK'],
  ]) {
    const blocked = evaluateConservativePersonalizationGateV1(
      profile(),
      ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      entry({ [key]: 1 }),
    );
    assert.equal(blocked.allowed, false, `${key} should block`);
    assert.ok(blocked.reasons.includes(reason));
  }
});

test('conservative personalization gate rejects template and action mismatches', () => {
  const mismatchedDomain = evaluateConservativePersonalizationGateV1(
    profile({ domainHash: 'tmh1_dddddddddddddddddddddd' }),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );
  assert.equal(mismatchedDomain.allowed, false);
  assert.ok(mismatchedDomain.reasons.includes('DOMAIN_MISMATCH'));

  const mismatchedTemplate = evaluateConservativePersonalizationGateV1(
    profile({ templateHash: 'tmh1_cccccccccccccccccccccc' }),
    ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    entry(),
  );
  assert.equal(mismatchedTemplate.allowed, false);
  assert.ok(mismatchedTemplate.reasons.includes('TEMPLATE_MISMATCH'));

  const missingCounter = evaluateConservativePersonalizationGateV1(
    profile(),
    ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
    entry(),
  );
  assert.equal(missingCounter.allowed, false);
  assert.ok(missingCounter.reasons.includes('MISSING_ACTION_COUNTER'));
});
