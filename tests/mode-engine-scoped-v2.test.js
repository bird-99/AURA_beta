import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODE_ENGINE_SCOPE_ATTR,
  MODE_ENGINE_SCOPE_OWNER_ATTR,
  MODE_ENGINE_SCOPE_SELECTOR,
  MODE_ENGINE_SCOPE_TOKENS_ATTR,
  SCOPE_ATTR,
  SCOPE_ATTR_VALUE,
  SCOPE_OWNER_ATTR,
  SCOPE_OWNER_VALUE,
  applyTokensToScopeRoot,
  computeAppliedHash,
  computeTokensV2,
  makeScopedV2Key,
  applyScopedTokens,
  cleanupScopedTokens,
  buildScopedModeCssV2,
  buildScopedTokenMap,
  descendCandidateForContentRoot,
  markScopeOwned,
  removeTokensOwned,
  unmarkScopeIfOwned,
  verifyScopeRoot,
} from '../shared/mode-engine-scoped-v2.js';
import { ACTIONS, MODE_IDS } from '../shared/constants.js';
import { applyScopedModeV2, getScopedModeV2State, removeScopedModeV2 } from '../background/css-applier.js';
import { cssRegistry } from '../background/css-registry.js';

class MockElement {
  constructor(tagName = 'ARTICLE') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.style = new Map();
    this.style.setProperty = (name, value) => this.style.set(name, value);
    this.style.removeProperty = (name) => this.style.delete(name);
    this.nodeType = 1;
    this.isConnected = true;
    this.clientWidth = 320;
    this.clientHeight = 240;
    this.ownerDocument = {
      defaultView: {
        innerWidth: 800,
        innerHeight: 600,
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      },
      documentElement: {
        clientWidth: 800,
        clientHeight: 600,
      },
    };
    this.rect = {
      width: this.clientWidth,
      height: this.clientHeight,
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function buildTokenSet() {
  return buildScopedTokenMap(MODE_IDS.COMFORT_VISUAL, 1);
}

function setupScopedEnvironment(scopeEl, registryEntry = null) {
  const removeCssCalls = [];
  const originalChrome = global.chrome;
  const originalDocument = global.document;
  const originalRegistryGet = cssRegistry.get;
  const originalRegistryRemove = cssRegistry.remove;

  global.document = { querySelector: () => scopeEl };
  global.chrome = {
    scripting: {
      removeCSS: async (options) => {
        removeCssCalls.push(options);
      },
      executeScript: async ({ func, args }) => [{ result: func(...(args || [])) }],
    },
    tabs: {
      sendMessage: (_tabId, message, options, callback) => {
        const actualCallback = typeof options === 'function' ? options : callback;
        let response = null;
        if (message.action === ACTIONS.MODE_ENGINE_V2_CLEANUP_SCOPE_TOKENS) {
          const ownedKeys = (scopeEl?.getAttribute?.(MODE_ENGINE_SCOPE_TOKENS_ATTR) || '')
            .split(',')
            .filter(Boolean);
          const result = cleanupScopedTokens(scopeEl, message.ownerKey || SCOPE_OWNER_VALUE, ownedKeys);
          if (!result?.ok && result?.reason === 'not-owner' && scopeEl?.style?.removeProperty) {
            ownedKeys.forEach((token) => {
              scopeEl.style.removeProperty(token);
            });
            response = { ok: true, removed: ownedKeys.length, scopeUnmarked: false, reason: 'not-owner' };
          } else {
            response = {
              ...result,
              scopeUnmarked: result?.ok ? scopeEl?.getAttribute?.(SCOPE_ATTR) !== SCOPE_ATTR_VALUE : false,
            };
          }
        }

        if (typeof actualCallback === 'function') {
          actualCallback(response);
        }
        return response;
      },
      get: async () => ({ url: 'https://example.com/page' }),
    },
    runtime: { lastError: null },
  };

  cssRegistry.get = async () => registryEntry;
  cssRegistry.remove = async () => {};

  const restore = () => {
    cssRegistry.get = originalRegistryGet;
    cssRegistry.remove = originalRegistryRemove;

    if (originalChrome === undefined) {
      delete global.chrome;
    } else {
      global.chrome = originalChrome;
    }

    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
  };

  return { removeCssCalls, restore };
}

test('computeTokensV2 returns owned keys aligned with tokens', () => {
  const { tokens, ownedKeys } = computeTokensV2({ modeId: MODE_IDS.FOCUS, intensity: 0.5 });

  assert(Object.keys(tokens).length > 0);
  assert.deepEqual(ownedKeys.sort(), Object.keys(tokens).sort());
});

test('applyScopedTokens sets tokens only on the target element', () => {
  const el = new MockElement();
  const result = applyScopedTokens(el, buildTokenSet(), 'owner-1');

  assert.equal(result.ok, true);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_ATTR), SCOPE_ATTR_VALUE);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR), 'owner-1');
  const tokensAttr = el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR);
  assert(tokensAttr.includes('--aura-font-size'));
  assert(el.style.get('--aura-font-size'));
});

