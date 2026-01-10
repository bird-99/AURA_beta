import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SCOPED_TOKEN_KEYS } from '../shared/mode-engine-scoped-v2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSS_GENERATOR_PATH = path.resolve(__dirname, '../shared/mode-engine-scoped-v2.js');

function extractScopedTokensFromCssSource(sourceText) {
  const matches = sourceText.match(/var\(--aura-[^)]+\)/g) || [];
  const tokens = matches.map((match) => {
    const inner = match.replace(/^var\(/, '').replace(/\)$/, '');
    const token = inner.split(',')[0].trim();
    return token;
  });
  return new Set(tokens);
}

test('token contract: CSS v2 uses only scoped token keys', async () => {
  const sourceText = await readFile(CSS_GENERATOR_PATH, 'utf8');
  const usedTokens = extractScopedTokensFromCssSource(sourceText);
  const scopedTokenKeys = new Set(SCOPED_TOKEN_KEYS);

  const missingInScoped = [...usedTokens].filter((token) => !scopedTokenKeys.has(token));
  const unusedInCss = [...scopedTokenKeys].filter((token) => !usedTokens.has(token));

  if (missingInScoped.length > 0 || unusedInCss.length > 0) {
    assert.fail(
      [
        'Scoped token contract mismatch.',
        missingInScoped.length > 0
          ? `Tokens used in CSS but missing from SCOPED_TOKEN_KEYS: ${missingInScoped.join(', ')}`
          : null,
        unusedInCss.length > 0
          ? `Tokens in SCOPED_TOKEN_KEYS but unused in CSS: ${unusedInCss.join(', ')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
});
