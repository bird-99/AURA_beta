import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

function makeScopeRoot() {
  const attributes = new Map([['data-aura-scope', '1']]);
  const children = [];
  const makeChild = (tagName = 'p', style = {}) => {
    const childAttributes = new Map();
    return {
      tagName: tagName.toUpperCase(),
      isConnected: true,
      parentElement: null,
      ownerDocument: null,
      scrollHeight: 20,
      clientHeight: 20,
      computedStyle: {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        color: 'rgb(230, 230, 230)',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        backgroundImage: 'none',
        fontSize: '16px',
        outlineColor: 'rgb(154, 183, 255)',
        filter: 'none',
        getPropertyValue: () => '',
        ...style,
      },
      getAttribute: (name) => childAttributes.get(name) ?? null,
      setAttribute: (name, value) => childAttributes.set(name, String(value)),
      removeAttribute: (name) => childAttributes.delete(name),
      getBoundingClientRect: () => ({ width: 180, height: 24 }),
      matches(selector = '') {
        return String(selector).split(',').map((part) => part.trim()).some((part) => {
          if (part === '*') return true;
          if (part === 'p') return this.tagName === 'P';
          if (part === 'a' || part === 'a[href]') return this.tagName === 'A';
          if (part === '[role="link"]') return false;
          if (part === 'h1' || part === 'h2' || part === 'h3' || part === 'h4' || part === 'h5' || part === 'h6') return this.tagName === part.toUpperCase();
          if (part === '[role="heading"]') return false;
          if (part === 'input' || part === 'textarea' || part === 'select' || part === 'button') return this.tagName === part.toUpperCase();
          if (part === 'pre' || part === 'code' || part === 'kbd' || part === 'samp') return this.tagName === part.toUpperCase();
          if (part === 'img' || part === 'video' || part === 'canvas' || part === 'iframe' || part === 'picture' || part === 'object' || part === 'embed') return this.tagName === part.toUpperCase();
          if (part === 'svg') return this.tagName === 'SVG';
          return false;
        });
      },
    };
  };
  const textNode = makeChild('p');
  const linkNode = makeChild('a', { color: 'rgb(138, 180, 255)' });
  const controlNode = makeChild('button', { backgroundColor: 'rgb(13, 21, 38)' });
  const codeNode = makeChild('code', { backgroundColor: 'rgb(17, 24, 39)' });
  children.push(textNode, linkNode, controlNode, codeNode);

  const scope = {
    tagName: 'MAIN',
    isConnected: true,
    children,
    parentElement: null,
    scrollWidth: 600,
    clientWidth: 600,
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      color: 'rgb(230, 230, 230)',
      backgroundColor: 'rgb(11, 16, 32)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: (name) => {
        if (name === '--aura-bg-color') return 'rgb(11, 16, 32)';
        if (name === '--aura-focus-color') return 'rgb(154, 183, 255)';
        return '';
      },
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 600, height: 400 }),
    matches: (selector = '') => selector === '*' || selector === 'main',
    querySelectorAll(selector = '') {
      return children.filter((child) => child.matches(selector));
    },
  };
  const document = {
    documentElement: { scrollWidth: 600, clientWidth: 600 },
    createElement: (tagName) => {
      const attributes = new Map();
      return {
        tagName: String(tagName || '').toUpperCase(),
        textContent: '',
        parentNode: null,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        getAttribute: (name) => attributes.get(name) ?? null,
        removeAttribute: (name) => attributes.delete(name),
      };
    },
    defaultView: {
      getComputedStyle: (element) => element?.computedStyle || scope.computedStyle,
    },
  };
  scope.ownerDocument = document;
  children.forEach((child) => {
    child.parentElement = scope;
    child.ownerDocument = document;
  });
  return scope;
}

function makeOpenShadowRoot(ownerDocument) {
  const children = [];
  const root = {
    ownerDocument,
    host: null,
    children,
    querySelector(selector = '') {
      const attrMatch = String(selector).match(/^style\[([^=]+)="([^"]+)"\]$/);
      if (!attrMatch) {
        return null;
      }
      return children.find((child) => (
        child.tagName === 'STYLE'
        && typeof child.getAttribute === 'function'
        && child.getAttribute(attrMatch[1]) === attrMatch[2]
      )) || null;
    },
    appendChild(node) {
      const existingIndex = children.indexOf(node);
      if (existingIndex >= 0) {
        children.splice(existingIndex, 1);
      }
      node.parentNode = root;
      children.push(node);
      return node;
    },
    removeChild(node) {
      const index = children.indexOf(node);
      if (index >= 0) {
        children.splice(index, 1);
      }
      node.parentNode = null;
      return node;
    },
  };
  return root;
}

function makeInlineStyleDeclaration(initial = {}) {
  const inlineStyles = new Map();
  const style = {
    setProperty: (name, value, priority = '') => {
      inlineStyles.set(name, { value: String(value), priority: String(priority || '') });
    },
    removeProperty: (name) => {
      inlineStyles.delete(name);
    },
    getPropertyValue: (name) => inlineStyles.get(name)?.value || '',
    getPropertyPriority: (name) => inlineStyles.get(name)?.priority || '',
    item: (index) => Array.from(inlineStyles.keys())[index] || '',
    get length() {
      return inlineStyles.size;
    },
    snapshot: () => Object.fromEntries(
      Array.from(inlineStyles.entries()).map(([key, entry]) => [key, { ...entry }]),
    ),
  };

  Object.entries(initial).forEach(([property, entry]) => {
    if (entry && typeof entry === 'object') {
      style.setProperty(property, entry.value, entry.priority || '');
    } else {
      style.setProperty(property, entry);
    }
  });

  return style;
}

function installShadowTreeWalker(ownerDocument) {
  ownerDocument.defaultView.NodeFilter = { SHOW_ELEMENT: 1 };
  ownerDocument.createTreeWalker = (root) => {
    const nodes = [];
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        nodes.push(node);
      }
      if (node.children && typeof node.children.length === 'number') {
        Array.from(node.children).forEach(visit);
      }
    };
    visit(root);
    let index = 0;
    return {
      currentNode: nodes[0] || null,
      nextNode: () => {
        index += 1;
        return nodes[index] || null;
      },
    };
  };
}

function addInlineShadowSurface(shadowRoot, ownerDocument) {
  const panel = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: null,
    ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        priority: 'important',
      },
      'border-color': { value: 'rgb(210, 214, 220)', priority: '' },
      color: { value: 'rgb(17, 24, 39)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'rgb(18, 18, 18)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
      color: 'rgb(17, 24, 39)',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderTopStyle: 'solid',
      borderRightStyle: 'solid',
      borderBottomStyle: 'solid',
      borderLeftStyle: 'solid',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getBoundingClientRect: () => ({ width: 260, height: 140 }),
  };
  shadowRoot.children.push(panel);
  return panel;
}

function addShadowHost(scopeRoot, tagName = 'aura-card') {
  const shadowRoot = makeOpenShadowRoot(scopeRoot.ownerDocument);
  const host = {
    ...scopeRoot.children[0],
    tagName: tagName.toUpperCase(),
    children: [],
    shadowRoot,
    matches: () => false,
  };
  shadowRoot.host = host;
  host.parentElement = scopeRoot;
  host.ownerDocument = scopeRoot.ownerDocument;
  scopeRoot.children.push(host);
  return { host, shadowRoot };
}

function makeSvgIcon(scopeRoot, options = {}) {
  const svgAttributes = new Map();
  const pathAttributes = new Map();
  const color = options.color || 'rgb(17, 24, 39)';
  const fill = options.fill || color;
  const className = options.className || '';
  const pathStyle = makeInlineStyleDeclaration(
    options.inlineFill === false
      ? {}
      : { fill: { value: fill, priority: '' } },
  );
  const pathComputedStyle = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    color,
    fill,
    stroke: 'none',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    fontSize: '16px',
    outlineColor: 'rgb(154, 183, 255)',
    filter: 'none',
    getPropertyValue(name) {
      if (name === 'fill') return this.fill;
      if (name === 'stroke') return this.stroke;
      return '';
    },
  };
  const path = {
    nodeType: 1,
    tagName: 'PATH',
    isConnected: true,
    parentElement: null,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: pathStyle,
    computedStyle: pathComputedStyle,
    getAttribute: (name) => pathAttributes.get(name) ?? null,
    setAttribute: (name, value) => pathAttributes.set(name, String(value)),
    removeAttribute: (name) => pathAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    matches: () => false,
  };
  const svgComputedStyle = {
    ...pathComputedStyle,
    color,
    fill,
    stroke: 'none',
  };
  const svg = {
    nodeType: 1,
    tagName: 'SVG',
    id: options.id || '',
    className,
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [path],
    style: makeInlineStyleDeclaration(
      options.inlineColor === false
        ? {}
        : { color: { value: color, priority: '' } },
    ),
    computedStyle: svgComputedStyle,
    getAttribute: (name) => svgAttributes.get(name) ?? null,
    setAttribute: (name, value) => svgAttributes.set(name, String(value)),
    removeAttribute: (name) => svgAttributes.delete(name),
    getBoundingClientRect: () => ({ width: options.width || 24, height: options.height || 24 }),
    matches: (selector = '') => selector === 'svg' || selector === '*',
    querySelector(selector = '') {
      return /image|foreignObject|video|canvas|iframe|object|embed|text/.test(selector) ? null : null;
    },
    querySelectorAll(selector = '') {
      return /path/.test(selector) ? [path] : [];
    },
  };
  path.parentElement = svg;
  path.ownerDocument = scopeRoot.ownerDocument;
  return { svg, path };
}

function makeMaskedIcon(scopeRoot, options = {}) {
  const attributes = new Map();
  const color = options.backgroundColor || 'rgb(17, 24, 39)';
  const className = options.className || 'mask-icon';
  const style = makeInlineStyleDeclaration({
    'background-color': { value: color, priority: '' },
  });
  const computedStyle = {
    display: 'inline-block',
    visibility: 'visible',
    opacity: '1',
    color: 'rgb(230, 230, 230)',
    backgroundColor: color,
    backgroundImage: 'none',
    maskImage: 'url("icon.svg")',
    webkitMaskImage: 'url("icon.svg")',
    fontSize: '16px',
    outlineColor: 'rgb(154, 183, 255)',
    filter: 'none',
    getPropertyValue(name) {
      if (name === 'mask-image') return this.maskImage;
      if (name === '-webkit-mask-image') return this.webkitMaskImage;
      if (name === 'background-color') return this.backgroundColor;
      return '';
    },
  };
  const icon = {
    nodeType: 1,
    tagName: options.tagName || 'SPAN',
    id: options.id || '',
    className,
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style,
    computedStyle,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: options.width || 20, height: options.height || 20 }),
    matches: () => false,
  };
  scopeRoot.children.push(icon);
  return icon;
}

async function loadRuntime() {
  delete global.AURA_DARK_COMFORT_THEME_RUNTIME;
  await import(`../../content/dark-comfort-theme.runtime.js?run=${Date.now()}-${Math.random()}`);
  return global.AURA_DARK_COMFORT_THEME_RUNTIME;
}

afterEach(() => {
  delete global.AURA_DARK_COMFORT_THEME_RUNTIME;
  delete global.AURA_MODE_ENGINE_SCOPED_V2;
  delete global.MutationObserver;
});