test('applyTokensToScopeRoot rejects html/body roots', () => {
  const html = new MockElement('HTML');
  const body = new MockElement('BODY');

  assert.equal(applyTokensToScopeRoot(html, buildTokenSet()).ok, false);
  assert.equal(applyTokensToScopeRoot(body, buildTokenSet()).ok, false);
  assert.equal(html.style.get('--aura-font-size'), undefined);
  assert.equal(body.style.get('--aura-font-size'), undefined);
});

test('cleanupScopedTokens removes owned tokens and attributes', () => {
  const el = new MockElement();
  applyScopedTokens(el, buildTokenSet(), 'owner-1');

  const cleanup = cleanupScopedTokens(el, 'owner-1');
  assert.equal(cleanup.ok, true);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_ATTR), null);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR), null);
  assert.equal(el.style.get('--aura-font-size'), undefined);
});

test('cleanupScopedTokens removes token attribute when explicit owned keys are provided', () => {
  const el = new MockElement();
  applyScopedTokens(el, buildTokenSet(), 'owner-1');

  const cleanup = cleanupScopedTokens(el, 'owner-1', ['--aura-font-size']);

  assert.equal(cleanup.ok, true);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR), null);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_ATTR), null);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR), null);
  assert.equal(el.style.get('--aura-font-size'), undefined);
});

test('cleanupScopedTokens preserves scope attr when owner does not match', () => {
  const el = new MockElement();
  applyScopedTokens(el, buildTokenSet(), 'owner-1');

  const result = cleanupScopedTokens(el, 'other-owner');
  assert.equal(result.ok, false);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_ATTR), SCOPE_ATTR_VALUE);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_OWNER_ATTR), 'owner-1');
});

test('verifyScopeRoot rejects invalid candidates', () => {
  const detached = new MockElement();
  detached.isConnected = false;
  assert.equal(verifyScopeRoot(detached).ok, false);

  const nav = new MockElement('NAV');
  assert.equal(verifyScopeRoot(nav).ok, false);

  const body = new MockElement('BODY');
  assert.equal(verifyScopeRoot(body).reason, 'ROOT_IS_BODY');

  const html = new MockElement('HTML');
  assert.equal(verifyScopeRoot(html).reason, 'ROOT_IS_HTML');

  const hidden = new MockElement();
  hidden.ownerDocument.defaultView.getComputedStyle = () => ({ display: 'none', visibility: 'hidden' });
  assert.equal(verifyScopeRoot(hidden).reason, 'ROOT_HIDDEN');
});

test('verifyScopeRoot rejects visibility hidden even when sized', () => {
  const el = new MockElement();
  el.ownerDocument.defaultView.getComputedStyle = () => ({ display: 'block', visibility: 'hidden' });
  assert.equal(verifyScopeRoot(el).reason, 'ROOT_HIDDEN');
});

test('verifyScopeRoot accepts visible, sizable roots', () => {
  const el = new MockElement();
  const result = verifyScopeRoot(el);
  assert.equal(result.ok, true);
});

test('verifyScopeRoot allows tall content that does not fully cover the viewport', () => {
  const el = new MockElement('ARTICLE');
  el.rect = {
    width: 600,
    height: 5000,
    left: 0,
    top: 0,
    right: 600,
    bottom: 5000,
  };
  const result = verifyScopeRoot(el);
  assert.equal(result.ok, true);
});

test('verifyScopeRoot allows semantic main elements that cover the viewport', () => {
  const el = new MockElement('MAIN');
  el.rect = {
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
  };
  const result = verifyScopeRoot(el);
  assert.equal(result.ok, true);
});

