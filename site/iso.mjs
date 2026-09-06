/**
 * Isometric projection and building geometry.
 *
 * Pure functions, no DOM, no state — everything here is a coordinate
 * transform, which is why it can be tested without a browser.
 *
 * The projection is 2:1 dimetric (the one every isometric game actually
 * uses, despite the name): a tile is twice as wide as it is tall, so the
 * screen-space maths stays integer-friendly and the diagonals land on clean
 * half-tile steps. True isometric would need a 1.732:1 ratio and irrational
 * pixel offsets, which buys nothing and costs crispness at small sizes.
 *
 *   screenX = (col - row) * TILE_W / 2
 *   screenY = (col + row) * TILE_H / 2
 *
 * Note what that means for draw order: screenY increases with (col + row),
 * so painting in ascending (col + row) order is a correct painter's
 * algorithm for this projection. Anything drawn later is nearer the camera
 * and legitimately occludes what came before. `depthOf` exists so callers
 * sort by the same rule instead of each inventing their own.
 */

export const TILE_W = 64;
export const TILE_H = 32;

/** Tile coordinate -> screen coordinate (of the tile's north corner). */
export function toScreen(col, row) {
  return { x: (col - row) * (TILE_W / 2), y: (col + row) * (TILE_H / 2) };
}

/** Painter's-algorithm depth key. Larger = nearer the camera = drawn later. */
export function depthOf(col, row) {
  return col + row;
}

function pointsToString(pts) {
  return pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
}

function round(n) {
  // Two decimals is below the threshold a browser can render differently and
  // keeps the generated markup diffable, which matters because the build
  // output is committed.
  return Math.round(n * 100) / 100;
}

/** The four ground corners of a building's footprint on its tile. */
function footprintCorners(col, row, footprint) {
  const inset = (1 - footprint) / 2;
  const c0 = col + inset;
  const c1 = col + 1 - inset;
  const r0 = row + inset;
  const r1 = row + 1 - inset;
  return { n: toScreen(c0, r0), e: toScreen(c1, r0), s: toScreen(c1, r1), w: toScreen(c0, r1), inset };
}

const up = (p, d) => ({ x: p.x, y: p.y - d });

/**
 * The flat diamond of a single ground tile.
 * @returns {string} an SVG points list
 */
export function tilePolygon(col, row, inset = 0) {
  const c0 = col + inset;
  const c1 = col + 1 - inset;
  const r0 = row + inset;
  const r1 = row + 1 - inset;
  return pointsToString([
    toScreen(c0, r0), // north
    toScreen(c1, r0), // east
    toScreen(c1, r1), // south
    toScreen(c0, r1), // west
  ]);
}

/**
 * A box standing on a tile, as three faces.
 *
 * Only three of the six faces are ever visible in a fixed-camera isometric
 * view, and drawing the hidden three is pure cost. The two side faces are
 * shaded differently by CSS: that difference in flat colour is the entire
 * reason a 2D polygon reads as a solid, so the faces are returned separately
 * rather than as one silhouette.
 *
 * @param {number} col
 * @param {number} row
 * @param {number} height in pixels of vertical extrusion
 * @param {number} footprint 0..1 fraction of the tile the base occupies
 * @returns {{top:string,left:string,right:string,apex:{x:number,y:number}}}
 */
export function boxFaces(col, row, height, footprint = 0.74) {
  const { n, e, s, w } = footprintCorners(col, row, footprint);
  const nT = up(n, height);
  const eT = up(e, height);
  const sT = up(s, height);
  const wT = up(w, height);

  return {
    top: pointsToString([nT, eT, sT, wT]),
    // The wall between the east and south corners: catches the light source,
    // which sits off to the right by convention.
    right: pointsToString([eT, sT, s, e]),
    // The wall between the west and south corners: away from the light.
    left: pointsToString([wT, sT, s, w]),
    // The roof's centre, where a banner pole stands.
    apex: { x: round((nT.x + sT.x) / 2), y: round((nT.y + sT.y) / 2) },
    base: { x: round((n.x + s.x) / 2), y: round(s.y) },
  };
}

/**
 * A gabled roof — DESIGN.md §4. The ridge runs along +col so the lit slope
 * faces the key light. `RIDGE = clamp(0.16h, 5, 12)`.
 */
export function gableFaces(col, row, height, footprint = 0.74) {
  const { n, e, s, w } = footprintCorners(col, row, footprint);
  const nT = up(n, height);
  const eT = up(e, height);
  const sT = up(s, height);
  const wT = up(w, height);
  const ridge = Math.min(12, Math.max(5, 0.16 * height));
  const r1 = { x: (nT.x + wT.x) / 2, y: (nT.y + wT.y) / 2 - ridge };
  const r2 = { x: (eT.x + sT.x) / 2, y: (eT.y + sT.y) / 2 - ridge };
  return {
    lit: pointsToString([nT, eT, r2, r1]),
    shade: pointsToString([wT, sT, r2, r1]),
    end: pointsToString([eT, sT, r2]),
    apex: { x: round((r1.x + r2.x) / 2), y: round((r1.y + r2.y) / 2) },
  };
}

