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

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteCSS } from '../site/palette.mjs';
import { catalog, TEMPLATES, templateEcosystem, templateSkills, verifyClaims } from '../lib/library.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'data', 'ecosystem.json');
const SITE_JSON = join(ROOT, 'site', 'ecosystem.json');
const WORKFORCE = join(ROOT, 'data', 'workforce.json');
const SITE_WORKFORCE = join(ROOT, 'site', 'workforce.json');
const PALETTE_CSS = join(ROOT, 'site', 'palette.css');
const INDEX = join(ROOT, 'site', 'index.html');
const LIBRARY_JSON = join(ROOT, 'site', 'library.json');
const LIBRARY_FREE_JSON = join(ROOT, 'site', 'library-free.json');

/**
 * The four modules the studio runs in the browser, and the one parser they
 * share.
 *
 * They are COPIED, not re-authored. `lib/import.mjs` imports
 * `../src/extract.mjs`, so the copies keep the same relative shape
 * (`site/lib/` beside `site/src/`) and the import resolves in the browser
 * without touching the source. Two copies of a parser is how a page starts
 * telling a visitor something the tests no longer check.
 */
const SHIPPED_MODULES = [
  ['lib/import.mjs', 'site/lib/import.mjs'],
  ['lib/export.mjs', 'site/lib/export.mjs'],
  ['lib/zip.mjs', 'site/lib/zip.mjs'],
  ['src/extract.mjs', 'site/src/extract.mjs'],
];

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

// --- the studio's modules --------------------------------------------------
for (const [from, to] of SHIPPED_MODULES) {
  const dst = join(ROOT, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(ROOT, from), dst);
}

// --- the library, split at the gate ----------------------------------------
//
// `lib/library.mjs` states where the gate has to live: a page that bundles
// every template wholesale has a courtesy gate, because the locked bodies are
// then already in the payload the browser downloaded. So this build writes two
// different things into one file.
//
//   catalog  every template's preview, free and locked. Names, descriptions,
//            counts and the reason a locked one is worth having. No bodies.
//   cities   every template drawn in the ecosystem.json shape, free and
//            locked, so a locked card can still show its city. The shape
//            carries ids, descriptions and wiring and no charter prose, which
//            is exactly what a preview may contain.
// and a second file, `library-free.json`, holds the six free templates in
// full, bodies included, so the browser can build their bundles with no server
// in the loop. It is a separate fetch because browsing costs a visitor the
// previews only; the prose arrives when they ask for a bundle.
//
// The two locked templates' charter bodies are in NEITHER file. They are
// released by api/lead.mjs after a lead is captured, and by nothing else.
const claimFailures = [];
for (const t of TEMPLATES) {
  const verdict = verifyClaims(t);
  if (!verdict.ok) {
    for (const f of verdict.failures) claimFailures.push(`${t.id}: ${f.claim} (${f.reason})`);
  }
}
if (claimFailures.length) {
  throw new Error(`build-site: a template advertises something its charters do not say\n  ${claimFailures.join('\n  ')}`);
}

const library = {
  // The snapshot's own timestamp, so a rebuild with no data change writes the
  // same bytes. A fresh Date() here would churn the file on every build and
  // teach everyone to ignore the diff.
  generatedAt: snap.generatedAt,
  catalog: catalog(),
  cities: Object.fromEntries(
    TEMPLATES.map((t) => [t.id, templateEcosystem(t, { now: snap.generatedAt })]),
  ),
};
const libraryFree = {
  generatedAt: snap.generatedAt,
  free: Object.fromEntries(
    TEMPLATES.filter((t) => !t.locked).map((t) => [t.id, {
      id: t.id,
      name: t.name,
      summary: t.summary,
      agents: t.agents,
      skills: templateSkills(t),
    }]),
  ),
};
writeFileSync(LIBRARY_JSON, `${JSON.stringify(library, null, 2)}\n`);
writeFileSync(LIBRARY_FREE_JSON, `${JSON.stringify(libraryFree, null, 2)}\n`);