test('dark content runtime builds cleanup manifest before active mutations', async () => {
  const scopeRoot = makeScopeRoot();
  let manifestWasReadyBeforeMutation = false;
  let tagApplications = 0;
  let inlineApplications = 0;
  let observerCount = 0;
  let tokenCleanup = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => {
      tagApplications += 1;
      manifestWasReadyBeforeMutation =
        runtime.getDarkComfortThemeRuntimeState().manifest?.rollbackRequired === true;
      return { ok: true, scanned: 1, surfaced: 1 };
    },
    applyDarkSurfaceInlineOverrides: () => {
      inlineApplications += 1;
      return { ok: true, overridden: 1 };
    },
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => {
      tokenCleanup += 1;
      return { ok: true, removed: 11 };
    },
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.manifest.rollbackRequired, true);
  assert.equal(manifestWasReadyBeforeMutation, true);
  assert.equal(tagApplications, 1);
  assert.equal(inlineApplications, 1);
  assert.equal(observerCount, 3);

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(tokenCleanup, 1);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, false);
});

test('dark content runtime forces and restores root color-scheme inline', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.style = makeInlineStyleDeclaration({
    'color-scheme': { value: 'light', priority: 'important' },
  });

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 1, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.inlineOverrides.rootColorScheme.overridden, 1);
  assert.equal(scopeRoot.style.getPropertyValue('color-scheme'), 'dark');
  assert.equal(scopeRoot.style.getPropertyPriority('color-scheme'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.documentInlineOverrides.restored, 1);
  assert.equal(scopeRoot.style.getPropertyValue('color-scheme'), 'light');
  assert.equal(scopeRoot.style.getPropertyPriority('color-scheme'), 'important');
});

test('dark content runtime forces and restores document decorative gradients inline', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const gradientSurface = {
    nodeType: 1,
    tagName: 'ASIDE',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(234, 236, 240))',
        priority: 'important',
      },
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      color: { value: 'rgb(24, 24, 27)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(234, 236, 240))',
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(24, 24, 27)',
      fontSize: '16px',
      borderTopWidth: '1px',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderLeftWidth: '1px',
      borderTopStyle: 'solid',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 240, height: 120 }),
    matches: () => false,
  };
  scopeRoot.children.push(gradientSurface);
  const before = gradientSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.inlineOverrides.documentGradientOverrides.overridden, 1);
  assert.equal(gradientSurface.style.getPropertyValue('background-image'), 'none');
  assert.equal(gradientSurface.style.getPropertyPriority('background-image'), 'important');
  assert.match(gradientSurface.style.getPropertyValue('background-color'), /^var\(--aura-surface-1/);
  assert.match(gradientSurface.style.getPropertyValue('color'), /^var\(--aura-text-color/);

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(gradientSurface.style.snapshot(), before);
});

test('dark content runtime preserves text-clipped gradient backgrounds', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const textGradient = {
    nodeType: 1,
    tagName: 'H1',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-image': {
        value: 'linear-gradient(90deg, rgb(59, 130, 246), rgb(236, 72, 153))',
        priority: 'important',
      },
      'background-clip': { value: 'text', priority: '' },
      '-webkit-background-clip': { value: 'text', priority: '' },
      color: { value: 'transparent', priority: '' },
      '-webkit-text-fill-color': { value: 'transparent', priority: '' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'linear-gradient(90deg, rgb(59, 130, 246), rgb(236, 72, 153))',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundClip: 'text',
      webkitBackgroundClip: 'text',
      color: 'rgba(0, 0, 0, 0)',
      webkitTextFillColor: 'rgba(0, 0, 0, 0)',
      fontSize: '32px',
      filter: 'none',
      getPropertyValue: (name) => {
        if (name === 'background-clip' || name === '-webkit-background-clip') return 'text';
        return '';
      },
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 360, height: 56 }),
    matches: () => false,
  };
  scopeRoot.children.push(textGradient);
  const before = textGradient.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.mediaBackgrounds.textGradientMarked, 1);
  assert.equal(result.inlineOverrides.documentGradientOverrides.overridden, 0);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 0);
  assert.equal(textGradient.getAttribute('data-aura-bg-text-gradient'), '1');
  assert.equal(textGradient.getAttribute('data-aura-bg-gradient'), null);
  assert.equal(
    textGradient.style.getPropertyValue('background-image'),
    'linear-gradient(90deg, rgb(59, 130, 246), rgb(236, 72, 153))',
  );
  assert.equal(textGradient.style.getPropertyPriority('background-image'), 'important');
  assert.equal(textGradient.style.getPropertyValue('-webkit-text-fill-color'), 'transparent');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.mediaBackgrounds.textGradientRemoved, 1);
  assert.equal(textGradient.getAttribute('data-aura-bg-text-gradient'), null);
  assert.deepEqual(textGradient.style.snapshot(), before);
});

test('dark content runtime fixes inline important light surfaces even when computed fallback is dark', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const inlineImportantSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        priority: 'important',
      },
      color: { value: 'rgb(24, 24, 27)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'rgb(24, 24, 27)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 260, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(inlineImportantSurface);
  const before = inlineImportantSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(inlineImportantSurface.style.getPropertyValue('background-color'), 'var(--aura-surface-2)');
  assert.equal(inlineImportantSurface.style.getPropertyPriority('background-color'), 'important');
  assert.equal(inlineImportantSurface.style.getPropertyValue('background-image'), 'none');
  assert.equal(inlineImportantSurface.style.getPropertyPriority('background-image'), 'important');
  assert.equal(inlineImportantSurface.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(inlineImportantSurface.style.getPropertyPriority('-webkit-text-fill-color'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(inlineImportantSurface.style.snapshot(), before);
});

test('dark content runtime fixes and restores inline important background and border shorthands', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const shorthandSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      background: { value: 'white', priority: 'important' },
      border: { value: '1px solid white', priority: 'important' },
      color: { value: 'black', priority: 'important' },
      '-webkit-text-fill-color': { value: 'black', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 300, height: 100 }),
    matches: () => false,
  };
  scopeRoot.children.push(shorthandSurface);
  const before = shorthandSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.backgroundOverrides, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.borderOverrides, 1);
  assert.equal(shorthandSurface.style.getPropertyValue('background'), 'var(--aura-surface-2)');
  assert.equal(shorthandSurface.style.getPropertyPriority('background'), 'important');
  assert.equal(
    shorthandSurface.style.getPropertyValue('border-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(shorthandSurface.style.getPropertyPriority('border-color'), 'important');
  assert.equal(shorthandSurface.style.getPropertyValue('color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(shorthandSurface.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color, #e6e6e6)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(shorthandSurface.style.snapshot(), before);
});

test('dark content runtime ignores media URL filename colors but fixes real background fallback colors', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const mediaOnlyAttributes = new Map();
  const mediaWithFallbackAttributes = new Map();
  const mediaOnly = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      background: { value: 'url("/assets/white-card.png") center / cover no-repeat', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'url("/assets/white-card.png")',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => mediaOnlyAttributes.get(name) ?? null,
    setAttribute: (name, value) => mediaOnlyAttributes.set(name, String(value)),
    removeAttribute: (name) => mediaOnlyAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 300, height: 120 }),
    matches: () => false,
  };
  const mediaWithFallback = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      background: { value: 'url("/assets/photo.png") center / cover no-repeat white', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'url("/assets/photo.png")',
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => mediaWithFallbackAttributes.get(name) ?? null,
    setAttribute: (name, value) => mediaWithFallbackAttributes.set(name, String(value)),
    removeAttribute: (name) => mediaWithFallbackAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 300, height: 120 }),
    matches: () => false,
  };
  scopeRoot.children.push(mediaOnly, mediaWithFallback);
  const mediaOnlyBefore = mediaOnly.style.snapshot();
  const mediaWithFallbackBefore = mediaWithFallback.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 3, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(mediaOnly.style.getPropertyValue('background-color'), '');
  assert.deepEqual(mediaOnly.style.snapshot(), mediaOnlyBefore);
  assert.equal(mediaWithFallback.style.getPropertyValue('background-color'), 'var(--aura-surface-2)');
  assert.equal(mediaWithFallback.style.getPropertyPriority('background-color'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(mediaOnly.style.snapshot(), mediaOnlyBefore);
  assert.deepEqual(mediaWithFallback.style.snapshot(), mediaWithFallbackBefore);
});

