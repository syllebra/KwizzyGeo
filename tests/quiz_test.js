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
    getElementsByClassName() { return []; },
    /* the answers are built as a markup STRING, so the double answers for an element
       the string contains - which is exactly what the real DOM would have */
    querySelector(sel) {
      const m = /data-i="(\d+)"/.exec(sel || '');
      if (m && String(el.innerHTML).indexOf('data-i="' + m[1] + '"') >= 0) {
        return { getBoundingClientRect() { return { left: 100, top: 200, width: 80, height: 40 }; } };
      }
      const c = /class="([^"]+)"/.exec(sel || '');
      if (c && String(el.innerHTML).indexOf('class="' + c[1]) >= 0) {
        return { textContent: String(el.innerHTML).replace(/<[^>]*>/g, ' ').trim(), className: c[1] };
      }
      return null;
    }
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
  spot: DivEl('spot'), quiz: DivEl('quiz'),
  /* the burger's sheet: the active view's line and the rows (app.js builds them) */
  mview: DivEl('mview'), fsbtn: DivEl('fsbtn'),
  /* the juice: the drawer (a sibling of #quiz) and the particle layer */
  'qz-sound': DivEl('qz-sound'), 'qz-stats': DivEl('qz-stats'), burst: DivEl('burst')
};
const bodyEl = DivEl('body');
const store = {};
/* every <audio> juice.js builds, so the test can read WHICH clips played and WHEN */
const played = [];
function FakeAudio(src) {
  const a = { src: src, volume: 1, currentTime: 0, preload: '', plays: 0,
    play() { a.plays++; played.push(src.replace(/^.*\//, '').replace(/\.wav$/, '')); return { catch() {} }; } };
  return a;
}
const vibrated = [];
global.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame() { return 1; },
  matchMedia() { return { matches: false, addEventListener() {} }; },
  Audio: FakeAudio,
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  },
  document: {
    getElementById(id) { return els[id] || els.help; },
    addEventListener() {},
    /* a created element needs what juice.js's burst touches: a style that takes custom
       properties, a class name, and a parent that can drop it */
    createElement() {
      const e = DivEl('el' + Math.floor(Math.random() * 1e9));
      e.style = { setProperty(k, v) { this[k] = v; } };
      return e;
    }
  }
};
global.window.document.body = bodyEl;
global.document = global.window.document;
global.requestAnimationFrame = function () { return 1; };
global.Audio = FakeAudio;
global.localStorage = global.window.localStorage;
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { vibrate(p) { vibrated.push(p); return true; } }, configurable: true, writable: true
  });
} catch (e) {}
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
/* the music rules are a plain <script> in the page; under node the same file exports
   through module.exports, so it is required and put where the page puts it */
