/* Eckert IV viewer: fullscreen canvas, wheel/pinch zoom, drag pan, hover + pick.
   Projection + geometry come from core.js (window.AppCore). */
(function () {
'use strict';

var C = window.AppCore;
var stage = document.getElementById('stage');
var canvas = document.getElementById('map');
var labelsCv = document.getElementById('labels');
var labelsCtx = labelsCv.getContext('2d');
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
   limb has the depth cue of a globe instead of a flat disc. `ortho` is still one
   menu row away for anyone who wants the flat hemisphere.
   Both were the two projections where arriving at a pole exposed the rotation
   problem (see the FRAME comment above); the fix is the same for both, because
   the fix is in the view's rotation, not in the projection.
   ?proj= overrides it. */
var projID = 'persp';
var menuEl = document.getElementById('menu');
var burgerEl = document.getElementById('burger');
var itemsEl = document.getElementById('items');

/* viewing modes: '2d' = Eckert IV plate carree, '3d' = the lit 3D sphere the
   projection's lon/lat grid wraps onto. Same data, same picking logic. */
var mode = '2d';

/* the burger menu: closed it is only the burger, whose tag names the active
   view; opening it stacks the choices in a column underneath. A chip is a PICK,
   not a toggle: clicking the active one only re-opens the menu, so clicking
   twice can never undo a choice the user already made. */
/* The menu is GROUPED (View / Projection / Layer). One flat list of twelve rows
   was fine on a desktop panel but ran off the bottom of a phone screen, and a
   phone user cannot tell which of "Eckert IV" and "50m sovereignty" is a
   projection and which is a layer. The groups are built from this model, so
   adding a projection or a layer to the registries still needs no edit here. */
function menuGroups() {
  var projs = [], i;
  for (var key in C.PROJ) {
    if (!C.PROJ.hasOwnProperty(key)) continue;
    if (!C.PROJ[key].recenter) continue;         /* cannot be shown re-centered */
    projs.push({ id: 'proj:' + key, label: '', ico: '\u25a6' });
  }
  var layers = [], files = LAYERS || [];
  for (i = 0; i < files.length; i++) layers.push({ id: 'layer:' + files[i].id, label: '', ico: '\u2263' });
  return [
    { title: 'View', items: [{ id: '2d', label: 'Map (2D)', ico: '\u25ad' },
                             { id: '3d', label: 'Globe', ico: '\u25ce' }] },
    { title: 'Projection', items: projs, needs2d: true },
    { title: 'Layer', items: layers }
  ];
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
  if (m === '2d') return 'Map (2D)';
  if (m === '3d') return 'Globe';
  if (m.indexOf('proj:') === 0) {
    var p = C.PROJ[m.slice(5)];
    if (p) return p.label;
  }
  if (m.indexOf('layer:') === 0) return layerLabel(m.slice(6));
  return m;
}
/* what the closed burger says: the projection in 2D (more informative than
   "Map"), the mode itself in 3D */
function burgerTag() {
  if (mode === '3d') return 'Globe';
  return C.CUR.label;
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
  /* close FIRST, then act: closing last meant that an action which throws (a 3D
     switch with no WebGL, a failed layer fetch) left the sheet open on top of the
     error, and the tap looked ignored. It also just feels right: the row is a
     choice, and the sheet should get out of the way as soon as it is made. */
  closeMenu();
  if (!id) return;
  if (id.indexOf('proj:') === 0) { setProjection(id.slice(5)); return; }
  if (id.indexOf('layer:') === 0) { setLayer(id.slice(6)); return; }
  setMode(id);
}
/* pick a layer by id (menu row, ?layer=, or the t key) */
function setLayer(id) {
  userPickedLayer = true;
  layerName = id;
  useLayer(id);
  if (mode === '3d' && loaded[id]) setGlobeLayer(id);
  refreshMenu();
}
/* switching projection keeps the geographic centre, so the place you were
   looking at stays the centre of the new projection */
function setProjection(id) {
  if (!C.PROJ[id]) return;
  projID = id;
  C.setProjection(id);
  if (mode === '3d') setMode('2d');
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
    if (t.classList && t.classList.contains('menuitem')) return t;
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

var THREE = null;                    /* three.js namespace, set by boot.js */
/* the IIFE's own `var THREE` shadows the global `window.THREE` that three.bundle.cjs
   sets, so a plain read would stay null forever — grab it explicitly */
if (window.THREE) THREE = window.THREE;
var scene3 = null, cam3 = null, renderer3 = null, rayc = null;
var ndc = null;                      /* reusable NDC pair for the raycaster */
var globe = { lon: 0, lat: 0, dist: 3.05 };
var Rg = 1;                          /* globe radius */
var globeGroup = null;
var globeCache = {};                 /* (layer, LOD level) -> built meshes, LRU of 2 */
var globeClock = 0;                  /* LRU stamp */
var globeSewn = {};                  /* layer id -> the globe ladder was sewn on it */
var globeLvlOverride = -1;           /* ?lod=NN pins a level (inspection); -1 = auto */
var gHover = -1, gPicked = -1;

/* buildMenu() is called further down, right before loadAll(): it reads LAYERS and
   PROJ, whose initialisers run after this point in the file */

function dbg() { return /[?&]dbg=1/.exec(urlSearch()) !== null; }
function urlMode() {
  var m = /[?&]mode=(2d|3d)/.exec(urlSearch());
  if (m) return m[1];
  return mode;
}
var hover = -1, picked = -1;
var mouse = { x: 0, y: 0, inside: false };
var canvasRect = { left: 0, top: 0 };

var COL = {
  ocean: '#1e4d75', oceanDeep: '#143456',
  land: '#c9c9c7', hover: '#edf0e9', pick: '#ffffff',
  edge: 'rgba(22,36,50,.5)', graticule: 'rgba(210,228,240,.16)', frame: 'rgba(232,242,252,.5)'
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
var LAYERS = [
  { id: '50m',  file: DATA_DIR + 'so50.geojson',      label: 'Natural Earth 50m sovereignty' },
  { id: '110m', file: DATA_DIR + 'countries.geojson',  label: 'Natural Earth 110m countries' },
  { id: '10m',  file: DATA_DIR + 'ne10m.geojson',      label: 'Natural Earth 10m map units', lazy: true }
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
    fetch(DATA_DIR + 'countries.geojson').then(function (r) { return r.json(); }),
    fetch(DATA_DIR + 'so50.geojson').then(function (r) { return r.json(); })
  ]).then(function (pair) {
    var g110 = pair[0], g50 = pair[1];
    noteRef(g110);
    loaded['110m'] = C.buildFeaturesLOD(g110, 0.2, true);   /* keepLL: the 3D globe needs the lon/lat twin of each ring */
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
    resize();          /* before setMode: init3D sizes the GL canvas from W,H */
    setMode(urlMode());
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
      if (mode === '3d') globe.dist = Math.max(1.45, Math.min(9, 3.05 / Math.pow(2, parseFloat(mz[1]) - 2)));
      else zoomBy(Math.pow(2, parseFloat(mz[1]) - 2));
    }
    layout = buildLabels();
    hud.textContent = hudText();
    helpEl.textContent = helpText();
    loop();
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

function toggleLayer() {
  var i = 0;
  for (var q = 0; q < LAYERS.length; q++) if (LAYERS[q].id === layerName) i = q;
  var other = LAYERS[(i + 1) % LAYERS.length].id;      /* 50m -> 110m -> 10m -> 50m */
  layerName = other;
  useLayer(other);
  /* the globe meshes are per-layer geometry, so switching layer without
     rebuilding here left the 3D view drawing the OTHER layer's countries while
     the HUD read '50m sovereignty' - and buildGlobe's key is (layer, level), so
     a switch back is a cache hit and costs nothing. */
  if (mode === '3d') setGlobeLayer(other);
}

function fetchLayer(id, done) {
  var def = null;
  for (var i = 0; i < LAYERS.length; i++) if (LAYERS[i].id === id) def = LAYERS[i];
  if (!def || loaded[id] || loadingLayer) return;
  loadingLayer = id;
  var wasText = hud.textContent;
  hud.textContent = 'loading ' + def.label + '…';
  fetch(def.file).then(function (r) { return r.json(); }).then(function (geo) {
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
        globeSewn[id] = 0;
        recenterDirty = false;
        reproject();
        if (mode === '3d') setGlobeLayer(id);
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
  if (mode !== '2d' || !feats.length) return;
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
      name: p.NAME_LONG || p.NAME,
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
  if (mode === '3d') { draw3D(); return; }
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
  drawLabels(zoomLevel());
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

function drawLabels(z) {
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  var placed = [], shown = 0;
  for (var i = 0; i < layout.length; i++) {
    var L = layout[i];
    if (z < L.minz - 0.2 || z > L.maxz + 0.6) continue;
    var px = sx(L.lx), py = sy(L.ly);
    if (px < 24 || py < 12 || px > W - 24 || py > H - 12) continue;
    var w = ctx.measureText(L.name).width + 8, h = 15;
    var box = [px - w / 2, py - h / 2, px + w / 2, py + h / 2];
    var ok = true;
    for (var q = 0; q < placed.length && ok; q++) {
      var b = placed[q];
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) ok = false;
    }
    if (!ok) continue;
    placed.push(box);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,22,32,.75)'; ctx.strokeText(L.name, px, py);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillText(L.name, px, py);
    if (++shown > 80) break;
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
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
  if (mode === '3d') {
    var h3 = pick3D(px, py);
    if (h3 !== gHover) { gHover = h3; highlight3D(); refreshUI(); }
    return;
  }
  var h = pickAt(px, py);
  if (h !== hover) { hover = h; refreshUI(); }
}
function pickAtPoint(px, py) { return (mode === '3d') ? pick3D(px, py) : pickAt(px, py); }
function doPick(px, py) {
  var h = pickAtPoint(px, py);
  if (mode === '3d') gPicked = h; else picked = h;
  highlight3D();
  refreshUI();
}

/* ---------- 3D: the same polygons wrapped onto the sphere ----------
   A ring is stored twice: projected (for the 2D view) and lon/lat (rg.ll),
   with IDENTICAL point order, so the same decimation level feeds both views.
   Triangles ear-clipped in the Eckert IV plane can be mapped back onto the
   sphere edge for edge - the projection is a bijection - and because it is
   equal-area, land keeps its true relative size on the globe. */
function sphToVec(lon, lat) {
  var la = lon * C.DEG, ph = lat * C.DEG, cp = Math.cos(ph);
  /* RIGHT-handed sphere frame: three.js is right-handed with +X right, +Y up,
     +Z toward the viewer, and with the camera at +X looking at the origin the
     screen's right is -Z. So east (+lon) must land on -Z, i.e. z = -cos(phi)
     sin(lambda). The old z = +cos(phi) sin(lambda) was a LEFT-handed frame:
     every meridian folded over the x/y plane, so the whole globe came out
     mirrored (Africa read east of Europe, labels on the wrong side). */
  return [Rg * cp * Math.cos(la), Rg * Math.sin(ph), -Rg * cp * Math.sin(la)];
}

function init3D() {
  if (!THREE) { fail('no three.js'); return; }
  renderer3 = new THREE.WebGLRenderer({ antialias: true });
  renderer3.setPixelRatio(DPR);
  renderer3.setSize(W, H);
  renderer3.domElement.id = 'ggl';   /* styled position:fixed in style.css, and the CSS rule is by id */
  stage.appendChild(renderer3.domElement);
  rayc = new THREE.Raycaster();
  newScene();
}

function newScene() {
  scene3 = new THREE.Scene();
  cam3 = new THREE.PerspectiveCamera(38, W / H, 0.001, 100);
  scene3.add(new THREE.AmbientLight(0xffffff, 0.62));
  var key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(1, 0.65, 1.6);
  scene3.add(key);
  /* ocean sphere sits a hair under the land crust */
  var oceanR = Rg * 0.9965;
  var mocean = /[?&]ocean=([0-9.]+)/.exec(urlSearch());   /* debug: ocean radius fraction of Rg */
  if (mocean) oceanR = Rg * parseFloat(mocean[1]);
  var oc = new THREE.Mesh(new THREE.SphereGeometry(oceanR, 96, 64),
    new THREE.MeshLambertMaterial({ color: 0x1e4d75 }));
  oc.userData.ocean = true;
  scene3.add(oc);
  if (/[?&]nocean=1/.exec(urlSearch())) scene3.remove(oc);   /* debug: expose geometric holes */
  /* graticule: same 15 deg grid as the 2D view */
  var gl = [];
  for (var la = -180; la < 180; la += 15) {
    for (var ph = -90; ph < 90; ph += 5) {
      var a2 = sphToVec(la, ph), b2 = sphToVec(la, ph + 5);
      gl.push(a2[0], a2[1], a2[2], b2[0], b2[1], b2[2]);
    }
  }
  for (var ph2 = -75; ph2 <= 75; ph2 += 15) {
    for (var lo = -180; lo < 180; lo += 5) {
      var c2 = sphToVec(lo, ph2), d2 = sphToVec(lo + 5, ph2);
      gl.push(c2[0], c2[1], c2[2], d2[0], d2[1], d2[2]);
    }
  }
  var gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  if (!/[?&]nograticule=1/.exec(urlSearch()))   /* debug: the graticule sits at exactly Rg, same as the land crust */
  scene3.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x8ab4d4, transparent: true, opacity: 0.2 })));
}

/* one Mesh per feature so hover/pick is a material swap and picking is a
   raycast; geometry is built once per (layer, LOD level) and cached */
/* the land is a crust on the sphere, but each ear triangle is FLAT: its chords
   dip inside the sphere by 1 - cos(edgeAngle/2), which is 1.5% of R at a 10°
   edge — and the ocean shell sits at 0.9965 R, so an un-subdivided triangle
   punches a visible hole in the sea (the Sahara, Siberia, Brazil...). Split
   each triangle until every edge is under SAG_MAX_DEG.

   A per-triangle test is not enough: two neighbours that split a SHARED edge a
   different number of times leave a T-junction, and the gap between them reads
   as a hairline crack across the country. So the split count is a property of
   the EDGE (same idiom as the LOD ladder in core.js: the coarsest thing that
   stays under the error), then relaxed until each triangle's depth is the max
   of its three edges - over the WHOLE LAYER, not per feature: a national border
   is two separate rings, so its two copies sit in different features and a
   per-feature relaxation lets them settle apart (measured at LOD 9 on the 50m
   layer: 11.1 % of the 107 698 shared edges mismatched, i.e. a crack along
   every border; the global fixed point leaves 1 of them, a duplicate vertex).
   Measured cost at LOD 9: 91k base triangles -> 3.7 M with cap 3. */
var SAG_MAX_DEG = 6;      /* caps the sag at 0.137% of R; the ocean shell is 0.35%
    inboard, so the margin between a chord and the shell is 0.21% of R = about
    1.3 px at the globe edge - enough that the two never z-fight. At 9 deg the
    margin was only 0.04% (0.2 px) and the hairline cracks were that fight. */
var DEPTH_CAP = 3;        /* the relaxation's fixed point wants depth 4 in a few
    places; at cap 3 the worst chord is 6 deg (sag 0.15% of R, still inside the
    0.35% ocean inset) and the layer is 3.7 M triangles at LOD 9. Cap 2 would
    be 1.0 M but its 12.5 deg chords sag 0.60% - past the ocean shell. */

function sphMid(a, b) {
  var x = (a[0] + b[0]) * 0.5, y = (a[1] + b[1]) * 0.5, z = (a[2] + b[2]) * 0.5;
  var L = Math.sqrt(x * x + y * y + z * z);
  if (L < 1e-12) return [a[0], a[1], a[2]];
  return [x / L, y / L, z / L];
}

function sphAng(a, b) {
  var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(d < -1 ? -1 : (d > 1 ? 1 : d)) / C.DEG;
}

/* unit vector for a lon/lat pair, in the sphere's frame: x points at 0,0 and
   z at +lon, the same convention as sphToVec in core.js */
function uv(lon, lat) {
  var la = lon * C.DEG, ph = lat * C.DEG, cp = Math.cos(ph);
  return [cp * Math.cos(la), Math.sin(ph), -cp * Math.sin(la)];   /* same right-handed frame as sphToVec */
}

function sphSub(a, b, c, depth, out) {
  if (depth <= 0) { out.push(a, b, c); return; }
  var ab = sphMid(a, b), bc = sphMid(b, c), ca = sphMid(c, a);
  sphSub(a, ab, ca, depth - 1, out);
  sphSub(ab, b, bc, depth - 1, out);
  sphSub(ca, bc, c, depth - 1, out);
  sphSub(ab, bc, ca, depth - 1, out);
}

/* the split count an edge demands: the coarsest 2^d split that keeps every
   sub-chord under SAG_MAX_DEG. A PURE function of the edge, so both sides of
   a shared border compute the same value. */
function edgeDepth(a, b) {
  var L = sphAng(a, b);
  if (L <= SAG_MAX_DEG) return 0;
  return Math.ceil(Math.log(L / SAG_MAX_DEG) / Math.log(2));
}
function ekeyOf(a, b) {
  var ka = Math.round(a[0] * 1e6) + ',' + Math.round(a[1] * 1e6) + ',' + Math.round(a[2] * 1e6);
  var kb = Math.round(b[0] * 1e6) + ',' + Math.round(b[1] * 1e6) + ',' + Math.round(b[2] * 1e6);
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
}

/* the GLOBE's own LOD level, from the true screen scale at the tangent point.
   A perspective camera with fov f puts a world unit at the near surface (dist -
   Rg) at (H/2)/(tan(f/2) * (dist - Rg)) px. One projected map unit is 2 PI /
   5.3060017 rad of arc (the whole world spans 5.3060017 projected units), so
   the budget in projected units is px * that factor. Same 0.9 px budget the 2D
   view uses. Measured level across the zoom range: z 0.2 -> 2, z 2.0 -> 3,
   z 2.7 -> 4, z 3.7 -> 5, z 4.8 -> 6 - the old formula stayed at 0 all the way
   to z 7. */
function globeLevel() {
  if (globeLvlOverride >= 0) return globeLvlOverride;
  var fov = 38;
  var pxPerR = (H * 0.5) / (Math.tan(fov * 0.5 * C.DEG) * (globe.dist - Rg));
  var ppu = pxPerR * (2 * Math.PI / 5.3060017);
  var lvl = 0;
  for (var t = 0; t < C.LOD_U.length - 1; t++) {
    if (C.LOD_U[t] * ppu <= 0.9) { lvl = t; break; }
  }
  return lvl;
}

function buildGlobe() {
  if (!THREE || !feats.length) return;
  /* ---- LOD level from the TRUE screen scale at the tangent point ----
     The old formula, min(W,H)*0.5 / (dist*2), is the scale of an ORTHOGRAPHIC
     view of a globe that spans 2R on a min(W,H)-px screen. This camera is
     PERSPECTIVE with fov 38 and the near surface sits at dist - Rg, so the real
     px per world unit at the point facing the camera is
        (H/2) / (tan(fov/2) * (dist - Rg))
     which at H=800, dist=3.05 is 268.6 px/R against the 65.6 the old formula
     gave: 4.1x. Projected map units are not world units either - the whole
     world (360 deg = 2 PI rad) spans 5.3060 projected units - so one more
     factor of 2 PI / 5.3060017. Measured: the old pick was LOD 0 at every
     distance up to dist 0.19, i.e. the same coarsest ring was drawn at
     z 2.0 AND at z 7, which is the "no LOD when zooming" the user sees.
     With the correct scale the level walks 3 -> 4 -> 5 -> 6 -> 7 across the
     zoom range (0.9 px budget, the same one the 2D view uses). */
  var mlo = /[?&]lod=([0-9]+)/.exec(urlSearch());   /* ?lod=9 forces a level, for inspection */
  globeLvlOverride = mlo ? Math.max(0, Math.min(C.LOD_U.length - 1, parseInt(mlo[1]))) : -1;
  var lvl = globeLevel();
  var ck = layerName + ':' + lvl;
  var cached = globeCache[ck];
  if (cached) {
    cached.used = ++globeClock;
    /* setMode('2d') leaves the group in scene3 (the renderer is just hidden), so
       a second scene3.add() of the same group would double it in .children and
       draw the layer twice: detach before attaching. */
    if (cached.group.parent) cached.group.parent.remove(cached.group);
    globeGroup = cached.group; scene3.add(globeGroup); return;
  }
  /* pass 1: every triangle of the WHOLE LAYER in one array - stride 8: the 3
     unit-sphere vertices, the 3 edge keys, the split depth, the feature index.
     The layer is relaxed as ONE problem because a national border is TWO rings
     (the dataset carries no topology), so the two copies of a shared edge live
     in different features. Measured on the 50m layer at LOD 9, over all 107 698
     shared edges: relaxing feature by feature leaves 11.1 % of them split
     differently on the two sides -> a hairline crack along every border. The
     global fixed point below leaves 1 of them, and that one is a duplicated
     ring vertex, not a real T-junction. */
  var T = [], edgeTri = {}, t0 = Date.now();
  /* the globe's ladder is SEWN (see core.js): the 2D ladder above is per-ring
     and leaves 24-93 % of the drawn border edges on one side only, which on a
     globe is a crack down to the ocean shell rather than a hairline on land.
     Sewing costs 118 ms (110m) / 306 ms (50m) once per layer. */
  if (!globeSewn[layerName]) { C.sewGlobeLadder(feats); globeSewn[layerName] = 1; }
  for (var i = 0; i < feats.length; i++) {
    var ft = feats[i];
    for (var r = 0; r < ft.rings.length; r++) {
      var rg = ft.rings[r];
      if (!rg.ll) continue;
      /* triangulate the DECIMATED lon/lat ring, not the projected one: the
         ear-clipping tests (collinearity, convexity, diagonal-vs-edge) must run
         in the space the vertices are actually placed in, and a geodesic edge
         is not straight in Eckert IV. Decimating first also keeps the triangle
         count down at low LOD, where the coarse ring is what is drawn. */
      var lla = C.ringGlobeLLAtLevel(rg, lvl);   /* the GLOBE ladder (sewn), not the 2D one */
      if (!lla) continue;   /* triangulateRing returns [] for a ring with < 3 points;
         a length guard of 8 (4 points) silently drops whole small islands */
      var tr = C.ringGlobeTris(rg, lvl);   /* cached per (ring, level) on the globe ladder:
         the clip is 1.7 s of the 50m LOD-8 build, the Lawson refine only 16 ms of it, so a
         rebuild or a layer switch pays the refine alone. Measured with the sewn ladder:
         pass 1 warm is 180-330 ms on the 50m layer at LOD 3-6 */
      for (var k = 0; k < tr.length; k += 3) {
        var i1 = tr[k], i2 = tr[k + 1], i3 = tr[k + 2];
        if (i1 === i2 || i2 === i3 || i3 === i1) continue;
        var A = uv(lla[i1 * 2], lla[i1 * 2 + 1]), B = uv(lla[i2 * 2], lla[i2 * 2 + 1]),
            Cc = uv(lla[i3 * 2], lla[i3 * 2 + 1]);
        var e0 = ekeyOf(A, B), e1 = ekeyOf(B, Cc), e2 = ekeyOf(Cc, A);
        var d0 = edgeDepth(A, B), d1 = edgeDepth(B, Cc), d2 = edgeDepth(Cc, A);
        var s0 = T.length;
        T.push(A, B, Cc, e0, e1, e2,
          d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2), i);
        for (var q0 = 0; q0 < 3; q0++) {
          var ek = T[s0 + 3 + q0];
          if (edgeTri[ek]) edgeTri[ek].push(s0); else edgeTri[ek] = [s0];
        }
      }
    }
  }
  /* pass 2: relax to a fixed point over the LAYER. A triangle must be split at
     least as often as the most demanding of its 3 edges, and raising that depth
     raises the other triangles on those edges, which raises their edges... so
     sweep the edge -> triangle adjacency until nothing moves.

     The plain sweep is a measurement trap: it needs 26 passes before the cascade
     stops moving (measured: 63-870 ms per build, and the sweep count kept hitting
     the cap), because it propagates one hop per pass. Same fixed point, propagated
     once: bucket the edges by the depth they demand and drain HIGH TO LOW, pushing
     an edge back into its new bucket when raising a neighbour demands more. A
     triangle's depth is the max over its 3 edges, so a depth can only rise - the
     drain terminates and each edge is re-examined only when something changed.
     Verified: 0 shared edges with two different depths on their two sides (the
     old sweep's own "1 mismatched edge" was a duplicate ring vertex). Cost
     measured: 9 ms (110m) / 81-108 ms (50m) instead of 63-870 ms. */
  var edgeD = {}, maxD = 0;
  var ekeys2 = Object.keys(edgeTri);
  for (var ek3 = 0; ek3 < ekeys2.length; ek3++) {
    var arr0 = edgeTri[ekeys2[ek3]], dm0 = 0;
    for (var a4 = 0; a4 < arr0.length; a4++) if (T[arr0[a4] + 6] > dm0) dm0 = T[arr0[a4] + 6];
    edgeD[ekeys2[ek3]] = dm0;
    if (dm0 > maxD) maxD = dm0;
  }
  var bucketsD = [];
  for (var d2 = 0; d2 <= maxD; d2++) bucketsD.push([]);
  for (var ek4 = 0; ek4 < ekeys2.length; ek4++) if (edgeD[ekeys2[ek4]] > 0) bucketsD[edgeD[ekeys2[ek4]]].push(ekeys2[ek4]);
  for (var d3 = maxD; d3 >= 1; d3--) {
    var buck = bucketsD[d3];
    for (var n2 = 0; n2 < buck.length; n2++) {   /* the same array: pushes land after n2 */
      var ek5 = buck[n2];
      if (edgeD[ek5] !== d3) continue;
      var arr1 = edgeTri[ek5];
      var dm1 = d3;
      for (var a5 = 0; a5 < arr1.length; a5++) if (T[arr1[a5] + 6] > dm1) dm1 = T[arr1[a5] + 6];
      if (dm1 !== d3) { if (dm1 <= maxD) bucketsD[dm1].push(ek5); edgeD[ek5] = dm1; continue; }
      for (var a6 = 0; a6 < arr1.length; a6++) {
        var si = arr1[a6];
        if (T[si + 6] < d3) {
          T[si + 6] = d3;
          for (var q2 = 0; q2 < 3; q2++) {
            var ek6 = T[si + 3 + q2];
            if (edgeD[ek6] < d3) { edgeD[ek6] = d3; bucketsD[d3].push(ek6); }
          }
        }
      }
    }
  }
  /* pass 3: emit one mesh per feature, so picking and highlighting stay
     per-country. Vertices are not shared any more - the subdivision points are
     new and the ring vertices get duplicated, at most 2.4x the memory. */
  var buckets = [];
  for (var b = 0; b < feats.length; b++) buckets.push(null);
  for (var t = 0; t < T.length; t += 8) {
    var bi = T[t + 7];
    if (!buckets[bi]) buckets[bi] = [];
    buckets[bi].push(t);
  }
  var group = new THREE.Group();
  for (var i2 = 0; i2 < buckets.length; i2++) {
    var bt = buckets[i2];
    if (!bt) continue;
    var pos = [], idx = [], pOff = 0;
    for (var b2 = 0; b2 < bt.length; b2++) {
      var t2 = bt[b2];
      var dep = T[t2 + 6] > DEPTH_CAP ? DEPTH_CAP : T[t2 + 6];
      var sub = [];
      sphSub(T[t2], T[t2 + 1], T[t2 + 2], dep, sub);
      for (var s = 0; s < sub.length; s++) {
        var u = sub[s];
        pos.push(u[0] * Rg, u[1] * Rg, u[2] * Rg);
        idx.push(pOff++);
      }
    }
    if (!pos.length) continue;
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var mat = /[?&]flat=1/.exec(urlSearch())
      ? new THREE.MeshBasicMaterial({ color: 0xc9c9c7, side: THREE.DoubleSide })   /* debug: unlit, isolates normals/lighting from geometry */
      : new THREE.MeshLambertMaterial({ color: 0xc9c9c7, side: THREE.DoubleSide });
    var m = new THREE.Mesh(g, mat);
    m.userData.tris = idx.length / 3;
    m.userData.nan = 0;
    for (var nn = 0; nn < pos.length; nn++) if (!(pos[nn] === pos[nn])) m.userData.nan++;
    m.userData.i = i2;
    group.add(m);
  }
  /* ---- pass 4: stroke the interior borders over the crust.
     Each country carries its OWN copy of a shared border and the two copies
     are decimated INDEPENDENTLY, so along a border the two sides keep
     different vertices: measured at LOD 9, 76 815 of the 119 927 decimated
     edges are used once, and a vertex-conform pass changes nothing (0
     interior vertices are shared). So the gap cannot be closed by matching
     keys or by depth relaxation - 29 hairline slivers of sea were still
     visible inside land. 2D hides the same thing by stroking the border, so
     do the same here: a strip on the border, floated just above the crust,
     in a slightly darker grey. Only INTERIOR borders get a strip - decided
     from the FINEST data, where a shared edge really is shared - so coastlines
     keep their exact shape and the sea edge stays crisp. */
  var FIN = C.LOD_U.length - 1;   /* the level map is built in LON/LAT at the
     finest level - the same space the decimated rings below live in. rg.pts is
     PROJECTED world space, a different one: mixing the two left the strip
     empty (kids stayed 201 and no border was drawn). */
  var vk = function (x, y) { return Math.round(x * 1e6) + ',' + Math.round(y * 1e6); };
  var inter = {};
  for (var fi = 0; fi < feats.length; fi++) for (var ri = 0; ri < feats[fi].rings.length; ri++) {
    var rgf = feats[fi].rings[ri];
    var pts = rgf.ll ? C.ringLLAtLevel(rgf, FIN) : null;
    if (!pts || pts.length < 6) continue;
    var nf2 = pts.length / 2;
    for (var ei2 = 0; ei2 < nf2; ei2++) {
      var ka = vk(pts[ei2 * 2], pts[ei2 * 2 + 1]);
      var kb = vk(pts[((ei2 + 1) % nf2) * 2], pts[((ei2 + 1) % nf2) * 2 + 1]);
      if (ka === kb) continue;
      var kk = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      if (inter[kk]) inter[kk] = 2; else inter[kk] = 1;
    }
  }
  /* a decimated edge is on an interior border when the FINE edge it spans is
     shared by two features. The level lists are index subsets of the same ring,
     so the drawn edge ia->ib covers the fine edges ia..ib: testing the fine edge
     ia -> ia+1 in `inter` is exact, no grid and no tolerance needed. (The grid
     version matched a LON/LAT `inter` map against PROJECTED rg.pts midpoints, so
     it found nothing at all: the strip mesh was never built, kids stayed 201 and
     the cracks along the borders stayed open down to the ocean shell.) */
  var meanStep = 0, nStep = 0;
  for (var f3 = 0; f3 < feats.length; f3++) for (var r3 = 0; r3 < feats[f3].rings.length; r3++) {
    var rg3 = feats[f3].rings[r3];
    if (!rg3.ll) continue;
    var l3 = C.ringGlobeLLAtLevel(rg3, lvl);
    if (!l3 || l3.length < 6) continue;
    var n3 = l3.length / 2;
    for (var e3 = 0; e3 < n3; e3++) {
      meanStep += Math.hypot(l3[((e3 + 1) % n3) * 2] - l3[e3 * 2], l3[((e3 + 1) % n3) * 2 + 1] - l3[e3 * 2 + 1]);
      nStep++;
    }
  }
  var bandDeg = nStep ? Math.max(0.05, Math.min(2.0, 2.6 * (meanStep / nStep))) : 0.1;
  var bp = [];
  for (var f4 = 0; f4 < feats.length; f4++) for (var r4 = 0; r4 < feats[f4].rings.length; r4++) {
    var rg4 = feats[f4].rings[r4];
    var llF = rg4.ll ? C.ringLLAtLevel(rg4, FIN) : null;
    if (!llF || llF.length < 6) continue;
    var nF = llF.length / 2;
    var idxs = rg4.gl[lvl];
    var nd = idxs.length;
    if (nd < 3) continue;
    for (var e4 = 0; e4 < nd; e4++) {
      var ia = idxs[e4], ib = idxs[(e4 + 1) % nd];
      if (ia === ib) continue;
      /* the drawn edge stands for the fine edges ia..ib; a coarse span can
         start on a coast and end on a border, so decide by MAJORITY of the fine
         edges it covers (sampled, at most 8) rather than the first one only */
      var span = (ib - ia + nF) % nF;
      if (span < 1) continue;
      var nsamp = span < 8 ? span : 8, hit = 0;
      for (var s4 = 0; s4 < nsamp; s4++) {
        var fa = (ia + Math.floor(s4 * span / nsamp)) % nF;
        var fb = (fa + 1) % nF;
        var ka4 = vk(llF[fa * 2], llF[fa * 2 + 1]);
        var kb4 = vk(llF[fb * 2], llF[fb * 2 + 1]);
        if (ka4 !== kb4 && inter[ka4 < kb4 ? ka4 + '|' + kb4 : kb4 + '|' + ka4] === 2) hit++;
      }
      if (hit * 2 <= nsamp) continue;
      var ax4 = llF[ia * 2], ay4 = llF[ia * 2 + 1], bx4 = llF[ib * 2], by4 = llF[ib * 2 + 1];
      var A1 = uv(ax4, ay4), B1 = uv(bx4, by4);
      var nx = A1[1] * B1[2] - A1[2] * B1[1], ny = A1[2] * B1[0] - A1[0] * B1[2], nz = A1[0] * B1[1] - A1[1] * B1[0];
      var LL = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (LL < 1e-12) continue;
      nx /= LL; ny /= LL; nz /= LL;
      var px = ny * A1[2] - nz * A1[1], py = nz * A1[0] - nx * A1[2], pz = nx * A1[1] - ny * A1[0];
      var PL = Math.sqrt(px * px + py * py + pz * pz);
      if (PL < 1e-12) continue;
      px /= PL; py /= PL; pz /= PL;
      var s2 = bandDeg * C.DEG * 0.5;
      var A2 = [A1[0] + s2 * px, A1[1] + s2 * py, A1[2] + s2 * pz];
      var B2 = [B1[0] + s2 * px, B1[1] + s2 * py, B1[2] + s2 * pz];
      var A3 = [A1[0] - s2 * px, A1[1] - s2 * py, A1[2] - s2 * pz];
      var B3 = [B1[0] - s2 * px, B1[1] - s2 * py, B1[2] - s2 * pz];
      var L2a = Math.sqrt(A2[0] * A2[0] + A2[1] * A2[1] + A2[2] * A2[2]);
      var L2b = Math.sqrt(B2[0] * B2[0] + B2[1] * B2[1] + B2[2] * B2[2]);
      var L2c = Math.sqrt(A3[0] * A3[0] + A3[1] * A3[1] + A3[2] * A3[2]);
      var L2d = Math.sqrt(B3[0] * B3[0] + B3[1] * B3[1] + B3[2] * B3[2]);
      var lift = 1.0018;
      bp.push(A1[0] * Rg * lift, A1[1] * Rg * lift, A1[2] * Rg * lift,
              B1[0] * Rg * lift, B1[1] * Rg * lift, B1[2] * Rg * lift,
              B2[0] / L2b * Rg * lift, B2[1] / L2b * Rg * lift, B2[2] / L2b * Rg * lift);
      bp.push(A1[0] * Rg * lift, A1[1] * Rg * lift, A1[2] * Rg * lift,
              B2[0] / L2b * Rg * lift, B2[1] / L2b * Rg * lift, B2[2] / L2b * Rg * lift,
              A2[0] / L2a * Rg * lift, A2[1] / L2a * Rg * lift, A2[2] / L2a * Rg * lift);
      bp.push(A1[0] * Rg * lift, A1[1] * Rg * lift, A1[2] * Rg * lift,
              B3[0] / L2d * Rg * lift, B3[1] / L2d * Rg * lift, B3[2] / L2d * Rg * lift,
              B1[0] * Rg * lift, B1[1] * Rg * lift, B1[2] * Rg * lift);
      bp.push(A1[0] * Rg * lift, A1[1] * Rg * lift, A1[2] * Rg * lift,
              A3[0] / L2c * Rg * lift, A3[1] / L2c * Rg * lift, A3[2] / L2c * Rg * lift,
              B3[0] / L2d * Rg * lift, B3[1] / L2d * Rg * lift, B3[2] / L2d * Rg * lift);
    }
  }
  if (bp.length) {
    var bg2 = new THREE.BufferGeometry();
    bg2.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg2.computeVertexNormals();
    var bm = new THREE.Mesh(bg2, new THREE.MeshBasicMaterial({ color: 0x9a9a98, side: THREE.DoubleSide }));
    bm.userData.i = -1;   /* not pickable: pick3D skips i < 0 */
    group.add(bm);
  }
  /* one entry per (layer, LOD level). Measured per-entry size: 110m lvl 3 = 378 k
     triangles, 50m lvl 3-6 = 0.88-1.0 M, and a THREE BufferGeometry costs 24 B
     per vertex (position + normal) so a 50m entry is ~72 MB of GPU buffers.
     Keeping every level of both layers would be ~600 MB, so this is an LRU of
     2: the level in view and the one the zoom is about to cross. Evicted groups
     are disposed, not just dropped - a dropped BufferGeometry keeps its
     attributes alive on the GPU. */
  var ck2 = null, old = -1;
  for (var k2 in globeCache) {
    var en = globeCache[k2];
    if (en.used > old) { old = en.used; ck2 = k2; }
  }
  if (ck2 !== null && Object.keys(globeCache).length >= 2 && ck2 !== ck) {
    var ev = globeCache[ck2];
    for (var c2 = 0; c2 < ev.group.children.length; c2++) {
      var o2 = ev.group.children[c2];
      if (o2.geometry) o2.geometry.dispose();
      if (o2.material) o2.material.dispose();
    }
    scene3.remove(ev.group);   /* Object3D.remove() with no args is a no-op: it
       iterates its arguments. Leaving the evicted group in the scene would draw
       it again under the new one (double geometry, z-fighting) */
    delete globeCache[ck2];
  }
  globeCache[ck] = { group: group, used: ++globeClock, lvl: lvl, ms: Date.now() - t0 };
  globeGroup = group;
  scene3.add(group);
}

function setGlobeLayer(id) {
  if (globeGroup) scene3.remove(globeGroup);
  var c = globeCache[id + ':' + globeLevel()];
  if (c) { c.used = ++globeClock; globeGroup = c.group; scene3.add(globeGroup); }
  else { layerName = id; buildGlobe(); }
}

function placeCamera() {
  /* setMode() can run before resize(), so the aspect from the constructor may
     be 0/0 = NaN, which makes the whole frustum NaN and culls every mesh */
  cam3.aspect = W / H;
  cam3.updateProjectionMatrix();
  var la = globe.lon * C.DEG, ph = globe.lat * C.DEG, cp = Math.cos(ph);
  cam3.position.set(cp * Math.cos(la) * globe.dist,
                    Math.sin(ph) * globe.dist,
                    -cp * Math.sin(la) * globe.dist);   /* stays on sphToVec(lon,lat): the camera faces exactly that point */
  cam3.lookAt(0, 0, 0);
}

function draw3D() {
  if (!renderer3) return;
  refreshGlobe();          /* the LOD level follows globe.dist: without this the
     globe draws the same level forever, which is the "no LOD when zooming" bug */
  placeCamera();
  renderer3.render(scene3, cam3);   /* r170 reads camera.parent immediately: the 2nd arg is not optional */
  drawLabels3D(zoomLevel3D());
}

function zoomLevel3D() {
  /* dist 3.05 frames the whole globe, which we call z 2 - the same label
     scale the dataset was authored on */
  return 2 + Math.log2(3.05 / globe.dist) * 1.15;
}

/* labels are drawn on a transparent canvas above the WebGL one, so they stay
   crisp and unlit; the back of the globe is culled by a dot product */
function drawLabels3D(z) {
  if (!labelsCtx) return;
  labelsCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  labelsCtx.clearRect(0, 0, W, H);
  labelsCtx.font = '11px system-ui, -apple-system, sans-serif';
  labelsCtx.textAlign = 'center'; labelsCtx.textBaseline = 'middle';
  var camPos = cam3.position, len = Math.hypot(camPos.x, camPos.y, camPos.z);
  var placed = [], shown = 0;
  for (var i = 0; i < layout.length; i++) {
    var L = layout[i];
    if (z < L.minz - 0.2 || z > L.maxz + 0.6) continue;
    var v = sphToVec(L.lonDeg, L.latDeg);
    if ((v[0] * camPos.x + v[1] * camPos.y + v[2] * camPos.z) / len < Rg * 0.16) continue;
    var sp = new THREE.Vector3(v[0], v[1], v[2]);
    sp.project(cam3);
    var px = (sp.x * 0.5 + 0.5) * W, py = (0.5 - sp.y * 0.5) * H;
    if (px < 24 || py < 12 || px > W - 24 || py > H - 12) continue;
    var w = labelsCtx.measureText(L.name).width + 8, h = 15;
    var box = [px - w / 2, py - h / 2, px + w / 2, py + h / 2];
    var ok = true;
    for (var q = 0; q < placed.length && ok; q++) {
      var b = placed[q];
      if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) ok = false;
    }
    if (!ok) continue;
    placed.push(box);
    labelsCtx.lineWidth = 3; labelsCtx.strokeStyle = 'rgba(12,22,32,.75)'; labelsCtx.strokeText(L.name, px, py);
    labelsCtx.fillStyle = 'rgba(255,255,255,.92)'; labelsCtx.fillText(L.name, px, py);
    if (++shown > 70) break;
  }
}

