# The character system

How 59 agents become 59 legible people, without an illustrator, and without
inventing a single thing that is not in `data/ecosystem.json`.

**Status:** written before `DESIGN.md` existed. Everything marked
**[PROVISIONAL]** is a decision this document had to make in order to be
implementable, and must be reconciled with `DESIGN.md` when that lands — the
palette, the lighting model and the type scale are that document's to own, not
this one's.

---

## 0. The finding that reframes the whole problem

Before designing anything, measure what is on screen.

| Quantity | Value |
|---|---|
| Tile width | 64 user units |
| viewBox width | ~2228 units, displayed ~1100 px |
| Scale at default zoom | ~0.494 CSS px per unit |
| **Current figure height** | **~9 units → ~4.4 CSS px** |

The figures are four and a half pixels tall. That is roughly the height of a
lowercase letter in body text.

This matters more than any styling critique, because it means the current
figures are not badly drawn — they are *invisible*, and no amount of better
shape work at 9 units would have fixed it. A three-shape blob and a
beautifully rendered person are indistinguishable at 4 px. **The first fix is
scale, and it is worth roughly 5×.**

It also sets a hard constraint on everything below: at default zoom a
character gets ~11 CSS px. Detail must be earned by zooming, not assumed.

---

## 1. What may drive appearance

Only these fields exist in the snapshot. Anything not on this list cannot
influence a character, because inventing a visual feature with no data behind
it is exactly the failure this project exists to avoid.

| Field | Real distribution across 59 agents | Signal quality |
|---|---|---|
| `division` / `guild` | 8 divisions + 6 guilds + 1 system + 1 none | Strong, complete |
| `tools` | Read/Glob/Grep = **59/59**; WebFetch 41, Bash 37, WebSearch 29, Write 18, Edit 15 | Strong, once the universals are discarded |
| `director` | 7 true | Strong, binary |
| `degree` | 0-21; 11 agents at 0, `architect` at 21 | Strong, but **already spent** on building height |
| `model` | opus 14, sonnet 19, haiku 1, **undeclared 25** | Weak-but-honest (see §2.5) |
| `system` | 1 (`Explore`) | Strong, binary |
| `unreachable` | 10 | Strong, binary |

### The discard that makes the tool axis work

`Read`, `Glob` and `Grep` are granted to all 59 agents. A feature present in
100% of a population carries zero information, so mapping it would produce 59
identical marks and cost 59 DOM nodes to say nothing. They are discarded.

What remains resolves into three independent, genuinely meaningful axes:

- **M — makes.** `Write` or `Edit`. Can change the repository.
- **R — runs.** `Bash`. Can execute.
- **S — scouts.** `WebSearch` or `WebFetch`. Can look outside the machine.

Measured distribution of the eight combinations:

| Combo | n | Examples |
|---|---|---|
| `--S` | 18 | api-designer, architect, copywriter, counsel |
| `-RS` | 16 | ai-engineer, controller, educator, incident-commander |
| `MR-` | 10 | data-engineer, debugger, devops, qa-engineer |
| `-R-` | 6 | code-reviewer, security-auditor, design-reviewer |
| `MRS` | 5 | trust-safety, ui-designer, mcp-engineer |
| `M-S` | 2 | competitive-analyst, sales-engineer |
| `M--` | 1 | chief-of-staff |
| `---` | 1 | product-manager |

Eight buckets, none empty, none swallowing the roster. This is the axis that
makes a security auditor look different from a copywriter **because they were
granted different powers**, which is the truest available answer to "what
would they look like in real life."

---

## 2. The attribute → feature map

| Feature | Driven by | Variants | Why this mapping |
|---|---|---|---|
| Tunic hue | division / guild | 15 | Already the map's colour code; the character inherits it so a person visibly belongs to their district |
| Insignia | division / guild **index** | 15 | The **non-colour** carrier of the same fact. Required: colour may never be the sole encoding |
| Held instrument | capability combo, primary | 4 | The role signal. Priority M > R > S > none |
| Belt marks | capability combo, secondary | 0-2 | Completes the code without crowding the silhouette |
| Mantle | `director` | 2 | Seven leads; binary and consequential |
| Model badge | `model` | 4 incl. absent | Absence is meaningful — see §2.5 |
| Treatment | `unreachable`, `system` | 3 | Overrides everything below |
| Pose / lamp | telemetry (§5) | 4 | Real invocation records, not simulation |

