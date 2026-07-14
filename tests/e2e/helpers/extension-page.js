const EXTENSION_CONTROL_PAGE_PATH = 'welcome/welcome.html';

export async function setFeatureFlagsForTest(serviceWorker, overrides = {}) {
  await serviceWorker.evaluate(async (flags) => {
    const { featureFlags } = await chrome.storage.local.get('featureFlags');
    await chrome.storage.local.set({
      featureFlags: {
        ...(featureFlags || {}),
        ...flags,
      },
    });
  }, overrides);
}

export async function evaluateInExtensionPage(context, extensionId, fn, args = undefined) {
  if (!context || !extensionId) {
    throw new Error('evaluateInExtensionPage: context and extensionId are required');
  }

  const controlPage = await context.newPage();
  try {
    await controlPage.goto(`chrome-extension://${extensionId}/${EXTENSION_CONTROL_PAGE_PATH}`);
    return await controlPage.evaluate(fn, args);
  } finally {
    await controlPage.close().catch(() => {});
  }
}

export async function sendRuntimeMessageFromExtensionPage(context, extensionId, message) {
  return evaluateInExtensionPage(
    context,
    extensionId,
    async (payload) => chrome.runtime.sendMessage(payload),
    message,
  );
}

export async function getTabModeStateFromExtensionPage(context, extensionId, tabId, modeId) {
  return evaluateInExtensionPage(
    context,
    extensionId,
    async ({ id, mode }) => {
      const { tabState } = await chrome.storage.session.get('tabState');
      return tabState?.[id]?.[mode] || null;
    },
    { id: tabId, mode: modeId },
  );
}
