# polis

Polis reads James Lorenz Santos's personal Claude Code agent ecosystem off
disk and renders it as a place: eight districts for the eight divisions,
citizens for the agents, roads for the work that actually flows between
them, and a status board for the two things that are genuinely wrong with
the wiring. It is not an org chart. It is a snapshot, timestamped, of a real
system, and every number on the page traces back to one file.

Live constraint this whole project is built around: **every number and
label on the page comes from `data/ecosystem.json`.** No invented citizens,
no decorative "coming soon" members, no made-up levels or achievements. Game
feel (districts, roads, a sense of place) is welcome; fabricated game stats
are not.

## How it fits together

```
~/.claude/agents/*.md, ~/.claude/skills/*/SKILL.md, ~/.claude/ECOSYSTEM.md
                    │
                    ▼  (src/extract.mjs — pure, tested, no real disk in tests)
              bin/snapshot.mjs
                    │
                    ▼
           data/ecosystem.json  ──(npm run build:site)──▶  site/ecosystem.json
                                                                    │
                                                       site/index.html + app.mjs
                                                       fetch it once at load,
                                                       then everything is local
```

- `src/extract.mjs` — the extractor. Parses agent/skill frontmatter, reads
  the division roster and edges out of `ECOSYSTEM.md`, applies the privacy
  filter, and computes the constitution's own audit (who is unreachable).
  Covered by `tests/extract.test.mjs` (15 tests, `npm test`).
- `bin/snapshot.mjs` — CLI that runs the extractor against the real
  `~/.claude` tree and writes `data/ecosystem.json`.
