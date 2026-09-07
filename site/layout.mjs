/**
 * The city plan.
 *
 * This replaced a force-directed layout on 2026-09-06, and the reason is
 * worth keeping: the physics version could not promise the one thing a map
 * has to promise, which is that two districts do not sit on top of each
 * other. It settled to *a* configuration, not to a correct one, and the only
 * way to know whether a given snapshot produced overlapping blobs or
 * unreadable label pile-ups was to look. A layout you have to eyeball is a
 * layout with no gate on it.
 *
 * So the plan is now allocated, not simulated:
 *
 *   1. Every district gets a rectangular PLOT sized to hold its citizens,
 *      plus a one-tile sidewalk on each side.
 *   2. "00 Cabinet" is placed first, centred on the origin. It is the
 *      ecosystem's router — chief-of-staff hands work to and takes it from
 *      most of the map — so the busiest square is the honest centre.
 *   3. Every other constitutional district is placed by spiral search
 *      outward from the centre, biased toward a preferred compass bearing
 *      so the eight districts still read as a ring. Placement order is
 *      descending citizen count, so the largest districts get the addresses
 *      nearest the plaza.
 *   4. A wall is drawn around the constitutional districts. What sits
 *      outside it is outside it for a reason: citizens with no division
 *      declared, and system utilities that ship with Claude Code and are
 *      exempt from the admission standard. The metaphor is load-bearing —
 *      being outside the wall is a real status, not a decorative choice.
 *   5. Skills get their own precinct, the Archive. They are procedures any
 *      citizen can invoke rather than members of a division, so they are
 *      drawn as a dense block of workshops rather than as houses.
 *
 * Every candidate position is collision-tested against everything already
 * placed, so non-overlap is a property of the algorithm rather than a hope.
 * `tests/layout.test.mjs` asserts it anyway, because a property nobody
 * checks is a property that quietly stops holding.
 *
 * Nothing here is random. Same snapshot in, same city out, on every machine
 * and every reload — which is what makes the committed HTML diffable.
 */

import { TILE_W, TILE_H } from './iso.mjs';

const STREET = 1; // tiles of clear space between neighbouring plots
const SIDEWALK = 1; // tiles of clear space inside a plot, before buildings
const WALL_MARGIN = 2; // tiles between the outermost district and the wall

/**
 * Building heights, in user units of extrusion. Height encodes real degree.
 *
 * Raised 2026-09-06 per CHARACTERS.md §2.1: a citizen is 22u tall, and a
 * person as tall as a median building is wrong. The median building is now
 * roughly two storeys beside a one-storey person.
 */
export const HEIGHTS = {
  BASE: 20,
  PER_LINK: 4.2,
  MAX: 110,
  DIRECTOR_BONUS: 12,
  RUIN: 0, // a citizen no one names has nothing built on it — no volume at all
  SKILL: 11,
};
const BASE_HEIGHT = HEIGHTS.BASE;
const HEIGHT_PER_LINK = HEIGHTS.PER_LINK;
const MAX_HEIGHT = HEIGHTS.MAX;
const DIRECTOR_BONUS = HEIGHTS.DIRECTOR_BONUS;
const RUIN_HEIGHT = HEIGHTS.RUIN;
const SKILL_HEIGHT = HEIGHTS.SKILL;

export function divisionKey(d) {
  return `${d.number} ${d.name}`;
}

/** Plot big enough for `count` buildings, plus sidewalks. */
function plotSizeFor(count) {
  const n = Math.max(1, count);
  const contentCols = Math.max(1, Math.ceil(Math.sqrt(n * 1.35)));
  const contentRows = Math.max(1, Math.ceil(n / contentCols));
  return {
    cols: contentCols + SIDEWALK * 2,
    rows: contentRows + SIDEWALK * 2,
    contentCols,
    contentRows,
  };
}

function rectsClash(a, b, gap) {
  return (
    a.col < b.col + b.cols + gap &&
    b.col < a.col + a.cols + gap &&
    a.row < b.row + b.rows + gap &&
    b.row < a.row + a.rows + gap
  );
}

