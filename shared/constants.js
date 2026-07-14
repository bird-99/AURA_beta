// shared/constants.js

import { getDefaultComfortVisualPrefs } from './comfort-visual-prefs.js';

// ========== MODE IDs ==========
export const MODE_IDS = {
  COMFORT_VISUAL: 'comfort-visual',
  FOCUS: 'focus'
};

// Alias compat: certains modules/docs utilisent MODES
export const MODES = MODE_IDS;

// ========== MODE ENGINE FLAGS (defaults) ==========
export const MODE_ENGINE_FLAG_DEFAULTS = {
  modeEngineCssGuardrails: true,
  smartScopeV2: true,
  scopedModeCssV2: true,
  focusOverlayV2: true,
  focusReduceMotionV1: true,
  smartScopeSpaHooks: true,
  siteSuppressV1: false,
  ultraFocusV1: true,
  ultraFocusMagnifierV1: false,
  contrastGuardV1: false,
  targetBoostV1: true,
  comfortDarkModeV1: false,
  smoothThemeTransitionsV2: false,
  shadowReplayLabV1: false,
  debugModeEngine: false,
  debugTestHooks: false,
};

export const MODE_ENGINE_FLAG_KEYS = Object.freeze(Object.keys(MODE_ENGINE_FLAG_DEFAULTS));

// ========== MODE ENGINE TIMINGS (ms) ==========
export const MODE_ENGINE_SMOOTH_TRANSITION_MS = 160;

// ========== CSS TEMPLATES ==========
export const FOCUS_SCOPE_PLACEHOLDER = '__AURA_SCOPE__';
export const FOCUS_CSS_TEMPLATE_PATH = 'background/css/focus.css';

// ========== STATES ==========
export const STATES = {
  INACTIVE: 'INACTIVE',
  SUGGESTED: 'SUGGESTED',
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  DEGRADED: 'DEGRADED',
  ERROR: 'ERROR'
};

export const ACTIVE_QUALITIES = {
  SCOPED_V2_VERIFIED: 'SCOPED_V2_VERIFIED',
  PAGE_CLARITY_MEDIUM_VERIFIED: 'PAGE_CLARITY_MEDIUM_VERIFIED',
  GLOBAL_SAFE_FALLBACK_UNVERIFIED: 'GLOBAL_SAFE_FALLBACK_UNVERIFIED',
  SMARTSCOPE_V1_VERIFIED: 'SMARTSCOPE_V1_VERIFIED',
  LEGACY_UNVERIFIED: 'LEGACY_UNVERIFIED'
};

// ========== SMARTSCOPE LEVELS ==========
export const SMARTSCOPE_LEVELS = {
  OFF: 'off',
  CONSERVATIVE: 'conservative',
  AGGRESSIVE: 'aggressive'
};

// ========== LEARNING STAGES ==========
export const LEARNING_STAGES = {
  MANUAL: 'MANUAL',
  ASSISTED: 'ASSISTED',
  AUTO: 'AUTO'
};

// ========== DECISIONS ==========
export const DECISIONS = {
  ENABLED: 'ENABLED',
  NOT_NOW: 'NOT_NOW',
  NEVER: 'NEVER'
};

export const DECISION_ALIASES = {
  DISMISSED: 'NOT_NOW'
};

// ========== THRESHOLDS ==========
export const THRESHOLDS = {
  SUGGESTION: 0.6,        // Score ≥ 0.6 → trigger suggestion
  AUTO_APPLY: 0.85,       // Weight ≥ 0.85 + AUTO stage → auto-apply
  DEGRADED_OPERATIONS: 100, // Operations > 100/min → DEGRADED
  DEGRADED_LATENCY: 500,    // Latency > 500ms → DEGRADED
  DEGRADED_HEAP: 50,        // Legacy key (Roadmap v5.2: WARNING only, not a DEGRADED trigger)
  HEAP_WARNING: 50          // Heap delta > 50MB → WARNING (diagnostic only)
};

