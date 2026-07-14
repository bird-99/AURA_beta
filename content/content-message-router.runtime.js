(() => {
  'use strict';

  const API_KEY = 'AURA_CONTENT_MESSAGE_ROUTER_V1';
  const DEFAULT_DOCUMENT_CONTEXT_ACTION = 'GET_DOCUMENT_CONTEXT_V1';
  const DEFAULT_DIAGNOSTIC_PING_TYPE = 'AURA_PING_TEST_V1';
  const DEFAULT_DIAGNOSTIC_PONG_TYPE = 'AURA_PONG_TEST_V1';
  const VALID_OWNERSHIP = new Set([
    'TOP_FRAME_ONLY',
    'FRAME_TARGETED',
    'FRAME_SAFE',
    'TEST_ONLY',
  ]);
  const VALID_RESPONSE = new Set(['sync', 'async']);
  const VALID_IDENTITY = new Set(['NONE', 'SUPPLIED_STRICT']);

  function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function assertRouteRegistry(routes, handlers) {
    if (!isRecord(routes) || !isRecord(handlers)) {
      throw new Error('CONTENT_MESSAGE_ROUTER_REGISTRY_INVALID');
    }

    const routeActions = Object.keys(routes).sort();
    const handlerActions = Object.keys(handlers).sort();
    if (
      routeActions.length === 0
      || routeActions.length !== handlerActions.length
      || routeActions.some((action, index) => action !== handlerActions[index])
    ) {
      throw new Error('CONTENT_MESSAGE_ROUTER_REGISTRY_MISMATCH');
    }

    for (const action of routeActions) {
      const route = routes[action];
      if (
        !isRecord(route)
        || !VALID_OWNERSHIP.has(route.ownership)
        || !VALID_RESPONSE.has(route.response)
        || !VALID_IDENTITY.has(route.identity)
        || typeof handlers[action] !== 'function'
      ) {
        throw new Error(`CONTENT_MESSAGE_ROUTER_ROUTE_INVALID:${action}`);
      }
    }

    return routeActions;
  }

  /**
   * Creates a Chrome-compatible listener without touching Chrome or the DOM.
   * All environment access is supplied by the content composition root.
   *
   * @param {Record<string, any>} options
   * @returns {Function}
   */
  function createListener(options = {}) {
    const routes = options.routes;
    const handlers = options.handlers;
    assertRouteRegistry(routes, handlers);

    const isTopFrame = typeof options.isTopFrame === 'function'
      ? options.isTopFrame
      : () => false;
    const isTestHooksEnabled = typeof options.isTestHooksEnabled === 'function'
      ? options.isTestHooksEnabled
      : () => false;
    const isInvalidated = typeof options.isInvalidated === 'function'
      ? options.isInvalidated
      : () => false;
    const getDocumentInstanceId = typeof options.getDocumentInstanceId === 'function'
      ? options.getDocumentInstanceId
      : () => null;
    const mapError = typeof options.mapError === 'function'
      ? options.mapError
      : () => ({ ok: false, error: 'CONTENT_ROUTE_HANDLER_FAILED' });
    const documentContextAction = typeof options.documentContextAction === 'string'
      ? options.documentContextAction
      : DEFAULT_DOCUMENT_CONTEXT_ACTION;
    const diagnosticPingType = typeof options.diagnosticPingType === 'string'
      ? options.diagnosticPingType
      : DEFAULT_DIAGNOSTIC_PING_TYPE;
    const diagnosticPongType = typeof options.diagnosticPongType === 'string'
      ? options.diagnosticPongType
      : DEFAULT_DIAGNOSTIC_PONG_TYPE;

    const listener = (message, sender, sendResponse) => {
      if (message?.action === documentContextAction) {
        return false;
      }

      if (isInvalidated()) {
        sendResponse({ received: false, reason: 'context-invalidated' });
        return true;
      }

      if (isTestHooksEnabled() && message?.type === diagnosticPingType) {
        if (!isTopFrame()) {
          return false;
        }
        sendResponse({ ok: true, type: diagnosticPongType });
        return true;
      }

      const action = message?.action;
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(routes, action)) {
        return false;
      }
      const route = routes[action];

      const topFrameOwned = route.ownership === 'TOP_FRAME_ONLY' || route.ownership === 'TEST_ONLY';
      if (topFrameOwned && !isTopFrame()) {
        return false;
      }
      if (route.ownership === 'TEST_ONLY' && !isTestHooksEnabled()) {
        return false;
      }

      if (
        route.identity === 'SUPPLIED_STRICT'
        && typeof message?.expectedDocumentInstanceId === 'string'
        && message.expectedDocumentInstanceId !== getDocumentInstanceId()
      ) {
        sendResponse({ ok: false, error: 'DOCUMENT_IDENTITY_MISMATCH' });
        return true;
      }

      let responded = false;
      const sendOnce = (payload) => {
        if (responded) {
          return;
        }
        responded = true;
        sendResponse(payload);
      };

      let result;
      try {
        result = handlers[action](message, sender);
      } catch (error) {
        sendOnce(mapError(action, error));
        return true;
      }

      if (route.response === 'async') {
        Promise.resolve(result).then(
          (payload) => sendOnce(payload),
          (error) => sendOnce(mapError(action, error)),
        );
        return true;
      }

      if (result && typeof result.then === 'function') {
        sendOnce({ ok: false, error: 'CONTENT_ROUTE_RESPONSE_MISMATCH' });
        return true;
      }

      sendOnce(result);
      return true;
    };

    return Object.freeze(listener);
  }

  const existingApi = globalThis[API_KEY];
  if (existingApi?.version === 1 && typeof existingApi.createListener === 'function') {
    return;
  }
  if (existingApi != null) {
    throw new Error('CONTENT_MESSAGE_ROUTER_API_INCOMPATIBLE');
  }

  globalThis[API_KEY] = Object.freeze({
    version: 1,
    createListener,
  });
})();
