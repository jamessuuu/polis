/**
 * The palette, as data.
 *
 * DESIGN.md §2 authors every colour in OKLCH and derives every face, text
 * colour and swatch from one token per precinct. That only stays true if the
 * numbers live in ONE place: this module. `bin/build-site.mjs` turns it into
 * `site/palette.css`, and `tools/contrast.mjs` reads the same object to
 * measure real contrast — so the audited palette and the shipped palette are
 * the same bytes, not two hand-copied lists that drift.
 *
 * Pure: no DOM, no CSS parsing, importable from tests.
 */

/** OKLCH triple -> CSS string. */
export const oklch = (l, c, h) => `oklch(${trim(l)} ${trim(c)} ${trim(h)})`;
const trim = (n) => String(Math.round(n * 1000) / 1000);

/**
 * §2.2 — Okabe-Ito hues retained, chroma per theme, and a three-tier
 * lightness ladder so hue-confusable neighbours are separated by value.
 *
 * Tier L values differ from the first draft of DESIGN.md: those were
 * predictions, these are what the measured audit needs to hold ≥ 3:1 against
 * plot ground AND street in both themes (see tools/contrast.mjs).
 */
export const TIER_L = {
  light: { 1: 0.535, 2: 0.47, 3: 0.39 },
  dark: { 1: 0.70, 2: 0.655, 3: 0.61 },
};

export const DIVISIONS = {
  '00': { name: 'Cabinet', h: 75, c: { light: 0.018, dark: 0.022 }, tier: 3 },
  '01': { name: 'Intelligence', h: 248, c: { light: 0.115, dark: 0.105 }, tier: 2 },
  '02': { name: 'Product', h: 44, c: { light: 0.130, dark: 0.150 }, tier: 2 },
  '03': { name: 'Engineering', h: 166, c: { light: 0.105, dark: 0.100 }, tier: 1 },
  '04': { name: 'Design & Story', h: 352, c: { light: 0.105, dark: 0.115 }, tier: 3 },
  '05': { name: 'Growth & Revenue', h: 71, c: { light: 0.105, dark: 0.125 }, tier: 3 },
  '06': { name: 'Trust & Operations', h: 236, c: { light: 0.085, dark: 0.070 }, tier: 1 },
  '07': { name: 'Knowledge & Craft', h: 104, c: { light: 0.110, dark: 0.140 }, tier: 1 },
};

/**
 * Guilds: a second, deliberately low-chroma family. Unpainted brick beside
 * painted districts — low chroma IS the class signal.
 */
export const GUILDS = { agentic: 290, automation: 200, backend: 145, design: 352, game: 30, growth: 90 };
export const GUILD_C = 0.045;
export const GUILD_L = { light: 0.55, dark: 0.64 };

/** Neutral families for the Archive's unowned skills, system utilities, and the unfiled. */
export const NEUTRAL = {
  skill: { h: 70, c: 0.012, l: { light: 0.555, dark: 0.66 } },
  system: { h: 250, c: 0.02, l: { light: 0.50, dark: 0.70 } },
  none: { h: 70, c: 0.012, l: { light: 0.52, dark: 0.68 } },
};

/** §3 — one key light, expressed as lightness/chroma steps off the roof. */
export const FACE_STEPS = {
  top: { dl: 0, cx: 1.0 },
  gableLit: { dl: +0.020, cx: 1.0 },
  gableShade: { dl: -0.055, cx: 0.98 },
  right: { dl: -0.085, cx: 0.96 },
  left: { dl: -0.170, cx: 0.88 },
  foot: { dl: -0.265, cx: 0.78 },
};

/** Text derived from a precinct hue, for the number on its plate. */
export const HUE_TEXT = { light: { l: 0.40, cMax: 0.12 }, dark: { l: 0.84, cMax: 0.12 } };

/** How much precinct hue goes into the plot ground. */
export const PLOT_MIX = { light: 0.10, dark: 0.12 };

/**
 * §2.3 — environment. Craft, not data: the canvas the city stands on.
 * Every value is [l, c, h]; alpha where relevant is a separate token.
 */
