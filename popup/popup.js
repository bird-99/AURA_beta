import { MODE_IDS, STATES, ACTIONS, STORAGE_KEYS, SITE_BLOCK_REASONS, MODE_PREFS_DEFAULTS } from '../shared/constants.js';
import { FEATURE_IDS } from '../shared/engine-core/index.js';
import { initFeatureFlags, isFlagEnabled } from '../shared/feature-flags.js';
import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';
import { buildModeFeatureUiModelV1 } from '../shared/mode-feature-ui.js';
import {
  mergeComfortVisualPrefs,
  normalizeComfortVisualPrefs,
} from '../shared/comfort-visual-prefs.js';
import { extractDomain, mutateLocalValue } from '../shared/utils.js';
import { DEFAULT_FAVICON_URL, resolveFaviconUrl } from '../shared/ui/favicon.js';
import { getModeVisualState, getPopupStatusView } from './popup-state-view.js';

let currentTabId = null;
let currentTabUrl = null;
let currentTabFaviconUrl = null;
let smartScopeDebugEnabled = false;
let sitePolicy = null;
let sitePolicyError = false;
let sitePolicyRefreshTimeout = null;
let legacyDomainMigration = null;
let currentRecommendationModeId = null;
let modeButtonsRequestLocked = false;
let currentUserPrefs = {};
let modeFeaturePreferenceWriteQueue = Promise.resolve();
const smartScopeStatuses = {};
const modeStates = {};

const MODE_LABELS = {
  [MODE_IDS.COMFORT_VISUAL]: 'Comfort Visual',
  [MODE_IDS.FOCUS]: 'Focus',
};

const MODE_STATUS_IDS = {
  [MODE_IDS.COMFORT_VISUAL]: {
    chip: 'comfort-status',
    live: 'comfort-live',
  },
  [MODE_IDS.FOCUS]: {
    chip: 'focus-status',
    live: 'focus-live',
  },
};

const MODE_FEATURE_PREF_KEYS = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: Object.freeze({
    [FEATURE_IDS.TEXT_SCALE]: 'textScale',
    [FEATURE_IDS.SPACING_PACK]: 'spacingPack',
    [FEATURE_IDS.LINK_ENHANCEMENT]: 'linkEnhance',
    [FEATURE_IDS.TEXT_RENDERING_REFINEMENT]: 'typoSmoothing',
    [FEATURE_IDS.DARK_COMFORT_THEME]: 'darkMode',
  }),
  [MODE_IDS.FOCUS]: Object.freeze({
    [FEATURE_IDS.DISTRACTION_DIM]: 'distractionDim',
    [FEATURE_IDS.TARGET_BOOST]: 'targetBoost',
    [FEATURE_IDS.REDUCE_MOTION]: 'reduceMotion',
    [FEATURE_IDS.READING_RULER]: 'readingRuler',
  }),
});

const MODE_FEATURE_PANELS = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: {
    toggleId: 'comfort-features-toggle',
    panelId: 'comfort-features-panel',
  },
  [MODE_IDS.FOCUS]: {
    toggleId: 'focus-features-toggle',
    panelId: 'focus-features-panel',
  },
});

const MODE_FEATURE_QUICK_SLOTS = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: Object.freeze({
    slotId: 'comfort-dark-theme-slot',
    featureIds: Object.freeze([FEATURE_IDS.DARK_COMFORT_THEME]),
  }),
});

const MODE_FEATURE_CONTROL_IDS = Object.freeze({
  [MODE_IDS.COMFORT_VISUAL]: Object.freeze({
    [FEATURE_IDS.DARK_COMFORT_THEME]: Object.freeze({
      rowId: 'comfort-dark-theme-option',
      inputId: 'comfort-dark-theme-toggle',
      testId: 'comfort-dark-theme-option',
      inputTestId: 'comfort-dark-theme-toggle',
    }),
  }),
});

// ========== INIT ==========
async function init() {
  console.log('[Popup] Initializing');

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) {
    console.error('[Popup] No active tab');
    return;
  }

  currentTabId = tabs[0].id;
  currentTabUrl = tabs[0].url || null;
  currentTabFaviconUrl = tabs[0].favIconUrl || null;
  console.log('[Popup] Current tab:', currentTabId);

  await initFeatureFlags();
  await loadSmartScopeDebugFlag();
  await loadSitePolicy();
  await loadLegacyDomainMigration();
  await loadUserPrefs();
  renderCurrentSite();
  await loadModeStates();
  renderModeFeaturePanels();
  setupEventListeners();
  await handlePopupReady();
  chrome.runtime.onMessage.addListener(handleMessage);

  await loadPerformanceMetrics(currentTabId);
}

function renderCurrentSite() {
  const siteText = document.getElementById('current-site');
  if (!siteText) {
    return;
  }

  const siteKey = getSiteKeyFromUrl(currentTabUrl);
  siteText.textContent = siteKey || 'Unknown';

  const favicon = document.getElementById('site-favicon');
  if (favicon) {
    const resolved = resolveFaviconUrl({
      pageUrl: currentTabUrl,
      tabFavIconUrl: currentTabFaviconUrl,
      sizePx: 32,
    });

    const applyFallback = () => {
      favicon.src = DEFAULT_FAVICON_URL;
    };

    if (resolved.kind === 'fallback') {
      applyFallback();
    } else {
      favicon.addEventListener('error', applyFallback, { once: true });
      favicon.src = resolved.url;
    }

    favicon.classList.remove('is-hidden');
  }
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }
  element.classList.toggle('is-hidden', hidden);
}

