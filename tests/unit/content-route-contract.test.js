import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';

import {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  SMARTSCOPE_ACTIONS,
} from '../../shared/constants.js';

const contentMainPath = new URL('../../content/content-main.js', import.meta.url);

test('content route contract exhaustively covers the frozen handler registry', async () => {
  const source = await fs.readFile(contentMainPath, 'utf8');
  const registryStart = source.indexOf('const CONTENT_ROUTE_HANDLERS_V1 = Object.freeze({');
  const registryEnd = source.indexOf('\n});', registryStart);
  const registrySource = source.slice(registryStart, registryEnd);
  const routeActions = [...registrySource.matchAll(/\[(ACTIONS|SMARTSCOPE_ACTIONS)\.([A-Z0-9_]+)\]\s*:/g)]
    .map(([, group, key]) => (group === 'ACTIONS' ? ACTIONS[key] : SMARTSCOPE_ACTIONS[key]));
  const contractActions = Object.keys(CONTENT_MESSAGE_ROUTES_V1);

  assert.equal(routeActions.length, contractActions.length, 'registry and contract sizes must match');
  assert.equal(new Set(routeActions).size, routeActions.length, 'registry actions must be unique');
  assert.deepEqual(
    [...new Set(routeActions)].sort(),
    contractActions.sort(),
  );
});

test('content-main delegates routing to the preloaded facade without a local fallback', async () => {
  const source = await fs.readFile(contentMainPath, 'utf8');
  const handlerSectionStart = source.indexOf('async function handleSmartScopeGetProfileRoute');
  const handlerSectionEnd = source.indexOf('function mapContentRouteError', handlerSectionStart);
  const handlerSection = source.slice(handlerSectionStart, handlerSectionEnd);
  const registryStart = source.indexOf('const CONTENT_ROUTE_HANDLERS_V1 = Object.freeze({');
  const registryEnd = source.indexOf('\n});', registryStart);
  const registrySource = source.slice(registryStart, registryEnd);
  const assignments = [...registrySource.matchAll(/\[(?:ACTIONS|SMARTSCOPE_ACTIONS)\.[A-Z0-9_]+\]:\s*([A-Za-z0-9_]+),/g)];

  assert.equal(assignments.length, Object.keys(CONTENT_MESSAGE_ROUTES_V1).length);
  assert.equal(new Set(assignments.map((match) => match[1])).size, assignments.length);
  assert.doesNotMatch(handlerSection, /sendResponse\s*\(/, 'normalized handlers must return payloads');
  assert.match(source, /contentMessageRouterApi\.createListener\(\{/);
  assert.doesNotMatch(source, /function dispatchContentRouteHandler\(/);
  assert.doesNotMatch(source, /switch\s*\(message\.action\)/);
});

test('every content route declares a valid ownership and response contract', () => {
  const validOwnership = new Set(Object.values(CONTENT_ROUTE_OWNERSHIP));

  for (const [action, route] of Object.entries(CONTENT_MESSAGE_ROUTES_V1)) {
    assert.equal(typeof action, 'string');
    assert.equal(typeof route.owner, 'string');
    assert.equal(validOwnership.has(route.ownership), true, `${action} ownership`);
    assert.equal(['sync', 'async'].includes(route.response), true, `${action} response`);
    assert.equal(['NONE', 'SUPPLIED_STRICT'].includes(route.identity), true, `${action} identity`);
    assert.equal(typeof route.effect, 'string');
  }

  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.SHOW_BANNER].ownership, 'TOP_FRAME_ONLY');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.INJECT_RESTORE_BUTTON].ownership, 'TOP_FRAME_ONLY');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.REMOVE_RESTORE_BUTTON].ownership, 'TOP_FRAME_ONLY');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.TEST_PING_CONTENT].ownership, 'FRAME_SAFE');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.TEST_PING_CONTENT].identity, 'NONE');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.TEST_INJECT_SUGGESTION_BANNER].ownership, 'TEST_ONLY');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.TEST_CLEAR_SUGGESTION_BANNER].ownership, 'TEST_ONLY');
  assert.equal(CONTENT_MESSAGE_ROUTES_V1[ACTIONS.MODE_ENGINE_V2_APPLY_RESULT].ownership, 'FRAME_TARGETED');

  for (const [action, route] of Object.entries(CONTENT_MESSAGE_ROUTES_V1)) {
    if (action !== ACTIONS.TEST_PING_CONTENT) {
      assert.equal(route.identity, 'SUPPLIED_STRICT', `${action} uses supplied strict identity`);
    }
  }
});

test('background UI senders explicitly address frame zero', async () => {
  const expectations = [
    ['../../background/scorer.js', ACTIONS.SHOW_BANNER],
    ['../../background/decision-handler.js', ACTIONS.INJECT_RESTORE_BUTTON],
    ['../../background/mode-exclusivity-manager.js', ACTIONS.REMOVE_RESTORE_BUTTON],
    ['../../background/auto-apply-manager.js', ACTIONS.INJECT_RESTORE_BUTTON],
    ['../../background/auto-apply-manager.js', ACTIONS.REMOVE_RESTORE_BUTTON],
    ['../../background/service-worker.js', ACTIONS.INJECT_RESTORE_BUTTON],
    ['../../background/service-worker.js', ACTIONS.REMOVE_RESTORE_BUTTON],
  ];

  for (const [relativePath, action] of expectations) {
    const source = await fs.readFile(new URL(relativePath, import.meta.url), 'utf8');
    const occurrences = [...source.matchAll(new RegExp(`action:\\s*ACTIONS\\.${action}`, 'g'))];
    assert.equal(occurrences.length > 0, true, `${relativePath} contains ${action}`);
    for (const occurrence of occurrences) {
      const callWindow = source.slice(occurrence.index, occurrence.index + 220);
      assert.match(callWindow, /frameId:\s*0/, `${relativePath} targets ${action} to frame zero`);
    }
  }
});