global.window.KwizzyPlaylist = require(__dirname + '/../media/music/playlist.js');
load('juice.js');
/* stats.js is UMD like the playlist module: required here, put where the page puts it */
global.window.KwizzyStats = require(__dirname + '/../stats.js');
global.window.KwizzyI18n = require(__dirname + '/../i18n.js');
load('quiz.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, checks = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
const Z = () => global.window.Quizzy.state();
const M = () => global.window.MapApp;

setTimeout(function () { afterLoad(); }, 500);

async function afterLoad() {
  /* the app must be SILENT at boot; taken here because walking the menu screens (the
     next thing this test does) correctly plays a "screen" swell each time */
  const playedAtLoad = played.slice();
  check('the three scripts loaded without throwing', errors.length === 0, errors.join(' | '));
  const Qz = global.window.Quizzy;
  check('the quiz API is exported', !!Qz);
  check('the map API is exported', !!M());
  check('the quiz logic is exported', !!global.window.QuizCore);

  /* ---------- 1. the walk: title -> what -> where -> how hard ----------
     Kwizzy's shape, one question per screen. The checks below walk it exactly as a
     player does (Qz.go is the same entry point the buttons use), screen by screen. */
  check('the TITLE is what is on screen at load', Z().screen === 'title', Z().screen);
  check('the title is visible (#quiz has a screen class)',
        /qz-on/.test(els.quiz.className) && /qz-title/.test(els.quiz.className), els.quiz.className);
  const hTitle = Qz.html();
  check('the title carries the wordmark (or the logo slot)', /qz-brand/.test(hTitle));
  check('the title has the big Play button', /data-act="play"/.test(hTitle));
  check('Play is enabled once the map is loaded', !/data-act="play" disabled/.test(hTitle));
  check('the title offers the credits', /data-act="about"/.test(hTitle));
  check('the title links to the map viewer', /data-act="explore"/.test(hTitle));
  check('the title links to the sound drawer and the stats',
        /data-act="snd-open"/.test(hTitle) && /data-act="stats-open"/.test(hTitle));
  check('the title offers to drift the map behind it (cinema on)',
        M().cinema() === true, M().cinema());

  check('Play goes to the first step', (Qz.go('mode'), Z().screen === 'mode'), Z().screen);
  const h = Qz.html();
  check('the first step is step 1 of 3',
        /qz-stepd/.test(h) && /Step 1 of 3/.test(h), (h.match(/qz-kicker">[^<]*/) || [''])[0]);
  check('the mode screen offers the three modes',
        /data-mode="country"/.test(h) && /data-mode="capital"/.test(h) && /data-mode="flag"/.test(h));
  check('the mode screen has a Continue button', /data-act="go" data-to="zone"/.test(h));
  check('a top bar with a Back arrow', /qz-back/.test(h) && /data-act="back"/.test(h));

  Qz.go('zone');
  const hz = Qz.html();
  check('the zone screen offers every zone',
        global.window.QuizCore.ZONES.every(z => hz.indexOf('data-zone="' + z.id + '"') >= 0));
  check('World is the default zone', Z().zone === 'world');
  check('the zone screen is step 2 of 3', /Step 2 of 3/.test(hz));

  Qz.go('diff');
  const hd = Qz.html();
  check('the difficulty screen offers the three difficulties',
        /data-diff="easy"/.test(hd) && /data-diff="medium"/.test(hd) && /data-diff="hard"/.test(hd));
  /* the round length: 10, 25 or the whole zone */
  check('...and the three round lengths',
        /data-len="10"/.test(hd) && /data-len="25"/.test(hd) && /data-len="0"/.test(hd));
  check('10 questions is the default', Z().len === 10);
  check('the length note says what the round will be', /A short round/.test(hd),
        (hd.match(/class="qz-note">[^<]*/) || [''])[0]);
  check('the last step is the one that starts the round', /data-act="start"/.test(hd));

  /* the arrows walk both ways */
  check('Back goes to the previous step', (Qz.back(), Z().screen === 'zone'), Z().screen);
  check('...and back again', (Qz.back(), Z().screen === 'mode'), Z().screen);
  Qz.go('diff');

  /* the credits page: its own screen, the data's provenance on it */
  Qz.go('about');
  const hab = Qz.html();
  check('the credits screen names Natural Earth', /Natural Earth/.test(hab) && /naturalearthdata\.com/.test(hab));
  check('the credits screen credits the flags', /flag-icons/.test(hab));
  check('the credits screen says where the memory lives', /this browser/.test(hab));
  check('the credits screen can be left', /data-act="back"/.test(hab));
  check('a menu screen keeps the map drifting behind it', M().cinema() === true);
  Qz.go('diff');

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
  /* THE FIT TEST. A quiz asks "which country is lit up", so the country must be on
     screen at a size a human can recognise - and, since "see the surroundings", the
     view must not be so tight that a small country is a shape in an empty field.
     Three failure modes are real: a scattered sovereignty (France with its overseas
     departments, Russia across the seam) fitting the whole world; a country fitted
     past the viewport; and a small country zoomed into nothing but itself.
     So: the box never overflows, the VISIBLE WINDOW is never smaller than the floor
     (~6 degrees), and a big country still fills the screen. */
  M().enter();
  const view = global.window.ViewState.viewSize();
  const wide = Math.max(view[0], view[1]), tall = Math.min(view[0], view[1]);
  let worstBig = 0, worstBigName = '', noFit = [];
  const windows = [];
  const sample = items.filter((it, i) => i % 3 === 0 || ['France', 'Russia', 'United States of America',
    'Kiribati', 'Vatican', 'Monaco', 'Indonesia', 'Japan'].indexOf(it.nameEn) >= 0);
  sample.forEach(it => {
    const t = M().fitTarget(it.id);
    if (!t || !t.e || !isFinite(t.k)) { noFit.push(it.name); return; }
    const w = (t.e[2] - t.e[0]) * t.k, h2 = (t.e[3] - t.e[1]) * t.k;
    const big = Math.max(w, h2);
    if (big > worstBig) { worstBig = big; worstBigName = it.name; }
    /* the window: the shorter screen side, in degrees (the fit's own measurement) */
    const ppd = M().planePerDeg(t.lon, t.lat);
    windows.push({ name: it.nameEn, deg: ppd ? (tall / t.k) / ppd : 0 });
  });
  M().exit();
  check('every sampled country has a fitted destination', noFit.length === 0, noFit.join(','));
  check('no country is fitted bigger than the viewport',
        worstBig <= wide, worstBigName + ' ' + Math.round(worstBig) + 'px of ' + wide);
  check('the fit uses most of one axis of the screen', worstBig >= tall * 0.5,
        Math.round(worstBig) + 'px of ' + tall);
  /* THE SMALL-COUNTRY FLOOR, stated in degrees: nothing is zoomed past a ~5.3 degree
     window (6 degrees across 88 % of the shorter side, i.e. 6 x 0.88). */
  const tightest = windows.slice().sort((a, b) => a.deg - b.deg)[0];
  const winByName = {};
  check('no country is zoomed tighter than the 6-degree window',
        tightest && tightest.deg >= 5.2, tightest && (tightest.name + ' ' + tightest.deg.toFixed(2) + ' deg'));
  /* ...and the floor is what a small country gets: Luxembourg and Malta are zoomed
     out to it, Germany is not (it is bigger than the floor) */
  windows.forEach(w => { winByName[w.name] = w.deg; });
  ['Luxembourg', 'Malta', 'Cyprus', 'Israel', 'Monaco'].forEach(n => {
    if (winByName[n] == null) return;
    check(n + ' is shown with its surroundings (window >= 5.2 deg)', winByName[n] >= 5.2,
          winByName[n].toFixed(2) + ' deg');
  });
  if (winByName.Germany != null) {
    check('a country bigger than the floor keeps its exact fit (Germany < 12 deg)',
          winByName.Germany < 12, winByName.Germany.toFixed(2) + ' deg');
  }
  if (winByName.Russia != null) {
    check('...and a huge one is still huge (Russia > 25 deg)', winByName.Russia > 25,
          winByName.Russia.toFixed(2) + ' deg');
  }

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

  /* ---------- 4b. the juice it ships with ---------- */
  const JU = Qz.juice();
  check('the sound module is loaded', !!JU);
  check('the sound module is exported on window', !!global.window.Juice);
  check('the sound assets are shipped', ['tap', 'select', 'screen', 'start', 'correct', 'wrong'].every(n =>
        fs.existsSync(__dirname + '/../media/sfx/' + n + '.wav')));
  check('the music rules are the playlist module', JU && JU.tracks().length === 5);
  check('nothing has played yet at load', playedAtLoad.length === 0, playedAtLoad.join(','));

  /* ---------- 5. a session, end to end ---------- */
  Qz.set({ mode: 'country', zone: 'world', difficulty: 'easy' });
  const before = played.length;
  check('a session starts', Qz.start() === true);
  check('...and the launch plays the "start" clip', played.slice(before).indexOf('start') >= 0,
        played.slice(before).join(','));
  check('...under an airy "screen" swell', played.slice(before).indexOf('screen') >= 0,
        played.slice(before).join(','));
  check('the screen is a question', Z().screen === 'question', Z().screen);
  check('the viewer chrome is hidden while playing',
        bodyEl.classList.contains('qz-playing') && bodyEl.classList.contains('qz-owning'));
  check('the map is handed over to the quiz', M().quizOn() === true);
  check('the layer is pinned for the session', M().layer() === '50m', M().layer());
  let st = Z();
  check('a question has six options', st.question.options.length === 6, st.question.options.length);
  check('the question is on screen', /qz-ans/.test(Qz.html()) && /data-i="5"/.test(Qz.html()));
  check('the country is lit up on the map',
        M().pickedFeature() >= 0 && items.filter(it => it.id === st.question.answerId)[0] &&
        items.filter(it => it.id === st.question.answerId)[0].idx === M().pickedFeature());

  /* a wrong answer: no point, the right option is marked, and the FALLING clip plays */
  const wrong = (st.question.correct + 1) % 6;
  const pBefore = played.length;
  check('a wrong answer scores nothing', Qz.choose(wrong) === false && Z().score === 0);
  check('a wrong answer plays the "wrong" clip', played.slice(pBefore).indexOf('wrong') >= 0,
        played.slice(pBefore).join(','));
  check('a wrong answer does not play the "correct" clip',
        played.slice(pBefore).indexOf('correct') < 0, played.slice(pBefore).join(','));
  check('a wrong answer buzzes the phone once, in three taps',
        JSON.stringify(vibrated[vibrated.length - 1]) === '[25,40,25]', JSON.stringify(vibrated));
  check('the answer is locked', Z().answered === true && Qz.choose(0) === false);
  check('the right answer is revealed', /qz-ans ok/.test(Qz.html()) && /qz-verdict bad/.test(Qz.html()));
  check('the verdict names the right country', Qz.html().indexOf(st.question.options[st.question.correct].name) >= 0);
  check('a country answer reveals the country details',
        /qz-details/.test(Qz.html()) && /area/.test(Qz.html()) && /codes/.test(Qz.html()));
  check('Next is offered', /data-act="next"/.test(Qz.html()));

  /* then answer everything else right */
  check('Next moves on', Qz.next() === true && Z().index === 2, Z().index);
  /* a RIGHT answer: the rising clip, one clean buzz, and the particles */
  const rIndex = Z().question.correct;
  const rBefore = played.length, sparks0 = els.burst.children.length;
  Qz.choose(rIndex);
  check('a right answer plays the "correct" clip', played.slice(rBefore).indexOf('correct') >= 0,
        played.slice(rBefore).join(','));
  check('a right answer buzzes once, cleanly', vibrated[vibrated.length - 1] === 60,
        String(vibrated[vibrated.length - 1]));
  await sleep(120);
  check('a right answer throws a particle burst', els.burst.children.length >= 20,
        els.burst.children.length + ' sparks (' + sparks0 + ' before)');
  check('the sparks are coloured from this app palette',
        /#8ed0ff|#46d18e|#ff8f8f|#ffd166/.test(els.burst.children[0] && els.burst.children[0].style.background || ''),
        els.burst.children[0] && els.burst.children[0].style.background);
  Qz.next();
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
  /* the score is recorded in the STATS store, with the length it was set at */
  const statsBlob = JSON.parse(store['kwizzygeo.stats.v1'] || '{}');
  const bestEntry = (statsBlob.byCfg || {})['country|world|easy|-'];
  check('the round is written to the stats store', !!bestEntry, JSON.stringify(Object.keys(statsBlob.byCfg || {})));
  check('...with its score and its length', bestEntry && bestEntry.best === 9 && bestEntry.bestLen === 10,
        bestEntry && (bestEntry.best + '/' + bestEntry.bestLen));
  check('...and the answers are counted', statsBlob.asked === 10 && statsBlob.correct === 9,
        statsBlob.asked + '/' + statsBlob.correct);
  check('every answered country is in the record', Object.keys(statsBlob.byCountry || {}).length === 10,
        Object.keys(statsBlob.byCountry || {}).length);

  /* ---------- 5c. the round length ---------- */
  Qz.set({ mode: 'country', zone: 'oceania', difficulty: 'medium', len: 0 });
  const oceania = QC.poolFor(items, 'oceania', 'country').length;
  check('All starts a round for the whole zone', Qz.start() === true);
  check('...one question per country of the zone', Z().roundLen === oceania,
        Z().roundLen + ' vs ' + oceania);
  check('...and the progress line says so', new RegExp('1 / ' + oceania).test(Qz.html()),
        (Qz.html().match(/Question [^<]*/) || [''])[0]);
  Qz.quit();

  Qz.set({ mode: 'country', zone: 'europe', difficulty: 'medium', len: 25 });
  check('a 25-question round starts', Qz.start() === true);
  check('...with 25 questions', Z().roundLen === 25, Z().roundLen);
  Qz.quit();
  Qz.set({ len: 10 });

  /* ---------- 5d. the stats sheet ---------- */
  check('the start page links to the stats', /data-act="stats-open"/.test(Qz.html()));
  check('the stats sheet starts closed', Qz.statsOpen() === false);
  Qz.statsToggle(true);
  check('the stats sheet opens', Qz.statsOpen() === true);
  const sh2 = Qz.statsHtml();
  check('it shows the figures', /qz-figs/.test(sh2) && /questions/.test(sh2) && /best streak/.test(sh2));
  check('it shows the record so far', /10/.test(sh2), sh2.slice(0, 200));
  check('it breaks the record down by mode and zone',
        /By mode/.test(sh2) && /By zone/.test(sh2) && /Find the country/.test(sh2));
  check('it lists the best rounds', /Best rounds/.test(sh2));
  check('it names the countries that cost the most', /Costs you the most/.test(sh2));
  check('resetting is a two-step button', /Reset stats/.test(sh2));
  /* the first press only arms it; the second erases */
  const beforeJump = JSON.parse(store['kwizzygeo.stats.v1']).asked;
  L['qz-stats:click']({ target: { getAttribute(a) { return a === 'data-act' ? 'stats-reset' : null; },
                                  parentNode: null } });
  check('one press arms the reset without erasing',
        /Really erase everything/.test(Qz.statsHtml()) &&
        JSON.parse(store['kwizzygeo.stats.v1']).asked === beforeJump);
  L['qz-stats:click']({ target: { getAttribute(a) { return a === 'data-act' ? 'stats-reset' : null; },
                                  parentNode: null } });
  check('the second press erases the record',
        JSON.parse(store['kwizzygeo.stats.v1']).asked === 0,
        JSON.parse(store['kwizzygeo.stats.v1']).asked);
  check('...and the sheet says there is nothing yet', /Nothing played yet/.test(Qz.statsHtml()));
  Qz.statsToggle(false);

  /* ---------- 5b. the sound & music drawer ---------- */
  check('the drawer starts closed', Qz.sound().open === false);
  Qz.soundToggle(true);
  check('the drawer opens', Qz.sound().open === true);
  const sh = Qz.sound().html;
  check('it offers the three switches', /data-set="sfx"/.test(sh) && /data-set="music"/.test(sh) &&
        /data-set="haptics"/.test(sh));
  check('it offers the volume slider', /id="qz-vol"/.test(sh) && /type="range"/.test(sh));
  check('it offers the music choice', /data-trk="all"/.test(sh) && (sh.match(/data-trk="/g) || []).length === 6,
        (sh.match(/data-trk="/g) || []).length);
  check('each switch states its state in words, not only in colour',
        (sh.match(/role="switch"/g) || []).length === 3 && /aria-checked="true"/.test(sh));
  check('the drawer says what the music is doing',
        /Playing|Waiting for a first tap|Music is off|no audio engine/.test(sh),
        (sh.match(/class="qz-note" id="qz-now">[^<]*/) || [''])[0]);
  /* turning Sound off must persist AND silence the game */
  Qz.soundToggle(false);
  JU.setSfx(false);
  const sBefore = played.length;
  L['win:keydown']({ key: '1', preventDefault() {} });
  check('with Sound off, answering is silent', played.length === sBefore, played.slice(sBefore).join(','));
  JU.setSfx(true);
  Qz.quit();

  /* ---------- 6. quit gives the map back ---------- */
  check('quit goes back to the title', Z().screen === 'title', Z().screen);
  check('...and the map stops drifting while nothing is played',
        M().cinema() === true, 'the title is a menu screen');
  check('the map is handed back', M().quizOn() === false);
  /* back on the START page: the burger (the language selector) is back, the HUD and
     the help line are not - the start page is a quiz screen too. They only return when
     the quiz is dismissed altogether ("explore the map instead"). */
  check('the burger is back on the title', !bodyEl.classList.contains('qz-playing') &&
        bodyEl.classList.contains('qz-owning'));
  Qz.close();
  check('dismissing the quiz gives the whole viewer back',
        !bodyEl.classList.contains('qz-playing') && !bodyEl.classList.contains('qz-owning'));
  Qz.open();

  /* ---------- 6b. WHICH QUESTIONS MAY BE PRINTED ON THE MAP ----------
     The map can name the lit country (MapApp.labels). That is a SPOILER in "find the
     country" - the name IS the answer - and a help in capital and "country -> flag"
     questions, where the country is given. The flag mode then has one half of each, so
     the rule follows the QUESTION, not the mode. */
  Qz.set({ mode: 'country', zone: 'europe', difficulty: 'easy', len: 10 });
  Qz.start();
  check('find-the-country: the map does NOT name the lit country', M().labelsOn() === false);
  Qz.choose(Z().question.correct);
  check('...until it is answered, when the name stops being a secret', M().labelsOn() === true);
  Qz.quit();

  Qz.set({ mode: 'capital', zone: 'europe', difficulty: 'easy' });
  Qz.start();
  check('capital questions DO name the lit country on the map', M().labelsOn() === true);
  Qz.quit();

  Qz.set({ mode: 'flag', zone: 'europe', difficulty: 'easy', variant: 'flags' });
  Qz.start();
  check('country -> flag names the lit country (the flag is the answer)', M().labelsOn() === true);
  Qz.quit();

  Qz.set({ mode: 'flag', zone: 'europe', difficulty: 'easy', variant: 'name' });
  Qz.start();
  check('flag -> country keeps the map anonymous (the name is the answer)', M().labelsOn() === false);
  Qz.quit();
  Qz.open();

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
  /* answering a CAPITAL question shows the CITY's details, not the country's */
  const capAnswer = st.question.capital;
  Qz.choose(st.question.correct);
  /* the city panel's rows: name, country, region, type, population, coordinates - and
     time zone where Natural Earth has one (it does not for Moscow), so the check is on
     the rows every city has */
  check('the capital answer reveals the city details',
        /qz-details/.test(Qz.html()) && /country/.test(Qz.html()) &&
        /coordinates|at<\/span>|°/.test(Qz.html()) && Qz.html().indexOf(capAnswer) >= 0,
        (Qz.html().match(/qz-details[\s\S]{0,300}/) || [''])[0]);
  check('the city details are the place panel',
        Qz.html().indexOf(M().capitalPanel(st.question.answerId).slice(0, 60)) >= 0);
  Qz.quit();

  /* ---------- 7b. flag mode, variant "flag -> country" (the default) ---------- */
  Qz.set({ mode: 'flag', zone: 'oceania', difficulty: 'medium', variant: 'name' });
  check('a flag session starts', Qz.start() === true);
  st = Z();
  check('the question records its variant', st.question.variant === 'name');
  check('the flag question names a flag', /^[a-z]{2}$/.test(st.question.flag));
  check('the flag is shown big', /qz-bigflag/.test(Qz.html()));
  check('no flag is printed next to the options (that would be the answer)',
        (Qz.html().match(/class="fi fi-/g) || []).length === 1, (Qz.html().match(/class="fi fi-/g) || []).length);
  check('flag options are country names, never capitals',
        st.question.options.every(o => o.name && o.id));
  /* the flag question also travels: the country is lit up and the map flies there */
  check('the flag question lights its country up', M().pickedFeature() >= 0);
  check('the flag question flies to the country', !!M().flight() && M().flight().dur === 950,
        M().flight() && M().flight().dur);
  check('the country is fitted like a double click (88 % of the viewport)',
        (function () {
          const f = M().flight();
          if (!f) return false;
          const t = M().fitTarget(st.question.answerId);
          return t && Math.abs(f.k1 - t.k) < 1e-9 && Math.abs(f.k1 - global.window.ViewState.fitK()) > 1;
        })());
  /* and answering it shows the details */
  Qz.choose(st.question.correct);
  check('the flag answer reveals the country details',
        /qz-details/.test(Qz.html()) && /population/.test(Qz.html()) && /ISO/.test(Qz.html()));
  check('the details are the same rows the map panel shows',
        Qz.html().indexOf(M().countryPanel(st.question.answerId).slice(0, 60)) >= 0);
  Qz.quit();

  /* ---------- 7c. flag mode, variant "country -> flag" ---------- */
  Qz.set({ mode: 'flag', zone: 'europe', difficulty: 'hard', variant: 'flags' });
  check('the country->flag session starts', Qz.start() === true);
  st = Z();
  check('the question records the flags variant', st.question.variant === 'flags');
  check('the prompt NAMES the country', Qz.html().indexOf(st.question.answer) >= 0 &&
        /Which flag is/.test(Qz.html()));
  check('the prompt also gives the capital', !st.question.capital ||
        Qz.html().indexOf('capital ' + st.question.capital) >= 0, st.question.capital);
  check('the six options are six flags', (Qz.html().match(/qz-optflag/g) || []).length === 6,
        (Qz.html().match(/qz-optflag/g) || []).length);
  check('the flags grid is its own layout', /qz-answers-flags/.test(Qz.html()));
  check('every option flag is a real flag code',
        st.question.options.every(o => /^[a-z]{2}$/.test(o.flag)));
  check('no option flag is repeated',
        (function () {
          const seen = {};
          return st.question.options.every(o => (seen[o.flag] ? false : (seen[o.flag] = 1)));
        })());
  check('the wrong options are NOT named on screen (that would give the answer away)',
        st.question.options.every((o, i) => i === st.question.correct || Qz.html().indexOf('>' + o.name + '<') < 0));
  check('the country is lit up and the map flies to it',
        M().pickedFeature() >= 0 && !!M().flight());
  Qz.choose(st.question.correct);
  check('the country->flag answer shows the country details too',
        /qz-details/.test(Qz.html()) && /population/.test(Qz.html()));

  /* keyboard: 1-6 answers, Enter advances - from a FRESH question, since 7c left
     one answered */
  Qz.quit();
  Qz.set({ mode: 'country', zone: 'world', difficulty: 'medium', variant: 'name' });
  Qz.start();
  L['win:keydown']({ key: '1', preventDefault() {} });
  check('a number key answers', Z().answered === true && Z().chosen === 0, Z().chosen);
  L['win:keydown']({ key: 'Enter', preventDefault() {} });
  check('Enter goes to the next question', Z().index === 2, Z().index);
  L['win:keydown']({ key: 'Escape', preventDefault() {} });
  check('Escape leaves the quiz', Z().screen === 'title' && M().quizOn() === false,
        Z().screen);

  /* ---------- 7d. the UI follows the MAP's language ---------- */
  /* One language setting for the whole app: the burger's chips call app.js's setLang,
     which rebuilds the country and city names AND tells the quiz to re-render. Nothing
     here is a second setting - that is the point. */
  Qz.quit();
  const V = global.window.ViewState;
  Qz.set({ mode: 'country', zone: 'europe', difficulty: 'medium', len: 10 });
  V.setLang('fr');
  /* A LANGUAGE ARRIVES IN TWO STEPS: the code is set at once, but the city names are a
     separate file, and the quiz is re-rendered when they land. A test that reads the
     HTML synchronously sees the old screen - which is also what a player would see for
     the tenth of a second the fetch takes. */
  /* the map must TELL the quiz, not the quiz poll it: one hook, called once */
  let hookFired = 0;
  V.onLang(function () { hookFired++; });
  check('the code changes immediately', V.lang() === 'fr', V.lang());
  await sleep(120);
  check('the map told the quiz once, after the names were rebuilt', hookFired === 1, hookFired);
  check('the language is the map\'s', Qz.lang() === 'fr', Qz.lang());
  /* THE WALK, in French: the screens are separate now, so the language is read on
     every one of them rather than on a single start page */
  check('the title is what the language change re-rendered', Z().screen === 'title', Z().screen);
  const hFrTitle = Qz.html();
  check('the title is in French', /Jouer/.test(hFrTitle) && /Explorer la carte/.test(hFrTitle) &&
        /Crédits et mémoire/.test(hFrTitle), hFrTitle.slice(0, 160));
  Qz.go('mode');
  const hFr = Qz.html();
  check('the mode screen is in French', /Trouver le pays/.test(hFr) && /Continuer/.test(hFr), hFr.slice(0, 160));
  check('no English left on the mode screen',
        !/Find the country|Difficulty|Explore the map|Sound & music|Stats</.test(hFr));
  Qz.go('zone');
  check('...and the zone chips too', /Amérique du Nord/.test(Qz.html()) && /Océanie/.test(Qz.html()));
  Qz.go('diff');
  check('...and the difficulties and the lengths',
        /Difficile/.test(Qz.html()) && /Toutes/.test(Qz.html()));
  const hFrDiff = Qz.html();
  check('the last step starts the round, in French', /data-act="start"/.test(hFrDiff) && /Jouer/.test(hFrDiff));

  /* a French QUESTION: the words, and the country names from the layer */
  Qz.start();
  check('a French session starts', Z().screen === 'question');
  const hFrQ = Qz.html();
  check('the prompt is French', /Quel pays est allumé \?/.test(hFrQ), (hFrQ.match(/class="qz-q">[^<]*/) || [''])[0]);
  check('the progress line is French', /Question 1 \/ 10/.test(hFrQ), (hFrQ.match(/qz-prog">[^<]*/) || [''])[0]);
  check('the six options use the FRENCH country names',
        Z().question.options.every(o => {
          /* app.js's label() is what the buttons show: it must be the layer's NAME_FR */
          const lbl = M().label(o.id);
          return lbl && hFrQ.indexOf('>' + lbl.replace(/&/g, '&amp;') + '<') >= 0;
        }));
  /* `items` was built at load, in English: it is the reference the French names must
     differ from (an item built AFTER the switch already carries the French name, so
     comparing a label to `o.name` would compare French to French) */
  const enName = {};
  items.forEach(it => { enName[it.id] = it.name; });
  check('...and the labels are not the English names',
        Z().question.options.filter(o => enName[o.id] && M().label(o.id) !== enName[o.id]).length >= 4,
        Z().question.options.map(o => M().label(o.id) + '/' + enName[o.id]).join(' '));
  check('every option has a label in the chosen language',
        Z().question.options.every(o => !!M().label(o.id)));
  /* answering in French: the verdict, then the details panel in French */
  Qz.choose(Z().question.correct);
  const hFrA = Qz.html();
  check('the verdict is French', /Correct/.test(hFrA));
  check('the reveal line is French', /capitale|Région|Population|Superficie/.test(hFrA), hFrA.slice(0, 200));
  Qz.next();
  check('the next question is French too', /Quel pays est allumé/.test(Qz.html()));
  Qz.quit();
  const hFrEnd = (Qz.start() && Qz.quit(), Qz.html());
  void hFrEnd;

  /* the drawers */
  Qz.soundToggle(true);
  check('the sound drawer is French', /Son et musique/.test(Qz.sound().html) &&
        /Effets sonores/.test(Qz.sound().html) && /Volume de la musique/.test(Qz.sound().html),
        Qz.sound().html.slice(0, 200));
  Qz.soundToggle(false);
  Qz.statsToggle(true);
  check('the stats sheet is French', /Votre palmarès/.test(Qz.statsHtml()) &&
        /Par mode/.test(Qz.statsHtml()) && /questions/.test(Qz.statsHtml()));
  Qz.statsToggle(false);

  /* RIGHT-TO-LEFT: Arabic flips the containers and translates everything */
  V.setLang('ar');
  await sleep(120);
  check('Arabic sets dir=rtl on the quiz container', Qz.dir() === 'rtl' &&
        global.window.document.getElementById('quiz').getAttribute('dir') === 'rtl',
        global.window.document.getElementById('quiz').getAttribute('dir'));
  check('the sound drawer follows the direction',
        global.window.document.getElementById('qz-sound').getAttribute('dir') === 'rtl');
  check('the title screen is in Arabic', /العب/.test(Qz.html()) && /الشكر والذاكرة/.test(Qz.html()),
        Qz.html().slice(0, 120));
  Qz.go('mode');
  const hAr = Qz.html();
  check('the mode screen is in Arabic', /اعثر على/.test(hAr) && /ما الذي تريد أن تجد/.test(hAr) || /ماذا تريد أن تجد/.test(hAr),
        hAr.slice(0, 160));
  Qz.go('diff');
  check('the difficulty screen is in Arabic', /الصعوبة|كيف/.test(Qz.html()), Qz.html().slice(0, 160));
  Qz.start();
  check('an Arabic question is in Arabic', /أي دولة مضيئة/.test(Qz.html()),
        (Qz.html().match(/class="qz-q">[^<]*/) || [''])[0]);
  Qz.quit();
  /* back to English, and the direction with it */
  V.setLang('en');
  await sleep(120);
  check('English restores ltr', Qz.dir() === 'ltr' &&
        global.window.document.getElementById('quiz').getAttribute('dir') === 'ltr');
  Qz.go('diff');
  check('...and the English strings', /data-act="start"/.test(Qz.html()) &&
        /data-diff="easy"/.test(Qz.html()), Qz.html().slice(0, 120));

  /* a language the tables do not have cannot happen (app.js validates), but the quiz
     must survive one anyway */
  check('an unknown language falls back to English, not to blank', (function () {
    Qz.go('mode');
    const before = Qz.html();
    Qz.go('diff');
    return /Find the country/.test(before);
  })());

  /* ---------- 7e. the sheet: no layer pick, and the sound is reachable there ----------
     Three things he asked for on 2026-10-22, asserted where they can break:
       * the map is 10m ALWAYS, so the sheet must not offer a layer choice;
       * sound & music is a ROW in the burger's sheet (a setting of the whole app);
       * opening the sound from the sheet works with the quiz on screen. */
  /* this fake DOM has no getElementsByClassName: walk the children, as the last section
     of this test already does */
  const groups = (els.items.children || []).filter(c => /mgroup/.test(c.className || ''));
  const titles = groups.map(g => (g.children[0] && g.children[0].textContent) || '');
  check('the sheet has no Layer group any more', titles.indexOf('Layer') < 0, titles.join('|'));
  check('the sheet still has the game and the languages',
        titles.indexOf('Game') >= 0 && titles.indexOf('Language') >= 0, titles.join('|'));
  const rowsAll = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (/menuitem/.test(c.className || '')) rowsAll.push(c);
      walk(c);
    }
  })(els.items);
  check('there is no layer row at all',
        !rowsAll.some(r => /^layer:/.test((r.dataset || {}).id || '')),
        rowsAll.map(r => r.dataset.id).join(','));
  const sndRow = rowsAll.filter(r => (r.dataset || {}).id === 'snd')[0];
  check('the sheet has a Sound & music row', !!sndRow, rowsAll.map(r => r.dataset.id).join(','));
  Qz.soundToggle(false);
  L['menu:click']({ target: sndRow, clientX: 10, clientY: 10 });
  check('...and it opens the drawer', Qz.sound().open === true);
  Qz.soundToggle(false);

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
  check('the quiz row reopens the title', Z().screen === 'title' && /qz-on/.test(els.quiz.className),
        Z().screen);

  console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  if (errors.length) console.log('errors: ' + errors.join(' | '));
  process.exit(fails || errors.length ? 1 : 0);
}
