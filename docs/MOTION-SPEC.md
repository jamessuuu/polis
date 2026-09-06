# Polis — motion and atmosphere spec

Written by an interaction-designer pass, 2026-09-06, against `STRATEGY.md`,
`RENDER-BUDGET.md`, `DESIGN.md` and `CHARACTERS.md`. This document owns what
fires when something changes state or when a gesture happens. It does not place
anything on the page (`LAYOUT-SPEC.md` owns that) and does not touch geometry,
palette or the character kit (`DESIGN.md` / `CHARACTERS.md` own those).

Hard constraints, stated once and not re-argued per row: transitions on
`opacity`/`transform` only, never `stroke-width`; hover creates zero new DOM
nodes; nothing animates without a record behind it; no `<filter>`,
`feDropShadow` or CSS `filter` on any map element.

---

## 0. Token vocabulary

Ten hand-authored durations are scattered through `styles.css` today. They are
internally consistent but unnamed, which is how a codebase acquires an eleventh.
Collapse to this set:

```css
:root {
  --dur-instant: 0ms;
  --dur-fast:    120ms;   /* plates, panel open/close, skip-link */
  --dur-base:    140ms;   /* structure dim/lift, road highlight, precinct hover */
  --dur-cross:   300ms;   /* standing <-> walking figure crossfade */
  --ease-standard:   cubic-bezier(0.2, 0, 0, 1); /* every discrete state change */
  --ease-ambient:    ease-in-out;                /* loops that return to start */
  --ease-ripple:     ease-out;                   /* one-shot expanding fade */
  --ease-mechanical: linear;                     /* continuous rotation */
  --loop-bob:            3.4s;
  --loop-walk-step:      0.46s;
  --loop-tool-swing:     1.2s;
  --loop-window-pulse:   2.8s;
  --loop-banner-wave:    2.6s;
  --loop-road-pulse:     1.4s;
  --loop-construct-spin: 9s;
}
```

Homogenisations (previously hand-authored):

| Was | Becomes | Where |
|---|---|---|
| `0.16s ease` (road/edge) | `var(--dur-base) var(--ease-standard)` | `styles.css:659` |
| `0.15s ease` (skip-link) | `var(--dur-fast) var(--ease-standard)` | `styles.css:98` |
| `0.12s ease` (name-plate-in) | `var(--dur-fast) var(--ease-standard)` | `styles.css:661` |
| `0.14s cubic-bezier(...)` | `var(--dur-base) var(--ease-standard)` | `styles.css:658` |
| `0.3s ease` (away/walker) | `var(--dur-cross) var(--ease-standard)` | `styles.css:660` |

The seven ambient loops keep their exact periods and easings. Do **not** merge
`--ease-ripple`, `--ease-mechanical` and `--ease-ambient` into one — they encode
different physical behaviours, not inconsistency.

---

## 1. Prohibitions

1. No intro animation, camera fly-through on load, loading bar, sound,
   tick-up counters, neon glow or cyberpunk grid.
2. No continuous full-field motion, no blinking, nothing unpausable, nothing a
   visitor must wait through.
3. No particle systems, no ambient extra pedestrians, no generated citizens.
   Twelve real walkers, never more, never invented.
4. **No haptics anywhere.** A reference map with no native shell has no product
   reason for `navigator.vibrate`.
5. **No sound.** No sound-designer handoff exists or should.
6. **FIX — the `.settle` load animation (`styles.css:664-672`) must be REMOVED,
   not tuned.** It fades the whole scene from opacity 0 with
   `translateY(14px) + scale(0.985)` over 900ms. That is textbook "camera
   fly-through / intro animation a visitor must wait through" — fail condition 4
   verbatim. It also works against job #1 (`STRATEGY.md` §2): first paint must
   read "this is real, populated" and a 900ms fade means it does not, for 900ms.
   **The city paints at full opacity, full position, in one frame.** The only
   permitted frame-to-frame difference at load is the phase offset of the
   already-staggered idle-bob and walker-launch schedules — those desynchronise
   an ongoing loop rather than delaying paint.
7. **No camera motion the user did not drive.** No fly-to, no auto-centre, no
   auto-zoom on selection, no eased tween on reset.
8. **No parallax.** Sky, haze and city move together, 1:1, under one transform.
9. **No drifting sky elements** (clouds, light rays, day-night sweep). The sky
   gradient is static per theme.
10. **No staggered reveal of factual content.** Panel fields populate together,
    one paint, no per-field delay. Staggering them would manufacture an
    importance order the data does not have.
11. **No arrival flourish when a walker reaches a host.** The walker plus its
    trailing road-pulse *is* the record. A door glow would be motion in excess
    of what the record supports.

---

## 2. Motion vocabulary

