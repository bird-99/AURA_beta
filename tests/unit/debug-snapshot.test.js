import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MODE_ENGINE_DIAGNOSTIC_KIND,
  MODE_ENGINE_DIAGNOSTIC_MAX_BYTES,
  buildModeEngineDiagnosticSnapshot,
} from '../../background/debug-snapshot.js';
import { ACTIVE_QUALITIES, MODE_IDS, STATES } from '../../shared/constants.js';

const found = (value) => ({ ok: true, status: 'found', value, error: null });
const missing = () => ({ ok: true, status: 'missing', value: null, error: null });
const failed = (message) => ({ ok: false, status: 'error', value: null, error: { message } });

test('ModeEngineDiagnosticSnapshotV1 exports only allowlisted diagnostics for the requested tab', () => {
  const tabId = 41;
  const diagnostic = buildModeEngineDiagnosticSnapshot({
    tabId,
    generatedAt: 1234,
    tabStateRead: found({
      [tabId]: {
        [MODE_IDS.FOCUS]: {
          state: STATES.ERROR,
          pendingDecision: false,
          activeQuality: ACTIVE_QUALITIES.SCOPED_V2_VERIFIED,
          cssId: 'css-safe-1',
          scopedV2: {
            cssId: 'css-safe-1',
            scopeSelector: 'main > article[data-private="TOP_SECRET_VALUE"]',
            tokenMap: { '--private': 'TOP_SECRET_VALUE' },
            preludeCssId: 'prelude-safe-1',
          },
        },
      },
      99: {
        [MODE_IDS.FOCUS]: { state: STATES.ACTIVE, cssId: 'OTHER_TAB_SECRET' },
      },
    }),
    cssRegistryRead: found({
      'css-safe-1': {
        cssId: 'css-safe-1',
        cssText: '.private { background: url(https://bank.example/private); } /* TOP_SECRET_VALUE */',
        origin: 'AUTHOR',
        meta: { scopeKey: 'main > article[data-private]', documentId: 'doc-secret' },
      },
      'prelude-safe-1': {
        cssId: 'prelude-safe-1',
        cssText: 'html { --password: TOP_SECRET_VALUE; }',
        origin: 'AUTHOR',
      },
    }),
    lifecycleRead: {
      ok: true,
      status: 'found',
      slot: {
        generation: 7,
        desired: {
          generation: 7,
          kind: 'REMOVE',
          modeId: MODE_IDS.FOCUS,
          targetState: STATES.INACTIVE,
          urlKey: 'https://bank.example/private',
          documentInstanceId: 'doc-secret',
          chromeDocumentId: 'chrome-doc-secret',
        },
        running: {
          generation: 7,
          kind: 'REMOVE',
          modeId: MODE_IDS.FOCUS,
          phase: 'RETRYABLE',
          interruptedPhase: 'MUTATING',
          recoveryAttempts: 2,
          lastError: { message: 'password=TOP_SECRET_VALUE' },
          beforeState: { selector: 'main > article[data-private]' },
          artifacts: [{
            kind: 'CSS_REMOVE',
            status: 'PLANNED',
            cleanup: { cssText: '.private{}', selector: 'main > article', token: 'TOP_SECRET_VALUE' },
          }],
        },
      },
      error: null,
    },
    signalSnapshot: {
      tabId,
      byType: {
        zoom: { value: 1.5, confidence: 0.9, ts: 100, source: 'browser' },
        privateTitle: { value: 'PrivateName', confidence: 0.4, ts: 101, source: 'content' },
      },
    },
    signals: [
      {
        tabId,
        type: 'zoom',
        value: { safe: 1, 'TOP SECRET PROPERTY': 'plain private page title' },
        confidence: 0.9,
        ts: 100,
        source: 'browser',
      },
      { tabId: 99, type: 'zoom', value: 'OTHER_TAB_SECRET', confidence: 1, ts: 100, source: 'browser' },
    ],
    decisions: [{
      tabId,
      decision: 'NOOP',
      modeId: MODE_IDS.FOCUS,
      score: 0.4,
      reasonCodes: ['BELOW_THRESHOLD'],
      rawTitle: 'TOP_SECRET_VALUE',
    }],
  });

  assert.equal(diagnostic.kind, MODE_ENGINE_DIAGNOSTIC_KIND);
  assert.equal(diagnostic.schemaVersion, 1);
  assert.deepEqual(diagnostic.target, { tabId });
  assert.equal(diagnostic.storage.modeState.status, 'found');
  assert.equal(diagnostic.modeState[0].state, STATES.ERROR);
  assert.deepEqual(
    diagnostic.cssRegistry.referenced.map(({ kind, present }) => ({ kind, present })),
    [
      { kind: 'css', present: true },
      { kind: 'scopedV2.css', present: true },
      { kind: 'scopedV2.preludeCss', present: true },
    ],
  );
  assert.equal(diagnostic.lifecycle.running.phase, 'RETRYABLE');
  assert.equal(diagnostic.lifecycle.running.artifacts[0].kind, 'CSS_REMOVE');
  assert.equal(diagnostic.lifecycle.running.lastError, 'REDACTED_ERROR');

  const json = JSON.stringify(diagnostic);
  for (const forbidden of [
    'bank.example',
    'TOP_SECRET_VALUE',
    'TOP SECRET PROPERTY',
    'plain private page title',
    'PrivateName',
    'OTHER_TAB_SECRET',
    'main > article',
    '.private',
    'doc-secret',
    'chrome-doc-secret',
    'scopeSelector',
    'cssText',
    'beforeState',
    'cleanup',
    'urlKey',
  ]) {
    assert.equal(json.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
  }
});

test('diagnostic storage statuses distinguish missing keys from read errors', () => {
  const absent = buildModeEngineDiagnosticSnapshot({
    tabId: 7,
    tabStateRead: missing(),
    cssRegistryRead: missing(),
    lifecycleRead: { ok: true, status: 'missing', slot: null, error: null },
  });
  const unavailable = buildModeEngineDiagnosticSnapshot({
    tabId: 7,
    tabStateRead: failed('quota backend unavailable'),
    cssRegistryRead: failed('storage disconnected'),
    lifecycleRead: { ok: false, status: 'error', slot: null, error: { message: 'session unavailable' } },
  });

  assert.deepEqual(absent.storage, {
    modeState: { status: 'missing', error: null },
    cssRegistry: { status: 'missing', error: null },
    lifecycle: { status: 'missing', error: null },
  });
  assert.deepEqual(unavailable.storage, {
    modeState: { status: 'error', error: 'STORAGE_UNAVAILABLE' },
    cssRegistry: { status: 'error', error: 'STORAGE_UNAVAILABLE' },
    lifecycle: { status: 'error', error: 'STORAGE_UNAVAILABLE' },
  });
});

test('diagnostic collections and serialized output stay bounded', () => {
  const tabId = 8;
  const diagnostic = buildModeEngineDiagnosticSnapshot({
    tabId,
    tabStateRead: missing(),
    cssRegistryRead: missing(),
    lifecycleRead: {
      ok: true,
      status: 'found',
      slot: {
        running: {
          phase: 'RETRYABLE',
          artifacts: Array.from({ length: 200 }, (_, index) => ({
            kind: `ARTIFACT_${index}`,
            status: 'PLANNED',
          })),
        },
      },
    },
    signals: Array.from({ length: 200 }, (_, index) => ({
      tabId,
      type: `signal_${index}`,
      value: index,
      confidence: 0.5,
      ts: index,
      source: 'test',
    })),
    decisions: Array.from({ length: 200 }, (_, index) => ({
      tabId,
      decision: 'NOOP',
      modeId: MODE_IDS.FOCUS,
      score: index,
      ts: index,
    })),
  });

  assert.equal(diagnostic.lifecycle.running.artifacts.length, 24);
  assert.equal(diagnostic.signals.recentSignals.length, 25);
  assert.equal(diagnostic.signals.recentDecisions.length, 25);
  assert.ok(JSON.stringify(diagnostic).length <= MODE_ENGINE_DIAGNOSTIC_MAX_BYTES);
});
