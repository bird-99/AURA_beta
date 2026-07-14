import {
  ACTIONS,
  MODE_IDS,
  MODES,
  MODE_PREFS_DEFAULTS,
  SMARTSCOPE_LEVELS,
  STORAGE_KEYS,
  LEARNING_STAGES,
} from '../shared/constants.js';
import {
  buildExportPayload,
  downloadExport,
  importPayloadAndApply,
} from '../shared/data-portability.js';
import {
  COMFORT_VISUAL_PREF_FEATURE_IDS,
  COMFORT_VISUAL_SAFETY_PREF_KEYS,
  mergeComfortVisualPrefs,
  normalizeComfortVisualPrefs,
} from '../shared/comfort-visual-prefs.js';
import { FEATURE_IDS } from '../shared/engine-core/index.js';
import { buildModeFeatureUiModelV1 } from '../shared/mode-feature-ui.js';
import {
  extractDomain,
  mutateLocalValue,
  parseStrictDomainInput,
  removeLocalValue,
  runStorageAreaTransaction,
} from '../shared/utils.js';
import {
  PROFILE_ACTIONS,
  normalizeSiteProfiles,
  parseProfileTarget,
} from '../shared/site-profiles.js';
import {
  createModeEngineDiagnosticsController,
  createModeEngineDiagnosticsView,
} from './modeengine-diagnostics.js';
import {
  createOptionsDataManagementController,
  createOptionsDataManagementView,
} from './data-management.js';
import {
  createOptionsLearningManagementController,
  createOptionsLearningManagementView,
} from './learning-management.js';
import {
  createOptionsDomainConfigurationController,
  createOptionsDomainConfigurationView,
} from './domain-configuration.js';

/** @typedef {"success"|"error"|"info"} StatusKind */

/** @typedef {{
 * bannerPosition: "top"|"bottom",
 * displayDensity: "compact"|"comfortable",
 * reducedMotion: boolean,
 * highContrast: boolean,
 * suggestionThreshold: number,
 * autoThreshold: number,
 * cooldownDuration: number,
 * spaDetectionEnabled: boolean,
 * focusDefaultEnabled: boolean,
 * }} UserPrefs
 */

const statusEl = document.getElementById('inline-status');
const statusRetryBtn = document.getElementById('status-retry');
const inlineWarning = document.getElementById('inline-warning');
const suggestionSlider = document.getElementById('suggestion-threshold');
const autoSlider = document.getElementById('auto-threshold');
const suggestionValue = document.getElementById('suggestion-threshold-value');
const autoValue = document.getElementById('auto-threshold-value');
const cooldownSelect = document.getElementById('cooldown-duration');
const spaToggle = document.getElementById('spa-toggle');
const spaStatus = document.getElementById('spa-status');
const smartScopeToggle = document.getElementById('smartscope-toggle');
const smartScopeLevel = document.getElementById('smartscope-level');
const smartScopeLevelField = document.getElementById('smartscope-level-field');
const smartScopeDomainInput = document.getElementById('smartscope-domain');
const smartScopeDomainLevel = document.getElementById('smartscope-domain-level');
const smartScopeDomainEnabled = document.getElementById('smartscope-domain-enabled');
const smartScopeDomainSave = document.getElementById('smartscope-domain-save');
const smartScopeDomainFeedback = document.getElementById('smartscope-domain-feedback');
const smartScopeDomainList = document.getElementById('smartscope-domain-list');
const smartScopeStatus = document.getElementById('smartscope-status');
const smartScopePanic = document.getElementById('smartscope-panic');
const smartScopeAdvancedTrigger = document.getElementById('smartscope-advanced-trigger');
const smartScopeAdvancedPanel = document.getElementById('smartscope-advanced-panel');
const smartScopeDebugToggle = document.getElementById('smartscope-debug-toggle');
const smartScopeDebugExport = document.getElementById('smartscope-debug-export');
const smartScopeDebugClear = document.getElementById('smartscope-debug-clear');
const smartScopeDebugStatus = document.getElementById('smartscope-debug-status');
const smartScopeRunStatus = document.getElementById('smartscope-run-status');
const smartScopeRunList = document.getElementById('smartscope-run-list');
const debugSnapshotStatus = document.getElementById('debug-snapshot-status');
const generalStatus = document.getElementById('status-general');
const comfortVisualStatus = document.getElementById('status-comfort-visual');
const focusStatus = document.getElementById('status-focus');
const suggestionsStatus = document.getElementById('status-suggestions');
const domainsStatus = document.getElementById('status-domains');
const smartScopeSectionStatus = document.getElementById('status-smartscope');
const learningStatus = document.getElementById('status-learning');
const dataStatus = document.getElementById('status-data');
const advancedStatus = document.getElementById('status-advanced');
const comfortVisualInputs = {
  textScale: document.getElementById('cv-text-scale'),
  spacingPack: document.getElementById('cv-spacing-pack'),
  linkEnhance: document.getElementById('cv-link-enhance'),
  typoSmoothing: document.getElementById('cv-typo-smoothing'),
  darkMode: document.getElementById('cv-dark-mode'),
};
const focusInputs = {
  distractionDim: document.getElementById('focus-distraction-dim'),
  overlayAlpha: document.getElementById('focus-overlay-alpha'),
  overlayBlur: document.getElementById('focus-overlay-blur'),
  readingRuler: document.getElementById('focus-reading-ruler'),
  readingRulerHeight: document.getElementById('focus-reading-ruler-height'),
  readingRulerOpacity: document.getElementById('focus-reading-ruler-opacity'),
  ultraFocus: document.getElementById('focus-ultra-focus'),
  targetBoost: document.getElementById('focus-target-boost'),
  focusNotObscured: document.getElementById('focus-not-obscured'),
  reduceMotion: document.getElementById('focus-reduce-motion'),
};
const focusDefaultToggle = document.getElementById('focus-default-enabled');
const FOCUS_PREF_FEATURE_IDS = Object.freeze({
  distractionDim: FEATURE_IDS.DISTRACTION_DIM,
  overlayBlur: FEATURE_IDS.OVERLAY_BLUR,
  readingRuler: FEATURE_IDS.READING_RULER,
  ultraFocus: FEATURE_IDS.ULTRA_FOCUS,
  targetBoost: FEATURE_IDS.TARGET_BOOST,
  focusNotObscured: FEATURE_IDS.FOCUS_NOT_OBSCURED,
  reduceMotion: FEATURE_IDS.REDUCE_MOTION,
});
const MODE_FEATURE_MODELS = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: buildModeFeatureUiModelV1(MODE_IDS.COMFORT_VISUAL),
  [MODE_IDS.FOCUS]: buildModeFeatureUiModelV1(MODE_IDS.FOCUS),
});

