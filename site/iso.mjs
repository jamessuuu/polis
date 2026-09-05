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
  const inset = (1 - footprint) / 2;
  const c0 = col + inset;
  const c1 = col + 1 - inset;
  const r0 = row + inset;
  const r1 = row + 1 - inset;

  const n = toScreen(c0, r0);
  const e = toScreen(c1, r0);
  const s = toScreen(c1, r1);
  const w = toScreen(c0, r1);

  const up = (p) => ({ x: p.x, y: p.y - height });
  const nT = up(n);
  const eT = up(e);
  const sT = up(s);
  const wT = up(w);

  return {
    top: pointsToString([nT, eT, sT, wT]),
    // The wall between the east and south corners: catches the light source,
    // which sits off to the right by convention.
    right: pointsToString([eT, sT, s, e]),
    // The wall between the west and south corners: away from the light.
    left: pointsToString([wT, sT, s, w]),
    apex: { x: round((nT.x + sT.x) / 2), y: round(nT.y) },
    base: { x: round((n.x + s.x) / 2), y: round(s.y) },
  };
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
  return { face };
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
