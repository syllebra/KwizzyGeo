/* GRATICULE regression: every visible stretch of every meridian and parallel must
   be drawn, at every centre of projection and in every re-centring projection.

   Why this exists: the cone-clipped projections (persp, ortho) do not use the lon
   window as a frame edge - their frame edge is the RIM, and lon' = +-180 is an
   ordinary meridian pointing away from the viewer, which projects onto the SAME
   vertical line (plane x = 0) as the central meridian. The old code clamped every
   sample of a line that ran past the seam onto lon' = 180, so that whole stretch
   collapsed into that one vertical line: at centre 155.8, 11.5 it drew as a dashed
   line down the middle of the disc while 36 % of the grid was simply missing.

   The check is coverage, not length, so it does not care how the drawing clips:
   the visible part of the grid is sampled independently (rotate into the frame,
   test visibility, project), and every such sample must have a DRAWN point within
   a few pixels. A gap, a collapsed run, a dropped line or a run drawn on the
   hidden hemisphere each show up as uncovered samples. */
const fs = require('fs');
const C = new Function(fs.readFileSync(__dirname + '/../core.js', 'utf8') + '\nreturn CORE;')();
const DEG = Math.PI / 180;
const W = 1280, H = 800;
const DLO = 15, DLAT = 15, STEP = 2;      /* what app.js asks for */
const TOL_PX = 4;                        /* a sample counts as covered within this */

let fails = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (!cond) { console.log('FAIL ' + name + (detail ? '  ' + detail : '')); fails++; }
  return cond;
}

/* ---- ground truth: the visible samples of the same graticule, independently ---- */
function visibleSamples(proj, m, k) {
  const out = [0, 0], pts = [];
  const _unusedVis = (lonDeg, latDeg) => {
    const phi = latDeg * DEG, lam = lonDeg * DEG;
    const c = Math.cos(phi), s = Math.sin(phi);
    const x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
    const X = m[0] * x + m[1] * y + m[2] * z;
    const Y = m[3] * x + m[4] * y + m[5] * z;
    const Z = m[6] * x + m[7] * y + m[8] * z;
    if (proj.clip === 'cone') {
      if (X < (proj.clipCos || 0)) return null;         /* the visible cap only */
      if (proj.fwdVec) proj.fwdVec(X, Y, Z, out);
      else proj.fwd(Math.atan2(-Z, X), Math.asin(Math.max(-1, Math.min(1, Y))), out);
    } else {
      /* a seam projection's frame edge IS lon' = +-180: the projection draws the
         whole world inside that window, so the rest is not "missing", it is the
         other side of the frame (and the drawing wraps it there by design). */
      const lonp = Math.atan2(-Z, X);
      if (lonp < -180 * DEG || lonp > 180 * DEG) return null;
      proj.fwd(lonp, Math.asin(Math.max(-1, Math.min(1, Y))), out);
    }
    return [out[0] * k, out[1] * k];                    /* screen px */
  };
  const lines = [];
  for (let lon = -180; lon <= 180; lon += DLO) lines.push([lon, -90, lon, 90]);
  for (let lat = -90 + DLAT; lat <= 90 - DLAT; lat += DLAT) lines.push([-180, lat, 180, lat]);

  /* A seam projection's frame is a rectangle in ROTATED lon'/lat', so visibility
     there is a question about the unwrapped lon' of the whole line: a parallel
     that circles the rotated pole sweeps 360 deg of lon' and only the sweep inside
     +-180 is inside the frame (the rest is the same curve, one frame-width over).
     Unwrapping per line is what makes the test agree with the drawing here - the
     atan2-per-point version counted the wrap as missing grid. */
  const out2 = [0, 0];
  function rotLL(lonDeg, latDeg) {
    const phi = latDeg * DEG, lam = lonDeg * DEG;
    const c = Math.cos(phi), s = Math.sin(phi);
    const x = c * Math.cos(lam), y = s, z = -c * Math.sin(lam);
    const X = m[0] * x + m[1] * y + m[2] * z;
    const Y = m[3] * x + m[4] * y + m[5] * z;
    const Z = m[6] * x + m[7] * y + m[8] * z;
    return [Math.atan2(-Z, X) / DEG, Math.asin(Math.max(-1, Math.min(1, Y))) / DEG, X, Y, Z];
  }

  for (const [lo1, la1, lo2, la2] of lines) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(lo2 - lo1), Math.abs(la2 - la1)) / 1));
    let prevRaw = null, prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const lonDeg = lo1 + (lo2 - lo1) * t, latDeg = la1 + (la2 - la1) * t;
      let p = null;
      if (proj.clip === 'cone') {
        const r = rotLL(lonDeg, latDeg);
        if (r[2] >= (proj.clipCos || 0)) {
          if (proj.fwdVec) proj.fwdVec(r[2], r[3], r[4], out);
          else proj.fwd(r[0] * DEG, r[1] * DEG, out);
          p = [out[0] * k, out[1] * k];
        }
      } else {
        let lonp = rotLL(lonDeg, latDeg)[0];
        if (prevRaw !== null) {
          while (lonp - prevRaw > 180) lonp -= 360;
          while (lonp - prevRaw < -180) lonp += 360;
        }
        /* right at the rotated pole lon' is degenerate and the drawing ends the run
           there (see graticuleRot): the same degree is skipped here */
        const latp = rotLL(lonDeg, latDeg)[1];
        prevRaw = lonp;
        if (lonp >= -180 && lonp <= 180 && Math.abs(latp) <= 89) {
          proj.fwd(lonp * DEG, latp * DEG, out2);
          /* a sample ON the seam meridian (|lon'| = 180) is drawn at whichever of
             the frame's two edges the drawing's own unwrap sent it to; both edges
             are that one meridian, so it counts as covered either way */
          p = [out2[0] * k, out2[1] * k, Math.abs(lonp) > 179.5 ? 1 : 0];
        }
      }
      if (p) pts.push(p);
    }
  }
  return pts;
}

