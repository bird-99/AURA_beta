import {
  DECISION_ALIASES,
  DECISIONS,
  MODE_IDS,
  MODES,
  MODE_PREF_KEYS,
  STORAGE_KEYS,
  LEARNING_STAGES,
  SMARTSCOPE_LEVELS
} from './constants.js';
import { normalizeSiteProfileEntry, normalizeSiteProfiles } from './site-profiles.js';
import { extractDomain, runStorageAreaTransaction } from './utils.js';
import { COMFORT_VISUAL_DEFAULTS } from './comfort-visual-prefs.js';

export const DATA_PORTABILITY_SCHEMA_VERSION = '2.0';
const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0', DATA_PORTABILITY_SCHEMA_VERSION]);

export async function buildExportPayload(appVersion) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.USER_PREFS,
    STORAGE_KEYS.PER_DOMAIN_PREFS,
    STORAGE_KEYS.LEARNING_WEIGHTS,
    STORAGE_KEYS.COOLDOWNS,
    STORAGE_KEYS.ALLOWLIST,
    STORAGE_KEYS.DENYLIST,
    STORAGE_KEYS.SITE_PROFILES,
  ]);

  return {
    schemaVersion: DATA_PORTABILITY_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    appVersion,
    userPrefs: data[STORAGE_KEYS.USER_PREFS] || {},
    perDomainPrefs: data[STORAGE_KEYS.PER_DOMAIN_PREFS] || {},
    learningWeights: data[STORAGE_KEYS.LEARNING_WEIGHTS] || {},
    cooldowns: data[STORAGE_KEYS.COOLDOWNS] || {},
    allowlist: data[STORAGE_KEYS.ALLOWLIST] || [],
    denylist: data[STORAGE_KEYS.DENYLIST] || [],
    siteProfiles: data[STORAGE_KEYS.SITE_PROFILES] || {},
  };
}

