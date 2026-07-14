import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

import { MODE_IDS } from '../../shared/constants.js';
import * as shared from '../../shared/mode-engine-scoped-v2.js';

const runtimePath = path.join(process.cwd(), 'content', 'mode-engine-scoped-v2.runtime.js');

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadScopedRuntime() {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const sandbox = {
    console,
  };

  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'mode-engine-scoped-v2.runtime.js' });
  return context.globalThis.AURA_MODE_ENGINE_SCOPED_V2;
}

function createScopedElementFixture() {
  const attributes = new Map([
    [shared.SCOPE_ATTR, shared.SCOPE_ATTR_VALUE],
    [shared.SCOPE_OWNER_ATTR, shared.SCOPE_OWNER_VALUE],
    [shared.MODE_ENGINE_SCOPE_TOKENS_ATTR, '--aura-line-height,--aura-font-size'],
  ]);
  const removedProperties = [];
  const element = {
    style: {
      removeProperty: (token) => {
        removedProperties.push(token);
      },
    },
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    removeAttribute: (name) => {
      attributes.delete(name);
    },
  };

  return {
    element,
    snapshot: () => ({
      attributes: Object.fromEntries(attributes.entries()),
      removedProperties: [...removedProperties],
    }),
  };
}

function createSurfaceFixture(count = 3) {
  const nodes = [];
  const mediaTags = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME', 'AUDIO', 'PICTURE', 'OBJECT', 'EMBED']);
  const formControlTags = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

  const matchesSelector = (node, selector) => {
    const selectors = String(selector)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return selectors.some((part) => {
      if (part.startsWith('.')) {
        return String(node.className || '').split(/\s+/).includes(part.slice(1));
      }
      if (part.startsWith('#')) {
        return node.id === part.slice(1);
      }
      if (part.startsWith('[role="')) {
        const role = part.slice(7, -2);
        return node.getAttribute('role') === role;
      }
      if (part.startsWith('[contenteditable')) {
        const value = node.getAttribute('contenteditable');
        return value === '' || value === 'true';
      }
      return node.tagName === part.toUpperCase();
    });
  };

  const queryDescendants = (node, selector) => {
    const result = [];
    const visit = (candidate) => {
      candidate.children.forEach((child) => {
        if (matchesSelector(child, selector)) {
          result.push(child);
        }
        visit(child);
      });
    };
    visit(node);
    return result;
  };

  const document = {
    body: null,
    documentElement: null,
    createTreeWalker: (_root) => {
      let index = 0;
      return {
        currentNode: nodes[0],
        nextNode: () => {
          index += 1;
          return nodes[index] || null;
        },
      };
    },
  };

  const view = {
    NodeFilter: { SHOW_ELEMENT: 1 },
    performance: { now: () => 0 },
    getComputedStyle: (node) => node.computedStyle,
  };
  document.defaultView = view;

  const makeNode = (tagName = 'DIV') => {
    const attributes = new Map();
    const inlineStyles = new Map();
    const node = {
      nodeType: 1,
      tagName,
      id: '',
      className: '',
      isConnected: true,
      ownerDocument: document,
      parentElement: null,
      children: [],
      hidden: false,
      textContent: '',
      innerText: '',
      style: {
        setProperty: (name, value, priority = '') => {
          inlineStyles.set(name, { value: String(value), priority: String(priority || '') });
        },
        removeProperty: (name) => {
          inlineStyles.delete(name);
        },
        getPropertyValue: (name) => inlineStyles.get(name)?.value || '',
        getPropertyPriority: (name) => inlineStyles.get(name)?.priority || '',
        snapshot: () => Object.fromEntries(
          Array.from(inlineStyles.entries()).map(([key, entry]) => [key, { ...entry }]),
        ),
      },
      computedStyle: {
        display: 'block',
        visibility: 'visible',
        backgroundColor: 'rgb(255, 255, 255)',
        backgroundImage: 'none',
        color: 'rgb(20, 20, 20)',
        borderRadius: '0px',
        borderTopWidth: '0px',
        borderRightWidth: '0px',
        borderBottomWidth: '0px',
        borderLeftWidth: '0px',
        borderTopStyle: 'none',
        borderRightStyle: 'none',
        borderBottomStyle: 'none',
        borderLeftStyle: 'none',
        borderTopColor: 'rgba(0, 0, 0, 0)',
        fontSize: '16px',
        boxShadow: 'none',
        getPropertyValue: (name) => node.customProperties?.get(name) || '',
      },
      customProperties: new Map(),
      matches: (selector) => matchesSelector(node, selector),
      closest: (selector) => {
        let current = node;
        while (current) {
          if (matchesSelector(current, selector)) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      },
      querySelectorAll: (selector) => queryDescendants(node, selector),
      querySelector: (selector) => queryDescendants(node, selector)[0] || null,
      getBoundingClientRect: () => ({ width: 220, height: 220 }),
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => {
        const normalized = String(value);
        attributes.set(name, normalized);
        if (name === 'class') {
          node.className = normalized;
        }
        if (name === 'id') {
          node.id = normalized;
        }
      },
      removeAttribute: (name) => {
        attributes.delete(name);
        if (name === 'class') {
          node.className = '';
        }
        if (name === 'id') {
          node.id = '';
        }
      },
    };
    node.isMediaTag = mediaTags.has(node.tagName);
    node.isFormControlTag = formControlTags.has(node.tagName);
    return node;
  };

  const scope = makeNode('MAIN');
  scope.computedStyle.backgroundColor = 'rgba(0, 0, 0, 0)';
  document.body = scope;
  document.documentElement = scope;
  nodes.push(scope);

  const children = [];
  for (let i = 0; i < count; i += 1) {
    const child = makeNode('SECTION');
    child.parentElement = scope;
    scope.children.push(child);
    children.push(child);
    nodes.push(child);
  }

  const appendChild = (parent, child) => {
    child.parentElement = parent;
    parent.children.push(child);
    nodes.push(child);
    return child;
  };

  return { scope, children, makeNode, appendChild };
}

test('scoped v2 runtime exposes the same shared contract constants', () => {
  const runtime = loadScopedRuntime();
  const keys = [
    'SCOPE_ATTR',
    'SCOPE_ATTR_VALUE',
    'SCOPE_OWNER_ATTR',
    'SCOPE_OWNER_VALUE',
    'MODE_ENGINE_SCOPE_SELECTOR',
    'MODE_ENGINE_SCOPE_ATTR',
    'MODE_ENGINE_SCOPE_VALUE',
    'MODE_ENGINE_SCOPE_OWNER_ATTR',
    'MODE_ENGINE_SCOPE_TOKENS_ATTR',
    'SCOPED_TOKEN_KEYS',
  ];

  for (const key of keys) {
    assert.deepEqual(normalize(runtime[key]), normalize(shared[key]), `${key} should match shared module`);
  }
});

test('scoped v2 runtime caps dark surface tags and clears tracked tags exactly', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(3);

  const applied = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxSurfaces: 2,
    maxForceText: 0,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.surfaced, 2);
  assert.equal(applied.capHit, true);
  assert.equal(children.filter((child) => child.hasAttribute('data-aura-surface')).length, 2);

  const cleanup = runtime.clearDarkSurfaceTags(scope, {
    maxNodes: 1,
    maxMs: 1000,
  });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.clearedSurface, 2);
  assert.equal(children.some((child) => child.hasAttribute('data-aura-surface')), false);
});

