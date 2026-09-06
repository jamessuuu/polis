#!/usr/bin/env node
/**
 * Build the site from the snapshot.
 *
 * Copies data/ecosystem.json into site/, then REGENERATES the two parts of
 * index.html that state facts: the stats grid and the static roster.
 *
 * Why this exists: those two regions were hand-authored from a snapshot, and
 * the page told the reader "Every number below comes straight from
 * ecosystem.json" while the numbers were typed by hand. Within minutes of a
 * parser fix the skill count moved 51 -> 50 and the page was wrong. A page
 * about honest measurement cannot carry hand-copied numbers.
 *
 * Standing law 13: every step that CAN be a script SHOULD be a script. This is
 * that step. It is deterministic, idempotent, and has no model in the loop.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteCSS } from '../site/palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'data', 'ecosystem.json');
const SITE_JSON = join(ROOT, 'site', 'ecosystem.json');
const WORKFORCE = join(ROOT, 'data', 'workforce.json');
const SITE_WORKFORCE = join(ROOT, 'site', 'workforce.json');
const PALETTE_CSS = join(ROOT, 'site', 'palette.css');
const INDEX = join(ROOT, 'site', 'index.html');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Replace the inner content of a region delimited by a start tag and its close. */
function replaceRegion(html, startPattern, endTag, inner, label) {
  const m = startPattern.exec(html);
  if (!m) throw new Error(`build-site: could not find ${label}`);
  const openEnd = m.index + m[0].length;
  const closeAt = html.indexOf(endTag, openEnd);
  if (closeAt < 0) throw new Error(`build-site: no ${endTag} closing ${label}`);
  return html.slice(0, openEnd) + '\n' + inner + '\n      ' + html.slice(closeAt);
}

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
copyFileSync(SNAPSHOT, SITE_JSON);

// Telemetry, when it exists. The map stands still without it, honestly.
if (existsSync(WORKFORCE)) copyFileSync(WORKFORCE, SITE_WORKFORCE);

// The palette the page ships is the palette the contrast audit measured.
writeFileSync(PALETTE_CSS, paletteCSS());

// --- stats -----------------------------------------------------------------
const s = snap.stats;
const statRows = [
  ['Citizens', s.agents],
  ['Skills', s.skills],
  ['Districts', s.divisions],
  ['Roads', s.edges],
  ['Directors', s.directors],
  ['Unreachable', s.unreachable],
  ['Withheld', s.withheld],
];
const statsHtml = statRows
  .map(([k, v]) => `        <div><dt>${esc(k)}</dt><dd>${v}</dd></div>`)
  .join('\n');

// --- roster ----------------------------------------------------------------
const byDivision = new Map();
for (const d of snap.divisions) byDivision.set(`${d.number} ${d.name}`, []);
const unplaced = [];
for (const a of snap.agents) {
  if (a.division && byDivision.has(a.division)) byDivision.get(a.division).push(a);
  else unplaced.push(a);
}

const handsTo = (id) => snap.edges.filter((e) => e.from === id).map((e) => e.to).sort();
const receives = (id) => snap.edges.filter((e) => e.to === id).map((e) => e.from).sort();

function agentLi(a) {
  const director = a.director ? ' <span class="tag tag-director">Director</span>' : '';
  const unreachable = snap.unreachable.includes(a.id)
    ? ' <span class="tag tag-warn">Nobody hands this work</span>' : '';
  const to = handsTo(a.id);
  const from = receives(a.id);
  return [
    `        <li class="static-agent" id="static-${esc(a.id)}">`,
    `          <h4>${esc(a.id)}${director}${unreachable}</h4>`,
    `          <p>${esc(a.description)}</p>`,
    `          <p class="static-meta"><strong>Model:</strong> ${esc(a.model || 'no fixed model')} &middot; <strong>Tools:</strong> ${esc(a.tools.join(', ') || 'not declared')}</p>`,
    to.length ? `          <p class="static-edges"><strong>Hands work to:</strong> ${esc(to.join(', '))}</p>` : '',
    from.length ? `          <p class="static-edges"><strong>Receives work from:</strong> ${esc(from.join(', '))}</p>` : '',
    '        </li>',
  ].filter(Boolean).join('\n');
}

