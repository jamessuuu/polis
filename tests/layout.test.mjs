/**
 * Gates on the city plan.
 *
 * The layout this replaced was force-directed, and the honest problem with
 * it was not that it looked bad — it was that "no two districts overlap" and
 * "no two citizens share a tile" were things you could only establish by
 * looking at the picture. These tests turn both into something that fails a
 * build.
 *
 * Every test runs against the REAL snapshot as well as fixtures, because a
 * checker that has only ever seen fixtures has only ever seen the cases its
 * author already thought of.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import { boxFaces, tilePolygon, toScreen, depthOf, screenBounds, shadowPolygon, variantOf } from '../site/iso.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8'));

const cityOf = (s) => computeCity(s.divisions, s.agents, s.edges, s.skills, s.unreachable, s.guilds);

/** Do two tile rectangles share any tile? Used as the overlap oracle below. */
function overlaps(a, b) {
  return (
    a.col < b.col + b.cols &&
    b.col < a.col + a.cols &&
    a.row < b.row + b.rows &&
    b.row < a.row + a.rows
  );
}

test('the overlap oracle actually fires (planted fixture)', () => {
  // Proving the check can fail, before trusting it to say anything passes.
  assert.equal(overlaps({ col: 0, row: 0, cols: 4, rows: 4 }, { col: 2, row: 2, cols: 4, rows: 4 }), true);
  assert.equal(overlaps({ col: 0, row: 0, cols: 4, rows: 4 }, { col: 3, row: 3, cols: 1, rows: 1 }), true);
  assert.equal(overlaps({ col: 0, row: 0, cols: 4, rows: 4 }, { col: 4, row: 0, cols: 4, rows: 4 }), false);
});

test('no two plots overlap, on the real ecosystem', () => {
  const { plots } = cityOf(snap);
  const list = [...plots.values()];
  assert.ok(list.length >= 8, 'expected at least the eight districts');
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      assert.equal(
        overlaps(list[i], list[j]),
        false,
        `plots "${list[i].key}" and "${list[j].key}" overlap`,
      );
    }
  }
});

test('no two buildings share a tile, on the real ecosystem', () => {
  const { buildings } = cityOf(snap);
  const seen = new Map();
  for (const b of buildings) {
    const key = `${b.col},${b.row}`;
    assert.equal(seen.has(key), false, `${b.id} shares tile ${key} with ${seen.get(key)}`);
    seen.set(key, b.id);
  }
});

test('every citizen and every skill gets exactly one building', () => {
  const { buildings } = cityOf(snap);
  const citizens = buildings.filter((b) => b.kind === 'citizen').map((b) => b.id).sort();
  const skills = buildings.filter((b) => b.kind === 'skill').map((b) => b.id).sort();
  assert.deepEqual(citizens, snap.agents.map((a) => a.id).sort());
  assert.deepEqual(skills, snap.skills.map((s) => s.id).sort());
});

test('every building sits inside its own plot, sidewalk included', () => {
  const { plots, buildings } = cityOf(snap);
  for (const b of buildings) {
    const p = plots.get(b.plotKey);
    assert.ok(p, `${b.id} references a plot that does not exist`);
    assert.ok(b.col > p.col && b.col < p.col + p.cols - 1, `${b.id} is on ${p.key}'s edge, not inside it`);
    assert.ok(b.row > p.row && b.row < p.row + p.rows - 1, `${b.id} is on ${p.key}'s edge, not inside it`);
  }
});

test('districts are inside the wall and holding areas are outside it', () => {
  // The metaphor is load-bearing: being outside the wall means exempt from
  // the constitution, so it has to be literally true on the map.
  const { plots, wall } = cityOf(snap);
  const inside = (p) =>
    p.col >= wall.col && p.row >= wall.row &&
    p.col + p.cols <= wall.col + wall.cols &&
    p.row + p.rows <= wall.row + wall.rows;

  for (const p of plots.values()) {
    if (p.kind === 'district') assert.ok(inside(p), `district ${p.key} escaped the wall`);
    else assert.equal(overlaps(p, wall), false, `${p.key} is meant to be outside the wall but intersects it`);
  }
});

test('the Cabinet holds the centre', () => {
  const { plots } = cityOf(snap);
  const cab = [...plots.values()].find((p) => p.number === '00');
  assert.ok(cab, 'no Cabinet plot');
  assert.ok(cab.col <= 0 && cab.col + cab.cols >= 0, 'the plaza does not contain the origin column');
  assert.ok(cab.row <= 0 && cab.row + cab.rows >= 0, 'the plaza does not contain the origin row');
});

test('the plan is deterministic', () => {
  // The built HTML is committed, so a layout that drifts between runs turns
  // every rebuild into a noisy diff and every diff into something nobody reads.
  const a = cityOf(snap);
  const b = cityOf(snap);
  const key = (c) => JSON.stringify(c.buildings.map((x) => [x.id, x.col, x.row, x.height]));
  assert.equal(key(a), key(b));
});

