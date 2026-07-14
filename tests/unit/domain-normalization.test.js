import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractDomain, extractLegacyDomain, getDomainKeyCandidates } from '../../shared/utils.js';

test('extractDomain normalizes PSL-based domains', () => {
  assert.equal(extractDomain('https://www.bbc.co.uk/news'), 'bbc.co.uk');
  assert.equal(extractDomain('https://amazon.co.uk/gp/product/123'), 'amazon.co.uk');
  assert.equal(extractDomain('https://sub.something.ac.jp/path'), 'something.ac.jp');
  assert.equal(extractDomain('https://bank.co.ma/login'), 'bank.co.ma');
  assert.equal(extractDomain('https://shop.co.ma/catalog'), 'shop.co.ma');
  assert.equal(extractDomain('https://www.example.com.br/path'), 'example.com.br');
  assert.equal(extractDomain('https://sub.example.co.za/path'), 'example.co.za');
});

test('extractDomain honors private suffixes and IDNs', () => {
  assert.equal(extractDomain('https://alice.github.io/project'), 'alice.github.io');
  assert.equal(extractDomain('https://bob.github.io/project'), 'bob.github.io');
  assert.equal(extractDomain('https://www.bücher.de/'), 'xn--bcher-kva.de');
});

test('extractDomain preserves localhost and IP addresses', () => {
  assert.equal(extractDomain('http://127.0.0.1:3000'), '127.0.0.1');
  assert.equal(extractDomain('http://localhost:8080'), 'localhost');
  assert.equal(extractDomain('http://[2001:db8::1]:8080'), '[2001:db8::1]');
  assert.equal(extractDomain('example.com:3000/path'), 'example.com');
});

test('legacy domain candidates preserve pre-PSL settings without overriding new keys', () => {
  assert.equal(extractLegacyDomain('https://bank.co.ma/login'), 'co.ma');
  assert.deepEqual(getDomainKeyCandidates('bank.co.ma'), ['bank.co.ma']);
  assert.deepEqual(getDomainKeyCandidates('shop.co.ma'), ['shop.co.ma']);
  assert.deepEqual(getDomainKeyCandidates('alice.github.io'), ['alice.github.io']);
  assert.deepEqual(getDomainKeyCandidates('bbc.co.uk'), ['bbc.co.uk']);
});