test('verifyScopeRoot allows semantic article elements that cover the viewport', () => {
  const el = new MockElement('ARTICLE');
  el.rect = {
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
  };
  const result = verifyScopeRoot(el);
  assert.equal(result.ok, true);
});

test('verifyScopeRoot rejects generic wrappers that cover the viewport', () => {
  const el = new MockElement('DIV');
  el.rect = {
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
  };
  const result = verifyScopeRoot(el);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ROOT_TOO_LARGE');
});

test('descendCandidateForContentRoot selects a child when root is too large', async () => {
  const child = new MockElement('ARTICLE');
  child.rect = {
    width: 640,
    height: 800,
    left: 80,
    top: 0,
    right: 720,
    bottom: 800,
  };
  const candidate = new MockElement('DIV');
  candidate.rect = {
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
  };
  candidate.querySelector = (selector) => (selector === 'article' ? child : null);
  candidate.querySelectorAll = () => [child];

  assert.equal(verifyScopeRoot(candidate).reason, 'ROOT_TOO_LARGE');
  const result = await descendCandidateForContentRoot(candidate, { maxNodes: 10, chunkSize: 5, yieldToMain: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.element, child);
});

test('markScopeOwned tags scope with ownership and respects conflicts', () => {
  const el = new MockElement();
  const first = markScopeOwned(el);
  assert.equal(first.didMark, true);
  assert.equal(el.getAttribute(SCOPE_ATTR), SCOPE_ATTR_VALUE);
  assert.equal(el.getAttribute(SCOPE_OWNER_ATTR), SCOPE_OWNER_VALUE);

  el.setAttribute(SCOPE_OWNER_ATTR, 'external');
  const second = markScopeOwned(el);
  assert.equal(second.didMark, false);
  assert.equal(el.getAttribute(SCOPE_OWNER_ATTR), 'external');
});

test('unmarkScopeIfOwned only removes when owner matches', () => {
  const el = new MockElement();
  markScopeOwned(el);
  el.setAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR, '--aura-font-size');

  const blocked = unmarkScopeIfOwned(el, 'other-owner');
  assert.equal(blocked.didUnmark, false);
  assert.equal(el.getAttribute(SCOPE_OWNER_ATTR), SCOPE_OWNER_VALUE);

  const cleared = unmarkScopeIfOwned(el, SCOPE_OWNER_VALUE);
  assert.equal(cleared.didUnmark, true);
  assert.equal(el.getAttribute(SCOPE_ATTR), null);
  assert.equal(el.getAttribute(SCOPE_OWNER_ATTR), null);
});

test('buildScopedModeCssV2 scopes all rules to the aura selector', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.FOCUS, intensity: 0.5 });
  assert(css.includes(MODE_ENGINE_SCOPE_SELECTOR));
  assert(!/body\s*\{[^}]*font-size/i.test(css));
});

test('buildScopedModeCssV2 includes focus-visible rules for focus mode', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.FOCUS, intensity: 0.5 });

  assert(css.includes(':focus-visible'));
  assert(css.includes(':focus { outline: 2px solid'));
  assert(css.includes('text-decoration: underline'));
  assert(css.includes(MODE_ENGINE_SCOPE_SELECTOR));
});

test('buildScopedModeCssV2 includes reduce motion rules when focus reduceMotion is enabled', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.FOCUS, intensity: 0.5, reduceMotion: true });

  assert(css.includes('animation-duration'));
  assert(css.includes('scroll-behavior: auto'));
});

test('buildScopedModeCssV2 omits reduce motion rules when focus reduceMotion is disabled', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.FOCUS, intensity: 0.5, reduceMotion: false });

  assert.equal(css.includes('animation-duration'), false);
  assert.equal(css.includes('scroll-behavior: auto'), false);
});

test('buildScopedModeCssV2 adds scoped transitions when enabled', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, smoothTransitions: true });

  assert(css.includes('[data-aura-scope="1"][data-aura-anim="1"]'));
  assert(css.includes('transition-property: color'));
  assert(css.includes('transition-duration: 160ms'));
  assert(css.includes('@media (prefers-reduced-motion: reduce)'));
});

test('buildScopedModeCssV2 keeps transitions when smooth transitions enabled without reduce motion', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    smoothTransitions: true,
    reduceMotion: false,
  });

  assert(css.includes('[data-aura-scope="1"][data-aura-anim="1"]'));
  assert(css.includes('transition-property: color'));
});

