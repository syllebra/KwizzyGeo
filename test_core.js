/* node unit tests for core.js + geojson sanity */
const fs = require('fs');
global.window = undefined;
const src = fs.readFileSync(__dirname + '/core.js', 'utf8');
const m = new Function(src + '\nreturn CORE;');
const C = m();

function close(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }
let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }

/* 1. projection landmarks */
const e = C.project(180, 0), w = C.project(-180, 0);
check('equator width = 8*PI/S', close(e[0] - w[0], 8 * Math.PI / C.S, 1e-9));
const ne = C.project(180, 90), nw = C.project(-180, 90);
check('polar line = half equator', close((ne[0] - nw[0]) / (e[0] - w[0]), 0.5, 1e-9));
check('poles symmetric', close(C.project(0, 90)[1], -C.project(0, -90)[1], 1e-12) && C.project(0, 90)[1] > 0);
check('origin = 0,0', C.project(0, 0)[0] === 0 && C.project(0, 0)[1] === 0);

/* 2. inverse round trip */
let worst = 0;
for (const lon of [-179.9, -120, -0.5, 0, 47.25, 179.5]) {
  for (const lat of [-89.5, -60, -17.25, 0, 33.3, 83.65]) {
    const [x, y] = C.project(lon, lat);
    const [lo2, la2] = C.unproject(x, y);
    worst = Math.max(worst, Math.max(Math.abs(lo2 - lon), Math.abs(la2 - lat)));
  }
}
check('inverse roundtrip < 1e-9 deg', worst < 1e-9);

/* 3. equal-area property: known countries vs reference values */
const geo = JSON.parse(fs.readFileSync(__dirname + '/countries.geojson', 'utf8'));
const feats = C.buildFeatures(geo, 0.2);
check('feature count 177', feats.length === 177);
const truth = {
  France: 643801, Brazil: 8515770, Russia: 17098242, Australia: 7741662,
  Canada: 9984670, Greenland: 2166086, USA: null
};
let maxRatio = 0, minRatio = 1;
for (const ft of feats) {
  const n = ft.props.NAME;
  if (truth[n] == null) continue;
  const km2 = ft.areaSr * C.SR_TO_KM2;
  const r = km2 / truth[n];
  maxRatio = Math.max(maxRatio, r); minRatio = Math.min(minRatio, r);
  console.log(`   area ${n}: ${Math.round(km2).toLocaleString()} km^2 (ref ${truth[n].toLocaleString()}, ratio ${r.toFixed(3)})`);
}
check('area ratios within 5%', minRatio > 0.95 && maxRatio < 1.05);

/* 4. point -> country, real coordinates */
const pts = [
  ['Paris', 2.3522, 48.8575, 'France'],
  ['Nairobi', 36.8219, -1.2626, 'Kenya'],
  ['Wellington', 174.766, -41.29, 'New Zealand'],
  ['Ushuaia', -68.314, -54.687, 'Argentina'],
  ['Reykjavik', -21.94, 64.15, 'Iceland'],
  ['Suva', 178.467, -18.12, 'Fiji'],
  ['Jakarta', 106.845, -6.208, 'Indonesia'],
  ['Greenwich', 0.0, 51.47, 'United Kingdom'],
  ['Rome -> Italy', 12.4555, 41.9024, 'Italy'],
  ['Gulf of Guinea', 0, 0, null],
  ['South Atlantic', -30, -30, null],
  ['Antarctica ice', 35.88, -79.84, 'Antarctica'], ['Pacific', -170, 0, null],
];
for (const [name, lon, lat, want] of pts) {
  const [x, y] = C.project(lon, lat);
  const hits = C.hitTest(feats, x, y);
  const got = hits.length ? feats[hits[0]].props.NAME : null;
  if (want === null) check(name + ' -> no country', hits.length === 0);
  else check(name + ' -> ' + want, got === want);
}

