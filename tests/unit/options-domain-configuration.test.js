import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDomainListRows,
  buildSiteProfileRows,
  createOptionsDomainConfigurationController,
  createOptionsDomainConfigurationView,
} from '../../options/domain-configuration.js';
import { MODE_IDS } from '../../shared/constants.js';
import {
  PROFILE_ACTIONS,
  normalizeSiteProfiles,
  parseProfileTarget,
} from '../../shared/site-profiles.js';

function createView() {
  const calls = [];
  let actions = null;
  return {
    calls,
    get actions() { return actions; },
    bind(nextActions) { actions = nextActions; calls.push(['bind']); },
    renderLists(allow, deny, queries) { calls.push(['lists', allow, deny, queries]); },
    renderProfiles(rows) { calls.push(['profiles', rows]); },
    setListFeedback(kind, message) { calls.push(['list-feedback', kind, message]); },
    clearListInput(kind) { calls.push(['clear-list', kind]); },
    setProfileFeedback(message) { calls.push(['profile-feedback', message]); },
    resetProfileForm(action) { calls.push(['reset-profile', action]); },
    reportInline(kind, message) { calls.push(['inline', kind, message]); },
    reportDomains(kind, message) { calls.push(['domains', kind, message]); },
    dispose() { calls.push(['dispose']); },
  };
}

function normalizeDomain(input) {
  const domain = String(input || '').trim().toLowerCase();
  return domain
    ? { ok: true, domain }
    : { ok: false, reason: 'Domain required' };
}

function createHarness(initial = {}) {
  let allowlist = [...(initial.allowlist || [])];
  let denylist = [...(initial.denylist || [])];
  let profiles = normalizeSiteProfiles(initial.profiles || {});
  const view = createView();
  const mutate = (read, write) => async (updater) => {
    const committed = await updater(structuredClone(read()));
    write(structuredClone(committed));
    return structuredClone(committed);
  };
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async (updater) => {
      const committed = await updater({
        allowlist: structuredClone(allowlist),
        denylist: structuredClone(denylist),
      });
      allowlist = structuredClone(committed.allowlist);
      denylist = structuredClone(committed.denylist);
      return structuredClone(committed);
    },
    mutateProfiles: mutate(() => profiles, (value) => { profiles = value; }),
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'profile-created',
    view,
  });
  controller.setState({ allowlist, denylist, profiles });
  controller.initialize();
  return {
    controller,
    view,
    get allowlist() { return allowlist; },
    get denylist() { return denylist; },
    get profiles() { return profiles; },
  };
}

test('domain list and profile projections preserve deterministic presentation', () => {
  assert.deepEqual(buildDomainListRows(['zeta.example', 'alpha.example']), [
    { domain: 'zeta.example' },
    { domain: 'alpha.example' },
  ]);
  assert.deepEqual(buildSiteProfileRows({ entries: [
    { id: 'z', value: 'zeta.example', modeId: MODE_IDS.FOCUS, matchType: 'hostname', action: 'never' },
    { id: 'a', value: 'alpha.example', modeId: MODE_IDS.COMFORT_VISUAL, matchType: 'domain', action: 'always' },
  ] }), [
    {
      identity: {
        id: 'a',
        matchType: 'domain',
        modeId: MODE_IDS.COMFORT_VISUAL,
        value: 'alpha.example',
      },
      label: 'alpha.example • Domain • Comfort Visual • Always on',
    },
    {
      identity: {
        id: 'z',
        matchType: 'hostname',
        modeId: MODE_IDS.FOCUS,
        value: 'zeta.example',
      },
      label: 'zeta.example • Hostname • Focus • Always off',
    },
  ]);
});

test('controller commits both lists authoritatively with last explicit command winning conflicts', async () => {
  const harness = createHarness({ allowlist: ['alpha.example'] });

  assert.deepEqual(await harness.view.actions.addListEntry('allow', 'ZETA.EXAMPLE'), { ok: true });
  assert.deepEqual(harness.allowlist, ['alpha.example', 'zeta.example']);
  assert.deepEqual(await harness.view.actions.addListEntry('deny', 'zeta.example'), { ok: true });
  assert.deepEqual(harness.denylist, ['zeta.example']);
  assert.deepEqual(harness.allowlist, ['alpha.example']);
  assert.deepEqual(await harness.view.actions.addListEntry('allow', 'zeta.example'), { ok: true });
  assert.deepEqual(harness.allowlist, ['alpha.example', 'zeta.example']);
  assert.deepEqual(harness.denylist, []);
  assert.deepEqual(await harness.view.actions.addListEntry('allow', 'zeta.example'), { ok: true });
  assert.ok(harness.view.calls.some((call) => call.join('|') === 'domains|info|Domain already in allowlist'));

  assert.deepEqual(await harness.view.actions.removeListEntry('allow', 'alpha.example'), { ok: true });
  assert.deepEqual(harness.allowlist, ['zeta.example']);
});