test('buildScopedModeCssV2 omits transitions when smooth transitions are disabled', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    smoothTransitions: false,
  });

  assert.equal(css.includes('[data-aura-scope="1"][data-aura-anim="1"]'), false);
  assert.equal(css.includes('transition-property: color'), false);
  assert.equal(css.includes('@media (prefers-reduced-motion: reduce)'), false);
});

test('buildScopedModeCssV2 disables transitions when reduce motion is enabled with transitions', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    smoothTransitions: true,
    reduceMotion: true,
  });

  assert(css.includes('animation-duration: 0.01ms'));
  assert(css.includes('transition-duration: 0.01ms'));
});

test('buildScopedModeCssV2 omits root selectors and keeps scoped fallbacks', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.75 });
  const tokens = buildScopedTokenMap(MODE_IDS.COMFORT_VISUAL, 0.75);
  const selectors = css.match(/[^{}]+\{/g) || [];

  for (const selector of selectors) {
    assert(selector.includes(MODE_ENGINE_SCOPE_SELECTOR));
  }

  assert(!/:root\b/i.test(css));
  assert(!/\bhtml\b/i.test(css));
  const cssWithoutBodyCustomNames = css
    .replace(/::part\(body\)/gi, '::part(componentBodyPart)')
    .replace(/--[\w-]*body[\w-]*/gi, '--custom-property');
  assert(!/\bbody\b/i.test(cssWithoutBodyCustomNames));
  assert(css.includes('--aura-font-size'));
  assert(Object.keys(tokens).includes('--aura-letter-spacing'));
  assert(css.includes('letter-spacing: var(--aura-letter-spacing'));
  assert(css.includes('p + p { margin-top: var(--aura-paragraph-spacing'));
  assert(css.includes('word-spacing: 0.02em'));
  assert(css.includes('text-rendering: optimizeLegibility'));
  assert(css.includes('font-kerning: normal'));
  assert(css.includes('color: var(--aura-text-color) !important'));
  assert.match(
    css,
    /:where\(p, li, blockquote, dd, dt, span, em, strong, small, th, td, label, legend, caption, figcaption\)\s*\{[^}]*-webkit-text-fill-color:\s*var\(--aura-text-color\)\s*!important;/,
  );
  assert(css.includes('overflow-wrap: var(--aura-overflow-wrap'));
  assert(css.includes('word-break: var(--aura-word-break'));
  assert(css.includes('hyphens: var(--aura-hyphens'));
  assert.match(css, /:where\(p, blockquote, dd, dt\)\s*\{[^}]*overflow-wrap: var\(--aura-overflow-wrap/);
  assert.match(css, /:where\(pre, code, kbd, samp\)\s*\{[^}]*overflow-wrap: normal/);
  assert.doesNotMatch(css, /:is\(p, li, blockquote, pre, code, dd, dt\)\s*\{[^}]*overflow-wrap/);
  assert(css.includes('text-decoration-thickness: var(--aura-link-decoration-thickness'));
  assert(css.includes('text-underline-offset: var(--aura-link-decoration-offset'));
  assert(css.includes(':visited { color:'));
});

test('buildScopedModeCssV2 includes bounded dark part selectors for web components', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 1 });

  assert.match(css, /color-scheme:\s*var\(--aura-color-scheme\)\s*!important/);
  assert(css.includes(`${MODE_ENGINE_SCOPE_SELECTOR}[data-aura-scope-tokens*="--aura-color-scheme"] :where(*)::part(surface)`));
  assert(css.includes('::part(panel)'));
  assert(css.includes('::part(heading)'));
  assert(css.includes('::part(button)'));
  assert(css.includes('::part(input)'));
  assert(css.includes('accent-color: var(--aura-focus-color)'));
  assert(!css.includes('::part(*)'));
  assert.match(
    css,
    /::part\(surface\)[^{]+\{[^}]*background-color:\s*var\(--aura-surface-1\)\s*!important;/,
  );
  assert.match(
    css,
    /::part\(button\)[^{]+\{[^}]*background-color:\s*var\(--aura-surface-2\)\s*!important;[^}]*accent-color:\s*var\(--aura-focus-color\)/,
  );
});

