import { ACTIONS } from '../shared/constants.js';
import {
  ACTION_CONTEXT_SOURCES,
  ACTION_POLICY_DECISIONS,
  ADAPTATION_ACTION_IDS,
  PAGE_TYPES,
} from '../shared/engine-core/enums.js';
import { evaluateActionPolicyDecisionV1 } from '../shared/engine-core/action-policy.js';
import {
  buildRuntimeEffectPlanV1,
} from '../shared/engine-core/runtime-effect-planner.js';
import {
  learningEffectKeyFromRuntimeEffectPlanV1,
  legacyLearningEffectKeyV1,
} from '../shared/engine-core/runtime-capability-matrix.js';
import { routePageSignalsV1 } from '../shared/engine-core/router.js';
import { buildTemplateShapeSignatureV1 } from '../shared/engine-core/template-memory.js';
import {
  buildTemplateMemoryEvidence,
  evaluateTemplatePersonalizationGate,
} from './template-memory.js';
import { contentBridge } from './content-bridge.js';

export const LIVE_PERSONALIZATION_GATE_VERSION = 1;
export const LIVE_PERSONALIZATION_GATE_BUDGET = Object.freeze({
  budgetMs: 8,
  maxBlocks: 8,
  maxNodes: 1500,
  maxCandidatesSeen: 200,
});
export const LIVE_PERSONALIZATION_GATE_HARD_CAPS = Object.freeze({
  budgetMs: 16,
  maxBlocks: 12,
  maxNodes: 2500,
  maxCandidatesSeen: 300,
});
export const LIVE_PERSONALIZATION_GATE_TIMEOUT_MS = 100;

const MODE_ACTION_ID = Object.freeze({
  'comfort-visual': ADAPTATION_ACTION_IDS.READING_COMFORT_TYPOGRAPHY,
  focus: ADAPTATION_ACTION_IDS.FOCUS_VISIBILITY,
});
const LIVE_URL_KIND_VALUES = Object.freeze([
  'VIDEO',
  'SEARCH',
  'DOC',
  'SHOP',
  'FORM',
  'FEED',
  'DASHBOARD',
  'WEB_APP',
  'UNKNOWN',
]);
const LIVE_FORBIDDEN_KEYS = Object.freeze([
  'textContent',
  'rawText',
  'innerHTML',
  'outerHTML',
  'url',
  'href',
  'pathname',
  'query',
  'selector',
  'cssSelector',
  'xpath',
  'domPath',
  'screenshot',
  'element',
  'node',
  'rect',
  'boundingClientRect',
  'routeFingerprint',
  'domainHash',
  'templateHash',
  'siteKey',
  'host',
  'frameUrl',
  'tabId',
  'attemptId',
  'tokens',
  'applyPlan',
  'rawProfile',
  'rawSignals',
]);

function actionIdForMode(modeId) {
  return MODE_ACTION_ID[modeId] || null;
}

function actionIdForLiveRuntimeApply(modeId, profile) {
  if (
    modeId === 'comfort-visual'
    && [PAGE_TYPES.SEARCH, PAGE_TYPES.FORM].includes(profile?.pageType)
  ) {
    return ADAPTATION_ACTION_IDS.PAGE_CLARITY;
  }

  return actionIdForMode(modeId);
}

function clampCap(value, fallback, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), max);
}

