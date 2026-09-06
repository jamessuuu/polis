/**
 * The library.
 *
 * The load-bearing test here is `verifyClaims`: every sentence a template
 * advertises is paired with a verbatim quote from one of its own charters, and
 * this file checks that the quote is really there. The failure mode of a
 * starter pack is a confident summary sitting on top of four thin files, and
 * a summary that cannot be traced to a charter is exactly that.
 *
 * The rest is anti-stub: a member with a two line body is a placeholder, and a
 * placeholder in a thing offered as free and useful is worse than not offering
 * it, so the floors are asserted rather than trusted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, catalog, template, freeTemplates, lockedTemplates,
  verifyClaims, templateEcosystem, templateSkills,
} from '../lib/library.mjs';
import { validateSkillFrontmatter, SKILL_LIMITS, oneLine } from '../lib/export.mjs';

const EXPECTED = [
  'solo-developer',
  'content-and-marketing',
  'research',
  'customer-support',
  'data-and-analytics',
  'agency-delivery',
  'evaluation-and-governance',
  'incident-and-reliability',
];

test('the six field templates exist and are free, and the locked ones are additions', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id), EXPECTED);
  const free = freeTemplates().map((t) => t.id);
  // The honest pitch is a free agentic solution, so all six named fields are
  // free and complete. Locked entries sit beside them; they do not carve them up.
  assert.deepEqual(free, EXPECTED.slice(0, 6));
  assert.deepEqual(lockedTemplates().map((t) => t.id), EXPECTED.slice(6));
});

test('every template id is unique and resolvable', () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const id of EXPECTED) assert.equal(template(id).id, id);
  assert.equal(template('does-not-exist'), null);
});

test('every advertised claim is backed by a verbatim quote from its own charter', () => {
  for (const t of TEMPLATES) {
    const verdict = verifyClaims(t);
    assert.deepEqual(verdict.failures, [], `${t.id} advertises something its charters do not say`);
    assert.ok(t.claims.length >= 3, `${t.id} should stand behind at least three claims`);
  }
});

test('a claim whose evidence has been edited away fails the gate', () => {
  // The gate is only worth having if it can fail. This mutates a real template
  // rather than a fixture, so the check being tested is the one that runs.
  const t = template('solo-developer');
  const broken = { ...t, claims: [{ text: 'It writes your tests for you.', member: 'change-reviewer', quote: 'writes your tests for you' }] };
  const verdict = verifyClaims(broken);
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures[0].reason, /does not contain the quoted text/);
});

test('a claim naming a member that does not exist fails the gate', () => {
  const verdict = verifyClaims({ agents: [], skills: [], claims: [{ text: 'x', member: 'ghost', quote: 'y' }] });
  assert.equal(verdict.ok, false);
  assert.match(verdict.failures[0].reason, /no member named ghost/);
});

test('no member is a stub', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.agents.length >= 4, `${t.id} has too few agents to be a coherent set`);
    assert.ok(t.skills.length >= 2, `${t.id} has too few skills`);
    for (const a of t.agents) {
      assert.ok(a.body.length > 900, `${t.id}/${a.id} charter is a stub (${a.body.length} chars)`);
      assert.ok(a.description.length > 120, `${t.id}/${a.id} description is too thin`);
      assert.match(a.body, /## Interface/, `${t.id}/${a.id} declares no interface`);
      assert.match(a.body, /- CONSUMES:/, `${t.id}/${a.id} declares no inputs`);
      assert.match(a.body, /- PRODUCES:/, `${t.id}/${a.id} declares no outputs`);
      assert.match(a.body, /## Method/, `${t.id}/${a.id} has no method`);
    }
    for (const s of t.skills) {
      assert.ok(s.body.length > 700, `${t.id}/${s.name} skill body is a stub (${s.body.length} chars)`);
      assert.ok(s.description.length > 120, `${t.id}/${s.name} description is too thin`);
    }
  }
});

test('every agent is named by at least one other agent, so a template has roads', () => {
  for (const t of TEMPLATES) {
    const eco = templateEcosystem(t, { now: '2026-09-07T00:00:00.000Z' });
    assert.deepEqual(eco.unreachable, [], `${t.id} contains members nobody names`);
    assert.ok(eco.edges.length >= t.agents.length - 1, `${t.id} has too few roads to be one system`);
  }
});

test('every template has exactly one director', () => {
  for (const t of TEMPLATES) {
    const directors = t.agents.filter((a) => a.director);
    assert.equal(directors.length, 1, `${t.id} has ${directors.length} directors`);
  }
});

test('every agent belongs to a division the template declares', () => {
  for (const t of TEMPLATES) {
    const names = new Set(t.divisions.map((d) => `${d.number} ${d.name}`));
    for (const a of t.agents) {
      assert.ok(names.has(a.division), `${t.id}/${a.id} sits in ${a.division}, which is not a declared division`);
    }
  }
});

test('a template renders in the exact ecosystem.json shape', () => {
  const eco = templateEcosystem(template('research'), { now: '2026-09-07T00:00:00.000Z' });
  assert.deepEqual(
    Object.keys(eco).sort(),
    ['agents', 'divisions', 'edges', 'generatedAt', 'guilds', 'scope', 'skills', 'stats', 'unreachable', 'withheld'].sort(),
  );
  assert.deepEqual(
    Object.keys(eco.stats).sort(),
    ['agents', 'directors', 'divisions', 'edges', 'guilds', 'skills', 'unreachable', 'withheld'].sort(),
  );
  assert.deepEqual(
    Object.keys(eco.agents[0]).sort(),
    ['description', 'director', 'division', 'guild', 'id', 'model', 'system', 'tools'].sort(),
  );
  assert.equal(eco.stats.agents, eco.agents.length);
  assert.equal(eco.stats.edges, eco.edges.length);
  assert.equal(eco.scope, 'template');
});

test('every skill passes the Agent Skills constraints before it is ever exported', () => {
  for (const t of TEMPLATES) {
    for (const s of templateSkills(t)) {
      const verdict = validateSkillFrontmatter({ ...s, description: oneLine(s.description) }, s.name);
      assert.deepEqual(verdict.errors, [], `${t.id}/${s.name}`);
      assert.ok(oneLine(s.description).length <= SKILL_LIMITS.description, `${t.id}/${s.name} would need truncating`);
    }
  }
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('the catalog carries previews and no bodies, so it is safe to ship to any page', () => {
  const entries = catalog();
  assert.equal(entries.length, TEMPLATES.length);
  const serialised = JSON.stringify(entries);
  for (const t of TEMPLATES) {
    for (const a of t.agents) {
      assert.equal(serialised.includes(a.body.slice(0, 60)), false, `${t.id}/${a.id} charter body leaked into the catalog`);
    }
    for (const s of t.skills) {
      assert.equal(serialised.includes(s.body.slice(0, 60)), false, `${t.id}/${s.name} skill body leaked into the catalog`);
    }
  }
});

test('a locked entry still shows what it contains and why it is worth having', () => {
  for (const entry of catalog().filter((e) => e.locked)) {
    assert.ok(entry.lockedReason && entry.lockedReason.length > 80, `${entry.id} does not say why it is locked`);
    assert.ok(entry.why.length >= 3, `${entry.id} does not say why it is worth having`);
    assert.ok(entry.agents.length >= 4);
    // Names and descriptions are published. An unopenable box is not a preview.
    for (const a of entry.agents) assert.ok(a.description.length > 120, `${entry.id}/${a.id} preview description is too thin`);
    for (const s of entry.skills) assert.ok(s.description.length > 120, `${entry.id}/${s.name} preview description is too thin`);
  }
});

test('the locked reason states that nothing was taken out of the free tier', () => {
  // A locked tier built by removing things from the free one poisons the free
  // offer. The reason text has to say what it did not do, and this checks that
  // the sentence is still there after an edit.
  for (const t of lockedTemplates()) {
    assert.match(t.lockedReason, /none of them|Nothing was removed/i, `${t.id} does not address the free tier`);
  }
});

// ---------------------------------------------------------------------------
// House rules
// ---------------------------------------------------------------------------

test('no em dash appears anywhere in the library content', () => {
  const seen = [];
  for (const t of TEMPLATES) {
    const blobs = [t.name, t.summary, t.niche, t.lockedReason ?? '', ...t.why,
      ...t.claims.map((c) => `${c.text} ${c.quote}`),
      ...t.agents.map((a) => `${a.description}\n${a.body}`),
      ...t.skills.map((s) => `${s.description}\n${s.body}`)];
    for (const blob of blobs) if (blob.includes('\u2014')) seen.push(t.id);
  }
  assert.deepEqual([...new Set(seen)], []);
});
