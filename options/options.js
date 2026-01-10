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
  resetAllData,
} from '../shared/data-portability.js';
import { mergeComfortVisualPrefs, normalizeComfortVisualPrefs } from '../shared/comfort-visual-prefs.js';

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
const inlineWarning = document.getElementById('inline-warning');
const suggestionSlider = document.getElementById('suggestion-threshold');
const autoSlider = document.getElementById('auto-threshold');
const suggestionValue = document.getElementById('suggestion-threshold-value');
const autoValue = document.getElementById('auto-threshold-value');
const cooldownSelect = document.getElementById('cooldown-duration');
const spaToggle = document.getElementById('spa-toggle');
const spaStatus = document.getElementById('spa-status');
const allowInput = document.getElementById('allowlist-input');
const denyInput = document.getElementById('denylist-input');
const allowListEl = document.getElementById('allowlist-items');
const denyListEl = document.getElementById('denylist-items');
const learningBody = document.getElementById('learning-body');
const importFileInput = document.getElementById('import-file');
const resetLearningConfirm = document.getElementById('confirm-reset-learning');
const resetAllConfirm = document.getElementById('confirm-reset-all');
const smartScopeToggle = document.getElementById('smartscope-toggle');
const smartScopeLevel = document.getElementById('smartscope-level');
const smartScopeLevelField = document.getElementById('smartscope-level-field');
const smartScopeDomainInput = document.getElementById('smartscope-domain');
const smartScopeDomainLevel = document.getElementById('smartscope-domain-level');
const smartScopeDomainEnabled = document.getElementById('smartscope-domain-enabled');
const smartScopeDomainSave = document.getElementById('smartscope-domain-save');
const smartScopeDomainList = document.getElementById('smartscope-domain-list');
const smartScopeStatus = document.getElementById('smartscope-status');
const smartScopePanic = document.getElementById('smartscope-panic');
const smartScopeDebugToggle = document.getElementById('smartscope-debug-toggle');
const smartScopeDebugExport = document.getElementById('smartscope-debug-export');
const smartScopeDebugClear = document.getElementById('smartscope-debug-clear');
const smartScopeDebugStatus = document.getElementById('smartscope-debug-status');
const smartScopeRunStatus = document.getElementById('smartscope-run-status');
const smartScopeRunList = document.getElementById('smartscope-run-list');
const comfortVisualInputs = {
  textScale: document.getElementById('cv-text-scale'),
  spacingPack: document.getElementById('cv-spacing-pack'),
  linkEnhance: document.getElementById('cv-link-enhance'),
  typoSmoothing: document.getElementById('cv-typo-smoothing'),
  reflowGuard: document.getElementById('cv-reflow-guard'),
  darkMode: document.getElementById('cv-dark-mode'),
};
const focusInputs = {
  distractionDim: document.getElementById('focus-distraction-dim'),
  overlayAlpha: document.getElementById('focus-overlay-alpha'),
  readingRuler: document.getElementById('focus-reading-ruler'),
  readingRulerHeight: document.getElementById('focus-reading-ruler-height'),
  readingRulerOpacity: document.getElementById('focus-reading-ruler-opacity'),
  ultraFocus: document.getElementById('focus-ultra-focus'),
  targetBoost: document.getElementById('focus-target-boost'),
  focusNotObscured: document.getElementById('focus-not-obscured'),
  reduceMotion: document.getElementById('focus-reduce-motion'),
};
const focusDefaultToggle = document.getElementById('focus-default-enabled');

let currentUserPrefs = null;
let currentComfortVisualPrefs = null;
let currentFocusPrefs = null;
let currentAllowlist = [];
let currentDenylist = [];
let currentLearning = {};
let currentDecisions = {};
let currentSmartScope = {
  enabled: true,
  level: SMARTSCOPE_LEVELS.CONSERVATIVE,
  perDomain: {},
};

export async function initOptionsPage() {
  document.addEventListener('DOMContentLoaded', async () => {
    handleWhyFallbackNotice();
    await loadAndRenderState();
    bindEvents();
  });
}

