import { STORAGE_KEYS } from '../shared/constants.js';
import { getFromLocal } from '../shared/utils.js';

/**
 * @typedef {'ENABLED' | 'NOT_NOW' | 'NEVER'} TelemetryDecision
 */

// Track Product only: to be wired to build/flag when available
// Default is false to avoid telemetry in dissertation builds until a product flag exists.
const TRACK_PRODUCT_ENABLED = false; // TODO: replace with real Track Product flag

export class Telemetry {
  constructor() {
    this.enabled = false;
    this.endpoint = 'https://telemetry.example.com/events';
  }

  /**
   * Initialise telemetry based on user preference (opt-in).
   * @returns {Promise<void>}
   */
  async init() {
    const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
    this.enabled = TRACK_PRODUCT_ENABLED && prefs.telemetryEnabled === true;

    if (this.enabled) {
      console.log('[Telemetry] Telemetry enabled (opt-in)');
    } else {
      console.log('[Telemetry] Telemetry disabled (Track Dissertation)');
    }
  }

  /**
   * Send a telemetry event with minimal payload.
   * @param {string} eventType
   * @param {Record<string, unknown>} payload
   * @returns {Promise<void>}
   */
  async sendEvent(eventType, payload) {
    if (!this.enabled || !TRACK_PRODUCT_ENABLED) {
      return;
    }

    const event = {
      type: eventType,
      timestamp: Date.now(),
      payload,
    };

    try {
      // Placeholder for future backend wiring
      // await fetch(this.endpoint, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(event),
      // });

      console.log('[Telemetry] Event:', event);
    } catch (error) {
      console.error('[Telemetry] Failed to send event:', error);
    }
  }

  /**
   * Track suggestion banner shown to the user.
   * @param {string} domain
   * @param {string} modeId
   * @param {number} score
   * @returns {Promise<void>}
   */
  async trackSuggestionShown(domain, modeId, score) {
    await this.sendEvent('suggestion_shown', { domain, modeId, score });
  }

  /**
   * Track user decision on a suggestion.
   * @param {string} modeId
   * @param {string} domain
   * @param {TelemetryDecision} decision
   * @returns {Promise<void>}
   */
  async trackDecision(modeId, domain, decision) {
    await this.sendEvent('user_decision', { modeId, domain, decision });
  }

  /**
   * Track mode application (manual or auto).
   * @param {string} modeId
   * @param {string} domain
   * @param {boolean} manual
   * @returns {Promise<void>}
   */
  async trackModeApplied(modeId, domain, manual) {
    await this.sendEvent('mode_applied', { modeId, domain, manual });
  }

  /**
   * Track mode restoration.
   * @param {string} modeId
   * @param {string} domain
   * @returns {Promise<void>}
   */
  async trackModeRestored(modeId, domain) {
    await this.sendEvent('mode_restored', { modeId, domain });
  }

  /**
   * Track degraded mode activation.
   * @param {unknown} reasonOrMetrics
   * @returns {Promise<void>}
   */
  async trackDegraded(reasonOrMetrics) {
    await this.sendEvent('degraded_mode', { reason: reasonOrMetrics });
  }

  /**
   * Track non-fatal errors with minimal context.
   * @param {string} code
   * @param {Record<string, unknown>} context
   * @returns {Promise<void>}
   */
  async trackError(code, context) {
    await this.sendEvent('error', { code, context });
  }
}

export const telemetry = new Telemetry();
