/* Eckert IV viewer: fullscreen canvas, wheel/pinch zoom, drag pan, hover + pick.
   Projection + geometry come from core.js (window.AppCore). */
(function () {
'use strict';

var C = window.AppCore;
var stage = document.getElementById('stage');
var canvas = document.getElementById('map');
var panel = document.getElementById('panel');
var hud = document.getElementById('hud');
var helpEl = document.getElementById('help');
var ctx = canvas.getContext('2d');

/* surface any runtime error visibly: this page has no console access */
function fail(msg) { hud.textContent = 'ERROR ' + msg; }
window.onerror = function (e, url, line, col, err) {
  fail((err && err.stack ? err.stack.split('\n')[1] : String(e)) || 'unknown');
};


var DPR = 1, W = 0, H = 0;
var feats = [], frame = null, grat = null, layout = [];
/* The 2D view's state. cx/cy are NO LONGER a plane position: the view centre is
   a GEOGRAPHIC point (view.lon/view.lat) that becomes the centre of projection,
   and cx/cy are only its plane image (what sx/sy subtract), recomputed whenever
   the centre moves. k is screen px per plane unit. */
var view = { cx: 0, cy: 0, k: 100, lon: 0, lat: 0 }, fitK = 100;
/* THE CITY LAYER: data/places.json (Natural Earth 10m populated places, 7 342
   points, see tools/shp2geojson_places.py). Switched on/off with `c`, the
   burger's Overlay row, or ?cities=0|1. */
var places = [], citiesOn = true, placeSeen = 0, placesSum = '';
var hoverPlace = -1, pickedPlace = -1;

/* ---------- NORTH-UP TILT ----------
   A cone projection's frame carries a ROLL on top of its centre: a diagonal drag,
   or a drag that crosses a pole, leaves the picture turned about the view axis, so
   north is no longer up and the map reads as "tilted". The frame is a rotation
   matrix, so this is fixable exactly (core.frameRoll / core.rollFrame): measure the
   roll against the canonical frame of the same centre and turn the frame back by
   it, leaving the centre and the zoom untouched.
   It runs only when the view is IDLE - a second after the last drag, wheel, key or
   fly - because fighting the gesture that created the roll would feel like the map
   is slipping away under the finger. Rate-limited as well as time-constant, so a
   154 deg roll (measured after walking over a pole diagonally) cannot whip round
   in one frame. `?north=0` or the burger's Overlay row turns it off. */
var northUp = true;
var ALIGN_TAU = 0.35;            /* s: exponential settle */
var ALIGN_MAX_RATE = 0.80;       /* rad/s (~46 deg/s): always gentle, still finite -
                                    a 120 deg roll (easy to build with a long diagonal
                                    drag) settles in ~3 s, a 154 deg one after a pole
                                    crossing in ~3.5 s, and a 5 deg one in under a
                                    second, because the exponential does the shape and
                                    the cap only stops it from whipping */
var ALIGN_EPS = 0.0025;          /* rad (~0.14 deg): done */
var ALIGN_DELAY = 0.14;          /* s of stillness before it starts */
var ALIGN_POLE = 89.4;           /* deg: at the pole "up" is undefined (see the FRAME comment) */
var lastMoveT = 0, alignPrev = 0;

/* ---------- FLY-TO (double click) ----------
   "Dezoom, translate, zoom": one 950 ms timeline with three overlapping phases, so
   the target country stays in view while the world turns under it:
     0.00-0.34  k falls to kMin (45 % of the closer of the two zooms)
     0.16-0.86  the centre travels along the great circle to the clicked point
     0.62-1.00  k rises to the destination
   The phases overlap on purpose: a strict sequence reads as three separate jerks. */
var fly = null;
var FLY_DUR = 950;
/* THE FRAME IN PLAY: a rotation matrix, not just the centre's lon/lat.
   WHY (measured, viewer/poletest2.js): rebuilding the CANONICAL frame
   rotMat(lon,lat) at every centre move pins the in-plane roll to the EQUATOR, so
   near a pole - where the equator direction is undefined - the world SPINS by the
   centre's longitude while the finger barely moved: at 89.999N a 0.01 deg drag
   turned the frame 84.29 deg, and crossing a pole dead-on flipped it 180 deg.
   That is the "rotation problem when arriving to poles in orthographic and
   perspective". The drawn geometry was always right (the pole audit polarchk.js
   is within 0.2 % at every centre, poles included); it is the ORIENTATION that
   jumped. So the view carries the rotation and setCenter re-aims its axis with
   C.rotFrom, which turns the frame by the angular distance travelled and nothing
   more, at every latitude; crossing a pole parallel-transports the roll, so north
   stays up on the far side instead of flipping. view.lon/lat are DERIVED from the
   frame afterwards, so the HUD still reads the true centre of projection. */
var FRAME = new Float64Array(9), FRAME2 = new Float64Array(9);
var FCEN = [0, 0];
C.rotMat(0, 0, FRAME);                  /* start canonical: identity */
/* Key in C.PROJ. PERSPECTIVE (3 Earth radii) is the default now: the user asked
   for perspective always, and it is the same cone-clipped family as the
   orthographic - it just keeps the horizon at cos c = 1/P instead of 0, so the
   limb has the depth cue of a globe instead of a flat disc. `?proj=ortho` still
   gives the flat hemisphere.
   Both were the two projections where arriving at a pole exposed the rotation
   problem (see the FRAME comment above); the fix is the same for both, because
   the fix is in the view's rotation, not in the projection.
   ?proj= overrides it. */
var projID = 'persp';
var menuEl = document.getElementById('menu');
var burgerEl = document.getElementById('burger');
var itemsEl = document.getElementById('items');

/* the burger menu: closed it is only the burger, whose tag names the active
   view; opening it stacks the choices in a column underneath. A chip is a PICK,
   not a toggle: clicking the active one only re-opens the menu, so clicking
   twice can never undo a choice the user already made. */
/* The menu is GROUPED (View / Projection / Layer). One flat list of twelve rows
   was fine on a desktop panel but ran off the bottom of a phone screen, and a
   phone user cannot tell which of "Eckert IV" and "50m sovereignty" is a
   projection and which is a layer. The groups are built from this model, so
   adding a projection or a layer to the registries still needs no edit here. */
/* ---------- ARCHIVED: the alternative 2D projections ----------
   The projection registry in core.js is untouched and every entry still works
   (`?proj=eckert4` renders exactly what it did). What changed is that the MENU no
   longer offers them: with the perspective default the pseudocylindrical world
   maps are a curiosity rather than a way to play, and eleven
   rows of a sheet on a phone is a cost paid on every open for a feature nobody uses.

   Kept, not deleted, for a future feature (a "compare projections" screen, a
   printable world map, an about page). Setting ARCHIVED_PROJECTIONS = false brings
   the whole section back with no other change - that was the point of routing the
   menu through this flag instead of deleting the code. */
var ARCHIVED_PROJECTIONS = true;
function menuGroups() {
  var projs = [], i;
  if (!ARCHIVED_PROJECTIONS) {
    for (var key in C.PROJ) {
      if (!C.PROJ.hasOwnProperty(key)) continue;
      if (!C.PROJ[key].recenter) continue;       /* cannot be shown re-centered */
      projs.push({ id: 'proj:' + key, label: '', ico: '\u25a6' });
    }
  }
  var layers = [], files = LAYERS || [];
  for (i = 0; i < files.length; i++) layers.push({ id: 'layer:' + files[i].id, label: '', ico: '\u2263' });
  /* No "View" group any more: the Globe view was removed (2026-10-21, with the
     vendored three.js bundle), so the only view is the map and a row for it would
     be a row with one choice. */
  var groups = [];
  if (projs.length) groups.push({ title: 'Projection', items: projs, needs2d: true });
  return groups.concat([
    { title: 'Layer', items: layers },
    /* one chip per language, in a wrapping row: 18 rows of a full-width menu item
       would be 800 px of sheet on a phone for something most sessions never touch */
    { title: 'Language', chips: LANGS.map(function (L) { return { id: 'lang:' + L.c, label: L.label }; }) },
    /* an overlay, not a view: the row says whether it is on, and clicking it
       toggles - a chip that is a pick (like the projection rows) would need a
       second row for "off" */
    { title: 'Overlay', items: [{ id: 'cities', label: 'Cities', ico: '\u25c9' },
                                { id: 'north', label: 'North up', ico: '\u2191' }], needs2d: true }
  ]);
}
var scrimEl = document.getElementById('scrim');
function menuOpen() { return menuEl.classList.contains('open'); }
function openMenu() {
  menuEl.classList.add('open');
  if (scrimEl) scrimEl.classList.add('on');
  /* opening the menu stops the map dead: an inertia glide under an open sheet
     would keep repainting the whole layer for nothing */
  stopInertia();
}
function closeMenu() {
  menuEl.classList.remove('open');
  if (scrimEl) scrimEl.classList.remove('on');
}
function menuLabel(m) {
  if (m.indexOf('proj:') === 0) {
    var p = C.PROJ[m.slice(5)];
    if (p) return p.label;
  }
  if (m.indexOf('layer:') === 0) return layerLabel(m.slice(6));
  if (m === 'cities') return 'Cities';
  if (m === 'north') return 'North up';
  return m;
}
/* what the closed burger says: the projection in play, which is more informative
   than "Map" */
function burgerTag() {
  return C.CUR ? C.CUR.label : 'view';
}
/* the row label and the "on" state of the projection rows come from the
   registry, and only a recenterable projection is offered */
function itemLabel(it, el) {
  if (it.id.indexOf('proj:') === 0) {
    var p = C.PROJ[it.id.slice(5)];
    el.dataset.proj = it.id.slice(5);
    return p ? p.label : '?';
  }
  if (it.id.indexOf('layer:') === 0) return layerLabel(it.id.slice(6));
  if (it.id === 'cities') return 'Cities';
  if (it.id === 'north') return 'North up';
  return it.label;
}
function buildMenu() {
  itemsEl.textContent = '';
  var groups = menuGroups();
  for (var g = 0; g < groups.length; g++) {
    var grp = groups[g];
    var box = document.createElement('div');
    box.className = 'mgroup' + (grp.needs2d ? ' needs2d' : '');
    var title = document.createElement('div');
    title.className = 'mtitle';
    title.textContent = grp.title;
    box.appendChild(title);
    if (grp.chips) {
      /* a wrapping row of small chips: one line of type each, no icon, so 18
         languages cost ~5 rows of sheet instead of 18 */
      var wrap0 = document.createElement('div');
      wrap0.className = 'chips';
      for (var c0 = 0; c0 < grp.chips.length; c0++) {
        var ch = grp.chips[c0];
        var cel = document.createElement('div');
        cel.className = 'chip';
        cel.dataset.id = ch.id;
        cel.setAttribute('role', 'menuitem');
        cel.innerHTML = flagHTML(LANG_FLAG[ch.id.slice(5)], 'fis') +
                        '<span class="nm">' + ch.label + '</span>';
        wrap0.appendChild(cel);
      }
      box.appendChild(wrap0);
      itemsEl.appendChild(box);
      continue;
    }
    for (var i = 0; i < grp.items.length; i++) {
      var it = grp.items[i];
      var el = document.createElement('div');
      el.className = 'menuitem';
      el.dataset.id = it.id;
      el.setAttribute('role', 'menuitem');
      var ico = document.createElement('span');
      ico.className = 'mi-ico';
      ico.textContent = it.ico;
      var lab = document.createElement('span');
      lab.className = 'mi-lab';
      lab.textContent = itemLabel(it, el);
      el.appendChild(ico); el.appendChild(lab);
      box.appendChild(el);
    }
    itemsEl.appendChild(box);
  }
  /* the data's provenance, where a curious player can find it without reading the
     README: the whole map is Natural Earth's, and the licence asks for the credit */
  var foot = document.createElement('div');
  foot.className = 'mfoot';
  foot.innerHTML = 'Data <a href="https://www.naturalearthdata.com/" target="_blank" ' +
                   'rel="noopener">Natural Earth</a> &middot; public domain';
  itemsEl.appendChild(foot);
  refreshBurger();
  refreshMenu();
}
function refreshBurger() {
  burgerEl.innerHTML = '\u2630<span class="tag">' + burgerTag() + '</span>';
}

/* the burger lives OUTSIDE the stage div, so its pointer events never reach the
   map handlers: a click on it (or on an open menu's rows) cannot pan/hover the
   view underneath. Only two states matter: open, or pick. */
function burgerClick() { if (menuOpen()) closeMenu(); else openMenu(); }
function menuClick(el) {
  var id = el.dataset.id;
  /* close FIRST, then act: closing last meant that an action which throws (a
     failed layer fetch) left the sheet open on top of the error, and the tap
     looked ignored. It also just feels right: the row is a choice, and the sheet
     should get out of the way as soon as it is made. */
  closeMenu();
  if (!id) return;
  if (id.indexOf('proj:') === 0) { setProjection(id.slice(5)); return; }
  if (id.indexOf('layer:') === 0) { setLayer(id.slice(6)); return; }
  if (id === 'cities') { toggleCities(); refreshMenu(); return; }
  if (id === 'north') { toggleNorth(); refreshMenu(); return; }
  if (id.indexOf('lang:') === 0) { setLang(id.slice(5)); return; }
}
/* pick a layer by id (menu row, ?layer=, or the t key) */
function setLayer(id) {
  userPickedLayer = true;
  layerName = id;
  useLayer(id);
  refreshMenu();
}
/* switching projection keeps the geographic centre, so the place you were
   looking at stays the centre of the new projection */
function setProjection(id) {
  if (!C.PROJ[id]) return;
  projID = id;
  C.setProjection(id);
  fitView(worldBounds());
  reproject();
  /* the tick and the burger tag both follow the projection: without this the menu
     went on showing the previous one as active (setLayer and setMode already
     refresh; this one was the odd one out) */
  refreshMenu();
  refreshUI();
}
/* One activation path for every input. The previous version acted on
   `pointerdown` AND again on `touchend`, which could fire twice for one tap and
   made a synthetic (test/automation) click do nothing at all. Now:
     * pointerdown only records where the press started;
     * `click` does the work - it is what mouse, touch, keyboard and automation
       all produce - and it is ignored when the finger travelled more than 12 px
       first, so scrolling the sheet with a thumb does not pick a row;
     * the scrim behind the sheet closes it on any tap outside.
   `touch-action: manipulation` in the CSS keeps the tap from picking up the
   300 ms double-tap-zoom delay. */
var pressAt = null;
function itemFromNode(node) {
  var t = node;
  while (t && t !== menuEl) {
    if (t === burgerEl) return burgerEl;
    if (t.classList && (t.classList.contains('menuitem') || t.classList.contains('chip'))) return t;
    t = t.parentNode;
  }
  return null;
}
if (menuEl) {
  menuEl.addEventListener('pointerdown', function (e) {
    pressAt = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  menuEl.addEventListener('click', function (e) {
    var target = itemFromNode(e.target);
    if (!target) return;                      /* dead space inside the sheet */
    if (pressAt) {
      var moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
      /* a scroll gesture on the sheet also ends in a click on the element the
         finger started over; 12 px is the usual slop */
      if (moved > 12) return;
    }
    if (target === burgerEl) burgerClick();
    else menuClick(target);
  });
  /* the burger is a plain button: keep Enter/Space working for keyboards */
  burgerEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); burgerClick(); }
  });
}
if (scrimEl) {
  scrimEl.addEventListener('click', function () { closeMenu(); });
  /* touchstart as well, so the sheet closes on the press rather than on release:
     on a phone a tap outside should feel immediate */
  scrimEl.addEventListener('touchstart', function (e) { e.preventDefault(); closeMenu(); }, { passive: false });
}

