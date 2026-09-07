/**
 * Two labels may never share a pixel, and a label may never hide the thing
 * it names.
 *
 * This is the regression gate for the defect that made the map unreadable:
 * eight district titles and seven director names stacked into a pile of
 * white boxes over the city. The old placement pass only ever lifted a plate
 * straight up until it stopped touching another plate, so it could report
 * "no collisions" while parking "00 · Cabinet" across the Cabinet's tower and
 * printing a director's name over a roof.
 *
 * So this drives the REAL placer over the REAL plan, at the label scales the
 * three breakpoints actually produce, in the states a visitor can actually
 * create (at rest, pointing at someone, with a whole district lit), and
 * fails on:
 *
 *   - any two placed labels overlapping,
 *   - any label covering more than a small share of a building silhouette,
 *   - a district, guild or the Archive going unlabelled,
 *   - the declutter rule quietly stopping: people are not named at rest.
 *
 * No browser and no screenshot: this is arithmetic on the same boxes the
 * renderer transforms into the DOM, so it holds as the roster grows.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import {
  obstacleBoxes, plateCandidates, placePlates, nameWidth, NAME_H, NAME_POOL,
  computeFocusFrame, plateScaleFor,
} from '../site/city-view.mjs';
import { placeLabels, intersectionArea, collisions } from '../site/labels.mjs';
import { screenBounds } from '../site/iso.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8'));

const city = computeCity(
  snap.divisions, snap.agents, snap.edges, snap.skills, snap.unreachable, snap.guilds,
);
const obstacles = obstacleBoxes(city);
const directors = snap.agents.filter((a) => a.director).map((a) => a.id).sort();
const byId = new Map(city.buildings.map((b) => [b.id, b]));

/** The label scales the three bands really produce, plus the extremes. */
const SCALES = [1, 0.72, 0.5, 0.34];

function plates(scale, frame = null) {
  const boxes = [];
  const cands = plateCandidates(city);
  placePlates(cands, boxes, scale, obstacles, frame);
  return { cands, boxes };
}

/**
 * The frames the page really uses, and the label scale each one produces.
 *
 * `placePlates` takes a frame now, so the placer can no longer solve a
 * crowded plan by walking a plate off the edge of the picture. That is a new
 * constraint on a solver that was only ever tested unconstrained, and a
 * constrained solver has different failure modes — it falls back to the
 * least-bad position more often. So the real frames are exercised here, not
 * just the scales.
 */
const cityRect = (() => {
  const b = screenBounds(city.bounds.minCol, city.bounds.minRow, city.bounds.maxCol, city.bounds.maxRow);
  const PAD = 64;
  return { x: b.minX - PAD, y: b.minY - 200, w: b.maxX - b.minX + PAD * 2, h: b.maxY - b.minY + 214 };
})();
const CONTAINERS = [
  { name: 'phone', width: 388, height: 426 },
  { name: 'tablet', width: 768, height: 560 },
  { name: 'laptop', width: 1438, height: 827 },
];

/**
 * The T2/T3 pass, built exactly the way `refreshNamePlates` builds it but
 * without a DOM: apex from the plan, not from a dataset attribute.
 */
function names(ids, scale, reserved) {
  const labels = [];
  for (const id of ids) {
    const b = byId.get(id);
    if (!b || b.unreachable) continue;
    const box = obstacles.find((o) => o.id === id);
    if (!box) continue;
    const x = box.cx;
    const y = box.cy - box.h / 2; // the roof line: where a name plate hangs
    const h = NAME_H * scale;
    labels.push({
      id, subject: id, w: nameWidth(id) * scale, h, droppable: true,
      anchor: { x, y }, natural: { cx: x, cy: y - 8 - h / 2 },
    });
  }
  return placeLabels(labels, { obstacles, reserved });
}

test('every precinct is labelled, at every label scale', () => {
  for (const scale of SCALES) {
    const { cands } = plates(scale);
    assert.equal(cands.length, city.plots.size, `scale ${scale}`);
    for (const c of cands) assert.ok(c.box, `${c.key} got no box at scale ${scale}`);
  }
});