test('dark content runtime fixes inline important hsl and modern rgb colors', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const hslSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'hsl(0 0% 100% / 1)', priority: 'important' },
      'border-color': { value: 'rgb(255 255 255 / 0.95)', priority: 'important' },
      color: { value: 'hsl(0deg 0% 8%)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'hsla(0, 0%, 9%, 1)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(hslSurface);
  const before = hslSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.backgroundOverrides, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.borderOverrides, 1);
  assert.equal(hslSurface.style.getPropertyValue('background-color'), 'var(--aura-surface-2)');
  assert.equal(hslSurface.style.getPropertyPriority('background-color'), 'important');
  assert.equal(
    hslSurface.style.getPropertyValue('border-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(hslSurface.style.getPropertyPriority('border-color'), 'important');
  assert.equal(hslSurface.style.getPropertyValue('color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(hslSurface.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color, #e6e6e6)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(hslSurface.style.snapshot(), before);
});

test('dark content runtime fixes inline important css color 4 colors', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const cssColorSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'oklch(98% 0 0 / 1)', priority: 'important' },
      'border-color': { value: 'color(display-p3 1 1 1 / 0.95)', priority: 'important' },
      color: { value: 'oklch(18% 0 0 / 1)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'oklab(0.16 0 0 / 1)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(cssColorSurface);
  const before = cssColorSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.backgroundOverrides, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.borderOverrides, 1);
  assert.equal(cssColorSurface.style.getPropertyValue('background-color'), 'var(--aura-surface-2)');
  assert.equal(cssColorSurface.style.getPropertyPriority('background-color'), 'important');
  assert.equal(
    cssColorSurface.style.getPropertyValue('border-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(cssColorSurface.style.getPropertyPriority('border-color'), 'important');
  assert.equal(cssColorSurface.style.getPropertyValue('color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(cssColorSurface.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color, #e6e6e6)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(cssColorSurface.style.snapshot(), before);
});

test('dark content runtime fixes inline important lab lch and color-mix colors', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const modernSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'lab(96% 0 0 / 1)', priority: 'important' },
      'border-color': { value: 'color-mix(in srgb, white 90%, black)', priority: 'important' },
      color: { value: 'lch(15% 0 0 / 1)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'color-mix(in srgb, black 90%, white)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(modernSurface);
  const before = modernSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.backgroundOverrides, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.borderOverrides, 1);
  assert.equal(modernSurface.style.getPropertyValue('background-color'), 'var(--aura-surface-2)');
  assert.equal(modernSurface.style.getPropertyPriority('background-color'), 'important');
  assert.equal(
    modernSurface.style.getPropertyValue('border-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(modernSurface.style.getPropertyPriority('border-color'), 'important');
  assert.equal(modernSurface.style.getPropertyValue('color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(modernSurface.style.getPropertyValue('-webkit-text-fill-color'), 'var(--aura-text-color, #e6e6e6)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(modernSurface.style.snapshot(), before);
});

test('dark content runtime respects light-dark dark branch without forcing adaptive inline colors', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const adaptiveSurface = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'light-dark(#ffffff, #111827)', priority: 'important' },
      'border-color': { value: 'light-dark(#e5e7eb, #374151)', priority: 'important' },
      color: { value: 'light-dark(#111827, #f9fafb)', priority: 'important' },
      '-webkit-text-fill-color': { value: 'light-dark(#111827, #f9fafb)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(17, 24, 39)',
      color: 'rgb(249, 250, 251)',
      webkitTextFillColor: 'rgb(249, 250, 251)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(adaptiveSurface);
  const before = adaptiveSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 0);
  assert.deepEqual(adaptiveSurface.style.snapshot(), before);
});

test('dark content runtime fixes inline important interaction colors and restores them', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const interactiveElement = {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'checkbox',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'caret-color': { value: 'black', priority: 'important' },
      'accent-color': { value: 'rgb(18, 18, 18)', priority: 'important' },
      'outline-color': { value: 'oklch(18% 0 0)', priority: 'important' },
      'text-decoration-color': { value: 'color-mix(in srgb, black 90%, white)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(18, 18, 18)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 32, height: 32 }),
    matches: () => false,
  };
  scopeRoot.children.push(interactiveElement);
  const before = interactiveElement.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.accessoryOverrides, 4);
  assert.equal(interactiveElement.style.getPropertyValue('caret-color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(interactiveElement.style.getPropertyPriority('caret-color'), 'important');
  assert.equal(interactiveElement.style.getPropertyValue('accent-color'), 'var(--aura-focus-color, #9ab7ff)');
  assert.equal(interactiveElement.style.getPropertyValue('outline-color'), 'var(--aura-focus-color, #9ab7ff)');
  assert.equal(interactiveElement.style.getPropertyValue('text-decoration-color'), 'currentColor');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(interactiveElement.style.snapshot(), before);
});

test('dark content runtime fixes inline important light box shadows and restores them', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const cardAttributes = new Map();
  const insetAttributes = new Map();
  const cardShadow = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'box-shadow': {
        value: '0 0 0 1px color-mix(in srgb, white 95%, black), 0 16px 32px rgba(255 255 255 / 0.8)',
        priority: 'important',
      },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => cardAttributes.get(name) ?? null,
    setAttribute: (name, value) => cardAttributes.set(name, String(value)),
    removeAttribute: (name) => cardAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  const insetShadow = {
    nodeType: 1,
    tagName: 'INPUT',
    type: 'text',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'box-shadow': {
        value: 'inset 0 0 0 9999px light-dark(#ffffff, #ffffff)',
        priority: 'important',
      },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => insetAttributes.get(name) ?? null,
    setAttribute: (name, value) => insetAttributes.set(name, String(value)),
    removeAttribute: (name) => insetAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 220, height: 36 }),
    matches: () => false,
  };
  scopeRoot.children.push(cardShadow, insetShadow);
  const cardBefore = cardShadow.style.snapshot();
  const insetBefore = insetShadow.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 3, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 2);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.shadowOverrides, 2);
  assert.equal(
    cardShadow.style.getPropertyValue('box-shadow'),
    '0 0 0 1px var(--aura-border-color, rgba(255,255,255,0.12)), 0 12px 32px rgba(0, 0, 0, 0.35)',
  );
  assert.equal(cardShadow.style.getPropertyPriority('box-shadow'), 'important');
  assert.equal(
    insetShadow.style.getPropertyValue('box-shadow'),
    'inset 0 0 0 9999px var(--aura-surface-2, #0d1526)',
  );
  assert.equal(insetShadow.style.getPropertyPriority('box-shadow'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(cardShadow.style.snapshot(), cardBefore);
  assert.deepEqual(insetShadow.style.snapshot(), insetBefore);
});

test('dark content runtime fixes inline important border outline column and text shadow shorthands', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const attributes = new Map();
  const decoratedElement = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'border-top': { value: '1px solid white', priority: 'important' },
      'column-rule': { value: '2px solid color-mix(in srgb, white 95%, black)', priority: 'important' },
      outline: { value: '2px solid black', priority: 'important' },
      'text-shadow': { value: '0 1px 0 rgba(255 255 255 / 0.95)', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      webkitTextFillColor: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(18, 18, 18)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 90 }),
    matches: () => false,
  };
  scopeRoot.children.push(decoratedElement);
  const before = decoratedElement.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.borderOverrides, 2);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.accessoryOverrides, 1);
  assert.equal(result.inlineOverrides.inlineImportantSurfaceOverrides.decorationOverrides, 1);
  assert.equal(
    decoratedElement.style.getPropertyValue('border-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(decoratedElement.style.getPropertyPriority('border-color'), 'important');
  assert.equal(
    decoratedElement.style.getPropertyValue('column-rule-color'),
    'var(--aura-border-color, rgba(255,255,255,0.12))',
  );
  assert.equal(decoratedElement.style.getPropertyPriority('column-rule-color'), 'important');
  assert.equal(decoratedElement.style.getPropertyValue('outline-color'), 'var(--aura-focus-color, #9ab7ff)');
  assert.equal(decoratedElement.style.getPropertyPriority('outline-color'), 'important');
  assert.equal(decoratedElement.style.getPropertyValue('text-shadow'), 'none');
  assert.equal(decoratedElement.style.getPropertyPriority('text-shadow'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(decoratedElement.style.snapshot(), before);
});

test('dark content runtime preserves authored media backgrounds hidden by global fallback CSS', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const mediaImage = 'url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")';
  scopeRoot.ownerDocument.styleSheets = [
    {
      cssRules: [
        {
          selectorText: '#photo-card',
          style: {
            backgroundImage: mediaImage,
            getPropertyValue: (name) => (name === 'background-image' ? mediaImage : ''),
          },
        },
      ],
    },
  ];
  const attributes = new Map([['data-aura-bg-media', 'legacy-site-value']]);
  const photoCard = {
    nodeType: 1,
    tagName: 'SECTION',
    id: 'photo-card',
    className: 'hero-card infobox wiki-photo',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration(),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundImage: 'none',
      backgroundColor: 'rgb(16, 24, 39)',
      color: 'rgb(230, 230, 230)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 260, height: 110 }),
    matches: (selector = '') => selector === '#photo-card',
  };
  scopeRoot.children.push(photoCard);
  const before = photoCard.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  assert.equal(runtime.DARK_THEME_V1_BUDGET.authoredBackgroundRules.maxRules, 600);
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.mediaBackgrounds.marked, 1);
  assert.equal(result.inlineOverrides.mediaBackgrounds.mediaInlineRestored, 1);
  assert.equal(photoCard.getAttribute('data-aura-bg-media'), '1');
  assert.equal(photoCard.style.getPropertyValue('background-image'), mediaImage);
  assert.equal(photoCard.style.getPropertyPriority('background-image'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.equal(photoCard.getAttribute('data-aura-bg-media'), 'legacy-site-value');
  assert.deepEqual(photoCard.style.snapshot(), before);
});

test('dark runtime restores exact token value and priority captured before scoped token apply', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.style = makeInlineStyleDeclaration({
    '--aura-bg-color': { value: '#fefefe', priority: 'important' },
  });
  global.MutationObserver = class { observe() {} disconnect() {} };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true }),
    clearDarkSurfaceTags: () => ({ ok: true }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true }),
    removeTokensOwned: () => ({ ok: true }),
  };
  const tokenMap = {
    '--aura-color-scheme': 'dark',
    '--aura-bg-color': '#0b1020',
  };
  const prepared = runtime.prepareDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap,
    receiptId: 'receipt-token-preimage',
  });
  scopeRoot.style.setProperty('--aura-bg-color', '#0b1020');
  scopeRoot.style.setProperty('--aura-color-scheme', 'dark');

  const applied = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap,
    executorActive: true,
    preparedManifest: prepared.manifest,
    receiptId: prepared.receiptId,
  });
  assert.equal(applied.ok, true);
  scopeRoot.style.removeProperty('--aura-bg-color');
  scopeRoot.style.removeProperty('--aura-color-scheme');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({
    scopeRoot,
    expectedReceiptId: prepared.receiptId,
    requirePreimage: true,
    tokensAlreadyRemoved: true,
  });
  assert.equal(cleanup.ok, true);
  assert.equal(scopeRoot.style.getPropertyValue('--aura-bg-color'), '#fefefe');
  assert.equal(scopeRoot.style.getPropertyPriority('--aura-bg-color'), 'important');
  assert.equal(scopeRoot.style.getPropertyValue('--aura-color-scheme'), '');
});

test('dark runtime preserves site token changes and rejects a mismatched recovery receipt without DOM mutation', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.style = makeInlineStyleDeclaration({ '--aura-bg-color': '#ffffff' });
  global.MutationObserver = class { observe() {} disconnect() {} };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true }),
    clearDarkSurfaceTags: () => ({ ok: true }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true }),
    removeTokensOwned: () => ({ ok: true }),
  };
  const applied = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark', '--aura-bg-color': '#0b1020' },
    executorActive: true,
    receiptId: 'receipt-site-change',
  });
  assert.equal(applied.ok, true);
  scopeRoot.style.setProperty('--aura-bg-color', '#123456', 'important');

  const rejected = runtime.cleanupDarkComfortThemeRuntime({
    scopeRoot,
    expectedReceiptId: 'wrong-receipt',
    requirePreimage: true,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'runtime-receipt-mismatch');
  assert.equal(scopeRoot.style.getPropertyValue('--aura-bg-color'), '#123456');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({
    scopeRoot,
    expectedReceiptId: 'receipt-site-change',
    requirePreimage: true,
  });
  assert.equal(cleanup.ok, true);
  assert.equal(scopeRoot.style.getPropertyValue('--aura-bg-color'), '#123456');
  assert.equal(scopeRoot.style.getPropertyPriority('--aura-bg-color'), 'important');
});

