# KwizzyGeo

Geographical Quiz Game — the map half: a pure HTML/CSS/JS view of Natural Earth
admin-0 country polygons, no libraries and no map tiles, drawn on one fullscreen
`<canvas>` in the **Eckert IV** equal-area pseudocylindrical projection.

Serve the root, open `index.html`, and it runs — no build step. The doc below
is the viewer's own account of how it works. Three layers ship in `data/`; two are
loaded at startup and **50m sovereignty is the default**:

| layer | file | features | vertices |
|---|---|---|---|
| **`data/so50.geojson`** (default) | `ne_50m_admin_0_sovereignty` v5.1.1 | 201 | 119,927 (densified) |
| `data/countries.geojson` (alternative) | `ne_110m_admin_0_countries` v5.1.1 | 177 | 47,664 |
| `data/ne10m.geojson` (lazy) | `ne_10m_admin_0_map_units` v5.1.1 | 298 | 552,828 raw |
| `data/places.json` (overlay) | `ne_10m_populated_places` v5.1.2 | 7,342 points | — |

Open it at **http://localhost:8123/** (server: `python3 -m http.server 8123 --directory .`
from the repository root — the page fetches `data/*.geojson`, so serving `data/`
alone does not work).
Switch layers with **`t`** or the URL param **`?layer=110m`**. The 2D view opens on
**perspective (3 R)** — the default is `persp`, not `ortho` and not Eckert IV;
`?proj=` still picks any re-centring projection (see the registry below).

## Files

Three folders, one job each: the code a player loads at the root, the data in
`data/`, the node scripts in `tests/`.

```
index.html  style.css  core.js  app.js  three.bundle.cjs   <- the app
data/   so50.geojson  countries.geojson  ne10m.geojson  places.json
tests/  test_core.js  gesture_test.js  pole_test.js  ...   <- node only
tools/  shp2geojson_places.py                              <- data prep, no runtime
```

| file | role |
|---|---|
| `index.html` | canvas + three overlay divs (panel, hud, help) |
| `style.css` | fullscreen layout, panel styling, touch/mobile tweaks |
| `core.js` | projection registry + geometry + re-centring, pure functions (unit-tested by `tests/test_core.js`) |
| `app.js` | rendering, centre-of-projection moves, hover/pick, mouse + keyboard + touch |
| `three.bundle.cjs` | three.js, vendored for the 3D globe |
| `data/so50.geojson` | the default data: 201 features, MultiPolygon, lon/lat degrees |
| `data/countries.geojson` | 177 features |
| `data/ne10m.geojson` | Natural Earth **10m admin-0 map units**: 298 features, 552k raw vertices, 11 MB (lazy-loaded) |
| `data/places.json` | Natural Earth **10m populated places**: 7,342 cities as a point table, 0.59 MB |
| `tools/shp2geojson_places.py` | the converter for that table (shapefile -> `data/places.json`) |
| `tests/` | the node test scripts (below) — development only |
| `README.md`, `LICENSE` | this document, MIT |

The three layers are fetched relative to the page, through the one constant
`app.js` sets at the top of `LAYERS`:

```js
var DATA_DIR = 'data/';
```

Move the data or rename that folder — one string, no other path in the app
hardcodes a layer name. The server test suite reads the same files from
`tests/../data/`.

### Deploying

Upload the five app files at the root and `data/` beside them; `tests/`, `tools/`,
the README and the licence are never fetched, so leave them out if the host serves
only the game. `index.html` needs `style.css`, `three.bundle.cjs`, `core.js` and
`app.js` next to it; the layers must keep the `data/` prefix, or `DATA_DIR` must
be changed to match.

## Projection

Forward (MathWorld / Snyder form — the one that is *exactly* equal-area):

```
theta + sin(theta)cos(theta) + 2 sin(theta) = (2 + pi/2) sin(phi)   (Newton from phi/2)
x = 2 lambda (1 + cos theta) / sqrt(pi (4 + pi))
y = 2 sqrt(pi / (4 + pi)) sin(theta)
```

Inverse is closed-form: `theta = asin(y / K)`. Verified in `test_core.js`: the polar
line is exactly half the equator, round-trip error < 1e-9 deg, and every country's
planar area in projected space matches its true area within ~1-5 % (Norway 384,250
km² vs 382,900 real, Fiji 18,407 vs 18,443, Italy 300,424 vs 301,230).

