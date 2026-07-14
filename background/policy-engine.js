import {
  MODE_IDS,
  MODE_PREFS_DEFAULTS,
  POLICY_DEFAULTS,
  STATES,
  STORAGE_KEYS,
  THRESHOLDS,
} from '../shared/constants.js';
import { DECISION_KINDS } from '../shared/types/policy.js';
import { SIGNAL_TYPES } from '../shared/types/signals.js';
import { getFromSession, mutateSessionValue } from '../shared/utils.js';

const MODE_SCORE_WEIGHTS = {
  [MODE_IDS.COMFORT_VISUAL]: {
    [SIGNAL_TYPES.THEME_PREF]: 0.35,
    [SIGNAL_TYPES.ZOOM]: 0.3,
    [SIGNAL_TYPES.READING_BEHAVIOR]: 0.25,
    userToggle: 0.1,
  },
  [MODE_IDS.FOCUS]: {
    [SIGNAL_TYPES.READING_BEHAVIOR]: 0.45,
    [SIGNAL_TYPES.VIEWPORT_SCROLL]: 0.2,
    [SIGNAL_TYPES.ZOOM]: 0.15,
    userToggle: 0.2,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeSignalValue(type, value) {
  if (type === SIGNAL_TYPES.THEME_PREF) {
    return value === 'dark' ? 1 : 0;
  }

  if (type === SIGNAL_TYPES.ZOOM) {
    if (typeof value === 'number') {
      return value >= 1.2 ? 1 : 0;
    }
    return value ? 1 : 0;
  }

  if (type === SIGNAL_TYPES.VIEWPORT_SCROLL || type === SIGNAL_TYPES.READING_BEHAVIOR) {
    if (typeof value === 'number') {
      return value > 0 ? 1 : 0;
    }
    return value ? 1 : 0;
  }

  if (type === SIGNAL_TYPES.VIEWPORT_SCALE) {
    if (typeof value === 'number') {
      return value <= 0.9 ? 1 : 0;
    }
    return value ? 1 : 0;
  }

  return value ? 1 : 0;
}

function getSnapshotEntry(snapshot, type) {
  const byType = snapshot && typeof snapshot === 'object' ? snapshot.byType : null;
  if (!byType || typeof byType !== 'object') {
    return null;
  }
  return byType[type] || null;
}

function getUserToggleSignal(userPrefs, modeId) {
  const modePrefs = isPlainObject(userPrefs?.modePrefs?.[modeId]) ? userPrefs.modePrefs[modeId] : null;
  if (!modePrefs) {
    return null;
  }

  const defaults = MODE_PREFS_DEFAULTS[modeId] || {};
  let changed = false;
  let enabledCount = 0;
  let totalCount = 0;

  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (typeof modePrefs[key] === 'boolean') {
      totalCount += 1;
      if (modePrefs[key]) {
        enabledCount += 1;
      }
      if (modePrefs[key] !== defaultValue) {
        changed = true;
      }
    }
  }

  if (!changed || totalCount === 0) {
    return null;
  }

  return {
    value: clampScore(enabledCount / totalCount),
    confidence: 0.65,
  };
}

function buildThresholds(userPrefs, modeId) {
  const suggestionThreshold = normalizeThreshold(
    getOverrideThreshold(userPrefs, modeId, 'suggestionThreshold'),
    THRESHOLDS.SUGGESTION,
  );
  const autoThreshold = normalizeThreshold(
    getOverrideThreshold(userPrefs, modeId, 'autoThreshold'),
    THRESHOLDS.AUTO_APPLY,
  );
  const exitThreshold = clampScore(suggestionThreshold - POLICY_DEFAULTS.HYSTERESIS_GAP);

  return {
    enter: suggestionThreshold,
    exit: exitThreshold,
    apply: autoThreshold,
  };
}

function normalizeThreshold(value, fallbackValue) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallbackValue;
  }
  return clampScore(value);
}

