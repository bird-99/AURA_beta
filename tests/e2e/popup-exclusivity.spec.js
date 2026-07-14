import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  getAuraTabId,
  launchWithExtension,
  waitForAuraReady,
  waitForAuraContentReady,
} from './helpers/launch-with-extension.js';
import { ACTIONS, ACTIVE_QUALITIES, MODE_IDS, STATES, STORAGE_KEYS } from '../../shared/constants.js';
import { FEATURE_IDS } from '../../shared/engine-core/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../');
const fixturePath = path.resolve(__dirname, '../fixtures/basic.html');
const focusFallbackFixturePath = path.resolve(__dirname, '../fixtures/focus-fallback.html');
const pageClaritySearchFixturePath = path.resolve(__dirname, '../fixtures/page-clarity-search.html');
const pageClarityFormFixturePath = path.resolve(__dirname, '../fixtures/page-clarity-form.html');
const targetUrl = 'http://aura.local/basic.html';
const focusFallbackUrl = 'http://aura.local/focus-fallback.html';
const pageClaritySearchUrl = 'http://aura.local/search?q=runtime-clarity';
const pageClarityFormUrl = 'http://aura.local/support/request';
const wikipediaLikeUrl = 'http://aura.local/wiki/AURA_runtime_budget';
const shadowDomUrl = 'http://aura.local/components/shadow-card.html';
const designTokenAppUrl = 'http://aura.local/app/design-token-shell.html';
const rootHslTokenAppUrl = 'http://aura.local/app/root-hsl-token-shell.html';
const rootRgbTokenAppUrl = 'http://aura.local/app/root-rgb-token-shell.html';
const rootNeutralPaletteAppUrl = 'http://aura.local/app/root-neutral-palette-shell.html';
const rootProseTokenAppUrl = 'http://aura.local/app/root-prose-token-shell.html';
const iframeShellUrl = 'http://aura.local/shell-with-frame.html';
const lateIframeShellUrl = 'http://aura.local/shell-with-late-frame.html';
const iframeChildUrl = 'http://aura.local/embedded-light.html';
const crossOriginIframeChildUrl = 'http://third-party.local/embedded-light.html';
const crossOriginAlreadyDarkIframeChildUrl = 'http://third-party.local/embedded-already-dark.html';
const dynamicStyleMutationUrl = 'http://aura.local/article/dynamic-style-mutation.html';
const alreadyDarkUrl = 'http://aura.local/article/already-dark.html';

async function loadFixtureHtml() {
  return fs.readFile(fixturePath, 'utf8');
}

async function loadFocusFallbackFixtureHtml() {
  return fs.readFile(focusFallbackFixturePath, 'utf8');
}

async function loadPageClaritySearchFixtureHtml() {
  return fs.readFile(pageClaritySearchFixturePath, 'utf8');
}

async function loadPageClarityFormFixtureHtml() {
  return fs.readFile(pageClarityFormFixturePath, 'utf8');
}

async function getModeStates(serviceWorker, tabId) {
  return serviceWorker.evaluate(async (targetTabId) => {
    const { tabState } = await chrome.storage.session.get('tabState');
    const entry = tabState?.[targetTabId] || {};
    return {
      comfort: entry['comfort-visual']?.state ?? null,
      focus: entry['focus']?.state ?? null,
    };
  }, tabId);
}

async function clearExtensionSession(serviceWorker) {
  await serviceWorker.evaluate(async () => {
    await chrome.storage.session.clear();
  });
}

async function setComfortDarkModePreference(serviceWorker, darkMode) {
  await serviceWorker.evaluate(
    async ({ storageKey, comfortModeId, enabled }) => {
      const stored = await chrome.storage.local.get(storageKey);
      const prefs = stored?.[storageKey] || {};
      const modePrefs = prefs.modePrefs || {};
      await chrome.storage.local.set({
        [storageKey]: {
          ...prefs,
          modePrefs: {
            ...modePrefs,
            [comfortModeId]: {
              ...(modePrefs[comfortModeId] || {}),
              darkMode: enabled,
            },
          },
        },
      });
    },
    {
      storageKey: STORAGE_KEYS.USER_PREFS,
      comfortModeId: MODE_IDS.COMFORT_VISUAL,
      enabled: darkMode === true,
    },
  );
}

function buildWikipediaLikeLargeHtml() {
  const rows = Array.from({ length: 5400 }, (_, index) => {
    const n = index + 1;
    return `<li><a href="#ref-${n}">Reference ${n}</a><span> Compact encyclopedia body text node ${n}.</span></li>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA Wikipedia-like large fixture</title>
    <style>
      body { margin: 0; font-family: sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      header, nav { padding: 12px 24px; border-bottom: 1px solid rgb(162, 169, 177); }
      main { max-width: 960px; margin: 0 auto; padding: 24px; background: rgb(255, 255, 255); }
      a { color: rgb(51, 102, 204); }
      .mw-page-base {
        height: 64px;
        background-color: rgb(248, 249, 250);
        background-image: linear-gradient(rgb(255, 255, 255), rgb(234, 236, 240));
      }
      .vector-header-container,
      #mw-navigation,
      .vector-page-toolbar,
      .vector-toc {
        background-color: rgb(248, 249, 250);
        background-image: linear-gradient(rgb(255, 255, 255), rgb(248, 249, 250));
        border-color: rgb(162, 169, 177);
      }
      .mw-body { background: rgb(255, 255, 255); border-color: rgb(162, 169, 177); }
      .mw-parser-output { background-color: rgb(255, 255, 255); color: rgb(32, 33, 34); }
      .infobox,
      .toc,
      .thumbinner,
      .wikitable,
      .navbox,
      .metadata,
      .ambox {
        background-color: rgb(248, 249, 250) !important;
        background-image: linear-gradient(rgb(255, 255, 255), rgb(234, 236, 240)) !important;
        color: rgb(32, 33, 34) !important;
        border: 1px solid rgb(162, 169, 177);
      }
      .infobox { float: right; width: 240px; margin: 0 0 18px 24px; }
      .references { columns: 2; }
    </style>
  </head>
  <body>
    <div class="mw-page-base" id="mw-page-base"></div>
    <header class="vector-header-container"><strong>AURApedia</strong></header>
    <nav id="mw-navigation" class="vector-page-toolbar"><a href="#contents">Contents</a> <a href="#references">References</a></nav>
    <main class="mw-body">
      <article class="mw-parser-output">
        <h1
          id="budget-heading"
          style="color: rgb(20, 20, 20) !important; -webkit-text-fill-color: rgb(25, 25, 25) !important;"
        >AURA runtime budget article</h1>
        <aside class="infobox" id="wiki-infobox"><p>Large local page used to exercise budget-hit dark apply.</p></aside>
        <nav class="toc vector-toc" id="wiki-toc"><a href="#contents">Contents list</a></nav>
        <figure class="thumbinner" id="wiki-thumb"><img alt="" width="1" height="1" /><figcaption>Thumbnail caption</figcaption></figure>
        <p>
          This article-like page intentionally contains thousands of elements, similar to a large encyclopedia page,
          so page-signal collection can become partial while manual dark mode must still apply.
        </p>
        <section id="contents"><h2>Contents</h2><p>Runtime, budgets, cleanup, and visual adaptation.</p></section>
        <table class="wikitable" id="wiki-table"><caption>Runtime table</caption><tbody><tr><th>Feature</th><td>Dark mode</td></tr></tbody></table>
        <div class="navbox metadata ambox" id="wiki-navbox">Related runtime pages</div>
        <section id="references"><h2>References</h2><ol class="references">${rows}</ol></section>
      </article>
    </main>
  </body>
  </html>`;
}

function buildAlreadyDarkArticleFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA already dark article fixture</title>
    <style>
      html { color-scheme: dark; background: rgb(9, 12, 20); }
      body {
        margin: 0;
        font-family: system-ui, sans-serif;
        color: rgb(226, 232, 240);
        background: rgb(9, 12, 20);
      }
      main {
        max-width: 760px;
        margin: 32px auto;
        padding: 28px;
        background: rgb(15, 23, 42);
        border: 1px solid rgb(51, 65, 85);
      }
      article { background: rgb(15, 23, 42); color: rgb(226, 232, 240); }
      a { color: rgb(147, 197, 253); }
      .surface {
        margin-top: 18px;
        padding: 16px;
        background: rgb(17, 24, 39) !important;
        color: rgb(226, 232, 240) !important;
        border: 1px solid rgb(71, 85, 105);
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Already dark reading page</h1>
        <p>
          This page already uses a dark visual design. AURA should keep it readable, detect the low-luminance
          background, and avoid applying the harsher default dark palette when Comfort dark mode is enabled.
        </p>
        <p>
          The fixture includes enough readable text for scoped Comfort Visual to choose the article area and enough
          link content to verify adaptive link colors without storing raw page text.
          <a href="#more">Read more about adaptive dark surfaces</a>.
        </p>
        <section class="surface" id="already-dark-surface">
          Existing dark inline surface that must stay dark and restore exactly after disabling Comfort Visual.
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function buildShadowDomFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA Shadow DOM Fixture</title>
    <style>
      body { margin: 0; font-family: sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      main { max-width: 760px; margin: 40px auto; padding: 24px; background: rgb(255, 255, 255); }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Shadow DOM article fixture</h1>
        <p>
          This page has enough readable article text for scoped Comfort Visual to select this region while also
          containing a custom element with an open shadow root that document-level CSS cannot style directly.
        </p>
        <aura-shadow-card id="shadow-card"></aura-shadow-card>
        <aura-closed-card id="closed-shadow-card"></aura-closed-card>
        <aura-closed-token-card id="closed-token-card"></aura-closed-token-card>
        <p>
          Dark Comfort should apply bounded, reversible styles for open shadow roots and exposed closed-shadow parts
          without touching media, storing selectors, or leaving stale styles after restore.
        </p>
      </article>
      <script>
        customElements.define('aura-shadow-card', class extends HTMLElement {
          connectedCallback() {
            if (this.shadowRoot) return;
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = '<style>:host { --card: rgb(255, 255, 255); --card-foreground: rgb(17, 24, 39); --border: rgb(210, 214, 220); --color-link: rgb(29, 78, 216); } .card { display: block; padding: 16px; border: 1px solid rgb(210, 214, 220); background: rgb(255, 255, 255); color: rgb(17, 24, 39); } aura-token-card { display: block; margin-top: 10px; padding: 12px; border: 1px solid var(--border); background: var(--card); color: var(--card-foreground); } aura-token-card a { color: var(--color-link); } .media-card { min-height: 58px; margin-top: 10px; padding: 10px; color: rgb(255, 255, 255); background-color: rgb(31, 41, 55); background-image: url("data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 120 58\\'%3E%3Crect width=\\'120\\' height=\\'58\\' fill=\\'%230f766e\\'/%3E%3Ccircle cx=\\'92\\' cy=\\'18\\' r=\\'14\\' fill=\\'%23facc15\\'/%3E%3Cpath d=\\'M0 58 42 24 70 42 92 30 120 52 120 58Z\\' fill=\\'%230f172a\\'/%3E%3C/svg%3E"); background-size: cover; } a { color: rgb(29, 78, 216); }</style><section class="card"><h2>Shadow card</h2><p>Readable shadow content.</p><aura-token-card class="token-card"><strong>Token card</strong><a href="#token">Token link</a></aura-token-card><div class="inline-panel" style="display:block; min-height:48px; padding:12px; border:1px solid rgb(210,214,220); background-color: rgb(255, 255, 255) !important; background-image: linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235)) !important; color: rgb(17, 24, 39) !important; -webkit-text-fill-color: rgb(18, 18, 18) !important;">Inline bright surface</div><div class="media-card">Shadow media background</div><a href="#shadow">Shadow link</a></section>';
          }
        });
        customElements.define('aura-closed-card', class extends HTMLElement {
          connectedCallback() {
            if (this._ready) return;
            const root = this.attachShadow({ mode: 'closed' });
            root.innerHTML = '<style>:host { display:block; margin-top:12px; } .closed-card { display:block; padding:16px; border:1px solid rgb(210,214,220); background:rgb(255,255,255); color:rgb(17,24,39); } .closed-card h2 { margin:0 0 8px; color:rgb(17,24,39); } .closed-card button { padding:8px 10px; border:1px solid rgb(190,196,205); background:rgb(255,255,255); color:rgb(17,24,39); }</style><section part="surface" class="closed-card"><h2 part="heading">Closed shadow card</h2><p part="description">Closed readable content.</p><button part="button" type="button">Closed action</button></section>';
            this._surface = root.querySelector('[part="surface"]');
            this._heading = root.querySelector('[part="heading"]');
            this._button = root.querySelector('[part="button"]');
            this._ready = true;
          }

          getPartStyles() {
            const surface = this._surface ? getComputedStyle(this._surface) : null;
            const heading = this._heading ? getComputedStyle(this._heading) : null;
            const button = this._button ? getComputedStyle(this._button) : null;
            return {
              ready: Boolean(surface && heading && button),
              surfaceBackground: surface?.backgroundColor || '',
              surfaceColor: surface?.color || '',
              surfaceBorderColor: surface?.borderTopColor || '',
              headingColor: heading?.color || '',
              buttonBackground: button?.backgroundColor || '',
              buttonColor: button?.color || '',
              buttonBorderColor: button?.borderTopColor || '',
            };
          }
        });
        customElements.define('aura-closed-token-card', class extends HTMLElement {
          connectedCallback() {
            if (this._ready) return;
            const root = this.attachShadow({ mode: 'closed' });
            root.innerHTML = '<style>:host { display:block; margin-top:12px; --card: rgb(255,255,255); --card-foreground: rgb(17,24,39); --border: rgb(210,214,220); --color-link: rgb(29,78,216); } .closed-token-card { display:block; padding:16px; border:1px solid var(--border); background:var(--card); color:var(--card-foreground); } .closed-token-card a { color:var(--color-link); }</style><section class="closed-token-card"><h2>Closed token card</h2><p>Token-only closed content.</p><a href="#closed-token">Closed token link</a></section>';
            this._card = root.querySelector('.closed-token-card');
            this._link = root.querySelector('a');
            this._ready = true;
          }

          getTokenStyles() {
            const card = this._card ? getComputedStyle(this._card) : null;
            const link = this._link ? getComputedStyle(this._link) : null;
            const host = getComputedStyle(this);
            return {
              ready: Boolean(card && link),
              hostCardToken: host?.getPropertyValue('--card').trim() || '',
              hostTextToken: host?.getPropertyValue('--card-foreground').trim() || '',
              hostBorderToken: host?.getPropertyValue('--border').trim() || '',
              hostLinkToken: host?.getPropertyValue('--color-link').trim() || '',
              cardBackground: card?.backgroundColor || '',
              cardColor: card?.color || '',
              cardBorderColor: card?.borderTopColor || '',
              linkColor: link?.color || '',
            };
          }
        });
      </script>
    </main>
  </body>
</html>`;
}

function buildIframeShellFixtureHtml(frameSrc = iframeChildUrl) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA iframe fallback fixture</title>
    <style>
      body { margin: 24px; font-family: sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      iframe { width: 460px; height: 140px; border: 1px solid rgb(190, 190, 190); }
      a { color: rgb(29, 78, 216); -webkit-text-fill-color: rgb(29, 78, 216); text-decoration-line: none; }
    </style>
  </head>
  <body>
    <div class="shell">
      <h1>Unknown shell with embedded content</h1>
      <a id="primary-link" href="#alpha">Alpha destination</a>
      <iframe id="embedded-frame" src="${frameSrc}"></iframe>
    </div>
  </body>
</html>`;
}

function buildIframeChildFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA iframe child</title>
    <style>
      body { margin: 16px; font-family: sans-serif; color: rgb(17, 24, 39); background: rgb(255, 255, 255); }
      p { margin: 0; }
    </style>
  </head>
  <body>
    <p id="frame-text">Embedded light content</p>
  </body>
</html>`;
}

function buildAlreadyDarkIframeChildFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA already dark iframe child</title>
    <style>
      html { color-scheme: dark; background: rgb(9, 12, 20); }
      body {
        margin: 16px;
        font-family: sans-serif;
        color: rgb(226, 232, 240);
        background: rgb(9, 12, 20);
      }
      p {
        margin: 0;
        padding: 12px;
        color: rgb(226, 232, 240);
        background: rgb(15, 23, 42);
        border: 1px solid rgb(51, 65, 85);
      }
      a { color: rgb(147, 197, 253); }
    </style>
  </head>
  <body>
    <p id="frame-text">Embedded already dark content <a href="#inside">inside link</a></p>
  </body>
</html>`;
}

function buildLateIframeShellFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA late iframe fallback fixture</title>
    <style>
      body { margin: 24px; font-family: sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      iframe { width: 460px; height: 140px; border: 1px solid rgb(190, 190, 190); }
      a { color: rgb(29, 78, 216); text-decoration-line: none; }
    </style>
  </head>
  <body>
    <div class="shell">
      <h1>Unknown shell with late embedded content</h1>
      <a id="primary-link" href="#alpha">Alpha destination</a>
      <div id="frame-host"></div>
    </div>
  </body>
</html>`;
}

function buildDynamicStyleMutationFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA dynamic style mutation fixture</title>
    <style>
      body { margin: 0; font-family: sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      main { max-width: 780px; margin: 32px auto; padding: 28px; background: rgb(255, 255, 255); }
      article { display: block; }
      .panel { min-height: 180px; padding: 24px; border: 1px solid rgb(200, 200, 200); background: rgb(248, 250, 252); color: rgb(17, 24, 39); }
      a { color: rgb(29, 78, 216); }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Dynamic article fixture</h1>
        <p>
          This article page contains enough readable text for Comfort Visual to select a scoped article region.
          The panel below simulates modern apps that keep an existing node but change its style attribute after load.
        </p>
        <section
          id="dynamic-panel"
          class="panel"
          style="background-color: rgb(255, 255, 255) !important; color: rgb(20, 20, 20) !important;"
        >
          <h2>Late styled panel</h2>
          <p>
            This content starts normal, then a client-side theme update forces a light inline background after
            AURA dark mode is already active.
          </p>
          <a href="#details">Details link</a>
        </section>
        <p>
          The runtime must observe attribute mutations, apply bounded dark overrides, and restore the original late
          inline style exactly when Comfort Visual is disabled.
        </p>
      </article>
    </main>
  </body>
</html>`;
}

function buildGlobalFallbackVisualFixtureHtml() {
  const gradientNoise = Array.from({ length: 120 }, (_, index) => (
    `<section class="gradient-noise infobox wiki-gradient">Gradient noise ${index + 1}</section>`
  )).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA global fallback visual preservation fixture</title>
    <style>
      html { background: rgb(255, 255, 255); }
      body { margin: 32px; font-family: Arial, sans-serif; color: rgb(32, 33, 34); background: rgb(255, 255, 255); }
      .shell { display: grid; gap: 14px; }
      a { color: rgb(29, 78, 216); text-decoration-line: none; }
      input, select, progress, meter { color: rgb(24, 24, 27); -webkit-text-fill-color: rgb(24, 24, 27); background: rgb(255, 255, 255); border: 1px solid rgb(180, 180, 190); padding: 8px; }
      option, optgroup { color: rgb(24, 24, 27); background: rgb(255, 255, 255); }
      input::file-selector-button { color: rgb(24, 24, 27); background: rgb(255, 255, 255); border: 1px solid rgb(180, 180, 190); }
      input::placeholder { color: rgb(107, 114, 128); opacity: 1; }
      .status-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .state-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .badge, .alert { display: inline-block; border: 1px solid; border-radius: 6px; padding: 6px 8px; }
      .status-row > span { display: inline-block; border: 1px solid; border-radius: 6px; padding: 6px 8px; }
      .state-row > * { display: inline-block; border: 1px solid; border-radius: 6px; padding: 6px 8px; text-decoration-line: none; }
      #status-neutral { background: rgb(243, 244, 246); color: rgb(31, 41, 55); border-color: rgb(209, 213, 219); }
      #status-success { background: rgb(220, 252, 231); color: rgb(22, 101, 52); border-color: rgb(34, 197, 94); }
      #status-warning { background: rgb(254, 243, 199); color: rgb(146, 64, 14); border-color: rgb(245, 158, 11); }
      #status-error { background: rgb(254, 226, 226); color: rgb(153, 27, 27); border-color: rgb(239, 68, 68); }
      #data-info { background: rgb(219, 234, 254); color: rgb(30, 64, 175); border-color: rgb(96, 165, 250); }
      #data-success { background: rgb(220, 252, 231); color: rgb(22, 101, 52); border-color: rgb(34, 197, 94); }
      #data-warning { background: rgb(254, 243, 199); color: rgb(146, 64, 14); border-color: rgb(245, 158, 11); }
      #data-error { background: rgb(254, 226, 226); color: rgb(153, 27, 27); border-color: rgb(239, 68, 68); }
      #tab-selected, #nav-current, #state-active, #toggle-pressed { background: rgb(219, 234, 254); color: rgb(30, 64, 175); border-color: rgb(96, 165, 250); }
      #state-open { background: rgb(245, 245, 245); color: rgb(39, 39, 42); border-color: rgb(212, 212, 216); }
      #disabled-control, #disabled-link { background: rgb(229, 231, 235); color: rgb(107, 114, 128); border-color: rgb(156, 163, 175); }
      #fixture-table, #fixture-table th, #fixture-table td, #aria-grid, #grid-header, #grid-cell, #menu-panel, #menu-item, #listbox-panel, #list-option, #dialog-panel,
      #details-panel, #summary-trigger, #doc-fieldset, #doc-legend, #doc-quote, #doc-kbd, #doc-samp, #aria-navigation, #aria-search {
        background: rgb(255, 255, 255);
        color: rgb(24, 24, 27);
        border: 1px solid rgb(180, 180, 190);
      }
      #doc-rule { height: 2px; background: rgb(180, 180, 190); border: 0; color: rgb(180, 180, 190); }
      #doc-mark { background: rgb(254, 240, 138); color: rgb(113, 63, 18); }
      #pseudo-card::before {
        content: "Card pseudo surface";
        display: block;
        margin-bottom: 4px;
        padding: 4px 6px;
        background: rgb(255, 255, 255);
        color: rgb(24, 24, 27);
        border: 1px solid rgb(180, 180, 190);
      }
      #pseudo-callout::after {
        content: "Callout pseudo surface";
        display: block;
        margin-top: 4px;
        padding: 4px 6px;
        background: rgb(255, 255, 255);
        color: rgb(24, 24, 27);
        border: 1px solid rgb(180, 180, 190);
      }
      #gradient-card, #gradient-button, #gradient-status, #plain-gradient-surface {
        background-color: rgb(255, 255, 255);
        background-image: linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235));
        color: rgb(24, 24, 27);
        border: 1px solid rgb(180, 180, 190);
      }
      .gradient-noise {
        min-height: 4px;
        background-color: rgb(255, 255, 255);
        background-image: linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235));
        color: rgb(24, 24, 27);
        border: 1px solid rgb(180, 180, 190);
      }
      #gradient-card, #gradient-button, #gradient-status, #plain-gradient-surface { padding: 6px 8px; }
      #gradient-text {
        display: inline-block;
        font-size: 28px;
        font-weight: 700;
        background-image: linear-gradient(90deg, rgb(59, 130, 246), rgb(236, 72, 153));
        background-clip: text;
        -webkit-background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
      }
      #fixture-table { border-collapse: collapse; }
      #fixture-table th, #fixture-table td, #grid-header, #grid-cell, #menu-item, #list-option, #dialog-panel, #details-panel, #doc-fieldset, #doc-quote, #aria-navigation, #aria-search { padding: 6px 8px; }
      #menu-panel, #listbox-panel, #dialog-panel, #details-panel, #doc-fieldset, #doc-quote, #aria-navigation, #aria-search { display: block; margin-top: 8px; padding: 8px; }
      #doc-kbd, #doc-samp { display: inline-block; padding: 2px 5px; }
      #brand-icon { width: 48px; height: 48px; color: rgb(220, 38, 38); }
      .brand-mark { display: inline-grid; place-items: center; width: 64px; height: 64px; background: rgb(255, 255, 255); }
      #photo-card {
        min-height: 72px;
        padding: 10px 12px;
        color: rgb(255, 255, 255);
        border: 1px solid rgb(180, 180, 190);
        background-color: rgb(31, 41, 55);
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 72'%3E%3Crect width='120' height='72' fill='%230f766e'/%3E%3Ccircle cx='92' cy='20' r='16' fill='%23facc15'/%3E%3Cpath d='M0 72 42 30 70 52 92 36 120 64 120 72Z' fill='%230f172a'/%3E%3C/svg%3E");
        background-size: cover;
      }
    </style>
  </head>
  <body>
      <div class="shell">
        <h1>Unknown visual shell</h1>
        <h2 id="gradient-text" class="wiki-gradient">Gradient headline</h2>
        <a id="primary-link" href="#alpha">Alpha destination</a>
        <input id="shell-search" type="search" placeholder="Search the shell" />
        <input id="shell-invalid" aria-invalid="true" value="Invalid value" />
        <div class="status-row">
          <span id="status-neutral" class="badge pill" role="status">Beta</span>
          <span id="status-success" class="badge success">Saved</span>
          <span id="status-warning" class="alert warning" role="alert">Check settings</span>
          <span id="status-error" class="alert error" role="alert">Failed</span>
          <span id="data-info" data-tone="info">Info</span>
          <span id="data-success" data-status="success">Synced</span>
          <span id="data-warning" data-variant="warning">Review</span>
          <span id="data-error" data-severity="error">Blocked</span>
        </div>
        <div class="brand-mark">
          <svg id="brand-icon" class="brand-icon" viewBox="0 0 24 24" aria-label="Brand icon">
            <path id="brand-path" class="brand-path" fill="currentColor" d="M12 2 22 20H2L12 2Z"></path>
        </svg>
      </div>
      ${gradientNoise}
      <section id="photo-card" class="hero-card infobox wiki-photo">Media background card</section>
    </div>
  </body>
