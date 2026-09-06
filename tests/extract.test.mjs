/**
 * The extractor, against an in-memory filesystem. No real disk, no network.
 *
 * The privacy rules get the hardest tests, because the failure mode is not a
 * wrong number on a page, it is publishing a client's name on the internet.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extract, parseFrontmatter, parseDivisions, parseEdges, looksClientSpecific,
} from '../src/extract.mjs';

function fakeIo(files) {
  return {
    exists: (p) => Object.keys(files).some((f) => f === p || f.startsWith(p + '/')),
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    listDir: (p) => {
      const out = new Set();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(p + '/')) continue;
        out.add(f.slice(p.length + 1).split('/')[0]);
      }
      return [...out];
    },
  };
}

const ECOSYSTEM = `
## 3. Organization (divisions -> members)

- **00 Cabinet** — chief-of-staff (Director/router), cto
- **03 Engineering** — architect (Director), code-reviewer, debugger
`;

const agent = (name, desc, body = '') => `---\nname: ${name}\ndescription: ${desc}\ntools: Read, Grep\nmodel: opus\n---\n${body}`;

test('frontmatter parses flat scalars and strips quotes', () => {
  const { data, body } = parseFrontmatter('---\nname: x\ndescription: "a, b"\n---\nhello');
  assert.equal(data.name, 'x');
  assert.equal(data.description, 'a, b');
  assert.match(body, /hello/);
});

test('a file with no frontmatter yields no data and keeps its body', () => {
  const { data, body } = parseFrontmatter('just text');
  assert.deepEqual(data, {});
  assert.equal(body, 'just text');
});

test('a folded block scalar (key: >) becomes its text, not the marker', () => {
  // Six real skills write their description as a YAML folded block. Storing the
  // marker meant every one of them had a description of literally ">". Found by
  // looking at the rendered page, not at the parser.
  const { data } = parseFrontmatter(
    '---\nname: quality-gate\ndescription: >\n  Quality standards enforcement\n  across two lines.\n---\nbody'
  );
  assert.equal(data.name, 'quality-gate');
  assert.equal(data.description, 'Quality standards enforcement across two lines.');
});

test('a literal block scalar (key: |) keeps its line breaks', () => {
  const { data } = parseFrontmatter('---\ndescription: |\n  line one\n  line two\n---\nbody');
  assert.equal(data.description, 'line one\nline two');
});

test('a block scalar does not swallow the key that follows it', () => {
  // The failure that would be invisible: over-consuming lines would silently
  // drop every field declared after a block scalar.
  const { data } = parseFrontmatter(
    '---\ndescription: >\n  folded text\nmodel: opus\ntools: Read, Grep\n---\nbody'
  );
  assert.equal(data.description, 'folded text');
  assert.equal(data.model, 'opus', 'the field after a block scalar must survive');
  assert.equal(data.tools, 'Read, Grep');
});

test('divisions come from ECOSYSTEM.md, and the Director is identified', () => {
  const d = parseDivisions(ECOSYSTEM);
  assert.equal(d.length, 2);
  assert.equal(d[0].name, 'Cabinet');
  assert.equal(d[0].members[0].id, 'chief-of-staff');
  assert.equal(d[0].members[0].director, true, 'the (Director) aside must mark the member');
  assert.equal(d[0].members[1].id, 'cto');
  assert.equal(d[0].members[1].director, false);
});

test('parenthetical admission notes do not become member names', () => {
  const d = parseDivisions('- **03 Engineering** — architect (Director), supabase-rls-auditor (admitted 2026-09-03 via agent-forge; one per stack)\n');
  assert.deepEqual(d[0].members.map((m) => m.id), ['architect', 'supabase-rls-auditor']);
});

test('edges are read from UPSTREAM/DOWNSTREAM and point the right way', () => {
  const known = ['architect', 'code-reviewer', 'debugger'];
  const edges = parseEdges('code-reviewer', 'UPSTREAM: architect hands over a spec\nDOWNSTREAM: debugger takes the failures', known);
  assert.deepEqual(edges.find((e) => e.from === 'architect'), { from: 'architect', to: 'code-reviewer', kind: 'upstream' });
  assert.deepEqual(edges.find((e) => e.to === 'debugger'), { from: 'code-reviewer', to: 'debugger', kind: 'downstream' });
});

test('an agent never links to itself', () => {
  const edges = parseEdges('architect', 'DOWNSTREAM: architect and code-reviewer', ['architect', 'code-reviewer']);
  assert.ok(!edges.some((e) => e.from === e.to));
});

test('a short id does not match inside a longer word', () => {
  // `cto` must not match inside `director`, which appears in almost every line.
  const edges = parseEdges('x', 'DOWNSTREAM: the director signs off', ['cto', 'x']);
  assert.deepEqual(edges, []);
});

// --- privacy ---------------------------------------------------------------

test('client-specific members are withheld and COUNTED, never silently dropped', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'System designer.'),
    '/root/agents/lift-director.md': agent('lift-director', 'Router for Lift Legal Marketing work.'),
    '/root/agents/relax.md': agent('relax', 'Helper for the RelaxOps engagement.'),
  });
  const snap = extract(io, { root: '/root' });
  assert.deepEqual(snap.agents.map((a) => a.id), ['architect']);
  assert.equal(snap.stats.withheld, 2);
  // The count must be publishable so the site can say what it is not showing,
  // rather than presenting a smaller ecosystem as the whole one.
  assert.equal(snap.withheld.length, 2);
  assert.ok(snap.withheld.every((w) => w.reason));
});

test('a client named only in the BODY does NOT withhold a generic member', () => {
  // This test used to assert the opposite, and the opposite was wrong. Run
  // against the real ecosystem on 2026-09-06, a body scan withheld six generic
  // members including two Directors, because their charters cite a client
  // project as an example ("features James ships to end users (Klik, Nadela
  // Ops, client work)"). That produced a materially false picture of the
  // ecosystem and bought nothing, because bodies never enter the snapshot at
  // all, so a mention inside one cannot leak.
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'A generic helper.', 'For example, on Nadela Ops purchase orders.'),
  });
  const snap = extract(io, { root: '/root' });
  assert.equal(snap.agents.length, 1, 'a passing mention must not remove a generic member');
  assert.equal(snap.stats.withheld, 0);
  // The protection that actually matters still holds: the body is not published.
  assert.ok(!JSON.stringify(snap).includes('Nadela'), 'the body text must not reach the snapshot');
});

test('a member that IS about a client is still withheld by its description', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/x.md': agent('x', 'Router for Lift Legal Marketing work.'),
  });
  const snap = extract(io, { root: '/root' });
  assert.equal(snap.agents.length, 0);
  assert.equal(snap.stats.withheld, 1);
});

test('charter bodies never reach the snapshot', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'System designer.', 'SECRET-INTERNAL-PROSE'),
  });
  const snap = extract(io, { root: '/root' });
  assert.ok(!JSON.stringify(snap).includes('SECRET-INTERNAL-PROSE'), 'a body leaked into the snapshot');
  assert.equal(snap.agents[0]._body, undefined);
});

test('looksClientSpecific matches the real shapes and not innocent words', () => {
  assert.equal(looksClientSpecific('lift-guild:lift-director'), true);
  assert.equal(looksClientSpecific('firm-pro:coder'), true);
  assert.equal(looksClientSpecific('helps you lift heavy state'), false, 'the verb "lift" alone must not withhold a member');
});

// --- the audit the constitution asks for -----------------------------------

test('a member nobody names is reported unreachable, which is the point', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'D', 'DOWNSTREAM: code-reviewer'),
    '/root/agents/code-reviewer.md': agent('code-reviewer', 'D', 'UPSTREAM: architect'),
    '/root/agents/orphan.md': agent('orphan', 'Nobody hands this work.'),
  });
  const snap = extract(io, { root: '/root' });
  assert.deepEqual(snap.unreachable, ['orphan']);
  assert.equal(snap.stats.unreachable, 1);
});

test('the same relationship declared from both ends is one edge, not two', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'D', 'DOWNSTREAM: code-reviewer'),
    '/root/agents/code-reviewer.md': agent('code-reviewer', 'D', 'UPSTREAM: architect'),
  });
  const snap = extract(io, { root: '/root' });
  assert.equal(snap.edges.length, 1, 'reciprocity is one relationship seen twice');
});

test('stats are derived from the data, not asserted', () => {
  const io = fakeIo({
    '/root/ECOSYSTEM.md': ECOSYSTEM,
    '/root/agents/architect.md': agent('architect', 'D', 'DOWNSTREAM: code-reviewer'),
    '/root/agents/code-reviewer.md': agent('code-reviewer', 'D'),
    '/root/skills/retro/SKILL.md': '---\nname: retro\ndescription: Reflect.\n---\nbody',
  });
  const snap = extract(io, { root: '/root' });
  assert.equal(snap.stats.agents, 2);
  assert.equal(snap.stats.skills, 1);
  assert.equal(snap.stats.edges, snap.edges.length);
  assert.equal(snap.stats.directors, snap.agents.filter((a) => a.director).length);
  assert.equal(snap.agents.find((a) => a.id === 'architect').division, '03 Engineering');
});

test('an UPSTREAM declaration that wraps across lines is read whole', () => {
  // Regression, 2026-09-06. The parser read only the line the keyword sat on,
  // so every name after the first line was invisible. Against the real
  // ecosystem that hid 106 of 219 edges and inflated the unreachable list
  // from 8 to 10 — a parser bug manufacturing the exact finding the tool
  // exists to report.
  const body = [
    '## Interface',
    '- UPSTREAM: product-manager / chief-of-staff (the approved feature ask),',
    '  refactor-specialist (flags when a shipped target design does not fit',
    '  the real code).',
    '- DOWNSTREAM: code-reviewer.',
    '',
    'Some later prose that mentions qa-engineer and must NOT become an edge.',
  ].join('\n');
  const known = ['product-manager', 'chief-of-staff', 'refactor-specialist', 'code-reviewer', 'qa-engineer'];
  const edges = parseEdges('architect', body, known);
  const up = edges.filter((e) => e.kind === 'upstream').map((e) => e.from).sort();
  const down = edges.filter((e) => e.kind === 'downstream').map((e) => e.to).sort();
  assert.deepEqual(up, ['chief-of-staff', 'product-manager', 'refactor-specialist']);
  assert.deepEqual(down, ['code-reviewer']);
  assert.equal(edges.some((e) => e.to === 'qa-engineer' || e.from === 'qa-engineer'), false,
    'prose after the declaration block leaked into the graph');
});

test('a new list item ends the declaration block', () => {
  const body = [
    '- UPSTREAM: architect.',
    '- Some other bullet naming copywriter, which is not an edge.',
  ].join('\n');
  const edges = parseEdges('x', body, ['architect', 'copywriter']);
  assert.deepEqual(edges.map((e) => e.from), ['architect']);
});
