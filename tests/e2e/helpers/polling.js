export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(check, { timeoutMs = 10000, intervalMs = 100, label = 'condition' } = {}) {
  const start = Date.now();
  let lastValue = null;

  while (Date.now() - start < timeoutMs) {
    lastValue = await check();
    if (lastValue) {
      return lastValue;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}
