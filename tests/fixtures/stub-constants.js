import {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_IDS,
  MODES,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
  STORAGE_KEYS as SHARED_STORAGE_KEYS,
} from '../../shared/constants.js';

export {
  ACTIONS,
  CONTENT_MESSAGE_ROUTES_V1,
  CONTENT_ROUTE_OWNERSHIP,
  DECISIONS,
  MODE_IDS,
  MODES,
  SIGNALS,
  SMARTSCOPE_ACTIONS,
};

export const MODE_ENGINE_FLAG_DEFAULTS = {
  modeEngineCssGuardrails: true,
  smartScopeV2: true,
  scopedModeCssV2: true,
  focusOverlayV2: false,
  smartScopeSpaHooks: true,
  debugModeEngine: false,
  debugTestHooks: false,
};

export const STORAGE_KEYS = { ...SHARED_STORAGE_KEYS, FEATURE_FLAGS: 'featureFlags' };
