/**
 * Polis map layout.
 *
 * A small deterministic force-directed layout — no physics library, no
 * randomness that changes between loads. Every citizen gets a seed derived
 * from its own id (a tiny string hash feeding a mulberry32 PRNG), so the
 * jitter around its starting point is stable: reload the page and the city
 * looks the same.
 *
 * The shape of the city follows the constitution, not decoration:
 *   - "00 Cabinet" is the plaza at the centre (it is the ecosystem's router;
 *     chief-of-staff literally hands work to and receives it from almost
 *     everyone, so the busiest square in town is the honest place for it).
 *   - The other seven divisions ring the plaza, evenly spaced.
 *   - A citizen with `division: null` (not `system`) has no division to
 *     stand in, so it gets its own holding area outside the ring, and that
 *     area is labelled for what it is on the map, not folded quietly into a
 *     division it does not belong to.
 *   - A `system: true` citizen (ships with Claude Code, exempt from the
 *     admission standard) gets a separate dock, drawn with a different
 *     shape so it is never mistaken for an ordinary citizen.
 *
 * Positions come from running simple physics (pairwise repulsion + edge
 * springs + a weak pull toward each citizen's anchor) for a fixed number of
 * steps, synchronously, once, at load. No animation loop — the settle
 * happens before anything is drawn, which is also why there is nothing here
 * that needs to respect prefers-reduced-motion.
 */

export const CANVAS = { width: 1000, height: 800 };
const CENTER = { x: CANVAS.width / 2, y: CANVAS.height / 2 };
const RING_RADIUS = 260;
export const UNASSIGNED_ANCHOR = { x: 120, y: 705 };
export const SYSTEM_ANCHOR = { x: 880, y: 705 };

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function divisionKey(d) {
  return `${d.number} ${d.name}`;
}

/**
 * @param {Array<{number:string,name:string}>} divisions
 * @param {Array<{id:string,division:string|null,system:boolean}>} agents
 * @param {Array<{from:string,to:string}>} edges
 * @returns {{
 *   positions: Map<string,{x:number,y:number}>,
 *   districtShapes: Map<string,{cx:number,cy:number,r:number}>,
 *   anchors: Map<string,{x:number,y:number}>
 * }}
 */
export function computeLayout(divisions, agents, edges) {
  const ring = divisions.filter((d) => d.number !== '00');
  const cabinet = divisions.find((d) => d.number === '00');
  const anchors = new Map();
  if (cabinet) anchors.set(divisionKey(cabinet), { x: CENTER.x, y: CENTER.y });
  ring.forEach((d, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
    anchors.set(divisionKey(d), {
      x: CENTER.x + RING_RADIUS * Math.cos(angle),
      y: CENTER.y + RING_RADIUS * Math.sin(angle),
    });
  });

  const nodes = agents.map((a) => {
    const rnd = mulberry32(hashSeed(a.id));
    let anchor;
    if (a.system) anchor = SYSTEM_ANCHOR;
    else if (a.division && anchors.has(a.division)) anchor = anchors.get(a.division);
    else anchor = UNASSIGNED_ANCHOR;
    const jitterR = a.system || !a.division ? 26 : 78;
    const jAngle = rnd() * Math.PI * 2;
    const jr = rnd() * jitterR;
    return {
      id: a.id,
      anchor,
      x: anchor.x + Math.cos(jAngle) * jr,
      y: anchor.y + Math.sin(jAngle) * jr,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = edges
    .map((e) => ({ a: byId.get(e.from), b: byId.get(e.to) }))
    .filter((l) => l.a && l.b);

  const REPULSION = 900;
  const SPRING_LEN = 68;
  const SPRING_K = 0.02;
  const ANCHOR_K = 0.035;
  const DAMPING = 0.85;
  const ITERATIONS = 420;
  const PAD = 34;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
    for (const { a, b } of links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const diff = (dist - SPRING_LEN) * SPRING_K;
      const fx = (dx / dist) * diff;
      const fy = (dy / dist) * diff;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const n of nodes) {
      n.vx += (n.anchor.x - n.x) * ANCHOR_K;
      n.vy += (n.anchor.y - n.y) * ANCHOR_K;
    }
    for (const n of nodes) {
      n.vx *= DAMPING; n.vy *= DAMPING;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.min(CANVAS.width - PAD, Math.max(PAD, n.x));
      n.y = Math.min(CANVAS.height - PAD, Math.max(PAD, n.y));
    }
  }

  const positions = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  const districtShapes = new Map();
  for (const d of divisions) {
    const key = divisionKey(d);
    const members = agents.filter((a) => a.division === key);
    if (!members.length) continue;
    let cx = 0, cy = 0;
    for (const m of members) {
      const p = positions.get(m.id);
      cx += p.x; cy += p.y;
    }
    cx /= members.length; cy /= members.length;
    let r = 0;
    for (const m of members) {
      const p = positions.get(m.id);
      r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
    }
    districtShapes.set(key, { cx, cy, r: r + 48, count: members.length });
  }

  return { positions, districtShapes, anchors };
}