</html>`;
}

function buildDesignTokenAppFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA design token app fixture</title>
    <style>
      :root,
      body {
        --background: rgb(255, 255, 255);
        --foreground: rgb(17, 24, 39);
        --card: rgb(255, 255, 255);
        --card-foreground: rgb(17, 24, 39);
        --border: rgb(209, 213, 219);
        --color-link: rgb(29, 78, 216);
        --bs-body-bg: rgb(255, 255, 255);
        --bs-body-color: rgb(17, 24, 39);
        --bs-border-color: rgb(209, 213, 219);
        --md-sys-color-surface: rgb(255, 255, 255);
        --md-sys-color-on-surface: rgb(17, 24, 39);
        --md-sys-color-outline: rgb(209, 213, 219);
        --bgColor-default: rgb(255, 255, 255);
        --fgColor-default: rgb(17, 24, 39);
        --borderColor-default: rgb(209, 213, 219);
      }

      body {
        margin: 0;
        font-family: system-ui, sans-serif;
        background: var(--background);
        color: var(--foreground);
      }

      main {
        max-width: 780px;
        margin: 40px auto;
        padding: 24px;
        background: var(--background);
        color: var(--foreground);
      }

      .design-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .token-card,
      .bs-panel,
      .md-panel,
      .primer-panel {
        padding: 14px;
        border-radius: 8px;
      }

      .token-card {
        background: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
      }

      .bs-panel {
        background: var(--bs-body-bg);
        color: var(--bs-body-color);
        border: 1px solid var(--bs-border-color);
      }

      .md-panel {
        background: var(--md-sys-color-surface);
        color: var(--md-sys-color-on-surface);
        border: 1px solid var(--md-sys-color-outline);
      }

      .primer-panel {
        background: var(--bgColor-default);
        color: var(--fgColor-default);
        border: 1px solid var(--borderColor-default);
      }

      .local-token-shell {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid var(--border);
        --card: rgb(255, 255, 255);
        --card-foreground: rgb(17, 24, 39);
        --border: rgb(210, 214, 220);
        --color-link: rgb(29, 78, 216);
      }

      .local-token-card {
        padding: 12px;
        border-radius: 8px;
        background: var(--card);
        color: var(--card-foreground);
        border: 1px solid var(--border);
      }

      .local-token-card a {
        color: var(--color-link);
      }

      .hsl-token-shell {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid hsl(var(--border));
        --background: 0 0% 100%;
        --foreground: 222 47% 11%;
        --card: 0 0% 100%;
        --card-foreground: 222 47% 11%;
        --border: 220 13% 91%;
        --color-link: 217 91% 60%;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
      }

      .hsl-token-card {
        padding: 12px;
        border-radius: 8px;
        background: hsl(var(--card));
        color: hsl(var(--card-foreground));
        border: 1px solid hsl(var(--border));
      }

      .hsl-token-card a {
        color: hsl(var(--color-link));
      }

      a { color: var(--color-link); }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>Design token application fixture</h1>
        <p>
          This article-like application uses custom design tokens for every visual surface. A robust dark comfort
          theme must update inherited token values, not only direct background-color declarations.
        </p>
        <div class="design-grid">
          <section id="token-card" class="token-card">Token card with shadcn-like variables.</section>
          <section id="bs-panel" class="bs-panel">Bootstrap-like panel driven by --bs variables.</section>
          <section id="md-panel" class="md-panel">Material-like panel driven by --md-sys variables.</section>
          <section id="primer-panel" class="primer-panel">Primer-like panel driven by mixed-case variables.</section>
        </div>
        <section id="local-token-shell" class="local-token-shell" data-theme="light">
          <div id="local-token-card" class="local-token-card">
            Local light theme container with its own variables.
            <a id="local-token-link" href="#local-token">Local token link</a>
          </div>
        </section>
        <section id="hsl-token-shell" class="hsl-token-shell" data-theme="light">
          <div id="hsl-token-card" class="hsl-token-card">
            HSL channel token container.
            <a id="hsl-token-link" href="#hsl-token">HSL token link</a>
          </div>
        </section>
        <p><a id="token-link" href="#tokens">Tokenized link</a></p>
      </article>
    </main>
  </body>
</html>`;
}

function buildRootHslTokenAppFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA root HSL token app fixture</title>
    <style>
      :root {
        --background: 0 0% 100%;
        --foreground: 222 47% 11%;
        --card: 0 0% 100%;
        --card-foreground: 222 47% 11%;
        --border: 220 13% 91%;
        --color-link: 217 91% 60%;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, sans-serif;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
      }

      main {
        max-width: 760px;
        margin: 40px auto;
        padding: 24px;
        background: hsl(var(--card));
        color: hsl(var(--card-foreground));
        border: 1px solid hsl(var(--border));
      }

      .root-hsl-card {
        padding: 16px;
        border-radius: 8px;
        background: hsl(var(--card));
        color: hsl(var(--card-foreground));
        border: 1px solid hsl(var(--border));
      }

      .root-hsl-card a {
        color: hsl(var(--color-link));
      }
    </style>
  </head>
  <body>
    <main id="root-hsl-main">
      <article>
        <h1>Root HSL token fixture</h1>
        <section id="root-hsl-card" class="root-hsl-card">
          Root-level HSL channel tokens only.
          <a id="root-hsl-link" href="#root-hsl-token">Root HSL token link</a>
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function buildRootRgbTokenAppFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA root RGB token app fixture</title>
    <style>
      :root {
        --background: 255 255 255;
        --foreground: 17 24 39;
        --card: 255 255 255;
        --card-foreground: 17 24 39;
        --border: 226 232 240;
        --color-link: 29 78 216;
        --overlay: 255, 255, 255;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, sans-serif;
        background: rgb(var(--background));
        color: rgb(var(--foreground));
      }

      main {
        max-width: 760px;
        margin: 40px auto;
        padding: 24px;
        background: rgb(var(--card));
        color: rgb(var(--card-foreground));
        border: 1px solid rgb(var(--border));
      }

      .root-rgb-card {
        padding: 16px;
        border-radius: 8px;
        background: rgb(var(--card));
        color: rgb(var(--card-foreground));
        border: 1px solid rgb(var(--border));
        box-shadow: 0 8px 20px rgba(var(--overlay), 0.8);
      }

      .root-rgb-card a {
        color: rgb(var(--color-link));
      }
    </style>
  </head>
  <body>
    <main id="root-rgb-main">
      <article>
        <h1>Root RGB token fixture</h1>
        <section id="root-rgb-card" class="root-rgb-card">
          Root-level RGB channel tokens only.
          <a id="root-rgb-link" href="#root-rgb-token">Root RGB token link</a>
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function buildRootNeutralPaletteAppFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA root neutral palette fixture</title>
    <style>
      :root {
        --color-white: rgb(255, 255, 255);
        --color-gray-50: rgb(249, 250, 251);
        --color-gray-300: rgb(209, 213, 219);
        --color-gray-600: rgb(75, 85, 99);
        --color-slate-900: rgb(15, 23, 42);
        --color-red-500: rgb(239, 68, 68);
        --brand-gray-50: rgb(249, 250, 251);
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, sans-serif;
        background: var(--color-gray-50);
        color: var(--color-slate-900);
      }

      main {
        max-width: 760px;
        margin: 40px auto;
        padding: 24px;
        background: var(--color-white);
        color: var(--color-slate-900);
        border: 1px solid var(--color-gray-300);
      }

      .neutral-palette-card {
        padding: 16px;
        border-radius: 8px;
        background: var(--color-white);
        color: var(--color-slate-900);
        border: 1px solid var(--color-gray-300);
      }

      .neutral-palette-muted {
        color: var(--color-gray-600);
      }

      .neutral-palette-danger {
        color: var(--color-red-500);
      }
    </style>
  </head>
  <body>
    <main id="root-neutral-main">
      <article>
        <h1>Root neutral palette fixture</h1>
        <section id="root-neutral-card" class="neutral-palette-card">
          Neutral palette tokens only.
          <p id="root-neutral-muted" class="neutral-palette-muted">Muted copy</p>
          <p id="root-neutral-danger" class="neutral-palette-danger">Danger copy</p>
        </section>
      </article>
    </main>
  </body>
</html>`;
}

function buildRootProseTokenAppFixtureHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AURA root prose token fixture</title>
    <style>
      :root {
        --color-gray-200: rgb(229, 231, 235);
        --color-gray-600: rgb(75, 85, 99);
        --color-gray-700: rgb(55, 65, 81);
        --color-slate-800: rgb(31, 41, 55);
        --color-slate-900: rgb(17, 24, 39);
        --tw-prose-body: var(--color-gray-700);
        --tw-prose-headings: var(--color-slate-900);
        --tw-prose-lead: var(--color-gray-600);
        --tw-prose-links: var(--color-slate-900);
        --tw-prose-bold: var(--color-slate-900);
        --tw-prose-counters: rgb(107, 114, 128);
        --tw-prose-bullets: rgb(209, 213, 219);
        --tw-prose-hr: var(--color-gray-200);
        --tw-prose-quotes: var(--color-slate-900);
        --tw-prose-quote-borders: var(--color-gray-200);
        --tw-prose-code: var(--color-slate-900);
        --tw-prose-pre-code: var(--color-gray-200);
        --tw-prose-pre-bg: var(--color-slate-800);
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, sans-serif;
        background: rgb(255, 255, 255);
        color: var(--tw-prose-body);
      }

      main {
        max-width: 760px;
        margin: 40px auto;
        padding: 24px;
        background: rgb(255, 255, 255);
      }

      .prose {
        color: var(--tw-prose-body);
      }

      .prose h1 {
        color: var(--tw-prose-headings);
      }

      .prose .lead {
        color: var(--tw-prose-lead);
      }

      .prose a {
        color: var(--tw-prose-links);
      }

      .prose strong {
        color: var(--tw-prose-bold);
      }

      .prose hr {
        border: 0;
        border-top: 1px solid var(--tw-prose-hr);
      }

      .prose blockquote {
        margin: 16px 0;
        padding-left: 16px;
        color: var(--tw-prose-quotes);
        border-left: 4px solid var(--tw-prose-quote-borders);
      }

      .prose code {
        color: var(--tw-prose-code);
      }

      .prose pre {
        padding: 16px;
        color: var(--tw-prose-pre-code);
        background: var(--tw-prose-pre-bg);
      }
    </style>
  </head>
  <body>
    <main id="root-prose-main">
      <article id="root-prose-article" class="prose">
        <h1 id="root-prose-heading">Root prose token fixture</h1>
        <p id="root-prose-lead" class="lead">Lead paragraph using Tailwind Typography variables.</p>
        <p id="root-prose-copy">Body copy with <a id="root-prose-link" href="#prose-link">a prose link</a> and <strong id="root-prose-bold">bold text</strong>.</p>
        <hr id="root-prose-rule" />
        <blockquote id="root-prose-quote">Quoted prose content.</blockquote>
        <pre id="root-prose-pre"><code id="root-prose-code">const mode = 'dark';</code></pre>
      </article>
    </main>
  </body>
</html>`;
}

async function seedRestoreFailedMode(serviceWorker, tabId, modeId) {
  await serviceWorker.evaluate(
    async ({ targetTabId, targetModeId, tabStateKey, statusKey }) => {
      const [tabStateResult, statusResult] = await Promise.all([
        chrome.storage.session.get(tabStateKey),
        chrome.storage.session.get(statusKey),
      ]);
      const tabState = tabStateResult?.[tabStateKey] || {};
      const statuses = statusResult?.[statusKey] || {};
      tabState[targetTabId] = {
        ...(tabState[targetTabId] || {}),
        [targetModeId]: {
          state: 'ERROR',
          pendingDecision: false,
          cssId: 'css-restore-failed',
          smartScope: {
            scopeKey: 'body',
            variant: 'GLOBAL_SAFE_FALLBACK',
            baseCssId: 'css-restore-failed',
            frameId: 0,
          },
        },
      };
      statuses[targetTabId] = {
        ...(statuses[targetTabId] || {}),
        [targetModeId]: {
          action: 'restore',
          ok: false,
          error: 'RESTORE_CSS_REMOVE_FAILED',
          reason: 'RESTORE_CSS_REMOVE_FAILED',
          retryable: true,
          detail: 'base:remove failed',
          attemptId: 'restore-e2e-1',
          timestamp: Date.now(),
        },
      };
      await chrome.storage.session.set({
        [tabStateKey]: tabState,
        [statusKey]: statuses,
      });
    },
    {
      targetTabId: tabId,
      targetModeId: modeId,
      tabStateKey: STORAGE_KEYS.TAB_STATE,
      statusKey: STORAGE_KEYS.SMARTSCOPE_STATUS,
    },
  );
}

async function openPopupForTab(context, extensionId, tabId, tabUrl, messageOverrides = {}) {
  const popupPage = await context.newPage();
  await popupPage.addInitScript(
    ({ resolvedTabId, resolvedTabUrl, overrides, actions }) => {
      window.__auraPopupMessages = [];
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (queryInfo) => {
        if (queryInfo?.active && queryInfo?.currentWindow) {
          return [{ id: resolvedTabId, url: resolvedTabUrl }];
        }
        return originalQuery(queryInfo);
      };

      const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) => {
        window.__auraPopupMessages.push(message);
        if (message?.action === actions.getState && overrides.stateResponses?.[message.modeId]) {
          return { state: overrides.stateResponses[message.modeId] };
        }
        if (message?.action === overrides.restoreAction) {
          return {
            ok: false,
            error: 'RESTORE_CSS_REMOVE_FAILED',
            reason: 'RESTORE_CSS_REMOVE_FAILED',
            retryable: true,
          };
        }
        if (message?.action === overrides.userDecisionAction) {
          return { ok: false, error: 'UNEXPECTED_USER_DECISION' };
        }
        return originalSendMessage(message);
      };
    },
    {
      resolvedTabId: tabId,
      resolvedTabUrl: tabUrl,
      overrides: messageOverrides,
      actions: {
        getState: ACTIONS.GET_STATE,
      },
    },
  );
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.getByTestId('popup-root').waitFor();
  return popupPage;
}

async function openPopupWithMockedModeActions(context, extensionId, tabId, tabUrl) {
  const popupPage = await context.newPage();
  await popupPage.addInitScript(
    ({ resolvedTabId, resolvedTabUrl, tabStateKey, actions, modes, states }) => {
      window.__auraPopupMessages = [];
      const originalQuery = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (queryInfo) => {
        if (queryInfo?.active && queryInfo?.currentWindow) {
          return [{ id: resolvedTabId, url: resolvedTabUrl }];
        }
        return originalQuery(queryInfo);
      };

      const getPeerMode = (modeId) => (modeId === modes.comfort ? modes.focus : modes.comfort);
      const writeModeState = async (modeId, nextState) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        tabState[resolvedTabId] = {
          ...(tabState[resolvedTabId] || {}),
          [modeId]: {
            ...(tabState[resolvedTabId]?.[modeId] || {}),
            ...nextState,
          },
        };
        await chrome.storage.session.set({ [tabStateKey]: tabState });
      };

      const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) => {
        window.__auraPopupMessages.push(message);

        if (message?.action === actions.restore) {
          await writeModeState(message.modeId, {
            state: states.inactive,
            pendingDecision: false,
            cssId: null,
            smartScope: null,
            scopedV2: null,
          });
          return { ok: true, state: states.inactive };
        }

        if (message?.action === actions.userDecision && message?.decision === 'ENABLED') {
          const peerModeId = getPeerMode(message.modeId);
          await writeModeState(peerModeId, {
            state: states.inactive,
            pendingDecision: false,
          });
          await writeModeState(message.modeId, {
            state: states.active,
            pendingDecision: false,
            activeQuality: 'SCOPED_V2_VERIFIED',
          });
          return { ok: true, state: states.active };
        }

        return originalSendMessage(message);
      };
    },
    {
      resolvedTabId: tabId,
      resolvedTabUrl: tabUrl,
      tabStateKey: STORAGE_KEYS.TAB_STATE,
      actions: {
        restore: ACTIONS.RESTORE_MODE,
        userDecision: ACTIONS.USER_DECISION,
      },
      modes: {
        comfort: MODE_IDS.COMFORT_VISUAL,
        focus: MODE_IDS.FOCUS,
      },
      states: {
        active: STATES.ACTIVE,
        inactive: STATES.INACTIVE,
      },
    },
  );

  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.getByTestId('popup-root').waitFor();
  return popupPage;
}

async function openPopupForRealActions(context, extensionId, tabId, tabUrl) {
  const popupPage = await context.newPage();
  await popupPage.addInitScript(({ resolvedTabId, resolvedTabUrl }) => {
    window.__auraPopupMessages = [];
    const originalQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (queryInfo) => {
      if (queryInfo?.active && queryInfo?.currentWindow) {
        return [{ id: resolvedTabId, url: resolvedTabUrl }];
      }
      return originalQuery(queryInfo);
    };

    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message) => {
      const entry = { message, response: null, pending: true };
      window.__auraPopupMessages.push(entry);
      try {
        const response = await originalSendMessage(message);
        entry.response = response;
        entry.pending = false;
        return response;
      } catch (error) {
        entry.error = error?.message || String(error);
        entry.pending = false;
        throw error;
      }
    };
  }, { resolvedTabId: tabId, resolvedTabUrl: tabUrl });

  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.getByTestId('popup-root').waitFor();
  return popupPage;
}

async function waitForRealModeReady(popupPage, modeId) {
  const buttonId = modeId === MODE_IDS.COMFORT_VISUAL ? 'comfort-toggle' : 'focus-toggle';
  const statusId = modeId === MODE_IDS.COMFORT_VISUAL ? 'comfort-status' : 'focus-status';
  await expect(popupPage.locator(`#${buttonId}`)).toBeEnabled();
  await expect(popupPage.locator(`#${statusId}`)).toHaveText('OFF');
}

