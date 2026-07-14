const tabLifecycleTails = new Map();
const tabLifecycleSequences = new Map();
let globalLifecycleTail = Promise.resolve();
let activeGlobalBarrier = Promise.resolve();

function nextSequence(tabId) {
  const sequence = (tabLifecycleSequences.get(tabId) || 0) + 1;
  tabLifecycleSequences.set(tabId, sequence);
  return sequence;
}

function validateTabLifecycleOperation(tabId, operation) {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
    throw new TypeError('A numeric tabId is required');
  }
  if (typeof operation !== 'function') {
    throw new TypeError('A lifecycle operation callback is required');
  }
}

function createTabOperation(tabId, kind, operation, previousTail, barrier) {
  const sequence = nextSequence(tabId);
  const context = Object.freeze({
    tabId,
    kind: typeof kind === 'string' ? kind : 'unknown',
    sequence,
    isCurrent: () => tabLifecycleSequences.get(tabId) === sequence,
  });
  return Promise.all([
    previousTail.catch(() => undefined),
    barrier.catch(() => undefined),
  ]).then(() => operation(context));
}

export function runTabLifecycleOperation(tabId, kind, operation) {
  try {
    validateTabLifecycleOperation(tabId, operation);
  } catch (error) {
    return Promise.reject(error);
  }

  const previousTail = tabLifecycleTails.get(tabId) || Promise.resolve();
  const barrier = activeGlobalBarrier;
  const run = createTabOperation(tabId, kind, operation, previousTail, barrier);
  const settledTail = run.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    if (tabLifecycleTails.get(tabId) === settledTail) {
      tabLifecycleTails.delete(tabId);
    }
  });
  tabLifecycleTails.set(tabId, settledTail);
  return run;
}

export function runGlobalLifecycleOperation(kind, operation) {
  if (typeof operation !== 'function') {
    return Promise.reject(new TypeError('A global lifecycle operation callback is required'));
  }

  const previousGlobalTail = globalLifecycleTail;
  const previousBarrier = activeGlobalBarrier;
  const tabTailsBeforeBarrier = new Map(tabLifecycleTails);
  const internalTabTails = new Map();
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });

  activeGlobalBarrier = previousBarrier.catch(() => undefined).then(() => barrier);

  const context = Object.freeze({
    kind: typeof kind === 'string' ? kind : 'global',
    runTabOperation(tabId, tabKind, tabOperation) {
      try {
        validateTabLifecycleOperation(tabId, tabOperation);
      } catch (error) {
        return Promise.reject(error);
      }
      const previousTail = internalTabTails.get(tabId)
        || tabTailsBeforeBarrier.get(tabId)
        || Promise.resolve();
      const run = createTabOperation(
        tabId,
        tabKind,
        tabOperation,
        previousTail,
        Promise.resolve(),
      );
      internalTabTails.set(tabId, run.then(
        () => undefined,
        () => undefined,
      ));
      return run;
    },
  });

  const run = previousGlobalTail
    .catch(() => undefined)
    .then(() => previousBarrier.catch(() => undefined))
    .then(() => Promise.all(
      Array.from(tabTailsBeforeBarrier.values(), (tail) => tail.catch(() => undefined)),
    ))
    .then(() => operation(context))
    .finally(() => releaseBarrier());

  globalLifecycleTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getTabLifecycleSequence(tabId) {
  return tabLifecycleSequences.get(tabId) || 0;
}

export function clearTabLifecycleForTests() {
  tabLifecycleTails.clear();
  tabLifecycleSequences.clear();
  globalLifecycleTail = Promise.resolve();
  activeGlobalBarrier = Promise.resolve();
}