/**
 * The outer silhouette of a box: the six points a viewer sees as its edge.
 * One path per building; revealed by opacity for hover and, in the dark
 * theme, always on as the compliant boundary (DESIGN.md §2.4.2).
 */
export function silhouettePath(col, row, height, footprint = 0.74) {
  const { n, e, s, w } = footprintCorners(col, row, footprint);
  const pts = [up(n, height), up(e, height), e, s, w, up(w, height)];
  return 'M ' + pts.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ') + ' Z';
}

export const STOREY_H = 10.2;

/**
 * Storey lines on both visible walls, one every STOREY_H, as one path.
 * Degree, readable a second way.
 */
export function storeyLinesPath(col, row, height, footprint = 0.74) {
  const { e, s, w } = footprintCorners(col, row, footprint);
  const parts = [];
  for (let y = STOREY_H; y < height - 2; y += STOREY_H) {
    parts.push(`M ${round(e.x)} ${round(e.y - y)} L ${round(s.x)} ${round(s.y - y)} L ${round(w.x)} ${round(w.y - y)}`);
  }
  return parts.join(' ');
}

/**
 * Lit windows: one per storey on each of the two visible walls, as one path
 * of parallelograms (a rectangle on an isometric wall). Count = storeys, so
 * the windows encode degree a third way and are not ornament.
 */
export function windowsPath(col, row, height, footprint = 0.74, storeys = 0) {
  const { e, s, w } = footprintCorners(col, row, footprint);
  const midR = { x: (e.x + s.x) / 2, y: (e.y + s.y) / 2 };
  const midL = { x: (w.x + s.x) / 2, y: (w.y + s.y) / 2 };
  const half = 2.5;
  const k = half / Math.sqrt(5);
  const uR = { x: -2 * k, y: k }; // along the right wall (e -> s)
  const uL = { x: 2 * k, y: k }; // along the left wall (w -> s)
  const parts = [];
  const quad = (m, u, top, bottom) => (
    `M ${round(m.x - u.x)} ${round(m.y - u.y - top)} ` +
    `L ${round(m.x + u.x)} ${round(m.y + u.y - top)} ` +
    `L ${round(m.x + u.x)} ${round(m.y + u.y - bottom)} ` +
    `L ${round(m.x - u.x)} ${round(m.y - u.y - bottom)} Z`
  );
  for (let i = 0; i < storeys; i++) {
    const yc = (i + 0.5) * STOREY_H + 1;
    if (yc + 2.6 > height - 1.5) break;
    parts.push(quad(midR, uR, yc + 2.6, yc - 2.6));
    parts.push(quad(midL, uL, yc + 2.6, yc - 2.6));
  }
  return parts.join(' ');
}

/** The front (south) corner of a footprint: where a citizen stands and a walker leaves. */
export function doorPoint(col, row, footprint = 0.74) {
  const inset = (1 - footprint) / 2;
  const tile = { col: col + 1 - inset, row: row + 1 - inset };
  const p = toScreen(tile.col, tile.row);
  return { tile, x: round(p.x), y: round(p.y) };
}

/**
 * The outline of a rectangular plot of tiles, as a flat diamond.
 * Used for district ground, plot borders and the city wall footprint.
 */
export function plotPolygon(col, row, cols, rows, inset = 0) {
  const c0 = col + inset;
  const c1 = col + cols - inset;
  const r0 = row + inset;
  const r1 = row + rows - inset;
  return pointsToString([
    toScreen(c0, r0),
    toScreen(c1, r0),
    toScreen(c1, r1),
    toScreen(c0, r1),
  ]);
}

/**
 * One path of hairline tile boundaries across a plot — the paving grid.
 * One element per plot instead of one per tile.
 */
export function tileGridPath(col, row, cols, rows) {
  const parts = [];
  for (let c = 1; c < cols; c++) {
    const a = toScreen(col + c, row);
    const b = toScreen(col + c, row + rows);
    parts.push(`M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`);
  }
  for (let r = 1; r < rows; r++) {
    const a = toScreen(col, row + r);
    const b = toScreen(col + cols, row + r);
    parts.push(`M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`);
  }
  return parts.join(' ');
}

/**
 * A wall segment standing along one edge of a plot rectangle, extruded up.
 * Returns the quad for the wall's outward face plus its capstone.
 */
export function wallSegment(fromCol, fromRow, toCol, toRow, height) {
  const a = toScreen(fromCol, fromRow);
  const b = toScreen(toCol, toRow);
  const face = pointsToString([
    { x: a.x, y: a.y - height },
    { x: b.x, y: b.y - height },
    { x: b.x, y: b.y },
    { x: a.x, y: a.y },
  ]);
  return { face, cap: { x1: round(a.x), y1: round(a.y - height), x2: round(b.x), y2: round(b.y - height) } };
}

