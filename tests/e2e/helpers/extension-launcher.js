import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const SERVICE_WORKER_TIMEOUT_MS = 20000;
const LAUNCH_ATTEMPTS = 3;

export async function launchWithExtension({
  extensionPath,
  headless = true,
  slowMoMs,
  verbose = false,
  userDataDir: requestedUserDataDir = null,
  preserveUserDataDir = false,
}) {
  if (!extensionPath) {
    throw new Error('launchWithExtension: extensionPath is required');
  }

  const resolvedExtensionPath = path.resolve(extensionPath);
  const manifestPath = path.join(resolvedExtensionPath, 'manifest.json');

  try {
    await fs.access(manifestPath);
  } catch (error) {
    throw new Error(`launchWithExtension: manifest.json not found at ${manifestPath}`);
  }

  const args = [
    `--disable-extensions-except=${resolvedExtensionPath}`,
    `--load-extension=${resolvedExtensionPath}`,
  ];

  let lastError;

  for (let attempt = 1; attempt <= LAUNCH_ATTEMPTS; attempt += 1) {
    const userDataDir = requestedUserDataDir || await fs.mkdtemp(path.join(tmpdir(), 'aura-playwright-'));
    const shouldRemoveUserDataDir = preserveUserDataDir !== true;
    let context;

    if (verbose) {
      console.log('[launchWithExtension] Using extension path:', resolvedExtensionPath);
      console.log('[launchWithExtension] Headless:', headless);
      console.log('[launchWithExtension] Channel: chromium');
      console.log('[launchWithExtension] Attempt:', attempt);
      console.log('[launchWithExtension] Args:', args.join(' '));
    }

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        channel: 'chromium',
        args,
        slowMo: slowMoMs,
        reducedMotion: 'reduce',
      });

      let worker = context.serviceWorkers()[0];
      if (!worker) {
        if (verbose) {
          console.log('[launchWithExtension] Waiting for extension service worker...');
        }

        try {
          worker = await context.waitForEvent('serviceworker', { timeout: SERVICE_WORKER_TIMEOUT_MS });
        } catch (error) {
          worker = context.serviceWorkers()[0];
          if (!worker) {
            throw new Error(`launchWithExtension: service worker not detected within ${SERVICE_WORKER_TIMEOUT_MS}ms`);
          }
        }
      }

      const workerUrl = worker.url();
      const [, , extensionId] = workerUrl.split('/');

      if (!extensionId) {
        throw new Error(`launchWithExtension: could not determine extensionId from service worker URL (${workerUrl})`);
      }

      if (verbose) {
        console.log('[launchWithExtension] Extension ID:', extensionId);
      }

      const closeContext = context.close.bind(context);
      let closed = false;
      context.close = async (...closeArgs) => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          return await closeContext(...closeArgs);
        } finally {
          if (shouldRemoveUserDataDir) {
            await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      };

      return { context, extensionId, userDataDir };
    } catch (error) {
      lastError = error;
      await context?.close().catch(() => {});
      if (shouldRemoveUserDataDir) {
        await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      }

      if (verbose && attempt < LAUNCH_ATTEMPTS) {
        console.log('[launchWithExtension] Retrying after launch failure:', error?.message || error);
      }
    }
  }

  throw lastError || new Error('launchWithExtension: failed to launch extension context');
}
