/**
 * Polis — the interactive layer.
 *
 * Everything here is progressive enhancement over the static markup already
 * in index.html. If this file throws before it finishes, or `ecosystem.json`
 * fails to load, the JS-only sections simply stay `hidden` and the always-
 * visible static roster (and the static status board, which never depends
 * on JS at all) remain exactly what a visitor sees. Nothing here fabricates
 * a number: every count, id, and label comes straight from the fetched
 * `ecosystem.json` and `workforce.json`, the same files the static markup
 * was authored from.
 */

import { computeCity } from './layout.mjs';
import { renderCity, attachCamera, refreshNamePlates, computeFocusFrame, NAME_POOL } from './city-view.mjs';
import { walkerPairs, isDark, darkHalfCounts, nextHops } from './life.mjs';
import { createWalkers } from './walkers.mjs';

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

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pushMap(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}

// ---------------------------------------------------------------- theme ---

const THEME_KEY = 'polis-theme';

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.textContent = `Theme: ${theme}`;
    btn.setAttribute('aria-label', `Theme: ${theme}. Activate to cycle system, light, dark.`);
  }
}

function initTheme() {
  applyTheme(readStoredTheme());
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(readStoredTheme()) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode etc — theme just won't persist */ }
    applyTheme(next);
  });
}

initTheme();

// ------------------------------------------------------------ skills UI ---

function initSkillsFilter() {
  const box = document.getElementById('skills-search-box');
  const input = document.getElementById('skills-q');
  const summary = document.getElementById('skills-filter-summary');
  const items = Array.from(document.querySelectorAll('#skills-list > .static-skill'));
  if (!box || !input || !summary || !items.length) return;

  function apply() {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      const match = !q || li.textContent.toLowerCase().includes(q);
      li.hidden = !match;
      if (match) shown += 1;
    }
    summary.textContent = `Showing ${shown} of ${items.length} skills.`;
  }

  input.addEventListener('input', apply);
  box.hidden = false;
  apply();
}

initSkillsFilter();

