import { MODE_IDS } from '../shared/constants.js';

const SUPPORTED_MODE_IDS = new Set(Object.values(MODE_IDS));

function addTarget(targets, tabId, modeId) {
  const parsedTabId = typeof tabId === 'number' ? tabId : Number.parseInt(tabId, 10);
  if (!Number.isInteger(parsedTabId) || parsedTabId < 0 || !SUPPORTED_MODE_IDS.has(modeId)) {
    return;
  }
  targets.set(`${parsedTabId}:${modeId}`, { tabId: parsedTabId, modeId });
}

export function collectResetAllDataTargets(tabState, journal) {
  const targets = new Map();
  const safeTabState = tabState && typeof tabState === 'object' && !Array.isArray(tabState)
    ? tabState
    : {};

  for (const [tabId, modes] of Object.entries(safeTabState)) {
    if (!modes || typeof modes !== 'object' || Array.isArray(modes)) continue;
    for (const modeId of Object.keys(modes)) {
      addTarget(targets, tabId, modeId);
    }
  }

  const journalTabs = journal?.tabs && typeof journal.tabs === 'object' && !Array.isArray(journal.tabs)
    ? journal.tabs
    : {};
  for (const [tabId, slot] of Object.entries(journalTabs)) {
    addTarget(targets, tabId, slot?.running?.modeId);
    addTarget(targets, tabId, slot?.desired?.modeId);
  }

  return Array.from(targets.values()).sort((left, right) => (
    left.tabId - right.tabId || left.modeId.localeCompare(right.modeId)
  ));
}

function storageReadFailure(read, fallback) {
  return read?.error?.message || read?.reason || fallback;
}

export function createResetAllDataManager({
  readTabState,
  readLifecycleJournal,
  runGlobalOperation,
  removeTarget,
  clearStorage,
} = {}) {
  for (const [name, dependency] of Object.entries({
    readTabState,
    readLifecycleJournal,
    runGlobalOperation,
    removeTarget,
    clearStorage,
  })) {
    if (typeof dependency !== 'function') {
      throw new TypeError(`${name} dependency is required`);
    }
  }

  return Object.freeze({
    reset() {
      return runGlobalOperation('reset-all-data', async ({ runTabOperation }) => {
        const [tabStateRead, journalRead] = await Promise.all([
          readTabState(),
          readLifecycleJournal(),
        ]);

        if (!tabStateRead?.ok) {
          return {
            ok: false,
            reason: 'RESET_TAB_STATE_UNAVAILABLE',
            error: storageReadFailure(tabStateRead, 'TAB_STATE_STORAGE_UNAVAILABLE'),
          };
        }
        if (!journalRead?.ok) {
          return {
            ok: false,
            reason: 'RESET_LIFECYCLE_UNAVAILABLE',
            error: storageReadFailure(journalRead, 'LIFECYCLE_STORAGE_UNAVAILABLE'),
          };
        }

        const tabState = tabStateRead.status === 'found' ? tabStateRead.value : {};
        const targets = collectResetAllDataTargets(tabState, journalRead.journal);
        const results = await Promise.all(targets.map((target) => (
          runTabOperation(
            target.tabId,
            `reset-all-data:${target.modeId}`,
            () => removeTarget(target),
          ).then(
            (result) => ({ target, result }),
            (error) => ({
              target,
              result: {
                ok: false,
                reason: error?.code || error?.message || 'RESET_TARGET_REMOVE_FAILED',
              },
            }),
          )
        )));
        const failures = results
          .filter(({ result }) => result?.ok !== true)
          .map(({ target, result }) => ({
            ...target,
            reason: result?.reason || result?.error || 'RESET_TARGET_REMOVE_FAILED',
            retryable: result?.retryable === true,
          }));

        if (failures.length > 0) {
          return {
            ok: false,
            reason: 'RESET_CLEANUP_FAILED',
            cleanedTargets: targets.length - failures.length,
            failures,
          };
        }

        try {
          await clearStorage();
        } catch (error) {
          return {
            ok: false,
            reason: 'RESET_STORAGE_CLEAR_FAILED',
            error: error?.message || String(error),
            cleanedTargets: targets.length,
          };
        }

        return { ok: true, cleanedTargets: targets.length };
      });
    },
  });
}