Explicitly **not** mapped: `degree`. It already drives building height, and
encoding one fact twice teaches a viewer that two marks mean two things when
they mean one.

### 2.1 Build — one silhouette, not fifteen

Every character shares one body. Fourteen different body types would be
illegible at 11 px and would imply a claim about professions that the data
does not support (nothing in a charter says what a product manager's posture
is). Identity is carried by hue, insignia and instrument — all of which are
derived — not by physique.

**Proportion [PROVISIONAL]:** 1:4 head-to-body. Stylised enough to read as
"cartoon", not so stylised it becomes chibi. At small sizes a slightly large
head is what makes a figure register as a person rather than a smudge.

**Total height H = 22 units** (≈ 0.34 × tile width; ≈ 11 CSS px at default
zoom, ≈ 37 CSS px at maximum zoom 3.4×).

> **Reconciliation note for `DESIGN.md`:** at H=22 a character stands beside
> buildings whose current extrusion is 14-82 units, median ≈ 24. A person as
> tall as a typical building is wrong. Either building heights scale up
> (suggested `BASE_HEIGHT` 24, `MAX_HEIGHT` 130) or characters shrink to
> H≈16 and lose legibility. **Recommended: raise the buildings.** The scene's
> vertical proportion is `DESIGN.md`'s call; this document flags the conflict
> rather than resolving it unilaterally.

### 2.2 Geometry — the base figure

Local origin at the feet, `y` negative is up. All values in user units.

```
shadow   ellipse  cx=0    cy=0.6   rx=5.2  ry=2.2
legL     path     M -2.8 0 L -1.0 0 L -1.0 -7.5 L -2.8 -7.5 Z
legR     path     M  1.0 0 L  2.8 0 L  2.8 -7.5 L  1.0 -7.5 Z
torso    path     M -3.9 -7.0 Q -4.2 -15.8 -2.4 -16.4
                  L 2.4 -16.4 Q 4.2 -15.8 3.9 -7.0 Z
neck     rect     x=-1.0 y=-17.4 w=2.0 h=1.4
head     circle   cx=0 cy=-19.2 r=2.9
```

Head apex = −22.1, so H = 22. ✓

**Line treatment [PROVISIONAL]:** no black outline. A 0.6-unit stroke in the
background colour, matching the building faces, separates the figure from what
is behind it without adding a cartoon keyline that would fight the flat-shaded
architecture. At 11 CSS px a true outline would consume >10% of the figure's
width.

**Shading:** three tones per part maximum — lit / base / shade — with the key
light from the **upper right**, identical to the buildings. Consistent light
direction across every solid in the scene is the single largest contributor to
a scene cohering, and the cheapest.

### 2.3 Insignia — heraldry, not costume

A 2.6 × 2.6 unit glyph on the chest at `(0, −13.2)`, drawn in the tunic's lit
tone.

Assignment is by division index: `00`→bar, `01`→circle, `02`→triangle,
`03`→chevron, `04`→diamond, `05`→double-bar, `06`→cross, `07`→open square;
guilds→ring with a notch at `variantOf(guildName, 6)` × 60°.

**On arbitrariness, honestly:** *which* glyph belongs to Engineering is
arbitrary, exactly as the hue assignment is arbitrary. What matters is that it
is stable, documented in the legend, and redundant with hue so that colour is
never load-bearing alone. This is heraldry — a learnable code — and it is not
a claim about what engineers wear.

### 2.4 Instrument — the role signal

Held in the right hand at `(4.6, −11.5)`, ~5 units long. Primary capability
only, by priority **M > R > S > none**, so the silhouette stays clean.

The priority order is not aesthetic: the ability to *change the repository* is
the highest-consequence grant an agent holds, so it dominates the read.

