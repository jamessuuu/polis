/**
 * Drawing the city.
 *
 * Everything here renders the plan `layout.mjs` computed; nothing here
 * decides where anything goes. That split is deliberate — the plan is pure
 * and tested, the view is DOM and is not, so as little judgement as possible
 * lives on this side of the line.
 *
 * Why isometric at all: the previous map was a node-link diagram, and a
 * node-link diagram is a chart. You read a chart; you do not look around it.
 * The projection, the extruded solids and the fixed light direction exist to
 * make the ecosystem something you explore rather than parse, because the
 * point of this whole project is that a society of 59 agents is easier to
 * hold in your head as a place than as an adjacency list.
 *
 * What is NOT here, on purpose: decorative buildings, filler scenery, fake
 * citizens, trees, vehicles. Every solid on this map is one record in
 * ecosystem.json. A city that draws things which do not exist would be a
 * prettier lie, and the entire premise is that the map is generated from
 * ground truth.
 */

import { boxFaces, plotPolygon, tilePolygon, toScreen, depthOf, screenBounds, TILE_H } from './iso.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function hueClassFor(item) {
  if (item.kind === 'skill') return 'hue-skill';
  if (item.number) return `hue-${item.number}`;
  if (item.guild) return 'hue-guild';
  if (item.system) return 'hue-system';
  return 'hue-none';
}

function plotHueClass(plot) {
  if (plot.kind === 'district') return `hue-${plot.number}`;
  if (plot.kind === 'guild') return 'hue-guild';
  if (plot.kind === 'archive') return 'hue-skill';
  return 'hue-none';
}

/**
 * A citizen, drawn as a small figure standing outside their building.
 *
 * Three shapes is the fewest that still reads as a person at this size: a
 * ground shadow to plant them, a body, a head. More detail than that is
 * invisible at 12px and costs a DOM node per citizen per element.
 */
function figure(x, y, cls, delay) {
  const g = s('g', { class: `figure ${cls}`, transform: `translate(${x} ${y})` });
  if (delay) g.style.setProperty('--bob-delay', `${delay}ms`);
  g.appendChild(s('ellipse', { class: 'fig-shadow', cx: 0, cy: 1, rx: 4.2, ry: 1.9 }));
  const body = s('path', { class: 'fig-body', d: 'M -2.6 0 C -2.6 -5.2 2.6 -5.2 2.6 0 Z' });
  g.appendChild(body);
  g.appendChild(s('circle', { class: 'fig-head', cx: 0, cy: -6.6, r: 2.3 }));
  return g;
}

/**
 * Where every precinct label goes, decided before anything is drawn.
 *
 * Centred above each precinct's north corner, then lifted in fixed 40px steps
 * until it clears every label already placed. Placement order is back-to-front
 * with ties broken on the plot key, so the result is identical on every run.
 *
 * Widths are ESTIMATED rather than measured. Measuring would mean rendering
 * each label, reading getBBox, and re-laying out — three forced reflows per
 * precinct on every draw, to buy precision that a generous estimate already
 * covers. Over-estimating spreads labels slightly further apart; under-
 * estimating produces the overlap this function exists to remove.
 */
const TITLE_PX = 27;
const SUB_PX = 18;

function placeLabels(city) {
  const wanted = [...city.plots.values()]
    .map((plot) => {
      const centre = toScreen(plot.col + plot.cols / 2, plot.row + plot.rows / 2);
      const north = toScreen(plot.col, plot.row);
      const title = plot.label;
      const sub = plot.sub || `${plot.count} ${plot.count === 1 ? 'member' : 'members'}`;
      // 0.56em per char for the serif title, 0.62em for the monospace sub.
      const width = Math.max(title.length * TITLE_PX * 0.56, sub.length * SUB_PX * 0.62);
      return {
        key: plot.key,
        cls: plotHueClass(plot),
        title,
        sub,
        x: centre.x,
        y: north.y - 18,
        // Where the label belongs, kept so a displaced one can point home.
        anchorX: centre.x,
        anchorY: north.y - 6,
        w: width + 26,
        h: 78,
        depth: depthOf(plot.col, plot.row),
      };
    })
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));

  const placed = [];
  const hits = (a, b) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  for (const label of wanted) {
    let tries = 0;
    while (tries < 26 && placed.some((p) => hits(label, p))) {
      label.y -= 30;
      tries += 1;
    }
    label.displaced = label.anchorY - label.y > 46;
    placed.push(label);
  }
  return placed;
}

