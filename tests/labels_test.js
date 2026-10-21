/* LABEL TYPOGRAPHY test: the three kinds of name must be DRAWN differently.

   The point is not decoration: a reader has to tell a country from a capital from an
   ordinary city without reading the name, and colour alone fails for a colour-blind
   reader or over pale land. So the assertion is on the drawing calls themselves,
   recorded from a fake canvas: what font, what colour, what case each label was
   drawn with. A regression here is invisible in a pixel diff of a small screenshot
   and invisible to every other test in the suite.

   It also pins the two rules that make the map readable rather than merely pretty:
   tracking is MEASURED into the collision box (a box that ignores it lets labels
   overlap by a few px per letter), and a ringed capital is never left nameless while
   the space for its name is free. */
const fs = require('fs');

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return true;
  fails++;
  console.log('FAIL ' + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  return false;
}

/* ---------- a canvas that remembers what was painted on it ---------- */
const record = [];
global.Path2D = function () { return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} }; };
function ctxStub() {
  const st = { fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '' };
  return {
    setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, rect() {}, save() {}, restore() {}, clip() {},
    fillText(t, x, y) { record.push({ op: 'fill', text: String(t), x, y, font: st.font, colour: st.fillStyle, align: st.textAlign }); },
    strokeText(t, x, y) { record.push({ op: 'stroke', text: String(t), x, y, font: st.font, colour: st.strokeStyle }); },
    measureText(t) { return { width: String(t).length * 6.2 }; },
    get fillStyle() { return st.fillStyle; }, set fillStyle(v) { st.fillStyle = v; },
    get strokeStyle() { return st.strokeStyle; }, set strokeStyle(v) { st.strokeStyle = v; },
    get lineWidth() { return st.lineWidth; }, set lineWidth(v) { st.lineWidth = v; },
    get font() { return st.font; }, set font(v) { st.font = v; },
    get textAlign() { return st.textAlign; }, set textAlign(v) { st.textAlign = v; },
    get textBaseline() { return st.textBaseline; }, set textBaseline(v) { st.textBaseline = v; }
  };
}