test('a stale controller preserves newer entries from the authoritative list transaction', async () => {
  let stored = { allowlist: ['fresh.example'], denylist: [] };
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async (updater) => {
      stored = await updater(structuredClone(stored));
      return structuredClone(stored);
    },
    mutateProfiles: async () => normalizeSiteProfiles({}),
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'id',
    view,
  });
  controller.setState({ allowlist: [], denylist: [], profiles: {} });
  controller.initialize();

  assert.deepEqual(await view.actions.addListEntry('allow', 'later.example'), { ok: true });
  assert.deepEqual(stored, {
    allowlist: ['fresh.example', 'later.example'],
    denylist: [],
  });
  const lastRender = view.calls.filter(([type]) => type === 'lists').at(-1);
  assert.deepEqual(lastRender[1], [{ domain: 'fresh.example' }, { domain: 'later.example' }]);
});

test('controller owns profile create, update, ask and remove orchestration', async () => {
  const harness = createHarness();
  const draft = {
    target: 'bank.co.ma',
    modeId: MODE_IDS.COMFORT_VISUAL,
    action: PROFILE_ACTIONS.ALWAYS,
  };

  assert.deepEqual(await harness.view.actions.saveProfile(draft), { ok: true });
  assert.deepEqual(harness.profiles.entries, [{
    id: 'profile-created',
    action: PROFILE_ACTIONS.ALWAYS,
    matchType: 'domain',
    modeId: MODE_IDS.COMFORT_VISUAL,
    value: 'bank.co.ma',
    createdAt: 100,
    updatedAt: 100,
  }]);

  assert.deepEqual(await harness.view.actions.saveProfile({ ...draft, action: PROFILE_ACTIONS.NEVER }), { ok: true });
  assert.equal(harness.profiles.entries.length, 1);
  assert.equal(harness.profiles.entries[0].id, 'profile-created');
  assert.equal(harness.profiles.entries[0].action, PROFILE_ACTIONS.NEVER);

  assert.deepEqual(await harness.view.actions.saveProfile({ ...draft, action: PROFILE_ACTIONS.ASK }), { ok: true });
  assert.deepEqual(harness.profiles.entries, []);
});

test('a stale profile save uses the authoritative snapshot and preserves its stable id', async () => {
  const authoritative = normalizeSiteProfiles({ entries: [
    {
      id: 'fresh-id',
      action: PROFILE_ACTIONS.ALWAYS,
      matchType: 'domain',
      modeId: MODE_IDS.FOCUS,
      value: 'fresh.example',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'authoritative-id',
      action: PROFILE_ACTIONS.ALWAYS,
      matchType: 'domain',
      modeId: MODE_IDS.COMFORT_VISUAL,
      value: 'target.example',
      createdAt: 2,
      updatedAt: 2,
    },
  ] });
  let stored = structuredClone(authoritative);
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => ({ allowlist: [], denylist: [] }),
    mutateProfiles: async (updater) => {
      stored = await updater(structuredClone(stored));
      return structuredClone(stored);
    },
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'stale-generated-id',
    view,
  });
  controller.setState({ profiles: {} });
  controller.initialize();

  assert.deepEqual(await view.actions.saveProfile({
    target: 'target.example',
    modeId: MODE_IDS.COMFORT_VISUAL,
    action: PROFILE_ACTIONS.NEVER,
  }), { ok: true });
  assert.equal(stored.entries.length, 2);
  assert.deepEqual(stored.entries.find((entry) => entry.value === 'target.example'), {
    id: 'authoritative-id',
    action: PROFILE_ACTIONS.NEVER,
    matchType: 'domain',
    modeId: MODE_IDS.COMFORT_VISUAL,
    value: 'target.example',
    createdAt: 2,
    updatedAt: 100,
  });
  assert.ok(stored.entries.some((entry) => entry.id === 'fresh-id'));
});

test('legacy profiles without ids are removable by semantic identity', async () => {
  const harness = createHarness({ profiles: { entries: [{
    action: PROFILE_ACTIONS.NEVER,
    matchType: 'hostname',
    modeId: MODE_IDS.FOCUS,
    value: 'legacy.example.com',
  }] } });
  const [row] = buildSiteProfileRows(harness.profiles);

  assert.equal(row.identity.id, null);
  assert.deepEqual(await harness.view.actions.removeProfile(row.identity), { ok: true });
  assert.deepEqual(harness.profiles.entries, []);
});

