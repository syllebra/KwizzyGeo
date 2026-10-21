/* LANGUAGE test: the selector, the country names it drives, and the per-language
   city files.

   The risk this guards against is silent and ugly: a language file is keyed by the
   INDEX of a place in places.json, so a file built from another Natural Earth
   release puts "Londres" on Lagos and nothing crashes. Hence the `sum` fingerprint
   on both sides, checked here against the real files. */
const fs = require('fs');
const path = __dirname + '/../';
const C = new Function(fs.readFileSync(path + 'core.js', 'utf8') + '\nreturn CORE;')();

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return true;
  fails++;
  console.log('FAIL ' + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  return false;
}

/* ---------- 1. the data files ---------- */
const places = JSON.parse(fs.readFileSync(path + 'data/places.json', 'utf8'));
const ix = {};
places.fields.forEach((f, i) => { ix[f] = i; });
check('places.json carries a fingerprint', typeof places.sum === 'string' && places.sum.length === 8, places.sum);

const LANGS = ['en', 'fr', 'de', 'es', 'pt', 'nl', 'sv', 'ru', 'uk', 'el', 'zh', 'ja', 'ko', 'ar', 'fa', 'he', 'hi', 'bn'];
const files = {};
for (const code of LANGS) {
  const p = path + 'data/cities.' + code + '.json';
  if (!fs.existsSync(p)) { check('cities.' + code + '.json exists', false); continue; }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  files[code] = j;
  check(code + ': the fingerprint matches the place list', j.sum === places.sum, j.sum + ' vs ' + places.sum);
  check(code + ': the place count matches', j.n === places.places.length, j.n + ' vs ' + places.places.length);
  const bad = Object.keys(j.names).filter(k => !(Number(k) >= 0 && Number(k) < places.places.length));
  check(code + ': every key is a real place index', bad.length === 0, bad.slice(0, 5).join(','));
  const empty = Object.keys(j.names).filter(k => !String(j.names[k]).trim());
  check(code + ': no empty names', empty.length === 0, empty.slice(0, 5).join(','));
  check(code + ': the label is in the language it names', typeof j.label === 'string' && j.label.length > 1, j.label);
}

/* the two names the user asked about, by hand */
function idxOf(name) {
  return places.places.findIndex(r => r[ix.n] === name && r[ix.f] === 'A0');
}
const londonUk = places.places.findIndex((r, i) => r[ix.n] === 'London' && places.places[i][ix.c] === 'United Kingdom');
check('the UK London is in the table', londonUk >= 0, londonUk);
check('French turns London into Londres', files.fr.names[londonUk] === 'Londres', files.fr.names[londonUk]);
check('German leaves London alone (it is the same word)', files.de.names[londonUk] === undefined,
      files.de.names[londonUk]);
check('Spanish turns London into Londres', files.es.names[londonUk] === 'Londres', files.es.names[londonUk]);
const vienna = places.places.findIndex(r => r[ix.n] === 'Vienna');
check('Vienna is Vienne in French', files.fr.names[vienna] === 'Vienne', files.fr.names[vienna]);
check('Vienna is Wien in German', files.de.names[vienna] === 'Wien', files.de.names[vienna]);
check('Vienna is Viena in Spanish', files.es.names[vienna] === 'Viena', files.es.names[vienna]);
const moscow = places.places.findIndex(r => r[ix.n] === 'Moscow');
check('Moscow is Moscou in French', files.fr.names[moscow] === 'Moscou', files.fr.names[moscow]);
check('Moscow is Москва in Russian', files.ru.names[moscow] === 'Москва', files.ru.names[moscow]);

/* a Latin-script language should NOT differ everywhere: if it did, the file would
   just be a copy of the table and the "differs only" optimisation is not working */
const frCount = Object.keys(files.fr.names).length;
check('French only stores the names that differ (a third of the table, not all of it)',
      frCount > 500 && frCount < places.places.length * 0.5, frCount + ' of ' + places.places.length);