test('dark content runtime styles and cleans open shadow roots', async () => {
  const scopeRoot = makeScopeRoot();
  const { shadowRoot } = addShadowHost(scopeRoot);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.surfaceTags.shadowRoots.injected, 1);
  const style = shadowRoot.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]');
  assert.ok(style);
  assert.match(style.textContent, /color-scheme:\s*dark\s*!important/);
  assert.match(style.textContent, /--aura-text-color/);
  assert.doesNotMatch(style.textContent, /--background\s*:/);
  assert.doesNotMatch(style.textContent, /--card\s*:/);
  assert.doesNotMatch(style.textContent, /--sidebar\s*:/);
  assert.match(style.textContent, /--mui-palette-background-paper:\s*var\(--aura-surface-1, #101a2f\)\s*!important/);
  assert.match(style.textContent, /--ant-color-bg-container:\s*var\(--aura-surface-1, #101a2f\)\s*!important/);
  assert.match(style.textContent, /--chakra-colors-chakra-body-bg:\s*var\(--aura-bg-color, #0b1020\)\s*!important/);
  assert.match(style.textContent, /--bs-body-bg:\s*var\(--aura-bg-color, #0b1020\)\s*!important/);
  assert.match(style.textContent, /--md-sys-color-surface:\s*var\(--aura-surface-1, #101a2f\)\s*!important/);
  assert.match(style.textContent, /--bgColor-default:\s*var\(--aura-bg-color, #0b1020\)\s*!important/);
  assert.match(style.textContent, /:host, :host :where\(dialog, \[popover\]/);
  assert.match(style.textContent, /\[class\*="card" i\]/);
  assert.match(style.textContent, /\[aria-modal="true"\]/);
  assert.match(style.textContent, /\[data-radix-popper-content-wrapper\]/);
  assert.match(style.textContent, /\[data-headlessui-portal\]/);
  assert.match(style.textContent, /\[data-floating-ui-portal\]/);
  assert.match(style.textContent, /\[class\*="tooltip" i\]/);
  assert.match(style.textContent, /\[class\*="overlay" i\]/);
  assert.match(style.textContent, /\[class\*="portal" i\]/);
  assert.match(style.textContent, /\[data-bs-theme\]/);
  assert.match(
    style.textContent,
    /:host\s*\{[^}]*-webkit-text-fill-color:\s*var\(--aura-text-color, #e6e6e6\)/,
  );
  assert.match(style.textContent, /::placeholder/);
  assert.match(style.textContent, /::selection/);
  assert.match(style.textContent, /::file-selector-button/);
  assert.match(
    style.textContent,
    /:host :where\(button, input, textarea, select, option, optgroup, progress, meter\)\s*\{[^}]*-webkit-text-fill-color:\s*var\(--aura-text-color, #e6e6e6\)/,
  );
  assert.match(
    style.textContent,
    /:host input::file-selector-button\s*\{[^}]*-webkit-text-fill-color:\s*var\(--aura-text-color, #e6e6e6\)/,
  );
  assert.match(style.textContent, /:-webkit-autofill/);
  assert.match(
    style.textContent,
    /:host :where\(a, \[role="link"\]\)\s*\{[^}]*-webkit-text-fill-color:\s*var\(--aura-link-color, #8ab4ff\)/,
  );
  assert.match(style.textContent, /::-webkit-scrollbar-thumb/);
  assert.match(style.textContent, /::-webkit-search-cancel-button/);
  assert.match(style.textContent, /::-webkit-calendar-picker-indicator/);
  assert.match(style.textContent, /::before/);
  assert.match(style.textContent, /::after/);
  assert.match(style.textContent, /\[role="toolbar"\]/);
  assert.match(style.textContent, /\[class\*="sidebar" i\]/);
  assert.match(
    style.textContent,
    /:host :where\(header, nav, aside, footer,[^{]+\{[^}]*background-color:\s*var\(--aura-surface-2, #0d1526\)/,
  );
  assert.match(
    style.textContent,
    /:host :where\(dialog, \[popover\][^{]+\{[^}]*background-color:\s*var\(--aura-surface-1, #101a2f\)[^}]*box-shadow:\s*0 12px 32px rgba\(0, 0, 0, 0\.35\)/,
  );
  assert.match(
    style.textContent,
    /:host :where\([^)]*\[data-callout\][^)]*\)::before,[^{}]+::after\s*\{[^}]*background-image:\s*none\s*!important;/,
  );
  assert.match(style.textContent, /:focus-visible/);
  assert.match(style.textContent, /--aura-muted-text-color/);
  assert.match(style.textContent, /--aura-focus-color/);
  assert.match(style.textContent, /\[class\*="success" i\]/);
  assert.match(style.textContent, /\[class\*="warning" i\]/);
  assert.match(style.textContent, /\[class\*="error" i\]/);
  assert.match(style.textContent, /\[data-status\*="success" i\]/);
  assert.match(style.textContent, /\[data-variant\*="warning" i\]/);
  assert.match(style.textContent, /\[data-severity\*="error" i\]/);
  assert.match(style.textContent, /\[data-tone\*="info" i\]/);
  assert.match(style.textContent, /\[aria-selected="true"\]/);
  assert.match(style.textContent, /\[aria-current\]:not\(\[aria-current="false"\]\)/);
  assert.match(style.textContent, /\[data-state="active" i\]/);
  assert.match(style.textContent, /\[class~="active" i\]/);
  assert.match(style.textContent, /\[aria-disabled="true"\]/);
  assert.match(style.textContent, /\[data-state="disabled" i\]/);
  assert.match(style.textContent, /\[role="grid"\]/);
  assert.match(style.textContent, /\[role="gridcell"\]/);
  assert.match(style.textContent, /\[role="menu"\]/);
  assert.match(style.textContent, /\[role="menuitem"\]/);
  assert.match(style.textContent, /\[role="listbox"\]/);
  assert.match(style.textContent, /\[role="dialog"\]/);
  assert.match(style.textContent, /\[popover\]/);
  assert.match(style.textContent, /fieldset/);
  assert.match(style.textContent, /blockquote/);
  assert.match(style.textContent, /mark/);
  assert.match(style.textContent, /\[class\*="card" i\]/);
  assert.match(style.textContent, /\[data-callout\]/);
  assert.match(style.textContent, /optgroup/);
  assert.match(style.textContent, /progress/);
  assert.match(style.textContent, /meter/);
  assert.match(style.textContent, /\[role="navigation"\]/);
  assert.match(style.textContent, /\[role="search"\]/);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 1);

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.shadowRoots.removed, 1);
  assert.equal(
    shadowRoot.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]'),
    null,
  );
  assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 0);
});

test('dark content runtime overrides and restores inline light surfaces inside open shadow roots', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const { shadowRoot } = addShadowHost(scopeRoot);
  const inlineSurface = addInlineShadowSurface(shadowRoot, scopeRoot.ownerDocument);
  const before = inlineSurface.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.overridden, 1);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.inlineOverrides, 1);
  assert.equal(inlineSurface.style.snapshot()['background-color'].value, 'var(--aura-surface-1, #101827)');
  assert.equal(inlineSurface.style.snapshot()['background-color'].priority, 'important');
  assert.equal(inlineSurface.style.snapshot()['background-image'].value, 'none');
  assert.equal(inlineSurface.style.snapshot().color.value, 'var(--aura-text-color, #e6e6e6)');
  assert.equal(
    inlineSurface.style.snapshot()['-webkit-text-fill-color'].value,
    'var(--aura-text-color, #e6e6e6)',
  );
  assert.equal(inlineSurface.style.snapshot()['-webkit-text-fill-color'].priority, 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.shadowInlineOverrides.restored, 1);
  assert.deepEqual(inlineSurface.style.snapshot(), before);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.inlineOverrides, 0);
});

test('dark content runtime fixes and restores shadow-root inline decoration artifacts', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const { shadowRoot } = addShadowHost(scopeRoot);
  const decorated = {
    nodeType: 1,
    tagName: 'BUTTON',
    isConnected: true,
    parentElement: null,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'box-shadow': { value: '0 0 0 1px white, 0 12px 24px rgba(255 255 255 / 0.7)', priority: 'important' },
      'border-top': { value: '1px solid white', priority: 'important' },
      'column-rule': { value: '2px solid color-mix(in srgb, white 95%, black)', priority: 'important' },
      outline: { value: '2px solid black', priority: 'important' },
      'text-decoration-color': { value: 'black', priority: 'important' },
      'text-shadow': { value: '0 1px 0 rgba(255 255 255 / 0.95)', priority: 'important' },
      'accent-color': { value: 'black', priority: 'important' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(16, 24, 39)',
      backgroundImage: 'none',
      color: 'rgb(230, 230, 230)',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderTopStyle: 'none',
      fontSize: '16px',
      outlineColor: 'rgb(18, 18, 18)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getBoundingClientRect: () => ({ width: 180, height: 44 }),
  };
  shadowRoot.children.push(decorated);
  const before = decorated.style.snapshot();

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    ownerKey: 'aura-me2',
  });

  assert.equal(result.ok, true);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.overridden, 1);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.borderOverrides, 2);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.shadowOverrides, 1);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.accessoryOverrides, 3);
  assert.equal(result.surfaceTags.shadowRoots.inlineOverrides.decorationOverrides, 1);
  assert.equal(
    decorated.style.getPropertyValue('box-shadow'),
    '0 0 0 1px var(--aura-border-color, rgba(255,255,255,0.12)), 0 12px 32px rgba(0, 0, 0, 0.35)',
  );
  assert.equal(decorated.style.getPropertyValue('border-color'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(decorated.style.getPropertyValue('column-rule-color'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(decorated.style.getPropertyValue('outline-color'), 'var(--aura-focus-color, #9ab7ff)');
  assert.equal(decorated.style.getPropertyValue('text-decoration-color'), 'currentColor');
  assert.equal(decorated.style.getPropertyValue('text-shadow'), 'none');
  assert.equal(decorated.style.getPropertyValue('accent-color'), 'var(--aura-focus-color, #9ab7ff)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.shadowInlineOverrides.restored, 1);
  assert.deepEqual(decorated.style.snapshot(), before);
});

test('dark content runtime caps open shadow root styling', async () => {
  const scopeRoot = makeScopeRoot();
  const roots = Array.from({ length: 5 }, (_, index) => addShadowHost(scopeRoot, `aura-card-${index}`).shadowRoot);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    shadowBudget: { maxNodes: 20, maxMs: 12, maxShadowRoots: 2, maxNestedDepth: 12 },
  });

  const styledRoots = roots.filter((root) => (
    root.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]')
  ));
  assert.equal(result.ok, true);
  assert.equal(result.surfaceTags.shadowRoots.rootsSeen, 2);
  assert.equal(result.surfaceTags.shadowRoots.budgetHit, true);
  assert.equal(styledRoots.length, 2);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 2);
});

test('dark content runtime catches late open shadow roots with bounded delayed rescans', async () => {
  const scopeRoot = makeScopeRoot();
  const scheduledTimers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    scheduledTimers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  try {
    global.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    assert.equal(runtime.DARK_THEME_V1_BUDGET.documentObserver.maxCandidateNodes, 160);
    assert.equal(runtime.DARK_THEME_V1_BUDGET.addedRoots.maxRoots, 16);
    assert.equal(runtime.DARK_THEME_V1_BUDGET.inlineImportantSurfaceOverrides.maxOverrides, 48);
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
      applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
    });

    assert.equal(result.ok, true);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().timers.shadowRescans, 3);
    const { shadowRoot } = addShadowHost(scopeRoot, 'aura-late-card');
    assert.equal(
      shadowRoot.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]'),
      null,
    );

    const firstShadowSweep = scheduledTimers.find((timer) => timer.delayMs === 600);
    assert.ok(firstShadowSweep);
    firstShadowSweep.callback();

    assert.ok(
      shadowRoot.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]'),
    );
    assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 1);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().timers.shadowRescans, 2);

    const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
    assert.equal(cleanup.cleanup.shadowRoots.removed, 1);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().timers.shadowRescans, 0);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 0);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('dark content runtime keeps AURA shadow style after late component styles', async () => {
  const scopeRoot = makeScopeRoot();
  const { shadowRoot } = addShadowHost(scopeRoot);
  const scheduledTimers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    scheduledTimers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  try {
    global.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
      applyDarkSurfaceInlineOverrides: () => ({ ok: true, overridden: 1 }),
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
      ownerKey: 'aura-me2',
    });

    assert.equal(result.ok, true);
    const auraStyle = shadowRoot.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]');
    assert.ok(auraStyle);
    assert.equal(shadowRoot.children[shadowRoot.children.length - 1], auraStyle);

    const lateSiteStyle = scopeRoot.ownerDocument.createElement('style');
    lateSiteStyle.textContent = '.card { background: white !important; color: black !important; }';
    shadowRoot.appendChild(lateSiteStyle);
    assert.equal(shadowRoot.children[shadowRoot.children.length - 1], lateSiteStyle);

    const firstShadowSweep = scheduledTimers.find((timer) => timer.delayMs === 600);
    assert.ok(firstShadowSweep);
    firstShadowSweep.callback();

    assert.equal(shadowRoot.children[shadowRoot.children.length - 1], auraStyle);
    assert.equal(result.surfaceTags.shadowRoots.injected, 1);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().shadowRoots.styles, 1);

    const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.cleanup.shadowRoots.removed, 1);
    assert.equal(shadowRoot.children.includes(auraStyle), false);
    assert.equal(shadowRoot.children.includes(lateSiteStyle), true);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('dark content runtime falls back to cleanup when executor is inactive', async () => {
  const scopeRoot = makeScopeRoot();
  let tagApplications = 0;
  let clearedTags = 0;
  let restoredInline = 0;
  let tokenCleanup = 0;
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => {
      tagApplications += 1;
      return { ok: true };
    },
    clearDarkSurfaceTags: () => {
      clearedTags += 1;
      return { ok: true };
    },
    clearDarkSurfaceInlineOverrides: () => {
      restoredInline += 1;
      return { ok: true };
    },
    removeTokensOwned: (_scopeRoot, keys) => {
      tokenCleanup += 1;
      assert.equal(keys.includes('--aura-color-scheme'), true);
      return { ok: true, removed: keys.length };
    },
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: false,
  });

  assert.equal(result.active, false);
  assert.equal(result.reason, 'executor-inactive');
  assert.equal(tagApplications, 0);
  assert.equal(observerCount, 0);
  assert.equal(clearedTags, 1);
  assert.equal(restoredInline, 1);
  assert.equal(tokenCleanup, 1);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, false);
});