function handleWhyFallbackNotice() {
  if (!inlineWarning) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('scrollTo') !== 'why') return;

  if (params.get('reason') === 'openPopup_failed') {
    inlineWarning.textContent = "Impossible d’ouvrir la popup automatiquement (UX dégradée).";
    inlineWarning.style.display = 'block';
    inlineWarning.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadAllStateForUI() {
  const { userPrefs, allowlist, denylist, learningWeights, perDomainPrefs } = await chrome.storage.local.get([
    STORAGE_KEYS.USER_PREFS,
    STORAGE_KEYS.ALLOWLIST,
    STORAGE_KEYS.DENYLIST,
    STORAGE_KEYS.LEARNING_WEIGHTS,
    STORAGE_KEYS.PER_DOMAIN_PREFS,
  ]);

  return {
    userPrefs: normalizeUserPrefs(userPrefs || {}),
    smartScope: normalizeSmartScopeConfig(userPrefs?.smartScope),
    allowlist: allowlist || [],
    denylist: denylist || [],
    learningWeights: learningWeights || {},
    userDecisions: perDomainPrefs || {},
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
  normalized.focusDefaultEnabled = source.focusDefaultEnabled !== false;
  normalized.smartScope = normalizeSmartScopeConfig(source.smartScope);
  modePrefs.comfortVisual = normalizeComfortVisualPrefs(modePrefs.comfortVisual);
  normalized.modePrefs = modePrefs;

  return normalized;
}

async function loadAndRenderState() {
  const state = await loadAllStateForUI();
  currentUserPrefs = state.userPrefs;
  currentAllowlist = state.allowlist;
  currentDenylist = state.denylist;
  currentLearning = state.learningWeights;
  currentDecisions = state.userDecisions;
  currentSmartScope = state.smartScope;
  currentUserPrefs.smartScope = currentSmartScope;

  renderUserPrefs();
  renderLists();
  renderLearningTable();
  renderSmartScopeSection();
  await refreshSmartScopeStatus();
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
    focusDefaultToggle.checked = currentUserPrefs.focusDefaultEnabled !== false;
  }
  renderComfortVisualControls();
  renderFocusControls();
}

function renderComfortVisualControls() {
  currentComfortVisualPrefs = normalizeComfortVisualPrefs(currentUserPrefs?.modePrefs?.comfortVisual);
  Object.entries(comfortVisualInputs).forEach(([key, input]) => {
    if (!input) return;
    input.checked = Boolean(currentComfortVisualPrefs[key]);
  });
}

function normalizeFocusPrefs(raw) {
  const defaults = MODE_PREFS_DEFAULTS?.[MODE_IDS.FOCUS] || {
    distractionDim: false,
    ultraFocus: false,
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

  return base;
}

function normalizeRange(value, min, max, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function renderFocusControls() {
  const focusModeId = MODE_IDS.FOCUS;
  const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
  const rawFocusPrefs = modePrefs[focusModeId];
  currentFocusPrefs = normalizeFocusPrefs(rawFocusPrefs);

  if (focusInputs.distractionDim) {
    focusInputs.distractionDim.checked = currentFocusPrefs.distractionDim === true;
  }
  if (focusInputs.readingRuler) {
    focusInputs.readingRuler.checked = currentFocusPrefs.readingRuler === true;
  }
  if (focusInputs.ultraFocus) {
    focusInputs.ultraFocus.checked = currentFocusPrefs.ultraFocus === true;
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

  const rawAlpha = currentUserPrefs?.focusOverlayAlpha ?? rawFocusPrefs?.distractionDimAlpha;
  const rawHeight = currentUserPrefs?.readingRulerHeightPx ?? rawFocusPrefs?.readingRulerHeightPx;
  const rawOpacity = currentUserPrefs?.readingRulerOpacity ?? rawFocusPrefs?.readingRulerOpacity;

  if (focusInputs.overlayAlpha) {
    focusInputs.overlayAlpha.value = normalizeRange(rawAlpha, 0, 1, 0.2);
  }
  if (focusInputs.readingRulerHeight) {
    focusInputs.readingRulerHeight.value = normalizeRange(rawHeight, 40, 400, 120);
  }
  if (focusInputs.readingRulerOpacity) {
    focusInputs.readingRulerOpacity.value = normalizeRange(rawOpacity, 0, 0.6, 0.12);
  }
}

function renderSmartScopeSection() {
  if (!smartScopeToggle) return;
  smartScopeToggle.checked = currentSmartScope.enabled === true;
  smartScopeLevel.value = currentSmartScope.level || SMARTSCOPE_LEVELS.CONSERVATIVE;
  smartScopeLevelField.hidden = !currentSmartScope.enabled;
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

function renderLists() {
  allowListEl.innerHTML = '';
  denyListEl.innerHTML = '';
  const render = (arr, container, kind) => {
    if (!arr.length) {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.textContent = 'No domains';
      container.appendChild(li);
      return;
    }
    arr.forEach((domain) => {
      const li = document.createElement('li');
      li.className = 'list-item';
      const span = document.createElement('span');
      span.textContent = domain;
      const btn = document.createElement('button');
      btn.className = 'btn danger';
      btn.textContent = 'Remove';
      btn.addEventListener('click', async () => {
        if (kind === 'allow') {
          currentAllowlist = currentAllowlist.filter((d) => d !== domain);
          await persistAllowlist();
          renderLists();
          showInlineStatus('success', 'Allowlist updated');
        } else {
          currentDenylist = currentDenylist.filter((d) => d !== domain);
          await persistDenylist();
          renderLists();
          showInlineStatus('success', 'Denylist updated');
        }
      });
      li.append(span, btn);
      container.appendChild(li);
    });
  };
  render(currentAllowlist, allowListEl, 'allow');
  render(currentDenylist, denyListEl, 'deny');
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

function renderLearningTable() {
  learningBody.innerHTML = '';
  const rows = buildLearningRows(currentLearning, currentDecisions);
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No learning data yet.';
    tr.appendChild(td);
    learningBody.appendChild(tr);
    return;
  }

  rows.forEach(({ domain, modes, stage, weight, lastDecision }) => {
    const tr = document.createElement('tr');
    const domainTd = document.createElement('td');
    domainTd.textContent = domain;
    const modesTd = document.createElement('td');
    modesTd.textContent = modes.join(', ');
    const stageTd = document.createElement('td');
    stageTd.textContent = stage;
    const weightTd = document.createElement('td');
    weightTd.textContent = weight;
    const decisionTd = document.createElement('td');
    decisionTd.textContent = lastDecision;
    const actionTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn danger';
    btn.textContent = 'Reset';
    btn.addEventListener('click', () => showDomainResetConfirm(domain));
    actionTd.appendChild(btn);

    tr.append(domainTd, modesTd, stageTd, weightTd, decisionTd, actionTd);
    learningBody.appendChild(tr);
  });
}

function buildLearningRows(learning, decisions) {
  return Object.keys(learning).map((domain) => {
    const modes = Object.keys(learning[domain] || {});
    const stages = modes.map((m) => learning[domain][m].stage || LEARNING_STAGES.MANUAL);
    const weights = modes.map((m) => Number(learning[domain][m].weight || 0).toFixed(2));
    const decisionInfo = decisions[domain] || {};
    const decisionModes = Object.keys(decisionInfo);
    let lastDecision = '—';
    if (decisionModes.length) {
      const mode = decisionModes[0];
      const decision = decisionInfo[mode]?.decision;
      const ts = decisionInfo[mode]?.timestamp;
      lastDecision = decision ? `${decision}${ts ? ` (${new Date(ts).toLocaleString()})` : ''}` : '—';
    }
    return {
      domain,
      modes: modes.length ? modes : ['—'],
      stage: stages.length ? stages.join(', ') : LEARNING_STAGES.MANUAL,
      weight: weights.length ? weights.join(', ') : '0.00',
      lastDecision,
    };
  });
}

function bindEvents() {
  document.querySelectorAll('input[name="banner-position"]').forEach((input) => {
    input.addEventListener('change', () => persistUserPrefs({ bannerPosition: input.value }));
  });
  document.querySelectorAll('input[name="display-density"]').forEach((input) => {
    input.addEventListener('change', () => persistUserPrefs({ displayDensity: input.value }));
  });
  document.getElementById('reduced-motion').addEventListener('change', (e) => {
    persistUserPrefs({ reducedMotion: e.target.checked });
  });
  document.getElementById('high-contrast').addEventListener('change', (e) => {
    persistUserPrefs({ highContrast: e.target.checked });
  });
  bindComfortVisualControls();
  bindFocusControls();
  if (focusDefaultToggle) {
    focusDefaultToggle.addEventListener('change', async (event) => {
      await persistUserPrefs({ focusDefaultEnabled: event.target.checked });
      await requestReapplyActiveTab('prefs:focusDefaultEnabled');
    });
  }

  suggestionSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    suggestionValue.textContent = val.toFixed(2);
  });
  suggestionSlider.addEventListener('change', (e) => {
    const val = clampThreshold(Number(e.target.value));
    suggestionSlider.value = val;
    suggestionValue.textContent = Number(val).toFixed(2);
    persistUserPrefs({ suggestionThreshold: val });
  });

  autoSlider.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    autoValue.textContent = val.toFixed(2);
  });
  autoSlider.addEventListener('change', (e) => {
    const val = clampThreshold(Number(e.target.value));
    autoSlider.value = val;
    autoValue.textContent = Number(val).toFixed(2);
    persistUserPrefs({ autoThreshold: val });
  });

  cooldownSelect.addEventListener('change', (e) => {
    persistUserPrefs({ cooldownDuration: Number(e.target.value) });
  });

  spaToggle.addEventListener('change', async (e) => {
    await onToggleSpaSupport(e.target.checked);
  });

  document.getElementById('add-allow').addEventListener('click', async () => {
    const validation = normalizeAndValidateDomain(allowInput.value);
    if (!validation.ok) {
      showInlineStatus('error', validation.reason);
      return;
    }
    const domain = validation.domain;
    if (!currentAllowlist.includes(domain)) {
      currentAllowlist.push(domain);
      currentAllowlist.sort();
      await persistAllowlist();
      renderLists();
      showInlineStatus('success', 'Allowlist updated');
    } else {
      showInlineStatus('info', 'Domain already in allowlist');
    }
    allowInput.value = '';
  });

  document.getElementById('add-deny').addEventListener('click', async () => {
    const validation = normalizeAndValidateDomain(denyInput.value);
    if (!validation.ok) {
      showInlineStatus('error', validation.reason);
      return;
    }
    const domain = validation.domain;
    if (!currentDenylist.includes(domain)) {
      currentDenylist.push(domain);
      currentDenylist.sort();
      await persistDenylist();
      renderLists();
      showInlineStatus('success', 'Denylist updated');
    } else {
      showInlineStatus('info', 'Domain already in denylist');
    }
    denyInput.value = '';
  });

  document.getElementById('reset-learning-all').addEventListener('click', () => {
    resetLearningConfirm.hidden = false;
  });
  document.getElementById('cancel-reset-learning').addEventListener('click', () => {
    resetLearningConfirm.hidden = true;
  });
  document.getElementById('confirm-reset-learning-btn').addEventListener('click', async () => {
    resetLearningConfirm.hidden = true;
    await onResetAllLearningConfirmed();
  });

  document.getElementById('export-data').addEventListener('click', () => onExportData());
  document.getElementById('import-data').addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await onImportData(file);
      importFileInput.value = '';
    }
  });

  document.getElementById('reset-all-data').addEventListener('click', () => {
    resetAllConfirm.hidden = false;
  });
  document.getElementById('cancel-reset-all').addEventListener('click', () => {
    resetAllConfirm.hidden = true;
  });
  document.getElementById('confirm-reset-all-btn').addEventListener('click', async () => {
    resetAllConfirm.hidden = true;
    await onResetAllDataConfirmed();
  });

  smartScopeToggle.addEventListener('change', async () => {
    smartScopeLevelField.hidden = !smartScopeToggle.checked;
    await persistSmartScopeConfig({ enabled: smartScopeToggle.checked, level: smartScopeLevel.value });
  });

  smartScopeLevel.addEventListener('change', async (e) => {
    await persistSmartScopeConfig({ level: e.target.value });
  });

  smartScopeDomainSave.addEventListener('click', async () => {
    const validation = normalizeAndValidateDomain(smartScopeDomainInput.value);
    if (!validation.ok) {
      showSmartScopeStatus('error', validation.reason);
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
}

function bindComfortVisualControls() {
  Object.entries(comfortVisualInputs).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', (event) => updateComfortVisualPref(key, event.target.checked));
  });
}