/* ---- the drawn runs, as screen px, in a coarse hash grid for lookup ---- */
function drawnGrid(lines, k, cell) {
  const grid = new Map();
  const key = (a, b) => a + ',' + b;
  let n = 0;
  for (const ln of lines) {
    let prev = null;
    for (const q of ln) {
      const p = [q[0] * k, q[1] * k];
      /* densify the drawn polyline to the same scale, so coverage is tested against
         the LINE and not only against its vertices */
      if (prev) {
        const d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        const m = Math.max(1, Math.ceil(d / (cell * 0.5)));
        for (let i = 1; i <= m; i++) {
          const t = i / m;
          add(prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t);
        }
      } else add(p[0], p[1]);
      prev = p;
    }
  }
  function add(x, y) {
    const kk = key(Math.floor(x / cell), Math.floor(y / cell));
    const a = grid.get(kk);
    if (a) a.push(x, y); else grid.set(kk, [x, y]);
    n++;
  }
  return { grid, cell, n };
}

function nearest(g, x, y) {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const a = g.grid.get((cx + dx) + ',' + (cy + dy));
    if (!a) continue;
    for (let i = 0; i < a.length; i += 2) {
      const d = Math.hypot(a[i] - x, a[i + 1] - y);
      if (d < best) best = d;
    }
  }
  return best;
}

const projs = ['persp', 'ortho', 'eckert4', 'equirect', 'cylEqualArea'];
const centres = [[0, 0], [155.8, 11.5], [-40, -70], [80, 20], [0, 85], [179, -45], [-170, 60], [30, -88]];

for (const id of projs) {
  C.setProjection(id);
  const proj = C.CUR;
  const e = proj.extent;
  const fitK = Math.min(W / (2 * e[0]), H / (2 * e[1])) * 0.94;
  for (const [lon0, lat0] of centres) {
    for (const z of [0.69, 4]) {
      const k = fitK * z;
      const m = new Float64Array(9);
      C.rotMat(lon0, lat0, m);
      const g = C.graticuleRot(lon0, lat0, STEP, DLO, DLAT, proj, k, m);
      const tag = id + ' @ ' + lon0 + ',' + lat0 + ' z' + z;

      const truth = visibleSamples(proj, m, k);
      const grid = drawnGrid(g, k, 8);
      let uncovered = 0, worst = 0, worstAt = null;
      for (const p of truth) {
        let d = nearest(grid, p[0], p[1]);
        if (p[2] && d > TOL_PX) d = Math.min(d, nearest(grid, -p[0], p[1]));
        if (d > worst) { worst = d; worstAt = p; }
        if (d > TOL_PX) uncovered++;
      }
      const ratio = truth.length ? uncovered / truth.length : 0;
      check(tag + ': every visible grid point is drawn', ratio <= 0.01,
            uncovered + '/' + truth.length + ' uncovered (' + (ratio * 100).toFixed(1) +
            ' %), worst gap ' + worst.toFixed(1) + ' px' +
            (worstAt ? ' at ' + worstAt[0].toFixed(0) + ',' + worstAt[1].toFixed(0) : '') +
            ', ' + g.length + ' runs');

      /* no step inside a run may exceed the sampling budget by much: a jump means
         two points were clipped together (the collapse this test was written for) */
      let step = 0;
      for (const ln of g) for (let i = 1; i < ln.length; i++) {
        const d = Math.hypot(ln[i][0] - ln[i - 1][0], ln[i][1] - ln[i - 1][1]) * k;
        if (d > step) step = d;
      }
      check(tag + ': no jump inside a run', step <= 4 * Math.max(4, 0.004 * k),
            'widest step ' + step.toFixed(1) + ' px');
    }
  }
}

/* the exact scenario that was broken, named so a regression is recognisable */
C.setProjection('persp');
const e0 = C.CUR.extent;
const k0 = Math.min(W / (2 * e0[0]), H / (2 * e0[1])) * 0.94 * 0.69;
const m0 = new Float64Array(9);
C.rotMat(155.8, 11.5, m0);
const g0 = C.graticuleRot(155.8, 11.5, STEP, DLO, DLAT, C.CUR, k0, m0);
let dashed = 0;
for (const ln of g0) {
  let x0 = Infinity, x1 = -Infinity, len = 0;
  for (const q of ln) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; }
  for (let i = 1; i < ln.length; i++) len += Math.hypot(ln[i][0] - ln[i - 1][0], ln[i][1] - ln[i - 1][1]);
  if (Math.abs(x0) < 1e-12 && Math.abs(x1) < 1e-12 && len * k0 < 40) dashed++;
}
check('the collapsed seam meridian (155.8, 11.5) is gone', dashed === 0,
      dashed + ' zero-width run(s) left');

console.log(fails ? '\n' + fails + ' of ' + checks + ' FAILED' : checks + ' checks, ALL PASS');
process.exit(fails ? 1 : 0);