/* picking in 3D: three.js ray against the land crust, smallest feature wins
   where several stack (islands over the country behind them) */
function pick3D(px, py) {
  if (!rayc || !globeGroup) return -1;
  /* r170 dropped the legacy setCoords: go through setFromCamera with NDC
     (-1..1, not the -0.5..0.5 the old call passed) */
  if (!ndc) ndc = new THREE.Vector2(0, 0);
  ndc.set(px / W * 2 - 1, 1 - py / H * 2);
  rayc.setFromCamera(ndc, cam3);
  var hits = rayc.intersectObjects(globeGroup.children, false);
  var best = -1, bestA = 0;
  for (var h = 0; h < hits.length; h++) {
    var jh = hits[h].object.userData.i;
    if (jh < 0) continue;                      /* the border strip is not pickable */
    if (best < 0 || feats[jh].areaSr < bestA) { bestA = feats[jh].areaSr; best = jh; }
  }
  return best;
}

function highlight3D() {
  if (!globeGroup) return;
  var kids = globeGroup.children;
  for (var i = 0; i < kids.length; i++) {
    var o = kids[i], j = o.userData.i;
    if (j < 0) continue;   /* the border strip keeps its own colour */
    var col = (j === gPicked) ? 0xffffff : (j === gHover) ? 0xedf0e9 : 0xc9c9c7;
    o.material.color.setHex(col);
  }
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  if (m === '3d') {
    if (!renderer3) init3D();
    if (!scene3) newScene();
    buildGlobe();
    canvas.style.display = 'none';
    labelsCv.style.display = '';   /* setMode('2d') hid it inline; a later switch back would keep it hidden */
  } else {
    if (renderer3) renderer3.domElement.style.display = 'none';
    canvas.style.display = 'block';
    labelsCv.style.display = 'none';
    /* the 2D view's geometry is centred on view.lon/lat and is rebuilt on the
       centre; coming back from the globe, the pieces may be stale (a rebuild
       was skipped while in 3D), so refresh them */
    reproject();
  }
  refreshMenu();
  refreshUI();
}

