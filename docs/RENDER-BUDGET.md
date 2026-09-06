# Render technology judgment and performance budget

Written by the rendering-technologist pass, 2026-09-06. Advisory + prototype-grade:
settles the technique and the numbers the build is held to; does not implement.

**Scope read before judging:** `site/iso.mjs`, `site/city-view.mjs`, `site/walkers.mjs`,
`site/life.mjs`, `site/layout.mjs`, `site/palette.mjs`, `site/app.mjs`, `DESIGN.md`,
`CHARACTERS.md`, `tests/budget.test.mjs`. Ran `npm test` (82/82 green) and the budget
test directly for the real element count below. All measurements in this document are
either (a) the test suite's own numbers, run on this machine, or (b) marked
**[reasoned, not measured]** where a real device/browser benchmark is still owed --
see section 9. Machine used for the numbers I did run: Windows 11, AMD Ryzen 7 9700X
(8-core desktop), 32GB RAM. **That is not a phone** -- it is stated so nobody mistakes
a Node test-runner number for a mobile frame-rate number.

---

## 1. Recommendation

**Stay off WebGL/WebGPU/three.js. Move from SVG-DOM to layered Canvas2D for the parts
of the scene that scale with roster size, keeping every line of the existing geometry
math (`iso.mjs`, `life.mjs`, `layout.mjs`) unchanged.** That is one rung up from where
the project is today, not three.

This project already made the hard call correctly once: `DESIGN.md` and
`CHARACTERS.md` (both written today, 2026-09-06, after the client rejected a
figure-less "Survey Model" pass) already committed to characters, movement and teams,
and already built them -- a 22-unit composable figure kit driven only by real
attributes (tools to instrument, division to tunic plus insignia, director to mantle,
telemetry to activity state and lamp), 12 concurrent walkers on real collaboration
pairs from `data/workforce.json`, and project-crew filtering that lifts and pennants
a team without relocating anyone. **Do not re-open that decision or re-litigate
whether characters belong.** They do; the recorded lesson is explicit that cutting
them was the mistake, three times. What is open is the *substrate* they render on.

Why not WebGL/three.js, checked against the decision frame:

1. **Does it serve the design intent?** `DESIGN.md` section 1's anti-references
   explicitly reject "neon data-city" and ban `<filter>`, `feDropShadow`,
   gradients-for-depth, and any blur -- the entire look is flat hard-edged shading
   with one fixed key light, modeled on Monument Valley, Two Point Hospital and
   Townscaper. That is a **rasterization style**, not a lighting-simulation style. A
   WebGL/three.js pipeline earns its keep when you need real-time dynamic lighting,
   camera orbit, physically based shading, or particle/post-processing effects
   (bloom, depth of field) -- this design forbids exactly those things on purpose.
   Introducing a 3D pipeline here would not make the scene look more like the
   reference; it would fight the reference.
2. **Lightest sufficient technique.** The rung ladder is CSS/DOM to Canvas2D to
   GSAP-DOM to WebGL/three.js to shaders. The project is currently on rung 1 and
   hitting a real, measured ceiling (section 3) that rung 2 solves directly. Nothing
   in the brief (no camera orbit, no dynamic relighting, no arbitrary-N particle
   simulation) states a reason to skip rung 2 and go to rung 4.
3. **`clarifier`'s WebGPU is not a precedent that transfers.** It runs a genuine
   n-body physics simulation over an *unbounded, user-supplied* CSV -- real parallel
   compute over an open-ended N, with a WebGPU to WebGL2 to CPU-static fallback chain
   because the workload actually needs a compute shader. Polis has a small, bounded
   cast (tens up to maybe ~150 citizens, plus ~86 skills, plus 219 fixed roads) doing
   simple arc-length-parameterized position interpolation along precomputed paths --
   there is no compute-bound problem here for a GPU to solve. Citing WebGPU as
   evidence "this portfolio does hard rendering" would be reasoning from what looks
   impressive, not from what the workload needs.
4. **It is not just heavier, it is structurally incompatible with what this repo is.**
   `vercel.json`'s CSP is `script-src 'self'` -- no CDN import is reachable without
   vendoring the library's source into the repo. The project has **zero npm
   dependencies for the shipped site and no build step** (`package.json` has no
   `dependencies` field; `site/` is same-origin ES modules served as-is). Pulling in
   three.js means either breaking the CSP, or committing a 150-600KB (unminified,
   more before tree-shaking) third-party bundle and standing up a bundler this
   project has deliberately never needed. That is a real, non-hypothetical cost.