function bindFocusControls() {
  const checkboxMap = {
    distractionDim: focusInputs.distractionDim,
    readingRuler: focusInputs.readingRuler,
    ultraFocus: focusInputs.ultraFocus,
    targetBoost: focusInputs.targetBoost,
    focusNotObscured: focusInputs.focusNotObscured,
    reduceMotion: focusInputs.reduceMotion,
  };

  Object.entries(checkboxMap).forEach(([key, input]) => {
    if (!input) return;
    input.addEventListener('change', (event) => updateFocusPref(key, event.target.checked));
  });

  if (focusInputs.overlayAlpha) {
    focusInputs.overlayAlpha.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 0, 1, 0.2);
      focusInputs.overlayAlpha.value = value;
      updateFocusPref('distractionDimAlpha', value);
    });
  }

  if (focusInputs.readingRulerHeight) {
    focusInputs.readingRulerHeight.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 40, 400, 120);
      focusInputs.readingRulerHeight.value = value;
      updateFocusPref('readingRulerHeightPx', value);
    });
  }

  if (focusInputs.readingRulerOpacity) {
    focusInputs.readingRulerOpacity.addEventListener('change', (event) => {
      const value = normalizeRange(event.target.value, 0, 0.6, 0.12);
      focusInputs.readingRulerOpacity.value = value;
      updateFocusPref('readingRulerOpacity', value);
    });
  }
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