function getOverrideThreshold(userPrefs, modeId, key) {
  if (!isPlainObject(userPrefs)) {
    return null;
  }
  const modePrefs = isPlainObject(userPrefs?.modePrefs) ? userPrefs.modePrefs : null;
  const modeOverrides = modePrefs && isPlainObject(modePrefs[modeId]) ? modePrefs[modeId] : null;
  if (modeOverrides && typeof modeOverrides[key] === 'number') {
    return modeOverrides[key];
  }
  return typeof userPrefs[key] === 'number' ? userPrefs[key] : null;
}

async function getPolicyStateMap() {
  const data = (await getFromSession(STORAGE_KEYS.POLICY_STATE)) || {};
  return isPlainObject(data) ? data : {};
}

async function getPolicyEntry(tabId, modeId) {
  const data = await getPolicyStateMap();
  const entry = data?.[String(tabId)]?.[modeId];
  if (!entry || typeof entry !== 'object') {
    return {
      latched: false,
      lastDecision: null,
      lastDecisionAt: null,
      cooldownUntil: null,
    };
  }
  return entry;
}

async function updatePolicyEntry(tabId, modeId, patch) {
  const tabKey = String(tabId);
  let next = null;
  await mutateSessionValue(STORAGE_KEYS.POLICY_STATE, (storedState) => {
    const data = isPlainObject(storedState) ? { ...storedState } : {};
    const current = (data[tabKey] && data[tabKey][modeId]) || {};
    next = { ...current, ...patch };
    data[tabKey] = { ...(data[tabKey] || {}), [modeId]: next };
    return data;
  });
  return next;
}

export async function clearPolicyState(tabId) {
  const tabKey = String(tabId);
  await mutateSessionValue(STORAGE_KEYS.POLICY_STATE, (storedState) => {
    const data = isPlainObject(storedState) ? { ...storedState } : {};
    delete data[tabKey];
    return data;
  });
}

export function computeModeScore(snapshot, modeId, userPrefs) {
  const weights = MODE_SCORE_WEIGHTS[modeId] || {};
  let score = 0;
  const strongSignals = [];
  const contributingSignals = [];

  for (const [signalType, weight] of Object.entries(weights)) {
    if (signalType === 'userToggle') {
      const userToggle = getUserToggleSignal(userPrefs, modeId);
      if (!userToggle) {
        continue;
      }
      const normalizedValue = clampScore(userToggle.value);
      const confidence = clampScore(userToggle.confidence);
      const contribution = normalizedValue * confidence * weight;
      if (normalizedValue > 0) {
        contributingSignals.push('userToggle');
        if (confidence >= POLICY_DEFAULTS.STRONG_SIGNAL_CONFIDENCE) {
          strongSignals.push('userToggle');
        }
      }
      score += contribution;
      continue;
    }

    const entry = getSnapshotEntry(snapshot, signalType);
    if (!entry) {
      continue;
    }
    const normalizedValue = clampScore(normalizeSignalValue(signalType, entry.value));
    const confidence = clampScore(entry.confidence);
    const contribution = normalizedValue * confidence * weight;
    if (normalizedValue > 0) {
      contributingSignals.push(signalType);
      if (confidence >= POLICY_DEFAULTS.STRONG_SIGNAL_CONFIDENCE) {
        strongSignals.push(signalType);
      }
    }
    score += contribution;
  }

  return {
    score: clampScore(score),
    strongSignals,
    contributingSignals,
  };
}