test('scoped v2 runtime caps forced text tags and clears tracked forced text exactly', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(3);
  children.forEach((child) => {
    child.textContent = 'This dark text sample is long enough for contrast checks.';
    child.innerText = child.textContent;
    child.computedStyle.backgroundColor = 'rgb(10, 10, 10)';
    child.computedStyle.color = 'rgb(20, 20, 20)';
  });

  const applied = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxSurfaces: 0,
    maxForceText: 2,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.surfaced, 0);
  assert.equal(applied.forcedText, 2);
  assert.equal(applied.capHit, true);
  assert.equal(children.filter((child) => child.hasAttribute('data-aura-force-text')).length, 2);

  const cleanup = runtime.clearDarkSurfaceTags(scope, {
    maxNodes: 1,
    maxMs: 1000,
  });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.clearedForceText, 2);
  assert.equal(children.some((child) => child.hasAttribute('data-aura-force-text')), false);
});

test('scoped v2 runtime classifies dark surfaces and clears tracked kind exactly', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(2);
  children[0].computedStyle.borderRadius = '8px';
  children[1].tagName = 'FORM';

  const applied = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxSurfaces: 2,
    maxForceText: 0,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.surfaced, 2);
  assert.equal(children[0].getAttribute('data-aura-surface'), '2');
  assert.equal(children[0].getAttribute('data-aura-surface-kind'), 'card');
  assert.equal(children[1].getAttribute('data-aura-surface-kind'), 'form');

  const cleanup = runtime.clearDarkSurfaceTags(scope, {
    maxNodes: 1,
    maxMs: 1000,
  });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.clearedSurface, 2);
  assert.equal(cleanup.clearedSurfaceKind, 2);
  assert.equal(children.some((child) => child.hasAttribute('data-aura-surface-kind')), false);
});

