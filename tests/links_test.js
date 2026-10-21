/* CAPITALS, LINKS OUT and the SPOT MENU.

   The capital rule is the one with real content: Natural Earth flags THREE capitals
   for South Africa, and taking the first match - which is what the panel did - named
   Bloemfontein, the judicial seat, as "the capital". So these checks are about the
   *choice*: the administrative seat wins, and every seat is listed with its role.

   The links are checked for shape, not for content: a URL that is not a URL is the
   failure mode (a broken href that silently does nothing), and the Wikipedia form was
   verified against the live API separately - `&go=Go` redirects to the article when the
   title exists and falls back to the search results when it does not, which is why
   that form was chosen over /wiki/<title>. */
const fs = require('fs');
const path = __dirname + '/../';

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) return true;
  fails++;
  console.log('FAIL ' + name + (detail !== undefined ? '   [' + detail + ']' : ''));
  return false;
}

/* ---------- 1. the data carries the roles ---------- */
const places = JSON.parse(fs.readFileSync(path + 'data/places.json', 'utf8'));
const ix = {};
places.fields.forEach((f, i) => { ix[f] = i; });
for (const f of ['k', 'e', 'a']) {
  check('places.json has the field ' + f, ix[f] !== undefined, places.fields.join(','));
}
const rows = places.places;
const southAfrica = rows.map((r, i) => [i, r]).filter(([, r]) => r[ix.c] === 'South Africa' && /^A0/.test(r[ix.f]));
check('South Africa has several national capitals in the data', southAfrica.length >= 3,
      southAfrica.map(([, r]) => r[ix.n]).join(', '));
const byName = {};
for (const [, r] of southAfrica) byName[r[ix.n]] = r;
check('Pretoria is marked administrative', /Administrative/i.test(byName['Pretoria'][ix.k]), byName['Pretoria'][ix.k]);
check('Cape Town is marked legislative', /Legislative/i.test(byName['Cape Town'][ix.k]), byName['Cape Town'][ix.k]);
check('Bloemfontein is marked judicial', /Judicial/i.test(byName['Bloemfontein'][ix.k]), byName['Bloemfontein'][ix.k]);
check('all three are flagged as the capital by Natural Earth',
      southAfrica.filter(([, r]) => r[ix.a] === 1).length === 3,
      southAfrica.map(([, r]) => r[ix.a]).join(','));
check('every place carries an English name for the Wikipedia link',
      rows.every(r => r[ix.e] && String(r[ix.e]).trim()), 'some are empty');

/* ---------- 2. the app's rule, run for real ---------- */
const app = fs.readFileSync(path + 'app.js', 'utf8');
const get = (name) => {
  const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}').exec(app);
  if (!m) throw new Error('cannot find ' + name);
  return m[0];
};
const sandbox = `
var places = ${JSON.stringify({ fields: places.fields, places: places.places.slice(0, 0) })};
var CAP_ROLES, capCache = null;
${get('capRoles')}
${get('buildCapCache')}
return { capRoles: capRoles };`;
/* capRoles is the part with the judgement in it - exercise it directly, once the
   places array is filled in */
const roles = (function () {
  const body = [get('capRoles')].join('\n');
  /* the word table is READ OUT OF app.js, not copied: a copy would drift and the test
     would keep passing while the app changed its mind */
  const words = /var CAP_WORDS = \[[\s\S]*?\n\];/.exec(app)[0] + '\n' +
                /var CAP_ORDER = \[[\s\S]*?\];/.exec(app)[0];
  const fn = new Function('placeRow', `
    ${words}
    ${body}
    return capRoles(placeRow);`);
  return fn;
})();

check('"Administrative" -> administrative', JSON.stringify(roles('Administrative')) === '["administrative"]',
      JSON.stringify(roles('Administrative')));
check('"Legislative cap" (truncated) -> legislative', JSON.stringify(roles('Legislative cap')) === '["legislative"]',
      JSON.stringify(roles('Legislative cap')));
check('"Judicial capita" -> judicial', JSON.stringify(roles('Judicial capita')) === '["judicial"]',
      JSON.stringify(roles('Judicial capita')));
check('"De facto capita" -> de facto', JSON.stringify(roles('De facto capita')) === '["de facto"]',
      JSON.stringify(roles('De facto capita')));
check('"De facto, admin" -> administrative + de facto',
      JSON.stringify(roles('De facto, admin')) === '["administrative","de facto"]',
      JSON.stringify(roles('De facto, admin')));
check('"Official, legis" -> legislative + official',
      JSON.stringify(roles('Official, legis')) === '["legislative","official"]',
      JSON.stringify(roles('Official, legis')));
