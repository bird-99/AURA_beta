import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { DEFAULT_INJECT_FILES } from '../../background/content-bridge.js';

const manifestUrl = new URL('../../manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));

const EXPECTED_CONTENT_SCRIPTS = [
  'content/top-layer-host.runtime.js',
  'content/rect-animator.runtime.js',
  'content/focus-engine-controller.runtime.js',
  'content/focus-overlay-v2.runtime.js',
  'content/ultra-focus.runtime.js',
  'content/reading-ruler.runtime.js',
  'content/smartscope-v2.runtime.js',
  'content/mode-engine-scoped-v2.runtime.js',
  'content/dark-comfort-theme.runtime.js',
  'content/page-signals-adapter.runtime.js',
  'content/content-bootstrap.runtime.js',
  'content/content-message-router.runtime.js',
  'content/content-main.js',
];

test('manifest declares the expected MV3 permissions and entrypoints', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '127');
  assert.deepEqual(manifest.background, {
    service_worker: 'background/service-worker.js',
    type: 'module',
  });
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'scripting', 'tabs', 'favicon']);
  assert.deepEqual(manifest.optional_permissions, ['webNavigation']);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
});

test('manifest content script order is stable and loaded at document_start', () => {
  assert.equal(manifest.content_scripts.length, 1);

  const [contentScript] = manifest.content_scripts;
  assert.deepEqual(contentScript.matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(contentScript.js, EXPECTED_CONTENT_SCRIPTS);
  assert.equal(contentScript.run_at, 'document_start');
  assert.equal(contentScript.all_frames, false);
});

test('content bridge fallback injection stays aligned with manifest content scripts', () => {
  assert.deepEqual(DEFAULT_INJECT_FILES, EXPECTED_CONTENT_SCRIPTS);
  assert.deepEqual(DEFAULT_INJECT_FILES, manifest.content_scripts[0].js);
});

test('manifest content script files exist', () => {
  for (const scriptPath of EXPECTED_CONTENT_SCRIPTS) {
    const scriptUrl = new URL(`../../${scriptPath}`, import.meta.url);
    assert.equal(existsSync(scriptUrl), true, `${scriptPath} should exist`);
  }
});

test('manifest options page files exist', () => {
  assert.equal(manifest.options_ui.page, 'options/options.html');
  for (const filePath of ['options/options.html', 'options/options.css', 'options/options.js']) {
    const fileUrl = new URL(`../../${filePath}`, import.meta.url);
    assert.equal(existsSync(fileUrl), true, `${filePath} should exist`);
  }
});