test('buildScopedModeCssV2 preserves format-sensitive tokens and maps framework-specific colors', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 1 });

  assert.doesNotMatch(css, /--background\s*:/);
  assert.doesNotMatch(css, /--foreground\s*:/);
  assert.doesNotMatch(css, /--card\s*:/);
  assert.doesNotMatch(css, /--border\s*:/);
  assert.doesNotMatch(css, /--color-link\s*:/);
  assert.match(css, /--bs-body-bg:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(css, /--bs-body-color:\s*var\(--aura-text-color\)\s*!important/);
  assert.match(css, /--mui-palette-background-paper:\s*var\(--aura-surface-1\)\s*!important/);
  assert.match(css, /--mui-palette-text-primary:\s*var\(--aura-text-color\)\s*!important/);
  assert.match(css, /--ant-color-bg-container:\s*var\(--aura-surface-1\)\s*!important/);
  assert.match(css, /--ant-color-text:\s*var\(--aura-text-color\)\s*!important/);
  assert.match(css, /--chakra-colors-chakra-body-bg:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(css, /--chakra-colors-fg:\s*var\(--aura-text-color\)\s*!important/);
  assert.match(css, /--md-sys-color-surface:\s*var\(--aura-surface-1\)\s*!important/);
  assert.match(css, /--bgColor-default:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(css, /\[data-aura-scope="1"\]\[data-aura-scope-tokens\*="--aura-color-scheme"\] :where\(dialog, \[popover\]/);
  assert.match(css, /\[class\*="card" i\]/);
  assert.match(css, /\[data-bs-theme\]/);
  assert.doesNotMatch(css, /--site-private-theme-color/);
});

test('buildScopedModeCssV2 darkens top-layer and portal overlay surfaces', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 1 });

  assert.match(css, /\[popover\]/);
  assert.match(css, /\[aria-modal="true"\]/);
  assert.match(css, /\[data-radix-popper-content-wrapper\]/);
  assert.match(css, /\[data-headlessui-portal\]/);
  assert.match(css, /\[data-floating-ui-portal\]/);
  assert.match(css, /\[class\*="tooltip" i\]/);
  assert.match(css, /\[class\*="overlay" i\]/);
  assert.match(css, /\[class\*="portal" i\]/);
  assert.match(css, /\[role="tooltip"\]/);
  assert.match(css, /\[role="tree"\]/);
  assert.match(css, /\[role="tablist"\]/);
  assert.match(
    css,
    /\[data-aura-scope="1"\]\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s+:where\(dialog, \[popover\][^{]+\{[^}]*background-color:\s*var\(--aura-surface-1\)\s*!important;[^}]*box-shadow:\s*0 12px 32px rgba\(0, 0, 0, 0\.35\)\s*!important;/,
  );
  assert.match(
    css,
    /\[data-aura-scope="1"\]\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s+:where\(dialog, \[popover\][^{]+:where\(a, \[role="link"\], button/,
  );
  assert.doesNotMatch(css, /\bbody\s+:where\(dialog, \[popover\]/);
  assert.doesNotMatch(css, /\bhtml\s+:where\(dialog, \[popover\]/);
});

test('buildScopedModeCssV2 darkens tagged app shell surfaces without global selectors', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 1 });

  assert.match(css, /\[data-aura-surface-kind="app-shell"\]\s*\{[^}]*background-color:\s*var\(--aura-surface-2\)\s*!important/);
  assert.match(css, /\[data-aura-surface-kind="app-shell"\]\s*\{[^}]*box-shadow:\s*0 1px 0 var\(--aura-border-color\)\s*!important/);
  assert.match(css, /\[data-aura-surface-kind="app-shell"\]\s*:where\(a, \[role="link"\], button/);
  assert.doesNotMatch(css, /\bbody\s+\[data-aura-surface-kind="app-shell"\]/);
  assert.doesNotMatch(css, /\bhtml\s+\[data-aura-surface-kind="app-shell"\]/);
});

test('buildScopedModeCssV2 keeps heading text fill color for readability', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 });

  assert(css.includes(':where(h1, h2, h3, h4, h5, h6, [role="heading"])'));
  assert(css.includes('color: var(--aura-text-color) !important'));
  assert(css.includes('-webkit-text-fill-color: var(--aura-text-color) !important'));
});

