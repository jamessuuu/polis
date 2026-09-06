/**
 * The studio: the half of the page where the city is the visitor's.
 *
 * Everything above the studio is a picture of one ecosystem. This is the door
 * into the three modules that make the picture reusable, and it is deliberately
 * a thin one. `lib/import.mjs`, `lib/export.mjs` and the library JSON already
 * hold every decision and every test; nothing here re-implements a parser, a
 * validator or a zip writer, and nothing here invents a number.
 *
 * WHY THIS FILE IS SEPARATE FROM app.mjs. Two independent failure domains. The
 * map is the page's subject and must not be taken down by a studio bug; the
 * studio must not be taken down by a snapshot that failed to load. Neither
 * imports the other, and the section stays hidden until this module has
 * finished wiring it, so a throw before that leaves markup that says what the
 * studio is rather than controls that do nothing.
 *
 * THE LOCAL CLAIM, AND WHAT MAKES IT CHECKABLE. The page says the import
 * happens in the tab. That sentence is only worth printing if it is true under
 * a network capture, so the import path here calls `fetch` nowhere:
 *
 *   - `./library.json` and `./library-free.json` are fetched, and only when
 *     the visitor opens the library or asks for a free bundle. Neither is on
 *     the import path.
 *   - `/api/lead` is fetched, and only when the visitor submits the form for a
 *     locked template.
 *
 * Those are the only three URLs in this file, `tests/studio.test.mjs` asserts
 * that by reading this source, and none of them is reachable from dropping a
 * folder. A capture taken across an import is empty.
 */

import { computeCity } from './layout.mjs';
import { renderCity, attachCamera, refreshNamePlates, NAME_POOL } from './city-view.mjs';
import { importFiles, findRoot, classify, IMPORT_LIMITS } from './lib/import.mjs';
import {
  buildBundle, bundleFromEcosystem, bundleZip, validateBundle, normaliseSkillName,
} from './lib/export.mjs';
import { readZipAsText } from './lib/zip.mjs';
import { parseFrontmatter } from './src/extract.mjs';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const plural = (n, one, many) => (n === 1 ? one : many);

// ---------------------------------------------------------------- state ---

/**
 * What is on the stage, and where it came from.
 *
 * `bodies` is the whole reason an export of an imported ecosystem is worth
 * anything: the snapshot shape carries frontmatter and no charter prose, so
 * without the original text a round trip would hand back empty charters. The
 * texts stay here, in this tab, and are handed to `bundleFromEcosystem`.
 */
const stage = {
  kind: null,        // 'import' | 'template'
  title: '',
  ecosystem: null,
  bodies: null,      // for an import
  template: null,    // for a template: the preview record
  free: null,        // for a free template: the full record with bodies
  scene: null,
};

let libraryIndex = null;   // { catalog, cities }
let libraryFree = null;    // { free }

// --------------------------------------------------------------- the map ---

function drawStage(ecosystem, title) {
  const frame = $('studio-map-frame');
  $('studio-empty').hidden = true;
  frame.hidden = false;
  $('studio-stage-title').textContent = title;

  // A FRESH svg node every time, not the same one redrawn.
  //
  // `renderCity` clears the element's children but `attachCamera` binds nine
  // pointer listeners to the element itself, and the camera group it drives is
  // a new node on every render. Reusing the element would stack a dead
  // listener set per draw and leave the first one moving a group that is no
  // longer in the document. A shallow clone keeps id, role, tabindex and the
  // label, and takes no listeners with it.
  const old = $('studio-map');
  const svg = old.cloneNode(false);
  old.replaceWith(svg);

  const city = computeCity(
    ecosystem.divisions, ecosystem.agents, ecosystem.edges,
    ecosystem.skills, ecosystem.unreachable, ecosystem.guilds,
  );
  const scene = renderCity({ svg, data: ecosystem, city, workforce: null, idPrefix: 'studio-' });
  stage.scene = scene;

  const cam = attachCamera(svg, scene.camera, {
    onZoom: (k) => {
      svg.classList.toggle('lod-1', k >= 1.5);
      scene.zoom = k;
    },
  });

  // The whole city, every time. The hero map picks a frame by container size
  // because it is showing 59 citizens on a phone; this one is showing a
  // template of four or somebody's own tree, and the useful first view of
  // either is all of it.
  function fit() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    scene.setFrame(scene.view, { width: r.width, height: r.height });
    cam.reset();
    nameThem(scene);
  }
  fit();

  $('studio-zoom-in').onclick = () => cam.zoomIn();
  $('studio-zoom-out').onclick = () => cam.zoomOut();
  $('studio-reset').onclick = () => fit();
  return fit;
}

