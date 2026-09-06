# Polis — pre-visual strategy

Written 2026-09-06 by a design-strategist pass, before any visual work on the
rebuild. `DESIGN.md` and `CHARACTERS.md` are downstream of this file: the
director designs against it, the reviewer grades against it. When a visual
decision conflicts with this brief, the brief wins or the brief gets amended out
loud, in this file, with a reason. It never gets quietly ignored.

**Verdict:** polis serves the **practitioner peer** — an engineer who builds with
agents, has already seen every Graphviz DAG and trace waterfall in the 2026
tooling set, and might share a link. Their one job is to see, in the first screen
and without clicking, that this is a **real** organisation of 59 agents rendered
from files on disk — **and that most of it never runs.**

## 1. Audience, precisely

**P1 — the practitioner peer (primary; wins ties on craft).** An engineer or
technical founder who has built or debugged a multi-agent system. Arrives from a
link James pasted, or a peer's reshare. Desktop 1440-2560 much of the time, phone
often, because social links open on phones. Patience: roughly ten seconds to
decide this is not another node graph. Sophistication: high — they know what an
agent, a handoff, a tool grant and a trace are; they do **not** need "what is an
AI agent" explained, and explaining it insults them. What they fear: demoware,
and simulated agents dressed as real ones. They will open the repo and read
`life.mjs` if they like the surface.

**P2 — the evaluator (secondary; wins ties on legibility).** A hiring manager or
founder-CTO, in a tab next to James's CV, ~40 seconds. Note the deliberate
demotion: `agentjames/STRATEGY.md` already ranks polis in the *supporting* list
and classifies "seven agents built this site" as **noise** for this persona's
first 40 seconds. polis is not a hiring asset and must not be redesigned into
one. P2's claim on the design is a floor, not a direction: nothing may require
play, motion or interaction to be understood.

**P3 — James, operating the ecosystem (explicitly not designed for).** Already
served by `ecosystem-viewer`, `REGISTRY.md` and `route.mjs`. polis owes him one
thing: findings honest enough to act on. He is nonetheless the **client**, and
the client brief outranks the specialist's taste — see §6.

**Who loses, named.** The non-technical browser and recruiter: no explainer, no
glossary, no onboarding tour. The "cool demo" tourist: no spectacle without a
record behind it. Anyone wanting a complete admin console: that is
`ecosystem-viewer`'s job.

**Tie-breaking, in order.** Honesty beats legibility beats craft beats
completeness. Two clarifications that matter: (a) "legibility beats craft" never
resolves to *deleting* a character, a walk or a team — it resolves to scale,
contrast, staging or LOD; (b) "craft beats completeness" means when the frame is
too busy, cut information, not rendering quality.

## 2. The one job

**A first-time visitor must register, without clicking, that this is a real
populated system read off disk — and that a large part of it is dark.**

If #1 fails nobody stays for #2; if #2 fails it is a toy; if #3 fails it is a
claim.

1. **It is a place, and people live in it.** Motion and inhabitants visible in the
   first seconds. The client's ask and the peer's hook.
2. **The declared system and the running system are not the same system.** Eight
   citizens nobody hands work to (structure); 33 of 59 never dispatched
   (activity). This is the finding that makes it worth a share.
3. **Any one thing on screen can be traced to its record in one interaction.**

| State | Its one job |
|---|---|
| First paint, no interaction | "This is real, it is populated, and it is not fully alive." |
| The city at rest | "Every building and person is one file; the empty lots and dark windows are the point." |
| A citizen selected | "Here is this member's record, verbatim." |
| The findings surface | "The two things wrong with the wiring, with names and numbers." |
| 390px, first screen | "One legible district, one legible person, one headline finding" — not the whole city shrunk. |

**15 seconds:** real system, populated, visibly incomplete — no paragraph read,
no control touched. **2 minutes:** can name one finding *with its number*, has
opened one citizen and seen real fields, and can say what makes a citizen tall,
lit or walking — i.e. has understood that the encoding is data, not decoration.

## 3. Relevance context

What this audience already sees (fetched 2026-09-06, not recalled):

| Reference | What it establishes |
|---|---|
| OpenAI Agents SDK `draw_graph` | The free default everyone has seen: agents = yellow boxes, tools = green ellipses, MCP = grey, solid arrows = handoffs, dotted = tool calls |
| Langfuse agent graph (beta Jul 2026) | Trace to nodes/edges; **two modes for two questions** — aggregated shape vs one run |
| LangGraph Studio | Nodes = steps, edges = transitions, state machine as visual IDE |
| LaunchDarkly agent graphs (GA 2026) | Latency, invocations, error rates **overlaid per node in the context of the full workflow** |
| CodeCity (2007 onward) | The city metaphor is 19 years old and already taken. Its own evaluations say usefulness is unproven; the recurring critique is that with a city approach "something is missing: the data" |
| Agent Village / Vibe World (2026) | The live genre polis will be mistaken for: 239 residents built from persona files. **Simulated inhabitants.** |

