/* Does the projected view draw exactly the visible land?
   Ground truth per pixel: invert the projection (FRONT branch only) -> rotated
   lon/lat -> geographic, then ask the SOURCE data whether that point is land
   (hit test through the build pipeline at centre 0, which is the untransformed
   reference). Then compare with what the renderer actually paints, obtained by
   scanline-filling the pieces with nonzero winding + counting covers.

   Reports, per centre:
     back-face  : pixels painted by geometry that belongs to the hidden hemisphere
     overlap    : pixels painted twice (the signature of a fold / double draw)
     landDelta  : drawn land minus true visible land, as % of true visible land
   A correct render is 0 / 0 / ~0 (differences only on the 1-px edge).        */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/core.js', 'utf8');
const C = new Function(src + '\nreturn CORE;')();
const DEG = Math.PI / 180;
const geo = JSON.parse(fs.readFileSync(__dirname + '/countries.geojson', 'utf8'));
const feats = C.buildFeaturesLOD(geo, 0.2, true);      /* reference for "is land" */
C.prepareXYZ(feats);
const geoFeats = C.buildFeaturesLOD(geo, 0.2, false);  /* planar reference at centre 0 */
const m = new Float64Array(9);

const W = 200, H = 200;
const which = process.argv[2] || 'ortho';
const proj = C.PROJ[which];
const k = Math.min(W, H) / (2 * Math.max(proj.extent[0], proj.extent[1])) * 0.98;

function raster(polys) {
  const cov = new Int16Array(W * H), edges = [];
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = W / 2 + p[i * 2] * k, y1 = H / 2 - p[i * 2 + 1] * k;
      const x2 = W / 2 + p[j * 2] * k, y2 = H / 2 - p[j * 2 + 1] * k;
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5, xs = [];
    for (const e of edges) {
      const x1 = e[0], y1 = e[1], x2 = e[2], y2 = e[3];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        xs.push([x1 + (x2 - x1) * (yc - y1) / (y2 - y1), y2 > y1 ? 1 : -1]);
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1];
      if (wind !== 0) {
        const a = Math.max(0, Math.ceil(xs[i][0] - 0.5)), b = Math.min(W - 1, Math.floor(xs[i + 1][0] - 0.5));
        for (let x = a; x <= b; x++) cov[y * W + x]++;
      }
    }
  }
  return cov;
}

/* is the geographic point (lon,lat) inside some country? Through the build
   pipeline's own picking at centre 0, so the answer does not depend on the
   projection under test. */
function isLand(lon, lat) {
  const p = C.project(lon, lat);           /* CUR is eckert4 at centre 0 by default */
  const hits = C.hitTestLOD(geoFeats, p[0], p[1], 400);
  return hits.length > 0;
}

let worstBack = 0;
let worstPos = 0, worstTwice = 0, worstNeg = 0;
for (const c of [[0, 0], [20, 45], [-95, 48], [178, -12], [0, -90], [120, 75], [-40, -70]]) {
  C.rotMat(c[0], c[1], m);
  /* build the ladder level the raster will actually read, exactly as the app does
     (building level 0 while rasterising at a finer scale is a test inconsistency:
     it reports the decimation error as "missing land") */
  C.recenterAll(feats, c[0], c[1], proj, 0.2, C.LOD_U, C.levelForK(k, 0.7));
  const polys = [];
  for (const f of feats) for (const rg of f.rings) for (const p of rg.pieces) {
    const fl = C.pieceFlat(p, k, 0.7);            /* the same level the app draws */
    polys.push(fl.subarray(0, p._flatLen * 2));
  }
  const cov = raster(polys);

  /* ground truth on a grid of pixels */
  let trueLand = 0, drawnLand = 0, painted = 0, twice = 0, falsePos = 0, falseNeg = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cov[i] > 1) twice++;
      if (cov[i] > 0) painted++;
      /* invert this pixel through the FRONT branch of the projection */
      const px = (x + 0.5 - W / 2) / k, py = (H / 2 - (y + 0.5)) / k;
      let ll = proj.inv(px, py);
      let land = false;
      /* reject pixels that are outside the projection figure: a clamped inverse
         (Eckert's asin(y/K) saturates) happily returns the pole line for a pixel
         below the frame, which would count as polar land that is never painted
         and made this test report -70 % for projections that are fine */
      if (ll) {
        var rt = [0, 0];
        proj.fwd(ll[0], ll[1], rt);
        if (Math.hypot(rt[0] - px, rt[1] - py) > 1e-6) ll = null;
      }
      if (ll) {
        /* rotated lon/lat -> geographic */
        const g = C.unrot(c[0], c[1], ll[0], ll[1]);
        land = isLand(g[0], g[1]);
      }
      if (land) { trueLand++; if (cov[i] > 0) drawnLand++; else falseNeg++; }
      else if (cov[i] > 0) falsePos++;            /* painted where there is no land:
                                                     the hidden hemisphere showing
                                                     through, or a wrong closure */
    }
  }
  const delta = trueLand ? 100 * (drawnLand - trueLand) / trueLand : 0;
  console.log(which + ' centre ' + JSON.stringify(c).padEnd(12) +
    ' land ' + String(trueLand).padStart(5) +
    '  falsePos ' + String(falsePos).padStart(5) +
    '  falseNeg ' + String(falseNeg).padStart(5) +
    '  paintedTwice ' + String(twice).padStart(4) +
    '  net ' + delta.toFixed(1) + '%');
  worstPos = Math.max(worstPos, falsePos);
  worstTwice = Math.max(worstTwice, twice);
  worstNeg = Math.max(worstNeg, falseNeg);
}
console.log(which + ': worst falsePos ' + worstPos + ', worst falseNeg ' + worstNeg +
  ', worst paintedTwice ' + worstTwice);