/* buildMenu() is called further down, right before loadAll(): it reads LAYERS and
   PROJ, whose initialisers run after this point in the file */

function dbg() { return /[?&]dbg=1/.exec(urlSearch()) !== null; }
var hover = -1, picked = -1;
var mouse = { x: 0, y: 0, inside: false };
var canvasRect = { left: 0, top: 0 };

var COL = {
  ocean: '#1e4d75', oceanDeep: '#143456',
  land: '#c9c9c7', hover: '#edf0e9', pick: '#ffffff',
  edge: 'rgba(22,36,50,.5)', graticule: 'rgba(210,228,240,.16)', frame: 'rgba(232,242,252,.5)',
  /* cities: a bright dot with a dark ring, so it reads over land (light grey) and
     over ocean (mid blue) alike; the picked one takes the accent */
  city: 'rgba(255,255,255,.95)', cityRing: 'rgba(14,26,38,.85)',
  cityPick: '#ffd166', cityLabel: 'rgba(255,255,255,.96)',
  /* three label voices, so the three kinds of name are never mistaken for each
     other: countries are quiet background (uppercase, tracked, muted), cities are
     plain white, capitals are the accent - gold, bolder, and with a ring around
     their dot */
  countryLabel: 'rgba(226,238,248,.72)', countryHalo: 'rgba(12,22,32,.62)',
  /* The capital used to be GOLD, and gold was the wrong voice: it read as a
     warning/accent colour competing with the selection highlight, and on a map with
     a dozen capitals on screen it turned into confetti. A capital is now simply
     BOLDER and slightly larger - typographic emphasis, which is how an atlas does
     it - and the accent colour is kept for ONE meaning: the capital of the country
     you have selected. */
  capitalLabel: 'rgba(255,255,255,.98)', capitalHalo: 'rgba(10,18,28,.9)',
  capitalPick: '#8ed0ff', capitalPickHalo: 'rgba(4,22,38,.92)'
};

/* ---------- screen <-> projection plane (y up) ---------- */
function sx(x) { return W * 0.5 + (x - view.cx) * view.k; }
function sy(y) { return H * 0.5 - (y - view.cy) * view.k; }
function toWorldX(px) { return (px - W * 0.5) / view.k + view.cx; }
function toWorldY(py) { return -(py - H * 0.5) / view.k + view.cy; }

/* ---------- load: 50m sovereignty is the default layer, 110m countries the alternative ---------- */
/* The 10m layer is 11 MB of GeoJSON and 564k vertices, so it is fetched on
   demand: nobody should pay that download, that parse (~150 ms) and that
   densify/LOD build (~250 ms) unless they pick the layer. Its LOD is the same
   10-step ladder as the others, computed once at load. */
var DATA_DIR = 'data/';
/* THE DATA VERSION. The scripts carry ?v=N in index.html, but the data files are
   fetched by the code, so they need their own stamp or a rebuilt layer keeps being
   served from the browser cache (measured: after regenerating ne10m.geojson with its
   19 name fields, the page kept drawing the six-field one and the country labels
   simply stayed English - no error, just stale data). GitHub Pages also caches
   through its CDN, so this is not only a local-dev concern.
   BUMP THIS whenever a file in data/ changes. */
var DATA_V = 2;
function dataURL(name) { return DATA_DIR + name + '?v=' + DATA_V; }
var LAYERS = [
  { id: '50m',  name: 'so50.geojson',      label: 'Natural Earth 50m sovereignty' },
  { id: '110m', name: 'countries.geojson', label: 'Natural Earth 110m countries' },
  { id: '10m',  name: 'ne10m.geojson',     label: 'Natural Earth 10m map units', lazy: true }
];
function layerLabel(id) {
  for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].id === id) return LAYERS[i].label;
  return id;
}
/* The 10m layer is the default: it is the good data, and the first paint must not
   wait for its 11 MB. So the startup loads the small layers, paints with 50m
   immediately, and fetches 10m in the background; when it lands the view swaps to
   it in place (same centre, same zoom, same selection). ?layer= forces any layer,
   which is also how to start straight on 10m without the placeholder. */
var layerName = '10m';
/* a layer asked for at startup but not loaded yet (10m is 11 MB): the 50m layer
   paints immediately and this one swaps in when it arrives, unless the user picks
   another layer in the meantime */
var deferLayer = null, userPickedLayer = false;
var loadingLayer = null;
/* Screen-pixel error the ladder may spend, and a manual bias in ladder steps
   (?lod=N shifts it).
   The canvas raster cost grows with the SEGMENT COUNT, and segments are what the
   ladder decides - so this is the knob that trades smoothness for frame rate.
   Measured on the 10m layer at the world view (1280x800): level 3 (0.6 px error)
   draws 53k segments for 41 fps, level 2 (1.1 px) draws 29k for 58 fps, level 1
   (2.3 px) draws 18k for 60. 1.1 px is below what the eye can follow on a moving
   map, so the budget is 1.2 px rather than 0.7: the same map at 60 fps. */
var LOD_MAXPX = 1.2, lodBias = 0;
var loaded = {};            /* id -> {feats, frame, grat, layout, count} */
var feats = [], frame = null, grat = null, layout = [];
/* label thresholds for the 50m layer: its own MIN_LABEL wins, except the 10
   "Sovereignty" rows it parks at 100 (never drawn) - for those we borrow the
   thresholds the 110m countries layer gives the same country. */
var labelRef = {};

function urlSearch() {
  var loc = (typeof window === 'object' && window.location) ? window.location : null;
  return loc && loc.search ? loc.search : '';
}
function pickProjID() {
  var m = /[?&]proj=([A-Za-z0-9]+)/.exec(urlSearch());
  if (m && C.PROJ[m[1]] && C.PROJ[m[1]].recenter) return m[1];
  return projID;
}
function pickLayerID() {
  var m = /[?&]layer=(110m|50m|10m)/.exec(urlSearch());
  if (m) return m[1];
  return layerName;
}

/* ---------- LANGUAGE ----------
   Natural Earth ships the country names in 19 languages and the place names in 26.
   The selector offers the 18 that BOTH layers carry: an Italian option would put
   Italian city names on a map whose country names stayed English, which is worse
   than not offering Italian at all.

   Country names come straight out of the layer (properties NAME_<CODE>). City names
   do not fit there - 18 languages x 7 342 places would double the base file - so
   they live in one small file per language, data/cities.<code>.json, holding only
   the names that DIFFER from the base name (31 kB for French against 182 kB for
   Russian, and a non-Latin script differs for all 7 342). A language file is fetched
   the first time that language is picked and never before, so choosing English (or
   never opening the selector) downloads nothing extra. Each file carries `n` and
   `sum`, a fingerprint of the place list it was built from: if the data is ever
   rebuilt from another Natural Earth release the indices move, and the app must
   notice rather than label Lagos "Londres". */
var LANGS = [
  { c: 'en', label: 'English' },
  { c: 'fr', label: 'Français' },
  { c: 'de', label: 'Deutsch' },
  { c: 'es', label: 'Español' },
  { c: 'pt', label: 'Português' },
  { c: 'nl', label: 'Nederlands' },
  { c: 'sv', label: 'Svenska' },
  { c: 'ru', label: 'Русский' },
  { c: 'uk', label: 'Українська' },
  { c: 'el', label: 'Ελληνικά' },
  { c: 'zh', label: '中文' },
  { c: 'ja', label: '日本語' },
  { c: 'ko', label: '한국어' },
  { c: 'ar', label: 'العربية' },
  { c: 'fa', label: 'فارسی' },
  { c: 'he', label: 'עברית' },
  { c: 'hi', label: 'हिन्दी' },
  { c: 'bn', label: 'বাংলা' }
];
/* a language is NOT a country, so this is a convention and nothing more: the flag of
   the language's main country of origin. `en` is gb rather than us, `pt` is pt,
   `ar` is sa, `es` is es (not the 20 others). It is here, in one table, precisely
   because it is a judgement call: change a line and the chip follows. */
var LANG_FLAG = {
  en: 'gb', fr: 'fr', de: 'de', es: 'es', pt: 'pt', nl: 'nl', sv: 'se', ru: 'ru',
  uk: 'ua', el: 'gr', zh: 'cn', ja: 'jp', ko: 'kr', ar: 'sa', fa: 'ir', he: 'il',
  hi: 'in', bn: 'bd'
};
var LANG = 'en';
var cityNames = {};            /* code -> {place index: name} */
var cityNamesState = {};       /* code -> 'loading' | 'ok' | 'failed' */

/* the name of a country in the language in play, falling back to the layer's own
   name: NAME_<CODE> is empty for a handful of features even in Natural Earth */
function countryName(p) {
  var v = p['NAME_' + LANG.toUpperCase()];
  if (v) return v;
  v = p['NAME_' + LANG.toUpperCase() + '_LONG'];
  return (v || p.NAME_LONG || p.NAME || '');
}
function countryNameIn(p, code) {
  return p['NAME_' + code.toUpperCase()] || countryNameEn(p);
}
function countryNameEn(p) { return p.NAME_EN || p.NAME_LONG || p.NAME || ''; }

/* the name of a place: the loaded language file when it has an entry for this
   index, else the base name. Never falls back to ANOTHER language - a half
   translated map is worse than an English name in a French map. */
function cityName(i) {
  var t = cityNames[LANG];
  if (t && t[i] != null) return t[i];
  var P = places[i];
  return P ? P.n : '';
}

/* the language survives a reload; a browser in private mode simply forgets it */
function storedLang() {
  try { return window.localStorage.getItem('kwizzy.lang'); } catch (e) { return null; }
}
function langLabel(code) {
  for (var i = 0; i < LANGS.length; i++) if (LANGS[i].c === code) return LANGS[i].label;
  return code;
}
function validLang(code) {
  for (var i = 0; i < LANGS.length; i++) if (LANGS[i].c === code) return code;
  return null;
}
function loadCityNames(code, done) {
  if (cityNames[code]) { if (done) done(true); return; }
  if (cityNamesState[code] === 'loading') return;
  cityNamesState[code] = 'loading';
  fetch(dataURL('cities.' + code + '.json')).then(function (r) {
    if (!r.ok) throw new Error('cities.' + code + ' ' + r.status);
    return r.json();
  }).then(function (j) {
    /* the fingerprint guard: refuse a file built from a different place list */
    if (j.sum && placesSum && j.sum !== placesSum) throw new Error('cities.' + code + ' is for another data release');
    if (j.n && places.length && j.n !== places.length) throw new Error('cities.' + code + ' has ' + j.n + ' places');
    cityNames[code] = j.names || {};
    cityNamesState[code] = 'ok';
    if (done) done(true);
  }).catch(function (e) {
    cityNamesState[code] = 'failed';
    cityNames[code] = {};              /* base names: a failed language is not fatal */
    if (done) done(false, e);
  });
}
function setLang(code, silent) {
  code = validLang(code) || 'en';
  if (code === LANG) return;
  LANG = code;
  try { window.localStorage.setItem('kwizzy.lang', code); } catch (e) { /* private mode */ }
  try { if (document.documentElement) document.documentElement.lang = code; } catch (e) {}
  function apply() {
    layout = buildLabels();            /* country labels are rebuilt: they carry the name */
    capCache = null;                   /* the capital lookup matches raw ADM0NAME: keep it */
    refreshMenu();
    refreshUI();
  }
  if (code === 'en' || cityNames[code]) { apply(); return; }
  loadCityNames(code, function () { apply(); });
}