let currentUserPrefs = null;
let currentComfortVisualPrefs = null;
let comfortVisualPrefWriteQueue = Promise.resolve();
let currentFocusPrefs = null;
let currentSmartScope = {
  enabled: true,
  level: SMARTSCOPE_LEVELS.CONSERVATIVE,
  perDomain: {},
};
let statusTimeoutId = null;
let lastRetryAction = null;
const sectionStatusMap = new Map([
  ['general', generalStatus],
  ['comfort-visual', comfortVisualStatus],
  ['focus', focusStatus],
  ['suggestions', suggestionsStatus],
  ['domains', domainsStatus],
  ['smartscope', smartScopeSectionStatus],
  ['learning', learningStatus],
  ['data', dataStatus],
  ['advanced', advancedStatus],
]);
const modeEngineDiagnosticsView = createModeEngineDiagnosticsView({
  document,
  reportStatus: showDebugSnapshotStatus,
});
const modeEngineDiagnostics = createModeEngineDiagnosticsController({
  listTabs: () => chrome.tabs.query({ currentWindow: true }),
  requestSnapshot: (tabId) => chrome.runtime.sendMessage({
    action: ACTIONS.GET_DEBUG_SNAPSHOT,
    tabId,
  }),
  downloadSnapshot: downloadExport,
  view: modeEngineDiagnosticsView,
});
const dataManagementView = createOptionsDataManagementView({
  document,
  reportInlineStatus: showInlineStatus,
  reportSectionStatus: showSectionStatus,
});
const dataManagement = createOptionsDataManagementController({
  buildExport: buildExportPayload,
  importAndApply: importPayloadAndApply,
  resetAll: async () => {
    const result = await chrome.runtime.sendMessage({ action: ACTIONS.RESET_ALL_DATA });
    if (result?.ok !== true) {
      throw new Error(result?.reason || result?.error || 'Reset failed');
    }
  },
  download: downloadExport,
  getVersion: () => chrome.runtime.getManifest().version,
  reloadState: loadAndRenderState,
  view: dataManagementView,
});
const learningManagementView = createOptionsLearningManagementView({
  document,
  reportInlineStatus: showInlineStatus,
  reportSectionStatus: showSectionStatus,
});
const learningManagement = createOptionsLearningManagementController({
  mutateLearning: (updater) => mutateLocalValue(STORAGE_KEYS.LEARNING_WEIGHTS, updater),
  view: learningManagementView,
  learningStages: LEARNING_STAGES,
});
const domainConfigurationView = createOptionsDomainConfigurationView({
  document,
  reportInlineStatus: showInlineStatus,
  reportSectionStatus: showSectionStatus,
});
const domainConfiguration = createOptionsDomainConfigurationController({
  mutateLists: (updater) => runStorageAreaTransaction('local', async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST]);
    const committed = await updater({
      allowlist: stored[STORAGE_KEYS.ALLOWLIST],
      denylist: stored[STORAGE_KEYS.DENYLIST],
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.ALLOWLIST]: committed.allowlist,
      [STORAGE_KEYS.DENYLIST]: committed.denylist,
    });
    return committed;
  }),
  mutateProfiles: (updater) => mutateLocalValue(STORAGE_KEYS.SITE_PROFILES, updater),
  normalizeDomain: normalizeAndValidateDomain,
  parseProfileTarget,
  normalizeProfiles: normalizeSiteProfiles,
  profileActions: PROFILE_ACTIONS,
  defaultModeId: MODE_IDS.COMFORT_VISUAL,
  createProfileId: (timestamp) => (
    crypto?.randomUUID ? crypto.randomUUID() : `profile-${timestamp}-${Math.random().toString(16).slice(2)}`
  ),
  view: domainConfigurationView,
});

export async function initOptionsPage() {
  document.addEventListener('DOMContentLoaded', async () => {
    await loadAndRenderState();
    handleWhyFallbackNotice();
    bindEvents();
    dataManagement.initialize();
    learningManagement.initialize();
    domainConfiguration.initialize();
  });
}

function shouldReduceMotionInOptions() {
  if (currentUserPrefs?.reducedMotion === true) {
    return true;
  }

  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch (_) {
    return false;
  }
}

function getOptionsScrollBehavior() {
  return shouldReduceMotionInOptions() ? 'auto' : 'smooth';
}

function handleWhyFallbackNotice() {
  if (!inlineWarning) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('scrollTo') !== 'why') return;

  if (params.get('reason') === 'openPopup_failed') {
    inlineWarning.textContent = "Impossible d’ouvrir la popup automatiquement (UX dégradée).";
    inlineWarning.style.display = 'block';
    inlineWarning.scrollIntoView({ behavior: getOptionsScrollBehavior(), block: 'start' });
  }
}

async function loadAllStateForUI() {
  const { userPrefs, allowlist, denylist, learningWeights, perDomainPrefs, siteProfiles } = await chrome.storage.local.get([
    STORAGE_KEYS.USER_PREFS,
    STORAGE_KEYS.ALLOWLIST,
    STORAGE_KEYS.DENYLIST,
    STORAGE_KEYS.LEARNING_WEIGHTS,
    STORAGE_KEYS.PER_DOMAIN_PREFS,
    STORAGE_KEYS.SITE_PROFILES,
  ]);

  return {
    userPrefs: normalizeUserPrefs(userPrefs || {}),
    smartScope: normalizeSmartScopeConfig(userPrefs?.smartScope),
    allowlist: allowlist || [],
    denylist: denylist || [],
    learningWeights: learningWeights || {},
    userDecisions: perDomainPrefs || {},
    siteProfiles: normalizeSiteProfiles(siteProfiles || {}),
  };
}