`thetaSinCos()` is the hot path's solver: a 4097-entry table of θ over latitude
gives the starting value and one Newton polish restores full double precision
(4e-13 plane units at 88 ns/pt, against 191 ns/pt from a cold Newton solve — the
plain table is faster but its 1e-8 error is amplified by `asin` in the inverse to
3e-6 deg at high latitude, so the polish is kept).

Because the projection is equal-area, `AREA_KM2` is precomputed in `shp2geojson.py`
/ `shp2geojson50.py` by densifying each geographic edge (straight lines of constant
lon/lat are *not* straight in Eckert IV) and measuring the projected polygon.

Antarctica's ring wraps the pole and crosses the dateline, so `ringPieces()` unwraps
each ring and clips it to the lon window with Sutherland-Hodgman; cutting at lon = ±180
is exact because those meridians are the frame's outer boundary.

## Level of detail

The 50m layer has 99,515 raw vertices (~9× the 110m layer), so rings are densified
once at 0.2° (119,927 vertices — only +20 % over raw) and each carries a 10-step
decimation ladder `LOD_U = [.012 … .00005, 0]` of index lists. Since projected
coordinates are zoom-independent, a frame only *reads* those arrays:
`levelIndex(ring, k, maxPx)` picks the coarsest level whose error `LOD_U[t] * k`
stays under 0.7 screen px. Measured: 75,677 vertices at the whole-world view,
119,927 at z ≥ 8, and **0.2–0.5 ms per frame at every zoom**. (The naive version
that re-projected every frame cost 148 ms at z 8 — that path is gone.)

## Moving the centre of projection

The 2D view **does not pan a flat picture**. A drag, an arrow key or a wheel step
moves the point of the sphere that is the *centre of projection* and re-projects
the whole world around it, so you turn the world inside a fixed frame instead of
sliding it out of one.

A rotation applied before an equal-area projection is still equal-area, so
country areas, label ranking and the panel's numbers are unaffected (measured:
France re-projects to 663,705–663,711 km² across centres against 663,709 in the
build pipeline, a 0.001 % spread). What *is* rebuilt per centre: the projected
pieces, the LOD level in use, the feature bboxes, the frame and the graticule.

Cost of one recentre on the real layers, warmed (`recenter_cost.js`, a probe kept
outside this repo):

| layer | rings re-cut + projected | frame | graticule | per recentre |
|---|---|---|---|---|
| 110m | 9 ms | 0.1 ms | 6–14 ms | **15–23 ms** |
| 50m | 17 ms | 0.1 ms | 4–10 ms | **21–26 ms** |

The re-projection is scheduled on the next animation frame and coalesces drag
events, so a 60 Hz drag never queues more than one rebuild per frame. Only the
ladder level drawing reads is rebuilt (all ten cost ~12 ms more). The graticule is
rebuilt because it is geographic, at ~4 px chords and 2° input sampling — the first
version cost 20–40 ms for a grid that looked the same.

**How the cut works.** Rotate the ring into the new frame, then break the stroke
where the rotated longitude jumps by more than 90° (or the plane x by more than
half the frame): that is the seam meridian `lon' = 180`, which the projection
renders on *both* sides of the frame. At such a break two vertices are emitted —
one at `lon' = +180` ending the piece, one at `lon' = -180` starting the next — so
each piece closes along its own frame edge. A ring that winds a pole is left whole.
Cutting with an unwrapped longitude window instead looks equivalent and is not: such
a ring spans more than 360° of rotated longitude (Antarctica at a centre of
178 °E, 12 °S spans 386°), its closing edge becomes a 360° chord, and two thirds of
its area disappears. A ring that *encircles* the rotated pole (China, when the
centre sits on its antipode) is handed to the build pipeline itself, on the rotated
ring — rare, and correctness by construction.

Verified by `recenter_cost.js`: at centre (0, 0) 282 of 289 rings reproduce the
build pipeline's area exactly and the worst deviation is 1.4e-4; rasterised
coverage (the thing actually drawn) stays within ±2.2 % of the layer at every
centre tried, including centres where a seam cuts through continents.

Two things stay put intentionally: the **frame** (the outline of the projection)
and the **pole lines**, because the centre is a rotation applied *before* the
projection. The **graticule** moves, being geographic.

