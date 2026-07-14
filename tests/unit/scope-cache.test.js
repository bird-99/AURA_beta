import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LAST_SCOPE_CACHE_TTL_MS,
  createScopeCache,
  isCachedScopeEntryFresh,
  makeScopeCacheKey,
  makeUrlKey,
} from '../../background/scope-cache.js';

test('makeScopeCacheKey keeps tab and mode identity stable', () => {
  assert.equal(makeScopeCacheKey(42, 'comfort_visual'), '42:comfort_visual');
});

test('makeUrlKey normalizes to origin and pathname', () => {
  assert.equal(makeUrlKey('https://example.com/article?utm=1#section'), 'https://example.com/article');
  assert.equal(makeUrlKey('   '), '');
  assert.equal(makeUrlKey('not a url'), '');
  assert.equal(makeUrlKey(null), '');
});

test('scope cache ignores entries without a non-empty scope selector', () => {
  const cache = createScopeCache(2);

  cache.set('missing', null);
  cache.set('empty', { scopeSelector: '   ' });
  cache.set('number', { scopeSelector: 12 });

  assert.equal(cache.size, 0);
  assert.equal(cache.get('missing'), null);
  assert.equal(cache.get('empty'), null);
  assert.equal(cache.get('number'), null);
});

test('scope cache returns the stored entry and refreshes LRU order on read', () => {
  const cache = createScopeCache(2);
  const first = { scopeSelector: 'main' };
  const second = { scopeSelector: 'article' };
  const third = { scopeSelector: '#content' };

  cache.set('first', first);
  cache.set('second', second);
  assert.equal(cache.get('first'), first);

  cache.set('third', third);

  assert.equal(cache.get('second'), null);
  assert.equal(cache.get('first'), first);
  assert.equal(cache.get('third'), third);
});

test('scope cache delete removes only the requested entry', () => {
  const cache = createScopeCache(2);
  const first = { scopeSelector: 'main' };
  const second = { scopeSelector: 'article' };

  cache.set('first', first);
  cache.set('second', second);

  assert.equal(cache.delete('first'), true);
  assert.equal(cache.get('first'), null);
  assert.equal(cache.get('second'), second);
});

test('isCachedScopeEntryFresh requires matching url key and unexpired timestamp', () => {
  const now = 1_000_000;
  const entry = {
    scopeSelector: 'main',
    urlKey: 'https://example.com/article',
    savedAtMs: now - 1,
  };

  assert.equal(isCachedScopeEntryFresh(entry, 'https://example.com/article', now), true);
  assert.equal(isCachedScopeEntryFresh(entry, 'https://example.com/other', now), false);
  assert.equal(
    isCachedScopeEntryFresh(
      { ...entry, savedAtMs: now - LAST_SCOPE_CACHE_TTL_MS },
      'https://example.com/article',
      now,
    ),
    false,
  );
  assert.equal(isCachedScopeEntryFresh({ ...entry, savedAtMs: now + 1 }, 'https://example.com/article', now), false);
  assert.equal(isCachedScopeEntryFresh({ ...entry, savedAtMs: 'old' }, 'https://example.com/article', now), false);
  assert.equal(isCachedScopeEntryFresh(null, 'https://example.com/article', now), false);
});
