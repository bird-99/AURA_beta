# ModeEngine Feature Flags (defaults)

ModeEngine defaults run **ON** for production-critical flags and are read from `chrome.storage.local` under the `featureFlags` key (see `shared/constants.js`).

| Flag | Default | Purpose |
| --- | --- | --- |
| `modeEngineCssGuardrails` | `true` | Enable AST-based CSS guardrails for scoped styles. |
| `smartScopeV2` | `true` | Enable SmartScope v2 detection and orchestration. |
| `scopedModeCssV2` | `true` | Enable scoped CSS application for ModeEngine v2. |
| `focusOverlayV2` | `false` | Enable the updated focus overlay pipeline. |
| `focusReduceMotionV1` | `true` | Reduce animations/transitions when Focus is active. |
| `smartScopeSpaHooks` | `true` | Enable SPA reapply hooks for SmartScope v2. |
| `siteSuppressV1` | `false` | Allow site-level suppressions for known bad scopes. |
| `ultraFocusV1` | `false` | Extra Focus filtering for experimental UI blocking. |
| `contrastGuardV1` | `false` | Protect against low-contrast overrides in modes. |
| `targetBoostV1` | `false` | Improve target sizing in scoped regions. |
| `comfortDarkModeV1` | `false` | Experimental Comfort Visual dark adjustments (scoped). |
| `smoothThemeTransitionsV2` | `false` | Enable smooth visual transitions for Comfort Visual theme changes. |
| `debugModeEngine` | `false` | Enable ModeEngine debug logs and metrics hooks. |
| `debugTestHooks` | `false` | Enable test-only hooks for development/testing. |

## Override structure
- Storage key: `chrome.storage.local['featureFlags']`
- Value: object mapping flag names → boolean
- Unknown keys or non-boolean values are ignored; missing values fall back to defaults.

## Quick snippets (DevTools console)
- Enable one flag:
  ```js
  chrome.storage.local.set({ featureFlags: { smartScopeV2: true } });
  ```
- Enable all ModeEngine v2 flags (including debug):
  ```js
  chrome.storage.local.set({
    featureFlags: {
      modeEngineCssGuardrails: true,
      smartScopeV2: true,
      scopedModeCssV2: true,
      focusOverlayV2: true,
      smartScopeSpaHooks: true,
      debugModeEngine: true,
      debugTestHooks: true,
    },
  });
  ```
- Disable/reset all overrides (back to defaults):
  ```js
  chrome.storage.local.set({ featureFlags: {} });
  // or remove the key entirely
  // chrome.storage.local.remove('featureFlags');
  ```

## Rollback rule
If something misbehaves, set the affected flag(s) to `false` (or clear `featureFlags`); defaults remain safe.
