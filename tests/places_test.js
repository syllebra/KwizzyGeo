/* CITY LAYER test: the point table, and the visibility rule that decides which
   dots are drawn.

   The rule that matters: on a cone-clipped projection (persp, ortho) the hidden
   cap projects ONTO the visible disc, so a city behind the world lands on a
   perfectly plausible screen position. Drawing it puts a dot in the middle of the
   ocean - and Nomascus in the South Atlantic is exactly the kind of thing nobody
   notices in a test that only checks counts. So visibility is checked against the
   geometry itself: a point is visible iff the cosine of its angular distance from
   the centre of projection is at least proj.clipCos. That is the definition; the
   implementation is only allowed to agree with it. */
const fs = require('fs');
const C = new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8') + '\nreturn CORE;')();
const DEG = Math.PI / 180;

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) { console.log('FAIL ' + name + (detail ? '  ' + detail : '')); fails++; }
}

/* ---------- 1. the data file ---------- */
const raw = JSON.parse(fs.readFileSync(__dirname + '/../data/places.json', 'utf8'));
check('places.json declares its fields', Array.isArray(raw.fields) && raw.fields.length > 0,
      (raw.fields || []).join(','));
const need = ['n', 'c', 'r', 'p', 'z', 'l', 'f', 'tz', 'lon', 'lat'];
for (const f of need) check('places.json has the field ' + f, raw.fields.indexOf(f) >= 0);
check('places.json carries a self-description', typeof raw.about === 'string' && raw.about.length > 40);

const ix = {};
raw.fields.forEach((f, i) => { ix[f] = i; });
const rows = raw.places || [];
check('the layer has the 10m populated places (7 342 in v5.1.2)', rows.length === 7342,
      rows.length + ' rows');
let badLen = 0, badCoord = 0, badZ = 0;
for (const r of rows) {
  if (r.length !== raw.fields.length) badLen++;
  const lon = r[ix.lon], lat = r[ix.lat];
  if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) badCoord++;
  if (!(r[ix.z] >= 0 && r[ix.z] <= 12)) badZ++;
}
check('every row has one value per declared field', badLen === 0, badLen + ' bad');
check('every coordinate is a lon/lat on the sphere', badCoord === 0, badCoord + ' bad');
check('every min_zoom is a plausible zoom', badZ === 0, badZ + ' bad');

/* population -99 is Natural Earth's "unknown", and the app must not print it */
const unknownPop = rows.filter(r => r[ix.p] === -99).length;
check('the unknown-population sentinel is present in the data (so the app must handle it)',
      unknownPop > 0, unknownPop + ' places at -99');

/* names must be non-empty: a dot with no label is a debugging artifact */
const noName = rows.filter(r => !r[ix.n] || !String(r[ix.n]).trim()).length;
check('every place has a name', noName === 0, noName + ' unnamed');

/* feature classes must all be ones the app knows how to label */
const known = { A0: 1, A0R: 1, A1: 1, A1R: 1, P: 1, S: 1, M: 1, H: 1 };
const oddF = [...new Set(rows.map(r => r[ix.f]).filter(f => !known[f]))];
check('every feature class is one the app can name', oddF.length === 0, oddF.join(',') || 'none');

/* ---------- 2. the visibility rule ---------- */
function truthVisible(lon, lat, lon0, lat0, proj) {
  if (proj.clip !== 'cone') return true;              /* a whole-world projection */
  const p = lat * DEG, l = lon * DEG, p0 = lat0 * DEG, l0 = lon0 * DEG;
  /* cos of the angular distance from the centre of projection */
  const cd = Math.sin(p) * Math.sin(p0) + Math.cos(p) * Math.cos(p0) * Math.cos(l - l0);
  return cd >= (proj.clipCos || 0) - 1e-12;
}

const samples = rows.map(r => [r[ix.lon], r[ix.lat], r[ix.n]]);
const cases = [['persp', 0, 0], ['persp', 155.8, 11.5], ['persp', -40, -70], ['persp', 0, 85],
               ['ortho', 0, 0], ['ortho', 179, -45], ['eckert4', 155.8, 11.5], ['equirect', 0, 0]];

for (const [id, lon0, lat0] of cases) {
  C.setProjection(id);
  const proj = C.CUR;
  const m = new Float64Array(9);
  C.rotMat(lon0, lat0, m);
  const out = [0, 0];
  let wrong = 0, first = null, vis = 0;
  for (const [lon, lat, n] of samples) {
    const drawn = C.projectRotLLVis(lon, lat, m, proj, out);
    const truth = truthVisible(lon, lat, lon0, lat0, proj);
    if (drawn !== truth) { wrong++; if (!first) first = n + ' @ ' + lon + ',' + lat; }
    if (drawn) vis += 1;
    if (!isFinite(out[0]) || !isFinite(out[1])) { wrong++; if (!first) first = n + ' non-finite plane'; }
  }
  check(id + ' @ ' + lon0 + ',' + lat0 + ': the visibility rule matches the geometry',
        wrong === 0, wrong + ' wrong' + (first ? ', first: ' + first : '') +
        ' (' + vis + '/' + samples.length + ' drawn)');
  if (proj.clip === 'cone') {
    check(id + ' @ ' + lon0 + ',' + lat0 + ': the hidden hemisphere is really hidden',
          vis > 0 && vis < samples.length, vis + ' of ' + samples.length + ' drawn');
  } else {
    check(id + ' @ ' + lon0 + ',' + lat0 + ': nothing is hidden on a world projection',
          vis === samples.length, vis + '/' + samples.length + ' drawn');
  }
}

/* the named cases: a place, its antipode, and the far side of the world */
C.setProjection('persp');
const m0 = new Float64Array(9);
C.rotMat(0, 0, m0);
const o = [0, 0];
check('Paris is drawn from a centre at 0,0', C.projectRotLLVis(2.35, 48.86, m0, C.CUR, o));
check("Paris's antipode is not", !C.projectRotLLVis(-177.65, -48.86, m0, C.CUR, o));
check('Sydney is not drawn from a centre at 0,0', !C.projectRotLLVis(151.2, -33.87, m0, C.CUR, o));
check('the antipode of the centre is not drawn', !C.projectRotLLVis(180, 0, m0, C.CUR, o));

/* ---------- 3. the LOD rule the app applies (MIN_ZOOM, verbatim + 0.35 slack) ---- */
const zOf = z => rows.filter(r => r[ix.z] <= z + 0.35).length;
check('the fitted world view (z 2) shows a handful of cities, not thousands',
      zOf(2) < 40, zOf(2) + ' at z 2');
check('a deep zoom shows the whole layer', zOf(9) === rows.length, zOf(9) + ' at z 9');
let mono = true;
for (let z = 1; z < 9.5; z += 0.5) if (zOf(z + 0.5) < zOf(z)) mono = false;
check('the city count only grows with zoom', mono);

console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
process.exit(fails ? 1 : 0);
