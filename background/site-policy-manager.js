import { SITE_BLOCK_REASONS, STORAGE_KEYS } from '../shared/constants.js';
import { isFlagEnabled } from '../shared/feature-flags.js';
import { getFromLocal, setToLocal } from '../shared/utils.js';

export const WINDOW_MS = 30 * 60 * 1000;
export const FAIL_THRESHOLD = 3;
export const BLOCK_MS = 24 * 60 * 60 * 1000;

const GC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORTED_FAIL_REASONS = new Set([
  'SCOPE_REJECTED',
  'NO_RECEIVER',
  'INTERNAL_ERROR',
  'SALVAGE_CRASH'
]);
const UNSUPPORTED_SCHEMES = new Set([
  'chrome:',
  'edge:',
  'about:',
  'chrome-extension:',
  'file:'
]);

export function getHostFromUrl(url) {
  if (typeof url !== 'string') {
    return null;
  }

  try {
    return new URL(url).host || null;
  } catch (error) {
    return null;
  }
}

export function isUnsupportedScheme(url) {
  if (typeof url !== 'string') {
    return true;
  }

  try {
    const { protocol } = new URL(url);
    return UNSUPPORTED_SCHEMES.has(protocol);
  } catch (error) {
    return true;
  }
}

function buildInternalErrorPolicy() {
  return {
    allowed: false,
    reason: 'INTERNAL_ERROR',
    host: null,
    blockedUntil: null,
    overrideUntil: null
  };
}

export async function computeSitePolicy({ url, now = Date.now() } = {}) {
  try {
    if (isUnsupportedScheme(url)) {
      const host = getHostFromUrl(url);
      return {
        allowed: false,
        reason: SITE_BLOCK_REASONS.UNSUPPORTED_SCHEME,
        host,
        blockedUntil: null,
        overrideUntil: null
      };
    }

    if (!isFlagEnabled('siteSuppressV1')) {
      return {
        allowed: true,
        reason: null,
        host: getHostFromUrl(url),
        blockedUntil: null,
        overrideUntil: null
      };
    }

    const host = getHostFromUrl(url);
    if (!host) {
      return buildInternalErrorPolicy();
    }

    const [failures, overrides] = await Promise.all([
      getFromLocal(STORAGE_KEYS.SITE_FAILURES_V1),
      getFromLocal(STORAGE_KEYS.SITE_OVERRIDES_V1)
    ]);

    const overrideEntry = overrides?.[host];
    if (overrideEntry?.overrideUntil && overrideEntry.overrideUntil > now) {
      return {
        allowed: true,
        reason: SITE_BLOCK_REASONS.OVERRIDE_ACTIVE,
        host,
        blockedUntil: null,
        overrideUntil: overrideEntry.overrideUntil
      };
    }

    const failureEntry = failures?.[host];
    if (failureEntry?.blockedUntil && failureEntry.blockedUntil > now) {
      return {
        allowed: false,
        reason: SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE,
        host,
        blockedUntil: failureEntry.blockedUntil,
        overrideUntil: null
      };
    }

    return {
      allowed: true,
      reason: null,
      host,
      blockedUntil: null,
      overrideUntil: null
    };
  } catch (error) {
    console.warn('[SitePolicy] computeSitePolicy failed', error);
    return buildInternalErrorPolicy();
  }
}

export async function recordApplyOutcome({ url, ok, failReason } = {}) {
  try {
    const host = getHostFromUrl(url);
    if (!host) {
      return null;
    }

    const failures = (await getFromLocal(STORAGE_KEYS.SITE_FAILURES_V1)) || {};

    if (ok) {
      if (failures[host]) {
        delete failures[host];
        await setToLocal(STORAGE_KEYS.SITE_FAILURES_V1, failures);
      }
      return { host, reset: true };
    }

    if (!SUPPORTED_FAIL_REASONS.has(failReason)) {
      return { host, ignored: true };
    }

    const now = Date.now();
    const entry = failures[host] || {
      failCount: 0,
      windowStartAt: now,
      lastFailAt: now,
      lastFailReason: failReason,
      blockedUntil: null
    };

    if (now - entry.windowStartAt > WINDOW_MS) {
      entry.failCount = 0;
      entry.windowStartAt = now;
      entry.blockedUntil = null;
    }

    entry.failCount += 1;
    entry.lastFailAt = now;
    entry.lastFailReason = failReason;

    if (entry.failCount >= FAIL_THRESHOLD) {
      entry.blockedUntil = now + BLOCK_MS;
    }

    failures[host] = entry;
    await setToLocal(STORAGE_KEYS.SITE_FAILURES_V1, failures);

    return {
      host,
      failCount: entry.failCount,
      blockedUntil: entry.blockedUntil
    };
  } catch (error) {
    console.warn('[SitePolicy] recordApplyOutcome failed', error);
    return null;
  }
}

export function isStructuralFailureReason(reason) {
  return SUPPORTED_FAIL_REASONS.has(reason);
}

export async function setHostOverride({ host, overrideUntil } = {}) {
  try {
    if (!host) {
      return false;
    }

    const overrides = (await getFromLocal(STORAGE_KEYS.SITE_OVERRIDES_V1)) || {};

    if (!overrideUntil || typeof overrideUntil !== 'number') {
      if (overrides[host]) {
        delete overrides[host];
        await setToLocal(STORAGE_KEYS.SITE_OVERRIDES_V1, overrides);
      }
      return true;
    }

    overrides[host] = { overrideUntil };
    await setToLocal(STORAGE_KEYS.SITE_OVERRIDES_V1, overrides);
    return true;
  } catch (error) {
    console.warn('[SitePolicy] setHostOverride failed', error);
    return false;
  }
}

export async function gcSitePolicyStorage({ now = Date.now() } = {}) {
  try {
    const [failures, overrides] = await Promise.all([
      getFromLocal(STORAGE_KEYS.SITE_FAILURES_V1),
      getFromLocal(STORAGE_KEYS.SITE_OVERRIDES_V1)
    ]);

    const failureEntries = failures || {};
    const overrideEntries = overrides || {};
    const failureKeys = Object.keys(failureEntries);
    const overrideKeys = Object.keys(overrideEntries);

    if (!failureKeys.length && !overrideKeys.length) {
      return { removedFailures: 0, removedOverrides: 0 };
    }

    let removedFailures = 0;
    let removedOverrides = 0;

    for (const host of failureKeys) {
      const entry = failureEntries[host];
      if (!entry) continue;
      const lastFailAt = entry.lastFailAt || 0;
      const blockedUntil = entry.blockedUntil || 0;
      const isExpired = lastFailAt < now - GC_MAX_AGE_MS && blockedUntil <= now;
      if (isExpired) {
        delete failureEntries[host];
        removedFailures += 1;
      }
    }

    for (const host of overrideKeys) {
      const entry = overrideEntries[host];
      if (!entry) continue;
      if (entry.overrideUntil <= now) {
        delete overrideEntries[host];
        removedOverrides += 1;
      }
    }

    if (removedFailures > 0) {
      await setToLocal(STORAGE_KEYS.SITE_FAILURES_V1, failureEntries);
    }

    if (removedOverrides > 0) {
      await setToLocal(STORAGE_KEYS.SITE_OVERRIDES_V1, overrideEntries);
    }

    return { removedFailures, removedOverrides };
  } catch (error) {
    console.warn('[SitePolicy] gcSitePolicyStorage failed', error);
    return { removedFailures: 0, removedOverrides: 0 };
  }
}
