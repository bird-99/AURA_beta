import { SMARTSCOPE_LEVELS, STORAGE_KEYS } from '../shared/constants.js';
import { getDomainKeyCandidates, getFromLocal } from '../shared/utils.js';
import { normalizeIntensity } from './mode-css-builders.js';

export function normalizeSmartScopeLevel(level) {
  if (Object.values(SMARTSCOPE_LEVELS).includes(level)) {
    return level;
  }
  return SMARTSCOPE_LEVELS.CONSERVATIVE;
}

export async function getSmartScopeConfig(siteKey) {
  const prefs = (await getFromLocal(STORAGE_KEYS.USER_PREFS)) || {};
  const raw = prefs.smartScope || {};

  const baseEnabled = raw.enabled !== false;
  const baseLevel = normalizeSmartScopeLevel(raw.level);
  const perDomain = raw.perDomain && typeof raw.perDomain === 'object' ? raw.perDomain : {};
  const domainKey = getDomainKeyCandidates(siteKey).find((key) => perDomain[key]);
  const domainCfg = domainKey ? perDomain[domainKey] : null;

  if (domainCfg) {
    const enabled = domainCfg.enabled !== false;
    const level = normalizeSmartScopeLevel(domainCfg.level || baseLevel);
    return { enabled, level, source: 'domain', debugEnabled: raw.debugEnabled === true };
  }

  return { enabled: baseEnabled, level: baseLevel, source: 'global', debugEnabled: raw.debugEnabled === true };
}

export async function getIntensityForSite(siteKey, modeId, fallbackIntensity) {
  const perDomainPrefs = (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  const domainKey = getDomainKeyCandidates(siteKey).find((key) => perDomainPrefs?.[key]);
  const sitePref = domainKey ? perDomainPrefs[domainKey]?.[modeId]?.intensity : undefined;

  if (typeof fallbackIntensity === 'number') {
    return normalizeIntensity(fallbackIntensity);
  }

  if (typeof sitePref === 'number') {
    return normalizeIntensity(sitePref);
  }

  return 1.0;
}

export async function getPerDomainModePrefs(siteKey, modeId) {
  if (!siteKey || !modeId) {
    return null;
  }

  const perDomainPrefs = (await getFromLocal(STORAGE_KEYS.PER_DOMAIN_PREFS)) || {};
  const domainKey = getDomainKeyCandidates(siteKey).find((key) => perDomainPrefs?.[key]);
  const sitePref = domainKey ? perDomainPrefs[domainKey]?.[modeId] : null;
  if (!sitePref || typeof sitePref !== 'object') {
    return null;
  }

  return sitePref;
}