async function updateComfortVisualPref(key, value) {
  const basePrefs = normalizeComfortVisualPrefs(currentComfortVisualPrefs);
  const mergedPrefs = mergeComfortVisualPrefs(basePrefs, { [key]: value });
  const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
  await persistUserPrefs({ modePrefs: { ...modePrefs, comfortVisual: mergedPrefs } });
  currentComfortVisualPrefs = mergedPrefs;
  await requestReapplyActiveTab('prefs:comfortVisual');
}

async function updateFocusPref(key, value) {
  const focusModeId = MODE_IDS.FOCUS;
  const modePrefs = isPlainObject(currentUserPrefs?.modePrefs) ? currentUserPrefs.modePrefs : {};
  const rawFocusPrefs = isPlainObject(modePrefs[focusModeId]) ? modePrefs[focusModeId] : {};
  const basePrefs = normalizeFocusPrefs(rawFocusPrefs);
  const focusPatch = { ...rawFocusPrefs, ...basePrefs };
  const topLevelPatch = {};

  if (key === 'distractionDimAlpha') {
    focusPatch.distractionDimAlpha = value;
    topLevelPatch.focusOverlayAlpha = value;
  } else if (key === 'readingRulerHeightPx') {
    focusPatch.readingRulerHeightPx = value;
    topLevelPatch.readingRulerHeightPx = value;
  } else if (key === 'readingRulerOpacity') {
    focusPatch.readingRulerOpacity = value;
    topLevelPatch.readingRulerOpacity = value;
  } else if (Object.prototype.hasOwnProperty.call(basePrefs, key)) {
    focusPatch[key] = Boolean(value);
  } else {
    return;
  }

  await persistUserPrefs({
    ...topLevelPatch,
    modePrefs: {
      ...modePrefs,
      [focusModeId]: focusPatch,
    },
  });
  currentFocusPrefs = focusPatch;
  await requestReapplyActiveTab('prefs:focus');
}