### 2.1 Walker locomotion

A walker is a real collaboration pair from `data/workforce.json`. Twelve slots
(`WALKER_CAP = 12`), cycling the full partnership roster deterministically —
never random, same order every load.

Existing timing, keep: `WALK_SPEED = 52` units/sec, `WALK_PAUSE_MS = 2600`,
`leg = max(2500ms, length/52 * 1000)`, `total = 2*leg + pause`. Launch stagger
`slotDelay(slot) = slot * 1400ms`, so first paint never shows a synchronised
mass departure.

**FIX — velocity curve.** `walkProgress` parameterises position linearly
(`s = t / leg`): constant speed, instant stop. That is the "2010 CSS animation"
tell `RENDER-BUDGET.md` §6 names. Apply cubic smoothstep **where `s` is
consumed**, not inside `walkProgress` (`tests/life.test.mjs` pins exact linear
values at `t=0`, `t=leg`, `t=leg+pause/2`, `t=total`):

```js
// site/walkers.mjs, inside frame(), replace:
//   const p = pointAlong(w.path, pr.s * w.path.length);
const eased = pr.s * pr.s * (3 - 2 * pr.s); // smoothstep: ease(0)=0, ease(1)=1
const p = pointAlong(w.path, eased * w.path.length);
```

Safe for all three phases (`pausing` holds `s=1`; `returning` computes
`1 - back/leg` before this line). Costs nothing — arithmetic on a scalar already
computed. Do **not** add per-corner easing on top; the router's turn penalty
already produces long straight runs.

Depth re-sorting, direction flip and pause pose are already correct in
`walkers.mjs` — keep as-is.

### 2.2 Departure and arrival

At departure the standing figure and walking figure crossfade — both already
correctly positioned, so this is a pure opacity swap:

- Standing: opacity 1 -> 0, `var(--dur-cross)` `var(--ease-standard)`
- Walking: opacity 0 -> 1, same window, same easing, **same moment** — a
  synchronised crossfade, never sequential. There must be no frame where
  neither, or both, read as fully present.

Arrival and return-departure need no crossfade: the walker is one continuously
visible element across the whole cycle.

**Reduced motion:** walkers never leave home. `app.mjs` already gates this —
`walkers.start()` is only called when `!prefersReducedMotion()`. The fallback is
not "walkers frozen mid-street" but "everyone visible, standing, at their own
door", which is a *better* frame for the two comprehension jobs, not a degraded
one. Keep exactly as implemented.

### 2.3 Selection and focus

Existing, keep, now token-referenced: active lift `-5px`, neighbour/crew `-2px`,
others `opacity 0.22`, all `var(--dur-base) var(--ease-standard)`. Name plate
`opacity 0->1`, `translateY(3px->0)`, `var(--dur-fast)`.

**NEW — panel open/close.** Today `citizen-panel[hidden]` is a hard
`display:none` toggle with no transition. A sighted mouse user gets no visual
cue beyond content appearing. Add:

- Open: opacity 0->1, `translateX(12px->0)`, `var(--dur-fast)`
  `var(--ease-standard)`, on the panel's inner content (toggle a `.panel-in`
  class the instant `hidden` is removed, mirroring the existing
  `.name-plate-in` pattern).
- Close: symmetric reverse, same duration and easing — matching the existing
  convention, no separate "faster exit" number invented.
- All fields populate together (prohibition 10).
- Reduced motion: instant `hidden` toggle. No information lost.

### 2.4 Precinct hover — NEW

Not built today. A precinct is a real entity (`agents[].division`/`guild`), so
previewing its membership on hover is data-honest.

Trigger: hover or keyboard focus on the already-mounted `.precinct-plate` group
— reuse it; do not add a separate hoverable ground tile, which would be a second
hit target over the same information and would conflict with citizen hover.

Feedback: apply the **existing** `.neighbor` treatment (-2px lift) to every
citizen in that precinct and `.dimmed` (0.22) to everyone outside it — reuse
`refreshHighlight()` with a larger id-set, not a new mechanism. The plate itself
bumps `--plate-alpha` 0.94 -> 1.0. All at `var(--dur-base)`, no stagger.

**Zero new DOM nodes.** Placement and hit-area are `LAYOUT-SPEC.md`'s call.

### 2.5 Camera (existing, endorsed unchanged)

Pan: pointer-drag 1:1, no inertia, no momentum. Keyboard arrows step 48 units.
Zoom: wheel factor 1.14, keyboard 1.2, buttons 1.25, clamped `k in [0.55, 3.4]`,
always anchored to the point under the cursor. Reset: instant snap, **no eased
tween**. LOD swap at `k = 1.5` is a CSS class toggle, never a JS rebuild, and
must never fire mid-gesture.

