/**
 * A citizen has to read as a person on the device it is shown on.
 *
 * The figure kit has been 22 world units for a while and that was never the
 * defect. The defect was the frame around it: the SVG's viewBox was always
 * the whole city, so a 358px-wide phone container drew a 22-unit citizen at
 * about six CSS pixels — roughly the height of a lowercase letter — and the
 * interactive zoom clamp could not make up a 6x deficit, because the clamp
 * governs movement FROM the default view, not the default view itself.
 *
 * So this measures the thing that actually broke: figure height in CSS pixels
 * at k=1, in the frame each container width would really get. It is arithmetic
 * on real geometry — no browser, no eyeballing — and it fails as the roster
 * grows if a frame quietly stops being legible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import { computeFocusFrame, legibilityOf, bandFor, FIGURE_UNITS } from '../site/city-view.mjs';
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

// Container sizes are the hero box each breakpoint really produces:
// styles.css `.hero-map` is 100vw wide with height min(64vh,560)/min(72vh,640)/
// min(78vh,760) — measured in a browser at 390x844 and 1440x900 as 390x538
// and 1438x700.
const CASES = [
  { name: 'phone', container: { width: 390, height: 538 }, band: 'phone', floor: 24 },
  { name: 'tablet', container: { width: 768, height: 606 }, band: 'tablet', floor: 24 },
  { name: 'desktop', container: { width: 1438, height: 700 }, band: 'desktop', floor: 0 },
];

test('each container width lands in the band its frame was designed for', () => {
  for (const c of CASES) assert.equal(bandFor(c.container.width), c.band, c.name);
});

test('a citizen is a person, not a letter, at the default view of every breakpoint', () => {
  for (const c of CASES) {
    const frame = computeFocusFrame(city, c.container, cityFrame());
    const px = legibilityOf(frame, c.container);
    process.stdout.write(`  ${c.name.padEnd(8)} frame=${frame.name.padEnd(8)} ${Math.round(frame.w)}x${Math.round(frame.h)}u  citizen=${px.toFixed(1)}px\n`);
    assert.ok(px >= c.floor, `${c.name}: a citizen is ${px.toFixed(1)}px, under the ${c.floor}px floor`);
  }
});

test('the phone frame is one district and the tablet frame is more than one', () => {
  const phone = computeFocusFrame(city, CASES[0].container, cityFrame());
  const tablet = computeFocusFrame(city, CASES[1].container, cityFrame());
  assert.equal(phone.name, 'district');
  assert.equal(tablet.name, 'ring');
  assert.ok(tablet.members.length > 1, 'the ring frame collapsed to a single plot');
  assert.ok(tablet.w > phone.w, 'the tablet frame is not wider than the phone frame');
});

test('no frame needs a zoom the camera clamp cannot reach', () => {
  // Every frame is a viewBox, so k stays 1 by construction. This asserts the
  // property rather than trusting it: if a frame ever starts depending on
  // camera zoom to be legible, MIN_K/MAX_K become a legibility constraint and
  // that has to be a loud failure, not a quiet one.
  for (const c of CASES) {
    const frame = computeFocusFrame(city, c.container, cityFrame());
    assert.ok(frame.w > 0 && frame.h > 0, `${c.name}: empty frame`);
    assert.equal(FIGURE_UNITS, 22);
  }
});