/**
 * Candidate origins for a plot, ordered by how far the plot would sit from
 * the plaza ON SCREEN, with a bias toward a preferred screen bearing.
 *
 * This used to order by Chebyshev ring in TILE space, and that was the single
 * biggest reason the city looked like a thin ribbon. The projection is 2:1:
 * one tile step along (1,-1) moves 64 screen units sideways, one step along
 * (1,1) moves 32 down. So a plan that is round in tile space is drawn as a
 * diamond twice as wide as it is tall, and a ring of guild halls spread at
 * uniform TILE bearings lands with two halls flung far out east and west and
 * nothing above or below them. Measured on the real snapshot: citizens
 * spanned 1472 x 650 screen units, an aspect of 2.26, inside frames whose
 * aspect is 1.6 (laptop) or 0.46 (phone). Fitting 2.26:1 content into a 1.6:1
 * frame can never use more than 71% of it however good the fit is, because
 * the letterbox is arithmetic, not a bug in the fitting.
 *
 * So distance and bearing are both measured in SCREEN units here. The plan
 * that comes out is round where it used to be flat, which is what makes it
 * fill a frame. `preferredAngle` is therefore a screen bearing: -PI/2 is the
 * back of the scene, +PI/2 the front, 0 due right.
 *
 * Ties break on raw coordinates so the order is total and reproducible: same
 * snapshot in, same city out, which is what keeps the built HTML diffable.
 */
const BEARING_BIAS = 1.15; // how much a wrong bearing costs, as a share of distance
/**
 * How much cheaper a sideways step is than a step toward the camera.
 *
 * 1.0 is a city that is round on screen; 2.0 is the old tile-space ordering
 * and the 2.26:1 ribbon it produced. The hero frame this city is composed for
 * is about 2:1, so the plan is deliberately a little wider than round — a
 * poster is composed for its format. Measured aspects of the citizen extent:
 * 1.29 at 1.0, 1.52 across the whole 1.45-1.70 plateau, 2.26 at 2.0. The
 * value sits mid-plateau on purpose: placement is discrete, so an aspect that
 * only appears at one knife-edge value is an aspect the next roster change
 * would lose.
 */
const SPREAD = 1.55;

/** Screen displacement of a tile-space offset, in screen units. */
function screenDelta(dc, dr) {
  return { x: (dc - dr) * (TILE_W / 2), y: (dc + dr) * (TILE_H / 2) };
}

function* spiralCandidates(size, preferredAngle, maxRing = 60) {
  const halfC = Math.floor(size.cols / 2);
  const halfR = Math.floor(size.rows / 2);
  const cells = [];
  for (let dc = -maxRing; dc <= maxRing; dc++) {
    for (let dr = -maxRing; dr <= maxRing; dr++) {
      const s = screenDelta(dc, dr);
      const dist = Math.hypot(s.x / SPREAD, s.y);
      let diff = Math.abs(Math.atan2(s.y, s.x) - preferredAngle) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      // Distance dominates; the bearing decides between equally close spots.
      cells.push({ dc, dr, cost: dist * (1 + BEARING_BIAS * (diff / Math.PI)) });
    }
  }
  cells.sort((a, b) => a.cost - b.cost || a.dc - b.dc || a.dr - b.dr);
  for (const c of cells) {
    yield { col: c.dc - halfC, row: c.dr - halfR };
  }
}

function place(size, preferredAngle, occupied, obstacles = []) {
  for (const origin of spiralCandidates(size, preferredAngle)) {
    const rect = { col: origin.col, row: origin.row, cols: size.cols, rows: size.rows };
    let clash = false;
    for (const o of occupied) {
      if (rectsClash(rect, o, STREET)) { clash = true; break; }
    }
    if (!clash) {
      for (const o of obstacles) {
        if (rectsClash(rect, o, 0)) { clash = true; break; }
      }
    }
    if (!clash) return rect;
  }
  // Unreachable for any realistic ecosystem: the spiral covers a 121x121
  // tile field. Throwing beats returning a silently-overlapping plot.
  throw new Error('city plan: no free plot found within the search field');
}

function heightFor(degree, isDirector, isUnreachable) {
  if (isUnreachable) return RUIN_HEIGHT;
  const h = BASE_HEIGHT + degree * HEIGHT_PER_LINK + (isDirector ? DIRECTOR_BONUS : 0);
  return Math.min(MAX_HEIGHT, Math.round(h * 10) / 10);
}

/** Buildings laid out row-major inside a plot's content area. */
function fillPlot(plot, ids, meta) {
  const out = [];
  ids.forEach((id, i) => {
    const c = i % plot.contentCols;
    const r = Math.floor(i / plot.contentCols);
    out.push({
      id,
      col: plot.col + SIDEWALK + c,
      row: plot.row + SIDEWALK + r,
      ...meta(id),
    });
  });
  return out;
}

/**
 * @param {Array<{number:string,name:string}>} divisions
 * @param {Array<object>} agents
 * @param {Array<{from:string,to:string}>} edges
 * @param {Array<{id:string}>} skills
 * @param {string[]} unreachable
 */
