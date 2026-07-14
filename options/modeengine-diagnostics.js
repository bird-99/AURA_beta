function formatTimestamp(ts) {
  if (typeof ts !== 'number') {
    return '—';
  }
  return new Date(ts).toLocaleString();
}

function formatValue(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    return json && json.length > 200 ? `${json.slice(0, 199)}…` : json;
  } catch (_) {
    return '[object]';
  }
}

function clearTableBody(documentRef, body, emptyMessage, colSpan) {
  if (!body) return;
  body.textContent = '';
  if (!emptyMessage) return;
  const row = documentRef.createElement('tr');
  row.className = 'empty-row';
  const cell = documentRef.createElement('td');
  cell.colSpan = colSpan;
  cell.textContent = emptyMessage;
  row.appendChild(cell);
  body.appendChild(row);
}

function appendCells(documentRef, row, values) {
  for (const value of values) {
    const cell = documentRef.createElement('td');
    cell.textContent = value;
    row.appendChild(cell);
  }
}

function formatTabLabel(tab) {
  let hostname = 'web page';
  try {
    hostname = new URL(tab.url).hostname || hostname;
  } catch (_) {
    // Supported URLs are filtered by the controller.
  }
  const title = typeof tab.title === 'string' && tab.title.trim()
    ? tab.title.trim().slice(0, 60)
    : `Tab ${tab.id}`;
  return `${title} — ${hostname}`;
}

export function createModeEngineDiagnosticsView({ document: documentRef, reportStatus }) {
  const targetSelect = documentRef.getElementById('debug-target-tab');
  const refreshButton = documentRef.getElementById('debug-snapshot-refresh');
  const exportButton = documentRef.getElementById('debug-snapshot-export');
  const snapshotBody = documentRef.getElementById('debug-snapshot-body');
  const signalsBody = documentRef.getElementById('debug-signals-body');
  const decisionsBody = documentRef.getElementById('debug-decisions-body');
  let hasTarget = false;
  let busy = false;

  function updateButtons() {
    if (refreshButton) refreshButton.disabled = busy || !hasTarget;
    if (exportButton) exportButton.disabled = busy || !hasTarget;
  }

  function renderSnapshot(snapshot) {
    const entries = snapshot?.byType && typeof snapshot.byType === 'object'
      ? Object.entries(snapshot.byType)
      : [];
    const rows = entries.filter(([, entry]) => entry && typeof entry.ts === 'number');
    snapshotBody.textContent = '';
    if (!rows.length) {
      clearTableBody(documentRef, snapshotBody, 'No signal snapshot available.', 5);
      return;
    }
    for (const [type, entry] of rows) {
      const row = documentRef.createElement('tr');
      appendCells(documentRef, row, [
        type,
        formatValue(entry.value),
        typeof entry.confidence === 'number' ? entry.confidence.toFixed(2) : '—',
        entry.source || '—',
        formatTimestamp(entry.ts),
      ]);
      snapshotBody.appendChild(row);
    }
  }

  function renderSignals(signals = []) {
    signalsBody.textContent = '';
    if (!Array.isArray(signals) || signals.length === 0) {
      clearTableBody(documentRef, signalsBody, 'No recent signals.', 5);
      return;
    }
    const ordered = [...signals].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
    for (const entry of ordered) {
      const row = documentRef.createElement('tr');
      appendCells(documentRef, row, [
        entry.type || '—',
        formatValue(entry.value),
        typeof entry.confidence === 'number' ? entry.confidence.toFixed(2) : '—',
        entry.source || '—',
        formatTimestamp(entry.ts),
      ]);
      signalsBody.appendChild(row);
    }
  }

  function renderDecisions(decisions = []) {
    decisionsBody.textContent = '';
    if (!Array.isArray(decisions) || decisions.length === 0) {
      clearTableBody(documentRef, decisionsBody, 'No recent decisions.', 6);
      return;
    }
    const ordered = [...decisions].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
    for (const entry of ordered) {
      const row = documentRef.createElement('tr');
      appendCells(documentRef, row, [
        entry.decision || '—',
        entry.modeId || '—',
        typeof entry.score === 'number' ? entry.score.toFixed(3) : '—',
        Array.isArray(entry.reasonCodes) && entry.reasonCodes.length ? entry.reasonCodes.join(', ') : '—',
        Array.isArray(entry.contributingSignals) && entry.contributingSignals.length
          ? entry.contributingSignals.join(', ')
          : '—',
        formatTimestamp(entry.ts),
      ]);
      decisionsBody.appendChild(row);
    }
  }

  return {
    bind({ onRefresh, onExport, onSelect }) {
      refreshButton?.addEventListener('click', onRefresh);
      exportButton?.addEventListener('click', onExport);
      targetSelect?.addEventListener('change', () => onSelect(targetSelect.value));
    },
    renderTargets(tabs, selectedTabId) {
      if (!targetSelect) return;
      targetSelect.textContent = '';
      for (const tab of tabs) {
        const option = documentRef.createElement('option');
        option.value = String(tab.id);
        option.textContent = formatTabLabel(tab);
        targetSelect.appendChild(option);
      }
      if (selectedTabId) {
        targetSelect.value = String(selectedTabId);
        targetSelect.disabled = false;
      } else {
        const option = documentRef.createElement('option');
        option.value = '';
        option.textContent = tabs.length ? 'Choose a supported web tab' : 'No supported web tab available';
        targetSelect.prepend(option);
        targetSelect.value = '';
        targetSelect.disabled = tabs.length === 0;
      }
      hasTarget = Boolean(selectedTabId);
      updateButtons();
    },
    renderDiagnostic(diagnostic) {
      renderSnapshot(diagnostic?.signals?.snapshot);
      renderSignals(diagnostic?.signals?.recentSignals);
      renderDecisions(diagnostic?.signals?.recentDecisions);
    },
    renderEmpty() {
      clearTableBody(documentRef, snapshotBody, 'No signal snapshot available.', 5);
      clearTableBody(documentRef, signalsBody, 'No recent signals.', 5);
      clearTableBody(documentRef, decisionsBody, 'No recent decisions.', 6);
    },
    setBusy(nextBusy) {
      busy = nextBusy === true;
      updateButtons();
    },
    reportStatus(kind, message) {
      reportStatus?.(kind, message);
    },
  };
}

function normalizeTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => Number.isInteger(tab?.id) && /^https?:\/\//i.test(tab?.url || ''))
    .sort((a, b) => Number(b.active === true) - Number(a.active === true) || a.id - b.id);
}

export function createModeEngineDiagnosticsController({
  listTabs,
  requestSnapshot,
  downloadSnapshot,
  view,
  now = () => new Date(),
}) {
  let targets = [];
  let currentTargetTabId = null;
  let acceptedSnapshot = null;
  let requestGeneration = 0;
  let targetQueryGeneration = 0;
  let disposed = false;

  function invalidateSnapshot({ renderEmpty = true } = {}) {
    requestGeneration += 1;
    acceptedSnapshot = null;
    if (renderEmpty) view.renderEmpty();
  }

  async function refreshTargets({ allowInitialSelection = false } = {}) {
    if (disposed) return { ok: false, error: 'DEBUG_CONTROLLER_DISPOSED' };
    const queryGeneration = targetQueryGeneration + 1;
    targetQueryGeneration = queryGeneration;
    let nextTargets;
    try {
      nextTargets = normalizeTabs(await listTabs());
    } catch (error) {
      if (disposed || queryGeneration !== targetQueryGeneration) {
        return { ok: false, error: 'DEBUG_TARGET_QUERY_OBSOLETE', stale: true };
      }
      targets = [];
      currentTargetTabId = null;
      invalidateSnapshot();
      view.renderTargets(targets, currentTargetTabId);
      return { ok: false, error: error?.message || 'Unable to list debug targets' };
    }
    if (disposed || queryGeneration !== targetQueryGeneration) {
      return { ok: false, error: 'DEBUG_TARGET_QUERY_OBSOLETE', stale: true };
    }

    const previous = currentTargetTabId;
    targets = nextTargets;
    const previousStillExists = targets.some((tab) => tab.id === previous);
    const nextTargetTabId = previousStillExists
      ? previous
      : allowInitialSelection && previous === null
        ? targets[0]?.id || null
        : null;
    if (nextTargetTabId !== previous) {
      currentTargetTabId = nextTargetTabId;
      invalidateSnapshot();
    }
    view.renderTargets(targets, currentTargetTabId);
    return { ok: true, selectedTabId: currentTargetTabId };
  }

  async function refresh({ showStatus = true, reloadTargets = false } = {}) {
    if (disposed) return { ok: false, error: 'DEBUG_CONTROLLER_DISPOSED' };
    let generation = null;
    try {
      if (reloadTargets) {
        const targetResult = await refreshTargets({ allowInitialSelection: false });
        if (!targetResult.ok) {
          if (!targetResult.stale && showStatus) view.reportStatus('error', targetResult.error);
          return targetResult;
        }
      }
      if (!currentTargetTabId) {
        invalidateSnapshot();
        view.renderEmpty();
        if (showStatus) view.reportStatus('error', 'Choose an HTTP(S) tab to inspect');
        return { ok: false, error: 'DEBUG_TARGET_REQUIRED' };
      }

      const requestedTabId = currentTargetTabId;
      generation = requestGeneration + 1;
      requestGeneration = generation;
      acceptedSnapshot = null;
      view.renderEmpty();
      view.setBusy?.(true);
      const response = await requestSnapshot(requestedTabId);

      if (disposed || generation !== requestGeneration || requestedTabId !== currentTargetTabId) {
        return { ok: false, error: 'DEBUG_REQUEST_OBSOLETE', stale: true };
      }
      if (!response?.ok) {
        view.renderEmpty();
        if (showStatus) view.reportStatus('error', response?.error || 'Unable to load debug snapshot');
        return { ok: false, error: response?.error || 'Unable to load debug snapshot' };
      }

      if (response.diagnostic?.target?.tabId !== requestedTabId) {
        view.renderEmpty();
        if (showStatus) view.reportStatus('error', 'Debug snapshot target mismatch');
        return { ok: false, error: 'DEBUG_TARGET_MISMATCH' };
      }

      acceptedSnapshot = {
        tabId: requestedTabId,
        generation,
        diagnostic: response.diagnostic,
      };
      view.renderDiagnostic(response.diagnostic);
      if (showStatus) view.reportStatus('success', 'Debug snapshot refreshed');
      return { ok: true, diagnostic: response.diagnostic };
    } catch (error) {
      const message = error?.message || 'Unable to load debug snapshot';
      if (!disposed && showStatus) view.reportStatus('error', message);
      return { ok: false, error: message };
    } finally {
      if (!disposed && generation !== null && generation === requestGeneration) {
        view.setBusy?.(false);
      }
    }
  }

  async function selectTarget(tabId) {
    if (disposed) return { ok: false, error: 'DEBUG_CONTROLLER_DISPOSED' };
    targetQueryGeneration += 1;
    const selected = Number.parseInt(String(tabId), 10);
    const nextTargetTabId = Number.isInteger(selected)
      && selected > 0
      && targets.some((tab) => tab.id === selected)
      ? selected
      : null;
    if (nextTargetTabId !== currentTargetTabId) {
      currentTargetTabId = nextTargetTabId;
      invalidateSnapshot();
    }
    view.renderTargets(targets, currentTargetTabId);
    if (!currentTargetTabId) {
      view.reportStatus('error', 'Choose an HTTP(S) tab to inspect');
      return { ok: false, error: 'DEBUG_TARGET_REQUIRED' };
    }
    return refresh({ showStatus: true });
  }

  async function exportSnapshot() {
    if (disposed) return { ok: false, error: 'DEBUG_CONTROLLER_DISPOSED' };
    try {
      const targetsResult = await refreshTargets({ allowInitialSelection: false });
      if (!targetsResult.ok) {
        if (targetsResult.stale) return targetsResult;
        throw new Error(targetsResult.error);
      }
      if (!currentTargetTabId) {
        throw new Error('Choose an HTTP(S) tab to export');
      }

      const refreshResult = await refresh({ showStatus: false });
      if (!refreshResult.ok) {
        if (refreshResult.stale) return refreshResult;
        throw new Error(refreshResult.error || 'Unable to refresh debug snapshot');
      }
      if (!acceptedSnapshot
        || acceptedSnapshot.tabId !== currentTargetTabId
        || acceptedSnapshot.diagnostic?.target?.tabId !== currentTargetTabId) {
        throw new Error('Debug snapshot target mismatch');
      }

      const date = now().toISOString().slice(0, 10);
      downloadSnapshot(acceptedSnapshot.diagnostic, `aura-debug-snapshot-${date}.json`);
      view.reportStatus('success', 'Debug snapshot exported');
      return { ok: true };
    } catch (error) {
      const message = error?.message || 'Unable to export debug snapshot';
      view.reportStatus('error', message);
      return { ok: false, error: message };
    }
  }

  return {
    async initialize() {
      const targetsResult = await refreshTargets({ allowInitialSelection: true });
      if (!targetsResult.ok) return targetsResult;
      if (currentTargetTabId) await refresh({ showStatus: false });
      return { ok: true };
    },
    refresh,
    refreshTargets,
    selectTarget,
    exportSnapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      targetQueryGeneration += 1;
      invalidateSnapshot();
      view.setBusy?.(false);
    },
  };
}
