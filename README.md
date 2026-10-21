# KwizzyGeo

Geographical Quiz Game — the map half: a pure HTML/CSS/JS view of Natural Earth
admin-0 country polygons, no libraries and no map tiles, drawn on one fullscreen
`<canvas>` in the **Eckert IV** equal-area pseudocylindrical projection.

**Data: [Natural Earth](https://www.naturalearthdata.com/), public domain** — the
50m sovereignty, 110m countries, 10m map units and 10m populated-places layers, at
v5.1.1 / v5.1.2, converted by the scripts in `tools/`. If another source is added
later it goes in that list, and in the credit line at the bottom of the map's menu.

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
index.html  style.css  core.js  app.js                   <- the app
data/   so50.geojson  countries.geojson  ne10m.geojson  places.json
tests/  test_core.js  gesture_test.js  pole_test.js  ...   <- node only
tools/  shp2geojson_places.py                              <- data prep, no runtime
```

| file | role |
|---|---|
| `index.html` | the map canvas + the overlay divs (panel, hud, help, menu) |
| `style.css` | fullscreen layout, panel styling, touch/mobile tweaks |
| `core.js` | projection registry + geometry + re-centring, pure functions (unit-tested by `tests/test_core.js`) |
| `app.js` | rendering, centre-of-projection moves, hover/pick, mouse + keyboard + touch |
| `data/so50.geojson` | the default data: 201 features, MultiPolygon, lon/lat degrees |
| `data/countries.geojson` | 177 features |
| `data/ne10m.geojson` | Natural Earth **10m admin-0 map units**: 298 features, 552k raw vertices, 11 MB (lazy-loaded) |
| `data/places.json` | Natural Earth **10m populated places**: 7,342 cities as a point table, 0.59 MB |
| `data/cities.<code>.json` | the localised city names, one file per language (18), fetched only when that language is picked |
| `data/flags/<cc>.svg` | 249 country flags, vendored SVGs (see **Flags**) |
| `flags.css` | the generated stylesheet: `.fi` / `.fi-fr` → the right SVG |
| `tools/shp2geojson_places.py` | the converter for that table (shapefile -> `data/places.json` + the 18 `cities.<code>.json`) |
| `tools/shp2geojson10m.py` | the 10m map-units converter, including every `NAME_<CODE>` the selector needs |
| `tools/fetch_flags.py` | copies the flags the app can ask for and regenerates `flags.css` |
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

Upload the four app files at the root and `data/` beside them; `tests/`, `tools/`,
the README and the licence are never fetched, so leave them out if the host serves
only the game. `index.html` needs `style.css`, `core.js` and `app.js` next to it;
the layers must keep the `data/` prefix, or `DATA_DIR` must be changed to match.

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
changes.

`tools/shp2geojson_places.py` rebuilds the table from the shapefile:

    curl -O https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip
    unzip ne_10m_populated_places.zip && python3 tools/shp2geojson_places.py \
        ne_10m_populated_places.shp data/places.json

## Labels: three voices

An atlas distinguishes its label kinds and this one does too, because the reader has
to tell a country from a capital from an ordinary city without reading the name —
and colour alone fails for a colour-blind reader, or for a name over pale land. All
three are drawn through one table, `LABEL_STYLE`:

| kind | case | weight / size | colour | marker |
|---|---|---|---|---|
| **country** | UPPERCASE, letter-spaced | 600 / 10.5 px | muted `rgba(226,238,248,.72)`, thin halo | — |
| **capital** (`A0`, `A0R`) | Title Case | **700 / 12 px** | white `.98` | dot **plus a white ring** |
| **city** | Title Case | 400 / 11 px | white `.96` | plain dot |
| **the selected country's capital** | Title Case | 800 / 12.5 px, tracked | accent `#8ed0ff` | — |

The capital used to be **gold**, which was the wrong voice: gold read as a
warning/accent colour competing with the selection highlight, and a map with a
dozen capitals on screen turned into confetti. A capital is now emphasis by
**weight** — how an atlas does it — and the accent colour has exactly **one**
meaning: the thing you selected. So the capital of the selected country is drawn in
`#8ed0ff`, and so is the city you clicked.

Tracking is real for the country labels (`ctx.letterSpacing` is not available
everywhere, so `drawTracked()` places each character and the collision box is
measured **with** the tracking — a box that ignores it lets labels overlap by a few
px per letter). The two city voices have no tracking: a couple of tenths of a px per
letter buys nothing that weight and size do not already say, and it would cost one
`fillText` + one `strokeText` per *character* — a deep zoom shows ~60 city names,
i.e. ~1 000 canvas calls a frame instead of ~150 (measured).

A capital's dot is also ringed, not merely bigger: two identical dots of different
size read as "same thing, further away", which is the wrong message. And a **ringed
capital is never left nameless** while the space for its name is free — measured at
z 4, three of nine capitals were ringed and silent because a country name happened to
sit above them. Two fixes: capitals are exempt from the `LABELRANK` cut that prunes
ordinary towns at a coarse zoom (they are still subject to the collision test, so a
crowded corner drops what does not fit), and a city label that collides above its dot
tries once **below** it before giving up. City labels are placed after country labels
against the same boxes, so a city never lands on a country name.

## Language

The map speaks **18 languages**, and it is Natural Earth's data all the way down:
`so50.geojson` / `ne10m.geojson` carry `NAME_<CODE>` for each, and the places carry
`NAME_<CODE>` too. The selector is a wrapping row of chips in the burger sheet, under
**Language**, each labelled in its own script so a speaker finds it without reading a
list of exonyms; `?lang=fr` and `localStorage` set it too.

**Only the 18 languages both layers carry are offered.** Natural Earth has Italian,
Polish and Turkish city names but no Italian/Polish/Turkish *country* names — offering
Italian would put Italian city names on a map whose country names stayed English,
which is worse than not offering Italian. (The optional 110m layer carries only six;
there the app falls back to the English name.)

**City names are a separate file per language.** Eighteen languages × 7 342 places
would double `places.json`, so `data/cities.<code>.json` holds only the names that
**differ** from the base name — 31 kB for French (1 536 of 7 342 differ), 182 kB for
Russian and ~150–250 kB for a non-Latin script, where every name differs. The file is
fetched the first time that language is picked and never before, so a player who never
opens the selector downloads nothing.

**The index trap.** Those files are keyed by the *position* of a place in
`places.json`, so a file built from another Natural Earth release would put "Londres"
on Lagos and nothing would crash. Both sides therefore carry `sum`, a fingerprint of
the place list, plus `n`; the app refuses a mismatch and falls back to the base names.
`tests/lang_test.js` checks the real files against each other, and checks the two names
you asked about: **London → Londres**, Vienna → Vienne / Wien / Viena, Moscow → Moscou /
Москва.

A country panel shows the localised name and lists the others under **also**; a city
panel shows the localised name and puts the base name under **also** when they differ.

**Data credit** lives at the bottom of the burger sheet: *Data Natural Earth · public
domain*, linking to <https://www.naturalearthdata.com/>. That is the source of every
layer, and it is public domain, so the credit is a courtesy rather than an obligation —
but it belongs where a curious player can find it, not only in this README.

### Bumping the data
The scripts carry `?v=N` in `index.html`; the data files carry `DATA_V` in `app.js`,
because they are fetched by code and a rebuilt layer would otherwise keep coming from
the browser cache. **Bump `DATA_V` whenever a file in `data/` changes.**

## Capitals

**A country can have several capitals, and Natural Earth says which is which** in
`CAPIN`: South Africa has three (Pretoria administrative, Cape Town legislative,
Bloemfontein judicial), Bolivia two (Sucre constitutional, La Paz administrative), the
Netherlands two (Amsterdam de facto, The Hague official+legislative).

The panel used to take the first match, and for South Africa that named
**Bloemfontein** — the judicial seat, 460 000 people — as "the capital". The rule now:

1. only places Natural Earth flags as the country's capital (`ADM0CAP = 1`), so a
   former capital, a regional capital, or a place filed `Admin-0 capital` with no role
   and no flag (Johannesburg) is not a candidate;
2. among those, the **administrative** seat leads — that is what a reader means by
   "the capital";
3. every other seat is listed under it **with its role**, which is the point of the
   exercise.

`CAPIN` is stored at 16 characters by Natural Earth, so values arrive truncated
(`"Legislative cap"`, `"Official, legis"`), plus one typo (`"Offical capital"` on
Dodoma) and three values that are not roles at all (`"UN Headquarters"` on New York,
`"EU Parliment"` on Strasbourg, `"While Jerulsale…"` on Tel Aviv). `CAP_WORDS` in
`app.js` recognises every value that appears in the data and `CAP_ORDER` normalises the
display order, so a second role arriving after a comma or an "and" is not lost.

A city panel also shows the role when the city is a capital.

## Links out

Two buttons at the bottom of every panel:

* **Wikipedia** — the article for the **English** name (`NAME_EN` for a country,
`e` for a city), not the name on screen: the panel follows the language selector and an
encyclopedia does not. Verified: all 201 country names in the 50m layer resolve to an
article as-is. City names mostly do — 239 of 7 100 do not, and 1 427 are disambiguation
pages — which is why the URL is `w/index.php?…&go=Go`: it 302s straight to the article
when the title is right *and* falls back to the search results when it is not, in one
request. (Checked against the live API.)
* **Google Maps** — the country's `LABEL` point (or the city's own coordinates) at the
zoom on screen.

