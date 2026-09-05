/**
 * Who actually worked on what.
 *
 * The rest of polis reads the ecosystem's STRUCTURE — who exists, which
 * division they belong to, who names whom. That is an org chart, and an org
 * chart tells you nothing about whether anyone showed up.
 *
 * This reads the ecosystem's ACTIVITY. Claude Code writes every session to
 * `~/.claude/projects/<encoded-cwd>/<session>.jsonl`, and every delegation
 * appears there as a `tool_use` block naming the `subagent_type` that was
 * dispatched, stamped with a time and a working directory. That is real
 * ground truth about which agents ran, on which project, in which session,
 * and therefore alongside whom.
 *
 * Two things this deliberately does NOT do:
 *
 *   1. It does not read prompts, results, or any message content. Only the
 *      dispatch metadata — agent name, timestamp, session id, project. The
 *      transcripts contain client work and personal material; a tool that
 *      renders a public web page has no business opening them.
 *   2. It does not cross worlds. `~/.claude/projects` holds sessions from
 *      D:\Lift, D:\Freelance and D:\RelaxOps alongside personal ones. Those
 *      are other worlds under the machine's routing law, and a Lift client
 *      engagement must never surface on a personal page. Non-personal
 *      sessions are skipped and COUNTED, so the output can state what it
 *      left out rather than quietly under-reporting.
 *
 * The counting rule worth knowing: an "assignment" is one dispatch, not one
 * agent. Invoking `code-reviewer` three times in a session is three
 * assignments and one collaborator, and the two numbers answer different
 * questions.
 */

const PERSONAL_ROOT = 'c:\\users\\admin';

/** Projects that are infrastructure rather than work, folded into one bucket. */
const INFRA_SEGMENTS = new Set(['.claude', 'appdata', 'documents']);

function normalizeProject(cwd) {
  if (!cwd) return null;
  const lower = cwd.toLowerCase().replace(/\//g, '\\');
  if (!lower.startsWith(PERSONAL_ROOT)) return null; // another world
  const rest = lower.slice(PERSONAL_ROOT.length).replace(/^\\+/, '');
  if (!rest) return 'home';
  const first = rest.split('\\')[0];
  if (INFRA_SEGMENTS.has(first)) return first === '.claude' ? 'the ecosystem itself' : null;
  return first;
}

/**
 * Split `design-guild:design-reviewer` into its namespace and its id.
 *
 * Found by running against the real logs, and it had produced a confident
 * wrong answer: guild members are dispatched under a plugin-namespaced type,
 * so keying on the raw string meant `design-guild:design-reviewer` never
 * matched the roster's `design-reviewer`. Fourteen real dispatches were being
 * reported as "this agent has never run" — a false positive of exactly the
 * kind that teaches somebody to stop trusting the output.
 *
 * The namespace is kept rather than discarded, because "which plugin did this
 * come from" is a real distinction: `firm-pro:*` members belong to the Lift
 * plugin and are not part of the personal roster at all.
 */
function splitAgent(raw) {
  const i = raw.indexOf(':');
  if (i === -1) return { id: raw, namespace: null };
  return { id: raw.slice(i + 1), namespace: raw.slice(0, i) };
}

function toolUsesIn(record) {
  const content = record && record.message && record.message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (c) => c && c.type === 'tool_use' && (c.name === 'Agent' || c.name === 'Task') && c.input,
  );
}

/**
 * @param {object} io
 * @param {(p:string)=>string[]} io.listDir
 * @param {(p:string)=>string} io.readFile
 * @param {(p:string)=>boolean} io.exists
 * @param {object} opts
 * @param {string} opts.root the projects directory
 * @param {string} [opts.now] ISO timestamp, injectable so tests are not clock-dependent
 * @param {number} [opts.activeHours] how recent counts as "currently working"
 */
