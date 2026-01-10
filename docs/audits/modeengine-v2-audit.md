# ModeEngine v2 Audit (PR0→PR5)

**Summary:** PASS with fixes. Scoped token application was tightened to reject html/body roots; all other checks aligned with the v3 spec.

## Implementation Map
- Feature flags (PR0): `shared/constants.js`, `shared/feature-flags.js`, `content/content-main.js` (content-local cache and listener).【F:shared/constants.js†L12-L20】【F:content/content-main.js†L100-L201】
- Guardrails wrapper + AST enforcement (PR1): `background/mode-engine-css.js` uses `insertModeCssSafely`; guard logic in `shared/mode-engine-css-guard.js`.【F:background/mode-engine-css.js†L17-L69】【F:shared/mode-engine-css-guard.js†L3-L220】
- SmartScope v2 detector (PR2): `shared/smartscope-v2.js`; routed from `selectScopeRoot` in `content/content-main.js`.【F:shared/smartscope-v2.js†L1-L200】【F:content/content-main.js†L1087-L1145】
- Scoped CSS applier v2 (PR3): `background/css-applier.js` (scoped path + token scripts) with shared helpers in `shared/mode-engine-scoped-v2.js`.【F:background/css-applier.js†L397-L677】【F:shared/mode-engine-scoped-v2.js†L3-L139】
- Focus Overlay v2 (PR4): `shared/focus-overlay-v2.js`; integrated via `maybeRunModeEngineV2` in `content/content-main.js`.【F:shared/focus-overlay-v2.js†L219-L360】【F:content/content-main.js†L2132-L2181】
- SPA hooks v2 (PR5): runtime in `content/spa-hooks-v2.runtime.js`, injected via `background/spa-hooks-injector.js`, and listened to in `content/content-main.js`.【F:content/spa-hooks-v2.runtime.js†L1-L170】【F:background/spa-hooks-injector.js†L1-L71】【F:content/content-main.js†L2183-L2226】

## Findings by PR Stage
### PR0 – Feature Flags
- **Status:** Pass. All six flags default to `false` and hydrate from `chrome.storage.local` with change listeners to refresh the cache and re-run ModeEngine v2. Debug logging/metrics are gated on `debugModeEngine`.【F:shared/constants.js†L12-L20】【F:content/content-main.js†L130-L215】

### PR1 – Guardrails / insertCSS wrapper
- **Status:** Pass. All ModeEngine CSS injections flow through `insertModeCssSafely` with guardrails when the flag is on or forced; direct `chrome.scripting.insertCSS` is not used elsewhere. Guardrails enforce scoping (`:where([data-aura-scope="1"])`), block banned at-rules and unsafe properties, strip `!important`, and reject empty/parse errors, returning `ok=false` to avoid injection. Idempotent scoping is maintained via scope-prefix checks.【F:background/mode-engine-css.js†L17-L69】【F:shared/mode-engine-css-guard.js†L3-L220】

### PR2 – SmartScope v2
- **Status:** Pass. Detector is behind the `smartScopeV2` flag, bounds budget (`DEFAULT_BUDGET_MS`), caps candidates/nodes, and returns `ok:false` on timeout/no scope. Excludes nav/header/footer/aside and ARIA navigation/banner/contentinfo/complementary/dialog elements, ignores hidden/offscreen/overlay candidates, and relies on deterministic scoring/tie-breakers. No global CSS is written; results are used only when the flag is enabled.【F:shared/smartscope-v2.js†L4-L200】【F:content/content-main.js†L1087-L1145】

### PR3 – Scoped CSS applier v2
- **Status:** Pass with fix. Scoped path is gated by `scopedModeCssV2`, aborts when no valid scope, and routes CSS through guardrails. Token application/cleanup scripts ensure idempotence and attribute ownership. **Issue found:** `verifyScopeRoot` allowed `body`/`html`, enabling token writes on document roots when SmartScope fell back. **Fix:** block `body`/`html` in `verifyScopeRoot` and extend unit coverage.

### PR4 – Focus Overlay v2
- **Status:** Pass. Overlay builds four fixed panels with `pointer-events: none`, contained under an overlay root, and suspends when modals/popovers/dialogs are present. No global page styles are modified; all styling is scoped to overlay nodes. Integration is gated by `focusOverlayV2`.

### PR5 – SPA Hooks v2
- **Status:** Pass. Hooks are gated by `smartScopeSpaHooks`, install once via a global symbol, and patch pushState/replaceState/popstate/hashchange with safe teardown. Debounce, maxWait, cooldown, rate limits, and modal retries bound reapply attempts; identity comparisons are conservative and bounded. Content-script-local controller avoids SW timing races.

## Fixes Applied
- Blocked `body`/`html` from being treated as valid SmartScope roots to prevent scoped tokens from ever landing on document roots; added regression coverage for these tags.

## Test Results
- mhh

## Manual Smoke Checklist
- GitHub article page – Scoped CSS applies only within SmartScope root; focus overlay respects modal suppression. *(Not run in CI environment.)*
- Wikipedia article – SmartScope v2 returns main content; guardrails block globals. *(Not run in CI environment.)*
- NYTimes article – Scoped tokens set on article root only; SPA hooks reapply on client navigation. *(Not run in CI environment.)*
- Single-page app (e.g., Gmail) – SPA hooks debounce history/hash changes without thrash. *(Not run in CI environment.)*
- Modal-heavy site – Focus overlay hides when dialogs/popovers are active. *(Not run in CI environment.)*