// The gate, asserted here as well as in tests/studio.test.mjs, because a build
// that silently ships a locked body is worse than a build that fails.
const shipped = readFileSync(LIBRARY_JSON, 'utf8') + readFileSync(LIBRARY_FREE_JSON, 'utf8');
for (const t of TEMPLATES.filter((x) => x.locked)) {
  // Agents AND skills. The two locked templates hold eight charters and six
  // skill procedures of around a thousand characters each, and the skills were
  // not being probed at all, so the guard covered eight of fourteen members
  // while its comment claimed it covered a leak.
  for (const member of [...t.agents, ...t.skills]) {
    const name = member.id ?? member.name;
    const lines = String(member.body ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 40);
    for (const probe of [lines[0], lines[lines.length - 1]]) {
      if (!probe) continue;
      if (shipped.includes(JSON.stringify(probe).slice(1, -1))) {
        throw new Error(`build-site: locked charter ${t.id}/${name} leaked into the shipped library`);
      }
    }
  }
}

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
  '      <details class="panel">',
  '        <summary><h2 id="skills-heading">The archive &mdash; skills</h2></summary>',
  `      <p>${snap.skills.length} procedures the citizens draw on, in ${skillCollections.length} collections. Skills are not citizens: they carry no division, no Director, and no wiring of their own.</p>`,
  '      <ul class="static-district-list">',
  skillCollections.map(([name, list]) => districtDetails(
    'static-district', esc(name), list.length, ['procedure', 'procedures'],
    ['        <ul class="static-skill-list">', list.map(skillLi).join('\n'), '        </ul>'].join('\n'),
  )).join('\n'),
  '      </ul>',
  '      </details>',
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
//
// It is also the page's onboarding, and it does that job by being an
// INVITATION as well as a finding (GAME-DESIGN §3/§5): the sentence states
// the number for the skimmer who will never click anything, and the link
// beside it hands the first click to everyone else, already aimed at a real
// citizen the number is about. `jump` is the id that link opens — chosen by
// the generator from the finding's own list, never typed here, and simply
// absent for a finding whose members are deliberately unnamed.
const findings = [
  { id: 'unreachable-finding', count: snap.unreachable.length, html: unreachableHtml,
    sentence: `of ${s.agents} citizens answer to nobody &mdash; no charter names them, upstream or downstream.`,
    invite: 'Click one to see why', jump: snap.unreachable[0] || null },
  { id: 'withheld-finding', count: snap.withheld.length, html: withheldHtml,
    sentence: `of ${s.agents} members are counted here and deliberately not named.`,
    invite: null, jump: null },
];
const lead = findings[0];
const stripHtml = [
  `        <strong class="finding-strip-count">${lead.count}</strong>`,
  `        <span class="finding-strip-text">${lead.sentence}</span>`,
  // A real anchor, not a button: with JavaScript off it still lands on that
  // citizen's entry in the static roster, and with JavaScript on the same
  // handler that runs the findings list selects them on the map instead.
  lead.invite && lead.jump
    ? `        <a class="jump-to-citizen strip-go" href="#static-${esc(lead.jump)}" data-id="${esc(lead.jump)}">${lead.invite} &rarr;</a>`
    : '',
  `        <a href="#findings-section">See all ${lead.count} &darr;</a>`,
].filter(Boolean).join('\n');

const rosterHtml = [
  '      <details class="panel">',
  '        <summary><h2 id="static-roster-heading">Districts and citizens</h2></summary>',
  `      <p>Generated from <code>ecosystem.json</code> by <code>bin/build-site.mjs</code>. Snapshot taken ${esc(snap.generatedAt)}.</p>`,
  withheldNote,
  '      <ul class="static-district-list">',
  districts.join('\n'),
  '      </ul>',
  '      </details>',
].filter(Boolean).join('\n');

/**
 * The figures under the map, as chips rather than a paragraph.
 *
 * Same numbers as the stats grid, same source, one generator: a second author
 * of the same number is how this page once published 45 citizens while the
 * repo said 59. The chips are what a reader sees at rest; the grid is still
 * there under Status for anyone who wants the whole board.
 */
const figures = [
  ['citizens', s.agents, ''],
  ['districts', s.divisions, ''],
  ['roads', s.edges, ''],
  ['skills', s.skills, ''],
  ['unreachable', s.unreachable, ' figure-warn'],
];
const figuresHtml = figures
  .map(([label, value, cls]) => `          <li class="figure${cls}"><b>${value}</b> ${label}</li>`)
  .join('\n');

let html = readFileSync(INDEX, 'utf8');
html = replaceRegion(html, /<dl class="stats-grid">/, '</dl>', statsHtml, 'stats grid');
html = replaceRegion(html, /<ul class="map-figures" id="map-figures" aria-label="What is on the map">/, '</ul>', figuresHtml, 'map figures');
html = replaceRegion(html, /<section aria-labelledby="static-roster-heading" id="static-roster-section">/, '</section>', rosterHtml, 'static roster');
html = replaceRegion(html, /<section aria-labelledby="skills-heading">/, '</section>', skillsHtml, 'skills archive');
html = replaceRegion(html, /<div class="finding finding-warn" id="unreachable-finding">/, '</div>', unreachableHtml, 'unreachable finding');
html = replaceRegion(html, /<div class="finding" id="withheld-finding">/, '</div>', withheldHtml, 'withheld finding');
html = replaceRegion(html, /<p class="finding finding-strip" id="headline-strip">/, '</p>', stripHtml, 'headline strip');
writeFileSync(INDEX, html);

const freeCount = TEMPLATES.filter((t) => !t.locked).length;
process.stdout.write(
  `build-site: ${s.agents} citizens, ${s.skills} skills, ${s.divisions} districts, ${s.edges} roads\n` +
  `            stats and roster regenerated from the snapshot; nothing hand-copied\n` +
  `            palette.css generated from site/palette.mjs; workforce ${existsSync(WORKFORCE) ? 'copied' : 'absent'}\n` +
  `            library.json: ${TEMPLATES.length} previews and cities; library-free.json: ${freeCount} templates in full\n` +
  `            ${SHIPPED_MODULES.length} modules copied to site/ for the studio; no parser duplicated\n`
);
