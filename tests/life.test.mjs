/**
 * Gates on the life of the city.
 *
 * Every moving thing maps to a record, so the decisions about WHO moves and
 * WHERE are pure and testable: activity classification against an injected
 * clock, the capability kit from real tool lists, the street router against
 * the real plan (no route through a wall, every door reachable), and the
 * walker schedule (deterministic, and it visits every partnership).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import { doorPoint } from '../site/iso.mjs';
import {
  activityOf, capabilityOf, roofOf, storeysOf, insigniaOf,
  walkerPairs, pairForSlot, buildRoutingGrid, gatesOf, createRouter, walkBetween, doorNode,
  screenPath, pointAlong, walkTiming, walkProgress, footprintOf,
} from '../site/life.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8'));
const workforce = JSON.parse(readFileSync(join(ROOT, 'data', 'workforce.json'), 'utf8'));
const city = computeCity(snap.divisions, snap.agents, snap.edges, snap.skills, snap.unreachable, snap.guilds);
const buildingsById = new Map(city.buildings.map((b) => [b.id, b]));
const agentsById = new Map(snap.agents.map((a) => [a.id, a]));

// ------------------------------------------------------------ activity ---

test('activity is classified against the snapshot clock, never the wall clock', () => {
  const gen = '2026-09-05T20:00:00.000Z';
  assert.equal(activityOf(undefined, gen), 'dormant');
  assert.equal(activityOf({ active: true, lastAt: '2026-09-05T10:00:00.000Z' }, gen), 'active');
  assert.equal(activityOf({ active: false, lastAt: '2026-08-20T10:00:00.000Z' }, gen), 'recent');
  assert.equal(activityOf({ active: false, lastAt: '2026-07-01T10:00:00.000Z' }, gen), 'idle');
  assert.equal(activityOf({ active: false, lastAt: null }, gen), 'idle');
});

test('the real telemetry lights at least one window and leaves at least one dark', () => {
  const states = snap.agents.map((a) => activityOf(workforce.agents.find((w) => w.id === a.id), workforce.generatedAt));
  assert.ok(states.includes('active'), 'nobody active — the telemetry window is empty');
  assert.ok(states.includes('dormant'), 'everybody dispatched — that is not what the logs say');
});

// ----------------------------------------------------------------- kit ---

test('capability discards the universal tools and keeps the three axes', () => {
  const cos = capabilityOf(['Read', 'Glob', 'Grep', 'Write']);
  assert.equal(cos.combo, 'M--');
  assert.equal(cos.primary, 'M');
  assert.deepEqual(cos.secondary, []);
  const ts = capabilityOf(['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write']);
  assert.equal(ts.combo, 'MRS');
  assert.deepEqual(ts.secondary, ['R', 'S']);
  const pm = capabilityOf(['Read', 'Glob', 'Grep']);
  assert.equal(pm.combo, '---');
  assert.equal(pm.primary, null);
});

test('roof form and storeys derive from data only', () => {
  assert.equal(roofOf(['Read', 'Edit']), 'gable');
  assert.equal(roofOf(['Read', 'Bash', 'WebFetch']), 'flat');
  assert.equal(storeysOf(0), 0);
  assert.equal(storeysOf(20), 1);
  assert.equal(storeysOf(41), 4);
  assert.equal(footprintOf({ kind: 'citizen', model: 'opus' }), 0.78);
  assert.equal(footprintOf({ kind: 'citizen', model: null }), 0.70);
  assert.equal(footprintOf({ kind: 'skill' }), 0.62);
});

test('insignia is by division index, a stable notched ring for guilds, none otherwise', () => {
  assert.equal(insigniaOf({ number: '03' }).kind, 'chevron');
  assert.equal(insigniaOf({ number: '00' }).kind, 'bar');
  const g = insigniaOf({ guild: 'design-guild' });
  assert.equal(g.kind, 'ring');
  assert.equal(g.notch, insigniaOf({ guild: 'design-guild' }).notch);
  assert.equal(g.notch % 60, 0);
  assert.equal(insigniaOf({}).kind, 'none');
});

// ------------------------------------------------------------- walkers ---

test('walker pairs are roster citizens only, exclude tooling and system utilities, and are ordered', () => {
  const pairs = walkerPairs(workforce.collaborations, buildingsById, agentsById);
  assert.ok(pairs.length > 0, 'no pairs — the telemetry has collaborations');
  for (const p of pairs) {
    assert.ok(buildingsById.has(p.a) && buildingsById.has(p.b), `${p.a}|${p.b} is not on the map`);
    assert.notEqual(p.a, 'general-purpose');
    assert.notEqual(p.b, 'general-purpose');
    assert.notEqual(p.a, 'Explore');
    assert.notEqual(p.b, 'Explore');
  }
  for (let i = 1; i < pairs.length; i++) {
    const x = pairs[i - 1];
    const y = pairs[i];
    assert.ok(x.sessions > y.sessions || (x.sessions === y.sessions && (x.a < y.a || (x.a === y.a && x.b <= y.b))), 'pairs are not in a total order');
  }
  const again = walkerPairs(workforce.collaborations, buildingsById, agentsById);
  assert.deepEqual(again, pairs, 'the pair list must be identical on every load');
});

test('a pair whose end is not a citizen never walks (planted fixture)', () => {
  const pairs = walkerPairs(
    [{ a: 'general-purpose', b: 'architect', sessions: 9 }, { a: 'architect', b: 'copywriter', sessions: 1 }, { a: 'Explore', b: 'copywriter', sessions: 3 }],
    buildingsById, agentsById,
  );
  assert.deepEqual(pairs.map((p) => `${p.a}|${p.b}`), ['architect|copywriter']);
});

test('twelve slots cycle through every partnership, deterministically', () => {
  const n = 31;
  const cap = 12;
  const seen = new Set();
  for (let cycle = 0; cycle < Math.ceil(n / cap); cycle++) {
    for (let slot = 0; slot < cap; slot++) seen.add(pairForSlot(slot, cycle, n, cap));
  }
  assert.equal(seen.size, n, 'some partnership never walks');
  assert.equal(pairForSlot(3, 2, n, cap), pairForSlot(3, 2, n, cap));
  assert.equal(pairForSlot(0, 0, 0, cap), -1);
});

// ------------------------------------------------------------- streets ---

test('the routing grid blocks the back walls except at their gates', () => {
  const grid = buildRoutingGrid(city);
  const { wall } = city;
  const gates = gatesOf(wall);
  for (let c = wall.col; c <= wall.col + wall.cols; c++) {
    const blocked = grid.blocked[grid.idx(c, wall.row)] === 1;
    assert.equal(blocked, c !== gates.north.col, `north wall at col ${c}`);
  }
  for (let r = wall.row; r <= wall.row + wall.rows; r++) {
    const blocked = grid.blocked[grid.idx(wall.col, r)] === 1;
    assert.equal(blocked, r !== gates.west.row, `west wall at row ${r}`);
  }
  // Front edges are a kerb, not a barrier.
  assert.equal(grid.blocked[grid.idx(wall.col + wall.cols, wall.row + 2)], 0);
});

test('every road and every walk is routable, stays on tile corners, and crosses the wall only at a gate', () => {
  const grid = buildRoutingGrid(city);
  const router = createRouter(grid);
  const { wall } = city;
  const gates = gatesOf(wall);
  const onNorthWall = (n) => n.row === wall.row && n.col >= wall.col && n.col <= wall.col + wall.cols;
  const onWestWall = (n) => n.col === wall.col && n.row >= wall.row && n.row <= wall.row + wall.rows;

  const pairs = walkerPairs(workforce.collaborations, buildingsById, agentsById);
  const legs = [
    ...snap.edges.map((e) => [e.from, e.to]),
    ...pairs.map((p) => [p.a, p.b]),
  ];
  let routed = 0;
  for (const [fromId, toId] of legs) {
    const from = buildingsById.get(fromId);
    const to = buildingsById.get(toId);
    if (!from || !to) continue;
    const walk = walkBetween(router, from, to, footprintOf(from), footprintOf(to));
    assert.ok(walk, `${fromId} -> ${toId} has no street between them`);
    routed += 1;
    assert.deepEqual(walk[0], doorPoint(from.col, from.row, footprintOf(from)).tile, 'a walk starts at the door');
    assert.deepEqual(walk[walk.length - 1], doorPoint(to.col, to.row, footprintOf(to)).tile, 'a walk ends at the door');
    const inner = walk.slice(1, -1);
    assert.deepEqual(inner[0], doorNode(from));
    for (let i = 0; i < inner.length; i++) {
      const n = inner[i];
      assert.ok(Number.isInteger(n.col) && Number.isInteger(n.row), 'a street node is a tile corner');
      if (onNorthWall(n)) assert.equal(n.col, gates.north.col, `crossed the north wall off-gate at ${n.col},${n.row}`);
      if (onWestWall(n)) assert.equal(n.row, gates.west.row, `crossed the west wall off-gate at ${n.col},${n.row}`);
      if (i > 0) {
        const p = inner[i - 1];
        assert.ok((p.col === n.col) !== (p.row === n.row), 'streets run along the grid, never diagonally');
      }
    }
  }
  assert.ok(routed >= snap.edges.length, 'every charter edge should have produced a road');
});

test('routes are deterministic across routers', () => {
  const a = createRouter(buildRoutingGrid(city));
  const b = createRouter(buildRoutingGrid(city));
  const from = buildingsById.get('architect');
  const to = buildingsById.get('copywriter');
  assert.deepEqual(a.route(doorNode(from), doorNode(to)), b.route(doorNode(from), doorNode(to)));
});

test('a walker never enters a building tile', () => {
  // Tile corners are never inside a footprint, so the only way in is the
  // door itself — the first and last point. Everything between must be a
  // corner, which the previous test checks; here, the door is the only
  // fractional point and it is the walker's own building.
  const router = createRouter(buildRoutingGrid(city));
  const from = buildingsById.get('architect');
  const to = buildingsById.get('qa-engineer');
  const walk = walkBetween(router, from, to, footprintOf(from), footprintOf(to));
  const fractional = walk.filter((p) => !Number.isInteger(p.col) || !Number.isInteger(p.row));
  assert.equal(fractional.length, 2);
});

test('screen paths interpolate position and depth monotonically along a leg', () => {
  const path = screenPath([{ col: 0, row: 0 }, { col: 4, row: 0 }, { col: 4, row: 3 }]);
  assert.ok(path.length > 0);
  const p0 = pointAlong(path, 0);
  const p1 = pointAlong(path, path.length);
  assert.deepEqual([p0.x, p0.y], [0, 0]);
  assert.equal(p1.depth, 7);
  let last = -Infinity;
  for (let s = 0; s <= path.length; s += path.length / 20) {
    const p = pointAlong(path, s);
    assert.ok(p.depth >= last - 1e-9, 'depth must not go backwards along +col/+row');
    last = p.depth;
  }
});

test('walk timing goes out, pauses, and comes back', () => {
  const t = walkTiming(520);
  assert.ok(t.leg >= 2500);
  assert.equal(t.total, t.leg * 2 + t.pause);
  assert.deepEqual(walkProgress(t, 0), { s: 0, pausing: false, returning: false });
  assert.equal(walkProgress(t, t.leg).s, 1);
  assert.equal(walkProgress(t, t.leg + t.pause / 2).pausing, true);
  assert.equal(walkProgress(t, t.total).s, 0);
  assert.equal(walkProgress(t, t.total).returning, true);
});