function normalizeSmartScopeConfig(raw) {
  const base = {
    enabled: true,
    level: SMARTSCOPE_LEVELS.CONSERVATIVE,
    perDomain: {},
    debugEnabled: false,
  };

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const level = Object.values(SMARTSCOPE_LEVELS).includes(raw.level)
    ? raw.level
    : SMARTSCOPE_LEVELS.CONSERVATIVE;

  const perDomain = {};
  if (raw.perDomain && typeof raw.perDomain === 'object' && !Array.isArray(raw.perDomain)) {
    for (const [domain, cfg] of Object.entries(raw.perDomain)) {
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
      const domainLevel = Object.values(SMARTSCOPE_LEVELS).includes(cfg.level)
        ? cfg.level
        : level;
      perDomain[domain] = { enabled: cfg.enabled === true, level: domainLevel };
    }
  }

  return { ...base, level, perDomain, enabled: raw.enabled !== false, debugEnabled: raw.debugEnabled === true };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getComfortVisualPrefsFromModePrefs(modePrefs = {}) {
  const source = isPlainObject(modePrefs) ? modePrefs : {};
  return normalizeComfortVisualPrefs(source[MODE_IDS.COMFORT_VISUAL] ?? source.comfortVisual);
}

function withComfortVisualPrefs(modePrefs = {}, prefs = {}) {
  const source = isPlainObject(modePrefs) ? modePrefs : {};
  const normalized = normalizeComfortVisualPrefs(prefs);
  return {
    ...source,
    [MODE_IDS.COMFORT_VISUAL]: normalized,
    comfortVisual: normalized,
  };
}

function normalizeUserPrefs(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const normalized = { ...source };
  const modePrefs = isPlainObject(source.modePrefs) ? { ...source.modePrefs } : {};

  normalized.bannerPosition = source.bannerPosition === 'bottom' ? 'bottom' : 'top';
  normalized.displayDensity = source.displayDensity === 'compact' ? 'compact' : 'comfortable';
  normalized.reducedMotion = Boolean(source.reducedMotion);
  normalized.highContrast = Boolean(source.highContrast);
  normalized.suggestionThreshold = typeof source.suggestionThreshold === 'number' ? source.suggestionThreshold : 0.6;
  normalized.autoThreshold = typeof source.autoThreshold === 'number' ? source.autoThreshold : 0.85;
  normalized.cooldownDuration = typeof source.cooldownDuration === 'number' ? source.cooldownDuration : 86400000;
  normalized.spaDetectionEnabled = Boolean(source.spaDetectionEnabled);
  normalized.focusDefaultEnabled = source.focusDefaultEnabled === true;
  normalized.smartScope = normalizeSmartScopeConfig(source.smartScope);
  Object.assign(modePrefs, withComfortVisualPrefs(modePrefs, getComfortVisualPrefsFromModePrefs(modePrefs)));
  modePrefs[MODE_IDS.FOCUS] = normalizeFocusPrefs(modePrefs[MODE_IDS.FOCUS]);
  normalized.modePrefs = modePrefs;

  return normalized;
}

async function loadAndRenderState() {
  const state = await loadAllStateForUI();
  currentUserPrefs = state.userPrefs;
  currentSmartScope = state.smartScope;
  currentUserPrefs.smartScope = currentSmartScope;

  renderUserPrefs();
  domainConfiguration.setState({
    allowlist: state.allowlist,
    denylist: state.denylist,
    profiles: state.siteProfiles,
  });
  learningManagement.setState({
    learning: state.learningWeights,
    decisions: state.userDecisions,
  });
  renderSmartScopeSection();
  await refreshSmartScopeStatus();
  await modeEngineDiagnostics.initialize();
}

function renderUserPrefs() {
  document.querySelectorAll('input[name="banner-position"]').forEach((input) => {
    input.checked = input.value === currentUserPrefs.bannerPosition;
  });
  document.querySelectorAll('input[name="display-density"]').forEach((input) => {
    input.checked = input.value === currentUserPrefs.displayDensity;
  });
  document.getElementById('reduced-motion').checked = currentUserPrefs.reducedMotion;
  document.getElementById('high-contrast').checked = currentUserPrefs.highContrast;

  suggestionSlider.value = currentUserPrefs.suggestionThreshold;
  autoSlider.value = currentUserPrefs.autoThreshold;
  cooldownSelect.value = String(currentUserPrefs.cooldownDuration);
  suggestionValue.textContent = Number(currentUserPrefs.suggestionThreshold).toFixed(2);
  autoValue.textContent = Number(currentUserPrefs.autoThreshold).toFixed(2);
  spaToggle.checked = currentUserPrefs.spaDetectionEnabled;
  if (focusDefaultToggle) {
    focusDefaultToggle.checked = currentUserPrefs.focusDefaultEnabled === true;
  }
  renderComfortVisualControls();
  renderFocusControls(currentUserPrefs);
}

function renderComfortVisualControls() {
  currentComfortVisualPrefs = getComfortVisualPrefsFromModePrefs(currentUserPrefs?.modePrefs);
  Object.entries(comfortVisualInputs).forEach(([key, input]) => {
    if (!input) return;
    input.checked = Boolean(currentComfortVisualPrefs[key]);
  });
  applyComfortVisualFeaturePolicies();
}

function normalizeFocusPrefs(raw) {
  const defaults = MODE_PREFS_DEFAULTS?.[MODE_IDS.FOCUS] || {
    distractionDim: false,
    targetBoost: false,
    reduceMotion: false,
    readingRuler: false,
    focusNotObscured: true,
  };
  const base = { ...defaults };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  Object.keys(base).forEach((key) => {
    if (typeof raw[key] === 'boolean') {
      base[key] = raw[key];
    }
  });
  base.focusNotObscured = true;

  return base;
}

function normalizeRange(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function getModeFeature(modeId, featureId) {
  const sections = MODE_FEATURE_MODELS[modeId]?.sections || [];
  for (const section of sections) {
    const feature = section.features.find((candidate) => candidate.featureId === featureId);
    if (feature) return feature;
  }
  return null;
}

function annotateFeatureControl(input, feature) {
  if (!input || !feature) return;
  const field = input.closest('.field');
  if (!field) return;
  field.dataset.featureId = feature.featureId;
  field.dataset.controlPolicy = feature.controlPolicy;
  field.dataset.availability = feature.availability;
  if (feature.dependsOnFeatureId) {
    field.dataset.dependsOnFeatureId = feature.dependsOnFeatureId;
  } else {
    delete field.dataset.dependsOnFeatureId;
  }
}

function applyComfortVisualFeaturePolicies() {
  Object.entries(COMFORT_VISUAL_PREF_FEATURE_IDS).forEach(([key, featureId]) => {
    const input = comfortVisualInputs[key];
    const feature = getModeFeature(MODE_IDS.COMFORT_VISUAL, featureId);
    annotateFeatureControl(input, feature);
    if (!input) return;
    if (COMFORT_VISUAL_SAFETY_PREF_KEYS.includes(key) || feature?.controlPolicy === 'always_on') {
      input.checked = true;
      input.disabled = true;
    } else {
      input.disabled = false;
    }
  });
}

function applyFocusFeaturePolicies() {
  Object.entries(FOCUS_PREF_FEATURE_IDS).forEach(([key, featureId]) => {
    const input = focusInputs[key];
    const feature = getModeFeature(MODE_IDS.FOCUS, featureId);
    annotateFeatureControl(input, feature);
  });

  if (focusInputs.focusNotObscured) {
    focusInputs.focusNotObscured.checked = true;
    focusInputs.focusNotObscured.disabled = true;
  }

  if (focusInputs.overlayBlur) {
    const overlayBlurFeature = getModeFeature(MODE_IDS.FOCUS, FEATURE_IDS.OVERLAY_BLUR);
    annotateFeatureControl(focusInputs.overlayBlur, overlayBlurFeature);
    focusInputs.overlayBlur.disabled = currentFocusPrefs?.distractionDim !== true;
  }
}

function renderFocusControls(userPrefs = currentUserPrefs) {
  const focusModeId = MODE_IDS.FOCUS;
  const modePrefs = isPlainObject(userPrefs?.modePrefs) ? userPrefs.modePrefs : {};
  const rawFocusPrefs = modePrefs[focusModeId];
  currentFocusPrefs = normalizeFocusPrefs(rawFocusPrefs);

  if (focusInputs.distractionDim) {
    focusInputs.distractionDim.checked = currentFocusPrefs.distractionDim === true;
  }
  if (focusInputs.readingRuler) {
    focusInputs.readingRuler.checked = currentFocusPrefs.readingRuler === true;
  }
  if (focusInputs.ultraFocus) {
    focusInputs.ultraFocus.checked = false;
    focusInputs.ultraFocus.disabled = true;
  }
  if (focusInputs.targetBoost) {
    focusInputs.targetBoost.checked = currentFocusPrefs.targetBoost === true;
  }
  if (focusInputs.focusNotObscured) {
    focusInputs.focusNotObscured.checked = currentFocusPrefs.focusNotObscured === true;
  }
  if (focusInputs.reduceMotion) {
    focusInputs.reduceMotion.checked = currentFocusPrefs.reduceMotion === true;
  }

  const rawAlpha = userPrefs?.focusOverlayAlpha ?? rawFocusPrefs?.distractionDimAlpha;
  const rawBlur = userPrefs?.focusOverlayBlurPx ?? rawFocusPrefs?.distractionDimBlurPx;
  const rawHeight = userPrefs?.readingRulerHeightPx ?? rawFocusPrefs?.readingRulerHeightPx;
  const rawOpacity = userPrefs?.readingRulerOpacity ?? rawFocusPrefs?.readingRulerOpacity;

  if (focusInputs.overlayAlpha) {
    focusInputs.overlayAlpha.value = normalizeRange(rawAlpha, 0, 1, 0.2);
  }
  if (focusInputs.overlayBlur) {
    focusInputs.overlayBlur.value = normalizeRange(rawBlur, 0, 24, 0);
  }
  if (focusInputs.readingRulerHeight) {
    focusInputs.readingRulerHeight.value = normalizeRange(rawHeight, 40, 400, 120);
  }
  if (focusInputs.readingRulerOpacity) {
    focusInputs.readingRulerOpacity.value = normalizeRange(rawOpacity, 0, 0.6, 0.12);
  }
  applyFocusFeaturePolicies();
}

function renderSmartScopeSection() {
  if (!smartScopeToggle) return;
  smartScopeToggle.checked = currentSmartScope.enabled === true;
  smartScopeLevel.value = currentSmartScope.level || SMARTSCOPE_LEVELS.CONSERVATIVE;
  smartScopeLevelField.hidden = !currentSmartScope.enabled;
  if (smartScopeAdvancedTrigger && smartScopeAdvancedPanel) {
    const disabled = !currentSmartScope.enabled;
    smartScopeAdvancedTrigger.disabled = disabled;
    smartScopeAdvancedTrigger.setAttribute('aria-disabled', String(disabled));
    if (disabled) {
      smartScopeAdvancedTrigger.setAttribute('aria-expanded', 'false');
      smartScopeAdvancedPanel.hidden = true;
    }
  }
  if (smartScopeDebugToggle) {
    smartScopeDebugToggle.checked = currentSmartScope.debugEnabled === true;
  }
  renderSmartScopeOverrideList();
}

function renderSmartScopeOverrideList() {
  smartScopeDomainList.innerHTML = '';
  const entries = Object.entries(currentSmartScope.perDomain || {});
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.textContent = 'No overrides';
    smartScopeDomainList.appendChild(li);
    return;
  }

  entries.forEach(([domain, cfg]) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    const span = document.createElement('span');
    span.textContent = `${domain} — ${cfg.enabled ? 'enabled' : 'disabled'} (${cfg.level})`;
    const btn = document.createElement('button');
    btn.className = 'btn danger';
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      const perDomain = { ...currentSmartScope.perDomain };
      delete perDomain[domain];
      await persistSmartScopeConfig({ perDomain });
    });
    li.append(span, btn);
    smartScopeDomainList.appendChild(li);
  });
}