- `site/` — the static front end. `index.html`, `styles.css`, `layout.mjs`
  (the map's layout algorithm), `app.mjs` (everything interactive), and
  `ecosystem.json` (a copy of `data/ecosystem.json`, so the deployed site
  never depends on anything outside its own folder).

## Regenerating the snapshot

```
npm run snapshot        # re-reads ~/.claude, writes data/ecosystem.json
npm run build:site      # copies data/ecosystem.json into site/ecosystem.json
```

`build:site` only copies the JSON. It does **not** regenerate the static
roster baked into `index.html` (see Limitations below) — if the numbers
genuinely change, that markup needs a hand update too, the same way the
counts in the status board do.

## Running the site locally

There is no build step and no dev server bundled with the project (by
design: vanilla JS, same-origin ES modules, zero dependencies). Serve
`site/` with any static file server, for example:

```
npx serve site
# or
python -m http.server --directory site 8080
```

Opening `site/index.html` directly via `file://` mostly works but the
`fetch('./ecosystem.json')` call is blocked by some browsers' CORS handling
of the `file:` scheme, so the interactive map/list stay hidden and only the
static roster shows. Use a real (even localhost) HTTP server to see the
whole thing.

## The privacy posture

The ecosystem contains guild agents that name a real employer and real
clients (Lift Legal, RelaxOps, Nadela, and anything Basecamp-shaped). A
snapshot of "my agent society" is a fine thing to publish and a bad thing to
publish carelessly, so:

- `bin/snapshot.mjs` defaults to `--scope personal`, which only reads
  `~/.claude/agents` and `~/.claude/skills` — James's own members, not a
  client's.
- Any member whose **id or frontmatter description** matches a client/employer
  pattern (`lift`, `firm-pro`, `relaxops`, `nadela`, `basecamp`, `law firm`,
  ...) is dropped from the snapshot and counted, never silently included.
  Charter **bodies** are never read into the snapshot at all — only
  frontmatter fields and the edges derived from them — so a client mention
  inside a charter's prose can never leak, even from a member that ships.
- The site shows the withheld **count** and a general **reason category**
  ("id or description names a client or employer") but deliberately does
  not print the withheld member's id. In the current snapshot that id
  (`prompt-engineer`) happens to be harmless on its own — it was withheld
  because its *description* mentions a client project as an example — but
  the site treats every withholding the same way regardless, because the
  whole point of withholding is to not publish something that could
  identify who it names, and that has to hold even when, this time, it
  looks safe to break.
- `unreachable` members (currently `knowledge-librarian` and `mentor`) are
  named explicitly, by contrast: they are not a privacy matter, they are a
  governance finding about members who are *already* fully published in the
  `agents` array. Hiding their names would just be burying the finding.

## Accessibility

- Real landmarks (`header`, `main`, sectioned `<section>`s with
  `aria-labelledby`, `footer`), one `<h1>`, headings that never skip a
  level in either the static or the JS-enhanced view.
- The SVG map is a genuine enhancement, not the only way to browse: every
  citizen also appears as a real `<button>` in a keyboard-reachable list
  (`#roster-list`), built from the same data. SVG citizens are additionally
  focusable (`tabindex="0"`, `role="button"`) for sighted keyboard users who
  want to use the visual map directly, with a "skip the map" link for anyone
  tabbing linearly.
- `prefers-reduced-motion: reduce` is honored — the map's layout is computed
  once, synchronously, with no animation loop at all, and the small CSS
  hover/focus transitions are wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- Contrast was computed, not assumed, for every foreground/background pair
  used for text and for every fill/background pair used as a graphical
  object, in both themes, against the WCAG relative-luminance formula. See
  the palette comment at the top of `site/styles.css` for the exact
  numbers; every pair clears AA (4.5:1 text, 3:1 non-text) with margin.
- Works with JavaScript disabled: `site/index.html`'s
  `#static-roster-section` is real, always-present HTML — every division,
  every citizen's description/model/tools/wiring, every skill — that only
  gets hidden once the interactive map and list have finished building
  successfully. If `ecosystem.json` fails to fetch, or any script error
  happens first, that section simply never gets hidden, so the page never
  degrades to blank.

## Limitations (honest)

- **The static roster can drift from a re-run snapshot.** `index.html`'s
  `#static-roster-section` and the status board's numbers were hand-authored
  from the `data/ecosystem.json` current as of this writing
  (`generatedAt: 2026-09-05T17:36:44.332Z`). `npm run build:site` only
  copies the JSON; it does not regenerate that markup. If the real
  ecosystem changes enough to warrant a new snapshot, the static roster and
  the status board's numbers need a manual update to match, or they will
  quietly disagree with the counts the JS side computes live from the fresh
  `ecosystem.json`.
- **"Offline after first load" means no further network calls, not a
  service worker.** The page fetches `ecosystem.json` once; after that,
  the map, filters, search, and panel are all driven from memory with zero
  additional requests. There is no service worker and no guarantee the page
  still opens if you close the tab, lose connectivity, and reopen it later
  with an empty HTTP cache — that would need an installable-PWA layer this
  project does not build.
- **A handful of skill descriptions are literally `>`.** `src/extract.mjs`'s
  frontmatter parser is a flat-scalar YAML reader; it does not follow YAML's
  multi-line block-scalar syntax (`description: >` followed by an indented
  block). For skills whose `SKILL.md` uses that form (`idea`, `note`,
  `openclaw`, `quality-gate`, `seal`, `sync-config`), only the `>` character
  is captured. The site shows this verbatim rather than papering over it
  with invented copy, because inventing a nicer description would violate
  the one rule this whole project is built around. It is called out again,
  in the page itself, right above the skills list.
- **The force-directed map layout is a simple one, not a proper graph-layout
  library.** It settles quickly and is deterministic (seeded per citizen id,
  so reloads look the same), but with 45 nodes and 105 edges some roads do
  cross district boundaries visually more than a hand-tuned map would.
  That crossing is real: it is what the declared wiring actually looks like.
- **`prompt-engineer`'s withholding reason reads a little indirect.** It was
  withheld because its frontmatter *description* names a client project as
  an example of what a sibling agent (`ai-engineer`) ships to, not because
  `prompt-engineer` itself is client work. That is `src/extract.mjs`'s
  design working as intended (id-or-description matching, deliberately not
  a body scan — see the comments in that file), but it does mean the one
  withheld member in this snapshot is a slightly noisy hit, not a clean one.
- **No automated a11y test run was performed against a live browser** (no
  screen-reader pass, no axe/Lighthouse run) as part of building this —
  verification here was a manual keyboard-only pass plus the computed
  contrast ratios above. Treat this as a solid first pass, not a signed-off
  audit.

## License

MIT. See `LICENSE`. Copyright (c) 2026 James Lorenz Santos.
