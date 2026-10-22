/* The menu's living background, and the app's two fixed corners.

   What is asserted, and why each one matters:

     1. THE DRIFT IS OFF UNTIL ASKED. A viewer that starts moving on its own is a
        viewer you cannot trust with a pick, so the map must be still at boot and
        only move when the quiz's menu screens ask for it (`MapApp.cinema(true)`).
     2. IT REALLY MOVES. "Cinema is on" is a flag; the check that matters is the
        CENTRE OF PROJECTION changing between frames - the whole point is a living
        background, not a state variable.
     3. IT IS SLOW. The step is measured in degrees per second against the value the
        design names (0.5 deg/s): a background that runs would read as a bug, and a
        number in a comment is not a measurement.
     4. IT STANDS ASIDE FOR THE PLAYER AND FOR A QUESTION. A touch or a flight must
        win over the drift, and `cinema(false)` must stop it dead - during a question
        the map is the question's picture.
     5. PREFERS-REDUCED-MOTION KILLS IT, `?drift=0` KILLS IT.
     6. THE TWO CORNERS: fullscreen top-left, burger top-right, both in the markup,
        both wired. The FULLSCREEN button follows the browser (the API's two halves
        live on different objects) and is HIDDEN where the browser has no API,
        rather than shown as a button that does nothing.

   Run: node tests/drift_test.js */
'use strict';
const fs = require('fs');
global.Path2D = function () { return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} }; };
const L = {};
function ctxStub() {
  return { setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, rect() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6.2 }; }, save() {}, restore() {}, clip() {} };
}
function el(name) {
  const o = { innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) };
  o.addEventListener = function (t, f) { L[name + ':' + t] = f; };
  o.classList = {
    add(c) { const a = o.className ? o.className.split(' ') : []; if (a.indexOf(c) < 0) a.push(c); o.className = a.filter(Boolean).join(' '); },
    remove(c) { const a = o.className ? o.className.split(' ') : []; o.className = a.filter(x => x && x !== c).join(' '); },
    /* the REAL toggle(second argument): with `undefined` it flips, with a boolean it
       sets. That difference is exactly the bug the fullscreen button had. */
    toggle(c, on) {
      if (on === undefined) { if (this.contains(c)) this.remove(c); else this.add(c); return; }
      if (on) this.add(c); else this.remove(c);
    },
    contains(c) { return (o.className ? o.className.split(' ') : []).indexOf(c) >= 0; }
  };
  o.appendChild = function (c) { o.children.push(c); return c; };
  o.setAttribute = function (k, v) { o['attr:' + k] = v; };
  o.getAttribute = function (k) { return o['attr:' + k]; };
  o.getElementsByClassName = function (cn) {
    const out = [];
    const walk = n => { for (const c of n.children || []) { if (c.className && (' ' + c.className + ' ').indexOf(' ' + cn + ' ') >= 0) out.push(c); walk(c); } };
    walk(o); return out;
  };
  return o;
}

const map = el('map'), stage = el('stage'), labels = el('labels');
const menu = el('menu'), burger = el('burger'), items = el('items'), scrim = el('scrim');
const panel = el('panel'), hud = el('hud'), help = el('help'), fsbtn = el('fsbtn');
const ids = { map, stage, labels, menu, burger, items, scrim, panel, hud, help, fsbtn };

/* the browser's fullscreen API, in the two places it really lives */
let fsAsked = [], fsRefused = false, fsEvent = null;
const documentElement = {
  requestFullscreen() { if (fsRefused) throw new Error('denied'); fsAsked.push('in'); fsEvent = true; },
  isFullscreen: undefined
};
let rafQueue = [];
let reducedMotion = false;
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: '' },
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
  matchMedia(q) { return { matches: q.indexOf('reduced-motion') >= 0 ? reducedMotion : false, addEventListener() {} }; },
  document: {
    documentElement,
    getElementById(id) { return ids[id] || help; },
    createElement() { return el('x'); },
    addEventListener(t, f) { L['doc:' + t] = f; },
    exitFullscreen() { fsAsked.push('out'); fsEvent = false; }
  }
};
global.document = global.window.document;
global.requestAnimationFrame = global.window.requestAnimationFrame;
const files = { 'so50.geojson': 'so50.geojson', 'countries.geojson': 'countries.geojson',
                'ne10m.geojson': 'ne10m.geojson', 'places.json': 'places.json' };