/* ---------- FLAGS ----------
   SVG flags vendored from lipis/flag-icons (MIT) into data/flags, one file per ISO
   3166-1 code, and flags.css generated by tools/fetch_flags.py. <span class="fi
   fi-fr"></span> is the whole API - the library's own class names, so adding a flag
   means copying one SVG and re-running the script.

   WHY THE TABLE BELOW EXISTS. Natural Earth does not simply give the ISO code:
   `ISO_A2` is "-99" for 17 of the 50m features - France, Norway, the Netherlands,
   the United States, the United Kingdom, New Zealand, Israel, Finland, Denmark,
   Georgia, Australia, China, Kosovo, Somaliland, Taiwan, Northern Cyprus and the
   Siachen Glacier - because those rows carry a sovereignty the NE editors did not
   resolve to a single country. Sub-codes appear too ("CN-TW", "FR-973"). A -99 row
   with no mapping would simply lose its flag, so the ones that ARE unambiguous are
   mapped by their GEOUNIT, and anything genuinely ambiguous (Somaliland, Northern
   Cyprus, Siachen) is left WITHOUT a flag rather than given a wrong one. */
var NE_ISO2 = {
  'United States of America': 'us', 'United Kingdom': 'gb', 'Taiwan': 'tw',
  'Norway': 'no', 'New Zealand': 'nz', 'Netherlands': 'nl', 'Israel': 'il',
  'Georgia': 'ge', 'France': 'fr', 'Finland': 'fi', 'Denmark': 'dk',
  'China': 'cn', 'Australia': 'au', 'Kosovo': 'xk', 'Somalia': 'so',
  'Iraq': 'iq', 'Serbia': 'rs', 'Portugal': 'pt', 'Papua New Guinea': 'pg',
  'French Guiana': 'gf', 'Martinique': 'mq', 'Guadeloupe': 'gp', 'Reunion': 're',
  'Mayotte': 'yt', 'Wales': 'gb', 'England': 'gb', 'Scotland': 'gb',
  'Northern Ireland': 'gb', 'Flemish Region': 'be', 'Walloon Region': 'be',
  'Brussels Capital Region': 'be', 'Madeira': 'pt', 'Azores': 'pt',
  'Zanzibar': 'tz', 'Jan Mayen': 'sj', 'Gaza': 'ps', 'West Bank': 'ps'
};
/* a two-letter code from a feature, or '' when there is no honest answer */
function flagCodeOf(props) {
  var iso = String(props.ISO_A2 || '');
  if (/^[A-Za-z]{2}$/.test(iso)) return iso.toLowerCase();
  var m = /^([A-Za-z]{2})-/.exec(iso);          /* CN-TW, FR-973, ... */
  if (m) {
    /* the sub-code names the PARENT state, which is usually the right flag for an
       outlying territory - except Taiwan, which is its own flag and its own country */
    if (iso.toUpperCase() === 'CN-TW') return 'tw';
    return m[1].toLowerCase();
  }
  var names = [props.GEOUNIT, props.ADMIN, props.SOVEREIGNT, props.NAME_LONG, props.NAME];
  for (var i = 0; i < names.length; i++) {
    if (names[i] && NE_ISO2[names[i]]) return NE_ISO2[names[i]];
  }
  return '';
}
/* the flag as a span, or '' - never a broken image: a country with no honest ISO
   code simply has no flag, and the layout must not shift for it */
function flagHTML(code, cls) {
  if (!code || !/^[a-z]{2}$/.test(code)) return '';
  return '<span class="fi fi-' + code + (cls ? ' ' + cls : '') + '"></span>';
}

/* A CITY HAS NO ISO CODE: places.json carries the country NAME (ADM0NAME), so the
   names are indexed once per layer - every spelling a feature offers points at its
   flag - and a name that is not in the index simply gets no flag. */
var cityFlagIdx = null;
function buildCityFlagIdx() {
  cityFlagIdx = {};
  for (var i = 0; i < feats.length; i++) {
    var p = feats[i].props;
    var code = flagCodeOf(p);
    if (!code) continue;
    var keys = [p.NAME, p.NAME_LONG, p.ADMIN, p.GEOUNIT, p.SOVEREIGNT];
    for (var q = 0; q < keys.length; q++) if (keys[q] && !cityFlagIdx[keys[q]]) cityFlagIdx[keys[q]] = code;
  }
}
function flagForCountryName(name) {
  if (!cityFlagIdx) buildCityFlagIdx();
  if (!name) return '';
  return cityFlagIdx[name] || '';
}

/* ---------- the city layer ---------- */
/* data/places.json is a point TABLE, not GeoJSON: {fields:[...], places:[[...]]}.
   Read through the field names declared in the file, so the converter can reorder
   or add a column without silently shifting every value into the wrong slot. */
function buildPlaces(json) {
  var f = json.fields || [], ix = {}, i;
  for (i = 0; i < f.length; i++) ix[f[i]] = i;
  var rows = json.places || [], out = [];
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      n: r[ix.n], c: r[ix.c], r: r[ix.r],
      p: r[ix.p], z: r[ix.z], l: r[ix.l], f: r[ix.f], tz: r[ix.tz],
      lon: r[ix.lon], lat: r[ix.lat]
    });
  }
  return out;
}
/* THE CAPITAL OF A COUNTRY, from the place layer: the places whose ADM0NAME is that
   country and whose class is a national capital (A0 / A0R). Natural Earth spells a
   country the same way in both files, but not always, so the match tries the
   sovereign name, the long name and the admin name before giving up - the entries
   that differ are things like "United States of America" vs "United States".
   Returns the place index (for the panel and the map highlight) or -1. */
var capCache = null;
function capitalOf(featureIndex) {
  var f = feats[featureIndex];
  if (!f || !places.length) return -1;
  var p = f.props;
  var names = [p.SOVEREIGNT, p.ADMIN, p.NAME_LONG, p.NAME, p.GEOUNIT];
  if (!capCache) {
    capCache = {};
    for (var i = 0; i < places.length; i++) {
      var P = places[i];
      if (P.f !== 'A0' && P.f !== 'A0R') continue;
      if (!capCache[P.c]) capCache[P.c] = i;
    }
  }
  for (var q = 0; q < names.length; q++) {
    if (names[q] && capCache[names[q]] !== undefined) return capCache[names[q]];
  }
  return -1;
}

/* population, or nothing at all when Natural Earth says -99 (unknown) */
function popText(p) { return (p > 0) ? fmtNum(p) : ''; }
var PLACE_FCLASS = {
  A0: 'Capital', A0R: 'Regional capital', A1: 'Admin-1 capital',
  A1R: 'Admin-1 region capital', P: 'City', S: 'Scientific station',
  M: 'Meteorological station', H: 'Historic place'
};
/* how big the dot is: capitals read as capitals at a glance */
function placeRadius(f) { return f === 'A0' ? 3.4 : (f === 'A0R' || f === 'A1' || f === 'A1R') ? 2.6 : 2.0; }

function noteRef(geo) {          /* 110m thresholds keyed by NAME and NAME_LONG */
  for (var i = 0; i < geo.features.length; i++) {
    var p = geo.features[i].properties;
    var v = { minz: p.MIN_LABEL, maxz: p.MAX_LABEL, rank: p.LABELRANK };
    if (p.NAME) labelRef[p.NAME] = v;
    if (p.NAME_LONG) labelRef[p.NAME_LONG] = v;
  }
}

function loadAll() {
  Promise.all([
    fetch(dataURL('countries.geojson')).then(function (r) { return r.json(); }),
    fetch(dataURL('so50.geojson')).then(function (r) { return r.json(); })
  ]).then(function (pair) {
    var g110 = pair[0], g50 = pair[1];
    noteRef(g110);
    /* keepLL: the lon/lat twin of each ring. NOT for a globe any more - the 2D
       re-centre needs it (core.rotateRingLL rotates rg.xyz, and featureExtent
       reads rg.ll to measure a country's box in another frame). */
    loaded['110m'] = C.buildFeaturesLOD(g110, 0.2, true);
    loaded['50m'] = C.buildFeaturesLOD(g50, 0.2, true);
    /* the 2D view re-projects rings around the view centre, which it does from
       the unit vectors of the fine lon/lat ring; built once per layer here */
    C.prepareXYZ(loaded['110m']);
    C.prepareXYZ(loaded['50m']);
    projID = pickProjID();
    C.setProjection(projID);
    refreshMenu();       /* the burger tag and the projection rows read C.CUR/projID,
                            which only exist this late: without this the closed
                            burger kept saying "Eckert IV" while ortho was drawn */
    frame = C.frameFor(C.CUR, 1);
    grat = C.graticuleRot(0, 0, 2, 15, 15, C.CUR, fitK);
    layerName = pickLayerID();
    var wanted = layerName;
    if (!loaded[wanted]) {
      /* not loaded yet: paint the fastest good layer now, swap when 10m arrives */
      layerName = '50m';
      useLayer('50m');
      deferLayer = wanted;
    } else {
      useLayer(layerName);
    }
    resize();
    fitView(worldBounds());
    /* ?z=6&lon=178&lat=-18 opens at zoom 6 centred on that point, for inspection */
    var q = urlSearch();
    var mz = /[?&]z=([0-9.]+)/.exec(q);
    var ml = /[?&]lon=([-0-9.]+)/.exec(q);
    var mk = /[?&]lat=([-0-9.]+)/.exec(q);
    if (ml && mk) setCenterFresh(parseFloat(ml[1]), parseFloat(mk[1]));
    var mlod = /[?&]lod=(-?[0-9.]+)/.exec(q);
    if (mlod) lodBias = parseFloat(mlod[1]);
    if (mz) {
      zoomBy(Math.pow(2, parseFloat(mz[1]) - 2));
    }
    layout = buildLabels();
    hud.textContent = hudText();
    helpEl.textContent = helpText();
    loop();
    loadPlaces();
    /* now go and get the real layer, in the background */
    if (deferLayer) {
      var want = deferLayer;
      deferLayer = null;
      fetchLayer(want, function () {
        /* swap in place only if the user has not chosen something else */
        if (layerName === '50m' && !userPickedLayer) setLayer(want);
      });
    }
  }).catch(function (e) { fail('load: ' + (e && e.stack ? e.stack : String(e))); });
}

/* The cities arrive on their own request, after the map is already interactive:
   they are an overlay, and a slow or missing places.json must never hold up the
   countries. A failure is reported in the HUD and the layer is simply off. */
function loadPlaces() {
  var v = /[?&]cities=(0|1)/.exec(urlSearch());
  if (v) citiesOn = (v[1] === '1');
  var n = /[?&]north=(0|1)/.exec(urlSearch());
  if (n) northUp = (n[1] === '1');
  /* ?lon/&lat/&z move the centre WITHOUT a drag, so the tilt must not sit waiting
     for a gesture that will never come */
  lastMoveT = loopNow;
  fetch(dataURL('places.json')).then(function (r) {
    if (!r.ok) throw new Error('places.json ' + r.status);
    return r.json();
  }).then(function (json) {
    places = buildPlaces(json);
    placesSum = json.sum || '';
    capCache = null;
    /* the names must land before the first paint of a city label, so the language
       is applied here rather than in the URL block above */
    var ml = /[?&]lang=([A-Za-z-]+)/.exec(urlSearch());
    var want = validLang((ml ? ml[1] : '') || storedLang() || 'en');
    if (want && want !== 'en') {
      loadCityNames(want, function () { setLang(want, true); });
    }
    refreshHud();
  }).catch(function (e) {
    places = []; citiesOn = false;
    hud.textContent = hudText() + '\ncities: ' + (e && e.message ? e.message : 'unavailable');
  });
}
function toggleCities() {
  citiesOn = !citiesOn;
  if (!citiesOn) { hoverPlace = -1; pickedPlace = -1; }
  refreshUI();
}
/* the tilt is a preference, not a gesture: it survives a layer or projection
   change, and it is reachable from the burger as well as from ?north= */
function toggleNorth() {
  northUp = !northUp;
  refreshUI();
}

function toggleLayer() {
  var i = 0;
  for (var q = 0; q < LAYERS.length; q++) if (LAYERS[q].id === layerName) i = q;
  var other = LAYERS[(i + 1) % LAYERS.length].id;      /* 50m -> 110m -> 10m -> 50m */
  layerName = other;
  useLayer(other);

}

function fetchLayer(id, done) {
  var def = null;
  for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].id === id) def = LAYERS[i];
  if (!def || loaded[id] || loadingLayer) return;
  loadingLayer = id;
  var wasText = hud.textContent;
  hud.textContent = 'loading ' + def.label + '…';
  fetch(dataURL(def.name)).then(function (r) { return r.json(); }).then(function (geo) {
    loaded[id] = C.buildFeaturesLOD(geo, 0.2, true);
    C.prepareXYZ(loaded[id]);
    loadingLayer = null;
    hud.textContent = wasText;
    if (done) done();
  }).catch(function (e) {
    loadingLayer = null;
    fail('layer ' + id + ': ' + (e && e.message ? e.message : String(e)));
  });
}
function useLayer(id) {
  if (!loaded[id]) {
    /* not in memory: fetch it, then swap in if it is still what the user wants */
    fetchLayer(id, function () {
      if (layerName === id) {
        feats = loaded[id];
        hover = -1; picked = -1;

        recenterDirty = false;
        cityFlagIdx = null;            /* the layer (and its ISO codes) changed */
        reproject();
        refreshUI();
      }
    });
    return;
  }
  feats = loaded[id];
  hover = -1; picked = -1;
  recenterDirty = false;              /* a pending rebuild belongs to the old layer */
  reproject();                        /* pieces + bboxes + frame + labels for this layer */
  refreshUI();
}

