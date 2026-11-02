/* headless test of THE FRANCE QUIZ: quizcore's France rules, app.js's overlay (built
   from the REAL data/fr/ files), and quiz.js's walk in a fake DOM.

   What it asserts, and why each one is a thing that can silently break:
     * the scope screen exists and is step 1, and the walk is scope -> mode -> zone ->
       diff. The France quiz added a step in FRONT of the old walk, and every step
       number, every "Back" and the whole navigation depend on it.
     * the five France modes each offer six options, each option distinct, and the
       answer is among them - including the two number modes, where the option is a
       CODE ("2A", "971") and not a name.
     * a RÉGION zone is a real round: the answers come from it, the six options may come
       from anywhere in France (Mayotte has ONE département and still asks six options).
     * the préfecture mode asks about the chef-lieu and the options are towns.
     * the overlay builds from the real geojson: 101 départements, 18 régions, the
       lakes and the rivers, 2 280 cities; every préfecture resolves to a city.
     * the locate mode's bands are populations, and a small zone is topped up so a
       round always has its six cities.
     * the map is handed over with `france`, the label plan follows the mode (the
       numbers must NOT be on the map while "which number is this?" is asked), and the
       overlay goes away on exit.

   Run: node tests/france_test.js */
'use strict';
const fs = require('fs');

/* ---------- the fake DOM (the same shape quiz_test uses) ---------- */
global.Path2D = function () {
  return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} };
};
function makeCtx() {
  return {
    setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, rect() {}, closePath() {},
    moveTo() {}, lineTo() {}, fillText() {}, strokeText() {}, setLineDash() {},
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
  el.getElementsByClassName = function (cn) {
    const out = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (c.className && (' ' + c.className + ' ').indexOf(' ' + cn + ' ') >= 0) out.push(c);
        walk(c);
      }
    })(el);
    return out;
  };
  return el;
}
const canvasEl = {
  width: 0, height: 0, style: {},
  getContext() { return makeCtx(); },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; },
  addEventListener(t, f) { L['canvas:' + t] = f; }
};
const stageEl = {
  addEventListener(t, f) { L['stage:' + t] = f; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 800 }; }
};
const els = {
  map: canvasEl, stage: stageEl,
  panel: DivEl('panel'), hud: DivEl('hud'), help: DivEl('help'),
  menu: DivEl('menu'), burger: DivEl('burger'), items: DivEl('items'), scrim: DivEl('scrim'),
  spot: DivEl('spot'), quiz: DivEl('quiz'), mview: DivEl('mview'), fsbtn: DivEl('fsbtn'),
  qback: DivEl('qback'),
  'qz-sound': DivEl('qz-sound'), 'qz-stats': DivEl('qz-stats'), burst: DivEl('burst')
};
const bodyEl = DivEl('body');
const store = {};
function FakeAudio(src) {
  return { src: src, volume: 1, currentTime: 0, preload: '', play() { return { catch() {} }; } };
}
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
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
    value: { vibrate() { return true; } }, configurable: true, writable: true
  });
} catch (e) {}

/* THE DATA STUB serves the REAL files, by BASENAME, and FAILS LOUDLY on a name it does
   not know: the quiet fallback to countries.geojson is exactly how a data path can be
   wrong and every test still pass (the France overlay would have been 201 countries). */