/**
 * Name everybody the pool can hold.
 *
 * The hero map rations plates because 59 citizens at once was a pile of white
 * boxes; a template is four people and an import is somebody looking for their
 * own names, so here the whole roster is offered in one tier and the placement
 * pass drops whatever will not fit. Nobody is hidden by a rule: the members
 * list beside the map names every one of them as text.
 */
function nameThem(scene) {
  const ids = [...scene.citizenEls.keys()].slice(0, NAME_POOL);
  refreshNamePlates(scene, { directors: [], anchors: [], others: ids }, scene.citizenEls);
}

let refit = null;
window.addEventListener('resize', () => { if (refit) refit(); });

/**
 * Stacked layouts put the stage below a list the visitor has to scroll past.
 *
 * On a phone the rail is the whole screen, so tapping a template changed
 * something that was entirely off screen and read as nothing happening. The
 * scroll is a response to a state change the visitor just caused, which is the
 * one thing motion is allowed to do here, and it is instant rather than
 * smoothed so it carries no animation at all.
 */
function revealStage() {
  if (window.matchMedia('(min-width: 1024px)').matches) return;
  const frame = $('studio-map-frame');
  if (frame && !frame.hidden) frame.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

function putOnStage(ecosystem, title) {
  refit = drawStage(ecosystem, title);
  revealStage();
}

// ---------------------------------------------------------------- import ---

/**
 * The gate on what is read at all.
 *
 * Only markdown, because only markdown can be a charter: `agents/<name>.md`
 * and `skills/<name>/SKILL.md` are the two shapes `classify` recognises, and
 * `ECOSYSTEM.md` is the third file that matters. Reading a visitor's PNGs and
 * shell scripts into memory to hand them to a parser that will ignore them is
 * work nobody asked for on files nobody offered.
 */
const isCharterCandidate = (path) => /\.md$/i.test(path);

const MAX_READ = IMPORT_LIMITS.maxFiles;

/** Walk a File System Access API directory handle. Chromium today. */
async function readDirectoryHandle(handle, onCount) {
  const files = [];
  let looked = 0;
  async function walk(dir, prefix) {
    for await (const [name, child] of dir.entries()) {
      if (files.length >= MAX_READ) return;
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        await walk(child, path);
      } else {
        looked += 1;
        if (!isCharterCandidate(path)) continue;
        const file = await child.getFile();
        files.push({ path, text: await file.text() });
        onCount(files.length, looked);
      }
    }
  }
  await walk(handle, handle.name || '');
  return { files, looked };
}

/** Walk a dropped directory entry. The path every browser still supports. */
async function readDirectoryEntry(entry, onCount) {
  const files = [];
  let looked = 0;
  async function readEntries(reader) {
    const out = [];
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      out.push(...batch);
    }
    return out;
  }
  async function walk(dirEntry) {
    const entries = await readEntries(dirEntry.createReader());
    for (const child of entries) {
      if (files.length >= MAX_READ) return;
      if (child.isDirectory) {
        await walk(child);
      } else {
        looked += 1;
        const path = child.fullPath.replace(/^\//, '');
        if (!isCharterCandidate(path)) continue;
        const file = await new Promise((res, rej) => child.file(res, rej));
        files.push({ path, text: await file.text() });
        onCount(files.length, looked);
      }
    }
  }
  await walk(entry);
  return { files, looked };
}