buildMenu();      /* before loadAll: the burger is readable even if the fetch fails */
loadAll();

/* the frame's plane extent, from the projection in play */
function worldBounds() {
  var e = C.CUR.extent;
  return [-e[0], -e[1], e[0], e[1]];
}
function fitView(m) {
  var pw = m[2] - m[0], ph = m[3] - m[1];
  fitK = Math.min(W / pw, H / ph) * 0.94;
  view.k = fitK;
  setCenter(view.lon, view.lat);
}

/* ---------- moving the CENTRE OF PROJECTION ----------
   This is the whole point of the 2D view: a drag or arrow key does not slide
   the plane, it moves the point of the sphere that is the centre of the
   projection and REPROJECTS the world around it. A rotation before an equal-area
   projection stays equal-area, so areas, label ranking and the panel's numbers
   are untouched; what is rebuilt is the geometry (pieces, ladder, bboxes, the
   frame and the graticule).
   Cost, measured on the real layers (viewer/recenterbench3.js and
   recenterproj.js): 110m 5-20 ms, 50m 8-27 ms for a full rebuild. That is 1-2
   frames, and only ONE ladder level is rebuilt (the one drawing reads).

   The centre is applied in TWO steps so a drag never paints a stale frame:
   1. the transform (cx, cy, k) is updated at once, so the old geometry drawn
      at the new transform already looks like a pan for that one frame;
   2. the reprojection is scheduled for the next animation frame and coalesces
      any further drag events (a 60 Hz drag would otherwise queue one rebuild
      per event and fall behind). */
var recenterPending = false, recenterDirty = false;
/* a FRESH view: the canonical frame of that centre (no continuity to keep).
   Only the initial centre and the keyboard reset use it; every move goes through
   setCenter, which is continuous with the frame already in play. */
function setCenterFresh(lon, lat) {
  C.rotMat(lon, lat, FRAME);
  var c = C.frameCentre(FRAME, FCEN);
  view.lon = c[0]; view.lat = c[1];
  scheduleReproject();
}
function setCenter(lon, lat) {
  /* keep lat in range and lon wrapped; the poles are a singular centre */
  lat = Math.max(-90, Math.min(90, lat));
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  /* re-aim the CURRENT frame (never rebuild a canonical one: that is the spin)
     and then read the centre back off the frame, so the HUD and the scroll
     arithmetic always agree with what is drawn. moveCentre picks the rule per
     projection: transport for the cone/azimuthal ones (ortho, persp - where a
     roll is an in-plane rotation, so it is free and it is what removes the pole
     spin) and the canonical frame for the pseudocylindrical ones (Eckert IV,
     equirect, Gall - where the frame axes ARE the map's up/right, so a roll
     would shear the map; see core's moveCentre). */
  C.moveCentre(FRAME, lon, lat, C.CUR, FRAME2);
  for (var i = 0; i < 9; i++) FRAME[i] = FRAME2[i];
  var c = C.frameCentre(FRAME, FCEN);
  view.lon = c[0]; view.lat = c[1];
  /* The centre's plane image is NOT computed: by construction the rotation puts
     the centre at the rotated frame's origin (lam'=phi'=0), and every projection
     in the registry maps (0,0) to plane (0,0). So the world is always centred on
     screen, and only k moves. (Computing it from projectRotLL(0,0) instead
     projected the geographic point 0N 0E - a real bug: the whole world sat
     shifted by ~81 px, 184 px.) */
  view.cx = 0; view.cy = 0;
  scheduleReproject();
}
/* ask for a rebuild on the next animation frame, coalescing every event that
   lands before it (a 60 Hz drag would otherwise queue one full rebuild each) */
function scheduleReproject() {
  recenterDirty = true;
  if (recenterPending) return;
  recenterPending = true;
  requestAnimationFrame(function () {
    recenterPending = false;
    if (!recenterDirty) return;
    recenterDirty = false;
    reproject();
  });
}

/* the actual rebuild, once per frame at most */
function reproject() {
  if (!feats.length) return;
  /* the ladder level drawn: LOD_U[t] * k <= maxPx. `lodBias` shifts it, which is
     how the quality/speed tradeoff is tuned and how ?lod=-1 can be used to
     inspect a coarser level. 0.7 px error is the default budget. */
  /* positive ?lod= means COARSER (a larger error budget), which is the useful
     direction for a quick frame-rate test */
  var lvl = C.levelForK(view.k, LOD_MAXPX * Math.pow(2, lodBias));
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  C.recenterAll(feats, view.lon, view.lat, C.CUR, 0.2, C.LOD_U, lvl, FRAME);
  var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  frame = C.frameFor(C.CUR, 1);
  /* the 2nd argument is the INPUT sampling in degrees: 2 deg is plenty, because
     graticuleRot subdivides adaptively to ~4 px where the projection stretches
     the line (near a pole). Measured: 2 deg input costs 6.6 ms against 10.8 ms at
     1 deg, for a visually identical grid. */
  grat = C.graticuleRot(view.lon, view.lat, 2, 15, 15, C.CUR, view.k, FRAME);
  layout = buildLabels();
  var tEnd = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  lastMs = tEnd - t0;
  reprojSplit.rings = t1 - t0; reprojSplit.rest = tEnd - t1;
  hover = -1;
  hoverPlace = -1;                 /* the points moved under the cursor too */
  /* the HUD carries the centre of projection, so it must be rewritten on every
     rebuild - otherwise a drag moves the world while the readout stays at the
     old centre (which is exactly how it looked before this line existed) */
  hud.textContent = hudText();
}
var lastMs = 0;

/* ---------- labels: dataset LABELRANK/MIN_LABEL/MAX_LABEL + screen collision ---------- */
function labelThresholds(p) {
  var mn = p.MIN_LABEL, mx = p.MAX_LABEL;
  if (mn != null && mn >= 20) {                 /* dataset says "never at 50m" */
    var ref = labelRef[p.NAME] || labelRef[p.NAME_LONG];
    if (ref) { mn = ref.minz; mx = ref.maxz; }
    else { mn = 100; mx = 100; }
  }
  return [mn == null ? 4 : mn, mx == null ? 9 : mx];
}
function buildLabels() {
  var out = [];
  for (var i = 0; i < feats.length; i++) {
    var f = feats[i], p = f.props;
    if (!f.label) continue;
    var th = labelThresholds(p);
    if (th[0] >= 20) continue;
    /* the label anchor is GEOGRAPHIC (LABEL_X/Y), so it is re-projected with the
       centre instead of being read from the build-time plane position: after a
       recentre, f.label holds a coordinate of the ORIGINAL frame */
    var gll = (p.LABEL_X != null) ? [p.LABEL_X, p.LABEL_Y] : null;
    if (!gll) continue;
    /* the anchor must be on the drawn side of the frame: in a horizon projection
       the hidden hemisphere is not drawn, so its labels must not be either */
    if (!C.visibleAt(gll[0], gll[1], view.lon, view.lat, C.CUR, FRAME)) continue;
    var pl2 = projectLabel(gll[0], gll[1]);
    out.push({
      i: i, lx: pl2[0], ly: pl2[1], lonDeg: gll[0], latDeg: gll[1],
      name: countryName(p),
      rank: p.LABELRANK || 3,
      minz: th[0], maxz: th[1],
      area: f.areaSr * C.SR_TO_KM2
    });
  }
  out.sort(function (a, b) { return a.area < b.area ? 1 : -1; });
  return out;
}

/* a geographic point -> plane of the CURRENT frame (centre applied) */
function projectLabel(lon, lat) {
  var o = [0, 0];
  C.projectRotLL(lon, lat, FRAME, C.CUR, o);
  return o;
}

/* ---------- path builders (LOD: decimate to <1 screen px, resplit long edges) ---------- */
/* Segment accounting for the HUD: counted where the segments are actually issued,
   so the number is what the canvas receives, not an estimate. `segs` counts the
   line segments of the current frame (a closed ring of n points is n segments:
   n-1 lineTo plus the implicit closing one), and `seen` counts distinct pieces. */
var segs = 0, seenPieces = 0, gratSegs = 0, skippedPieces = 0;
/* Build one feature's Path2D. The screen transform is inline: sx()/sy() were two
   function calls per point, i.e. 2 x 53 000 calls a frame on the 10m layer at the
   world view, and the loop is the hot path of the whole app. The constants are
   hoisted, so each point costs one multiply and one add per axis. */
function beginFeature(path, f) {
  var k = view.k, ox = W * 0.5 - view.cx * k, oy = H * 0.5 + view.cy * k;
  var x0 = (0 - W * 0.5) / k + view.cx, x1 = (W - W * 0.5) / k + view.cx;
  var y0 = -(H - H * 0.5) / k + view.cy, y1 = -(0 - H * 0.5) / k + view.cy;
  for (var r = 0; r < f.rings.length; r++) {
    var rg = f.rings[r];
    if (!rg.pieces) continue;
    for (var q = 0; q < rg.pieces.length; q++) {
      var p = rg.pieces[q], b = p.bbox;
      /* viewport cull per PIECE: at a deep zoom most of the world is off screen
         and this is what keeps the segment count proportional to what is seen */
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      /* SUB-PIXEL CULL. At the world view 1 567 of the 2 336 pieces of the 10m
         layer are under one pixel across (islets, reefs, a single rock): as
         polygons they are degenerate, and the canvas renders their sub-0.05 px
         steps as slivers and streaks hanging off the coastline - the artifacts
         that show up near the limb. Drawn, they add nothing; skipped, the frame
         gets cheaper AND cleaner. The threshold is in screen pixels, so zooming in
         brings them back as soon as they can be seen. */
      if ((b[2] - b[0]) * k < 1.0 && (b[3] - b[1]) * k < 1.0) { skippedPieces++; continue; }
      var pts = C.pieceFlat(p, view.k, LOD_MAXPX), n = p._flatLen;
      if (n < 3) continue;
      segs += n; seenPieces++;
      path.moveTo(pts[0] * k + ox, oy - pts[1] * k);
      for (var v = 1; v < n; v++) path.lineTo(pts[v * 2] * k + ox, oy - pts[v * 2 + 1] * k);
      path.closePath();
    }
  }
}
function beginPoly(path, poly) {
  path.moveTo(sx(poly[0][0]), sy(poly[0][1]));
  for (var i = 1; i < poly.length; i++) path.lineTo(sx(poly[i][0]), sy(poly[i][1]));
  path.closePath();
}
function beginLine(path, line) {
  path.moveTo(sx(line[0][0]), sy(line[0][1]));
  for (var i = 1; i < line.length; i++) path.lineTo(sx(line[i][0]), sy(line[i][1]));
}
function onScreen(f) {
  var x0 = toWorldX(0), x1 = toWorldX(W), y0 = toWorldY(H), y1 = toWorldY(0), b = f.bbox;
  return !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1);
}

/* ---------- draw: blue ocean, light grey land, whiter on hover/pick ---------- */
function draw() {
  segs = 0; seenPieces = 0; gratSegs = 0; skippedPieces = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COL.oceanDeep); g.addColorStop(0.5, COL.ocean); g.addColorStop(1, COL.oceanDeep);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  var framePath = new Path2D(); beginPoly(framePath, frame);
  ctx.fillStyle = COL.ocean; ctx.fill(framePath);

  var grPath = new Path2D();
  gratSegs = 0;
  for (var i = 0; i < grat.length; i++) { beginLine(grPath, grat[i]); gratSegs += grat[i].length - 1; }
  ctx.strokeStyle = COL.graticule; ctx.lineWidth = 0.8; ctx.stroke(grPath);

  var vis = [];
  var tA = nowMs();
  ctx.fillStyle = COL.land;
  for (var j = 0; j < feats.length; j++) {
    if (!onScreen(feats[j])) { feats[j]._p = null; continue; }
    var p = new Path2D(); beginFeature(p, feats[j]); feats[j]._p = p;
    vis.push(feats[j]);
  }
  var tB = nowMs();
  for (var j2 = 0; j2 < vis.length; j2++) ctx.fill(vis[j2]._p);
  ctx.strokeStyle = COL.edge; ctx.lineWidth = 0.7;
  for (var v = 0; v < vis.length; v++) if (vis[v]._p) ctx.stroke(vis[v]._p);
  drawMs.path = (tB - tA); drawMs.paint = nowMs() - tB;

  if (hover >= 0 && hover !== picked && feats[hover]._p) {
    ctx.fillStyle = COL.hover; ctx.fill(feats[hover]._p);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.stroke(feats[hover]._p);
  }
  if (picked >= 0 && feats[picked]._p) {
    ctx.fillStyle = COL.pick; ctx.fill(feats[picked]._p);
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 1.6; ctx.stroke(feats[picked]._p);
  }
  var zNow = zoomLevel();
  /* cities sit ON the land, under the labels and under the frame edge */
  drawCities(zNow);
  drawLabels(zNow);
  ctx.strokeStyle = COL.frame; ctx.lineWidth = 1; ctx.stroke(framePath);
  refreshHud();
}
/* the segment counts change every frame, so the HUD is re-rendered from draw();
   only write to the DOM when the string actually changed, or a 60 Hz paint would
   thrash the layout for nothing */
var hudShown = null;
function refreshHud() {
  var t = hudText();
  if (t !== hudShown) { hud.textContent = t; hudShown = t; }
}

/* z=2 is the fitted whole-world view; +1 per 2x magnification, matching
   the MIN_LABEL/MAX_LABEL scale the dataset was authored on */
function zoomLevel() { return 2 + Math.log2(view.k / fitK); }

