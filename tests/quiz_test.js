/* headless test of the whole game: app.js + quizcore.js + quiz.js in a fake DOM,
   the REAL data files, and the real screens. What it asserts:
     * the start page is the first page on load, with every choice on it;
     * the country list comes from the layer, with capitals and flags;
     * every country can be fitted to the viewport (the flag/France/Russia trap:
       a country that "fits" to the whole world is a question with no picture);
     * a session runs: six options, the map lit up, right/wrong scoring, the score
       screen, and the map handed back on quit.
   Node only, no browser: the canvas is a recorder, the screens are innerHTML. */
const fs = require('fs');

/* ---------- fake DOM (the same shape harness.js uses) ---------- */
global.Path2D = function () {
  return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} };
};
function makeCtx() {
  return {
    setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, rect() {}, closePath() {},
    moveTo() {}, lineTo() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 6.2 }; },
    save() {}, restore() {}, clip() {},
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    globalAlpha: 1
  };
}
const L = {};
function DivEl(name) {
  const el = {
    innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    addEventListener(t, f) { L[name + ':' + t] = f; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    removeChild() {}, appendChild(c) { el.children.push(c); return c; },
    setAttribute(k, v) { el['attr:' + k] = v; },
    getAttribute(k) { const v = el['attr:' + k]; return v == null ? null : v; },
    getElementsByClassName() { return []; }
  };
  el.classList = {
    add(c) { const a = el.className ? el.className.split(' ') : []; if (a.indexOf(c) < 0) a.push(c); el.className = a.filter(Boolean).join(' '); },
    remove(c) { el.className = (el.className || '').split(' ').filter(x => x && x !== c).join(' '); },
    contains(c) { return (el.className || '').split(' ').indexOf(c) >= 0; }
  };
  return el;
}
const canvasEl = {
  width: 0, height: 0, style: {},
  getContext() { return makeCtx(); },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1440, height: 900 }; },
  addEventListener(t, f) { L['canvas:' + t] = f; }
};
const stageEl = {
  addEventListener(t, f) { L['stage:' + t] = f; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1440, height: 900 }; }
};
const els = {
  map: canvasEl, stage: stageEl,
  panel: DivEl('panel'), hud: DivEl('hud'), help: DivEl('help'),
  menu: DivEl('menu'), burger: DivEl('burger'), items: DivEl('items'), scrim: DivEl('scrim'),
  spot: DivEl('spot'), quiz: DivEl('quiz')
};
const bodyEl = DivEl('body');
const store = {};
global.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame() { return 1; },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  },
  document: {
    getElementById(id) { return els[id] || els.help; },
    addEventListener() {},
    createElement() { return DivEl('el' + Math.floor(Math.random() * 1e9)); }
  }
};
global.window.document.body = bodyEl;
global.document = global.window.document;
global.requestAnimationFrame = function () { return 1; };
const DATA = __dirname + '/../data/';
global.fetch = function (u) {
  const name = String(u).replace(/^.*\//, '').replace(/\?.*$/, '');
  const known = { 'so50.geojson': 1, 'countries.geojson': 1, 'ne10m.geojson': 1, 'places.json': 1 };
  const p = known[name] ? DATA + name : DATA + 'countries.geojson';
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};

/* ---------- load the three scripts, in index.html's order ---------- */
const errors = [];
function load(file) {
  try { new Function(fs.readFileSync(__dirname + '/../' + file, 'utf8')).call(global.window); }
  catch (e) { errors.push(file + ': ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }
}
load('core.js');
load('app.js');
load('quizcore.js');
load('quiz.js');

let fails = 0, checks = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
const Z = () => global.window.Quizzy.state();
const M = () => global.window.MapApp;

setTimeout(function () { afterLoad(); }, 500);

function afterLoad() {
  check('the three scripts loaded without throwing', errors.length === 0, errors.join(' | '));
  const Qz = global.window.Quizzy;
  check('the quiz API is exported', !!Qz);
  check('the map API is exported', !!M());
  check('the quiz logic is exported', !!global.window.QuizCore);

  /* ---------- 1. the first page on load ---------- */
  check('the start page is what is on screen at load', Z().screen === 'start', Z().screen);
  check('the start page is visible (#quiz has a screen class)',
        /qz-on/.test(els.quiz.className) && /qz-start/.test(els.quiz.className), els.quiz.className);
  const h = Qz.html();
  check('the start page offers the three modes',
        /data-mode="country"/.test(h) && /data-mode="capital"/.test(h) && /data-mode="flag"/.test(h));
  check('the start page offers every zone',
        global.window.QuizCore.ZONES.every(z => h.indexOf('data-zone="' + z.id + '"') >= 0));
  check('the start page offers the three difficulties',
        /data-diff="easy"/.test(h) && /data-diff="medium"/.test(h) && /data-diff="hard"/.test(h));
  check('World is the default zone', Z().zone === 'world');
  check('the start page has a Play button', /data-act="play"/.test(h));
  check('Play is enabled once the map is loaded', !/data-act="play" disabled/.test(h));
  check('the start page links to the map viewer', /data-act="explore"/.test(h));

  /* ---------- 2. the country list, from the real layer ---------- */
  check('the map is ready', M().ready() && M().placesReady());
  M().enter();
  const items = M().items();
  M().exit();
  check('the list has a plausible number of countries', items.length > 150 && items.length < 220, items.length);
  check('every item has a name, a continent and a flag',
        items.every(it => it.name && it.cont && /^[a-z]{2}$/.test(it.flag)));
  check('every item has a label point',
        items.every(it => it.lat != null && it.lon != null && isFinite(it.lat) && isFinite(it.lon)));
  const names = {};
  const dup = items.filter(it => (names[it.name] ? true : (names[it.name] = 1, false)));
  check('no two items share a name', dup.length === 0, dup.map(d => d.name).join(','));

  const byName = {};
  items.forEach(it => { byName[it.nameEn] = it; });
  /* NAME_EN, not NAME: Natural Earth writes "Vatican City" there and "Vatican" in
     NAME, and the item's nameEn is the one used to find a country in this test */
  ['France', 'Japan', 'Brazil', 'Russia', 'United States of America', 'Vatican City',
   'Maldives', 'Seychelles', 'Germany'].forEach(n => {
    check('the list carries ' + n, !!byName[n]);
  });
  check('France has Paris as its capital', byName.France && byName.France.cap === 'Paris',
        byName.France && byName.France.cap);
  check('Japan has Tokyo as its capital', byName.Japan && byName.Japan.cap === 'Tokyo',
        byName.Japan && byName.Japan.cap);
  check('a disputed area with no flag is not in the list',
        !byName.Somaliland && !byName['N. Cyprus'] && !byName['Siachen Glacier']);

  /* ---------- 3. the capital modes have something to ask ---------- */
  const QC = global.window.QuizCore;
  const poolWorld = QC.poolFor(items, 'world', 'country');
  const poolCap = QC.poolFor(items, 'world', 'capital');
  const poolFlag = QC.poolFor(items, 'world', 'flag');
  check('the world pool is big', poolWorld.length > 150, poolWorld.length);
  check('most countries have a capital on the map', poolCap.length > poolWorld.length * 0.85,
        poolCap.length + '/' + poolWorld.length);
  check('the flag pool is the whole list', poolFlag.length === poolWorld.length);
  ['africa', 'asia', 'europe', 'north-america', 'south-america', 'oceania'].forEach(z => {
    const n = QC.poolFor(items, z, 'country').length;
    /* every zone must be able to make a question: fewer than six countries is a
       zone that cannot be played at all */
    check('zone ' + z + ' has at least six countries', n >= 6, n);
  });

  /* ---------- 4. every country can be shown ---------- */
  /* THE FIT TEST. A quiz asks "which country is lit up", so the country must
     actually be on screen at a size a human can recognise - and the neighbours
     around it are what makes the question answerable. Two failure modes are real
     (both were shipped once in the viewer's double-click): a scattered sovereignty
     (France with its overseas departments, Russia across the seam) fitting the whole
     world, and a microstate fitting to a pixel. */
  M().enter();
  const view = global.window.ViewState.viewSize();
  const wide = Math.max(view[0], view[1]), tall = Math.min(view[0], view[1]);
  let worstBig = 0, worstBigName = '', worstSmall = 1e9, worstSmallName = '', noFit = [];
  const sample = items.filter((it, i) => i % 3 === 0 || ['France', 'Russia', 'United States of America',
    'Kiribati', 'Vatican', 'Monaco', 'Indonesia', 'Japan'].indexOf(it.nameEn) >= 0);
  sample.forEach(it => {
    const t = M().fitTarget(it.id);
    if (!t || !t.e || !isFinite(t.k)) { noFit.push(it.name); return; }
    const w = (t.e[2] - t.e[0]) * t.k, h2 = (t.e[3] - t.e[1]) * t.k;
    const big = Math.max(w, h2);
    const small = Math.min(w, h2);
    if (big > worstBig) { worstBig = big; worstBigName = it.name; }
    if (small < worstSmall) { worstSmall = small; worstSmallName = it.name + ' (' + Math.round(small) + 'px)'; }
  });
  M().exit();
  check('every sampled country has a fitted destination', noFit.length === 0, noFit.join(','));
  check('no country is fitted bigger than the viewport',
        worstBig <= wide, worstBigName + ' ' + Math.round(worstBig) + 'px of ' + wide);
  check('the fit uses most of one axis of the screen', worstBig >= tall * 0.5,
        Math.round(worstBig) + 'px of ' + tall);
  check('no country is fitted to a speck', worstSmall >= 60, worstSmallName);

  /* France must be metropolitan France, not a box over the Atlantic and the Indian
     Ocean: its core rings are a small subset of its rings */
  const fr = items.filter(it => it.nameEn === 'France')[0];
  if (fr) {
    M().enter();
    const ringsAll = 0;
    void ringsAll;
    const nCore = M().coreRings(fr.id);
    M().exit();
    check('France is measured on its core rings only', nCore >= 1 && nCore <= 3, nCore + ' rings');
  }

  /* ---------- 5. a session, end to end ---------- */
  Qz.set({ mode: 'country', zone: 'world', difficulty: 'easy' });
  check('a session starts', Qz.start() === true);
  check('the screen is a question', Z().screen === 'question', Z().screen);
  check('the viewer chrome is hidden while playing', bodyEl.classList.contains('qz-playing'));
  check('the map is handed over to the quiz', M().quizOn() === true);
  check('the layer is pinned for the session', M().layer() === '50m', M().layer());
  let st = Z();
  check('a question has six options', st.question.options.length === 6, st.question.options.length);
  check('the question is on screen', /qz-ans/.test(Qz.html()) && /data-i="5"/.test(Qz.html()));
  check('the country is lit up on the map',
        M().pickedFeature() >= 0 && items.filter(it => it.id === st.question.answerId)[0] &&
        items.filter(it => it.id === st.question.answerId)[0].idx === M().pickedFeature());

  /* a wrong answer: no point, the right option is marked */
  const wrong = (st.question.correct + 1) % 6;
  check('a wrong answer scores nothing', Qz.choose(wrong) === false && Z().score === 0);
  check('the answer is locked', Z().answered === true && Qz.choose(0) === false);
  check('the right answer is revealed', /qz-ans ok/.test(Qz.html()) && /qz-verdict bad/.test(Qz.html()));
  check('the verdict names the right country', Qz.html().indexOf(st.question.options[st.question.correct].name) >= 0);
  check('Next is offered', /data-act="next"/.test(Qz.html()));

  /* then answer everything else right */
  check('Next moves on', Qz.next() === true && Z().index === 2, Z().index);
  let guard = 0;
  while (Z().screen === 'question' && guard++ < 40) {
    const s2 = Z();
    Qz.choose(s2.question.correct);
    if (Z().screen !== 'question') break;
    Qz.next();
  }
  check('the session ends after its ten questions', Z().screen === 'end', Z().screen);
  check('the end screen shows the score', /qz-endh/.test(Qz.html()) && /9/.test(Qz.html()));
  check('nine of ten right', /9 <span>\/ 10/.test(Qz.html()), Qz.html().slice(0, 120));
  check('the round is a row of dots', (Qz.html().match(/class="qz-dot /g) || []).length === 10,
        (Qz.html().match(/class="qz-dot /g) || []).length);
  check('the best score is remembered', store['kwizzy.quiz.best.country.world.easy'] === '9',
        store['kwizzy.quiz.best.country.world.easy']);

  /* ---------- 6. quit gives the map back ---------- */
  Qz.quit();
  check('quit goes back to the start page', Z().screen === 'start');
  check('the map is handed back', M().quizOn() === false);
  check('the chrome is back', !bodyEl.classList.contains('qz-playing'));

  /* ---------- 7. the other two modes ---------- */
  Qz.set({ mode: 'capital', zone: 'europe', difficulty: 'hard' });
  check('a capital session starts', Qz.start() === true);
  st = Z();
  check('capital options are capital names',
        st.question.options.every(o => o.cap && o.cap.length > 0));
  check('capital questions stay in the zone',
        st.question.options.every(o => {
          const it = items.filter(x => x.id === o.id)[0];
          return QC.zoneOf(it) === 'Europe';
        }));
  Qz.quit();

  Qz.set({ mode: 'flag', zone: 'oceania', difficulty: 'medium' });
  check('a flag session starts', Qz.start() === true);
  st = Z();
  check('the flag question names a flag', /^[a-z]{2}$/.test(st.question.flag));
  check('the flag is shown big', /qz-bigflag/.test(Qz.html()));
  check('no flag is printed next to the options (that would be the answer)',
        (Qz.html().match(/class="fi fi-/g) || []).length === 1, (Qz.html().match(/class="fi fi-/g) || []).length);
  check('flag options are country names, never capitals',
        st.question.options.every(o => o.name && o.id));

  /* keyboard: 1-6 answers, Enter advances */
  L['win:keydown']({ key: '1', preventDefault() {} });
  check('a number key answers', Z().answered === true && Z().chosen === 0, Z().chosen);
  L['win:keydown']({ key: 'Enter', preventDefault() {} });
  check('Enter goes to the next question', Z().index === 2, Z().index);
  L['win:keydown']({ key: 'Escape', preventDefault() {} });
  check('Escape leaves the quiz', Z().screen === 'start' && M().quizOn() === false);

  /* ---------- 8. the way back in, from the viewer's sheet ---------- */
  function findRow(node, id) {
    if (!node) return null;
    if (node.dataset && node.dataset.id === id) return node;
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) { const r = findRow(kids[i], id); if (r) return r; }
    return null;
  }
  const quizRow = findRow(els.items, 'quiz');
  check('the menu has a quiz row', !!quizRow);
  L['menu:click']({ target: quizRow, clientX: 0, clientY: 0 });
  check('the quiz row reopens the start page', Z().screen === 'start' && /qz-on/.test(els.quiz.className));

  console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  if (errors.length) console.log('errors: ' + errors.join(' | '));
  process.exit(fails || errors.length ? 1 : 0);
}