/** A `<input webkitdirectory>` FileList. The fallback that works everywhere. */
async function readFileList(list, onCount) {
  const files = [];
  let looked = 0;
  for (const file of list) {
    if (files.length >= MAX_READ) break;
    looked += 1;
    const path = file.webkitRelativePath || file.name;
    if (!isCharterCandidate(path)) continue;
    files.push({ path, text: await file.text() });
    onCount(files.length, looked);
  }
  return { files, looked };
}

/**
 * The charter bodies, keyed the way `bundleFromEcosystem` wants them.
 *
 * This reuses `findRoot` and `classify` from the importer rather than deciding
 * again what an agent file is. The id has to come from the frontmatter when it
 * is there, because that is where the importer got it, and a body filed under
 * the filename would silently miss every charter whose `name` differs from its
 * file.
 */
function collectBodies(files) {
  const root = findRoot(files.map((f) => f.path)).length;
  const bodies = {};
  for (const file of files) {
    const seg = String(file.path).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
    const hit = classify(seg.slice(root));
    if (!hit || hit.kind === 'constitution') continue;
    let data = {};
    let body = '';
    try {
      ({ data, body } = parseFrontmatter(file.text));
    } catch {
      continue;
    }
    const id = String(data.name ?? '').trim() || hit.stem.trim();
    if (!id) continue;
    bodies[`${hit.kind === 'agent' ? 'agents' : 'skills'}/${id}`] = body;
  }
  return bodies;
}

function setImportStatus(text) {
  $('studio-import-status').textContent = text;
}

function renderReport(report, ecosystem) {
  const box = $('studio-report');
  const stats = $('studio-report-stats');
  clear(stats);
  // The shape of the ecosystem, and nothing about the read. The file counts
  // live in the status line above, stated once: a card labelled "Files read"
  // beside a sentence saying "41,023 files seen" is two true numbers that look
  // like a contradiction, which is the failure this whole page is about.
  const rows = [
    ['Citizens', ecosystem.stats.agents],
    ['Skills', ecosystem.stats.skills],
    ['Districts', ecosystem.stats.divisions],
    ['Guilds', ecosystem.stats.guilds],
    ['Roads', ecosystem.stats.edges],
    ['Unreachable', ecosystem.stats.unreachable],
  ];
  for (const [k, v] of rows) {
    stats.append(el('div', {}, [el('dt', {}, [k]), el('dd', {}, [String(v)])]));
  }

  const skipped = [...report.skipped, ...report.duplicates.map((d) => ({
    path: d.path, reason: `a second ${d.kind} called ${d.id}`,
  }))];
  const detail = $('studio-report-detail');
  const list = $('studio-skipped');
  clear(list);
  if (skipped.length) {
    detail.hidden = false;
    $('studio-skipped-count').textContent = `(${skipped.length})`;
    for (const s of skipped.slice(0, 200)) {
      list.append(el('li', {}, [el('code', {}, [s.path]), ` ${s.reason}`]));
    }
    if (skipped.length > 200) {
      list.append(el('li', {}, [`and ${skipped.length - 200} more`]));
    }
  } else {
    detail.hidden = true;
  }

  const notes = $('studio-report-notes');
  clear(notes);
  const all = [...report.notes];
  if (report.truncated) all.unshift(report.truncated);
  for (const n of all) notes.append(el('li', {}, [n]));

  box.hidden = false;
}

