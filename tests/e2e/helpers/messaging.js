export async function sendMessageToTab(serviceWorker, tabId, message, options = undefined) {
  if (!serviceWorker || typeof tabId !== 'number') {
    throw new Error('sendMessageToTab: serviceWorker and numeric tabId are required');
  }

  return serviceWorker.evaluate(async ({ id, payload, sendOptions }) => {
    try {
      return sendOptions
        ? await chrome.tabs.sendMessage(id, payload, sendOptions)
        : await chrome.tabs.sendMessage(id, payload);
    } catch (error) {
      return { ok: false, error: { message: error?.message || 'send failed' } };
    }
  }, { id: tabId, payload: message, sendOptions: options });
}
