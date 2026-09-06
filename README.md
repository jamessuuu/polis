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

## The studio: the second half of the page (`lib/`, `api/`, `site/studio.mjs`)

Below the city, a visitor can put their OWN ecosystem on the same map, browse
eight starter templates, and download a bundle that works when they unzip it.
`site/studio.mjs` is the wiring and holds no decisions: the parsing, the
validation and the zip writing all live in `lib/`, which is where the tests
are.

The import is local and the page says so in one line beside the control. That
sentence is checkable: `site/studio.mjs` contains exactly three URLs
(`./library.json`, `./library-free.json`, `/api/lead`), none of them on the
import path, `tests/studio.test.mjs` asserts that by reading the source, and a
Playwright network capture across a real import records zero requests in
Chromium and WebKit alike, including an import of this machine's whole
`~/.claude` (41,024 files walked, 4,937 read, 775 charters).

```
a visitor's .claude tree, a zip of one, or one pasted file
                    │
                    ▼  lib/import.mjs   (100% in the tab, no network at all)
            the same ecosystem.json shape site/ already renders
                    │
                    ▼  lib/export.mjs + lib/zip.mjs
      agents/*.md + skills/<name>/SKILL.md + README.md, zipped in the browser
                    ▲
                    │  lib/library.mjs   (8 starter ecosystems, 6 free)
                    │
             api/lead.mjs  ── emails James, and only then releases a locked one
```

- **`lib/import.mjs`** parses agent charters and `SKILL.md` files into
  `ecosystem.json`. A malformed charter is counted and skipped, never fatal,
  the same way `src/workforce.mjs` treats a malformed log line. It makes **no
  network call of any kind** and `tests/import.test.mjs` reads the module's
  own source to keep that true: a visitor's charters are their intellectual
  property and the offer is only acceptable if the drop is local.
- **`lib/export.mjs`** writes bundles that work when unzipped into `~/.claude/`.
  Skills follow the [Agent Skills](https://agentskills.io/specification) open
  standard; every free-text frontmatter field is quoted, because real charter
  descriptions contain `": "` in ordinary prose and a plain YAML scalar may not.
- **`lib/zip.mjs`** reads and writes ZIP archives with no dependency, using the
  runtime's own `CompressionStream`/`DecompressionStream` for deflate.
- **`lib/library.mjs`** holds eight starter ecosystems. Each carries `claims`
  paired with verbatim quotes from its own charters, and `verifyClaims` (run
  over every template by `tests/library.test.mjs`) fails if a template
  advertises something its charters do not say.
- **`lib/lead.mjs` + `api/lead.mjs`** are the lead form's decision ladder and
  its Vercel binding. See `.env.example`; with the mail settings missing the
  function answers `not-configured` and never claims to have sent.

```
npm run validate:export     # writes real bundles to a temp dir, runs the
                            # Agent Skills reference validator over each skill,
                            # and opens each zip with the platform's own extractor
```

## Regenerating the snapshot

```
npm run snapshot        # re-reads ~/.claude, writes data/ecosystem.json
npm run build:site      # copies data/ecosystem.json into site/ecosystem.json
```

`build:site` does four things, all of them deterministic: it copies the
snapshot and the telemetry into `site/`, regenerates the status board and
the static roster in `index.html` from that snapshot, writes
`site/palette.css` from `site/palette.mjs`, and builds the studio's
payload: `site/library.json` (previews and template cities, free and
locked), `site/library-free.json` (the six free templates in full), and
copies of `lib/import.mjs`, `lib/export.mjs`, `lib/zip.mjs` and
`src/extract.mjs` into `site/lib/` and `site/src/` so the browser can load
them. The copies keep their relative shape, because `lib/import.mjs`
imports `../src/extract.mjs` and the parser is not duplicated.

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

- **An imported city can exceed the element budget the house map keeps to.**
  DESIGN.md caps the map at 2,400 SVG elements and `tests/budget.test.mjs`
  holds the shipped snapshot to it. The studio draws whatever it is handed:
  importing this machine's real `~/.claude` (125 citizens, 171 skills, 38
  guilds) produces 3,063 elements. It renders in well under a second and
  pans smoothly, but the budget is a promise about the map polis ships, not
  about a stranger's tree, and no test can hold the second one.
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
- **`api/lead.mjs` is deployed, was broken, and is still unconfigured.**
  Vercel does build a top level `api/` directory for this static project:
  the production deployment reports one Node lambda, `outputDirectory:
  "site"` does not suppress it, and the tracer follows the imports out to
  `lib/` and `src/`, so no `functions` block or `includeFiles` is needed.
  That was established by probing the live deployment, which answered 500
  `FUNCTION_INVOCATION_FAILED` on every call: line 30 imported
  `templateSkills` from `lib/export.mjs`, which does not export it. It is
  `lib/library.mjs` that does. Fixed, and `tests/lead.test.mjs` now imports
  the route so a bad import fails the suite instead of the deployment.
  Two environment values are still unset and both are needed before the
  form can succeed: `POLIS_SITE_URL` (without it the origin check falls
  back to `VERCEL_URL`, the deployment's own hostname, and a request from
  the production domain is refused 403 `origin`) and the four
  `POLIS_LEAD_*` mail values (without them the function answers 503
  `not-configured`). The page reports both refusals rather than showing a
  tick, which is the behaviour to expect until they are set.
- **No email provider is chosen.** `api/lead.mjs` posts JSON to whatever
  endpoint `POLIS_LEAD_EMAIL_ENDPOINT` names, with the body shape defined by
  `mailBody` in `lib/lead.mjs`. Whether a given provider accepts that shape has
  not been tested against a live provider, only against a stub.
- **The File System Access API path is not covered by an automated run.**
  `site/studio.mjs` uses `showDirectoryPicker()` where it exists (Chromium)
  and a `webkitdirectory` input everywhere else (WebKit reports
  `showDirectoryPicker: undefined`, verified). Playwright cannot drive a
  native directory picker, so the browser runs exercise the input fallback
  and the zip path in both engines, and the picker branch is covered only by
  reading the code.
- **A zip import is capped by what `DecompressionStream` will open.**
  `lib/zip.mjs` refuses zip64, unsafe paths and bad checksums by name. A zip
  produced by a tool that uses zip64 for an archive of ordinary size will be
  refused, and the page says so rather than showing an empty city.
- **The studio always fits the whole city into its frame.** The hero map
  picks a frame by container size so a phone gets a district rather than a
  postage stamp. The studio does not: it shows all of whatever is on the
  stage, which is right for a four-member template and small for a
  hundred-member import on a phone until you zoom. The member list beside
  the map names everyone as text either way.
- **The importer reads any `<name>/agents/*.md` as a guild called `<name>`.**
  Run against this machine's real `~/.claude` it turned a test fixture
  directory into a guild named "clean". That is discovery working as designed
  and the trade is deliberate: an allowlist of directory names would silently
  drop a real guild instead.
- **No automated a11y test run was performed against a live browser** (no
  screen-reader pass, no axe/Lighthouse run) as part of building this —
  verification here was a manual keyboard-only pass plus the computed
  contrast ratios above. Treat this as a solid first pass, not a signed-off
  audit.

## License

MIT. See `LICENSE`. Copyright (c) 2026 James Lorenz Santos.
