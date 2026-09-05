/**
 * Polis — the interactive layer.
 *
 * Everything here is progressive enhancement over the static markup already
 * in index.html. If this file throws before it finishes, or `ecosystem.json`
 * fails to load, the JS-only sections simply stay `hidden` and the always-
 * visible static roster (and the static status board, which never depends
 * on JS at all) remain exactly what a visitor sees. Nothing here fabricates
 * a number: every count, id, and label comes straight from the fetched
 * `ecosystem.json`, the same file the static markup was authored from.
 */

import { computeLayout } from './layout.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

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

async function main() {
  let data;
  try {
    const res = await fetch('./ecosystem.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('polis: could not load ecosystem.json — the static roster below is the full page.', err);
    return;
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

  const layout = computeLayout(data.divisions, data.agents, data.edges);

  const svg = document.getElementById('city-map');
  const citizenEls = new Map();
  const edgeLines = [];
  let hoverId = null;
  let selectedId = null;
  let lastFocusedEl = null;

  // ---- district blobs + legend --------------------------------------

  const districtLayer = svgEl('g', { class: 'district-layer' });
  const legend = document.getElementById('map-legend');
  for (const d of data.divisions) {
    const key = `${d.number} ${d.name}`;
    const shape = layout.districtShapes.get(key);
    const cls = `div-${d.number}`;
    if (shape) {
      districtLayer.appendChild(svgEl('circle', {
        class: `district-blob ${cls}`, cx: shape.cx, cy: shape.cy, r: shape.r,
      }));
      const lx = shape.cx - shape.r + 12;
      const ly = shape.cy - shape.r + 20;
      const title = `${d.number} · ${d.name}`;
      const sub = `${shape.count} ${shape.count === 1 ? 'citizen' : 'citizens'}`;
      districtLayer.appendChild(svgEl('rect', {
        class: 'district-label-bg', x: lx - 5, y: ly - 15, width: Math.max(title.length, sub.length) * 7.4 + 10, height: 35, rx: 4,
      }));
      const t1 = svgEl('text', { class: 'district-label', x: lx, y: ly });
      t1.textContent = title;
      const t2 = svgEl('text', { class: 'district-sub', x: lx, y: ly + 15 });
      t2.textContent = sub;
      districtLayer.appendChild(t1);
      districtLayer.appendChild(t2);
    }
    if (legend) {
      const count = data.agents.filter((a) => a.division === key).length;
      legend.appendChild(el('li', {}, [
        el('span', { class: `swatch ${cls}` }),
        `${d.number} · ${d.name} (${count})`,
      ]));
    }
  }
  // The two honest exceptions to the eight named districts: citizens with no
  // division declared, and system utilities exempt from the constitution.
  // Drawn the same way a district is (centroid + radius over real settled
  // positions), just with a dashed outline and no fill hue of their own —
  // there is nothing to invent here, only somewhere true to put them.
  function drawHoldingArea(members, label, noun = ['citizen', 'citizens']) {
    if (!members.length) return;
    let cx = 0, cy = 0;
    for (const a of members) { const p = layout.positions.get(a.id); cx += p.x; cy += p.y; }
    cx /= members.length; cy /= members.length;
    let r = 40;
    for (const a of members) { const p = layout.positions.get(a.id); r = Math.max(r, Math.hypot(p.x - cx, p.y - cy) + 40); }
    districtLayer.appendChild(svgEl('circle', { class: 'district-blob holding-area', cx, cy, r }));
    const lx = cx - r + 12;
    const ly = cy - r + 20;
    const sub = `${members.length} ${members.length === 1 ? noun[0] : noun[1]}`;
    districtLayer.appendChild(svgEl('rect', {
      class: 'district-label-bg', x: lx - 5, y: ly - 15, width: Math.max(label.length, sub.length) * 7.4 + 10, height: 35, rx: 4,
    }));
    const t1 = svgEl('text', { class: 'district-label', x: lx, y: ly });
    t1.textContent = label;
    const t2 = svgEl('text', { class: 'district-sub', x: lx, y: ly + 15 });
    t2.textContent = sub;
    districtLayer.appendChild(t1);
    districtLayer.appendChild(t2);
  }
  const noDivisionMembersForMap = data.agents.filter((a) => !a.division && !a.system);
  const systemMembersForMap = data.agents.filter((a) => a.system);
  drawHoldingArea(noDivisionMembersForMap, 'No division declared');
  drawHoldingArea(systemMembersForMap, 'System utilities', ['utility', 'utilities']);

  const noDivisionCount = noDivisionMembersForMap.length;
  const systemCount = systemMembersForMap.length;
  if (legend) {
    if (noDivisionCount) legend.appendChild(el('li', {}, [el('span', { class: 'swatch unassigned' }), `No division declared (${noDivisionCount})`]));
    if (systemCount) legend.appendChild(el('li', {}, [el('span', { class: 'swatch system' }), `System utilities (${systemCount})`]));
  }
  svg.appendChild(districtLayer);

  // ---- edges (roads) --------------------------------------------------

  const edgeLayer = svgEl('g', { class: 'edge-layer' });
  for (const e of data.edges) {
    const a = layout.positions.get(e.from);
    const b = layout.positions.get(e.to);
    if (!a || !b) continue;
    const line = svgEl('line', {
      class: 'edge', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    });
    line.dataset.from = e.from;
    line.dataset.to = e.to;
    edgeLayer.appendChild(line);
    edgeLines.push(line);
  }
  svg.appendChild(edgeLayer);

  // ---- citizens ---------------------------------------------------------

  function ariaLabelFor(a) {
    const bits = [a.id];
    if (a.director) bits.push('Director');
    bits.push(a.division ? `of ${a.division}` : (a.system ? 'a system utility, no division' : 'no division declared'));
    if (unreachableSet.has(a.id)) bits.push('unreachable: named by no one upstream or downstream');
    const d = (downstream.get(a.id) || []).length;
    const u = (upstream.get(a.id) || []).length;
    bits.push(`hands work to ${d}, receives work from ${u}`);
    return bits.join(', ');
  }

  const citizenLayer = svgEl('g', { class: 'citizen-layer' });
  for (const a of data.agents) {
    const p = layout.positions.get(a.id);
    if (!p) continue;
    const divNum = a.division ? a.division.split(' ')[0] : null;
    const classes = ['citizen'];
    if (divNum) classes.push(`div-${divNum}`);
    else if (a.system) classes.push('system');
    else classes.push('unassigned');
    if (a.director) classes.push('director');

    const wrapper = svgEl('g', {
      class: classes.join(' '),
      tabindex: '0',
      role: 'button',
      'aria-label': ariaLabelFor(a),
      transform: `translate(${p.x} ${p.y})`,
    });
    wrapper.dataset.id = a.id;
    wrapper.dataset.system = a.system ? 'true' : 'false';

    const r = a.director ? 10 : 7;
    if (a.system) {
      wrapper.appendChild(svgEl('rect', { class: 'node-dot citizen-shape-square', x: -r, y: -r, width: r * 2, height: r * 2 }));
    } else {
      wrapper.appendChild(svgEl('circle', { class: `node-dot ${divNum ? `div-${divNum}` : 'unassigned-fill'}`, r }));
      if (a.director) wrapper.appendChild(svgEl('circle', { class: `node-ring-director div-${divNum}`, r: r + 4 }));
    }
    if (unreachableSet.has(a.id)) wrapper.appendChild(svgEl('circle', { class: 'node-ring-unreachable', r: r + 7 }));

    const labelBg = svgEl('rect', { class: 'node-label-bg', x: -(a.id.length * 3.3) - 3, y: -r - 21, width: a.id.length * 6.6 + 6, height: 13, rx: 2 });
    const label = svgEl('text', { class: 'node-label', x: 0, y: -r - 11, 'text-anchor': 'middle' });
    label.textContent = a.id;
    wrapper.appendChild(labelBg);
    wrapper.appendChild(label);

    wrapper.addEventListener('click', () => selectCitizen(a.id));
    wrapper.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectCitizen(a.id); }
    });
    wrapper.addEventListener('mouseenter', () => { hoverId = a.id; refreshHighlight(); });
    wrapper.addEventListener('mouseleave', () => { hoverId = null; refreshHighlight(); });
    wrapper.addEventListener('focus', () => { hoverId = a.id; refreshHighlight(); });
    wrapper.addEventListener('blur', () => { hoverId = null; refreshHighlight(); });

    citizenLayer.appendChild(wrapper);
    citizenEls.set(a.id, wrapper);
  }
  svg.appendChild(citizenLayer);

  function refreshHighlight() {
    for (const g of citizenEls.values()) g.classList.remove('active', 'neighbor', 'dimmed');
    for (const line of edgeLines) line.classList.remove('highlight', 'dimmed');
    const anchors = [hoverId, selectedId].filter(Boolean);
    if (!anchors.length) return;
    const activeSet = new Set(anchors);
    const neighborSet = new Set();
    for (const id of anchors) for (const n of neighborsOf(id)) neighborSet.add(n);
    for (const [id, g] of citizenEls) {
      if (activeSet.has(id)) g.classList.add('active');
      else if (neighborSet.has(id)) g.classList.add('neighbor');
      else g.classList.add('dimmed');
    }
    for (const line of edgeLines) {
      const { from, to } = line.dataset;
      if (activeSet.has(from) || activeSet.has(to)) line.classList.add('highlight');
      else line.classList.add('dimmed');
    }
  }

  // ---- citizen panel ------------------------------------------------------

  const panel = document.getElementById('citizen-panel');
  const panelHeading = document.getElementById('panel-heading');
  const panelDivision = document.getElementById('panel-division');
  const panelDesc = document.getElementById('panel-desc');
  const panelModel = document.getElementById('panel-model');
  const panelDirector = document.getElementById('panel-director');
  const panelUnreachable = document.getElementById('panel-unreachable');
  const panelTools = document.getElementById('panel-tools');
  const panelDownstream = document.getElementById('panel-downstream');
  const panelUpstream = document.getElementById('panel-upstream');
  const panelClose = document.getElementById('panel-close');

  function renderChips(container, values, emptyText) {
    container.textContent = '';
    if (!values.length) {
      container.appendChild(el('li', { class: 'panel-empty' }, [emptyText]));
      return;
    }
    for (const v of values) container.appendChild(el('li', {}, [v]));
  }

  function renderCitizenLinks(container, ids, emptyText) {
    container.textContent = '';
    if (!ids.length) {
      container.appendChild(el('li', { class: 'panel-empty' }, [emptyText]));
      return;
    }
    for (const id of ids.slice().sort()) {
      const btn = el('button', { type: 'button', class: 'link-button' }, [id]);
      btn.addEventListener('click', () => selectCitizen(id));
      container.appendChild(el('li', {}, [btn]));
    }
  }

  function selectCitizen(id) {
    const a = byId.get(id);
    if (!a) return;
    lastFocusedEl = document.activeElement;
    selectedId = id;
    hoverId = null;
    refreshHighlight();

    panelHeading.textContent = a.id;
    const roleBits = [];
    if (a.director) roleBits.push('Director');
    roleBits.push(a.division || (a.system ? 'System utility' : 'No division declared'));
    if (unreachableSet.has(a.id)) roleBits.push('Unreachable — named by no one upstream or downstream');
    panelDivision.textContent = roleBits.join(' · ');
    panelDesc.textContent = a.description;
    panelModel.textContent = a.model || 'no fixed model';
    panelDirector.textContent = a.director ? 'Yes' : 'No';
    panelUnreachable.textContent = unreachableSet.has(a.id) ? 'Yes' : 'No';
    renderChips(panelTools, a.tools, 'none declared');
    renderCitizenLinks(panelDownstream, downstream.get(id) || [], 'hands work to no one');
    renderCitizenLinks(panelUpstream, upstream.get(id) || [], 'receives work from no one');

    panel.hidden = false;
    panelHeading.focus();

    const rosterLi = rosterButtons.get(id);
    if (rosterLi) {
      for (const b of document.querySelectorAll('.roster-agent-button.selected')) b.classList.remove('selected');
      rosterLi.querySelector('.roster-agent-button')?.classList.add('selected');
    }
  }

  function closePanel() {
    panel.hidden = true;
    selectedId = null;
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

  function buildRosterGroup(root, heading, note, members, noun = ['citizen', 'citizens']) {
    if (!members.length) return;
    const wrap = el('div', { class: 'roster-district' });
    wrap.appendChild(el('h3', {}, [`${heading} `, el('span', { class: 'roster-count' }, [`(${members.length} ${members.length === 1 ? noun[0] : noun[1]})`])]));
    if (note) wrap.appendChild(el('p', { class: 'static-note' }, [note]));
    const ul = el('ul', { class: 'roster-agent-list' });
    for (const a of members) ul.appendChild(rosterAgentLi(a));
    wrap.appendChild(ul);
    root.appendChild(wrap);
    rosterDistricts.set(heading, wrap);
  }

  const rosterRoot = document.getElementById('roster-list');
  for (const d of data.divisions) {
    const key = `${d.number} ${d.name}`;
    const members = data.agents.filter((a) => a.division === key).sort((x, y) => x.id.localeCompare(y.id));
    buildRosterGroup(rosterRoot, `${d.number} · ${d.name}`, null, members);
  }
  const noDivisionMembers = data.agents.filter((a) => !a.division && !a.system).sort((x, y) => x.id.localeCompare(y.id));
  buildRosterGroup(rosterRoot, 'No division declared', "Not listed under any division in ECOSYSTEM.md's organization section.", noDivisionMembers);
  const systemMembers = data.agents.filter((a) => a.system).sort((x, y) => x.id.localeCompare(y.id));
  buildRosterGroup(rosterRoot, 'System utilities', 'Ship with Claude Code, sit in no division, and the constitution exempts them from the admission standard and the reciprocity rule.', systemMembers, ['utility', 'utilities']);

  // ---- filters --------------------------------------------------------

  const divisionSelect = document.getElementById('division-filter');
  for (const d of data.divisions) {
    divisionSelect.appendChild(el('option', { value: `${d.number} ${d.name}` }, [`${d.number} · ${d.name}`]));
  }
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
    if (value === '__none__') return !a.division && !a.system;
    if (value === '__system__') return a.system;
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
    for (const wrap of rosterDistricts.values()) {
      const anyVisible = Array.from(wrap.querySelectorAll('.roster-agent')).some((li) => !li.hidden);
      wrap.hidden = !anyVisible;
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

  for (const btn of document.querySelectorAll('.jump-to-citizen')) {
    btn.addEventListener('click', () => {
      selectCitizen(btn.dataset.id);
      panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }

  // ---- reveal the interactive sections, retire the static fallback -------

  document.getElementById('filters-section').hidden = false;
  document.getElementById('map-section').hidden = false;
  document.getElementById('list-section').hidden = false;
  document.getElementById('static-roster-section').hidden = true;
}

main();
