/**
 * The studio, checked where it can be checked without a browser.
 *
 * Three things can go quietly wrong in a wiring layer like this one, and each
 * of them is a defect the page would still LOOK fine with:
 *
 *   1. The modules stop being the same modules. `lib/import.mjs` and the
 *      parser it shares with the snapshot are copied into `site/` so the
 *      browser can load them; a copy that drifts from its source is a second
 *      implementation nobody is testing. So the copies are compared byte for
 *      byte, the way `site/ecosystem.json` already is.
 *   2. The gate stops being a gate. `lib/library.mjs` says it plainly: a page
 *      that ships every template wholesale has a courtesy gate, because the
 *      locked bodies are already in the payload. So the shipped library is
 *      searched for the locked charters' own text.
 *   3. The privacy claim stops being true. The page prints one sentence about
 *      the import being local. The mechanical half of that is that no code on
 *      the import path can make a request, and that is asserted here by
 *      reading `site/studio.mjs` and naming every URL it may contain. The
 *      other half is a real network capture in a real browser, which is a
 *      Playwright run, not a unit test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEMPLATES, catalog } from '../lib/library.mjs';
import { buildBundle, validateBundle, normaliseSkillName } from '../lib/export.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = () => read('site/index.html');

const COPIES = [
  ['lib/import.mjs', 'site/lib/import.mjs'],
  ['lib/export.mjs', 'site/lib/export.mjs'],
  ['lib/zip.mjs', 'site/lib/zip.mjs'],
  ['src/extract.mjs', 'site/src/extract.mjs'],
];

// ---------------------------------------------------------------------------
// The shipped modules
// ---------------------------------------------------------------------------

test('every module the browser loads is byte for byte its source', () => {
  for (const [from, to] of COPIES) {
    assert.ok(existsSync(join(ROOT, to)), `${to} missing; run build:site`);
    assert.equal(read(to), read(from), `${to} has drifted from ${from}`);
  }
});

test('the copies keep the relative shape import.mjs resolves against', () => {
  // `site/lib/import.mjs` imports `../src/extract.mjs`. That resolves in the
  // browser only while `site/src/` sits beside `site/lib/`, which is the whole
  // reason the copy targets are shaped this way rather than flattened.
  assert.match(read('site/lib/import.mjs'), /from '\.\.\/src\/extract\.mjs'/);
  assert.ok(existsSync(join(ROOT, 'site/src/extract.mjs')));
});

test('nothing the browser loads reaches for a Node built-in', () => {
  for (const [, to] of COPIES) {
    assert.ok(!/from ['"]node:/.test(read(to)), `${to} imports a Node built-in`);
  }
});

// ---------------------------------------------------------------------------
// The library, and the gate in it
// ---------------------------------------------------------------------------

const library = () => JSON.parse(read('site/library.json'));
const libraryFree = () => JSON.parse(read('site/library-free.json'));

test('the shipped catalog is the library catalog', () => {
  assert.deepEqual(library().catalog, catalog());
});

test('six free and two locked, and the free six are whole', () => {
  const cat = library().catalog;
  assert.equal(cat.length, 8);
  assert.equal(cat.filter((t) => !t.locked).length, 6);
  assert.equal(cat.filter((t) => t.locked).length, 2);

  const free = libraryFree().free;
  assert.equal(Object.keys(free).length, 6);
  for (const t of TEMPLATES.filter((x) => !x.locked)) {
    const shipped = free[t.id];
    assert.ok(shipped, `${t.id} is free and was not shipped`);
    assert.equal(shipped.agents.length, t.agents.length);
    assert.equal(shipped.skills.length, t.skills.length);
    for (const a of shipped.agents) {
      assert.ok(String(a.body).trim().length > 200, `${t.id}/${a.id} shipped without its charter`);
    }
    for (const s of shipped.skills) {
      assert.ok(String(s.body).trim().length > 200, `${t.id}/${s.name} shipped without its procedure`);
    }
  }
});

test('no locked charter body is anywhere in what the browser downloads', () => {
  // The real gate. Every locked member's first line and last line of prose are
  // searched for across both shipped files; either one appearing means the
  // body travelled with the preview.
  const shipped = read('site/library.json') + read('site/library-free.json');
  for (const t of TEMPLATES.filter((x) => x.locked)) {
    for (const member of [...t.agents, ...t.skills]) {
      const lines = String(member.body).split('\n').map((l) => l.trim()).filter((l) => l.length > 40);
      assert.ok(lines.length, `${t.id} member has no body to check`);
      for (const probe of [lines[0], lines[lines.length - 1]]) {
        const encoded = JSON.stringify(probe).slice(1, -1);
        assert.ok(!shipped.includes(encoded), `${t.id} leaked charter prose into the shipped library`);
      }
    }
  }
});

test('a locked card can still show what it contains and why', () => {
  // Locked is not an unopenable box. The preview keeps member names, member
  // descriptions and the reason, because a visitor cannot judge whether to
  // hand over an address for something described as "premium".
  for (const t of library().catalog.filter((x) => x.locked)) {
    assert.ok(t.lockedReason && t.lockedReason.length > 80, `${t.id} does not say why it is locked`);
    assert.equal(t.agents.length, t.counts.agents);
    assert.equal(t.skills.length, t.counts.skills);
    for (const a of t.agents) assert.ok(a.description.length > 40, `${t.id}/${a.id} has no description`);
    assert.ok(t.why.length >= 2, `${t.id} gives no reason to want it`);
  }
});

test('every template city the page draws has roads on it', () => {
  // A template whose members never name each other renders as four separate
  // buildings, which is what most agent packs actually are. The edges come out
  // of the charters, so an empty road list here is a real finding about the
  // template rather than a rendering problem.
  const cities = library().cities;
  assert.equal(Object.keys(cities).length, 8);
  for (const [id, city] of Object.entries(cities)) {
    assert.ok(city.edges.length > 0, `${id} renders with no roads`);
    assert.equal(city.agents.length, city.stats.agents);
    assert.equal(city.scope, 'template');
    for (const a of city.agents) {
      assert.ok(!('body' in a), `${id}/${a.id} carries a body into the city shape`);
    }
  }
});

test('every free template the page can export builds a bundle that validates', async () => {
  const free = libraryFree().free;
  for (const t of Object.values(free)) {
    const bundle = buildBundle({
      title: t.name, summary: t.summary, agents: t.agents, skills: t.skills,
    });
    const verdict = validateBundle(bundle.files);
    assert.ok(verdict.ok, `${t.id}: ${verdict.errors.join('; ')}`);
    assert.ok(bundle.files.some((f) => f.path === 'README.md'));
    assert.equal(
      bundle.files.filter((f) => f.path.startsWith('agents/')).length,
      t.agents.length,
    );
  }
});

test('the library is deterministic: a rebuild writes the same bytes', () => {
  // The snapshot's own timestamp is used rather than a fresh Date, so a build
  // with no data change produces no diff. A file that churns on every build is
  // a file whose diff everybody learns to skip.
  const snap = JSON.parse(read('data/ecosystem.json'));
  assert.equal(library().generatedAt, snap.generatedAt);
  assert.equal(libraryFree().generatedAt, snap.generatedAt);
});

// ---------------------------------------------------------------------------
// The privacy claim, mechanically
// ---------------------------------------------------------------------------

test('studio.mjs can reach exactly three URLs, and none of them on the import path', () => {
  const src = read('site/studio.mjs');
  const urls = [...src.matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
  assert.deepEqual(urls.sort(), ['./library-free.json', './library.json', '/api/lead']);

  // No other way out of the tab. XHR, beacon, WebSocket, EventSource, an
  // <img> ping or a dynamic import of a remote module would each defeat the
  // sentence the page prints.
  for (const banned of [
    'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'importScripts', 'navigator.connection',
  ]) {
    assert.ok(!src.includes(banned), `studio.mjs uses ${banned}`);
  }
});

test('the importer itself still cannot make a request', () => {
  // lib/import.mjs guards this for itself; asserted again on the SHIPPED copy,
  // because the copy is what the browser runs.
  const src = read('site/lib/import.mjs');
  for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
    assert.ok(!src.includes(banned), `the shipped importer uses ${banned}`);
  }
});

test('the page states the local claim where the import controls are', () => {
  const page = html();
  const at = page.indexOf('id="studio-privacy"');
  assert.ok(at > 0, 'the import panel makes no claim about where parsing happens');
  const drop = page.indexOf('id="studio-drop"');
  assert.ok(drop > 0 && drop < at, 'the claim is not attached to the control it is about');
});

// ---------------------------------------------------------------------------
// The markup the module expects
// ---------------------------------------------------------------------------

test('every element studio.mjs reaches for exists in the page', () => {
  const src = read('site/studio.mjs');
  const page = html();
  const ids = new Set([...src.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 20, 'the id sweep found suspiciously little');
  for (const id of ids) {
    assert.ok(page.includes(`id="${id}"`), `studio.mjs reads #${id}, which is not in the page`);
  }
});

test('the studio is inert without JavaScript, and says so', () => {
  const page = html();
  // The shell is hidden in the markup and unhidden by the module only once
  // every control is wired, so there is no window in which a button does
  // nothing.
  assert.match(page, /<div class="studio-shell" id="studio-shell" hidden>/);
  assert.match(page, /<noscript>[\s\S]*?studio-nojs[\s\S]*?<\/noscript>/);
  assert.ok(page.includes('<script type="module" src="./studio.mjs"></script>'));
});

test('the lead form posts the fields the ladder validates, honeypot included', () => {
  const page = html();
  const form = /<form class="studio-gate" id="studio-gate"[\s\S]*?<\/form>/.exec(page);
  assert.ok(form, 'no lead form on the page');
  const f = form[0];
  for (const name of ['name', 'email', 'message', 'botcheck']) {
    assert.ok(f.includes(`name="${name}"`), `the form has no ${name} field`);
  }
  // The honeypot must not be announced to a screen reader or reachable by tab.
  assert.match(f, /class="studio-hp" aria-hidden="true"/);
  assert.match(f, /name="botcheck"[^>]*tabindex="-1"/);
});

test('the form reports every refusal the ladder can return', async () => {
  const { LEAD_REFUSALS } = await import('../lib/lead.mjs');
  const src = read('site/studio.mjs');
  const mapped = /const REFUSALS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(mapped, 'studio.mjs has no refusal table');
  for (const reason of LEAD_REFUSALS) {
    assert.ok(
      mapped[1].includes(`${reason}:`) || mapped[1].includes(`'${reason}':`),
      `the page has nothing to say when the server answers ${reason}`,
    );
  }
  // And it never claims a send it did not get.
  assert.ok(src.includes('body.ok !== true'), 'the page does not check the ok flag');
});

// ---------------------------------------------------------------------------
// House rules
// ---------------------------------------------------------------------------

test('no em dash reaches the page or the studio module', () => {
  for (const file of ['site/index.html', 'site/studio.mjs', 'site/library.json', 'site/library-free.json']) {
    const text = read(file);
    // The static roster quotes real skill descriptions off disk, some of which
    // contain em dashes; that region is generated from ecosystem.json and is
    // not this section's copy. Only the studio's own markup is checked.
    const scope = file === 'site/index.html'
      ? (/<section aria-labelledby="studio-heading"[\s\S]*?<\/section>/.exec(text) || [''])[0]
      : text;
    assert.ok(!scope.includes('—'), `${file} contains an em dash`);
  }
});

test('the footer carries both links, once each, and they are the verified ones', () => {
  const page = html();
  assert.ok(page.includes('https://agentjames.vercel.app'), 'no link to agentjames');
  // Once each. The attribution kit block carries both, and a second hand-
  // authored pair beside it is a footer that has been edited twice by people
  // who could not see each other's work.
  assert.equal((page.match(/agentjames.vercel.app/g) || []).length, 1);
  assert.equal((page.match(/linkedin.com/g) || []).length, 1);
  // Not the vanity handle. `https://www.linkedin.com/in/jameslorenzsantos` and
  // a deliberately fake profile BOTH answer LinkedIn's 999 anti-bot status, so
  // that response is no evidence at all. This one is the address James's own
  // portfolio publishes in src/content/data/index.ts, and it answers 301.
  assert.ok(
    page.includes('https://www.linkedin.com/in/james-lorenz-santos-720776251/'),
    'no link to LinkedIn, or not the address his own site publishes',
  );
});

/**
 * One unusable member must not cost the visitor the other 295 files.
 *
 * `validateBundle` is strict, and it should be: a SKILL.md with no description
 * breaks the specification and will not load where it lands. But a real
 * `~/.claude` on this machine produces 296 files of which exactly ONE skill
 * has an empty description, and refusing the whole download for it would be
 * the same mistake `lib/import.mjs` refuses to make on the way in.
 *
 * The studio therefore builds, and on a failure rebuilds WITHOUT the members
 * the validator named, then says which it left out. Rebuilding rather than
 * deleting the file matters: the README lists what is in the archive, so a
 * deleted file would leave the listing describing something that is not there.
 * This test covers the strategy at the level the studio composes it from.
 */