async function refreshSmartScopeStatus() {
  if (!smartScopeRunStatus || !smartScopeRunList) return;

  smartScopeRunList.innerHTML = '';
  let activeTabId = null;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs?.[0]?.id || null;
  } catch (error) {
    activeTabId = null;
  }

  if (!activeTabId) {
    renderSmartScopeRunList([
      {
        modeId: null,
        status: { action: 'apply', ok: false, error: 'No active tab', timestamp: Date.now() },
      },
    ]);
    smartScopeRunStatus.hidden = false;
    return;
  }

  const entries = [];
  for (const modeId of Object.values(MODES)) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_STATE,
        tabId: activeTabId,
        modeId,
      });
      entries.push({ modeId, status: response?.state?.smartScopeStatus || null });
    } catch (error) {
      entries.push({
        modeId,
        status: { action: 'verify', ok: false, error: error?.message || 'CS_UNREACHABLE', timestamp: Date.now() },
      });
    }
  }

  renderSmartScopeRunList(entries);
  smartScopeRunStatus.hidden = false;
}

function renderSmartScopeRunList(entries) {
  smartScopeRunList.innerHTML = '';
  const meaningful = entries.filter((entry) => entry.status);

  if (!meaningful.length) {
    const empty = document.createElement('li');
    empty.className = 'list-item';
    empty.textContent = 'No SmartScope activity yet.';
    smartScopeRunList.appendChild(empty);
    return;
  }

  meaningful.forEach(({ modeId, status }) => {
    const li = document.createElement('li');
    li.className = `list-item${status.ok === false ? ' warn' : ''}`;
    const title = document.createElement('div');
    title.className = 'list-title';
    const action = formatSmartScopeAction(status.action);
    title.textContent = `${modeId || 'unknown'} — ${action}`;
    const meta = document.createElement('div');
    meta.className = 'list-meta';
    const label = status.ok === false ? 'failed' : 'ok';
    const timestamp = status.timestamp ? new Date(status.timestamp).toLocaleString() : '—';
    meta.textContent = `${label} • ${timestamp}${status.error ? ` • ${status.error}` : ''}`;
    li.append(title, meta);
    smartScopeRunList.appendChild(li);
  });
}