/* ---------- label typography ----------
   THE THREE KINDS OF NAME ARE DRAWN DIFFERENTLY, on purpose. An atlas does this and
   it is not decoration: the reader has to tell, at a glance and without reading, a
   country from a capital from an ordinary city, and colour alone is not enough for
   a colour-blind reader or for a name over pale land.
     country  UPPERCASE, letter-spaced, muted, thin halo  - background context
     capital  Title Case, bold, gold, plus a RING around its dot (see drawCities)
     city     Title Case, regular, white
   The tracking is real: ctx.letterSpacing is not in every browser this runs on, so
   drawTracked() places each character itself and the collision box is measured with
   the same tracking (a box that ignores tracking would let labels overlap by a few
   px per letter - measured, 18 px on a 16-character name). */
var LABEL_STYLE = {
  country: { font: '600 10.5px system-ui, -apple-system, sans-serif', track: 1.15, upper: true,
             fill: 'countryLabel', halo: COL.countryHalo, haloLw: 2.6, dy: 0 },
  /* no tracking on these two: a couple of tenths of a px per letter buys nothing the
     weight and size already say, and drawing a name letter by letter costs one
     fillText + one strokeText per CHARACTER (a deep zoom shows ~60 city names, i.e.
     ~1 000 canvas calls a frame instead of ~120) */
  capital: { font: '700 12px system-ui, -apple-system, sans-serif', track: 0, upper: false,
             fill: 'capitalLabel', halo: COL.capitalHalo, haloLw: 3.2, dy: -10 },
  /* the capital of the SELECTED country: same weight, but accented and set a little
     wider, so it is found without hunting. One extra step in the hierarchy, not a
     new colour scheme. */
  capitalSel: { font: '800 12.5px system-ui, -apple-system, sans-serif', track: 0.4, upper: false,
                fill: 'capitalPick', halo: COL.capitalPickHalo, haloLw: 3.4, dy: -10 },
  city:    { font: '11px system-ui, -apple-system, sans-serif', track: 0, upper: false,
             fill: 'cityLabel', halo: 'rgba(12,22,32,.8)', haloLw: 3, dy: -8 }
};
function labelStyle(kind) { return LABEL_STYLE[kind] || LABEL_STYLE.city; }
function labelText(kind, name) { return labelStyle(kind).upper ? String(name).toUpperCase() : name; }
/* width of a tracked string at the CURRENT ctx.font */
function trackedWidth(txt, track) {
  var w = ctx.measureText(txt).width;
  return track ? w + track * Math.max(0, txt.length - 1) : w;
}
/* centred tracked text: ctx has no portable letter-spacing, so the characters are
   placed one by one. Falls back to a single fillText when there is no tracking. */
function drawTracked(txt, cx, cy, track, fill, halo, lw) {
  if (!track) {
    if (halo) { ctx.lineWidth = lw; ctx.strokeStyle = halo; ctx.strokeText(txt, cx, cy); }
    ctx.fillStyle = fill; ctx.fillText(txt, cx, cy);
    return;
  }
  var prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  var x = cx - trackedWidth(txt, track) / 2;
  for (var i = 0; i < txt.length; i++) {
    var ch = txt.charAt(i);
    if (ch !== ' ') {
      if (halo) { ctx.lineWidth = lw; ctx.strokeStyle = halo; ctx.strokeText(ch, x, cy); }
      ctx.fillStyle = fill; ctx.fillText(ch, x, cy);
    }
    x += ctx.measureText(ch).width + track;
  }
  ctx.textAlign = prevAlign;
}

