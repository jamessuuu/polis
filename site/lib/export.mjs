/**
 * Produce a bundle that actually works when the visitor unzips it into
 * `~/.claude/`.
 *
 * The bar here is not "a file downloads". It is that the archive contains
 * agent charters Claude Code will load and `SKILL.md` files that pass the
 * Agent Skills reference validator, so that a stranger who takes the free
 * thing on offer gets a working setup rather than a souvenir.
 *
 * THE TWO FORMATS ARE NOT THE SAME FORMAT, and conflating them is the easiest
 * way to ship something that looks right and loads nothing:
 *
 *   - An AGENT is a single markdown file with Claude Code's frontmatter
 *     (`name`, `description`, `tools`, `model`) and the charter as the body.
 *     That shape is read from this machine's own `~/.claude/agents/*.md`, not
 *     from a specification, because there is no open specification for it.
 *   - A SKILL is a directory with a `SKILL.md` inside it, and it follows the
 *     Agent Skills open standard (agentskills.io/specification, read
 *     2026-09-07). Required: `name` (1-64 chars, lowercase alphanumerics and
 *     single hyphens, no leading or trailing hyphen, matching the parent
 *     directory) and `description` (1-1024 chars, non-empty). Optional:
 *     `license`, `compatibility` (max 500), `metadata` (string to string map)
 *     and `allowed-tools` (a space separated string, marked experimental).
 *
 * QUOTING IS LOAD-BEARING. Real charter descriptions contain ": " in ordinary
 * prose ("an implementation plan: data model, module boundaries"), and a plain
 * YAML scalar may not. Emitting these unquoted produces a file that a lenient
 * reader accepts and a strict one (the reference validator uses strictyaml)
 * rejects or mis-parses. Every free-text field written here is quoted.
 *
 * NOTHING IS SILENTLY LOST OR SILENTLY INVENTED. A description longer than the
 * spec's 1024 characters is cut to fit AND reproduced in full in the body
 * under its own heading, with a warning naming the file and the original
 * length. A name that is not spec-legal is normalised and the change is
 * reported. A member with no charter body gets a body that says exactly that
 * and nothing else; it never gets prose written for it.
 */

import { writeZip } from './zip.mjs';

/** Limits from the Agent Skills specification, in one place. */
export const SKILL_LIMITS = {
  name: 64,
  description: 1024,
  compatibility: 500,
};

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// YAML emission
// ---------------------------------------------------------------------------

/** Collapse to one line. Frontmatter scalars here are all single-line fields. */
export function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Quote a scalar so a strict YAML parser reads back exactly what went in.
 *
 * Double quotes when the text has no double quote and no backslash, single
 * quotes when it has double quotes but no single quote, and escaped double
 * quotes otherwise. Preferring the styles that need no escapes keeps the file
 * readable by a person and keeps a naive frontmatter reader (this repo's own
 * `parseFrontmatter`, which just strips matching outer quotes) correct too.
 */