export async function evaluatePolicyDecision({
  tabId,
  modeId,
  snapshot,
  currentState,
  userPrefs,
  allowlisted,
  denylisted,
  cooldownActive,
  now = Date.now(),
}) {
  const thresholds = buildThresholds(userPrefs, modeId);
  const scoreResult = computeModeScore(snapshot, modeId, userPrefs);
  const reasons = [];

  if (denylisted) {
    reasons.push('DENYLISTED');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (allowlisted) {
    reasons.push('ALLOWLISTED');
  }

  if ([STATES.BLOCKED, STATES.DEGRADED, STATES.ERROR].includes(currentState.state)) {
    reasons.push('STATE_BLOCKED');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (currentState.pendingDecision) {
    reasons.push('PENDING_DECISION');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (cooldownActive) {
    reasons.push('USER_COOLDOWN_ACTIVE');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  const policyEntry = await getPolicyEntry(tabId, modeId);
  if (typeof policyEntry.cooldownUntil === 'number' && policyEntry.cooldownUntil > now) {
    reasons.push('COOLDOWN_ACTIVE');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (policyEntry.latched && policyEntry.lastDecision !== DECISION_KINDS.SUGGEST) {
    if (scoreResult.score > thresholds.exit) {
      reasons.push('HYSTERESIS_HOLD');
      return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
    }
    await updatePolicyEntry(tabId, modeId, { latched: false });
    reasons.push('HYSTERESIS_RELEASE');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (scoreResult.score < thresholds.enter && !allowlisted && !policyEntry.latched) {
    reasons.push('BELOW_ENTER_THRESHOLD');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  if (scoreResult.contributingSignals.length === 0) {
    reasons.push('NO_SIGNALS');
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  const strongCount = scoreResult.strongSignals.length;
  const canApply =
    scoreResult.score >= thresholds.apply &&
    strongCount >= POLICY_DEFAULTS.MIN_STRONG_SIGNALS_FOR_APPLY;

  if (canApply) {
    if (policyEntry.lastDecision !== DECISION_KINDS.SUGGEST) {
      reasons.push('APPLY_REQUIRES_SUGGESTION');
    } else if (
      typeof policyEntry.lastDecisionAt === 'number' &&
      now - policyEntry.lastDecisionAt < POLICY_DEFAULTS.APPLY_STABILITY_MS
    ) {
      reasons.push('APPLY_WAITING_STABILITY');
    } else {
      const nextEntry = await updatePolicyEntry(tabId, modeId, {
        latched: true,
        lastDecision: DECISION_KINDS.APPLY,
        lastDecisionAt: now,
        cooldownUntil: now + POLICY_DEFAULTS.COOLDOWN_MS,
      });
      return buildDecision(DECISION_KINDS.APPLY, modeId, scoreResult, thresholds, reasons, nextEntry);
    }
  } else if (scoreResult.score >= thresholds.apply && strongCount < POLICY_DEFAULTS.MIN_STRONG_SIGNALS_FOR_APPLY) {
    reasons.push('INSUFFICIENT_STRONG_SIGNALS');
  }

  if (policyEntry.latched && policyEntry.lastDecision === DECISION_KINDS.SUGGEST) {
    if (scoreResult.score <= thresholds.exit) {
      await updatePolicyEntry(tabId, modeId, { latched: false });
      reasons.push('HYSTERESIS_RELEASE');
    } else {
      reasons.push('HYSTERESIS_HOLD');
    }
    return buildDecision(DECISION_KINDS.NOOP, modeId, scoreResult, thresholds, reasons);
  }

  const nextEntry = await updatePolicyEntry(tabId, modeId, {
    latched: true,
    lastDecision: DECISION_KINDS.SUGGEST,
    lastDecisionAt: now,
  });

  return buildDecision(DECISION_KINDS.SUGGEST, modeId, scoreResult, thresholds, reasons, nextEntry);
}

function buildDecision(kind, modeId, scoreResult, thresholds, reasonCodes, entry) {
  return {
    kind,
    modeId,
    score: scoreResult.score,
    reasonCodes: reasonCodes.length ? reasonCodes : ['OK'],
    strongSignals: scoreResult.strongSignals,
    contributingSignals: scoreResult.contributingSignals,
    thresholds,
    policyEntry: entry || null,
  };
}

export function logDecisionTrace(decision) {
  if (!decision || typeof decision !== 'object') {
    return;
  }

  const trace = {
    modeId: decision.modeId,
    decision: decision.kind,
    score: Number(decision.score.toFixed(3)),
    reasons: decision.reasonCodes,
    strongSignals: decision.strongSignals,
    signals: decision.contributingSignals,
    thresholds: decision.thresholds,
  };

  console.info('[PolicyEngine] decision trace', trace);
}