// ========== POLICY DEFAULTS ==========
export const POLICY_DEFAULTS = {
  HYSTERESIS_GAP: 0.12,
  APPLY_STABILITY_MS: 30 * 1000,
  COOLDOWN_MS: 5 * 60 * 1000,
  STRONG_SIGNAL_CONFIDENCE: 0.6,
  MIN_STRONG_SIGNALS_FOR_APPLY: 2,
};

// ========== COOLDOWN DURATIONS (ms) ==========
export const COOLDOWN_DURATIONS = {
  // Roadmap v5.2: "Not now" triggers a 24h cooldown
  NOT_NOW: 24 * 60 * 60 * 1000, // 24 hours
  DISMISSED: 24 * 60 * 60 * 1000, // Legacy alias
  DEGRADED: 30 * 60 * 1000        // 30 minutes
};
// NOTE: "Never" is NOT a cooldown duration in storage; it is persisted as a decision (NEVER) + denylist.

// ========== LEARNING ADJUSTMENTS ==========
export const LEARNING_ADJUSTMENTS = {
  ENABLED: +0.2,     // +0.2 weight (capped at 1.0)
  NOT_NOW: -0.05, // -0.05 weight (floored at 0.0)
  DISMISSED: -0.05, // Legacy alias
  // NEVER is handled as a hard stop: weight set to 0.0 + denylist entry
};

// ========== SIGNAL NAMES ==========
export const SIGNALS = {
  ZOOM: 'zoom',
  COLOR_SCHEME: 'colorScheme',
  READING_BEHAVIOR: 'readingBehavior',
  VIEWPORT_SCALE: 'viewportScale',
  VIEWPORT_SCROLL: 'viewportScroll'
};

// ========== MESSAGE ACTIONS ==========
export const ACTIONS = {
  GET_TAB_ID: 'GET_TAB_ID',
  SIGNAL_DETECTED: 'SIGNAL_DETECTED',
  SHOW_BANNER: 'SHOW_BANNER',
  USER_DECISION: 'USER_DECISION',
  SHOW_WHY_SECTION: 'SHOW_WHY_SECTION',
  POPUP_READY: 'POPUP_READY',
  SCROLL_TO_WHY: 'SCROLL_TO_WHY',
  INJECT_RESTORE_BUTTON: 'INJECT_RESTORE_BUTTON',
  REMOVE_RESTORE_BUTTON: 'REMOVE_RESTORE_BUTTON',
  RESTORE_MODE: 'RESTORE_MODE',
  RESET_ALL_DATA: 'RESET_ALL_DATA',
  GET_STATE: 'GET_STATE',
  GET_DEBUG_SNAPSHOT: 'GET_DEBUG_SNAPSHOT',
  GET_PERFORMANCE_METRICS: 'GET_PERFORMANCE_METRICS',
  SIGNAL_SNAPSHOT_UPDATED: 'SIGNAL_SNAPSHOT_UPDATED',
  SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1: 'SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1',
  SMARTSCOPE_SET_CONFIG_V1: 'SMARTSCOPE_SET_CONFIG_V1',
  SMARTSCOPE_RESET_V1: 'SMARTSCOPE_RESET_V1',
  PREFS_UPDATED: 'PREFS_UPDATED',
  MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES: 'MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES',
  CONTENT_SCRIPT_READY_V2: 'CONTENT_SCRIPT_READY_V2',
  MODE_ENGINE_V2_APPLY_RESULT: 'MODE_ENGINE_V2_APPLY_RESULT',
  DARK_COMFORT_FRAME_READY: 'DARK_COMFORT_FRAME_READY',
  MODE_ENGINE_V2_APPLY_SCOPE_TOKENS: 'MODE_ENGINE_V2_APPLY_SCOPE_TOKENS',
  MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS: 'MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS',
  GET_DOCUMENT_CONTEXT_V1: 'GET_DOCUMENT_CONTEXT_V1',
  TEST_LIFECYCLE_ARM_PAUSE_V1: 'TEST_LIFECYCLE_ARM_PAUSE_V1',
  TEST_LIFECYCLE_GET_PAUSE_V1: 'TEST_LIFECYCLE_GET_PAUSE_V1',
  MODE_ENGINE_V2_SET_SCOPE_ROOT: 'MODE_ENGINE_V2_SET_SCOPE_ROOT',
  MODE_ENGINE_V2_VERIFY_SCOPE_ROOT: 'MODE_ENGINE_V2_VERIFY_SCOPE_ROOT',
  MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT: 'MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT',
  MODE_ENGINE_V2_MEASURE_CONTRAST: 'MODE_ENGINE_V2_MEASURE_CONTRAST',
  MODE_ENGINE_V2_CONTRAST_REPORT: 'MODE_ENGINE_V2_CONTRAST_REPORT',
  PAGE_SIGNALS_COLLECT_V1: 'PAGE_SIGNALS_COLLECT_V1',
  REGION_TARGET_VALIDATE_V1: 'REGION_TARGET_VALIDATE_V1',
  PAGE_CLARITY_MARK_TARGET_V1: 'PAGE_CLARITY_MARK_TARGET_V1',
  PAGE_CLARITY_EFFECT_BASELINE_V1: 'PAGE_CLARITY_EFFECT_BASELINE_V1',
  PAGE_CLARITY_EFFECT_PROBE_V1: 'PAGE_CLARITY_EFFECT_PROBE_V1',
  PAGE_CLARITY_CLEAR_TARGETS_V1: 'PAGE_CLARITY_CLEAR_TARGETS_V1',
  TEST_PING_CONTENT: 'TEST_PING_CONTENT',
  TEST_INJECT_SUGGESTION_BANNER: 'TEST_INJECT_SUGGESTION_BANNER',
  TEST_CLEAR_SUGGESTION_BANNER: 'TEST_CLEAR_SUGGESTION_BANNER',
  GET_SITE_POLICY: 'GET_SITE_POLICY',
  SET_SITE_OVERRIDE: 'SET_SITE_OVERRIDE',
  CLEAR_SITE_FAILURES_FOR_HOST: 'CLEAR_SITE_FAILURES_FOR_HOST',
  GET_LEGACY_DOMAIN_MIGRATION: 'GET_LEGACY_DOMAIN_MIGRATION',
  CONFIRM_LEGACY_DOMAIN_MIGRATION: 'CONFIRM_LEGACY_DOMAIN_MIGRATION'
};