/* 5. perf */
const t0 = Date.now();
for (let i = 0; i < 20000; i++) {
  const x = (Math.random() * 2 - 1) * 2.653, y = (Math.random() * 2 - 1) * 1.3265;
  C.hitTest(feats, x, y);
}
const dt = (Date.now() - t0) / 20000;
console.log(`hitTest avg: ${dt.toFixed(4)} ms  -> ${Math.round(1000 / dt)} picks/s`);
check('hitTest < 1 ms', dt < 1);

const verts = feats.reduce((a, ft) => a + ft.rings.reduce((s, r) => s + r.pts.length / 2, 0), 0);
console.log(`densified vertices total (step 0.2): ${verts}`);
check('vertex budget < 250k', verts < 250000);

/* 6. LOD layer: the 50m sovereignty file, drawn through the level ladder */
const g50 = JSON.parse(fs.readFileSync(__dirname + '/so50.geojson', 'utf8'));
const lods = C.buildFeaturesLOD(g50, 0.2);
check('50m features = 201', lods.length === 201);
let dens = 0; for (const ft of lods) for (const rg of ft.rings) dens += rg.pts.length / 2;
console.log(`50m densified verts: ${dens}`);
check('50m vertex budget < 200k', dens < 200000);
const lv50 = lods.reduce((a, ft) => a + ft.rings.length, 0);
console.log(`50m rings: ${lv50}`);
check('50m rings = 1628', lv50 === 1628);

/* containment must agree with the full-detail 110m layer on shared ground */
const pts50 = [['Paris', 2.352, 48.857, 'France'], ['Nuuk inland', -45, 66, 'Denmark'],
               ['Longyearbyen', 15.64, 78.22, 'Norway'], ['Beijing', 116.4, 39.9, 'China'],
               ['Wellington', 174.76, -41.3, 'New Zealand'], ['Jerusalem', 35.2, 31.78, 'Israel'],
               ['Nuuk sea', -40, 60, null], ['Sahel', 20, 20, 'Chad']];
for (const [name, lon, lat, want] of pts50) {
  const [x, y] = C.project(lon, lat);
  /* coarse (whole world) and fine (deep zoom) must agree */
  const coarse = C.hitTestLOD(lods, x, y, 255);
  const fine = C.hitTestLOD(lods, x, y, 16000);
  const n = coarse.length;
  check(name + ': coarse == fine hit count', n === fine.length);
  const got = n ? lods[coarse[0]].props.NAME : null;
  const best = coarse.reduce((a, b) => lods[a].areaSr < lods[b].areaSr ? a : b, coarse[0]);
  if (want === null) check(name + ' -> no country', n === 0);
  else check(name + ' -> ' + want, lods[best].props.NAME === want || lods[best].props.NAME_LONG === want);
}

/* Laziness is checked on a FRESH build: by this point the picking tests above
   have legitimately asked for levels on `lods`, which is the whole point. */
{
  const fresh = C.buildFeaturesLOD(g50, 0.2);
  let upFront = 0;
  for (const ft of fresh) for (const rg of ft.rings) upFront += rg.levels ? rg.levels.filter(Boolean).length : 0;
  check('the LOD ladder starts unbuilt (lazy)', upFront === 0, upFront + ' levels pre-built');
}

/* ringFlat: decimating must not change the vertex count budget at full zoom */
const rg0 = lods[0].rings[0];
const full = C.ringFlat(rg0, 65000, 0.7), coarse0 = C.ringFlat(rg0, 255, 0.7);
check('ringFlat full = raw pts', full.length === rg0.pts.length);
check('ringFlat coarse < full', coarse0.length <= full.length);
/* The ladder is built ON DEMAND (ensureLevel), so measure it the way the app
   reaches it: ask for every level once, then count. Before that, nothing but the
   levels actually read may be in memory. */
