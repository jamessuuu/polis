/**
 * Turn a visitor's own agentic ecosystem into the exact `ecosystem.json` shape
 * polis already renders.
 *
 * THE RULE THIS MODULE IS BUILT AROUND: nothing leaves the browser. A person's
 * agent charters are their working notes, their client vocabulary and their
 * intellectual property, and the offer "drop your ecosystem in and see it as a
 * city" is only acceptable if the drop is local. So this module makes no
 * network call of any kind, and that is not a promise in a comment, it is
 * enforced two ways:
 *
 *   1. Its only imports are `../src/extract.mjs` (the same parsers the house
 *      snapshot uses) and nothing else. No fetch, no XHR, no dynamic import,
 *      no worker, no beacon.
 *   2. `tests/import.test.mjs` reads this file's own source and fails if any
 *      of those appear. A page that wires this in can show a network capture
 *      with zero outbound requests, and the test is the reason that capture
 *      will keep being true after the next edit.
 *
 * It also applies NO privacy filter, deliberately, and that is the opposite of
 * `src/extract.mjs`. The house snapshot withholds members that name a client
 * because it is about to publish them on the internet. An import publishes
 * nothing: the visitor is looking at their own files in their own tab, and
 * hiding half of them would be a bug, not a safeguard.
 *
 * KNOWN BEHAVIOUR, found by running this over the real `~/.claude` on this
 * machine (2026-09-07: 733 markdown files, 103 charters, 48 agents, 55 skills,
 * 209 roads, zero skipped). Any directory of the form `<name>/agents/*.md`
 * anywhere in the tree is read as a guild called `<name>`, so a test fixture
 * at `quality-harness/kinds/ecosystem/fixtures/clean/agents/` imported as a
 * guild named "clean". That is discovery working as specified, and the trade
 * is deliberate: the alternative is an allowlist of directory names, which
 * would silently drop a real guild that happens to be somewhere unexpected.
 * A visitor seeing a guild they did not expect can see where it came from; a
 * visitor missing a guild has no way to know it is missing.
 *
 * THE PARSER IS RESILIENT ON PURPOSE. `src/workforce.mjs` treats a malformed
 * log line as one skipped line and keeps going, because the alternative is
 * that one bad record costs the reader every good one. The same rule here: a
 * charter with no frontmatter, an unreadable name, a duplicate id or an entry
 * that cannot be decoded is COUNTED and SKIPPED, never fatal. The report says
 * exactly what was dropped and why, so a visitor whose ecosystem renders with
 * 46 of 51 members can see the five and their reasons instead of wondering.
 */

import { parseFrontmatter, parseDivisions, parseEdges, parseSystemAgents } from '../src/extract.mjs';
import { readZipAsText } from './zip.mjs';

/**
 * Ceilings, so a mis-drop cannot lock the tab.
 *
 * A large real ecosystem is a few hundred small markdown files; James's own is
 * 145 members and under 2 MB. Ten thousand files and 64 MB is far above any
 * genuine tree and far below what would hang a browser. Exceeding either is
 * reported as `truncated`, never silently obeyed.
 */
export const IMPORT_LIMITS = {
  maxFiles: 10000,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
};

/** Directory names that wrap a guild or plugin rather than naming one. */
const CONTAINER_SEGMENTS = new Set(['guilds', 'plugins', '.claude', 'claude']);

/** The opening delimiter, and the whole block. Both, so the two failures differ. */
const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---/;

/**
 * Prepare a file's text for the frontmatter parsers.
 *
 * A UTF-8 byte order mark and a leading blank line both defeat a `^---` match,
 * and both are ordinary in files that have been through a Windows editor or a
 * copy and paste. Losing a real charter to an invisible character is exactly
 * the kind of failure that makes a tool look broken for no visible reason.
 */
function prepare(text) {
  return String(text ?? '').replace(/^﻿/, '').replace(/^[\s\r\n]+(?=---\r?\n)/, '');
}

/**
 * Why a charter cannot be read, or null when it can be.
 *
 * The two cases are kept apart because they mean different things to whoever
 * dropped the folder: "this is not a charter" is a file in the wrong place,
 * and "the frontmatter is never closed" is a charter with a typo in it.
 */
function frontmatterProblem(text) {
  if (!FRONTMATTER_OPEN.test(text)) return 'no YAML frontmatter';
  if (!FRONTMATTER_BLOCK.test(text)) return 'the frontmatter block is never closed';
  return null;
}

