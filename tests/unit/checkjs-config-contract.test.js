import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8'));
}

const sharedCoreConfig = readJson('tsconfig.checkjs.json');
const backgroundConfig = readJson('tsconfig.checkjs.background.json');
const contentDomConfig = readJson('tsconfig.checkjs.content-dom.json');
const optionsConfig = readJson('tsconfig.checkjs.options.json');
const nodeConfig = readJson('tsconfig.checkjs.node.json');
const packageJson = readJson('package.json');

test('unit tests use Node-discoverable .test.js names', () => {
  const unitDirectory = new URL('./', import.meta.url);
  const undiscovered = readdirSync(unitDirectory)
    .filter((name) => name.endsWith('.spec.js'));
  assert.deepEqual(undiscovered, []);
});

test('shared-core checkJs config stays platform-neutral', () => {
  assert.deepEqual(sharedCoreConfig.compilerOptions.types, []);
  assert.deepEqual(sharedCoreConfig.compilerOptions.lib, ['ES2022']);
  assert.ok(sharedCoreConfig.include.includes('shared/engine-core/**/*.js'));
  assert.equal(Boolean(sharedCoreConfig.files), false);

  const joinedIncludes = sharedCoreConfig.include.join('\n');
  assert.equal(joinedIncludes.includes('background/'), false);
  assert.equal(joinedIncludes.includes('content/'), false);
  assert.equal(joinedIncludes.includes('popup/'), false);
  assert.equal(joinedIncludes.includes('options/'), false);
  assert.equal(joinedIncludes.includes('tests/'), false);
});

test('background checkJs config is a bounded service-worker state/signal/policy seed', () => {
  assert.deepEqual(backgroundConfig.compilerOptions.lib, ['ES2022', 'WebWorker', 'WebWorker.Iterable']);
  assert.deepEqual(backgroundConfig.compilerOptions.types, ['chrome']);
  assert.equal(Boolean(backgroundConfig.include), false);

  const expectedFiles = [
    'background/apply-failure-reasons.js',
    'background/global-safe-fallback-policy.js',
    'background/css-guardrails.js',
    'background/scope-cache.js',
    'background/rehydrate-result-observer.js',
    'background/tab-lifecycle-coordinator.js',
    'background/rehydrate-tab-events.js',
    'background/legacy-domain-migration.js',
    'background/site-profile-store.js',
    'background/lifecycle-operation-journal.js',
    'background/shared-constants-bridge.js',
    'background/css-registry.js',
    'background/feature-flags-bridge.js',
    'background/runtime-state.js',
    'background/debug-snapshot.js',
    'background/policy-engine.js',
    'background/signals/signal-broker.js',
    'background/telemetry.js',
    'background/state-manager.js',
    'background/badge-manager.js',
    'background/spa-detector.js',
  ];
  assert.deepEqual(backgroundConfig.files, expectedFiles);

  for (const file of backgroundConfig.files) {
    assert.equal(file.includes('*'), false, `${file} must not be a glob`);
    assert.equal(file.startsWith('background/'), true, `${file} must stay in background/`);
  }

  const forbiddenFiles = new Set([
    'background/service-worker.js',
    'background/css-applier.js',
    'background/scoped-v2-page-bridge.js',
    'background/scorer.js',
    'background/decision-handler.js',
    'background/live-personalization-gate.js',
    'background/mode-css-builders.js',
    'background/scoped-v2-state.js',
  ]);

  for (const file of backgroundConfig.files) {
    assert.equal(forbiddenFiles.has(file), false, `${file} is too broad for the PR21 background config`);
  }
});

test('content DOM checkJs config is a bounded Chrome-free DOM seed', () => {
  assert.deepEqual(contentDomConfig.compilerOptions.lib, ['ES2022', 'DOM', 'DOM.Iterable']);
  assert.deepEqual(contentDomConfig.compilerOptions.types, []);
  assert.equal(contentDomConfig.compilerOptions.module, 'ES2022');
  assert.equal(contentDomConfig.compilerOptions.moduleResolution, 'Bundler');
  assert.equal(contentDomConfig.compilerOptions.moduleDetection, 'auto');
  assert.equal(Boolean(contentDomConfig.include), false);

  const expectedFiles = [
    'content/top-layer-host.runtime.js',
    'content/rect-animator.runtime.js',
    'content/focus-engine-controller.runtime.js',
    'content/focus-overlay-v2.runtime.js',
    'content/reading-ruler.runtime.js',
    'content/page-signals-adapter.runtime.js',
    'content/content-bootstrap.runtime.js',
    'content/content-message-router.runtime.js',
    'content/spa-hooks-v2.runtime.js',
  ];
  assert.deepEqual(contentDomConfig.files, expectedFiles);

  for (const file of contentDomConfig.files) {
    assert.equal(file.includes('*'), false, `${file} must not be a glob`);
    assert.equal(file.startsWith('background/'), false, `${file} must not pull extension background runtime`);
    assert.equal(file.startsWith('popup/'), false, `${file} must not pull browser UI runtime`);
    assert.equal(file.startsWith('options/'), false, `${file} must not pull browser UI runtime`);
    assert.equal(file.startsWith('scripts/'), false, `${file} must not pull Node scripts`);
  }

  const forbiddenFiles = new Set([
    'content/content-main.js',
    'content/smartscope-v2.runtime.js',
    'content/mode-engine-scoped-v2.runtime.js',
    'content/ultra-focus.runtime.js',
    'background/service-worker.js',
    'background/css-applier.js',
    'scripts/lint.mjs',
  ]);

  for (const file of contentDomConfig.files) {
    assert.equal(forbiddenFiles.has(file), false, `${file} is too broad for the PR20 content DOM seed config`);
  }
});

