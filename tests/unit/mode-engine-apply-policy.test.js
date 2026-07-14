import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
  buildSiteBlockedResult,
  classifyApplyFailureForPolicy,
  formatDetail,
  getSiteKey,
  resolveSitePolicy,
  resolveUrlKey,
} from '../../background/mode-engine-apply-policy.js';
import { MODE_IDS, SITE_BLOCK_REASONS, STORAGE_KEYS } from '../../shared/constants.js';
import { PROFILE_ACTIONS, PROFILE_MATCH_TYPES } from '../../shared/site-profiles.js';

function setupChrome({ tabUrl = 'https://example.com/article', storage = {}, tabThrows = false, storageThrows = false } = {}) {
  global.chrome = {
    tabs: {
      get: async () => {
        if (tabThrows) {
          throw new Error('tab missing');
        }
        return { id: 7, url: tabUrl };
      },
    },
    storage: {
      local: {
        get: async (key) => {
          if (storageThrows) throw new Error('storage offline');
          return { [key]: storage[key] };
        },
      },
    },
  };
}

afterEach(() => {
  delete global.chrome;
});

test('mode-engine apply policy module does not import css-applier', async () => {
  const source = await readFile(join(process.cwd(), 'background', 'mode-engine-apply-policy.js'), 'utf8');

  assert.equal(source.includes('./css-applier.js'), false);
  assert.equal(source.includes('css-applier'), false);
});

test('resolveUrlKey prefers fallback URL and otherwise reads tab URL', async () => {
  setupChrome({ tabUrl: 'https://example.com/from-tab?x=1#section' });

  assert.equal(await resolveUrlKey(7, 'https://fallback.test/path?utm=1'), 'https://fallback.test/path');
  assert.equal(await resolveUrlKey(7), 'https://example.com/from-tab');
});

test('resolveUrlKey and getSiteKey tolerate tab lookup failures', async () => {
  setupChrome({ tabThrows: true });
  const originalWarn = console.warn;

  try {
    console.warn = () => {};
    assert.equal(await resolveUrlKey(7), '');
    assert.equal(await getSiteKey(7), 'unknown');
  } finally {
    console.warn = originalWarn;
  }
});

test('resolveSitePolicy blocks user disabled site profiles before site policy', async () => {
  setupChrome({
    tabUrl: 'https://reader.example.com/article',
    storage: {
      [STORAGE_KEYS.SITE_PROFILES]: {
        entries: [
          {
            id: 'never-example',
            action: PROFILE_ACTIONS.NEVER,
            matchType: PROFILE_MATCH_TYPES.DOMAIN,
            modeId: MODE_IDS.COMFORT_VISUAL,
            value: 'example.com',
          },
        ],
      },
    },
  });

  const result = await resolveSitePolicy(7, MODE_IDS.COMFORT_VISUAL);

  assert.equal(result.url, 'https://reader.example.com/article');
  assert.equal(result.policy.allowed, false);
  assert.equal(result.policy.reason, SITE_BLOCK_REASONS.USER_DISABLED_FOR_HOST);
  assert.equal(result.policy.host, 'example.com');
});

test('resolveSitePolicy blocks denylisted sites and fails closed on unavailable policy storage', async () => {
  setupChrome({ storage: { [STORAGE_KEYS.DENYLIST]: ['example.com'] } });
  const denied = await resolveSitePolicy(7, MODE_IDS.COMFORT_VISUAL);
  assert.equal(denied.policy.allowed, false);
  assert.equal(denied.policy.reason, SITE_BLOCK_REASONS.USER_DISABLED_FOR_HOST);

  setupChrome({ storageThrows: true });
  const unavailable = await resolveSitePolicy(7, MODE_IDS.COMFORT_VISUAL);
  assert.equal(unavailable.policy.allowed, false);
  assert.equal(unavailable.policy.reason, 'SITE_POLICY_STORAGE_UNAVAILABLE');
});

test('resolveSitePolicy fails closed on malformed site profile storage', async () => {
  setupChrome({ storage: { [STORAGE_KEYS.SITE_PROFILES]: { entries: 'invalid' } } });
  const result = await resolveSitePolicy(7, MODE_IDS.FOCUS);
  assert.equal(result.policy.allowed, false);
  assert.equal(result.policy.reason, 'SITE_POLICY_STORAGE_UNAVAILABLE');
});

test('buildSiteBlockedResult and formatDetail preserve stable payloads', () => {
  assert.deepEqual(buildSiteBlockedResult({ reason: 'NOPE', blockedUntil: 123 }), {
    ok: false,
    error: 'SITE_BLOCKED',
    detail: 'NOPE',
    blockedUntil: 123,
  });
  assert.equal(formatDetail('already-string', 'fallback'), 'already-string');
  assert.equal(formatDetail(null, 'fallback'), 'fallback');
  assert.equal(formatDetail({ code: 'X' }), '{"code":"X"}');
});

test('classifyApplyFailureForPolicy returns only structural failures', () => {
  assert.equal(classifyApplyFailureForPolicy({ ok: false, reason: 'SCOPE_REJECTED' }), 'SCOPE_REJECTED');
  assert.equal(classifyApplyFailureForPolicy({ ok: false, error: 'NO_RECEIVER' }), 'NO_RECEIVER');
  assert.equal(classifyApplyFailureForPolicy({ ok: false, reason: 'insert_failed' }), null);
  assert.equal(classifyApplyFailureForPolicy({ ok: true, reason: 'SCOPE_REJECTED' }), null);
});