// ========== SMARTSCOPE ACTIONS (Versionnées) ==========
export const SMARTSCOPE_ACTIONS = {
  GET_PROFILE: 'SMARTSCOPE_GET_PROFILE_V1',
  APPLY_CLASSES: 'SMARTSCOPE_APPLY_CLASSES_V1',
  REMOVE_TOKEN: 'SMARTSCOPE_REMOVE_TOKEN_V1',
  VERIFY_SCOPE: 'SMARTSCOPE_VERIFY_SCOPE_V1',
  EMERGENCY_CLEANUP: 'SMARTSCOPE_EMERGENCY_CLEANUP_V1',
  APPLY_TARGETED_HIDING: 'SMARTSCOPE_APPLY_TARGETED_HIDING_V1'
};

export const CONTENT_ROUTE_OWNERSHIP = Object.freeze({
  TOP_FRAME_ONLY: 'TOP_FRAME_ONLY',
  FRAME_TARGETED: 'FRAME_TARGETED',
  FRAME_SAFE: 'FRAME_SAFE',
  TEST_ONLY: 'TEST_ONLY',
});

const contentRoute = (owner, ownership, response, effect, identity = 'SUPPLIED_STRICT') => Object.freeze({
  owner,
  ownership,
  response,
  effect,
  identity,
});