test('node checkJs config is a bounded scripts/tests seed', () => {
  assert.deepEqual(nodeConfig.compilerOptions.lib, ['ES2022']);
  assert.deepEqual(nodeConfig.compilerOptions.types, ['node']);
  assert.equal(Boolean(nodeConfig.include), false);

  const expectedFiles = [
    'scripts/lint.mjs',
    'tests/unit/checkjs-config-contract.test.js',
    'tests/unit/action-policy.test.js',
    'tests/unit/runtime-effect-planner.test.js',
    'tests/e2e/helpers/polling.js',
  ];
  assert.deepEqual(nodeConfig.files, expectedFiles);

  for (const file of nodeConfig.files) {
    assert.equal(file.includes('*'), false, `${file} must not be a glob`);
    assert.equal(file.startsWith('background/'), false, `${file} must not pull extension background runtime`);
    assert.equal(file.startsWith('content/'), false, `${file} must not pull browser content runtime`);
    assert.equal(file.startsWith('popup/'), false, `${file} must not pull browser UI runtime`);
    assert.equal(file.startsWith('options/'), false, `${file} must not pull browser UI runtime`);
  }
});

test('options checkJs config is a bounded Chrome-free controller/view island', () => {
  assert.deepEqual(optionsConfig.compilerOptions.lib, ['ES2022', 'DOM', 'DOM.Iterable']);
  assert.deepEqual(optionsConfig.compilerOptions.types, []);
  assert.equal(optionsConfig.compilerOptions.module, 'ES2022');
  assert.equal(optionsConfig.compilerOptions.moduleResolution, 'Bundler');
  assert.equal(Boolean(optionsConfig.include), false);
  assert.deepEqual(optionsConfig.files, [
    'options/data-management.js',
    'options/domain-configuration.js',
    'options/learning-management.js',
    'options/modeengine-diagnostics.js',
  ]);

  for (const file of optionsConfig.files) {
    assert.equal(file.includes('*'), false, `${file} must not be a glob`);
    assert.equal(file.startsWith('options/'), true, `${file} must stay in options/`);
    assert.equal(file.startsWith('background/'), false, `${file} must not pull extension background runtime`);
    assert.equal(file.startsWith('content/'), false, `${file} must not pull browser content runtime`);
    assert.equal(file.startsWith('scripts/'), false, `${file} must not pull Node scripts`);
  }
});

test('package scripts run all bounded checkJs gates from typecheck', () => {
  assert.equal(
    packageJson.scripts['checkjs:shared-core'],
    'tsc -p tsconfig.checkjs.json --pretty false',
  );
  assert.equal(
    packageJson.scripts['checkjs:background'],
    'tsc -p tsconfig.checkjs.background.json --pretty false',
  );
  assert.equal(
    packageJson.scripts['checkjs:content-dom'],
    'tsc -p tsconfig.checkjs.content-dom.json --pretty false',
  );
  assert.equal(
    packageJson.scripts['checkjs:options'],
    'tsc -p tsconfig.checkjs.options.json --pretty false',
  );
  assert.equal(
    packageJson.scripts['checkjs:node'],
    'tsc -p tsconfig.checkjs.node.json --pretty false',
  );

  const typecheck = packageJson.scripts.typecheck;
  assert.equal(
    typecheck,
    [
      'npm run lint',
      'npm run checkjs:shared-core',
      'npm run checkjs:background',
      'npm run checkjs:content-dom',
      'npm run checkjs:options',
      'npm run checkjs:node',
      'npm run test:contracts',
    ].join(' && '),
  );
  assert.doesNotMatch(typecheck, /checkjs:browser/);
});
