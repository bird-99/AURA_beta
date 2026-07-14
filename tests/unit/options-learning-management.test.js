import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildLearningRows,
  createOptionsLearningManagementController,
  createOptionsLearningManagementView,
} from '../../options/learning-management.js';

const LEARNING_STAGES = Object.freeze({ MANUAL: 'MANUAL', ASSISTED: 'ASSISTED', AUTO: 'AUTO' });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createView() {
  const calls = [];
  let actions = null;
  return {
    calls,
    get actions() { return actions; },
    bind(nextActions) {
      calls.push(['bind']);
      actions = nextActions;
    },
    renderRows(rows, query) { calls.push(['render', rows, query]); },
    setResetAllConfirmationVisible(visible) { calls.push(['global-confirm', visible]); },
    setDomainResetConfirmation(domain) { calls.push(['domain-confirm', domain]); },
    setBusy(busy) { calls.push(['busy', busy]); },
    reportInline(kind, message) { calls.push(['inline', kind, message]); },
    reportLearning(kind, message) { calls.push(['learning', kind, message]); },
    dispose() { calls.push(['dispose']); },
  };
}

function createHarness(initialLearning = {}, overrides = {}) {
  let storedLearning = structuredClone(initialLearning);
  const mutations = [];
  const view = overrides.view || createView();
  const mutateLearning = overrides.mutateLearning || (async (updater) => {
    mutations.push(structuredClone(storedLearning));
    storedLearning = await updater(structuredClone(storedLearning));
    return structuredClone(storedLearning);
  });
  const controller = createOptionsLearningManagementController({
    mutateLearning,
    view,
    learningStages: LEARNING_STAGES,
  });
  return {
    controller,
    view,
    mutations,
    get storedLearning() { return storedLearning; },
  };
}

test('buildLearningRows sorts modes and selects the latest decision deterministically', () => {
  const rows = buildLearningRows({
    'zeta.example': {
      focus: { stage: 'AUTO', weight: 0.75 },
      'comfort-visual': { stage: 'ASSISTED', weight: -0.25 },
    },
    'alpha.example': {},
  }, {
    'zeta.example': {
      focus: { decision: 'NOT_NOW', timestamp: 20 },
      'comfort-visual': { decision: 'ENABLED', timestamp: 30 },
    },
  });

  assert.deepEqual(rows, [
    {
      domain: 'alpha.example',
      modes: ['—'],
      stage: 'MANUAL',
      weight: '0.00',
      decision: null,
      decisionTimestamp: null,
    },
    {
      domain: 'zeta.example',
      modes: ['comfort-visual', 'focus'],
      stage: 'ASSISTED, AUTO',
      weight: '-0.25, 0.75',
      decision: 'ENABLED',
      decisionTimestamp: 30,
    },
  ]);
});

test('controller owns state and renders search changes through the production model', () => {
  const { controller, view } = createHarness();
  controller.setState({
    learning: { 'example.com': { focus: { stage: 'AUTO', weight: 0.4 } } },
    decisions: {},
  });
  controller.initialize();
  assert.equal(controller.initialize(), false);
  assert.equal(view.actions.setQuery('EXAMPLE'), true);

  const renders = view.calls.filter(([type]) => type === 'render');
  assert.equal(renders.length, 2);
  assert.equal(renders[0][1][0].domain, 'example.com');
  assert.equal(renders[1][2], 'example');
  assert.equal(view.calls.filter(([type]) => type === 'bind').length, 1);
});

test('global reset replaces every existing mode with the exact neutral representation', async () => {
  const initial = {
    'alpha.example': {
      focus: { stage: 'AUTO', weight: 0.9, decisionCount: 3, appliedEffectIds: ['focus'] },
    },
    'beta.example': {
      'comfort-visual': { stage: 'ASSISTED', weight: -0.2, eligiblePositiveCount: 2 },
    },
  };
  const harness = createHarness(initial);
  const { controller, view } = harness;
  controller.setState({ learning: initial, decisions: {} });
  controller.initialize();
  const result = await view.actions.confirmResetAll();

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(harness.storedLearning, {
    'alpha.example': { focus: { stage: 'MANUAL', weight: 0 } },
    'beta.example': { 'comfort-visual': { stage: 'MANUAL', weight: 0 } },
  });
  assert.ok(view.calls.some((call) => call.join('|') === 'inline|success|Learning reset'));
  assert.ok(view.calls.some((call) => call.join('|') === 'learning|success|Learning reset'));
});

test('domain reset preserves every other stored domain and uses the committed snapshot', async () => {
  const initial = {
    'alpha.example': { focus: { stage: 'AUTO', weight: 0.9, decisionCount: 3 } },
    'beta.example': { focus: { stage: 'ASSISTED', weight: 0.2, preserved: true } },
  };
  const harness = createHarness(initial);
  const { controller, view } = harness;
  controller.setState({ learning: initial, decisions: {} });
  controller.initialize();
  const result = await view.actions.confirmDomainReset('alpha.example');

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(harness.storedLearning, {
    'alpha.example': { focus: { stage: 'MANUAL', weight: 0 } },
    'beta.example': initial['beta.example'],
  });
  const lastRender = view.calls.filter(([type]) => type === 'render').at(-1);
  assert.deepEqual(lastRender[1].map((row) => row.domain), ['alpha.example', 'beta.example']);
});

