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

const STREET = 1; // tiles of clear space between neighbouring plots
const SIDEWALK = 1; // tiles of clear space inside a plot, before buildings
const WALL_MARGIN = 2; // tiles between the outermost district and the wall

/** Building heights, in pixels of extrusion. Height encodes real degree. */
const BASE_HEIGHT = 14;
const HEIGHT_PER_LINK = 3.4;
const MAX_HEIGHT = 82;
const DIRECTOR_BONUS = 10;
const RUIN_HEIGHT = 5; // a citizen no one names has nothing built on it
const SKILL_HEIGHT = 11;

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
 * Candidate origins for a plot, ordered: nearest ring first, and within a
 * ring, closest bearing to `preferredAngle` first. Ties broken on raw
 * coordinates so the order is total and therefore reproducible.
 */
function* spiralCandidates(size, preferredAngle, maxRing = 60) {
  const halfC = Math.floor(size.cols / 2);
  const halfR = Math.floor(size.rows / 2);
  for (let ring = 0; ring <= maxRing; ring++) {
    const cells = [];
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const angle = Math.atan2(dr, dc);
        let diff = Math.abs(angle - preferredAngle) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        cells.push({ dc, dr, diff });
      }
    }
    cells.sort((a, b) => a.diff - b.diff || a.dc - b.dc || a.dr - b.dr);
    for (const c of cells) {
      yield { col: c.dc - halfC, row: c.dr - halfR };
    }
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
  const districtRects = [...plots.values()];
  const wall = {
    col: Math.min(...districtRects.map((p) => p.col)) - WALL_MARGIN,
    row: Math.min(...districtRects.map((p) => p.row)) - WALL_MARGIN,
  };
  wall.cols = Math.max(...districtRects.map((p) => p.col + p.cols)) + WALL_MARGIN - wall.col;
  wall.rows = Math.max(...districtRects.map((p) => p.row + p.rows)) + WALL_MARGIN - wall.row;

  // --- outside the wall --------------------------------------------------
  const outside = [];

  // Guild halls. Guilds are real organisational units that ECOSYSTEM.md
  // places at routing levels 3-4 and never lists inside a division, so
  // folding them into "no division declared" would be a lie about their
  // status. They get their own named precincts in a ring beyond the wall —
  // outside the eight districts, which is exactly where the constitution
  // puts them, and visibly still part of the city.
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
  const skillIds = skills.map((s) => s.id).sort();

  if (skillIds.length) outside.push({ key: '__archive__', label: 'The Archive', sub: 'skills any citizen may invoke', kind: 'archive', ids: skillIds, bearing: Math.PI / 2 });
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
    };
  };

  for (const d of divisions) {
    const key = divisionKey(d);
    const plot = plots.get(key);
    if (!plot) continue;
    buildings.push(...fillPlot(plot, membersOf(key), agentMeta).map((b) => ({ ...b, plotKey: key })));
  }
  for (const o of outside) {
    const plot = plots.get(o.key);
    if (!plot) continue;
    const meta = o.kind === 'archive'
      ? (id) => ({ kind: 'skill', height: SKILL_HEIGHT, id })
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