test('profile persistence rejection neither reports success nor resets the form', async () => {
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => ({ allowlist: [], denylist: [] }),
    mutateProfiles: async () => { throw new Error('profile storage unavailable'); },
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'id',
    view,
  });
  controller.initialize();

  assert.deepEqual(await view.actions.saveProfile({
    target: 'failure.example',
    action: PROFILE_ACTIONS.ALWAYS,
  }), { ok: false, reason: 'profile storage unavailable' });
  assert.equal(view.calls.some(([, kind]) => kind === 'success'), false);
  assert.equal(view.calls.some(([type]) => type === 'reset-profile'), false);
  assert.ok(view.calls.some((call) => call.join('|') === 'domains|error|profile storage unavailable'));
});

test('a late committed profile operation cannot overwrite newer UI state', async () => {
  let releaseMutation;
  const gate = new Promise((resolve) => { releaseMutation = resolve; });
  let committed = null;
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => ({ allowlist: [], denylist: [] }),
    mutateProfiles: async (updater) => {
      committed = await updater(normalizeSiteProfiles({}));
      await gate;
      return structuredClone(committed);
    },
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'late-id',
    view,
  });
  controller.initialize();
  const pending = view.actions.saveProfile({
    target: 'late.example',
    action: PROFILE_ACTIONS.ALWAYS,
  });
  while (!committed) await new Promise((resolve) => setImmediate(resolve));

  controller.setState({ profiles: { entries: [{
    id: 'newer-id',
    action: PROFILE_ACTIONS.NEVER,
    matchType: 'domain',
    modeId: MODE_IDS.COMFORT_VISUAL,
    value: 'newer.example',
  }] } });
  releaseMutation();
  assert.deepEqual(await pending, { ok: true });

  const lastRender = view.calls.filter(([type]) => type === 'profiles').at(-1);
  assert.equal(lastRender[1][0].identity.id, 'newer-id');
  assert.equal(view.calls.some(([type]) => type === 'reset-profile'), false);
  assert.equal(view.calls.some(([, kind]) => kind === 'success'), false);
});

test('a profile operation committed after dispose leaves the detached view untouched', async () => {
  let releaseMutation;
  const gate = new Promise((resolve) => { releaseMutation = resolve; });
  let committed = null;
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => ({ allowlist: [], denylist: [] }),
    mutateProfiles: async (updater) => {
      committed = await updater(normalizeSiteProfiles({}));
      await gate;
      return structuredClone(committed);
    },
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'committed-id',
    view,
  });
  controller.initialize();
  const pending = view.actions.saveProfile({
    target: 'committed.example',
    action: PROFILE_ACTIONS.ALWAYS,
  });
  while (!committed) await new Promise((resolve) => setImmediate(resolve));
  controller.dispose();
  const callsAfterDispose = view.calls.length;
  releaseMutation();

  assert.deepEqual(await pending, { ok: true });
  assert.equal(committed.entries[0].id, 'committed-id');
  assert.equal(view.calls.length, callsAfterDispose);
});

test('invalid inputs are rejected before persistence', async () => {
  let mutations = 0;
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => { mutations += 1; },
    mutateProfiles: async () => { mutations += 1; },
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'id',
    view,
  });
  controller.initialize();

  assert.deepEqual(await view.actions.addListEntry('allow', ''), { ok: false, reason: 'Domain required' });
  assert.deepEqual(await view.actions.saveProfile({ target: '', action: PROFILE_ACTIONS.ALWAYS }), {
    ok: false,
    reason: 'Domain or pattern required',
  });
  assert.equal(mutations, 0);
});

test('list persistence rejection propagates without reporting success', async () => {
  const view = createView();
  const controller = createOptionsDomainConfigurationController({
    mutateLists: async () => { throw new Error('storage unavailable'); },
    mutateProfiles: async () => normalizeSiteProfiles({}),
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles: normalizeSiteProfiles,
    profileActions: PROFILE_ACTIONS,
    defaultModeId: MODE_IDS.COMFORT_VISUAL,
    now: () => 100,
    createProfileId: () => 'id',
    view,
  });
  controller.initialize();

  assert.deepEqual(await view.actions.addListEntry('allow', 'example.com'), {
    ok: false,
    reason: 'storage unavailable',
  });
  assert.equal(view.calls.some(([, kind]) => kind === 'success'), false);
  assert.ok(view.calls.some((call) => call.join('|') === 'domains|error|storage unavailable'));
});

test('dispose is idempotent and blocks later commands', async () => {
  const { controller, view } = createHarness();
  controller.dispose();
  controller.dispose();

  assert.equal(view.calls.filter(([type]) => type === 'dispose').length, 1);
  assert.deepEqual(await view.actions.addListEntry('allow', 'example.com'), {
    ok: false,
    reason: 'DOMAIN_CONTROLLER_DISPOSED',
  });
});

test('view fails closed when required Domain DOM elements are missing', () => {
  assert.throws(() => createOptionsDomainConfigurationView({
    document: { getElementById: () => null },
    reportInlineStatus() {},
    reportSectionStatus() {},
  }), /Missing Domain configuration element: allowInput/);
});