**The view carries a ROTATION MATRIX, not just a centre** (`core.js` →
`rotFrom`, `app.js` → `FRAME`). This is the fix for the rotation problem when
arriving at a pole in the two cone projections, `ortho` and `persp`:

* *The bug.* Rebuilding the frame from the centre alone — `rotMat(lon, lat)` —
  gives the **canonical** frame, whose in-plane roll is pinned to the **equator**.
  At a pole the equator direction is undefined, so the pin becomes arbitrary and
  the world spins by the centre's longitude while the finger barely moved.
  Measured (`poletest2.js` (a probe, not shipped)): at 89.999 N a drag of **0.01°** of rotated
  latitude moves the centre 0.0100° and turns the frame **84.29°**; at 89.99 N a
  0.01° drag turned it 45°; crossing a pole dead-on flipped it **180°**. The
  *geometry* was always right — the pole audit `polarchk.js` is within
  0.2 % at every centre, poles included — it is the *orientation* that jumped.
* *The fix.* A centre move re-aims the axis of the **current** rotation along the
  shortest arc (`rotFrom`: rotate the frame by the minimal R that maps the new
  centre to (1,0,0), i.e. about (v ∧ e₀) through angle(v, e₀)). The frame then
  turns by the angular distance travelled and nothing more, at every latitude,
  and crossing a pole **parallel-transports** the roll, so north stays up on the
  far side instead of flipping. `view.lon/view.lat` are read *back* off the frame
  (`frameCentre`), so the HUD always agrees with what is drawn.
* *The rule is per projection* (`core.js` → `moveCentre`, and it is what `app.js`
  calls), because transport is only legitimate where a roll is cosmetic:
  - `clip: 'cone'` (`ortho`, `persp`) — azimuthal around the centre, so a roll is
    an **in-plane rotation**: transported vs canonical draw the same plane points
    up to one fixed angle (measured, `rollpc2.js` (a probe, not shipped): radii agree to 2e-15).
    Transport is free there, and it is what removes the spin.
  - `clip: 'seam'` (`eckert4`, `equirect`, `cylEqualArea`) — the frame's axes **are**
    the map's up and right, so a roll is not cosmetic: it shears the map (same
    file: transported vs canonical differ by up to 1.0 plane units of radius and
    2.5 rad of angle). Those keep the **canonical** frame, which is d3's
    `rotate()` convention: the centre's north meridian is up, and crossing a pole
    flips the map 180° — that convention working as intended, not the bug.
* *Consequences.* `recenterAll`, `graticuleRot` and `visibleAt` take the frame as
  an optional last argument and the app always passes `FRAME`; `geoAt` uses
  `unrotM` (the arbitrary-frame inverse — after a pole crossing the frame carries
  a roll that no `(lon, lat)` can describe, so the canonical `unrot` is wrong
  there). The cone clip needed no change: it is a half-space, it never reads a
  longitude. `rotMat(lon,lat)` survives only for a **fresh** view (`setCenterFresh`:
  URL init, the `r` reset).
* *Two traps found on the way.* The exact-antipode branch (a drag running dead
  through a pole) must be a 180° turn about the frame's own up — negating **two**
  rows; negating one is a reflection (det −1) and mirrored the world. And a
  composed frame drifts off SO(3) over a session (measured: 7e-6 after 35 one-degree
  steps, 8.5e-7° of centre error), so `rotFrom` re-orthogonalises with Gram-Schmidt.

Verified by `pole_test.js` (rotFrom alone) and `pole_sim.js` (the
app's own chain `pan → geoAt → moveCentre → reproject`, all five re-centring
projections): over 60 diagonal drags that walk over the pole, in `ortho` and
`persp` the frame turns by the drag to **4e-13°**, the grabbed point lands on the
centre of projection to **4e-14 px**, and the frame stays a rotation to **7e-16**;
in the three pseudocylindrical ones, `moveCentre` returns the canonical frame to
**0**, and the rotated frame's equator draws horizontal and its meridian vertical
(undistorted).

## Cities

`data/places.json` is Natural Earth's **10m populated places** (v5.1.2, 7,342
points), drawn as an overlay on top of the countries: a dot per place, a label for
the ones worth naming, and a panel with country, admin-1 region, population,
coordinates and time zone when you click one. `c` or the burger's **Overlay** row
turns the layer on and off; `?cities=0` starts with it off.

It is a **point table, not GeoJSON**:

```json
{ "fields": ["n","c","r","p","z","l","f","tz","lon","lat"], "places": [["Paris", …]] }
```

A GeoJSON Feature costs ~110 bytes of boilerplate ("type", "geometry",
"coordinates", "properties") before any value, so 7,342 points come out at 1.35 MB
instead of 0.59 MB — and there is no geometry in a point table to justify it. The
field names are declared once, in the file, and the app reads them through that
list rather than by position, so the converter can reorder or add a column without
silently shifting every value into the wrong slot.

**Which places are drawn** is Natural Earth's own `MIN_ZOOM`, verbatim plus 0.35 of
slack so a place appears on the step before and zooming feels continuous: 26
places at the fitted world view (z 2), 743 at z 5, all 7,342 at z 9. `LABELRANK`
decides who gets a *name* when several dots compete (rank 0 = Paris, Tokyo): no
label above rank 3 below z 4.5, none above rank 6 below z 6, and the hovered or
picked city is always labelled whatever its rank. City labels are placed against
the **same collision boxes** as the country labels, so a city never lands on a
country name; country names go first.

**Why the dots need the visibility test.** On a cone-clipped projection the hidden
cap projects *onto* the visible disc, so a city on the far side of the world lands
on a perfectly plausible screen position — a dot in the middle of the ocean. Every
point therefore goes through `projectRotLLVis` (`core.js`), which does the rotation
and the `X' >= clipCos` test in **one pass**: one rotation and one `fwd()` per point
instead of two, which matters because the layer is tested every frame. The whole
7,342-point pass costs **0.36 ms**; the drawn dot count is in the HUD (`· 42
cities`). On a seam projection (Eckert IV, equirect, cylindrical) nothing is
hidden and all 7,342 are candidates.

Dots are drawn two `Path2D`s — one for capitals, one for everything else — and
filled/stroked once each, so a deep zoom is two fills rather than 7,000 state
changes. The layer is 2D only: the 3D globe draws no markers.

`tools/shp2geojson_places.py` rebuilds the table from the shapefile:

    curl -O https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip
    unzip ne_10m_populated_places.zip && python3 tools/shp2geojson_places.py \
        ne_10m_populated_places.shp data/places.json

## Interaction

* **mouse** — wheel = zoom, drag = move the centre of projection (the world turns
  under the pointer, both axes), shift+wheel / horizontal trackpad = move the
  centre, double-click = go there + zoom, move = hover, click = pick
* **keyboard** — arrows = move the centre, `a`/`d` = zoom, `t` = switch layer,
  `c` = cities on/off, `Enter` = pick the hovered city or country, `Esc` = clear,
  `r` = reset to whole world
* **touch** — 1 finger drag = move the centre, 2 fingers = pinch zoom; a tap picks
* **URL params** (debugging): `?z=6` zoom level (z 2 = fitted world),
  `&lon=178&lat=-18` centre of projection, `?layer=110m|10m` layer,
  `?proj=ortho` projection (any `recenter: true` entry of `PROJ`), `?dbg=1` shows
  the reprojection time, piece count and viewport in the HUD

**Tests.** Ten node scripts in `tests/`, run as `node tests/<script>.js` (they
locate `core.js`, `app.js` and the data through `__dirname`, so the working
directory does not matter). All ten exit 0: the eight asserting ones end in
`ALL PASS`, `harness.js` ends with its expected headless `no three.js` line, and
`polarchk.js` / `visible_check.js <proj>` print per-centre tables to read.

| script | what it checks |
|---|---|
| `test_core.js` | 46 unit checks on `core.js`: projection maths, inverse round trip, equal-area, picking, LOD, orthographic back-face audit |
| `gesture_test.js` | 20 checks through the real handlers: inertia and its frame-rate independence, tap-vs-drag, double tap, menu activation and scrim |
| `pole_test.js` | the centre of projection turns the frame by exactly the angle travelled, and the frame never drifts across a pole |
| `pole_sim.js` | the same on the app's own chain (pan → `geoAt` → `moveCentre` → reproject), per re-centring projection |
| `artifact_test.js` | no stray geometry after a wheel zoom between two reprojections, a drag and a layer switch |
| `polarchk.js` | audit table: how far the drawn picture diverges from the true visible land, per centre (cone projections) |
| `harness.js` | headless app run: draw, hover, pick, layer switch, HUD |
| `visible_check.js <proj>` | what is painted vs the source data, per centre |
| `grat_test.js` | the graticule covers every visible meridian/parallel, at 8 centres x 2 zooms x all 5 re-centring projections (161 checks) |
| `places_test.js` | the city table is well formed, and its visibility rule matches the geometry (a place, its antipode, the limb) at 8 centres (42 checks) |