| Primary | Instrument | Geometry |
|---|---|---|
| M (makes) | Chisel / stylus | `M 0 0 L 0.9 -0.5 L 4.4 -4.2 L 3.4 -5.0 Z` |
| R (runs) | Wrench | shaft `M 0 0 L 3.6 -3.6` w=1.1; head = 1.5r circle, 40% notch |
| S (scouts) | Lens on a stem | stem `M 0 0 L 2.6 -2.6` w=0.9; ring r=1.6, stroke 0.7, unfilled |
| — (none) | Folio | rect w=3.2 h=4.2, rx=0.3, rotated −18° |

**Belt marks** for each *secondary* capability: a 1.2-unit glyph at
`(−3.2, −8.6)` and `(−3.2, −6.9)`, reusing the instrument's shape simplified
to a single stroke. So `MRS` = chisel in hand, wrench-mark and lens-mark on
the belt. The code is complete without three objects competing in one hand.

### 2.5 Model badge — a governance gap, made visible

A 1.8-unit chip at the left shoulder `(−4.4, −15.6)`:
opus = filled, sonnet = half-filled, haiku = outline, **undeclared = nothing
drawn**.

25 of 59 agents declare no model. Rendering that as *absence* rather than
inventing a default means 25 characters visibly lack a chip, and the roster's
largest governance gap becomes something you can see by looking at the city
instead of something buried in an audit. That is the project's whole premise
applied to itself.

### 2.6 Overriding treatments

**Unreachable (10 agents).** Named by nobody upstream or downstream. Drawn
seated on the foundation, desaturated to 35% chroma, **no instrument** — they
hold equipment they are never asked to use. The building is already an empty
dashed foundation; the character completes the reading. `mentor` is the sharp
case: fully equipped `MR-`, degree 0.

**System (`Explore`).** Not a person. It ships with Claude Code and is exempt
from the constitution, so drawing it as a citizen would assert membership it
does not have. Rendered instead as a floating construct: a 6-unit ring at
`(0, −13)`, no head, no legs, slow rotation, hovering 3 units off the ground.

**Director (7 agents).** A mantle: `M -4.3 -15.6 Q 0 -13.4 4.3 -15.6 L 3.6 -9.4
Q 0 -7.6 -3.6 -9.4 Z` in the division's shade tone, drawn behind the torso.
Reads as breadth of shoulder at any size — the one embellishment that survives
LOD-0.

---

## 3. Level of detail

`attachCamera` clamps zoom to `k ∈ [0.55, 3.4]`, default 1.

| LOD | Condition | Parts | Elements |
|---|---|---|---|
| **0** | `k < 1.5` | shadow, legs+torso merged, head, mantle | **5** |
| **1** | `k ≥ 1.5` | + insignia, instrument, belt marks, model chip, arms, separate legs | **13** |

At `k = 1.5` a character occupies ~16 CSS px, which is where a 2.6-unit
insignia first becomes distinguishable from a smudge. Below that, detail costs
nodes and returns noise.

**Both LODs are rendered once and toggled with CSS** (`display` on the detail
group, driven by a class the camera sets on the `<svg>`). Re-rendering 59
characters on every zoom tick would cost a full layout pass mid-gesture; 59
hidden groups cost memory and nothing else.

**Budget, measured not estimated.** The map currently renders **1,153 SVG
nodes**, of which **435 are building faces** and 147 are the present
three-shape figures. Replacing those figures with the kit gives
`1153 − 147 + (59 × 13) = 1,773` nodes at LOD-1, and `1153 − 147 + (59 × 5) =
1,301` at LOD-0. Both are comfortable for SVG; the LOD split exists to protect
the *interaction*, not the initial paint. Motion is restricted
to `opacity` and `transform` — never `stroke-width`, which recomputes stroke
geometry across every affected element and has already caused measured jank in
this repo at ~150 elements.

---

## 4. Realistic-cartoony, defined

The phrase needs pinning down or it means nothing to an implementer.

| Dimension | Decision |
|---|---|
| Proportion | 1:4 head-to-body — stylised, not chibi, not naturalistic |
| Line | No keyline; 0.6-unit background-coloured separation stroke |
| Shading | 3 flat tones per part, hard edges, no gradients |
| Light | Fixed upper-right, shared with the architecture |
| Detail | Silhouette-first; interior detail only above `k=1.5` |
| Faces | **None.** At 11 px a face is three grey pixels, and inventing expressions would assert personality the data does not contain |