function pageSignalMessage(budget = {}) {
  return {
    action: ACTIONS.PAGE_SIGNALS_COLLECT_V1,
    budgetMs: clampCap(budget.budgetMs, LIVE_PERSONALIZATION_GATE_BUDGET.budgetMs, LIVE_PERSONALIZATION_GATE_HARD_CAPS.budgetMs),
    maxBlocks: clampCap(budget.maxBlocks, LIVE_PERSONALIZATION_GATE_BUDGET.maxBlocks, LIVE_PERSONALIZATION_GATE_HARD_CAPS.maxBlocks),
    maxNodes: clampCap(budget.maxNodes, LIVE_PERSONALIZATION_GATE_BUDGET.maxNodes, LIVE_PERSONALIZATION_GATE_HARD_CAPS.maxNodes),
    maxCandidatesSeen: clampCap(
      budget.maxCandidatesSeen,
      LIVE_PERSONALIZATION_GATE_BUDGET.maxCandidatesSeen,
      LIVE_PERSONALIZATION_GATE_HARD_CAPS.maxCandidatesSeen,
    ),
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rejectLiveForbiddenKeys(value, path = '$', seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string' && /\bhttps?:\/\//i.test(value)) {
      return { ok: false, reason: 'LIVE_SIGNAL_URL_STRING', path };
    }
    return { ok: true };
  }
  if (seen.has(value)) {
    return { ok: false, reason: 'LIVE_SIGNAL_CYCLE', path };
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = rejectLiveForbiddenKeys(value[index], `${path}[${index}]`, seen);
      if (!result.ok) return result;
    }
    seen.delete(value);
    return { ok: true };
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return { ok: false, reason: 'LIVE_SIGNAL_NON_PLAIN_OBJECT', path };
  }
  for (const [key, child] of Object.entries(value)) {
    if (LIVE_FORBIDDEN_KEYS.includes(key)) {
      seen.delete(value);
      return { ok: false, reason: 'LIVE_SIGNAL_FORBIDDEN_KEY', path: `${path}.${key}` };
    }
    const result = rejectLiveForbiddenKeys(child, `${path}.${key}`, seen);
    if (!result.ok) {
      seen.delete(value);
      return result;
    }
  }
  seen.delete(value);
  return { ok: true };
}

function validateLiveSignals(signals, requestedFrameId = 0) {
  const privacy = rejectLiveForbiddenKeys(signals);
  if (!privacy.ok) return privacy;
  if (!isPlainObject(signals)) return { ok: false, reason: 'LIVE_SIGNALS_NOT_OBJECT' };
  if (signals.frameId !== requestedFrameId) return { ok: false, reason: 'LIVE_FRAME_MISMATCH' };
  if (!LIVE_URL_KIND_VALUES.includes(signals.pageHints?.urlKind)) {
    return { ok: false, reason: 'LIVE_URL_KIND_INVALID' };
  }
  if (signals.stats?.budgetHit === true) {
    return { ok: false, reason: 'LIVE_BUDGET_HIT' };
  }
  if (Array.isArray(signals.blocks)) {
    const badBlock = signals.blocks.find((block) => typeof block?.blockId !== 'string' || !/^b[1-9][0-9]*$/.test(block.blockId));
    if (badBlock) {
      return { ok: false, reason: 'LIVE_BLOCK_ID_INVALID' };
    }
  }
  return { ok: true };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ ok: false, error: 'LIVE_GATE_TIMEOUT' }), timeoutMs);
    }),
  ]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectLiveProfile(tabId, { budget, bridge = contentBridge, frameId = 0, timeoutMs = LIVE_PERSONALIZATION_GATE_TIMEOUT_MS } = {}) {
  const response = await withTimeout(
    bridge.safeSend(tabId, pageSignalMessage(budget), { frameId }),
    timeoutMs,
  );
  const data = response?.ok === true ? response.data : response;
  if (data?.ok !== true || !data.signals) {
    return {
      ok: false,
      reason: data?.error || response?.error || 'PAGE_SIGNALS_UNAVAILABLE',
    };
  }
  const liveValidation = validateLiveSignals(data.signals, frameId);
  if (!liveValidation.ok) return liveValidation;
  try {
    return {
      ok: true,
      profile: routePageSignalsV1(data.signals),
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'PAGE_PROFILE_INVALID',
      detail: error?.message || 'invalid page signals',
    };
  }
}

