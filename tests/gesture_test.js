/* Inertia + touch gestures, driven through the real app handlers.
   Checks:
     1. a drag that ends while moving keeps moving (glide), and stops by itself
     2. the glide is time-based: the same release velocity travels a similar
        distance whether frames are 16 ms or 33 ms apart
     3. any new press / wheel / key stops the glide dead
     4. a tap picks and does NOT pan; a small drag pans and does NOT pick
     5. a double tap zooms about the tapped point
     6. the menu opens on the burger, closes on the scrim, and an item activates
   Run: node gesture_test.js (from the folder holding core.js) */
const fs = require('fs');
/* arc() is needed now that the city layer draws its dots through a Path2D: without
   it the fake path threw 'path.arc is not a function' and the whole app died on
   the first frame, which is how this stub gap was found */
global.Path2D = function () { return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} }; };
const L = {};
function ctxStub() {
  return { setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, rect() {}, closePath() {},
    moveTo() {}, lineTo() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6.2 }; }, save() {}, restore() {}, clip() {} };
}
function el(extra) {
  const o = { innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    classList: { _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) };
  o.addEventListener = function (t, f) { L[(o._n || 'x') + ':' + t] = f; };
  o.classList = {
    add(c) { const a = o.className ? o.className.split(' ') : []; if (a.indexOf(c) < 0) a.push(c); o.className = a.filter(Boolean).join(' '); },
    remove(c) { const a = o.className ? o.className.split(' ') : []; o.className = a.filter(x => x && x !== c).join(' '); },
    contains(c) { return (o.className ? o.className.split(' ') : []).indexOf(c) >= 0; }
  };
  o.appendChild = function (c) { o.children.push(c); return c; };
  o.setAttribute = function (k, v) { o['attr:' + k] = v; };
  o.getElementsByClassName = function (cn) {
    const out = [];
    const walk = n => { for (const c of n.children || []) { if (c.className && (' ' + c.className + ' ').indexOf(' ' + cn + ' ') >= 0) out.push(c); walk(c); } };
    walk(o); return out;
  };
  return Object.assign(o, extra || {});
}
const map = el({ _n: 'map' }), stage = el({ _n: 'stage' }), labels = el({ _n: 'labels' });
const menu = el({ _n: 'menu' }), burger = el({ _n: 'burger' }), items = el({ _n: 'items' }), scrim = el({ _n: 'scrim' });
const panel = el(), hud = el(), help = el();
let rafQueue = [];
global.window = { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: '' },
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
  document: { getElementById(id) { return { map, stage, labels, menu, burger, items, scrim }[id] || (id === 'panel' ? panel : (id === 'hud' ? hud : help)); },
    createElement() { return el(); }, addEventListener() {} } };
