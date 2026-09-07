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
  boxFaces, gableFaces, silhouettePath, silhouetteBox, storeyLinesPath, windowsPath, doorPoint,
  doorPath, parapetPath,
  plotPolygon, tileGridPath, toScreen, depthOf, screenBounds,
  shadowPolygon, footingBands, contactPatch, wallGeometry, plinthFaces, TILE_W,
} from './iso.mjs';
import { placeLabels } from './labels.mjs';
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

  // A walker is a click target: following a live partnership is a move the
  // visitor makes (GAME-DESIGN §2, concept 2). The kit is 8u wide and ~22u
  // tall, and chasing that with a mouse would be a dexterity test, so one
  // invisible rect per walker gives the whole person a hit area. `fill:none`
  // plus `pointer-events:all` means it is targetable without painting
  // anything. Twelve of these exist for the whole page — they are counted in
  // WALKER_ELEMENTS and asserted by tests/budget.test.mjs.
  if (walker) g.appendChild(s('rect', { class: 'fig-hit', x: -10, y: -25, width: 20, height: 28 }));

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

const NUM_PX = 22;
const TITLE_PX = 22;
const SUB_PX = 16;
const PLATE_PAD = 11;
const PLATE_H = 50;
const PLATE_COMPACT_H = 32;

/*
 * One placement pass for every label on the map, run by `labels.mjs`.
 *
 * The old pass lifted a plate vertically until it stopped touching another
 * plate. That fixed nothing visible, because the two things it never knew
 * about are the two things that actually broke the picture: buildings, and
 * how many labels a frame can carry. Sixteen opaque plates and seven
 * always-on director names read as a pile of white boxes over a city, and
 * every one of them was technically collision-free.
 *
 * So the pass now scores candidates against the BUILDINGS as well as the
 * other labels, prefers the street in front of a plot over the roofscape
 * behind it, and declutters by zoom: districts always, people once you are
 * close enough to be looking at people. Widths are estimated from character
 * counts rather than measured, because measuring is three forced reflows per
 * label on every hover.
 */

/** Above this camera zoom, the map starts naming people as well as places. */
export const DIRECTOR_NAME_ZOOM = 1.3;

/**
 * How big a label is drawn, relative to the world.
 *
 * Plate type is in world units, so a frame that zooms in to make a 22-unit
 * citizen legible on a phone also blows a district title up to a caption bar
 * lying across the city it names. A label is UI, not a building: it should
 * read at roughly the same size whatever the camera is doing.
 */
const PLATE_TARGET_PX = 13;

export function plateScaleFor(frame, container) {
  const pxPerUnit = Math.min(container.width / frame.w, container.height / frame.h);
  if (!(pxPerUnit > 0)) return 1;
  return Math.max(0.34, Math.min(1, PLATE_TARGET_PX / (TITLE_PX * pxPerUnit)));
}

/**
 * What the label placer must not cover: one box per standing volume.
 *
 * A ruin contributes nothing, because nothing stands there - the empty lot IS
 * the finding and a label sitting on it hides nothing. Pure, so the
 * regression test can build the same obstacle field the renderer builds.
 */
export function obstacleBoxes(city) {
  const out = [];
  for (const item of city.buildings) {
    if (item.kind === 'citizen' && item.unreachable) continue;
    const fp = footprintOf(item);
    const pitch = (item.director ? 26 : 0)
      + (item.kind === 'citizen' && roofOf(item.tools) === 'gable' ? 12 : 0);
    out.push({ id: item.id, ...silhouetteBox(item.col, item.row, item.height, fp, pitch) });
  }
  return out;
}

/**
 * T1: the precinct plates.
 *
 * The anchor is the plot's FRONT corner, not its back one. In this
 * projection the back corner is exactly where the roofs climb, which is why
 * "00 · Cabinet" used to sit across the Cabinet's own tower; the front corner
 * is the street, where nothing is built and nothing extrudes upward.
 */
export function plateCandidates(city) {
  return [...city.plots.values()]
    .map((plot) => {
      const front = toScreen(plot.col + plot.cols, plot.row + plot.rows);
      const num = plot.kind === 'district' ? `${plot.number} · ` : '';
      const title = plot.kind === 'district' ? plot.label.replace(/^\d\d · /, '') : plot.label;
      const sub = plot.sub || `${plot.count} ${plot.count === 1 ? 'member' : 'members'}`;
      const line1 = num.length * NUM_PX * 0.62 + title.length * TITLE_PX * 0.55;
      const titleUnits = line1 + PLATE_PAD * 2;
      const wUnits = Math.max(line1, sub.length * SUB_PX * 0.62) + PLATE_PAD * 2;
      return {
        key: plot.key, cls: plotHueClass(plot), num, title, sub, wUnits, titleUnits,
        anchorX: front.x, anchorY: front.y + 2, front,
        depth: depthOf(plot.col, plot.row),
      };
    })
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
}

/**
 * Run the T1 pass and write the result back onto each candidate.
 *
 * `frame` is the viewBox the plates will be drawn into. Passing it stops the
 * placer solving a crowded plan by walking a plate off the edge of the
 * picture — which it could always do, because `insideFrame` had nothing to
 * check against. It also lets the frame itself be tight: the default view no
 * longer has to reserve a band of empty street at the bottom on the chance
 * that a plate lands there, because a plate can no longer land outside.
 */
export function placePlates(candidates, placed, scale, obstacles, frame = null) {
  const labels = candidates.map((p) => {
    const w = p.wUnits * scale;
    const h = PLATE_H * scale;
    const cw = p.titleUnits * scale;
    const ch = PLATE_COMPACT_H * scale;
    p.w = w; p.h = h;
    return {
      id: p.key, tier: 1, w, h, droppable: false,
      anchor: { x: p.front.x, y: p.front.y },
      natural: { cx: p.front.x, cy: p.front.y + 10 + h / 2 },
      // The density fallback: title only, one line, roughly half the area.
      compact: { w: cw, h: ch, natural: { cx: p.front.x, cy: p.front.y + 10 + ch / 2 } },
    };
  });
  const { placements } = placeLabels(labels, { obstacles, frame });
  for (const p of candidates) {
    const got = placements.get(p.key);
    p.box = got.box;
    p.displaced = got.displaced;
    p.cover = got.cover;
    p.compactForm = Boolean(got.compact);
    p.w = got.box.w;
    p.h = got.box.h;
    p.x = p.box.cx;
    p.y = p.box.cy - p.h / 2;
    placed.push(p.box);
  }
  return candidates;
}

/**
 * The plate itself: a hue rule on the left edge, the number in the precinct's
 * own text tone, the title, and the count under it. The rule is what ties an
 * off-street label back to the block it names once the placer has moved it.
 */