async function persistUserPrefs(patch, options = {}) {
  const current = isPlainObject(currentUserPrefs) ? currentUserPrefs : {};
  const next = { ...current, ...patch };

  if (isPlainObject(patch?.smartScope)) {
    next.smartScope = { ...(isPlainObject(current.smartScope) ? current.smartScope : {}), ...patch.smartScope };
  }

  if (isPlainObject(patch?.modePrefs)) {
    next.modePrefs = { ...(isPlainObject(current.modePrefs) ? current.modePrefs : {}), ...patch.modePrefs };
  }

  currentUserPrefs = next;
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_PREFS]: currentUserPrefs });
  if (options.showStatus === false) {
    return;
  }

  const message = options.statusMessage || 'Preferences saved';
  showInlineStatus('success', message);
}

async function persistAllowlist() {
  await chrome.storage.local.set({ [STORAGE_KEYS.ALLOWLIST]: currentAllowlist });
}

async function persistDenylist() {
  await chrome.storage.local.set({ [STORAGE_KEYS.DENYLIST]: currentDenylist });
}

function showStatus(element, kind, message) {
  element.textContent = message;
  element.className = `status status-${kind}`;
  element.hidden = false;
  setTimeout(() => {
    element.hidden = true;
  }, 5000);
}

function showInlineStatus(kind, message) {
  showStatus(statusEl, kind, message);
}

function showSpaStatus(kind, message) {
  showStatus(spaStatus, kind, message);
}

function showSmartScopeStatus(kind, message) {
  showStatus(smartScopeStatus, kind, message);
}

function showSmartScopeDebugStatus(kind, message) {
  showStatus(smartScopeDebugStatus, kind, message);
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

async function onExportData() {
  const manifest = chrome.runtime.getManifest();
  const payload = await buildExportPayload(manifest.version);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `aura-export-${date}.json`;
  downloadExport(payload, filename);
  showInlineStatus('success', 'Export created');
}

async function onImportData(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const result = await importPayloadAndApply(payload);
    showInlineStatus('success', `Imported ${result.domains} domains, ${result.modes} modes`);
    await loadAndRenderState();
  } catch (err) {
    showInlineStatus('error', `Import failed: ${err.message || err}`);
  }
}