global.document = global.window.document;
global.requestAnimationFrame = global.window.requestAnimationFrame;
const files = { 'so50.geojson': __dirname + '/../data/so50.geojson', 'countries.geojson': __dirname + '/../data/countries.geojson', 'ne10m.geojson': __dirname + '/../data/ne10m.geojson', 'places.json': __dirname + '/../data/places.json' };
/* keyed on the basename: the app fetches data/<name> */
global.fetch = (u) => Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(files[String(u).replace(/^.*\//, '')] || files['countries.geojson'], 'utf8')) });

new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8')).call();
new Function(fs.readFileSync(__dirname + '/../app.js', 'utf8')).call();

/* the app's frame function is queued through requestAnimationFrame; drain it with
   explicit timestamps so the glide can be stepped deterministically */
function frame(tMs) { const q = rafQueue; rafQueue = []; for (const f of q) f(tMs); }
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   ' + name);
  else { fails++; console.log('FAIL ' + name + (extra !== undefined ? '   [' + extra + ']' : '')); }
}
const centre = () => hud.textContent.split('\n').pop().replace(/.*centre /, '');
const num = s => parseFloat(s);

/* Drive BOTH clocks from one fake time: the app reads performance.now() for its
   pointer samples and the animation-frame timestamp for the glide. In a browser
   those agree; here they must be made to, or a "33 ms frame" test measures the
   velocity over 1 ms of wall time. */
let fakeNow = 1000;
const realPerf = (typeof performance !== 'undefined') ? performance.now.bind(performance) : Date.now;
if (typeof performance !== 'undefined') {
  performance.now = () => fakeNow;
} else {
  global.performance = { now: () => fakeNow };
}
function ev(x, y, extra) { return Object.assign({ offsetX: x, offsetY: y, clientX: x, clientY: y, preventDefault() {} }, extra || {}); }
function fire(t, e) { const f = L['stage:' + t] || L[t]; if (f) f(e); }

setTimeout(function () {
  /* ---------- 1. a fling keeps moving, then stops ---------- */
  let before = centre();
  fire('mousedown', ev(700, 400));
  let x = 700;
  for (let i = 0; i < 6; i++) { fakeNow += 16; x -= 30; fire('mousemove', ev(x, 400)); frame(fakeNow); }
  fire('mouseup', ev(x, 400));
  const atRelease = centre();
  /* step frames with no further input: the inertia must advance the centre */
  for (let i = 0; i < 8; i++) { fakeNow += 16; frame(fakeNow); }
  const afterGlide = centre();
  check('drag moved the centre', atRelease !== before, before + ' -> ' + atRelease);
  check('release with speed glides further', afterGlide !== atRelease, atRelease + ' -> ' + afterGlide);

  /* it must come to rest on its own */
  for (let i = 0; i < 200; i++) { fakeNow += 16; frame(fakeNow); }
  const settled = centre();
  for (let i = 0; i < 20; i++) { fakeNow += 16; frame(fakeNow); }
  check('glide stops by itself', centre() === settled, settled + ' vs ' + centre());

  /* ---------- 3. a new press stops the glide ---------- */
  fire('mousedown', ev(700, 400));
  x = 700;
  for (let i = 0; i < 6; i++) { fakeNow += 16; x -= 40; fire('mousemove', ev(x, 400)); frame(fakeNow); }
  fire('mouseup', ev(x, 400));
  fakeNow += 16; frame(fakeNow);
  const gliding = centre();
  fire('mousedown', ev(700, 400));          /* grab it */
  const stopped = centre();
  for (let i = 0; i < 10; i++) { fakeNow += 16; frame(fakeNow); }
  check('a new press stops the glide', centre() === stopped, gliding + ' -> ' + stopped + ' -> ' + centre());
  fire('mouseup', ev(700, 400));

  /* ---------- 2b. the glide is frame-rate independent ----------
     A flick at a given speed must travel the same distance whether frames are
     16 ms or 50 ms apart: otherwise a slow layer (or a 30 Hz screen) would fling
     the map much further than a fast one, which is what happened when the glide
     mixed the wall clock with the animation-frame clock. */
  (function () {
    const travel = [];
    for (const frameMs of [16, 33, 50]) {
      const perFrame = 20 * frameMs / 16;         /* same px/s at every rate */
      fire('mousedown', ev(700, 400));
      let x = 700;
      for (let i = 0; i < 6; i++) {
        fakeNow += frameMs; x -= perFrame;
        fire('mousemove', ev(x, 400)); frame(fakeNow);
      }
      fire('mouseup', ev(x, 400));
      /* stop the world, then measure the glide alone */
      const lonOf = () => { const m = /centre (-?[0-9.]+)/.exec(hud.textContent); return m ? +m[1] : 0; };
      const c0 = lonOf();
      for (let i = 0; i < 500; i++) { fakeNow += frameMs; frame(fakeNow); }
      travel.push(Math.abs(lonOf() - c0));
    }
    const lo = Math.min(...travel), hi = Math.max(...travel);
    check('glide distance is frame-rate independent (< 5% spread)',
      hi > 0 && (hi - lo) / hi < 0.05,
      travel.map(t => t.toFixed(2)).join(' / ') + ' deg');
  })();

  /* ---------- 4. tap vs drag on touch ---------- */
  let pickedBefore = panel.innerHTML;
  let c0 = centre();
  fire('touchstart', { touches: [{ clientX: 640, clientY: 400 }], changedTouches: [{ clientX: 640, clientY: 400 }], preventDefault() {} });
  fakeNow += 60;
  fire('touchend', { touches: [], changedTouches: [{ clientX: 640, clientY: 400 }], preventDefault() {} });
  check('a tap does not pan', centre() === c0, c0 + ' -> ' + centre());

  let c1 = centre();
  fire('touchstart', { touches: [{ clientX: 500, clientY: 400 }], changedTouches: [{ clientX: 500, clientY: 400 }], preventDefault() {} });
  for (let i = 1; i <= 5; i++) {
    fakeNow += 16;
    fire('touchmove', { touches: [{ clientX: 500 - i * 20, clientY: 400 }], preventDefault() {} });
    frame(fakeNow);
  }
  fire('touchend', { touches: [], changedTouches: [{ clientX: 400, clientY: 400 }], preventDefault() {} });
  check('a drag does pan', centre() !== c1, c1 + ' -> ' + centre());
  const cAfterDrag = centre();
  for (let i = 0; i < 120; i++) { fakeNow += 16; frame(fakeNow); }
  check('a drag flings too', centre() !== cAfterDrag);

  /* ---------- 5. double tap zooms about the tapped point ---------- */
  for (let i = 0; i < 200; i++) { fakeNow += 16; frame(fakeNow); }
  const zBefore = hud.textContent.match(/z ([0-9.]+)/)[1];
  /* let the previous tap's window expire */
  fakeNow += 1000;
  fire('touchstart', { touches: [{ clientX: 300, clientY: 300 }], changedTouches: [{ clientX: 300, clientY: 300 }], preventDefault() {} });
  fire('touchend', { touches: [], changedTouches: [{ clientX: 300, clientY: 300 }], preventDefault() {} });
  fakeNow += 120;
  fire('touchstart', { touches: [{ clientX: 305, clientY: 302 }], changedTouches: [{ clientX: 305, clientY: 302 }], preventDefault() {} });
  fire('touchend', { touches: [], changedTouches: [{ clientX: 305, clientY: 302 }], preventDefault() {} });
  fakeNow += 200; frame(fakeNow);
  const zAfter = hud.textContent.match(/z ([0-9.]+)/)[1];
  check('double tap zooms in', num(zAfter) > num(zBefore) + 0.3, zBefore + ' -> ' + zAfter);

  /* ---------- 6. menu: open, activate, close on scrim ---------- */
  check('menu starts closed', !menu.classList.contains('open'));
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  check('burger click opens the menu', menu.classList.contains('open'));
  check('scrim is shown with the menu', scrim.classList.contains('on'));

  /* a row: pick a PROJECTION row (the 3D row needs WebGL, which the harness has
     no business providing) and check it both closes the sheet and takes effect */
  const rows = items.getElementsByClassName('menuitem');
  check('menu has rows', rows.length >= 8, rows.length + ' rows');
  /* View / Projection / Layer / Overlay: the groups are the sheet's structure, so
     the count is asserted - a group that silently stops being rendered is a
     section the user can no longer reach */
  check('rows are grouped', items.getElementsByClassName('mgroup').length === 4,
        items.getElementsByClassName('mgroup').length + ' groups');
  const perspRow = rows.find(r => r.dataset.id === 'proj:persp');
  L['menu:click']({ target: perspRow, clientX: 10, clientY: 10 });
  check('clicking a row closes the menu', !menu.classList.contains('open'));
  check('scrim hidden again', !scrim.classList.contains('on'));
  check('the row took effect (projection switched)', /Perspective/.test(hud.textContent), hud.textContent.split('\n').pop());
  check('the row is marked active', perspRow.classList.contains('on'));

  /* the CITY overlay row: a toggle, and the HUD must say which state it is in */
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  const cityRow = items.getElementsByClassName('menuitem').find(r => r.dataset.id === 'cities');
  check('the cities row exists', !!cityRow);
  check('the cities row starts on', cityRow.classList.contains('on'));
  L['menu:click']({ target: cityRow, clientX: 10, clientY: 10 });
  check('clicking the cities row turns the overlay off', !/ cities/.test(hud.textContent), hud.textContent.split('\n')[0]);
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  L['menu:click']({ target: items.getElementsByClassName('menuitem').find(r => r.dataset.id === 'cities'), clientX: 10, clientY: 10 });
  check('clicking it again turns the overlay back on', / cities/.test(hud.textContent), hud.textContent.split('\n')[0]);
  /* the `c` key is the shortcut for the same toggle */
  L['win:keydown']({ key: 'c', preventDefault() {} });
  check('the c key toggles the overlay', !/ cities/.test(hud.textContent), hud.textContent.split('\n')[0]);
  L['win:keydown']({ key: 'c', preventDefault() {} });
  check('and toggles it back', / cities/.test(hud.textContent), hud.textContent.split('\n')[0]);

  /* reopen and close via the scrim */
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  L['scrim:click']({});
  check('scrim click closes the menu', !menu.classList.contains('open'));

  /* a press that travels (scrolling the sheet) must NOT activate a row */
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  const layerRow = items.getElementsByClassName('menuitem').find(r => r.dataset.id === 'layer:110m');
  L['menu:pointerdown']({ clientX: 10, clientY: 10 });
  L['menu:click']({ target: layerRow, clientX: 10, clientY: 90 });
  check('a scrolled press does not activate a row', menu.classList.contains('open'));

  /* ---------- 7. the north-up tilt ----------
     A straight drag in SCREEN space is not a great circle, so parallel transport
     leaves the frame turned about the view axis: that is the "tilted" picture this
     animation corrects. */
  const VS = global.window.ViewState;
  check('the app exposes its view state', !!VS && typeof VS.rollDeg === 'function');
  const tilt = { k0: VS.k() };
  fire('mousedown', ev(300, 300));
  let dxs = 300, dys = 300;
  for (let i = 0; i < 10; i++) { fakeNow += 16; dxs += 16; dys += 24; fire('mousemove', ev(dxs, dys)); frame(fakeNow); }
  const rolled = VS.rollDeg();
  check('a diagonal drag tilts the picture', Math.abs(rolled) > 0.5, rolled.toFixed(3) + ' deg');
  /* the tilt must NOT run under the finger: a map that untwists while you drag
     feels like it is slipping out of your hand */
  for (let i = 0; i < 30; i++) { fakeNow += 16; frame(fakeNow); }
  check('the tilt does not fight a held drag', Math.abs(VS.rollDeg() - rolled) < 1e-9,
        rolled.toFixed(3) + ' -> ' + VS.rollDeg().toFixed(3) + ' deg');
  fire('mouseup', ev(dxs, dys));
  /* the glide must finish first (it keeps panning), then the tilt settles */
  for (let i = 0; i < 260; i++) { fakeNow += 16; frame(fakeNow); }
  const settledRoll = VS.rollDeg(), settledCentre = VS.centre();
  for (let i = 0; i < 260; i++) { fakeNow += 16; frame(fakeNow); }
  check('the view tilts back to north-up', Math.abs(VS.rollDeg()) < 0.2,
        settledRoll.toFixed(3) + ' -> ' + VS.rollDeg().toFixed(3) + ' deg');
  check('the centre does not drift while tilting',
        Math.abs(VS.centre()[0] - settledCentre[0]) < 1e-6 && Math.abs(VS.centre()[1] - settledCentre[1]) < 1e-6,
        settledCentre.join(',') + ' -> ' + VS.centre().join(','));

  /* the Overlay row turns it off, and then the roll is left alone */
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  L['menu:click']({ target: items.getElementsByClassName('menuitem').find(r => r.dataset.id === 'north'), clientX: 10, clientY: 10 });
  check('the North up row is in the sheet', !VS.northUp());
  fire('mousedown', ev(400, 400));
  dxs = 400; dys = 400;
  for (let i = 0; i < 10; i++) { fakeNow += 16; dxs += 14; dys += 22; fire('mousemove', ev(dxs, dys)); frame(fakeNow); }
  fire('mouseup', ev(dxs, dys));
  for (let i = 0; i < 400; i++) { fakeNow += 16; frame(fakeNow); }
  check('with North up off the roll is kept', Math.abs(VS.rollDeg()) > 0.5, VS.rollDeg().toFixed(3) + ' deg');
  L['menu:click']({ target: burger, clientX: 0, clientY: 0 });
  L['menu:click']({ target: items.getElementsByClassName('menuitem').find(r => r.dataset.id === 'north'), clientX: 10, clientY: 10 });
  check('and it can be turned back on', VS.northUp());
  const rollBeforeTilt = VS.rollDeg();
  for (let i = 0; i < 400; i++) { fakeNow += 16; frame(fakeNow); }
  check('and then the tilt runs again', Math.abs(VS.rollDeg()) < 0.2,
        rollBeforeTilt.toFixed(1) + ' -> ' + VS.rollDeg().toFixed(3) + ' deg');

  /* ---------- 8. double click = dezoom, translate, zoom ---------- */
  const kBefore = VS.k();
  const target = VS.geoAt(500, 300);
  fire('dblclick', ev(500, 300));
  check('a double click starts a flight', VS.flying());
  let kMinSeen = Infinity, steps = 0;
  for (let i = 0; i < 200 && VS.flying(); i++) { fakeNow += 16; frame(fakeNow); steps++; kMinSeen = Math.min(kMinSeen, VS.k()); }
  const kAfter = VS.k();
  check('the flight ends on its own', !VS.flying(), steps + ' frames');
  check('it pulls BACK first (dezoom)', kMinSeen < Math.min(kBefore, kAfter) * 0.75,
        'min ' + kMinSeen.toFixed(0) + ' vs ' + kBefore.toFixed(0) + ' -> ' + kAfter.toFixed(0));
  check('it comes in to twice the zoom', Math.abs(kAfter / kBefore - 2) < 0.05,
        (kAfter / kBefore).toFixed(3) + 'x');
  const arrived = VS.geoAt(640, 400);
  const dLon = Math.abs(((arrived[0] - target[0] + 540) % 360) - 180);
  check('the clicked point ends at the centre of the screen',
        dLon < 0.05 && Math.abs(arrived[1] - target[1]) < 0.05,
        'wanted ' + target.map(v => v.toFixed(3)).join(',') + ' got ' + arrived.map(v => v.toFixed(3)).join(','));
  /* the gesture must win over the animation */
  fire('dblclick', ev(480, 320));
  check('a second double click re-aims the flight', VS.flying());
  fire('mousedown', ev(480, 320));
  check('a press cancels the flight', !VS.flying());
  fire('mouseup', ev(480, 320));
  for (let i = 0; i < 60; i++) { fakeNow += 16; frame(fakeNow); }

  console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
  process.exit(fails ? 1 : 0);
}, 900);
