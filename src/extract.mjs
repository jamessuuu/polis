/**
 * Read the agent ecosystem off disk and produce one snapshot object.
 *
 * Pure-ish: every filesystem call goes through an injected `fs` shim so the
 * whole thing is testable against fixtures with no real directory.
 *
 * PRIVACY, and it is the reason this file has an allowlist rather than a
 * denylist. The ecosystem contains guild agents that name a real employer and
 * real clients (lift-guild, firm-pro, and anything mentioning an engagement).
 * A snapshot of "my agent society" is a lovely thing to publish and a terrible
 * thing to publish carelessly. So:
 *
 *   - `scope: "personal"` (the DEFAULT) reads only ~/.claude/agents and
 *     ~/.claude/skills. Those are James's own members.
 *   - Anything whose id or DESCRIPTION matches CLIENT_PATTERNS is
 *     dropped and COUNTED, never silently included. The count is published so
 *     the site can say "N members withheld" rather than pretending the
 *     ecosystem is smaller than it is.
 *   - Charter BODIES are never included in the snapshot. Only frontmatter
 *     fields and derived edges. A charter can contain client specifics in
 *     prose; a name and a description are the parts meant to be read.
 */

/** Words that mean a member is about a real client or employer. */
export const CLIENT_PATTERNS = [
  /\blift[- ]?(legal|guild)\b/i,
  /\bfirm-pro\b/i,
  /\brelaxops\b/i,
  /\bnadela\b/i,
  /\bbasecamp\b/i,
  /\blaw firm\b/i,
];

export function looksClientSpecific(...texts) {
  const hay = texts.filter(Boolean).join(' \n ');
  return CLIENT_PATTERNS.some((re) => re.test(hay));
}

/** Parse YAML-ish frontmatter. Only the flat scalar fields charters use. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!m) return { data: {}, body: String(text ?? '') };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (!key || key.startsWith('#')) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: String(text).slice(m[0].length) };
}

/**
 * Divisions, read from ECOSYSTEM.md section 3 rather than hardcoded, so the
 * snapshot follows the constitution instead of drifting from it.
 * Lines look like: `- **03 Engineering** — architect (Director), code-reviewer, ...`
 */
export function parseDivisions(ecosystemMd) {
  const out = [];
  const lines = String(ecosystemMd ?? '').split(/\r?\n/);

  // Bullets WRAP. A division's member list routinely continues onto indented
  // continuation lines, and a single-line regex silently drops everyone after
  // the wrap. Measured against the real ECOSYSTEM.md on 2026-09-06: 27 of 40
  // agents came back with no division and two divisions looked empty, purely
  // from this. Gather the whole bullet first, then parse it.
  let current = null;
  const bullets = [];
  for (const line of lines) {
    const m = /^- \*\*(\d{2})\s+([^*]+?)\*\*\s*[\u2014-]\s*(.*)$/.exec(line);
    if (m) {
      current = { number: m[1], name: m[2].trim(), text: m[3] };
      bullets.push(current);
      continue;
    }
    // A continuation is an indented, non-empty line that is not a new bullet
    // and not a new heading.
    if (current && /^\s+\S/.test(line) && !/^\s*[-*#]/.test(line)) {
      current.text += ' ' + line.trim();
      continue;
    }
    if (/^\S/.test(line)) current = null; // any unindented line ends the list
  }

  for (const b of bullets) {
    const members = b.text
      // Parenthetical asides carry admission notes and commentary, not names.
      // The one that matters is (Director), which may read (Director/router).
      .replace(/\([^)]*\)/g, (aside) => (/director/i.test(aside) ? ' DIRECTOR ' : ''))
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      // \s+ and not s+. A shell-escaped edit dropped the backslash here on
      // 2026-09-06 and the collapse then replaced every literal "s", so
      // chief-of-staff became "chief-of- taff" and failed the id filter while
      // architect, cto and debugger survived because they contain no "s". Regex
      // edits go through a real editor or a patch file, never a shell string.
      .map((x) => ({ id: x.replace(/DIRECTOR/g, ' ').replace(/\s+/g, ' ').trim(), director: /DIRECTOR/.test(x) }))
      .filter((x) => /^[a-z][a-z0-9-]*$/.test(x.id));
    out.push({ number: b.number, name: b.name, members });
  }
  return out;
}

/**
 * The system agents ECOSYSTEM.md names as exempt.
 *
 * The paragraph reads: "**System agents** (`Explore`, `Plan`, ...) ship with
 * Claude Code, sit in no division, and are exempt from the admission
 * standard." The names are in backticks, so they are pulled from there rather
 * than retyped, and the exemption follows the constitution instead of drifting
 * from it.
 */
export function parseSystemAgents(ecosystemMd) {
  const m = /\*\*System agents\*\*\s*\(([^)]*)\)/.exec(String(ecosystemMd ?? ''));
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter(Boolean));
}

/**
 * Edges from the reciprocity declarations.
 *
 * The constitution requires every member to be named UPSTREAM or DOWNSTREAM by
 * at least one OTHER member. That makes these lines the real wiring of the
 * society, and it makes an unnamed member visible as dead weight rather than
 * as an equally-sized node.
 */
