/**
 * Life: everything that moves, and why.
 *
 * Every moving thing on the map maps to a record. ENTITIES are data — a
 * walker is a real collaboration pair from `data/workforce.json`, a lit
 * window is a real dispatch inside the telemetry window, a working pose is a
 * real `active` flag. ENVIRONMENT is craft. This module is the data half:
 * pure functions that decide WHO walks, WHERE the streets run, and WHAT a
 * citizen's kit is, so all of it can be tested without a browser.
 */

import { toScreen, doorPoint, variantOf } from './iso.mjs';

// ------------------------------------------------------------- activity ---

export const RECENT_DAYS = 30;

/**
 * Idle / recent / active / dormant, per CHARACTERS.md §5 — against the
 * snapshot's own clock, never the wall clock, because the page is static and
 * "active" means "active when the telemetry was read".
 *
 * @param {object|undefined} rec the workforce record for one agent
 * @param {string} generatedAt ISO timestamp the telemetry was generated
 */
export function activityOf(rec, generatedAt) {
  if (!rec) return 'dormant';
  if (rec.active) return 'active';
  const last = Date.parse(rec.lastAt || '');
  const gen = Date.parse(generatedAt || '');
  if (Number.isFinite(last) && Number.isFinite(gen) && gen - last <= RECENT_DAYS * 864e5) return 'recent';
  return 'idle';
}

// ---------------------------------------------------------------- kit ---

/**
 * The three capability axes that survive the discard of Read/Glob/Grep
 * (granted to 59/59, so they carry no information). CHARACTERS.md §1.
 */
export function capabilityOf(tools = []) {
  const M = tools.includes('Write') || tools.includes('Edit');
  const R = tools.includes('Bash');
  const S = tools.includes('WebSearch') || tools.includes('WebFetch');
  const order = [['M', M], ['R', R], ['S', S]].filter(([, on]) => on).map(([k]) => k);
  return {
    M, R, S,
    combo: `${M ? 'M' : '-'}${R ? 'R' : '-'}${S ? 'S' : '-'}`,
    primary: order[0] || null,
    secondary: order.slice(1),
  };
}

/** Roof form from `tools`: a workshop (can Write/Edit) is gabled, a reading room is flat. */
export function roofOf(tools = []) {
  return capabilityOf(tools).M ? 'gable' : 'flat';
}

export const STOREY_H = 10.2;
export function storeysOf(height) {
  return Math.max(0, Math.floor(height / STOREY_H));
}

/** Footprint width from the declared model. Absence has its own value. */
const FOOTPRINT = { opus: 0.78, sonnet: 0.72, haiku: 0.64 };
export function footprintOf(item) {
  if (item.kind === 'skill') return 0.62;
  return FOOTPRINT[item.model] || 0.70;
}

/**
 * Insignia: the non-colour carrier of precinct identity, by division index.
 * Guilds get a ring with a notch whose angle is a stable hash of the name.
 */
const INSIGNIA = ['bar', 'circle', 'triangle', 'chevron', 'diamond', 'double-bar', 'cross', 'square'];
export function insigniaOf(item) {
  if (item.number != null && INSIGNIA[Number(item.number)]) {
    return { kind: INSIGNIA[Number(item.number)], notch: null };
  }
  if (item.guild) return { kind: 'ring', notch: variantOf(item.guild, 6) * 60 };
  return { kind: 'none', notch: null };
}

// ------------------------------------------------------------- walkers ---

/**
 * Which pairs get to walk.
 *
 * Only pairs where BOTH ends are citizens with a building on this map.
 * `general-purpose` is not a roster member (it is the generic builder) and a
 * system utility is not a person, so neither walks. Ordered by sessions
 * together, then by name, so the busiest partnerships walk first and the
 * order is identical on every load.
 */