export function downloadExport(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importPayloadAndApply(payload) {
  const parsed = validatePayload(payload);
  const write = {};
  write[STORAGE_KEYS.USER_PREFS] = parsed.userPrefs;
  write[STORAGE_KEYS.PER_DOMAIN_PREFS] = parsed.perDomainPrefs;
  write[STORAGE_KEYS.LEARNING_WEIGHTS] = parsed.learningWeights;
  write[STORAGE_KEYS.COOLDOWNS] = parsed.cooldowns;
  write[STORAGE_KEYS.ALLOWLIST] = parsed.allowlist;
  write[STORAGE_KEYS.DENYLIST] = parsed.denylist;
  write[STORAGE_KEYS.SITE_PROFILES] = parsed.siteProfiles;

  await runStorageAreaTransaction('local', () => chrome.storage.local.set(write));

  const domains = new Set();
  const modeCount = countModes(parsed);
  collectDomains(parsed, domains);

  return { domains: domains.size, modes: modeCount };
}

export async function resetAllData() {
  // Low-level storage primitive. Runtime UI must use RESET_ALL_DATA so active
  // document effects are removed before lifecycle authority is erased.
  await runStorageAreaTransaction('local', () => (
    runStorageAreaTransaction('session', async () => {
      await chrome.storage.local.clear();
      if (chrome.storage.session) await chrome.storage.session.clear();
    })
  ));
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
  if (!SUPPORTED_SCHEMA_VERSIONS.has(payload.schemaVersion)) throw new Error('Invalid schemaVersion');

  const userPrefs = validateUserPrefs(payload.userPrefs || {});
  const allowlist = validateDomainList(payload.allowlist || []);
  const denylist = validateDomainList(payload.denylist || []);
  const perDomainPrefs = validatePerDomainPrefs(payload.perDomainPrefs || {});
  const learningWeights = validateLearningWeights(payload.learningWeights || {});
  const cooldowns = validateCooldowns(payload.cooldowns || {});
  const siteProfiles = validateSiteProfiles(payload.siteProfiles);

  return { userPrefs, allowlist, denylist, perDomainPrefs, learningWeights, cooldowns, siteProfiles };
}

function validateUserPrefs(prefs) {
  if (!isPlainObject(prefs)) throw new Error('Invalid userPrefs');
  const normalized = {};
  normalized.bannerPosition = prefs.bannerPosition === 'bottom' ? 'bottom' : 'top';
  normalized.displayDensity = prefs.displayDensity === 'compact' ? 'compact' : 'comfortable';
  normalized.reducedMotion = Boolean(prefs.reducedMotion);
  normalized.highContrast = Boolean(prefs.highContrast);
  normalized.spaDetectionEnabled = Boolean(prefs.spaDetectionEnabled);
  normalized.focusDefaultEnabled = prefs.focusDefaultEnabled === true;
  normalized.smartScope = validateSmartScopeConfig(prefs.smartScope);

  const focusOverlayAlpha = normalizeNumberInRange(prefs.focusOverlayAlpha, 0, 1);
  if (focusOverlayAlpha !== null) {
    normalized.focusOverlayAlpha = focusOverlayAlpha;
  }
  const focusOverlayBlurPx = normalizeNumberInRange(prefs.focusOverlayBlurPx, 0, 24);
  if (focusOverlayBlurPx !== null) {
    normalized.focusOverlayBlurPx = focusOverlayBlurPx;
  }
  const readingRulerHeightPx = normalizeNumberInRange(prefs.readingRulerHeightPx, 40, 400);
  if (readingRulerHeightPx !== null) {
    normalized.readingRulerHeightPx = readingRulerHeightPx;
  }
  const readingRulerOpacity = normalizeNumberInRange(prefs.readingRulerOpacity, 0, 0.6);
  if (readingRulerOpacity !== null) {
    normalized.readingRulerOpacity = readingRulerOpacity;
  }
  const readingRulerBlurPx = normalizeNumberInRange(prefs.readingRulerBlurPx, 0, 24);
  if (readingRulerBlurPx !== null) {
    normalized.readingRulerBlurPx = readingRulerBlurPx;
  }
  const readingRulerFeatherPx = normalizeNumberInRange(prefs.readingRulerFeatherPx, 0, 120);
  if (readingRulerFeatherPx !== null) {
    normalized.readingRulerFeatherPx = readingRulerFeatherPx;
  }

  const suggestion = Number(prefs.suggestionThreshold);
  const auto = Number(prefs.autoThreshold);
  const safeSuggestion = Number.isFinite(suggestion) && suggestion >= 0 && suggestion <= 1 ? suggestion : 0.6;
  const safeAuto = Number.isFinite(auto) && auto >= 0 && auto <= 1 ? auto : 0.85;
  normalized.suggestionThreshold = safeSuggestion;
  normalized.autoThreshold = safeAuto;

  const allowedCooldowns = [21600000, 43200000, 86400000, 172800000];
  const cooldown = Number(prefs.cooldownDuration);
  normalized.cooldownDuration = allowedCooldowns.includes(cooldown) ? cooldown : 86400000;

  const modePrefs = normalizeModePrefs(prefs);
  if (Object.keys(modePrefs).length) {
    normalized.modePrefs = modePrefs;
  }

  return normalized;
}

function normalizeModePrefs(prefs) {
  const normalized = {};
  const rawModePrefs =
    prefs?.modePrefs && typeof prefs.modePrefs === 'object' && !Array.isArray(prefs.modePrefs)
      ? prefs.modePrefs
      : {};

  const booleanKeysByMode = {
    ...MODE_PREF_KEYS,
    [MODE_IDS.COMFORT_VISUAL]: Object.freeze([
      ...new Set([...(MODE_PREF_KEYS?.[MODE_IDS.COMFORT_VISUAL] || []), ...Object.keys(COMFORT_VISUAL_DEFAULTS)]),
    ]),
  };

  Object.entries(booleanKeysByMode).forEach(([modeId, keys]) => {
    const rawPrefs = rawModePrefs?.[modeId];
    const normalizedMode = {};

    if (rawPrefs && typeof rawPrefs === 'object' && !Array.isArray(rawPrefs)) {
      keys.forEach((key) => {
        if (typeof rawPrefs[key] === 'boolean') {
          normalizedMode[key] = rawPrefs[key];
        }
      });
    }

    if (modeId === MODE_IDS.FOCUS) {
      const distractionDimAlpha = normalizeNumberInRange(
        rawPrefs?.distractionDimAlpha ?? prefs?.focusOverlayAlpha,
        0,
        1
      );
      if (distractionDimAlpha !== null) {
        normalizedMode.distractionDimAlpha = distractionDimAlpha;
      }

      const readingRulerHeightPx = normalizeNumberInRange(
        rawPrefs?.readingRulerHeightPx ?? prefs?.readingRulerHeightPx,
        40,
        400
      );
      if (readingRulerHeightPx !== null) {
        normalizedMode.readingRulerHeightPx = readingRulerHeightPx;
      }

      const readingRulerOpacity = normalizeNumberInRange(
        rawPrefs?.readingRulerOpacity ?? prefs?.readingRulerOpacity,
        0,
        0.6
      );
      if (readingRulerOpacity !== null) {
        normalizedMode.readingRulerOpacity = readingRulerOpacity;
      }

      const distractionDimBlurPx = normalizeNumberInRange(
        rawPrefs?.distractionDimBlurPx ?? prefs?.focusOverlayBlurPx,
        0,
        24
      );
      if (distractionDimBlurPx !== null) {
        normalizedMode.distractionDimBlurPx = distractionDimBlurPx;
      }

      const readingRulerBlurPx = normalizeNumberInRange(
        rawPrefs?.readingRulerBlurPx ?? prefs?.readingRulerBlurPx,
        0,
        24
      );
      if (readingRulerBlurPx !== null) {
        normalizedMode.readingRulerBlurPx = readingRulerBlurPx;
      }

      const readingRulerFeatherPx = normalizeNumberInRange(
        rawPrefs?.readingRulerFeatherPx ?? prefs?.readingRulerFeatherPx,
        0,
        120
      );
      if (readingRulerFeatherPx !== null) {
        normalizedMode.readingRulerFeatherPx = readingRulerFeatherPx;
      }
    }

    if (Object.keys(normalizedMode).length) {
      normalized[modeId] = normalizedMode;
    }
  });

  return normalized;
}

function normalizeNumberInRange(value, min, max) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < min || numeric > max) {
    return null;
  }
  return numeric;
}

