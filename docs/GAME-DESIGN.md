# Polis — Game Design Brief

Written 2026-09-06, downstream of `STRATEGY.md` (binds), `DESIGN.md`,
`CHARACTERS.md`, `MOTION-SPEC.md`, `LAYOUT-SPEC.md`, `RENDER-BUDGET.md`. Those
five settled *how things render and where*. None names a **loop** — a reason a
visitor keeps clicking for two minutes — and none ranks fun by cost. That gap is
this document's job.

**The lesson this document will not repeat:** `STRATEGY.md` §6 records that
specialists on this project have twice talked the game-ness down, and names the
rule that settles it — *client brief outranks specialist taste*. Every concept
below is chosen because it is buildable inside the stated constraints, not
filtered out because it feels risky. Where an idea is rejected, the reason is a
named constraint, never "might be too much."

Nothing here is observed. No playtest record exists yet; every claim about how
this will feel is a hypothesis until James or a tester says otherwise.

---

## 1. The core loop — build this first

**Verb: SELECT.** Click or tab a citizen, walker, district plate, or project.
The interaction already exists for citizens. What is missing is that only one
entity type rewards it, and the reward does not compound.

```
ACT: select a citizen                          (exists - city-view.mjs handler)
   |
FEEDBACK: the panel opens instantly with        (exists - citizen-panel, real fields)
their real record, AND every citizen they
actually work with lifts, lights, and their
roads pulse                                     (exists - refreshHighlight(), reused)
   |
STATE CHANGE: you now hold a working theory     (net-new FRAMING, ~zero build cost)
of the visual code (tall = connected, dashed
= empty, dark window = quiet) - and a fresh
set of lit, lifted candidates sits in front
of you, already proven relevant
   |
REASON TO ACT AGAIN: one of those lit           (closes the loop - every click
candidates is one click away, and you want       seeds its own next click, from
to know whether your theory holds - or you       real edges, never random)
want to go check the dark ones instead
```

**Why this is a loop and not "look at a diagram":** the fourth arrow is
load-bearing. Today selecting a citizen is a dead end — read the panel, close
it, back to zero. The fix costs no new elements: the next candidates are already
lit at the moment the panel opens. The change is **sequencing and framing, not
new geometry** — treat the lit neighbours as the game's move, not a side effect.

**Why it stays interesting at click #30:** the encoding is a fixed, small
vocabulary — height (degree), roof form (Write/Edit), footprint width (model),
banner (director), dashed/no-shadow (unreachable), window warmth (recency). A
visitor who has opened five panels starts *predicting* the record before
clicking: "tall, gabled, banner — a director who writes code." Verifying the
guess is the same click, but it now carries a private payoff click #1 did not.
Depth from one rule, not a second system bolted on.

---

## 2. Ranked concepts — fun that is TRUE

All eight trace to a real field. None invents a citizen, a number, or a
behaviour. Truthfulness is uniformly verified, so the ranking is really
delight-hypothesis divided by build cost.

