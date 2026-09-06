/**
 * Drawing the city.
 *
 * Everything here renders the plan `layout.mjs` computed and the life
 * `life.mjs` decided; nothing here decides where anything goes or who is
 * busy. That split is deliberate — the plan and the life are pure and
 * tested, the view is DOM and is not, so as little judgement as possible
 * lives on this side of the line.
 *
 * Why isometric at all: the previous map was a node-link diagram, and a
 * node-link diagram is a chart. You read a chart; you do not look around it.
 * The projection, the extruded solids and the fixed light direction exist to
 * make the ecosystem something you explore rather than parse, because the
 * point of this whole project is that a society of 59 agents is easier to
 * hold in your head as a place than as an adjacency list.
 *
 * The line between data and craft, stated once (DESIGN.md §1): ENTITIES are
 * data — every building, citizen, banner, ruin and road is one record.
 * ENVIRONMENT is craft — sky, board, light, shadow and haze are the canvas
 * and are allowed to be beautiful. Nothing on the entity side is invented.
 *
 * Budget: no <filter>, no CSS filter, group opacity only on the two haze
 * planes, and only opacity and transform ever animate. Element count is
 * measured by tests/budget.test.mjs against the real snapshot.
 */

import {
  boxFaces, gableFaces, silhouettePath, storeyLinesPath, windowsPath, doorPoint,
  plotPolygon, tileGridPath, toScreen, depthOf, screenBounds,
  shadowPolygon, footingBands, contactPatch, wallGeometry, plinthFaces, TILE_W,
} from './iso.mjs';
import {
  activityOf, capabilityOf, roofOf, storeysOf, footprintOf, insigniaOf,
  buildRoutingGrid, gatesOf, createRouter, walkBetween, screenPath,
} from './life.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

let doc = null;
function s(tag, attrs = {}, text) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, String(v));
  }
  if (text != null) n.textContent = text;
  return n;
}

const guildKey = (g) => String(g).replace(/-guild$/, '');

export function hueClassFor(item) {
  if (item.kind === 'skill') return item.guild ? `hue-guild-${guildKey(item.guild)}` : 'hue-skill';
  if (item.number) return `hue-${item.number}`;
  if (item.guild) return `hue-guild-${guildKey(item.guild)}`;
  if (item.system) return 'hue-system';
  return 'hue-none';
}

export function plotHueClass(plot) {
  if (plot.kind === 'district') return `hue-${plot.number}`;
  if (plot.kind === 'guild') return `hue-guild-${guildKey(plot.key.replace('__guild__', ''))}`;
  if (plot.kind === 'archive') return 'hue-skill';
  if (plot.key === '__system__') return 'hue-system';
  return 'hue-none';
}

export { footprintOf };

// ------------------------------------------------------------ the kit ---

/**
 * Held instruments, by primary capability (CHARACTERS.md §2.4). Local
 * origin is the right hand; the arm group positions it.
 */
const INSTRUMENT = {
  M: 'M 0 0 L 0.9 -0.5 L 4.4 -4.2 L 3.4 -5 Z',
  R: 'M -0.4 -0.4 L 3.2 -4 L 4 -3.2 L 0.4 0.4 Z M 2.1 -3.6 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0 Z M 3 -3.6 a 0.6 0.6 0 1 0 1.2 0 a 0.6 0.6 0 1 0 -1.2 0 Z',
  S: 'M -0.3 -0.3 L 2.3 -2.9 L 2.9 -2.3 L 0.3 0.3 Z M 1.8 -3.4 a 1.6 1.6 0 1 0 3.2 0 a 1.6 1.6 0 1 0 -3.2 0 Z M 2.5 -3.4 a 0.9 0.9 0 1 0 1.8 0 a 0.9 0.9 0 1 0 -1.8 0 Z',
  none: 'M 0 0 L 3.04 -0.99 L 1.74 -4.98 L -1.3 -3.99 Z',
};

/** Insignia glyphs on the chest at (0, -13.2), 2.6u — heraldry, not costume. */
const INSIGNIA_PATH = {
  bar: 'M -1.3 -13.7 h 2.6 v 1 h -2.6 Z',
  circle: 'M -1.3 -13.2 a 1.3 1.3 0 1 0 2.6 0 a 1.3 1.3 0 1 0 -2.6 0 Z',
  triangle: 'M 0 -14.5 L 1.3 -11.9 L -1.3 -11.9 Z',
  chevron: 'M -1.3 -12.1 L 0 -14.5 L 1.3 -12.1 L 0.6 -12.1 L 0 -13.3 L -0.6 -12.1 Z',
  diamond: 'M 0 -14.5 L 1.3 -13.2 L 0 -11.9 L -1.3 -13.2 Z',
  'double-bar': 'M -1.3 -14.2 h 2.6 v 0.8 h -2.6 Z M -1.3 -12.8 h 2.6 v 0.8 h -2.6 Z',
  cross: 'M -0.45 -14.5 h 0.9 v 0.85 h 0.85 v 0.9 h -0.85 v 0.85 h -0.9 v -0.85 h -0.85 v -0.9 h 0.85 Z',
  square: 'M -1.3 -14.5 h 2.6 v 2.6 h -2.6 Z M -0.7 -13.9 h 1.4 v 1.4 h -1.4 Z',
};

