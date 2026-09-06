/**
 * Citizens walking the collaboration graph.
 *
 * `data/workforce.json` records which agents were dispatched on the same
 * project in the same session. Each of those pairs is a real partnership,
 * and here it is drawn as one: a figure leaves its own front door, walks the
 * streets to its partner's door, pauses, and walks home. While it is out,
 * its standing figure is gone — the person left, they were not copied.
 *
 * Twelve walk at once; the rest cycle through, so the city always has people
 * moving and never a swarm. Motion is JS-driven on `transform` only, because
 * a walker changes depth as it moves and has to be re-inserted into the
 * building layer's painter order — and a declarative animation restarts when
 * its element is reinserted, which would reset every walk at every corner.
 *
 * Nothing here is random. Given the same telemetry, the same pairs walk in
 * the same order on every load.
 */

import {
  pairForSlot, slotDelay, walkBetween, screenPath, pointAlong, walkTiming, walkProgress,
  footprintOf, capabilityOf,
} from './life.mjs';
import { figure, hueClassFor } from './city-view.mjs';

const INSTRUMENT_D = {
  M: 'M 0 0 L 0.9 -0.5 L 4.4 -4.2 L 3.4 -5 Z',
  R: 'M -0.4 -0.4 L 3.2 -4 L 4 -3.2 L 0.4 0.4 Z M 2.1 -3.6 a 1.5 1.5 0 1 0 3 0 a 1.5 1.5 0 1 0 -3 0 Z M 3 -3.6 a 0.6 0.6 0 1 0 1.2 0 a 0.6 0.6 0 1 0 -1.2 0 Z',
  S: 'M -0.3 -0.3 L 2.3 -2.9 L 2.9 -2.3 L 0.3 0.3 Z M 1.8 -3.4 a 1.6 1.6 0 1 0 3.2 0 a 1.6 1.6 0 1 0 -3.2 0 Z M 2.5 -3.4 a 0.9 0.9 0 1 0 1.8 0 a 0.9 0.9 0 1 0 -1.8 0 Z',
  none: 'M 0 0 L 3.04 -0.99 L 1.74 -4.98 L -1.3 -3.99 Z',
};

export const WALKER_CAP = 12;
export const WALKER_ELEMENTS = 9; // per slot, pre-created; counted in the budget test