test('scoped v2 runtime classifies app shell surfaces for dark mode', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  const header = appendChild(scope, makeNode('HEADER'));
  const toolbar = appendChild(scope, makeNode('DIV'));
  const sidebar = appendChild(scope, makeNode('ASIDE'));

  header.getBoundingClientRect = () => ({ width: 960, height: 64 });
  toolbar.getBoundingClientRect = () => ({ width: 640, height: 48 });
  toolbar.setAttribute('role', 'toolbar');
  toolbar.computedStyle.position = 'sticky';
  sidebar.setAttribute('class', 'layout-sidebar');
  sidebar.getBoundingClientRect = () => ({ width: 280, height: 720 });

  const applied = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxSurfaces: 3,
    maxForceText: 0,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.surfaced, 3);
  for (const node of [header, toolbar, sidebar]) {
    assert.equal(node.getAttribute('data-aura-surface'), '2');
    assert.equal(node.getAttribute('data-aura-surface-kind'), 'app-shell');
  }

  const cleanup = runtime.clearDarkSurfaceTags(scope, {
    maxNodes: 1,
    maxMs: 1000,
  });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.clearedSurface, 3);
  assert.equal(cleanup.clearedSurfaceKind, 3);
  assert.equal([header, toolbar, sidebar].some((node) => node.hasAttribute('data-aura-surface-kind')), false);
});

test('scoped v2 runtime skips protected media, code, editor, and non-decorative background-image surfaces', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  const code = appendChild(scope, makeNode('PRE'));
  const mediaContainer = appendChild(scope, makeNode('SECTION'));
  appendChild(mediaContainer, makeNode('IMG'));
  const backgroundImage = appendChild(scope, makeNode('SECTION'));
  backgroundImage.computedStyle.backgroundImage = 'url(hero.png)';
  const editor = appendChild(scope, makeNode('SECTION'));
  editor.className = 'cm-editor';
  const valid = appendChild(scope, makeNode('SECTION'));

  const applied = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 20,
    maxMs: 1000,
    maxSurfaces: 10,
    maxForceText: 0,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.surfaced, 1);
  assert.equal(code.hasAttribute('data-aura-surface'), false);
  assert.equal(mediaContainer.hasAttribute('data-aura-surface'), false);
  assert.equal(backgroundImage.hasAttribute('data-aura-surface'), false);
  assert.equal(editor.hasAttribute('data-aura-surface'), false);
  assert.equal(valid.getAttribute('data-aura-surface-kind'), 'panel');
});

test('scoped v2 runtime treats decorative gradients as darkable surfaces and restores them', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  const largerPlainPanel = appendChild(scope, makeNode('SECTION'));
  largerPlainPanel.getBoundingClientRect = () => ({ width: 900, height: 900 });
  const gradientPanel = appendChild(scope, makeNode('SECTION'));
  gradientPanel.getBoundingClientRect = () => ({ width: 220, height: 220 });
  gradientPanel.computedStyle.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))';
  gradientPanel.style.setProperty(
    'background-image',
    'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
  );
  const before = gradientPanel.style.snapshot();

  const tagged = runtime.applyDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxSurfaces: 10,
    maxForceText: 0,
    minArea: 100,
    surfaceLum: 0.8,
  });

  assert.equal(tagged.ok, true);
  assert.equal(tagged.surfaced, 2);
  assert.equal(gradientPanel.getAttribute('data-aura-surface-kind'), 'panel');

  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.overridden, 1);
  assert.equal(gradientPanel.style.snapshot()['background-color'].value, 'var(--aura-surface-1)');
  assert.equal(gradientPanel.style.snapshot()['background-image'].value, 'none');
  assert.equal(gradientPanel.style.snapshot()['background-image'].priority, 'important');
  assert.deepEqual(largerPlainPanel.style.snapshot(), {});

  const inlineCleanup = runtime.clearDarkSurfaceInlineOverrides();
  const tagCleanup = runtime.clearDarkSurfaceTags(scope, {
    maxNodes: 10,
    maxMs: 1000,
  });

  assert.equal(inlineCleanup.ok, true);
  assert.equal(tagCleanup.ok, true);
  assert.deepEqual(gradientPanel.style.snapshot(), before);
  assert.equal(gradientPanel.hasAttribute('data-aura-surface'), false);
});