// Exhaustive contract for the content-main switch. It is serialized through
// the shared-constants bridge so MV3 runtime code and Node tests share one
// ownership policy.
export const CONTENT_MESSAGE_ROUTES_V1 = Object.freeze({
  [SMARTSCOPE_ACTIONS.APPLY_CLASSES]: contentRoute('smartscope-classes', 'FRAME_TARGETED', 'sync', 'DOM'),
  [SMARTSCOPE_ACTIONS.REMOVE_TOKEN]: contentRoute('smartscope-classes', 'FRAME_TARGETED', 'sync', 'DOM'),
  [ACTIONS.PAGE_SIGNALS_COLLECT_V1]: contentRoute('page-signals', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.REGION_TARGET_VALIDATE_V1]: contentRoute('page-signals', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.PAGE_CLARITY_MARK_TARGET_V1]: contentRoute('page-clarity', 'FRAME_TARGETED', 'sync', 'DOM'),
  [ACTIONS.PAGE_CLARITY_EFFECT_BASELINE_V1]: contentRoute('page-clarity', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.PAGE_CLARITY_EFFECT_PROBE_V1]: contentRoute('page-clarity', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.PAGE_CLARITY_CLEAR_TARGETS_V1]: contentRoute('page-clarity', 'FRAME_TARGETED', 'sync', 'DOM'),
  [SMARTSCOPE_ACTIONS.GET_PROFILE]: contentRoute('smartscope-profile', 'FRAME_TARGETED', 'async', 'READ'),
  [ACTIONS.SMARTSCOPE_VERIFY_COMPUTED_STYLES_V1]: contentRoute('smartscope-verifier', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.MODE_ENGINE_V2_APPLY_SCOPE_TOKENS]: contentRoute('modeengine-scoped-v2', 'FRAME_TARGETED', 'async', 'DOM'),
  [ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS]: contentRoute('modeengine-scoped-v2', 'FRAME_TARGETED', 'async', 'DOM'),
  [ACTIONS.MODE_ENGINE_V2_SET_SCOPE_ROOT]: contentRoute('modeengine-scoped-v2', 'FRAME_TARGETED', 'async', 'DOM'),
  [ACTIONS.MODE_ENGINE_V2_VERIFY_SCOPE_ROOT]: contentRoute('modeengine-scoped-v2', 'FRAME_TARGETED', 'async', 'READ'),
  [ACTIONS.MODE_ENGINE_V2_SALVAGE_SCOPE_ROOT]: contentRoute('modeengine-scoped-v2', 'FRAME_TARGETED', 'async', 'DOM'),
  [ACTIONS.MODE_ENGINE_V2_MEASURE_CONTRAST]: contentRoute('modeengine-contrast', 'FRAME_TARGETED', 'sync', 'READ'),
  [ACTIONS.SHOW_BANNER]: contentRoute('suggestion-banner', 'TOP_FRAME_ONLY', 'async', 'UI'),
  [ACTIONS.TEST_PING_CONTENT]: contentRoute('content-readiness', 'FRAME_SAFE', 'sync', 'READ', 'NONE'),
  [ACTIONS.TEST_INJECT_SUGGESTION_BANNER]: contentRoute('suggestion-banner-test', 'TEST_ONLY', 'sync', 'UI'),
  [ACTIONS.TEST_CLEAR_SUGGESTION_BANNER]: contentRoute('suggestion-banner-test', 'TEST_ONLY', 'sync', 'UI'),
  [ACTIONS.INJECT_RESTORE_BUTTON]: contentRoute('restore-button', 'TOP_FRAME_ONLY', 'sync', 'UI'),
  [ACTIONS.REMOVE_RESTORE_BUTTON]: contentRoute('restore-button', 'TOP_FRAME_ONLY', 'sync', 'UI'),
  [ACTIONS.PREFS_UPDATED]: contentRoute('focus-preferences', 'TOP_FRAME_ONLY', 'sync', 'RUNTIME_STATE'),
  [ACTIONS.MODE_ENGINE_V2_APPLY_RESULT]: contentRoute('modeengine-result', 'FRAME_TARGETED', 'sync', 'RUNTIME_STATE'),
});

// ========== MODE PREFS (SUB-FEATURE DEFAULTS) ==========
export const MODE_PREF_KEYS = {
  [MODE_IDS.COMFORT_VISUAL]: Object.freeze(['darkMode', 'contrastGuard', 'reduceMotion', 'readingRuler']),
  [MODE_IDS.FOCUS]: Object.freeze([
    'distractionDim',
    'targetBoost',
    'reduceMotion',
    'readingRuler',
    'focusNotObscured',
  ]),
};

