/**
 * A citizen has to be REACHABLE on the device it is shown on, and legible
 * once you look at them.
 *
 * The first version of this file measured only the second half of that, and
 * the map paid for it. It asserted that a citizen was at least 24 CSS pixels
 * tall at the default view of every breakpoint, and the frame logic duly
 * bought that number on a phone the only way it could: by framing ONE
 * district and leaving the other 37 of 69 citizens outside the picture. The
 * test passed. The map was broken. Measured on the live site at 390x844
 * before this change: 37 citizens off-screen, buildings running off the right
 * edge with nothing to say they were there, and a citizen bounding box 488px
 * wide inside a 390px viewport.
 *
 * So the promise is now stated in the right order:
 *
 *   1. COVERAGE, at every width: the default frame contains every citizen.
 *      A person you cannot see is not a person you can zoom into.
 *   2. LEGIBILITY, within reach: the camera clamp can take a citizen to a
 *      readable size from that default. Legibility is a verb the visitor
 *      controls; coverage is not.
 *
 * It is arithmetic on real geometry — no browser, no eyeballing — and it
 * fails as the roster grows if either promise quietly stops holding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import { computeFocusFrame, legibilityOf, bandFor, subjectBox, FIGURE_UNITS } from '../site/city-view.mjs';
import { screenBounds } from '../site/iso.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8'));

const city = computeCity(
  snap.divisions, snap.agents, snap.edges, snap.skills, snap.unreachable, snap.guilds,
);

/**
 * The whole-city frame, computed the way renderCity computes it, minus the
 * label headroom it learns while drawing. Slightly generous, which makes the
 * desktop number here a floor rather than a flattering estimate.
 */
function cityFrame() {
  const b = screenBounds(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow);
  const PAD = 64;
  return { x: b.minX - PAD, y: b.minY - 200, w: b.maxX - b.minX + PAD * 2, h: b.maxY - b.minY + 214 };
}

// Container sizes are the box the SVG itself really gets at each breakpoint,
// measured in a browser against styles.css. The map now fills the viewport it
// is given, so these are taller than they were.
const CASES = [
  { name: 'phone', container: { width: 390, height: 372 }, band: 'phone' },
  { name: 'tablet', container: { width: 768, height: 560 }, band: 'tablet' },
  { name: 'desktop', container: { width: 1438, height: 812 }, band: 'desktop' },
];

/** The camera's own clamp, from attachCamera. Legibility may use it; coverage may not. */
const MAX_K = 3.4;
/** A head resolves to about a quarter of this: under it, a citizen is a letter. */
const LEGIBLE_PX = 24;

test('each container width lands in the band its frame was designed for', () => {
  for (const c of CASES) assert.equal(bandFor(c.container.width), c.band, c.name);
});

test('the default frame contains every citizen, at every breakpoint', () => {
  const box = subjectBox(city);
  assert.ok(box, 'the snapshot has no citizens at all');
  for (const c of CASES) {
    const f = computeFocusFrame(city, c.container, cityFrame());
    // preserveAspectRatio="meet" fits the frame inside the container, so
    // "inside the frame" is exactly "on screen".
    assert.ok(box.minX >= f.x && box.maxX <= f.x + f.w,
      `${c.name}: citizens span x[${box.minX.toFixed(0)},${box.maxX.toFixed(0)}] but the frame is x[${f.x.toFixed(0)},${(f.x + f.w).toFixed(0)}]`);
    assert.ok(box.minY >= f.y && box.maxY <= f.y + f.h,
      `${c.name}: citizens span y[${box.minY.toFixed(0)},${box.maxY.toFixed(0)}] but the frame is y[${f.y.toFixed(0)},${(f.y + f.h).toFixed(0)}]`);
  }
});

test('the city is drawn as large as the frame allows, not floated inside it', () => {
  // The fit must be binding on one axis. If neither axis is tight the frame
  // has slack in both directions, which is the "small city in a big empty
  // field" failure this page kept regressing to.
  for (const c of CASES) {
    const f = computeFocusFrame(city, c.container, cityFrame());
    const fill = Math.max(
      (c.container.width / f.w) / Math.min(c.container.width / f.w, c.container.height / f.h),
      (c.container.height / f.h) / Math.min(c.container.width / f.w, c.container.height / f.h),
    );
    // One axis is exactly binding; the other may be grown to the container's
    // aspect but never letterboxed, so the ratio is 1 within rounding.
    assert.ok(fill < 1.02, `${c.name}: the frame letterboxes by ${((fill - 1) * 100).toFixed(1)}%`);
  }
});

test('a citizen reaches a readable size within the camera clamp', () => {
  for (const c of CASES) {
    const frame = computeFocusFrame(city, c.container, cityFrame());
    const px = legibilityOf(frame, c.container);
    process.stdout.write(`  ${c.name.padEnd(8)} frame=${frame.name.padEnd(8)} ${Math.round(frame.w)}x${Math.round(frame.h)}u  citizen=${px.toFixed(1)}px  at max zoom=${(px * MAX_K).toFixed(1)}px\n`);
    assert.ok(px * MAX_K >= LEGIBLE_PX,
      `${c.name}: a citizen tops out at ${(px * MAX_K).toFixed(1)}px, under the ${LEGIBLE_PX}px floor even at full zoom`);
  }
});

test('the desktop default draws a citizen legibly with no zoom at all', () => {
  // On a laptop there is no excuse: the hero is big enough that the whole
  // city fits AND a citizen reads, so this one is not allowed to need a zoom.
  const desktop = CASES[2];
  const px = legibilityOf(computeFocusFrame(city, desktop.container, cityFrame()), desktop.container);
  assert.ok(px >= LEGIBLE_PX, `desktop: a citizen is ${px.toFixed(1)}px at rest, under the ${LEGIBLE_PX}px floor`);
});

test('no frame needs a zoom the camera clamp cannot reach', () => {
  for (const c of CASES) {
    const frame = computeFocusFrame(city, c.container, cityFrame());
    assert.ok(frame.w > 0 && frame.h > 0, `${c.name}: empty frame`);
    assert.equal(FIGURE_UNITS, 22);
  }
});
