export class FakeElement {
  constructor(tagName = 'div', {
    text = '',
    role = '',
    id = '',
    className = '',
    rect = { left: 0, top: 0, width: 400, height: 300 },
    style = {},
    attributes = {},
  } = {}) {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.role = role;
    this.id = id;
    this.className = className;
    this._rect = rect;
    this._style = { display: 'block', visibility: 'visible', position: 'static', ...style };
    this._attributes = { ...attributes };
    this.children = [];
    this.parentNode = null;
    this.mutations = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent).join('')}`;
  }

  getAttribute(name) {
    if (name === 'role') return this.role || this._attributes.role || null;
    return this._attributes[name] || null;
  }

  setAttribute(name, value) {
    this.mutations.push({ type: 'setAttribute', name, value });
  }

  removeAttribute(name) {
    this.mutations.push({ type: 'removeAttribute', name });
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    const matches = [];

    const walk = (el) => {
      if (selectors.some((item) => matchesSelector(el, item))) {
        matches.push(el);
      }
      el.children.forEach(walk);
    };

    this.children.forEach(walk);
    return matches;
  }
}

export function matchesSelector(el, selector) {
  const tag = el.tagName.toLowerCase();
  if (selector === '*') return true;
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return tag === selector.toLowerCase();
  if (selector === '.modal') return String(el.className || '').split(/\s+/).includes('modal');
  if (selector === '[data-article-body]') return Boolean(el.getAttribute('data-article-body'));
  if (selector === '[data-modal]') return Boolean(el.getAttribute('data-modal'));
  if (selector === '[tabindex]') return Boolean(el.getAttribute('tabindex'));

  const roleMatch = selector.match(/^\[role="([^"]+)"\]$/);
  if (roleMatch) return el.getAttribute('role') === roleMatch[1];

  const attrMatch = selector.match(/^\[([^=\]]+)="([^"]+)"\]$/);
  if (attrMatch) return el.getAttribute(attrMatch[1]) === attrMatch[2];

  return false;
}

export class FakeDocument {
  constructor(body, {
    width = 1200,
    height = 800,
    pathname = '/articles/read',
    search = '?private=1',
  } = {}) {
    this.body = body;
    this.documentElement = { clientWidth: width, clientHeight: height };
    this.location = {
      href: 'https://example.test/private/full/url',
      pathname,
      search,
    };
    this.defaultView = {
      innerWidth: width,
      innerHeight: height,
      performance: { now: () => 5 },
      getComputedStyle: (el) => el?._style || { display: 'block', visibility: 'visible', position: 'static' },
    };
  }

  querySelector(selector) {
    if (matchesSelector(this.body, selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    const matches = selectors.some((item) => matchesSelector(this.body, item)) ? [this.body] : [];
    return matches.concat(this.body.querySelectorAll(selector));
  }
}

export function walkElements(root, visit) {
  if (!root) return;
  visit(root);
  root.children.forEach((child) => walkElements(child, visit));
}

export function buildArticleDocument() {
  const body = new FakeElement('body', {
    id: 'private-body-id',
    className: 'private-body-class',
    rect: { left: 0, top: 0, width: 1200, height: 1600 },
  });
  const main = body.appendChild(new FakeElement('main', {
    text: 'PRIVATE_ARTICLE_TEXT_'.repeat(140),
    id: 'private-main-id',
    className: 'private-main-class',
    rect: { left: 180, top: 20, width: 760, height: 1000 },
  }));
  main.appendChild(new FakeElement('h1', { text: 'PRIVATE_TITLE' }));
  main.appendChild(new FakeElement('h2', { text: 'PRIVATE_SUBTITLE' }));
  main.appendChild(new FakeElement('p', { text: 'PRIVATE_PARAGRAPH_A'.repeat(40) }));
  main.appendChild(new FakeElement('p', { text: 'PRIVATE_PARAGRAPH_B'.repeat(40) }));
  main.appendChild(new FakeElement('a', {
    text: 'PRIVATE_LINK_TEXT',
    attributes: { href: 'https://example.test/private-link' },
  }));
  return new FakeDocument(body);
}

export function buildMixedDocument() {
  const body = new FakeElement('body', { rect: { left: 0, top: 0, width: 1200, height: 1000 } });
  body.appendChild(new FakeElement('video', {
    attributes: { src: 'https://cdn.example.test/private-video.mp4' },
    rect: { left: 0, top: 0, width: 900, height: 500 },
  }));
  const form = body.appendChild(new FakeElement('form', {
    rect: { left: 40, top: 520, width: 500, height: 320 },
  }));
  form.appendChild(new FakeElement('input'));
  form.appendChild(new FakeElement('button', { text: 'PRIVATE_BUTTON' }));
  const table = body.appendChild(new FakeElement('table', {
    rect: { left: 560, top: 520, width: 520, height: 320 },
  }));
  table.appendChild(new FakeElement('tr'));
  table.appendChild(new FakeElement('tr'));
  return new FakeDocument(body, { pathname: '/watch', search: '?v=abc123' });
}
