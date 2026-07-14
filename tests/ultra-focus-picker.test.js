import assert from 'node:assert/strict';
import test from 'node:test';
import {
  navigateNeighbor,
  pickCandidateFromPoint,
  pickMeaningfulElement,
} from '../shared/ultra-focus-picker.js';

class FakeElement {
  constructor(tagName = 'DIV') {
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.textContent = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    this.style = { display: 'block', visibility: 'visible', opacity: '1' };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  getAttributeNames() {
    return Array.from(this.attributes.keys());
  }

  matches(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    return selectors.some((item) => item.toLowerCase() === this.tagName.toLowerCase());
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

class FakeDocument {
  constructor(elementsFromPoint) {
    this._elementsFromPoint = elementsFromPoint;
    this.documentElement = { clientWidth: 1200, clientHeight: 800 };
    this.defaultView = {
      innerWidth: 1200,
      innerHeight: 800,
      getComputedStyle: (el) => el.style,
    };
  }

  elementsFromPoint(x, y) {
    return this._elementsFromPoint?.(x, y) || [];
  }
}

test('pickMeaningfulElement climbs to a paragraph block', () => {
  const container = new FakeElement('DIV');
  const paragraph = new FakeElement('P');
  paragraph.textContent = 'This is a paragraph with meaningful text content.';
  const span = new FakeElement('SPAN');

  container.appendChild(paragraph).appendChild(span);

  const picked = pickMeaningfulElement(span, { minTextLength: 10 });
  assert.equal(picked, paragraph);
});

test('pickCandidateFromPoint prefers the closest candidate', () => {
  const left = new FakeElement('P');
  left.textContent = 'Left content block with enough text.';
  left.rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 };

  const right = new FakeElement('P');
  right.textContent = 'Right content block with enough text.';
  right.rect = { left: 220, top: 0, width: 200, height: 100, right: 420, bottom: 100 };

  const doc = new FakeDocument(() => [right, left]);
  const result = pickCandidateFromPoint(doc, { x: 40, y: 20 }, { minTextLength: 10 });

  assert.equal(result.picked, left);
  assert.deepEqual(result.candidates, [right, left]);
});

test('navigateNeighbor moves to the right neighbor', () => {
  const left = new FakeElement('DIV');
  left.textContent = 'Left block with enough text.';
  left.rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };

  const right = new FakeElement('DIV');
  right.textContent = 'Right block with enough text.';
  right.rect = { left: 140, top: 0, width: 100, height: 100, right: 240, bottom: 100 };

  const doc = new FakeDocument((x, y) => {
    if (x > 120) return [right];
    return [left];
  });

  const neighbor = navigateNeighbor(doc, left, 'RIGHT', { minTextLength: 10 });
  assert.equal(neighbor, right);
});
