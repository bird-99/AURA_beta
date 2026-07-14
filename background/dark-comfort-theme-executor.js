import { MODE_IDS } from '../shared/constants.js';
import {
  ADAPTATION_ACTION_IDS,
  ACTIVATION_STAGES,
  CAPABILITY_STATUSES,
  SUPPORT_LEVELS,
} from '../shared/engine-core/enums.js';
import {
  DARK_THEME_EXECUTOR,
  DARK_THEME_OWNER,
  DARK_THEME_V1_BUDGET,
  buildDarkComfortThemePaletteV1,
  buildDarkComfortThemeTokenMap,
  getDarkComfortThemePaletteDiagnosticsV1,
} from './dark-comfort-theme-css.js';
import { evaluateDarkComfortThemePostcheckV1 } from './dark-comfort-theme-postcheck.js';
import { COMFORT_DARK_RUNTIME_ENABLED, isComfortDarkRuntimeEnabled } from './mode-css-builders.js';

const DARK_COMFORT_THEME_SUPPORTED_ACTIVE_PAGE_TYPES = Object.freeze([
  'ARTICLE',
  'DOC',
  'SEARCH',
  'FORM',
  'SHOP',
  'FEED',
  'DASHBOARD',
  'VIDEO',
  'WEB_APP',
  'UNKNOWN',
]);

function normalizePageType(pageType) {
  return typeof pageType === 'string' && pageType.trim() ? pageType.trim().toUpperCase() : 'UNKNOWN';
}

function createDarkComfortThemeCleanupManifestV1(input = {}) {
  const tokenMap = input.tokenMap && typeof input.tokenMap === 'object' ? input.tokenMap : {};
  const cssIds = Array.isArray(input.cssIds) ? input.cssIds.filter((value) => typeof value === 'string') : [];
  const tokenKeys = Object.keys(tokenMap).filter((key) => typeof key === 'string');

  return {
    version: 1,
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    executor: DARK_THEME_EXECUTOR,
    owner: DARK_THEME_OWNER,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
    frameId: typeof input.frameId === 'number' ? input.frameId : 0,
    css: {
      cssIds,
      removeByExactIdentity: true,
    },
    tokens: {
      ownerKey: typeof input.ownerKey === 'string' ? input.ownerKey : null,
      keys: tokenKeys,
    },
    attributes: ['data-aura-surface', 'data-aura-surface-kind', 'data-aura-force-text'],
    inlineOverrides: {
      snapshotRequired: true,
      restoreRequired: true,
    },
    observers: ['surface-rescan', 'inline-rescan'],
    timers: ['initial-surface-pass', 'surface-rescan', 'inline-rescan'],
    postCheck: {
      required: true,
      passed: false,
    },
    rollbackRequired: true,
  };
}

function canActivateDarkComfortThemeV1(input = {}) {
  const capability = input.capability && typeof input.capability === 'object' ? input.capability : null;
  const capabilityActionId = capability?.actionId || capability?.key?.actionId || '';
  const pageType = normalizePageType(input.pageType || capability?.key?.pageType);
  const postcheck = input.postcheck ? evaluateDarkComfortThemePostcheckV1(input.postcheck) : null;
  const failures = [];

  if (!isComfortDarkRuntimeEnabled()) {
    failures.push('RUNTIME_DISABLED');
  }
  if (input.userOptIn !== true) {
    failures.push('USER_OPT_IN_REQUIRED');
  }
  if (capabilityActionId && capabilityActionId !== ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME) {
    failures.push('ACTION_MISMATCH');
  }
  if (capability?.status && capability.status !== CAPABILITY_STATUSES.SUPPORTED) {
    failures.push(capability.status);
  }
  if (capability?.supportLevel && capability.supportLevel !== SUPPORT_LEVELS.ACTIVE_RUNTIME) {
    failures.push('ACTIVE_RUNTIME_REQUIRED');
  }
  if (capability?.activationStage && capability.activationStage !== ACTIVATION_STAGES.MANUAL_LIMITED) {
    failures.push('MANUAL_LIMITED_REQUIRED');
  }
  if (capability?.activePlanAllowed !== true) {
    failures.push('ACTIVE_PLAN_NOT_ALLOWED');
  }
  if (postcheck && !postcheck.postCheckPassed) {
    failures.push('POSTCHECK_FAILED');
  }

  return {
    ok: failures.length === 0,
    activePlanAllowed: failures.length === 0,
    runtimeEnabled: COMFORT_DARK_RUNTIME_ENABLED === true,
    pageType,
    failures,
    postcheck,
  };
}

function buildDarkComfortThemeApplyRequestV1(input = {}) {
  const palette = input.palette || buildDarkComfortThemePaletteV1(input.visualSnapshot || input.precheckSnapshot);
  const paletteDiagnostics = getDarkComfortThemePaletteDiagnosticsV1(palette);
  const tokenMap = buildDarkComfortThemeTokenMap(palette);
  const cleanupManifest = createDarkComfortThemeCleanupManifestV1({
    tokenMap,
    frameId: input.frameId,
    ownerKey: input.ownerKey,
    createdAt: input.createdAt,
  });
  const gate = canActivateDarkComfortThemeV1(input);

  return {
    version: 1,
    modeId: MODE_IDS.COMFORT_VISUAL,
    actionId: ADAPTATION_ACTION_IDS.DARK_COMFORT_THEME,
    executor: DARK_THEME_EXECUTOR,
    activePlanAllowed: gate.activePlanAllowed,
    gate,
    budget: DARK_THEME_V1_BUDGET,
    palette,
    paletteDiagnostics,
    tokenMap,
    cleanupManifest,
    messagePatch: {
      darkThemeExecutorActive: gate.activePlanAllowed === true,
    },
  };
}

export {
  DARK_COMFORT_THEME_SUPPORTED_ACTIVE_PAGE_TYPES,
  createDarkComfortThemeCleanupManifestV1,
  canActivateDarkComfortThemeV1,
  buildDarkComfortThemeApplyRequestV1,
};
