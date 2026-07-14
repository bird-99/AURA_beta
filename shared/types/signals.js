// shared/types/signals.js

/**
 * Signal types emitted by content scripts and consumed by the service worker.
 * @typedef {'colorScheme' | 'viewportScale' | 'viewportScroll' | 'readingBehavior' | 'zoom'} SignalType
 */

/**
 * Signal sources for audit/debugging.
 * @typedef {'matchMedia' | 'visualViewport' | 'readingBehavior' | 'content-script' | 'service-worker' | 'unknown'} SignalSource
 */

/**
 * Additional metadata associated with a signal.
 * @typedef {Object} SignalContext
 * @property {string} [pageHost]
 * @property {number} [frameId]
 * @property {number} [viewportWidth]
 * @property {number} [viewportHeight]
 */

/**
 * Signal payload value.
 * @typedef {string | number | boolean | { [key: string]: unknown }} SignalValue
 */

/**
 * Normalized signal event contract.
 * @typedef {Object} SignalEvent
 * @property {SignalType} type
 * @property {SignalValue} value
 * @property {number} confidence
 * @property {number} ts
 * @property {SignalSource} source
 * @property {SignalContext} context
 */

export const SIGNAL_TYPES = {
  THEME_PREF: 'colorScheme',
  VIEWPORT_SCALE: 'viewportScale',
  VIEWPORT_SCROLL: 'viewportScroll',
  READING_BEHAVIOR: 'readingBehavior',
  ZOOM: 'zoom'
};

export const SIGNAL_SOURCES = {
  MATCH_MEDIA: 'matchMedia',
  VISUAL_VIEWPORT: 'visualViewport',
  READING_BEHAVIOR: 'readingBehavior',
  CONTENT_SCRIPT: 'content-script',
  SERVICE_WORKER: 'service-worker',
  UNKNOWN: 'unknown'
};