async function runImport(reader, label) {
  setImportStatus(`Reading ${label}`);
  $('studio-report').hidden = true;
  let result;
  try {
    result = await reader((kept, looked) => {
      // A real count of real files, updated as they are read. Not a spinner,
      // not a bar with an invented percentage: the only honest progress signal
      // available here is how many files have actually been opened.
      if (kept % 25 === 0) setImportStatus(`Reading ${label}: ${looked} files seen, ${kept} read`);
    });
  } catch (err) {
    setImportStatus(`That could not be read: ${err && err.message ? err.message : 'unknown error'}`);
    return;
  }

  const { files, looked } = result;
  if (!files.length) {
    setImportStatus(
      `${looked} ${plural(looked, 'file', 'files')} seen and none of them was markdown. ` +
      'This reads agents/*.md and skills/<name>/SKILL.md, so point it at a .claude directory.',
    );
    return;
  }

  const { ecosystem, report } = importFiles(files, { source: 'directory' });
  finishImport(ecosystem, report, files, looked);
}

function finishImport(ecosystem, report, files, looked) {
  stage.kind = 'import';
  stage.title = 'Your ecosystem';
  stage.ecosystem = ecosystem;
  stage.bodies = files ? collectBodies(files) : {};
  stage.template = null;
  stage.free = null;

  // The whole funnel, in order, because each number answers a different
  // question: how big is the tree, how much of it could be a charter, how much
  // of that was one, and what was dropped. Run against this machine's real
  // ~/.claude those are 41,024 / 4,937 / 775 / 479.
  //
  // `dropped` counts unreadable files AND duplicate ids together, because the
  // disclosure below lists both and a headline of 26 over a list of 479 is the
  // exact defect this page exists to complain about. Which of the two each row
  // is is stated on the row.
  const dropped = report.skipped.length + report.duplicates.length;
  const seen = looked == null ? report.filesSeen : looked;
  setImportStatus(
    `${seen} ${plural(seen, 'file', 'files')} seen, ${report.filesSeen} read, ` +
    `${report.charterFiles} ${plural(report.charterFiles, 'charter', 'charters')}, ` +
    `${dropped} dropped. Parsed here; nothing was sent.`,
  );
  renderReport(report, ecosystem);

  if (ecosystem.stats.agents === 0 && ecosystem.stats.skills === 0) {
    $('studio-map-frame').hidden = true;
    $('studio-empty').hidden = false;
    $('studio-empty').textContent = 'Nothing in there looked like a charter, so there is no city to draw.';
    $('studio-actions').hidden = true;
    return;
  }

  putOnStage(ecosystem, 'Your ecosystem');
  // What is ON THE STAGE, not what the download will contain. The export can
  // still leave a member out if the specification refuses it, and it says so
  // when it does; promising the count here would make that correction look
  // like a contradiction.
  showDownload(
    `${ecosystem.stats.agents} ${plural(ecosystem.stats.agents, 'charter', 'charters')} and ` +
    `${ecosystem.stats.skills} ${plural(ecosystem.stats.skills, 'skill', 'skills')} on the stage`,
    'The bundle is written in this tab from the files you chose.',
  );
}

function showDownload(summary, note) {
  $('studio-gate').hidden = true;
  $('studio-actions').hidden = false;
  $('studio-summary').textContent = summary;
  $('studio-download').hidden = false;
  $('studio-download-note').textContent = note;
}

// --------------------------------------------------------------- library ---