export function yamlScalar(value) {
  const s = oneLine(value);
  if (!s.includes('"') && !s.includes('\\')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Normalisation and validation
// ---------------------------------------------------------------------------

/**
 * Force a name into the shape the spec requires, and say whether it changed.
 *
 * @returns {{name: string, changed: boolean, reason: string|null}}
 */
export function normaliseSkillName(raw) {
  const original = String(raw ?? '').trim();
  let name = original
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (name.length > SKILL_LIMITS.name) {
    name = name.slice(0, SKILL_LIMITS.name).replace(/-$/, '');
  }
  if (!name) return { name: 'skill', changed: true, reason: `"${original}" contains no usable characters, so it became "skill"` };
  if (name === original) return { name, changed: false, reason: null };
  return { name, changed: true, reason: `"${original}" is not a legal skill name, so it became "${name}"` };
}

/**
 * Check frontmatter against the specification's stated constraints.
 *
 * This is the second of the two ways the export is verified. The first is the
 * reference validator itself (`npx skills-ref validate`, run by
 * tools/validate-export.mjs); this one runs in-process, in the browser too,
 * and covers the same rules so a bad bundle is refused before it is offered
 * rather than after somebody downloads it.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSkillFrontmatter(fm, dirName = null) {
  const errors = [];
  const name = fm && typeof fm.name === 'string' ? fm.name : '';
  if (!name) errors.push('name is required');
  else {
    if (name.length > SKILL_LIMITS.name) errors.push(`name is ${name.length} characters, over the ${SKILL_LIMITS.name} limit`);
    if (!NAME_RE.test(name)) errors.push(`name "${name}" must be lowercase letters, digits and single hyphens, with no leading or trailing hyphen`);
    if (dirName !== null && name !== dirName) errors.push(`name "${name}" does not match its directory "${dirName}"`);
  }

  const description = fm && typeof fm.description === 'string' ? fm.description : '';
  if (!description.trim()) errors.push('description is required and must be non-empty');
  else if (description.length > SKILL_LIMITS.description) {
    errors.push(`description is ${description.length} characters, over the ${SKILL_LIMITS.description} limit`);
  }

  if (fm && fm.compatibility !== undefined) {
    const c = String(fm.compatibility);
    if (!c.trim()) errors.push('compatibility, when present, must be non-empty');
    else if (c.length > SKILL_LIMITS.compatibility) {
      errors.push(`compatibility is ${c.length} characters, over the ${SKILL_LIMITS.compatibility} limit`);
    }
  }

  if (fm && fm.metadata !== undefined) {
    const m = fm.metadata;
    if (!m || typeof m !== 'object' || Array.isArray(m)) errors.push('metadata must be a map of string keys to string values');
    else {
      for (const [k, v] of Object.entries(m)) {
        if (typeof v !== 'string') errors.push(`metadata.${k} must be a string`);
      }
    }
  }

  if (fm && fm['allowed-tools'] !== undefined && typeof fm['allowed-tools'] !== 'string') {
    errors.push('allowed-tools must be a space separated string');
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// File rendering
// ---------------------------------------------------------------------------

const NO_BODY = [
  'This charter was imported from frontmatter only.',
  '',
  'polis reads a member\'s name, description, tools and model and deliberately never',
  'carries charter prose into a snapshot, so there is no body to reproduce here.',
  'Paste the original charter text below this line and the agent is whole again.',
].join('\n');

/**
 * One agent charter, in Claude Code's own file shape.
 *
 * `tools` and `model` are omitted entirely when absent rather than written as
 * empty strings: an empty `tools:` line means something different from no line
 * at all (no tools versus the default grant), and guessing between them would
 * change how the agent runs.
 */
export function agentMarkdown(agent) {
  const lines = ['---'];
  lines.push(`name: ${oneLine(agent.id)}`);
  lines.push(`description: ${yamlScalar(agent.description ?? '')}`);
  const tools = Array.isArray(agent.tools) ? agent.tools.filter(Boolean) : [];
  if (tools.length) lines.push(`tools: ${tools.join(', ')}`);
  if (agent.model) lines.push(`model: ${oneLine(agent.model)}`);
  lines.push('---');
  lines.push('');
  const body = String(agent.body ?? '').trim();
  lines.push(body || NO_BODY);
  lines.push('');
  return lines.join('\n');
}

/**
 * One SKILL.md, conforming to the Agent Skills field set and limits.
 *
 * @returns {{name: string, text: string, warnings: string[]}}
 */
export function skillMarkdown(skill) {
  const warnings = [];
  const named = normaliseSkillName(skill.name ?? skill.id ?? '');
  if (named.changed) warnings.push(named.reason);

  const full = oneLine(skill.description ?? '');
  let description = full;
  let overflow = null;
  if (!description) {
    // Refused rather than filled in. An invented description is exactly the
    // thing that makes a skill fire on the wrong task.
    warnings.push(`"${named.name}" has no description, and the spec requires one`);
  } else if (description.length > SKILL_LIMITS.description) {
    overflow = full;
    const cut = description.slice(0, SKILL_LIMITS.description);
    const lastSpace = cut.lastIndexOf(' ');
    description = (lastSpace > SKILL_LIMITS.description - 120 ? cut.slice(0, lastSpace) : cut).trim();
    warnings.push(
      `"${named.name}" had a ${full.length} character description and the spec caps it at ` +
      `${SKILL_LIMITS.description}, so the frontmatter was cut and the full text kept in the body`
    );
  }

  const lines = ['---'];
  lines.push(`name: ${named.name}`);
  lines.push(`description: ${yamlScalar(description)}`);
  if (skill.license) lines.push(`license: ${yamlScalar(skill.license)}`);
  if (skill.compatibility) lines.push(`compatibility: ${yamlScalar(String(skill.compatibility).slice(0, SKILL_LIMITS.compatibility))}`);
  if (skill['allowed-tools'] || skill.allowedTools) {
    lines.push(`allowed-tools: ${yamlScalar(skill['allowed-tools'] ?? skill.allowedTools)}`);
  }
  const metadata = skill.metadata && typeof skill.metadata === 'object' ? skill.metadata : null;
  if (metadata && Object.keys(metadata).length) {
    lines.push('metadata:');
    for (const [k, v] of Object.entries(metadata)) lines.push(`  ${k}: ${yamlScalar(v)}`);
  }
  lines.push('---');
  lines.push('');
  const body = String(skill.body ?? '').trim();
  lines.push(body || `# ${named.name}\n\nThis skill was imported from frontmatter only; its procedure was not captured.`);
  if (overflow) {
    lines.push('');
    lines.push('## Full description');
    lines.push('');
    lines.push('The frontmatter description above is cut to the 1024 character limit of the');
    lines.push('Agent Skills specification. The original, in full:');
    lines.push('');
    lines.push(overflow);
  }
  lines.push('');

  return { name: named.name, text: lines.join('\n'), warnings };
}

/**
 * The README that tells a person where to put this.
 *
 * Every path in it is real and was checked against this machine's own layout;
 * there is no "your agents directory" hand-wave, because the whole promise of
 * the export is that it works when it lands.
 */
export function readmeMarkdown(meta) {
  const title = meta.title ?? 'Agent bundle';
  const agents = meta.agents ?? [];
  const skills = meta.skills ?? [];
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (meta.summary) { lines.push(meta.summary); lines.push(''); }
  lines.push(`Exported by polis on ${meta.generatedAt ?? new Date().toISOString()}.`);
  lines.push('');
  lines.push('## What is in here');
  lines.push('');
  lines.push(`- ${agents.length} agent ${agents.length === 1 ? 'charter' : 'charters'} in \`agents/\``);
  lines.push(`- ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'} in \`skills/\`, each a directory with a \`SKILL.md\``);
  lines.push('');
  if (agents.length) {
    lines.push('### Agents');
    lines.push('');
    for (const a of agents) lines.push(`- **${a.id}** ${oneLine(a.description).slice(0, 200)}`);
    lines.push('');
  }
  if (skills.length) {
    lines.push('### Skills');
    lines.push('');
    for (const s of skills) lines.push(`- **${s.name}** ${oneLine(s.description).slice(0, 200)}`);
    lines.push('');
  }
  lines.push('## Where to put it');
  lines.push('');
  lines.push('Unzip this archive straight into your Claude Code configuration directory, so');
  lines.push('that `agents/` and `skills/` land beside the ones already there.');
  lines.push('');
  lines.push('| System | Directory |');
  lines.push('| --- | --- |');
  lines.push('| macOS and Linux | `~/.claude/` |');
  lines.push('| Windows | `%USERPROFILE%\\.claude\\` |');
  lines.push('');
  lines.push('For a single project instead of every project, unzip into `.claude/` at the');
  lines.push('root of that project. Restart Claude Code afterwards so it rereads the');
  lines.push('directory, then check with `/agents` and `/skills`.');
  lines.push('');
  lines.push('If a file here has the same name as one you already have, yours is the one');
  lines.push('that gets overwritten. Rename before unzipping if that matters.');
  lines.push('');
  lines.push('## Other agent tools');
  lines.push('');
  lines.push('The skills follow the Agent Skills open standard (agentskills.io), so they also');
  lines.push('load in the other clients that implement it. Check that client\'s own docs for');
  lines.push('the directory it reads. The agent charters use Claude Code\'s own frontmatter');
  lines.push('and are not part of that standard, so they are Claude Code specific.');
  lines.push('');
  lines.push('You can validate every skill in here yourself:');
  lines.push('');
  lines.push('```');
  lines.push('npx skills-ref validate ./skills/<name>');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

/**
 * Build the file list for a bundle.
 *
 * @param {{agents?: object[], skills?: object[], title?: string, summary?: string, generatedAt?: string}} input
 * @returns {{files: {path: string, text: string}[], warnings: string[], skills: object[], agents: object[]}}
 */
export function buildBundle(input) {
  const warnings = [];
  const files = [];
  const agents = [];
  const skills = [];

  const seenAgents = new Set();
  for (const agent of input.agents ?? []) {
    const id = normaliseSkillName(agent.id ?? agent.name ?? '');
    if (id.changed) warnings.push(`agent ${id.reason}`);
    if (seenAgents.has(id.name)) {
      warnings.push(`two agents both wanted the file agents/${id.name}.md, so the second was dropped`);
      continue;
    }
    seenAgents.add(id.name);
    const record = { ...agent, id: id.name };
    files.push({ path: `agents/${id.name}.md`, text: agentMarkdown(record) });
    agents.push(record);
  }

  const seenSkills = new Set();
  for (const skill of input.skills ?? []) {
    const rendered = skillMarkdown(skill);
    warnings.push(...rendered.warnings);
    if (seenSkills.has(rendered.name)) {
      warnings.push(`two skills both wanted the directory skills/${rendered.name}, so the second was dropped`);
      continue;
    }
    seenSkills.add(rendered.name);
    files.push({ path: `skills/${rendered.name}/SKILL.md`, text: rendered.text });
    skills.push({ ...skill, name: rendered.name });
  }

  files.unshift({
    path: 'README.md',
    text: readmeMarkdown({
      title: input.title,
      summary: input.summary,
      generatedAt: input.generatedAt,
      agents,
      skills,
    }),
  });

  return { files, warnings, agents, skills };
}

/** A bundle from a library template, bodies and all. */
export function bundleFromTemplate(template, opts = {}) {
  return buildBundle({
    title: template.name,
    summary: template.summary,
    generatedAt: opts.generatedAt,
    agents: template.agents,
    skills: template.skills,
  });
}

/**
 * A bundle from an ecosystem snapshot, which carries no charter prose.
 *
 * `bodies` is how the caller supplies it: the page holds the visitor's
 * original file texts in memory during an import, so a round trip can hand
 * back exactly what came in. Where a body is missing the charter says so
 * instead of being padded out with plausible sentences.
 */
export function bundleFromEcosystem(ecosystem, opts = {}) {
  const bodies = opts.bodies ?? {};
  const missing = [];
  const agents = (ecosystem.agents ?? []).map((a) => {
    const body = bodies[`agents/${a.id}`] ?? bodies[a.id] ?? '';
    if (!body) missing.push(a.id);
    return { ...a, body };
  });
  const skills = (ecosystem.skills ?? []).map((s) => ({
    name: s.id,
    description: s.description,
    body: bodies[`skills/${s.id}`] ?? '',
  }));
  const out = buildBundle({
    title: opts.title ?? 'Exported ecosystem',
    summary: opts.summary,
    generatedAt: opts.generatedAt ?? ecosystem.generatedAt,
    agents,
    skills,
  });
  if (missing.length) {
    out.warnings.push(
      `${missing.length} ${missing.length === 1 ? 'charter has' : 'charters have'} frontmatter but no body, ` +
      'so the exported file says so rather than inventing one'
    );
  }
  return out;
}

/** Every SKILL.md in a bundle, checked against the spec before it is offered. */
export function validateBundle(files) {
  const errors = [];
  for (const file of files) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.path);
    if (!m) continue;
    const fm = readFrontmatterForCheck(file.text);
    const verdict = validateSkillFrontmatter(fm, m[1]);
    for (const e of verdict.errors) errors.push(`${file.path}: ${e}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * A frontmatter reader used only to check this module's own output.
 *
 * Deliberately separate from `src/extract.mjs`'s reader: checking a writer
 * with the reader that shares its assumptions passes on the assumptions too.
 * This one unquotes the way YAML does rather than the way that reader does,
 * and it understands the one nested mapping the spec allows (`metadata`).
 */
export function readFrontmatterForCheck(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line) || !line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (raw === '') {
      const map = {};
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        const sub = lines[++i];
        const j = sub.indexOf(':');
        if (j < 0) continue;
        map[sub.slice(0, j).trim()] = unquote(sub.slice(j + 1).trim());
      }
      out[key] = map;
      continue;
    }
    out[key] = unquote(raw);
  }
  return out;
}

function unquote(raw) {
  if (raw.length >= 2 && raw[0] === '"' && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (raw.length >= 2 && raw[0] === "'" && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

/** The bundle as zip bytes, built in the tab with no dependency. */
export async function bundleZip(files, opts = {}) {
  return writeZip(files, opts);
}
