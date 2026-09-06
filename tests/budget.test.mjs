/**
 * The element budget, measured.
 *
 * DESIGN.md §8: at most 2,400 SVG elements, no <filter>, and hover must
 * create zero DOM nodes. A renderer that only claims this in a comment is a
 * renderer that will quietly drift past it. So the real renderer runs here
 * against the real snapshot and the real telemetry, on a tiny counting DOM,
 * and the count is asserted — walkers included, since they are pre-created
 * at runtime and counted here as the constant they are.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeCity } from '../site/layout.mjs';
import { renderCity, mountNamePlate, unmountNamePlate } from '../site/city-view.mjs';
import { WALKER_CAP, WALKER_ELEMENTS, createWalkers } from '../site/walkers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(readFileSync(join(ROOT, 'data', 'ecosystem.json'), 'utf8'));
const workforce = JSON.parse(readFileSync(join(ROOT, 'data', 'workforce.json'), 'utf8'));

export const BUDGET = 2400;

/** The smallest DOM that lets the renderer run: it counts, it does not draw. */
function countingDocument() {
  const tags = new Map();
  let created = 0;
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.attrs = {};
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this._text = '';
      const self = this;
      this.style = { setProperty(k, v) { self.attrs[`style:${k}`] = v; } };
      this.classList = {
        add: (...c) => { for (const x of c) self._classes().add(x); self._writeClass(); },
        remove: (...c) => { for (const x of c) self._classes().delete(x); self._writeClass(); },
        toggle: (c, force) => { const set = self._classes(); const on = force == null ? !set.has(c) : force; if (on) set.add(c); else set.delete(c); self._writeClass(); return on; },
        contains: (c) => self._classes().has(c),
      };
    }
    _classes() { if (!this._cls) this._cls = new Set((this.attrs.class || '').split(/\s+/).filter(Boolean)); return this._cls; }
    _writeClass() { this.attrs.class = [...this._cls].join(' '); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this._cls = null; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.children.push(n); return n; }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
      return n;
    }
    removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; return n; }
    get firstChild() { return this.children[0] || null; }
    get lastChild() { return this.children[this.children.length - 1] || null; }
    set textContent(v) { this.children = []; this._text = String(v); }
    get textContent() { return this._text; }
    addEventListener() {}
    get ownerDocument() { return doc; }
    querySelector() { return null; }
  }
  const doc = {
    createElementNS(ns, tag) {
      created += 1;
      tags.set(tag, (tags.get(tag) || 0) + 1);
      return new Node(tag);
    },
    get created() { return created; },
    tags,
    Node,
  };
  return doc;
}

function renderOnce() {
  const doc = countingDocument();
  const svg = new doc.Node('svg');
  const city = computeCity(snap.divisions, snap.agents, snap.edges, snap.skills, snap.unreachable, snap.guilds);
  const scene = renderCity({ svg, data: snap, city, workforce, onSelect: () => {} });
  return { doc, svg, scene, city };
}

test('the walker allowance is the number of elements a walker actually costs', () => {
  // WALKER_ELEMENTS is an allowance the budget below is built on, so it is
  // measured rather than declared. It was one short of the truth from the day
  // it was written, which is exactly the drift a constant with no gate does.
  const { doc, svg, scene } = renderOnce();
  const before = doc.created;
  createWalkers({
    svg,
    pairs: [],
    buildingsById: scene.buildingsById,
    agentsById: scene.agentsById,
    router: scene.router,
    buildLayer: scene.buildLayer,
    buildingOrder: scene.buildingOrder,
    walkLayer: scene.walkLayer,
    figures: scene.figures,
  });
  const perSlot = (doc.created - before) / WALKER_CAP;
  assert.equal(perSlot, WALKER_ELEMENTS, `a walker slot costs ${perSlot} elements, not ${WALKER_ELEMENTS}`);
});

test('the rendered city stays under the element budget, walkers included', () => {
  const { doc } = renderOnce();
  const walkers = WALKER_CAP * WALKER_ELEMENTS;
  const total = doc.created + walkers;
  process.stdout.write(`  elements: ${doc.created} rendered + ${walkers} walker allowance = ${total} of ${BUDGET}\n`);
  assert.ok(total <= BUDGET, `${total} elements exceeds the ${BUDGET} budget`);
});

test('no filter primitives, ever', () => {
  const { doc } = renderOnce();
  for (const tag of doc.tags.keys()) {
    assert.ok(!/^fe[A-Z]/.test(tag) && tag !== 'filter', `a <${tag}> was rendered`);
  }
});

test('hover creates zero DOM nodes: name plates come from a pool', () => {
  const { doc, scene } = renderOnce();
  const before = doc.created;
  const target = scene.citizenEls.get('architect');
  const plate = scene.namePool[0];
  mountNamePlate(plate, target, 'architect');
  assert.equal(plate.id, 'architect');
  assert.ok(plate.outer.classList.contains('on'));
  unmountNamePlate(plate);
  assert.equal(doc.created, before, 'mounting a name plate created a node');
});

test('every citizen has a building; ruins have no volume, no shadow, no figure', () => {
  const { scene } = renderOnce();
  assert.equal(scene.citizenEls.size, snap.agents.length);
  for (const id of snap.unreachable) {
    const g = scene.citizenEls.get(id);
    const tags = g.children.map((c) => c.tagName);
    assert.ok(tags.includes('polygon'), `${id} lot missing`);
    assert.ok(!g.children.some((c) => c.attrs.class && c.attrs.class.includes('figure')), `${id} has a figure on an empty lot`);
    assert.ok(!scene.figures.has(id));
  }
  for (const a of snap.agents) {
    if (snap.unreachable.includes(a.id)) continue;
    assert.ok(scene.figures.has(a.id), `${a.id} has no figure`);
  }
});

test('active citizens are marked from telemetry and dormant ones are not', () => {
  const { scene } = renderOnce();
  const active = new Set(workforce.agents.filter((a) => a.active).map((a) => a.id));
  let lit = 0;
  for (const [id, g] of scene.citizenEls) {
    const isActive = g.attrs.class.includes('act-active');
    assert.equal(isActive, active.has(id), `${id} active mismatch`);
    if (isActive) lit += 1;
  }
  assert.ok(lit > 0);
});

test('the ground haze plane and the object haze plane are the only group-level translucency', () => {
  const { svg } = renderOnce();
  const walk = (n, out = []) => { out.push(n); for (const c of n.children) walk(c, out); return out; };
  const all = walk(svg);
  const groupOpacity = all.filter((n) => n.tagName === 'g' && n.attrs.opacity != null);
  assert.equal(groupOpacity.length, 0, 'a <g> carries an opacity attribute');
  const hazes = all.filter((n) => n.attrs.class && /\bhaze\b/.test(n.attrs.class));
  assert.equal(hazes.length, 2);
});
