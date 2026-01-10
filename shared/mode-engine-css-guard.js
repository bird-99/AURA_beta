import csstree from './vendor/csstree.js';

const DEFAULT_SCOPE = ':where([data-aura-scope="1"])';
const BANNED_AT_RULES = new Set(['keyframes', 'font-face', 'property', 'page', 'namespace']);
const ALLOWED_PROPERTIES = new Set([
  // Typo
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'font-variant',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-color',
  'text-decoration-thickness',
  'text-underline-offset',
  'text-decoration-skip-ink',
  'text-rendering',
  '-webkit-font-smoothing',
  'box-sizing',
  'max-inline-size',
  'overflow-wrap',
  'word-break',
  'hyphens',
  'color-scheme',
  // Couleurs
  'color',
  'background-color',
  'caret-color',
  'accent-color',
  // Spacing
  'margin-top',
  'margin-bottom',
  'padding-top',
  'padding-bottom',
  'margin-block-start',
  'margin-block-end',
  'padding-block-start',
  'padding-block-end',
  // Borders / outline couleur limitée
  'border-color',
  'border-top-color',
  'border-bottom-color',
  'outline-color',
]);

const SPACING_PROPERTIES = new Set([
  'margin-top',
  'margin-bottom',
  'padding-top',
  'padding-bottom',
  'margin-block-start',
  'margin-block-end',
  'padding-block-start',
  'padding-block-end',
]);

const BANNED_PROPERTY_PREFIXES = [
  'animation',
  'transition',
  'flex',
  'grid',
  'overflow',
  'clip',
  'transform',
  'filter',
  'backdrop-filter',
];

const BANNED_PROPERTIES = new Set([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'clear',
  'z-index',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'inline-size',
  'block-size',
  'gap',
  'order',
  'visibility',
  'opacity',
  'pointer-events',
  'contain',
  'content-visibility',
  'scroll-behavior',
  'background',
  'border',
  'outline',
]);

/**
 * @typedef {{ code: string; message: string; details?: unknown }} GuardReason
 * @typedef {{
 *   rulesTotal: number;
 *   selectorsTotal: number;
 *   selectorsRewritten: number;
 *   atRulesBlocked: number;
 *   declarationsTotal: number;
 *   declarationsBlocked: number;
 *   importantBlocked: number;
 *   rulesDropped: number;
 *   elapsedMs: number;
 * }} GuardStats
 * @typedef {{ ok: boolean; cssText: string; reasons: GuardReason[]; stats: GuardStats }} GuardCssResult
 */

function now() {
  return globalThis?.performance?.now ? performance.now() : Date.now();
}

function isScopedSelector(selectorText = '', scopeSelector = DEFAULT_SCOPE) {
  const normalized = selectorText.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith(scopeSelector)) {
    return true;
  }

  const scopeMatch = /^:where\((.+)\)$/.exec(scopeSelector);
  const rawScope = scopeMatch ? scopeMatch[1].trim() : '';
  return Boolean(rawScope && normalized.startsWith(rawScope));
}