export const MODE_PREFS_DEFAULTS = {
  [MODE_IDS.COMFORT_VISUAL]: {
    darkMode: getDefaultComfortVisualPrefs().darkMode,
    contrastGuard: false,
    reduceMotion: false,
    readingRuler: false,
  },
  [MODE_IDS.FOCUS]: {
    distractionDim: false,
    targetBoost: false,
    reduceMotion: false,
    readingRuler: false,
    focusNotObscured: true,
  },
};

// ========== STORAGE KEYS ==========
export const STORAGE_KEYS = {
  // chrome.storage.local (persistent - Roadmap v5.2 schema)
  USER_PREFS: 'userPrefs',
  PER_DOMAIN_PREFS: 'perDomainPrefs',
  LEARNING_WEIGHTS: 'learningWeights',
  COOLDOWNS: 'cooldowns',
  DENYLIST: 'denylist',
  ALLOWLIST: 'allowlist',
  PERFORMANCE_LOGS: 'performanceLogs',
  FEATURE_FLAGS: 'featureFlags',
  SITE_FAILURES_V1: 'siteFailuresV1',
  SITE_OVERRIDES_V1: 'siteOverridesV1',
  SITE_PROFILES: 'siteProfiles',
  TEMPLATE_MEMORY_V1: 'templateMemoryV1',
  TEMPLATE_MEMORY_SECRET_V1: 'templateMemorySecretV1',

  // chrome.storage.session (runtime - Roadmap v5.2 schema)
  TAB_STATE: 'tabState',
  ACTIVE_TAB_ID: 'activeTabId',
  ZOOM_HISTORY: 'zoomHistory',
  ACTIVE_SIGNALS: 'activeSignals',
  PERFORMANCE_METRICS: 'performance-metrics',
  PENDING_POPUP: 'pendingPopup', // POPUP_READY pattern (MV3 resilience)
  CSS_REGISTRY: 'cssRegistry',
  SMARTSCOPE_STATUS: 'smartScopeStatus',
  RUNTIME_STATE: 'runtimeState',
  SIGNAL_SNAPSHOTS: 'signalSnapshots',
  POLICY_STATE: 'policyState',
  OUTCOME_LEDGER_V1: 'outcomeLedgerV1',
  SHADOW_REPLAY_LEDGER_V1: 'shadowReplayLedgerV1',
  DEBUG_SIGNAL_EVENTS: 'debugSignalEvents',
  DEBUG_DECISION_EVENTS: 'debugDecisionEvents',
  LIFECYCLE_JOURNAL_V1: 'lifecycleJournalV1'
};

// ========== SITE POLICY BLOCK REASONS ==========
export const SITE_BLOCK_REASONS = {
  UNSUPPORTED_SCHEME: 'UNSUPPORTED_SCHEME',
  REPEATED_APPLY_FAILURE: 'REPEATED_APPLY_FAILURE',
  NO_RECEIVER: 'NO_RECEIVER',
  USER_DISABLED_FOR_HOST: 'USER_DISABLED_FOR_HOST',
  OVERRIDE_ACTIVE: 'OVERRIDE_ACTIVE'
};

// ========== ERROR CODES ==========
export const ERROR_CODES = {
  CSS_INJECTION_FAILED: 'CSS_INJECTION_FAILED',
  BANNER_INJECTION_FAILED: 'BANNER_INJECTION_FAILED',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INVALID_TAB_ID: 'INVALID_TAB_ID'
};

// ========== ZOOM DETECTION ==========
export const ZOOM_CONFIG = {
  MIN_FACTOR: 1.2,           // Zoom > 120% considéré comme signal
  HISTORY_SIZE: 10,          // Garder 10 derniers events
  PATTERN_WINDOW: 5 * 60 * 1000, // 5 minutes
  PATTERN_THRESHOLD: 2       // 2+ zooms en 5min = pattern
};

// ========== READING BEHAVIOR ==========
export const READING_CONFIG = {
  SCROLL_THRESHOLD: 3,       // 3+ scrolls en 10s
  SCROLL_WINDOW: 10 * 1000,  // 10 secondes
  SELECTION_MIN_LENGTH: 20   // Sélection ≥ 20 chars
};
