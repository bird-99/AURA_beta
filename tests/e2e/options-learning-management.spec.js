import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { LEARNING_STAGES, MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';
import { launchWithExtension } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

async function openExtensionPage(context, extensionId, relativePath = 'welcome/welcome.html') {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

function learningFixture() {
  return {
    'zeta.example': {
      [MODE_IDS.FOCUS]: {
        stage: LEARNING_STAGES.AUTO,
        weight: 0.75,
        decisionCount: 4,
        appliedEffectIds: ['focus-visibility'],
      },
      [MODE_IDS.COMFORT_VISUAL]: {
        stage: LEARNING_STAGES.ASSISTED,
        weight: -0.25,
        eligiblePositiveCount: 2,
      },
    },
    'alpha.example': {
      [MODE_IDS.FOCUS]: {
        stage: LEARNING_STAGES.MANUAL,
        weight: 0,
        lastDecision: 'ENABLED',
      },
    },
  };
}

function decisionFixture() {
  return {
    'alpha.example': {
      [MODE_IDS.FOCUS]: {
        decision: 'NOT_NOW',
        timestamp: 1710000000000,
      },
    },
    'zeta.example': {
      [MODE_IDS.FOCUS]: {
        decision: 'NOT_NOW',
        timestamp: 1710000000000,
      },
      [MODE_IDS.COMFORT_VISUAL]: {
        decision: 'ENABLED',
        timestamp: 1720000000000,
      },
    },
  };
}

async function seedLearning(context, extensionId) {
  const page = await openExtensionPage(context, extensionId);
  try {
    await page.evaluate(async ({ learningKey, decisionsKey, learning, decisions }) => {
      await chrome.storage.local.set({
        [learningKey]: learning,
        [decisionsKey]: decisions,
      });
    }, {
      learningKey: STORAGE_KEYS.LEARNING_WEIGHTS,
      decisionsKey: STORAGE_KEYS.PER_DOMAIN_PREFS,
      learning: learningFixture(),
      decisions: decisionFixture(),
    });
  } finally {
    await page.close();
  }
}

async function readLearning(page) {
  return page.evaluate(async (key) => (await chrome.storage.local.get(key))[key], STORAGE_KEYS.LEARNING_WEIGHTS);
}

test.describe('Options learning management in real MV3', () => {
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

  test('renders persisted rows and characterizes search states without test hooks', async () => {
    await seedLearning(context, extensionId);
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-learning');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const rows = page.locator('#learning-body tr:not(.empty-row)');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('td').nth(0)).toHaveText('alpha.example');
      await expect(rows.nth(0)).toContainText('focus');
      await expect(rows.nth(0)).toContainText(LEARNING_STAGES.MANUAL);
      await expect(rows.nth(0)).toContainText('0.00');
      await expect(rows.nth(0)).toContainText('NOT_NOW');
      await expect(rows.nth(1).locator('td').nth(0)).toHaveText('zeta.example');
      await expect(rows.nth(1).locator('td').nth(1)).toHaveText('comfort-visual, focus');
      await expect(rows.nth(1).locator('td').nth(2)).toHaveText('ASSISTED, AUTO');
      await expect(rows.nth(1).locator('td').nth(3)).toHaveText('-0.25, 0.75');
      await expect(rows.nth(1).locator('td').nth(4)).toContainText('ENABLED');

      const search = page.locator('#learning-search');
      await search.fill('ALPHA');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('alpha.example');

      await search.fill('missing');
      await expect(page.locator('#learning-body .empty-row')).toHaveText('No matching domains.');

      await search.fill('   ');
      await expect(rows).toHaveCount(2);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('cancels global and domain reset without changing storage', async () => {
    await seedLearning(context, extensionId);
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-learning');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const before = await readLearning(page);

      await page.locator('#reset-learning-all').click();
      await expect(page.locator('#confirm-reset-learning')).toBeVisible();
      await page.locator('#cancel-reset-learning').click();
      await expect(page.locator('#confirm-reset-learning')).toBeHidden();

      await page.locator('#learning-body tr', { hasText: 'alpha.example' }).getByRole('button', { name: 'Reset' }).click();
      await expect(page.locator('#confirm-reset-domain')).toBeVisible();
      await expect(page.locator('#learning-domain-confirmation-host > #confirm-reset-domain')).toHaveCount(1);
      await expect(page.locator('table #confirm-reset-domain')).toHaveCount(0);
      await page.locator('#confirm-reset-domain').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.locator('#confirm-reset-domain')).toHaveCount(0);

      expect(await readLearning(page)).toEqual(before);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('resets one domain exactly and preserves other domains across reload', async () => {
    await seedLearning(context, extensionId);
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-learning');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.locator('#learning-body tr', { hasText: 'zeta.example' }).getByRole('button', { name: 'Reset' }).click();
      await page.locator('#confirm-reset-domain').getByRole('button', { name: 'Confirm reset' }).click();
      await expect(page.locator('#status-learning')).toContainText('Learning reset');

      expect(await readLearning(page)).toEqual({
        'zeta.example': {
          [MODE_IDS.FOCUS]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
          [MODE_IDS.COMFORT_VISUAL]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
        },
        'alpha.example': learningFixture()['alpha.example'],
      });

      await page.reload();
      await expect(page.locator('#learning-body tr', { hasText: 'zeta.example' })).toContainText(LEARNING_STAGES.MANUAL);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('resets every existing domain and mode across reload', async () => {
    await seedLearning(context, extensionId);
    const page = await openExtensionPage(context, extensionId, 'options/options.html#section-learning');
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.locator('#reset-learning-all').click();
      await page.locator('#confirm-reset-learning-btn').click();
      await expect(page.locator('#status-learning')).toContainText('Learning reset');

      expect(await readLearning(page)).toEqual({
        'zeta.example': {
          [MODE_IDS.FOCUS]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
          [MODE_IDS.COMFORT_VISUAL]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
        },
        'alpha.example': {
          [MODE_IDS.FOCUS]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
        },
      });

      await page.reload();
      await expect(page.locator('#learning-body tr:not(.empty-row)')).toHaveCount(2);
      await expect(page.locator('#learning-body')).not.toContainText(LEARNING_STAGES.AUTO);
      await expect(page.locator('#learning-body')).not.toContainText(LEARNING_STAGES.ASSISTED);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('preserves a real cross-page mutation linearized after reset', async () => {
    await seedLearning(context, extensionId);
    const firstPage = await openExtensionPage(context, extensionId);
    const secondPage = await openExtensionPage(context, extensionId);
    const optionsPage = await openExtensionPage(context, extensionId, 'options/options.html#section-learning');
    const pageErrors = [];
    optionsPage.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await firstPage.evaluate(async ({ key, modeId, autoStage }) => {
        const { mutateLocalValue } = await import(chrome.runtime.getURL('shared/utils.js'));
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        globalThis.__auraLearningRace = { entered: false, release, promise: null };
        globalThis.__auraLearningRace.promise = mutateLocalValue(key, async (stored) => {
          globalThis.__auraLearningRace.entered = true;
          await gate;
          return {
            ...(stored || {}),
            'before.example': {
              [modeId]: { stage: autoStage, weight: 0.9, before: true },
            },
          };
        });
      }, {
        key: STORAGE_KEYS.LEARNING_WEIGHTS,
        modeId: MODE_IDS.FOCUS,
        autoStage: LEARNING_STAGES.AUTO,
      });
      await expect.poll(() => firstPage.evaluate(() => globalThis.__auraLearningRace?.entered === true)).toBe(true);

      await optionsPage.locator('#reset-learning-all').click();
      await optionsPage.locator('#confirm-reset-learning-btn').click();
      await expect(optionsPage.locator('#section-learning')).toHaveAttribute('aria-busy', 'true');
      await expect(optionsPage.locator('#reset-learning-all')).toBeDisabled();

      const laterMutation = secondPage.evaluate(async ({ key, modeId }) => {
        const { mutateLocalValue } = await import(chrome.runtime.getURL('shared/utils.js'));
        return mutateLocalValue(key, (stored) => ({
          ...(stored || {}),
          'after.example': {
            [modeId]: { stage: 'AUTO', weight: 0.8, after: true },
          },
        }));
      }, { key: STORAGE_KEYS.LEARNING_WEIGHTS, modeId: MODE_IDS.FOCUS });

      await firstPage.evaluate(() => globalThis.__auraLearningRace.release());
      await Promise.all([
        firstPage.evaluate(() => globalThis.__auraLearningRace.promise),
        laterMutation,
      ]);
      await expect(optionsPage.locator('#status-learning')).toContainText('Learning reset');
      await expect(optionsPage.locator('#section-learning')).not.toHaveAttribute('aria-busy', 'true');

      const stored = await readLearning(optionsPage);
      expect(stored['before.example']).toEqual({
        [MODE_IDS.FOCUS]: { stage: LEARNING_STAGES.MANUAL, weight: 0 },
      });
      expect(stored['after.example']).toEqual({
        [MODE_IDS.FOCUS]: { stage: 'AUTO', weight: 0.8, after: true },
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await firstPage.close();
      await secondPage.close();
      await optionsPage.close();
    }
  });
});
