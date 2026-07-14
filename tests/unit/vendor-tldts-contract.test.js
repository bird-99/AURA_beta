import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const VERSION = '7.4.8';
const sourcePath = new URL('../../node_modules/tldts/dist/index.esm.min.js', import.meta.url);
const packageLicensePath = new URL('../../node_modules/tldts/LICENSE', import.meta.url);
const vendorPath = new URL('../../shared/vendor/tldts.esm.min.js', import.meta.url);
const licensePath = new URL('../../shared/vendor/tldts.LICENSE', import.meta.url);

test('vendored tldts module is regenerated exactly from the pinned package', async () => {
  const source = await readFile(sourcePath, 'utf8');
  const actual = await readFile(vendorPath, 'utf8');
  const withoutSourceMap = source.replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/u, '');
  const banner = [
    '// @ts-nocheck',
    `// Vendored from tldts ${VERSION} (MIT). See tldts.LICENSE.`,
    '',
  ].join('\n');
  const expected = `${banner}${withoutSourceMap}\n`;

  assert.equal(actual, expected);
  assert.doesNotMatch(actual, /sourceMappingURL/);
  assert.equal(await readFile(licensePath, 'utf8'), await readFile(packageLicensePath, 'utf8'));
});