async function waitForPopupUserDecision(popupPage, modeId, decision) {
  await expect.poll(async () => {
    return popupPage.evaluate(
      ({ targetModeId, targetDecision }) => {
        return window.__auraPopupMessages?.some((entry) => {
          const message = entry?.message || entry;
          const matches = (
            message?.action === 'USER_DECISION'
            && message?.modeId === targetModeId
            && message?.decision === targetDecision
          );
          if (!matches) {
            return false;
          }
          return entry?.pending === true ? false : true;
        }) === true;
      },
      { targetModeId: modeId, targetDecision: decision },
    );
  }, {
    timeout: 30000,
    intervals: [100, 250, 500, 1000],
  }).toBe(true);
}

async function routeSingleFixture(page, url, html) {
  await page.route('http://aura.local/**', async (route) => {
    if (route.request().url() === url) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html,
      });
    } else {
      await route.fulfill({ status: 404, body: '' });
    }
  });
}

test.describe('Popup exclusivity', () => {
  let context;
  let serviceWorker;
  let fixtureHtml;
  let focusFallbackHtml;
  let pageClaritySearchHtml;
  let pageClarityFormHtml;
  let extensionId;

  test.beforeAll(async () => {
    fixtureHtml = await loadFixtureHtml();
    focusFallbackHtml = await loadFocusFallbackFixtureHtml();
    pageClaritySearchHtml = await loadPageClaritySearchFixtureHtml();
    pageClarityFormHtml = await loadPageClarityFormFixtureHtml();
    ({ context, extensionId } = await launchWithExtension({
      extensionPath,
      headless: true,
      verbose: !!process.env.CI,
    }));

    serviceWorker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('real popup exposes Comfort dark theme preference control', async () => {
    await clearExtensionSession(serviceWorker);
    await setComfortDarkModePreference(serviceWorker, false);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, targetUrl, fixtureHtml);
      await page.goto(targetUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page);

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, targetUrl);

      const darkOption = popupPage.getByTestId('comfort-dark-theme-option');
      const darkControl = popupPage.getByTestId('comfort-dark-theme-toggle');
      await expect(darkOption).toBeVisible();
      await expect(darkControl).toBeVisible();
      await expect(darkControl).toBeEnabled();
      await expect(darkControl).not.toBeChecked();
      await expect(
        darkOption.locator('.feature-title'),
      ).toHaveText('Dark mode');

      await darkControl.check();
      await expect(darkControl).toBeChecked();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        return serviceWorker.evaluate(async ({ storageKey, comfortModeId }) => {
          const stored = await chrome.storage.local.get(storageKey);
          return stored?.[storageKey]?.modePrefs?.[comfortModeId]?.darkMode === true;
        }, {
          storageKey: STORAGE_KEYS.USER_PREFS,
          comfortModeId: MODE_IDS.COMFORT_VISUAL,
        });
      }).toBe(true);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup activation applies scoped Comfort Visual on article fixture', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const popupPage = await openPopupForRealActions(context, extensionId, tabId, targetUrl);
    await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
    await popupPage.locator('#comfort-toggle').click();
    await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.ACTIVE);

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return [STATES.ACTIVE, STATES.ERROR].includes(modeState?.state) ? modeState.state : null;
    }).toBeTruthy();

    const activeState = await serviceWorker.evaluate(
      async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.['comfort-visual'] || null;
      },
      { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
    );
    expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.SCOPED_V2_VERIFIED);

    await expect.poll(async () => {
      return page.evaluate(() => {
        const scope = document.querySelector('[data-aura-scope="1"]');
        return {
          scoped: Boolean(scope),
          sentinel: scope ? getComputedStyle(scope).getPropertyValue('--aura-me2-applied').trim() : '',
        };
      });
    }).toEqual({ scoped: true, sentinel: '1' });

    await popupPage.locator('#comfort-toggle').click();
    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.INACTIVE);

    await popupPage.close();
    await page.close();
  });

  test('real popup Comfort activation applies PAGE_CLARITY to search fixture', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await routeSingleFixture(page, pageClaritySearchUrl, pageClaritySearchHtml);

    await page.goto(pageClaritySearchUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });

    const initialStyles = await page.evaluate(() => {
      const link = document.querySelector('#clarity-result-link');
      return {
        decoration: getComputedStyle(link).textDecorationLine,
        background: getComputedStyle(link).backgroundColor,
        color: getComputedStyle(link).color,
      };
    });
    expect(initialStyles.decoration).toBe('none');
    expect(initialStyles.background).toBe('rgba(0, 0, 0, 0)');

    const tabId = await getAuraTabId(serviceWorker, page);
    const popupPage = await openPopupForRealActions(context, extensionId, tabId, pageClaritySearchUrl);
    await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
    await popupPage.locator('#comfort-toggle').click();
    await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.ACTIVE);

    const activeState = await serviceWorker.evaluate(
      async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.['comfort-visual'] || null;
      },
      { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
    );
    expect(activeState.smartScope?.variant).toBe('PAGE_CLARITY_MEDIUM');
    expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED);
    expect(activeState.smartScope?.pageClarity?.probe?.reason).toBe('OK');
    expect(activeState.smartScope?.pageClarity?.probe?.visibleEffectScore).toBeGreaterThanOrEqual(0.5);
    await expect(popupPage.locator('#comfort-status')).toHaveText('MEDIUM');

    const appliedStyles = await page.evaluate(() => {
      const target = document.querySelector('[data-aura-page-clarity="1"]');
      const link = target?.matches?.('a[href], [role="link"]')
        ? target
        : target?.querySelector?.('a[href], [role="link"]');
      return {
        marked: Boolean(target),
        linkFound: Boolean(link),
        decoration: link ? getComputedStyle(link).textDecorationLine : '',
        background: link ? getComputedStyle(link).backgroundColor : '',
        color: link ? getComputedStyle(link).color : '',
      };
    });
    expect(appliedStyles.marked).toBe(true);
    expect(appliedStyles.linkFound).toBe(true);
    expect(appliedStyles.decoration).toContain('underline');
    expect(appliedStyles.background).not.toBe(initialStyles.background);
    expect(appliedStyles.color).not.toBe(initialStyles.color);

    await popupPage.locator('#comfort-toggle').click();
    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.INACTIVE);

    const restoredStyles = await page.evaluate(() => {
      const target = document.querySelector('[data-aura-page-clarity="1"]');
      const link = document.querySelector('#clarity-result-link');
      return {
        marked: Boolean(target),
        decoration: getComputedStyle(link).textDecorationLine,
        background: getComputedStyle(link).backgroundColor,
      };
    });
    expect(restoredStyles.marked).toBe(false);
    expect(restoredStyles.decoration).toBe('none');
    expect(restoredStyles.background).toBe(initialStyles.background);

    await popupPage.close();
    await page.close();
  });

  test('real popup Comfort dark mode applies on Wikipedia-like budget-hit page', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    const wikipediaLikeHtml = buildWikipediaLikeLargeHtml();
    let popupPage = null;

    try {
      await routeSingleFixture(page, wikipediaLikeUrl, wikipediaLikeHtml);

      await page.goto(wikipediaLikeUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const initialStyles = await page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        nodeCount: document.querySelectorAll('*').length,
        headingInlineColor: document.querySelector('#budget-heading')?.style.getPropertyValue('color') || '',
        headingInlineColorPriority: document.querySelector('#budget-heading')?.style.getPropertyPriority('color') || '',
        headingInlineTextFill:
          document.querySelector('#budget-heading')?.style.getPropertyValue('-webkit-text-fill-color') || '',
        headingInlineTextFillPriority:
          document.querySelector('#budget-heading')?.style.getPropertyPriority('-webkit-text-fill-color') || '',
        wikiBaseBackground: getComputedStyle(document.querySelector('#mw-page-base')).backgroundColor,
        wikiBaseImage: getComputedStyle(document.querySelector('#mw-page-base')).backgroundImage,
        wikiHeaderBackground: getComputedStyle(document.querySelector('.vector-header-container')).backgroundColor,
        wikiNavBackground: getComputedStyle(document.querySelector('#mw-navigation')).backgroundColor,
        wikiInfoboxBackground: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundColor,
        wikiInfoboxImage: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundImage,
        wikiTocBackground: getComputedStyle(document.querySelector('#wiki-toc')).backgroundColor,
        wikiTableBackground: getComputedStyle(document.querySelector('#wiki-table')).backgroundColor,
        wikiNavboxBackground: getComputedStyle(document.querySelector('#wiki-navbox')).backgroundColor,
      }));
      expect(initialStyles.bodyBackground).toBe('rgb(255, 255, 255)');
      expect(initialStyles.nodeCount).toBeGreaterThan(5000);
      expect(initialStyles.headingInlineColor).toBe('rgb(20, 20, 20)');
      expect(initialStyles.headingInlineTextFill).toBe('rgb(25, 25, 25)');
      expect(initialStyles.wikiBaseBackground).toBe('rgb(248, 249, 250)');
      expect(initialStyles.wikiBaseImage).toContain('linear-gradient');
      expect(initialStyles.wikiInfoboxBackground).toBe('rgb(248, 249, 250)');
      expect(initialStyles.wikiInfoboxImage).toContain('linear-gradient');

      const tabId = await getAuraTabId(serviceWorker, page);
      const storedPrefsBeforeApply = await serviceWorker.evaluate(async ({ storageKey }) => {
        const stored = await chrome.storage.local.get(storageKey);
        return stored?.[storageKey] || null;
      }, { storageKey: STORAGE_KEYS.USER_PREFS });
      expect(
        storedPrefsBeforeApply?.modePrefs?.[MODE_IDS.COMFORT_VISUAL]?.darkMode,
        JSON.stringify(storedPrefsBeforeApply, null, 2),
      ).toBe(true);

      popupPage = await openPopupForRealActions(context, extensionId, tabId, wikipediaLikeUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      let activeState = null;
      for (let i = 0; i < 50; i += 1) {
        activeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        if ([STATES.ACTIVE, STATES.ERROR].includes(activeState?.state)) {
          break;
        }
        await page.waitForTimeout(100);
      }
      const activeStatus = await serviceWorker.evaluate(
        async ({ targetTabId, statusKey }) => {
          const { [statusKey]: statuses = {} } = await chrome.storage.session.get(statusKey);
          return statuses?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, statusKey: STORAGE_KEYS.SMARTSCOPE_STATUS },
      );
      expect(
        activeState?.state,
        JSON.stringify({ activeState, activeStatus }, null, 2),
      ).toBe(STATES.ACTIVE);
      expect(activeState.smartScope?.variant).not.toBe('PAGE_CLARITY_MEDIUM');
      expect(activeState.smartScope?.fallbackDetail || '').not.toContain('LIVE_BUDGET_HIT');
      if (activeState.smartScope?.variant === 'GLOBAL_SAFE_FALLBACK') {
        expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
        expect(activeState.scopedV2).toBeNull();
        expect(activeState.smartScope?.darkModeEnabled).toBe(true);
        expect(
          activeState.smartScope?.globalDarkRuntime?.ok,
          JSON.stringify(activeState.smartScope?.globalDarkRuntime, null, 2),
        ).toBe(true);
        expect(
          activeState.smartScope?.globalDarkRuntime?.documents?.every((entry) => (
            typeof entry?.documentId === 'string'
            && typeof entry?.receiptId === 'string'
          )),
          JSON.stringify(activeState.smartScope?.globalDarkRuntime, null, 2),
        ).toBe(true);
      } else {
        expect(activeState.scopedV2?.tokenKeys || []).toContain('--aura-color-scheme');
        expect(activeState.scopedV2?.tokenKeys || []).toContain('--aura-bg-color');
        expect(activeState.scopedV2?.tokenKeys || []).toContain('--aura-link-color');
        await expect.poll(async () => {
          return serviceWorker.evaluate(
            async ({ targetTabId, tabStateKey }) => {
              const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
              return tabState?.[targetTabId]?.['comfort-visual']?.scopedV2?.preludeCssId || null;
            },
            { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
          );
        }).toBeTruthy();
      }
      const expectedWikiSurfaceBackground = activeState.smartScope?.variant === 'GLOBAL_SAFE_FALLBACK'
        ? 'rgb(16, 24, 39)'
        : 'rgb(16, 26, 47)';

      await expect.poll(async () => {
        return page.evaluate(() => {
          const scope = document.querySelector('[data-aura-scope="1"]');
          const scopeStyles = scope ? getComputedStyle(scope) : null;
          const bodyStyles = getComputedStyle(document.body);
          return {
            pageClarityMarked: Boolean(document.querySelector('[data-aura-page-clarity="1"]')),
            scoped: Boolean(scope),
            auraScheme: scopeStyles?.getPropertyValue('--aura-color-scheme').trim() || '',
            colorScheme: scopeStyles?.colorScheme || bodyStyles.colorScheme || '',
            bodyBackground: bodyStyles.backgroundColor,
            scopeBackground: scopeStyles?.backgroundColor || '',
            bodyColor: bodyStyles.color,
            wikiBaseBackground: getComputedStyle(document.querySelector('#mw-page-base')).backgroundColor,
            wikiBaseImage: getComputedStyle(document.querySelector('#mw-page-base')).backgroundImage,
            wikiInfoboxBackground: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundColor,
            wikiInfoboxImage: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundImage,
          };
        });
      }).toMatchObject({
        pageClarityMarked: false,
        bodyBackground: 'rgb(11, 16, 32)',
        wikiBaseBackground: expectedWikiSurfaceBackground,
        wikiBaseImage: 'none',
        wikiInfoboxImage: 'none',
      });

      const darkStyles = await page.evaluate(() => {
        const scope = document.querySelector('[data-aura-scope="1"]');
        const heading = document.querySelector('#budget-heading');
        const styles = scope ? getComputedStyle(scope) : getComputedStyle(document.body);
        const bodyStyles = getComputedStyle(document.body);
        return {
          background: styles.backgroundColor,
          color: styles.color,
          colorScheme: styles.colorScheme,
          bodyBackground: bodyStyles.backgroundColor,
          bodyColor: bodyStyles.color,
          headingInlineColor: heading?.style.getPropertyValue('color') || '',
          headingInlineColorPriority: heading?.style.getPropertyPriority('color') || '',
          headingInlineTextFill: heading?.style.getPropertyValue('-webkit-text-fill-color') || '',
          headingInlineTextFillPriority: heading?.style.getPropertyPriority('-webkit-text-fill-color') || '',
          wikiHeaderBackground: getComputedStyle(document.querySelector('.vector-header-container')).backgroundColor,
          wikiNavBackground: getComputedStyle(document.querySelector('#mw-navigation')).backgroundColor,
          wikiInfoboxBackground: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundColor,
          wikiInfoboxColor: getComputedStyle(document.querySelector('#wiki-infobox')).color,
          wikiInfoboxTextFillColor: getComputedStyle(document.querySelector('#wiki-infobox')).webkitTextFillColor,
          wikiTocBackground: getComputedStyle(document.querySelector('#wiki-toc')).backgroundColor,
          wikiThumbBackground: getComputedStyle(document.querySelector('#wiki-thumb')).backgroundColor,
          wikiTableBackground: getComputedStyle(document.querySelector('#wiki-table')).backgroundColor,
          wikiTableCellColor: getComputedStyle(document.querySelector('#wiki-table td')).color,
          wikiNavboxBackground: getComputedStyle(document.querySelector('#wiki-navbox')).backgroundColor,
        };
      });
      expect(darkStyles.background).not.toBe(initialStyles.bodyBackground);
      expect(darkStyles.color).not.toBe(initialStyles.bodyColor);
      expect(darkStyles.bodyBackground).not.toBe(initialStyles.bodyBackground);
      expect(darkStyles.bodyColor).not.toBe(initialStyles.bodyColor);
      expect(darkStyles.colorScheme).toContain('dark');
      expect(darkStyles.headingInlineColor).toMatch(/^var\(--aura-text-color/);
      expect(darkStyles.headingInlineColorPriority).toBe('important');
      expect(darkStyles.headingInlineTextFill).toMatch(/^var\(--aura-text-color/);
      expect(darkStyles.headingInlineTextFillPriority).toBe('important');
      expect(darkStyles.wikiHeaderBackground).not.toBe(initialStyles.wikiHeaderBackground);
      expect(darkStyles.wikiNavBackground).not.toBe(initialStyles.wikiNavBackground);
      expect(darkStyles.wikiInfoboxBackground).not.toBe(initialStyles.wikiInfoboxBackground);
      expect(darkStyles.wikiInfoboxColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.wikiInfoboxTextFillColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.wikiTocBackground).not.toBe(initialStyles.wikiTocBackground);
      expect(darkStyles.wikiThumbBackground).not.toBe(initialStyles.wikiInfoboxBackground);
      expect(darkStyles.wikiTableBackground).not.toBe(initialStyles.wikiTableBackground);
      expect(darkStyles.wikiTableCellColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.wikiNavboxBackground).not.toBe(initialStyles.wikiNavboxBackground);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => {
        return page.evaluate(() => ({
          scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
          pageClarityMarked: Boolean(document.querySelector('[data-aura-page-clarity="1"]')),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          headingInlineColor: document.querySelector('#budget-heading')?.style.getPropertyValue('color') || '',
          headingInlineColorPriority: document.querySelector('#budget-heading')?.style.getPropertyPriority('color') || '',
          headingInlineTextFill:
            document.querySelector('#budget-heading')?.style.getPropertyValue('-webkit-text-fill-color') || '',
          headingInlineTextFillPriority:
            document.querySelector('#budget-heading')?.style.getPropertyPriority('-webkit-text-fill-color') || '',
          wikiBaseBackground: getComputedStyle(document.querySelector('#mw-page-base')).backgroundColor,
          wikiBaseImage: getComputedStyle(document.querySelector('#mw-page-base')).backgroundImage,
          wikiInfoboxBackground: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundColor,
          wikiInfoboxImage: getComputedStyle(document.querySelector('#wiki-infobox')).backgroundImage,
        }));
      }).toEqual({
        scoped: false,
        pageClarityMarked: false,
        bodyBackground: initialStyles.bodyBackground,
        headingInlineColor: initialStyles.headingInlineColor,
        headingInlineColorPriority: initialStyles.headingInlineColorPriority,
        headingInlineTextFill: initialStyles.headingInlineTextFill,
        headingInlineTextFillPriority: initialStyles.headingInlineTextFillPriority,
        wikiBaseBackground: initialStyles.wikiBaseBackground,
        wikiBaseImage: initialStyles.wikiBaseImage,
        wikiInfoboxBackground: initialStyles.wikiInfoboxBackground,
        wikiInfoboxImage: initialStyles.wikiInfoboxImage,
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode preserves already-dark pages with adaptive palette', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, alreadyDarkUrl, buildAlreadyDarkArticleFixtureHtml());

      await page.goto(alreadyDarkUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const initialStyles = await page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        mainBackground: getComputedStyle(document.querySelector('main')).backgroundColor,
        linkColor: getComputedStyle(document.querySelector('a')).color,
        surfaceBackground: getComputedStyle(document.querySelector('#already-dark-surface')).backgroundColor,
        surfaceInlineBackground: document.querySelector('#already-dark-surface')?.style.getPropertyValue('background-color') || '',
        surfaceInlineBackgroundPriority:
          document.querySelector('#already-dark-surface')?.style.getPropertyPriority('background-color') || '',
      }));
      expect(initialStyles.bodyBackground).toBe('rgb(9, 12, 20)');
      expect(initialStyles.mainBackground).toBe('rgb(15, 23, 42)');
      expect(initialStyles.linkColor).toBe('rgb(147, 197, 253)');

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, alreadyDarkUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        return serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
      }).toMatchObject({
        state: STATES.ACTIVE,
        scopedV2: {
          darkModeEnabled: true,
          darkPaletteAlreadyDark: true,
        },
      });

      const activeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      expect(activeState.scopedV2?.tokens?.['--aura-bg-color']).toBe('#10141f');
      expect(activeState.scopedV2?.preludeCssId).toBeTruthy();

      await expect.poll(async () => page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        mainBackground: getComputedStyle(document.querySelector('main')).backgroundColor,
        linkColor: getComputedStyle(document.querySelector('a')).color,
        surfaceBackground: getComputedStyle(document.querySelector('#already-dark-surface')).backgroundColor,
        colorScheme: getComputedStyle(document.body).colorScheme,
      }))).toMatchObject({
        bodyBackground: 'rgb(16, 20, 31)',
      });

      const darkStyles = await page.evaluate(() => ({
        colorScheme: getComputedStyle(document.body).colorScheme,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        mainBackground: getComputedStyle(document.querySelector('main')).backgroundColor,
        linkColor: getComputedStyle(document.querySelector('a')).color,
      }));
      expect(darkStyles.colorScheme).toContain('dark');
      expect(darkStyles.bodyBackground).not.toBe('rgb(11, 16, 32)');
      expect(darkStyles.bodyColor).not.toBe('rgb(230, 230, 230)');
      expect(darkStyles.mainBackground).not.toBe('rgb(11, 16, 32)');
      expect(darkStyles.linkColor).not.toBe('rgb(138, 180, 255)');

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(() => ({
        scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        mainBackground: getComputedStyle(document.querySelector('main')).backgroundColor,
        linkColor: getComputedStyle(document.querySelector('a')).color,
        surfaceBackground: getComputedStyle(document.querySelector('#already-dark-surface')).backgroundColor,
        surfaceInlineBackground: document.querySelector('#already-dark-surface')?.style.getPropertyValue('background-color') || '',
        surfaceInlineBackgroundPriority:
          document.querySelector('#already-dark-surface')?.style.getPropertyPriority('background-color') || '',
      }))).toEqual({
        scoped: false,
        bodyBackground: initialStyles.bodyBackground,
        bodyColor: initialStyles.bodyColor,
        mainBackground: initialStyles.mainBackground,
        linkColor: initialStyles.linkColor,
        surfaceBackground: initialStyles.surfaceBackground,
        surfaceInlineBackground: initialStyles.surfaceInlineBackground,
        surfaceInlineBackgroundPriority: initialStyles.surfaceInlineBackgroundPriority,
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode maps common design system variables', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, designTokenAppUrl, buildDesignTokenAppFixtureHtml());

      await page.goto(designTokenAppUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readDesignTokenStyles = () => {
        const tokenCard = document.querySelector('#token-card');
        const bsPanel = document.querySelector('#bs-panel');
        const mdPanel = document.querySelector('#md-panel');
        const primerPanel = document.querySelector('#primer-panel');
        const localShell = document.querySelector('#local-token-shell');
        const localCard = document.querySelector('#local-token-card');
        const localLink = document.querySelector('#local-token-link');
        const hslShell = document.querySelector('#hsl-token-shell');
        const hslCard = document.querySelector('#hsl-token-card');
        const hslLink = document.querySelector('#hsl-token-link');
        const link = document.querySelector('#token-link');
        const tokenCardStyle = tokenCard ? getComputedStyle(tokenCard) : null;
        const bsPanelStyle = bsPanel ? getComputedStyle(bsPanel) : null;
        const mdPanelStyle = mdPanel ? getComputedStyle(mdPanel) : null;
        const primerPanelStyle = primerPanel ? getComputedStyle(primerPanel) : null;
        const localShellStyle = localShell ? getComputedStyle(localShell) : null;
        const localCardStyle = localCard ? getComputedStyle(localCard) : null;
        const localLinkStyle = localLink ? getComputedStyle(localLink) : null;
        const hslShellStyle = hslShell ? getComputedStyle(hslShell) : null;
        const hslCardStyle = hslCard ? getComputedStyle(hslCard) : null;
        const hslLinkStyle = hslLink ? getComputedStyle(hslLink) : null;
        const linkStyle = link ? getComputedStyle(link) : null;
        return {
          ready: Boolean(
            tokenCard
              && bsPanel
              && mdPanel
              && primerPanel
              && localShell
              && localCard
              && localLink
              && hslShell
              && hslCard
              && hslLink
              && link,
          ),
          scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
          tokenCardBackground: tokenCardStyle?.backgroundColor || '',
          tokenCardColor: tokenCardStyle?.color || '',
          tokenCardVar: tokenCardStyle?.getPropertyValue('--card').trim() || '',
          bsPanelBackground: bsPanelStyle?.backgroundColor || '',
          bsPanelColor: bsPanelStyle?.color || '',
          bsBodyBgVar: bsPanelStyle?.getPropertyValue('--bs-body-bg').trim() || '',
          mdPanelBackground: mdPanelStyle?.backgroundColor || '',
          mdPanelColor: mdPanelStyle?.color || '',
          mdSurfaceVar: mdPanelStyle?.getPropertyValue('--md-sys-color-surface').trim() || '',
          primerPanelBackground: primerPanelStyle?.backgroundColor || '',
          primerPanelColor: primerPanelStyle?.color || '',
          primerBgVar: primerPanelStyle?.getPropertyValue('--bgColor-default').trim() || '',
          localShellCardVar: localShellStyle?.getPropertyValue('--card').trim() || '',
          localCardBackground: localCardStyle?.backgroundColor || '',
          localCardColor: localCardStyle?.color || '',
          localCardVar: localCardStyle?.getPropertyValue('--card').trim() || '',
          localLinkColor: localLinkStyle?.color || '',
          localLinkVar: localLinkStyle?.getPropertyValue('--color-link').trim() || '',
          hslShellBackground: hslShellStyle?.backgroundColor || '',
          hslShellColor: hslShellStyle?.color || '',
          hslShellBackgroundVar: hslShellStyle?.getPropertyValue('--background').trim() || '',
          hslShellForegroundVar: hslShellStyle?.getPropertyValue('--foreground').trim() || '',
          hslCardBackground: hslCardStyle?.backgroundColor || '',
          hslCardColor: hslCardStyle?.color || '',
          hslCardVar: hslCardStyle?.getPropertyValue('--card').trim() || '',
          hslCardTextVar: hslCardStyle?.getPropertyValue('--card-foreground').trim() || '',
          hslLinkColor: hslLinkStyle?.color || '',
          hslLinkVar: hslLinkStyle?.getPropertyValue('--color-link').trim() || '',
          linkColor: linkStyle?.color || '',
          linkVar: linkStyle?.getPropertyValue('--color-link').trim() || '',
        };
      };

      const initial = await page.evaluate(readDesignTokenStyles);
      expect(initial).toMatchObject({
        ready: true,
        scoped: false,
        tokenCardBackground: 'rgb(255, 255, 255)',
        bsPanelBackground: 'rgb(255, 255, 255)',
        mdPanelBackground: 'rgb(255, 255, 255)',
        primerPanelBackground: 'rgb(255, 255, 255)',
        localShellCardVar: 'rgb(255, 255, 255)',
        localCardBackground: 'rgb(255, 255, 255)',
        localCardVar: 'rgb(255, 255, 255)',
        hslShellBackground: 'rgb(255, 255, 255)',
        hslShellBackgroundVar: '0 0% 100%',
        hslCardBackground: 'rgb(255, 255, 255)',
        hslCardVar: '0 0% 100%',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, designTokenAppUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      await expect.poll(async () => page.evaluate(readDesignTokenStyles)).toMatchObject({
        ready: true,
      });

      const dark = await page.evaluate(readDesignTokenStyles);
      expect(dark.tokenCardBackground).not.toBe(initial.tokenCardBackground);
      expect(dark.bsPanelBackground).not.toBe(initial.bsPanelBackground);
      expect(dark.mdPanelBackground).not.toBe(initial.mdPanelBackground);
      expect(dark.primerPanelBackground).not.toBe(initial.primerPanelBackground);
      expect(dark.localCardBackground).not.toBe(initial.localCardBackground);
      expect(dark.tokenCardColor).not.toBe(initial.tokenCardColor);
      expect(dark.bsPanelColor).not.toBe(initial.bsPanelColor);
      expect(dark.mdPanelColor).not.toBe(initial.mdPanelColor);
      expect(dark.primerPanelColor).not.toBe(initial.primerPanelColor);
      expect(dark.localCardColor).not.toBe(initial.localCardColor);
      expect(dark.tokenCardVar).not.toBe(initial.tokenCardVar);
      expect(dark.bsBodyBgVar).not.toBe(initial.bsBodyBgVar);
      expect(dark.mdSurfaceVar).not.toBe(initial.mdSurfaceVar);
      expect(dark.primerBgVar).not.toBe(initial.primerBgVar);
      expect(dark.localShellCardVar).not.toBe(initial.localShellCardVar);
      expect(dark.localCardVar).not.toBe(initial.localCardVar);
      expect(dark.localLinkVar).not.toBe(initial.localLinkVar);
      expect(dark.localLinkColor).not.toBe(initial.localLinkColor);
      expect(dark.hslShellBackground).not.toBe(initial.hslShellBackground);
      expect(dark.hslShellColor).not.toBe(initial.hslShellColor);
      expect(dark.hslShellBackgroundVar).toBe('224 60% 8%');
      expect(dark.hslShellForegroundVar).toBe('0 0% 90%');
      expect(dark.hslCardBackground).not.toBe(initial.hslCardBackground);
      expect(dark.hslCardColor).not.toBe(initial.hslCardColor);
      expect(dark.hslCardVar).toBe('218 49% 12%');
      expect(dark.hslCardTextVar).toBe('0 0% 90%');
      expect(dark.hslLinkVar).toBe('216 100% 77%');
      expect(dark.hslLinkColor).not.toBe(initial.hslLinkColor);
      expect(dark.linkVar).not.toBe(initial.linkVar);
      expect(dark.linkColor).not.toBe(initial.linkColor);

      await page.evaluate(() => {
        const style = document.createElement('style');
        style.id = 'late-local-token-light-theme';
        style.textContent = [
          '.local-token-shell[data-theme] {',
          '--card: rgb(255, 255, 255) !important;',
          '--card-foreground: rgb(17, 24, 39) !important;',
          '--border: rgb(210, 214, 220) !important;',
          '--color-link: rgb(29, 78, 216) !important;',
          '}',
        ].join(' ');
        document.head.appendChild(style);
        document.querySelector('#local-token-shell')?.setAttribute('data-theme', 'late-light');
      });

      const lateLight = await page.evaluate(readDesignTokenStyles);
      expect(lateLight.localCardBackground).toBe(dark.localCardBackground);
      expect(lateLight.localCardColor).toBe(dark.localCardColor);
      expect(lateLight.localShellCardVar).toBe(dark.localShellCardVar);
      expect(lateLight.localLinkColor).toBe(dark.localLinkColor);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readDesignTokenStyles)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode maps root-level HSL channel variables', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, rootHslTokenAppUrl, buildRootHslTokenAppFixtureHtml());

      await page.goto(rootHslTokenAppUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readRootHslTokenStyles = () => {
        const main = document.querySelector('#root-hsl-main');
        const card = document.querySelector('#root-hsl-card');
        const link = document.querySelector('#root-hsl-link');
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        const mainStyle = main ? getComputedStyle(main) : null;
        const cardStyle = card ? getComputedStyle(card) : null;
        const linkStyle = link ? getComputedStyle(link) : null;
        return {
          ready: Boolean(main && card && link),
          rootBackgroundVar: rootStyle.getPropertyValue('--background').trim(),
          rootForegroundVar: rootStyle.getPropertyValue('--foreground').trim(),
          bodyBackgroundVar: bodyStyle.getPropertyValue('--background').trim(),
          bodyForegroundVar: bodyStyle.getPropertyValue('--foreground').trim(),
          bodyBackground: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          mainBackground: mainStyle?.backgroundColor || '',
          mainColor: mainStyle?.color || '',
          cardBackground: cardStyle?.backgroundColor || '',
          cardColor: cardStyle?.color || '',
          cardVar: cardStyle?.getPropertyValue('--card').trim() || '',
          cardTextVar: cardStyle?.getPropertyValue('--card-foreground').trim() || '',
          linkColor: linkStyle?.color || '',
          linkVar: linkStyle?.getPropertyValue('--color-link').trim() || '',
        };
      };

      const initial = await page.evaluate(readRootHslTokenStyles);
      expect(initial).toMatchObject({
        ready: true,
        rootBackgroundVar: '0 0% 100%',
        bodyBackgroundVar: '0 0% 100%',
        bodyBackground: 'rgb(255, 255, 255)',
        mainBackground: 'rgb(255, 255, 255)',
        cardBackground: 'rgb(255, 255, 255)',
        cardVar: '0 0% 100%',
        linkVar: '217 91% 60%',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, rootHslTokenAppUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      const dark = await page.evaluate(readRootHslTokenStyles);
      expect(dark.rootBackgroundVar).toBe('224 60% 8%');
      expect(dark.rootForegroundVar).toBe('0 0% 90%');
      expect(dark.bodyBackgroundVar).toBe('224 60% 8%');
      expect(dark.bodyForegroundVar).toBe('0 0% 90%');
      expect(dark.bodyBackground).not.toBe(initial.bodyBackground);
      expect(dark.bodyColor).not.toBe(initial.bodyColor);
      expect(dark.mainBackground).not.toBe(initial.mainBackground);
      expect(dark.mainColor).not.toBe(initial.mainColor);
      expect(dark.cardBackground).not.toBe(initial.cardBackground);
      expect(dark.cardColor).not.toBe(initial.cardColor);
      expect(dark.cardVar).toBe('218 49% 12%');
      expect(dark.cardTextVar).toBe('0 0% 90%');
      expect(dark.linkVar).toBe('216 100% 77%');
      expect(dark.linkColor).not.toBe(initial.linkColor);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readRootHslTokenStyles)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode maps root-level RGB channel variables', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, rootRgbTokenAppUrl, buildRootRgbTokenAppFixtureHtml());

      await page.goto(rootRgbTokenAppUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readRootRgbTokenStyles = () => {
        const main = document.querySelector('#root-rgb-main');
        const card = document.querySelector('#root-rgb-card');
        const link = document.querySelector('#root-rgb-link');
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        const mainStyle = main ? getComputedStyle(main) : null;
        const cardStyle = card ? getComputedStyle(card) : null;
        const linkStyle = link ? getComputedStyle(link) : null;
        return {
          ready: Boolean(main && card && link),
          rootBackgroundVar: rootStyle.getPropertyValue('--background').trim(),
          rootForegroundVar: rootStyle.getPropertyValue('--foreground').trim(),
          bodyBackgroundVar: bodyStyle.getPropertyValue('--background').trim(),
          bodyForegroundVar: bodyStyle.getPropertyValue('--foreground').trim(),
          bodyBackground: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          mainBackground: mainStyle?.backgroundColor || '',
          mainColor: mainStyle?.color || '',
          cardBackground: cardStyle?.backgroundColor || '',
          cardColor: cardStyle?.color || '',
          cardVar: cardStyle?.getPropertyValue('--card').trim() || '',
          cardTextVar: cardStyle?.getPropertyValue('--card-foreground').trim() || '',
          borderVar: cardStyle?.getPropertyValue('--border').trim() || '',
          linkColor: linkStyle?.color || '',
          linkVar: linkStyle?.getPropertyValue('--color-link').trim() || '',
        };
      };

      const initial = await page.evaluate(readRootRgbTokenStyles);
      expect(initial).toMatchObject({
        ready: true,
        rootBackgroundVar: '255 255 255',
        bodyBackgroundVar: '255 255 255',
        bodyBackground: 'rgb(255, 255, 255)',
        mainBackground: 'rgb(255, 255, 255)',
        cardBackground: 'rgb(255, 255, 255)',
        cardVar: '255 255 255',
        linkVar: '29 78 216',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, rootRgbTokenAppUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      const dark = await page.evaluate(readRootRgbTokenStyles);
      expect(dark.rootBackgroundVar).toBe('11 16 32');
      expect(dark.rootForegroundVar).toBe('230 230 230');
      expect(dark.bodyBackgroundVar).toBe('11 16 32');
      expect(dark.bodyForegroundVar).toBe('230 230 230');
      expect(dark.bodyBackground).not.toBe(initial.bodyBackground);
      expect(dark.bodyColor).not.toBe(initial.bodyColor);
      expect(dark.mainBackground).not.toBe(initial.mainBackground);
      expect(dark.mainColor).not.toBe(initial.mainColor);
      expect(dark.cardBackground).not.toBe(initial.cardBackground);
      expect(dark.cardColor).not.toBe(initial.cardColor);
      expect(dark.cardVar).toBe('16 26 47');
      expect(dark.cardTextVar).toBe('230 230 230');
      expect(dark.borderVar).toBe('71 85 105');
      expect(dark.linkVar).toBe('138 180 255');
      expect(dark.linkColor).not.toBe(initial.linkColor);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readRootRgbTokenStyles)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode maps root-level neutral palette variables', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, rootNeutralPaletteAppUrl, buildRootNeutralPaletteAppFixtureHtml());

      await page.goto(rootNeutralPaletteAppUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readRootNeutralPaletteStyles = () => {
        const main = document.querySelector('#root-neutral-main');
        const card = document.querySelector('#root-neutral-card');
        const muted = document.querySelector('#root-neutral-muted');
        const danger = document.querySelector('#root-neutral-danger');
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        const mainStyle = main ? getComputedStyle(main) : null;
        const cardStyle = card ? getComputedStyle(card) : null;
        const mutedStyle = muted ? getComputedStyle(muted) : null;
        const dangerStyle = danger ? getComputedStyle(danger) : null;
        return {
          ready: Boolean(main && card && muted && danger),
          whiteVar: rootStyle.getPropertyValue('--color-white').trim(),
          gray50Var: rootStyle.getPropertyValue('--color-gray-50').trim(),
          gray300Var: rootStyle.getPropertyValue('--color-gray-300').trim(),
          gray600Var: rootStyle.getPropertyValue('--color-gray-600').trim(),
          slate900Var: rootStyle.getPropertyValue('--color-slate-900').trim(),
          red500Var: rootStyle.getPropertyValue('--color-red-500').trim(),
          brandGray50Var: rootStyle.getPropertyValue('--brand-gray-50').trim(),
          bodyBackground: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          mainBackground: mainStyle?.backgroundColor || '',
          mainColor: mainStyle?.color || '',
          mainBorderColor: mainStyle?.borderTopColor || '',
          cardBackground: cardStyle?.backgroundColor || '',
          cardColor: cardStyle?.color || '',
          cardBorderColor: cardStyle?.borderTopColor || '',
          mutedColor: mutedStyle?.color || '',
          dangerColor: dangerStyle?.color || '',
        };
      };

      const initial = await page.evaluate(readRootNeutralPaletteStyles);
      expect(initial).toMatchObject({
        ready: true,
        whiteVar: 'rgb(255, 255, 255)',
        gray50Var: 'rgb(249, 250, 251)',
        gray300Var: 'rgb(209, 213, 219)',
        gray600Var: 'rgb(75, 85, 99)',
        slate900Var: 'rgb(15, 23, 42)',
        red500Var: 'rgb(239, 68, 68)',
        brandGray50Var: 'rgb(249, 250, 251)',
        bodyBackground: 'rgb(249, 250, 251)',
        mainBackground: 'rgb(255, 255, 255)',
        cardBackground: 'rgb(255, 255, 255)',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, rootNeutralPaletteAppUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      const dark = await page.evaluate(readRootNeutralPaletteStyles);
      expect(dark.whiteVar).not.toBe(initial.whiteVar);
      expect(dark.gray50Var).not.toBe(initial.gray50Var);
      expect(dark.gray300Var).not.toBe(initial.gray300Var);
      expect(dark.gray600Var).not.toBe(initial.gray600Var);
      expect(dark.slate900Var).not.toBe(initial.slate900Var);
      expect(dark.red500Var).toBe(initial.red500Var);
      expect(dark.brandGray50Var).toBe(initial.brandGray50Var);
      expect(dark.bodyBackground).not.toBe(initial.bodyBackground);
      expect(dark.bodyColor).not.toBe(initial.bodyColor);
      expect(dark.mainBackground).not.toBe(initial.mainBackground);
      expect(dark.mainColor).not.toBe(initial.mainColor);
      expect(dark.mainBorderColor).not.toBe(initial.mainBorderColor);
      expect(dark.cardBackground).not.toBe(initial.cardBackground);
      expect(dark.cardColor).not.toBe(initial.cardColor);
      expect(dark.cardBorderColor).not.toBe(initial.cardBorderColor);
      expect(dark.mutedColor).not.toBe(initial.mutedColor);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readRootNeutralPaletteStyles)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode maps root-level Tailwind prose variables', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, rootProseTokenAppUrl, buildRootProseTokenAppFixtureHtml());

      await page.goto(rootProseTokenAppUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readRootProseTokenStyles = () => {
        const main = document.querySelector('#root-prose-main');
        const article = document.querySelector('#root-prose-article');
        const heading = document.querySelector('#root-prose-heading');
        const lead = document.querySelector('#root-prose-lead');
        const copy = document.querySelector('#root-prose-copy');
        const link = document.querySelector('#root-prose-link');
        const rule = document.querySelector('#root-prose-rule');
        const quote = document.querySelector('#root-prose-quote');
        const code = document.querySelector('#root-prose-code');
        const pre = document.querySelector('#root-prose-pre');
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        const mainStyle = main ? getComputedStyle(main) : null;
        const articleStyle = article ? getComputedStyle(article) : null;
        const headingStyle = heading ? getComputedStyle(heading) : null;
        const leadStyle = lead ? getComputedStyle(lead) : null;
        const copyStyle = copy ? getComputedStyle(copy) : null;
        const linkStyle = link ? getComputedStyle(link) : null;
        const ruleStyle = rule ? getComputedStyle(rule) : null;
        const quoteStyle = quote ? getComputedStyle(quote) : null;
        const codeStyle = code ? getComputedStyle(code) : null;
        const preStyle = pre ? getComputedStyle(pre) : null;
        return {
          ready: Boolean(main && article && heading && lead && copy && link && rule && quote && code && pre),
          bodyVar: rootStyle.getPropertyValue('--tw-prose-body').trim(),
          headingsVar: rootStyle.getPropertyValue('--tw-prose-headings').trim(),
          leadVar: rootStyle.getPropertyValue('--tw-prose-lead').trim(),
          linksVar: rootStyle.getPropertyValue('--tw-prose-links').trim(),
          hrVar: rootStyle.getPropertyValue('--tw-prose-hr').trim(),
          quoteBordersVar: rootStyle.getPropertyValue('--tw-prose-quote-borders').trim(),
          codeVar: rootStyle.getPropertyValue('--tw-prose-code').trim(),
          preCodeVar: rootStyle.getPropertyValue('--tw-prose-pre-code').trim(),
          preBgVar: rootStyle.getPropertyValue('--tw-prose-pre-bg').trim(),
          bodyBackground: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          mainBackground: mainStyle?.backgroundColor || '',
          articleColor: articleStyle?.color || '',
          headingColor: headingStyle?.color || '',
          leadColor: leadStyle?.color || '',
          copyColor: copyStyle?.color || '',
          linkColor: linkStyle?.color || '',
          ruleColor: ruleStyle?.borderTopColor || '',
          quoteColor: quoteStyle?.color || '',
          quoteBorderColor: quoteStyle?.borderLeftColor || '',
          codeColor: codeStyle?.color || '',
          preColor: preStyle?.color || '',
          preBackground: preStyle?.backgroundColor || '',
        };
      };

      const initial = await page.evaluate(readRootProseTokenStyles);
      expect(initial).toMatchObject({
        ready: true,
        bodyVar: 'rgb(55, 65, 81)',
        headingsVar: 'rgb(17, 24, 39)',
        leadVar: 'rgb(75, 85, 99)',
        linksVar: 'rgb(17, 24, 39)',
        hrVar: 'rgb(229, 231, 235)',
        quoteBordersVar: 'rgb(229, 231, 235)',
        codeVar: 'rgb(17, 24, 39)',
        preCodeVar: 'rgb(229, 231, 235)',
        preBgVar: 'rgb(31, 41, 55)',
        bodyBackground: 'rgb(255, 255, 255)',
        mainBackground: 'rgb(255, 255, 255)',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, rootProseTokenAppUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      const dark = await page.evaluate(readRootProseTokenStyles);
      expect(dark.bodyVar).not.toBe(initial.bodyVar);
      expect(dark.headingsVar).not.toBe(initial.headingsVar);
      expect(dark.leadVar).not.toBe(initial.leadVar);
      expect(dark.linksVar).not.toBe(initial.linksVar);
      expect(dark.hrVar).not.toBe(initial.hrVar);
      expect(dark.quoteBordersVar).not.toBe(initial.quoteBordersVar);
      expect(dark.codeVar).not.toBe(initial.codeVar);
      expect(dark.preCodeVar).not.toBe(initial.preCodeVar);
      expect(dark.preBgVar).not.toBe(initial.preBgVar);
      expect(dark.bodyBackground).not.toBe(initial.bodyBackground);
      expect(dark.bodyColor).not.toBe(initial.bodyColor);
      expect(dark.mainBackground).not.toBe(initial.mainBackground);
      expect(dark.articleColor).not.toBe(initial.articleColor);
      expect(dark.headingColor).not.toBe(initial.headingColor);
      expect(dark.leadColor).not.toBe(initial.leadColor);
      expect(dark.copyColor).not.toBe(initial.copyColor);
      expect(dark.linkColor).not.toBe(initial.linkColor);
      expect(dark.ruleColor).not.toBe(initial.ruleColor);
      expect(dark.quoteColor).not.toBe(initial.quoteColor);
      expect(dark.quoteBorderColor).not.toBe(initial.quoteBorderColor);
      expect(dark.codeColor).not.toBe(initial.codeColor);
      expect(dark.preBackground).not.toBe(initial.preBackground);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readRootProseTokenStyles)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode styles and cleans open shadow roots', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, shadowDomUrl, buildShadowDomFixtureHtml());

      await page.goto(shadowDomUrl);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(() => {
        return Boolean(
          document.querySelector('#shadow-card')?.shadowRoot?.querySelector('.card')
          && document.querySelector('#closed-shadow-card')?.getPartStyles?.().ready
          && document.querySelector('#closed-token-card')?.getTokenStyles?.().ready,
        );
      });
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const readShadowCard = () => {
        const host = document.querySelector('#shadow-card');
        const root = host?.shadowRoot || null;
        const card = root?.querySelector('.card') || null;
        const tokenCard = root?.querySelector('.token-card') || null;
        const tokenLink = tokenCard?.querySelector('a') || null;
        const inlinePanel = root?.querySelector('.inline-panel') || null;
        const mediaCard = root?.querySelector('.media-card') || null;
        const link = root?.querySelector('a') || null;
        const auraStyle = root?.querySelector('style[data-aura-dark-comfort-shadow-style="aura-dark-comfort-theme-v1"]') || null;
        const cardStyle = card ? getComputedStyle(card) : null;
        const tokenCardStyle = tokenCard ? getComputedStyle(tokenCard) : null;
        const tokenLinkStyle = tokenLink ? getComputedStyle(tokenLink) : null;
        const inlinePanelStyle = inlinePanel ? getComputedStyle(inlinePanel) : null;
        const mediaCardStyle = mediaCard ? getComputedStyle(mediaCard) : null;
        const linkStyle = link ? getComputedStyle(link) : null;
        const hostStyle = host ? getComputedStyle(host) : null;
        const closedPartStyles = document.querySelector('#closed-shadow-card')?.getPartStyles?.() || null;
        const closedTokenStyles = document.querySelector('#closed-token-card')?.getTokenStyles?.() || null;
        return {
          ready: Boolean(
            host
            && root
            && card
            && tokenCard
            && tokenLink
            && inlinePanel
            && mediaCard
            && link
            && closedPartStyles?.ready
            && closedTokenStyles?.ready
          ),
          auraStyle: Boolean(auraStyle),
          cardBackground: cardStyle?.backgroundColor || '',
          cardColor: cardStyle?.color || '',
          tokenCardBackground: tokenCardStyle?.backgroundColor || '',
          tokenCardColor: tokenCardStyle?.color || '',
          tokenCardBorderColor: tokenCardStyle?.borderTopColor || '',
          tokenCardVariable: tokenCardStyle?.getPropertyValue('--card').trim() || '',
          tokenLinkColor: tokenLinkStyle?.color || '',
          inlinePanelBackground: inlinePanelStyle?.backgroundColor || '',
          inlinePanelBackgroundImage: inlinePanelStyle?.backgroundImage || '',
          inlinePanelColor: inlinePanelStyle?.color || '',
          inlinePanelInlineBackground: inlinePanel?.style.getPropertyValue('background-color') || '',
          inlinePanelInlineImage: inlinePanel?.style.getPropertyValue('background-image') || '',
          inlinePanelInlineTextFill: inlinePanel?.style.getPropertyValue('-webkit-text-fill-color') || '',
          inlinePanelInlineTextFillPriority: inlinePanel?.style.getPropertyPriority('-webkit-text-fill-color') || '',
          mediaCardImage: mediaCardStyle?.backgroundImage || '',
          mediaCardAuraMedia: mediaCard?.getAttribute('data-aura-bg-media') || null,
          linkColor: linkStyle?.color || '',
          hostColorScheme: hostStyle?.colorScheme || '',
          closedPartStyles,
          closedTokenStyles,
        };
      };
      const initial = await page.evaluate(readShadowCard);
      expect(initial.ready).toBe(true);
      expect(initial.auraStyle).toBe(false);
      expect(initial.cardBackground).toBe('rgb(255, 255, 255)');
      expect(initial.tokenCardBackground).toBe('rgb(255, 255, 255)');
      expect(initial.tokenCardColor).toBe('rgb(17, 24, 39)');
      expect(initial.tokenCardBorderColor).toBe('rgb(210, 214, 220)');
      expect(initial.tokenCardVariable).toBe('rgb(255, 255, 255)');
      expect(initial.tokenLinkColor).toBe('rgb(29, 78, 216)');
      expect(initial.inlinePanelBackground).toBe('rgb(255, 255, 255)');
      expect(initial.inlinePanelBackgroundImage).toBe('linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))');
      expect(initial.mediaCardImage).toContain('data:image/svg+xml');
      expect(initial.mediaCardAuraMedia).toBeNull();
      expect(initial.closedPartStyles).toMatchObject({
        ready: true,
        surfaceBackground: 'rgb(255, 255, 255)',
        surfaceColor: 'rgb(17, 24, 39)',
        headingColor: 'rgb(17, 24, 39)',
        buttonBackground: 'rgb(255, 255, 255)',
        buttonColor: 'rgb(17, 24, 39)',
      });
      expect(initial.closedTokenStyles.ready).toBe(true);
      expect(initial.closedTokenStyles.hostCardToken.replace(/\s+/g, '')).toBe('rgb(255,255,255)');
      expect(initial.closedTokenStyles.hostTextToken.replace(/\s+/g, '')).toBe('rgb(17,24,39)');
      expect(initial.closedTokenStyles.hostBorderToken.replace(/\s+/g, '')).toBe('rgb(210,214,220)');
      expect(initial.closedTokenStyles.hostLinkToken.replace(/\s+/g, '')).toBe('rgb(29,78,216)');
      expect(initial.closedTokenStyles).toMatchObject({
        cardBackground: 'rgb(255, 255, 255)',
        cardColor: 'rgb(17, 24, 39)',
        cardBorderColor: 'rgb(210, 214, 220)',
        linkColor: 'rgb(29, 78, 216)',
      });

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, shadowDomUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      await expect.poll(async () => page.evaluate(readShadowCard)).toMatchObject({
        ready: true,
        auraStyle: true,
      });

      await expect.poll(async () => {
        const shadow = await page.evaluate(readShadowCard);
        return {
          inlinePanelBackgroundChanged: shadow.inlinePanelBackground !== initial.inlinePanelBackground,
          inlinePanelBackgroundImage: shadow.inlinePanelBackgroundImage,
          inlinePanelInlineImage: shadow.inlinePanelInlineImage,
          inlinePanelInlineBackgroundIsAura: /^var\(--aura-surface-1/.test(shadow.inlinePanelInlineBackground || ''),
        };
      }).toEqual({
        inlinePanelBackgroundChanged: true,
        inlinePanelBackgroundImage: 'none',
        inlinePanelInlineImage: 'none',
        inlinePanelInlineBackgroundIsAura: true,
      });

      const darkShadow = await page.evaluate(readShadowCard);
      expect(darkShadow.cardColor).not.toBe(initial.cardColor);
      expect(darkShadow.tokenCardBackground).not.toBe(initial.tokenCardBackground);
      expect(darkShadow.tokenCardColor).not.toBe(initial.tokenCardColor);
      expect(darkShadow.tokenCardBorderColor).not.toBe(initial.tokenCardBorderColor);
      expect(darkShadow.tokenCardVariable).not.toBe(initial.tokenCardVariable);
      expect(darkShadow.tokenLinkColor).not.toBe(initial.tokenLinkColor);

      await page.evaluate(() => {
        const host = document.querySelector('#shadow-card');
        const root = host?.shadowRoot || null;
        const lateStyle = document.createElement('style');
        lateStyle.id = 'late-shadow-light-theme';
        lateStyle.textContent = [
          ':host {',
          '--card: rgb(255, 255, 255) !important;',
          '--card-foreground: rgb(17, 24, 39) !important;',
          '--border: rgb(210, 214, 220) !important;',
          '--color-link: rgb(29, 78, 216) !important;',
          '}',
        ].join(' ');
        root?.appendChild(lateStyle);
        host?.setAttribute('data-theme', 'late-light-theme');
      });
      await expect.poll(async () => page.evaluate(readShadowCard)).toMatchObject({
        tokenCardBackground: darkShadow.tokenCardBackground,
        tokenCardColor: darkShadow.tokenCardColor,
        tokenCardBorderColor: darkShadow.tokenCardBorderColor,
        tokenLinkColor: darkShadow.tokenLinkColor,
      });

      expect(darkShadow.inlinePanelBackground).not.toBe(initial.inlinePanelBackground);
      expect(darkShadow.inlinePanelBackgroundImage).toBe('none');
      expect(darkShadow.inlinePanelColor).not.toBe(initial.inlinePanelColor);
      expect(darkShadow.inlinePanelInlineBackground).toMatch(/^var\(--aura-surface-1/);
      expect(darkShadow.inlinePanelInlineImage).toBe('none');
      expect(darkShadow.inlinePanelInlineTextFill).toMatch(/^var\(--aura-text-color/);
      expect(darkShadow.inlinePanelInlineTextFillPriority).toBe('important');
      expect(darkShadow.mediaCardImage).toContain('data:image/svg+xml');
      expect(darkShadow.linkColor).not.toBe(initial.linkColor);
      expect(darkShadow.hostColorScheme).toContain('dark');
      expect(darkShadow.closedPartStyles.surfaceBackground).not.toBe(initial.closedPartStyles.surfaceBackground);
      expect(darkShadow.closedPartStyles.surfaceColor).not.toBe(initial.closedPartStyles.surfaceColor);
      expect(darkShadow.closedPartStyles.headingColor).not.toBe(initial.closedPartStyles.headingColor);
      expect(darkShadow.closedPartStyles.buttonBackground).not.toBe(initial.closedPartStyles.buttonBackground);
      expect(darkShadow.closedPartStyles.buttonColor).not.toBe(initial.closedPartStyles.buttonColor);
      expect(darkShadow.closedTokenStyles.hostCardToken).not.toBe(initial.closedTokenStyles.hostCardToken);
      expect(darkShadow.closedTokenStyles.hostTextToken).not.toBe(initial.closedTokenStyles.hostTextToken);
      expect(darkShadow.closedTokenStyles.hostBorderToken).not.toBe(initial.closedTokenStyles.hostBorderToken);
      expect(darkShadow.closedTokenStyles.hostLinkToken).not.toBe(initial.closedTokenStyles.hostLinkToken);
      expect(darkShadow.closedTokenStyles.cardBackground).not.toBe(initial.closedTokenStyles.cardBackground);
      expect(darkShadow.closedTokenStyles.cardColor).not.toBe(initial.closedTokenStyles.cardColor);
      expect(darkShadow.closedTokenStyles.cardBorderColor).not.toBe(initial.closedTokenStyles.cardBorderColor);
      expect(darkShadow.closedTokenStyles.linkColor).not.toBe(initial.closedTokenStyles.linkColor);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(readShadowCard)).toEqual(initial);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode catches existing-node style mutations', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, dynamicStyleMutationUrl, buildDynamicStyleMutationFixtureHtml());

      await page.goto(dynamicStyleMutationUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, dynamicStyleMutationUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      await expect.poll(async () => page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        return panel.style.getPropertyValue('background-color');
      })).toMatch(/^var\(--aura-surface-[12]\)$/);
      await expect.poll(async () => page.evaluate(() => {
        return document.querySelector('#dynamic-panel').style.getPropertyPriority('background-color');
      })).toBe('important');

      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        panel.classList.add('late-light-theme');
        panel.style.setProperty('min-height', '180px');
        panel.style.setProperty('padding', '24px');
        panel.style.setProperty('border', '1px solid rgb(200, 200, 200)');
        panel.style.setProperty('background-color', 'rgb(255, 255, 255)', 'important');
        panel.style.setProperty('color', 'rgb(20, 20, 20)', 'important');
      });

      await expect.poll(async () => page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        const styles = getComputedStyle(panel);
        return {
          background: styles.backgroundColor,
          color: styles.color,
          inlineBackground: panel.style.getPropertyValue('background-color'),
          inlineBackgroundPriority: panel.style.getPropertyPriority('background-color'),
        };
      })).toMatchObject({
        inlineBackgroundPriority: 'important',
      });
      await expect.poll(async () => page.evaluate(() => {
        return document.querySelector('#dynamic-panel').style.getPropertyValue('background-color');
      })).toMatch(/^var\(--aura-surface-[12]\)$/);

      const darkPanelStyles = await page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        const styles = getComputedStyle(panel);
        return {
          background: styles.backgroundColor,
          color: styles.color,
        };
      });
      expect(darkPanelStyles.background).not.toBe('rgb(255, 255, 255)');
      expect(darkPanelStyles.color).not.toBe('rgb(20, 20, 20)');

      await page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        window.__auraDetachedDynamicPanel = panel;
        panel.remove();
      });
      await expect(page.locator('#dynamic-panel')).toHaveCount(0);

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await page.evaluate(() => {
        document.querySelector('article').appendChild(window.__auraDetachedDynamicPanel);
        delete window.__auraDetachedDynamicPanel;
      });
      await expect.poll(async () => page.evaluate(() => {
        const panel = document.querySelector('#dynamic-panel');
        const styles = getComputedStyle(panel);
        return {
          background: styles.backgroundColor,
          color: styles.color,
          inlineBackground: panel.style.getPropertyValue('background-color'),
          inlineBackgroundPriority: panel.style.getPropertyPriority('background-color'),
        };
      })).toEqual({
        background: 'rgb(255, 255, 255)',
        color: 'rgb(20, 20, 20)',
        inlineBackground: 'rgb(255, 255, 255)',
        inlineBackgroundPriority: 'important',
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark mode uses global fallback on unknown shell page', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await routeSingleFixture(page, focusFallbackUrl, buildGlobalFallbackVisualFixtureHtml());

      await page.goto(focusFallbackUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);
      await page.evaluate(() => {
        document.body.style.setProperty('--aura-bg-color', 'rgb(250, 250, 250)', 'important');
        document.querySelector('#photo-card').setAttribute('data-aura-bg-media', 'site-owned');
      });

      const initialStyles = await page.evaluate(() => ({
        bodyAuraBackground: document.body.style.getPropertyValue('--aura-bg-color'),
        bodyAuraBackgroundPriority: document.body.style.getPropertyPriority('--aura-bg-color'),
        htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
        htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        linkColor: getComputedStyle(document.querySelector('#primary-link')).color,
        linkTextFillColor: getComputedStyle(document.querySelector('#primary-link')).webkitTextFillColor,
        inputBackground: getComputedStyle(document.querySelector('#shell-search')).backgroundColor,
        inputColor: getComputedStyle(document.querySelector('#shell-search')).color,
        inputTextFillColor: getComputedStyle(document.querySelector('#shell-search')).webkitTextFillColor,
        inputPlaceholderColor: getComputedStyle(document.querySelector('#shell-search'), '::placeholder').color,
        invalidBorderColor: getComputedStyle(document.querySelector('#shell-invalid')).borderTopColor,
        neutralBackground: getComputedStyle(document.querySelector('#status-neutral')).backgroundColor,
        neutralColor: getComputedStyle(document.querySelector('#status-neutral')).color,
        successBackground: getComputedStyle(document.querySelector('#status-success')).backgroundColor,
        successColor: getComputedStyle(document.querySelector('#status-success')).color,
        warningBackground: getComputedStyle(document.querySelector('#status-warning')).backgroundColor,
        warningColor: getComputedStyle(document.querySelector('#status-warning')).color,
        errorBackground: getComputedStyle(document.querySelector('#status-error')).backgroundColor,
        errorColor: getComputedStyle(document.querySelector('#status-error')).color,
        dataInfoBackground: getComputedStyle(document.querySelector('#data-info')).backgroundColor,
        dataInfoColor: getComputedStyle(document.querySelector('#data-info')).color,
        dataSuccessBackground: getComputedStyle(document.querySelector('#data-success')).backgroundColor,
        dataSuccessColor: getComputedStyle(document.querySelector('#data-success')).color,
        dataWarningBackground: getComputedStyle(document.querySelector('#data-warning')).backgroundColor,
        dataWarningColor: getComputedStyle(document.querySelector('#data-warning')).color,
        dataErrorBackground: getComputedStyle(document.querySelector('#data-error')).backgroundColor,
        dataErrorColor: getComputedStyle(document.querySelector('#data-error')).color,
        gradientTextImage: getComputedStyle(document.querySelector('#gradient-text')).backgroundImage,
        gradientTextFill: getComputedStyle(document.querySelector('#gradient-text')).webkitTextFillColor,
        gradientTextAuraTextGradient: document.querySelector('#gradient-text').getAttribute('data-aura-bg-text-gradient'),
        photoCardImage: getComputedStyle(document.querySelector('#photo-card')).backgroundImage,
        photoCardAuraMedia: document.querySelector('#photo-card').getAttribute('data-aura-bg-media'),
        iconColor: getComputedStyle(document.querySelector('#brand-icon')).color,
        iconFill: getComputedStyle(document.querySelector('#brand-path')).fill,
      }));
      expect(initialStyles.iconColor).toBe('rgb(220, 38, 38)');
      expect(initialStyles.iconFill).toBe('rgb(220, 38, 38)');
      expect(initialStyles.gradientTextImage).toContain('linear-gradient');
      expect(initialStyles.gradientTextFill).toBe('rgba(0, 0, 0, 0)');
      expect(initialStyles.gradientTextAuraTextGradient).toBeNull();
      expect(initialStyles.photoCardImage).toContain('data:image/svg+xml');
      expect(initialStyles.photoCardAuraMedia).toBe('site-owned');

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, focusFallbackUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      let activeState = null;
      for (let i = 0; i < 50; i += 1) {
        activeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        if ([STATES.ACTIVE, STATES.ERROR].includes(activeState?.state)) {
          break;
        }
        await page.waitForTimeout(100);
      }
      const activeStatus = await serviceWorker.evaluate(
        async ({ targetTabId, statusKey }) => {
          const { [statusKey]: statuses = {} } = await chrome.storage.session.get(statusKey);
          return statuses?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, statusKey: STORAGE_KEYS.SMARTSCOPE_STATUS },
      );
      expect(
        activeState?.state,
        JSON.stringify({ activeState, activeStatus }, null, 2),
      ).toBe(STATES.ACTIVE);
      expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
      expect(activeState.smartScope?.variant).toBe('GLOBAL_SAFE_FALLBACK');
      expect(activeState.smartScope?.darkModeEnabled).toBe(true);
      expect(activeState.scopedV2).toBeNull();
      const activeCssEntry = await serviceWorker.evaluate(
        async ({ cssRegistryKey, cssId }) => {
          const { [cssRegistryKey]: registry = {} } = await chrome.storage.session.get(cssRegistryKey);
          return registry?.[cssId] || null;
        },
        { cssRegistryKey: STORAGE_KEYS.CSS_REGISTRY, cssId: activeState.cssId },
      );
      expect(activeCssEntry?.cssText || '').toContain('text-decoration-line');
      expect(activeCssEntry?.cssText || '').toContain('::selection');
      expect(activeCssEntry?.cssText || '').toContain('::file-selector-button');
      expect(activeCssEntry?.cssText || '').toContain(':-webkit-autofill');
      expect(activeCssEntry?.cssText || '').toContain('::-webkit-scrollbar-thumb');
      expect(activeCssEntry?.cssText || '').toContain('::-webkit-search-cancel-button');
      expect(activeCssEntry?.cssText || '').toContain('::-webkit-calendar-picker-indicator');
      expect(activeCssEntry?.cssText || '').toContain(':focus-visible');
      expect(activeCssEntry?.cssText || '').toContain('[data-aura-bg-gradient="1"]');
      await expect(popupPage.locator('#comfort-status')).toHaveText('LIMITED');

      const darkStyles = await page.evaluate(async () => {
        let insertedDynamicDarkFixtures = false;
        if (!document.querySelector('#state-row')) {
          insertedDynamicDarkFixtures = true;
          document.body.insertAdjacentHTML('beforeend', `
            <nav id="state-row" class="state-row" aria-label="Fixture state controls">
              <button id="tab-selected" type="button" role="tab" aria-selected="true">Selected tab</button>
              <a id="nav-current" href="#current" aria-current="page">Current page</a>
              <button id="state-active" type="button" data-state="active">Active state</button>
              <button id="toggle-pressed" type="button" aria-pressed="true">Pressed toggle</button>
              <button id="state-open" type="button" data-state="open">Open panel</button>
              <button id="disabled-control" type="button" disabled>Disabled action</button>
              <a id="disabled-link" href="#disabled" aria-disabled="true">Unavailable link</a>
            </nav>
            <select id="shell-select">
              <optgroup id="shell-optgroup" label="Group">
                <option id="shell-option" value="one">One</option>
              </optgroup>
            </select>
            <progress id="shell-progress" max="100" value="35"></progress>
            <meter id="shell-meter" min="0" max="100" value="65"></meter>
            <input id="shell-file" type="file" />
            <table id="fixture-table">
              <thead>
                <tr><th id="table-head">Name</th></tr>
              </thead>
              <tbody>
                <tr id="table-row"><td id="table-cell">Alpha row</td></tr>
              </tbody>
            </table>
            <div id="aria-grid" role="grid" aria-label="Fixture grid">
              <div role="row">
                <span id="grid-header" role="columnheader">Status</span>
                <span id="grid-cell" role="gridcell">Ready</span>
              </div>
            </div>
            <div id="menu-panel" role="menu">
              <button id="menu-item" type="button" role="menuitem">Menu action</button>
            </div>
            <div id="listbox-panel" role="listbox">
              <div id="list-option" role="option">First option</div>
            </div>
            <div id="dialog-panel" role="dialog" aria-modal="true">Dialog surface</div>
            <details id="details-panel" open>
              <summary id="summary-trigger">Documentation details</summary>
              <p>Compact dynamic documentation panel.</p>
            </details>
            <fieldset id="doc-fieldset">
              <legend id="doc-legend">Field group</legend>
              <label>Compact field <input id="doc-field-input" value="A"></label>
            </fieldset>
            <blockquote id="doc-quote">Quoted documentation block.</blockquote>
            <hr id="doc-rule">
            <p id="doc-inline">
              Marked <mark id="doc-mark">highlight</mark>
              key <kbd id="doc-kbd">Ctrl</kbd>
              sample <samp id="doc-samp">OK</samp>
            </p>
            <nav id="aria-navigation" role="navigation" aria-label="ARIA navigation">Navigation landmark</nav>
            <form id="aria-search" role="search"><label>Search landmark <input value="query"></label></form>
            <section id="pseudo-card" class="product-card">Card body</section>
            <aside id="pseudo-callout" data-callout="true">Callout body</aside>
            <section id="gradient-card" class="promo-card">Gradient card</section>
            <button id="gradient-button" type="button" class="primary-button">Gradient button</button>
            <span id="gradient-status" class="badge gradient-status" role="status">Gradient status</span>
            <section id="plain-gradient-surface">Plain gradient surface</section>
            <section
              id="inline-important-surface"
              style="display:block; min-height:48px; padding:12px; border:1px solid rgb(180,180,190) !important; background-color: rgb(255,255,255) !important; background-image: linear-gradient(rgb(255,255,255), rgb(229,231,235)) !important; color: rgb(24,24,27) !important; -webkit-text-fill-color: rgb(24,24,27) !important;"
            >Inline important app surface with enough text to require dark runtime correction after insertion.</section>
          `);
        }
        if (insertedDynamicDarkFixtures) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const dynamicGradientsSettled = [
              '#gradient-card',
              '#gradient-button',
              '#gradient-status',
              '#plain-gradient-surface',
              '#inline-important-surface',
            ].every((selector) => getComputedStyle(document.querySelector(selector)).backgroundImage === 'none');
            if (dynamicGradientsSettled) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        const link = document.querySelector('#primary-link');
        return {
          pageClarityMarked: Boolean(document.querySelector('[data-aura-page-clarity="1"]')),
          scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
          htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
          htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          bodyColor: getComputedStyle(document.body).color,
          colorScheme: getComputedStyle(document.body).colorScheme,
          linkColor: getComputedStyle(link).color,
          linkTextFillColor: getComputedStyle(link).webkitTextFillColor,
          linkDecoration: getComputedStyle(link).textDecorationLine,
          inputBackground: getComputedStyle(document.querySelector('#shell-search')).backgroundColor,
          inputColor: getComputedStyle(document.querySelector('#shell-search')).color,
          inputTextFillColor: getComputedStyle(document.querySelector('#shell-search')).webkitTextFillColor,
          inputPlaceholderColor: getComputedStyle(document.querySelector('#shell-search'), '::placeholder').color,
          invalidBorderColor: getComputedStyle(document.querySelector('#shell-invalid')).borderTopColor,
          selectBackground: getComputedStyle(document.querySelector('#shell-select')).backgroundColor,
          selectColor: getComputedStyle(document.querySelector('#shell-select')).color,
          selectTextFillColor: getComputedStyle(document.querySelector('#shell-select')).webkitTextFillColor,
          optionBackground: getComputedStyle(document.querySelector('#shell-option')).backgroundColor,
          optionColor: getComputedStyle(document.querySelector('#shell-option')).color,
          progressBackground: getComputedStyle(document.querySelector('#shell-progress')).backgroundColor,
          progressAccentColor: getComputedStyle(document.querySelector('#shell-progress')).accentColor,
          meterBackground: getComputedStyle(document.querySelector('#shell-meter')).backgroundColor,
          fileButtonBackground: getComputedStyle(document.querySelector('#shell-file'), '::file-selector-button').backgroundColor,
          fileButtonColor: getComputedStyle(document.querySelector('#shell-file'), '::file-selector-button').color,
          neutralBackground: getComputedStyle(document.querySelector('#status-neutral')).backgroundColor,
          neutralColor: getComputedStyle(document.querySelector('#status-neutral')).color,
          successBackground: getComputedStyle(document.querySelector('#status-success')).backgroundColor,
          successColor: getComputedStyle(document.querySelector('#status-success')).color,
          warningBackground: getComputedStyle(document.querySelector('#status-warning')).backgroundColor,
          warningColor: getComputedStyle(document.querySelector('#status-warning')).color,
          errorBackground: getComputedStyle(document.querySelector('#status-error')).backgroundColor,
          errorColor: getComputedStyle(document.querySelector('#status-error')).color,
          dataInfoBackground: getComputedStyle(document.querySelector('#data-info')).backgroundColor,
          dataInfoColor: getComputedStyle(document.querySelector('#data-info')).color,
          dataSuccessBackground: getComputedStyle(document.querySelector('#data-success')).backgroundColor,
          dataSuccessColor: getComputedStyle(document.querySelector('#data-success')).color,
          dataWarningBackground: getComputedStyle(document.querySelector('#data-warning')).backgroundColor,
          dataWarningColor: getComputedStyle(document.querySelector('#data-warning')).color,
          dataErrorBackground: getComputedStyle(document.querySelector('#data-error')).backgroundColor,
          dataErrorColor: getComputedStyle(document.querySelector('#data-error')).color,
          selectedTabBackground: getComputedStyle(document.querySelector('#tab-selected')).backgroundColor,
          selectedTabColor: getComputedStyle(document.querySelector('#tab-selected')).color,
          selectedTabBorderColor: getComputedStyle(document.querySelector('#tab-selected')).borderTopColor,
          currentNavBackground: getComputedStyle(document.querySelector('#nav-current')).backgroundColor,
          currentNavColor: getComputedStyle(document.querySelector('#nav-current')).color,
          activeStateBackground: getComputedStyle(document.querySelector('#state-active')).backgroundColor,
          activeStateColor: getComputedStyle(document.querySelector('#state-active')).color,
          pressedToggleBackground: getComputedStyle(document.querySelector('#toggle-pressed')).backgroundColor,
          pressedToggleColor: getComputedStyle(document.querySelector('#toggle-pressed')).color,
          openStateBackground: getComputedStyle(document.querySelector('#state-open')).backgroundColor,
          openStateColor: getComputedStyle(document.querySelector('#state-open')).color,
          disabledControlBackground: getComputedStyle(document.querySelector('#disabled-control')).backgroundColor,
          disabledControlColor: getComputedStyle(document.querySelector('#disabled-control')).color,
          disabledControlBorderColor: getComputedStyle(document.querySelector('#disabled-control')).borderTopColor,
          disabledLinkBackground: getComputedStyle(document.querySelector('#disabled-link')).backgroundColor,
          disabledLinkColor: getComputedStyle(document.querySelector('#disabled-link')).color,
          disabledLinkBorderColor: getComputedStyle(document.querySelector('#disabled-link')).borderTopColor,
          tableHeadBackground: getComputedStyle(document.querySelector('#table-head')).backgroundColor,
          tableHeadColor: getComputedStyle(document.querySelector('#table-head')).color,
          tableCellBackground: getComputedStyle(document.querySelector('#table-cell')).backgroundColor,
          tableCellColor: getComputedStyle(document.querySelector('#table-cell')).color,
          gridHeaderBackground: getComputedStyle(document.querySelector('#grid-header')).backgroundColor,
          gridHeaderColor: getComputedStyle(document.querySelector('#grid-header')).color,
          gridCellBackground: getComputedStyle(document.querySelector('#grid-cell')).backgroundColor,
          gridCellColor: getComputedStyle(document.querySelector('#grid-cell')).color,
          menuPanelBackground: getComputedStyle(document.querySelector('#menu-panel')).backgroundColor,
          menuPanelColor: getComputedStyle(document.querySelector('#menu-panel')).color,
          menuItemBackground: getComputedStyle(document.querySelector('#menu-item')).backgroundColor,
          menuItemColor: getComputedStyle(document.querySelector('#menu-item')).color,
          listboxBackground: getComputedStyle(document.querySelector('#listbox-panel')).backgroundColor,
          listboxColor: getComputedStyle(document.querySelector('#listbox-panel')).color,
          listOptionBackground: getComputedStyle(document.querySelector('#list-option')).backgroundColor,
          listOptionColor: getComputedStyle(document.querySelector('#list-option')).color,
          dialogBackground: getComputedStyle(document.querySelector('#dialog-panel')).backgroundColor,
          dialogColor: getComputedStyle(document.querySelector('#dialog-panel')).color,
          detailsBackground: getComputedStyle(document.querySelector('#details-panel')).backgroundColor,
          detailsColor: getComputedStyle(document.querySelector('#details-panel')).color,
          summaryBackground: getComputedStyle(document.querySelector('#summary-trigger')).backgroundColor,
          summaryColor: getComputedStyle(document.querySelector('#summary-trigger')).color,
          fieldsetBackground: getComputedStyle(document.querySelector('#doc-fieldset')).backgroundColor,
          fieldsetColor: getComputedStyle(document.querySelector('#doc-fieldset')).color,
          legendBackground: getComputedStyle(document.querySelector('#doc-legend')).backgroundColor,
          legendColor: getComputedStyle(document.querySelector('#doc-legend')).color,
          quoteBackground: getComputedStyle(document.querySelector('#doc-quote')).backgroundColor,
          quoteColor: getComputedStyle(document.querySelector('#doc-quote')).color,
          quoteBorderLeftColor: getComputedStyle(document.querySelector('#doc-quote')).borderLeftColor,
          ruleBackground: getComputedStyle(document.querySelector('#doc-rule')).backgroundColor,
          markBackground: getComputedStyle(document.querySelector('#doc-mark')).backgroundColor,
          markColor: getComputedStyle(document.querySelector('#doc-mark')).color,
          kbdBackground: getComputedStyle(document.querySelector('#doc-kbd')).backgroundColor,
          kbdColor: getComputedStyle(document.querySelector('#doc-kbd')).color,
          sampBackground: getComputedStyle(document.querySelector('#doc-samp')).backgroundColor,
          sampColor: getComputedStyle(document.querySelector('#doc-samp')).color,
          ariaNavigationBackground: getComputedStyle(document.querySelector('#aria-navigation')).backgroundColor,
          ariaNavigationColor: getComputedStyle(document.querySelector('#aria-navigation')).color,
          ariaSearchBackground: getComputedStyle(document.querySelector('#aria-search')).backgroundColor,
          ariaSearchColor: getComputedStyle(document.querySelector('#aria-search')).color,
          pseudoCardBeforeBackground: getComputedStyle(document.querySelector('#pseudo-card'), '::before').backgroundColor,
          pseudoCardBeforeColor: getComputedStyle(document.querySelector('#pseudo-card'), '::before').color,
          pseudoCardBeforeBorderColor: getComputedStyle(document.querySelector('#pseudo-card'), '::before').borderTopColor,
          pseudoCalloutAfterBackground: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').backgroundColor,
          pseudoCalloutAfterColor: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').color,
          pseudoCalloutAfterBorderColor: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').borderTopColor,
          gradientCardBackground: getComputedStyle(document.querySelector('#gradient-card')).backgroundColor,
          gradientCardImage: getComputedStyle(document.querySelector('#gradient-card')).backgroundImage,
          gradientButtonBackground: getComputedStyle(document.querySelector('#gradient-button')).backgroundColor,
          gradientButtonImage: getComputedStyle(document.querySelector('#gradient-button')).backgroundImage,
          gradientStatusBackground: getComputedStyle(document.querySelector('#gradient-status')).backgroundColor,
          gradientStatusImage: getComputedStyle(document.querySelector('#gradient-status')).backgroundImage,
          plainGradientBackground: getComputedStyle(document.querySelector('#plain-gradient-surface')).backgroundColor,
          plainGradientImage: getComputedStyle(document.querySelector('#plain-gradient-surface')).backgroundImage,
          gradientTextImage: getComputedStyle(document.querySelector('#gradient-text')).backgroundImage,
          gradientTextFill: getComputedStyle(document.querySelector('#gradient-text')).webkitTextFillColor,
          gradientTextAuraTextGradient: document.querySelector('#gradient-text').getAttribute('data-aura-bg-text-gradient'),
          gradientTextAuraGradient: document.querySelector('#gradient-text').getAttribute('data-aura-bg-gradient'),
          inlineImportantBackground: getComputedStyle(document.querySelector('#inline-important-surface')).backgroundColor,
          inlineImportantImage: getComputedStyle(document.querySelector('#inline-important-surface')).backgroundImage,
          inlineImportantColor: getComputedStyle(document.querySelector('#inline-important-surface')).color,
          inlineImportantTextFillColor: getComputedStyle(document.querySelector('#inline-important-surface')).webkitTextFillColor,
          inlineImportantInlineBackground: document.querySelector('#inline-important-surface').style.getPropertyValue('background-color'),
          inlineImportantInlineBackgroundPriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('background-color'),
          inlineImportantInlineImage: document.querySelector('#inline-important-surface').style.getPropertyValue('background-image'),
          inlineImportantInlineImagePriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('background-image'),
          inlineImportantInlineTextFill: document.querySelector('#inline-important-surface').style.getPropertyValue('-webkit-text-fill-color'),
          inlineImportantInlineTextFillPriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('-webkit-text-fill-color'),
          photoCardImage: getComputedStyle(document.querySelector('#photo-card')).backgroundImage,
          photoCardAuraMedia: document.querySelector('#photo-card').getAttribute('data-aura-bg-media'),
          iconColor: getComputedStyle(document.querySelector('#brand-icon')).color,
          iconFill: getComputedStyle(document.querySelector('#brand-path')).fill,
        };
      });
      expect(darkStyles.pageClarityMarked).toBe(false);
      expect(darkStyles.scoped).toBe(false);
      expect(darkStyles.htmlBackground).not.toBe(initialStyles.htmlBackground);
      expect(darkStyles.htmlColorScheme).toContain('dark');
      expect(darkStyles.bodyBackground).not.toBe(initialStyles.bodyBackground);
      expect(darkStyles.bodyColor).not.toBe(initialStyles.bodyColor);
      expect(darkStyles.linkColor).not.toBe(initialStyles.linkColor);
      expect(darkStyles.linkTextFillColor).toBe('rgb(138, 180, 255)');
      expect(darkStyles.colorScheme).toContain('dark');
      expect(darkStyles.linkDecoration).toContain('underline');
      expect(darkStyles.inputBackground).not.toBe(initialStyles.inputBackground);
      expect(darkStyles.inputColor).not.toBe(initialStyles.inputColor);
      expect(darkStyles.inputTextFillColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.inputPlaceholderColor).not.toBe(initialStyles.inputPlaceholderColor);
      expect(darkStyles.inputPlaceholderColor).toBe('rgb(168, 176, 191)');
      expect(darkStyles.invalidBorderColor).toBe('rgb(239, 68, 68)');
      const darkControlBackgrounds = ['rgb(15, 23, 38)', 'rgb(16, 24, 39)'];
      expect(darkControlBackgrounds).toContain(darkStyles.selectBackground);
      expect(darkStyles.selectColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.selectTextFillColor).toBe('rgb(230, 230, 230)');
      expect(darkControlBackgrounds).toContain(darkStyles.optionBackground);
      expect(darkStyles.optionColor).toBe('rgb(230, 230, 230)');
      expect(darkControlBackgrounds).toContain(darkStyles.progressBackground);
      expect(darkStyles.progressAccentColor).toBe('rgb(154, 183, 255)');
      expect(darkControlBackgrounds).toContain(darkStyles.meterBackground);
      expect(darkControlBackgrounds).toContain(darkStyles.fileButtonBackground);
      expect(darkStyles.fileButtonColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.neutralBackground).toBe('rgb(15, 23, 38)');
      expect(darkStyles.neutralColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.successBackground).toBe('rgb(15, 46, 30)');
      expect(darkStyles.successColor).toBe('rgb(187, 247, 208)');
      expect(darkStyles.warningBackground).toBe('rgb(58, 42, 10)');
      expect(darkStyles.warningColor).toBe('rgb(253, 230, 138)');
      expect(darkStyles.errorBackground).toBe('rgb(58, 17, 21)');
      expect(darkStyles.errorColor).toBe('rgb(254, 202, 202)');
      expect(darkStyles.dataInfoBackground).toBe('rgb(16, 42, 67)');
      expect(darkStyles.dataInfoColor).toBe('rgb(191, 219, 254)');
      expect(darkStyles.dataSuccessBackground).toBe('rgb(15, 46, 30)');
      expect(darkStyles.dataSuccessColor).toBe('rgb(187, 247, 208)');
      expect(darkStyles.dataWarningBackground).toBe('rgb(58, 42, 10)');
      expect(darkStyles.dataWarningColor).toBe('rgb(253, 230, 138)');
      expect(darkStyles.dataErrorBackground).toBe('rgb(58, 17, 21)');
      expect(darkStyles.dataErrorColor).toBe('rgb(254, 202, 202)');
      expect(darkStyles.selectedTabBackground).toBe('rgb(29, 47, 85)');
      expect(darkStyles.selectedTabColor).toBe('rgb(219, 234, 254)');
      expect(darkStyles.selectedTabBorderColor).toBe('rgb(96, 165, 250)');
      expect(darkStyles.currentNavBackground).toBe('rgb(29, 47, 85)');
      expect(darkStyles.currentNavColor).toBe('rgb(219, 234, 254)');
      expect(darkStyles.activeStateBackground).toBe('rgb(29, 47, 85)');
      expect(darkStyles.activeStateColor).toBe('rgb(219, 234, 254)');
      expect(darkStyles.pressedToggleBackground).toBe('rgb(29, 47, 85)');
      expect(darkStyles.pressedToggleColor).toBe('rgb(219, 234, 254)');
      expect(darkStyles.openStateBackground).not.toBe('rgb(29, 47, 85)');
      expect(darkStyles.openStateColor).not.toBe('rgb(219, 234, 254)');
      expect(darkStyles.disabledControlBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.disabledControlColor).toBe('rgb(148, 163, 184)');
      expect(darkStyles.disabledControlBorderColor).toBe('rgb(71, 85, 105)');
      expect(darkStyles.disabledLinkBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.disabledLinkColor).toBe('rgb(148, 163, 184)');
      expect(darkStyles.disabledLinkBorderColor).toBe('rgb(71, 85, 105)');
      expect(darkStyles.tableHeadBackground).toBe('rgb(15, 23, 38)');
      expect(darkStyles.tableHeadColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.tableCellBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.tableCellColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.gridHeaderBackground).toBe('rgb(15, 23, 38)');
      expect(darkStyles.gridHeaderColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.gridCellBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.gridCellColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.menuPanelBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.menuPanelColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.menuItemBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.menuItemColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.listboxBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.listboxColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.listOptionBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.listOptionColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.dialogBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.dialogColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.detailsBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.detailsColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.summaryBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.summaryColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.fieldsetBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.fieldsetColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.legendBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.legendColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.quoteBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.quoteColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.quoteBorderLeftColor).toBe('rgba(255, 255, 255, 0.12)');
      expect(darkStyles.ruleBackground).toBe('rgba(255, 255, 255, 0.12)');
      expect(darkStyles.markBackground).toBe('rgb(58, 42, 10)');
      expect(darkStyles.markColor).toBe('rgb(253, 230, 138)');
      expect(darkStyles.kbdBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.kbdColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.sampBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.sampColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.ariaNavigationBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.ariaNavigationColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.ariaSearchBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.ariaSearchColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.pseudoCardBeforeBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.pseudoCardBeforeColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.pseudoCardBeforeBorderColor).toBe('rgba(255, 255, 255, 0.12)');
      expect(darkStyles.pseudoCalloutAfterBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.pseudoCalloutAfterColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.pseudoCalloutAfterBorderColor).toBe('rgba(255, 255, 255, 0.12)');
      expect(darkStyles.gradientCardBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.gradientCardImage).toBe('none');
      expect(darkControlBackgrounds).toContain(darkStyles.gradientButtonBackground);
      expect(darkStyles.gradientButtonImage).toBe('none');
      expect(darkStyles.gradientStatusBackground).toBe('rgb(15, 23, 38)');
      expect(darkStyles.gradientStatusImage).toBe('none');
      expect(darkStyles.plainGradientBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.plainGradientImage).toBe('none');
      expect(darkStyles.gradientTextImage).toContain('linear-gradient');
      expect(darkStyles.gradientTextFill).toBe('rgba(0, 0, 0, 0)');
      expect(darkStyles.gradientTextAuraTextGradient).toBe('1');
      expect(darkStyles.gradientTextAuraGradient).toBeNull();
      expect(darkStyles.inlineImportantBackground).toBe('rgb(16, 24, 39)');
      expect(darkStyles.inlineImportantImage).toBe('none');
      expect(darkStyles.inlineImportantColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.inlineImportantTextFillColor).toBe('rgb(230, 230, 230)');
      expect(darkStyles.inlineImportantInlineBackground).toMatch(/^var\(--aura-surface-[12]/);
      expect(darkStyles.inlineImportantInlineBackgroundPriority).toBe('important');
      expect(darkStyles.inlineImportantInlineImage).toBe('none');
      expect(darkStyles.inlineImportantInlineImagePriority).toBe('important');
      expect(['rgb(24, 24, 27)', 'var(--aura-text-color, #e6e6e6)']).toContain(
        darkStyles.inlineImportantInlineTextFill,
      );
      expect(darkStyles.inlineImportantInlineTextFillPriority).toBe('important');
      expect(darkStyles.photoCardImage).toContain('data:image/svg+xml');
      expect(darkStyles.photoCardAuraMedia).toBe('1');
      expect(new Set([
        darkStyles.successBackground,
        darkStyles.warningBackground,
        darkStyles.errorBackground,
        darkStyles.dataInfoBackground,
        darkStyles.selectedTabBackground,
        darkStyles.disabledControlBackground,
        darkStyles.markBackground,
        darkStyles.kbdBackground,
      ]).size).toBeGreaterThanOrEqual(6);
      expect(darkStyles.iconColor).toBe(initialStyles.iconColor);
      expect(darkStyles.iconFill).toBe(initialStyles.iconFill);

      await page.locator('#primary-link').focus();
      const focusedLinkStyles = await page.locator('#primary-link').evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          outlineColor: style.outlineColor,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineOffset: style.outlineOffset,
          boxShadow: style.boxShadow,
        };
      });
      expect(focusedLinkStyles.outlineColor).toBe('rgb(154, 183, 255)');
      expect(focusedLinkStyles.outlineStyle).toBe('solid');
      expect(focusedLinkStyles.outlineWidth).toBe('2px');
      expect(focusedLinkStyles.outlineOffset).toBe('2px');
      expect(focusedLinkStyles.boxShadow).toContain('rgba(154, 183, 255');

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(() => ({
        scoped: Boolean(document.querySelector('[data-aura-scope="1"]')),
        pageClarityMarked: Boolean(document.querySelector('[data-aura-page-clarity="1"]')),
        htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
        htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyAuraBackground: document.body.style.getPropertyValue('--aura-bg-color'),
        bodyAuraBackgroundPriority: document.body.style.getPropertyPriority('--aura-bg-color'),
        linkColor: getComputedStyle(document.querySelector('#primary-link')).color,
        linkTextFillColor: getComputedStyle(document.querySelector('#primary-link')).webkitTextFillColor,
        inputBackground: getComputedStyle(document.querySelector('#shell-search')).backgroundColor,
        inputColor: getComputedStyle(document.querySelector('#shell-search')).color,
        inputTextFillColor: getComputedStyle(document.querySelector('#shell-search')).webkitTextFillColor,
        inputPlaceholderColor: getComputedStyle(document.querySelector('#shell-search'), '::placeholder').color,
        invalidBorderColor: getComputedStyle(document.querySelector('#shell-invalid')).borderTopColor,
        selectBackground: getComputedStyle(document.querySelector('#shell-select')).backgroundColor,
        selectColor: getComputedStyle(document.querySelector('#shell-select')).color,
        selectTextFillColor: getComputedStyle(document.querySelector('#shell-select')).webkitTextFillColor,
        optionBackground: getComputedStyle(document.querySelector('#shell-option')).backgroundColor,
        optionColor: getComputedStyle(document.querySelector('#shell-option')).color,
        progressBackground: getComputedStyle(document.querySelector('#shell-progress')).backgroundColor,
        progressAccentColor: getComputedStyle(document.querySelector('#shell-progress')).accentColor,
        meterBackground: getComputedStyle(document.querySelector('#shell-meter')).backgroundColor,
        fileButtonBackground: getComputedStyle(document.querySelector('#shell-file'), '::file-selector-button').backgroundColor,
        fileButtonColor: getComputedStyle(document.querySelector('#shell-file'), '::file-selector-button').color,
        neutralBackground: getComputedStyle(document.querySelector('#status-neutral')).backgroundColor,
        neutralColor: getComputedStyle(document.querySelector('#status-neutral')).color,
        successBackground: getComputedStyle(document.querySelector('#status-success')).backgroundColor,
        successColor: getComputedStyle(document.querySelector('#status-success')).color,
        warningBackground: getComputedStyle(document.querySelector('#status-warning')).backgroundColor,
        warningColor: getComputedStyle(document.querySelector('#status-warning')).color,
        errorBackground: getComputedStyle(document.querySelector('#status-error')).backgroundColor,
        errorColor: getComputedStyle(document.querySelector('#status-error')).color,
        dataInfoBackground: getComputedStyle(document.querySelector('#data-info')).backgroundColor,
        dataInfoColor: getComputedStyle(document.querySelector('#data-info')).color,
        dataSuccessBackground: getComputedStyle(document.querySelector('#data-success')).backgroundColor,
        dataSuccessColor: getComputedStyle(document.querySelector('#data-success')).color,
        dataWarningBackground: getComputedStyle(document.querySelector('#data-warning')).backgroundColor,
        dataWarningColor: getComputedStyle(document.querySelector('#data-warning')).color,
        dataErrorBackground: getComputedStyle(document.querySelector('#data-error')).backgroundColor,
        dataErrorColor: getComputedStyle(document.querySelector('#data-error')).color,
        selectedTabBackground: getComputedStyle(document.querySelector('#tab-selected')).backgroundColor,
        selectedTabColor: getComputedStyle(document.querySelector('#tab-selected')).color,
        selectedTabBorderColor: getComputedStyle(document.querySelector('#tab-selected')).borderTopColor,
        currentNavBackground: getComputedStyle(document.querySelector('#nav-current')).backgroundColor,
        currentNavColor: getComputedStyle(document.querySelector('#nav-current')).color,
        activeStateBackground: getComputedStyle(document.querySelector('#state-active')).backgroundColor,
        activeStateColor: getComputedStyle(document.querySelector('#state-active')).color,
        pressedToggleBackground: getComputedStyle(document.querySelector('#toggle-pressed')).backgroundColor,
        pressedToggleColor: getComputedStyle(document.querySelector('#toggle-pressed')).color,
        openStateBackground: getComputedStyle(document.querySelector('#state-open')).backgroundColor,
        openStateColor: getComputedStyle(document.querySelector('#state-open')).color,
        disabledControlBackground: getComputedStyle(document.querySelector('#disabled-control')).backgroundColor,
        disabledControlColor: getComputedStyle(document.querySelector('#disabled-control')).color,
        disabledControlBorderColor: getComputedStyle(document.querySelector('#disabled-control')).borderTopColor,
        disabledLinkBackground: getComputedStyle(document.querySelector('#disabled-link')).backgroundColor,
        disabledLinkColor: getComputedStyle(document.querySelector('#disabled-link')).color,
        disabledLinkBorderColor: getComputedStyle(document.querySelector('#disabled-link')).borderTopColor,
        tableHeadBackground: getComputedStyle(document.querySelector('#table-head')).backgroundColor,
        tableHeadColor: getComputedStyle(document.querySelector('#table-head')).color,
        tableCellBackground: getComputedStyle(document.querySelector('#table-cell')).backgroundColor,
        tableCellColor: getComputedStyle(document.querySelector('#table-cell')).color,
        gridHeaderBackground: getComputedStyle(document.querySelector('#grid-header')).backgroundColor,
        gridHeaderColor: getComputedStyle(document.querySelector('#grid-header')).color,
        gridCellBackground: getComputedStyle(document.querySelector('#grid-cell')).backgroundColor,
        gridCellColor: getComputedStyle(document.querySelector('#grid-cell')).color,
        menuPanelBackground: getComputedStyle(document.querySelector('#menu-panel')).backgroundColor,
        menuPanelColor: getComputedStyle(document.querySelector('#menu-panel')).color,
        menuItemBackground: getComputedStyle(document.querySelector('#menu-item')).backgroundColor,
        menuItemColor: getComputedStyle(document.querySelector('#menu-item')).color,
        listboxBackground: getComputedStyle(document.querySelector('#listbox-panel')).backgroundColor,
        listboxColor: getComputedStyle(document.querySelector('#listbox-panel')).color,
        listOptionBackground: getComputedStyle(document.querySelector('#list-option')).backgroundColor,
        listOptionColor: getComputedStyle(document.querySelector('#list-option')).color,
        dialogBackground: getComputedStyle(document.querySelector('#dialog-panel')).backgroundColor,
        dialogColor: getComputedStyle(document.querySelector('#dialog-panel')).color,
        detailsBackground: getComputedStyle(document.querySelector('#details-panel')).backgroundColor,
        detailsColor: getComputedStyle(document.querySelector('#details-panel')).color,
        summaryBackground: getComputedStyle(document.querySelector('#summary-trigger')).backgroundColor,
        summaryColor: getComputedStyle(document.querySelector('#summary-trigger')).color,
        fieldsetBackground: getComputedStyle(document.querySelector('#doc-fieldset')).backgroundColor,
        fieldsetColor: getComputedStyle(document.querySelector('#doc-fieldset')).color,
        legendBackground: getComputedStyle(document.querySelector('#doc-legend')).backgroundColor,
        legendColor: getComputedStyle(document.querySelector('#doc-legend')).color,
        quoteBackground: getComputedStyle(document.querySelector('#doc-quote')).backgroundColor,
        quoteColor: getComputedStyle(document.querySelector('#doc-quote')).color,
        quoteBorderLeftColor: getComputedStyle(document.querySelector('#doc-quote')).borderLeftColor,
        ruleBackground: getComputedStyle(document.querySelector('#doc-rule')).backgroundColor,
        markBackground: getComputedStyle(document.querySelector('#doc-mark')).backgroundColor,
        markColor: getComputedStyle(document.querySelector('#doc-mark')).color,
        kbdBackground: getComputedStyle(document.querySelector('#doc-kbd')).backgroundColor,
        kbdColor: getComputedStyle(document.querySelector('#doc-kbd')).color,
        sampBackground: getComputedStyle(document.querySelector('#doc-samp')).backgroundColor,
        sampColor: getComputedStyle(document.querySelector('#doc-samp')).color,
        ariaNavigationBackground: getComputedStyle(document.querySelector('#aria-navigation')).backgroundColor,
        ariaNavigationColor: getComputedStyle(document.querySelector('#aria-navigation')).color,
        ariaSearchBackground: getComputedStyle(document.querySelector('#aria-search')).backgroundColor,
        ariaSearchColor: getComputedStyle(document.querySelector('#aria-search')).color,
        pseudoCardBeforeBackground: getComputedStyle(document.querySelector('#pseudo-card'), '::before').backgroundColor,
        pseudoCardBeforeColor: getComputedStyle(document.querySelector('#pseudo-card'), '::before').color,
        pseudoCardBeforeBorderColor: getComputedStyle(document.querySelector('#pseudo-card'), '::before').borderTopColor,
        pseudoCalloutAfterBackground: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').backgroundColor,
        pseudoCalloutAfterColor: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').color,
        pseudoCalloutAfterBorderColor: getComputedStyle(document.querySelector('#pseudo-callout'), '::after').borderTopColor,
        gradientCardBackground: getComputedStyle(document.querySelector('#gradient-card')).backgroundColor,
        gradientCardImage: getComputedStyle(document.querySelector('#gradient-card')).backgroundImage,
        gradientButtonBackground: getComputedStyle(document.querySelector('#gradient-button')).backgroundColor,
        gradientButtonImage: getComputedStyle(document.querySelector('#gradient-button')).backgroundImage,
        gradientStatusBackground: getComputedStyle(document.querySelector('#gradient-status')).backgroundColor,
        gradientStatusImage: getComputedStyle(document.querySelector('#gradient-status')).backgroundImage,
        plainGradientBackground: getComputedStyle(document.querySelector('#plain-gradient-surface')).backgroundColor,
        plainGradientImage: getComputedStyle(document.querySelector('#plain-gradient-surface')).backgroundImage,
        gradientTextImage: getComputedStyle(document.querySelector('#gradient-text')).backgroundImage,
        gradientTextFill: getComputedStyle(document.querySelector('#gradient-text')).webkitTextFillColor,
        gradientTextAuraTextGradient: document.querySelector('#gradient-text').getAttribute('data-aura-bg-text-gradient'),
        gradientTextAuraGradient: document.querySelector('#gradient-text').getAttribute('data-aura-bg-gradient'),
        inlineImportantBackground: getComputedStyle(document.querySelector('#inline-important-surface')).backgroundColor,
        inlineImportantImage: getComputedStyle(document.querySelector('#inline-important-surface')).backgroundImage,
        inlineImportantColor: getComputedStyle(document.querySelector('#inline-important-surface')).color,
        inlineImportantTextFillColor: getComputedStyle(document.querySelector('#inline-important-surface')).webkitTextFillColor,
        inlineImportantInlineBackground: document.querySelector('#inline-important-surface').style.getPropertyValue('background-color'),
        inlineImportantInlineBackgroundPriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('background-color'),
          inlineImportantInlineImage: document.querySelector('#inline-important-surface').style.getPropertyValue('background-image'),
          inlineImportantInlineImagePriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('background-image'),
          inlineImportantInlineTextFill: document.querySelector('#inline-important-surface').style.getPropertyValue('-webkit-text-fill-color'),
          inlineImportantInlineTextFillPriority: document.querySelector('#inline-important-surface').style.getPropertyPriority('-webkit-text-fill-color'),
          photoCardImage: getComputedStyle(document.querySelector('#photo-card')).backgroundImage,
          photoCardAuraMedia: document.querySelector('#photo-card').getAttribute('data-aura-bg-media'),
          iconColor: getComputedStyle(document.querySelector('#brand-icon')).color,
          iconFill: getComputedStyle(document.querySelector('#brand-path')).fill,
      }))).toEqual({
        scoped: false,
        pageClarityMarked: false,
        htmlBackground: initialStyles.htmlBackground,
        htmlColorScheme: initialStyles.htmlColorScheme,
        bodyBackground: initialStyles.bodyBackground,
        bodyAuraBackground: initialStyles.bodyAuraBackground,
        bodyAuraBackgroundPriority: initialStyles.bodyAuraBackgroundPriority,
        linkColor: initialStyles.linkColor,
        linkTextFillColor: initialStyles.linkTextFillColor,
        inputBackground: initialStyles.inputBackground,
        inputColor: initialStyles.inputColor,
        inputTextFillColor: initialStyles.inputTextFillColor,
        inputPlaceholderColor: initialStyles.inputPlaceholderColor,
        invalidBorderColor: initialStyles.invalidBorderColor,
        selectBackground: 'rgb(255, 255, 255)',
        selectColor: 'rgb(24, 24, 27)',
        selectTextFillColor: 'rgb(24, 24, 27)',
        optionBackground: 'rgb(255, 255, 255)',
        optionColor: 'rgb(24, 24, 27)',
        progressBackground: 'rgb(255, 255, 255)',
        progressAccentColor: 'auto',
        meterBackground: 'rgb(255, 255, 255)',
        fileButtonBackground: 'rgb(255, 255, 255)',
        fileButtonColor: 'rgb(24, 24, 27)',
        neutralBackground: initialStyles.neutralBackground,
        neutralColor: initialStyles.neutralColor,
        successBackground: initialStyles.successBackground,
        successColor: initialStyles.successColor,
        warningBackground: initialStyles.warningBackground,
        warningColor: initialStyles.warningColor,
        errorBackground: initialStyles.errorBackground,
        errorColor: initialStyles.errorColor,
        dataInfoBackground: initialStyles.dataInfoBackground,
        dataInfoColor: initialStyles.dataInfoColor,
        dataSuccessBackground: initialStyles.dataSuccessBackground,
        dataSuccessColor: initialStyles.dataSuccessColor,
        dataWarningBackground: initialStyles.dataWarningBackground,
        dataWarningColor: initialStyles.dataWarningColor,
        dataErrorBackground: initialStyles.dataErrorBackground,
        dataErrorColor: initialStyles.dataErrorColor,
        selectedTabBackground: 'rgb(219, 234, 254)',
        selectedTabColor: 'rgb(30, 64, 175)',
        selectedTabBorderColor: 'rgb(96, 165, 250)',
        currentNavBackground: 'rgb(219, 234, 254)',
        currentNavColor: 'rgb(30, 64, 175)',
        activeStateBackground: 'rgb(219, 234, 254)',
        activeStateColor: 'rgb(30, 64, 175)',
        pressedToggleBackground: 'rgb(219, 234, 254)',
        pressedToggleColor: 'rgb(30, 64, 175)',
        openStateBackground: 'rgb(245, 245, 245)',
        openStateColor: 'rgb(39, 39, 42)',
        disabledControlBackground: 'rgb(229, 231, 235)',
        disabledControlColor: 'rgb(107, 114, 128)',
        disabledControlBorderColor: 'rgb(156, 163, 175)',
        disabledLinkBackground: 'rgb(229, 231, 235)',
        disabledLinkColor: 'rgb(107, 114, 128)',
        disabledLinkBorderColor: 'rgb(156, 163, 175)',
        tableHeadBackground: 'rgb(255, 255, 255)',
        tableHeadColor: 'rgb(24, 24, 27)',
        tableCellBackground: 'rgb(255, 255, 255)',
        tableCellColor: 'rgb(24, 24, 27)',
        gridHeaderBackground: 'rgb(255, 255, 255)',
        gridHeaderColor: 'rgb(24, 24, 27)',
        gridCellBackground: 'rgb(255, 255, 255)',
        gridCellColor: 'rgb(24, 24, 27)',
        menuPanelBackground: 'rgb(255, 255, 255)',
        menuPanelColor: 'rgb(24, 24, 27)',
        menuItemBackground: 'rgb(255, 255, 255)',
        menuItemColor: 'rgb(24, 24, 27)',
        listboxBackground: 'rgb(255, 255, 255)',
        listboxColor: 'rgb(24, 24, 27)',
        listOptionBackground: 'rgb(255, 255, 255)',
        listOptionColor: 'rgb(24, 24, 27)',
        dialogBackground: 'rgb(255, 255, 255)',
        dialogColor: 'rgb(24, 24, 27)',
        detailsBackground: 'rgb(255, 255, 255)',
        detailsColor: 'rgb(24, 24, 27)',
        summaryBackground: 'rgb(255, 255, 255)',
        summaryColor: 'rgb(24, 24, 27)',
        fieldsetBackground: 'rgb(255, 255, 255)',
        fieldsetColor: 'rgb(24, 24, 27)',
        legendBackground: 'rgb(255, 255, 255)',
        legendColor: 'rgb(24, 24, 27)',
        quoteBackground: 'rgb(255, 255, 255)',
        quoteColor: 'rgb(24, 24, 27)',
        quoteBorderLeftColor: 'rgb(180, 180, 190)',
        ruleBackground: 'rgb(180, 180, 190)',
        markBackground: 'rgb(254, 240, 138)',
        markColor: 'rgb(113, 63, 18)',
        kbdBackground: 'rgb(255, 255, 255)',
        kbdColor: 'rgb(24, 24, 27)',
        sampBackground: 'rgb(255, 255, 255)',
        sampColor: 'rgb(24, 24, 27)',
        ariaNavigationBackground: 'rgb(255, 255, 255)',
        ariaNavigationColor: 'rgb(24, 24, 27)',
        ariaSearchBackground: 'rgb(255, 255, 255)',
        ariaSearchColor: 'rgb(24, 24, 27)',
        pseudoCardBeforeBackground: 'rgb(255, 255, 255)',
        pseudoCardBeforeColor: 'rgb(24, 24, 27)',
        pseudoCardBeforeBorderColor: 'rgb(180, 180, 190)',
        pseudoCalloutAfterBackground: 'rgb(255, 255, 255)',
        pseudoCalloutAfterColor: 'rgb(24, 24, 27)',
        pseudoCalloutAfterBorderColor: 'rgb(180, 180, 190)',
        gradientCardBackground: 'rgb(255, 255, 255)',
        gradientCardImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        gradientButtonBackground: 'rgb(255, 255, 255)',
        gradientButtonImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        gradientStatusBackground: 'rgb(255, 255, 255)',
        gradientStatusImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        plainGradientBackground: 'rgb(255, 255, 255)',
        plainGradientImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        gradientTextImage: initialStyles.gradientTextImage,
        gradientTextFill: initialStyles.gradientTextFill,
        gradientTextAuraTextGradient: null,
        gradientTextAuraGradient: null,
        inlineImportantBackground: 'rgb(255, 255, 255)',
        inlineImportantImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        inlineImportantColor: 'rgb(24, 24, 27)',
        inlineImportantTextFillColor: 'rgb(24, 24, 27)',
        inlineImportantInlineBackground: 'rgb(255, 255, 255)',
        inlineImportantInlineBackgroundPriority: 'important',
        inlineImportantInlineImage: 'linear-gradient(rgb(255, 255, 255), rgb(229, 231, 235))',
        inlineImportantInlineImagePriority: 'important',
        inlineImportantInlineTextFill: 'rgb(24, 24, 27)',
        inlineImportantInlineTextFillPriority: 'important',
        photoCardImage: initialStyles.photoCardImage,
        photoCardAuraMedia: 'site-owned',
        iconColor: initialStyles.iconColor,
        iconFill: initialStyles.iconFill,
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark fallback applies and restores same-origin iframes', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await page.route('http://aura.local/**', async (route) => {
        const url = route.request().url();
        if (url === iframeShellUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeShellFixtureHtml(),
          });
        } else if (url === iframeChildUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeChildFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });

      await page.goto(iframeShellUrl);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.frameLocator('#embedded-frame').locator('#frame-text')).toHaveText('Embedded light content');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const frameText = page.frameLocator('#embedded-frame').locator('#frame-text');
      const initialStyles = await page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      }));
      const initialFrameStyles = await frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }));
      expect(initialFrameStyles.bodyBackground).toBe('rgb(255, 255, 255)');

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, iframeShellUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      let activeState = null;
      for (let i = 0; i < 50; i += 1) {
        activeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        if ([STATES.ACTIVE, STATES.ERROR].includes(activeState?.state)) {
          break;
        }
        await page.waitForTimeout(100);
      }
      expect(activeState?.state, JSON.stringify(activeState, null, 2)).toBe(STATES.ACTIVE);
      expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);
      expect(activeState.smartScope?.allFrames).toBe(true);

      const activeCssEntry = await serviceWorker.evaluate(
        async ({ cssRegistryKey, cssId }) => {
          const { [cssRegistryKey]: registry = {} } = await chrome.storage.session.get(cssRegistryKey);
          return registry?.[cssId] || null;
        },
        { cssRegistryKey: STORAGE_KEYS.CSS_REGISTRY, cssId: activeState.cssId },
      );
      expect(activeCssEntry?.origin).toBe('AUTHOR');
      expect(activeCssEntry?.meta?.allFrames).toBe(true);

      await expect.poll(async () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
        initialStyles.bodyBackground,
      );
      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual({
        bodyBackground: 'rgb(11, 16, 32)',
        textColor: 'rgb(230, 230, 230)',
      });

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      }))).toEqual(initialStyles);
      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual(initialFrameStyles);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark fallback applies and restores cross-origin iframes', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await page.route('http://aura.local/**', async (route) => {
        const url = route.request().url();
        if (url === iframeShellUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeShellFixtureHtml(crossOriginIframeChildUrl),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.route('http://third-party.local/**', async (route) => {
        const url = route.request().url();
        if (url === crossOriginIframeChildUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeChildFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });

      await page.goto(iframeShellUrl);
      await page.waitForLoadState('domcontentloaded');
      const frameText = page.frameLocator('#embedded-frame').locator('#frame-text');
      await expect(frameText).toHaveText('Embedded light content');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const initialFrameStyles = await frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }));
      expect(initialFrameStyles.bodyBackground).toBe('rgb(255, 255, 255)');

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, iframeShellUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return {
          state: modeState?.state || null,
          activeQuality: modeState?.activeQuality || null,
          allFrames: modeState?.smartScope?.allFrames === true,
        };
      }).toEqual({
        state: STATES.ACTIVE,
        activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
        allFrames: true,
      });

      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual({
        bodyBackground: 'rgb(11, 16, 32)',
        textColor: 'rgb(230, 230, 230)',
      });

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual(initialFrameStyles);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark fallback adapts already-dark cross-origin iframes per frame', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await page.route('http://aura.local/**', async (route) => {
        const url = route.request().url();
        if (url === iframeShellUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeShellFixtureHtml(crossOriginAlreadyDarkIframeChildUrl),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.route('http://third-party.local/**', async (route) => {
        const url = route.request().url();
        if (url === crossOriginAlreadyDarkIframeChildUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildAlreadyDarkIframeChildFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });

      await page.goto(iframeShellUrl);
      await page.waitForLoadState('domcontentloaded');
      const frameText = page.frameLocator('#embedded-frame').locator('#frame-text');
      await expect(frameText).toContainText('Embedded already dark content');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const initialFrameStyles = await frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
        linkColor: getComputedStyle(node.querySelector('a')).color,
      }));
      expect(initialFrameStyles.bodyBackground).toBe('rgb(9, 12, 20)');

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, iframeShellUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return {
          state: modeState?.state || null,
          activeQuality: modeState?.activeQuality || null,
          allFrames: modeState?.smartScope?.allFrames === true,
          hasPageAndIframeFrames: (modeState?.smartScope?.darkPaletteFrameCount || 0) >= 2,
          hasAlreadyDarkFrame: (modeState?.smartScope?.darkPaletteAlreadyDarkFrameCount || 0) >= 1,
        };
      }).toEqual({
        state: STATES.ACTIVE,
        activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
        allFrames: true,
        hasPageAndIframeFrames: true,
        hasAlreadyDarkFrame: true,
      });

      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
        linkColor: getComputedStyle(node.querySelector('a')).color,
      }))).toEqual({
        bodyBackground: 'rgb(16, 20, 31)',
        textColor: 'rgb(226, 232, 240)',
        linkColor: 'rgb(147, 197, 253)',
      });

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => frameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
        linkColor: getComputedStyle(node.querySelector('a')).color,
      }))).toEqual(initialFrameStyles);
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark fallback reaches iframes added after activation', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await page.route('http://aura.local/**', async (route) => {
        const url = route.request().url();
        if (url === lateIframeShellUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildLateIframeShellFixtureHtml(),
          });
        } else if (url === iframeChildUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildIframeChildFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });

      await page.goto(lateIframeShellUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const initialStyles = await page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      }));

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, lateIframeShellUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      await page.evaluate((src) => {
        const iframe = document.createElement('iframe');
        iframe.id = 'late-frame';
        iframe.src = src;
        document.querySelector('#frame-host').appendChild(iframe);
      }, iframeChildUrl);

      const lateFrameText = page.frameLocator('#late-frame').locator('#frame-text');
      await expect(lateFrameText).toHaveText('Embedded light content');
      await expect.poll(async () => lateFrameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual({
        bodyBackground: 'rgb(11, 16, 32)',
        textColor: 'rgb(230, 230, 230)',
      });

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => page.evaluate(() => ({
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      }))).toEqual(initialStyles);
      await expect.poll(async () => lateFrameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
      }))).toEqual({
        bodyBackground: 'rgb(255, 255, 255)',
        textColor: 'rgb(17, 24, 39)',
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort dark fallback adapts already-dark iframes added after activation', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    let popupPage = null;

    try {
      await page.route('http://aura.local/**', async (route) => {
        const url = route.request().url();
        if (url === lateIframeShellUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildLateIframeShellFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });
      await page.route('http://third-party.local/**', async (route) => {
        const url = route.request().url();
        if (url === crossOriginAlreadyDarkIframeChildUrl) {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: buildAlreadyDarkIframeChildFixtureHtml(),
          });
        } else {
          await route.fulfill({ status: 404, body: '' });
        }
      });

      await page.goto(lateIframeShellUrl);
      await page.waitForLoadState('domcontentloaded');
      await waitForAuraContentReady(page);
      await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });
      await setComfortDarkModePreference(serviceWorker, true);

      const tabId = await getAuraTabId(serviceWorker, page);
      popupPage = await openPopupForRealActions(context, extensionId, tabId, lateIframeShellUrl);
      await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
      await popupPage.locator('#comfort-toggle').click();
      await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.ACTIVE);

      await page.evaluate((src) => {
        const iframe = document.createElement('iframe');
        iframe.id = 'late-dark-frame';
        iframe.src = src;
        document.querySelector('#frame-host').appendChild(iframe);
      }, crossOriginAlreadyDarkIframeChildUrl);

      const lateFrameText = page.frameLocator('#late-dark-frame').locator('#frame-text');
      await expect(lateFrameText).toContainText('Embedded already dark content');

      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return {
          hasRefresh: (modeState?.smartScope?.allFrameRefreshCount || 0) >= 1,
          hasAlreadyDarkFrame: (modeState?.smartScope?.darkPaletteAlreadyDarkFrameCount || 0) >= 1,
          runtimeRefreshOk: modeState?.smartScope?.globalDarkRuntime?.lastRefreshOk === true,
        };
      }).toEqual({
        hasRefresh: true,
        hasAlreadyDarkFrame: true,
        runtimeRefreshOk: true,
      });

      await expect.poll(async () => lateFrameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
        linkColor: getComputedStyle(node.querySelector('a')).color,
      }))).toEqual({
        bodyBackground: 'rgb(16, 20, 31)',
        textColor: 'rgb(226, 232, 240)',
        linkColor: 'rgb(147, 197, 253)',
      });

      await popupPage.locator('#comfort-toggle').click();
      await expect.poll(async () => {
        const modeState = await serviceWorker.evaluate(
          async ({ targetTabId, tabStateKey }) => {
            const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
            return tabState?.[targetTabId]?.['comfort-visual'] || null;
          },
          { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
        );
        return modeState?.state;
      }).toBe(STATES.INACTIVE);

      await expect.poll(async () => lateFrameText.evaluate((node) => ({
        bodyBackground: getComputedStyle(node.ownerDocument.body).backgroundColor,
        textColor: getComputedStyle(node).color,
        linkColor: getComputedStyle(node.querySelector('a')).color,
      }))).toEqual({
        bodyBackground: 'rgb(9, 12, 20)',
        textColor: 'rgb(226, 232, 240)',
        linkColor: 'rgb(147, 197, 253)',
      });
    } finally {
      await popupPage?.close().catch(() => {});
      await page.close().catch(() => {});
      await setComfortDarkModePreference(serviceWorker, false);
      await clearExtensionSession(serviceWorker);
    }
  });

  test('real popup Comfort activation applies PAGE_CLARITY to simple form fixture', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await routeSingleFixture(page, pageClarityFormUrl, pageClarityFormHtml);

    await page.goto(pageClarityFormUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });

    const initialStyles = await page.evaluate(() => {
      const input = document.querySelector('#clarity-form-input');
      const label = input.closest('label');
      return {
        labelDecoration: getComputedStyle(label).textDecorationLine,
        labelBackground: getComputedStyle(label).backgroundColor,
        inputOutline: getComputedStyle(input).outlineStyle,
        inputCaret: getComputedStyle(input).caretColor,
      };
    });
    expect(initialStyles.labelDecoration).toBe('none');
    expect(initialStyles.labelBackground).toBe('rgba(0, 0, 0, 0)');
    expect(initialStyles.inputOutline).toBe('none');

    const tabId = await getAuraTabId(serviceWorker, page);
    const popupPage = await openPopupForRealActions(context, extensionId, tabId, pageClarityFormUrl);
    await waitForRealModeReady(popupPage, MODE_IDS.COMFORT_VISUAL);
    await popupPage.locator('#comfort-toggle').click();
    await waitForPopupUserDecision(popupPage, MODE_IDS.COMFORT_VISUAL, 'ENABLED');

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.ACTIVE);

    const activeState = await serviceWorker.evaluate(
      async ({ targetTabId, tabStateKey }) => {
        const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
        return tabState?.[targetTabId]?.['comfort-visual'] || null;
      },
      { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
    );
    expect(activeState.smartScope?.variant).toBe('PAGE_CLARITY_MEDIUM');
    expect(activeState.activeQuality).toBe(ACTIVE_QUALITIES.PAGE_CLARITY_MEDIUM_VERIFIED);
    expect(activeState.smartScope?.pageClarity?.probe?.reason).toBe('OK');
    expect(activeState.smartScope?.pageClarity?.probe?.visibleEffectScore).toBeGreaterThanOrEqual(0.5);
    await expect(popupPage.locator('#comfort-status')).toHaveText('MEDIUM');

    const appliedStyles = await page.evaluate(() => {
      const target = document.querySelector('[data-aura-page-clarity="1"]');
      const input = document.querySelector('#clarity-form-input');
      const label = input.closest('label');
      return {
        marked: Boolean(target),
        labelDecoration: getComputedStyle(label).textDecorationLine,
        labelBackground: getComputedStyle(label).backgroundColor,
        inputOutline: getComputedStyle(input).outlineStyle,
        inputCaret: getComputedStyle(input).caretColor,
      };
    });
    expect(appliedStyles.marked).toBe(true);
    expect(appliedStyles.labelDecoration).toContain('underline');
    expect(appliedStyles.labelBackground).not.toBe(initialStyles.labelBackground);
    expect(appliedStyles.inputOutline).toBe('solid');
    expect(appliedStyles.inputCaret).not.toBe(initialStyles.inputCaret);

    await popupPage.locator('#comfort-toggle').click();
    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.['comfort-visual'] || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.INACTIVE);

    const restoredStyles = await page.evaluate(() => {
      const target = document.querySelector('[data-aura-page-clarity="1"]');
      const input = document.querySelector('#clarity-form-input');
      const label = input.closest('label');
      return {
        marked: Boolean(target),
        labelDecoration: getComputedStyle(label).textDecorationLine,
        labelBackground: getComputedStyle(label).backgroundColor,
        inputOutline: getComputedStyle(input).outlineStyle,
      };
    });
    expect(restoredStyles.marked).toBe(false);
    expect(restoredStyles.labelDecoration).toBe('none');
    expect(restoredStyles.labelBackground).toBe(initialStyles.labelBackground);
    expect(restoredStyles.inputOutline).toBe('none');

    await popupPage.close();
    await page.close();
  });

  test('real popup Focus activation uses visible limited fallback on unknown shell fixture', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === focusFallbackUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: focusFallbackHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(focusFallbackUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page, { debugTestHooks: true });

    const initialStyles = await page.evaluate(() => {
      const link = document.querySelector('#primary-link');
      const widget = document.querySelector('#primary-widget');
      return {
        linkDecoration: getComputedStyle(link).textDecorationLine,
        widgetBorderColor: getComputedStyle(widget).borderColor,
        widgetOutlineStyle: getComputedStyle(widget).outlineStyle,
      };
    });
    expect(initialStyles.linkDecoration).toBe('none');
    expect(initialStyles.widgetOutlineStyle).toBe('none');

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const popupPage = await openPopupForRealActions(context, extensionId, tabId, focusFallbackUrl);
    await waitForRealModeReady(popupPage, MODE_IDS.FOCUS);
    await popupPage.locator('#focus-toggle').click();
    await waitForPopupUserDecision(popupPage, MODE_IDS.FOCUS, 'ENABLED');

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.focus || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.activeQuality;
    }).toBe(ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED);

    await expect(popupPage.locator('#focus-status')).toHaveText('LIMITED');
    const passiveStyles = await page.evaluate(() => {
      const link = document.querySelector('#primary-link');
      const widget = document.querySelector('#primary-widget');
      return {
        linkDecoration: getComputedStyle(link).textDecorationLine,
        widgetBorderColor: getComputedStyle(widget).borderColor,
        widgetOutlineStyle: getComputedStyle(widget).outlineStyle,
      };
    });
    expect(passiveStyles.linkDecoration).toBe('none');
    expect(passiveStyles.widgetBorderColor).toBe(initialStyles.widgetBorderColor);
    expect(passiveStyles.widgetOutlineStyle).toBe('none');

    await page.locator('#primary-link').focus();
    const focusedLinkStyles = await page.locator('#primary-link').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        decoration: style.textDecorationLine,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusedLinkStyles.decoration).toContain('underline');
    expect(focusedLinkStyles.outlineColor).toBe('rgb(10, 132, 255)');
    expect(focusedLinkStyles.outlineStyle).toBe('solid');
    expect(focusedLinkStyles.outlineWidth).not.toBe('0px');

    await page.locator('#primary-widget').focus();
    const focusedWidgetStyles = await page.locator('#primary-widget').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
      };
    });
    expect(focusedWidgetStyles.outlineColor).toBe('rgb(10, 132, 255)');
    expect(focusedWidgetStyles.outlineStyle).toBe('solid');

    await popupPage.locator('#focus-toggle').click();

    await expect.poll(async () => {
      const modeState = await serviceWorker.evaluate(
        async ({ targetTabId, tabStateKey }) => {
          const { [tabStateKey]: tabState = {} } = await chrome.storage.session.get(tabStateKey);
          return tabState?.[targetTabId]?.focus || null;
        },
        { targetTabId: tabId, tabStateKey: STORAGE_KEYS.TAB_STATE },
      );
      return modeState?.state;
    }).toBe(STATES.INACTIVE);

    await expect(popupPage.locator('#focus-status')).toHaveText('OFF');
    await page.locator('#primary-link').focus();
    const restoredStyles = await page.evaluate(() => {
      const link = document.querySelector('#primary-link');
      const widget = document.querySelector('#primary-widget');
      return {
        linkDecoration: getComputedStyle(link).textDecorationLine,
        linkOutlineStyle: getComputedStyle(link).outlineStyle,
        widgetBorderColor: getComputedStyle(widget).borderColor,
      };
    });
    expect(restoredStyles.linkDecoration).toBe('none');
    expect(restoredStyles.linkOutlineStyle).toBe('none');
    expect(restoredStyles.widgetBorderColor).toBe(initialStyles.widgetBorderColor);

    await popupPage.close();
    await page.close();
  });

  test('switching Comfort Visual to Focus keeps only one ACTIVE', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const popupPage = await openPopupWithMockedModeActions(context, extensionId, tabId, targetUrl);

    await popupPage.locator('#comfort-visual-card h3').click();

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.comfort;
    }).toBe(STATES.ACTIVE);

    const comfortFirstPass = await getModeStates(serviceWorker, tabId);
    expect(comfortFirstPass.focus).not.toBe(STATES.ACTIVE);

    await popupPage.locator('#focus-toggle').click();

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.focus;
    }).toBe(STATES.ACTIVE);

    await expect.poll(async () => {
      const states = await getModeStates(serviceWorker, tabId);
      return states.comfort;
    }).toBe(STATES.INACTIVE);

    await popupPage.close();
    await page.close();
  });

  test('restore-failed mode stays retryable and does not enable on click', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const popupPage = await openPopupForTab(context, extensionId, tabId, targetUrl, {
      restoreAction: ACTIONS.RESTORE_MODE,
      userDecisionAction: ACTIONS.USER_DECISION,
      stateResponses: {
        [MODE_IDS.COMFORT_VISUAL]: {
          state: STATES.ERROR,
          pendingDecision: false,
          cssId: 'css-restore-failed',
          smartScope: {
            scopeKey: 'body',
            variant: 'GLOBAL_SAFE_FALLBACK',
            baseCssId: 'css-restore-failed',
            frameId: 0,
          },
          smartScopeStatus: {
            action: 'restore',
            ok: false,
            error: 'RESTORE_CSS_REMOVE_FAILED',
            reason: 'RESTORE_CSS_REMOVE_FAILED',
            retryable: true,
          },
        },
        [MODE_IDS.FOCUS]: {
          state: STATES.INACTIVE,
          pendingDecision: false,
        },
      },
    });

    await expect(popupPage.locator('#status-chip')).toHaveText('Restore failed');
    await expect(popupPage.locator('#comfort-visual-card')).toHaveClass(/restore-error/);
    await expect(popupPage.locator('#comfort-toggle')).toHaveClass(/active/);
    await expect(popupPage.locator('#comfort-toggle')).toHaveClass(/restore-error/);
    await expect(popupPage.locator('#comfort-toggle')).toHaveAttribute(
      'aria-label',
      'Retry restore for Comfort Visual mode',
    );
    await expect(popupPage.locator('#comfort-status')).toHaveText('RESTORE FAILED');

    await popupPage.locator('#comfort-toggle').click();

    const messages = await popupPage.evaluate(() => window.__auraPopupMessages);
    expect(messages.some((message) => message?.action === ACTIONS.RESTORE_MODE)).toBe(true);
    expect(messages.some((message) => message?.action === ACTIONS.USER_DECISION)).toBe(false);

    await popupPage.close();
    await page.close();
  });

  test('peer restore failure blocks enabling the other mode', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    await seedRestoreFailedMode(serviceWorker, tabId, MODE_IDS.COMFORT_VISUAL);

    const popupPage = await openPopupForTab(context, extensionId, tabId, targetUrl, {
      restoreAction: ACTIONS.RESTORE_MODE,
      userDecisionAction: ACTIONS.USER_DECISION,
      stateResponses: {
        [MODE_IDS.COMFORT_VISUAL]: {
          state: STATES.ERROR,
          pendingDecision: false,
          cssId: 'css-restore-failed',
          smartScope: {
            scopeKey: 'body',
            variant: 'GLOBAL_SAFE_FALLBACK',
            baseCssId: 'css-restore-failed',
            frameId: 0,
          },
          smartScopeStatus: {
            action: 'restore',
            ok: false,
            error: 'RESTORE_CSS_REMOVE_FAILED',
            reason: 'RESTORE_CSS_REMOVE_FAILED',
            retryable: true,
          },
        },
        [MODE_IDS.FOCUS]: {
          state: STATES.INACTIVE,
          pendingDecision: false,
        },
      },
    });

    await expect(popupPage.locator('#comfort-status')).toHaveText('RESTORE FAILED');
    await popupPage.locator('#focus-toggle').click();

    const messages = await popupPage.evaluate(() => window.__auraPopupMessages);
    expect(
      messages.some(
        (message) => message?.action === ACTIONS.RESTORE_MODE && message?.modeId === MODE_IDS.COMFORT_VISUAL,
      ),
    ).toBe(true);
    expect(messages.some((message) => message?.action === ACTIONS.USER_DECISION)).toBe(false);
    await expect(popupPage.locator('#comfort-status')).toHaveText('RESTORE FAILED');
    await expect(popupPage.locator('#focus-status')).toHaveText('OFF');

    await popupPage.close();
    await page.close();
  });

  test('global safe fallback active quality renders as limited', async () => {
    await clearExtensionSession(serviceWorker);
    const page = await context.newPage();
    await page.route('http://aura.local/**', async (route) => {
      if (route.request().url() === targetUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: fixtureHtml,
        });
      } else {
        await route.fulfill({ status: 404, body: '' });
      }
    });

    await page.goto(targetUrl);
    await page.waitForLoadState('domcontentloaded');
    await waitForAuraContentReady(page);
    await waitForAuraReady(serviceWorker, page);

    const tabId = await getAuraTabId(serviceWorker, page);
    expect(typeof tabId).toBe('number');

    const popupPage = await openPopupForTab(context, extensionId, tabId, targetUrl, {
      stateResponses: {
        [MODE_IDS.COMFORT_VISUAL]: {
          state: STATES.ACTIVE,
          pendingDecision: false,
          cssId: 'css-limited-fallback',
          activeQuality: ACTIVE_QUALITIES.GLOBAL_SAFE_FALLBACK_UNVERIFIED,
          smartScope: {
            scopeKey: 'body',
            variant: 'GLOBAL_SAFE_FALLBACK',
            baseCssId: 'css-limited-fallback',
            frameId: 0,
          },
          scopedV2: null,
        },
      },
    });

    await expect(popupPage.locator('#comfort-status')).toHaveText('LIMITED');
    await expect(popupPage.locator('#comfort-status')).toHaveClass(/chip-limited/);
    await expect(popupPage.locator('#comfort-toggle')).toHaveClass(/active/);

    await popupPage.close();
    await page.close();
  });
});