async function loadLibraryIndex() {
  if (libraryIndex) return libraryIndex;
  const res = await fetch('./library.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  libraryIndex = await res.json();
  return libraryIndex;
}

async function loadLibraryFree() {
  if (libraryFree) return libraryFree;
  const res = await fetch('./library-free.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  libraryFree = await res.json();
  return libraryFree;
}

function templateCard(t) {
  const chip = el('span', { class: t.locked ? 'tag tag-locked' : 'tag tag-free' },
    [t.locked ? 'Locked' : 'Free']);
  const counts = el('span', { class: 'studio-card-counts' }, [
    `${t.counts.agents} ${plural(t.counts.agents, 'agent', 'agents')}`,
    ' · ',
    `${t.counts.skills} ${plural(t.counts.skills, 'skill', 'skills')}`,
  ]);
  const button = el('button', {
    type: 'button', class: 'studio-card', 'data-id': t.id, 'aria-pressed': 'false',
  }, [
    el('span', { class: 'studio-card-head' }, [el('strong', {}, [t.name]), chip]),
    el('span', { class: 'studio-card-niche' }, [t.niche]),
    counts,
  ]);
  button.addEventListener('click', () => selectTemplate(t.id));
  return el('li', {}, [button]);
}

function markSelected(id) {
  for (const b of document.querySelectorAll('.studio-card')) {
    b.setAttribute('aria-pressed', b.dataset.id === id ? 'true' : 'false');
  }
}

async function openLibrary() {
  const status = $('studio-library-status');
  const list = $('studio-templates');
  if (list.childElementCount) return;
  status.textContent = 'Loading the library';
  let index;
  try {
    index = await loadLibraryIndex();
  } catch (err) {
    status.textContent = `The library did not load: ${err.message}. Everything else on this page still works.`;
    return;
  }
  const free = index.catalog.filter((t) => !t.locked).length;
  status.textContent = `${index.catalog.length} templates, ${free} free.`;
  clear(list);
  for (const t of index.catalog) list.append(templateCard(t));
}

function renderTemplateDetail(t) {
  const box = $('studio-summary');
  clear(box);
  box.append(el('p', { class: 'studio-summary-text' }, [t.summary]));

  const members = el('ul', { class: 'studio-members' });
  for (const a of t.agents) {
    members.append(el('li', {}, [
      el('strong', {}, [a.id]),
      a.director ? el('span', { class: 'tag tag-director' }, ['Director']) : null,
      el('span', { class: 'studio-member-desc' }, [a.description]),
    ]));
  }
  for (const s of t.skills) {
    members.append(el('li', { class: 'studio-member-skill' }, [
      el('strong', {}, [s.name]),
      el('span', { class: 'studio-member-desc' }, [s.description]),
    ]));
  }
  const detail = el('details', { class: 'studio-members-detail' }, [
    el('summary', {}, [el('h3', {}, [
      `What is in it `,
      el('span', { class: 'static-count' }, [
        `(${t.counts.agents + t.counts.skills} ${plural(t.counts.agents + t.counts.skills, 'file', 'files')})`,
      ]),
    ])]),
    members,
  ]);
  box.append(detail);

  const why = el('ul', { class: 'studio-why' });
  for (const line of t.why) why.append(el('li', {}, [line]));
  box.append(why);
}

async function selectTemplate(id) {
  const index = await loadLibraryIndex();
  const t = index.catalog.find((x) => x.id === id);
  if (!t) return;
  markSelected(id);

  stage.kind = 'template';
  stage.title = t.name;
  stage.ecosystem = index.cities[id];
  stage.template = t;
  stage.bodies = null;
  stage.free = null;

  putOnStage(index.cities[id], t.name);
  $('studio-actions').hidden = false;
  renderTemplateDetail(t);

  if (t.locked) {
    $('studio-download').hidden = true;
    $('studio-download-note').textContent = '';
    const gate = $('studio-gate');
    gate.hidden = false;
    $('studio-gate-heading').textContent = `${t.name} is locked`;
    $('studio-gate-why').textContent = t.lockedReason || '';
    $('studio-gate-status').textContent = '';
    return;
  }

  $('studio-gate').hidden = true;
  $('studio-download').hidden = false;
  $('studio-download-note').textContent = 'MIT. Unzip into your Claude Code directory and it loads.';
}

// ---------------------------------------------------------------- export ---

/**
 * Hand the visitor the bytes.
 *
 * An object URL and a click on an anchor the page made. The zip was built in
 * this tab by `lib/zip.mjs`, so no server is involved in a download either.
 */
function offer(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  // Long enough for the download to have started, short enough not to hold
  // the bytes for the life of the tab.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function bundleName(title) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bundle';
  return `polis-${slug}.zip`;
}

/** Which skill directories `validateBundle` refused, from its own messages. */
function rejectedSkills(errors) {
  const out = new Set();
  for (const e of errors) {
    const m = /^skills\/([^/]+)\/SKILL\.md:/.exec(e);
    if (m) out.add(m[1]);
  }
  return out;
}

/**
 * Build, validate, and if one member is unusable, leave that one out.
 *
 * `validateBundle` is strict on purpose and a bundle that fails it will not
 * load where it lands. But refusing the whole download for one bad member is
 * the wrong trade, and it is not hypothetical: importing this machine's real
 * `~/.claude` produces 296 files, of which exactly one skill has an empty
 * description, which the Agent Skills specification requires. Refusing there
 * would cost a visitor 295 working files for one broken one.
 *
 * So the rule `lib/import.mjs` already applies on the way in applies on the
 * way out too: count it, drop it, name it, keep going. The bundle is rebuilt
 * WITHOUT the rejected member rather than having its file deleted, so the
 * README's listing still matches what is in the archive. If it still fails
 * after that, the download is refused, because at that point the failure is
 * not about one member.
 *
 * @param {(dropped: Set<string>) => object} make  builds the bundle, minus the
 *   named skills. Taking a builder rather than a bundle is what lets the
 *   second pass regenerate the README as well as the files.
 */
async function deliver(make, title, note) {
  let bundle = make(new Set());
  let verdict = validateBundle(bundle.files);
  let dropped = new Set();

  if (!verdict.ok) {
    dropped = rejectedSkills(verdict.errors);
    if (dropped.size) {
      bundle = make(dropped);
      verdict = validateBundle(bundle.files);
    }
  }
  if (!verdict.ok) {
    $('studio-download-note').textContent =
      `That bundle did not pass the skill specification, so it was not offered: ${verdict.errors[0]}`;
    return;
  }

  const bytes = await bundleZip(bundle.files);
  offer(bytes, bundleName(title));
  const kb = Math.max(1, Math.round(bytes.length / 1024));
  const left = dropped.size
    ? ` ${dropped.size} ${plural(dropped.size, 'skill', 'skills')} left out, because the specification requires a description and ${plural(dropped.size, 'it has', 'they have')} none: ${[...dropped].join(', ')}.`
    : '';
  const warned = bundle.warnings.length
    ? ` ${bundle.warnings.length} ${plural(bundle.warnings.length, 'note', 'notes')}: ${bundle.warnings[0]}`
    : '';
  $('studio-download-note').textContent =
    `${bundle.files.length} files, ${kb} KB. ${note}${left}${warned}`;
}

async function downloadStage() {
  const note = $('studio-download-note');
  try {
    if (stage.kind === 'import') {
      const eco = stage.ecosystem;
      const bodies = stage.bodies;
      await deliver(
        (out) => bundleFromEcosystem(
          { ...eco, skills: eco.skills.filter((s) => !out.has(normaliseSkillName(s.id).name)) },
          {
            bodies,
            title: 'Your ecosystem',
            summary: 'Exported by polis from the files you dropped, in your own browser.',
          },
        ),
        'your-ecosystem',
        'Built from your own files.',
      );
      return;
    }
    if (stage.kind === 'template' && stage.template && !stage.template.locked) {
      const lib = await loadLibraryFree();
      const full = lib.free[stage.template.id];
      if (!full) {
        note.textContent = 'That template is not in the free set.';
        return;
      }
      await deliver(
        (out) => buildBundle({
          title: full.name,
          summary: full.summary,
          agents: full.agents,
          skills: full.skills.filter((s) => !out.has(normaliseSkillName(s.name).name)),
        }),
        full.id,
        'Free and complete. Nothing was held back from it.',
      );
      return;
    }
    note.textContent = 'There is nothing on the stage to export yet.';
  } catch (err) {
    note.textContent = `That did not build: ${err && err.message ? err.message : 'unknown error'}`;
  }
}

// ------------------------------------------------------------------ gate ---

/**
 * Every refusal `lib/lead.mjs` can return, in the visitor's words.
 *
 * The ladder's whole design is that it never reports a send that did not
 * happen, and that is only worth anything if the page passes the refusal
 * through instead of showing a tick. `not-configured` in particular is the
 * honest state of this deployment until the mail values are set.
 */
const REFUSALS = {
  method: 'The request was refused.',
  origin: 'The server refused this page as an origin. The site URL is not configured on the deployment yet.',
  'unsupported-type': 'The request was refused.',
  'too-large': 'That message is too long to send.',
  malformed: 'The request could not be read.',
  invalid: 'Check the name and email and try again.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  frozen: 'The form is switched off right now.',
  'not-configured': 'No mail is configured on this deployment, so nothing was sent. Nothing was queued either.',
  unavailable: 'The mail service did not answer, so nothing was sent.',
};

async function submitGate(ev) {
  ev.preventDefault();
  const status = $('studio-gate-status');
  const submit = $('studio-gate-submit');
  const t = stage.template;
  if (!t || !t.locked) return;

  const payload = {
    name: $('studio-lead-name').value,
    email: $('studio-lead-email').value,
    message: $('studio-lead-message').value,
    botcheck: $('studio-lead-botcheck').value,
    source: 'polis-studio',
    template: t.id,
  };
  if (!payload.name.trim() || !payload.email.trim()) {
    status.textContent = 'A name and an email, and it goes.';
    return;
  }

  submit.disabled = true;
  status.textContent = 'Sending';
  let res;
  let body = null;
  try {
    res = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    body = await res.json().catch(() => null);
  } catch (err) {
    submit.disabled = false;
    status.textContent = `That did not send: ${err && err.message ? err.message : 'the request failed'}. Nothing was queued.`;
    return;
  }
  submit.disabled = false;

  if (!body || body.ok !== true) {
    const reason = body && body.reason ? body.reason : `HTTP ${res.status}`;
    status.textContent = REFUSALS[reason] || `That did not send (${reason}). Nothing was queued.`;
    return;
  }

  if (!body.template) {
    status.textContent = 'Sent. The template did not come back with it, so there is nothing to download here yet.';
    return;
  }

  status.textContent = 'Sent. Building the bundle.';
  try {
    const verdict = validateBundle(body.template.files);
    if (!verdict.ok) {
      status.textContent = `Sent, but the bundle did not pass its own check: ${verdict.errors[0]}`;
      return;
    }
    const bytes = await bundleZip(body.template.files);
    offer(bytes, bundleName(body.template.id));
    status.textContent = `Sent, and ${body.template.name} is downloading.`;
  } catch (err) {
    status.textContent = `Sent, but the bundle did not build: ${err && err.message ? err.message : 'unknown error'}`;
  }
}

// ------------------------------------------------------------------ tabs ---

function showTab(which, focus = false) {
  const importTab = $('studio-tab-import');
  const libraryTab = $('studio-tab-library');
  const on = which === 'library';
  libraryTab.setAttribute('aria-selected', String(on));
  importTab.setAttribute('aria-selected', String(!on));
  libraryTab.tabIndex = on ? 0 : -1;
  importTab.tabIndex = on ? -1 : 0;
  $('studio-panel-library').hidden = !on;
  $('studio-panel-import').hidden = on;
  if (focus) (on ? libraryTab : importTab).focus();
  if (on) openLibrary();
}

/**
 * Arrow keys, because a roving tabindex without them is a tab you cannot reach.
 *
 * The unselected tab carries `tabindex="-1"`, which is the ARIA tabs pattern
 * and is correct only when the arrow keys move between them. Without this, a
 * keyboard visitor could Tab to the selected tab and had no way at all to
 * reach the other one, which is WCAG 2.1.1 failing quietly.
 */
function wireTabKeys() {
  const tabs = [$('studio-tab-import'), $('studio-tab-library')];
  for (const tab of tabs) {
    tab.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(tab);
      let next = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % tabs.length;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i + tabs.length - 1) % tabs.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      ev.preventDefault();
      showTab(next === 1 ? 'library' : 'import', true);
    });
  }
}