export function createWalkers({
  svg, pairs, cap = WALKER_CAP, buildingsById, agentsById, router,
  buildLayer, buildingOrder, walkLayer, figures, onWalk,
}) {
  const doc = svg.ownerDocument;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const slots = [];
  const away = new Set();
  const pathCache = new Map();
  let running = false;
  let raf = 0;
  let lastFrame = 0;
  let pausedAt = 0;
  const pending = [];

  // Pre-create every walker once: a generic citizen re-dressed per walk by
  // class (tunic, mantle) and one `d` swap (instrument). No churn.
  for (let i = 0; i < cap; i++) {
    const route = doc.createElementNS(SVG_NS, 'path');
    route.setAttribute('class', 'walk-route');
    walkLayer.appendChild(route);
    const el = figure({ item: { tools: ['Write'], director: true }, hueClass: 'hue-none', activity: 'idle', walker: true });
    el.setAttribute('transform', 'translate(0 0)');
    buildLayer.appendChild(el);
    slots.push({
      slot: i, el, route, pair: null, path: null, timing: null, startedAt: 0, cycle: 0,
      walkerId: null, hostId: null, lastX: 0, orderIndex: -1,
      tool: el.querySelector('.fig-tool'),
    });
  }

  const upperBound = (depth) => {
    let lo = 0;
    let hi = buildingOrder.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (buildingOrder[mid].depth <= depth) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  function dress(w, agent, building) {
    const hue = hueClassFor(building);
    const cls = ['figure', 'walker', hue];
    if (agent.director) cls.push('is-director');
    w.el.setAttribute('class', cls.join(' '));
    w.tool.setAttribute('d', INSTRUMENT_D[capabilityOf(agent.tools).primary || 'none']);
    w.el.setAttribute('aria-hidden', 'true');
  }

  function launch(slot, cycle) {
    const w = slots[slot];
    w.cycle = cycle;
    if (!running) { pending.push([slot, cycle]); return; }
    if (!pairs.length) return;
    const base = pairForSlot(slot, cycle, pairs.length, cap);
    for (let tries = 0; tries < pairs.length; tries++) {
      const pair = pairs[(base + tries) % pairs.length];
      let walkerId = null;
      let hostId = null;
      if (!away.has(pair.a)) { walkerId = pair.a; hostId = pair.b; }
      else if (!away.has(pair.b)) { walkerId = pair.b; hostId = pair.a; }
      if (!walkerId) continue;
      const from = buildingsById.get(walkerId);
      const to = buildingsById.get(hostId);
      const agent = agentsById.get(walkerId);
      if (!from || !to || !agent) continue;
      const key = `${walkerId}>${hostId}`;
      let path = pathCache.get(key);
      if (!path) {
        const tiles = walkBetween(router, from, to, footprintOf(from), footprintOf(to));
        if (!tiles) continue;
        path = screenPath(tiles);
        pathCache.set(key, path);
      }
      w.pair = pair;
      w.walkerId = walkerId;
      w.hostId = hostId;
      w.path = path;
      w.timing = walkTiming(path.length);
      w.startedAt = performance.now();
      w.lastX = path.pts[0].x;
      w.orderIndex = -1;
      dress(w, agent, from);
      w.route.setAttribute('d', path.d);
      w.route.classList.add('on');
      w.el.classList.add('on');
      away.add(walkerId);
      const standing = figures.get(walkerId);
      if (standing) standing.classList.add('away');
      if (onWalk) onWalk({ slot, pair, walkerId, hostId, sessions: pair.sessions });
      return;
    }
    // Everyone in the next pairs is already out. Try again shortly.
    setTimeout(() => launch(slot, cycle + 1), 2500);
  }

  function finish(w) {
    w.el.classList.remove('on', 'pausing');
    w.route.classList.remove('on');
    away.delete(w.walkerId);
    const standing = figures.get(w.walkerId);
    if (standing) standing.classList.remove('away');
    const slot = w.slot;
    const cycle = w.cycle + 1;
    w.pair = null;
    w.walkerId = null;
    setTimeout(() => launch(slot, cycle), 900);
  }

  function frame(now) {
    if (!running) return;
    if (lastFrame && now - lastFrame > 500) {
      // The tab was hidden; freeze walk time rather than teleporting everyone.
      for (const w of slots) if (w.pair) w.startedAt += now - lastFrame;
    }
    lastFrame = now;
    for (const w of slots) {
      if (!w.pair) continue;
      const t = now - w.startedAt;
      if (t >= w.timing.total) { finish(w); continue; }
      const pr = walkProgress(w.timing, t);
      const p = pointAlong(w.path, pr.s * w.path.length);
      w.el.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
      const dx = p.x - w.lastX;
      if (Math.abs(dx) > 0.08) {
        w.el.style.setProperty('--flip', dx < 0 ? '-1' : '1');
        w.lastX = p.x;
      }
      if (pr.pausing !== w.el.classList.contains('pausing')) w.el.classList.toggle('pausing', pr.pausing);
      const idx = upperBound(p.depth);
      if (idx !== w.orderIndex) {
        w.orderIndex = idx;
        buildLayer.insertBefore(w.el, idx < buildingOrder.length ? buildingOrder[idx].el : null);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastFrame = 0;
    for (let i = 0; i < cap; i++) setTimeout(() => launch(i, 0), slotDelay(i));
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    pausedAt = performance.now();
  }

  function resume() {
    if (running) return;
    const gap = performance.now() - pausedAt;
    for (const w of slots) if (w.pair) w.startedAt += gap;
    running = true;
    lastFrame = 0;
    const queued = pending.splice(0);
    for (const [slot, cycle] of queued) launch(slot, cycle);
    raf = requestAnimationFrame(frame);
  }

  return { start, pause, resume, slots, get running() { return running; }, awayIds: () => [...away] };
}