function refreshMenu() {
  var rows = itemsEl.getElementsByClassName('menuitem');
  for (var i = 0; i < rows.length; i++) {
    var el = rows[i], id = el.dataset.id;
    var on = (id === '2d' && mode === '2d') ||
             (id === '3d' && mode === '3d') ||
             (mode === '2d' && id === 'proj:' + projID) ||
             (id === 'layer:' + layerName);
    if (on) el.classList.add('on'); else el.classList.remove('on');
  }
  /* the projection rows cannot apply in 3D: dim that section instead of hiding
     it, so the sheet keeps the same height and the eye keeps its place */
  var grps = itemsEl.getElementsByClassName('mgroup');
  for (var q = 0; q < grps.length; q++) {
    if (grps[q].classList.contains('needs2d')) {
      if (mode === '3d') grps[q].classList.add('dim'); else grps[q].classList.remove('dim');
    }
  }
  refreshBurger();
}

function refreshGlobe() {
  /* the level in view may have moved (zoom, or a resize that changes H): swap
     the group for the one keyed to the current level. Cheap when nothing moved,
     because the entry is already cached. */
  if (!globeGroup) { buildGlobe(); return; }
  var lvl = globeLevel();
  var c = globeCache[layerName + ':' + lvl];
  if (c && c.group === globeGroup) return;
  scene3.remove(globeGroup);
  if (c) { c.used = ++globeClock; globeGroup = c.group; }
  else { globeGroup = null; buildGlobe(); return; }
  scene3.add(globeGroup);
}

