/**
 * The palette is measured, not predicted.
 *
 * DESIGN.md §2.4 lists contrast invariants; this is the gate that fails the
 * build if the shipped palette breaks one. It also checks the colour science
 * itself against known points, because a contrast tool that computes the
 * wrong luminance passes everything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { audit, failures, luminance, contrast, oklchToLinearSrgb, mixOklab } from '../tools/contrast.mjs';
import { paletteCSS, hueTokens } from '../site/palette.mjs';

test('luminance is computed through linear sRGB, not the L³ shortcut', () => {
  assert.ok(Math.abs(luminance([1, 0, 0]).y - 1) < 0.002, 'white');
  assert.ok(luminance([0, 0, 0]).y < 0.002, 'black');
  // sRGB pure red in OKLCH is approximately (0.628, 0.2577, 29.23); its
  // relative luminance is 0.2126 by definition.
  const red = luminance([0.628, 0.2577, 29.23]);
  assert.ok(Math.abs(red.y - 0.2126) < 0.01, `red luminance ${red.y}`);
  // For a chromatic colour L³ is the wrong answer, and the tool must not give it.
  const l3 = 0.6 ** 3;
  assert.ok(Math.abs(luminance([0.6, 0.15, 30]).y - l3) > 0.01, 'a chromatic colour must not reduce to L³');
});

test('gamut clipping is reported rather than silently absorbed', () => {
  assert.equal(oklchToLinearSrgb([0.5, 0.02, 200]).clipped, false);
  assert.equal(oklchToLinearSrgb([0.9, 0.3, 30]).clipped, true);
});

test('contrast is symmetric and 21:1 at the extremes', () => {
  assert.ok(Math.abs(contrast([1, 0, 0], [0, 0, 0]) - 21) < 0.1);
  assert.equal(contrast([0.6, 0.1, 100], [0.3, 0.05, 250]), contrast([0.3, 0.05, 250], [0.6, 0.1, 100]));
});

test('color-mix in oklab is linear in OKLab coordinates', () => {
  const mid = mixOklab([0.8, 0, 0], [0.2, 0, 0], 0.5);
  assert.ok(Math.abs(mid[0] - 0.5) < 1e-9);
});

test('every gated pair in the palette clears its threshold, in both themes', () => {
  const rows = audit();
  assert.ok(rows.length > 300, 'the audit should measure hundreds of pairs');
  const bad = failures(rows);
  assert.deepEqual(
    bad.map((r) => `${r.theme} ${r.group} ${r.name} ${r.ratio.toFixed(2)} < ${r.min}`),
    [],
  );
});

test('the generated stylesheet carries every precinct token for both themes', () => {
  const css = paletteCSS();
  for (const cls of Object.keys(hueTokens('light'))) {
    assert.ok(css.includes(`.${cls} {`), `${cls} class missing`);
    assert.ok(css.includes(`--${cls}:`), `${cls} token missing`);
    assert.ok(css.includes(`--${cls}-text:`), `${cls} text token missing`);
  }
  assert.ok(css.includes(':root[data-theme="dark"]'));
  assert.ok(css.includes(':root:not([data-theme="light"])'));
  assert.ok(!/#[0-9a-f]{6}/i.test(css), 'the palette is authored in OKLCH, not hex');
});
