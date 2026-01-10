import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReadingRulerController,
  createReadingRulerRoot,
  getExistingReadingRulerRoot,
  updateReadingRuler,
} from '../shared/reading-ruler.js';

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

  requestAnimationFrame(cb) {
    cb();
    return 1;
  }
}

class FakeDocument {
  constructor(defaultView = null, viewportHeight = 0) {
    this.body = new FakeElement('BODY');
    this.documentElement = new FakeElement('HTML');
    this.documentElement.clientHeight = viewportHeight;
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
