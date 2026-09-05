/**
 * Gates on the activity reader.
 *
 * Two of these matter more than the rest and both are about restraint:
 * the reader must never cross a world boundary, and it must never pull
 * message content out of a transcript. Both are asserted against planted
 * records that would trip a careless implementation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorkforce, neverDispatched } from '../src/workforce.mjs';

function line(obj) {
  return JSON.stringify(obj);
}

function dispatch({ agent, cwd, session, at, extra = {} }) {
  return line({
    type: 'assistant',
    sessionId: session,
    cwd,
    timestamp: at,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'some private reasoning that must never be read' },
        {
          type: 'tool_use',
          name: 'Agent',
          input: { subagent_type: agent, prompt: 'CONFIDENTIAL CLIENT BRIEF', ...extra },
        },
      ],
    },
  });
}

function ioFrom(files) {
  return {
    exists: () => true,
    listDir: (p) => {
      if (p === 'root') return Object.keys(files);
      const dir = p.replace('root/', '');
      return Object.keys(files[dir] || {});
    },
    readFile: (p) => {
      const [, dir, file] = p.split('/');
      return files[dir][file];
    },
  };
}

const NOW = '2026-09-06T12:00:00.000Z';

test('counts dispatches, not agents, and separates the two', () => {
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': [
        dispatch({ agent: 'code-reviewer', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
        dispatch({ agent: 'code-reviewer', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
        dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
      ].join('\n'),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.equal(w.stats.assignments, 3);
  assert.equal(w.stats.agentsEverDispatched, 2);
  const cr = w.agents.find((a) => a.id === 'code-reviewer');
  assert.equal(cr.assignments, 2);
  assert.deepEqual(cr.projects, ['polis']);
});

test('sessions from other worlds are skipped AND counted', () => {
  // The whole point: a Lift client engagement must not surface on a personal
  // page, and the page must still be able to say something was withheld.
  const io = ioFrom({
    'D--Lift-repos-russo-law': {
      's2.jsonl': dispatch({ agent: 'seo-planner', cwd: 'D:\\Lift\\repos\\russo-law', session: 's2', at: NOW }),
    },
    'C--Users-admin': {
      's1.jsonl': dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.equal(w.stats.assignments, 1, 'only the personal dispatch should count');
  assert.equal(w.excluded.otherWorlds, 1, 'the Lift dispatch must be counted as withheld');
  assert.equal(w.agents.find((a) => a.id === 'seo-planner'), undefined, 'a Lift agent leaked through');
  assert.equal(JSON.stringify(w).includes('russo'), false, 'a client name leaked into the output');
});

test('no message content ever reaches the output', () => {
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\klik', session: 's1', at: NOW }),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  const dumped = JSON.stringify(w);
  assert.equal(dumped.includes('CONFIDENTIAL'), false, 'a prompt reached the output');
  assert.equal(dumped.includes('private reasoning'), false, 'assistant text reached the output');
});

test('collaboration means the same session, not merely the same project', () => {
  // Two agents on the same repo six months apart did not work together, and
  // recording that they did would invent a relationship.
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': [
        dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\klik', session: 's1', at: NOW }),
        dispatch({ agent: 'qa-engineer', cwd: 'C:\\Users\\admin\\klik', session: 's1', at: NOW }),
      ].join('\n'),
      's2.jsonl': dispatch({ agent: 'copywriter', cwd: 'C:\\Users\\admin\\klik', session: 's2', at: NOW }),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.equal(w.collaborations.length, 1);
  assert.deepEqual(
    { a: w.collaborations[0].a, b: w.collaborations[0].b },
    { a: 'architect', b: 'qa-engineer' },
  );
});

test('"active" is relative to an injected clock, not the wall clock', () => {
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': [
        dispatch({ agent: 'recent', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: '2026-09-06T11:00:00.000Z' }),
        dispatch({ agent: 'stale', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: '2026-08-01T11:00:00.000Z' }),
      ].join('\n'),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW, activeHours: 24 });
  assert.equal(w.agents.find((a) => a.id === 'recent').active, true);
  assert.equal(w.agents.find((a) => a.id === 'stale').active, false);
});

test('a malformed line is counted, not fatal', () => {
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': [
        '{"subagent_type": broken json',
        dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
      ].join('\n'),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.equal(w.stats.assignments, 1);
  assert.equal(w.excluded.unparseable, 1);
});

test('never-dispatched members are reported, because that is the number nobody publishes', () => {
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': dispatch({ agent: 'architect', cwd: 'C:\\Users\\admin\\polis', session: 's1', at: NOW }),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.deepEqual(neverDispatched(['architect', 'mentor', 'controller'], w), ['controller', 'mentor']);
});

test('an empty projects directory yields zeroes rather than throwing', () => {
  const w = extractWorkforce({ exists: () => false, listDir: () => [], readFile: () => '' }, { root: 'root', now: NOW });
  assert.equal(w.stats.assignments, 0);
  assert.deepEqual(w.agents, []);
});

test('a namespaced guild agent is keyed by its bare id, not the plugin string', () => {
  // Regression: found against the real logs. `design-guild:design-reviewer`
  // was keyed whole, so it never matched the roster's `design-reviewer` and
  // 14 real dispatches were reported as "never run".
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': dispatch({
        agent: 'design-guild:design-reviewer',
        cwd: String.raw`C:\Users\admin\polis`, session: 's1', at: NOW,
      }),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  const rec = w.agents.find((a) => a.id === 'design-reviewer');
  assert.ok(rec, 'the bare id should be the key');
  assert.equal(rec.namespace, 'design-guild', 'the plugin namespace should be preserved');
  assert.deepEqual(neverDispatched(['design-reviewer'], w), []);
});

test('collaboration is scoped to one project within one session', () => {
  // A long session that touched two unrelated repos is not a team.
  const io = ioFrom({
    'C--Users-admin': {
      's1.jsonl': [
        dispatch({ agent: 'architect', cwd: String.raw`C:\Users\admin\klik`, session: 's1', at: NOW }),
        dispatch({ agent: 'copywriter', cwd: String.raw`C:\Users\admin\polis`, session: 's1', at: NOW }),
      ].join('\n'),
    },
  });
  const w = extractWorkforce(io, { root: 'root', now: NOW });
  assert.equal(w.collaborations.length, 0, 'different projects in one session are not collaboration');
});
