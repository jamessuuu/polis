#!/usr/bin/env node
/**
 * How long a frame actually takes, while the map is being driven.
 *
 * The render budget is about interaction, not about page load: this map is
 * ~2,350 SVG nodes and the question that matters is whether panning and
 * zooming it stays smooth. So this samples `requestAnimationFrame` deltas
 * during three real interactions - an idle second with the walkers moving, a
 * drag-pan, and a wheel-zoom - and reports median, p95 and the worst frame,
 * plus how many frames missed 60fps.
 *
 * Chromium and WebKit, desktop and phone viewports. Numbers from a desktop
 * class machine; that is stated rather than passed off as a phone number.
 *
 *   node tools/frame-timing.mjs [--url http://localhost:8099/]
 */

import { chromium, webkit } from 'file:///C:/Users/admin/agentjames/node_modules/playwright/index.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const url = flag('--url', 'http://localhost:8099/');

const VIEWS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

const START = function start() {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
};

const STOP = function stop() {
  cancelAnimationFrame(window.__raf);
  const f = window.__frames.slice(2).sort((a, b) => a - b);
  const at = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))] || 0;
  return {
    n: f.length,
    median: at(0.5),
    p95: at(0.95),
    worst: f[f.length - 1] || 0,
    over16: f.filter((x) => x > 16.7).length,
    over33: f.filter((x) => x > 33.4).length,
  };
};

const fmt = (r) => `median ${r.median.toFixed(1)}ms p95 ${r.p95.toFixed(1)}ms worst ${r.worst.toFixed(1)}ms `
  + `(${r.n} frames, ${r.over16} over 16.7ms, ${r.over33} over 33.4ms)`;

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  for (const [view, viewport] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ viewport, hasTouch: view === 'phone' });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#map-section:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const box = await page.locator('#city-map').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // 1. idle: walkers and window pulses running, nobody touching anything
    await page.evaluate(START);
    await page.waitForTimeout(1500);
    const idle = await page.evaluate(STOP);

    // 2. drag-pan across the city
    await page.evaluate(START);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(cx - i * 9, cy - i * 4);
      await page.waitForTimeout(12);
    }
    await page.mouse.up();
    const pan = await page.evaluate(STOP);

    // 3. wheel-zoom in and back out, which re-places every label
    await page.evaluate(START);
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -110); await page.waitForTimeout(45); }
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 110); await page.waitForTimeout(45); }
    const zoom = await page.evaluate(STOP);

    const nodes = await page.evaluate(() => document.getElementById('city-map').querySelectorAll('*').length);
    process.stdout.write(`[${name}/${view}] ${nodes} SVG nodes\n`);
    process.stdout.write(`  idle : ${fmt(idle)}\n`);
    process.stdout.write(`  pan  : ${fmt(pan)}\n`);
    process.stdout.write(`  zoom : ${fmt(zoom)}\n`);
    await ctx.close();
  }
  await browser.close();
}
process.exitCode = 0;
