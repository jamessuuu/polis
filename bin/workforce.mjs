#!/usr/bin/env node
/**
 * workforce [--projects <dir>] [--out <file>] [--active-hours <n>]
 *
 * Reads Claude Code's own session logs and reports which agents actually ran,
 * on which projects, alongside whom.
 *
 * Personal scope only, and non-negotiably so: sessions rooted outside
 * C:\Users\admin belong to other worlds (Lift, Freelance, RelaxOps) and are
 * skipped and counted rather than read. Message content is never touched —
 * only dispatch metadata.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { extractWorkforce, neverDispatched } from '../src/workforce.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: workforce [--projects <dir>] [--out <file>] [--active-hours <n>]\n');
  process.exit(0);
}

const projectsDir = flag('--projects', join(homedir(), '.claude', 'projects')).replace(/\\/g, '/');
const here = dirname(new URL(import.meta.url).pathname.slice(1));
const out = flag('--out', join(here, '..', 'data', 'workforce.json'));
const activeHours = Number(flag('--active-hours', '48'));

const io = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, 'utf8'),
  listDir: (p) => readdirSync(p),
};

const w = extractWorkforce(io, { root: projectsDir, activeHours });

// Cross-reference against the roster, so "never dispatched" is computed
// against who actually exists rather than against who happens to appear.
const snapPath = join(here, '..', 'data', 'ecosystem.json');
let dormant = [];
if (existsSync(snapPath)) {
  const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
  dormant = neverDispatched(snap.agents.map((a) => a.id), w);
  w.dormant = dormant;
  w.stats.rosterSize = snap.agents.length;
  w.stats.neverDispatched = dormant.length;

  // agentsEverDispatched counts every distinct agent in the telemetry,
  // INCLUDING ones that are not roster members -- currently general-purpose,
  // prompt-engineer, claude-code-guide and fork. neverDispatched counts only
  // roster members. So the two published numbers invite a reader to add them
  // (30 + 33 = 63) against a roster of 59, and they do not reconcile.
  //
  // They are both correct; they count different populations and nothing said
  // so. On a project whose one rule is that every number traces to one file,
  // two true numbers that appear to contradict each other are as damaging as
  // one wrong one -- a reader who spots it has no way to know which to trust.
  //
  // These two derived stats close it: rosterEverDispatched + neverDispatched
  // == rosterSize, exactly, and dispatchedOutsideRoster names the remainder
  // instead of leaving it as an unexplained gap.
  const rosterIds = new Set(snap.agents.map((a) => a.id));
  const seenIds = w.agents.map((a) => a.id);
  w.stats.rosterEverDispatched = seenIds.filter((id) => rosterIds.has(id)).length;
  w.stats.dispatchedOutsideRoster = seenIds.filter((id) => !rosterIds.has(id)).sort();
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(w, null, 2));

const s = w.stats;
process.stdout.write(
  `workforce: ${s.assignments} dispatches, ${s.agentsEverDispatched} distinct agents, ` +
  `${s.projectsTouched} projects, ${s.workUnits} work units\n` +
  `           ${s.collaborationPairs} collaboration pairs; ` +
  `${s.excludedOtherWorlds} dispatches withheld (other worlds)\n`,
);
if (w.stats.rosterSize) {
  process.stdout.write(
    `           roster ${s.rosterSize}, never dispatched ${s.neverDispatched} ` +
    `(${Math.round((s.neverDispatched / s.rosterSize) * 100)}% of the roster has never run)\n`,
  );
}
process.stdout.write(`wrote ${out}\n`);