function formatSmartScopeAction(action) {
  if (!action) return 'unknown';
  const normalized = String(action).toLowerCase();
  if (['apply', 'restore', 'verify', 'cleanup'].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function bindEvents() {
  setupNavigation();
  setupAccordions();

  if (statusRetryBtn) {
    statusRetryBtn.addEventListener('click', async () => {
      if (typeof lastRetryAction === 'function') {
        const retry = lastRetryAction;
        lastRetryAction = null;
        statusRetryBtn.hidden = true;
        await retry();
      }
    });
  }

  document.querySelectorAll('input[name="banner-position"]').forEach((input) => {
    input.addEventListener('change', () =>
      persistUserPrefs({ bannerPosition: input.value }, { sectionId: 'general' }),
    );
  });
  document.querySelectorAll('input[name="display-density"]').forEach((input) => {
    input.addEventListener('change', () =>
      persistUserPrefs({ displayDensity: input.value }, { sectionId: 'general' }),
    );
  });
  document.getElementById('reduced-motion').addEventListener('change', async (e) => {
    await persistUserPrefs({ reducedMotion: e.target.checked }, { sectionId: 'general' });
    await requestReapplyActiveTab('prefs:reducedMotion');
  });
  document.getElementById('high-contrast').addEventListener('change', (e) => {
    persistUserPrefs({ highContrast: e.target.checked }, { sectionId: 'general' });
  });
  bindComfortVisualControls();
  bindFocusControls(currentUserPrefs);
  if (focusDefaultToggle) {
    focusDefaultToggle.addEventListener('change', async (event) => {
      await persistUserPrefs({ focusDefaultEnabled: event.target.checked }, { sectionId: 'focus' });
      await requestReapplyActiveTab('prefs:focusDefaultEnabled');
    });
  }

  suggestionSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    suggestionValue.textContent = val.toFixed(2);
  });
  suggestionSlider.addEventListener('change', async (e) => {
    const val = clampThreshold(Number(e.target.value));
    suggestionSlider.value = val;
    suggestionValue.textContent = Number(val).toFixed(2);
    await persistUserPrefs({ suggestionThreshold: val }, { sectionId: 'suggestions' });
    await requestReapplyActiveTab('prefs:suggestionThreshold');
  });

  autoSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    autoValue.textContent = val.toFixed(2);
  });
  autoSlider.addEventListener('change', async (e) => {
    const val = clampThreshold(Number(e.target.value));
    autoSlider.value = val;
    autoValue.textContent = Number(val).toFixed(2);
    await persistUserPrefs({ autoThreshold: val }, { sectionId: 'suggestions' });
    await requestReapplyActiveTab('prefs:autoThreshold');
  });

  cooldownSelect.addEventListener('change', async (e) => {
    await persistUserPrefs({ cooldownDuration: Number(e.target.value) }, { sectionId: 'suggestions' });
    await requestReapplyActiveTab('prefs:cooldownDuration');
  });

  spaToggle.addEventListener('change', async (e) => {
    await onToggleSpaSupport(e.target.checked);
  });

  smartScopeDomainInput.addEventListener('blur', () => {
    handleDomainBlur(smartScopeDomainInput.value, smartScopeDomainFeedback);
  });

  smartScopeToggle.addEventListener('change', async () => {
    smartScopeLevelField.hidden = !smartScopeToggle.checked;
    await persistSmartScopeConfig(
      { enabled: smartScopeToggle.checked, level: smartScopeLevel.value },
      { sectionId: 'smartscope' },
    );
  });

  smartScopeLevel.addEventListener('change', async (e) => {
    await persistSmartScopeConfig({ level: e.target.value }, { sectionId: 'smartscope' });
  });

  smartScopeDomainSave.addEventListener('click', async () => {
    const validation = normalizeAndValidateDomain(smartScopeDomainInput.value);
    if (!validation.ok) {
      showSmartScopeStatus('error', validation.reason);
      setInlineFeedback(smartScopeDomainFeedback, validation.reason);
      return;
    }

    const domain = validation.domain;
    const perDomain = {
      ...currentSmartScope.perDomain,
      [domain]: {
        enabled: smartScopeDomainEnabled.checked,
        level: smartScopeDomainLevel.value,
      },
    };
    await persistSmartScopeConfig({ perDomain });
    renderSmartScopeOverrideList();
    smartScopeDomainInput.value = '';
    setInlineFeedback(smartScopeDomainFeedback, '');
  });

  if (smartScopePanic) {
    smartScopePanic.addEventListener('click', onPanicResetClicked);
  }

  if (smartScopeDebugToggle) {
    smartScopeDebugToggle.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      await persistSmartScopeConfig(
        { debugEnabled: enabled },
        {
          statusHandler: showSmartScopeDebugStatus,
          statusMessage: enabled
            ? 'SmartScope debug logging enabled'
            : 'SmartScope debug logging disabled',
          sectionId: 'smartscope',
        },
      );
    });
  }

  if (smartScopeDebugExport) {
    smartScopeDebugExport.addEventListener('click', exportSmartScopeDebugLogs);
  }

  if (smartScopeDebugClear) {
    smartScopeDebugClear.addEventListener('click', clearSmartScopeDebugLogs);
  }

  modeEngineDiagnosticsView.bind({
    onRefresh: () => modeEngineDiagnostics.refresh({ showStatus: true, reloadTargets: true }),
    onExport: () => modeEngineDiagnostics.exportSnapshot(),
    onSelect: (tabId) => modeEngineDiagnostics.selectTarget(tabId),
  });
  window.addEventListener('pagehide', () => {
    dataManagement.dispose();
    learningManagement.dispose();
    modeEngineDiagnostics.dispose();
  }, { once: true });
}

