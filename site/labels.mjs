/**
 * Where every label goes.
 *
 * This module is pure: boxes in, boxes out, no DOM. That is deliberate.
 * Label collision was the single worst thing about this page, and the reason
 * it kept coming back is that the placement logic lived inside the renderer
 * where nothing could test it. Here it is data, so `tests/labels.test.mjs`
 * can run the real plan through the real algorithm and fail the build the
 * moment two labels share a pixel again.
 *
 * The algorithm is the standard point-feature label placement one, not a
 * lift-until-clear loop:
 *
 *   1. Labels are placed in priority order (district > director > citizen).
 *      Priority order IS placement order, so a district title is never moved
 *      by a citizen's name.
 *   2. Each label proposes a fan of CANDIDATE positions around its anchor:
 *      eight compass directions at several radii, plus the natural spot.
 *   3. Every candidate is SCORED, not first-fit. A candidate that overlaps an
 *      already-placed label is rejected outright — labels never overlap, that
 *      is the whole point. Everything else is a cost: how much of a building
 *      silhouette it hides, how far it sits from its subject, whether it
 *      leaves the frame, and how much it fights the preferred direction.
 *   4. The cheapest surviving candidate wins. If it is not the natural spot,
 *      the caller draws a leader line back to the anchor.
 *   5. If nothing survives, a citizen label is DROPPED for that frame (the
 *      roster below still names everyone) and a district or director label
 *      falls back to the least-bad position rather than vanishing.
 *
 * Why buildings are obstacles at all: the old pass only knew about other
 * labels, so it happily parked "00 · Cabinet" across the Cabinet's own tower.
 * A label that hides the thing it names is worse than no label.
 */

/** Breathing room between two label boxes, in world units. */
export const LABEL_GAP_X = 14;
export const LABEL_GAP_Y = 10;

/** Radial steps the fan is searched at, as a multiple of the label's height. */
const RADII = [0, 0.75, 1.15, 1.65, 2.25, 3.0, 3.9, 5.0];

/**
 * The eight directions, with a bias cost each.
 *
 * South is cheapest because in this projection south is DOWNHILL and toward
 * the camera: the street in front of a plot, where nothing is built and
 * nothing extrudes upward into the label. North is dearest because north is
 * exactly where the roofs of the row behind climb into.
 */
const DIR_COUNT = 16;
const DIRECTIONS = Array.from({ length: DIR_COUNT }, (_, i) => {
  // Angle 0 is straight down the screen: south, the street in front of the
  // plot. The bias grows with the angle away from it, so a label only climbs
  // into the roofscape behind its plot when everything nearer is taken.
  const a = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * ((2 * Math.PI) / DIR_COUNT);
  return {
    name: `d${i}`,
    dx: Math.sin(a),
    dy: Math.cos(a),
    bias: (1 - Math.cos(a)) / 2 * 1.15,
  };
});

/** Cost weights. Tuned against the real plan; gated by tests/labels.test.mjs. */
const W_BUILDING = 5.0; // hiding a silhouette is the expensive mistake
const W_DISTANCE = 2.6; // but fleeing to empty ground is a mistake too: a
                        // label three plots from its subject is a puzzle
const W_DIRECTION = 0.7;
const W_OFF_FRAME = 40; // effectively a rejection, but a rankable one

export function rectsOverlap(a, b, padX = 0, padY = 0) {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + padX
    && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + padY;
}

/** Shared area of two centre-based boxes, in square world units. */
export function intersectionArea(a, b) {
  const w = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const h = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  return w > 0 && h > 0 ? w * h : 0;
}

function insideFrame(box, frame) {
  if (!frame) return true;
  return box.cx - box.w / 2 >= frame.x
    && box.cx + box.w / 2 <= frame.x + frame.w
    && box.cy - box.h / 2 >= frame.y
    && box.cy + box.h / 2 <= frame.y + frame.h;
}

/**
 * The fan of candidate positions for one label.
 *
 * `natural` is where the label would sit if the world were empty; it is
 * always tried first and always costs nothing in distance, so an uncrowded
 * map still reads as "the label is simply above its thing".
 */
export function* candidatesFor(label) {
  const { natural, w, h } = label;
  yield { cx: natural.cx, cy: natural.cy, w, h, dir: 'natural', bias: 0, dist: 0 };
  const unit = Math.max(h, 18);
  for (const r of RADII) {
    if (r === 0) continue;
    for (const d of DIRECTIONS) {
      const dist = r * unit;
      yield {
        cx: label.anchor.x + d.dx * (dist + w / 2 * Math.abs(d.dx)),
        cy: label.anchor.y + d.dy * (dist + h / 2 * Math.abs(d.dy)),
        w,
        h,
        dir: d.name,
        bias: d.bias,
        dist,
      };
    }
  }
}