// ------------------------------------------------------------------ wire ---

function wireImportControls() {
  const dirInput = $('studio-input-dir');
  const zipInput = $('studio-input-zip');

  $('studio-pick-folder').addEventListener('click', async () => {
    // The File System Access API where it exists, because it reads a real
    // directory handle without copying the tree through a form control. The
    // input is the fallback and does the same job everywhere else.
    if (typeof window.showDirectoryPicker === 'function') {
      let handle;
      try {
        handle = await window.showDirectoryPicker({ id: 'polis-claude', mode: 'read' });
      } catch {
        return; // the visitor cancelled; that is not an error
      }
      await runImport((onCount) => readDirectoryHandle(handle, onCount), handle.name || 'that folder');
      return;
    }
    dirInput.click();
  });

  $('studio-pick-zip').addEventListener('click', () => zipInput.click());

  dirInput.addEventListener('change', async () => {
    if (!dirInput.files || !dirInput.files.length) return;
    const name = dirInput.files[0].webkitRelativePath?.split('/')[0] || 'that folder';
    await runImport((onCount) => readFileList(dirInput.files, onCount), name);
    dirInput.value = '';
  });

  zipInput.addEventListener('change', async () => {
    const file = zipInput.files && zipInput.files[0];
    if (!file) return;
    await importZipFile(file);
    zipInput.value = '';
  });
}