function bindComfortVisualControls() {
  Object.entries(comfortVisualInputs).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', (event) =>
      updateComfortVisualPref(key, event.target.checked, { sectionId: 'comfort-visual' }),
    );
  });
}

function bindFocusControls(userPrefs = currentUserPrefs) {
  if (userPrefs) {
    currentUserPrefs = userPrefs;
  }
  const checkboxMap = {
    distractionDim: focusInputs.distractionDim,
    readingRuler: focusInputs.readingRuler,
    targetBoost: focusInputs.targetBoost,
    focusNotObscured: focusInputs.focusNotObscured,
    reduceMotion: focusInputs.reduceMotion,
  };

  Object.entries(checkboxMap).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', (event) =>
      updateFocusPrefs({ [key]: event.target.checked }, { sectionId: 'focus' }),
    );
  });

  if (focusInputs.overlayAlpha) {
    focusInputs.overlayAlpha.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 0, 1, 0.2);
      focusInputs.overlayAlpha.value = value;
      updateFocusPrefs({ distractionDimAlpha: value }, { sectionId: 'focus' });
    });
  }

  if (focusInputs.overlayBlur) {
    focusInputs.overlayBlur.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 0, 24, 0);
      focusInputs.overlayBlur.value = value;
      updateFocusPrefs({ distractionDimBlurPx: value }, { sectionId: 'focus' });
    });
  }

  if (focusInputs.readingRulerHeight) {
    focusInputs.readingRulerHeight.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 40, 400, 120);
      focusInputs.readingRulerHeight.value = value;
      updateFocusPrefs({ readingRulerHeightPx: value }, { sectionId: 'focus' });
    });
  }

  if (focusInputs.readingRulerOpacity) {
    focusInputs.readingRulerOpacity.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 0, 0.6, 0.12);
      focusInputs.readingRulerOpacity.value = value;
      updateFocusPrefs({ readingRulerOpacity: value }, { sectionId: 'focus' });
    });
  }
}

function setupNavigation() {
  const navLinks = Array.from(document.querySelectorAll('[data-section-link]'));
  const isAutoScrollingRef = { current: false };
  const autoScrollTargetIdRef = { current: null };
  const autoScrollUnlockTimerRef = { current: null };
  const getLinkSectionId = (link) => {
    const explicit = link.dataset.sectionLink;
    if (explicit) return explicit;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#')) return href.slice(1);
    return href;
  };
  const setActiveSection = (sectionId) => {
    if (!sectionId) return;
    navLinks.forEach((link) => {
      const linkSectionId = getLinkSectionId(link);
      const isActive = linkSectionId === sectionId;
      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };
  const unlockAutoScroll = () => {
    isAutoScrollingRef.current = false;
    autoScrollTargetIdRef.current = null;
    if (autoScrollUnlockTimerRef.current) {
      window.clearTimeout(autoScrollUnlockTimerRef.current);
      autoScrollUnlockTimerRef.current = null;
    }
  };
  const startAutoScrollUnlockDebounce = () => {
    if (autoScrollUnlockTimerRef.current) {
      window.clearTimeout(autoScrollUnlockTimerRef.current);
    }
    autoScrollUnlockTimerRef.current = window.setTimeout(() => {
      unlockAutoScroll();
    }, 200);
  };
  const jumpToSection = (sectionId) => {
    if (!sectionId) return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    setActiveSection(sectionId);
    isAutoScrollingRef.current = true;
    autoScrollTargetIdRef.current = sectionId;
    target.scrollIntoView({ behavior: getOptionsScrollBehavior(), block: 'start' });
    startAutoScrollUnlockDebounce();
  };

  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href')?.slice(1);
      event.preventDefault();
      jumpToSection(targetId);
    });
  });

  const sections = Array.from(document.querySelectorAll('[data-section]'));
  if (!sections.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (isAutoScrollingRef.current) {
          if (entry.target.id !== autoScrollTargetIdRef.current) {
            return;
          }
          setActiveSection(entry.target.id);
          unlockAutoScroll();
          return;
        }
        setActiveSection(entry.target.id);
      });
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0.1 },
  );

  sections.forEach((section) => observer.observe(section));

  const initialHash = window.location.hash?.slice(1);
  if (initialHash) {
    setActiveSection(initialHash);
  }

  window.addEventListener(
    'scroll',
    () => {
      if (isAutoScrollingRef.current) {
        startAutoScrollUnlockDebounce();
      }
    },
    { passive: true },
  );
}