export const ENV = {
  light: {
    'sky-top': [0.975, 0.012, 75],
    'sky-bottom': [0.93, 0.02, 60],
    board: [0.94, 0.022, 72],
    'board-outer': [0.905, 0.02, 70],
    street: [0.855, 0.015, 70],
    'wall-face': [0.55, 0.03, 70],
    'wall-cap': [0.80, 0.02, 70],
    'plinth-right': [0.56, 0.035, 70],
    'plinth-left': [0.46, 0.035, 70],
    'board-edge': [0.60, 0.03, 70],
    'shadow-ink': [0.42, 0.045, 265],
    'ao-ink': [0.38, 0.05, 265],
    rim: [0.25, 0.02, 265],
    plate: [0.985, 0.004, 85],
    ink: [0.22, 0.015, 260],
    'ink-muted': [0.47, 0.02, 260],
    numeral: [0.79, 0.025, 70],
    'figure-head': [0.80, 0.045, 65],
    window: [0.93, 0.09, 85],
    'window-off': [0.36, 0.03, 260],
    road: [0.45, 0.03, 265],
    'road-lit': [0.56, 0.17, 45],
    lamp: [0.62, 0.17, 60],
    warn: [0.52, 0.18, 35],
    'warn-bg': [0.95, 0.03, 40],
    focus: [0.40, 0.16, 262],
    accent: [0.45, 0.10, 200],
    bg: [0.975, 0.006, 80],
    'bg-elevated': [0.995, 0.003, 85],
    'border-subtle': [0.86, 0.012, 75],
    'border-strong': [0.55, 0.02, 260],
  },
  dark: {
    'sky-top': [0.19, 0.02, 260],
    'sky-bottom': [0.24, 0.02, 250],
    board: [0.28, 0.015, 250],
    'board-outer': [0.25, 0.012, 250],
    street: [0.33, 0.010, 250],
    'wall-face': [0.60, 0.015, 250],
    'wall-cap': [0.72, 0.012, 250],
    'plinth-right': [0.40, 0.015, 250],
    'plinth-left': [0.30, 0.015, 250],
    'board-edge': [0.50, 0.012, 250],
    'shadow-ink': [0.08, 0.02, 265],
    'ao-ink': [0.06, 0.02, 265],
    rim: [0.76, 0.01, 250],
    plate: [0.185, 0.012, 250],
    ink: [0.93, 0.01, 250],
    'ink-muted': [0.75, 0.015, 250],
    numeral: [0.42, 0.02, 250],
    'figure-head': [0.84, 0.045, 65],
    window: [0.96, 0.075, 90],
    'window-off': [0.24, 0.02, 250],
    road: [0.62, 0.02, 250],
    'road-lit': [0.86, 0.14, 85],
    lamp: [0.88, 0.13, 85],
    warn: [0.78, 0.16, 40],
    'warn-bg': [0.28, 0.04, 40],
    focus: [0.88, 0.14, 90],
    accent: [0.80, 0.10, 200],
    bg: [0.17, 0.015, 255],
    'bg-elevated': [0.21, 0.015, 255],
    'border-subtle': [0.30, 0.012, 255],
    'border-strong': [0.55, 0.015, 255],
  },
};

export const ALPHA = {
  // rim: the silhouette edge at rest. Off in light (revealed on hover),
  // always on in dark — the compliant boundary of every wall (§2.4.2).
  light: { shadow: 0.13, plate: 0.94, hazeGround: 0.40, hazeObject: 0.10, rim: 0, rimWidth: 0.9 },
  dark: { shadow: 0.28, plate: 0.94, hazeGround: 0.40, hazeObject: 0.10, rim: 0.8, rimWidth: 1.1 },
};

/** Every precinct hue token as [l, c, h] for a theme, keyed by CSS class name. */
export function hueTokens(theme) {
  const out = {};
  for (const [num, d] of Object.entries(DIVISIONS)) {
    out[`hue-${num}`] = [TIER_L[theme][d.tier], d.c[theme], d.h];
  }
  for (const [g, h] of Object.entries(GUILDS)) {
    out[`hue-guild-${g}`] = [GUILD_L[theme], GUILD_C, h];
  }
  for (const [k, n] of Object.entries(NEUTRAL)) {
    out[`hue-${k}`] = [n.l[theme], n.c, n.h];
  }
  return out;
}

export function hueText([l, c, h], theme) {
  const t = HUE_TEXT[theme];
  return [t.l, Math.min(c, t.cMax), h];
}

export function faceOf([l, c, h], step) {
  const s = FACE_STEPS[step];
  return [Math.max(0, l + s.dl), c * s.cx, h];
}

function tokenBlock(theme, indent) {
  const lines = [];
  for (const [k, v] of Object.entries(ENV[theme])) lines.push(`${indent}--${k}: ${oklch(...v)};`);
  lines.push(`${indent}--shadow-alpha: ${ALPHA[theme].shadow};`);
  lines.push(`${indent}--plate-alpha: ${ALPHA[theme].plate};`);
  lines.push(`${indent}--haze-ground-alpha: ${ALPHA[theme].hazeGround};`);
  lines.push(`${indent}--haze-object-alpha: ${ALPHA[theme].hazeObject};`);
  lines.push(`${indent}--rim-alpha: ${ALPHA[theme].rim};`);
  lines.push(`${indent}--rim-width: ${ALPHA[theme].rimWidth};`);
  lines.push(`${indent}--plot-mix: ${Math.round(PLOT_MIX[theme] * 100)}%;`);
  for (const [cls, v] of Object.entries(hueTokens(theme))) {
    lines.push(`${indent}--${cls}: ${oklch(...v)};`);
    lines.push(`${indent}--${cls}-text: ${oklch(...hueText(v, theme))};`);
  }
  return lines.join('\n');
}

/**
 * The generated stylesheet. Light tokens on bare :root, dark redefined under
 * the system preference (guarded so an explicit light choice wins) and again
 * under the explicit dark choice, so the toggle wins in both directions.
 */
export function paletteCSS() {
  const classes = [];
  for (const cls of Object.keys(hueTokens('light'))) {
    classes.push(`.${cls} { --hue: var(--${cls}); --hue-text: var(--${cls}-text); }`);
  }
  return [
    '/* GENERATED by bin/build-site.mjs from site/palette.mjs — do not edit by hand. */',
    ':root {',
    tokenBlock('light', '  '),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    tokenBlock('dark', '    '),
    '  }',
    '}',
    ':root[data-theme="dark"] {',
    tokenBlock('dark', '  '),
    '}',
    ...classes,
    '',
  ].join('\n');
}
