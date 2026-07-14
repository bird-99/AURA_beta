/** @typedef {"success"|"error"|"info"} DataStatusKind */

/** @typedef {{ ok: boolean, reason?: string }} DataOperationResult */

/** @typedef {{
 * exportData: () => Promise<DataOperationResult>,
 * requestImport: () => boolean,
 * importFile: (file: { text: () => Promise<string> }) => Promise<DataOperationResult>,
 * showResetConfirmation: () => void,
 * hideResetConfirmation: () => void,
 * confirmReset: () => Promise<DataOperationResult>,
 * }} DataManagementActions
 */

/** @typedef {{
 * bind: (actions: DataManagementActions) => void|(() => void),
 * setBusy: (busy: boolean) => void,
 * openImportPicker: () => void,
 * resetImportInput: () => void,
 * setResetConfirmationVisible: (visible: boolean) => void,
 * reportInline: (kind: DataStatusKind, message: string) => void,
 * reportData: (kind: DataStatusKind, message: string) => void,
 * dispose?: () => void,
 * }} DataManagementView
 */

function requireFunction(name, value) {
  if (typeof value !== 'function') {
    throw new TypeError(`${name} dependency is required`);
  }
}

/**
 * @param {{
 * document?: Document,
 * reportInlineStatus?: (kind: DataStatusKind, message: string) => void,
 * reportSectionStatus?: (sectionId: string, kind: DataStatusKind, message: string) => void,
 * }} [dependencies]
 */
export function createOptionsDataManagementView({
  document,
  reportInlineStatus,
  reportSectionStatus,
} = {}) {
  if (!document || typeof document.getElementById !== 'function') {
    throw new TypeError('document dependency is required');
  }
  requireFunction('reportInlineStatus', reportInlineStatus);
  requireFunction('reportSectionStatus', reportSectionStatus);

  const elements = {
    section: /** @type {HTMLElement|null} */ (document.getElementById('section-data')),
    exportButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('export-data')),
    importButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('import-data')),
    importInput: /** @type {HTMLInputElement|null} */ (document.getElementById('import-file')),
    resetButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('reset-all-data')),
    resetConfirmation: /** @type {HTMLElement|null} */ (document.getElementById('confirm-reset-all')),
    cancelResetButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('cancel-reset-all')),
    confirmResetButton: /** @type {HTMLButtonElement|null} */ (document.getElementById('confirm-reset-all-btn')),
  };
  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`Missing Data & Reset element: ${name}`);
  }

  let unbind = null;

  return Object.freeze({
    bind(actions) {
      if (unbind) return unbind;
      /** @type {Array<[HTMLElement, string, EventListener]>} */
      const listeners = [
        [elements.exportButton, 'click', () => { void actions.exportData(); }],
        [elements.importButton, 'click', () => actions.requestImport()],
        [elements.importInput, 'change', () => {
          const file = elements.importInput.files?.[0];
          if (file) void actions.importFile(file);
        }],
        [elements.resetButton, 'click', () => actions.showResetConfirmation()],
        [elements.cancelResetButton, 'click', () => actions.hideResetConfirmation()],
        [elements.confirmResetButton, 'click', () => { void actions.confirmReset(); }],
      ];
      for (const [element, eventName, listener] of listeners) {
        element.addEventListener(eventName, listener);
      }
      unbind = () => {
        for (const [element, eventName, listener] of listeners) {
          element.removeEventListener(eventName, listener);
        }
        unbind = null;
      };
      return unbind;
    },
    setBusy(busy) {
      /** @type {Array<HTMLInputElement|HTMLButtonElement>} */
      const controls = [
        elements.exportButton,
        elements.importButton,
        elements.importInput,
        elements.resetButton,
        elements.confirmResetButton,
      ];
      for (const control of controls) {
        control.disabled = busy;
      }
      if (busy) elements.section.setAttribute('aria-busy', 'true');
      else elements.section.removeAttribute('aria-busy');
    },
    openImportPicker() {
      elements.importInput.click();
    },
    resetImportInput() {
      elements.importInput.value = '';
    },
    setResetConfirmationVisible(visible) {
      elements.resetConfirmation.hidden = !visible;
    },
    reportInline(kind, message) {
      reportInlineStatus(kind, message);
    },
    reportData(kind, message) {
      reportSectionStatus('data', kind, message);
    },
    dispose() {
      unbind?.();
    },
  });
}

/**
 * @param {{
 * buildExport?: (version: string) => Promise<unknown>,
 * importAndApply?: (payload: unknown) => Promise<{ domains: number, modes: number }>,
 * resetAll?: () => Promise<void>,
 * download?: (payload: unknown, filename: string) => void,
 * getVersion?: () => string,
 * reloadState?: () => Promise<void>,
 * view?: DataManagementView,
 * now?: () => Date|string|number,
 * }} [dependencies]
 */
export function createOptionsDataManagementController({
  buildExport,
  importAndApply,
  resetAll,
  download,
  getVersion,
  reloadState,
  view,
  now = () => new Date(),
} = {}) {
  for (const [name, dependency] of Object.entries({
    buildExport,
    importAndApply,
    resetAll,
    download,
    getVersion,
    reloadState,
    now,
  })) {
    requireFunction(name, dependency);
  }
  if (!view || typeof view.bind !== 'function') {
    throw new TypeError('view dependency is required');
  }

  let operationInFlight = false;
  let initialized = false;

  async function runOperation(label, operation) {
    if (operationInFlight) {
      view.reportData('info', 'Another data operation is already running');
      return { ok: false, reason: 'DATA_OPERATION_IN_PROGRESS' };
    }

    operationInFlight = true;
    view.setBusy(true);
    try {
      await operation();
      return { ok: true };
    } catch (error) {
      const detail = error?.message || String(error);
      view.reportInline('error', `${label} failed: ${detail}`);
      view.reportData('error', `${label} failed`);
      return { ok: false, reason: detail };
    } finally {
      operationInFlight = false;
      view.setBusy(false);
    }
  }

  const actions = Object.freeze({
    exportData() {
      return runOperation('Export', async () => {
        const payload = await buildExport(getVersion());
        const current = now();
        const date = (current instanceof Date ? current : new Date(current)).toISOString().slice(0, 10);
        download(payload, `aura-export-${date}.json`);
        view.reportInline('success', 'Export created');
        view.reportData('success', 'Export created');
      });
    },
    requestImport() {
      if (operationInFlight) {
        view.reportData('info', 'Another data operation is already running');
        return false;
      }
      view.openImportPicker();
      return true;
    },
    async importFile(file) {
      try {
        return await runOperation('Import', async () => {
          const text = await file.text();
          const payload = JSON.parse(text);
          const result = await importAndApply(payload);
          await reloadState();
          view.reportInline('success', `Imported ${result.domains} domains, ${result.modes} modes`);
          view.reportData('success', 'Import complete');
        });
      } finally {
        view.resetImportInput();
      }
    },
    showResetConfirmation() {
      view.setResetConfirmationVisible(true);
    },
    hideResetConfirmation() {
      view.setResetConfirmationVisible(false);
    },
    confirmReset() {
      view.setResetConfirmationVisible(false);
      return runOperation('Reset', async () => {
        await resetAll();
        await reloadState();
        view.reportInline('success', 'All data cleared');
        view.reportData('success', 'All data cleared');
      });
    },
  });

  return Object.freeze({
    initialize() {
      if (initialized) return;
      initialized = true;
      view.bind(actions);
    },
    dispose() {
      if (!initialized) return;
      initialized = false;
      view.dispose?.();
    },
    actions,
  });
}