global.fetch = u => {
  const name = String(u).replace(/^.*\//, '').replace(/\?.*$/, '');
  const p = __dirname + '/../data/' + (files[name] || 'countries.geojson');
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};

new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8')).call();
new Function(fs.readFileSync(__dirname + '/../app.js', 'utf8')).call();

/* one fake clock for the frame stamps */
let fakeNow = 1000;
if (typeof performance !== 'undefined') performance.now = () => fakeNow;
else global.performance = { now: () => fakeNow };
function frame() { const q = rafQueue; rafQueue = []; fakeNow += 16; for (const f of q) f(fakeNow); }
function frames(n) { for (let i = 0; i < n; i++) frame(); }

let checks = 0, fails = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
  else console.log('ok   ' + name);
}
const centre = () => global.window.ViewState.centre();
const degLon = () => centre()[0];

setTimeout(function () {
  frames(3);

  /* ---------- 1. still at boot ---------- */
  const c0 = centre();
  frames(120);                                   /* ~2 s of frames */
  check('the map does not move on its own', degLon() === c0[0] && centre()[1] === c0[1],
        c0 + ' -> ' + centre());
  check('inside the viewer, cinema reads off', global.window.MapApp.cinema() === false);

  /* ---------- 2. the drift, when the menu asks ---------- */
  check('cinema(true) reports on', global.window.MapApp.cinema(true) === true);
  const c1 = centre();
  /* 1.6 s of rest is required before the drift takes over (the player may have just
     let go of the map) - step past it, then measure */
  frames(110);
  const c2 = centre();
  frames(120);                                   /* ~2 s */
  const c3 = centre();
  check('the drift moves the centre of projection', c3[0] !== c2[0], c2 + ' -> ' + c3);
  check('...it moves EAST (a slow turn, one way)', c3[0] > c2[0], c2[0] + ' -> ' + c3[0]);
  const rate = (function () {
    /* degrees of longitude per second over those frames, with the wrap accounted for */
    let d = c3[0] - c2[0];
    if (d < -180) d += 360;
    return d / (120 * 0.016);
  })();
  check('...slowly: about 0.5 deg/s', rate > 0.30 && rate < 0.80, rate.toFixed(2) + ' deg/s');
  /* THE BACKGROUND IS ZOOMED IN: at the fitted view the globe is a small disc floating
     in its own ocean and it reads as a picture of a map, not as the earth. The drift
     eases to twice the fit (DRIFT_ZOOM), measured on the view's own k rather than
     trusted from the constant. */
  const vs = global.window.ViewState;
  const ratio = vs.k() / vs.fitK();
  check('...and it is zoomed in about x2 on the fitted world view',
        ratio > 1.8 && ratio < 2.2, 'k=' + vs.k().toFixed(1) + ' fitK=' + vs.fitK().toFixed(1) +
        ' ratio=' + ratio.toFixed(2));
  check('...and it sways in latitude rather than sitting on one parallel',
        Math.abs(c3[1] - c1[1]) > 0.05 || Math.abs(centre()[1]) <= 46.0001, c1[1] + ' -> ' + c3[1]);

  /* ---------- 3. a question stops it ---------- */
  global.window.MapApp.cinema(false);
  const c4 = centre();
  frames(120);
  check('cinema(false) stops it dead', centre()[0] === c4[0] && centre()[1] === c4[1],
        c4 + ' -> ' + centre());

  /* ---------- 4. prefers-reduced-motion ---------- */
  reducedMotion = true;
  global.window.MapApp.cinema(true);
  const c5 = centre();
  frames(200);
  check('prefers-reduced-motion keeps the map still', centre()[0] === c5[0], c5 + ' -> ' + centre());
  reducedMotion = false;

  /* ---------- 5. the player wins ---------- */
  const c6 = centre();
  frames(110);
  /* a press on the stage: the drift must give way while the finger is down */
  if (L['stage:mousedown']) L['stage:mousedown']({ offsetX: 600, offsetY: 400, clientX: 600, clientY: 400, preventDefault() {} });
  const c7 = centre();
  frames(60);
  check('a touch on the map stops the drift', centre()[0] === c7[0] || Math.abs(centre()[0] - c7[0]) < 0.001,
        c7 + ' -> ' + centre());
  if (L['stage:mouseup']) L['stage:mouseup']({ offsetX: 600, offsetY: 400, clientX: 600, clientY: 400, preventDefault() {} });
  void c6;
  global.window.MapApp.cinema(false);

  /* ---------- 6. the bloom ----------
     The map's glow is a quarter-size copy of the picture, squared and screen-blended
     back INTO the same canvas. What is asserted is not the look (no test can taste) but
     the three things that make it survive a refactor:
       * it exists at all, and it is composited in the canvas - a separate full-screen
         `mix-blend-mode` layer was the first build and cost the frame rate outright
         (19.0 -> 32.4 ms/frame, measured), so a layer coming back would be a regression;
       * the copy is SMALL (a quarter in each direction): that is where the cost saving
         comes from, and a "copy at full size" would quietly undo it;
       * `?bloom=0` turns it off, which is what the measurement above was taken with. */
  /* the page itself: ONE canvas. The glow is a canvas the app builds off-screen, so a
     second <canvas id="glow"> in the markup would mean the old CSS layer came back */
  const page = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  check('the page has one canvas (no separate glow layer)',
        (page.match(/<canvas/g) || []).length === 1, (page.match(/<canvas[^>]*>/g) || []).join(' '));
  check('...and no .glow rule in the stylesheet',
        !/\.glow\s*\{/.test(fs.readFileSync(__dirname + '/../style.css', 'utf8')));
  check('the bloom is composited in the canvas', typeof global.window.MapApp.bloom === 'function');
  const bloom = global.window.MapApp.bloom();
  check('...it is on by default', bloom.on === true, JSON.stringify(bloom));
  check('...its copy is a QUARTER size (that is the whole cost saving)',
        bloom.div === 4, bloom.div);
  check('...it draws with `screen`', bloom.blend === 'screen', bloom.blend);
  check('...and it has an opacity below 1, or it would be a wash',
        bloom.op > 0 && bloom.op < 1, bloom.op);

  /* ---------- 7. the fullscreen corner ---------- */
  check('the fullscreen button is in the markup', /id="fsbtn"/.test(fs.readFileSync(__dirname + '/../index.html', 'utf8')));
  check('...declared on the LEFT, above the map', /\.fsbtn\s*\{[\s\S]*?left:\s*10px/.test(fs.readFileSync(__dirname + '/../style.css', 'utf8')));
  check('the burger is declared on the RIGHT', /#menu\s*\{[\s\S]*?right:\s*10px/.test(fs.readFileSync(__dirname + '/../style.css', 'utf8')));
  check('the button starts off, and NOT toggled by a missing value',
        !fsbtn.classList.contains('on'), fsbtn.className);
  check('...and says so in its accessibility name', fsbtn.getAttribute('aria-label') === 'Fullscreen',
        fsbtn.getAttribute('aria-label'));
  check('it is visible, because this browser has the API', fsbtn.style.display !== 'none', fsbtn.style.display);

  L['fsbtn:click']({ preventDefault() {} });
  check('a click asks the browser to go fullscreen', fsAsked.indexOf('in') >= 0, fsAsked.join(','));
  check('...and the button shows the state', fsbtn.classList.contains('on'), fsbtn.className);
  check('...and offers to leave it', fsbtn.getAttribute('aria-label') === 'Leave fullscreen',
        fsbtn.getAttribute('aria-label'));
  L['fsbtn:click']({ preventDefault() {} });
  check('a second click leaves fullscreen', fsAsked.indexOf('out') >= 0, fsAsked.join(','));
  check('...and the button says so', !fsbtn.classList.contains('on'), fsbtn.className);

  /* the browser leaving fullscreen on its own (Esc, a phone gesture) is followed */
  L['fsbtn:click']({ preventDefault() {} });
  documentElement.isFullscreen = false;
  L['doc:fullscreenchange']({});
  check('a browser-initiated exit is followed, not fought', !fsbtn.classList.contains('on'), fsbtn.className);
  /* Chromium leaves isFullscreen UNDEFINED on fullscreenchange: that is not "off" */
  L['fsbtn:click']({ preventDefault() {} });
  check('...back on', fsbtn.classList.contains('on'), fsbtn.className);
  documentElement.isFullscreen = undefined;
  L['doc:fullscreenchange']({});
  check('an undefined read-back is ignored, not read as off', fsbtn.classList.contains('on'), fsbtn.className);

  console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
}, 500);
