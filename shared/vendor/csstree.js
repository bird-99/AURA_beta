// Minimal embedded subset of csstree used for AST-based CSS guardrails.
// NOTE: This is not a full implementation of css-tree but provides compatible
// parse/generate/walk primitives for the guardrail pipeline in offline environments.

class List extends Array {
  append(value) {
    this.push(value);
  }

  prepend(value) {
    this.unshift(value);
  }

  isEmpty() {
    return this.length === 0;
  }

  replace(oldNode, newNode) {
    const idx = this.indexOf(oldNode);
    if (idx !== -1) {
      this[idx] = newNode;
    }
  }
}

function stripComments(cssText) {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, '');
}

function skipWhitespace(text, index) {
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index;
}

function consumeUntil(text, index, stopChars, balanceChars = {}) {
  const balances = Object.keys(balanceChars).reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});

  let cursor = index;
  while (cursor < text.length) {
    const char = text[cursor];

    if (balanceChars[char] !== undefined) {
      balances[char] += 1;
    } else if (Object.values(balanceChars).includes(char)) {
      const opener = Object.keys(balanceChars).find((key) => balanceChars[key] === char);
      if (opener) {
        balances[opener] -= 1;
      }
    }

    const balanced = Object.entries(balances).every(([, value]) => value <= 0);
    if (stopChars.includes(char) && balanced) {
      break;
    }

    cursor += 1;
  }

  return cursor;
}

function splitSelectorList(selectorText) {
  const selectors = [];
  let current = '';
  let depth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (char === ',' && depth === 0 && bracketDepth === 0) {
      selectors.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    selectors.push(current.trim());
  }

  return selectors;
}

function parseDeclarations(blockText) {
  const declarations = new List();
  let cursor = 0;
  const text = blockText.trim();

  while (cursor < text.length) {
    cursor = skipWhitespace(text, cursor);
    if (cursor >= text.length) break;

    const propStart = cursor;
    cursor = consumeUntil(text, cursor, [':']);
    const property = text.slice(propStart, cursor).trim();
    cursor += 1; // skip ':'

    const valueStart = cursor;
    let depth = 0;
    let bracketDepth = 0;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);
      if (char === '[') bracketDepth += 1;
      if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      if (char === ';' && depth === 0 && bracketDepth === 0) {
        break;
      }
      cursor += 1;
    }

    const rawValue = text.slice(valueStart, cursor).trim();
    const importantMatch = /!important\s*$/i.exec(rawValue);
    const important = Boolean(importantMatch);
    const value = important ? rawValue.replace(/!important\s*$/i, '').trim() : rawValue;

    declarations.append({
      type: 'Declaration',
      property,
      value,
      important,
    });

    cursor += 1; // skip ';'
  }

  return declarations;
}

function parseRule(ruleText) {
  const separator = ruleText.indexOf('{');
  const selectorPart = ruleText.slice(0, separator).trim();
  const blockPart = ruleText.slice(separator + 1, ruleText.lastIndexOf('}'));
  const selectorList = splitSelectorList(selectorPart).map((value) => ({ type: 'Selector', value }));
  const prelude = { type: 'SelectorList', children: new List(...selectorList) };
  const declarations = parseDeclarations(blockPart);
  const block = { type: 'Block', children: declarations };

  return { type: 'Rule', prelude, block };
}

function parseAtRule(text) {
  const nameEnd = consumeUntil(text, 1, [' ', '\t', '\n', '{', ';']);
  const name = text.slice(1, nameEnd).trim();
  let cursor = nameEnd;
  cursor = skipWhitespace(text, cursor);

  const hasBlock = text.includes('{', cursor);
  let prelude = '';
  let block = null;

  if (!hasBlock) {
    prelude = text.slice(cursor).trim().replace(/;+$/, '');
  } else {
    const preludeEnd = text.indexOf('{', cursor);
    prelude = text.slice(cursor, preludeEnd).trim();
    const blockContent = text.slice(preludeEnd + 1, text.lastIndexOf('}'));
    block = parseStylesheet(blockContent);
  }

  return { type: 'Atrule', name, prelude: prelude ? { type: 'Raw', value: prelude } : null, block };
}

function parseStylesheet(cssText) {
  const stylesheet = { type: 'StyleSheet', children: new List() };
  const text = stripComments(cssText || '');
  let buffer = '';
  let depth = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    buffer += char;

    if (char === '{') depth += 1;
    if (char === '}') depth = Math.max(0, depth - 1);

    if (depth === 0 && char === '}') {
      const chunk = buffer.trim();
      if (chunk.startsWith('@')) {
        stylesheet.children.append(parseAtRule(chunk));
      } else {
        stylesheet.children.append(parseRule(chunk));
      }
      buffer = '';
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    if (remaining.startsWith('@')) {
      stylesheet.children.append(parseAtRule(remaining));
    } else if (remaining.includes('{')) {
      stylesheet.children.append(parseRule(remaining));
    }
  }

  return stylesheet;
}

function parse(cssText) {
  return parseStylesheet(cssText);
}

function generateSelectorList(selectorList) {
  return selectorList.children.map((selector) => selector.value).join(', ');
}

function generate(node) {
  if (!node) return '';

  switch (node.type) {
    case 'StyleSheet':
      return node.children.map((child) => generate(child)).join(' ');
    case 'Rule':
      return `${generateSelectorList(node.prelude)} { ${node.block.children
        .map((decl) => generate(decl))
        .filter(Boolean)
        .join(' ')} }`;
    case 'Declaration':
      return `${node.property}: ${node.value}${node.important ? ' !important' : ''};`;
    case 'Atrule': {
      const prelude = node.prelude?.value ? ` ${node.prelude.value}` : '';
      if (node.block) {
        return `@${node.name}${prelude} { ${generate(node.block)} }`;
      }
      return `@${node.name}${prelude};`;
    }
    case 'Block':
      return node.children.map((child) => generate(child)).join(' ');
    default:
      return '';
  }
}

function walk(node, handler) {
  function traverse(current, parent) {
    handler(current, parent);
    switch (current?.type) {
      case 'StyleSheet':
      case 'Block':
        current.children.forEach((child) => traverse(child, current));
        break;
      case 'Rule':
        traverse(current.prelude, current);
        traverse(current.block, current);
        break;
      case 'Atrule':
        if (current.prelude) traverse(current.prelude, current);
        if (current.block) traverse(current.block, current);
        break;
      case 'SelectorList':
        current.children.forEach((child) => traverse(child, current));
        break;
      default:
        break;
    }
  }

  traverse(node, null);
}

export default { parse, generate, walk, List };
export { parse, generate, walk, List };
