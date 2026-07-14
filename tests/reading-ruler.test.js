import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  createReadingRulerController,
  createReadingRulerRoot,
  getExistingReadingRulerRoot,
  updateReadingRuler,
} from '../shared/reading-ruler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentRuntimeSource = readFileSync(resolve(__dirname, '../content/reading-ruler.runtime.js'), 'utf8');
const contentMainSource = readFileSync(resolve(__dirname, '../content/content-main.js'), 'utf8');

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this.ownerDocument = null;
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
    const attrMatch = selector.match(/^\[(.+?)(?:="(.+?)")?\]$/);
    if (!attrMatch) return false;
    const [, name, value] = attrMatch;
    if (!this.attributes.has(name)) return false;
    if (value === undefined) return true;
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

class FakeWindow {
  constructor() {
    this.listeners = new Map();
    this.innerHeight = 800;
    this.dispatched = [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (!this.listeners.has(type)) return;
    this.listeners.get(type).delete(listener);
  }

  dispatchEvent(event) {
    this.dispatched.push(event);
    const listeners = this.listeners.get(event?.type) || new Set();
    for (const listener of listeners) {
      listener(event);
    }
    return true;
  }

  requestAnimationFrame(cb) {
    cb();
    return 1;
  }

  cancelAnimationFrame() {}
}

class FakeDocument {
  constructor(defaultView = null, viewportHeight = 0) {
    this.body = new FakeElement('BODY');
    this.documentElement = new FakeElement('HTML');
    this.documentElement.clientHeight = viewportHeight;
    this.body.ownerDocument = this;
    this.documentElement.ownerDocument = this;
    this.defaultView = defaultView;
    this.listeners = new Map();
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

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    if (!this.listeners.has(type)) return;
    this.listeners.get(type).delete(listener);
  }

  getSelection() {
    return null;
  }
}

test('createReadingRulerRoot reuses the root and centers the band', () => {
  const view = new FakeWindow();
  const document = new FakeDocument(view, 900);

  const first = createReadingRulerRoot(document, { heightPx: 120, opacity: 0.2 });
  const second = createReadingRulerRoot(document, { heightPx: 200, opacity: 0.1 });

  assert.equal(first.root, second.root, 'root is reused');
  assert.equal(document.body.children.length, 1, 'root appended once');

  updateReadingRuler(first, { heightPx: 120, opacity: 0.2 });
  assert.equal(first.band.style.top, '390px');
});

test('reading ruler controller removes the root when disabled', () => {
  const view = new FakeWindow();
  const document = new FakeDocument(view, 800);

  const controller = createReadingRulerController(document, { heightPx: 110, opacity: 0.15 });
  controller.setEnabled(true);

  const root = getExistingReadingRulerRoot(document);
  assert.ok(root, 'root is created');

  controller.setEnabled(false);
  assert.equal(getExistingReadingRulerRoot(document), null, 'root removed on disable');
});

test('content reading ruler runtime exits on Escape and restores exact marker state', () => {
  const view = new FakeWindow();
  const document = new FakeDocument(view, 800);
  const controllerCalls = [];
  const controller = {
    setMode(mode) {
      controllerCalls.push(['mode', mode]);
    },
    setBand(band) {
      controllerCalls.push(['band', band]);
    },
    setEnabled(enabled, options) {
      controllerCalls.push(['enabled', enabled, options || null]);
    },
  };
  const sandbox = {
    console,
    document,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    AURA_FOCUS_ENGINE: {
      getSharedController(kind, owner) {
        assert.equal(kind, 'band');
        assert.equal(owner, 'reading-ruler');
        return controller;
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = view.addEventListener.bind(view);
  sandbox.removeEventListener = view.removeEventListener.bind(view);
  sandbox.dispatchEvent = view.dispatchEvent.bind(view);
  sandbox.requestAnimationFrame = view.requestAnimationFrame.bind(view);
  sandbox.cancelAnimationFrame = view.cancelAnimationFrame.bind(view);
  document.defaultView = sandbox;

  runInNewContext(contentRuntimeSource, sandbox);

  sandbox.dispatchEvent(new sandbox.CustomEvent('aura:readingRuler:set', {
    detail: { enabled: true, heightPx: 140, opacity: 0.2 },
  }));
  assert.equal(
    document.querySelector('[data-aura-reading-ruler="v2"]'),
    null,
    'public page events cannot control the isolated runtime',
  );

  let exitReason = null;
  sandbox.AURA_READING_RULER.onExit((detail) => {
    exitReason = detail?.reason || null;
  });
  sandbox.AURA_READING_RULER.setState({ enabled: true, heightPx: 140, opacity: 0.2 });

  assert.ok(document.querySelector('[data-aura-reading-ruler="v2"]'), 'runtime marker exists while enabled');

  sandbox.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    isTrusted: false,
    preventDefault() {},
  });
  assert.ok(document.querySelector('[data-aura-reading-ruler="v2"]'), 'synthetic Escape is ignored');

  let prevented = false;
  sandbox.dispatchEvent({
    type: 'keydown',
    key: 'Escape',
    isTrusted: true,
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true, 'Escape is consumed as the explicit exit key');
  assert.equal(document.querySelector('[data-aura-reading-ruler="v2"]'), null, 'runtime marker removed on exit');
  assert.ok(
    controllerCalls.some(([kind, value]) => kind === 'enabled' && value === false),
    'shared band controller is disabled',
  );
  assert.equal(exitReason, 'escape', 'runtime notifies the private orchestrator callback');
});

test('content orchestrator turns Reading Ruler off after runtime Escape exit', () => {
  assert.doesNotMatch(contentMainSource, /aura:readingRuler:exit/);
  assert.match(contentMainSource, /AURA_READING_RULER\?\.onExit/);
  assert.match(contentMainSource, /event\.isTrusted !== true/);
  assert.match(contentMainSource, /if \(typeof collector !== 'function'\) \{\s*return false;\s*\}/);
  assert.match(contentMainSource, /setReadingRulerPreference\(false, 'reading-ruler-exit'\)/);
});