| # | Concept | What it is | Traces to | Build cost | Delight (hypothesis) |
|---|---|---|---|---|---|
| 1 | **The Dark Half toggle** | One control: "Show who's never been called." Dims everyone active/recent, lifts only the dormant citizens and unreachable ruins | `activityOf()` in `life.mjs`; `unreachable` in `ecosystem.json` | **~0 new SVG.** Reuses existing dim/highlight classes; one button, one predicate | High — literalizes the most shareable fact into an explorable state instead of a sentence |
| 2 | **Follow-the-walker** | Clicking a walker *mid-stride* locks highlight to that live pair, pulses their exact road, opens the panel framed on that partnership | `workforce.json` -> `walkerPairs()` | **~0.** Roads already pre-rendered twice (rest + highlight) | High — the brief's own named example |
| 3 | **Silhouette literacy via one sentence** | The headline strip doubles as an invitation, not a stat: "8 of 59 answer to nobody — click one to see why" | Same finding `LAYOUT-SPEC.md` §1.6 reserves | **~0.** Pure copy; also resolves LAYOUT-SPEC's open item | Medium-high, compounding — cheapest item here |
| 4 | **Projects panel: who works with whom** | Selecting a project lifts its crew, lights their pennants, dims the rest, arcs between crew on existing road geometry | `workforce.json` projects/collaborations; mechanism already specified in `CHARACTERS.md` §5 | Low — UI assembly, not new render logic | High — the most literal honest answer to "characters, movement, teams" without relocating anyone |
| 5 | **Enter-a-district, on every breakpoint** | Clicking a district plate hard-cuts the camera to `FOCUS_DISTRICT` from any width, with a "leave district" control | `layout.mjs` geometry; `FOCUS_DISTRICT` math already computed | **~0.** Reuses a mechanism built for mobile legibility | Medium-high — turns a bug fix into "walk through a door" |
| 6 | **Quest-marker: finding to place** | The headline-strip link hard-cuts the camera to a frame bounding the exact subset the number describes | Same predicate as #1, one bounding box | Low | Medium-high — runs STRATEGY's traceability principle in the other direction |
| 7 | **Zoom as tactile play, named** | Frame the existing LOD reveal at k>=1.5 (insignia, instrument, belt marks) as a discoverable "lean in" reward | `CHARACTERS.md` §3 — already built | **0** — framing plus a first-visit hint | Medium — free, and makes MOTION-SPEC §2.6's pinch-zoom gap matter more |
| 8 | **The Archive as a browsable library** | Clicking a guild shed filters the skill roster to that collection, reusing the citizen-panel grammar | `DESIGN.md` §2.2 guild families | Low-medium | Medium — skills are lower-charisma than citizens, hence last |

**None of these requires new SVG elements at scale.** Every one reuses a state
that already exists for another reason. Measured headroom is ~2,306 of 2,400
(96%), so this matters: **there was room to be more fun without spending the
scarce budget** — the exact opposite of what happened the first two times this
brief was under-delivered. New controls land in the interactive-DOM budget
(cap ~150-250, currently an order of magnitude under), not the SVG ceiling.

---

## 3. The one-pager

**Fantasy.** You have found the control room of someone's automated
organisation, and the city outside is telling you the truth about who actually
does the work — including the people nobody ever calls.

**The interesting decision.** What to click next, with no dominant strategy
because there is no score:
- **Follow a walker now** (moving *right now*, will pause and return) vs **open a
  static panel** (guaranteed, no rush) — urgency vs reliability.
- **Toggle the Dark Half** (curiosity about absence) vs **keep exploring the warm
  half** (curiosity about presence) — two honest curiosities, no right answer.
- **Zoom into one district** vs **stay pulled back and compare silhouettes** —
  depth vs breadth.

**Failure and stakes.** There is no losing state, deliberately. The nearest
analogue is the **dead-end click**: selecting an unreachable citizen could read
as anticlimax. Design against it specifically — a ruin's panel must always keep
one honest next hop one click away (their division, or a sibling with degree 0),
so a dead end costs zero recovery time.

**The one thing nothing else has**, quoted from `STRATEGY.md` §3 rather than
reinvented: *a world whose liveliness is a measurement... game-grade rendering
over non-simulated telemetry, with the absence of activity as the loudest thing
on screen.* Every concept above makes that more playable; none adds a second
thing.

---

## 4. The Clash of Clans lesson, mapped honestly

| CoC mechanism | Why it works | Polis equivalent |
|---|---|---|
| Silhouette variety — a Cannon and a Town Hall are recognisable by shape alone | You know *what* a thing is before clicking | **Built.** Roof form, footprint width, height, banner, dashed-no-volume. Protect this as the roster grows past ~90; variety collapses the moment two unrelated attributes look the same |
| Tier-legible upgrades | Progress visible without a menu | No upgrades (inventing progression would fabricate state). Honest analogue: **redundant real-data encoding** — storey lines *and* window count *and* height all restate degree |
| Warm saturated palette | Reads inviting, not clinical | The OKLCH dusk-diorama direction targets this. **Verify it actually landed** — a muted palette undercuts every concept above regardless of interaction quality |
| Contact shadows | Sells weight, not a flat icon | **Built.** Cast-shadow pentagon + radial contact patch |
| Idle animation | The base feels alive when you touch nothing | **Built.** fig-bob, banner-wave, walker locomotion, window-pulse |
| Camera that invites | Exploring is pleasurable, not just functional | Pan/zoom speced; the real gap is **pinch-to-zoom on touch**. A game a thumb cannot smoothly zoom does not feel like a game |
| Tap-to-inspect — everything is clickable and rewarding | The core verb | **Built for citizens only.** Concepts 2, 4, 5, 6, 8 exist to extend the same grammar to walkers, projects, districts, findings and skills |

