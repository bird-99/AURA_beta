import { MODE_IDS, STATES, ACTIONS, STORAGE_KEYS, SITE_BLOCK_REASONS } from '../shared/constants.js';
import { initFeatureFlags, isFlagEnabled } from '../shared/feature-flags.js';
import { getExclusivePeerModeId } from '../shared/mode-exclusivity.js';

let currentTabId = null;
let currentTabUrl = null;
let smartScopeDebugEnabled = false;
let sitePolicy = null;
let sitePolicyError = false;
let sitePolicyRefreshTimeout = null;
const smartScopeStatuses = {};

const MODE_LABELS = {
  [MODE_IDS.COMFORT_VISUAL]: 'Comfort Visual',
  [MODE_IDS.FOCUS]: 'Focus',
};

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
  console.log('[Popup] Current tab:', currentTabId);

  await initFeatureFlags();
  await loadSmartScopeDebugFlag();
  await loadSitePolicy();
  await loadModeStates();
  setupEventListeners();
  await handlePopupReady();
  chrome.runtime.onMessage.addListener(handleMessage);

  await loadPerformanceMetrics(currentTabId);
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
    if (!metrics) {
      return;
    }

    const performanceSection = document.getElementById('performance-section');
    if (performanceSection) {
      performanceSection.style.display = 'block';
    }

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

    if (isDegraded) {
      const degradedWarning = document.getElementById('degraded-warning');
      if (degradedWarning) {
        degradedWarning.style.display = 'block';
      }
    }
  } catch (error) {
    console.error('[Popup] Failed to load performance metrics:', error);
  }
}

// ========== LOAD STATE ==========
async function loadModeStates() {
  for (const modeId of Object.values(MODE_IDS)) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_STATE,
        tabId: currentTabId,
        modeId
      });

      const state = response?.state;
      setModeActive(modeId, state?.state === STATES.ACTIVE);
      renderSmartScopeDebug(modeId, state?.smartScope);
      renderSmartScopeStatus(modeId, state?.smartScopeStatus);
    } catch (error) {
      console.error(`[Popup] Failed to load state for ${modeId}:`, error);
      setModeActive(modeId, false);
      renderSmartScopeDebug(modeId, null);
      renderSmartScopeStatus(modeId, { ok: false, error: error?.message || 'CS_UNREACHABLE', timestamp: Date.now(), action: 'verify' });
    }
  }

  applySitePolicyToModes();
}

async function loadSmartScopeDebugFlag() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.USER_PREFS);
    smartScopeDebugEnabled = Boolean(stored?.[STORAGE_KEYS.USER_PREFS]?.smartScope?.debugEnabled);
  } catch (error) {
    smartScopeDebugEnabled = false;
  }
}

function getHostFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host || null;
  } catch (error) {
    return null;
  }
}

async function loadSitePolicy() {
  sitePolicyError = false;
  sitePolicy = null;

  if (!isFlagEnabled('siteSuppressV1')) {
    sitePolicy = {
      allowed: true,
      reason: null,
      host: getHostFromUrl(currentTabUrl),
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
  const card = document.getElementById(`${modeId}-card`);
  const buttonId = modeId === MODE_IDS.COMFORT_VISUAL ? 'comfort-toggle' : 'focus-toggle';
  const button = document.getElementById(buttonId);

  if (!card || !button) {
    return;
  }

  const modeLabel = MODE_LABELS[modeId] || modeId;

  if (isActive) {
    card.classList.add('active');
    button.textContent = 'Disable';
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', `Disable ${modeLabel} mode`);
  } else {
    card.classList.remove('active');
    button.textContent = 'Enable';
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `Enable ${modeLabel} mode`);
  }

  applySitePolicyToButton(button);
}

function renderSmartScopeDebug(modeId, smartScopeState) {
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

  if (smartScopeState && (smartScopeState.variant || smartScopeState.appliedVariant)) {
    const variant = smartScopeState.variant || smartScopeState.appliedVariant;
    const scope = smartScopeState.scopeProfile?.reason ? ` — ${smartScopeState.scopeProfile.reason}` : '';
    target.textContent = `SmartScope: ${variant}${scope}`;
  } else {
    target.textContent = 'SmartScope: STRICT (fallback)';
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
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
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

  const overrideButton = document.getElementById('site-policy-override');
  if (overrideButton) {
    overrideButton.addEventListener('click', async () => {
      if (!currentTabId) {
        return;
      }
      await requestSiteOverride();
    });
  }

  const optionsLink = document.getElementById('open-options');
  if (optionsLink) {
    optionsLink.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
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
    banner.style.display = 'block';
    title.textContent = 'Policy unavailable';
    detail.textContent = 'Unable to verify site policy. Controls remain enabled.';
    overrideButton.style.display = 'none';
    return;
  }

  if (!sitePolicy || sitePolicy.allowed !== false) {
    banner.style.display = 'none';
    title.textContent = '';
    detail.textContent = '';
    overrideButton.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  title.textContent = `Disabled on this site: ${formatPolicyReason(sitePolicy.reason)}`;

  const detailText = formatPolicyDetail(sitePolicy);
  detail.textContent = detailText;

  if (canTryOnce(sitePolicy)) {
    overrideButton.style.display = 'inline-flex';
  } else {
    overrideButton.style.display = 'none';
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

  try {
    if (peerModeId && currentTabId) {
      try {
        await chrome.runtime.sendMessage({
          action: ACTIONS.RESTORE_MODE,
          tabId: currentTabId,
          modeId: peerModeId
        });
        setModeActive(peerModeId, false);
      } catch (error) {
        console.warn('[Popup] Failed to disable peer mode', peerModeId, error);
      }
    }

    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.USER_DECISION,
      tabId: currentTabId,
      modeId,
      decision: 'ENABLED'
    });

    if (response?.ok) {
      setModeActive(modeId, true);
    } else {
      console.warn('[Popup] Failed to enable', modeId, response);
      console.warn('[Popup] Enable error response json', JSON.stringify(response ?? {}, null, 2));
    }
  } catch (error) {
    console.warn('[Popup] Enable error', modeId, error);
    console.warn('[Popup] Enable error json', JSON.stringify(error ?? {}, null, 2));
  } finally {
    await loadModeStates();
  }
}

async function handleDisable(modeId) {
  console.log('[Popup] Disabling', modeId);

  try {
    const response = await chrome.runtime.sendMessage({
      action: ACTIONS.RESTORE_MODE,
      tabId: currentTabId,
      modeId
    });

    if (response?.ok) {
      setModeActive(modeId, false);
    } else {
      console.warn('[Popup] Failed to disable', modeId, response);
      console.warn('[Popup] Disable error response json', JSON.stringify(response ?? {}, null, 2));
    }
  } catch (error) {
    console.warn('[Popup] Disable error', modeId, error);
    console.warn('[Popup] Disable error json', JSON.stringify(error ?? {}, null, 2));
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
  const section = document.getElementById('why-section');
  const modeName = document.getElementById('why-mode-name');
  const signalsList = document.getElementById('signals-list');

  if (!section || !modeName || !signalsList) {
    return;
  }

  section.style.display = 'block';
  modeName.textContent = modeId === MODE_IDS.COMFORT_VISUAL ? 'Comfort Visual' : 'Focus';

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

  section.scrollIntoView({ behavior: 'smooth' });
}

// ========== START ==========
init();
