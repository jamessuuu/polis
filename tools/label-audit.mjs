#!/usr/bin/env node
/**
 * Measure label collision on the real page, in a real browser.
 *
 * "The labels overlap" is an opinion until someone counts them. This opens
 * the built site in Chromium and WebKit at the two widths that matter, reads
 * the client rect of every VISIBLE label (precinct plates and name plates),
 * and reports:
 *
 *   - label x label overlaps: how many pairs share pixels, and by how much
 *   - label x building overlaps: how many labels sit on a building silhouette
 *   - the worst offenders by area, so a fix has something to aim at
 *
 * It also drives the two hover states that used to be the worst case (a
 * director's name over its own district plate) so the audit covers the frames
 * a visitor actually creates, not only the resting frame.
 *
 *   node tools/label-audit.mjs [--url http://localhost:8099/] [--shots]
 *
 * Playwright is borrowed from the agentjames install by absolute path, so this
 * repo keeps zero runtime dependencies.
 */

import { chromium, webkit } from 'file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const url = flag('--url', 'http://localhost:8099/');
const out = flag('--out', 'C:/Users/admin/polis/.audit').replace(/\\/g, '/');
const tag = flag('--tag', 'now');
const wantShots = args.includes('--shots');

const VIEWS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

// Read every label the visitor can actually see, in page pixels.
const MEASURE = function measure() {
  const svg = document.getElementById('city-map');
  if (!svg) return { error: 'no #city-map' };
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity) < 0.05) return false;
    return true;
  };
  const visibleUp = (el) => {
    let n = el;
    while (n && n !== svg) { if (!vis(n)) return false; n = n.parentElement; }
    return true;
  };
  const boxOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };

  const labels = [];
  for (const el of svg.querySelectorAll('.precinct-plate')) {
    if (!visibleUp(el)) continue;
    const t = el.querySelector('.plate-line1');
    labels.push({ tier: 'T1', name: (t ? t.textContent : '').trim(), ...boxOf(el.querySelector('.plate-bg') || el) });
  }
  for (const el of svg.querySelectorAll('.name-plate')) {
    const bg = el.querySelector('.plate-bg');
    if (!bg || !visibleUp(bg)) continue;
    const t = el.querySelector('.plate-name');
    const name = (t ? t.textContent : '').trim();
    if (!name) continue;
    const b = boxOf(bg);
    if (b.w < 2 || b.h < 2) continue;
    labels.push({ tier: el.classList.contains('is-director') ? 'T2' : 'T3', name, ...b });
  }

  // Building silhouettes: the roof face is the readable top of every volume.
  const buildings = [];
  for (const el of svg.querySelectorAll('.structure')) {
    if (!visibleUp(el)) continue;
    const roof = el.querySelector('.face-top, .roof, .gable-lit') || el;
    const b = boxOf(roof);
    if (b.w < 1 || b.h < 1) continue;
    buildings.push({ id: el.getAttribute('data-id') || '', ...b });
  }

  return { labels, buildings, viewBox: svg.getAttribute('viewBox'), elements: svg.querySelectorAll('*').length };
};

const overlapArea = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

function analyse(m) {
  const pairs = [];
  for (let i = 0; i < m.labels.length; i++) {
    for (let j = i + 1; j < m.labels.length; j++) {
      const a = overlapArea(m.labels[i], m.labels[j]);
      if (a > 1) pairs.push({ a: m.labels[i], b: m.labels[j], area: Math.round(a) });
    }
  }
  const onBuilding = [];
  for (const l of m.labels) {
    let worst = 0; let who = '';
    for (const b of m.buildings) {
      const a = overlapArea(l, b);
      if (a > worst) { worst = a; who = b.id; }
    }
    // A label is "on" a building when it hides a real part of the roof.
    const cover = worst / Math.max(1, l.w * l.h);
    if (cover > 0.12) onBuilding.push({ label: l.name, tier: l.tier, over: who, cover: Math.round(cover * 100) });
  }
  pairs.sort((x, y) => y.area - x.area);
  onBuilding.sort((x, y) => y.cover - x.cover);
  return { pairs, onBuilding };
}

async function runOne(engine, name, view, states) {
  const browser = await engine.launch();
  const rows = [];
  for (const st of states) {
    const ctx = await browser.newContext({
      viewport: VIEWS[view],
      hasTouch: view === 'phone',
      isMobile: view === 'phone' && name === 'chromium',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#map-section:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(600);
    if (st.hover) {
      const h = await page.$(`[data-id="${st.hover}"]`);
      if (h) { await h.hover({ force: true }); await page.waitForTimeout(350); }
    }
    if (st.click) {
      const h = await page.$(`[data-id="${st.click}"]`);
      if (h) { await h.click({ force: true }); await page.waitForTimeout(400); }
    }
    const m = await page.evaluate(MEASURE);
    if (m.error) { rows.push({ state: st.label, error: m.error }); await ctx.close(); continue; }
    const r = analyse(m);
    rows.push({
      state: st.label,
      labels: m.labels.length,
      pairs: r.pairs.length,
      worstPair: r.pairs[0] ? `${r.pairs[0].a.name} x ${r.pairs[0].b.name} (${r.pairs[0].area}px2)` : '-',
      onBuilding: r.onBuilding.length,
      worstBuilding: r.onBuilding[0] ? `${r.onBuilding[0].label} covers ${r.onBuilding[0].cover}% on ${r.onBuilding[0].over}` : '-',
      elements: m.elements,
      viewBox: m.viewBox,
      errors: errs,
      detail: r,
    });
    if (wantShots && st.shot) {
      await page.screenshot({ path: `${out}/${tag}-${name}-${view}-${st.shot}.png`, fullPage: false });
      await page.screenshot({ path: `${out}/${tag}-${name}-${view}-${st.shot}-full.png`, fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
  return rows;
}

const STATES = [
  { label: 'rest', shot: 'rest' },
  { label: 'hover chief-of-staff', hover: 'chief-of-staff', shot: 'hover' },
  { label: 'select architect', click: 'architect', shot: 'select' },
];

const { mkdirSync } = await import('node:fs');
mkdirSync(out, { recursive: true });

let totalPairs = 0;
let totalOnBuilding = 0;
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  for (const view of ['desktop', 'phone']) {
    const rows = await runOne(engine, name, view, STATES);
    for (const r of rows) {
      if (r.error) { process.stdout.write(`[${name}/${view}] ${r.state}: ERROR ${r.error}\n`); continue; }
      totalPairs += r.pairs;
      totalOnBuilding += r.onBuilding;
      process.stdout.write(
        `[${name}/${view}] ${r.state}: labels=${r.labels} overlapping-pairs=${r.pairs} on-building=${r.onBuilding} elements=${r.elements}\n`
        + `    worst pair : ${r.worstPair}\n`
        + `    worst cover: ${r.worstBuilding}\n`,
      );
      for (const p of r.detail.pairs.slice(0, 6)) {
        process.stdout.write(`      collide: ${p.a.tier} "${p.a.name}" x ${p.b.tier} "${p.b.name}" = ${p.area}px2\n`);
      }
      for (const e of r.errors) process.stdout.write(`      pageerror: ${e}\n`);
    }
  }
}
process.stdout.write(`\nTOTAL overlapping label pairs: ${totalPairs}\nTOTAL labels on a building: ${totalOnBuilding}\n`);
process.exitCode = 0;
