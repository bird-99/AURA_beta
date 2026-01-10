import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';

const forbiddenImportRegex = /import\(\s*(?:safeGetURL|chrome\.runtime\.getURL)\(\s*['"]shared\//g;

test('content scripts must not dynamically import shared modules via extension URLs', async () => {
  const contentDir = path.join(process.cwd(), 'content');
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  const scriptFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(contentDir, entry.name));

  const violations = [];

  for (const scriptPath of scriptFiles) {
    const source = await fs.readFile(scriptPath, 'utf8');
    const matches = source.match(forbiddenImportRegex);
    if (matches) {
      violations.push({
        file: path.relative(process.cwd(), scriptPath),
        occurrences: matches.length,
      });
    }
  }

  if (violations.length > 0) {
    const details = violations
      .map(({ file, occurrences }) => `- ${file} (${occurrences})`)
      .join('\n');
    assert.fail(`Forbidden shared URL dynamic import detected:\n${details}`);
  }
});
