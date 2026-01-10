# Handling invalid extension context during bootstrap

## Where to look
- Open **chrome://extensions** and click **Inspect views: service worker** to inspect the MV3 background context devtools.
- Content script logs (including the bootstrap abort warning when debug is enabled) appear in the target page DevTools console.

## Quick verification
1. Load three arbitrary tabs and confirm there are no `chrome-extension://invalid` fetch/import errors in the console.
2. Temporarily simulate an invalid context (e.g., disable/reload the extension) and reload the page.
3. With the debug flag enabled, check the page console for a single `[AURA][BOOT] aborted` warning containing the reason and current `location.href`.
