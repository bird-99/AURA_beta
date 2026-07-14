import { STORAGE_KEYS } from '../shared/constants.js';
import { normalizeSiteProfileEntry, normalizeSiteProfiles } from '../shared/site-profiles.js';
import { readLocalValueResult } from '../shared/utils.js';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getRawEntries(value) {
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value)) return null;
  if (Object.prototype.hasOwnProperty.call(value, 'entries')) {
    return Array.isArray(value.entries) ? value.entries : null;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'rules')) {
    return Array.isArray(value.rules) ? value.rules : null;
  }
  return [];
}

export function validateStoredSiteProfiles(value) {
  const entries = getRawEntries(value);
  return Array.isArray(entries) && entries.every((entry) => normalizeSiteProfileEntry(entry) !== null);
}

export async function readSiteProfilesResult() {
  const read = await readLocalValueResult(STORAGE_KEYS.SITE_PROFILES);
  if (!read.ok) {
    return {
      ok: false,
      status: 'error',
      profiles: null,
      error: read.error?.message || 'SITE_PROFILES_UNAVAILABLE',
    };
  }
  if (read.status === 'missing') {
    return {
      ok: true,
      status: 'missing',
      profiles: normalizeSiteProfiles({}),
      error: null,
    };
  }
  if (!validateStoredSiteProfiles(read.value)) {
    return {
      ok: false,
      status: 'error',
      profiles: null,
      error: 'INVALID_SITE_PROFILES',
    };
  }
  return {
    ok: true,
    status: 'found',
    profiles: normalizeSiteProfiles(read.value),
    error: null,
  };
}
