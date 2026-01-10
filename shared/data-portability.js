import {
  DECISION_ALIASES,
  DECISIONS,
  MODES,
  STORAGE_KEYS,
  LEARNING_STAGES,
  SMARTSCOPE_LEVELS
} from './constants.js';

export async function buildExportPayload(appVersion) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.USER_PREFS,
    STORAGE_KEYS.PER_DOMAIN_PREFS,
    STORAGE_KEYS.LEARNING_WEIGHTS,
    STORAGE_KEYS.COOLDOWNS,
    STORAGE_KEYS.ALLOWLIST,
    STORAGE_KEYS.DENYLIST,
  ]);

  return {
    schemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    appVersion,
    userPrefs: data[STORAGE_KEYS.USER_PREFS] || {},
    perDomainPrefs: data[STORAGE_KEYS.PER_DOMAIN_PREFS] || {},
    learningWeights: data[STORAGE_KEYS.LEARNING_WEIGHTS] || {},
    cooldowns: data[STORAGE_KEYS.COOLDOWNS] || {},
    allowlist: data[STORAGE_KEYS.ALLOWLIST] || [],
    denylist: data[STORAGE_KEYS.DENYLIST] || [],
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

  await chrome.storage.local.set(write);

  const domains = new Set();
  const modeCount = countModes(parsed);
  collectDomains(parsed, domains);

  return { domains: domains.size, modes: modeCount };
}

export async function resetAllData() {
  await chrome.storage.local.clear();
  if (chrome.storage.session) {
    await chrome.storage.session.clear();
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
  if (payload.schemaVersion !== '1.0') throw new Error('Invalid schemaVersion');

  const userPrefs = validateUserPrefs(payload.userPrefs || {});
  const allowlist = validateDomainList(payload.allowlist || []);
  const denylist = validateDomainList(payload.denylist || []);
  const perDomainPrefs = validatePerDomainPrefs(payload.perDomainPrefs || {});
  const learningWeights = validateLearningWeights(payload.learningWeights || {});
  const cooldowns = validateCooldowns(payload.cooldowns || {});

  return { userPrefs, allowlist, denylist, perDomainPrefs, learningWeights, cooldowns };
}

function validateUserPrefs(prefs) {
  const normalized = {};
  normalized.bannerPosition = prefs.bannerPosition === 'bottom' ? 'bottom' : 'top';
  normalized.displayDensity = prefs.displayDensity === 'compact' ? 'compact' : 'comfortable';
  normalized.reducedMotion = Boolean(prefs.reducedMotion);
  normalized.highContrast = Boolean(prefs.highContrast);
  normalized.spaDetectionEnabled = Boolean(prefs.spaDetectionEnabled);
  normalized.smartScope = validateSmartScopeConfig(prefs.smartScope);

  const suggestion = Number(prefs.suggestionThreshold);
  const auto = Number(prefs.autoThreshold);
  if (!isFinite(suggestion) || suggestion < 0 || suggestion > 1) throw new Error('Invalid threshold value');
  if (!isFinite(auto) || auto < 0 || auto > 1) throw new Error('Invalid threshold value');
  normalized.suggestionThreshold = suggestion;
  normalized.autoThreshold = auto;

  const allowedCooldowns = [21600000, 43200000, 86400000, 172800000];
  const cooldown = Number(prefs.cooldownDuration);
  normalized.cooldownDuration = allowedCooldowns.includes(cooldown) ? cooldown : 86400000;

  return normalized;
}

function validateSmartScopeConfig(raw) {
  const base = {
    enabled: false,
    level: SMARTSCOPE_LEVELS.CONSERVATIVE,
    perDomain: {},
    debugEnabled: false,
  };

  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const level = Object.values(SMARTSCOPE_LEVELS).includes(raw.level)
    ? raw.level
    : SMARTSCOPE_LEVELS.CONSERVATIVE;

  const perDomain = {};
  if (raw.perDomain && typeof raw.perDomain === 'object' && !Array.isArray(raw.perDomain)) {
    for (const [domain, cfg] of Object.entries(raw.perDomain)) {
      const normalizedDomain = normalizeDomain(domain);
      if (!normalizedDomain || !cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
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
      out[normalizedDomain][modeId] = {
        intensity,
        decision: normalizedDecision,
        timestamp,
      };
    }
  }
  return out;
}

function validateLearningWeights(obj) {
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid learningWeights');
  const out = {};
  for (const [domain, perMode] of Object.entries(obj)) {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain) throw new Error('Invalid domain in learningWeights');
    if (typeof perMode !== 'object' || Array.isArray(perMode)) throw new Error('Invalid learningWeights value');
    out[normalizedDomain] = {};
    for (const [modeId, entry] of Object.entries(perMode)) {
      if (!Object.values(MODES).includes(modeId)) throw new Error('Invalid modeId');
      const weight = Number(entry.weight);
      const stage = entry.stage || LEARNING_STAGES.MANUAL;
      if (!isFinite(weight) || weight < 0 || weight > 1) throw new Error('Invalid weight');
      if (!Object.values(LEARNING_STAGES).includes(stage)) throw new Error('Invalid stage');
      out[normalizedDomain][modeId] = { weight, stage };
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
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const host = new URL(`https://${trimmed}`).hostname;
    return toBaseDomain(host);
  } catch (e) {
    return null;
  }
}

function toBaseDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && parts[parts.length - 2].length <= 3) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

function collectDomains(parsed, set) {
  parsed.allowlist.forEach((d) => set.add(d));
  parsed.denylist.forEach((d) => set.add(d));
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
