import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

import { MODE_IDS, STORAGE_KEYS } from '../../shared/constants.js';
import { PROFILE_ACTIONS, PROFILE_MATCH_TYPES } from '../../shared/site-profiles.js';
import { launchWithExtension } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

async function openExtensionPage(context, extensionId, relativePath = 'options/options.html#section-domains') {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  await expect(page.locator('#allowlist-items .list-item')).toHaveCount(1);
  await expect(page.locator('#debug-snapshot-refresh')).toBeDisabled();
  return page;
}

async function readLocal(page, keys) {
  return page.evaluate(async (requestedKeys) => chrome.storage.local.get(requestedKeys), keys);
}

async function addDomain(page, kind, value) {
  await page.locator(`#${kind}list-input`).fill(value);
  await page.locator(`#add-${kind}`).click();
}

async function saveProfile(page, { target, modeId, action }) {
  await page.locator('#site-profile-target').fill(target);
  await page.locator('#site-profile-mode').selectOption(modeId);
  await page.locator('#site-profile-action').selectOption(action);
  await page.locator('#site-profile-save').click();
}

async function fillLocalStorageToQuota(page) {
  return page.evaluate(async () => {
    const quota = chrome.storage.local.QUOTA_BYTES;
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ quotaBase: 'x'.repeat(quota - 2048) });

    let low = 0;
    let high = 2048;
    while (low + 1 < high) {
      const candidate = Math.floor((low + high) / 2);
      try {
        await chrome.storage.local.set({ quotaEdge: 'y'.repeat(candidate) });
        low = candidate;
      } catch {
        high = candidate;
      }
    }
    await chrome.storage.local.set({ quotaEdge: 'y'.repeat(low) });
    return {
      quota,
      used: await chrome.storage.local.getBytesInUse(null),
    };
  });
}