/**
 * A district, collapsed.
 *
 * Every citizen is still here — nothing is dropped, nothing is lazy-loaded,
 * and no script is involved. `<details>` is the browser's own disclosure
 * widget, so the no-JS fallback stays complete: one click per district with
 * JavaScript switched off, and in-page find still reaches the closed text.
 * Uncollapsed, this list was 97% of a 23,500px page.
 */
function districtDetails(cls, heading, count, noun, body) {
  return [
    `      <li class="${cls}">`,
    '        <details>',
    `          <summary><h3>${heading} <span class="static-count">(${count} ${count === 1 ? noun[0] : noun[1]})</span></h3></summary>`,
    body,
    '        </details>',
    '      </li>',
  ].join('\n');
}

const districts = [...byDivision.entries()].map(([name, members]) => {
  const [num, ...rest] = name.split(' ');
  const flagged = members.some((a) => snap.unreachable.includes(a.id));
  return districtDetails(
    `static-district${flagged ? ' static-district-flagged' : ''}`,
    `${esc(num)} &middot; ${esc(rest.join(' '))}`,
    members.length, ['citizen', 'citizens'],
    ['        <ul class="static-agent-list">', members.map(agentLi).join('\n'), '        </ul>'].join('\n'),
  );
});

if (unplaced.length) {
  districts.push(districtDetails(
    'static-district', 'No district', unplaced.length, ['citizen', 'citizens'],
    ['        <ul class="static-agent-list">', unplaced.map(agentLi).join('\n'), '        </ul>'].join('\n'),
  ));
}

// The Archive, grouped by the guild that owns each procedure — the same six
// collections the map's palette already draws, rather than one 86-row slab.
const skillLi = (k) => `          <li class="static-skill"><strong>${esc(k.id)}</strong> &mdash; ${esc(k.description)}</li>`;
const skillCollections = [
  ...(snap.guilds || []).map((g) => [g, snap.skills.filter((k) => k.guild === g)]),
  ['Open to every citizen', snap.skills.filter((k) => !k.guild)],
].filter(([, list]) => list.length);

const skillsHtml = [
  '      <h2 id="skills-heading">The archive &mdash; skills</h2>',
  `      <p>${snap.skills.length} procedures the citizens draw on, in ${skillCollections.length} collections. Skills are not citizens: they carry no division, no Director, and no wiring of their own.</p>`,
  '      <ul class="static-district-list">',
  skillCollections.map(([name, list]) => districtDetails(
    'static-district', esc(name), list.length, ['procedure', 'procedures'],
    ['        <ul class="static-skill-list">', list.map(skillLi).join('\n'), '        </ul>'].join('\n'),
  )).join('\n'),
  '      </ul>',
].join('\n');


// --- findings ---------------------------------------------------------------
// Hand-authored prose here said "Withheld - 1" while the generated stat card
// directly above it said 2. Same class of drift as the roster, one layer down,
// and visible on screen. The panels are generated now.
const plural = (n, one, many) => (n === 1 ? one : many);

const unreachableHtml = [
  `        <h3>Unreachable &mdash; ${snap.unreachable.length}</h3>`,
  `        <p>Nobody hands ${snap.unreachable.length === 1 ? 'this citizen' : `these ${snap.unreachable.length} citizens`} work through the declared wiring: no charter names them UPSTREAM or DOWNSTREAM. The constitution's reciprocity rule calls that a violation, not a curiosity.</p>`,
  '        <ul>',
  snap.unreachable.map((id) => {
    const a = snap.agents.find((x) => x.id === id);
    const where = a && a.division ? `sits in ${esc(a.division)}` : 'has no division declared';
    return `          <li><button type="button" class="jump-to-citizen" data-id="${esc(id)}">${esc(id)}</button> &mdash; ${where}.</li>`;
  }).join('\n'),
  '        </ul>',
].join('\n');

