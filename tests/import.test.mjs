/**
 * The importer, against in-memory file bags. No real disk, no network.
 *
 * Two groups of tests carry most of the weight. The first is resilience: a
 * malformed charter must cost its own line in a report and nothing else, the
 * way `src/workforce.mjs` treats a malformed log line. The second is the
 * network claim: the offer is that a visitor's charters never leave the tab,
 * and the last test in this file reads the module's own source to keep that
 * true after the next edit rather than after the next incident.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importFiles, importZip, importPastedFile, findRoot, classify, IMPORT_LIMITS } from '../lib/import.mjs';
import { writeZip } from '../lib/zip.mjs';

const NOW = '2026-09-07T00:00:00.000Z';

const agent = (name, desc, body = '') =>
  `---\nname: ${name}\ndescription: ${desc}\ntools: Read, Grep\nmodel: opus\n---\n${body}`;

const skill = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`;

const ECOSYSTEM = [
  '## 3. Organization',
  '',
  '- **00 Cabinet** \u2014 router (Director), planner',
  '- **01 Engineering** \u2014 builder (Director), checker',
  '',
  '**System agents** (`Explore`, `Plan`) ship with the tool and are exempt.',
].join('\n');

const WIRED = [
  'You do the thing.',
  '',
  '## Interface',
  '',
  '- UPSTREAM: router (the approved ask).',
  '- DOWNSTREAM: checker (reviews what you produced).',
].join('\n');

function tree(prefix = '.claude') {
  return [
    { path: `${prefix}/ECOSYSTEM.md`, text: ECOSYSTEM },
    { path: `${prefix}/agents/router.md`, text: agent('router', 'Routes work.', 'You route.\n\n- DOWNSTREAM: builder (takes the routed task).') },
    { path: `${prefix}/agents/builder.md`, text: agent('builder', 'Builds things.', WIRED) },
    { path: `${prefix}/agents/checker.md`, text: agent('checker', 'Checks things.', 'You check.\n\n- UPSTREAM: builder (the change).') },
    { path: `${prefix}/skills/ship-it/SKILL.md`, text: skill('ship-it', 'Ships a change.') },
    { path: `${prefix}/skills/ship-it/references/REFERENCE.md`, text: 'not a skill, a bundled resource' },
    { path: `${prefix}/README.md`, text: 'not a charter' },
  ];
}

// ---------------------------------------------------------------------------
// Path handling
// ---------------------------------------------------------------------------

test('the root is found no matter how deeply the drop is wrapped', () => {
  assert.deepEqual(findRoot(['.claude/agents/a.md']), ['.claude']);
  assert.deepEqual(findRoot(['backup-2026/.claude/skills/x/SKILL.md']), ['backup-2026', '.claude']);
  assert.deepEqual(findRoot(['agents/a.md']), []);
  assert.deepEqual(findRoot(['notes.md']), []);
});

test('the shortest prefix wins, so guild directories do not become the root', () => {
  assert.deepEqual(
    findRoot(['.claude/guilds/design/agents/a.md', '.claude/agents/b.md']),
    ['.claude'],
  );
});

test('classify separates charters from bundled resources', () => {
  assert.deepEqual(classify(['agents', 'a.md']), { kind: 'agent', guild: null, stem: 'a' });
  assert.deepEqual(classify(['skills', 'x', 'SKILL.md']), { kind: 'skill', guild: null, stem: 'x' });
  assert.equal(classify(['skills', 'x', 'scripts', 'run.py']), null);
  assert.equal(classify(['agents', 'archive', 'old.md']), null);
  assert.equal(classify(['agents', 'notes.txt']), null);
  assert.deepEqual(classify(['ECOSYSTEM.md']), { kind: 'constitution', guild: null });
});

test('a guild name comes from the directory above agents, and wrappers do not count as guilds', () => {
  assert.equal(classify(['guilds', 'design-guild', 'agents', 'a.md']).guild, 'design-guild');
  assert.equal(classify(['plugins', 'toolkit', 'skills', 'x', 'SKILL.md']).guild, 'toolkit');
  assert.equal(classify(['guilds', 'agents', 'a.md']).guild, null);
  assert.equal(classify(['.claude', 'agents', 'a.md']).guild, null);
});

// ---------------------------------------------------------------------------
// Shape one: a directory tree
// ---------------------------------------------------------------------------

test('a .claude tree becomes the ecosystem.json shape the renderer already reads', () => {
  const { ecosystem } = importFiles(tree(), { now: NOW });
  assert.deepEqual(
    Object.keys(ecosystem).sort(),
    ['agents', 'divisions', 'edges', 'generatedAt', 'guilds', 'scope', 'skills', 'stats', 'unreachable', 'withheld'].sort(),
  );
  assert.equal(ecosystem.generatedAt, NOW);
  assert.equal(ecosystem.scope, 'imported');
  assert.equal(ecosystem.stats.agents, 3);
  assert.equal(ecosystem.stats.skills, 1);
  assert.equal(ecosystem.stats.divisions, 2);
  const builder = ecosystem.agents.find((a) => a.id === 'builder');
  assert.deepEqual(Object.keys(builder).sort(), ['description', 'director', 'division', 'guild', 'id', 'model', 'system', 'tools'].sort());
  assert.deepEqual(builder.tools, ['Read', 'Grep']);
  assert.equal(builder.model, 'opus');
  assert.equal(builder.division, '01 Engineering');
  assert.equal(builder.director, true);
});

test('a tree with no .claude wrapper works the same way', () => {
  const { ecosystem } = importFiles(tree('.'), { now: NOW });
  assert.equal(ecosystem.stats.agents, 3);
});

test('a zip with a dated wrapper folder works the same way', () => {
  const { ecosystem } = importFiles(tree('claude-backup-2026-09/.claude'), { now: NOW });
  assert.equal(ecosystem.stats.agents, 3);
  assert.equal(ecosystem.stats.skills, 1);
});

test('edges come from the UPSTREAM and DOWNSTREAM declarations and are deduplicated', () => {
  const { ecosystem } = importFiles(tree(), { now: NOW });
  const keys = ecosystem.edges.map((e) => `${e.from}->${e.to}`).sort();
  // router->builder is declared by BOTH router (DOWNSTREAM) and builder
  // (UPSTREAM). Two charters agreeing is the convention working, not two roads.
  assert.deepEqual(keys, ['builder->checker', 'router->builder']);
});

test('system agents named by the constitution are marked and exempt from the audit', () => {
  const files = tree();
  files.push({ path: '.claude/agents/Explore.md', text: agent('Explore', 'Search runtime.') });
  const { ecosystem } = importFiles(files, { now: NOW });
  const explore = ecosystem.agents.find((a) => a.id === 'Explore');
  assert.equal(explore.system, true);
  assert.ok(!ecosystem.unreachable.includes('Explore'));
});

test('guild members carry their guild and are counted in the guild list', () => {
  const files = tree();
  files.push({ path: '.claude/guilds/design/agents/stylist.md', text: agent('stylist', 'Styles things.') });
  files.push({ path: '.claude/guilds/design/skills/palette/SKILL.md', text: skill('palette', 'Builds a palette.') });
  const { ecosystem } = importFiles(files, { now: NOW });
  assert.deepEqual(ecosystem.guilds, ['design']);
  assert.equal(ecosystem.agents.find((a) => a.id === 'stylist').guild, 'design');
  assert.equal(ecosystem.skills.find((s) => s.id === 'palette').guild, 'design');
});

// ---------------------------------------------------------------------------
// Resilience: counted and skipped, never fatal
// ---------------------------------------------------------------------------

test('a charter with no frontmatter is counted and skipped, and the rest still import', () => {
  const files = tree();
  files.push({ path: '.claude/agents/broken.md', text: 'just some notes, no frontmatter at all' });
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.stats.agents, 3);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, 'no YAML frontmatter');
  assert.match(report.skipped[0].path, /broken\.md$/);
});

test('an unterminated frontmatter block is skipped rather than swallowing the file', () => {
  const files = tree();
  files.push({ path: '.claude/agents/half.md', text: '---\nname: half\ndescription: never closed\n' });
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.agents.some((a) => a.id === 'half'), false);
  const hit = report.skipped.filter((s) => /half/.test(s.path));
  assert.equal(hit.length, 1);
  assert.equal(hit[0].reason, 'the frontmatter block is never closed');
});

test('a byte order mark or a leading blank line does not lose a real charter', () => {
  // Both are ordinary in files that have been through a Windows editor or a
  // copy and paste, and both defeat a naive match on the opening delimiter.
  const files = [
    { path: 'agents/bom.md', text: '﻿' + agent('bom', 'Has a byte order mark.') },
    { path: 'agents/blank.md', text: '\n\n' + agent('blank', 'Starts with blank lines.') },
  ];
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.deepEqual(ecosystem.agents.map((a) => a.id).sort(), ['blank', 'bom']);
  assert.deepEqual(report.skipped, []);
});

test('a charter with no name falls back to its filename', () => {
  const { ecosystem } = importFiles(
    [{ path: 'agents/fallback-name.md', text: '---\ndescription: no name field\n---\nbody' }],
    { now: NOW },
  );
  assert.equal(ecosystem.agents[0].id, 'fallback-name');
});

test('a duplicate id keeps the first and reports the second', () => {
  const files = tree();
  files.push({ path: '.claude/guilds/other/agents/builder.md', text: agent('builder', 'A different builder.') });
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.agents.filter((a) => a.id === 'builder').length, 1);
  assert.equal(ecosystem.agents.find((a) => a.id === 'builder').description, 'Builds things.');
  assert.deepEqual(report.duplicates.map((d) => d.id), ['builder']);
});

test('nothing recognisable produces an empty ecosystem and a note, not a crash', () => {
  const { ecosystem, report } = importFiles([{ path: 'notes/todo.txt', text: 'hello' }], { now: NOW });
  assert.equal(ecosystem.stats.agents, 0);
  assert.equal(ecosystem.stats.skills, 0);
  assert.ok(report.notes.some((n) => /Nothing looked like a charter/.test(n)));
});

test('an empty or missing input is answered, not thrown', () => {
  assert.equal(importFiles([], { now: NOW }).ecosystem.stats.agents, 0);
  assert.equal(importFiles(null, { now: NOW }).ecosystem.stats.agents, 0);
  assert.equal(importFiles(undefined, { now: NOW }).report.filesSeen, 0);
});

test('an oversized single file is skipped by name and the rest survive', () => {
  const files = tree();
  files.push({ path: '.claude/agents/huge.md', text: 'x'.repeat(IMPORT_LIMITS.maxFileBytes + 1) });
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.stats.agents, 3);
  assert.ok(report.skipped.some((s) => /huge\.md/.test(s.path) && /larger than 2 MB/.test(s.reason)));
});

test('too many files is reported as truncation rather than obeyed silently', () => {
  const many = [];
  for (let i = 0; i < IMPORT_LIMITS.maxFiles + 5; i++) many.push({ path: `agents/a${i}.md`, text: agent(`a${i}`, 'x') });
  const { report } = importFiles(many, { now: NOW });
  assert.match(report.truncated, /only the first/);
});

// ---------------------------------------------------------------------------
// The wiring audit only runs when the convention is in use
// ---------------------------------------------------------------------------

test('an ecosystem with no wiring declarations is not accused of being entirely unreachable', () => {
  const files = [
    { path: 'agents/a.md', text: agent('a', 'Does a.', 'A charter with no declarations.') },
    { path: 'agents/b.md', text: agent('b', 'Does b.', 'Also none.') },
  ];
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.deepEqual(ecosystem.unreachable, []);
  assert.equal(ecosystem.stats.unreachable, 0);
  assert.ok(report.notes.some((n) => /difference in convention/.test(n)));
});

test('when wiring exists, a member nobody names is reported', () => {
  const files = tree();
  files.push({ path: '.claude/agents/orphan.md', text: agent('orphan', 'Nobody names me.', 'No declarations here.') });
  const { ecosystem } = importFiles(files, { now: NOW });
  assert.deepEqual(ecosystem.unreachable, ['orphan']);
});

test('a missing constitution is a note, not a failure', () => {
  const files = tree().filter((f) => !/ECOSYSTEM\.md$/.test(f.path));
  const { ecosystem, report } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.stats.divisions, 0);
  assert.equal(ecosystem.agents[0].division, null);
  assert.ok(report.notes.some((n) => /No ECOSYSTEM\.md/.test(n)));
});

test('nothing is withheld from a visitor looking at their own files', () => {
  // src/extract.mjs withholds client-named members because it is about to
  // publish them. An import publishes nothing, so hiding half of somebody's
  // own ecosystem would be a bug wearing a safeguard's clothes.
  const files = [{ path: 'agents/lift-guild-director.md', text: agent('lift-guild-director', 'Runs Lift Legal work.') }];
  const { ecosystem } = importFiles(files, { now: NOW });
  assert.equal(ecosystem.stats.agents, 1);
  assert.deepEqual(ecosystem.withheld, []);
});

// ---------------------------------------------------------------------------
// Shape two: a zip
// ---------------------------------------------------------------------------

test('a zip of a .claude tree imports to the same result as the tree', async () => {
  const bytes = await writeZip(tree());
  const fromZip = await importZip(bytes, { now: NOW });
  const fromTree = importFiles(tree(), { now: NOW });
  assert.deepEqual(fromZip.ecosystem, fromTree.ecosystem);
  assert.equal(fromZip.report.source, 'zip');
});

test('an unreadable member of a zip is reported and the rest still import', async () => {
  const bytes = await writeZip(tree(), { compress: false });
  // Damage the payload of one stored entry so its checksum fails. The offset
  // is found in the BYTES, not in a decoded string: decoding binary data
  // substitutes replacement characters and the string index stops matching.
  const damaged = bytes.slice();
  const needle = new TextEncoder().encode('not a charter');
  let marker = -1;
  outer: for (let i = 0; i + needle.length <= damaged.length; i++) {
    for (let j = 0; j < needle.length; j++) if (damaged[i + j] !== needle[j]) continue outer;
    marker = i;
    break;
  }
  assert.ok(marker > 0, 'test setup: the stored entry was not found');
  damaged[marker] ^= 0xff;
  const { ecosystem, report } = await importZip(damaged, { now: NOW });
  assert.equal(ecosystem.stats.agents, 3);
  assert.ok(report.skipped.some((s) => s.reason === 'checksum mismatch'));
});

test('a zip that is not a zip throws rather than reporting an empty ecosystem', async () => {
  await assert.rejects(() => importZip(new TextEncoder().encode('nope'), { now: NOW }));
});

// ---------------------------------------------------------------------------
// Shape three: a pasted file
// ---------------------------------------------------------------------------

test('a pasted agent charter is recognised by its tools field', () => {
  const { ecosystem, report } = importPastedFile(agent('solo', 'Does one thing.'), { now: NOW });
  assert.equal(ecosystem.stats.agents, 1);
  assert.equal(ecosystem.agents[0].id, 'solo');
  assert.equal(report.kindGuess.kind, 'agent');
  assert.equal(report.kindGuess.confident, true);
});

test('a pasted SKILL.md is recognised by its filename', () => {
  const { ecosystem, report } = importPastedFile(skill('ship-it', 'Ships things.'), { filename: 'SKILL.md', now: NOW });
  assert.equal(ecosystem.stats.skills, 1);
  assert.equal(ecosystem.skills[0].id, 'ship-it');
  assert.equal(report.kindGuess.confident, true);
});

test('an ambiguous paste says so instead of deciding quietly', () => {
  const { report } = importPastedFile('---\nname: maybe\ndescription: could be either\n---\nbody', { now: NOW });
  assert.equal(report.kindGuess.kind, 'agent');
  assert.equal(report.kindGuess.confident, false);
  assert.match(report.kindGuess.reason, /nothing in the file settles it/);
});

test('an explicit kind overrides the guess', () => {
  const { ecosystem, report } = importPastedFile('---\nname: maybe\ndescription: x\n---\nbody', { kind: 'skill', now: NOW });
  assert.equal(ecosystem.stats.skills, 1);
  assert.equal(report.kindGuess.reason, 'you chose it');
});

test('pasting something that is not a charter is reported, not thrown', () => {
  const { ecosystem, report } = importPastedFile('just a note', { now: NOW });
  assert.equal(ecosystem.stats.agents, 0);
  assert.equal(report.skipped.length, 1);
});

// ---------------------------------------------------------------------------
// The claim that has to keep being true
// ---------------------------------------------------------------------------

test('the importer contains no way to reach the network', () => {
  // The offer is that a visitor's charters never leave their browser. This
  // reads the module's own source so a future edit that adds a fetch fails
  // here rather than in somebody's network tab. Comments in the file mention
  // fetch by name, so the check is against code shapes, not the word.
  const source = readFileSync(fileURLToPath(new URL('../lib/import.mjs', import.meta.url)), 'utf8');
  const banned = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bWebSocket\b/,
    /EventSource/,
    /sendBeacon/,
    /navigator\./,
    /\bimport\s*\(/,
    /new\s+Worker/,
    /require\s*\(/,
  ];
  for (const re of banned) {
    assert.equal(re.test(source), false, `lib/import.mjs must not contain ${re}`);
  }
  // And its only imports are local modules that are themselves offline.
  const imports = [...source.matchAll(/^import\s[\s\S]*?from\s+'([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../src/extract.mjs', './zip.mjs']);
});

test('the zip module the importer depends on cannot reach the network either', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/zip.mjs', import.meta.url)), 'utf8');
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /\bWebSocket\b/, /^import\s/m]) {
    assert.equal(re.test(source), false, `lib/zip.mjs must not contain ${re}`);
  }
});