---

## 5. Onboarding in 10 seconds

**Second 0** — the city paints at full opacity in one frame (the load fade is
banned). At least one walker is already mid-departure (slot 0 launches at 0ms)
and every idle bob is staggered and running. **Wordlessly teaches: there are
people here, and they were doing something before I arrived.**

**Seconds 1-5** — the headline strip reads as one sentence that is both finding
and invitation: *"8 of 59 answer to nobody — click one to see why."* One
sentence does both jobs and teaches the verb, with no tutorial element.

**Seconds 5-10, the first click** — unforced and unsequenced. Whatever is
clicked, the panel opens with zero loading state and real fields *at the same
moment* connected citizens light up. That single click is the whole grammar. If
it needs a caption, it is mistaught.

---

## 6. The discovery arc — 33 never dispatched, 8 unreachable

The tension: the headline strip sits above the hero on every breakpoint, so the
number is visible before a single click. That is *correct* — STRATEGY's floor
says nothing may require play to be understood.

**The resolution is not concealment, it is concretisation.** State the number
once for the skimmer; make the *game* turning an abstract "33" into specific,
individually-discovered faces:

1. **Concept #1** turns the aggregate into an explorable space — a ghost town
   superimposed on the living one, entered and left at will.
2. **Concept #6** jumps the camera from the sentence to the place.
3. Every dormant citizen stumbled onto **independently** gets the same panel
   treatment the busy ones get, honestly stated. The concrete instance is what
   lands, not the summary — a museum's wall-text number means less than the one
   object you stood in front of.
4. ~~**Needs verification before shipping #1:**~~ **VERIFIED 2026-09-06, and the
   answer is "both, usefully."** Measured against the real plan
   (`computeCity` + `data/ecosystem.json`), not eyeballed:

   | Where the 8 ruins sit | Count |
   |---|---|
   | Inside the eight walled districts | **0** |
   | Agentic Guild (3 of 3 citizens) | 3 |
   | Growth Guild (2 of 2) | 2 |
   | Automation Guild (1 of 1) | 1 |
   | Backend Guild (1 of 1) | 1 |
   | Design Guild (1 of 4) | 1 |
   | Game Guild (0 of 3), No division (0 of 1), System (0 of 1) | 0 |

   **Spatially they are not a district.** They land in six separate plots at
   four different compass edges of the plan — agentic north, growth
   north-east, automation east, backend south-east, design south — because
   `layout.mjs` places guild plots by spiral search around the wall, not by
   condition. Nothing on screen is labelled "ruins", and no plate groups them.
   A visitor meets them one dead lot at a time, which is what item 4 was
   protecting.

   **Categorically they absolutely are clustered, and that is a finding, not
   an artefact:** every ruin is a guild member outside the wall, and four of
   the six guilds are *entirely* empty lots. The constitution's reciprocity
   rule is enforced inside the districts and simply never reached the guilds.
   That is worth saying out loud rather than designing around — but it is a
   sentence for the findings surface, not a labelled zone on the map, and it
   is already discoverable: selecting any ruin offers its guild siblings as
   the next hop, so a visitor who follows two clicks finds the pattern
   themselves.

---

## 7. What to cut

| Idea | Why cut |
|---|---|
| **Literal day/night keyed to a clock** | Already satisfied honestly by lit windows (recency -> warm/dark glass). MOTION-SPEC §1.9 bans drifting sky and day-night sweeps: no record says what time of day it is. Named here so nobody later "improves" the window system into a live clock |
| **Completion checklist ("12 of 59 discovered")** | An engagement mechanic. The constitution keeps retention hooks off the table unless James explicitly asks. Nobody asked. Cut on doctrine, not taste |
| **Leaderboard of most-connected citizens** | STRATEGY §6, verbatim: no per-person metrics, ever, no ranking. Degree already drives height; that is structure, this would be performance |
| **Quest/mission list with a fixed order** | Fabricates game state on a non-game and risks the named fail condition: game chrome laid over what is still a chart. The real graph already provides direction with zero invented structure |
| **District rivalry / factions** | Invents a relationship the org does not have, and extends ranking to divisions for no honest reason |
| **Drag-and-rearrange sandbox** | Implies editable state on a read-only snapshot. `CHARACTERS.md` §7 already rejected relocating characters on the same grounds; free-form dragging repeats a mistake made once |

