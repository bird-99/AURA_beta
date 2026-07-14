import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  MODE_IDS,
  STORAGE_KEYS,
} from '../../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  EFFECT_CLASSES,
  OUTCOME_LEDGER_EVENTS,
  PAGE_TYPES,
  TARGET_KINDS,
} from '../../shared/engine-core/enums.js';
import {
  OUTCOME_LEDGER_LIMIT,
  OUTCOME_LEDGER_TTL_MS,
  appendOutcomeLedgerEvent,
  clearOutcomeLedgerForTests,
  consumeEligibleLearningEvents,
  getOutcomeLedgerForTests,
  recordAcceptedApplyOutcome,
  recordUserOutcome,
} from '../../background/outcome-ledger.js';

function setupChromeStorage() {
  const sessionStore = new Map();
  global.chrome = {
    storage: {
      session: {
        async get(key) {
          return { [key]: sessionStore.get(key) };
        },
        async set(data) {
          Object.entries(data).forEach(([key, value]) => {
            sessionStore.set(key, value);
          });
        },
      },
    },
  };
  return sessionStore;
}

afterEach(() => {
  delete global.chrome;
});

test('outcome ledger deduplicates lifecycle events by attempt and event', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const event = {
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'lifecycle-op-1',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    timestampMs: Date.now(),
  };

  await appendOutcomeLedgerEvent(event);
  await appendOutcomeLedgerEvent({ ...event, timestampMs: event.timestampMs + 1 });

  const ledger = await getOutcomeLedgerForTests();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].attemptId, 'lifecycle-op-1');
});

test('outcome ledger promotes accepted post-apply after the undo window only once', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();

  await recordAcceptedApplyOutcome({
    siteKey: 'https://www.example.com/private/path?q=1',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-1',
    timestampMs: base,
    noUndoWindowMs: 90,
  });

  assert.deepEqual(
    await consumeEligibleLearningEvents({ siteKey: 'example.com', modeId: MODE_IDS.FOCUS, now: base + 89 }),
    [],
  );

  const decisions = await consumeEligibleLearningEvents({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    now: base + 90,
  });
  assert.deepEqual(decisions, [{
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    decision: 'ENABLED',
    attemptId: 'attempt-1',
  }]);

  assert.deepEqual(
    await consumeEligibleLearningEvents({ siteKey: 'example.com', modeId: MODE_IDS.FOCUS, now: base + 1000 }),
    [],
  );

  const serialized = JSON.stringify(await getOutcomeLedgerForTests());
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('/private/path'), false);
});

test('outcome ledger carries only versioned template metadata into eligible decisions', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();
  const templateHash = 'tmh1_eeeeeeeeeeeeeeeeeeeeee';
  const profileHash = 'shr1_profileprofileprof1';

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    attemptId: 'attempt-template',
    timestampMs: base,
    noUndoWindowMs: 10,
    profileHash,
    templateHash,
    pageType: PAGE_TYPES.ARTICLE,
  });

  const decisions = await consumeEligibleLearningEvents({
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    now: base + 10,
  });

  assert.deepEqual(decisions, [{
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    decision: 'ENABLED',
    attemptId: 'attempt-template',
    profileHash,
    templateHash,
    pageType: PAGE_TYPES.ARTICLE,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    learningEffectKey: {
      modeId: MODE_IDS.COMFORT_VISUAL,
      actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
      targetKind: TARGET_KINDS.READING_REGION,
      effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
      pageType: PAGE_TYPES.ARTICLE,
    },
  }]);

  const ledger = await getOutcomeLedgerForTests();
  const eligible = ledger.find((entry) => entry.event === OUTCOME_LEDGER_EVENTS.LEARNING_ELIGIBLE);
  assert.equal(eligible.profileHash, profileHash);
  assert.equal(eligible.templateHash, templateHash);
  assert.equal(eligible.pageType, PAGE_TYPES.ARTICLE);
  assert.deepEqual(eligible.learningEffectKey, {
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
    targetKind: TARGET_KINDS.READING_REGION,
    effectClass: EFFECT_CLASSES.SCOPED_READING_TYPOGRAPHY,
    pageType: PAGE_TYPES.ARTICLE,
  });
});

