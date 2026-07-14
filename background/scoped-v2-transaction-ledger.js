export const SCOPED_V2_TRANSACTION_PHASES = Object.freeze({
  PENDING_APPLY: 'PENDING_APPLY',
  TOKENS_APPLIED: 'TOKENS_APPLIED',
  CSS_INSERTED: 'CSS_INSERTED',
  CSS_REGISTERED: 'CSS_REGISTERED',
  INSPECTING: 'INSPECTING',
  ACTIVE: 'ACTIVE',
  ROLLED_BACK: 'ROLLED_BACK',
});

const transactions = new Map();

function normalizeFrameId(frameId) {
  return typeof frameId === 'number' && Number.isFinite(frameId) ? frameId : 0;
}

function makeTransactionKey({ tabId, frameId = 0, modeId, attemptId }) {
  return `${tabId}:${normalizeFrameId(frameId)}:${modeId}:${attemptId}`;
}

function cloneDetails(value = {}) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...value };
}

export function beginScopedV2Transaction({ tabId, frameId = 0, modeId, attemptId, scopeSelector = '' } = {}) {
  const key = makeTransactionKey({ tabId, frameId, modeId, attemptId });
  const transaction = {
    key,
    tabId,
    frameId: normalizeFrameId(frameId),
    modeId,
    attemptId,
    phase: SCOPED_V2_TRANSACTION_PHASES.PENDING_APPLY,
    scopeSelector,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  transactions.set(key, transaction);
  return { ...transaction };
}

export function advanceScopedV2Transaction(transactionOrKey, phase, details = {}) {
  const key = typeof transactionOrKey === 'string' ? transactionOrKey : transactionOrKey?.key;
  if (!key || !transactions.has(key)) {
    return null;
  }

  const current = transactions.get(key);
  const next = {
    ...current,
    ...cloneDetails(details),
    phase,
    updatedAt: Date.now(),
  };
  transactions.set(key, next);
  return { ...next };
}

export function getScopedV2Transaction(transactionOrKey) {
  const key = typeof transactionOrKey === 'string' ? transactionOrKey : transactionOrKey?.key;
  if (!key || !transactions.has(key)) {
    return null;
  }
  return { ...transactions.get(key) };
}

export function completeScopedV2Transaction(transactionOrKey, phase, details = {}) {
  const key = typeof transactionOrKey === 'string' ? transactionOrKey : transactionOrKey?.key;
  if (!key || !transactions.has(key)) {
    return null;
  }

  const current = transactions.get(key);
  const completed = {
    ...current,
    ...cloneDetails(details),
    phase,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
  transactions.delete(key);
  return { ...completed };
}

export function clearScopedV2TransactionsForTests() {
  transactions.clear();
}
