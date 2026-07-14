import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_VERSION = '7.4.8';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(repositoryRoot, 'node_modules', 'tldts');
const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));

if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`Expected tldts ${EXPECTED_VERSION}, received ${packageJson.version || 'unknown'}`);
}

const destinationDirectory = resolve(repositoryRoot, 'shared', 'vendor');
const destination = resolve(destinationDirectory, 'tldts.esm.min.js');
const source = await readFile(resolve(packageRoot, 'dist', 'index.esm.min.js'), 'utf8');
const withoutSourceMap = source.replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/u, '');
const banner = [
  '// @ts-nocheck',
  `// Vendored from tldts ${EXPECTED_VERSION} (MIT). See tldts.LICENSE.`,
  '',
].join('\n');

await mkdir(destinationDirectory, { recursive: true });
await writeFile(destination, `${banner}${withoutSourceMap}\n`, 'utf8');
await copyFile(resolve(packageRoot, 'LICENSE'), resolve(destinationDirectory, 'tldts.LICENSE'));