**What Canvas2D actually buys, concretely:** the current renderer already does most
of the work a canvas renderer would need -- `iso.mjs` produces pure point lists and
path strings with zero DOM coupling, `life.mjs` computes activity/capability/routing
as pure data, and `layout.mjs` lays out the whole city as data before anything is
drawn. The only DOM-specific code is `city-view.mjs`'s SVG-node factory and
`walkers.mjs`'s per-frame transform attribute writes. Swapping the paint target from
"create an SVG element per shape" to "fill a cached Path2D per shape on a canvas
context" is a rewrite of one file's leaf calls, not the geometry, the layout, the
life simulation, or any of the 82 tests that cover those three.

---

## 2. How to render 60-150 moving agents plus a city

**Two stacked `<canvas>` elements, not one** -- the same technique class real 2D game
engines use for a mostly-static map with a handful of moving sprites:

- **Static layer** (board, plot ground, wall, roads, buildings, standing citizens,
  plates, haze): built once into a set of cached Path2D objects at layout time (one
  Path2D per face/shape, mirroring today's one-SVG-element-per-face structure), then
  painted in painter's-algorithm order (`depthOf` already gives the correct sort key
  -- unchanged from today) with fill/stroke calls reading colors from the same
  OKLCH-derived CSS custom properties (resolved once via getComputedStyle, not per
  shape). **Redrawn only when the camera or the underlying data changes** -- not
  every frame. During an active drag/pinch gesture, do not re-tessellate: draw the
  last full-quality frame to an offscreen bitmap once (OffscreenCanvas where
  available, a hidden same-size canvas otherwise) and blit that bitmap with a
  scale/translate for every intermediate frame of the gesture -- a single draw call,
  GPU-cheap, is the entire per-frame cost while panning. Do one full-fidelity redraw
  on gesture-end so text and plates stay crisp at rest.
- **Dynamic layer**, transparent, stacked on top via CSS (position: absolute, same
  transform kept in sync): only the currently-walking figures -- bounded by
  WALKER_CAP (12 today) regardless of total roster size, exactly as `walkers.mjs`
  already caps it -- cleared and redrawn every requestAnimationFrame tick. This is
  the one piece of true per-frame work, and it does not grow with roster size, only
  with WALKER_CAP, which is a deliberate design constant, not a function of
  headcount.
- **Standing (non-walking) citizens live on the static layer**, not the dynamic one
  -- their only motion is the reduced-motion-gated idle bob, which belongs in the
  same "redraw only on change" bucket via a low-frequency update, or is left to a
  version of the current CSS-keyframe bob applied to a thin, absolutely-positioned
  transparent overlay -- see the LOD note below for why this split is the right one.
- **Level of detail becomes cheaper, not just protected, under canvas.** Today's
  CHARACTERS.md LOD system pre-renders both LOD-0 and LOD-1 detail into the DOM and
  hides one with CSS -- correct for SVG (DOM churn is the enemy) but it means the
  full 13-node detail cost is paid in memory/build time for every citizen regardless
  of current zoom. In immediate-mode canvas there is nothing to pre-build: the draw
  function branches on the current zoom and only emits the LOD-0 (5-part) or LOD-1
  (13-part) draw calls actually needed for this redraw. LOD stops being a DOM-node
  mitigation and becomes a real per-redraw cost reduction.
- **Instancing/atlas were considered and are the wrong rung here.** A sprite atlas is
  the standard game answer to "many identical moving things," but CHARACTERS.md
  section 7 already rejected raster sprites for a stated, still-valid reason: the
  figure kit is composited per-agent from real attributes (hue, insignia,
  instrument, mantle, chip) and needs to stay crisp at 3.4x zoom -- a raster atlas
  would need one baked sprite per attribute combination (division times instrument
  times mantle times chip state, hundreds of combinations) or accept blur on zoom,
  for a cast of at most ~150. GPU instancing (regl/WebGL) is the right tool when N is
  in the thousands and geometry is identical per instance; neither is true here.
  Vector Path2D, cached once and filled with a transform, is the correctly-sized
  technique.

---

## 3. The element-budget question -- measured, and the finding that matters most

Ran `tests/budget.test.mjs` against the real, current snapshot (59 citizens, 86
skills, 219 roads, 8 districts):

    elements: 2170 rendered + 108 walker allowance = 2278 of 2400