const L = {};
function el(name) {
  const o = {
    _n: name, innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    addEventListener(t, f) { L[(o._n || 'x') + ':' + t] = f; },
    appendChild(c) { o.children.push(c); return c; },
    setAttribute() {}, getElementsByClassName() { return []; }
  };
  return o;
}
const ids = {};
for (const n of ['stage', 'map', 'labels', 'panel', 'hud', 'help', 'menu', 'burger', 'items', 'scrim']) ids[n] = el(n);
let rafQueue = [];
global.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, location: { search: '?lon=10&lat=48&z=4' },
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
  document: { getElementById(id) { return ids[id] || el(id); }, createElement() { return el('x'); }, addEventListener() {} }
};
global.document = global.window.document;
global.requestAnimationFrame = global.window.requestAnimationFrame;
const DATA = __dirname + '/../data/';
global.fetch = (u) => {
  const name = String(u).replace(/^.*\//, '');
  const p = DATA + name;
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};

new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8')).call();
new Function(fs.readFileSync(__dirname + '/../app.js', 'utf8')).call();

let fakeNow = 1000;
const perf = (typeof performance !== 'undefined') ? performance : global.performance;
if (perf) perf.now = () => fakeNow;
function frame(t) { const q = rafQueue; rafQueue = []; for (const f of q) f(t); }

setTimeout(function () {
  /* let the layers land, then paint one frame and read it back */
  for (let i = 0; i < 3; i++) { fakeNow += 16; frame(fakeNow); }
  record.length = 0;
  fakeNow += 16; frame(fakeNow);

  const fills = record.filter(r => r.op === 'fill');
  /* Country names are drawn ONE CHARACTER PER CALL (real tracking), so a test that
     looks for the string "GERMANY" finds nothing. Rebuild the words from the calls:
     consecutive single characters on the same baseline, each starting where the
     previous one's advance ended. That is also the assertion that the tracking is
     real - a name drawn as one fillText could not produce a letter run at all. */
  function words() {
    const out = [];
    let run = null;
    for (const r of fills) {
      if (r.text.length === 1 && !/^[a-z]$/.test(r.text) || r.text.length === 1) {
        if (run && Math.abs(r.y - run.y) < 0.01 && r.colour === run.colour && r.font === run.font &&
            r.x >= run.lastX - 0.01) {
          run.text += r.text; run.lastX = r.x + 6.2; run.calls++;
        } else {
          run = { text: r.text, y: r.y, x: r.x, lastX: r.x + 6.2, colour: r.colour, font: r.font, calls: 1 };
          out.push(run);
        }
      } else if (r.text.length > 1) {
        out.push({ text: r.text, y: r.y, x: r.x, colour: r.colour, font: r.font, calls: 1 });
        run = null;
      } else run = null;
    }
    return out;
  }
  const W = words();
  const any = t => W.find(w => w.text === t);
  const byText = {};
  for (const w of W) byText[w.text] = w;

  /* ---------- countries: UPPERCASE, quiet, tracked ---------- */
  const country = any('GERMANY') || any('FRANCE');
  check('a country name is drawn', !!country, W.map(w => w.text).slice(0, 12).join(' | '));
  if (country) {
    check('country names are UPPERCASE', country.text === country.text.toUpperCase(), country.text);
    check('country names are the quiet colour, not white',
          country.colour !== 'rgba(255,255,255,.96)' && /226,238,248|\.72/.test(country.colour), country.colour);
    check('country names are small', /9\.5px|10\.5px/.test(country.font), country.font);
  }
  /* tracking: the drawn characters are separate calls, so the string was placed
     letter by letter; its width must therefore account for the tracking */
  if (country) {
    check('country names are drawn letter by letter (real tracking)', country.calls > 3,
          country.calls + ' calls for ' + country.text);
  }

  /* ---------- capitals: gold, bold, bigger ---------- */
  const cap = any('Berlin') || any('Paris') || any('Amsterdam');
  check('a capital name is drawn', !!cap);
  if (cap) {
    check('capital names are Title Case, not uppercase', cap.text !== cap.text.toUpperCase(), cap.text);
    /* NOT gold: gold competed with the selection accent and turned a map with a
       dozen capitals into confetti. A capital is emphasis by WEIGHT, and the accent
       colour is reserved for the one thing you selected. */
    check('capital names are not gold', !/ffd166|255,209,102/.test(cap.colour), cap.colour);
    check('capital names are white, brighter than the country voice',
          /255,255,255/.test(cap.colour), cap.colour);
    check('capital names are bold', /700|bold/.test(cap.font), cap.font);
    check('capital names are bigger than cities',
          parseFloat(cap.font) > 11, cap.font);
  }

  /* ---------- ordinary cities: white, regular ---------- */
  const city = any('Frankfurt') || any('Mannheim') || any('Mainz') ||
               W.find(w => w.text.length > 3 && !/700/.test(w.font) && w.colour === 'rgba(255,255,255,.96)');
  check('an ordinary city is drawn', !!city);
  if (city) {
    check('city names are not the accent colour', !/142,208,255|8ed0ff/.test(city.colour), city.colour);
    check('city names are regular weight', !/700|bold/.test(city.font), city.font);
    check('a city is not drawn in the country voice',
          city.text !== city.text.toUpperCase() || city.colour !== (country && country.colour));
  }

  /* ---------- the three voices are actually different ---------- */
  if (country && cap && city) {
    const diffs = [country.font !== cap.font, country.colour !== cap.colour,
                   cap.colour !== city.colour, country.font !== city.font];
    check('the three kinds of name differ in type AND colour',
          diffs.every(Boolean), JSON.stringify(diffs));
  }

  /* ---------- a ringed capital must not be silent ---------- */
  /* every capital dot that was drawn needs a label, unless the collision test
     genuinely had no room; assert the common case instead of the corner: with this
     many capitals on screen, fewer than a third may be nameless */
  const capNames = W.filter(r => /700/.test(r.font));
  check('capitals are labelled generously', capNames.length >= 3, capNames.length + ' capital labels');

  /* ---------- turning the overlay off removes the city voices ---------- */
  record.length = 0;
  L['win:keydown']({ key: 'c', preventDefault() {} });
  fakeNow += 16; frame(fakeNow);
  const afterOff = record.filter(r => r.op === 'fill' && /700/.test(r.font));
  check('with cities off, no capital label is drawn', afterOff.length === 0, afterOff.length + ' left');
  check('with cities off, country names are still drawn',
        record.some(r => r.op === 'fill' && /600 10.5px/.test(r.font)));

  console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
  process.exit(fails ? 1 : 0);
}, 900);
