const defaultResult = {
  ok: false,
  scopeEl: null,
  branch: 'NONE',
  score: 0,
  metrics: { elapsedMs: 0 },
  reasons: [{ code: 'NO_SCOPE' }],
  stats: { elapsedMs: 0, budgetMs: 0, candidatesSeen: 0, nodesScanned: 0 },
};

const state = { currentResult: { ...defaultResult } };

export function setSmartScopeResult(result) {
  state.currentResult = result || { ...defaultResult };
}

export async function detectScopeRootV2() {
  return state.currentResult;
}

export async function detectSmartScopeV2() {
  return detectScopeRootV2();
}

export default detectScopeRootV2;