test('missing domain is decided from the locked storage snapshot', async () => {
  const { controller, view, mutations } = createHarness({});
  controller.setState({ learning: {}, decisions: {} });
  controller.initialize();
  const result = await view.actions.confirmDomainReset('missing.example');

  assert.deepEqual(result, { ok: false, reason: 'LEARNING_DOMAIN_MISSING' });
  assert.equal(mutations.length, 1);
  assert.ok(view.calls.some((call) => call.join('|') === 'learning|info|No learning data for domain'));
});

test('persistence rejection is bounded without reporting a false success', async () => {
  const failure = new Error('storage unavailable');
  const view = createView();
  const { controller } = createHarness(
    { 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } },
    { view, mutateLearning: async () => { throw failure; } },
  );
  controller.setState({
    learning: { 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } },
    decisions: {},
  });
  controller.initialize();

  assert.deepEqual(await view.actions.confirmDomainReset('alpha.example'), {
    ok: false,
    reason: 'storage unavailable',
  });
  assert.equal(view.calls.some(([, kind]) => kind === 'success'), false);
  assert.ok(view.calls.some((call) => call.join('|') === 'learning|error|Learning reset failed'));
  assert.deepEqual(view.calls.filter(([type]) => type === 'busy'), [['busy', true], ['busy', false]]);
});

test('domain added after the UI snapshot is reset from authoritative storage', async () => {
  const stored = {
    'fresh.example': { focus: { stage: 'AUTO', weight: 0.8, decisionCount: 4 } },
  };
  const view = createView();
  const controller = createOptionsLearningManagementController({
    mutateLearning: async (updater) => updater(structuredClone(stored)),
    view,
    learningStages: LEARNING_STAGES,
  });
  controller.setState({ learning: {}, decisions: {} });
  controller.initialize();

  assert.deepEqual(await view.actions.confirmDomainReset('fresh.example'), { ok: true });
  const lastRender = view.calls.filter(([type]) => type === 'render').at(-1);
  assert.deepEqual(lastRender[1][0], {
    domain: 'fresh.example',
    modes: ['focus'],
    stage: 'MANUAL',
    weight: '0.00',
    decision: null,
    decisionTimestamp: null,
  });
});

test('a duplicate destructive command is rejected while the first operation is pending', async () => {
  const gate = deferred();
  const view = createView();
  const controller = createOptionsLearningManagementController({
    mutateLearning: async (updater) => {
      await gate.promise;
      return updater({ 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } });
    },
    view,
    learningStages: LEARNING_STAGES,
  });
  controller.setState({ learning: { 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } }, decisions: {} });
  controller.initialize();

  const first = view.actions.confirmResetAll();
  const second = await view.actions.confirmResetAll();
  assert.deepEqual(second, { ok: false, reason: 'LEARNING_OPERATION_IN_PROGRESS' });
  gate.resolve();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(view.calls.filter(([type]) => type === 'busy'), [['busy', true], ['busy', false]]);
});

test('a failed operation releases busy state and permits a later retry', async () => {
  let attempts = 0;
  const view = createView();
  const controller = createOptionsLearningManagementController({
    mutateLearning: async (updater) => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary storage failure');
      return updater({ 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } });
    },
    view,
    learningStages: LEARNING_STAGES,
  });
  controller.setState({ learning: { 'alpha.example': { focus: { stage: 'AUTO', weight: 1 } } }, decisions: {} });
  controller.initialize();

  assert.equal((await view.actions.confirmResetAll()).ok, false);
  assert.deepEqual(await view.actions.confirmResetAll(), { ok: true });
  assert.equal(attempts, 2);
  assert.deepEqual(view.calls.filter(([type]) => type === 'busy'), [
    ['busy', true], ['busy', false], ['busy', true], ['busy', false],
  ]);
});

test('dispose invalidates late UI completion without cancelling committed storage', async () => {
  const commit = deferred();
  const view = createView();
  const controller = createOptionsLearningManagementController({
    mutateLearning: async () => commit.promise,
    view,
    learningStages: LEARNING_STAGES,
  });
  controller.initialize();
  const pending = view.actions.confirmResetAll();
  controller.dispose();
  commit.resolve({ 'alpha.example': { focus: { stage: 'MANUAL', weight: 0 } } });

  assert.deepEqual(await pending, { ok: false, reason: 'LEARNING_OPERATION_STALE', stale: true });
  assert.equal(view.calls.some(([, kind]) => kind === 'success'), false);
  assert.deepEqual(view.calls.filter(([type]) => type === 'busy'), [['busy', true]]);
});

test('dispose is idempotent, removes the view binding and rejects later actions', async () => {
  const { controller, view } = createHarness();
  controller.initialize();
  controller.dispose();
  controller.dispose();

  assert.equal(view.calls.filter(([type]) => type === 'dispose').length, 1);
  assert.equal(view.actions.setQuery('ignored'), false);
  assert.deepEqual(await view.actions.confirmResetAll(), {
    ok: false,
    reason: 'LEARNING_CONTROLLER_DISPOSED',
  });
});

test('view fails closed when required Learning DOM elements are missing', () => {
  assert.throws(() => createOptionsLearningManagementView({
    document: { getElementById: () => null },
    reportInlineStatus() {},
    reportSectionStatus() {},
  }), /Missing Learning management element: section/);
});