function guardCss({ cssText, scopeSelector = DEFAULT_SCOPE } = {}) {
  const start = now();
  const reasons = [];
  const stats = {
    rulesTotal: 0,
    selectorsTotal: 0,
    selectorsRewritten: 0,
    atRulesBlocked: 0,
    declarationsTotal: 0,
    declarationsBlocked: 0,
    importantBlocked: 0,
    rulesDropped: 0,
    elapsedMs: 0,
  };

  if (!cssText || !`${cssText}`.trim()) {
    stats.elapsedMs = now() - start;
    reasons.push({ code: 'EMPTY_INPUT', message: 'Empty CSS input' });
    return { ok: false, cssText: '', reasons, stats };
  }

  try {
    const ast = csstree.parse(cssText, { context: 'stylesheet' });

    if (!ast?.children || ast.children.length === 0) {
      stats.elapsedMs = now() - start;
      reasons.push({ code: 'PARSE_ERROR', message: 'No parsable CSS rules found' });
      return { ok: false, cssText: '', reasons, stats };
    }

    const isPropertyExplicitlyBanned = (property) => {
      if (ALLOWED_PROPERTIES.has(property)) {
        return false;
      }

      if (BANNED_PROPERTIES.has(property)) {
        return true;
      }

      return BANNED_PROPERTY_PREFIXES.some((prefix) => property.startsWith(prefix));
    };

    const isAuraVar = (value) => {
      const match = /^var\(\s*(--aura-[\w-]+)\s*\)$/i.exec(value);
      return Boolean(match);
    };

    const isAllowedSpacingValue = (value) => {
      if (!value && value !== 0) return false;
      const normalized = `${value}`.trim();
      if (!normalized) return false;

      if (/calc\s*\(|clamp\s*\(|min\s*\(|max\s*\(/i.test(normalized)) {
        return false;
      }

      if (/^-/.test(normalized)) {
        return false;
      }

      if (normalized === '0') {
        return true;
      }

      if (isAuraVar(normalized)) {
        return true;
      }

      const pxMatch = /^([0-9]*\.?[0-9]+)px$/i.exec(normalized);
      if (pxMatch) {
        const numeric = parseFloat(pxMatch[1]);
        return numeric >= 0 && numeric <= 24;
      }

      return false;
    };

    const processRule = (ruleNode) => {
      stats.rulesTotal += 1;

      if (!ruleNode?.prelude?.children) {
        return;
      }

      const newSelectors = new csstree.List();

      ruleNode.prelude.children.forEach((selectorNode) => {
        const selectorText = (selectorNode?.value || '').trim();
        if (!selectorText) {
          return;
        }

        stats.selectorsTotal += 1;
        let rewrittenSelector = selectorText;

        if (!isScopedSelector(selectorText, scopeSelector)) {
          rewrittenSelector = `${scopeSelector} ${selectorText}`.trim();
          stats.selectorsRewritten += 1;
        }

        if (!isScopedSelector(rewrittenSelector, scopeSelector)) {
          reasons.push({ code: 'UNSCOPED_SELECTOR', message: 'Selector not scoped', details: rewrittenSelector });
          throw new Error('UNSCOPED_SELECTOR');
        }

        newSelectors.append({ type: 'Selector', value: rewrittenSelector });
      });

      ruleNode.prelude.children = newSelectors;

      const filteredDeclarations = new csstree.List();

      if (ruleNode?.block?.children) {
        ruleNode.block.children.forEach((decl) => {
          stats.declarationsTotal += 1;

          const property = `${decl?.property || ''}`.trim();
          const normalizedProperty = property.toLowerCase();
          const value = `${decl?.value ?? ''}`.trim();

          if (!property || !value) {
            stats.declarationsBlocked += 1;
            reasons.push({ code: 'BLOCKED_PROPERTY', message: 'Missing property or value', details: property || value });
            return;
          }

          if (isPropertyExplicitlyBanned(normalizedProperty)) {
            stats.declarationsBlocked += 1;
            reasons.push({ code: 'BLOCKED_PROPERTY', message: `Blocked property ${normalizedProperty}` });
            return;
          }

          if (!ALLOWED_PROPERTIES.has(normalizedProperty)) {
            stats.declarationsBlocked += 1;
            reasons.push({ code: 'BLOCKED_PROPERTY', message: `Property not allowlisted: ${normalizedProperty}` });
            return;
          }

          if (SPACING_PROPERTIES.has(normalizedProperty) && !isAllowedSpacingValue(value)) {
            stats.declarationsBlocked += 1;
            reasons.push({ code: 'BLOCKED_VALUE', message: `Blocked spacing value for ${normalizedProperty}`, details: value });
            return;
          }

          const nextDecl = {
            ...decl,
            property: normalizedProperty,
            value,
          };

          if (decl?.important) {
            stats.importantBlocked += 1;
            reasons.push({ code: 'IMPORTANT_STRIPPED', message: `Removed !important from ${normalizedProperty}` });
            nextDecl.important = false;
          }

          filteredDeclarations.append(nextDecl);
        });

        ruleNode.block.children = filteredDeclarations;
      }
    };

    const walkBlock = (block) => {
      if (!block?.children) return true;

      const nextChildren = new csstree.List();
      for (const child of block.children) {
        if (child.type === 'Rule') {
          processRule(child);
          if (child?.block?.children?.length) {
            nextChildren.append(child);
          } else {
            stats.rulesDropped += 1;
          }
        } else if (child.type === 'Atrule') {
          const name = `${child.name || ''}`.toLowerCase();
          if (BANNED_AT_RULES.has(name)) {
            stats.atRulesBlocked += 1;
            reasons.push({ code: 'AT_RULE_BLOCKED', message: `Blocked at-rule ${name}` });
            return false;
          }

          if (child.block && !walkBlock(child.block)) {
            return false;
          }

          if (!child.block || (child.block?.children && child.block.children.length > 0)) {
            nextChildren.append(child);
          } else {
            stats.rulesDropped += 1;
          }
        } else {
          reasons.push({ code: 'UNSUPPORTED_NODE', message: `Unsupported node type ${child.type}` });
          return false;
        }
      }

      block.children = nextChildren;
      return true;
    };

    const valid = walkBlock(ast);
    stats.elapsedMs = now() - start;

    if (!valid) {
      return { ok: false, cssText: '', reasons, stats };
    }

    if (!ast.children.length) {
      reasons.push({ code: 'EMPTY_AFTER_GUARD', message: 'No CSS after guard filters' });
      return { ok: false, cssText: '', reasons, stats };
    }

    const output = csstree.generate(ast).trim();
    if (!output) {
      reasons.push({ code: 'EMPTY_AFTER_GUARD', message: 'No CSS after guard filters' });
      return { ok: false, cssText: '', reasons, stats };
    }

    return { ok: true, cssText: output, reasons, stats };
  } catch (error) {
    stats.elapsedMs = now() - start;
    const code = reasons[0]?.code || 'PARSE_ERROR';
    const message = error?.message || 'PARSE_ERROR';
    return { ok: false, cssText: '', reasons: [...reasons, { code, message }], stats };
  }
}

export { guardCss, DEFAULT_SCOPE };
export default guardCss;