function validateSmartScopeConfig(raw) {
  const base = {
    enabled: true,
    level: SMARTSCOPE_LEVELS.CONSERVATIVE,
    perDomain: {},
    debugEnabled: false,
  };

  if (raw == null) {
    return base;
  }
  if (!isPlainObject(raw)) throw new Error('Invalid SmartScope config');

  const level = Object.values(SMARTSCOPE_LEVELS).includes(raw.level)
    ? raw.level
    : SMARTSCOPE_LEVELS.CONSERVATIVE;

  const perDomain = {};
  if (raw.perDomain !== undefined && !isPlainObject(raw.perDomain)) {
    throw new Error('Invalid SmartScope perDomain');
  }
  if (isPlainObject(raw.perDomain)) {
    for (const [domain, cfg] of Object.entries(raw.perDomain)) {
      const normalizedDomain = normalizeDomain(domain);
      if (!normalizedDomain || !isPlainObject(cfg)) throw new Error('Invalid SmartScope domain entry');
      const domainLevel = Object.values(SMARTSCOPE_LEVELS).includes(cfg.level) ? cfg.level : level;
      perDomain[normalizedDomain] = { enabled: cfg.enabled === true, level: domainLevel };
    }
  }

  return { enabled: raw.enabled === true, level, perDomain, debugEnabled: raw.debugEnabled === true };
}

function validateDomainList(list) {
  if (!Array.isArray(list)) throw new Error('Invalid domain list');
  const result = [];
  list.forEach((entry) => {
    const normalized = normalizeDomain(entry);
    if (!normalized) throw new Error('Invalid domain');
    if (!result.includes(normalized)) result.push(normalized);
  });
  return result;
}