**References, and what is taken from each:**
- *Monument Valley* — flat tone separation doing all the depth work, zero
  texture. Taken: the discipline of no gradients.
- *Two Point Hospital* — readable staff silhouettes at tiny on-screen sizes,
  role legible from held object alone. Taken: instrument-drives-role.
- *Kurzgesagt* — flat vector, high chroma, geometric construction that
  survives extreme scale changes. Taken: construction-from-primitives.
- *Civilization VI* leader silhouettes — heraldic insignia as identity rather
  than facial detail. Taken: the heraldry approach in §2.3.

Deliberately **not** taken: painterly shading, textures, gradients, outlines,
faces. Each fails at 11 px, and three of the four cannot be expressed as
dependency-free SVG at this node budget.

---

## 5. Activity — driven by real telemetry

`C:\Users\admin\.claude\projects\**\*.jsonl` records **396 real
`subagent_type` Task invocations** across ~30 distinct agent types. Who worked
on what, and when, is ground truth on disk — not simulation.

**Two constraints on using it, both non-negotiable:**

1. **Worlds boundary.** Session directories are prefixed by working directory:
   27 are `C--Users-admin*` (personal), 14 are `D--Lift*` / `D--Freelance*`.
   Only personal-world sessions may enter a personal-scope snapshot. Client
   and employer activity must never reach this map — the extractor filters by
   prefix, and this is a hard rule, not a default.
2. **`general-purpose` is 169 of 396.** It is the generic builder, not an
   ecosystem member with a charter, and counting it as the busiest citizen
   would be a false picture. It is excluded from character activity and
   reported separately as tooling.

### Visual language

| State | Definition | Rendering |
|---|---|---|
| **Idle** | No invocation in 30 days | Standing, 1.8-unit bob, 3.4 s, staggered |
| **Recent** | Invoked in the last 30 days | Lamp lit at the belt: 1.4r circle, warm, 0.7 opacity |
| **Active** | Invoked in the current session | Working pose (torso pitched 6° toward instrument), lamp full |
| **Crewed** | Shares a project with another agent | Pennant above the head |

**Pennant:** 4 × 2.6 units at `(0, −25)`, hue keyed to the project, with a
1-unit pole. A project is a real directory name from the session log.

### Teams, without moving anyone

An agent belongs to its district permanently and to a project team
temporarily. Those must not compete.

Characters therefore **never leave their district**. Instead:

- A **Projects panel** lists every project with recorded activity, its crew,
  and when it last ran.
- Hovering or selecting a project lifts its crew by 7 units, lights their
  pennants, and dims everyone else to 0.2 — reusing the existing
  `active`/`neighbor`/`dimmed` machinery rather than adding a second one.
- A thin arc links crew members while a project is selected, drawn on the
  existing road layer's geometry.

This answers "which agents are working on what, and which teams formed" by
*filtering* rather than by relocation. Relocation was considered and rejected
(§7): it destroys the district structure, which is the map's primary
organising fact.

---

## 6. Worked examples — three real agents, end to end

### `chief-of-staff` — the hub Director
`division: 00 Cabinet · director: true · tools: [Read, Glob, Grep, Write] ·
model: null · degree: 12`

Combo = **`M--`** (Write, no Bash, no web) — the only agent in that bucket.

- Tunic: Cabinet hue `--div-00`, 3 tones
- Insignia: bar (index 00)
- Mantle: **yes**
- Instrument: **chisel** (M primary)
- Belt marks: **none** — no secondary capability
- Model chip: **absent** — declares no model
- Height 22; degree 12 shows as a tall building, not on the body

Reads as: a robed official with a writing tool, no field kit, no lamp of
office — a router who edits and delegates but never runs or fetches anything
itself. Which is precisely what the charter says.

### `security-auditor`
`division: 03 Engineering · director: false · tools: [Read, Glob, Grep, Bash] ·
model: opus · degree: 2`

Combo = **`-R-`**.

