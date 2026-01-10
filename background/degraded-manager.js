import { MODE_IDS, STATES, THRESHOLDS, STORAGE_KEYS } from '../shared/constants.js';
import { getFromSession, setToSession, extractDomain } from '../shared/utils.js';
import { stateManager } from './state-manager.js';
import { telemetry } from './telemetry.js';
import { getRuntimeState, patchRuntimeState } from './runtime-state.js';

const ONE_MINUTE_MS = 60 * 1000;
const ALLOWED_OPERATIONS = new Set([
  'insertCSS',
  'removeCSS',
  'injectBanner',
  'removeBanner',
  'injectRestore',
  'removeRestore'
]);

class PerformanceMonitor {
  constructor() {
    this.degradedTriggered = false;
  }

  async isDegradedTriggered() {
    const runtimeState = await getRuntimeState();
    const triggered = runtimeState?.degraded?.triggered === true;
    this.degradedTriggered = triggered;
    return triggered;
  }

  async recordOperation(operationType) {
    return this.recordMutation(operationType);
  }

  async getMetrics() {
    const metrics = await getFromSession(STORAGE_KEYS.PERFORMANCE_METRICS);
    return (
      metrics || {
        operations: [],
        latencies: [],
        heapDelta: null
      }
    );
  }

  async saveMetrics(metrics) {
    await setToSession(STORAGE_KEYS.PERFORMANCE_METRICS, metrics);
  }

  async recordMutation(operationType) {
    if (!ALLOWED_OPERATIONS.has(operationType)) {
      console.warn(`[PerformanceMonitor] Ignoring unknown operation type: ${operationType}`);
      return;
    }

    const metrics = await this.getMetrics();
    const now = Date.now();

    metrics.operations.push({
      type: operationType,
      time: now
    });

    metrics.operations = metrics.operations.filter((operation) => operation.time > now - ONE_MINUTE_MS);

    await this.saveMetrics(metrics);
    await this.checkThresholds();
  }

  async measureLatency(asyncOperationFn) {
    const start = performance.now();
    await asyncOperationFn();
    const duration = performance.now() - start;

    await this.recordLatency(duration);

    return duration;
  }

  async recordLatency(duration) {
    const metrics = await this.getMetrics();
    metrics.latencies.push({
      duration,
      time: Date.now()
    });

    while (metrics.latencies.length > 10) {
      metrics.latencies.shift();
    }

    await this.saveMetrics(metrics);
    await this.checkThresholds();
  }

  async measureHeapDelta(asyncOperationFn) {
    if (!performance?.memory) {
      await asyncOperationFn();
      await this.saveHeapDelta(null);
      await this.checkThresholds();
      return null;
    }

    const before = performance.memory.usedJSHeapSize;
    await asyncOperationFn();
    const after = performance.memory.usedJSHeapSize;
    const deltaMB = (after - before) / 1048576;

    await this.saveHeapDelta(deltaMB);

    if (deltaMB > THRESHOLDS.HEAP_WARNING) {
      console.warn(`[PerformanceMonitor] High heap delta: +${deltaMB.toFixed(2)}MB`);
    }

    await this.checkThresholds();

    return deltaMB;
  }

  async saveHeapDelta(delta) {
    const metrics = await this.getMetrics();
    metrics.heapDelta = delta;
    await this.saveMetrics(metrics);
  }

  async getMutationRate() {
    const metrics = await this.getMetrics();
    const cutoff = Date.now() - ONE_MINUTE_MS;
    return metrics.operations.filter((operation) => operation.time > cutoff).length;
  }

  async getAverageLatency() {
    const metrics = await this.getMetrics();
    if (!metrics.latencies.length) {
      return 0;
    }

    const sum = metrics.latencies.reduce((acc, latency) => acc + latency.duration, 0);
    return sum / metrics.latencies.length;
  }

  async getHeapDelta() {
    const metrics = await this.getMetrics();
    return metrics.heapDelta;
  }

  async getAllMetrics() {
    return {
      operationsPerMinute: await this.getMutationRate(),
      averageLatency: await this.getAverageLatency(),
      heapDelta: await this.getHeapDelta()
    };
  }

  async checkThresholds() {
    if (await this.isDegradedTriggered()) {
      return;
    }

    const [operationsPerMinute, averageLatency, heapDelta] = await Promise.all([
      this.getMutationRate(),
      this.getAverageLatency(),
      this.getHeapDelta()
    ]);

    const operationsExceeded = operationsPerMinute > THRESHOLDS.DEGRADED_OPERATIONS;
    const latencyExceeded = averageLatency > THRESHOLDS.DEGRADED_LATENCY;
    const heapWarning = typeof heapDelta === 'number' && heapDelta > THRESHOLDS.HEAP_WARNING;

    if (heapWarning) {
      console.warn('[PerformanceMonitor] Heap delta warning (best-effort only):', heapDelta);
    }

    if (operationsExceeded || latencyExceeded) {
      const degradedMetrics = {
        operationsPerMinute,
        averageLatency,
        heapDelta,
        operationsExceeded,
        latencyExceeded,
      };

      console.warn('[PerformanceMonitor] Degraded thresholds exceeded', degradedMetrics);
      await this.triggerDegraded(degradedMetrics);
    }
  }

  async triggerDegraded(reasonOrMetrics) {
    if (await this.isDegradedTriggered()) {
      return;
    }

    this.degradedTriggered = true;
    await patchRuntimeState({
      degraded: {
        triggered: true,
        at: Date.now(),
        reason: typeof reasonOrMetrics === 'string' ? reasonOrMetrics : 'thresholds',
      }
    });

    const [{ cssApplier }, { decisionHandler }] = await Promise.all([
      import('./css-applier.js'),
      import('./decision-handler.js'),
    ]);

    const comfortTabs = await stateManager.getTabsWithActiveMode(MODE_IDS.COMFORT_VISUAL);
    const focusTabs = await stateManager.getTabsWithActiveMode(MODE_IDS.FOCUS);
    const uniqueTabs = [...new Set([...comfortTabs, ...focusTabs])];

    for (const tabId of uniqueTabs) {
      for (const modeId of [MODE_IDS.COMFORT_VISUAL, MODE_IDS.FOCUS]) {
        const isActive = await stateManager.isModeActive(tabId, modeId);
        if (!isActive) {
          continue;
        }

        try {
          await cssApplier.removeMode(tabId, modeId, undefined, { trackRestore: false });
          await stateManager.updateModeState(tabId, modeId, STATES.DEGRADED);

          const tab = await chrome.tabs.get(tabId);
          const domain = tab?.url ? extractDomain(tab.url) : 'unknown';

          if (typeof decisionHandler.addCooldown === 'function') {
            await decisionHandler.addCooldown(domain, modeId, 'degraded', 30 * 60 * 1000);
          } else {
            console.warn('[PerformanceMonitor] decisionHandler.addCooldown not available');
          }
        } catch (error) {
          console.error('[PerformanceMonitor] Failed to trigger degraded mode:', error);
        }
      }
    }

    await telemetry.trackDegraded(reasonOrMetrics);
    console.log('[PerformanceMonitor] Active modes set to DEGRADED');
  }
}

export const performanceMonitor = new PerformanceMonitor();
export const degradedManager = performanceMonitor;

globalThis.performanceMonitor = performanceMonitor;
