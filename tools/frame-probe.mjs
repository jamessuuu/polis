#!/usr/bin/env node
/**
 * What fraction of the hero is actually city?
 *
 * "The map looks empty" is another opinion until someone measures it. This
 * reports the viewBox, the container, the on-screen box of the built area
 * (the wall), and the height of one citizen in CSS pixels, so a framing
 * change can be judged by numbers rather than by taste.
 */

import { chromium } from 'file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const url = flag('--url', 'http://localhost:8099/');

const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();

for (const [name, viewport] of Object.entries(VIEWS)) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#map-section:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(500);
  const f = await page.evaluate(() => {
    const svg = document.getElementById('city-map');
    const hero = svg.parentElement;
    const hb = hero.getBoundingClientRect();
    const wall = svg.querySelector('.board-inner');
    const wb = wall ? wall.getBoundingClientRect() : null;
    const plinth = svg.querySelector('.board-outer');
    const pb = plinth ? plinth.getBoundingClientRect() : null;
    const fig = svg.querySelector('.structure.kind-citizen .figure');
    const fb = fig ? fig.getBoundingClientRect() : null;
    const bl = svg.querySelector('.building-layer');
    const bb = bl ? bl.getBoundingClientRect() : null;
    return {
      viewBox: svg.getAttribute('viewBox'),
      hero: { x: hb.x, y: hb.y, w: hb.width, h: hb.height },
      wall: wb && { w: wb.width, h: wb.height },
      plinth: pb && { w: pb.width, h: pb.height },
      buildings: bb && { w: bb.width, h: bb.height },
      figurePx: fb ? fb.height : null,
      mapTop: hb.y,
    };
  });
  const cov = f.buildings ? (f.buildings.w * f.buildings.h) / (f.hero.w * f.hero.h) : 0;
  process.stdout.write(
    `[${name}] viewBox=${f.viewBox}\n`
    + `  hero ${Math.round(f.hero.w)}x${Math.round(f.hero.h)} at y=${Math.round(f.mapTop)}\n`
    + `  plinth ${f.plinth ? Math.round(f.plinth.w) + 'x' + Math.round(f.plinth.h) : '-'}`
    + `  buildings ${f.buildings ? Math.round(f.buildings.w) + 'x' + Math.round(f.buildings.h) : '-'}`
    + `  coverage ${(cov * 100).toFixed(1)}%\n`
    + `  one citizen = ${f.figurePx ? f.figurePx.toFixed(1) : '-'} CSS px tall\n`,
  );
  await ctx.close();
}
await browser.close();
process.exitCode = 0;