test.describe('Options domain configuration in real MV3', () => {
  let context;
  let extensionId;

  test.beforeAll(async () => {
    ({ context, extensionId } = await launchWithExtension({ extensionPath, headless: true }));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test.beforeEach(async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/welcome/welcome.html`);
    await page.evaluate(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    });
    await page.close();
  });

  test('adds, de-duplicates, searches, removes and reloads real allowlist and denylist state', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      await addDomain(page, 'allow', 'WWW.Example.COM');
      await expect(page.locator('#allowlist-items .list-item span')).toHaveText(['example.com']);
      await addDomain(page, 'allow', 'example.com');
      await expect(page.locator('#status-domains')).toContainText('Domain already in allowlist');
      await expect(page.locator('#allowlist-items .list-item')).toHaveCount(1);

      await addDomain(page, 'allow', 'zeta.example');
      await expect.poll(async () => (await readLocal(page, STORAGE_KEYS.ALLOWLIST))[STORAGE_KEYS.ALLOWLIST]).toEqual([
        'example.com',
        'zeta.example',
      ]);

      await page.locator('#allowlist-search').fill('ZETA');
      await expect(page.locator('#allowlist-items .list-item', { hasText: 'example.com' })).toBeHidden();
      await expect(page.locator('#allowlist-items .list-item', { hasText: 'zeta.example' })).toBeVisible();
      await page.locator('#allowlist-search').fill('missing');
      await expect(page.locator('#allowlist-items .list-item:visible')).toHaveCount(0);
      await page.locator('#allowlist-search').fill('');

      await addDomain(page, 'deny', 'example.com');
      await expect.poll(async () => (await readLocal(page, STORAGE_KEYS.DENYLIST))[STORAGE_KEYS.DENYLIST]).toEqual([
        'example.com',
      ]);
      await expect(page.locator('#status-domains')).toContainText('Denylist updated');
      expect(await readLocal(page, [STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST])).toEqual({
        [STORAGE_KEYS.ALLOWLIST]: ['zeta.example'],
        [STORAGE_KEYS.DENYLIST]: ['example.com'],
      });

      await page.locator('#allowlist-items .list-item', { hasText: 'zeta.example' }).getByRole('button', { name: 'Remove' }).click();
      await expect.poll(async () => (await readLocal(page, STORAGE_KEYS.ALLOWLIST))[STORAGE_KEYS.ALLOWLIST]).toEqual([
      ]);
      await page.reload();
      await expect(page.locator('#allowlist-items .list-item')).toHaveText('No domains');
      await expect(page.locator('#denylist-items .list-item span')).toHaveText(['example.com']);
      expect(await readLocal(page, [STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST])).toEqual({
        [STORAGE_KEYS.ALLOWLIST]: [],
        [STORAGE_KEYS.DENYLIST]: ['example.com'],
      });
    } finally {
      await page.close();
    }
  });

  test('rejects invalid list input without creating storage state', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      for (const input of ['', 'co.ma', 'com.br', 'github.io', 'https://bank.co.ma', 'bank.co.ma/login']) {
        await addDomain(page, 'allow', input);
        await expect(page.locator('#status-domains')).toHaveClass(/status-error/);
      }
      expect(await readLocal(page, [STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST])).toEqual({});
    } finally {
      await page.close();
    }
  });

  test('preserves concurrent stale-page list mutations and resolves conflicts atomically', async () => {
    const first = await openExtensionPage(context, extensionId);
    const second = await openExtensionPage(context, extensionId);
    try {
      await first.locator('#allowlist-input').fill('alpha.example');
      await second.locator('#allowlist-input').fill('beta.example');
      await Promise.all([
        first.locator('#add-allow').click(),
        second.locator('#add-allow').click(),
      ]);
      await expect.poll(async () => (
        await readLocal(first, STORAGE_KEYS.ALLOWLIST)
      )[STORAGE_KEYS.ALLOWLIST]).toEqual(['alpha.example', 'beta.example']);

      await addDomain(first, 'allow', 'conflict.example');
      await expect.poll(async () => (
        await readLocal(first, STORAGE_KEYS.ALLOWLIST)
      )[STORAGE_KEYS.ALLOWLIST]).toEqual(['alpha.example', 'beta.example', 'conflict.example']);
      await addDomain(second, 'deny', 'conflict.example');
      await expect.poll(async () => readLocal(first, [STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST])).toEqual({
        [STORAGE_KEYS.ALLOWLIST]: ['alpha.example', 'beta.example'],
        [STORAGE_KEYS.DENYLIST]: ['conflict.example'],
      });

      await first.reload();
      await expect(first.locator('#allowlist-items .list-item span')).toHaveText(['alpha.example', 'beta.example']);
      await expect(first.locator('#denylist-items .list-item span')).toHaveText(['conflict.example']);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('creates, updates and removes real site profiles for both modes and all actions', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      await saveProfile(page, {
        target: 'bank.co.ma',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.ALWAYS,
      });
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
      )).toBe(1);
      await saveProfile(page, {
        target: 'secure.example.com',
        modeId: MODE_IDS.FOCUS,
        action: PROFILE_ACTIONS.NEVER,
      });
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
      )).toBe(2);
      await saveProfile(page, {
        target: '*.example.com',
        modeId: MODE_IDS.FOCUS,
        action: PROFILE_ACTIONS.ALWAYS,
      });
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
      )).toBe(3);

      let stored = (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
      expect(stored.entries).toHaveLength(3);
      expect(stored.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          value: 'bank.co.ma',
          matchType: PROFILE_MATCH_TYPES.DOMAIN,
          modeId: MODE_IDS.COMFORT_VISUAL,
          action: PROFILE_ACTIONS.ALWAYS,
        }),
        expect.objectContaining({
          value: 'secure.example.com',
          matchType: PROFILE_MATCH_TYPES.HOSTNAME,
          modeId: MODE_IDS.FOCUS,
          action: PROFILE_ACTIONS.NEVER,
        }),
        expect.objectContaining({
          value: '*.example.com',
          matchType: PROFILE_MATCH_TYPES.PATTERN,
          modeId: MODE_IDS.FOCUS,
          action: PROFILE_ACTIONS.ALWAYS,
        }),
      ]));

      const originalBank = stored.entries.find((entry) => entry.value === 'bank.co.ma');
      await saveProfile(page, {
        target: 'bank.co.ma',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.NEVER,
      });
      await expect.poll(async () => {
        const profiles = (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
        return profiles?.entries?.find((entry) => entry.value === 'bank.co.ma')?.action;
      }).toBe(PROFILE_ACTIONS.NEVER);
      stored = (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
      const updatedBank = stored.entries.find((entry) => entry.value === 'bank.co.ma');
      expect(updatedBank.id).toBe(originalBank.id);
      expect(updatedBank.action).toBe(PROFILE_ACTIONS.NEVER);
      expect(stored.entries).toHaveLength(3);

      await saveProfile(page, {
        target: 'bank.co.ma',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.ASK,
      });
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
      )).toBe(2);
      await page.locator('#site-profile-list .list-item', { hasText: 'secure.example.com' }).getByRole('button', { name: 'Remove' }).click();
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
      )).toBe(1);
      await page.reload();

      await expect(page.locator('#site-profile-list .list-item')).toHaveCount(1);
      await expect(page.locator('#site-profile-list .list-item')).toContainText('*.example.com');
      stored = (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
      expect(stored.entries).toHaveLength(1);
      expect(stored.entries[0]).toEqual(expect.objectContaining({
        action: PROFILE_ACTIONS.ALWAYS,
        matchType: PROFILE_MATCH_TYPES.PATTERN,
        modeId: MODE_IDS.FOCUS,
        value: '*.example.com',
      }));
    } finally {
      await page.close();
    }
  });

  test('preserves concurrent stale-page profile mutations and authoritative profile identity', async () => {
    const first = await openExtensionPage(context, extensionId);
    const second = await openExtensionPage(context, extensionId);
    try {
      await Promise.all([
        saveProfile(first, {
          target: 'alpha.example',
          modeId: MODE_IDS.COMFORT_VISUAL,
          action: PROFILE_ACTIONS.ALWAYS,
        }),
        saveProfile(second, {
          target: 'beta.example',
          modeId: MODE_IDS.FOCUS,
          action: PROFILE_ACTIONS.NEVER,
        }),
      ]);
      await expect.poll(async () => (
        (await readLocal(first, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries
          ?.map((entry) => entry.value)
          .sort()
      )).toEqual(['alpha.example', 'beta.example']);

      await saveProfile(first, {
        target: 'conflict.example',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.ALWAYS,
      });
      await expect.poll(async () => {
        const stored = (await readLocal(first, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
        return stored?.entries?.some((entry) => entry.value === 'conflict.example');
      }).toBe(true);
      const before = (await readLocal(first, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
      const stableId = before.entries.find((entry) => entry.value === 'conflict.example').id;
      await saveProfile(second, {
        target: 'conflict.example',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.NEVER,
      });
      await expect.poll(async () => {
        const stored = (await readLocal(first, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
        return stored?.entries?.find((entry) => entry.value === 'conflict.example');
      }).toEqual(expect.objectContaining({
        id: stableId,
        action: PROFILE_ACTIONS.NEVER,
      }));
      const stored = (await readLocal(first, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES];
      expect(stored.entries).toHaveLength(3);
      expect(stored.entries.map((entry) => entry.value).sort()).toEqual([
        'alpha.example',
        'beta.example',
        'conflict.example',
      ]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('removes a persisted legacy site profile without an id', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      await page.evaluate(async ({ key, modeId, action }) => {
        await chrome.storage.local.set({
          [key]: {
            version: 1,
            entries: [{
              action,
              matchType: 'hostname',
              modeId,
              value: 'legacy.example.com',
            }],
          },
        });
      }, {
        key: STORAGE_KEYS.SITE_PROFILES,
        modeId: MODE_IDS.FOCUS,
        action: PROFILE_ACTIONS.NEVER,
      });
      await page.reload();
      const legacyRow = page.locator('#site-profile-list .list-item', { hasText: 'legacy.example.com' });
      await expect(legacyRow).toBeVisible();
      await legacyRow.getByRole('button', { name: 'Remove' }).click();
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries
      )).toEqual([]);
      await expect(page.locator('#status-domains')).toContainText('Site override removed');
    } finally {
      await page.close();
    }
  });

  test('rejects unsafe profile targets and accepts precise PSL targets', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      for (const target of [
        'co.ma',
        'com.br',
        'github.io',
        '*',
        '*.co.ma',
        'javascript:*',
        'https://bank.co.ma',
        'bank.co.ma/login',
      ]) {
        await saveProfile(page, {
          target,
          modeId: MODE_IDS.FOCUS,
          action: PROFILE_ACTIONS.ALWAYS,
        });
        await expect(page.locator('#site-profile-feedback')).toHaveText('Invalid domain or pattern');
      }
      expect(await readLocal(page, STORAGE_KEYS.SITE_PROFILES)).toEqual({});

      const preciseTargets = ['bank.co.ma', 'shop.co.ma', 'alice.github.io', '*.example.com'];
      for (const [index, target] of preciseTargets.entries()) {
        await saveProfile(page, {
          target,
          modeId: MODE_IDS.FOCUS,
          action: PROFILE_ACTIONS.NEVER,
        });
        await expect.poll(async () => (
          (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries?.length
        )).toBe(index + 1);
      }
      await expect.poll(async () => (
        (await readLocal(page, STORAGE_KEYS.SITE_PROFILES))[STORAGE_KEYS.SITE_PROFILES]?.entries
          ?.map((entry) => entry.value)
          .sort()
      )).toEqual(['*.example.com', 'alice.github.io', 'bank.co.ma', 'shop.co.ma']);
    } finally {
      await page.close();
    }
  });

  test('does not report or persist list success when real Chrome Storage rejects the write', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      const pressure = await fillLocalStorageToQuota(page);
      expect(pressure.used).toBeLessThanOrEqual(pressure.quota);
      expect(pressure.quota - pressure.used).toBeLessThan(32);
      const probeRejected = await page.evaluate(async () => {
        try {
          await chrome.storage.local.set({ quotaProbe: 'probe' });
          return false;
        } catch {
          return true;
        }
      });
      expect(probeRejected).toBe(true);

      await addDomain(page, 'allow', 'failure.example');
      await expect.poll(async () => readLocal(page, [STORAGE_KEYS.ALLOWLIST, STORAGE_KEYS.DENYLIST])).toEqual({});
      await expect(page.locator('#status-domains')).not.toContainText('Allowlist updated');
      await expect(page.locator('#status-domains')).toHaveClass(/status-error/);
    } finally {
      await page.close();
    }
  });

  test('does not report profile success or reset the form when real Chrome Storage rejects the write', async () => {
    const page = await openExtensionPage(context, extensionId);
    try {
      const pressure = await fillLocalStorageToQuota(page);
      expect(pressure.quota - pressure.used).toBeLessThan(32);

      await saveProfile(page, {
        target: 'failure.example',
        modeId: MODE_IDS.COMFORT_VISUAL,
        action: PROFILE_ACTIONS.ALWAYS,
      });
      await expect.poll(async () => readLocal(page, STORAGE_KEYS.SITE_PROFILES)).toEqual({});
      await expect(page.locator('#status-domains')).not.toContainText('Site overrides saved');
      await expect(page.locator('#status-domains')).toHaveClass(/status-error/);
      await expect(page.locator('#site-profile-target')).toHaveValue('failure.example');
      await expect(page.locator('#site-profile-action')).toHaveValue(PROFILE_ACTIONS.ALWAYS);
    } finally {
      await page.close();
    }
  });
});
