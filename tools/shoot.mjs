#!/usr/bin/env node
/**
 * Render the map and look at it.
 *
 * Screenshots #map-section at 1440px and a 2x crop of the Cabinet plaza, in
 * light and dark, two seconds in so the animations are mid-cycle. Also prints
 * what a screenshot cannot show: element count, viewBox, walkers out, console
 * errors, and whether reduced motion really stops everything.
 *
 *   node tools/shoot.mjs [--url http://localhost:8099/] [--out .]
 *
 * Playwright is borrowed from the agentjames install by absolute path, so this
 * repo keeps zero runtime dependencies.
 */

import { chromium } from 'file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const url = flag('--url', 'http://localhost:8099/');
const out = flag('--out', 'C:/Users/admin/polis').replace(/\\/g, '/');
const themes = (flag('--themes', 'light,dark')).split(',');

const browser = await chromium.launch();
const report = [];

async function shoot(theme, { scale = 1, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: scale, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForSelector('#map-section:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const facts = await page.evaluate(() => {
    const svg = document.getElementById('city-map');
    const P = window.__polis || {};
    const walkers = P.walkers ? P.walkers.slots.filter((s) => s.pair).map((s) => `${s.walkerId}>${s.hostId}`) : [];
    const anim = [...svg.querySelectorAll('*')].filter((e) => getComputedStyle(e).animationName !== 'none').length;
    const running = [...svg.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return cs.animationName !== 'none' && cs.animationPlayState === 'running'; }).length;
    const cos = document.querySelector('[data-id="chief-of-staff"]');
    const r = cos ? cos.getBoundingClientRect() : null;
    const section = document.getElementById('map-section').getBoundingClientRect();
    return {
      elements: svg.querySelectorAll('*').length,
      viewBox: svg.getAttribute('viewBox'),
      walkers,
      animatedElements: anim,
      runningAnimations: running,
      plaza: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      section: { x: section.x, y: section.y, w: section.width, h: section.height },
      pairs: P.pairs ? P.pairs.length : 0,
      lifeOff: svg.classList.contains('life-off'),
    };
  });

  const suffix = `${theme}${reduced ? '-reduced' : ''}`;
  if (!reduced) {
    if (scale === 1) {
      await page.locator('#map-section').screenshot({ path: `${out}/.shot-${suffix}.png` });
    } else if (facts.plaza) {
      const p = facts.plaza;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const W = 520; const H = 360;
      await page.screenshot({ path: `${out}/.shot-plaza-${suffix}.png`, clip: { x: Math.max(0, cx - W / 2), y: Math.max(0, cy - H / 2 - 30), width: W, height: H } });
    }
  }
  report.push({ theme: suffix, scale, ...facts, errors });
  await ctx.close();
}

for (const theme of themes) {
  await shoot(theme, { scale: 1 });
  await shoot(theme, { scale: 2 });
}
await shoot('light', { reduced: true });
await browser.close();

for (const r of report) {
  process.stdout.write(`[${r.theme} @${r.scale}x] elements=${r.elements} viewBox=${r.viewBox} pairs=${r.pairs} walkersOut=${r.walkers.length} animated=${r.animatedElements} running=${r.runningAnimations} lifeOff=${r.lifeOff}\n`);
  if (r.walkers.length) process.stdout.write(`    walking: ${r.walkers.join(', ')}\n`);
  for (const e of r.errors) process.stdout.write(`    ${e}\n`);
}