test('no two precinct plates share a pixel, in the frames the page really uses', () => {
  for (const c of CONTAINERS) {
    const frame = computeFocusFrame(city, c, cityRect);
    const scale = plateScaleFor(frame, c);
    const { boxes, cands } = plates(scale, frame);
    const hits = collisions(boxes).map((h) => {
      const find = (bx) => cands.find((k) => k.box.cx === bx.cx && k.box.cy === bx.cy);
      const a = find(h.a); const b = find(h.b);
      return `${a ? a.key : '?'} x ${b ? b.key : '?'} (${Math.round(h.area)}u2)`;
    });
    assert.deepEqual(hits, [], `overlapping plates on ${c.name} (scale ${scale.toFixed(2)})`);
    // And every plate is inside the picture, which is the point of the frame.
    for (const k of cands) {
      assert.ok(k.box.cx - k.box.w / 2 >= frame.x - 0.5 && k.box.cx + k.box.w / 2 <= frame.x + frame.w + 0.5
        && k.box.cy - k.box.h / 2 >= frame.y - 0.5 && k.box.cy + k.box.h / 2 <= frame.y + frame.h + 0.5,
      `${c.name}: the ${k.key} plate is outside the frame`);
    }
  }
});

test('no two precinct plates share a pixel, at every label scale', () => {
  for (const scale of SCALES) {
    const { boxes, cands } = plates(scale);
    const hits = collisions(boxes);
    const names_ = hits.map((h) => {
      const a = cands.find((c) => c.box === h.a || (c.box.cx === h.a.cx && c.box.cy === h.a.cy));
      const b = cands.find((c) => c.box === h.b || (c.box.cx === h.b.cx && c.box.cy === h.b.cy));
      return `${a ? a.key : '?'} x ${b ? b.key : '?'} (${Math.round(h.area)}u2)`;
    });
    assert.deepEqual(names_, [], `overlapping plates at scale ${scale}`);
  }
});

test('no precinct plate sits on a building silhouette', () => {
  // The box a building occupies is its bounding rectangle, and an isometric
  // silhouette only fills about half of that, so a small share is a label
  // clipping an empty corner rather than hiding a roof. A third of the plate
  // covered is not that.
  const LIMIT = 0.34;
  for (const scale of SCALES) {
    const { cands } = plates(scale);
    const bad = cands
      .filter((c) => c.cover > LIMIT)
      .map((c) => `${c.key} ${(c.cover * 100).toFixed(0)}%`);
    assert.deepEqual(bad, [], `plates hiding buildings at scale ${scale}`);
  }
});

test('name plates never collide with each other or with a precinct plate', () => {
  // The worst real case: a director is pointed at, so their name, their
  // neighbours' names and every precinct plate are all on screen at once.
  const anchor = 'chief-of-staff';
  const neighbours = snap.edges
    .filter((e) => e.from === anchor || e.to === anchor)
    .map((e) => (e.from === anchor ? e.to : e.from));
  const wanted = [...new Set([...directors, anchor, ...neighbours])].slice(0, NAME_POOL);
  for (const scale of SCALES) {
    const { boxes } = plates(scale);
    const { placements } = names(wanted, scale, boxes);
    const all = [...boxes, ...[...placements.values()].map((p) => p.box)];
    assert.deepEqual(collisions(all).map((h) => Math.round(h.area)), [], `scale ${scale}`);
  }
});

test('a citizen label is dropped rather than printed over something else', () => {
  // Ask for far more labels than the frame can hold and check the pass
  // refuses rather than stacks. Whoever is dropped is still in the roster.
  const everyone = city.buildings.filter((b) => b.kind === 'citizen' && !b.unreachable).map((b) => b.id);
  const { boxes } = plates(1);
  const { placements, dropped } = names(everyone, 1, boxes);
  assert.ok(dropped.length > 0, 'nothing was dropped, so nothing was under pressure');
  const all = [...boxes, ...[...placements.values()].map((p) => p.box)];
  assert.deepEqual(collisions(all).map((h) => Math.round(h.area)), [],
    'a label was printed on top of another one under pressure');
  for (const id of dropped) assert.ok(snap.agents.some((a) => a.id === id));
});

