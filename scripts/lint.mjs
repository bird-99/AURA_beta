import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INCLUDE_DIRS = ['background', 'content', 'options', 'popup', 'scripts', 'shared', 'tests', 'welcome'];
const INCLUDE_FILES = ['playwright.config.js'];
const EXTENSIONS = new Set(['.js', '.mjs']);

function hasLintableExtension(fileName) {
  return [...EXTENSIONS].some((extension) => fileName.endsWith(extension));
}

function collectFiles(dir, files = []) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      collectFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && hasLintableExtension(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = [
  ...INCLUDE_FILES.map((file) => join(ROOT, file)).filter((file) => existsSync(file)),
  ...INCLUDE_DIRS.flatMap((dir) => collectFiles(join(ROOT, dir))),
].sort();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failures.push({
      file: relative(ROOT, file),
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    });
  }
}

if (failures.length > 0) {
  console.error(`Syntax check failed for ${failures.length} file(s):`);
  for (const failure of failures) {
    console.error(`\n${failure.file}`);
    console.error(failure.output);
  }
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} file(s).`);