export function renderCity({ svg, data, city, onSelect }) {
  svg.textContent = '';

  const b = screenBounds(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow);
  const PAD = 90;
  // Buildings and walls stand above their tile, and a collision-displaced
  // label can be lifted further still. This is sized for the resolver's
  // worst case rather than for the common one, because the failure mode is
  // a label silently leaving the canvas.
  const TOP_ROOM = 300;
  const view = {
    x: b.minX - PAD,
    y: b.minY - TOP_ROOM,
    w: b.maxX - b.minX + PAD * 2,
    h: b.maxY - b.minY + TOP_ROOM + PAD,
  };
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // ---- defs ------------------------------------------------------------
  const defs = s('defs');
  const grad = s('linearGradient', { id: 'ground-sheen', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.appendChild(s('stop', { offset: '0', 'stop-color': 'var(--ground-top)' }));
  grad.appendChild(s('stop', { offset: '1', 'stop-color': 'var(--ground-bottom)' }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // The camera. Pan and zoom move this one node, so nothing else has to know
  // the viewport exists.
  const camera = s('g', { class: 'camera' });
  svg.appendChild(camera);

  // ---- ground ----------------------------------------------------------
  const groundLayer = s('g', { class: 'ground-layer' });
  groundLayer.appendChild(s('polygon', {
    class: 'ground-plane',
    points: plotPolygon(city.bounds.minCol, city.bounds.minRow,
      city.bounds.maxCol - city.bounds.minCol, city.bounds.maxRow - city.bounds.minRow),
    fill: 'url(#ground-sheen)',
  }));
  camera.appendChild(groundLayer);

  // ---- the wall --------------------------------------------------------
  // Only the two BACK edges are drawn. The front two would stand between the
  // camera and the districts and hide exactly what the map is for. A wall you
  // cannot see over is accurate and useless.
  const wallLayer = s('g', { class: 'wall-layer' });
  const w = city.wall;
  const WALL_H = 26;
  for (const [c0, r0, c1, r1] of [
    [w.col, w.row, w.col + w.cols, w.row],
    [w.col, w.row, w.col, w.row + w.rows],
  ]) {
    const a = toScreen(c0, r0);
    const z = toScreen(c1, r1);
    wallLayer.appendChild(s('polygon', {
      class: 'wall-face',
      points: `${a.x},${a.y - WALL_H} ${z.x},${z.y - WALL_H} ${z.x},${z.y} ${a.x},${a.y}`,
    }));
    wallLayer.appendChild(s('line', {
      class: 'wall-cap', x1: a.x, y1: a.y - WALL_H, x2: z.x, y2: z.y - WALL_H,
    }));
  }
  camera.appendChild(wallLayer);

  // ---- precinct ground -------------------------------------------------
  const plotLayer = s('g', { class: 'plot-layer' });
  const labelLayer = s('g', { class: 'plot-label-layer' });
  for (const plot of city.plots.values()) {
    const cls = plotHueClass(plot);
    plotLayer.appendChild(s('polygon', {
      class: `plot-ground ${cls} kind-${plot.kind}`,
      points: plotPolygon(plot.col, plot.row, plot.cols, plot.rows),
    }));
    plotLayer.appendChild(s('polygon', {
      class: `plot-inner ${cls}`,
      points: plotPolygon(plot.col + 0.55, plot.row + 0.55, plot.cols - 1.1, plot.rows - 1.1),
    }));
  }
  camera.appendChild(plotLayer);

  for (const label of placeLabels(city)) {
    if (label.displaced) {
      labelLayer.appendChild(s('line', {
        class: `label-leader ${label.cls}`,
        x1: label.x, y1: label.y + 8, x2: label.anchorX, y2: label.anchorY,
      }));
    }
    const g = s('g', {
      class: `plot-label ${label.cls}`,
      transform: `translate(${label.x} ${label.y})`,
    });
    const t1 = s('text', { class: 'plot-label-title', x: 0, y: 0, 'text-anchor': 'middle' });
    t1.textContent = label.title;
    const t2 = s('text', { class: 'plot-label-sub', x: 0, y: 22, 'text-anchor': 'middle' });
    t2.textContent = label.sub;
    g.appendChild(t1);
    g.appendChild(t2);
    labelLayer.appendChild(g);
  }

  // ---- roads -----------------------------------------------------------
  // 113 edges drawn at once is a hairball that tells you nothing. They are
  // present but quiet, and light up for whoever you are looking at. The
  // toggle in the toolbar shows all of them for anyone who wants the
  // hairball, which is a legitimate thing to want occasionally.
  const roadLayer = s('g', { class: 'road-layer' });
  const roadEls = [];
  for (const e of data.edges) {
    const from = city.positions.get(e.from);
    const to = city.positions.get(e.to);
    if (!from || !to) continue;
    const a = toScreen(from.col + 0.5, from.row + 0.5);
    const z = toScreen(to.col + 0.5, to.row + 0.5);
    // A slight arc, bowed away from the viewer, so two roads between nearby
    // precincts stay distinguishable instead of overprinting.
    const mx = (a.x + z.x) / 2;
    const my = (a.y + z.y) / 2 - Math.hypot(z.x - a.x, z.y - a.y) * 0.12;
    const path = s('path', { class: 'road', d: `M ${a.x} ${a.y} Q ${mx} ${my} ${z.x} ${z.y}` });
    path.dataset.from = e.from;
    path.dataset.to = e.to;
    roadLayer.appendChild(path);
    roadEls.push(path);
  }
  camera.appendChild(roadLayer);

  // ---- buildings -------------------------------------------------------
  // Painter's algorithm: ascending (col + row) is exactly back-to-front in
  // this projection, and SVG paints in document order, so sorting the append
  // order is the whole of the depth handling.
  const buildLayer = s('g', { class: 'building-layer' });
  const citizenEls = new Map();
  const ordered = [...city.buildings].sort(
    (p, q) => depthOf(p.col, p.row) - depthOf(q.col, q.row) || p.id.localeCompare(q.id),
  );

  ordered.forEach((item, idx) => {
    const faces = boxFaces(item.col, item.row, item.height, item.kind === 'skill' ? 0.62 : 0.72);
    const cls = ['structure', `kind-${item.kind}`, hueClassFor(item)];
    if (item.director) cls.push('is-director');
    if (item.unreachable) cls.push('is-ruin');

    const g = s('g', {
      class: cls.join(' '),
      tabindex: '0',
      role: 'button',
      'aria-label': ariaLabel(item, data),
    });
    g.dataset.id = item.id;
    g.dataset.kind = item.kind;

    g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
    g.appendChild(s('polygon', { class: 'face face-right', points: faces.right }));
    g.appendChild(s('polygon', { class: 'face face-top', points: faces.top }));

    // A director flies a banner. It is the only ornament on the map and it
    // marks a real frontmatter flag, not a mood.
    if (item.director) {
      const p = faces.apex;
      g.appendChild(s('line', { class: 'banner-pole', x1: p.x, y1: p.y, x2: p.x, y2: p.y - 16 }));
      g.appendChild(s('polygon', { class: 'banner-flag', points: `${p.x},${p.y - 16} ${p.x + 11},${p.y - 12.5} ${p.x},${p.y - 9}` }));
    }

    // A citizen no one names has nothing standing on their plot and no one
    // living there. That is the finding, drawn.
    if (item.kind === 'citizen' && !item.unreachable) {
      g.appendChild(figure(faces.base.x, faces.base.y + 3, hueClassFor(item), (idx % 11) * 260));
    }

    if (item.kind === 'citizen') {
      g.addEventListener('click', () => onSelect(item.id));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(item.id); }
      });
      citizenEls.set(item.id, g);
    } else {
      g.setAttribute('tabindex', '-1');
      g.setAttribute('role', 'img');
    }

    const title = s('title');
    title.textContent = tooltipFor(item, data);
    g.appendChild(title);

    buildLayer.appendChild(g);
  });
  camera.appendChild(buildLayer);
  camera.appendChild(labelLayer);

  return { camera, citizenEls, roadEls, view };
}

function ariaLabel(item, data) {
  if (item.kind === 'skill') return `${item.id}, a skill in the Archive`;
  const bits = [item.id];
  if (item.director) bits.push('Director');
  if (item.division) bits.push(`of ${item.division}`);
  else if (item.guild) bits.push(`of the ${item.guild}`);
  else if (item.system) bits.push('a system utility, no division');
  else bits.push('no division declared');
  if (item.unreachable) bits.push('unreachable: named by no one upstream or downstream');
  bits.push(`connected to ${item.degree} other ${item.degree === 1 ? 'citizen' : 'citizens'}`);
  return bits.join(', ');
}

function tooltipFor(item, data) {
  if (item.kind === 'skill') {
    const sk = (data.skills || []).find((x) => x.id === item.id);
    return sk && sk.description ? `${item.id} — ${sk.description.slice(0, 160)}` : item.id;
  }
  const parts = [item.id];
  if (item.unreachable) parts.push('— unreachable, named by no one');
  else parts.push(`— ${item.degree} connection${item.degree === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * Pan and zoom, on the camera group only.
 *
 * Drag to pan, wheel to zoom, arrow keys to pan and +/- to zoom for anyone
 * not using a mouse. Zoom is clamped so the city cannot be lost off-screen,
 * which is the failure that makes a pannable map feel broken.
 */
export function attachCamera(svg, camera, { onReset } = {}) {
  const state = { x: 0, y: 0, k: 1 };
  const MIN_K = 0.55;
  const MAX_K = 3.4;
  let dragging = false;
  let last = null;

  function apply() {
    camera.setAttribute('transform', `translate(${state.x} ${state.y}) scale(${state.k})`);
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
  return { reset, zoomIn: () => { const r = svg.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); }, zoomOut: () => { const r = svg.getBoundingClientRect(); zoomAt(1 / 1.25, r.left + r.width / 2, r.top + r.height / 2); } };
}