export function computeCity(divisions, agents, edges, skills = [], unreachable = [], guilds = []) {
  const unreachableSet = new Set(unreachable);

  // Degree = how many distinct citizens this one exchanges work with. It is
  // the only number in the snapshot that describes how busy a member is, so
  // it is what building height encodes. Nothing here is invented.
  const neighbours = new Map();
  for (const a of agents) neighbours.set(a.id, new Set());
  for (const e of edges) {
    if (neighbours.has(e.from)) neighbours.get(e.from).add(e.to);
    if (neighbours.has(e.to)) neighbours.get(e.to).add(e.from);
  }
  const degreeOf = (id) => (neighbours.get(id) || new Set()).size;

  const plots = new Map();
  const occupied = [];

  const membersOf = (key) =>
    agents
      .filter((a) => a.division === key)
      .sort((a, b) => Number(b.director) - Number(a.director) || a.id.localeCompare(b.id))
      .map((a) => a.id);

  // --- the plaza ---------------------------------------------------------
  const cabinet = divisions.find((d) => d.number === '00');
  const ringDivisions = divisions.filter((d) => d.number !== '00');

  const buildings = [];

  if (cabinet) {
    const key = divisionKey(cabinet);
    const ids = membersOf(key);
    const size = plotSizeFor(ids.length);
    const rect = { col: -Math.floor(size.cols / 2), row: -Math.floor(size.rows / 2), cols: size.cols, rows: size.rows };
    const plot = { key, label: `${cabinet.number} · ${cabinet.name}`, kind: 'district', number: cabinet.number, ...rect, ...size, count: ids.length };
    plots.set(key, plot);
    occupied.push(rect);
  }

  // --- the ring ----------------------------------------------------------
  // Bearing is assigned by constitutional order so the compass is stable,
  // but placement runs largest-first so the big districts are not exiled to
  // the outskirts by an accident of numbering.
  const bearings = new Map();
  ringDivisions.forEach((d, i) => {
    bearings.set(divisionKey(d), -Math.PI / 2 + (i * 2 * Math.PI) / ringDivisions.length);
  });

  const ringOrder = ringDivisions
    .map((d) => ({ d, key: divisionKey(d), ids: membersOf(divisionKey(d)) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.d.number.localeCompare(b.d.number));

  for (const { d, key, ids } of ringOrder) {
    if (!ids.length) continue;
    const size = plotSizeFor(ids.length);
    const rect = place(size, bearings.get(key), occupied);
    plots.set(key, { key, label: `${d.number} · ${d.name}`, kind: 'district', number: d.number, ...rect, ...size, count: ids.length });
    occupied.push(rect);
  }

  // --- the wall ----------------------------------------------------------
  //
  // The wall encloses the DISTRICTS, and an ecosystem can have none. That is
  // not a broken snapshot: a `.claude` directory with no `ECOSYSTEM.md` has
  // agents and skills and no constitutional divisions at all, which is what
  // most imported ecosystems look like. So the empty case is a real case.
  //
  // It was not handled. `Math.min(...[])` is Infinity and `Math.max(...[])` is
  // -Infinity, so `wall.cols` came out NaN, `bounds` came out NaN, the routing
  // grid was allocated with a NaN length and every road silently failed to
  // route. Found by importing a five-agent tree with no constitution: the map
  // drew a frame full of NaN geometry and not one road, in Chromium and WebKit
  // alike.
  //
  // With nothing to enclose, there is no wall. An empty rectangle at the
  // origin keeps every coordinate finite, blocks no routing cell, and the
  // renderer draws no wall rather than a wall around nothing.
  const districtRects = [...plots.values()];
  const wall = districtRects.length
    ? {
      col: Math.min(...districtRects.map((p) => p.col)) - WALL_MARGIN,
      row: Math.min(...districtRects.map((p) => p.row)) - WALL_MARGIN,
    }
    : { col: 0, row: 0 };
  wall.cols = districtRects.length
    ? Math.max(...districtRects.map((p) => p.col + p.cols)) + WALL_MARGIN - wall.col
    : 0;
  wall.rows = districtRects.length
    ? Math.max(...districtRects.map((p) => p.row + p.rows)) + WALL_MARGIN - wall.row
    : 0;

  // --- outside the wall --------------------------------------------------
  const outside = [];

  // Guild halls. Guilds are real organisational units that ECOSYSTEM.md
  // places at routing levels 3-4 and never lists inside a division, so
  // folding them into "no division declared" would be a lie about their
  // status. They get their own named precincts in a ring beyond the wall —
  // outside the eight districts, which is exactly where the constitution
  // puts them, and visibly still part of the city.
  const skillIds = skills.map((s) => s.id).sort();
  // The Archive is placed FIRST among the precincts outside the wall, before
  // the guild halls, because it is the largest by a wide margin. Placed last it
  // could not find a contiguous 13x10 block behind the city and got pushed to
  // the FRONT of the scene — 86 sheds standing between the camera and the eight
  // districts that are the subject. Biggest claims its ground first.
  if (skillIds.length) outside.push({ key: '__archive__', label: 'The Archive', sub: 'skills any citizen may invoke', kind: 'archive', ids: skillIds, bearing: (-3 * Math.PI) / 4 });

  const guildNames = [...new Set(agents.map((a) => a.guild).filter(Boolean))].sort();
  const orderedGuilds = guilds.length ? guilds.filter((g) => guildNames.includes(g)) : guildNames;
  orderedGuilds.forEach((g, i) => {
    const ids = agents.filter((a) => a.guild === g).map((a) => a.id).sort();
    if (!ids.length) return;
    outside.push({
      key: `__guild__${g}`,
      label: g.replace(/-guild$/, '').replace(/(^|-)(\w)/g, (m, p, c) => (p ? ' ' : '') + c.toUpperCase()) + ' Guild',
      sub: `${ids.length} field ${ids.length === 1 ? 'specialist' : 'specialists'}`,
      kind: 'guild',
      ids,
      // Spread the halls around the wall rather than stacking them on one side.
      bearing: -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, orderedGuilds.length),
    });
  });

  const noDivision = agents.filter((a) => !a.division && !a.system && !a.guild).map((a) => a.id).sort();
  const systemUtilities = agents.filter((a) => a.system).map((a) => a.id).sort();

  // Bearing matters more here than anywhere else on the map. +PI/2 is the
  // FRONT of the scene in this projection, and the Archive is the largest
  // precinct there is — 86 sheds standing between the camera and the eight
  // districts that are the subject. Behind and to the left, it becomes a
  // backdrop instead of an obstruction.
  if (noDivision.length) outside.push({ key: '__nodivision__', label: 'No division declared', sub: 'stated, not filed away', kind: 'holding', ids: noDivision, bearing: Math.PI });
  if (systemUtilities.length) outside.push({ key: '__system__', label: 'System utilities', sub: 'exempt from the admission standard', kind: 'holding', ids: systemUtilities, bearing: 0 });

  for (const o of outside) {
    const size = plotSizeFor(o.ids.length);
    const rect = place(size, o.bearing, occupied, [wall]);
    plots.set(o.key, { key: o.key, label: o.label, sub: o.sub, kind: o.kind, ...rect, ...size, count: o.ids.length });
    occupied.push(rect);
  }

  // --- buildings ---------------------------------------------------------
  const agentMeta = (id) => {
    const a = agents.find((x) => x.id === id);
    return {
      kind: 'citizen',
      director: Boolean(a && a.director),
      unreachable: unreachableSet.has(id),
      degree: degreeOf(id),
      height: heightFor(degreeOf(id), Boolean(a && a.director), unreachableSet.has(id)),
      division: a ? a.division : null,
      guild: a ? a.guild || null : null,
      number: a && a.division ? a.division.split(' ')[0] : null,
      system: Boolean(a && a.system),
      model: a ? a.model || null : null,
      tools: a ? a.tools || [] : [],
    };
  };

  for (const d of divisions) {
    const key = divisionKey(d);
    const plot = plots.get(key);
    if (!plot) continue;
    buildings.push(...fillPlot(plot, membersOf(key), agentMeta).map((b) => ({ ...b, plotKey: key })));
  }
  // A skill owned by a guild takes that guild's hue in the Archive, so the
  // Archive reads as a library with six visible collections rather than one
  // grey slab. Ownership is a real field on the skill record.
  const skillGuild = new Map(skills.map((s) => [s.id, s.guild || null]));
  for (const o of outside) {
    const plot = plots.get(o.key);
    if (!plot) continue;
    const meta = o.kind === 'archive'
      ? (id) => ({ kind: 'skill', height: SKILL_HEIGHT, id, guild: skillGuild.get(id) || null })
      : agentMeta;
    buildings.push(...fillPlot(plot, o.ids, meta).map((b) => ({ ...b, plotKey: o.key })));
  }

  const all = [...plots.values()];
  const bounds = {
    minCol: Math.min(wall.col, ...all.map((p) => p.col)) - 1,
    minRow: Math.min(wall.row, ...all.map((p) => p.row)) - 1,
    maxCol: Math.max(wall.col + wall.cols, ...all.map((p) => p.col + p.cols)) + 1,
    maxRow: Math.max(wall.row + wall.rows, ...all.map((p) => p.row + p.rows)) + 1,
  };

  const positions = new Map(buildings.map((b) => [b.id, { col: b.col, row: b.row, height: b.height }]));

  return { plots, buildings, positions, wall, bounds, degreeOf };
}