**Conventions to keep:** one visual entity = one agent; a line = a handoff;
selecting reveals the record; a visible distinction between the *declared* shape
and what *actually ran*; per-entity state readable in context; a complete text
fallback.

**Conventions to violate deliberately:** the Graphviz shape-and-colour grammar;
the trace waterfall; the KPI row as primary surface; auto-layout DAG as the only
reading.

**What makes it made-for-them.** Not "a city" — CodeCity did that. Not "agents in
a world" — Agent Village did that this year, with simulated villagers. The one
thing nobody in that table is doing: **a world whose liveliness is a
measurement.** Every walker is a real co-dispatch pair from the session logs.
Every lit window is a real dispatch in a 30-day window. Every empty lot is a
member the constitution's reciprocity rule says nobody names. Game-grade
rendering over non-simulated telemetry, with the *absence* of activity as the
loudest thing on screen.

**The line: what "game-like" must mean here.** Five rules, testable:

1. **It is a place you look around, and things happen without you.** Motion
   legible as inhabitants doing something, within the first five seconds. A still
   diagram with hover states is not this.
2. **Everything that animates is a record.** A walker is a co-dispatch pair; a
   working pose is an `active` flag; a lit window is a dispatch in window; an
   empty lot is `unreachable`. Nothing moves that cannot be named. `life.mjs`
   already enforces this seam — keep it.
3. **Game applies to craft, never to mechanics that lie.** Render quality,
   lighting, staging, camera, transitions, readability: yes. Scores, levels, XP,
   achievements, health bars, quest logs, ambient extra pedestrians,
   procedurally generated citizens: never. There is no game state, because there
   is no game — there is a real organisation.
4. **The game may not hide the instrument.** From any moving thing to its record
   in one interaction; the full roster stays readable as text.
5. **It must read at rest.** A single static frame, zero animation, must still
   carry jobs #1 and #2. That frame is what gets screenshotted and shared, and it
   is what a `prefers-reduced-motion` visitor sees.

**Impressive to this audience:** characters legible at default zoom without
leaning in; a walk that traces a partnership that actually happened; the empty
lots; material and light that survive a 3.4x zoom; smoothness with no filter
primitives; that it still works with JavaScript off.

**Noise to this audience:** neon glow and cyberpunk grids (the distributional
default for "AI visualisation" — it reads as generated); particle systems; fake
terminal text; counters that tick up; a minimap of a map; HUD chrome borrowed
from games that have a game underneath.

## 4. Evidence over assumption

1. **The live site is four snapshots stale and publishes wrong numbers.**
   `polis-sigma.vercel.app` renders *45 citizens / 50 skills / 105 roads / 2
   unreachable*. `data/ecosystem.json` says **59 / 86 / 219 / 8**. On a project
   whose single rule is "every number traces to one file", the public artifact
   currently fails its own rule. Mechanism: hand-authored status board at
   `site/index.html:33-40` and `:90`.
2. **The telemetry is real and unflattering:** 233 assignments, 30 agents ever
   dispatched, **33 of 59 never dispatched**, 25 projects touched, 170
   collaboration pairs, 164 dispatches excluded as other-worlds.
3. **Structure:** 219 edges, 8 divisions, 6 guilds, 7 directors, 8 unreachable
   (all guild agents), 2 withheld.
4. **Scale, not shading, was the root cause of the rejected quality.**
   `CHARACTERS.md` §0: ~0.494 CSS px per user unit, 9-unit figures at ~4.4px.
   `DESIGN.md` §0: "No shading model rescues artwork drawn below the resolution
   it is shown at."
5. **Mobile is the unfixed instance of that same defect.** `styles.css:315-336`:
   `.map-scroll { width: min(100vw - 2rem, 1480px); overflow: hidden }` with
   `#city-map { min-width: 640px }`. At 390px the frame is 358px while the map
   renders at 640px, so ~44% of the city is off-frame at first paint and a
   22-unit character is **~6.5 CSS px** — below the 11px the character kit was
   designed for.
6. **The client brief, recorded:** characters, movement, teams — asked three
   times; today "more high quality graphics, rendering, motions... a modernized
   game in 2026, or better, a futuristic one"; and the logged lesson that a
   previous pass cut the characters three times.
7. **Guardrails already mechanised:** <=2400 elements, zero `<filter>`
   primitives, zero-node hover, walkers capped at 12, reduced-motion honoured,
   82 tests passing.
8. **Zero measurement exists.** No analytics. Every audience-behaviour claim
   below is an assumption until tested.

| # | Assumption | Cheapest test |
|---|---|---|
| A1 | The peer will actually share it (baseline: zero inbound links) | Post one still frame plus one sentence; count replies and clicks |
| A2 | "33 of 59 never dispatched" reads as rigour, not "his system doesn't work" | Show the sentence alone to three engineers: "what does this tell you about the author?" |
| A3 | Game-feel is what makes a peer stay past ten seconds | Two static frames (current vs proposed), five peers: "which would you open?" Run **before** the build |
| A4 | Mobile traffic is material | Unmeasurable without instrumenting. Assume yes; design for it |
| A5 | Visitors interact rather than screenshot-and-leave | Made moot by the at-rest rule (§3.5) |