function setupAccordions() {
  const triggers = Array.from(document.querySelectorAll('.accordion-trigger'));
  triggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const panelId = trigger.getAttribute('aria-controls');
      if (!panelId) return;
      const panel = document.getElementById(panelId);
      if (!panel) return;
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
    });
  });
}

function setInlineFeedback(element, message) {
  if (!element) return;
  element.textContent = message;
}

function handleDomainBlur(value, feedbackEl) {
  if (!feedbackEl) return;
  if (!value.trim()) {
    setInlineFeedback(feedbackEl, '');
    return;
  }
  const validation = normalizeAndValidateDomain(value);
  setInlineFeedback(feedbackEl, validation.ok ? '' : validation.reason);
}

async function requestReapplyActiveTab(reason) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    if (!Number.isFinite(tabId)) {
      return;
    }
    await chrome.runtime.sendMessage({
      action: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES,
      tabId,
      reason,
    });
  } catch (error) {
    console.warn('[optionsPage] Failed to request reapply for active tab', error);
  }
}

async function updateComfortVisualPref(key, value, options = {}) {
  const runUpdate = async () => {
    const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
    const basePrefs = getComfortVisualPrefsFromModePrefs(modePrefs);
    const mergedPrefs = mergeComfortVisualPrefs(basePrefs, { [key]: value });
    await persistUserPrefs({ modePrefs: withComfortVisualPrefs(modePrefs, mergedPrefs) }, options);
    currentComfortVisualPrefs = mergedPrefs;
    renderComfortVisualControls();
    await requestReapplyActiveTab('prefs:comfortVisual');
  };

  const nextWrite = comfortVisualPrefWriteQueue.catch(() => {}).then(runUpdate);
  comfortVisualPrefWriteQueue = nextWrite.catch(() => {});
  return nextWrite;
}

async function updateFocusPrefs(patch, options = {}) {
  const focusModeId = MODE_IDS.FOCUS;
  const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
  const rawFocusPrefs = isPlainObject(modePrefs[focusModeId]) ? modePrefs[focusModeId] : {};
  const basePrefs = normalizeFocusPrefs(rawFocusPrefs);
  const focusPatch = { ...rawFocusPrefs, ...basePrefs };
  const topLevelPatch = {};

  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === 'distractionDimAlpha') {
      focusPatch.distractionDimAlpha = value;
      topLevelPatch.focusOverlayAlpha = value;
    } else if (key === 'distractionDimBlurPx') {
      focusPatch.distractionDimBlurPx = value;
      topLevelPatch.focusOverlayBlurPx = value;
    } else if (key === 'readingRulerHeightPx') {
      focusPatch.readingRulerHeightPx = value;
      topLevelPatch.readingRulerHeightPx = value;
    } else if (key === 'readingRulerOpacity') {
      focusPatch.readingRulerOpacity = value;
      topLevelPatch.readingRulerOpacity = value;
    } else if (key === 'focusNotObscured') {
      focusPatch.focusNotObscured = true;
    } else if (Object.prototype.hasOwnProperty.call(basePrefs, key)) {
      focusPatch[key] = Boolean(value);
    }
  });
  focusPatch.focusNotObscured = true;

  await persistUserPrefs({
    ...topLevelPatch,
    modePrefs: {
      ...modePrefs,
      [focusModeId]: focusPatch,
    },
  }, options);
  currentFocusPrefs = normalizeFocusPrefs(focusPatch);
  renderFocusControls(currentUserPrefs);
  await requestReapplyActiveTab('prefs:focus');
}

async function persistUserPrefs(patch, options = {}) {
  try {
    currentUserPrefs = await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
      const current = isPlainObject(storedPrefs) ? storedPrefs : {};
      const next = { ...current, ...patch };

      if (isPlainObject(patch?.smartScope)) {
        next.smartScope = { ...(isPlainObject(current.smartScope) ? current.smartScope : {}), ...patch.smartScope };
      }

      if (isPlainObject(patch?.modePrefs)) {
        next.modePrefs = { ...(isPlainObject(current.modePrefs) ? current.modePrefs : {}), ...patch.modePrefs };
      }

      return next;
    });
    if (options.showStatus === false) {
      return;
    }
    const message = options.statusMessage || 'Saved ✓';
    showInlineStatus('success', message);
    showSectionStatus(options.sectionId, 'success', message);
  } catch (error) {
    const message = error?.message || 'Unable to save preferences';
    showInlineStatus('error', message, {
      retry: () => persistUserPrefs(patch, options),
    });
    showSectionStatus(options.sectionId, 'error', message);
  }
}

function showStatus(element, kind, message, options = {}) {
  if (!element) return;
  const { autoHide = true, timeout = 4000 } = options;
  element.textContent = message;
  element.className = `status-pill status-${kind}`;
  element.hidden = false;

  if (autoHide) {
    window.setTimeout(() => {
      element.hidden = true;
    }, timeout);
  }
}

function showInlineStatus(kind, message, options = {}) {
  if (!statusEl) return;
  if (statusTimeoutId) {
    window.clearTimeout(statusTimeoutId);
    statusTimeoutId = null;
  }
  const autoHide = kind !== 'error';
  const timeout = kind === 'success' ? 1800 : 4000;
  statusEl.textContent = message;
  statusEl.className = `status-pill status-${kind}`;
  statusEl.hidden = false;
  if (statusRetryBtn) {
    if (kind === 'error' && typeof options.retry === 'function') {
      statusRetryBtn.hidden = false;
      lastRetryAction = options.retry;
    } else {
      statusRetryBtn.hidden = true;
      lastRetryAction = null;
    }
  }
  if (autoHide) {
    statusTimeoutId = window.setTimeout(() => {
      statusEl.hidden = true;
      statusTimeoutId = null;
    }, timeout);
  }
}