**That is 94.9% of the 2400 SVG-element ceiling already spent, at today's exact
roster.** `CHARACTERS.md` itself flags the roster is headed toward "~90 planned"
agents -- real, declared growth, not hypothetical padding. Linear extrapolation
(current cost scales roughly with citizen count times ~13 nodes/figure at full
detail, plus building faces, plus one road element per edge) means the next
meaningful roster or skill-catalog growth is likely to blow through 2400, which
forces exactly the failure mode already logged once: strip a feature to fit a hard
node ceiling. The element budget is not a comfortable guardrail right now, it is a
wall probably one growth cycle away from being hit by honest growth, not scope creep.

**What replaces "2400 DOM elements or fewer" as the guard, once the bulk of the scene
is canvas:** a DOM node count stops being the meaningful unit, because canvas has no
persistent per-shape nodes. The guard becomes three numbers, each directly
measurable without a browser (mirroring how `tests/budget.test.mjs` already measures
without a real DOM, via its own fake countingDocument()):
1. **Draw-call budget for a full static redraw**, counted the same way
   `tests/budget.test.mjs` counts SVG nodes today: write a trivial fake
   CanvasRenderingContext2D recorder (records calls to fill, stroke, drawImage,
   fillText -- the same few dozen lines of style as the existing
   countingDocument()), run the real renderer against it in the test suite, and
   assert a ceiling on total draw calls for one full-fidelity static-layer paint.
   Suggested starting ceiling: **4,000 draw calls or fewer** for the static layer at
   the current snapshot size (roughly today's SVG element count, since one shape is
   about one fill/stroke call either way) -- but unlike the SVG ceiling, this number
   scales linearly and cheaply with roster growth in wall-clock terms (a fill() call
   is materially cheaper than a createElementNS plus attribute-set plus
   layout/paint invalidation), so the same ceiling buys meaningfully more roster
   headroom before it becomes the binding constraint.
2. **Frame-time budget for the dynamic layer**, per section 4 -- this is the number
   that actually gates 60fps, and it is bounded by WALKER_CAP, not roster size.
3. **A hard cap on real interactive DOM nodes**, kept deliberately small: the
   existing accessible roster list (`#roster-list`, already real button elements
   built from the same data -- see `site/app.mjs`) stays the primary interaction
   surface unchanged, so this cap is just "one node per citizen plus one per skill
   plus fixed chrome" -- on the order of 150-250 nodes total, an order of magnitude
   under today's 2170, because these nodes carry no geometry, only semantics.

---

## 4. Performance budget (the gates the build is held to)

Target hardware framing for every number below: **mid-range Android in the
Philippines** -- assume a device roughly at the level of a 2021-2022 MediaTek
Helio G-series / Snapdragon 6-series phone on a throttled mobile connection, not the
desktop this document's measurements were run on. Numbers marked **[reasoned]** are
this agent's judgment against known mobile-web budgets, not a live measurement on
that class of device -- flagged for performance-engineer to confirm against the real
device lab before implementation signs off.