test('buildScopedModeCssV2 force-text rules override webkit text fill color', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 });

  assert.match(
    css,
    /\[data-aura-force-text="1"\]\s*\{\s*color:\s*var\(--aura-text-color\)\s*!important;\s*-webkit-text-fill-color:\s*var\(--aura-text-color\)\s*!important;/,
  );
  assert.match(
    css,
    /\[data-aura-force-text="1"\]\s*:where\([^)]*\)\s*\{\s*color:\s*var\(--aura-text-color\)\s*!important;\s*-webkit-text-fill-color:\s*var\(--aura-text-color\)\s*!important;/,
  );
});

test('buildScopedModeCssV2 form controls override webkit text fill color', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 });

  assert.match(
    css,
    /:where\(input, textarea, select, button\)\s*\{[^}]*color:\s*var\(--aura-text-color\)\s*!important;\s*-webkit-text-fill-color:\s*var\(--aura-text-color\)\s*!important;[^}]*border-color:\s*var\(--aura-border-color\)\s*!important;/,
  );
});

test('buildScopedModeCssV2 dark token scopes cover complex wiki article surfaces', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 });

  assert.match(css, /\[data-aura-scope-tokens\*="--aura-color-scheme"\]/);
  assert.match(css, /\[class\*="mw-" i\]/);
  assert.match(css, /\[class\*="vector-" i\]/);
  assert.match(css, /\[class\*="infobox" i\]/);
  assert.match(css, /\[id\*="wiki" i\]/);
  assert.match(css, /\[id\*="infobox" i\]/);
  assert.match(css, /\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s*\{[^}]*background-color:\s*var\(--aura-bg-color\)\s*!important/);
  assert.match(css, /:is\(\[class\*="mw-" i\]/);
  assert.match(css, /background-image:\s*none\s*!important/);
  assert.doesNotMatch(css, /\[data-aura-scope="1"\]\s+\*\s*\{[^}]*background-image:\s*none\s*!important/);
});

test('buildScopedModeCssV2 dark token scopes cover targeted pseudo surfaces', () => {
  const css = buildScopedModeCssV2({ modeId: MODE_IDS.COMFORT_VISUAL, intensity: 0.6 });

  assert.match(css, /\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s+:where\([^)]*\[data-callout\][^)]*\)::before/);
  assert.match(css, /\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s+:where\([^)]*\[class\*="card" i\][^)]*\)::after/);
  assert.match(
    css,
    /::before,\s*\[data-aura-scope="1"\]\[data-aura-scope-tokens\*="--aura-color-scheme"\]\s+:where\([^)]*\)::after\s*\{[^}]*background-color:\s*var\(--aura-surface-1\)\s*!important;[^}]*background-image:\s*none\s*!important;[^}]*-webkit-text-fill-color:\s*var\(--aura-text-color\)\s*!important;[^}]*border-color:\s*var\(--aura-border-color\)\s*!important;/,
  );
  assert.doesNotMatch(css, /\[data-aura-scope="1"\]\s+:where\(\*, \*::before, \*::after\)\s*\{[^}]*background-color:\s*var\(--aura-surface-1\)\s*!important/);
});

test('buildScopedModeCssV2 can omit link rules so site-native link styles win', () => {
  const nativeLinks = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.6,
    linkEnhanceEnabled: false,
    linkColorEnabled: false,
  });
  const colorOnly = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.6,
    linkEnhanceEnabled: false,
    linkColorEnabled: true,
  });

  assert.doesNotMatch(nativeLinks, /--aura-link-decoration/);
  assert.doesNotMatch(nativeLinks, /:is\(a, \[role="link"\]\)\s*\{[^}]*--aura-link-color/);
  assert.match(colorOnly, /color: var\(--aura-link-color\)/);
  assert.match(colorOnly, /-webkit-text-fill-color: var\(--aura-link-color\)/);
  assert.doesNotMatch(colorOnly, /text-decoration-line: var\(--aura-link-decoration/);
});

test('buildScopedModeCssV2 omits comfort font-size rules when text scale is disabled', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.6,
    textScaleEnabled: false,
  });

  assert.doesNotMatch(css, /font-size:\s*var\(--aura-font-size/);
  assert.match(css, /line-height: var\(--aura-line-height/);
});