### 2.6 Pinch-to-zoom — NEW, and a real gap

`#city-map { touch-action: none }` disables native pinch, and the only JS pointer
handling is single-pointer drag. **On a touch device there is currently no way
to zoom except the toolbar buttons.** Given the named 390px breakpoint this is a
real defect.

| Parameter | Value |
|---|---|
| Recognition | Two active `pointerType: 'touch'` pointers on `#city-map` |
| Deadzone | Pointer distance must change >=8px from gesture start before entering pinch mode |
| Factor per frame | `currentDistance / lastDistance` — incremental, frame-over-frame, never `/ startDistance` (which compounds wrongly across moves) — fed to existing `zoomAt(factor, cx, cy)` |
| Zoom centre | Current midpoint of the two pointers, recomputed every `pointermove` — true pinch-to-point |
| Clamp | Same `k in [0.55, 3.4]`. One clamp, one place |
| Momentum | None. 1:1 direct manipulation, matching the pan philosophy |
| Single-finger pan | Disabled while a second pointer is down; resumes on next `pointerdown` after both lift |
| `touch-action` | Stays `none` — this handler fully replaces native gestures |

Reduced motion: unaffected. The preference governs *ambient* motion the page
starts on its own, not motion the user drives with their own fingers.

### 2.7 Lit windows

| Activity | Fill | Opacity | Motion |
|---|---|---|---|
| `dormant` / `idle` | `--window-off` | 1 | none |
| `recent` (<=30d) | `--window` | 0.8 | none |
| `active` (this session) | `--window` | 1 | `window-pulse` `var(--loop-window-pulse)` `var(--ease-ambient)`, per-building delay `(idx % 7) * 400ms` |

**Baked at page-generation time, not live.** The snapshot's own `generatedAt`,
never the wall clock, decides state. **There is no transition between these
states within a session** — a window does not turn on as you watch. The 2.8s
loop signals "this is the emphasized state", not "this just changed". Do not
build progressive lighting on scroll or over time; that fabricates a
live-telemetry feel this static site does not have.

### 2.8 Ambient loops (existing, unchanged)

`fig-bob` 3.4s (delay `(idx*260) % 3400`), `walk-step` 0.46s, `road-pulse` 1.4s
`--ease-ripple`, `tool-swing` 1.2s (the `active` flag), `banner-wave` 2.6s
(delay `(idx%5)*300`), `construct-spin` 9s `--ease-mechanical` (marks `Explore`
as a construct, not a citizen). All stagger from a stable index, never
`Math.random()`.

### 2.9 Theme toggle

**Instant, no transition.** Colours are not on the opacity/transform budget.
Cross-fading dozens of OKLCH properties would mean animating `fill`/`stroke` on
hundreds of elements — exactly the cost class this repo's `stroke-width` scar
warns against, for zero informational payoff. **Do not add a theme crossfade.**

### 2.10 Map mount

The fallback during fetch is the complete real static roster, not a skeleton —
real content beats a placeholder. **Do not build a map skeleton.** When the JSON
resolves the SVG appears instantly at full opacity — no fade-in, the same call
as §1.6 applied to the async-mount seam.

---

## 3. Atmosphere — craft, not claims

Environment (sky, ground, light, shadow, haze, the board) is craft and may be as
beautiful as the budget allows. It never implies a fact. No record says what time
of day it is, so "time of day" is only the two fixed palette states, switched by
explicit preference, never by a clock.

| Layer | Treatment | Motion |
|---|---|---|
| Sky | Vertical gradient `--sky-top -> --sky-bottom` | **Static.** No drift, clouds or parallax |
| Board | Ground diamond + two 14u extruded edge faces + 1.5u outline — an object on the page | Static |
| Ground AO | One shared `radialGradient` (`#ao-patch`), one ellipse per building, stops 0.30 / 0.16 / 0 | Static, never on hover or zoom |
| Cast shadow | Pentagon per building, collinear with the +row key light. **Per-element `fill-opacity`, never group opacity** (group opacity re-rasterises ~290 shapes per zoom tick) | Static |
| Rim | 0.9u light theme (revealed only by hover) / 1.1u dark theme, always on — the WCAG boundary for faces below 3:1 | Never independently animates |
| Depth haze | Two flat planes: ground 0.40a, object 0.10a **cap — arithmetic, not taste: past ~0.102a a T1 roof drops below 3:1** | Static. Never breathes or shifts with zoom |
| Key light | One fixed source, upper-right, along +row | Fixed forever. No hue rotation anywhere |

**Explicitly NOT added**, because this is where a "make it more 2026" brief goes
wrong: no drifting clouds (also too close to the rejected gradient-blob
anti-reference), no lens flare/bloom/glow (a runtime-filter look this renderer is
banned from, and a raster fake would look identical to the banned neon
aesthetic), no vignette that darkens with zoom (recomputed per tick — the same
jank class group-opacity was rejected for), no god-rays, no dust motes, no
background pedestrians to fill empty streets.