## 5. Success definition

1. **15-second comprehension — 5 of 5.** Five people (3 peers, 2 non-specialists)
   see first paint for 15 seconds. Pass: 5/5 say it is a real system read from
   files (not a game, mock or illustration) and >=4/5 mention unprompted that
   parts are empty or inactive.
2. **2-minute finding recall — 4 of 5.** They can state one finding *with its
   number* and say where the number came from.
3. **Traceability — 10 of 10.** The reviewer picks ten moving, lit or drawn
   elements at random; the builder names the field and file behind each. One miss
   fails the whole rebuild.
4. **At rest — >=4 of 5.** One static screenshot, no motion, still passes 1 and 2.
5. **390px — pass/fail.** A character reads as a person, one district name is
   readable, first meaningful interaction under 10s. Today this fails
   automatically.
6. **Craft, head-to-head.** Current vs rebuilt, same seed frame: >=3 of 5 peers
   pick the rebuild. **James's verdict on the same pair is binding.**
7. **Distribution — >=1 third-party share or inbound link within 30 days.**
   Baseline zero. The only outcome that changes anything externally.
8. **Anti-metric: zero published numbers that disagree with the repo.**
   Mechanised as a test, not promised. It would fail today; must be green before
   this ships.
9. **Anti-metric: zero animated elements without a record.**

**Not success, deliberately:** time on site (a city inflates it), zoom/pan
counts, feature count, frame rate on its own.

## 6. Constraints that bind the director

- **Data honesty is constitutional.** Every entity, number, figure, walker, lit
  window and empty lot traces to `data/ecosystem.json` or `data/workforce.json`.
  ENVIRONMENT — sky, ground, light, shadow, haze, camera — is craft and is
  allowed to be beautiful. If the design wants something to move and no record
  supports it, the answer is no.
- **No per-person metrics, ever.** Binary and categorical states only. No
  leaderboard, no ranking, no per-agent counts on the map. Degree drives building
  height; that is structure, not performance.
- **Characters, movement and teams ship.** The client's ask, made three times and
  cut three times. Every legibility conflict is resolved by scale, contrast,
  staging or LOD — **never by deletion**. If the director believes a character
  element genuinely cannot work, the escalation is a written note to James, not a
  quiet removal.
- **Numbers are derived, not authored.** The status board and roster must be
  generated by `bin/build-site.mjs` from JSON. Hand-authored markup is the exact
  mechanism that put stale numbers into production.
- **Legibility floors.** A character reads as a person at default view on a 390px
  phone with no zoom. Colour is never the sole carrier of identity or state.
- **Accessibility floor.** WCAG AA — 4.5:1 text, 3:1 non-text — **measured** by
  `tools/contrast.mjs`. A full keyboard path that does not require the map. Text
  roster stays a complete fallback with JS off. `prefers-reduced-motion` removes
  motion and loses no information. Motion is pausable.
- **Performance envelope.** <=2400 SVG elements; no `<filter>`, `feDropShadow` or
  CSS `filter` on map elements; hover creates zero DOM nodes; transitions on
  `opacity`/`transform` only — never `stroke-width` (this repo's recorded scar).
  Must hold on a mid-range phone.
- **Static, free, dependency-free.** No paid infrastructure, no runtime
  dependency, no raster sprite atlas (does not survive 3.4x zoom).
- **Privacy and worlds.** Personal scope only; withheld members stay counted and
  unnamed; dispatch metadata only, never session content.
- **Forward compatibility.** The encoding must survive being re-pointed at a
  different organisation's snapshot: no hardcoded names, counts or district
  geometry. polis is the seed of the org product's control surface.

**Fail conditions — any one is a failed rebuild.**

1. **Pretty with no information.** A beautiful frame from which no visitor can
   state one fact.
2. **Fabricated liveliness.** Anything moving, glowing or crowding that no record
   supports. The genre it will be compared against (simulated agent villages)
   makes this accusation cheap to make.
3. **Illegibility.** Characters or labels below the size at which they read on
   the primary device.
4. **A 2010 Flash-site feel.** Intro animation, camera fly-through on load,
   sound, a loading bar, or any motion a visitor must wait through.
5. **Motion that annoys.** Continuous full-field movement, blinking, anything
   that cannot be paused.
6. **A dashboard with sparkles.** Game chrome laid over what is still a chart. It
   is either a place with people in it or it is a chart; the costume is the worst
   of the three outcomes.
7. **Silent removal of the client's ask.** Shipping without characters, movement
   or teams — or shipping them at a size where they are decoration.

**Amendment rule.** If the director finds this brief wrong, amend this file in
the same pass, in writing, with the reason and the date. Silent divergence is the
one failure mode this document exists to prevent.
