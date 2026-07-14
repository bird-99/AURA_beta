import { STORAGE_KEYS } from '../shared/constants.js';
import { PROFILE_MATCH_TYPES, normalizeSiteProfiles } from '../shared/site-profiles.js';
import {
  extractDomain,
  extractLegacyDomain,
  readLocalValueResult,
  runStorageAreaTransaction,
} from '../shared/utils.js';

const DOMAIN_MAP_KEYS = Object.freeze([
  STORAGE_KEYS.PER_DOMAIN_PREFS,
  STORAGE_KEYS.COOLDOWNS,
  STORAGE_KEYS.LEARNING_WEIGHTS,
  STORAGE_KEYS.SITE_FAILURES_V1,
  STORAGE_KEYS.SITE_OVERRIDES_V1,
]);

const DOMAIN_LIST_KEYS = Object.freeze([
  STORAGE_KEYS.DENYLIST,
  STORAGE_KEYS.ALLOWLIST,
]);

const INSPECTED_KEYS = Object.freeze([
  ...DOMAIN_MAP_KEYS,
  ...DOMAIN_LIST_KEYS,
  STORAGE_KEYS.USER_PREFS,
  STORAGE_KEYS.SITE_PROFILES,
]);

function resolveMigrationKeys(url) {
  const siteKey = extractDomain(url);
  const legacyKey = extractLegacyDomain(url);
  if (!siteKey || siteKey === 'unknown' || !legacyKey || legacyKey === 'unknown' || legacyKey === siteKey) {
    return null;
  }
  return { siteKey, legacyKey };
}

function hasLegacyValue(storageKey, value, legacyKey) {
  if (DOMAIN_MAP_KEYS.includes(storageKey)) {
    return Boolean(value && typeof value === 'object' && value[legacyKey] !== undefined);
  }
  if (DOMAIN_LIST_KEYS.includes(storageKey)) {
    return Array.isArray(value) && value.includes(legacyKey);
  }
  if (storageKey === STORAGE_KEYS.USER_PREFS) {
    return value?.smartScope?.perDomain?.[legacyKey] !== undefined;
  }
  if (storageKey === STORAGE_KEYS.SITE_PROFILES) {
    const profiles = normalizeSiteProfiles(value);
    return profiles.entries.some((entry) => (
      entry.matchType === PROFILE_MATCH_TYPES.DOMAIN && entry.value === legacyKey
    ));
  }
  return false;
}

export async function inspectLegacyDomainMigration(url) {
  const keys = resolveMigrationKeys(url);
  if (!keys) {
    return { ok: true, available: false, siteKey: extractDomain(url), legacyKey: null, fields: [] };
  }

  const reads = await Promise.all(INSPECTED_KEYS.map(async (storageKey) => ({
    storageKey,
    result: await readLocalValueResult(storageKey),
  })));
  const failed = reads.find(({ result }) => result.ok !== true);
  if (failed) {
    return {
      ok: false,
      available: false,
      siteKey: keys.siteKey,
      legacyKey: keys.legacyKey,
      fields: [],
      error: failed.result.error?.message || 'STORAGE_READ_FAILED',
    };
  }

  const fields = reads
    .filter(({ storageKey, result }) => result.status === 'found' && hasLegacyValue(storageKey, result.value, keys.legacyKey))
    .map(({ storageKey }) => storageKey);
  return { ok: true, available: fields.length > 0, ...keys, fields };
}

function migrateDomainMap(raw, legacyKey, siteKey) {
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  if (map[legacyKey] === undefined) return map;
  const legacy = map[legacyKey] && typeof map[legacyKey] === 'object' ? map[legacyKey] : {};
  const current = map[siteKey] && typeof map[siteKey] === 'object' ? map[siteKey] : {};
  map[siteKey] = { ...legacy, ...current };
  return map;
}

function migrateDomainList(raw, legacyKey, siteKey) {
  const list = Array.isArray(raw) ? [...raw] : [];
  if (list.includes(legacyKey) && !list.includes(siteKey)) list.push(siteKey);
  return list;
}

function migrateUserPrefs(raw, legacyKey, siteKey) {
  const prefs = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  const smartScope = prefs.smartScope && typeof prefs.smartScope === 'object' ? { ...prefs.smartScope } : {};
  const perDomain = smartScope.perDomain && typeof smartScope.perDomain === 'object'
    ? { ...smartScope.perDomain }
    : {};
  if (perDomain[legacyKey] !== undefined) {
    perDomain[siteKey] = { ...(perDomain[legacyKey] || {}), ...(perDomain[siteKey] || {}) };
  }
  return { ...prefs, smartScope: { ...smartScope, perDomain } };
}

function migrateSiteProfiles(raw, legacyKey, siteKey) {
  const profiles = normalizeSiteProfiles(raw);
  const entries = [...profiles.entries];
  for (const entry of profiles.entries) {
    if (entry.matchType !== PROFILE_MATCH_TYPES.DOMAIN || entry.value !== legacyKey) continue;
    const exists = entries.some((candidate) => (
      candidate.matchType === PROFILE_MATCH_TYPES.DOMAIN
      && candidate.value === siteKey
      && candidate.modeId === entry.modeId
      && candidate.action === entry.action
    ));
    if (!exists) {
      entries.push({
        ...entry,
        id: `${entry.id || 'legacy'}:migrated:${siteKey}`,
        value: siteKey,
        updatedAt: Date.now(),
      });
    }
  }
  return { ...profiles, entries };
}

/** @param {{ url?: string, confirmed?: boolean }} [options] */
export async function migrateLegacyDomainData({ url, confirmed = false } = {}) {
  if (confirmed !== true) return { ok: false, error: 'USER_CONFIRMATION_REQUIRED' };
  const keys = resolveMigrationKeys(url);
  if (!keys) return { ok: false, error: 'NO_AMBIGUOUS_LEGACY_KEY' };

  return runStorageAreaTransaction('local', async () => {
    const stored = await chrome.storage.local.get([...INSPECTED_KEYS]);
    const write = {};
    for (const storageKey of DOMAIN_MAP_KEYS) {
      write[storageKey] = migrateDomainMap(stored[storageKey], keys.legacyKey, keys.siteKey);
    }
    for (const storageKey of DOMAIN_LIST_KEYS) {
      write[storageKey] = migrateDomainList(stored[storageKey], keys.legacyKey, keys.siteKey);
    }
    write[STORAGE_KEYS.USER_PREFS] = migrateUserPrefs(
      stored[STORAGE_KEYS.USER_PREFS],
      keys.legacyKey,
      keys.siteKey,
    );
    write[STORAGE_KEYS.SITE_PROFILES] = migrateSiteProfiles(
      stored[STORAGE_KEYS.SITE_PROFILES],
      keys.legacyKey,
      keys.siteKey,
    );
    await chrome.storage.local.set(write);
    return { ok: true, ...keys, migrated: true };
  });
}