function showSectionStatus(sectionId, kind, message) {
  if (!sectionId) return;
  const element = sectionStatusMap.get(sectionId);
  if (!element) return;
  const autoHide = kind !== 'error';
  const timeout = kind === 'success' ? 1800 : 4000;
  showStatus(element, kind, message, { autoHide, timeout });
}

function showSpaStatus(kind, message) {
  showStatus(spaStatus, kind, message, { autoHide: kind !== 'error' });
  showSectionStatus('advanced', kind, message);
}

function showSmartScopeStatus(kind, message) {
  showStatus(smartScopeStatus, kind, message, { autoHide: kind !== 'error' });
  showSectionStatus('smartscope', kind, message);
}

function showSmartScopeDebugStatus(kind, message) {
  showStatus(smartScopeDebugStatus, kind, message, { autoHide: kind !== 'error' });
}

function showDebugSnapshotStatus(kind, message) {
  showStatus(debugSnapshotStatus, kind, message, { autoHide: kind !== 'error' });
  showSectionStatus('advanced', kind, message);
}

function clampThreshold(val) {
  if (Number.isNaN(val)) return 0;
  return Math.min(1, Math.max(0, val));
}

async function onToggleSpaSupport(nextEnabled) {
  if (nextEnabled) {
    const hasPermission = await chrome.permissions.contains({ permissions: ['webNavigation'] });
    if (!hasPermission) {
      const granted = await chrome.permissions.request({ permissions: ['webNavigation'] });
      if (!granted) {
        spaToggle.checked = false;
        await persistUserPrefs({ spaDetectionEnabled: false }, { showStatus: false });
        showSpaStatus('error', 'Permission denied. SPA detection unavailable.');
        return;
      }
    }
    await persistUserPrefs({ spaDetectionEnabled: true }, { showStatus: false });
    showSpaStatus('success', 'Enhanced SPA support enabled.');
  } else {
    await chrome.permissions.remove({ permissions: ['webNavigation'] });
    await persistUserPrefs({ spaDetectionEnabled: false }, { showStatus: false });
    showSpaStatus('info', 'Enhanced SPA support disabled.');
  }
}

async function persistSmartScopeConfig(patch = {}, options = {}) {
  const merged = normalizeSmartScopeConfig({
    ...currentSmartScope,
    ...patch,
    perDomain: patch?.perDomain || currentSmartScope.perDomain,
  });

  const statusHandler = options.statusHandler || showSmartScopeStatus;
  const sectionId = options.sectionId || 'smartscope';

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.SMARTSCOPE_SET_CONFIG_V1,
      payload: merged,
    });

    if (response?.ok) {
      currentSmartScope = merged;
      currentUserPrefs = await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => ({
        ...(isPlainObject(storedPrefs) ? storedPrefs : {}),
        smartScope: merged,
      }));
      renderSmartScopeSection();

      if (options.showStatus === false) {
        return;
      }

      const statusKind = merged.enabled ? 'success' : 'info';
      const message =
        options.statusMessage ||
        (merged.enabled ? 'SmartScope settings saved' : 'SmartScope disabled. Baseline STRICT enforced.');
      statusHandler(statusKind, message);
      showSectionStatus(sectionId, statusKind, message);
      if (!merged.enabled && statusHandler === showSmartScopeStatus) {
        statusHandler('info', 'Use panic reset to clean open tabs if needed.');
      }
    } else {
      statusHandler('error', response?.error || 'Unable to save SmartScope settings');
      showSectionStatus(sectionId, 'error', response?.error || 'Unable to save SmartScope settings');
    }
  } catch (error) {
    statusHandler('error', error?.message || 'Unable to save SmartScope settings');
    showSectionStatus(sectionId, 'error', error?.message || 'Unable to save SmartScope settings');
  }
}

async function exportSmartScopeDebugLogs() {
  try {
    const data = await chrome.storage.local.get('smartScopeDebugLogs');
    const logs = Array.isArray(data.smartScopeDebugLogs) ? data.smartScopeDebugLogs : [];
    const date = new Date().toISOString().slice(0, 10);
    const filename = `aura-smartscope-debug-${date}.json`;
    downloadExport(logs, filename);
    showSmartScopeDebugStatus('success', 'SmartScope debug logs exported');
  } catch (error) {
    showSmartScopeDebugStatus('error', error?.message || 'Unable to export debug logs');
  }
}

async function clearSmartScopeDebugLogs() {
  try {
    await removeLocalValue('smartScopeDebugLogs');
    showSmartScopeDebugStatus('success', 'SmartScope debug logs cleared');
  } catch (error) {
    showSmartScopeDebugStatus('error', error?.message || 'Unable to clear debug logs');
  }
}

async function onPanicResetClicked() {
  try {
    const response = await chrome.runtime.sendMessage({ action: ACTIONS.SMARTSCOPE_RESET_V1 });
    if (response?.ok) {
      currentSmartScope = normalizeSmartScopeConfig();
      currentUserPrefs = await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => ({
        ...(isPlainObject(storedPrefs) ? storedPrefs : {}),
        smartScope: currentSmartScope,
      }));
      renderSmartScopeSection();
      const cleanedTabs = Number.isFinite(response.cleanedTabs) ? response.cleanedTabs : 0;
      showSmartScopeStatus('success', `SmartScope reset. Cleaned ${cleanedTabs} tab(s).`);
      if (response.errors?.length) {
        showSmartScopeStatus('info', `Warnings: ${response.errors.join(', ')}`);
      }
    } else {
      showSmartScopeStatus('error', response?.error || 'Reset failed');
    }
  } catch (error) {
    showSmartScopeStatus('error', error?.message || 'Reset failed');
  }
}

function normalizeAndValidateDomain(input) {
  const parsed = parseStrictDomainInput(input);
  if (!parsed.ok) return parsed;
  return { ok: true, domain: parsed.siteKey };
}

initOptionsPage();