test('scoped v2 runtime inline-overrides document body with dark background, not surface', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  scope.tagName = 'BODY';
  scope.computedStyle.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))';
  scope.style.setProperty(
    'background-image',
    'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
  );
  const childPanel = appendChild(scope, makeNode('SECTION'));
  childPanel.getBoundingClientRect = () => ({ width: 220, height: 220 });
  childPanel.computedStyle.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))';
  childPanel.style.setProperty(
    'background-image',
    'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
  );
  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 2,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.overridden, 2);
  assert.equal(scope.style.snapshot()['background-color'].value, 'var(--aura-bg-color, #0b1020)');
  assert.equal(scope.style.snapshot()['background-image'].value, 'none');
  assert.equal(childPanel.style.snapshot()['background-image'].value, 'none');

  runtime.clearDarkSurfaceInlineOverrides();
});

test('scoped v2 runtime applies collected inline candidates when inline scan budget is hit', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(2);

  const result = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 2,
    maxMs: 1000,
    maxCandidates: 2,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(result.ok, false);
  assert.equal(result.budgetHit, true);
  assert.equal(result.reason, 'budget-hit-partial');
  assert.equal(result.overridden, 1);
  assert.notDeepEqual(children[0].style.snapshot(), {});
  assert.deepEqual(children[1].style.snapshot(), {});

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();
  assert.equal(cleanup.ok, true);
  assert.deepEqual(children[0].style.snapshot(), {});
});

test('scoped v2 runtime forces low-contrast inline text even without a local light surface', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  scope.customProperties.set('--aura-surface-1', '#101a2f');
  scope.customProperties.set('--aura-text-color', '#e6e6e6');
  scope.customProperties.set('--aura-color-scheme', 'dark');

  const heading = appendChild(scope, makeNode('H1'));
  heading.textContent = 'Inline important heading text that must be restored';
  heading.innerText = heading.textContent;
  heading.computedStyle.backgroundColor = 'rgba(0, 0, 0, 0)';
  heading.computedStyle.color = 'rgb(20, 20, 20)';
  heading.getBoundingClientRect = () => ({ width: 240, height: 40 });
  heading.style.setProperty('color', 'rgb(20, 20, 20)', 'important');
  heading.style.setProperty('-webkit-text-fill-color', 'rgb(25, 25, 25)', 'important');

  const before = heading.style.snapshot();
  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    maxForceText: 4,
    minArea: 16000,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.forcedText, 1);
  assert.equal(heading.style.snapshot().color.value, 'var(--aura-text-color)');
  assert.equal(heading.style.snapshot().color.priority, 'important');
  assert.equal(heading.style.snapshot()['-webkit-text-fill-color'].value, 'var(--aura-text-color)');

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.deepEqual(heading.style.snapshot(), before);
});

test('scoped v2 runtime darkens small wiki-style surfaces below the generic area threshold', () => {
  const runtime = loadScopedRuntime();
  const { scope, makeNode, appendChild } = createSurfaceFixture(0);
  scope.customProperties.set('--aura-surface-1', '#101a2f');
  scope.customProperties.set('--aura-surface-2', '#0d1526');
  scope.customProperties.set('--aura-text-color', '#e6e6e6');

  const infobox = appendChild(scope, makeNode('ASIDE'));
  infobox.className = 'infobox metadata';
  infobox.setAttribute('class', 'infobox metadata');
  infobox.textContent = 'Compact wiki infobox content that must become readable';
  infobox.innerText = infobox.textContent;
  infobox.computedStyle.backgroundColor = 'rgb(248, 249, 250)';
  infobox.computedStyle.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(234, 236, 240))';
  infobox.computedStyle.color = 'rgb(32, 33, 34)';
  infobox.getBoundingClientRect = () => ({ width: 220, height: 48 });

  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 4,
    minArea: 16000,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.overridden, 1);
  assert.equal(infobox.style.snapshot()['background-color'].value, 'var(--aura-surface-1)');
  assert.equal(infobox.style.snapshot()['background-image'].value, 'none');
  assert.equal(infobox.style.snapshot().color.value, 'var(--aura-text-color)');

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.deepEqual(infobox.style.snapshot(), {});
});

