import { MODE_IDS } from './constants.js';
import { extractDomain, parseStrictDomainInput } from './utils.js';

export const PROFILE_ACTIONS = Object.freeze({
  ALWAYS: 'always',
  NEVER: 'never',
  ASK: 'ask',
});

export const PROFILE_MATCH_TYPES = Object.freeze({
  DOMAIN: 'domain',
  HOSTNAME: 'hostname',
  PATTERN: 'pattern',
});

const PROFILE_VERSION = 1;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProfileAction(action) {
  if (action === PROFILE_ACTIONS.ALWAYS || action === PROFILE_ACTIONS.NEVER || action === PROFILE_ACTIONS.ASK) {
    return action;
  }
  return null;
}

function normalizeMatchType(matchType) {
  if (
    matchType === PROFILE_MATCH_TYPES.DOMAIN ||
    matchType === PROFILE_MATCH_TYPES.HOSTNAME ||
    matchType === PROFILE_MATCH_TYPES.PATTERN
  ) {
    return matchType;
  }
  return null;
}

function normalizeModeId(modeId) {
  return Object.values(MODE_IDS).includes(modeId) ? modeId : null;
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return null;
}

function normalizeValue(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function normalizeSiteProfileEntry(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  const action = normalizeProfileAction(raw.action);
  const matchType = normalizeMatchType(raw.matchType);
  const modeId = normalizeModeId(raw.modeId);
  const value = normalizeValue(raw.value);

  if (!action || !matchType || !modeId || !value) {
    return null;
  }

  const createdAt = normalizeTimestamp(raw.createdAt);
  const updatedAt = normalizeTimestamp(raw.updatedAt);
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;

  return {
    id,
    action,
    matchType,
    modeId,
    value,
    createdAt,
    updatedAt,
  };
}

export function normalizeSiteProfiles(raw) {
  const base = { version: PROFILE_VERSION, entries: [] };
  if (!isPlainObject(raw)) {
    if (Array.isArray(raw)) {
      return { ...base, entries: raw.map(normalizeSiteProfileEntry).filter(Boolean) };
    }
    return base;
  }

  const entries = Array.isArray(raw.entries)
    ? raw.entries
    : Array.isArray(raw.rules)
      ? raw.rules
      : [];

  return {
    version: PROFILE_VERSION,
    entries: entries.map(normalizeSiteProfileEntry).filter(Boolean),
  };
}

export function parseProfileTarget(input) {
  const trimmed = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!trimmed) {
    return { ok: false, reason: 'Domain or pattern required' };
  }

  if (trimmed.includes('*')) {
    if (!/^\*\.[^*]+$/.test(trimmed)) {
      return { ok: false, reason: 'Invalid domain or pattern' };
    }
    const base = parseStrictDomainInput(trimmed.slice(2));
    if (!base.ok) {
      return { ok: false, reason: 'Invalid domain or pattern' };
    }
    return {
      ok: true,
      matchType: PROFILE_MATCH_TYPES.PATTERN,
      value: `*.${base.hostname}`,
    };
  }

  const parsed = parseStrictDomainInput(trimmed);
  if (!parsed.ok) {
    return { ok: false, reason: 'Invalid domain or pattern' };
  }
  const matchType =
    parsed.hostname === 'localhost' || parsed.hostname === parsed.siteKey
      ? PROFILE_MATCH_TYPES.DOMAIN
      : PROFILE_MATCH_TYPES.HOSTNAME;

  return {
    ok: true,
    matchType,
    value: matchType === PROFILE_MATCH_TYPES.DOMAIN ? parsed.siteKey : parsed.hostname,
  };
}

export function isSafeSiteProfileEntry(entry) {
  const normalized = normalizeSiteProfileEntry(entry);
  if (!normalized) return false;
  const parsed = parseProfileTarget(normalized.value);
  if (!parsed.ok || parsed.value !== normalized.value) return false;
  if (normalized.matchType === PROFILE_MATCH_TYPES.HOSTNAME) {
    return parsed.matchType !== PROFILE_MATCH_TYPES.PATTERN;
  }
  return parsed.matchType === normalized.matchType;
}

function buildWildcardRegex(pattern) {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function getHostnameAndSiteKey(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return { hostname: null, siteKey: null };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  let hostname = '';

  try {
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch (error) {
    hostname = '';
  }

  if (!hostname) {
    return { hostname: null, siteKey: null };
  }

  const siteKey = extractDomain(hostname);
  return {
    hostname,
    siteKey: siteKey && siteKey !== 'unknown' ? siteKey.toLowerCase() : null,
  };
}

function matchEntry(entry, hostname, siteKey) {
  if (!entry || !hostname || !isSafeSiteProfileEntry(entry)) {
    return false;
  }

  if (entry.matchType === PROFILE_MATCH_TYPES.HOSTNAME) {
    return entry.value === hostname;
  }

  if (entry.matchType === PROFILE_MATCH_TYPES.DOMAIN) {
    return Boolean(siteKey && entry.value === siteKey);
  }

  if (entry.matchType === PROFILE_MATCH_TYPES.PATTERN) {
    const regex = buildWildcardRegex(entry.value);
    return regex.test(hostname);
  }

  return false;
}

function scoreEntry(entry) {
  if (entry.matchType === PROFILE_MATCH_TYPES.HOSTNAME) {
    return 30 + entry.value.length;
  }
  if (entry.matchType === PROFILE_MATCH_TYPES.PATTERN) {
    return 20 + entry.value.length;
  }
  return 10 + entry.value.length;
}

export function resolveSiteProfileForUrl({ url, modeId, profiles }) {
  const normalizedModeId = normalizeModeId(modeId);
  if (!normalizedModeId) {
    return null;
  }

  const normalizedProfiles = normalizeSiteProfiles(profiles);
  if (!normalizedProfiles.entries.length) {
    return null;
  }

  const { hostname, siteKey } = getHostnameAndSiteKey(url);
  if (!hostname) {
    return null;
  }

  let best = null;
  let bestScore = -1;

  for (const entry of normalizedProfiles.entries) {
    if (!entry || entry.modeId !== normalizedModeId) {
      continue;
    }

    if (!matchEntry(entry, hostname, siteKey)) {
      continue;
    }

    const entryScore = scoreEntry(entry);
    if (entryScore > bestScore) {
      best = entry;
      bestScore = entryScore;
    } else if (entryScore === bestScore && entry.updatedAt && best?.updatedAt) {
      if (entry.updatedAt > best.updatedAt) {
        best = entry;
      }
    }
  }

  return best;
}

export function resolveSiteProfileForHost({ hostname, modeId, profiles }) {
  const normalizedProfiles = normalizeSiteProfiles(profiles);
  if (!normalizedProfiles.entries.length) {
    return null;
  }

  const normalizedModeId = normalizeModeId(modeId);
  if (!normalizedModeId) {
    return null;
  }

  const normalizedHost = normalizeValue(hostname);
  if (!normalizedHost) {
    return null;
  }

  const siteKey = extractDomain(normalizedHost);
  let best = null;
  let bestScore = -1;

  for (const entry of normalizedProfiles.entries) {
    if (!entry || entry.modeId !== normalizedModeId) {
      continue;
    }
    if (!matchEntry(entry, normalizedHost, siteKey)) {
      continue;
    }
    const entryScore = scoreEntry(entry);
    if (entryScore > bestScore) {
      best = entry;
      bestScore = entryScore;
    }
  }

  return best;
}