async function onResetAllDataConfirmed() {
  await resetAllData();
  await loadAndRenderState();
  showInlineStatus('success', 'All data cleared');
}

async function persistSmartScopeConfig(patch = {}, options = {}) {
  const merged = normalizeSmartScopeConfig({
    ...currentSmartScope,
    ...patch,
    perDomain: patch?.perDomain || currentSmartScope.perDomain,
  });

  const statusHandler = options.statusHandler || showSmartScopeStatus;

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.SMARTSCOPE_SET_CONFIG_V1,
      payload: merged,
    });

    if (response?.ok) {
      currentSmartScope = merged;
      currentUserPrefs.smartScope = merged;
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_PREFS]: currentUserPrefs });
      renderSmartScopeSection();

      if (options.showStatus === false) {
        return;
      }

      const statusKind = merged.enabled ? 'success' : 'info';
      const message =
        options.statusMessage ||
        (merged.enabled ? 'SmartScope settings saved' : 'SmartScope disabled. Baseline STRICT enforced.');
      statusHandler(statusKind, message);
      if (!merged.enabled && statusHandler === showSmartScopeStatus) {
        statusHandler('info', 'Use panic reset to clean open tabs if needed.');
      }
    } else {
      statusHandler('error', response?.error || 'Unable to save SmartScope settings');
    }
  } catch (error) {
    statusHandler('error', error?.message || 'Unable to save SmartScope settings');
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
    await chrome.storage.local.remove('smartScopeDebugLogs');
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
      currentUserPrefs.smartScope = currentSmartScope;
      await chrome.storage.local.set({ [STORAGE_KEYS.USER_PREFS]: currentUserPrefs });
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

async function onResetAllLearningConfirmed() {
  const reset = {};
  for (const [domain, perMode] of Object.entries(currentLearning)) {
    reset[domain] = {};
    Object.keys(perMode || {}).forEach((modeId) => {
      reset[domain][modeId] = { stage: LEARNING_STAGES.MANUAL, weight: 0 };
    });
  }
  currentLearning = reset;
  await chrome.storage.local.set({ [STORAGE_KEYS.LEARNING_WEIGHTS]: reset });
  renderLearningTable();
  showInlineStatus('success', 'Learning reset');
}

async function onResetDomainLearningConfirmed(domain) {
  if (!currentLearning[domain]) {
    showInlineStatus('info', 'No learning data for domain');
    return;
  }

  const updated = { ...currentLearning };
  updated[domain] = {};
  Object.keys(currentLearning[domain]).forEach((modeId) => {
    updated[domain][modeId] = { stage: LEARNING_STAGES.MANUAL, weight: 0 };
  });

  currentLearning = updated;
  await chrome.storage.local.set({ [STORAGE_KEYS.LEARNING_WEIGHTS]: updated });
  renderLearningTable();
  showInlineStatus('success', `Learning reset for ${domain}`);
}

function showDomainResetConfirm(domain) {
  const existing = document.getElementById('confirm-reset-domain');
  if (existing) existing.remove();
  const panel = document.createElement('div');
  panel.className = 'confirm';
  panel.id = 'confirm-reset-domain';
  const text = document.createElement('p');
  text.textContent = `Reset learning for ${domain}?`;
  const actions = document.createElement('div');
  actions.className = 'confirm-actions';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => panel.remove());
  const confirm = document.createElement('button');
  confirm.className = 'btn danger';
  confirm.textContent = 'Confirm reset';
  confirm.addEventListener('click', async () => {
    panel.remove();
    await onResetDomainLearningConfirmed(domain);
  });
  actions.append(cancel, confirm);
  panel.append(text, actions);
  learningBody.parentElement.appendChild(panel);
}

function normalizeAndValidateDomain(input) {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed) return { ok: false, reason: 'Domain required' };

  let host;
  try {
    host = new URL(`https://${trimmed}`).hostname;
  } catch (e) {
    return { ok: false, reason: 'Invalid domain' };
  }

  if (!host || host.includes('/')) return { ok: false, reason: 'Invalid domain' };
  const normalized = toBaseDomain(host);
  if (!normalized) return { ok: false, reason: 'Domain must be eTLD+1 (example.com)' };
  return { ok: true, domain: normalized };
}

function toBaseDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  // Heuristic for multi-part TLDs (e.g., co.uk). If last part length is 2 and
  // the preceding part length is <= 3, keep the last three labels. Otherwise,
  // keep the last two labels (eTLD+1 approximation).
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

initOptionsPage();