`harness.js` prints `ERROR no three.js` and `m(3d): Cannot read properties of
null (reading 'Scene')` in a headless run — that is expected, not a failure
(there is no WebGL context in node).

The measurement probes quoted in this document (`recenter_cost.js`,
`poletest2.js`, `rollpc2.js`, the `shp2geojson*.py` converters) are deliberately
**not** in this repository: they were one-off instruments, and their numbers are
recorded here instead.

Colours as requested: blue ocean (vertical gradient), light grey countries,
white on hover/pick. The panel shows name, localised names, type/sovereign,
region, area, population, GDP, economy, ISO codes and geometry stats.

Labels use the dataset's own `MIN_LABEL`/`MAX_LABEL` thresholds with screen-space
collision detection, so big countries appear first. The 50m sovereignty layer parks
10 of its "Sovereignty" rows (US, UK, France, China, …) at `MIN_LABEL = 100`, i.e.
never drawn; `labelThresholds()` borrows the thresholds the 110m countries layer
gives the same country for those rows, since their `LABEL_X/LABEL_Y` still sit on
the metropolitan territory.



## Inertia, fps and the menu

**Fling.** A drag that ends with the pointer still moving keeps moving and decays
(`INERTIA_TAU = 0.34 s`, stop below 60 px/s). The release velocity is measured over
the last ~120 ms of real samples, is capped at 6000 px/s, and the glide is advanced
once per animation frame with `dt` from the *animation-frame* clock — the same clock
the samples are stamped with. (Mixing the two clocks made the same flick travel
250 px at 60 Hz and 810 px at 30 Hz; the frame-rate-independence is now a test.)

| release speed | glide | duration |
|---|---|---|
| 400 px/s | 119 px | 0.65 s |
| 1250 px/s | 415 px | 1.0 s |
| 3000 px/s | 1.0 kpx | 1.3 s |

Any new press, wheel step or key stops the glide immediately, and opening the menu
stops it too.

**FPS** is on the first HUD line: an exponential average of the frame delta, shown
to the nearest frame time, with the worst frame since the last update. It is
refreshed four times a second rather than per frame (writing to the DOM at 60 Hz
would cost more than the number is worth).

**Menu.** Grouped into **View / Projection / Layer** — a flat run of twelve rows ran
off the bottom of a phone screen. On a coarse pointer the rows become 44 px tall with
14 px type, the sheet scrolls internally with a dark thin scrollbar, and a scrim
behind it closes it on any tap outside (phones have no Esc). One activation path for
every input: `pointerdown` records where the press started and `click` acts — a press
that travelled more than 12 px is a scroll, not a choice. The projection rows dim in
3D rather than disappearing, so the sheet keeps its height.

**Touch gestures.** A tap picks; a drag of more than 8 px pans and flings; a second
tap within 320 ms and 40 px zooms in on that point; two fingers pinch. Previously a
single tap picked on *touchstart*, so starting a drag showed a pick panel for whatever
was under the finger.

## Segments drawn

The HUD's first line counts the **segments actually issued to the canvas** for the
frame being painted — land and graticule separately, plus the piece count. It is a
counter incremented in `beginFeature()`, so it is the real number, not an estimate:
zoom out and it drops to ~12k on the 50m layer, zoom in and it climbs to the full
ladder level. `?dbg=1` appends the reprojection time and the viewport.

## Performance: what a frame costs

Measured in the browser on the 10m layer (564k vertices), with the phase timers
that now sit in the `?dbg=1` HUD line:

| phase | world view | z 6 |
|---|---|---|
| re-centre (rings: rotate + cut + project) | 37 ms | 31 ms |
| frame + graticule | 13 ms | 19 ms |
| Path2D build (JS) | 3.8 ms | 1.7 ms |
| canvas fill + stroke | 0.3 ms | 0.3 ms |
| **segments drawn** | 29 048 land | 35 992 land |
| **fps** | 56 | 60 |

Three changes got the 10m layer from unusable to 56–60 fps:

1. **`fwdVec`.** For the orthographic the forward map applied to a unit vector is
   `(x, y) = (-Z, Y)` — the identity on two components. The re-centre no longer
   computes `atan2`/`asin`/`cos`/`sin` per vertex (554k of them): **60 ms → 12 ms**.
   Verified equal to `fwd` to 6e-16 over 39k directions.
2. **Lazy LOD.** The ladder was ten `Int32Array`s per ring built up front for every
   layer: 10.6 MB and ~100 ms of the 10m load. `ensureLevel(ring, t)` now builds one
   level the first time it is read, so a session pays for the two or three levels it
   actually uses.
3. **A 1.2 px error budget instead of 0.7.** The canvas raster cost scales with the
   segment count, and the segment count is what the ladder decides. On the 10m layer
   at the world view: level 3 (0.6 px error) = 53k segments / 41 fps, level 2
   (1.1 px) = 29k / 56 fps, level 1 (2.3 px) = 18k / 60 fps. 1.1 px is below what
   the eye tracks on a moving map, so the budget is 1.2 px. `?lod=N` shifts it, and
   the measured chord error per level is 4.5 / 2.3 / 1.1 / 0.6 px at k = 376.

Also: the screen transform is inlined in the path loop (it was two function calls
per point, 2 x 53k per frame), and pieces are culled against the viewport, so a deep
zoom draws only what is on screen (z 6: **37 pieces**, not 2 336).

### Artifacts at the world view (diagnosed and fixed)

Two separate things were wrong, and they looked alike:

1. **A stale ladder level could be drawn.** A wheel step changes `k` at once and
   schedules the reprojection for the next frame, so a draw can ask for a level
   that was *not* rebuilt for the current centre. Its index list belonged to the
   previous geometry and ran up to **845 vertices past the end** of the piece (15
   pieces on the 10m layer), which paints garbage. `rebuildLevels` now drops every
   level it did not rebuild, `pieceLevelIndex` only trusts a level whose recorded
   point count matches the piece, and `pieceFlat` falls back to full detail rather
   than to an invalid index. `artifact_test.js` covers the sequence.

2. **Sub-pixel pieces.** At the world view **1 567 of the 2 336 pieces** of the 10m
   layer are under one pixel across — islets, reefs, a single rock — carrying
   15 207 vertices in steps of less than 0.05 px. As polygons they are degenerate,
   and the canvas renders those micro-steps as slivers and streaks off the
   coastline. They are now culled at draw time when their bbox is under 1 px
   (reported in the HUD as `+1 567 sub-pixel`), which is both cleaner and faster;
   zooming brings them back the moment they can be seen.

The thin crescent of India near the limb is **not** an artifact: India's east coast
reaches 97 °E, which is behind the horizon when the centre is 0°, 0°, so what is
visible is a sliver that narrows to the rim. Verified three ways — the drawn result
at the LOD level in use is pixel-identical to full detail (0 px difference), no
vertex lies outside the disc, and the source data really does extend past the
horizon. Moved to a centre of 80 °E the same geometry draws as a normal country.

### Why not a grid?
A tile grid (MVT/XYZ style) would cut the *per-frame* work further, but the cost
here is not per-frame geometry lookup — the piece-level viewport cull already gets
that down to what is visible. A grid would help if the data had to be streamed,
which it does not: 11 MB parses in ~150 ms and lives in memory. What *would* pay off
at deeper zooms is clipping the pieces to the screen rectangle before adding them to
the path (a canvas `clip()` per feature or a Sutherland-Hodgman in plane space), so
that a coastline crossing the screen is not walked to its off-screen end. That is
the next step if a zoomed drag ever drops frames; today it runs at 60.

## The 10m layer

The 10m layer is the **default**. Its 11 MB is fetched in the background: the app
paints with the 50m layer immediately and swaps 10m in place (same centre, zoom and
selection) when it arrives, unless the user has picked a layer meanwhile.

`shp2geojson10m.py` converts Natural Earth **10m admin-0 map units** (v5.1.1, 298
features, 552 828 raw vertices) with the same conventions as its siblings: Eckert IV
planar area for `AREA_KM2`, the label attributes the app reads, coordinates rounded to
4 decimals (~11 m — under a pixel at the deepest zoom) to keep the file at 11 MB
instead of 20.