async function collectLiveProfileWithRetry(
  tabId,
  {
    budget,
    bridge = contentBridge,
    frameId = 0,
    timeoutMs = LIVE_PERSONALIZATION_GATE_TIMEOUT_MS,
    attempts = 3,
    retryDelayMs = 40,
  } = {},
) {
  let lastResult = null;
  const totalAttempts = Math.max(1, Math.min(Math.floor(attempts) || 1, 3));

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    lastResult = await collectLiveProfile(tabId, { budget, bridge, frameId, timeoutMs });
    if (lastResult?.ok === true) {
      return lastResult;
    }
    if (attempt < totalAttempts) {
      await sleep(retryDelayMs);
    }
  }

  return lastResult || { ok: false, reason: 'PAGE_SIGNALS_UNAVAILABLE' };
}

function evaluateAutoApplyActionPolicy(profile, actionId, requestedStrength) {
  try {
    const actionContext = {
      schemaVersion: 1,
      actionId,
      source: ACTION_CONTEXT_SOURCES.AUTO_APPLY,
      userExplicit: false,
      autoApplyCandidate: true,
    };
    if (typeof requestedStrength === 'number' && Number.isFinite(requestedStrength)) {
      actionContext.requestedStrength = requestedStrength;
    }
    const decision = evaluateActionPolicyDecisionV1(profile, {
      ...actionContext,
    });
    if (decision.decision === ACTION_POLICY_DECISIONS.DENY) {
      return { ok: false, reason: 'ACTION_POLICY_DENIED', decision };
    }
    return { ok: true, decision };
  } catch (error) {
    return {
      ok: false,
      reason: 'ACTION_POLICY_FAILED',
      detail: error?.message || 'action policy failed',
    };
  }
}

function evaluateUserRequestActionPolicy(profile, actionId, requestedStrength) {
  try {
    const actionContext = {
      schemaVersion: 1,
      actionId,
      source: ACTION_CONTEXT_SOURCES.USER_REQUEST,
      userExplicit: true,
      autoApplyCandidate: false,
    };
    if (typeof requestedStrength === 'number' && Number.isFinite(requestedStrength)) {
      actionContext.requestedStrength = requestedStrength;
    }
    return { ok: true, decision: evaluateActionPolicyDecisionV1(profile, actionContext) };
  } catch (error) {
    return {
      ok: false,
      reason: 'ACTION_POLICY_FAILED',
      detail: error?.message || 'action policy failed',
    };
  }
}

async function buildEvidenceFromProfile({ profile, siteKey, modeId, actionId, frameId, runtimeEffectPlan }) {
  const learningEffectKey = runtimeEffectPlan
    ? learningEffectKeyFromRuntimeEffectPlanV1(runtimeEffectPlan)
    : legacyLearningEffectKeyV1({ modeId, actionId, pageType: profile.pageType });
  return buildTemplateMemoryEvidence({
    siteKey,
    templateSignature: buildTemplateShapeSignatureV1(profile),
    pageType: profile.pageType,
    modeId,
    actionId,
    frameId,
    learningEffectKey,
  });
}

export async function buildLivePersonalizationGate({
  tabId,
  modeId,
  siteKey,
  requestedStrength,
  budget,
  bridge,
  frameId = 0,
  timeoutMs,
  nowMs = Date.now(),
} = {}) {
  const actionId = actionIdForMode(modeId);
  if (!actionId) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  let live;
  try {
    live = await collectLiveProfile(tabId, { budget, bridge, frameId, timeoutMs });
  } catch (error) {
    return {
      ok: false,
      reason: 'PAGE_SIGNALS_COLLECT_FAILED',
      detail: error?.message || 'message failed',
    };
  }
  if (!live.ok) {
    return live;
  }

  const policy = evaluateAutoApplyActionPolicy(live.profile, actionId, requestedStrength);
  if (!policy.ok) {
    return {
      ok: false,
      reason: policy.reason,
      detail: policy.detail,
      policyDecision: policy.decision || null,
    };
  }

  const gate = await evaluateTemplatePersonalizationGate({
    siteKey,
    templateSignature: buildTemplateShapeSignatureV1(live.profile),
    pageType: live.profile.pageType,
    modeId,
    actionId,
    learningEffectKey: legacyLearningEffectKeyV1({ modeId, actionId, pageType: live.profile.pageType }),
    profile: live.profile,
    risk: live.profile.risk,
  }, { nowMs });

  return {
    ok: gate?.allowed === true,
    reason: gate?.allowed === true ? 'OK' : 'PERSONALIZATION_GATE_DENIED',
    version: LIVE_PERSONALIZATION_GATE_VERSION,
    frameId,
    gate,
    policyDecision: policy.decision,
    profileStats: live.profile.stats,
  };
}