export function extractWorkforce(io, opts) {
  const root = opts.root;
  const now = opts.now ? new Date(opts.now) : new Date();
  const activeHours = opts.activeHours ?? 24;
  const activeCutoff = now.getTime() - activeHours * 3600 * 1000;

  const assignments = [];
  const excluded = { otherWorlds: 0, unparseable: 0, noProject: 0 };

  const dirs = io.exists(root) ? io.listDir(root) : [];
  for (const dir of dirs) {
    let files;
    try {
      files = io.listDir(`${root}/${dir}`).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      let text;
      try {
        text = io.readFile(`${root}/${dir}/${file}`);
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (!line || line.indexOf('subagent_type') === -1) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          excluded.unparseable += 1;
          continue;
        }
        for (const use of toolUsesIn(rec)) {
          const raw = use.input.subagent_type;
          if (!raw) continue;
          const { id: agent, namespace } = splitAgent(raw);
          const project = normalizeProject(rec.cwd);
          if (project === null) {
            // Either another world, or an unremarkable path. Both are
            // withheld; only the first is interesting enough to count.
            if (rec.cwd && !rec.cwd.toLowerCase().replace(/\//g, '\\').startsWith(PERSONAL_ROOT)) {
              excluded.otherWorlds += 1;
            } else {
              excluded.noProject += 1;
            }
            continue;
          }
          assignments.push({
            agent,
            namespace,
            project,
            session: rec.sessionId || dir,
            at: rec.timestamp || null,
          });
        }
      }
    }
  }

  // ---- per agent --------------------------------------------------------
  const byAgent = new Map();
  for (const a of assignments) {
    if (!byAgent.has(a.agent)) {
      byAgent.set(a.agent, { id: a.agent, namespace: a.namespace, assignments: 0, projects: new Set(), lastAt: null });
    }
    const rec = byAgent.get(a.agent);
    rec.assignments += 1;
    rec.projects.add(a.project);
    if (a.at && (!rec.lastAt || a.at > rec.lastAt)) rec.lastAt = a.at;
  }

  const agents = [...byAgent.values()]
    .map((r) => ({
      id: r.id,
      namespace: r.namespace,
      assignments: r.assignments,
      projects: [...r.projects].sort(),
      lastAt: r.lastAt,
      active: Boolean(r.lastAt && new Date(r.lastAt).getTime() >= activeCutoff),
    }))
    .sort((a, b) => b.assignments - a.assignments || a.id.localeCompare(b.id));

  // ---- per project ------------------------------------------------------
  const byProject = new Map();
  for (const a of assignments) {
    if (!byProject.has(a.project)) {
      byProject.set(a.project, { id: a.project, assignments: 0, crew: new Set(), lastAt: null });
    }
    const rec = byProject.get(a.project);
    rec.assignments += 1;
    rec.crew.add(a.agent);
    if (a.at && (!rec.lastAt || a.at > rec.lastAt)) rec.lastAt = a.at;
  }

  const projects = [...byProject.values()]
    .map((r) => ({
      id: r.id,
      assignments: r.assignments,
      crew: [...r.crew].sort(),
      lastAt: r.lastAt,
      active: Boolean(r.lastAt && new Date(r.lastAt).getTime() >= activeCutoff),
    }))
    .sort((a, b) => b.assignments - a.assignments || a.id.localeCompare(b.id));

  // ---- who works alongside whom ----------------------------------------
  // Two agents are collaborators if they were dispatched in the SAME session.
  // Same project across different months is shared subject matter, not
  // teamwork, and conflating the two would invent collaborations that never
  // happened.
  const bySession = new Map();
  for (const a of assignments) {
    // Keyed on session AND project. Session alone was too coarse against the
    // real logs: one long working session touched 25 different repos, and
    // pairing everyone in it produced 248 "collaborations" that never
    // happened. Two agents worked together if they worked on the same thing
    // at the same sitting.
    const key = `${a.session}::${a.project}`;
    if (!bySession.has(key)) bySession.set(key, new Set());
    bySession.get(key).add(a.agent);
  }
  const pairCounts = new Map();
  for (const crew of bySession.values()) {
    const list = [...crew].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}|${list[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  const collaborations = [...pairCounts.entries()]
    .map(([key, sessions]) => {
      const [a, b] = key.split('|');
      return { a, b, sessions };
    })
    .sort((x, y) => y.sessions - x.sessions || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  return {
    generatedAt: now.toISOString(),
    activeHours,
    assignments: assignments.length,
    agents,
    projects,
    collaborations,
    excluded,
    stats: {
      assignments: assignments.length,
      agentsEverDispatched: agents.length,
      projectsTouched: projects.length,
      workUnits: bySession.size,
      collaborationPairs: collaborations.length,
      excludedOtherWorlds: excluded.otherWorlds,
    },
  };
}

/**
 * Agents that exist in the roster but have never once been dispatched.
 *
 * This is the number that matters most and the one nobody publishes. An
 * ecosystem is not what its charters describe, it is what actually runs; a
 * member with zero assignments is a maintenance cost that has never returned
 * anything, and the honest thing is to say so in public rather than to count
 * it as capability.
 */
export function neverDispatched(rosterIds, workforce) {
  const seen = new Set(workforce.agents.map((a) => a.id));
  return rosterIds.filter((id) => !seen.has(id)).sort();
}