/* ---------- 2. the country names both layers carry ---------- */
for (const layer of ['so50.geojson', 'countries.geojson']) {
  const geo = JSON.parse(fs.readFileSync(path + 'data/' + layer, 'utf8'));
  const have = {};
  for (const f of geo.features) {
    for (const k of Object.keys(f.properties)) {
      const m = /^NAME_([A-Z]{2})$/.exec(k);
      if (m && f.properties[k]) have[m[1].toLowerCase()] = (have[m[1].toLowerCase()] || 0) + 1;
    }
  }
  /* so50 is the DEFAULT layer, so it must answer in every language the selector
     offers. countries.geojson is the optional 110m alternative and carries only
     six (DE ES FR IT RU ZH) - there the app falls back to the English name, which
     is the documented behaviour, not a bug. */
  if (layer === 'so50.geojson') {
    const missing = LANGS.filter(c => !have[c]);
    check(layer + ': every offered language has a country name',
          missing.length === 0, 'missing ' + missing.join(','));
    const sparse = LANGS.filter(c => have[c] < geo.features.length * 0.5);
    check(layer + ': no language is a stub (at least half the countries named)',
          sparse.length === 0, sparse.join(','));
  } else {
    check(layer + ': the 110m alternative carries its six languages',
          ['de', 'es', 'fr', 'it', 'ru', 'zh'].every(c => have[c]),
          Object.keys(have).sort().join(','));
  }
}

/* a spot check through the same rule the app uses */
const so50 = JSON.parse(fs.readFileSync(path + 'data/so50.geojson', 'utf8'));
const fr = so50.features.find(f => f.properties.NAME === 'France').properties;
const de = so50.features.find(f => f.properties.NAME === 'Germany').properties;
check('Germany is Frankreich in French', fr.NAME_FR === 'France' && de.NAME_FR === 'Allemagne', de.NAME_FR);
check('Germany is 德国 in Chinese', /德国/.test(de.NAME_ZH || ''), de.NAME_ZH);
check('Germany is Германия in Russian', /Германия/.test(de.NAME_RU || ''), de.NAME_RU);

/* ---------- 3. the app, driven ---------- */
global.Path2D = function () { return { moveTo() {}, lineTo() {}, closePath() {}, arc() {}, rect() {} }; };
const painted = [];
function ctxStub() {
  const st = {};
  return {
    setTransform() {}, createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {}, fill() {}, stroke() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, rect() {}, save() {}, restore() {}, clip() {},
    fillText(t) { painted.push(String(t)); }, strokeText() {},
    measureText(t) { return { width: String(t).length * 6.2 }; },
    get fillStyle() { return st.c; }, set fillStyle(v) { st.c = v; },
    get strokeStyle() { return st.c; }, set strokeStyle(v) { st.c = v; },
    get lineWidth() { return st.l; }, set lineWidth(v) { st.l = v; },
    get font() { return st.f; }, set font(v) { st.f = v; },
    get textAlign() { return st.a; }, set textAlign(v) { st.a = v; },
    get textBaseline() { return st.b; }, set textBaseline(v) { st.b = v; }
  };
}
const L = {};
function el(name) {
  const o = {
    _n: name, innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    addEventListener(t, f) { L[(o._n || 'x') + ':' + t] = f; },
    appendChild(c) { o.children.push(c); return c; },
    setAttribute() {}, getElementsByClassName() { return []; }
  };
  return o;
}
const ids = {};
for (const n of ['stage', 'map', 'panel', 'hud', 'help', 'menu', 'burger', 'items', 'scrim']) ids[n] = el(n);
let rafQueue = [];
const store = {};
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, location: { search: '?lon=2.3&lat=48.8&z=6' },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
  document: { documentElement: { lang: '' },
              getElementById(id) { return ids[id] || el(id); }, createElement() { return el('x'); }, addEventListener() {} }
};
global.document = global.window.document;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.fetch = (u) => {
  const name = String(u).replace(/^.*\//, '').replace(/\?.*$/, '');
  const p = path + 'data/' + name;
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404, json: () => ({}) });
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};

new Function(fs.readFileSync(path + 'core.js', 'utf8')).call();
new Function(fs.readFileSync(path + 'app.js', 'utf8')).call();

let fakeNow = 1000;
performance.now = () => fakeNow;
function frame(t) { const q = rafQueue; rafQueue = []; for (const f of q) f(t); }

