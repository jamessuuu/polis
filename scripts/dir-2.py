"""Fix what the render exposed, plus the composition change the direction asked for.

1. The breakout clipped the toolbar. `margin-inline: calc(50% - 50vw...)` is
   computed against the PARENT's width, not the viewport's, so inside a narrow
   column it pushed content off the left edge — the Zoom buttons were sliced in
   half. Centring with a transform is parent-width-independent and cannot
   overflow, because the width is already capped at the viewport.

2. The toolbar was inside the widened scroll container and inherited the
   breakout. It belongs outside it.

3. The Archive was placed at bearing +PI/2, which in this projection is the
   FRONT of the scene — so the largest precinct on the map (13x10 tiles of 86
   sheds) stood between the camera and the eight districts that are the actual
   subject. Moving it behind turns the map's biggest obstruction into its
   backdrop.
"""
import io

# ---- CSS ------------------------------------------------------------------
p = 'site/styles.css'
s = io.open(p, encoding='utf-8').read()
OLD = """  width: min(100vw - 2rem, 1480px);
  margin-inline: calc(50% - min(50vw - 1rem, 740px));"""
NEW = """  width: min(100vw - 2rem, 1480px);
  /* Centred on the parent rather than offset from it. margin-inline with vw
     units resolves against the parent box, so in a narrow column it shoved the
     toolbar off the left edge instead of widening the map. */
  margin-left: 50%;
  transform: translateX(-50%);"""
assert OLD in s
s = s.replace(OLD, NEW, 1)
io.open(p, 'w', encoding='utf-8').write(s)

# ---- HTML: toolbar out of the scroll container ---------------------------
p = 'site/index.html'
h = io.open(p, encoding='utf-8').read()
OLD_OPEN = """      <div class="map-scroll">
        <div class="map-toolbar">"""
NEW_OPEN = """      <div class="map-toolbar">"""
assert OLD_OPEN in h
h = h.replace(OLD_OPEN, NEW_OPEN, 1)

OLD_CLOSE = """        </div>
        <svg id="city-map" tabindex="0" role="img\""""
NEW_CLOSE = """      </div>
      <div class="map-scroll">
        <svg id="city-map" tabindex="0" role="img\""""
assert OLD_CLOSE in h
h = h.replace(OLD_CLOSE, NEW_CLOSE, 1)
io.open(p, 'w', encoding='utf-8').write(h)

# ---- layout: put the Archive behind the city -----------------------------
p = 'site/layout.mjs'
l = io.open(p, encoding='utf-8').read()
OLD_ARCH = """if (skillIds.length) outside.push({ key: '__archive__', label: 'The Archive', sub: 'skills any citizen may invoke', kind: 'archive', ids: skillIds, bearing: Math.PI / 2 });"""
NEW_ARCH = """  // Bearing matters more here than anywhere else on the map. +PI/2 is the
  // FRONT of the scene in this projection, and the Archive is the largest
  // precinct there is — 86 sheds standing between the camera and the eight
  // districts that are the subject. Behind and to the left, it becomes a
  // backdrop instead of an obstruction.
  if (skillIds.length) outside.push({ key: '__archive__', label: 'The Archive', sub: 'skills any citizen may invoke', kind: 'archive', ids: skillIds, bearing: (-3 * Math.PI) / 4 });"""
assert OLD_ARCH in l
l = l.replace('  ' + OLD_ARCH, NEW_ARCH, 1)
io.open(p, 'w', encoding='utf-8').write(l)

print('breakout centred, toolbar freed, Archive moved behind the city')
