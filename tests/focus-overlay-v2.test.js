import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  computeFocusRect,
  createFocusOverlayControllerV2,
  createFocusOverlayV2,
  destroyFocusOverlayV2,
  getExistingOverlayRoot,
  getViewport,
  setPanelAlpha,
  shouldSuspendFocusOverlayV2,
  updateFocusOverlayV2,
} from '../shared/focus-overlay-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures', 'dom');
const contentRuntimePath = resolve(__dirname, '../content/focus-overlay-v2.runtime.js');
const contentFixtureHtml = readFileSync(resolve(fixturesDir, 'content.html'), 'utf8');
const modalFixtureHtml = readFileSync(resolve(fixturesDir, 'modal.html'), 'utf8');
const contentRuntimeSource = readFileSync(contentRuntimePath, 'utf8');

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this.ownerDocument = null;
    this.isConnected = true;
    this.textContent = '';
  }

  appendChild(child) {
    child.parentNode = this;
    child.ownerDocument = child.ownerDocument || this.ownerDocument;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  matchesSelector(selector) {
    const cleaned = selector.replace(':popover-open', '');
    const tagAndAttr = cleaned.match(/^([a-zA-Z0-9_-]+)?(\[.+\])$/);
    const attrSelector = tagAndAttr ? tagAndAttr[2] : cleaned.startsWith('[') ? cleaned : null;

    if (!attrSelector) return false;

    const attrMatch = attrSelector.match(/^\[(.+?)(?:="(.+?)")?\]$/);
    if (!attrMatch) return false;

    const [, name, value] = attrMatch;
    if (tagAndAttr && tagAndAttr[1] && this.tagName?.toLowerCase() !== tagAndAttr[1].toLowerCase()) {
      return false;
    }

    if (value === undefined) {
      return this.attributes.has(name);
    }

    return this.getAttribute(name) === value;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (child.matchesSelector(selector)) {
        return child;
      }
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

class FakeDocument {
  constructor(defaultView = null, viewport = { w: 0, h: 0 }) {
    this.body = new FakeElement('BODY');
    this.documentElement = new FakeElement('HTML');
    this.documentElement.clientWidth = viewport.w;
    this.documentElement.clientHeight = viewport.h;
    this.body.ownerDocument = this;
    this.documentElement.ownerDocument = this;
    this.defaultView = defaultView;
  }

  createElement(tag) {
    const el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }

  querySelector(selector) {
    if (this.body.matchesSelector(selector)) return this.body;
    if (this.documentElement.matchesSelector(selector)) return this.documentElement;
    return this.body.querySelector(selector) || this.documentElement.querySelector(selector);
  }
}

function buildEnv(options = {}) {
  const viewport = options.viewport || { w: 0, h: 0 };
  const document = new FakeDocument(options.defaultView || null, viewport);
  return { document };
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.addedListeners = [];
    this.removedListeners = [];
    this.innerWidth = 0;
    this.innerHeight = 0;
  }

  addEventListener(type, listener, options) {
    this.addedListeners.push({ type, listener, options });
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener, options) {
    this.removedListeners.push({ type, listener, options });
    if (!this.listeners.has(type)) return;
    this.listeners.get(type).delete(listener);
  }

  dispatchEvent(type) {
    if (!this.listeners.has(type)) return;
    for (const listener of this.listeners.get(type)) {
      listener();
    }
  }
}

function mountFixture(document, html) {
  if (html.includes('<dialog')) {
    const dialog = document.createElement('dialog');
    if (html.includes('open')) dialog.setAttribute('open', '');
    if (html.includes('aria-modal')) dialog.setAttribute('aria-modal', 'true');
    dialog.textContent = 'Modal fixture';
    document.body.appendChild(dialog);
    return dialog;
  }

  const main = document.createElement('main');
  const button = document.createElement('button');
  button.textContent = html.includes('Action') ? 'Action' : 'CTA';
  main.appendChild(button);
  document.body.appendChild(main);
  return main;
}

function createScopeElement(rect) {
  const el = new FakeElement('DIV');
  el.getBoundingClientRect = () => rect;
  return el;
}

function mockRaf(view) {
  const callbacks = [];
  view.requestAnimationFrame = (cb) => {
    callbacks.push(cb);
    return callbacks.length;
  };
  view.cancelAnimationFrame = (id) => {
    if (callbacks[id - 1]) {
      callbacks[id - 1] = null;
    }
  };
  return {
    flush() {
      const queued = callbacks.splice(0, callbacks.length).filter(Boolean);
      queued.forEach((cb) => cb());
    },
    get pending() {
      return callbacks.filter(Boolean).length;
    },
  };
}

test('createFocusOverlayV2 reuses a single root and keeps html/body untouched', () => {
  const { document } = buildEnv({ viewport: { w: 800, h: 600 } });
  mountFixture(document, contentFixtureHtml);

  const htmlStyleBefore = { ...document.documentElement.style };
  const bodyStyleBefore = { ...document.body.style };

  const firstHandle = createFocusOverlayV2(document);
  const secondHandle = createFocusOverlayV2(document);

  assert.equal(firstHandle.root, secondHandle.root, 'handles share the same root');
  assert.equal(document.body.children.length, 2, 'overlay root appended once alongside fixture');
  assert.deepEqual(document.documentElement.style, htmlStyleBefore, 'html styles untouched');
  assert.deepEqual(document.body.style, bodyStyleBefore, 'body styles untouched');

  assert.equal(firstHandle.root.style.pointerEvents, 'none');
  assert.equal(firstHandle.root.style.inset, '0');
  Object.values(firstHandle.panels).forEach((panel) => {
    assert.equal(panel.style.pointerEvents, 'none');
    assert.equal(panel.style.position, 'fixed');
  });
});

test('content Focus overlay runtime ignores pointer blocking requests', () => {
  const { document } = buildEnv({ viewport: { w: 800, h: 600 } });
  const sandbox = {
    console,
    document,
    setTimeout,
    clearTimeout,
    addEventListener() {},
  };
  sandbox.globalThis = sandbox;
  runInNewContext(contentRuntimeSource, sandbox);

  const handle = sandbox.AURA_FOCUS_OVERLAY_V2.createFocusOverlayV2(document, {
    pointerBlockOutside: true,
  });

  assert.equal(handle.pointerBlockOutside, false);
  assert.equal(handle.blockers, null);
  assert.equal(handle.root.style.pointerEvents, 'none');
  assert.equal(document.querySelector('[data-aura-focus-overlay-blocker]'), null);
});

test('updateFocusOverlayV2 positions panels with non-negative geometry', () => {
  const { document } = buildEnv({ viewport: { w: 400, h: 300 } });
  mountFixture(document, contentFixtureHtml);
  const handle = createFocusOverlayV2(document);

  updateFocusOverlayV2(handle, { left: 100, top: 50, width: 200, height: 100, right: 300, bottom: 150 }, { w: 400, h: 300 });

  assert.equal(handle.root.style.display, 'block');
  assert.equal(handle.panels.top.style.height, '50px');
  assert.equal(handle.panels.bottom.style.height, '150px');
  assert.equal(handle.panels.left.style.width, '100px');
  assert.equal(handle.panels.right.style.width, '100px');
});

test('updateFocusOverlayV2 hides overlay when rect or viewport invalid', () => {
  const { document } = buildEnv({ viewport: { w: 0, h: 0 } });
  const handle = createFocusOverlayV2(document);

  updateFocusOverlayV2(handle, { left: 10, top: 10, width: 50, height: 50 }, { w: 0, h: 0 });
  assert.equal(handle.root.style.display, 'none', 'hidden when viewport invalid');

  updateFocusOverlayV2(handle, { left: NaN, top: 10, width: 50, height: 50 }, { w: 200, h: 200 });
  assert.equal(handle.root.style.display, 'none', 'hidden when rect invalid');
});

test('computeFocusRect clamps within viewport and ignores negative inputs', () => {
  const viewport = { w: 120, h: 80 };
  const { document } = buildEnv({ viewport });

  assert.equal(computeFocusRect(null, getViewport(document)), null);

  const scopeEl = createScopeElement({
    left: -10,
    top: -5,
    right: 130,
    bottom: 90,
    width: 140,
    height: 95,
  });

  const rect = computeFocusRect(scopeEl, getViewport(document));

  assert.deepEqual(rect, {
    left: 0,
    top: 0,
    right: 120,
    bottom: 80,
    width: 120,
    height: 80,
  });
});

test('shouldSuspendFocusOverlayV2 returns true for dialogs and modal roles', () => {
  const { document } = buildEnv();

  const dialog = mountFixture(document, modalFixtureHtml);
  assert.equal(shouldSuspendFocusOverlayV2(document), true, 'open dialog suspends overlay');

  dialog.remove();
  const ariaModal = document.createElement('div');
  ariaModal.setAttribute('aria-modal', 'true');
  document.body.appendChild(ariaModal);
  assert.equal(shouldSuspendFocusOverlayV2(document), true, 'aria-modal suspends overlay');

  ariaModal.remove();
  const fallbackPopover = document.createElement('div');
  fallbackPopover.setAttribute('popover', 'auto');
  fallbackPopover.setAttribute('open', '');
  document.body.appendChild(fallbackPopover);
  assert.equal(shouldSuspendFocusOverlayV2(document), true, 'open popover also suspends overlay');
});

test('controller throttles updates to one per animation frame', () => {
  const fakeWindow = new FakeWindow();
  fakeWindow.innerWidth = 300;
  fakeWindow.innerHeight = 200;
  const raf = mockRaf(fakeWindow);

  const viewport = { w: 300, h: 200 };
  const { document } = buildEnv({ defaultView: fakeWindow, viewport });
  const controller = createFocusOverlayControllerV2(document);

  const scopeEl = createScopeElement({ left: 10, top: 10, right: 60, bottom: 60, width: 50, height: 50 });

  controller.setScopeEl(scopeEl);
  controller.start();

  fakeWindow.dispatchEvent('scroll');
  fakeWindow.dispatchEvent('resize');
  assert.equal(raf.pending, 1, 'only one RAF scheduled for multiple events');

  raf.flush();
  assert.equal(controller.handle.root.style.display, 'block');

  fakeWindow.dispatchEvent('scroll');
  fakeWindow.dispatchEvent('scroll');

  assert.equal(raf.pending, 1, 'only one RAF scheduled per frame');
  raf.flush();
});

test('controller hides overlay while suspended and resumes geometry after removal', () => {
  const fakeWindow = new FakeWindow();
  fakeWindow.innerWidth = 200;
  fakeWindow.innerHeight = 200;
  fakeWindow.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
  fakeWindow.cancelAnimationFrame = () => {};

  const viewport = { w: 200, h: 200 };
  const { document } = buildEnv({ defaultView: fakeWindow, viewport });
  const controller = createFocusOverlayControllerV2(document);

  const scopeEl = createScopeElement({ left: 10, top: 10, right: 60, bottom: 60, width: 50, height: 50 });

  controller.setScopeEl(scopeEl);
  controller.start();
  const initialLeftWidth = controller.handle.panels.left.style.width;
  assert.equal(controller.handle.root.style.display, 'block', 'overlay visible when active');

  const dialog = mountFixture(document, modalFixtureHtml);
  controller.setScopeEl(createScopeElement({ left: 40, top: 10, right: 90, bottom: 60, width: 50, height: 50 }));

  assert.equal(controller.handle.root.style.display, 'none', 'overlay hidden while dialog open');
  assert.equal(controller.handle.panels.left.style.width, initialLeftWidth, 'geometry not updated while suspended');

  dialog.remove();
  controller.setScopeEl(createScopeElement({ left: 30, top: 20, right: 80, bottom: 70, width: 50, height: 50 }));

  assert.equal(controller.handle.root.style.display, 'block', 'overlay visible again after dialog removed');
  assert.equal(controller.handle.panels.left.style.width, '30px');
});

test('destroy removes overlay root and detaches listeners', () => {
  const fakeWindow = new FakeWindow();
  fakeWindow.innerWidth = 150;
  fakeWindow.innerHeight = 150;
  fakeWindow.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
  fakeWindow.cancelAnimationFrame = () => {};

  const viewport = { w: 150, h: 150 };
  const { document } = buildEnv({ defaultView: fakeWindow, viewport });
  const controller = createFocusOverlayControllerV2(document);
  const scopeEl = createScopeElement({ left: 5, top: 5, right: 55, bottom: 55, width: 50, height: 50 });

  controller.setScopeEl(scopeEl);
  controller.start();

  assert.ok(getExistingOverlayRoot(document));
  assert.equal(fakeWindow.addedListeners.length, 2, 'scroll and resize listeners added');

  controller.destroy();
  controller.destroy();

  assert.equal(getExistingOverlayRoot(document), null, 'overlay root removed');
  assert.equal(fakeWindow.removedListeners.length, 2, 'listeners detached on destroy');
});

test('setEnabled applies alpha and hides overlay when disabled', () => {
  const fakeWindow = new FakeWindow();
  fakeWindow.innerWidth = 240;
  fakeWindow.innerHeight = 180;
  fakeWindow.requestAnimationFrame = (cb) => {
    cb();
    return 1;
  };
  fakeWindow.cancelAnimationFrame = () => {};

  const viewport = { w: 240, h: 180 };
  const { document } = buildEnv({ defaultView: fakeWindow, viewport });
  const controller = createFocusOverlayControllerV2(document, { alpha: 0.35 });
  const scopeEl = createScopeElement({ left: 20, top: 20, right: 120, bottom: 100, width: 100, height: 80 });

  controller.setScopeEl(scopeEl);
  controller.setEnabled(true, { alpha: 0.4 });

  const panel = controller.handle.panels.top;
  assert.equal(panel.style.backgroundColor, 'rgba(0, 0, 0, 0.4)');
  assert.equal(controller.handle.root.style.display, 'block');

  setPanelAlpha(controller.handle, 0.25);
  assert.equal(panel.style.backgroundColor, 'rgba(0, 0, 0, 0.25)');

  controller.setEnabled(false);
  assert.equal(controller.handle.root.style.display, 'none');
});