test('dark content runtime stays active when initial surface scan hits budget but post-check passes', async () => {
  const scopeRoot = makeScopeRoot();
  let inlineApplications = 0;
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 600, surfaced: 1, budgetHit: true }),
    applyDarkSurfaceInlineOverrides: () => {
      inlineApplications += 1;
      return { ok: true, scanned: 4, overridden: 1 };
    },
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.budgetHit, true);
  assert.equal(inlineApplications, 1);
  assert.equal(observerCount, 3);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, true);
});

test('dark content runtime stays active when inline scan hits budget but post-check passes', async () => {
  const scopeRoot = makeScopeRoot();
  let tagApplications = 0;
  let inlineApplications = 0;
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => {
      tagApplications += 1;
      return { ok: true, scanned: 2, surfaced: 1 };
    },
    applyDarkSurfaceInlineOverrides: (_scopeRoot, budget) => {
      inlineApplications += 1;
      assert.equal(budget.maxCandidates, 40);
      return { ok: false, scanned: 600, overridden: 0, budgetHit: true, reason: 'budget-hit' };
    },
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.budgetHit, true);
  assert.equal(tagApplications, 1);
  assert.equal(inlineApplications, 1);
  assert.equal(observerCount, 3);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, true);
});

test('dark content runtime rescans when existing elements change style or theme attributes', async () => {
  const scopeRoot = makeScopeRoot();
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;
  let now = 0;
  let tagApplications = 0;
  let inlineApplications = 0;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };
  Date.now = () => now;

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.options = null;
        observers.push(this);
      }
      observe(_target, options) {
        this.options = options;
      }
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => {
        tagApplications += 1;
        return { ok: true, scanned: 2, surfaced: 1 };
      },
      applyDarkSurfaceInlineOverrides: () => {
        inlineApplications += 1;
        return { ok: true, scanned: 2, overridden: 1 };
      },
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
    });

    assert.equal(result.ok, true);
    assert.equal(tagApplications, 1);
    assert.equal(inlineApplications, 1);
    assert.equal(observers.length, 3);
    observers.forEach((observer) => {
      assert.equal(observer.options.attributes, true);
      assert.ok(observer.options.attributeFilter.includes('style'));
      assert.ok(observer.options.attributeFilter.includes('class'));
      assert.ok(observer.options.attributeFilter.includes('data-theme'));
    });

    now = 1000;
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'attributes',
          attributeName: 'style',
          target: scopeRoot.children[0],
        },
      ]);
    });

    const surfaceTimer = timers.find((timer) => timer.delayMs === 350 && timer.cleared === false);
    const inlineTimer = timers.find((timer) => timer.delayMs === 400 && timer.cleared === false);
    assert.ok(surfaceTimer);
    assert.ok(inlineTimer);

    surfaceTimer.callback();
    inlineTimer.callback();

    assert.equal(tagApplications, 2);
    assert.equal(inlineApplications, 2);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test('dark content runtime applies and restores local design token inline overrides', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const localShellAttributes = new Map([['data-theme', 'light']]);
  const localShell = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      '--card': { value: 'rgb(255, 255, 255)', priority: 'important' },
      '--card-foreground': { value: 'rgb(17, 24, 39)', priority: 'important' },
      '--background': { value: '0 0% 100%', priority: '' },
      '--foreground': { value: '222 47% 11%', priority: '' },
      '--color-link': { value: 'rgb(29, 78, 216)', priority: '' },
      '--sidebar': { value: 'rgb(248, 250, 252)', priority: '' },
      '--mui-palette-background-paper': { value: 'rgb(255, 255, 255)', priority: '' },
      '--app-bg': { value: 'rgb(255, 255, 255)', priority: '' },
      '--page-background-color': { value: 'rgb(250, 250, 250)', priority: '' },
      '--text-primary': { value: 'rgb(17, 24, 39)', priority: '' },
      '--caption-color': { value: 'rgb(75, 85, 99)', priority: '' },
      '--divider-color': { value: 'rgb(226, 232, 240)', priority: '' },
      '--focus-ring-color': { value: 'rgb(31, 41, 55)', priority: '' },
      '--sheet-bg': { value: '0 0% 100%', priority: '' },
      '--body-text': { value: '222 47% 11%', priority: '' },
      '--color-background': { value: '255 255 255', priority: '' },
      '--color-text': { value: '17 24 39', priority: '' },
      '--color-border': { value: '226 232 240', priority: '' },
      '--panel-rgb': { value: '255 255 255', priority: '' },
      '--copy-rgb': { value: '17 24 39', priority: '' },
      '--color-white': { value: 'rgb(255, 255, 255)', priority: '' },
      '--color-gray-50': { value: 'rgb(249, 250, 251)', priority: '' },
      '--color-gray-300': { value: 'rgb(209, 213, 219)', priority: '' },
      '--color-gray-600': { value: 'rgb(75, 85, 99)', priority: '' },
      '--color-slate-900': { value: 'rgb(15, 23, 42)', priority: '' },
      '--tw-prose-body': { value: 'rgb(55, 65, 81)', priority: '' },
      '--tw-prose-headings': { value: 'rgb(17, 24, 39)', priority: '' },
      '--tw-prose-links': { value: 'rgb(17, 24, 39)', priority: '' },
      '--tw-prose-lead': { value: 'rgb(75, 85, 99)', priority: '' },
      '--tw-prose-hr': { value: 'rgb(229, 231, 235)', priority: '' },
      '--tw-prose-quotes': { value: 'rgb(17, 24, 39)', priority: '' },
      '--tw-prose-quote-borders': { value: 'rgb(229, 231, 235)', priority: '' },
      '--tw-prose-code': { value: 'rgb(17, 24, 39)', priority: '' },
      '--tw-prose-pre-code': { value: 'rgb(229, 231, 235)', priority: '' },
      '--tw-prose-pre-bg': { value: 'rgb(31, 41, 55)', priority: '' },
      '--color-red-500': { value: 'rgb(239, 68, 68)', priority: '' },
      '--brand-color': { value: 'rgb(220, 38, 38)', priority: '' },
      '--brand-gray-50': { value: 'rgb(249, 250, 251)', priority: '' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      color: 'rgb(17, 24, 39)',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'none',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => localShellAttributes.get(name) ?? null,
    setAttribute: (name, value) => localShellAttributes.set(name, String(value)),
    removeAttribute: (name) => localShellAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 260, height: 140 }),
    matches: (selector = '') => String(selector).includes('[data-theme]'),
  };
  const customHostAttributes = new Map();
  const customHost = {
    nodeType: 1,
    tagName: 'AURA-CLOSED-TOKEN-CARD',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      '--card': { value: 'rgb(255, 255, 255)', priority: '' },
      '--card-foreground': { value: 'rgb(17, 24, 39)', priority: '' },
      '--border': { value: 'rgb(210, 214, 220)', priority: '' },
      '--color-link': { value: 'rgb(29, 78, 216)', priority: '' },
      '--ant-color-bg-container': { value: 'rgb(255, 255, 255)', priority: '' },
      '--chakra-colors-bg-subtle': { value: 'rgb(247, 250, 252)', priority: '' },
      '--dialog-bg': { value: 'rgb(255, 255, 255)', priority: '' },
      '--anchor-color': { value: 'rgb(29, 78, 216)', priority: '' },
      '--status-warning-bg': { value: 'rgb(254, 249, 195)', priority: '' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      color: 'rgb(17, 24, 39)',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'none',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => customHostAttributes.get(name) ?? null,
    setAttribute: (name, value) => customHostAttributes.set(name, String(value)),
    removeAttribute: (name) => customHostAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 120 }),
    matches: () => false,
  };
  scopeRoot.children.push(localShell);
  scopeRoot.children.push(customHost);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    localTokenBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxOverrides: 2,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.localTokenOverrides.overridden, 2);
  assert.equal(result.inlineOverrides.localTokenOverrides.customHosts, 1);
  assert.equal(result.inlineOverrides.localTokenOverrides.inferredTokenProperties, 27);
  assert.equal(localShell.style.getPropertyValue('--card'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(localShell.style.getPropertyPriority('--card'), 'important');
  assert.equal(localShell.style.getPropertyValue('--card-foreground'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--background'), '224 60% 8%');
  assert.equal(localShell.style.getPropertyValue('--foreground'), '0 0% 90%');
  assert.equal(localShell.style.getPropertyValue('--color-link'), 'var(--aura-link-color, #8ab4ff)');
  assert.equal(localShell.style.getPropertyValue('--sidebar'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(localShell.style.getPropertyValue('--mui-palette-background-paper'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(localShell.style.getPropertyValue('--app-bg'), 'var(--aura-bg-color, #0b1020)');
  assert.equal(localShell.style.getPropertyValue('--page-background-color'), 'var(--aura-bg-color, #0b1020)');
  assert.equal(localShell.style.getPropertyValue('--text-primary'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--caption-color'), 'var(--aura-muted-text-color, #a8b0bf)');
  assert.equal(localShell.style.getPropertyValue('--divider-color'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(localShell.style.getPropertyValue('--focus-ring-color'), 'var(--aura-focus-color, #9ab7ff)');
  assert.equal(localShell.style.getPropertyValue('--sheet-bg'), '218 49% 12%');
  assert.equal(localShell.style.getPropertyValue('--body-text'), '0 0% 90%');
  assert.equal(localShell.style.getPropertyValue('--color-background'), '11 16 32');
  assert.equal(localShell.style.getPropertyValue('--color-text'), '230 230 230');
  assert.equal(localShell.style.getPropertyValue('--color-border'), '71 85 105');
  assert.equal(localShell.style.getPropertyValue('--panel-rgb'), '16 26 47');
  assert.equal(localShell.style.getPropertyValue('--copy-rgb'), '230 230 230');
  assert.equal(localShell.style.getPropertyValue('--color-white'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(localShell.style.getPropertyValue('--color-gray-50'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(localShell.style.getPropertyValue('--color-gray-300'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(localShell.style.getPropertyValue('--color-gray-600'), 'var(--aura-muted-text-color, #a8b0bf)');
  assert.equal(localShell.style.getPropertyValue('--color-slate-900'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-body'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-headings'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-links'), 'var(--aura-link-color, #8ab4ff)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-lead'), 'var(--aura-muted-text-color, #a8b0bf)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-hr'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-quotes'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-quote-borders'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-code'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-pre-code'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-pre-bg'), 'var(--aura-surface-2, #0d1526)');
  assert.equal(localShell.style.getPropertyValue('--color-red-500'), 'rgb(239, 68, 68)');
  assert.equal(localShell.style.getPropertyValue('--brand-color'), 'rgb(220, 38, 38)');
  assert.equal(localShell.style.getPropertyValue('--brand-gray-50'), 'rgb(249, 250, 251)');
  assert.equal(customHost.style.getPropertyValue('--card'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(customHost.style.getPropertyPriority('--card'), 'important');
  assert.equal(customHost.style.getPropertyValue('--card-foreground'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(customHost.style.getPropertyValue('--border'), 'var(--aura-border-color, rgba(255,255,255,0.12))');
  assert.equal(customHost.style.getPropertyValue('--color-link'), 'var(--aura-link-color, #8ab4ff)');
  assert.equal(customHost.style.getPropertyValue('--ant-color-bg-container'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(customHost.style.getPropertyValue('--chakra-colors-bg-subtle'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(customHost.style.getPropertyValue('--dialog-bg'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(customHost.style.getPropertyValue('--anchor-color'), 'var(--aura-link-color, #8ab4ff)');
  assert.equal(customHost.style.getPropertyValue('--status-warning-bg'), 'rgb(254, 249, 195)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.documentInlineOverrides.restored >= 2, true);
  assert.equal(localShell.style.getPropertyValue('--card'), 'rgb(255, 255, 255)');
  assert.equal(localShell.style.getPropertyPriority('--card'), 'important');
  assert.equal(localShell.style.getPropertyValue('--card-foreground'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--background'), '0 0% 100%');
  assert.equal(localShell.style.getPropertyValue('--foreground'), '222 47% 11%');
  assert.equal(localShell.style.getPropertyValue('--color-link'), 'rgb(29, 78, 216)');
  assert.equal(localShell.style.getPropertyValue('--sidebar'), 'rgb(248, 250, 252)');
  assert.equal(localShell.style.getPropertyValue('--mui-palette-background-paper'), 'rgb(255, 255, 255)');
  assert.equal(localShell.style.getPropertyValue('--app-bg'), 'rgb(255, 255, 255)');
  assert.equal(localShell.style.getPropertyValue('--page-background-color'), 'rgb(250, 250, 250)');
  assert.equal(localShell.style.getPropertyValue('--text-primary'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--caption-color'), 'rgb(75, 85, 99)');
  assert.equal(localShell.style.getPropertyValue('--divider-color'), 'rgb(226, 232, 240)');
  assert.equal(localShell.style.getPropertyValue('--focus-ring-color'), 'rgb(31, 41, 55)');
  assert.equal(localShell.style.getPropertyValue('--sheet-bg'), '0 0% 100%');
  assert.equal(localShell.style.getPropertyValue('--body-text'), '222 47% 11%');
  assert.equal(localShell.style.getPropertyValue('--color-background'), '255 255 255');
  assert.equal(localShell.style.getPropertyValue('--color-text'), '17 24 39');
  assert.equal(localShell.style.getPropertyValue('--color-border'), '226 232 240');
  assert.equal(localShell.style.getPropertyValue('--panel-rgb'), '255 255 255');
  assert.equal(localShell.style.getPropertyValue('--copy-rgb'), '17 24 39');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-body'), 'rgb(55, 65, 81)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-headings'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-links'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-lead'), 'rgb(75, 85, 99)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-hr'), 'rgb(229, 231, 235)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-quotes'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-quote-borders'), 'rgb(229, 231, 235)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-code'), 'rgb(17, 24, 39)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-pre-code'), 'rgb(229, 231, 235)');
  assert.equal(localShell.style.getPropertyValue('--tw-prose-pre-bg'), 'rgb(31, 41, 55)');
  assert.equal(localShell.style.getPropertyValue('--brand-color'), 'rgb(220, 38, 38)');
  assert.equal(customHost.style.getPropertyValue('--card'), 'rgb(255, 255, 255)');
  assert.equal(customHost.style.getPropertyPriority('--card'), '');
  assert.equal(customHost.style.getPropertyValue('--card-foreground'), 'rgb(17, 24, 39)');
  assert.equal(customHost.style.getPropertyValue('--border'), 'rgb(210, 214, 220)');
  assert.equal(customHost.style.getPropertyValue('--color-link'), 'rgb(29, 78, 216)');
  assert.equal(customHost.style.getPropertyValue('--ant-color-bg-container'), 'rgb(255, 255, 255)');
  assert.equal(customHost.style.getPropertyValue('--chakra-colors-bg-subtle'), 'rgb(247, 250, 252)');
  assert.equal(customHost.style.getPropertyValue('--dialog-bg'), 'rgb(255, 255, 255)');
  assert.equal(customHost.style.getPropertyValue('--anchor-color'), 'rgb(29, 78, 216)');
  assert.equal(customHost.style.getPropertyValue('--status-warning-bg'), 'rgb(254, 249, 195)');
});

test('dark content runtime resolves bounded local token aliases before inference', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const aliasShellAttributes = new Map([['data-theme', 'light']]);
  const aliasShell = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      '--color-gray-50': { value: 'rgb(249, 250, 251)', priority: '' },
      '--color-gray-700': { value: 'rgb(55, 65, 81)', priority: '' },
      '--tw-prose-body': { value: 'var(--color-gray-700)', priority: '' },
      '--article-surface': { value: 'var(--color-gray-50)', priority: '' },
      '--brand-gray-alias': { value: 'var(--color-gray-50)', priority: '' },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      color: 'rgb(55, 65, 81)',
      backgroundColor: 'rgb(249, 250, 251)',
      backgroundImage: 'none',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: (name) => aliasShellAttributes.get(name) ?? null,
    setAttribute: (name, value) => aliasShellAttributes.set(name, String(value)),
    removeAttribute: (name) => aliasShellAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 260, height: 140 }),
    matches: (selector = '') => String(selector).includes('[data-theme]'),
  };
  scopeRoot.children.push(aliasShell);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 1, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 1, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    localTokenBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxOverrides: 1,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.localTokenOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.localTokenOverrides.inferredTokenProperties, 4);
  assert.equal(aliasShell.style.getPropertyValue('--color-gray-50'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(aliasShell.style.getPropertyValue('--color-gray-700'), 'var(--aura-muted-text-color, #a8b0bf)');
  assert.equal(aliasShell.style.getPropertyValue('--tw-prose-body'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(aliasShell.style.getPropertyValue('--article-surface'), 'var(--aura-surface-1, #101a2f)');
  assert.equal(aliasShell.style.getPropertyValue('--brand-gray-alias'), 'var(--color-gray-50)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(aliasShell.style.getPropertyValue('--color-gray-50'), 'rgb(249, 250, 251)');
  assert.equal(aliasShell.style.getPropertyValue('--color-gray-700'), 'rgb(55, 65, 81)');
  assert.equal(aliasShell.style.getPropertyValue('--tw-prose-body'), 'var(--color-gray-700)');
  assert.equal(aliasShell.style.getPropertyValue('--article-surface'), 'var(--color-gray-50)');
  assert.equal(aliasShell.style.getPropertyValue('--brand-gray-alias'), 'var(--color-gray-50)');
});

test('dark content runtime delays attribute rescans that arrive during self-mute', async () => {
  const scopeRoot = makeScopeRoot();
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;
  let now = 0;
  let tagApplications = 0;
  let inlineApplications = 0;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };
  Date.now = () => now;

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => {
        tagApplications += 1;
        return { ok: true, scanned: 2, surfaced: 1 };
      },
      applyDarkSurfaceInlineOverrides: () => {
        inlineApplications += 1;
        return { ok: true, scanned: 2, overridden: 1 };
      },
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
    });

    assert.equal(result.ok, true);
    assert.equal(tagApplications, 1);
    assert.equal(inlineApplications, 1);
    assert.equal(observers.length, 3);

    now = 1000;
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'attributes',
          attributeName: 'style',
          target: scopeRoot.children[0],
        },
      ]);
    });

    const firstSurfaceTimer = timers.find((timer) => timer.delayMs === 350 && timer.cleared === false);
    const firstInlineTimer = timers.find((timer) => timer.delayMs === 400 && timer.cleared === false);
    assert.ok(firstSurfaceTimer);
    assert.ok(firstInlineTimer);
    firstSurfaceTimer.callback();
    firstInlineTimer.callback();
    assert.equal(tagApplications, 2);
    assert.equal(inlineApplications, 2);

    now = 1010;
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'attributes',
          attributeName: 'style',
          target: scopeRoot.children[0],
        },
      ]);
    });

    assert.equal(tagApplications, 2);
    assert.equal(inlineApplications, 2);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().timers.mutedMutation, true);

    const mutedTimer = timers.find((timer) => timer.delayMs === 71 && timer.cleared === false);
    assert.ok(mutedTimer, `scheduled timers: ${timers.map((timer) => `${timer.delayMs}:${timer.cleared}`).join(',')}`);

    now = 1081;
    mutedTimer.callback();
    const surfaceTimer = timers.filter((timer) => timer.delayMs === 350 && timer.cleared === false).at(-1);
    const inlineTimer = timers.filter((timer) => timer.delayMs === 400 && timer.cleared === false).at(-1);
    assert.ok(surfaceTimer);
    assert.ok(inlineTimer);

    surfaceTimer.callback();
    now = 2000;
    inlineTimer.callback();

    assert.equal(tagApplications, 3);
    assert.equal(inlineApplications, 3);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test('dark content runtime still handles added nodes during self-mute windows', async () => {
  const scopeRoot = makeScopeRoot();
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;
  let now = 0;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };
  Date.now = () => now;

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.options = null;
        observers.push(this);
      }
      observe(_target, options) {
        this.options = options;
      }
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
      applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 1 }),
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
    });

    assert.equal(result.ok, true);
    assert.equal(observers.length, 3);

    const addedNode = { nodeType: 1, tagName: 'SECTION' };
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'childList',
          addedNodes: [addedNode],
          removedNodes: [],
        },
      ]);
    });

    assert.ok(timers.some((timer) => timer.delayMs === 350 && timer.cleared === false));
    assert.ok(timers.some((timer) => timer.delayMs === 400 && timer.cleared === false));
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test('dark content runtime scans added subtrees directly with a bounded budget', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const targetedInlineBudgets = [];
  const targetedSurfaceBudgets = [];

  const dynamicAttributes = new Map();
  const dynamicNode = {
    nodeType: 1,
    tagName: 'SECTION',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        priority: 'important',
      },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
      color: 'rgb(24, 24, 27)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: (name) => {
        if (name === '--aura-surface-1') return 'rgb(16, 24, 39)';
        if (name === '--aura-surface-2') return 'rgb(15, 23, 38)';
        return '';
      },
    },
    getAttribute: (name) => dynamicAttributes.get(name) ?? null,
    setAttribute: (name, value) => dynamicAttributes.set(name, String(value)),
    removeAttribute: (name) => dynamicAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 260, height: 90 }),
    matches: () => false,
    querySelectorAll: () => [],
  };

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: (root, budget) => {
        if (root === dynamicNode) {
          targetedSurfaceBudgets.push(budget);
        }
        return { ok: true, scanned: 1, surfaced: 1 };
      },
      applyDarkSurfaceInlineOverrides: (root, budget) => {
        if (root === dynamicNode) {
          targetedInlineBudgets.push(budget);
        }
        return { ok: true, scanned: 1, overridden: root === dynamicNode ? 1 : 0 };
      },
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
      inlineBudget: {
        maxNodes: 1200,
        maxMs: 18,
        maxCandidates: 40,
        maxForceText: 80,
      },
    });

    assert.equal(result.ok, true);
    scopeRoot.children.push(dynamicNode);
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'childList',
          addedNodes: [dynamicNode],
          removedNodes: [],
        },
      ]);
    });

    const addedRootTimer = timers.find((timer) => timer.delayMs === 90 && timer.cleared === false);
    assert.ok(addedRootTimer);
    addedRootTimer.callback();

    assert.equal(dynamicNode.getAttribute('data-aura-bg-gradient'), '1');
    assert.equal(targetedSurfaceBudgets.length, 1);
    assert.equal(targetedSurfaceBudgets[0].maxNodes, 180);
    assert.equal(targetedSurfaceBudgets[0].maxMs, 8);
    assert.equal(targetedInlineBudgets.length, 1);
    assert.equal(targetedInlineBudgets[0].maxNodes, 180);
    assert.equal(targetedInlineBudgets[0].maxCandidates, 24);
    assert.equal(targetedInlineBudgets[0].maxForceText, 32);

    const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
    assert.equal(cleanup.ok, true);
    assert.equal(dynamicNode.getAttribute('data-aura-bg-gradient'), null);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('dark content runtime prioritizes darkable added roots when many nodes arrive together', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const targetedRoots = [];

  const makeAddedNode = (index) => ({
    nodeType: 1,
    tagName: 'DIV',
    id: `filler-${index}`,
    className: 'layout-fragment',
    isConnected: true,
    parentElement: scopeRoot,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration(),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      color: 'rgb(24, 24, 27)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: () => '',
    },
    getAttribute: () => null,
    hasAttribute: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
    getBoundingClientRect: () => ({ width: 40, height: 20 }),
    matches: () => false,
    querySelectorAll: () => [],
  });
  const priorityAttributes = new Map();
  const prioritySurface = {
    ...makeAddedNode(99),
    id: 'inline-important-surface',
    className: 'runtime-surface',
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        priority: 'important',
      },
    }),
    computedStyle: {
      ...makeAddedNode(99).computedStyle,
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
    },
    getAttribute: (name) => priorityAttributes.get(name) ?? null,
    hasAttribute: (name) => priorityAttributes.has(name),
    setAttribute: (name, value) => priorityAttributes.set(name, String(value)),
    removeAttribute: (name) => priorityAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 280, height: 120 }),
  };
  const addedNodes = Array.from({ length: 24 }, (_, index) => makeAddedNode(index));
  addedNodes.push(prioritySurface);

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: (root) => {
        targetedRoots.push(root);
        return { ok: true, scanned: 1, surfaced: root === prioritySurface ? 1 : 0 };
      },
      applyDarkSurfaceInlineOverrides: (root) => {
        targetedRoots.push(root);
        return { ok: true, scanned: 1, overridden: root === prioritySurface ? 1 : 0 };
      },
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
      inlineBudget: {
        maxNodes: 1200,
        maxMs: 18,
        maxCandidates: 40,
        maxForceText: 80,
      },
    });

    assert.equal(result.ok, true);
    observers.forEach((observer) => {
      observer.callback([
        {
          type: 'childList',
          addedNodes,
          removedNodes: [],
        },
      ]);
    });

    const addedRootTimer = timers.find((timer) => timer.delayMs === 90 && timer.cleared === false);
    assert.ok(addedRootTimer);
    addedRootTimer.callback();

    assert.equal(targetedRoots.includes(prioritySurface), true);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('dark content runtime scans document-level overlays added outside the active scope', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const observers = [];
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const targetedInlineBudgets = [];
  const targetedSurfaceBudgets = [];

  const modalAttributes = new Map();
  const modalNode = {
    nodeType: 1,
    tagName: 'DIV',
    id: '',
    className: 'site-modal portal-overlay',
    isConnected: true,
    parentElement: scopeRoot.ownerDocument.documentElement,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        priority: 'important',
      },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
      color: 'rgb(17, 24, 39)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: (name) => {
        if (name === '--aura-surface-1') return 'rgb(16, 24, 39)';
        if (name === '--aura-surface-2') return 'rgb(15, 23, 38)';
        return '';
      },
    },
    getAttribute: (name) => modalAttributes.get(name) ?? null,
    hasAttribute: (name) => modalAttributes.has(name),
    setAttribute: (name, value) => modalAttributes.set(name, String(value)),
    removeAttribute: (name) => modalAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 360, height: 240 }),
    matches: () => false,
    querySelectorAll: () => [],
  };

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };

  try {
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.target = null;
        observers.push(this);
      }
      observe(target) {
        this.target = target;
      }
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: (root, budget) => {
        if (root === modalNode) {
          targetedSurfaceBudgets.push(budget);
        }
        return { ok: true, scanned: 1, surfaced: root === modalNode ? 1 : 0 };
      },
      applyDarkSurfaceInlineOverrides: (root, budget) => {
        if (root === modalNode) {
          targetedInlineBudgets.push(budget);
        }
        return { ok: true, scanned: 1, overridden: root === modalNode ? 1 : 0 };
      },
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
      inlineBudget: {
        maxNodes: 1200,
        maxMs: 18,
        maxCandidates: 40,
        maxForceText: 80,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().observers.document, true);
    const documentObserver = observers.find((observer) => observer.target === scopeRoot.ownerDocument.documentElement);
    assert.ok(documentObserver);
    documentObserver.callback([
      {
        type: 'childList',
        addedNodes: [modalNode],
        removedNodes: [],
      },
    ]);

    const addedRootTimer = timers.find((timer) => timer.delayMs === 90 && timer.cleared === false);
    assert.ok(addedRootTimer);
    addedRootTimer.callback();

    assert.equal(modalNode.getAttribute('data-aura-bg-gradient'), '1');
    assert.equal(targetedSurfaceBudgets.length, 1);
    assert.equal(targetedSurfaceBudgets[0].maxNodes, 180);
    assert.equal(targetedInlineBudgets.length, 1);
    assert.equal(targetedInlineBudgets[0].maxNodes, 180);
    assert.equal(targetedInlineBudgets[0].maxCandidates, 24);

    const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
    assert.equal(cleanup.ok, true);
    assert.equal(modalNode.getAttribute('data-aura-bg-gradient'), null);
    assert.equal(runtime.getDarkComfortThemeRuntimeState().observers.document, false);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('dark content runtime scans existing document-level shells outside the active scope on apply', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  const targetedInlineBudgets = [];
  const targetedSurfaceBudgets = [];
  const shellAttributes = new Map();
  const shellNode = {
    nodeType: 1,
    tagName: 'HEADER',
    id: '',
    className: 'site-header navbar',
    isConnected: true,
    parentElement: scopeRoot.ownerDocument.documentElement,
    ownerDocument: scopeRoot.ownerDocument,
    children: [],
    style: makeInlineStyleDeclaration({
      'background-color': { value: 'rgb(255, 255, 255)', priority: 'important' },
      'background-image': {
        value: 'linear-gradient(rgb(255, 255, 255), rgb(245, 245, 245))',
        priority: 'important',
      },
    }),
    computedStyle: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      backgroundColor: 'rgb(255, 255, 255)',
      backgroundImage: 'linear-gradient(rgb(255, 255, 255), rgb(245, 245, 245))',
      color: 'rgb(17, 24, 39)',
      fontSize: '16px',
      outlineColor: 'rgb(154, 183, 255)',
      filter: 'none',
      getPropertyValue: (name) => {
        if (name === '--aura-surface-1') return 'rgb(16, 24, 39)';
        if (name === '--aura-surface-2') return 'rgb(15, 23, 38)';
        return '';
      },
    },
    getAttribute: (name) => shellAttributes.get(name) ?? null,
    hasAttribute: (name) => shellAttributes.has(name),
    setAttribute: (name, value) => shellAttributes.set(name, String(value)),
    removeAttribute: (name) => shellAttributes.delete(name),
    getBoundingClientRect: () => ({ width: 900, height: 80 }),
    matches: () => false,
    querySelectorAll: () => [],
  };
  scopeRoot.ownerDocument.documentElement.children = [shellNode, scopeRoot];

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: (root, budget) => {
      if (root === shellNode) {
        targetedSurfaceBudgets.push(budget);
      }
      return { ok: true, scanned: 1, surfaced: root === shellNode ? 1 : 0 };
    },
    applyDarkSurfaceInlineOverrides: (root, budget) => {
      if (root === shellNode) {
        targetedInlineBudgets.push(budget);
      }
      return { ok: true, scanned: 1, overridden: root === shellNode ? 1 : 0 };
    },
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 1 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.surfaceTags.documentCandidates.rootsSeen, 1);
  assert.equal(result.surfaceTags.documentCandidates.nodesSeen, 1);
  assert.equal(shellNode.getAttribute('data-aura-bg-gradient'), '1');
  assert.equal(targetedSurfaceBudgets.length, 1);
  assert.equal(targetedSurfaceBudgets[0].maxNodes, 180);
  assert.equal(targetedInlineBudgets.length, 1);
  assert.equal(targetedInlineBudgets[0].maxCandidates, 24);

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(shellNode.getAttribute('data-aura-bg-gradient'), null);
});

