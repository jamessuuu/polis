/**
 * The site must not state a number the snapshot does not.
 *
 * The stats grid and the roster were hand-authored once, while the page told
 * the reader "Every number below comes straight from ecosystem.json". A parser
 * fix moved the skill count from 51 to 50 and the page was silently wrong
 * within minutes. These tests exist so that cannot happen again quietly.
 *
 * No network, no browser: the built HTML is read off disk and compared against
 * the snapshot it claims to come from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'site', 'index.html');
const SNAPSHOT = join(ROOT, 'data', 'ecosystem.json');
const SITE_JSON = join(ROOT, 'site', 'ecosystem.json');

const html = () => readFileSync(INDEX, 'utf8');
const snap = () => JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

function statFromPage(label) {
  const re = new RegExp(`<dt>${label}</dt><dd>(\\d+)</dd>`);
  const m = re.exec(html());
  return m ? Number(m[1]) : null;
}

test('every stat on the page equals the snapshot', () => {
  const s = snap().stats;
  assert.equal(statFromPage('Citizens'), s.agents);
  assert.equal(statFromPage('Skills'), s.skills);
  assert.equal(statFromPage('Districts'), s.divisions);
  assert.equal(statFromPage('Roads'), s.edges);
  assert.equal(statFromPage('Directors'), s.directors);
  assert.equal(statFromPage('Unreachable'), s.unreachable);
  assert.equal(statFromPage('Withheld'), s.withheld);
});

test('every agent in the snapshot appears in the static roster', () => {
  // The static roster is the no-JS fallback, so a missing member is invisible
  // to exactly the readers who cannot fall back to anything else.
  const page = html();
  for (const a of snap().agents) {
    assert.ok(page.includes(`id="static-${a.id}"`), `${a.id} missing from the static roster`);
  }
});

test('no withheld member is named anywhere on the page', () => {
  // The count is published; the identity is not. This is the one leak that
  // would matter, so it is asserted rather than assumed.
  const page = html();
  for (const w of snap().withheld) {
    assert.ok(!page.includes(w.id), `withheld member ${w.id} was named on the page`);
  }
});

test('the site copy of the snapshot matches the source snapshot', () => {
  assert.ok(existsSync(SITE_JSON), 'site/ecosystem.json missing; run build:site');
  assert.equal(readFileSync(SITE_JSON, 'utf8'), readFileSync(SNAPSHOT, 'utf8'));
});

test('the site copy of the telemetry matches the source telemetry', () => {
  const src = join(ROOT, 'data', 'workforce.json');
  const dst = join(ROOT, 'site', 'workforce.json');
  assert.ok(existsSync(dst), 'site/workforce.json missing; run build:site');
  assert.equal(readFileSync(dst, 'utf8'), readFileSync(src, 'utf8'));
});

test('the shipped palette is the generated palette', async () => {
  const { paletteCSS } = await import('../site/palette.mjs');
  const css = join(ROOT, 'site', 'palette.css');
  assert.ok(existsSync(css), 'site/palette.css missing; run build:site');
  assert.equal(readFileSync(css, 'utf8'), paletteCSS());
  assert.ok(html().includes('href="./palette.css"'), 'index.html does not link the palette');
});

test('the page carries no charter body text', () => {
  // extract.mjs never puts bodies in the snapshot; this asserts the site did
  // not reintroduce them from somewhere else.
  const page = html();
  assert.ok(!/UPSTREAM:/.test(page), 'a raw charter UPSTREAM line reached the page');
  assert.ok(!/DOWNSTREAM:/.test(page), 'a raw charter DOWNSTREAM line reached the page');
});

test('the headline strip is a finding AND an invitation, aimed at a real citizen', () => {
  // GAME-DESIGN §3/§5: the strip does onboarding's job by handing over the
  // first click. The number and the sentence still come from the same
  // generator pass as the findings panel (never typed twice), and the link's
  // target has to be a citizen the finding is actually about — a strip that
  // invites a click into a name the snapshot does not contain would be the
  // same class of failure as a hand-typed count.
  const page = html();
  const strip = /<p class="finding finding-strip" id="headline-strip">([\s\S]*?)<\/p>/.exec(page);
  assert.ok(strip, 'no headline strip on the page');
  const body = strip[1];
  const s = snap();
  assert.ok(body.includes(`<strong class="finding-strip-count">${s.unreachable.length}</strong>`),
    'the strip count is not the unreachable count');
  const jump = /class="jump-to-citizen strip-go" href="#static-([^"]+)" data-id="([^"]+)"/.exec(body);
  assert.ok(jump, 'the strip states a finding but never invites a click');
  assert.equal(jump[1], jump[2], 'the no-JS anchor and the JS target disagree');
  assert.ok(s.unreachable.includes(jump[2]), `the strip invites a click into ${jump[2]}, who is not one of the ${s.unreachable.length}`);
  // With JavaScript off that link still has somewhere to land.
  assert.ok(page.includes(`id="static-${jump[2]}"`), 'the invitation lands nowhere without JavaScript');
});

test('the dark half is a real control, reachable without touching the map', () => {
  // Concept 1 is the page's most shareable fact turned into a place. It is a
  // <button> in the toolbar rather than a map gesture, so the keyboard path
  // does not run through the SVG, and it carries a pressed state rather than
  // relying on its label alone.
  const page = html();
  assert.ok(/<button type="button" id="map-dark-half"[^>]*aria-pressed="false"[^>]*>/.test(page),
    'no dark-half toggle, or it does not report its pressed state');
  assert.ok(page.includes('id="map-dark-note"'), 'the dark half states no numbers');
});

test('the panel offers the next move before it offers the record', () => {
  // Closing the loop is sequencing: the citizens this one works with are
  // already lit when the panel opens, so they belong above the metadata, not
  // under it. Asserted on document order because that IS the change.
  const page = html();
  const next = page.indexOf('id="panel-next-lead"');
  const links = page.indexOf('id="panel-downstream"');
  const meta = page.indexOf('class="panel-meta"');
  const tools = page.indexOf('id="panel-tools"');
  assert.ok(next > 0 && links > 0 && meta > 0 && tools > 0, 'the panel is missing a section');
  assert.ok(next < links, 'the connected set is not introduced');
  assert.ok(links < meta && links < tools, 'the record still comes before the next move');
  assert.ok(page.indexOf('id="panel-hops-block"') > 0, 'a dead end has no honest next hop to offer');
});