export function parseEdges(agentId, body, knownIds) {
  const edges = [];
  const lines = String(body ?? '').split(/\r?\n/);
  for (const line of lines) {
    const m = /\b(UPSTREAM|DOWNSTREAM)\b\s*:?\s*(.*)$/.exec(line);
    if (!m) continue;
    const dir = m[1].toLowerCase();
    for (const other of knownIds) {
      if (other === agentId) continue;
      // Word-boundary match so `cto` does not match inside `director`.
      const re = new RegExp(`(^|[^a-z0-9-])${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`, 'i');
      if (re.test(m[2])) {
        edges.push(dir === 'upstream' ? { from: other, to: agentId, kind: 'upstream' } : { from: agentId, to: other, kind: 'downstream' });
      }
    }
  }
  return edges;
}

/**
 * @param {object} io
 * @param {(p:string)=>string} io.readFile
 * @param {(p:string)=>string[]} io.listDir
 * @param {(p:string)=>boolean} io.exists
 * @param {object} [opts]
 * @param {'personal'|'all'} [opts.scope]
 */
export function extract(io, opts = {}) {
  const scope = opts.scope ?? 'personal';
  const root = opts.root ?? '';
  const agentsDir = `${root}/agents`;
  const skillsDir = `${root}/skills`;

  const ecosystemMd = io.exists(`${root}/ECOSYSTEM.md`) ? io.readFile(`${root}/ECOSYSTEM.md`) : '';
  const divisions = parseDivisions(ecosystemMd);
  const divisionOf = new Map();
  const directors = new Set();
  for (const d of divisions) {
    for (const mem of d.members) {
      divisionOf.set(mem.id, `${d.number} ${d.name}`);
      if (mem.director) directors.add(mem.id);
    }
  }

  const withheld = [];
  const agents = [];
  const files = io.exists(agentsDir) ? io.listDir(agentsDir).filter((f) => f.endsWith('.md')) : [];

  for (const file of files) {
    const raw = io.readFile(`${agentsDir}/${file}`);
    const { data, body } = parseFrontmatter(raw);
    const id = data.name || file.replace(/\.md$/, '');
    // Id and description only, deliberately NOT the body.
    //
    // The body scan was tried first and was wrong. Run against the real
    // ecosystem on 2026-09-06 it withheld six generic members, including two
    // Directors (chief-of-staff and prompt-engineer), because their charters
    // cite a client project as an EXAMPLE: prompt-engineer says "features James
    // ships to end users (Klik, Nadela Ops, client work)" and cto lists
    // "existing projects (klik, nadela-ops)". Neither agent is about a client.
    //
    // Withholding them produced a materially false picture of the ecosystem,
    // which is its own kind of dishonesty, and it bought nothing: charter
    // bodies never enter the snapshot, so a mention inside one cannot leak. A
    // member that IS about a client says so in its id or its description, and
    // that is what this checks.
    if (scope === 'personal' && looksClientSpecific(id, data.description)) {
      withheld.push({ id, reason: 'id or description names a client or employer' });
      continue;
    }
    agents.push({
      id,
      description: data.description || '',
      // Charter bodies are deliberately not carried into the snapshot.
      tools: (data.tools || '').split(',').map((s) => s.trim()).filter(Boolean),
      model: data.model || null,
      division: divisionOf.get(id) || null,
      director: directors.has(id),
      _body: body,
    });
  }

  const knownIds = agents.map((a) => a.id);
  const edges = [];
  for (const a of agents) {
    for (const e of parseEdges(a.id, a._body, knownIds)) edges.push(e);
    delete a._body;
  }

  // Deduplicate: two charters declaring the same relationship from opposite
  // ends is the reciprocity rule working, not two edges.
  const seen = new Set();
  const uniqueEdges = [];
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEdges.push(e);
  }

  // System agents ship with Claude Code, sit in no division, and the
  // constitution exempts them from the admission standard. They are search and
  // utility runtimes, not organization members, so holding them to the
  // reciprocity rule reports a violation that does not exist. Read from
  // ECOSYSTEM.md rather than hardcoded, for the same reason the divisions are.
  const systemAgents = parseSystemAgents(ecosystemMd);
  for (const a of agents) a.system = systemAgents.has(a.id);

  const named = new Set();
  for (const e of uniqueEdges) { named.add(e.from); named.add(e.to); }
  // The constitution's own audit, computed rather than asserted.
  const unreachable = agents.filter((a) => !a.system && !named.has(a.id)).map((a) => a.id);

  const skills = [];
  if (io.exists(skillsDir)) {
    for (const name of io.listDir(skillsDir)) {
      const p = `${skillsDir}/${name}/SKILL.md`;
      if (!io.exists(p)) continue;
      const { data, body } = parseFrontmatter(io.readFile(p));
      const id = data.name || name;
      if (scope === 'personal' && looksClientSpecific(id, data.description)) {
        withheld.push({ id, reason: 'id or description names a client or employer' });
        continue;
      }
      skills.push({ id, description: data.description || '' });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scope,
    divisions: divisions.map((d) => ({ number: d.number, name: d.name })),
    agents,
    edges: uniqueEdges,
    skills,
    stats: {
      agents: agents.length,
      skills: skills.length,
      divisions: divisions.length,
      edges: uniqueEdges.length,
      directors: agents.filter((a) => a.director).length,
      unreachable: unreachable.length,
      withheld: withheld.length,
    },
    unreachable,
    // Published as a number so the site can say what it is not showing.
    withheld,
  };
}