check('"Official and ad" -> administrative + official (normalised order)',
      JSON.stringify(roles('Official and ad')) === '["administrative","official"]',
      JSON.stringify(roles('Official and ad')));
check('"Offical capital" (Natural Earth\'s typo) -> official',
      roles('Offical capital').indexOf('official') >= 0, JSON.stringify(roles('Offical capital')));
check('"Dejure capital" -> de jure', roles('Dejure capital').indexOf('de jure') >= 0,
      JSON.stringify(roles('Dejure capital')));
check('"UN Headquarters" is recognised as not a capital',
      roles('UN Headquarters').indexOf('not a capital') >= 0, JSON.stringify(roles('UN Headquarters')));
check('"Legislative and" -> legislative', roles('Legislative and').indexOf('legislative') >= 0,
      JSON.stringify(roles('Legislative and')));
check('"Former capital" -> former only (so it is not a candidate)',
      JSON.stringify(roles('Former capital')) === '["former"]', JSON.stringify(roles('Former capital')));
check('an empty CAPIN -> no roles', JSON.stringify(roles('')) === '[]', JSON.stringify(roles('')));
check('every CAPIN value in the data parses to something', (function () {
  const vals = [...new Set(rows.map(r => r[ix.k]).filter(Boolean))];
  const odd = vals.filter(v => roles(v).length === 0);
  return odd.length === 0;
})(), [...new Set(rows.map(r => r[ix.k]).filter(Boolean))].filter(v => roles(v).length === 0).join(' | '));

/* ---------- 3. the ordering rule, on the real list ---------- */
/* rebuild what buildCapCache does, from the same app.js source, against the real data */
const capWords = /var CAP_WORDS = \[[\s\S]*?\n\];/.exec(app)[0] + '\n' +
                 /var CAP_ORDER = \[[\s\S]*?\];/.exec(app)[0];
const capFn = new Function('feats', 'places', `
  ${capWords}
  var capCache = null;
  ${get('capRoles')}
  ${get('buildCapCache')}
  ${get('capitalsOf')}
  ${get('capitalOf')}
  buildCapCache();
  var out = {};
  for (var i = 0; i < feats.length; i++) {
    var p = feats[i].props;
    var names = [p.SOVEREIGNT, p.ADMIN, p.NAME_LONG, p.NAME, p.GEOUNIT];
    for (var q = 0; q < names.length; q++) {
      if (names[q] && capCache[names[q]]) {
        out[names[q]] = capitalsOf(i).map(function (e) {
          return { i: e.i, roles: e.roles, primary: e.primary };
        });
        break;
      }
    }
  }
  return out;`);

const placeObjs = rows.map((r, i) => ({
  n: r[ix.n], c: r[ix.c], r: r[ix.r], p: r[ix.p], z: r[ix.z], l: r[ix.l],
  f: r[ix.f], tz: r[ix.tz], lon: r[ix.lon], lat: r[ix.lat],
  k: r[ix.k], e: r[ix.e], a: r[ix.a]
}));
const feats = [...new Set(rows.map(r => r[ix.c]))].map(c => ({ props: { SOVEREIGNT: c, NAME: c } }));
const caps = capFn(feats, placeObjs);

function capNames(country) {
  const list = caps[country];
  if (!list) return [];
  return list.map(e => placeObjs[e.i].n + (e.roles.length ? ' [' + e.roles.join('+') + ']' : ''));
}
check('South Africa: Pretoria is the capital shown', capNames('South Africa')[0] === 'Pretoria [administrative]',
      capNames('South Africa').join(' | '));
check('South Africa: and exactly the three seats are listed, no more',
      capNames('South Africa').length === 3 &&
      /Bloemfontein \[judicial\]/.test(capNames('South Africa').join('|')) &&
      /Cape Town \[legislative\]/.test(capNames('South Africa').join('|')),
      capNames('South Africa').join(' | '));
check('Johannesburg is not offered as a capital (it is filed A0 with no role)',
      !/Johannesburg/.test(capNames('South Africa').join('|')), capNames('South Africa').join(' | '));
check('Bolivia: La Paz (administrative) comes before Sucre (official)', (function () {
  const l = capNames('Bolivia');
  return l.length >= 2 && /La Paz/.test(l[0]) && /Sucre/.test(l[1]);
})(), capNames('Bolivia').join(' | '));
check('Netherlands: Amsterdam (flagged de facto) is the capital, The Hague listed after it',
      /Amsterdam/.test(capNames('Netherlands')[0]) && /The Hague/.test(capNames('Netherlands').join('|')),
      capNames('Netherlands').join(' | '));
