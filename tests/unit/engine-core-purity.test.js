import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const engineCoreDir = path.join(process.cwd(), 'shared', 'engine-core');

function listJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }
  return files;
}

test('engine-core source stays independent from Chrome, DOM and runtime modules', () => {
  const forbiddenPatterns = [
    /\bchrome\b/,
    /\bdocument\b/,
    /\bwindow\b/,
    /\bElement\b/,
    /\bNode\b/,
    /\bDOMRect\b/,
    /\bCSSStyleDeclaration\b/,
    /\bquerySelector\b/,
    /\bquerySelectorAll\b/,
    /\bgetComputedStyle\b/,
    /\bgetBoundingClientRect\b/,
    /\bMutationObserver\b/,
    /\bIntersectionObserver\b/,
    /\binsertCSS\b/,
    /\bremoveCSS\b/,
    /\bexecuteScript\b/,
    /\bstorage\b/,
    /\btabs\b/,
    /\bsendMessage\b/,
    /from\s+['"].*content\//,
    /from\s+['"].*background\//,
    /from\s+['"].*shared\/constants\.js['"]/,
    /from\s+['"].*smartscope-v2\.js['"]/,
    /from\s+['"].*mode-engine-scoped-v2\.js['"]/,
    /from\s+['"].*shared\/utils\.js['"]/,
  ];
  const violations = [];

  for (const filePath of listJsFiles(engineCoreDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        violations.push(`${relativePath} matched ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('engine-core public modules import under poisoned browser globals', async () => {
  const originalGlobals = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    window: globalThis.window,
    Element: globalThis.Element,
    DOMRect: globalThis.DOMRect,
  };

  try {
    delete globalThis.chrome;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.Element;
    delete globalThis.DOMRect;

    await import(`../../shared/engine-core/index.js?cacheBust=${Date.now()}`);
    await import(`../../shared/engine-core/enums.js?cacheBust=${Date.now()}`);
    await import(`../../shared/engine-core/contracts.js?cacheBust=${Date.now()}`);
    await import(`../../shared/engine-core/validators.js?cacheBust=${Date.now()}`);
    await import(`../../shared/engine-core/action-policy.js?cacheBust=${Date.now()}`);
    await import(`../../shared/engine-core/runtime-capability-matrix.js?cacheBust=${Date.now()}`);
  } finally {
    for (const [key, value] of Object.entries(originalGlobals)) {
      if (value === undefined) {
        delete globalThis[key];
      } else {
        globalThis[key] = value;
      }
    }
  }
});
