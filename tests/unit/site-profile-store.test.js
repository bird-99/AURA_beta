import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';
import { PROFILE_ACTIONS, PROFILE_MATCH_TYPES } from '../../shared/site-profiles.js';
import { readSiteProfilesResult, validateStoredSiteProfiles } from '../../background/site-profile-store.js';

function setupStorage(value, { missing = false, error = null } = {}) {
  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (error) throw error;
          return missing ? {} : { [key]: value };
        },
      },
    },
  };
}

afterEach(() => {
  delete global.chrome;
});

test('site profile store distinguishes missing, found and storage errors', async () => {
  setupStorage(undefined, { missing: true });
  const missing = await readSiteProfilesResult();
  assert.equal(missing.ok, true);
  assert.equal(missing.status, 'missing');
  assert.deepEqual(missing.profiles.entries, []);

  setupStorage({
    entries: [{
      id: 'p1',
      action: PROFILE_ACTIONS.NEVER,
      matchType: PROFILE_MATCH_TYPES.DOMAIN,
      modeId: MODE_IDS.FOCUS,
      value: 'example.com',
    }],
  });
  const found = await readSiteProfilesResult();
  assert.equal(found.ok, true);
  assert.equal(found.status, 'found');
  assert.equal(found.profiles.entries[0].id, 'p1');

  setupStorage(null, { error: new Error('storage offline') });
  const failed = await readSiteProfilesResult();
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /storage offline/);
});

test('site profile store rejects malformed found values instead of normalizing them to empty', async () => {
  for (const invalid of [null, 'invalid', { entries: 'invalid' }, { entries: [{ action: 'never' }] }]) {
    setupStorage(invalid);
    const result = await readSiteProfilesResult();
    assert.equal(result.ok, false);
    assert.equal(result.error, 'INVALID_SITE_PROFILES');
    assert.equal(validateStoredSiteProfiles(invalid), false);
  }
});

test('site profile store preserves supported legacy arrays and entries without ids', async () => {
  const legacy = [{
    action: PROFILE_ACTIONS.ALWAYS,
    matchType: PROFILE_MATCH_TYPES.DOMAIN,
    modeId: MODE_IDS.COMFORT_VISUAL,
    value: 'example.com',
  }];
  setupStorage(legacy);
  const result = await readSiteProfilesResult();
  assert.equal(result.ok, true);
  assert.equal(result.profiles.entries[0].id, null);
});