function segmentsOf(path) {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.');
}

/**
 * Where the ecosystem root sits inside whatever the visitor handed over.
 *
 * People drop different things: the `.claude` folder itself, its parent, a zip
 * with one wrapper directory inside it, a backup folder named by date. All of
 * those are the same tree with a different number of segments in front, so the
 * root is found rather than demanded: it is the SHORTEST prefix that sits
 * directly above an `agents` or `skills` directory.
 *
 * Shortest and not longest, because a tree may hold several such directories
 * (core plus guilds plus plugins) and the outermost one is the ecosystem.
 */
export function findRoot(paths) {
  let best = null;
  for (const path of paths) {
    const seg = segmentsOf(path);
    const i = seg.findIndex((s) => s === 'agents' || s === 'skills');
    if (i < 0) continue;
    const prefix = seg.slice(0, i);
    if (best === null || prefix.length < best.length) best = prefix;
  }
  return best ?? [];
}

/**
 * Classify one path relative to the root.
 *
 * Returns `{ kind: 'agent'|'skill'|'constitution', guild }` or null when the
 * file is not part of the ecosystem (a README, an image, a stray note). Files
 * that classify as nothing are not errors and are not reported as skipped
 * charters; they simply are not charters.
 */
export function classify(relSegments) {
  const seg = relSegments;
  if (seg.length === 1 && seg[0] === 'ECOSYSTEM.md') return { kind: 'constitution', guild: null };

  // Last, not first: `guilds/design-guild/agents/x.md` has one, and a wrapper
  // directory that happens to be called `skills` would otherwise capture it.
  let at = -1;
  for (let i = seg.length - 1; i >= 0; i--) {
    if (seg[i] === 'agents' || seg[i] === 'skills') { at = i; break; }
  }
  if (at < 0) return null;

  const owner = at === 0 ? null : seg[at - 1];
  const guild = owner && !CONTAINER_SEGMENTS.has(owner) ? owner : null;
  const rest = seg.slice(at + 1);

  if (seg[at] === 'agents') {
    // Exactly one level down, and markdown. `agents/archive/old.md` is somebody
    // filing, not a member.
    if (rest.length !== 1 || !/\.md$/i.test(rest[0])) return null;
    return { kind: 'agent', guild, stem: rest[0].replace(/\.md$/i, '') };
  }

  // `skills/<name>/SKILL.md` per the Agent Skills spec. Bundled resources under
  // the skill (scripts/, references/, assets/) are real and are not members.
  if (rest.length === 2 && rest[1].toUpperCase() === 'SKILL.MD') {
    return { kind: 'skill', guild, stem: rest[0] };
  }
  return null;
}

function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

/**
 * The importer proper.
 *
 * @param {{path: string, text: string}[]} files
 * @param {{now?: string, source?: string}} [opts]
 * @returns {{ecosystem: object, report: object}}
 */
