export function parseCssColor(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed);
  }

  if (trimmed.startsWith('rgb')) {
    return parseRgbColor(trimmed);
  }

  return null;
}

function parseHexColor(value) {
  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return { r, g, b, a: 1 };
  }

  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) {
      return null;
    }
    return { r, g, b, a: 1 };
  }

  return null;
}

function parseRgbColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 3) {
    return null;
  }

  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  const a = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;

  if ([r, g, b, a].some((channel) => Number.isNaN(channel))) {
    return null;
  }

  return {
    r: clampChannel(r),
    g: clampChannel(g),
    b: clampChannel(b),
    a: clampAlpha(a),
  };
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value) {
  if (Number.isNaN(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

export function blendColors(foreground, background) {
  if (!foreground || !background) {
    return null;
  }

  const alpha = clampAlpha(foreground.a ?? 1);
  const bgAlpha = clampAlpha(background.a ?? 1);
  if (alpha >= 1 && bgAlpha >= 1) {
    return { r: foreground.r, g: foreground.g, b: foreground.b, a: 1 };
  }

  const outAlpha = alpha + bgAlpha * (1 - alpha);
  if (outAlpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const r = (foreground.r * alpha + background.r * bgAlpha * (1 - alpha)) / outAlpha;
  const g = (foreground.g * alpha + background.g * bgAlpha * (1 - alpha)) / outAlpha;
  const b = (foreground.b * alpha + background.b * bgAlpha * (1 - alpha)) / outAlpha;

  return {
    r: clampChannel(r),
    g: clampChannel(g),
    b: clampChannel(b),
    a: outAlpha,
  };
}

export function relativeLuminance(color) {
  if (!color) {
    return null;
  }

  const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const fg = foreground?.a != null && foreground.a < 1 ? blendColors(foreground, background) : foreground;
  if (!fg || !background) {
    return null;
  }

  const lum1 = relativeLuminance(fg);
  const lum2 = relativeLuminance(background);
  if (lum1 == null || lum2 == null) {
    return null;
  }

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}
