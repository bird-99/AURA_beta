import { getAllFlags, initFeatureFlags } from '../shared/feature-flags.js';

export const FEATURE_FLAGS_REQUEST_TYPE = 'AURA_GET_FEATURE_FLAGS_V1';

export async function handleGetFeatureFlagsRequest({
  init = initFeatureFlags,
  getAll = getAllFlags,
} = {}) {
  try {
    await init();
    const flags = getAll();
    return { ok: true, flags };
  } catch (error) {
    return { ok: false, reason: 'SW_ERROR' };
  }
}