/**
 * The whole city wall: two back edges as lit faces with a one-tile gate
 * each, and the two front edges as a low kerb — a wall that stops halfway
 * reads as an accident, a wall you cannot see over hides the city.
 *
 * @param {{col:number,row:number,cols:number,rows:number}} wall
 * @param {{north:{col:number,row:number},west:{col:number,row:number}}} gates
 */
export function wallGeometry(wall, gates, height = 26, kerb = 4) {
  const { col, row, cols, rows } = wall;
  const north = [
    wallSegment(col, row, gates.north.col - 0.5, row, height),
    wallSegment(gates.north.col + 0.5, row, col + cols, row, height),
  ];
  const west = [
    wallSegment(col, row, col, gates.west.row - 0.5, height),
    wallSegment(col, gates.west.row + 0.5, col, row + rows, height),
  ];
  const kerbs = [
    wallSegment(col + cols, row, col + cols, row + rows, kerb),
    wallSegment(col, row + rows, col + cols, row + rows, kerb),
  ];
  return { north, west, kerbs };
}

/**
 * The board the city stands on: the ground diamond plus two extruded front
 * edges, so the map is an object on the page rather than a drawing floating
 * on it. DESIGN.md §7.
 */
export function plinthFaces(minCol, minRow, maxCol, maxRow, depth = 14) {
  const n = toScreen(minCol, minRow);
  const e = toScreen(maxCol, minRow);
  const s = toScreen(maxCol, maxRow);
  const w = toScreen(minCol, maxRow);
  const dn = (p) => ({ x: p.x, y: p.y + depth });
  return {
    top: pointsToString([n, e, s, w]),
    right: pointsToString([e, s, dn(s), dn(e)]),
    left: pointsToString([s, w, dn(w), dn(s)]),
  };
}

/**
 * The shadow a box casts on the ground.
 *
 * Flat-shaded solids read as solid because of two cues, and face shading is
 * only the first. The second is contact: a shape with no shadow looks pasted
 * onto the background rather than standing on it.
 *
 * The light is fixed at the upper right, so shadows fall to the lower left —
 * which in this projection is simply "along +row", meaning the shadow stays
 * on the tile grid instead of cutting across it at an arbitrary angle. That
 * is not an aesthetic preference, it is what keeps shadows from looking like
 * they belong to a different scene.
 *
 * The returned polygon is the convex hull of the footprint swept along the
 * light direction: the footprint itself, plus its translated copy, plus the
 * two edges connecting them.
 *
 * @param {number} height pixels of extrusion; taller casts further
 * @param {number} run shadow length as a fraction of height
 */
export function shadowPolygon(col, row, height, footprint = 0.74, run = 0.55) {
  const { n, e, s, w } = footprintCorners(col, row, footprint);

  // Travel is along +row, which in screen space is (-TILE_W/2, +TILE_H/2)
  // per tile — so the horizontal component is exactly twice the vertical.
  const dy = run * height;
  const dx = -2 * dy;
  const off = (p) => ({ x: p.x + dx, y: p.y + dy });

  // Five points, not six. The e->s edge runs in direction (-2, +1), which is
  // collinear with the light travel, so `s` lies ON the segment e -> s+D and
  // adding it as a vertex is a wasted point on every building on the map.
  return pointsToString([n, e, off(s), off(w), off(n)]);
}

/**
 * The darker band where a wall meets the ground.
 *
 * The single cheapest thing that stops an extruded box reading as a sticker
 * pasted on the background. Two quads per building, no filter, no gradient.
 */
export function footingBands(col, row, height, footprint = 0.74, band = 3.5) {
  const h = Math.min(band, Math.max(0, height));
  const { e, s, w } = footprintCorners(col, row, footprint);
  return {
    right: pointsToString([up(e, h), up(s, h), s, e]),
    left: pointsToString([up(w, h), up(s, h), s, w]),
  };
}

/**
 * The contact ellipse under a building. Geometry, never a blur filter — the
 * performance budget for this map forbids filters entirely.
 */
export function contactPatch(col, row, footprint = 0.74, grow = 7) {
  const { n, e, s, w } = footprintCorners(col, row, footprint);
  return {
    cx: round((n.x + s.x) / 2),
    cy: round((n.y + s.y) / 2),
    rx: round((e.x - w.x) / 2 + grow),
    ry: round((s.y - n.y) / 2 + grow / 2),
  };
}

/**
 * A deterministic small integer for a member, for picking a silhouette
 * variant without randomness.
 *
 * The city is rebuilt into committed HTML, so anything that varies between
 * runs turns every rebuild into a noisy diff. Variety has to be a pure
 * function of the member's own id — the same agent gets the same roof
 * forever, on every machine.
 */
export function variantOf(id, buckets) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % buckets;
}

/**
 * Screen-space bounding box for a tile-space rectangle, so the caller can
 * compute a viewBox without guessing at the diamond's extents.
 */
export function screenBounds(minCol, minRow, maxCol, maxRow) {
  const corners = [
    toScreen(minCol, minRow),
    toScreen(maxCol, minRow),
    toScreen(maxCol, maxRow),
    toScreen(minCol, maxRow),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