function drawLabels(z) {
  ctx.textBaseline = 'middle';
  var placed = [], shown = 0;
  var stC = labelStyle('country');
  ctx.font = stC.font;
  for (var i = 0; i < layout.length; i++) {
    var L = layout[i];
    if (z < L.minz - 0.2 || z > L.maxz + 0.6) continue;
    var px = sx(L.lx), py = sy(L.ly);
    if (px < 24 || py < 12 || px > W - 24 || py > H - 12) continue;
    var cTxt = labelText('country', L.name);
    var w = trackedWidth(cTxt, stC.track) + 8, h = 15;
    var box = [px - w / 2, py - h / 2, px + w / 2, py + h / 2];
    var ok = true;
    for (var q = 0; q < placed.length && ok; q++) {
      var b = placed[q];
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) ok = false;
    }
    if (!ok) continue;
    placed.push(box);
    drawTracked(cTxt, px, py + stC.dy, stC.track, COL[stC.fill], stC.halo, stC.haloLw);
    if (++shown > 80) break;
  }
  /* ---- city labels, placed after the country names and against the same boxes,
     so a city never lands on a country name. Order is what matters when they
     compete: LABELRANK first (Natural Earth's own priority: 0 = Paris, Tokyo),
     then population, then the capitals. */
  if (citiesOn && cityDots.length) {
    var capOfPicked = (picked >= 0) ? capitalOf(picked) : -1;
    var cand = cityDots.slice(0);
    cand.sort(function (a, b) {
      var pa = places[a.i], pb = places[b.i];
      if (pa.l !== pb.l) return pa.l - pb.l;
      return (pb.p || 0) - (pa.p || 0);
    });
    /* the hovered or picked city is labelled whatever its rank: it is the one the
       user is pointing at, and the panel is showing its numbers */
    var cap = z < 4 ? 18 : (z < 6 ? 40 : 60);
    var done = 0;
    for (var c2 = 0; c2 < cand.length && done < cap; c2++) {
      var D2 = cand[c2], PP = places[D2.i];
      var forced = (D2.i === pickedPlace || D2.i === hoverPlace);
      /* a capital is drawn in its own voice: BOLD, slightly larger, white; and the
         capital of the SELECTED country gets the accent so it can be found without
         hunting for it */
      var isCap2 = (PP.f === 'A0' || PP.f === 'A0R');
      /* ONE accent, one meaning: the thing you selected. So the city you clicked
         and the capital of the country you clicked are both drawn in the accent
         voice; every other capital is bold white, every other city plain white. */
      var selected2 = (D2.i === pickedPlace) || (isCap2 && D2.i === capOfPicked);
      var kind = selected2 ? 'capitalSel' : (isCap2 ? 'capital' : 'city');
      /* a coarse zoom is not the place for rank 7 towns: they would bury the
         continent names. CAPITALS are exempt from the rank cut: a ringed dot with
         no name reads as an unfinished label, and a capital is exactly the kind of
         name an atlas keeps when it drops everything else (measured at z 4:
         Copenhagen, Amsterdam and Bratislava were ringed and silent). They are
         still subject to the collision test, so a crowded corner drops the ones
         that do not fit rather than piling names on top of each other. */
      if (!forced && !isCap2) {
        if (z < 4.5 && PP.l > 3) continue;
        if (z < 6 && PP.l > 6) continue;
      }
      /* NO extra rank cut for capitals at the world view either: a gold ring with
         no name is an unfinished label (measured at z 2: Paris, Lisbon, Dodoma
         ringed and silent). The collision test is what prunes a crowded corner, and
         a capital is exactly the name an atlas keeps when it drops the rest. */

      var st = labelStyle(kind);
      ctx.font = st.font;
      var cname = cityName(D2.i);
      var lx = D2.px, ly = D2.py + st.dy;
      var w2 = trackedWidth(cname, st.track) + 8, h2 = isCap2 ? 17 : 15;
      /* ONE retry on the other side of the dot before giving up. A ring with no
         name reads as an unfinished label (measured at z 4: 3 of 9 capitals lost
         their name to a country name that happened to sit above them), and the
         fix is cheap - the space below a dot is almost always free when the space
         above is not. */
      var box2 = null, lyTry = ly;
      for (var side = 0; side < 2 && !box2; side++) {
        var candY = (side === 0) ? ly : D2.py - st.dy + (isCap2 ? 12 : 10);
        var bx = [lx - w2 / 2, candY - h2 / 2, lx + w2 / 2, candY + h2 / 2];
        var ok2 = true;
        for (var q2 = 0; q2 < placed.length && ok2; q2++) {
          var b2 = placed[q2];
          if (bx[0] < b2[2] && bx[2] > b2[0] && bx[1] < b2[3] && bx[3] > b2[1]) ok2 = false;
        }
        if (ok2) { box2 = bx; lyTry = candY; }
      }
      if (!box2) continue;
      placed.push(box2);
      ly = lyTry;
      drawTracked(cname, lx, ly, st.track, COL[st.fill], st.halo, st.haloLw);
      done++;
    }
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

/* ---------- cities ----------
   Drawn from the point table, once per frame: 7 342 points, of which the zoom
   filter keeps 26 at the fitted world view and all of them at z 9. Each one costs
   one rotation + one fwd() (projectRotLLVis) and a screen-bounds test, so the
   layer is ~0.2 ms at the world view and ~1 ms fully zoomed in - cheaper than the
   graticule. Positions are collected here because the label pass and the picker
   both need them, and recomputing them there would double the cost. */
var cityDots = [];
function drawCities(z) {
  placeSeen = 0;
  cityDots.length = 0;
  if (!citiesOn || !places.length) return;
  var k = view.k, ox = W * 0.5 - view.cx * k, oy = H * 0.5 + view.cy * k;
  var o = [0, 0];
  var small = null, capital = null, capitalRing = null;
  for (var i = 0; i < places.length; i++) {
    var P = places[i];
    /* Natural Earth's own MIN_ZOOM, verbatim: it is the zoom at which that place is
       meant to appear. 0.35 of slack so a place shows on the step before, which is
       what makes zooming feel continuous rather than pop-in. */
    if (P.z > z + 0.35) continue;
    if (!C.projectRotLLVis(P.lon, P.lat, FRAME, C.CUR, o)) continue;
    var px = o[0] * k + ox, py = oy - o[1] * k;
    if (px < -4 || py < -4 || px > W + 4 || py > H + 4) continue;
    var r = placeRadius(P.f);
    cityDots.push({ px: px, py: py, i: i, r: r });
    var isCap = (P.f === 'A0' || P.f === 'A0R');
    var path = isCap ? (capital || (capital = new Path2D())) : (small || (small = new Path2D()));
    path.moveTo(px + r, py);
    path.arc(px, py, r, 0, 6.283185307179586);
    if (isCap) {
      /* the ring sits just outside the dot, in its own pass, so the two strokes
         never fight over the same pixels */
      if (!capitalRing) capitalRing = new Path2D();
      var rr = r + 2.1;
      capitalRing.moveTo(px + rr, py);
      capitalRing.arc(px, py, rr, 0, 6.283185307179586);
    }
    placeSeen++;
  }
  if (!placeSeen) return;
  /* ONE fill and ONE stroke for the whole layer (a stroke per dot would be 7 000
     state changes at a deep zoom) */
  if (small) {
    ctx.fillStyle = COL.city; ctx.fill(small);
    ctx.strokeStyle = COL.cityRing; ctx.lineWidth = 1; ctx.stroke(small);
  }
  /* a CAPITAL is marked differently from a city, not just drawn bigger: a gold
     ring around the dot, i.e. the same voice as its label. Two identical dots of
     different size read as "same thing, further away" - the wrong message. */
  if (capital) {
    ctx.fillStyle = COL.city; ctx.fill(capital);
    ctx.strokeStyle = COL.cityRing; ctx.lineWidth = 1; ctx.stroke(capital);
    ctx.fillStyle = COL.city; ctx.fill(capital);      /* the stroke eats into the dot */
    if (capitalRing) {
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 1.3;
      ctx.stroke(capitalRing);
    }
  }
  /* the hovered/picked city on top of the rest, so it is never hidden by a dot */
  var sel = pickedPlace >= 0 ? pickedPlace : hoverPlace;
  if (sel >= 0) {
    for (var q = 0; q < cityDots.length; q++) {
      if (cityDots[q].i !== sel) continue;
      var d = cityDots[q], rr2 = d.r + 2;
      ctx.beginPath(); ctx.arc(d.px, d.py, rr2, 0, 6.283185307179586);
      ctx.fillStyle = COL.cityPick; ctx.fill();
      ctx.strokeStyle = COL.cityRing; ctx.lineWidth = 1.5; ctx.stroke();
      break;
    }
  }
}
/* nearest city to a screen point, within its own grab radius (a capital's dot is
   bigger, so its grab radius is too). -1 when none: the country pick then runs. */
function pickPlaceAt(px, py) {
  var best = -1, bestD = Infinity;
  for (var i = 0; i < cityDots.length; i++) {
    var d = cityDots[i];
    var dx = d.px - px, dy = d.py - py;
    var dd = dx * dx + dy * dy;
    var grab = d.r + 4;
    if (dd <= grab * grab && dd < bestD) { bestD = dd; best = d.i; }
  }
  return best;
}

/* ---------- picking (same LOD traversal as drawing) ---------- */
function pickAt(px, py) {
  var hits = C.hitTestPieces(feats, toWorldX(px), toWorldY(py), view.k);
  if (!hits.length) return -1;
  var best = hits[0], bestA = Infinity;
  for (var i = 0; i < hits.length; i++) {
    var a = feats[hits[i]].areaSr;
    if (a < bestA) { bestA = a; best = hits[i]; }
  }
  return best;
}
function setHover(px, py) {
  /* a city beats the country under it: its dot is a 2-3 px target on purpose, so
     reaching the country is a matter of moving a few pixels off the dot */
  var hp = pickPlaceAt(px, py);
  if (hp >= 0) {
    if (hp !== hoverPlace || hover !== -1) { hoverPlace = hp; hover = -1; refreshUI(); }
    return;
  }
  var h = pickAt(px, py);
  if (h !== hover || hoverPlace !== -1) { hover = h; hoverPlace = -1; refreshUI(); }
}
function doPick(px, py) {
  var hp = pickPlaceAt(px, py);
  if (hp >= 0) { pickedPlace = hp; picked = -1; hoverPlace = hp; hover = -1; refreshUI(); return; }
  pickedPlace = -1;
  picked = pickAt(px, py);
  refreshUI();
}

function refreshMenu() {
  var rows = itemsEl.getElementsByClassName('menuitem');
  var chips = itemsEl.getElementsByClassName('chip');
  for (var q0 = 0; q0 < chips.length; q0++) {
    var cid = chips[q0].dataset.id;
    if (cid === 'lang:' + LANG) chips[q0].classList.add('on'); else chips[q0].classList.remove('on');
  }
  for (var i = 0; i < rows.length; i++) {
    var el = rows[i], id = el.dataset.id;
    var on = (id === 'proj:' + projID) ||
             (id === 'layer:' + layerName) ||
             (id === 'cities' && citiesOn) ||
             (id === 'north' && northUp) ||
             (id === 'lang:' + LANG);
    if (on) el.classList.add('on'); else el.classList.remove('on');
  }
  refreshBurger();
}

/* ---------- info panel ---------- */
/* the city panel: the same .row markup as a country, so it inherits the styling.
   Everything shown comes from the point table; nothing is invented. */
function showPlacePanel(i) {
  var P = places[i];
  var loc = cityName(i);
  var base = P.n;
  var altCity = [];
  if (loc !== base) altCity.push(base);
  else if (P.f === 'A0' || P.f === 'A0R') { /* nothing to add */ }
  var rows = [
    ['name', flagHTML(flagForCountryName(P.c)) + '<span class="nm">' + loc + '</span>'],
    ['also', altCity.join('  ·  ')],
    ['country', P.c],
    ['region', P.r],
    ['type', PLACE_FCLASS[P.f] || P.f],
    ['population', popText(P.p) ? fmtNum(P.p) + ' (pop. max)' : ''],
    ['at', Math.abs(P.lat).toFixed(3) + '° ' + (P.lat >= 0 ? 'N' : 'S') + ', ' +
           Math.abs(P.lon).toFixed(3) + '° ' + (P.lon >= 0 ? 'E' : 'W')],
    ['time zone', P.tz || ''],
    ['source', 'Natural Earth 10m populated places · rank ' + P.l + ' · shows from z ' + P.z]
  ];
  var s = '';
  for (var k2 = 0; k2 < rows.length; k2++) {
    var val = rows[k2][1];
    if (!val || val === '') continue;
    s += '<div class="row"><span class="k">' + rows[k2][0] + '</span><span class="v">' + val + '</span></div>';
  }
  panel.innerHTML = s;
  panel.classList.add('show');
  hud.textContent = hudText();
}

function refreshUI() {
  var pi = (pickedPlace >= 0) ? pickedPlace : hoverPlace;
  if (pi >= 0 && places[pi]) { showPlacePanel(pi); return; }
  var idx = picked >= 0 ? picked : hover;
  var f = idx >= 0 ? feats[idx] : null;
  if (!f) {
    panel.classList.remove('show');
    hud.textContent = hudText();
    return;
  }
  var p = f.props, km2 = f.areaSr * C.SR_TO_KM2;
  /* "also": the same country in the other languages, minus the one already shown,
     English first because it is the common denominator on a map of this kind */
  var shown = countryName(p);
  var alt = [];
  var alts = [countryNameEn(p), p.NAME_FR, p.NAME_DE, p.NAME_ES, p.NAME_RU, p.NAME_ZH, p.NAME_AR, p.NAME_JA];
  for (var i = 0; i < alts.length; i++) if (alts[i] && alts[i] !== shown && alt.indexOf(alts[i]) < 0) alt.push(alts[i]);
  /* the capital, from the place layer (see capitalOf) - with its population when
     Natural Earth knows it, because "capital: Paris" plus a number is the single
     most useful pair of facts on this panel */
  var capIdx = capitalOf(idx);
  var capTxt = '';
  if (capIdx >= 0) {
    var CP = places[capIdx];
    capTxt = cityName(capIdx) + (CP.p > 0 ? ' · ' + fmtNum(CP.p) : '');
  }
  var rows = [
    ['name', flagHTML(flagCodeOf(p)) + '<span class="nm">' + shown + '</span>'],
    ['also', alt.join('  ·  ')],
    ['capital', capTxt],
    ['type', p.TYPE + (p.SOVEREIGNT && p.SOVEREIGNT !== shown ? ' · sovereign: ' + p.SOVEREIGNT : '')],
    ['region', [p.CONTINENT, p.SUBREGION].filter(function (x) { return x; }).join(' / ')],
    ['area', fmtKm2(km2)],
    ['population', p.POP_EST ? fmtNum(p.POP_EST) + ' est. ' + (p.POP_YEAR || '') : ''],
    ['gdp', p.GDP_MD ? '$' + fmtNum(p.GDP_MD * 1e6) + ' (' + (p.GDP_YEAR || '') + ')' : ''],
    ['economy', [p.ECONOMY, p.INCOME_GRP].filter(function (x) { return x; }).join(' · ')],
    ['codes', 'ISO ' + p.ISO_A2 + ' / ' + p.ISO_A3 + ' / ' + p.ISO_N3 + ' · NE ' + p.NE_ID],
    ['geometry', f.rings.length + ' part(s) · ' + p.VERTS + ' vertices']
  ];
  var s = '';
  for (var k2 = 0; k2 < rows.length; k2++) {
    var val = rows[k2][1];
    if (!val || val === '') continue;
    /* every row is `position: relative` - cheap, and it keeps the flag's absolute
       position defined whether or not this particular row has one */
    s += '<div class="row"><span class="k">' + rows[k2][0] + '</span><span class="v">' + val + '</span></div>';
  }
  panel.innerHTML = s;
  panel.classList.add('show');
  hud.textContent = hudText();
}
function hudText() {
  var nm = layerLabel(layerName);
  var z = zoomLevel();
  /* the centre is the point of the SPHERE that is the centre of projection -
     read it from view, not from unprojecting a plane position */
  var main = C.CUR.label + ' · ' + nm + ' · z ' + z.toFixed(1) + ' · ' +
             (Math.round(view.k / fitK * 100) / 100) + '× · centre ' +
             view.lon.toFixed(1) + '°, ' + view.lat.toFixed(1) + '°';
  /* segments actually drawn this frame (land + graticule), and the share of them
     that is land - the number that tells you at a glance how much work the frame
     is doing at this zoom */
  var segLine = fps.shown + ' fps · ' + fps.ms.toFixed(1) + ' ms' +
                ' · segs ' + fmtNum(segs + gratSegs) +
                ' (' + fmtNum(segs) + ' land + ' + fmtNum(gratSegs) + ' grid)' +
                ' · ' + fmtNum(seenPieces) + ' pieces' +
                (skippedPieces ? ' (+' + fmtNum(skippedPieces) + ' sub-pixel)' : '') +
                (citiesOn ? ' · ' + fmtNum(placeSeen) + ' cities' : '');
  if (!dbg()) return segLine + '\n' + main;
  return segLine + ' · reproject ' + lastMs.toFixed(1) + ' ms (rings ' + reprojSplit.rings.toFixed(1) +
         ' + ' + reprojSplit.rest.toFixed(1) + ') · path ' + drawMs.path.toFixed(1) +
         ' ms · paint ' + drawMs.paint.toFixed(1) + ' ms\n' + main;
}
function helpText() {
  /* two lengths: the full hint needs room the narrow layouts do not have, and it
     is the HUD (left) that must stay readable */
  if (W < 1150) {
    return '\u2630 view \u00b7 wheel = zoom \u00b7 drag = move the centre \u00b7 dbl-click = fly there \u00b7 c cities';
  }
  return '\u2630 view \u00b7 wheel = zoom \u00b7 drag / shift+wheel = move the centre \u00b7 dbl-click = fly there \u00b7 r reset \u00b7 c cities';
}
function fmtKm2(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + ' million km²';
  if (v >= 1000) return fmtNum(v) + ' km²';
  return Math.round(v) + ' km²';
}
function fmtNum(v) {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/* ---------- resize ---------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  var w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  W = w; H = h;
}

var drag = null;
var touch = null;

/* ---------- interaction (shared by both views) ----------
   Pointer events are bound to the stage div so the same handlers drive the
   2D canvas and the WebGL canvas underneath the label overlay. */
function bindPointer(el) {
  el.addEventListener('mousedown', function (e) {
    fly = null;                    /* the finger takes over from any flight */
    lastMoveT = loopNow;
    drag = { x: e.offsetX, y: e.offsetY };
    startMotion(e.offsetX, e.offsetY);
  });
  el.addEventListener('mousemove', function (e) {
    mouse.x = e.offsetX; mouse.y = e.offsetY; mouse.inside = true;
    if (drag) {
      var dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (dx || dy) { pan(dx, dy); drag.x = e.offsetX; drag.y = e.offsetY; addMotion(e.offsetX, e.offsetY); }
    }
    setHover(e.offsetX, e.offsetY);
  });
  el.addEventListener('mouseup', function () {
    drag = null;
    endMotion();                 /* release with speed still on it: glide */
  });
  el.addEventListener('mouseleave', function () {
    mouse.inside = false;
    if (hover !== -1) { hover = -1; refreshUI(); }
  });
  el.addEventListener('click', function (e) { doPick(e.offsetX, e.offsetY); });
  el.addEventListener('dblclick', function (e) {
    doPick(e.offsetX, e.offsetY);
    /* one gesture for "take me there", ANIMATED: the view pulls back (so the
       target and its surroundings stay in view while the world turns), travels the
       great circle, then comes in to the zoom that fits the target's own bounding
       box. Jumping straight there lost the reader's sense of where they went. */
    gestureGo(e.offsetX, e.offsetY);
    refreshUI();
  });
  el.addEventListener('wheel', function (e) {
    e.preventDefault();
    stopInertia();               /* a wheel step takes over from any glide */
    fly = null;                  /* ...and from any flight */
    var f = zoomFactor(e.deltaY);
    /* WHEEL = ZOOM, as it always was. A previous version made the plain wheel move
       the centre of projection and required ctrl+wheel to zoom; that broke the one
       gesture everybody expects. Zoom is about the centre of projection (k only),
       because in a re-centred view the centre IS the screen centre.
       SHIFT+wheel now moves the centre of projection (vertical = latitude,
       horizontal = longitude), so the wheel still does everything without a
       modifier clash; a trackpad's horizontal deltaX moves longitude too. */
    var horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (e.shiftKey || horiz) {                    /* move the centre of projection */
      scrollCentre(-e.deltaX * 0.25, -e.deltaY * 0.25);
      return;
    }
    zoomBy(f);
  }, { passive: false });
}

/* Zoom: changes k only, so the centre of projection stays where it is - which is
   the screen centre, by construction. The zoom is therefore "into the middle":
   drag the region you want to the middle first, or double-click it (which moves
   the centre there and zooms in one gesture).
   The ladder level drawing reads depends on k, so a zoom schedules a rebuild
   too - otherwise a deep zoom would keep drawing the coarse level (and, before
   the builtT guard in core.js, would read levels that were never built). */
function zoomBy(f) {
  lastMoveT = loopNow;
  var k = view.k * f;
  var kmin = fitK * 0.45, kmax = fitK * 1200;
  view.k = Math.max(kmin, Math.min(kmax, k));
  scheduleReproject();
}
/* wheel / pinch step: a multiplicative factor from a pixel delta */
function zoomFactor(delta) { return Math.pow(1.0018, -delta); }

/* the geographic point under a screen point, in the CURRENT frame */
function geoAt(px, py) {
  var ll = C.unproject(toWorldX(px), toWorldY(py));
  if (!ll) return null;
  return C.unrotM(FRAME, ll[0] * C.DEG, ll[1] * C.DEG);
}

/* A drag moves the centre of projection: the point that must land under the
   cursor becomes the new centre, so the world turns under the finger instead of
   the picture sliding.
   BOTH axes subtract the drag: screen y grows DOWNWARD while plane y grows
   upward, so the vertical sign has to be flipped here or the map moves against
   the finger vertically while following it horizontally (that was a real bug:
   measured, a 40 px drag down moved the centre 5.15 deg SOUTH, i.e. the land ran
   away from the pointer - the "inverted vertical axis" the orthographic view
   showed was this, and it affected every projection, not just that one). */
function pan(dx, dy) {
  lastMoveT = loopNow;             /* the tilt waits for the gesture to finish */
  var g = geoAt(W * 0.5 - dx, H * 0.5 - dy);
  if (!g) {
    /* outside the map figure (the corner outside an orthographic disc): nothing
       to move the centre to, so the drag is a no-op rather than a jump */
    return;
  }
  setCenter(g[0], g[1]);
}
/* scroll = move the centre of projection along a meridian / parallel. This is
   the interaction the projection view wants: turning the world, not sliding a
   flat picture. One wheel notch moves ~0.25 deg at the world view and scales
   with the zoom, so the pixel speed on screen stays constant. */
function scrollCentre(dLon, dLat) {
  var degPerPx = 0.25 * (fitK / view.k);
  setCenter(view.lon + dLon * degPerPx, view.lat + dLat * degPerPx);
}

/* ---------- keyboard ---------- */
/* ---------- inertia (kinetic glide) ----------
   A drag that ends with the pointer still moving keeps moving for a moment and
   decays. The velocity is measured from real pointer samples over the last
   ~90 ms (not from the last two events, which can be 1 ms apart and give a wild
   number), the glide is advanced in the animation loop with a time-based decay so
   it behaves the same at 30, 60 or 144 Hz, and any new input stops it dead.

   Cost: the glide calls pan() about once per frame, i.e. the same work as a
   drag frame (one reprojection, coalesced to one per frame). On the 50m layer
   that is ~20 ms, so the glide runs at the frame rate the layer allows - the fps
   readout shows it, and the glide stops itself once it is slow enough that the
   remaining motion would not be visible. */
var inertia = { on: false, vx: 0, vy: 0, last: 0, started: false };
var loopNow = 0;                            /* the animation-frame clock */
var motionSamples = [];                     /* {x,y,t} while a drag is in progress */
var INERTIA_TAU = 0.34;                     /* s: velocity decays to 1/e in this */
var INERTIA_MIN = 60;                       /* px/s: below this the glide stops */

/* ONE clock for the whole gesture. Samples used to be stamped with nowMs()
   (wall clock) while the glide was advanced with the animation-frame timestamp;
   the two are the same in a browser but may not be (they are not in the test
   harness, and a browser may throttle one of them). nowMs() is used for both, so
   the measured velocity and the applied dt cannot disagree. */
function startMotion(x, y) {
  stopInertia();
  motionSamples.length = 0;
  motionSamples.push({ x: x, y: y, t: nowMs() });
}
function addMotion(x, y) {
  var t = nowMs();
  motionSamples.push({ x: x, y: y, t: t });
  /* keep ~120 ms of history: enough to smooth a jittery finger, short enough that
     the measured speed is the speed at RELEASE and not the average of the drag */
  while (motionSamples.length > 2 && t - motionSamples[0].t > 120) motionSamples.shift();
}
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
/* the release velocity, in screen px per second */
function endMotion() {
  if (motionSamples.length < 2) { motionSamples.length = 0; return; }
  var a = motionSamples[0], b = motionSamples[motionSamples.length - 1];
  var dt = (b.t - a.t) / 1000;
  motionSamples.length = 0;
  if (dt < 0.012) return;                   /* a single frame of data: no velocity */
  var vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  if (Math.hypot(vx, vy) < INERTIA_MIN * 2) return;
  /* a fling is capped so a fast flick cannot teleport the view */
  var cap = 6000;
  var sp = Math.hypot(vx, vy);
  if (sp > cap) { vx = vx / sp * cap; vy = vy / sp * cap; }
  inertia.on = true; inertia.vx = vx; inertia.vy = vy;
  /* The glide is advanced with the ANIMATION FRAME timestamp, so `last` must be
     that clock too: endMotion() runs inside an input event, where the last frame
     time is what we want. Stamping it with nowMs() mixed two clocks and, on a
     slow frame, produced a bogus first dt (measured: 1 ms instead of 33, which
     made the same flick travel 810 px instead of 247). */
  inertia.last = loopNow;
  inertia.started = true;
}
function stopInertia() {
  inertia.on = false; inertia.vx = 0; inertia.vy = 0;
  motionSamples.length = 0;
}
/* advanced once per animation frame; frame-rate independent */
function stepInertia(now) {
  if (!inertia.on) return;
  /* the first step after a release has no previous frame time to subtract: use a
     nominal one frame so the glide starts immediately with a sane dt instead of
     the 1 ms clamp */
  var raw = inertia.started ? (now - inertia.last) / 1000 : 0.016;
  inertia.started = false;
  var dt = Math.min(0.05, Math.max(0.004, raw));
  inertia.last = now;
  var decay = Math.exp(-dt / INERTIA_TAU);
  inertia.vx *= decay; inertia.vy *= decay;
  var sp = Math.hypot(inertia.vx, inertia.vy);
  if (sp < INERTIA_MIN) { inertia.on = false; return; }
  pan(inertia.vx * dt, inertia.vy * dt);
}

/* ---------- the two idle animations, stepped once per frame ---------- */
function smoothstep(t, a, b) {
  if (t <= a) return 0;
  if (t >= b) return 1;
  var x = (t - a) / (b - a);
  return x * x * (3 - 2 * x);
}
function clampK(k) { return Math.max(fitK * 0.45, Math.min(fitK * 1200, k)); }

/* great-circle interpolation of two geographic points; the slerp is what makes a
   long fly-over arc across the map instead of a straight line in lon/lat (which
   near a pole would look like the world skidding sideways) */
function slerpLL(lon0, lat0, lon1, lat1, t) {
  var a = lat0 * C.DEG, b = lon0 * C.DEG, c = lat1 * C.DEG, d = lon1 * C.DEG;
  var x1 = Math.cos(a) * Math.cos(b), y1 = Math.sin(a), z1 = -Math.cos(a) * Math.sin(b);
  var x2 = Math.cos(c) * Math.cos(d), y2 = Math.sin(c), z2 = -Math.cos(c) * Math.sin(d);
  var dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  var ang = Math.acos(dot);
  if (ang < 1e-6 || Math.PI - ang < 1e-6) {        /* same point, or antipodal */
    return [lon0 + (lon1 - lon0) * t, lat0 + (lat1 - lat0) * t];
  }
  var sa = Math.sin(ang);
  var s0 = Math.sin((1 - t) * ang) / sa, s1 = Math.sin(t * ang) / sa;
  var x = s0 * x1 + s1 * x2, y = s0 * y1 + s1 * y2, z = s0 * z1 + s1 * z2;
  return [Math.atan2(-z, x) / C.DEG, Math.asin(Math.max(-1, Math.min(1, y))) / C.DEG];
}

/* WHERE a "take me there" gesture should end, and HOW FAR IN.
   A fixed factor (the old zoomBy(2)) is wrong for both extremes: it leaves France
   filling a quarter of the screen and puts Vatican City in a 3 px dot. So the
   destination zoom is COMPUTED from the target's own bounding box: the ring's
   lon/lat twin is rotated into the frame centred on the destination and projected
   (core.featureExtent), and k is the one that makes that box fit the viewport with
   a margin.

   Two passes, because centring on the CLICK POINT does not centre the country: the
   extent is measured at the clicked point first, its box centre is turned back into
   lon/lat, and the second pass measures the extent at that centre. Only then is the
   fit honest - a box measured off-centre is bigger than the box you get when the
   centre is the box's own middle, and the final zoom would be slightly too wide.

   No feature under the cursor (open ocean) keeps the old behaviour: zoom in by 2
   about the clicked point. */
var FLY_PAD = 0.06;               /* fraction of the viewport kept free on each side */
function fitKForExtent(e, pad) {
  var w = Math.max(1e-9, e[2] - e[0]), h = Math.max(1e-9, e[3] - e[1]);
  var kx = W * (1 - 2 * pad) / w, ky = H * (1 - 2 * pad) / h;
  return clampK(Math.min(kx, ky));
}
var CITY_ZOOM = 7;               /* z of a "stand in this city" view */
function flyTarget(x, y) {
  var g = geoAt(x, y);
  if (!g) return null;
  /* A CITY wins over the country under it, exactly as it does for picking: a dot
     is a deliberate 2-3 px target, and flying to the whole country when the user
     aimed at a city would answer a different question. A city has no bbox of its
     own, so its "fit" is a fixed street-level zoom - but never a zoom OUT, so
     double-clicking a city while already closer in does not pull back. */
  var hp = pickPlaceAt(x, y);
  if (hp >= 0 && places[hp]) {
    var P = places[hp];
    return { lon: P.lon, lat: P.lat, k: clampK(Math.max(view.k, fitK * Math.pow(2, CITY_ZOOM - 2))),
             fit: false, place: hp };
  }
  var fi = pickAt(x, y);
  if (fi < 0 || !feats[fi]) return { lon: g[0], lat: g[1], k: clampK(view.k * 2), fit: false };
  var proj = C.CUR;
  /* MEASURE IN THE FRAME THE FLIGHT WILL ARRIVE IN, not the one it starts from.
     The flight now untwists as it travels, so it lands north-up; a destination
     computed from the current (possibly rolled) frame is fitted to a box that will
     not exist on arrival. Measured for Russia from a rolled start: the box was
     computed 88 % of the viewport and arrived at 55 % - the roll had changed the
     shape of the axis-aligned box. Taking the roll out first makes the computation
     match the arrival by construction. */
  var mUp = new Float64Array(9);
  var rollNow = C.frameRoll(FRAME);
  if (isFinite(rollNow) && Math.abs(rollNow) > 1e-9) C.rollFrame(FRAME, -rollNow, mUp);
  else for (var q0 = 0; q0 < 9; q0++) mUp[q0] = FRAME[q0];
  var m1 = C.moveCentre(mUp, g[0], g[1], proj, new Float64Array(9));
  var e1 = C.featureExtent(feats[fi], m1, proj);
  if (!e1) return { lon: g[0], lat: g[1], k: clampK(view.k * 2), fit: false };
  /* the box centre, back to lon/lat. unproject() answers the ROTATED lon/lat (and
     null outside a cone projection's disc), so the frame inverse turns it into a
     geographic point; if it falls outside the disc, the clicked point stands. */
  var cxp = (e1[0] + e1[2]) / 2, cyp = (e1[1] + e1[3]) / 2;
  var rl = C.unproject(cxp, cyp);
  var gc = rl ? C.unrotM(m1, rl[0] * C.DEG, rl[1] * C.DEG) : null;
  if (!gc || !isFinite(gc[0]) || !isFinite(gc[1])) gc = g;
  /* REFINE. Centring on the first box centre moves the box: rotating the frame
     changes the shape of an axis-aligned bbox, so the centre of the NEW box is a
     little off the point we just centred on. Measured for Germany (persp): 0.054
     plane units after one pass, 3e-4 after two, 0 after three. Two extra passes cost
     a few ms once, at the moment of the click, and buy a country that is actually
     centred instead of 24 px off. */
  /* NORTH-UP, EVERY TIME. moveCentre on a cone projection is parallel transport,
     which keeps the roll it starts with - and "the roll it starts with" drifts
     relative to the CANONICAL frame as the path bends, so transporting from a
     north-up start does not land north-up. Measured for Russia: the transported
     frame measured a box 1.71 plane units wide where the arrival frame (which the
     flight untwists) measures 1.09, i.e. the fit was computed for a frame that never
     exists. So the roll is removed after every move, which is exactly the frame the
     flight guarantees on arrival. */
  function upright(m) {
    var r = C.frameRoll(m);
    if (!isFinite(r) || Math.abs(r) < 1e-12) return m;
    return C.rollFrame(m, -r, new Float64Array(9));
  }
  var e2 = null;
  for (var it = 0; it < 3; it++) {
    var mIt = upright(C.moveCentre(mUp, gc[0], gc[1], proj, new Float64Array(9)));
    e2 = C.featureExtent(feats[fi], mIt, proj);
    if (!e2) break;
    var nx = (e2[0] + e2[2]) / 2, ny = (e2[1] + e2[3]) / 2;
    if (Math.abs(nx) < 1e-5 && Math.abs(ny) < 1e-5) break;
    var rl2 = C.unproject(nx, ny);
    var g2 = rl2 ? C.unrotM(mIt, rl2[0] * C.DEG, rl2[1] * C.DEG) : null;
    if (!g2 || !isFinite(g2[0]) || !isFinite(g2[1])) break;
    gc = g2;
    e2 = null;                     /* the extent just measured belongs to the OLD centre */
  }
  /* MEASURE ONCE MORE AT THE CENTRE BEING RETURNED. Updating `gc` at the end of the
     loop leaves `e2` describing the centre it replaced - measured for Russia, that
     fitted the arrival to 88 % of the viewport and delivered 55 %. (The extent is
     not a smooth function of the centre near a pole: a 2.6 deg move took Russia's
     box from 0.71 x 1.07 to 1.09 x 0.67 plane units, so a stale measurement is not
     "close enough".) */
  var eFin = C.featureExtent(feats[fi], upright(C.moveCentre(mUp, gc[0], gc[1], proj,
                new Float64Array(9))), proj) || e2;
  if (!eFin) return { lon: gc[0], lat: gc[1], k: clampK(view.k * 2), fit: false };
  return { lon: gc[0], lat: gc[1], k: fitKForExtent(eFin, FLY_PAD), fit: true, fi: fi };
}

/* ONE handler for "go there and show me that", whatever produced it: a double
   click on a desktop, a double tap on a touch screen. Having two rules meant the
   phone got a different (and worse) behaviour from the mouse: a bare 1.7x zoom
   instead of the fitted flight. */
function gestureGo(x, y) {
  var t = flyTarget(x, y);
  if (!t) return;
  flyTo(t.lon, t.lat, t.k);
}

/* the double-click flight. Cancelled by any new gesture (see bindPointer): a fly
   that kept running under the user's finger would fight the drag. */
function flyTo(lon, lat, kTo) {
  stopInertia();
  var k0 = view.k, k1 = clampK(kTo);
  fly = {
    t0: loopNow, dur: FLY_DUR, last: 0,
    lon0: view.lon, lat0: view.lat, k0: k0,
    lon1: lon, lat1: lat, k1: k1,
    kMin: Math.max(fitK * 0.45, Math.min(k0, k1) * 0.45)
  };
}
var FLY_ROLL_TAU = 0.13;         /* s: how fast the flight untwists the picture */
var FLY_ROLL_RATE = 4.0;         /* rad/s cap, so a 154 deg roll does not whip */
function stepFly(now) {
  if (!fly) return;
  var t = (now - fly.t0) / fly.dur;
  if (!(t >= 0)) t = 0;
  if (t > 1) t = 1;
  var dt = fly.last ? Math.min(0.1, Math.max(0.004, (now - fly.last) / 1000)) : 0.016;
  fly.last = now;
  /* the zoom dips first, comes back last, and is the SUM of the two ramps so the
     curve is continuous at every phase boundary */
  var kNow = fly.kMin + (fly.k0 - fly.kMin) * (1 - smoothstep(t, 0, 0.34)) +
             (fly.k1 - fly.kMin) * smoothstep(t, 0.62, 1);
  view.k = clampK(kNow);
  if (t >= 0.16) {
    var p = smoothstep(t, 0.16, 0.86);
    var g = slerpLL(fly.lon0, fly.lat0, fly.lon1, fly.lat1, p);
    setCenter(g[0], g[1]);
  }
  /* THE TILT TRAVELS WITH THE FLIGHT. stepAlign deliberately stands down while a
     flight is running (below), because a slow exponential drift under a moving
     camera reads as the horizon sagging. But that left the arrival rolled: the
     flight ends, then the tilt starts from wherever the drag had left it, so the
     last second of the journey was the picture sliding upright AFTER the zoom had
     settled - two movements where the user asked for one. So the flight itself
     untwists, on the same clock, arriving north-up by construction. The time
     constant is short enough (0.13 s) to be finished in the 950 ms flight but long
     enough that the spin is not a snap, and the rate cap keeps a 154 deg roll (a
     drag over a pole) from whipping. A correct roll is a no-op here, so a flight
     that starts north-up does no extra work. */
  if (C.CUR && !C.CUR.pseudocyl && !flyAtPole()) {
    var roll = C.frameRoll(FRAME);
    if (isFinite(roll) && Math.abs(roll) > 1e-5) {
      /* A FIXED time constant is not enough: moving the centre re-rolls the frame
         (parallel transport) by an amount that scales with how fast the world is
         turning, so on a long diagonal flight the correction and the motion can
         reach a balance that never reaches zero - measured, 31.9 deg of roll was
         still -2.5 deg at arrival. So the fraction removed is the larger of "what
         the time constant says" and "all of what is left, spread over the frames
         that remain": the same shape early, and a guarantee that the last frame
         lands on zero. */
      var remain = Math.max(0.05, (1 - t) * fly.dur / 1000);
      var flat = (t > 0.82);        /* final stretch: remove whatever is left */
      var d = flat ? -roll : -roll * Math.min(1, Math.max(dt / FLY_ROLL_TAU, dt / remain));
      if (!flat) {
        var rcap = FLY_ROLL_RATE * dt;
        if (d > rcap) d = rcap; else if (d < -rcap) d = -rcap;
      }
      C.rollFrame(FRAME, d, FRAME2);
      for (var i = 0; i < 9; i++) FRAME[i] = FRAME2[i];
    }
  }
  scheduleReproject();                 /* k changed: the LOD level may have too */
  if (t >= 1) { fly = null; lastMoveT = now; alignPrev = now; }
}
/* at the pole "up" has no direction on screen and the canonical frame is an
   arbitrary choice of longitude, so aligning there would spin the map - the same
   guard stepAlign uses, in one place so the two can never disagree */
function flyAtPole() {
  var c = C.frameCentre(FRAME, FCEN);
  return Math.abs(c[1]) > ALIGN_POLE;
}

/* the gentle tilt back to north-up (see the NORTH-UP comment above) */
function stepAlign(now) {
  if (!northUp || fly || inertia.on || drag || touch) { alignPrev = now; return; }
  if (!C.CUR || C.CUR.pseudocyl) { alignPrev = now; return; }
  var dt = (alignPrev && now > alignPrev) ? Math.min(0.1, (now - alignPrev) / 1000) : 0.016;
  alignPrev = now;
  if (now - lastMoveT < ALIGN_DELAY * 1000) return;
  /* at the pole "north" has no direction on screen and the canonical frame there
     is an arbitrary choice of longitude: aligning would spin the map, which is the
     very bug the frame-carrying view was introduced to fix. Leave it be. */
  if (flyAtPole()) return;
  var roll = C.frameRoll(FRAME);
  if (!isFinite(roll) || Math.abs(roll) < ALIGN_EPS) return;
  var d = -roll * Math.min(1, dt / ALIGN_TAU);
  var cap = ALIGN_MAX_RATE * dt;
  if (d > cap) d = cap; else if (d < -cap) d = -cap;
  C.rollFrame(FRAME, d, FRAME2);
  for (var i = 0; i < 9; i++) FRAME[i] = FRAME2[i];
  scheduleReproject();
}

var keys = {};
window.addEventListener('keydown', function (e) {
  keys[e.key] = true;
  stopInertia();
  if (e.key === 'Enter') {
    if (hoverPlace >= 0) { pickedPlace = hoverPlace; picked = -1; refreshUI(); return; }
    picked = hover; pickedPlace = -1; refreshUI();
  }
  if (e.key === 'r' || e.key === 'R') {
    setCenterFresh(0, 0); fitView(worldBounds());
    refreshUI();
  }
  if (e.key === 'Escape') { if (menuOpen()) { closeMenu(); } else { picked = -1; pickedPlace = -1; hoverPlace = -1; refreshUI(); } }
  if (e.key === 'c' || e.key === 'C') toggleCities();
  if (e.key === 't' || e.key === 'T') toggleLayer();
});
window.addEventListener('keyup', function (e) { keys[e.key] = false; });

function keyStep() {
  var step = 60, zf = 1;
  /* pan() now takes a DRAG delta (both axes subtract), so an arrow that should
     move the view EAST is a drag to the WEST, and "up" (north) is a drag DOWN. */
  var dx = (keys.ArrowLeft ? step : 0) + (keys.ArrowRight ? -step : 0);
  var dy = (keys.ArrowUp ? step : 0) + (keys.ArrowDown ? -step : 0);
  if (keys.a || keys.A) zf *= 1.07;
  if (keys.d || keys.D) zf /= 1.07;
  if (dx || dy) pan(dx, dy);
  if (zf !== 1) zoomBy(zf);
}

/* ---------- touch ----------
   Rewritten for real finger use. Three things were wrong before:
     * a single tap picked a country on TOUCHSTART, so starting a drag showed a
       pick panel for whatever happened to be under the finger;
     * a tap and a drag were indistinguishable, so a small drag also picked;
     * there was no double-tap, and with touch-action:none the browser's own
       double-tap zoom never fires either - so a phone had no "zoom in here".
   Now: touchstart only records; touchmove past an 8 px slop starts a drag; the
   release either glides (if it had speed), fires a pick (a tap), or zooms in when
   it is the second tap within 320 ms and 40 px of the first, and zooms out when a
   second finger joins and leaves without moving. */
var TAP_SLOP = 8, TAP_MS = 320, TAP_DIST = 40;
var lastTap = { t: 0, x: 0, y: 0 };
function touchHandler(e, start) {
  e.preventDefault();
  var ts = e.touches;
  var r = canvasRect;
  if (!ts.length) return;
  if (ts.length === 1) {
    var x = ts[0].clientX - r.left, y = ts[0].clientY - r.top;
    if (start) {
      stopInertia();
      touch = { mode: 'tap', x: x, y: y, sx: x, sy: y, t: nowMs(), moved: 0 };
      startMotion(x, y);
    } else if (touch && touch.mode === 'tap') {
      var d0 = Math.hypot(x - touch.sx, y - touch.sy);
      touch.moved = Math.max(touch.moved, d0);
      if (d0 > TAP_SLOP) {                   /* a drag, not a tap */
        touch.mode = 'pan';
        touch.x = x; touch.y = y;
        return;
      }
    } else if (touch && touch.mode === 'pan') {
      var dx = x - touch.x, dy = y - touch.y;
      if (dx || dy) { pan(dx, dy); touch.x = x; touch.y = y; addMotion(x, y); }
    }
    return;
  }
  /* two fingers: pinch zoom + two-finger drag */
  var a = ts[0], b = ts[1];
  var mx = (a.clientX + b.clientX) / 2 - r.left;
  var my = (a.clientY + b.clientY) / 2 - r.top;
  var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  if (!touch || touch.mode !== 'pinch') {
    stopInertia();
    touch = { mode: 'pinch', d: d, x: mx, y: my };
    lastTap.t = 0;                           /* a pinch is never a double tap */
    return;
  }
  if (touch.d) {
    var f = d / touch.d;
    zoomBy(f);
    pan(mx - touch.x, my - touch.y);
    touch.d = d; touch.x = mx; touch.y = my;
  }
}
function touchEnd(e) {
  e.preventDefault();
  var r = canvasRect;
  if (!touch) return;
  if (touch.mode === 'pinch') {
    /* everything lifted: remember where, so the next tap is not seen as a pair */
    touch = null;
    lastTap.t = 0;
    return;
  }
  var ts = e.changedTouches;
  if (ts && ts.length) {
    var x = ts[0].clientX - r.left, y = ts[0].clientY - r.top;
    if (touch.mode === 'pan') {
      touch.x = x; touch.y = y;
      endMotion();                           /* fling if the finger was moving */
    } else if (touch.mode === 'tap' && nowMs() - touch.t < 500) {
      /* a tap: pick what is under it, and treat a second one as "zoom here" */
      var now = nowMs();
      var isDouble = (now - lastTap.t < TAP_MS) &&
                     Math.hypot(x - lastTap.x, y - lastTap.y) < TAP_DIST;
      if (isDouble) {
        /* THE SAME gesture as a double click. It used to be a bare 1.7x zoom plus a
           recentre, so a touch screen got a different, worse answer to the same
           question ("show me that country") than a mouse did - no flight, no
           fitted zoom, and it threw away the selection. */
        lastTap.t = 0;
        doPick(x, y);
        setHover(x, y);
        gestureGo(x, y);
        refreshUI();
      } else {
        lastTap.t = now; lastTap.x = x; lastTap.y = y;
        doPick(x, y);
        setHover(x, y);
      }
    }
  }
  touch = null;
}
function bindTouch(el) {
  el.addEventListener('touchstart', function (e) { touchHandler(e, true); }, { passive: false });
  el.addEventListener('touchmove', function (e) { touchHandler(e, false); }, { passive: false });
  el.addEventListener('touchend', touchEnd, { passive: false });
  el.addEventListener('touchcancel', function () { touch = null; stopInertia(); }, { passive: false });
}

/* ---------- frame ----------
   The loop now also advances the inertia glide and samples the frame rate. The
   fps is an exponential average of the frame DELTA (so a single 200 ms stall moves
   it, and it settles on what the user actually sees), refreshed into the HUD four
   times a second - every frame would thrash the layout for a number nobody can
   read at 60 Hz. */
bindPointer(stage);
bindTouch(stage);
var fps = { last: 0, ema: 1000 / 60, shown: 60, ms: 16.7, tShown: 0, worst: 0, tWorst: 0 };
var drawMs = { path: 0, paint: 0 };
var reprojSplit = { rings: 0, rest: 0 };
function stepFps(now) {
  if (fps.last) {
    var dt = now - fps.last;
    if (dt > 0 && dt < 2000) {
      fps.ema = fps.ema * 0.88 + dt * 0.12;
      if (dt > fps.worst) fps.worst = dt;
    }
  }
  fps.last = now;
  if (now - fps.tShown > 250) {
    fps.tShown = now;
    fps.shown = Math.round(1000 / Math.max(1, fps.ema));
    fps.ms = fps.ema;
    fps.worst = 0;
  }
}
function loop(now) {
  now = now || nowMs();                 /* the test harness calls f() with no arg */
  loopNow = now;
  canvasRect = canvas.getBoundingClientRect();
  stepFps(now);
  stepInertia(now);
  stepFly(now);
  stepAlign(now);
  keyStep();
  draw();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', function () {
  resize();
  helpEl.textContent = helpText();      /* the hint has a narrow-screen variant */
  hudShown = null;                      /* the HUD wraps differently now */
});

/* Read-only introspection: the two animations above are timed, and a test that can
   only see the canvas cannot tell "the tilt finished" from "the tilt never ran".
   Nothing here writes to the view (setLang is the one exception: the language is a
   property of the whole app, and driving the selector from a test means driving the
   same entry point the menu row uses). */
window.ViewState = {
  lang: function () { return LANG; },
  /* the ONE writing entry point here: the language is a property of the whole app
     and a test must drive the same path the menu chip does */
  setLang: function (code) { setLang(code); },
  cityName: function (i) { return cityName(i); },
  cityNamesLoaded: function () { return Object.keys(cityNames); },
  countryName: function (i) { return feats[i] ? countryName(feats[i].props) : ''; },
  rollDeg: function () { return C.frameRoll(FRAME) * 180 / Math.PI; },
  centre: function () { return [view.lon, view.lat]; },
  k: function () { return view.k; },
  fitK: function () { return fitK; },
  geoAt: function (px, py) { return geoAt(px, py); },
  /* a geographic point -> a screen pixel, for tests that must aim at a place */
  project: function (lon, lat) {
    var o = [0, 0];
    if (!C.projectRotLLVis(lon, lat, FRAME, C.CUR, o)) return null;
    return [o[0] * view.k + (W * 0.5 - view.cx * view.k),
            (H * 0.5 + view.cy * view.k) - o[1] * view.k];
  },
  pickedFeat: function () { return picked; },
  pickedPlace: function () { return pickedPlace; },
  pickAt: function (px, py) { return pickAt(px, py); },
  pickPlaceAt: function (px, py) { return pickPlaceAt(px, py); },
  /* the screen box of a feature as it is drawn NOW: what "the target fits" means */
  screenBox: function (i) {
    var f = feats[i];
    if (!f) return null;
    var b = f.bbox;
    return [sx(b[0]), sy(b[3]), sx(b[2]), sy(b[1])];
  },
  viewSize: function () { return [W, H]; },
  flying: function () { return !!fly; },
  northUp: function () { return northUp; },
  tilted: function () { return Math.abs(C.frameRoll(FRAME)) > 1e-9; }
};

})();