/**
 * A zip, opened once.
 *
 * `lib/import.mjs` exports `importZip`, which is the same two calls made
 * below. It is not used here because it returns the ecosystem and drops the
 * file texts, and the texts are what a round trip needs: without them an
 * exported charter would carry frontmatter and a line saying its prose was
 * not captured. Opening the archive once and keeping what came out costs
 * nothing and gives the zip path the same export as the folder path.
 */
async function importZipFile(file) {
  setImportStatus(`Opening ${file.name}`);
  try {
    const { files, skipped } = await readZipAsText(await file.arrayBuffer());
    const { ecosystem, report } = importFiles(files, { source: 'zip' });
    for (const s of skipped) report.skipped.push({ path: s.name, reason: s.reason });
    report.filesSeen = files.length + skipped.length;
    finishImport(ecosystem, report, files, report.filesSeen);
  } catch (err) {
    setImportStatus(`That zip could not be opened: ${err && err.message ? err.message : 'unknown error'}`);
  }
}

function wireDropZone() {
  const drop = $('studio-drop');
  const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };

  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (ev) => { stop(ev); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (ev) => { stop(ev); drop.classList.remove('over'); });
  }

  drop.addEventListener('drop', async (ev) => {
    const items = ev.dataTransfer ? [...ev.dataTransfer.items] : [];
    const entries = items
      .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
      .filter(Boolean);

    const dir = entries.find((e) => e.isDirectory);
    if (dir) {
      await runImport((onCount) => readDirectoryEntry(dir, onCount), dir.name);
      return;
    }
    const files = ev.dataTransfer ? [...ev.dataTransfer.files] : [];
    const zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      await importZipFile(zip);
      return;
    }
    if (files.length) {
      await runImport((onCount) => readFileList(files, onCount), `${files.length} files`);
      return;
    }
    setImportStatus('Nothing usable was dropped. A .claude folder, or a zip of one.');
  });
}

function main() {
  const shell = $('studio-shell');
  if (!shell) return;

  wireImportControls();
  wireDropZone();
  $('studio-download').addEventListener('click', downloadStage);
  $('studio-gate').addEventListener('submit', submitGate);
  $('studio-tab-import').addEventListener('click', () => showTab('import'));
  $('studio-tab-library').addEventListener('click', () => showTab('library'));
  wireTabKeys();

  // Only now: every control above is live, so the section can be shown without
  // a window in which a button does nothing.
  shell.hidden = false;
}

main();
