import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUltraFocusController,
  createUltraFocusRoot,
  getExistingUltraFocusRoot,
  getParagraphCandidates,
} from '../shared/ultra-focus.js';

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this.textContent = '';
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
    if (selector === 'p') {
      return this.tagName.toLowerCase() === 'p';
    }

    const attrMatch = selector.match(/^\[(.+?)(?:="(.+?)")?\]$/);
    if (!attrMatch) return false;
    const [, name, value] = attrMatch;
    if (!this.attributes.has(name)) return false;
    if (value === undefined) return true;
    return this.getAttribute(name) === value;
  }

  querySelector(selector) {
    if (this.matchesSelector(selector)) {
      return this;
    }
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    let results = [];
    if (this.matchesSelector(selector)) {
      results.push(this);
    }
    for (const child of this.children) {
      results = results.concat(child.querySelectorAll(selector));
    }
    return results;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('BODY');
    this.documentElement = new FakeElement('HTML');
    this.body.ownerDocument = this;
    this.documentElement.ownerDocument = this;
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

test('createUltraFocusRoot reuses the root and attaches once', () => {
  const document = new FakeDocument();

  const first = createUltraFocusRoot(document);
  const second = createUltraFocusRoot(document);

  assert.equal(first.root, second.root, 'root is reused');
  assert.equal(document.body.children.length, 1, 'root appended once');
});

test('ultra focus controller removes the root when disabled', () => {
  const document = new FakeDocument();

  const controller = createUltraFocusController(document);
  controller.setEnabled(true);

  assert.ok(getExistingUltraFocusRoot(document), 'root is created');

  controller.setEnabled(false);
  assert.equal(getExistingUltraFocusRoot(document), null, 'root removed on disable');
});

test('getParagraphCandidates handles empty scopes', () => {
  const document = new FakeDocument();

  const candidates = getParagraphCandidates(document.body);
  assert.equal(candidates.length, 0);
});