export function importFiles(files, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const source = opts.source ?? 'directory';

  const report = {
    source,
    filesSeen: Array.isArray(files) ? files.length : 0,
    charterFiles: 0,
    skipped: [],
    duplicates: [],
    truncated: null,
    notes: [],
  };

  if (!Array.isArray(files) || files.length === 0) {
    report.notes.push('No files were given, so there is nothing to render.');
    return { ecosystem: emptyEcosystem(now), report };
  }

  // ---- ceilings -----------------------------------------------------------
  let kept = files;
  if (files.length > IMPORT_LIMITS.maxFiles) {
    kept = files.slice(0, IMPORT_LIMITS.maxFiles);
    report.truncated = `only the first ${IMPORT_LIMITS.maxFiles} of ${files.length} files were read`;
  }
  const usable = [];
  let total = 0;
  for (const file of kept) {
    const size = byteLength(file && file.text);
    if (size > IMPORT_LIMITS.maxFileBytes) {
      report.skipped.push({ path: String(file && file.path), reason: 'file is larger than 2 MB' });
      continue;
    }
    total += size;
    if (total > IMPORT_LIMITS.maxTotalBytes) {
      report.truncated = `stopped after ${IMPORT_LIMITS.maxTotalBytes} bytes; the rest of the drop was not read`;
      break;
    }
    usable.push(file);
  }

  const root = findRoot(usable.map((f) => f.path));
  const rootDepth = root.length;

  // ---- constitution -------------------------------------------------------
  let constitution = '';
  const agentFiles = [];
  const skillFiles = [];

  for (const file of usable) {
    const seg = segmentsOf(file.path);
    const rel = seg.slice(rootDepth);
    const hit = classify(rel);
    if (!hit) continue;
    if (hit.kind === 'constitution') { constitution = String(file.text ?? ''); continue; }
    if (hit.kind === 'agent') agentFiles.push({ file, hit });
    else skillFiles.push({ file, hit });
  }
  report.charterFiles = agentFiles.length + skillFiles.length;

  const divisions = parseDivisions(constitution);
  const divisionOf = new Map();
  const directors = new Set();
  for (const d of divisions) {
    for (const mem of d.members) {
      divisionOf.set(mem.id, `${d.number} ${d.name}`);
      if (mem.director) directors.add(mem.id);
    }
  }
  const systemAgents = parseSystemAgents(constitution);

  // ---- agents -------------------------------------------------------------
  const agents = [];
  const bodies = new Map();
  const seenAgents = new Set();

  for (const { file, hit } of agentFiles) {
    const text = prepare(file.text);
    const problem = frontmatterProblem(text);
    if (problem) {
      report.skipped.push({ path: file.path, reason: problem });
      continue;
    }
    let data;
    let body;
    try {
      ({ data, body } = parseFrontmatter(text));
    } catch {
      report.skipped.push({ path: file.path, reason: 'could not be parsed' });
      continue;
    }
    const id = String(data.name ?? '').trim() || hit.stem.trim();
    if (!id) {
      report.skipped.push({ path: file.path, reason: 'no name in frontmatter and no usable filename' });
      continue;
    }
    if (seenAgents.has(id)) {
      report.duplicates.push({ id, kind: 'agent', path: file.path });
      continue;
    }
    seenAgents.add(id);
    bodies.set(id, body);
    agents.push({
      id,
      description: String(data.description ?? ''),
      tools: String(data.tools ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      model: data.model ? String(data.model) : null,
      division: divisionOf.get(id) ?? null,
      guild: hit.guild,
      director: directors.has(id),
      system: systemAgents.has(id),
    });
  }

  // ---- edges --------------------------------------------------------------
  const knownIds = agents.map((a) => a.id);
  const seenEdge = new Set();
  const edges = [];
  for (const a of agents) {
    let found;
    try {
      found = parseEdges(a.id, bodies.get(a.id) ?? '', knownIds);
    } catch {
      report.skipped.push({ path: `${a.id} (wiring)`, reason: 'declarations could not be read' });
      continue;
    }
    for (const e of found) {
      const key = `${e.from}->${e.to}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push(e);
    }
  }

  // ---- skills -------------------------------------------------------------
  const skills = [];
  const seenSkills = new Set();
  for (const { file, hit } of skillFiles) {
    const text = prepare(file.text);
    const problem = frontmatterProblem(text);
    if (problem) {
      report.skipped.push({ path: file.path, reason: problem });
      continue;
    }
    let data;
    try {
      ({ data } = parseFrontmatter(text));
    } catch {
      report.skipped.push({ path: file.path, reason: 'could not be parsed' });
      continue;
    }
    const id = String(data.name ?? '').trim() || hit.stem.trim();
    if (!id) {
      report.skipped.push({ path: file.path, reason: 'no name in frontmatter and no usable directory name' });
      continue;
    }
    if (seenSkills.has(id)) {
      report.duplicates.push({ id, kind: 'skill', path: file.path });
      continue;
    }
    seenSkills.add(id);
    skills.push({ id, description: String(data.description ?? ''), guild: hit.guild });
  }

  // ---- the wiring audit, only when the convention is actually in use ------
  //
  // polis reports members nobody names UPSTREAM or DOWNSTREAM, which is a real
  // finding about a system that USES that convention. A visitor whose charters
  // do not declare wiring at all would otherwise be told that 100 percent of
  // their ecosystem is unreachable, which is not a finding about their system,
  // it is a finding about ours. So the audit runs only when at least one
  // declaration was found, and says so plainly when it did not run.
  const named = new Set();
  for (const e of edges) { named.add(e.from); named.add(e.to); }
  let unreachable = [];
  if (edges.length > 0) {
    unreachable = agents.filter((a) => !a.system && !named.has(a.id)).map((a) => a.id);
  } else if (agents.length > 0) {
    report.notes.push(
      'No UPSTREAM or DOWNSTREAM declarations were found, so no roads were drawn and no wiring audit was run. ' +
      'That is a difference in convention, not a fault in your ecosystem.'
    );
  }
  if (!constitution && agents.length > 0) {
    report.notes.push('No ECOSYSTEM.md was found, so nobody has a division and no directors are marked.');
  }
  if (agents.length === 0 && skills.length === 0) {
    report.notes.push(
      'Nothing looked like a charter. This reads agents/*.md and skills/<name>/SKILL.md, ' +
      'so point it at a .claude directory or a zip of one.'
    );
  }

  const guilds = [...new Set([...agents, ...skills].map((m) => m.guild).filter(Boolean))].sort();

  const ecosystem = {
    generatedAt: now,
    // Not "personal": this snapshot was made in the visitor's browser from
    // their own files, and the value should say so rather than borrow a label
    // that means something else in the house snapshot.
    scope: 'imported',
    divisions: divisions.map((d) => ({ number: d.number, name: d.name })),
    guilds,
    agents,
    edges,
    skills,
    stats: {
      agents: agents.length,
      skills: skills.length,
      divisions: divisions.length,
      guilds: guilds.length,
      edges: edges.length,
      directors: agents.filter((a) => a.director).length,
      unreachable: unreachable.length,
      withheld: 0,
    },
    unreachable,
    // Always empty, and the field is kept rather than dropped so the renderer
    // needs no special case. Nothing is withheld from a person looking at
    // their own files.
    withheld: [],
  };

  return { ecosystem, report };
}

function emptyEcosystem(now) {
  return {
    generatedAt: now,
    scope: 'imported',
    divisions: [],
    guilds: [],
    agents: [],
    edges: [],
    skills: [],
    stats: { agents: 0, skills: 0, divisions: 0, guilds: 0, edges: 0, directors: 0, unreachable: 0, withheld: 0 },
    unreachable: [],
    withheld: [],
  };
}

/**
 * Shape two: a zip of the tree.
 *
 * Decompression is `DecompressionStream`, which is part of the runtime, so
 * this stays a local operation. A zip that cannot be opened at all throws
 * (there is nothing to render and an empty city would be a lie); individual
 * members that cannot be read are folded into the same skipped list as any
 * other unreadable charter.
 */
export async function importZip(input, opts = {}) {
  const { files, skipped } = await readZipAsText(input);
  const out = importFiles(files, { ...opts, source: opts.source ?? 'zip' });
  for (const s of skipped) out.report.skipped.push({ path: s.name, reason: s.reason });
  out.report.filesSeen = files.length + skipped.length;
  return out;
}

/**
 * Shape three: one file, pasted.
 *
 * A single document carries no directory, and the directory is what says
 * whether a charter is an agent or a skill. Rather than guess silently, the
 * guess is made explicit and returned: a filename of `SKILL.md` settles it, a
 * `tools:` or `model:` field is strong evidence of an agent charter, and
 * anything else defaults to an agent with `kindGuess.confident === false` so
 * the page can offer the visitor a switch instead of quietly deciding for
 * them.
 */
export function importPastedFile(text, opts = {}) {
  const raw = prepare(text);
  const filename = String(opts.filename ?? '').trim();
  const { data } = parseFrontmatter(raw);

  let kind = opts.kind ?? null;
  let confident = Boolean(opts.kind);
  let reason = opts.kind ? 'you chose it' : '';
  if (!kind) {
    if (/^skill\.md$/i.test(filename.split(/[\\/]/).pop() ?? '')) {
      kind = 'skill'; confident = true; reason = 'the filename is SKILL.md';
    } else if (data.tools || data.model) {
      kind = 'agent'; confident = true; reason = 'the frontmatter declares tools or a model, which only an agent charter does';
    } else {
      kind = 'agent'; confident = false; reason = 'nothing in the file settles it, so it was read as an agent charter';
    }
  }

  const stem = String(data.name ?? '').trim()
    || (filename ? filename.split(/[\\/]/).pop().replace(/\.md$/i, '') : '')
    || 'pasted';

  const path = kind === 'skill' ? `skills/${stem}/SKILL.md` : `agents/${stem}.md`;
  const out = importFiles([{ path, text: raw }], { ...opts, source: opts.source ?? 'paste' });
  out.report.kindGuess = { kind, confident, reason };
  return out;
}
