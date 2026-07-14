import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { STORAGE_KEYS } from '../../shared/constants.js';
import { DATA_PORTABILITY_SCHEMA_VERSION } from '../../shared/data-portability.js';
import { launchWithExtension } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

async function openExtensionPage(context, extensionId, relativePath = 'welcome/welcome.html') {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

function uploadJson(page, payload) {
  return page.locator('#import-file').setInputFiles({
    name: 'aura-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
}

test.describe('Options data management in real MV3', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    ({ context, extensionId } = await launchWithExtension({ extensionPath, headless: true }));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    const page = await openExtensionPage(context, extensionId);
    await page.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    });
    await page.close();
  });

  test('exports the real supported payload and excludes session data', async () => {
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-data');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await expect(page.locator('input[name="banner-position"][value="top"]')).toBeChecked();
      await page.evaluate(async ({ keys }) => {
        await chrome.storage.local.set({
          [keys.userPrefs]: { bannerPosition: 'bottom', reducedMotion: true },
          [keys.perDomainPrefs]: {},
          [keys.learningWeights]: {},
          [keys.cooldowns]: {},
          [keys.allowlist]: ['bank.co.ma'],
          [keys.denylist]: ['ads.example.com'],
          [keys.siteProfiles]: {},
          localOnlySecret: 'NOT_EXPORTED',
        });
        await chrome.storage.session.set({ sessionOnlySecret: 'NOT_EXPORTED' });
      }, {
        keys: {
          userPrefs: STORAGE_KEYS.USER_PREFS,
          perDomainPrefs: STORAGE_KEYS.PER_DOMAIN_PREFS,
          learningWeights: STORAGE_KEYS.LEARNING_WEIGHTS,
          cooldowns: STORAGE_KEYS.COOLDOWNS,
          allowlist: STORAGE_KEYS.ALLOWLIST,
          denylist: STORAGE_KEYS.DENYLIST,
          siteProfiles: STORAGE_KEYS.SITE_PROFILES,
        },
      });

      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-data').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^aura-export-\d{4}-\d{2}-\d{2}\.json$/);
      const downloadedPath = await download.path();
      const payload = JSON.parse(await fs.readFile(downloadedPath, 'utf8'));

      expect(payload.schemaVersion).toBe(DATA_PORTABILITY_SCHEMA_VERSION);
      expect(payload.userPrefs).toMatchObject({ bannerPosition: 'bottom', reducedMotion: true });
      expect(payload.allowlist).toEqual(['bank.co.ma']);
      expect(payload.denylist).toEqual(['ads.example.com']);
      expect(payload.localOnlySecret).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain('NOT_EXPORTED');
      await expect(page.locator('#status-data')).toContainText('Export created');
      await expect(page.locator('#section-data')).not.toHaveAttribute('aria-busy', 'true');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('imports a valid payload, refreshes the UI, and resets the file input', async () => {
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-data');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await uploadJson(page, {
        schemaVersion: DATA_PORTABILITY_SCHEMA_VERSION,
        userPrefs: {
          bannerPosition: 'bottom',
          displayDensity: 'compact',
          reducedMotion: true,
          highContrast: true,
          suggestionThreshold: 0.7,
          autoThreshold: 0.9,
          cooldownDuration: 43200000,
        },
        perDomainPrefs: {},
        learningWeights: {},
        cooldowns: {},
        allowlist: ['bank.co.ma'],
        denylist: ['ads.example.com'],
        siteProfiles: {},
      });

      await expect(page.locator('#status-data')).toContainText('Import complete');
      await expect(page.locator('input[name="banner-position"][value="bottom"]')).toBeChecked();
      await expect(page.locator('#allowlist-items')).toContainText('bank.co.ma');
      await expect(page.locator('#denylist-items')).toContainText('example.com');
      await expect(page.locator('#import-file')).toHaveValue('');
      const stored = await page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STORAGE_KEYS.USER_PREFS);
      expect(stored).toMatchObject({
        bannerPosition: 'bottom',
        displayDensity: 'compact',
        reducedMotion: true,
        highContrast: true,
        suggestionThreshold: 0.7,
        autoThreshold: 0.9,
        cooldownDuration: 43200000,
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('rejects an invalid payload without changing local or session storage', async () => {
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-data');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await expect(page.locator('input[name="banner-position"][value="top"]')).toBeChecked();
      const before = await page.evaluate(async ({ key }) => {
        await chrome.storage.local.set({
          [key]: { bannerPosition: 'top', preserved: true },
          untouchedLocal: { nested: ['keep'] },
        });
        await chrome.storage.session.set({ untouchedSession: { value: 42 } });
        return chrome.storage.local.get(null);
      }, { key: STORAGE_KEYS.USER_PREFS });

      await uploadJson(page, {
        schemaVersion: DATA_PORTABILITY_SCHEMA_VERSION,
        userPrefs: { smartScope: { enabled: true, perDomain: [] } },
      });

      await expect(page.locator('#status-data')).toContainText('Import failed');
      await expect(page.locator('#inline-status')).toContainText('Invalid SmartScope perDomain');
      await expect(page.locator('#import-file')).toHaveValue('');
      const after = await page.evaluate(async () => chrome.storage.local.get(null));
      expect(after).toEqual(before);
      const sessionSentinel = await page.evaluate(async () => (
        await chrome.storage.session.get('untouchedSession')
      ).untouchedSession);
      expect(sessionSentinel).toEqual({ value: 42 });
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('cancel performs no reset and a corrupt lifecycle journal fails closed', async () => {
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-data');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await expect(page.locator('input[name="banner-position"][value="top"]')).toBeChecked();
      const before = await page.evaluate(async ({ prefsKey, lifecycleKey }) => {
        await chrome.storage.local.set({ [prefsKey]: { bannerPosition: 'bottom' } });
        await chrome.storage.session.set({
          [lifecycleKey]: { schemaVersion: 999, tabs: {} },
          preservedSession: true,
        });
        return chrome.storage.local.get(null);
      }, {
        prefsKey: STORAGE_KEYS.USER_PREFS,
        lifecycleKey: STORAGE_KEYS.LIFECYCLE_JOURNAL_V1,
      });

      await page.locator('#reset-all-data').click();
      await expect(page.locator('#confirm-reset-all')).toBeVisible();
      await page.locator('#cancel-reset-all').click();
      await expect(page.locator('#confirm-reset-all')).toBeHidden();
      const afterCancel = await page.evaluate(async () => chrome.storage.local.get(null));
      expect(afterCancel).toEqual(before);

      await page.locator('#reset-all-data').click();
      await page.locator('#confirm-reset-all-btn').click();
      await expect(page.locator('#status-data')).toContainText('Reset failed');
      await expect(page.locator('#inline-status')).toContainText('RESET_LIFECYCLE_UNAVAILABLE');
      const afterFailure = await page.evaluate(async () => chrome.storage.local.get(null));
      expect(afterFailure).toEqual(before);
      const lifecycleAfterFailure = await page.evaluate(async (key) => (
        await chrome.storage.session.get(key)
      )[key], STORAGE_KEYS.LIFECYCLE_JOURNAL_V1);
      expect(lifecycleAfterFailure).toEqual({ schemaVersion: 999, tabs: {} });
      await expect(page.locator('#export-data')).toBeEnabled();
      await expect(page.locator('#section-data')).not.toHaveAttribute('aria-busy', 'true');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