test('dark content runtime slice rescans mark late decorative gradients without waiting for observer throttle', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const target = scopeRoot.children[0];
  target.computedStyle.backgroundImage = 'none';
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalDateNow = Date.now;
  let now = 0;

  global.setTimeout = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref() {},
    };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = (timer) => {
    if (timer) {
      timer.cleared = true;
    }
  };
  Date.now = () => now;

  try {
    global.MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    const runtime = await loadRuntime();
    global.AURA_MODE_ENGINE_SCOPED_V2 = {
      applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
      clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
      clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
      removeTokensOwned: () => ({ ok: true, removed: 11 }),
    };

    const result = runtime.applyDarkComfortThemeRuntime({
      scopeRoot,
      tokenMap: { '--aura-color-scheme': 'dark' },
      executorActive: true,
      mediaBackgroundBudget: {
        maxNodes: 20,
        maxMs: 1000,
        maxMediaBackgrounds: 2,
        maxGradientBackgrounds: 2,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(target.getAttribute('data-aura-bg-gradient'), null);

    const firstSlice = timers.find((timer) => timer.delayMs === 250 && timer.cleared === false);
    assert.ok(firstSlice, `scheduled timers: ${timers.map((timer) => `${timer.delayMs}:${timer.cleared}`).join(',')}`);
    now = 250;
    firstSlice.callback();
    assert.equal(target.getAttribute('data-aura-bg-gradient'), null);

    target.computedStyle.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))';

    const secondSlice = timers.find((timer) => timer.delayMs === 800 && timer.cleared === false);
    assert.ok(secondSlice, `scheduled timers: ${timers.map((timer) => `${timer.delayMs}:${timer.cleared}`).join(',')}`);
    now = 800;
    secondSlice.callback();

    assert.equal(target.getAttribute('data-aura-bg-gradient'), '1');

    const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
    assert.equal(cleanup.ok, true);
    assert.equal(target.getAttribute('data-aura-bg-gradient'), null);
  } finally {
    global.AURA_DARK_COMFORT_THEME_RUNTIME?.cleanupDarkComfortThemeRuntime?.({ scopeRoot });
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    Date.now = originalDateNow;
  }
});

