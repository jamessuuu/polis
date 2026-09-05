#!/usr/bin/env node
/**
 * snapshot [--root <dir>] [--scope personal|all] [--out <file>]
 *
 * Reads the ecosystem off disk and writes data/ecosystem.json.
 *
 * `--scope personal` is the default and it is the safe one: members whose id,
 * description or charter body names a client or employer are withheld and
 * counted. Charter bodies never enter the snapshot at all.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { extract } from '../src/extract.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write('usage: snapshot [--root <dir>] [--scope personal|all] [--out <file>]\n');
  process.exit(0);
}

const root = flag('--root', join(homedir(), '.claude')).replace(/\\/g, '/');
const scope = flag('--scope', 'personal');
if (scope !== 'personal' && scope !== 'all') {
  process.stderr.write(`snapshot: --scope must be personal or all, got ${scope}\n`);
  process.exit(2);
}
const out = flag('--out', join(dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'data', 'ecosystem.json'));

const io = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, 'utf8'),
  listDir: (p) => readdirSync(p),
};

// Guilds are discovered, not listed, so a new one appears on the map without
// anyone remembering to register it here.
//
// `house` is excluded by name and the exclusion is load-bearing: it is a sync
// mirror of ~/.claude, so reading it would double every core member and
// inflate every published count. `--guild-root ""` turns discovery off.
const GUILD_MIRRORS = new Set(['house']);
const guildRoot = flag('--guild-root', join(homedir(), 'guilds')).replace(/\\/g, '/');
const guilds = [];
if (guildRoot && existsSync(guildRoot)) {
  for (const name of readdirSync(guildRoot)) {
    if (GUILD_MIRRORS.has(name)) continue;
    const r = `${guildRoot}/${name}`;
    if (!existsSync(`${r}/agents`) && !existsSync(`${r}/skills`)) continue;
    guilds.push({ name, root: r });
  }
}

const snap = extract(io, { root, scope, guilds });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap, null, 2));

const s = snap.stats;
process.stdout.write(
  `snapshot: ${s.agents} agents, ${s.skills} skills, ${s.divisions} divisions, ${s.edges} edges\n` +
  `           ${s.directors} directors, ${s.unreachable} unreachable, ${s.withheld} withheld (scope: ${scope})\n` +
  `wrote ${out}\n`
);
if (snap.unreachable.length) {
  process.stdout.write(`unreachable (nobody names them UPSTREAM or DOWNSTREAM):\n  ${snap.unreachable.join(', ')}\n`);
}
