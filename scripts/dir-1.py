"""Art direction items 1-3 and 6: scale, seams, contact, and the honesty fix.

Ordered by visual impact per unit of effort, per DESIGN.md section 8.

Item 1 is the root cause the original eight-point diagnosis missed. The map is
authored at ~2228 user units wide and displayed in an 1180px column, so one
user unit is about half a CSS pixel: a building is 32px, the tallest tower is
42px, and the face strokes are 0.3px. No shading model rescues artwork rendered
below the resolution it was drawn for.

Item 6 is the one that actually had to be fixed today regardless of looks. The
page says "Directors are always named; everyone else's name appears on hover"
and the renderer draws no name text anywhere — only <title> tooltips. On a
project whose whole premise is that the page does not lie, an unkept promise in
the copy is worse than any shading bug.
"""
import io

# ---------------------------------------------------------------- view ---
p = 'site/city-view.mjs'
s = io.open(p, encoding='utf-8').read()

s = s.replace(
    "import { boxFaces, plotPolygon, tilePolygon, toScreen, depthOf, screenBounds, TILE_H } from './iso.mjs';",
    "import {\n"
    "  boxFaces, plotPolygon, toScreen, depthOf, screenBounds,\n"
    "  shadowPolygon, footingBands, contactPatch,\n"
    "} from './iso.mjs';",
    1,
)

# --- item 1: reclaim scale -------------------------------------------------
old_room = """  const PAD = 90;
  // Buildings and walls stand above their tile, and a collision-displaced
  // label can be lifted further still. This is sized for the resolver's
  // worst case rather than for the common one, because the failure mode is
  // a label silently leaving the canvas.
  const TOP_ROOM = 300;"""
new_room = """  const PAD = 64;
  // Was 300, which reserved 21% of the canvas as empty sky for a label
  // worst case that almost never fires. Labels now sit on plates tight to
  // their precinct instead of escaping upward, so the sky is not needed and
  // the space goes back into pixels-per-unit — the single highest-leverage
  // change available to this map.
  const TOP_ROOM = 96;"""
assert old_room in s, 'TOP_ROOM block not found'
s = s.replace(old_room, new_room, 1)

# --- item 3: shadows, contact patches, footings ----------------------------
old_build = """  const buildLayer = s('g', { class: 'building-layer' });"""
new_build = """  // Shadows sit between the roads and the buildings: they darken the streets
  // (correct) and are occluded by anything nearer the camera (also correct,
  // since the painter's order already holds).
  //
  // fill-opacity per element, never `opacity` on the group. A group opacity
  // would force one offscreen composite over ~290 shapes and re-rasterise it
  // on every wheel-zoom tick, which is the exact jank class this repo already
  // got burned by once.
  const shadowLayer = s('g', { class: 'shadow-layer' });
  const buildLayer = s('g', { class: 'building-layer' });"""
assert old_build in s
s = s.replace(old_build, new_build, 1)

# --- item 2 + 3: per-structure geometry ------------------------------------
old_faces = """    g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
    g.appendChild(s('polygon', { class: 'face face-right', points: faces.right }));
    g.appendChild(s('polygon', { class: 'face face-top', points: faces.top }));"""
new_faces = """    // A ruin is an empty lot. Nothing stands there, so nothing casts a shadow
    // and nothing rests on the ground — that absence IS the finding.
    if (!item.unreachable) {
      const patch = contactPatch(item.col, item.row, footprintOf(item));
      shadowLayer.appendChild(s('ellipse', { class: 'ao-patch', ...patch, fill: 'url(#ao-patch)' }));
      shadowLayer.appendChild(s('polygon', {
        class: 'cast-shadow',
        points: shadowPolygon(item.col, item.row, item.height, footprintOf(item)),
      }));
    }

    g.appendChild(s('polygon', { class: 'face face-left', points: faces.left }));
    g.appendChild(s('polygon', { class: 'face face-right', points: faces.right }));

    if (!item.unreachable && item.height > 6) {
      const foot = footingBands(item.col, item.row, item.height, footprintOf(item));
      g.appendChild(s('polygon', { class: 'face face-foot', points: foot.left }));
      g.appendChild(s('polygon', { class: 'face face-foot', points: foot.right }));
    }

    g.appendChild(s('polygon', { class: 'face face-top', points: faces.top }));"""
assert old_faces in s
s = s.replace(old_faces, new_faces, 1)

s = s.replace(
    "    const faces = boxFaces(item.col, item.row, item.height, item.kind === 'skill' ? 0.62 : 0.72);",
    "    const faces = boxFaces(item.col, item.row, item.height, footprintOf(item));",
    1,
)

# --- the AO gradient (one def, shared by every building) -------------------
old_defs = """  defs.appendChild(grad);
  svg.appendChild(defs);"""
new_defs = """  defs.appendChild(grad);

  // One radial gradient, referenced by all ~145 contact patches. Defining it
  // per building would be 145 gradients for one visual effect.
  const ao = s('radialGradient', { id: 'ao-patch' });
  ao.appendChild(s('stop', { offset: '0', 'stop-color': 'var(--ao-ink)', 'stop-opacity': '0.30' }));
  ao.appendChild(s('stop', { offset: '0.55', 'stop-color': 'var(--ao-ink)', 'stop-opacity': '0.17' }));
  ao.appendChild(s('stop', { offset: '1', 'stop-color': 'var(--ao-ink)', 'stop-opacity': '0' }));
  defs.appendChild(ao);
  svg.appendChild(defs);"""
assert old_defs in s
s = s.replace(old_defs, new_defs, 1)

s = s.replace("  camera.appendChild(roadLayer);\n", "  camera.appendChild(roadLayer);\n  camera.appendChild(shadowLayer);\n", 1)

# --- footprint helper ------------------------------------------------------
s = s.replace(
    "function plotHueClass(plot) {",
    "/**\n"
    " * Footprint width, derived from the member's pinned model.\n"
    " *\n"
    " * `model` is a real frontmatter field with a live distribution across the\n"
    " * roster, so it costs nothing to express and encodes a fact that appears\n"
    " * nowhere else on the map. Height still means degree and only degree.\n"
    " */\n"
    "const FOOTPRINT = { opus: 0.78, sonnet: 0.72, haiku: 0.64 };\n"
    "function footprintOf(item) {\n"
    "  if (item.kind === 'skill') return 0.62;\n"
    "  return FOOTPRINT[item.model] || 0.70;\n"
    "}\n\n"
    "function plotHueClass(plot) {",
    1,
)

io.open(p, 'w', encoding='utf-8').write(s)
print('city-view: scale reclaimed, shadows + contact + footings added')