export function walkerPairs(collaborations = [], buildingsById = new Map(), agentsById = new Map()) {
  const ok = (id) => {
    const b = buildingsById.get(id);
    const a = agentsById.get(id);
    return Boolean(b && b.kind === 'citizen' && !(a && a.system));
  };
  return collaborations
    .filter((c) => c.a !== c.b && ok(c.a) && ok(c.b))
    .map((c) => ({ a: c.a, b: c.b, sessions: c.sessions }))
    .sort((x, y) => y.sessions - x.sessions || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/**
 * Slot s walks pairs s, s+cap, s+2cap, ... forever. Deterministic, and the
 * whole roster of partnerships gets seen instead of the top twelve on loop.
 */
export function pairForSlot(slot, cycle, pairCount, cap) {
  if (!pairCount) return -1;
  return (slot + cycle * cap) % pairCount;
}

/** Stagger, in ms, so twelve walkers do not all step off at once. */
export function slotDelay(slot, stepMs = 1400) {
  return slot * stepMs;
}

// ------------------------------------------------------------- streets ---

/**
 * A routing grid over the city's tile corners.
 *
 * Nodes are the integer tile corners (col, row) inside the bounds. A building
 * never covers a corner (every footprint is inset), so nothing is blocked by
 * a building — but a corner touching buildings costs more, which keeps
 * walkers on the streets and out of the alleys unless the door is there.
 * The wall's two back edges are blocked except at their gates; the two front
 * edges are a kerb anyone can step over.
 */
export function buildRoutingGrid(city) {
  const { bounds, wall, buildings } = city;
  const minCol = bounds.minCol;
  const minRow = bounds.minRow;
  const cols = bounds.maxCol - bounds.minCol + 1;
  const rows = bounds.maxRow - bounds.minRow + 1;
  const n = cols * rows;
  const cost = new Float32Array(n).fill(1);
  const blocked = new Uint8Array(n);
  const idx = (c, r) => (r - minRow) * cols + (c - minCol);
  const inside = (c, r) => c >= minCol && c < minCol + cols && r >= minRow && r < minRow + rows;

  for (const b of buildings) {
    if (b.unreachable) continue; // an empty lot is walkable ground
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const c = b.col + dc;
      const r = b.row + dr;
      if (inside(c, r)) cost[idx(c, r)] += 0.75;
    }
  }

  const gates = gatesOf(wall);
  for (let c = wall.col; c <= wall.col + wall.cols; c++) {
    if (inside(c, wall.row) && c !== gates.north.col) blocked[idx(c, wall.row)] = 1;
  }
  for (let r = wall.row; r <= wall.row + wall.rows; r++) {
    if (inside(wall.col, r) && r !== gates.west.row) blocked[idx(wall.col, r)] = 1;
  }

  return { minCol, minRow, cols, rows, cost, blocked, idx, inside, gates };
}

/** Where the gates in the two back walls are: the midpoint of each edge. */
export function gatesOf(wall) {
  return {
    north: { col: wall.col + Math.floor(wall.cols / 2), row: wall.row },
    west: { col: wall.col, row: wall.row + Math.floor(wall.rows / 2) },
  };
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const TURN_COST = 0.9;

class Heap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * Single-source shortest paths over (node, heading), with a turn penalty so
 * routes are long straight runs like streets rather than staircases.
 * Deterministic: neighbour order is fixed and ties break on insertion.
 */
function solveFrom(grid, src) {
  const N = grid.cols * grid.rows;
  const dist = new Float64Array(N * 4).fill(Infinity);
  const prev = new Int32Array(N * 4).fill(-1);
  const heap = new Heap();
  for (let d = 0; d < 4; d++) {
    dist[src * 4 + d] = 0;
    heap.push(0, src * 4 + d);
  }
  while (heap.size) {
    const [k, state] = heap.pop();
    if (k > dist[state]) continue;
    const node = state >> 2;
    const dir = state & 3;
    const c = (node % grid.cols) + grid.minCol;
    const r = Math.floor(node / grid.cols) + grid.minRow;
    for (let nd = 0; nd < 4; nd++) {
      const nc = c + DIRS[nd][0];
      const nr = r + DIRS[nd][1];
      if (!grid.inside(nc, nr)) continue;
      const nn = grid.idx(nc, nr);
      if (grid.blocked[nn]) continue;
      const step = grid.cost[nn] + (nd === dir ? 0 : TURN_COST);
      const ns = nn * 4 + nd;
      const nk = k + step;
      if (nk < dist[ns]) {
        dist[ns] = nk;
        prev[ns] = state;
        heap.push(nk, ns);
      }
    }
  }
  return { dist, prev };
}

/**
 * A router with a per-source cache. `route(a, b)` returns tile-corner nodes
 * from a to b inclusive, collinear intermediates removed, or null if b is
 * unreachable (only possible if a wall edge fully encloses it).
 */
export function createRouter(grid) {
  const cache = new Map();
  function solved(src) {
    if (!cache.has(src)) cache.set(src, solveFrom(grid, src));
    return cache.get(src);
  }
  function route(a, b) {
    const src = grid.idx(a.col, a.row);
    const dst = grid.idx(b.col, b.row);
    if (grid.blocked[src] || grid.blocked[dst]) return null;
    const { dist, prev } = solved(src);
    let best = -1;
    for (let d = 0; d < 4; d++) {
      const s = dst * 4 + d;
      if (dist[s] < Infinity && (best < 0 || dist[s] < dist[best])) best = s;
    }
    if (best < 0) return null;
    const nodes = [];
    for (let s = best; s >= 0; s = prev[s]) {
      const node = s >> 2;
      const c = (node % grid.cols) + grid.minCol;
      const r = Math.floor(node / grid.cols) + grid.minRow;
      if (!nodes.length || nodes[nodes.length - 1].col !== c || nodes[nodes.length - 1].row !== r) {
        nodes.push({ col: c, row: r });
      }
      if (node === src) break;
    }
    nodes.reverse();
    return simplify(nodes);
  }
  return { route };
}

function simplify(nodes) {
  if (nodes.length < 3) return nodes;
  const out = [nodes[0]];
  for (let i = 1; i < nodes.length - 1; i++) {
    const a = out[out.length - 1];
    const b = nodes[i];
    const c = nodes[i + 1];
    const collinear = (b.col - a.col) * (c.row - b.row) === (b.row - a.row) * (c.col - b.col);
    if (!collinear) out.push(b);
  }
  out.push(nodes[nodes.length - 1]);
  return out;
}

/** The corner node a building's door opens onto: its south corner. */
export function doorNode(b) {
  return { col: b.col + 1, row: b.row + 1 };
}

/**
 * A walk from A's door to B's door, in tile space: door, corner, streets,
 * corner, door. Null when no street connects them.
 */
export function walkBetween(router, a, b, footprintA, footprintB) {
  const nodes = router.route(doorNode(a), doorNode(b));
  if (!nodes) return null;
  const da = doorPoint(a.col, a.row, footprintA).tile;
  const db = doorPoint(b.col, b.row, footprintB).tile;
  return [da, ...nodes, db];
}

/** Tile-space polyline -> screen-space path data plus cumulative lengths for JS-driven motion. */
export function screenPath(points) {
  const pts = points.map((p) => toScreen(p.col, p.row));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const d = 'M ' + pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(' L ');
  return { d, pts, cum, length: cum[cum.length - 1], tiles: points };
}
const r2 = (n) => Math.round(n * 100) / 100;

/** Position along a screenPath at distance s, plus the tile-space depth there. */
export function pointAlong(path, s) {
  const { pts, cum, tiles } = path;
  if (s <= 0) return { x: pts[0].x, y: pts[0].y, depth: tiles[0].col + tiles[0].row };
  if (s >= path.length) {
    const last = pts.length - 1;
    return { x: pts[last].x, y: pts[last].y, depth: tiles[last].col + tiles[last].row };
  }
  let i = 1;
  while (cum[i] < s) i++;
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = pts[i - 1];
  const b = pts[i];
  const ta = tiles[i - 1];
  const tb = tiles[i];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    depth: (ta.col + ta.row) + ((tb.col + tb.row) - (ta.col + ta.row)) * t,
  };
}

/** Walk timing: out, pause, back, in ms, from screen length. */
export const WALK_SPEED = 52; // user units per second
export const WALK_PAUSE_MS = 2600;
export function walkTiming(length) {
  const leg = Math.max(2500, (length / WALK_SPEED) * 1000);
  return { leg, pause: WALK_PAUSE_MS, total: leg * 2 + WALK_PAUSE_MS };
}

/** Where a walker is at time t (ms since start): distance along the path and whether it is pausing. */
export function walkProgress(timing, t) {
  if (t <= timing.leg) return { s: t / timing.leg, pausing: false, returning: false };
  if (t <= timing.leg + timing.pause) return { s: 1, pausing: true, returning: false };
  const back = t - timing.leg - timing.pause;
  return { s: Math.max(0, 1 - back / timing.leg), pausing: false, returning: true };
}