/**
 * Place a priority-ordered list of labels.
 *
 * `labels`: [{ id, tier, w, h, anchor:{x,y}, natural:{cx,cy}, droppable }]
 * `obstacles`: building silhouette boxes, [{ id, cx, cy, w, h }]
 * `reserved`: boxes already taken by labels placed in an earlier pass
 * `frame`: the visible rectangle, or null for "no frame constraint"
 *
 * Returns { placements: Map(id -> {box, displaced, dir, cover}), dropped: [] }.
 * `cover` is the fraction of the label that sits on a building, reported so a
 * test can assert it rather than a person squinting at a screenshot.
 */
/** Score every candidate in one label's fan and return the two best. */
function search(label, dims, taken, obstacles, frame) {
  let best = null;
  let leastBad = null;
  for (const cand of candidatesFor({ ...label, ...dims })) {
    const box = { cx: cand.cx, cy: cand.cy, w: cand.w, h: cand.h };
    const hitsLabel = taken.some((t) => rectsOverlap(box, t, LABEL_GAP_X, LABEL_GAP_Y));
    let cover = 0;
    for (const o of obstacles) {
      if (o.id && o.id === label.subject) continue; // its own roof is fair game
      cover += intersectionArea(box, o);
    }
    cover = Math.min(1, cover / (box.w * box.h));
    const off = insideFrame(box, frame) ? 0 : 1;
    const norm = cand.dist / Math.max(1, cand.h * 4);
    const cost = cover * W_BUILDING + norm * W_DISTANCE + cand.bias * W_DIRECTION + off * W_OFF_FRAME;
    const entry = {
      box, displaced: cand.dir !== 'natural', dir: cand.dir, cover, cost, compact: Boolean(dims.compact),
    };
    if (!leastBad || cost < leastBad.cost) leastBad = entry;
    if (hitsLabel) continue;
    if (!best || cost < best.cost) best = entry;
    // The fan is ordered cheapest-direction-first at each radius, so once a
    // clean spot near the anchor is found there is nothing better further out.
    if (best.cost < 0.35) break;
  }
  return { best, leastBad };
}

/**
 * Above this share of the label sitting on a building, a label that has a
 * compact form tries again as that form. This is LAYOUT-SPEC's density
 * fallback: a title that cannot fit whole drops its second line rather than
 * lying across a roof, and the full form comes back on hover.
 */
const COMPACT_AT = 0.22;

export function placeLabels(labels, { obstacles = [], reserved = [], frame = null } = {}) {
  const taken = reserved.map((b) => ({ ...b }));
  const placements = new Map();
  const dropped = [];

  for (const label of labels) {
    let { best, leastBad } = search(label, { w: label.w, h: label.h }, taken, obstacles, frame);
    if (label.compact && (!best || best.cover > COMPACT_AT)) {
      const alt = search(label, { ...label.compact, compact: true }, taken, obstacles, frame);
      if (alt.best && (!best || alt.best.cover < best.cover)) best = alt.best;
      if (alt.leastBad && (!leastBad || alt.leastBad.cover < leastBad.cover)) leastBad = alt.leastBad;
    }
    if (best) {
      placements.set(label.id, best);
      taken.push(best.box);
    } else if (label.droppable) {
      dropped.push(label.id);
    } else {
      // Never hidden: a district title and a director's name are promises the
      // page makes in prose. Take the least-bad spot and draw the leader.
      const entry = leastBad || {
        box: { cx: label.natural.cx, cy: label.natural.cy, w: label.w, h: label.h },
        displaced: true, dir: 'forced', cover: 1, cost: Infinity, compact: false,
      };
      entry.displaced = true;
      placements.set(label.id, entry);
      taken.push(entry.box);
    }
  }
  return { placements, dropped, taken };
}

/**
 * Every pair of placed boxes that shares a pixel.
 *
 * The regression gate: this must return [] for every frame the page can show.
 * Kept here rather than in the test so the renderer can assert it too.
 */
export function collisions(boxes) {
  const bad = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const area = intersectionArea(boxes[i], boxes[j]);
      if (area > 0) bad.push({ a: boxes[i], b: boxes[j], area });
    }
  }
  return bad;
}