test('outcome ledger drops raw or unversioned template metadata', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-raw-template',
    timestampMs: Date.now(),
    profileHash: 'https://private.example/profile',
    templateHash: 'https://private.example/template',
    pageType: PAGE_TYPES.ARTICLE,
  });

  const ledger = await getOutcomeLedgerForTests();
  assert.equal(ledger.every((entry) => entry.profileHash === undefined), true);
  assert.equal(ledger.every((entry) => entry.templateHash === undefined), true);
  assert.equal(JSON.stringify(ledger).includes('https://private.example'), false);
});

test('outcome ledger rejects learning when the same attempt is undone', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    attemptId: 'attempt-undo',
    timestampMs: base,
    noUndoWindowMs: 10,
  });
  await recordUserOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    attemptId: 'attempt-undo',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    timestampMs: base + 5,
  });

  const decisions = await consumeEligibleLearningEvents({
    siteKey: 'example.com',
    modeId: MODE_IDS.COMFORT_VISUAL,
    now: base + 1000,
  });

  assert.deepEqual(decisions, []);
  const ledger = await getOutcomeLedgerForTests();
  assert.ok(ledger.some((entry) =>
    entry.event === OUTCOME_LEDGER_EVENTS.LEARNING_REJECTED &&
    entry.rejectionReason === 'USER_UNDID',
  ));
});

test('outcome ledger treats later undo as blocking even after attempt id changes', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-before-rehydrate',
    timestampMs: base,
    noUndoWindowMs: 10,
  });
  await recordUserOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'attempt-after-rehydrate',
    event: OUTCOME_LEDGER_EVENTS.USER_UNDID,
    timestampMs: base + 5,
  });

  const decisions = await consumeEligibleLearningEvents({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    now: base + 1000,
  });

  assert.deepEqual(decisions, []);
  const ledger = await getOutcomeLedgerForTests();
  assert.ok(ledger.some((entry) =>
    entry.event === OUTCOME_LEDGER_EVENTS.LEARNING_REJECTED &&
    entry.rejectionReason === 'USER_UNDID',
  ));
});

test('outcome ledger does not promote entries consumed after TTL expiry', async () => {
  setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const base = Date.now();

  await recordAcceptedApplyOutcome({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'expired-before-consume',
    timestampMs: base,
    noUndoWindowMs: 10,
  });

  const decisions = await consumeEligibleLearningEvents({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    now: base + OUTCOME_LEDGER_TTL_MS + 1000,
  });

  assert.deepEqual(decisions, []);
  assert.deepEqual(await getOutcomeLedgerForTests(), []);
});

test('outcome ledger is TTL and LRU bounded in session storage', async () => {
  const sessionStore = setupChromeStorage();
  await clearOutcomeLedgerForTests();
  const now = Date.now();

  await appendOutcomeLedgerEvent({
    siteKey: 'example.com',
    modeId: MODE_IDS.FOCUS,
    attemptId: 'expired',
    event: OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED,
    timestampMs: now - OUTCOME_LEDGER_TTL_MS - 1000,
  });

  for (let index = 0; index < OUTCOME_LEDGER_LIMIT + 5; index += 1) {
    await appendOutcomeLedgerEvent({
      siteKey: 'example.com',
      modeId: MODE_IDS.FOCUS,
      attemptId: `attempt-${index}`,
      event: OUTCOME_LEDGER_EVENTS.POST_APPLY_PASSED,
      timestampMs: now + index,
    });
  }

  const ledger = sessionStore.get(STORAGE_KEYS.OUTCOME_LEDGER_V1);
  assert.equal(ledger.length, OUTCOME_LEDGER_LIMIT);
  assert.equal(ledger.some((entry) => entry.attemptId === 'expired'), false);
  assert.equal(ledger[0].attemptId, 'attempt-5');
});
