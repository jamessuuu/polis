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

import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'data', 'ecosystem.json');
const SITE_JSON = join(ROOT, 'site', 'ecosystem.json');
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

const districts = [...byDivision.entries()].map(([name, members]) => {
  const [num, ...rest] = name.split(' ');
  const flagged = members.some((a) => snap.unreachable.includes(a.id));
  return [
    `      <li class="static-district${flagged ? ' static-district-flagged' : ''}">`,
    `        <h3>${esc(num)} &middot; ${esc(rest.join(' '))} <span class="static-count">(${members.length} citizens)</span></h3>`,
    '        <ul class="static-agent-list">',
    members.map(agentLi).join('\n'),
    '        </ul>',
    '      </li>',
  ].join('\n');
});

if (unplaced.length) {
  districts.push([
    '      <li class="static-district">',
    `        <h3>No district <span class="static-count">(${unplaced.length} citizens)</span></h3>`,
    '        <ul class="static-agent-list">',
    unplaced.map(agentLi).join('\n'),
    '        </ul>',
    '      </li>',
  ].join('\n'));
}

const skillsHtml = [
  '      <h2 id="skills-heading">The archive &mdash; skills</h2>',
  `      <p>${snap.skills.length} procedures the citizens draw on. Skills are not citizens: they carry no division, no Director, and no wiring of their own.</p>`,
  '      <ul class="static-skill-list">',
  snap.skills.map((k) => `        <li class="static-skill"><strong>${esc(k.id)}</strong> &mdash; ${esc(k.description)}</li>`).join('\n'),
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
writeFileSync(INDEX, html);

process.stdout.write(
  `build-site: ${s.agents} citizens, ${s.skills} skills, ${s.divisions} districts, ${s.edges} roads\n` +
  `            stats and roster regenerated from the snapshot; nothing hand-copied\n`
);