test('scoped v2 runtime restores inline surface overrides exactly', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(1);
  const target = children[0];
  target.textContent = 'This inline styled surface has enough text to trigger forced dark text correction.';
  target.innerText = target.textContent;
  scope.customProperties.set('--aura-surface-1', 'rgb(16, 24, 39)');
  scope.customProperties.set('--aura-surface-2', 'rgb(13, 21, 38)');
  target.computedStyle.borderTopWidth = '1px';
  target.computedStyle.borderTopStyle = 'solid';
  target.computedStyle.borderTopColor = 'rgb(210, 210, 210)';
  target.style.setProperty('background-color', 'rgb(250, 250, 250)', 'important');
  target.style.setProperty('border-color', 'rgb(210, 210, 210)');
  target.style.setProperty('color', 'rgb(30, 30, 30)');
  target.style.setProperty('-webkit-text-fill-color', 'rgb(25, 25, 25)', 'important');
  const before = target.style.snapshot();

  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.equal(applied.overridden, 1);
  assert.equal(target.style.snapshot()['background-color'].value, 'var(--aura-surface-2)');
  assert.equal(target.style.snapshot()['border-color'].value, 'var(--aura-border-color)');
  assert.equal(target.style.snapshot().color.value, 'var(--aura-text-color)');
  assert.equal(target.style.snapshot()['-webkit-text-fill-color'].value, 'var(--aura-text-color)');
  assert.equal(target.style.snapshot()['-webkit-text-fill-color'].priority, 'important');

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.restored, 1);
  assert.deepEqual(target.style.snapshot(), before);
});

test('scoped v2 runtime cleanup preserves site inline changes made while dark override is active', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(1);
  const target = children[0];

  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.match(target.style.snapshot()['background-color'].value, /^var\(--aura-surface-[12]\)$/);

  target.style.setProperty('background-color', 'rgb(255, 255, 255)');
  target.style.setProperty('color', 'rgb(20, 20, 20)');
  target.style.setProperty('-webkit-text-fill-color', 'rgb(25, 25, 25)');

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.restored, 1);
  assert.equal(target.style.snapshot()['background-color'].value, 'rgb(255, 255, 255)');
  assert.equal(target.style.snapshot().color.value, 'rgb(20, 20, 20)');
  assert.equal(target.style.snapshot()['-webkit-text-fill-color'].value, 'rgb(25, 25, 25)');
});

test('scoped v2 runtime restores inline overrides on detached tracked elements', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(1);
  const target = children[0];
  target.style.setProperty('background-color', 'rgb(250, 250, 250)', 'important');
  const before = target.style.snapshot();

  const applied = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(applied.ok, true);
  assert.match(target.style.snapshot()['background-color'].value, /^var\(--aura-surface-[12]\)$/);

  target.isConnected = false;
  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.restored, 1);
  assert.deepEqual(target.style.snapshot(), before);
});

test('scoped v2 runtime updates inline restore snapshot when rescanning site style changes', () => {
  const runtime = loadScopedRuntime();
  const { scope, children } = createSurfaceFixture(1);
  const target = children[0];

  const first = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(first.ok, true);
  assert.match(target.style.snapshot()['background-color'].value, /^var\(--aura-surface-[12]\)$/);

  target.style.setProperty('background-color', 'rgb(255, 255, 255)');
  target.style.setProperty('color', 'rgb(20, 20, 20)');
  target.style.setProperty('-webkit-text-fill-color', 'rgb(25, 25, 25)');
  target.computedStyle.backgroundColor = 'rgb(255, 255, 255)';
  target.computedStyle.color = 'rgb(20, 20, 20)';

  const second = runtime.applyDarkSurfaceInlineOverrides(scope, {
    maxNodes: 10,
    maxMs: 1000,
    maxCandidates: 1,
    minArea: 100,
    lumThreshold: 0.8,
  });

  assert.equal(second.ok, true);
  assert.match(target.style.snapshot()['background-color'].value, /^var\(--aura-surface-[12]\)$/);

  const cleanup = runtime.clearDarkSurfaceInlineOverrides();

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.restored, 1);
  assert.equal(target.style.snapshot()['background-color'].value, 'rgb(255, 255, 255)');
  assert.equal(target.style.snapshot().color.value, 'rgb(20, 20, 20)');
  assert.equal(target.style.snapshot()['-webkit-text-fill-color'].value, 'rgb(25, 25, 25)');
});

