/* POLE audit: for the cone projections (ortho, persp), how far does the DRAWN
   picture diverge from the true visible land when the centre of projection is AT
   or NEAR a pole? Same ground truth as visible_check.js (invert the pixel, ask the
   source data), but only pole-ish centres, plus the signed coverage so a fold that
   paints a pixel twice shows up. This is the audit that showed the GEOMETRY at the
   poles was already right (within 0.2 %) before the frame fix: what was wrong was
   the ORIENTATION, not the coverage - see README "Moving the centre of projection". */
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../core.js', 'utf8');
const C = new Function(src + '\nreturn CORE;')();
const DEG = Math.PI / 180;
const geo = JSON.parse(fs.readFileSync(__dirname + '/../data/countries.geojson', 'utf8'));
const feats = C.buildFeaturesLOD(geo, 0.2, true);
C.prepareXYZ(feats);
const geoFeats = C.buildFeaturesLOD(geo, 0.2, false);

const W = 240, H = 240;

function isLand(lon, lat) {
  const p = C.project(lon, lat);
  return C.hitTestLOD(geoFeats, p[0], p[1], 400).length > 0;
}

var k = 0;
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
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc))
        xs.push([x1 + (x2 - x1) * (yc - y1) / (y2 - y1), y2 > y1 ? 1 : -1]);
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

const centres = [[0, 0], [0, 89.9], [0, 90], [0, -90], [40, 89.99], [-120, 89.9], [178, -89.9], [0, 88], [0, 85]];
for (const which of ['ortho', 'persp']) {
  const proj = C.PROJ[which];
  k = Math.min(W, H) / (2 * Math.max(proj.extent[0], proj.extent[1])) * 0.98;
  for (const c of centres) {
    C.recenterAll(feats, c[0], c[1], proj, 0.2, C.LOD_U, C.levelForK(k, 0.7));
    const polys = [];
    for (const f of feats) for (const rg of f.rings) for (const p of rg.pieces) {
      const fl = C.pieceFlat(p, k, 0.7);
      polys.push(fl.subarray(0, p._flatLen * 2));
    }
    const cov = raster(polys);
    let trueLand = 0, drawnLand = 0, falsePos = 0, falseNeg = 0, twice = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cov[i] > 1) twice++;
      const px = (x + 0.5 - W / 2) / k, py = (H / 2 - (y + 0.5)) / k;
      let ll = proj.inv(px, py);
      if (ll) {
        const rt = [0, 0];
        proj.fwd(ll[0], ll[1], rt);
        if (Math.hypot(rt[0] - px, rt[1] - py) > 1e-6) ll = null;
      }
      let land = false;
      if (ll) land = isLand(...C.unrot(c[0], c[1], ll[0], ll[1]));
      if (land) { trueLand++; if (cov[i] > 0) drawnLand++; else falseNeg++; }
      else if (cov[i] > 0) falsePos++;
    }
    console.log(which + ' centre ' + JSON.stringify(c).padEnd(12) +
      ' true ' + String(trueLand).padStart(6) + ' falsePos ' + String(falsePos).padStart(6) +
      ' falseNeg ' + String(falseNeg).padStart(6) + ' twice ' + String(twice).padStart(6) +
      ' net ' + (trueLand ? (100 * (drawnLand - trueLand) / trueLand).toFixed(1) : '0') + '%');
  }
}
