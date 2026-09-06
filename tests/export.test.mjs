/**
 * The exporter.
 *
 * The tests worth having are the ones about YAML, because that is where a
 * bundle looks right and loads wrong. Real charter descriptions contain ": "
 * in ordinary prose, apostrophes, quotation marks and em dashes, and a plain
 * scalar may not contain the first of those. A file that a lenient reader
 * accepts and a strict one rejects is the failure this file exists to catch.
 *
 * The reference validator itself (`npx skills-ref validate`) is run against a
 * real bundle on disk by `tools/validate-export.mjs`, which is a tool rather
 * than a test because it needs the network the first time it fetches the
 * package. These tests cover the same rules in-process so `npm test` stays
 * offline and still gates the format.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentMarkdown, skillMarkdown, readmeMarkdown, buildBundle, bundleFromTemplate,
  bundleFromEcosystem, validateBundle, validateSkillFrontmatter, normaliseSkillName,
  readFrontmatterForCheck, yamlScalar, oneLine, bundleZip, SKILL_LIMITS,
} from '../lib/export.mjs';
import { readZipAsText } from '../lib/zip.mjs';
import { template, templateSkills } from '../lib/library.mjs';
import { importZip } from '../lib/import.mjs';

// ---------------------------------------------------------------------------
// YAML
// ---------------------------------------------------------------------------

test('a description containing a colon and a space is quoted', () => {
  // "an implementation plan: data model" is a real sentence from a real
  // charter, and unquoted it is not a legal plain scalar.
  const out = yamlScalar('Turns an idea into an implementation plan: data model, module boundaries.');
  assert.equal(out[0], '"');
  assert.equal(readFrontmatterForCheck(`---\nd: ${out}\n---\n`).d, 'Turns an idea into an implementation plan: data model, module boundaries.');
});

test('text with a double quote uses single quoting so nothing needs escaping', () => {
  const out = yamlScalar('Ask "what does this change" first.');
  assert.equal(out, "'Ask \"what does this change\" first.'");
  assert.equal(readFrontmatterForCheck(`---\nd: ${out}\n---\n`).d, 'Ask "what does this change" first.');
});

test('text with both quote kinds round trips through escaping', () => {
  const value = `He said "it's fine".`;
  const out = yamlScalar(value);
  assert.equal(readFrontmatterForCheck(`---\nd: ${out}\n---\n`).d, value);
});

test('a backslash survives the round trip', () => {
  const value = 'Use the path C:\\Users\\admin\\.claude';
  assert.equal(readFrontmatterForCheck(`---\nd: ${yamlScalar(value)}\n---\n`).d, value);
});

test('newlines are collapsed, because a frontmatter description is a single line field', () => {
  assert.equal(oneLine('one\ntwo\n\n  three '), 'one two three');
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

test('a legal name is left alone', () => {
  assert.deepEqual(normaliseSkillName('pdf-processing'), { name: 'pdf-processing', changed: false, reason: null });
});

test('illegal names are normalised and the change is reported', () => {
  assert.equal(normaliseSkillName('PDF Processing').name, 'pdf-processing');
  assert.equal(normaliseSkillName('-leading').name, 'leading');
  assert.equal(normaliseSkillName('trailing-').name, 'trailing');
  assert.equal(normaliseSkillName('double--hyphen').name, 'double-hyphen');
  assert.equal(normaliseSkillName('under_score').name, 'under-score');
  assert.equal(normaliseSkillName('!!!').name, 'skill');
  assert.equal(normaliseSkillName('PDF Processing').changed, true);
});

test('an over-long name is cut to the limit and never ends in a hyphen', () => {
  const long = `${'a'.repeat(60)}-${'b'.repeat(20)}`;
  const out = normaliseSkillName(long);
  assert.ok(out.name.length <= SKILL_LIMITS.name);
  assert.ok(!out.name.endsWith('-'));
  assert.equal(out.changed, true);
});

// ---------------------------------------------------------------------------
// The validator, against the specification's stated constraints
// ---------------------------------------------------------------------------

test('the minimal legal frontmatter passes', () => {
  assert.deepEqual(validateSkillFrontmatter({ name: 'a-b', description: 'x' }, 'a-b'), { ok: true, errors: [] });
});

test('every stated constraint is enforced', () => {
  const bad = [
    [{ description: 'x' }, /name is required/],
    [{ name: 'A-B', description: 'x' }, /lowercase/],
    [{ name: '-a', description: 'x' }, /lowercase/],
    [{ name: 'a-', description: 'x' }, /lowercase/],
    [{ name: 'a--b', description: 'x' }, /lowercase/],
    [{ name: 'a'.repeat(65), description: 'x' }, /over the 64 limit/],
    [{ name: 'a', description: '' }, /description is required/],
    [{ name: 'a', description: 'x'.repeat(1025) }, /over the 1024 limit/],
    [{ name: 'a', description: 'x', compatibility: 'c'.repeat(501) }, /over the 500 limit/],
    [{ name: 'a', description: 'x', metadata: 'nope' }, /metadata must be a map/],
    [{ name: 'a', description: 'x', metadata: { v: 1 } }, /must be a string/],
    [{ name: 'a', description: 'x', 'allowed-tools': ['Read'] }, /space separated string/],
  ];
  for (const [fm, re] of bad) {
    const verdict = validateSkillFrontmatter(fm);
    assert.equal(verdict.ok, false, `should have failed: ${JSON.stringify(fm)}`);
    assert.ok(verdict.errors.some((e) => re.test(e)), `${JSON.stringify(verdict.errors)} should match ${re}`);
  }
});

test('a name that does not match its directory is a failure', () => {
  const verdict = validateSkillFrontmatter({ name: 'one', description: 'x' }, 'two');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((e) => /does not match its directory/.test(e)));
});

// ---------------------------------------------------------------------------
// Rendered files
// ---------------------------------------------------------------------------

test('an agent charter renders with Claude Code frontmatter and its body', () => {
  const text = agentMarkdown({ id: 'reviewer', description: 'Reviews: diffs, carefully.', tools: ['Read', 'Grep'], model: 'opus', body: 'You review.' });
  const fm = readFrontmatterForCheck(text);
  assert.equal(fm.name, 'reviewer');
  assert.equal(fm.description, 'Reviews: diffs, carefully.');
  assert.equal(fm.tools, 'Read, Grep');
  assert.equal(fm.model, 'opus');
  assert.match(text, /\nYou review\.\n/);
});

test('absent tools and model produce no line at all, rather than an empty one', () => {
  // An empty `tools:` means no tools granted, which is not the same as the
  // default grant. Guessing between them changes how the agent runs.
  const text = agentMarkdown({ id: 'plain', description: 'x', tools: [], model: null, body: 'b' });
  assert.equal(/^tools:/m.test(text), false);
  assert.equal(/^model:/m.test(text), false);
});

test('a charter with no body says so instead of being padded out', () => {
  const text = agentMarkdown({ id: 'bare', description: 'x' });
  assert.match(text, /imported from frontmatter only/);
});

test('an over-long description is cut in the frontmatter and kept in full in the body', () => {
  const long = `Start. ${'word '.repeat(400)}End.`;
  assert.ok(long.length > SKILL_LIMITS.description);
  const out = skillMarkdown({ name: 'long-one', description: long, body: '# long-one' });
  const fm = readFrontmatterForCheck(out.text);
  assert.ok(fm.description.length <= SKILL_LIMITS.description);
  assert.ok(out.warnings.some((w) => /cut and the full text kept in the body/.test(w)));
  assert.match(out.text, /## Full description/);
  assert.ok(out.text.includes(long.trim()), 'the original text must survive somewhere in the file');
});

test('the optional fields render only when supplied', () => {
  const plain = readFrontmatterForCheck(skillMarkdown({ name: 'a', description: 'x' }).text);
  assert.equal(plain.license, undefined);
  assert.equal(plain.compatibility, undefined);

  const full = readFrontmatterForCheck(skillMarkdown({
    name: 'a', description: 'x', license: 'MIT', compatibility: 'Needs git',
    'allowed-tools': 'Read Bash(git:*)', metadata: { author: 'polis', version: '1.0' },
  }).text);
  assert.equal(full.license, 'MIT');
  assert.equal(full.compatibility, 'Needs git');
  assert.equal(full['allowed-tools'], 'Read Bash(git:*)');
  assert.deepEqual(full.metadata, { author: 'polis', version: '1.0' });
});

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

test('a bundle lays files out so unzipping into ~/.claude works', () => {
  const { files } = buildBundle({
    title: 'Test bundle',
    agents: [{ id: 'one', description: 'a', body: 'b' }],
    skills: [{ name: 'two', description: 'c', body: 'd' }],
  });
  assert.deepEqual(files.map((f) => f.path), ['README.md', 'agents/one.md', 'skills/two/SKILL.md']);
});

test('the README names the real directories for both operating systems', () => {
  const text = readmeMarkdown({ title: 'x', agents: [], skills: [] });
  assert.match(text, /~\/\.claude\//);
  assert.match(text, /%USERPROFILE%\\\.claude\\/);
  assert.match(text, /skills-ref validate/);
});

test('two members that would claim the same filename are reported, not silently merged', () => {
  const { files, warnings } = buildBundle({
    agents: [{ id: 'One Thing', description: 'a', body: 'b' }, { id: 'one-thing', description: 'c', body: 'd' }],
  });
  assert.equal(files.filter((f) => f.path.startsWith('agents/')).length, 1);
  assert.ok(warnings.some((w) => /both wanted the file/.test(w)));
});

test('every library template produces a bundle that passes the spec check', () => {
  for (const id of ['solo-developer', 'content-and-marketing', 'research', 'customer-support',
    'data-and-analytics', 'agency-delivery', 'evaluation-and-governance', 'incident-and-reliability']) {
    const t = template(id);
    const bundle = bundleFromTemplate({ ...t, skills: templateSkills(t) });
    const verdict = validateBundle(bundle.files);
    assert.deepEqual(verdict.errors, [], `${id} produced an invalid bundle`);
    assert.deepEqual(bundle.warnings, [], `${id} produced warnings: ${bundle.warnings.join('; ')}`);
  }
});

test('an ecosystem with no charter bodies exports honestly rather than inventing prose', () => {
  const ecosystem = { agents: [{ id: 'a', description: 'does a', tools: [], model: null }], skills: [] };
  const bundle = bundleFromEcosystem(ecosystem, { title: 'x' });
  assert.ok(bundle.warnings.some((w) => /rather than inventing one/.test(w)));
  assert.match(bundle.files.find((f) => f.path === 'agents/a.md').text, /imported from frontmatter only/);
});

test('supplied bodies are carried through unchanged, so an import can round trip', () => {
  const ecosystem = { agents: [{ id: 'a', description: 'does a', tools: ['Read'], model: 'opus' }], skills: [] };
  const bundle = bundleFromEcosystem(ecosystem, { bodies: { 'agents/a': 'The original prose.' } });
  assert.match(bundle.files.find((f) => f.path === 'agents/a.md').text, /The original prose\./);
  assert.deepEqual(bundle.warnings, []);
});

test('validateBundle catches a hand-damaged SKILL.md', () => {
  const files = [{ path: 'skills/good/SKILL.md', text: '---\nname: bad\ndescription: "x"\n---\n' }];
  const verdict = validateBundle(files);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors[0].includes('skills/good/SKILL.md'));
});

// ---------------------------------------------------------------------------
// The round trip that proves the two halves agree
// ---------------------------------------------------------------------------

test('a template exported to a zip imports back with the same members and roads', async () => {
  const t = template('solo-developer');
  const bundle = bundleFromTemplate({ ...t, skills: templateSkills(t) });
  const bytes = await bundleZip(bundle.files);
  const { ecosystem, report } = await importZip(bytes, { now: '2026-09-07T00:00:00.000Z' });

  assert.deepEqual(report.skipped, []);
  assert.deepEqual(ecosystem.agents.map((a) => a.id).sort(), t.agents.map((a) => a.id).sort());
  assert.deepEqual(ecosystem.skills.map((s) => s.id).sort(), t.skills.map((s) => s.name).sort());
  // The wiring survives the trip, which is what makes the export a working
  // ecosystem rather than a folder of unrelated files.
  assert.ok(ecosystem.edges.length >= t.agents.length - 1);
  assert.deepEqual(ecosystem.unreachable, []);
});

test('the zip a visitor downloads contains exactly the files the bundle listed', async () => {
  const t = template('research');
  const bundle = bundleFromTemplate({ ...t, skills: templateSkills(t) });
  const { files } = await readZipAsText(await bundleZip(bundle.files));
  assert.deepEqual(files.map((f) => f.path).sort(), bundle.files.map((f) => f.path).sort());
  for (const f of files) {
    assert.equal(f.text, bundle.files.find((b) => b.path === f.path).text);
  }
});