function validatePerDomainPrefs(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid perDomainPrefs');
  const out = {};
  const allowedDecisions = new Set([
    ...Object.values(DECISIONS),
    ...Object.keys(DECISION_ALIASES)
  ]);
  for (const [domain, modeData] of Object.entries(obj)) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error('Invalid domain in perDomainPrefs');
    if (typeof modeData !== 'object' || Array.isArray(modeData)) throw new Error('Invalid perDomainPrefs value');
    out[normalizedDomain] = {};
    for (const [modeId, prefs] of Object.entries(modeData)) {
      if (!Object.values(MODES).includes(modeId)) throw new Error('Invalid modeId');
      const decision = prefs.decision;
      if (decision && !allowedDecisions.has(decision)) throw new Error('Invalid decision');
      const normalizedDecision = decision in DECISION_ALIASES ? DECISION_ALIASES[decision] : decision;
      const intensity = prefs.intensity !== undefined ? Number(prefs.intensity) : undefined;
      if (intensity !== undefined && (!isFinite(intensity) || intensity < 0 || intensity > 1)) {
        throw new Error('Invalid intensity');
      }
      const timestamp = prefs.timestamp !== undefined ? Number(prefs.timestamp) : undefined;
      if (timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp < 0)) {
        throw new Error('Invalid timestamp');
      }
      const userIntent = prefs.userIntent;
      if (userIntent && !allowedDecisions.has(userIntent)) throw new Error('Invalid userIntent');
      const normalizedUserIntent = userIntent in DECISION_ALIASES ? DECISION_ALIASES[userIntent] : userIntent;
      const intentTimestamp = prefs.intentTimestamp !== undefined ? Number(prefs.intentTimestamp) : undefined;
      if (intentTimestamp !== undefined && (!Number.isFinite(intentTimestamp) || intentTimestamp < 0)) {
        throw new Error('Invalid intentTimestamp');
      }
      const committedAt = prefs.committedAt !== undefined ? Number(prefs.committedAt) : undefined;
      if (committedAt !== undefined && (!Number.isFinite(committedAt) || committedAt < 0)) {
        throw new Error('Invalid committedAt');
      }
      const normalizedPrefs = {};
      if (intensity !== undefined) normalizedPrefs.intensity = intensity;
      if (normalizedDecision !== undefined) normalizedPrefs.decision = normalizedDecision;
      if (timestamp !== undefined) normalizedPrefs.timestamp = timestamp;
      if (normalizedUserIntent !== undefined) normalizedPrefs.userIntent = normalizedUserIntent;
      if (intentTimestamp !== undefined) normalizedPrefs.intentTimestamp = intentTimestamp;
      if (committedAt !== undefined) normalizedPrefs.committedAt = committedAt;
      out[normalizedDomain][modeId] = normalizedPrefs;
    }
  }
  return out;
}

