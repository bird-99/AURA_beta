import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blendColors, contrastRatio, parseCssColor } from '../../shared/contrast-utils.js';

test('parseCssColor handles hex and rgb colors', () => {
  assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseCssColor('#112233'), { r: 17, g: 34, b: 51, a: 1 });
  assert.deepEqual(parseCssColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
});

test('contrastRatio returns AA contrast for black on white', () => {
  const black = parseCssColor('#000000');
  const white = parseCssColor('#ffffff');
  const ratio = contrastRatio(black, white);
  assert.ok(ratio && Math.abs(ratio - 21) < 0.2);
});

test('blendColors handles alpha compositing', () => {
  const blended = blendColors(
    { r: 0, g: 0, b: 0, a: 0.5 },
    { r: 255, g: 255, b: 255, a: 1 },
  );
  assert.deepEqual(blended, { r: 128, g: 128, b: 128, a: 1 });
});
