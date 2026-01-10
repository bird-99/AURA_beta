import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { expectNoCriticalA11yViolations } from './helpers/a11y-assertions.js';
import { launchWithExtension } from './helpers/launch-with-extension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');

let context;
let extensionId;
let page;

test.describe('Popup accessibility', () => {
  test.beforeAll(async () => {
    ({ context, extensionId } = await launchWithExtension({
      extensionPath,
      headless: true,
      verbose: !!process.env.CI,
    }));

    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.getByTestId('popup-root').waitFor();
    await page.getByRole('heading', { name: 'AURA' }).waitFor();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('has no critical accessibility issues', async () => {
    await expectNoCriticalA11yViolations(page);
  });
});