function setAccordionExpanded(trigger, panel, expanded) {
  if (!trigger || !panel) {
    return;
  }
  trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  setHidden(panel, !expanded);
}

function updateAdvancedEmptyState() {
  const performanceSection = document.getElementById('performance-section');
  const smartScopeSection = document.getElementById('smartscope-status-section');
  const emptyState = document.getElementById('advanced-empty');
  if (!emptyState) {
    return;
  }

  const hasPerformance = performanceSection && !performanceSection.classList.contains('is-hidden');
  const hasSmartScope = smartScopeSection && !smartScopeSection.classList.contains('is-hidden');
  setHidden(emptyState, hasPerformance || hasSmartScope);
}

// ========== POPUP_READY PATTERN ==========
async function handlePopupReady() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.POPUP_READY
    });

    const pendingAction =
      response?.pendingAction ||
      (response?.action
        ? { action: response.action, tabId: response.tabId, modeId: response.modeId }
        : null);
    if (pendingAction && pendingAction.action === ACTIONS.SCROLL_TO_WHY) {
      console.log('[Popup] Pending Why action detected:', pendingAction.modeId);
      showWhySection(pendingAction.modeId);
    }
  } catch (error) {
    console.error('[Popup] POPUP_READY error:', error);
  }
}

// ========== PERFORMANCE METRICS ==========
async function loadPerformanceMetrics(tabId) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.GET_PERFORMANCE_METRICS,
    });

    const metrics = response?.metrics;
    const performanceSection = document.getElementById('performance-section');
    if (!metrics) {
      setHidden(performanceSection, true);
      updateAdvancedEmptyState();
      return;
    }

    setHidden(performanceSection, false);

    const operationsElement = document.getElementById('metric-operations');
    if (operationsElement) {
      const hasOperations = Number.isFinite(metrics.operationsPerMinute);
      const roundedOps = hasOperations ? Math.round(metrics.operationsPerMinute) : null;
      operationsElement.textContent = hasOperations ? `${roundedOps} ops/min` : '--';
    }

    const latencyElement = document.getElementById('metric-latency');
    if (latencyElement) {
      const hasLatency = Number.isFinite(metrics.averageLatency);
      const roundedLatency = hasLatency ? Math.round(metrics.averageLatency) : null;
      latencyElement.textContent = hasLatency ? `${roundedLatency}ms avg` : '--ms avg';
    }

    const heapElement = document.getElementById('metric-heap');
    if (heapElement) {
      if (metrics.heapDelta === null || !Number.isFinite(metrics.heapDelta)) {
        heapElement.textContent = 'N/A';
      } else {
        const sign = metrics.heapDelta >= 0 ? '+' : '';
        heapElement.textContent = `${sign}${metrics.heapDelta.toFixed(1)}MB`;
      }
    }

    const comfortState = await chrome.runtime.sendMessage({
      action: ACTIONS.GET_STATE,
      tabId,
      modeId: MODE_IDS.COMFORT_VISUAL,
    });

    const focusState = await chrome.runtime.sendMessage({
      action: ACTIONS.GET_STATE,
      tabId,
      modeId: MODE_IDS.FOCUS,
    });

    const isDegraded =
      comfortState?.state?.state === STATES.DEGRADED || focusState?.state?.state === STATES.DEGRADED;

    const degradedWarning = document.getElementById('degraded-warning');
    if (degradedWarning) {
      setHidden(degradedWarning, !isDegraded);
    }

    updateAdvancedEmptyState();
  } catch (error) {
    console.error('[Popup] Failed to load performance metrics:', error);
  }
}

// ========== LOAD STATE ==========
async function loadModeStates() {
  currentRecommendationModeId = null;
  let recommendedScore = null;

  for (const modeId of Object.values(MODE_IDS)) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_STATE,
        tabId: currentTabId,
        modeId
      });

      const state = response?.state;
      modeStates[modeId] = state;
      setModeVisualState(modeId, state);
      renderSmartScopeDebug(modeId, state);
      renderSmartScopeStatus(modeId, state?.smartScopeStatus);

      if (state?.pendingDecision) {
        const score = Number.isFinite(state?.lastScore) ? state.lastScore : 0;
        if (currentRecommendationModeId === null || score > (recommendedScore ?? -1)) {
          currentRecommendationModeId = modeId;
          recommendedScore = score;
        }
      }
    } catch (error) {
      console.error(`[Popup] Failed to load state for ${modeId}:`, error);
      setModeActive(modeId, false);
      renderSmartScopeDebug(modeId, null);
      renderSmartScopeStatus(modeId, {
        ok: false,
        error: error?.message || 'CS_UNREACHABLE',
        timestamp: Date.now(),
        action: 'verify'
      });
    }
  }

  renderRecommendationCard(currentRecommendationModeId, recommendedScore);
  applySitePolicyToModes();
  updateStatusChip();
  updateAdvancedEmptyState();
}

async function loadSmartScopeDebugFlag() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    smartScopeDebugEnabled = Boolean(stored?.[STORAGE_KEYS.USER_PREFS]?.smartScope?.debugEnabled);
  } catch (error) {
    smartScopeDebugEnabled = false;
  }
}