function precinctPlate(p) {
  // Geometry is authored once at scale 1 and the group's own transform carries
  // the frame's label scale, so re-framing is 15 attribute writes rather than
  // a re-render, and no wrapper element is spent on it.
  const g = s('g', { class: `precinct-plate ${p.cls} kind-${p.key.startsWith('__') ? 'outside' : 'district'}` });
  p.bg = s('rect', { class: 'plate-bg', x: r2(-p.wUnits / 2), y: 0, width: r2(p.wUnits), height: PLATE_H, rx: 3 });
  p.rule = s('rect', { class: 'plate-rule', x: r2(-p.wUnits / 2), y: 0, width: 4, height: PLATE_H });
  g.appendChild(p.bg);
  g.appendChild(p.rule);
  const t1 = s('text', { class: 'plate-line1', x: 0, y: 24, 'text-anchor': 'middle' });
  if (p.num) t1.appendChild(s('tspan', { class: 'plate-num' }, p.num));
  t1.appendChild(s('tspan', { class: 'plate-title' }, p.title));
  g.appendChild(t1);
  g.appendChild(s('text', { class: 'plate-sub', x: 0, y: 41, 'text-anchor': 'middle' }, p.sub));
  return g;
}

const NAME_PX = 20;
export const NAME_H = 30;
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
  inner.appendChild(s('text', { class: 'plate-name', x: 0, y: 20, 'text-anchor': 'middle' }, ''));
  outer.appendChild(inner);
  return { outer, inner, leader, rect: inner.firstChild, text: inner.lastChild, id: null, anchor: null, box: null };
}

export const nameWidth = (id) => id.length * NAME_PX * 0.62 + 18;

const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------- render ---

/**
 * @param {{svg: Element, data: object, city: object, workforce?: object|null,
 *          onSelect?: Function, idPrefix?: string}} input
 *
 * `idPrefix` exists because the studio draws a SECOND city on the same page.
 * The four gradient ids below are document-wide, and two elements sharing an
 * id is a document that is wrong even when it happens to paint correctly (a
 * `url(#sky)` reference resolves to whichever came first). One prefix keeps
 * the second map's defs its own; the default is empty, so the hero map's
 * markup is byte for byte what it was.
 */