**The atmosphere win available here is execution precision on what is already
specified** — correct OKLCH derivation, correct contrast, one light model applied
consistently to buildings *and* the character kit — not new environmental
elements.

---

## 4. Reduced motion and pausing

`prefers-reduced-motion: reduce` already does the correct blanket thing
(`styles.css:736-738`). Combined with `app.mjs` never starting walkers, the
reduced frame is: every citizen standing at their own door, fully opaque, no bob;
every activity state legible via static window fill/opacity and the belt lamp;
banners and `Explore` static; hover/focus/selection still working as instant
class toggles. **No information lost, only the tween.**

**The Life toggle must keep working exactly as today.** It pauses running
animations (`animation-play-state: paused`) rather than resetting, and separately
calls `walkers.pause()`/`.resume()` so a walker mid-street freezes in place
rather than teleporting home. This is a deliberate, correct difference from the
media query: the *preference* prevents motion from ever starting; the *toggle*
freezes whatever exists now. Both are valid and must both keep working — do not
collapse them.

**Nothing is reachable only through motion.** Every fact a walker, pulse or wave
carries is also carried by a static property. This is already true and must stay
true for the three new behaviours specified here.

---

## 5. The at-rest frame

The screenshot-and-share artifact is the reduced-motion / Life-off frame:

1. Every citizen present and standing — nobody invisibly "away".
2. Windows are the loudest binary on screen without being a chart: most dark, a
   minority warm. "Populated, and part of it is dark" rendered as pure material,
   no legend needed.
3. Ruins read as deliberate absence, not a loading failure — dashed footprint,
   no volume, no shadow, no figure, no windows. **Ruins get zero motion
   treatment, ever.**
4. Director banners and the dark-theme rim are static but present — structure,
   not paused motion.
5. **No panel, no hover, no dimming in the canonical still.** A dimmed 78% of the
   city with one lit citizen is a worse screenshot than the full undimmed city,
   even though it is the more interesting live moment.

---

## 6. Performance budget

| Gate | Budget |
|---|---|
| Frame rate | 60fps / 16.6ms sustained during walker animation and camera drag |
| Walker layer redraw | <=4ms/frame for up to 12 walkers, independent of roster size |
| Static layer full redraw | <=150ms once at load; one redraw per completed gesture, never per frame |

**Degradation order on a mid-range phone**, triggered only by measured conditions
(`prefers-reduced-motion`, `hardwareConcurrency <= 2`, or 3+ consecutive seconds
missing budget) — never as a design default:

1. `banner-wave` and `construct-spin` — decorative over an already-static fact.
2. `tool-swing` and `window-pulse` — `active` stays legible via colour alone.
3. `fig-bob` — yields exactly the §4 reduced-motion frame, a designed state.
4. **Last, and only under measured trigger: the walker loop.** Per `STRATEGY.md`
   and `RENDER-BUDGET.md` §8, **characters themselves never disappear** — only
   ambulation stops, falling back to everyone standing. This is the one step that
   touches the client's named ask, so it is gated hardest and ordered last.
5. **Camera responsiveness is never degraded.** It is navigation, not decoration.

---

## 7. Traceability — motion to record

| Moving/lit thing | Record | Field / file |
|---|---|---|
| A walker | A real co-dispatch pair | `workforce.json` -> `life.mjs walkerPairs` |
| Walker's instrument | Primary tool capability | `agent.tools` -> `life.mjs capabilityOf` |
| A lit window | A dispatch inside the telemetry window | `workforce.json` + `generatedAt` -> `activityOf` |
| A dark window | No dispatch in 30 days, or never | same, `idle`/`dormant` branch |
| A director's banner | `director: true` | `ecosystem.json` |
| `Explore`'s construct rendering | `system: true` | `ecosystem.json` |
| A ruin | `unreachable: true` | `ecosystem.json` |
| A belt lamp | Recent/active telemetry flag | `workforce.json` |
| A precinct highlight | Division/guild membership | `agents[].division`/`guild` |
| The dark-theme rim | A face below 3:1 contrast | `tools/contrast.mjs` measured |

Nothing in this document adds a row that cannot be filled in.

---

## 8. Open items

- **Precinct hover placement/hit-area** — routed to `LAYOUT-SPEC.md`.
- **Whether the panel-open reveal is worth its cost** given the panel already
  gets a hard focus move — a product call; the spec stands either way.
- **Pinch-zoom is a real, previously undocumented gap** (mobile cannot zoom by
  touch at all today) — confirm in scope for this pass versus a fast-follow.