async function loadUserPrefs() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    currentUserPrefs = stored?.[STORAGE_KEYS.USER_PREFS] || {};
  } catch (error) {
    console.warn('[Popup] Failed to load user preferences:', error);
    currentUserPrefs = {};
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFocusPrefs(raw) {
  const defaults = MODE_PREFS_DEFAULTS?.[MODE_IDS.FOCUS] || {};
  const base = { ...defaults };
  if (isPlainObject(raw)) {
    for (const key of Object.keys(base)) {
      if (typeof raw[key] === 'boolean') {
        base[key] = raw[key];
      }
    }
  }
  base.focusNotObscured = true;
  return base;
}

function getStoredModePrefs(modeId) {
  const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
  if (modeId === MODE_IDS.COMFORT_VISUAL) {
    return normalizeComfortVisualPrefs(modePrefs[MODE_IDS.COMFORT_VISUAL] ?? modePrefs.comfortVisual);
  }
  if (modeId === MODE_IDS.FOCUS) {
    return normalizeFocusPrefs(modePrefs[MODE_IDS.FOCUS]);
  }
  return {};
}

function getFeaturePrefKey(modeId, featureId) {
  return MODE_FEATURE_PREF_KEYS[modeId]?.[featureId] || null;
}

function isFeatureChecked(modeId, feature) {
  if (feature.controlPolicy === 'always_on' || feature.safetyInvariant === true) {
    return true;
  }
  const prefKey = getFeaturePrefKey(modeId, feature.featureId);
  if (!prefKey) {
    return feature.defaultEnabled === true;
  }
  const modePrefs = getStoredModePrefs(modeId);
  return modePrefs[prefKey] === true;
}

function getFeatureDisabledReason(modeId, feature) {
  if (feature.availability === 'report_only') {
    return 'Report only';
  }
  return '';
}

function isFeatureControlDisabled(modeId, feature) {
  return Boolean(getFeatureDisabledReason(modeId, feature));
}

function renderModeFeaturePanels() {
  renderModeFeatureQuickSlots();

  for (const modeId of [MODE_IDS.COMFORT_VISUAL, MODE_IDS.FOCUS]) {
    const panelConfig = MODE_FEATURE_PANELS[modeId];
    const panel = document.getElementById(panelConfig.panelId);
    if (!panel) {
      continue;
    }

    const model = buildModeFeatureUiModelV1(modeId);
    panel.textContent = '';
    panel.dataset.version = String(model.version);

    for (const section of model.sections) {
      const sectionEl = document.createElement('section');
      sectionEl.className = 'feature-section';

      for (const feature of section.features.filter((item) => (
        isPopupVisibleFeature(modeId, item) && !isPopupQuickFeature(modeId, item)
      ))) {
        sectionEl.appendChild(renderFeatureControl(modeId, feature));
      }

      if (sectionEl.querySelector('.feature-row')) {
        panel.appendChild(sectionEl);
      }
    }
  }
}

function renderModeFeatureQuickSlots() {
  for (const [modeId, config] of Object.entries(MODE_FEATURE_QUICK_SLOTS)) {
    const slot = document.getElementById(config.slotId);
    if (!slot) {
      continue;
    }

    const model = buildModeFeatureUiModelV1(modeId);
    const features = model.sections
      .flatMap((section) => section.features)
      .filter((feature) => isPopupVisibleFeature(modeId, feature) && isPopupQuickFeature(modeId, feature));

    slot.textContent = '';
    slot.dataset.version = String(model.version);
    setHidden(slot, features.length === 0);

    for (const feature of features) {
      slot.appendChild(renderFeatureControl(modeId, feature, { quick: true }));
    }
  }
}

function isPopupQuickFeature(modeId, feature) {
  const featureIds = MODE_FEATURE_QUICK_SLOTS[modeId]?.featureIds || [];
  return featureIds.includes(feature.featureId);
}

function isPopupFeatureActionable(modeId, feature) {
  if (feature.controlPolicy === 'always_on' || feature.safetyInvariant === true) {
    return false;
  }
  if (feature.availability === 'report_only') {
    return false;
  }
  if (!getFeaturePrefKey(modeId, feature.featureId)) {
    return false;
  }
  return true;
}

function isPopupVisibleFeature(modeId, feature) {
  return isPopupFeatureActionable(modeId, feature);
}

function renderFeatureControl(modeId, feature, options = {}) {
  const row = document.createElement('label');
  row.className = 'feature-row';
  if (options.quick === true) {
    row.classList.add('feature-row-quick');
  }
  const controlIds = MODE_FEATURE_CONTROL_IDS[modeId]?.[feature.featureId] || null;
  if (controlIds?.rowId) {
    row.id = controlIds.rowId;
  }
  if (controlIds?.testId) {
    row.dataset.testid = controlIds.testId;
  }
  row.dataset.mode = modeId;
  row.dataset.featureId = feature.featureId;
  row.dataset.controlPolicy = feature.controlPolicy;
  row.dataset.availability = feature.availability;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'feature-checkbox';
  if (controlIds?.inputId) {
    input.id = controlIds.inputId;
  }
  if (controlIds?.inputTestId) {
    input.dataset.testid = controlIds.inputTestId;
  }
  input.dataset.mode = modeId;
  input.dataset.featureId = feature.featureId;
  const prefKey = getFeaturePrefKey(modeId, feature.featureId);
  if (prefKey) {
    input.dataset.prefKey = prefKey;
  }
  input.checked = isFeatureChecked(modeId, feature);
  input.disabled = isFeatureControlDisabled(modeId, feature);

  const text = document.createElement('span');
  text.className = 'feature-copy';
  const title = document.createElement('span');
  title.className = 'feature-title';
  title.textContent = feature.label;
  const description = document.createElement('span');
  description.className = 'feature-description';
  description.textContent = feature.description;
  text.append(title, description);

  row.append(input, text);
  return row;
}

function handleFeatureControlChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains('feature-checkbox')) {
    return;
  }
  handleFeatureToggle(target).catch((error) => {
    console.warn('[Popup] Failed to update feature preference:', error);
    loadUserPrefs()
      .then(() => renderModeFeaturePanels())
      .catch(() => {});
  });
}