export function renderCity({ svg, data, city, workforce = null, onSelect = null, idPrefix = '' }) {
  doc = svg.ownerDocument || globalThis.document;
  svg.textContent = '';
  const gid = (name) => `${idPrefix}${name}`;
  const gurl = (name) => `url(#${idPrefix}${name})`;

  const agentsById = new Map(data.agents.map((a) => [a.id, a]));
  const wfById = new Map(((workforce && workforce.agents) || []).map((a) => [a.id, a]));
  const generatedAt = workforce ? workforce.generatedAt : null;

  const b = screenBounds(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow);
  const PAD = 64;
  const PLINTH = 14;

  // ---- defs ------------------------------------------------------------
  const defs = s('defs');

  /**
   * The materials, defined once and referenced by everything.
   *
   * The constraint that shapes all of this: an SVG gradient in <defs> is
   * resolved against ITS OWN position in the tree, not against the element
   * that references it, so `var(--hue)` inside a stop reads the root's hue
   * and not the building's. That rules out the obvious approach — one
   * gradient per precinct per face — and rules IN a better one: the flat
   * hue-derived fill still carries the colour, and a hue-AGNOSTIC ramp is
   * composited over it. One definition serves twenty precincts, the value
   * ladder DESIGN.md §3 specifies is untouched, and every face gains the
   * thing it was missing, which is a light that falls off across it.
   */
  const grad = (id, attrs, stops) => {
    const g = s(attrs.cx !== undefined ? 'radialGradient' : 'linearGradient', { id: gid(id), ...attrs });
    for (const st of stops) g.appendChild(s('stop', st));
    defs.appendChild(g);
    return g;
  };

  // Sky: three values, because a two-stop ramp is a fill and a fill is the
  // loudest possible signal that nothing was lit.
  grad('sky', { x1: 0, y1: 0, x2: 0, y2: 1 }, [
    { offset: 0, 'stop-color': 'var(--sky-top)' },
    { offset: 0.58, 'stop-color': 'var(--sky-mid)' },
    { offset: 1, 'stop-color': 'var(--sky-bottom)' },
  ]);

  // The key light, drawn in the sky it comes from. Every face on this map is
  // stepped off one light from the upper right; this gives that light a
  // cause on screen instead of leaving it as an assertion in a comment.
  grad('sun', { cx: 0.80, cy: 0.16, r: 0.62 }, [
    { offset: 0, 'stop-color': 'var(--sun)', 'stop-opacity': 'var(--sun-alpha)' },
    { offset: 0.42, 'stop-color': 'var(--sun)', 'stop-opacity': 'var(--sun-mid-alpha)' },
    { offset: 1, 'stop-color': 'var(--sun)', 'stop-opacity': 0 },
  ]);

  // The pool that light throws on the ground plane, and the cool ambient
  // fill that gathers everywhere it does not reach.
  // Pool and ambient fill in ONE gradient rather than two stacked ones. Two
  // board-sized radial fills repaint twice per frame for one effect; on a
  // 1440x900 pan that pair alone was worth about 30 fps.
  grad('pool', { cx: 0.63, cy: 0.28, r: 0.82 }, [
    { offset: 0, 'stop-color': 'var(--ground-pool)', 'stop-opacity': 'var(--pool-alpha)' },
    { offset: 0.44, 'stop-color': 'var(--ground-pool)', 'stop-opacity': 0 },
    { offset: 0.58, 'stop-color': 'var(--ground-fill)', 'stop-opacity': 0 },
    { offset: 1, 'stop-color': 'var(--ground-fill)', 'stop-opacity': 'var(--fill-alpha)' },
  ]);

  // The sheen: light caught along the top of a wall, ambient occlusion
  // gathering at its foot. Painted over the flat face, in the face's own
  // bounding box, so one definition fits every building on the map.
  grad('sheen', { x1: 0, y1: 0, x2: 0, y2: 1 }, [
    { offset: 0, 'stop-color': 'var(--sheen-hi)', 'stop-opacity': 'var(--sheen-hi-alpha)' },
    { offset: 0.46, 'stop-color': 'var(--sheen-hi)', 'stop-opacity': 0 },
    { offset: 0.62, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0 },
    { offset: 1, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 'var(--sheen-lo-alpha)' },
  ]);
  // A roof is nearly normal to the key light, so its ramp runs along the
  // light's own direction rather than straight down.
  grad('sheen-top', { x1: 0.88, y1: 0, x2: 0.12, y2: 1 }, [
    { offset: 0, 'stop-color': 'var(--sheen-hi)', 'stop-opacity': 'var(--sheen-hi-alpha)' },
    { offset: 0.72, 'stop-color': 'var(--sheen-hi)', 'stop-opacity': 0 },
    { offset: 1, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.06 },
  ]);

  // Glass. Dark by day because it reflects a bright sky and reads as a hole
  // in a wall; warm and emissive when the telemetry says somebody is in.
  grad('glass', { x1: 0, y1: 0, x2: 0, y2: 1 }, [
    { offset: 0, 'stop-color': 'var(--glass-top)' },
    { offset: 1, 'stop-color': 'var(--glass-bottom)' },
  ]);
  grad('glass-lit', { x1: 0, y1: 0, x2: 0, y2: 1 }, [
    { offset: 0, 'stop-color': 'var(--glass-lit-top)' },
    { offset: 1, 'stop-color': 'var(--glass-lit-bottom)' },
  ]);

  // There is no blur filter here, and that is a measured decision rather
  // than a taste one. An feGaussianBlur over the whole shadow layer looks
  // right and costs a full-scene offscreen re-rasterisation on every camera
  // tick: measured on this scene at 1440x900 it took a clean 58 fps pan down
  // to 34 fps mean and 12 fps at p95, with 233 ms worst frames. The penumbra
  // below is two flat polygons per building instead — the shadow of a
  // slightly fatter, slightly longer building under the sharp one — which is
  // how a soft shadow was drawn before filters existed and costs nothing per
  // frame because it is just more geometry in the same paint.
  // One radial gradient, referenced by every contact patch. Defining it per
  // building would be one gradient per building for one visual effect.
  const ao = s('radialGradient', { id: gid('ao-patch') });
  ao.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.30 }));
  ao.appendChild(s('stop', { offset: 0.55, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.16 }));
  ao.appendChild(s('stop', { offset: 1, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0 }));
  defs.appendChild(ao);
  // The same patch under a building whose lights are on. Occlusion still
  // gathers right at the wall, and beyond it the light the windows are
  // already drawing has to land somewhere. Same element, same cost, and it
  // says the same thing the windows say rather than a second thing.
  const spill = s('radialGradient', { id: gid('ao-spill') });
  spill.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--ao-ink)', 'stop-opacity': 0.26 }));
  spill.appendChild(s('stop', { offset: 0.42, 'stop-color': 'var(--lamp)', 'stop-opacity': 'var(--spill-alpha)' }));
  spill.appendChild(s('stop', { offset: 1, 'stop-color': 'var(--lamp)', 'stop-opacity': 0 }));
  defs.appendChild(spill);
  // Aerial perspective: two planes, stop-opacity on the gradient so no group
  // opacity is needed anywhere but here.
  for (const [id, alpha] of [['haze-ground', 'var(--haze-ground-alpha)'], ['haze-object', 'var(--haze-object-alpha)']]) {
    const g = s('linearGradient', { id: gid(id), x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(s('stop', { offset: 0, 'stop-color': 'var(--sky-bottom)', 'stop-opacity': alpha }));
    g.appendChild(s('stop', { offset: 0.62, 'stop-color': 'var(--sky-bottom)', 'stop-opacity': 0 }));
    defs.appendChild(g);
  }
  svg.appendChild(defs);

  // ---- sky (environment, outside the camera) -----------------------------
  const skyRect = s('rect', { class: 'sky', fill: gurl('sky') });
  svg.appendChild(skyRect);
  const sunRect = s('rect', { class: 'sky sun-glow', fill: gurl('sun') });
  svg.appendChild(sunRect);

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
  // The plinth is a solid like any other and was the one left flat: the same
  // falloff every wall in the city gets, on the wall the city stands on.
  boardLayer.appendChild(s('polygon', { class: 'sheen', points: plinth.left, fill: gurl('sheen') }));
  boardLayer.appendChild(s('polygon', { class: 'sheen', points: plinth.right, fill: gurl('sheen') }));
  boardLayer.appendChild(s('polygon', { class: 'board-outer', points: plinth.top }));
  const w = city.wall;
  // An ecosystem with no declared divisions has nothing inside a wall, so it
  // gets neither the paved ground nor the wall itself. Drawing a walled
  // enclosure around an empty rectangle would say a district exists.
  const walled = w.cols > 0 && w.rows > 0;
  if (walled) {
    boardLayer.appendChild(s('polygon', { class: 'board-inner', points: plotPolygon(w.col, w.row, w.cols, w.rows) }));
  }
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

  // The ground plane as a lit surface rather than a fill: a warm pool where
  // the key light lands, a cool ambient fill everywhere it does not. Two
  // rectangles, under everything that stands up.
  const boardRect = {
    x: b.minX, y: b.minY, w: b.maxX - b.minX, h: (b.maxY + PLINTH) - b.minY,
  };
  camera.appendChild(s('rect', {
    class: 'ground-light', x: r2(boardRect.x), y: r2(boardRect.y),
    width: r2(boardRect.w), height: r2(boardRect.h), fill: gurl('pool'),
  }));

  // ---- the wall ----------------------------------------------------------
  if (walled) {
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
  }

  // ---- ground haze -------------------------------------------------------
  const boardBox = { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
  camera.appendChild(s('rect', { class: 'haze haze-ground', x: boardBox.x, y: boardBox.y - 40, width: boardBox.w, height: boardBox.h + 40, fill: gurl('haze-ground') }));

  // ---- streets: roads, shadows, walk routes ------------------------------
  // Roads are the charter edges, routed along the real streets between two
  // doors. All 219 at once is a hairball, so they rest at zero opacity and
  // light for whoever you are looking at; the toolbar toggle shows them all.
  const grid = buildRoutingGrid(city);
  const router = createRouter(grid);
  const buildingsById = new Map(city.buildings.map((x) => [x.id, x]));

  /**
   * The selection marker.
   *
   * One ring, created once and moved. Before it existed, selecting a citizen
   * highlighted their roads and dimmed their neighbours and left the actual
   * subject unmarked — which on an unreachable member, whose whole building
   * is an empty lot, meant the camera flew somewhere and nothing said where.
   * A ring on the ground under the subject is the oldest answer in the genre
   * and it costs three nodes for the whole map.
   */
  const markLayer = s('g', { class: 'mark-layer' });
  const selectRing = s('g', { class: 'select-ring' });
  const ringInner = s('ellipse', { class: 'select-ring-fill' });
  const ringOuter = s('ellipse', { class: 'select-ring-edge' });
  selectRing.appendChild(ringInner);
  selectRing.appendChild(ringOuter);
  markLayer.appendChild(selectRing);
  camera.appendChild(markLayer);

  function markSelection(item) {
    if (!item) { selectRing.classList.remove('on'); return; }
    const patch = contactPatch(item.col, item.row, footprintOf(item), 13);
    for (const [el, grow] of [[ringInner, 0], [ringOuter, 4]]) {
      el.setAttribute('cx', patch.cx);
      el.setAttribute('cy', patch.cy);
      el.setAttribute('rx', patch.rx + grow);
      el.setAttribute('ry', patch.ry + grow / 2);
    }
    selectRing.classList.add('on');
  }

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
  // What the label placer must not cover. One box per standing volume, in
  // the same world units labels are measured in. A ruin contributes nothing
  // because nothing stands there.
  const obstacles = [];
  const ordered = [...city.buildings].sort(
    (p, q) => depthOf(p.col, p.row) - depthOf(q.col, q.row) || p.id.localeCompare(q.id),
  );
  const activities = new Map();
  let contentTop = b.minY;
  let contentBottom = b.maxY;

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
    // Where the camera aims when this citizen is selected. Read from the
    // plan rather than from getBBox(), because the hit area below is
    // deliberately larger than the drawing and would drag the centre off it.
    const centre = doorPoint(item.col, item.row, fp);
    g.dataset.cx = String(centre.x);
    g.dataset.cy = String(r2(centre.y - item.height * 0.45));
    if (!(item.kind === 'citizen' && item.unreachable)) {
      const pitch = (item.director ? 26 : 0) + (item.kind === 'citizen' && roofOf(item.tools) === 'gable' ? 12 : 0);
      obstacles.push({ id: item.id, ...silhouetteBox(item.col, item.row, item.height, fp, pitch) });
    }

    if (item.kind === 'citizen' && item.unreachable) {
      // A ruin is an empty lot. Nothing stands there, nothing casts a shadow,
      // nobody is home — that absence IS the finding, drawn.
      g.appendChild(s('polygon', { class: 'ruin-lot', points: plotPolygon(item.col, item.row, 1, 1, (1 - fp) / 2) }));
    } else if (item.kind === 'skill') {
      shadowLayer.appendChild(s('polygon', { class: 'cast-shadow', points: shadowPolygon(item.col, item.row, item.height, fp) }));
      // A monopitch shed: shelving, not a house. No storeys, no edge. It gets
      // no penumbra either: eighty-six of them stand shoulder to shoulder in
      // one block where no individual soft edge is legible, and they were
      // eighty-six of the hundred and forty-five the scene was paying for.
      const faces = boxFaces(item.col, item.row, item.height, fp);
      const pitched = shedTop(item.col, item.row, item.height, fp, 3);
      g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
      g.appendChild(s('polygon', { class: 'face face-right', points: pitched.right }));
      g.appendChild(s('polygon', { class: 'face face-top', points: pitched.top }));
      g.appendChild(s('polygon', { class: 'sheen', points: faces.left, fill: gurl('sheen') }));
      g.appendChild(s('polygon', { class: 'sheen', points: pitched.right, fill: gurl('sheen') }));
      g.appendChild(s('polygon', { class: 'sheen sheen-roof', points: pitched.top, fill: gurl('sheen-top') }));
    } else {
      const home = activity === 'active' || activity === 'recent';
      shadowLayer.appendChild(s('ellipse', {
        class: 'ao-patch', ...contactPatch(item.col, item.row, fp, home ? 15 : 11),
        fill: gurl(home ? 'ao-spill' : 'ao-patch'),
      }));
      // The sun is a disc, not a point: a wide faint shadow under a narrow
      // dark one is a penumbra, and two polygons is the whole cost of it.
      shadowLayer.appendChild(s('polygon', {
        class: 'cast-shadow cast-penumbra',
        points: shadowPolygon(item.col, item.row, item.height, Math.min(0.99, fp * 1.34), 0.63),
      }));
      shadowLayer.appendChild(s('polygon', { class: 'cast-shadow', points: shadowPolygon(item.col, item.row, item.height, fp) }));

      const faces = boxFaces(item.col, item.row, item.height, fp);
      const storeys = storeysOf(item.height);
      g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
      g.appendChild(s('polygon', { class: 'face face-right', points: faces.right }));
      // The light, falling off down each wall. Same points, one shared ramp.
      g.appendChild(s('polygon', { class: 'sheen', points: faces.left, fill: gurl('sheen') }));
      g.appendChild(s('polygon', { class: 'sheen', points: faces.right, fill: gurl('sheen') }));
      const foot = footingBands(item.col, item.row, item.height, fp);
      // Footing band and doorway share one path: the door is where the
      // citizen is already standing, and it costs no element to draw it.
      const footD = `M ${foot.left.split(' ').join(' L ')} Z M ${foot.right.split(' ').join(' L ')} Z `
        + doorPath(item.col, item.row, item.height, fp);
      g.appendChild(s('path', { class: 'face face-foot', d: footD }));
      const flat = roofOf(item.tools) !== 'gable';
      const lines = (storeys > 1 ? storeyLinesPath(item.col, item.row, item.height, fp) : '')
        + (flat ? ' ' + parapetPath(item.col, item.row, item.height, fp) : '');
      if (lines.trim()) g.appendChild(s('path', { class: 'storeys', d: lines.trim() }));
      const win = windowsPath(item.col, item.row, item.height, fp, storeys);
      if (win) {
        const lit = activity === 'active' || activity === 'recent';
        const wp = s('path', { class: 'windows', d: win, fill: gurl(lit ? 'glass-lit' : 'glass') });
        wp.style.setProperty('--pulse-delay', `${(idx % 7) * 400}ms`);
        g.appendChild(wp);
      }

      let apex;
      if (roofOf(item.tools) === 'gable') {
        const gable = gableFaces(item.col, item.row, item.height, fp);
        g.appendChild(s('polygon', { class: 'face face-gable-shade', points: gable.shade }));
        g.appendChild(s('polygon', { class: 'face face-gable-end', points: gable.end }));
        g.appendChild(s('polygon', { class: 'face face-gable-lit', points: gable.lit }));
        g.appendChild(s('polygon', { class: 'sheen sheen-roof', points: gable.lit, fill: gurl('sheen-top') }));
        g.classList.add('roof-gable');
        apex = gable.apex;
      } else {
        g.appendChild(s('polygon', { class: 'face face-top', points: faces.top }));
        g.appendChild(s('polygon', { class: 'sheen sheen-roof', points: faces.top, fill: gurl('sheen-top') }));
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
      // A target larger than the sprite, which is standard practice in every
      // game that draws a person eight pixels tall. `fill: none` with
      // `pointer-events: all` makes an unpainted interior hittable, so this
      // costs one node and no ink. Its radius is driven from CSS against the
      // live camera scale (--hit-r), so the target stays roughly constant in
      // SCREEN pixels however far out the view is zoomed.
      g.insertBefore(s('circle', {
        class: 'hit-area', cx: r2(centre.x), cy: r2(centre.y - 6),
      }), g.firstChild);
      g.setAttribute('aria-label', ariaLabel(item, wfById.get(item.id), activity));
      // A citizen is a BUTTON only where there is somewhere for the button to
      // go. The hero map opens a panel; the studio map has none, and calling
      // it a button there would put every building in the tab order, announce
      // it to a screen reader as actionable, and then throw on click because
      // there is no handler. Advertising an interaction that does not exist is
      // worse than not offering it.
      if (typeof onSelect === 'function') {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.addEventListener('click', () => onSelect(item.id));
        g.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(item.id); }
        });
      } else {
        g.setAttribute('role', 'img');
      }
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
  camera.appendChild(s('rect', { class: 'haze haze-object', x: boardBox.x, y: boardBox.y - 160, width: boardBox.w, height: boardBox.h + 160, fill: gurl('haze-object') }));

  // ---- plates --------------------------------------------------------------
  // Tier 1 of the unified pass. These boxes are computed once and never move,
  // so every later pass over the name plates starts from the same occupied
  // set and a director's plate never drifts between two hovers.
  const plateLayer = s('g', { class: 'plate-layer' });
  const plateBoxes = [];
  const plates = plateCandidates(city);
  placePlates(plates, plateBoxes, 1, obstacles);
  for (const p of plates) {
    // One leader per plate, mounted once and toggled — the same pool
    // discipline the name plates use, so re-framing never creates a node.
    p.leader = s('line', { class: `plate-leader ${p.cls}` });
    plateLayer.appendChild(p.leader);
    p.el = precinctPlate(p);
    plateLayer.appendChild(p.el);
    contentTop = Math.min(contentTop, p.y - 8);
    contentBottom = Math.max(contentBottom, p.y + p.h + 8);
  }

  /**
   * Hide the label of anything that is not on screen.
   *
   * Once the default frame stopped being "the whole city", plates for
   * districts outside it clipped against the frame edge and printed half a
   * word. A label whose subject is off screen is not information, it is
   * debris, so it is switched off by class — no node created, no node
   * destroyed, and the roster still lists everyone either way.
   */
  const labelled = [];
  function cullLabels(next) {
    if (next) state.cull = next;
    const rect = state.cull;
    if (!rect) return;
    const inside = (px, py) => px >= rect.x && px <= rect.x + rect.w
      && py >= rect.y && py <= rect.y + rect.h;
    // Whole box, not just its centre: half a word clipped against the frame
    // edge reads as a rendering bug, and the subject has to be on screen too
    // or the label is naming something the visitor cannot see.
    const shows = (box, ax, ay) => inside(ax, ay)
      && inside(box.cx - box.w / 2, box.cy - box.h / 2)
      && inside(box.cx + box.w / 2, box.cy + box.h / 2);
    for (const p of plates) {
      const off = !shows(p.box, p.anchorX, p.anchorY);
      p.el.classList.toggle('off-frame', off);
      p.leader.classList.toggle('off-frame', off);
    }
    for (const np of labelled) {
      np.outer.classList.toggle('off-frame', Boolean(np.anchor) && !shows(np.box, np.anchor.x, np.anchor.y));
    }
  }

  /** Re-place and redraw every precinct plate at a new label scale. */
  function relayoutPlates(scale, frame = null) {
    plateBoxes.length = 0;
    placePlates(plates, plateBoxes, scale, obstacles, frame);
    for (const p of plates) {
      p.el.setAttribute('transform', `translate(${r2(p.x)} ${r2(p.y)}) scale(${r2(scale)})`);
      p.el.classList.toggle('compact', p.compactForm);
      const bw = p.compactForm ? p.titleUnits : p.wUnits;
      p.bg.setAttribute('x', r2(-bw / 2));
      p.bg.setAttribute('width', r2(bw));
      p.bg.setAttribute('height', p.compactForm ? PLATE_COMPACT_H : PLATE_H);
      p.rule.setAttribute('x', r2(-bw / 2));
      p.rule.setAttribute('height', p.compactForm ? PLATE_COMPACT_H : PLATE_H);
      p.leader.setAttribute('x1', r2(p.x));
      p.leader.setAttribute('y1', r2(p.y + p.h));
      p.leader.setAttribute('x2', r2(p.anchorX));
      p.leader.setAttribute('y2', r2(p.anchorY));
      p.leader.classList.toggle('on', Boolean(p.displaced));
    }
  }
  relayoutPlates(1);

  /**
   * A label is UI, and UI does not zoom.
   *
   * `plateScaleFor` already says so in its own comment — "a label should read
   * at roughly the same size whatever the camera is doing" — and then sized
   * plates against the FRAME only, so the camera was exactly the thing it did
   * not account for. Zoomed to 3x, a district title was a caption bar lying
   * across the city it names and a citizen's name was wider than the building
   * wearing it. Dividing the label scale by the live camera scale is the
   * whole fix. It is throttled to 6% steps because re-placing every plate is
   * a real pass and a wheel emits dozens of ticks a second; between steps the
   * labels simply ride the camera, which over 6% nobody can see.
   */
  function applyZoomScale(k) {
    const eff = Math.max(0.05, k || 1);
    if (Math.abs(eff - state.labelK) / state.labelK < 0.06) return false;
    state.labelK = eff;
    const f = state.frame;
    const visible = f ? { x: (f.x - state.camX) / eff, y: (f.y - state.camY) / eff, w: f.w / eff, h: f.h / eff } : null;
    relayoutPlates(state.plateScale / eff, visible);
    return true;
  }
  // Name plates: a pool created once, repositioned by transform, revealed
  // by opacity. Hover creates zero DOM nodes.
  const pool = [];
  for (let i = 0; i < NAME_POOL; i++) {
    const np = namePlate();
    plateLayer.appendChild(np.outer);
    pool.push(np);
    labelled.push(np);
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
    h: Math.max(b.maxY + PLINTH, contentBottom) - contentTop + 12 + PAD * 0.6,
  };
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  /** Switch frames as a hard cut: viewBox is not a transform and never tweens. */
  const state = { plateScale: 1, zoom: 1, labelK: 1, camX: 0, camY: 0 };
  function setFrame(f, container) {
    svg.setAttribute('viewBox', `${r2(f.x)} ${r2(f.y)} ${r2(f.w)} ${r2(f.h)}`);
    // The sky is three frames wide so a letterboxed axis reads as more sky
    // rather than a hard-edged empty bar.
    skyRect.setAttribute('x', r2(f.x - f.w));
    skyRect.setAttribute('y', r2(f.y - f.h));
    skyRect.setAttribute('width', r2(f.w * 3));
    skyRect.setAttribute('height', r2(f.h * 3));
    // The glow belongs to the FRAME, not to the oversized sky plate: a
    // radial in objectBoundingBox units on a three-frame rectangle would put
    // the sun a whole screen off the top right corner.
    sunRect.setAttribute('x', r2(f.x - f.w * 0.1));
    sunRect.setAttribute('y', r2(f.y - f.h * 0.1));
    sunRect.setAttribute('width', r2(f.w * 1.2));
    sunRect.setAttribute('height', r2(f.h * 1.2));
    state.frame = f;
    if (container) {
      state.plateScale = plateScaleFor(f, container);
      state.labelK = 1;
      relayoutPlates(state.plateScale, f);
    }
  }
  setFrame(view);

  return {
    camera, citizenEls, roadEls, figures, activities, view, obstacles,
    buildLayer, buildingOrder, walkLayer, shadowLayer, plateLayer, plateBoxes,
    namePool: pool, router, buildingsById, agentsById, setFrame, cullLabels,
    applyZoomScale, markSelection,
    setCamera(cx, cy) { state.camX = cx; state.camY = cy; },
    set zoom(k) { state.zoom = k; },
    get zoom() { return state.zoom ?? 1; },
    // The effective label scale: the frame's own, undone by the camera's.
    get plateScale() { return state.plateScale / state.labelK; },
    get frame() { return state.frame; },
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
/**
 * The street kept around the subject, in world units.
 *
 * These were 46 above, 108 below and 14 either side, and they were sized for
 * a frame built out of PLOT rectangles — which already carry a sidewalk, so
 * the padding was being paid twice. On a 1440x900 laptop the citizens ended
 * up filling 1209x551 of a 1438x716 map: a fifth of the hero was margin
 * around a margin. The frame is now built from the citizens themselves, so
 * the numbers only have to cover what actually sticks out of a silhouette
 * box: a director's banner pole above the roof, and the precinct plate that
 * hangs in the street in front of the nearest plot.
 */
const EDGE_SIDE = 10;
const EDGE_TOP = 4;
const EDGE_BOTTOM = 10;

export function bandFor(width) {
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/**
 * The screen box that contains every citizen: the subject of the whole page.
 *
 * Built from the citizens themselves rather than from the plots they stand
 * on. A plot is a rectangle in tile space and becomes a diamond on screen, so
 * a box around plots is always bigger than a box around the people — and the
 * people are what has to be reachable. `null` when an ecosystem has no
 * citizens at all, which is a real case for an imported folder of skills.
 */
export function subjectBox(city) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  let any = false;
  for (const item of city.buildings) {
    if (item.kind !== 'citizen') continue;
    any = true;
    const pitch = (item.director ? 26 : 0) + (roofOf(item.tools) === 'gable' ? 12 : 0);
    const b = silhouetteBox(item.col, item.row, item.height, footprintOf(item), pitch);
    const bottom = b.cy + b.h / 2;
    // A citizen stands at their own door. On a ruin there is no volume at all,
    // so the PERSON is the tallest thing on the lot and the box has to hold
    // them: an unreachable member is the finding this map exists to show, and
    // framing them out of the picture would be the one unforgivable crop.
    const top = Math.min(b.cy - b.h / 2, bottom - FIGURE_UNITS);
    minX = Math.min(minX, b.cx - b.w / 2); maxX = Math.max(maxX, b.cx + b.w / 2);
    minY = Math.min(minY, top); maxY = Math.max(maxY, bottom);
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/**
 * Grow a frame to the container's aspect ratio, clamped to the whole plan.
 *
 * `preserveAspectRatio="meet"` letterboxes whichever axis is not binding, and
 * a letterbox on an isometric diorama is wasted screen: the subject shrinks
 * so that empty sky can be drawn beside it. Growing the frame instead spends
 * that space on more city, for free, and stops when there is no more city to
 * show. Measured before this existed: 47.5% of the desktop hero was ground
 * nobody built on.
 */
function fitToAspect(frame, container, limit) {
  const target = container.width / container.height;
  if (!(target > 0)) return frame;
  const out = { ...frame };
  const wide = out.w / out.h;
  if (wide < target) {
    const want = Math.min(out.h * target, limit ? limit.w : Infinity);
    const grow = want - out.w;
    out.x -= grow / 2;
    out.w = want;
  } else if (wide > target) {
    const want = Math.min(out.w / target, limit ? limit.h : Infinity);
    const grow = want - out.h;
    // Not centred. This branch only fires on a PORTRAIT container, where the
    // spare space is sky above and below a wide, short city — and where the
    // HUD is not symmetric either: readouts, the headline and the panel bar
    // take about twice the height at the bottom that the nameplate takes at
    // the top. Biasing the growth upward sits the city a little above centre,
    // which is where the clear space actually is.
    out.y -= grow * 0.42;
    out.h = want;
  }
  return out;
}

/** Figure height in CSS pixels at k=1, the way preserveAspectRatio="meet" fits. */
export function legibilityOf(frame, container) {
  const scale = Math.min(container.width / frame.w, container.height / frame.h);
  return FIGURE_UNITS * scale;
}

/**
 * The default frame: the whole subject, fitted to the box the map is given.
 *
 * There used to be three defaults chosen by breakpoint — one district on a
 * phone, a ring of plots on a tablet, the plan on a desktop — on the theory
 * that a phone should trade coverage for a legible citizen. Measured on a
 * 390x844 phone, that theory cost 37 of 69 citizens: they were not small,
 * they were OUTSIDE THE PICTURE, and buildings ran off the right edge with no
 * hint that anything was there. A map whose default view hides half its
 * subject is not a map, and no amount of zoom fixes a thing you cannot see is
 * missing.
 *
 * So there is one rule at every width now: compute the extent of the people
 * and fit it to the frame. What changes with width is how big the frame is,
 * not how much of the city is in it. Legibility becomes a zoom, which is a
 * verb the visitor controls, rather than a crop, which is one they cannot
 * undo.
 *
 * `cityFrame` is the whole-plan rectangle renderCity computed, Archive
 * included; it stays the fallback for an ecosystem with no citizens and is
 * still one click away behind "Whole city".
 */
export function computeFocusFrame(city, container, cityFrame) {
  const band = bandFor(container.width);
  const box = subjectBox(city);
  if (!box) return { name: 'city', band, ...cityFrame };
  const core = {
    x: box.minX - EDGE_SIDE,
    y: box.minY - EDGE_TOP,
    w: (box.maxX - box.minX) + EDGE_SIDE * 2,
    h: (box.maxY - box.minY) + EDGE_TOP + EDGE_BOTTOM,
  };
  return { name: 'subject', band, ...fitToAspect(core, container, null) };
}

/**
 * Tiers 2 and 3 of the same pass: director names, then citizen names, placed
 * against the precinct plates, the buildings, and each other.
 *
 * The declutter rule, stated plainly because it changed what the page
 * promises: a PLACE is always named, a PERSON is named when you are close
 * enough to be looking at people. Seven director plates permanently mounted
 * over the middle of the city was most of the pile of white boxes, and no
 * placement algorithm fixes "there are too many labels"; only a rule about
 * how many labels a frame may carry does. So directors appear above
 * `DIRECTOR_NAME_ZOOM`, and at any zoom for whoever is hovered, focused,
 * selected, or standing next to them. Nobody becomes unreachable: the roster
 * and the panel name all 59 at every zoom, with JavaScript off included.
 *
 * `wanted` arrives in priority order. A citizen whose fan of candidate
 * positions is exhausted is simply not labelled this frame rather than
 * printed over something else.
 */
export function refreshNamePlates(scene, { directors, anchors, others }, citizenEls) {
  const { namePool, plateBoxes, obstacles = [] } = scene;
  const scale = scene.plateScale ?? 1;
  const zoom = scene.zoom ?? 1;
  const dropped = [];
  const depth = (id) => Number(citizenEls.get(id)?.dataset.depth ?? 0);
  const byDepth = (a, b) => depth(a) - depth(b) || a.localeCompare(b);
  const interactive = new Set([...anchors, ...others]);
  // T2 back-to-front, matching the precinct pass. A director being pointed at
  // is already in `anchors`, so gating the resting set never costs the
  // visitor the label they asked for.
  const namedDirectors = zoom >= DIRECTOR_NAME_ZOOM
    ? [...directors].sort(byDepth)
    : [...directors].filter((id) => interactive.has(id)).sort(byDepth);
  const order = namedDirectors
    .concat(anchors, [...others].sort(byDepth))
    .filter((id, i, all) => all.indexOf(id) === i);
  const undroppable = new Set(namedDirectors);

  const labels = [];
  for (const id of order) {
    const g = citizenEls.get(id);
    if (!g || !g.dataset.apexX) continue; // a ruin has no roof to name
    const x = Number(g.dataset.apexX);
    const y = Number(g.dataset.apexY);
    const h = NAME_H * scale;
    labels.push({
      id, subject: id, tier: undroppable.has(id) ? 2 : 3,
      w: nameWidth(id) * scale, h,
      droppable: !undroppable.has(id),
      anchor: { x, y },
      natural: { cx: x, cy: y - 8 - h / 2 },
      scale,
    });
  }

  const { placements, dropped: cut } = placeLabels(labels, {
    obstacles,
    reserved: plateBoxes,
  });
  dropped.push(...cut);

  const positions = new Map();
  for (const l of labels) {
    const got = placements.get(l.id);
    if (got) positions.set(l.id, { ...got, scale });
  }

  for (const np of namePool) if (np.id && !positions.has(np.id)) unmountNamePlate(np);
  for (const [id, c] of positions) {
    const slot = namePool.find((q) => q.id === id) || namePool.find((q) => !q.id);
    if (!slot) break; // pool exhausted: the roster is the record
    mountNamePlate(slot, citizenEls.get(id), id, c);
  }
  // Newly mounted plates have never been tested against the visible rect.
  scene.cullLabels?.();
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
  const scale = placement ? placement.scale : 1;
  const cx = placement ? placement.box.cx : x;
  const cy = placement ? placement.box.cy : y - 8 - NAME_H / 2;
  const top = cy - (NAME_H * scale) / 2;
  const displaced = placement ? placement.displaced : false;
  np.rect.setAttribute('x', r2(-w / 2));
  np.rect.setAttribute('width', r2(w));
  np.text.textContent = id;
  np.outer.setAttribute('transform', `translate(${r2(cx)} ${r2(top)}) scale(${r2(scale)})`);
  // The leader is drawn in the plate's own local space — which the same
  // transform scales — so it is divided back out to land on the real roof.
  np.leader.setAttribute('x1', 0);
  np.leader.setAttribute('y1', NAME_H);
  np.leader.setAttribute('x2', r2((x - cx) / scale));
  np.leader.setAttribute('y2', r2((y - top) / scale));
  np.outer.classList.toggle('displaced', displaced);
  np.outer.classList.add('on');
  np.anchor = { x, y };
  np.box = { cx, cy: top + (NAME_H * scale) / 2, w: w * scale, h: NAME_H * scale };
  np.id = id;
}

export function unmountNamePlate(np) {
  np.outer.classList.remove('on', 'displaced', 'off-frame');
  np.anchor = null;
  np.box = null;
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
 * The camera.
 *
 * Drag to pan, wheel to zoom, arrow keys to pan and +/- to zoom for anyone
 * not using a mouse. Three things changed when this page stopped being a
 * document with a map in it and became a map:
 *
 *   1. A released drag GLIDES. Direct manipulation stays 1:1 while a finger
 *      or a cursor is down — anything else is a lie about where the map is —
 *      and the moment it lifts, the momentum the hand actually had carries
 *      the view and decays. That is the single difference between "a diagram
 *      that responds to input" and "a place you are moving through".
 *   2. Zoom is EASED toward a target rather than jumped. The wheel, the
 *      buttons and the keys all write a target; the rendered state chases it
 *      on a curve. The point under the cursor is held fixed against the
 *      target, so it is still zoom-to-point.
 *   3. There are BOUNDS. The old clamp was on scale only, so a hard flick
 *      could throw the whole city off screen and leave a visitor looking at
 *      an empty sky with no way back except the Reset button.
 *
 * `prefers-reduced-motion` turns off 1 and 2 entirely: target and state are
 * the same object's worth of numbers, applied on the spot. Every control
 * still works and the map still goes everywhere it went before.
 */
export function attachCamera(svg, camera, { onReset, onZoom, reduced = false } = {}) {
  const state = { x: 0, y: 0, k: 1 };
  const target = { x: 0, y: 0, k: 1 };
  const MIN_K = 0.55;
  const MAX_K = 3.4;
  const EASE = 0.24;
  const FRICTION = 0.90;
  const MIN_GLIDE = 0.12;

  let dragging = false;
  let last = null;
  let raf = 0;
  let gliding = false;
  const vel = { x: 0, y: 0 };

  // The rectangle the camera is not allowed to lose. Set by the app once the
  // scene and its frame exist; until then the clamp is simply inert.
  let limitBox = null;
  let limitFrame = null;

  function apply() {
    camera.setAttribute('transform', `translate(${r(state.x)} ${r(state.y)}) scale(${r(state.k)})`);
    if (onZoom) onZoom(state.k, state);
  }
  const r = (n) => Math.round(n * 1000) / 1000;

  /** Keep at least a third of the shortest frame axis worth of city on screen. */
  function clampTarget() {
    if (!limitBox || !limitFrame) return;
    const f = limitFrame;
    const m = Math.min(f.w, f.h) * 0.34;
    for (const [axis, lo, size, flo, fsize] of [
      ['x', limitBox.x, limitBox.w, f.x, f.w],
      ['y', limitBox.y, limitBox.h, f.y, f.h],
    ]) {
      const min = flo + m - target.k * (lo + size);
      const max = flo + fsize - m - target.k * lo;
      target[axis] = min > max
        ? (min + max) / 2
        : Math.min(max, Math.max(min, target[axis]));
    }
  }

  function step() {
    raf = 0;
    let busy = false;
    if (gliding) {
      target.x += vel.x;
      target.y += vel.y;
      vel.x *= FRICTION;
      vel.y *= FRICTION;
      clampTarget();
      if (Math.hypot(vel.x, vel.y) < MIN_GLIDE) gliding = false;
      busy = true;
    }
    const dx = target.x - state.x;
    const dy = target.y - state.y;
    const dk = target.k - state.k;
    if (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.04 && Math.abs(dk) < 0.0004) {
      state.x = target.x; state.y = target.y; state.k = target.k;
    } else {
      state.x += dx * EASE;
      state.y += dy * EASE;
      state.k += dk * EASE;
      busy = true;
    }
    apply();
    if (busy) raf = requestAnimationFrame(step);
  }

  function run() {
    if (reduced) {
      gliding = false;
      state.x = target.x; state.y = target.y; state.k = target.k;
      apply();
      return;
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function stopMotion() {
    gliding = false;
    vel.x = 0; vel.y = 0;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  /** Local (viewBox) coordinates of a client point. */
  function toLocal(cx, cy) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform(ctm.inverse());
  }

  function zoomAt(factor, cx, cy) {
    const k = Math.min(MAX_K, Math.max(MIN_K, target.k * factor));
    if (k === target.k) return;
    const local = toLocal(cx, cy);
    if (!local) return;
    // Hold the point under the cursor fixed against the TARGET, so a run of
    // wheel ticks compounds toward the same place rather than drifting.
    target.x = local.x - ((local.x - target.x) / target.k) * k;
    target.y = local.y - ((local.y - target.y) / target.k) * k;
    target.k = k;
    gliding = false;
    clampTarget();
    run();
  }

  const PINCH_DEADZONE = 8;
  const touches = new Map();
  let pinch = null;
  let dragPointerId = null;
  const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // A press is not yet a drag.
  //
  // This used to call `setPointerCapture` on every pointerdown, which is the
  // conventional way to keep a pan alive when the cursor leaves the element —
  // and it silently broke the core verb of the whole page. With the pointer
  // captured by the <svg>, the compatibility click event retargets to the
  // capture element, so a real mouse click on a building was delivered to the
  // map root and the citizen's own click handler never ran. So capture is
  // deferred until the pointer has actually travelled.
  const DRAG_SLOP = 4; // CSS px
  let press = null;

  const endDrag = (ev) => {
    dragging = false;
    last = null;
    press = null;
    svg.classList.remove('grabbing');
    const id = ev && ev.pointerId != null ? ev.pointerId : dragPointerId;
    if (id != null && svg.hasPointerCapture?.(id)) svg.releasePointerCapture(id);
    dragPointerId = null;
  };

  svg.addEventListener('pointerdown', (ev) => {
    stopMotion();
    if (ev.pointerType === 'touch') {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()];
        const d = gap(a, b);
        pinch = { start: d, last: d, active: false };
        endDrag(null); // a second finger ends the pan rather than fighting it
        return;
      }
    }
    if (ev.button !== 0 || pinch) return;
    press = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
  });

  svg.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch' && touches.has(ev.pointerId)) {
      touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }
    if (press && !dragging && !pinch && ev.pointerId === press.id
      && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) >= DRAG_SLOP) {
      dragging = true;
      last = { x: press.x, y: press.y, t: press.t };
      dragPointerId = press.id;
      vel.x = 0; vel.y = 0;
      svg.classList.add('grabbing');
      svg.setPointerCapture(press.id);
    }
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = gap(a, b);
      if (!pinch.active) {
        if (Math.abs(d - pinch.start) >= PINCH_DEADZONE) pinch.active = true;
        pinch.last = d;
        return;
      }
      if (pinch.last > 0 && d > 0) {
        const c = midpoint(a, b);
        zoomAt(d / pinch.last, c.x, c.y);
      }
      pinch.last = d;
      return;
    }
    if (!dragging || !last) return;
    const ctm = svg.getScreenCTM();
    const scale = ctm ? 1 / ctm.a : 1;
    const dx = (ev.clientX - last.x) * scale;
    const dy = (ev.clientY - last.y) * scale;
    // Direct manipulation is 1:1 and never eased: the map goes where the
    // hand goes, and the momentum is only read off for what happens after.
    target.x += dx;
    target.y += dy;
    clampTarget();
    state.x = target.x;
    state.y = target.y;
    const dt = Math.max(1, ev.timeStamp - last.t);
    // A short exponential average, so one stuttered sample cannot fling the
    // camera and a steady drag still lands its real speed.
    vel.x = vel.x * 0.6 + (dx / dt) * 16 * 0.4;
    vel.y = vel.y * 0.6 + (dy / dt) * 16 * 0.4;
    last = { x: ev.clientX, y: ev.clientY, t: ev.timeStamp };
    apply();
  });

  const liftPointer = (ev) => {
    const wasDragging = dragging;
    if (ev.pointerType === 'touch') {
      touches.delete(ev.pointerId);
      if (touches.size < 2) pinch = null;
    }
    endDrag(ev);
    if (wasDragging && !reduced && Math.hypot(vel.x, vel.y) >= MIN_GLIDE) {
      gliding = true;
      run();
    }
  };
  svg.addEventListener('pointerup', liftPointer);
  svg.addEventListener('pointercancel', liftPointer);

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    // One curve for a mouse notch and a trackpad swipe alike, clamped so a
    // high-resolution device cannot take four octaves of zoom in one gesture.
    const f = Math.min(1.35, Math.max(1 / 1.35, Math.exp(-ev.deltaY * 0.0022)));
    zoomAt(f, ev.clientX, ev.clientY);
  }, { passive: false });

  svg.addEventListener('keydown', (ev) => {
    const STEP = 64;
    const pan = { ArrowUp: [0, STEP], ArrowDown: [0, -STEP], ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0] };
    if (pan[ev.key] && ev.target === svg) {
      ev.preventDefault();
      gliding = false;
      target.x += pan[ev.key][0];
      target.y += pan[ev.key][1];
      clampTarget();
      run();
      return;
    }
    const r0 = svg.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    if (ev.key === '+' || ev.key === '=') zoomAt(1.25, cx, cy);
    else if (ev.key === '-' || ev.key === '_') zoomAt(1 / 1.25, cx, cy);
    else if (ev.key === '0') reset();
  });

  function reset() {
    stopMotion();
    target.x = 0; target.y = 0; target.k = 1;
    state.x = 0; state.y = 0; state.k = 1;
    apply();
    if (onReset) onReset();
  }

  /**
   * Ease the camera until a point in the scene's own coordinates sits in the
   * middle of whatever part of the frame is not covered by a drawer.
   *
   * Selecting somebody used to leave the camera exactly where it was, which
   * on a phone regularly meant opening a record for a building that was not
   * on screen. Nothing about the geometry changed; the view now travels to
   * the subject the way it does in every map application, and under reduced
   * motion it arrives in one frame instead of over several.
   */
  function flyTo(px, py, { k = null, offsetX = 0, offsetY = 0 } = {}) {
    if (!limitFrame) return;
    const f = limitFrame;
    if (k != null) target.k = Math.min(MAX_K, Math.max(MIN_K, k));
    gliding = false;
    target.x = f.x + f.w / 2 + offsetX - target.k * px;
    target.y = f.y + f.h / 2 + offsetY - target.k * py;
    clampTarget();
    run();
  }

  apply();
  return {
    reset,
    flyTo,
    setLimits(box, frame) { limitBox = box; limitFrame = frame; },
    zoomIn: () => { const b = svg.getBoundingClientRect(); zoomAt(1.3, b.left + b.width / 2, b.top + b.height / 2); },
    zoomOut: () => { const b = svg.getBoundingClientRect(); zoomAt(1 / 1.3, b.left + b.width / 2, b.top + b.height / 2); },
    get k() { return state.k; },
    get targetK() { return target.k; },
  };
}