let idxMB = 0;
for (const ft of lods) for (const rg of ft.rings) for (let t = 0; t < C.LOD_U.length; t++) idxMB += C.ensureLevel(rg, t).length;
check('ensureLevel is idempotent', C.ensureLevel(lods[0].rings[0], 0) === C.ensureLevel(lods[0].rings[0], 0));
console.log(`LOD index ints (all levels, once built): ${idxMB} (~${(idxMB * 4 / 1048576).toFixed(1)} MB)`);
check('full LOD index memory < 12 MB', idxMB * 4 < 12 * 1048576);

/* 7. horizon clip: an orthographic view must not paint the hidden hemisphere.
   The check is the only meaningful one - compare what is PAINTED against the
   source data: invert each pixel (front branch), ask the data whether that point
   is land, and look for pixels painted where there is sea (a back face showing
   through) or painted twice (a fold). */
{
  const g = JSON.parse(fs.readFileSync(__dirname + '/countries.geojson', 'utf8'));
  const f2 = C.buildFeaturesLOD(g, 0.2, true);
  C.prepareXYZ(f2);
  const ref2 = C.buildFeaturesLOD(g, 0.2, false);
  const proj = C.PROJ.ortho;
  const S = 90;                                   /* coarse grid: fast */
  const kk = S / 2 * 0.98;
  let worstPos = 0, worstTwice = 0;
  for (const cen of [[0, 0], [20, 45], [-95, 48], [178, -12], [0, -90]]) {
    C.recenterAll(f2, cen[0], cen[1], proj, 0.2, C.LOD_U, C.levelForK(kk, 0.7));
    /* even-odd scanline fill of the drawn pieces, counting covers */
    const cov = new Int16Array(S * S), edges = [];
    for (const ft of f2) for (const rg of ft.rings) for (const p of rg.pieces) {
      const n = p.n, b = p.pts;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = S / 2 + b[i * 2] * kk, y1 = S / 2 - b[i * 2 + 1] * kk;
        const x2 = S / 2 + b[j * 2] * kk, y2 = S / 2 - b[j * 2 + 1] * kk;
        if (y1 !== y2) edges.push([x1, y1, x2, y2]);
      }
    }
    for (let y = 0; y < S; y++) {
      const yc = y + 0.5, xs = [];
      for (const e of edges) {
        if ((e[1] <= yc && e[3] > yc) || (e[3] <= yc && e[1] > yc)) {
          xs.push([e[0] + (e[2] - e[0]) * (yc - e[1]) / (e[3] - e[1]), e[3] > e[1] ? 1 : -1]);
        }
      }
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i][1];
        if (w !== 0) {
          const a = Math.max(0, Math.ceil(xs[i][0] - 0.5)), b2 = Math.min(S - 1, Math.floor(xs[i + 1][0] - 0.5));
          for (let x = a; x <= b2; x++) cov[y * S + x]++;
        }
      }
    }
    let landPx = 0, falsePos = 0, twice = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (cov[i] > 1) twice++;
      const px = (x + 0.5 - S / 2) / kk, py = (S / 2 - (y + 0.5)) / kk;
      let ll = proj.inv(px, py);
      if (ll) {
        const rt = [0, 0];
        proj.fwd(ll[0], ll[1], rt);
        if (Math.hypot(rt[0] - px, rt[1] - py) > 1e-6) ll = null;   /* outside the disc */
      }
      if (!ll) continue;
      const gl = C.unrot(cen[0], cen[1], ll[0], ll[1]);
      const q = C.project(gl[0], gl[1]);
      const land = C.hitTestLOD(ref2, q[0], q[1], 400).length > 0;
      if (land) landPx++;
      else if (cov[i] > 0) falsePos++;
    }
    worstPos = Math.max(worstPos, landPx ? falsePos / landPx : 0);
    worstTwice = Math.max(worstTwice, twice);
  }
  console.log(`ortho back-face audit: worst painted-where-sea ${(worstPos * 100).toFixed(1)}% of land, painted twice ${worstTwice} px`);
  check('ortho draws no hidden-hemisphere land (< 3% of land pixels)', worstPos < 0.03);
  check('ortho paints no pixel twice', worstTwice === 0);
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