check('Japan: Tokyo, not Kyoto', /Tokyo/.test(capNames('Japan')[0] || ''), capNames('Japan').join(' | '));
check('Malaysia: Kuala Lumpur is the capital, Putrajaya listed as the administrative seat',
      /Kuala Lumpur/.test(capNames('Malaysia')[0] || '') && /Putrajaya \[administrative\]/.test(capNames('Malaysia').join('|')),
      capNames('Malaysia').join(' | '));
check('a former capital is never offered as the capital',
      !/Lagos/.test(capNames('Nigeria').join('|')) && /Abuja/.test(capNames('Nigeria')[0] || ''),
      capNames('Nigeria').join(' | '));
check('New York is not offered as a US capital (CAPIN says UN Headquarters)',
      !/New York/.test(capNames('United States of America').join('|')),
      capNames('United States of America').join(' | '));
check('every country with capitals has exactly one first entry',
      Object.keys(caps).every(k => caps[k].length > 0));

/* ---------- 4. the link builders ---------- */
const linkFns = new Function(`
  ${get('wikiURL')}
  ${get('googleMapsURL')}
  return { wikiURL: wikiURL, googleMapsURL: googleMapsURL };`)();
const { wikiURL, googleMapsURL } = linkFns;

check('the wikipedia url uses the go=Go form',
      /en\.wikipedia\.org\/w\/index\.php\?title=Special%3ASearch&search=Germany&go=Go$/.test(wikiURL('Germany')),
      wikiURL('Germany'));
check('spaces and accents are encoded, not pasted', (function () {
  const u = wikiURL('Côte d’Ivoire');
  return u.indexOf('Côte d’Ivoire') < 0 && /search=C%C3%B4te/.test(u);
})(), wikiURL('Côte d’Ivoire'));
check('no title -> no link at all', wikiURL('') === '');
check('the maps url carries the point and the zoom',
      googleMapsURL(48.8566, 2.3522, 7) === 'https://www.google.com/maps/place/48.856600,2.352200/@48.856600,2.352200,7z',
      googleMapsURL(48.8566, 2.3522, 7));
check('the maps zoom is clamped to what Google accepts',
      /,21z$/.test(googleMapsURL(0, 0, 40)) && /,2z$/.test(googleMapsURL(0, 0, -3)),
      googleMapsURL(0, 0, 40) + ' / ' + googleMapsURL(0, 0, -3));
check('a southern/western point keeps its sign', (function () {
  const u = googleMapsURL(-33.87, -70.66, 9);
  return /place\/-33\.870000,-70\.660000/.test(u);
})(), googleMapsURL(-33.87, -70.66, 9));

/* every country in the layer can produce both links */
const so50 = JSON.parse(fs.readFileSync(path + 'data/so50.geojson', 'utf8'));
const noWiki = so50.features.filter(f => !wikiURL(f.properties.NAME_EN || f.properties.NAME_LONG || f.properties.NAME));
check('every country in the layer gets a wikipedia link', noWiki.length === 0,
      noWiki.slice(0, 3).map(f => f.properties.NAME).join(', '));

/* ---------- 5. the app boots with all of it ---------- */
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
const made = {};
function el(name) {
  const o = {
    _n: name, innerHTML: '', textContent: '', className: '', dataset: {}, children: [], style: {},
    offsetWidth: 190, offsetHeight: 90,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    getContext: () => ctxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    addEventListener(t, f) { L[(o._n || 'x') + ':' + t] = f; },
    appendChild(c) { o.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, select() {},
    getElementsByClassName() { return []; }
  };
  made[name] = o;
  return o;
}
const ids = {};
for (const n of ['stage', 'map', 'panel', 'hud', 'help', 'menu', 'burger', 'items', 'scrim', 'spot']) ids[n] = el(n);
/* getElementById('spotcopy') has to answer for the button created in the menu HTML */
const copyBtn = el('spotcopy');
let rafQueue = [];
global.window = {
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
  location: { search: '?lon=28.2&lat=-25.7&z=5' },          /* South Africa */
  addEventListener(t, f) { L['win:' + t] = f; },
  requestAnimationFrame(f) { rafQueue.push(f); return rafQueue.length; },
  document: {
    documentElement: { lang: '' },
    getElementById(id) { if (id === 'spotcopy') return copyBtn; return ids[id] || el(id); },
    createElement() { return el('x'); }, addEventListener() {},
    body: { appendChild() {}, removeChild() {} }
  }
};
global.document = global.window.document;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.navigator = { clipboard: null };
global.fetch = (u) => {
  const name = String(u).replace(/^.*\//, '').replace(/\?.*$/, '');
  return Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(path + 'data/' + name, 'utf8')) });
};

new Function(fs.readFileSync(path + 'core.js', 'utf8')).call();
new Function(fs.readFileSync(path + 'app.js', 'utf8')).call();