function getSiteKeyFromUrl(url) {
  if (typeof url !== 'string') {
    return null;
  }

  const siteKey = extractDomain(url);
  if (!siteKey || siteKey === 'unknown') {
    return null;
  }

  return siteKey;
}

async function loadSitePolicy() {
  sitePolicyError = false;
  sitePolicy = null;

  if (!isFlagEnabled('siteSuppressV1')) {
    sitePolicy = {
      allowed: true,
      reason: null,
      host: getSiteKeyFromUrl(currentTabUrl),
      blockedUntil: null,
      overrideUntil: null
    };
    renderSitePolicyBanner();
    return;
  }

  if (!currentTabId) {
    sitePolicyError = true;
    renderSitePolicyBanner();
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.GET_SITE_POLICY,
      tabId: currentTabId,
      url: currentTabUrl
    });

    if (!response?.ok || !response?.policy) {
      sitePolicyError = true;
      sitePolicy = null;
    } else {
      sitePolicy = response.policy;
    }
  } catch (error) {
    sitePolicyError = true;
    sitePolicy = null;
  }

  renderSitePolicyBanner();
  scheduleSitePolicyRefresh();
}

// ========== UI UPDATES ==========
function setModeActive(modeId, isActive) {
  setModeVisualState(modeId, { state: isActive ? STATES.ACTIVE : STATES.INACTIVE });
}

async function loadLegacyDomainMigration() {
  legacyDomainMigration = null;
  if (typeof currentTabId !== 'number') {
    renderLegacyDomainMigration();
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.GET_LEGACY_DOMAIN_MIGRATION,
      tabId: currentTabId,
    });
    if (response?.ok && response.available) legacyDomainMigration = response;
  } catch (error) {
    console.warn('[Popup] Failed to inspect legacy domain settings', error);
  }
  renderLegacyDomainMigration();
}

function renderLegacyDomainMigration() {
  const banner = document.getElementById('legacy-domain-migration');
  const detail = document.getElementById('legacy-domain-migration-detail');
  if (!banner || !detail) return;
  if (!legacyDomainMigration?.available) {
    banner.classList.add('is-hidden');
    detail.textContent = '';
    return;
  }
  detail.textContent = `Settings stored for ${legacyDomainMigration.legacyKey} are not applied automatically. Copy them explicitly to ${legacyDomainMigration.siteKey}?`;
  banner.classList.remove('is-hidden');
}

async function confirmLegacyDomainMigration() {
  if (!legacyDomainMigration?.available || typeof currentTabId !== 'number') return;
  const confirmed = globalThis.confirm(
    `Copy legacy settings from ${legacyDomainMigration.legacyKey} to ${legacyDomainMigration.siteKey}? The historical data will be kept.`,
  );
  if (!confirmed) return;

  const button = document.getElementById('legacy-domain-migration-confirm');
  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.CONFIRM_LEGACY_DOMAIN_MIGRATION,
      tabId: currentTabId,
      confirmed: true,
    });
    if (!response?.ok) throw new Error(response?.error || 'Migration failed');
    legacyDomainMigration = null;
    renderLegacyDomainMigration();
    await loadUserPrefs();
    await loadSitePolicy();
    renderModeFeaturePanels();
  } catch (error) {
    console.warn('[Popup] Legacy domain migration failed', error);
  } finally {
    if (button) button.disabled = false;
  }
}

function setModeButtonsDisabled(disabled) {
  modeButtonsRequestLocked = Boolean(disabled);
  document.querySelectorAll('.btn-toggle').forEach((button) => {
    applySitePolicyToButton(button);
  });
}

function setModeVisualState(modeId, state) {
  const card = document.getElementById(`${modeId}-card`);
  const buttonId = modeId === MODE_IDS.COMFORT_VISUAL ? 'comfort-toggle' : 'focus-toggle';
  const button = document.getElementById(buttonId);
  const statusTargets = MODE_STATUS_IDS[modeId];
  const statusChip = statusTargets ? document.getElementById(statusTargets.chip) : null;
  const liveRegion = statusTargets ? document.getElementById(statusTargets.live) : null;

  if (!card || !button) {
    return;
  }

  const modeLabel = MODE_LABELS[modeId] || modeId;
  const visual = getModeVisualState(state);
  const { restoreFailed, limitedFallback, isActive } = visual;
  card.classList.toggle('active', isActive);
  card.classList.toggle('restore-error', restoreFailed);
  button.classList.toggle('active', isActive);
  button.classList.toggle('restore-error', restoreFailed);
  button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  button.setAttribute('aria-label', `${visual.ariaAction} ${modeLabel} mode`);
  button.textContent = restoreFailed ? 'Retry' : isActive ? 'Disable' : 'Enable';

  if (statusChip) {
    statusChip.textContent = visual.chipLabel;
    statusChip.classList.toggle('chip-on', isActive && !restoreFailed && !limitedFallback);
    statusChip.classList.toggle('chip-off', !isActive && !restoreFailed && !limitedFallback);
    statusChip.classList.toggle('chip-error', restoreFailed);
    statusChip.classList.toggle('chip-limited', limitedFallback);
    statusChip.title = visual.chipTitle || '';
  }

  if (liveRegion) {
    liveRegion.textContent = `${modeLabel} ${visual.liveState}`;
  }

  applySitePolicyToButton(button);
}

function updateStatusChip() {
  const chip = document.getElementById('status-chip');
  if (!chip) {
    return;
  }

  const states = Object.values(modeStates || {});
  const { label, className, title } = getPopupStatusView(states);

  chip.textContent = label;
  chip.classList.remove('status-active', 'status-paused', 'status-degraded');
  chip.classList.add(className);
  chip.setAttribute('aria-label', `Status: ${label}`);
  chip.title = title;
}