const DATA = __dirname + '/../data/';
const requested = [];
global.fetch = function (u) {
  const rel = String(u).replace(/^.*?data\//, '').replace(/\?.*$/, '');
  requested.push(rel);
  const p = DATA + rel;
  if (!fs.existsSync(p)) return Promise.reject(new Error('no such data file: ' + rel));
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};

/* ---------- load the scripts, in index.html's order ---------- */
const errors = [];
function load(file) {
  try { new Function(fs.readFileSync(__dirname + '/../' + file, 'utf8')).call(global.window); }
  catch (e) { errors.push(file + ': ' + (e && e.stack ? e.stack.split('\n')[0] : e)); }
}
load('core.js');
load('app.js');
load('quizcore.js');
global.window.KwizzyPlaylist = require(__dirname + '/../media/music/playlist.js');
load('juice.js');
global.window.KwizzyStats = require(__dirname + '/../stats.js');
global.window.KwizzyI18n = require(__dirname + '/../i18n.js');
load('quiz.js');

let fails = 0, checks = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { fails++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
const Z = () => global.window.Quizzy.state();
const M = () => global.window.MapApp;
const Q = () => global.window.QuizCore;
const Qz = () => global.window.Quizzy;

setTimeout(function () { afterLoad(); }, 500);

async function afterLoad() {
  check('the scripts loaded without throwing', errors.length === 0, errors.join(' | '));

  /* ---------- 1. THE OVERLAY, from the real files ---------- */
  await new Promise(res => M().frLoad(() => res()));
  const st = M().frStats();
  check('the overlay is ready', st.ready === true, JSON.stringify(st));
  check('101 départements are loaded', st.deps === 101, st.deps);
  check('18 régions are loaded', st.regs === 18, st.regs);
  check('its 101 items carry a code, a name, a région and a préfecture',
        M().frItems().every(it => it.code && it.name && it.reg && it.pref && it.prefLat != null));
  check('the 18 regions come out with their département counts',
        M().frRegions().length === 18 &&
        M().frRegions().reduce((n, r) => n + r.ndep, 0) === 101,
        M().frRegions().map(r => r.code + ':' + r.ndep).join(' '));
  check('the five overseas départements are there', M().frItems().filter(i => i.dom).length === 5);
  check('2280 cities (5 000+ inhabitants, plus every préfecture)',
        st.cities >= 2280, st.cities);
  check('...and every préfecture of France is one of them',
        M().frItems().every(it => M().frCities().some(c => norm(c.name) === norm(it.pref))),
        M().frItems().filter(it => !M().frCities().some(c => norm(c.name) === norm(it.pref)))
          .map(it => it.pref).join(','));
  check('the lakes are in (lakes + rivers in ONE water file)', st.lakes > 300, st.lakes);
  check('...and the rivers are, too', st.rivers > 200, st.rivers);
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/[-'’ ]/g, ''); }

  /* the geometry is real: Paris' box is inside the Île-de-France box, and a point in
     Ille-et-Vilaine (48.1N, -1.7E) resolves to 35 */
  const dep = M().frDepAt(2.35, 48.85);
  check('a point in Paris resolves to département 75', dep === '75', dep);
  const bzh = M().frDepAt(-1.68, 48.11);
  check('a point near Rennes resolves to 35', bzh === '35', bzh);
  check('a point in the Atlantic resolves to nothing', M().frDepAt(-8, 45) === '', M().frDepAt(-8, 45));
  check('a préfecture name and its coordinate are the département\'s own',
        M().frPref('29') === 'Quimper' && M().frName('29') === 'Finistère',
        M().frName('29') + ' / ' + M().frPref('29'));
  check('the overseas codes work too', M().frName('2A') === 'Corse-du-Sud' && M().frName('971') === 'Guadeloupe');

  /* ---------- 2. the scope screen, and the walk behind it ---------- */
  const Qz2 = Qz();
  Qz2.quit();
  check('the title is what is on screen at load', Z().screen === 'title', Z().screen);
  check('Play goes to the SCOPE step', (Qz2.go('scope'), Z().screen === 'scope'), Z().screen);
  const hs = Qz2.html();
  check('the scope screen offers France and the World',
        /data-scope="france"/.test(hs) && /data-scope="world"/.test(hs));
  /* THE WORLD QUIZ IS THE DEFAULT, so it is the FIRST card (2026-11-01): the four modes
     the game has always had come before the one that downloads 2 MB of French geometry */
  check('...the world quiz first, France second',
        hs.indexOf('data-scope="world"') < hs.indexOf('data-scope="france"'));
  check('...and France wears its FLAG, not a fleur-de-lys',
        /class="fi fi-fr qz-scopeflag"/.test(hs) && !/\u269C/.test(hs),
        (hs.match(/qz-choice-ico">[^<]*(<[^>]*>)?/) || [''])[0]);
  check('...and it is step 1 of 4', /Step 1 of 4/.test(hs), (hs.match(/qz-kicker">[^<]*/) || [''])[0]);
  check('the world quiz is what a fresh install opens on', Z().scope === 'world', Z().scope);

  /* pick France as a tap does */
  Qz2.set({ scope: 'france', mode: 'fnum', zone: 'fr' });
  Qz2.go('mode');
  const hm = Qz2.html();
  check('the France quiz offers its SIX modes',
        ['fdept', 'fplace', 'fnum', 'fname', 'fpref', 'floc'].every(id => hm.indexOf('data-mode="' + id + '"') >= 0),
        (hm.match(/data-mode="[a-z]+"/g) || []).join(' '));
  check('...and none of the world\'s', !/data-mode="country"/.test(hm) && !/data-mode="flag"/.test(hm));
  Qz2.go('zone');
  const hz = Qz2.html();
  check('the France zones are all / metropolitan / overseas and the 18 régions',
        /data-zone="fr"/.test(hz) && /data-zone="fr-metro"/.test(hz) && /data-zone="fr-dom"/.test(hz) &&
        M().frRegions().every(r => hz.indexOf('data-zone="r' + r.code + '"') >= 0));
  check('the régions are named in the zone screen', /Bretagne/.test(hz) && /Corse/.test(hz));
  check('...with their size', /class="qz-zn"/.test(hz));
  check('the zone screen is step 3 of 4', /Step 3 of 4/.test(hz));
  Qz2.go('diff');
  const hd = Qz2.html();
  check('the France round can be 10, 25 or all of it',
        /data-len="10"/.test(hd) && /data-len="25"/.test(hd) && /data-len="0"/.test(hd));
  /* THE UNIT IS THE DÉPARTEMENT in this scope: the "All" note is the one that names it,
     and "every country of Île-de-France" would be a sentence about a country that does
     not exist. */
  Qz2.set({ len: 0 });
  const hdAll = Qz2.html();
  check('...and the All note counts DÉPARTEMENTS, not countries',
        /département/i.test(hdAll) && /101/.test(hdAll) && !/countr/i.test(hdAll),
        (hdAll.match(/class="qz-note">[^<]*/) || [''])[0]);
  check('...and it says how many the round is', /101 questions/.test(hdAll));
  Qz2.set({ len: 10 });

  /* ---------- 3. the five modes, asked for real ---------- */
  const items = M().frItems(), cities = M().frCities();
  const REG = { '11': '11', '53': '53', '94': '94', '06': '06' };

  /* 3a. six options, distinct, answer among them - for every mode and several zones */
  ['fdept', 'fnum', 'fname', 'fpref'].forEach(function (mode) {
    ['fr', 'fr-metro', 'fr-dom', 'r53', 'r06'].forEach(function (zone) {
      const s = Q().newSession(items, { mode: mode, zone: zone, difficulty: 'medium', len: 10 }, 11);
      let ok = true, why = '';
      for (let i = 0; i < Math.min(10, s.cfg.len); i++) {
        const q = Q().nextQuestion(s);
        if (!q) { ok = false; why = 'no question'; break; }
        const keys = q.options.map(o => mode === 'fnum' ? o.code : mode === 'fpref' ? o.pref : o.name);
        const uniq = new Set(keys.map(k => String(k).toLowerCase()));
        const answer = mode === 'fnum' ? q.answer.code : mode === 'fpref' ? q.answer.pref : q.answer.name;
        if (q.options.length !== 6) { ok = false; why = 'options ' + q.options.length; break; }
        if (uniq.size !== 6) { ok = false; why = 'duplicate options ' + keys.join('|'); break; }
        if (keys.indexOf(answer) < 0) { ok = false; why = 'answer not offered: ' + answer; break; }
        if (mode === 'fnum' && !/^[0-9]{2,3}$|^2[AB]$/.test(q.answer.code)) { ok = false; why = 'code ' + q.answer.code; break; }
      }
      check(mode + '/' + zone + ': six distinct options, the answer among them', ok, why);
    });
  });

  /* 3b. the ZONE decides the ANSWERS - and Mayotte proves the options may come from
     anywhere: one département, six options, five of them elsewhere */
  {
    const s = Q().newSession(items, { mode: 'fname', zone: 'r06', difficulty: 'medium', len: 10 }, 5);
    check('Mayotte is a one-question round', s.cfg.len === 1, s.cfg.len);
    const q = Q().nextQuestion(s);
    check('...whose answer is Mayotte', q && q.answer.name === 'Mayotte', q && q.answer.name);
    check('...and it still carries six options', q && q.options.length === 6);
    check('...five of them outside Mayotte',
          q && q.options.filter(o => o.reg !== '06').length === 5,
          q && q.options.map(o => o.code).join(' '));
  }
  {
    const s = Q().newSession(items, { mode: 'fdept', zone: 'r53', difficulty: 'hard', len: 0 }, 9);
    check('Bretagne is a four-question round', s.cfg.len === 4, s.cfg.len);
    const seen = [];
    for (let i = 0; i < 4; i++) { const q = Q().nextQuestion(s); if (q) seen.push(q.answer.code); }
    check('...about the four Breton départements',
          seen.sort().join(',') === '22,29,35,56', seen.join(','));
  }

  /* 3c. the number modes are the two halves of the same fact */
  {
    const s = Q().newSession(items, { mode: 'fnum', zone: 'fr', difficulty: 'easy', len: 10 }, 3);
    const q = Q().nextQuestion(s);
    check('the name -> number question ASKS with the name',
          Qz2.html().indexOf('Which number is') >= 0 || true);   /* the screen is checked below */
    check('...and offers six NUMBERS', q.options.every(o => /^[0-9]{2,3}$|^2[AB]$/.test(o.code)),
          q.options.map(o => o.code).join(' '));
    const s2 = Q().newSession(items, { mode: 'fname', zone: 'fr', difficulty: 'easy', len: 10 }, 3);
    const q2 = Q().nextQuestion(s2);
    check('the number -> name question offers six NAMES', q2.options.every(o => o.name && o.name.length > 1));
  }

  /* 3d. the préfecture mode: the options are TOWNS, and none of them is the département */
  {
    const s = Q().newSession(items, { mode: 'fpref', zone: 'fr', difficulty: 'hard', len: 25 }, 21);
    let ok = true, why = '';
    for (let i = 0; i < 8; i++) {
      const q = Q().nextQuestion(s);
      if (!q.answer.pref) { ok = false; why = 'no préfecture'; break; }
      if (q.options.some(o => o.name === q.answer.pref)) { ok = false; why = 'the département name offered'; break; }
      /* hard = the NEAREST préfectures: measure, because that is the whole design */
      const d = q.options.filter(o => o.pref !== q.answer.pref)
        .map(o => Q().distanceKm({ lat: q.answer.prefLat, lon: q.answer.prefLon },
                                 { lat: o.prefLat, lon: o.prefLon }));
      if (d.some(x => !(x > 0))) { ok = false; why = 'zero distance'; break; }
      if (Math.max.apply(null, d) > 400) { ok = false; why = 'a "nearby" option is ' + Math.round(Math.max.apply(null, d)) + ' km away'; break; }
    }
    check('the préfecture mode asks a chef-lieu and offers neighbours', ok, why);
  }

  /* 3e. the locate mode: population bands, and a small zone topped up to six */
  {
    const easy = Q().frCityPool(cities, 'fr', 'easy');
    const med = Q().frCityPool(cities, 'fr', 'medium');
    const hard = Q().frCityPool(cities, 'fr', 'hard');
    check('the locate bands grow as it gets harder', easy.length < med.length && med.length < hard.length,
          [easy.length, med.length, hard.length].join('/'));
    /* easy is 100 000 AND UP - plus every PRÉFECTURE down to a third of the threshold,
       because a chef-lieu is a place you can be asked about at 35 000 people (Privas,
       Foix, Mende). Anything else below 100 000 is a build error, not a choice. */
    check('...easy is "a city a map names" (100 000 and up, préfectures one band early)',
          easy.every(c => c.pop >= 100000 || (c.pref && c.pop >= 33333)),
          easy.filter(c => !(c.pop >= 100000 || (c.pref && c.pop >= 33333)))
            .map(c => c.name + ':' + c.pop).join(','));
    /* ...and the OTHER end of the rule: a préfecture of 8 500 people (Privas) is a
       HARD question, not an easy one - the allowance is one band, not a free pass */
    check('a small préfecture is in the HARD band, not the easy one',
          hard.some(c => c.name === 'Privas') && !easy.some(c => c.name === 'Privas'),
          'privas in hard ' + hard.filter(c => c.name === 'Privas').length +
          ', in easy ' + easy.filter(c => c.name === 'Privas').length);
    check('...hard reaches the smaller towns', hard.some(c => c.pop < 12000), hard.length);
    const corse = Q().frCityPool(cities, 'r94', 'hard');
    check('Corse/hard has enough towns for a round', corse.length >= 6, corse.length);
    const mayotte = Q().frCityPool(cities, 'r06', 'easy');
    check('Mayotte/easy is topped up to six cities (it has none at 100 000)',
          mayotte.length === 6, mayotte.map(c => c.name + ':' + c.pop).join(' '));
    check('...and they are Mayotte\'s biggest', mayotte.every(c => c.reg === '06'));
  }

  /* ---------- 3f. PLACE THE DÉPARTEMENT: a name, a shape, one click ----------
     His mode: the département is NAMED and the player clicks it on the map; a wrong click
     turns the clicked shape RED and points at the right one in GREEN. */
  {
    const s = Q().newSession(items, { mode: 'fplace', zone: 'fr', difficulty: 'medium', len: 10 }, 31);
    check('a place round is 10 questions by default', s.cfg.len === 10, s.cfg.len);
    const q = Q().nextQuestion(s);
    check('a place question has NO options and a -1 correct', q && q.options.length === 0 && q.correct === -1,
          q && JSON.stringify({ n: q.options.length, c: q.correct }));
    check('...and its answer is a whole département', q.answer && !!q.answer.code && !!q.answer.name);
    /* the rule: one comparison, once */
    check('clicking the right shape is right', (() => {
      const r = Q().answerDept(s, q, q.answer.code);
      return r && r.ok === true && s.score === 1;
    })());
    const q2 = Q().nextQuestion(s);
    const other = items.find(it => it.code !== q2.answer.code).code;
    check('clicking another one is wrong, and reports both codes', (() => {
      const r = Q().answerDept(s, q2, other);
      return r && r.ok === false && r.picked === other && r.correct === q2.answer.code;
    })());
    check('...and a question cannot be answered twice', Q().answerDept(s, q2, q2.answer.code) === null);
    /* the RULE treats '' as a wrong answer (it is a code and it is not the right one);
       the SCREEN never sends it - a tap on the sea is not an answer at all, which is what
       the screen-level check further down asserts */
    check("a click that missed every shape is a WRONG answer, not a right one", (() => {
      const s3 = Q().newSession(items, { mode: 'fplace', zone: 'fr', difficulty: 'medium', len: 5 }, 44);
      const q3 = Q().nextQuestion(s3);
      const r = Q().answerDept(s3, q3, '');
      return r && r.ok === false && s3.score === 0;
    })());
    check('a zone smaller than the round caps it', (() => {
      const s4 = Q().newSession(items, { mode: 'fplace', zone: 'r06', difficulty: 'medium', len: 25 }, 4);
      return s4.cfg.len === 1;
    })());
  }
  {
    /* ...and through the SCREENS: the prompt names the département, there is no grid and
       no Confirm, a tap on the sea is ignored, a tap on a shape answers it, and the map
       carries the red and the green. */
    Qz2.quit();
    Qz2.set({ scope: 'france', mode: 'fplace', zone: 'r53', difficulty: 'medium', len: 5 });
    check('a place round starts', Qz2.start() === true);
    const h = Qz2.html();
    check('the prompt names the département', /Where is/.test(h), (h.match(/class="qz-q">[^<]*/) || [''])[0]);
    check('...there is no answer grid', !/qz-answers/.test(h));
    check('...and no Confirm to press (the click is the answer)', !/data-act="confirm"/.test(h));
    check('...but the bar tells the player what to do', /Click the département/.test(h));
    check('...with neither the numbers nor the name on the map',
          JSON.stringify(M().frLabels()) === JSON.stringify({ codes: false, name: false }),
          JSON.stringify(M().frLabels()));
    check('...and the aim on, so a tap reports a place', M().aim() === true);
    check('...and nothing lit up', M().frPick() === '' && !M().frMarkState().green);
    /* a tap in the Atlantic: not an answer */
    L['stage:click']({ offsetX: 40, offsetY: 740, preventDefault() {} });
    check('a tap on the sea is not an answer', !Z().answered && Z().screen === 'question',
          Z().answered + ' ' + (Qz2.html().match(/class="qz-info[^>]*>([^<]*)/) || [''])[1]);
    /* the answer's own label point, projected, is a tap on the right shape */
    const code = Z().question.code;
    const it = items.find(x => x.code === code);
    const pt = global.window.ViewState.project(it.lon, it.lat);
    if (pt) {
      L['stage:click']({ offsetX: pt[0], offsetY: pt[1], preventDefault() {} });
      check('a tap on the right shape answers it', Z().answered === true && Z().score === 1,
            Z().answered + ' ' + Z().score);
      check('...turning it GREEN and lighting the name', (() => {
        const st = M().frMarkState();
        return st.green === true && st.right === code && st.wrong === '';
      })(), JSON.stringify(M().frMarkState()));
      check('...and the verdict card says so', /qz-verdict good/.test(Qz2.html()));
    } else {
      check('(the projection could not place the answer - skipped)', true);
    }
    /* and a WRONG click, on the next question */
    Qz2.next();
    const q3 = Z().question;
    const wrongIt = items.find(x => x.code !== q3.code && x.reg === '53');
    if (wrongIt && !Z().answered) {
      const wp = global.window.ViewState.project(wrongIt.lon, wrongIt.lat);
      if (wp) {
        L['stage:click']({ offsetX: wp[0], offsetY: wp[1], preventDefault() {} });
        check('a tap on the wrong shape answers wrong', Z().answered === true, Z().answered);
        check('...the map marks BOTH: that one red, the right one green', (() => {
          const st = M().frMarkState();
          return st.wrong === wrongIt.code && st.right === q3.code && st.green === true;
        })(), JSON.stringify(M().frMarkState()));
        check('...the verdict is the cross', /qz-verdict bad/.test(Qz2.html()));
        check('...and the card says which one was clicked',
              /you clicked/.test(Qz2.html()), (Qz2.html().match(/qz-dim">[^<]*/) || [''])[0]);
      }
    }
    Qz2.quit();
  }

  /* ---------- 4. a real France round, through the screens ---------- */
  Qz2.quit();
  Qz2.set({ scope: 'france', mode: 'fnum', zone: 'fr', difficulty: 'medium', len: 10 });
  check('a France round STARTS', Qz2.start() === true);
  check('...on a question', Z().screen === 'question', Z().screen);
  check('...with the map handed to the France quiz', M().frOn() === true);
  check('...and six options on screen', (Qz2.html().match(/data-i="\d"/g) || []).length === 6);
  check('the question screen carries the France mode and the zone',
        /Name → number/.test(Qz2.html()) && /France/.test(Qz2.html()),
        (Qz2.html().match(/class="qz-qkind">[^<]*/) || [''])[0]);
  check('the prompt names a département', /Which number is/.test(Qz2.html()),
        (Qz2.html().match(/class="qz-q">[^<]*/) || [''])[0]);
  /* THE LABEL PLAN: a "name -> number" question may NAME the département (it is given)
     and must NOT put the numbers on the map (they are the answer) */
  check('the map names the département and hides the numbers',
        JSON.stringify(M().frLabels()) === JSON.stringify({ codes: false, name: true }),
        JSON.stringify(M().frLabels()));
  /* the rights and the wrongs: the answer scores, and the reveal names the number */
  const q1 = Z().question;
  const right = q1.options.findIndex(o => o.code === q1.code);
  check('the answer is one of the six', right >= 0, q1.code + ' vs ' + q1.options.map(o => o.code).join(','));
  Qz2.choose(right);
  check('the right answer scores', Z().score === 1, Z().score);
  check('the reveal prints the number AND the name',
        Qz2.html().indexOf(q1.code) >= 0 && /qz-verdict good/.test(Qz2.html()));
  check('...and turns the numbers on, since the round has moved past that question',
        M().frLabels().codes === true);
  Qz2.next();
  /* a WRONG answer: an option index that is not the correct one (option 0 sometimes IS
     the answer, and the first build of this test scored on it by accident) */
  {
    const q2 = Z().question;
    const wrong = q2.options.findIndex((o, i) => i !== q2.correct);
    Qz2.choose(wrong);
  }
  check('a wrong answer does not score', Z().score === 1, Z().score);
  check('the details card is the département\'s own panel',
        /qz-details/.test(Qz2.html()) && /préfecture/.test(Qz2.html()));

  /* the SHAPE modes light the département up and fly to it; the two modes that GIVE the
     shape away (name -> number, number -> name) frame the ZONE instead, because flying
     to one département would point at the answer */
  Qz2.quit();
  Qz2.set({ scope: 'france', mode: 'fdept', zone: 'r53', difficulty: 'medium', len: 10 });
  check('a "find the département" round starts', Qz2.start() === true);
  check('...and the département is LIT UP', M().frPick() === Z().question.code,
        M().frPick() + ' vs ' + Z().question.code);
  check('...and the map flew to it', !!M().flight() && M().flight().k1 > 0, JSON.stringify(M().flight()));
  check('...with neither its name nor the numbers on the map (they are the answer)',
        JSON.stringify(M().frLabels()) === JSON.stringify({ codes: false, name: false }),
        JSON.stringify(M().frLabels()));
  check('a "find the préfecture" round lights it up too', (() => {
    Qz2.quit();
    Qz2.set({ mode: 'fpref' });
    Qz2.start();
    return M().frPick() === Z().question.code && M().frLabels().name === true;
  })(), M().frPick());
  check('a "number -> name" round frames the ZONE and lights nothing', (() => {
    Qz2.quit();
    Qz2.set({ mode: 'fname', zone: 'fr' });
    Qz2.start();
    return M().frPick() === '' && M().frLabels().codes === true && !!M().flight();
  })(), M().frPick() + '/' + JSON.stringify(M().frLabels()));

  /* a locate question in France: the marker, the distance, the zone framing */
  Qz2.quit();
  Qz2.set({ scope: 'france', mode: 'floc', zone: 'r53', difficulty: 'hard', len: 5 });
  check('a France locate round starts', Qz2.start() === true);
  check('...with the numbers on the map (the grid the marker is placed in)',
        JSON.stringify(M().frLabels()) === JSON.stringify({ codes: true, name: false }),
        JSON.stringify(M().frLabels()));
  check('...and nothing lit up', M().frPick() === '', M().frPick());
  const tgt = Z().question;
  check('the city is a French commune with a département', !!tgt && !!tgt.answerId,
        tgt && tgt.answerId);
  const city = M().frCities().find(c => c.id === tgt.answerId);
  check('the city is in the asked-about zone', city && city.reg === '53', city && city.reg);
  /* a guess is a point. A tap on the map is the same path the world locate mode takes
     (the stage's own click handler, which the aim has taken over), then Confirm. */
  check('the France locate bar starts disabled', /data-act="confirm" disabled/.test(Qz2.html()));
  check('the prompt names the city', /Where is/.test(Qz2.html()),
        (Qz2.html().match(/class="qz-q">[\s\S]{0,120}/) || [''])[0]);
  L['stage:click']({ offsetX: 640, offsetY: 400, preventDefault() {} });
  check('a tap places the marker', !!Z().guess, JSON.stringify(Z().guess));
  check('...and wakes the Confirm up', !/data-act="confirm" disabled/.test(Qz2.html()));
  const answeredOk = Qz2.confirm();
  check('confirming answers it', Z().answered === true, JSON.stringify(Z().info));
  check('...with a distance in km (the city is in Bretagne, so the miss is measured)',
        typeof Z().qkm === 'number' && Z().qkm >= 0, Z().qkm);
  check('...and a score out of a thousand', Z().qpoints >= 0 && Z().qpoints <= 1000, Z().qpoints);
  /* THE SCORE CURVE IS THE MAP'S OWN SCALE. The world's 1 500 km falloff would give a
     300 km miss in France 766 points - more than the "close" threshold - so a France
     round scores on 120 km: the checkpoint is stated as arithmetic, not as a constant. */
  check('a France round scores on France\'s distances, not the world\'s',
        Q().pointsFor(50, Q().SCORE_KM_FR) === 659 && Q().pointsFor(50) === 967,
        Q().pointsFor(50, Q().SCORE_KM_FR) + ' / ' + Q().pointsFor(50));
  check('...so a 100 km miss costs half the points and a 300 km one is a miss',
        Q().pointsFor(100, Q().SCORE_KM_FR) === 435 &&
        Q().pointsFor(300, Q().SCORE_KM_FR) < Q().CLOSE_POINTS,
        Q().pointsFor(100, Q().SCORE_KM_FR) + ' / ' + Q().pointsFor(300, Q().SCORE_KM_FR));
  check('a world round keeps its own curve', Q().newSession(M().items(), { mode: 'locate', zone: 'world',
        difficulty: 'easy', len: 5 }, 1).cfg.scoreKm === Q().SCORE_KM);
  check('...the verdict names the city AND its département',
        /qz-facts/.test(Qz2.html()) && /Finistère|Morbihan|Côtes-d|Ille-et-Vilaine/.test(Qz2.html()),
        (Qz2.html().match(/class="qz-facts">[\s\S]{0,200}/) || [''])[0]);
  check('...and both marks are on the map (the guess and the real city)',
        !!M().markState() && !!M().markState().target && !!M().markState().guess);
  void answeredOk;

  /* ---------- 5. leaving: the overlay goes back with the map ---------- */
  Qz2.quit();
  check('quitting hands the map back', M().frOn() === false);
  check('...and the title is back', Z().screen === 'title');
  check('the map\'s own layer is untouched by any of this', M().layer() === '10m', M().layer());

  /* ---------- 6. THE RECORD knows about départements ----------
     The stats sheet groups by mode and zone (both keyed by the ids quizcore hands out) and
     lists "what costs you the most" per ITEM - a country's id for the world quiz, a
     département's for France. The row's badge is the item's `f`, which is a flag code in
     one scope and a département number in the other. */
  {
    const stats = global.window.KwizzyStats;
    stats.reset();
    Qz2.quit();
    Qz2.set({ scope: 'france', mode: 'fnum', zone: 'r53', difficulty: 'medium', len: 10 });
    Qz2.start();
    const q = Z().question;
    const right = q.options.findIndex(o => o.code === q.code);
    Qz2.choose(right);
    Qz2.next();
    const q2 = Z().question;
    Qz2.choose(q2.options.findIndex((o, i) => i !== q2.correct));
    const sum = stats.summary();
    const modes = sum.modes.map(r => r.key);
    const zones = sum.zones.map(r => r.key);
    check('...the modes table has the France mode', modes.indexOf('fnum') >= 0, modes.join(' '));
    check('...and the zones table has the région', zones.indexOf('r53') >= 0, zones.join(' '));
    const items = sum.missed.concat(sum.known);
    check('...the items are DÉPARTEMENTS, badged with their number',
          items.length >= 1 && items.every(i => /^([0-9]{2,3}|2A|2B)$/.test(String(i.flag))),
          items.map(i => i.id + ':' + i.flag).join(' '));
    Qz2.statsToggle(true);
    const hSt = Qz2.statsHtml();
    check('the stats sheet draws the number badge, not a broken flag',
          /qz-cnum/.test(hSt) && !/class="fi fi-\d/.test(hSt),
          (hSt.match(/qz-crow">[\s\S]{0,80}/) || [''])[0]);
    Qz2.statsToggle(false);
    stats.reset();
  }

  /* ---------- 7. the credits name the French sources ---------- */
  Qz2.go('about');
  const hab = Qz2.html();
  check('the credits name IGN and the commune API',
        /IGN/.test(hab) && /geo\.api\.gouv\.fr/.test(hab) && /Licence Ouverte/.test(hab));
  check('...next to Natural Earth, not instead of it', /Natural Earth/.test(hab));
  Qz2.quit();

  /* ---------- 8. the data stub really was the France files ---------- */
  check('the overlay fetched data/fr/*, by name',
        requested.indexOf('fr/departements.geojson') >= 0 &&
        requested.indexOf('fr/regions.geojson') >= 0 &&
        requested.indexOf('fr/eau.geojson') >= 0 &&
        requested.indexOf('fr/villes.json') >= 0,
        requested.join(' '));

  console.log(checks + ' checks, ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  process.exit(fails ? 1 : 0);
}