It is **lazy**: fetched, densified and given its 10-step LOD ladder only when the
layer is picked (`layer` key cycles 50m → 110m → 10m, or the menu row, or
`?layer=10m`). Measured: 148 ms parse + 213 ms build + 40 ms vectors, 564 320
densified points, 10.6 MB of ladder indices.

## Projection registry (`core.js` → `PROJ`)

A projection is one entry: `fwd(lam, phi, out)` in radians → plane, `inv(x, y)`
→ radians or `null`, plus the flags the rest of the file switches on.

| key | label | equal-area | pseudocyl | frame clip | recenterable |
|---|---|---|---|---|---|
| `persp` | Perspective (3 R) **(default)** | no | no | cone, cap 70.5° | yes |
| `ortho` | Orthographic | no | no | cone, cap 90° | yes |
| `eckert4` | Eckert IV | yes | yes | seam (lon′ = ±180) | yes |
| `equirect` | Equirectangular | no | yes | seam | yes |
| `cylEqualArea` | Cylindrical equal-area (Gall, φ₀=45°) | yes | yes | seam | yes |
| `azimuthalEq` | Azimuthal equal-area | yes | no | antipode (a point) | **no** |

**`clip` is where the frame edge is, and it decides how a ring is cut:**

* `'seam'` — pseudocylindrical. The frame edge is the meridian lon′ = ±180, which
  the projection renders on *both* sides of the frame.
* `'cone'` — the visible cap X′ ≥ `clipCos`. This is what stops a 2-to-1 projection
  from painting the hidden hemisphere over the visible one. `clipCos = 0` is the
  orthographic (hemisphere, rim radius 1); `clipCos = 1/P` is the vertical
  perspective from P Earth radii (rim radius √((P−1)/(P+1)) = 0.707 at P = 3).
  A run cut at the cap is closed along the **rim**, which is a circle in the plane,
  so the two possible closing arcs differ by exactly the disc's area — the smaller
  one is taken.
* `'none'` — nothing to cut (azimuthal equal-area covers the whole sphere).

`pseudocyl` means lon enters the forward map linearly, which is exactly what makes
the cut at lon = ±180 land on straight frame edges — that is why the geographic
clip (`clipLonF`) is exact for that family. A non-pseudocylindrical projection's
frame edge is a curve, so `rotateRingLL` clips it to the visible hemisphere as a
3-D half-space (exact, and the crossing points land on the horizon) and the ring
is densified by slerp, never by lon/lat interpolation. `azimuthalEq` is left out of
the app: its frame edge is the antipode, a single point, so a ring crossing it must
be split there, which is not the hemisphere case — measured, recentring it near the
original antipode double-counts land (plane-area ratio 4.5 instead of 1.0).

Adding a projection = one `PROJ` entry (the menu rows and `?proj=` read the table),
plus the round-trip test in `test_core.js` for its inverse.

## Burger menu
Top-left `≡` picks the view: **Map (2D)**, **Globe**, or one of the projections
above (the 2D map is re-projected on the fly, keeping the geographic centre). The
**Globe** is the lit 3D sphere those same lon/lat rings wrap onto
(the lit 3D sphere those same lon/lat rings wrap onto). Closed, the burger carries a
tag naming the active view, so the current mode is readable at a glance; tapping it
opens the column of choices, tapping a chip switches and closes. A chip is a pick,
not a toggle — clicking the active one only re-opens. `m` still toggles directly.
`?mode=2d|3d` forces the initial view. The menu sits outside `#stage` and owns the
pointer events, so clicking it can never pan or hover the map underneath.

## Globe geometry
The lon/lat -> xyz frame is right-handed (`z = -cos(lat) sin(lon)`), which is what
puts the camera-facing hemisphere in the usual orientation; `sphToVec`, `uv` and
`placeCamera` must all agree or the globe mirrors.

The ear clipper (`core.js triangulateRing`) is good on COVERAGE but bad on SHAPE:
densification inserts nearly-collinear vertices, so 24-48 % of the triangles have
a minimum angle under 2 degrees. `refineTri` (Lawson flips, vendored verbatim from
earcut v3.2.4) legalizes the interior edges and drops that to 1.2-4.9 %, keeping
the triangle count and the covered area identical. It mutates in place and returns
nothing. Triangulations are cached per (ring, LOD level) in `ring.tris[]`, so a
zoom that crosses an LOD threshold swaps cached meshes instead of re-clipping
(measured: 2.9 s first build, 1 ms rebuild).