| Gate | Budget | Basis |
|---|---|---|
| Target frame rate | 60fps sustained, 16.6ms per frame, during walker animation and camera drag | Standing goal; degrade via section 5 before missing it |
| Dynamic-layer redraw cost | 4ms per frame or less for up to WALKER_CAP=12 concurrent walkers, independent of total roster size | [reasoned] 12 simple ~15-part Path2D fills is a small fraction of a 16.6ms budget even on a weak GPU; measure to confirm once built |
| Static-layer full redraw | 150ms or less once at load; one redraw per completed gesture, not per frame, thereafter | [reasoned]; the offscreen-bitmap blit strategy in section 2 exists specifically so mid-gesture frames never pay this cost |
| Draw-call ceiling, static layer | 4,000 or fewer, measured per section 3, growable | Direct successor to today's measured 2170 of 2400 SVG elements |
| Interactive DOM nodes | 250 or fewer | Roster list plus skill list plus fixed chrome only; unchanged in spirit from today's roster list |
| JS payload, all site/*.mjs, gzipped | 60KB or less | Today's uncompressed total across all modules is ~150KB (city-view.mjs 33KB, app.mjs 22KB, layout.mjs/life.mjs/iso.mjs ~14KB each, walkers.mjs 8KB, palette.mjs 8KB); gzip on JS text this repetitive typically runs 25-35% of source, so this ceiling has real headroom and explicitly forbids adding a framework, since three.js alone is 3-10x this whole budget |
| CSS payload, gzipped | 15KB or less | Today's styles.css plus palette.css combined is ~34KB uncompressed |
| Data payload, ecosystem.json plus workforce.json | 250KB combined, uncompressed, or less | Today: ~137KB combined; leaves room for the declared ~90-agent growth |
| Time to first meaningful content | 1s or less on a throttled connection | The static, no-JS roster is plain HTML plus CSS with no fetch dependency -- this is a paint-time budget, not a network one, and today's architecture already meets it by construction |
| Time to interactive city, fetch, layout, first paint | 2.5s or less on a Slow 4G Chrome DevTools profile | [reasoned]; test against the real profile once the canvas path is built |
| Low-end device behavior | If prefers-reduced-motion is reduce, OR hardwareConcurrency is 2 or less, OR the dynamic-layer frame budget is measured to be missed for 3+ consecutive seconds: freeze the dynamic layer, draw every citizen standing, no walkers, no bob, and keep the static layer fully interactive | Extends the existing reduced-motion policy in site/app.mjs, which already pauses walkers on this preference, to a measured low-end trigger, not just a stated preference |

---

## 5. Fallback path

A blank canvas is a failed page, and this project already has the right instinct
here -- extend it, do not invent a new one:

- **Canvas2D itself needs no capability fallback in the WebGL/WebGPU sense** -- it
  has been universally supported for well over a decade, is never GPU-blocklisted
  the way WebGL contexts can be, and does not need a "no-WebGL" branch because
  nothing here requires WebGL. The one real failure mode is a context-creation
  failure: some privacy-hardened browsers/extensions restrict canvas reads for
  fingerprinting resistance, and getContext('2d') can still return null in rare
  lockdown configs.
- **On canvas failure, or on ecosystem.json fetch failure, or on any script error
  before the map finishes building**: fall back to exactly what already exists
  today and is already tested (`tests/site.test.mjs`) -- the always-present, real,
  semantic static-roster section (every division, every citizen, every skill,
  generated from the same data by `bin/build-site.mjs`) simply never gets hidden.
  This is not a new component to build; it is the existing no-JS-degradation path,
  and the canvas work must not weaken the condition that currently keeps it visible.
- **Slow network:** the static roster paints from the initial HTML with zero fetch
  dependency, already true today. The interactive canvas map is a progressive
  enhancement that mounts after ecosystem.json resolves; on a slow connection the
  visitor reads a complete, real page before the map exists at all, exactly as
  today.
- **JS disabled:** unaffected -- the static roster is server-free plain HTML and
  requires no script to render, already verified by the existing test suite.

---

## 6. Motion technique -- named, not adjectived

What is already correct and should not be re-argued: motion restricted to
opacity/transform only, never stroke-width, this repo's own documented scar, CSS
cubic-bezier easing on state transitions, OKLCH-space color derivation, which avoids
the muddy-midpoint problem of sRGB/HSL gradients and is a distinctly non-2010
technique (color-mix in srgb is explicitly banned in DESIGN.md for exactly this
reason), baked contact shadows plus ambient-occlusion patches instead of blur
filters, the "physically grounded without a shader" move indie 2D/2.5D games
actually use, and zoom-driven LOD swapping, a real game-engine technique, not just
decoration hiding.

Two concrete upgrades worth making as part of the canvas migration, both small and
named:

1. **Ease the walk, not just the state changes.** `life.mjs`'s walkProgress
   currently parameterizes position as s = t / leg -- linear time along arc length.
   Apply a smootherstep, 3t squared minus 2t cubed or a higher order curve, to s
   before feeding it into pointAlong, so a walker eases out of its doorway and eases
   into a pause instead of moving at constant velocity and stopping instantly. This
   is a one-line change, costs nothing extra per frame, and is precisely the kind of
   thing that reads as "2026 game" versus "2010 CSS animation" -- velocity curves,
   not just opacity curves.
2. **Prefer compositor-friendly transforms for the camera.** Today's attachCamera
   drives pan/zoom via an SVG transform attribute, which some engines still route
   through layout rather than the compositor. Once the camera moves to canvas,
   section 2's blit-during-gesture strategy, this is moot for the static layer; keep
   the dynamic layer's positioning on setTransform/drawImage math directly rather
   than round-tripping through DOM style at all, so there is no browser left to
   second-guess.

Camera behavior itself stays as designed: 1:1 pan with no inertia, clamped zoom from
0.55 to 3.4, reset-to-origin -- these are already deliberate, stated choices in
city-view.mjs's attachCamera and this pass endorses them unchanged.

---

## 7. Accessibility and reduced motion

Already strong, and the canvas migration's hardest constraint is **not regressing
it**:

- The existing architecture already separates "the accessible way to browse," the
  real button-per-citizen roster list, ARIA-labeled from the same data,
  keyboard-reachable, described in full in README.md, from "the visual map as an
  enhancement." This split is exactly what makes a canvas migration safe: the
  roster list does not care what paints the picture next to it.
- `site/app.mjs`'s reduced-motion check already gates the walker system, WCAG
  2.2.2, auto-moving content must be pausable, and there is already a toolbar
  toggle in addition to the media query. Extend, do not replace: on canvas,
  prefers-reduced-motion should skip mounting the dynamic layer entirely, no
  animation loop registered at all, mirroring today's "no animation loop, full
  stop" policy for the SVG version, rather than mounting it and hiding the result.
- **New requirement the canvas migration must satisfy, not present today because
  SVG gave it for free:** every citizen currently gets a real focusable, button-role
  element directly on the map for sighted keyboard users, per README.md's
  accessibility section. A canvas element cannot host focusable sub-elements. Two
  acceptable answers, in preference order: (a) accept that keyboard map navigation
  moves entirely to the roster list, still a complete, real equivalent, this is a
  legitimate scope decision, not a silent regression, and should be stated in the
  page copy if chosen, or (b) keep parity by drawing a synthetic focus ring on the
  canvas at the currently-focused list item's screen position, a focus-event
  listener on the existing list items, no new DOM, minimal draw cost. Recommend (b)
  if implementation time allows, because it is a real capability today and removing
  it without saying so is exactly the kind of quiet regression this project's own
  house style, see README.md's "Limitations (honest)" section, would call out.
- The canvas element itself should carry an image role with one aggregate, real
  aria-label summarizing the scene, count of districts/citizens/skills, same
  numbers the status board already computes, rather than nothing -- screen-reader
  users get a real summary at the map's position even though the map is not their
  browsing path.
- No change needed to the contrast work, `tools/contrast.mjs` and
  `tests/contrast.test.mjs` -- those numbers are about the OKLCH palette values
  themselves, not the paint target, and canvas reads the same CSS custom properties
  via getComputedStyle.

---

## 8. Escalate a rung, or cut, only on these triggers

**Escalate to WebGL, regl or PixiJS with sprite batching, not three.js, only if
either becomes true, and only after measuring, not assuming:**

- The roster grows into the many hundreds, not the declared ~90, and a real
  benchmark on a target-class Android device shows the layered-canvas static redraw
  missing its budget even with the offscreen-bitmap gesture strategy in section 2.
- The brief changes to want true 3D camera behavior, orbit, tilt, fly-through,
  rather than the current fixed-isometric pan/zoom -- that is a genuine 3D-scene
  need Canvas2D cannot fake, and would be the first legitimate reason to reopen this
  document.

**Cut nothing.** The recorded lesson stands: characters, movement and teams were
asked for three times and cut three times, and that was the mistake, not a caution
to repeat. Nothing measured in this pass, not the 94.9%-full element budget, not the
bundle-size math, not the CSP, argues for removing figures, walkers, or the crew
filter. It argues for changing what paints them, which is exactly what section 1
recommends.

---

## 9. What is not yet measured (owed to performance-engineer)

This pass is advisory and read the code; it did not build the canvas path or run it
on real mobile hardware. Before implementation ships, performance-engineer should
verify, on an actual mid-range Android device, not this desktop:

1. Real frame time for the dynamic layer at WALKER_CAP=12, and again at a
   stress-tested higher cap, to confirm the section 4 four-millisecond figure.
2. Real wall-clock time for a full static-layer redraw at the current snapshot
   size, and at a synthetically inflated ~150-citizen/~150-skill snapshot, to
   confirm the draw-call ceiling in section 3 still maps to an acceptable paint
   time as the roster grows.
3. Real gzip sizes of the finished JS/CSS once the canvas rewrite lands, against
   the section 4 payload ceilings.
4. A Slow-4G DevTools trace for time-to-interactive against the section 4 target.
