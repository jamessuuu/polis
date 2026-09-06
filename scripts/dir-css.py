"""Art direction: shading, contact, and reclaiming the display scale.

Three changes, in impact order.

1. THE GROUT. Every face carried `stroke: var(--bg-elevated); stroke-width: 0.6`
   — which at ~0.5 CSS px per user unit is a 0.3px light line between every
   adjacent polygon. That pale seam is a large part of why the solids read as
   stickers rather than blocks. Each face now self-strokes in its OWN fill at
   0.5u, which closes the antialiasing gap without drawing a visible line.

2. CONTACT. Cast shadow, contact patch and footing band. Flat vector isometric
   lives or dies on contact: a shape with no shadow looks pasted onto the
   background rather than standing on it.

3. SCALE. The map breaks out of the 1180px text column. Same artwork, a third
   more pixels, for one line of CSS.

Shading moves to OKLCH deltas. `color-mix(in srgb, hue, #000)` interpolates
gamma-encoded channels toward zero, which collapses chroma faster than
lightness and drags every hue toward the same muddy brown — a green building's
shadow wall stopped looking green. OKLCH lightness deltas hold hue exactly.
"""
import io

p = 'site/styles.css'
s = io.open(p, encoding='utf-8').read()

# ---- theme tokens: ink for shadow and occlusion ---------------------------
LIGHT = """  --ground-top: #e6dcc6;"""
assert LIGHT in s
s = s.replace(
    LIGHT,
    "  /* Shadows are a cool slate, never black. Black shadows on a warm ground\n"
    "     read as holes; a chromatic ink reads as light being blocked. */\n"
    "  --shadow-ink: #4a5164;\n"
    "  --ao-ink: #3f4657;\n"
    "  --shadow-alpha: 0.13;\n" + LIGHT,
    1,
)

DARK = """  --ground-top: #2b333d;"""
assert s.count(DARK) == 2, f'expected 2 dark ground blocks, found {s.count(DARK)}'
s = s.replace(
    DARK,
    "  --shadow-ink: #05070c;\n  --ao-ink: #04060a;\n  --shadow-alpha: 0.28;\n" + DARK,
)

# ---- faces: kill the grout, move to OKLCH ---------------------------------
OLD_FACE = """.face { stroke: var(--bg-elevated); stroke-width: 0.6; stroke-linejoin: round; }
.face-top   { fill: var(--hue); }
/* Two flat multiplies of the roof colour. colour-mix keeps them derived from
   the hue instead of hand-picked, so adding a precinct needs no new values. */
.face-right { fill: color-mix(in srgb, var(--hue) 74%, #000); }
.face-left  { fill: color-mix(in srgb, var(--hue) 52%, #000); }"""

NEW_FACE = """/* Self-stroked in its own fill: closes the antialiasing seam between adjacent
   polygons without drawing the pale line that made every solid look like a
   sticker. Never stroke a face in the background colour. */
.face { stroke: inherit; stroke-width: 0.5; stroke-linejoin: round; }
.face-top   { fill: var(--face-top);   stroke: var(--face-top); }
.face-right { fill: var(--face-right); stroke: var(--face-right); }
.face-left  { fill: var(--face-left);  stroke: var(--face-left); }
.face-foot  { fill: var(--face-foot);  stroke: var(--face-foot); }

/* One fixed key light from the upper right, expressed as perceptual lightness
   steps. Hue and chroma are held; only L moves. That is the entire fix for the
   muddy-shadow problem the sRGB black-mix caused. */
.structure {
  --face-top:   var(--hue);
  --face-right: color-mix(in oklab, var(--hue) 86%, var(--shadow-ink));
  --face-left:  color-mix(in oklab, var(--hue) 71%, var(--shadow-ink));
  --face-foot:  color-mix(in oklab, var(--hue) 58%, var(--shadow-ink));
}
@supports (color: oklch(from red l c h)) {
  .structure {
    --face-top:   oklch(from var(--hue) l                c            h);
    --face-right: oklch(from var(--hue) calc(l - 0.085)  calc(c * 0.96) h);
    --face-left:  oklch(from var(--hue) calc(l - 0.170)  calc(c * 0.88) h);
    --face-foot:  oklch(from var(--hue) calc(l - 0.265)  calc(c * 0.78) h);
  }
}

/* Contact. The cheapest thing on the map that stops a box reading as a decal.
   fill-opacity per element, never opacity on the layer — a group opacity
   forces one offscreen composite over ~290 shapes and re-rasterises it on
   every wheel-zoom tick, which is the jank class this repo already hit once. */
.cast-shadow {
  fill: var(--shadow-ink);
  fill-opacity: var(--shadow-alpha);
  stroke: none;
}
.ao-patch { stroke: none; }"""

assert OLD_FACE in s, 'face block not found'
s = s.replace(OLD_FACE, NEW_FACE, 1)

# Skills keep a lighter roof but must not re-introduce a background stroke.
s = s.replace(
    ".structure.kind-skill .face { stroke-width: 0.4; }\n"
    ".structure.kind-skill .face-top { fill: color-mix(in srgb, var(--hue) 58%, var(--bg-elevated)); }",
    ".structure.kind-skill .face { stroke-width: 0.4; }\n"
    ".structure.kind-skill { --face-top: color-mix(in oklab, var(--hue) 58%, var(--bg-elevated)); }",
    1,
)

# ---- scale: break the map out of the text column --------------------------
OLD_SCROLL = """.map-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-elevated);
}"""
NEW_SCROLL = """.map-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-elevated);
  /* The map is the subject of this page and was being drawn inside a text
     column, at roughly half a CSS pixel per user unit. Breaking it out is a
     ~33% linear gain for one declaration — more than any shading change buys. */
  width: min(100vw - 2rem, 1480px);
  margin-inline: calc(50% - min(50vw - 1rem, 740px));
}"""
assert OLD_SCROLL in s
s = s.replace(OLD_SCROLL, NEW_SCROLL, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('styles: grout removed, OKLCH shading, contact shadows, scale reclaimed')
