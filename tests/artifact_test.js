/* Look for drawing artifacts after the kind of event sequence a user produces:
   a wheel zoom between two reprojections, a drag, a layer switch. For each
   sequence, every intermediate state that the renderer can actually be asked to
   draw is rasterised and compared with the same state drawn from a clean rebuild.
   Any difference means the frame showed stale or wrong geometry.

   Run: node artifact_test.js                                          */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../core.js', 'utf8');
const C = new Function(src + '\nreturn CORE;')();
const geo = JSON.parse(fs.readFileSync(__dirname + '/../ne10m.geojson', 'utf8'));
const feats = C.buildFeaturesLOD(geo, 0.2, true);
C.prepareXYZ(feats);

const W = 160, H = 160;
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   ' + name);
  else { fails++; console.log('FAIL ' + name + (extra ? '   [' + extra + ']' : '')); }
}

/* draw the current state exactly the way app.js does: pieceFlat at this zoom */
function collect(k, maxPx) {
  const polys = [];
  for (const f of feats) {
    for (const rg of f.rings) {
      if (!rg.pieces) continue;
      for (const p of rg.pieces) {
        const flat = C.pieceFlat(p, k, maxPx);
        const n = p._flatLen;
        if (n < 3) continue;
        const out = new Float64Array(n * 2);
        for (let i = 0; i < n * 2; i++) out[i] = flat[i];
        polys.push(out);
      }
    }
  }
  return polys;
}
function raster(polys, k) {
  const cov = new Uint8Array(W * H), edges = [];
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = W / 2 + p[i * 2] * k, y1 = H / 2 - p[i * 2 + 1] * k;
      const x2 = W / 2 + p[j * 2] * k, y2 = H / 2 - p[j * 2 + 1] * k;
      if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) continue;
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  for (let y = 0; y < H; y++) {
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
        const a = Math.max(0, Math.ceil(xs[i][0] - 0.5)), b = Math.min(W - 1, Math.floor(xs[i + 1][0] - 0.5));
        for (let x = a; x <= b; x++) cov[y * W + x] = 1;
      }
    }
  }
  return cov;
}
const K = 160 / (2 * C.PROJ.ortho.extent[0]);   /* screen scale for the raster */

/* ---------- 1. wheel zoom: draw happens BEFORE the reprojection lands ---------- */
{
  const lvlW = C.levelForK(K, 1.2);
  C.recenterAll(feats, 0, 0, C.PROJ.ortho, 0.2, C.LOD_U, lvlW);
  /* the user zooms 4x: k changes at once, the reprojection is scheduled */
  const kZoom = K * 4;
  /* THE FRAME DRAWN BEFORE THE REPROJECTION */
  const midFrame = collect(kZoom, 1.2);
  let nonFinite = 0;
  for (const p of midFrame) for (const v of p) if (!isFinite(v)) nonFinite++;
  check('zoom before reprojection: no NaN/Inf coordinates', nonFinite === 0, nonFinite + ' bad');

  /* now the reprojection lands at the deeper level and the frame is clean */
  const lvlZ = C.levelForK(kZoom, 1.2);
  C.recenterAll(feats, 0, 0, C.PROJ.ortho, 0.2, C.LOD_U, lvlZ);
  const settled = collect(kZoom, 1.2);
  const rs = raster(settled, kZoom);

  /* compare with the same view built from scratch (a fresh layer, one reprojection) */
  const fresh = C.buildFeaturesLOD(geo, 0.2, true);
  C.prepareXYZ(fresh);
  const C2 = C;
  C2.recenterAll(fresh, 0, 0, C.PROJ.ortho, 0.2, C.LOD_U, C2.levelForK(kZoom, 1.2));
  const polys2 = [];
  for (const f of fresh) for (const rg of f.rings) for (const p of rg.pieces) {
    const flat = C2.pieceFlat(p, kZoom, 1.2), n = p._flatLen;
    if (n < 3) continue;
    const out = new Float64Array(n * 2);
    for (let i = 0; i < n * 2; i++) out[i] = flat[i];
    polys2.push(out);
  }
  const rf = raster(polys2, kZoom);
  let diff = 0;
  for (let i = 0; i < W * H; i++) if (rs[i] !== rf[i]) diff++;
  check('settled zoom matches a clean rebuild', diff === 0, diff + ' px differ');
}

/* ---------- 2. every level switch in a zoom ladder is safe ---------- */
{
  let bad = 0, tested = 0;
  for (const kMul of [1, 2, 4, 8, 16, 32]) {
    const k = K * kMul, lvl = C.levelForK(k, 1.2);
    C.recenterAll(feats, 0, 0, C.PROJ.ortho, 0.2, C.LOD_U, lvl);
    /* ask for every level the renderer could pick at that k, and check sanity */
    for (let t = 0; t < C.LOD_U.length; t++) {
      tested++;
      for (const f of feats) for (const rg of f.rings) for (const p of rg.pieces) {
        const got = C.pieceLevelIndex(p, K * Math.pow(2, t), 1.2);
        if (got >= 0) {
          if (p.levelN[got] !== p.n) { bad++; }
          for (let i = 0; i < p.lw[got]; i++) {
            const ix = p.levels[got][i];
            if (ix >= p.n || ix < 0) { bad++; }
          }
        }
        const flat = C.pieceFlat(p, K * Math.pow(2, t), 1.2);
        for (let i = 0; i < p._flatLen * 2; i++) if (!isFinite(flat[i])) bad++;
      }
    }
  }
  check('no level ever indexes past its piece (all zooms)', bad === 0, tested + ' k/level pairs, ' + bad + ' bad');
}

/* ---------- 3. drag across the limb: pieces are re-cut, still sane ---------- */
{
  let bad = 0;
  for (let i = 0; i < 12; i++) {
    const lon = -180 + i * 30, lat = -70 + i * 12;
    const lvl = C.levelForK(K, 1.2);
    C.recenterAll(feats, lon, lat, C.PROJ.ortho, 0.2, C.LOD_U, lvl);
    for (const f of feats) for (const rg of f.rings) for (const p of rg.pieces) {
      const flat = C.pieceFlat(p, K, 1.2);
      for (let q = 0; q < p._flatLen * 2; q++) if (!isFinite(flat[q])) bad++;
      if (p._flatLen > 0 && p._flatLen < 3) bad++;          /* cannot be stroke-able */
      for (const v of p.bbox) if (!isFinite(v)) bad++;
    }
  }
  check('drag across the limb: no bad geometry', bad === 0, bad + ' problems');
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURE(S)');
process.exit(fails ? 1 : 0);