function renderRecommendationCard(modeId, score, options = {}) {
  const card = document.getElementById('recommendation-card');
  const description = document.getElementById('recommendation-description');
  const whyToggle = document.getElementById('why-toggle');
  const whySection = document.getElementById('why-section');

  if (!card || !description) {
    return;
  }

  const forceVisible = options.forceVisible === true;
  const preserveExpanded = options.preserveExpanded === true;

  if (!modeId && !forceVisible) {
    currentRecommendationModeId = null;
    setHidden(card, true);
    if (!preserveExpanded) {
      setAccordionExpanded(whyToggle, whySection, false);
    }
    return;
  }

  const resolvedModeId = modeId || currentRecommendationModeId;
  if (!resolvedModeId) {
    setHidden(card, true);
    return;
  }

  currentRecommendationModeId = resolvedModeId;
  card.dataset.modeId = resolvedModeId;
  setHidden(card, false);

  const modeLabel = MODE_LABELS[resolvedModeId] || resolvedModeId;
  description.textContent = `Based on your signals, we suggest ${modeLabel}.`;

  if (!preserveExpanded) {
    setAccordionExpanded(whyToggle, whySection, false);
  }

}

function renderSmartScopeDebug(modeId, modeState) {
  const card = document.getElementById(`${modeId}-card`);
  if (!card) {
    return;
  }

  const existing = card.querySelector('.smartscope-debug');
  if (!smartScopeDebugEnabled) {
    if (existing) {
      existing.remove();
    }
    return;
  }

  const target = existing || document.createElement('p');
  target.className = 'smartscope-debug';
  const smartScopeState = modeState?.smartScope || null;
  const quality = modeState?.activeQuality ? ` (${modeState.activeQuality})` : '';

  if (smartScopeState && (smartScopeState.variant || smartScopeState.appliedVariant)) {
    const variant = smartScopeState.variant || smartScopeState.appliedVariant;
    const scope = smartScopeState.scopeProfile?.reason ? ` — ${smartScopeState.scopeProfile.reason}` : '';
    target.textContent = `SmartScope: ${variant}${quality}${scope}`;
  } else {
    target.textContent = `SmartScope: STRICT${quality}`;
  }

  if (!existing) {
    card.appendChild(target);
  }
}