test('scoped v2 runtime token computation stays aligned with shared module', () => {
  const runtime = loadScopedRuntime();
  const cases = [
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0 },
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.35 },
    { modeId: MODE_IDS.FOCUS, intensity: 0.5 },
    { modeId: MODE_IDS.FOCUS, intensity: 1 },
    { modeId: 'unknown-mode', intensity: -1 },
    { modeId: MODE_IDS.FOCUS, intensity: 2 },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      normalize(runtime.buildScopedTokenMap(testCase.modeId, testCase.intensity)),
      shared.buildScopedTokenMap(testCase.modeId, testCase.intensity),
      `buildScopedTokenMap should match for ${JSON.stringify(testCase)}`,
    );
  }
});

test('scoped v2 runtime computeTokensV2 stays aligned with shared module', () => {
  const runtime = loadScopedRuntime();
  const cases = [
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 },
    {
      modeId: MODE_IDS.FOCUS,
      intensity: 0.8,
      overrides: {
        '--aura-link-decoration': 'underline',
        '--aura-focus-color': '#ff00aa',
      },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      normalize(runtime.computeTokensV2(testCase)),
      shared.computeTokensV2(testCase),
      `computeTokensV2 should match for ${JSON.stringify(testCase)}`,
    );
  }
});

test('scoped v2 runtime CSS generation stays aligned with shared module', () => {
  const runtime = loadScopedRuntime();
  const cases = [
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 },
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6, spacingPackEnabled: false },
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6, typoSmoothingEnabled: false },
    { modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6, smoothTransitions: true, transitionMs: 95 },
    { modeId: MODE_IDS.FOCUS, intensity: 1, includeDebugSentinels: true, reduceMotion: true },
    {
      modeId: MODE_IDS.FOCUS,
      intensity: 0.4,
      smoothTransitions: true,
      transitionMs: 125.4,
      animAttrName: 'data-aura-test-anim',
    },
  ];

  for (const testCase of cases) {
    assert.equal(
      runtime.buildScopedModeCssV2(testCase),
      shared.buildScopedModeCssV2(testCase),
      `buildScopedModeCssV2 should match for ${JSON.stringify(testCase)}`,
    );
  }
});

test('scoped v2 runtime hashes match shared module', () => {
  const runtime = loadScopedRuntime();
  const tokens = {
    '--aura-line-height': '1.8',
    '--aura-font-size': '17px',
  };
  const payload = {
    cssId: 'aura-test-css',
    modeId: MODE_IDS.FOCUS,
    cssText: '.scope { color: red; }',
    tokens,
  };

  assert.equal(runtime.computeAppliedHash(payload), shared.computeAppliedHash(payload));
});

test('scoped v2 cleanup preserveScope DOM effects stay aligned', () => {
  const runtime = loadScopedRuntime();
  const runtimeFixture = createScopedElementFixture();
  const sharedFixture = createScopedElementFixture();
  const ownedKeys = ['--aura-line-height'];
  const options = { preserveScope: true };

  const runtimeResult = runtime.cleanupScopedTokens(
    runtimeFixture.element,
    shared.SCOPE_OWNER_VALUE,
    ownedKeys,
    options,
  );
  const sharedResult = shared.cleanupScopedTokens(
    sharedFixture.element,
    shared.SCOPE_OWNER_VALUE,
    ownedKeys,
    options,
  );

  assert.deepEqual(normalize(runtimeResult), normalize(sharedResult));
  assert.deepEqual(runtimeFixture.snapshot(), sharedFixture.snapshot());
  assert.equal(sharedFixture.element.getAttribute(shared.SCOPE_ATTR), shared.SCOPE_ATTR_VALUE);
  assert.equal(sharedFixture.element.getAttribute(shared.SCOPE_OWNER_ATTR), shared.SCOPE_OWNER_VALUE);
  assert.equal(sharedFixture.element.getAttribute(shared.MODE_ENGINE_SCOPE_TOKENS_ATTR), null);
});