test('a bundle refused for one bad skill is rebuilt without that skill', () => {
  const skills = [
    { name: 'good-one', description: 'A skill with a real description that the spec accepts.', body: 'Steps.' },
    { name: 'half-written', description: '', body: 'Steps.' },
    { name: 'good-two', description: 'Another skill with a real description.', body: 'Steps.' },
  ];
  const make = (dropped) => buildBundle({
    title: 'T',
    agents: [],
    skills: skills.filter((s) => !dropped.has(normaliseSkillName(s.name).name)),
  });

  const first = make(new Set());
  const v1 = validateBundle(first.files);
  assert.equal(v1.ok, false, 'the empty description was accepted, so the retry is untested');

  const rejected = new Set(
    v1.errors.map((e) => (/^skills\/([^/]+)\/SKILL\.md:/.exec(e) || [])[1]).filter(Boolean),
  );
  assert.deepEqual([...rejected], ['half-written']);

  const second = make(rejected);
  const v2 = validateBundle(second.files);
  assert.ok(v2.ok, `the rebuild still fails: ${v2.errors.join('; ')}`);
  const paths = second.files.map((f) => f.path);
  assert.ok(paths.includes('skills/good-one/SKILL.md'));
  assert.ok(paths.includes('skills/good-two/SKILL.md'));
  assert.ok(!paths.some((p) => p.includes('half-written')), 'the refused skill is still in the archive');
  // And the README no longer advertises it, which is why the bundle is rebuilt
  // rather than having the one file removed from it.
  const readme = second.files.find((f) => f.path === 'README.md');
  assert.ok(!readme.text.includes('half-written'), 'the README still lists a file that is not in the zip');
  assert.match(readme.text, /2 skills/);
});

test('the studio does the rebuild rather than refusing outright', () => {
  const src = read('site/studio.mjs');
  assert.match(src, /function rejectedSkills\(errors\)/, 'no way to read which member the validator refused');
  assert.match(src, /bundle = make\(dropped\);/, 'the bundle is never rebuilt without the refused member');
  assert.match(src, /left out/, 'the page never says what it left out');
});