function validateLearningWeights(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid learningWeights');
  const out = {};
  const allowedDecisions = new Set([
    ...Object.values(DECISIONS),
    ...Object.keys(DECISION_ALIASES)
  ]);
  for (const [domain, perMode] of Object.entries(obj)) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error('Invalid domain in learningWeights');
    if (typeof perMode !== 'object' || Array.isArray(perMode)) throw new Error('Invalid learningWeights value');
    out[normalizedDomain] = {};
    for (const [modeId, entry] of Object.entries(perMode)) {
      if (!Object.values(MODES).includes(modeId)) throw new Error('Invalid modeId');
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Invalid learningWeights entry');
      }
      const rawWeight = Number(entry.weight);
      const weight = Number.isFinite(rawWeight) && rawWeight >= 0 && rawWeight <= 1 ? rawWeight : 0;
      const stage = Object.values(LEARNING_STAGES).includes(entry.stage)
        ? entry.stage
        : LEARNING_STAGES.MANUAL;
      const rawDecisionCount = Number(entry.decisionCount);
      const decisionCount = Number.isFinite(rawDecisionCount) && rawDecisionCount >= 0
        ? Math.floor(rawDecisionCount)
        : 0;
      const rawEnableCount = Number(entry.enableCount);
      const enableCount = Number.isFinite(rawEnableCount) && rawEnableCount >= 0
        ? Math.floor(rawEnableCount)
        : 0;
      const eligibilityVersion = entry.eligibilityVersion === 1 ? 1 : 0;
      const rawEligiblePositiveCount = Number(entry.eligiblePositiveCount);
      const eligiblePositiveCount = Number.isFinite(rawEligiblePositiveCount) && rawEligiblePositiveCount >= 0
        ? Math.floor(rawEligiblePositiveCount)
        : 0;
      const lastDecisionRaw = entry.lastDecision;
      const lastDecision = lastDecisionRaw && allowedDecisions.has(lastDecisionRaw)
        ? (lastDecisionRaw in DECISION_ALIASES ? DECISION_ALIASES[lastDecisionRaw] : lastDecisionRaw)
        : null;
      out[normalizedDomain][modeId] = {
        weight,
        stage,
        decisionCount,
        enableCount,
        eligibilityVersion,
        eligiblePositiveCount,
        lastDecision,
      };
    }
  }
  return out;
}

function validateCooldowns(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid cooldowns');
  const out = {};
  for (const [domain, perMode] of Object.entries(obj)) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error('Invalid domain in cooldowns');
    if (typeof perMode !== 'object' || Array.isArray(perMode)) throw new Error('Invalid cooldown entry');
    out[normalizedDomain] = {};
    for (const [modeId, entry] of Object.entries(perMode)) {
      if (!Object.values(MODES).includes(modeId)) throw new Error('Invalid modeId');
      const until = Number(entry.until);
      if (!isFinite(until) || until < 0) throw new Error('Invalid cooldown timestamp');
      out[normalizedDomain][modeId] = { until };
    }
  }
  return out;
}

function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const normalized = extractDomain(trimmed);
  if (!normalized || normalized === 'unknown') {
    return null;
  }
  return normalized.toLowerCase();
}

function collectDomains(parsed, set) {
  parsed.allowlist.forEach((d) => set.add(d));
  parsed.denylist.forEach((d) => set.add(d));
  if (parsed.siteProfiles?.entries) {
    parsed.siteProfiles.entries.forEach((entry) => {
      if (entry?.value) {
        set.add(entry.value);
      }
    });
  }
  Object.keys(parsed.perDomainPrefs).forEach((d) => set.add(d));
  Object.keys(parsed.learningWeights).forEach((d) => set.add(d));
  Object.keys(parsed.cooldowns).forEach((d) => set.add(d));
}

function countModes(parsed) {
  let count = 0;
  const add = (obj) => {
    for (const domain of Object.keys(obj)) {
      count += Object.keys(obj[domain] || {}).length;
    }
  };
  add(parsed.perDomainPrefs);
  add(parsed.learningWeights);
  add(parsed.cooldowns);
  return count;
}

function validateSiteProfiles(raw) {
  if (raw == null || raw === '') {
    return normalizeSiteProfiles({});
  }

  if (isPlainObject(raw)) {
    if (Object.prototype.hasOwnProperty.call(raw, 'entries') && !Array.isArray(raw.entries)) {
      throw new Error('Invalid siteProfiles entries');
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'rules') && !Array.isArray(raw.rules)) {
      throw new Error('Invalid siteProfiles rules');
    }
  }

  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.entries)
      ? raw.entries
      : Array.isArray(raw?.rules)
        ? raw.rules
        : null;

  if (!entries) {
    if (typeof raw === 'object') {
      return normalizeSiteProfiles(raw);
    }
    throw new Error('Invalid siteProfiles');
  }

  const normalizedEntries = entries.map((entry) => {
    const normalized = normalizeSiteProfileEntry(entry);
    if (!normalized) {
      throw new Error('Invalid siteProfiles entry');
    }
    return normalized;
  });

  return normalizeSiteProfiles({ entries: normalizedEntries });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
