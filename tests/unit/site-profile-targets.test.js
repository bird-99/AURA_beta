import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODE_IDS } from '../../shared/constants.js';
import {
  PROFILE_ACTIONS,
  PROFILE_MATCH_TYPES,
  isSafeSiteProfileEntry,
  normalizeSiteProfiles,
  parseProfileTarget,
  resolveSiteProfileForUrl,
} from '../../shared/site-profiles.js';
import { parseStrictDomainInput } from '../../shared/utils.js';

test('strict domain input accepts concrete PSL sites including private suffixes', () => {
  assert.deepEqual(parseStrictDomainInput('bank.co.ma'), {
    ok: true,
    hostname: 'bank.co.ma',
    siteKey: 'bank.co.ma',
    isIp: false,
  });
  assert.equal(parseStrictDomainInput('shop.co.ma').siteKey, 'shop.co.ma');
  assert.equal(parseStrictDomainInput('alice.github.io').siteKey, 'alice.github.io');
  assert.equal(parseStrictDomainInput('secure.example.com').siteKey, 'example.com');
});

test('strict domain input rejects suffix-only, URL, path, credential and port targets', () => {
  for (const input of [
    'co.ma',
    'com.br',
    'github.io',
    'https://bank.co.ma',
    'bank.co.ma/login',
    'bank.co.ma?next=shop',
    'user@bank.co.ma',
    'bank.co.ma:443',
    'javascript:alert(1)',
  ]) {
    assert.equal(parseStrictDomainInput(input).ok, false, input);
  }
});

test('profile targets accept only exact hosts or one anchored wildcard', () => {
  assert.deepEqual(parseProfileTarget('bank.co.ma'), {
    ok: true,
    matchType: PROFILE_MATCH_TYPES.DOMAIN,
    value: 'bank.co.ma',
  });
  assert.deepEqual(parseProfileTarget('secure.example.com'), {
    ok: true,
    matchType: PROFILE_MATCH_TYPES.HOSTNAME,
    value: 'secure.example.com',
  });
  assert.deepEqual(parseProfileTarget('*.example.com'), {
    ok: true,
    matchType: PROFILE_MATCH_TYPES.PATTERN,
    value: '*.example.com',
  });
  for (const input of ['*', '*example.com', 'foo.*.example.com', '*.co.ma', '*.github.io']) {
    assert.equal(parseProfileTarget(input).ok, false, input);
  }
});

test('unsafe historical profiles remain normalized but are ignored by runtime resolution', () => {
  const profiles = normalizeSiteProfiles({ entries: [
    {
      id: 'suffix',
      action: PROFILE_ACTIONS.ALWAYS,
      matchType: PROFILE_MATCH_TYPES.DOMAIN,
      modeId: MODE_IDS.COMFORT_VISUAL,
      value: 'co.ma',
    },
    {
      id: 'broad-pattern',
      action: PROFILE_ACTIONS.ALWAYS,
      matchType: PROFILE_MATCH_TYPES.PATTERN,
      modeId: MODE_IDS.COMFORT_VISUAL,
      value: '*',
    },
    {
      id: 'scheme-pattern',
      action: PROFILE_ACTIONS.ALWAYS,
      matchType: PROFILE_MATCH_TYPES.PATTERN,
      modeId: MODE_IDS.COMFORT_VISUAL,
      value: 'javascript:*',
    },
  ] });

  assert.equal(profiles.entries.length, 3, 'historical data must remain available for explicit cleanup');
  assert.equal(profiles.entries.every((entry) => isSafeSiteProfileEntry(entry) === false), true);
  assert.equal(resolveSiteProfileForUrl({
    url: 'https://bank.co.ma/login',
    modeId: MODE_IDS.COMFORT_VISUAL,
    profiles,
  }), null);
  assert.equal(resolveSiteProfileForUrl({
    url: 'https://shop.co.ma/cart',
    modeId: MODE_IDS.COMFORT_VISUAL,
    profiles,
  }), null);
});

test('runtime resolution still applies a precise modern profile', () => {
  const entry = {
    id: 'bank',
    action: PROFILE_ACTIONS.NEVER,
    matchType: PROFILE_MATCH_TYPES.DOMAIN,
    modeId: MODE_IDS.COMFORT_VISUAL,
    value: 'bank.co.ma',
  };
  assert.equal(isSafeSiteProfileEntry(entry), true);
  assert.equal(resolveSiteProfileForUrl({
    url: 'https://secure.bank.co.ma/login',
    modeId: MODE_IDS.COMFORT_VISUAL,
    profiles: { entries: [entry] },
  })?.id, 'bank');
  assert.equal(isSafeSiteProfileEntry({
    ...entry,
    id: 'legacy-hostname-root',
    matchType: PROFILE_MATCH_TYPES.HOSTNAME,
  }), true, 'an unambiguous historical hostname/root match remains safe');
});