// -------------------------------------------------------------- main app ---

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  let data;
  try {
    data = await loadJson('./ecosystem.json');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('polis: could not load ecosystem.json — the static roster below is the full page.', err);
    return;
  }
  // Telemetry is optional: without it the city stands still and every
  // window is dark, which is the honest rendering of "no activity known".
  let workforce = null;
  try {
    workforce = await loadJson('./workforce.json');
  } catch {
    workforce = null;
  }

  const byId = new Map(data.agents.map((a) => [a.id, a]));
  const downstream = new Map();
  const upstream = new Map();
  const adjacency = new Map();
  for (const e of data.edges) {
    pushMap(downstream, e.from, e.to);
    pushMap(upstream, e.to, e.from);
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set());
    if (!adjacency.has(e.to)) adjacency.set(e.to, new Set());
    adjacency.get(e.from).add(e.to);
    adjacency.get(e.to).add(e.from);
  }
  const unreachableSet = new Set(data.unreachable);
  const neighborsOf = (id) => adjacency.get(id) || new Set();

  const city = computeCity(
    data.divisions, data.agents, data.edges, data.skills, data.unreachable, data.guilds,
  );

  const svg = document.getElementById('city-map');
  let hoverId = null;
  let selectedId = null;
  let lastFocusedEl = null;
  // The dark half is a MODE, not a selection: it stays on while you click
  // around inside it, and a selection temporarily takes over the highlight
  // because a citizen's own connections are the next move either way.
  let darkHalf = false;
  // The partnership being followed, when the visitor clicked a walker.
  let following = null;

  const scene = renderCity({
    svg,
    data,
    city,
    workforce,
    onSelect: (id) => selectCitizen(id),
  });
  const { camera, citizenEls, roadEls, figures, buildingsById, activities } = scene;

  // The dark half, computed once from the same two fields the map drew with:
  // `activityOf`'s dormant branch (no dispatch record at all) and the
  // snapshot's `unreachable` list. One predicate, no second source of truth.
  const activityOfId = (id) => activities.get(id) || 'dormant';
  const isUnreachable = (id) => unreachableSet.has(id);
  const darkIds = new Set(
    [...citizenEls.keys()].filter((id) => isDark(activityOfId(id), isUnreachable(id))),
  );
  const darkCounts = darkHalfCounts([...citizenEls.keys()], activityOfId, isUnreachable);

  // Who worked alongside whom, from telemetry. Both ends must be citizens on
  // this map; general-purpose is tooling, not a citizen, and never appears.
  const pairs = walkerPairs((workforce && workforce.collaborations) || [], buildingsById, byId);
  const crew = new Map();
  for (const p of pairs) {
    if (!crew.has(p.a)) crew.set(p.a, new Set());
    if (!crew.has(p.b)) crew.set(p.b, new Set());
    crew.get(p.a).add(p.b);
    crew.get(p.b).add(p.a);
  }
  const crewOf = (id) => crew.get(id) || new Set();
  const wfById = new Map(((workforce && workforce.agents) || []).map((a) => [a.id, a]));

  for (const [id, g] of citizenEls) {
    g.addEventListener('mouseenter', () => { hoverId = id; refreshHighlight(); });
    g.addEventListener('mouseleave', () => { hoverId = null; refreshHighlight(); });
    g.addEventListener('focus', () => { hoverId = id; refreshHighlight(); });
    g.addEventListener('blur', () => { hoverId = null; refreshHighlight(); });
  }

  const cam = attachCamera(svg, camera, {
    // Two LODs, rendered once, toggled by one class on the root.
    onZoom: (k, view) => {
      svg.classList.toggle('lod-1', k >= 1.5);
      // What is actually on screen, in world units: the frame, undone by the
      // camera transform. Labels for anything outside it are switched off.
      const f = scene.frame;
      if (f) {
        scene.cullLabels({
          x: (f.x - view.x) / k, y: (f.y - view.y) / k, w: f.w / k, h: f.h / k,
        });
      }
    },
  });

  // ---- framing --------------------------------------------------------
  // The map is framed for the space it is actually given, not for the widest
  // screen anyone might have. A phone gets the plaza, a tablet gets the
  // plaza and its neighbours, a desktop gets the plan. Switching is a hard
  // cut — viewBox is not a transform and must never be tweened.
  const heroBox = svg.parentElement;
  let frameName = null;
  function applyFrame(force = false) {
    const r = heroBox.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const container = { width: r.width, height: r.height };
    const f = computeFocusFrame(city, container, scene.view);
    if (!force && f.name === frameName) return;
    frameName = f.name;
    scene.setFrame(f, container);
    cam.reset();
    refreshHighlight();
  }
  function showWholeCity() {
    const r = heroBox.getBoundingClientRect();
    frameName = 'city';
    scene.setFrame(scene.view, { width: r.width, height: r.height });
    cam.reset();
    refreshHighlight();
  }

  document.getElementById('map-zoom-in')?.addEventListener('click', () => cam.zoomIn());
  document.getElementById('map-zoom-out')?.addEventListener('click', () => cam.zoomOut());
  document.getElementById('map-reset')?.addEventListener('click', () => applyFrame(true));
  document.getElementById('map-whole-city')?.addEventListener('click', showWholeCity);
  const roadsToggle = document.getElementById('map-roads');
  roadsToggle?.addEventListener('change', () => {
    svg.classList.toggle('roads-on', roadsToggle.checked);
  });

  // ---- the dark half ----------------------------------------------------
  // The single most shareable fact about this ecosystem is how much of it
  // never runs. As a sentence it is read once and forgotten; as a place it
  // is somewhere you can stand. One button, one predicate, no new geometry:
  // everybody who has ever been called goes to the same 0.22 the existing
  // highlight already uses, and the ones nobody calls are all that is left.
  const darkToggle = document.getElementById('map-dark-half');
  const darkNote = document.getElementById('map-dark-note');
  const darkSentence = `${darkCounts.dark} of ${darkCounts.total} citizens are dark: `
    + `${darkCounts.never} have never been dispatched, ${darkCounts.unnamed} are named by no charter`
    + `${darkCounts.both ? `, and ${darkCounts.both} are both` : ''}. `
    + `The other ${darkCounts.lit} are the city you normally see.`;
  if (darkNote) darkNote.textContent = darkSentence;
  function setDarkHalf(on, refresh = true) {
    darkHalf = on;
    svg.classList.toggle('dark-half', on);
    if (darkToggle) {
      darkToggle.setAttribute('aria-pressed', String(on));
      darkToggle.textContent = on ? 'Leave the dark half' : 'Show the dark half';
      darkToggle.setAttribute('aria-label', on
        ? 'Leave the dark half and show the whole city'
        : `Show the dark half: the ${darkCounts.never} citizens never dispatched and the ${darkCounts.unnamed} named by no charter`);
    }
    if (refresh) refreshHighlight();
  }
  darkToggle?.addEventListener('click', () => setDarkHalf(!darkHalf));
  // Labels only at boot: the first real highlight pass runs with applyFrame,
  // after the name-plate machinery below exists.
  if (darkToggle) setDarkHalf(false, false);

  // ---- life -----------------------------------------------------------------
  // Walkers are real collaboration pairs. They start unless the visitor asked
  // for reduced motion, and the toolbar toggle pauses everything that moves
  // (WCAG 2.2.2: moving content that starts automatically must be pausable).
  const walkers = createWalkers({
    svg,
    pairs,
    buildingsById,
    agentsById: byId,
    router: scene.router,
    buildLayer: scene.buildLayer,
    buildingOrder: scene.buildingOrder,
    walkLayer: scene.walkLayer,
    figures,
    // Concept 2: a walker mid-stride is the most alive thing on the map, and
    // until now it was the one thing you could not touch. Clicking it locks
    // the highlight to that live pair, keeps its own route lit under it, and
    // opens the panel on the partnership rather than on one of its two ends.
    // No camera motion — MOTION-SPEC §1 prohibition 7 rules out any move the
    // visitor did not drive, and the pair is already on screen by definition.
    onFollow: ({ pair, walkerId, hostId, sessions }) => {
      following = { walkerId, hostId, pair };
      selectCitizen(walkerId, { walkerId, hostId, sessions });
    },
    onFollowEnd: ({ walkerId, hostId }) => {
      if (!following || following.walkerId !== walkerId) return;
      following = null;
      if (panelWalk && !panelWalk.hidden) {
        panelWalk.textContent = `That walk has ended: ${walkerId} is home. `
          + `The partnership with ${hostId} is in the record below.`;
      }
      refreshHighlight();
    },
  });
  const lifeToggle = document.getElementById('map-life');
  const reduced = prefersReducedMotion();
  function setLife(on) {
    svg.classList.toggle('life-off', !on);
    if (on) { if (walkers.running) walkers.resume(); else walkers.start(); } else walkers.pause();
  }
  if (lifeToggle) {
    lifeToggle.checked = !reduced;
    lifeToggle.addEventListener('change', () => setLife(lifeToggle.checked));
  }
  if (!reduced) {
    walkers.start();
  } else {
    svg.classList.add('life-off');
  }
  const lifeNote = document.getElementById('map-life-note');
  if (lifeNote && workforce) {
    lifeNote.textContent = `${pairs.length} recorded partnerships walk the streets, twelve at a time; ` +
      `${[...wfById.values()].filter((a) => a.active && byId.has(a.id)).length} citizens were dispatched in the last ${workforce.activeHours} hours and have their lights on.`;
  }

  // ---- legend -----------------------------------------------------------
  // Generated from the same plan the map draws, so a precinct can never
  // appear on one and not the other.
  const legend = document.getElementById('map-legend');
  if (legend) {
    legend.textContent = '';
    const swatchFor = (p) => (p.kind === 'district' ? `hue-${p.number}`
      : p.kind === 'guild' ? `hue-guild-${p.key.replace('__guild__', '').replace(/-guild$/, '')}`
        : p.kind === 'archive' ? 'hue-skill' : p.key === '__system__' ? 'hue-system' : 'hue-none');
    for (const p of city.plots.values()) {
      legend.appendChild(el('li', {}, [
        el('span', { class: `swatch ${swatchFor(p)}` }),
        `${p.label} (${p.count})`,
      ]));
    }
  }

  // ---- name plates ----------------------------------------------------
  // Priority order IS placement order, and city-view runs the single pass:
  // precinct plates are already down and immovable, directors are named next
  // and never dropped, then whoever is being looked at, then their
  // neighbours. A citizen name that cannot find clear space is not drawn this
  // frame rather than printed over something else — the roster below and the
  // panel are the complete record either way.
  const directorIds = data.agents.filter((a) => a.director).map((a) => a.id).sort();
  function refreshPlates(anchors, neighbors) {
    const taken = new Set(directorIds);
    const pick = [];
    for (const id of anchors) if (!taken.has(id)) { taken.add(id); pick.push(id); }
    const others = [];
    for (const id of [...neighbors].sort()) {
      if (taken.size + others.length >= NAME_POOL) break;
      if (!taken.has(id)) { taken.add(id); others.push(id); }
    }
    refreshNamePlates(scene, { directors: directorIds, anchors: pick, others }, citizenEls);
  }
  refreshPlates([], new Set());

  function refreshHighlight() {
    for (const g of citizenEls.values()) g.classList.remove('active', 'neighbor', 'crew', 'dimmed', 'dark');
    for (const f of figures.values()) f.classList.remove('crew');
    for (const r of roadEls) r.classList.remove('highlight', 'dimmed');
    // Following a walker locks BOTH ends of the live pair as anchors, so the
    // highlight belongs to the partnership rather than to one of the two
    // people in it. Everything else about the pass is unchanged.
    const anchors = [...new Set([
      hoverId, selectedId,
      ...(following ? [following.walkerId, following.hostId] : []),
    ].filter(Boolean))];
    svg.classList.toggle('has-focus', anchors.length > 0);
    if (!anchors.length) {
      // Nothing selected. If the dark half is on, THAT is the highlight: the
      // people nobody calls are lifted and everyone else recedes, using the
      // same two classes a hover already uses.
      if (darkHalf) {
        const lifted = [];
        for (const [id, g] of citizenEls) {
          if (darkIds.has(id)) { g.classList.add('dark'); lifted.push(id); } else g.classList.add('dimmed');
        }
        refreshPlates([], new Set(lifted));
        return;
      }
      refreshPlates([], new Set());
      return;
    }
    const activeSet = new Set(anchors);
    const neighborSet = new Set();
    const crewSet = new Set();
    for (const id of anchors) {
      for (const n of neighborsOf(id)) neighborSet.add(n);
      for (const c of crewOf(id)) crewSet.add(c);
    }
    for (const [id, g] of citizenEls) {
      if (activeSet.has(id)) g.classList.add('active');
      else if (neighborSet.has(id)) g.classList.add('neighbor');
      else if (crewSet.has(id)) g.classList.add('crew');
      else g.classList.add('dimmed');
      if (crewSet.has(id) && !activeSet.has(id)) figures.get(id)?.classList.add('crew');
    }
    for (const r of roadEls) {
      const { from, to } = r.dataset;
      if (activeSet.has(from) || activeSet.has(to)) r.classList.add('highlight');
      else r.classList.add('dimmed');
    }
    refreshPlates(anchors, new Set([...neighborSet, ...crewSet]));
  }

  // ---- citizen panel ------------------------------------------------------

  const panel = document.getElementById('citizen-panel');
  const panelHeading = document.getElementById('panel-heading');
  const panelDivision = document.getElementById('panel-division');
  const panelDesc = document.getElementById('panel-desc');
  const panelModel = document.getElementById('panel-model');
  const panelDirector = document.getElementById('panel-director');
  const panelUnreachable = document.getElementById('panel-unreachable');
  const panelActivity = document.getElementById('panel-activity');
  const panelTools = document.getElementById('panel-tools');
  const panelDownstream = document.getElementById('panel-downstream');
  const panelUpstream = document.getElementById('panel-upstream');
  const panelCrew = document.getElementById('panel-crew');
  const panelClose = document.getElementById('panel-close');
  const panelNextLead = document.getElementById('panel-next-lead');
  const panelHopsBlock = document.getElementById('panel-hops-block');
  const panelHopsLead = document.getElementById('panel-hops-lead');
  const panelHops = document.getElementById('panel-hops');
  const panelWalk = document.getElementById('panel-walk');

  function renderChips(container, values, emptyText) {
    container.textContent = '';
    if (!values.length) {
      container.appendChild(el('li', { class: 'panel-empty' }, [emptyText]));
      return;
    }
    for (const v of values) container.appendChild(el('li', {}, [v]));
  }

  /**
   * The next move, rendered as moves.
   *
   * These were already clickable and already correct; what they were not was
   * obviously the point of the panel. Each id is now a whole chip rather than
   * an underlined word inside one, and the members of the dark half say so in
   * words — never colour alone — so the two halves of this city stay legible
   * to each other from inside the record.
   */
  function renderCitizenLinks(container, ids, emptyText) {
    container.textContent = '';
    if (!ids.length) {
      container.appendChild(el('li', { class: 'panel-empty' }, [emptyText]));
      return;
    }
    for (const id of ids.slice().sort()) {
      const dark = isUnreachable(id) ? 'unnamed'
        : activityOfId(id) === 'dormant' ? 'never called' : null;
      const btn = el('button', { type: 'button', class: `link-button${dark ? ' is-dark' : ''}` }, [
        el('span', { class: 'chip-id' }, [id]),
        // A real space between the two spans: the flex gap separates them on
        // screen, but a screen reader reads the accessible name as one run of
        // text and would otherwise say "api-designernever called".
        dark ? ' ' : null,
        dark ? el('span', { class: 'chip-state' }, [dark]) : null,
      ]);
      btn.addEventListener('click', () => selectCitizen(id));
      container.appendChild(el('li', { class: dark ? 'is-dark' : '' }, [btn]));
    }
  }

  function activityText(id) {
    const rec = wfById.get(id);
    if (!workforce) return 'no telemetry loaded';
    if (!rec) return 'never dispatched in personal-world sessions';
    const when = rec.lastAt ? rec.lastAt.slice(0, 10) : 'unknown date';
    const projects = rec.projects.length;
    return `${rec.assignments} dispatch${rec.assignments === 1 ? '' : 'es'} across ${projects} project${projects === 1 ? '' : 's'}; last ${when}` +
      (rec.active ? ` — active in the last ${workforce.activeHours} hours` : '');
  }

  /**
   * The loop, closed (GAME-DESIGN §1).
   *
   * The fourth arrow — a reason to click again — was the missing one, and it
   * did not need new geometry: at the exact moment this panel opens, every
   * citizen this one works with is already lit on the map by
   * refreshHighlight(). All that was missing was saying so, and putting them
   * where the eye lands first. So the connected set is now the top of the
   * panel and the record is underneath it, and the count in the lead sentence
   * is the size of the set the map just lit — the same union, never a second
   * number with its own opinion.
   */
  function selectCitizen(id, walk = null) {
    const a = byId.get(id);
    if (!a) return;
    lastFocusedEl = document.activeElement;
    selectedId = id;
    hoverId = null;
    if (!walk) { following = null; walkers.unfollow?.(); }
    refreshHighlight();

    panelHeading.textContent = a.id;
    const roleBits = [];
    if (a.director) roleBits.push('Director');
    roleBits.push(a.division || (a.guild ? a.guild : a.system ? 'System utility' : 'No division declared'));
    if (unreachableSet.has(a.id)) roleBits.push('Unreachable — named by no one upstream or downstream');
    panelDivision.textContent = roleBits.join(' · ');
    panelDesc.textContent = a.description;
    panelModel.textContent = a.model || 'no fixed model';
    panelDirector.textContent = a.director ? 'Yes' : 'No';
    panelUnreachable.textContent = unreachableSet.has(a.id) ? 'Yes' : 'No';
    if (panelActivity) panelActivity.textContent = activityText(id);
    renderChips(panelTools, a.tools, 'none declared');
    const down = downstream.get(id) || [];
    const up = upstream.get(id) || [];
    const mates = [...crewOf(id)];
    renderCitizenLinks(panelDownstream, down, 'hands work to no one');
    renderCitizenLinks(panelUpstream, up, 'receives work from no one');
    if (panelCrew) {
      renderCitizenLinks(panelCrew, mates, workforce ? 'no recorded session shared with another citizen' : 'no telemetry loaded');
    }

    // Exactly the set refreshHighlight() just lit: charter neighbours plus
    // recorded crew. Counting it here rather than typing a number keeps the
    // sentence true when the snapshot changes.
    const connected = new Set([...down, ...up, ...mates]);
    if (panelNextLead) {
      panelNextLead.textContent = connected.size === 1
        ? `1 citizen is lit on the map right now — the one ${id} actually works with. Click it to keep going.`
        : connected.size
          ? `${connected.size} citizens are lit on the map right now — the ones ${id} actually works with. Click any of them to keep going.`
          : `Nobody is lit: no charter names ${id}, and no recorded session pairs them with anyone.`;
      panelNextLead.classList.toggle('is-empty', connected.size === 0);
    }

    // The dead-end rule (GAME-DESIGN §3): a stop is allowed to be a finding,
    // never an anticlimax. When the wiring and the telemetry are both empty,
    // the panel still owes one honest next hop, and says what makes it one.
    if (panelHopsBlock) {
      if (connected.size) {
        panelHopsBlock.hidden = true;
      } else {
        const hop = nextHops(a, data.agents, data.unreachable);
        panelHopsBlock.hidden = hop.kind === 'none';
        if (hop.kind !== 'none') {
          panelHopsLead.textContent = hop.kind === 'division'
            ? `Filed under ${hop.of} all the same. The others in that district:`
            : hop.kind === 'guild'
              ? `Filed under the ${hop.of} all the same. The others in that guild:`
              : 'The other citizens nobody names, who are in exactly this position:';
          renderCitizenLinks(panelHops, hop.ids, '');
        }
      }
    }

    // Follow-the-walker framing. "Right now" is a claim with a clock on it,
    // so it is only ever printed while the walk is actually running, and
    // onFollowEnd below takes the word back the moment it stops being true.
    if (panelWalk) {
      if (walk) {
        panelWalk.hidden = false;
        panelWalk.textContent = `On the street right now: ${walk.walkerId} is walking to ${walk.hostId}. `
          + `They were dispatched together in ${walk.sessions} recorded ${walk.sessions === 1 ? 'session' : 'sessions'}.`;
      } else {
        panelWalk.hidden = true;
        panelWalk.textContent = '';
      }
    }

    panel.hidden = false;
    panelHeading.focus();

    const rosterLi = rosterButtons.get(id);
    if (rosterLi) {
      // Selecting someone opens their district, or the mark would land on a
      // row inside a closed disclosure and read as nothing happening.
      rosterLi.closest('details')?.setAttribute('open', '');
      for (const b of document.querySelectorAll('.roster-agent-button.selected')) b.classList.remove('selected');
      rosterLi.querySelector('.roster-agent-button')?.classList.add('selected');
    }
  }

  function closePanel() {
    panel.hidden = true;
    selectedId = null;
    following = null;
    walkers.unfollow();
    refreshHighlight();
    for (const b of document.querySelectorAll('.roster-agent-button.selected')) b.classList.remove('selected');
    if (lastFocusedEl && document.body.contains(lastFocusedEl)) lastFocusedEl.focus();
  }

  panelClose.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !panel.hidden) closePanel();
  });

  // ---- interactive roster list --------------------------------------------

  const rosterButtons = new Map();
  const rosterDistricts = new Map();

  function rosterAgentLi(a) {
    const labelBits = [a.id];
    if (a.director) labelBits.push('[Director]');
    if (unreachableSet.has(a.id)) labelBits.push('[Unreachable]');
    const btn = el('button', { type: 'button', class: 'roster-agent-button' }, [
      labelBits.join(' '),
      el('span', { class: 'rab-desc' }, [truncate(a.description, 150)]),
    ]);
    btn.addEventListener('click', () => selectCitizen(a.id));
    const li = el('li', { class: 'roster-agent' }, [btn]);
    rosterButtons.set(a.id, li);
    return li;
  }

  // Same disclosure pattern as the no-JS roster: one browser-native
  // <details> per district, closed at rest. Nothing is removed from the DOM,
  // so a filter, a find-in-page or a selection can still reach every citizen.
  function buildRosterGroup(root, heading, note, members, noun = ['citizen', 'citizens']) {
    if (!members.length) return;
    const wrap = el('div', { class: 'roster-district' });
    const det = el('details');
    det.appendChild(el('summary', {}, [
      el('h3', {}, [`${heading} `, el('span', { class: 'roster-count' }, [`(${members.length} ${members.length === 1 ? noun[0] : noun[1]})`])]),
    ]));
    if (note) det.appendChild(el('p', { class: 'static-note' }, [note]));
    const ul = el('ul', { class: 'roster-agent-list' });
    for (const a of members) ul.appendChild(rosterAgentLi(a));
    det.appendChild(ul);
    wrap.appendChild(det);
    root.appendChild(wrap);
    rosterDistricts.set(heading, { wrap, det });
  }

  const rosterRoot = document.getElementById('roster-list');
  for (const d of data.divisions) {
    const key = `${d.number} ${d.name}`;
    const members = data.agents.filter((a) => a.division === key).sort((x, y) => x.id.localeCompare(y.id));
    buildRosterGroup(rosterRoot, `${d.number} · ${d.name}`, null, members);
  }
  for (const g of data.guilds || []) {
    const members = data.agents.filter((a) => a.guild === g).sort((x, y) => x.id.localeCompare(y.id));
    buildRosterGroup(rosterRoot, g, 'A field guild: outside the eight districts by constitutional design, and still part of the city.', members, ['specialist', 'specialists']);
  }
  const noDivisionMembers = data.agents.filter((a) => !a.division && !a.system && !a.guild).sort((x, y) => x.id.localeCompare(y.id));
  buildRosterGroup(rosterRoot, 'No division declared', "Not listed under any division in ECOSYSTEM.md's organization section.", noDivisionMembers);
  const systemMembers = data.agents.filter((a) => a.system).sort((x, y) => x.id.localeCompare(y.id));
  buildRosterGroup(rosterRoot, 'System utilities', 'Ship with Claude Code, sit in no division, and the constitution exempts them from the admission standard and the reciprocity rule.', systemMembers, ['utility', 'utilities']);

  // ---- filters --------------------------------------------------------

  const divisionSelect = document.getElementById('division-filter');
  for (const d of data.divisions) {
    divisionSelect.appendChild(el('option', { value: `${d.number} ${d.name}` }, [`${d.number} · ${d.name}`]));
  }
  for (const g of data.guilds || []) divisionSelect.appendChild(el('option', { value: `__guild__${g}` }, [g]));
  if (noDivisionMembers.length) divisionSelect.appendChild(el('option', { value: '__none__' }, ['No division declared']));
  if (systemMembers.length) divisionSelect.appendChild(el('option', { value: '__system__' }, ['System utilities']));

  const toolSelect = document.getElementById('tool-filter');
  const allTools = Array.from(new Set(data.agents.flatMap((a) => a.tools))).sort();
  for (const t of allTools) toolSelect.appendChild(el('option', { value: t }, [t]));

  const searchInput = document.getElementById('q');
  const directorCheckbox = document.getElementById('director-filter');
  const filterSummary = document.getElementById('filter-summary');

  function matchesDivisionFilter(a, value) {
    if (!value) return true;
    if (value === '__none__') return !a.division && !a.system && !a.guild;
    if (value === '__system__') return a.system;
    if (value.startsWith('__guild__')) return a.guild === value.slice('__guild__'.length);
    return a.division === value;
  }

  function applyFilters() {
    const q = searchInput.value.trim().toLowerCase();
    const div = divisionSelect.value;
    const tool = toolSelect.value;
    const directorsOnly = directorCheckbox.checked;
    let shown = 0;
    for (const a of data.agents) {
      const match = (!q || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
        && matchesDivisionFilter(a, div)
        && (!tool || a.tools.includes(tool))
        && (!directorsOnly || a.director);
      if (match) shown += 1;
      const g = citizenEls.get(a.id);
      if (g) g.classList.toggle('hidden-by-filter', !match);
      const li = rosterButtons.get(a.id);
      if (li) li.hidden = !match;
    }
    filterSummary.textContent = `Showing ${shown} of ${data.agents.length} citizens.`;
    // An active filter opens whatever it matched — collapsed-by-default is the
    // resting state, not a wall between a search and its results.
    const filtering = Boolean(q || div || tool || directorsOnly);
    for (const { wrap, det } of rosterDistricts.values()) {
      const anyVisible = Array.from(wrap.querySelectorAll('.roster-agent')).some((li) => !li.hidden);
      wrap.hidden = !anyVisible;
      det.open = filtering && anyVisible;
    }
  }

  searchInput.addEventListener('input', applyFilters);
  divisionSelect.addEventListener('change', applyFilters);
  toolSelect.addEventListener('change', applyFilters);
  directorCheckbox.addEventListener('change', applyFilters);
  document.getElementById('clear-filters').addEventListener('click', () => {
    searchInput.value = '';
    divisionSelect.value = '';
    toolSelect.value = '';
    directorCheckbox.checked = false;
    applyFilters();
  });
  document.getElementById('filter-form').addEventListener('submit', (ev) => ev.preventDefault());
  applyFilters();

  // ---- jump-to-citizen buttons in the static status board ----------------

  // Buttons in the findings list, and the anchor in the headline strip. The
  // strip's is an <a href="#static-…"> so it still reaches that citizen's
  // record with JavaScript off; here, where the map exists, it opens them on
  // the map instead of jumping to a roster that is now hidden.
  for (const btn of document.querySelectorAll('.jump-to-citizen')) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      selectCitizen(btn.dataset.id);
      panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // ---- reveal the interactive sections, retire the static fallback -------

  document.getElementById('filters-section').hidden = false;
  document.getElementById('map-section').hidden = false;
  document.getElementById('list-section').hidden = false;
  document.getElementById('static-roster-section').hidden = true;

  // Framing needs a laid-out box, so it runs once the hero is no longer
  // hidden, and again whenever the space the map is given crosses a band.
  applyFrame(true);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => applyFrame()).observe(heroBox);
  } else {
    window.addEventListener('resize', () => applyFrame());
  }

  // For tests and tooling: the live scene, never for the page itself.
  window.__polis = { scene, walkers, pairs, city, data, workforce };
}

main();
