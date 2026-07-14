import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const guardedFiles = [
  'background/auto-apply-manager.js',
  'background/decision-handler.js',
  'background/learning-engine.js',
  'background/css-applier.js',
  'background/live-personalization-gate.js',
  'background/scoped-v2-scope-resolver.js',
  'background/scope-cache.js',
  'background/template-evidence.js',
  'background/template-memory.js',
  'shared/engine-core/action-policy.js',
];

test('shadow replay lab is not read by apply, learning, policy or scope paths', () => {
  const violations = [];
  for (const relativePath of guardedFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    if (source.includes('SHADOW_REPLAY_LEDGER_V1')) {
      violations.push(`${relativePath} reads shadow replay key`);
    }
    if (source.includes('shadow-replay-lab')) {
      violations.push(`${relativePath} imports shadow replay adapter`);
    }
  }

  assert.deepEqual(violations, []);
});