test('dark content runtime lifts simple low-contrast SVG icons and restores inline paint', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const { svg, path } = makeSvgIcon(scopeRoot, {
    color: 'rgb(17, 24, 39)',
    fill: 'rgb(17, 24, 39)',
  });
  scopeRoot.children.push(svg);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    iconBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxIcons: 4,
      maxPaintSamples: 4,
      maxPaintNodes: 4,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.iconOverrides.overridden, 1);
  assert.equal(svg.style.getPropertyValue('color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(path.style.getPropertyValue('fill'), 'var(--aura-text-color, #e6e6e6)');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.iconOverrides.restored >= 2, true);
  assert.equal(svg.style.getPropertyValue('color'), 'rgb(17, 24, 39)');
  assert.equal(path.style.getPropertyValue('fill'), 'rgb(17, 24, 39)');
});

test('dark content runtime preserves brand-like colorful SVG marks', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const { svg, path } = makeSvgIcon(scopeRoot, {
    id: 'brand-icon',
    className: 'brand-icon',
    color: 'rgb(220, 38, 38)',
    fill: 'rgb(220, 38, 38)',
  });
  scopeRoot.children.push(svg);

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    iconBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxIcons: 4,
      maxPaintSamples: 4,
      maxPaintNodes: 4,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.iconOverrides.overridden, 0);
  assert.equal(svg.style.getPropertyValue('color'), 'rgb(220, 38, 38)');
  assert.equal(path.style.getPropertyValue('fill'), 'rgb(220, 38, 38)');
});