const withheldHtml = [
  `        <h3>Withheld &mdash; ${snap.withheld.length}</h3>`,
  `        <p>${snap.withheld.length} ${plural(snap.withheld.length, 'member is', 'members are')} not shown here. ${plural(snap.withheld.length, 'Its', 'Their')} id or description names a real client or employer, so ${plural(snap.withheld.length, 'it is', 'they are')} counted honestly and withheld, not published. The ${plural(snap.withheld.length, 'identifier is', 'identifiers are')} left out too, on purpose: the point of withholding is to publish nothing that could identify who ${plural(snap.withheld.length, 'it names', 'they name')}, and that judgment should hold even when an identifier looks harmless.</p>`,
].join('\n');

const withheldNote = snap.withheld.length
  ? `      <p class="static-meta">${snap.withheld.length} member(s) withheld: ${esc(snap.withheld.map((w) => w.reason).join('; '))}. Their names are not printed.</p>`
  : '';

// --- the headline strip -----------------------------------------------------
// One generator, two render targets. The strip states whichever finding is
// FIRST in this list and nothing else — it holds no independently typed
// number, because a second author of the same number is exactly how this page
// came to publish 45 citizens while the repo said 59.
const findings = [
  { id: 'unreachable-finding', count: snap.unreachable.length, html: unreachableHtml,
    sentence: `of ${s.agents} citizens are named by no charter, upstream or downstream.` },
  { id: 'withheld-finding', count: snap.withheld.length, html: withheldHtml,
    sentence: `of ${s.agents} members are counted here and deliberately not named.` },
];
const lead = findings[0];
const stripHtml = [
  `        <strong class="finding-strip-count">${lead.count}</strong>`,
  `        <span class="finding-strip-text">${lead.sentence}</span>`,
  '        <a href="#findings-section">See the findings &darr;</a>',
].join('\n');

const rosterHtml = [
  '      <h2 id="static-roster-heading">Districts and citizens</h2>',
  `      <p>Generated from <code>ecosystem.json</code> by <code>bin/build-site.mjs</code>. Snapshot taken ${esc(snap.generatedAt)}.</p>`,
  withheldNote,
  '      <ul class="static-district-list">',
  districts.join('\n'),
  '      </ul>',
].filter(Boolean).join('\n');

let html = readFileSync(INDEX, 'utf8');
html = replaceRegion(html, /<dl class="stats-grid">/, '</dl>', statsHtml, 'stats grid');
html = replaceRegion(html, /<section aria-labelledby="static-roster-heading" id="static-roster-section">/, '</section>', rosterHtml, 'static roster');
html = replaceRegion(html, /<section aria-labelledby="skills-heading">/, '</section>', skillsHtml, 'skills archive');
html = replaceRegion(html, /<div class="finding finding-warn" id="unreachable-finding">/, '</div>', unreachableHtml, 'unreachable finding');
html = replaceRegion(html, /<div class="finding" id="withheld-finding">/, '</div>', withheldHtml, 'withheld finding');
html = replaceRegion(html, /<p class="finding finding-strip" id="headline-strip">/, '</p>', stripHtml, 'headline strip');
writeFileSync(INDEX, html);

process.stdout.write(
  `build-site: ${s.agents} citizens, ${s.skills} skills, ${s.divisions} districts, ${s.edges} roads\n` +
  `            stats and roster regenerated from the snapshot; nothing hand-copied\n` +
  `            palette.css generated from site/palette.mjs; workforce ${existsSync(WORKFORCE) ? 'copied' : 'absent'}\n`
);