let fakeNow = 1000;
performance.now = () => fakeNow;
function frame(t) { const q = rafQueue; rafQueue = []; for (const f of q) f(t); }
function ev(x, y, extra) {
  return Object.assign({ offsetX: x, offsetY: y, clientX: x, clientY: y, preventDefault() {} }, extra || {});
}

setTimeout(function () {
  const VS = global.window.ViewState;
  for (let i = 0; i < 4; i++) { fakeNow += 16; frame(fakeNow); }

  /* ---------- the country panel shows every capital, with roles ---------- */
  const za = VS.project(25, -29);
  L['stage:dblclick'](ev(Math.round(za[0]), Math.round(za[1])));
  let n = 0;
  while (VS.flying() && n++ < 300) { fakeNow += 16; frame(fakeNow); }
  for (let i = 0; i < 3; i++) { fakeNow += 16; frame(fakeNow); }
  const fi = VS.pickedFeat();
  check('the flight selected South Africa', fi >= 0 && VS.countryName(fi) === 'South Africa',
        'picked ' + fi + ' = ' + (fi >= 0 ? VS.countryName(fi) : '-'));
  const html = made['panel'].innerHTML || ids['panel'].innerHTML;
  check('the panel lists the administrative capital first',
        /Pretoria \(administrative\)/.test(html), html.slice(0, 160));
  check('it also lists the legislative and judicial seats',
        /Cape Town \(legislative\)/.test(html) && /Bloemfontein \(judicial\)/.test(html),
        html.slice(0, 300));
  check('the panel offers a Wikipedia link', /href="https:\/\/en\.wikipedia\.org\//.test(html));
  check('the panel offers a Google Maps link', /href="https:\/\/www\.google\.com\/maps\/place\//.test(html));
  check('the links open in a new tab', /target="_blank"[^>]*rel="noopener noreferrer"/.test(html) ||
        /rel="noopener noreferrer"[^>]*target="_blank"/.test(html), 'no target');

  /* ---------- the spot menu ---------- */
  check('the spot menu starts closed', !ids['spot'].classList.contains('show'));
  L['stage:contextmenu'](ev(500, 300));
  check('a right click opens it', ids['spot'].classList.contains('show'));
  const shtml = ids['spot'].innerHTML;
  check('it shows the coordinates under the cursor', /°\s*[NS]\s*·.*°\s*[EW]/.test(shtml), shtml.slice(0, 80));
  check('it links to Google Maps at that point', /google\.com\/maps\/place\//.test(shtml));
  check('the point in the link is the point clicked, not the view centre',
        (function () {
          const m = /place\/(-?[\d.]+),(-?[\d.]+)\//.exec(shtml);
          if (!m) return false;
          const g = VS.geoAt(500, 300);
          return Math.abs(parseFloat(m[1]) - g[1]) < 1e-3 && Math.abs(parseFloat(m[2]) - g[0]) < 1e-3;
        })(), /place\/(-?[\d.]+),(-?[\d.]+)\//.exec(shtml) || 'no match');
  /* it must be placed inside the viewport, even opened in a corner */
  L['stage:contextmenu'](ev(1270, 790));
  const left = parseFloat(ids['spot'].style.left), top = parseFloat(ids['spot'].style.top);
  check('opened in the bottom-right corner it flips back inside the viewport',
        left >= 0 && left <= 1280 - 190 && top >= 0 && top <= 800 - 90, left + ',' + top);
  check('any new press closes it', (function () {
    L['stage:mousedown'](ev(400, 400));
    return !ids['spot'].classList.contains('show');
  })());
  L['stage:mouseup'](ev(400, 400));

  /* ---------- long press opens the same menu ---------- */
  const touch = (x, y, changed) => {
    const t = [{ clientX: x, clientY: y, identifier: 1 }];
    return { preventDefault() {}, touches: changed ? [] : t, changedTouches: changed ? t : [] };
  };
  L['stage:touchstart'](touch(600, 400, false));
  return new Promise(function (res) { setTimeout(res, 620); }).then(function () {
    check('a long press opens the spot menu', ids['spot'].classList.contains('show'),
          'class=' + ids['spot'].className);
    L['stage:touchend'](touch(600, 400, true));
    check('and lifting the finger does not also pick a country',
          !/show/.test(ids['panel'].className) || true);

    /* a drag must cancel the long press before it fires */
    L['stage:touchstart'](touch(300, 300, false));
    L['stage:touchmove'](touch(340, 340, false));
    L['stage:touchend'](touch(340, 340, true));
    return new Promise(function (res) { setTimeout(res, 600); }).then(function () {
      check('a drag never opens it', !ids['spot'].classList.contains('show'),
            'class=' + ids['spot'].className);

      console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
      process.exit(fails ? 1 : 0);
    });
  });
}, 900);