test('building height encodes degree, and an unreachable citizen is a ruin', () => {
  const { buildings } = cityOf(snap);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  for (const id of snap.unreachable) {
    const b = byId.get(id);
    assert.ok(b, `${id} has no building`);
    assert.equal(b.degree, 0, `${id} is listed unreachable but has ${b.degree} links`);
  }
  const linked = buildings.filter((b) => b.kind === 'citizen' && b.degree > 0);
  const ruins = buildings.filter((b) => b.kind === 'citizen' && b.unreachable);
  if (linked.length && ruins.length) {
    assert.ok(
      Math.min(...linked.map((b) => b.height)) > Math.max(...ruins.map((b) => b.height)),
      'a ruin is drawn at least as tall as a connected citizen, which inverts the encoding',
    );
  }
});

test('an empty division is not given a plot', () => {
  // A district drawn with nothing in it is a claim that something is there.
  const city = computeCity(
    [{ number: '00', name: 'Cabinet' }, { number: '01', name: 'Empty' }],
    [{ id: 'solo', division: '00 Cabinet', director: true, system: false }],
    [],
    [],
    [],
  );
  assert.equal(city.plots.has('01 Empty'), false);
});

test('a snapshot with no skills and no outsiders still plans a city', () => {
  const city = computeCity(
    [{ number: '00', name: 'Cabinet' }],
    [{ id: 'a', division: '00 Cabinet', director: false, system: false }],
    [],
    [],
    [],
  );
  assert.equal(city.buildings.length, 1);
  assert.ok(city.wall.cols > 0 && city.wall.rows > 0);
});

// ------------------------------------------------------------ projection ---

test('the isometric projection is 2:1 and origin-anchored', () => {
  assert.deepEqual(toScreen(0, 0), { x: 0, y: 0 });
  assert.deepEqual(toScreen(1, 0), { x: 32, y: 16 });
  assert.deepEqual(toScreen(0, 1), { x: -32, y: 16 });
  assert.deepEqual(toScreen(1, 1), { x: 0, y: 32 });
});

test('painter depth increases toward the camera', () => {
  assert.ok(depthOf(2, 2) > depthOf(1, 1));
  assert.equal(depthOf(3, 0), depthOf(0, 3));
});

test('a box returns three faces and a taller box reaches higher', () => {
  const low = boxFaces(0, 0, 10);
  const high = boxFaces(0, 0, 40);
  for (const f of ['top', 'left', 'right']) {
    assert.equal(typeof low[f], 'string');
    assert.equal(low[f].split(' ').length, 4, `${f} face should be a quad`);
  }
  assert.ok(high.apex.y < low.apex.y, 'the taller box should have a higher apex (smaller y)');
  assert.equal(high.base.y, low.base.y, 'height must not move the footprint');
});

test('tile and plot polygons are quads with finite coordinates', () => {
  for (const s of [tilePolygon(0, 0), tilePolygon(3, -2, 0.1)]) {
    const pts = s.split(' ');
    assert.equal(pts.length, 4);
    for (const p of pts) for (const n of p.split(',')) assert.ok(Number.isFinite(Number(n)), `bad coord ${p}`);
  }
});

test('screen bounds enclose the whole diamond', () => {
  // A 4x4 tile square projects to a diamond 8 half-tiles wide (4*TILE_W/2 to
  // each side) and 8 half-tiles tall. Written out longhand because the first
  // version of this test used the half-tile by mistake and the projection was
  // blamed for it.
  const b = screenBounds(0, 0, 4, 4);
  assert.equal(b.minX, -128);
  assert.equal(b.maxX, 128);
  assert.equal(b.minY, 0);
  assert.equal(b.maxY, 128);
});

test('a shadow is a six-point hull that grows with height and falls down-left', () => {
  const short = shadowPolygon(0, 0, 10).split(' ').map((p) => p.split(',').map(Number));
  const tall = shadowPolygon(0, 0, 60).split(' ').map((p) => p.split(',').map(Number));
  assert.equal(short.length, 6, 'shadow should be the swept hull, six points');
  assert.equal(tall.length, 6);
  const spread = (pts) => Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  assert.ok(spread(tall) > spread(short), 'a taller box should cast a longer shadow');
  // The light is fixed upper-right, so the shadow must extend LEFT and DOWN.
  const minX = Math.min(...tall.map((p) => p[0]));
  const maxY = Math.max(...tall.map((p) => p[1]));
  assert.ok(minX < Math.min(...short.map((p) => p[0])), 'shadow should reach further left');
  assert.ok(maxY > Math.max(...short.map((p) => p[1])), 'shadow should reach further down');
});

test('a zero-height box casts a shadow no bigger than its own footprint', () => {
  const pts = shadowPolygon(0, 0, 0).split(' ').map((p) => p.split(',').map(Number));
  const spread = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  assert.ok(spread <= 64.01, `a flat object should not cast a long shadow, got ${spread}`);
});

test('silhouette variants are stable per id and spread across buckets', () => {
  assert.equal(variantOf('architect', 4), variantOf('architect', 4));
  assert.notEqual(variantOf('architect', 4), undefined);
  for (const id of ['a', 'chief-of-staff', 'ui-designer']) {
    const v = variantOf(id, 4);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 4, `${id} produced ${v}`);
  }
  // Not a uniformity proof, just a guard against a hash that collapses.
  const seen = new Set(['architect', 'debugger', 'copywriter', 'devops', 'cto', 'counsel',
    'mentor', 'controller'].map((id) => variantOf(id, 4)));
  assert.ok(seen.size > 1, 'every id landed in the same bucket; the hash is not distributing');
});
