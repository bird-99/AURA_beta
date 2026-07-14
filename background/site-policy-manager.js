import { SITE_BLOCK_REASONS, STORAGE_KEYS } from '../shared/constants.js';
import { isFlagEnabled } from '../shared/feature-flags.js';
import {
  extractDomain,
  getDomainKeyCandidates,
  getFromLocal,
  mutateLocalValue,
  readLocalValueResult,
} from '../shared/utils.js';

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
  'moz-extension:',
  'file:'
]);

export function getSiteKeyFromUrl(url) {
  if (typeof url !== 'string') {
    return null;
  }

  const siteKey = extractDomain(url);
  if (!siteKey || siteKey === 'unknown') {
    return null;
  }

  return siteKey;
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

function buildInternalErrorPolicy(host = null, detail = null) {
  return {
    allowed: false,
    reason: 'INTERNAL_ERROR',
    host,
    blockedUntil: null,
    overrideUntil: null,
    ...(detail ? { detail } : {}),
  };
}

export async function computeSitePolicy({ url, now = Date.now() } = {}) {
  try {
    if (isUnsupportedScheme(url)) {
      const host = getSiteKeyFromUrl(url);
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
        host: getSiteKeyFromUrl(url),
        blockedUntil: null,
        overrideUntil: null
      };
    }

    const siteKey = getSiteKeyFromUrl(url);
    if (!siteKey) {
      return buildInternalErrorPolicy();
    }

    const [failureRead, overrideRead] = await Promise.all([
      readLocalValueResult(STORAGE_KEYS.SITE_FAILURES_V1),
      readLocalValueResult(STORAGE_KEYS.SITE_OVERRIDES_V1)
    ]);
    if (!failureRead.ok || !overrideRead.ok) {
      return buildInternalErrorPolicy(siteKey, 'STORAGE_UNAVAILABLE');
    }
    const failures = failureRead.status === 'found' ? failureRead.value : {};
    const overrides = overrideRead.status === 'found' ? overrideRead.value : {};
    if (
      !failures || typeof failures !== 'object' || Array.isArray(failures)
      || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)
    ) {
      return buildInternalErrorPolicy(siteKey, 'INVALID_STORAGE_VALUE');
    }

    const overrideKey = getDomainKeyCandidates(siteKey).find((key) => overrides?.[key]);
    const overrideEntry = overrideKey ? overrides[overrideKey] : null;
    if (overrideEntry?.overrideUntil && overrideEntry.overrideUntil > now) {
      return {
        allowed: true,
        reason: SITE_BLOCK_REASONS.OVERRIDE_ACTIVE,
        host: siteKey,
        blockedUntil: null,
        overrideUntil: overrideEntry.overrideUntil
      };
    }

    const failureKey = getDomainKeyCandidates(siteKey).find((key) => failures?.[key]);
    const failureEntry = failureKey ? failures[failureKey] : null;
    if (failureEntry?.blockedUntil && failureEntry.blockedUntil > now) {
      return {
        allowed: false,
        reason: SITE_BLOCK_REASONS.REPEATED_APPLY_FAILURE,
        host: siteKey,
        blockedUntil: failureEntry.blockedUntil,
        overrideUntil: null
      };
    }

    return {
      allowed: true,
      reason: null,
      host: siteKey,
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
    const siteKey = getSiteKeyFromUrl(url);
    if (!siteKey) {
      return null;
    }

    if (!ok && !SUPPORTED_FAIL_REASONS.has(failReason)) {
      return { host: siteKey, ignored: true };
    }
    let outcome = null;
    await mutateLocalValue(STORAGE_KEYS.SITE_FAILURES_V1, (storedFailures) => {
      const failures = storedFailures && typeof storedFailures === 'object' ? { ...storedFailures } : {};
      if (ok) {
        delete failures[siteKey];
        outcome = { host: siteKey, reset: true };
        return failures;
      }

      const now = Date.now();
      const entry = { ...(failures[siteKey] || {
        failCount: 0,
        windowStartAt: now,
        lastFailAt: now,
        lastFailReason: failReason,
        blockedUntil: null,
      }) };
      if (now - entry.windowStartAt > WINDOW_MS) {
        entry.failCount = 0;
        entry.windowStartAt = now;
        entry.blockedUntil = null;
      }
      entry.failCount += 1;
      entry.lastFailAt = now;
      entry.lastFailReason = failReason;
      if (entry.failCount >= FAIL_THRESHOLD) entry.blockedUntil = now + BLOCK_MS;
      failures[siteKey] = entry;
      outcome = { host: siteKey, failCount: entry.failCount, blockedUntil: entry.blockedUntil };
      return failures;
    });
    return outcome;
  } catch (error) {
    console.warn('[SitePolicy] recordApplyOutcome failed', error);
    return null;
  }
}

export function isStructuralFailureReason(reason) {
  return SUPPORTED_FAIL_REASONS.has(reason);
}

export async function setSiteOverride({ siteKey, overrideUntil } = {}) {
  try {
    if (!siteKey) {
      return false;
    }

    await mutateLocalValue(STORAGE_KEYS.SITE_OVERRIDES_V1, (storedOverrides) => {
      const overrides = storedOverrides && typeof storedOverrides === 'object' ? { ...storedOverrides } : {};
      if (!overrideUntil || typeof overrideUntil !== 'number') {
        delete overrides[siteKey];
      } else {
        overrides[siteKey] = { overrideUntil };
      }
      return overrides;
    });
    return true;
  } catch (error) {
    console.warn('[SitePolicy] setSiteOverride failed', error);
    return false;
  }
}

export async function gcSitePolicyStorage({ now = Date.now() } = {}) {
  try {
    let removedFailures = 0;
    let removedOverrides = 0;
    await mutateLocalValue(STORAGE_KEYS.SITE_FAILURES_V1, (storedFailures) => {
      const failureEntries = storedFailures && typeof storedFailures === 'object' ? { ...storedFailures } : {};
      for (const [host, entry] of Object.entries(failureEntries)) {
        if (!entry) continue;
        const lastFailAt = entry.lastFailAt || 0;
        const blockedUntil = entry.blockedUntil || 0;
        if (lastFailAt < now - GC_MAX_AGE_MS && blockedUntil <= now) {
          delete failureEntries[host];
          removedFailures += 1;
        }
      }
      return failureEntries;
    });
    await mutateLocalValue(STORAGE_KEYS.SITE_OVERRIDES_V1, (storedOverrides) => {
      const overrideEntries = storedOverrides && typeof storedOverrides === 'object' ? { ...storedOverrides } : {};
      for (const [host, entry] of Object.entries(overrideEntries)) {
        if (entry && entry.overrideUntil <= now) {
          delete overrideEntries[host];
          removedOverrides += 1;
        }
      }
      return overrideEntries;
    });

    return { removedFailures, removedOverrides };
  } catch (error) {
    console.warn('[SitePolicy] gcSitePolicyStorage failed', error);
    return { removedFailures: 0, removedOverrides: 0 };
  }
}
