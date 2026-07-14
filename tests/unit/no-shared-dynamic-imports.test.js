import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const filesToScan = [
  'background/css-applier.js',
  'content/content-bootstrap.runtime.js',
  'content/content-message-router.runtime.js',
  'content/spa-hooks-v2.runtime.js',
  'content/content-main.js',
].map((file) => path.join(process.cwd(), file));

const directSharedImportRegex = /import\(\s*chrome\.runtime\.getURL\(\s*['"]shared\//g;
const constantsUrlAssignmentRegex = /const\s+constantsUrl\s*=\s*chrome\.runtime\.getURL\(\s*['"]shared\//g;
const constantsUrlImportRegex = /import\(\s*constantsUrl\s*\)/g;

test('tab-context runtime files must not dynamically import shared modules', () => {
  const violations = [];

  for (const filePath of filesToScan) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);

    const directMatches = source.match(directSharedImportRegex);
    if (directMatches) {
      violations.push(`${relativePath} contains direct shared dynamic import (${directMatches.length}).`);
    }

    const assignsConstantsUrl = constantsUrlAssignmentRegex.test(source);
    const importsConstantsUrl = constantsUrlImportRegex.test(source);
    if (assignsConstantsUrl && importsConstantsUrl) {
      violations.push(`${relativePath} imports constantsUrl pointing at shared modules.`);
    }
  }

  if (violations.length > 0) {
    assert.fail(`Forbidden shared dynamic import patterns detected:\n${violations.join('\n')}`);
  }
});