test('dark content runtime lifts CSS masked icons and restores their paint', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const icon = makeMaskedIcon(scopeRoot, { backgroundColor: 'rgb(17, 24, 39)' });

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    iconBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxIcons: 4,
      maxPaintSamples: 4,
      maxPaintNodes: 4,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.iconOverrides.overridden, 1);
  assert.equal(result.inlineOverrides.iconOverrides.maskOverrides, 1);
  assert.equal(icon.style.getPropertyValue('background-color'), 'var(--aura-text-color, #e6e6e6)');
  assert.equal(icon.style.getPropertyPriority('background-color'), 'important');

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.cleanup.iconOverrides.restored >= 1, true);
  assert.equal(icon.style.getPropertyValue('background-color'), 'rgb(17, 24, 39)');
  assert.equal(icon.style.getPropertyPriority('background-color'), '');
});

test('dark content runtime preserves brand-like CSS masked marks', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
  });
  const icon = makeMaskedIcon(scopeRoot, {
    id: 'brand-mask',
    className: 'brand-logo',
    backgroundColor: 'rgb(17, 24, 39)',
  });

  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 0 }),
    clearDarkSurfaceTags: () => ({ ok: true, clearedSurface: 1 }),
    clearDarkSurfaceInlineOverrides: () => ({ ok: true, restored: 0 }),
    removeTokensOwned: () => ({ ok: true, removed: 11 }),
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    iconBudget: {
      maxNodes: 20,
      maxMs: 1000,
      maxIcons: 4,
      maxPaintSamples: 4,
      maxPaintNodes: 4,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.inlineOverrides.iconOverrides.maskOverrides, 0);
  assert.equal(icon.style.getPropertyValue('background-color'), 'rgb(17, 24, 39)');
});

test('dark content runtime rolls back when post-check fails', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.children[0].computedStyle.color = 'rgb(20, 20, 20)';
  let clearedTags = 0;
  let restoredInline = 0;
  let tokenCleanup = 0;
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 1 }),
    clearDarkSurfaceTags: () => {
      clearedTags += 1;
      return { ok: true, clearedSurface: 1, clearedSurfaceKind: 1 };
    },
    clearDarkSurfaceInlineOverrides: () => {
      restoredInline += 1;
      return { ok: true, restored: 1 };
    },
    removeTokensOwned: () => {
      tokenCleanup += 1;
      return { ok: true, removed: 11 };
    },
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.active, false);
  assert.equal(result.reason, 'postcheck-failed');
  assert.equal(result.postCheck.postCheckPassed, false);
  assert.ok(result.postCheck.failures.includes('textContrast'));
  assert.equal(clearedTags, 1);
  assert.equal(restoredInline, 1);
  assert.equal(tokenCleanup, 1);
  assert.equal(observerCount, 0);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, false);
});

test('dark content runtime can keep global fallback corrections when post-check is unverified', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.children[0].computedStyle.color = 'rgb(20, 20, 20)';
  let clearedTags = 0;
  let restoredInline = 0;
  let tokenCleanup = 0;
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();
  global.AURA_MODE_ENGINE_SCOPED_V2 = {
    applyDarkSurfaceTags: () => ({ ok: true, scanned: 2, surfaced: 1 }),
    applyDarkSurfaceInlineOverrides: () => ({ ok: true, scanned: 2, overridden: 1, forcedText: 1 }),
    clearDarkSurfaceTags: () => {
      clearedTags += 1;
      return { ok: true, clearedSurface: 1, clearedSurfaceKind: 1 };
    },
    clearDarkSurfaceInlineOverrides: () => {
      restoredInline += 1;
      return { ok: true, restored: 1 };
    },
    removeTokensOwned: () => {
      tokenCleanup += 1;
      return { ok: true, removed: 11 };
    },
  };

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    rollbackOnPostCheckFailure: false,
    source: 'global-safe-fallback',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.reason, 'postcheck-failed-unverified');
  assert.equal(result.postCheck.postCheckPassed, false);
  assert.ok(result.postCheck.failures.includes('textContrast'));
  assert.equal(clearedTags, 0);
  assert.equal(restoredInline, 0);
  assert.equal(tokenCleanup, 0);
  assert.equal(observerCount > 0, true);
  assert.equal(runtime.getDarkComfortThemeRuntimeState().active, true);

  runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });
});

test('dark content runtime global fallback forces and restores inline priority text without scoped helper', async () => {
  const scopeRoot = makeScopeRoot();
  installShadowTreeWalker(scopeRoot.ownerDocument);
  scopeRoot.children.forEach((child) => {
    child.nodeType = 1;
    child.getAttribute = () => null;
  });
  const heading = scopeRoot.children[0];
  heading.tagName = 'H1';
  heading.textContent = 'Inline important heading text that must become readable';
  heading.innerText = heading.textContent;
  heading.style = makeInlineStyleDeclaration({
    color: { value: 'rgb(20, 20, 20)', priority: 'important' },
    '-webkit-text-fill-color': { value: 'rgb(25, 25, 25)', priority: 'important' },
  });
  heading.computedStyle = {
    ...heading.computedStyle,
    color: 'rgb(20, 20, 20)',
    webkitTextFillColor: 'rgb(25, 25, 25)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    fontSize: '28px',
  };
  const before = heading.style.snapshot();
  let observerCount = 0;

  global.MutationObserver = class {
    constructor() {
      observerCount += 1;
    }
    observe() {}
    disconnect() {}
  };
  const runtime = await loadRuntime();

  const result = runtime.applyDarkComfortThemeRuntime({
    scopeRoot,
    tokenMap: { '--aura-color-scheme': 'dark' },
    executorActive: true,
    rollbackOnPostCheckFailure: false,
    documentInlineTextFallback: true,
    inlineBudget: { maxNodes: 20, maxMs: 1000, maxForceText: 4 },
    source: 'global-safe-fallback',
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.inlineOverrides.documentTextFallback.forcedText, 1);
  assert.equal(heading.style.snapshot().color.value, 'var(--aura-text-color, #e6e6e6)');
  assert.equal(heading.style.snapshot().color.priority, 'important');
  assert.equal(heading.style.snapshot()['-webkit-text-fill-color'].value, 'var(--aura-text-color, #e6e6e6)');
  assert.equal(observerCount > 0, true);

  const cleanup = runtime.cleanupDarkComfortThemeRuntime({ scopeRoot });

  assert.equal(cleanup.ok, true);
  assert.deepEqual(heading.style.snapshot(), before);
});

test('dark content runtime exposes compact passing post-check report', async () => {
  const scopeRoot = makeScopeRoot();
  const runtime = await loadRuntime();
  const report = runtime.runDarkComfortThemePostCheck(scopeRoot, {
    manifest: runtime.createDarkComfortCleanupManifest(scopeRoot, {
      tokenMap: { '--aura-color-scheme': 'dark' },
    }),
  });

  assert.equal(report.postCheckPassed, true);
  assert.equal(report.cleanupExact, true);
  assert.equal(report.linksDistinct, true);
  assert.equal(report.controlsVisible, true);
  assert.equal(report.mediaPreserved, true);
  assert.equal(Object.hasOwn(report, 'rawText'), false);
  assert.equal(Object.hasOwn(report, 'selector'), false);
});

test('dark content runtime ignores hidden form controls during post-check', async () => {
  const scopeRoot = makeScopeRoot();
  scopeRoot.children.forEach((child) => {
    if (child.tagName === 'BUTTON') {
      child.computedStyle.display = 'none';
      child.computedStyle.color = 'rgb(20, 20, 20)';
      child.computedStyle.backgroundColor = 'rgb(255, 255, 255)';
      child.getBoundingClientRect = () => ({ width: 0, height: 0 });
    }
  });

  const runtime = await loadRuntime();
  const report = runtime.runDarkComfortThemePostCheck(scopeRoot, {
    manifest: runtime.createDarkComfortCleanupManifest(scopeRoot, {
      tokenMap: { '--aura-color-scheme': 'dark' },
    }),
  });

  assert.equal(report.controlsVisible, true);
  assert.equal(report.controlTextContrast, null);
  assert.equal(report.postCheckPassed, true);
});

test('dark content runtime ignores decorative empty text nodes during post-check', async () => {
  const scopeRoot = makeScopeRoot();
  const decorative = {
    ...scopeRoot.children[0],
    tagName: 'SPAN',
    textContent: '',
    computedStyle: {
      ...scopeRoot.children[0].computedStyle,
      color: 'rgb(230, 230, 230)',
      backgroundColor: 'rgb(0, 255, 255)',
    },
  };
  scopeRoot.children.unshift(decorative);

  const runtime = await loadRuntime();
  const report = runtime.runDarkComfortThemePostCheck(scopeRoot, {
    manifest: runtime.createDarkComfortCleanupManifest(scopeRoot, {
      tokenMap: { '--aura-color-scheme': 'dark' },
    }),
  });

  assert.equal(report.postCheckPassed, true);
  assert.equal(report.textContrast >= 4.5, true);
});
