import { waitForCondition } from './polling.js';

const SERVICE_WORKER_SCRIPT_PATH = 'background/service-worker.js';

export async function createAuraServiceWorkerRestartController(
  context,
  page,
  extensionId,
  { timeoutMs = 10000, pollIntervalMs = 100 } = {},
) {
  if (!context || !page || !extensionId) {
    throw new Error('createAuraServiceWorkerRestartController: context, page, and extensionId are required');
  }

  const scriptUrl = `chrome-extension://${extensionId}/${SERVICE_WORKER_SCRIPT_PATH}`;
  const cdp = await context.newCDPSession(page);
  const versionsById = new Map();
  let sequence = 0;

  const rememberVersions = ({ versions = [] } = {}) => {
    for (const version of versions) {
      if (version?.scriptURL !== scriptUrl || !version.versionId) {
        continue;
      }
      sequence += 1;
      versionsById.set(version.versionId, { ...version, seenSequence: sequence });
    }
  };

  cdp.on('ServiceWorker.workerVersionUpdated', rememberVersions);
  await cdp.send('ServiceWorker.enable');

  const versions = () => Array.from(versionsById.values());
  const waitForVersion = (predicate, label) => waitForCondition(
    () => versions().find(predicate) || null,
    { timeoutMs, intervalMs: pollIntervalMs, label },
  );

  return {
    scriptUrl,
    async stop() {
      const running = await waitForVersion(
        (version) => version.runningStatus === 'running' && typeof version.targetId === 'string',
        `running AURA service worker ${scriptUrl}`,
      );

      await cdp.send('Target.closeTarget', { targetId: running.targetId });

      const stopped = await waitForVersion(
        (version) => version.versionId === running.versionId && version.runningStatus === 'stopped',
        `stopped AURA service worker ${scriptUrl}`,
      );

      return {
        versionId: running.versionId,
        targetId: running.targetId,
        stoppedSequence: stopped.seenSequence,
      };
    },
    async waitForRunningAfter(stoppedSequence) {
      return waitForVersion(
        (version) =>
          version.runningStatus === 'running' &&
          typeof version.targetId === 'string' &&
          version.seenSequence > stoppedSequence,
        `restarted AURA service worker ${scriptUrl}`,
      );
    },
    async dispose() {
      cdp.off('ServiceWorker.workerVersionUpdated', rememberVersions);
      await cdp.detach().catch(() => {});
    },
  };
}