function renderSmartScopeStatus(modeId, status) {
  smartScopeStatuses[modeId] = status || null;
  const section = document.getElementById('smartscope-status-section');
  const list = document.getElementById('smartscope-status-list');
  if (!section || !list) return;

  list.textContent = '';
  const entries = Object.entries(smartScopeStatuses).filter(([, value]) => value);

  if (!entries.length) {
    setHidden(section, true);
    updateAdvancedEmptyState();
    return;
  }

  setHidden(section, false);
  entries.forEach(([id, value]) => {
    const li = document.createElement('li');
    li.className = `status-item${value.ok === false ? ' error' : ''}`;
    const title = document.createElement('div');
    const actionLabel = formatSmartScopeAction(value.action);
    title.textContent = `${MODE_LABELS[id] || id}: ${actionLabel}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const statusLabel = value.ok === false ? 'failed' : 'ok';
    const timestamp = value.timestamp ? new Date(value.timestamp).toLocaleTimeString() : '—';
    const errorSummary = formatSmartScopeField(value.reason ?? value.error);
    const detailSummary = formatSmartScopeField(value.detail);
    meta.textContent = `${statusLabel} • ${timestamp}${errorSummary ? ` • ${errorSummary}` : ''}${
      detailSummary ? ` • ${detailSummary}` : ''
    }${value.attemptId ? ` • attempt ${value.attemptId}` : ''}`;
    li.append(title, meta);
    if (value.ok === false) {
      const detailBlock = renderSmartScopeErrorDetails(value);
      if (detailBlock) {
        li.appendChild(detailBlock);
      }
      console.warn('[Popup] Failed to enable', id, value);
      console.warn('[Popup] Enable error payload json', JSON.stringify(value, null, 2));
    }
    list.appendChild(li);
  });
  updateAdvancedEmptyState();
}

function formatSmartScopeField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  if (typeof field === 'string') {
    return field;
  }
  try {
    return JSON.stringify(field);
  } catch (error) {
    return String(field);
  }
}

function renderSmartScopeErrorDetails(value) {
  const reason = formatSmartScopeField(value.reason ?? value.error);
  const detail = formatSmartScopeField(value.detail);
  const attemptId = value.attemptId ? String(value.attemptId) : '';
  const source = formatSmartScopeField(value.source);
  const hasDetails = reason || detail || attemptId || source;
  if (!hasDetails) {
    return null;
  }
  const container = document.createElement('div');
  container.className = 'meta';
  const lines = [];
  if (reason) lines.push(`Reason: ${reason}`);
  if (detail) lines.push(`Detail: ${detail}`);
  if (attemptId) lines.push(`Attempt: ${attemptId}`);
  if (source) lines.push(`Source: ${source}`);
  container.textContent = lines.join(' • ');
  return container;
}

function formatSmartScopeAction(action) {
  if (!action) return 'unknown';
  if (action === 'apply' || action === 'restore' || action === 'verify') {
    return action;
  }
  if (action === 'cleanup') {
    return 'cleanup';
  }
  return String(action).toLowerCase();
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
  document.querySelectorAll('.btn-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const modeId = button.dataset.mode;
      const isActive = button.classList.contains('active');

      if (isActive) {
        handleDisable(modeId);
      } else {
        handleEnable(modeId);
      }
    });
  });

  document.querySelectorAll('.mode-card-main').forEach((row) => {
    row.addEventListener('click', (event) => {
      const target = event.target;
      if (target?.closest?.('button, input, a, label, select, textarea')) {
        return;
      }

      const button = row.closest('.mode-card')?.querySelector('.btn-toggle');
      if (!button || button.disabled) {
        return;
      }

      button.click();
    });
  });

  const overrideButton = document.getElementById('site-policy-override');
  if (overrideButton) {
    overrideButton.addEventListener('click', async () => {
      if (!currentTabId) {
        return;
      }
      await requestSiteOverride();
    });
  }

  const sitePolicyManage = document.getElementById('site-policy-manage');
  if (sitePolicyManage) {
    sitePolicyManage.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  const recommendationEnable = document.getElementById('recommendation-enable');
  if (recommendationEnable) {
    recommendationEnable.addEventListener('click', () => {
      const modeId = getRecommendationModeId();
      if (!modeId) {
        return;
      }
      handleEnable(modeId);
    });
  }

  const recommendationNotNow = document.getElementById('recommendation-not-now');
  if (recommendationNotNow) {
    recommendationNotNow.addEventListener('click', () => {
      handleRecommendationDecision('NOT_NOW');
    });
  }

  const recommendationNever = document.getElementById('recommendation-never');
  if (recommendationNever) {
    recommendationNever.addEventListener('click', () => {
      handleRecommendationDecision('NEVER');
    });
  }

  const whyToggle = document.getElementById('why-toggle');
  if (whyToggle) {
    whyToggle.addEventListener('click', () => {
      const panel = document.getElementById('why-section');
      if (!panel) {
        return;
      }
      const expanded = whyToggle.getAttribute('aria-expanded') === 'true';
      setAccordionExpanded(whyToggle, panel, !expanded);
      if (!expanded) {
        const modeId = getRecommendationModeId();
        if (modeId) {
          populateWhySection(modeId);
        }
      }
    });
  }

  const advancedToggle = document.getElementById('advanced-toggle');
  if (advancedToggle) {
    advancedToggle.addEventListener('click', () => {
      const panel = document.getElementById('advanced-panel');
      if (!panel) {
        return;
      }
      const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
      setAccordionExpanded(advancedToggle, panel, !expanded);
    });
  }

  const legacyMigrationButton = document.getElementById('legacy-domain-migration-confirm');
  if (legacyMigrationButton) {
    legacyMigrationButton.addEventListener('click', () => {
      confirmLegacyDomainMigration().catch((error) => {
        console.warn('[Popup] Legacy domain confirmation failed', error);
      });
    });
  }

  for (const modeId of [MODE_IDS.COMFORT_VISUAL, MODE_IDS.FOCUS]) {
    const panelConfig = MODE_FEATURE_PANELS[modeId];
    const toggle = document.getElementById(panelConfig.toggleId);
    const panel = document.getElementById(panelConfig.panelId);
    if (!toggle || !panel) {
      continue;
    }
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      setAccordionExpanded(toggle, panel, !expanded);
    });
    panel.addEventListener('change', handleFeatureControlChange);
  }

  for (const config of Object.values(MODE_FEATURE_QUICK_SLOTS)) {
    const slot = document.getElementById(config.slotId);
    if (slot) {
      slot.addEventListener('change', handleFeatureControlChange);
    }
  }

  const optionsLink = document.getElementById('open-options');
  if (optionsLink) {
    optionsLink.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

async function handleFeatureToggle(input) {
  if (!input || input.disabled) {
    return;
  }

  const modeId = input.dataset.mode;
  const featureId = input.dataset.featureId;
  const prefKey = input.dataset.prefKey;
  if (!modeId || !featureId || !prefKey) {
    await loadUserPrefs();
    renderModeFeaturePanels();
    return;
  }

  input.disabled = true;
  try {
    await updateModeFeaturePreference(modeId, prefKey, input.checked === true, { featureId });
  } finally {
    input.disabled = false;
  }
}

async function updateModeFeaturePreference(modeId, prefKey, enabled, options = {}) {
  const runUpdate = async () => {
    currentUserPrefs = await mutateLocalValue(STORAGE_KEYS.USER_PREFS, (storedPrefs) => {
      const prefs = isPlainObject(storedPrefs) ? storedPrefs : {};
      const modePrefs = isPlainObject(prefs.modePrefs) ? prefs.modePrefs : {};
      let nextModePrefs = modePrefs;

      if (modeId === MODE_IDS.COMFORT_VISUAL) {
        const current = normalizeComfortVisualPrefs(modePrefs[MODE_IDS.COMFORT_VISUAL] ?? modePrefs.comfortVisual);
        const merged = mergeComfortVisualPrefs(current, { [prefKey]: enabled });
        nextModePrefs = { ...modePrefs, [MODE_IDS.COMFORT_VISUAL]: merged, comfortVisual: merged };
      } else if (modeId === MODE_IDS.FOCUS) {
        const rawFocusPrefs = isPlainObject(modePrefs[MODE_IDS.FOCUS]) ? modePrefs[MODE_IDS.FOCUS] : {};
        const current = normalizeFocusPrefs(rawFocusPrefs);
        const merged = { ...rawFocusPrefs, ...current, [prefKey]: Boolean(enabled), focusNotObscured: true };
        nextModePrefs = { ...modePrefs, [MODE_IDS.FOCUS]: merged };
      }

      return { ...prefs, modePrefs: nextModePrefs };
    });

    renderModeFeaturePanels();
    await requestModeRefreshAfterFeatureUpdate(modeId, prefKey, enabled, options);
  };

  const nextWrite = modeFeaturePreferenceWriteQueue.catch(() => {}).then(runUpdate);
  modeFeaturePreferenceWriteQueue = nextWrite.catch(() => {});
  return nextWrite;
}

function shouldAutoEnableModeForFeature(modeId, prefKey, enabled, options = {}) {
  return (
    modeId === MODE_IDS.COMFORT_VISUAL
    && prefKey === 'darkMode'
    && enabled === true
    && options?.featureId === FEATURE_IDS.DARK_COMFORT_THEME
  );
}

async function requestModeRefreshAfterFeatureUpdate(modeId, prefKey, enabled, options = {}) {
  const visual = getModeVisualState(modeStates[modeId]);
  if (visual.isActive) {
    await requestReapplyForActiveMode(modeId);
    return;
  }

  if (!currentTabId || !shouldAutoEnableModeForFeature(modeId, prefKey, enabled, options)) {
    return;
  }

  await handleEnable(modeId);
}

async function requestReapplyForActiveMode(modeId) {
  const visual = getModeVisualState(modeStates[modeId]);
  if (!currentTabId || !visual.isActive) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      action: ACTIONS.MODE_ENGINE_V2_REAPPLY_ACTIVE_MODES,
      tabId: currentTabId,
      reason: `popup:prefs:${modeId}`,
    });
    await loadModeStates();
  } catch (error) {
    console.warn('[Popup] Failed to reapply active mode after feature update:', error);
  }
}

function getRecommendationModeId() {
  if (currentRecommendationModeId) {
    return currentRecommendationModeId;
  }
  const card = document.getElementById('recommendation-card');
  return card?.dataset?.modeId || null;
}

function renderSitePolicyBanner() {
  const banner = document.getElementById('site-policy-banner');
  const title = document.getElementById('site-policy-title');
  const detail = document.getElementById('site-policy-detail');
  const overrideButton = document.getElementById('site-policy-override');

  if (!banner || !title || !detail || !overrideButton) {
    return;
  }

  if (sitePolicyError) {
    setHidden(banner, false);
    title.textContent = 'Policy unavailable';
    detail.textContent = 'Unable to verify site policy. Controls remain enabled.';
    setHidden(overrideButton, true);
    return;
  }

  if (!sitePolicy || sitePolicy.allowed !== false) {
    setHidden(banner, true);
    title.textContent = '';
    detail.textContent = '';
    setHidden(overrideButton, true);
    return;
  }

  setHidden(banner, false);
  title.textContent = `Disabled on this site: ${formatPolicyReason(sitePolicy.reason)}`;

  const detailText = formatPolicyDetail(sitePolicy);
  detail.textContent = detailText;

  if (canTryOnce(sitePolicy)) {
    setHidden(overrideButton, false);
  } else {
    setHidden(overrideButton, true);
  }
}

function formatPolicyReason(reason) {
  switch (reason) {
    case SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE:
      return 'Repeated apply failures';
    case SITE_BLOCK_REASONS.UNSUPPORTED_SCHEME:
      return 'Unsupported page';
    case SITE_BLOCK_REASONS.USER_DISABLED_FOR_HOST:
      return 'Blocked by your settings';
    case SITE_BLOCK_REASONS.NO_RECEIVER:
      return 'Page not ready for content scripts';
    case SITE_BLOCK_REASONS.OVERRIDE_ACTIVE:
      return 'Temporary override active';
    default:
      return reason ? String(reason) : 'Policy blocked';
  }
}

function formatPolicyDetail(policy) {
  if (!policy) {
    return '';
  }

  if (policy.blockedUntil) {
    const untilText = formatLocalTime(policy.blockedUntil);
    const relative = formatRelativeTime(policy.blockedUntil);
    return `Blocked until ${untilText}${relative ? ` (${relative})` : ''}.`;
  }

  if (policy.overrideUntil) {
    const untilText = formatLocalTime(policy.overrideUntil);
    const relative = formatRelativeTime(policy.overrideUntil);
    return `Override active until ${untilText}${relative ? ` (${relative})` : ''}.`;
  }

  return 'This site is currently blocked by policy.';
}

function formatLocalTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return 'unknown time';
  }
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '';
  }
  const deltaMs = timestamp - Date.now();
  if (!Number.isFinite(deltaMs)) {
    return '';
  }
  if (deltaMs <= 0) {
    return 'expired';
  }
  const totalSeconds = Math.round(deltaMs / 1000);
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `in ${hours} hr`;
  }
  const days = Math.round(hours / 24);
  return `in ${days} d`;
}

function canTryOnce(policy) {
  if (!policy || policy.allowed !== false) {
    return false;
  }
  if (!policy.host) {
    return false;
  }
  return policy.reason === SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE;
}

function applySitePolicyToModes() {
  document.querySelectorAll('.btn-toggle').forEach((button) => {
    applySitePolicyToButton(button);
  });
}

function applySitePolicyToButton(button) {
  if (!button) {
    return;
  }

  if (modeButtonsRequestLocked) {
    button.disabled = true;
    return;
  }

  if (!sitePolicy || sitePolicyError || sitePolicy.allowed !== false) {
    button.disabled = false;
    return;
  }

  const isActive = button.classList.contains('active');
  button.disabled = !isActive;
}

async function requestSiteOverride() {
  if (!currentTabId) {
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.SET_SITE_OVERRIDE,
      tabId: currentTabId,
      url: currentTabUrl
    });

    if (response?.ok) {
      sitePolicy = response.policy || sitePolicy;
      sitePolicyError = false;
    } else {
      sitePolicyError = true;
    }
  } catch (error) {
    sitePolicyError = true;
  }

  renderSitePolicyBanner();
  applySitePolicyToModes();
  scheduleSitePolicyRefresh();
}

function scheduleSitePolicyRefresh() {
  if (sitePolicyRefreshTimeout) {
    clearTimeout(sitePolicyRefreshTimeout);
    sitePolicyRefreshTimeout = null;
  }

  if (!sitePolicy || sitePolicy.allowed !== true || sitePolicy.reason !== SITE_BLOCK_REASONS.OVERRIDE_ACTIVE) {
    return;
  }

  const overrideUntil = sitePolicy.overrideUntil;
  if (!Number.isFinite(overrideUntil)) {
    return;
  }

  const delayMs = Math.max(overrideUntil - Date.now(), 0) + 250;
  sitePolicyRefreshTimeout = setTimeout(() => {
    loadSitePolicy().catch((error) => {
      console.warn('[Popup] Failed to refresh site policy after override:', error);
    });
  }, delayMs);
}

// ========== ACTIONS ==========
async function handleEnable(modeId) {
  console.log('[Popup] Enabling', modeId);
  const peerModeId = getExclusivePeerModeId(modeId);
  setModeButtonsDisabled(true);

  try {
    const peerVisual = peerModeId ? getModeVisualState(modeStates[peerModeId]) : null;
    if (peerModeId && currentTabId && peerVisual?.isActive) {
      try {
        const peerRestoreResponse = await chrome.runtime.sendMessage({
          action: ACTIONS.RESTORE_MODE,
          tabId: currentTabId,
          modeId: peerModeId
        });
        if (!peerRestoreResponse?.ok) {
          console.warn('[Popup] Failed to disable peer mode', peerModeId, peerRestoreResponse);
          await loadModeStates();
          return;
        }
      } catch (error) {
        console.warn('[Popup] Failed to disable peer mode', peerModeId, error);
        await loadModeStates();
        return;
      }
    }

    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.USER_DECISION,
      tabId: currentTabId,
      modeId,
      decision: 'ENABLED'
    });

    if (!response?.ok) {
      console.warn('[Popup] Failed to enable', modeId, response);
      console.warn('[Popup] Enable error response json', JSON.stringify(response ?? {}, null, 2));
    }
  } catch (error) {
    console.warn('[Popup] Enable error', modeId, error);
    console.warn('[Popup] Enable error json', JSON.stringify(error ?? {}, null, 2));
  } finally {
    try {
      await loadModeStates();
    } finally {
      setModeButtonsDisabled(false);
    }
  }
}

async function handleDisable(modeId) {
  console.log('[Popup] Disabling', modeId);
  setModeButtonsDisabled(true);

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.RESTORE_MODE,
      tabId: currentTabId,
      modeId
    });

    if (!response?.ok) {
      console.warn('[Popup] Failed to disable', modeId, response);
      console.warn('[Popup] Disable error response json', JSON.stringify(response ?? {}, null, 2));
    }
  } catch (error) {
    console.warn('[Popup] Disable error', modeId, error);
    console.warn('[Popup] Disable error json', JSON.stringify(error ?? {}, null, 2));
  } finally {
    try {
      await loadModeStates();
    } finally {
      setModeButtonsDisabled(false);
    }
  }
}

async function handleRecommendationDecision(decision) {
  const modeId = getRecommendationModeId();
  if (!modeId || !currentTabId) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.USER_DECISION,
      tabId: currentTabId,
      modeId,
      decision
    });

    if (!response?.ok) {
      console.warn('[Popup] Failed to update recommendation', response);
    }
  } catch (error) {
    console.warn('[Popup] Recommendation decision error', error);
  } finally {
    await loadModeStates();
  }
}

// ========== MESSAGE HANDLER ==========
function handleMessage(message) {
  if (message.action === ACTIONS.SCROLL_TO_WHY) {
    showWhySection(message.modeId);
  }
}

// ========== WHY SECTION ==========
function showWhySection(modeId) {
  const resolvedModeId = modeId || currentRecommendationModeId;
  if (!resolvedModeId) {
    return;
  }

  renderRecommendationCard(resolvedModeId, null, { forceVisible: true, preserveExpanded: true });

  const section = document.getElementById('why-section');
  const toggle = document.getElementById('why-toggle');
  if (!section || !toggle) {
    return;
  }

  setAccordionExpanded(toggle, section, true);
  populateWhySection(resolvedModeId);
  section.scrollIntoView({ behavior: 'smooth' });
}

function populateWhySection(modeId) {
  const section = document.getElementById('why-section');
  const modeName = document.getElementById('why-mode-name');
  const signalsList = document.getElementById('signals-list');

  if (!section || !modeName || !signalsList) {
    return;
  }

  modeName.textContent = MODE_LABELS[modeId] || modeId;

  chrome.runtime
    .sendMessage({
      action: ACTIONS.GET_STATE,
      tabId: currentTabId,
      modeId
    })
    .then((response) => {
      const signals = response?.state?.signals || [];
      const displaySignals = signals.slice(0, 5);

      signalsList.textContent = '';

      if (displaySignals.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No signals available';
        signalsList.appendChild(li);
        return;
      }

      displaySignals.forEach((signal) => {
        const li = document.createElement('li');
        const readableNames = {
          zoom: 'Zoom level increased',
          colorScheme: 'Dark mode preference detected',
          readingBehavior: 'Reading difficulty patterns'
        };

        li.textContent = readableNames[signal] || signal;
        signalsList.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Popup] Failed to load signals:', error);
    });
}

// ========== START ==========
init();