function ringPath(cx, cy, r, ri) {
  return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z` +
    (ri ? ` M ${cx - ri} ${cy} a ${ri} ${ri} 0 1 0 ${2 * ri} 0 a ${ri} ${ri} 0 1 0 ${-2 * ri} 0 Z` : '');
}

function insigniaPath(ins) {
  if (ins.kind === 'ring') {
    const a = (ins.notch * Math.PI) / 180;
    const cx = 0; const cy = -13.2;
    const p = (r, da) => `${(cx + r * Math.cos(a + da)).toFixed(2)} ${(cy + r * Math.sin(a + da)).toFixed(2)}`;
    // A ring plus a tick at the notch angle — the guild's stable mark.
    return ringPath(cx, cy, 1.3, 0.7) + ` M ${p(0.9, -0.28)} L ${p(1.9, -0.28)} L ${p(1.9, 0.28)} L ${p(0.9, 0.28)} Z`;
  }
  return INSIGNIA_PATH[ins.kind] || '';
}

function beltMark(kind, x, y) {
  if (kind === 'M') return `M ${x - 0.65} ${y + 0.55} L ${x + 0.55} ${y - 0.65} L ${x + 0.75} ${y - 0.45} L ${x - 0.45} ${y + 0.75} Z`;
  if (kind === 'R') return ringPath(x, y, 0.6, 0);
  return ringPath(x, y, 0.6, 0.3);
}

function chipPath(model) {
  const x = -4.4; const y = -15.6;
  if (model === 'opus') return ringPath(x, y, 0.9, 0);
  if (model === 'sonnet') return `M ${x - 0.9} ${y} a 0.9 0.9 0 1 0 1.8 0 Z ` + ringPath(x, y, 0.9, 0.6);
  if (model === 'haiku') return ringPath(x, y, 0.9, 0.55);
  return null; // undeclared: absence drawn as absence
}

const BODY = 'M -2.8 0 L -1 0 L -1 -7 L 1 -7 L 1 0 L 2.8 0 L 2.8 -7.2 L 3.9 -7.4 Q 4.2 -15.8 2.4 -16.4 L -2.4 -16.4 Q -4.2 -15.8 -3.9 -7.4 L -2.8 -7.2 Z';
const MANTLE = 'M -4.3 -15.6 Q 0 -13.4 4.3 -15.6 L 3.6 -9.4 Q 0 -7.6 -3.6 -9.4 Z';

/**
 * A citizen, 22u tall, composed from real attributes only (CHARACTERS.md):
 * tunic = precinct, insignia = division/guild, instrument = tool axis,
 * mantle = director, chip = declared model (absence drawn as absence),
 * lamp and pose = telemetry. No face — a face would assert a personality
 * the data does not contain.
 */
export function figure({ item, hueClass, activity, delayMs = 0, walker = false }) {
  const cap = capabilityOf(item.tools);
  const cls = ['figure', hueClass, `act-${activity}`];
  if (item.director) cls.push('is-director');
  if (walker) cls.push('walker');
  const g = s('g', { class: cls.join(' ') });
  if (!walker) g.style.setProperty('--bob-delay', `${delayMs}ms`);

  // The road pulse: a ripple of light under a walker's feet, so the street
  // being walked is visibly the one lit.
  if (walker) g.appendChild(s('ellipse', { class: 'fig-pulse', cx: 0, cy: 0.6, rx: 9, ry: 4.5 }));
  g.appendChild(s('ellipse', { class: 'fig-shadow', cx: 0, cy: 0.6, rx: 5.2, ry: 2.2 }));
  const body = s('g', { class: 'fig-body' });
  if (item.director) body.appendChild(s('path', { class: 'fig-mantle', d: MANTLE }));
  body.appendChild(s('path', { class: 'fig-torso', d: BODY }));
  body.appendChild(s('circle', { class: 'fig-head', cx: 0, cy: -19.2, r: 2.9 }));
  if (!walker) {
    const ins = insigniaOf(item);
    if (ins.kind !== 'none') body.appendChild(s('path', { class: 'fig-insignia', d: insigniaPath(ins), 'fill-rule': 'evenodd' }));
  }
  const arm = s('g', { class: 'fig-arm' });
  arm.appendChild(s('path', { class: 'fig-tool', d: INSTRUMENT[cap.primary || 'none'], 'fill-rule': 'evenodd' }));
  body.appendChild(arm);

  if (!walker) {
    // Detail that only earns its nodes above zoom 1.5x. Rendered once,
    // toggled with CSS, never re-rendered on a zoom tick.
    const detail = s('g', { class: 'fig-detail' });
    let any = false;
    const marks = cap.secondary.map((k, i) => beltMark(k, -3.2, -8.6 + i * 1.7)).join(' ');
    if (marks) { detail.appendChild(s('path', { class: 'fig-belt', d: marks, 'fill-rule': 'evenodd' })); any = true; }
    const chip = chipPath(item.model);
    if (chip) { detail.appendChild(s('path', { class: 'fig-chip', d: chip, 'fill-rule': 'evenodd' })); any = true; }
    if (activity === 'active' || activity === 'recent') {
      detail.appendChild(s('circle', { class: 'fig-lamp', cx: 3.4, cy: -7.8, r: 1.4 }));
      any = true;
    }
    if (any) body.appendChild(detail);
  }
  g.appendChild(body);
  return g;
}

/** Explore is not a person: a floating ring construct, no head, no legs. */
function construct(hueClass) {
  const g = s('g', { class: `figure is-construct ${hueClass}` });
  g.appendChild(s('ellipse', { class: 'fig-shadow', cx: 0, cy: 0.6, rx: 5.2, ry: 2.2 }));
  const body = s('g', { class: 'fig-body' });
  body.appendChild(s('path', { class: 'fig-ring', d: ringPath(0, -13, 6, 3.6) + ' ' + ringPath(0, -13, 1.6, 0), 'fill-rule': 'evenodd' }));
  g.appendChild(body);
  return g;
}

// ------------------------------------------------------------- labels ---

const NUM_PX = 27;
const TITLE_PX = 27;
const SUB_PX = 19;
const PLATE_PAD = 12;
const PLATE_H = 66;

/*
 * One placement pass for every label on the map.
 *
 * There used to be two systems: precinct plates lifted themselves vertically
 * until they cleared each other, and name plates sat at a fixed offset above
 * a roof with no idea anything else existed. Two labels at the same depth can
 * never be separated by lifting alone — both keep landing at the same height —
 * so a director's name printed across a district title and the whole map read
 * as broken. The fix is one pass, in priority order, with a horizontal member
 * in the search: district > director > citizen, and only a citizen may be
 * dropped from a frame (the roster below still names everyone).
 *
 * Widths are ESTIMATED from character counts rather than measured: measuring
 * would be three forced reflows per label on every hover.
 */
const PAD_X = 8;
const PAD_Y = 6;
const LIFT_STEP = 28;
const LIFT_TRIES = 26;

/** Boxes are centre-based so a 66u plate and a 32u plate compare honestly. */
function boxesHit(a, b) {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + PAD_X
    && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + PAD_Y;
}

/** Natural spot first, then each lift step tried centred and to either side. */
function* offsetsFor(w) {
  yield [0, 0];
  for (let i = 1; i <= LIFT_TRIES; i++) {
    const dy = -i * LIFT_STEP;
    yield [0, dy];
    yield [-0.4 * w, dy];
    yield [0.4 * w, dy];
  }
}

/** Returns false when nothing in the offset budget was free. */
function placeCandidate(c, placed) {
  for (const [dx, dy] of offsetsFor(c.w)) {
    const box = { cx: c.cx0 + dx, cy: c.cy0 + dy, w: c.w, h: c.h };
    if (!placed.some((q) => boxesHit(box, q))) {
      c.box = box;
      c.displaced = dx !== 0 || dy !== 0;
      placed.push(box);
      return true;
    }
  }
  // A district or a director is never hidden. LAYOUT-SPEC §5.4's numeral-chip
  // fallback is the escalation if this ever fires at real density; with 78
  // candidate positions per label and 22 labels it cannot today, so the honest
  // behaviour is "lifted clear of its anchor and drawn", not "gone".
  const dy = -LIFT_TRIES * LIFT_STEP;
  c.box = { cx: c.cx0, cy: c.cy0 + dy, w: c.w, h: c.h };
  c.displaced = true;
  placed.push(c.box);
  return false;
}

/** T1: the precinct plates. Placed first, so nothing below them can move them. */
function placePlates(city, placed) {
  const wanted = [...city.plots.values()]
    .map((plot) => {
      const north = toScreen(plot.col, plot.row);
      const num = plot.kind === 'district' ? `${plot.number} · ` : '';
      const title = plot.kind === 'district' ? plot.label.replace(/^\d\d · /, '') : plot.label;
      const sub = plot.sub || `${plot.count} ${plot.count === 1 ? 'member' : 'members'}`;
      const line1 = num.length * NUM_PX * 0.62 + title.length * TITLE_PX * 0.55;
      const w = Math.max(line1, sub.length * SUB_PX * 0.62) + PLATE_PAD * 2;
      return {
        key: plot.key, cls: plotHueClass(plot), num, title, sub,
        cx0: north.x, cy0: north.y - 10 - PLATE_H / 2,
        anchorX: north.x, anchorY: north.y - 2,
        w, h: PLATE_H, depth: depthOf(plot.col, plot.row),
      };
    })
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));

  for (const p of wanted) {
    placeCandidate(p, placed);
    p.x = p.box.cx;
    p.y = p.box.cy - p.h / 2;
  }
  return wanted;
}

function precinctPlate(p) {
  const g = s('g', { class: `precinct-plate ${p.cls} kind-${p.key.startsWith('__') ? 'outside' : 'district'}`, transform: `translate(${r2(p.x)} ${r2(p.y)})` });
  g.appendChild(s('rect', { class: 'plate-bg', x: r2(-p.w / 2), y: 0, width: r2(p.w), height: p.h, rx: 3 }));
  const t1 = s('text', { class: 'plate-line1', x: 0, y: 31, 'text-anchor': 'middle' });
  if (p.num) t1.appendChild(s('tspan', { class: 'plate-num' }, p.num));
  t1.appendChild(s('tspan', { class: 'plate-title' }, p.title));
  g.appendChild(t1);
  g.appendChild(s('text', { class: 'plate-sub', x: 0, y: 54, 'text-anchor': 'middle' }, p.sub));
  return g;
}

const NAME_PX = 20;
const NAME_H = 32;
export const NAME_POOL = 24;

function namePlate() {
  const outer = s('g', { class: 'name-plate' });
  // The leader is mounted with the slot, never created on hover, and drawn
  // first so it passes behind its own plate. It is the same primitive the
  // precinct plates already use, extended to the other two tiers.
  const leader = s('line', { class: 'plate-leader', x1: 0, y1: 0, x2: 0, y2: 0 });
  outer.appendChild(leader);
  const inner = s('g', { class: 'name-plate-in' });
  inner.appendChild(s('rect', { class: 'plate-bg', x: 0, y: 0, width: 10, height: NAME_H, rx: 3 }));
  inner.appendChild(s('text', { class: 'plate-name', x: 0, y: 21, 'text-anchor': 'middle' }, ''));
  outer.appendChild(inner);
  return { outer, inner, leader, rect: inner.firstChild, text: inner.lastChild, id: null };
}

const nameWidth = (id) => id.length * NAME_PX * 0.62 + 18;

const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------- render ---

export function renderCity({ svg, data, city, workforce = null, onSelect }) {
  doc = svg.ownerDocument || globalThis.document;
  svg.textContent = '';

  const agentsById = new Map(data.agents.map((a) => [a.id, a]));
  const wfById = new Map(((workforce && workforce.agents) || []).map((a) => [a.id, a]));
  const generatedAt = workforce ? workforce.generatedAt : null;

  const b = screenBounds(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow);
  const PAD = 64;
  const PLINTH = 14;

  // ---- defs ------------------------------------------------------------
  const defs = s('defs');
  const sky = s('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 });
  sky.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--sky-top)' }));
  sky.appendChild(s('stop', { offset: 1, 'stop-color': 'var(--sky-bottom)' }));
  defs.appendChild(sky);
  // One radial gradient, referenced by every contact patch. Defining it per
  // building would be one gradient per building for one visual effect.
  const ao = s('radialGradient', { id: 'ao-patch' });
  ao.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.30 }));
  ao.appendChild(s('stop', { offset: 0.55, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.16 }));
  ao.appendChild(s('stop', { offset: 1, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0 }));
  defs.appendChild(ao);
  // Aerial perspective: two planes, stop-opacity on the gradient so no group
  // opacity is needed anywhere but here.
  for (const [id, alpha] of [['haze-ground', 'var(--haze-ground-alpha)'], ['haze-object', 'var(--haze-object-alpha)']]) {
    const g = s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--sky-bottom)', 'stop-opacity': alpha }));
    g.appendChild(s('stop', { offset: 0.62, 'stop-color': 'var(--sky-bottom)', 'stop-opacity': 0 }));
    defs.appendChild(g);
  }
  svg.appendChild(defs);

  // ---- sky (environment, outside the camera) -----------------------------
  const skyRect = s('rect', { class: 'sky', fill: 'url(#sky)' });
  svg.appendChild(skyRect);

  // The camera. Pan and zoom move this one node, and nothing else ever does.
  // There was a wrapper here that faded the whole scene in over 900ms on
  // load; it was an intro animation a visitor had to wait through before the
  // page could say anything, so it is gone. The city paints at full opacity
  // in one frame.
  const camera = s('g', { class: 'camera' });
  svg.appendChild(camera);

  // ---- the board ---------------------------------------------------------
  const plinth = plinthFaces(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow, PLINTH);
  const boardLayer = s('g', { class: 'board-layer' });
  boardLayer.appendChild(s('polygon', { class: 'plinth-left', points: plinth.left }));
  boardLayer.appendChild(s('polygon', { class: 'plinth-right', points: plinth.right }));
  boardLayer.appendChild(s('polygon', { class: 'board-outer', points: plinth.top }));
  const w = city.wall;
  boardLayer.appendChild(s('polygon', { class: 'board-inner', points: plotPolygon(w.col, w.row, w.cols, w.rows) }));
  camera.appendChild(boardLayer);

  // ---- precinct ground ---------------------------------------------------
  const plotLayer = s('g', { class: 'plot-layer' });
  for (const plot of city.plots.values()) {
    const cls = plotHueClass(plot);
    plotLayer.appendChild(s('polygon', {
      class: `plot-ground ${cls} kind-${plot.kind}`,
      points: plotPolygon(plot.col, plot.row, plot.cols, plot.rows),
    }));
    plotLayer.appendChild(s('path', { class: 'tile-grid', d: tileGridPath(plot.col, plot.row, plot.cols, plot.rows) }));
    if (plot.kind === 'district') {
      // The plan numeral, set INTO the ground plane. Districts only — a
      // guild has no number and inventing one would be a lie.
      const c = toScreen(plot.col + plot.cols / 2, plot.row + plot.rows / 2);
      const size = Math.min(220, Math.max(64, 0.40 * Math.min(plot.cols, plot.rows) * TILE_W));
      plotLayer.appendChild(s('text', {
        class: 'numeral', 'text-anchor': 'middle',
        transform: `matrix(1 0.5 -1 0.5 ${r2(c.x)} ${r2(c.y)})`,
        'font-size': r2(size),
      }, plot.number));
    }
  }
  camera.appendChild(plotLayer);

  // ---- the wall ----------------------------------------------------------
  const gates = gatesOf(w);
  const wallGeo = wallGeometry(w, gates, 26, 4);
  const wallLayer = s('g', { class: 'wall-layer' });
  for (const seg of wallGeo.north) {
    wallLayer.appendChild(s('polygon', { class: 'wall-face wall-north', points: seg.face }));
    wallLayer.appendChild(s('line', { class: 'wall-cap', ...seg.cap }));
  }
  for (const seg of wallGeo.west) {
    wallLayer.appendChild(s('polygon', { class: 'wall-face wall-west', points: seg.face }));
    wallLayer.appendChild(s('line', { class: 'wall-cap', ...seg.cap }));
  }
  // The two FRONT edges as a 4u kerb — a wall that stops halfway reads as
  // an accident; a wall you cannot see over hides the city.
  for (const seg of wallGeo.kerbs) {
    wallLayer.appendChild(s('polygon', { class: 'wall-kerb', points: seg.face }));
  }
  camera.appendChild(wallLayer);

  // ---- ground haze -------------------------------------------------------
  const boardBox = { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  camera.appendChild(s('rect', { class: 'haze haze-ground', x: boardBox.x, y: boardBox.y - 40, width: boardBox.w, height: boardBox.h + 40, fill: 'url(#haze-ground)' }));

  // ---- streets: roads, shadows, walk routes ------------------------------
  // Roads are the charter edges, routed along the real streets between two
  // doors. All 219 at once is a hairball, so they rest at zero opacity and
  // light for whoever you are looking at; the toolbar toggle shows them all.
  const grid = buildRoutingGrid(city);
  const router = createRouter(grid);
  const buildingsById = new Map(city.buildings.map((x) => [x.id, x]));

  const roadLayer = s('g', { class: 'road-layer' });
  const roadEls = [];
  for (const e of data.edges) {
    const from = buildingsById.get(e.from);
    const to = buildingsById.get(e.to);
    if (!from || !to) continue;
    const walk = walkBetween(router, from, to, footprintOf(from), footprintOf(to));
    if (!walk) continue;
    const path = s('path', { class: 'road', d: screenPath(walk).d });
    path.dataset.from = e.from;
    path.dataset.to = e.to;
    roadLayer.appendChild(path);
    roadEls.push(path);
  }
  camera.appendChild(roadLayer);

  const shadowLayer = s('g', { class: 'shadow-layer' });
  camera.appendChild(shadowLayer);

  const walkLayer = s('g', { class: 'walk-layer' });
  camera.appendChild(walkLayer);

  // ---- buildings ---------------------------------------------------------
  // Painter's algorithm: ascending (col + row) is exactly back-to-front in
  // this projection, and SVG paints in document order, so sorting the append
  // order is the whole of the depth handling. Walkers are inserted into this
  // same order as they move.
  const buildLayer = s('g', { class: 'building-layer' });
  const citizenEls = new Map();
  const figures = new Map();
  const buildingOrder = [];
  const ordered = [...city.buildings].sort(
    (p, q) => depthOf(p.col, p.row) - depthOf(q.col, q.row) || p.id.localeCompare(q.id),
  );
  const activities = new Map();
  let contentTop = b.minY;

  ordered.forEach((item, idx) => {
    const fp = footprintOf(item);
    const hue = hueClassFor(item);
    const cls = ['structure', `kind-${item.kind}`, hue];
    const activity = item.kind === 'citizen' ? activityOf(wfById.get(item.id), generatedAt) : 'none';
    activities.set(item.id, activity);
    if (item.director) cls.push('is-director');
    if (item.unreachable) cls.push('is-ruin');
    if (item.system) cls.push('is-system');
    if (item.kind === 'citizen') cls.push(`act-${activity}`);

    const g = s('g', { class: cls.join(' ') });
    g.dataset.id = item.id;
    g.dataset.kind = item.kind;
    g.dataset.depth = String(depthOf(item.col, item.row));

    if (item.kind === 'citizen' && item.unreachable) {
      // A ruin is an empty lot. Nothing stands there, nothing casts a shadow,
      // nobody is home — that absence IS the finding, drawn.
      g.appendChild(s('polygon', { class: 'ruin-lot', points: plotPolygon(item.col, item.row, 1, 1, (1 - fp) / 2) }));
    } else if (item.kind === 'skill') {
      shadowLayer.appendChild(s('polygon', { class: 'cast-shadow', points: shadowPolygon(item.col, item.row, item.height, fp) }));
      // A monopitch shed: shelving, not a house. No storeys, no edge.
      const faces = boxFaces(item.col, item.row, item.height, fp);
      const pitched = shedTop(item.col, item.row, item.height, fp, 3);
      g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
      g.appendChild(s('polygon', { class: 'face face-right', points: pitched.right }));
      g.appendChild(s('polygon', { class: 'face face-top', points: pitched.top }));
    } else {
      shadowLayer.appendChild(s('ellipse', { class: 'ao-patch', ...contactPatch(item.col, item.row, fp), fill: 'url(#ao-patch)' }));
      shadowLayer.appendChild(s('polygon', { class: 'cast-shadow', points: shadowPolygon(item.col, item.row, item.height, fp) }));

      const faces = boxFaces(item.col, item.row, item.height, fp);
      const storeys = storeysOf(item.height);
      g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
      g.appendChild(s('polygon', { class: 'face face-right', points: faces.right }));
      const foot = footingBands(item.col, item.row, item.height, fp);
      g.appendChild(s('path', { class: 'face face-foot', d: `M ${foot.left.split(' ').join(' L ')} Z M ${foot.right.split(' ').join(' L ')} Z` }));
      if (storeys > 1) g.appendChild(s('path', { class: 'storeys', d: storeyLinesPath(item.col, item.row, item.height, fp) }));
      const win = windowsPath(item.col, item.row, item.height, fp, storeys);
      if (win) {
        const wp = s('path', { class: 'windows', d: win });
        wp.style.setProperty('--pulse-delay', `${(idx % 7) * 400}ms`);
        g.appendChild(wp);
      }

      let apex;
      if (roofOf(item.tools) === 'gable') {
        const gable = gableFaces(item.col, item.row, item.height, fp);
        g.appendChild(s('polygon', { class: 'face face-gable-shade', points: gable.shade }));
        g.appendChild(s('polygon', { class: 'face face-gable-end', points: gable.end }));
        g.appendChild(s('polygon', { class: 'face face-gable-lit', points: gable.lit }));
        g.classList.add('roof-gable');
        apex = gable.apex;
      } else {
        g.appendChild(s('polygon', { class: 'face face-top', points: faces.top }));
        g.classList.add('roof-flat');
        apex = faces.apex;
      }
      // The silhouette: revealed by opacity on hover; always on in the dark
      // theme as the compliant boundary. Never animates stroke-width.
      g.appendChild(s('path', { class: 'edge', d: silhouettePath(item.col, item.row, item.height, fp) }));

      // A director flies a banner: a real frontmatter flag, not a mood.
      if (item.director) {
        g.appendChild(s('line', { class: 'banner-pole', x1: apex.x, y1: apex.y, x2: apex.x, y2: apex.y - 20 }));
        const flag = s('polygon', { class: 'banner-flag', points: `${apex.x},${apex.y - 20} ${apex.x + 12},${apex.y - 16.5} ${apex.x + 8},${apex.y - 13} ${apex.x + 12},${apex.y - 9.5} ${apex.x},${apex.y - 13}` });
        flag.style.setProperty('--wave-delay', `${(idx % 5) * 300}ms`);
        g.appendChild(flag);
      }
      g.dataset.apexX = String(apex.x);
      g.dataset.apexY = String(apex.y - (item.director ? 24 : 0));
      contentTop = Math.min(contentTop, apex.y - (item.director ? 24 : 0) - NAME_H - 12);

      // The citizen, standing at their own front door.
      const door = doorPoint(item.col, item.row, fp);
      const fig = item.system
        ? construct(hue)
        : figure({ item, hueClass: hue, activity, delayMs: (idx * 260) % 3400 });
      fig.setAttribute('transform', `translate(${door.x} ${door.y + 2})`);
      g.appendChild(fig);
      figures.set(item.id, fig);
    }

    if (item.kind === 'citizen') {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', ariaLabel(item, wfById.get(item.id), activity));
      g.addEventListener('click', () => onSelect(item.id));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(item.id); }
      });
      citizenEls.set(item.id, g);
    } else {
      g.setAttribute('role', 'img');
      g.setAttribute('aria-label', `${item.id}, a skill in the Archive${item.guild ? `, owned by the ${item.guild}` : ''}`);
    }
    g.appendChild(s('title', {}, tooltipFor(item, data, wfById.get(item.id))));

    buildLayer.appendChild(g);
    buildingOrder.push({ depth: depthOf(item.col, item.row), el: g });
  });
  camera.appendChild(buildLayer);

  // ---- object haze (above buildings, capped at 0.10 by arithmetic) ---------
  camera.appendChild(s('rect', { class: 'haze haze-object', x: boardBox.x, y: boardBox.y - 160, width: boardBox.w, height: boardBox.h + 160, fill: 'url(#haze-object)' }));

  // ---- plates --------------------------------------------------------------
  // Tier 1 of the unified pass. These boxes are computed once and never move,
  // so every later pass over the name plates starts from the same occupied
  // set and a director's plate never drifts between two hovers.
  const plateLayer = s('g', { class: 'plate-layer' });
  const plateBoxes = [];
  const plates = placePlates(city, plateBoxes);
  for (const p of plates) {
    if (p.displaced) {
      plateLayer.appendChild(s('line', { class: `plate-leader ${p.cls}`, x1: r2(p.x), y1: r2(p.y + p.h), x2: r2(p.anchorX), y2: r2(p.anchorY) }));
    }
    plateLayer.appendChild(precinctPlate(p));
    contentTop = Math.min(contentTop, p.y - 8);
  }
  // Name plates: a pool created once, repositioned by transform, revealed
  // by opacity. Hover creates zero DOM nodes.
  const pool = [];
  for (let i = 0; i < NAME_POOL; i++) {
    const np = namePlate();
    plateLayer.appendChild(np.outer);
    pool.push(np);
  }
  camera.appendChild(plateLayer);

  // ---- viewBox: fit the content, not just the ground -----------------------
  // FOCUS_CITY: the whole plan. On a phone this is what put a 22-unit citizen
  // on screen at six pixels, so it is now one of three frames rather than the
  // only one — see computeFocusFrame. The camera clamp is unchanged; what
  // changes is the rectangle k=1 means.
  const view = {
    x: b.minX - PAD,
    y: contentTop - 12,
    w: b.maxX - b.minX + PAD * 2,
    h: b.maxY + PLINTH - contentTop + 12 + PAD * 0.6,
  };
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  /** Switch frames as a hard cut: viewBox is not a transform and never tweens. */
  function setFrame(f) {
    svg.setAttribute('viewBox', `${r2(f.x)} ${r2(f.y)} ${r2(f.w)} ${r2(f.h)}`);
    // The sky is three frames wide so a letterboxed axis reads as more sky
    // rather than a hard-edged empty bar.
    skyRect.setAttribute('x', r2(f.x - f.w));
    skyRect.setAttribute('y', r2(f.y - f.h));
    skyRect.setAttribute('width', r2(f.w * 3));
    skyRect.setAttribute('height', r2(f.h * 3));
  }
  setFrame(view);

  return {
    camera, citizenEls, roadEls, figures, activities, view,
    buildLayer, buildingOrder, walkLayer, shadowLayer, plateLayer, plateBoxes,
    namePool: pool, router, buildingsById, agentsById, setFrame,
  };
}

// -------------------------------------------------------- focus frames ---

/**
 * Which rectangle `k = 1` means, per container width.
 *
 * The figure kit is 22 units tall and correct. What broke on a phone was the
 * frame around it: the viewBox was always the whole city, so a 358px-wide
 * container drew a citizen at ~6 CSS px and no amount of zoom clamp could
 * help, because the clamp governs movement FROM the default view, not the
 * default view itself. So there are three defaults now, chosen by the space
 * the map is actually given and computed live from the real plan — no
 * hardcoded district, no hardcoded coordinates, nothing that stops being
 * true when the roster grows.
 */
export const FIGURE_UNITS = 22;
const LABEL_HEADROOM = 96; // the plate/banner stack above the tallest roof
const GROUND_SLACK = 16; // contact shadow and the figure standing at the door
const LATERAL = 14; // a sliver of street either side, in screen units
const RING_MAX = 6;
const FLOOR_MIN = 24; // a head resolves to ~6.3px here: a region, not a pixel
const FLOOR_COMFORTABLE = 28;

export function bandFor(width) {
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

const centroidOf = (p) => ({ col: p.col + p.cols / 2, row: p.row + p.rows / 2 });

/** The plot the plan itself put at the middle: the plaza, whatever it is called. */
function focalPlot(city) {
  let best = null;
  let bestD = Infinity;
  for (const p of city.plots.values()) {
    if (p.kind !== 'district') continue;
    const c = centroidOf(p);
    const d = c.col * c.col + c.row * c.row;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Screen box around a set of plots, with room for what stands and hangs on them. */
function frameOfPlots(city, list) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  const keys = new Set(list.map((p) => p.key));
  for (const p of list) {
    const b = screenBounds(p.col, p.row, p.col + p.cols, p.row + p.rows);
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY);
  }
  const inside = (bld) => list.some((p) => bld.col >= p.col && bld.col < p.col + p.cols
    && bld.row >= p.row && bld.row < p.row + p.rows);
  for (const bld of city.buildings) {
    if (!keys.size || !inside(bld)) continue;
    minY = Math.min(minY, toScreen(bld.col, bld.row).y - (bld.height || 0));
  }
  return {
    x: minX - LATERAL,
    y: minY - LABEL_HEADROOM,
    w: (maxX - minX) + LATERAL * 2,
    h: (maxY - minY) + LABEL_HEADROOM + GROUND_SLACK,
  };
}

/** Figure height in CSS pixels at k=1, the way preserveAspectRatio="meet" fits. */
export function legibilityOf(frame, container) {
  const scale = Math.min(container.width / frame.w, container.height / frame.h);
  return FIGURE_UNITS * scale;
}

/**
 * The default frame for a container. `cityFrame` is the whole-plan rectangle
 * renderCity already computed; the other two are grown from the plaza until
 * they stop being legible, then backed off one step.
 */
export function computeFocusFrame(city, container, cityFrame) {
  const band = bandFor(container.width);
  if (band === 'desktop') return { name: 'city', band, ...cityFrame };
  const focus = focalPlot(city);
  if (!focus) return { name: 'city', band, ...cityFrame };

  const district = frameOfPlots(city, [focus]);
  if (band === 'phone') return { name: 'district', band, ...district };

  // FOCUS_RING: the plaza plus its nearest neighbours, as many as still read.
  const others = [...city.plots.values()]
    .filter((p) => p.key !== focus.key)
    .map((p) => {
      const a = centroidOf(focus); const b = centroidOf(p);
      return { p, d: (a.col - b.col) ** 2 + (a.row - b.row) ** 2 };
    })
    .sort((x, y) => x.d - y.d || x.p.key.localeCompare(y.p.key));

  let best = district;
  let bestSet = [focus];
  for (let k = 1; k <= Math.min(RING_MAX, others.length); k++) {
    const set = [focus, ...others.slice(0, k).map((o) => o.p)];
    const frame = frameOfPlots(city, set);
    if (legibilityOf(frame, container) < FLOOR_MIN) break;
    best = frame;
    bestSet = set;
    if (legibilityOf(frame, container) < FLOOR_COMFORTABLE) break;
  }
  return { name: 'ring', band, members: bestSet.map((p) => p.key), ...best };
}

/**
 * Tiers 2 and 3 of the same pass: director names, then citizen names, placed
 * against the precinct plates and each other.
 *
 * `wanted` arrives in priority order (directors first). A director is never
 * dropped; a citizen whose offset budget is exhausted is simply not labelled
 * this frame — it is still a building, still in the roster, still one click
 * from its record. Returns the ids that were dropped, for whoever wants to
 * know rather than guess.
 */
export function refreshNamePlates({ namePool, plateBoxes }, { directors, anchors, others }, citizenEls) {
  const placed = plateBoxes.slice();
  const dropped = [];
  const positions = new Map();
  const depth = (id) => Number(citizenEls.get(id)?.dataset.depth ?? 0);
  const byDepth = (a, b) => depth(a) - depth(b) || a.localeCompare(b);
  // T2 back-to-front, matching the precinct pass. Anchors keep their place at
  // the head of T3 — dropping the label on the thing the visitor is pointing
  // at would be the one drop nobody could read as deliberate.
  const order = [...directors].sort(byDepth)
    .concat(anchors, [...others].sort(byDepth))
    .filter((id, i, all) => all.indexOf(id) === i);
  const isDirector = new Set(directors);
  for (const id of order) {
    const g = citizenEls.get(id);
    if (!g || !g.dataset.apexX) continue; // a ruin has no roof to name
    const x = Number(g.dataset.apexX);
    const y = Number(g.dataset.apexY);
    const c = {
      w: nameWidth(id), h: NAME_H,
      cx0: x, cy0: y - 10 - NAME_H / 2,
      anchorX: x, anchorY: y,
    };
    const fits = placeCandidate(c, placed);
    if (!fits && !isDirector.has(id)) {
      placed.pop(); // a dropped citizen does not reserve space it never used
      dropped.push(id);
      continue;
    }
    positions.set(id, c);
  }

  for (const np of namePool) if (np.id && !positions.has(np.id)) unmountNamePlate(np);
  for (const [id, c] of positions) {
    const slot = namePool.find((p) => p.id === id) || namePool.find((p) => !p.id);
    if (!slot) break; // pool exhausted: the roster is the record
    mountNamePlate(slot, citizenEls.get(id), id, c);
  }
  return dropped;
}

/** A monopitch top for a shed: the back edge raised by `pitch`. */
function shedTop(col, row, height, fp, pitch) {
  const inset = (1 - fp) / 2;
  const n = toScreen(col + inset, row + inset);
  const e = toScreen(col + 1 - inset, row + inset);
  const sPt = toScreen(col + 1 - inset, row + 1 - inset);
  const wPt = toScreen(col + inset, row + 1 - inset);
  const P = (p, d) => `${r2(p.x)},${r2(p.y - d)}`;
  return {
    top: [P(n, height + pitch), P(e, height + pitch), P(sPt, height), P(wPt, height)].join(' '),
    right: [P(e, height + pitch), P(sPt, height), P(sPt, 0), P(e, 0)].join(' '),
  };
}

/**
 * Position a name plate over a building and reveal it. Text and width are
 * set while the plate is invisible; only opacity and transform animate.
 *
 * `placement` is the box the unified pass decided on. Without one the plate
 * falls back to its natural spot above the roof, which is what a caller that
 * only wants one label (a test, a single reveal) means by "here".
 */
export function mountNamePlate(np, structureEl, id, placement) {
  const x = Number(structureEl.dataset.apexX);
  const y = Number(structureEl.dataset.apexY);
  const w = nameWidth(id);
  const cx = placement ? placement.box.cx : x;
  const cy = placement ? placement.box.cy : y - 10 - NAME_H / 2;
  const displaced = placement ? placement.displaced : false;
  np.rect.setAttribute('x', r2(-w / 2));
  np.rect.setAttribute('width', r2(w));
  np.text.textContent = id;
  np.outer.setAttribute('transform', `translate(${r2(cx)} ${r2(cy - NAME_H / 2)})`);
  // The leader is drawn in the plate's own local space: from its bottom edge
  // back to the roof it belongs to, so a nudged label still points home.
  np.leader.setAttribute('x1', 0);
  np.leader.setAttribute('y1', NAME_H);
  np.leader.setAttribute('x2', r2(x - cx));
  np.leader.setAttribute('y2', r2(y - (cy - NAME_H / 2)));
  np.outer.classList.toggle('displaced', displaced);
  np.outer.classList.add('on');
  np.id = id;
}

export function unmountNamePlate(np) {
  np.outer.classList.remove('on', 'displaced');
  np.id = null;
}

function ariaLabel(item, wf, activity) {
  const bits = [item.id];
  if (item.director) bits.push('Director');
  if (item.division) bits.push(`of ${item.division}`);
  else if (item.guild) bits.push(`of the ${item.guild}`);
  else if (item.system) bits.push('a system utility, no division');
  else bits.push('no division declared');
  if (item.unreachable) bits.push('unreachable: named by no one upstream or downstream');
  bits.push(`connected to ${item.degree} other ${item.degree === 1 ? 'citizen' : 'citizens'}`);
  if (item.model) bits.push(`model ${item.model}`); else bits.push('no model declared');
  if (activity === 'active') bits.push(`active: dispatched ${wf.assignments} ${wf.assignments === 1 ? 'time' : 'times'}, most recently within the telemetry window`);
  else if (activity === 'recent') bits.push(`dispatched ${wf.assignments} ${wf.assignments === 1 ? 'time' : 'times'}, last within 30 days`);
  else if (activity === 'idle') bits.push(`dispatched ${wf.assignments} ${wf.assignments === 1 ? 'time' : 'times'}, none in the last 30 days`);
  else if (activity === 'dormant' && !item.system) bits.push('never dispatched');
  return bits.join(', ');
}

function tooltipFor(item, data, wf) {
  if (item.kind === 'skill') {
    const sk = (data.skills || []).find((x) => x.id === item.id);
    return sk && sk.description ? `${item.id} — ${sk.description.slice(0, 160)}` : item.id;
  }
  const parts = [item.id];
  if (item.unreachable) parts.push('— unreachable, named by no one');
  else parts.push(`— ${item.degree} connection${item.degree === 1 ? '' : 's'}`);
  if (wf) parts.push(`· ${wf.assignments} dispatch${wf.assignments === 1 ? '' : 'es'}`);
  return parts.join(' ');
}

/**
 * Pan and zoom, on the camera group only.
 *
 * Drag to pan, wheel to zoom, arrow keys to pan and +/- to zoom for anyone
 * not using a mouse. Zoom is clamped so the city cannot be lost off-screen,
 * which is the failure that makes a pannable map feel broken. 1:1, no
 * inertia; the only thing that idles on the camera is nothing.
 */
export function attachCamera(svg, camera, { onReset, onZoom } = {}) {
  const state = { x: 0, y: 0, k: 1 };
  const MIN_K = 0.55;
  const MAX_K = 3.4;
  let dragging = false;
  let last = null;

  function apply() {
    camera.setAttribute('transform', `translate(${state.x} ${state.y}) scale(${state.k})`);
    if (onZoom) onZoom(state.k);
  }

  function zoomAt(factor, cx, cy) {
    const k = Math.min(MAX_K, Math.max(MIN_K, state.k * factor));
    if (k === state.k) return;
    // Keep the point under the cursor fixed while scaling.
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    state.x = local.x - ((local.x - state.x) / state.k) * k;
    state.y = local.y - ((local.y - state.y) / state.k) * k;
    state.k = k;
    apply();
  }

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    last = { x: ev.clientX, y: ev.clientY };
    svg.classList.add('grabbing');
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging || !last) return;
    const ctm = svg.getScreenCTM();
    const scale = ctm ? 1 / ctm.a : 1;
    state.x += (ev.clientX - last.x) * scale;
    state.y += (ev.clientY - last.y) * scale;
    last = { x: ev.clientX, y: ev.clientY };
    apply();
  });
  const endDrag = (ev) => {
    dragging = false;
    last = null;
    svg.classList.remove('grabbing');
    if (ev && ev.pointerId != null && svg.hasPointerCapture?.(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoomAt(ev.deltaY < 0 ? 1.14 : 1 / 1.14, ev.clientX, ev.clientY);
  }, { passive: false });

  svg.addEventListener('keydown', (ev) => {
    const STEP = 48;
    const map = { ArrowUp: [0, STEP], ArrowDown: [0, -STEP], ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0] };
    if (map[ev.key] && ev.target === svg) {
      ev.preventDefault();
      state.x += map[ev.key][0];
      state.y += map[ev.key][1];
      apply();
      return;
    }
    if (ev.key === '+' || ev.key === '=') {
      const r = svg.getBoundingClientRect();
      zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2);
    } else if (ev.key === '-' || ev.key === '_') {
      const r = svg.getBoundingClientRect();
      zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2);
    } else if (ev.key === '0') {
      reset();
    }
  });

  function reset() {
    state.x = 0; state.y = 0; state.k = 1;
    apply();
    if (onReset) onReset();
  }

  apply();
  return {
    reset,
    zoomIn: () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); },
    zoomOut: () => { const r = svg.getBoundingClientRect(); zoomAt(1 / 1.25, r.left + r.width / 2, r.top + r.height / 2); },
    get k() { return state.k; },
  };
}