/* ---------- info panel ---------- */
function refreshUI() {
  var idx = picked >= 0 ? picked : hover;
  var f = idx >= 0 ? feats[idx] : null;
  if (!f) {
    panel.classList.remove('show');
    hud.textContent = hudText();
    return;
  }
  var p = f.props, km2 = f.areaSr * C.SR_TO_KM2;
  var alt = [];
  var alts = [p.NAME_FR, p.NAME_DE, p.NAME_ES, p.NAME_IT, p.NAME_RU, p.NAME_ZH];
  for (var i = 0; i < alts.length; i++) if (alts[i]) alt.push(alts[i]);
  var rows = [
    ['name', p.NAME_LONG || p.NAME],
    ['also', alt.join('  ·  ')],
    ['type', p.TYPE + (p.SOVEREIGNT && p.SOVEREIGNT !== (p.NAME_LONG || p.NAME) ? ' · sovereign: ' + p.SOVEREIGNT : '')],
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
    s += '<div class="row"><span class="k">' + rows[k2][0] + '</span><span class="v">' + val + '</span></div>';
  }
  panel.innerHTML = s;
  panel.classList.add('show');
  hud.textContent = hudText();
}
function hudText() {
  var nm = layerLabel(layerName);
  if (mode === '3d') {
    var main = 'Globe 3D · ' + nm + ' · z ' + zoomLevel3D().toFixed(1) +
           ' · lon ' + globe.lon.toFixed(1) + '°, lat ' + globe.lat.toFixed(1) + '°';
    /* the readout goes on a line of its own: .hud is white-space:pre and pinned
       bottom-left, and the .help line is pinned bottom-RIGHT and long, so a
       debug segment appended to the same line is drawn over the help text
       (measured: both collided from x 380 on a 1280 px viewport) */
    if (!dbg()) return main;
    return 'lod ' + globeLevel() + ' · tri ' + renderer3.info.render.triangles +
           ' kids ' + (globeGroup ? globeGroup.children.length : 0) + '\n' + main;
  }
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
                (skippedPieces ? ' (+' + fmtNum(skippedPieces) + ' sub-pixel)' : '');
  if (!dbg()) return segLine + '\n' + main;
  return segLine + ' · reproject ' + lastMs.toFixed(1) + ' ms (rings ' + reprojSplit.rings.toFixed(1) +
         ' + ' + reprojSplit.rest.toFixed(1) + ') · path ' + drawMs.path.toFixed(1) +
         ' ms · paint ' + drawMs.paint.toFixed(1) + ' ms\n' + main;
}
function pieceCount() {
  var n = 0;
  for (var i = 0; i < feats.length; i++) {
    for (var r = 0; r < feats[i].rings.length; r++) {
      n += feats[i].rings[r].pieces ? feats[i].rings[r].pieces.length : 0;
    }
  }
  return n;
}
function helpText() {
  /* two lengths: the full hint needs room the narrow layouts do not have, and it
     is the HUD (left) that must stay readable */
  if (W < 1150) {
    return '\u2630 view \u00b7 wheel = zoom \u00b7 drag = move the centre \u00b7 dbl-click = go + zoom';
  }
  return '\u2630 view \u00b7 wheel = zoom \u00b7 drag / shift+wheel = move the centre of projection \u00b7 dbl-click = go + zoom \u00b7 r reset';
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
  if (renderer3) renderer3.setSize(W, H);   /* the GL canvas is not the #map one, it needs its own resize */
}

