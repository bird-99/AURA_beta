const ALLOWED_CHECKPOINTS = new Set([
  'TOKENS_DONE',
  'CSS_INSERT_DONE',
  'REGISTRY_DONE',
  'STATE_COMMITTED',
  'CSS_REMOVE_DONE',
]);

let armedPause = null;
let reachedPause = null;

export function armLifecyclePause({ tabId, checkpoint } = {}) {
  if (!Number.isInteger(tabId) || !ALLOWED_CHECKPOINTS.has(checkpoint)) {
    return { ok: false, error: 'INVALID_LIFECYCLE_PAUSE' };
  }
  armedPause = { tabId, checkpoint };
  reachedPause = null;
  return { ok: true, armed: { ...armedPause } };
}

export function getLifecyclePauseState() {
  return {
    ok: true,
    armed: armedPause ? { ...armedPause } : null,
    reached: reachedPause ? { ...reachedPause } : null,
  };
}

export async function maybePauseLifecycleCheckpoint(tabId, checkpoint) {
  if (!armedPause || armedPause.tabId !== tabId || armedPause.checkpoint !== checkpoint) return;
  reachedPause = { tabId, checkpoint, reachedAt: Date.now() };
  armedPause = null;
  await new Promise(() => {});
}

export function clearLifecyclePauseForTests() {
  armedPause = null;
  reachedPause = null;
}