export async function buildLiveRuntimeApplyContext({
  tabId,
  modeId,
  siteKey,
  requestedStrength,
  budget,
  bridge,
  frameId = 0,
  timeoutMs,
} = {}) {
  const modeDefaultActionId = actionIdForMode(modeId);
  if (!modeDefaultActionId) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  let live;
  try {
    live = await collectLiveProfileWithRetry(tabId, { budget, bridge, frameId, timeoutMs });
  } catch (error) {
    return {
      ok: false,
      reason: 'PAGE_SIGNALS_COLLECT_FAILED',
      detail: error?.message || 'message failed',
    };
  }
  if (!live.ok) {
    return live;
  }

  const actionId = actionIdForLiveRuntimeApply(modeId, live.profile);
  if (!actionId) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  const policy = evaluateUserRequestActionPolicy(live.profile, actionId, requestedStrength);
  if (!policy.ok) {
    return {
      ok: false,
      reason: policy.reason,
      detail: policy.detail,
    };
  }

  let runtimeEffectPlan = null;
  try {
    runtimeEffectPlan = buildRuntimeEffectPlanV1({
      modeId,
      profile: live.profile,
      actionPolicyDecision: policy.decision,
      includeV3LightShadow: true,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'RUNTIME_EFFECT_PLAN_FAILED',
      detail: error?.message || 'runtime effect plan failed',
      policyDecision: policy.decision,
    };
  }

  let templateEvidence = null;
  try {
    templateEvidence = await buildEvidenceFromProfile({
      profile: live.profile,
      siteKey,
      modeId,
      actionId,
      frameId,
      runtimeEffectPlan,
    });
  } catch {
    templateEvidence = null;
  }

  return {
    ok: true,
    version: LIVE_PERSONALIZATION_GATE_VERSION,
    frameId,
    runtimeEffectPlan,
    templateEvidence: templateEvidence || null,
    policyDecision: policy.decision,
    profileStats: live.profile.stats,
  };
}

export async function buildLiveTemplateEvidence({
  tabId,
  modeId,
  siteKey,
  budget,
  bridge,
  frameId = 0,
  timeoutMs,
} = {}) {
  const actionId = actionIdForMode(modeId);
  if (!actionId) {
    return { ok: false, reason: 'UNSUPPORTED_MODE' };
  }

  let live;
  try {
    live = await collectLiveProfile(tabId, { budget, bridge, frameId, timeoutMs });
  } catch (error) {
    return {
      ok: false,
      reason: 'PAGE_SIGNALS_COLLECT_FAILED',
      detail: error?.message || 'message failed',
    };
  }
  if (!live.ok) {
    return live;
  }

  const evidence = await buildEvidenceFromProfile({
    profile: live.profile,
    siteKey,
    modeId,
    actionId,
    frameId,
  });
  if (!evidence) {
    return { ok: false, reason: 'TEMPLATE_EVIDENCE_UNAVAILABLE' };
  }

  return {
    ok: true,
    version: LIVE_PERSONALIZATION_GATE_VERSION,
    frameId,
    evidence,
    profileStats: live.profile.stats,
  };
}
