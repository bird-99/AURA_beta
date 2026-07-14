import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  ADAPTATION_ACTION_ID_VALUES,
  PAGE_TYPE_VALUES,
  PROBLEM_CODE_VALUES,
  REASON_CODE_VALUES,
  validateCollectedPageSignalsV1,
  validateObservedNodeSignalsV2,
  validatePrivacySafeJson,
} from '../../shared/engine-core/index.js';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'page-intelligence');
const FORBIDDEN_FIXTURE_KEYS = Object.freeze([
  'selector',
  'cssSelector',
  'xpath',
  'rawText',
  'textContent',
  'innerHTML',
  'outerHTML',
  'pageUrl',
  'fullUrl',
  'href',
  'src',
  'routeFingerprint',
]);
const FORBIDDEN_FIXTURE_STRINGS = Object.freeze([
  /\bhttps?:\/\//i,
  /\/private/i,
  /PRIVATE_/i,
  /\?/,
  /#/,
  /\s/,
]);
const REQUIRED_OBSERVED_V2_FIXTURES = Object.freeze([
  'article',
  'doc',
  'search-results',
  'product-grid',
  'form-simple',
  'form',
  'feed',
  'dashboard',
  'video-watch',
  'unknown-shell-nomodal',
]);

function readFixtures() {
  return fs.readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.signals.v1.json'))
    .map((file) => {
      const filePath = path.join(fixtureDir, file);
      return {
        file,
        payload: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      };
    });
}

function collectFixturePrivacyErrors(value, file, errors, trail = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectFixturePrivacyErrors(entry, file, errors, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      for (const pattern of FORBIDDEN_FIXTURE_STRINGS) {
        if (pattern.test(value)) {
          errors.push(`${file} ${trail} contains forbidden string pattern ${pattern}`);
        }
      }
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const nextTrail = `${trail}.${key}`;
    if (FORBIDDEN_FIXTURE_KEYS.includes(key)) {
      errors.push(`${file} ${nextTrail} uses forbidden fixture key ${key}`);
    }
    collectFixturePrivacyErrors(entry, file, errors, nextTrail);
  }
}

test('page-intelligence fixtures are plain JSON CollectedPageSignalsV1 payloads', () => {
  const fixtures = readFixtures();
  assert.equal(fixtures.length >= 6, true, 'PR1 should include at least six representative fixtures');

  for (const { file, payload } of fixtures) {
    assert.equal(typeof payload.name, 'string', `${file} should have a name`);
    assert.equal(validatePrivacySafeJson(payload).ok, true, `${file} should be privacy-safe JSON`);

    const validation = validateCollectedPageSignalsV1(payload.input);
    assert.equal(
      validation.ok,
      true,
      `${file} input failed validation: ${validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`,
    );
  }
});

test('representative page-intelligence fixtures include valid ObservedNodeSignalsV2 enrichment', () => {
  const byName = new Map(readFixtures().map(({ payload }) => [payload.name, payload]));

  for (const name of REQUIRED_OBSERVED_V2_FIXTURES) {
    const payload = byName.get(name);
    assert.ok(payload, `${name} fixture should exist`);
    assert.ok(payload.input.observedNodeSignalsV2, `${name} should include ObservedNodeSignalsV2`);

    const validation = validateObservedNodeSignalsV2(payload.input.observedNodeSignalsV2);
    assert.equal(
      validation.ok,
      true,
      `${name} ObservedNodeSignalsV2 failed validation: ${validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`,
    );
    assert.equal(
      payload.input.observedNodeSignalsV2.blockSignals.length <= payload.input.blocks.length,
      true,
      `${name} should not retain more V2 block signals than V1 blocks`,
    );
  }
});

test('fixture expectations declare executable router, contract and policy expectations', () => {
  for (const { file, payload } of readFixtures()) {
    assert.equal(PAGE_TYPE_VALUES.includes(payload.expected?.pageType), true, `${file} expected pageType must be known`);

    for (const action of payload.expected?.allowedActions || []) {
      assert.equal(ADAPTATION_ACTION_ID_VALUES.includes(action), true, `${file} allowed action ${action} must be known`);
    }
    for (const action of payload.expected?.deniedActions || []) {
      assert.equal(ADAPTATION_ACTION_ID_VALUES.includes(action), true, `${file} denied action ${action} must be known`);
    }
    for (const reason of payload.expected?.requiredReasons || []) {
      assert.equal(REASON_CODE_VALUES.includes(reason), true, `${file} reason ${reason} must be known`);
    }
    for (const problem of payload.expected?.requiredProblems || []) {
      assert.equal(PROBLEM_CODE_VALUES.includes(problem), true, `${file} problem ${problem} must be known`);
    }
    for (const problem of payload.expected?.forbiddenProblems || []) {
      assert.equal(PROBLEM_CODE_VALUES.includes(problem), true, `${file} forbidden problem ${problem} must be known`);
    }
    for (const reason of payload.expected?.forbiddenReasons || []) {
      assert.equal(REASON_CODE_VALUES.includes(reason), true, `${file} forbidden reason ${reason} must be known`);
    }

    assert.equal(typeof payload.expected?.riskBands, 'object', `${file} should declare risk band expectations`);
    assert.equal(typeof payload.expected?.minConfidence, 'number', `${file} should declare minConfidence`);
    assert.equal(typeof payload.expected?.maxConfidence, 'number', `${file} should declare maxConfidence`);
    assert.equal(
      payload.expected.selectedScopeBlockId === null || typeof payload.expected.selectedScopeBlockId === 'string',
      true,
      `${file} should declare selectedScopeBlockId as string or null`,
    );
  }
});

test('page-intelligence fixtures do not smuggle live URLs, selectors or raw text', () => {
  const errors = [];
  for (const { file, payload } of readFixtures()) {
    collectFixturePrivacyErrors(payload, file, errors);
  }

  assert.deepEqual(errors, []);
});

test('each introduced reason code is exercised by at least one fixture or test fixture expectation', () => {
  const usedReasons = new Set();
  for (const { payload } of readFixtures()) {
    for (const block of payload.input.blocks || []) {
      for (const reason of block.flags || []) {
        usedReasons.add(reason);
      }
    }
    for (const reason of payload.expected?.requiredReasons || []) {
      usedReasons.add(reason);
    }
  }

  for (const reason of REASON_CODE_VALUES) {
    assert.equal(usedReasons.has(reason), true, `${reason} should be represented in PR1 fixtures`);
  }
});