test('a label placed away from its subject is marked displaced, so it draws a leader', () => {
  const { cands } = plates(1);
  for (const c of cands) {
    const natural = Math.abs(c.box.cx - c.front.x) < 0.5
      && Math.abs(c.box.cy - (c.front.y + 10 + c.h / 2)) < 0.5;
    assert.equal(c.displaced, !natural, `${c.key} reports the wrong displacement`);
  }
});

test('the obstacle field is the standing city, and only the standing city', () => {
  // A ruin is an empty lot: nothing stands there, so nothing is hidden by a
  // label over it. If this ever counts ruins, labels will start avoiding
  // exactly the eight findings the page is about.
  const ruins = city.buildings.filter((b) => b.kind === 'citizen' && b.unreachable);
  assert.ok(ruins.length > 0, 'the plan has no ruins, so this test proves nothing');
  for (const r of ruins) assert.ok(!obstacles.some((o) => o.id === r.id), `${r.id} is a ruin`);
  const standing = city.buildings.length - ruins.length;
  assert.equal(obstacles.length, standing);
});

test('every obstacle box actually contains its building', () => {
  for (const o of obstacles) {
    const b = byId.get(o.id);
    assert.ok(o.w > 0 && o.h > 0, `${o.id} has an empty box`);
    // The box must be at least as tall as the volume it wraps.
    assert.ok(o.h >= b.height, `${o.id}: box ${o.h} is shorter than its ${b.height}-unit building`);
  }
});

test('the declutter rule holds: at rest the map names places, not people', () => {
  // The 15 precinct plates are the resting label set. Adding the seven
  // director names to it was most of the pile of white boxes, so the resting
  // frame must stay places-only, and the promise the page prints has to
  // match: districts always, people on zoom or on demand.
  const { cands } = plates(1);
  // Eight districts, six guild halls, the Archive, the holding yard for
  // members who declared no division, and the system-utilities yard.
  assert.equal(cands.length, city.plots.size, 'the resting label set is not the precinct set');
  assert.equal(cands.length, 17, 'the plan grew a precinct without this test noticing');
  const html = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8');
  assert.ok(!/Directors are always named/.test(html),
    'the page still promises every director is named at every zoom');
  assert.ok(/named once you zoom past/.test(html),
    'the page does not say when a person gets named');
});

test('the placer prefers the street in front of a plot to the roofs behind it', () => {
  // The single change that fixed the worst case. If a future edit flips the
  // anchor back to the plot's north corner, plates start landing in the
  // roofscape again and this catches it before a screenshot does.
  const { cands } = plates(1);
  const below = cands.filter((c) => c.box.cy > c.front.y).length;
  assert.ok(below >= cands.length * 0.6,
    `only ${below} of ${cands.length} plates sit in front of their plot`);
});

test('the density fallback is real code, not a comment', () => {
  // At full plate size the plan genuinely has nowhere clean for at least one
  // inner district, which is what the fallback exists for. If a future change
  // makes it never fire, this says so rather than leaving dead code that a
  // reviewer would read as a working safety net.
  const { cands } = plates(1);
  const compact = cands.filter((c) => c.compactForm);
  assert.ok(compact.length > 0, 'no plate ever degrades, so the fallback is untested in practice');
  for (const c of compact) {
    assert.ok(c.box.h < 50, `${c.key} is marked compact but is full height`);
  }
  // And it must not be firing everywhere: that would mean the full plate is
  // simply unplaceable and the map has quietly stopped showing member counts.
  assert.ok(compact.length <= cands.length / 2,
    `${compact.length} of ${cands.length} plates degraded: the full plate no longer fits anywhere`);
});

test('intersectionArea is honest about boxes that merely touch', () => {
  const a = { cx: 0, cy: 0, w: 10, h: 10 };
  const b = { cx: 10, cy: 0, w: 10, h: 10 };
  assert.equal(intersectionArea(a, b), 0);
  assert.equal(intersectionArea(a, { cx: 5, cy: 0, w: 10, h: 10 }), 50);
});