- Tunic: Engineering hue `--div-03`
- Insignia: chevron (index 03)
- Mantle: no
- Instrument: **wrench** (R primary)
- Belt marks: **none**
- Model chip: **filled** (opus)
- Low building (degree 2) beside a tall neighbour in a 15-strong district

Reads as: a specialist who executes but changes nothing and never leaves the
machine — a read-and-run auditor. Visually distinct from `copywriter`
(`--S`, lens, no chip) at a glance, which was the requirement.

### `mentor` — unreachable
`division: null · guild: null · tools: [Read, Glob, Grep, Bash, Write, Edit] ·
model: null · degree: 0 · unreachable: true`

Combo = **`MR-`**, fully equipped.

- Precinct: "No division declared", outside the wall
- Treatment: **seated**, chroma 35%, **no instrument drawn**
- Insignia: none (no division)
- Model chip: absent
- Building: empty dashed foundation

Reads as: someone fully equipped to make and run things, sitting alone outside
the walls, holding nothing, whom no charter names. That is not a mood — it is
`degree: 0` and `unreachable: true` rendered honestly, and it is the kind of
finding the map exists to surface.

---

## 7. Rejected alternatives

**Hand-illustrated portraits.** Highest ceiling, and unshippable: 59 now, ~90
planned, and every roster change needs an illustrator. It also cannot be
committed as dependency-free SVG at a sane node count. Rejected on scale.

**Per-division body types (14 physiques).** Illegible at 11 px, and asserts
things about professions the charters never say. Rejected on legibility and
honesty.

**Faces and expressions.** Three grey pixels at default zoom, and expression
would assert personality that is not in the data. Rejected.

**Degree → character size.** Degree already drives building height. Encoding
one fact twice trains the viewer to read two marks as two facts. Rejected on
information design.

**Characters relocating to project sites.** The most literal reading of "see
teams form", and it destroys the district structure — the map's primary
organising fact — while making position mean two contradictory things at once.
Replaced by selection-driven filtering (§5).

**Sprite sheets / raster atlases.** Standard for games, forbidden here: the
project ships as static files with no runtime dependencies, and rasters do not
survive a 3.4× zoom. Rejected.

**Randomised cosmetic variety.** Would add life cheaply and would put
non-reproducible output into committed HTML, plus decoration encoding nothing.
Rejected twice over — determinism, and the no-invention rule.

**Model tier → a default when undeclared.** Would make all 59 look governed.
Absence is the honest rendering, and it makes a real gap visible (§2.5).

---

## 8. Implementation order

Impact per unit of effort, highest first.

| # | Change | File | Done when |
|---|---|---|---|
| 1 | **Scale figures 9 → 22 units** | `city-view.mjs` | Characters are ~11 CSS px, not 4.4 |
| 2 | Base figure geometry (§2.2) + 3-tone shading | `city-view.mjs`, `styles.css` | Legs/torso/head/neck replace the blob |
| 3 | Reconcile building heights with §2.1 | `layout.mjs` + `DESIGN.md` | A person no longer matches a median building |
| 4 | Director mantle | `city-view.mjs` | 7 agents read as leads at LOD-0 |
| 5 | Instrument by capability (§2.4) | `city-view.mjs` | 4 instruments across 8 combos |
| 6 | Unreachable + system treatments (§2.6) | `city-view.mjs`, `styles.css` | 10 seated, `Explore` non-human |
| 7 | LOD toggle at `k=1.5` | `city-view.mjs`, `styles.css` | Detail group hidden below threshold |
| 8 | Insignia (§2.3) | `city-view.mjs` | Division legible without colour |
| 9 | Belt marks + model chip | `city-view.mjs` | Capability code complete |
| 10 | **Telemetry extractor** (worlds-filtered) | new `src/activity.mjs` | Personal-only; `general-purpose` excluded |
| 11 | Activity states + pennants | `city-view.mjs` | Idle/recent/active distinguishable |
| 12 | Projects panel + crew filtering | `app.mjs` | Hovering a project lights its crew |

Items 1-2 alone recover most of the visible quality gap, because the dominant
defect was never shape — it was four and a half pixels.
