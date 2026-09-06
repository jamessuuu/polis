#!/usr/bin/env node
/**
 * Measured contrast for the palette in site/palette.mjs.
 *
 * DESIGN.md §2.4 says every contrast figure in that document is PREDICTED
 * until this exists. This is the real thing: OKLCH -> OKLab -> LMS -> linear
 * sRGB -> WCAG relative luminance -> contrast ratio. No L³ shortcut; the
 * OKLab paper's matrices, with out-of-gamut values clipped and reported.
 *
 * Run it for the table:   node tools/contrast.mjs
 * Gate it in the tests:   tests/contrast.test.mjs imports audit()
 */

import { ENV, hueTokens, hueText, faceOf, PLOT_MIX, DIVISIONS, GUILDS } from '../site/palette.mjs';

// ---- colour science ---------------------------------------------------

export function oklchToOklab([l, c, h]) {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

/** OKLab -> linear sRGB, per Björn Ottosson's published matrices. */
export function oklabToLinearSrgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const clip01 = (v) => Math.min(1, Math.max(0, v));

export function oklchToLinearSrgb(lch) {
  const rgb = oklabToLinearSrgb(oklchToOklab(lch));
  const clipped = rgb.some((v) => v < -0.0005 || v > 1.0005);
  return { rgb: rgb.map(clip01), clipped };
}

/** WCAG relative luminance from LINEAR sRGB — the coefficients apply to linear light. */
export function luminance(lch) {
  const { rgb, clipped } = oklchToLinearSrgb(lch);
  const [r, g, b] = rgb;
  return { y: 0.2126 * r + 0.7152 * g + 0.0722 * b, clipped };
}

export function contrast(a, b) {
  const ya = luminance(a).y;
  const yb = luminance(b).y;
  const [hi, lo] = ya >= yb ? [ya, yb] : [yb, ya];
  return (hi + 0.05) / (lo + 0.05);
}

const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
export function toHex(lch) {
  const { rgb } = oklchToLinearSrgb(lch);
  return '#' + rgb.map((v) => Math.round(gamma(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** color-mix(in oklab, a t, b 1-t) — linear interpolation in OKLab. */
export function mixOklab(a, b, t) {
  const A = oklchToOklab(a);
  const B = oklchToOklab(b);
  const lab = [0, 1, 2].map((i) => A[i] * t + B[i] * (1 - t));
  const c = Math.hypot(lab[1], lab[2]);
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [lab[0], c, h];
}

// ---- the audit --------------------------------------------------------

/**
 * Every pair the map depends on, with the threshold each must clear.
 *
 * gate=true pairs fail the build. gate=false pairs are reported for the
 * design record — either they are decorative by design (the plan numeral
 * at ~1.5:1) or the boundary is carried by another element (the dark-theme
 * rim stroke is the compliant boundary of a left wall, per DESIGN.md §2.4.2).
 */
export function audit() {
  const rows = [];
  for (const theme of ['light', 'dark']) {
    const env = ENV[theme];
    const board = env.board;
    const street = env.street;
    const plate = env.plate;
    const push = (group, name, a, b, min, gate = true) => {
      const ratio = contrast(a, b);
      rows.push({ theme, group, name, a, b, ratio, min, gate, pass: ratio >= min,
        clipped: luminance(a).clipped || luminance(b).clipped });
    };

    const hues = hueTokens(theme);
    for (const [cls, hue] of Object.entries(hues)) {
      const isDivision = cls.length === 6 && cls.startsWith('hue-0');
      const isGuild = cls.startsWith('hue-guild-');
      const plotGround = mixOklab(hue, board, PLOT_MIX[theme]);
      const label = cls.replace('hue-', '');
      const roof = faceOf(hue, 'top');
      const right = faceOf(hue, 'right');
      const left = faceOf(hue, 'left');
      const foot = faceOf(hue, 'foot');
      // Light theme: every face must clear the ground on its own. Dark
      // theme: MEASURED, not predicted — a wall cannot clear 3:1 against
      // both the ground and a lit window without collapsing the tier
      // ladder, so the 1.1u rim silhouette is the compliant boundary of
      // every wall (DESIGN.md §2.4.2) and the roof carries the gate.
      const light = theme === 'light';
      push(label, 'roof vs plot ground', roof, plotGround, 3);
      push(label, 'roof vs street', roof, street, 3);
      push(label, 'right wall vs plot ground', right, plotGround, 3, light);
      push(label, 'right wall vs street', right, street, 3, light);
      push(label, 'left wall vs plot ground', left, plotGround, 3, light);
      push(label, 'footing vs plot ground', foot, plotGround, 3, false);
      push(label, 'lit window vs right wall', env.window, right, 3);
      push(label, 'lit window vs left wall', env.window, left, 3);
      if (isDivision || isGuild) {
        push(label, 'plate number vs plate', hueText(hue, theme), plate, 4.5);
        push(label, 'figure tunic vs plot ground', roof, plotGround, 3);
      }
      if (theme === 'dark') {
        push(label, 'rim vs plot ground', env.rim, plotGround, 3);
        push(label, 'rim vs left wall', env.rim, left, 3, false);
      }
    }

    // Environment and UI pairs.
    push('env', 'plate ink vs plate', env.ink, plate, 4.5);
    push('env', 'plate muted vs plate', env['ink-muted'], plate, 4.5);
    push('env', 'wall face vs board outer', env['wall-face'], env['board-outer'], 3);
    push('env', 'wall face vs street', env['wall-face'], street, 3);
    push('env', 'lit road vs street', env['road-lit'], street, 3);
    push('env', 'lit road vs board outer', env['road-lit'], env['board-outer'], 3);
    // The plinth is environment (craft). Gated in light where it can clear;
    // reported in dark, where an edge lighter than the night sky would read
    // as a glowing rim rather than a board's thickness.
    push('env', 'plinth right vs sky bottom', env['plinth-right'], env['sky-bottom'], 3, theme === 'light');
    push('env', 'plinth left vs sky bottom', env['plinth-left'], env['sky-bottom'], 3, theme === 'light');
    push('env', 'street vs board (the free streets)', street, board, 1.15);
    push('env', 'plan numeral vs board (decorative, ~1.5 by design)', env.numeral, board, 1.3, false);
    push('env', 'warn (ruin dashes) vs board', env.warn, board, 3);
    push('env', 'lamp vs plot ground (Cabinet)', env.lamp, mixOklab(hues['hue-00'], board, PLOT_MIX[theme]), 3, false);
    push('env', 'page ink vs page bg', env.ink, env.bg, 4.5);
    push('env', 'page muted vs page bg', env['ink-muted'], env.bg, 4.5);
    push('env', 'page ink vs elevated', env.ink, env['bg-elevated'], 4.5);
    push('env', 'accent vs page bg', env.accent, env.bg, 4.5);
    push('env', 'warn vs warn-bg', env.warn, env['warn-bg'], 4.5);
    push('env', 'focus ring vs page bg', env.focus, env.bg, 3);
    push('env', 'border strong vs page bg', env['border-strong'], env.bg, 3);
    // Surfaces the game layer added. The panel chip that says "never called"
    // and the pressed Dark Half button are both state carried in text, so
    // they are held to the text ratio, not the non-text one.
    push('env', 'chip state (never called) vs chip', env.warn, env.bg, 4.5);
    push('env', 'chip state vs chip hover', env.warn, env['bg-elevated'], 4.5);
    push('env', 'pressed mode button label vs accent', env['bg-elevated'], env.accent, 4.5);
    push('env', 'chip link on hover vs chip hover', env.accent, env['bg-elevated'], 4.5);
  }
  return rows;
}

export function failures(rows = audit()) {
  return rows.filter((r) => r.gate && !r.pass);
}

/** A compact markdown table for DESIGN.md — the measured replacement for "predicted". */
export function summaryTable() {
  const rows = audit();
  const pick = (theme, group, name) => rows.find((r) => r.theme === theme && r.group === group && r.name === name);
  const fmt = (r) => (r ? r.ratio.toFixed(2) : '—');
  const lines = [
    '| Precinct | Roof / plot ground L · D | Roof / street L · D | Right wall / street L · D | Window / left wall L · D | Rim / plot ground D |',
    '|---|---|---|---|---|---|',
  ];
  const groups = [...Object.keys(DIVISIONS), ...Object.keys(GUILDS).map((g) => `guild-${g}`), 'skill'];
  for (const g of groups) {
    const nm = g in DIVISIONS ? `${g} ${DIVISIONS[g].name}` : g;
    lines.push(`| ${nm} | ${fmt(pick('light', g, 'roof vs plot ground'))} · ${fmt(pick('dark', g, 'roof vs plot ground'))} | ${fmt(pick('light', g, 'roof vs street'))} · ${fmt(pick('dark', g, 'roof vs street'))} | ${fmt(pick('light', g, 'right wall vs street'))} · ${fmt(pick('dark', g, 'right wall vs street'))} | ${fmt(pick('light', g, 'lit window vs left wall'))} · ${fmt(pick('dark', g, 'lit window vs left wall'))} | ${fmt(pick('dark', g, 'rim vs plot ground'))} |`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^.*\/tools\//, 'tools/'));
if (isMain || process.argv.includes('--print')) {
  const rows = audit();
  let out = '';
  for (const r of rows) {
    const mark = r.pass ? 'ok ' : (r.gate ? 'FAIL' : 'low ');
    out += `${mark} ${r.theme.padEnd(5)} ${r.group.padEnd(16)} ${r.name.padEnd(46)} ${r.ratio.toFixed(2).padStart(6)} (min ${r.min})${r.clipped ? ' [gamut-clipped]' : ''}  ${toHex(r.a)} on ${toHex(r.b)}\n`;
  }
  const bad = failures(rows);
  out += `\n${rows.length} pairs measured, ${bad.length} gated failures.\n`;
  if (process.argv.includes('--table')) out += '\n' + summaryTable() + '\n';
  process.stdout.write(out);
  process.exitCode = bad.length ? 1 : 0;
}
