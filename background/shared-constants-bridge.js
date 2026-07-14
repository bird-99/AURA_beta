import {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_ENGINE_FLAG_DEFAULTS,
  MODE_IDS,
  MODES,
  MODE_PREFS_DEFAULTS,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  STORAGE_KEYS,
} from '../shared/constants.js';

export const SHARED_CONSTANTS_REQUEST_TYPE = 'AURA_GET_SHARED_CONSTANTS_V1';

export function buildSharedConstantsPayload() {
  return {
    ACTIONS,
    CONTENT_MESSAGE_ROUTES_V1,
    CONTENT_ROUTE_OWNERSHIP,
    DECISIONS,
    MODE_ENGINE_FLAG_DEFAULTS,
    MODE_IDS,
    MODES,
    MODE_PREFS_DEFAULTS,
    SIGNALS,
    SMARTSCOPE_ACTIONS,
    STORAGE_KEYS,
  };
}

export function handleSharedConstantsRequest(message, sendResponse) {
  if (!message || message.type !== SHARED_CONSTANTS_REQUEST_TYPE) {
    return false;
  }

  try {
    sendResponse({ ok: true, constants: buildSharedConstantsPayload() });
  } catch (error) {
    try {
      sendResponse({ ok: false, reason: 'SW_ERROR' });
    } catch (sendError) {
      // Ignore double failures in response channel.
    }
  }

  return true;
}