test('buildScopedModeCssV2 omits comfort text rendering refinement rules when disabled', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.6,
    typoSmoothingEnabled: false,
  });
  const focusCss = buildScopedModeCssV2({
    modeId: MODE_IDS.FOCUS,
    intensity: 0.6,
    typoSmoothingEnabled: false,
  });

  assert.doesNotMatch(css, /-webkit-font-smoothing/);
  assert.doesNotMatch(css, /letter-spacing: var\(--aura-letter-spacing/);
  assert.doesNotMatch(css, /word-spacing:\s*0\.02em/);
  assert.doesNotMatch(css, /text-rendering:\s*optimizeLegibility/);
  assert.doesNotMatch(css, /font-kerning:\s*normal/);
  assert.match(focusCss, /letter-spacing: var\(--aura-letter-spacing/);
  assert.doesNotMatch(focusCss, /-webkit-font-smoothing/);
  assert.doesNotMatch(focusCss, /text-rendering:\s*optimizeLegibility/);
});

test('buildScopedModeCssV2 omits comfort spacing rules when spacing pack is disabled', () => {
  const css = buildScopedModeCssV2({
    modeId: MODE_IDS.COMFORT_VISUAL,
    intensity: 0.75,
    spacingPackEnabled: false,
  });
  const focusCss = buildScopedModeCssV2({
    modeId: MODE_IDS.FOCUS,
    intensity: 0.75,
    spacingPackEnabled: false,
  });

  assert(!css.includes('line-height: var(--aura-line-height'));
  assert(!css.includes('p + p { margin-top: var(--aura-paragraph-spacing'));
  assert(css.includes('font-size: var(--aura-font-size'));
  assert(css.includes('letter-spacing: var(--aura-letter-spacing'));
  assert(css.includes('-webkit-text-fill-color: var(--aura-text-color) !important'));
  assert(focusCss.includes('line-height: var(--aura-line-height'));
});

test('reapplying scoped tokens is idempotent and removes stale entries', () => {
  const el = new MockElement();
  applyScopedTokens(el, { '--aura-font-size': '18px', '--aura-line-height': '1.8' }, 'owner-1');
  applyScopedTokens(el, { '--aura-line-height': '1.9' }, 'owner-1');

  assert.equal(el.style.get('--aura-font-size'), undefined);
  assert.equal(el.style.get('--aura-line-height'), '1.9');
  const tokensAttr = el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR) || '';
  assert(!tokensAttr.includes('--aura-font-size'));
});

test('reapplying scoped tokens removes stale link enhancement entries', () => {
  const el = new MockElement();
  applyScopedTokens(
    el,
    {
      '--aura-link-decoration': 'underline',
      '--aura-link-decoration-thickness': '0.12em',
      '--aura-line-height': '1.8',
    },
    'owner-1',
  );
  applyScopedTokens(el, { '--aura-line-height': '1.9' }, 'owner-1');

  assert.equal(el.style.get('--aura-link-decoration'), undefined);
  assert.equal(el.style.get('--aura-link-decoration-thickness'), undefined);
  assert.equal(el.style.get('--aura-line-height'), '1.9');
  const tokensAttr = el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR) || '';
  assert.equal(tokensAttr.includes('--aura-link-decoration'), false);
});

test('removeTokensOwned removes only the owned keys', () => {
  const el = new MockElement();
  el.style.set('--aura-custom', 'keep');
  applyScopedTokens(el, { '--aura-font-size': '18px', '--aura-line-height': '1.8' }, 'owner-1');

  const result = removeTokensOwned(el, ['--aura-font-size']);
  assert.equal(result.ok, true);
  assert.equal(result.removed, 1);
  assert.equal(el.style.get('--aura-font-size'), undefined);
  assert.equal(el.style.get('--aura-line-height'), '1.8');
  assert.equal(el.style.get('--aura-custom'), 'keep');
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR), '--aura-line-height');

  const finalResult = removeTokensOwned(el, ['--aura-line-height']);
  assert.equal(finalResult.ok, true);
  assert.equal(finalResult.removed, 1);
  assert.equal(el.style.get('--aura-line-height'), undefined);
  assert.equal(el.getAttribute(MODE_ENGINE_SCOPE_TOKENS_ATTR), null);
});

test('computeAppliedHash is stable regardless of token order', () => {
  const hashA = computeAppliedHash({
    cssText: '.a{color:red;}',
    tokens: { '--a': '1', '--b': '2' },
    cssId: 'css-1',
    modeId: 'comfort',
  });

  const hashB = computeAppliedHash({
    cssText: '.a{color:red;}',
    tokens: { '--b': '2', '--a': '1' },
    cssId: 'css-1',
    modeId: 'comfort',
  });

  assert.equal(hashA, hashB);
});

