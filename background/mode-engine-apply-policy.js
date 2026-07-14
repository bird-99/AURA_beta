import { SITE_BLOCK_REASONS, STORAGE_KEYS } from '../shared/constants.js';
import { extractDomain, readLocalValueResult } from '../shared/utils.js';
import { PROFILE_ACTIONS, resolveSiteProfileForUrl } from '../shared/site-profiles.js';
import { recordModeEngineMetric } from '../shared/mode-engine-debug.js';
import { computeSitePolicy, isStructuralFailureReason } from './site-policy-manager.js';
import { makeUrlKey } from './scope-cache.js';
import { readSiteProfilesResult } from './site-profile-store.js';

const SITE_POLICY_STORAGE_UNAVAILABLE = 'SITE_POLICY_STORAGE_UNAVAILABLE';

export async function resolveUrlKey(tabId, fallbackUrl = '') {
  const fromFallback = makeUrlKey(fallbackUrl);
  if (fromFallback) {
    return fromFallback;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return makeUrlKey(tab?.url || '');
  } catch (error) {
    return '';
  }
}

export async function resolveSitePolicy(tabId, modeId) {
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return {
      policy: {
        allowed: false,
        reason: 'TAB_LOOKUP_FAILED',
        blockedUntil: null,
        overrideUntil: null,
        host: null,
      },
      url: null,
    };
  }

  const url = tab?.url || null;
  if (!url) {
    return {
      policy: {
        allowed: false,
        reason: 'TAB_URL_MISSING',
        blockedUntil: null,
        overrideUntil: null,
        host: null,
      },
      url: null,
    };
  }

  const [profileRead, denylistRead] = await Promise.all([
    readSiteProfilesResult(),
    readLocalValueResult(STORAGE_KEYS.DENYLIST),
  ]);
  if (
    !profileRead.ok
    || !denylistRead.ok
    || (denylistRead.status === 'found' && !Array.isArray(denylistRead.value))
  ) {
    return {
      policy: {
        allowed: false,
        reason: SITE_POLICY_STORAGE_UNAVAILABLE,
        blockedUntil: null,
        overrideUntil: null,
        host: extractDomain(url),
      },
      url,
    };
  }

  const siteKey = extractDomain(url);
  const profileEntry = resolveSiteProfileForUrl({
    url,
    modeId,
    profiles: profileRead.profiles,
  });

  const denylisted = denylistRead.status === 'found' && denylistRead.value.includes(siteKey);
  if (profileEntry?.action === PROFILE_ACTIONS.NEVER || denylisted) {
    return {
      policy: {
        allowed: false,
        reason: SITE_BLOCK_REASONS.USER_DISABLED_FOR_HOST,
        blockedUntil: null,
        overrideUntil: null,
        host: siteKey,
      },
      url,
    };
  }

  const policy = await computeSitePolicy({ url, now: Date.now() });
  return { policy, url };
}

export function buildSiteBlockedResult(policy) {
  return {
    ok: false,
    error: 'SITE_BLOCKED',
    detail: policy?.reason || 'POLICY_BLOCKED',
    blockedUntil: policy?.blockedUntil ?? null,
  };
}

export function recordV2Metric(name, value, tags = {}) {
  recordModeEngineMetric(`modeengine.v2.${name}`, value, tags);
}

export function formatDetail(value, fallback = '') {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

export function classifyApplyFailureForPolicy(result) {
  if (!result || result.ok !== false) {
    return null;
  }

  const reason = typeof result.reason === 'string' ? result.reason : null;
  const error = typeof result.error === 'string' ? result.error : null;
  const candidate = reason || error || null;

  if (!candidate) {
    return null;
  }

  return isStructuralFailureReason(candidate) ? candidate : null;
}

export async function getSiteKey(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url ? extractDomain(tab.url) : 'unknown';
  } catch (error) {
    console.warn('[ModeEngineApplyPolicy] Failed to extract siteKey', error);
    return 'unknown';
  }
}
