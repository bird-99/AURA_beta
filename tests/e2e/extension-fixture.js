import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { chromium } from '@playwright/test';

/**
 * @typedef {Object} ExtensionTestContext
 * @property {import('@playwright/test').BrowserContext} context
 * @property {string} extensionId
 * @property {string} userDataDir
 */

/**
 * Launches a persistent Chromium context with the extension loaded and returns the
 * context plus the resolved extension ID.
 *
 * @param {{ extensionPath: string; headless?: boolean }} params
 * @returns {Promise<ExtensionTestContext>}
 */
export async function launchWithExtension(params) {
  const extensionPath = path.resolve(params.extensionPath);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aura-playwright-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: params.headless ?? true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = new URL(serviceWorker.url()).host;

  return { context, extensionId, userDataDir };
}

/**
 * Opens a chrome-extension:// page for the given path.
 *
 * @param {ExtensionTestContext} ctx
 * @param {string} relativePath
 */
export async function openExtensionPage(ctx, relativePath) {
  const page = await ctx.context.newPage();
  await page.goto(`chrome-extension://${ctx.extensionId}/${relativePath}`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/**
 * Closes the Playwright context and cleans up the temporary user data directory.
 *
 * @param {ExtensionTestContext | undefined} ctx
 */
export async function closeExtension(ctx) {
  if (!ctx) return;
  await ctx.context.close();
  if (ctx.userDataDir) {
    await fs.rm(ctx.userDataDir, { recursive: true, force: true });
  }
}