**Deferred, not rejected:** a time-travel slider comparing snapshots. Only one
`generatedAt` exists today. If snapshots are ever retained on a schedule this
becomes legitimate and fully honest — a real "return and see it changed" hook
reflecting genuine new dispatches rather than manufactured freshness.

---

## 8. Traceability

| Concept | Field / file |
|---|---|
| Dark Half toggle | `activityOf()` dormant/idle branch; `unreachable` in ecosystem.json |
| Follow-the-walker | `workforce.json` -> `walkerPairs()` |
| Silhouette literacy copy | Finding reserved by LAYOUT-SPEC §1.6, sourced from workforce.json |
| Projects/crew reveal | workforce.json projects + collaborations; CHARACTERS.md §5 |
| Enter-a-district | layout.mjs plot geometry; FOCUS_DISTRICT math |
| Quest-marker jump | Same predicate as the Dark Half toggle |
| Zoom-reveal framing | LOD system, CHARACTERS.md §3 (already built) |
| Archive as library | agent.guild / skill ownership, DESIGN.md §2.2 |

---

## 9. Verdict

**LOOP IS SOUND, with a TUNE.** The core verb and its feedback already exist and
already close a real loop once sequenced as one — that sequencing, not new
rendering, is the highest-leverage change available. All eight concepts trace to
real files and none spends the scarce SVG budget.

**Not recommended, explicitly:** any new SVG geometry, any
scoring/ranking/achievement surface, any clock-driven environment, any
editable/draggable state, any quest sequencing. Each is named above with the
constraint it violates, not a vague "too risky" — that vagueness is exactly how
game-ness got cut twice before.

---

## 10. Built, 2026-09-06

Concepts 1-3 and the §1 loop are implemented. What the build learned that this
brief could not have known:

**The core verb was broken, and had been for as long as the map existed.**
`attachCamera` called `svg.setPointerCapture()` on every `pointerdown`, so the
compatibility click event retargeted to the `<svg>` and a real mouse click on
a building was never delivered to that building's handler. The panel could
only be opened from the roster list or a findings link. Verified against the
committed build (`60625b9`) before the fix, not inferred. Capture is now
deferred until the pointer has travelled 4px, so a press is a click and a drag
is still a drag. **Section 1's diagnosis was right for the wrong reason:**
selecting a citizen was not a dead end, it was a no-op.

**A ruin was the one thing on the map you could not click.** `.ruin-lot` is
`fill: none`, so its hit target was a 1.6px dashed outline. `pointer-events:
all` makes the interior of an unpainted shape targetable; the eight empty lots
— the subject of the headline strip and of concept #1 — are now clickable at
their full size.

Neither of those is a game-design idea. Both are why the last two passes could
not have felt like a game whatever was layered on top.

**Measured after:** 2,328 of 2,400 elements (+12: one hit rect per walker, the
only new geometry in the whole pass), 93 tests green (86 + 7), 408 contrast
pairs with 0 gated failures, Dark Half lifts 37 of 59 and dims 22 in both
themes and at both breakpoints, zero console errors, reduced motion loses
nothing.

**Deliberately not built:** concept #6's camera jump, which MOTION-SPEC §1
prohibition 7 forbids (no camera motion the visitor did not drive); MOTION-SPEC
§2.3's new panel open/close transition, which is unrelated to the loop and was
left rather than half-done; concepts 4, 5, 7 and 8, which are still open.

---

**Orchestrator note, 2026-09-06:** this brief flagged that STRATEGY.md states
both "30 agents ever dispatched" and "33 of 59 never dispatched", which sum to
63 against a roster of 59. Verified and resolved (commit 60625b9): both figures
are correct and count different populations — `agentsEverDispatched` includes
four non-roster agents (claude-code-guide, fork, general-purpose,
prompt-engineer), while `neverDispatched` counts roster members only. The
generator now derives `rosterEverDispatched` (26) and names
`dispatchedOutsideRoster`, so 26 + 33 = 59 closes explicitly. Copy for concepts
#1 and #3 should use `rosterEverDispatched`, not `agentsEverDispatched`.
