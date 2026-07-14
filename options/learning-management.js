/** @typedef {'success'|'error'|'info'} LearningStatusKind */
/** @typedef {Record<string, any>} LearningRecord */
/** @typedef {{ domain: string, modes: string[], stage: string, weight: string, decision: any, decisionTimestamp: any }} LearningRow */
/** @typedef {{ ok: boolean, reason?: string, stale?: boolean }} LearningOperationResult */
/** @typedef {{
 * setQuery: (query: string) => boolean,
 * showResetAllConfirmation: () => boolean,
 * hideResetAllConfirmation: () => boolean,
 * showDomainResetConfirmation: (domain: string) => boolean,
 * hideDomainResetConfirmation: () => boolean,
 * confirmResetAll: () => Promise<LearningOperationResult>,
 * confirmDomainReset: (domain: string) => Promise<LearningOperationResult>,
 * }} LearningManagementActions
 */
/** @typedef {{
 * bind: (actions: LearningManagementActions) => void|(() => void),
 * renderRows: (rows: LearningRow[], query: string) => void,
 * setResetAllConfirmationVisible: (visible: boolean) => void,
 * setDomainResetConfirmation: (domain: string|null) => void,
 * setBusy: (busy: boolean) => void,
 * reportInline: (kind: LearningStatusKind, message: string) => void,
 * reportLearning: (kind: LearningStatusKind, message: string) => void,
 * dispose?: () => void,
 * }} LearningManagementView
 */

function requireFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} dependency is required`);
  }
}

/** @param {unknown} value @returns {LearningRecord} */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** @param {unknown} decisionInfo @returns {LearningRecord} */
function pickLatestDecision(decisionInfo) {
  const entries = Object.entries(asRecord(decisionInfo));
  if (!entries.length) return {};
  entries.sort(([leftMode, left], [rightMode, right]) => {
    const leftTimestamp = Number.isFinite(left?.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
    const rightTimestamp = Number.isFinite(right?.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
    return rightTimestamp - leftTimestamp || leftMode.localeCompare(rightMode);
  });
  return asRecord(entries[0][1]);
}

/**
 * @param {unknown} learning
 * @param {unknown} decisions
 * @param {{ manualStage?: string }} [options]
 * @returns {LearningRow[]}
 */
export function buildLearningRows(learning, decisions, { manualStage = 'MANUAL' } = {}) {
  const learningState = asRecord(learning);
  const decisionState = asRecord(decisions);
  return Object.keys(learningState)
    .sort((a, b) => a.localeCompare(b))
    .map((domain) => {
      const perMode = asRecord(learningState[domain]);
      const modes = Object.keys(perMode).sort((a, b) => a.localeCompare(b));
      const stages = modes.map((modeId) => perMode[modeId]?.stage || manualStage);
      const weights = modes.map((modeId) => Number(perMode[modeId]?.weight || 0).toFixed(2));
      const selectedDecision = pickLatestDecision(decisionState[domain]);
      return {
        domain,
        modes: modes.length ? modes : ['—'],
        stage: stages.length ? stages.join(', ') : manualStage,
        weight: weights.length ? weights.join(', ') : '0.00',
        decision: selectedDecision.decision || null,
        decisionTimestamp: selectedDecision.timestamp || null,
      };
    });
}

/**
 * @param {{
 * document?: Document,
 * formatTimestamp?: (timestamp: any) => string,
 * reportInlineStatus?: (kind: LearningStatusKind, message: string) => void,
 * reportSectionStatus?: (sectionId: string, kind: LearningStatusKind, message: string) => void,
 * }} [dependencies]
 * @returns {LearningManagementView}
 */
export function createOptionsLearningManagementView({
  document: documentRef,
  formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString(),
  reportInlineStatus,
  reportSectionStatus,
} = {}) {
  if (!documentRef || typeof documentRef.getElementById !== 'function') {
    throw new TypeError('document dependency is required');
  }
  requireFunction('formatTimestamp', formatTimestamp);
  requireFunction('reportInlineStatus', reportInlineStatus);
  requireFunction('reportSectionStatus', reportSectionStatus);

  const elements = {
    section: /** @type {HTMLElement|null} */ (documentRef.getElementById('section-learning')),
    body: /** @type {HTMLElement|null} */ (documentRef.getElementById('learning-body')),
    search: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('learning-search')),
    resetAllButton: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('reset-learning-all')),
    resetAllConfirmation: /** @type {HTMLElement|null} */ (documentRef.getElementById('confirm-reset-learning')),
    cancelResetAllButton: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('cancel-reset-learning')),
    confirmResetAllButton: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('confirm-reset-learning-btn')),
    domainConfirmationHost: /** @type {HTMLElement|null} */ (documentRef.getElementById('learning-domain-confirmation-host')),
  };
  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`Missing Learning management element: ${name}`);
  }

  let unbind = null;
  /** @type {LearningManagementActions|null} */
  let boundActions = null;
  /** @type {HTMLElement|null} */
  let domainReturnFocus = null;

  function removeDomainConfirmation({ restoreFocus = true } = {}) {
    documentRef.getElementById('confirm-reset-domain')?.remove();
    if (restoreFocus && domainReturnFocus?.isConnected && typeof domainReturnFocus.focus === 'function') {
      domainReturnFocus.focus();
    }
    domainReturnFocus = null;
  }

  function renderLastDecision(row) {
    if (!row.decision) return '—';
    return row.decisionTimestamp
      ? `${row.decision} (${formatTimestamp(row.decisionTimestamp)})`
      : row.decision;
  }

  return Object.freeze({
    bind(actions) {
      if (unbind) return unbind;
      boundActions = actions;
      const onSearch = (event) => actions.setQuery(event.target.value);
      const onResetAll = () => actions.showResetAllConfirmation();
      const onCancelResetAll = () => actions.hideResetAllConfirmation();
      const onConfirmResetAll = () => { void actions.confirmResetAll(); };
      const onBodyClick = (event) => {
        const button = event.target.closest?.('button[data-learning-reset-domain]');
        if (!button || !elements.body.contains(button)) return;
        actions.showDomainResetConfirmation(button.dataset.learningResetDomain);
      };
      elements.search.addEventListener('input', onSearch);
      elements.resetAllButton.addEventListener('click', onResetAll);
      elements.cancelResetAllButton.addEventListener('click', onCancelResetAll);
      elements.confirmResetAllButton.addEventListener('click', onConfirmResetAll);
      elements.body.addEventListener('click', onBodyClick);
      unbind = () => {
        elements.search.removeEventListener('input', onSearch);
        elements.resetAllButton.removeEventListener('click', onResetAll);
        elements.cancelResetAllButton.removeEventListener('click', onCancelResetAll);
        elements.confirmResetAllButton.removeEventListener('click', onConfirmResetAll);
        elements.body.removeEventListener('click', onBodyClick);
        removeDomainConfirmation();
        boundActions = null;
        unbind = null;
      };
      return unbind;
    },
    renderRows(rows, query) {
      elements.body.textContent = '';
      const filteredRows = rows.filter((row) => {
        if (!query) return true;
        return row.domain.toLowerCase().includes(query.toLowerCase());
      });
      const hasQuery = Boolean(query?.trim());
      if (!filteredRows.length) {
        const row = documentRef.createElement('tr');
        row.className = 'empty-row';
        const cell = documentRef.createElement('td');
        cell.colSpan = 6;
        cell.textContent = hasQuery ? 'No matching domains.' : 'No learning data yet.';
        row.appendChild(cell);
        elements.body.appendChild(row);
        return;
      }

      for (const row of filteredRows) {
        const tableRow = documentRef.createElement('tr');
        for (const value of [row.domain, row.modes.join(', '), row.stage, row.weight, renderLastDecision(row)]) {
          const cell = documentRef.createElement('td');
          cell.textContent = value;
          tableRow.appendChild(cell);
        }
        const actionCell = documentRef.createElement('td');
        const button = documentRef.createElement('button');
        button.className = 'btn danger';
        button.textContent = 'Reset';
        button.dataset.learningResetDomain = row.domain;
        actionCell.appendChild(button);
        tableRow.appendChild(actionCell);
        elements.body.appendChild(tableRow);
      }
    },
    setResetAllConfirmationVisible(visible) {
      elements.resetAllConfirmation.hidden = !visible;
    },
    setBusy(busy) {
      elements.resetAllButton.disabled = busy;
      elements.confirmResetAllButton.disabled = busy;
      for (const button of elements.body.querySelectorAll('button[data-learning-reset-domain]')) {
        if (button instanceof HTMLButtonElement) button.disabled = busy;
      }
      const domainConfirm = documentRef.querySelector('#confirm-reset-domain button.danger');
      if (domainConfirm instanceof HTMLButtonElement) domainConfirm.disabled = busy;
      if (busy) elements.section.setAttribute('aria-busy', 'true');
      else elements.section.removeAttribute('aria-busy');
    },
    setDomainResetConfirmation(domain) {
      removeDomainConfirmation();
      if (!domain) return;
      domainReturnFocus = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
      const panel = documentRef.createElement('div');
      panel.className = 'confirm';
      panel.id = 'confirm-reset-domain';
      const text = documentRef.createElement('p');
      text.textContent = `Reset learning for ${domain}?`;
      const actions = documentRef.createElement('div');
      actions.className = 'confirm-actions';
      const cancel = documentRef.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => boundActions?.hideDomainResetConfirmation());
      const confirm = documentRef.createElement('button');
      confirm.className = 'btn danger';
      confirm.textContent = 'Confirm reset';
      confirm.addEventListener('click', () => { void boundActions?.confirmDomainReset(domain); });
      actions.append(cancel, confirm);
      panel.append(text, actions);
      elements.domainConfirmationHost.appendChild(panel);
      confirm.focus();
    },
    reportInline(kind, message) {
      reportInlineStatus(kind, message);
    },
    reportLearning(kind, message) {
      reportSectionStatus('learning', kind, message);
    },
    dispose() {
      removeDomainConfirmation({ restoreFocus: false });
      unbind?.();
    },
  });
}

/**
 * @param {{
 * mutateLearning?: (updater: (stored: unknown) => unknown|Promise<unknown>) => Promise<unknown>,
 * view?: LearningManagementView,
 * learningStages?: { MANUAL: string },
 * }} [dependencies]
 */
export function createOptionsLearningManagementController({
  mutateLearning,
  view,
  learningStages,
} = {}) {
  requireFunction('mutateLearning', mutateLearning);
  if (!view || typeof view.bind !== 'function') {
    throw new TypeError('view dependency is required');
  }
  if (!learningStages?.MANUAL) {
    throw new TypeError('learningStages.MANUAL dependency is required');
  }

  let learning = {};
  let decisions = {};
  let query = '';
  let initialized = false;
  let disposed = false;
  let operationInFlight = false;
  let generation = 0;

  function render() {
    if (disposed) return;
    view.renderRows(buildLearningRows(learning, decisions, { manualStage: learningStages.MANUAL }), query);
  }

  async function runOperation(label, operation) {
    if (disposed) return { ok: false, reason: 'LEARNING_CONTROLLER_DISPOSED' };
    if (operationInFlight) {
      view.reportLearning('info', 'Another learning operation is already running');
      return { ok: false, reason: 'LEARNING_OPERATION_IN_PROGRESS' };
    }
    operationInFlight = true;
    const operationGeneration = generation;
    const isCurrent = () => !disposed && generation === operationGeneration;
    view.setBusy(true);
    try {
      return await operation(isCurrent);
    } catch (error) {
      const detail = error?.message || String(error);
      if (isCurrent()) {
        view.reportInline('error', `${label} failed: ${detail}`);
        view.reportLearning('error', `${label} failed`);
      }
      return { ok: false, reason: detail };
    } finally {
      operationInFlight = false;
      if (isCurrent()) view.setBusy(false);
    }
  }

  const actions = Object.freeze({
    setQuery(nextQuery) {
      if (disposed) return false;
      query = String(nextQuery || '').trim().toLowerCase();
      render();
      return true;
    },
    showResetAllConfirmation() {
      if (disposed || operationInFlight) return false;
      view.setResetAllConfirmationVisible(true);
      return true;
    },
    hideResetAllConfirmation() {
      if (disposed) return false;
      view.setResetAllConfirmationVisible(false);
      return true;
    },
    showDomainResetConfirmation(domain) {
      if (disposed || operationInFlight) return false;
      view.setDomainResetConfirmation(domain);
      return true;
    },
    hideDomainResetConfirmation() {
      if (disposed) return false;
      view.setDomainResetConfirmation(null);
      return true;
    },
    confirmResetAll() {
      if (disposed) return runOperation('Learning reset', async () => ({ ok: false }));
      view.setResetAllConfirmationVisible(false);
      return runOperation('Learning reset', async (isCurrent) => {
        const committed = await mutateLearning((storedLearning) => {
          const reset = {};
          for (const [domain, perMode] of Object.entries(asRecord(storedLearning))) {
            reset[domain] = {};
            for (const modeId of Object.keys(asRecord(perMode))) {
              reset[domain][modeId] = { stage: learningStages.MANUAL, weight: 0 };
            }
          }
          return reset;
        });
        if (!isCurrent()) return { ok: false, reason: 'LEARNING_OPERATION_STALE', stale: true };
        learning = asRecord(committed);
        render();
        view.reportInline('success', 'Learning reset');
        view.reportLearning('success', 'Learning reset');
        return { ok: true };
      });
    },
    confirmDomainReset(domain) {
      if (disposed) return runOperation('Learning reset', async () => ({ ok: false }));
      view.setDomainResetConfirmation(null);
      return runOperation('Learning reset', async (isCurrent) => {
        let found = false;
        const committed = await mutateLearning((storedLearning) => {
          const updated = { ...asRecord(storedLearning) };
          if (!Object.prototype.hasOwnProperty.call(updated, domain)) return updated;
          found = true;
          const currentDomain = asRecord(updated[domain]);
          updated[domain] = {};
          for (const modeId of Object.keys(currentDomain)) {
            updated[domain][modeId] = { stage: learningStages.MANUAL, weight: 0 };
          }
          return updated;
        });
        if (!isCurrent()) return { ok: false, reason: 'LEARNING_OPERATION_STALE', stale: true };
        learning = asRecord(committed);
        render();
        if (!found) {
          view.reportInline('info', 'No learning data for domain');
          view.reportLearning('info', 'No learning data for domain');
          return { ok: false, reason: 'LEARNING_DOMAIN_MISSING' };
        }
        view.reportInline('success', `Learning reset for ${domain}`);
        view.reportLearning('success', 'Learning reset');
        return { ok: true };
      });
    },
  });

  return Object.freeze({
    initialize() {
      if (disposed || initialized) return false;
      initialized = true;
      view.bind(actions);
      return true;
    },
    setState(nextState = {}) {
      if (disposed) return false;
      learning = { ...asRecord(nextState.learning) };
      decisions = { ...asRecord(nextState.decisions) };
      render();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      initialized = false;
      view.dispose?.();
    },
    actions,
  });
}