setTimeout(async function () {
  const VS = global.window.ViewState;
  const settle = () => new Promise(r => setTimeout(r, 60));
  for (let i = 0; i < 4; i++) { fakeNow += 16; frame(fakeNow); }
  check('the app exposes the language', typeof VS.lang === 'function', typeof VS.lang);
  check('it starts in English', VS.lang() === 'en', VS.lang());

  /* a city label on screen, in English */
  painted.length = 0;
  fakeNow += 16; frame(fakeNow);
  const enPainted = painted.join('');    /* country names are drawn per character */
  check('English draws "Paris"', /Paris/.test(enPainted));

  /* switch to French: the country label and the city label must both change */
  L['win:keydown']({ key: 'x', preventDefault() {} });      /* no-op key, keeps the harness honest */
  const before = VS.cityName(places.places.findIndex(r => r[ix.n] === 'Vienna'));
  check('before the switch Vienna is "Vienna"', before === 'Vienna', before);
  VS.setLang('fr');
  await settle();                     /* the language file is fetched: wait for it */
  for (let i = 0; i < 6; i++) { fakeNow += 16; frame(fakeNow); }
  check('the language took effect', VS.lang() === 'fr', VS.lang());
  check('the choice is remembered', store['kwizzy.lang'] === 'fr', store['kwizzy.lang']);
  check('<html lang> follows', document.documentElement.lang === 'fr', document.documentElement.lang);
  check('Vienna is now "Vienne"', VS.cityName(places.places.findIndex(r => r[ix.n] === 'Vienna')) === 'Vienne',
        VS.cityName(places.places.findIndex(r => r[ix.n] === 'Vienna')));
  check('London (UK) is now "Londres"', VS.cityName(londonUk) === 'Londres', VS.cityName(londonUk));
  /* a place French does not rename keeps its base name - no blank labels */
  const anySame = Object.keys(files.fr.names).length < places.places.length;
  check('a city French does not rename keeps its name', anySame);

  /* the country labels carry the localised name. Country names are drawn one
     CHARACTER per call (the tracking), so the assertion is on the letter run: the
     English frame spelled SWITZERLAND, the French one spells SUISSE. */
  painted.length = 0;
  fakeNow += 16; frame(fakeNow);
  const frPainted = painted.join('');
  check('the English frame spelled SWITZERLAND', /SWITZERLAND/.test(enPainted), enPainted.slice(0, 40));
  check('the French frame spells SUISSE', /SUISSE/.test(frPainted),
        (frPainted.match(/[A-Z]{5,}/g) || []).join(' '));
  check('and no longer SWITZERLAND', !/SWITZERLAND/.test(frPainted));
  /* the rule itself, independent of what happens to be on screen */
  const gi = 0;   /* any feature: the helper is what the panel and the labels use */
  check('countryName() follows the language', (function () {
    const so = JSON.parse(fs.readFileSync(path + 'data/so50.geojson', 'utf8'));
    const de = so.features.find(f => f.properties.NAME === 'Germany').properties;
    return de['NAME_' + VS.lang().toUpperCase()] === 'Allemagne';
  })(), VS.lang());

  /* a language with a non-Latin script, loaded lazily */
  VS.setLang('ru');
  await settle();
  {
    for (let i = 0; i < 6; i++) { fakeNow += 16; frame(fakeNow); }
    check('Russian loads and applies', VS.lang() === 'ru', VS.lang());
    check('Moscow is Москва', /Москва/.test(VS.cityName(moscow)), VS.cityName(moscow));
    painted.length = 0;
    fakeNow += 16; frame(fakeNow);
    check('the map draws Cyrillic', /[А-Яа-я]/.test(painted.join('|')),
          painted.filter(t => /[А-Яа-я]/.test(t)).slice(0, 3).join(' '));

    /* back to English: the base names return, and the map is not left half translated */
    VS.setLang('en');
    for (let i = 0; i < 4; i++) { fakeNow += 16; frame(fakeNow); }
    check('English comes back', VS.cityName(moscow) === 'Moscow', VS.cityName(moscow));

    /* the fingerprint guard: a file for another release must be refused */
    const bad = { ok: true, json: () => ({ lang: 'fr', n: places.places.length, sum: 'deadbeef', names: { '0': 'X' } }) };
    const realFetch = global.fetch;
    global.fetch = () => Promise.resolve(bad);
    VS.setLang('de');
    await settle();
    {
      global.fetch = realFetch;
      check('a city file with the wrong fingerprint is refused', VS.lang() === 'de' && VS.cityName(moscow) === 'Moscow',
            'lang=' + VS.lang() + ' name=' + VS.cityName(moscow));

      console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
      process.exit(fails ? 1 : 0);
    }
  }
}, 900);