**Right-click the map** (or **long-press** on touch) for the point menu: the coordinates
under the cursor, the zoom, *Open in Google Maps* at that scale, and *Copy coordinates*.
The long press is cancelled by any movement, so it can never fire mid-drag, and the menu
flips back inside the viewport when opened near an edge. The copy button falls back to
`execCommand` because `navigator.clipboard` needs a secure context and this app is served
over plain HTTP on a LAN box.

## Flags

Country flags are SVG, from **[lipis/flag-icons](https://github.com/lipis/flag-icons)**
— MIT licence, © 2013 Panayiotis Lipiridis (the licence text ships as
`flags.LICENSE.txt`, beside the CSS). Class names are the library's own, so the API
is one line:

```html
<span class="fi fi-fr"></span>          <!-- 4:3 -->  <span class="fi fi-fr fis"></span>  <!-- square -->
```

**Vendored, not `<link>`-ed from a CDN.** The app is a static page that has to work
served from a LAN box with no internet, and its whole ethos is "no libraries, no
tiles". A `<link>` to jsDelivr would make every viewer fetch a third-party asset and
would make the flags vanish in exactly the case where the map still works. So
`tools/fetch_flags.py` copies the 249 SVGs the app can actually ask for (1.6 MB, of
which a browser fetches only the ones it paints — each flag is a `background-image`)
and generates `flags.css`. Re-run it after adding a layer:

    curl -sSLo f.zip https://github.com/lipis/flag-icons/archive/refs/tags/v7.6.0.zip
    unzip f.zip && python3 tools/fetch_flags.py flag-icons-7.6.0

**Where a flag shows:** on the name row of a country panel, on the name row of a city
panel (from the city's country), and on each language chip.

**Natural Earth does not simply give the ISO code**, and pretending it does is how you
get no flags on half the interesting countries: `ISO_A2` is `-99` for 17 features of the
50m layer — France, Germany's neighbours, Norway, the Netherlands, the United States,
the United Kingdom, New Zealand, Israel, Finland, Denmark, Georgia, Australia, China —
and sub-codes like `CN-TW` / `FR-973` appear as well. `NE_ISO2` in `app.js` maps the
unambiguous ones by `GEOUNIT`, and the genuinely ambiguous ones — **Somaliland,
Northern Cyprus, Siachen Glacier, the UNDOF Zone** — are deliberately left **without a
flag** rather than given a wrong one. A flag is a claim about sovereignty; a missing
one is honest, a wrong one is not.

**A language is not a country.** The flag on a language chip is a convention — the
language's main country of origin — and it is one table (`LANG_FLAG`), because it is a
judgement call: `en` → gb rather than us, `pt` → pt, `ar` → sa, `es` → es. Change a
line and the chip follows.

## Glass

Every floating surface — HUD, help line, info panel, menu sheet, scrim — is the same
material, defined once as CSS custom properties (`--glass-tint`, `--glass-blur`,
`--glass-border`, `--glass-shadow`) so the pieces cannot drift apart: they used to
have four slightly different alphas, which read as "unstyled" next to each other.
A translucent dark tint, a real `backdrop-filter` that frosts whatever is under it, a
hairline light border and a soft shadow.

Two decisions worth knowing:

* the tint stays at **.55–.72 alpha**, not .25: `backdrop-filter` is still missing on
  some builds, and where it is the tint alone has to keep pale text legible over pale
  land.
* the blur radius stays at **14 px**. A larger radius on a full-screen surface costs a
  lot of fill rate on a phone GPU for a difference nobody can see over a map.

## Two idle animations

### North up

A cone projection's frame is a **rotation matrix**, and a drag that is not a pure
great-circle move leaves it rolled about the view axis — the picture is TURNED, so
north is no longer up and the map reads as tilted. That roll is measurable exactly
(`core.frameRoll`: the angle between the frame's up row and the up row of the
canonical frame of the same centre, signed by the frame's own east row) and
removable exactly (`core.rollFrame`: mix rows 1 and 2, leave row 0 — the centre —
untouched). So the app tilts the picture back, and the centre and the zoom never
move.

It is deliberately timid: it waits **0.14 s of stillness** (it must not fight the
gesture that made the roll — a map that untwists under your finger feels like it is
slipping away), it is an **exponential settle** (τ = 0.35 s) with a **rate cap of
0.8 rad/s ≈ 46°/s** so a 120° roll takes ~3 s and a 5° one under a second. Measured
rolls: a diagonal drag leaves 1–10°, a straight drag across a pole **154°**. It is
off at |lat| > 89.4° (at the pole "up" has no direction and the canonical frame is an
arbitrary choice of longitude, so aligning would spin the map — the very bug the
matrix-carrying frame was introduced to fix), and off for the pseudocylindrical
projections (there the frame's axes ARE the map's up and right, so
a roll is not cosmetic). `?north=0`, or the burger's **Overlay → North up** row
turns it off.

### Fly-to on double click / double tap

One gesture, two triggers: a **double click** on a desktop and a **double tap** on a
touch screen run the same handler (`gestureGo`). They used to be two different rules
— the click flew, the tap did a bare 1.7× zoom plus a recentre — so a phone got a
different, worse answer to the same question and threw away the selection. The old
double-tap behaviour is gone.

**Where it lands.** The destination zoom is *computed from the target's own bounding
box*, not a fixed factor: `core.featureExtent` rotates the country's lon/lat ring into
the frame centred on the destination and projects it (skipping the hidden cap on a
cone projection, and placing the two halves contiguously on a seam projection so a
country straddling the antimeridian does not report a box the width of the world).
`k` is then the one that fits that box to the viewport with 6 % of margin per side.
Measured: z 3 → **4.7 for Italy** (box uses 88 % of the screen), and a fixed 2× would
have left France at a quarter of the screen and Vatican City as a dot.

Two refinements that matter in practice:

* **it re-centres on the box, not on the click.** Centring on the click leaves the
  country off-centre by however far the click was from its middle; the box centre is
  turned back into lon/lat (frame inverse) and measured again. Rotating the frame
  changes the *shape* of an axis-aligned box, so this is iterated — measured for
  Germany: 0.054 plane units off after one pass, 3e-4 after two, 0 after three. Three
  passes at click time, a few ms, for a country that is actually centred.
* **a city beats the country under it**, exactly as it does for picking. A city has no
  box, so its destination is a fixed street-level zoom (z 7) — but **never a zoom
  out**, so double-clicking a city while already closer in does not pull back. Open
  ocean (no feature at all) keeps the old behaviour: zoom in 2× about the point.

Then the animation itself: one 950 ms timeline with three **overlapping** phases (a
strict sequence reads as three separate jerks):

```
0.00–0.34   k falls to 45 % of the closer of the two zooms   (dezoom)
0.16–0.86   the centre travels the great circle to the click  (translate)
0.62–1.00   k rises to the destination zoom                  (zoom)
```

**The tilt travels with the flight.** The north-up animation deliberately stands down
while a flight is running (a slow drift under a moving camera reads as the horizon
sagging), which used to mean the journey ended with the zoom settling and *then* the
picture sliding upright — two movements where the user asked for one. The flight now
untwists on its own clock and is guaranteed north-up on the last frame. Two things had
to be true for that:

* the destination zoom is computed **in the frame the flight will arrive in**, not the
  one it starts from (a rolled frame measures a different axis-aligned box: Russia
  fitted to 88 % of the viewport from a rolled start and arrived at 55 %);
* `moveCentre` on a cone projection is parallel transport, which keeps the roll it
  starts with — and that drifts relative to the canonical frame as the path bends, so
  transporting from a north-up start does **not** land north-up. The measurement frame
  is therefore straightened after every move.

The centre path is a **slerp of the two unit vectors**, not an interpolation of
lon/lat: a linear interpolation near a pole looks like the world skidding sideways,
and it would not follow the shortest route. The zoom is the *sum* of two smoothstep
ramps, so k is continuous at every phase boundary. Any new gesture — mousedown,
wheel, a second double click — cancels the flight: an animation that keeps running
under the user's finger is a bug, not a feature. `window.ViewState` exposes
`rollDeg()`, `centre()`, `k()`, `flying()` so the tests can assert on the animations
rather than on pixels.

## Interaction

* **mouse** — wheel = zoom, drag = move the centre of projection (the world turns
  under the pointer, both axes), shift+wheel / horizontal trackpad = move the
  centre, double-click = fly there at the zoom that fits it (see below), move =
  hover, click = pick
* **keyboard** — arrows = move the centre, `a`/`d` = zoom, `t` = switch layer,
  `c` = cities on/off, `Enter` = pick the hovered city or country, `Esc` = clear,
  `r` = reset to whole world
* **touch** — 1 finger drag = move the centre, 2 fingers = pinch zoom, a tap picks,
  a double tap flies to the place (the same flight as a double click, and the same
  fitted destination zoom)
* **URL params** (debugging): `?z=6` zoom level (z 2 = fitted world),
  `&lon=178&lat=-18` centre of projection, `?layer=110m|10m` layer,
  `?proj=ortho` projection (any `recenter: true` entry of `PROJ`), `?dbg=1` shows
  the reprojection time, piece count and viewport in the HUD

**Tests.** Fourteen node scripts in `tests/`, run as `node tests/<script>.js` (they
locate `core.js`, `app.js` and the data through `__dirname`, so the working
directory does not matter). All fourteen exit 0: the twelve asserting ones end in
`ALL PASS` (`harness.js` only prints and asserts nothing), and `polarchk.js` /
`visible_check.js <proj>` print per-centre tables to read.

| script | what it checks |
|---|---|
| `test_core.js` | 46 unit checks on `core.js`: projection maths, inverse round trip, equal-area, picking, LOD, orthographic back-face audit |
| `gesture_test.js` | 57 checks through the real handlers: inertia and its frame-rate independence, tap-vs-drag, double tap, menu activation and scrim, the **north-up tilt** (a diagonal drag rolls the frame, the tilt waits for the gesture to end, settles to 0, does not move the centre, obeys its toggle) and the **fly-to** (pulls back before it comes in, is cancelled by a press, **arrives already north-up** (the tilt travels with the flight), lands the target's box centred and filling 75-90 % of the viewport for France/Vatican/Russia, and a **double tap reaches the same place at the same zoom as a double click**) |
| `pole_test.js` | the centre of projection turns the frame by exactly the angle travelled, and the frame never drifts across a pole |
| `pole_sim.js` | the same on the app's own chain (pan → `geoAt` → `moveCentre` → reproject), per re-centring projection |
| `artifact_test.js` | no stray geometry after a wheel zoom between two reprojections, a drag and a layer switch |
| `polarchk.js` | audit table: how far the drawn picture diverges from the true visible land, per centre (cone projections) |
| `harness.js` | headless app run: draw, hover, pick, layer switch, HUD |
| `visible_check.js <proj>` | what is painted vs the source data, per centre |
| `grat_test.js` | the graticule covers every visible meridian/parallel, at 8 centres x 2 zooms x all 5 re-centring projections (161 checks) |
| `places_test.js` | the city table is well formed, and its visibility rule matches the geometry (a place, its antipode, the limb) at 8 centres (42 checks) |
| `links_test.js` | the capital rule (South Africa → Pretoria, all three seats listed, Johannesburg excluded; Bolivia/Netherlands/Malaysia/Japan; Lagos and New York rejected), every `CAPIN` value parses, both URL builders, and the spot menu open/place/flip/close plus the long press (56 checks) |
| `flags_test.js` | every code the app can ask for has an SVG and a CSS rule (driven by the two tables, parsed out of `app.js` so they cannot drift); every `url()` resolves; the licence ships; and Somaliland / Northern Cyprus / Siachen stay deliberately flagless (106 checks) |
| `lang_test.js` | the 18 language files match the place list (fingerprint and count), London→Londres and the other spot checks, every offered language has country names, the switch localises both the labels and the panel, and a wrong fingerprint is refused (126 checks) |
| `labels_test.js` | the three kinds of name are drawn differently — case, font, colour, tracking, and the capital's exemption from the rank cut (19 checks) |

The measurement probes quoted in this document (`recenter_cost.js`,
`poletest2.js`, `rollpc2.js`, the `shp2geojson*.py` converters) are deliberately
**not** in this repository: they were one-off instruments, and their numbers are
recorded here instead.

Colours as requested: blue ocean (vertical gradient), light grey countries,
white on hover/pick. The panel shows name, localised names, type/sovereign,
region, area, **capital** (with its population, from the place layer), population, GDP,
economy, ISO codes and geometry stats.

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
that travelled more than 12 px is a scroll, not a choice.

**Touch gestures.** A tap picks; a drag of more than 8 px pans and flings; a second
tap within 320 ms and 40 px runs the **same fly-to as a double click**; two fingers
pinch. Previously a
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

### The other 2D projections are archived

`core.js` still carries the whole registry — Eckert IV, equirectangular, cylindrical
equal-area, azimuthal equal-area — and every one of them still renders exactly what it
did (`?proj=eckert4` works today). What changed is that the **menu no longer offers
them**: with the perspective default the pseudocylindrical world maps are a
curiosity rather than a way to play, and eleven rows in a sheet that a phone user
opens on every session is a real cost.

The switch is one flag in `app.js`, and it was written as a flag rather than a
deletion precisely so the feature can come back:

```js
var ARCHIVED_PROJECTIONS = true;   // false brings the whole section back
```

Kept for a future feature — a "compare projections" screen, a printable world map, an
about page.

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
Top-left `≡` opens a sheet grouped **Layer** and **Overlay** — three data layers and
two toggles (Cities, North up). Closed, the burger carries a tag naming the active
projection, so what you are looking at is readable at a glance; tapping a row
applies it and closes the sheet. The menu sits outside `#stage` and owns the pointer
events, so clicking it can never pan or hover the map underneath.

There is no "View" group any more: **the globe view was removed on 2026-10-21**, with
its vendored three.js bundle (`three.bundle.cjs`, 1.3 MB), the GL renderer, the
ear-clipper / Lawson-refinement triangulation it needed, the globe LOD "sewing" pass
and the `#ggl` canvas. The map is the app. The alternative 2D projections remain in
`core.js` behind `ARCHIVED_PROJECTIONS`.