var drag = null;
var touch = null;

/* ---------- interaction (shared by both views) ----------
   Pointer events are bound to the stage div so the same handlers drive the
   2D canvas and the WebGL canvas underneath the label overlay. */
function bindPointer(el) {
  el.addEventListener('mousedown', function (e) {
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
    if (gHover !== -1) { gHover = -1; highlight3D(); refreshUI(); }
  });
  el.addEventListener('click', function (e) { doPick(e.offsetX, e.offsetY); });
  el.addEventListener('dblclick', function (e) {
    doPick(e.offsetX, e.offsetY);
    if (mode === '3d') { zoomGlobe(1.6); refreshUI(); return; }
    /* one gesture for "take me there": the clicked point becomes the centre of
       projection AND the view zooms in */
    var g = geoAt(e.offsetX, e.offsetY);
    if (g) setCenter(g[0], g[1]);
    zoomBy(2);
    refreshUI();
  });
  el.addEventListener('wheel', function (e) {
    e.preventDefault();
    stopInertia();               /* a wheel step takes over from any glide */
    var f = zoomFactor(e.deltaY);
    if (mode === '3d') { zoomGlobe(f); return; }
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
  if (mode === '3d') {
    globe.lon -= dx * 0.28;
    globe.lat += dy * 0.28;
    globe.lat = Math.max(-89.5, Math.min(89.5, globe.lat));
    return;
  }
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

function zoomGlobe(f) {
  globe.dist = Math.max(1.12, Math.min(9, globe.dist * f));
  highlight3D();
  refreshUI();
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

var keys = {};
window.addEventListener('keydown', function (e) {
  keys[e.key] = true;
  stopInertia();
  if (e.key === 'Enter') { picked = (mode === '3d') ? gHover : hover; if (mode === '3d') gPicked = gHover; refreshUI(); }
  if (e.key === 'r' || e.key === 'R') {
    if (mode === '3d') { globe.lon = 0; globe.lat = 0; globe.dist = 3.05; }
    else { setCenterFresh(0, 0); fitView(worldBounds()); }
    refreshUI();
  }
  if (e.key === 'm' || e.key === 'M') { setMode(mode === '3d' ? '2d' : '3d'); closeMenu(); }
  if (e.key === 'Escape') { if (menuOpen()) { closeMenu(); } else { picked = -1; gPicked = -1; highlight3D(); refreshUI(); } }
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
  if (zf !== 1) {
    if (mode === '3d') zoomGlobe(zf);
    else zoomBy(zf);
  }
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
    if (mode === '3d') zoomGlobe(f); else zoomBy(f);
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
        lastTap.t = 0;
        if (mode === '3d') { zoomGlobe(1.7); }
        else {
          var g = geoAt(x, y);
          if (g) setCenter(g[0], g[1]);
          zoomBy(1.7);
        }
        picked = -1; hover = -1;
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
  keyStep();
  draw();
  requestAnimationFrame(loop);
}
window.addEventListener('resize', function () {
  resize();
  helpEl.textContent = helpText();      /* the hint has a narrow-screen variant */
  hudShown = null;                      /* the HUD wraps differently now */
});

})();