test('applyScopedModeV2 stores state and is idempotent for identical inputs', async () => {
  const first = applyScopedModeV2({ tabId: 123, frameId: 0, cssId: 'css-1', modeId: 'comfort' });
  const second = applyScopedModeV2({ tabId: 123, frameId: 0, cssId: 'css-1', modeId: 'comfort' });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const key = makeScopedV2Key(123, 0);
  const state = getScopedModeV2State(key.tabId, key.frameId);
  assert.equal(state?.cssId, 'css-1');
  await removeScopedModeV2({ tabId: 123, frameId: 0 });
});

test('removeScopedModeV2 is safe when no state exists', async () => {
  const result = await removeScopedModeV2({ tabId: 999, frameId: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.removed, false);
});

test('removeScopedModeV2 removes css, owned tokens, and owned scope attributes', async () => {
  const scopeEl = new MockElement();
  const tokens = { '--aura-font-size': '18px', '--aura-line-height': '1.8' };
  applyScopedTokens(scopeEl, tokens, SCOPE_OWNER_VALUE);

  const registryEntry = { cssText: '.scope{}', origin: 'AUTHOR' };
  const { removeCssCalls, restore } = setupScopedEnvironment(scopeEl, registryEntry);

  applyScopedModeV2({
    tabId: 1,
    frameId: 0,
    cssId: 'css-owned',
    modeId: 'comfort',
    scopeSelector: '.scope',
    cssText: registryEntry.cssText,
    tokens,
  });

  try {
    const result = await removeScopedModeV2({ tabId: 1, frameId: 0 });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.equal(scopeEl.getAttribute(SCOPE_ATTR), null);
    assert.equal(scopeEl.getAttribute(SCOPE_OWNER_ATTR), null);
    assert.equal(scopeEl.style.get('--aura-font-size'), undefined);
    assert.equal(scopeEl.style.get('--aura-line-height'), undefined);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(getScopedModeV2State(1, 0), null);

    const second = await removeScopedModeV2({ tabId: 1, frameId: 0 });
    assert.equal(second.removed, false);
  } finally {
    restore();
  }
});

test('removeScopedModeV2 removes owned tokens but preserves external scope markers', async () => {
  const scopeEl = new MockElement();
  const tokens = { '--aura-font-size': '18px', '--aura-line-height': '1.8' };
  applyScopedTokens(scopeEl, tokens, 'external-owner');

  const { removeCssCalls, restore } = setupScopedEnvironment(scopeEl, { cssText: '.scope{}', origin: 'AUTHOR' });

  applyScopedModeV2({
    tabId: 2,
    frameId: 0,
    cssId: 'css-external',
    modeId: 'comfort',
    scopeSelector: '.scope',
    cssText: '.scope{}',
    tokens,
  });

  try {
    const result = await removeScopedModeV2({ tabId: 2, frameId: 0 });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.equal(scopeEl.getAttribute(SCOPE_OWNER_ATTR), 'external-owner');
    assert.equal(scopeEl.getAttribute(SCOPE_ATTR), SCOPE_ATTR_VALUE);
    assert.equal(scopeEl.style.get('--aura-font-size'), undefined);
    assert.equal(scopeEl.style.get('--aura-line-height'), undefined);
    assert.equal(removeCssCalls.length, 1);
  } finally {
    restore();
  }
});

test('removeScopedModeV2 remains safe when the scope element is missing', async () => {
  const tokens = buildTokenSet();
  const registryEntry = { cssText: '.missing{}', origin: 'AUTHOR' };
  const { removeCssCalls, restore } = setupScopedEnvironment(null, registryEntry);

  applyScopedModeV2({
    tabId: 5,
    frameId: 2,
    cssId: 'css-missing',
    modeId: 'comfort',
    scopeSelector: '.missing',
    cssText: registryEntry.cssText,
    tokens,
  });

  try {
    const result = await removeScopedModeV2({ tabId: 5, frameId: 2 });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.equal(removeCssCalls.length, 1);
    assert.equal(getScopedModeV2State(5, 2), null);
  } finally {
    restore();
  }
});
